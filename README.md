# BuhoChat

<img src="public/assets/buho.png" alt="BuhoChat" width="96">

**BuhoChat** (repositorio `whatsapp_claude`) conecta tu WhatsApp con Claude, programa mensajes desde un panel web local y crea recordatorios mandándote una nota de voz.

- **Panel web BuhoChat** (`http://localhost:3737`): incluye la conexión de WhatsApp por código QR, y para programar mensajes a cualquier contacto o grupo, una vez o repetidos, y ver el historial.
- **Correos desde WhatsApp**: «envía un correo a Lidia diciendo…», escrito o por voz; el búho te muestra el correo y lo envía cuando respondes «sí».
- **Recordatorios por voz**: te mandas una nota de voz a tu propio chat («Recuérdame mañana a las 8 pagar la luz») y queda programada.
- **Ajustes**: tu conexión de WhatsApp (con QR para vincular de nuevo) y tus carpetas y archivos de Drive, numerados para que le digas a Claude «haz esto en la carpeta 3».
- **Asistente en el panel**: le escribes o dictas a Claude desde BuhoChat, con tu propia suscripción, sin abrir otra app.
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

### Ajustes

**Conexión de WhatsApp.** Muestra con qué número estás conectado. **Vincular de nuevo (mostrar QR)** cierra la sesión en este equipo y muestra un código QR nuevo, para volver a vincular el mismo número u otro. Si no hay sesión, la tarjeta **Conecta tu WhatsApp** aparece arriba del panel con el código.

**Carpetas y archivos de Drive.** Pulsa **Agregar** y llena dos campos: el **enlace** (de una carpeta, un Doc, una hoja, una presentación o un archivo de Drive) y una **descripción corta**. Se guarda solo al salir del campo y queda guardado en la base del servicio, así que sigue ahí cada vez que abres el panel.

