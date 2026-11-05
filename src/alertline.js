// Linea de avisos: un segundo WhatsApp (otro telefono) que solo envia notificaciones de BuhoChat a tu numero
// principal. Asi te llegan como mensaje de otra persona y suenan, cosa que no pasa con tu propio chat.
// Tu eliges que avisos salen por aqui; si la linea no esta conectada, salen por tu WhatsApp principal como siempre.
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { jidNormalizedUser } from 'baileys'
import { openStore } from './store.js'
import { WhatsApp } from './whatsapp.js'

export const ALERT_KINDS = {
	reservas: 'Reservaciones de tus páginas',
	recordatorios: 'Recordatorios',
	seguimientos: 'Seguimientos (cuando alguien cumple o no responde)',
}
const DEFAULT_ROUTES = { reservas: true, recordatorios: false, seguimientos: false }

export class AlertLine {
	constructor({ dataDir, store, mainWa, log }) {
		Object.assign(this, { store, mainWa, log })
		const dir = join(dataDir, 'linea-avisos')
		mkdirSync(dir, { recursive: true })
		this.wa = new WhatsApp({ dataDir: dir, store: openStore(join(dir, 'whatsapp.db')), syncHistory: false })
		this.wa.on((event, data) => {
			if (event === 'open') this.log(`linea de avisos conectada como ${data.name ?? data.id}`)
			if (event === 'logged_out') this.log('linea de avisos: la sesion se cerro desde el telefono')
		})
		if (this.wa.isLinked()) this.wa.connect().catch((err) => this.log(`linea de avisos: ${err.message}`))
	}

	routes() {
		try {
			return { ...DEFAULT_ROUTES, ...JSON.parse(this.store.db.prepare(`SELECT value FROM meta WHERE key = 'alert_line'`).get()?.value ?? '{}') }
		} catch {
			return { ...DEFAULT_ROUTES }
		}
	}

	setRoutes(input) {
		const next = this.routes()
		for (const k of Object.keys(ALERT_KINDS)) if (input[k] !== undefined) next[k] = Boolean(input[k])
		this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('alert_line', ?)`).run(JSON.stringify(next))
		return next
	}

	// Tu numero principal (a donde llegan los avisos).
	mainJid() {
		const me = this.mainWa.sock?.user ?? this.mainWa.me
		return me ? jidNormalizedUser(me.id) : null
	}

	ready() {
		return this.wa.state === 'open' && Boolean(this.mainJid())
	}

	// Manda un aviso del tipo `kind` por la linea de avisos si asi lo elegiste y esta conectada; si no, usa `fallback`.
	async send(kind, text, fallback) {
		if (this.routes()[kind] && this.ready()) {
			try {
				await this.wa.send(this.mainJid(), text)
				return 'linea'
			} catch (err) {
				this.log(`linea de avisos: no se pudo enviar (${err.message}); va por tu WhatsApp principal`)
			}
		}
		await fallback()
		return 'principal'
	}

	status() {
		const me = this.wa.sock?.user ?? this.wa.me
		return {
			state: this.wa.state,
			linked: this.wa.isLinked(),
			number: me ? '+' + jidNormalizedUser(me.id).split('@')[0] : null,
			name: me?.name ?? null,
			qr: this.wa.state === 'qr' ? this.wa.qr : null,
			routes: this.routes(),
			kinds: ALERT_KINDS,
		}
	}

	connect() {
		return this.wa.connect()
	}

	async unlink() {
		await this.wa.logout()
	}
}
