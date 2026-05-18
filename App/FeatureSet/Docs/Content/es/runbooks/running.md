# Ejecutar un runbook

Hay tres maneras de que se cree una ejecución de runbook:

1. **Automáticamente vía regla** — ver [Reglas de runbook](/docs/runbooks/rules).
2. **Manualmente desde la página del runbook** — pulsa **Ejecutar ahora** en la vista general del runbook. No se vincula a ningún incidente, alerta o mantenimiento.
3. **Manualmente desde el feed de una entidad** — pulsa **Ejecutar runbook** en un incidente, alerta o evento de mantenimiento programado. La ejecución queda vinculada a esa entidad.

## La vista de ejecución

Abre cualquier ejecución para ver su UI de checklist. Cada paso muestra:

- **Pastilla de estado** — Pendiente, En ejecución, Esperándote, Hecho, Saltado, Fallido.
- **Título y descripción** — copiados del runbook en el momento de la ejecución.
- **Salida** (replegable) — stdout, valores de retorno, respuestas HTTP.
- **Mensaje de error** si el paso falló.
- En pasos manuales en `WaitingForUser`: botones **Marcar como completado** y **Saltar**.

La página sondea cada 3 segundos mientras la ejecución no es terminal, así que verás los pasos automatizados completarse casi en tiempo real.

## Intercalar pasos manuales y automatizados

El flujo clásico:

1. **Paso de script**: capturar estado del sistema, escribir a S3.
2. **Paso manual**: "Notificar a clientes mediante el banner de la página de estado." La persona de guardia lo marca.
3. **Paso HTTP**: avisar al DBA por PagerDuty.
4. **Paso manual**: "Confirmar que la DB secundaria es ahora primary." La persona de guardia lo marca.
5. **Paso de script**: enviar el mensaje de "todo OK" a Slack.

Los pasos 2 y 4 pausan la ejecución hasta que se marcan. Los pasos 1, 3, 5 corren automáticamente. Toda la ejecución es una sola ejecución, una sola línea de tiempo, una sola fuente de verdad.

## Cancelar una ejecución

Pulsa **Cancelar ejecución** en la página. El paso actual (si lo hay) termina; los siguientes no arrancan. El estado pasa a `Cancelled`.

## Retención de salida

La salida por paso está limitada a **50KB** para evitar que scripts descontrolados hinchen la base de datos. Si necesitas artefactos mayores, escríbelos a S3 o a un logger desde el script y guarda la URL en el valor de retorno.

## Re-ejecutar un runbook

Una ejecución es un registro único e inmutable. Para repetir, pulsa de nuevo **Ejecutar ahora** — eso crea una ejecución nueva con un snapshot fresco de los pasos actuales del runbook. La ejecución original queda intacta para el rastro de auditoría.

## Encontrar ejecuciones pasadas

Cada runbook tiene una pestaña **Ejecuciones** que lista todas sus corridas, con filtros por estado, rango de fechas y entidad origen. Desde un incidente, alerta o evento de mantenimiento programado, la pestaña **Runbooks** muestra las ejecuciones vinculadas a esa entidad.
