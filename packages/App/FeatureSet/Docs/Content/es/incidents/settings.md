# Configuración y automatización

La configuración de incidentes no vive en los ajustes del proyecto. Vive dentro de la propia área de producto de Incidentes, en **Incidentes → Ajustes** e **Incidentes → Reglas**, en rutas que empiezan por `/dashboard/{projectId}/incidents/settings/`. Si llevas un rato rebuscando plantillas de incidente o campos personalizados por **Ajustes del proyecto**, ahí tienes el motivo de que no aparecieran.

Tanto la sección **Reglas** como la sección **Ajustes** del menú lateral de Incidentes vienen plegadas de forma predeterminada, así que tendrás que desplegarlas antes de ver los elementos de abajo. Todo lo de aquí es por proyecto: plantillas, roles, campos personalizados y reglas pertenecen a un proyecto y se aplican a cada incidente que se declara en él.

Esta página es la referencia de esa configuración: qué contiene cada pantalla y qué parte se ejecuta sola en el momento en que se crea un incidente.

## Dónde viven los ajustes de incidentes

Abre **Incidentes** en la navegación izquierda y despliega **Ajustes** al final del menú lateral.

| Página                       | Qué haces ahí                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Estado del Incidente**     | Añadir, renombrar, recolorear y reordenar los estados por los que pasa un incidente.                                |
| **Gravedad del Incidente**   | Añadir, renombrar, recolorear y reordenar los niveles de severidad.                                                  |
| **Plantillas de Incidentes** | Rellenar de antemano un incidente entero: título, descripción, recursos, políticas de guardia, propietarios y etiquetas. |
| **Plantillas de Notas**      | Texto reutilizable para notas públicas y privadas.                                                                  |
| **Plantillas Post-mortem**   | Estructuras post-mortem reutilizables.                                                                              |
| **Campos Personalizados**    | Definir campos adicionales que aparecen en todos los incidentes.                                                    |
| **Roles de Incidente**       | Definir los roles a los que asignas a quienes responden, como Incident Commander.                                   |
| **Más Ajustes**              | Los prefijos de número de incidente y de episodio de incidente.                                                     |

**Estado del Incidente** y **Gravedad del Incidente** se tratan a fondo en [Estados y severidades de incidentes](/docs/incidents/states-and-severities); el resto de esta página arranca a partir de **Plantillas de Incidentes**.

Despliega **Reglas** y aparecen ocho pantallas más: **Reglas de Agrupación**, **Reglas de guardia**, **Reglas del propietario**, **Reglas de runbook**, **Reglas de privacidad**, **Reglas de etiquetas**, **Reglas de SLA** y **Reminder Rules**. Las vemos más abajo.

## Plantillas de incidente

Una plantilla de incidente es el esqueleto guardado de un incidente. En lugar de reescribir el mismo título, la misma lista de monitores y la misma política de guardia cada vez que el clúster de pagos se tambalea, lo guardas una vez y declaras a partir de ahí.

Ve a **Incidentes → Ajustes → Plantillas de Incidentes** (`/dashboard/{projectId}/incidents/settings/templates`). La tarjeta se titula **Plantillas de Incidentes**. Crear una te lleva por un asistente de seis pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**. Nombran la plantilla en sí; nunca aparecen en el incidente.
- **Detalles del incidente** — **Título**, **Descripción** (en Markdown), **Gravedad del Incidente** y **Estado inicial del incidente**. **Estado inicial del incidente** es opcional y empieza vacío; sus opciones se listan en orden de estado. Déjalo en blanco y los incidentes creados desde esta plantilla aterrizan en el estado de creación del proyecto.
- **Recursos afectados** — los monitores, hosts, clústeres y servicios a los que debe adjuntarse el incidente, más **Cambiar estado del monitor a**.
- **De guardia** — **Política de guardia**, las políticas que se ejecutan cuando se declara un incidente creado a partir de esta plantilla.
- **Propietarios** — **Propietario - Equipos** y **Propietario - Usuarios**.
- **Etiquetas** — **Etiquetas**.

Un par de reglas rápidas:

- La lista de plantillas solo muestra **Nombre** y **Descripción**. Las filas no se editan ni se eliminan desde la lista: abre una plantilla (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) para cambiarla.
- Las plantillas admiten importación y exportación en JSON, así que puedes llevarte una de un proyecto a otro.
- El estado vacío dice "No incident templates found."

### Cómo se aplica una plantilla

Hay dos caminos, y se comportan igual.

