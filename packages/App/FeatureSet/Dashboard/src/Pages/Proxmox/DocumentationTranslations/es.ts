import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 o posterior con el plugin Docker Compose v2, en una máquina que llegue a la API de Proxmox VE de cada nodo en el puerto 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Una shell de root en cualquier nodo PVE, o la interfaz web de Proxmox, para crear un token de API de solo lectura",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Idealmente una máquina fuera del clúster, o una VM que Proxmox HA reinicie en otro nodo: el agente lee el clúster desde otro nodo cuando uno cae, pero no cuando cae su propia máquina",
  "As root on any PVE node:": "Como root en cualquier nodo PVE:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- La primera línea solo falla, sin consecuencias, si `monitoring@pam` ya existe. Los tokens de API llevan su propio secreto, así que el usuario no necesita contraseña ni cuenta del sistema.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` muestra el secreto del token: cópialo ahora, solo se muestra una vez. El ID del token es `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- El rol se asigna tanto al usuario como al token porque un token con separación de privilegios solo obtiene los permisos que también tiene su usuario. Debe estar en la ruta raíz `/`: pve-exporter lee el estado de todo el clúster, y un token limitado a una subruta falla con `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Ve a *Datacenter → Permissions → API Tokens* y haz clic en **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Elige (o crea) un usuario, dale al token un ID como `oneuptime`, asegúrate de que **Privilege Separation** esté marcado y haz clic en **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Copia el ID del token (`user@realm!tokenname`) y el secreto: el secreto solo se muestra una vez.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. En *Datacenter → Permissions*, haz clic dos veces en **Add** para dar a la ruta `/` el rol **PVEAuditor**: una vez como **API Token Permission** para el token y otra como **User Permission** para su usuario.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Un token con separación de privilegios solo obtiene los permisos que también tiene su usuario, así que ambos necesitan el rol. Debe estar en la ruta raíz `/`: pve-exporter lee el estado de todo el clúster, y un token limitado a una subruta falla con `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "El script pide tu URL de OneUptime y tu clave de ingesta, ambas mostradas en el paso 1 (elige ahí una clave para que se rellenen aquí), y después:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nombre del clúster**: cómo aparece el clúster en OneUptime. Da a cada clúster el suyo y mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Host de la API de Proxmox VE**: cualquier nodo, p. ej. `192.168.1.10`. Mientras su API no responda, el agente lee el clúster desde el siguiente nodo de la lista de abajo.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter incluido**: responde **Y** a menos que ya ejecutes uno.",
  "- **API token** — the token id and secret from the previous step.":
    "- **Token de API**: el ID y el secreto del token del paso anterior.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Dirección de cada nodo**: la dirección propia de cada nodo, separadas por comas, nunca una IP virtual. Con el token, el script ofrece la lista del propio clúster: pulsa Intro para aceptarla. El agente también lee el clúster desde estos nodos cuando el primero está caído.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **Agente de IA de OneUptime**: si puede aplicar correcciones; responde **N** para mantenerlo de solo lectura.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Se instala en `/opt/oneuptime-proxmox-agent`, escribe un archivo `.env` con permisos `0600` y lo inicia todo con Docker Compose. Volver a ejecutar el script reutiliza todo lo que hay en ese `.env` en lugar de volver a preguntar, así que también es la forma de actualizar.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` lista el recolector (`oneuptime-proxmox-agent`), la conmutación entre nodos (`oneuptime-pve-api-failover`), el exportador incluido (`oneuptime-pve-exporter`, salvo que uses el tuyo) y el agente de IA de OneUptime (`oneuptime-proxmox-ai-agent`). En los registros del recolector, busca `Everything is ready. Begin running and processing data.` Después, el clúster aparece automáticamente en la sección **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**Agente de IA de OneUptime (activado de forma predeterminada, solo lectura).** Las investigaciones de IA están activadas: permite que OneUptime AI investigue incidentes y alertas de este clúster con solicitudes `pvesh` de solo lectura, y no cambia nada a menos que permitas correcciones; consulta **Agente de IA de OneUptime** en Avanzado.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Requiere Proxmox VE 8.3 o posterior. Elige una clave de ingesta en el paso 1 para ver los dos comandos: llevan la clave, que Proxmox VE guarda en el destino webhook que añaden.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "La página de cada invitado muestra entonces su última copia de seguridad, y las **Recomendaciones** del clúster ofrecen las alertas **Backup Job Failed** y **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "El script de instalación las escribe en `/opt/oneuptime-proxmox-agent/.env`. Después de cambiar una, aplícala con `docker compose up -d` en `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Obligatoria | Descripción |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sí | La URL de tu instancia de OneUptime (p. ej., `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sí | La clave de ingesta de telemetría, la elegida en el paso 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Sí | El identificador del clúster que se muestra en OneUptime. Se estampa en cada métrica como el atributo de recurso `proxmox.cluster.name`. Mantenlo estable: cambiarlo registra un clúster nuevo (predeterminado: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Sí | El nodo desde cuya API de Proxmox VE el exportador lee el clúster y al que consulta el agente de IA, p. ej. `192.168.1.10`. Mientras su API no responda, ambos usan el siguiente nodo de `PVE_NODES` que sí responda |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | En un clúster | La dirección de API propia de cada nodo, separadas por comas entre corchetes, p. ej. `[192.168.1.10,192.168.1.11,192.168.1.12]`. De forma predeterminada, solo `PVE_HOST`, que basta para un único nodo. El exportador lee el inicio al arrancar (Guest Down), la replicación y la suscripción solo del nodo al que pregunta, así que se pregunta a cada nodo por turno; un nodo que se omite queda sin ver. El agente también lee el clúster desde el siguiente de ellos cuando `PVE_HOST` cae. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | No | Dirección (`host:port`, sin esquema) de prometheus-pve-exporter. De forma predeterminada, el exportador incluido (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Exportador incluido y agente de IA | ID completo del token de API de Proxmox, p. ej. `monitoring@pam!oneuptime` (PVEAuditor, solo lectura) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Exportador incluido y agente de IA | Secreto del token de API de Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | No | Verificar el certificado TLS de la API de Proxmox (predeterminado: `false`; PVE trae certificados autofirmados) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | No | Establécelo en `pve-exporter` para iniciar el contenedor del exportador incluido |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Los ajustes propios del agente de IA de OneUptime están en **Agente de IA de OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Cuando el script de instalación pregunte **Run the bundled prometheus-pve-exporter?**, responde **n** e indica la dirección de tu exportador (`host:port`, sin esquema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Usa una dirección a la que llegue el contenedor del agente, la IP de la LAN o el nombre DNS del host: `localhost` dentro del contenedor es el propio contenedor. Conserva `PVE_API_TOKEN_ID` y `PVE_API_TOKEN_SECRET` en `.env` si usas el agente de IA de OneUptime, que lee la API con ese token.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "El agente consulta el exportador cada 30 segundos: sus recolectores de clúster una vez, en `PVE_HOST` (o en el nodo desde el que lee el clúster mientras `PVE_HOST` está caído), y sus recolectores de nodo una vez por cada nodo de `PVE_NODES`. Cada serie lleva una etiqueta `id` que identifica el recurso: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` o `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Categoría | Métricas |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Disponibilidad** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Nodo** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Invitado (VM / LXC)** | `pve_guest_info`, además de series de CPU, memoria y red en los ID `qemu/*` y `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Almacenamiento** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (alta disponibilidad) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Cobertura de copias de seguridad** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: invitados que ninguna tarea de copia de seguridad selecciona (no se expone si las copias se ejecutaron ni si tuvieron éxito) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Inicio al arrancar** | `pve_onboot_status` por invitado, que lee **Guest Down** |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replicación** | Series `pve_replication_*` por tarea de replicación del almacenamiento: su etiqueta `id` es el ID de la tarea (p. ej. `100-0`), no un recurso |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "El inicio al arrancar y la replicación vienen de los recolectores de nodo del exportador, que solo leen el nodo al que pregunta el exportador: un nodo que falta en `PVE_NODES` no tiene ni lo uno ni lo otro.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "El recolector también divide la etiqueta `id` en tres atributos de punto de datos filtrables por igualdad (el procesador `transform/pve-identity`); los criterios de los monitores y los filtros de los paneles se basan en ellos:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Atributo | Valores | Ejemplo para `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` y `lxc` se convierten ambos en `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Todo lo que va tras la primera `/` de `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "La etiqueta `id` original se conserva intacta.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "El agente lee todo el clúster a través de la API de un solo nodo: la de `PVE_HOST` mientras responda. Cada 15 segundos, el contenedor `oneuptime-pve-api-failover` comprueba ese nodo, y cuando su API deja de responder, el recolector lee el clúster desde el siguiente nodo de `PVE_NODES` que responda, hasta que `PVE_HOST` vuelva a responder. Con el token de API en `.env`, también se salta un nodo que responde pero está aislado de la parte del clúster con quórum, cuya vista daría por caídos a todos los demás nodos. El agente de IA de OneUptime hace lo mismo en cada una de sus llamadas. Así, cuando un nodo falla, **Node Offline** se dispara para él y el resto del clúster sigue informando.",
  "Its logs say which node the cluster is read from, and why.":
    "Sus registros indican desde qué nodo se lee el clúster y por qué.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Lo que no puede cubrir es la máquina en la que se ejecuta el agente: si cae, todo el clúster se queda en silencio y se dispara **Cluster Stopped Reporting**. Ejecuta el agente fuera del clúster, o en una VM que Proxmox HA reinicie en otro nodo (`ha-manager add vm:<vmid>`, en almacenamiento compartido), y ejecuta un agente por clúster: cada agente lee todo el clúster, así que un segundo informaría de cada recurso dos veces. Consulta [Cuando un nodo cae](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Este es el `otel-collector-config.yaml` completo que ejecuta el agente; el archivo `.env` aporta los valores `${env:...}`. El procesador `transform/pve-identity` deriva los atributos `pve.scope` / `pve.type` / `pve.id` en los que se basan las plantillas de alertas de Proxmox incorporadas y los filtros de los paneles; mantenlo si personalizas la configuración:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "De forma predeterminada, el agente solo envía métricas, así que la pestaña **Registros** del clúster queda vacía. Los servicios de PVE registran en el journal de systemd, y la configuración incluida tiene un receptor `journald` comentado para `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` y `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Ejecuta el agente en un nodo PVE.** El journal es de cada host, así que un agente remoto no puede leerlo, y cada nodo envía solo el suyo. Para mantener el agente de métricas fuera del clúster, ejecuta en su lugar un segundo recolector, solo para registros, en cada nodo.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Quita el comentario del receptor `journald` y del pipeline `logs` en `otel-collector-config.yaml`, y de los dos volúmenes del journal en `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Cambia la imagen del recolector.** La imagen estándar no tiene `journalctl` y se ejecuta como un usuario que no puede leer el journal. Construye este envoltorio y haz que `image:` en `docker-compose.yml` apunte a él:",
  "4. Apply it:": "4. Aplícalo:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "¿Prefieres conservar la imagen estándar? La documentación tiene una alternativa con `filelog` que sigue `/var/log/syslog`: [Enviar los registros de los servicios de Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta de proyecto en el clúster: `oneuptime.label.<dimension>=<value>` es la etiqueta `<dimension>:<value>`. Añádelos al procesador `resource` en `otel-collector-config.yaml`, junto a `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Después reinicia el recolector para que lea la nueva configuración:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "El clúster aparece con las etiquetas `team:platform` y `env:production`. Las etiquetas se comparan sin distinguir mayúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` también ejecuta **`oneuptime-proxmox-ai-agent`**. Mientras OneUptime AI investiga un incidente o una alerta de este clúster, ejecuta a través de él comandos `pvesh` de solo lectura: `pvesh get /cluster/status`, el estado actual de un invitado, las tareas fallidas de un nodo. No contiene ningún binario `pvesh`: cada comando se convierte en una llamada a la API de Proxmox VE en `PVE_HOST`. Se registra como el clúster llamado `PROXMOX_CLUSTER_NAME` y aparece en la página **IA → Agente de IA** del clúster.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **El token de API es el límite firme.** Lee con el token PVEAuditor del recolector (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), que puede leer y nada más. Si ejecutas tu propio exportador y no tienes token en `.env`, añade uno.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Es de **solo lectura** a menos que establezcas `ONEUPTIME_AI_ALLOW_WRITES=true`. Las correcciones (iniciar o reiniciar un invitado) necesitan además un token propio que pueda encender y apagar invitados, establecido como `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; el README del agente tiene los comandos `pveum`. Si el agente se ejecuta en un invitado de este clúster, pon el VMID de ese invitado en `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Compruébalo: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- ¿No usas OneUptime AI? Elimina el servicio `oneuptime-proxmox-ai-agent` de `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Qué puede ejecutar y cómo funcionan las correcciones: [Agentes de IA de infraestructura](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a ejecutar el script de instalación. Reutiliza cada valor de tu `.env` existente (no se vuelve a preguntar nada), descarga los últimos `docker-compose.yml` y `otel-collector-config.yaml` (un archivo que editaste se conserva junto al nuevo como `<file>.bak.<timestamp>`), descarga las imágenes y vuelve a crear el agente con ellas:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configuración informa de la versión del recolector que fija como la **Versión del agente** del clúster. Cuando este OneUptime fija una más nueva, una señal de advertencia a su lado abre estos comandos.",
  "**Uninstall** the agent:": "**Desinstala** el agente:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Después, elimina el token de API en *Datacenter → Permissions → API Tokens* si ya no lo necesitas.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` comprueba toda la cadena (el runtime de contenedores, la consulta al exportador, el estampado del nombre del clúster, la forma del token, las métricas propias del recolector) y pregunta directamente a OneUptime si acepta tu clave de ingesta. Esa última comprobación es la que más importa: los endpoints OTLP de OneUptime rechazan una clave incorrecta con `401` o `422`, lo que el recolector registra como una sola línea `Exporting failed` por lote, fácil de pasar por alto, así que el script pide a `GET /otlp/v1/validate` un veredicto directo 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un veredicto que nombra la causa más probable.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Comprueba que el agente se está ejecutando (en `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Busca errores en los registros del agente: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Comprueba que tu URL de OneUptime y tu clave de ingesta son correctas.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Asegúrate de que la máquina del agente puede llegar a la instancia de OneUptime por la red.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Comprueba que el exportador responde. El exportador incluido no publica su puerto en el host, así que ejecuta curl dentro de su espacio de nombres de red; deberías ver líneas de métricas `pve_*` (para tu propio exportador, consulta directamente su `host:9221` con curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Verifica que el token de API tenga el rol **PVEAuditor** en la ruta `/`, en el token y en su usuario.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Revisa los registros del recolector en busca de errores de consulta o de exportación (en `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "El token de API es incorrecto o le faltan permisos. Vuelve a comprobar el formato del ID del token (`user@realm!tokenname`), el secreto y que el rol **PVEAuditor** esté concedido en la ruta `/` al token y a su usuario. Los registros del propio exportador muestran la respuesta de la API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Las series de invitados (ID `qemu/*`, `lxc/*`) vienen del recolector de clúster del exportador. La configuración incluida lo activa (el parámetro de consulta `cluster=1`); si personalizaste la configuración, restaura el parámetro `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Sus indicadores de inicio al arrancar y sus tareas de replicación vienen del nodo en el que se ejecutan, y el agente solo lee los nodos de `PVE_NODES`. Pon ahí la dirección propia de cada nodo, como `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, y aplícalo con `docker compose up -d` en `/opt/oneuptime-proxmox-agent`. Si el recolector deja de arrancar tras una edición, la lista perdió sus corchetes. `troubleshoot.sh` comprueba cada nodo de la lista.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `PROXMOX_CLUSTER_NAME`, estampada en cada métrica como `proxmox.cluster.name`. Corrígela en `.env` y aplícala con `docker compose up -d` en `/opt/oneuptime-proxmox-agent`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Nombre del clúster**: introduce exactamente **`pve-1`**; otro nombre registra un clúster nuevo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `PROXMOX_CLUSTER_NAME`, estampada en cada métrica como `proxmox.cluster.name`. Este clúster es **`pve-1`**. Corrígela en `.env` y aplícala con `docker compose up -d` en `/opt/oneuptime-proxmox-agent`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "El comando ya lleva tu URL de OneUptime y tu clave de ingesta. El script pide el resto:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Requiere Proxmox VE 8.3 o posterior. El primer comando añade un destino webhook llamado `oneuptime`, que envía cada notificación a OneUptime como un registro de este clúster y guarda la clave y el nombre del clúster en sus secretos. El segundo le envía todas las notificaciones. Sustituye `my-proxmox-cluster` por el nombre de clúster que le diste al agente, para que las notificaciones lleguen al mismo clúster.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "La página de cada invitado muestra entonces su última copia de seguridad, y las **Recomendaciones** del clúster ofrecen las alertas **Backup Job Failed** y **Node Fenced**. Para dejar de enviarlas:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Requiere Proxmox VE 8.3 o posterior. El primer comando añade un destino webhook llamado `oneuptime`, que envía cada notificación a OneUptime como un registro de este clúster y guarda la clave y el nombre del clúster en sus secretos. El segundo le envía todas las notificaciones. El comando ya nombra **`pve-1`**, así que las notificaciones llegan a este clúster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Descarga `docker-compose.yml` y `otel-collector-config.yaml` desde este OneUptime en una carpeta nueva:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Crea un archivo `.env` junto a ellos; contiene el secreto del token, así que mantenlo privado con `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Sustituye `my-proxmox-cluster` por un nombre para este clúster, como `pve-prod`. Es como aparece el clúster en OneUptime, así que mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Establece `PVE_HOST` en cualquier nodo del clúster: mientras su API no responda, el agente lee el clúster desde el siguiente nodo de `PVE_NODES`, así que no necesita ninguna IP virtual.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Establece `PVE_NODES` en la dirección propia de cada nodo, entre corchetes, nunca una IP virtual. El exportador lee el inicio al arrancar (Guest Down), la replicación y la suscripción solo del nodo al que pregunta, así que se pregunta a cada nodo por turno; un nodo que se omite queda sin ver.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Rellena el token del paso anterior. `COMPOSE_PROFILES=pve-exporter` también inicia el prometheus-pve-exporter incluido, que lee la API con él.",
  "Start the agent:": "Inicia el agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "El agente las lee del archivo `.env` junto a `docker-compose.yml`. Después de cambiar una, aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Deja `COMPOSE_PROFILES` fuera de `.env` y, en su lugar, apunta el agente a tu exportador (`host:port`, sin esquema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Ejecútalos en la carpeta del agente, la que contiene `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Actualizar**: la imagen del recolector está fijada en `docker-compose.yml` y su configuración es un archivo a su lado, así que descargar la imagen no basta para actualizar el agente. Vuelve a descargar los dos archivos; tu `.env` se queda, y cualquier cambio que hicieras en uno de los archivos hay que volver a hacerlo:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Después descarga las imágenes y vuelve a crear el agente, para que el recolector lea su nueva configuración:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Comprueba que el agente se está ejecutando (en la carpeta del agente): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Revisa los registros del recolector en busca de errores de consulta o de exportación (en la carpeta del agente): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Sus indicadores de inicio al arrancar y sus tareas de replicación vienen del nodo en el que se ejecutan, y el agente solo lee los nodos de `PVE_NODES`. Pon ahí la dirección propia de cada nodo, como `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, y aplícalo con `docker compose up -d` en la carpeta con `docker-compose.yml`. Si el recolector deja de arrancar tras una edición, la lista perdió sus corchetes. `troubleshoot.sh` comprueba cada nodo de la lista.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `PROXMOX_CLUSTER_NAME`, estampada en cada métrica como `proxmox.cluster.name`. Corrígela en `.env` y aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Esto instala el agente para **`pve-1`**: deja `PROXMOX_CLUSTER_NAME` exactamente como está, o los datos se registrarán como un clúster nuevo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "La identidad del clúster viene de `PROXMOX_CLUSTER_NAME`, estampada en cada métrica como `proxmox.cluster.name`. Este clúster es **`pve-1`**. Corrígela en `.env` y aplícala con `docker compose up -d` en la carpeta que contiene `docker-compose.yml`; ten en cuenta que un nombre nuevo registra un clúster nuevo.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Sin agente, pero con menos datos.** Proxmox VE 9.0 y posteriores envían ellos mismos las métricas de cada nodo a OneUptime. El estado de HA, el inicio al arrancar (que usa **Guest Down**), la cobertura de copias de seguridad y la replicación no se envían: usa el script de instalación o Docker Compose si los necesitas. Usa uno u otro para un clúster: con los dos, cada recurso se informa dos veces.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 o posterior**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "La interfaz web de Proxmox, para añadir un servidor de métricas en *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Cada nodo llega a `<YOUR_ONEUPTIME_HOST>` en el puerto `443`",
  "| Field | Value |": "| Campo | Valor |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (servidor) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (puerto) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protocolo) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (ruta) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (encabezados) | El JSON de abajo |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Añádelo una sola vez para el datacenter: cada nodo del clúster envía entonces sus propias métricas.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime traduce el envío a las mismas series `pve_*` que envía el agente. El clúster se registra con el nombre de tu clúster de Proxmox (un nodo independiente, con su nombre de nodo) y aparece en la sección **Proxmox**, donde las páginas Nodos, Invitados y Almacenamiento, los gráficos de la vista general, el catálogo de métricas y las plantillas de alertas de CPU, memoria y almacenamiento funcionan igual que con el agente.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Cada nodo envía solo su propio estado, así que un nodo que cae no puede informar él mismo de su caída; los nodos que siguen activos lo informan por él:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Aparece **Sin conexión** en las páginas de Proxmox unos 2 minutos después de su último informe, y **Node Offline** se dispara pasados unos 5 minutos.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** también lo cuenta como sin conexión; se dispara unos 7–9 minutos después de que el nodo se quedara en silencio, una vez que toda su ventana de 5 minutos tiene informes.",
  "- Its next report brings it back.": "- Su siguiente informe lo recupera.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "Sin conexión significa «dejó de informar»: un `pvestatd` colgado, un `pmxcfs` detenido o una red cortada hacia OneUptime se ven igual. Un host independiente o un clúster entero que se queda en silencio no tiene a nadie que lo informe, así que el clúster pasa a **Desconectado**. Un nodo en silencio durante más de 7 días deja de informarse. Estos informes se marcan con `oneuptime.proxmox.inferred=not-reporting` en el explorador de métricas.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "El clúster se registra con el nombre de su clúster de Proxmox; un nodo independiente se registra con su nombre de nodo. Un atributo de recurso `proxmox.cluster.name` definido en *Resource Attributes* del servidor de métricas se sigue usando en su lugar.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime traduce el envío a las series `pve_*` que envía el agente, así que las páginas de Proxmox y las plantillas de alertas de CPU, memoria y almacenamiento funcionan sin cambios. Las series `proxmox_*` originales siguen disponibles en el explorador de métricas para todo lo demás que informa Proxmox VE.",
  "Some alert templates need data only the agent collects:":
    "Algunas plantillas de alertas necesitan datos que solo recoge el agente:",
  "| Needs the agent | Why |": "| Necesita el agente | Por qué |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| Estado de HA | No se envía: la plantilla **HA Resource in Error State** necesita el agente |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Indicador de inicio al arrancar | No se envía: **Guest Down**, que solo avisa de invitados configurados para iniciarse al arrancar, necesita el agente |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Cobertura de copias de seguridad y replicación | No se envían: **Guest Not Backed Up** y **Replication Failing** necesitan el agente |",
  "Every node has stopped reporting, or never started.":
    "Ningún nodo informa ya, o ninguno empezó a hacerlo.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. En *Datacenter → Metric Server*, comprueba la entrada de OpenTelemetry: servidor `<YOUR_ONEUPTIME_HOST>`, puerto `443`, protocolo `https`, ruta `/otlp/v1/metrics` y el encabezado `x-oneuptime-token` con una clave del paso 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Comprueba que los nodos lleguen a `<YOUR_ONEUPTIME_HOST>` por la red.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Dejó de informar: un nodo caído, un `pvestatd` colgado, un `pmxcfs` detenido o una red cortada hacia OneUptime se ven igual. Su siguiente informe lo recupera. Si sacaste el nodo del clúster, usa **Quitar nodo** en su página; si no, sigue Sin conexión hasta 7 días.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "El envío nativo no incluye el estado de HA, el inicio al arrancar, la cobertura de copias de seguridad ni la replicación. Elige **Script de instalación** o **Docker Compose** al principio de esta guía para ejecutar el agente en su lugar, y elimina el servidor de métricas, ya que con los dos cada recurso se informa dos veces.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Este clúster es **`pve-1`** en OneUptime. Si ese no es el nombre propio del clúster de Proxmox, establece `proxmox.cluster.name` en `pve-1` en *Resource Attributes* del servidor de métricas, o el envío registrará un clúster nuevo.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Requiere Proxmox VE 8.3 o posterior. El primer comando añade un destino webhook llamado `oneuptime`, que envía cada notificación a OneUptime como un registro de este clúster y guarda la clave y el nombre del clúster en sus secretos. El segundo le envía todas las notificaciones. Sustituye `my-proxmox-cluster` por el nombre con el que aparece el clúster en OneUptime: el nombre de su clúster de Proxmox o el nombre propio de un nodo independiente.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del recolector (predeterminado: `oneuptime-proxmox-agent`). El agente de un segundo clúster en la misma máquina necesita nombres propios: el script de instalación nombra los contenedores de un agente nuevo según su carpeta, salvo que los establezcas tú, y los conserva cuando vuelves a ejecutar el script |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | El nombre del contenedor del sidecar de conmutación de la API (predeterminado: `oneuptime-pve-api-failover`). El script de instalación nombra el sidecar de conmutación de la API de un segundo clúster según su recolector (`oneuptime-pve-api-failover-cluster2` junto a `oneuptime-proxmox-agent-cluster2`), salvo que lo establezcas tú, y lo conserva cuando vuelves a ejecutar el script |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | El nombre del contenedor del exportador incluido (predeterminado: `oneuptime-pve-exporter`). El script de instalación nombra el exportador incluido de un segundo clúster según su recolector (`oneuptime-pve-exporter-cluster2` junto a `oneuptime-proxmox-agent-cluster2`), salvo que lo establezcas tú, y lo conserva cuando vuelves a ejecutar el script |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del agente de IA (predeterminado: `oneuptime-proxmox-ai-agent`). El script de instalación nombra el agente de IA de un segundo clúster según su recolector (`oneuptime-proxmox-ai-agent-cluster2` junto a `oneuptime-proxmox-agent-cluster2`), salvo que lo establezcas tú, y lo conserva cuando vuelves a ejecutar el script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agente lee un clúster. Para un segundo clúster, instala un segundo agente en una carpeta propia, con nombres de contenedor propios, porque dos contenedores no pueden compartir nombre:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "El script nombra los contenedores según la carpeta, como `oneuptime-proxmox-agent-cluster2`, salvo que establezcas sus variables, como `PROXMOX_AGENT_CONTAINER_NAME`. Guarda los nombres en el `.env` de ese agente, así que volver a ejecutar el script con el mismo `INSTALL_DIR` para actualizar el agente los conserva, y un agente cuyo `container_name` editaste alguna vez en `docker-compose.yml` conserva ese nombre.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Da a cada carpeta un nombre propio: Docker Compose nombra un proyecto solo según su carpeta, así que el script rechaza una carpeta que se llame como otra que ya ejecuta un agente en otro lugar. Pasa la carpeta al script de diagnóstico con `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del recolector (predeterminado: `oneuptime-proxmox-agent`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | El nombre del contenedor del sidecar de conmutación de la API (predeterminado: `oneuptime-pve-api-failover`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | El nombre del contenedor del exportador incluido (predeterminado: `oneuptime-pve-exporter`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | El nombre del contenedor del agente de IA (predeterminado: `oneuptime-proxmox-ai-agent`). El agente de un segundo clúster en la misma máquina necesita uno propio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agente lee un clúster. Para un segundo clúster, configura un segundo agente en una carpeta propia, con nombres de contenedor propios, porque dos contenedores no pueden compartir nombre. Establécelos en el `.env` de ese agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Da a cada carpeta un nombre propio: Docker Compose nombra un proyecto solo según su carpeta, así que una segunda carpeta con el mismo nombre reemplazaría los contenedores del primer agente. No pongas los nombres en `docker-compose.yml`, que una actualización reemplaza.",
};

export default TRANSLATION;
