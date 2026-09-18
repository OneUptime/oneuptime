# Suscriptores y anuncios

Una página de estado es un sitio al que la gente va. Los suscriptores son quienes preferirían no tener que ir — te dan una vez un correo electrónico, un número de teléfono, un webhook de Slack o un endpoint HTTP, y a partir de ahí tus actualizaciones les llegan solas.

Los anuncios son la otra mitad del mismo trabajo. Un monitor puede contarle a tus visitantes que el proceso de pago devuelve errores 500; ningún monitor puede contarles que el sábado migras bases de datos, que un proveedor externo está teniendo un mal día, o que el incidente sobre el que leyeron ayer está cerrado del todo. Los anuncios son el canal de texto libre para todo lo que tus comprobaciones no pueden ver, y se reparten a la misma lista de suscriptores.

Esta página cubre las dos cosas: los cinco canales de suscripción y cómo se apunta un visitante, qué puede elegir recibir un suscriptor, los flujos de doble confirmación y de baja, y cómo se escriben, se programan y se plantillan los anuncios.

## Canales de suscripción

Una página de estado admite cinco canales, cada uno con su propio interruptor en la página de estado. Ve a **Páginas de Estado → tu página → Suscriptores → Ajustes de Suscriptores**:

- **Habilitar suscriptores por correo electrónico** (`enableEmailSubscribers`) — activado por defecto. Todo lo demás está apagado hasta que tú lo enciendas.
- **Habilitar suscriptores por SMS** (`enableSmsSubscribers`) — apagado por defecto.
- **Habilitar suscriptores de Slack** (`enableSlackSubscribers`) — apagado por defecto.
- **Habilitar suscriptores de Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — apagado por defecto.
- **Habilitar suscriptores de webhook** (`enableWebhookSubscribers`) — apagado por defecto.

Cada canal tiene además su propia lista en el menú lateral de la página de estado, bajo **Suscriptores**: **Suscriptores de Correo**, **Suscriptores SMS**, **Suscriptores de Slack**, **Suscriptores de MS Teams** y **Suscriptores de webhook**. Ahí es donde miras quién se ha apuntado, añades a alguien a mano o te dejas una entrada de **Notas** (`internalNote`) sobre un suscriptor concreto.

**Con un solo interruptor no basta.** El elemento **Suscribirse** de la barra de navegación de la página de estado solo aparece cuando **Mostrar página de suscriptores** (`showSubscriberPageOnStatusPage`) está activado *y* hay al menos un canal habilitado. Si activas **Habilitar suscriptores por correo electrónico** pero dejas **Mostrar página de suscriptores** apagado, los visitantes no tienen forma de llegar al formulario.

Esos mismos cinco interruptores aparecen una segunda vez dentro de la tarjeta **Ajustes de Suscriptores** de **Ajustes Avanzados**, junto a **Mostrar página de suscriptores**. Por debajo son las mismas columnas — elige una pantalla y quédate en ella, y mejor la página dedicada de **Ajustes de Suscriptores**, porque ahí es donde vive el resto de la configuración de suscriptores.

## Qué ve un visitante en la página Suscribirse

La página **Suscribirse** tiene un submenú con una pestaña por cada canal habilitado — **Correo electrónico**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — asignadas a `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` y `/subscribe/webhooks`. Cada pestaña pide lo mínimo que necesita:

- **Correo electrónico** — encabezado **Suscribirse por correo electrónico**, un campo **Su correo electrónico** con el marcador de posición `subscriber@company.com`.
- **SMS** — encabezado **Suscribirse por SMS**, un campo **Su número de teléfono** con el marcador de posición `+11234567890`.
- **Slack** — encabezado **Suscribirse vía Slack**, con **Nombre del espacio de trabajo de Slack** (se usa para validar) y **URL del webhook entrante de Slack**, marcador de posición `https://hooks.slack.com/services/...`.
- **MS Teams** — encabezado **Suscribirse vía Microsoft Teams**, con **Nombre del espacio de trabajo de Microsoft Teams** y **URL del webhook entrante de Microsoft Teams**, marcador de posición `https://outlook.office.com/webhook/...`.
- **Webhooks** — encabezado **Suscribirse por webhook**, un campo **URL del webhook**. En cada evento de la página de estado se envía ahí una solicitud `POST` en JSON.

