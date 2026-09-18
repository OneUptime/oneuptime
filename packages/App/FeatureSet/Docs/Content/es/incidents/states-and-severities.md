# Estados y severidades

Todo incidente lleva dos clasificaciones: un **estado**, que dice en qué punto de tu respuesta está, y una **severidad**, que dice cuánto duele. En el panel se parecen —ambas se muestran como píldoras de color en la lista de incidentes, ambas son listas con alcance de proyecto que puedes renombrar y recolorear—, pero hacen trabajos muy distintos.

Los estados gobiernan comportamiento. Tres indicadores booleanos de las filas de estado deciden qué incidentes cuentan como activos, qué botones aparecen en la cabecera del incidente, cuándo se detiene el reloj del SLA y cuándo desaparece el incidente de tu página de estado. Las severidades no gobiernan nada por sí mismas: son etiquetas que describen el impacto y sobre las que otras reglas pueden hacer coincidencias.

Ambas listas se crean al crearse tu proyecto, y ambas se editan en **Incidentes → Ajustes**. Esa sección del menú lateral de Incidentes está contraída de forma predeterminada, así que despliega **Ajustes** antes de ponerte a buscarla.

## Los estados llevan comportamiento; las severidades, significado

El modelo `IncidentState` tiene `name`, `description`, `color` y `order`, más tres booleanos: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Todo lo que el producto hace con los estados se apoya en esos booleanos y en `order`, nunca en el nombre del estado. Por eso puedes renombrar **Resuelto** como «Cerrado» y no se rompe nada: el indicador viaja con la fila.

El modelo `IncidentSeverity` tiene `name`, `description`, `color` y `order`, y nada más. No hay indicadores. Nada en OneUptime trata **Incidente crítico** de forma distinta a **Incidente menor** por sí solo: la severidad importa solo donde tú apuntes algo hacia ella, como el criterio de coincidencia **Incidente Severidades** de una regla de guardia.

Unas cuantas reglas rápidas:

- **Elige la severidad para comunicar impacto** — se muestra en la lista de incidentes y en la **Vista General** del incidente, y es un campo obligatorio al declarar un incidente.
- **Elige los estados para modelar tu proceso** — los pasos de respuesta por los que realmente pasas, en el orden en que los recorres.
- **No codifiques la urgencia en los estados** — un estado llamado «Crítico» no avisaría a nadie. Eso lo hacen la severidad más una regla de guardia.

## Los estados iniciales

Con el proyecto se crean tres estados, en este orden. La siembra es idempotente: solo se añade un estado cuando no existe ya otro con ese nombre.

| Estado           | `order` | Indicador             | Color     | Qué significa                                        |
| ---------------- | ------- | --------------------- | --------- | ---------------------------------------------------- |
| **Identificado** | `1`     | `isCreatedState`      | `#fd625e` | El estado en el que aterrizan los incidentes nuevos. |
| **Reconocido**   | `2`     | `isAcknowledgedState` | `#ffbf53` | Alguien ha asumido el incidente.                     |
| **Resuelto**     | `3`     | `isResolvedState`     | `#2ab57d` | El incidente ha terminado y deja de contar como activo. |

Fíjate en el nombre: el primer estado es **Identificado**, aunque varias descripciones dentro del producto lo sigan llamando estado «de creación». Cuando un documento o una información sobre herramientas dice «estado de creación», se refiere al estado que lleve `isCreatedState`, que en un proyecto recién creado es **Identificado**.

## Qué hace realmente cada indicador de estado

| Indicador             | Para qué sirve                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | El estado que recibe un incidente cuando nadie eligió ninguno. Si ningún estado del proyecto lleva este indicador, crear un incidente falla con un error que te pide añadir un estado de creación desde los ajustes. |
| `isAcknowledgedState` | Gobierna el botón **Acknowledge** y el mosaico de estadísticas «<nombre del estado> en» de la **Vista General** del incidente. Al pasar a este estado, el SLA del incidente se marca como respondido. |
| `isResolvedState`     | Gobierna el botón **Resolver** y el mosaico de resueltos, define la lista de **Incidentes Activos** y es lo que retira el incidente de la sección activa de una página de estado. Marca el SLA como resuelto. |

