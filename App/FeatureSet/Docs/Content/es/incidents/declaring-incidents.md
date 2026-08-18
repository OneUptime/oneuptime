# Declarar un incidente

Declarar un incidente es el momento en que OneUptime empieza a llevar la cuenta. Se crea un registro, se le estampa un número, se disparan las políticas de guardia y —salvo que le digas lo contrario— tus suscriptores de la página de estado se enteran. Todo lo demás del ciclo de vida del incidente cuelga de esa primera escritura.

Hay cuatro formas en las que un incidente entra en OneUptime, y todas acaban en el mismo sitio: una fila en la tabla `Incident` con una severidad, un estado actual y una lista de recursos afectados. La diferencia está solo en quién rellena los campos: tú a las 3 de la madrugada, una plantilla guardada, los criterios de un monitor o tu propio código llamando a la API.

Esta página recorre las cuatro, campo por campo, y luego cubre qué rellena el servidor por ti y qué se dispara en cuanto el incidente existe.

## Cuatro formas de declarar un incidente

| Si quieres…                                                        | Elige                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Abrir un incidente a mano, rellenándolo todo                       | El asistente **Declarar incidente**                                         |
| Abrir un tipo recurrente de incidente con los campos ya rellenos   | **Crear desde plantilla**                                                   |
| Abrir uno automáticamente cuando fallan las comprobaciones de un monitor | Un filtro de criterios de monitor con **When filters match, declare an incident.** |
| Abrir uno desde tu propio código, un script u otra herramienta     | `POST /api/incident`                                                        |

Las cuatro escriben el mismo modelo, así que un incidente abierto por una sonda es exactamente igual que uno abierto a mano por quien responde, salvo por unas cuantas columnas de contabilidad que el servidor establece en los automáticos.

## Declarar uno a mano

Abre **Incidentes → Todos los Incidentes** y haz clic en **Declarar incidente** arriba a la derecha de la lista de **Incidentes**. Eso te lleva a una tarjeta titulada **Declarar nuevo incidente**, que reparte el formulario en cinco pasos: **Detalles del incidente**, **Recursos afectados**, **Roles de Incidente**, **De guardia** y **Más**. El botón de envío del final también dice **Declarar incidente**.

Solo el primer paso tiene campos obligatorios. Si tienes prisa, rellena **Detalles del incidente** y envía: puedes adjuntar recursos, asignar roles y añadir políticas de guardia después desde las propias páginas del incidente.

### Paso 1 — Detalles del incidente

- **Título** — obligatorio. El resumen de una línea que todo el mundo verá en la lista, en Slack y (si el incidente es visible) en tu página de estado. Marcador de posición: `Incident Title`.
- **Descripción** — opcional, escrita en Markdown. Este es el campo que se muestra en la página de estado, así que escríbelo para los clientes y no para tu equipo. Puedes editarlo más tarde desde **Descripción** en el menú lateral del incidente.
- **Declarado el** — obligatorio en el formulario, con la hora actual por defecto. Es la marca de tiempo desde la que se mide toda duración del incidente, así que ponle una fecha anterior si estás registrando algo que empezó antes.
- **Gravedad del Incidente** — obligatorio. Una de las severidades configuradas para tu proyecto; los proyectos nuevos vienen con **Critical Incident**, **Major Incident** y **Minor Incident**.
- **Estado del Incidente** — opcional. Déjalo tal cual y el incidente aterriza en el estado marcado con `isCreatedState`, que los proyectos nuevos crean como **Identified**. Selecciónalo solo cuando estés registrando un incidente que ya había pasado de ese punto.

**Si el desplegable de estado te da problemas.** Si tu proyecto no tiene ningún estado con el indicador `isCreatedState`, la llamada de creación falla y te dice que añadas un estado de incidente de creación desde los ajustes. Eso normalmente solo ocurre en un proyecto cuyos estados se han editado mucho; consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

### Paso 2 — Recursos afectados

