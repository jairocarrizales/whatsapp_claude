// Envio de correos desde WhatsApp ("envia un correo a Lidia diciendo...") por SMTP.
// La configuracion (incluida la contrasena de aplicacion) se guarda solo en la base local (data/).
import nodemailer from 'nodemailer'

export const PRESETS = {
	gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
	outlook: { label: 'Outlook / Hotmail', host: 'smtp.office365.com', port: 587, secure: false },
	custom: { label: 'Otro (SMTP)' },
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export class Email {
	constructor({ store, log }) {
		this.store = store
		this.log = log
		store.db.exec(`
			CREATE TABLE IF NOT EXISTS email_contacts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				emails TEXT NOT NULL, -- una o varias direcciones separadas por comas (una lista)
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS email_groups (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS email_group_members (
				group_id INTEGER NOT NULL,
				contact_id INTEGER NOT NULL,
				PRIMARY KEY (group_id, contact_id)
			);
			CREATE TABLE IF NOT EXISTS email_log (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				recipients TEXT NOT NULL,
				subject TEXT,
				body TEXT,
				at INTEGER NOT NULL,
				status TEXT NOT NULL, -- sent | failed
				error TEXT,
				source TEXT
			);
		`)
	}

	config() {
		const raw = this.store.db.prepare(`SELECT value FROM meta WHERE key = 'email_config'`).get()?.value
		return raw ? JSON.parse(raw) : null
	}

	// Lo que ve el panel: nunca la contrasena.
	publicConfig() {
		const c = this.config()
		if (!c) return { configured: false }
		return { configured: true, provider: c.provider, user: c.user, name: c.name ?? '', host: c.host, port: c.port, hasPassword: Boolean(c.pass) }
	}

	transport(c) {
		return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15_000 })
	}

	// Guarda la configuracion solo si el servidor acepta el usuario y la contrasena.
	async save(input) {
		const prev = this.config() ?? {}
		const provider = PRESETS[input.provider] ? input.provider : 'custom'
		const preset = PRESETS[provider]
		const c = {
			provider,
			user: String(input.user ?? prev.user ?? '').trim(),
			name: String(input.name ?? prev.name ?? '').trim(),
			// Las contrasenas de aplicacion de Google se muestran con espacios; no forman parte de ella.
			pass: input.pass ? String(input.pass).replace(/\s+/g, '') : prev.pass,
			host: preset.host ?? String(input.host ?? prev.host ?? '').trim(),
			port: preset.port ?? Number(input.port ?? prev.port ?? 587),
			secure: preset.secure ?? Number(input.port ?? prev.port) === 465,
		}
		if (!EMAIL_RE.test(c.user)) throw new Error('Escribe tu dirección de correo completa.')
		if (!c.pass) throw new Error('Falta la contraseña de aplicación.')
		if (!c.host) throw new Error('Falta el servidor SMTP.')
		try {
			await this.transport(c).verify()
		} catch (err) {
			const auth = /auth|credential|535|534|username and password/i.test(err.message)
			throw new Error(auth
				? 'El servidor rechazó el usuario o la contraseña. En Gmail usa una contraseña de aplicación, no tu contraseña normal.'
				: `No se pudo conectar con ${c.host}: ${err.message}`)
		}
		this.store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('email_config', ?)`).run(JSON.stringify(c))
		this.log(`correo configurado: ${c.user} (${PRESETS[provider].label})`)
		return this.publicConfig()
	}

	clear() {
		this.store.db.prepare(`DELETE FROM meta WHERE key = 'email_config'`).run()
	}

	async send({ to, subject, body, source = 'whatsapp' }) {
		const c = this.config()
		if (!c) throw new Error('El correo no está configurado. Hazlo en Ajustes del panel.')
		const recipients = to.map((r) => r.email)
		try {
			await this.transport(c).sendMail({
				from: c.name ? `"${c.name.replace(/"/g, '')}" <${c.user}>` : c.user,
				// Varios destinatarios van en copia oculta para no exponer sus direcciones entre si.
				...(recipients.length > 1 ? { to: c.user, bcc: recipients } : { to: recipients[0] }),
				subject,
				text: body,
			})
			this.store.db.prepare(`INSERT INTO email_log (recipients, subject, body, at, status, source) VALUES (?, ?, ?, ?, 'sent', ?)`)
				.run(recipients.join(', '), subject, body, Math.floor(Date.now() / 1000), source)
			this.log(`correo enviado a ${recipients.join(', ')}: ${subject}`)
		} catch (err) {
			this.store.db.prepare(`INSERT INTO email_log (recipients, subject, body, at, status, error, source) VALUES (?, ?, ?, ?, 'failed', ?, ?)`)
				.run(recipients.join(', '), subject, body, Math.floor(Date.now() / 1000), err.message, source)
			throw err
		}
	}

	contacts() {
		return this.store.db.prepare(`SELECT * FROM email_contacts ORDER BY name`).all()
	}

	// Grupos con sus integrantes y la lista final de correos (sin repetidos).
	groups() {
		const members = this.store.db
			.prepare(`SELECT m.group_id, c.id, c.name, c.emails FROM email_group_members m JOIN email_contacts c ON c.id = m.contact_id ORDER BY c.name`)
			.all()
		return this.store.db.prepare(`SELECT * FROM email_groups ORDER BY name`).all().map((g) => {
			const list = members.filter((m) => m.group_id === g.id)
			const emails = [...new Set(list.flatMap((m) => splitEmails(m.emails)))]
			return { ...g, members: list.map((m) => ({ id: m.id, name: m.name })), emails }
		})
	}

	// Busca contactos y grupos por nombre (sin acentos ni mayusculas); exacto primero, luego parcial.
	// "grupo X" busca solo entre los grupos.
	findRecipients(name) {
		let n = strip(name).replace(/^(?:el|la|los|las|mi|mis)\s+/, '').trim()
		const onlyGroups = /^grupo\s+/.test(n)
		n = n.replace(/^grupo\s+(?:de\s+)?(?:el\s+|la\s+|los\s+|las\s+)?/, '').trim()
		if (!n) return []
		const all = [
			...this.groups().map((g) => ({ kind: 'group', name: g.name, emails: g.emails, size: g.members.length })),
			...(onlyGroups ? [] : this.contacts().map((c) => ({ kind: 'contact', name: c.name, emails: splitEmails(c.emails) }))),
		]
		const exact = all.filter((r) => strip(r.name) === n)
		if (exact.length) return exact
		return all.filter((r) => strip(r.name).includes(n) || n.includes(strip(r.name)))
	}
}

