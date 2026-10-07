# whatsapp_claude

Conecta tu WhatsApp con Claude, programa mensajes desde un panel web local y crea recordatorios mandándote una nota de voz.

- **Panel web** (`http://localhost:3737`): para programar mensajes a cualquier contacto o grupo, una vez o repetidos, y ver el historial.
- **Recordatorios por voz**: te mandas una nota de voz a tu propio chat («Recuérdame mañana a las 8 pagar la luz») y queda programada.
- **Ajustes con tus documentos de Drive**: registras Docs, hojas y carpetas (por ejemplo, las de cada proveedor) para que Claude los lea y organice cuando se lo pidas.
- **Servidor MCP**: Claude (Desktop o Code) puede leer, buscar, responder y programar mensajes.

Todo corre en tu PC: los mensajes, el audio y la transcripción no pasan por servicios de terceros.

> ⚠️ Usa una conexión **no oficial** (WhatsApp Web mediante [Baileys](https://github.com/WhiskeySockets/Baileys)). Úsala para tu propio uso; enviar spam o mensajes masivos puede hacer que Meta bloquee el número.

---

## Instalación en un equipo nuevo

### Requisitos

- **Windows 10 u 11.** El arranque automático es para Windows; el resto también funciona en macOS o Linux con `npm run service`.
- **[Node.js](https://nodejs.org) 22.13 o superior** (se recomienda la versión LTS). Usa el `node:sqlite` integrado.
- **[Git](https://git-scm.com).**
- Unos 1.5 GB libres en disco (dependencias más el modelo de transcripción) y 8 GB de RAM o más.

### Pasos

1. **Descarga el código** e instala las dependencias:

   ```bash
   git clone https://github.com/jairocarrizales/whatsapp_claude.git
   cd whatsapp_claude
   npm install
   ```

2. **Instala el servicio** para que arranque con Windows:

   ```bash
   npm run install-startup
   ```

   Queda corriendo en segundo plano, sin ventanas, y un supervisor lo reinicia si se cae. Para probarlo sin instalarlo, usa `npm run service`.

3. **Vincula tu WhatsApp:** abre `http://localhost:3737`, pulsa **Mostrar código QR** y escanéalo desde el teléfono en **WhatsApp → Dispositivos vinculados → Vincular un dispositivo**. El historial de chats se descarga en segundo plano durante unos minutos. Con la primera nota de voz se descarga el modelo de transcripción (~1.1 GB, una sola vez).

4. **(Opcional) Conecta Claude.** Mira [Usar con Claude](#usar-con-claude-mcp).

### Qué no viene en el repositorio

La carpeta `data/` se crea en cada equipo y **nunca se sube**. Contiene:

- `data/auth/`: la sesión de WhatsApp. **Con ella cualquiera puede usar tu cuenta**, así que no la compartas.
- `data/whatsapp.db`: chats, contactos, mensajes y mensajes programados.
- `data/models/`: el modelo de transcripción.
- `data/service.log`: el registro del servicio.

Por eso cada equipo nuevo debe vincularse con su propio QR. Los mensajes programados de un equipo no pasan al otro.

> **Usa el servicio en un solo equipo a la vez.** WhatsApp permite varios dispositivos vinculados, pero si dos equipos corren el servicio, los dos responderán a tus notas de voz y crearán recordatorios duplicados.

### Actualizar a una versión nueva

```bash
git pull
npm install
npm run install-startup
```

El último comando reinicia el servicio con el código nuevo.

### Desinstalar

```bash
npm run uninstall-startup
```

Detiene el servicio y quita el arranque automático. Después puedes borrar la carpeta y desvincular el dispositivo desde el teléfono.

---

## Cómo se usa

### Programar mensajes desde el panel

En `http://localhost:3737`:

1. En **Para**, busca un contacto o grupo por nombre, o escribe un número nuevo con código de país.
2. Escribe el mensaje y elige fecha y hora. Los botones rápidos ponen *En 1 hora*, *Mañana 8:00* o *Lunes 8:00*.
3. Elige si se repite: una vez, todos los días, de lunes a viernes o cada semana.
4. Pulsa **Programar**.

Los pendientes se pueden **editar**, **enviar ahora** o **cancelar**. En **Historial** se ve lo enviado, lo que falló y lo perdido, con la opción de reintentar. Puedes borrar elementos sueltos, marcar varios y pulsar **Borrar seleccionados**, o vaciarlo con **Borrar todo el historial**. Los mensajes pendientes nunca se borran desde ahí.

Los mensajes solo salen **mientras la PC está encendida**. Si a la hora programada estaba apagada, el mensaje se envía al encenderla, siempre que el retraso no pase de 60 minutos (configurable con `SCHEDULE_GRACE_MIN`). Si pasa, se marca como *perdido* para no mandar algo fuera de contexto.

### Ajustes: documentos de Google Drive

En la pestaña **Ajustes** del panel registras los documentos con los que quieres que Claude trabaje:

1. **Nombre**: por ejemplo «Facturas Cementos del Norte».
2. **URL**: de un Google Doc, una hoja de cálculo, una presentación, una carpeta o un archivo de Drive. El tipo se detecta solo.
3. **Proveedor o chat de WhatsApp** (opcional): asocia el documento al contacto o grupo de ese proveedor.
4. **Notas para Claude** (opcional): qué contiene o cómo está organizado, por ejemplo «columna C = monto».

La lista se agrupa por proveedor. Después le pides a Claude, por ejemplo, *«revisa la hoja de Cementos del Norte y dime qué facturas faltan por pagar»* o *«organiza en una tabla lo que me mandó este proveedor por WhatsApp esta semana y compáralo con su hoja»*. Claude consulta la lista con el MCP y lee los documentos con su **conector de Google Drive** (el de claude.ai), así que no hace falta configurar nada de Google en el servicio.

Claude también puede registrar documentos si le das la URL en el chat. Quitar un documento de la lista no borra nada en Drive.

> Subir a Drive las imágenes que te mandan los proveedores todavía no está incluido. El conector de Claude solo puede subir archivos pasándolos completos como texto, lo que es lento para fotos. La forma práctica será con Google Drive para escritorio.

### Recordatorios por nota de voz

Abre tu propio chat en WhatsApp ("Tú" / "Mensajes para mí") y manda una nota de voz que diga cuándo y qué recordarte. Los textos deben empezar con *recuérdame*:

| Dices | Queda programado |
|---|---|
| «Recuérdame mañana a las 8 pagar la luz» | mañana 8:00 a. m. |
| «Recuérdame el viernes a las 3 de la tarde llamar a Lidia» | viernes 3:00 p. m. |
| «En 2 horas revisar el reporte» | dentro de 2 horas |
| «Recuérdame a las 8 llamar a mamá» (dicho por la tarde) | hoy 8:00 p. m. |
| «Recuérdame de lunes a viernes a las 7:30 de la mañana enviar el reporte» | lunes a viernes 7:30 a. m. |
| «Recuérdame cada lunes a las 9 revisar facturas» | cada lunes 9:00 a. m. |
| «Recuérdame mañana pagar la renta» | mañana 9:00 a. m. (hora por defecto) |

El servicio transcribe la nota en tu PC con Whisper large-v3-turbo (unos 10 a 15 segundos; el modelo se carga al llegar una nota y se libera de la memoria tras 15 minutos sin uso), te confirma en el mismo chat con la fecha y la tarea, y el recordatorio aparece en el panel con la etiqueta 🎤 y lo que dijiste. A la hora indicada recibes *⏰ Recordatorio: …*.

Si dices «…que diga cenar», el recordatorio dirá solo «Cenar». Las notas de voz sin fecha ni hora y los textos que no empiezan con «recuérdame» (apuntes, ideas) se ignoran.

Si algo se entendió mal, cancélalo desde el panel: la confirmación te muestra la fecha que entendió y el panel guarda lo que dijiste.

**Notificaciones:** los mensajes que te llegan a tu propio chat pueden no sonar en el teléfono, porque WhatsApp los considera enviados por ti. Si no te llega aviso, haz que los recordatorios lleguen a otro número tuyo con la variable `REMINDER_TO` (ver [Configuración](#configuración)).

### Usar con Claude (MCP)

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

El servicio debe estar corriendo. Después puedes pedirle cosas como *«¿qué mensajes sin leer tengo?»*, *«resume lo último del grupo de operaciones»* o *«prográmale a Lidia para mañana a las 9 que le confirmo el pedido»*.

| Herramienta | Qué hace |
|---|---|
| `whatsapp_status` | Estado de la conexión y cuántos datos hay sincronizados |
| `whatsapp_login` | Devuelve el QR para vincular |
| `list_chats` | Chats por actividad reciente (filtros: texto, no leídos, solo grupos) |
| `get_messages` | Mensajes de un chat por nombre, número o jid, con paginación por fecha |
| `search_messages` | Búsqueda de texto en todos los mensajes o en un chat |
| `search_contacts` | Busca contactos por nombre o número |
| `send_message` | Envía texto, opcionalmente citando un mensaje |
| `mark_as_read` | Marca un chat como leído |
| `schedule_message` | Programa un mensaje (con repetición opcional) |
| `list_scheduled` | Lista los pendientes o el historial de envíos |
| `cancel_scheduled` | Cancela un mensaje programado |
| `list_resources` | Lista los documentos de Drive registrados (filtra por nombre o proveedor) |
| `add_resource` | Registra un documento de Drive, opcionalmente asociado a un chat |
| `remove_resource` | Quita un documento de la lista |

### Descargar imágenes de un chat

```bash
node scripts/download-images.js <jid> <desde AAAA-MM-DD> <hasta AAAA-MM-DD> <carpeta>
```

Descarga las imágenes recibidas en un chat entre dos fechas. El jid se obtiene con `list_chats`, por ejemplo `5215512345678@s.whatsapp.net`. Mientras corre se queda con la sesión, y el servicio la recupera 30 segundos después.

---

## Cómo está hecho el código

```
src/
  service.js     Servicio permanente: conexión a WhatsApp, API HTTP y panel
  whatsapp.js    Conexión con Baileys y volcado de eventos (chats, contactos, mensajes) a la base
  store.js       Base SQLite: tablas, búsqueda de chats, nombres para mostrar, mapeo LID↔teléfono
  scheduler.js   Revisa cada 10 s los mensajes programados y los envía o los marca como perdidos
  voice.js       Detecta notas de voz o textos en tu propio chat y crea recordatorios
  transcribe.js  Transcripción local con Whisper (transformers.js + ffmpeg)
  reminders.js   Interpreta frases en español → fecha, repetición y tarea
  drive.js       Reconoce URLs de Drive, Docs, Sheets y Slides (tipo e id)
  index.js       Servidor MCP (stdio): lee la base y le pide los envíos al servicio
  supervisor.js  Reinicia el servicio si se cae
  config.js      Rutas y puertos
public/
  index.html     Panel web (HTML, CSS y JS sin dependencias)
scripts/
  startup.js         Instala o quita el arranque automático en Windows
  download-images.js Descarga imágenes de un chat
```

**Por qué un servicio separado:** WhatsApp solo admite una conexión activa por sesión. El servicio es el único proceso conectado; el MCP y el panel le piden todo a él. Así los mensajes programados salen aunque Claude esté cerrado.

### API local

El panel y el MCP usan esta API, que puedes usar también desde tus propios scripts. Las peticiones que no son `GET` deben llevar `Content-Type: application/json` y la cabecera `X-Panel: 1`.

| Método y ruta | Uso |
|---|---|
| `GET /api/status` | Estado, cuenta conectada, QR si hace falta vincular |
| `POST /api/connect` | Inicia la conexión (genera el QR si no hay sesión) |
| `GET /api/chats?q=texto` | Busca chats |
| `GET /api/scheduled?status=pending\|history` | Pendientes o historial |
| `POST /api/scheduled` | Programa: `{ to, text, send_at (ISO), repeat }` |
| `PATCH /api/scheduled/:id` | Edita un pendiente |
| `DELETE /api/scheduled/:id` | Cancela |
| `POST /api/scheduled/:id/send-now` | Envía ya (o reintenta uno fallido o perdido) |
| `POST /api/send` | Envía al momento: `{ to, text, reply_to? }` |
| `POST /api/mark-read` | Marca como leído: `{ chat }` |
| `POST /api/history/delete` | Borra del historial: `{ refs: ["run:3", "cancelled:7"] }` o `{ all: true }` |
| `GET /api/resources?q=texto` | Documentos de Drive registrados |
| `POST /api/resources` | Registra: `{ name, url, to?, notes? }` |
| `PATCH /api/resources/:id` · `DELETE /api/resources/:id` | Edita o quita un documento |

Ejemplo, programar desde PowerShell:

```powershell
Invoke-RestMethod -Method Post http://localhost:3737/api/scheduled `
  -Headers @{ 'X-Panel' = '1' } -ContentType 'application/json' `
  -Body '{"to":"+5215512345678","text":"Hola","send_at":"2026-10-08T09:00:00-06:00","repeat":"none"}'
```

### Ideas para extenderlo

- **Otra forma de decir fechas:** amplía `normalize()` y `REPEATS` en `src/reminders.js` y prueba con frases reales.
- **Otro tipo de mensaje programado** (imágenes, documentos): agrega una columna en `scheduled` (`store.js`) y usa `sock.sendMessage(jid, { image: ... })` en `scheduler.js`.
- **Reaccionar a otros mensajes:** escucha `wa.on((event, msg) => event === 'message' && …)` como hace `voice.js`.
- **Otro modelo de voz:** usa la variable `WHISPER_MODEL`, por ejemplo `onnx-community/whisper-small` (~250 MB y 3 segundos por nota, pero se equivoca más con el español).

## Configuración

Variables de entorno opcionales (defínelas antes de `npm run install-startup`, o como variables de usuario de Windows):

| Variable | Por defecto | Uso |
|---|---|---|
| `REMINDER_TO` | tu propio número | Número (con código de país) al que llegan los recordatorios por voz |
| `SCHEDULE_GRACE_MIN` | `60` | Minutos de tolerancia para enviar mensajes atrasados |
| `PANEL_PORT` | `3737` | Puerto del panel y la API |
| `WHISPER_MODEL` | `onnx-community/whisper-large-v3-turbo` | Modelo de transcripción |
| `WHISPER_IDLE_MIN` | `15` | Minutos sin notas tras los que el modelo se libera de la memoria |
| `WA_DATA_DIR` | `./data` | Carpeta de datos |
| `WA_LOG_LEVEL` | `warn` | Nivel de log de Baileys |

## Seguridad

El panel solo escucha en `127.0.0.1`, así que no es accesible desde otros equipos de la red. Rechaza las peticiones que no van dirigidas a `localhost` (protección contra DNS rebinding), y las acciones de escritura exigen JSON y una cabecera propia, de modo que ninguna página web que visites puede usar la API para enviar mensajes.

## Solución de problemas

- **El panel no abre:** revisa `data/service.log`. Si dice que el puerto está en uso, ya hay un servicio corriendo.
- **«Sin vincular» o la sesión se cerró:** vuelve a escanear el QR desde el panel.
- **Un recordatorio no se entendió:** el servicio te responde con lo que transcribió; repítelo diciendo el día y la hora («mañana a las 8…»).
- **Mensaje *perdido*:** la PC estaba apagada a esa hora. Reintenta desde el Historial.
