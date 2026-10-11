# Videollamadas

Da a cada incidente y a cada alerta su propia llamada. Cuando una regla de notificación de Slack o Microsoft Teams se dispara para un incidente o una alerta nuevos, OneUptime inicia una reunión dedicada (una reunión de Zoom, un Google Meet, una reunión de Microsoft Teams o la huddle del canal de Slack del incidente) y publica un botón **Unirse a la llamada** allí donde van las novedades del incidente. Los respondedores se unen con un clic, y nadie tiene que crear una reunión a las 3 de la madrugada y repartir el enlace.

:::cards
- [Cómo funciona](#cómo-funciona): Una regla inicia la llamada, y los respondedores se unen desde donde estén.
- [Conectar con un clic](#conectar-con-un-clic): Zoom, Google Meet o Microsoft Teams, iniciando sesión.
- [Proveedores](#proveedores): La identidad de servicio de tu propia app, un enlace de reunión permanente o una huddle de Slack.
- [Iniciar una llamada a mano](#iniciar-una-llamada-a-mano): Desde la página de un incidente o de una alerta.
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
| Zoom | Un usuario de Zoom. Las reuniones con un usuario Basic (gratuito) como anfitrión terminan a los 40 minutos. | Crear reuniones para ese usuario (`meeting:write:meeting`) y leer quién es (`user:read:user`). |
| Google Meet | Una cuenta de Google que pueda usar Google Meet. | Crear espacios de Meet como esa cuenta (`meetings.space.created`) y leer su dirección de correo. |
| Microsoft Teams | Una cuenta profesional o educativa con Microsoft Teams. Las cuentas personales de Microsoft no pueden crear reuniones de Teams. | Crear reuniones en línea como esa cuenta (el permiso delegado `OnlineMeetings.ReadWrite`) y mantener la sesión iniciada (`offline_access`). |

Una conexión hecha iniciando sesión sigue teniendo los ajustes que deciden quién espera: **Who can join** para Google Meet y **Who skips the lobby** para Microsoft Teams. Cámbialos con **Editar** en la fila de la conexión.

### Mantener la sesión iniciada

OneUptime guarda el token de actualización del inicio de sesión, cifrado, y lo renueva al menos una vez por semana, así que nunca caduca por falta de uso, por mucho tiempo que el proyecto pase sin un incidente. Si el inicio de sesión deja de funcionar (la cuenta quitó OneUptime, se eliminó o se suspendió, o la política de tu organización le pide volver a iniciar sesión), la fila de la conexión muestra **Not working** con el motivo el día en que OneUptime lo detecta, no en el próximo incidente. **Reconnect** en la fila vuelve a iniciar sesión.

Las conexiones que iniciaron sesión con la misma cuenta comparten un único inicio de sesión, en todos los proyectos: Zoom guarda solo un inicio de sesión por cuenta, así que conectar de nuevo el mismo usuario de Zoom lo sustituye para todas ellas.

### Reconectar y eliminar

**Reconnect** en la fila de una conexión vuelve a iniciar sesión, con la misma cuenta o con otra. Úsalo después de que la cuenta haya quitado OneUptime, o para pasar las reuniones de incidentes a otra cuenta.

Eliminar una conexión retira el acceso de OneUptime en Zoom y Google en cuanto ninguna otra conexión usa ese inicio de sesión. En Microsoft, quita OneUptime en **My Apps** (myapps.microsoft.com) de la cuenta. Quitar OneUptime de tu cuenta de Zoom en el Zoom App Marketplace elimina su inicio de sesión de todas las conexiones que lo usaban con esa cuenta, y muestran **Not working** hasta que se reconectan.

### Si Microsoft pide un administrador

Algunas organizaciones de Microsoft 365 solo permiten que los administradores aprueben apps. Si Microsoft dice que necesitas la aprobación de un administrador, pide a un administrador de Microsoft 365 que conecte Microsoft Teams, o que apruebe OneUptime en el [centro de administración de Microsoft Entra](https://entra.microsoft.com/) en **Enterprise applications** > **Admin consent requests**.

### Usar tu propia app

Para conectar con una identidad de servicio en lugar del inicio de sesión de una persona — una app Server-to-Server OAuth de Zoom, una cuenta de servicio de Google con delegación de todo el dominio o un registro de aplicación de Microsoft Entra — haz clic en **Use your own Zoom app** (o Google, o Microsoft) en el diálogo Conectar. [Proveedores](#proveedores) explica cada uno. En un servidor autoalojado sin apps de un clic configuradas, **Conectar** abre este formulario directamente; consulta [Conectar con un clic en un servidor autoalojado](#conectar-con-un-clic-en-un-servidor-autoalojado) para configurarlas.

## Iniciar una llamada a mano

La tarjeta **Videollamada** de la página de un incidente o de una alerta tiene **Iniciar llamada** (o **Iniciar otra** cuando ya hay una). Elige una de las conexiones del proyecto, la huddle del canal de Slack del incidente, o pega un enlace de reunión propio. La llamada se publica en los canales y el feed del incidente igual que una que inicia una regla.

**Eliminar** en la tarjeta quita una llamada de la página del incidente. La reunión en sí no se elimina, y cualquiera que tenga el enlace puede seguir uniéndose.

Iniciar y quitar llamadas requiere permiso para trabajar en incidentes (o alertas): **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** o **Incident Member**, o **Create Incident Video Call** y **Delete Incident Video Call** en un rol personalizado. Todas las personas que pueden leer el incidente ven sus llamadas.

## Proveedores

Esta sección trata de conectar un proveedor con la identidad de servicio de tu propia app: una app Server-to-Server OAuth de Zoom, una cuenta de servicio de Google, un registro de aplicación de Microsoft Entra. Una identidad de servicio nunca depende de una persona, así que sigue funcionando se vaya quien se vaya. Para conectar iniciando sesión, consulta [Conectar con un clic](#conectar-con-un-clic).

Las credenciales se cifran en reposo y la API nunca las devuelve. Cuando editas una conexión, una credencial que dejas en blanco conserva la guardada.

**Iniciar reunión de prueba** en el formulario de conexión, y **Probar** en la fila de una conexión, crean una reunión real con los ajustes de la conexión y muestran su enlace. Es la única comprobación que demuestra que las credenciales, el permiso en el lado del proveedor y el anfitrión funcionan juntos. No se publica nada en ningún sitio.

Conectar un proveedor requiere **Project Owner**, **Project Admin** o **Settings Admin**, o **Create Video Call Connection** y **Edit Video Call Connection** en un rol personalizado.

### Zoom

OneUptime crea una reunión de Zoom para cada incidente mediante una app **Server-to-Server OAuth** de Zoom, con un usuario de Zoom con licencia que elijas como anfitrión.

:::steps
1. En el [Zoom App Marketplace](https://marketplace.zoom.us/), elige **Develop** > **Build App** y crea una app **Server-to-Server OAuth**. Crearla requiere un administrador de la cuenta de Zoom, o un rol que permita apps Server-to-Server OAuth.
2. En la página **Scopes** de la app, añade **meeting:write:meeting:admin** (crear una reunión para un usuario). Una app creada antes de los scopes granulares puede usar **meeting:write:admin** en su lugar.
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
2. En **API permissions**, añade el permiso de tipo **application** de Microsoft Graph **OnlineMeetings.ReadWrite.All** y haz clic en **Grant admin consent**.
3. En **Certificates & secrets**, crea un secreto de cliente y pega su **Value**, no su Secret ID, en el formulario de conexión como **Secreto del cliente**.
4. Elige el organizador: un usuario de Teams con licencia, idealmente una cuenta de servicio. Copia su **Object ID** desde **Users** en el centro de administración de Entra en **Organizer object ID**.
5. Permite que la app cree reuniones para el organizador con una directiva de acceso de aplicaciones. En Teams PowerShell, después de `Connect-MicrosoftTeams`, ejecuta los dos comandos siguientes.
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

La directiva puede tardar hasta 30 minutos en aplicarse. Hasta entonces, la prueba indica que la app no tiene permiso para crear reuniones para el organizador.

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

- **Zoom**: en el [Zoom App Marketplace](https://marketplace.zoom.us/), elige **Develop** > **Build App** y crea una **General App**, gestionada por los usuarios. En **Basic Information**, añade la URI de redirección como OAuth Redirect URL en las pestañas **Development** y **Production** y en la lista de permitidos de OAuth, y en la pestaña **Production** pon como URL del punto de conexión de **Deauthorization Notification** `https://<host>/api/video-call-oauth/zoom/events`. En **Scopes**, añade `meeting:write:meeting` y `user:read:user`. El **Secret Token** en **Features** > **Access** es `ZOOM_APP_WEBHOOK_SECRET_TOKEN`. Las credenciales de **Development** solo funcionan para los usuarios de tu propia cuenta de Zoom; las de **Production** funcionan para todos una vez que Zoom ha revisado y publicado la app.
- **Google Meet**: en la [consola de Google Cloud](https://console.cloud.google.com/), habilita la **Google Meet REST API**, configura la pantalla de consentimiento de OAuth (**Google Auth Platform**) con los scopes `openid`, `email` y `https://www.googleapis.com/auth/meetings.space.created`, y crea un cliente OAuth de tipo **Web application** con la URI de redirección. Publica la app en producción: una app que se queda en pruebas pierde sus inicios de sesión a los siete días. Google revisa las apps que piden el scope de Meet; hasta que lo haga, las personas ven una advertencia antes de iniciar sesión.
- **Microsoft Teams**: en el [centro de administración de Microsoft Entra](https://entra.microsoft.com/), registra una app para **Accounts in any organizational directory**, añade la URI de redirección como URI de redirección **Web**, añade los permisos delegados de Microsoft Graph `openid`, `profile`, `email`, `offline_access` y `OnlineMeetings.ReadWrite`, y crea un secreto de cliente. Usa un registro propio, no el del bot de Microsoft Teams (`MICROSOFT_TEAMS_APP_CLIENT_ID`). Hasta que la app tenga un editor verificado, la mayoría de las organizaciones necesitan que un administrador dé su consentimiento.

Los ID de cliente son públicos: se envían al panel para que sepa qué proveedores se conectan con un clic. Mantén en secreto los secretos y el token secreto del webhook. Cada día, el worker renueva los inicios de sesión a los que les toca, así que necesita los mismos valores que la app.

## Solución de problemas

:::details No se inició ninguna llamada para un incidente
Comprueba que la regla coincidió con el incidente (**Probar regla**), que su paso **Videollamada** está activado y que el incidente se declaró en curso: un incidente creado ya resuelto no recibe llamada. Una regla que ya inició una llamada para el incidente con esa conexión no inicia otra.
:::

:::details El feed dice que la llamada no pudo iniciarse
El proveedor la rechazó, y el feed da su motivo. Mientras tanto, inicia una llamada desde la página del incidente. Luego ejecuta **Probar** en la fila de la conexión: muestra el mismo motivo mientras corriges la configuración en el proveedor, como un secreto de cliente caducado o un permiso que falta.
:::

:::details Una conexión muestra Not working
Su inicio de sesión dejó de funcionar: la cuenta quitó OneUptime, se eliminó o se suspendió, o debe volver a iniciar sesión. Haz clic en **Reconnect** en su fila. Hasta entonces, las llamadas que debería iniciar no pueden iniciarse.
:::

:::details Las personas esperan en una sala de espera
Cambia **Who can join** (Google Meet) o **Who skips the lobby** (Microsoft Teams) con **Editar** en la fila de la conexión. En Zoom, asegúrate de que el ajuste **Waiting room** de la cuenta no esté bloqueado como activado.
:::

## Próximos pasos

:::cards
- [Slack](/docs/workspace-connections/slack): Las reglas que inician llamadas, y los canales en los que publican.
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Las mismas reglas y llamadas en Microsoft Teams.
- [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurar el bot de Teams en un servidor autoalojado.
- [Declarar un incidente](/docs/incidents/declaring-incidents): Lo que pasa cuando empieza un incidente.
:::
