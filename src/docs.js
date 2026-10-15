// Documentos nuevos que el asistente crea a pedido: PDF y PowerPoint en la PC (carpeta Documentos/BuhoChat), y
// Google Docs, Hojas de cálculo y Presentaciones en el Drive del usuario (a través del puente de Apps Script).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import PptxGenJS from 'pptxgenjs'

export const docsDir = process.env.BUHO_DOCS_DIR || join(homedir(), 'Documents', 'BuhoChat')

export function safeName(title) {
	return String(title || 'Documento').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Documento'
}

// "Informe.pdf", y si ya existe "Informe (2).pdf": nunca se sobrescribe nada.
export function uniquePath(dir, title, ext) {
	mkdirSync(dir, { recursive: true })
	const base = safeName(title)
	let file = join(dir, `${base}.${ext}`)
	for (let n = 2; existsSync(file); n++) file = join(dir, `${base} (${n}).${ext}`)
	return file
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Pagina completa con un estilo sobrio. La politica de contenido impide scripts, formularios y conexiones:
// el HTML lo escribe la IA y podria venir influido por mensajes de terceros.
export function wrapHtml(title, body) {
	return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${esc(title)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #24262C; font-size: 11pt; line-height: 1.5; }
h1 { font-size: 20pt; margin: 0 0 4mm; } h2 { font-size: 14pt; margin: 7mm 0 2mm; } h3 { font-size: 12pt; margin: 5mm 0 2mm; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 10pt; }
th, td { border: 1px solid #D5D8D2; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #EEF3EE; } td.num, th.num { text-align: right; }
.muted { color: #6B7069; font-size: 9.5pt; }
</style></head><body>${/<h1[\s>]/i.test(body) ? '' : `<h1>${esc(title)}</h1>`}${body}</body></html>`
}

function findBrowser() {
	if (process.env.BUHO_BROWSER) return process.env.BUHO_BROWSER
	const candidates = {
		win32: [
			join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
			join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
			join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
		],
		darwin: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
		linux: ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
	}[process.platform] ?? []
	const found = candidates.find((p) => existsSync(p))
	if (!found) throw new Error('Para crear PDF hace falta Microsoft Edge o Google Chrome (o define BUHO_BROWSER con su ruta).')
	return found
}

// HTML -> PDF con el navegador en modo sin ventana, sin JavaScript y con un perfil temporal.
export async function makePdf(title, html) {
	const work = mkdtempSync(join(tmpdir(), 'buho-pdf-'))
	try {
		const page = join(work, 'doc.html')
		const out = join(work, 'doc.pdf')
		writeFileSync(page, wrapHtml(title, html), 'utf8')
		await new Promise((resolve, reject) => {
			const child = spawn(findBrowser(), [
				'--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
				'--disable-javascript', '--no-pdf-header-footer', `--user-data-dir=${join(work, 'perfil')}`,
				`--print-to-pdf=${out}`, pathToFileURL(page).href,
			], { windowsHide: true })
			const timer = setTimeout(() => { child.kill(); reject(new Error('El PDF tardó demasiado.')) }, 60_000)
			child.on('error', (err) => { clearTimeout(timer); reject(err) })
			child.on('close', () => { clearTimeout(timer); resolve() })
		})
		if (!existsSync(out)) throw new Error('El navegador no generó el PDF.')
		return readFileSync(out)
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

// Presentacion 16:9 sobria: portada y diapositivas con titulo, texto y viñetas (y notas del orador).
// slides = [{ title, text?, bullets?: string[], notes? }]
export async function makePptx(title, slides, subtitle = '') {
	const INK = '24262C', MUTED = '6B7069', ACCENT = '0BD162'
	const pptx = new PptxGenJS()
	pptx.layout = 'LAYOUT_WIDE' // 13.33 x 7.5 in
	pptx.title = title
	const cover = pptx.addSlide()
	cover.background = { color: 'F7F8F6' }
	cover.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.05, w: 0.12, h: 1.4, fill: { color: ACCENT }, line: { color: ACCENT } })
	cover.addText(title, { x: 1.1, y: 2.7, w: 11.2, h: 1.3, fontFace: 'Segoe UI', fontSize: 40, bold: true, color: INK, valign: 'bottom' })
	if (subtitle) cover.addText(subtitle, { x: 1.1, y: 4.05, w: 11.2, h: 0.7, fontFace: 'Segoe UI', fontSize: 20, color: MUTED })
	for (const s of slides) {
		const slide = pptx.addSlide()
		slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.55, w: 0.08, h: 0.75, fill: { color: ACCENT }, line: { color: ACCENT } })
		slide.addText(String(s.title ?? ''), { x: 0.85, y: 0.45, w: 11.8, h: 0.95, fontFace: 'Segoe UI', fontSize: 30, bold: true, color: INK, valign: 'middle' })
		const body = []
		if (s.text) body.push({ text: String(s.text), options: { fontSize: 20, color: INK, breakLine: true, paraSpaceAfter: 10 } })
		for (const b of s.bullets ?? []) body.push({ text: String(b), options: { bullet: { indent: 22 }, fontSize: 20, color: INK, breakLine: true, paraSpaceAfter: 8 } })
		if (body.length) slide.addText(body, { x: 0.85, y: 1.7, w: 11.8, h: 5.2, fontFace: 'Segoe UI', valign: 'top' })
		if (s.notes) slide.addNotes(String(s.notes))
	}
	return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }))
}
