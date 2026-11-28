import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 eller senare med pluginet Docker Compose v2, på en maskin som når varje nods Proxmox VE-API på port 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Ett root-skal på valfri PVE-nod, eller Proxmox webbgränssnitt, för att skapa en skrivskyddad API-token",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Helst en maskin utanför klustret, eller en VM som Proxmox HA startar om på en annan nod: agenten läser klustret från en annan nod när en nod går ned, men inte när dess egen maskin gör det",
  "As root on any PVE node:": "Som root på valfri PVE-nod:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- Den första raden misslyckas bara, och utan skada, om `monitoring@pam` redan finns. API-tokens har en egen hemlighet, så användaren behöver varken lösenord eller systemkonto.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` skriver ut tokenens hemlighet: kopiera den nu, den visas bara en gång. Token-ID:t är `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Rollen sätts på både användaren och token, eftersom en token med åtskilda privilegier bara får de behörigheter som dess användare också har. Den måste ligga på rotsökvägen `/`: pve-exporter läser status för hela klustret, och en token som är begränsad till en undersökväg misslyckas med `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Gå till *Datacenter → Permissions → API Tokens* och klicka på **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Välj (eller skapa) en användare, ge token ett ID som `oneuptime`, se till att **Privilege Separation** är markerat och klicka på **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Kopiera token-ID:t (`user@realm!tokenname`) och hemligheten: hemligheten visas bara en gång.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Klicka två gånger på **Add** under *Datacenter → Permissions* för att ge sökvägen `/` rollen **PVEAuditor**: en gång som **API Token Permission** för token och en gång som **User Permission** för dess användare.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "En token med åtskilda privilegier får bara de behörigheter som dess användare också har, så båda behöver rollen. Den måste ligga på rotsökvägen `/`: pve-exporter läser status för hela klustret, och en token som är begränsad till en undersökväg misslyckas med `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet frågar efter din OneUptime-URL och din intagningsnyckel, som båda visas i steg 1 (välj en nyckel där så fylls de i här), och sedan efter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klusternamn**: hur klustret visas i OneUptime. Ge varje kluster ett eget och håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE-API-värd**: valfri nod, t.ex. `192.168.1.10`. Så länge dess API inte svarar läser agenten klustret från nästa nod i listan nedan.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Medföljande prometheus-pve-exporter**: svara **Y** om du inte redan kör en.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-token**: token-ID:t och hemligheten från föregående steg.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Varje nods adress**: varje nods egen adress, kommaseparerad, aldrig en virtuell IP. Med token erbjuder skriptet klustrets egen lista: tryck på Enter för att ta den. Agenten läser också klustret från dessa noder när den första är nere.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI-agent**: om den får tillämpa korrigeringar; svara **N** för att hålla den skrivskyddad.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installeras i `/opt/oneuptime-proxmox-agent`, skriver en `.env`-fil med behörigheten `0600` och startar allt med Docker Compose. Kör du skriptet igen återanvänder det allt i den `.env` i stället för att fråga igen, så det är också så du uppgraderar.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` listar insamlaren (`oneuptime-proxmox-agent`), failover mellan noderna (`oneuptime-pve-api-failover`), den medföljande exportören (`oneuptime-pve-exporter`, om du inte använder din egen) och OneUptime AI-agenten (`oneuptime-proxmox-ai-agent`). Leta efter `Everything is ready. Begin running and processing data.` i insamlarens loggar. Klustret visas sedan automatiskt i avsnittet **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI-agent (på som standard, skrivskyddad).** AI-utredningar är på: den låter OneUptime AI utreda incidenter och larm på det här klustret med skrivskyddade `pvesh`-förfrågningar, och den ändrar ingenting om du inte tillåter korrigeringar; se **OneUptime AI-agent** under Avancerad.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Kräver Proxmox VE 8.3 eller senare. Välj en intagningsnyckel i steg 1 för att visa de två kommandona: de innehåller nyckeln, som Proxmox VE sparar i det webhook-mål de lägger till.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "Varje gästs sida visar sedan dess senaste säkerhetskopia, och klustrets **Rekommendationer** erbjuder larmen **Backup Job Failed** och **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Installationsskriptet skriver dessa till `/opt/oneuptime-proxmox-agent/.env`. När du har ändrat en tillämpar du den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-intagningsnyckeln, den som valdes i steg 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Ja | Klustrets identifierare, som visas i OneUptime. Sätts på varje mätvärde som resursattributet `proxmox.cluster.name`. Håll den stabil: ändrar du den registreras ett nytt kluster (standard: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Ja | Noden genom vars Proxmox VE-API exportören läser klustret och som AI-agenten frågar, t.ex. `192.168.1.10`. Så länge dess API inte svarar använder båda nästa nod i `PVE_NODES` som svarar |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | I ett kluster | Varje nods egen API-adress, kommaseparerad inom hakparenteser, t.ex. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Som standard bara `PVE_HOST`, vilket räcker för en enskild nod. Exportören läser start vid uppstart (Guest Down), replikering och prenumerationen bara för den nod den frågar, så varje nod frågas i tur och ordning; en nod som utelämnas förblir osynlig. Agenten läser också klustret från nästa av dem när `PVE_HOST` går ned. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Nej | Adressen (`host:port`, utan schema) till prometheus-pve-exporter. Som standard den medföljande exportören (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Medföljande exportör och AI-agent | Fullständigt ID för Proxmox-API-token, t.ex. `monitoring@pam!oneuptime` (PVEAuditor, skrivskyddad) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Medföljande exportör och AI-agent | Hemligheten för Proxmox-API-token |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Nej | Verifiera Proxmox-API:ts TLS-certifikat (standard: `false`; PVE levereras med självsignerade certifikat) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Nej | Sätt till `pve-exporter` för att starta den medföljande exportörens container |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egna inställningar finns under **OneUptime AI-agent**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "När installationsskriptet frågar **Run the bundled prometheus-pve-exporter?** svarar du **n** och anger din exportörs adress (`host:port`, utan schema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Använd en adress som agentens container når, värdens LAN-IP eller DNS-namn: `localhost` inne i containern är containern själv. Behåll `PVE_API_TOKEN_ID` och `PVE_API_TOKEN_SECRET` i `.env` om du använder OneUptime AI-agenten, som läser API:t med den token.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "Agenten skrapar exportören var 30:e sekund: dess klusterinsamlare en gång, på `PVE_HOST` (eller den nod den läser klustret från medan `PVE_HOST` är nere), och dess nodinsamlare en gång för varje nod i `PVE_NODES`. Varje serie har en etikett `id` som identifierar resursen: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` eller `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Kategori | Mätvärden |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Tillgänglighet** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Nod** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Gäst (VM / LXC)** | `pve_guest_info`, plus serier för CPU, minne och nätverk på ID:na `qemu/*` och `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Lagring** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (hög tillgänglighet) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Täckning av säkerhetskopior** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: gäster som inget säkerhetskopieringsjobb väljer (om säkerhetskopiorna kördes eller lyckades visas inte) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Start vid uppstart** | `pve_onboot_status` per gäst, som **Guest Down** läser |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replikering** | `pve_replication_*`-serier per replikeringsjobb för lagring: deras etikett `id` är jobbets ID (t.ex. `100-0`), inte en resurs |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Start vid uppstart och replikering kommer från exportörens nodinsamlare, som bara läser den nod exportören frågar: en nod som saknas i `PVE_NODES` har inget av dem.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Insamlaren delar också upp etiketten `id` i tre datapunktsattribut som kan filtreras på likhet (processorn `transform/pve-identity`); monitorkriterier och filter på instrumentpaneler matchar på dem:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attribut | Värden | Exempel för `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` och `lxc` blir båda `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Allt efter det första `/` i `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Den ursprungliga etiketten `id` behålls orörd.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "Agenten läser hela klustret genom en nods API: `PVE_HOST`:s, så länge den svarar. Var 15:e sekund kontrollerar containern `oneuptime-pve-api-failover` den noden, och när dess API slutar svara läser insamlaren klustret från nästa nod i `PVE_NODES` som svarar, tills `PVE_HOST` svarar igen. Med API-token i `.env` hoppar den också över en nod som svarar men är avskuren från den del av klustret som har kvorum, eftersom alla andra noder skulle se nere ut därifrån. OneUptime AI-agenten gör detsamma för vart och ett av sina anrop. Så när en nod fallerar utlöses **Node Offline** för den, och resten av klustret fortsätter att rapportera.",
  "Its logs say which node the cluster is read from, and why.":
    "Dess loggar visar vilken nod klustret läses från, och varför.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Det den inte kan täcka är maskinen som agenten kör på: går den ned blir hela klustret tyst och **Cluster Stopped Reporting** utlöses. Kör agenten utanför klustret, eller i en VM som Proxmox HA startar om på en annan nod (`ha-manager add vm:<vmid>`, på delad lagring), och kör en agent per kluster: varje agent läser hela klustret, så en andra agent skulle rapportera varje resurs två gånger. Se [När en nod går ned](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Det här är hela `otel-collector-config.yaml` som agenten kör; `.env`-filen ger värdena `${env:...}`. Processorn `transform/pve-identity` härleder attributen `pve.scope` / `pve.type` / `pve.id` som de inbyggda larmmallarna för Proxmox och filtren på instrumentpaneler bygger på; behåll den om du anpassar konfigurationen:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Som standard skickar agenten bara mätvärden, så klustrets flik **Loggar** förblir tom. PVE-tjänsterna loggar till systemd-journalen, och den medföljande konfigurationen har en bortkommenterad receiver `journald` för `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` och `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Kör agenten på en PVE-nod.** Journalen finns per värd, så en fjärragent kan inte läsa den, och varje nod skickar bara sin egen. Vill du hålla mätvärdesagenten utanför klustret kör du i stället en andra insamlare, bara för loggar, på varje nod.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Ta bort kommenteringen för receivern `journald` och pipelinen `logs` i `otel-collector-config.yaml`, och för de två journalvolymerna i `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Byt insamlarens image.** Standardimagen har inget `journalctl` och körs som en användare som inte kan läsa journalen. Bygg den här wrappern och låt `image:` i `docker-compose.yml` peka på den:",
  "4. Apply it:": "4. Tillämpa det:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Vill du hellre behålla standardimagen? Dokumentationen har ett alternativ med `filelog` som följer `/var/log/syslog`: [Skicka Proxmox-tjänsternas loggar](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på klustret: `oneuptime.label.<dimension>=<value>` är etiketten `<dimension>:<value>`. Lägg till dem i processorn `resource` i `otel-collector-config.yaml`, bredvid `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Starta sedan om insamlaren så att den läser den nya konfigurationen:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klustret visas med etiketterna `team:platform` och `env:production`. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kör också **`oneuptime-proxmox-ai-agent`**. Medan OneUptime AI utreder en incident eller ett larm på det här klustret kör den skrivskyddade `pvesh`-kommandon genom den: `pvesh get /cluster/status`, en gästs aktuella status, en nods misslyckade uppgifter. Det finns inget `pvesh`-program i den: varje kommando blir ett anrop till Proxmox VE-API:t på `PVE_HOST`. Den registrerar sig som klustret med namnet `PROXMOX_CLUSTER_NAME` och visas på klustrets sida **AI → AI-agent**.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API-token är den hårda gränsen.** Den läser med insamlarens PVEAuditor-token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), som kan läsa och inget annat. Kör du din egen exportör och har ingen token i `.env`, lägger du till en.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Den är **skrivskyddad** om du inte sätter `ONEUPTIME_AI_ALLOW_WRITES=true`. Korrigeringar (att starta eller starta om en gäst) kräver dessutom en egen token som får slå på och av gäster, satt som `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; agentens README har `pveum`-kommandona. Kör agenten i en gäst i det här klustret, så lägg den gästens VMID i `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Kontrollera den: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Använder du inte OneUptime AI? Ta bort tjänsten `oneuptime-proxmox-ai-agent` från `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Vad den får köra och hur korrigeringar fungerar: [AI-agenter för infrastruktur](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Uppgradera**: insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Kör installationsskriptet igen. Det återanvänder varje värde i din befintliga `.env` (inget frågas igen), laddar ned de senaste `docker-compose.yml` och `otel-collector-config.yaml` (en fil du har redigerat behålls bredvid den nya som `<file>.bak.<timestamp>`), hämtar imagearna och skapar om agenten med dem:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterar insamlarversionen den fäster som klustrets **Agentversion**. När den här OneUptime fäster en nyare öppnar en varningssymbol bredvid den de här kommandona.",
  "**Uninstall** the agent:": "**Avinstallera** agenten:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Ta sedan bort API-token under *Datacenter → Permissions → API Tokens* om du inte längre behöver den.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` kontrollerar hela kedjan (containerkörning, skrapningen av exportören, stämplingen av klusternamnet, tokenens form, insamlarens egna mätvärden) och frågar OneUptime direkt om den godtar din intagningsnyckel. Den sista kontrollen betyder mest: OneUptimes OTLP-slutpunkter avvisar en felaktig nyckel med `401` eller `422`, vilket insamlaren loggar som en enda lättmissad rad `Exporting failed` per batch, så skriptet frågar `GET /otlp/v1/validate` om ett direkt utslag 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutas med ett utslag som nämner den mest sannolika orsaken.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Kontrollera att agenten körs (i `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Kontrollera agentens loggar efter fel: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekräfta att din OneUptime-URL och intagningsnyckel är korrekta.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Se till att agentens maskin når OneUptime-instansen över nätverket.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Kontrollera att exportören svarar. Den medföljande exportören publicerar inte sin port på värden, så kör curl i dess nätverksnamnrymd; du bör se `pve_*`-rader med mätvärden (för din egen exportör anropar du dess `host:9221` direkt med curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Kontrollera att API-token har rollen **PVEAuditor** på sökvägen `/`, på token och på dess användare.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Kontrollera insamlarens loggar efter skrapnings- eller exportfel (i `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API-token är fel eller saknar behörigheter. Kontrollera igen formatet på token-ID:t (`user@realm!tokenname`), hemligheten och att rollen **PVEAuditor** är tilldelad på sökvägen `/` till token och till dess användare. Exportörens egna loggar visar API:ts svar: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Gästserier (ID:na `qemu/*`, `lxc/*`) kommer från exportörens klusterinsamlare. Den medföljande konfigurationen slår på den (skrapparametern `cluster=1`); har du anpassat konfigurationen återställer du parametern `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Deras flaggor för start vid uppstart och deras replikeringsjobb kommer från den nod de körs på, och agenten läser bara noderna i `PVE_NODES`. Ange varje nods egen adress där, som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, och tillämpa det med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`. Slutar insamlaren starta efter en ändring har listan tappat sina hakparenteser. `troubleshoot.sh` kontrollerar varje nod i listan.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `PROXMOX_CLUSTER_NAME`, som sätts på varje mätvärde som `proxmox.cluster.name`. Rätta den i `.env` och tillämpa den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; observera att ett nytt namn registrerar ett nytt kluster.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Klusternamn**: ange exakt **`pve-1`**; ett annat namn registrerar ett nytt kluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `PROXMOX_CLUSTER_NAME`, som sätts på varje mätvärde som `proxmox.cluster.name`. Det här klustret är **`pve-1`**. Rätta den i `.env` och tillämpa den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; observera att ett nytt namn registrerar ett nytt kluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandot innehåller redan din OneUptime-URL och intagningsnyckel. Resten frågar skriptet efter:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Kräver Proxmox VE 8.3 eller senare. Det första kommandot lägger till ett webhook-mål med namnet `oneuptime`, som skickar varje avisering till OneUptime som en logg för det här klustret och sparar nyckeln och klustrets namn i sina hemligheter. Det andra skickar varje avisering dit. Ersätt `my-proxmox-cluster` med det klusternamn du gav agenten, så att aviseringarna når samma kluster.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "Varje gästs sida visar sedan dess senaste säkerhetskopia, och klustrets **Rekommendationer** erbjuder larmen **Backup Job Failed** och **Node Fenced**. Så här slutar du skicka dem:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Kräver Proxmox VE 8.3 eller senare. Det första kommandot lägger till ett webhook-mål med namnet `oneuptime`, som skickar varje avisering till OneUptime som en logg för det här klustret och sparar nyckeln och klustrets namn i sina hemligheter. Det andra skickar varje avisering dit. Kommandot nämner redan **`pve-1`**, så aviseringarna når det här klustret.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Ladda ned `docker-compose.yml` och `otel-collector-config.yaml` från den här OneUptime till en ny mapp:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Skapa en `.env`-fil bredvid dem; den innehåller tokenens hemlighet, så håll den privat med `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Ersätt `my-proxmox-cluster` med ett namn på det här klustret, till exempel `pve-prod`. Det är så klustret visas i OneUptime, så håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Sätt `PVE_HOST` till valfri nod i klustret: så länge dess API inte svarar läser agenten klustret från nästa nod i `PVE_NODES`, så den behöver ingen virtuell IP.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Sätt `PVE_NODES` till varje nods egen adress, inom hakparenteser, aldrig en virtuell IP. Exportören läser start vid uppstart (Guest Down), replikering och prenumerationen bara för den nod den frågar, så varje nod frågas i tur och ordning; en nod som utelämnas förblir osynlig.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Fyll i token från föregående steg. `COMPOSE_PROFILES=pve-exporter` startar också den medföljande prometheus-pve-exporter, som läser API:t med den.",
  "Start the agent:": "Starta agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten läser dessa från `.env`-filen bredvid `docker-compose.yml`. När du har ändrat en tillämpar du den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Utelämna `COMPOSE_PROFILES` i `.env` och låt i stället agenten peka på din exportör (`host:port`, utan schema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kör dessa i agentens mapp, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Uppgradera**: insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Ladda ned båda filerna igen; din `.env` blir kvar, och en ändring du gjort i någon av filerna måste göras igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hämta sedan imagerna och återskapa agenten så att insamlaren läser sin nya konfiguration:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Kontrollera att agenten körs (i agentens mapp): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Kontrollera insamlarens loggar efter skrapnings- eller exportfel (i agentens mapp): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Deras flaggor för start vid uppstart och deras replikeringsjobb kommer från den nod de körs på, och agenten läser bara noderna i `PVE_NODES`. Ange varje nods egen adress där, som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, och tillämpa det med `docker compose up -d` i mappen med `docker-compose.yml`. Slutar insamlaren starta efter en ändring har listan tappat sina hakparenteser. `troubleshoot.sh` kontrollerar varje nod i listan.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `PROXMOX_CLUSTER_NAME`, som sätts på varje mätvärde som `proxmox.cluster.name`. Rätta den i `.env` och tillämpa den med `docker compose up -d` i mappen med `docker-compose.yml`; observera att ett nytt namn registrerar ett nytt kluster.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Det här installerar agenten för **`pve-1`**: låt `PROXMOX_CLUSTER_NAME` stå exakt som det är, annars registreras datan som ett nytt kluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `PROXMOX_CLUSTER_NAME`, som sätts på varje mätvärde som `proxmox.cluster.name`. Det här klustret är **`pve-1`**. Rätta den i `.env` och tillämpa den med `docker compose up -d` i mappen med `docker-compose.yml`; observera att ett nytt namn registrerar ett nytt kluster.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Ingen agent, men mindre data.** Proxmox VE 9.0 och senare skickar själva varje nods mätvärden till OneUptime. HA-tillstånd, start vid uppstart (som **Guest Down** använder), täckning av säkerhetskopior och replikering skickas inte; använd installationsskriptet eller Docker Compose om du behöver dem. Använd det ena eller det andra för ett kluster: med båda rapporteras varje resurs två gånger.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 eller senare**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Proxmox webbgränssnitt, för att lägga till en mätvärdesserver under *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Varje nod når `<YOUR_ONEUPTIME_HOST>` på port `443`",
  "| Field | Value |": "| Fält | Värde |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (värdnamn) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (portnummer) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protokoll) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (sökväg) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (huvuden) | JSON-koden nedan |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Lägg till den en gång för datacentret: varje nod i klustret skickar sedan sina egna mätvärden.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime översätter pushen till samma `pve_*`-serier som agenten skickar. Klustret registrerar sig under ditt Proxmox-klusternamn (en fristående nod under sitt nodnamn) och visas i avsnittet **Proxmox**, där sidorna Noder, Gäster och Lagring, översiktens diagram, mätvärdeskatalogen och larmmallarna för CPU, minne och lagring fungerar som de gör med agenten.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Varje nod skickar bara sin egen status, så en nod som går ned kan inte själv rapportera att den är nere; noderna som fortfarande körs rapporterar det åt den:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Den visas som **Offline** på Proxmox-sidorna ungefär 2 minuter efter sin senaste rapport, och **Node Offline** utlöses efter ungefär 5 minuter.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** räknar den också som offline; larmet utlöses ungefär 7–9 minuter efter att noden tystnade, när hela dess fönster på 5 minuter har rapporter.",
  "- Its next report brings it back.": "- Dess nästa rapport tar tillbaka den.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    'Offline betyder "slutade rapportera": en `pvestatd` som hänger sig, en stoppad `pmxcfs` eller ett avbrutet nätverk till OneUptime ser likadant ut. En fristående värd eller ett helt kluster som tystnar har ingen kvar som rapporterar det, så visas klustret i stället som **Frånkopplad**. En nod som har varit tyst i mer än 7 dagar rapporteras inte längre. Rapporterna är märkta `oneuptime.proxmox.inferred=not-reporting` i Mätvärdesutforskare.',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Klustret registrerar sig under sitt Proxmox-klusternamn; en fristående nod registrerar sig under sitt nodnamn. Ett resursattribut `proxmox.cluster.name` som är satt under mätvärdesserverns *Resource Attributes* fortsätter att användas i stället.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime översätter pushen till de `pve_*`-serier som agenten skickar, så Proxmox-sidorna och larmmallarna för CPU, minne och lagring fungerar oförändrat. De ursprungliga `proxmox_*`-serierna finns kvar i Mätvärdesutforskare för allt annat som Proxmox VE rapporterar.",
  "Some alert templates need data only the agent collects:":
    "Vissa larmmallar behöver data som bara agenten samlar in:",
  "| Needs the agent | Why |": "| Kräver agenten | Varför |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA-tillstånd | Skickas inte: mallen **HA Resource in Error State** kräver agenten |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Flagga för start vid uppstart | Skickas inte: **Guest Down**, som bara larmar för gäster som ska starta vid uppstart, kräver agenten |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Täckning av säkerhetskopior och replikering | Skickas inte: **Guest Not Backed Up** och **Replication Failing** kräver agenten |",
  "Every node has stopped reporting, or never started.":
    "Alla noder har slutat rapportera, eller har aldrig börjat.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Kontrollera OpenTelemetry-posten under *Datacenter → Metric Server*: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protokoll `https`, sökväg `/otlp/v1/metrics` och huvudet `x-oneuptime-token` med en nyckel från steg 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Kontrollera att noderna når `<YOUR_ONEUPTIME_HOST>` över nätverket.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Den har slutat rapportera: en nod som är nere, en `pvestatd` som hänger sig, en stoppad `pmxcfs` eller ett avbrutet nätverk till OneUptime ser likadant ut. Dess nästa rapport tar tillbaka den. Har du tagit bort noden ur klustret använder du **Ta bort nod** på dess sida; annars förblir den Offline i upp till 7 dagar.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Den inbyggda pushen skickar inte HA-tillstånd, start vid uppstart, täckning av säkerhetskopior eller replikering. Välj **Installationsskript** eller **Docker Compose** överst i den här guiden för att köra agenten i stället, och ta bort mätvärdesservern, eftersom varje resurs rapporteras två gånger med båda.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Det här klustret är **`pve-1`** i OneUptime. Är det inte Proxmox-klustrets eget namn sätter du `proxmox.cluster.name` till `pve-1` under mätvärdesserverns *Resource Attributes*, annars registrerar pushen ett nytt kluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Kräver Proxmox VE 8.3 eller senare. Det första kommandot lägger till ett webhook-mål med namnet `oneuptime`, som skickar varje avisering till OneUptime som en logg för det här klustret och sparar nyckeln och klustrets namn i sina hemligheter. Det andra skickar varje avisering dit. Ersätt `my-proxmox-cluster` med det namn klustret visas under i OneUptime: dess Proxmox-klusternamn, eller en fristående nods eget namn.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nej | Insamlarens containernamn (standard: `oneuptime-proxmox-agent`). Ett andra klusters agent på samma maskin behöver egna namn: installationsskriptet namnger en ny agents containrar efter dess mapp om du inte anger dem, och behåller dem när du kör skriptet igen |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nej | API-failover-sidecarens containernamn (standard: `oneuptime-pve-api-failover`). Installationsskriptet namnger ett andra klusters API-failover-sidecar efter dess insamlare (`oneuptime-pve-api-failover-cluster2` bredvid `oneuptime-proxmox-agent-cluster2`) om du inte anger det, och behåller det när du kör skriptet igen |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nej | Den medföljande exportörens containernamn (standard: `oneuptime-pve-exporter`). Installationsskriptet namnger ett andra klusters medföljande exportör efter dess insamlare (`oneuptime-pve-exporter-cluster2` bredvid `oneuptime-proxmox-agent-cluster2`) om du inte anger det, och behåller det när du kör skriptet igen |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernamn (standard: `oneuptime-proxmox-ai-agent`). Installationsskriptet namnger ett andra klusters AI-agent efter dess insamlare (`oneuptime-proxmox-ai-agent-cluster2` bredvid `oneuptime-proxmox-agent-cluster2`) om du inte anger det, och behåller det när du kör skriptet igen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "En agent läser ett kluster. För ett andra kluster installerar du en andra agent i en egen mapp, med egna containernamn, eftersom två containrar inte kan dela ett namn:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Skriptet namnger containrarna efter mappen, till exempel `oneuptime-proxmox-agent-cluster2`, om du inte anger deras variabler, till exempel `PROXMOX_AGENT_CONTAINER_NAME`. Det sparar namnen i den agentens `.env`, så namnen behålls när du kör skriptet igen med samma `INSTALL_DIR` för att uppgradera agenten, och en agent vars `container_name` du en gång redigerade i `docker-compose.yml` behåller det namnet.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Ge varje mapp ett eget namn: Docker Compose namnger ett projekt efter enbart dess mapp, så skriptet vägrar en mapp som heter som en som redan kör en agent någon annanstans. Skicka mappen till diagnosskriptet med `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nej | Insamlarens containernamn (standard: `oneuptime-proxmox-agent`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nej | API-failover-sidecarens containernamn (standard: `oneuptime-pve-api-failover`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nej | Den medföljande exportörens containernamn (standard: `oneuptime-pve-exporter`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernamn (standard: `oneuptime-proxmox-ai-agent`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "En agent läser ett kluster. För ett andra kluster sätter du upp en andra agent i en egen mapp, med egna containernamn, eftersom två containrar inte kan dela ett namn. Ange dem i den agentens `.env`:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Ge varje mapp ett eget namn: Docker Compose namnger ett projekt efter enbart dess mapp, så en andra mapp med samma namn skulle ersätta den första agentens containrar. Håll namnen utanför `docker-compose.yml`, som en uppgradering ersätter.",
};

export default TRANSLATION;
