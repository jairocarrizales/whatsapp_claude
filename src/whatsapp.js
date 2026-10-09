// Conexion a WhatsApp Web (Baileys) y volcado de eventos al almacen local.
import makeWASocket, {
	BufferJSON,
	DisconnectReason,
	fetchLatestBaileysVersion,
	getContentType,
	isJidGroup,
	jidNormalizedUser,
	normalizeMessageContent,
	proto,
	useMultiFileAuthState,
} from 'baileys'
import pino from 'pino'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Todo el log va a stderr: stdout es el canal del protocolo MCP.
const logger = pino({ level: process.env.WA_LOG_LEVEL ?? 'warn' }, pino.destination(2))

export const toNumber = (t) => {
	if (t == null) return 0
	if (typeof t === 'object') return typeof t.toNumber === 'function' ? t.toNumber() : Number(t.low ?? 0)
	return Number(t)
}

export function extractText(message) {
	const m = normalizeMessageContent(message)
	if (!m) return { type: null, text: null }
	const type = getContentType(m)
	const c = type ? m[type] : null
	let text = null
	switch (type) {
		case 'conversation':
			text = m.conversation
			break
		case 'extendedTextMessage':
			text = c.text
			break
		case 'imageMessage':
		case 'videoMessage':
			text = c.caption ? `[${type === 'imageMessage' ? 'imagen' : 'video'}] ${c.caption}` : `[${type === 'imageMessage' ? 'imagen' : 'video'}]`
			break
		case 'documentMessage':
			text = `[documento] ${c.fileName ?? ''}${c.caption ? ' — ' + c.caption : ''}`.trim()
			break
		case 'audioMessage':
			text = c.ptt ? '[nota de voz]' : '[audio]'
			break
		case 'stickerMessage':
			text = '[sticker]'
			break
		case 'locationMessage':
			text = `[ubicacion] ${c.degreesLatitude},${c.degreesLongitude}${c.name ? ' ' + c.name : ''}`
			break
		case 'contactMessage':
			text = `[contacto] ${c.displayName ?? ''}`
			break
		case 'reactionMessage':
			text = c.text ? `[reaccion ${c.text}]` : null
			break
		case 'pollCreationMessage':
		case 'pollCreationMessageV3':
			text = `[encuesta] ${c.name}: ${(c.options ?? []).map((o) => o.optionName).join(' / ')}`
			break
		case 'protocolMessage':
		case 'senderKeyDistributionMessage':
		case 'messageContextInfo':
			return { type, text: null, skip: true }
		default:
			text = type ? `[${type}]` : null
	}
	return { type, text }
}

export class WhatsApp {
	constructor({ dataDir, store, printQR = false }) {
		this.authDir = join(dataDir, 'auth')
		this.store = store
		this.printQR = printQR
		this.sock = null
		this.state = 'disconnected' // disconnected | connecting | qr | open | logged_out
		this.qr = null
		this.me = null
		this.lastError = null
		this.listeners = new Set()
	}

	isLinked() {
		const credsFile = join(this.authDir, 'creds.json')
		if (!existsSync(credsFile)) return false
		try {
			return Boolean(JSON.parse(readFileSync(credsFile, 'utf8')).me?.id)
		} catch {
			return false
		}
	}

	on(fn) {
		this.listeners.add(fn)
		return () => this.listeners.delete(fn)
	}

	emit(event, data) {
		for (const fn of this.listeners) fn(event, data)
	}

	// Pasa un jid @lid a su forma de telefono si conocemos el mapeo.
	canon(jid) {
		if (!jid) return jid
		jid = jidNormalizedUser(jid)
		if (jid.endsWith('@lid')) return this.store.pnForLid(jid) ?? jid
		return jid
	}