El botón de envío dice **Suscribirse**, y una suscripción correcta muestra *Se ha suscrito correctamente.* La página también trae una división entre **Nueva suscripción** y **Gestionar suscripción existente**, para que quien ya se suscribió pueda volver a sus preferencias sin buscar un correo antiguo.

## Dejar que los suscriptores elijan recursos y tipos de eventos

Por defecto un suscriptor recibe todo lo de la página. Dos interruptores de la tarjeta **Ajustes avanzados de suscriptor** cambian eso:

- **Permitir a los suscriptores elegir recursos** (`allowSubscribersToChooseResources`) — apagado por defecto. Actívalo y el formulario de suscripción gana un interruptor **Suscribirse a todos los recursos**; desmárcalo y aparece **Seleccionar recursos para suscribirse**, para que el visitante escoja recursos concretos.
- **Permitir a los suscriptores elegir tipos de eventos** (`allowSubscribersToChooseEventTypes`) — apagado por defecto. Funciona igual: un interruptor **Suscribirse a todos los tipos de eventos** y, debajo, **Seleccionar tipos de eventos para suscribirse** cuando lo desmarcas.

Los tipos de evento son `Incident`, `Announcement` y `Scheduled Event`.

Esas decisiones se guardan en el registro del suscriptor como **Is Subscribed to All Resources** (`isSubscribedToAllResources`, true por defecto), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, true por defecto), **Subscribed to Resources** y **Subscribed to Event Types**.

Va bien para: una página que cubre varios productos. A un cliente que solo usa tu API no le apetece recibir un aviso cada vez que el sitio de marketing se tambalea — deja que acote la lista él mismo en lugar de verlo darse de baja del todo.

En la misma tarjeta están también las **Zonas horarias del suscriptor**.

## Doble confirmación por correo electrónico

Los suscriptores por correo siempre confirman. Cuando se crea un suscriptor con una dirección de correo y no se crea ya confirmado, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) se fuerza a `false` y se genera un **Subscription Confirmation Token** de seis dígitos. OneUptime envía entonces por correo un enlace de confirmación con esta forma: `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. El visitante aterriza en una página **Confirmar suscripción** y, cuando el proceso termina, ve *Suscripción confirmada con éxito*.

Los suscriptores por SMS, Slack, Microsoft Teams y webhook se saltan esto — se crean con `isSubscriptionConfirmed` ya puesto a `true`.

**Sin confirmar significa en silencio.** La consulta que recupera los suscriptores de una notificación filtra por `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Una dirección que nunca hizo clic en el enlace se quedará en tu lista de **Suscriptores de Correo** sin recibir nada. Si alguien jura que está suscrito pero no le llega nada, revisa esa columna primero.

No hay ningún interruptor para desactivar la confirmación por correo — es incondicional para cualquiera que se apunte desde la página de estado. Una columna aparte por suscriptor, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, true por defecto), controla el correo de «te has suscrito» que sale una vez que el suscriptor queda confirmado.

## Gestionar y cancelar una suscripción

