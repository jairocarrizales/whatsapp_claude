// Servicio permanente: es el unico proceso conectado a WhatsApp. Envia los mensajes
// programados y sirve el panel web y la API local que usa el MCP.
// Uso: npm run service   (o se instala al inicio de Windows con npm run install-startup)
import { createServer } from 'node:http'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import QRCode from 'qrcode'
import { isJidGroup } from 'baileys'
import { dataDir, dbFile, panelPort, root } from './config.js'
import { openStore } from './store.js'
import { WhatsApp } from './whatsapp.js'
import { REPEATS, Scheduler } from './scheduler.js'
import { VoiceReminders } from './voice.js'
import { Assistant } from './assistant.js'
import { transcribe } from './transcribe.js'
import { KIND_LABEL, parseDriveUrl } from './drive.js'
import { getPace, planTimes, personalize, savePace } from './broadcast.js'
import { Email, PRESETS, resolveRecipients } from './email.js'

const logFile = join(dataDir, 'service.log')
const log = (msg) => {
	const line = `[${new Date().toLocaleString('es-MX')}] ${msg}`
	console.error(line)
	try {
		appendFileSync(logFile, line + '\n')
	} catch {}
}

const store = openStore(dbFile)
const wa = new WhatsApp({ dataDir, store })
const scheduler = new Scheduler({ store, wa, log })
const email = new Email({ store, log })
const assistant = new Assistant({ log })

wa.on((event, data) => {
	if (event === 'open') log(`conectado como ${data.name ?? data.id}`)
	if (event === 'logged_out') log('la sesion se cerro desde el telefono; vuelve a vincular desde el panel')
	if (event === 'replaced') log('otra instancia tomo la sesion; reintentando en 30 s')
	if (event === 'history') log(`historial: +${data.chats} chats, +${data.messages} mensajes`)
})

const now = () => Math.floor(Date.now() / 1000)
const chatInfo = (jid) => ({ jid, name: store.displayName(jid), phone: store.phoneFor(jid), group: Boolean(isJidGroup(jid)) })

class HttpError extends Error {
	constructor(status, message) {
		super(message)
		this.status = status
	}
}

async function parseSchedule(body, partial = false) {
	const out = {}
	if (!partial || body.to !== undefined) {
		if (!body.to) throw new HttpError(400, 'Falta el destinatario.')
		const to = String(body.to)
		try {
			// Un numero nuevo se valida con WhatsApp ahora (p. ej. el "1" de los celulares de Mexico),
			// no a la hora del envio.
			out.chat_jid = !to.includes('@') && /^[\d\s+()-]+$/.test(to) && wa.state === 'open' ? await wa.resolveRecipient(to) : store.resolveChat(to)
		} catch (err) {
			throw new HttpError(400, err.message)
		}
		out.chat_name = store.displayName(out.chat_jid)
	}
	if (!partial || body.text !== undefined) {
		if (!String(body.text ?? '').trim()) throw new HttpError(400, 'El mensaje esta vacio.')
		out.text = String(body.text)
	}
	if (!partial || body.send_at !== undefined) {
		const ms = Date.parse(body.send_at)
		if (Number.isNaN(ms)) throw new HttpError(400, 'Fecha de envio invalida.')
		if (ms / 1000 < now() - 60) throw new HttpError(400, 'La fecha de envio ya paso.')
		out.send_at = Math.floor(ms / 1000)
	}
	if (!partial || body.repeat !== undefined) {
		const repeat = body.repeat ?? 'none'
		if (!REPEATS.includes(repeat)) throw new HttpError(400, `Repeticion invalida (${REPEATS.join(', ')}).`)
		out.repeat = repeat
	}
	return out
}

