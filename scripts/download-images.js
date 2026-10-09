// Descarga las imagenes recibidas en un chat entre dos fechas (hora local).
// Uso: node scripts/download-images.js <jid> <desde YYYY-MM-DD> <hasta YYYY-MM-DD> <carpeta>
// Cierra el cliente MCP antes: solo una instancia puede usar la sesion.
import { BufferJSON } from 'baileys'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, dbFile } from '../src/config.js'
import { openStore } from '../src/store.js'
import { WhatsApp } from '../src/whatsapp.js'

const [jid, from, to, outDir] = process.argv.slice(2)
if (!outDir) {
	console.error('Uso: node scripts/download-images.js <jid> <desde YYYY-MM-DD> <hasta YYYY-MM-DD> <carpeta>')
	process.exit(1)
}

const store = openStore(dbFile)
const start = new Date(`${from}T00:00:00`).getTime() / 1000
const end = new Date(`${to}T23:59:59`).getTime() / 1000
const rows = store.db
	.prepare(`SELECT id, from_me, ts, raw FROM messages WHERE chat_jid = ? AND type = 'imageMessage' AND from_me = 0 AND ts BETWEEN ? AND ? ORDER BY ts`)
	.all(jid, start, end)
console.log(`${rows.length} imagenes entre ${from} y ${to}`)
if (!rows.length) process.exit(0)

const wa = new WhatsApp({ dataDir, store })
await new Promise((resolve, reject) => {
	const off = wa.on((event) => {
		if (event === 'open') (off(), resolve())
		if (event === 'replaced' || event === 'logged_out') (off(), reject(new Error(`sesion no disponible (${event})`)))
	})
	wa.connect().catch(reject)
})

mkdirSync(outDir, { recursive: true })
let ok = 0
for (const r of rows) {
	const msg = { key: { remoteJid: jid, id: r.id, fromMe: Boolean(r.from_me) }, message: JSON.parse(r.raw, BufferJSON.reviver) }
	const d = new Date(r.ts * 1000)
	const pad = (n) => String(n).padStart(2, '0')
	const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${r.id.slice(-6)}.jpg`
	try {
		// Si el enlace caduco (medios de mas de ~2 semanas), le pide al telefono que lo vuelva a subir.
		const buf = await wa.downloadMedia(msg)
		writeFileSync(join(outDir, name), buf)
		ok++
		console.log('  ok', name)
	} catch (err) {
		console.log('  ERROR', name, err.message)
	}
}
console.log(`${ok}/${rows.length} descargadas en ${outDir}`)
wa.close()
setTimeout(() => process.exit(0), 500)
