# Estados y severidades

Todo incidente lleva dos clasificaciones: un **estado** que dice en qué punto de tu respuesta está, y una **severidad** que dice cuánto duele. En el panel se parecen —ambas se muestran como píldoras de color en la lista de incidentes, ambas son listas con alcance de proyecto que puedes renombrar y recolorear—. Hacen trabajos muy distintos.

Los estados impulsan comportamiento. Tres indicadores booleanos en las filas de estado deciden qué incidentes cuentan como activos, qué botones aparecen en la cabecera del incidente, cuándo se detiene el reloj del SLA y cuándo el incidente desaparece de tu página de estado. Las severidades no impulsan nada por sí solas: son etiquetas que describen el impacto y sobre las que otras reglas pueden hacer coincidencias.

Ambas listas se crean cuando se crea tu proyecto, y ambas se editan en **Incidentes → Ajustes**. Esa sección del menú lateral de Incidentes está contraída de forma predeterminada, así que despliega **Ajustes** antes de ponerte a buscarla.

## Los estados llevan comportamiento, las severidades llevan significado

El modelo `IncidentState` tiene `name`, `description`, `color` y `order`, más tres booleanos: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Todo lo que el producto hace con los estados se basa en esos booleanos y en `order`, nunca en el nombre del estado. Por eso puedes renombrar **Resuelto** a «Cerrado» y no se rompe nada: el indicador viaja con la fila.

El modelo `IncidentSeverity` tiene `name`, `description`, `color` y `order` y nada más. No hay indicadores. Nada en OneUptime trata **Critical Incident** de forma distinta a **Minor Incident** por sí solo: la severidad importa solo donde apuntes algo hacia ella, como el criterio de coincidencia **Incidente Severidades** de una regla de guardia.

Unas cuantas reglas rápidas:

- **Elige la severidad para comunicar impacto** — se muestra en la lista de incidentes, en la **Vista General** del incidente, y es un campo obligatorio cuando declaras un incidente.
- **Elige los estados para modelar tu proceso** — los pasos de respuesta por los que realmente pasas, en el orden en que los recorres.
- **No codifiques la urgencia en los estados** — un estado llamado «Crítico» no avisaría a nadie. Eso lo hace la severidad más una regla de guardia.

## Los estados predefinidos

Tres estados se crean con el proyecto, en este orden. La creación es idempotente: un estado solo se añade cuando no existe ya uno con ese nombre.

| Estado           | `order` | Indicador             | Color     | Qué significa                                          |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------------ |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | El estado en el que aterrizan los incidentes nuevos.   |
| **Reconocido**   | `2`     | `isAcknowledgedState` | `#ffbf53` | Alguien ha tomado el incidente.                        |
| **Resuelto**     | `3`     | `isResolvedState`     | `#2ab57d` | El incidente ha terminado y deja de contar como activo.|

Fíjate en el nombre: el primer estado es **Identified**, aunque varias descripciones dentro del producto lo siguen llamando el estado «de creación». Cuando un documento o una información sobre herramientas dice «estado de creación», se refiere al estado que lleve `isCreatedState`; en un proyecto nuevo, ese es **Identified**.

## Qué hace realmente cada indicador de estado

| Indicador             | Propósito                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | El estado que recibe un incidente cuando nadie eligió uno. Si ningún estado del proyecto lleva este indicador, crear un incidente falla con un error que te dice que añadas un estado de incidente de creación desde los ajustes. |
| `isAcknowledgedState` | Gobierna el botón **Acknowledge** y el mosaico de estadísticas «<nombre del estado> en» de la **Vista General** del incidente. Al cambiar a este estado, el SLA del incidente se marca como respondido. |
| `isResolvedState`     | Gobierna el botón **Resolver** y el mosaico de estadísticas de resolución, define la lista de **Incidentes Activos** y es lo que retira el incidente de la sección activa de una página de estado. Marca el SLA como resuelto. |

Se espera que solo un estado por proyecto tenga cada indicador: las búsquedas recuperan una única fila. Los tres estados con indicadores se pueden renombrar, recolorear y reordenar, pero la página de ajustes se niega a eliminarlos y muestra un error nombrando los estados de creación, reconocimiento y resolución.

