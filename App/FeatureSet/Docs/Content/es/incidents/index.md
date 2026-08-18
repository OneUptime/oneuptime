# Visión general de los incidentes

Un incidente en OneUptime es el registro en torno al cual se reúne tu equipo cuando algo se rompe. Lleva un número, un título, una severidad, un estado actual, los recursos a los que afecta y todo lo que tu equipo anota mientras responde: notas, causa raíz, pasos de remediación y un feed de solo anexado que registra quién hizo qué.

Los incidentes son lo que convierte un monitor en rojo en una respuesta coordinada. Declarar uno avisa a la rotación de guardia adecuada, añade propietarios que reciben notificaciones de cada cambio, inicia runbooks y —si así lo quieres— publica la interrupción en tu página de estado pública para que los clientes dejen de abrir tickets preguntando si ya lo sabes.

Puedes declarar un incidente a mano a las 3 de la madrugada, o dejar que un monitor lo declare por ti en cuanto se cumplan sus criterios. En cualquiera de los dos casos el incidente es el mismo objeto, con el mismo ciclo de vida y el mismo rastro documental al final.

## De un vistazo

- **Funcionalidad de primer nivel** — **Incidentes** en la navegación lateral del panel, en `/dashboard/{projectId}/incidents`.
- **Tres estados predefinidos** — **Identified**, **Reconocido** y **Resuelto** se crean para cada proyecto nuevo. Puedes añadir los tuyos; los tres predefinidos se pueden renombrar y recolorear, pero nunca eliminar.
- **Tres severidades predefinidas** — **Critical Incident**, **Major Incident** y **Minor Incident**. La severidad es una etiqueta con un color y un orden: no conlleva ningún comportamiento propio.
- **Cuatro formas de entrar** — el asistente **Declarar incidente**, **Crear desde plantilla**, una regla de criterios de monitor o `POST /api/incident`.
- **Numerados por proyecto** — cada incidente recibe un número de incidente, mostrado como `#42` de forma predeterminada o con tu propio prefijo, como `INC-42`.
- **Dos tipos de notas** — notas privadas (notas internas) para tu equipo, notas públicas para los suscriptores de la página de estado.
- **Los ajustes están en Incidentes, no en Ajustes del proyecto** — estados, severidades, plantillas, campos personalizados y los motores de reglas están todos en **Incidentes → Ajustes** e **Incidentes → Reglas**.

## Términos clave

Un puñado de palabras aparece en todas las demás páginas de esta sección. Aclara estas primero.

| Término                    | Qué significa                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incidente**              | El registro en sí: título, descripción, severidad, estado actual, recursos afectados y todo lo que se escribe en él durante la respuesta.                             |
| **Estado del incidente**   | En qué punto de su ciclo de vida está el incidente. Una fila con alcance de proyecto con un nombre, un color y un `order`, más los indicadores que le dan significado. |
| **Severidad del incidente**| Cuánto duele. Una fila con alcance de proyecto con un nombre, un color y un `order`. Puramente una clasificación: nada en el producto trata una severidad de forma especial. |
| **Número de incidente**    | Un contador por proyecto que se muestra como `#42`, o con un prefijo que configures, como `INC-42`.                                                                  |
| **Recursos afectados**     | Los monitores, hosts, clústeres de Kubernetes, hosts de Docker, servicios y demás infraestructura que adjuntas al incidente.                                          |
| **Nota pública**           | Una actualización escrita para los lectores y suscriptores de la página de estado. Se muestra en la línea de tiempo de la página de estado.                           |
| **Nota privada**           | Una nota interna (el modelo `IncidentInternalNote`) para el equipo que responde. Nunca llega a una página de estado.                                                  |
| **Propietario**            | Un usuario o equipo responsable del incidente. Los propietarios reciben notificaciones cuando se crea, cuando se publican notas y cuando cambia el estado.            |
| **Incidente Feed**         | La línea de tiempo de actividad de solo anexado en la **Vista General** del incidente, que registra cambios de estado, notas, cambios de propietario, ejecuciones de reglas y notificaciones. |
| **Línea de Tiempo de Estado** | El registro de en qué estado estuvo el incidente, cuándo y durante cuánto tiempo, con el estado de notificación a suscriptores de cada transición.                 |