Se espera que solo un estado por proyecto lleve cada indicador: las búsquedas recuperan una sola fila. Los tres estados con indicador se pueden renombrar, recolorear y reordenar, pero la página de ajustes se niega a eliminarlos y muestra un error nombrando los estados de creación, reconocimiento y resolución.

Como la interfaz lee los nombres de estado de forma dinámica, renombrar un estado cambia lo que ves en todas partes: los mosaicos de estadísticas, los títulos de los modales de confirmación y la píldora de la lista de incidentes siguen el nombre que le diste a la fila.

## Añadir tus propios estados

Ve a **Incidentes → Ajustes → Estado del Incidente**. La página es una lista ordenada por `order` ascendente, y los estados nuevos se añaden al final. Arrastra una fila para cambiar su posición.

**Campos de un estado:**

- **Nombre** — obligatorio, al menos dos caracteres. El marcador de posición sugiere algo como «Investigating».
- **Descripción** — texto libre opcional que explica cuándo un incidente se queda en este estado.
- **Color** — obligatorio. Se elige en el selector de color; se guarda como un valor hexadecimal como `#fd625e`.

Los tres indicadores no se pueden establecer desde este formulario: pertenecen a las filas iniciales. Por tanto, todo estado que añadas es un estado sin indicador, lo cual tiene dos consecuencias que conviene tener en cuenta:

- **Cuenta como activo.** **Incidentes Activos** se define como «el estado actual no es el estado resuelto», así que cualquier cosa que añadas que no sea el estado resuelto mantiene el incidente en la lista de activos y en el recuento de la barra lateral.
- **Su botón de transición es genérico.** En lugar de **Acknowledge** o **Resolver**, el modal de confirmación se titula **Mark Incident as `<state name>`**, con un botón de envío **Mark as `<state name>`**.

Una forma habitual es insertar un paso de triaje o mitigación entre los estados de reconocimiento y resolución; por ejemplo, arrastrar un estado «Mitigado» nuevo para que quede después de **Reconocido** y antes de **Resuelto**.

## El orden es una restricción real, no una preferencia visual

La columna `order` se hace cumplir al escribir un cambio de estado, no solo al dibujar la lista:

- **Las transiciones hacia atrás se rechazan.** Mover un incidente a un estado situado antes que el actual falla con un error que nombra ambos estados.
- **Volver a elegir el estado actual se rechaza.** Poner un incidente en el estado en el que ya está falla con «Incident state cannot be same as previous state.».
- **Una fila retroactiva no puede duplicar a su vecina.** Insertar una fila de la línea de tiempo cuyo estado coincida con el de la fila que la sigue también se rechaza.
- **Los botones de la cabecera siguen la posición de los estados con indicador dentro del orden.** **Acknowledge** y **Resolver** se ofrecen según dónde esté el estado actual en la lista ordenada. Un estado propio colocado *después* del estado resuelto nunca mostrará un botón **Resolver**, porque no queda nada hacia lo que avanzar.

Así que, cuando añadas un estado, colócalo donde un incidente pasaría de verdad por él. Ordenarlo mal no solo queda raro: hace imposibles las transiciones.

## Las severidades iniciales

Con el proyecto se crean tres severidades, en este orden:

- **Incidente crítico** (`order` 1, `#b70400`) — problemas con un impacto altísimo en los clientes, que requieren respuesta inmediata. Una caída total o una brecha de datos.
- **Incidente mayor** (`order` 2, `#fd625e`) — impacto significativo, que normalmente requiere respuesta inmediata, a veces con una solución provisional que limita el daño. Un subsistema importante que falla.
- **Incidente menor** (`order` 3, `#ffbf53`) — impacto bajo, que normalmente se atiende dentro del horario laboral y que es improbable que la mayoría de los clientes note. Una ligera caída del rendimiento de la aplicación.

La severidad es obligatoria al declarar un incidente, y lo es también en cada especificación de incidente dentro de los criterios de un monitor, así que todo incidente —manual o automático— llega con una. Consulta [Declarar un incidente](/docs/incidents/declaring-incidents) para el flujo de declaración y [Plantillas de incidentes y alertas](/docs/monitor/incident-alert-templating) para la ruta que arranca en el monitor.

## Editar severidades

Ve a **Incidentes → Ajustes → Gravedad del Incidente**. Misma forma que la página de estados: una lista ordenada por `order`, arrastrar para reordenar, severidades nuevas añadidas al final, y **Nombre**, **Descripción** y **Color** en el formulario.

