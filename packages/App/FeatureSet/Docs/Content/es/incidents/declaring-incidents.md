# Declarar un incidente

Declarar un incidente es el momento en que OneUptime empieza a llevar la cuenta. Se crea un registro, se le estampa un número, se disparan las políticas de guardia y —salvo que le digas lo contrario— tus suscriptores de la página de estado se enteran. Todo lo demás del ciclo de vida del incidente cuelga de esa primera escritura.

Hay cuatro maneras de que un incidente entre en OneUptime, y las cuatro acaban en el mismo sitio: una fila en la tabla `Incident` con una severidad, un estado actual y una lista de recursos afectados. Lo único que cambia es quién rellena los campos: tú a las tres de la madrugada, una plantilla guardada, los criterios de un monitor o tu propio código llamando a la API.

Esta página recorre las cuatro, campo por campo, y luego explica qué rellena el servidor por ti y qué se dispara en cuanto el incidente existe.

## Cuatro formas de declarar un incidente

| Si quieres…                                                       | Elige                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Abrir un incidente a mano, rellenándolo todo                      | El asistente **Declarar incidente**                                                    |
| Abrir un tipo de incidente recurrente con los campos ya rellenos  | **Crear desde plantilla**                                                              |
| Abrir uno automáticamente cuando fallen las comprobaciones de un monitor | Un filtro de criterios de monitor con **When filters match, declare an incident.** |
| Abrir uno desde tu propio código, un script u otra herramienta    | `POST /api/incident`                                                                   |

Las cuatro escriben el mismo modelo, así que un incidente abierto por una sonda es idéntico a uno que abrió a mano quien estaba respondiendo, salvo por unas pocas columnas de control que el servidor rellena en los automáticos.

## Declarar uno a mano

Abre **Incidentes → Todos los Incidentes** y haz clic en **Declarar incidente**, arriba a la derecha de la lista de **Incidentes**. Eso te lleva a una tarjeta titulada **Declarar nuevo incidente**, que reparte el formulario en tres pasos: **Detalles del incidente**, **Recursos afectados** y **Guardia y roles**, y después un resumen para revisar. Cuando tu proyecto pide algunos de sus campos personalizados de incidente al crear, un cuarto paso, **Detalles**, llega justo después de **Recursos afectados**.

Solo el primer paso tiene campos obligatorios, además de cualquier campo personalizado que tus administradores hayan marcado como **Obligatorio al crear**. También puedes adjuntar recursos, añadir políticas de guardia y asignar roles después, desde las propias páginas del incidente.

**Avanzado.** Las opciones que la mayoría de los incidentes nunca necesitan esperan plegadas bajo un encabezado **Avanzado** al final de su paso; haz clic en él para abrirlas. Mientras está plegado, el encabezado dice **Configurado** cuando algo dentro está definido —por una plantilla, por ejemplo— y se abre solo cuando algo dentro necesita corregirse. El resumen solo lista una opción plegada cuando está definida, salvo **Notificar a suscriptores de la página de estado**, que siempre lista, con a quién se notificará.

### Paso 1 — Detalles del incidente

- **Título** — obligatorio. El resumen de una línea que todo el mundo verá en la lista, en Slack y, si el incidente es visible, en tu página de estado.
- **Gravedad del incidente** — obligatorio. Una de las severidades configuradas en tu proyecto.
- **Descripción** — opcional, escrita en Markdown. Es lo que muestra la página de estado, así que redáctala para los clientes y no para tu equipo.

Bajo **Avanzado**:

- **Declarado el** — empieza en el momento en que abriste la página. Toda duración del incidente se mide desde ahí, así que retrocédelo para registrar un incidente que empezó antes.
- **Estado inicial** — opcional, y vacío al principio. Si lo dejas vacío, el incidente empieza en el estado marcado con `isCreatedState`, o en el estado inicial de la plantilla. Elige un estado posterior solo para registrar un incidente ya reconocido o resuelto.
- **Etiquetas** — opcional. Las etiquetas agrupan incidentes relacionados, y un equipo restringido a etiquetas solo ve los incidentes que llevan alguna de las suyas.
- **Incidente privado** — desactivado de forma predeterminada (`isPrivate`). Un incidente privado solo es visible para sus propietarios, los administradores y los propietarios del proyecto, y queda oculto en todas las páginas de estado.