Todo correo a un suscriptor lleva un enlace de baja con la forma `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Esa página se titula **Actualizar suscripción** y le dice al visitante que ahí puede cambiar sus preferencias o darse de baja. Contiene:

- Los selectores de recursos y de tipos de evento que la página permita.
- Un interruptor **Cancelar suscripción**, descrito como darse de baja de todos los recursos. Escribe en **Está dado de baja** (`isUnsubscribed`, false por defecto).
- Un botón de envío que dice **Actualizar suscripción**; al guardar se muestra *Sus cambios se han guardado.*

Quien haya perdido el enlace usa **Gestionar suscripción existente** en la página **Suscribirse** y pulsa **Enviar enlace de gestión**. OneUptime responde que se ha enviado un correo con el enlace y que revise la carpeta de spam si no llega.

Los endpoints detrás de todo esto son `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` y `PUT .../update-subscription/:statusPageId/:subscriberId`.

Darse de baja cambia una marca en vez de borrar una fila, así que el registro sigue en la lista del canal con **Está dado de baja** activado — útil cuando más adelante necesitas explicar por qué una dirección concreta dejó de recibir correo.

## De qué se avisa a los suscriptores

Los suscriptores reciben avisos de los tres tipos de evento de arriba, pero cada origen tiene su propio interruptor, así que nada se envía por accidente.

### Notificaciones de anuncios

El propio anuncio lleva **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), expuesto en el formulario de creación como la casilla **Notificar a suscriptores de la página de estado** y activado por defecto. Si el anuncio nombra monitores en **Monitores afectados (opcional)**, la notificación se limita a esos monitores; déjalo vacío y se avisa a todos los suscriptores.

### Eventos de mantenimiento programado

Un evento de mantenimiento programado tiene su propio conjunto de columnas de suscriptores: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, más **Subscriber notifications before the event** y **Next subscriber notification before the event at?** para los avisos anticipados. **Páginas de Estado** en el evento decide en qué páginas aparece, y **Should be visible on status page?** decide si aparece siquiera.

### Incidentes

`Incident` es el tercer tipo de evento. Qué hace que un incidente llegue a una página de estado en primer lugar — qué recursos toca y qué estados lo mantienen visible — se explica en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

La sección **Registros de notificación** del menú lateral de la página de estado (`{id}/notification-logs`) es donde vas cuando necesitas ver qué envió realmente la página.

## Personalizar las plantillas de notificación

La tarjeta **Plantillas de notificación** de **Ajustes de Suscriptores** lista las plantillas que usa esta página de estado, con las columnas **Nombre de la plantilla**, **Tipo de evento** y **Método de notificación** — así puedes variar el texto según el tipo de evento y el canal, en lugar de aceptar un único mensaje de la casa para todo.

Las plantillas de todo el proyecto viven un nivel más arriba, en **Páginas de Estado → Ajustes → Plantillas de Suscriptores**, junto a **Plantillas de Anuncios**.

## Pie de correo, SMTP personalizado y Twilio

Otras tres tarjetas de **Ajustes de Suscriptores** controlan cómo salen de tu proyecto los mensajes a suscriptores:

- **Ajustes del pie de página del correo electrónico** — **Habilitar texto personalizado del pie de página del correo electrónico** y **Texto de pie de página de notificación por correo electrónico para suscriptores** ponen tu propio pie en los correos a suscriptores.
- **SMTP personalizado** — **Configuración de SMTP personalizado** envía el correo a suscriptores a través de tu propio servidor en lugar del predeterminado.
- **Configuración de Twilio** — **Configuración de Twilio** es la cuenta de Twilio que se usa para los suscriptores por SMS.

Merece la pena configurar el SMTP personalizado pronto si tienes suscriptores por correo: el correo que sale de tu propio dominio tiene muchas menos papeletas de acabar filtrado, y muchas más de que se fíe de él el cliente que lo lee a las dos de la madrugada.

## Anuncios

Un anuncio es un registro a nivel de proyecto (el modelo `StatusPageAnnouncement`) que repartes a una o varias páginas de estado, opcionalmente limitado a monitores concretos, con una ventana de tiempo durante la cual se muestra.

Creas uno desde **Páginas de Estado → Más → Anuncios**, o desde **Anuncios** en el menú lateral de una página de estado concreta. El formulario de creación es un asistente de cuatro pasos:

1. **Información básica** — **Título del anuncio** (obligatorio, al menos dos caracteres), **Descripción** (Markdown, opcional) y **Adjuntos** para los archivos que deban acompañar al anuncio en la página de estado.
2. **Páginas de Estado** — **Mostrar anuncio en estas páginas de estado**, una selección múltiple obligatoria. Un mismo anuncio puede dirigirse a varias páginas a la vez.
3. **Recursos afectados** — **Monitores afectados (opcional)**. Si no seleccionas ninguno, se avisa a todos los suscriptores.
4. **Programación y ajustes** — **Comenzar a mostrar el anuncio en** (obligatorio, por defecto ahora mismo), **Dejar de mostrar el anuncio el** (opcional) y **Notificar a suscriptores de la página de estado** (activado por defecto).

Los visitantes leen los anuncios en `/announcements`, divididos en **Anuncios activos** y **Anuncios pasados**, cada uno con su marca de **Anunciado el**. Los anuncios que están en vivo también se fijan arriba en la página de resumen. Cuando no hay nada que mostrar, la página dice *Sin anuncios* con la nota de que no se ha publicado ninguno hasta ahora.

Los adjuntos se sirven desde `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, tras la misma comprobación de lectura que la propia página de estado — así que un adjunto de una página privada sigue siendo privado.