Dos diferencias respecto a los estados:

- **No hay protección contra el borrado.** Cualquier severidad se puede eliminar, incluidas las tres iniciales.
- **No hay indicadores que heredar.** Una severidad nueva se comporta exactamente igual que las iniciales: es una etiqueta con un color y una posición.

**Una nota sobre los marcadores de posición.** El formulario de severidad reutiliza palabra por palabra el texto de ejemplo del formulario de estados, así que las pistas hablan de estados de incidente en vez de severidades. Ignóralas y escribe tus propios nombres y descripciones de severidad.

Donde la severidad hace algo más que describir: en **Incidentes → Reglas → Reglas de guardia**, el campo **Incidente Severidades** de una regla es un criterio de coincidencia. Listar ahí **Incidente crítico** es la forma de expresar «avisa al equipo de bases de datos ante cualquier cosa crítica»: la política de guardia vive en la regla, no en la severidad.

## Mover un incidente por sus estados

Hay cuatro maneras de que un incidente cambie de estado:

- **Los botones de la cabecera.** Abre un incidente. Si su estado actual está antes del estado de reconocimiento, obtienes **Acknowledge** y **Resolver**; si está entre los dos, obtienes **Resolver**. Cada uno abre un modal de confirmación —**Acknowledge Incident** o **Resolve Incident**— que ofrece además **Seleccionar plantilla de nota**, **Nota pública** y **Notificar a suscriptores de la página de estado**.
- **La línea de tiempo de estado.** Añade una fila a mano desde la página **Línea de Tiempo de Estado** del incidente, con **Estado del incidente**, **Comienza en** y **Notificar a suscriptores de la página de estado**.
- **Cambio masivo.** La lista de incidentes tiene una acción masiva **Cambiar estado** para mover varios incidentes a la vez.
- **Automáticamente.** Un criterio de monitor con **Resolver incidente automáticamente** activado resuelve su incidente cuando el criterio deja de cumplirse, y la API puede actualizar el estado a través de `/api/incident-state-timeline`.

Todas ellas escriben una fila en la línea de tiempo. Un cambio de estado hace además unas cuantas cosas que no tienes que pedir: publica una entrada en el feed del incidente, asigna un Incident Commander si el incidente aún no tiene ninguno y actualiza el reloj del SLA. Reabrir un incidente resuelto inicia un registro de SLA nuevo desde el momento de la reapertura.

## La línea de tiempo de estado

La página **Línea de Tiempo de Estado** del menú lateral del incidente es el rastro de auditoría de todos los estados por los que ha pasado. La tarjeta de esa página se titula **Línea de Tiempo de Estado** y se ordena de más reciente a más antiguo.

**Columnas:**

- **Estado del incidente** — una píldora coloreada con el nombre y el color del estado.
- **Comienza en** — cuándo entró el incidente en este estado.
- **Termina en** — cuándo salió. El estado actual muestra `Currently Active`.
- **Duración** — tiempo pasado en el estado, contado hasta ahora en el caso del actual.
- **Estado de notificación del suscriptor** — si la notificación de la página de estado para este cambio se envió, se omitió o sigue pendiente, con un enlace **más detalles** y —cuando el envío falló— una acción **Retry**.

**Acciones de fila:**

- **Ver causa** — abre un modal **Causa Raíz** que muestra el Markdown registrado con ese cambio de estado.
- **Ver registros** — abre un modal que explica por qué cambió el estado, con un visor **Incident State Log**.

Las filas de la línea de tiempo se pueden crear y eliminar, pero no editar. Eliminar la fila equivocada reescribe la historia del incidente, así que trátalo como una herramienta de corrección y no como una costumbre de limpieza.

## La lista de Incidentes Activos

**Incidentes → Incidentes Activos** es la lista que vigilas durante un turno. Su definición es exactamente una condición: el estado actual del incidente es un estado en el que `isResolvedState` es falso. No se considera nada más: ni la severidad, ni la antigüedad, ni si alguien lo ha reconocido.

El elemento del menú lateral lleva una insignia roja con el recuento que usa esa misma consulta, así que la insignia y la lista siempre coinciden. Cuando no hay nada que ver, la página lo dice.

