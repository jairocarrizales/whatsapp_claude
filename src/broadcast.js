// Ritmo de los envios a listas de difusion: espera base + extra al azar entre mensajes,
// y un descanso cada cierto numero de personas. Configurable en Ajustes.
export const DEFAULT_PACE = { gapSec: 60, jitterMinSec: 30, jitterMaxSec: 90, pauseEvery: 5, pauseSec: 300 }

export function getPace(store) {
	const raw = store.db.prepare(`SELECT value FROM meta WHERE key = 'broadcast_pace'`).get()?.value
	return { ...DEFAULT_PACE, ...(raw ? JSON.parse(raw) : {}) }
}

export function savePace(store, input) {
	const n = (v, def) => (v === undefined || v === '' || v === null ? def : Math.round(Number(v)))
	const cur = getPace(store)
	const p = {
		gapSec: n(input.gapSec, cur.gapSec),
		jitterMinSec: n(input.jitterMinSec, cur.jitterMinSec),
		jitterMaxSec: n(input.jitterMaxSec, cur.jitterMaxSec),
		pauseEvery: n(input.pauseEvery, cur.pauseEvery),
		pauseSec: n(input.pauseSec, cur.pauseSec),
	}
	if (Object.values(p).some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Usa números de 0 en adelante.')
	if (p.gapSec < 20) throw new Error('La espera base debe ser de al menos 20 segundos.')
	if (p.jitterMaxSec < p.jitterMinSec) throw new Error('El extra máximo no puede ser menor que el mínimo.')
	if (p.pauseEvery > 0 && p.pauseSec < 30) throw new Error('El descanso debe durar al menos 30 segundos.')
	store.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('broadcast_pace', ?)`).run(JSON.stringify(p))
	return p
}

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

// Horario (en segundos epoch) para `count` personas a partir de `start`.
export function planTimes(start, count, pace) {
	const times = []
	let t = start
	for (let i = 0; i < count; i++) {
		if (i > 0) {
			t += pace.gapSec + rand(pace.jitterMinSec, pace.jitterMaxSec)
			// Descanso despues de cada bloque de `pauseEvery` personas.
			if (pace.pauseEvery > 0 && i % pace.pauseEvery === 0) t += pace.pauseSec
		}
		times.push(t)
	}
	return times
}

// "Hola {nombre}, ..." -> "Hola Lidia, ...". Sin nombre conocido (solo numero): "Hola, ...".
export function personalize(text, name) {
	const first = name && !/^\+?\d/.test(name) ? name.trim().split(/\s+/)[0] : ''
	let out = text.replace(/\{\s*nombre\s*\}/gi, first)
	if (!first) out = out.replace(/\s+([,.!?;:])/g, '$1').replace(/ {2,}/g, ' ')
	return out
}
