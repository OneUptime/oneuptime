# Configuración SMTP

OneUptime admite el envío de correos electrónicos a través de servidores SMTP personalizados con tres métodos de autenticación:

- **Nombre de usuario y contraseña** - Autenticación SMTP tradicional
- **OAuth 2.0** - Autenticación moderna para Microsoft 365 y Google Workspace
- **Ninguna** - Para servidores de retransmisión que no requieren autenticación

Esta guía cubre cómo configurar la autenticación OAuth 2.0 para Microsoft 365 y Google Workspace.

## Autenticación OAuth 2.0

OAuth 2.0 proporciona una forma más segura de autenticarse con servidores de correo electrónico, especialmente para entornos empresariales que han deshabilitado la autenticación básica. OneUptime admite dos tipos de concesión OAuth:

- **Credenciales de cliente** - Utilizadas por Microsoft 365 y la mayoría de los proveedores OAuth
- **Portador JWT** - Utilizado por las cuentas de servicio de Google Workspace

### Campos requeridos para OAuth

Al configurar SMTP con autenticación OAuth en OneUptime, necesitarás:

| Campo                       | Descripción                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Nombre de host**          | Dirección del servidor SMTP                                                                               |
| **Puerto**                  | Puerto SMTP (generalmente 587 para STARTTLS o 465 para TLS implícito)                                     |
| **Nombre de usuario**       | La dirección de correo electrónico desde la que enviar                                                    |
| **Tipo de autenticación**   | Selecciona "OAuth"                                                                                        |
| **Tipo de proveedor OAuth** | Selecciona "Credenciales de cliente" para Microsoft 365 o "Portador JWT" para Google Workspace            |
| **ID de cliente**           | ID de aplicación/cliente de tu proveedor OAuth (para Google: correo electrónico de la cuenta de servicio) |
| **Secreto de cliente**      | Secreto de cliente de tu proveedor OAuth (para Google: clave privada)                                     |
| **URL del token**           | URL del punto de conexión del token OAuth                                                                 |
| **Ámbito**                  | Ámbitos OAuth requeridos para el acceso SMTP                                                              |

---

## Configuración de Microsoft 365

Para usar OAuth con Microsoft 365/Exchange Online, debes registrar una aplicación en Microsoft Entra (Azure AD) y configurar los permisos apropiados.

### Paso 1: Registrar una aplicación en Microsoft Entra

