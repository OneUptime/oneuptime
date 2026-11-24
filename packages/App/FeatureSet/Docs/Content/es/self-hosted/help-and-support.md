# Ayuda y soporte

Dirige la ayuda que ofrece OneUptime a tu propio equipo: la dirección de soporte, el chat y la página de ayuda que ve la gente, adónde va **Dar tu opinión**, lo que el inicio de sesión único le dice a quien necesita una invitación, y las sugerencias para obtener la app móvil. Cada uno puede quedarse con el de OneUptime, apuntar a una dirección o un enlace tuyos, u ocultarse.

:::cards
- [Cambiar adónde lleva la ayuda](#cambiar-adónde-lleva-la-ayuda): Una sola página en el Admin Dashboard.
- [Qué cambia cada ajuste](#qué-cambia-cada-ajuste): Cada lugar, su valor predeterminado y sus opciones.
- [Dar tu opinión](#dar-tu-opinión): Adónde se envía lo que escribe la gente.
- [El mensaje de inicio de sesión](#el-mensaje-de-inicio-de-sesión): A quién pedir una invitación.
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
| **Correo de soporte** | Ayuda › **Correo de soporte**, **Contactar con soporte** en la página que no se encuentra, y la dirección a la que una pantalla de error pide enviar un paquete de soporte | `support@oneuptime.com` | Una dirección de correo |
| **Chat** | Ayuda › **Chatear en Slack** | La comunidad de OneUptime en Slack | Un enlace. Un enlace de Slack o Microsoft Teams conserva su nombre; cualquier otro se llama **Chatear con soporte** |
| **Solicitar demo** | Ayuda › **Solicitar demo** | Mostrado | Solo oculto |
| **Dar tu opinión** | Ayuda › **Dar tu opinión**, y **Dar tu opinión** en la búsqueda | Los administradores de este servidor | Una dirección de correo, o una página propia |
| **Ayuda y soporte** | **Ayuda y soporte** en el pie de página, y **Contacto** en las páginas de inicio de sesión | `https://oneuptime.com/support` | Un enlace |
| **Reportar un error o solicitar una función** | El pie del menú de productos, y el issue público de GitHub que se ofrece después de enviar una opinión | Mostrado | Solo oculto |
| **Obtener la app móvil** | **Cómo contactarme**, la configuración de guardia, los primeros pasos de un miembro nuevo en Inicio, y **Aplicaciones móviles** en **Ajustes del proyecto** | App Store y Google Play | Una página propia, como el portal de empresa de tu gestor de dispositivos |
| **Mensaje para las personas que necesitan una invitación** | Las pantallas del inicio de sesión único que dicen «You need to be invited.» y «No project access.» | La frase de OneUptime | Tus propias palabras |

Todos los ajustes salvo el mensaje también se pueden ocultar. Un enlace empieza por `https://`, `http://` o `mailto:`. Cualquier otro tipo de enlace, `javascript:` entre ellos, lo rechaza la página y de nuevo el servidor.

El menú de ayuda, el pie de página y el menú de productos del propio Admin Dashboard conservan los enlaces de OneUptime: son para los administradores de este servidor, que reciben ayuda con el servidor de parte de OneUptime.

### Quién puede leer tus enlaces

La dirección de soporte y el enlace **Ayuda y soporte** también aparecen en las páginas de inicio de sesión, así que cualquiera que pueda abrir esas páginas puede leerlos. Un enlace de chat y la página de la app móvil solo se envían a las personas que han iniciado sesión: un enlace de chat suele ser una invitación a tu espacio de trabajo.

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

## Próximos pasos

:::cards
- [SSO global](/docs/identity/global-sso): El inicio de sesión único propio del servidor.
- [Duración de la sesión](/docs/self-hosted/session-length): Cuánto tiempo permanece la gente con la sesión iniciada.
:::
