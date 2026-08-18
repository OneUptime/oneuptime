# Visión general de las páginas de estado

Una página de estado es la cara pública de todo lo que monitorizas: una URL que tus clientes pueden abrir en lugar de escribirte para preguntar si les pasa solo a ellos. Muestra el estado actual de los servicios que decidas exponer, los incidentes en los que estás trabajando, el mantenimiento que tienes planificado y cualquier anuncio que quieras fijar arriba.

Cuando algo se rompe a las 2 de la madrugada, la página de estado es lo primero que enlaza tu cola de soporte. Es también aquello desde lo que se notifica a tus suscriptores, así que conviene configurarla antes de necesitarla, no durante la interrupción.

Las páginas de estado viven en **Páginas de Estado** en la navegación lateral del panel, en el grupo **Esenciales**. Todo lo de esta página es por página de estado: un proyecto puede tener tantas como quiera —una pública para clientes, una privada para una audiencia interna, una por región para un mercado concreto.

## De un vistazo

- **Se crea con dos campos.** Una página de estado nueva solo pide **Nombre** y **Descripción**. Los recursos, la marca y los dominios se configuran después.
- **Los recursos son lo que ven los visitantes.** Cada fila de la página es un **Página de estado Recurso**: un monitor (o grupo de monitores) con su propio nombre para mostrar, información sobre herramientas y opciones de tiempo de actividad. Los grupos dividen una página larga en secciones y se pueden anidar.
- **Una URL de vista previa desde el primer día.** Toda página de estado obtiene un enlace de vista previa para que puedas mirarla antes de que exista un dominio personalizado.
- **Las rutas de cara al visitante están controladas por los ajustes.** Los incidentes, los anuncios, los eventos programados y la página de suscripción aparecen cada uno solo cuando su interruptor en **Ajustes Avanzados** está activado.
- **Tres formas de hacerla privada.** Usuarios privados, una contraseña maestra o SAML SSO / OIDC, más una lista blanca de IP.
- **A los suscriptores se les avisa automáticamente.** Los suscriptores por correo electrónico, SMS, Slack, Microsoft Teams y webhook pueden seguir una página, cada canal detrás de su propio interruptor.

## Términos clave

| Término                    | Qué significa                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Página de estado**       | Una página pública (o privada), con su propia marca, dominios, recursos y suscriptores. El modelo `StatusPage`.                                   |
| **Recurso**                | Una fila que ven los visitantes: un monitor o grupo de monitores mostrado en la página con un nombre para mostrar y opciones de tiempo de actividad. |
| **Grupo**                  | Una sección con nombre que contiene recursos. Los grupos se anidan dentro de otros grupos, y cada nivel agrega el estado de todo lo que hay debajo. |
| **Anuncio**                | Un mensaje que publicas en una o más páginas de estado, con una hora de inicio y una hora de fin opcional.                                        |
| **Suscriptor**             | Alguien (o algo) que sigue la página por correo electrónico, SMS, Slack, Microsoft Teams o un webhook.                                            |
| **Dominio personalizado**  | Un dominio tuyo —`status.example.com`— apuntado a la página con un CNAME y un certificado SSL.                                                    |
| **Usuario privado**        | Una cuenta que puede iniciar sesión en una página de estado privada. Independiente de los usuarios de tu proyecto de OneUptime.                   |

## Crear una página de estado

1. Abre **Páginas de Estado → Todas las Páginas de Estado** y haz clic en **Crear página de estado**.
2. En el modal **Create New Status Page**, rellena **Nombre** (obligatorio, al menos dos caracteres) y, opcionalmente, **Descripción**.
3. Haz clic en **Crear página de estado**.

Ese es todo el formulario de creación. La lista a la que vuelves muestra **Nombre**, **Descripción**, **Etiquetas** y **Propietarios**, y se puede filtrar por **Status Page ID**, **Nombre** y **Descripción**.

Abre la página nueva y aterrizas en su pantalla **Vista General**, que lleva dos tarjetas: **Status Page Preview URL** con un enlace a la propia página, y **Detalles de la página de estado**, donde puedes editar el nombre, la descripción y las etiquetas que acabas de establecer.

A continuación, en orden aproximado de utilidad:

- Añade recursos para que la página tenga algo — consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups).
- Establece el título de la página, el favicon, el logotipo y la portada, y luego adjunta un dominio personalizado — consulta [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains).
- Decide en qué canales puede suscribirse la gente — consulta [Suscriptores y anuncios](/docs/status-pages/subscribers).
- Ajusta lo que aparece en la página en **Ajustes Avanzados**.

## Dónde está cada cosa

Una vez abierta una página de estado, su propio menú lateral está agrupado en nueve secciones. Úsalo como mapa para el resto de este grupo de documentación.

| Sección                    | Qué contiene                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Básico**                 | **Vista General**, **Anuncios**, **Propietarios**.                                                                                                                  |
| **Recursos**               | Una única pantalla **Recursos**: los grupos a la izquierda, los monitores del grupo seleccionado a la derecha.                                                       |
| **Suscriptores**           | **Suscriptores de Correo**, **Suscriptores SMS**, **Suscriptores de Slack**, **Suscriptores de MS Teams**, **Suscriptores de webhook**, **Ajustes de Suscriptores**. |
| **Registros de notificación** | **Registros de notificación**: lo que se envió a los suscriptores.                                                                                              |
| **Auditoría**              | **Registros de Auditoría**.                                                                                                                                         |
| **Marca**                  | **Marca Esencial**, **HTML, CSS y JavaScript**, **Dominios Personalizados**, **Encabezado**, **Pie de Página**, **Página de Vista General**, **Idiomas**.            |
| **Seguridad**              | **Usuarios Privados**, **SSO**, **OIDC**, **SCIM**, **Ajustes de Autenticación**.                                                                                    |
| **IA**                     | **MCP**.                                                                                                                                                            |
| **Avanzado**               | **Monitor Rules**, **Estado Embebido**, **Informes**, **Campos Personalizados**, **Ajustes Avanzados**, **Eliminar Página de Estado**.                               |

Dos peculiaridades de nomenclatura que conviene conocer antes de ponerte a buscar:

- El elemento **Recursos** solo se llama **Recursos** cuando el proyecto tiene los grupos de monitores habilitados. Si no, dice **Monitores**. Es la misma pantalla en cualquier caso.
- No hay una página de Grupos aparte. Los grupos y los recursos se fusionaron, y la antigua ruta `/groups` ahora redirige a la pantalla de recursos.

Fuera de una página individual, la propia sección **Páginas de Estado** tiene una sección **Más** con **Anuncios**, y una sección **Ajustes** contraída que contiene **Plantillas de Anuncios**, **Plantillas de Suscriptores**, **Campos Personalizados**, **Reglas del propietario** y **Reglas de etiquetas**: estas son de todo el proyecto, compartidas entre todas las páginas de estado.

## Qué ven los visitantes

La página pública es su propia aplicación, con un pequeño conjunto de rutas:

- `/` — la **Vista General**.
- `/incidents` e `/incidents/:id` — la lista de incidentes y un incidente concreto.
- `/announcements` y `/announcements/:id`.
- `/scheduled-events` y `/scheduled-events/:id`.
- `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams`, `/subscribe/webhooks`.
- `/rss` — el feed.
- `/login`, `/sso` y `/master-password` — solo relevantes en una página privada.

La barra de navegación superior siempre muestra **Vista General**; el resto aparece solo cuando está habilitado. **Incidentes**, **Anuncios** y **Eventos Programados** necesitan cada uno su interruptor activado; **Subscribe** necesita tanto **Mostrar página de suscriptores** como al menos un canal de suscriptores habilitado. Una página privada obtiene además un elemento **Cerrar sesión**.

### La página de vista general

La vista general es la página que ve la mayoría de los visitantes. De arriba abajo muestra:

1. **Cualquier anuncio activo** — anuncios cuya hora de inicio ya pasó y cuya hora de fin aún no ha llegado.
2. **Un banner de estado general** — una única línea que resume si todos los recursos están afectados o solo algunos.
3. **Un porcentaje de tiempo de actividad general**, si lo activaste. Desactivado de forma predeterminada.
4. **Los grupos de recursos**, cada uno con sus recursos, su estado actual y sus barras de historial de tiempo de actividad.
5. **Incidentes Activos**.
6. **Eventos de mantenimiento programado**.

