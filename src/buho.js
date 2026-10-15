// El asistente por WhatsApp: en tu propio chat, un texto o nota de voz que empieza con "Búho" se lo pasa a Claude
// y la respuesta te llega ahí mismo. Si le hablaste con audio, contesta con nota de voz (y el texto); si escribiste,
// con texto. Tras cada respuesta queda 10 minutos "en conversacion": puedes contestarle (p. ej. "sí") sin decir "Búho".
// Solo atiende tus propios mensajes en tu chat: nadie mas puede darle ordenes.
import { generateMessageIDV2, jidNormalizedUser } from 'baileys'
import { synthesize } from './tts.js'

const WINDOW_MS = 10 * 60_000
// Tareas grandes (p. ej. una hoja con cientos de filas de ejemplo) tardan varios minutos.
const TASK_TIMEOUT_MS = 10 * 60_000
export const BUHO_PREFIX = '🦉'

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export class BuhoChannel {
	constructor({ wa, store, assistant, log, dirs, markOwn }) {
		Object.assign(this, { wa, store, assistant, log, dirs, markOwn })
		this.until = 0
		this.running = 0 // pedidos en curso
		this.started = 0 // contador de pedidos, para saber si otro empezo mientras tanto
		this.enabled = process.env.BUHO_WHATSAPP !== '0'
	}

	// "Búho, ¿qué me escribió Lidia?" -> "¿qué me escribió Lidia?". Whisper a veces escribe "Buho", "Búo" o "Vuho".
	// Devuelve null si no empieza con la palabra.
	wake(said) {
		if (!this.enabled) return null
		const m = fold(said).match(/^\s*(?:oye|hola|ey)?[\s,]*[bv]u+[hj]?o\b[\s,.:;!¡¿?-]*/)
		return m ? said.slice(m[0].length).trim() : null
	}

	active() {
		return this.enabled && Date.now() < this.until
	}

	self() {
		return jidNormalizedUser((this.wa.sock?.user ?? this.wa.me).id)
	}

	// Cada pedido se atiende de inmediato, aunque haya otro en curso: no espera a que termine el anterior.
	ask(question, isVoice, original) {
		this.until = Date.now() + WINDOW_MS
		return this.answer(question, isVoice, original).catch((err) => this.log(`buho: ${err.stack ?? err}`))
	}

	session() {
		const today = new Date().toDateString()
		try {
			const s = JSON.parse(this.store.db.prepare(`SELECT value FROM meta WHERE key = 'buho_session'`).get()?.value ?? 'null')
			return s?.day === today ? s.id : null // una conversacion por dia
		} catch {
			return null
		}
	}

	saveSession(id) {
		if (!id) return
		this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('buho_session', ?)`).run(JSON.stringify({ id, day: new Date().toDateString() }))
	}

	// Mientras trabaja, si tarda, avisa que sigue y en que (sin saturar: a los 45 s y luego cada 2 minutos).
	runAssistant(question, voice, fork, quotedId) {
		return new Promise((resolve) => {
			let parts = []
			let doing = 'pensando la respuesta'
			const me = this.self()
			const nudge = () => this.wa.send(me, `${BUHO_PREFIX} Sigo en eso: ${doing.toLowerCase()}…`, quotedId).catch(() => {})
			const first = setTimeout(() => { nudge(); timer = setInterval(nudge, 120_000) }, 45_000)
			let timer
			const stop = () => { clearTimeout(first); clearInterval(timer) }
			this.assistant.run(
				question,
				this.session(),
				(ev) => {
					// Lo escrito antes de usar una herramienta es preambulo ("voy a revisar..."): se queda lo ultimo.
					if (ev.type === 'status') { parts = []; doing = ev.text }
					else if (ev.type === 'text') parts.push(ev.text)
					else if (ev.type === 'done') { stop(); resolve({ text: parts.join('\n\n').trim(), session: ev.session }) }
					else if (ev.type === 'error') { stop(); resolve({ error: ev.error, session: ev.session }) }
				},
				{ voice, dirs: this.dirs(), channel: 'whatsapp', userName: this.wa.sock?.user?.name ?? '', exclusive: false, fork, timeoutMs: TASK_TIMEOUT_MS },
			)
		})
	}

	// Audio y texto se mandan citando tu mensaje: asi se ve a que respondio y no se confunden con notas tuyas
	// (salen de tu propia cuenta, con tu foto).
	async answer(question, isVoice, original) {
		const me = this.self()
		const q = fold(question)
		const wantText = /\b(por escrito|en texto|escribeme)\b/.test(q)
		const wantAudio = /\b(en|con|por) (audio|voz)\b|\bmandame un audio\b/.test(q)
		// Respuestas en nota de voz: apagadas por ahora (todo por escrito). BUHO_AUDIO=1 las vuelve a activar.
		const audio = process.env.BUHO_AUDIO === '1' && ((isVoice && !wantText) || wantAudio)
		const quotedId = original?.key?.id
		if (!question) return this.wa.send(me, `${BUHO_PREFIX} ¿Sí? Dime qué necesitas.`, quotedId)

		const presence = (p) => this.wa.sock?.sendPresenceUpdate(p, me).catch(() => {})
		presence(audio ? 'recording' : 'composing')
		this.log(`buho: ${isVoice ? 'nota de voz' : 'texto'}: ${question.slice(0, 120)}`)

		// Si ya hay otro pedido en curso, este sigue la conversacion en una copia (no comparten la sesion).
		const concurrent = this.running > 0
		const mine = ++this.started
		this.running++
		let r
		try {
			r = await this.runAssistant(question, audio, concurrent, quotedId)
		} finally {
			this.running--
		}
		this.saveSession(r.session)
		if (!this.running) presence('paused')
		this.until = Date.now() + WINDOW_MS

		if (r.error || !r.text) return this.wa.send(me, `${BUHO_PREFIX} ⚠️ ${r.error ?? 'No obtuve respuesta, intenta de nuevo.'}`, quotedId)
		const text = r.text.replace(/\*\*(.+?)\*\*/g, '*$1*') // por si viene con negritas de Markdown

		if (audio) {
			try {
				const v = await synthesize(text, this.log)
				// El id se marca como propio antes de enviar, para que la nota no se transcriba de vuelta como si fuera tuya.
				const messageId = generateMessageIDV2(this.wa.sock.user?.id)
				this.markOwn(messageId)
				await this.wa.sock.sendMessage(me, { audio: v.audio, mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: v.seconds }, { messageId, ...(original?.message ? { quoted: original } : {}) })
			} catch (err) {
				this.log(`buho: no se pudo generar el audio: ${err.message}`)
			}
		}
		// Con voz, lo que se entendio va primero: si la transcripcion fallo, se nota al instante. Con varios pedidos
		// a la vez, cada respuesta dice a cual corresponde.
		const about = isVoice ? `🎤 _Entendí:_ «${question}»\n\n` : concurrent || this.running || this.started > mine ? `_Sobre:_ «${question.slice(0, 80)}»\n\n` : ''
		await this.wa.send(me, `${BUHO_PREFIX} ${about}${text}`, quotedId)
	}
}
