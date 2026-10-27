# Agentes de runbook

Un **agente de runbook**, llamado **Runner** en el panel, es un pequeño proceso autoalojado que ejecuta los pasos JavaScript, Bash, SSH y kubectl de tus runbooks **dentro de tu propia infraestructura**. El Worker de OneUptime nunca ejecuta tus scripts: los pone en cola, y el Runner que eligió quien escribió el paso reclama cada uno, lo ejecuta y devuelve el resultado. Esta página es para quien instala y opera Runners. Un paso que no elige ningún Runner se ejecuta en el [Runner predeterminado del proyecto](#el-runner-predeterminado-del-proyecto), si has definido uno; si no, un paso JavaScript se ejecuta en un [Runner global](#runners-globales), uno de los que OneUptime ejecuta para todos los proyectos.

:::cards
- [Instalar un Runner](#instalar-un-runner): Del panel a un contenedor conectado, en cinco pasos.
- [Apuntar un paso a un Runner](#apuntar-un-paso-a-un-runner): Vincular un paso al Runner que debe ejecutarlo.
- [El Runner predeterminado del proyecto](#el-runner-predeterminado-del-proyecto): El Runner en el que se ejecuta un paso o un repositorio de código que no elige ninguno.
- [Runners globales](#runners-globales): Los Runners que OneUptime ejecuta para todos los proyectos, y lo que ejecutan.
- [Tiempos de espera](#tiempos-de-espera): Tiempos de espera de reclamación y de ejecución, y cómo interactúan.
- [Variables de entorno](#variables-de-entorno): Lo que lee el contenedor al arrancar.
:::

## Cómo funciona

```mermaid title="Lo que cruza la red entre un Runner y OneUptime"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["El Worker pone el paso en cola"]
        ingest["API de Runners"]
    end
    subgraph yours["Tu infraestructura"]
        direction LR
        runner["Contenedor del Runner"]
        targets["Hosts, clústeres, servicios internos"]
    end
    worker --> ingest
    runner -->|"HTTPS saliente, ID y clave del Runner"| ingest
    ingest -->|"Trabajo reclamado, con sus secretos"| runner
    runner -->|"Script, SSH o API de Kubernetes"| targets
```

1. Creas un Runner en OneUptime. OneUptime genera un ID y una clave secreta para él.
2. Ejecutas el contenedor del Runner en un host de tu infraestructura, con ese ID, esa clave y la URL de tu OneUptime.
3. El Runner pide trabajo a OneUptime cada 5 segundos e informa de que está vivo cada 60 segundos.
4. Cuando escribes un paso JavaScript, Bash, SSH o kubectl, eliges el Runner en una lista desplegable, en **Más campos** del paso. El paso queda vinculado a ese Runner. Un paso que no elige ninguno se ejecuta en el Runner predeterminado del proyecto, si has definido uno, y si no, un paso JavaScript se ejecuta en **Runner global**.
5. Cuando el paso se ejecuta, el Worker pone en cola un trabajo con `targetAgentId` apuntando a ese Runner. Solo ese Runner puede reclamarlo.
6. El Runner ejecuta el trabajo localmente (`bash -c <script>` para Bash y kubectl, un sandbox `isolated-vm` para JavaScript, una conexión SSH que ejecuta el script con bash en la máquina), captura el resultado, oculta en él los secretos del paso y lo devuelve. El Worker reanuda el runbook con el resultado.

El Runner solo necesita **HTTPS saliente** hacia tu instancia de OneUptime. No acepta conexiones entrantes.

Un Runner solo guarda su ID y su clave. Todo lo demás lo recibe con el trabajo que reclama: un script con las [variables de runbook](/docs/runbooks/variables) que nombra ya insertadas, y la clave o contraseña de un paso SSH o el kubeconfig de un paso kubectl. Solo recibe un secreto si ese secreto se lo permite. Por eso cualquiera que tenga la clave de un Runner puede actuar como ese Runner: trata la clave como los secretos que puede usar.

## Por qué los scripts se ejecutan en un Runner

Ejecutar scripts en el Worker de OneUptime tenía dos problemas:

- **Límite de confianza.** Cualquiera que pudiera escribir un runbook podía ejecutar código en el Worker, con acceso a todo lo que el Worker alcanzaba.
- **Alcance.** La mayoría de los pasos útiles actúan sobre _tu_ infraestructura («reinicia este servicio», «busca un registro en nuestra base de datos interna»), no sobre la de OneUptime.

Con los Runners, esos pasos se ejecutan en un host que tú controlas, y tú decides lo que ese host puede hacer. Los pasos de solicitud HTTP y de IA siguen ejecutándose en el Worker, porque no necesitan nada de tu red.

## Runners globales

Los Runners globales son los Runners que OneUptime ejecuta para todos los proyectos. Un paso JavaScript que no elige un Runner propio se ejecuta en uno de ellos, salvo que el proyecto tenga un [Runner predeterminado](#el-runner-predeterminado-del-proyecto), así que puedes escribirlo antes de instalar nada. **Runbooks → Agentes de runbook** los muestra en **Runners globales**, encima de tus propios Runners, y la lista desplegable **Runner** de un paso JavaScript ofrece **Runner global** primero, o justo después del Runner predeterminado del proyecto. La lista desplegable de un paso Bash, SSH o kubectl lo muestra al final, en gris, con **Solo ejecuta pasos de JavaScript.** Esos pasos se ejecutan en un Runner tuyo, dentro de tu red, nunca en uno que comparten todos los proyectos.

| | Runner global | Tu propio Runner |
| --- | --- | --- |
| Pasos que ejecuta | JavaScript | JavaScript, Bash, SSH y kubectl |
| Lo que un paso puede alcanzar | Direcciones públicas de internet | Lo que alcanza su host |
| Lo más que dura un paso | 5 minutos | 1 hora |
| Variables secretas | Las que dejas usar a los Runners globales | Las que lo incluyen |
| Comandos Bash de OneUptime AI | Nunca | Para las reglas de IA que lo eligen |
| Correcciones de código de OneUptime AI | Se abren para revisión sin compilarlas ni probarlas | Se compilan y prueban antes de que se abra el pull request |

Un Runner global ejecuta los pasos de muchos proyectos, así que cada paso se mantiene aparte de todos los demás:

- Cada paso se ejecuta en un sandbox `isolated-vm` propio, creado para ese paso y descartado después: sin archivos, sin procesos, sin variables de entorno y sin nada que se conserve de un paso al siguiente.
- Sus peticiones HTTP solo alcanzan direcciones públicas de internet, nunca una dirección privada, de loopback o de enlace local ni un endpoint de metadatos de la nube, así que un Runner global nunca alcanza tu red.
- Recibe una variable secreta solo cuando su interruptor **Los Runners globales pueden usarlo** está activado, y solo para un paso del propio proyecto de la variable.
- Un proyecto ejecuta como mucho tres pasos a la vez en los Runners globales, así que ningún proyecto los acapara.

Un Runner global también se encarga de las correcciones de código de OneUptime AI, en cada repositorio de código que trabaja en **Runner global**. Escribe cada corrección y abre el pull request, pero no ejecuta ningún comando, ni siquiera los comandos de preparación, compilación y prueba del repositorio, así que el pull request indica que su verificación se omitió. Solo alcanza servidores Git en internet, por HTTPS, salvo en un OneUptime autoalojado, donde también puede alcanzar los servidores Git privados que el propio servidor puede alcanzar. Solo actúa por las correcciones que toma, y recibe el token de un repositorio solo mientras trabaja en una corrección allí. El token de un repositorio de GitHub alcanza solo ese repositorio y se revoca cuando termina la corrección.

Elige uno de tus propios Runners para un paso que deba alcanzar tu red, o para mantener el paso en hosts que controlas. Para mantener todos los pasos en tus propios Runners, desactiva **Usar Runners globales** al final de **Runbooks → Agentes de runbook**. Un paso JavaScript que no elige ningún Runner se ejecuta entonces en el Runner predeterminado del proyecto o, si no hay ninguno, falla, indicándolo, hasta que elija uno de los tuyos; un paso que elige uno de tus Runners lo conserva en cualquier caso. Un repositorio de código que no elige ningún Runner en sus ajustes en Código también trabaja en el Runner predeterminado del proyecto o, si no hay ninguno, en un Runner global, y necesita uno de los tuyos mientras el interruptor está desactivado; consulta [Código](/docs/ai/ai-agent#elige-el-runner-del-repositorio).

### De dónde vienen los Runners globales

En OneUptime Cloud, los ejecuta OneUptime. Una instalación autoalojada ejecuta uno propio de forma predeterminada, igual que ejecuta sus propias sondas globales: el servicio `global-runner` en Docker Compose y el despliegue `globalRunner` en el chart de Helm. Tiene su propia clave, `GLOBAL_RUNNER_KEY`, y nada más del servidor.

Un administrador principal puede añadir más, para ejecutar pasos y correcciones de código desde otros hosts: en el Panel de administración, abre **Ajustes** y luego **Runners globales**, crea uno y ejecuta el comando que da su **Mostrar ID y clave** en un host que alcance internet.

Para desactivar el incluido, define `GLOBAL_RUNNER_REPLICAS=0` en el `config.env` de Docker Compose, o `globalRunner.enabled` a `false` en el chart de Helm. Sin ningún Runner global, **Runbooks → Agentes de runbook** muestra solo tus propios Runners, y cada paso JavaScript y cada repositorio de código elige uno de ellos.

## Antes de empezar

- **Un host con Docker** dentro de tu infraestructura, que llegue a la URL de tu OneUptime por HTTPS y a los sistemas sobre los que actúan tus pasos.
- **Un rol que cree Runners.** Project Owner, Project Admin, Project Member y Runbook Admin pueden crear uno. Solo un Project Owner, un Project Admin o un Runbook Admin pueden ver la clave de un Runner, que incluye el comando de instalación.

## Instalar un Runner

### 1. Crear el registro del agente

Ve a **Runbooks → Agentes de runbook** y crea un agente nuevo. Haz clic en **Crear Runner** y completa sus campos, todos en una sola página:

| Campo | Dónde | Notas |
| --- | --- | --- |
| **Nombre** | En la página | Un nombre claro, normalmente dónde se ejecuta y a qué llega, como `prod-eu-west-1`. Es lo que eliges al escribir un paso. |
| **Descripción** | En la página | Opcional. Una frase sobre a qué llega este host. |
| **Ejecuta runbooks** | En **Más campos** | Activado por defecto. Permite a este Runner tomar pasos de runbook. |
| **Etiquetas** | En **Más campos** | Opcional. |

Un Runner aplica un cambio de sus capacidades en su siguiente heartbeat; no hace falta reiniciarlo. La IA no es una capacidad. Un repositorio de código elige, en sus ajustes en Código, el Runner en el que la IA trabaja en él, y la página del Runner lista los repositorios que lo eligen. Una regla de IA elige el Runner en el que OneUptime AI ejecuta sus comandos: elegir un Runner ahí es lo que permite que los comandos de OneUptime AI se ejecuten en él. La página del Runner lista también las reglas de IA que lo eligen.

### 2. Copiar el comando de instalación

En la fila del Runner, haz clic en **Mostrar instrucciones de configuración**. El diálogo **Configuración del agente de runbook** muestra un comando `docker run` con el ID y la clave de este Runner ya incluidos. El mismo comando está en la página del Runner, en **Instrucciones de configuración**.

Solo un Project Owner, un Project Admin o un Runbook Admin pueden leer la clave. Los demás ven «No tienes permiso para ver la clave de este agente de runbook» en lugar del comando.

### 3. Ejecutarlo en un host de tu infraestructura

Ejecuta el comando en un host de tu entorno que pueda:

- llegar a tu instancia de OneUptime por HTTPS, y
- hacer lo que tus pasos necesitan, como llegar a otros hosts por SSH, llamar al servidor de API de un clúster o hablar con una base de datos.

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. Comprobar que el agente está conectado

Vuelve a **Runbooks → Agentes de runbook**. Menos de un minuto después de que arranque el contenedor, el **Estado** del Runner debería decir **Conectado**, con un **Visto por última vez** reciente. En la página del Runner, la tarjeta **Estado del agente de runbook** muestra su **Versión del agente de runbook** y su **Host**. Si se queda en **Nunca conectado** o **Desconectado**, consulta [Solución de problemas](#solución-de-problemas).

### 5. Mantener el agente actualizado

Cuando un agente ejecuta una versión más antigua que tu OneUptime, aparece un signo de advertencia junto a su **Versión del agente de runbook** en su página. Selecciónalo para ver cómo actualizarlo: descarga la imagen nueva y elimina el contenedor, y después vuelve a ejecutar el comando de instalación del paso 2. Un agente que instaló el chart del agente de Kubernetes se actualiza con el chart.

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## Apuntar un paso a un Runner

:::steps
### Añadir un paso que se ejecute en un Runner

En los **Pasos** de tu runbook, añade un paso JavaScript, Bash, SSH o kubectl.

### Elegir el Runner

Abre **Más campos** del paso: su lista desplegable **Runner** muestra cada Runner del proyecto y si está conectado, y la línea plegada nombra el Runner en el que se ejecuta el paso. Si el proyecto aún no tiene ninguno, el paso lo indica y te lleva a **Runbooks › Runners**. La primera opción es aquello en lo que se ejecuta un paso que no elige ningún Runner: el [Runner predeterminado del proyecto](#el-runner-predeterminado-del-proyecto), marcado como **Predeterminado del proyecto**, o si no, para un paso JavaScript, **Runner global**.

### Guardar los pasos

Haz clic en **Guardar pasos**. Cuando una ejecución llega al paso, el Worker pone en cola un trabajo para el ID de ese Runner, y solo ese Runner puede reclamarlo. Un paso en **Runner global** espera al Runner global que quede libre.
:::

Bash se ejecuta con `bash -c`. JavaScript se ejecuta en un sandbox `isolated-vm` en el Runner, sin acceso al sistema de archivos ni a los procesos; puede llamar a API HTTP públicas con `axios`, pero no a direcciones de una red privada. Un paso SSH o kubectl inicia sesión con una [variable de runbook](/docs/runbooks/variables) secreta, que debe incluir el Runner del paso en **Tus Runners que pueden usarlo**.

¿Necesitas más de un Runner? Créalos y apunta cada paso al que corresponda. Para tener redundancia, ejecuta un segundo Runner y reparte los pasos entre ambos, o mantén un runbook de respaldo cuyos pasos apunten al otro Runner.

## El Runner predeterminado del proyecto

Un proyecto puede hacer de uno de sus propios Runners su predeterminado, igual que hace de una configuración de Twilio su predeterminada. Cada paso de runbook que no elige ningún Runner se ejecuta entonces en él: los pasos Bash, SSH y kubectl, y los pasos JavaScript, que si no se ejecutarían en un Runner global. Lo mismo hace la IA en cada repositorio de código que no elige ningún Runner en sus ajustes en Código.

Para hacer de un Runner el predeterminado, ve a **Runbooks → Agentes de runbook**, abre el menú **⋯** en la fila del Runner, haz clic en **Establecer como predeterminado del proyecto** y confirma con **Hacer predeterminado del proyecto**. O abre el Runner y, en su tarjeta **Predeterminado del proyecto**, activa **Usar como predeterminado del proyecto**. La lista marca el predeterminado como **Predeterminado del proyecto**, junto a su nombre, y también lo hace la lista desplegable **Runner** de un paso, en su primera opción. Un proyecto tiene un solo Runner predeterminado: hacer predeterminado a otro Runner lo reemplaza. **Dejar de usar como predeterminado del proyecto**, en el mismo menú, o el interruptor en la página del Runner, deja de usarlo.

Dónde se ejecuta un paso que no elige ningún Runner:

| El proyecto | Un paso JavaScript | Un paso Bash, SSH o kubectl |
| --- | --- | --- |
| Tiene un Runner predeterminado | El Runner predeterminado | El Runner predeterminado |
| No tiene, y usa Runners globales | Un Runner global | En ninguno: el paso falla, indicando que no tiene Runner |
| No tiene, y no usa Runners globales | En ninguno: el paso falla, indicándolo | En ninguno: el paso falla, indicando que no tiene Runner |

Un paso que eligió un Runner lo conserva, sea cual sea el predeterminado, y un paso JavaScript todavía puede elegir **Runner global** por sí mismo. Definir un predeterminado no cambia ningún paso guardado.

El predeterminado es uno de los Runners propios del proyecto que ejecuta pasos de runbook: no un Runner global, no el Runner dentro del clúster que instaló el agente de Kubernetes, y no uno con **Ejecuta runbooks** desactivado. Mientras un Runner es el predeterminado, su **Ejecuta runbooks** sigue activado. Cuando el predeterminado no está conectado, la lista desplegable de un paso lo indica, y un paso en él lo espera, como a cualquier Runner, hasta que vence su tiempo de reclamación.

Los pasos de runbook y los repositorios de código que no eligen ningún Runner usan el predeterminado, y se mueven con él cuando otro Runner pasa a ser el predeterminado. Una regla de IA elige su propio Runner, y una regla nueva empieza en el predeterminado.

## Notas de operación

### Tiempos de espera

Dos tiempos de espera se aplican a cada paso que se ejecuta en un Runner:

| Tiempo de espera | Predeterminado | Qué controla |
| --- | --- | --- |
| **Tiempo de espera de reclamación** | 2 minutos | Cuánto espera el Worker a que el Runner elegido reclame el trabajo. Si el Runner no lo toma a tiempo, el paso falla por tiempo agotado y el runbook sigue (o se detiene, según **Continuar en caso de error**). |
| **Tiempo de espera de ejecución** | 30 segundos | Cuánto deja el Runner que se ejecute el paso antes de detenerlo. Bash recibe `SIGKILL`; el sandbox de JavaScript se destruye. |

Ambos se configuran por paso. Abre **Runbooks › tu runbook › Pasos**, despliega el paso y ajusta **Tiempo de espera de ejecución** y **Tiempo de espera de reclamación** (en segundos) en sus **Más campos**. Deja un campo vacío para usar el predeterminado. Cada uno acepta de 1 segundo a 1 hora; los valores fuera de ese rango se ajustan al límite al ejecutarse el paso.

La ventana de espera total del Worker es `claim timeout + execution timeout + a few seconds`. Elige valores que encajen con el paso.

Dos cosas a tener en cuenta si bajas el tiempo de espera de reclamación:

- El Runner pide trabajo en un ciclo de sondeo (`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`, 5 segundos por defecto). Un tiempo de espera de reclamación más corto que un ciclo puede agotarse antes de que un Runner perfectamente sano haya visto siquiera el trabajo, y el paso falla con el mismo mensaje que provoca un Runner desconectado.
- Un Runner ejecuta un trabajo a la vez por defecto (`ONEUPTIME_RUNNER_CONCURRENCY`). Mientras un paso largo lo ocupa, los demás pasos que apuntan al mismo Runner agotan sus propios tiempos de reclamación. Si subes un tiempo de ejecución a minutos, sube también el tiempo de reclamación de los pasos que comparten ese Runner, o dales otro Runner.

### Concesión y heartbeat

```mermaid title="Un trabajo entre OneUptime y su Runner"
sequenceDiagram
    participant O as OneUptime
    participant R as Runner
    O->>O: Poner en cola un<br/>trabajo para este Runner
    R->>O: Reclamar el siguiente trabajo
    O-->>R: El trabajo, con una<br/>concesión de 30 segundos
    loop Cada 10 segundos<br/>mientras se ejecuta
        R->>O: Renovar la concesión
    end
    R->>O: Enviar el resultado
    O->>O: Registrar la salida y<br/>continuar la ejecución
```

Cuando un Runner reclama un trabajo, obtiene una concesión corta (30 segundos por defecto). Mientras el paso se ejecuta, el Runner renueva la concesión cada 10 segundos. Si el Runner muere o pierde la red a mitad de un script, la concesión vence y el Worker marca el trabajo como `TimedOut` en lugar de esperar para siempre.

Los procesos hijos de Bash **no** se cancelan automáticamente cuando vence la concesión (también se deja terminar un sandbox de JavaScript, si alguna vez termina), pero el Worker deja de esperarlos y el Runner no puede enviar un resultado una vez que otra reclamación ha tomado el relevo. Diseña scripts que se puedan volver a ejecutar sin riesgo si te importa que se ejecuten exactamente una vez.

### Si el Worker de OneUptime se reinicia a mitad de un paso

Una ejecución de runbook se ejecuta en un único Worker de principio a fin, así que un despliegue o un fallo puede interrumpirla mientras hay un paso en curso. Lo que pasa después depende de si la ejecución se retoma:

- **Se reanuda.** El Worker que la retoma encuentra el trabajo que tu paso ya creó y **se vuelve a enganchar a él**. Espera a ese trabajo en lugar de enviar a tu Runner una segunda copia del script. Si el Runner ya había terminado, se usa el resultado registrado tal cual. Un paso se envía a un Runner como mucho una vez por ejecución.
- **No se reanuda.** Si la ejecución nunca se retoma, un barrido la marca como `Failed` cuando supera la ventana de reclamación y ejecución configurada para su paso actual, con un mensaje que nombra ese paso. Una ejecución nunca se queda colgada en `Running`.

Lo único que esto no puede decirte es hasta dónde llegó un script antes de que el Worker desapareciera. Un paso que estaba a mitad de ejecución se notifica como fallido con una nota de que puede haberse ejecutado en parte: comprueba el sistema de destino antes de volver a ejecutar el runbook.

### Ningún agente conectado

Si el Runner elegido está desconectado cuando se ejecuta el paso, el trabajo espera como `Pending` hasta que vence el tiempo de reclamación, y entonces el paso falla con "No runbook agent picked up this step before the wait window expired." La página **Agentes de runbook** es donde confirmas la cobertura antes de ejecutar un runbook en una situación real. Un paso en un Runner global falla en cambio con "No global Runner picked up this step before the wait window expired."

### Límite de salida

stdout y stderr juntos tienen un límite de **50 KB** por paso. La salida más larga se corta con una marca. Si necesitas un registro completo, escríbelo desde el script en tu almacén de logs o en un almacenamiento de objetos y muestra la URL con `echo`.

### Cancelación

Cancelar una ejecución de runbook, desde la página de la ejecución o la API, marca de inmediato todos sus trabajos `Pending`, `Claimed` y `Running` como `Cancelled`. Un Runner que ya está a mitad de un script termina su trabajo, pero el servidor no acepta su resultado y no se envía ningún paso posterior del runbook.

### Concurrencia

Cada Runner ejecuta un trabajo a la vez por defecto. Para permitir más, define `ONEUPTIME_RUNNER_CONCURRENCY` en el contenedor, pero recuerda que el Runner comparte el host con todo lo demás que se ejecuta allí.

## Variables de entorno

El Runner lee estas variables al arrancar:

| Variable | Obligatoria | Predeterminado | Notas |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sí | — | URL base de tu instancia de OneUptime, como `https://oneuptime.yourdomain.com`. |
| `ONEUPTIME_RUNNER_ID` | sí | — | El ID del Runner, de su comando de instalación. |
| `ONEUPTIME_RUNNER_KEY` | sí | — | La clave secreta del Runner, de su comando de instalación. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | no | `5000` | Con qué frecuencia pide el Runner trabajos nuevos. Un valor inferior a `1000` vuelve al predeterminado. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | no | `60000` | Con qué frecuencia informa el Runner de que está vivo. Un valor inferior a `5000` vuelve al predeterminado. |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | Con qué frecuencia renueva el Runner la concesión de un trabajo en curso. Un valor inferior a `1000` vuelve al predeterminado. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | no | `1` | Número máximo de trabajos simultáneos en este Runner. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | no | — | Ponlo a `false` para que este Runner deje de tomar pasos de runbook, diga lo que diga el panel. Solo puede desactivar la capacidad. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | no | — | Ponlo a `false` para que este Runner deje de tomar correcciones de código con IA, incluso para un repositorio de código que lo elige. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | no | — | Ponlo a `false` para que este Runner deje de ejecutar comandos de remediación con IA, diga lo que diga el panel. |

## Rotar la clave de un agente

Si una clave se filtra, restablécela. La clave antigua deja de funcionar de inmediato.

:::steps
### Restablecer la clave

Abre el Runner desde **Runbooks → Agentes de runbook**, haz clic en **Restablecer clave del agente de runbook** y confirma. El Runner deja de conectarse hasta que tenga la clave nueva.

### Ejecutar el contenedor con la clave nueva

Copia el comando nuevo de las **Instrucciones de configuración** del Runner, elimina el contenedor antiguo y ejecuta el comando nuevo en el mismo host:

```bash
docker rm -f oneuptime-runner
```

### Comprobar que se vuelve a conectar

En **Runbooks → Agentes de runbook**, el **Estado** del Runner vuelve a **Conectado** en menos de un minuto.
:::

## Permisos

La gestión de agentes está en el grupo de permisos de Runbooks existente:

- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gestionar los registros de los agentes.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (roles) — `RunbookAdmin` construye runbooks, sus reglas y los Runners en los que se ejecutan, y los ejecuta. `RunbookMember` abre runbooks y sus ejecuciones y los ejecuta — inicia una ejecución, completa u omite sus pasos y la cancela —, pero no crea, cambia ni elimina ningún runbook ni Runner. `RunbookViewer` lee runbooks y sus ejecuciones y no ejecuta nada. `RunbookAdmin` reúne todos los permisos granulares anteriores.
- Los Runners globales no pertenecen a ningún proyecto: solo un administrador principal añade, cambia o quita uno, en el Panel de administración. Todos los que pueden leer los Runners de un proyecto los ven, y desactivar **Usar Runners globales** requiere el permiso para editar el proyecto.

Desencadenar un runbook (y con ello enviar sus pasos a los Runners) requiere un rol que ejecute runbooks — `ProjectOwner`, `ProjectAdmin`, `ProjectMember`, `RunbookAdmin` o `RunbookMember` — o `CreateRunbookExecution`; completar, omitir o cancelar una ejecución también acepta `EditRunbookExecution`. Un rol solo ejecuta los runbooks a los que llega su alcance.

La clave de un Runner solo la pueden leer los Project Owners, los Project Admins y los Runbook Admins.

## API del agente

Para los curiosos: el Runner usa estos endpoints, montados en `/runner-ingest`. La ruta anterior a la fusión, `/runbook-agent-ingest`, se sigue sirviendo para los agentes que aún no se han vuelto a desplegar, así que actualizar el servidor no los rompe. Se autentican con el ID y la clave del Runner en el cuerpo JSON (`agentId` y `agentKey`), o en los encabezados `x-agent-id` y `x-agent-key`.

| Endpoint | Para qué sirve |
| --- | --- |
| `POST /heartbeat` | Señal de vida. Actualiza la última vez visto, la versión y la información del host del Runner, y devuelve las capacidades que el proyecto le concedió. |
| `POST /claim-next-job` | Reclamar de forma atómica el trabajo `Pending` más antiguo dirigido al ID de este Runner. Devuelve `{ job: null }` cuando no hay nada que hacer. Un Runner global reclama en cambio el paso más antiguo que espera a cualquier Runner global. |
| `POST /job/:jobId/heartbeat` | Renovar la concesión del trabajo. Devuelve 404 cuando la concesión ha vencido o el trabajo ha terminado. |
| `POST /job/:jobId/result` | Enviar el resultado final. Se ignora si la concesión ya ha pasado a otro. |
| `POST /disconnect` | Desconectarse en un apagado limpio. |

No deberías tener que llamarlos a mano: el contenedor del Runner lo hace. Están documentados aquí para que puedas construir tu propio agente si tienes una restricción a la que el nuestro no se adapta.

## Solución de problemas

:::details El Runner se queda en Nunca conectado o Desconectado
- Revisa los logs del contenedor con `docker logs oneuptime-runner` en busca de errores de autenticación o de red.
- Comprueba que el host llega a la URL de tu OneUptime, por ejemplo con `curl`.
- Comprueba que el ID y la clave se copiaron sin espacios, y que `ONEUPTIME_URL` es la dirección con la que abres OneUptime.

**Nunca conectado** significa que el Runner nunca ha informado. **Desconectado** significa que sí lo hizo, pero no en los últimos 5 minutos.
:::

:::details Los pasos fallan con "No runbook agent picked up this step before the wait window expired."
El Runner del paso no reclamó el trabajo dentro de su tiempo de reclamación. Comprueba que el Runner está **Conectado**, que **Ejecuta runbooks** está activado para él y que no está ocupado con un paso largo: ejecuta un trabajo a la vez salvo que subas `ONEUPTIME_RUNNER_CONCURRENCY`. Un tiempo de reclamación más corto que el intervalo de sondeo falla igual.
:::

:::details Los pasos fallan con "The runbook agent stopped responding while this step was running."
El Runner reclamó el trabajo y luego dejó de renovar su concesión: se cayó, se reinició o perdió la red. Comprueba que está conectado y después comprueba el sistema de destino antes de volver a ejecutar el runbook.
:::

:::details El Runner registra "No capability is enabled"
Todas las capacidades están desactivadas para este Runner. Activa **Ejecuta runbooks** en la página del Runner en OneUptime. Lo aplica en su siguiente heartbeat.
:::

:::details Un paso falla porque su Runner no puede usar una variable secreta
El paso nombra una variable secreta que no permite usarla a su Runner, así que el Runner no la recibió y el paso no se ejecutó. El error nombra el secreto y lo que hay que cambiar. En **Runbooks → Ajustes → Variables globales**, o en **Ajustes → Variables** del runbook, añade el Runner en **Tus Runners que pueden usarlo**, o activa **Los Runners globales pueden usarlo** para un paso en un Runner global. O elige un Runner que el secreto permita.
:::

:::details Un paso kubectl falla porque su Runner es demasiado antiguo
El paso falló con "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." Un Runner anterior a los scripts kubectl no puede ejecutar uno. Un paso de Kubernetes que pasó a ser un script kubectl al actualizar sigue ejecutándose en él como la acción con la que se escribió, hasta que se cambian su script o su kubeconfig. Actualiza el Runner, como muestra [Mantener el agente actualizado](#5-mantener-el-agente-actualizado), y vuelve a ejecutar el runbook.
:::

## Siguientes pasos

:::cards
- [Crear un runbook](/docs/runbooks/authoring): Escribir los pasos que se ejecutan en tu Runner.
- [Variables de runbook](/docs/runbooks/variables): Los valores y secretos que usan tus pasos, y los Runners que los reciben.
- [Configuración y seguridad de runbooks](/docs/runbooks/configuration): Límites, permisos y endurecimiento.
:::
