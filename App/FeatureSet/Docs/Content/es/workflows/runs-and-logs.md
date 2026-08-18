# Ejecuciones y Registros

Cada vez que se ejecuta un workflow, OneUptime guarda un registro de lo que ocurrió: cuándo se ejecutó, si funcionó y qué hizo cada bloque. Ese registro se llama una **ejecución**. Las ejecuciones son la forma de confirmar que un workflow funcionó, depurar uno que no lo hizo y revisar la actividad pasada.

## Dónde encontrarlas

| Página                                          | Lo que ves                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Flujos de trabajo → Ejecuciones y Registros** | Cada ejecución de todos los workflows del proyecto. Filtra por nombre de workflow, estado y tiempo.    |
| **Flujo de trabajo → Ejecuciones y Registros**  | Solo las ejecuciones de este workflow concreto. Esta tiene un filtro de **Run ID** en lugar de uno de workflow. |
| **Una ejecución individual**                    | Se abre con el botón **Ver registros** en una fila de ejecución — las filas de ejecución en sí no son clicables. |

## Estados de ejecución

| Estado                                | Qué significa                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Programado**                        | El disparador se activó y la ejecución está en cola para un runner. Normalmente solo dura una fracción de segundo. Una ejecución que sigue en **Programado** después de 5 minutos ha fallado: nadie la recogió.                          |
| **En ejecución**                      | El workflow está en progreso. Los bloques de larga duración mantienen una ejecución en este estado.                                                                                                                                       |
| **Esperando**                         | La ejecución está detenida en un bloque **Sleep** y se reanudará por sí sola. No ocupa ningún worker mientras espera.                                                                                                                     |
| **Executed**                          | La ejecución llegó al final sin fallar. (Este es el estado de éxito; la píldora dice **Executed**, no «Success».)                                                                                                                         |
| **Error**                             | La ejecución se detuvo porque un bloque lanzó un error. También se usa cuando una ejecución en cola nunca es recogida, cuando se pierde la reanudación de una ejecución dormida, cuando no se puede resolver una expresión de programación, o cuando el workflow se deshabilita a mitad de ejecución. |
| **Tiempo agotado**                    | La ejecución duró más de lo permitido. Consulta [Configuración y Seguridad](/docs/workflows/configuration).                                                                                                                               |
| **Ejecución excede el plan actual**   | El proyecto ha agotado sus ejecuciones de workflow de los últimos 30 días, o la suscripción no está pagada. La ejecución se registra pero no se ejecuta. Solo en OneUptime Cloud.                                                        |

Un bloque que pasa por su salida **Error** — un bloque de API con una respuesta 4xx, por ejemplo — no hace fallar la ejecución. La rama de error se ejecuta y la ejecución sigue terminando como **Executed**. El paso en sí se sigue dibujando en rojo para que puedas encontrarlo.

## Leer una ejecución

Haz clic en **Ver registros** en una ejecución para abrirla. La vista **Workflow Run** tiene dos pestañas.

**Steps** — una fila por cada bloque que se ejecutó, en orden. Cada fila muestra el título del bloque, su component id, cuánto tardó, y la salida por la que salió (`→ success`, `→ error`, `→ yes`). Expande una fila para ver dos bloques de detalle:

- **Received** — los ajustes que se le dieron al bloque, después de que todas las variables fueron resueltas.
- **Returned** — lo que produjo.

Los pasos fallidos aparecen en rojo y empiezan expandidos, con el mensaje de error impreso encima de **Received**.

**Full Log** — el registro crudo línea por línea que imprimió el runner, incluyendo cualquier cosa que los propios bloques registraran. Úsalo cuando la vista Steps no explique el fallo.

Dos detalles que vale la pena conocer. El component id impreso bajo el título de cada paso es exactamente la cadena que debes pegar en una referencia `{{local.components.<id>.returnValues.…}}`, lo que hace de esto la forma más rápida de acertar con una referencia. Y una ejecución conserva solo sus últimos 100 pasos: una ejecución larga o reanudada repetidamente muestra una nota ámbar donde se descartaron los pasos anteriores.

