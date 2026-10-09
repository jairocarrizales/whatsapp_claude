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
			'Acceso al WhatsApp del usuario y a sus carpetas y archivos de Google Drive guardados en Ajustes del panel, cada uno con un numero fijo (#1, #2, ...). ' +
			'Si el usuario menciona "la carpeta 3" o "el archivo 5", usa list_resources para obtener su drive_id y trabaja con el conector de Google Drive (read_file_content, search_files con parentId, create_file con parentId). ' +
			'Tambien envia correos desde la cuenta de BuhoChat a contactos, grupos o direcciones (send_email, siempre con vista previa y confirmacion). ' +
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
			'Envia un mensaje de texto a un contacto o grupo. SIEMPRE en dos pasos: llama primero con confirmed=false para ver a quien llegaria, muestraselo al usuario y solo vuelve a llamar con confirmed=true despues de su "si".',
		inputSchema: {
			confirmed: z.boolean().default(false).describe('true solo despues de que el usuario confirme'),
			to: z.string().describe('jid, numero con codigo de pais (ej. +5215512345678) o nombre exacto de un chat'),
			text: z.string().min(1),
			reply_to: z.string().optional().describe('id de un mensaje del mismo chat para responderlo citandolo'),
		},
		annotations: { destructiveHint: false, openWorldHint: true },
	},
	async ({ confirmed, to, text: body, reply_to }) => {
		try {
			if (!confirmed) {
				let para = to
				try {
					if (!/^[\d\s+()-]+$/.test(to)) para = store.displayName(resolveChat(to))
				} catch (err) {
					return fail(err.message)
				}
				return json({ vista_previa: true, para, texto: body, siguiente_paso: 'Muestra esto al usuario y espera su confirmacion; luego llama con confirmed=true.' })
			}
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
			'Programa un mensaje de texto para enviarse en una fecha y hora (opcionalmente repetido). Lo envia el servicio local aunque Claude este cerrado, mientras la PC este encendida. ' +
			'Para una lista de difusion usa `list` en lugar de `to`: se programa un mensaje por persona, espaciados segun el ritmo de Ajustes (esperas al azar y descansos); ' +
			'puedes pasar varias variantes en `texts` (se reparten en orden y en ciclo) y usar {nombre} para el nombre de cada persona. ' +
			'SIEMPRE en dos pasos: llama primero con confirmed=false para obtener la vista previa, muestrasela al usuario y solo vuelve a llamar con confirmed=true despues de su "si".',
		inputSchema: {
			confirmed: z.boolean().default(false).describe('true solo despues de que el usuario confirme'),
			to: z.string().optional().describe('jid, numero con codigo de pais o nombre de un chat (para una sola persona o grupo)'),
			list: z.string().optional().describe('Nombre de una lista de difusion (en lugar de `to`)'),
			text: z.string().optional().describe('Texto del mensaje'),
			texts: z.array(z.string()).optional().describe('Solo con `list`: varias variantes del texto, en orden'),
			send_at: z.string().describe('Fecha y hora ISO 8601 con zona horaria, p. ej. 2026-10-08T08:00:00-06:00'),
			repeat: z.enum(['none', 'daily', 'weekdays', 'weekly']).default('none').describe('none, daily, weekdays (lunes a viernes) o weekly'),
		},
		annotations: { destructiveHint: false, openWorldHint: true },
	},
	async ({ confirmed, to, list, text: body, texts, send_at, repeat }) => {
		try {
			const when = (iso) => new Date(iso).toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })
			if (!confirmed) {
				if (!list && !to) return fail('Indica el destinatario (`to`) o una lista de difusion (`list`).')
				if (list) {
					const p = await service('POST', '/api/scheduled', { list, texts: texts?.length ? texts : [body], send_at, repeat, preview: true })
					return json({ vista_previa: true, lista: p.list, personas: p.count, textos_en_ciclo: p.variants, primer_envio: when(p.first), ultimo_envio_aprox: when(p.last), ejemplos: p.examples, repeticion: REPEAT[repeat], siguiente_paso: 'Muestra esto al usuario y espera su confirmacion; luego llama con confirmed=true.' })
				}
				const p = await service('POST', '/api/scheduled', { to, text: body, send_at, repeat, preview: true })
				return json({ vista_previa: true, para: p.chat_name, texto: p.text, cuando: when(p.send_at), repeticion: REPEAT[p.repeat], siguiente_paso: 'Muestra esto al usuario y espera su confirmacion; luego llama con confirmed=true.' })
			}
			if (list) {
				const r = await service('POST', '/api/scheduled', { list, texts: texts?.length ? texts : [body], send_at, repeat, created_by: 'claude' })
				return text(`Programados ${r.count} mensajes para la lista ${r.list}, uno por persona, de ${new Date(r.first).toLocaleString('es-MX')} a ${new Date(r.last).toLocaleString('es-MX')}${r.variants > 1 ? ` (${r.variants} textos en ciclo)` : ''}. Se pueden ver o cancelar en ${panelUrl}.`)
			}
			if (!to) return fail('Indica el destinatario (`to`) o una lista de difusion (`list`).')
			if (!body) return fail('Falta el texto del mensaje.')
			const s = await service('POST', '/api/scheduled', { to, text: body, send_at, repeat, created_by: 'claude' })
			return text(`Programado #${s.id} para ${s.chat_name} el ${new Date(s.send_at).toLocaleString('es-MX')} (${REPEAT[s.repeat]}). Se puede ver y editar en ${panelUrl}.`)
		} catch (err) {
			return fail(`No se pudo programar: ${err.message}`)
		}
	},
)