Como la interfaz lee los nombres de estado de forma dinámica, renombrar un estado cambia lo que ves en todas partes: los mosaicos de estadísticas, los títulos de los modales de confirmación y la píldora de la lista de incidentes siguen todos el nombre que le diste a la fila.

## Añadir tus propios estados

Ve a **Incidentes → Ajustes → Estado del Incidente**. La página es una lista ordenada por `order` ascendente, y los estados nuevos se añaden al final. Arrastra una fila para cambiar su posición.

**Campos de un estado:**

- **Nombre** — obligatorio, al menos dos caracteres. El marcador de posición sugiere algo como «Investigating».
- **Descripción** — texto libre opcional que explica cuándo un incidente está en este estado.
- **Color** — obligatorio. Se elige del selector de color; se guarda como un valor hexadecimal como `#fd625e`.

No puedes establecer los tres indicadores desde este formulario: pertenecen a las filas predefinidas. Un estado que añadas es, por tanto, un estado sin indicador, lo que tiene dos consecuencias que conviene prever:

- **Cuenta como activo.** **Incidentes Activos** se define como «el estado actual no es el estado resuelto», así que cualquier cosa que añadas que no sea el estado resuelto mantiene el incidente en la lista activa y en el recuento de la barra lateral.
- **Su botón de transición es genérico.** En lugar de **Acknowledge** o **Resolver**, el modal de confirmación se titula **Mark Incident as `<state name>`** con un botón de envío **Mark as `<state name>`**.

Una forma habitual es insertar un paso de triaje o mitigación entre los estados de reconocimiento y resolución; por ejemplo, arrastrar un nuevo estado «Mitigated» para que quede después de **Reconocido** y antes de **Resuelto**.

## El orden es una restricción real, no una preferencia de visualización

La columna `order` se aplica cuando se escribe un cambio de estado, no solo cuando se dibuja la lista:

- **Las transiciones hacia atrás se rechazan.** Mover un incidente a un estado que está antes en el orden que su estado actual falla con un error que nombra ambos estados.
- **Volver a seleccionar el estado actual se rechaza.** Establecer un incidente al estado en el que ya está falla con «Incident state cannot be same as previous state.».
- **Una fila retroactiva no puede duplicar a su vecina.** Insertar una fila de línea de tiempo cuyo estado coincida con el de la fila que la sigue también se rechaza.
- **Los botones de la cabecera siguen la posición de los estados con indicador en el orden.** **Acknowledge** y **Resolver** se ofrecen según dónde esté el estado actual en la lista ordenada. Un estado personalizado colocado *después* del estado resuelto nunca mostrará un botón **Resolver**, porque no queda nada hacia lo que avanzar.

Así que, cuando añadas un estado, ponlo donde un incidente pasaría genuinamente por él. Ordenarlo mal no solo queda raro: hace imposibles las transiciones.

## Las severidades predefinidas

Tres severidades se crean con el proyecto, en este orden:

- **Critical Incident** (`order` 1, `#b70400`) — problemas que causan un impacto muy alto a los clientes y requieren una respuesta inmediata. Una interrupción total o una brecha de datos.
- **Major Incident** (`order` 2, `#fd625e`) — impacto significativo, normalmente requiere una respuesta inmediata, a veces con una solución alternativa que limita el daño. El fallo de un subsistema importante.
- **Minor Incident** (`order` 3, `#ffbf53`) — impacto bajo, normalmente se atiende dentro del horario laboral, y es poco probable que la mayoría de los clientes lo noten. Una ligera caída del rendimiento de la aplicación.

La severidad es obligatoria cuando declaras un incidente, y es obligatoria en cada especificación de incidente dentro de los criterios de un monitor, así que todo incidente —manual o automático— llega con una. Consulta [Declarar un incidente](/docs/incidents/declaring-incidents) para el flujo de declaración y [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating) para la ruta guiada por monitor.

## Editar severidades

