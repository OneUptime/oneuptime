# Configuración y seguridad de runbooks

## Cómo se ejecutan realmente Bash y JavaScript

Los pasos Bash y JavaScript **nunca se ejecutan en el Worker de OneUptime**. Se despachan como jobs a un [Agente de Runbook](/docs/runbooks/agents) concreto — un pequeño proceso que instalas en un host dentro de tu propia infraestructura.

El modelo de dispatch:

1. El autor del paso elige un Agente de Runbook desde el desplegable al redactar el paso.
2. Al ejecutarse el paso, el Worker inserta una fila en `RunbookAgentJob` con `targetAgentId` apuntando al ID de ese agente y estado `Pending`.
3. Ese agente concreto (y solo ese agente) reclama atómicamente el job, ejecuta el script localmente — Bash vía `bash -c <script>`, JavaScript dentro de un sandbox `isolated-vm` — y publica el resultado de vuelta.
4. El Worker reanuda el runbook con el resultado.

Ya no existe la variable de entorno `RUNBOOK_BASH_ENABLED`. Que los pasos Bash o JavaScript funcionen en un despliegue depende enteramente de que haya al menos un Agente de Runbook conectado en el proyecto.

## Límites de salida y timeouts

- Salida por paso: **50&nbsp;KB**. La salida más grande se trunca con un marcador.
- Timeout de ejecución por paso por defecto: **30 segundos** para JavaScript, Bash y HTTP. Configurable por paso.
- **Claim timeout** por paso para Bash y JavaScript: **2 minutos** — cuánto espera el Worker a que el agente seleccionado recoja el job antes de fallarlo.

## Permisos

Los permisos de runbook viven en el grupo de permisos `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestionar plantillas de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar y leer ejecuciones.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestionar reglas de auto-disparo.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestionar Agentes de Runbook que ejecutan pasos Bash y JavaScript en tu propia infraestructura.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roles) — asignables a un equipo para conceder control total, uso diario o acceso de solo lectura, respectivamente. `RunbookAdmin` agrupa todos los permisos granulares anteriores.

## Cola y worker

Las ejecuciones de runbook corren en la cola BullMQ `Runbook`. La concurrencia del worker es 25 — ajústala en tu despliegue si tienes muchas ejecuciones simultáneas.

Cuando un paso manual se marca vía API, la ejecución se vuelve a encolar para continuar desde el siguiente paso. Esto mantiene el worker caliente para el resto del runbook.

## Notas de endurecimiento

- **JavaScript y Bash** corren en un host de Agente de Runbook que controlas tú, no en el Worker de OneUptime. JavaScript va envuelto en un sandbox `isolated-vm` con el preludio habitual (rompe las cadenas de prototipos, elimina `Function`/`eval`, congela los prototipos integrados). Bash se ejecuta vía `bash -c` con aplicación de timeout en el agente.
- **Los pasos HTTP** usan un validador de estado permisivo, así que una respuesta 4xx o 5xx se registra como paso fallido en vez de lanzarse como excepción. Esto hace que la salida capturada refleje lo que realmente devolvió el upstream.
- **La autenticación del agente** es por ID + clave secreta, configuradas en el contenedor del agente como variables de entorno. En el servidor, la identidad autoritativa del agente viene de la fila de DB indexada por el ID/clave presentados — los clientes no pueden hacerse pasar por otro agente ni siquiera con una clave comprometida.

## Tablas de base de datos

- `Runbook` — plantilla (nombre, slug, descripción, isEnabled, JSON de pasos).
- `RunbookExecution` — una fila por ejecución, con foreign keys anulables `incidentId`, `alertId` y `scheduledMaintenanceId` y un array JSON `stepExecutions` que captura los pasos y el estado por paso.
- `RunbookRule` — reglas de auto-disparo con un discriminador `triggerEntityType` (Incident, Alert, ScheduledMaintenance) y una relación muchos-a-muchos con los runbooks a iniciar.
- `RunbookAgent` — una fila por agente instalado: nombre, clave secreta, `lastAlive`, `connectionStatus`, info del host.
- `RunbookAgentJob` — una fila por paso Bash o JavaScript despachado: `targetAgentId` (el agente que eligió el autor del paso), tipo de paso, script, estado (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), deadline del claim, lease, salida, código de salida.

## Consejos operativos

- **Asegúrate de que el agente elegido en cada paso esté sano.** Si necesitas redundancia, lanza un segundo agente y reparte tus pasos entre ellos, o mantén un runbook de respaldo que apunte al otro agente.
- **Captura URLs, no blobs.** Si un paso genera más de unos pocos KB de salida, escríbelos a S3 o a tu stack de logging y devuelve la URL.
- **La idempotencia importa.** Los pasos automatizados (HTTP, JavaScript, Bash) pueden ejecutarse más de una vez si el worker se reinicia a mitad de paso o si el lease del agente caduca mientras el script aún corre; diséñalos para que sea seguro reintentarlos.
