# Su cuenta

Tu cuenta es como OneUptime te conoce: el correo y la contraseña con los que inicias sesión, tu nombre y tu zona horaria, y lo que protege tu inicio de sesión. Una cuenta puede pertenecer a muchos proyectos, y estos ajustes te acompañan en cada uno de ellos. Cómo te localiza OneUptime, y cuándo te avisa, se configura en cada proyecto, en **Ajustes de usuario**.

```mermaid title="Lo que pertenece a tu cuenta, y lo que cada proyecto guarda para ti"
flowchart TB
    account["Tu cuenta:<br/>inicio de sesión y perfil"] --> projectA["Proyecto A"]
    account --> projectB["Proyecto B"]
    projectA --> settingsA["Ajustes de usuario en A:<br/>cómo te avisan"]
    projectB --> settingsB["Ajustes de usuario en B:<br/>cómo te avisan"]
```

:::cards
- [Tu perfil](#tu-perfil): Tu nombre, tu correo, tu zona horaria y tu foto.
- [Iniciar sesión de forma segura](#iniciar-sesión-de-forma-segura): Tu contraseña, tus llaves de acceso y la autenticación de dos factores.
- [Tus proyectos](#tus-proyectos): Cambiar de proyecto, crear uno y aceptar invitaciones.
- [Ajustes de usuario](#lo-que-cada-proyecto-guarda-para-ti): Cómo te localiza OneUptime en cada proyecto.
:::

## El menú de usuario

Haz clic en tu foto, arriba a la derecha del panel.

| Elemento | Qué hace |
| --- | --- |
| **Perfil** | Abre **Perfil de usuario**: tu nombre, tu correo, tu zona horaria, tu foto y la seguridad de tu inicio de sesión. |
| **Ajustes de admin** | Abre el Admin Dashboard. Solo lo ven los administradores principales de una instalación autoalojada. |
| **Tema oscuro** | Cambia el panel a su tema oscuro. Con el tema oscuro, el elemento dice **Tema claro**. |
| **Cerrar sesión** | Cierra tu sesión. |

**Perfil de usuario** tiene su propio menú lateral. **Básico** contiene **Vista general** y **Foto de perfil**. **Seguridad** y **Zona de peligro** están plegadas: haz clic en el título de una sección para abrirla.

## Tu perfil

:::steps
### Abrir tu perfil

Haz clic en tu foto, arriba a la derecha, y elige **Perfil**. La página **Vista general** se abre en la tarjeta **Información básica**: tu nombre, tu correo y tu zona horaria.

### Editar tus datos

Haz clic en **Editar Usuario** y cambia lo que necesites:

- **Correo electrónico**: la dirección con la que inicias sesión. Si la cambias, vuelves a verificar la nueva dirección.
- **Nombre completo**: el nombre que tu equipo ve en todo OneUptime.
- **Zona horaria**: la zona horaria en la que el panel muestra y lee las horas, y la de las horas de las notificaciones que se te envían.

Haz clic en **Guardar cambios**.

### Añadir una foto

Elige **Foto de perfil**, haz clic en **Actualizar foto de perfil** y sube una imagen. Aparece en tu menú de usuario, y junto a tu nombre en las listas de personas.
:::

> [!NOTE]
> La primera vez que inicias sesión en un navegador, OneUptime guarda la zona horaria de ese navegador en tu perfil. Si más tarde inicias sesión donde el navegador tiene otra zona horaria, el panel te pregunta si quieres **Actualizar zona horaria**. Cierra la pregunta, y no vuelve a preguntar por esa zona horaria.

## Iniciar sesión de forma segura

Despliega **Seguridad** en el menú lateral de **Perfil de usuario**. Tiene tres páginas.

| Página | Para qué sirve |
| --- | --- |
| **Gestión de contraseñas** | Establecer una contraseña nueva. |
| **Llaves de acceso** | Iniciar sesión sin contraseña, con tu huella, tu cara, el bloqueo de pantalla o una llave de seguridad. |
| **Autenticación de dos factores** | Pedir un segundo paso después de tu contraseña: un código de una aplicación, o una llave de seguridad. |

### Cambiar tu contraseña

:::steps
1. Abre **Seguridad → Gestión de contraseñas**.
2. Escribe la contraseña nueva en **Contraseña** y otra vez en **Confirmar contraseña**. Debe tener al menos 6 caracteres.
3. Haz clic en **Actualizar contraseña**.
:::

### Añadir una llave de acceso

:::steps
1. Abre **Seguridad → Llaves de acceso** y haz clic en **Añadir llave de acceso**.
2. Ponle un nombre que reconozcas, como tu dispositivo o tu gestor de contraseñas, y haz clic en **Crear llave de acceso**.
3. Sigue el aviso de tu navegador para guardar la llave de acceso.
:::

La próxima vez, elige **Iniciar sesión con una clave de acceso** en la página de inicio de sesión.

### Activar la autenticación de dos factores

La autenticación de dos factores se aplica cuando inicias sesión con tu contraseña. Añade primero un segundo paso y luego actívala.

:::steps
### Añadir una aplicación de autenticación

Abre **Seguridad → Autenticación de dos factores**. En **Aplicaciones de autenticación**, añade una aplicación y ponle un nombre. Escanea el código QR con una aplicación como 1Password, Google Authenticator o Microsoft Authenticator, escribe el código de 6 dígitos que muestra y haz clic en **Verificar y terminar**. Para usar una llave USB o NFC en su lugar, añádela en **Llaves de seguridad**.

### Guardar tus códigos de respaldo

La primera vez que añades una aplicación, una llave o una llave de acceso, OneUptime muestra **Tus códigos de respaldo**. Cada código te permite iniciar sesión una vez si pierdes tu aplicación o tu llave. Cópialos o descárgalos, marca la casilla que confirma que los has guardado y haz clic en **Hecho**.

### Activarla

Arriba en la página, haz clic en **Habilitar la autenticación de dos factores** y confirma. La tarjeta muestra ahora **Habilitado**. Desde tu próximo inicio de sesión con contraseña, OneUptime te pide tu segundo paso.
:::

> [!TIP]
> ¿Te quedan pocos códigos de respaldo? **Regenerar códigos** en la misma página te da un juego nuevo, y los códigos anteriores dejan de funcionar al instante.

## Tus proyectos

Puedes pertenecer a tantos proyectos como quieras. El selector de proyectos, arriba a la izquierda del panel, los lista: elige uno para cambiar a él.

- **Crear un proyecto**: abre el selector de proyectos y haz clic en **Crear nuevo proyecto**. En una instalación autoalojada, el administrador puede reservar la creación de proyectos a los administradores.
- **Aceptar una invitación**: cuando alguien te invita, la campana de arriba a la derecha muestra la invitación pendiente y abre **Invitaciones del proyecto**. Ahí puedes elegir **Aceptar** o **Rechazar**.
- **Salir de un proyecto**: pide a alguien que gestione sus usuarios que te quite, con **Eliminar del proyecto** en su página **Usuarios**.

## Lo que cada proyecto guarda para ti

Los **Ajustes de usuario**, a la derecha de la barra bajo la barra superior, son solo tuyos, y cada proyecto tiene los suyos. Ábrelos en cada proyecto en el que estés de guardia.

| Página | Para qué sirve | Más información |
| --- | --- | --- |
| **Lista de configuración** | Te guía por todo lo que sigue y muestra lo que queda por hacer. | |
| **Métodos de notificación** | Los correos, números de teléfono, aplicaciones y webhooks por los que OneUptime puede localizarte. Tu correo de inicio de sesión se añade por ti. | |
| **Reglas de guardia** | Qué método usar, y al cabo de cuánto tiempo, cuando una política de guardia te avisa. | [Reglas de escalado](/docs/on-call/escalation-rules) |
| **Ajustes de notificaciones** | Qué novedades recibes sobre incidentes, alertas, monitores y más, y por qué canal. | |
| **Preferencias de correo** | Cuántos correos recibes: uno a uno, o agrupados. | [Resumen de notificaciones](/docs/emails/notification-rollup) |
| **Registros de guardia** | Cada aviso que se te envió, y qué pasó con él. | |
| **Números de teléfono entrantes** | El número al que te llama una política de llamadas entrantes. | [Política de llamadas entrantes](/docs/on-call/incoming-call-policy) |
| **Feed de calendario** | Tus turnos de guardia en Google Calendar, Apple Calendar u Outlook. | [Feeds de calendario](/docs/on-call/calendar-feeds) |

## Idioma y tema

Ambos se guardan en tu navegador, no en tu cuenta, así que vuelve a configurarlos en otro navegador o dispositivo.

- **Idioma**: el panel empieza en el idioma de tu navegador. Para cambiarlo, usa el menú de idiomas al pie de cualquier página. Esta documentación tiene su propio menú de idiomas, arriba.
- **Tema**: elige **Tema oscuro** en el menú de usuario. El panel empieza con el tema claro.

## Eliminar tu cuenta

Abre **Zona de peligro → Eliminar cuenta**. Solo puedes eliminar tu cuenta cuando ya no estás en ningún proyecto: la página lista los proyectos en los que sigues. Sal de ellos primero, luego haz clic en **Eliminar cuenta** y confirma. Eliminar tu cuenta es permanente y no se puede deshacer.

## Solución de problemas

:::details No recibí el correo para verificar mi dirección
Volver a iniciar sesión envía un enlace nuevo: revisa también tu carpeta de spam. Si no puedes iniciar sesión, usa **¿Olvidó su contraseña?** en la página de inicio de sesión. Su enlace de restablecimiento también verifica tu dirección.
:::

:::details Perdí mi aplicación de autenticación
En el segundo paso del inicio de sesión, elige **¿Perdió el acceso a su aplicación de autenticación?** y escribe uno de tus códigos de respaldo. Luego abre **Seguridad → Autenticación de dos factores** y añade tu aplicación nueva. Sin códigos de respaldo, pide a un administrador de tu instalación de OneUptime que restablezca la autenticación de dos factores de tu cuenta.
:::

:::details Las horas del panel tienen una hora de diferencia
El panel muestra las horas en la **Zona horaria** de tu perfil, no en la de tu ordenador. Revísala en **Perfil de usuario → Vista general**.
:::

## Próximos pasos

:::cards
- [Página de inicio y atajos](/docs/introduction/home): Orientarte en el panel.
- [Reglas de escalado](/docs/on-call/escalation-rules): Cómo te avisa una política de guardia.
- [Usuarios, equipos y permisos](/docs/permissions/index): Qué decide lo que puedes hacer en un proyecto.
- [SSO](/docs/identity/sso): Iniciar sesión a través del proveedor de identidad de tu empresa.
:::