**Si el desplegable de estado te da problemas.** Si tu proyecto no tiene ningún estado con el indicador `isCreatedState`, la llamada de creación falla y te pide que añadas un estado de creación desde los ajustes. Eso normalmente solo ocurre en proyectos cuyos estados se han editado mucho; consulta [Estados y severidades de incidentes](/docs/incidents/states-and-severities).

### Paso 2 — Recursos afectados

Los monitores van primero, por separado: las páginas de estado ven un incidente a través de sus monitores, y el estado al que cambian los monitores está justo debajo.

- **Monitores** — un cuadro de búsqueda que adjunta los monitores afectados por el incidente (`monitors`). Una página de estado muestra el incidente, y avisa a sus suscriptores, cuando incluye uno de estos monitores.
- **Cambiar el estado del monitor a** — opcional, y solo aparece cuando hay al menos un monitor elegido. Aplica un estado a cada monitor del incidente, de modo que declarar el incidente y marcar sus monitores como degradados sea una sola acción. El estado de una plantilla aparece en cuanto eliges un monitor; sin ningún monitor elegido, no se guarda ningún estado.
- **Otros recursos afectados** — un segundo cuadro de búsqueda para todo lo demás que afecta el incidente: hosts, clústeres de Kubernetes, hosts de Docker y Podman, clústeres de Proxmox, Ceph y Docker Swarm, vCenters, flotas IoT, bases de datos y servicios. Son relaciones distintas del incidente (`hosts`, `kubernetesClusters`, `services` y más).

La tarjeta **Recursos afectados** del incidente pregunta de la misma forma cuando la editas más tarde.

Bajo **Avanzado**:

- **Limitar a estas páginas de estado** — opcional. Si lo dejas vacío, el incidente aparece en todas las páginas de estado que incluyen sus monitores, y avisa a sus suscriptores; con páginas elegidas, solo en esas de entre ellas. Consulta [Una página de estado por audiencia](/docs/status-pages/one-status-page-per-audience).
- **Notificar a suscriptores de la página de estado** — casilla, activada de forma predeterminada (`shouldStatusPageSubscribersBeNotifiedOnIncidentCreated`). Debajo, y de nuevo en el resumen, el formulario indica qué páginas de estado recibirán el aviso y cuántos suscriptores tiene cada una; en el resumen, **Vista previa de la notificación** muestra el correo que recibirán. Desactívala para el ruido interno que aun así quieras dejar registrado.

**Adjunta monitores aunque parezca redundante.** El vínculo entre un incidente y una página de estado pasa por los monitores del incidente: una página de estado muestra un incidente cuando uno de sus recursos es uno de los monitores del incidente. Si el incidente no tiene monitores adjuntos, la notificación de cambio de estado a los suscriptores se omite sin más. Consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups).

### Paso 3 — Guardia y roles

- **Política de guardia** — una selección múltiple de las políticas de guardia que se ejecutarán al crearse este incidente (`onCallDutyPolicies`).
- **Asignar roles del incidente** — quién ocupa cada rol que define tu proyecto. Un rol marcado como **Principal** que dejes vacío es tuyo: lo asumes al declararse el incidente.

Este es el único sitio donde una política de guardia se adjunta directamente a un incidente. Las severidades no llevan política de guardia: la severidad es una etiqueta, y solo influye en el aviso como *criterio de coincidencia* dentro de una regla de guardia. Las reglas configuradas en **Incidentes → Reglas → Reglas de guardia** suman sus políticas a las que elijas aquí; el conjunto final que se ejecuta es la unión sin duplicados de ambas.

Los roles se configuran en **Incidentes → Ajustes → Roles de Incidente**. Un proyecto nuevo tiene uno, Incident Commander; añade ahí lo que tu proceso necesite.

El indicador **Should be visible on status page?** (`isVisibleOnStatusPage`) no está en el asistente; su valor predeterminado es verdadero. Cámbialo después desde **Ajustes**, en el menú lateral del incidente, donde aparece etiquetado como **Visible en la página de estado**.

## Declarar desde una plantilla

Si declaras una y otra vez el mismo tipo de incidente —el mismo patrón de título, la misma severidad, la misma política de guardia—, guárdalo una sola vez como plantilla.

Haz clic en **Crear desde plantilla** (el botón de contorno junto a **Declarar incidente**) y se abre un modal **Crear incidente a partir de plantilla**, con un desplegable **Seleccionar plantilla de incidente**. Elige una plantilla y el formulario de creación se abre relleno de antemano; puedes cambiar cualquier cosa antes de enviarlo. Si tu proyecto todavía no tiene plantillas, verás en su lugar un modal **No Incident Templates**, con un botón **Create Template** que te lleva a **Incidentes → Ajustes → Plantillas de Incidentes**.