function createScheduled({ chat_jid, chat_name, text, send_at, repeat, created_by, transcript = null, batch = null, quiet = false }) {
	const { lastInsertRowid } = store.db
		.prepare(`INSERT INTO scheduled (chat_jid, chat_name, text, send_at, repeat, created_at, created_by, transcript, batch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(chat_jid, chat_name, text, send_at, repeat, now(), created_by, transcript, batch)
	if (!quiet) log(`programado #${lastInsertRowid} (${created_by}) para ${chat_name} el ${new Date(send_at * 1000).toLocaleString('es-MX')}`)
	return store.db.prepare('SELECT * FROM scheduled WHERE id = ?').get(lastInsertRowid)
}

function parseResource(body) {
	const parsed = parseDriveUrl(body.url)
	if (!parsed) throw new HttpError(400, 'El enlace no es de Google Drive, Docs, Sheets o Slides.')
	const description = String(body.description ?? body.name ?? '').trim().slice(0, 200)
	return { description, url: String(body.url).trim(), kind: parsed.kind, drive_id: parsed.driveId }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
function parseEmailContact(body) {
	const name = String(body.name ?? '').trim()
	if (!name) throw new HttpError(400, 'Ponle un nombre al contacto.')
	const emails = String(body.emails ?? '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)
	if (!emails.length) throw new HttpError(400, 'Escribe al menos un correo.')
	const bad = emails.filter((e) => !EMAIL_RE.test(e))
	if (bad.length) throw new HttpError(400, `Correo no válido: ${bad.join(', ')}`)
	return { name, emails: [...new Set(emails)].join(', ') }
}

function parseEmailGroup(body) {
	const name = String(body.name ?? '').trim()
	if (!name) throw new HttpError(400, 'Ponle un nombre al grupo.')
	const members = Array.isArray(body.members) ? [...new Set(body.members.map(Number).filter(Boolean))] : []
	return { name, members }
}

function setGroupMembers(groupId, members) {
	store.db.prepare('DELETE FROM email_group_members WHERE group_id = ?').run(groupId)
	const add = store.db.prepare('INSERT OR IGNORE INTO email_group_members (group_id, contact_id) SELECT ?, id FROM email_contacts WHERE id = ?')
	for (const m of members) add.run(groupId, m)
}

function waLists() {
	const members = store.db.prepare('SELECT * FROM wa_list_members').all()
	return store.db.prepare('SELECT * FROM wa_lists ORDER BY name').all().map((l) => ({
		...l,
		members: members
			.filter((m) => m.list_id === l.id)
			.map((m) => ({ jid: m.chat_jid, name: store.displayName(m.chat_jid) ?? m.name, phone: store.phoneFor(m.chat_jid) }))
			.sort((a, b) => a.name.localeCompare(b.name, 'es')),
	}))
}

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Programa un mismo mensaje para cada integrante de una lista, espaciado segun el ritmo configurado.
async function scheduleList(body) {
	const lists = waLists()
	const list = body.list_id
		? lists.find((l) => l.id === Number(body.list_id))
		: lists.find((l) => stripAccents(l.name) === stripAccents(String(body.list).replace(/^lista\s+(?:de\s+)?/i, '')))
	if (!list) throw new HttpError(404, body.list ? `No existe la lista "${body.list}". Listas: ${lists.map((l) => l.name).join(', ') || 'ninguna'}.` : 'No existe esa lista.')
	if (!list.members.length) throw new HttpError(400, `La lista ${list.name} no tiene integrantes.`)
	// Variantes del texto: se reparten en orden (persona 1 -> texto 1, 2 -> 2, ...) y se repiten en ciclo.
	const texts = (Array.isArray(body.texts) ? body.texts : [body.text]).map((t) => String(t ?? '')).filter((t) => t.trim())
	if (!texts.length) throw new HttpError(400, 'El mensaje esta vacio.')
	const ms = Date.parse(body.send_at)
	if (Number.isNaN(ms)) throw new HttpError(400, 'Fecha de envio invalida.')
	if (ms / 1000 < now() - 60) throw new HttpError(400, 'La fecha de envio ya paso.')
	const repeat = body.repeat ?? 'none'
	if (!REPEATS.includes(repeat)) throw new HttpError(400, 'Repeticion invalida.')
	const pace = getPace(store)
	const times = planTimes(Math.max(Math.floor(ms / 1000), now()), list.members.length, pace)
	if (body.preview) {
		return {
			preview: true, list: list.name, count: list.members.length, variants: texts.length,
			first: new Date(times[0] * 1000).toISOString(), last: new Date(times.at(-1) * 1000).toISOString(),
			examples: list.members.slice(0, 3).map((m, i) => ({ to: m.name, text: personalize(texts[i % texts.length], m.name) })),
		}
	}
	const ids = []
	store.tx(() => {
		list.members.forEach((m, i) => {
			ids.push(createScheduled({ chat_jid: m.jid, chat_name: m.name, text: personalize(texts[i % texts.length], m.name), send_at: times[i], repeat, created_by: body.created_by ?? 'panel', batch: list.name, quiet: true }).id)
		})
	})
	const fmt = (t) => new Date(t * 1000).toLocaleString('es-MX')
	log(`lista ${list.name}: ${ids.length} mensajes programados de ${fmt(times[0])} a ${fmt(times.at(-1))}`)
	return { batch: true, list: list.name, variants: texts.length, count: ids.length, first: new Date(times[0] * 1000).toISOString(), last: new Date(times.at(-1) * 1000).toISOString(), ids }
}

const resourceRow = (r) => ({ num: r.num, description: r.name, url: r.url, kind: r.kind, kind_label: KIND_LABEL[r.kind], drive_id: r.drive_id, created_at: new Date(r.created_at * 1000).toISOString() })

const scheduledRow = (r) => ({ ...r, send_at: new Date(r.send_at * 1000).toISOString(), created_at: new Date(r.created_at * 1000).toISOString() })

const routes = {
	'GET /api/status': async () => {
		const count = (t) => store.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n
		return {
			linked: wa.isLinked(),
			state: wa.state,
			me: wa.me ? { id: wa.me.id, name: wa.me.name } : null,
			lastError: wa.lastError,
			qr: wa.state === 'qr' && wa.qr ? await QRCode.toDataURL(wa.qr, { margin: 2, scale: 6 }) : null,
			synced: { chats: count('chats'), contacts: count('contacts'), messages: count('messages') },
			pending: store.db.prepare(`SELECT COUNT(*) n FROM scheduled WHERE status = 'pending'`).get().n,
		}
	},

	// Inicia la conexion (y con ello el QR si no hay sesion vinculada).
	'POST /api/connect': async () => {
		wa.replacedCount = 0
		await wa.connect()
		return { state: wa.state }
	},

	'GET /api/chats': async ({ query }) => {
		const q = (query.get('q') ?? '').trim()
		const jids = q
			? store.searchChats(q, 15)
			: store.db.prepare('SELECT jid FROM chats ORDER BY last_ts DESC LIMIT 15').all().map((r) => r.jid)
		return jids.map(chatInfo)
	},

	'GET /api/scheduled': async ({ query }) => {
		const status = query.get('status') ?? 'pending'
		if (status === 'pending') {
			return store.db.prepare(`SELECT * FROM scheduled WHERE status = 'pending' ORDER BY send_at`).all().map(scheduledRow)
		}
		// Historial: cada ejecucion (enviado, fallido, perdido) mas los cancelados.
		return store.db
			.prepare(`
				SELECT 'run:' || r.id AS ref, r.scheduled_id, r.chat_name, r.text, r.at, r.status, r.error FROM scheduled_runs r
				UNION ALL
				SELECT 'cancelled:' || s.id, s.id, s.chat_name, s.text, s.created_at, 'cancelled', NULL FROM scheduled s WHERE s.status = 'cancelled'
				ORDER BY 5 DESC LIMIT 200`)
			.all()
			.map((r) => ({ ...r, at: new Date(r.at * 1000).toISOString() }))
	},

	// Borra del historial los elementos indicados ({ refs: ['run:3', 'cancelled:7'] }) o todos ({ all: true }).
	// Los mensajes pendientes nunca se tocan.
	'POST /api/history/delete': async ({ body }) => {
		let deleted = 0
		store.tx(() => {
			if (body.all) {
				deleted = store.db.prepare('DELETE FROM scheduled_runs').run().changes
				deleted += store.db.prepare(`DELETE FROM scheduled WHERE status = 'cancelled'`).run().changes
			} else {
				for (const ref of Array.isArray(body.refs) ? body.refs : []) {
					const [kind, id] = String(ref).split(':')
					if (kind === 'run') deleted += store.db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(Number(id)).changes
					if (kind === 'cancelled') {
						store.db.prepare('DELETE FROM scheduled_runs WHERE scheduled_id = ?').run(Number(id))
						deleted += store.db.prepare(`DELETE FROM scheduled WHERE id = ? AND status = 'cancelled'`).run(Number(id)).changes
					}
				}
			}
			// Mensajes ya terminados (enviados, fallidos, perdidos) que se quedaron sin ningun registro.
			store.db.prepare(`DELETE FROM scheduled WHERE status IN ('sent', 'failed', 'missed') AND id NOT IN (SELECT scheduled_id FROM scheduled_runs)`).run()
		})
		log(`historial: ${deleted} elemento(s) borrado(s)`)
		return { deleted }
	},

	'POST /api/scheduled': async ({ body }) => {
		if (body.list_id || body.list) return scheduleList(body)
		const s = await parseSchedule(body)
		if (body.preview) return { preview: true, chat_jid: s.chat_jid, chat_name: s.chat_name, text: s.text, send_at: new Date(s.send_at * 1000).toISOString(), repeat: s.repeat }
		return scheduledRow(createScheduled({ ...s, created_by: body.created_by ?? 'panel' }))
	},

	'PATCH /api/scheduled/:id': async ({ params, body }) => {
		const row = store.db.prepare(`SELECT * FROM scheduled WHERE id = ?`).get(params.id)
		if (!row) throw new HttpError(404, 'No existe ese mensaje programado.')
		if (row.status !== 'pending') throw new HttpError(409, 'Solo se pueden editar mensajes pendientes.')
		const s = await parseSchedule(body, true)
		const fields = Object.keys(s)
		if (fields.length) {
			store.db.prepare(`UPDATE scheduled SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((f) => s[f]), row.id)
		}
		return scheduledRow(store.db.prepare('SELECT * FROM scheduled WHERE id = ?').get(row.id))
	},

	'DELETE /api/scheduled/:id': async ({ params }) => {
		const { changes } = store.db.prepare(`UPDATE scheduled SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(params.id)
		if (!changes) throw new HttpError(404, 'No hay un mensaje pendiente con ese id.')
		log(`cancelado #${params.id}`)
		return { ok: true }
	},

	// Cancela todos los pendientes de un envio a lista.
	'POST /api/scheduled/cancel-batch': async ({ body }) => {
		if (!body.batch) throw new HttpError(400, 'Falta la lista.')
		const { changes } = store.db.prepare(`UPDATE scheduled SET status = 'cancelled' WHERE batch = ? AND status = 'pending'`).run(String(body.batch))
		log(`lista ${body.batch}: ${changes} pendientes cancelados`)
		return { cancelled: changes }
	},

	// Reprograma para ya mismo (tambien sirve para reintentar uno fallido o perdido).
	'POST /api/scheduled/:id/send-now': async ({ params }) => {
		const { changes } = store.db
			.prepare(`UPDATE scheduled SET status = 'pending', send_at = ?, last_error = NULL WHERE id = ? AND status <> 'sent' AND status <> 'cancelled'`)
			.run(now(), params.id)
		if (!changes) throw new HttpError(404, 'No se puede reenviar ese mensaje.')
		scheduler.tick()
		return { ok: true }
	},

	// Envio inmediato (lo usa el MCP).
	'POST /api/send': async ({ body }) => {
		if (wa.state !== 'open') throw new HttpError(503, `WhatsApp no esta conectado (estado: ${wa.state}).`)
		if (!body.to || !String(body.text ?? '').trim()) throw new HttpError(400, 'Faltan "to" o "text".')
		const to = String(body.to)
		const target = to.includes('@') || /^[\d\s+()-]+$/.test(to) ? to : store.resolveChat(to)
		const { jid, id } = await wa.send(target, String(body.text), body.reply_to)
		return { jid, name: store.displayName(jid), id }
	},

	// ---- Ajustes: carpetas y archivos de Drive ----
	// Cada uno tiene un numero fijo (#1, #2, ...) que nunca se reutiliza, para referirse a el al hablar con Claude.
	'GET /api/resources': async ({ query }) => {
		const q = (query.get('q') ?? '').trim()
		const rows = q
			? store.db.prepare(`SELECT * FROM resources WHERE name LIKE ? OR url LIKE ? OR num = ? ORDER BY num`).all(`%${q}%`, `%${q}%`, Number(q.replace(/^#/, '')) || -1)
			: store.db.prepare(`SELECT * FROM resources ORDER BY num`).all()
		return rows.map(resourceRow)
	},

	'POST /api/resources': async ({ body }) => {
		const r = parseResource(body)
		let num
		store.tx(() => {
			num = Number(store.db.prepare(`SELECT value FROM meta WHERE key = 'next_resource_num'`).get()?.value ?? 1)
			store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('next_resource_num', ?)`).run(String(num + 1))
			store.db
				.prepare(`INSERT INTO resources (num, name, url, kind, drive_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
				.run(num, r.description, r.url, r.kind, r.drive_id, now())
		})
		log(`documento #${num} registrado: ${r.description || r.url}`)
		return resourceRow(store.db.prepare('SELECT * FROM resources WHERE num = ?').get(num))
	},

	'PATCH /api/resources/:num': async ({ params, body }) => {
		const row = store.db.prepare('SELECT * FROM resources WHERE num = ?').get(Number(params.num))
		if (!row) throw new HttpError(404, `No existe el #${params.num}.`)
		const r = parseResource({ url: row.url, description: row.name, ...body })
		store.db.prepare(`UPDATE resources SET name = ?, url = ?, kind = ?, drive_id = ? WHERE num = ?`).run(r.description, r.url, r.kind, r.drive_id, row.num)
		return resourceRow(store.db.prepare('SELECT * FROM resources WHERE num = ?').get(row.num))
	},

	'DELETE /api/resources/:num': async ({ params }) => {
		const { changes } = store.db.prepare('DELETE FROM resources WHERE num = ?').run(Number(params.num))
		if (!changes) throw new HttpError(404, `No existe el #${params.num}.`)
		log(`documento #${params.num} quitado`)
		return { ok: true }
	},

	// Cierra la sesion de WhatsApp en este equipo y genera un QR nuevo (para vincular otra vez u otro numero).
	'POST /api/relink': async () => {
		if (wa.isLinked()) {
			await wa.logout().catch((err) => log(`al cerrar sesion: ${err.message}`))
			// Espera a que Baileys cierre y borre la sesion antes de pedir el QR nuevo.
			for (let i = 0; i < 20 && wa.isLinked(); i++) await new Promise((r) => setTimeout(r, 250))
		}
		log('vinculacion nueva solicitada desde el panel')
		wa.replacedCount = 0
		await wa.connect()
		return { state: wa.state }
	},

	// ---- Ajustes: correo ----
	'GET /api/email': async () => ({ ...email.publicConfig(), providers: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])) }),

	// Verifica usuario y contrasena con el servidor antes de guardar.
	'PUT /api/email': async ({ body }) => {
		try {
			return await email.save(body)
		} catch (err) {
			throw new HttpError(400, err.message)
		}
	},

	'DELETE /api/email': async () => {
		email.clear()
		log('configuracion de correo eliminada')
		return { ok: true }
	},

	'POST /api/email/test': async () => {
		const c = email.config()
		if (!c) throw new HttpError(400, 'Primero guarda tu cuenta de correo.')
		try {
			await email.send({ to: [{ name: c.user, email: c.user }], subject: 'Prueba de BuhoChat', body: 'Si lees esto, BuhoChat ya puede enviar correos desde tu cuenta.', source: 'prueba' })
		} catch (err) {
			throw new HttpError(502, `No se pudo enviar: ${err.message}`)
		}
		return { ok: true, to: c.user }
	},

	'GET /api/email-contacts': async () => email.contacts(),

	'POST /api/email-contacts': async ({ body }) => {
		const c = parseEmailContact(body)
		const { lastInsertRowid } = store.db.prepare(`INSERT INTO email_contacts (name, emails, created_at) VALUES (?, ?, ?)`).run(c.name, c.emails, now())
		return store.db.prepare('SELECT * FROM email_contacts WHERE id = ?').get(lastInsertRowid)
	},

	'PATCH /api/email-contacts/:id': async ({ params, body }) => {
		const row = store.db.prepare('SELECT * FROM email_contacts WHERE id = ?').get(params.id)
		if (!row) throw new HttpError(404, 'No existe ese contacto.')
		const c = parseEmailContact({ name: row.name, emails: row.emails, ...body })
		store.db.prepare('UPDATE email_contacts SET name = ?, emails = ? WHERE id = ?').run(c.name, c.emails, row.id)
		return store.db.prepare('SELECT * FROM email_contacts WHERE id = ?').get(row.id)
	},

	'DELETE /api/email-contacts/:id': async ({ params }) => {
		store.db.prepare('DELETE FROM email_group_members WHERE contact_id = ?').run(params.id)
		const { changes } = store.db.prepare('DELETE FROM email_contacts WHERE id = ?').run(params.id)
		if (!changes) throw new HttpError(404, 'No existe ese contacto.')
		return { ok: true }
	},

	'GET /api/email-groups': async () => email.groups(),

	'POST /api/email-groups': async ({ body }) => {
		const g = parseEmailGroup(body)
		let id
		store.tx(() => {
			id = Number(store.db.prepare(`INSERT INTO email_groups (name, created_at) VALUES (?, ?)`).run(g.name, now()).lastInsertRowid)
			setGroupMembers(id, g.members)
		})
		log(`grupo de correo creado: ${g.name}`)
		return email.groups().find((x) => x.id === id)
	},

	'PATCH /api/email-groups/:id': async ({ params, body }) => {
		const row = store.db.prepare('SELECT * FROM email_groups WHERE id = ?').get(params.id)
		if (!row) throw new HttpError(404, 'No existe ese grupo.')
		const g = parseEmailGroup({ name: row.name, ...body })
		store.tx(() => {
			store.db.prepare('UPDATE email_groups SET name = ? WHERE id = ?').run(g.name, row.id)
			if (body.members !== undefined) setGroupMembers(row.id, g.members)
		})
		return email.groups().find((x) => x.id === row.id)
	},

	'DELETE /api/email-groups/:id': async ({ params }) => {
		let changes
		store.tx(() => {
			store.db.prepare('DELETE FROM email_group_members WHERE group_id = ?').run(params.id)
			changes = store.db.prepare('DELETE FROM email_groups WHERE id = ?').run(params.id).changes
		})
		if (!changes) throw new HttpError(404, 'No existe ese grupo.')
		return { ok: true }
	},

	// Envio desde el panel, a un grupo o a una lista de direcciones (el panel pide confirmacion antes).
	'POST /api/email/send': async ({ body }) => {
		const subject = String(body.subject ?? '').trim()
		const text = String(body.body ?? '').trim()
		if (!body.preview && (!subject || !text)) throw new HttpError(400, 'Escribe el asunto y el mensaje.')
		let to
		if (Array.isArray(body.recipients)) {
			const r = resolveRecipients(body.recipients, email)
			if (!r.ok) {
				const why = { unknown: `No encontré en la agenda ni en los grupos: ${r.detail}.`, ambiguous: `Nombre ambiguo: ${r.detail}.`, 'empty-group': `El grupo ${r.detail} no tiene integrantes.`, 'no-recipient': 'Falta el destinatario.' }[r.error]
				throw new HttpError(400, why)
			}
			to = r.to
			// Vista previa: a quien llegaria, sin enviar nada.
			if (body.preview) return { preview: true, recipients: to, groups: r.groups, configured: Boolean(email.config()) }
		} else if (body.group_id) {
			const g = email.groups().find((x) => x.id === Number(body.group_id))
			if (!g) throw new HttpError(404, 'No existe ese grupo.')
			if (!g.emails.length) throw new HttpError(400, `El grupo ${g.name} no tiene integrantes.`)
			to = g.emails.map((e) => ({ name: g.name, email: e }))
		} else {
			const list = String(body.to ?? '').split(/[,;\s]+/).filter(Boolean)
			if (!list.length || list.some((e) => !EMAIL_RE.test(e))) throw new HttpError(400, 'Revisa las direcciones de correo.')
			to = list.map((e) => ({ name: e, email: e }))
		}
		try {
			await email.send({ to, subject, body: text, source: body.source === 'claude' ? 'claude' : 'panel' })
		} catch (err) {
			throw new HttpError(502, `No se pudo enviar: ${err.message}`)
		}
		return { ok: true, sent: to.length }
	},

	// ---- Listas de difusion de WhatsApp ----
	'GET /api/wa-lists': async () => waLists(),

	'POST /api/wa-lists': async ({ body }) => {
		const name = String(body.name ?? '').trim()
		if (!name) throw new HttpError(400, 'Ponle un nombre a la lista.')
		const id = Number(store.db.prepare('INSERT INTO wa_lists (name, created_at) VALUES (?, ?)').run(name, now()).lastInsertRowid)
		log(`lista de difusion creada: ${name}`)
		return waLists().find((l) => l.id === id)
	},

	'PATCH /api/wa-lists/:id': async ({ params, body }) => {
		const name = String(body.name ?? '').trim()
		if (!name) throw new HttpError(400, 'Ponle un nombre a la lista.')
		const { changes } = store.db.prepare('UPDATE wa_lists SET name = ? WHERE id = ?').run(name, params.id)
		if (!changes) throw new HttpError(404, 'No existe esa lista.')
		return waLists().find((l) => l.id === Number(params.id))
	},

	'DELETE /api/wa-lists/:id': async ({ params }) => {
		let changes
		store.tx(() => {
			store.db.prepare('DELETE FROM wa_list_members WHERE list_id = ?').run(params.id)
			changes = store.db.prepare('DELETE FROM wa_lists WHERE id = ?').run(params.id).changes
		})
		if (!changes) throw new HttpError(404, 'No existe esa lista.')
		return { ok: true }
	},

	// Agrega un contacto (jid, numero o nombre de chat) a la lista.
	'POST /api/wa-lists/:id/members': async ({ params, body }) => {
		if (!store.db.prepare('SELECT 1 FROM wa_lists WHERE id = ?').get(params.id)) throw new HttpError(404, 'No existe esa lista.')
		const to = String(body.to ?? '').trim()
		if (!to) throw new HttpError(400, 'Falta el contacto.')
		let jid
		try {
			jid = !to.includes('@') && /^[\d\s+()-]+$/.test(to) && wa.state === 'open' ? await wa.resolveRecipient(to) : store.resolveChat(to)
		} catch (err) {
			throw new HttpError(400, err.message)
		}
		if (isJidGroup(jid)) throw new HttpError(400, 'Las listas son para personas; para un grupo de WhatsApp programa el mensaje directo al grupo.')
		store.db.prepare('INSERT OR REPLACE INTO wa_list_members (list_id, chat_jid, name) VALUES (?, ?, ?)').run(params.id, jid, store.displayName(jid))
		return waLists().find((l) => l.id === Number(params.id))
	},

	'DELETE /api/wa-lists/:id/members/:jid': async ({ params }) => {
		store.db.prepare('DELETE FROM wa_list_members WHERE list_id = ? AND chat_jid = ?').run(params.id, params.jid)
		return waLists().find((l) => l.id === Number(params.id))
	},

	// Ritmo de envio de las listas.
	'GET /api/broadcast-pace': async () => getPace(store),
	'PUT /api/broadcast-pace': async ({ body }) => {
		try {
			const p = savePace(store, body)
			log(`ritmo de listas: ${JSON.stringify(p)}`)
			return p
		} catch (err) {
			throw new HttpError(400, err.message)
		}
	},

	'POST /api/mark-read': async ({ body }) => {
		if (wa.state !== 'open') throw new HttpError(503, `WhatsApp no esta conectado (estado: ${wa.state}).`)
		return { marked: await wa.markRead(store.resolveChat(String(body.chat))) }
	},
}

function match(method, path) {
	for (const [key, handler] of Object.entries(routes)) {
		const [m, pattern] = key.split(' ')
		if (m !== method) continue
		const names = []
		const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$')
		const found = path.match(re)
		if (found) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(found[i + 1])])) }
	}
	return null
}

const allowedHosts = new Set([`localhost:${panelPort}`, `127.0.0.1:${panelPort}`])
const assetsDir = join(root, 'public', 'assets')
const ASSET_TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const panelHtml = () => readFileSync(join(root, 'public', 'index.html'))

const server = createServer(async (req, res) => {
	const send = (status, body, type = 'application/json; charset=utf-8') => {
		res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
		res.end(type.startsWith('application/json') ? JSON.stringify(body) : body)
	}
	// Defensa contra DNS rebinding: solo atendemos peticiones dirigidas a localhost.
	if (!allowedHosts.has(req.headers.host)) return send(403, { error: 'Host no permitido' })

	const url = new URL(req.url, `http://${req.headers.host}`)
	if (req.method === 'GET' && url.pathname === '/') return send(200, panelHtml(), 'text/html; charset=utf-8')
	if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
		// Solo archivos dentro de public/assets (nada de "..").
		const file = resolve(assetsDir, '.' + decodeURIComponent(url.pathname.slice('/assets'.length)))
		const type = ASSET_TYPES[extname(file).toLowerCase()]
		if (!file.startsWith(assetsDir + sep) || !type || !existsSync(file)) return send(404, { error: 'No encontrado' })
		res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
		return res.end(readFileSync(file))
	}
	if (!url.pathname.startsWith('/api/')) return send(404, { error: 'No encontrado' })

	// Audio del microfono del panel -> texto (Whisper local). Exige la cabecera propia, igual que las escrituras.
	if (req.method === 'POST' && url.pathname === '/api/transcribe') {
		if (req.headers['x-panel'] !== '1' || !String(req.headers['content-type']).startsWith('audio/')) return send(403, { error: 'Peticion no permitida' })
		try {
			const chunks = []
			let size = 0
			for await (const c of req) {
				size += c.length
				if (size > 25 * 1024 * 1024) return send(413, { error: 'El audio es demasiado largo.' })
				chunks.push(c)
			}
			return send(200, { text: await transcribe(Buffer.concat(chunks)) })
		} catch (err) {
			log(`transcripcion del panel: ${err.message}`)
			return send(500, { error: 'No se pudo transcribir el audio.' })
		}
	}

	// Asistente: respuesta en streaming (una linea JSON por evento) mientras Claude trabaja.
	if (req.method === 'POST' && url.pathname === '/api/assistant') {
		if (req.headers['x-panel'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) return send(403, { error: 'Peticion no permitida' })
		let raw = ''
		for await (const c of req) raw += c
		let body
		try {
			body = JSON.parse(raw || '{}')
		} catch {
			return send(400, { error: 'JSON invalido' })
		}
		const message = String(body.message ?? '').trim()
		if (!message) return send(400, { error: 'Escribe un mensaje.' })
		res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
		const write = (ev) => res.write(JSON.stringify(ev) + '\n')
		const stop = assistant.run(message, body.session || null, (ev) => {
			write(ev)
			if (ev.type === 'done' || ev.type === 'error') res.end()
		})
		res.on('close', () => { if (!res.writableEnded) stop() })
		return
	}

	// Las escrituras exigen JSON y una cabecera propia: un sitio web ajeno no puede mandarlas
	// sin una verificacion CORS previa, que este servidor nunca aprueba.
	if (req.method !== 'GET' && (req.headers['x-panel'] !== '1' || !String(req.headers['content-type']).startsWith('application/json'))) {
		return send(403, { error: 'Peticion no permitida' })
	}

	const route = match(req.method, url.pathname)
	if (!route) return send(404, { error: 'No encontrado' })
	try {
		let body = {}
		if (req.method !== 'GET') {
			let raw = ''
			for await (const chunk of req) raw += chunk
			body = raw ? JSON.parse(raw) : {}
		}
		send(200, await route.handler({ params: route.params, query: url.searchParams, body }))
	} catch (err) {
		if (!(err instanceof HttpError)) log(`error en ${req.method} ${url.pathname}: ${err.stack ?? err}`)
		send(err.status ?? 500, { error: err.message })
	}
})

server.on('error', (err) => {
	if (err.code === 'EADDRINUSE') log(`el puerto ${panelPort} ya esta en uso: ¿el servicio ya esta corriendo?`)
	else log(`error del servidor: ${err.stack ?? err}`)
	process.exit(1)
})

new VoiceReminders({ store, wa, log, createScheduled, email })

server.listen(panelPort, '127.0.0.1', () => {
	log(`panel en http://localhost:${panelPort}`)
	scheduler.start()
	if (wa.isLinked()) wa.connect().catch((err) => log(`error al conectar: ${err.stack ?? err}`))
})

// Un error suelto de Baileys no debe tumbar el servicio (y con el los envios programados).
process.on('unhandledRejection', (err) => log(`promesa rechazada sin manejar: ${err?.stack ?? err}`))
process.on('uncaughtException', (err) => log(`excepcion sin manejar: ${err?.stack ?? err}`))

const shutdown = () => {
	scheduler.stop()
	wa.close()
	server.close()
	setTimeout(() => process.exit(0), 500)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
