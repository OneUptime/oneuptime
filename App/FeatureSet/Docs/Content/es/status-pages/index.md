# Visión general de las páginas de estado

Una página de estado es la cara pública de todo lo que monitorizas: una única URL que tus clientes pueden abrir en lugar de escribirte para preguntar si les pasa solo a ellos. Muestra el estado actual de los servicios que decidas exponer, los incidentes en los que estás trabajando, el mantenimiento que tienes planificado y cualquier anuncio que quieras fijar arriba.

Cuando algo se rompe a las 2 de la madrugada, la página de estado es lo primero que enlaza tu cola de soporte. Es también el sitio desde el que se avisa a tus suscriptores, así que merece la pena montarla antes de necesitarla y no en plena caída.

Las páginas de estado viven en **Páginas de Estado**, en la navegación izquierda del panel, dentro del grupo **essentials**. Todo lo de esta página es por página de estado: un proyecto puede tener tantas como quiera —una pública para clientes, una privada para una audiencia interna, una por región para un mercado concreto.

## De un vistazo

- **Se crea con dos campos.** Una página de estado nueva solo pide **Nombre** y **Descripción**. Los recursos, la marca y los dominios se configuran después.
- **Los recursos son lo que ven los visitantes.** Cada fila de la página es un **Página de estado Recurso**: un monitor (o un grupo de monitores) con su propio nombre para mostrar, su información sobre herramientas y sus opciones de tiempo de actividad. Los grupos parten una página larga en secciones y se pueden anidar.
- **Una URL de vista previa desde el primer día.** Toda página de estado recibe un enlace de vista previa para que puedas mirarla antes de que exista un dominio personalizado.
- **Las rutas de cara al visitante dependen de los ajustes.** Los incidentes, los anuncios, los eventos programados y la página de suscripción aparecen solo cuando su interruptor en **Ajustes Avanzados** está activado.
- **Tres formas de hacerla privada.** Usuarios privados, una contraseña maestra o SAML SSO / OIDC, más una lista blanca de IP.
- **A los suscriptores se les avisa solo.** Los suscriptores por correo, SMS, Slack, Microsoft Teams y webhook pueden seguir una página, cada canal detrás de su propio interruptor.

## Términos clave

| Término                      | Qué significa                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Página de estado**         | Una página pública (o privada), con su propia marca, sus dominios, sus recursos y sus suscriptores. El modelo `StatusPage`.             |
| **Recurso**                  | Una fila de las que ven los visitantes: un monitor o grupo de monitores expuesto en la página con un nombre para mostrar y opciones de tiempo de actividad. |
| **Grupo**                    | Una sección con nombre que contiene recursos. Los grupos se anidan dentro de otros grupos, y cada nivel agrega el estado de todo lo que tiene debajo. |
| **Anuncio**                  | Un mensaje que publicas en una o varias páginas de estado, con hora de inicio y una hora de fin opcional.                               |
| **Suscriptor**               | Alguien (o algo) que sigue la página por correo, SMS, Slack, Microsoft Teams o un webhook.                                              |
| **Dominio personalizado**    | Un dominio tuyo —`status.example.com`— apuntado a la página con un CNAME y un certificado SSL.                                          |
| **Usuario privado**          | Una cuenta que puede iniciar sesión en una página de estado privada. Es independiente de los usuarios de tu proyecto de OneUptime.      |

## Crear una página de estado

1. Abre **Páginas de Estado → Todas las Páginas de Estado** y pulsa **Crear página de estado**.
2. En el modal **Create New Status Page**, rellena **Nombre** (obligatorio, al menos dos caracteres) y, si quieres, **Descripción**.
3. Pulsa **Crear página de estado**.

Ese es todo el formulario de creación. La lista a la que vuelves muestra **Nombre**, **Descripción**, **Etiquetas** y **Propietarios**, y se puede filtrar por **ID de la página de estado**, **Nombre** y **Descripción**.

Abre la página nueva y aterrizas en su pantalla **Vista General**, que trae dos tarjetas: **Status Page Preview URL**, con un enlace a la página en sí, y **Detalles de la página de estado**, donde editas el nombre, la descripción y las etiquetas que acabas de poner.