Ve a **Incidentes → Ajustes → Gravedad del Incidente**. La misma forma que la página de estados: una lista ordenada por `order`, arrastra para reordenar, las severidades nuevas se añaden al final, con **Nombre**, **Descripción** y **Color** en el formulario.

Dos diferencias respecto a los estados:

- **No hay protección contra el borrado.** Cualquier severidad se puede eliminar, incluidas las tres predefinidas.
- **No hay indicadores que heredar.** Una severidad nueva se comporta exactamente igual que las predefinidas: es una etiqueta con un color y una posición.

**Una nota sobre los marcadores de posición.** El formulario de severidad reutiliza el texto de ejemplo del formulario de estado palabra por palabra, así que las sugerencias hablan de estados de incidente en vez de severidades. Ignóralas y escribe tus propios nombres y descripciones de severidad.

Donde la severidad hace más que describir: en **Incidentes → Reglas → Reglas de guardia**, el campo **Incidente Severidades** de una regla es un criterio de coincidencia. Listar ahí **Critical Incident** es la forma de expresar «avisa al equipo de bases de datos ante cualquier cosa crítica»; la política de guardia vive en la regla, no en la severidad.

## Mover un incidente por sus estados

Hay cuatro formas en que un incidente cambia de estado:

- **Los botones de la cabecera.** Abre un incidente. Si su estado actual está antes del estado de reconocimiento, obtienes **Acknowledge** y **Resolver**; si está entre ambos, obtienes **Resolver**. Cada uno abre un modal de confirmación —**Acknowledge Incident** o **Resolve Incident**— que también ofrece **Seleccionar plantilla de nota**, **Nota pública** y **Notificar a suscriptores de la página de estado**.
- **La línea de tiempo de estado.** Añade una fila a mano desde la página **Línea de Tiempo de Estado** del incidente con **Estado del incidente**, **Comienza en** y **Notificar a suscriptores de la página de estado**.
- **Cambio masivo.** La lista de incidentes tiene una acción masiva **Cambiar estado** para mover varios incidentes a la vez.
- **Automáticamente.** Un criterio de monitor con **Resolver incidente automáticamente** habilitado resuelve su incidente cuando el criterio deja de cumplirse, y la API puede actualizar el estado mediante `/api/incident-state-timeline`.

Cada una de estas escribe una fila en la línea de tiempo. Un cambio de estado también hace unas cuantas cosas que no tienes que pedir: publica una entrada en el feed del incidente, asigna un Incident Commander si el incidente aún no tiene uno y actualiza el reloj del SLA. Reabrir un incidente resuelto inicia un registro de SLA nuevo desde el momento de la reapertura.

## La línea de tiempo de estado

La página **Línea de Tiempo de Estado** del menú lateral del incidente es el rastro de auditoría de todos los estados en los que ha estado el incidente. La tarjeta de esa página se titula **Línea de Tiempo de Estado**, y está ordenada de más reciente a más antigua.

**Columnas:**

- **Estado del incidente** — una píldora de color con el nombre y el color del estado.
- **Comienza en** — cuándo entró el incidente en este estado.
- **Termina en** — cuándo salió. El estado actual muestra `Currently Active`.
- **Duración** — tiempo pasado en el estado, contado hasta ahora para el actual.
- **Estado de notificación del suscriptor** — si la notificación de la página de estado para este cambio se envió, se omitió o sigue pendiente, con un enlace **más detalles** y —cuando el envío falló— una acción **Retry**.

**Acciones de fila:**

- **Ver causa** — abre un modal **Causa Raíz** que muestra el Markdown registrado con ese cambio de estado.
- **Ver registros** — abre un modal que explica por qué cambió el estado, con un visor **Registro de estados del incidente**.

Las filas de la línea de tiempo se pueden crear y eliminar, pero no editar. Eliminar la fila equivocada reescribe la historia del incidente, así que trátalo como una herramienta de corrección y no como una costumbre de limpieza.

## La lista de Incidentes Activos

**Incidentes → Incidentes Activos** es la lista que vigilas durante un turno. Su definición es exactamente una condición: el estado actual del incidente es un estado donde `isResolvedState` es falso. No se considera nada más: ni la severidad, ni la antigüedad, ni si alguien lo ha reconocido.

