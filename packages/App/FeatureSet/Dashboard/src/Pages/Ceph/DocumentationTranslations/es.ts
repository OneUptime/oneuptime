import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que pueda llegar a tus daemons mgr de Ceph en el puerto 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Una shell en un nodo de administración de Ceph, donde la CLI `ceph` funcione con permisos de administrador",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Después lista tus daemons mgr: el agente los necesita **todos**, el activo y los standby:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Solo el mgr **activo** devuelve métricas (los standby responden con una respuesta vacía), así que consultar cada mgr mantiene el flujo de métricas cuando el activo conmuta.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "El script pide tu URL de OneUptime y tu clave de ingesta, ambas mostradas en el paso 1 (elige ahí una clave para que se rellenen aquí), y después:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nombre del clúster**: cómo aparece el clúster en OneUptime. Da a cada clúster el suyo y mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **Endpoints de mgr**: cada mgr del paso anterior como `host:port` separados por comas, p. ej., `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. El script añade los corchetes.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **Agente de IA de OneUptime**: si puede aplicar correcciones; responde **N** para mantenerlo de solo lectura. Donde `ceph` funcione con permisos de administrador, el script también ofrece crear el cliente de Ceph propio del agente de IA.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Se instala en `/opt/oneuptime-ceph-agent`, escribe un archivo `.env` con `0600` e inicia el agente con Docker Compose. Volver a ejecutar el script reutiliza todo lo que hay en ese `.env` en lugar de volver a preguntar, así que también es como se actualiza.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Busca `Everything is ready. Begin running and processing data.` en los registros. Después el clúster aparece automáticamente en la sección **Ceph**, normalmente en cerca de un minuto.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose también ejecuta **`oneuptime-ceph-ai-agent`**, el agente de IA de OneUptime. Si el script de instalación creó su cliente de Ceph, ya funciona; si no, espera uno; consulta **Agente de IA de OneUptime** en Avanzado.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**Agente de IA de OneUptime (activado de forma predeterminada, solo lectura).** Las investigaciones de IA están activadas: en cuanto tiene su cliente de Ceph, permite que OneUptime AI investigue incidentes y alertas de este clúster con comandos `ceph` de solo lectura, y no cambia nada a menos que permitas correcciones.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "El script de instalación las escribe en `/opt/oneuptime-ceph-agent/.env`. Después de cambiar una, aplícala con `docker compose up -d` en `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sí | La clave de ingesta de telemetría, la elegida en el paso 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Sí | El identificador del clúster que se muestra en OneUptime. Se estampa en cada métrica como el atributo de recurso `ceph.cluster.name`. Mantenlo estable: cambiarlo registra un clúster nuevo (predeterminado: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Sí | Lista `host:port` separada por comas de **todos** los daemons mgr, entre corchetes, p. ej., `[ceph-mon-1:9283,ceph-mon-2:9283]`. El script de instalación añade los corchetes por ti |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Los ajustes propios del agente de IA de OneUptime están en **Agente de IA de OneUptime**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Se consultan todos los mgr** (el activo y los standby), así que las métricas sobreviven a una conmutación del mgr activo.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Cada 30 segundos.** El módulo prometheus del mgr guarda en caché una consulta durante `mgr/prometheus/scrape_interval` (15 segundos de forma predeterminada): nunca consultes más a menudo, solo volverías a leer la caché.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** mantiene tal cual las etiquetas que exporta Ceph (`ceph_daemon`, `pool_id`), así que las series siguen siendo continuas a través de las conmutaciones de mgr.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Este es el `otel-collector-config.yaml` completo que ejecuta el agente; el archivo `.env` aporta los valores `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "El agente puede seguir `/var/log/ceph/ceph.log` y enviarlo a OneUptime, lo que llena la página **Registro del clúster**. Está desactivado de forma predeterminada porque el agente debe ejecutarse en un host que tenga el registro del clúster, un host mon de forma predeterminada.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. En `otel-collector-config.yaml`, descomenta el receptor `filelog` y el pipeline `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. En `docker-compose.yml`, descomenta el volumen `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Aplica ambos:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Las líneas se envían tal cual; OneUptime analiza el formato de ceph.log (marca de tiempo, daemon, nivel INF/WRN/ERR, mensaje) al leerlas, y el procesador `resource` estampa `ceph.cluster.name` para que el registro llegue a este clúster.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta de proyecto en el clúster: `oneuptime.label.<dimension>=<value>` es la etiqueta `<dimension>:<value>`. Añádelos al procesador `resource` en `otel-collector-config.yaml`, junto a `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Después reinicia el recolector para que lea la nueva configuración:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "El clúster aparece con las etiquetas `team:storage` y `env:production`. Las etiquetas se comparan sin distinguir mayúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "El agente envía todo lo que exporta el módulo prometheus del mgr. Las páginas de Ceph, el catálogo de métricas y las plantillas de alerta de OneUptime se basan en:",
  "| Category | Data |": "| Categoría | Datos |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Salud del clúster** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), quórum de monitores, capacidad bruta total y usada |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Estado up / in de cada OSD (por etiqueta `ceph_daemon`, p. ej., `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Bytes almacenados, máximo disponible, número de objetos, operaciones y rendimiento de lectura/escritura por pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Grupos de colocación** | Número de PG activos, degradados e infradimensionados |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` también ejecuta **`oneuptime-ceph-ai-agent`**. Mientras OneUptime AI investiga un incidente o una alerta de este clúster, ejecuta comandos `ceph` a través de él: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Se registra como el clúster llamado `CEPH_CLUSTER_NAME` y aparece en la página **IA → Agente de IA** del clúster.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Se conecta como su propio cliente de Ceph, `client.oneuptime-ai`, con el `ceph.conf` mínimo del clúster y el keyring de ese cliente en una carpeta `ceph/` junto a `docker-compose.yml`. El script de instalación ofrece crearlos en una instalación nueva, cuando `ceph` funciona con permisos de administrador en la máquina donde lo ejecutas. Si no, o para añadirlos más tarde, en un nodo de administración de Ceph:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Si el agente se ejecuta en otra máquina, copia los dos archivos a su carpeta `ceph/` de la misma forma. **Nunca pongas ahí el keyring de administrador.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Las caps del cliente son el límite estricto.** Con estas caps de lectura, nada de lo que ejecuta puede cambiar el clúster. Las correcciones (volver a marcar un OSD como in, quitar `noout`) también necesitan `ONEUPTIME_AI_ALLOW_WRITES=true` en `.env` y las caps de correcciones del README del agente.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Compruébalo: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- ¿No usas OneUptime AI? Elimina el servicio `oneuptime-ceph-ai-agent` de `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Qué puede ejecutar y cómo funcionan las correcciones: [Agentes de IA de infraestructura](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a ejecutar el script de instalación. Reutiliza cada valor de tu `.env` existente (no se vuelve a preguntar nada), descarga los últimos `docker-compose.yml` y `otel-collector-config.yaml` (un archivo que editaste se conserva junto al nuevo como `<file>.bak.<timestamp>`), descarga las imágenes y vuelve a crear el agente con ellas. La carpeta `ceph/` del agente de IA se queda como está:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuración informa de la versión del recolector que fija como la **Versión del agente** del clúster. Cuando este OneUptime fija una más nueva, una señal de advertencia a su lado abre estos comandos.",
  "**Uninstall** the agent:": "**Desinstala** el agente:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Si creaste el cliente de Ceph del agente de IA, elimínalo en un nodo de administración: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` comprueba toda la cadena (el runtime de contenedores, cada endpoint de mgr incluida la trampa de activo frente a standby, el estampado del nombre del clúster, la forma del token, las métricas propias del recolector) y pregunta directamente a OneUptime si acepta tu clave de ingesta. Esa última comprobación es la que más importa: los endpoints OTLP de OneUptime rechazan una clave incorrecta con `401` o `422`, lo que el recolector registra como una sola línea `Exporting failed` por lote, fácil de pasar por alto, así que el script consulta `GET /otlp/v1/validate` para obtener un veredicto directo 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un veredicto que nombra la causa más probable.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Revisa los registros del recolector: `docker logs oneuptime-ceph-agent`; busca errores de exportación (`401` significa una clave de ingesta incorrecta, connection refused significa una `ONEUPTIME_URL` incorrecta).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Comprueba que un endpoint de mgr sirve métricas: `curl http://<active-mgr>:9283/metrics | head`; deberías ver líneas de métricas `ceph_*`. Si no, activa el módulo: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Asegúrate de que `CEPH_MGR_ENDPOINTS` está entre corchetes: sin ellos, el recolector trata toda la cadena separada por comas como un único objetivo (no válido).",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Comprueba que el agente se está ejecutando: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Busca errores en los registros del agente: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Comprueba que tu URL de OneUptime y tu clave de ingesta son correctas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Asegúrate de que la máquina del agente puede llegar a la instancia de OneUptime por la red.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Probablemente solo consultas el mgr (antes) activo. Lista **cada** daemon mgr en `CEPH_MGR_ENDPOINTS`: las consultas a los mgr standby son baratas y devuelven respuestas vacías.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Es lo esperado si `mgr/prometheus/standby_behaviour` está en `error` en tu clúster: los standby responden entonces con HTTP 500. La consulta del mgr activo sigue funcionando, así que los errores son ruido; vuelve a poner el comportamiento en `default` para silenciarlos.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `CEPH_CLUSTER_NAME`, estampada en cada métrica como `ceph.cluster.name`. Corrígela en `.env` y aplícala con `docker compose up -d` en `/opt/oneuptime-ceph-agent`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Nombre del clúster**: introduce exactamente **`ceph-1`**; otro nombre registra un clúster nuevo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `CEPH_CLUSTER_NAME`, estampada en cada métrica como `ceph.cluster.name`. Este clúster es **`ceph-1`**. Corrígela en `.env` y aplícala con `docker compose up -d` en `/opt/oneuptime-ceph-agent`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "El comando ya lleva tu URL de OneUptime y tu clave de ingesta. El script pide el resto:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Descarga `docker-compose.yml` y `otel-collector-config.yaml` desde este OneUptime en una carpeta nueva:",
  "Create a `.env` file next to them:": "Crea un archivo `.env` junto a ellos:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Sustituye `my-ceph-cluster` por un nombre para este clúster, como `ceph-prod`. Es como aparece el clúster en OneUptime, así que mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Lista **cada** daemon mgr en `CEPH_MGR_ENDPOINTS`, separados por comas y entre corchetes: sin los corchetes, el recolector lee toda la lista como un único objetivo no válido.",
  "Start the agent:": "Inicia el agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose también inicia **`oneuptime-ceph-ai-agent`**, el agente de IA de OneUptime. Espera un cliente de Ceph propio; consulta **Agente de IA de OneUptime** en Avanzado, o elimina su servicio de `docker-compose.yml` si no usas OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "El agente las lee del archivo `.env` junto a `docker-compose.yml`. Después de cambiar una, aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Sí | Lista `host:port` separada por comas de **todos** los daemons mgr, entre corchetes, p. ej., `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Se conecta como su propio cliente de Ceph, `client.oneuptime-ai`, con el `ceph.conf` mínimo del clúster y el keyring de ese cliente en una carpeta `ceph/` junto a `docker-compose.yml`. En un nodo de administración de Ceph, en la carpeta del agente:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Ejecútalos en la carpeta del agente, la que contiene `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a descargar los dos archivos; tu `.env` se queda, y cualquier cambio que hicieras en uno de los archivos hay que volver a hacerlo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Después descarga las imágenes y vuelve a crear el agente, para que el recolector lea su nueva configuración:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `CEPH_CLUSTER_NAME`, estampada en cada métrica como `ceph.cluster.name`. Corrígela en `.env` y aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Esto instala el agente para **`ceph-1`**: deja `CEPH_CLUSTER_NAME` exactamente como está, o los datos se registrarán como un clúster nuevo.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `CEPH_CLUSTER_NAME`, estampada en cada métrica como `ceph.cluster.name`. Este clúster es **`ceph-1`**. Corrígela en `.env` y aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del recolector (predeterminado: `oneuptime-ceph-agent`). El agente de un segundo clúster en la misma máquina necesita nombres propios: el script de instalación nombra los contenedores de un agente nuevo según su carpeta, salvo que los establezcas tú, y los conserva cuando vuelves a ejecutar el script |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del agente de IA (predeterminado: `oneuptime-ceph-ai-agent`). El script de instalación nombra el agente de IA de un segundo clúster según su recolector (`oneuptime-ceph-ai-agent-cluster2` junto a `oneuptime-ceph-agent-cluster2`), salvo que lo establezcas tú, y lo conserva cuando vuelves a ejecutar el script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agente lee un clúster. Para un segundo clúster, instala un segundo agente en una carpeta propia, con nombres de contenedor propios, porque dos contenedores no pueden compartir nombre:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "El script nombra los contenedores según la carpeta, como `oneuptime-ceph-agent-cluster2`, salvo que establezcas sus variables, como `CEPH_AGENT_CONTAINER_NAME`. Guarda los nombres en el `.env` de ese agente, así que volver a ejecutar el script con el mismo `INSTALL_DIR` para actualizar el agente los conserva, y un agente cuyo `container_name` editaste alguna vez en `docker-compose.yml` conserva ese nombre.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Da a cada carpeta un nombre propio: Docker Compose nombra un proyecto solo según su carpeta, así que el script rechaza una carpeta que se llame como otra que ya ejecuta un agente en otro lugar. Pasa la carpeta al script de diagnóstico con `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del recolector (predeterminado: `oneuptime-ceph-agent`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del agente de IA (predeterminado: `oneuptime-ceph-ai-agent`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agente lee un clúster. Para un segundo clúster, configura un segundo agente en una carpeta propia, con nombres de contenedor propios, porque dos contenedores no pueden compartir nombre. Establécelos en el `.env` de ese agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Da a cada carpeta un nombre propio: Docker Compose nombra un proyecto solo según su carpeta, así que una segunda carpeta con el mismo nombre reemplazaría los contenedores del primer agente. No pongas los nombres en `docker-compose.yml`, que una actualización reemplaza.",
};

export default TRANSLATION;
