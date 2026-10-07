#!/usr/bin/env node
// Servidor MCP (stdio) para leer y enviar mensajes de WhatsApp.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { isJidGroup } from 'baileys'
import { dbFile, serviceUrl } from './config.js'
import { openStore } from './store.js'

// El MCP lee la base local directamente; todo lo que requiere la conexion a WhatsApp
// (enviar, marcar como leido, vincular) se lo pide al servicio (npm run service).
const store = openStore(dbFile)

const text = (s) => ({ content: [{ type: 'text', text: s }] })
const json = (o) => text(JSON.stringify(o, null, 2))
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true })
const iso = (ts) => (ts ? new Date(ts * 1000).toISOString() : null)
const resolveChat = (chat) => store.resolveChat(chat)

async function service(method, path, body) {
	let res
	try {
		res = await fetch(serviceUrl + path, {
			method,
			headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
			body: body ? JSON.stringify(body) : undefined,
		})
	} catch {
		throw new Error(`El servicio de WhatsApp no esta corriendo. Inicialo con \`npm run service\` en ${serviceUrl.replace('127.0.0.1', 'localhost')} (o instalalo al inicio de Windows con \`npm run install-startup\`).`)
	}
	const data = await res.json().catch(() => ({}))
	if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
	return data
}

const panelUrl = serviceUrl.replace('127.0.0.1', 'localhost')
const REPEAT = { none: 'una vez', daily: 'diario', weekdays: 'lunes a viernes', weekly: 'semanal' }

const formatMessage = (m, chatJid) => ({
	id: m.id,
	time: iso(m.ts),
	from: m.from_me ? 'yo' : isJidGroup(chatJid) ? (store.displayName(m.sender) ?? m.push_name) : store.displayName(m.sender),
	text: m.text,
})

const server = new McpServer(
	{ name: 'whatsapp', version: '1.0.0' },
	{
		instructions:
			'Acceso al WhatsApp del usuario y a su lista de documentos de Google Drive (registrados en Ajustes del panel, a menudo asociados a un proveedor o chat). ' +
			'Para leer u organizar esos documentos usa list_resources y luego el conector de Google Drive (read_file_content con el drive_id; en carpetas, search_files con parentId = drive_id). ' +
			'Confirma con el usuario antes de enviar, programar o modificar algo.',
	},
)


