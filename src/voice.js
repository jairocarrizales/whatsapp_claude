// Ordenes por WhatsApp: una nota de voz (o un texto) que te mandas a ti mismo.
// "Recuérdame mañana a las 8 pagar la luz" crea un mensaje programado;
// "envía un correo a Lidia diciendo..." prepara un correo y lo envía si respondes "sí".
import { jidNormalizedUser, normalizeMessageContent } from 'baileys'
import { parseReminder } from './reminders.js'
import { transcribe } from './transcribe.js'
import { parseEmailCommand } from './email.js'

const MAX_AGE_S = 10 * 60
const REPEAT_LABEL = { daily: 'Todos los días', weekdays: 'Lunes a viernes', weekly: 'Cada semana' }
const EXAMPLE = '«Recuérdame mañana a las 8 pagar la luz»'
// Prefijos de los mensajes que manda este modulo: nunca se reinterpretan.
const OWN_PREFIXES = ['✅', '⏰', '🤔', '⚠️', '📧', '❌', '🔔', '📇', '🦉']

export class VoiceReminders {
	constructor({ store, wa, log, createScheduled, download, email }) {
		this.email = email
		this.download = download ?? ((m) => wa.downloadMedia(m))
		this.store = store
		this.wa = wa
		this.log = log
		this.createScheduled = createScheduled
		this.seen = new Set()
		wa.on((event, data) => event === 'message' && this.handle(data).catch((err) => log(`recordatorio: ${err.stack ?? err}`)))
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
			// Aviso inmediato, sin esperar la transcripcion ni otras tareas en curso.
			if (this.buho?.enabled) this.wa.send(this.buho.self(), '🦉 Recibí tu audio, lo estoy procesando…', key.id).catch(() => {})
			const audio = await this.download(m)
			said = await transcribe(audio)
			this.log(`transcripcion: ${said}`)
		} else {
			said = content?.conversation ?? content?.extendedTextMessage?.text
			if (!said || OWN_PREFIXES.some((p) => said.startsWith(p))) return
		}

		// ---- "Búho, …": se quita la palabra. Recordatorios y correos siguen yendo directo (al instante, sin IA);
		// todo lo demas va al asistente si le hablaste a el: con "Búho", con nota de voz o en plena conversacion.
		const question = this.buho?.wake(said)
		const addressed = question != null
		if (addressed) said = question
		if (addressed && !said) return this.buho.ask('', isVoice, m)
		const toBuho = () => Boolean(this.buho?.enabled && (addressed || isVoice || this.buho.active()))

		// ---- correo: "envia un correo a Lidia diciendo..." con confirmacion por "si" ----
		if (this.email) {
			const answer = said.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.!¡¿?,]/g, '').trim()
			const pending = this.pendingEmail && this.pendingEmail.expires > Date.now() ? this.pendingEmail : null
			if (pending && /^(si|sii+|si enviar(lo)?|si envialo|envialo|enviar|ok|okay|dale|confirmo|adelante)$/.test(answer)) {
				this.pendingEmail = null
				try {
					await this.email.send({ ...pending.draft, source: isVoice ? 'voz' : 'texto' })
					const names = [...new Set(pending.draft.to.map((r) => (r.group ? `grupo ${r.group}` : r.name)))]
					return this.reply(`✅ Correo enviado a ${names.join(', ')} (${pending.draft.to.length} ${pending.draft.to.length === 1 ? 'destinatario' : 'destinatarios'}).`)
				} catch (err) {
					return this.reply(`⚠️ No se pudo enviar el correo: ${err.message}`)
				}
			}
			if (pending && /^(no|cancela(r|lo)?|no lo envies|no enviar|olvidalo)$/.test(answer)) {
				this.pendingEmail = null
				return this.reply('❌ Correo cancelado.')
			}
			const e = parseEmailCommand(said, this.email)
			if (e) {
				// Un pedido de correo que el analizador no entiende del todo lo interpreta Claude por contexto.
				if (!e.ok && toBuho()) return this.buho.ask(said, isVoice, m)
				if (!e.ok) {
					const why = {
						'no-body': '¿Qué quieres que diga el correo? Por ejemplo: «Envía un correo a Lidia diciendo que mañana le mando la cotización».',
						'no-recipient': '¿A quién se lo envío? Di un nombre de tu agenda de correos o la dirección.',
						unknown: `No encontré a *${e.detail}* en tu agenda de correos. Agrégalo en Ajustes del panel o di la dirección (p. ej. «juan arroba gmail punto com»).`,
						ambiguous: `Hay varios posibles: ${e.detail}. Dime el nombre completo (para un grupo, di «al grupo …»).`,
						'empty-group': `El grupo *${e.detail}* no tiene integrantes todavía. Agrégalos en Ajustes del panel.`,
					}[e.error]
					return this.reply(`🤔 ${isVoice ? `Entendí: «${said}»\n\n` : ''}${why}`)
				}
				if (!this.email.config()) return this.reply('⚠️ Para enviar correos primero configura tu cuenta en Ajustes del panel (http://localhost:3737/#ajustes).')
				this.pendingEmail = { draft: e, expires: Date.now() + 15 * 60_000 }
				const people = e.to.filter((r) => !r.group).map((r) => (r.name === r.email ? r.email : `${r.name} <${r.email}>`))
				const to = [...e.groups.map((g) => `Grupo ${g.name} (${g.size} ${g.size === 1 ? 'correo' : 'correos'})`), ...people].join(', ')
				return this.reply(
					[`📧 *Correo listo para enviar*`, `*Para:* ${to}${e.to.length > 1 ? ' (en copia oculta)' : ''}`, `*Asunto:* ${e.subject}`, '', e.body, '', 'Responde *sí* para enviarlo o *no* para cancelarlo.'].join('\n'),
				)
			}
		}

		// Recordatorio: empieza con "Recuérdame…" (o con la fecha: "Mañana a las 8 …"). Asi una pregunta con "hoy"
		// ("Búho, ¿qué tengo hoy?" mal transcrito como "Buu, …") ya no se convierte en recordatorio.
		const r = parseReminder(said, new Date(), { requireTrigger: true })
		if (!r.ok) {
			// Lo demas va al asistente si le hablaste a el (las notas de voz siempre: Whisper escribe "Búho" como
			// "Buu", "Hugo"…). Un texto que no es recordatorio ni empieza con "Búho" (un apunte para ti) se ignora.
			if (toBuho()) return this.buho.ask(said, isVoice, m)
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
