# whatsapp_claude

Conecta tu WhatsApp con Claude y programa mensajes desde un panel web local.

- **Servicio local** (`src/service.js`): es el único proceso conectado a WhatsApp, como dispositivo vinculado de WhatsApp Web mediante [Baileys](https://github.com/WhiskeySockets/Baileys). Guarda chats, contactos y mensajes en SQLite (`data/whatsapp.db`), envía los mensajes programados y sirve el panel en `http://localhost:3737`.
- **Servidor MCP** (`src/index.js`): permite a Claude (Desktop o Code) leer, buscar, enviar y programar mensajes. Lee la base local y le pide los envíos al servicio.

> ⚠️ Es una conexión **no oficial**. Úsala para tu propio uso; enviar spam o mensajes masivos puede hacer que Meta bloquee el número.

## Requisitos

- Windows y Node.js 22.13 o superior (usa el `node:sqlite` integrado)

```bash
npm install
```

## 1. Instalar el servicio

```bash
npm run install-startup
```

Deja el servicio corriendo en segundo plano y lo arranca solo cada vez que inicias sesión en Windows. Un supervisor lo reinicia si se cae. Para quitarlo:

```bash
npm run uninstall-startup
```

Para probarlo sin instalarlo, usa `npm run service`.

## 2. Vincular WhatsApp

Abre `http://localhost:3737`, pulsa **Mostrar código QR** y escanéalo en **WhatsApp → Dispositivos vinculados → Vincular un dispositivo**. El historial se descarga en segundo plano durante unos minutos.

La sesión queda guardada en `data/auth/`. **No compartas ni subas la carpeta `data/`**: con ella cualquiera puede usar tu WhatsApp.

## 3. Programar mensajes

En el panel eliges el chat (contacto, grupo o un número nuevo), escribes el mensaje, la fecha y si se repite: una vez, todos los días, de lunes a viernes o cada semana. Desde la lista de pendientes puedes editar, enviar al momento o cancelar, y el historial muestra lo enviado, lo fallido y lo perdido.

Los mensajes solo salen **mientras la PC esté encendida**. Si a la hora programada estaba apagada, el mensaje se envía al encender la PC, siempre que el retraso no pase de 60 minutos (se cambia con `SCHEDULE_GRACE_MIN`). Si pasa, se marca como *perdido* y se puede reenviar desde el historial.

## 4. Registrar el MCP

**Claude Code:**

```bash
claude mcp add whatsapp -- node "C:\ruta\a\whatsapp_claude\src\index.js"
```

**Claude Desktop**, en `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["C:\\ruta\\a\\whatsapp_claude\\src\\index.js"]
    }
  }
}
```

### Herramientas

| Herramienta | Qué hace |
|---|---|
| `whatsapp_status` | Estado de la conexión y cuántos datos hay sincronizados |
| `whatsapp_login` | Devuelve el QR para vincular |
| `list_chats` | Chats por actividad reciente (filtros: texto, no leídos, solo grupos) |
| `get_messages` | Mensajes de un chat por jid, número o nombre, con paginación por fecha |
| `search_messages` | Búsqueda de texto en todos los mensajes o en un chat |
| `search_contacts` | Busca contactos por nombre o número |
| `send_message` | Envía texto, opcionalmente citando un mensaje |
| `mark_as_read` | Marca un chat como leído |
| `schedule_message` | Programa un mensaje (con repetición opcional) |
| `list_scheduled` | Lista los pendientes o el historial de envíos |
| `cancel_scheduled` | Cancela un mensaje programado |

## Otros scripts

- `node scripts/download-images.js <jid> <desde> <hasta> <carpeta>`: descarga las imágenes recibidas en un chat entre dos fechas (`AAAA-MM-DD`). Mientras corre se queda con la sesión, y el servicio la recupera 30 segundos después.

## Seguridad

El panel solo escucha en `127.0.0.1`. Solo acepta peticiones dirigidas a `localhost` (protección contra DNS rebinding), y las acciones de escritura exigen JSON y una cabecera propia, así que ninguna página web externa puede usar la API para enviar mensajes.

## Variables de entorno

- `WA_DATA_DIR`: carpeta de datos (por defecto `./data`)
- `PANEL_PORT`: puerto del panel (por defecto `3737`)
- `SCHEDULE_GRACE_MIN`: minutos de tolerancia para enviar mensajes atrasados (por defecto `60`)
- `WA_LOG_LEVEL`: nivel de log de Baileys (`warn` por defecto)

El log del servicio está en `data/service.log`.

## Limitaciones

- Los mensajes programados son solo de texto.
- Los multimedia recibidos se registran como `[imagen] pie de foto`, `[nota de voz]`, etc., y no se descargan automáticamente.
