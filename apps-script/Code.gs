/**
 * Puente BuhoChat -> Google Drive.
 *
 * BuhoChat (en tu PC) envia aqui las imagenes y PDF que recibes por WhatsApp y este script los guarda
 * en tu Drive, en  <carpeta raiz>/<contacto o grupo>/<AAAA-MM>/ .
 *
 * Instalacion:
 *  1. script.google.com -> Nuevo proyecto -> pega este archivo.
 *  2. Pon en SECRET la clave que te muestra BuhoChat en Ajustes -> Subir a Google Drive.
 *  3. Implementar -> Nueva implementacion -> Tipo: Aplicacion web.
 *       Ejecutar como: Yo.   Quien tiene acceso: Cualquier persona.
 *     (Solo acepta peticiones con la clave secreta; sin ella responde "no autorizado".)
 *  4. Autoriza el acceso a Drive y copia la URL que termina en /exec en BuhoChat.
 */

const SECRET = 'PEGA_AQUI_LA_CLAVE_DE_BUHOCHAT'
const ROOT_FOLDER_NAME = 'BuhoChat'
// Carpeta de Drive donde se guarda todo (la del enlace drive.google.com/drive/folders/<ID>). Vacia = crea "BuhoChat".
const ROOT_FOLDER_ID = '1dp_OTnRR84qgBTsRD65nW2ZpXbCQzoJD'

function doGet() {
  return json_({ ok: true, service: 'buhochat-drive' })
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents)
    if (!SECRET || SECRET === 'PEGA_AQUI_LA_CLAVE_DE_BUHOCHAT' || body.secret !== SECRET) {
      return json_({ ok: false, error: 'no autorizado' })
    }
    if (body.action === 'ping') return json_({ ok: true, root: rootFolder_().getUrl() })

    // Carpeta destino: BuhoChat / <partes de la ruta>
    let folder = rootFolder_()
    for (const part of body.path || []) folder = child_(folder, clean_(part))

    // Sin duplicados: si ya existe un archivo con ese nombre en la carpeta, devuelve el existente.
    const name = clean_(body.filename)
    const existing = folder.getFilesByName(name)
    if (existing.hasNext()) {
      const f = existing.next()
      return json_({ ok: true, duplicate: true, id: f.getId(), url: f.getUrl() })
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mimeType || 'application/octet-stream', name)
    const file = folder.createFile(blob)
    if (body.description) file.setDescription(String(body.description).slice(0, 4000))
    return json_({ ok: true, id: file.getId(), url: file.getUrl() })
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) })
  }
}

function rootFolder_() {
  if (ROOT_FOLDER_ID) return DriveApp.getFolderById(ROOT_FOLDER_ID)
  const props = PropertiesService.getScriptProperties()
  const id = props.getProperty('ROOT_FOLDER_ID')
  if (id) {
    try { return DriveApp.getFolderById(id) } catch (e) { /* la borraron: se crea otra */ }
  }
  const folder = DriveApp.createFolder(ROOT_FOLDER_NAME)
  props.setProperty('ROOT_FOLDER_ID', folder.getId())
  return folder
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name)
  return it.hasNext() ? it.next() : parent.createFolder(name)
}

function clean_(s) {
  return String(s || 'sin-nombre').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'sin-nombre'
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)
}

// Ejecutala una vez desde el editor para autorizar el acceso a Drive.
function autorizar() {
  const f = rootFolder_()
  Logger.log('Acceso a Drive autorizado. Carpeta: ' + f.getName() + ' ' + f.getUrl())
}