Los valores mostrados son los que vio el bloque después de que las variables fueran sustituidas, con dos excepciones: los secretos y los campos que el bloque marca como sensibles se redactan, y los valores muy largos se recortan con «… (truncated)».

Iniciar una ejecución desde el **Builder** abre esta misma vista ya siguiendo la ejecución, para que puedas verla ocurrir en lugar de tener que buscarla después.

## Depuración común

### «Mi workflow no se ejecutó.»

1. Asegúrate de que el workflow esté **Enabled** en su página **Overview**. Los workflows nuevos empiezan deshabilitados, y un workflow deshabilitado rechaza cada ejecución, incluidas las manuales.
2. Para un disparador de evento de OneUptime: confirma que el evento realmente ocurrió. Abre el registro y revisa su historial.
3. Para un disparador de webhook: confirma que el otro sistema está enviando a la URL correcta. La mayoría de las herramientas registran cuándo envían un webhook; comprueba allí.
4. Para un disparador de programación: confirma que la expresión cron coincide con la hora que esperas.

Si la ejecución *sí* aparece con el estado **Ejecución excede el plan actual**, el proyecto ha agotado todas sus ejecuciones de workflow de los últimos 30 días, o la suscripción no está pagada. El registro de la ejecución nombra el conteo y el límite de tu plan. Esto aplica solo a OneUptime Cloud.

### «Un bloque posterior nunca se ejecutó.»

Un bloque que no se ejecuta suele ser un problema de conexión. Abre el **Builder** y comprueba:

- ¿Está conectada la salida del bloque anterior a la entrada de este bloque?
- ¿Tomó el bloque anterior una salida diferente a la que esperabas — **Error** en lugar de **Success**, o **No** en lugar de **Yes**? La pestaña Steps muestra cuál tomó.

### «Una variable llegó vacía.»

Abre la ejecución y mira el bloque **Received** del paso que falló.

- Si ves el texto literal `{{local.components.…}}`, la referencia no se resolvió. Normalmente es un error tipográfico en el component id o en el id del return-value; recuerda que es el **Identifier** del bloque, no el nombre que se muestra en él. Comprueba también la ortografía de `local.components` en sí: `{{local.componets.api-get-1.returnValues.response-body}}` se envía como texto literal y la ejecución sigue reportando **Executed**.
- Si ves una cadena vacía, el bloque anterior se ejecutó pero no produjo ese campo.

La pestaña **Full Log** lleva una línea de advertencia nombrando cualquier referencia que no se resolvió, lo que suele ser la forma más rápida de encontrarla.

### «Funciona cuando lo ejecuto a mano pero no desde el disparador.»

Abre el **Builder**, haz clic en **Run Workflow**, y rellena los campos del disparador con valores que se parezcan a lo que envía el disparador real. Luego compara los valores **Received** de esa ejecución con los de la ejecución real, uno junto al otro. La diferencia suele ser un solo nombre de campo o tipo.

## Volver a ejecutar un workflow

No hay un botón «reintentar esta ejecución». No volvemos a ejecutar ejecuciones antiguas automáticamente porque los efectos secundarios — mensajes de Slack, llamadas a API, tickets — podrían no ser seguros de repetir. Para rehacer el trabajo, arregla el workflow y deja que el siguiente disparador real lo active, o abre el **Builder** y haz clic en **Run Workflow** con los mismos valores.

## ¿Cuánto tiempo se conservan las ejecuciones?

En OneUptime Cloud, las ejecuciones se conservan durante **30 días** y luego se eliminan; por eso ambas listas de ejecuciones se describen a sí mismas como que cubren los últimos 30 días. Las instalaciones autoalojadas conservan las ejecuciones hasta que las elimines; si un workflow se ejecuta muy a menudo y satura tu historial, deshabilítalo o elimínalo para dejar de añadir ruido.

Las ejecuciones registradas antes de que se añadiera el trazado de pasos no tienen contenido en **Steps** y muestran solo su **Full Log**.

## Qué leer a continuación

- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — tiempos de espera, límites de recursión, secretos ocultos.
- [Variables de flujo de trabajo](/docs/workflows/variables) — la sintaxis de variables usada en tus bloques.
- [Componentes de flujo de trabajo](/docs/workflows/components) — qué produce cada bloque.
