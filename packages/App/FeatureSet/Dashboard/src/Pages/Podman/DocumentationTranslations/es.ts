import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 o posterior",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "El socket de API compatible con Docker de Podman en `/run/podman/podman.sock`: actívalo con `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Los contenedores cuyos registros quieras deben usar el controlador de registro `k8s-file`: Podman rootful usa `journald` de forma predeterminada, que el agente no puede leer",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Después inicia el agente de IA de OneUptime a su lado, con la misma URL, clave y nombre de host. **Las investigaciones de IA están activadas de forma predeterminada**: mientras OneUptime AI investiga un incidente o una alerta de este host, ejecuta comandos `docker` de solo lectura a través del agente de IA, contra el socket compatible con Docker de Podman, y no cambia nada a menos que permitas correcciones; consulta **El agente de IA de OneUptime** en Avanzado. Omite este comando para ejecutar el recolector sin investigaciones de IA.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Sustituye `my-podman-host` por un nombre para este host, como `prod-podman-01`. Es como aparece el host en OneUptime, así que mantenlo estable: un nombre nuevo registra un host nuevo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Busca esta línea en los registros:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "En cuanto el agente se conecta, el host aparece automáticamente en la sección **Podman**, normalmente en cerca de un minuto. El agente de IA de OneUptime aparece como Conectado en la página **IA → Agente de IA** del host y al final de su **Vista general**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**¿Métricas, pero no registros?** Podman rootful escribe los registros de los contenedores en `journald` de forma predeterminada, que el agente no puede leer. Ejecuta tus contenedores con `--log-driver k8s-file`; consulta **Recopilar los registros de todos los contenedores (controlador de registro k8s-file)** en Avanzado.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sí | La clave de ingesta de telemetría del paso 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | No | Un nombre descriptivo para este host. De forma predeterminada, `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | No | La versión de la API de Docker que el agente habla con el socket de Podman. Vacía de forma predeterminada: el agente la negocia con el socket. Defínela solo para fijar una versión (consulta Solución de problemas) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | No | Operadores propios del recolector, cada uno en JSON, para un formato de registro que el agente no lee |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Pasa cada una a `podman run` como `-e NAME=value`. Para cambiar una más adelante, elimina el agente con `podman rm -f oneuptime-podman-agent` y vuelve a ejecutar el comando con el nuevo valor.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "El agente lee los archivos que escribe el controlador de registro **`k8s-file`** de Podman (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), así que solo ve los registros de los contenedores que lo usan (o `json-file`, que Podman trata como el mismo controlador basado en archivos). El predeterminado de Podman rootful es **`journald`**, que no puede leer, igual que tampoco un controlador remoto como `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Comprueba el controlador de registro de un contenedor y el predeterminado de Podman:",
  "Run a single container with `k8s-file`:":
    "Ejecuta un único contenedor con `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Cambia un servicio de Compose a `k8s-file`, con rotación:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "O cambia el predeterminado para todos los contenedores que se creen después, en `containers.conf` (`/etc/containers/containers.conf` en rootful, `~/.config/containers/containers.conf` en rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "Después **vuelve a crear** (no basta con reiniciar) los contenedores afectados: un contenedor conserva el controlador de registro con el que se creó. ¿Tienes que mantener `journald`? El agente sigue recopilando métricas a través del socket; solo los registros de los contenedores necesitan el controlador basado en archivos.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, el segundo contenedor que inicia el paso 2, ejecuta los comandos `docker` que pide OneUptime AI (a través del socket compatible con Docker de Podman) mientras investiga un incidente o una alerta de este host. **Las investigaciones de IA están activadas de forma predeterminada**: en cuanto se conecta, OneUptime AI investiga con él, y la página **IA → Agente de IA** del host y su **Vista general** muestran su estado. Para desactivar las investigaciones, usa **Lo que puede hacer la IA** en esa página; para ejecutar el recolector sin el agente de IA, elimínalo con `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **De solo lectura de forma predeterminada.** Ejecuta comandos como `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` y `docker stats --no-stream`, nunca `exec`, `run`, `rm` ni `prune`. Los valores de entorno de la salida de `docker inspect` se enmascaran antes de que nada salga del host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Las correcciones son opcionales.** Añade `-e ONEUPTIME_AI_ALLOW_WRITES=true` al comando para dejarle reiniciar, iniciar, detener, pausar, matar o cambiar los límites de un contenedor con nombre. `ONEUPTIME_AI_FIXES`, a su lado, indica si cada corrección necesita aprobación (`ask-for-approval`, `automatic` o `bypass-approval`), y la página **IA → Agente de IA** del host lo muestra. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por comas, como `web-*,api-*`) limita qué contenedores; `ONEUPTIME_AI_PROTECTED_TARGETS` añade contenedores que nunca debe cambiar. Nunca se cambia a sí mismo ni al recolector.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Necesita el mismo socket que el recolector y se ejecuta como root porque el socket pertenece a root. El montaje `:ro` del socket no hace que la API sea de solo lectura: el límite es la política de comandos del agente.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Sus registros: `podman logs -f oneuptime-podman-ai-agent`. Qué puede ejecutar y cómo funcionan las correcciones: [Agentes de IA de infraestructura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Etiqueta | Descripción |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Última versión estable (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Última versión estable (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Una versión fijada, p. ej., `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | La misma imagen, replicada en GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Usa una en lugar de `oneuptime/podman-agent:release` al final del comando `podman run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Actualizar**: descarga la imagen más reciente y elimina el agente en ejecución:",
  "Then run both `podman run` commands from step 2 again.":
    "Después vuelve a ejecutar los dos comandos `podman run` del paso 2.",
  "**Uninstall:**": "**Desinstalar:**",
  "| Category | Data |": "| Categoría | Datos |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **Métricas de CPU** | Uso total, porcentaje de uso, tiempo de limitación (por contenedor) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Métricas de memoria** | Uso, límite, porcentaje, RSS, caché (por contenedor) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Métricas de red** | Bytes y paquetes recibidos/transmitidos (por contenedor) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Métricas de E/S de bloque** | Bytes y operaciones de lectura/escritura (por contenedor) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Información del contenedor** | Tiempo de actividad, número de reinicios, número de procesos |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Registros de contenedores** | Registros stdout/stderr de todos los contenedores que usan el controlador de registro `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Las métricas vienen del receptor `docker_stats` del recolector, a través del socket compatible con Docker de Podman, así que sus nombres son los mismos que los del agente de Docker. Cada línea de registro recibe una gravedad del nivel que indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); una línea sin nivel recurre a su flujo: stderr es `ERROR` y stdout es `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "El agente debe ejecutarse como root para leer `/run/podman/podman.sock`. Asegúrate de que la opción `--user 0:0` está en tu comando `podman run` y de que el socket está activado:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Ese es el socket de Podman rootful, el que lee el agente. ¿Usas Podman en modo rootless? Su socket es `/run/user/<uid>/podman/podman.sock` (actívalo con `systemctl --user enable --now podman.socket`) y su almacenamiento `~/.local/share/containers/storage`: móntalos en `/run/podman/podman.sock` y `/var/lib/containers/storage` en el contenedor del agente; consulta la documentación del agente de Podman.",
  "The agent's logs show:": "Los registros del agente muestran:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Un servidor que impone un máximo rechaza un cliente más nuevo, el recolector se cierra con ello y el contenedor se reinicia en bucle. El agente fija una versión de la API de Docker solo cuando `DOCKER_API_VERSION` la indica, y una imagen antigua del agente fijaba `1.44`. Elimina el agente (`podman rm -f oneuptime-podman-agent`), descarga la imagen más reciente (`podman pull oneuptime/podman-agent:release`) y vuelve a ejecutar el comando del paso 2, sin `-e DOCKER_API_VERSION`. Entonces el agente negocia la versión con el socket.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Para fijar una versión de todos modos, no superes la versión que informa el socket:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Añádela al comando, p. ej., `-e DOCKER_API_VERSION=1.41`. Los servidores más nuevos siguen sirviendo versiones antiguas de la API, así que una versión fijada sigue funcionando después de una actualización.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Comprueba que el agente se está ejecutando: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Busca errores en los registros del agente: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Comprueba que la URL de OneUptime y la clave de ingesta del comando `podman run` son correctas.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Asegúrate de que el host puede llegar a tu instancia de OneUptime por la red.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Comprueba que el socket de Podman está montado en el agente. Su imagen no tiene shell, así que mira desde un contenedor desechable que comparta sus montajes:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Después busca errores de exportación en los registros del agente (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) y asegúrate de que la clave de ingesta es válida y no ha caducado.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "¿Llegan métricas, pero la pestaña **Registros** está vacía o solo muestra los registros del propio agente? Lo más probable es que tus contenedores no usen un controlador de registro basado en archivos (`k8s-file` o `json-file`): Podman rootful usa `journald` de forma predeterminada, que el agente no puede leer.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Si el paso 1 muestra `no files match the configured criteria`, o el paso 3 no lista ningún archivo de tus contenedores, es que no usan `k8s-file`. Cámbialos (consulta **Recopilar los registros de todos los contenedores (controlador de registro k8s-file)** en Avanzado) y después vuelve a crear cada uno: un contenedor conserva el controlador de registro con el que se creó:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La página de un host muestra los datos cuyo nombre de host es el identificador de ese host, que el agente toma de `PODMAN_HOST_NAME`. Si cambias `PODMAN_HOST_NAME` después de registrarse el host, OneUptime registra un segundo host con el nuevo nombre, y los registros están en ese. Comprueba el nombre que informa el agente:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "El nombre del host viene de `PODMAN_HOST_NAME`. Un agente iniciado sin él informa `podman-host`, así que todos los hosts configurados así parecen el mismo host. Da a `PODMAN_HOST_NAME` un nombre propio en cada host y vuelve a crear el agente: `podman rm -f oneuptime-podman-agent` y después ejecuta el comando del paso 2 con el nuevo nombre.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Esto instala el agente para **`web-1`**: deja `PODMAN_HOST_NAME` exactamente como está, o los datos se registrarán como un host nuevo.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Un proveedor de Compose para `podman compose`: `podman-compose` o Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "El segundo servicio es el agente de IA de OneUptime, con la misma URL, clave y nombre de host. **Las investigaciones de IA están activadas de forma predeterminada**: mientras OneUptime AI investiga un incidente o una alerta de este host, ejecuta comandos `docker` de solo lectura a través del agente de IA, contra el socket compatible con Docker de Podman, y no cambia nada a menos que permitas correcciones; consulta **El agente de IA de OneUptime** en Avanzado. Elimina el servicio `oneuptime-podman-ai-agent` para ejecutar el recolector sin investigaciones de IA.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Define cada una en la lista `environment:` del agente y después ejecuta `podman compose up -d` para volver a crearlo con los nuevos valores.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, el segundo servicio de docker-compose.yml, ejecuta los comandos `docker` que pide OneUptime AI (a través del socket compatible con Docker de Podman) mientras investiga un incidente o una alerta de este host. **Las investigaciones de IA están activadas de forma predeterminada**: en cuanto se conecta, OneUptime AI investiga con él, y la página **IA → Agente de IA** del host y su **Vista general** muestran su estado. Para desactivar las investigaciones, usa **Lo que puede hacer la IA** en esa página; para ejecutar el recolector sin el agente de IA, elimina su servicio y ejecuta `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Las correcciones son opcionales.** Añade `- ONEUPTIME_AI_ALLOW_WRITES=true` a su lista `environment:` para dejarle reiniciar, iniciar, detener, pausar, matar o cambiar los límites de un contenedor con nombre. `ONEUPTIME_AI_FIXES`, a su lado, indica si cada corrección necesita aprobación (`ask-for-approval`, `automatic` o `bypass-approval`), y la página **IA → Agente de IA** del host lo muestra. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por comas, como `web-*,api-*`) limita qué contenedores; `ONEUPTIME_AI_PROTECTED_TARGETS` añade contenedores que nunca debe cambiar. Nunca se cambia a sí mismo ni al recolector.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Usa una en lugar de `oneuptime/podman-agent:release` en la línea `image:` del agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Actualizar**: en la carpeta que contiene docker-compose.yml, descarga las imágenes más recientes y vuelve a crear los contenedores:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Desinstalar**: detén y elimina todo lo que inició el archivo:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'El agente debe ejecutarse como root para leer `/run/podman/podman.sock`. Asegúrate de que el servicio del agente tiene `user: "0:0"` en docker-compose.yml y de que el socket está activado:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Un servidor que impone un máximo rechaza un cliente más nuevo, el recolector se cierra con ello y el contenedor se reinicia en bucle. El agente fija una versión de la API de Docker solo cuando `DOCKER_API_VERSION` la indica, y una imagen antigua del agente fijaba `1.44`. Quita `DOCKER_API_VERSION` de la lista `environment:` del agente y después ejecuta `podman compose pull` y `podman compose up -d`. Entonces el agente negocia la versión con el socket.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Añádela a la lista `environment:` del agente, p. ej., `- DOCKER_API_VERSION=1.41`, y ejecuta `podman compose up -d`. Los servidores más nuevos siguen sirviendo versiones antiguas de la API, así que una versión fijada sigue funcionando después de una actualización.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Comprueba que la URL de OneUptime y la clave de ingesta de docker-compose.yml son correctas.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "El nombre del host viene de `PODMAN_HOST_NAME`. Un agente iniciado sin él informa `podman-host`, así que todos los hosts configurados así parecen el mismo host. Da a `PODMAN_HOST_NAME` un nombre propio en cada host y ejecuta `podman compose up -d` para volver a crear el agente con él.",
};

export default TRANSLATION;
