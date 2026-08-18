# Ejecuciones y Registros

Cada vez que se ejecuta un flujo de trabajo, OneUptime guarda constancia de lo ocurrido — cuándo se ejecutó, si funcionó y qué hizo cada bloque. A esa constancia la llamamos **ejecución**. Las ejecuciones son la forma de confirmar que un flujo de trabajo funcionó, depurar el que no lo hizo y repasar la actividad pasada.

## Dónde encontrarlas

| Página                        | Qué ves                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Flujos de Trabajo → Ejecuciones y Registros** | Todas las ejecuciones de todos los flujos de trabajo del proyecto. Filtra por nombre de flujo, estado y hora.           |
| **Flujo de trabajo → Ejecuciones y Registros**  | Solo las ejecuciones de este flujo de trabajo. Aquí, en lugar del filtro por flujo, tienes uno de **ID de ejecución**.  |
| **Una ejecución concreta**            | Se abre con el botón **Ver registros** de la fila de la ejecución — las filas en sí no son clicables.           |

## Estados de ejecución

| Estado                             | Qué significa                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Programado**                      | El disparador saltó y la ejecución está en cola esperando un runner. Suele durar una fracción de segundo. Una ejecución que siga programada pasados 5 minutos se marca como fallida — nadie la recogió. |
| **En ejecución**                        | El flujo de trabajo está en marcha. Los bloques largos mantienen la ejecución en este estado.                                                                                |
| **Esperando**                        | La ejecución está aparcada en un bloque **Sleep** y se reanudará sola. Mientras espera no ocupa ningún worker.                                                      |
| **Executed**                       | La ejecución llegó al final sin fallar. (Este es el estado de éxito — la píldora dice **Executed**, no «Success».)                                        |
| **Error**                          | La ejecución se detuvo porque un bloque lanzó un error. También se usa cuando una ejecución en cola no la recoge nadie, cuando se pierde la reanudación de una ejecución dormida, cuando no se puede resolver una expresión de programación o cuando el flujo de trabajo se deshabilita a media ejecución. |
| **Timeout**                        | La ejecución duró más de lo permitido. Consulta [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | El proyecto ha agotado sus ejecuciones de flujo de trabajo de los últimos 30 días, o la suscripción está impagada. La ejecución se registra pero no se ejecuta. Solo en OneUptime Cloud. |

Un bloque que sale por su salida **Error** — pongamos, un bloque API ante un 4xx — no hace fracasar la ejecución. La rama de error se ejecuta y la ejecución termina igualmente como **Executed**. Eso sí, el paso se dibuja en rojo para que lo encuentres.

## Leer una ejecución

Haz clic en **Ver registros** de una ejecución para abrirla. La vista **Workflow Run** tiene dos pestañas.

**Pasos** — una fila por cada bloque que se ejecutó, en orden. Cada fila muestra el título del bloque, su id de componente, cuánto tardó y la salida por la que se fue (`→ success`, `→ error`, `→ yes`). Despliega una fila y verás dos bloques de detalle:

- **Received** — los ajustes con los que se ejecutó el bloque, ya con todas las variables resueltas.
- **Returned** — lo que produjo.

Los pasos fallidos salen en rojo y ya desplegados, con el mensaje de error impreso encima de **Received**.

**Full Log** — el registro en bruto, línea a línea, tal como lo imprimió el runner, incluido lo que los propios bloques hayan registrado. Recurre a él cuando la vista de pasos no explique el fallo.

Dos detalles que conviene saber. El id de componente que aparece bajo el título de cada paso es exactamente la cadena que tienes que pegar en una referencia `{{local.components.<id>.returnValues.…}}`, lo que convierte esta vista en la vía más rápida para escribir una referencia correcta. Y una ejecución solo conserva sus últimos 100 pasos — en una ejecución larga o reanudada muchas veces verás una nota ámbar donde estaban los primeros.

Los valores que ves son los que vio el bloque una vez sustituidas las variables, con dos excepciones: los secretos y los campos que el bloque marca como sensibles se ocultan, y los valores muy largos se recortan con «… (truncated)».

Si arrancas una ejecución desde el **Constructor**, se abre esta misma vista siguiendo ya la ejecución, así que la ves ocurrir en directo en lugar de tener que buscarla después.

## Depuración habitual

### «Mi flujo de trabajo no se ejecutó.»

1. Asegúrate de que el flujo de trabajo está **Habilitado** en su página **Vista General**. Los flujos nuevos nacen deshabilitados, y un flujo deshabilitado rechaza cualquier ejecución, incluidas las manuales.
2. Si es un disparador de evento de OneUptime: confirma que el evento ocurrió de verdad. Abre el registro y revisa su historial.
3. Si es un disparador de webhook: confirma que el otro sistema está llamando a la URL correcta. Casi todas las herramientas dejan constancia de los webhooks que envían — míralo ahí.
4. Si es un disparador de programación: confirma que la expresión cron coincide con la hora que esperas.

Si la ejecución *sí* aparece con el estado **Execution Exceeded Current Plan**, el proyecto ha gastado todas sus ejecuciones de flujo de trabajo de los últimos 30 días, o la suscripción está impagada. El registro de la ejecución indica el recuento y el límite de tu plan. Esto solo aplica a OneUptime Cloud.

### «Un bloque posterior no llegó a ejecutarse.»

Cuando un bloque no se ejecuta, casi siempre es un problema de cableado. Abre el **Constructor** y comprueba:

- ¿Está la salida del bloque anterior conectada a la entrada de este?
- ¿Salió el bloque anterior por una salida distinta de la que esperabas — **Error** en vez de **Success**, o **No** en vez de **Sí**? La pestaña Pasos te dice por cuál se fue.

### «Una variable llegó vacía.»

Abre la ejecución y mira el bloque **Received** del paso que falló.

- Si ves el texto literal `{{local.components.…}}`, la referencia no se resolvió. Suele ser una errata en el id del componente o en el del valor de retorno — recuerda que es el **Identifier** del bloque, no el nombre que se muestra en él. Revisa también cómo has escrito `local.components`: `{{local.componets.api-get-1.returnValues.response-body}}` se envía como texto literal y la ejecución sigue reportándose como **Executed**.
- Si ves una cadena vacía, el bloque anterior sí se ejecutó, pero no produjo ese campo.

La pestaña **Full Log** incluye una línea de advertencia con el nombre de cualquier referencia que no se resolviera, que suele ser la forma más rápida de dar con ella.

### «Funciona cuando lo ejecuto a mano, pero no desde el disparador.»

Abre el **Constructor**, haz clic en **Ejecutar flujo de trabajo** y rellena los campos del disparador con valores parecidos a los que envía el disparador real. Después compara los valores de **Received** de esa ejecución con los de la ejecución real, uno al lado del otro. La diferencia suele ser un solo nombre de campo o un tipo.

## Volver a ejecutar un flujo de trabajo

No hay botón de «reintentar esta ejecución». No repetimos ejecuciones antiguas automáticamente porque sus efectos — mensajes de Slack, llamadas a APIs, tickets — pueden no ser seguros de repetir. Para rehacer el trabajo, arregla el flujo de trabajo y deja que lo dispare el siguiente evento real, o abre el **Constructor** y haz clic en **Ejecutar flujo de trabajo** con los mismos valores.

## ¿Cuánto tiempo se guardan las ejecuciones?

En OneUptime Cloud, las ejecuciones se conservan **30 días** y luego se eliminan — por eso las dos listas de ejecuciones dicen que cubren los últimos 30 días. Las instalaciones autoalojadas conservan las ejecuciones hasta que las elimines tú; si un flujo de trabajo se ejecuta muy a menudo y te llena el historial, deshabilítalo o elimínalo para dejar de añadir ruido.

Las ejecuciones registradas antes de que existiera el trazado de pasos no tienen contenido en **Pasos** y solo muestran su **Full Log**.

## Qué leer a continuación

- [Configuración y seguridad del flujo de trabajo](/docs/workflows/configuration) — tiempos de espera, límites de recursión, secretos ocultos.
- [Variables de flujo de trabajo](/docs/workflows/variables) — la sintaxis de variables que usas en tus bloques.
- [Componentes de flujo de trabajo](/docs/workflows/components) — qué produce cada bloque.