server.registerTool(
	'list_broadcast_lists',
	{
		title: 'Ver listas de difusion',
		description: 'Lista las listas de difusion de WhatsApp (con sus integrantes) y el ritmo de envio configurado.',
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	async () => {
		try {
			const [lists, pace] = await Promise.all([service('GET', '/api/wa-lists'), service('GET', '/api/broadcast-pace')])
			return json({
				listas: lists.map((l) => ({ nombre: l.name, integrantes: l.members.map((m) => m.name) })),
				ritmo: `${pace.gapSec} s + ${pace.jitterMinSec}-${pace.jitterMaxSec} s al azar entre mensajes${pace.pauseEvery ? `, descanso de ${Math.round(pace.pauseSec / 60)} min cada ${pace.pauseEvery} personas` : ''}`,
			})
		} catch (err) {
			return fail(err.message)
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
		title: 'Ver carpetas y archivos de Drive',
		description:
			'Lista las carpetas y archivos de Google Drive que el usuario guardo en Ajustes, cada uno con un numero fijo (#1, #2, ...), una descripcion corta y su drive_id. ' +
			'Cuando el usuario diga "la carpeta 3" o "el archivo #5", se refiere a ese numero. ' +
			'Para leerlos usa el conector de Google Drive: read_file_content(fileId = drive_id); para una carpeta, search_files con query "parentId = \'<drive_id>\'"; para crear algo dentro de una carpeta, create_file con parentId = drive_id.',
		inputSchema: { query: z.string().optional().describe('Filtra por numero (p. ej. "3"), descripcion o enlace') },
		annotations: { readOnlyHint: true },
	},
	async ({ query }) => {
		try {
			const q = query?.trim() ?? ''
			const rows = await service('GET', `/api/resources${q ? `?q=${encodeURIComponent(q)}` : ''}`)
			if (!rows.length) return text(q ? `No hay carpetas ni archivos guardados que coincidan con "${q}".` : `No hay carpetas ni archivos guardados. Se agregan en Ajustes del panel (${panelUrl}) o con add_resource.`)
			return json(rows.map(({ num, description, kind_label, drive_id, url }) => ({ numero: num, descripcion: description || null, tipo: kind_label, drive_id, url })))
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'add_resource',
	{
		title: 'Guardar carpeta o archivo de Drive',
		description: 'Guarda en Ajustes el enlace de una carpeta o archivo de Google Drive (Docs, Sheets, Slides) con una descripcion corta. Recibe un numero fijo para referirse a el.',
		inputSchema: {
			url: z.string().url().describe('Enlace de drive.google.com o docs.google.com'),
			description: z.string().optional().describe('Descripcion corta, p. ej. "Facturas Cementos del Norte"'),
		},
	},
	async ({ url, description }) => {
		try {
			const r = await service('POST', '/api/resources', { url, description })
			return text(`Guardado como #${r.num}: ${r.description || r.kind_label}.`)
		} catch (err) {
			return fail(`No se pudo guardar: ${err.message}`)
		}
	},
)

server.registerTool(
	'remove_resource',
	{
		title: 'Quitar carpeta o archivo de Drive',
		description: 'Quita de Ajustes la carpeta o archivo con ese numero. No borra nada en Google Drive. El numero no se reutiliza.',
		inputSchema: { numero: z.number().int().describe('Numero del elemento (de list_resources)') },
		annotations: { destructiveHint: true },
	},
	async ({ numero }) => {
		try {
			await service('DELETE', `/api/resources/${numero}`)
			return text(`Quitado el #${numero} de Ajustes.`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'list_email_contacts',
	{
		title: 'Ver agenda y grupos de correo',
		description: 'Lista los contactos de correo de la agenda de BuhoChat, los grupos (con sus integrantes) y si la cuenta de envio esta configurada.',
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	async () => {
		try {
			const [cfg, contacts, groups] = await Promise.all([service('GET', '/api/email'), service('GET', '/api/email-contacts'), service('GET', '/api/email-groups')])
			return json({
				cuenta_de_envio: cfg.configured ? `${cfg.user} (${cfg.providers?.[cfg.provider] ?? cfg.provider})` : `sin configurar: hacerlo en ${panelUrl}/#ajustes`,
				contactos: contacts.map((c) => ({ nombre: c.name, correos: c.emails })),
				grupos: groups.map((g) => ({ nombre: g.name, integrantes: g.members.map((m) => m.name), correos: g.emails.length })),
			})
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'send_email',
	{
		title: 'Enviar correo',
		description:
			'Envia un correo desde la cuenta configurada en BuhoChat a contactos de la agenda, grupos y/o direcciones. ' +
			'SIEMPRE en dos pasos: primero llama con confirmed=false para obtener la vista previa (destinatarios resueltos), muestrasela al usuario con asunto y texto, ' +
			'y solo vuelve a llamar con confirmed=true despues de que el usuario diga explicitamente que si. Con varios destinatarios va en copia oculta.',
		inputSchema: {
			recipients: z.array(z.string()).min(1).describe('Nombres de contactos, grupos ("grupo Proveedores" o solo "Proveedores") o direcciones de correo'),
			subject: z.string().min(1),
			body: z.string().min(1).describe('Texto del correo'),
			confirmed: z.boolean().default(false).describe('true solo despues de que el usuario confirme el envio'),
		},
		annotations: { destructiveHint: false, openWorldHint: true },
	},
	async ({ recipients, subject, body, confirmed }) => {
		try {
			const preview = await service('POST', '/api/email/send', { recipients, subject, body, preview: true })
			if (!preview.configured) return fail(`La cuenta de correo no esta configurada. El usuario debe hacerlo en ${panelUrl}/#ajustes (Correo para enviar).`)
			const people = preview.recipients.filter((r) => !r.group).map((r) => (r.name === r.email ? r.email : `${r.name} <${r.email}>`))
			const summary = [...preview.groups.map((g) => `grupo ${g.name} (${g.size} correos)`), ...people].join(', ')
			if (!confirmed) {
				return json({
					vista_previa: true,
					para: summary,
					direcciones: preview.recipients.map((r) => r.email),
					copia_oculta: preview.recipients.length > 1,
					asunto: subject,
					texto: body,
					siguiente_paso: 'Muestra esto al usuario y pide confirmacion. Si dice que si, llama de nuevo con confirmed=true.',
				})
			}
			const r = await service('POST', '/api/email/send', { recipients, subject, body, source: 'claude' })
			return text(`Correo enviado a ${summary} (${r.sent} ${r.sent === 1 ? 'destinatario' : 'destinatarios'}).`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'add_email_contact',
	{
		title: 'Agregar contacto de correo',
		description: 'Agrega un contacto a la agenda de correos de BuhoChat y, opcionalmente, a un grupo existente.',
		inputSchema: {
			name: z.string().min(1),
			emails: z.string().min(3).describe('Uno o varios correos separados por comas'),
			group: z.string().optional().describe('Nombre de un grupo existente al que agregarlo'),
		},
	},
	async ({ name, emails, group }) => {
		try {
			const c = await service('POST', '/api/email-contacts', { name, emails })
			if (!group) return text(`Contacto agregado: ${c.name} (${c.emails}).`)
			const groups = await service('GET', '/api/email-groups')
			const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
			const g = groups.find((x) => norm(x.name) === norm(group.replace(/^grupo\s+/i, '')))
			if (!g) return text(`Contacto agregado: ${c.name} (${c.emails}). No existe el grupo "${group}"; los grupos son: ${groups.map((x) => x.name).join(', ') || 'ninguno'}.`)
			await service('PATCH', `/api/email-groups/${g.id}`, { members: [...g.members.map((m) => m.id), c.id] })
			return text(`Contacto agregado: ${c.name} (${c.emails}) y sumado al grupo ${g.name}.`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'save_media',
	{
		title: 'Guardar archivos de un chat en una carpeta',
		description:
			'Descarga las imagenes (y opcionalmente documentos, videos o audios) de un chat de WhatsApp en un rango de fechas y las guarda en una carpeta de la PC con permiso de escritura (Ajustes del panel). ' +
			'Devuelve las rutas guardadas; despues puedes abrirlas con Read para ver su contenido y renombrarlas con move_file.',
		inputSchema: {
			chat: z.string().describe('Chat: nombre, numero o jid'),
			folder: z.string().describe('Carpeta destino (debe estar dentro de una carpeta con escritura); se crea si no existe'),
			since: z.string().optional().describe('Desde (fecha ISO 8601); por defecto todo el historial'),
			until: z.string().optional().describe('Hasta (fecha ISO 8601); por defecto ahora'),
			types: z.array(z.enum(['image', 'document', 'video', 'audio'])).optional().describe('Por defecto solo image'),
			from: z.enum(['received', 'me', 'all']).default('received').describe('Recibidos (por defecto), enviados por mi o todos'),
			limit: z.number().int().min(1).max(200).default(50),
		},
	},
	async (args) => {
		try {
			return json(await service('POST', '/api/media/save', args))
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'move_file',
	{
		title: 'Mover o renombrar un archivo',
		description: 'Mueve o renombra un archivo dentro de las carpetas con permiso de escritura. Crea las subcarpetas que falten. Nunca sobrescribe ni borra.',
		inputSchema: { from: z.string().describe('Ruta actual'), to: z.string().describe('Ruta nueva (incluye el nombre del archivo)') },
	},
	async ({ from, to }) => {
		try {
			const r = await service('POST', '/api/files/move', { from, to })
			return text(`Movido: ${r.from} -> ${r.to}`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'add_phone_contact',
	{
		title: 'Agregar contacto al telefono',
		description:
			'Agrega (o renombra) un contacto en WhatsApp y, por defecto, tambien en la agenda del telefono del usuario. ' +
			'SIEMPRE en dos pasos: llama primero con confirmed=false para validar el numero y ver la vista previa, muestrasela al usuario y solo vuelve a llamar con confirmed=true despues de su "si".',
		inputSchema: {
			name: z.string().min(1).describe('Nombre completo del contacto'),
			phone: z.string().min(8).describe('Numero con codigo de pais, p. ej. +52 81 1234 5678'),
			save_to_phone: z.boolean().default(true).describe('Guardarlo tambien en la agenda del telefono'),
			confirmed: z.boolean().default(false).describe('true solo despues de que el usuario confirme'),
		},
	},
	async ({ name, phone, save_to_phone, confirmed }) => {
		try {
			if (!confirmed) {
				const p = await service('POST', '/api/contacts', { name, phone, save_to_phone, preview: true })
				return json({ vista_previa: true, nombre: p.name, numero: p.phone, en_agenda_del_telefono: p.save_to_phone, ya_existe_como: p.existing_name, siguiente_paso: 'Muestra esto al usuario y espera su confirmacion; luego llama con confirmed=true.' })
			}
			const r = await service('POST', '/api/contacts', { name, phone, save_to_phone })
			return text(`Contacto agregado: ${r.name} (${r.phone})${r.save_to_phone ? ', tambien en la agenda del telefono' : ''}.`)
		} catch (err) {
			return fail(err.message)
		}
	},
)

server.registerTool(
	'upload_chat_to_drive',
	{
		title: 'Subir las fotos de un chat a Drive',
		description:
			'Sube a Google Drive todas las fotos (y opcionalmente PDF) de un chat de WhatsApp, en la carpeta configurada en BuhoChat: <chat>/<AAAA-MM>/ con nombre por dia ("Lunes 13 jul 2026.jpg"). ' +
			'Se procesa en segundo plano (unos 10 segundos por archivo). Confirma con el usuario antes de iniciar si son muchos archivos.',
		inputSchema: {
			chat: z.string().describe('Chat: nombre, numero o jid'),
			types: z.array(z.enum(['image', 'pdf'])).default(['image']),
			from: z.enum(['all', 'them', 'me']).default('all').describe('Todas, solo las que me mandaron, o solo las que envie'),
		},
	},
	async ({ chat, types, from }) => {
		try {
			const r = await service('POST', '/api/drive-bridge/upload-chat', { chat, types, from })
			return text(`${r.queued} archivos de ${r.chat} en cola para subir a Drive (carpeta por mes, nombre por dia). Tardara unos ${Math.ceil(r.queued * 10 / 60)} min.`)
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