- **Desde el panel** — el botón **Crear desde plantilla** de la lista de incidentes abre un selector **Seleccionar plantilla de incidente**, y la página de declaración lee la plantilla del parámetro `incidentTemplateId` de la cadena de consulta y rellena el formulario con la plantilla, sus equipos propietarios y sus usuarios propietarios.
- **Desde la API** — pasa `createdIncidentTemplateId` en `POST /api/incident` y el servidor rellena el incidente a partir de la plantilla.

Lo importante es la regla de fusión: **una plantilla solo rellena un campo que hayas dejado sin definir**. El título, la descripción, la severidad, el estado inicial, el estado de monitor que hay detrás de **Cambiar estado del monitor a**, los monitores, los hosts, los clústeres de Kubernetes, los hosts de Docker, los hosts de Podman, los servicios, las políticas de guardia y las etiquetas se copian de la plantilla solo cuando quien llama —o el formulario— no aportó nada. Lo que fijas de forma explícita siempre gana.

**El diálogo del estado vacío apunta al sitio equivocado.** Si aún no tienes plantillas, el botón **Crear desde plantilla** muestra un diálogo **No Incident Templates**. Su texto remite a los ajustes del proyecto, pero el botón lleva a **Incidentes → Ajustes → Plantillas de Incidentes**, que es la ubicación real.

## Plantillas de notas

Las plantillas de notas dan a quienes responden un texto ya preparado para las actualizaciones del incidente, de modo que una actualización de la página de estado a las tres de la madrugada no la escriba desde cero alguien medio dormido.

Ve a **Incidentes → Ajustes → Plantillas de Notas** (`/dashboard/{projectId}/incidents/settings/note-templates`). La tarjeta se titula **Public or Private Note Templates for Incidents** — una sola biblioteca sirve para ambos tipos de nota. El formulario de creación tiene dos pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**, ambos obligatorios.
- **Detalles de la nota** — el cuerpo de la nota, en Markdown, obligatorio.

Igual que con las plantillas de incidente, las filas se crean y se consultan en lugar de editarse en línea; abre una plantilla para cambiarla.

Las plantillas de notas aparecen justo donde las necesitas: los diálogos de confirmación **Acknowledge Incident** y **Resolve Incident** ofrecen **Seleccionar plantilla de nota** junto al campo **Nota pública**. Consulta [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) para ver en qué se diferencian las notas públicas de las privadas.

## Plantillas post-mortem

Una plantilla post-mortem es el esqueleto del análisis que redactas después de un incidente —tus encabezados, tus indicaciones, tus preguntas de siempre— para que todas las revisiones del proyecto sigan la misma forma.

Ve a **Incidentes → Ajustes → Plantillas Post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La tarjeta se titula **Plantillas Post-mortem**. El formulario de creación tiene dos pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**, ambos obligatorios.
- **Detalles del análisis post mortem** — **Plantilla de análisis post mortem**, el cuerpo en sí, en Markdown, obligatorio.

La plantilla se aplica desde el incidente, no desde los ajustes. Abre un incidente, elige **Post-mortem** en su menú lateral (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) y usa **Aplicar plantilla**. Eso abre un diálogo **Aplicar plantilla de análisis post mortem** con un desplegable **Seleccionar plantilla**; al elegir una, su cuerpo se carga en el editor **Nota del análisis post mortem**, donde lo editas antes de guardar. Los episodios de incidente tienen la misma página **Post-mortem** y beben de la misma biblioteca de plantillas.

## Campos personalizados

Los campos personalizados te permiten llevar tus propios metadatos en cada incidente: el nombre interno de un servicio, la referencia de un ticket de cambio, el nivel de un cliente.

Ve a **Incidentes → Ajustes → Campos Personalizados** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La página se titula **Campos personalizados de incidente**. Cada definición tiene:

- **Nombre del campo** — obligatorio, de al menos dos caracteres. El marcador de posición sugiere un nombre en forma de slug, como `internal-service`.
- **Descripción del campo** — opcional.
- **Tipo de campo** — obligatorio. Elige cómo se introducen los datos. Los tipos desplegables necesitan además que listes sus opciones.
- **Opciones del menú desplegable** — los valores que aparecen en el desplegable, cada uno con un color opcional.

Las definiciones viven en su propio modelo; los valores viven en el incidente, en la columna `customFields`. En un incidente concreto los rellenas desde **Campos Personalizados**, en el menú lateral del incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Un hueco que conviene conocer.** Las definiciones de campos personalizados de incidente son la única parte de la familia de incidentes sin disparadores de flujo de trabajo; lo vemos en la sección sobre flujos de trabajo más abajo.

## Roles de incidente

