// Seguimientos: esperar algo de una persona (fotos, un documento, una respuesta), recordarle a una hora
// cada dia hasta que cumpla y, opcionalmente, revisar con IA que lo recibido sea lo que se pidio.
import { BufferJSON, jidNormalizedUser } from 'baileys'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { personalize } from './broadcast.js'

const TICK_MS = 60_000
const SETTLE_S = 120 // espera tras el ultimo archivo recibido antes de revisar (por si manda varios)
const EXPECT_TYPES = {
	image: ['imageMessage'],
	document: ['documentMessage'],
	media: ['imageMessage', 'documentMessage', 'videoMessage'],
	any: null, // cualquier mensaje con contenido
}
export const EXPECT_LABEL = { image: 'fotos', document: 'un documento', media: 'fotos o documentos', any: 'una respuesta' }

export class Followups {
	constructor({ store, wa, log, dataDir, verify }) {
		this.store = store
		this.wa = wa
		this.log = log
		this.dir = join(dataDir, 'followups')
		this.verify = verify // async ({ request, name, dir }) => { cumple, motivo }
		this.busy = false
		store.db.exec(`
			CREATE TABLE IF NOT EXISTS followups (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				chat_jid TEXT NOT NULL,
				chat_name TEXT,
				request TEXT NOT NULL,          -- lo que se espera, en palabras del usuario
				expect TEXT NOT NULL DEFAULT 'image',
				ai_check INTEGER NOT NULL DEFAULT 1,
				remind_time TEXT NOT NULL DEFAULT '17:00',
				reminder_text TEXT NOT NULL,
				max_reminders INTEGER NOT NULL DEFAULT 3,
				weekdays_only INTEGER NOT NULL DEFAULT 0,
				reminders_sent INTEGER NOT NULL DEFAULT 0,
				last_reminder_day TEXT,
				start_ts INTEGER NOT NULL,
				checked_ts INTEGER NOT NULL,    -- hasta donde ya se revisaron mensajes
				status TEXT NOT NULL DEFAULT 'active', -- active | done | expired | cancelled
				verdict TEXT,
				evidence TEXT,                  -- JSON: ids de los mensajes que cumplieron
				done_at INTEGER,
				created_at INTEGER NOT NULL
			);
		`)
		this.timer = setInterval(() => this.tick(), TICK_MS)
	}

	now() {
		return Math.floor(Date.now() / 1000)
	}

	selfJid() {
		const me = this.wa.sock?.user ?? this.wa.me
		return me ? jidNormalizedUser(me.id) : null
	}

	async notifyMe(text) {
		const me = this.selfJid()
		if (me && this.wa.state === 'open') await this.wa.send(me, text).catch((err) => this.log(`seguimiento: no se pudo avisar: ${err.message}`))
	}

	get(id) {
		return this.store.db.prepare('SELECT * FROM followups WHERE id = ?').get(id)
	}

	list() {
		return this.store.db.prepare(`SELECT * FROM followups ORDER BY status = 'active' DESC, created_at DESC LIMIT 100`).all()
	}