Las plantillas se construyen con su propio asistente —**Información de la plantilla**, **Detalles del incidente**, **Recursos afectados**, **De guardia**—, más pasos de campos personalizados cuando tu proyecto los tiene. Sus propietarios y etiquetas están bajo **Avanzado** al final de **Detalles del incidente**. **Recursos afectados** pregunta como el formulario de declaración —**Monitores**, luego **Cambiar el estado del monitor a**, luego **Otros recursos afectados**, con **Limitar a estas páginas de estado** bajo **Avanzado**—, salvo que una plantilla siempre pide el estado de los monitores: también se aplica a los monitores elegidos al declarar un incidente desde ella. Estos son los campos:

| Campo                              | Para qué sirve                                              |
| ---------------------------------- | ----------------------------------------------------------- |
| **Nombre de la plantilla**         | Cómo se identifica la plantilla en el selector.             |
| **Descripción de la plantilla**    | Una nota a tu yo futuro sobre cuándo echar mano de ella.    |
| **Título**                         | El título que se rellena de antemano en el incidente.       |
| **Descripción**                    | La descripción en Markdown rellenada en el incidente.       |
| **Gravedad del Incidente**         | La severidad rellenada de antemano en el incidente.         |
| **Estado inicial del incidente**   | El estado en el que empiezan los incidentes de esta plantilla. |
| **Monitores** | Monitores que adjuntar. |
| **Cambiar el estado del monitor a** | El estado que aplicar a los monitores del incidente, incluidos los elegidos al declararlo. |
| **Otros recursos afectados** | Hosts, clústeres y servicios que adjuntar. |
| **Limitar a estas páginas de estado** | Las páginas de estado a las que se limita el incidente. |
| **Política de guardia**            | Políticas que ejecutar al crearse el incidente.             |
| **Propietarios** | Personas y equipos propietarios de los incidentes de esta plantilla, elegidos de una sola lista. |
| **Etiquetas**                      | Etiquetas aplicadas al incidente.                           |

Unas cuantas reglas rápidas:

- Las plantillas no se editan desde la lista de plantillas: creas una y luego la abres para cambiarla.
- Una plantilla solo rellena los campos que hayas dejado vacíos. En la página de creación, la plantilla se aplica como un relleno previo que puedes sobrescribir; en la API, el servidor rellena un campo desde la plantilla solo cuando la petición lo dejó `undefined`. Lo que aporte quien llama siempre gana.

## Declarar automáticamente desde los criterios de un monitor

La mayoría de los incidentes no deberían necesitar que alguien los teclee. En el editor de criterios de un monitor, activa el interruptor **When filters match, declare an incident.** y aparecerá una sección **Crear incidente** con un botón **Añadir incidente**: un mismo filtro de criterios puede declarar más de un incidente.

Cada entrada tiene:

- **Título del incidente** — admite plantillas; el marcador de posición sugiere algo como `{{monitorName}} is down`.
- **Gravedad** — obligatorio.
- **Descripción del incidente** — también con plantillas.
- **De guardia → Políticas de guardia** — políticas que se ejecutan al crearse este incidente.
- **Roles de Incidente** — preasigna miembros del equipo a los roles.
- **Propiedad y etiquetas → Equipos propietarios**, **Usuarios propietarios**, **Etiquetas**.
- **Opciones avanzadas → Resolver incidente automáticamente** (resuelve el incidente en cuanto los criterios dejan de coincidir), **Mostrar incidente en la página de estado**, **Incidente privado** y **Notas de Remediación**.

Para la lista completa de marcadores `{{variable}}` que puedes usar en el título, la descripción y las notas de remediación, consulta [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating).

Los incidentes creados así los etiqueta el servidor: se establece `isCreatedAutomatically`, `createdCriteriaId` registra qué filtro de criterios se disparó y `createdByProbe` registra qué sonda lo vio. En todo lo demás se comportan exactamente igual que un incidente declarado a mano.

## Declarar a través de la API

El modelo de incidente expone un endpoint CRUD estándar, así que `POST /api/incident` crea uno. Autentícate con una clave de API generada en **Ajustes del proyecto → Claves API**, enviada en la cabecera `apikey`: la clave identifica el proyecto, así que no necesitas pasar un id de proyecto aparte.

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

Campos útiles del cuerpo de la petición:

- `title` — el único campo que realmente tienes que aportar.
- `declaredAt` — aquí es opcional, aunque el formulario lo exija. Omítelo y el servidor usará la hora actual.
- `incidentSeverityId` y `currentIncidentStateId` — el servidor comprueba que ambos pertenezcan al mismo proyecto que la clave de API y rechaza la petición si no es así. La misma comprobación se aplica al estado de monitor que hay detrás de **Change Monitor Status to**.
- `createdIncidentTemplateId` — aplica una plantilla guardada. Todo campo que omitas se rellena desde la plantilla; todo campo que envíes se mantiene tal cual.

Los endpoints relacionados son `/api/incident-state`, `/api/incident-severity` e `/api/incident-state-timeline`. La [referencia de la API](/reference) generada tiene las formas exactas de petición y respuesta de cada uno, incluida la manera de expresar campos de relación como los monitores.

## Números de incidente y prefijos

Cada incidente recibe un número secuencial de un contador por proyecto, asignado por el servidor en el momento de la creación. Lo guardan dos columnas: `incidentNumber` (el entero puro) e `incidentNumberWithPrefix` (lo que realmente ves). Sin prefijo configurado, el valor mostrado es `#42`.

Para cambiarlo, ve a **Incidentes → Ajustes → Prefijo de número** y pulsa **Actualizar**. El campo **Prefijo de número de incidente** muestra el número mientras escribes: con `INC-` queda `INC-42`. Déjalo vacío para mantener el `#` predeterminado. Un prefijo nuevo se aplica a los incidentes declarados después de guardar; los existentes conservan su número. El mismo diálogo incluye **Prefijo de número de episodio de incidente** para la numeración de episodios.

El número aparece como primera columna de la lista de incidentes, enlaza al incidente y se muestra como **Número de incidente** en la **Vista General** del incidente.

## Qué ocurre en el momento en que se declara un incidente

La llamada de creación hace bastante más que escribir una fila. En orden:

1. **El servidor rellena los huecos.** `declaredAt` toma la hora actual, el estado actual toma el estado `isCreatedState` del proyecto, y el número de incidente y el número con prefijo se asignan desde el contador del proyecto.
2. **Se aplica una plantilla**, si se aportó `createdIncidentTemplateId`, rellenando solo los campos que quien llamó dejó sin definir.
3. **Se ejecutan las reglas de privacidad**, marcando el incidente como privado cuando una regla coincidente así lo dice. Es el primer motor de reglas en ejecutarse, de modo que todo lo posterior ve ya el ajuste de privacidad correcto.
4. **Se ejecutan las reglas del propietario**, añadiendo los usuarios y equipos propietarios que nombren las reglas coincidentes.
5. **Se ejecutan las reglas de etiquetas**, añadiendo las etiquetas que coincidan con el incidente.
6. **Se ejecutan las reglas de guardia.** Toda regla activada en **Incidentes → Reglas → Reglas de guardia** cuyos criterios coincidan añade sus políticas al incidente. No hay orden de prioridad ni cortocircuito: se disparan todas las reglas coincidentes y las políticas se deduplican.
7. **Se ejecutan las reglas de runbook**, adjuntando e iniciando los runbooks coincidentes. Consulta [Runbooks](/docs/runbooks/index).
8. **Se ejecutan las políticas de guardia.** Toda política del incidente —elegida en el asistente, heredada de una plantilla o añadida por una regla— se ejecuta en paralelo con el tipo de evento `IncidentCreated`. Que una política falle no detiene a las demás.
9. **Se ponen en cola los suscriptores**, si se dejó activado **Notificar a suscriptores de la página de estado** y el incidente es visible en la página de estado. La entrega la gestiona un trabajo en segundo plano, no tu petición.
10. **Se disparan los flujos de trabajo.** El disparador **On Create Incident** arranca cualquier flujo de trabajo construido sobre él. Consulta [Visión general de los flujos de trabajo](/docs/workflows/index).

A partir de ahí el incidente está vivo: cuenta para la insignia de **Incidentes Activos** del menú lateral de Incidentes (cualquier estado sin el indicador `isResolvedState` cuenta como activo), aparece en las páginas de estado que incluyan uno de sus monitores, y su **Línea de Tiempo de Estado** empieza a registrar.

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja el modelo de incidente.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — qué hacen los indicadores de estado y cómo añadir los tuyos.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas, propietarios y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, roles, reglas y disparadores de flujos de trabajo.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién se entera del incidente que acabas de declarar.
- [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating) — las variables disponibles para los incidentes declarados automáticamente.