## Los tres estados que OneUptime crea para cada proyecto

Cuando se crea un proyecto, OneUptime genera exactamente tres estados de incidente, en este orden:

| Estado           | Orden | Color                | Qué significa                                                                    |
| ---------------- | ----- | -------------------- | -------------------------------------------------------------------------------- |
| **Identified**   | 1     | Rojo (`#fd625e`)     | El estado en el que aterriza un incidente recién creado. Este es el estado de creación. |
| **Reconocido**   | 2     | Amarillo (`#ffbf53`) | Alguien ha tomado el incidente y está trabajando en él.                          |
| **Resuelto**     | 3     | Verde (`#2ab57d`)    | El incidente ha terminado. Resolverlo es lo que lo retira de tu página de estado. |

Los nombres son solo etiquetas: lo que realmente impulsa el comportamiento son tres booleanos en la fila del estado: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Se espera que solo un estado por proyecto tenga cada indicador.

Esa distinción importa más de lo que parece:

- `isCreatedState` decide dónde empieza un incidente nuevo. Si no se selecciona explícitamente un estado al crearlo, OneUptime busca el estado de creación del proyecto y lo usa.
- `isAcknowledgedState` e `isResolvedState` gobiernan los botones **Acknowledge** y **Resolver** de la cabecera del incidente, los dos mosaicos de estadísticas de la **Vista General** del incidente y la insignia con el recuento de **Incidentes Activos** en el menú lateral.
- **Incidentes Activos** se define puramente como «el estado actual no es el estado resuelto». Por tanto, cualquier estado personalizado que añadas está activo salvo que sea el resuelto.

**Fíjate en la nomenclatura.** El primer estado predefinido se llama **Identified**, aunque varias descripciones dentro del producto lo siguen llamando el estado de creación. Si buscas «Created» en la lista de estados de tu proyecto, es la fila llamada **Identified**.

Puedes añadir tus propios estados en **Incidentes → Ajustes → Estado del Incidente**. Los estados nuevos se añaden al final de la lista ordenada y puedes arrastrar para reordenarlos. Los tres estados con indicadores no se pueden eliminar —OneUptime lo impide— pero sí puedes renombrarlos y recolorearlos, que es la razón por la que la interfaz lee los nombres de estado de forma dinámica.

El orden se aplica de verdad, no es cosmético: un incidente no puede pasar a un estado que esté antes en el orden que el actual.

El detalle completo está en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

## Las tres severidades que OneUptime crea para cada proyecto

Todo proyecto nuevo recibe también tres severidades:

| Severidad             | Orden | Color                | Qué significa                                                          |
| --------------------- | ----- | -------------------- | ---------------------------------------------------------------------- |
| **Critical Incident** | 1     | Granate (`#b70400`)  | Impacto muy alto en el cliente, requiere una respuesta inmediata.      |
| **Major Incident**    | 2     | Rojo (`#fd625e`)     | Impacto significativo, normalmente requiere una respuesta inmediata.   |
| **Minor Incident**    | 3     | Amarillo (`#ffbf53`) | Impacto bajo, normalmente se atiende en horario laboral.               |

Las descripciones predefinidas completas están en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

Las severidades tienen `name`, `description`, `color` y `order` y nada más. No hay indicadores, y ninguna ruta de código trata «Critical Incident» de forma distinta a cualquier otra fila. La severidad es la forma en que las personas clasifican, y está disponible como criterio de coincidencia cuando escribes reglas de guardia, pero elegir una severidad no avisa a nadie por sí sola.

Edita o añade severidades en **Incidentes → Ajustes → Gravedad del Incidente**.

## La vida de un incidente

### 1. Se declara

Cuatro rutas llevan al mismo objeto:

