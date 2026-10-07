// Mantiene vivo el servicio: si se cae, lo vuelve a lanzar con una espera creciente.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, root } from './config.js'

mkdirSync(dataDir, { recursive: true })
const log = (msg) => appendFileSync(join(dataDir, 'service.log'), `[${new Date().toLocaleString('es-MX')}] [supervisor] ${msg}\n`)

let delay = 2000
function start() {
	const startedAt = Date.now()
	const child = spawn(process.execPath, [join(root, 'src', 'service.js')], { cwd: root, stdio: 'ignore', windowsHide: true })
	child.on('exit', (code) => {
		// El puerto ocupado (codigo 1 al instante) significa que ya hay otro servicio: no insistimos.
		if (code === 1 && Date.now() - startedAt < 3000) {
			log('el servicio no pudo arrancar (¿ya hay otro corriendo?); revisa el log')
			process.exit(1)
		}
		delay = Date.now() - startedAt > 60_000 ? 2000 : Math.min(delay * 2, 60_000)
		log(`el servicio termino (codigo ${code}); reiniciando en ${delay / 1000} s`)
		setTimeout(start, delay)
	})
}
start()
