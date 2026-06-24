# Crear un runbook

Crea un runbook en **Runbooks → Crear Runbook**, ábrelo y ve a la pestaña **Pasos**.

## Anatomía de un paso

Cada paso tiene:

| Campo                          | Propósito                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Título**                     | Etiqueta corta mostrada en la UI de checklist. Obligatoria.                                                       |
| **Descripción**                | Contexto opcional para quien responde. Texto seguro para Markdown.                                                |
| **Continuar al fallar**        | Si está activo, un paso fallido no detiene la ejecución — el siguiente sigue corriendo.                           |
| **Requiere aprobación**        | Si está activo, el runbook pausa tras este paso y espera a que un usuario apruebe antes de ejecutar el siguiente. |
| **Config específica del tipo** | Script, URL, agente, etc. — ver más abajo.                                                                        |

Los pasos corren **en orden**. Reordénalos con las flechas arriba/abajo del editor de Pasos.

## Tipos de paso

### Manual

Una casilla que la persona de guardia marca. La ejecución pausa al llegar a un paso Manual y se queda en `WaitingForManualStep` hasta que alguien lo marca como completado (o lo salta).

Úsalo para lo que solo un humano puede verificar: "Confirmado que el tráfico se ha movido a la región secundaria en el panel del balanceador."

### JavaScript

Un fragmento de JavaScript ejecutado en un sandbox `isolated-vm`. El sandbox vive en un [Agente de Runbook](/docs/runbooks/agents) dentro de tu propia infraestructura — no en el Worker de OneUptime.

Configura dos cosas en un paso JavaScript:

- **Agente de Runbook** — elige en el desplegable el agente que debe ejecutar este paso. Solo el agente seleccionado puede reclamar el job.
- **Script** — el JavaScript a ejecutar.

```js
const start = Date.now();
// ... tu lógica ...
return { durationMs: Date.now() - start };
```

El valor devuelto se captura en la ejecución del paso. La salida de `console.log` se captura como líneas de log. Timeout de ejecución por defecto: 30 segundos. Claim timeout por defecto (cuánto espera el Worker a que el agente recoja el job): 2 minutos.

### Petición HTTP

Hace una llamada HTTP saliente. Configura método (GET/POST/PUT/PATCH/DELETE/HEAD), URL, cabeceras JSON opcionales y cuerpo opcional. Se capturan estado, cabeceras y cuerpo de la respuesta (con un tope de 50KB en total).

Útil para: abrir un incidente en PagerDuty, publicar en Slack, llamar a tu propia API admin, etc. Los pasos HTTP corren directamente en el Worker de OneUptime; no se necesita agente.

### Bash

Un script bash (`bash -c <script>`) ejecutado en un [Agente de Runbook](/docs/runbooks/agents) dentro de tu propia infraestructura. Bash nunca se ejecuta en el Worker de OneUptime.

Configura dos cosas en un paso Bash:

- **Agente de Runbook** — elige en el desplegable el agente que debe ejecutar este paso. Solo el agente seleccionado puede reclamar el job.
- **Script** — el bash a ejecutar. La salida (stdout + stderr) se captura hasta 50&nbsp;KB; el proceso se mata al expirar el timeout.

Si el agente seleccionado está offline cuando el runbook llega a este paso, el paso espera hasta el **claim timeout** (por defecto 2 minutos) y luego falla con `TimedOut`. Añade un agente en **Runbooks → Configuración → Agentes** antes de depender de un paso Bash.

## Guardar y editar

Pulsa **Guardar pasos** para persistir. Las ejecuciones en curso de versiones anteriores del runbook no se ven afectadas — siguen usando su snapshot.

## Múltiples pasos y manejo de fallos

Por defecto, un paso fallido detiene la ejecución y la marca como `Failed`. Si activas **Continuar al fallar** en un paso, se registra el fallo pero se ejecuta el siguiente. Útil para patrones tipo "prueba estas tres cosas, después notifica".

## Un ejemplo trabajado

Un runbook sencillo para "DB primary inalcanzable":

1. **JavaScript** — obtén el host primary actual desde tu servicio de configuración y regístralo.
2. **Manual** — "Confirmar que el lag de replicación de la secundaria está por debajo de 5 segundos."
3. **Petición HTTP** — POST a la API de tu orquestador de failover.
4. **Manual** — "Verificar que las escrituras van ya al nuevo primary."
5. **Petición HTTP** — POST a Slack con un mensaje de "todo OK".

La persona de guardia ve correr un paso automatizado, marca uno manual, ve correr el siguiente automatizado, y así sucesivamente. La salida de cada paso queda capturada para el post-mortem.
