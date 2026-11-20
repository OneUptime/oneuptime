# Su cuenta

Tu cuenta es como OneUptime te conoce: el correo y la contraseña con los que inicias sesión, tu nombre, tu zona horaria y tu idioma, y lo que protege tu inicio de sesión. Una cuenta puede pertenecer a muchos proyectos, y estos ajustes te acompañan en cada uno de ellos. Cómo te localiza OneUptime, y cuándo te avisa, se configura en cada proyecto, en **Ajustes de usuario**.

```mermaid title="Lo que pertenece a tu cuenta, y lo que cada proyecto guarda para ti"
flowchart TB
    account["Tu cuenta:<br/>inicio de sesión y perfil"] --> projectA["Proyecto A"]
    account --> projectB["Proyecto B"]
    projectA --> settingsA["Ajustes de usuario en A:<br/>cómo te avisan"]
    projectB --> settingsB["Ajustes de usuario en B:<br/>cómo te avisan"]
```

:::cards
- [Tu perfil](#tu-perfil): Tu nombre, tu correo, tu zona horaria, tu idioma y tu foto.
- [Iniciar sesión de forma segura](#iniciar-sesión-de-forma-segura): Tu contraseña, los enlaces de inicio de sesión, tus llaves de acceso y la autenticación de dos factores.
- [Tus proyectos](#tus-proyectos): Cambiar de proyecto, crear uno y aceptar invitaciones.
- [Ajustes de usuario](#lo-que-cada-proyecto-guarda-para-ti): Cómo te localiza OneUptime en cada proyecto.
:::

## El menú de usuario

Haz clic en tu foto, arriba a la derecha del panel.

| Elemento | Qué hace |
| --- | --- |
| **Perfil** | Abre **Perfil de usuario**: tu nombre, tu correo, tu zona horaria, tu idioma, tu foto y la seguridad de tu inicio de sesión. |
| **Ajustes de admin** | Abre el Admin Dashboard. Solo lo ven los administradores principales de una instalación autoalojada. |
| **Tema** | Define el tema del panel: **Claro**, **Oscuro** o **Sistema**, que es claro u oscuro según cómo esté configurado tu dispositivo. |
| **Cerrar sesión** | Cierra tu sesión, al instante en cada servidor de OneUptime. Donde tu administrador lo ha configurado, también cierra tu sesión en tu proveedor de identidad. |

**Perfil de usuario** tiene su propio menú lateral. **Básico** contiene **Vista general** y **Foto de perfil**. **Seguridad** y **Zona de peligro** están plegadas: haz clic en el título de una sección para abrirla.

## Tu perfil

:::steps
### Abrir tu perfil

Haz clic en tu foto, arriba a la derecha, y elige **Perfil**. La página **Vista general** se abre en la tarjeta **Información básica**: tu nombre, tu correo, tu zona horaria y tu idioma.

### Editar tus datos

Haz clic en **Editar Usuario** y cambia lo que necesites:

- **Correo electrónico**: la dirección con la que inicias sesión. Si la cambias, OneUptime envía un enlace a la nueva dirección, y tu dirección cambia cuando lo abres. Hasta entonces inicias sesión con la actual, y **Cancelar cambio** detiene el cambio. La dirección propia de un administrador principal cambia de inmediato. Si el enlace caduca, **Volver a enviar el enlace** envía uno nuevo. Cada vez que cambia tu dirección, OneUptime envía un correo a la dirección que tenías.
- **Nombre completo**: el nombre que tu equipo ve en todo OneUptime.
- **Zona horaria**: la zona horaria en la que el panel muestra y lee las horas, y la de las horas de las notificaciones que se te envían.
- **Idioma**: el idioma del panel en cada navegador en el que inicies sesión, y el de tus avisos de guardia. Sin definir, tus avisos están en inglés y el panel sigue a tu navegador.

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
| **Autenticación de dos factores** | Pedir un segundo paso después de tu contraseña o de un enlace enviado por correo: un código de una aplicación, o una llave de seguridad. |

### Cambiar tu contraseña

:::steps
1. Abre **Seguridad → Gestión de contraseñas**.
2. Escribe la contraseña nueva en **Nueva contraseña** y otra vez en **Confirmar contraseña**. Debe tener al menos 15 caracteres y no ser predecible, como una contraseña común o un patrón repetido: unas cuantas palabras sin relación entre sí funcionan bien. La lista de comprobación bajo el campo marca cada requisito mientras escribes.
3. Haz clic en **Actualizar contraseña**.
:::

Una contraseña nueva cierra la sesión de tu cuenta en todos los dispositivos, y cualquier enlace de restablecimiento o de inicio de sesión ya enviado deja de funcionar.

Todas las páginas que definen una contraseña piden lo mismo: el registro, el enlace de restablecimiento de **¿Olvidó su contraseña?**, esta página y **Definir contraseña** de un administrador del servidor. Una contraseña que definiste antes de esta regla sigue funcionando hasta que la cambies.

### Añadir una llave de acceso

:::steps
1. Abre **Seguridad → Llaves de acceso** y haz clic en **Añadir llave de acceso**.
2. Ponle un nombre que reconozcas, como tu dispositivo o tu gestor de contraseñas, y haz clic en **Crear llave de acceso**.
3. Sigue el aviso de tu navegador para guardar la llave de acceso.
:::

La próxima vez, elige **Más formas de iniciar sesión** → **Iniciar sesión con una clave de acceso** en la página de inicio de sesión.

### Iniciar sesión con un enlace enviado por correo

Puedes iniciar sesión con un enlace en lugar de tu contraseña. No hay nada que configurar.

:::steps
1. En la página de inicio de sesión, elige **Más formas de iniciar sesión** → **Enviarme un enlace de inicio de sesión**.
2. Escribe tu dirección de correo electrónico y haz clic en **Enviarme un enlace de inicio de sesión**. La página muestra entonces **Revise su correo electrónico**.
3. Abre el enlace del correo y haz clic en **Iniciar sesión**.
:::

El enlace funciona una sola vez, durante 15 minutos, y un enlace más reciente lo sustituye. Puedes abrirlo en otro dispositivo, y la sesión se inicia allí. Si usas la autenticación de dos factores, OneUptime sigue pidiéndote tu segundo paso.

> [!NOTE]
> Los administradores principales de una instalación autoalojada pueden desactivar los enlaces de inicio de sesión con **Permitir iniciar sesión con un enlace enviado por correo**, en **Admin Dashboard > Ajustes > Autenticación**. Los enlaces ya enviados dejan entonces de funcionar. Mientras el servidor exija SSO, la página de inicio de sesión solo ofrece SSO.

### Activar la autenticación de dos factores

La autenticación de dos factores se aplica cuando inicias sesión con tu contraseña o con un enlace enviado por correo. Solo se activa cuando tu segundo paso funciona, así que nunca te pide un paso que no tienes.

:::steps
### Elegir tu segundo paso

Abre **Seguridad → Autenticación de dos factores** y haz clic en **Habilitar la autenticación de dos factores**. Elige **Aplicación de autenticación** o **Llave de seguridad** y haz clic en **Continuar**.

### Configurarlo

Para una aplicación de autenticación, escanea el código QR con una aplicación como 1Password, Google Authenticator o Microsoft Authenticator, introduce el código de 6 dígitos que muestra y haz clic en **Verificar y terminar**. Para una llave USB o NFC, ponle un nombre y sigue las indicaciones de tu navegador. La autenticación de dos factores queda entonces activada y la tarjeta muestra **Habilitado**. Desde tu próximo inicio de sesión con contraseña o con un enlace enviado por correo, OneUptime te pide tu segundo paso.

### Guardar tus códigos de respaldo

La primera vez que añades una aplicación, una llave o una llave de acceso, OneUptime muestra **Tus códigos de respaldo**. Cada código te permite iniciar sesión una vez si pierdes tu aplicación o tu llave. Cópialos o descárgalos, marca la casilla que confirma que los has guardado y haz clic en **Hecho**.
:::

Si ya tienes una aplicación en **Aplicaciones de autenticación** o una llave en **Llaves de seguridad**, **Habilitar la autenticación de dos factores** solo te pide que lo confirmes. Mientras está activada, no se puede quitar tu última aplicación, llave o llave de acceso: añade otra primero o desactiva la autenticación de dos factores. Si la tarjeta muestra **Configuración pendiente**, la autenticación de dos factores está activada sin nada configurado, a menudo porque un administrador la exigió: haz clic en **Terminar la configuración**, o se te pedirá que la configures en tu próximo inicio de sesión.

### Configurar la autenticación de dos factores al iniciar sesión

Cuando un administrador exige la autenticación de dos factores y aún no tienes nada configurado, tu próximo inicio de sesión con una contraseña o un enlace enviado por correo te pide que la configures antes de dejarte entrar. Elige **Aplicación de autenticación** o **Llave de seguridad** y haz clic en **Continuar**:

- **Aplicación de autenticación**: escanea el código QR, introduce el código de 6 dígitos que muestra tu aplicación y haz clic en **Verificar e iniciar sesión**.
- **Llave de seguridad**: haz clic en **Registrar llave de seguridad** y sigue las indicaciones de tu navegador. Toca una llave USB o NFC, o usa la huella dactilar, el rostro o el bloqueo de pantalla de tu teléfono o tu ordenador.

Si aún no tienes códigos de respaldo, OneUptime te los muestra entonces una sola vez, y ya has iniciado sesión. **Elegir otro método** vuelve a la elección. Un navegador que no puede registrar una llave de seguridad, como uno en una página sin HTTPS, solo ofrece la aplicación de autenticación.

> [!TIP]
> ¿Te quedan pocos códigos de respaldo? **Regenerar códigos** en la misma página te da un juego nuevo, y los códigos anteriores dejan de funcionar al instante.

### Cuando tu organización gestiona tu inicio de sesión

En un servidor que exige el inicio de sesión único, solo inicias sesión a través del proveedor de identidad de tu organización, como Okta o Microsoft Entra ID, y OneUptime no configura para ti ninguna contraseña, llave de acceso ni autenticación de dos factores. El **Perfil de usuario** no tiene entonces la sección **Seguridad**, y su **Vista general** indica tu proveedor en **Inicio de sesión único**. Cambia tu contraseña y tu segundo paso con tu proveedor de identidad. Lo que configuraste antes sigue guardado: solo vuelve a funcionar si el servidor deja de exigir el inicio de sesión único, salvo que un administrador del servidor lo borre, y en ese caso recibes un correo. Los administradores principales conservan sus propios ajustes de **Seguridad**.

Lo mismo ocurre cuando todos los proyectos a los que perteneces exigen el inicio de sesión único y tienen activado **Gestionar el inicio de sesión con SSO**. Tu contraseña sigue iniciando tu sesión en OneUptime, pero cada proyecto pide SSO, así que OneUptime no configura para ti ninguna contraseña, llave de acceso ni segundo paso nuevos:

- **Un proyecto que no lo hace**: en cuanto eres miembro de un proyecto, o te invitan a uno, que no exige SSO o no tiene activado **Gestionar el inicio de sesión con SSO**, tu sección **Seguridad** vuelve. **Vista general** nombra entonces esos proyectos en **Inicio de sesión único**, como el motivo de que tus ajustes sean tuyos. Salir de ese proyecto te los vuelve a quitar.
- **Proyectos con proveedores distintos**: si todos tus proyectos gestionan el inicio de sesión, cada uno con su propio proveedor de identidad, **Vista general** nombra cada proveedor.
- **Los administradores principales** conservan siempre sus propios ajustes de **Seguridad**.
- **Lo que configuraste antes** sigue guardado. Un administrador del servidor puede borrarlo, y también un propietario de todos los proyectos a los que perteneces; recibes un correo cuando lo hacen.

### Confirmar que eres tú

Algunos cambios te piden primero confirmar que eres tú, aunque hayas iniciado sesión, para que nadie pueda hacerlos desde un navegador en el que dejaste la sesión iniciada. OneUptime te lo pide antes de que:

- cambies tu dirección de correo o tu contraseña;
- añadas o quites una llave de acceso, una llave de seguridad o una aplicación de autenticación;
- obtengas códigos de respaldo nuevos mientras aún tengas algunos sin usar;
- desactives la autenticación de dos factores;
- elimines tu cuenta.

El cuadro **Confirma que eres tú** te pide tu contraseña y, mientras la autenticación de dos factores esté activada, tu segundo paso: un código de tu aplicación de autenticación, tu llave de seguridad o uno de tus códigos de respaldo. Con una llave de acceso, haz clic en **Usar una llave de acceso** en su lugar. Si solo inicias sesión con el inicio de sesión único, Google o Microsoft, haz clic en **Volver a iniciar sesión**: OneUptime hace que tu proveedor de identidad te pida iniciar sesión de nuevo y luego te devuelve a la página. Después, el cambio se aplica. Si solo inicias sesión con Vercel, que no puede confirmar que eres tú, elige en su lugar **Iniciar sesión de otra forma** e inicia sesión con un enlace que te enviamos por correo electrónico.

Una vez que lo confirmas, no se te vuelve a preguntar durante 10 minutos en ese navegador. Cinco intentos fallidos cierran la sesión de ese navegador, pero nunca bloquean tu cuenta: vuelve a iniciar sesión e inténtalo otra vez. OneUptime te envía un correo cuando esto ocurre, y cada vez que un código de respaldo confirma que eres tú.

En un servidor autoalojado, los administradores principales confirman del mismo modo que son ellos antes de cambiar cómo inicia sesión otra persona, eliminar la cuenta de otra persona, hacer a alguien administrador principal, cambiar los proveedores de inicio de sesión único o los ajustes de correo del servidor, o crear una clave API maestra o volver a activarla. La clave API maestra no puede hacer estos cambios.

Volver a iniciar sesión solo cuenta cuando tu proveedor de identidad indica que iniciaste sesión después de que OneUptime te enviara a él. Si el proveedor te inicia sesión con una sesión que ya tenía, sin pedirte la contraseña, eso no confirma nada: cierra primero la sesión en el proveedor y luego haz clic en **Volver a iniciar sesión**. Donde tu servidor permita iniciar sesión con un enlace enviado por correo, **Iniciar sesión de otra forma** hace eso en su lugar. Lo que OneUptime pide a cada proveedor, y lo que un administrador puede cambiar cuando volver a iniciar sesión no confirma nada:

| Proveedor | Lo que OneUptime pide | Cuando no confirma nada |
| --- | --- | --- |
| SAML | `ForceAuthn="true"` y el momento en que iniciaste sesión (`AuthnInstant`) | Haz que el proveedor respete la solicitud, por ejemplo con Honor Force Authentication en Okta. |
| OpenID Connect | `prompt=login` y `max_age=0`, y el momento en que iniciaste sesión (`auth_time`) | Haz que el proveedor envíe `auth_time`. En Microsoft Entra ID, añádelo al token de ID como notificación opcional. |
| Google | El momento en que iniciaste sesión (`auth_time`). A Google no se le puede pedir que te haga iniciar sesión de nuevo. | Activa Session age claims para la aplicación de inicio de sesión de Google del servidor, que debe estar publicada y verificada. |
| Microsoft | `prompt=login` y `max_age=0`, y el momento en que iniciaste sesión (`auth_time`) | Añade `auth_time` al token de ID de la aplicación de inicio de sesión de Microsoft del servidor como notificación opcional. |
| Vercel | Nada: no se le puede pedir a Vercel que te haga iniciar sesión de nuevo, y no indica cuándo iniciaste sesión. | Nunca confirma. Elige **Iniciar sesión de otra forma** e inicia sesión con un enlace que te enviamos por correo electrónico, o crea una contraseña con **¿Olvidó su contraseña?** y confirma con ella. |

Qué configurar en Okta, Microsoft Entra ID, Keycloak y Google Workspace se explica en la página [SSO](/docs/identity/sso#volver-a-iniciar-sesión-para-confirmar-que-eres-tú).

## Tus proyectos

Puedes pertenecer a tantos proyectos como quieras. El selector de proyectos, arriba a la izquierda del panel, los lista: elige uno para cambiar a él.

- **Crear un proyecto**: abre el selector de proyectos y haz clic en **Crear nuevo proyecto**. En una instalación autoalojada, el administrador puede reservar la creación de proyectos a los administradores.
- **Aceptar una invitación**: cuando alguien te invita, la campana de arriba a la derecha muestra la invitación pendiente y abre **Invitaciones del proyecto**. Ahí puedes elegir **Aceptar** o **Rechazar**.
- **Salir de un proyecto**: pide a alguien que gestione sus usuarios que te quite, con **Eliminar del proyecto** en su página **Usuarios**.

## Lo que cada proyecto guarda para ti

Los **Ajustes de usuario**, a la derecha de la barra bajo la barra superior, son solo tuyos, y cada proyecto tiene los suyos. Ábrelos en cada proyecto en el que estés de guardia. Se abren en **Lista de configuración** mientras quede algo por configurar, y en **Métodos de notificación** cuando ya no queda nada esencial.

| Página | Para qué sirve | Más información |
| --- | --- | --- |
| **Lista de configuración** | Te guía por todo lo que sigue y muestra lo que queda por hacer. | |
| **Métodos de notificación** | Los correos, números de teléfono, aplicaciones y webhooks por los que OneUptime puede localizarte. Tu correo de inicio de sesión se añade por ti. | |
| **Cómo contactarme** | Qué método usar, y al cabo de cuánto tiempo, cuando una política de guardia te avisa. | [Reglas de escalado](/docs/on-call/escalation-rules) |
| **Ajustes de notificaciones** | Qué novedades recibes sobre incidentes, alertas, monitores y más, y por qué canal. | |
| **Preferencias de correo** | Cuántos correos recibes: uno a uno, o agrupados. | [Resumen de notificaciones](/docs/emails/notification-rollup) |
| **Registros de guardia** | Cada aviso que se te envió, y qué pasó con él. | |
| **Números de teléfono entrantes** | El número al que te llama una política de llamadas entrantes. | [Política de llamadas entrantes](/docs/on-call/incoming-call-policy) |
| **Feed de calendario** | Tus turnos de guardia en Google Calendar, Apple Calendar u Outlook. | [Feeds de calendario](/docs/on-call/calendar-feeds) |

## Idioma y tema

Tu tema se guarda en tu navegador, así que vuelve a configurarlo en otro navegador o dispositivo. Tu idioma se guarda en tu cuenta en cuanto lo eliges, y cada navegador en el que inicias sesión empieza en él. Se conservan al cerrar sesión, así que en un ordenador compartido la siguiente persona empieza con los tuyos.

- **Idioma**: el panel empieza en el idioma de tu navegador. Para cambiarlo, usa el menú de idiomas al pie de cualquier página. Tu elección se guarda en tu cuenta, como **Idioma** en tu perfil, y OneUptime escribe tus avisos de guardia en él. Consulta [El idioma de tus avisos](/docs/notifications/index#el-idioma-de-tus-avisos). Esta documentación tiene su propio menú de idiomas, arriba.
- **Tema**: elige **Claro**, **Oscuro** o **Sistema** en el menú de usuario. **Sistema** es claro u oscuro según cómo esté configurado tu dispositivo, y cambia con él; todos los navegadores empiezan con él. Las páginas de inicio de sesión usan el mismo tema.

## Eliminar tu cuenta

Abre **Zona de peligro → Eliminar cuenta**. Solo puedes eliminar tu cuenta cuando ya no estás en ningún proyecto: la página lista los proyectos en los que sigues. Sal de ellos primero, luego haz clic en **Eliminar cuenta** y confirma. Eliminar tu cuenta es permanente y no se puede deshacer. Antes de eliminar tu cuenta, OneUptime te pide confirmar que eres tú.

## Solución de problemas

:::details No recibí el correo para verificar mi dirección
Volver a iniciar sesión envía un enlace nuevo: revisa también tu carpeta de spam. Si no puedes iniciar sesión, usa **¿Olvidó su contraseña?** en la página de inicio de sesión. Su enlace de restablecimiento también verifica tu dirección.
:::

:::details Al registrarme recibí un correo que dice que ya tengo una cuenta
Esa dirección ya tiene una cuenta de OneUptime, así que el registro no creó ni cambió nada. Inicia sesión con ella, o usa **¿Olvidó su contraseña?** en la página de inicio de sesión si no recuerdas tu contraseña. La página de registro dice lo mismo para cualquier dirección, así que no le dice a nadie qué direcciones tienen una cuenta.
:::

:::details Mi dirección de correo electrónico no ha cambiado
Tu dirección cambia solo cuando abres el enlace que OneUptime envió a la nueva dirección. El enlace funciona durante 24 horas: cuando caduca, tu perfil lo indica, y **Volver a enviar el enlace** envía uno nuevo. Si otra cuenta ya usa esa dirección, el correo enviado allí lo dice, y tu dirección se queda como está.
:::

:::details Recibí un correo que dice que se cambió mi dirección de correo electrónico
OneUptime envía un correo a la dirección que tenía tu cuenta cada vez que esa dirección cambia: cuando abres el enlace enviado a una dirección nueva, cuando un administrador del servidor la cambia o cuando la cambia el proveedor de identidad de tu organización. Si hiciste tú el cambio, no tienes que hacer nada. Si no, alguien que podía iniciar sesión en tu cuenta la cambió a una dirección propia: desde tu dirección anterior, ponte en contacto con el administrador de tu servidor o, en OneUptime Cloud, con support@oneuptime.com, que pueden devolverla. El correo muestra solo una parte de la nueva dirección y no trae ningún enlace para deshacer el cambio: un enlace así funcionaría para cualquiera que lea tu buzón anterior.
:::

:::details Perdí mi aplicación de autenticación
En el segundo paso del inicio de sesión, elige **¿Perdió el acceso a su aplicación de autenticación?** y escribe uno de tus códigos de respaldo. Luego abre **Seguridad → Autenticación de dos factores** y añade tu aplicación nueva. Sin códigos de respaldo, pide a un administrador de tu instalación de OneUptime que restablezca la autenticación de dos factores de tu cuenta.
:::

:::details Al iniciar sesión me pide esperar antes de probar otro código
Después de cinco códigos incorrectos seguidos, cada código siguiente espera antes de comprobarse: un minuto, luego dos, luego cuatro, y así sucesivamente, hasta una hora. OneUptime cuenta los códigos incorrectos de tu cuenta desde dondequiera que se escriban, te envía un correo cuando empiezan las esperas y vuelve a contar desde cero cuando aciertas un código. Espera e inténtalo de nuevo, inicia sesión con una llave de seguridad o elige **¿Perdió el acceso a su aplicación de autenticación?** y escribe un código de respaldo. Si no escribiste esos códigos, alguien conoce tu contraseña o puede leer tu correo, y el correo que te envió OneUptime indica cuál de las dos cosas. Si esa persona puede leer tu correo, primero cambia la contraseña de tu cuenta de correo y elimina cualquier reenvío que no hayas configurado: una nueva contraseña de OneUptime no le impide por sí sola pedir otro enlace de inicio de sesión. Después restablece tu contraseña con **¿Olvidó su contraseña?** en la página de inicio de sesión, lo que termina la espera y anula cualquier enlace de inicio de sesión ya enviado.
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
