# Visión general de los incidentes

Un incidente en OneUptime es el registro alrededor del cual se agrupa tu equipo cuando algo falla. Lleva un número, un título, una severidad, un estado actual, los recursos a los que afecta y todo lo que tu equipo deja por escrito mientras responde: notas, causa raíz, pasos de remediación y un feed de solo anexado con quién hizo qué.

Los incidentes son lo que convierte un monitor en rojo en una respuesta coordinada. Declarar uno avisa a la rotación de guardia adecuada, añade propietarios que reciben notificación de cada cambio, arranca runbooks y —si así lo decides— publica la interrupción en tu página de estado pública, para que los clientes dejen de abrir tickets preguntando si ya te has dado cuenta.

Puedes declarar un incidente a mano a las tres de la madrugada, o dejar que un monitor lo declare por ti en cuanto sus criterios coincidan. En ambos casos el incidente es el mismo objeto, con el mismo ciclo de vida y el mismo rastro documental al final.

## De un vistazo

- **Funcionalidad de primer nivel** — **Incidentes**, en la navegación lateral izquierda del panel, en `/dashboard/{projectId}/incidents`.
- **Tres estados iniciales** — **Identificado**, **Reconocido** y **Resuelto** se crean en todo proyecto nuevo. Puedes añadir los tuyos; los tres iniciales se pueden renombrar y recolorear, pero nunca eliminar.
- **Tres severidades iniciales** — **Incidente crítico**, **Incidente mayor** e **Incidente menor**. La severidad es una etiqueta con un color y un orden: no aporta comportamiento por sí misma.
- **Cuatro puertas de entrada** — el asistente **Declarar incidente**, **Crear desde plantilla**, una regla de criterios de monitor o `POST /api/incident`.
- **Numerados por proyecto** — cada incidente recibe un número de incidente, que se muestra como `#42` de forma predeterminada o con el prefijo que elijas, como `INC-42`.
- **Dos tipos de notas** — notas privadas (notas internas) para tu equipo, notas públicas para los suscriptores de la página de estado.
- **Los ajustes están bajo Incidentes, no bajo Ajustes del proyecto** — estados, severidades, plantillas, campos personalizados y los motores de reglas viven todos en **Incidentes → Ajustes** e **Incidentes → Reglas**.

## Términos clave

Un puñado de palabras reaparece en todas las páginas de esta sección. Conviene tenerlas claras desde el principio.

| Término                    | Qué significa                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Incidente**              | El registro en sí: título, descripción, severidad, estado actual, recursos afectados y todo lo que se escribe en él durante la respuesta.            |
| **Estado del incidente**   | Dónde está el incidente dentro de su ciclo de vida. Una fila con alcance de proyecto con nombre, color y `order`, más los indicadores que le dan sentido. |
| **Severidad del incidente** | Cuánto duele. Una fila con alcance de proyecto con nombre, color y `order`. Pura clasificación: nada en el producto trata una severidad de forma especial. |
| **Número de incidente**    | Un contador por proyecto que se muestra como `#42`, o como `INC-42` con el prefijo que configures.                                                   |
| **Recursos afectados**     | Los monitores, hosts, clústeres de Kubernetes, hosts de Docker, servicios y demás infraestructura que adjuntas al incidente.                         |
| **Nota pública**           | Una actualización escrita para quienes leen la página de estado y para los suscriptores. Se muestra en la línea de tiempo de la página de estado.    |
| **Nota privada**           | Una nota interna (el modelo `IncidentInternalNote`) para el equipo que responde. Nunca llega a una página de estado.                                 |
| **Propietario**            | Un usuario o equipo responsable del incidente. Los propietarios reciben aviso cuando se crea, cuando se publican notas y cuando cambia el estado.    |
| **Incidente Feed**         | La línea de tiempo de actividad de solo anexado en la **Vista General** del incidente: cambios de estado, notas, cambios de propietario, ejecuciones de reglas y notificaciones. |
| **Línea de tiempo de estado** | El registro de en qué estado estuvo el incidente, cuándo y durante cuánto tiempo, con el estado de notificación a suscriptores de cada transición.  |

