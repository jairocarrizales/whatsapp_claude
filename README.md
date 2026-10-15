# BuhoChat

<img src="public/assets/buho.png" alt="BuhoChat" width="96">

**BuhoChat** (repositorio `whatsapp_claude`) conecta tu WhatsApp con Claude, programa mensajes desde un panel web local y crea recordatorios mandándote una nota de voz.

- **Panel web BuhoChat** (`http://localhost:3737`): incluye la conexión de WhatsApp por código QR, y para programar mensajes a cualquier contacto o grupo, una vez o repetidos, y ver el historial.
- **Correos desde WhatsApp**: «envía un correo a Lidia diciendo…», escrito o por voz; el búho te muestra el correo y lo envía cuando respondes «sí».
- **Recordatorios por voz**: te mandas una nota de voz a tu propio chat («Recuérdame mañana a las 8 pagar la luz») y queda programada.
- **Ajustes**: tu conexión de WhatsApp (con QR para vincular de nuevo) y tus carpetas y archivos de Drive, numerados para que le digas a Claude «haz esto en la carpeta 3».
- **Asistente en el panel**: le escribes o dictas a Claude desde BuhoChat, con tu propia suscripción, sin abrir otra app.
- **Búho por WhatsApp**: «Búho, …» en tu propio chat, por texto o nota de voz, y te responde ahí mismo por escrito.
- **Documentos**: crea Google Docs, hojas de cálculo, presentaciones, PDF, PowerPoint y Excel, y te los manda por WhatsApp o correo.
- **Servidor MCP**: Claude (Desktop o Code) puede leer, buscar, responder y programar mensajes.

Todo corre en tu PC: los mensajes, el audio y la transcripción no pasan por servicios de terceros.

