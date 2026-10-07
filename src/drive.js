// Reconoce enlaces de Google Drive, Docs, Sheets y Slides y extrae el tipo y el id del archivo.
const PATTERNS = [
	[/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]+)/, 'doc'],
	[/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/, 'sheet'],
	[/docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([\w-]+)/, 'slides'],
	[/drive\.google\.com\/drive\/(?:u\/\d+\/)?(?:mobile\/)?folders\/([\w-]+)/, 'folder'],
	[/drive\.google\.com\/(?:u\/\d+\/)?file\/d\/([\w-]+)/, 'file'],
	[/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/, 'file'],
]

export const KIND_LABEL = { doc: 'Documento', sheet: 'Hoja de cálculo', slides: 'Presentación', folder: 'Carpeta', file: 'Archivo' }

/** @returns {{ kind: string, driveId: string } | null} */
export function parseDriveUrl(url) {
	let u
	try {
		u = new URL(String(url).trim())
	} catch {
		return null
	}
	if (u.protocol !== 'https:' || !/(^|\.)google\.com$/.test(u.hostname)) return null
	const href = u.hostname + u.pathname + u.search
	for (const [re, kind] of PATTERNS) {
		const m = href.match(re)
		if (m) return { kind, driveId: m[1] }
	}
	return null
}
