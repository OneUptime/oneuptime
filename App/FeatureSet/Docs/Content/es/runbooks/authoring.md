# Crear un runbook

Crea un runbook desde **Runbooks → Crear runbook**, luego ábrelo y entra en la pestaña **Pasos**.

## Anatomía de un paso

Cada paso tiene:

| Campo | Propósito |
| --- | --- |
| **Título** | Etiqueta corta mostrada en la interfaz de checklist. Obligatorio. |
| **Descripción** | Contexto opcional para quien responde. Texto Markdown. |
| **Continuar al fallar** | Si está activo, un paso fallido no detiene la ejecución — el siguiente sigue corriendo. |
| **Configuración específica del tipo** | Script, URL, etc. — ver abajo. |

Los pasos se ejecutan **en orden**. Reordénalos con las flechas arriba/abajo en el editor de pasos.

## Tipos de paso

### Manual

Una casilla que marca quien responde. La ejecución se pausa al llegar a un paso manual y permanece en `WaitingForManualStep` hasta que alguien lo marca como completado (o lo salta).

Úsalo para lo que solo un humano puede verificar: "El tráfico se trasladó a la región secundaria según el panel del balanceador — confirmado."

### JavaScript

Un fragmento de JavaScript que se ejecuta en un sandbox `isolated-vm` (sin sistema de archivos, sin red salvo que aportes una API).

```js
const start = Date.now();
// ... tu lógica ...
return { durationMs: Date.now() - start };
```

El valor retornado queda registrado en la ejecución del paso. La salida de `console.log` se captura como líneas de log. Timeout por defecto: 30 segundos.

### Petición HTTP

Una llamada HTTP saliente. Configura método (GET/POST/PUT/PATCH/DELETE/HEAD), URL, cabeceras JSON opcionales y cuerpo opcional. Se registran estado, cabeceras y cuerpo de la respuesta (limitado a 50 KB en total).

Útil para: abrir un incidente en PagerDuty, publicar en Slack, llamar a tu propia API de administración, etc.

### Bash

Un script bash que corre en un [Agente de Runbook](/docs/runbooks/agents) — un pequeño proceso que instalas en un host dentro de tu propia infraestructura. Los pasos Bash nunca se ejecutan en el Worker de OneUptime.

Configura dos cosas en un paso Bash:

- **Agent Tag** — el tag que identifica qué agente(s) deben ejecutar este paso. Cualquier agente sano del proyecto con ese tag reclamará y ejecutará el job.
- **Script** — el bash a ejecutar. La salida (stdout + stderr) se captura hasta 50 KB; el proceso se mata al alcanzarse el timeout.

Si ningún agente con el tag elegido está en línea cuando el runbook llega a este paso, el paso espera hasta el **claim timeout** (por defecto 2 minutos) y luego falla. Añade un agente en **Runbooks → Agents** antes de depender de un paso Bash.

## Guardar y editar

Pulsa **Guardar pasos** para persistir. Las ejecuciones en curso de versiones anteriores del runbook no se ven afectadas — continúan con su snapshot.

## Múltiples pasos y manejo de fallos

Por defecto, un paso fallido detiene la ejecución y la marca como `Failed`. Si activas **Continuar al fallar** en un paso, se registra el fallo pero se ejecuta el siguiente. Útil para patrones tipo "prueba estas tres cosas, después notifica".

## Ejemplo completo

Un runbook sencillo para "DB primaria inalcanzable":

1. **JavaScript** — obtener el host primario actual del servicio de configuración y registrarlo.
2. **Manual** — "El retraso de replicación del secundario es inferior a 5 segundos — confirmado."
3. **Petición HTTP** — POST a la API de tu orquestador de failover.
4. **Manual** — "Las escrituras van al nuevo primario — confirmado."
5. **Petición HTTP** — POST a Slack con un mensaje de "todo OK".

Quien responde ve correr un paso automatizado, marca uno manual, mira el siguiente automatizado, y así sucesivamente. La salida de cada paso se conserva para el post-mortem.
