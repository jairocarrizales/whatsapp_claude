import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// Ruta absoluta: los clientes MCP lanzan el proceso desde cualquier directorio.
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const dataDir = process.env.WA_DATA_DIR ? resolve(process.env.WA_DATA_DIR) : join(root, 'data')
export const dbFile = join(dataDir, 'whatsapp.db')
export const panelPort = Number(process.env.PANEL_PORT ?? 3737)
export const serviceUrl = `http://127.0.0.1:${panelPort}`
