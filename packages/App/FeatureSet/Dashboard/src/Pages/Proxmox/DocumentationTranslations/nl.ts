import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 of nieuwer met de Docker Compose v2-plugin, op een machine die de Proxmox VE-API van elk knooppunt op poort 8006 kan bereiken",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Een root-shell op een willekeurig PVE-knooppunt, of de webinterface van Proxmox, om een alleen-lezen API-token aan te maken",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Bij voorkeur een machine buiten het cluster, of een VM die Proxmox HA op een ander knooppunt herstart: de agent leest het cluster van een ander knooppunt als er een uitvalt, maar niet als zijn eigen machine uitvalt",
  "As root on any PVE node:": "Als root op een willekeurig PVE-knooppunt:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- De eerste regel mislukt alleen, en dan onschuldig, als `monitoring@pam` al bestaat. API-tokens hebben hun eigen geheim, dus de gebruiker heeft geen wachtwoord of systeemaccount nodig.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` toont het geheim van het token: kopieer het nu, het wordt maar één keer getoond. De token-ID is `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- De rol gaat zowel op de gebruiker als op het token, omdat een token met gescheiden bevoegdheden alleen de rechten krijgt die zijn gebruiker ook heeft. Hij moet op het rootpad `/` staan: pve-exporter leest de status van het hele cluster, en een token dat tot een subpad is beperkt, faalt met `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Ga naar *Datacenter → Permissions → API Tokens* en klik op **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Kies (of maak) een gebruiker, geef het token een ID zoals `oneuptime`, zorg dat **Privilege Separation** is aangevinkt en klik op **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Kopieer de token-ID (`user@realm!tokenname`) en het geheim: het geheim wordt maar één keer getoond.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Klik onder *Datacenter → Permissions* twee keer op **Add** om pad `/` de rol **PVEAuditor** te geven: één keer als **API Token Permission** voor het token, één keer als **User Permission** voor zijn gebruiker.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Een token met gescheiden bevoegdheden krijgt alleen de rechten die zijn gebruiker ook heeft, dus beide hebben de rol nodig. Hij moet op het rootpad `/` staan: pve-exporter leest de status van het hele cluster, en een token dat tot een subpad is beperkt, faalt met `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Het script vraagt om je OneUptime-URL en je ingestiesleutel, die allebei in stap 1 staan (kies daar een sleutel om ze hier ingevuld te krijgen), en daarna om:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Clusternaam**: hoe het cluster in OneUptime verschijnt. Geef elk cluster een eigen naam en houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE-API-host**: een willekeurig knooppunt, bijv. `192.168.1.10`. Zolang de API daarvan niet antwoordt, leest de agent het cluster van het volgende knooppunt in de lijst hieronder.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Meegeleverde prometheus-pve-exporter**: antwoord **Y**, tenzij je er al een draait.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-token**: de token-ID en het geheim uit de vorige stap.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Adres van elk knooppunt**: het eigen adres van elk knooppunt, gescheiden door komma's, nooit een virtueel IP. Met het token biedt het script de lijst van het cluster zelf aan: druk op Enter om die over te nemen. De agent leest het cluster ook van deze knooppunten als het eerste is uitgevallen.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI-agent**: of hij oplossingen mag toepassen; antwoord **N** om hem alleen-lezen te houden.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Het installeert in `/opt/oneuptime-proxmox-agent`, schrijft een `.env`-bestand met rechten `0600` en start alles met Docker Compose. Het script opnieuw draaien hergebruikt alles in die `.env` in plaats van opnieuw te vragen, dus zo upgrade je ook.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` toont de collector (`oneuptime-proxmox-agent`), de failover tussen knooppunten (`oneuptime-pve-api-failover`), de meegeleverde exporter (`oneuptime-pve-exporter`, tenzij je je eigen gebruikt) en de OneUptime AI-agent (`oneuptime-proxmox-ai-agent`). Zoek in de logboeken van de collector naar `Everything is ready. Begin running and processing data.` Daarna verschijnt het cluster vanzelf in het onderdeel **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI-agent (standaard aan, alleen-lezen).** AI-onderzoeken staan aan: hij laat OneUptime AI incidenten en waarschuwingen op dit cluster onderzoeken met alleen-lezen `pvesh`-verzoeken, en hij verandert niets tenzij je oplossingen toestaat; zie **OneUptime AI-agent** onder Geavanceerd.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Vereist Proxmox VE 8.3 of nieuwer. Kies in stap 1 een ingestiesleutel om de twee opdrachten te tonen: ze bevatten de sleutel, die Proxmox VE bewaart in het webhookdoel dat ze toevoegen.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "De pagina van elke gast toont dan zijn laatste back-up, en de **Aanbevelingen** van het cluster bieden de waarschuwingen **Backup Job Failed** en **Node Fenced** aan.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Het installatiescript schrijft deze naar `/opt/oneuptime-proxmox-agent/.env`. Pas na een wijziging de waarde toe met `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | De telemetrie-ingestiesleutel, die je in stap 1 hebt gekozen |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Ja | De clusteraanduiding die OneUptime toont. Op elke metriek gezet als het resourceattribuut `proxmox.cluster.name`. Houd hem stabiel: wijzigen registreert een nieuw cluster (standaard: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Ja | Het knooppunt via wiens Proxmox VE-API de exporter het cluster leest en dat de AI-agent bevraagt, bijv. `192.168.1.10`. Zolang de API daarvan niet antwoordt, gebruiken beide het volgende knooppunt in `PVE_NODES` dat wel antwoordt |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | Op een cluster | Het eigen API-adres van elk knooppunt, gescheiden door komma's tussen vierkante haken, bijv. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Standaard alleen `PVE_HOST`, wat genoeg is voor één knooppunt. De exporter leest starten bij opstarten (Guest Down), replicatie en het abonnement alleen voor het knooppunt dat hij bevraagt, dus elk knooppunt wordt om de beurt bevraagd; een weggelaten knooppunt blijft onzichtbaar. De agent leest het cluster ook van het volgende daarvan als `PVE_HOST` uitvalt. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Nee | Adres (`host:port`, zonder schema) van prometheus-pve-exporter. Standaard de meegeleverde exporter (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Meegeleverde exporter en AI-agent | Volledige ID van het Proxmox-API-token, bijv. `monitoring@pam!oneuptime` (PVEAuditor, alleen-lezen) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Meegeleverde exporter en AI-agent | Geheim van het Proxmox-API-token |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Nee | Het TLS-certificaat van de Proxmox-API controleren (standaard: `false`; PVE wordt geleverd met zelfondertekende certificaten) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Nee | Stel in op `pve-exporter` om de container van de meegeleverde exporter te starten |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "De eigen instellingen van de OneUptime AI-agent staan onder **OneUptime AI-agent**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Als het installatiescript vraagt **Run the bundled prometheus-pve-exporter?**, antwoord dan **n** en geef het adres van je exporter op (`host:port`, zonder schema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Gebruik een adres dat de container van de agent kan bereiken, het LAN-IP of de DNS-naam van de host: `localhost` is in de container de container zelf. Houd `PVE_API_TOKEN_ID` en `PVE_API_TOKEN_SECRET` in `.env` als je de OneUptime AI-agent gebruikt, die de API met dat token leest.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "De agent scrapet de exporter elke 30 seconden: zijn clustercollectors één keer, op `PVE_HOST` (of op het knooppunt waarvan hij het cluster leest zolang `PVE_HOST` is uitgevallen), en zijn knooppuntcollectors één keer voor elk knooppunt in `PVE_NODES`. Elke reeks heeft een label `id` dat de resource aanduidt: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` of `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Categorie | Metrieken |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Beschikbaarheid** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Knooppunt** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Gast (VM / LXC)** | `pve_guest_info`, plus CPU-, geheugen- en netwerkreeksen op de ID's `qemu/*` en `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Opslag** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (hoge beschikbaarheid) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Dekking van back-ups** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: gasten die geen enkele back-uptaak selecteert (of back-ups gedraaid hebben of geslaagd zijn, wordt niet gemeld) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Starten bij opstarten** | `pve_onboot_status` per gast, die **Guest Down** leest |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replicatie** | `pve_replication_*`-reeksen per opslagreplicatietaak: hun label `id` is de taak-ID (bijv. `100-0`), geen resource |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Starten bij opstarten en replicatie komen van de knooppuntcollectors van de exporter, die alleen het knooppunt lezen dat de exporter bevraagt: een knooppunt dat in `PVE_NODES` ontbreekt, heeft geen van beide.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "De collector splitst het label `id` ook op in drie op gelijkheid filterbare datapuntattributen (de processor `transform/pve-identity`); monitorcriteria en dashboardfilters matchen hierop:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attribuut | Waarden | Voorbeeld voor `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` en `lxc` worden allebei `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Alles na de eerste `/` van `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Het oorspronkelijke label `id` blijft onaangeroerd.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "De agent leest het hele cluster via de API van één knooppunt: die van `PVE_HOST`, zolang die antwoordt. Elke 15 seconden controleert de container `oneuptime-pve-api-failover` dat knooppunt, en als de API daarvan niet meer antwoordt, leest de collector het cluster van het volgende knooppunt in `PVE_NODES` dat antwoordt, tot `PVE_HOST` weer antwoordt. Met het API-token in `.env` slaat hij ook een knooppunt over dat wel antwoordt maar is afgesneden van het deel van het cluster met quorum, want vanuit dat knooppunt zouden alle andere knooppunten uitgevallen lijken. De OneUptime AI-agent doet hetzelfde bij elk van zijn aanroepen. Valt er dus een knooppunt uit, dan gaat **Node Offline** voor dat knooppunt af en blijft de rest van het cluster rapporteren.",
  "Its logs say which node the cluster is read from, and why.":
    "De logboeken ervan vermelden van welk knooppunt het cluster wordt gelezen, en waarom.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Wat het niet kan opvangen, is de machine waarop de agent draait: valt die uit, dan wordt het hele cluster stil en gaat **Cluster Stopped Reporting** af. Draai de agent buiten het cluster, of in een VM die Proxmox HA op een ander knooppunt herstart (`ha-manager add vm:<vmid>`, op gedeelde opslag), en draai één agent per cluster: elke agent leest het hele cluster, dus een tweede rapporteert elke resource dubbel. Zie [Als een knooppunt uitvalt](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Dit is de volledige `otel-collector-config.yaml` die de agent draait; het `.env`-bestand levert de waarden `${env:...}`. De processor `transform/pve-identity` leidt de attributen `pve.scope` / `pve.type` / `pve.id` af waarop de ingebouwde Proxmox-waarschuwingssjablonen en dashboardfilters steunen: laat hem staan als je de configuratie aanpast:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Standaard verstuurt de agent alleen metrieken, dus het tabblad **Logboeken** van het cluster blijft leeg. De PVE-diensten loggen naar het systemd-journal, en de meegeleverde configuratie heeft een uitgecommentarieerde receiver `journald` voor `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` en `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Draai de agent op een PVE-knooppunt.** Het journal is er per host, dus een agent op afstand kan het niet lezen, en elk knooppunt verstuurt alleen zijn eigen journal. Wil je de metriekenagent buiten het cluster houden, draai dan in plaats daarvan op elk knooppunt een tweede collector, alleen voor logboeken.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Haal het commentaar weg bij de receiver `journald` en de pipeline `logs` in `otel-collector-config.yaml`, en bij de twee journal-volumes in `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Vervang de collectorimage.** De standaardimage heeft geen `journalctl` en draait als een gebruiker die het journal niet kan lezen. Bouw deze wrapper en laat `image:` in `docker-compose.yml` ernaar verwijzen:",
  "4. Apply it:": "4. Pas het toe:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Liever de standaardimage houden? De documentatie heeft een alternatief met `filelog` dat `/var/log/syslog` volgt: [Logboeken van Proxmox-diensten versturen](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op het cluster: `oneuptime.label.<dimension>=<value>` is het label `<dimension>:<value>`. Voeg ze toe aan de processor `resource` in `otel-collector-config.yaml`, naast `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Herstart daarna de collector zodat hij de nieuwe configuratie leest:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Het cluster verschijnt met de labels `team:platform` en `env:production`. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` draait ook **`oneuptime-proxmox-ai-agent`**. Terwijl OneUptime AI een incident of waarschuwing op dit cluster onderzoekt, voert het daarmee alleen-lezen `pvesh`-opdrachten uit: `pvesh get /cluster/status`, de huidige status van een gast, de mislukte taken van een knooppunt. Er zit geen `pvesh`-programma in: elke opdracht wordt één aanroep van de Proxmox VE-API op `PVE_HOST`. Hij meldt zich aan als het cluster met de naam `PROXMOX_CLUSTER_NAME` en verschijnt op de pagina **AI → AI-agent** van het cluster.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **Het API-token is de harde grens.** Hij leest met het PVEAuditor-token van de collector (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), dat kan lezen en verder niets. Draai je je eigen exporter en heb je geen token in `.env`, voeg er dan een toe.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Hij is **alleen-lezen**, tenzij je `ONEUPTIME_AI_ALLOW_WRITES=true` instelt. Oplossingen (een gast starten of herstarten) hebben daarnaast een eigen token nodig dat gasten aan en uit mag zetten, ingesteld als `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; de README van de agent bevat de `pveum`-opdrachten. Draait de agent in een gast van dit cluster, zet de VMID van die gast dan in `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Controleer hem: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Gebruik je OneUptime AI niet? Verwijder de service `oneuptime-proxmox-ai-agent` uit `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Wat hij mag uitvoeren en hoe oplossingen werken: [AI-agents voor infrastructuur](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Upgraden**: de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Draai het installatiescript opnieuw. Het hergebruikt elke waarde in je bestaande `.env` (er wordt niets opnieuw gevraagd), downloadt de nieuwste `docker-compose.yml` en `otel-collector-config.yaml` (een bestand dat je hebt bewerkt, blijft naast het nieuwe staan als `<file>.bak.<timestamp>`), haalt de images op en maakt de agent er opnieuw mee aan:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "De configuratie meldt de collectorversie die ze vastzet als de **Agentversie** van het cluster. Zet deze OneUptime een nieuwere vast, dan opent een waarschuwingsteken ernaast deze opdrachten.",
  "**Uninstall** the agent:": "**Verwijder** de agent:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Verwijder daarna het API-token onder *Datacenter → Permissions → API Tokens* als je het niet meer nodig hebt.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controleert de hele keten (containerruntime, het scrapen van de exporter, het zetten van de clusternaam, de vorm van het token, de eigen metrieken van de collector) en vraagt OneUptime rechtstreeks of het je ingestiesleutel accepteert. Die laatste controle telt het zwaarst: de OTLP-endpoints van OneUptime weigeren een verkeerde sleutel met `401` of `422`, wat de collector per batch logt als één makkelijk te missen regel `Exporting failed`, dus vraagt het script `GET /otlp/v1/validate` om een direct oordeel 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Het eindigt met een oordeel dat de waarschijnlijkste oorzaak noemt.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Controleer of de agent draait (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Controleer de logboeken van de agent op fouten: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Controleer of je OneUptime-URL en ingestiesleutel kloppen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Zorg dat de machine van de agent de OneUptime-instantie via het netwerk kan bereiken.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Controleer of de exporter antwoordt. De meegeleverde exporter publiceert zijn poort niet op de host, dus voer curl uit in zijn netwerknamespace; je zou `pve_*`-metriekregels moeten zien (voor je eigen exporter roep je zijn `host:9221` rechtstreeks aan met curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Controleer of het API-token de rol **PVEAuditor** heeft op pad `/`, op het token en op zijn gebruiker.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Controleer de logboeken van de collector op scrape- of exportfouten (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "Het API-token is verkeerd of heeft niet de nodige rechten. Controleer opnieuw de notatie van de token-ID (`user@realm!tokenname`), het geheim, en of de rol **PVEAuditor** op pad `/` aan het token en aan zijn gebruiker is toegekend. De eigen logboeken van de exporter tonen het antwoord van de API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Gastreeksen (ID\'s `qemu/*`, `lxc/*`) komen van de clustercollector van de exporter. De meegeleverde configuratie zet hem aan (de scrapeparameter `cluster=1`); heb je de configuratie aangepast, zet de parameter `cluster: ["1"]` dan terug.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Hun vlaggen voor starten bij opstarten en hun replicatietaken komen van het knooppunt waarop ze draaien, en de agent leest alleen de knooppunten in `PVE_NODES`. Zet daar het eigen adres van elk knooppunt in, zoals `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, en pas het toe met `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. Start de collector na een wijziging niet meer, dan is de lijst haar vierkante haken kwijt. `troubleshoot.sh` controleert elk knooppunt in de lijst.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `PROXMOX_CLUSTER_NAME`, op elke metriek gezet als `proxmox.cluster.name`. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in `/opt/oneuptime-proxmox-agent`; let op: een nieuwe naam registreert een nieuw cluster.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Clusternaam**: vul precies **`pve-1`** in; een andere naam registreert een nieuw cluster.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `PROXMOX_CLUSTER_NAME`, op elke metriek gezet als `proxmox.cluster.name`. Dit cluster is **`pve-1`**. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in `/opt/oneuptime-proxmox-agent`; let op: een nieuwe naam registreert een nieuw cluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "De opdracht bevat al je OneUptime-URL en ingestiesleutel. Naar de rest vraagt het script:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Vereist Proxmox VE 8.3 of nieuwer. De eerste opdracht voegt een webhookdoel met de naam `oneuptime` toe, dat elke melding als logboekregel van dit cluster naar OneUptime stuurt en de sleutel en de naam van het cluster in zijn secrets bewaart. De tweede stuurt elke melding daarheen. Vervang `my-proxmox-cluster` door de clusternaam die je de agent hebt gegeven, zodat de meldingen hetzelfde cluster bereiken.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "De pagina van elke gast toont dan zijn laatste back-up, en de **Aanbevelingen** van het cluster bieden de waarschuwingen **Backup Job Failed** en **Node Fenced** aan. Om het versturen te stoppen:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Vereist Proxmox VE 8.3 of nieuwer. De eerste opdracht voegt een webhookdoel met de naam `oneuptime` toe, dat elke melding als logboekregel van dit cluster naar OneUptime stuurt en de sleutel en de naam van het cluster in zijn secrets bewaart. De tweede stuurt elke melding daarheen. De opdracht noemt al **`pve-1`**, dus de meldingen bereiken dit cluster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Download `docker-compose.yml` en `otel-collector-config.yaml` van deze OneUptime naar een nieuwe map:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Maak ernaast een `.env`-bestand aan; het bevat het geheim van het token, dus houd het privé met `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Vervang `my-proxmox-cluster` door een naam voor dit cluster, zoals `pve-prod`. Onder die naam verschijnt het cluster in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Stel `PVE_HOST` in op een willekeurig knooppunt van het cluster: zolang de API daarvan niet antwoordt, leest de agent het cluster van het volgende knooppunt in `PVE_NODES`, dus er is geen virtueel IP nodig.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Stel `PVE_NODES` in op het eigen adres van elk knooppunt, tussen vierkante haken, nooit een virtueel IP. De exporter leest starten bij opstarten (Guest Down), replicatie en het abonnement alleen voor het knooppunt dat hij bevraagt, dus elk knooppunt wordt om de beurt bevraagd; een weggelaten knooppunt blijft onzichtbaar.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Vul het token uit de vorige stap in. `COMPOSE_PROFILES=pve-exporter` start ook de meegeleverde prometheus-pve-exporter, die de API ermee leest.",
  "Start the agent:": "Start de agent:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "De agent leest deze uit het `.env`-bestand naast `docker-compose.yml`. Pas na een wijziging de waarde toe met `docker compose up -d` in de map met `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Laat `COMPOSE_PROFILES` weg uit `.env` en laat de agent in plaats daarvan naar je exporter wijzen (`host:port`, zonder schema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Voer deze uit in de map van de agent, die met `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Upgraden**: de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Download beide bestanden opnieuw; je `.env` blijft, en een wijziging die je in een van de bestanden had gemaakt, moet je opnieuw maken:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Haal daarna de images op en maak de agent opnieuw aan, zodat de collector zijn nieuwe configuratie leest:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Controleer of de agent draait (in de map van de agent): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Controleer de logboeken van de collector op scrape- of exportfouten (in de map van de agent): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Hun vlaggen voor starten bij opstarten en hun replicatietaken komen van het knooppunt waarop ze draaien, en de agent leest alleen de knooppunten in `PVE_NODES`. Zet daar het eigen adres van elk knooppunt in, zoals `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, en pas het toe met `docker compose up -d` in de map met `docker-compose.yml`. Start de collector na een wijziging niet meer, dan is de lijst haar vierkante haken kwijt. `troubleshoot.sh` controleert elk knooppunt in de lijst.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `PROXMOX_CLUSTER_NAME`, op elke metriek gezet als `proxmox.cluster.name`. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map met `docker-compose.yml`; let op: een nieuwe naam registreert een nieuw cluster.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dit installeert de agent voor **`pve-1`**: laat `PROXMOX_CLUSTER_NAME` precies zoals het is, anders worden de gegevens als een nieuw cluster geregistreerd.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `PROXMOX_CLUSTER_NAME`, op elke metriek gezet als `proxmox.cluster.name`. Dit cluster is **`pve-1`**. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map met `docker-compose.yml`; let op: een nieuwe naam registreert een nieuw cluster.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Geen agent, wel minder gegevens.** Proxmox VE 9.0 en nieuwer sturen de metrieken van elk knooppunt zelf naar OneUptime. HA-status, starten bij opstarten (gebruikt door **Guest Down**), dekking van back-ups en replicatie worden niet verstuurd: gebruik het installatiescript of Docker Compose als je die nodig hebt. Gebruik het een of het ander voor een cluster: met allebei wordt elke resource dubbel gerapporteerd.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 of nieuwer**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "De webinterface van Proxmox, om onder *Datacenter → Metric Server* een metriekserver toe te voegen",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Elk knooppunt kan `<YOUR_ONEUPTIME_HOST>` op poort `443` bereiken",
  "| Field | Value |": "| Veld | Waarde |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (hostnaam) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (poort) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protocol) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (pad) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (headers) | De JSON hieronder |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Voeg hem één keer toe voor het datacenter: elk knooppunt van het cluster verstuurt dan zijn eigen metrieken.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime zet de push om in dezelfde `pve_*`-reeksen die de agent verstuurt. Het cluster registreert zich onder de naam van je Proxmox-cluster (een zelfstandig knooppunt onder zijn knooppuntnaam) en verschijnt in het onderdeel **Proxmox**, waar de pagina's Knooppunten, Gasten en Opslag, de overzichtsgrafieken, de metriekencatalogus en de waarschuwingssjablonen voor CPU, geheugen en opslag net zo werken als met de agent.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Elk knooppunt verstuurt alleen zijn eigen status, dus een uitgevallen knooppunt kan zijn eigen uitval niet melden; de knooppunten die nog draaien, melden het voor hem:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Het staat ongeveer 2 minuten na zijn laatste rapport op **Offline** op de Proxmox-pagina's, en **Node Offline** gaat na ongeveer 5 minuten af.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** telt het ook als offline; die gaat ongeveer 7–9 minuten nadat het knooppunt stil werd af, zodra zijn hele venster van 5 minuten rapporten bevat.",
  "- Its next report brings it back.":
    "- Zijn volgende rapport brengt het terug.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    'Offline betekent "rapporteert niet meer": een vastgelopen `pvestatd`, een gestopte `pmxcfs` of een verbroken netwerk naar OneUptime zien er hetzelfde uit. Wordt een zelfstandige host of een heel cluster stil, dan is er niemand meer die het meldt, dus staat het cluster in plaats daarvan op **Verbinding verbroken**. Een knooppunt dat langer dan 7 dagen stil is, wordt niet meer gemeld. De rapporten zijn in de Metriekverkenner gemarkeerd met `oneuptime.proxmox.inferred=not-reporting`.',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Het cluster registreert zich onder de naam van zijn Proxmox-cluster; een zelfstandig knooppunt registreert zich onder zijn knooppuntnaam. Een resource-attribuut `proxmox.cluster.name` dat onder *Resource Attributes* van de metriekserver is ingesteld, wordt in plaats daarvan gebruikt.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime zet de push om in de `pve_*`-reeksen die de agent verstuurt, dus de Proxmox-pagina's en de waarschuwingssjablonen voor CPU, geheugen en opslag werken ongewijzigd. De oorspronkelijke `proxmox_*`-reeksen blijven in de Metriekverkenner beschikbaar voor alles wat Proxmox VE verder rapporteert.",
  "Some alert templates need data only the agent collects:":
    "Sommige waarschuwingssjablonen hebben gegevens nodig die alleen de agent verzamelt:",
  "| Needs the agent | Why |": "| Heeft de agent nodig | Waarom |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA-status | Niet verstuurd: het sjabloon **HA Resource in Error State** heeft de agent nodig |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Vlag voor starten bij opstarten | Niet verstuurd: **Guest Down**, dat alleen afgaat voor gasten die bij het opstarten moeten starten, heeft de agent nodig |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Dekking van back-ups en replicatie | Niet verstuurd: **Guest Not Backed Up** en **Replication Failing** hebben de agent nodig |",
  "Every node has stopped reporting, or never started.":
    "Geen enkel knooppunt rapporteert nog, of ze zijn er nooit mee begonnen.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Controleer onder *Datacenter → Metric Server* de OpenTelemetry-vermelding: server `<YOUR_ONEUPTIME_HOST>`, poort `443`, protocol `https`, pad `/otlp/v1/metrics` en de header `x-oneuptime-token` met een sleutel uit stap 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Controleer of de knooppunten `<YOUR_ONEUPTIME_HOST>` via het netwerk kunnen bereiken.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Het rapporteert niet meer: een uitgevallen knooppunt, een vastgelopen `pvestatd`, een gestopte `pmxcfs` of een verbroken netwerk naar OneUptime zien er hetzelfde uit. Zijn volgende rapport brengt het terug. Heb je het knooppunt uit het cluster gehaald, gebruik dan **Node verwijderen** op zijn pagina; anders blijft het tot 7 dagen Offline.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "De native push verstuurt geen HA-status, starten bij opstarten, dekking van back-ups of replicatie. Kies bovenaan deze gids **Installatiescript** of **Docker Compose** om in plaats daarvan de agent te draaien, en verwijder de metriekserver, want met allebei wordt elke resource dubbel gerapporteerd.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Dit cluster is in OneUptime **`pve-1`**. Is dat niet de eigen naam van het Proxmox-cluster, stel `proxmox.cluster.name` dan onder *Resource Attributes* van de metriekserver in op `pve-1`, anders registreert de push een nieuw cluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Vereist Proxmox VE 8.3 of nieuwer. De eerste opdracht voegt een webhookdoel met de naam `oneuptime` toe, dat elke melding als logboekregel van dit cluster naar OneUptime stuurt en de sleutel en de naam van het cluster in zijn secrets bewaart. De tweede stuurt elke melding daarheen. Vervang `my-proxmox-cluster` door de naam waaronder het cluster in OneUptime verschijnt: de naam van zijn Proxmox-cluster, of de eigen naam van een zelfstandig knooppunt.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nee | De containernaam van de collector (standaard: `oneuptime-proxmox-agent`). De agent van een tweede cluster op dezelfde machine heeft eigen namen nodig: het installatiescript noemt de containers van een nieuwe agent naar zijn map, tenzij je ze instelt, en behoudt ze wanneer je het script opnieuw draait |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nee | De containernaam van de API-failover-sidecar (standaard: `oneuptime-pve-api-failover`). Het installatiescript noemt de API-failover-sidecar van een tweede cluster naar zijn collector (`oneuptime-pve-api-failover-cluster2` naast `oneuptime-proxmox-agent-cluster2`), tenzij je hem instelt, en behoudt hem wanneer je het script opnieuw draait |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nee | De containernaam van de meegeleverde exporter (standaard: `oneuptime-pve-exporter`). Het installatiescript noemt de meegeleverde exporter van een tweede cluster naar zijn collector (`oneuptime-pve-exporter-cluster2` naast `oneuptime-proxmox-agent-cluster2`), tenzij je hem instelt, en behoudt hem wanneer je het script opnieuw draait |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nee | De containernaam van de AI-agent (standaard: `oneuptime-proxmox-ai-agent`). Het installatiescript noemt de AI-agent van een tweede cluster naar zijn collector (`oneuptime-proxmox-ai-agent-cluster2` naast `oneuptime-proxmox-agent-cluster2`), tenzij je hem instelt, en behoudt hem wanneer je het script opnieuw draait |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Eén agent leest één cluster. Installeer voor een tweede cluster een tweede agent in een eigen map, met eigen containernamen, want twee containers kunnen geen naam delen:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Het script noemt de containers naar de map, zoals `oneuptime-proxmox-agent-cluster2`, tenzij je hun variabelen instelt, zoals `PROXMOX_AGENT_CONTAINER_NAME`. Het bewaart de namen in de `.env` van die agent, dus als je het script opnieuw draait met dezelfde `INSTALL_DIR` om de agent te upgraden, blijven de namen behouden, en een agent waarvan je de `container_name` ooit in `docker-compose.yml` hebt bewerkt, behoudt die naam.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Geef elke map een eigen naam: Docker Compose noemt een project alleen naar zijn map, dus het script weigert een map die net zo heet als een map waarin elders al een agent draait. Geef de map met `-d` door aan het diagnosescript.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nee | De containernaam van de collector (standaard: `oneuptime-proxmox-agent`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nee | De containernaam van de API-failover-sidecar (standaard: `oneuptime-pve-api-failover`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nee | De containernaam van de meegeleverde exporter (standaard: `oneuptime-pve-exporter`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nee | De containernaam van de AI-agent (standaard: `oneuptime-proxmox-ai-agent`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Eén agent leest één cluster. Zet voor een tweede cluster een tweede agent op in een eigen map, met eigen containernamen, want twee containers kunnen geen naam delen. Stel ze in de `.env` van die agent in:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Geef elke map een eigen naam: Docker Compose noemt een project alleen naar zijn map, dus een tweede map met dezelfde naam zou de containers van de eerste agent vervangen. Houd de namen buiten `docker-compose.yml`, dat een upgrade vervangt.",
};

export default TRANSLATION;