Una página recién creada y sin nada muestra un estado vacío que te dice que añadas recursos desde el panel, lo cual es tu señal para ir a la pantalla **Recursos**.

Para saber qué pone un incidente en esta página en primer lugar, y qué lo retira de nuevo, consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

## Elegir qué se muestra en la página

La mayoría de los interruptores de visualización viven en un solo sitio: **Páginas de Estado → tu página → Avanzado → Ajustes Avanzados**. Cada tarjeta tiene su propio botón **Edit Settings**.

**Ajustes de incidentes**:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) — activado de forma predeterminada. Desactivarlo también retira el elemento de navegación **Incidentes**.
- **Mostrar historial de incidentes (en días)** (`showIncidentHistoryInDays`) — hasta dónde llega hacia atrás la lista de incidentes. Predeterminado: 14.
- **Mostrar etiquetas de incidentes** (`showIncidentLabelsOnStatusPage`) — desactivado de forma predeterminada.

**Ajustes de episodios** — los mismos tres interruptores para los episodios de incidente: **Mostrar episodios** (`showEpisodesOnStatusPage`, activado de forma predeterminada), **Mostrar historial de episodios (en días)** (predeterminado 14) y **Mostrar etiquetas de episodios** (desactivado de forma predeterminada). Los episodios son su propio modelo con sus propios puntos de conexión, no una vista de los incidentes.

**Ajustes de anuncios**:

- **Mostrar anuncios** (`showAnnouncementsOnStatusPage`) — activado de forma predeterminada.
- **Mostrar historial de anuncios (en días)** (`showAnnouncementHistoryInDays`) — predeterminado 14.

**Ajustes de eventos programados**:

- **Mostrar eventos de mantenimiento programado** (`showScheduledMaintenanceEventsOnStatusPage`) — activado de forma predeterminada.
- **Mostrar historial de eventos programados (en días)** (`showScheduledEventHistoryInDays`) — predeterminado 14.
- **Mostrar etiquetas de eventos** (`showScheduledEventLabelsOnStatusPage`) — desactivado de forma predeterminada.

**Ajustes del historial de tiempo de actividad**:

- **Mostrar historial de tiempo de actividad (en días)** (`showUptimeHistoryInDays`) — la longitud de la barra de tiempo de actividad junto a cada recurso. Predeterminado 90 y debe estar entre 1 y 90. Todas las opciones **Mostrar % de tiempo de actividad** y **Mostrar gráfico de historial de estado** de un recurso o grupo leen este número.

**Ajustes de suscriptores**:

- **Mostrar página de suscriptores** (`showSubscriberPageOnStatusPage`) — activado de forma predeterminada, más los cinco interruptores de habilitación por canal. Los mismos interruptores de canal aparecen también en la pantalla dedicada **Ajustes de Suscriptores** bajo la sección **Suscriptores**; considera esa el sitio canónico para configurarlos.

**Marca «Powered By OneUptime»**:

- **Ocultar la marca Powered By OneUptime** — desactivado de forma predeterminada, así que el pie de página del visitante dice «Powered by OneUptime» hasta que lo actives.

**Dónde están los colores.** Los colores de la barra de tiempo de actividad no están aquí: el **Color de barra predeterminado**, las reglas de color de barra, los **Estados de monitor de tiempo de inactividad** y **Mostrar porcentaje de tiempo de actividad general** viven todos en **Páginas de Estado → tu página → Marca → Página de Vista General**. No hay ningún ajuste de tema o color de marca en ninguna parte; cualquier cosa más allá de esos controles se hace con **CSS personalizado**.

## Previsualizar antes de publicar

La pantalla **Vista General** de toda página de estado lleva una tarjeta **Status Page Preview URL** con un enlace directo a la página. Úsala mientras sigues añadiendo recursos y antes de que exista ningún dominio personalizado.

Entre bastidores, toda ruta pública tiene una gemela de vista previa bajo `/status-page/{statusPageId}/...`: una vista general de vista previa, una lista de incidentes de vista previa, una página de suscripción de vista previa, y así sucesivamente. Eso significa que una URL o una captura tomada de la vista previa del panel no coincidirá con lo que ve un cliente una vez adjuntado un dominio personalizado, así que revisa dos veces cualquier enlace que pegues en un runbook o un correo.

