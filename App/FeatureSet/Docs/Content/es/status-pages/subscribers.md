# Suscriptores y anuncios

Una página de estado es un lugar al que la gente va. Los suscriptores son las personas que preferirían no tener que hacerlo: te dan una dirección de correo, un número de teléfono, un webhook de Slack o un punto de conexión HTTP una vez, y después tus actualizaciones les llegan a ellos.

Los anuncios son la otra mitad del mismo trabajo. Un monitor puede decir a tus visitantes que el proceso de pago está devolviendo errores 500; ningún monitor puede decirles que vas a migrar bases de datos el sábado, que un proveedor externo está teniendo un mal día, o que el incidente del que leyeron ayer está totalmente cerrado. Los anuncios son el canal de texto libre para todo lo que tus comprobaciones no pueden ver, y se difunden a la misma lista de suscriptores.

Esta página cubre ambos: los cinco canales de suscripción y cómo se apuntan los visitantes, qué pueden elegir escuchar los suscriptores, los flujos de doble consentimiento y de baja, y cómo se escriben, programan y plantillan los anuncios.

## Canales de suscripción

Una página de estado admite cinco canales, cada uno con su propio interruptor en la página de estado. Ve a **Páginas de Estado → tu página → Suscriptores → Ajustes de Suscriptores**:

- **Habilitar suscriptores por correo electrónico** (`enableEmailSubscribers`) — activado de forma predeterminada. Todo lo demás está desactivado hasta que lo actives.
- **Habilitar suscriptores por SMS** (`enableSmsSubscribers`) — desactivado de forma predeterminada.
- **Habilitar suscriptores de Slack** (`enableSlackSubscribers`) — desactivado de forma predeterminada.
- **Habilitar suscriptores de Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — desactivado de forma predeterminada.
- **Habilitar suscriptores de webhook** (`enableWebhookSubscribers`) — desactivado de forma predeterminada.

Cada canal obtiene además su propia lista en el menú lateral de la página de estado bajo **Suscriptores**: **Suscriptores de Correo**, **Suscriptores SMS**, **Suscriptores de Slack**, **Suscriptores de MS Teams** y **Suscriptores de webhook**. Ahí es donde miras quién se ha apuntado, añades a alguien a mano o te dejas una entrada de **Notas** (`internalNote`) sobre un suscriptor concreto.

**Un solo interruptor no basta.** El elemento **Subscribe** de la barra de navegación de la página de estado solo aparece cuando **Mostrar página de suscriptores** (`showSubscriberPageOnStatusPage`) está activado *y* al menos un canal está habilitado. Si activas **Habilitar suscriptores por correo electrónico** pero dejas **Mostrar página de suscriptores** desactivado, los visitantes no tienen forma de llegar al formulario.

Los mismos cinco interruptores aparecen una segunda vez dentro de la tarjeta **Ajustes de Suscriptores** en **Ajustes Avanzados**, junto a **Mostrar página de suscriptores**. Por debajo son las mismas columnas: elige una pantalla y quédate en ella, y prefiere la página dedicada **Ajustes de Suscriptores**, ya que ahí es donde vive el resto de la configuración de suscriptores.

## Qué ve un visitante en la página de suscripción

La página **Subscribe** tiene un submenú con una pestaña por canal habilitado —**Correo electrónico**, **SMS**, **Slack**, **MS Teams**, **Webhooks**— mapeadas a `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` y `/subscribe/webhooks`. Cada pestaña pide lo mínimo que necesita:

- **Correo electrónico** — encabezado **Subscribe by Email**, un campo **Your Email** con el marcador de posición `subscriber@company.com`.
- **SMS** — encabezado **Subscribe by SMS**, un campo **Your Phone Number** con el marcador de posición `+11234567890`.
- **Slack** — encabezado **Subscribe by Slack**, con **Nombre del espacio de trabajo de Slack** (usado para validación) y **URL del webhook entrante de Slack**, marcador de posición `https://hooks.slack.com/services/...`.
- **MS Teams** — encabezado **Subscribe by Microsoft Teams**, con **Nombre del espacio de trabajo de Microsoft Teams** y **URL del webhook entrante de Microsoft Teams**, marcador de posición `https://outlook.office.com/webhook/...`.
- **Webhooks** — encabezado **Subscribe by Webhook**, un campo **URL del webhook**. Se le envía una petición `POST` con JSON en cada evento de la página de estado.

