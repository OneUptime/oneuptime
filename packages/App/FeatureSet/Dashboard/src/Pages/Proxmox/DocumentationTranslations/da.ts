import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginet, på en maskine, der kan nå hver nodes Proxmox VE-API på port 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "En root-shell på en vilkårlig PVE-node, eller Proxmox' webbrugerflade, til at oprette et skrivebeskyttet API-token",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Helst en maskine uden for klyngen eller en VM, som Proxmox HA genstarter på en anden node: agenten læser klyngen fra en anden node, når en node går ned, men ikke når dens egen maskine gør",
  "As root on any PVE node:": "Som root på en vilkårlig PVE-node:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- Den første linje fejler kun, og uden skade, hvis `monitoring@pam` allerede findes. API-tokens har deres egen hemmelighed, så brugeren behøver hverken adgangskode eller systemkonto.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` udskriver tokenets hemmelighed: kopiér den nu, den vises kun én gang. Token-ID'et er `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Rollen sættes på både brugeren og tokenet, fordi et token med adskilte rettigheder kun får de tilladelser, som dets bruger også har. Den skal ligge på rodstien `/`: pve-exporter læser status for hele klyngen, og et token, der er begrænset til en understi, fejler med `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Gå til *Datacenter → Permissions → API Tokens*, og klik på **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Vælg (eller opret) en bruger, giv tokenet et ID som `oneuptime`, sørg for, at **Privilege Separation** er markeret, og klik på **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Kopiér token-ID'et (`user@realm!tokenname`) og hemmeligheden: hemmeligheden vises kun én gang.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Klik under *Datacenter → Permissions* to gange på **Add** for at give stien `/` rollen **PVEAuditor**: én gang som **API Token Permission** for tokenet og én gang som **User Permission** for dets bruger.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Et token med adskilte rettigheder får kun de tilladelser, som dets bruger også har, så begge skal have rollen. Den skal ligge på rodstien `/`: pve-exporter læser status for hele klyngen, og et token, der er begrænset til en understi, fejler med `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Scriptet spørger efter din OneUptime-URL og din indtagelsesnøgle, som begge vises i trin 1 (vælg en nøgle dér for at få dem udfyldt her), og derefter efter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klyngenavn**: hvordan klyngen vises i OneUptime. Giv hver klynge sit eget, og hold det stabilt: et nyt navn registrerer en ny klynge.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE-API-vært**: en vilkårlig node, f.eks. `192.168.1.10`. Så længe dens API ikke svarer, læser agenten klyngen fra den næste node på listen nedenfor.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Medfølgende prometheus-pve-exporter**: svar **Y**, medmindre du allerede kører en.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-token**: token-ID'et og hemmeligheden fra forrige trin.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Hver nodes adresse**: hver nodes egen adresse, adskilt med kommaer, aldrig en virtuel IP. Med tokenet tilbyder scriptet klyngens egen liste: tryk på Enter for at bruge den. Agenten læser også klyngen fra disse noder, når den første er nede.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI-agent**: om den må anvende rettelser; svar **N** for at holde den skrivebeskyttet.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerer i `/opt/oneuptime-proxmox-agent`, skriver en `.env`-fil med rettighederne `0600` og starter det hele med Docker Compose. Kører du scriptet igen, genbruger det alt i den `.env` i stedet for at spørge igen, så det er også sådan, du opgraderer.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` viser collectoren (`oneuptime-proxmox-agent`), failover mellem noderne (`oneuptime-pve-api-failover`), den medfølgende exporter (`oneuptime-pve-exporter`, medmindre du bruger din egen) og OneUptime AI-agenten (`oneuptime-proxmox-ai-agent`). Kig efter `Everything is ready. Begin running and processing data.` i collectorens protokoller. Klyngen vises derefter automatisk i afsnittet **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI-agent (slået til som standard, skrivebeskyttet).** AI-undersøgelser er slået til: den lader OneUptime AI undersøge hændelser og advarsler på denne klynge med skrivebeskyttede `pvesh`-forespørgsler, og den ændrer intet, medmindre du tillader rettelser; se **OneUptime AI-agent** under Avanceret.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Kræver Proxmox VE 8.3 eller nyere. Vælg en indtagelsesnøgle i trin 1 for at vise de to kommandoer: de indeholder nøglen, som Proxmox VE gemmer i det webhook-mål, de tilføjer.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "Hver gæsts side viser derefter dens seneste backup, og klyngens **Anbefalinger** tilbyder advarslerne **Backup Job Failed** og **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Installationsscriptet skriver disse til `/opt/oneuptime-proxmox-agent/.env`. Når du har ændret en, skal du anvende den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-indtagelsesnøglen, den der blev valgt i trin 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Ja | Klyngens identifikator, som vises i OneUptime. Sat på hver metrik som ressourceattributten `proxmox.cluster.name`. Hold den stabil: ændrer du den, registreres en ny klynge (standard: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Ja | Den node, hvis Proxmox VE-API exporteren læser klyngen fra, og som AI-agenten forespørger, f.eks. `192.168.1.10`. Så længe dens API ikke svarer, bruger begge den næste node i `PVE_NODES`, der svarer |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | I en klynge | Hver nodes egen API-adresse, adskilt med kommaer i firkantede parenteser, f.eks. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Som standard kun `PVE_HOST`, hvilket er nok til en enkelt node. Exporteren læser start ved boot (Guest Down), replikering og abonnementet kun for den node, den spørger, så hver node bliver spurgt på skift; en node, der er udeladt, forbliver usynlig. Agenten læser også klyngen fra den næste af dem, når `PVE_HOST` går ned. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Nej | Adressen (`host:port`, uden skema) på prometheus-pve-exporter. Som standard den medfølgende exporter (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Medfølgende exporter og AI-agent | Fuldt ID for Proxmox-API-tokenet, f.eks. `monitoring@pam!oneuptime` (PVEAuditor, skrivebeskyttet) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Medfølgende exporter og AI-agent | Hemmeligheden for Proxmox-API-tokenet |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Nej | Bekræft Proxmox-API'ets TLS-certifikat (standard: `false`; PVE leveres med selvsignerede certifikater) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Nej | Sæt til `pve-exporter` for at starte containeren med den medfølgende exporter |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egne indstillinger står under **OneUptime AI-agent**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Når installationsscriptet spørger **Run the bundled prometheus-pve-exporter?**, så svar **n**, og angiv din exporters adresse (`host:port`, uden skema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Brug en adresse, som agentens container kan nå, værtens LAN-IP eller DNS-navn: `localhost` er inde i containeren containeren selv. Behold `PVE_API_TOKEN_ID` og `PVE_API_TOKEN_SECRET` i `.env`, hvis du bruger OneUptime AI-agenten, som læser API'et med det token.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "Agenten scraper exporteren hvert 30. sekund: dens klynge-collectors én gang, på `PVE_HOST` (eller den node, den læser klyngen fra, mens `PVE_HOST` er nede), og dens node-collectors én gang for hver node i `PVE_NODES`. Hver serie har en etiket `id`, der identificerer ressourcen: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` eller `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Kategori | Metrikker |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Tilgængelighed** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Noder** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Gæster (VM / LXC)** | `pve_guest_info` samt CPU-, hukommelses- og netværksserier på ID'erne `qemu/*` og `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Lagerplads** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (høj tilgængelighed) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Backupdækning** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: gæster, som intet backupjob vælger (om backups kørte eller lykkedes, oplyses ikke) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Start ved boot** | `pve_onboot_status` pr. gæst, som **Guest Down** læser |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replikering** | `pve_replication_*`-serier pr. replikeringsjob for lagerplads: deres etiket `id` er jobbets ID (f.eks. `100-0`), ikke en ressource |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Start ved boot og replikering kommer fra exporterens node-collectors, der kun læser den node, exporteren spørger: en node, der mangler i `PVE_NODES`, har ingen af delene.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Collectoren deler også etiketten `id` op i tre datapunktattributter, der kan filtreres på lighed (processoren `transform/pve-identity`); monitorkriterier og dashboardfiltre matcher på dem:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attribut | Værdier | Eksempel for `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` og `lxc` bliver begge til `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Alt efter den første `/` i `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Den oprindelige etiket `id` bevares uændret.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "Agenten læser hele klyngen gennem én nodes API: `PVE_HOST`'s, så længe den svarer. Hvert 15. sekund tjekker containeren `oneuptime-pve-api-failover` den node, og når dens API holder op med at svare, læser collectoren klyngen fra den næste node i `PVE_NODES`, der svarer, indtil `PVE_HOST` svarer igen. Med API-tokenet i `.env` springer den også en node over, der svarer, men er afskåret fra den del af klyngen, der har quorum, for set derfra ville alle andre noder være nede. OneUptime AI-agenten gør det samme ved hvert af sine kald. Så når en node fejler, udløses **Node Offline** for den, og resten af klyngen bliver ved med at rapportere.",
  "Its logs say which node the cluster is read from, and why.":
    "Dens protokoller fortæller, hvilken node klyngen læses fra, og hvorfor.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Det, den ikke kan dække, er den maskine, agenten kører på: går den ned, bliver hele klyngen tavs, og **Cluster Stopped Reporting** udløses. Kør agenten uden for klyngen eller i en VM, som Proxmox HA genstarter på en anden node (`ha-manager add vm:<vmid>`, på delt lagerplads), og kør én agent pr. klynge: hver agent læser hele klyngen, så en anden agent ville rapportere hver ressource to gange. Se [Når en node går ned](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Dette er den fulde `otel-collector-config.yaml`, som agenten kører; `.env`-filen leverer værdierne `${env:...}`. Processoren `transform/pve-identity` udleder attributterne `pve.scope` / `pve.type` / `pve.id`, som de indbyggede Proxmox-advarselsskabeloner og dashboardfiltre bygger på; behold den, hvis du tilpasser konfigurationen:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Som standard sender agenten kun metrikker, så klyngens fane **Protokoller** forbliver tom. PVE-tjenesterne logger til systemd-journalen, og den medfølgende konfiguration har en udkommenteret receiver `journald` til `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` og `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Kør agenten på en PVE-node.** Journalen findes pr. vært, så en fjern agent kan ikke læse den, og hver node sender kun sin egen. Vil du holde metrikagenten uden for klyngen, så kør i stedet en ekstra collector kun til protokoller på hver node.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Fjern udkommenteringen af receiveren `journald` og pipelinen `logs` i `otel-collector-config.yaml` og af de to journal-volumes i `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Skift collector-imaget ud.** Standardimaget har ingen `journalctl` og kører som en bruger, der ikke kan læse journalen. Byg denne wrapper, og lad `image:` i `docker-compose.yml` pege på den:",
  "4. Apply it:": "4. Anvend det:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Vil du hellere beholde standardimaget? Dokumentationen har et alternativ med `filelog`, der følger `/var/log/syslog`: [Send Proxmox-tjenesternes protokoller](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver et projektlabel på klyngen: `oneuptime.label.<dimension>=<value>` er labelet `<dimension>:<value>`. Tilføj dem til processoren `resource` i `otel-collector-config.yaml` ved siden af `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Genstart derefter collectoren, så den læser den nye konfiguration:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klyngen vises med labelerne `team:platform` og `env:production`. Labels sammenlignes uden hensyn til store og små bogstaver, så et eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kører også **`oneuptime-proxmox-ai-agent`**. Mens OneUptime AI undersøger en hændelse eller advarsel på denne klynge, kører den skrivebeskyttede `pvesh`-kommandoer gennem den: `pvesh get /cluster/status`, en gæsts aktuelle status, en nodes mislykkede opgaver. Der er intet `pvesh`-program i den: hver kommando bliver til ét kald til Proxmox VE-API'et på `PVE_HOST`. Den registrerer sig som klyngen med navnet `PROXMOX_CLUSTER_NAME` og vises på klyngens side **AI → AI-agent**.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API-tokenet er den faste grænse.** Den læser med collectorens PVEAuditor-token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), som kan læse og intet andet. Kører du din egen exporter og har intet token i `.env`, så tilføj et.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Den er **skrivebeskyttet**, medmindre du sætter `ONEUPTIME_AI_ALLOW_WRITES=true`. Rettelser (at starte eller genstarte en gæst) kræver desuden et eget token, der må tænde og slukke gæster, sat som `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; agentens README indeholder `pveum`-kommandoerne. Kører agenten i en gæst i denne klynge, så sæt den gæsts VMID i `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Tjek den: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Bruger du ikke OneUptime AI? Slet tjenesten `oneuptime-proxmox-ai-agent` fra `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Hvad den må køre, og hvordan rettelser virker: [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Opgrader**: collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Kør installationsscriptet igen. Det genbruger hver værdi i din eksisterende `.env` (der spørges ikke om noget igen), henter den seneste `docker-compose.yml` og `otel-collector-config.yaml` (en fil, du har redigeret, beholdes ved siden af den nye som `<file>.bak.<timestamp>`), henter imagene og genopretter agenten med dem:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterer den collector-version, den fastlåser, som klyngens **Agentversion**. Når denne OneUptime fastlåser en nyere, åbner et advarselstegn ved siden af disse kommandoer.",
  "**Uninstall** the agent:": "**Afinstallér** agenten:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Slet derefter API-tokenet under *Datacenter → Permissions → API Tokens*, hvis du ikke længere har brug for det.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` tjekker hele kæden (container-runtime, scrape af exporteren, påsætningen af klyngenavnet, tokenets form, collectorens egne metrikker) og spørger OneUptime direkte, om den accepterer din indtagelsesnøgle. Det sidste tjek betyder mest: OneUptimes OTLP-endpoints afviser en forkert nøgle med `401` eller `422`, hvilket collectoren logger som én enkelt, let overset linje `Exporting failed` pr. batch, så scriptet spørger `GET /otlp/v1/validate` om en direkte dom 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det slutter med en afgørelse, der nævner den mest sandsynlige årsag.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Tjek, at agenten kører (i `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Tjek agentens protokoller for fejl: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekræft, at din OneUptime-URL og indtagelsesnøgle er korrekte.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for, at agentens maskine kan nå OneUptime-instansen over netværket.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Tjek, at exporteren svarer. Den medfølgende exporter udgiver ikke sin port på værten, så kør curl i dens netværksnavnerum; du bør se `pve_*`-metriklinjer (for din egen exporter kalder du dens `host:9221` direkte med curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Bekræft, at API-tokenet har rollen **PVEAuditor** på stien `/`, på tokenet og på dets bruger.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Tjek collectorens protokoller for scrape- eller eksportfejl (i `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API-tokenet er forkert eller mangler tilladelser. Tjek igen token-ID'ets format (`user@realm!tokenname`), hemmeligheden, og at rollen **PVEAuditor** er givet på stien `/` til tokenet og til dets bruger. Exporterens egne protokoller viser API'ets svar: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Gæsteserier (ID\'erne `qemu/*`, `lxc/*`) kommer fra exporterens klynge-collector. Den medfølgende konfiguration slår den til (scrape-parameteren `cluster=1`); har du tilpasset konfigurationen, så gendan parameteren `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Deres flag for start ved boot og deres replikeringsjob kommer fra den node, de kører på, og agenten læser kun noderne i `PVE_NODES`. Angiv dér hver nodes egen adresse, som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, og anvend det med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`. Holder collectoren op med at starte efter en redigering, har listen mistet sine firkantede parenteser. `troubleshoot.sh` tjekker hver node på listen.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, sat på hver metrik som `proxmox.cluster.name`. Ret den i `.env`, og anvend den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; bemærk, at et nyt navn registrerer en ny klynge.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Klyngenavn**: indtast præcis **`pve-1`**; et andet navn registrerer en ny klynge.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, sat på hver metrik som `proxmox.cluster.name`. Denne klynge er **`pve-1`**. Ret den i `.env`, og anvend den med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; bemærk, at et nyt navn registrerer en ny klynge.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen indeholder allerede din OneUptime-URL og indtagelsesnøgle. Resten spørger scriptet om:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Kræver Proxmox VE 8.3 eller nyere. Den første kommando tilføjer et webhook-mål med navnet `oneuptime`, som sender hver notifikation til OneUptime som en logpost for denne klynge og gemmer nøglen og klyngens navn i sine secrets. Den anden sender hver notifikation dertil. Erstat `my-proxmox-cluster` med det klyngenavn, du gav agenten, så notifikationerne når den samme klynge.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "Hver gæsts side viser derefter dens seneste backup, og klyngens **Anbefalinger** tilbyder advarslerne **Backup Job Failed** og **Node Fenced**. Sådan holder du op med at sende dem:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Kræver Proxmox VE 8.3 eller nyere. Den første kommando tilføjer et webhook-mål med navnet `oneuptime`, som sender hver notifikation til OneUptime som en logpost for denne klynge og gemmer nøglen og klyngens navn i sine secrets. Den anden sender hver notifikation dertil. Kommandoen nævner allerede **`pve-1`**, så notifikationerne når denne klynge.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Hent `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime ned i en ny mappe:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Opret en `.env`-fil ved siden af dem; den indeholder tokenets hemmelighed, så hold den privat med `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Erstat `my-proxmox-cluster` med et navn til denne klynge, f.eks. `pve-prod`. Det er sådan, klyngen vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny klynge.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Sæt `PVE_HOST` til en vilkårlig node i klyngen: så længe dens API ikke svarer, læser agenten klyngen fra den næste node i `PVE_NODES`, så den behøver ingen virtuel IP.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Sæt `PVE_NODES` til hver nodes egen adresse, i firkantede parenteser, aldrig en virtuel IP. Exporteren læser start ved boot (Guest Down), replikering og abonnementet kun for den node, den spørger, så hver node bliver spurgt på skift; en node, der er udeladt, forbliver usynlig.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Udfyld tokenet fra forrige trin. `COMPOSE_PROFILES=pve-exporter` starter også den medfølgende prometheus-pve-exporter, som læser API'et med det.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten læser disse fra `.env`-filen ved siden af `docker-compose.yml`. Når du har ændret en, skal du anvende den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Udelad `COMPOSE_PROFILES` fra `.env`, og lad i stedet agenten pege på din exporter (`host:port`, uden skema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Opgrader**: collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Hent begge filer igen; din `.env` bliver, og en ændring, du havde lavet i en af filerne, skal laves igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent derefter imagene, og genopret agenten, så collectoren læser sin nye konfiguration:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Tjek, at agenten kører (i agentens mappe): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Tjek collectorens protokoller for scrape- eller eksportfejl (i agentens mappe): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Deres flag for start ved boot og deres replikeringsjob kommer fra den node, de kører på, og agenten læser kun noderne i `PVE_NODES`. Angiv dér hver nodes egen adresse, som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, og anvend det med `docker compose up -d` i mappen med `docker-compose.yml`. Holder collectoren op med at starte efter en redigering, har listen mistet sine firkantede parenteser. `troubleshoot.sh` tjekker hver node på listen.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, sat på hver metrik som `proxmox.cluster.name`. Ret den i `.env`, og anvend den med `docker compose up -d` i mappen med `docker-compose.yml`; bemærk, at et nyt navn registrerer en ny klynge.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dette installerer agenten for **`pve-1`**: lad `PROXMOX_CLUSTER_NAME` stå præcis, som det er, ellers registreres dataene som en ny klynge.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, sat på hver metrik som `proxmox.cluster.name`. Denne klynge er **`pve-1`**. Ret den i `.env`, og anvend den med `docker compose up -d` i mappen med `docker-compose.yml`; bemærk, at et nyt navn registrerer en ny klynge.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Ingen agent, men færre data.** Proxmox VE 9.0 og nyere sender selv hver nodes metrikker til OneUptime. HA-tilstand, start ved boot (som **Guest Down** bruger), backupdækning og replikering sendes ikke; brug installationsscriptet eller Docker Compose, hvis du har brug for dem. Brug det ene eller det andet til en klynge: kører begge, rapporteres hver ressource to gange.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 eller nyere**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Proxmox' webbrugerflade, til at tilføje en metrikserver under *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Hver node kan nå `<YOUR_ONEUPTIME_HOST>` på port `443`",
  "| Field | Value |": "| Felt | Værdi |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (værtsnavn) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (portnummer) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protokol) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (sti) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (headere) | JSON'en nedenfor |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Tilføj den én gang for datacenteret: hver node i klyngen sender derefter sine egne metrikker.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime oversætter pushet til de samme `pve_*`-serier, som agenten sender. Klyngen registrerer sig under dit Proxmox-klyngenavn (en selvstændig node under sit nodenavn) og vises i afsnittet **Proxmox**, hvor siderne Noder, Gæster og Lagerplads, oversigtens diagrammer, metrikkataloget og advarselsskabelonerne for CPU, hukommelse og lagerplads virker, som de gør med agenten.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Hver node sender kun sin egen status, så en node, der går ned, kan ikke selv melde sig nede; de noder, der stadig kører, melder det for den:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Den vises som **Offline** på Proxmox-siderne cirka 2 minutter efter sin seneste rapport, og **Node Offline** udløses efter cirka 5 minutter.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** tæller den også som offline; den udløses cirka 7–9 minutter efter, at noden blev tavs, når hele dens vindue på 5 minutter har rapporter.",
  "- Its next report brings it back.":
    "- Dens næste rapport bringer den tilbage.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    'Offline betyder "rapporterer ikke længere": en hængende `pvestatd`, en stoppet `pmxcfs` eller et afbrudt netværk til OneUptime ser ens ud. En selvstændig vært eller en hel klynge, der bliver tavs, har ingen tilbage til at melde det, så klyngen bliver i stedet **Afbrudt**. En node, der har været tavs i mere end 7 dage, meldes ikke længere. Rapporterne er markeret med `oneuptime.proxmox.inferred=not-reporting` i Metrikudforsker.',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Klyngen registrerer sig under sit Proxmox-klyngenavn; en selvstændig node registrerer sig under sit nodenavn. En ressourceattribut `proxmox.cluster.name`, der er sat under metrikserverens *Resource Attributes*, bliver ved med at blive brugt i stedet.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime oversætter pushet til de `pve_*`-serier, som agenten sender, så Proxmox-siderne og advarselsskabelonerne for CPU, hukommelse og lagerplads virker uændret. De oprindelige `proxmox_*`-serier forbliver tilgængelige i Metrikudforsker for alt andet, Proxmox VE rapporterer.",
  "Some alert templates need data only the agent collects:":
    "Nogle advarselsskabeloner har brug for data, som kun agenten indsamler:",
  "| Needs the agent | Why |": "| Kræver agenten | Hvorfor |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA-tilstand | Sendes ikke: skabelonen **HA Resource in Error State** kræver agenten |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Flag for start ved boot | Sendes ikke: **Guest Down**, der kun advarer om gæster, som skal starte ved boot, kræver agenten |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Backupdækning og replikering | Sendes ikke: **Guest Not Backed Up** og **Replication Failing** kræver agenten |",
  "Every node has stopped reporting, or never started.":
    "Alle noder er holdt op med at rapportere, eller de er aldrig begyndt.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Tjek under *Datacenter → Metric Server* OpenTelemetry-posten: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protokol `https`, sti `/otlp/v1/metrics` og headeren `x-oneuptime-token` med en nøgle fra trin 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Tjek, at noderne kan nå `<YOUR_ONEUPTIME_HOST>` over netværket.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Den er holdt op med at rapportere: en node, der er nede, en hængende `pvestatd`, en stoppet `pmxcfs` eller et afbrudt netværk til OneUptime ser ens ud. Dens næste rapport bringer den tilbage. Har du taget noden ud af klyngen, så brug **Fjern node** på dens side; ellers forbliver den Offline i op til 7 dage.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Det indbyggede push sender ikke HA-tilstand, start ved boot, backupdækning eller replikering. Vælg **Installationsscript** eller **Docker Compose** øverst i denne vejledning for at køre agenten i stedet, og fjern metrikserveren, for kører begge, rapporteres hver ressource to gange.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Denne klynge er **`pve-1`** i OneUptime. Er det ikke Proxmox-klyngens eget navn, så sæt `proxmox.cluster.name` til `pve-1` under metrikserverens *Resource Attributes*, ellers registrerer pushet en ny klynge.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Kræver Proxmox VE 8.3 eller nyere. Den første kommando tilføjer et webhook-mål med navnet `oneuptime`, som sender hver notifikation til OneUptime som en logpost for denne klynge og gemmer nøglen og klyngens navn i sine secrets. Den anden sender hver notifikation dertil. Erstat `my-proxmox-cluster` med det navn, klyngen vises under i OneUptime: dens Proxmox-klyngenavn eller en selvstændig nodes eget navn.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-proxmox-agent`). En anden klynges agent på samme maskine skal have sine egne navne: installationsscriptet navngiver en ny agents containere efter dens mappe, medmindre du angiver dem, og beholder dem, når du kører scriptet igen |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nej | API-failover-sidecarens containernavn (standard: `oneuptime-pve-api-failover`). Installationsscriptet navngiver en anden klynges API-failover-sidecar efter dens collector (`oneuptime-pve-api-failover-cluster2` ved siden af `oneuptime-proxmox-agent-cluster2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nej | Den medfølgende exporters containernavn (standard: `oneuptime-pve-exporter`). Installationsscriptet navngiver en anden klynges medfølgende exporter efter dens collector (`oneuptime-pve-exporter-cluster2` ved siden af `oneuptime-proxmox-agent-cluster2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-proxmox-ai-agent`). Installationsscriptet navngiver en anden klynges AI-agent efter dens collector (`oneuptime-proxmox-ai-agent-cluster2` ved siden af `oneuptime-proxmox-agent-cluster2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent læser én klynge. Til en anden klynge skal du installere en anden agent i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Scriptet navngiver containerne efter mappen, fx `oneuptime-proxmox-agent-cluster2`, medmindre du angiver deres variabler, fx `PROXMOX_AGENT_CONTAINER_NAME`. Det gemmer navnene i den agents `.env`, så når du kører scriptet igen med samme `INSTALL_DIR` for at opgradere agenten, beholdes navnene, og en agent, hvis `container_name` du engang redigerede i `docker-compose.yml`, beholder det navn.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så scriptet afviser en mappe, der hedder det samme som en, der allerede kører en agent et andet sted. Giv mappen til diagnosescriptet med `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-proxmox-agent`). En anden klynges agent på samme maskine skal have sit eget |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nej | API-failover-sidecarens containernavn (standard: `oneuptime-pve-api-failover`). En anden klynges agent på samme maskine skal have sit eget |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nej | Den medfølgende exporters containernavn (standard: `oneuptime-pve-exporter`). En anden klynges agent på samme maskine skal have sit eget |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-proxmox-ai-agent`). En anden klynges agent på samme maskine skal have sit eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent læser én klynge. Til en anden klynge skal du sætte en anden agent op i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn. Angiv dem i den agents `.env`:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så en anden mappe med samme navn ville erstatte den første agents containere. Hold navnene ude af `docker-compose.yml`, som en opgradering erstatter.",
};

export default TRANSLATION;
