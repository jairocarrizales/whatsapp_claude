// Bateria de pruebas de Búho (crea documentos reales con "(prueba)" en el titulo, en Drive y en Documentos/BuhoChat).
// Requiere el servicio corriendo y Claude Code con sesion. Uso: node scripts/pruebas-buho.mjs [numero]
// cada pedido pasa por el asistente real (Claude + MCP + servicio), pero lo que
// Búho "enviaria" por WhatsApp se imprime aqui en vez de mandarse. Uso: node _pruebas.mjs [numero de prueba]
import { Assistant } from '../src/assistant.js'
import { BuhoChannel } from '../src/buho.js'
import { synthesize } from '../src/tts.js'
import { transcribe } from '../src/transcribe.js'

const PRUEBAS = [
	{ n: 1, tipo: 'texto', pide: 'Crea una hoja de cálculo con tres pestañas de ejemplo: clientes, productos y ventas. Clientes 50 registros, productos 100 y ventas 200, con el total de cada venta. Título: Ventas de ejemplo (prueba).' },
	{ n: 2, tipo: 'texto', pide: 'Hazme un Google Doc con un reglamento de clase de una página para alumnos de preparatoria: puntualidad, uso del celular, tareas y evaluación. Título: Reglamento de clase (prueba).' },
	{ n: 3, tipo: 'texto', pide: 'Haz una presentación de Google de 5 diapositivas sobre cómo hacer un presupuesto personal, con notas para el expositor. Título: Presupuesto personal (prueba).' },
	{ n: 4, tipo: 'texto', pide: 'Crea un PDF con una lista de 10 tareas para organizar un evento escolar, con fecha límite y responsable en una tabla. Título: Evento escolar (prueba).' },
	{ n: 5, tipo: 'texto', pide: 'Hazme un PowerPoint de 4 diapositivas sobre los beneficios de leer. Título: Beneficios de leer (prueba).' },
	{ n: 6, tipo: 'texto', pide: 'Crea un archivo de Excel en mi computadora con las calificaciones de 30 alumnos en 3 parciales y su promedio. Título: Calificaciones (prueba).' },
	{ n: 7, tipo: 'voz', pide: 'Búho, hazme una hoja de cálculo con el control de gastos de un mes, con 40 gastos de ejemplo por categoría y el total. Ponle de título control de gastos prueba.' },
	{ n: 8, tipo: 'voz', pide: 'Búho, crea un documento de Google con una carta de bienvenida para alumnos nuevos. Título carta de bienvenida prueba.' },
]

const solo = Number(process.argv[2]) || null
const t0 = Date.now()
const store = { db: { prepare: () => ({ get: () => null, run: () => {} }) } }
const resultados = []
for (const p of PRUEBAS.filter((x) => !solo || x.n === solo)) {
	const start = Date.now()
	const salida = []
	const wa = { sock: { user: { id: '1@s.whatsapp.net', name: 'Jairo' }, sendPresenceUpdate: async () => {}, sendMessage: async () => ({}) }, send: async (to, t) => salida.push(t) }
	const b = new BuhoChannel({ wa, store, assistant: new Assistant({ log() {} }), log() {}, dirs: () => [], markOwn() {} })
	let pregunta = p.pide
	if (p.tipo === 'voz') {
		// Se genera una nota de voz real con la voz de Jorge y se transcribe con Whisper, como si la mandaras.
		const v = await synthesize(p.pide)
		pregunta = await transcribe(v.audio)
		pregunta = b.wake(pregunta) ?? pregunta
	}
	await b.ask(pregunta, p.tipo === 'voz')
	const s = Math.round((Date.now() - start) / 1000)
	const final = salida.filter((t) => !/Sigo en eso/.test(t)).at(-1) ?? '(sin respuesta)'
	const ok = !/⚠️|no pude|no puedo|error/i.test(final) && /(docs\.google\.com|Documentos[\\/]BuhoChat|\.pdf|\.pptx|\.xlsx)/i.test(final)
	resultados.push({ n: p.n, tipo: p.tipo, s, ok })
	console.log(`\n=== Prueba ${p.n} (${p.tipo}) ${ok ? 'OK' : 'REVISAR'} en ${s} s${p.tipo === 'voz' ? `\nEntendió: ${pregunta}` : ''}\n${final.slice(0, 900)}`)
}
console.log('\n=== RESUMEN ===')
for (const r of resultados) console.log(`Prueba ${r.n} (${r.tipo}): ${r.ok ? 'OK' : 'REVISAR'} - ${r.s} s`)
console.log(`Total: ${Math.round((Date.now() - t0) / 1000)} s`)
process.exit(0)
