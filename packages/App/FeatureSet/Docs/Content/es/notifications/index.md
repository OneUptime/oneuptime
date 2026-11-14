# Cómo te contacta OneUptime

OneUptime te contacta de dos maneras. Te avisa cuando un incidente o una alerta se dispara mientras estás de guardia, y te mantiene al día de lo que es tuyo: una nota en tu incidente, un monitor que cambió de estado, tu próximo turno. Ambas cosas llegan a las direcciones que guardas en **Ajustes de usuario**, proyecto por proyecto. Esta página explica cómo encajan las piezas, dónde están y con qué empiezas.

:::cards
- [Tres páginas, tres preguntas](#tres-páginas-tres-preguntas): Métodos, reglas de guardia y ajustes de notificaciones, y lo que decide cada uno.
- [Dónde encontrarlos](#dónde-encontrarlos): Las páginas de los ajustes de usuario, sección por sección.
- [Con qué empiezas](#con-qué-empiezas): Los métodos, reglas y ajustes que recibe un miembro nuevo.
- [Cuando ninguna regla coincide](#cuando-ninguna-regla-coincide): Cómo un aviso te llega igualmente, y a quién se le informa.
- [El idioma de tus avisos](#el-idioma-de-tus-avisos): Avisos en el idioma que elegiste, y lo que se queda en inglés.
:::

## Cómo funciona

```mermaid title="Dos maneras en que OneUptime te contacta, con los mismos métodos"
flowchart TB
    page["Un incidente o una<br/>alerta te avisa<br/>estando de guardia"] --> rules["Tus reglas de guardia"]
    owned["Algo le pasa a un<br/>registro que es tuyo"] --> settings["Tus ajustes de<br/>notificaciones"]
    rules --> methods["Tus métodos verificados:<br/>correo, teléfono,<br/>push, chat"]
    settings --> methods
```

- Una política de guardia te avisa cuando una de sus reglas de escalado te nombra a ti, a un equipo del que formas parte o un calendario en el que estás de guardia. Tus reglas de guardia deciden entonces qué métodos tuyos prueba OneUptime, y después de cuánto tiempo.
- Cuando algo le pasa a un registro que es tuyo, o a tus turnos, tus ajustes de notificaciones deciden por qué canales va la novedad.
- En ambos casos, OneUptime solo usa métodos que has verificado, en el proyecto del que viene el aviso o la novedad.

## Tres páginas, tres preguntas

| Página | Lo que contiene | La pregunta que responde |
| --- | --- | --- |
| **Métodos de notificación** | Tus direcciones de correo, números de teléfono, números de WhatsApp, cuentas de Telegram, Slack, Microsoft Teams y Mattermost, dispositivos push y webhooks | ¿Dónde puede contactarme OneUptime? |
| **Cómo contactarme** | Para cada tipo de aviso y cada gravedad, qué método probar y después de cuánto tiempo | ¿Cómo me avisan mientras estoy de guardia? |
| **Ajustes de notificaciones** | Para cada evento sobre un registro que es tuyo o sobre tus turnos, qué canales usar | ¿De qué más me entero, y dónde? |

Están separadas a propósito. Activar todos los canales en **Ajustes de notificaciones** nunca te avisa, y un método que no has verificado nunca se usa, digan lo que digan tus reglas.

> [!IMPORTANT]
> Los métodos, las reglas y los ajustes pertenecen a un proyecto. Configúralos en cada proyecto en el que trabajes: **Ajustes de usuario** siempre muestra el proyecto en el que estás.

## Dónde encontrarlos

Abre **Ajustes de usuario**, a la derecha de la barra que está debajo de la barra superior. Su menú lateral reúne todo lo relativo a cómo te contacta OneUptime:

| Sección | Páginas |
| --- | --- |
| **Primeros pasos** | **Lista de configuración**: lo que queda por configurar, en el orden que importa |
| **Alertas y notificaciones** | **Métodos de notificación**, **Cómo contactarme**, **Ajustes de notificaciones** y **Preferencias de correo**, que fija cuántos correos suman tus novedades |
| **Registros de guardia** | **Registros de guardia**: cada vez que te avisaron en este proyecto, y lo que se envió |
| **Política de llamadas entrantes** | **Números de teléfono entrantes**: el número al que te llama una política de llamadas entrantes |
| **Calendario** | **Feed de calendario**: tus turnos en tu aplicación de calendario, y recordatorios antes de que empiecen |
| **Perfil** | **Campos personalizados**: datos que tu proyecto pide a sus miembros |
| **Espacio de trabajo** | **Slack**, **Microsoft Teams** y **Mattermost**: tu propia cuenta, en cada espacio de trabajo que el proyecto ha conectado |

**Primeros pasos** y **Alertas y notificaciones** están abiertas; las demás secciones empiezan plegadas, y una sección se abre sola cuando estás en una de sus páginas. **Espacio de trabajo** solo aparece si el proyecto ha conectado Slack, Microsoft Teams o Mattermost.

Los propietarios y administradores del proyecto también pueden ver tu configuración: en **Usuarios**, abren tu fila y su sección **Guardia**, con **Preparación**, **Métodos de notificación** y **Cómo contactarme**. Pueden añadir un método por ti allí, pero el código va al propio método, así que solo tú puedes verificarlo.

## Con qué empiezas

Cuando te unes a un proyecto con un correo de inicio de sesión verificado, OneUptime te configura para que un aviso siempre pueda llegarte:

1. Tu correo de inicio de sesión se añade como método de correo verificado.
2. Para cada gravedad, en cada una de las cuatro pestañas de **Cómo contactarme**, una regla te envía un correo en cuanto te avisan.
3. Un conjunto de novedades sobre lo que es tuyo, y sobre tus turnos, se activa por correo. Consulta [Ajustes de notificaciones](/docs/notifications/notification-settings#qué-está-activado-para-un-miembro-nuevo).

Cada método que verifiques después recibe las mismas reglas: una regla para cada gravedad, enviada en cuanto te avisan. Así que verificar un número de teléfono para SMS significa que cada aviso también te envía un SMS. Para dejar los SMS solo para los avisos críticos, elimina las reglas de SMS de las demás gravedades. Consulta [Cómo contactarme](/docs/notifications/on-call-rules#las-reglas-con-las-que-empiezas).

## La lista de configuración

**Ajustes de usuario → Lista de configuración** abre **Tu lista de configuración**: todo lo que OneUptime necesita para contactarte, en el orden que importa. Un paso enlaza a la página que lo resuelve, y **Volver a comprobar** lo vuelve a leer todo.

| Sección | Lo que comprueba |
| --- | --- |
| **Para que podamos contactarte** | Tienes un método, cada método que añadiste está verificado, y al menos uno está en un canal que el proyecto ha activado |
| **Cómo quieres que te avisen** | Cada gravedad tiene una regla, en cada una de las cuatro pestañas de **Cómo contactarme** |
| **Mantenerse informado** | Te enteras de cuándo empieza un turno, y cada canal que activaste en **Ajustes de notificaciones** tiene detrás un método verificado |
| **Deseable** | Un número para llamadas entrantes, tus cuentas de Slack y Microsoft Teams, un enlace de calendario y tus campos de perfil |

**Mantenerse informado** solo señala las notificaciones push para una actualización que no te llega de ninguna otra forma: cada actualización que un miembro nuevo recibe por push también le llega por correo.

**Deseable** no cuenta en la barra de progreso, ni tampoco un paso que solo otra persona puede resolver. La línea de arriba lo resume:

| Titular | Lo que significa |
| --- | --- |
| **Ya está todo listo** | Los avisos te llegan, y no queda nada por hacer |
| **Todavía quedan algunas cosas por configurar** | Una gravedad no tiene regla, o un paso aún no está hecho |
| **Todavía nada puede contactarte** | Ninguno de tus métodos se puede usar: ninguno está verificado, o cada uno verificado está en un canal que este proyecto ha desactivado |
| **Ya lo tienes todo configurado y ahora no estás de guardia** | Todo está listo para el día en que una política te nombre |

## Cuando ninguna regla coincide

Un aviso puede llegarte para un tipo y una gravedad para los que no tienes regla: por ejemplo, una gravedad añadida después de que te unieras. OneUptime te avisa igualmente, por lo que tienes verificado:

1. Cada método gratuito que tengas: dispositivos push, direcciones de correo, Slack, Microsoft Teams y Mattermost.
2. Si no tienes ninguno, un método de pago, en este orden: SMS, una llamada, WhatsApp, Telegram. Es el primero que tengas verificado, en un canal que el proyecto ha activado.
3. Si tampoco tienes ninguno de esos, un webhook.

Recibes un correo avisándote, y también los propietarios de la política de guardia, o los del proyecto si la política no tiene. Si no hay nada verificado, el aviso no se puede entregar, y el correo dice eso. Estos correos se retienen mientras siguen llegando avisos, para que una tormenta de avisos no sea una tormenta de correos. Para añadir la regla que falta, consulta [Cómo contactarme](/docs/notifications/on-call-rules#cuando-una-gravedad-no-tiene-regla).

## El idioma de tus avisos

Tus avisos se escriben en tu idioma: el que eliges en el menú de idiomas al pie de cualquier página, o en **Idioma** en **Perfil de usuario**. Hasta que elijas uno, están en inglés.

| Canal | Idioma |
| --- | --- |
| Correo, SMS, notificaciones push y Telegram | Tu idioma |
| Tus propios mensajes de Slack, Microsoft Teams y Mattermost | Tu idioma |
| Llamadas telefónicas y WhatsApp | Inglés |

Lo que cambia son las palabras de OneUptime: asuntos, encabezados, botones y frases, y los nombres con los que empieza cada proyecto nuevo, como Identificado e Incidente crítico. Lo que escribió tu equipo se queda como está: títulos, descripciones, causas raíz y los nombres de proyectos, equipos y estados que tu proyecto nombró. Un SMS en un idioma con su propio alfabeto, como el ruso, el japonés o el persa, ocupa más partes que uno en inglés.

## Solución de problemas

:::details Estaba de guardia, pero no me llegó nada
Abre **Ajustes de usuario → Registros de guardia**. Si no hay fila para el incidente, su política de guardia nunca te avisó: revisa sus reglas de escalado y quién estaba de guardia. En una fila con el estado **Error**, **Ver mensaje de estado** dice por qué, por ejemplo un canal que el proyecto desactivó. Después comprueba que tus métodos están verificados y que **Tu lista de configuración** no tiene nada pendiente en **Para que podamos contactarte**.
:::

:::details Recibo correos sobre registros que nunca pedí
Eres propietario del registro, directamente o a través de un equipo, o el registro no tiene propietarios y tú eres propietario del proyecto. Desactiva el evento en **Ajustes de usuario → Ajustes de notificaciones**, o reduce el volumen en **Ajustes de usuario → Preferencias de correo**.
:::

:::details Mis avisos están en inglés, aunque el panel no
El panel sigue a tu navegador hasta que eliges un idioma. Elígelo en el menú de idiomas al pie de cualquier página, o en **Idioma** en **Perfil de usuario**. Las llamadas telefónicas y los mensajes de WhatsApp se quedan en inglés.
:::

:::details Añadí un número de teléfono, pero no está en mis reglas
Un número entra en tus reglas cuando se verifica. Haz clic en **Verificar** en su fila e introduce el código. Si su tarjeta no tiene botón para añadir, el proyecto tiene ese canal desactivado. Consulta [Métodos de notificación](/docs/notifications/notification-methods#activa-un-canal-para-tu-proyecto).
:::

## Próximos pasos

:::cards
- [Métodos de notificación](/docs/notifications/notification-methods): Añade y verifica las direcciones en las que OneUptime puede contactarte.
- [Cómo contactarme](/docs/notifications/on-call-rules): Decide qué método prueba cada aviso, y cuándo.
- [Ajustes de notificaciones](/docs/notifications/notification-settings): Elige las novedades de las que te enteras, y por qué canales.
- [Reglas de escalado](/docs/on-call/escalation-rules): Cómo una política de guardia decide a quién avisar, nivel por nivel.
:::