La consecuencia práctica: cualquier estado propio que añadas mantiene los incidentes en esta lista. Eso suele ser lo que quieres —«Mitigado» no es «terminado»—, pero significa que la insignia solo se vacía cuando los incidentes llegan de verdad al estado resuelto.

## Avisar a los suscriptores de la página de estado de un cambio de estado

Un cambio de estado puede enviar correo a tus suscriptores de la página de estado, pero pasa por varias puertas. Entenderlas ahorra un montón de depuración del tipo «¿por qué no le llegó a nadie?».

La notificación se solicita por fila de la línea de tiempo con **Notificar a suscriptores de la página de estado** (`shouldStatusPageSubscribersBeNotified`), la casilla del modal de cambio de estado y del formulario manual de la línea de tiempo. Cuando está desactivada, la fila se guarda con estado omitido y una explicación. Cuando está activada, la fila se pone en cola y la recoge un trabajo en segundo plano; el trabajo se ejecuta cada minuto, así que la entrega es rápida pero no instantánea.

**La fila en cola se omite cuando se cumple cualquiera de estas condiciones:**

- **El estado nuevo es el estado de creación.** A los suscriptores ya se les avisó al declararse el incidente, así que la primera fila de la línea de tiempo deliberadamente no envía un segundo mensaje.
- **El incidente no tiene monitores adjuntos.** Sin recursos, no hay página de estado a la que asociar el incidente.
- **El incidente no es visible en la página de estado** (`isVisibleOnStatusPage` está desactivado).
- **La página de estado tiene los incidentes desactivados** (`showIncidentsOnStatusPage` está desactivado). Esta condición es por página de estado: otras páginas que muestren el mismo monitor sí reciben aviso.

**Otra cosa que cambia el resultado.** Si escribes una **Nota pública** en el modal de cambio de estado, la fila de la línea de tiempo se marca como ya notificada en lugar de ponerse en cola. Lo que llega a los suscriptores es la propia nota, así que reciben un mensaje en vez de dos. El tipo de evento que hay detrás del mensaje simple de cambio de estado es `Subscriber Incident State Changed`.

Para saber quién recibe estos avisos y cómo se eligen las plantillas, consulta [Suscriptores y anuncios](/docs/status-pages/subscribers).

## Mantener un incidente fuera de la página de estado

Tres cosas distintas deciden si un incidente aparece siquiera en la página pública, y las tres tienen que cumplirse:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) en la propia página de estado.
- **Visible en la página de estado** (`isVisibleOnStatusPage`) en el incidente: un interruptor de la página **Ajustes** del incidente. Su valor predeterminado es verdadero y no está en el asistente de declaración; un criterio de monitor puede establecerlo con **Mostrar incidente en la página de estado**.
- **El estado actual no es el estado resuelto.** Esto es lo que retira un incidente de la sección activa: la consulta de la página de estado recupera los incidentes cuyo estado actual sea cualquier estado no resuelto. No archivas ni cierras nada: lo resuelves, y pasa al historial.

**Los incidentes privados no aparecen nunca.** Activar **Incidente privado** oculta el incidente en todas las páginas de estado, independientemente de los interruptores anteriores, y lo restringe a sus propietarios más los administradores y propietarios del proyecto.

Cuánto historial de incidentes resueltos conserva la página es un ajuste de la página de estado, no del incidente. Consulta [Recursos y grupos de la página de estado](/docs/status-pages/resources-and-groups) para ver cómo los monitores de la página deciden qué incidentes se muestran siquiera.

## Qué leer a continuación

- [Visión general de los incidentes](/docs/incidents/index) — cómo encaja el área de incidentes.
- [Declarar un incidente](/docs/incidents/declaring-incidents) — el asistente de declaración, las plantillas y la API.
- [Notas, responsables y actividad de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas y el feed de actividad.
- [Configuración y automatización de incidentes](/docs/incidents/settings) — plantillas, campos personalizados, reglas y disparadores de flujos de trabajo.
- [Suscriptores y anuncios](/docs/status-pages/subscribers) — quién recibe los correos que envía un cambio de estado.
- [Visión general de las páginas de estado](/docs/status-pages/index) — qué muestra una página de estado y a quién.
- [Visión general de los flujos de trabajo](/docs/workflows/index) — reaccionar a los cambios de estado con automatización.