El botón de envío dice **Subscribe**, y un registro correcto muestra *You have been subscribed successfully.* La página lleva también una división **New Subscription** / **Manage Existing Subscription**, de modo que quien ya se suscribió puede volver a sus preferencias sin buscar un correo antiguo.

## Dejar que los suscriptores elijan recursos y tipos de evento

De forma predeterminada, un suscriptor recibe todo lo de la página. Dos interruptores de la tarjeta **Ajustes avanzados de suscriptor** cambian eso:

- **Permitir a los suscriptores elegir recursos** (`allowSubscribersToChooseResources`) — desactivado de forma predeterminada. Actívalo y el formulario de suscripción gana un interruptor **Suscribirse a todos los recursos**; despéjalo y aparece **Seleccionar recursos para suscribirse** para que el visitante pueda elegir recursos individuales.
- **Permitir a los suscriptores elegir tipos de eventos** (`allowSubscribersToChooseEventTypes`) — desactivado de forma predeterminada. La misma forma: un interruptor **Suscribirse a todos los tipos de eventos**, y **Seleccionar tipos de eventos para suscribirse** debajo cuando se despeja.

Los tipos de evento son `Incident`, `Announcement` y `Scheduled Event`.

Las elecciones aterrizan en el registro del suscriptor como **Is Subscribed to All Resources** (`isSubscribedToAllResources`, predeterminado verdadero), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, predeterminado verdadero), **Subscribed to Resources** y **Subscribed to Event Types**.

Bueno para: una página que cubre varios productos. Un cliente que solo usa tu API no quiere un aviso cada vez que el sitio de marketing se tambalea; deja que acoten la lista ellos mismos en lugar de verlos darse de baja del todo.

La misma tarjeta lleva también **Zonas horarias del suscriptor**.

## Doble consentimiento por correo electrónico

Los suscriptores por correo electrónico siempre confirman. Cuando se crea un suscriptor con una dirección de correo y no se creó ya confirmado, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) se fuerza a `false` y se genera un **Subscription Confirmation Token** de seis dígitos. OneUptime envía entonces por correo un enlace de confirmación con la forma `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. El visitante aterriza en una página **Confirm Subscription** y, una vez completado, ve *Subscription confirmed successfully*.

Los suscriptores por SMS, Slack, Microsoft Teams y webhook se saltan esto: se crean con `isSubscriptionConfirmed` ya establecido a `true`.

**Sin confirmar significa en silencio.** La consulta que recupera suscriptores para una notificación filtra por `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Una dirección de correo que nunca hizo clic en el enlace se quedará en tu lista de **Suscriptores de Correo** y no recibirá nada. Si alguien jura que está suscrito pero no recibe nada, comprueba esa columna primero.

No hay ningún interruptor para desactivar la confirmación por correo: es incondicional para cualquiera que se apunte a través de la página de estado. Una columna aparte por suscriptor, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, predeterminado verdadero), controla el correo de «te has suscrito» que sale una vez confirmado un suscriptor.

## Gestionar y cancelar una suscripción

