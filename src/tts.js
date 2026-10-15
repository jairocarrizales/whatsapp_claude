// Texto a voz para responder con notas de voz de WhatsApp.
// Primero las voces neuronales de Microsoft (las de "Leer en voz alta" de Edge: naturales, gratis, por internet);
// si fallan, Piper, que corre en la PC sin internet. El resultado se convierte a OGG Opus, el formato de las notas de voz.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { dataDir } from './config.js'

const VOICE = process.env.TTS_VOICE || 'es-MX-JorgeNeural'
const MS_TIMEOUT_MS = 20_000

// Piper: version oficial y voz en espanol de Mexico. Se descargan una vez (~85 MB) para tener respaldo sin internet.
const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/'
const PIPER_ASSET = { win32: 'piper_windows_amd64.zip', linux: 'piper_linux_x86_64.tar.gz', darwin: process.arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz' }[process.platform]
const PIPER_VOICE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_MX/claude/high/es_MX-claude-high.onnx'
const piperDir = join(dataDir, 'models', 'piper')
const piperBin = join(piperDir, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper')
const piperModel = join(piperDir, 'es_MX-claude-high.onnx')

// Lo que se lee en voz alta: sin formato de WhatsApp/Markdown, sin emojis y sin enlaces.
export function speakable(text) {
	return String(text)
		.replace(/https?:\/\/\S+/g, 'el enlace')
		.replace(/[*_~`#>|]/g, '')
		.replace(/^\s*[-•]\s+/gm, '')
		.replace(/\p{Extended_Pictographic}️?/gu, '')
		.replace(/\n{2,}/g, '\n')
		.trim()
}

function run(cmd, args, input) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { windowsHide: true })
		const out = []
		let err = ''
		child.stdout.on('data', (c) => out.push(c))
		child.stderr.on('data', (c) => (err += c))
		child.on('error', reject)
		child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} termino con codigo ${code}: ${err.slice(-300)}`))))
		if (input !== undefined) child.stdin.end(input)
	})
}

async function microsoft(text) {
	const tts = new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: MS_TIMEOUT_MS })
	try {
		await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
		const { audioStream } = tts.toStream(text)
		const chunks = []
		for await (const c of audioStream) chunks.push(c)
		const buf = Buffer.concat(chunks)
		if (buf.length < 1000) throw new Error('audio vacio')
		return buf
	} finally {
		tts.close()
	}
}

export function piperReady() {
	return existsSync(piperBin) && existsSync(piperModel) && existsSync(piperModel + '.json')
}

async function download(url, file) {
	const res = await fetch(url, { redirect: 'follow' })
	if (!res.ok) throw new Error(`descarga ${res.status}: ${url}`)
	writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

// Descarga Piper y la voz si faltan. Se llama al arrancar, para que el respaldo ya este listo si falla internet.
export async function ensurePiper(log = () => {}) {
	if (piperReady() || !PIPER_ASSET || process.env.TTS_FALLBACK === '0') return piperReady()
	mkdirSync(piperDir, { recursive: true })
	log('voz: descargando Piper (respaldo sin internet, ~85 MB, una sola vez)')
	if (!existsSync(piperBin)) {
		const archive = join(piperDir, PIPER_ASSET)
		await download(PIPER_RELEASE + PIPER_ASSET, archive)
		// El tar de Windows 10+ tambien abre .zip (se usa el del sistema: el de Git Bash confunde "C:" con un servidor).
		const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
		await run(tar, ['-xf', archive, '-C', piperDir])
		rmSync(archive, { force: true })
	}
	if (!existsSync(piperModel)) await download(PIPER_VOICE, piperModel)
	if (!existsSync(piperModel + '.json')) await download(PIPER_VOICE + '.json', piperModel + '.json')
	log('voz: Piper listo')
	return piperReady()
}

async function piper(text) {
	if (!piperReady()) throw new Error('Piper no esta instalado')
	const wav = join(tmpdir(), `buho-piper-${process.pid}-${Date.now()}.wav`)
	try {
		await run(piperBin, ['--model', piperModel, '--output_file', wav], text)
		return readFileSync(wav)
	} finally {
		rmSync(wav, { force: true })
	}
}

// Devuelve { audio: Buffer OGG Opus, seconds, engine } listo para mandarse como nota de voz.
export async function synthesize(text, log = () => {}) {
	const say = speakable(text)
	if (!say) throw new Error('No hay texto para leer.')
	let raw
	let engine = 'microsoft'
	try {
		raw = await microsoft(say)
	} catch (err) {
		log(`voz: Microsoft no respondio (${err.message}); uso Piper`)
		engine = 'piper'
		raw = await piper(say)
	}
	const ogg = await run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', 'pipe:1'], raw)
	// Duracion aproximada para la burbuja de la nota de voz (32 kbps).
	const seconds = Math.max(1, Math.round((ogg.length * 8) / 32_000))
	return { audio: ogg, seconds, engine }
}