## Restringir quién puede ver la página

No toda página de estado es para el público. Todos los controles están bajo la sección **Seguridad**.

### Usuarios privados

Desactiva **Es visible para el público** en **Páginas de Estado → tu página → Seguridad → Ajustes de Autenticación** (la columna `isPublicStatusPage`). Los visitantes aterrizan entonces en `/login` y tienen que iniciar sesión.

Añade a las personas que pueden iniciar sesión en **Páginas de Estado → tu página → Seguridad → Usuarios Privados**. Hay una acción **Añadir en masa**: pega una lista de direcciones de correo y cada una recibe un correo de invitación. Los usuarios privados tienen su propio flujo de contraseña olvidada y restablecimiento de contraseña, independiente de tus cuentas de proyecto de OneUptime.

### Contraseña maestra

**Ajustes de Autenticación** tiene también una tarjeta **Contraseña maestra** con un interruptor **Requerir contraseña maestra** y la propia contraseña. Los visitantes llegan entonces a `/master-password` y desbloquean la página con un único secreto compartido.

**La contraseña maestra y los usuarios privados no se acumulan.** Mientras la contraseña maestra está activada, la autenticación de usuarios privados está deshabilitada, y la pantalla **Usuarios Privados** muestra un aviso que te lo indica.

### SSO y OIDC

Para una página privada vinculada a tu proveedor de identidad, **Páginas de Estado → tu página → Seguridad → SSO** configura SAML (URL de inicio de sesión, emisor, certificado x509, métodos de firma y resumen) y **Páginas de Estado → tu página → Seguridad → OIDC** configura OpenID Connect (URL de descubrimiento, emisor, ID y secreto de cliente, ámbitos, nombres de reclamación). **SCIM** aprovisiona usuarios privados desde el IdP automáticamente. Estas funciones están sujetas a una característica de plan, así que puede que no estén disponibles en todas las instalaciones.

Una tarjeta **SSO Settings** expone **Forzar SSO para el inicio de sesión** (`requireSsoForLogin`, desactivado de forma predeterminada). Prueba tu configuración de SSO antes de activarlo: si no funciona, te dejarás fuera de la página de estado.

### Lista blanca de IP

**Ajustes de Autenticación** lleva también una tarjeta **Lista blanca de IP**, respaldada por la columna `ipWhitelist`, para páginas que solo deberían responder desde redes conocidas.

## La insignia incrustable y el feed RSS

Dos formas de mostrar el estado en algún sitio que no sea la propia página.

**Insignia de estado incrustada.** Activa **Habilitar insignia de estado incrustada** (`enableEmbeddedOverallStatus`, desactivado de forma predeterminada) en la tarjeta **Insignia de estado incrustada** de **Páginas de Estado → tu página → Avanzado → Estado Embebido**. Va acompañada de un `embeddedOverallStatusToken` y sirve la insignia desde `/badge/:statusPageId`, de modo que puedes colocar el estado general actual en tu documentación, en el pie de tu aplicación o en una página de marketing.

**Feed RSS.** Toda página de estado sirve `/rss`: un feed titulado «{status page name} Updates» cuyos elementos llevan los prefijos `Incident: `, `Announcement: ` y `Scheduled Maintenance: `. Práctico para quien prefiera canalizar tus actualizaciones a un lector o a un bot de chat en lugar de suscribirse por correo.

Si prefieres extraer los datos tú mismo, la página de estado está respaldada por puntos de conexión públicos de lectura para la vista general, los incidentes, los eventos de mantenimiento programado, los anuncios y los episodios: consulta [API pública](/docs/status-pages/public-api).

## Qué leer a continuación

- [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) — poner monitores en la página y organizarlos en secciones.
- [Marca y dominios de la página de estado](/docs/status-pages/branding-and-domains) — logotipo, favicon, pie de página, código personalizado y apuntar tu propio dominio a la página.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — los cinco canales de suscriptores, el doble consentimiento y la publicación de anuncios.
- [API pública](/docs/status-pages/public-api) — leer los datos de la página de estado mediante programación.
- [Visión general de los incidentes](/docs/incidents/index) — los eventos que aparecen en la página.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hace que un incidente aparezca en una página de estado y qué lo retira.
