# Configuración y automatización

La configuración de incidentes no vive en Ajustes del proyecto. Vive dentro de la propia área de producto de Incidentes, en **Incidentes → Ajustes** e **Incidentes → Reglas**, en rutas que empiezan por `/dashboard/{projectId}/incidents/settings/`. Si has estado rastreando **Ajustes del proyecto** buscando plantillas de incidente o campos personalizados, esa es la razón por la que no los encontrabas.

Tanto la sección **Reglas** como la sección **Ajustes** del menú lateral de Incidentes están contraídas de forma predeterminada, así que tienes que desplegarlas antes de que aparezcan los elementos de abajo. Todo lo de aquí tiene alcance de proyecto: plantillas, roles, campos personalizados y reglas pertenecen a un proyecto y se aplican a todos los incidentes declarados en él.

Esta página es la referencia de esa configuración: qué contiene cada página y cuál de ella se ejecuta automáticamente en el momento en que se crea un incidente.

## Dónde viven los ajustes de incidentes

Abre **Incidentes** en la navegación lateral y luego despliega **Ajustes** al final del menú lateral.

| Página                       | Qué haces ahí                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Estado del Incidente**     | Añadir, renombrar, recolorear y reordenar los estados por los que pasa un incidente.                       |
| **Gravedad del Incidente**   | Añadir, renombrar, recolorear y reordenar los niveles de severidad.                                        |
| **Plantillas de Incidentes** | Rellenar de antemano un incidente entero: título, descripción, recursos, políticas de guardia, propietarios, etiquetas. |
| **Plantillas de Notas**      | Texto reutilizable para notas públicas y privadas.                                                         |
| **Plantillas Post-mortem**   | Estructuras reutilizables de análisis post mortem.                                                         |
| **Campos Personalizados**    | Definir campos adicionales que aparecen en todos los incidentes.                                           |
| **Roles de Incidente**       | Definir los roles a los que asignas a quienes responden, como Incident Commander.                          |
| **Más Ajustes**              | Los prefijos de número de incidente y de episodio de incidente.                                            |

**Estado del Incidente** y **Gravedad del Incidente** se cubren en profundidad en [Estados y severidades de incidentes](/docs/incidents/states-and-severities); el resto de esta página retoma desde **Plantillas de Incidentes**.

Despliega **Reglas** y obtienes ocho páginas más: **Reglas de Agrupación**, **Reglas de guardia**, **Reglas del propietario**, **Reglas de runbook**, **Reglas de privacidad**, **Reglas de etiquetas**, **Reglas de SLA** y **Reminder Rules**. Esas se cubren más abajo.

## Plantillas de incidente

Una plantilla de incidente es un esqueleto guardado de un incidente. En lugar de volver a teclear el mismo título, la misma lista de monitores y la misma política de guardia cada vez que el clúster de pagos se tambalea, la guardas una vez y declaras a partir de ella.

Ve a **Incidentes → Ajustes → Plantillas de Incidentes** (`/dashboard/{projectId}/incidents/settings/templates`). La tarjeta se titula **Plantillas de Incidentes**. Crear una te lleva por un asistente de seis pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**. Estos nombran la plantilla en sí; nunca aparecen en el incidente.
- **Detalles del incidente** — **Título**, **Descripción** (Markdown), **Gravedad del Incidente** y **Estado inicial del incidente**. **Estado inicial del incidente** es opcional y empieza vacío; sus opciones se listan en orden de estado. Déjalo en blanco y los incidentes de esta plantilla aterrizan en el estado de creación del proyecto.
- **Recursos afectados** — los monitores, hosts, clústeres y servicios a los que se debería adjuntar el incidente, más **Cambiar estado del monitor a**.
- **De guardia** — **Política de guardia**, las políticas que ejecutar cuando se declare un incidente creado desde esta plantilla.
- **Propietarios** — **Propietario - Equipos** y **Propietario - Usuarios**.
- **Etiquetas** — **Etiquetas**.

Unas cuantas reglas rápidas:

- La lista de plantillas muestra solo **Nombre** y **Descripción**. Las filas no se pueden editar ni eliminar desde la lista: abre una plantilla (`/dashboard/{projectId}/incidents/settings/templates/{modelId}`) para cambiarla.
- Las plantillas admiten importación y exportación en JSON, así que puedes mover una entre proyectos.
- El estado vacío dice «No incident templates found.».

### Cómo se aplica una plantilla

Hay dos rutas, y se comportan igual.

- **Desde el panel** — el botón **Crear desde plantilla** de la lista de incidentes abre un selector **Seleccionar plantilla de incidente**, y la página de declaración lee la plantilla del parámetro `incidentTemplateId` de la cadena de consulta, y luego rellena de antemano el formulario con la plantilla más sus equipos y usuarios propietarios.
- **Desde la API** — pasa `createdIncidentTemplateId` en `POST /api/incident` y el servidor rellena el incidente desde la plantilla.