Cada elemento recibe un **número fijo** (#1, #2, #3…) que no se reutiliza aunque borres otros. Úsalo al hablar con Claude: *«lee la hoja 2 y dime qué facturas faltan»* o *«crea un documento con el resumen de hoy en la carpeta 4»*. Claude busca el número con el MCP y trabaja el archivo con su **conector de Google Drive** (el de claude.ai), sin configurar nada de Google en el servicio. Quitar un elemento de la lista no borra nada en Drive.

> Subir a Drive las imágenes que te mandan por WhatsApp todavía no está incluido. El conector de Claude solo puede subir archivos pasándolos completos como texto, lo que es lento para fotos. La forma práctica será con Google Drive para escritorio.

### Correos desde WhatsApp

En **Ajustes → Correo para enviar** conecta la cuenta desde la que saldrán los correos:

- **Gmail:** tu correo y una **contraseña de aplicación** (no tu contraseña normal). Créala en [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords); requiere tener activada la verificación en 2 pasos.
- **Outlook / Hotmail** u **otro servidor SMTP**: tu correo, contraseña y, si hace falta, servidor y puerto.

Al guardar, BuhoChat comprueba con el servidor que el usuario y la contraseña funcionan. La configuración se guarda solo en tu PC (`data/`) y el panel nunca vuelve a mostrar la contraseña. Con **Enviar correo de prueba** te llega uno a ti mismo.

En **Ajustes → Agenda de correos** guarda a quién le escribes seguido: nombre y correo (si alguien tiene varios, sepáralos con comas).

En **Ajustes → Grupos de correo** junta contactos de tu agenda en los grupos que quieras (*Proveedores*, *Equipo ventas*, *Familia*…). Un contacto puede estar en varios grupos, y si lo borras de la agenda sale de sus grupos. Cada grupo tiene un botón **Escribir correo** para enviarle desde el panel, con confirmación; va en copia oculta.

Después, en tu propio chat de WhatsApp, escribe o di:

| Dices | Qué hace |
|---|---|
| «Envía un correo a Lidia diciendo que mañana le mando la cotización» | A Lidia (de la agenda); el asunto se toma de la primera frase |
| «Manda un email a juan arroba gmail punto com: llego tarde» | A una dirección dictada |
| «Envíale un correo a Lidia y a Carlos con asunto Reunión diciendo que se cambia a las 5» | A varios, con asunto |
| «Envía un correo al grupo Proveedores diciendo que el pago sale el viernes» | A todo un grupo (también «a proveedores: …») |
| «Envía un correo a Lidia y al grupo Proveedores con asunto Junta diciendo…» | A personas y grupos juntos |

El búho te responde con el destinatario, el asunto y el texto que entendió. **Solo lo envía si respondes «sí»** (o «no» para cancelarlo; la propuesta caduca en 15 minutos). Cuando hay varios destinatarios, van en copia oculta para no exponer sus direcciones.

### Listas de difusión de WhatsApp

En **Ajustes → Listas de difusión** crea listas (*Clientes*, *Proveedores*…) y agrega contactos de WhatsApp o números. Al programar un mensaje, en **Para** elige la lista: se crea **un mensaje por persona**, enviado por separado.

- **Varios textos:** con una lista aparecen *Texto 1, 2, 3…* (agrega más con **Otro texto**). Se reparten en orden (persona 1 → texto 1, 2 → texto 2, 3 → texto 3, 4 → texto 1…).
- **`{nombre}`:** *«Hola {nombre}, …»* sale como *«Hola Lidia, …»*; si solo hay número, *«Hola, …»*.
- **Ritmo** (en **Ajustes → Ritmo de envío**, modificable): por defecto, un mensaje cada **60 s + 30 a 90 s al azar**, y un **descanso de 5 minutos cada 5 personas**. El resumen te dice a qué hora termina aproximadamente. Si la PC estuvo apagada y se juntan varios atrasados, tampoco salen seguidos.
- En **Pendientes** cada mensaje lleva la etiqueta de su lista; puedes cancelar uno o **toda la lista**.

> ⚠️ Enviar el mismo mensaje a muchas personas es lo que más rápido hace que WhatsApp bloquee un número. Usa listas solo con gente que te conoce y aprovecha las variantes de texto y `{nombre}`.

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

### Asistente

La pestaña **Asistente** del panel es un chat con Claude que usa las herramientas de BuhoChat: leer y resumir chats, programar mensajes y listas, enviar correos a tu agenda y grupos, y revisar tus carpetas de Drive.

- **Escribe o dicta:** el micrófono graba en el navegador y la transcripción se hace en tu PC con Whisper.
- **Usa tu suscripción de Claude:** el servicio ejecuta Claude Code (ya instalado y con tu sesión) en segundo plano, así que no hay costo extra; cuenta dentro de los límites de tu plan.
- **Seguro por diseño:** el asistente del panel no tiene acceso a la terminal, a tus archivos ni a la web, solo a BuhoChat y a tus conectores de Drive y Calendar. Enviar y programar funciona en dos pasos: primero te muestra la vista previa y solo actúa cuando respondes «sí».
- La conversación se conserva al recargar la página; **Nueva conversación** empieza de cero.
- **Conversar por voz:** pulsa el botón y habla normal. El panel detecta cuándo haces una pausa, transcribe en tu PC, el asistente responde **en voz alta** con frases cortas y vuelve a escucharte, como en una llamada. Toca el búho para interrumpirlo, y di «terminar» o pulsa **Terminar** para acabar. Con el engrane eliges la voz y la velocidad; en Microsoft Edge hay voces «Natural» en español de México muy naturales.

Requisitos: [Claude Code](https://claude.com/claude-code) instalado con tu sesión iniciada (en una terminal: `claude`). El modelo se cambia con la variable `ASSISTANT_MODEL` (por defecto `sonnet`).

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

El servicio debe estar corriendo. Con el MCP, Claude usa tu agenda, tus grupos y la cuenta de correo de BuhoChat en cualquier sesión (Claude Code o la app de escritorio, también por voz): *«envía un correo al grupo Proveedores diciendo que el pago sale el viernes»*. Siempre te muestra la vista previa y espera tu confirmación. También puedes pedirle cosas como *«¿qué mensajes sin leer tengo?»*, *«resume lo último del grupo de operaciones»* o *«prográmale a Lidia para mañana a las 9 que le confirmo el pedido»*.

| Herramienta | Qué hace |
|---|---|
| `whatsapp_status` | Estado de la conexión y cuántos datos hay sincronizados |
| `whatsapp_login` | Devuelve el QR para vincular |
| `list_chats` | Chats por actividad reciente (filtros: texto, no leídos, solo grupos) |
| `get_messages` | Mensajes de un chat por nombre, número o jid, con paginación por fecha |
| `search_messages` | Búsqueda de texto en todos los mensajes o en un chat |
| `search_contacts` | Busca contactos por nombre o número |
| `send_message` | Envía texto, opcionalmente citando un mensaje (con vista previa; envía con `confirmed: true`) |
| `mark_as_read` | Marca un chat como leído |
| `schedule_message` | Programa un mensaje (con repetición opcional), o a una lista de difusión con `list` y variantes en `texts` |
| `list_scheduled` | Lista los pendientes o el historial de envíos |
| `cancel_scheduled` | Cancela un mensaje programado |
| `list_broadcast_lists` | Listas de difusión y ritmo de envío |
| `list_resources` | Lista las carpetas y archivos de Drive guardados, con su número |
| `add_resource` | Guarda un enlace de Drive con descripción corta |
| `remove_resource` | Quita un elemento por su número |
| `list_email_contacts` | Agenda, grupos de correo y cuenta de envío |
| `send_email` | Envía a contactos, grupos o direcciones: primero devuelve la vista previa y solo envía con `confirmed: true` tras tu «sí» |
| `add_email_contact` | Agrega un contacto a la agenda (y opcionalmente a un grupo) |

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
  assistant.js   Asistente del panel: Claude Code no interactivo con solo el MCP de BuhoChat
  broadcast.js   Ritmo de las listas de difusión (esperas, descansos, {nombre})
  email.js       Envío por SMTP, agenda de correos e intérprete de «envía un correo a…»
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
| `GET/POST /api/wa-lists` · `PATCH/DELETE /api/wa-lists/:id` | Listas de difusión |
| `POST /api/wa-lists/:id/members` · `DELETE /api/wa-lists/:id/members/:jid` | Integrantes de una lista: `{ to }` |
| `GET/PUT /api/broadcast-pace` | Ritmo: `{ gapSec, jitterMinSec, jitterMaxSec, pauseEvery, pauseSec }` |
| `POST /api/scheduled` con `{ list_id \| list, texts, send_at, repeat }` | Programa un mensaje por persona de la lista |
| `POST /api/scheduled/cancel-batch` | Cancela los pendientes de una lista: `{ batch }` |
| `POST /api/assistant` | Mensaje al asistente: `{ message, session? }`; responde en streaming (NDJSON) |
| `POST /api/transcribe` | Audio (`Content-Type: audio/*`) → `{ text }` con Whisper local |
| `POST /api/history/delete` | Borra del historial: `{ refs: ["run:3", "cancelled:7"] }` o `{ all: true }` |
| `GET /api/resources?q=texto` | Carpetas y archivos de Drive guardados (busca por número o texto) |
| `POST /api/resources` | Guarda: `{ url, description? }` → devuelve su `num` |
| `PATCH /api/resources/:num` · `DELETE /api/resources/:num` | Edita o quita por número |
| `POST /api/relink` | Cierra la sesión de WhatsApp y genera un QR nuevo |
| `GET /api/email` · `PUT /api/email` · `DELETE /api/email` | Cuenta de correo (el `PUT` verifica con el servidor antes de guardar) |
| `POST /api/email/test` | Envía un correo de prueba a tu propia cuenta |
| `GET/POST /api/email-contacts` · `PATCH/DELETE /api/email-contacts/:id` | Agenda de correos: `{ name, emails }` |
| `GET/POST /api/email-groups` · `PATCH/DELETE /api/email-groups/:id` | Grupos: `{ name, members: [ids de contactos] }` |
| `POST /api/email/send` | Envía desde el panel: `{ group_id \| to, subject, body }` |

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