Todo correo a suscriptores lleva un enlace de baja con la forma `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Esa página se titula **Update Subscription** y le dice al visitante que ahí puede actualizar sus preferencias o darse de baja. Contiene:

- Los selectores de recursos y tipos de evento que la página permita.
- Un interruptor **Cancelar suscripción**, descrito como darse de baja de todos los recursos. Escribe **Está dado de baja** (`isUnsubscribed`, predeterminado falso).
- Un botón de envío que dice **Update Subscription**; al guardar se muestra *Your changes have been saved.*

Quien haya perdido el enlace usa **Manage Existing Subscription** en la página **Subscribe** y pulsa **Send Management Link**. OneUptime responde que se ha enviado un correo con el enlace y que revise la carpeta de spam si no llega.

Los puntos de conexión detrás de todo esto son `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` y `PUT .../update-subscription/:statusPageId/:subscriberId`.

Darse de baja invierte un indicador en lugar de eliminar una fila, así que el registro permanece en la lista del canal con **Está dado de baja** establecido, útil cuando más adelante necesitas explicar por qué una dirección concreta dejó de recibir correo.

## De qué se notifica a los suscriptores

Los suscriptores se enteran de los tres tipos de evento anteriores, pero cada origen tiene su propio interruptor, así que no se envía nada por accidente.

### Notificaciones de anuncios

El propio anuncio lleva **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), expuesto en el formulario de creación como la casilla **Notificar a suscriptores de la página de estado** y activado de forma predeterminada. Si el anuncio nombra monitores en **Monitores afectados (opcional)**, la notificación se limita a esos monitores; déjalo vacío y se notifica a todos los suscriptores.

### Eventos de mantenimiento programado

Un evento de mantenimiento programado tiene su propio conjunto de columnas de suscriptor: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, más **Subscriber notifications before the event** y **Next subscriber notification before the event at?** para los avisos anticipados. **Páginas de Estado** en el evento decide en qué páginas aparece, y **Should be visible on status page?** decide si aparece siquiera.

### Incidentes

`Incident` es el tercer tipo de evento. Qué hace que un incidente llegue a una página de estado en primer lugar —qué recursos toca y qué estados lo mantienen visible— se cubre en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

La sección **Registros de notificación** del menú lateral de la página de estado (`{id}/notification-logs`) es a donde vas cuando necesitas ver qué envió realmente la página.

## Personalizar las plantillas de notificación

La tarjeta **Plantillas de notificación** de **Ajustes de Suscriptores** lista las plantillas que usa esta página de estado, con las columnas **Nombre de la plantilla**, **Tipo de evento** y **Método de notificación**, de modo que puedes variar la redacción por tipo de evento y por canal en lugar de aceptar un único mensaje de la casa para todo.

Las plantillas de todo el proyecto viven un nivel más arriba, en **Páginas de Estado → Ajustes → Plantillas de Suscriptores**, junto a **Plantillas de Anuncios**.

## Pie de página del correo, SMTP personalizado y Twilio

Otras tres tarjetas de **Ajustes de Suscriptores** controlan cómo salen de tu proyecto los mensajes a suscriptores:

- **Ajustes del pie de página del correo electrónico** — **Habilitar texto personalizado del pie de página del correo electrónico** y **Texto de pie de página de notificación por correo electrónico para suscriptores** ponen tu propio pie de página en los correos a suscriptores.
- **SMTP personalizado** — **Configuración de SMTP personalizado** envía el correo a suscriptores a través de tu propio servidor de correo en lugar del predeterminado.
- **Configuración de Twilio** — **Configuración de Twilio** es la cuenta de Twilio usada para los suscriptores por SMS.

Vale la pena configurar SMTP personalizado pronto si tienes suscriptores por correo: el correo que viene de tu propio dominio es mucho menos probable que se filtre, y mucho más probable que se lo crea el cliente que lo lee a las 2 de la madrugada.

## Anuncios

Un anuncio es un registro a nivel de proyecto (el modelo `StatusPageAnnouncement`) que difundes a una o más páginas de estado, opcionalmente limitado a monitores concretos, con una ventana durante la cual se muestra.

Creas uno desde **Páginas de Estado → Más → Anuncios**, o desde **Anuncios** en el menú lateral de una página de estado individual. El formulario de creación es un asistente de cuatro pasos:

1. **Información básica** — **Título del anuncio** (obligatorio, al menos dos caracteres), **Descripción** (Markdown, opcional) y **Adjuntos** para los archivos que deberían estar disponibles con el anuncio en la página de estado.
2. **Páginas de Estado** — **Mostrar anuncio en estas páginas de estado**, una selección múltiple obligatoria. Un anuncio puede dirigirse a varias páginas a la vez.
3. **Recursos afectados** — **Monitores afectados (opcional)**. Si no seleccionas ninguno, se notifica a todos los suscriptores.
4. **Programación y ajustes** — **Comenzar a mostrar el anuncio en** (obligatorio, con la hora actual por defecto), **Dejar de mostrar el anuncio el** (opcional) y **Notificar a suscriptores de la página de estado** (activado de forma predeterminada).

Los visitantes leen los anuncios en `/announcements`, divididos en **Active Announcements** y **Past Announcements**, cada uno sellado con **Announced at**. Los anuncios actualmente activos también se fijan arriba en la página de vista general. Cuando no hay nada que mostrar, la página dice *No Announcement* con la nota de que no se ha publicado ninguno hasta ahora.

Los adjuntos se sirven desde `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, tras la misma comprobación de lectura que la propia página de estado, así que un adjunto en una página privada sigue siendo privado.