- **Recursos afectados** — un único cuadro de búsqueda que adjunta monitores, hosts, clústeres de Kubernetes, hosts de Docker, hosts de Podman y servicios. Por debajo son relaciones separadas en el incidente (`monitors`, `hosts`, `kubernetesClusters`, `dockerHosts`, `podmanHosts`, `services` y más), pero el formulario las agrupa en un solo selector.
- **Cambiar estado del monitor a** — opcional. Elige un estado de monitor que se aplica a todos los monitores adjuntos a este incidente, de modo que declarar el incidente y marcar los monitores como degradados es una sola acción en vez de dos.

**Adjunta monitores aunque parezca redundante.** El vínculo entre un incidente y una página de estado pasa por los monitores del incidente: una página de estado muestra un incidente cuando uno de sus recursos es uno de los monitores del incidente. Una notificación de cambio de estado a los suscriptores se omite directamente cuando el incidente no tiene monitores adjuntos. Consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups).

### Paso 3 — Roles de Incidente

- **Asignar roles del incidente** — asigna miembros del equipo a los roles que define tu proyecto. Algunos roles admiten más de un usuario.

Los roles en sí se configuran en **Incidentes → Ajustes → Roles de Incidente**, donde defines los roles que se pueden asignar durante la respuesta: Incident Commander, Responder y lo que tu proceso necesite. Si te saltas este paso, se asigna automáticamente un Incident Commander en el primer cambio de estado si nadie tiene aún el rol.

### Paso 4 — De guardia

- **Política de guardia** — una selección múltiple de las políticas de guardia que se ejecutarán cuando se cree este incidente. Se corresponde con `onCallDutyPolicies` en el incidente.

Este es el único sitio donde una política de guardia se adjunta directamente a un incidente. Las severidades no llevan política de guardia: la severidad es una etiqueta, y solo influye en el aviso como *criterio de coincidencia* dentro de una regla de guardia. Las reglas configuradas en **Incidentes → Reglas → Reglas de guardia** añaden sus políticas encima de lo que elijas aquí; el conjunto final que se ejecuta es la unión sin duplicados de ambos.

### Paso 5 — Más

