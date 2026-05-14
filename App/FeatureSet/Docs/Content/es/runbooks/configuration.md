# Configuración y seguridad de runbooks

## Límites de salida

- Salida por paso: **50 KB**. Las salidas mayores se truncan con un marcador.
- Timeout por paso por defecto: **30 segundos** para JavaScript, Bash y HTTP. Configurable por paso.
- **Claim timeout** por defecto para pasos Bash: **2 minutos** — cuánto espera el Worker a que un Agente de Runbook recoja el job antes de fallarlo.

## Permisos

Los permisos de runbook viven en el grupo de permisos `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestionar plantillas de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar y leer ejecuciones.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestionar reglas de auto-disparo.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestionar Agentes de Runbook que ejecutan pasos Bash en tu propia infraestructura.
- `RunbookManager` (rol) — agrupa todo lo anterior; asígnalo a un equipo para darle capacidad completa sobre runbooks.

## Cola y worker

Las ejecuciones de runbook corren en la cola BullMQ `Runbook`. La concurrencia del worker es 25 — ajústala en tu despliegue si tienes muchas corridas simultáneas.

Cuando un paso manual se marca vía API, la ejecución se re-encola para continuar en el siguiente paso. Así el worker se mantiene caliente para el resto del runbook.

## Notas de endurecimiento

- Los **pasos JavaScript** corren en `isolated-vm` con un preámbulo de endurecimiento (corta cadenas de prototipos, elimina `Function` y `eval`, congela los prototipos nativos).
- Los **pasos Bash** nunca corren en el Worker de OneUptime. Se despachan como jobs a un [Agente de Runbook](/docs/runbooks/agents) que tú has instalado en tu propia infraestructura. El Worker encola el job marcado con el **Agent Tag** del paso, un agente lo reclama atómicamente, ejecuta `bash -c <script>` localmente y devuelve el resultado. El proceso Worker en sí no tiene acceso shell a tu entorno.
- Los **pasos HTTP** usan un validador de estado permisivo, de modo que una respuesta 4xx o 5xx se registra como paso fallido en lugar de lanzarse. La salida capturada refleja lo que realmente devolvió la otra parte.

## Tablas de base de datos

- `Runbook` — plantilla (nombre, slug, descripción, isEnabled, JSON de pasos).
- `RunbookExecution` — una fila por ejecución, con claves foráneas anulables `incidentId`, `alertId` y `scheduledMaintenanceId` y un array JSON `stepExecutions` que toma snapshot de los pasos y el estado por paso.
- `RunbookRule` — reglas de auto-disparo con discriminador `triggerEntityType` (Incident, Alert, ScheduledMaintenance) y una relación muchos-a-muchos con los runbooks a iniciar.
- `RunbookAgent` — una fila por agente instalado: nombre, tags, clave secreta, `lastAlive`, `connectionStatus`, info del host.
- `RunbookAgentJob` — una fila por paso Bash despachado: tag requerido, script, estado (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, output, exit code.

## Consejos operativos

- **Ejecuta al menos un agente por tag al que apuntes**, e idealmente dos para alta disponibilidad. Con dos agentes con el mismo tag, cualquiera puede reclamar un job — puedes hacer reinicios rotativos sin romper runbooks.
- **Captura URLs, no blobs.** Si un paso genera más de unos pocos KB, escríbelos a S3 o a tu stack de logs y devuelve la URL.
- **La idempotencia importa.** Los pasos automatizados (HTTP, JavaScript, Bash) pueden correr más de una vez si el worker reinicia a mitad de paso o si el lease de un agente expira mientras un script aún corre; diséñalos para que el reintento sea seguro.