	async connect() {
		this.closing = false
		if (this.sock && (this.state === 'open' || this.state === 'connecting' || this.state === 'qr')) return
		this.state = 'connecting'
		const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
		const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

		const sock = makeWASocket({
			version,
			auth: state,
			logger,
			syncFullHistory: true,
			markOnlineOnConnect: false,
			getMessage: async (key) => {
				const raw = this.store.getMessageRaw(this.canon(key.remoteJid), key.id)
				return raw ? proto.Message.fromObject(JSON.parse(raw, BufferJSON.reviver)) : undefined
			},
		})
		this.sock = sock

		sock.ev.on('creds.update', saveCreds)

		sock.ev.on('connection.update', (u) => {
			if (u.qr) {
				this.state = 'qr'
				this.qr = u.qr
				this.emit('qr', u.qr)
			}
			if (u.connection === 'open') {
				this.state = 'open'
				this.qr = null
				clearTimeout(this.stableTimer)
				this.stableTimer = setTimeout(() => (this.replacedCount = 0), 5 * 60_000)
				this.lastError = null
				this.me = sock.user
				this.emit('open', sock.user)
				this.refreshGroups().catch((err) => logger.warn({ err }, 'no se pudieron leer los grupos'))
			}
			if (u.connection === 'close') {
				const code = u.lastDisconnect?.error?.output?.statusCode
				this.lastError = u.lastDisconnect?.error?.message ?? null
				this.sock = null
				if (code === DisconnectReason.loggedOut) {
					this.state = 'logged_out'
					rmSync(this.authDir, { recursive: true, force: true })
					this.emit('logged_out')
					return
				}
				if (code === DisconnectReason.connectionReplaced) {
					// Otra instancia tomo la sesion (otro cliente MCP, `npm run login` o un
					// health check como `claude mcp list`). Si era efimera, recuperamos la sesion;
					// tras varios reemplazos seguidos nos rendimos para no pelear con otro cliente.
					this.state = 'disconnected'
					this.replacedCount = (this.replacedCount ?? 0) + 1
					this.emit('replaced')
					if (this.closing || this.replacedCount > 3) return
					setTimeout(() => this.connect().catch((err) => logger.error({ err }, 'reconexion fallida')), 30_000)
					return
				}
				this.state = 'disconnected'
				if (this.closing) return
				setTimeout(() => this.connect().catch((err) => logger.error({ err }, 'reconexion fallida')), code === DisconnectReason.restartRequired ? 0 : 3000)
			}
		})

		sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings, progress, syncType }) => {
			this.store.tx(() => {
				this.each(lidPnMappings ?? [], (m) => this.store.upsertLid(m.lid, m.pn))
				this.each(contacts, (c) => this.saveContact(c))
				this.each(chats, (c) => this.saveChat(c))
				this.each(messages, (m) => this.saveMessage(m))
			})
			this.emit('history', { chats: chats.length, contacts: contacts.length, messages: messages.length, progress, syncType })
		})

		sock.ev.on('messaging-history.status', (s) => this.emit('history-status', s))

		sock.ev.on('lid-mapping.update', (m) => this.each([m], (x) => this.store.upsertLid(x.lid, x.pn)))

		const batch = (fn) => (list) => this.store.tx(() => this.each(list, fn))
		sock.ev.on('contacts.upsert', batch((c) => this.saveContact(c)))
		sock.ev.on('contacts.update', batch((c) => c.id && this.saveContact(c)))
		sock.ev.on('chats.upsert', batch((c) => this.saveChat(c)))
		sock.ev.on('chats.update', batch((c) => c.id && this.saveChat(c)))
		sock.ev.on('messages.upsert', ({ messages, type }) => {
			batch((m) => this.saveMessage(m))(messages)
			// Solo mensajes en vivo (no historial ni reenvios de sincronizacion).
			if (type === 'notify') for (const m of messages) this.emit('message', m)
		})
		sock.ev.on('groups.upsert', batch((g) => this.store.upsertChat({ jid: g.id, name: g.subject })))
		sock.ev.on('groups.update', batch((g) => g.id && g.subject && this.store.upsertChat({ jid: g.id, name: g.subject })))
	}

	// Guarda elemento por elemento: uno malformado no debe tirar todo el lote.
	each(list, fn) {
		for (const item of list) {
			try {
				fn(item)
			} catch (err) {
				logger.warn({ err, id: item?.key?.id ?? item?.id }, 'no se pudo guardar un elemento')
			}
		}
	}

	async refreshGroups() {
		const groups = await this.sock.groupFetchAllParticipating()
		this.store.tx(() => {
			for (const g of Object.values(groups)) this.store.upsertChat({ jid: g.id, name: g.subject })
		})
	}

	saveContact(c) {
		if (c.lid && c.phoneNumber) this.store.upsertLid(jidNormalizedUser(c.lid), jidNormalizedUser(c.phoneNumber))
		const jid = this.canon(c.phoneNumber ?? c.id)
		this.store.upsertContact({ jid, name: c.name ?? null, notify: c.notify ?? c.verifiedName ?? null, phone: c.phoneNumber ?? null })
	}

	saveChat(c) {
		const jid = this.canon(c.id)
		if (!jid || jid === 'status@broadcast') return
		this.store.upsertChat({
			jid,
			name: c.name ?? null,
			unread: c.unreadCount ?? null,
			lastTs: toNumber(c.conversationTimestamp),
		})
	}

	saveMessage(m) {
		const key = m.key
		if (!key?.remoteJid || !m.message || key.remoteJid === 'status@broadcast') return
		if (key.remoteJidAlt) this.store.upsertLid(jidNormalizedUser(key.remoteJid.endsWith('@lid') ? key.remoteJid : key.remoteJidAlt), jidNormalizedUser(key.remoteJid.endsWith('@lid') ? key.remoteJidAlt : key.remoteJid))
		if (key.participant && key.participantAlt) {
			const [lid, pn] = key.participant.endsWith('@lid') ? [key.participant, key.participantAlt] : [key.participantAlt, key.participant]
			this.store.upsertLid(jidNormalizedUser(lid), jidNormalizedUser(pn))
		}
		const { type, text, skip } = extractText(m.message)
		if (skip || !type) return

		const chatJid = this.canon(key.remoteJid)
		const ts = toNumber(m.messageTimestamp)
		const sender = key.fromMe ? 'me' : this.canon(isJidGroup(chatJid) ? key.participant : chatJid)

		this.store.upsertMessage({
			chatJid,
			id: key.id,
			fromMe: key.fromMe,
			sender,
			pushName: m.pushName ?? null,
			ts,
			type,
			text,
			raw: JSON.stringify(m.message, BufferJSON.replacer),
		})
		if (!key.fromMe && m.pushName && sender && !isJidGroup(sender)) {
			this.store.upsertContact({ jid: sender, notify: m.pushName })
		}
		this.store.upsertChat({ jid: chatJid, lastTs: ts })
	}

	// Acepta un jid o un telefono en cualquier formato ("+52 1 55 1234 5678").
	async resolveRecipient(to) {
		if (to.includes('@')) return jidNormalizedUser(to)
		const digits = to.replace(/\D/g, '')
		if (digits.length < 8) throw new Error(`"${to}" no parece un numero de telefono valido (incluye el codigo de pais).`)
		const [res] = await this.sock.onWhatsApp(digits)
		if (!res?.exists) throw new Error(`El numero +${digits} no tiene WhatsApp.`)
		return jidNormalizedUser(res.jid)
	}

	async send(to, text, quotedId) {
		const jid = await this.resolveRecipient(to)
		const options = {}
		if (quotedId) {
			const raw = this.store.getMessageRaw(this.canon(jid), quotedId)
			if (raw) {
				const row = this.store.db.prepare('SELECT from_me, sender FROM messages WHERE chat_jid = ? AND id = ?').get(this.canon(jid), quotedId)
				options.quoted = {
					key: { remoteJid: jid, id: quotedId, fromMe: Boolean(row.from_me), participant: isJidGroup(jid) && !row.from_me ? row.sender : undefined },
					message: JSON.parse(raw, BufferJSON.reviver),
				}
			}
		}
		const sent = await this.sock.sendMessage(jid, { text }, options)
		if (sent) this.saveMessage(sent)
		return { jid, id: sent?.key?.id }
	}

	// jids con los que WhatsApp identifica el chat "Mensajes para mi" (telefono y LID).
	selfJids() {
		const me = this.sock?.user ?? this.me
		return new Set([me?.id, me?.lid].filter(Boolean).map((j) => jidNormalizedUser(j)))
	}

	// Agrega o edita un contacto como lo hace WhatsApp Web; con `saveToPhone` tambien queda en la agenda del telefono.
	async addContact({ phone, name, saveToPhone = true }) {
		const jid = await this.resolveRecipient(phone)
		const fullName = String(name).trim()
		await this.sock.addOrEditContact(jid, { fullName, firstName: fullName.split(/\s+/)[0], saveOnPrimaryAddressbook: Boolean(saveToPhone) })
		this.store.upsertContact({ jid, name: fullName })
		return jid
	}

	async markRead(chatJid) {
		const jid = this.canon(chatJid)
		const rows = this.store.db
			.prepare('SELECT id, sender FROM messages WHERE chat_jid = ? AND from_me = 0 ORDER BY ts DESC LIMIT 20')
			.all(jid)
		if (!rows.length) return 0
		await this.sock.readMessages(rows.map((r) => ({ remoteJid: jid, id: r.id, fromMe: false, participant: isJidGroup(jid) ? r.sender : undefined })))
		this.store.upsertChat({ jid, unread: 0 })
		return rows.length
	}

	async logout() {
		this.me = null
		await this.sock?.logout()
	}

	close() {
		this.closing = true
		this.sock?.end(undefined)
		this.sock = null
	}
}