## Cómo funciona la programación de anuncios

**Show At** (`showAnnouncementAt`) y **End At** (`endAnnouncementAt`) lo gobiernan todo, pero la página de resumen y la lista de anuncios hacen preguntas distintas, y esa diferencia despista.

- **La página de resumen** muestra un anuncio cuando `showAnnouncementAt` ya pasó y `endAnnouncementAt` está en el futuro o vacío.
- **La lista `/announcements`** muestra los anuncios cuyo `showAnnouncementAt` cae dentro de **Mostrar historial de anuncios (en días)** (`showAnnouncementHistoryInDays`, 14 por defecto) y luego los separa en el cliente entre activos y pasados.

Dos consecuencias que conviene tener previstas:

- **Un anuncio sin fecha de fin no caduca nunca.** Deja **Dejar de mostrar el anuncio el** vacío y se queda fijado en la página de resumen indefinidamente. Pon fecha de fin a todo lo que tenga plazo.
- **Un anuncio antiguo pero aún activo puede desaparecer de la lista.** Si empezó hace más de `showAnnouncementHistoryInDays`, se cae de `/announcements` aunque siga en la página de resumen. Amplía la ventana de historial si mantienes avisos de larga duración.

Que los anuncios aparezcan siquiera lo controla la tarjeta **Ajustes del anuncio** de **Ajustes Avanzados**: **Mostrar anuncios** (`showAnnouncementsOnStatusPage`, true por defecto) y **Mostrar historial de anuncios (en días)** (14 por defecto). Con **Mostrar anuncios** apagado, el endpoint de anuncios rechaza la solicitud de plano.

## Plantillas de anuncios

Si publicas el mismo tipo de aviso una y otra vez — el recordatorio mensual de mantenimiento, una degradación recurrente de un tercero — déjalo preparado. **Páginas de Estado → Ajustes → Plantillas de Anuncios** guarda el modelo `StatusPageAnnouncementTemplate`, y su formulario pide **Nombre de la plantilla**, **Descripción de la plantilla**, **Título del anuncio**, **Descripción**, **Mostrar anuncio en estas páginas de estado**, **Monitores afectados (opcional)** y **Notificar a los suscriptores**, de modo que el reparto y la decisión de notificar se toman una vez y no cada vez.

## Suscriptores por webhook y protección contra SSRF

Los suscriptores por webhook reciben una solicitud `POST` en JSON en cada evento de la página de estado, lo que los convierte en la forma más fácil de llevar las actualizaciones de la página a un sistema propio — un chatbot, un panel interno, una cola de tickets.

Como suscribirse es una operación pública en una página pública, OneUptime protege el destino:

- Una **URL del webhook** genérica se valida antes de aceptarse, y se rechazan las direcciones privadas, de loopback, link-local y de metadatos de nube. No puedes apuntar una suscripción a algo dentro de la propia red del despliegue de OneUptime.
- Una **URL del webhook entrante de Slack** tiene que empezar por `https://hooks.slack.com/services/`.

Si una suscripción por webhook se rechaza al apuntarse, lo primero que hay que mirar es si la URL es interna o está mal formada.

## Qué leer a continuación

- [Visión general de las páginas de estado](/docs/status-pages/index) — qué es una página de estado y cómo está montada.
- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) — los monitores y grupos entre los que pueden elegir los suscriptores.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — dominios personalizados, logotipos y el aspecto de la página a la que enlazan tus correos.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué pone un incidente en una página de estado y qué lo quita.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — las reglas a nivel de proyecto detrás de la comunicación de incidentes.