Los roles de incidente son los puestos con nombre a los que asignas personas durante una respuesta. Defínelos en **Incidentes → Ajustes → Roles de Incidente** (`/dashboard/{projectId}/incidents/settings/roles`); la descripción de la tarjeta pone Incident Commander y Responder como ejemplos.

Los roles son solo definiciones. A las personas las asignas incidente por incidente: el asistente de declaración tiene un paso **Roles de Incidente** con un campo **Asignar roles del incidente**, y cada incidente tiene una página **Roles** en su menú lateral.

## Prefijos de número

Todo incidente recibe un número. De forma predeterminada se muestra como `#42`. Si tu equipo dice "INC-42" en voz alta, haz que el producto lo diga también.

Ve a **Incidentes → Ajustes → Más Ajustes** (`/dashboard/{projectId}/incidents/settings/more`). La tarjeta es **Prefijo de número** y contiene dos campos del proyecto:

- **Prefijo de número de incidente** — hasta 20 caracteres, marcador de posición `INC-`. Fíjalo y el incidente `#42` se muestra como `INC-42`.
- **Prefijo de número de episodio de incidente** — la misma idea para los números de episodio de incidente, marcador de posición `IE-`.

Deja cualquiera de los dos vacío para conservar el prefijo `#` predeterminado; el campo sin definir muestra `# (default)`. Guarda con **Actualizar**. El valor con prefijo se almacena en el incidente como `incidentNumberWithPrefix`, que es lo que muestran la lista de incidentes y la cabecera del incidente.

## Reglas que se ejecutan al crear un incidente

**Incidentes → Reglas** reúne ocho motores de reglas. Todos hacen el mismo trabajo —mirar un incidente en cuanto se crea y actuar si coincide—, pero se diferencian en lo que hacen y en cómo se resuelven varias reglas coincidentes.

- **Reglas de Agrupación** — agrupan incidentes relacionados en episodios. Las reglas se evalúan por orden de prioridad; los números de prioridad más bajos van primero.
- **Reglas de guardia** — ejecutan políticas de guardia para los incidentes coincidentes. Las vemos en detalle más abajo.
- **Reglas del propietario** — asignan propietarios automáticamente.
- **Reglas de runbook** — arrancan un [runbook](/docs/runbooks/index) cuando un incidente coincide.
- **Reglas de privacidad** — deciden si un incidente coincidente es privado.
- **Reglas de etiquetas** — aplican etiquetas automáticamente.
- **Reglas de SLA** — hacen seguimiento de los tiempos de respuesta y resolución. Las reglas se evalúan en orden; los números de orden más bajos van primero.
- **Reminder Rules** — recuerdan periódicamente a los propietarios del incidente mientras siga abierto. Las reglas se evalúan en orden y gana la primera que coincide.

**La semántica del orden no es uniforme.** Las **Reglas de Agrupación**, las **Reglas de SLA** y las **Reminder Rules** se evalúan por orden. Las **Reglas de guardia** no: se dispara toda regla coincidente. No des por hecho que un mismo modelo vale para las ocho.

Las páginas **Reglas de guardia**, **Reglas del propietario**, **Reglas de etiquetas** y **Reglas de privacidad** tienen pestañas: una **Incident Rules** y otra **Episode Rules**, cada una con su propia tabla. Configura la pestaña **Incident Rules** salvo que te refieras específicamente a episodios. **Reglas de Agrupación**, **Reglas de runbook**, **Reglas de SLA** y **Reminder Rules** son tablas únicas.

## Reglas de guardia de incidentes

**Incidentes → Reglas → Reglas de guardia** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) es donde haces que la localización sea automática. La tarjeta, **Reglas de Guardia de Incidente**, describe reglas que ejecutan políticas de guardia automáticamente cuando se crean incidentes coincidentes. La página tiene dos pestañas: **Incident Rules** y **Episode Rules**.

El formulario de creación tiene tres pasos:

- **Información básica** — **Nombre** (el marcador de posición sugiere algo como avisar al equipo de bases de datos ante cualquier incidente de BD), **Descripción** y un interruptor **Habilitado**. La lista muestra por regla una píldora verde **Habilitado** o roja **Deshabilitado**.
- **Criterios de coincidencia** — **Monitores**, **Incidente Severidades**, **Etiquetas de incidentes**, **Etiquetas del monitor**, más campos de expresión regular sin distinción de mayúsculas para el título del incidente, la descripción del incidente, el nombre del monitor y la descripción del monitor.
- **Políticas de Guardia** — las políticas que ejecuta esta regla.

### Cómo se resuelven las coincidencias

Vale la pena interiorizar las reglas que rigen la propia pantalla:

- Una regla coincide solo cuando pasan **todos** los criterios que hayas rellenado. Los criterios que dejas vacíos se omiten, no fallan.
- Dentro de un mismo criterio de lista —**Monitores**, **Incidente Severidades**, **Etiquetas de incidentes**, **Etiquetas del monitor**— la coincidencia es de tipo "cualquiera de".
- Los campos de patrón son expresiones regulares sin distinción de mayúsculas y minúsculas.
- **Se disparan todas las reglas coincidentes.** No hay prioridad ni cortocircuito.
- El conjunto de políticas que realmente se ejecuta es la unión de las políticas de cada regla coincidente más cualquier política adjuntada al incidente a mano o por una plantilla, sin duplicados, de modo que cada política se ejecuta como mucho una vez.

La severidad es criterio de coincidencia aquí y en ningún otro sitio. No hay campo de guardia en una severidad de incidente: elegir "Incidente crítico" no localiza a nadie por sí solo. Si quieres que la severidad dispare la localización, escribe una regla de guardia que coincida con ella.

## Adjuntar políticas de guardia directamente

Las reglas no son el único camino. Cada incidente lleva su propia lista de políticas de guardia, que aparece como el campo **Política de guardia** en el paso **De guardia** del asistente de declaración y en el paso **De guardia** de una plantilla de incidente. La descripción del campo lo dice sin rodeos: son las políticas de guardia que se ejecutan cuando se crea este incidente.

Al crearse un incidente, OneUptime ejecuta las reglas de etiquetas, después las reglas de guardia (que fusionan sus políticas coincidentes en la lista del incidente) y después las reglas de runbook; y si la lista resultante no está vacía, se ejecutan todas sus políticas. Las ejecuciones corren en paralelo y se resuelven de forma independiente, así que si una política falla las demás siguen. Cada ejecución queda etiquetada con el incidente que la disparó y con el tipo de evento de notificación de incidente creado.

Para ver qué ocurrió, abre el incidente y elige **Ejecuciones de Guardia** en su menú lateral (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Gobernar incidentes desde flujos de trabajo

Los disparadores de flujo de trabajo para incidentes no están escritos a mano: OneUptime los genera a partir de los modelos de datos, así que cada modelo de la familia de incidentes obtiene componentes **On Create X**, **On Update X** y **On Delete X**, nombrados a partir del nombre en singular del modelo. Los tres principales son **On Create Incident**, **On Update Incident** y **On Delete Incident**, y los encuentras en la categoría **Incidente** del panel **Añadir componente**, en `/dashboard/{projectId}/workflows`.

Esa misma generación te da disparadores para la propia configuración: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** y más. Cada modelo obtiene además sus componentes de acción equivalentes —**Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** y sus versiones para varias filas—, de modo que un disparador y una acción con nombres parecidos conviven en la misma categoría. **On Create Incident** arranca un flujo de trabajo; **Create One Incident** abre un incidente.

Algunos detalles que importan al conectarlos:

- **On Update X** admite un argumento opcional **Listen on** que acota el disparador a las actualizaciones que tocan campos concretos. Déjalo en blanco para que se dispare ante cualquier cambio. Si llega una actualización sin registro de qué campos se movieron, el filtro se omite y el flujo de trabajo se ejecuta igualmente.
- **On Create X** y **On Update X** admiten ambos un argumento obligatorio **Select Fields**; **On Delete X** no admite ninguno.
- Los tres exponen un único puerto de salida **Éxito**, y cada uno acepta un argumento de ID para que puedas ejecutar el flujo de trabajo a mano contra un registro concreto.
- Los nombres salen del nombre en singular del modelo, no del de su tabla, y por eso ves **On Create Incident Team Owner** y **On Create Incident User Owner** en vez de nombres con forma de tabla.
- No hay disparadores para las definiciones de campos personalizados de incidente. Ese modelo es el único miembro de la familia de incidentes con los flujos de trabajo deshabilitados.

Para construir el resto del flujo de trabajo, consulta [Crear un flujo de trabajo](/docs/workflows/authoring) y [Variables](/docs/workflows/variables).

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja entre sí la funcionalidad de incidentes.
- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente de declaración, las plantillas y la API.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — las pantallas de ajustes de estado y severidad, y qué hacen los indicadores.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — dónde se usan las plantillas de notas.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién se entera de un incidente fuera de tu equipo.
- [Visión general de los flujos de trabajo](/docs/workflows/index) — automatizar sobre los disparadores de incidente.
- [Visión general de los Runbooks](/docs/runbooks/index) — los procedimientos que adjuntan las reglas de runbook.