const splitEmails = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

// "juan arroba gmail punto com" -> "juan@gmail.com"
export function normalizeDictatedEmail(s) {
	let t = ' ' + strip(s) + ' '
	t = t
		.replace(/\s+arroba\s+/g, '@')
		.replace(/\s+guion\s+bajo\s+/g, '_')
		.replace(/\s+(?:guion|menos)\s+/g, '-')
		.replace(/\s+punto\s+/g, '.')
		.replace(/\s+/g, '')
		.replace(/[.,;]+$/, '')
	return t
}

const TRIGGER = /^\s*(?:oye\s*,?\s*)?(?:por\s+favor\s*,?\s+)?(?:env[ií]a(?:le|les)?|manda(?:le|les)?|m[aá]nda(?:le|les)|escr[ií]be(?:le|les)?)\s+(?:un\s+)?(?:correo(?:\s+electr[oó]nico)?|e-?mail|mail|email)\s+(?:al?|para)\s+/i
// Lo que separa los destinatarios (y el asunto) del cuerpo del correo.
const BODY_SEP = /\s*:\s*|\s+(?:diciendo(?:le|les)?|que\s+(?:diga|dice|digan)|con\s+el\s+(?:mensaje|texto)|para\s+decir(?:le|les)?)\s*:?\s+/i
const SUBJECT = /\s+con\s+(?:el\s+)?asunto\s+(.+)$/i

