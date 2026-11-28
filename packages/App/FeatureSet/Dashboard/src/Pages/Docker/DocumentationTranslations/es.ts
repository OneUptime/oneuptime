import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 o posterior",
  "Access to `/var/run/docker.sock` on the host":
    "Acceso a `/var/run/docker.sock` en el host",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Los contenedores cuyos registros quieras deben usar el controlador de registro `json-file`, el predeterminado de Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Después inicia el agente de IA de OneUptime a su lado, con la misma URL, clave y nombre de host. **Las investigaciones de IA están activadas de forma predeterminada**: mientras OneUptime AI investiga un incidente o una alerta de este host, ejecuta comandos `docker` de solo lectura a través del agente de IA, y no cambia nada a menos que permitas correcciones; consulta **El agente de IA de OneUptime** en Avanzado. Omite este comando para ejecutar el recolector sin investigaciones de IA.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Sustituye `my-docker-host` por un nombre para este host, como `prod-docker-01`. Es como aparece el host en OneUptime, así que mantenlo estable: un nombre nuevo registra un host nuevo.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Busca esta línea en los registros:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "En cuanto el agente se conecta, el host aparece automáticamente en la sección **Docker**, normalmente en cerca de un minuto. El agente de IA de OneUptime aparece como Conectado en la página **IA → Agente de IA** del host y al final de su **Vista general**.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Sí | La clave de ingesta de telemetría del paso 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | No | Un nombre descriptivo para este host. De forma predeterminada, `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | No | La versión de la API de Docker Engine que habla el agente. Vacía de forma predeterminada: el agente la negocia con el daemon, así que funciona cualquier Docker Engine desde la 20.10. Defínela solo para fijar una versión (consulta Solución de problemas) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` a `ONEUPTIME_LOG_OPERATOR_5` | No | Operadores propios del recolector, cada uno en JSON, para un formato de registro que el agente no lee |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Pasa cada una a `docker run` como `-e NAME=value`. Para cambiar una más adelante, elimina el agente con `docker rm -f oneuptime-docker-agent` y vuelve a ejecutar el comando con el nuevo valor.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "El agente sigue `/var/lib/docker/containers/*/*-json.log`, así que solo ve los registros de los contenedores que usan el controlador de registro **`json-file`** de Docker. Es el predeterminado de Docker, pero algunos hosts cambian a `local` (archivos binarios que el agente no puede analizar) o a un controlador remoto (`journald`, `syslog`, `fluentd`, `gelf`, …), que no dejan archivos que leer.",
  "Check a container's log driver, and the daemon's default:":
    "Comprueba el controlador de registro de un contenedor y el predeterminado del daemon:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Cambia un servicio de Compose a `json-file`, con rotación:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "O cambia el predeterminado del daemon para todos los contenedores que se creen después, en `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Después reinicia Docker y **vuelve a crear** (no basta con reiniciar) los contenedores afectados: un contenedor conserva el controlador de registro con el que se creó.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, el segundo contenedor que inicia el paso 2, ejecuta los comandos `docker` que pide OneUptime AI mientras investiga un incidente o una alerta de este host. **Las investigaciones de IA están activadas de forma predeterminada**: en cuanto se conecta, OneUptime AI investiga con él, y la página **IA → Agente de IA** del host y su **Vista general** muestran su estado. Para desactivar las investigaciones, usa **Lo que puede hacer la IA** en esa página; para ejecutar el recolector sin el agente de IA, elimínalo con `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **De solo lectura de forma predeterminada.** Ejecuta comandos como `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` y `docker stats --no-stream`, nunca `exec`, `run`, `rm` ni `prune`. Los valores de entorno de la salida de `docker inspect` se enmascaran antes de que nada salga del host.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Las correcciones son opcionales.** Añade `-e ONEUPTIME_AI_ALLOW_WRITES=true` al comando para dejarle reiniciar, iniciar, detener, pausar, matar o cambiar los límites de un contenedor con nombre. `ONEUPTIME_AI_FIXES`, a su lado, indica si cada corrección necesita aprobación (`ask-for-approval`, `automatic` o `bypass-approval`), y la página **IA → Agente de IA** del host lo muestra. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por comas, como `web-*,api-*`) limita qué contenedores; `ONEUPTIME_AI_PROTECTED_TARGETS` añade contenedores que nunca debe cambiar. Nunca se cambia a sí mismo ni al recolector.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Se ejecuta como root porque el socket de Docker pertenece a root. El montaje `:ro` del socket no hace que la API de Docker sea de solo lectura: el límite es la política de comandos del agente.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Sus registros: `docker logs -f oneuptime-docker-ai-agent`. Qué puede ejecutar y cómo funcionan las correcciones: [Agentes de IA de infraestructura](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Etiqueta | Descripción |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Última versión estable (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Última versión estable (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Una versión fijada, p. ej., `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | La misma imagen, replicada en GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Usa una en lugar de `oneuptime/docker-agent:release` al final del comando `docker run`.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Actualizar**: descarga la imagen más reciente y elimina el agente en ejecución:",
  "Then run both `docker run` commands from step 2 again.":
    "Después vuelve a ejecutar los dos comandos `docker run` del paso 2.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Registros de contenedores** | Registros stdout/stderr de todos los contenedores |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Cada línea de registro recibe una gravedad del nivel que indica (`[ERROR]`, `level=warn`, `{"level":"info"}`); una línea sin nivel recurre a su flujo: stderr es `ERROR` y stdout es `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "El agente debe ejecutarse como root para leer `/var/run/docker.sock`. Asegúrate de que la opción `--user 0:0` está en tu comando `docker run`.",
  "The agent's logs show:": "Los registros del agente muestran:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "El daemon rechaza un cliente más nuevo que su propio máximo, el recolector se cierra con ello y el contenedor se reinicia en bucle. El agente fija una versión solo cuando `DOCKER_API_VERSION` la indica, y una imagen antigua del agente fijaba `1.44`, que Docker Engine 20.10 a 24 rechazan. Elimina el agente (`docker rm -f oneuptime-docker-agent`), descarga la imagen más reciente (`docker pull oneuptime/docker-agent:release`) y vuelve a ejecutar el comando del paso 2, sin `-e DOCKER_API_VERSION`. Entonces el agente negocia la versión con el daemon.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Para fijar una versión de todos modos, no superes el máximo del daemon:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Añádela al comando, p. ej., `-e DOCKER_API_VERSION=1.41`. Los daemons más nuevos siguen sirviendo versiones antiguas de la API, así que una versión fijada sigue funcionando después de actualizar Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Comprueba que el agente se está ejecutando: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Busca errores en los registros del agente: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Comprueba que la URL de OneUptime y la clave de ingesta del comando `docker run` son correctas.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Asegúrate de que el host puede llegar a tu instancia de OneUptime por la red.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Comprueba que el socket de Docker está montado en el agente. Su imagen no tiene shell, así que mira desde un contenedor desechable que comparta sus montajes:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Después busca errores de exportación en los registros del agente (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) y asegúrate de que la clave de ingesta es válida y no ha caducado.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "¿Llegan métricas, pero la pestaña **Registros** está vacía o solo muestra los registros del propio agente? Lo más probable es que tus contenedores no usen el controlador de registro `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Si el paso 1 muestra `no files match the configured criteria`, o el paso 3 no lista ningún archivo de tus contenedores, es que no usan `json-file`. Cámbialos (consulta **Recopilar los registros de todos los contenedores (controlador de registro json-file)** en Avanzado) y después vuelve a crear cada uno: un contenedor conserva el controlador de registro con el que se creó:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "La página de un host muestra los datos cuyo nombre de host es el identificador de ese host, que el agente toma de `DOCKER_HOST_NAME`. Si cambias `DOCKER_HOST_NAME` después de registrarse el host, OneUptime registra un segundo host con el nuevo nombre, y los registros están en ese. Comprueba el nombre que informa el agente:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "El nombre del host viene de `DOCKER_HOST_NAME`. Un agente iniciado sin él informa `docker-host`, así que todos los hosts configurados así parecen el mismo host. Da a `DOCKER_HOST_NAME` un nombre propio en cada host y vuelve a crear el agente: `docker rm -f oneuptime-docker-agent` y después ejecuta el comando del paso 2 con el nuevo nombre.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Esto instala el agente para **`web-1`**: deja `DOCKER_HOST_NAME` exactamente como está, o los datos se registrarán como un host nuevo.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (el comando `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "El segundo servicio es el agente de IA de OneUptime, con la misma URL, clave y nombre de host. **Las investigaciones de IA están activadas de forma predeterminada**: mientras OneUptime AI investiga un incidente o una alerta de este host, ejecuta comandos `docker` de solo lectura a través del agente de IA, y no cambia nada a menos que permitas correcciones; consulta **El agente de IA de OneUptime** en Avanzado. Elimina el servicio `oneuptime-docker-ai-agent` para ejecutar el recolector sin investigaciones de IA.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Define cada una en la lista `environment:` del agente y después ejecuta `docker compose up -d` para volver a crearlo con los nuevos valores.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, el segundo servicio de docker-compose.yml, ejecuta los comandos `docker` que pide OneUptime AI mientras investiga un incidente o una alerta de este host. **Las investigaciones de IA están activadas de forma predeterminada**: en cuanto se conecta, OneUptime AI investiga con él, y la página **IA → Agente de IA** del host y su **Vista general** muestran su estado. Para desactivar las investigaciones, usa **Lo que puede hacer la IA** en esa página; para ejecutar el recolector sin el agente de IA, elimina su servicio y ejecuta `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Las correcciones son opcionales.** Añade `- ONEUPTIME_AI_ALLOW_WRITES=true` a su lista `environment:` para dejarle reiniciar, iniciar, detener, pausar, matar o cambiar los límites de un contenedor con nombre. `ONEUPTIME_AI_FIXES`, a su lado, indica si cada corrección necesita aprobación (`ask-for-approval`, `automatic` o `bypass-approval`), y la página **IA → Agente de IA** del host lo muestra. `ONEUPTIME_AI_WRITE_TARGETS` (globs separados por comas, como `web-*,api-*`) limita qué contenedores; `ONEUPTIME_AI_PROTECTED_TARGETS` añade contenedores que nunca debe cambiar. Nunca se cambia a sí mismo ni al recolector.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Usa una en lugar de `oneuptime/docker-agent:release` en la línea `image:` del agente.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Actualizar**: en la carpeta que contiene docker-compose.yml, descarga las imágenes más recientes y vuelve a crear los contenedores:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Desinstalar**: detén y elimina todo lo que inició el archivo:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'El agente debe ejecutarse como root para leer `/var/run/docker.sock`. Asegúrate de que el servicio del agente tiene `user: "0:0"` en docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "El daemon rechaza un cliente más nuevo que su propio máximo, el recolector se cierra con ello y el contenedor se reinicia en bucle. El agente fija una versión solo cuando `DOCKER_API_VERSION` la indica, y una imagen antigua del agente fijaba `1.44`, que Docker Engine 20.10 a 24 rechazan. Quita `DOCKER_API_VERSION` de la lista `environment:` del agente y después ejecuta `docker compose pull` y `docker compose up -d`. Entonces el agente negocia la versión con el daemon.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Añádela a la lista `environment:` del agente, p. ej., `- DOCKER_API_VERSION=1.41`, y ejecuta `docker compose up -d`. Los daemons más nuevos siguen sirviendo versiones antiguas de la API, así que una versión fijada sigue funcionando después de actualizar Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Comprueba que la URL de OneUptime y la clave de ingesta de docker-compose.yml son correctas.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "El nombre del host viene de `DOCKER_HOST_NAME`. Un agente iniciado sin él informa `docker-host`, así que todos los hosts configurados así parecen el mismo host. Da a `DOCKER_HOST_NAME` un nombre propio en cada host y ejecuta `docker compose up -d` para volver a crear el agente con él.",
};

export default TRANSLATION;
