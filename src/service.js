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
import { KIND_LABEL, parseDriveUrl } from './drive.js'

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

function createScheduled({ chat_jid, chat_name, text, send_at, repeat, created_by, transcript = null }) {
	const { lastInsertRowid } = store.db
		.prepare(`INSERT INTO scheduled (chat_jid, chat_name, text, send_at, repeat, created_at, created_by, transcript) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(chat_jid, chat_name, text, send_at, repeat, now(), created_by, transcript)
	log(`programado #${lastInsertRowid} (${created_by}) para ${chat_name} el ${new Date(send_at * 1000).toLocaleString('es-MX')}`)
	return store.db.prepare('SELECT * FROM scheduled WHERE id = ?').get(lastInsertRowid)
}

function parseResource(body) {
	const name = String(body.name ?? '').trim()
	if (!name) throw new HttpError(400, 'Ponle un nombre.')
	const parsed = parseDriveUrl(body.url)
	if (!parsed) throw new HttpError(400, 'La URL no es de Google Drive, Docs, Sheets o Slides.')
	let chat_jid = null
	let chat_name = null
	if (body.to) {
		try {
			chat_jid = store.resolveChat(String(body.to))
		} catch (err) {
			throw new HttpError(400, err.message)
		}
		chat_name = store.displayName(chat_jid)
	}
	const notes = String(body.notes ?? '').trim() || null
	return { name, url: String(body.url).trim(), kind: parsed.kind, drive_id: parsed.driveId, chat_jid, chat_name, notes }
}

const resourceRow = (r) => ({ ...r, kind_label: KIND_LABEL[r.kind], created_at: new Date(r.created_at * 1000).toISOString() })

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
		const s = await parseSchedule(body)
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

	// ---- Ajustes: documentos de Drive ----
	'GET /api/resources': async ({ query }) => {
		const q = (query.get('q') ?? '').trim()
		const rows = q
			? store.db
					.prepare(`SELECT * FROM resources WHERE name LIKE ? OR chat_name LIKE ? OR notes LIKE ? OR chat_jid = ? ORDER BY name`)
					.all(`%${q}%`, `%${q}%`, `%${q}%`, store.canon(q))
			: store.db.prepare(`SELECT * FROM resources ORDER BY chat_name IS NULL, chat_name, name`).all()
		return rows.map(resourceRow)
	},

	'POST /api/resources': async ({ body }) => {
		const r = parseResource(body)
		const { lastInsertRowid } = store.db
			.prepare(`INSERT INTO resources (name, url, kind, drive_id, chat_jid, chat_name, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
			.run(r.name, r.url, r.kind, r.drive_id, r.chat_jid, r.chat_name, r.notes, now())
		log(`documento registrado #${lastInsertRowid}: ${r.name}`)
		return resourceRow(store.db.prepare('SELECT * FROM resources WHERE id = ?').get(lastInsertRowid))
	},

	'PATCH /api/resources/:id': async ({ params, body }) => {
		const row = store.db.prepare('SELECT * FROM resources WHERE id = ?').get(params.id)
		if (!row) throw new HttpError(404, 'No existe ese documento.')
		const r = parseResource({ ...resourceRow(row), to: row.chat_jid, ...body })
		store.db
			.prepare(`UPDATE resources SET name = ?, url = ?, kind = ?, drive_id = ?, chat_jid = ?, chat_name = ?, notes = ? WHERE id = ?`)
			.run(r.name, r.url, r.kind, r.drive_id, r.chat_jid, r.chat_name, r.notes, row.id)
		return resourceRow(store.db.prepare('SELECT * FROM resources WHERE id = ?').get(row.id))
	},

	'DELETE /api/resources/:id': async ({ params }) => {
		const { changes } = store.db.prepare('DELETE FROM resources WHERE id = ?').run(params.id)
		if (!changes) throw new HttpError(404, 'No existe ese documento.')
		return { ok: true }
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

new VoiceReminders({ store, wa, log, createScheduled })

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
