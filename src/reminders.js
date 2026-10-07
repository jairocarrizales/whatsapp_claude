// Interpreta frases como "recuérdame mañana a las 8 pagar la luz" -> fecha, repeticion y tarea.
import { es } from 'chrono-node'

const NUM = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
const DEFAULT_HOUR = 9 // "mañana pagar la renta" (sin hora) -> 9:00

const TRIGGER = /^\s*(?:oye\s*,?\s*)?(?:por\s+favor\s+)?(?:recu[eé]rd[ae]me|recordarme|recordatorio|recuerda(?:me)?|av[ií]same|env[ií]ame|m[aá]ndame)\b\s*(?:que\s+|de\s+|a\s+)?/i

// Repeticiones habladas: se detectan y se quitan de la frase.
const REPEATS = [
	[/\b(?:(?:de\s+)?lunes\s+a\s+viernes|entre\s+semana|todos\s+los\s+d[ií]as\s+h[aá]biles|cada\s+d[ií]a\s+h[aá]bil)\b/i, 'weekdays'],
	[/\b(?:todos\s+los\s+d[ií]as|cada\s+d[ií]a|diario|diariamente)\b/i, 'daily'],
	[/\b(?:cada\s+semana|semanalmente|todas\s+las\s+semanas)\b/i, 'weekly'],
	[/\b(?:cada|todos\s+los)\s+(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)\b/i, 'weekly'],
]

// Normaliza lo que Whisper suele escribir para que chrono lo entienda.
function normalize(text) {
	return text
		.replace(/[¿¡]/g, '')
		.replace(/\b(a\s+las?|las?)\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/gi, (_, p, n) => `${p} ${NUM[n.toLowerCase()]}`)
		.replace(/\b(\d{1,2})\s+y\s+media\b/gi, '$1:30')
		.replace(/\b(\d{1,2})\s+y\s+cuarto\b/gi, '$1:15')
		// "5 y 25" / "5 con 10" -> 5:25 (pero no "7 y 8 de octubre")
		.replace(/\b(\d{1,2})\s+(?:y|con)\s+(\d{1,2})\b(?!\s*(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))/gi,
			(m, h, min) => (Number(h) <= 23 && Number(min) <= 59 ? `${h}:${min.padStart(2, '0')}` : m))
		// Año hablado: "7 de octubre, el 26" / "del 2026" -> "7 de octubre de 2026"
		.replace(/\b(\d{1,2}\s+de\s+[a-záéíóú]+)\s*,?\s*(?:del?|el)\s+(?:año\s+)?(?:20)?(\d{2})\b/gi, '$1 de 20$2')
		.replace(/\b(?:del|el)\s+d[ií]a\s+(\d{1,2}\s+de\b)/gi, '$1')
		.replace(/\b(\d{1,2})\s+menos\s+cuarto\b/gi, (_, h) => `${(Number(h) + 11) % 12 || 12}:45`)
		.replace(/\b(\d{1,2})(:\d{2})?\s+de\s+la\s+(?:tarde|noche)\b/gi, '$1$2 pm')
		.replace(/\b(\d{1,2})(:\d{2})?\s+de\s+la\s+(?:mañana|madrugada)\b/gi, '$1$2 am')
		.replace(/\b(\d{1,2})(:\d{2})?\s*(?:p\.\s*m\.|pm)/gi, '$1$2 pm')
		.replace(/\b(\d{1,2})(:\d{2})?\s*(?:a\.\s*m\.|am)/gi, '$1$2 am')
		.replace(/\bmediod[ií]a\b/gi, '12 pm')
		.replace(/\s+/g, ' ')
		.trim()
}

function cleanTask(text) {
	return text
		.replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
		.replace(/^(?:que\s+|de\s+|a\s+|para\s+|el\s+|la\s+)+/i, '')
		.replace(/\s+(?:el|la|a|de|que|para)$/i, '')
		.replace(/\s+/g, ' ')
		.trim()
}