1. Inicia sesión en el [centro de administración de Microsoft Entra](https://entra.microsoft.com)
2. Navega a **Identidad** > **Aplicaciones** > **Registros de aplicaciones**
3. Haz clic en **Nuevo registro**
4. Ingresa un nombre para tu aplicación (por ejemplo, "OneUptime SMTP")
5. Para **Tipos de cuenta admitidos**, selecciona "Cuentas solo en este directorio organizacional"
6. Deja **URI de redirección** en blanco (no es necesario para el flujo de credenciales de cliente)
7. Haz clic en **Registrar**

Después del registro, anota los siguientes valores de la página de **Información general**:

- **ID de aplicación (cliente)** - Este es tu ID de cliente
- **ID de directorio (inquilino)** - Lo necesitarás para la URL del token

### Paso 2: Crear un secreto de cliente

1. En el registro de tu aplicación, ve a **Certificados y secretos**
2. Haz clic en **Nuevo secreto de cliente**
3. Agrega una descripción y selecciona un período de vencimiento
4. Haz clic en **Agregar**
5. **Copia el valor del secreto inmediatamente** - No se mostrará de nuevo

### Paso 3: Agregar permisos de la API SMTP

1. Ve a **Permisos de API**
2. Haz clic en **Agregar un permiso**
3. Selecciona **Las API que usa mi organización**
4. Busca y selecciona **Office 365 Exchange Online**
5. Selecciona **Permisos de aplicación**
6. Busca y marca **SMTP.SendAsApp**
7. Haz clic en **Agregar permisos**
8. Haz clic en **Conceder consentimiento de administrador para [tu organización]** (requiere privilegios de administrador)

### Paso 4: Registrar el principal de servicio en Exchange Online

Antes de que tu aplicación pueda enviar correos electrónicos, debes registrar el principal de servicio en Exchange Online y conceder permisos de buzón.

1. Instala el módulo de PowerShell de Exchange Online:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Conéctate a Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Registra el principal de servicio (usa el ID de objeto de **Aplicaciones empresariales**, no de Registros de aplicaciones):

```powershell
# Encuentra el ID de objeto en Microsoft Entra > Aplicaciones empresariales > Tu aplicación > ID de objeto
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Concede al principal de servicio permiso para enviar como un buzón específico:

```powershell
# Conceder acceso completo al buzón al principal de servicio
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **Nota:** Usa `Add-MailboxPermission` (no `Add-RecipientPermission`). `Add-RecipientPermission` solo concede `SendAs` al destinatario y no es suficiente para que el principal de servicio envíe correo a través de SMTP con OAuth: obtendrás un error de autenticación/permiso al enviar. `Add-MailboxPermission` con `FullAccess` es el comando que realmente funciona.

### Paso 5: Configurar en OneUptime

En OneUptime, crea o edita una configuración SMTP con estos valores:

| Campo                   | Valor                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Nombre de host          | `smtp.office365.com`                                                                       |
| Puerto                  | `587`                                                                                      |
| Nombre de usuario       | La dirección de correo a la que concediste permisos (por ejemplo, `sender@yourdomain.com`) |
| Tipo de autenticación   | `OAuth`                                                                                    |
| Tipo de proveedor OAuth | `Client Credentials`                                                                       |
| ID de cliente           | Tu ID de aplicación (cliente) del Paso 1                                                   |
| Secreto de cliente      | El valor del secreto del Paso 2                                                            |
| URL del token           | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`                          |
| Ámbito                  | `https://outlook.office365.com/.default`                                                   |
| Correo de origen        | Igual que el nombre de usuario                                                             |
| Seguro (TLS)            | Habilitado                                                                                 |

Reemplaza `<tenant-id>` con tu ID de directorio (inquilino) del Paso 1.

---

## Configuración de Google Workspace

Google Workspace requiere una **cuenta de servicio** con delegación de todo el dominio para enviar correos en nombre de los usuarios. Esto es necesario porque los servidores SMTP de Google no admiten el flujo directo de credenciales de cliente OAuth para Gmail.

### Prerrequisitos

- Cuenta de Google Workspace (no Gmail regular; las cuentas de consumidor de Gmail no admiten esto)
- Acceso de superadministrador a la Consola de administración de Google Workspace
- Acceso a Google Cloud Console

### Paso 1: Crear un proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Haz clic en el menú desplegable del proyecto y selecciona **Nuevo proyecto**
3. Ingresa un nombre de proyecto y haz clic en **Crear**
4. Selecciona tu nuevo proyecto

### Paso 2: Habilitar la API de Gmail

1. Ve a **API y servicios** > **Biblioteca**
2. Busca "Gmail API"
3. Haz clic en **Gmail API** y luego en **Habilitar**

### Paso 3: Crear una cuenta de servicio

1. Ve a **API y servicios** > **Credenciales**
2. Haz clic en **Crear credenciales** > **Cuenta de servicio**
3. Ingresa un nombre y una descripción para la cuenta de servicio
4. Haz clic en **Crear y continuar**
5. Omite los pasos opcionales y haz clic en **Listo**

### Paso 4: Crear claves de la cuenta de servicio

1. Haz clic en la cuenta de servicio que acabas de crear
2. Ve a la pestaña **Claves**
3. Haz clic en **Agregar clave** > **Crear nueva clave**
4. Selecciona **JSON** y haz clic en **Crear**
5. Guarda el archivo JSON descargado de forma segura; contiene:
   - `client_id` - Tu ID de cliente
   - `private_key` - Tu secreto de cliente (la clave privada)

### Paso 5: Habilitar la delegación de todo el dominio

1. En los detalles de la cuenta de servicio, haz clic en **Mostrar configuración avanzada**
2. Anota el **ID de cliente** (ID numérico)
3. Marca **Habilitar la delegación de dominio completo de Google Workspace**
4. Haz clic en **Guardar**

### Paso 6: Autorizar la cuenta de servicio en la Consola de administración de Google Workspace

1. Inicia sesión en la [Consola de administración de Google Workspace](https://admin.google.com)
2. Ve a **Seguridad** > **Control de acceso y datos** > **Controles de la API**
3. Haz clic en **Administrar la delegación en todo el dominio**
4. Haz clic en **Agregar nuevo**
5. Ingresa el **ID de cliente** del Paso 5
6. Para **Ámbitos de OAuth**, ingresa: `https://mail.google.com/`
7. Haz clic en **Autorizar**

Nota: La delegación puede tardar desde unos minutos hasta 24 horas en propagarse.

### Paso 7: Configurar en OneUptime

En OneUptime, crea o edita una configuración SMTP con estos valores:

| Campo                   | Valor                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombre de host          | `smtp.gmail.com`                                                                                                                                                      |
| Puerto                  | `587`                                                                                                                                                                 |
| Nombre de usuario       | La dirección de correo de Google Workspace desde la que enviar (por ejemplo, `notifications@yourdomain.com`). Este usuario será suplantado por la cuenta de servicio. |
| Tipo de autenticación   | `OAuth`                                                                                                                                                               |
| Tipo de proveedor OAuth | `JWT Bearer`                                                                                                                                                          |
| ID de cliente           | El `client_email` del JSON de tu cuenta de servicio (por ejemplo, `your-service@your-project.iam.gserviceaccount.com`)                                                |
| Secreto de cliente      | La `private_key` del JSON de tu cuenta de servicio (toda la clave, incluyendo `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`)                            |
| URL del token           | `https://oauth2.googleapis.com/token`                                                                                                                                 |
| Ámbito                  | `https://mail.google.com/`                                                                                                                                            |
| Correo de origen        | Igual que el nombre de usuario                                                                                                                                        |
| Seguro (TLS)            | Habilitado                                                                                                                                                            |

**Importante:** Para Google (Portador JWT), el ID de cliente es el **correo electrónico de la cuenta de servicio** (`client_email`), NO el `client_id` numérico. La cuenta de servicio suplantará al usuario especificado en el campo Nombre de usuario para enviar correos electrónicos.

---

## Solución de problemas

### Microsoft 365

| Problema                                        | Solución                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "Authentication unsuccessful"                   | Verifica que el principal de servicio esté registrado en Exchange y tenga permisos de buzón |
| "AADSTS700016: Application not found"           | Comprueba que el ID de cliente sea correcto y que la aplicación exista en tu inquilino      |
| "AADSTS7000215: Invalid client secret"          | Regenera el secreto de cliente; puede haber expirado                                        |
| "The mailbox is not enabled for this operation" | Ejecuta `Add-MailboxPermission` para conceder acceso al buzón                               |

### Google Workspace

| Problema                                            | Solución                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "invalid_grant"                                     | Asegúrate de que la delegación de dominio esté configurada correctamente y propagada              |
| "unauthorized_client"                               | Verifica que el ID de cliente esté autorizado en la Consola de administración de Google Workspace |
| "access_denied"                                     | Comprueba que el ámbito `https://mail.google.com/` esté autorizado                                |
| "Domain policy has disabled third-party Drive apps" | Habilita el acceso a la API en Google Workspace Admin > Seguridad > Controles de API              |

### General

- **Prueba tu configuración**: Usa el botón "Enviar correo de prueba" en OneUptime para verificar tu configuración
- **Revisa los registros**: Examina los registros de OneUptime para ver mensajes de error detallados
- **Almacenamiento en caché de tokens**: OneUptime almacena en caché los tokens OAuth y los renueva automáticamente antes de que expiren

---

## Buenas prácticas de seguridad

1. **Rota los secretos regularmente**: Configura recordatorios en el calendario para rotar los secretos de cliente antes de que expiren
2. **Usa cuentas de servicio dedicadas**: Crea credenciales separadas para OneUptime en lugar de compartirlas con otras aplicaciones
3. **Principio de mínimo privilegio**: Solo concede los permisos mínimos necesarios (SMTP.SendAsApp para Microsoft, ámbito mail.google.com para Google)
4. **Monitorea el uso**: Revisa los registros de correo y los inicios de sesión de la aplicación OAuth para detectar actividad inusual
5. **Almacenamiento seguro**: Nunca confirmes secretos de cliente en el control de versiones

---

## Recursos adicionales

### Microsoft 365

- [Autenticar una conexión IMAP, POP o SMTP usando OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Registrar una aplicación con la plataforma de identidad de Microsoft](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace

- [Uso de OAuth 2.0 para aplicaciones de servidor a servidor](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Documentación de la API de Gmail](https://developers.google.com/gmail/api)
- [Protocolo XOAUTH2](https://developers.google.com/gmail/imap/xoauth2-protocol)
