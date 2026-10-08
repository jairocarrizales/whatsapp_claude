// Asistente dentro del panel: ejecuta Claude Code en modo no interactivo (con la suscripcion del usuario)
// conectado solo al MCP de BuhoChat y a sus conectores de claude.ai. Sin acceso a terminal ni archivos.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, root } from './config.js'

const TIMEOUT_MS = 4 * 60_000

// Herramientas de Claude Code que el asistente del panel nunca debe usar.
const BLOCKED = [
	'Bash', 'PowerShell', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch',
	'Task', 'Agent', 'AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'DesignSync', 'EnterPlanMode', 'ExitPlanMode',
	'EnterWorktree', 'ExitWorktree', 'Monitor', 'PushNotification', 'RemoteTrigger', 'ScheduleWakeup', 'Skill',
	'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate', 'Workflow',
]

// Etiquetas legibles para mostrar en el panel lo que el asistente esta haciendo.
const TOOL_LABEL = {
	whatsapp_status: 'Revisando la conexión', list_chats: 'Revisando tus chats', get_messages: 'Leyendo mensajes',
	search_messages: 'Buscando en tus mensajes', search_contacts: 'Buscando contactos', send_message: 'Preparando el mensaje',
	mark_as_read: 'Marcando como leído', schedule_message: 'Preparando la programación', list_scheduled: 'Revisando programados',
	cancel_scheduled: 'Cancelando', list_resources: 'Revisando tus carpetas de Drive', add_resource: 'Guardando el enlace',
	remove_resource: 'Quitando el enlace', list_email_contacts: 'Revisando tu agenda de correos', send_email: 'Preparando el correo',
	add_email_contact: 'Agregando el contacto', list_broadcast_lists: 'Revisando tus listas',
}

function systemPrompt() {
	const now = new Date()
	return [
		'Eres el asistente de BuhoChat, el panel con el que el usuario (Jairo Carrizales) administra su WhatsApp. Respondes dentro del panel, en español, de forma breve y clara.',
		`Fecha y hora actual: ${now.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })} (zona ${Intl.DateTimeFormat().resolvedOptions().timeZone}). Usa fechas ISO con zona horaria al programar.`,
		'Tienes las herramientas de BuhoChat (WhatsApp, mensajes programados, listas de difusión, correo con agenda y grupos, carpetas de Drive numeradas) y los conectores del usuario (Google Drive, Gmail, Calendar). Búscalas con ToolSearch cuando las necesites.',
		'REGLA OBLIGATORIA: antes de enviar, programar o cancelar cualquier mensaje o correo, primero llama la herramienta sin confirmar para obtener la vista previa, muéstrasela al usuario (destinatario, texto, fecha) y espera a que responda que sí en un mensaje nuevo. Nunca confirmes por tu cuenta. Para correos usa send_email de BuhoChat, no el conector de Gmail.',
		'Consultar (leer chats, buscar, listar) no necesita confirmación.',
		'Formato: texto simple con **negritas** y listas con "- " cuando ayuden. Nada de tablas largas ni encabezados. No menciones nombres internos de herramientas.',
	].join('\n')
}

export class Assistant {
	constructor({ log }) {
		this.log = log
		this.cwd = join(dataDir, 'assistant')
		mkdirSync(this.cwd, { recursive: true })
		this.mcpConfig = join(this.cwd, 'mcp.json')
		writeFileSync(this.mcpConfig, JSON.stringify({ mcpServers: { whatsapp: { command: process.execPath, args: [join(root, 'src', 'index.js')] } } }, null, 2))
		this.bin = process.env.CLAUDE_BIN || this.findClaude()
		this.busy = false
	}

	findClaude() {
		try {
			return execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find((l) => /claude(\.exe)?$/i.test(l.trim()))?.trim() ?? 'claude'
		} catch {
			return 'claude'
		}
	}

	/**
	 * Envia un mensaje del usuario. `onEvent` recibe { type: 'status' | 'text' | 'done' | 'error', ... }.
	 * Con `sessionId` continua la conversacion anterior.
	 */
	run(message, sessionId, onEvent) {
		if (this.busy) {
			onEvent({ type: 'error', error: 'El asistente todavía está respondiendo el mensaje anterior.' })
			return () => {}
		}
		this.busy = true
		const args = [
			'-p', '--output-format', 'stream-json', '--verbose',
			'--model', process.env.ASSISTANT_MODEL || 'sonnet',
			'--system-prompt', systemPrompt(),
			'--allowedTools', 'mcp__whatsapp', 'mcp__claude_ai_Google_Drive', 'mcp__claude_ai_Google_Calendar', 'ToolSearch',
			'--disallowedTools', ...BLOCKED,
			...(sessionId ? ['--resume', sessionId] : []),
			'--mcp-config', this.mcpConfig,
		]
		const child = spawn(this.bin, args, { cwd: this.cwd, windowsHide: true, env: { ...process.env } })
		let buf = ''
		let finished = false
		let newSession = sessionId ?? null
		let stderr = ''
		const finish = (ev) => {
			if (finished) return
			finished = true
			this.busy = false
			clearTimeout(timer)
			onEvent(ev)
		}
		const timer = setTimeout(() => {
			child.kill()
			finish({ type: 'error', error: 'El asistente tardó demasiado en responder.' })
		}, TIMEOUT_MS)

		child.stdout.on('data', (chunk) => {
			buf += chunk
			let i
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim()
				buf = buf.slice(i + 1)
				if (!line) continue
				let e
				try {
					e = JSON.parse(line)
				} catch {
					continue
				}
				if (e.session_id) newSession = e.session_id
				if (e.type === 'assistant') {
					for (const c of e.message?.content ?? []) {
						if (c.type === 'tool_use') {
							const name = String(c.name).replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
							const label = TOOL_LABEL[name] ?? (c.name === 'ToolSearch' ? null : /drive/i.test(c.name) ? 'Consultando Google Drive' : /calendar/i.test(c.name) ? 'Consultando tu calendario' : 'Trabajando')
							if (label) onEvent({ type: 'status', text: label })
						} else if (c.type === 'text' && c.text.trim()) {
							onEvent({ type: 'text', text: c.text })
						}
					}
				} else if (e.type === 'result') {
					if (e.is_error || e.subtype !== 'success') finish({ type: 'error', error: e.result || 'El asistente no pudo completar la respuesta.', session: newSession })
					else finish({ type: 'done', session: newSession })
				}
			}
		})
		child.stderr.on('data', (c) => (stderr += c))
		child.on('error', (err) => {
			this.log(`asistente: no se pudo iniciar Claude Code (${this.bin}): ${err.message}`)
			finish({ type: 'error', error: 'No se pudo iniciar Claude Code en esta PC. ¿Está instalado y con tu sesión iniciada?' })
		})
		child.on('close', (code) => {
			if (!finished) {
				this.log(`asistente: Claude Code termino con codigo ${code}: ${stderr.slice(0, 400)}`)
				finish({ type: 'error', error: /login|auth|credential/i.test(stderr) ? 'Claude Code no tiene tu sesión iniciada. Abre una terminal y ejecuta: claude' : 'El asistente se detuvo inesperadamente.', session: newSession })
			}
		})
		child.stdin.end(message)
		return () => child.kill()
	}
}
