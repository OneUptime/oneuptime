# Google Workspace

Importa los registros de auditoría de [Google Workspace](https://workspace.google.com) en los eventos de seguridad de OneUptime: los inicios de sesión y lo que Google detectó en ellos, los cambios de los administradores, las aplicaciones a las que se dio acceso a datos, el inicio de sesión único, los ajustes de seguridad propios de las cuentas y, si quieres, los archivos compartidos fuera de la organización o descargados en Google Drive. Allí los buscas junto a tus logs, trazas y métricas, los correlacionas con todas las demás fuentes y avisas a la guardia de los que importan. OneUptime los lee con una cuenta de servicio que actúa como uno de tus administradores, y no cambia nada en Google Workspace.

:::cards
- [Configurar la conexión](#configurar-la-conexión): Una cuenta de servicio, la delegación de todo el dominio y el formulario de la conexión.
- [Qué se importa](#qué-se-importa): Qué actividades, y cómo cada una se convierte en un evento de seguridad.
- [Cómo funciona el sondeo](#cómo-funciona-el-sondeo): La ventana que lee cada sondeo, y por qué se solapa 2 horas con la anterior.
- [Solución de problemas](#solución-de-problemas): Qué significa cada error y qué cambiar.
:::

## Cómo funciona

```mermaid title="De una actividad de Google Workspace a un evento de seguridad"
flowchart TB
    gws["Google Workspace<br/>registra una<br/>actividad"] --> poll["OneUptime sondea<br/>en el intervalo de<br/>la conexión"]
    poll --> token["Su cuenta de servicio<br/>actúa como tu<br/>administrador"]
    token --> list["Lista las actividades<br/>de cada registro<br/>desde la última vez"]
    list --> event["Cada uno se guarda<br/>como evento OCSF<br/>de su tipo"]
```

Cada minuto, OneUptime sondea cada conexión habilitada cuyo intervalo de sondeo ha pasado. Un sondeo inicia sesión como tu cuenta de servicio en nombre del administrador que indicas, y lista las actividades de cada registro de auditoría desde el último sondeo ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): administración, inicios de sesión, tokens de OAuth, SAML, seguridad de las cuentas y, cuando la opción **Actividad de Drive** está activada, Drive. Cada evento de una actividad se guarda como un evento [OCSF](https://schema.ocsf.io/): un inicio de sesión como un evento Authentication, un rol de administrador asignado como un evento User Access Management, un inicio de sesión que Google marcó como un Detection Finding.

## Antes de empezar

- En OneUptime, el rol Project Owner, Project Admin o Security Admin. Los roles Security Member y Security Viewer pueden ver las conexiones y su historial de ejecuciones, pero no cambiarlas.
- Un superadministrador de Google Workspace, para permitir la delegación de todo el dominio, y un administrador como el que actúa la cuenta de servicio, con el privilegio Reports. Un superadministrador lo tiene.
- Un proyecto de Google Cloud en el que puedas crear una cuenta de servicio y activar la Admin SDK API.
- Para la actividad de Drive, una edición con el registro de auditoría de Drive, como Business Standard, Business Plus, Enterprise o Education.
- HTTPS saliente desde la aplicación y los workers de OneUptime hacia `oauth2.googleapis.com` y `admin.googleapis.com`.

## Configurar la conexión

La conexión inicia sesión con la clave de una cuenta de servicio y la [delegación de todo el dominio](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority), con un único ámbito de solo lectura: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Crear una cuenta de servicio y una clave

1. En la [consola de Google Cloud](https://console.cloud.google.com), elige un proyecto, abre **APIs & Services → Library**, busca **Admin SDK API** y selecciona **Enable**.
2. Abre **IAM & Admin → Service accounts → Create service account**, llámala `oneuptime-security-events` y selecciona **Done**. No necesita ningún rol en el proyecto.
3. Abre la cuenta de servicio y copia su **Unique ID**, el ID de cliente que nombra la delegación. En la pestaña **Keys**, selecciona **Add key → Create new key → JSON**, y guarda el archivo: es la clave.

### Permitir la delegación de todo el dominio

1. En la [consola de administración de Google](https://admin.google.com), como superadministrador, abre **Security → Access and data control → API controls → Manage domain-wide delegation** y selecciona **Add new**.
2. Introduce el **Unique ID** de la cuenta de servicio como **Client ID**, y `https://www.googleapis.com/auth/admin.reports.audit.readonly` como **OAuth scope**. Selecciona **Authorize**. Google puede tardar unos minutos en aplicarlo.
3. Para que los playbooks puedan suspender, reactivar y cerrar la sesión de usuarios (consulta [Contención](/docs/telemetry/security-cases#contención)), añade `https://www.googleapis.com/auth/admin.directory.user` y `https://www.googleapis.com/auth/admin.directory.user.security` a los ámbitos del mismo cliente, separados por comas. El administrador como el que actúa la conexión debe entonces gestionar a esos usuarios.

### Añadir la conexión en OneUptime

Abre **Productos → Eventos de seguridad → Conexiones** (`/dashboard/{projectId}/security-events/connections`), haz clic en **Añadir conexión**, elige **Google Workspace** en **Identidad** y haz clic en **Siguiente**. Introduce el **Administrator email**, haz clic en **Siguiente** y pega el contenido del archivo de clave en **JSON de la cuenta de servicio**. En el paso **Sondeo**, activa **Actividad de Drive** para leer también Drive.

### Probarla antes de guardar

Haz clic en **Probar esta configuración** en **Probar antes de guardar**. La prueba inicia sesión y lee los registros de inicio de sesión y de administración con los valores del formulario, y no guarda nada, así que una delegación que falta aparece antes de que exista la conexión. Luego haz clic en **Siguiente**, da a la conexión un **Nombre** y créala.
:::

| Ajuste | Qué introducir |
| --- | --- |
| **Administrator email** | La dirección del administrador como el que actúa la cuenta de servicio, como `admin@example.com`. Debe tener el privilegio Reports. |
| **Actividad de Drive** | Opcional, desactivado por defecto. Activado, cada sondeo lee también lo que se comparte y se descarga en Drive. |
| **JSON de la cuenta de servicio** | El archivo de clave entero, que contiene `client_email` y `private_key`. Se cifra, la API nunca lo devuelve y no se vuelve a mostrar. Sustitúyelo con **Actualizar credenciales** en la conexión. |

El paso **Sondeo** también tiene una **Descripción** opcional, el **Intervalo de sondeo (minutos)**, un número entero de `1` a `1440` que empieza en `5`, y **Habilitado**, que empieza activado.

## Qué se importa

Cada evento tiene el proveedor `Google` y el producto `Google Workspace`. Una actividad que contiene varios eventos se convierte en un evento de seguridad por cada uno, y cada evento conserva los campos de la actividad y los suyos, como `event.name`, `event.type` y `parameters.<name>`, para que una regla los lea con los nombres de Google.

| Registro | Eventos | Clase OCSF | Gravedad |
| --- | --- | --- | --- |
| Inicios de sesión (`login`) | `login_success`, `login_failure` con su motivo, `login_challenge`. Un cierre de sesión se lee pero no se importa. | Authentication (`3002`) | Informational; Low para un fallo; Medium cuando Google lo marca como `is_suspicious` |
| Detecciones de Google (`login`) | `suspicious_login` y sus variantes, `gov_attack_warning`, `account_disabled_hijacked` y las demás cuentas que Google inhabilitó | Detection Finding (`2004`) | Medium; High para un ataque respaldado por un gobierno, una cuenta secuestrada o una contraseña filtrada |
| Administración (`admin`) | Privilegios y roles de administrador concedidos o retirados, delegación de todo el dominio, usuarios creados, eliminados o suspendidos, verificación en dos pasos desactivada, miembros de grupos, ajustes | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium para un poder concedido; Low para un usuario eliminado o una verificación en dos pasos desactivada |
| Tokens de OAuth (`token`) | Una aplicación a la que se dio acceso a los datos de alguien, con sus ámbitos, o a la que se le retiró ese acceso | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Un inicio de sesión único en una aplicación | Authentication (`3002`) | Low para un fallo |
| Seguridad de las cuentas (`user_accounts`) | Cambios en la verificación en dos pasos, la contraseña y la recuperación | Account Change (`3001`) | Low cuando debilita la cuenta |
| Drive (`drive`), con la opción activada | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low para un archivo compartido fuera del dominio de su propietario o abierto a un enlace |

Las reglas de la biblioteca para Google Workspace los leen tal como se importan aquí, como las de un inicio de sesión que Google marcó, privilegios de administrador concedidos y un archivo hecho público en Drive.

## Cómo funciona el sondeo

- **Las actividades se leen según cuándo ocurrieron.** La Reports API no tiene otra hora por la que listarlas, y Google documenta que sus registros llegan con minutos u horas de retraso.
- **El primer sondeo mira 24 horas atrás**, para que una conexión nueva muestre enseguida sus actividades recientes.
- **Cada sondeo posterior empieza 120 minutos antes del cursor guardado**, así que una actividad que Google hace legible hasta con 2 horas de retraso se lee en el siguiente sondeo, y los duplicados se descartan por el ID de cada evento dentro del proyecto. Una que llega más tarde no la lee el sondeo: importa su intervalo de tiempo desde **Diagnósticos**.
- **Un sondeo lee como mucho 24 horas más allá del cursor.** Una conexión cuyo cursor se quedó atrás se pone al día en una serie de ventanas de 24 horas.
- **Drive se lee un evento cada vez**, ya que Drive registra cada archivo que alguien abre. Cuando Google rechaza el registro de Drive, la ejecución avisa, y los demás registros se siguen importando.
- **Una ejecución fallida no cambia nada.** Tras un error de red, o un estado de error de Google, el cursor y la longitud de ventana se quedan como estaban, y el siguiente sondeo vuelve a leer la misma ventana. La única excepción es una solicitud que agotó el tiempo: el cursor se queda, pero la siguiente ventana es la mitad de larga, porque una ventana demasiado pesada para responder a tiempo agotaría el tiempo en cada intento.

### Cuando una ventana contiene más de lo que un sondeo puede leer

Cada registro tiene su propio presupuesto, en páginas de 1.000 actividades: 10 para los inicios de sesión, 5 para cada uno de administración, tokens de OAuth y SAML, 3 para la seguridad de las cuentas, y 4 para cada evento de Drive. Un sondeo se detiene tras 4 minutos. Cuando un presupuesto detiene un registro antes del final de su ventana, la ejecución es **Parcial**, y su aviso nombra el registro y el presupuesto. Google lista primero las actividades más recientes, así que OneUptime acorta la ventana en lugar de mover el cursor más allá de actividades a las que nunca llegó:

1. **Reducir.** El siguiente sondeo lee una ventana de la mitad de largo, desde el mismo punto de partida, y sigue reduciéndola a la mitad hasta que una ventana se lee entera, hasta un minuto. El aviso de la ejecución lo dice: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Las actividades ya importadas de la ventana más larga se omiten como duplicados.
2. **Volver a crecer.** Cuando una ventana se lee entera, el cursor pasa a su final, y la siguiente ventana vuelve a ser el doble de larga, hasta 24 horas.
3. **Pasar más allá de un único minuto.** Si incluso un minuto contiene más de lo que un sondeo puede leer, el sondeo lo pasa de largo, para que sigan llegando las actividades más nuevas. La ejecución sigue siendo **Parcial**, y **Último error** indica `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importa ese minuto con **Importar este intervalo de tiempo** para recuperar lo que una ejecución puede leer.

Cambiar el **Intervalo de sondeo (minutos)** no cambia nada de esto: decide cada cuánto empieza un sondeo, no dónde empieza su ventana.

### Ejecutar, previsualizar e importar a demanda

Haz clic en **Diagnósticos** en una conexión para ver sus ejecuciones recientes y trabajar con ella a mano. Quien puede cambiar la conexión puede iniciar estas acciones; quien puede verla puede leer el historial.

- **Ejecutar ahora** inicia un sondeo de inmediato, con el cursor habitual, incluso cuando la conexión no está **Habilitado**.
- **Preview audit events** lee un intervalo de tiempo de hasta 7 días y no importa nada.
- **Importar este intervalo de tiempo** importa un intervalo de hasta 7 días, después de que lo confirmes, sin mover el cursor. Las actividades ya importadas se omiten. Google conserva 6 meses de registros de auditoría.
- **Copiar diagnósticos** en una ejecución copia su informe para soporte. Nunca incluye credenciales.

## Probar conexión

**Probar conexión** en la fila de una conexión, y **Probar esta configuración** en el formulario, se ejecutan en el proceso de la API, no en un worker en segundo plano, para que una prueba responda incluso cuando el problema son los workers. Hace estas comprobaciones, en orden:

| Comprobación | Qué comprueba |
| --- | --- |
| **Configuración** | La dirección del administrador y la clave están bien formadas. No se contacta con nada cuando esto falla. |
| **Authenticate with Google** | Google deja que la cuenta de servicio actúe como el administrador: la delegación de todo el dominio está configurada. |
| **Read the audit logs** | Se pueden leer los registros de inicio de sesión y de administración de las últimas 24 horas. |
| **Read Drive activity** | Solo con la opción activada: se puede leer el registro de Drive. |
| **Activities available to import** | Cuántas actividades de inicio de sesión y de administración hay en las últimas 24 horas, como mucho 1.000 de cada una, así que `1000+` significa más. Ninguna es un aviso. |
| **Background workers**, **Poll scheduler**, **Security event storage** | El lado del propio OneUptime: un proceso toma los trabajos de la cola Worker, el trabajo de sondeo se ejecuta cada minuto y el almacén de eventos de seguridad responde. |
| **Sondeo programado** | Para una conexión guardada: el sondeo está activado, ninguna ejecución está atascada esperando a un worker y los sondeos se ejecutan a tiempo. |

Cada solicitud de una prueba tiene un plazo de 20 segundos. Una prueba nunca importa nada ni mueve el cursor, y cada comprobación que falla dice qué cambiar.

## Solución de problemas

El **Último error** de la conexión guarda el mensaje de error completo, con las credenciales ocultas. Cuando una conexión tiene un error, selecciona **Ver error** en su columna **Acciones** para leerlo, y **Copiar error** en el cuadro de diálogo para copiarlo. Cada mensaje empieza por `Google Workspace`, nombra después la solicitud que falló y cita el motivo que dio Google.

:::details Último error dice `token request failed`
- `unauthorized_client`: la cuenta de servicio no tiene delegación de todo el dominio para el ámbito. Añade su **Unique ID** con `https://www.googleapis.com/auth/admin.reports.audit.readonly` en **Manage domain-wide delegation**.
- `invalid_grant` con `Invalid email or User ID`: el **Administrator email** no es un usuario de este Google Workspace.
- `invalid_grant` con `Invalid JWT Signature`: la clave se eliminó o se desactivó. Crea una clave nueva y guárdala con **Actualizar credenciales**.
:::

:::details Último error dice `activities request failed (HTTP 403)`
- Motivo `SERVICE_DISABLED` o `accessNotConfigured`: la Admin SDK API está desactivada en el proyecto de la cuenta de servicio. Actívala y vuelve a probar en unos minutos.
- Motivo `forbidden`: al administrador le falta el privilegio Reports. Asígnalo en **Account → Admin roles** en la consola de administración de Google, o indica un superadministrador.
:::

:::details La actividad de Drive no se lee
El registro de Drive necesita una edición que lo tenga, y un administrador con el privilegio Reports. Cada ejecución avisa `Drive activity was not read`, y los demás registros se siguen importando. Desactiva **Actividad de Drive** cuando tu edición no tenga registro de Drive.
:::

:::details Último error dice `did not complete`
La solicitud no obtuvo respuesta: un tiempo agotado, un nombre que no se resuelve o una dirección rechazada. Comprueba que la aplicación y los workers de OneUptime pueden llegar a `oauth2.googleapis.com` y `admin.googleapis.com`, a través de cualquier proxy que uses.
:::

:::details La prueba pasa, pero Último sondeo indica Never
El trabajo de sondeo nunca se ha ejecutado. Lee las comprobaciones **Background workers** y **Poll scheduler**. En una instalación autoalojada, la causa habitual es `DISABLE_QUEUE_WORKERS=true` en la aplicación, sin un despliegue de workers aparte que tome los trabajos: ponlo en `false`, o ejecuta el despliegue de workers (Helm: `worker.enabled: true`, que es `false` por defecto).
:::

## Próximos pasos

:::cards
- [Eventos de seguridad](/docs/telemetry/security-events): Busca, correlaciona y alerta sobre lo que importas.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Importa los inicios de sesión y los cambios de directorio de Microsoft.
- [Google SecOps](/docs/integrations/google-secops): Trae también las detecciones de Google SecOps.
- [Descripción general de integraciones](/docs/integrations/index): Las otras herramientas que puedes conectar.
:::
