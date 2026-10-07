// Interpreta frases como "recuérdame mañana a las 8 pagar la luz" -> fecha, repeticion y tarea.
import { es } from 'chrono-node'

const NUM = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 }
const DEFAULT_HOUR = 9 // "mañana pagar la renta" (sin hora) -> 9:00

const TRIGGER = /^\s*(?:oye\s*,?\s*)?(?:por\s+favor\s+)?(?:recu[eé]rdame|recordarme|recordatorio|recuerda(?:me)?|av[ií]same)\b\s*(?:que\s+|de\s+|a\s+)?/i

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

/**
 * @returns {{ ok: true, sendAt: Date, repeat: string, task: string } | { ok: false, error: string }}
 */
export function parseReminder(raw, now = new Date()) {
	let text = normalize(raw)
	if (!TRIGGER.test(text) && !/^\s*(en|dentro\s+de|hoy|mañana|pasado|el|este|esta|a\s+las|todos|cada|de\s+lunes)\b/i.test(text)) {
		return { ok: false, error: 'not-a-reminder' }
	}
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
	const r = results.find((x) => x.start.isCertain('hour')) ?? results[0]
	const date = r.start.date()

	if (!r.start.isCertain('hour')) {
		date.setHours(DEFAULT_HOUR, 0, 0, 0)
		if (date <= now) date.setDate(date.getDate() + 1)
	} else if (!r.start.isCertain('meridiem') && !r.start.isCertain('day') && !r.start.isCertain('weekday') && date.getHours() >= 1 && date.getHours() <= 11) {
		// "a las 8" dicho a las 5 pm significa hoy a las 8 pm, no mañana a las 8 am.
		const pm = new Date(now)
		pm.setHours(date.getHours() + 12, date.getMinutes(), 0, 0)
		if (pm > now) date.setTime(pm.getTime())
	}
	date.setSeconds(0, 0)
	if (repeat === 'weekdays') while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
	if (date <= now) return { ok: false, error: 'past' }

	let task = text.slice(0, r.index) + ' ' + text.slice(r.index + r.text.length)
	for (const other of results) if (other !== r) task = task.replace(other.text, ' ')
	task = cleanTask(task)
	if (!task) return { ok: false, error: 'no-task' }
	return { ok: true, sendAt: date, repeat, task: task[0].toUpperCase() + task.slice(1) }
}
