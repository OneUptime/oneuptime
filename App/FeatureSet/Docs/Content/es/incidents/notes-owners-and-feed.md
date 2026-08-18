# Notas, propietarios y feed

Todo incidente acumula un registro escrito mientras lo trabajas. Parte de ese registro es para tus clientes: la actualización que sale en la página de estado a las 02:14 diciendo que has encontrado el despliegue defectuoso. El resto es para tu equipo: la traza de pila que alguien pegó, el gráfico que por fin tuvo sentido, la decisión de conmutar por error.

OneUptime mantiene separadas esas dos audiencias. Las **Notas Públicas** se publican en tu página de estado y pueden notificar a los suscriptores. Las **Notas Privadas** (el modelo `IncidentInternalNote`) se quedan dentro del panel. Debajo de ambas está el **Incidente Feed**, una línea de tiempo de solo anexado que registra todo lo que le ha ocurrido al incidente, y la lista de **Propietarios**, que decide a quién se avisa.

Todo ello cuelga del menú lateral izquierdo del incidente: **Notas → Notas Públicas**, **Notas → Notas Privadas** y **Equipo → Propietarios**. El feed vive en la página **Vista General** del incidente.

## Notas públicas frente a notas privadas

Los dos tipos de nota se parecen en el panel y se comportan de forma muy distinta.

- **Notas públicas** — el modelo `IncidentPublicNote`, servido a las páginas de estado como parte de la línea de tiempo del incidente. Llevan una fecha **Publicado el** que puedes establecer tú y una casilla **Notificar a suscriptores de la página de estado**.
- **Notas privadas** — el modelo `IncidentInternalNote`. Nada en la aplicación de la página de estado las lee. No tienen campo de fecha de publicación (la lista se sella y se ordena por `createdAt`) ni ningún campo de suscriptor, así que una nota privada nunca puede disparar una notificación a suscriptores.

**Qué significa realmente «privada».** Significa «no publicada en la página de estado», no «restringida a un grupo más pequeño de personas». Ambos tipos de nota comparten los mismos permisos de lectura, así que cualquiera que pueda leer el incidente puede leer sus notas privadas. Si necesitas restringir quién puede ver siquiera un incidente, usa el indicador **Incidente privado** (`isPrivate`) en el propio incidente, que oculta el incidente en todas las páginas de estado y lo limita a los usuarios propietarios del incidente, los miembros de sus equipos propietarios y los administradores y propietarios del proyecto.

**Los propietarios ven ambas.** El trabajo de notificación a propietarios consulta las notas públicas y privadas juntas. Una nota privada es privada frente a tus suscriptores, no frente a las personas que responden.

| Si quieres…                                                     | Elige                |
| --------------------------------------------------------------- | -------------------- |
| Contar a los clientes qué sabes y cuándo sabrás más             | **Nota pública**     |
| Fechar hacia atrás una actualización que ya enviaste por otro sitio | **Nota pública**  |
| Registrar una hipótesis, un comando que ejecutaste o un callejón sin salida | **Nota privada** |
| Adjuntar un volcado de memoria o una captura de un panel interno | **Nota privada**    |

## Publicar una nota pública

Abre **Notas → Notas Públicas** en el menú lateral del incidente y crea una nota. La tarjeta explica que lo que escribas aquí aparece en la página de estado; el estado vacío indica que hasta ahora no se han creado notas públicas para este incidente.

| Campo                                                     | Propósito                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Nota de incidente pública**                             | El cuerpo, en Markdown. Obligatorio. El formulario te recuerda que la nota es visible en tu página de estado y enlaza una chuleta. |
| **Adjuntos**                                              | Archivos compartidos con los suscriptores en la página de estado. Opcional.                                             |
| **Notificar a suscriptores de la página de estado**       | Casilla, activada de forma predeterminada. Desactívala para publicar en silencio.                                       |
| **Publicado el**                                          | Fecha y hora obligatorias, con la hora actual por defecto, mostradas en tu zona horaria actual.                         |

**Publicado el es la marca de tiempo real de la nota.** Las páginas de estado ordenan y muestran las notas públicas por `postedAt`, no por cuándo las escribiste, así que si estás poniendo al día la página de estado con una actualización que enviaste hace 40 minutos, ajusta **Publicado el** al momento en que ocurrió de verdad. Si una nota llega por la API sin ese valor, OneUptime sella la hora actual.

La lista muestra quién escribió cada nota, su **Publicado el**, el Markdown renderizado con sus adjuntos y una columna **Estado de notificación del suscriptor**. Puedes filtrar por **Creado por**, **Nota** y **Creado en**.

## Publicar una nota privada

**Notas → Notas Privadas** es deliberadamente más sencilla. Solo hay dos campos:

- **Nota de incidente privada** — cuerpo en Markdown, obligatorio. El formulario dice sin rodeos que esto es privado para tu equipo y no es visible en la página de estado.
- **Adjuntos** — archivos destinados al equipo de respuesta al incidente.

Sin **Publicado el**, sin casilla de suscriptores: la nota se sella cuando se crea.

## Adjuntos en las notas

Ambos tipos de nota aceptan archivos adjuntos mediante un campo **Adjuntos**, y ambos muestran una lista de adjuntos bajo el cuerpo de la nota con un enlace **Download attachment** por archivo.

Donde divergen es en quién puede descargar el archivo:

- **Los adjuntos de las notas públicas** los pueden descargar los visitantes de la página de estado mediante una ruta de la página de estado, junto con la propia nota.
- **Los adjuntos de las notas privadas** solo son accesibles a través de la API autenticada del panel. No hay ninguna ruta de página de estado para ellos.

Eso hace que los adjuntos sean la misma decisión público/privado que el texto de la nota. Una imagen de línea de tiempo de cara al cliente va en una nota pública; un volcado de configuración va en una privada.

## Generar una nota con IA

Ambas páginas de notas llevan un botón **Generate with AI**. Envía el incidente al proveedor de IA de tu proyecto y deja el Markdown generado en el editor de notas, donde lo editas antes de guardar: no se publica nada automáticamente.

- **Generate Public Note with AI** — descrito como el análisis de los datos del incidente para producir una nota de cara al cliente. Las plantillas incluyen **Status Update** y **Resolution Notice**.
- **Generate Private Note with AI** — produce en su lugar una nota técnica interna. Las plantillas incluyen **Investigation Update** y **Technical Analysis**.

Detrás del botón, el panel envía una petición a `/incident/generate-note-from-ai/{incidentId}` con la plantilla elegida y un tipo de nota `public` o `internal`.

## Plantillas de notas

Si tu equipo escribe las mismas tres actualizaciones en cada interrupción, guárdalas una vez. Ambas páginas de notas tienen un botón **Crear desde plantilla** que abre un selector **Crear nota desde plantilla** con un desplegable **Seleccionar plantilla de nota**.

Las plantillas se comparten entre notas públicas y privadas: una única lista de plantillas sirve a ambas, y la misma plantilla se puede insertar en cualquiera de los dos tipos de nota.

Las gestionas en **Incidentes → Ajustes → Plantillas de Notas**: la tarjeta se titula **Plantillas de notas públicas o privadas para incidentes** y su formulario tiene un paso **Información de la plantilla** (**Nombre de la plantilla** y **Descripción de la plantilla**, ambos obligatorios) y un paso **Detalles de la nota** para el cuerpo. Si haces clic en **Crear desde plantilla** antes de crear ninguna, OneUptime te dice que todavía no existe ninguna; ten en cuenta que el mensaje apunta a Ajustes del proyecto, pero la página está realmente en **Incidentes → Ajustes → Plantillas de Notas**.

## Publicar notas desde Slack o Microsoft Teams

Si has conectado un espacio de trabajo, quienes responden nunca tienen que salir del canal. Tanto Slack como Microsoft Teams exponen una acción de añadir nota que abre un modal con un desplegable que ofrece **Nota pública** o **Nota privada** más un cuadro de texto, y escribe el resultado directamente en el incidente.

Dos detalles que conviene conocer:

- **Protección contra duplicados** — cada nota registra el mensaje de Slack del que procede (`postedFromSlackMessageId`, con formato `channel_id:message_ts`), así que varias personas reaccionando al mismo mensaje producen una nota, no cinco.
- **Las notas se reflejan de vuelta** — publicar cualquiera de los dos tipos de nota también envía un mensaje al canal del incidente conectado, porque el elemento de feed de la nota se crea con la notificación al espacio de trabajo habilitada.

## Cuándo llega realmente una nota pública a los suscriptores

Crear una nota pública con **Notificar a suscriptores de la página de estado** activado no garantiza por sí solo que salga un correo. La nota tiene que superar una cadena de comprobaciones, y cada fallo registra un motivo específico en lugar de dar error:

1. **Notificar a suscriptores de la página de estado** debe estar activado. Si no lo está, la nota se sella como omitida en el momento en que se crea.
2. La nota debe pertenecer a un incidente que siga existiendo.
3. El incidente debe tener al menos un monitor adjunto: sin monitores no hay ningún recurso de página de estado al que enrutar la nota.
4. El indicador **Visible en la página de estado** (`isVisibleOnStatusPage`) del incidente debe ser verdadero.
5. Cada página de estado a la que llegue el incidente debe tener **Mostrar incidentes** (`showIncidentsOnStatusPage`) activado.
6. Cada suscriptor debe superar sus propias preferencias: no estar dado de baja, y estar suscrito a este recurso y al tipo de evento `Incident` donde la página permite que los suscriptores elijan.