## Los tres estados que OneUptime crea en cada proyecto

Al crear un proyecto, OneUptime siembra exactamente tres estados de incidente, en este orden:

| Estado           | Orden | Color               | Qué significa                                                                     |
| ---------------- | ----- | ------------------- | --------------------------------------------------------------------------------- |
| **Identificado** | 1     | Rojo (`#fd625e`)    | El estado en el que aterriza un incidente recién creado. Es el estado de creación. |
| **Reconocido**   | 2     | Amarillo (`#ffbf53`) | Alguien ha asumido el incidente y está trabajando en él.                          |
| **Resuelto**     | 3     | Verde (`#2ab57d`)   | El incidente ha terminado. Resolverlo es lo que lo retira de tu página de estado.  |

Los nombres son solo etiquetas: lo que de verdad gobierna el comportamiento son tres booleanos de la fila del estado: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Se espera que solo un estado por proyecto lleve cada indicador.

Esa distinción importa más de lo que parece:

- `isCreatedState` decide dónde empieza un incidente nuevo. Si no se selecciona un estado explícitamente al crearlo, OneUptime busca el estado de creación del proyecto y lo usa.
- `isAcknowledgedState` e `isResolvedState` gobiernan los botones **Acknowledge** y **Resolver** de la cabecera del incidente, los dos mosaicos de estadísticas de la **Vista General** y la insignia con el recuento de **Incidentes Activos** del menú lateral.
- **Incidentes Activos** se define única y exclusivamente como «el estado actual no es el estado resuelto». Por tanto, cualquier estado propio que añadas cuenta como activo salvo que sea el resuelto.

**Fíjate en el nombre.** El primer estado inicial se llama **Identificado**, aunque varias descripciones dentro del producto lo siguen llamando estado de creación. Si buscas «Created» en la lista de estados de tu proyecto, es la fila llamada **Identificado**.

Puedes añadir tus propios estados en **Incidentes → Ajustes → Estado del Incidente**. Los estados nuevos se añaden al final de la lista ordenada y puedes arrastrarlos para reordenarlos. Los tres estados con indicador no se pueden eliminar —OneUptime lo bloquea—, pero sí renombrar y recolorear, y por eso la interfaz lee los nombres de estado de forma dinámica.

El orden se hace cumplir, no es cosmético: un incidente no puede pasar a un estado situado antes que el actual en la lista.

Todo el detalle está en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

## Las tres severidades que OneUptime crea en cada proyecto

Todo proyecto nuevo recibe además tres severidades:

| Severidad             | Orden | Color                | Qué significa                                                       |
| --------------------- | ----- | -------------------- | -------------------------------------------------------------------- |
| **Incidente crítico** | 1     | Granate (`#b70400`)  | Impacto muy alto en los clientes; requiere respuesta inmediata.      |
| **Incidente mayor**   | 2     | Rojo (`#fd625e`)     | Impacto significativo; normalmente requiere respuesta inmediata.     |
| **Incidente menor**   | 3     | Amarillo (`#ffbf53`) | Impacto bajo; normalmente se atiende en horario laboral.             |

