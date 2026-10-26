# Slack

Conecta OneUptime con Slack para publicar en tus canales los incidentes, alertas, episodios, mantenimientos programados, monitores y novedades de guardia, dar a cada incidente un canal propio y dejar que los respondedores actúen sin salir de Slack: reconocer, resolver, añadir notas, avisar a la guardia y declarar incidentes.

:::cards
- [Conectar Slack](#conectar-slack): Instala OneUptime en tu espacio de trabajo y luego vincula tu propia cuenta.
- [Pedir a todos que conecten su cuenta](#pedir-a-todos-que-conecten-su-cuenta): Escribe de una sola vez a todos los miembros que aún no han conectado su cuenta.
- [Reglas de notificación](#reglas-de-notificación): Decide qué eventos se publican dónde, y cuáles tienen un canal propio.
- [Quién está en el canal de un registro](#quién-está-en-el-canal-de-un-registro): Mira quién está en él, únete y añade personas, desde la página del registro.
- [El comando /oneuptime](#el-comando-oneuptime): Declara incidentes, programa mantenimientos, mira quién está de guardia y pregunta a la IA.
- [Grupos de usuarios de guardia](#grupos-de-usuarios-de-guardia): Mantén un grupo de usuarios igual a quienes están de guardia, y avísalo.
- [Actuar sobre incidentes, alertas y eventos desde Slack](#actuar-sobre-incidentes-alertas-y-eventos-desde-slack): Los botones de los mensajes de OneUptime.
:::

## Cómo funciona

```mermaid title="De un evento en OneUptime a un mensaje en Slack"
flowchart TB
    event["Un incidente, una alerta o un evento<br/>se crea o cambia"] --> rules{"Reglas de notificación<br/>cuyas condiciones coinciden"}
    rules -->|"Un canal<br/>para cada uno"| own["Un canal propio,<br/>con su gente invitada a medida que se suma"]
    rules -->|"Publicar en canales existentes"| existing["Tus canales existentes"]
    own --> message["Un mensaje con botones"]
    existing --> message
    message -->|"Un respondedor pulsa uno"| change["El cambio se hace en OneUptime,<br/>como esa persona"]
```

Dos conexiones lo hacen posible:

- **La conexión del proyecto**, hecha una vez: la app de OneUptime instalada en tu espacio de trabajo de Slack. Publica los mensajes, crea los canales e invita a las personas.
- **La conexión propia de cada persona**: su cuenta de Slack vinculada a su cuenta de OneUptime. Los botones, los comandos y las reacciones con emoji actúan como esa persona, con sus permisos en el proyecto.

Un espacio de trabajo de Slack puede estar conectado a más de un proyecto, como producción y staging. Un botón o un formulario actúa en el proyecto del registro al que se refiere. Un comando o un mensaje a OneUptime actúa en el proyecto del canal en el que está, como el canal de un incidente, o si no, en el único proyecto en el que está conectada tu cuenta de Slack. Cuando nada lo indica, OneUptime nombra los proyectos en los que estás y te pide que lo intentes de nuevo desde un canal del proyecto al que te refieres.

## Antes de empezar

- **Un rol que pueda conectar el proyecto:** **Propietario del proyecto**, **Administrador del proyecto** o **Miembro del proyecto**. Desinstalar la app requiere **Propietario del proyecto** o **Administrador del proyecto**.
- **Un espacio de trabajo de Slack** donde puedas instalar apps.
- **El plan Growth en OneUptime Cloud** para las reglas de notificación y los resúmenes. Consulta [Reglas de notificación por debajo del plan Growth](#reglas-de-notificación-por-debajo-del-plan-growth).
- **En un servidor autoalojado,** antes una app de Slack configurada para él. Consulta [Integración con Slack](/docs/self-hosted/slack-integration).

## Conectar Slack

:::steps
### Instalar OneUptime en tu espacio de trabajo de Slack

Ve a **Ajustes del proyecto** > **Espacio de trabajo** > **Slack** y haz clic en **Conectar con Slack**. Elige el espacio de trabajo y autoriza a OneUptime. Slack te devuelve a la misma página, que ahora nombra el espacio de trabajo al que está conectado el proyecto. Mientras no haya ningún espacio de trabajo conectado, la sección **Espacio de trabajo** de los menús Incidentes, Alertas, Mantenimiento programado, Monitores y Guardia contiene **Conectar Slack o Teams**, que también lleva aquí.

### Conectar tu propia cuenta de Slack

Instalar la app vincula la cuenta de quien la instaló. Todos los demás vinculan su propia cuenta de Slack en **Ajustes de usuario** > **Espacio de trabajo** > **Slack** con **Connect my account with Slack**, para actuar sobre los incidentes y recibir mensajes directos como ellos mismos. Esa sección aparece en cuanto el proyecto está conectado a Slack. Para incluir a todo un equipo de una vez, consulta [Pedir a todos que conecten su cuenta](#pedir-a-todos-que-conecten-su-cuenta).

### Añadir una regla de notificación

Ve a **Incidentes** > **Espacio de trabajo** > **Slack**. La sección **Espacio de trabajo** solo lista los espacios de chat que tu proyecto ha conectado, así que **Slack** aparece ahí en cuanto está conectado. Crea una regla, por ejemplo una que cree un canal de Slack para cada incidente nuevo con todos los que trabajan en él: las personas avisadas, el comandante de incidente y los propietarios. Consulta [Reglas de notificación](#reglas-de-notificación).

### Probar la regla

Haz clic en **Probar regla** en la fila de la regla. Llega un mensaje de prueba a los canales que nombra la regla. Consulta [Probar una regla](#probar-una-regla).
:::

## Pedir a todos que conecten su cuenta

Nadie puede conectar la cuenta de Slack de otra persona, ni siquiera un administrador: cada uno inicia sesión con la suya. Para incluir a todo un equipo, un **Propietario del proyecto** o **Administrador del proyecto** pide a todos a la vez que conecten su cuenta, en **Ajustes del proyecto** > **Espacio de trabajo** > **Slack**. La tarjeta **Members' Slack accounts** dice cuántos miembros han conectado su cuenta. **Ask everyone to connect** envía a cada miembro que aún no lo ha hecho un mensaje directo de OneUptime en Slack, con un botón **Connect Slack account** que conecta su cuenta con un clic.

- **Quién recibe un mensaje.** Cada miembro del proyecto que no ha conectado su cuenta de Slack, encontrado en Slack por su dirección de correo electrónico. A quien ya se le pidió en las últimas 24 horas no se le vuelve a pedir, así que volver a pedirlo al día siguiente solo se lo recuerda a quienes aún no han conectado su cuenta.
- **Qué dice la tarjeta.** Cuánto han avanzado los mensajes mientras se envían, y después quién lo pidió y cuántos miembros recibieron un mensaje. Los miembros que OneUptime no encontró en Slack por su dirección de correo electrónico aparecen con su nombre en la tarjeta: ellos mismos conectan su cuenta en **Ajustes de usuario** > **Espacio de trabajo** > **Slack**.
- **Qué conecta el botón.** La cuenta de Slack de quien lo pulsa e inicia sesión, a su propia cuenta de OneUptime. Un mensaje reenviado a otra persona no conecta nada a la cuenta del miembro al que iba dirigido.

## Reglas de notificación

Una regla de notificación indica qué eventos se publican en Slack, y dónde. Cada producto tiene sus propias reglas, en **Espacio de trabajo** > **Slack** de su menú:

| Producto | Pestañas de su página **Slack** |
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
| **Destino** | Dónde publica: **Publicar en canales existentes** con los nombres de los canales, **Crear un canal para cada incidente** (o alerta, episodio, evento, monitor o política de guardia) con quién se une a él, o ambos. Bajo el paso, **Qué hace esta regla** lo dice en frases, como la tarjeta de la regla. |
| **Videollamada** | Solo incidentes y alertas: iniciar una llamada para cada uno. Consulta [Videollamadas](/docs/workspace-connections/video-calls). |

Un canal que crea la regla lleva el nombre de su registro: el incidente INC-42 recibe `inc-42`, la alerta ALT-7 recibe `alt-7` y, en un proyecto sin prefijos de número, el incidente 42 recibe `incident-42`. El texto de **Prefijo del nombre del canal** va delante, así que `prod-` da `prod-inc-42`, y el formulario muestra el nombre mientras escribes. En un evento de mantenimiento programado, el prefijo sustituye a su prefijo de número: SM-5 recibe `sm-5`, y `maint-` da `maint-5`. Slack admite letras minúsculas, números, `-` y `_`, hasta 80 caracteres. Si ya existe un canal con ese nombre, como el de otro proyecto o uno archivado, OneUptime añade `-2`, `-3` y así sucesivamente.

Una regla crea su canal la primera vez que un evento la cumple: al crear el evento, o más tarde, cuando una actualización hace que la cumpla mientras sigue abierto. Una regla para incidentes reconocidos crea el canal cuando se reconoce el incidente. Un incidente, una alerta o un episodio privado recibe un canal privado.

**Quién se une al canal** lista a quién añade la regla a su canal, a cada uno a medida que se suma al registro, no solo al crear el canal: **Personas de guardia, a medida que se les avisa**, **Comandante de incidente y otros roles de incidente, a medida que se asignan** (incidentes y episodios de incidente) y **Propietarios, a medida que se añaden**, todos marcados en una regla nueva, y las personas, equipos y programaciones de guardia de **Invitar también** al crear el canal. El comandante de incidente suele asignarse cuando alguien reconoce el incidente por primera vez, y se une a su canal entonces. Una regla guardada antes de que los roles de incidente tuvieran su propia casilla los añade cuando añade a los propietarios o a las personas de guardia, y su casilla aparece marcada. Un canal existente en el que publica una regla no recibe a nadie.

Para una programación de guardia de **Invitar también**, quien esté de guardia en ella cuando se crea el canal se une, tal como lo muestra la página de la programación, y no se le avisa. Para añadir personas solo a los canales de algunos incidentes, da a una segunda regla esas condiciones y esas personas, con el mismo **Prefijo del nombre del canal** que la primera: las reglas que un incidente cumple cuando se crea su canal comparten ese canal, y cada una añade a sus propias personas.

Cada actualización posterior del registro — un cambio de estado, una nota, un nuevo propietario — se publica en sus canales, y en los canales existentes que nombran sus reglas mientras se cumplan sus condiciones. Con **Archivar el canal cuando se resuelva el incidente** activado, o su equivalente para alertas, episodios, eventos, monitores y políticas de guardia, la regla que creó un canal lo archiva cuando el registro se resuelve, se completa o se elimina, digan lo que digan entonces sus condiciones. Un incidente, una alerta o un episodio creado ya resuelto no recibe canal propio; su mensaje de creación igualmente va a los canales que nombran tus reglas. Consulta [Declarado ya reconocido o resuelto](/docs/incidents/declaring-incidents#declarado-ya-reconocido-o-resuelto).

Un incidente, una alerta, un episodio o un evento de mantenimiento programado con un canal propio tiene **Abrir en Slack** en la cabecera de su página en OneUptime, junto a sus botones de estado. Abre ese canal en una pestaña nueva, en la aplicación de Slack o en el navegador. Un registro con dos canales propios los lista a ambos bajo el botón. Un registro con canales tanto en Slack como en Microsoft Teams tiene en su lugar un único botón **Abrir canal**, que los lista todos. Los canales existentes en los que publican tus reglas no se ofrecen.

Un canal sigue siendo legible: cada evento se publica una vez, y el primer estado de un registro va en el mensaje que anuncia el registro, no en un mensaje aparte. Una ejecución de una política de guardia es un solo mensaje que se edita a medida que la ejecución escala: a quién se avisó, cuántas veces y cómo, a quién no y por qué, y quién lo reconoció. Solo se publica un mensaje nuevo cuando alguien tiene que actuar: una regla de escalado no llegó a nadie, o la ejecución terminó sin que nadie lo reconociera. A alguien cuya cuenta de Slack no está conectada a OneUptime se le añade mediante la cuenta de Slack que tiene su dirección de correo electrónico. A quien OneUptime no encuentra de ninguna de las dos maneras, o a un invitado de Slack, no se le puede añadir a un canal; OneUptime lo dice una vez por canal, en un solo mensaje que los nombra a todos y se edita cuando la lista crece. Envíales el enlace **Connect Slack account** de ese mensaje para que conecten su cuenta en un solo paso. Que se avisó a los propietarios del registro o a los suscriptores de la página de estado queda en su feed en OneUptime.

**Ajustes del proyecto** > **Espacio de trabajo** > **Slack** lista los canales que OneUptime ve, con **Enviar prueba** junto a cada uno. OneUptime se une por sí mismo a un canal público la primera vez que publica en él. Un canal privado solo aparece en la lista, y solo puede recibir publicaciones, después de invitar a la app de OneUptime en Slack.

## Quién está en el canal de un registro

Un incidente, una alerta, un episodio o un evento de mantenimiento programado con un canal de Slack propio tiene una tarjeta **Canal de Slack** en su página de OneUptime. La tarjeta muestra el canal, como un enlace que lo abre en Slack, si es privado y quién está en él, tú primero. Desde la tarjeta, sin un administrador de Slack:

- **Unirse al canal** te añade, cuando no estás en el canal.
- **Añadir personas** abre una lista de las personas y los equipos del proyecto: elige una persona para añadirla, o un equipo para añadir a todos sus miembros.

La app de OneUptime los añade, igual que añade a las personas del canal de una regla. La app se queda en los canales que crea, así que esto también funciona con un canal privado que todos han abandonado.

- **Quién puede añadir personas.** Quien puede editar el registro: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes** para un incidente, o **Edit Incident** en un rol personalizado, y el mismo permiso para una alerta, un episodio o un evento (**Edit Alert**, por ejemplo). Los demás ven quién está en el canal y cómo entrar.
- **A quién se puede añadir.** A alguien que OneUptime encuentre en Slack: por la cuenta de Slack que conectó, o si no, por la dirección de correo electrónico que Slack tiene de esa persona. La tarjeta nombra a quien no pudo añadir, y por qué, como un invitado al que Slack deja fuera del canal.
- **Qué queda registrado.** A quién se añadió, y quién lo hizo, en el feed del registro (**Miembro añadido al canal**) y en **Ajustes del proyecto** > **Notificaciones** > **Registros de notificación**, en la pestaña **Espacio de trabajo**.
- **Sacar a alguien.** OneUptime solo añade personas: saca a alguien del canal en Slack.

## Probar una regla

**Probar regla** en la fila de una regla publica un mensaje de prueba de esa regla en los canales que nombra, para que lo veas llegar. Si la regla crea un canal para cada evento, la prueba también crea uno e invita a las personas de la regla.

Como **Enviar prueba** junto a un canal en **Ajustes del proyecto** > **Espacio de trabajo** > **Slack**, necesita permiso para crear reglas de notificación: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de ajustes**, **Miembro de ajustes**, o **Create Workspace Notification Rule** y **Read Workspace Notification Rule** en un rol personalizado. Para alguien que solo puede ver las reglas, como un **Visor**, **Probar regla** está bloqueado, y su descripción emergente dice lo que hace falta; la API rechaza su prueba con "You do not have permission to send test notifications in this project." En OneUptime Cloud, probar una regla requiere el plan **Growth**, igual que añadir una.

En OneUptime Cloud, **Enviar prueba** junto a un canal también requiere el plan **Growth**, porque publicar en un canal es lo que hacen las reglas y los resúmenes. **Enviar prueba ahora** en un resumen necesita permiso para crear resúmenes (**Create Workspace Notification Summary** y **Read Workspace Notification Summary** en un rol personalizado) y, en OneUptime Cloud, el plan **Growth**; para cualquier otra persona está bloqueado, y su descripción emergente dice lo que hace falta. Un cliente MCP conectado con acceso de solo lectura no puede enviar ninguna prueba.

## Resúmenes

La pestaña **Resumen** de **Incidentes** > **Espacio de trabajo** > **Slack** (y de **Alertas**) publica un resumen periódico en los canales que nombres: cuántos incidentes o alertas hubo, qué tan rápido se reconocieron y resolvieron, y una lista con enlaces. Un resumen nuevo sale cada semana y cubre los últimos 7 días. Deja **Enviar el primer informe a las** vacío y el primero sale a las 09:00 al comienzo de la semana, el día o el mes siguiente; el formulario dice cuándo.

Un resumen sale según el reloj de su **Zona horaria**, que empieza en la tuya. Mantiene allí su hora del día todo el año: uno configurado para las 09:00 en Berlín sigue saliendo a las 09:00 en Berlín después del cambio de horario de verano, y las fechas de su mensaje también son las de Berlín. Mediante la API, envía `timezone` como nombre de zona horaria IANA, como `Europe/Berlin`. Un resumen creado sin zona horaria toma la del perfil de quien lo creó, o UTC cuando lo crea una clave de API.

El formulario de un resumen tiene cuatro pasos: **Información básica** (su nombre y los canales), **Programación**, **Contenido** (**Qué incluir**) y **Filtros** (qué incidentes o alertas cuenta).

## Reglas de notificación por debajo del plan Growth

En OneUptime Cloud, las reglas de notificación y los resúmenes están en el plan **Growth** y superiores. Un proyecto por debajo conserva las reglas y los resúmenes que ya tiene, y siguen publicando en Slack. Por eso la página **Slack** de cada producto (Incidentes, Alertas, Mantenimiento programado, Guardia, Monitores) muestra la nota del plan con ellos debajo (**Reglas de notificación aún configuradas**, **Resúmenes aún configurados**): elimina una regla, o desactiva o elimina un resumen. Añadir o cambiar reglas y resúmenes requiere **Growth**.

## Recibir avisos en Slack

Para recibir avisos por mensaje directo cuando estás de guardia, añade Slack como uno de tus métodos de notificación:

:::steps
1. Conecta tu propia cuenta de Slack (consulta [Conectar Slack](#conectar-slack)).
2. Ve a **Ajustes de usuario** > **Métodos de notificación**, abre la pestaña **Workspace Apps** y haz clic en **Añadir cuenta de Slack**.
3. Haz clic en **Enviar mensaje de prueba** en su fila. El mensaje llega a tus mensajes directos de Slack.
:::

Al añadirlo, entra de inmediato en tus reglas de guardia, así que a partir de entonces los avisos te llegan en Slack. Cambia qué avisos recibe en **Ajustes de usuario** > **Reglas de guardia**.

## Guardar mensajes como notas

Reacciona a un mensaje en el canal de un incidente, una alerta, un episodio o un evento de mantenimiento programado, y OneUptime lo guarda como nota en ese registro y lo confirma con una respuesta en el hilo:

| Reacción | Se guarda como |
| --- | --- |
| 📌 Un emoji de chincheta, o el propio **Pin to channel** de Slack | Una nota privada, visible solo para tu equipo |
| 📢 Un emoji de megáfono o altavoz | Una nota pública, mostrada en la página de estado. Solo incidentes y eventos de mantenimiento programado. En un incidente privado, una nota privada, y la confirmación dice por qué. |

La nota conserva el mensaje tal como lo mostraba Slack: su formato, sus enlaces y su código, las personas y los canales que menciona por su nombre, y sus archivos e imágenes como enlaces a ellos. Una nota pública deja fuera los archivos y las imágenes, ya que solo se abren para tu equipo.

Son las palabras de quien escribió el mensaje: su nombre de OneUptime si su cuenta de Slack está conectada y, si no, el nombre que muestra Slack. Una nota privada se coloca en la cronología en el momento en que se publicó el mensaje, por mucho después que se guarde. Una nota pública se coloca cuando se guarda, que es cuando la muestra la página de estado. La cronología dice quién la guardó. La nota no se vuelve a publicar en el canal, donde el mensaje ya está.

La nota se guarda como tú, con tus permisos. Si tu cuenta de Slack aún no está conectada, OneUptime te pide que la conectes, en un mensaje que solo ves tú, con un botón que guarda el mensaje en cuanto lo hagas. Un mensaje se guarda solo una vez, reaccione quien reaccione.

## El comando /oneuptime

OneUptime tiene un solo comando en Slack, `/oneuptime`. La palabra que escribes después indica qué hacer; cualquier otra cosa después es una pregunta para OneUptime AI.

| Comando | Qué hace |
| --- | --- |
| `/oneuptime help` | Lista los comandos, con ejemplos. |
| `/oneuptime incident [title or number]` | Abre el formulario de incidente, con el título rellenado. El número de un incidente, como `42` o `INC-42`, muestra en cambio ese incidente: consulta [Gestionar un incidente desde Slack](#gestionar-un-incidente-desde-slack). |
| `/oneuptime maintenance [title]` | Abre el formulario de mantenimiento programado, con el título rellenado. |
| `/oneuptime oncall` | Lista quién está de guardia ahora mismo en cada programación de guardia que puedes ver, hasta cuándo y quién va después. |
| `/oneuptime page [who] [message]` | Avisa a las personas que mencionas con @ sobre tu mensaje, o abre un formulario para elegir a quién avisar. Consulta [Avisar a alguien desde Slack](#avisar-a-alguien-desde-slack). |
| `/oneuptime ask [question]`, o cualquier pregunta | OneUptime AI responde sobre tus registros, trazas, métricas, incidentes y monitores. |

Las respuestas a `help` y `oncall` son mensajes que solo ves tú, debajo del comando. Una primera palabra que parece un comando mal escrito, como `incidnet`, recibe el comando al que se parece, no una respuesta de OneUptime AI. Los formularios de incidentes y mantenimientos actúan como tú: consulta [Crear incidentes y mantenimientos desde Slack](#crear-incidentes-y-mantenimientos-desde-slack).

> [!NOTE]
> `/oneuptime incident` y `/oneuptime maintenance` sustituyen a `/incident` y `/maintenance`, que podían chocar con comandos del mismo nombre de otras apps de Slack. Una app de Slack creada a partir de un manifiesto anterior los conserva, y abren los mismos formularios, hasta que se actualiza: consulta [Apps creadas a partir de un manifiesto antiguo](/docs/self-hosted/slack-integration#apps-creadas-a-partir-de-un-manifiesto-antiguo).

## El inicio de OneUptime en Slack

Abre OneUptime en **Apps**, en la barra lateral de Slack: su pestaña **Home** muestra lo que pasa en el proyecto, tal como puedes verlo, y se vuelve a leer cada vez que la abres.

- **Tu guardia.** Las programaciones de guardia en las que estás de guardia ahora, y hasta cuándo, o si no tu próximo turno.
- **Lo que está abierto.** Los incidentes y alertas abiertos más recientes que puedes leer, cada uno con un enlace a su página en OneUptime.
- **Sus botones.** **Declare incident**, **Schedule maintenance** y **Page someone** abren los mismos formularios que `/oneuptime incident`, `/oneuptime maintenance` y `/oneuptime page`, y **Who's on call** responde como `/oneuptime oncall`.

El inicio lee como tú, así que necesita tu propia cuenta de Slack conectada. Mientras no lo esté, el inicio muestra un botón **Connect Slack account**, y te muestra tu inicio en cuanto la hayas conectado.

Cuando alguien añade OneUptime a un canal, publica allí un saludo: cómo hacerle una pregunta y dónde añadir una regla de notificación que publique en el canal. La primera vez que abres su pestaña **Messages**, te da allí la bienvenida: qué hace en Slack y cómo empezar.

## Preguntar a OneUptime AI desde Slack

Pregunta por tus registros, trazas, métricas, incidentes y monitores en lenguaje natural. Menciona a OneUptime con @ en un canal, o envíale un mensaje directo, y responde en el hilo. `/oneuptime ask which monitors are down?` publica su respuesta en el canal. Ambos requieren tu propia cuenta de Slack conectada y la IA activada para el proyecto. Las respuestas en Slack solo leen: para cambiar algo, usa los botones. Consulta [Preguntar a la IA](/docs/ai/ask-ai).

OneUptime solo responde a lo que va dirigido a él.

- **En tu propia conversación, basta con responder.** Una pregunta que haces en un canal, no en un hilo, inicia una conversación en el hilo que queda debajo: responde allí para seguir preguntando sin volver a mencionar a OneUptime, y cualquier otra persona se une mencionándolo.
- **En cualquier otro hilo, menciona a OneUptime.** Debajo del mensaje de un incidente, por ejemplo, menciónalo cada vez: lo que las personas se escriben entre sí allí no recibe respuesta.
- **Si tu cuenta de Slack no está conectada.** OneUptime te pide una vez en cada conversación que la conectes, en un mensaje que solo tú ves, con un botón **Connect Slack account**.

## Crear incidentes y mantenimientos desde Slack

`/oneuptime incident` y `/oneuptime maintenance` abren un formulario que rellenas y envías como tú mismo: como la cuenta de OneUptime a la que está conectada tu cuenta de Slack (consulta [Conectar Slack](#conectar-slack)), con los permisos de esa cuenta en el proyecto. Si tu cuenta de Slack no está conectada, o tu cuenta de OneUptime ya no es miembro del proyecto, OneUptime te dice qué hacer donde ejecutaste el comando, en un mensaje que solo tú ves, y no se abre ningún formulario. Los atajos **Create New Incident** y **Create Scheduled Event** abren los mismos formularios.

- **Quién puede usarlos.** Las personas que pueden declarar un incidente o crear un evento de mantenimiento programado en OneUptime: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes** para un incidente (**Create Incident** en un rol personalizado), y **Administrador de mantenimiento programado** y **Miembro de mantenimiento programado** para un evento (**Create Scheduled Maintenance**). A cualquier otra persona se le avisa donde lo ejecutó, y no se abre ningún formulario.
- **Qué ofrece un formulario.** Cada lista — gravedades, monitores, estados de monitor, políticas de guardia y etiquetas — contiene lo que puedes leer, igual que la misma lista en OneUptime: con un rol limitado a algunas etiquetas, los monitores y las políticas de guardia que llevan esas etiquetas. Una lista que no puedes leer en absoluto se omite del formulario. Las políticas de guardia archivadas nunca se ofrecen.
- **Qué puede nombrar un formulario.** El incidente o el evento se crea con tus propios permisos y se te atribuye. Un monitor, una política de guardia, una etiqueta, una gravedad o un estado que no puedes leer, o uno de otro proyecto, se rechaza como uno que el proyecto no tiene, incluso desde un formulario abierto antes de que cambiara tu acceso, y no se crea nada. OneUptime te dice por qué en el canal, en un mensaje que solo tú ves.

**Execute On-Call Policy** en un incidente, una alerta o un episodio funciona igual: necesita permiso para ejecutar una política de guardia (**Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de guardias** y **Miembro de guardias**, o **Create On-Call Duty Policy Execution Log** en un rol personalizado) y para leer ese incidente, alerta o episodio, y ofrece las políticas de guardia activas que puedes leer.

## Avisar a alguien desde Slack

`/oneuptime page @nawaz The checkout API is throwing 500s` avisa a Nawaz de inmediato. OneUptime crea una alerta cuyo título es tu mensaje, y cada persona que mencionas con @ recibe una llamada, un SMS, una notificación push o un correo electrónico, según sus propias reglas de guardia, hasta que alguien reconoce la alerta.

- **A quién se avisa de inmediato.** A las personas que mencionas con @, y a quienes están de guardia en las programaciones que sigue un grupo de usuarios que mencionas con @ (consulta [Grupos de usuarios de guardia](#grupos-de-usuarios-de-guardia)), cuando un mensaje las sigue. OneUptime identifica a una persona por la cuenta de OneUptime a la que está conectada su cuenta de Slack, o si no, por la dirección de correo electrónico que Slack tiene de ella. Nunca se avisa a nadie de fuera del proyecto.
- **Todo lo demás abre un formulario.** Sin nadie mencionado con @, sin mensaje, con `@here`, con un grupo de usuarios que no sigue ninguna programación de guardia que puedas ver, o con una persona que OneUptime no puede identificar, se abre el formulario **Page someone** con lo que escribiste ya rellenado, y dice a quién no pudo elegir. Elige personas, un equipo, una programación de guardia, que avisa a quien esté de guardia en ella ahora, o una política de guardia, que avisa mediante sus reglas de escalado, y envíalo. Un nombre que escribes primero, como en `/oneuptime page Primary The disk is full`, elige la programación, el equipo o la política con ese nombre.
- **Dónde se muestra.** El canal muestra el aviso como un solo mensaje, que se mantiene al día: a quién se avisó y cómo, y quién lo reconoció. Donde OneUptime no puede publicar, como en un canal privado al que no se le ha invitado, un mensaje que solo tú ves dice a quién se avisó, con un enlace a la alerta.
- **Quién puede avisar.** Quien pueda tanto ejecutar una política de guardia como crear una alerta: **Propietario del proyecto**, **Administrador del proyecto** y **Miembro del proyecto**, o **Miembro de guardias** junto con **Miembro de alertas** (**Create On-Call Duty Policy Execution Log** y **Create Alert** en un rol personalizado). Avisar directamente a personas, a un equipo o a una programación, sin una política de guardia detrás del aviso, requiere además acceso a todas las políticas de guardia del proyecto. A cualquier otra persona se le indica donde ejecutó el comando, y no se avisa a nadie. En OneUptime Cloud, avisar requiere el plan Growth: por debajo de él, OneUptime indica el plan que necesita, y no se avisa a nadie.

## Grupos de usuarios de guardia

Mantén un grupo de usuarios de Slack, como `@payments-oncall`, igual a quienes están de guardia en una o varias programaciones de guardia, para que cualquiera pueda mencionarlo con @ y llegar a ellos. OneUptime cambia los miembros del grupo en cada relevo y cada sustitución, y lo comprueba cada 15 minutos.

:::steps
### Conectar un grupo de usuarios a una programación

Abre la programación en **Guardia** > **Programaciones de guardia**. En su tarjeta **Grupos de usuarios de Slack**, haz clic en **Conectar grupo de usuarios** y elige uno de los grupos de usuarios de tu espacio de trabajo, o **Crear un grupo de usuarios nuevo** con un nombre y un identificador. Sus miembros se sustituyen al instante por quienes están de guardia.

### Conectarlo también a la programación secundaria

Para un grupo que tenga a la guardia principal y a la secundaria, conecta el mismo grupo en la página de la programación secundaria. Un grupo puede seguir cualquier número de programaciones.
:::

- **Qué muestra la tarjeta.** Quién está ahora en cada grupo, las otras programaciones que sigue y si está **Al día**. Quien está de guardia pero no puede entrar en el grupo aparece con el motivo: OneUptime encuentra a una persona por su cuenta de Slack conectada, o si no, por la dirección de correo electrónico que Slack tiene de ella, y Slack deja a los invitados fuera de los grupos de usuarios.
- **Nadie de guardia.** Slack no puede mantener un grupo de usuarios vacío, así que OneUptime desactiva el grupo hasta que alguien esté de guardia, y luego lo vuelve a activar.
- **Avisar al grupo.** `/oneuptime page @payments-oncall The checkout API is down` avisa a quienes están de guardia en las programaciones que sigue el grupo. Consulta [Avisar a alguien desde Slack](#avisar-a-alguien-desde-slack).
- **Qué necesita Slack.** Los grupos de usuarios están en los planes de pago de Slack, y un espacio de trabajo puede dejar que solo sus propietarios y administradores los cambien: la tarjeta dice cuál de los dos, y qué hacer. Si Slack se conectó antes de que OneUptime pudiera mantener grupos de usuarios, vuelve a conectarlo una vez en **Ajustes del proyecto** > **Espacio de trabajo** > **Slack**.
- **Quién puede conectar uno.** Los roles que pueden editar programaciones: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de guardias** y **Miembro de guardias**, o **Edit On-Call Duty Policy Schedule** en un rol personalizado. En OneUptime Cloud, conectar uno requiere el plan **Growth**.
- **Desconectar.** OneUptime deja de cambiar el grupo. El grupo y sus miembros se quedan en Slack tal como están.

## Gestionar un incidente desde Slack

El mensaje de un incidente tiene cuatro botones, **Acknowledge Incident**, **Resolve Incident**, **Add Note** y **View Incident**, y el resto en su menú, el botón de tres puntos que va después:

| Elemento del menú | Qué hace |
| --- | --- |
| **Change Severity** | Establece la gravedad del incidente. |
| **Change Incident State** | Pasa el incidente a un estado posterior. |
| **Assign Role** | Da a alguien un rol en el incidente, como **Incident Commander**. Un rol para una sola persona pasa a esa persona. |
| **Page Someone** | Avisa a personas, a un equipo, a quien esté de guardia en una programación o a una política de guardia sobre el incidente, hasta que alguien lo reconozca. |
| **Edit Custom Fields** | Establece los campos personalizados del incidente, cada uno rellenado con lo que tiene el incidente. Un campo que se deja vacío se borra. |

`/oneuptime incident 42` muestra el incidente 42, con estos botones y su menú, en un mensaje que solo ves tú. Escribe el número como lo muestra OneUptime: `42`, `#42` o `INC-42`. En el canal propio de un incidente, `/oneuptime incident` sin nada más muestra ese incidente.

- **Quién puede usarlos.** Las personas que pueden hacer el mismo cambio en OneUptime. **Change Severity** y **Edit Custom Fields** necesitan permiso para editar el incidente: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes**, o **Edit Incident** en un rol personalizado. **Assign Role** necesita **Create Incident Member**, y **Delete Incident Member** para pasar un rol de una sola persona. **Page Someone** necesita lo mismo que **Execute On-Call Policy**. A cualquier otra persona se le dice por qué, y no se abre ningún formulario.
- **Qué ofrecen los formularios.** Lo que puedes leer en el proyecto. Un campo personalizado copiado del monitor del incidente queda fuera, porque se volvería a copiar, y un formulario admite 40 campos: edita el resto en OneUptime.
- **Qué pasa.** El formulario se cierra y el cambio se hace como tú, como en OneUptime: el feed del incidente, y con él los canales del incidente, dicen qué cambió, cada campo personalizado con su nuevo valor. Un valor que no encaja en su campo, como texto para un número, se indica debajo del campo, y el formulario sigue abierto. **Page Someone** dice a quién se avisó, o por qué no se avisó a nadie; un incidente que ya está resuelto no avisa a nadie.
- **Mensajes publicados antes del menú.** Conservan su botón **Execute On-Call Policy**, y sigue funcionando: **Page Someone** también avisa a una política de guardia. Las alertas y los episodios conservan el suyo.

## Actuar sobre incidentes, alertas y eventos desde Slack

Los botones de los mensajes de OneUptime en Slack también actúan como tú: como la cuenta de OneUptime a la que está conectada tu cuenta de Slack, con los permisos de esa cuenta en el proyecto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** y **Execute On-Call Policy** en un incidente, una alerta o un episodio, y **Mark as Ongoing**, **Mark as Complete**, **Change State** y **Add Note** en un evento de mantenimiento programado, hacen cada uno el cambio que hace la misma acción en OneUptime, y se te atribuye allí: la línea de tiempo de estados y el feed del registro muestran que cambiaste su estado, y la nota es tuya. Una nota guardada desde un mensaje con una reacción con emoji se publica del mismo modo.

- **Quién puede usarlos.** Las personas que pueden hacer el mismo cambio en OneUptime. Reconocer, resolver o cambiar el estado de un incidente necesita permiso para cambiar su estado: **Propietario del proyecto**, **Administrador del proyecto**, **Miembro del proyecto**, **Administrador de incidentes** e **Miembro de incidentes**, o **Create Incident State Timeline** en un rol personalizado. Una alerta, un episodio o un evento de mantenimiento programado necesita el mismo permiso para su propio tipo (**Create Alert State Timeline**, por ejemplo), y una nota necesita permiso para publicar ese tipo de nota. A cualquier otra persona se le avisa, y nada cambia.
- **Qué registros.** Los que puedes leer, como en OneUptime: con un rol limitado a algunas etiquetas, los incidentes, alertas, episodios y eventos que las llevan. Un botón en cualquier otro registro dice por qué, y nada cambia: en un incidente al que no llega tu rol, "your access in this project does not include this incident. Ask a project admin for access to it."; en un incidente privado del que no eres responsable, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; y en uno eliminado desde entonces, "the incident was not found. It may have been deleted." En OneUptime Cloud, un cambio que el plan del proyecto no incluye se rechaza indicando el plan que necesita.
- **Qué ofrece Change State.** Los estados que puedes leer y a los que el registro puede pasar a continuación, en el orden del proyecto: ninguno anterior al estado en que está, tanto para un episodio como para un incidente, una alerta o un evento de mantenimiento programado, ya que un cambio de estado nunca hace subir un registro en su lista (consulta [El orden es una restricción real, no una preferencia de visualización](/docs/incidents/states-and-severities#el-orden-es-una-restricción-real-no-una-preferencia-de-visualización)). Si no puedes leer ninguno, se te dice "No incident states are available to you in this project. Ask a project admin for access to them."; si el registro está en el último estado que puede alcanzar, se te dice "There is no later state to move this incident to." Ninguno de los dos abre un formulario vacío.
- **Add Note en un incidente o episodio privado.** Un incidente o episodio privado no admite notas públicas, así que su formulario no pide tipo de nota y añade una nota privada. Un formulario abierto antes de que se hiciera privado también añade una nota privada, y lo dice. Consulta [Los incidentes privados solo admiten notas privadas](/docs/incidents/notes-owners-and-feed#los-incidentes-privados-solo-admiten-notas-privadas).
- **Dónde recibes la respuesta.** Debajo del mensaje que tiene el botón, en un mensaje que solo tú ves; por mensaje directo solo si Slack lo rechaza. Un botón pulsado demasiado tarde dice quién llegó primero, y cuándo, por ejemplo "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Si tu cuenta de Slack no está conectada.** La respuesta te pide conectarla, con un botón **Connect Slack account**. El botón abre tus propios ajustes de Slack en OneUptime y conecta tu cuenta en un solo paso, después de que inicies sesión en OneUptime si hace falta. Después, OneUptime termina lo que pulsaste, como tú, y responde debajo del mismo mensaje; para un botón que abre un formulario, o un comando, te pide que lo pulses o lo ejecutes de nuevo. El botón funciona una vez, durante 30 minutos, y solo para la cuenta de Slack que lo pulsó: con la sesión de Slack de otra persona, no conecta nada.

## Desconectar

- **Desconectar** desvincula solo tu propia cuenta de Slack, y elimina con ella tu método de notificación de Slack.
- **Desinstalar OneUptime de Slack**, en **Ajustes del proyecto** > **Espacio de trabajo** > **Slack**, desconecta el proyecto. OneUptime deja de publicar en Slack, y los menús **Espacio de trabajo** dejan de listarlo. Las reglas de notificación y los resúmenes se conservan para cuando vuelvas a conectar.

> [!WARNING]
> Desinstalar también desvincula la cuenta de Slack de cada miembro del proyecto, y elimina los métodos de notificación de Slack y las reglas de guardia que los usaban. Quienes recibían avisos en Slack los reciben en sus otros métodos de notificación hasta que vuelvan a añadir Slack.

## Tus datos de Slack

OneUptime lee de Slack solo lo que necesitan estas funciones, con los permisos que concedes al instalarlo:

- **Mensajes dirigidos a OneUptime.** Un mensaje que lo menciona con @, uno que le envías en un mensaje directo y tus respuestas en una conversación con él, junto con los mensajes anteriores de ese hilo o mensaje directo, para que OneUptime AI pueda responder. Slack también le envía los demás mensajes de los canales y mensajes directos de grupo en los que está; OneUptime ni los responde ni los guarda.
- **Mensajes que guardas como notas.** Un mensaje al que reaccionas con 📌 o 📢, o que fijas, en el canal de un incidente, una alerta, un episodio o un evento de mantenimiento programado, guardado como nota en ese registro con el nombre de su autor.
- **Nombres de canales y personas.** Los canales en los que puede publicar, para que puedas elegirlos, los nombres de las personas, para mostrar quién escribió o hizo algo, y quién está en el canal propio de un registro, leído cuando la página del registro lo muestra.
- **Direcciones de correo electrónico.** La dirección de correo electrónico que Slack tiene de una persona, para asociar su cuenta de Slack con su cuenta de OneUptime cuando no la ha conectado: para avisarla, para ponerla en un grupo de usuarios de guardia, para añadirla al canal de un registro o para pedirle que la conecte.
- **Grupos de usuarios.** Los grupos de usuarios de tu espacio de trabajo, para elegir uno para una programación de guardia, y las personas de uno que conectes, para mantenerlo igual a quienes están de guardia.

Lo que OneUptime guarda de todo ello — el nombre del espacio de trabajo, sus canales, las cuentas de Slack que conecta la gente, las notas y los grupos de usuarios — se almacena con tu proyecto. La [Política de privacidad](https://oneuptime.com/legal/privacy) explica cómo trata OneUptime tus datos.

## Solución de problemas

:::details Una regla no publica nada
Comprueba las condiciones de la regla con **Probar regla**: si la prueba llega, las condiciones de la regla no coincidieron con el evento. Si no llega, la página de Slack muestra por qué. Para un canal privado, invita primero a la app de OneUptime al canal en Slack. Cada mensaje que publica OneUptime, y cada uno que Slack rechazó, aparece en **Ajustes del proyecto** > **Notificaciones** > **Registros de notificación**, en la pestaña **Espacio de trabajo**.
:::

:::details Falta alguien en el canal de una regla
La tarjeta de la regla dice bajo **Luego** a quién invita la regla. Cada tipo de persona se une a medida que se suma al registro: las personas avisadas cuando se les avisa, el comandante de incidente cuando se le asigna, un propietario cuando se le añade, y quien ya estaba en el registro cuando se creó el canal. A quien OneUptime no encuentra en Slack, ni por la cuenta que conectó ni por su dirección de correo electrónico, no se le puede añadir; OneUptime lo nombra en el canal, con un enlace para conectar su cuenta. Para añadir a alguien ahora, pulsa **Añadir personas** en la tarjeta **Canal de Slack** del registro.
:::

:::details Todos abandonaron un canal privado
Abre el incidente, la alerta, el episodio o el evento en OneUptime y pulsa **Unirse al canal** en su tarjeta **Canal de Slack**, y luego **Añadir personas** para traer de vuelta a los demás. Hace falta permiso para editar el registro, no un administrador de Slack: la app de OneUptime sigue en el canal y es ella quien los añade. Si la tarjeta dice que OneUptime no puede ver el canal, el canal se eliminó o se quitó la app de él: alguien del canal puede volver a añadir la app escribiendo `/invite @OneUptime`.
:::

:::details Slack no se conectó
Cuando Slack te devuelve sin conexión, la página desde la que empezaste dice **Slack no se conectó**, y una frase dice por qué: te falta el permiso, el enlace ya se usó o caducó, iniciaste sesión en otro espacio de trabajo, o el servidor no está configurado para Slack. Consulta [La conexión no terminó](/docs/self-hosted/slack-integration#la-conexión-no-terminó) para cada frase y qué hacer.
:::

:::details Un botón o un comando dice que mi cuenta de Slack no está conectada
Pulsa **Connect Slack account** en esa respuesta para conectarla en un solo paso, o vincúlala en **Ajustes de usuario** > **Espacio de trabajo** > **Slack** con **Connect my account with Slack**. Si ya no eres miembro del proyecto, OneUptime lo dice en su lugar, y no actúa en nada por ti.
:::

:::details OneUptime no responde a una respuesta en un hilo
Una respuesta sin mención solo se contesta en tu propia conversación con OneUptime AI: el hilo que queda debajo de una pregunta que le hiciste en un canal. En cualquier otro hilo, como el que queda debajo del mensaje de un incidente, menciona a OneUptime con @. Si tu cuenta de Slack no está conectada, OneUptime te pide que la conectes una vez en cada conversación, no en cada mensaje: pulsa **Connect Slack account** en ese mensaje, o vincúlala en **Ajustes de usuario** > **Espacio de trabajo** > **Slack**. Consulta [Preguntar a OneUptime AI desde Slack](#preguntar-a-oneuptime-ai-desde-slack).
:::

:::details Las notificaciones llegan, pero los botones y los comandos no hacen nada
En un servidor autoalojado, Slack debe poder llegar a OneUptime para los botones, los formularios y los comandos; las notificaciones solo necesitan acceso saliente. Consulta [Acceso de red para despliegues autoalojados](/docs/self-hosted/slack-integration#acceso-de-red-para-despliegues-autoalojados).
:::

## Próximos pasos

:::cards
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Las mismas notificaciones y acciones en Microsoft Teams.
- [Videollamadas](/docs/workspace-connections/video-calls): Da a cada incidente una llamada, publicada con sus novedades.
- [Integración con Slack](/docs/self-hosted/slack-integration): Configurar la app de Slack en un servidor autoalojado.
- [Declarar un incidente](/docs/incidents/declaring-incidents): Todas las formas en que empieza un incidente, y lo que se ejecuta entonces.
:::
