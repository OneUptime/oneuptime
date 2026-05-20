# Ejecuciones y registros

Cada vez que se dispara el disparador de un flujo de trabajo, OneUptime crea una **ejecución** — un registro de una corrida con tiempos, estado y salida por nodo. Las ejecuciones son la forma en que confirmas que un flujo de trabajo funcionó, cómo depuras uno que no lo hizo y cómo escribes un post-mortem cuando una automatización se porta mal.

## Dónde encontrarlas

| Página | Alcance |
| --- | --- |
| **Workflows → Runs & Logs** | A nivel de proyecto. Cada ejecución de cada flujo de trabajo. Filtra por flujo de trabajo, estado y rango de tiempo. |
| **Pestaña Logs de un flujo de trabajo** | Solo las ejecuciones de este flujo de trabajo. |
| **Página de detalle de una ejecución** | Una ejecución, expandida con la salida por nodo y cualquier mensaje de error. |

## Estados de ejecución

| Estado | Significado |
| --- | --- |
| **Scheduled** | El disparador se activó y la ejecución está en cola, pero el worker aún no la ha recogido. Suele ser una fracción de segundo. |
| **Running** | El worker está recorriendo actualmente el grafo. Los componentes de larga duración (llamadas HTTP lentas, retrasos intencionados) mantienen una ejecución en este estado. |
| **Success** | Cada nodo que se ejecutó terminó sin error. (Un flujo de trabajo que tomó una rama `error` deliberadamente sigue siendo `Success` en conjunto — el flujo de trabajo en sí no falló.) |
| **Error** | Un nodo falló y no había puerto `error` cableado para manejarlo. La ejecución se detuvo en ese nodo. |
| **Timeout** | La ejecución superó el timeout por ejecución. Consulta [Configuración y seguridad](/docs/workflows/configuration). |

## Leer una ejecución

Haz clic en una ejecución de la lista para abrir su página de detalle. Verás:

- **Encabezado** — el disparador que se activó, las marcas de tiempo de inicio y fin, la duración total, el estado.
- **Lista de nodos** — cada nodo que se ejecutó en orden, cada uno con sus argumentos capturados, su valor de retorno y el puerto de salida elegido.
- **Errores** — si un nodo falló, el mensaje de error y (cuando esté disponible) la traza de pila.

Los argumentos capturados muestran valores *post-interpolación* — es decir, las cadenas exactas que vio el nodo después de resolver las variables. Esta es la vista de depuración más útil: si un mensaje de Slack contiene el texto literal `{{Incident.title}}`, sabes que la referencia de variable no se resolvió.

## Patrones comunes de depuración

### "Mi flujo de trabajo no se activó."

1. Confirma que el flujo de trabajo está **habilitado** en **Settings**. Los flujos nuevos se envían deshabilitados.
2. Para un disparador de evento de modelo: confirma que el evento realmente ocurrió. Abre la entidad (el incidente, alerta, monitor) y mira su historial.
3. Para un disparador webhook: confirma que el sistema externo está llamando a la URL correcta. Muchas herramientas registran la entrega de webhooks salientes — compruébalo allí.
4. Para un disparador programado: confirma que la expresión cron evalúa a la hora que esperas. Usa un parser de cron si tienes dudas.

Si el disparador se activó pero no aparece ninguna ejecución, comprueba la cuota de ejecuciones del proyecto en **Project Settings → Billing**.

### "Se ejecuta pero un nodo aguas abajo nunca se ejecuta."

Un nodo que no se ejecuta suele ser un problema de cableado. Abre el lienzo y comprueba:

- ¿Está el puerto de salida del nodo aguas arriba realmente conectado al puerto de entrada de este nodo?
- ¿El nodo aguas arriba tomó un puerto distinto (por ejemplo, `error` en lugar de `success`, o `no` en lugar de `yes`)? Mira el detalle de la ejecución para ver qué puerto eligió.

### "Una variable llega vacía."

Abre el detalle de la ejecución y mira los argumentos capturados del nodo que falla. Si ves el texto literal `{{NodeId.field}}`, la referencia no se resolvió — probablemente una errata en `NodeId` o `field`. Si ves una cadena vacía, el nodo aguas arriba se ejecutó pero no produjo ese campo.

### "Funciona manualmente pero no desde el disparador."

Usa **Run Manually** con un payload JSON que refleje lo que publica el disparador real. Luego compara los argumentos capturados de la ejecución manual y de la ejecución de producción lado a lado — la diferencia suele estar en el nombre o el tipo de un único campo.

## Reejecutar un flujo de trabajo

No hay un botón "reintentar esta ejecución" — por diseño, OneUptime nunca vuelve a ejecutar una ejecución antigua, porque los efectos colaterales salientes (mensajes de Slack, llamadas API) pueden no ser idempotentes. Si quieres rehacer el trabajo, arregla el flujo de trabajo y deja que el próximo disparador real lo dispare.

Para los flujos manuales, basta con hacer clic en **Run Manually** con el mismo payload.

## Retención de logs

Las ejecuciones se conservan indefinidamente en el proyecto. Si necesitas limpiar flujos de trabajo ruidosos de alto volumen (por ejemplo, un flujo de depuración que se dispara cada minuto), deshabilítalos o elimínalos — no hay un interruptor de retención por flujo.

## Qué leer a continuación

- [Configuración y seguridad](/docs/workflows/configuration) — timeouts, límites de recursión, redacción de secretos.
- [Variables](/docs/workflows/variables) — la sintaxis que usan los argumentos interpolados.
- [Componentes](/docs/workflows/components) — los campos de valor de retorno que publica cada componente.
