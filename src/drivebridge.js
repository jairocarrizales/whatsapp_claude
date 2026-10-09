// Sube a Google Drive las imagenes y PDF recibidos por WhatsApp, usando como puente
// una aplicacion web de Apps Script (apps-script/Code.gs) que corre con la cuenta del usuario.
import { BufferJSON, downloadMediaMessage, isJidGroup } from 'baileys'
import { randomBytes } from 'node:crypto'

const TICK_MS = 15_000
const MAX_ATTEMPTS = 6
const MAX_BYTES = 35 * 1024 * 1024 // Apps Script admite ~50 MB por peticion (base64 agrega ~33 %)
const DEFAULTS = { enabled: false, url: '', types: ['image', 'pdf'], personal: true, groups: [] }

export class DriveBridge {
	constructor({ store, wa, log }) {
		this.store = store
		this.wa = wa
		this.log = log
		this.busy = false
		store.db.exec(`
			CREATE TABLE IF NOT EXISTS drive_uploads (
				msg_id TEXT PRIMARY KEY,
				chat_jid TEXT NOT NULL,
				chat_name TEXT,
				ts INTEGER NOT NULL,
				filename TEXT,
				status TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
				attempts INTEGER NOT NULL DEFAULT 0,
				next_at INTEGER NOT NULL DEFAULT 0,
				error TEXT,
				file_url TEXT,
				updated_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_drive_uploads_status ON drive_uploads (status, next_at);
		`)
		for (const col of ['custom_name', 'custom_path']) {
			if (!store.db.prepare(`SELECT 1 FROM pragma_table_info('drive_uploads') WHERE name = ?`).get(col)) store.db.exec(`ALTER TABLE drive_uploads ADD COLUMN ${col} TEXT`)
		}
		wa.on((event, m) => event === 'message' && this.onMessage(m))
		this.timer = setInterval(() => this.tick(), TICK_MS)
	}

