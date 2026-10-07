// Transcripcion local de notas de voz con Whisper (transformers.js). Nada sale de la PC.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { dataDir } from './config.js'

const MODEL = process.env.WHISPER_MODEL ?? 'onnx-community/whisper-small'
let pipelinePromise = null

// Carga perezosa: la primera vez descarga el modelo (~250 MB) a data/models.
async function getPipeline() {
	pipelinePromise ??= (async () => {
		const { pipeline, env } = await import('@huggingface/transformers')
		env.cacheDir = join(dataDir, 'models')
		return pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' })
	})()
	try {
		return await pipelinePromise
	} catch (err) {
		pipelinePromise = null
		throw err
	}
}

// Convierte el audio de WhatsApp (ogg/opus) a PCM float32 mono de 16 kHz, que es lo que espera Whisper.
function decode(buffer) {
	return new Promise((resolve, reject) => {
		const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { windowsHide: true })
		const chunks = []
		let stderr = ''
		ff.stdout.on('data', (c) => chunks.push(c))
		ff.stderr.on('data', (c) => (stderr += c))
		ff.on('error', reject)
		ff.on('close', (code) => {
			if (code !== 0) return reject(new Error(`ffmpeg fallo (${code}): ${stderr.trim()}`))
			const buf = Buffer.concat(chunks)
			resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
		})
		ff.stdin.on('error', () => {})
		ff.stdin.end(buffer)
	})
}

// Las transcripciones van una por una: Whisper usa mucha CPU.
let queue = Promise.resolve()

export function transcribe(audioBuffer) {
	const job = queue.then(async () => {
		const [asr, audio] = await Promise.all([getPipeline(), decode(audioBuffer)])
		const out = await asr(audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30 })
		return (out.text ?? '').trim()
	})
	queue = job.catch(() => {})
	return job
}

export const warmUp = () => getPipeline()