Las descripciones iniciales completas están en [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

Las severidades tienen `name`, `description`, `color` y `order`, y nada más. No hay indicadores, y ninguna ruta de código trata «Incidente crítico» de forma distinta a cualquier otra fila. La severidad es la manera en que las personas hacen triaje, y está disponible como criterio de coincidencia cuando escribes reglas de guardia, pero elegir una severidad no avisa a nadie por sí sola.

Edita o añade severidades en **Incidentes → Ajustes → Gravedad del Incidente**.

## La vida de un incidente

### 1. Se declara

Cuatro caminos llevan al mismo objeto:

- **A mano** — desde la lista de incidentes, haz clic en **Declarar incidente**. Eso abre el asistente **Declarar nuevo incidente**, de cinco pasos: **Detalles del incidente**, **Recursos afectados**, **Roles de Incidente**, **De guardia** y **Más**.
- **Desde una plantilla** — haz clic en **Crear desde plantilla** y elige una **Plantillas de Incidentes** guardada. Las plantillas rellenan de antemano título, descripción, severidad, estado inicial, recursos, políticas de guardia, propietarios y etiquetas.
- **Desde un monitor** — una regla de criterios de monitor con el interruptor «declarar un incidente» activado crea el incidente automáticamente en cuanto sus filtros coinciden. Allí, títulos y descripciones admiten plantillas con `{{variable}}`.
- **Por la API** — `POST /api/incident` con una clave de API. El servidor rellena por ti `declaredAt`, el estado de creación y el número de incidente.

Consulta [Declarar un incidente](/docs/incidents/declaring-incidents) para el recorrido campo por campo.

### 2. Se entera quien tiene que enterarse

Al crearse, OneUptime ejecuta la automatización que hayas configurado: reglas de etiquetas, reglas de guardia, reglas del propietario y reglas de runbook. Las políticas de guardia adjuntas al incidente —a mano, desde una plantilla o incorporadas por una regla de guardia coincidente— se ejecutan en paralelo.

Los propietarios reciben aviso por correo electrónico, SMS, llamada, notificación push y WhatsApp, según las preferencias de notificación de cada usuario. Si un incidente no tiene ningún propietario, la notificación recae en los propietarios del proyecto en lugar de descartarse.

Si el incidente es visible en una página de estado y las notificaciones a suscriptores están activadas, también se avisa a los suscriptores. Las notificaciones las mueve un cron que se ejecuta cada minuto, así que cuenta con hasta un minuto de retraso más que con un envío instantáneo.

### 3. Tu equipo lo trabaja

Quienes responden reconocen el incidente, adjuntan recursos afectados, ejecutan runbooks, asignan roles de incidente y van dejando por escrito lo que descubren: notas privadas para el equipo, notas públicas para los clientes, y las páginas **Causa Raíz** y **Remediación** a medida que se aclara el panorama. Todo lo que hacen aparece en el **Incidente Feed** de la página **Vista General**.

### 4. Se resuelve

Hacer clic en **Resolver** mueve el incidente al estado resuelto, sella la línea de tiempo de estado, detiene el reloj de duración y retira el incidente de la sección activa de cualquier página de estado en la que se estuviera mostrando. No hace falta cambiar nada más: el indicador de estado resuelto es lo que mira la consulta de la página de estado.

A partir de ahí puedes escribir un post mortem y, si quieres, publicarlo en la página de estado.

## Dónde viven los incidentes en el panel

Abre **Incidentes** en la navegación lateral. Su menú lateral está organizado en secciones:

| Sección                    | Qué haces ahí                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vista General**          | **Todos los Incidentes** e **Incidentes Activos**; esta última lleva una insignia roja con el recuento de incidentes que no están en el estado resuelto.           |
| **Episodios**              | Los episodios de incidente, una funcionalidad de agrupación aparte con sus propias páginas.                                                                        |
| **IA**                     | **Investigación** y **Remediación**: los ajustes de investigación automática y de remediación automática.                                                          |
| **Espacio de trabajo**     | Las conexiones de **Slack** y **Microsoft Teams** para incidentes.                                                                                                |
| **Reglas**                 | Los motores de reglas: **Reglas de Agrupación**, **Reglas de guardia**, **Reglas del propietario**, **Reglas de runbook**, **Reglas de privacidad**, **Reglas de etiquetas**, **Reglas de SLA**, **Reminder Rules**. |
| **Ajustes**                | **Estado del Incidente**, **Gravedad del Incidente**, **Plantillas de Incidentes**, **Plantillas de Notas**, **Plantillas Post-mortem**, **Campos Personalizados**, **Roles de Incidente**, **Más Ajustes**. |

**Reglas** y **Ajustes** aparecen contraídos de forma predeterminada: despliégalos para encontrar las páginas a las que se refiere el resto de esta documentación. La configuración de incidentes no está bajo Ajustes del proyecto; vive toda aquí.

La propia lista de incidentes muestra **Número de incidente**, **Título**, **Estado**, **Gravedad**, **Recursos afectados**, **Declarado**, **Duración**, **Etiquetas** y **Propietarios**, con una acción masiva **Cambiar estado** para cerrar varios de golpe.

## Qué muestra cada página de un incidente

Abre un incidente y tendrás un menú lateral izquierdo, agrupado así:

- **Vista General** — la tarjeta **Detalles del incidente** (título, severidad, etiquetas, número de incidente, declarado el, declarado por, políticas de guardia), una tarjeta **Recursos afectados** y el **Incidente Feed**. Encima, mosaicos de estadísticas con el tiempo hasta el reconocimiento, el tiempo hasta la resolución y la **Duración** total.
- **Línea de Tiempo de Estado** — todos los estados por los que ha pasado el incidente, con **Comienza en**, **Termina en**, **Duración** y el estado de notificación a suscriptores de cada transición. **Ver causa** y **Ver registros** explican por qué se produjo cada cambio.
- **SLA** — el seguimiento de SLA de este incidente.
- **Descripción**, **Causa Raíz**, **Remediación** — tres páginas en Markdown. La descripción es la que se muestra en tu página de estado.
- **Runbooks** — las ejecuciones de runbook adjuntas a este incidente.
- **Post-mortem** — el análisis posterior, que puedes publicar en la página de estado si quieres.
- **Roles**, **Ejecuciones de Guardia**, **Propietarios** — quién está en ello, qué políticas se dispararon y a quién se avisa.
- **Registros de notificación**, **Registros de IA**, **Registros de Auditoría** — qué se envió y qué cambió.
- **Notas Privadas** y **Notas Públicas** — bajo la sección **Notas** del menú lateral.
- **Campos Personalizados**, **Ajustes**, **Eliminar Incidente** — bajo **Avanzado**. La página **Ajustes** contiene **Visible en la página de estado**, **Incidente privado** y la tarjeta **Reminders**.

[Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) cubre en profundidad las páginas de colaboración.

## Cómo encajan los incidentes con el resto de OneUptime

- **Los monitores detectan el problema; los incidentes lo registran.** Una regla de criterios de monitor puede declarar un incidente automáticamente, rellenando de antemano título, severidad, políticas de guardia, propietarios, etiquetas y notas de remediación. Las variables disponibles ahí están en [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating).
- **Las políticas de guardia son las que avisan.** Adjunta políticas en el paso **De guardia** del asistente de declaración, en una plantilla, o mediante **Incidentes → Reglas → Reglas de guardia**. Se dispara toda regla coincidente: el conjunto ejecutado es la unión de todas las coincidencias más lo adjuntado directamente, sin duplicados.
- **Los runbooks le dicen a la gente qué hacer.** Las reglas de runbook adjuntan un procedimiento automáticamente cuando se crea un incidente coincidente, y quienes responden pueden iniciar uno a mano desde el incidente. Consulta [Visión general de los Runbooks](/docs/runbooks/index).
- **Las páginas de estado informan a los clientes.** Un incidente aparece en la lista activa de una página de estado cuando la página tiene los incidentes activados, el incidente está marcado como visible en la página de estado y su estado actual no es el resuelto. Los incidentes privados quedan ocultos en todas las páginas de estado, siempre. Consulta [Visión general de las páginas de estado](/docs/status-pages/index).
- **Los flujos de trabajo automatizan alrededor.** Los disparadores **On Create Incident**, **On Update Incident** y **On Delete Incident** te permiten construir automatización sin código sobre el ciclo de vida del incidente. Consulta [Visión general de los flujos de trabajo](/docs/workflows/index).

## Qué leer a continuación

- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente, las plantillas, los criterios de monitor y la API.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — los indicadores de estado, los estados propios y la clasificación por severidad.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas y privadas, propietarios y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, prefijos de número y los motores de reglas.
- [Visión general de las páginas de estado](/docs/status-pages/index) — cómo llegan los incidentes a tus clientes.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — a quién se avisa cuando un incidente se mueve.
