# Ayuda y soporte

Dirige la ayuda que ofrece OneUptime a tu propio equipo: la dirección de soporte, el chat y la página de ayuda que ve la gente, adónde va **Dar tu opinión**, lo que el inicio de sesión único le dice a quien necesita una invitación, y las sugerencias para obtener la app móvil. Cada uno puede quedarse con el de OneUptime, apuntar a una dirección o un enlace tuyos, u ocultarse.

:::cards
- [Cambiar adónde lleva la ayuda](#cambiar-adónde-lleva-la-ayuda): Una sola página en el Admin Dashboard.
- [Qué cambia cada ajuste](#qué-cambia-cada-ajuste): Cada lugar, su valor predeterminado y sus opciones.
- [Dar tu opinión](#dar-tu-opinión): Adónde se envía lo que escribe la gente.
- [El mensaje de inicio de sesión](#el-mensaje-de-inicio-de-sesión): A quién pedir una invitación.
- [Definir los ajustes desde tu configuración](#definir-los-ajustes-desde-tu-configuración): Valores de Helm o `config.env`, para un servidor nuevo.
:::

## Cambiar adónde lleva la ayuda

:::steps
### Abrir Ayuda y soporte
En el Admin Dashboard, abre **Ajustes** y luego **Ayuda y soporte** en el menú lateral.

### Cambiar un lugar
Selecciona **Cambiar** a su lado, elige **Predeterminado**, una dirección o un enlace propios, u **Ocultarlo**, y luego selecciona **Guardar**. **Solicitar demo** y **Reportar un error o solicitar una función** son interruptores que se guardan en cuanto los cambias.

### Comprobar lo que ve la gente
El menú de ayuda y la pantalla de inicio de sesión se previsualizan junto a sus ajustes. La gente ve un cambio la próxima vez que abre una página.
:::

Mientras no cambies un lugar, muestra lo que OneUptime ha mostrado siempre, así que un servidor que nunca abre la página se ve exactamente igual que antes.

## Qué cambia cada ajuste

| Ajuste | Dónde lo ve la gente | Predeterminado | Personalizado |
| --- | --- | --- | --- |
| **Correo de soporte** | Ayuda › **Correo de soporte**, **Contactar con soporte** en la página que no se encuentra, los correos sobre la cuenta, y la dirección a la que una pantalla de error pide enviar un paquete de soporte | `support@oneuptime.com` | Una dirección de correo |
| **Chat** | Ayuda › **Chatear en Slack**, y el enlace de chat en la parte superior de la referencia de la API | La comunidad de OneUptime en Slack | Un enlace. Un enlace de Slack o Microsoft Teams conserva su nombre; cualquier otro se llama **Chatear con soporte** |
| **Solicitar demo** | Ayuda › **Solicitar demo** | Mostrado | Solo oculto |
| **Dar tu opinión** | Ayuda › **Dar tu opinión**, y **Dar tu opinión** en la búsqueda | Los administradores de este servidor | Una dirección de correo, o una página propia |
| **Ayuda y soporte** | **Ayuda y soporte** en el pie de página, **Contacto** en las páginas de inicio de sesión, y **Soporte** en la parte superior de la referencia de la API | `https://oneuptime.com/support` | Un enlace |
| **Reportar un error o solicitar una función** | El pie del menú de productos, el issue público de GitHub que se ofrece después de enviar una opinión, y los enlaces a GitHub de la documentación y de la referencia de la API | Mostrado | Solo oculto |
| **Obtener la app móvil** | **Cómo contactarme**, la configuración de guardia, los primeros pasos de un miembro nuevo en Inicio, y **Aplicaciones móviles** en **Ajustes del proyecto** | App Store y Google Play | Una página propia, como el portal de empresa de tu gestor de dispositivos |
| **Mensaje para las personas que necesitan una invitación** | Las pantallas del inicio de sesión único que dicen «You need to be invited.» y «No project access.» | La frase de OneUptime | Tus propias palabras |

Todos los ajustes salvo el mensaje también se pueden ocultar. Un enlace empieza por `https://`, `http://` o `mailto:`. Cualquier otro tipo de enlace, `javascript:` entre ellos, lo rechaza la página y de nuevo el servidor.

El menú de ayuda, el pie de página y el menú de productos del propio Admin Dashboard conservan los enlaces de OneUptime: son para los administradores de este servidor, que reciben ayuda con el servidor de parte de OneUptime.

### Los correos sobre la cuenta

En un servidor autoalojado, los correos sobre la cuenta, como una invitación o un cambio de dirección de correo, terminan remitiendo a la gente al administrador de este servidor, nunca al soporte de OneUptime. Con una dirección de soporte propia, la indican como enlace: «¿Necesita ayuda? Escriba a it-help@example.com.» Con el valor predeterminado, o si el ajuste está oculto, dicen lo mismo de siempre.

### La documentación y la referencia de la API

La documentación y la referencia de la API que ofrece este servidor siguen los mismos ajustes. Con **Reportar un error o solicitar una función** oculto, ninguna página enlaza a GitHub, y la pregunta **¿Te ha resultado útil esta página?** solo aparece donde su respuesta se guarda o se envía. La barra superior de la referencia de la API muestra el chat y la página de ayuda que elegiste, o ninguno de los dos cuando están ocultos.

### Quién puede leer tus enlaces

La dirección de soporte y el enlace **Ayuda y soporte** también aparecen en las páginas de inicio de sesión, así que cualquiera que pueda abrir esas páginas puede leerlos. Un enlace de chat y la página de la app móvil solo se envían a las personas que han iniciado sesión: un enlace de chat suele ser una invitación a tu espacio de trabajo. Por la misma razón, la documentación y la referencia de la API, que cualquiera puede leer, solo muestran un enlace de chat propio a quien haya iniciado sesión en este servidor.

## Dar tu opinión

| Opción | Qué ocurre |
| --- | --- |
| **Predeterminado** | Como siempre: se envía por correo al **Correo de notificación admin** configurado en **Ajustes** › **Correos**, o se guarda para los administradores de este servidor en **Opiniones** cuando no hay ninguno. En OneUptime Cloud va al equipo de OneUptime. |
| **Una dirección de correo** | Se envía por correo a esa dirección a través de los ajustes de correo de este servidor, con el nombre y la dirección de correo de la persona, para que tu equipo pueda responder. La persona recibe una copia. |
| **Una página propia** | **Dar tu opinión** la abre en una pestaña nueva, como el formulario de tu mesa de ayuda. No se envía nada desde OneUptime. |
| **Ocultar «Dar tu opinión»** | **Dar tu opinión** no se ofrece en ningún sitio. |

Mientras el servidor no pueda enviar correos, elegir una dirección de correo oculta **Dar tu opinión** en lugar de aceptar un mensaje que no puede llegar a tu equipo, y la página de ajustes lo indica. Configura el correo en **Ajustes** › **Correos**, y **Dar tu opinión** vuelve por sí solo.

Las preguntas que hace OneUptime, como lo fácil que fue una configuración guiada, no son **Dar tu opinión**: sus respuestas se quedan en **Opiniones**, donde **Preguntar cómo fue** las desactiva.

## El mensaje de inicio de sesión

El inicio de sesión único propio del servidor rechaza a dos tipos de personas: alguien sin cuenta, mientras el proveedor no cree ninguna («You need to be invited.»), y alguien cuya cuenta no está en ningún proyecto («No project access.»). Ambos necesitan una invitación, así que ambas pantallas muestran tu mensaje, con a quién pedirla y cómo contactar con esa persona:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- El mensaje es texto sin formato de hasta 1000 caracteres, y no puede contener `<` ni `>`.
- Cada línea es un párrafo, y los enlaces y las direcciones de correo que contiene se convierten en enlaces.
- El título de la pantalla se queda como está, y la app móvil muestra las mismas palabras.

## Las sugerencias para obtener la app móvil

Con una página propia, cada sugerencia para obtener la app móvil apunta allí: un solo código QR para tu página, con su dirección como nombre, y los pasos siguen indicando la dirección de este servidor a la que se conecta la app. Si el ajuste se oculta, no hay ninguna sugerencia:

- **Obtener la app móvil** desaparece de los primeros pasos de un miembro nuevo en Inicio, que se completan igualmente cuando se puede contactar con la persona y un aviso de prueba le ha llegado.
- **Cómo contactarme** y la configuración de guardia solo ofrecen navegadores.
- **Aplicaciones móviles** desaparece de **Ajustes del proyecto**.
- Dondequiera que OneUptime enumere las formas de contactar con alguien, como las configuraciones guiadas, Inicio, las reglas de cumplimiento de un equipo y Preguntar a la IA, la app ya no aparece entre ellas.

## Definir los ajustes desde tu configuración

Un servidor instalado con Helm o Docker Compose puede arrancar con estos ajustes ya configurados. Defínelos en los valores `helpAndSupport` del chart de Helm, o en `config.env` para Docker Compose:

```yaml
helpAndSupport:
  supportEmail: it-help@example.com
  chat: https://example.slack.com/archives/C024BE91L
  requestDemo: hidden
  gitHub: hidden
  inviteMessage: |
    Ask the IT service desk to invite you to OneUptime:
    it-help@example.com
```

| Valor de Helm | `config.env` | Qué admite |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | Una dirección de correo, o `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Un enlace, o `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` o `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | Una dirección de correo, un enlace o `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Un enlace, o `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` o `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Un enlace, o `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Texto sin formato |

- Los valores se leen al arrancar el servidor, y solo mientras no se haya guardado nada en **Ayuda y soporte**. Desde ese momento, los ajustes son los de la página: un cambio hecho allí se conserva, y un reinicio nunca lo revierte.
- Un valor que se cambie más adelante en la configuración no se aplica, y el log del servidor lo indica. Cámbialo en la página.
- Cada valor se comprueba igual que lo comprueba la página. Uno que se rechazaría, como un enlace `javascript:`, se omite, y la página y el log del servidor dicen por qué. Los demás se establecen igualmente.
- Deja un valor vacío para mantener el valor predeterminado de OneUptime. `true` y `false` también sirven para los dos interruptores.
- La página marca cada ajuste que vino de tu configuración, hasta que lo cambies.

## Próximos pasos

:::cards
- [SSO global](/docs/identity/global-sso): El inicio de sesión único propio del servidor.
- [Duración de la sesión](/docs/self-hosted/session-length): Cuánto tiempo permanece la gente con la sesión iniciada.
:::