**Las notificaciones no son instantáneas.** El trabajo que las envía se ejecuta una vez por minuto, así que espera hasta alrededor de un minuto entre guardar la nota y que el correo salga. Eso es lo que significa la etiqueta **Sending Soon**.

La columna **Estado de notificación del suscriptor** sigue todo el recorrido:

| Estado                       | Qué significa                                                  |
| ---------------------------- | -------------------------------------------------------------- |
| **Notifications skipped.**   | Una de las barreras anteriores se cerró. El motivo se registra.|
| **Sending Soon**             | Encolada, esperando la siguiente ejecución del trabajo de envío.|
| **Notifications Being Sent** | El trabajo está recorriendo la lista de suscriptores.          |
| **Notificaciones enviadas**  | Todas las notificaciones a suscriptores salieron.              |
| **Fallido**                  | El trabajo lanzó un error; el error se guarda con la nota.     |

Haz clic en **más detalles** sobre el estado para abrir **Detalles del estado de la notificación**. Donde tenga sentido reenviar, el botón de ese modal es **Retry**, que devuelve la nota al estado pendiente para que la siguiente ejecución la recoja de nuevo.

El mensaje que reciben realmente los suscriptores se construye con plantillas por página de estado y por canal: correo electrónico, SMS, Slack y Microsoft Teams tienen cada uno su propia plantilla para el evento **Subscriber Incident Note Created**, con variables para el nombre y la URL de la página de estado, el enlace de detalles, los recursos afectados, la severidad y el título del incidente, el cuerpo de la nota y un enlace de baja por suscriptor. Consulta [Suscriptores y anuncios](/docs/status-pages/subscribers) para saber cómo se configuran esas plantillas y canales.

## El feed del incidente

La tarjeta **Incidente Feed** está al final de la columna izquierda de la página **Vista General** del incidente. Es la historia del incidente en orden: cada elemento es un icono, el avatar y el nombre de quien lo provocó, una marca de tiempo relativa con la hora local exacta al pasar el ratón, y un cuerpo en Markdown. Los elementos se ordenan de más antiguo a más reciente.

Algunos elementos llevan detalle extra: una notificación a propietarios lista a todos los que recibieron correo, por ejemplo. Esos muestran un botón **More Information** que abre un panel **More Information**.

La cabecera de la tarjeta también tiene un menú **Acciones** para que puedas actuar sin salir de la línea de tiempo:

- **Execute Runbook** — inicia un [runbook](/docs/runbooks/index) contra este incidente.
- **Ejecutar política de guardia** — avisa a una política bajo demanda.
- **Add Public Note** — los mismos cuatro campos que la página de Notas Públicas, en un modal.
- **Añadir nota privada** — solo cuerpo de la nota y adjuntos.

Junto a él, **Actualizar** vuelve a recuperar el feed.

**El feed es de solo anexado, y no es tu registro de auditoría.** La API permite crear y leer elementos del feed, pero no actualizarlos ni eliminarlos, así que nadie puede reescribir en silencio la historia de un incidente. Tampoco es permanente: en instalaciones facturadas, las filas del feed de más de tres años se eliminan. Para un registro duradero de quién cambió qué, usa **Auditoría → Registros de Auditoría** en el menú lateral del incidente.

## Qué registra el feed

Los elementos del feed los escriben el propio servicio de incidentes, ambos servicios de notas, la línea de tiempo de estado, los cambios de propietario y de miembros, los motores de reglas, la ejecución de guardia, los ejecutores de investigación y post mortem con IA, y los trabajos cron de notificación. Los tipos de evento cubren:

- **El propio incidente** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notas e informes** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Personas** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Notificaciones** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automatización** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Cada tipo tiene su propio icono, así que puedes recorrer un feed largo y distinguir los cambios de estado del ruido. El análisis de causa raíz generado por IA se marca de forma distintiva y se muestra en un modo Markdown restringido.

Los feeds respetan la privacidad del incidente: en los incidentes privados, las lecturas del feed se filtran igual que el incidente.

## Propietarios

Los propietarios son las personas y equipos responsables de un incidente. Son el objetivo de notificación de todo lo que le ocurre, y son la razón por la que un incidente no pasa desapercibido mientras todos suponen que ya se está ocupando otro.

Abre **Equipo → Propietarios** en el menú lateral del incidente. La tarjeta **Propietarios** muestra una insignia con el recuento y describe a los propietarios como las personas y equipos responsables de este incidente a quienes se notifica de los cambios, con un recuento en curso como «2 personas · 1 equipo». Los propietarios se muestran como avatares superpuestos; al pasar el ratón sobre uno se ve el correo de la persona o se marca la entrada como **Equipo**.