## Cómo funciona la programación de anuncios

**Show At** (`showAnnouncementAt`) y **End At** (`endAnnouncementAt`) lo gobiernan todo, pero la página de vista general y la lista de anuncios hacen preguntas distintas, y la diferencia despista a la gente.

- **La página de vista general** muestra un anuncio cuando `showAnnouncementAt` está en el pasado y `endAnnouncementAt` está o bien en el futuro o bien vacío.
- **La lista `/announcements`** muestra los anuncios cuyo `showAnnouncementAt` cae dentro de **Mostrar historial de anuncios (en días)** (`showAnnouncementHistoryInDays`, predeterminado 14), y luego los divide en el cliente entre activos y pasados.

Dos consecuencias que conviene prever:

- **Un anuncio sin fecha de fin nunca caduca.** Deja **Dejar de mostrar el anuncio el** vacío y se queda fijado en la página de vista general indefinidamente. Pon una fecha de fin a todo lo que tenga límite temporal.
- **Un anuncio antiguo pero aún activo puede desaparecer de la lista.** Si empezó hace más de `showAnnouncementHistoryInDays`, desaparece de `/announcements` aunque siga en la vista general. Amplía la ventana de historial si mantienes avisos de larga duración.

Si los anuncios aparecen siquiera lo controla la tarjeta **Ajustes de anuncios** en **Ajustes Avanzados**: **Mostrar anuncios** (`showAnnouncementsOnStatusPage`, predeterminado verdadero) y **Mostrar historial de anuncios (en días)** (predeterminado 14). Con **Mostrar anuncios** desactivado, el punto de conexión de anuncios rechaza la petición directamente.

## Plantillas de anuncios

Si publicas el mismo tipo de aviso repetidamente —un aviso mensual de mantenimiento, una degradación recurrente de un tercero— prepáralo de antemano. **Páginas de Estado → Ajustes → Plantillas de Anuncios** guarda el modelo `StatusPageAnnouncementTemplate`, y su formulario pide **Nombre de la plantilla**, **Descripción de la plantilla**, **Título del anuncio**, **Descripción**, **Mostrar anuncio en estas páginas de estado**, **Monitores afectados (opcional)** y **Notificar a los suscriptores**, de modo que la difusión y la decisión de notificar se toman una vez en lugar de cada vez.

## Suscriptores de webhook y protección contra SSRF

Los suscriptores de webhook reciben una petición `POST` con JSON en cada evento de la página de estado, lo que los convierte en la forma más fácil de canalizar las actualizaciones de la página de estado hacia un sistema propio: un chatbot, un panel interno, una cola de tickets.

Como suscribirse es una operación pública en una página pública, OneUptime protege el destino:

- Una **URL del webhook** genérica se valida antes de aceptarse, y las direcciones privadas, de bucle invertido, de enlace local y de metadatos de nube se rechazan. No puedes apuntar una suscripción a algo dentro de la propia red del despliegue de OneUptime.
- Una **URL del webhook entrante de Slack** debe empezar por `https://hooks.slack.com/services/`.

Si una suscripción de webhook se rechaza al registrarse, lo primero que hay que comprobar es una URL interna o mal formada.

## Qué leer a continuación

- [Visión general de las páginas de estado](/docs/status-pages/index) — qué es una página de estado y cómo está compuesta.
- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) — los monitores y grupos entre los que pueden elegir los suscriptores.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — dominios personalizados, logotipos y el aspecto de la página a la que enlazan tus correos.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué pone un incidente en una página de estado y qué lo retira.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — las reglas a nivel de proyecto detrás de la comunicación de incidentes.