Lo siguiente, más o menos por orden de utilidad:

- Añade recursos para que la página tenga algo que enseñar; consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups).
- Pon el título, el favicon, el logotipo y la portada, y luego engancha un dominio personalizado; consulta [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains).
- Decide en qué canales puede suscribirse la gente; consulta [Suscriptores y anuncios](/docs/status-pages/subscribers).
- Ajusta qué se muestra en la página desde **Ajustes Avanzados**.

## Dónde vive cada cosa

Una vez abierta una página de estado, su propio menú lateral izquierdo se agrupa en nueve secciones. Úsalo como mapa del resto de esta documentación.

| Sección                        | Qué contiene                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Básico**                     | **Vista General**, **Anuncios**, **Propietarios**.                                                                                                               |
| **Recursos**                   | Una única pantalla **Recursos**: los grupos a la izquierda, los monitores del grupo seleccionado a la derecha.                                                    |
| **Suscriptores**               | **Suscriptores de Correo**, **Suscriptores SMS**, **Suscriptores de Slack**, **Suscriptores de MS Teams**, **Suscriptores de webhook**, **Ajustes de Suscriptores**. |
| **Registros de notificación**  | **Registros de notificación**: lo que se envió a los suscriptores.                                                                                               |
| **Auditoría**                  | **Registros de Auditoría**.                                                                                                                                      |
| **Marca**                      | **Marca Esencial**, **HTML, CSS y JavaScript**, **Dominios Personalizados**, **Encabezado**, **Pie de Página**, **Página de Vista General**, **Idiomas**.         |
| **Seguridad**                  | **Usuarios Privados**, **SSO**, **OIDC**, **SCIM**, **Ajustes de Autenticación**.                                                                                |
| **IA**                         | **MCP**.                                                                                                                                                         |
| **Avanzado**                   | **Monitor Rules**, **Estado Embebido**, **Informes**, **Campos Personalizados**, **Ajustes Avanzados**, **Eliminar Página de Estado**.                            |

Dos rarezas de nomenclatura que conviene saber antes de ponerte a buscar:

- El elemento **Recursos** solo se llama **Recursos** cuando el proyecto tiene habilitados los grupos de monitores. Si no, pone **Monitores**. Es la misma pantalla en ambos casos.
- No hay una página de grupos aparte. Los grupos y los recursos se fusionaron, y la antigua ruta `/groups` ahora redirige a la pantalla de recursos.

Fuera de una página concreta, la sección **Páginas de Estado** tiene a su vez una sección **Más** con **Anuncios**, y una sección **Ajustes** plegada que contiene **Plantillas de Anuncios**, **Plantillas de Suscriptores**, **Campos Personalizados**, **Reglas del propietario** y **Reglas de etiquetas**: estas son de todo el proyecto y las comparten todas las páginas de estado.

## Lo que ven los visitantes

La página pública es una aplicación propia, con un conjunto reducido de rutas:

