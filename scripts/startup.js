// Instala o quita el arranque automatico del servicio al iniciar sesion en Windows.
// Uso: npm run install-startup | npm run uninstall-startup
// Reinstalar tambien reinicia el servicio (util despues de `git pull`).
import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { panelPort, root } from '../src/config.js'

if (process.platform !== 'win32') {
	console.error('Este instalador es solo para Windows. En otros sistemas usa `npm run service`.')
	process.exit(1)
}

const startupDir = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const launcher = join(startupDir, 'whatsapp-panel.vbs')
const supervisor = join(root, 'src', 'supervisor.js')

// Detiene el supervisor y el servicio de ESTA carpeta si estan corriendo.
function stopRunning() {
	const script = `
		$src = '${join(root, 'src').replace(/'/g, "''")}'
		Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
			Where-Object { $_.CommandLine -and ($_.CommandLine.Contains("$src\\supervisor.js") -or $_.CommandLine.Contains("$src\\service.js")) } |
			ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
	return new Promise((resolve) => {
		spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' }).on('exit', () => setTimeout(resolve, 1000))
	})
}

if (process.argv[2] === 'uninstall') {
	rmSync(launcher, { force: true })
	await stopRunning()
	console.log('Arranque automatico eliminado y servicio detenido.')
} else {
	await stopRunning()
	// VBScript con ventana oculta (0): asi no queda una consola abierta.
	const q = (s) => s.replace(/"/g, '""')
	writeFileSync(launcher, `CreateObject("WScript.Shell").Run """${q(process.execPath)}"" ""${q(supervisor)}""", 0, False\r\n`)
	if (!existsSync(launcher)) process.exit(1)
	console.log(`Instalado: ${launcher}`)
	spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore' }).unref()
	console.log(`Servicio iniciado. Panel: http://localhost:${panelPort}`)
}