// Une las piezas que chrono encuentra por separado ("a las 5:25 pm" + "7 de octubre")
// y decide am/pm cuando no se dijo: la primera hora futura que tenga sentido.
function resolveDate(results, now, repeat) {
	// Relativo ("en 2 horas", "dentro de 20 minutos"): chrono ya da la fecha exacta.
	const rel = results.find((r) => /^(en|dentro)b/i.test(r.text))
	if (rel) return rel.start.date()

	const dayRes = results.find((r) => r.start.isCertain('day') || r.start.isCertain('weekday'))
	const timeRes = results.find((r) => r.start.isCertain('hour'))

	const base = new Date(now)
	if (dayRes) {
		const d = dayRes.start.date()
		base.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
		// forwardDate manda "7 de octubre" (hoy) al año siguiente si la hora por defecto ya paso.
		if (!dayRes.start.isCertain('year')) {
			base.setFullYear(now.getFullYear())
			const today = new Date(now)
			today.setHours(0, 0, 0, 0)
			const day = new Date(base)
			day.setHours(0, 0, 0, 0)
			if (day < today) base.setFullYear(now.getFullYear() + 1)
		}
	}

	const at = (d, h, m) => {
		const x = new Date(d)
		x.setHours(h, m, 0, 0)
		return x
	}
	if (!timeRes) {
		const d = at(base, DEFAULT_HOUR, 0)
		if (!dayRes && d <= now) d.setDate(d.getDate() + 1)
		return d
	}

	const h = timeRes.start.get('hour')
	const m = timeRes.start.get('minute') ?? 0
	const ambiguous = !timeRes.start.isCertain('meridiem') && h >= 1 && h <= 11
	const days = dayRes ? [base] : [base, new Date(base.getTime() + 86400000)]
	const candidates = []
	for (const d of days) {
		candidates.push(at(d, h, m))
		if (ambiguous) candidates.push(at(d, h + 12, m))
	}
	const next = candidates.filter((c) => c > now).sort((x, y) => x - y)[0]
	if (next && repeat === 'weekdays') while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1)
	return next ?? null
}

/**
 * @returns {{ ok: true, sendAt: Date, repeat: string, task: string } | { ok: false, error: string }}
 */
// requireTrigger=false (notas de voz a tu propio chat): basta con que se mencione una fecha u hora.
export function parseReminder(raw, now = new Date(), { requireTrigger = true } = {}) {
	let text = normalize(raw)
	const hasTrigger = TRIGGER.test(text)
	const startsWithDate = /^\s*(en|dentro\s+de|hoy|mañana|pasado|el|este|esta|a\s+las|todos|cada|de\s+lunes)\b/i.test(text)
	if (requireTrigger && !hasTrigger && !startsWithDate) return { ok: false, error: 'not-a-reminder' }
	// Sin palabra clave, una frase sin fecha es un apunte, no un recordatorio fallido.
	if (!hasTrigger && !startsWithDate && !es.parse(text, now).length) return { ok: false, error: 'not-a-reminder' }
	text = text.replace(TRIGGER, '')

	let repeat = 'none'
	for (const [re, kind] of REPEATS) {
		const m = text.match(re)
		if (m) {
			repeat = kind
			// "cada lunes" -> deja "lunes" para que chrono calcule el dia.
			text = kind === 'weekly' && m[1] ? text.replace(re, m[1]) : text.replace(re, ' ')
			break
		}
	}

	const results = es.parse(text, now, { forwardDate: true })
	if (!results.length) return { ok: false, error: 'no-date' }
	const date = resolveDate(results, now, repeat)
	if (!date || date <= now) return { ok: false, error: 'past' }

	let task = text
	for (const r of [...results].sort((x, y) => y.index - x.index)) task = task.slice(0, r.index) + ' ' + task.slice(r.index + r.text.length)
	task = cleanTask(task)
	// "... que diga cenar" / "que me diga X": el texto del recordatorio es lo que sigue.
	const says =
		task.match(/(?:^|\bque\s+)(?:me\s+)?(?:diga|digas|ponga|escriba)\b\s*:?\s*(.+)$/i) ??
		task.match(/\bcon\s+(?:la\s+palabra|el\s+(?:texto|mensaje))\s*:?\s*(.+)$/i)
	if (says) task = cleanTask(says[1])
	if (!task) return { ok: false, error: 'no-task' }
	return { ok: true, sendAt: date, repeat, task: task[0].toUpperCase() + task.slice(1) }
}
