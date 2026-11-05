// Avisos de paginas web propias (p. ej. reservas de un Apps Script): cada minuto pregunta por avisos nuevos y los
// manda a tu WhatsApp. La pagina no puede llamar a BuhoChat (vive en tu PC, sin acceso desde internet), por eso
// BuhoChat consulta: GET <url>?avisos&clave=...&desde=<ultimo id> -> { ok, ultimo, avisos: [{ id, tipo, nombre, dia, fecha, hora, antes }] }
import { jidNormalizedUser } from 'baileys'

const EVERY_MS = 60_000

const fechaLarga = (f) => {
	const d = new Date(`${f}T12:00:00`)
	return Number.isNaN(d.getTime()) ? f : d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function textoAviso(a, fuente) {
	const cuando = `${fechaLarga(a.fecha)}, ${a.hora}`
	const de = fuente ? ` (${fuente})` : ''
	if (a.tipo === 'nueva') return `📅 *Nueva reservación*${de}\n👤 ${a.nombre}\n🗓️ ${cuando}`
	// "antes" llega como "Jueves 2026-11-06 16:20": se muestra igual que la fecha nueva.
	const antes = String(a.antes ?? '').replace(/^\S+\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/, (m, f, h) => `${fechaLarga(f)}, ${h}`)
	if (a.tipo === 'cambio') return `🔁 *Cambio de reservación*${de}\n👤 ${a.nombre}\n🗓️ Ahora: ${cuando}${antes ? `\n↩️ Antes: ${antes}` : ''}`
	if (a.tipo === 'cancelada') return `❌ *Reservación cancelada*${de}\n👤 ${a.nombre}\n🗓️ ${cuando}`
	if (a.tipo === 'liberada') return `❌ *Turno liberado por el profesor*${de}\n👤 ${a.nombre}\n🗓️ ${cuando}`
	return `📅 *Aviso*${de}: ${a.tipo} · ${a.nombre} · ${cuando}`
}

export class WebAvisos {
	constructor({ store, wa, log }) {
		Object.assign(this, { store, wa, log })
		this.busy = false
		this.timer = setInterval(() => this.tick().catch((err) => this.log(`avisos: ${err.message}`)), EVERY_MS)
	}

	sources() {
		try {
			return JSON.parse(this.store.db.prepare(`SELECT value FROM meta WHERE key = 'web_avisos'`).get()?.value ?? '[]')
		} catch {
			return []
		}
	}

	save(list) {
		this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('web_avisos', ?)`).run(JSON.stringify(list))
	}

	// Agrega o actualiza una fuente. Empieza desde el ultimo aviso que ya exista, para no mandar lo viejo.
	async add({ name, url, clave }) {
		if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(url))) throw new Error('La dirección debe ser la de una aplicación web de Apps Script (termina en /exec).')
		const r = await this.fetch({ url, clave }, 0)
		const list = this.sources().filter((s) => s.url !== url)
		list.push({ name: String(name || 'Reservas'), url, clave, ultimo: r.ultimo ?? 0 })
		this.save(list)
		return { name, ultimo: r.ultimo ?? 0 }
	}

	async fetch(src, desde) {
		const u = `${src.url}?avisos&clave=${encodeURIComponent(src.clave)}&desde=${desde}`
		const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
		const text = await res.text()
		let data
		try {
			data = JSON.parse(text)
		} catch {
			throw new Error(`respuesta inesperada (${res.status})`)
		}
		if (!data.ok) throw new Error(data.error ?? 'error')
		return data
	}

	target() {
		const to = process.env.REMINDER_TO
		if (to) return to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`
		return jidNormalizedUser((this.wa.sock?.user ?? this.wa.me).id)
	}

	async tick() {
		if (this.busy || this.wa.state !== 'open') return
		this.busy = true
		try {
			const list = this.sources()
			let changed = false
			for (const src of list) {
				let data
				try {
					data = await this.fetch(src, src.ultimo ?? 0)
				} catch (err) {
					this.log(`avisos ${src.name}: ${err.message}`)
					continue
				}
				for (const a of data.avisos.sort((x, y) => x.id - y.id)) {
					const text = textoAviso(a, src.name)
					const send = () => this.wa.send(this.target(), text)
					await (this.alert ? this.alert.send('reservas', text, send) : send())
					src.ultimo = a.id // se guarda aviso por aviso: si algo falla, no se repite lo ya enviado
					changed = true
					this.save(list)
					this.log(`avisos ${src.name}: ${a.tipo} de ${a.nombre} (${a.fecha} ${a.hora})`)
				}
			}
			if (changed) this.save(list)
		} finally {
			this.busy = false
		}
	}
}