> ⚠️ Usa una conexión **no oficial** (WhatsApp Web mediante [Baileys](https://github.com/WhiskeySockets/Baileys)). Úsala para tu propio uso; enviar spam o mensajes masivos puede hacer que Meta bloquee el número.

---

## Instalación en un equipo nuevo

> ¿Prefieres que lo haga Claude? Mira [Instalación guiada por un agente](#instalación-guiada-por-un-agente-claude-code): le pegas una instrucción y te guía paso a paso.

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

## Instalación guiada por un agente (Claude Code)

Si usas Claude Code (o otro agente con terminal), puedes pedirle que haga la instalación. Abre una terminal en la carpeta donde quieras el programa, ejecuta `claude` y pega:

> Instala BuhoChat en este equipo siguiendo la sección «Instalación guiada por un agente» del README de https://github.com/jairocarrizales/whatsapp_claude. Pregúntame antes de instalar programas y avísame cuando tenga que hacer algo yo.

### Instrucciones para el agente

Sigue los pasos en orden y comprueba cada uno antes de pasar al siguiente. Habla con la persona en su idioma y sin tecnicismos.

**Reglas que no se rompen**

- **Nunca pidas contraseñas, claves ni códigos en el chat.** La persona escanea el QR, escribe la contraseña de aplicación del correo en el panel y autoriza Google ella misma.
- **No subas ni compartas `data/`**: contiene la sesión de WhatsApp (quien la tenga puede usar la cuenta) y la contraseña del correo. Ya está en `.gitignore`.
- **Un solo servicio por cuenta de WhatsApp.** Si BuhoChat ya corre en otro equipo con el mismo número, avísale a la persona antes de seguir: los dos responderían a las notas de voz.
- **Pide permiso antes de instalar programas** (Node.js, Git) y antes de reiniciar o detener un servicio que ya estaba corriendo.
- No cambies el código para «hacer que funcione» sin decirlo; si algo falla, revisa [Solución de problemas](#solución-de-problemas) y `data/service.log`.

**1. Revisar requisitos**

```bash
node -v
git --version
```

- Node.js debe ser **22.13 o superior** (BuhoChat usa `node:sqlite`). Si falta o es más viejo, en Windows ofrece `winget install OpenJS.NodeJS.LTS`; en macOS, `brew install node`. Después abre una terminal nueva.
- Git: en Windows `winget install Git.Git`; en macOS `xcode-select --install`.
- Necesita unos 1.5 GB libres y 8 GB de RAM (el modelo de voz ocupa ~1.1 GB al usarse).

**2. Descargar e instalar dependencias**

```bash
git clone https://github.com/jairocarrizales/whatsapp_claude.git
cd whatsapp_claude
npm install
```

Comprueba que terminó sin errores (`npm install` muestra `added … packages`). Las advertencias de dependencias obsoletas se pueden ignorar.

**3. Revisar que el puerto esté libre**

```bash
curl -s http://127.0.0.1:3737/api/status
```

Si responde algo, ya hay un BuhoChat corriendo en este equipo: no instales otro; pregunta a la persona si quiere actualizarlo ([Actualizar](#actualizar-a-una-versión-nueva)). Si el puerto lo usa otro programa, define `PANEL_PORT` (ver [Configuración](#configuración)).

**4. Arrancar el servicio**

- **Windows:** `npm run install-startup`. Queda en segundo plano y arranca solo con Windows.
- **macOS / Linux:** `npm run service` en segundo plano (por ejemplo con `nohup npm run service > /dev/null 2>&1 &`). Para que arranque solo, propón a la persona un servicio de `launchd` o `systemd`; no lo crees sin preguntar.

Comprueba que responde (puede tardar unos segundos):

```bash
curl -s http://127.0.0.1:3737/api/status
```

Debe devolver `"linked":false`. Si no responde, lee las últimas líneas de `data/service.log`.

**5. Vincular WhatsApp (lo hace la persona)**

Pide a la persona que abra `http://localhost:3737`, pulse **Mostrar código QR** y lo escanee en el teléfono: **WhatsApp → Dispositivos vinculados → Vincular un dispositivo**. Mientras, consulta `/api/status` cada pocos segundos hasta ver `"linked":true` y `"state":"open"`. El historial se descarga solo durante unos minutos (`synced` va subiendo).

**6. Conectar Claude (opcional, recomendado)**

Comprueba si Claude Code está instalado y con sesión: `claude --version`. Si no, ofrece instalarlo desde [claude.com/claude-code](https://claude.com/claude-code); la persona inicia sesión ejecutando `claude`.

- **MCP en Claude Code** (desde la carpeta del repo, con la ruta absoluta):

  ```bash
  claude mcp add whatsapp -- node "<ruta absoluta>/src/index.js"
  ```

  Verifica con `claude mcp list` que `whatsapp` aparece conectado.
- **Claude Desktop:** agrega el bloque de [Usar con Claude](#usar-con-claude-mcp) a `%APPDATA%\Claude\claude_desktop_config.json` (en macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`) **sin borrar** los servidores que ya tenga, y pide reiniciar Claude Desktop.
- Con Claude Code instalado también funcionan la pestaña **Asistente**, la revisión con IA de **Seguimientos** y los **nombres automáticos de contactos**. Sin él, todo lo demás funciona; si la persona no quiere que BuhoChat use Claude para nombrar contactos, define `AUTONAMES=0`.

**7. Funciones opcionales (pregunta cuáles quiere)**

- **Correo:** la persona entra a **Ajustes → Correo para enviar**. Para Gmail necesita una contraseña de aplicación ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), requiere verificación en 2 pasos). Explícale los pasos; no la escribas tú.
- **Subir a Google Drive:** sigue el paso 7a: ella crea la carpeta y conecta clasp; tú publicas el Apps Script.
- **Carpetas de su PC para el asistente:** en **Ajustes → Carpetas de tu PC para el asistente**. Pregunta cuáles quiere permitir y si el asistente puede escribir en ellas.
- **Recordatorios en otro número:** si quiere que los recordatorios suenen en el teléfono, define `REMINDER_TO` con otro número suyo (ver [Recordatorios por nota de voz](#recordatorios-por-nota-de-voz)).

Las variables de entorno se definen como variables de usuario de Windows (`setx NOMBRE valor`); después, en una terminal nueva (para que las vea), se reinicia con `npm run install-startup`.

**7a. Subir a Google Drive con clasp (si la persona lo quiere)**

BuhoChat guarda en Drive las fotos y PDF que llegan por WhatsApp mediante un Apps Script publicado en la cuenta de Google de la persona. Tú lo instalas con [clasp](https://github.com/google/clasp); ella solo crea la carpeta, inicia sesión y autoriza.

1. **Pídele que cree la carpeta.** En [drive.google.com](https://drive.google.com), *Nuevo → Carpeta* (por ejemplo «BuhoChat»), que la abra y te pase el enlace. El ID es lo que sigue a `drive.google.com/drive/folders/`; no es un secreto.
2. **Pídele que active la API de Apps Script** en [script.google.com/home/usersettings](https://script.google.com/home/usersettings) (interruptor *API de Google Apps Script* en «Activado»). Sin esto, clasp no puede crear el proyecto.
3. **Instala clasp** (con su permiso) y **pídele la conexión**:

   ```bash
   npm install -g @google/clasp
   clasp login
   ```

   `clasp login` abre el navegador: ella elige su cuenta de Google y acepta. Tú no ves ni copias ninguna clave; no abras ni muestres `~/.clasprc.json`. Si la cuenta tiene varias sesiones, confirma con ella que eligió la cuenta donde está la carpeta.
4. **Prepara el proyecto en `data/apps-script/`** (dentro de `data/`, que no se sube a git, porque el script lleva la clave secreta de BuhoChat):
   - Guarda en `data/apps-script/Code.gs` el campo `code` de `GET http://127.0.0.1:3737/api/drive-bridge/script` (ya trae la clave). No muestres su contenido en el chat.
   - En ese archivo, pon el ID de la carpeta en `const ROOT_FOLDER_ID = ''`.
   - Copia `apps-script/appsscript.json` a `data/apps-script/` y cambia `timeZone` por la zona horaria de la persona.
5. **Crea y sube el proyecto**, desde `data/apps-script/`:

   ```bash
   clasp create-script --type standalone --title "BuhoChat Drive"
   clasp push --force
   ```

   Si `create-script` reemplazó `appsscript.json`, vuelve a copiar el del repo y repite `clasp push --force`.
6. **Pídele que autorice el acceso a Drive** (una sola vez): `clasp open-script` abre el editor; ella elige la función **autorizar** arriba, pulsa **Ejecutar** y acepta los permisos. Si Google avisa «app no verificada», es su propio script: *Configuración avanzada → Ir a BuhoChat Drive*. El registro debe mostrar el nombre de su carpeta.
7. **Publica la aplicación web:**

   ```bash
   clasp create-deployment --description "BuhoChat"
   ```

   Del ID de implementación que devuelve, la URL es `https://script.google.com/macros/s/<ID>/exec`.
8. **Conéctala a BuhoChat y pruébala** (las escrituras llevan las cabeceras `Content-Type: application/json` y `X-Panel: 1`):
   - `PUT /api/drive-bridge` con `{"url": "<URL /exec>"}`.
   - `POST /api/drive-bridge/test` con `{}`: debe responder `ok: true` y en `root` el enlace de **su** carpeta.
   - Pregúntale qué subir (imágenes, PDF, chats personales, qué grupos) y guarda con `PUT /api/drive-bridge`, por ejemplo `{"enabled": true, "types": ["image", "pdf"], "personal": true, "groups": []}`. Si quiere lo recibido antes, `POST /api/drive-bridge/backfill` con `{"days": 7}`.
9. **Para cambios futuros del script:** edita `data/apps-script/Code.gs`, `clasp push --force` y `clasp update-deployment <ID>`, así la URL no cambia.

Si no quiere usar clasp, guíala por el camino manual de [Subir a Google Drive lo que recibes](#subir-a-google-drive-lo-que-recibes) (**Copiar script** en el panel, pegar en script.google.com y publicar), con el ID de su carpeta en `ROOT_FOLDER_ID`.

**8. Cerrar**

Haz una prueba con la persona: que se mande a su propio chat de WhatsApp una nota de voz como «Recuérdame en 5 minutos tomar agua» y que vea la confirmación ✅ y el recordatorio en **Programados**. La primera nota tarda más porque descarga el modelo de voz (~1.1 GB).

Termina con un resumen corto: qué quedó instalado, qué funciones activó, dónde está el panel (`http://localhost:3737`) y cómo actualizar (`git pull`, `npm install`, `npm run install-startup`) o desinstalar (`npm run uninstall-startup`).

---

## Cómo se usa

### El panel

El panel (`http://localhost:3737`) está en **modo simple**: **Programados** (mensajes y recordatorios), **Qué puedo hacer** (cada uso con ejemplos listos para copiar y pegar en WhatsApp) y **Ajustes** (WhatsApp, cuenta de correo, agenda y grupos de correo, y Google Drive). Lo demás (Seguimientos, Asistente, listas de difusión, carpetas) queda oculto; aparece con **Mostrar opciones avanzadas** al final de Ajustes.

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


### Subir a Google Drive lo que recibes

BuhoChat puede guardar automáticamente en tu Google Drive las **imágenes y PDF** que te llegan por WhatsApp, en `BuhoChat / contacto o grupo / AAAA-MM`. Con cada archivo guarda quién lo mandó, la fecha y el texto del mensaje. Usa como puente una **aplicación web de Apps Script** que corre con tu cuenta, así que no necesitas Google Cloud ni Drive para escritorio.

1. En **Ajustes → Subir a Google Drive**, pulsa **Copiar script**; ya incluye tu clave secreta.
2. En [script.google.com](https://script.google.com/home/projects/create), crea un proyecto y pega el script (es el de `apps-script/Code.gs`).
   Para que también pueda crear Google Docs, Hojas y Presentaciones, en el editor agrega el servicio **Drive API** (menú *Servicios* → *Drive API* → *Agregar*). Si usas clasp, el manifiesto del repo ya lo incluye.
3. **Implementar → Nueva implementación → Aplicación web**, con *Ejecutar como: Yo* y *Quién tiene acceso: Cualquier persona*, y autoriza el acceso a Drive. El script rechaza todo lo que no traiga tu clave.
4. Pega la URL `/exec` en BuhoChat y pulsa **Probar conexión**; si funciona, se activa.

Para subir **todas las fotos de un chat** (por ejemplo, «sube a Drive todas las fotos de Branhy»), el asistente usa `upload_chat_to_drive`: crea una carpeta por mes y nombra cada foto por su día (`Lunes 13 jul 2026.jpg`, y `- 1`, `- 2` si hay varias ese día).

Por defecto el script crea la carpeta «BuhoChat» en tu Drive. Para usar otra carpeta, antes de publicarlo pon su ID (lo que sigue a `drive.google.com/drive/folders/`) en `ROOT_FOLDER_ID`.

Puedes elegir qué subir (imágenes y/o PDF), si incluir chats personales y **qué grupos**; por defecto, ningún grupo. **Subir lo recibido en los últimos 7 días** sube lo anterior. Si falla internet o la PC estaba apagada, los archivos quedan en cola y se reintentan; los duplicados se omiten.

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

### Seguimientos

En la pestaña **Seguimientos** le pides algo a alguien y BuhoChat se encarga del resto:

1. Eliges la **persona**, escribes **qué necesitas** («las fotos del avance de la obra») y qué esperas: fotos, documento, cualquiera de los dos o una respuesta.
2. Opcionalmente, **le envía la solicitud en ese momento**.
3. Si no ha enviado nada, **le recuerda a la hora que elijas** (por ejemplo 5:00 p. m.) cada día, o solo de lunes a viernes, hasta el máximo de recordatorios que indiques. Los textos llevan `{nombre}`.
4. Cuando envía algo, espera 2 minutos por si manda varias fotos y, si activaste **Revisar con IA**, Claude mira las fotos, documentos o textos y decide si es lo que pediste.
5. **Si cumple**, cierra el seguimiento y **te avisa a tu WhatsApp**; si no corresponde, te avisa con el motivo y sigue; si se agotan los recordatorios, también te avisa.

Desde la lista puedes recordar ahora, marcar cumplido, cancelar o reactivar. También se lo puedes pedir al asistente: *«dale seguimiento a Lidia para que me mande las fotos del avance, recuérdale a las 5»*.

### Nombres automáticos de contactos

Cada vez que enciendes la PC (y una vez al día si queda encendida), BuhoChat revisa quién te escribió y no está en tu agenda, y lo guarda con su nombre en WhatsApp y en la agenda del teléfono:

1. Si la persona tiene **nombre de perfil** en WhatsApp, usa ese (capitalizado si viene en minúsculas).
2. Si no, **Claude lee la conversación** y deduce el nombre solo si queda claro: se presentó, firmó, tú la saludas por su nombre o es una empresa que se identifica («Nombre (Empresa)» si es alguien de una empresa). Si no está claro, no inventa nada.
3. Al terminar te llega a tu chat un mensaje 📇 con los nombres que puso y de dónde salió cada uno.

La primera vez revisa los últimos 90 días; después, solo lo nuevo. Los números sin nombre claro se vuelven a revisar cuando escriben otra vez. Solo chats personales (no grupos). Para desactivarlo, define `AUTONAMES=0`.

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

### Búho: el asistente por WhatsApp

En tu propio chat de WhatsApp ("Tú" / "Mensajes para mí"), empieza un texto o una nota de voz con **«Búho»** y el asistente te responde ahí mismo:

- *«Búho, ¿qué mensajes importantes tengo hoy?»*
- *«Búho, ¿qué dijo Carlos en su último audio?»* (transcribe los audios que te mandan otros)
- *«Búho, hazme un PDF con el presupuesto de la obra y mándamelo»*
- *«Búho, crea una hoja de cálculo con mis gastos de octubre»*

**Cómo responde:** siempre **por escrito**, citando tu mensaje. Si le mandas una nota de voz, la transcribe en tu PC y su respuesta empieza con lo que entendió (*🎤 Entendí: «…»*); en cuanto llega el audio te avisa *«Recibí tu audio, lo estoy procesando…»*. Si una tarea tarda, te escribe *«Sigo en eso: …»*, y puedes mandarle otro pedido mientras tanto: atiende varios a la vez.

**Recordatorios y correos, al instante:** *«Búho, recuérdame el viernes a las 10 la junta»* o *«Búho, envía un correo a … diciendo …»* no pasan por la IA: se crean en un segundo, igual que sin decir «Búho».

**Conversación:** después de cada respuesta queda 10 minutos atento, así que puedes contestarle *«sí»* o seguir preguntando sin decir «Búho». Recuerda la conversación del día. Los *«Recuérdame…»* y *«Envía un correo a…»* siguen funcionando igual que siempre.

**Seguridad:** solo atiende **tus propios mensajes en tu propio chat**; nadie más puede darle órdenes. Enviar mensajes, archivos o correos a otras personas siempre te muestra la vista previa y espera tu «sí».

**Entender bien tus audios:** antes de transcribir se limpia el audio (ruido y volumen). Claude interpreta la transcripción por contexto (si Whisper escribe «Senar», entiende «cenar») y, si un dato clave queda dudoso (a quién, cuánto, cuándo), te pregunta. Una nota que parece recordatorio o correo pero no se entiende del todo también pasa a Claude.

**Respuestas en nota de voz (desactivadas por ahora):** con `BUHO_AUDIO=1` también contesta con nota de voz usando las voces neuronales de Microsoft (el texto pasa por Microsoft para convertirse en voz), con **Piper** local de respaldo (~85 MB). La voz se cambia con `TTS_VOICE` (p. ej. `es-VE-SebastianNeural`).

Tarda de 10 a 60 segundos en responder, según lo que le pidas. Usa tu suscripción de Claude, como el asistente del panel. Para desactivarlo: `BUHO_WHATSAPP=0`.

### Documentos: Google Docs, hojas, presentaciones, PDF y PowerPoint

Desde Búho, el asistente del panel o Claude (MCP), pide un documento y Claude redacta el contenido:

| Formato | Dónde queda |
|---|---|
| Google Docs, Hojas de cálculo y Presentaciones de Google | En tu Drive, carpeta **BuhoChat → Documentos**; te da el enlace |
| PDF, PowerPoint y Excel | En tu PC, en **Documentos\BuhoChat** (y en Drive si lo pides) |

Las hojas de cálculo pueden tener **varias pestañas** y fórmulas. Para **datos de ejemplo** (*«50 clientes, 100 productos y 200 ventas»*), Claude describe las columnas y BuhoChat genera las filas al instante, con nombres, ciudades, productos, precios, fechas, referencias entre pestañas y fórmulas como BUSCARV: una hoja así tarda unos 30 segundos.

Después te lo puede **mandar por WhatsApp** (a ti o a un contacto) o **adjuntarlo a un correo**. Mandarlo a otra persona siempre pide tu confirmación. Solo puede enviar archivos de **Documentos\BuhoChat** y de las carpetas que le permitiste.

Los de Google se crean a través del mismo puente de Apps Script que [sube tus archivos a Drive](#subir-a-google-drive-lo-que-recibes), así que necesitas tenerlo conectado. Los PDF se generan con Microsoft Edge (o Chrome) sin internet y sin ejecutar código del documento.

### Asistente

La pestaña **Asistente** del panel es un chat con Claude que usa las herramientas de BuhoChat: leer y resumir chats, programar mensajes y listas, enviar correos a tu agenda y grupos, y revisar tus carpetas de Drive.

- **Escribe o dicta:** el micrófono graba en el navegador y la transcripción se hace en tu PC con Whisper.
- **Usa tu suscripción de Claude:** el servicio ejecuta Claude Code (ya instalado y con tu sesión) en segundo plano, así que no hay costo extra; cuenta dentro de los límites de tu plan.
- **Seguro por diseño:** el asistente del panel no tiene acceso a la terminal ni a la web, solo a BuhoChat y a tus conectores de Drive y Calendar.
- **Carpetas de tu PC:** en **Ajustes → Carpetas de tu PC para el asistente** eliges qué carpetas puede **ver** (incluidas imágenes); por defecto `Opciones`, de solo lectura. Con el interruptor **Puede escribir**, en esa carpeta también puede guardar fotos, documentos, videos o audios de un chat de WhatsApp, crear archivos (resúmenes, CSV para Excel) y mover o renombrar. Nunca borra y no sobrescribe sin preguntar; fuera de esas carpetas no puede escribir. La carpeta `data/` (sesión de WhatsApp y contraseña de correo), los discos completos y las carpetas del sistema no se pueden permitir. Enviar y programar funciona en dos pasos: primero te muestra la vista previa y solo actúa cuando respondes «sí».
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
| `add_phone_contact` | Agrega o renombra un contacto en WhatsApp y en la agenda del teléfono (con vista previa; actúa con `confirmed: true`) |
| `upload_chat_to_drive` | Sube a Drive todas las fotos (y PDF) de un chat: carpeta por mes, nombre por día |
| `create_followup` · `list_followups` · `update_followup` | Seguimientos: crear (con vista previa), ver y cerrar, cancelar, recordar o reactivar |
| `save_media` | Guarda imágenes, documentos, videos o audios de un chat (por fechas) en una carpeta con escritura |
| `move_file` | Mueve o renombra un archivo dentro de las carpetas con escritura |
| `list_resources` | Lista las carpetas y archivos de Drive guardados, con su número |
| `add_resource` | Guarda un enlace de Drive con descripción corta |
| `remove_resource` | Quita un elemento por su número |
| `list_email_contacts` | Agenda, grupos de correo y cuenta de envío |
| `send_email` | Envía a contactos, grupos o direcciones, con adjuntos opcionales: primero devuelve la vista previa y solo envía con `confirmed: true` tras tu «sí» |
| `add_email_contact` | Agrega un contacto a la agenda (y opcionalmente a un grupo) |
| `transcribe_audio` | Transcribe en la PC las notas de voz o audios de un chat |
| `create_document` | Crea un Google Doc, Hoja de cálculo (con pestañas y datos de ejemplo), Presentación de Google, PDF, PowerPoint o Excel |
| `send_file` | Envía un archivo por WhatsApp (con vista previa; envía con `confirmed: true`) |

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
  drivebridge.js Sube a Drive (vía Apps Script) las imágenes y PDF recibidos, con cola y reintentos
  followups.js   Seguimientos: recordatorios diarios, espera de archivos y revisión con IA
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
| `POST /api/contacts` | Contacto nuevo en WhatsApp y en la agenda del teléfono: `{ name, phone, save_to_phone?, preview? }` |
| `GET/PUT /api/drive-bridge` · `POST /api/drive-bridge/test` · `/backfill` · `/retry` · `GET /api/drive-bridge/uploads` | Subida a Drive por Apps Script |
| `GET/POST /api/followups` · `POST /api/followups/:id/remind\|done\|cancel\|reopen` | Seguimientos |
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
| `AUTONAMES` | `1` | `0` desactiva los nombres automáticos de contactos |
| `BUHO_WHATSAPP` | `1` | `0` desactiva el asistente «Búho» por WhatsApp |
| `BUHO_AUDIO` | `0` | `1` hace que Búho también responda con nota de voz |
| `TTS_VOICE` | `es-MX-JorgeNeural` | Voz de Microsoft para las respuestas en audio |
| `TTS_FALLBACK` | `1` | Con `BUHO_AUDIO=1`: `0` no descarga Piper (sin respaldo de voz sin internet) |
| `WHISPER_CLEAN` | `1` | `0` transcribe el audio sin limpiarlo antes |
| `BUHO_DOCS_DIR` | `Documentos\BuhoChat` | Carpeta de la PC donde se guardan los PDF y PowerPoint que crea |
| `BUHO_BROWSER` | Edge o Chrome | Ruta del navegador con el que se generan los PDF |

## Seguridad

El panel solo escucha en `127.0.0.1`, así que no es accesible desde otros equipos de la red. Rechaza las peticiones que no van dirigidas a `localhost` (protección contra DNS rebinding), y las acciones de escritura exigen JSON y una cabecera propia, de modo que ninguna página web que visites puede usar la API para enviar mensajes.

## Solución de problemas

- **El panel no abre:** revisa `data/service.log`. Si dice que el puerto está en uso, ya hay un servicio corriendo.
- **«Sin vincular» o la sesión se cerró:** vuelve a escanear el QR desde el panel.
- **Un recordatorio no se entendió:** el servicio te responde con lo que transcribió; repítelo diciendo el día y la hora («mañana a las 8…»).
- **Mensaje *perdido*:** la PC estaba apagada a esa hora. Reintenta desde el Historial.
