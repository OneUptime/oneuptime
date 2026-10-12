# Microsoft Teams

Conecta OneUptime con Microsoft Teams para publicar en tus canales y chats los incidentes, alertas, episodios, mantenimientos programados, monitores y novedades de guardia, dar a cada incidente un canal propio y dejar que los respondedores actúen desde Teams: reconocer, resolver, añadir notas, avisar a la guardia, declarar incidentes y preguntar a OneUptime AI.

:::cards
- [Conectar Microsoft Teams](#conectar-microsoft-teams): El consentimiento de administrador, tu inicio de sesión y la app en cada equipo.
- [Reglas de notificación](#reglas-de-notificación): Decide qué eventos se publican dónde, y cuáles tienen un canal propio.
- [Hablar con el bot de OneUptime](#hablar-con-el-bot-de-oneuptime): Comandos, preguntas y formularios en un chat con el bot.
- [Actuar sobre incidentes, alertas y eventos desde Microsoft Teams](#actuar-sobre-incidentes-alertas-y-eventos-desde-microsoft-teams): Los botones de las tarjetas de OneUptime.
:::

## Cómo funciona

```mermaid title="De un evento en OneUptime a una tarjeta en Microsoft Teams"
flowchart TB
    event["Un incidente, una alerta o un evento<br/>se crea o cambia"] --> rules{"Reglas de notificación<br/>cuyas condiciones coinciden"}
    rules -->|"Create Microsoft Teams Channel"| own["Un canal propio<br/>en el equipo que elijas"]
    rules -->|"Publicar en un canal<br/>o chat existente"| existing["Tus canales y chats"]
    own --> card["Una tarjeta con botones"]
    existing --> card
    card -->|"Un respondedor pulsa uno"| change["El cambio se hace en OneUptime,<br/>como esa persona"]
```

Tres cosas lo hacen posible:

- **La conexión del proyecto**, hecha una vez: un administrador de Microsoft 365 da su consentimiento a la app de OneUptime para tu organización.
- **La app de OneUptime en cada equipo** en el que quieras notificaciones. Microsoft solo deja publicar al bot en un equipo al que se ha añadido.
- **La conexión propia de cada persona**: su cuenta de Microsoft Teams vinculada a su cuenta de OneUptime. Los botones, los comandos y las reacciones actúan como esa persona, con sus permisos en el proyecto.

## Antes de empezar

- **Un rol que pueda conectar el proyecto:** **Project Owner**, **Project Admin** o **Project Member**. Desinstalar requiere **Project Owner** o **Project Admin**.
- **Un administrador de Microsoft 365** que dé el consentimiento de administrador, una vez para toda la organización.
- **El plan Growth en OneUptime Cloud** para las reglas de notificación y los resúmenes. Consulta [Reglas de notificación por debajo del plan Growth](#reglas-de-notificación-por-debajo-del-plan-growth).
- **En un servidor autoalojado,** antes un bot de Teams configurado para él. Consulta [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Conectar Microsoft Teams

:::steps
### Dar el consentimiento de administrador

Ve a **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams** y haz clic en **Conceder consentimiento de administrador**. Un administrador de Microsoft 365 inicia sesión y autoriza la app de OneUptime para la organización. Luego la tarjeta dice **Consentimiento del administrador completado**. Mientras no haya ningún espacio de trabajo conectado, la sección **Espacio de trabajo** de los menús Incidentes, Alertas, Mantenimiento programado, Monitores y Guardia contiene **Conectar Slack o Teams**, que también lleva aquí.

### Conectar tu cuenta

Haz clic en **Conectar con Microsoft Teams** e inicia sesión con tu cuenta profesional. OneUptime lee los equipos de tu organización; **Ver equipos** los lista.

### Añadir la app de OneUptime a cada equipo (obligatorio)

Conectar tu cuenta no basta por sí solo. Microsoft solo deja publicar al bot de OneUptime en un equipo al que se ha añadido, así que haz esto para cada equipo en el que quieras notificaciones:

- En Microsoft Teams, haz clic en "..." junto al **nombre del equipo** (no el nombre del canal).
- Elige **Manage team** > **Apps** > **More apps**, busca **OneUptime** y haz clic en **Add**.

En OneUptime Cloud, **Abrir la tienda de Teams** abre la app en la Microsoft Teams Store, donde **Add to a team** hace lo mismo. En un servidor autoalojado, instala en su lugar el paquete de **Descargar zip del manifiesto de la aplicación**: solo ese lleva el bot de tu servidor. Si una notificación de prueba indica que la app de OneUptime no está instalada en el equipo, este es el paso que faltó.

### Conectar a todos los demás

Cada persona vincula su propia cuenta de Microsoft Teams en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, para actuar sobre los incidentes y recibir mensajes directos como ella misma. Esa sección aparece en cuanto el proyecto está conectado a Microsoft Teams.

### Añadir una regla de notificación

Ve a **Incidentes** > **Espacio de trabajo** > **Microsoft Teams**. La sección **Espacio de trabajo** solo lista los espacios de chat que tu proyecto ha conectado, así que **Microsoft Teams** aparece ahí en cuanto está conectado. Crea una regla, por ejemplo una que publique en un canal de Teams cuando se crea un incidente, y luego haz clic en **Probar regla** en su fila.
:::

> [!NOTE]
> Instalar OneUptime para ti, o añadirlo a un chat, es otra instalación y no le permite publicar en los canales de un equipo. Los **canales privados** necesitan la app añadida al propio canal: abre el canal > "..." > **Manage channel** > **Apps** > **Add an app**. Los **canales compartidos** no pueden recibir notificaciones: Microsoft Teams no admite bots en canales compartidos.

## Reglas de notificación

Una regla de notificación indica qué eventos se publican en Microsoft Teams, y dónde. Cada producto tiene sus propias reglas, en **Espacio de trabajo** > **Microsoft Teams** de su menú:

| Producto | Pestañas de su página **Microsoft Teams** |
| --- | --- |
| **Incidentes** | **Incidentes**, **Episodios de incidente**, **Resumen** |
| **Alertas** | **Alertas**, **Episodios de alerta**, **Resumen** |
| **Mantenimiento programado** | Una lista de reglas |
| **Monitores** | Una lista de reglas |
| **Guardia** | Una lista de reglas |

Crear una regla recorre cuatro pasos:

| Paso | Lo que defines |
| --- | --- |
| **Básico** | **Nombre de la regla** y **Descripción de la regla**. |
| **Condiciones** | Para qué eventos se dispara la regla, por ejemplo por gravedad, estado, etiqueta, monitor o palabras del título. Sin condiciones, se dispara para cada evento. Con dos o más, **Condición de coincidencia** indica si deben coincidir todas o basta con una. |
| **Destino** | Dónde publica: en un canal existente de un equipo que elijas, en los chats que elijas, en un canal nuevo creado en un equipo que elijas, o en varios de ellos a la vez. |
| **Videollamada** | Solo incidentes y alertas: iniciar una llamada para cada uno. Consulta [Videollamadas](/docs/workspace-connections/video-calls). |

Un canal que crea la regla se nombra con **New Microsoft Teams Channel Name** seguido del número del registro, como `oneuptime-incident-42`, y solo un canal creado recibe a las personas que invita la regla. Un incidente, una alerta o un episodio privado recibe un canal privado. Cada actualización posterior del registro — un cambio de estado, una nota, un nuevo propietario — se publica en sus canales y chats.

**Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams** lista los canales que OneUptime ve en tus equipos, y los chats a los que se ha añadido, con **Enviar prueba** junto a cada uno. Un chat aparece en cuanto se añade a él la app de OneUptime en Microsoft Teams; **Actualizar chats** recoge los chats nuevos y sus nombres actuales.

## Probar una regla

**Probar regla** en la fila de una regla publica un mensaje de prueba de esa regla en los canales que nombra, para que lo veas llegar. Si la regla crea un canal para cada evento, la prueba también crea uno e invita a las personas de la regla.

Como **Enviar prueba** junto a un canal en **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**, necesita permiso para crear reglas de notificación: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, o **Create Workspace Notification Rule** y **Read Workspace Notification Rule** en un rol personalizado. Para alguien que solo puede ver las reglas, como un **Viewer**, **Probar regla** está bloqueado, y su descripción emergente dice lo que hace falta; la API rechaza su prueba con "You do not have permission to send test notifications in this project." En OneUptime Cloud, probar una regla requiere el plan **Growth**, igual que añadir una.

En OneUptime Cloud, **Enviar prueba** junto a un canal o un chat también requiere el plan **Growth**, porque publicar en un canal es lo que hacen las reglas y los resúmenes. **Enviar prueba ahora** en un resumen necesita permiso para crear resúmenes (**Create Workspace Notification Summary** y **Read Workspace Notification Summary** en un rol personalizado) y, en OneUptime Cloud, el plan **Growth**; para cualquier otra persona está bloqueado, y su descripción emergente dice lo que hace falta. Un cliente MCP conectado con acceso de solo lectura no puede enviar ninguna prueba.

## Resúmenes

La pestaña **Resumen** de **Incidentes** > **Espacio de trabajo** > **Microsoft Teams** (y de **Alertas**) publica un resumen periódico en los canales que nombres: cuántos incidentes o alertas hubo, qué tan rápido se reconocieron y resolvieron, y una lista con enlaces. Un resumen nuevo sale cada semana y cubre los últimos 7 días. Deja **Enviar el primer informe a las** vacío y el primero sale a las 09:00 al comienzo de la semana, el día o el mes siguiente; el formulario dice cuándo.

Un resumen sale según el reloj de su **Zona horaria**, que empieza en la tuya. Mantiene allí su hora del día todo el año: uno configurado para las 09:00 en Berlín sigue saliendo a las 09:00 en Berlín después del cambio de horario de verano, y las fechas de su mensaje también son las de Berlín. Mediante la API, envía `timezone` como nombre de zona horaria IANA, como `Europe/Berlin`. Un resumen creado sin zona horaria toma la del perfil de quien lo creó, o UTC cuando lo crea una clave de API.

El formulario de un resumen tiene cuatro pasos: **Información básica** (su nombre, los canales y su **Nombre del equipo**), **Programación**, **Contenido** (**Qué incluir**) y **Filtros** (qué incidentes o alertas cuenta).

## Reglas de notificación por debajo del plan Growth

En OneUptime Cloud, las reglas de notificación y los resúmenes están en el plan **Growth** y superiores. Un proyecto por debajo conserva las reglas y los resúmenes que ya tiene, y siguen publicando en Microsoft Teams. Por eso la página **Microsoft Teams** de cada producto (Incidentes, Alertas, Mantenimiento programado, Guardia, Monitores) muestra la nota del plan con ellos debajo (**Reglas de notificación aún configuradas**, **Resúmenes aún configurados**): elimina una regla, o desactiva o elimina un resumen. Añadir o cambiar reglas y resúmenes requiere **Growth**.

## Recibir avisos en Microsoft Teams

Para recibir avisos por mensaje directo cuando estás de guardia, añade Microsoft Teams como uno de tus métodos de notificación:

:::steps
1. Conecta tu propia cuenta de Microsoft Teams (consulta [Conectar Microsoft Teams](#conectar-microsoft-teams)).
2. Ve a **Ajustes de usuario** > **Métodos de notificación**, abre la pestaña **Workspace Apps** y haz clic en **Añadir cuenta de Microsoft Teams**.
3. Haz clic en **Enviar mensaje de prueba** en su fila. El mensaje llega a tus chats de Microsoft Teams.
:::

Al añadirlo, entra de inmediato en tus reglas de guardia, así que a partir de entonces los avisos te llegan en Microsoft Teams. Cambia qué avisos recibe en **Ajustes de usuario** > **Reglas de guardia**.

## Guardar mensajes como notas

Reacciona a un mensaje, o a una respuesta, en el canal que OneUptime creó para un incidente, una alerta, un episodio o un evento de mantenimiento programado, y OneUptime lo guarda como nota en ese registro. Detecta la reacción en menos de un minuto y lo confirma con una respuesta en el hilo:

| Reacción | Se guarda como |
| --- | --- |
| 📌 o 📍 | Una nota privada, visible solo para tu equipo |
| 📣 o 📢 | Una nota pública, mostrada en la página de estado. Solo incidentes y eventos de mantenimiento programado. |

La nota se guarda como tú, con tus permisos, así que tu propia cuenta de Microsoft Teams debe estar conectada y la app de OneUptime debe estar en el equipo.

## Hablar con el bot de OneUptime

Escribe al bot en un chat personal, o menciona a OneUptime con @ en un canal o un chat de grupo: allí solo responde cuando se le menciona.

| Mensaje | Lo que hace el bot |
| --- | --- |
| `help` | Lista lo que puede hacer. |
| `ask <question>`, o cualquier pregunta en lenguaje natural | OneUptime AI responde sobre tus registros, trazas, métricas, incidentes y monitores, por ejemplo "¿Qué monitores están caídos ahora mismo?". Las respuestas solo leen. |
| `create incident [title]` | Abre el formulario de incidente, con el título rellenado. |
| `create maintenance [title]` | Abre el formulario de mantenimiento programado, con el título rellenado. |
| `show active incidents`, `show active alerts` | Lista lo que está abierto ahora. |
| `show scheduled maintenance`, `show ongoing maintenance` | Lista los eventos de mantenimiento próximos, o en curso. |

Preguntar a OneUptime AI requiere la IA activada para el proyecto. Consulta [Preguntar a la IA](/docs/ai/ask-ai).

## Crear incidentes y mantenimientos desde Microsoft Teams

Escribir `create incident` o `create maintenance` al bot de OneUptime abre un formulario para la persona que lo escribió, en un chat personal, un canal o un chat de grupo por igual. Se rellena como esa persona: como la cuenta de OneUptime a la que está conectada su cuenta de Microsoft Teams (consulta [Conectar Microsoft Teams](#conectar-microsoft-teams)), con los permisos de esa cuenta en el proyecto. A quien no tiene la cuenta conectada, o cuya cuenta de OneUptime ya no es miembro del proyecto, se le dice qué hacer en lugar de recibir el formulario.

- **Quién puede usarlos.** Las personas que pueden declarar un incidente o crear un evento de mantenimiento programado en OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member** para un incidente (**Create Incident** en un rol personalizado), y **Scheduled Maintenance Admin** y **Scheduled Maintenance Member** para un evento (**Create Scheduled Maintenance**). A cualquier otra persona se le avisa, y no recibe formulario.
- **Qué ofrece un formulario.** Cada lista — gravedades, monitores, estados de monitor, políticas de guardia y etiquetas — contiene lo que puede leer la persona que lo pidió, igual que la misma lista en OneUptime, y las notas "not shown" de la tarjeta solo cuentan esos: con un rol limitado a algunas etiquetas, los monitores y las políticas de guardia que llevan esas etiquetas. Una lista que no puede leer en absoluto se omite. Las políticas de guardia archivadas nunca se ofrecen.
- **Qué puede nombrar un formulario.** En un canal o un chat de grupo, cualquiera de los presentes puede enviar el formulario, y se envía como quien lo hace, con sus propios permisos. El incidente o el evento se crea con esos permisos y se atribuye a esa persona. Un monitor, una política de guardia, una etiqueta, una gravedad o un estado que no puede leer, o uno de otro proyecto, se rechaza como uno que el proyecto no tiene, y no se crea nada: el bot responde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** en un incidente, una alerta o un episodio funciona igual: necesita permiso para ejecutar una política de guardia (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** y **On-Call Member**, o **Create On-Call Duty Policy Execution Log** en un rol personalizado) y para leer ese incidente, alerta o episodio, y ofrece las políticas de guardia activas que la persona puede leer. Ver un monitor o una política de guardia desde una tarjeta también lo lee como la persona que pulsó el botón.

## Actuar sobre incidentes, alertas y eventos desde Microsoft Teams

Los botones de las tarjetas de OneUptime actúan como la persona que los pulsa, en un chat personal, un canal o un chat de grupo por igual: como la cuenta de OneUptime a la que está conectada su cuenta de Microsoft Teams, con los permisos de esa cuenta en el proyecto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** y **Execute On-Call Policy** en un incidente, una alerta o un episodio, y **Mark as Ongoing**, **Mark as Complete**, **Change State** y **Add Note** en un evento de mantenimiento programado, hacen cada uno el cambio que hace la misma acción en OneUptime, y se atribuye allí a esa persona: la línea de tiempo de estados y el feed del registro muestran quién cambió su estado, y la nota es suya. Una nota guardada desde un mensaje con una reacción se publica del mismo modo.

- **Quién puede usarlos.** Las personas que pueden hacer el mismo cambio en OneUptime. Reconocer, resolver o cambiar el estado de un incidente necesita permiso para cambiar su estado: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member**, o **Create Incident State Timeline** en un rol personalizado. Una alerta, un episodio o un evento de mantenimiento programado necesita el mismo permiso para su propio tipo (**Create Alert State Timeline**, por ejemplo), y una nota necesita permiso para publicar ese tipo de nota. Como el panel de estado de OneUptime, no piden permiso para editar el incidente o la alerta en sí. A cualquier otra persona se le avisa, y nada cambia.
- **Qué registros.** Los que la persona puede leer, como en OneUptime: con un rol limitado a algunas etiquetas, los incidentes, alertas, episodios y eventos que las llevan. Un botón en cualquier otro registro, o en uno de otro proyecto, recibe como respuesta que el registro "was not found in this project, or you do not have access to it.", y nada cambia. En OneUptime Cloud, un cambio que el plan del proyecto no incluye se rechaza indicando el plan que necesita.
- **Qué ofrece Change State.** Los estados que la persona puede leer y a los que el registro puede pasar a continuación, en el orden del proyecto: ninguno anterior al estado en que está, tanto para un episodio como para un incidente, una alerta o un evento de mantenimiento programado, ya que un cambio de estado nunca hace subir un registro en su lista (consulta [El orden es una restricción real, no una preferencia de visualización](/docs/incidents/states-and-severities#el-orden-es-una-restricción-real-no-una-preferencia-de-visualización)). Si no puede leer ninguno, el bot dice "No incident states are available to you in this project. Ask a project admin for access to them."; si el registro está en el último estado que puede alcanzar, dice "There is no later state to move this incident to." Ninguno de los dos muestra una tarjeta vacía.
- **Escalate.** **Escalate** en una tarjeta ejecuta su política de guardia para el incidente, la alerta o el episodio del que trata la tarjeta, como la persona que lo pulsó, con los mismos permisos que **Execute On-Call Policy**. Una tarjeta que no trata de ninguno de ellos recibe como respuesta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", y no se avisa a nadie.

## Desconectar

- **Desconectar** desvincula solo tu propia cuenta de Microsoft Teams, y elimina con ella tu método de notificación de Microsoft Teams.
- **Desinstalar OneUptime de Microsoft Teams**, en **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**, desconecta el proyecto. OneUptime deja de publicar en Microsoft Teams, y los menús **Espacio de trabajo** dejan de listarlo. Las reglas de notificación y los resúmenes se conservan para cuando vuelvas a conectar.

> [!WARNING]
> Desinstalar también desvincula la cuenta de Microsoft Teams de cada miembro del proyecto, y elimina los métodos de notificación de Microsoft Teams y las reglas de guardia que los usaban. Un proyecto está conectado a una sola organización de Microsoft 365: para pasarlo a otra, desinstala primero.

## Solución de problemas

:::details Una prueba dice que la app de OneUptime no está instalada en el equipo
Microsoft rechazó la publicación porque el bot no está en ese equipo. Añade la app al equipo (consulta [Conectar Microsoft Teams](#conectar-microsoft-teams)) o, para un canal privado, al propio canal. Añadirla a un equipo no hace nada por los demás.
:::

:::details Microsoft Teams no se conectó
Cuando Microsoft te devuelve sin conexión, la página desde la que empezaste dice **Microsoft Teams no se conectó**, y una frase dice por qué: te falta el permiso, el enlace ya se usó o caducó, iniciaste sesión en otra organización de Microsoft 365, o tu organización todavía no tiene equipos. Consulta [La conexión no terminó](/docs/self-hosted/microsoft-teams-integration#la-conexión-no-terminó) para cada frase y qué hacer.
:::

:::details El bot dice que mi cuenta no está conectada
Vincúlala en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, con la sesión iniciada en la organización a la que está conectado el proyecto. Una cuenta de invitado de otra organización no es la misma cuenta.
:::

:::details Todas las notificaciones fallan en un servidor autoalojado
La app de Teams instalada en tus equipos debe ser el paquete que creó tu servidor, y Microsoft debe poder llegar al punto de conexión del bot de tu servidor. Consulta la solución de problemas de la [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration#solución-de-problemas).
:::

## Próximos pasos

:::cards
- [Slack](/docs/workspace-connections/slack): Las mismas notificaciones y acciones en Slack.
- [Videollamadas](/docs/workspace-connections/video-calls): Da a cada incidente una llamada, publicada con sus novedades.
- [Integración con Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurar el bot de Teams en un servidor autoalojado.
- [Declarar un incidente](/docs/incidents/declaring-incidents): Todas las formas en que empieza un incidente, y lo que se ejecuta entonces.
:::
