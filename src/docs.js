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

// CSV -> filas (comillas dobles, comas y saltos de linea dentro de comillas).
export function parseCsv(text) {
	const rows = []
	let row = [], cell = '', quoted = false
	const s = String(text).replace(/\r\n?/g, '\n')
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (quoted) {
			if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
			else if (c === '"') quoted = false
			else cell += c
		} else if (c === '"') quoted = true
		else if (c === ',') { row.push(cell); cell = '' }
		else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
		else cell += c
	}
	if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
	return rows.filter((r) => r.some((v) => v !== ''))
}

// Libro de Excel (.xlsx) con varias pestañas: sheets = [{ name, rows: [[...]] }]. La primera fila va en negritas
// y queda fija; los numeros se guardan como numeros y lo que empieza con "=" como formula.
export async function makeXlsx(sheets) {
	const JSZip = (await import('jszip')).default
	const xml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
	const col = (n) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
	const used = new Set()
	const names = sheets.map((sh, i) => {
		let n = String(sh.name || `Hoja ${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim() || `Hoja ${i + 1}`
		while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`
		used.add(n.toLowerCase())
		return n
	})
	const zip = new JSZip()
	zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
	zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
	zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
	zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
	zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3EE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
	sheets.forEach((sh, i) => {
		const rows = sh.rows ?? []
		const widths = []
		const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
			const ref = `${col(ci)}${ri + 1}`
			const st = ri === 0 ? ' s="1"' : ''
			const t = String(v ?? '').trim()
			widths[ci] = Math.max(widths[ci] ?? 8, Math.min(50, t.length + 2))
			if (t === '') return ''
			if (ri > 0 && t.startsWith('=')) return `<c r="${ref}"${st}><f>${xml(t.slice(1))}</f></c>`
			if (ri > 0 && /^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return `<c r="${ref}"${st}><v>${t}</v></c>`
			return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`
		}).join('')}</row>`).join('')
		const cols = widths.length ? `<cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
		zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`)
	})
	return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
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