- `/` — la **Vista General**.
- `/incidents` y `/incidents/:id` — la lista de incidencias y una incidencia concreta.
- `/announcements` y `/announcements/:id`.
- `/scheduled-events` y `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — el feed.
- `/login`, `/sso` y `/master-password` — solo relevantes en una página privada.

La barra de navegación superior siempre muestra **Resumen**; el resto aparece solo cuando está habilitado. **Incidencias**, **Anuncios** y **Eventos programados** necesitan cada uno su interruptor activado; **Suscribirse** necesita tanto **Mostrar página de suscriptores** como al menos un canal de suscripción habilitado. Una página privada gana además un elemento **Cerrar sesión**.

### La página de resumen

El resumen es lo único que la mayoría de los visitantes llegará a ver. De arriba abajo muestra:

1. **Los anuncios en curso** — los anuncios cuya hora de inicio ya pasó y cuya hora de fin todavía no.
2. **Un banner de estado general** — una sola línea que resume si están afectados todos los recursos o solo algunos.
3. **Un porcentaje de tiempo de actividad general**, si lo activaste. Desactivado de forma predeterminada.
4. **Los grupos de recursos**, cada uno con sus recursos, su estado actual y sus barras de historial de tiempo de actividad.
5. **Incidencias activas**.
6. **Eventos de mantenimiento programado**.

Una página recién creada y todavía vacía muestra un estado vacío que te dice que añadas recursos desde el panel, lo cual es tu señal para irte a la pantalla **Recursos**.

Para saber qué pone un incidente en esta página y qué lo quita de ella, consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

## Elegir qué se muestra en la página

Casi todos los interruptores de visualización están en el mismo sitio: **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados**. Cada tarjeta tiene su propio botón **Edit Settings**.

**Ajustes de incidentes**:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) — activado de forma predeterminada. Desactivarlo también quita el elemento **Incidencias** de la navegación.
- **Mostrar historial de incidentes (en días)** (`showIncidentHistoryInDays`) — hasta dónde llega hacia atrás la lista de incidentes. El valor predeterminado es 14.
- **Mostrar etiquetas de incidentes** (`showIncidentLabelsOnStatusPage`) — desactivado de forma predeterminada.

**Ajustes del episodio** — los mismos tres interruptores para los episodios de incidente: **Mostrar episodios** (`showEpisodesOnStatusPage`, activado de forma predeterminada), **Mostrar historial de episodios (en días)** (predeterminado 14) y **Mostrar etiquetas de episodios** (desactivado de forma predeterminada). Los episodios son un modelo propio con sus propios endpoints, no una vista de los incidentes.

**Ajustes del anuncio**:

- **Mostrar anuncios** (`showAnnouncementsOnStatusPage`) — activado de forma predeterminada.
- **Mostrar historial de anuncios (en días)** (`showAnnouncementHistoryInDays`) — predeterminado 14.

**Ajustes de evento programado**:

- **Mostrar eventos de mantenimiento programado** (`showScheduledMaintenanceEventsOnStatusPage`) — activado de forma predeterminada.
- **Mostrar historial de eventos programados (en días)** (`showScheduledEventHistoryInDays`) — predeterminado 14.
- **Mostrar etiquetas de eventos** (`showScheduledEventLabelsOnStatusPage`) — desactivado de forma predeterminada.

**Ajustes del historial de tiempo de actividad**:

- **Mostrar historial de tiempo de actividad (en días)** (`showUptimeHistoryInDays`) — la longitud de la barra de tiempo de actividad que hay junto a cada recurso. El valor predeterminado es 90 y tiene que estar entre 1 y 90. Cada opción **Mostrar % de tiempo de actividad** y **Mostrar gráfico de historial de estado** de un recurso o un grupo lee este número.

**Ajustes de Suscriptores**:

- **Mostrar página de suscriptores** (`showSubscriberPageOnStatusPage`) — activado de forma predeterminada, junto con los cinco interruptores de habilitación por canal. Esos mismos interruptores de canal aparecen también en la pantalla dedicada **Ajustes de Suscriptores**, bajo la sección **Suscriptores**; trata esa como el sitio canónico para tocarlos.

**Marca "Powered By OneUptime"**:

- **Ocultar la marca Powered By OneUptime** — desactivado de forma predeterminada, así que el pie del visitante dice "Powered by OneUptime" hasta que lo actives.

**Dónde están los colores.** Los colores de la barra de tiempo de actividad no están aquí: el **Color de barra predeterminado**, las reglas de color de las barras, los **Estados de monitor de tiempo de inactividad** y **Mostrar porcentaje de tiempo de actividad general** viven todos en **Páginas de Estado → tu página → Marca → Página de Vista General**. No hay ningún ajuste de tema ni de color de marca en ninguna parte; todo lo que vaya más allá de esos controles se hace con **CSS personalizado**.

## Previsualizar antes de publicar

La pantalla **Vista General** de toda página de estado lleva una tarjeta **Status Page Preview URL** con un enlace directo a la página. Úsala mientras sigues añadiendo recursos y antes de que exista ningún dominio personalizado.

Por debajo, cada ruta pública tiene su gemela de vista previa bajo `/status-page/{statusPageId}/...`: un resumen de vista previa, una lista de incidencias de vista previa, una página de suscripción de vista previa, etcétera. Eso significa que una URL o una captura tomada desde la vista previa del panel no coincidirá con lo que ve un cliente una vez enganchado un dominio personalizado, así que revisa dos veces cualquier enlace que pegues en un runbook o en un correo.

## Restringir quién puede ver la página

No toda página de estado es para el público. Todos los controles están bajo la sección **Seguridad**.

### Usuarios privados

Desactiva **Es visible para el público** en **Páginas de Estado → tu página → Seguridad → Ajustes de Autenticación** (la columna `isPublicStatusPage`). Los visitantes aterrizan entonces en `/login` y tienen que iniciar sesión.

Añade a quienes puedan iniciar sesión en **Páginas de Estado → tu página → Seguridad → Usuarios Privados**. Hay una acción **Añadir en masa**: pegas una lista de direcciones de correo y cada una recibe un correo de invitación. Los usuarios privados tienen su propio flujo de contraseña olvidada y de restablecimiento, separado de las cuentas de tu proyecto de OneUptime.

### Contraseña maestra

**Ajustes de Autenticación** tiene además una tarjeta **Contraseña maestra** con un interruptor **Requerir contraseña maestra** y la contraseña en sí. Los visitantes llegan entonces a `/master-password` y desbloquean la página con un único secreto compartido.

**La contraseña maestra y los usuarios privados no se acumulan.** Mientras la contraseña maestra esté activa, la autenticación de usuarios privados queda deshabilitada, y la pantalla **Usuarios Privados** te lo avisa con un banner.

### SSO y OIDC

Para una página privada atada a tu proveedor de identidad, **Páginas de Estado → tu página → Seguridad → SSO** configura SAML (URL de inicio de sesión, emisor, certificado x509, métodos de firma y de resumen) y **Páginas de Estado → tu página → Seguridad → OIDC** configura OpenID Connect (URL de descubrimiento, emisor, ID y secreto de cliente, ámbitos, nombres de claims). **SCIM** aprovisiona usuarios privados desde el IdP automáticamente. Todo esto depende de una funcionalidad de plan, así que puede no estar disponible en toda instalación.

Una tarjeta **Ajustes de SSO** expone **Forzar SSO para el inicio de sesión** (`requireSsoForLogin`, desactivado de forma predeterminada). Prueba tu configuración de SSO antes de activarlo: si no funciona, te dejarás fuera de tu propia página de estado.

### Lista blanca de IP

**Ajustes de Autenticación** lleva también una tarjeta **Lista blanca de IP**, respaldada por la columna `ipWhitelist`, para las páginas que solo deban responder desde redes conocidas.

## La insignia incrustable y el feed RSS

Dos maneras de sacar el estado a algún sitio que no sea la propia página.

**Insignia de estado incrustada.** Activa **Habilitar insignia de estado incrustada** (`enableEmbeddedOverallStatus`, desactivado de forma predeterminada) en la tarjeta **Insignia de estado incrustada**, en **Páginas de Estado → tu página → Avanzado → Estado Embebido**. Va acompañada de un `embeddedOverallStatusToken` y sirve la insignia desde `/badge/:statusPageId`, así que puedes colocar el estado general actual en tu documentación, en el pie de tu aplicación o en una página de marketing.

**Feed RSS.** Toda página de estado sirve `/rss` — un feed titulado "{nombre de la página de estado} Updates" cuyos elementos llevan los prefijos `Incident: `, `Announcement: ` y `Scheduled Maintenance: `. Práctico para quien prefiera canalizar tus actualizaciones a un lector o a un bot de chat antes que suscribirse por correo.

Si prefieres tirar tú de los datos, la página de estado se apoya en endpoints públicos de lectura para el resumen, los incidentes, los eventos de mantenimiento programado, los anuncios y los episodios; consulta [API pública](/docs/status-pages/public-api).

## Qué leer a continuación

- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) — poner monitores en la página y organizarlos en secciones.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — logotipo, favicon, pie de página, código propio y apuntar tu dominio a la página.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — los cinco canales de suscripción, el doble consentimiento y la publicación de anuncios.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Visión general de los incidentes](/docs/incidents/index) — los eventos que acaban apareciendo en la página.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hace que un incidente aparezca en una página de estado y qué lo quita.