- **A mano** — desde la lista de incidentes, haz clic en **Declarar incidente**. Eso abre el asistente **Declarar nuevo incidente**, de cinco pasos: **Detalles del incidente**, **Recursos afectados**, **Roles de Incidente**, **De guardia**, **Más**.
- **Desde una plantilla** — haz clic en **Crear desde plantilla** y elige una **Plantillas de Incidentes** guardada. Las plantillas rellenan de antemano título, descripción, severidad, estado inicial, recursos, políticas de guardia, propietarios y etiquetas.
- **Desde un monitor** — una regla de criterios de monitor con el interruptor «declarar un incidente» activado crea el incidente automáticamente en cuanto sus filtros coinciden. Los títulos y descripciones ahí admiten plantillas `{{variable}}`.
- **Mediante la API** — `POST /api/incident` con una clave de API. El servidor rellena por ti `declaredAt`, el estado de creación y el número de incidente.

Consulta [Declarar un incidente](/docs/incidents/declaring-incidents) para el recorrido campo por campo.

### 2. Las personas adecuadas se enteran

Al crearse, OneUptime ejecuta la automatización que hayas configurado: reglas de etiquetas, reglas de guardia, reglas de propietario y reglas de runbook. Cualquier política de guardia adjunta al incidente —manualmente, desde una plantilla o incorporada por una regla de guardia coincidente— se ejecuta en paralelo.

Los propietarios reciben notificaciones por correo electrónico, SMS, llamada, push y WhatsApp, sujetas a las preferencias de notificación de cada usuario. Si un incidente no tiene ningún propietario, la notificación recae en los propietarios del proyecto en lugar de descartarse.

Si el incidente es visible en una página de estado y las notificaciones a suscriptores están habilitadas, también se avisa a los suscriptores. Las notificaciones se disparan por cron y se ejecutan cada minuto, así que espera hasta alrededor de un minuto de retraso en lugar de un envío instantáneo.

### 3. Tu equipo trabaja en él

Quienes responden reconocen el incidente, adjuntan recursos afectados, ejecutan runbooks, asignan roles de incidente y van anotando lo que descubren: notas privadas para el equipo, notas públicas para los clientes, más las páginas **Causa Raíz** y **Remediación** cuando el panorama se aclara. Todo lo que hacen aterriza en el **Incidente Feed** de la página **Vista General**.

### 4. Se resuelve

Hacer clic en **Resolver** mueve el incidente al estado resuelto, sella la línea de tiempo de estado, detiene el reloj de duración y retira el incidente de la sección activa de cualquier página de estado en la que apareciera. No hace falta que cambie nada más para que eso ocurra: el indicador del estado resuelto es lo que mira la consulta de la página de estado.

Después de eso puedes escribir un análisis post mortem y, opcionalmente, publicarlo en la página de estado.

## Dónde viven los incidentes en el panel

Abre **Incidentes** en la navegación lateral. Su menú lateral está organizado en secciones:

| Sección               | Qué haces ahí                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vista General**     | **Todos los Incidentes** e **Incidentes Activos**: esta última lleva una insignia roja con el recuento de incidentes que no están en el estado resuelto.                |
| **Episodios**         | Episodios de incidente, una función de agrupación aparte con sus propias páginas.                                                                                      |
| **IA**                | **Investigación** y **Remediación**: ajustes de investigación automática y auto-remediación.                                                                            |
| **Espacio de trabajo**| Conexiones de **Slack** y **Microsoft Teams** para incidentes.                                                                                                          |
| **Reglas**            | Los motores de reglas: **Reglas de Agrupación**, **Reglas de guardia**, **Reglas del propietario**, **Reglas de runbook**, **Reglas de privacidad**, **Reglas de etiquetas**, **Reglas de SLA**, **Reminder Rules**. |
| **Ajustes**           | **Estado del Incidente**, **Gravedad del Incidente**, **Plantillas de Incidentes**, **Plantillas de Notas**, **Plantillas Post-mortem**, **Campos Personalizados**, **Roles de Incidente**, **Más Ajustes**. |

**Reglas** y **Ajustes** están contraídas de forma predeterminada: despliégalas para encontrar las páginas a las que se refiere el resto de esta documentación. La configuración de incidentes no está en Ajustes del proyecto; está toda aquí.

