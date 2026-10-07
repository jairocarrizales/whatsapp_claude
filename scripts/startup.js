// Instala o quita el arranque automatico del servicio al iniciar sesion en Windows.
// Uso: npm run install-startup | npm run uninstall-startup
import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { panelPort, root } from '../src/config.js'

if (process.platform !== 'win32') {
	console.error('Este instalador es solo para Windows.')
	process.exit(1)
}

const startupDir = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const launcher = join(startupDir, 'whatsapp-panel.vbs')
const supervisor = join(root, 'src', 'supervisor.js')

if (process.argv[2] === 'uninstall') {
	rmSync(launcher, { force: true })
	// Detiene el supervisor y el servicio en ejecucion.
	spawn('powershell', ['-NoProfile', '-Command',
		"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'whatsapp.*(supervisor|service)\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
	{ stdio: 'inherit' }).on('exit', () => console.log('Arranque automatico eliminado y servicio detenido.'))
} else {
	// VBScript con ventana oculta (0): asi no queda una consola abierta.
	const q = (s) => s.replace(/"/g, '""')
	writeFileSync(launcher, `CreateObject("WScript.Shell").Run """${q(process.execPath)}"" ""${q(supervisor)}""", 0, False\r\n`)
	console.log(`Instalado: ${launcher}`)
	if (!existsSync(launcher)) process.exit(1)
	spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore' }).unref()
	console.log(`Servicio iniciado. Panel: http://localhost:${panelPort}`)
}