- Haz clic en **Añadir propietario** para abrir un selector con un cuadro de búsqueda de personas o equipos.
- Haz clic en el control de eliminación de un avatar para abrir la confirmación **Eliminar propietario**, y luego **Eliminar**.
- Sin propietarios aún, la tarjeta lo indica y te invita a añadir a un compañero de equipo o a un equipo para que reciban notificaciones de los cambios.

Los usuarios propietarios y los equipos propietarios son registros separados: añadir un equipo convierte a todos sus miembros en propietarios a efectos de notificación sin listarlos individualmente.

## Cómo se asignan los propietarios

Hay cuatro rutas hacia la lista de propietarios:

- **Desde una plantilla de incidente** — las plantillas llevan campos **Propietario - Equipos** y **Propietario - Usuarios**, descritos como los equipos y usuarios que poseen el incidente y a los que se notificará cuando se cree o actualice. Crear un incidente desde la plantilla los rellena de antemano. Consulta [Declarar un incidente](/docs/incidents/declaring-incidents).
- **Desde las Reglas del propietario de incidentes** — las reglas coincidentes añaden propietarios automáticamente en el momento de la creación.
- **En la creación mediante la API** — los usuarios y equipos propietarios pasados con la llamada de creación se añaden inmediatamente, con un indicador que controla si reciben el correo de «te han añadido».
- **A mano** — el control **Añadir propietario** de la página **Propietarios**, en cualquier momento durante el incidente.

Añadir a la misma persona dos veces es seguro; los propietarios ya asignados no se duplican.

## Reglas de propietario de incidentes

Las **Reglas del propietario de incidentes** asignan automáticamente usuarios y equipos propietarios cuando se crean incidentes coincidentes: la capa de enrutamiento que hace que un incidente de base de datos aterrice en el equipo de bases de datos sin que nadie tenga que pensarlo. Las encontrarás con el resto de la automatización de incidentes que se cubre en [Configuración y automatización de incidentes](/docs/incidents/settings).

El formulario de la regla tiene tres pasos —**Información básica**, **Criterios de coincidencia** y **Propietarios**— y el paso de propietarios contiene dos secciones:

- **Propietarios a asignar** — elige **Equipos propietarios** y **Usuarios propietarios**. Cuando la regla coincide, cada usuario y equipo seleccionado se añade como propietario, y los propietarios ya asignados no se duplican.
- **Heredar propietarios** — asigna propietarios desde entidades relacionadas en lugar de nombrarlos. **Heredar propietarios de los monitores** hace que todo propietario de los monitores del incidente sea propietario del incidente, y **Inherit Owners From Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** y **… From Services** hacen lo mismo para esos recursos.

Un interruptor **Notificar a los propietarios** controla si la gente se entera. Déjalo activado para enrutamiento real; desactívalo para añadir propietarios en silencio, útil cuando una regla es una comodidad contable en lugar de un aviso.

Cada ejecución de regla se escribe en el feed del incidente, así que siempre puedes saber si una persona fue añadida por una regla o por un humano.

## De qué se notifica a los propietarios

Cinco trabajos notifican a los propietarios, cada uno ejecutándose una vez por minuto:

- **Incidente creado** — asunto `[New Incident {number}] - {title}`.
- **Se publicó una nota** — para notas públicas *y* privadas, asunto `[Update Incident {number}] - {title}`.
- **El estado del incidente cambió** — consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).
- **Te añadieron como propietario** — asunto `You have been added as the owner of Incident {number} - {title}`.
- **Sigue sin resolverse** — un recordatorio guiado por la hora del siguiente recordatorio del incidente, asunto `[Reminder] Incident {number} is still {state} - {title}`.

Cada notificación se construye para correo electrónico, SMS, llamada de voz, push y WhatsApp y se entrega a los ajustes de notificación del usuario, que deciden qué se envía realmente. Cada destinatario puede desactivar cada una de estas por separado: los ajustes por usuario están redactados como el envío de las notificaciones de incidente creado, nota publicada, estado cambiado, propietario añadido, miembro asignado y recordatorio de sigue abierto. Alguien que solo quiera una llamada para los cambios de estado puede tener exactamente eso.

**Los incidentes sin propietario no son silenciosos.** Si un incidente no tiene ningún propietario, los trabajos de notificación recaen en los propietarios del proyecto, así que nada se pierde. Cada persona notificada se añade también al elemento de feed correspondiente, así que puedes ver después exactamente a quién se avisó y en qué dirección.

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — qué es un incidente y cómo encajan las piezas.
- [Declarar un incidente](/docs/incidents/declaring-incidents) — crear incidentes a mano, desde plantillas y desde monitores.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — la máquina de estados que impulsa la mitad del feed.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — reglas de propietario, plantillas de notas y el resto de la automatización.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — dónde acaban las notas públicas y quién las recibe.
- [Visión general de las páginas de estado](/docs/status-pages/index) — la cara de un incidente de cara al cliente.
