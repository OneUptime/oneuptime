# Ejecuciones y Registros

Cada vez que se ejecuta un workflow, OneUptime guarda un registro de lo que ocurrió: cuándo se ejecutó, si funcionó y qué hizo cada bloque. Ese registro se llama **ejecución**. Las ejecuciones son la forma de confirmar que un workflow funcionó, depurar uno que no lo hizo y revisar la actividad pasada.

## Dónde encontrarlas

| Página                                  | Lo que ves                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Workflows → Ejecuciones y Registros** | Cada ejecución de todos los workflows del proyecto. Filtra por workflow, estado y tiempo. |
| **Workflow → Pestaña Registros**        | Solo las ejecuciones de este workflow concreto.                                           |
| **Una ejecución individual**            | Una ejecución, con la salida de cada bloque.                                              |

## Estados de ejecución

| Estado             | Qué significa                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Programada**     | El disparador se activó y la ejecución está a punto de comenzar. Normalmente solo dura una fracción de segundo.                                            |
| **En curso**       | El workflow está en progreso. Los bloques de larga duración mantienen una ejecución en este estado.                                                        |
| **Éxito**          | Todos los bloques que se ejecutaron terminaron sin error. (Tomar una rama de **error** a propósito sigue contando como éxito; el workflow en sí no falló.) |
| **Error**          | Un bloque falló y no había un camino de **error** conectado para manejarlo. La ejecución se detuvo allí.                                                   |
| **Tiempo agotado** | La ejecución duró más de lo permitido. Consulta [Configuración y Seguridad](/docs/workflows/configuration).                                                |

## Leer una ejecución

Haz clic en cualquier ejecución para abrir los detalles. Verás:

- **Encabezado** — el disparador, hora de inicio y fin, duración total y estado.
- **Lista de bloques** — todos los bloques que se ejecutaron, en orden. Cada uno muestra los valores que recibió, su salida y qué camino tomó.
- **Errores** — si un bloque falló, el mensaje de error y (cuando esté disponible) más detalles.

Los valores mostrados son exactamente lo que vio el bloque, después de que todas las variables fueran sustituidas. Esta es la vista de depuración más útil: si un mensaje de Slack muestra el texto literal `{{Incident.title}}` en lugar del título real, sabes que la variable no se resolvió.

## Depuración común

### "Mi workflow no se ejecutó."

1. Asegúrate de que el workflow esté **activado** en Configuración. Los workflows nuevos comienzan desactivados.
2. Para un disparador de evento de OneUptime: confirma que el evento realmente ocurrió. Abre el registro y revisa su historial.
3. Para un disparador de webhook: confirma que el otro sistema está enviando a la URL correcta. La mayoría de las herramientas registran cuándo envían un webhook; comprueba allí.
4. Para un disparador de programación: confirma que la expresión cron coincide con la hora que esperas.

Si el disparador se activó pero no aparece ninguna ejecución, comprueba tu cuota de ejecuciones en **Configuración del Proyecto → Facturación**.

### "Un bloque posterior nunca se ejecutó."

Un bloque que no se ejecuta suele ser un problema de conexión. Abre el lienzo y comprueba:

- ¿Está conectada la salida del bloque anterior a la entrada de este bloque?
- ¿Tomó el bloque anterior una salida diferente a la que esperabas (por ejemplo, **error** en lugar de **éxito**, o **No** en lugar de **Sí**)? El detalle de la ejecución muestra qué camino se tomó.

### "Una variable llegó vacía."

Abre la ejecución y mira los valores del bloque que falla.

- Si ves el texto literal `{{BlockName.field}}`, la referencia no se resolvió, probablemente un error tipográfico en el nombre del bloque o del campo.
- Si ves una cadena vacía, el bloque anterior se ejecutó pero no produjo ese campo.

### "Funciona cuando lo ejecuto manualmente pero no desde el disparador."

Usa **Ejecutar Manualmente** con una carga útil JSON que se parezca a lo que envía el disparador real. Luego compara los valores de la ejecución manual con la ejecución real, lado a lado. La diferencia suele ser un solo nombre de campo o un tipo.

## Re-ejecutar un workflow

No hay un botón de "reintentar esta ejecución". No volvemos a ejecutar ejecuciones antiguas automáticamente porque los efectos secundarios (mensajes de Slack, llamadas a API, tickets) podrían no ser seguros de repetir. Para rehacer el trabajo, corrige el workflow y deja que el próximo disparador real lo active.

Para workflows manuales, simplemente haz clic en **Ejecutar Manualmente** con la misma carga útil.

## ¿Cuánto tiempo se conservan las ejecuciones?

Las ejecuciones se guardan indefinidamente para el proyecto. Si un workflow se ejecuta muy a menudo y satura tu historial (como un workflow de depuración que se dispara cada minuto), desactívalo o elimínalo para dejar de añadir ruido.

## Dónde seguir leyendo

- [Configuración y Seguridad](/docs/workflows/configuration) — tiempos de espera, límites de recursión, secretos ocultos.
- [Variables](/docs/workflows/variables) — la sintaxis de variables usada en tus bloques.
- [Componentes](/docs/workflows/components) — qué produce cada bloque.