- **Etiquetas** — opcional y una función avanzada: los miembros del equipo con acceso a estas etiquetas son quienes pueden acceder al incidente.
- **Notificar a suscriptores de la página de estado** — casilla, activada de forma predeterminada. Controla si se envía correo a los suscriptores sobre la creación del incidente (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Desactívala para ruido interno que aun así quieras registrar.
- **Incidente privado** — casilla, desactivada de forma predeterminada (`isPrivate`). Un incidente privado es visible solo para sus usuarios propietarios, los miembros de sus equipos propietarios, los administradores del proyecto y los propietarios del proyecto, y está oculto en todas las páginas de estado, independientemente de cualquier otro ajuste. La lista de incidentes los marca con una píldora roja **Private**.

El indicador **Should be visible on status page?** (`isVisibleOnStatusPage`) no está en el asistente; su valor predeterminado es verdadero. Cámbialo después desde **Ajustes** en el menú lateral del incidente, donde aparece etiquetado como **Visible en la página de estado**.

## Declarar desde una plantilla

Si declaras una y otra vez el mismo tipo de incidente —el mismo patrón de título, la misma severidad, la misma política de guardia— guárdalo una vez como plantilla.

Haz clic en **Crear desde plantilla** (el botón con contorno junto a **Declarar incidente**) y se abre un modal **Crear incidente a partir de plantilla**, con un desplegable **Seleccionar plantilla de incidente**. Elige una plantilla y el formulario de creación se abre relleno de antemano; aún puedes cambiar cualquier cosa antes de enviar. Si tu proyecto todavía no tiene plantillas, obtienes en su lugar un modal **No Incident Templates**, con un botón **Create Template** que te lleva a **Incidentes → Ajustes → Plantillas de Incidentes**.

Las plantillas se construyen con su propio asistente de seis pasos —**Información de la plantilla**, **Detalles del incidente**, **Recursos afectados**, **De guardia**, **Propietarios**, **Etiquetas**— con estos campos:

| Campo                            | Propósito                                                       |
| -------------------------------- | --------------------------------------------------------------- |
| **Nombre de la plantilla**       | Cómo se identifica la plantilla en el selector.                 |
| **Descripción de la plantilla**  | Una nota para tu yo futuro sobre cuándo recurrir a ella.        |
| **Título**                       | El título que se rellena de antemano en el incidente.           |
| **Descripción**                  | Descripción en Markdown rellenada de antemano en el incidente.  |
| **Gravedad del Incidente**       | Severidad rellenada de antemano en el incidente.                |
| **Estado inicial del incidente** | El estado en el que empiezan los incidentes de esta plantilla.  |
| **Recursos afectados**           | Monitores, hosts, clústeres y servicios que adjuntar.           |
| **Cambiar estado del monitor a** | Estado de monitor que aplicar a los monitores adjuntos.         |
| **Política de guardia**          | Políticas que ejecutar cuando se cree el incidente.             |
| **Propietario - Equipos**        | Equipos que poseen los incidentes creados desde esta plantilla. |
| **Propietario - Usuarios**       | Usuarios que poseen los incidentes creados desde esta plantilla.|
| **Etiquetas**                    | Etiquetas aplicadas al incidente.                               |

Unas cuantas reglas rápidas:

- Las plantillas no se pueden editar desde la lista de plantillas: creas una y luego la abres para cambiarla.
- Una plantilla solo rellena un campo que hayas dejado vacío. En la página de creación la plantilla se aplica como un relleno previo que puedes sobrescribir; en la API, el servidor rellena un campo desde la plantilla solo cuando la petición dejó ese campo como `undefined`. Lo que aporte quien llama siempre gana.

## Declarar automáticamente desde los criterios de un monitor

La mayoría de los incidentes no deberían necesitar que una persona los escriba. En el editor de criterios de un monitor, activa el interruptor **When filters match, declare an incident.** y aparece una sección **Crear incidente** con un botón **Añadir incidente**: un solo filtro de criterios puede declarar más de un incidente.

Cada entrada tiene:

- **Título del incidente** — admite plantillas; el marcador de posición sugiere algo como `{{monitorName}} is down`.
- **Gravedad** — obligatorio.
- **Descripción del incidente** — también con plantillas.
- **De guardia → Políticas de Guardia** — políticas que se ejecutan cuando se crea este incidente.
- **Roles de Incidente** — preasigna miembros del equipo a los roles.
- **Propiedad y etiquetas → Equipos propietarios**, **Usuarios propietarios**, **Etiquetas**.
- **Opciones avanzadas → Resolver incidente automáticamente** (resuelve el incidente automáticamente cuando los criterios dejan de cumplirse), **Mostrar incidente en la página de estado**, **Incidente privado** y **Notas de Remediación**.

Para la lista completa de marcadores `{{variable}}` que puedes usar en el título, la descripción y las notas de remediación, consulta [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating).

Los incidentes creados así los etiqueta el servidor: se establece `isCreatedAutomatically`, `createdCriteriaId` registra qué filtro de criterios se disparó y `createdByProbe` registra qué sonda lo vio. Todo lo demás en ellos se comporta exactamente igual que en un incidente declarado a mano.

## Declarar mediante la API

El modelo de incidente expone un punto de conexión CRUD estándar, así que `POST /api/incident` crea uno. Autentícate con una clave de API generada en **Ajustes del proyecto → Claves API**, enviada en la cabecera `apikey`: la clave identifica el proyecto, así que no necesitas pasar un id de proyecto por separado.

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Checkout latency above SLO",
      "description": "Investigating elevated p99 latency on the checkout service.",
      "incidentSeverityId": "<incident-severity-id>"
    }
  }'