La propia lista de incidentes muestra **Número de incidente**, **Título**, **Estado**, **Gravedad**, **Recursos afectados**, **Declarado**, **Duración**, **Etiquetas** y **Propietarios**, con una acción masiva **Cambiar estado** para cerrar varios a la vez.

## Qué muestra cada página de un incidente

Abre un incidente y obtienes un menú lateral izquierdo, agrupado así:

- **Vista General** — la tarjeta **Detalles del incidente** (título, severidad, etiquetas, número de incidente, declarado el, declarado por, políticas de guardia), una tarjeta **Recursos afectados** y el **Incidente Feed**. Encima de ellas, mosaicos de estadísticas para el tiempo hasta el reconocimiento, el tiempo hasta la resolución y la **Duración** total.
- **Línea de Tiempo de Estado** — todos los estados en los que ha estado el incidente, con **Comienza en**, **Termina en**, **Duración** y el estado de notificación a suscriptores de cada transición. **Ver causa** y **Ver registros** explican por qué ocurrió cada cambio.
- **SLA** — seguimiento del SLA de este incidente.
- **Descripción**, **Causa Raíz**, **Remediación** — tres páginas en Markdown. La descripción es la que aparece en tu página de estado.
- **Runbooks** — ejecuciones de runbook adjuntas a este incidente.
- **Post-mortem** — el informe, que puedes publicar opcionalmente en la página de estado.
- **Roles**, **Ejecuciones de Guardia**, **Propietarios** — quién está en ello, qué políticas se dispararon y quién recibe notificaciones.
- **Registros de notificación**, **Registros de IA**, **Registros de Auditoría** — qué se envió y qué cambió.
- **Notas Privadas** y **Notas Públicas** — bajo la sección **Notas** del menú lateral.
- **Campos Personalizados**, **Ajustes**, **Eliminar Incidente** — bajo **Avanzado**. La página **Ajustes** contiene **Visible en la página de estado**, **Incidente privado** y la tarjeta **Reminders**.

[Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) cubre en profundidad las páginas de colaboración.

## Cómo encajan los incidentes con el resto de OneUptime

- **Los monitores detectan el problema; los incidentes lo registran.** Una regla de criterios de monitor puede declarar un incidente automáticamente, rellenando de antemano título, severidad, políticas de guardia, propietarios, etiquetas y notas de remediación. Consulta [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating) para las variables disponibles ahí.
- **Las políticas de guardia hacen el aviso.** Adjunta políticas en el paso **De guardia** del asistente de declaración, en una plantilla o mediante **Incidentes → Reglas → Reglas de guardia**. Todas las reglas coincidentes se disparan: el conjunto ejecutado es la unión de todas las coincidencias más lo que se haya adjuntado directamente, sin duplicados.
- **Los runbooks dicen a las personas qué hacer.** Las reglas de runbook adjuntan un procedimiento automáticamente cuando se crea un incidente coincidente, y quienes responden pueden iniciar uno a mano desde el incidente. Consulta [Visión general de los Runbooks](/docs/runbooks/index).
- **Las páginas de estado avisan a los clientes.** Un incidente aparece en la lista activa de una página de estado cuando la página tiene los incidentes habilitados, el incidente está marcado como visible en la página de estado y su estado actual no es el estado resuelto. Los incidentes privados están ocultos en todas las páginas de estado, siempre. Consulta [Visión general de las páginas de estado](/docs/status-pages/index).
- **Los flujos de trabajo automatizan a su alrededor.** Los disparadores **On Create Incident**, **On Update Incident** y **On Delete Incident** te permiten construir automatización sin código sobre el ciclo de vida del incidente. Consulta [Visión general de los flujos de trabajo](/docs/workflows/index).

## Qué leer a continuación

- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente, las plantillas, los criterios de monitor y la API.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — los indicadores de estado, los estados personalizados y la clasificación por severidad.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas y privadas, propietarios y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, prefijos de número y los motores de reglas.
- [Visión general de las páginas de estado](/docs/status-pages/index) — cómo llegan los incidentes a tus clientes.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién recibe notificaciones cuando un incidente cambia.