La parte importante es la regla de fusión: **una plantilla solo rellena un campo que hayas dejado sin definir**. Título, descripción, severidad del incidente, estado inicial del incidente, el estado de monitor que hay detrás de **Cambiar estado del monitor a**, monitores, hosts, clústeres de Kubernetes, hosts de Docker, hosts de Podman, servicios, políticas de guardia y etiquetas se copian de la plantilla solo cuando quien llama o el formulario no aportaron nada. Cualquier cosa que establezcas explícitamente siempre gana.

**El diálogo de estado vacío apunta al sitio equivocado.** Si todavía no tienes plantillas, el botón **Crear desde plantilla** muestra un diálogo **No Incident Templates**. Su texto apunta a Ajustes del proyecto, pero el botón enruta a **Incidentes → Ajustes → Plantillas de Incidentes**: esa es la ubicación real.

## Plantillas de notas

Las plantillas de notas dan a quienes responden texto preparado para las actualizaciones de incidentes, de modo que una actualización de la página de estado a las 3 de la madrugada no la escriba desde cero alguien medio dormido.

Ve a **Incidentes → Ajustes → Plantillas de Notas** (`/dashboard/{projectId}/incidents/settings/note-templates`). La tarjeta se titula **Plantillas de notas públicas o privadas para incidentes**: una única biblioteca sirve a ambos tipos de nota. El formulario de creación tiene dos pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**, ambos obligatorios.
- **Detalles de la nota** — el cuerpo de la nota en sí, en Markdown, obligatorio.

Igual que las plantillas de incidente, las filas se crean y se consultan en lugar de editarse en línea; abre una plantilla para cambiarla.

Las plantillas de notas aparecen donde realmente las necesitas: los diálogos de confirmación **Acknowledge Incident** y **Resolve Incident** ofrecen ambos **Seleccionar plantilla de nota** junto al campo **Nota pública**. Consulta [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) para saber en qué se diferencian las notas públicas y privadas.

## Plantillas de análisis post mortem

Una plantilla de análisis post mortem es el esqueleto del informe que produces después de un incidente —tus encabezados, tus indicaciones, tus preguntas de siempre— para que toda revisión del proyecto siga la misma forma.

Ve a **Incidentes → Ajustes → Plantillas Post-mortem** (`/dashboard/{projectId}/incidents/settings/postmortem-templates`). La tarjeta se titula **Plantillas Post-mortem**. El formulario de creación tiene dos pasos:

- **Información de la plantilla** — **Nombre de la plantilla** y **Descripción de la plantilla**, ambos obligatorios.
- **Detalles del análisis post mortem** — **Plantilla de análisis post mortem**, el cuerpo en sí, en Markdown, obligatorio.

Aplicas una desde el incidente, no desde los ajustes. Abre un incidente, elige **Post-mortem** en su menú lateral (`/dashboard/{projectId}/incidents/{incidentId}/postmortem`) y usa **Aplicar plantilla**. Eso abre un diálogo **Apply Postmortem Template** con un desplegable **Seleccionar plantilla**; al elegir una se carga el cuerpo de la plantilla en el editor **Nota del análisis post mortem**, donde lo editas antes de guardar. Los episodios de incidente tienen la misma página **Post-mortem** y recurren a la misma biblioteca de plantillas.

## Campos personalizados

Los campos personalizados te permiten llevar tus propios metadatos en cada incidente: un nombre de servicio interno, una referencia de ticket de cambio, un nivel de cliente.

Ve a **Incidentes → Ajustes → Campos Personalizados** (`/dashboard/{projectId}/incidents/settings/custom-fields`). La página se titula **Campos personalizados de incidente**. Cada definición tiene:

- **Nombre del campo** — obligatorio, al menos dos caracteres. El marcador de posición sugiere un nombre tipo slug como `internal-service`.
- **Descripción del campo** — opcional.
- **Tipo de campo** — obligatorio. Elige cómo se introducen los datos. Los tipos desplegables también necesitan que se listen sus opciones.
- **Opciones del menú desplegable** — los valores que aparecen en el desplegable, cada uno con un color opcional.

Las definiciones viven en su propio modelo; los valores viven en el propio incidente, en la columna `customFields`. En un incidente concreto los rellenas desde **Campos Personalizados** en el menú lateral del incidente (`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`).

**Un hueco que conviene conocer.** Las definiciones de campo personalizado de incidente son la única parte de la familia de incidentes sin disparadores de flujo de trabajo; consulta la sección de flujos de trabajo más abajo.

## Roles de incidente

Los roles de incidente son los puestos con nombre a los que asignas personas durante una respuesta. Defínelos en **Incidentes → Ajustes → Roles de Incidente** (`/dashboard/{projectId}/incidents/settings/roles`); la descripción de la tarjeta da Incident Commander y Responder como ejemplos.