```

Campos útiles en el cuerpo de la petición:

- `title` — el único campo que realmente tienes que aportar.
- `declaredAt` — opcional aquí aunque el formulario lo exija. Omítelo y el servidor usa la hora actual.
- `incidentSeverityId` y `currentIncidentStateId` — el servidor comprueba que ambos pertenecen al mismo proyecto que la clave de API, y rechaza la petición si no es así. La misma comprobación se aplica al estado de monitor que hay detrás de **Cambiar estado del monitor a**.
- `createdIncidentTemplateId` — aplica una plantilla guardada. Cualquier campo que omitas se rellena desde la plantilla; cualquier campo que envíes se mantiene tal cual.

Los puntos de conexión relacionados son `/api/incident-state`, `/api/incident-severity` e `/api/incident-state-timeline`. La [referencia de la API](/reference) generada tiene las formas exactas de petición y respuesta de cada uno, incluido cómo se expresan campos de relación como los monitores.

## Números de incidente y prefijos

Cada incidente recibe un número secuencial de un contador por proyecto, asignado por el servidor en el momento de la creación. Dos columnas lo guardan: `incidentNumber` (el entero en bruto) e `incidentNumberWithPrefix` (lo que realmente ves). Sin prefijo configurado, el valor mostrado es `#42`.

Para cambiarlo, ve a **Incidentes → Ajustes → Más Ajustes**. La tarjeta **Prefijo de número** tiene un campo **Prefijo de número de incidente** (hasta 20 caracteres, marcador de posición `INC-`): configúralo y el mismo incidente se muestra como `INC-42`. Déjalo vacío para mantener el `#` predeterminado. La tarjeta también lleva **Prefijo de número de episodio de incidente** para la numeración de episodios.

El número aparece como la primera columna de la lista de incidentes, enlaza al incidente y se muestra como **Número de incidente** en la **Vista General** del incidente.

## Qué ocurre en el momento en que se declara un incidente

La llamada de creación hace más que escribir una fila. En orden:

1. **El servidor rellena los huecos.** `declaredAt` toma la hora actual por defecto, el estado actual toma por defecto el estado `isCreatedState` del proyecto, y el número de incidente y el número con prefijo se asignan desde el contador del proyecto.
2. **Se aplica una plantilla**, si se aportó `createdIncidentTemplateId`, rellenando solo los campos que quien llamó dejó sin definir.
3. **Se ejecutan las reglas de privacidad**, marcando el incidente como privado cuando una regla coincidente lo indica. Este es el primer motor de reglas en ejecutarse, así que todo lo posterior ve el ajuste de privacidad correcto.
4. **Se ejecutan las reglas de propietario**, añadiendo los usuarios y equipos propietarios que nombran las reglas coincidentes.
5. **Se ejecutan las reglas de etiquetas**, añadiendo las etiquetas que coinciden con el incidente.
6. **Se ejecutan las reglas de guardia.** Toda regla habilitada en **Incidentes → Reglas → Reglas de guardia** cuyos criterios coincidan añade sus políticas al incidente. No hay orden de prioridad ni cortocircuito: todas las reglas coincidentes se disparan y las políticas se deduplican.
7. **Se ejecutan las reglas de runbook**, adjuntando e iniciando los runbooks coincidentes. Consulta [Runbooks](/docs/runbooks/index).
8. **Se ejecutan las políticas de guardia.** Toda política del incidente —elegida en el asistente, heredada de una plantilla o añadida por una regla— se ejecuta en paralelo con el tipo de evento `IncidentCreated`. Que una política falle no detiene a las demás.
9. **Se encolan los suscriptores**, si **Notificar a suscriptores de la página de estado** se dejó activado y el incidente es visible en la página de estado. La entrega la gestiona un trabajo en segundo plano, no en línea con tu petición.
10. **Se disparan los flujos de trabajo.** El disparador **On Create Incident** inicia cualquier flujo de trabajo construido sobre él. Consulta [Visión general de los flujos de trabajo](/docs/workflows/index).

A partir de ahí el incidente está vivo: cuenta para la insignia de **Incidentes Activos** del menú lateral de Incidentes (cualquier estado no marcado con `isResolvedState` cuenta como activo), aparece en las páginas de estado que llevan uno de sus monitores y su **Línea de Tiempo de Estado** empieza a registrar.

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja el modelo de incidente.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hacen los indicadores de estado y cómo añadir los tuyos.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas, propietarios y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, roles, reglas y disparadores de flujo de trabajo.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién se entera del incidente que acabas de declarar.
- [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating) — las variables disponibles para los incidentes declarados automáticamente.
