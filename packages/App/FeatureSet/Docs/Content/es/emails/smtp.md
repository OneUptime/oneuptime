# SMTP

Envía el correo de OneUptime a través de tu propio servidor de correo. Un proyecto añade configuraciones SMTP con las que sus páginas de estado envían su correo, y una instalación autoalojada define el servidor desde el que OneUptime envía todo lo demás. Ambos admiten tres formas de iniciar sesión:

- **Nombre de usuario y contraseña**: la autenticación SMTP tradicional.
- **OAuth 2.0**: para Microsoft 365 y Google Workspace, donde la autenticación básica suele estar desactivada.
- **Ninguno**: para servidores de retransmisión que no exigen autenticación.

```mermaid title="Qué servidor de correo envía qué"
flowchart TB
    SP["Correo de una página de estado"] --> Q{"¿Configuración SMTP personalizada<br/>elegida para la página?"}
    Q -->|"Sí"| P["La configuración SMTP<br/>del proyecto"]
    Q -->|"No"| D["El servidor de correo<br/>de OneUptime"]
    E["Todo el demás correo<br/>de OneUptime"] --> D
```

En una instalación autoalojada, el servidor de correo de OneUptime es el que se define en el Admin Dashboard. Una página de estado elige su configuración SMTP en su página **Ajustes de suscriptores**, en la tarjeta **SMTP personalizado**.