Los roles son solo definiciones. Asignas personas a ellos por incidente: el asistente de declaración tiene un paso **Roles de Incidente** con un campo **Asignar roles del incidente**, y cada incidente tiene una página **Roles** en su menú lateral.

## Prefijos de número

Cada incidente recibe un número. De forma predeterminada se muestra como `#42`. Si tu equipo dice «INC-42» en voz alta, haz que el producto lo diga también.

Ve a **Incidentes → Ajustes → Más Ajustes** (`/dashboard/{projectId}/incidents/settings/more`). La tarjeta es **Prefijo de número** y contiene dos campos del proyecto:

- **Prefijo de número de incidente** — hasta 20 caracteres, marcador de posición `INC-`. Configúralo y el incidente `#42` se muestra como `INC-42`.
- **Prefijo de número de episodio de incidente** — la misma idea para los números de episodio de incidente, marcador de posición `IE-`.

Deja cualquiera vacío para conservar el prefijo `#` predeterminado; el campo sin establecer muestra `# (default)`. Guarda con **Actualizar**. El valor con prefijo se guarda en el incidente como `incidentNumberWithPrefix`, que es lo que muestran la lista de incidentes y la cabecera del incidente.

## Reglas que se ejecutan cuando se crea un incidente

**Incidentes → Reglas** contiene ocho motores de reglas. Todos hacen el mismo trabajo —mirar un incidente en el momento en que se crea y actuar si coincide— pero difieren en qué hacen y en cómo se resuelven varias reglas coincidentes.

- **Reglas de Agrupación** — agrupan incidentes relacionados en episodios. Las reglas se evalúan por orden de prioridad; los números de prioridad más bajos van primero.
- **Reglas de guardia** — ejecutan políticas de guardia para los incidentes coincidentes. Se cubren en detalle más abajo.
- **Reglas del propietario** — asignan propietarios automáticamente.
- **Reglas de runbook** — inician un [runbook](/docs/runbooks/index) cuando un incidente coincide.
- **Reglas de privacidad** — deciden si un incidente coincidente es privado.
- **Reglas de etiquetas** — aplican etiquetas automáticamente.
- **Reglas de SLA** — hacen seguimiento de los tiempos de respuesta y resolución. Las reglas se evalúan en orden; los números de orden más bajos van primero.
- **Reminder Rules** — recuerdan periódicamente a los propietarios del incidente mientras el incidente sigue abierto. Las reglas se evalúan en orden y gana la primera regla coincidente.

**La semántica del orden no es uniforme.** Las Reglas de Agrupación, las Reglas de SLA y las Reminder Rules se evalúan por orden. Las Reglas de guardia no: se dispara toda regla coincidente. No supongas que un solo modelo se aplica a las ocho.

Las páginas **Reglas de guardia**, **Reglas del propietario**, **Reglas de etiquetas** y **Reglas de privacidad** tienen pestañas: una pestaña **Incident Rules** y una pestaña **Episode Rules**, cada una con su propia tabla. Configura la pestaña **Incident Rules** salvo que te refieras específicamente a episodios. **Reglas de Agrupación**, **Reglas de runbook**, **Reglas de SLA** y **Reminder Rules** son tablas únicas.

## Reglas de guardia de incidentes

**Incidentes → Reglas → Reglas de guardia** (`/dashboard/{projectId}/incidents/settings/on-call-rules`) es donde haces que el aviso sea automático. La tarjeta, **Reglas de Guardia de Incidente**, describe reglas que ejecutan automáticamente políticas de guardia cuando se crean incidentes coincidentes. La página tiene dos pestañas: **Incident Rules** y **Episode Rules**.

El formulario de creación tiene tres pasos:

- **Información básica** — **Nombre** (el marcador de posición sugiere algo como avisar al equipo de bases de datos ante cualquier incidente de BD), **Descripción** y un interruptor **Habilitado**. La lista muestra una píldora verde **Habilitado** o roja **Deshabilitado** por regla.
- **Criterios de coincidencia** — **Monitores**, **Incidente Severidades**, **Etiquetas de incidentes**, **Etiquetas del monitor**, más campos de expresión regular sin distinción de mayúsculas para el título del incidente, la descripción del incidente, el nombre del monitor y la descripción del monitor.
- **Políticas de Guardia** — las políticas que ejecuta esta regla.

### Cómo se resuelven las coincidencias

Las reglas que la propia página trae de fábrica merecen interiorizarse:

- Una regla coincide solo cuando pasan **todos** los criterios que rellenaste. Los criterios que dejaste vacíos se omiten, no se dan por fallidos.
- Dentro de un único criterio de lista —**Monitores**, **Incidente Severidades**, **Etiquetas de incidentes**, **Etiquetas del monitor**— la coincidencia es de tipo «cualquiera de».
- Los campos de patrón son expresiones regulares sin distinción de mayúsculas.
- **Todas las reglas coincidentes se disparan.** No hay prioridad ni cortocircuito.
- El conjunto de políticas que realmente se ejecuta es la unión de las políticas de todas las reglas coincidentes más cualquier política adjunta al incidente manualmente o por una plantilla, deduplicadas para que cada política se ejecute como máximo una vez.

La severidad es un criterio de coincidencia aquí y en ningún otro sitio. No hay ningún campo de guardia en una severidad de incidente: seleccionar «Critical Incident» no avisa a nadie por sí solo. Si quieres que la severidad impulse el aviso, escribe una regla de guardia que coincida con ella.

## Adjuntar políticas de guardia directamente

Las reglas no son la única ruta. Cada incidente lleva su propia lista de políticas de guardia, expuesta como el campo **Política de guardia** del paso **De guardia** del asistente de declaración y del paso **De guardia** de una plantilla de incidente. La descripción del campo lo dice sin rodeos: estas son las políticas de guardia que ejecutar cuando se cree este incidente.

Cuando se crea un incidente, OneUptime ejecuta las reglas de etiquetas, luego las reglas de guardia (que fusionan sus políticas coincidentes en la lista del incidente), luego las reglas de runbook, y si la lista resultante no está vacía, se ejecuta cada política de ella. Las ejecuciones corren en paralelo y se resuelven de forma independiente, así que el fallo de una política no detiene a las demás. Cada ejecución se etiqueta con el incidente que la disparó y con el tipo de evento de notificación de incidente creado.

Para ver qué ocurrió, abre el incidente y elige **Ejecuciones de Guardia** en su menú lateral (`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`).

## Impulsar incidentes desde flujos de trabajo

Los disparadores de flujo de trabajo para incidentes no se escriben a mano: OneUptime los genera a partir de los modelos de datos, así que cada modelo de la familia de incidentes obtiene componentes **On Create X**, **On Update X** y **On Delete X**, nombrados a partir del nombre en singular del modelo. Los tres principales son **On Create Incident**, **On Update Incident** y **On Delete Incident**, y viven en la categoría **Incident** del panel **Añadir componente** en `/dashboard/{projectId}/workflows`.

La misma generación te da disparadores para la propia configuración: **On Create Incident State**, **On Update Incident Severity**, **On Create Incident Template**, **On Create Incident Note Template**, **On Create Incident State Timeline**, **On Create Incident Public Note**, **On Create Incident Internal Note**, **On Create Incident On-Call Rule**, **On Create Incident Role**, **On Create Incident Member** y más. Cada modelo obtiene además componentes de acción equivalentes —**Find One Incident**, **Create One Incident**, **Update One Incident**, **Delete One Incident** y sus equivalentes de varias filas— así que un disparador y una acción con nombres parecidos quedan uno al lado del otro en la misma categoría. **On Create Incident** inicia un flujo de trabajo; **Create One Incident** abre uno.

Unos cuantos detalles que importan cuando los conectas:

- **On Update X** admite un argumento opcional **Listen on** que restringe el disparador a las actualizaciones que tocan campos concretos. Déjalo en blanco para dispararse ante cualquier cambio. Si llega una actualización sin registro de qué campos se movieron, el filtro se omite y el flujo de trabajo se ejecuta igualmente.
- **On Create X** y **On Update X** admiten ambos un argumento obligatorio **Select Fields**; **On Delete X** no admite argumentos.
- Los tres exponen un único puerto de salida **Éxito**, y cada uno acepta un argumento de ID para que puedas ejecutar el flujo de trabajo a mano contra un registro concreto.
- Los nombres vienen del nombre en singular del modelo, no del nombre de su tabla, que es por lo que ves **On Create Incident Team Owner** y **On Create Incident User Owner** en lugar de nombres con forma de tabla.
- No hay disparadores para las definiciones de campo personalizado de incidente. Ese modelo es el único miembro de la familia de incidentes con los flujos de trabajo deshabilitados.

Para construir el resto del flujo de trabajo, consulta [Crear un flujo de trabajo](/docs/workflows/authoring) y [Variables](/docs/workflows/variables).

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja la funcionalidad de incidentes.
- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente de declaración, las plantillas y la API.
- [Estados y severidades de incidentes](/docs/incidents/states-and-severities) — las páginas de ajustes de estado y severidad y qué hacen los indicadores.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — dónde se usan las plantillas de notas.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién se entera de un incidente fuera de tu equipo.
- [Visión general de los flujos de trabajo](/docs/workflows/index) — automatizar sobre los disparadores de incidente.
- [Visión general de los Runbooks](/docs/runbooks/index) — los procedimientos que adjuntan las reglas de runbook.
