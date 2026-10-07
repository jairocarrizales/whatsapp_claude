// Almacen local (SQLite) de chats, contactos y mensajes.
// Baileys no guarda historial: todo lo que el MCP puede consultar vive aqui.
import { DatabaseSync } from 'node:sqlite'
import { jidNormalizedUser } from 'baileys'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function openStore(file) {
	mkdirSync(dirname(file), { recursive: true })
	const db = new DatabaseSync(file)
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 5000;
		CREATE TABLE IF NOT EXISTS chats (
			jid TEXT PRIMARY KEY,
			name TEXT,
			unread INTEGER DEFAULT 0,
			last_ts INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS contacts (
			jid TEXT PRIMARY KEY,
			name TEXT,
			notify TEXT,
			phone TEXT
		);
		CREATE TABLE IF NOT EXISTS lid_map (
			lid TEXT PRIMARY KEY,
			pn TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS messages (
			chat_jid TEXT NOT NULL,
			id TEXT NOT NULL,
			from_me INTEGER NOT NULL,
			sender TEXT,
			push_name TEXT,
			ts INTEGER NOT NULL,
			type TEXT,
			text TEXT,
			raw TEXT,
			PRIMARY KEY (chat_jid, id)
		);
		CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_jid, ts);
		CREATE TABLE IF NOT EXISTS scheduled (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_jid TEXT NOT NULL,
			chat_name TEXT,
			text TEXT NOT NULL,
			send_at INTEGER NOT NULL,
			repeat TEXT NOT NULL DEFAULT 'none', -- none | daily | weekdays | weekly
			status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | missed | cancelled
			last_error TEXT,
			created_at INTEGER NOT NULL,
			created_by TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled (status, send_at);
		CREATE TABLE IF NOT EXISTS scheduled_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			scheduled_id INTEGER NOT NULL,
			chat_name TEXT,
			text TEXT,
			at INTEGER NOT NULL,
			status TEXT NOT NULL, -- sent | failed | missed
			error TEXT
		);
		-- Documentos, hojas y carpetas de Drive registrados en Ajustes (los lee Claude con su conector).
		CREATE TABLE IF NOT EXISTS resources (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			kind TEXT NOT NULL, -- doc | sheet | slides | folder | file
			drive_id TEXT NOT NULL,
			chat_jid TEXT, -- chat de WhatsApp asociado (p. ej. el proveedor)
			chat_name TEXT,
			notes TEXT,
			created_at INTEGER NOT NULL
		);
	`)

	// node:sqlite no acepta undefined: un solo campo ausente haria fallar el INSERT.
	const prep = (sql) => {
		const st = db.prepare(sql)
		const fix = (args) => args.map((a) => (a === undefined ? null : a))
		return { run: (...a) => st.run(...fix(a)), get: (...a) => st.get(...fix(a)), all: (...a) => st.all(...fix(a)) }
	}

	// Migracion: transcripcion de los recordatorios creados por voz.
	if (!db.prepare(`SELECT 1 FROM pragma_table_info('scheduled') WHERE name = 'transcript'`).get()) {
		db.exec(`ALTER TABLE scheduled ADD COLUMN transcript TEXT`)
	}

	const q = {
		upsertChat: prep(`
			INSERT INTO chats (jid, name, unread, last_ts) VALUES (?, ?, ?, ?)
			ON CONFLICT(jid) DO UPDATE SET
				name = COALESCE(excluded.name, chats.name),
				unread = COALESCE(excluded.unread, chats.unread),
				last_ts = MAX(chats.last_ts, excluded.last_ts)`),
		upsertContact: prep(`
			INSERT INTO contacts (jid, name, notify, phone) VALUES (?, ?, ?, ?)
			ON CONFLICT(jid) DO UPDATE SET
				name = COALESCE(excluded.name, contacts.name),
				notify = COALESCE(excluded.notify, contacts.notify),
				phone = COALESCE(excluded.phone, contacts.phone)`),
		upsertLid: prep(`INSERT OR REPLACE INTO lid_map (lid, pn) VALUES (?, ?)`),
		upsertMessage: prep(`
			INSERT OR REPLACE INTO messages (chat_jid, id, from_me, sender, push_name, ts, type, text, raw)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		getMessageRaw: prep(`SELECT raw FROM messages WHERE chat_jid = ? AND id = ?`),
		pnForLid: prep(`SELECT pn FROM lid_map WHERE lid = ?`),
		lidForPn: prep(`SELECT lid FROM lid_map WHERE pn = ?`),
		contact: prep(`SELECT * FROM contacts WHERE jid = ?`),
		chat: prep(`SELECT * FROM chats WHERE jid = ?`),
	}

	const tx = (fn) => {
		db.exec('BEGIN')
		try {
			fn()
			db.exec('COMMIT')
		} catch (err) {
			db.exec('ROLLBACK')
			throw err
		}
	}

	return {
		db,
		tx,

		upsertChat({ jid, name = null, unread = null, lastTs = 0 }) {
			q.upsertChat.run(jid, name, unread, lastTs)
		},

		upsertContact({ jid, name = null, notify = null, phone = null }) {
			q.upsertContact.run(jid, name, notify, phone)
		},

		upsertLid(lid, pn) {
			if (lid && pn) q.upsertLid.run(lid, pn)
		},

		upsertMessage(m) {
			q.upsertMessage.run(m.chatJid, m.id, m.fromMe ? 1 : 0, m.sender, m.pushName, m.ts, m.type, m.text, m.raw)
		},

		getMessageRaw(chatJid, id) {
			return q.getMessageRaw.get(chatJid, id)?.raw ?? null
		},

		pnForLid: (lid) => q.pnForLid.get(lid)?.pn ?? null,
		lidForPn: (pn) => q.lidForPn.get(pn)?.lid ?? null,

		// Nombre legible para un jid: agenda > nombre del chat > nombre publico > numero.
		displayName(jid) {
			if (!jid) return null
			const ids = [jid]
			const pn = jid.endsWith('@lid') ? q.pnForLid.get(jid)?.pn : null
			const lid = jid.endsWith('@s.whatsapp.net') ? q.lidForPn.get(jid)?.lid : null
			if (pn) ids.push(pn)
			if (lid) ids.push(lid)
			for (const id of ids) {
				const c = q.contact.get(id)
				if (c?.name) return c.name
			}
			for (const id of ids) {
				const ch = q.chat.get(id)
				if (ch?.name) return ch.name
			}
			for (const id of ids) {
				const c = q.contact.get(id)
				if (c?.notify) return c.notify
			}
			const phoneJid = pn ?? (jid.endsWith('@s.whatsapp.net') ? jid : null)
			return phoneJid ? '+' + phoneJid.split('@')[0] : jid
		},

		// Forma canonica de un jid: los @lid se pasan a telefono si conocemos el mapeo.
		canon(jid) {
			if (!jid) return jid
			jid = jidNormalizedUser(jid)
			return jid.endsWith('@lid') ? (q.pnForLid.get(jid)?.pn ?? jid) : jid
		},

		// Chats cuyo nombre (de grupo, agenda o perfil) o numero coincide, por actividad reciente.
		searchChats(query, limit = 20) {
			const like = `%${query}%`
			const digits = query.replace(/\D/g, '')
			return db
				.prepare(`
					SELECT c.jid FROM chats c LEFT JOIN contacts k ON k.jid = c.jid
					WHERE c.name LIKE ? OR k.name LIKE ? OR k.notify LIKE ? OR (? <> '' AND c.jid LIKE ?)
					ORDER BY c.last_ts DESC LIMIT ?`)
				.all(like, like, like, digits, `%${digits}%`, limit)
				.map((r) => r.jid)
		},

		// Resuelve un chat dado como jid, telefono o nombre. Lanza si no hay coincidencia unica.
		resolveChat(chat) {
			if (chat.includes('@')) return this.canon(chat)
			const digits = chat.replace(/\D/g, '')
			if (digits.length >= 8 && /^[\d\s+()-]+$/.test(chat)) return `${digits}@s.whatsapp.net`
			const jids = this.searchChats(chat, 5)
			if (jids.length === 0) throw new Error(`No encontre ningun chat que coincida con "${chat}". Usa list_chats o search_contacts.`)
			if (jids.length > 1) {
				const exact = jids.find((j) => this.displayName(j).toLowerCase() === chat.toLowerCase())
				if (exact) return exact
				throw new Error(`"${chat}" es ambiguo: ${jids.map((j) => `${this.displayName(j)} (${j})`).join(', ')}. Indica el jid.`)
			}
			return jids[0]
		},

		phoneFor(jid) {
			if (!jid) return null
			if (jid.endsWith('@s.whatsapp.net')) return '+' + jid.split('@')[0]
			if (jid.endsWith('@lid')) {
				const pn = q.pnForLid.get(jid)?.pn
				return pn ? '+' + pn.split('@')[0] : null
			}
			return null
		},
	}
}