:::cards
- [Añadir un servidor de correo](#añadir-un-servidor-smtp): Dos pasos, con todo lo demás plegado.
- [Microsoft 365](#configuración-de-microsoft-365): OAuth con un registro de aplicación en Entra.
- [Google Workspace](#configuración-de-google-workspace): OAuth con una cuenta de servicio.
- [Solución de problemas](#solución-de-problemas): Errores habituales y qué significan.
:::

## Añadir un servidor SMTP

Añade el servidor de correo de un proyecto en **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**, en la tarjeta **Configuraciones de SMTP personalizado**. En una instalación autoalojada, el servidor desde el que envía el propio OneUptime se define en **Admin Dashboard > Ajustes > Notificaciones > Correos**, en la tarjeta **Ajustes personalizados de correo y SMTP**. Ambos formularios piden lo mismo, en dos pasos.

:::steps
### Abrir el formulario

:::tabs
@tab Proyecto
En **Ajustes del proyecto > Notificaciones > Ajustes de notificaciones**, haz clic en **Crear Configuración SMTP** en la tarjeta **Configuraciones de SMTP personalizado**.
@tab Instancia autoalojada
En el Admin Dashboard, abre **Ajustes** y luego **Notificaciones > Correos** en el menú lateral (**Notificaciones** empieza plegado). En la tarjeta **Ajustes del servidor de correo**, haz clic en **Editar servidor** y establece **Tipo de servidor de correo electrónico** en `Custom SMTP`. Después haz clic en **Editar config SMTP** en la tarjeta **Ajustes personalizados de correo y SMTP**, que aparece debajo.
:::

### Rellenar el paso Servidor

En el paso **Servidor**, introduce el **Nombre** (solo configuraciones de proyecto), el **Nombre de host**, el **Puerto** (una configuración de proyecto nueva empieza en `587`), el **Nombre de usuario** y la **Contraseña**.

### Revisar Más campos

Todo lo demás está plegado en **Más campos**, al final del paso **Servidor**. Mientras está plegado, su encabezado dice cómo se envía el correo, por ejemplo «El correo se envía por SMTP, iniciando sesión con el nombre de usuario y la contraseña. TLS es obligatorio.» Ábrelo solo si necesitas cambiar alguno de los ajustes de la tabla de abajo.

### Rellenar el paso Remitente

En el paso **Remitente**, introduce el **Correo del remitente** y el **Nombre de origen** de los que proceden tus correos. Tu servidor debe permitir enviar desde esa dirección.

### Guardar y enviar un correo de prueba

Guarda la configuración. Una vez guardada una configuración de proyecto, **Enviar correo de prueba** en su fila comprueba que funciona. Necesita permiso para añadir configuraciones SMTP: **Project Owner**, **Project Admin**, o **Create SMTP Config** y **Read SMTP Config** en un rol personalizado. En OneUptime Cloud también necesita el plan **Growth**, como añadir una configuración. Para cualquier otra persona aparece bloqueado, y su descripción emergente dice qué hace falta.

La prueba pide una dirección de **Correo electrónico** a la que enviar, la tuya para empezar. Comprueba que el mensaje llega.
:::

Estos son los ajustes de **Más campos**:

| Campo | Qué hace |
| --- | --- |
| **Transporte** | `SMTP` (el predeterminado), o `Microsoft Graph` para un inquilino de Microsoft 365 que tiene SMTP AUTH desactivado. Elegir Microsoft Graph oculta el nombre de host, el puerto, el nombre de usuario y la contraseña, y muestra los campos de OAuth. |
| **Exigir TLS** | Activado en una configuración de proyecto nueva. El correo solo se envía por una conexión cifrada con un certificado válido. Si esta opción está desactivada, el correo solo se cifra si el servidor lo ofrece y el certificado no se comprueba. El puerto 465 siempre está cifrado. |
| **Tipo de autenticación** | `Username and Password` (el predeterminado), `OAuth`, o `None` para un relay que no necesita iniciar sesión. |
| **Campos de OAuth** | **Tipo de proveedor de OAuth**, **ID de cliente de OAuth**, **Secreto de cliente de OAuth**, **URL del token de OAuth** y **Ámbito de OAuth**, que aparecen al elegir OAuth o Microsoft Graph. |
| **Descripción** | Una nota para tu equipo (solo configuraciones de proyecto). |

**Microsoft Graph.** Abre **Más campos**, establece **Transporte** en `Microsoft Graph` y rellena los datos de una aplicación de Azure que tenga el permiso de aplicación **Mail.Send**: su ID de cliente y su secreto de cliente, la URL del token `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` y el ámbito `https://graph.microsoft.com/.default`. El correo se envía desde el buzón del **Correo del remitente**, que debe ser un buzón con licencia de tu inquilino.

> [!NOTE]
> En OneUptime Cloud, el servidor de correo de un proyecto debe ser accesible desde Internet: se rechaza un host que se resuelve en una dirección privada o interna. En una instalación autoalojada, las direcciones privadas se permiten salvo que `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` sea `true`; las direcciones de loopback y link-local se rechazan siempre. El servidor de correo propio de la instancia no se comprueba de esta forma.

## Autenticación con OAuth 2.0

OAuth 2.0 permite a OneUptime iniciar sesión en tu servidor de correo sin contraseña, algo que los servicios de correo empresariales exigen cada vez más. OneUptime admite dos tipos de concesión de OAuth:

- **Client Credentials**: lo usan Microsoft 365 y la mayoría de proveedores de OAuth.
- **JWT Bearer**: lo usan las cuentas de servicio de Google Workspace.

```mermaid title="Cómo inicia sesión OneUptime con OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as URL del token
    participant M as Servidor de correo
    O->>T: Solicitar un token de acceso
    T-->>O: Token de acceso
    Note over O: En caché, y renovado<br/>antes de que caduque
    O->>M: Iniciar sesión con el token
    O->>M: Enviar el correo
```

**Tipo de autenticación** y los campos de OAuth están en **Más campos**, en el paso Servidor del formulario. Para iniciar sesión con OAuth, rellena:

| Campo | Descripción |
| --- | --- |
| **Nombre de host** | Dirección del servidor SMTP |
| **Puerto** | Puerto SMTP (normalmente 587 para STARTTLS o 465 para TLS implícito) |
| **Nombre de usuario** | La dirección de correo del buzón que envía |
| **Tipo de autenticación** | `OAuth` |
| **Tipo de proveedor de OAuth** | `Client Credentials` para Microsoft 365, o `JWT Bearer` para Google Workspace |
| **ID de cliente de OAuth** | ID de aplicación (cliente) de tu proveedor de OAuth (en Google: el correo de la cuenta de servicio) |
| **Secreto de cliente de OAuth** | Secreto de cliente de tu proveedor de OAuth (en Google: la clave privada) |
| **URL del token de OAuth** | El endpoint de tokens de OAuth de tu proveedor |
| **Ámbito de OAuth** | El ámbito de OAuth que concede acceso SMTP |

OneUptime guarda en caché los tokens de OAuth y los renueva automáticamente antes de que caduquen.

## Configuración de Microsoft 365

Para usar OAuth con Microsoft 365 (Exchange Online), registra una aplicación en Microsoft Entra, dale permiso para enviar correo por SMTP y permítele usar el buzón desde el que envías.

:::steps
### Registrar una aplicación en Microsoft Entra

1. Inicia sesión en el [centro de administración de Microsoft Entra](https://entra.microsoft.com).
2. Ve a **Identity** > **Applications** > **App registrations** y haz clic en **New registration**.
3. Escribe un nombre (por ejemplo, «OneUptime SMTP»), selecciona «Accounts in this organizational directory only» y deja **Redirect URI** en blanco.
4. Haz clic en **Register**.

En la página **Overview**, anota el **Application (client) ID** (tu ID de cliente) y el **Directory (tenant) ID** (para la URL del token).

### Crear un secreto de cliente

1. En el registro de tu aplicación, ve a **Certificates & secrets** y haz clic en **New client secret**.
2. Añade una descripción, elige un periodo de caducidad y haz clic en **Add**.
3. **Copia el valor del secreto de inmediato**: no se vuelve a mostrar.

### Añadir el permiso SMTP

1. Ve a **API permissions** y haz clic en **Add a permission**.
2. Selecciona **APIs my organization uses** y luego busca y selecciona **Office 365 Exchange Online**.
3. Selecciona **Application permissions**, marca **SMTP.SendAsApp** y haz clic en **Add permissions**.
4. Haz clic en **Grant admin consent for [your organization]** (requiere privilegios de administrador).

### Registrar la entidad de servicio en Exchange Online

Antes de que la aplicación pueda enviar correo, registra su entidad de servicio en Exchange Online y dale acceso al buzón desde el que envías:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Usa `Add-MailboxPermission`, no `Add-RecipientPermission`. `Add-RecipientPermission` solo concede `SendAs` sobre el destinatario, lo que no basta para que la entidad de servicio envíe correo por SMTP con OAuth: el envío falla con un error de autenticación o de permisos.

### Crear la configuración SMTP en OneUptime

Crea o edita una configuración SMTP con estos ajustes, sustituyendo `<tenant-id>` por tu **Directory (tenant) ID**:

| Campo | Valor |
| --- | --- |
| Nombre de host | `smtp.office365.com` |
| Puerto | `587` |
| Nombre de usuario | La dirección de correo a la que concediste los permisos (p. ej., `sender@yourdomain.com`) |
| Tipo de autenticación | `OAuth` |
| Tipo de proveedor de OAuth | `Client Credentials` |
| ID de cliente de OAuth | Tu **Application (client) ID** |
| Secreto de cliente de OAuth | El valor del secreto de cliente |
| URL del token de OAuth | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Ámbito de OAuth | `https://outlook.office365.com/.default` |
| Correo del remitente | El mismo que el nombre de usuario |
| Exigir TLS | Activado |

Después usa **Enviar correo de prueba** para comprobarla.
:::

## Configuración de Google Workspace

Google Workspace necesita una **cuenta de servicio** con delegación en todo el dominio, que envía correo en nombre de un usuario de tu dominio. Los servidores SMTP de Google no admiten un flujo simple de client credentials para Gmail.

### Antes de empezar con Google Workspace

- Una cuenta de Google Workspace. Las cuentas personales de Gmail no lo admiten.
- Acceso de superadministrador a la consola de administración de Google Workspace.
- Acceso a la Google Cloud Console.

:::steps
### Crear un proyecto de Google Cloud

1. Ve a la [Google Cloud Console](https://console.cloud.google.com).
2. Haz clic en el selector de proyectos y elige **New Project**.
3. Escribe un nombre de proyecto, haz clic en **Create** y selecciona tu proyecto nuevo.

### Habilitar la API de Gmail

1. Ve a **APIs & Services** > **Library**.
2. Busca «Gmail API», haz clic en **Gmail API** y luego en **Enable**.

### Crear una cuenta de servicio

1. Ve a **APIs & Services** > **Credentials**.
2. Haz clic en **Create Credentials** > **Service account**.
3. Escribe un nombre y una descripción, haz clic en **Create and Continue**, omite los pasos opcionales y haz clic en **Done**.

### Crear una clave de la cuenta de servicio

1. Haz clic en la cuenta de servicio que acabas de crear y ve a la pestaña **Keys**.
2. Haz clic en **Add Key** > **Create new key**, selecciona **JSON** y haz clic en **Create**.
3. Guarda el archivo JSON descargado en un lugar seguro. Su `client_email` es tu ID de cliente de OAuth, y su `private_key`, tu secreto de cliente de OAuth.

### Habilitar la delegación en todo el dominio

1. En los detalles de la cuenta de servicio, haz clic en **Show Advanced Settings**.
2. Anota el **Client ID** numérico.
3. Marca **Enable Google Workspace Domain-wide Delegation** y haz clic en **Save**.

### Autorizar la cuenta de servicio en la administración de Google Workspace

1. Inicia sesión en la [consola de administración de Google Workspace](https://admin.google.com).
2. Ve a **Security** > **Access and data control** > **API Controls** y haz clic en **Manage Domain Wide Delegation**.
3. Haz clic en **Add new**, introduce el **Client ID** numérico del paso anterior y, en **OAuth Scopes**, escribe `https://mail.google.com/`.
4. Haz clic en **Authorize**.

La delegación puede tardar desde unos minutos hasta 24 horas en surtir efecto.

### Crear la configuración SMTP para Google Workspace

Crea o edita una configuración SMTP con estos ajustes:

| Campo | Valor |
| --- | --- |
| Nombre de host | `smtp.gmail.com` |
| Puerto | `587` |
| Nombre de usuario | La dirección de correo de Google Workspace desde la que se envía (p. ej., `notifications@yourdomain.com`). La cuenta de servicio actúa en nombre de este usuario. |
| Tipo de autenticación | `OAuth` |
| Tipo de proveedor de OAuth | `JWT Bearer` |
| ID de cliente de OAuth | El `client_email` del JSON de tu cuenta de servicio (p. ej., `your-service@your-project.iam.gserviceaccount.com`) |
| Secreto de cliente de OAuth | La `private_key` del JSON de tu cuenta de servicio (la clave completa, incluidos `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`) |
| URL del token de OAuth | `https://oauth2.googleapis.com/token` |
| Ámbito de OAuth | `https://mail.google.com/` |
| Correo del remitente | El mismo que el nombre de usuario |
| Exigir TLS | Activado |

Después usa **Enviar correo de prueba** para comprobarla.
:::

> [!IMPORTANT]
> En Google (JWT Bearer), el **ID de cliente de OAuth** es el **correo de la cuenta de servicio** (`client_email`), no el `client_id` numérico. La cuenta de servicio actúa en nombre del usuario indicado en **Nombre de usuario** para enviar correo.

## Solución de problemas

### Errores de Microsoft 365

| Problema | Solución |
| --- | --- |
| "Authentication unsuccessful" | Comprueba que la entidad de servicio está registrada en Exchange y tiene permisos sobre el buzón |
| "AADSTS700016: Application not found" | Comprueba que el ID de cliente es correcto y que la aplicación existe en tu inquilino |
| "AADSTS7000215: Invalid client secret" | Crea un secreto de cliente nuevo: puede que el anterior haya caducado |
| "The mailbox is not enabled for this operation" | Ejecuta `Add-MailboxPermission` para conceder acceso al buzón |

### Errores de Google Workspace

| Problema | Solución |
| --- | --- |
| "invalid_grant" | Asegúrate de que la delegación en todo el dominio está bien configurada y se ha propagado |
| "unauthorized_client" | Comprueba que el ID de cliente está autorizado en la consola de administración de Google Workspace |
| "access_denied" | Comprueba que el ámbito `https://mail.google.com/` está autorizado |
| "Domain policy has disabled third-party Drive apps" | Habilita el acceso a las API en la administración de Google Workspace, en Security > API Controls |

### Otros problemas

:::details "Cannot send email. Please check your SMTP config."
**Enviar correo de prueba** muestra esto cuando un servidor en el que se inicia sesión con nombre de usuario y contraseña, o sin iniciar sesión, no acepta el correo. Comprueba el **Nombre de host**, el **Puerto**, el **Nombre de usuario** y la **Contraseña**. Si tu servidor no ofrece TLS, o su certificado no es válido para su nombre de host, desactiva **Exigir TLS** en **Más campos** y vuelve a intentarlo. La respuesta del propio servidor se guarda con la prueba: abre la pestaña **Correo electrónico** de **Ajustes del proyecto > Notificaciones > Registros de notificación** y selecciona **Ver mensaje de estado** en su fila.
:::

:::details "Cannot send email with OAuth authentication"
El inicio de sesión con OAuth falló, y el mensaje termina con el error que devolvió tu proveedor. Comprueba el **ID de cliente de OAuth**, el **Secreto de cliente de OAuth**, la **URL del token de OAuth** y el **Ámbito de OAuth**, que la aplicación tiene los permisos indicados arriba y que se concedió el consentimiento de administrador. Si tu inquilino de Microsoft 365 tiene SMTP AUTH desactivado, establece **Transporte** en `Microsoft Graph`.
:::

:::details "Microsoft Graph send failed"
Una configuración cuyo **Transporte** es `Microsoft Graph` muestra esto cuando Graph no acepta el correo, seguido del error de Microsoft. Comprueba que la aplicación tiene el permiso de aplicación **Mail.Send** con el consentimiento de administrador concedido, que el **Ámbito de OAuth** es `https://graph.microsoft.com/.default` y que el **Correo del remitente** es un buzón con licencia de tu inquilino.
:::

:::details "SMTP server host … could not be reached"
OneUptime se negó a conectarse al servidor de correo del proyecto. En OneUptime Cloud, un nombre de host que no se resuelve, o que se resuelve en una dirección privada, de loopback o link-local, se rechaza con este mensaje, que nunca dice cuál de esos casos es: usa el nombre de host público del servidor de correo. En una instalación autoalojada, y para un servidor de correo indicado con su dirección IP, el mensaje dice el motivo. **Enviar correo de prueba** solo lo muestra en una configuración de OAuth; en las demás, encuéntralo con **Ver mensaje de estado** en la pestaña **Correo electrónico** de los registros de notificación.
:::

:::details El correo de prueba no llega
Comprueba el **Correo del remitente**: tu servidor debe permitir enviar desde él. Luego mira la carpeta de spam del destinatario y los registros de tu servidor de correo en busca del intento.
:::

## Buenas prácticas de seguridad

- **Rota los secretos con regularidad.** Programa recordatorios para sustituir los secretos de cliente antes de que caduquen.
- **Usa credenciales dedicadas.** Crea credenciales propias para OneUptime en lugar de compartirlas con otras aplicaciones.
- **Concede el mínimo privilegio.** Concede solo lo que necesita el envío: **SMTP.SendAsApp** en Microsoft, el ámbito `https://mail.google.com/` en Google.
- **Supervisa el uso.** Revisa los registros de correo y los inicios de sesión de las aplicaciones OAuth en busca de actividad inusual.
- **Guarda los secretos de forma segura.** Nunca subas secretos de cliente al control de versiones.

## Más información

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Próximos pasos

:::cards
- [Resumen de notificaciones](/docs/emails/notification-rollup): Cómo agrupa OneUptime las ráfagas de correo a los propietarios.
- [Suscriptores y anuncios](/docs/status-pages/subscribers): Enviar el correo a los suscriptores de una página de estado con una configuración SMTP del proyecto.
:::
