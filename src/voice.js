// Recordatorios por WhatsApp: una nota de voz (o un texto) que te mandas a ti mismo,
// p. ej. "recuérdame mañana a las 8 pagar la luz", se convierte en un mensaje programado.
import { downloadMediaMessage, jidNormalizedUser, normalizeMessageContent } from 'baileys'
import { parseReminder } from './reminders.js'
import { transcribe, warmUp } from './transcribe.js'

const MAX_AGE_S = 10 * 60
const REPEAT_LABEL = { daily: 'Todos los días', weekdays: 'Lunes a viernes', weekly: 'Cada semana' }
const EXAMPLE = '«Recuérdame mañana a las 8 pagar la luz»'
// Prefijos de los mensajes que manda este modulo: nunca se reinterpretan.
const OWN_PREFIXES = ['✅', '⏰', '🤔', '⚠️']

export class VoiceReminders {
	constructor({ store, wa, log, createScheduled, download }) {
		this.download = download ?? ((m) => downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: wa.sock.updateMediaMessage }))
		this.store = store
		this.wa = wa
		this.log = log
		this.createScheduled = createScheduled
		this.seen = new Set()
		wa.on((event, data) => event === 'message' && this.handle(data).catch((err) => log(`recordatorio: ${err.stack ?? err}`)))
		// Precarga Whisper para que la primera nota no tarde.
		warmUp().then(() => log('transcripcion lista'), (err) => log(`no se pudo cargar Whisper: ${err.message}`))
	}

	// A donde llegan los recordatorios: tu propio chat, salvo que REMINDER_TO indique otro numero.
	target() {
		const to = process.env.REMINDER_TO
		if (to) return to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`
		const me = this.wa.sock?.user ?? this.wa.me
		return jidNormalizedUser(me.id)
	}

	isSelfChat(jid) {
		const self = this.wa.selfJids()
		return self.has(jidNormalizedUser(jid)) || self.has(this.store.canon(jid))
	}

	async handle(m) {
		const key = m.key
		if (!key?.fromMe || !key.remoteJid || !this.isSelfChat(key.remoteJid)) return
		if (this.seen.has(key.id)) return
		this.seen.add(key.id)
		const ts = Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0)
		if (Date.now() / 1000 - ts > MAX_AGE_S) return

		const content = normalizeMessageContent(m.message)
		let said
		let isVoice = false
		if (content?.audioMessage) {
			isVoice = true
			this.log('nota de voz recibida en tu chat; transcribiendo')
			const audio = await this.download(m)
			said = await transcribe(audio)
			this.log(`transcripcion: ${said}`)
		} else {
			said = content?.conversation ?? content?.extendedTextMessage?.text
			if (!said || OWN_PREFIXES.some((p) => said.startsWith(p))) return
		}

		const r = parseReminder(said)
		if (!r.ok) {
			// Un texto o una nota que no es un recordatorio (p. ej. un apunte para ti) se ignora.
			if (r.error === 'not-a-reminder') return
			const why = {
				'no-date': `No supe *cuándo*. Prueba con algo como ${EXAMPLE}.`,
				past: 'Esa hora ya pasó. Dime una fecha u hora futura.',
				'no-task': '¿Qué quieres que te recuerde? Di la hora y la tarea, por ejemplo ' + EXAMPLE + '.',
			}[r.error]
			return this.reply(`🤔 ${isVoice ? `Entendí: «${said}»\n\n` : ''}${why}`)
		}

		const to = this.target()
		const row = this.createScheduled({
			chat_jid: to,
			chat_name: to === jidNormalizedUser((this.wa.sock?.user ?? this.wa.me).id) ? 'Yo (recordatorio)' : this.store.displayName(to),
			text: `⏰ Recordatorio: ${r.task}`,
			send_at: Math.floor(r.sendAt.getTime() / 1000),
			repeat: r.repeat,
			created_by: isVoice ? 'voz' : 'texto',
			transcript: said,
		})
		const when = r.sendAt.toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
		await this.reply(
			[`✅ Recordatorio #${row.id} programado`, `📅 ${when}`, REPEAT_LABEL[r.repeat] && `🔁 ${REPEAT_LABEL[r.repeat]}`, `📝 ${r.task}`]
				.filter(Boolean)
				.join('\n'),
		)
	}

	async reply(text) {
		const me = this.wa.sock?.user ?? this.wa.me
		await this.wa.send(jidNormalizedUser(me.id), text)
	}
}