server.registerTool(
	'whatsapp_status',
	{
		title: 'Estado de WhatsApp',
		description: 'Muestra si WhatsApp esta vinculado y conectado, con que numero, y cuantos datos hay sincronizados.',
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	async () => {
		try {
			const { qr, ...status } = await service('GET', '/api/status')
			return json({ ...status, panel: panelUrl })
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'whatsapp_login',
	{
		title: 'Vincular WhatsApp (QR)',
		description:
			'Devuelve el codigo QR para vincular WhatsApp si el servicio aun no esta vinculado. El usuario debe escanearlo en WhatsApp > Dispositivos vinculados > Vincular un dispositivo. Tambien puede hacerlo desde el panel web.',
		inputSchema: {},
	},
	async () => {
		try {
			let s = await service('GET', '/api/status')
			if (s.state === 'open') return text(`Ya esta conectado como ${s.me?.name ?? s.me?.id}.`)
			if (!s.qr) {
				await service('POST', '/api/connect')
				for (let i = 0; i < 15 && !s.qr && s.state !== 'open'; i++) {
					await new Promise((r) => setTimeout(r, 1000))
					s = await service('GET', '/api/status')
				}
			}
			if (s.state === 'open') return text(`Conectado como ${s.me?.name ?? s.me?.id}.`)
			if (!s.qr) return text(`Hay una sesion vinculada y se esta reconectando (estado: ${s.state}). Consulta whatsapp_status en unos segundos.`)
			return {
				content: [
					{ type: 'image', data: s.qr.split(',')[1], mimeType: 'image/png' },
					{ type: 'text', text: `Escanea este QR en WhatsApp > Dispositivos vinculados > Vincular un dispositivo (caduca en ~20 s; tambien aparece en ${panelUrl}).` },
				],
			}
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'list_chats',
	{
		title: 'Listar chats',
		description: 'Lista los chats ordenados por actividad reciente, con el ultimo mensaje de cada uno.',
		inputSchema: {
			query: z.string().optional().describe('Filtra por nombre del chat/contacto o numero'),
			only_unread: z.boolean().optional().describe('Solo chats con mensajes sin leer'),
			only_groups: z.boolean().optional(),
			limit: z.number().int().min(1).max(200).default(20),
		},
		annotations: { readOnlyHint: true },
	},
	async ({ query, only_unread, only_groups, limit }) => {
		const where = ['1=1']
		const params = []
		if (query) {
			where.push('(c.name LIKE ? OR k.name LIKE ? OR k.notify LIKE ? OR c.jid LIKE ?)')
			params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query.replace(/\D/g, '') || query}%`)
		}
		if (only_unread) where.push('c.unread > 0')
		if (only_groups) where.push("c.jid LIKE '%@g.us'")
		const rows = store.db
			.prepare(`
				SELECT c.jid, c.unread, c.last_ts,
					(SELECT text FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_text,
					(SELECT from_me FROM messages m WHERE m.chat_jid = c.jid ORDER BY ts DESC LIMIT 1) AS last_from_me
				FROM chats c LEFT JOIN contacts k ON k.jid = c.jid
				WHERE ${where.join(' AND ')}
				ORDER BY c.last_ts DESC LIMIT ?`)
			.all(...params, limit)
		return json(
			rows.map((r) => ({
				jid: r.jid,
				name: store.displayName(r.jid),
				phone: store.phoneFor(r.jid),
				group: Boolean(isJidGroup(r.jid)),
				unread: r.unread,
				last_activity: iso(r.last_ts),
				last_message: r.last_text ? `${r.last_from_me ? 'yo: ' : ''}${r.last_text}` : null,
			})),
		)
	},
)

server.registerTool(
	'get_messages',
	{
		title: 'Leer mensajes de un chat',
		description: 'Devuelve los mensajes de un chat en orden cronologico (los mas recientes al final).',
		inputSchema: {
			chat: z.string().describe('jid del chat (de list_chats), numero de telefono o nombre del contacto/grupo'),
			limit: z.number().int().min(1).max(500).default(30),
			before: z.string().optional().describe('Fecha ISO: solo mensajes anteriores (para paginar hacia atras)'),
			after: z.string().optional().describe('Fecha ISO: solo mensajes posteriores'),
		},
		annotations: { readOnlyHint: true },
	},
	async ({ chat, limit, before, after }) => {
		let jid
		try {
			jid = resolveChat(chat)
		} catch (err) {
			return fail(err.message)
		}
		const where = ['chat_jid = ?']
		const params = [jid]
		if (before) (where.push('ts < ?'), params.push(Math.floor(Date.parse(before) / 1000)))
		if (after) (where.push('ts > ?'), params.push(Math.floor(Date.parse(after) / 1000)))
		const rows = store.db
			.prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} AND text IS NOT NULL ORDER BY ts DESC LIMIT ?`)
			.all(...params, limit)
			.reverse()
		return json({ chat: { jid, name: store.displayName(jid) }, messages: rows.map((m) => formatMessage(m, jid)) })
	},
)

server.registerTool(
	'search_messages',
	{
		title: 'Buscar mensajes',
		description: 'Busca texto en todos los mensajes (o en un chat concreto).',
		inputSchema: {
			query: z.string().min(1),
			chat: z.string().optional().describe('Limitar a un chat (jid, numero o nombre)'),
			limit: z.number().int().min(1).max(200).default(30),
		},
		annotations: { readOnlyHint: true },
	},
	async ({ query, chat, limit }) => {
		const where = ['text LIKE ?']
		const params = [`%${query}%`]
		if (chat) {
			try {
				where.push('chat_jid = ?')
				params.push(resolveChat(chat))
			} catch (err) {
				return fail(err.message)
			}
		}
		const rows = store.db
			.prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`)
			.all(...params, limit)
		return json(rows.map((m) => ({ chat: store.displayName(m.chat_jid), chat_jid: m.chat_jid, ...formatMessage(m, m.chat_jid) })))
	},
)

server.registerTool(
	'search_contacts',
	{
		title: 'Buscar contactos',
		description: 'Busca contactos por nombre o numero de telefono.',
		inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) },
		annotations: { readOnlyHint: true },
	},
	async ({ query, limit }) => {
		const like = `%${query}%`
		const digits = query.replace(/\D/g, '')
		const rows = store.db
			.prepare(`
				SELECT jid FROM contacts
				WHERE name LIKE ? OR notify LIKE ? OR (? <> '' AND jid LIKE ?)
				ORDER BY name IS NULL, name LIMIT ?`)
			.all(like, like, digits, `%${digits}%`, limit)
		return json(rows.map((r) => ({ jid: r.jid, name: store.displayName(r.jid), phone: store.phoneFor(r.jid) })))
	},
)

server.registerTool(
	'send_message',
	{
		title: 'Enviar mensaje',
		description:
			'Envia un mensaje de texto a un contacto o grupo. Confirma con el usuario el destinatario y el texto antes de enviar.',
		inputSchema: {
			to: z.string().describe('jid, numero con codigo de pais (ej. +5215512345678) o nombre exacto de un chat'),
			text: z.string().min(1),
			reply_to: z.string().optional().describe('id de un mensaje del mismo chat para responderlo citandolo'),
		},
		annotations: { destructiveHint: false, openWorldHint: true },
	},
	async ({ to, text: body, reply_to }) => {
		try {
			const { jid, name, id } = await service('POST', '/api/send', { to, text: body, reply_to })
			return text(`Enviado a ${name} (${jid}). id: ${id}`)
		} catch (err) {
			return fail(`No se pudo enviar: ${err.message}`)
		}
	},
)

server.registerTool(
	'mark_as_read',
	{
		title: 'Marcar chat como leido',
		description: 'Marca como leidos los mensajes recientes de un chat (envia las palomitas azules).',
		inputSchema: { chat: z.string().describe('jid, numero o nombre del chat') },
	},
	async ({ chat }) => {
		try {
			const { marked: n } = await service('POST', '/api/mark-read', { chat })
			return text(n ? `Marcados ${n} mensajes como leidos.` : 'No habia mensajes que marcar.')
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'schedule_message',
	{
		title: 'Programar mensaje',
		description:
			'Programa un mensaje de texto para enviarse en una fecha y hora (opcionalmente repetido). Lo envia el servicio local aunque Claude este cerrado, mientras la PC este encendida. Confirma con el usuario destinatario, texto y hora antes de programar.',
		inputSchema: {
			to: z.string().describe('jid, numero con codigo de pais o nombre de un chat'),
			text: z.string().min(1),
			send_at: z.string().describe('Fecha y hora ISO 8601 con zona horaria, p. ej. 2026-10-08T08:00:00-06:00'),
			repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']).default('none').describe('none, daily, weekdays (lunes a viernes) o weekly'),
		},
		annotations: { destructiveHint: false, openWorldHint: true },
	},
	async ({ to, text: body, send_at, repeat }) => {
		try {
			const s = await service('POST', '/api/scheduled', { to, text: body, send_at, repeat, created_by: 'claude' })
			return text(`Programado #${s.id} para ${s.chat_name} el ${new Date(s.send_at).toLocaleString('es-MX')} (${REPEAT[s.repeat]}). Se puede ver y editar en ${panelUrl}.`)
		} catch (err) {
			return fail(`No se pudo programar: ${err.message}`)
		}
	},
)

server.registerTool(
	'list_scheduled',
	{
		title: 'Ver mensajes programados',
		description: 'Lista los mensajes programados pendientes, o el historial de envios.',
		inputSchema: { history: z.boolean().optional().describe('true para ver el historial (enviados, fallidos, perdidos, cancelados)') },
		annotations: { readOnlyHint: true },
	},
	async ({ history }) => {
		try {
			return json(await service('GET', `/api/scheduled?status=${history ? 'history' : 'pending'}`))
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'cancel_scheduled',
	{
		title: 'Cancelar mensaje programado',
		description: 'Cancela un mensaje programado pendiente por su id (de list_scheduled).',
		inputSchema: { id: z.number().int() },
		annotations: { destructiveHint: true },
	},
	async ({ id }) => {
		try {
			await service('DELETE', `/api/scheduled/${id}`)
			return text(`Cancelado el mensaje programado #${id}.`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'list_resources',
	{
		title: 'Ver documentos de Drive registrados',
		description:
			'Lista los documentos, hojas, presentaciones y carpetas de Google Drive que el usuario registro en Ajustes, con su drive_id, el chat de WhatsApp asociado (p. ej. un proveedor) y sus notas. ' +
			'Para leer su contenido usa el conector de Google Drive: read_file_content(fileId = drive_id); para una carpeta, search_files con query "parentId = \'<drive_id>\'".',
		inputSchema: { query: z.string().optional().describe('Filtra por nombre, proveedor, notas o chat (nombre, numero o jid)') },
		annotations: { readOnlyHint: true },
	},
	async ({ query }) => {
		try {
			let q = query?.trim() ?? ''
			// Si es un chat (nombre o numero), filtra por su jid.
			if (q) {
				try {
					q = store.resolveChat(q)
				} catch {}
			}
			const rows = await service('GET', `/api/resources${q ? `?q=${encodeURIComponent(q)}` : ''}`)
			if (!rows.length) return text(query ? `No hay documentos registrados que coincidan con "${query}".` : `No hay documentos registrados. Se agregan en Ajustes del panel (${panelUrl}) o con add_resource.`)
			return json(rows.map(({ id, name, kind_label, drive_id, url, chat_name, chat_jid, notes }) => ({ id, name, type: kind_label, drive_id, url, chat: chat_name, chat_jid, notes })))
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'add_resource',
	{
		title: 'Registrar documento de Drive',
		description: 'Registra un Doc, hoja, presentacion o carpeta de Google Drive en Ajustes, opcionalmente asociado a un chat de WhatsApp (proveedor).',
		inputSchema: {
			name: z.string().min(1).describe('Nombre descriptivo, p. ej. "Facturas Cementos del Norte"'),
			url: z.string().url().describe('URL de docs.google.com o drive.google.com'),
			chat: z.string().optional().describe('Chat de WhatsApp asociado: nombre, numero o jid'),
			notes: z.string().optional().describe('Notas o instrucciones sobre el documento'),
		},
	},
	async ({ name, url, chat, notes }) => {
		try {
			const r = await service('POST', '/api/resources', { name, url, to: chat, notes })
			return text(`Registrado #${r.id}: ${r.name} (${r.kind_label})${r.chat_name ? ` para ${r.chat_name}` : ''}.`)
		} catch (err) {
			return fail(`No se pudo registrar: ${err.message}`)
		}
	},
)

server.registerTool(
	'remove_resource',
	{
		title: 'Quitar documento de Drive',
		description: 'Quita un documento de la lista de Ajustes por su id (de list_resources). No borra nada en Google Drive.',
		inputSchema: { id: z.number().int() },
		annotations: { destructiveHint: true },
	},
	async ({ id }) => {
		try {
			await service('DELETE', `/api/resources/${id}`)
			return text(`Quitado el documento #${id} de la lista.`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

await server.connect(new StdioServerTransport())

const shutdown = () => process.exit(0)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('close', shutdown)