/**
 * Interpreta "envia un correo a <destinatarios> [con asunto <asunto>] diciendo <cuerpo>".
 * @returns {{ ok: true, to: {name, email}[], subject: string, body: string } | { ok: false, error: string, detail?: string } | null}
 *          null si la frase no es un pedido de correo.
 */
export function parseEmailCommand(text, email) {
	const m = text.match(TRIGGER)
	if (!m) return null
	const rest = text.slice(m[0].length).trim()
	const sep = rest.match(BODY_SEP)
	if (!sep) return { ok: false, error: 'no-body' }
	let head = rest.slice(0, sep.index).trim()
	let body = rest.slice(sep.index + sep[0].length).trim()
	if (!body) return { ok: false, error: 'no-body' }

	let subject = null
	const sub = head.match(SUBJECT)
	if (sub) {
		subject = sub[1].trim()
		head = head.slice(0, sub.index).trim()
	}

	// Varios destinatarios: "Lidia y Carlos", "Lidia, Carlos". Una direccion dictada no se parte por "y".
	const parts = /arroba|@/i.test(head) && !/,|\s+y\s+[^@]*\barroba\b|\s+y\s+\S+@/i.test(head) ? [head] : head.split(/\s*,\s*|\s+y\s+/i)
	const resolved = resolveRecipients(parts, email)
	if (!resolved.ok) return resolved
	const { to, groups } = resolved

	body = body.replace(/^que\s+/i, '')
	body = body[0].toUpperCase() + body.slice(1)
	if (!subject) {
		const first = body.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '')
		subject = first.length > 60 ? first.slice(0, 57).replace(/\s+\S*$/, '') + '…' : first
	}
	subject = subject[0].toUpperCase() + subject.slice(1)
	return { ok: true, to, groups, subject, body }
}

/**
 * Convierte nombres de contactos, grupos ("grupo X" o solo "X") y direcciones (escritas o dictadas)
 * en la lista final de correos, sin repetidos. La usan WhatsApp, el panel y el MCP.
 * @returns {{ ok: true, to: {name, email, group}[], groups: {name, size}[] } | { ok: false, error: string, detail?: string }}
 */
export function resolveRecipients(parts, email) {
	const to = []
	const unknown = []
	const groups = []
	for (const part of parts.map((p) => String(p).trim().replace(/^(?:al?|para)\s+/i, '')).filter(Boolean)) {
		if (/arroba|@/i.test(part)) {
			const addr = normalizeDictatedEmail(part)
			if (EMAIL_RE.test(addr)) to.push({ name: addr, email: addr, group: null })
			else unknown.push(part)
			continue
		}
		const found = email.findRecipients(part)
		if (found.length === 1) {
			const r = found[0]
			if (r.kind === 'group') {
				if (!r.emails.length) return { ok: false, error: 'empty-group', detail: r.name }
				groups.push({ name: r.name, size: r.emails.length })
			}
			for (const e of r.emails) to.push({ name: r.name, email: e, group: r.kind === 'group' ? r.name : null })
		} else if (found.length > 1) {
			const label = (f) => (f.kind === 'group' ? `grupo ${f.name}` : f.name)
			return { ok: false, error: 'ambiguous', detail: `"${part}" coincide con: ${found.map(label).join(', ')}` }
		} else unknown.push(part)
	}
	if (unknown.length) return { ok: false, error: 'unknown', detail: unknown.join(', ') }
	if (!to.length) return { ok: false, error: 'no-recipient' }
	const seen = new Set()
	return { ok: true, to: to.filter((r) => !seen.has(r.email) && seen.add(r.email)), groups }
}
