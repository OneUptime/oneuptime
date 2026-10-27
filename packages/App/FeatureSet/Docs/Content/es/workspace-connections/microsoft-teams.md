# Microsoft Teams

Conecta OneUptime con Microsoft Teams para publicar en tus canales y chats los incidentes, alertas, episodios, mantenimientos programados, monitores y novedades de guardia, dar a cada incidente un canal propio y dejar que los respondedores actúen desde Teams: reconocer, resolver, añadir notas, avisar a la guardia, declarar incidentes y preguntar a OneUptime AI.

:::cards
- [Conectar Microsoft Teams](#conectar-microsoft-teams): El consentimiento de administrador, tu inicio de sesión y la app en cada equipo.
- [Pedir a todos que conecten su cuenta](#pedir-a-todos-que-conecten-su-cuenta): Escribe de una sola vez a todos los miembros que aún no han conectado su cuenta.
- [Reglas de notificación](#reglas-de-notificación): Decide qué eventos se publican dónde, y cuáles tienen un canal propio.
- [Hablar con el bot de OneUptime](#hablar-con-el-bot-de-oneuptime): Comandos, preguntas y formularios en un chat con el bot.
- [Etiquetas de guardia](#etiquetas-de-guardia): Mantén la etiqueta de un equipo igual a quienes están de guardia, y avísala.
- [Actuar sobre incidentes, alertas y eventos desde Microsoft Teams](#actuar-sobre-incidentes-alertas-y-eventos-desde-microsoft-teams): Los botones de las tarjetas de OneUptime.
:::

## Cómo funciona

```mermaid title="De un evento en OneUptime a una tarjeta en Microsoft Teams"
flowchart TB
    event["Un incidente, una alerta o un evento<br/>se crea o cambia"] --> rules{"Reglas de notificación<br/>cuyas condiciones coinciden"}
    rules -->|"Un canal<br/>para cada uno"| own["Un canal propio<br/>en el equipo que elijas"]
    rules -->|"Publicar en un canal<br/>o chat existente"| existing["Tus canales y chats"]
    own --> card["Una tarjeta con botones"]
    existing --> card
    card -->|"Un respondedor pulsa uno"| change["El cambio se hace en OneUptime,<br/>como esa persona"]
```

Tres cosas lo hacen posible:

- **La conexión del proyecto**, hecha una vez: un administrador de Microsoft 365 da su consentimiento a la app de OneUptime para tu organización.
- **La app de OneUptime en cada equipo** en el que quieras notificaciones. Microsoft solo deja publicar al bot en un equipo al que se ha añadido.
- **La conexión propia de cada persona**: su cuenta de Microsoft Teams vinculada a su cuenta de OneUptime. Los botones, los comandos y las reacciones actúan como esa persona, con sus permisos en el proyecto.

Una organización de Microsoft 365 puede estar conectada a más de un proyecto, como producción y staging. El botón de una tarjeta actúa en el proyecto para el que se envió la tarjeta, como el proyecto del incidente al que se refiere. Un mensaje al bot actúa en el proyecto del canal en el que se envía, como el canal de un incidente, o si no, en el único proyecto en el que está conectada la cuenta de Microsoft Teams de quien lo envía. Cuando nada lo indica, el bot le pregunta a esa persona a qué proyecto se refiere, con un botón para cada proyecto en el que está, y continúa allí en cuanto elige. En una conversación con OneUptime AI, su elección se mantiene para las preguntas de seguimiento hasta que pasa una hora sin ninguna.

## Antes de empezar

- **Un rol que pueda conectar el proyecto:** **Propietario del proyecto**, **Administrador del proyecto** o **Miembro del proyecto**. Desinstalar requiere **Propietario del proyecto** o **Administrador del proyecto**.
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

Cada persona vincula su propia cuenta de Microsoft Teams en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams** con **Connect my account with Microsoft Teams**, para actuar sobre los incidentes y recibir mensajes directos como ella misma. Esa sección aparece en cuanto el proyecto está conectado a Microsoft Teams. Para incluir a todo un equipo de una vez, consulta [Pedir a todos que conecten su cuenta](#pedir-a-todos-que-conecten-su-cuenta).

### Añadir una regla de notificación

Ve a **Incidentes** > **Espacio de trabajo** > **Microsoft Teams**. La sección **Espacio de trabajo** solo lista los espacios de chat que tu proyecto ha conectado, así que **Microsoft Teams** aparece ahí en cuanto está conectado. Crea una regla, por ejemplo una que publique en un canal de Teams cuando se crea un incidente, y luego haz clic en **Probar regla** en su fila.
:::

> [!NOTE]
> Instalar OneUptime para ti, o añadirlo a un chat, es otra instalación y no le permite publicar en los canales de un equipo. Los **canales privados** necesitan la app añadida al propio canal: abre el canal > "..." > **Manage channel** > **Apps** > **Add an app**. Los **canales compartidos** no pueden recibir notificaciones: Microsoft Teams no admite bots en canales compartidos.

## Pedir a todos que conecten su cuenta

Nadie puede conectar la cuenta de Microsoft Teams de otra persona, ni siquiera un administrador: cada uno inicia sesión con la suya. Para incluir a todo un equipo, un **Propietario del proyecto** o **Administrador del proyecto** pide a todos a la vez que conecten su cuenta, en **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**. La tarjeta **Members' Microsoft Teams accounts** dice cuántos miembros han conectado su cuenta. Con **Ask everyone to connect**, el bot de OneUptime envía un mensaje a cada miembro que aún no lo ha hecho, con un botón **Connect Microsoft Teams account** que conecta su cuenta con un clic.

- **Quién recibe un mensaje.** Cada miembro del proyecto que no ha conectado su cuenta de Microsoft Teams y está en un equipo al que se ha añadido la app de OneUptime, encontrado allí por su dirección de correo electrónico o su nombre principal de usuario. A quien ya se le pidió en las últimas 24 horas no se le vuelve a pedir, así que volver a pedirlo al día siguiente solo se lo recuerda a quienes aún no han conectado su cuenta.
- **Qué dice la tarjeta.** Cuánto han avanzado los mensajes mientras se envían, y después quién lo pidió y cuántos miembros recibieron un mensaje. Los miembros que OneUptime no encontró aparecen con su nombre en la tarjeta: añade la app a su equipo, o pídeles que conecten su cuenta ellos mismos en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams**.
- **Qué conecta el botón.** La cuenta de Microsoft Teams de quien lo pulsa e inicia sesión, a su propia cuenta de OneUptime. Un mensaje reenviado a otra persona no conecta nada a la cuenta del miembro al que iba dirigido.

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
| **Condiciones** | A qué eventos se aplica la regla, por ejemplo por gravedad, estado, etiqueta, monitor o palabras del título. Se comprueban al crear un evento y de nuevo con cada actualización que OneUptime publica sobre él, así que una regla para incidentes reconocidos actúa cuando se reconoce un incidente. Una regla nueva se aplica a todos los eventos, por ejemplo **Todos los incidentes**. Para acotarla, elige **Solo los incidentes que cumplen las condiciones** y añade las condiciones. Con dos o más, **Condición de coincidencia** indica si deben coincidir todas o basta con una. |
| **Destino** | Dónde publica: en un canal existente de un equipo que elijas, en los chats que elijas, en un canal para cada incidente (o alerta, episodio, evento, monitor o política de guardia) creado en un equipo que elijas, o en varios de ellos a la vez. Bajo el paso, **Qué hace esta regla** lo dice en frases, como la tarjeta de la regla. |
| **Videollamada** | Solo incidentes y alertas: iniciar una llamada para cada uno. Consulta [Videollamadas](/docs/workspace-connections/video-calls). |

Un canal que crea la regla lleva el nombre de su registro: el incidente INC-42 recibe `inc-42`, la alerta ALT-7 recibe `alt-7` y, en un proyecto sin prefijos de número, el incidente 42 recibe `incident-42`. El texto de **Prefijo del nombre del canal** va delante, así que `prod-` da `prod-inc-42`, y el formulario muestra el nombre mientras escribes. En un evento de mantenimiento programado, el prefijo sustituye a su prefijo de número: SM-5 recibe `sm-5`, y `maint-` da `maint-5`. OneUptime conserva letras, números, espacios, `-` y `_`, hasta los 50 caracteres que admite Microsoft Teams. Si el equipo ya tiene un canal con ese nombre, como el de otro proyecto o uno eliminado en los últimos 30 días, OneUptime añade `-2`, `-3` y así sucesivamente.

Una regla crea su canal la primera vez que un evento la cumple: al crear el evento, o más tarde, cuando una actualización hace que la cumpla mientras sigue abierto. Una regla para incidentes reconocidos crea el canal cuando se reconoce el incidente. Microsoft Teams muestra los canales de un equipo a todos sus miembros, así que OneUptime no añade a nadie a un canal uno por uno: todos los miembros del equipo que elijas pueden abrirlo, como dice el formulario de la regla bajo **Quién se une al canal**. Un incidente, una alerta o un episodio privado recibe un canal privado, que solo ven sus miembros; añade personas en Microsoft Teams.

Para incluir a quien esté de guardia, elige sus programaciones de guardia bajo **Mencionar a quien esté de guardia**. Cuando se crea el canal, OneUptime publica en él un mensaje, justo después del primero del registro, que menciona con @ a quienes están de guardia en esas programaciones, para que Microsoft Teams les envíe una notificación. No se avisa a nadie. OneUptime encuentra a cada persona del equipo por la cuenta de Microsoft Teams que esa persona conectó a OneUptime, o si no, por su dirección de correo electrónico. Quien no está en el equipo no puede abrir sus canales, así que se le nombra en el mensaje en su lugar, con el motivo. En un canal privado, solo sus miembros pueden abrirlo, así que añade a las personas de guardia en Microsoft Teams.

Cada actualización posterior del registro — un cambio de estado, una nota, un nuevo propietario — se publica en sus canales, y en los canales y chats existentes que nombran sus reglas mientras se cumplan sus condiciones. OneUptime no puede archivar un canal de Microsoft Teams, así que el canal de una regla se queda cuando su registro termina; archívalo o elimínalo en Microsoft Teams.

Un incidente, una alerta, un episodio o un evento de mantenimiento programado con un canal propio tiene **Abrir en Microsoft Teams** en la cabecera de su página en OneUptime, junto a sus botones de estado. Abre ese canal en una pestaña nueva, en la aplicación de Microsoft Teams o en el navegador. Un registro con dos canales propios los lista a ambos bajo el botón. Un registro con canales tanto en Slack como en Microsoft Teams tiene en su lugar un único botón **Abrir canal**, que los lista todos. Los canales y chats existentes en los que publican tus reglas no se ofrecen.

La página del registro también tiene una tarjeta **Canal de Microsoft Teams**, que dice quién puede abrir el canal: todos los del equipo o, en un canal privado, sus miembros, a quienes añaden sus propietarios en Microsoft Teams. OneUptime no cambia quién está en un canal de Microsoft Teams. En un canal de Slack, la tarjeta muestra quién está en él y añade personas: consulta [Quién está en el canal de un registro](/docs/workspace-connections/slack#quién-está-en-el-canal-de-un-registro).

Los canales y chats siguen siendo legibles: cada evento se publica una vez, y el primer estado de un registro va en la tarjeta que anuncia el registro, no en una tarjeta aparte. Una ejecución de una política de guardia es una sola tarjeta que se edita a medida que la ejecución escala: a quién se avisó, cuántas veces y cómo, a quién no y por qué, y quién lo reconoció. Solo se publica una tarjeta nueva cuando alguien tiene que actuar: una regla de escalado no llegó a nadie, o la ejecución terminó sin que nadie lo reconociera. Que se avisó a los propietarios del registro o a los suscriptores de la página de estado queda en su feed en OneUptime.

**Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams** lista los canales que OneUptime ve en tus equipos, y los chats a los que se ha añadido, con **Enviar prueba** junto a cada uno. Un chat aparece en cuanto se añade a él la app de OneUptime en Microsoft Teams; **Actualizar chats** recoge los chats nuevos y sus nombres actuales.

## Probar una regla

**Probar regla** en la fila de una regla publica un mensaje de prueba de esa regla en los canales que nombra, para que lo veas llegar. Si la regla crea un canal para cada evento, la prueba también crea uno e invita a las personas de la regla.

Como **Enviar prueba** junto a un canal en **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**, necesita permiso para crear reglas de notificación: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de ajustes**, **Miembro de ajustes**, o **Create Workspace Notification Rule** y **Read Workspace Notification Rule** en un rol personalizado. Para alguien que solo puede ver las reglas, como un **Visor**, **Probar regla** está bloqueado, y su descripción emergente dice lo que hace falta; la API rechaza su prueba con "You do not have permission to send test notifications in this project." En OneUptime Cloud, probar una regla requiere el plan **Growth**, igual que añadir una.

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
| 📣 o 📢 | Una nota pública, mostrada en la página de estado. Solo incidentes y eventos de mantenimiento programado. En un incidente privado, una nota privada, y la confirmación dice por qué. |

La nota conserva el mensaje tal como lo mostraba Microsoft Teams: su formato, sus enlaces y su código, las personas que menciona por su nombre, y sus archivos e imágenes como enlaces a ellos. Una nota pública deja fuera los archivos y las imágenes, ya que solo se abren para tu equipo.

Son las palabras de quien escribió el mensaje: su nombre de OneUptime si su cuenta de Microsoft Teams está conectada y, si no, el nombre que muestra Teams. Una nota privada se coloca en la cronología en el momento en que se publicó el mensaje, por mucho después que se guarde. Una nota pública se coloca cuando se guarda, que es cuando la muestra la página de estado. La cronología dice quién la guardó. La nota no se vuelve a publicar en el canal, donde el mensaje ya está.

La nota se guarda como tú, con tus permisos, y la app de OneUptime debe estar en el equipo. Si tu cuenta de Microsoft Teams aún no está conectada, OneUptime te pide que la conectes, en una respuesta que te menciona, con un botón que guarda el mensaje en cuanto lo hagas.

## Hablar con el bot de OneUptime

Escribe al bot en un chat personal, o menciona a OneUptime con @ en un canal o un chat de grupo: allí solo responde cuando se le menciona.

| Mensaje | Lo que hace el bot |
| --- | --- |
| `help` | Lista lo que puede hacer. |
| `incident [title or number]` | Abre el formulario de incidente, con el título rellenado. El número de un incidente, como `42` o `INC-42`, muestra en cambio ese incidente: consulta [Gestionar un incidente desde Microsoft Teams](#gestionar-un-incidente-desde-microsoft-teams). |
| `maintenance [title]` | Abre el formulario de mantenimiento programado, con el título rellenado. |
| `oncall` | Lista quién está de guardia ahora mismo en cada programación de guardia que puedes ver, hasta cuándo y quién va después. |
| `page [who] [message]` | Avisa a las personas que mencionas con @ sobre tu mensaje, o envía una tarjeta para elegir a quién avisar. Consulta [Avisar a alguien desde Microsoft Teams](#avisar-a-alguien-desde-microsoft-teams). |
| `ask [question]`, o cualquier pregunta en lenguaje natural | OneUptime AI responde sobre tus registros, trazas, métricas, incidentes y monitores, por ejemplo "¿Qué monitores están caídos ahora mismo?". Las respuestas solo leen. |
| `show active incidents`, `show active alerts` | Lista lo que está abierto ahora. |
| `show scheduled maintenance`, `show ongoing maintenance` | Lista los eventos de mantenimiento próximos, o en curso. |

Salvo las listas `show`, son las palabras que van después de `/oneuptime` en Slack; `create incident` y `create maintenance` siguen funcionando. Preguntar a OneUptime AI requiere tu propia cuenta de Microsoft Teams conectada y la IA activada para el proyecto. Si la tuya no está conectada, el bot te pide una vez en cada hilo o chat que la conectes, con un botón **Connect Microsoft Teams account**. Consulta [Preguntar a la IA](/docs/ai/ask-ai).

## Tu inicio en Microsoft Teams

Escribe `home` al bot de OneUptime y te responde con tu inicio: una tarjeta con lo que pasa en el proyecto, tal como puedes verlo.

- **Tu guardia.** Las programaciones de guardia en las que estás de guardia ahora, y hasta cuándo, o si no tu próximo turno.
- **Lo que está abierto.** Los incidentes y alertas abiertos más recientes que puedes leer, cada uno con un enlace a su página en OneUptime.
- **Sus botones.** **Declare incident** y **Page someone** responden como `incident` y `page`, **Who's on call** como `oncall`, y **Refresh** vuelve a leer la tarjeta, en su sitio.

Cuando añades la aplicación OneUptime para ti, el bot te envía tu inicio enseguida. El inicio y las listas `show` leen como tú, así que necesitan tu propia cuenta de Microsoft Teams conectada: mientras no lo esté, el bot responde con un botón **Connect Microsoft Teams account**. **Abrir OneUptime en Microsoft Teams**, en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams**, abre la aplicación en Teams.

Cuando la aplicación se añade a un equipo, el bot saluda allí: cómo hacerle una pregunta y dónde añadir una regla de notificación que publique en los canales del equipo.

## Crear incidentes y mantenimientos desde Microsoft Teams

Escribir `incident` o `maintenance` al bot de OneUptime abre un formulario para la persona que lo escribió, en un chat personal, un canal o un chat de grupo por igual. Se rellena como esa persona: como la cuenta de OneUptime a la que está conectada su cuenta de Microsoft Teams (consulta [Conectar Microsoft Teams](#conectar-microsoft-teams)), con los permisos de esa cuenta en el proyecto. A quien no tiene la cuenta conectada, o cuya cuenta de OneUptime ya no es miembro del proyecto, se le dice qué hacer en una respuesta que lo menciona, en lugar de recibir el formulario.

- **Quién puede usarlos.** Las personas que pueden declarar un incidente o crear un evento de mantenimiento programado en OneUptime: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes** para un incidente (**Create Incident** en un rol personalizado), y **Administrador de mantenimiento programado** y **Miembro de mantenimiento programado** para un evento (**Create Scheduled Maintenance**). A cualquier otra persona se le avisa, y no recibe formulario.
- **Qué ofrece un formulario.** Cada lista — gravedades, monitores, estados de monitor, políticas de guardia y etiquetas — contiene lo que puede leer la persona que lo pidió, igual que la misma lista en OneUptime, y las notas "not shown" de la tarjeta solo cuentan esos: con un rol limitado a algunas etiquetas, los monitores y las políticas de guardia que llevan esas etiquetas. Una lista que no puede leer en absoluto se omite. Las políticas de guardia archivadas nunca se ofrecen.
- **Qué puede nombrar un formulario.** En un canal o un chat de grupo, cualquiera de los presentes puede enviar el formulario, y se envía como quien lo hace, con sus propios permisos. El incidente o el evento se crea con esos permisos y se atribuye a esa persona. Un monitor, una política de guardia, una etiqueta, una gravedad o un estado que no puede leer, o uno de otro proyecto, se rechaza como uno que el proyecto no tiene, y no se crea nada: el bot responde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** en un incidente, una alerta o un episodio funciona igual: necesita permiso para ejecutar una política de guardia (**Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de guardias** y **Miembro de guardias**, o **Create On-Call Duty Policy Execution Log** en un rol personalizado) y para leer ese incidente, alerta o episodio, y ofrece las políticas de guardia activas que la persona puede leer. Ver un monitor o una política de guardia desde una tarjeta también lo lee como la persona que pulsó el botón.

## Avisar a alguien desde Microsoft Teams

En un canal o un chat de grupo, `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` avisa a Nawaz de inmediato. OneUptime crea una alerta cuyo título es tu mensaje, y cada persona que mencionas con @ recibe una llamada, un SMS, una notificación push o un correo electrónico, según sus propias reglas de guardia, hasta que alguien reconoce la alerta.

- **A quién se avisa de inmediato.** A las personas que mencionas con @, y a quienes están de guardia en las programaciones que sigue una etiqueta que mencionas con @ (consulta [Etiquetas de guardia](#etiquetas-de-guardia)), cuando un mensaje las sigue. OneUptime identifica a una persona por la cuenta de OneUptime a la que está conectada su cuenta de Microsoft Teams, o si no, por su dirección de correo electrónico en Microsoft Teams. Nunca se avisa a nadie de fuera del proyecto.
- **Todo lo demás recibe una tarjeta.** Sin nadie mencionado con @, como en un chat personal con el bot, sin mensaje, con una etiqueta que no sigue ninguna programación de guardia que puedas ver, o con una persona que OneUptime no puede identificar, el bot responde con la tarjeta **Page someone**, con lo que escribiste ya rellenado, y dice a quién no pudo elegir. Elige personas, un equipo, una programación de guardia, que avisa a quien esté de guardia en ella ahora, o una política de guardia, que avisa mediante sus reglas de escalado, y envíala. Cualquiera en la conversación puede enviar la tarjeta, en su propio nombre. Una vez que ha avisado, la tarjeta se elimina, para que nadie avise con ella dos veces.
- **Dónde se muestra.** La conversación muestra el aviso como una sola tarjeta, que se mantiene al día: a quién se avisó y cómo, y quién lo reconoció. Donde el bot no puede publicarla, su respuesta dice a quién se avisó, con un enlace a la alerta.
- **Quién puede avisar.** Quien pueda tanto ejecutar una política de guardia como crear una alerta: **Propietario del proyecto**, **Administrador del proyecto** y **Miembro del proyecto**, o **Miembro de guardias** junto con **Miembro de alertas** (**Create On-Call Duty Policy Execution Log** y **Create Alert** en un rol personalizado). Avisar directamente a personas, a un equipo o a una programación, sin una política de guardia detrás del aviso, requiere además acceso a todas las políticas de guardia del proyecto. A cualquier otra persona se le indica en una respuesta, y no se avisa a nadie. En OneUptime Cloud, avisar requiere el plan Growth: por debajo de él, OneUptime indica el plan que necesita, y no se avisa a nadie.

## Etiquetas de guardia

Mantén una etiqueta de Microsoft Teams, como `@Payments on-call`, igual a quienes están de guardia en una o varias programaciones de guardia, para que cualquiera de su equipo pueda mencionarla con @ y llegar a ellos. OneUptime cambia los miembros de la etiqueta en cada relevo y cada sustitución, y la comprueba cada 15 minutos.

:::steps
### Conectar una etiqueta a una programación

Abre la programación en **Guardia** > **Programaciones de guardia**. En su tarjeta **Etiquetas de Microsoft Teams**, haz clic en **Conectar etiqueta**, elige el equipo y escribe el nombre de la etiqueta: la etiqueta del equipo con ese nombre, o una nueva que crea OneUptime. Sus miembros se sustituyen al instante por quienes están de guardia.

### Conectarla también a la programación secundaria

Para una etiqueta que tenga a la guardia principal y a la secundaria, conecta la misma etiqueta en la página de la programación secundaria. Una etiqueta puede seguir cualquier número de programaciones.
:::

- **Qué muestra la tarjeta.** Quién está ahora en cada etiqueta, su equipo, las otras programaciones que sigue y si está **Al día**. Una etiqueta solo incluye a miembros de su equipo: quien está de guardia pero no está en el equipo aparece con el motivo.
- **Nadie de guardia.** OneUptime saca a todos de la etiqueta hasta que alguien esté de guardia. Una etiqueta nueva necesita a alguien del equipo de guardia, porque Microsoft Teams no crea etiquetas vacías.
- **Avisar a la etiqueta.** `@OneUptime page @Payments on-call The checkout API is down` avisa a quienes están de guardia en las programaciones que sigue la etiqueta. Consulta [Avisar a alguien desde Microsoft Teams](#avisar-a-alguien-desde-microsoft-teams).
- **Qué necesita Microsoft 365.** Cambiar etiquetas requiere el permiso `TeamworkTag.ReadWrite.All` de la aplicación, que un administrador de Microsoft 365 concede con **Conceder consentimiento de administrador** en **Ajustes del proyecto** > **Espacio de trabajo** > **Microsoft Teams**. Si tu organización dio su consentimiento antes de que OneUptime pudiera mantener etiquetas, vuelve a darlo una vez.
- **Quién puede conectar una.** Los roles que pueden editar programaciones: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de guardias** y **Miembro de guardias**, o **Edit On-Call Duty Policy Schedule** en un rol personalizado. En OneUptime Cloud, conectar una requiere el plan **Growth**.
- **Desconectar.** OneUptime deja de cambiar la etiqueta. La etiqueta y sus miembros se quedan en Microsoft Teams tal como están.

## Gestionar un incidente desde Microsoft Teams

La tarjeta de un incidente tiene cuatro botones, **Acknowledge Incident**, **Resolve Incident**, **Add Note** y **View Incident**, y el resto en su menú, el botón de tres puntos:

| Elemento del menú | Qué hace |
| --- | --- |
| **Change Severity** | Establece la gravedad del incidente. |
| **Change Incident State** | Pasa el incidente a un estado posterior. |
| **Assign Role** | Da a alguien un rol en el incidente, como **Incident Commander**. Un rol para una sola persona pasa a esa persona. |
| **Page Someone** | Avisa a personas, a un equipo, a quien esté de guardia en una programación o a una política de guardia sobre el incidente, hasta que alguien lo reconozca. |
| **Edit Custom Fields** | Establece los campos personalizados del incidente, cada uno rellenado con lo que tiene el incidente. Un campo que se deja vacío se borra. |

`incident 42`, escrito al bot, responde con el incidente 42, estos botones y su menú. Escribe el número como lo muestra OneUptime: `42`, `#42` o `INC-42`. En el canal propio de un incidente, `incident` sin nada más muestra ese incidente.

- **Quién puede usarlos.** Las personas que pueden hacer el mismo cambio en OneUptime, como en Slack: consulta [Gestionar un incidente desde Slack](/docs/workspace-connections/slack#gestionar-un-incidente-desde-slack). Cada elemento responde con una tarjeta, rellenada como la persona que lo pulsó puede ver el incidente. Cualquiera en la conversación puede enviar la tarjeta, como sí mismo, con sus propios permisos.
- **Qué pasa.** El cambio se hace como la persona que envió la tarjeta, como en OneUptime, y el feed del incidente dice qué cambió. El bot lo dice en una respuesta que la menciona, y quita la tarjeta, para que nadie la envíe dos veces. **Page Someone** dice a quién se avisó, o por qué no se avisó a nadie; un incidente que ya está resuelto no avisa a nadie.
- **En qué se diferencia Microsoft Teams.** Una tarjeta no puede decir qué está mal debajo de un campo: un valor que no encaja se indica en una respuesta, y la tarjeta se queda para corregirla y enviarla de nuevo. Un campo de fecha y hora es un día y una hora, en tu propia zona horaria. Un cliente de Teams antiguo muestra el menú como más botones. `incident 42` responde en la conversación, donde todos los que están en ella pueden ver el incidente.
- **Tarjetas publicadas antes del menú.** Conservan su botón **Execute On-Call Policy**, y sigue funcionando: **Page Someone** también avisa a una política de guardia. Las alertas y los episodios conservan el suyo.

## Actuar sobre incidentes, alertas y eventos desde Microsoft Teams

Los botones de las tarjetas de OneUptime actúan como la persona que los pulsa, en un chat personal, un canal o un chat de grupo por igual: como la cuenta de OneUptime a la que está conectada su cuenta de Microsoft Teams, con los permisos de esa cuenta en el proyecto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** y **Execute On-Call Policy** en un incidente, una alerta o un episodio, y **Mark as Ongoing**, **Mark as Complete**, **Change State** y **Add Note** en un evento de mantenimiento programado, hacen cada uno el cambio que hace la misma acción en OneUptime, y se atribuye allí a esa persona: la línea de tiempo de estados y el feed del registro muestran quién cambió su estado, y la nota es suya. Una nota guardada desde un mensaje con una reacción se publica del mismo modo.

- **Quién puede usarlos.** Las personas que pueden hacer el mismo cambio en OneUptime. Reconocer, resolver o cambiar el estado de un incidente necesita permiso para cambiar su estado: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes**, o **Create Incident State Timeline** en un rol personalizado. Una alerta, un episodio o un evento de mantenimiento programado necesita el mismo permiso para su propio tipo (**Create Alert State Timeline**, por ejemplo), y una nota necesita permiso para publicar ese tipo de nota. Como el panel de estado de OneUptime, no piden permiso para editar el incidente o la alerta en sí. A cualquier otra persona se le avisa, y nada cambia.
- **Qué registros.** Los que la persona puede leer, como en OneUptime: con un rol limitado a algunas etiquetas, los incidentes, alertas, episodios y eventos que las llevan. Un botón en cualquier otro registro dice por qué, y nada cambia: en un incidente al que no llega su rol, "your access in this project does not include this incident. Ask a project admin for access to it."; en un incidente privado del que no es responsable, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; y en uno eliminado desde entonces, "the incident was not found. It may have been deleted." En OneUptime Cloud, un cambio que el plan del proyecto no incluye se rechaza indicando el plan que necesita.
- **Qué ofrece Change State.** Los estados que la persona puede leer y a los que el registro puede pasar a continuación, en el orden del proyecto: ninguno anterior al estado en que está, tanto para un episodio como para un incidente, una alerta o un evento de mantenimiento programado, ya que un cambio de estado nunca hace subir un registro en su lista (consulta [El orden es una restricción real, no una preferencia de visualización](/docs/incidents/states-and-severities#el-orden-es-una-restricción-real-no-una-preferencia-de-visualización)). Si no puede leer ninguno, el bot dice "No incident states are available to you in this project. Ask a project admin for access to them."; si el registro está en el último estado que puede alcanzar, dice "There is no later state to move this incident to." Ninguno de los dos muestra una tarjeta vacía.
- **Add Note en un incidente privado.** Un incidente privado no admite notas públicas, así que su tarjeta no pide tipo de nota y añade una nota privada. Una tarjeta enviada antes de que se hiciera privado también añade una nota privada, y lo dice. Consulta [Los incidentes privados solo admiten notas privadas](/docs/incidents/notes-owners-and-feed#los-incidentes-privados-solo-admiten-notas-privadas).
- **Escalate.** **Escalate** en una tarjeta ejecuta su política de guardia para el incidente, la alerta o el episodio del que trata la tarjeta, como la persona que lo pulsó, con los mismos permisos que **Execute On-Call Policy**. Una tarjeta que no trata de ninguno de ellos recibe como respuesta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", y no se avisa a nadie.
- **Dónde recibe la respuesta.** En una respuesta en la misma conversación, el hilo de la tarjeta en un canal, que menciona a la persona, para que Microsoft Teams le avise. Un botón pulsado demasiado tarde dice quién llegó primero, y cuándo, por ejemplo "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Si su cuenta no está conectada.** La respuesta le pide conectarla, con un botón **Connect Microsoft Teams account**. El botón abre sus propios ajustes de Microsoft Teams en OneUptime y conecta su cuenta en un solo paso, después de iniciar sesión en OneUptime si hace falta. Después, OneUptime termina lo que pulsó, como esa persona, y responde en la misma conversación; para un botón que abre un formulario, o un comando, le pide que lo pulse o lo escriba de nuevo. El botón funciona una vez, durante 30 minutos, y solo para la cuenta de Microsoft que lo pulsó.

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
Pulsa **Connect Microsoft Teams account** en la respuesta del bot para conectarla en un solo paso, o vincúlala en **Ajustes de usuario** > **Espacio de trabajo** > **Microsoft Teams** con **Connect my account with Microsoft Teams**. En ambos casos inicias sesión en la organización a la que está conectado el proyecto, como invitado si lo eres allí. Si eres invitado y antes conectaste la cuenta de tu propia organización, vuelve a conectarla.
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
