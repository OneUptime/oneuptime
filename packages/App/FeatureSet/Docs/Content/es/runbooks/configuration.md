# Configuración y seguridad de runbooks

Esta es la referencia para operadores y revisores de seguridad: dónde se ejecuta cada tipo de paso, los límites y tiempos de espera que se aplican a un paso, quién puede hacer qué y cómo se refuerzan los runbooks.

:::cards
- [Dónde se ejecuta cada tipo de paso](#dónde-se-ejecuta-cada-tipo-de-paso): El Worker, un Runner o una persona.
- [Límites de salida y tiempos de espera](#límites-de-salida-y-tiempos-de-espera): Cada límite que se aplica a un paso.
- [Permisos](#permisos): Permisos granulares, los tres roles de runbook y a qué runbooks llega un rol.
- [Notas de endurecimiento](#notas-de-endurecimiento): Sandbox, acceso a la red y autenticación de los Runners.
:::

## Dónde se ejecuta cada tipo de paso

```mermaid title="Qué pasos se ejecutan dónde"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["Pasos de<br/>solicitud HTTP<br/>Pasos de IA"]
    end
    subgraph yours["Tu infraestructura"]
        runner["Runner"]
        onrunner["Pasos JavaScript<br/>y Bash<br/>Pasos SSH y kubectl"]
    end
    person["Una persona"]
    worker --> onworker
    worker -->|"Pasos Manual<br/>y aprobaciones"| person
    worker --->|"pone en cola<br/>un trabajo<br/>para el Runner<br/>del paso"| runner
    runner --> onrunner
```

| Tipo de paso | Se ejecuta en | Cómo |
| --- | --- | --- |
| Manual | Una persona | La ejecución espera hasta que alguien completa u omite el paso. |
| JavaScript | Un Runner | En un sandbox `isolated-vm`. |
| HTTP request | El Worker de OneUptime | Una llamada HTTP saliente. |
| Bash | Un Runner | `bash -c <script>`. |
| SSH | Un Runner | Una conexión SSH que ejecuta el script con bash en la máquina, con inicio de sesión mediante una [variable](/docs/runbooks/variables) secreta. |
| kubectl | Un Runner | `bash -c <script>`, con `KUBECONFIG` apuntando al clúster. |
| AI | El Worker de OneUptime | Una llamada al proveedor de LLM del proyecto. |

## Cómo se envían los pasos de Runner

Los pasos JavaScript, Bash, SSH y kubectl **nunca se ejecutan en el Worker de OneUptime**. Se envían como trabajos a un [agente de runbook](/docs/runbooks/agents) concreto: un pequeño proceso que instalas en un host de tu propia infraestructura. Un paso que no elige ninguno va al [Runner predeterminado del proyecto](/docs/runbooks/agents#el-runner-predeterminado-del-proyecto), si tiene uno; si no, un paso JavaScript va a los [Runners globales](/docs/runbooks/agents#runners-globales) que OneUptime ejecuta para todos los proyectos.

El modelo de envío:

1. Quien escribe el paso del runbook elige un Runner en la lista desplegable al escribir el paso.
2. Cuando el paso se ejecuta, el Worker inserta una fila en `RunnerJob` con `targetAgentId` igual al ID de ese Runner, o al del Runner predeterminado del proyecto para un paso que no eligió ninguno, y estado `Pending`. Un paso JavaScript que no eligió ninguno, en un proyecto sin Runner predeterminado que usa Runners globales, recibe en cambio `runsOnGlobalRunner`.
3. Ese Runner concreto (y solo ese Runner) reclama el trabajo de forma atómica, lo ejecuta localmente — Bash y kubectl mediante `bash -c <script>`, JavaScript dentro de un sandbox `isolated-vm`, SSH mediante una conexión a la máquina, cada uno con las variables que nombra ya insertadas — y devuelve el resultado. Cualquier Runner global puede reclamar un trabajo con `runsOnGlobalRunner`.
4. El Worker reanuda el runbook con el resultado.

Ya no existe el indicador de entorno `RUNBOOK_BASH_ENABLED`. Que estos pasos funcionen en un despliegue depende únicamente de que el proyecto tenga un Runner conectado con **Ejecuta runbooks** activado. Un paso JavaScript también funciona en un Runner global.

## Límites de salida y tiempos de espera

| Límite | Valor | Se aplica a |
| --- | --- | --- |
| Salida por paso | **50 KB**. La salida más larga se corta con una marca. | Cada paso automatizado |
| Tiempo de espera de ejecución | **30 segundos** por defecto | Pasos JavaScript, Bash, SSH y kubectl |
| Tiempo de espera de la solicitud | **30 segundos** por defecto | Pasos de solicitud HTTP |
| Tiempo de espera de reclamación | **2 minutos** por defecto: cuánto espera el Worker a que el Runner elegido tome el trabajo antes de darlo por fallido | Pasos JavaScript, Bash, SSH y kubectl |
| Rango de los tiempos de espera | **1 segundo a 1 hora** | Cada tiempo de espera |
| Espera de una persona | Sin límite | Pasos Manual y aprobaciones |

Configura los tiempos de espera paso a paso, en **Más campos** del paso, en la página **Pasos** del runbook; deja un campo vacío para mantener el valor predeterminado. Un valor fuera del rango se ajusta al límite al ejecutarse el paso, de modo que una configuración mal escrita no puede ni desactivar el tiempo de espera ni ocupar indefinidamente un hueco del Worker.

## Permisos

Los permisos de runbook están en el grupo de permisos `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestionar las plantillas de runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — iniciar, marcar, eliminar y leer ejecuciones.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestionar las reglas de activación automática.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gestionar los Runners que ejecutan pasos en tu propia infraestructura. (Se llamaban `*RunbookAgent` antes del cambio de nombre a Runner; las asignaciones existentes se migraron, así que no hay que reasignar nada.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roles) — `RunbookAdmin` construye runbooks, sus reglas y los Runners en los que se ejecutan, y los ejecuta. `RunbookMember` abre runbooks y sus ejecuciones y los ejecuta — inicia una ejecución, completa u omite sus pasos y la cancela —, pero no crea, cambia ni elimina ningún runbook ni Runner. `RunbookViewer` lee runbooks y sus ejecuciones y no ejecuta nada. `RunbookAdmin` reúne todos los permisos granulares anteriores.

Un rol ejecuta los runbooks a los que llega su alcance. Una asignación de `RunbookMember`, `RunbookAdmin` o `ProjectMember` limitada a algunas etiquetas inicia y hace avanzar las ejecuciones de los runbooks que llevan esas etiquetas, una limitada a **Owned** las de los runbooks de los que su equipo es propietario, y el bloqueo de una etiqueta por un equipo le quita esos runbooks. `CreateRunbookExecution` y `EditRunbookExecution` tratan sobre ejecuciones, que no llevan etiquetas, así que llegan a todos los runbooks del proyecto. Aprobar una sugerencia de remediación que inicia un runbook se comprueba de la misma manera.

La programación y el webhook de un runbook inician ejecuciones sin nadie presente, así que configurar cualquiera de los dos requiere permiso para editar el runbook y para ejecutarlo, igual que ver su URL de webhook. Desactivarlos solo requiere permiso para editarlo. Consulta [Desencadenantes de runbook](/docs/runbooks/triggers#quién-puede-configurar-desencadenantes).

Las variables de runbook quedan fuera de `RunbookAdmin`, que solo las lee, para elegirlas en los pasos que escribe. Gestionar variables requiere `ProjectOwner` o `ProjectAdmin`, o los permisos `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` y `ReadRunbookSecret`: los permisos de los secretos de runbook, que conservaron sus nombres cuando los secretos pasaron a ser variables. Consulta [Variables de runbook](/docs/runbooks/variables).

Las reglas de propietario y de etiquetas de **Runbooks → Ajustes** también quedan fuera de `RunbookAdmin`. Gestionarlas requiere `ProjectOwner` o `ProjectAdmin`, o los permisos `CreateRunbookOwnerRule` y `CreateRunbookLabelRule` con sus equivalentes de edición, eliminación y lectura.

Para saber cómo se combinan los roles y los permisos granulares, consulta [Usuarios, equipos y permisos](/docs/permissions/index).

## Cola y worker

Las ejecuciones de runbook se ejecutan en la cola de BullMQ `Runbook`. Cada proceso Worker ejecuta hasta 25 ejecuciones a la vez; el número está fijado en el código, no lo define una variable de entorno.

Cuando se marca un paso manual a través de la API, la ejecución se vuelve a poner en cola para continuar desde el siguiente paso. Espera como `Scheduled` hasta que un Worker la retoma, y una ejecución en cola nunca falla por esperar.

## Notas de endurecimiento

- **JavaScript, Bash, SSH y kubectl** se ejecutan en un host de Runner que tú controlas, no en el Worker de OneUptime. JavaScript se ejecuta en un aislamiento `isolated-vm` separado con 128 MB de memoria y sin acceso al sistema de archivos ni a los procesos del Runner; puede hacer solicitudes HTTP con `axios`, pero se rechazan las solicitudes a redes privadas y a direcciones de loopback y de enlace local. Bash se ejecuta mediante `bash -c`, con su tiempo de espera aplicado en el Runner. Un paso JavaScript que no elige ninguno se ejecuta en el Runner predeterminado del proyecto o, si no hay ninguno, en un Runner global.
- **Los pasos SSH** solo inician sesión cuando la máquina presenta una de las claves de host que el paso indica. Un paso que no indica ninguna acepta cualquier clave, y su salida nombra la que presentó la máquina, para indicarla en el paso.
- **Los pasos HTTP** usan una validación de estado permisiva, de modo que una respuesta 4xx o 5xx se registra como paso fallido en lugar de lanzar una excepción, y la salida capturada refleja lo que el servicio remoto devolvió de verdad. Las redirecciones no se siguen. El Worker nunca llama a direcciones de loopback ni de enlace local, como un endpoint de metadatos de la nube; en OneUptime Cloud también rechaza las direcciones de red privada, y un OneUptime autoalojado las rechaza con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **Los pasos de IA** nunca ven las notas privadas de los incidentes ni los mensajes de Slack y Microsoft Teams, y la salida de los pasos anteriores se analiza en busca de secretos, que se ocultan antes de llegar al modelo. Las imágenes incrustadas y los datos codificados largos se dejan fuera de la indicación. Consulta [AI](/docs/runbooks/authoring#ai).
- **Runners globales**: solo ejecutan pasos JavaScript, cada uno en un sandbox creado para ese paso y descartado después, que solo alcanza direcciones públicas de internet, durante 5 minutos como mucho, y como mucho tres pasos de un mismo proyecto a la vez. Solo reciben las variables secretas del propio proyecto del paso que están activadas para los Runners globales; el incluido tiene su propia clave y nada más del servidor. Consulta [Runners globales](/docs/runbooks/agents#runners-globales).
- **La autenticación de los Runners** se hace con un ID y una clave secreta, definidos en el contenedor del Runner como variables de entorno. En el servidor, la identidad válida del Runner sale de la fila de la base de datos que corresponde al ID y la clave presentados: un cliente no puede hacerse pasar por otro Runner ni siquiera con una clave comprometida.
- **Las variables secretas** se cifran en reposo, la API nunca las devuelve y solo se entregan a los Runners que incluyen, cuando estos reclaman un paso que las nombra. Una variable secreta también se entrega a un Runner global que reclama un paso del propio proyecto de la variable, cuando la variable permite usarla a los Runners globales. El Runner reemplaza cada secreto que recibió un paso por `[REDACTED]` en lo que imprime el paso, y OneUptime lo vuelve a hacer antes de guardar la salida. Un paso de solicitud HTTP, que OneUptime envía él mismo, recibe cada secreto de su propio proyecto que nombra, y los oculta en la respuesta que registra.

## Tablas de la base de datos

| Tabla | Qué contiene |
| --- | --- |
| `Runbook` | La plantilla: nombre, slug, descripción, `isEnabled`, etiquetas y los pasos en JSON. |
| `RunbookExecution` | Una fila por ejecución, con las claves foráneas opcionales `incidentId`, `alertId` y `scheduledMaintenanceId` y un array JSON `stepExecutions` que guarda una instantánea de los pasos y del estado de cada uno. |
| `RunbookRule` | Las reglas de activación automática, con un discriminador `triggerEntityType` (Incident, Alert, ScheduledMaintenance), una relación de muchos a muchos con los runbooks que iniciar y aquello con lo que comparan: una columna JSON `criteria` (las condiciones) más vínculos de muchos a muchos con monitores, gravedades de incidente, gravedades de alerta, etiquetas y etiquetas de monitor, y patrones de título, descripción, nombre de monitor y descripción de monitor. |
| `Runner` | Una fila por Runner instalado: nombre, clave secreta, `lastAlive`, `connectionStatus`, información del host y capacidades. Un Runner global tiene `isGlobalRunner` activado y ningún proyecto; el Runner predeterminado del proyecto tiene `isProjectDefault` activado. |
| `RunnerJob` | Una fila por paso enviado a un Runner: `targetAgentId` (el Runner que eligió quien escribió el paso), tipo de paso, script o carga útil, estado (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` o `Cancelled`), plazo de reclamación, concesión, salida y código de salida. `runsOnGlobalRunner` marca un paso que cualquier Runner global puede reclamar. |
| `RunbookVariable` | Las variables de runbook: las globales del proyecto y las propias de un runbook, que lo nombran en `runbookId`; el valor de un secreto cifrado, y los Runners que pueden recibir un secreto. |

## Consejos de operación

- **Asegúrate de que el Runner que eliges en un paso está sano.** Si necesitas redundancia, ejecuta un segundo Runner y reparte los pasos entre ambos, o mantén un runbook de respaldo que apunte al otro Runner.
- **Captura URL, no blobs.** Si un paso genera más de unos pocos KB de salida, escríbela en un almacenamiento de objetos o en tu sistema de logs y devuelve la URL.
- **La idempotencia importa.** Un paso de solicitud HTTP o de IA se vuelve a ejecutar si el Worker se reinicia a mitad del paso y la ejecución se reanuda. Un paso en un Runner se envía como mucho una vez por ejecución, pero un script puede haberse ejecutado en parte antes de un fallo, y puede que vuelvas a ejecutar el runbook. Diseña los pasos para que se puedan repetir sin riesgo.

## Siguientes pasos

:::cards
- [Agentes de runbook](/docs/runbooks/agents): Instalar, operar y solucionar problemas de los Runners.
- [Variables de runbook](/docs/runbooks/variables): Los valores y secretos que usan los pasos, y los Runners que los reciben.
- [Usuarios, equipos y permisos](/docs/permissions/index): Cómo deciden los roles, las etiquetas y los equipos quién ejecuta qué.
:::
