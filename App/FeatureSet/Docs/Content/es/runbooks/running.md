# Ejecutar un runbook

Hay tres maneras de crear una ejecución de runbook:

1. **Automáticamente vía regla** — ver [Reglas de runbook](/docs/runbooks/rules).
2. **Manualmente desde la página del runbook** — pulsa **Ejecutar ahora** en la vista general del runbook. No se vincula a ningún incidente, alerta o mantenimiento.
3. **Manualmente desde el feed de una entidad** — pulsa **Ejecutar runbook** en un incidente, alerta o evento de mantenimiento programado. La ejecución queda vinculada a esa entidad.

## La vista de ejecución

Abre cualquier ejecución para ver su interfaz de checklist. Cada paso muestra:

- **Estado** — Pendiente, En ejecución, Esperándote, Hecho, Saltado, Fallido.
- **Título y descripción** — copiados del runbook en el momento de la ejecución.
- **Salida** (plegable) — stdout, valores de retorno, respuestas HTTP.
- **Mensaje de error** si el paso falló.
- En pasos manuales en `WaitingForUser`: botones **Marcar como completado** y **Saltar**.

Mientras la ejecución no esté en estado terminal, la página se refresca cada 3 segundos, así que verás los pasos automatizados completarse casi en tiempo real.

## Intercalar pasos manuales y automatizados

El flujo clásico:

1. **Paso de script**: capturar el estado del sistema, escribir en S3.
2. **Paso manual**: "Notificar a los clientes vía el banner de la página de estado." Quien responde lo marca.
3. **Paso HTTP**: avisar al DBA por PagerDuty.
4. **Paso manual**: "Confirmar que la BD secundaria pasó a primaria." Quien responde lo marca.
5. **Paso de script**: enviar el mensaje "todo OK" a Slack.

Los pasos 2 y 4 pausan la ejecución hasta la confirmación. Los pasos 1, 3, 5 corren automáticamente. Todo el recorrido es una sola ejecución, una sola línea de tiempo, una sola fuente de verdad.

## Cancelar una ejecución

Pulsa **Cancelar ejecución** en la página. El paso actual (si lo hay) termina; los siguientes no arrancan. El estado pasa a `Cancelled`.

## Retención de salidas

La salida por paso está limitada a **50 KB** para evitar que scripts descontrolados inflen la base de datos. Si necesitas artefactos más grandes, escríbelos desde el script a S3 o a un logger y guarda la URL en el valor de retorno.

## Re-ejecutar un runbook

Una ejecución es un registro único e inmutable. Para repetir, pulsa de nuevo **Ejecutar ahora** — eso crea una ejecución nueva con un snapshot fresco de los pasos actuales del runbook. La ejecución original queda intacta para el rastro de auditoría.

## Encontrar ejecuciones pasadas

Cada runbook tiene una pestaña **Ejecuciones** que lista todas sus corridas, con filtros por estado, rango de fechas y entidad origen. En un incidente, alerta o mantenimiento, la pestaña **Runbooks** muestra las ejecuciones vinculadas a esa entidad.
