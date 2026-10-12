// Al encender la PC: busca a quien te escribio y no esta en tu agenda, y lo guarda con su nombre en WhatsApp y en
// la agenda del telefono. El nombre sale del perfil de WhatsApp (pushName) o, si no hay, Claude lo deduce de la
// conversacion (si se presento, firmo o le hablas por su nombre). Al terminar te avisa en tu chat que nombres puso.
import { jidNormalizedUser } from 'baileys'

const START_DELAY_MS = 3 * 60_000 // deja que lleguen el historial y los nombres de perfil
const EVERY_MS = 24 * 3600_000 // si la PC queda encendida, una vez al dia
const FIRST_RUN_DAYS = 90 // la primera vez revisa los ultimos 90 dias
const BATCH = 8 // chats por consulta a Claude

// Nombre usable: con letras, sin ser un numero ni puro emoji. Si viene todo en minusculas, se capitaliza.
export function cleanName(raw) {
	let s = String(raw ?? '').replace(/\s+/g, ' ').trim()
	s = s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.)]+$/gu, '').trim()
	if ((s.match(/\p{L}/gu) ?? []).length < 2 || s.length > 40 || /^\+?[\d\s-]+$/.test(s)) return null
	if (s === s.toLowerCase()) s = s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
	return s
}

export class AutoNames {
	constructor({ store, wa, log, guess }) {
		Object.assign(this, { store, wa, log, guess })
		this.running = false
		this.started = false
		this.db = store.db
	}

	// Se llama al conectar; la primera vez programa la revision y luego una diaria.
	onOpen() {
		if (this.started || process.env.AUTONAMES === '0') return
		this.started = true
		setTimeout(() => this.run().catch((err) => this.log(`nombres: ${err.message}`)), START_DELAY_MS)
		setInterval(() => this.run().catch((err) => this.log(`nombres: ${err.message}`)), EVERY_MS)
	}

	meta(key, value) {
		if (value === undefined) return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
		this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value))
	}

	ids(jid) {
		return [jid, this.store.pnForLid(jid), this.store.lidForPn(jid)].filter(Boolean)
	}

	inAgenda(jid) {
		return this.ids(jid).some((id) => this.db.prepare('SELECT name FROM contacts WHERE jid = ?').get(id)?.name)
	}

	profileName(jid) {
		for (const id of this.ids(jid)) {
			const c = cleanName(this.db.prepare('SELECT notify FROM contacts WHERE jid = ?').get(id)?.notify)
			if (c) return c
			const m = this.db.prepare('SELECT push_name FROM messages WHERE chat_jid = ? AND from_me = 0 AND push_name IS NOT NULL ORDER BY ts DESC LIMIT 1').get(id)
			const p = cleanName(m?.push_name)
			if (p) return p
		}
		return null
	}

	// Chats personales con mensajes recibidos desde la ultima revision, que no estan en la agenda.
	candidates(since) {
		const tried = JSON.parse(this.meta('autonames_tried') ?? '{}')
		const rows = this.db.prepare(`SELECT chat_jid AS jid, MAX(ts) AS last_in FROM messages WHERE from_me = 0 AND ts > ?
			AND (chat_jid LIKE '%@s.whatsapp.net' OR chat_jid LIKE '%@lid') GROUP BY chat_jid ORDER BY last_in DESC`).all(since)
		const self = this.wa.sock?.user ? jidNormalizedUser(this.wa.sock.user.id) : null
		const seen = new Set()
		const out = []
		for (const r of rows) {
			const jid = this.store.canon(r.jid)
			if (seen.has(jid) || jid === self || !jid.endsWith('@s.whatsapp.net')) continue // un @lid sin numero no se puede guardar
			seen.add(jid)
			if (this.inAgenda(jid)) continue
			// Ya revisado sin poder deducir el nombre: solo se reintenta si escribio algo nuevo desde entonces.
			if (tried[jid] && tried[jid] >= r.last_in) continue
			out.push(jid)
		}
		return { list: out, tried }
	}

	conversation(jid) {
		const rows = this.db.prepare(`SELECT from_me, ts, text FROM messages WHERE chat_jid IN (${this.ids(jid).map(() => '?').join(',')})
			AND text IS NOT NULL AND text != '' ORDER BY ts DESC LIMIT 40`).all(...this.ids(jid))
		return rows.reverse().map((m) => `${m.from_me ? 'Yo' : 'Contacto'}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 220)}`).join('\n')
	}

	async run() {
		if (this.running || this.wa.state !== 'open') return
		this.running = true
		try {
			const now = Math.floor(Date.now() / 1000)
			const last = Number(this.meta('autonames_last') ?? 0)
			const since = last || now - FIRST_RUN_DAYS * 86400
			const { list, tried } = this.candidates(since)
			this.meta('autonames_last', now)
			if (!list.length) return

			const named = [] // { jid, name, how }
			const pending = []
			for (const jid of list) {
				const name = this.profileName(jid)
				if (name) named.push({ jid, name, how: 'nombre de perfil' })
				else pending.push(jid)
			}

			for (let i = 0; i < pending.length && this.guess; i += BATCH) {
				const batch = pending.slice(i, i + BATCH).map((jid, k) => ({ id: k + 1, jid, phone: '+' + jid.split('@')[0], chat: this.conversation(jid) }))
				let answers = []
				try {
					answers = await this.guess(batch.filter((b) => b.chat))
				} catch (err) {
					this.log(`nombres: la IA no respondio (${err.message})`)
				}
				for (const b of batch) {
					const a = answers.find((x) => Number(x.id) === b.id)
					const name = cleanName(a?.nombre)
					if (name) named.push({ jid: b.jid, name, how: a.motivo ? `por la conversación: ${a.motivo}` : 'por la conversación' })
					else tried[b.jid] = now
				}
			}

			const saved = []
			for (const n of named) {
				try {
					await this.wa.addContact({ phone: n.jid, name: n.name, saveToPhone: true })
					saved.push(n)
					this.log(`nombres: ${n.jid} -> ${n.name} (${n.how})`)
				} catch (err) {
					tried[n.jid] = now
					this.log(`nombres: no se pudo guardar ${n.jid}: ${err.message}`)
				}
				await new Promise((r) => setTimeout(r, 1500))
			}
			this.meta('autonames_tried', JSON.stringify(tried))

			const self = this.wa.sock?.user ? jidNormalizedUser(this.wa.sock.user.id) : null
			if (saved.length && self) {
				const lines = saved.map((n) => `• ${n.name} (${this.store.phoneFor(n.jid)}), ${n.how}`)
				const left = list.length - saved.length
				await this.wa
					.send(self, `📇 Agregué ${saved.length} ${saved.length === 1 ? 'contacto' : 'contactos'} a tu agenda:\n${lines.join('\n')}${left ? `\n\n${left} sin nombre claro; los reviso de nuevo si vuelven a escribir.` : ''}`)
					.catch((err) => this.log(`nombres: no se pudo avisar: ${err.message}`))
			}
		} finally {
			this.running = false
		}
	}
}
