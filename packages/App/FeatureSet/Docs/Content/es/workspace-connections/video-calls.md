# Videollamadas

Da a cada incidente y a cada alerta su propia llamada. Cuando una regla de notificación de Slack o Microsoft Teams se dispara para un incidente o una alerta nuevos, OneUptime inicia una reunión dedicada (una reunión de Zoom, un Google Meet, una reunión de Microsoft Teams o la huddle del canal de Slack del incidente) y publica un botón **Unirse a la llamada** allí donde van las novedades del incidente. Los respondedores se unen con un clic, y nadie tiene que crear una reunión a las 3 de la madrugada y repartir el enlace.

:::cards
- [Cómo funciona](#cómo-funciona): Una regla inicia la llamada, y los respondedores se unen desde donde estén.
- [Conectar con un clic](#conectar-con-un-clic): Zoom, Google Meet o Microsoft Teams, iniciando sesión.
- [Proveedores](#proveedores): La identidad de servicio de tu propia app, un enlace de reunión permanente o una huddle de Slack.
- [Iniciar una llamada a mano](#iniciar-una-llamada-a-mano): Desde la página de un incidente o de una alerta.
- [Transcripciones de llamadas](#transcripciones-de-llamadas): Lo que se dijo en la llamada de un incidente, y la causa raíz que la IA de OneUptime lee en ella.
:::

## Cómo funciona

```mermaid title="De una regla de notificación a un botón Unirse a la llamada"
flowchart TB
    declared["Se declara un incidente<br/>o una alerta"] --> rule{"Coincide una regla de Slack o Teams<br/>con videollamada"}
    rule --> start["OneUptime inicia una llamada<br/>con la conexión de la regla"]
    start --> posted["Unirse a la llamada, publicado en sus canales,<br/>su feed y su página"]
    start -.->|"el proveedor la rechaza"| failed["El feed dice por qué,<br/>el incidente sigue"]
```

:::steps
### Conectar un proveedor

Ve a **Ajustes del proyecto** > **Espacio de trabajo** > **Videollamadas** y conecta Zoom, Google Meet o Microsoft Teams, o añade un enlace de reunión permanente. En OneUptime Cloud, conectar Zoom, Google Meet o Microsoft Teams es un clic: inicia sesión y permite que OneUptime cree reuniones (consulta [Conectar con un clic](#conectar-con-un-clic)). Las huddles de Slack no necesitan nada más que la conexión de Slack del proyecto.

### Activarla en una regla

Abre una regla de notificación de Slack o Microsoft Teams para incidentes o alertas (**Incidentes** > **Espacio de trabajo** > **Slack**, por ejemplo). En el paso **Videollamada** de la regla, activa **Start a video call for the incident** y elige dónde se celebra la llamada.

### Unirse con un clic

Cuando la regla se dispara, OneUptime inicia una llamada para el incidente y la publica con un botón **Unirse a la llamada** en los canales a los que van las novedades del incidente y en el feed del incidente. La página del incidente muestra la llamada en su tarjeta **Videollamada** y un botón **Unirse a la llamada** en su cabecera.
:::

Las condiciones de la regla deciden qué incidentes reciben una llamada. Para una sala solo con los incidentes Sev1, da a la regla una condición de **Gravedad**. Las llamadas se inician para los incidentes y las alertas que se declaran en curso. Un incidente creado ya resuelto no recibe llamada.

### Una llamada por incidente

Se inicia una llamada una vez por incidente para cada lugar donde se celebra una llamada. Las reglas que eligen la misma conexión comparten una llamada, y una regla nunca inicia una segunda llamada para un incidente que ya tiene una de esa conexión. Las reglas que eligen lugares distintos inician cada una su propia llamada, por ejemplo una reunión de Zoom para los respondedores y la huddle del canal de Slack del incidente.

### Cuando una llamada no puede iniciarse

Declarar un incidente nunca espera a un proveedor de videollamadas. La llamada se inicia después de crear el incidente, así que un proveedor lento o que falla nunca retrasa el incidente ni sus notificaciones de guardia.

Si el proveedor la rechaza (un secreto caducado, un permiso que falta, un anfitrión eliminado), el feed del incidente dice que la llamada de la regla no pudo iniciarse, con el motivo del proveedor, para que los respondedores sepan iniciar una desde la página del incidente. La ejecución de la regla aparece en los registros de notificación del espacio de trabajo como **Iniciar videollamada**, y la fila de la conexión en **Ajustes del proyecto** > **Espacio de trabajo** > **Videollamadas** muestra el error hasta que vuelve a iniciarse una llamada.

### Incidentes privados

Una reunión lleva el nombre del incidente para el que es, con su número y su título, y su descripción enlaza con el incidente. En un incidente privado se omite el título, porque todas las personas invitadas a la reunión pueden leer su nombre.

## Conectar con un clic

En OneUptime Cloud, conectar Zoom, Google Meet o Microsoft Teams lleva un clic y no hay nada que configurar en el proveedor:

:::steps
1. Ve a **Ajustes del proyecto** > **Espacio de trabajo** > **Videollamadas** y haz clic en **Conectar** en Zoom, Google Meet o Microsoft Teams.
2. Haz clic en **Continue to Zoom** (o Google, o Microsoft), inicia sesión y permite que OneUptime cree reuniones.
3. Vuelves a la página de videollamadas con la conexión hecha. **Iniciar una reunión de prueba** la comprueba de principio a fin; luego elige la conexión en una regla de notificación de Slack o Microsoft Teams.
:::

Cada reunión se crea como la cuenta con la que inicias sesión, que es su anfitriona. Inicia sesión con una cuenta compartida, como incidents@example.com, en lugar de la tuya, para que las llamadas sigan iniciándose cuando alguien se va. La fila de la conexión muestra con qué cuenta ha iniciado sesión.

| Proveedor | Iniciar sesión con | Lo que OneUptime puede hacer |
| --- | --- | --- |
| Zoom | Un usuario de Zoom. Las reuniones con un usuario Basic (gratuito) como anfitrión terminan a los 40 minutos. | Crear reuniones para ese usuario (`meeting:write:meeting`) y leer quién es (`user:read:user`). Para las [transcripciones de llamadas](#transcripciones-de-llamadas), leer las transcripciones de las grabaciones en la nube de sus reuniones (`cloud_recording:read:list_recording_files`, `cloud_recording:read:meeting_transcript`). |
| Google Meet | Una cuenta de Google que pueda usar Google Meet. | Crear espacios de Meet como esa cuenta (`meetings.space.created`) y leer su dirección de correo. |
| Microsoft Teams | Una cuenta profesional o educativa con Microsoft Teams. Las cuentas personales de Microsoft no pueden crear reuniones de Teams. | Crear reuniones en línea como esa cuenta (el permiso delegado `OnlineMeetings.ReadWrite`) y mantener la sesión iniciada (`offline_access`). Para [grabar y transcribir las llamadas de incidentes](#grabar-y-transcribir-cada-llamada), poner las reuniones en su calendario (`Calendars.ReadWrite`) y leer sus transcripciones (`OnlineMeetingTranscript.Read.All`, que debe aprobar un administrador). |

Una conexión hecha iniciando sesión sigue teniendo los ajustes que deciden quién espera: **Who can join** para Google Meet y **Who skips the lobby** para Microsoft Teams. Cámbialos con **Editar** en la fila de la conexión.

Una conexión de Zoom iniciada antes de que OneUptime leyera transcripciones de llamadas inicia llamadas como antes, pero no puede leer sus transcripciones hasta que vuelva a iniciar sesión: **Reconnect** en su fila pide a Zoom los permisos de transcripción.

Una conexión de Microsoft Teams iniciada mientras **Grabar y transcribir las llamadas de incidentes** estaba desactivado inicia llamadas como antes, sin grabarlas. Una vez activado ese ajuste, **Reconnect** en su fila también pide a Microsoft los permisos de calendario y de transcripción.

### Mantener la sesión iniciada

OneUptime guarda el token de actualización del inicio de sesión, cifrado, y lo renueva al menos una vez por semana, así que nunca caduca por falta de uso, por mucho tiempo que el proyecto pase sin un incidente. Si el inicio de sesión deja de funcionar (la cuenta quitó OneUptime, se eliminó o se suspendió, o la política de tu organización le pide volver a iniciar sesión), la fila de la conexión muestra **No funciona** con el motivo el día en que OneUptime lo detecta, no en el próximo incidente. **Reconnect** en la fila vuelve a iniciar sesión.

Las conexiones que iniciaron sesión con la misma cuenta comparten un único inicio de sesión, en todos los proyectos: Zoom guarda solo un inicio de sesión por cuenta, así que conectar de nuevo el mismo usuario de Zoom lo sustituye para todas ellas.

### Reconectar y eliminar

**Reconnect** en la fila de una conexión vuelve a iniciar sesión, con la misma cuenta o con otra. Úsalo después de que la cuenta haya quitado OneUptime, o para pasar las reuniones de incidentes a otra cuenta.

Eliminar una conexión retira el acceso de OneUptime en Zoom y Google en cuanto ninguna otra conexión usa ese inicio de sesión. En Microsoft, quita OneUptime en **My Apps** (myapps.microsoft.com) de la cuenta. Quitar OneUptime de tu cuenta de Zoom en el Zoom App Marketplace elimina su inicio de sesión de todas las conexiones que lo usaban con esa cuenta, y muestran **No funciona** hasta que se reconectan.

### Si Microsoft pide un administrador

Algunas organizaciones de Microsoft 365 solo permiten que los administradores aprueben apps. Si Microsoft dice que necesitas la aprobación de un administrador, pide a un administrador de Microsoft 365 que conecte Microsoft Teams, o que apruebe OneUptime en el [centro de administración de Microsoft Entra](https://entra.microsoft.com/) en **Enterprise applications** > **Admin consent requests**. Un proyecto que graba sus llamadas de Teams necesita esta aprobación en cada organización, una sola vez: solo un administrador puede permitir que una app lea las transcripciones de las reuniones.

### Usar tu propia app

Para conectar con una identidad de servicio en lugar del inicio de sesión de una persona — una app Server-to-Server OAuth de Zoom, una cuenta de servicio de Google con delegación de todo el dominio o un registro de aplicación de Microsoft Entra — haz clic en **Use your own Zoom app** (o Google, o Microsoft) en el diálogo Conectar. [Proveedores](#proveedores) explica cada uno. En un servidor autoalojado sin apps de un clic configuradas, **Conectar** abre este formulario directamente; consulta [Conectar con un clic en un servidor autoalojado](#conectar-con-un-clic-en-un-servidor-autoalojado) para configurarlas.

## Iniciar una llamada a mano

La tarjeta **Videollamada** de la página de un incidente o de una alerta tiene **Iniciar llamada** (o **Iniciar otra** cuando ya hay una). Elige una de las conexiones del proyecto, la huddle del canal de Slack del incidente, o pega un enlace de reunión propio. La llamada se publica en los canales y el feed del incidente igual que una que inicia una regla.

**Eliminar** en la tarjeta quita una llamada de la página del incidente. La reunión en sí no se elimina, y cualquiera que tenga el enlace puede seguir uniéndose.

Iniciar y quitar llamadas requiere permiso para trabajar en incidentes (o alertas): **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** o **Miembro de incidentes**, o **Create Incident Video Call** y **Delete Incident Video Call** en un rol personalizado. Todas las personas que pueden leer el incidente ven sus llamadas.

## Transcripciones de llamadas

Lo que los responsables dicen en una llamada, lo que comprobaron, lo que sospechan y lo que decidieron, es el mejor registro de cómo se trabajó un incidente, y desaparece cuando termina la llamada. La llamada de un incidente conserva su transcripción, y la IA de OneUptime la lee para encontrar la causa raíz que señala la llamada. Nada de lo que lee llega al incidente hasta que un responsable lo usa.

:::steps
### Obtén la transcripción después de la llamada

En la tarjeta **Videollamada** del incidente, **Obtener de Zoom**, **Obtener de Google Meet** u **Obtener de Microsoft Teams** lee la transcripción de una reunión que OneUptime inició allí (en Microsoft Teams, una que inició mientras cada llamada se graba y se transcribe). Para cualquier otra llamada, **Añadir transcripción** toma el archivo que guardó la herramienta de reuniones (`.vtt`, `.srt` o `.txt`, hasta 5 MB) o la transcripción pegada. Con [cada llamada grabada y transcrita](#grabar-y-transcribir-cada-llamada), OneUptime la obtiene por sí solo cuando termina la llamada.

### La IA de OneUptime la lee

En uno o dos minutos, la tarjeta **OneUptime AI** del incidente muestra la **Causa raíz sugerida**, marcada como **Sin confirmar**, con las líneas de la transcripción en las que se basa, citadas con su hora y quién habló. Debajo, plegado, está el resto de lo que dijo la llamada: los hallazgos, separados en **Confirmado en la llamada** e **Hipótesis**, y luego lo que se intentó, las decisiones, los seguimientos y las preguntas abiertas. Lo que leyó la IA de OneUptime también se publica en el feed del incidente, y desde allí en los canales de Slack y Microsoft Teams del incidente.

### Úsala o descártala

**Usar como causa raíz** abre la sugerencia, con sus citas, en el editor de la causa raíz. Cambia lo que necesites y guarda: pasa a ser la causa raíz del incidente como tu propia edición, registrada en su feed. **Descartar** aparta la sugerencia, y **Deshacer** la recupera.
:::

La IA de OneUptime solo sugiere una causa cuando la llamada nombra una, con las líneas que lo dicen, y cita esas líneas tal como las tiene la transcripción. Cuando la llamada no aclaró la causa, la tarjeta dice **No se dijo lo suficiente en la llamada para sugerir una causa raíz** en lugar de adivinar.

### Grabar y transcribir cada llamada

Para que nadie tenga que acordarse de grabar una llamada ni de obtener su transcripción, activa **Grabar y transcribir las llamadas de incidentes** en **Ajustes del proyecto** > **Espacio de trabajo** > **Videollamadas**. Mientras está activado:

- OneUptime pide a Zoom que grabe en la nube cada reunión de incidente que inicia, a Google Meet que la transcriba y a Microsoft Teams que la grabe y la transcriba automáticamente. El mensaje que publica la llamada lo indica antes de que nadie se una.
- Cuando termina la llamada, OneUptime obtiene la transcripción por sí solo, como lo haría **Obtener de Zoom**, y la IA de OneUptime la lee. Hasta entonces, la tarjeta **Videollamada** indica que está esperándola.
- Lo que leyó la IA de OneUptime va al feed del incidente y a sus canales de Slack y Microsoft Teams: la causa raíz sugerida, marcada como sin confirmar, y luego lo que se confirmó, se intentó y se decidió, los seguimientos y las preguntas abiertas.
- Si el incidente se resuelve antes de que llegue la transcripción, el borrador automático del post mortem la espera, para recoger lo que se dijo en la llamada: hasta seis horas mientras el proveedor prepara la transcripción, y una hora cuando todavía no hay señales de ella.

Está desactivado por defecto, porque graba a personas: todos los que están en esas llamadas ven que se graban o se transcriben, así que comprueba que tu organización lo permite. Zoom solo guarda una transcripción cuando la cuenta graba en la nube con su transcripción de audio activada, y Google Meet solo en una edición de Google Workspace que tenga transcripciones. Las huddles de Slack y los enlaces de reunión no se graban, y tampoco las llamadas de las alertas: añade sus transcripciones a mano.

Microsoft solo deja que las apps lean las transcripciones de las reuniones de Teams que están en un calendario, así que OneUptime pone cada reunión de incidente en el calendario de su organizador y activa la grabación y la transcripción automáticas en las opciones de la reunión. Para ello, la conexión necesita dos permisos más de Microsoft Graph, `Calendars.ReadWrite` y `OnlineMeetingTranscript.Read.All`: añádelos a tu registro de aplicación (consulta [Microsoft Teams](#microsoft-teams)), o usa **Reconnect** en una conexión hecha iniciando sesión. La directiva de reuniones de Teams del organizador debe permitir la grabación en la nube, la transcripción y la grabación automática, y tu organización no debe haber desactivado el acceso de las apps a las transcripciones. Una llamada que OneUptime no puede poner en el calendario se inicia igualmente, sin grabarse, y su tarjeta **Videollamada** indica por qué.

### Qué guarda cada proveedor

| Llamada | Cómo obtiene su transcripción | Qué necesita |
| --- | --- | --- |
| Zoom | **Obtener de Zoom** | Una reunión grabada en la nube con su transcripción de audio activada, o con el resumen de reunión de AI Companion activado. La conexión necesita los scopes de transcripción (consulta [Zoom](#zoom)), y una que inició sesión antes de ellos necesita **Reconnect**. Zoom prepara una transcripción después de la reunión, normalmente en menos del doble de su duración. |
| Google Meet | **Obtener de Google Meet** | Transcripciones activadas en la llamada, en una edición de Google Workspace que las tenga. No hay nada más que configurar: OneUptime lee las transcripciones de las reuniones que creó. Google conserva una transcripción para que las apps la lean durante 30 días. |
| Microsoft Teams | **Obtener de Microsoft Teams** | Una reunión que OneUptime inició mientras [cada llamada se graba y se transcribe](#grabar-y-transcribir-cada-llamada): Microsoft solo deja que las apps lean las transcripciones de las reuniones que están en un calendario, y conserva una reunión durante 60 días. Para cualquier otra reunión de Teams, **Añadir transcripción**: en Teams, abre el resumen de la reunión, luego su transcripción, y descárgala como archivo `.vtt`. |
| Enlace de reunión o huddle de Slack | **Añadir transcripción** | La transcripción que guardan la herramienta de reuniones o las notas del huddle. |

### Quién puede hacer qué

Obtener, añadir, reemplazar y eliminar una transcripción, hacer que se vuelva a leer y descartar una sugerencia requieren permiso para iniciar las llamadas del incidente: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** o **Miembro de incidentes**, o **Create Incident Video Call** en un rol personalizado. **Usar como causa raíz** requiere permiso para editar la causa raíz del incidente. Quien pueda leer el incidente ve las transcripciones de sus llamadas y lo que la IA de OneUptime leyó en ellas.

### Qué lee la IA de OneUptime

Leer una transcripción es trabajo de IA como una investigación: solo se ejecuta mientras la IA está activada para el proyecto, y cuenta para el uso de IA y los límites diarios del proyecto (consulta [Control de costes](/docs/ai/ai-sre#control-de-costes)). Una transcripción larga se lee por partes. Cuando la IA está desactivada, la transcripción se conserva y la tarjeta dice que no se leyó. Eliminar una transcripción elimina lo que la IA de OneUptime leyó en ella, y conserva la causa raíz del incidente. Un borrador de post mortem de la IA también lee lo que se dijo en las llamadas del incidente (consulta [Post mortems](/docs/incidents/postmortems)).

## Proveedores

Esta sección trata de conectar un proveedor con la identidad de servicio de tu propia app: una app Server-to-Server OAuth de Zoom, una cuenta de servicio de Google, un registro de aplicación de Microsoft Entra. Una identidad de servicio nunca depende de una persona, así que sigue funcionando se vaya quien se vaya. Para conectar iniciando sesión, consulta [Conectar con un clic](#conectar-con-un-clic).

Las credenciales se cifran en reposo y la API nunca las devuelve. Cuando editas una conexión, una credencial que dejas en blanco conserva la guardada.

**Iniciar reunión de prueba** en el formulario de conexión, y **Probar** en la fila de una conexión, crean una reunión real con los ajustes de la conexión y muestran su enlace. Es la única comprobación que demuestra que las credenciales, el permiso en el lado del proveedor y el anfitrión funcionan juntos. No se publica nada en ningún sitio.

Conectar un proveedor requiere **Propietario del proyecto**, **Administrador del proyecto** o **Administrador de ajustes**, o **Create Video Call Connection** y **Edit Video Call Connection** en un rol personalizado.

### Zoom

OneUptime crea una reunión de Zoom para cada incidente mediante una app **Server-to-Server OAuth** de Zoom, con un usuario de Zoom con licencia que elijas como anfitrión.

:::steps
1. En el [Zoom App Marketplace](https://marketplace.zoom.us/), elige **Develop** > **Build App** y crea una app **Server-to-Server OAuth**. Crearla requiere un administrador de la cuenta de Zoom, o un rol que permita apps Server-to-Server OAuth.
2. En la página **Scopes** de la app, añade **meeting:write:meeting:admin** (crear una reunión para un usuario). Una app creada antes de los scopes granulares puede usar **meeting:write:admin** en su lugar. Para que OneUptime también lea las [transcripciones de llamadas](#transcripciones-de-llamadas), añade **cloud_recording:read:list_recording_files:admin** y **cloud_recording:read:meeting_transcript:admin** (o **recording:read:admin** en una app creada antes de los scopes granulares).
3. Haz clic en **Activate** para activar la app y copia el **Account ID**, el **Client ID** y el **Client secret** de su página **App Credentials** en el formulario de conexión.
4. Escribe el **Meeting host**: el correo de un usuario de Zoom con licencia, idealmente una cuenta de servicio como incidents@example.com, para que las reuniones sigan funcionando cuando alguien se va. Las reuniones con un usuario Basic (gratuito) como anfitrión terminan a los 40 minutos.
5. Los respondedores se unen sin esperar al anfitrión, porque el anfitrión es una cuenta de servicio que nunca se une. Asegúrate de que el ajuste **Waiting room** de tu cuenta de Zoom no esté bloqueado como activado, o nadie podrá entrar.
:::

| Campo | Dónde encontrarlo |
| --- | --- |
| Account ID | La página **App Credentials** de la app |
| Client ID | La página **App Credentials** de la app |
| Client secret | La página **App Credentials** de la app |
| Meeting host | El correo del usuario de Zoom con licencia que es anfitrión de cada reunión |

### Google Meet

OneUptime crea un Google Meet para cada incidente con la Google Meet REST API, mediante una cuenta de servicio de Google Cloud que actúa como un usuario de Google Workspace gracias a la delegación de todo el dominio.

:::steps
1. En la [consola de Google Cloud](https://console.cloud.google.com/), elige o crea un proyecto y habilita en él la **Google Meet REST API**.
2. En **IAM & Admin** > **Service accounts**, crea una cuenta de servicio. Ábrela, ve a **Keys** > **Add key** > **Create new key**, elige **JSON** y pega el archivo descargado en el formulario de conexión como **Service account JSON key**.
3. En la [consola de administración de Google](https://admin.google.com/), abre **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** y haz clic en **Add new**. Escribe el **Client ID** numérico de la cuenta de servicio y el scope `https://www.googleapis.com/auth/meetings.space.created`.
4. Escribe en **Create meetings as** el usuario de Google Workspace como el que actúa la cuenta de servicio: una cuenta dedicada como incidents@example.com. Cada reunión pertenece a este usuario.
:::

**Who can join** decide quién se une sin pedirlo: con **People in your organization join directly, others ask to join** (el valor predeterminado), las personas de fuera de tu Google Workspace piden unirse y alguien en la llamada las admite. Con **Anyone with the link joins directly**, nadie espera.

La delegación de todo el dominio puede tardar unos minutos en empezar a funcionar. Si justo después de añadir la delegación la prueba indica que Google no dejó que la cuenta de servicio actuara como el usuario, espera unos minutos y vuelve a probar.

### Microsoft Teams

OneUptime crea una reunión de Microsoft Teams para cada incidente con Microsoft Graph, mediante un registro de aplicación de Microsoft Entra que organiza reuniones en nombre de un usuario de Teams con licencia.

:::steps
1. En el [centro de administración de Microsoft Entra](https://entra.microsoft.com/), abre **App registrations** > **New registration** y registra una app de un solo inquilino. Copia su **Directory (tenant) ID** y su **Application (client) ID**.
2. En **API permissions**, añade el permiso de tipo **application** de Microsoft Graph **OnlineMeetings.ReadWrite.All** (y, si además quieres [grabar y transcribir las llamadas de incidentes](#grabar-y-transcribir-cada-llamada), **Calendars.ReadWrite** y **OnlineMeetingTranscript.Read.All**) y haz clic en **Grant admin consent**.
3. En **Certificates & secrets**, crea un secreto de cliente y pega su **Value**, no su Secret ID, en el formulario de conexión como **Secreto del cliente**.
4. Elige el organizador: un usuario de Teams con licencia, idealmente una cuenta de servicio. Copia su **Object ID** desde **Users** en el centro de administración de Entra en **Organizer object ID**.
5. Permite que la app cree reuniones para el organizador con una directiva de acceso de aplicaciones. En Teams PowerShell, después de `Connect-MicrosoftTeams`, ejecuta los dos comandos siguientes.
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

La directiva puede tardar hasta 30 minutos en aplicarse. Hasta entonces, la prueba indica que la app no tiene permiso para crear reuniones para el organizador.

La misma directiva permite que la app lea las transcripciones de las reuniones del organizador. `Calendars.ReadWrite` permite que una app modifique todos los calendarios de tu organización: para limitar ese permiso al calendario del organizador, concédelo con [RBAC para aplicaciones en Exchange Online](https://learn.microsoft.com/exchange/permissions-exo/application-rbac), con el organizador como ámbito, en lugar de en **API permissions**.

**Who skips the lobby** decide quién se une sin esperar: con **People in your organization skip the lobby** (el valor predeterminado), cualquier otra persona espera en la sala de espera hasta que alguien en la reunión la admite. Con **Everyone skips the lobby**, nadie espera.

### Enlace de reunión

Un enlace de reunión permanente es la misma sala para cada incidente: una sala de reuniones personal de Zoom, una reunión periódica de Microsoft Teams o Google Meet, una sala personal de Webex o una sala de Jitsi. No se crea nada por incidente, así que no hay nada que autorizar.

:::steps
1. Crea una reunión que nunca caduque en la herramienta que tu equipo ya usa.
2. Pega su enlace https para unirse en el formulario de conexión como **Enlace de la reunión**.
:::

Cada incidente y cada alerta iniciados con esta conexión comparten la sala, así que dos incidentes a la vez también la comparten. Asegúrate de que la reunión permita unirse sin el anfitrión.

### Huddles de Slack

Una regla de Slack puede iniciar en su lugar la huddle del canal de Slack del incidente. No hay nada que conectar: elige **Huddle de Slack** en el paso **Videollamada** de la regla.

La huddle se celebra en el canal que la regla crea para el incidente o, cuando la regla publica en canales existentes, en el primero de ellos. Así que la regla tiene que crear un canal o publicar en uno existente. El botón **Unirse a la huddle** abre la huddle del canal en Slack. El primer respondedor que la abre inicia la huddle, y todos los siguientes se unen a ella. Slack no ofrece ninguna forma de que una app inicie una huddle, así que no hay nadie en la huddle hasta que alguien la abre.

Una huddle de Slack es solo para reglas de Slack. Una regla de Microsoft Teams inicia sus llamadas con una de las conexiones de videollamada del proyecto.

## Usar la API

Una llamada es un registro en el incidente (`IncidentVideoCall`) o en la alerta (`AlertVideoCall`). Crea uno con el `_id` del incidente y uno de estos:

- `videoCallConnectionId`: iniciar una reunión nueva con esa conexión.
- `provider` con el valor `SlackHuddle`: la huddle del canal de Slack del incidente.
- `joinUrl` (y opcionalmente `title`): un enlace de reunión propio.

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` inicia una reunión de prueba con una conexión guardada (`{ "connectionId": "..." }`) o con ajustes que aún no están guardados (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`), y devuelve su `joinUrl`.

El `authMethod` de una conexión indica cómo inicia sesión: `OAuth` para una hecha iniciando sesión, `AppCredentials` para una con las credenciales de tu propia app, y nada para un enlace de reunión. Una conexión hecha iniciando sesión solo se crea iniciando sesión, en el panel. Mediante la API puedes renombrarla y cambiar su `config`, y su `connectedAccount` indica con qué cuenta ha iniciado sesión.

## Conectar con un clic en un servidor autoalojado

OneUptime Cloud tiene sus propias apps de Zoom, Google y Microsoft para conectar con un clic. Un servidor autoalojado lo ofrece para cada proveedor cuya app configures. Sin ella, **Conectar** abre el formulario para tu propia app.

Crea una app OAuth por proveedor y registra en ella esta URI de redirección, con el host de tu servidor:

| Proveedor | URI de redirección | Variables de entorno | Valores de Helm |
| --- | --- | --- | --- |
| Zoom | `https://<host>/api/video-call-oauth/zoom/callback` | `ZOOM_APP_CLIENT_ID`, `ZOOM_APP_CLIENT_SECRET`, `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.clientId`, `zoomApp.clientSecret`, `zoomApp.webhookSecretToken` |
| Google Meet | `https://<host>/api/video-call-oauth/google-meet/callback` | `GOOGLE_MEET_APP_CLIENT_ID`, `GOOGLE_MEET_APP_CLIENT_SECRET` | `googleMeetApp.clientId`, `googleMeetApp.clientSecret` |
| Microsoft Teams | `https://<host>/api/video-call-oauth/microsoft-teams/callback` | `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID`, `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET` | `microsoftTeamsMeetingsApp.clientId`, `microsoftTeamsMeetingsApp.clientSecret` |

- **Zoom**: en el [Zoom App Marketplace](https://marketplace.zoom.us/), elige **Develop** > **Build App** y crea una **General App**, gestionada por los usuarios. En **Basic Information**, añade la URI de redirección como OAuth Redirect URL en las pestañas **Development** y **Production** y en la lista de permitidos de OAuth, y en la pestaña **Production** pon como URL del punto de conexión de **Deauthorization Notification** `https://<host>/api/video-call-oauth/zoom/events`. En **Scopes**, añade `meeting:write:meeting` y `user:read:user`. Para que pueda leer las [transcripciones de llamadas](#transcripciones-de-llamadas), añade también `cloud_recording:read:list_recording_files` y `cloud_recording:read:meeting_transcript`. El **Secret Token** en **Features** > **Access** es `ZOOM_APP_WEBHOOK_SECRET_TOKEN`. Las credenciales de **Development** solo funcionan para los usuarios de tu propia cuenta de Zoom; las de **Production** funcionan para todos una vez que Zoom ha revisado y publicado la app.
- **Google Meet**: en la [consola de Google Cloud](https://console.cloud.google.com/), habilita la **Google Meet REST API**, configura la pantalla de consentimiento de OAuth (**Google Auth Platform**) con los scopes `openid`, `email` y `https://www.googleapis.com/auth/meetings.space.created`, y crea un cliente OAuth de tipo **Web application** con la URI de redirección. Publica la app en producción: una app que se queda en pruebas pierde sus inicios de sesión a los siete días. Google revisa las apps que piden el scope de Meet; hasta que lo haga, las personas ven una advertencia antes de iniciar sesión.
- **Microsoft Teams**: en el [centro de administración de Microsoft Entra](https://entra.microsoft.com/), registra una app para **Accounts in any organizational directory**, añade la URI de redirección como URI de redirección **Web**, añade los permisos delegados de Microsoft Graph `openid`, `profile`, `email`, `offline_access` y `OnlineMeetings.ReadWrite` (además de `Calendars.ReadWrite` y `OnlineMeetingTranscript.Read.All`, que pide un proyecto que [graba y transcribe sus llamadas](#grabar-y-transcribir-cada-llamada)), y crea un secreto de cliente. Usa un registro propio, no el del bot de Microsoft Teams (`MICROSOFT_TEAMS_APP_CLIENT_ID`). Hasta que la app tenga un editor verificado, la mayoría de las organizaciones necesitan que un administrador dé su consentimiento. Si tu organización no permite apps multiinquilino, regístrala para **Accounts in this organizational directory only** y pon en `MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID` (Helm `microsoftTeamsMeetingsApp.tenantId`) su **Directory (tenant) ID**: los inicios de sesión van entonces a tu inquilino, donde solo pueden iniciar sesión los miembros e invitados de tu organización. Si tu inquilino de Microsoft 365 está en una nube del Gobierno de EE. UU., registra la aplicación en el centro de administración de Microsoft Entra de esa nube y define `MICROSOFT_TEAMS_CLOUD`, como para el [bot de Microsoft Teams](/docs/self-hosted/microsoft-teams-integration#nubes-del-gobierno-de-ee-uu): sus inicios de sesión y reuniones van entonces a los hosts de esa nube.

Los ID de cliente son públicos: se envían al panel para que sepa qué proveedores se conectan con un clic. Mantén en secreto los secretos y el token secreto del webhook. Cada día, el worker renueva los inicios de sesión a los que les toca, así que necesita los mismos valores que la app.

## Solución de problemas

:::details No se inició ninguna llamada para un incidente
Comprueba que la regla coincidió con el incidente (**Probar regla**), que su paso **Videollamada** está activado y que el incidente se declaró en curso: un incidente creado ya resuelto no recibe llamada. Una regla que ya inició una llamada para el incidente con esa conexión no inicia otra.
:::

:::details El feed dice que la llamada no pudo iniciarse
El proveedor la rechazó, y el feed da su motivo. Mientras tanto, inicia una llamada desde la página del incidente. Luego ejecuta **Probar** en la fila de la conexión: muestra el mismo motivo mientras corriges la configuración en el proveedor, como un secreto de cliente caducado o un permiso que falta.
:::

:::details Una conexión muestra No funciona
Su inicio de sesión dejó de funcionar: la cuenta quitó OneUptime, se eliminó o se suspendió, o debe volver a iniciar sesión. Haz clic en **Reconnect** en su fila. Hasta entonces, las llamadas que debería iniciar no pueden iniciarse.
:::

:::details Las personas esperan en una sala de espera
Cambia **Who can join** (Google Meet) o **Who skips the lobby** (Microsoft Teams) con **Editar** en la fila de la conexión. En Zoom, asegúrate de que el ajuste **Waiting room** de la cuenta no esté bloqueado como activado.
:::

:::details Obtener de Zoom no encuentra ninguna transcripción
Zoom solo conserva la transcripción de una reunión grabada en la nube con su transcripción de audio activada, o con el resumen de reunión de AI Companion activado, y la prepara después de que termina la reunión. La tarjeta dice cuál es el caso: vuelve a intentarlo más tarde, o activa una de las dos opciones para tus reuniones de incidentes. Mientras tanto, **Añadir transcripción** toma una transcripción que hayas guardado.
:::

:::details La tarjeta Videollamada sigue esperando una transcripción
Cuando termina la llamada, OneUptime se la pide a Zoom, a Google Meet o a Microsoft Teams cada pocos minutos, cada vez con menos frecuencia a medida que la llamada envejece, durante tres días desde que empezó la llamada. La transcripción llega pocos minutos después de que el proveedor la haya preparado, y Zoom tarda hasta aproximadamente el doble de lo que duró la llamada. **Obtener de Zoom** la pide al momento. Cuando el proveedor no guarda ninguna transcripción, la tarjeta lo dice: comprueba que la cuenta de Zoom graba en la nube con su transcripción de audio activada, que tu edición de Google Workspace tiene transcripciones o que la directiva de reuniones de Teams del organizador permite la grabación automática.
:::

:::details Una llamada de Microsoft Teams no se grabó
OneUptime no pudo poner la reunión en el calendario de su organizador, así que inició la llamada de la forma habitual, sin grabarla, y la tarjeta **Videollamada** indica por qué. Normalmente a la conexión le falta `Calendars.ReadWrite` o `OnlineMeetingTranscript.Read.All`: añádelos al registro de aplicación y concede el consentimiento de administrador, o usa **Reconnect** en una conexión hecha iniciando sesión. Las llamadas que se inicien después se graban.
:::

:::details La IA de OneUptime no pudo leer una transcripción
La tarjeta dice por qué: la IA está desactivada para el proyecto, el proyecto alcanzó un límite diario de IA, o el proveedor de IA se negó. Una vez resuelto, **Volver a intentar** en la tarjeta la vuelve a leer.
:::

## Próximos pasos

:::cards
- [Slack](/docs/workspace-connections/slack): Las reglas que inician llamadas, y los canales en los que publican.
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Las mismas reglas y llamadas en Microsoft Teams.
- [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurar el bot de Teams en un servidor autoalojado.
- [Declarar un incidente](/docs/incidents/declaring-incidents): Lo que pasa cuando empieza un incidente.
:::