El elemento del menú lateral lleva una insignia roja con el recuento que usa la misma consulta, así que la insignia y la lista siempre coinciden. Cuando no hay nada que ver, la página lo dice.

La consecuencia práctica: cualquier estado personalizado que añadas mantiene los incidentes en esta lista. Eso suele ser lo que quieres —«Mitigated» no es «hecho»— pero significa que la insignia solo se limpia cuando los incidentes llegan de verdad al estado resuelto.

## Avisar a los suscriptores de la página de estado de un cambio de estado

Un cambio de estado puede enviar correo a los suscriptores de tu página de estado, pero pasa por varias barreras. Entenderlas ahorra mucha depuración del tipo «¿por qué no se notificó a nadie?».

La notificación se solicita por fila de línea de tiempo mediante **Notificar a suscriptores de la página de estado** (`shouldStatusPageSubscribersBeNotified`), la casilla del modal de cambio de estado y del formulario manual de la línea de tiempo. Cuando está desactivada, la fila se guarda con estado omitido y una explicación. Cuando está activada, la fila se encola y un trabajo en segundo plano la recoge: el trabajo se ejecuta cada minuto, así que la entrega es rápida pero no instantánea.

**La fila encolada se omite entonces cuando se cumple cualquiera de estas condiciones:**

- **El nuevo estado es el estado de creación.** A los suscriptores ya se les avisó cuando se declaró el incidente, así que la primera fila de la línea de tiempo deliberadamente no envía un segundo mensaje.
- **El incidente no tiene monitores adjuntos.** Sin recursos, no hay página de estado a la que mapear el incidente.
- **El incidente no es visible en la página de estado** (`isVisibleOnStatusPage` está desactivado).
- **La página de estado tiene los incidentes desactivados** (`showIncidentsOnStatusPage` está desactivado). Esto es por página de estado: otras páginas que muestren el mismo monitor sí reciben la notificación.

**Una cosa más que cambia el resultado.** Si escribes una **Nota pública** en el modal de cambio de estado, la fila de la línea de tiempo se marca como ya notificada en vez de encolarse. La propia nota es lo que llega a los suscriptores, así que reciben un mensaje en lugar de dos. El tipo de evento detrás del mensaje simple de cambio de estado es `Subscriber Incident State Changed`.

Para saber quién recibe estos mensajes y cómo se eligen las plantillas, consulta [Suscriptores y anuncios](/docs/status-pages/subscribers).

## Mantener un incidente fuera de la página de estado

Tres cosas distintas deciden si un incidente está en la página pública, y las tres deben cumplirse:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) en la propia página de estado.
- **Visible en la página de estado** (`isVisibleOnStatusPage`) en el incidente: un interruptor en la página **Ajustes** del incidente. Su valor predeterminado es verdadero y no está en el asistente de declaración; un criterio de monitor puede establecerlo con **Mostrar incidente en la página de estado**.
- **El estado actual no es el estado resuelto.** Esto es lo que retira un incidente de la sección activa: la consulta de la página de estado recupera los incidentes cuyo estado actual es cualquier estado no resuelto. No archivas ni cierras nada: lo resuelves, y pasa al historial.

**Los incidentes privados nunca aparecen.** Activar **Incidente privado** oculta el incidente en todas las páginas de estado, independientemente de los interruptores anteriores, y lo restringe a sus propietarios más los administradores y propietarios del proyecto.

Cuánto historial resuelto conserva la página es un ajuste de la página de estado, no del incidente. Consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) para saber cómo los monitores de la página deciden qué incidentes aparecen siquiera.

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja el área de funcionalidad de incidentes.
- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente de declaración, las plantillas y la API.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, reglas y disparadores de flujo de trabajo.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién recibe los correos que envía un cambio de estado.
- [Visión general de las páginas de estado](/docs/status-pages/index) — qué muestra una página de estado y a quién.
- [Visión general de los flujos de trabajo](/docs/workflows/index) — reaccionar a los cambios de estado con automatización.