	config() {
		const raw = this.store.db.prepare(`SELECT value FROM meta WHERE key = 'drive_bridge'`).get()?.value
		const c = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) }
		// La clave secreta se genera una vez; se pega en el script de Apps Script.
		if (!c.secret) {
			c.secret = randomBytes(24).toString('base64url')
			this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('drive_bridge', ?)`).run(JSON.stringify(c))
		}
		return c
	}

	save(input) {
		const c = this.config()
		const next = {
			...c,
			enabled: input.enabled !== undefined ? Boolean(input.enabled) : c.enabled,
			url: input.url !== undefined ? String(input.url).trim() : c.url,
			types: Array.isArray(input.types) ? input.types.filter((t) => ['image', 'pdf'].includes(t)) : c.types,
			personal: input.personal !== undefined ? Boolean(input.personal) : c.personal,
			groups: Array.isArray(input.groups) ? [...new Set(input.groups.map(String))] : c.groups,
		}
		if (next.url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(next.url)) {
			throw new Error('La URL debe ser la de la aplicación web de Apps Script (https://script.google.com/macros/s/…/exec).')
		}
		if (next.enabled && !next.url) throw new Error('Pega primero la URL de la aplicación web.')
		this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('drive_bridge', ?)`).run(JSON.stringify(next))
		return next
	}

	// Que mensajes se suben: tipo (imagen / PDF) y chat (personales y grupos elegidos).
	matches(c, chatJid, type, content) {
		const isPdf = type === 'documentMessage' && /pdf/i.test(content?.mimetype ?? content?.fileName ?? '')
		const okType = (type === 'imageMessage' && c.types.includes('image')) || (isPdf && c.types.includes('pdf'))
		if (!okType) return false
		if (chatJid === 'status@broadcast') return false
		return isJidGroup(chatJid) ? c.groups.includes(chatJid) : c.personal
	}

	onMessage(m) {
		try {
			const c = this.config()
			if (!c.enabled || !c.url || m.key?.fromMe) return
			const chatJid = this.store.canon(m.key.remoteJid)
			const row = this.store.db.prepare(`SELECT type, raw, ts FROM messages WHERE chat_jid = ? AND id = ?`).get(chatJid, m.key.id)
			if (!row) return
			const content = JSON.parse(row.raw, BufferJSON.reviver)[row.type]
			if (!this.matches(c, chatJid, row.type, content)) return
			this.enqueue(chatJid, m.key.id, row.ts)
		} catch (err) {
			this.log(`drive: ${err.message}`)
		}
	}

	enqueue(chatJid, msgId, ts) {
		this.store.db
			.prepare(`INSERT OR IGNORE INTO drive_uploads (msg_id, chat_jid, chat_name, ts, updated_at) VALUES (?, ?, ?, ?, ?)`)
			.run(msgId, chatJid, this.store.displayName(chatJid), ts, Math.floor(Date.now() / 1000))
	}

	// Pone en cola lo recibido en los ultimos `days` dias que cumpla los filtros (para subir lo anterior).
	backfill(days) {
		const c = this.config()
		const since = Math.floor(Date.now() / 1000) - Math.max(1, Math.min(Number(days) || 1, 90)) * 86400
		const rows = this.store.db
			.prepare(`SELECT chat_jid, id, ts, type, raw FROM messages WHERE from_me = 0 AND ts >= ? AND type IN ('imageMessage', 'documentMessage')`)
			.all(since)
		let n = 0
		for (const r of rows) {
			const content = JSON.parse(r.raw, BufferJSON.reviver)[r.type]
			if (!this.matches(c, r.chat_jid, r.type, content)) continue
			const before = this.store.db.prepare('SELECT 1 FROM drive_uploads WHERE msg_id = ?').get(r.id)
			if (!before) { this.enqueue(r.chat_jid, r.id, r.ts); n++ }
		}
		this.tick()
		return n
	}

	/**
	 * Sube todas las fotos (y opcionalmente PDF) de un chat: carpeta por mes y nombre por dia
	 * ("Lunes 13 jul 2026.jpg"; si hay varias ese dia, " - 1", " - 2"...). Funciona aunque la subida automatica este apagada.
	 */
	uploadChat(chatJid, { types = ['image'], from = 'all' } = {}) {
		const c = this.config()
		if (!c.url) throw new Error('Primero conecta Google Drive en Ajustes.')
		const kinds = []
		if (types.includes('image')) kinds.push("type = 'imageMessage'")
		if (types.includes('pdf')) kinds.push("(type = 'documentMessage' AND raw LIKE '%pdf%')")
		if (!kinds.length) throw new Error('Elige imágenes y/o PDF.')
		const who = from === 'them' ? 'AND from_me = 0' : from === 'me' ? 'AND from_me = 1' : ''
		const rows = this.store.db.prepare(`SELECT id, ts, type, raw FROM messages WHERE chat_jid = ? AND (${kinds.join(' OR ')}) ${who} ORDER BY ts`).all(chatJid)
		const chatName = this.store.displayName(chatJid)
		const pad = (n) => String(n).padStart(2, '0')
		const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
		const perDay = {}
		for (const r of rows) { const k = dayKey(new Date(r.ts * 1000)); perDay[k] = (perDay[k] ?? 0) + 1 }
		const seen = {}
		const upsert = this.store.db.prepare(`
			INSERT INTO drive_uploads (msg_id, chat_jid, chat_name, ts, status, attempts, next_at, custom_name, custom_path, updated_at)
			VALUES (?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?)
			ON CONFLICT(msg_id) DO UPDATE SET status = 'pending', attempts = 0, next_at = 0, error = NULL,
				custom_name = excluded.custom_name, custom_path = excluded.custom_path, updated_at = excluded.updated_at`)
		this.store.tx(() => {
			for (const r of rows) {
				const d = new Date(r.ts * 1000)
				const k = dayKey(d)
				seen[k] = (seen[k] ?? 0) + 1
				const wd = d.toLocaleDateString('es-MX', { weekday: 'long' })
				const mon = d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')
				const content = JSON.parse(r.raw, BufferJSON.reviver)[r.type] ?? {}
				const ext = r.type === 'documentMessage' ? 'pdf' : /png/.test(content.mimetype) ? 'png' : /webp/.test(content.mimetype) ? 'webp' : 'jpg'
				const base = `${wd[0].toUpperCase()}${wd.slice(1)} ${d.getDate()} ${mon} ${d.getFullYear()}`
				const name = `${base}${perDay[k] > 1 ? ` - ${seen[k]}` : ''}.${ext}`
				upsert.run(r.id, chatJid, chatName, r.ts, name, JSON.stringify([chatName, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`]), Math.floor(Date.now() / 1000))
			}
		})
		this.tick(true)
		return { chat: chatName, queued: rows.length }
	}

	async post(body) {
		const c = this.config()
		const res = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, secret: c.secret }), redirect: 'follow' })
		const text = await res.text()
		let data
		try {
			data = JSON.parse(text)
		} catch {
			throw new Error(/<html/i.test(text) ? 'Apps Script respondió con una página HTML: revisa que la implementación sea "Aplicación web" con acceso "Cualquier persona".' : `respuesta inesperada (${res.status})`)
		}
		if (!data.ok) throw new Error(data.error === 'no autorizado' ? 'La clave secreta del script no coincide con la de BuhoChat.' : data.error)
		return data
	}

	test() {
		return this.post({ action: 'ping' })
	}

	async tick() {
		const c = this.config()
		if (this.busy || !c.url || this.wa.state !== 'open') return
		this.busy = true
		try {
			const now = Math.floor(Date.now() / 1000)
			const rows = this.store.db.prepare(`SELECT * FROM drive_uploads WHERE status = 'pending' AND next_at <= ? ORDER BY ts LIMIT 10`).all(now)
			for (const u of rows) await this.upload(u)
		} finally {
			this.busy = false
		}
	}

	async upload(u) {
		const now = () => Math.floor(Date.now() / 1000)
		const set = (fields) => {
			const keys = Object.keys(fields)
			this.store.db.prepare(`UPDATE drive_uploads SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE msg_id = ?`).run(...keys.map((k) => fields[k]), now(), u.msg_id)
		}
		try {
			const row = this.store.db.prepare(`SELECT * FROM messages WHERE chat_jid = ? AND id = ?`).get(u.chat_jid, u.msg_id)
			if (!row) throw new Error('el mensaje ya no está en la base local')
			const message = JSON.parse(row.raw, BufferJSON.reviver)
			const content = message[row.type] ?? {}
			const buf = await downloadMediaMessage({ key: { remoteJid: u.chat_jid, id: u.msg_id, fromMe: false }, message }, 'buffer', {}, { reuploadRequest: this.wa.sock.updateMediaMessage })
			if (buf.length > MAX_BYTES) throw Object.assign(new Error('archivo demasiado grande para Apps Script (más de 35 MB)'), { permanent: true })

			const d = new Date(row.ts * 1000)
			const pad = (n) => String(n).padStart(2, '0')
			const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
			const isDoc = row.type === 'documentMessage'
			const filename = isDoc && content.fileName ? `${stamp}_${content.fileName}` : `${stamp}_${u.msg_id.slice(-6)}.${/png/.test(content.mimetype) ? 'png' : /webp/.test(content.mimetype) ? 'webp' : 'jpg'}`
			const chatName = this.store.displayName(u.chat_jid)
			const senderName = isJidGroup(u.chat_jid) ? (this.store.displayName(row.sender) ?? row.push_name ?? '') : chatName
			const description = [
				`De: ${senderName}${this.store.phoneFor(row.sender) ? ` (${this.store.phoneFor(row.sender)})` : ''}${isJidGroup(u.chat_jid) ? ` en el grupo ${chatName}` : ''}`,
				`Fecha: ${d.toLocaleString('es-MX')}`,
				content.caption ? `Texto: ${content.caption}` : null,
				'Guardado por BuhoChat',
			].filter(Boolean).join('\n')

			const path = u.custom_path ? JSON.parse(u.custom_path) : [chatName, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`]
			const finalName = u.custom_name || filename
			const r = await this.post({ path, filename: finalName, mimeType: content.mimetype || 'application/octet-stream', data: buf.toString('base64'), description })
			set({ status: 'done', filename: finalName, file_url: r.url, error: null })
			this.log(`drive: ${finalName} de ${chatName} subido`)
		} catch (err) {
			const attempts = u.attempts + 1
			const failed = err.permanent || attempts >= MAX_ATTEMPTS
			// Reintentos con espera creciente: 1, 2, 4, 8, 16 min.
			set({ status: failed ? 'failed' : 'pending', attempts, next_at: now() + 60 * 2 ** (attempts - 1), error: err.message })
			this.log(`drive: fallo ${u.msg_id} (${attempts}/${MAX_ATTEMPTS}): ${err.message}`)
		}
	}

	recent(limit = 30) {
		return this.store.db.prepare(`SELECT * FROM drive_uploads ORDER BY ts DESC LIMIT ?`).all(limit)
	}

	retryFailed() {
		return this.store.db.prepare(`UPDATE drive_uploads SET status = 'pending', attempts = 0, next_at = 0 WHERE status = 'failed'`).run().changes
	}
}