	async create(input) {
		const { chat_jid, request } = input
		const expect = EXPECT_TYPES[input.expect] !== undefined ? input.expect : 'image'
		const remind = /^\d{1,2}:\d{2}$/.test(input.remind_time ?? '') ? input.remind_time.padStart(5, '0') : '17:00'
		const name = this.store.displayName(chat_jid)
		const reminder = String(input.reminder_text || `Hola {nombre}, te recuerdo: ${request}. ¡Gracias!`)
		const ts = this.now()
		const { lastInsertRowid } = this.store.db
			.prepare(`INSERT INTO followups (chat_jid, chat_name, request, expect, ai_check, remind_time, reminder_text, max_reminders, weekdays_only, start_ts, checked_ts, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.run(chat_jid, name, request, expect, input.ai_check === false ? 0 : 1, remind, reminder, Math.max(1, Math.min(Number(input.max_reminders) || 3, 30)), input.weekdays_only ? 1 : 0, ts, ts, ts)
		if (input.send_now && input.request_text) {
			await this.wa.send(chat_jid, personalize(String(input.request_text), name))
		}
		this.log(`seguimiento #${lastInsertRowid}: ${name} — ${request} (recordar ${remind}, max ${input.max_reminders ?? 3})`)
		return this.get(lastInsertRowid)
	}

	setStatus(id, status, verdict = null) {
		this.store.db.prepare('UPDATE followups SET status = ?, verdict = COALESCE(?, verdict), done_at = ? WHERE id = ?').run(status, verdict, status === 'active' ? null : this.now(), id)
		return this.get(id)
	}

	async remindNow(id) {
		const f = this.get(id)
		if (!f || f.status !== 'active') throw new Error('Ese seguimiento no está activo.')
		await this.sendReminder(f, true)
		return this.get(id)
	}

	async sendReminder(f, manual = false) {
		await this.wa.send(f.chat_jid, personalize(f.reminder_text, f.chat_name))
		const day = this.dayKey(new Date())
		this.store.db.prepare('UPDATE followups SET reminders_sent = reminders_sent + 1, last_reminder_day = ? WHERE id = ?').run(day, f.id)
		this.log(`seguimiento #${f.id}: recordatorio ${f.reminders_sent + 1}/${f.max_reminders} a ${f.chat_name}${manual ? ' (manual)' : ''}`)
	}

	dayKey(d) {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
	}

	// Mensajes de la persona desde la ultima revision que encajan con lo esperado.
	newEvidence(f) {
		const types = EXPECT_TYPES[f.expect]
		const typeSql = types ? `AND type IN (${types.map(() => '?').join(',')})` : `AND text IS NOT NULL AND type NOT IN ('reactionMessage')`
		return this.store.db
			.prepare(`SELECT id, ts, type, text, raw FROM messages WHERE chat_jid = ? AND from_me = 0 AND ts > ? ${typeSql} ORDER BY ts`)
			.all(f.chat_jid, f.checked_ts, ...(types ?? []))
	}

	async tick() {
		if (this.busy || this.wa.state !== 'open') return
		this.busy = true
		try {
			for (const f of this.store.db.prepare(`SELECT * FROM followups WHERE status = 'active'`).all()) {
				try {
					await this.process(f)
				} catch (err) {
					this.log(`seguimiento #${f.id}: ${err.stack ?? err}`)
				}
			}
		} finally {
			this.busy = false
		}
	}

	async process(f) {
		const evidence = this.newEvidence(f)
		if (evidence.length) {
			const last = evidence.at(-1).ts
			// Espera a que termine de enviar (varias fotos seguidas) antes de revisar.
			if (this.now() - last >= SETTLE_S) {
				const ok = await this.evaluate(f, evidence)
				this.store.db.prepare('UPDATE followups SET checked_ts = ? WHERE id = ?').run(last, f.id)
				if (ok) return
			} else return
		}

		// Recordatorio diario a la hora indicada.
		const now = new Date()
		const [h, m] = f.remind_time.split(':').map(Number)
		const due = new Date(now)
		due.setHours(h, m, 0, 0)
		const today = this.dayKey(now)
		const weekend = now.getDay() === 0 || now.getDay() === 6
		if (now >= due && f.last_reminder_day !== today && !(f.weekdays_only && weekend)) {
			// Si se creo despues de la hora de hoy, el primer recordatorio es manana.
			if (f.created_at * 1000 > due.getTime()) return
			if (f.reminders_sent >= f.max_reminders) {
				this.setStatus(f.id, 'expired', `Sin respuesta después de ${f.max_reminders} recordatorios.`)
				await this.notifyMe(`🔔 Seguimiento sin respuesta: *${f.chat_name}* no envió ${f.request} después de ${f.max_reminders} recordatorios.`)
				return
			}
			await this.sendReminder(f)
		}
	}

	// Devuelve true si el seguimiento quedo cumplido.
	async evaluate(f, evidence) {
		const ids = evidence.map((e) => e.id)
		const kinds = new Set(evidence.map((e) => e.type))
		const summary = `${evidence.length} ${kinds.has('imageMessage') && kinds.size === 1 ? (evidence.length === 1 ? 'foto' : 'fotos') : evidence.length === 1 ? 'mensaje' : 'mensajes'}`
		if (!f.ai_check || !this.verify) {
			this.done(f, ids, `Recibido: ${summary}.`)
			await this.notifyMe(`✅ Seguimiento cumplido: *${f.chat_name}* envió ${summary} (${f.request}).`)
			return true
		}
		// Guarda los archivos (o el texto) en una carpeta temporal y le pide a la IA que los revise.
		const dir = join(this.dir, String(f.id), String(this.now()))
		mkdirSync(dir, { recursive: true })
		try {
			for (const e of evidence) {
				if (['imageMessage', 'documentMessage', 'videoMessage'].includes(e.type)) {
					const message = JSON.parse(e.raw, BufferJSON.reviver)
					const content = message[e.type] ?? {}
					const ext = e.type === 'imageMessage' ? 'jpg' : e.type === 'videoMessage' ? 'mp4' : (content.fileName?.split('.').pop() || 'pdf')
					const buf = await this.wa.downloadMedia({ key: { remoteJid: f.chat_jid, id: e.id, fromMe: false }, message })
					writeFileSync(join(dir, `${e.id}.${ext}`), buf)
					if (content.caption) writeFileSync(join(dir, `${e.id}.texto.txt`), content.caption)
				} else if (e.text) {
					writeFileSync(join(dir, `${e.id}.texto.txt`), e.text)
				}
			}
			const v = await this.verify({ request: f.request, name: f.chat_name, dir })
			if (v.cumple) {
				this.done(f, ids, v.motivo)
				await this.notifyMe(`✅ Seguimiento cumplido: *${f.chat_name}* envió ${summary}. ${v.motivo}`)
				return true
			}
			this.store.db.prepare('UPDATE followups SET verdict = ? WHERE id = ?').run(`Recibido ${summary}, pero no parece lo pedido: ${v.motivo}`, f.id)
			await this.notifyMe(`🤔 *${f.chat_name}* envió ${summary}, pero no parece lo que pediste (${f.request}): ${v.motivo}. Sigo dándole seguimiento.`)
			return false
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}

	done(f, ids, verdict) {
		this.store.db.prepare(`UPDATE followups SET status = 'done', verdict = ?, evidence = ?, done_at = ? WHERE id = ?`).run(verdict, JSON.stringify(ids), this.now(), f.id)
		this.log(`seguimiento #${f.id}: cumplido por ${f.chat_name}`)
	}
}

