import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 o successivo con il plugin Docker Compose v2, su una macchina che raggiunga l'API di Proxmox VE di ogni nodo sulla porta 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Una shell di root su un nodo PVE qualsiasi, o l'interfaccia web di Proxmox, per creare un token API in sola lettura",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Idealmente una macchina fuori dal cluster, o una VM che Proxmox HA riavvia su un altro nodo: l'agente legge il cluster da un altro nodo quando uno cade, ma non quando cade la sua stessa macchina",
  "As root on any PVE node:": "Come root su un nodo PVE qualsiasi:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- La prima riga fallisce, senza danni, solo se `monitoring@pam` esiste già. I token API hanno un proprio segreto, quindi l'utente non ha bisogno né di una password né di un account di sistema.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` stampa il segreto del token: copialo subito, viene mostrato una sola volta. L'ID del token è `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Il ruolo va sia all'utente sia al token perché un token con separazione dei privilegi ottiene solo i permessi che ha anche il suo utente. Deve stare sul percorso radice `/`: pve-exporter legge lo stato di tutto il cluster, e un token limitato a un sottopercorso fallisce con `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Vai su *Datacenter → Permissions → API Tokens* e fai clic su **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Scegli (o crea) un utente, dai al token un ID come `oneuptime`, assicurati che **Privilege Separation** sia selezionato e fai clic su **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Copia l'ID del token (`user@realm!tokenname`) e il segreto: il segreto viene mostrato una sola volta.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. In *Datacenter → Permissions*, fai clic due volte su **Add** per dare al percorso `/` il ruolo **PVEAuditor**: una volta come **API Token Permission** per il token, una volta come **User Permission** per il suo utente.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Un token con separazione dei privilegi ottiene solo i permessi che ha anche il suo utente, quindi a entrambi serve il ruolo. Deve stare sul percorso radice `/`: pve-exporter legge lo stato di tutto il cluster, e un token limitato a un sottopercorso fallisce con `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Lo script chiede l'URL di OneUptime e la chiave di acquisizione, entrambi mostrati nel passaggio 1 (scegli lì una chiave perché vengano compilati qui), e poi:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Nome del cluster**: come il cluster appare in OneUptime. Dai a ogni cluster il suo e mantienilo stabile: un nome nuovo registra un cluster nuovo.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Host dell'API di Proxmox VE**: un nodo qualsiasi, ad es. `192.168.1.10`. Finché la sua API non risponde, l'agente legge il cluster dal nodo successivo dell'elenco qui sotto.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **prometheus-pve-exporter incluso**: rispondi **Y**, a meno che tu non ne esegua già uno.",
  "- **API token** — the token id and secret from the previous step.":
    "- **Token API**: l'ID e il segreto del token del passaggio precedente.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Indirizzo di ogni nodo**: l'indirizzo proprio di ogni nodo, separati da virgole, mai un IP virtuale. Con il token, lo script propone l'elenco del cluster stesso: premi Invio per accettarlo. L'agente legge il cluster da questi nodi anche quando il primo non è attivo.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **Agente IA di OneUptime**: se può applicare correzioni; rispondi **N** per mantenerlo in sola lettura.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Si installa in `/opt/oneuptime-proxmox-agent`, scrive un file `.env` con permessi `0600` e avvia tutto con Docker Compose. Eseguire di nuovo lo script riusa tutto ciò che c'è in quel `.env` invece di chiedere di nuovo, quindi è anche il modo per aggiornare.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` elenca il collector (`oneuptime-proxmox-agent`), il failover tra nodi (`oneuptime-pve-api-failover`), l'exporter incluso (`oneuptime-pve-exporter`, a meno che non usi il tuo) e l'agente IA di OneUptime (`oneuptime-proxmox-ai-agent`). Nei log del collector, cerca `Everything is ready. Begin running and processing data.` Il cluster compare poi automaticamente nella sezione **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**Agente IA di OneUptime (attivo per impostazione predefinita, in sola lettura).** Le indagini IA sono attive: permette a OneUptime AI di indagare su incidenti e avvisi di questo cluster con richieste `pvesh` in sola lettura, e non cambia nulla finché non consenti le correzioni; vedi **Agente IA di OneUptime** in Avanzato.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Richiede Proxmox VE 8.3 o successivo. Scegli una chiave di acquisizione nel passaggio 1 per mostrare i due comandi: contengono la chiave, che Proxmox VE conserva nella destinazione webhook che aggiungono.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "La pagina di ogni guest mostra poi il suo ultimo backup, e le **Raccomandazioni** del cluster propongono gli avvisi **Backup Job Failed** e **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Lo script di installazione le scrive in `/opt/oneuptime-proxmox-agent/.env`. Dopo averne cambiata una, applicala con `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variabile | Obbligatoria | Descrizione |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Sì | L'URL della tua istanza OneUptime (ad es. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Sì | La chiave di acquisizione della telemetria, quella scelta nel passaggio 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Sì | L'identificatore del cluster mostrato in OneUptime. Apposto su ogni metrica come attributo di risorsa `proxmox.cluster.name`. Mantienilo stabile: cambiarlo registra un cluster nuovo (predefinito: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Sì | Il nodo dalla cui API di Proxmox VE l'exporter legge il cluster e che l'agente IA interroga, ad es. `192.168.1.10`. Finché la sua API non risponde, entrambi usano il nodo successivo di `PVE_NODES` che risponde |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | In un cluster | L'indirizzo API proprio di ogni nodo, separati da virgole tra parentesi quadre, ad es. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Per impostazione predefinita solo `PVE_HOST`, che basta per un singolo nodo. L'exporter legge l'avvio all'accensione (Guest Down), la replica e la sottoscrizione solo per il nodo che interroga, quindi ogni nodo viene interrogato a turno; un nodo escluso resta invisibile. L'agente legge il cluster anche dal successivo di essi quando `PVE_HOST` cade. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | No | Indirizzo (`host:port`, senza schema) di prometheus-pve-exporter. Per impostazione predefinita, l'exporter incluso (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Exporter incluso e agente IA | ID completo del token API di Proxmox, ad es. `monitoring@pam!oneuptime` (PVEAuditor, sola lettura) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Exporter incluso e agente IA | Segreto del token API di Proxmox |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | No | Verifica il certificato TLS dell'API di Proxmox (predefinito: `false`; PVE usa certificati autofirmati) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | No | Impostalo su `pve-exporter` per avviare il container dell'exporter incluso |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Le impostazioni proprie dell'agente IA di OneUptime sono in **Agente IA di OneUptime**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Quando lo script di installazione chiede **Run the bundled prometheus-pve-exporter?**, rispondi **n** e indica l'indirizzo del tuo exporter (`host:port`, senza schema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Usa un indirizzo che il container dell'agente possa raggiungere, l'IP della LAN o il nome DNS dell'host: dentro il container, `localhost` è il container stesso. Mantieni `PVE_API_TOKEN_ID` e `PVE_API_TOKEN_SECRET` in `.env` se usi l'agente IA di OneUptime, che legge l'API con quel token.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "L'agente interroga l'exporter ogni 30 secondi: i suoi collector di cluster una volta, su `PVE_HOST` (o sul nodo da cui legge il cluster mentre `PVE_HOST` non è attivo), e i suoi collector di nodo una volta per ogni nodo di `PVE_NODES`. Ogni serie porta un'etichetta `id` che identifica la risorsa: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` o `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Categoria | Metriche |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Disponibilità** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Nodo** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Guest (VM / LXC)** | `pve_guest_info`, più serie di CPU, memoria e rete sugli ID `qemu/*` e `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Archiviazione** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (alta disponibilità) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Copertura dei backup** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: i guest che nessun job di backup seleziona (non è esposto se i backup sono stati eseguiti o sono riusciti) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Avvio all'accensione** | `pve_onboot_status` per guest, che **Guest Down** legge |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replica** | Serie `pve_replication_*` per job di replica dell'archiviazione: la loro etichetta `id` è l'ID del job (ad es. `100-0`), non una risorsa |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "L'avvio all'accensione e la replica arrivano dai collector di nodo dell'exporter, che leggono solo il nodo interrogato dall'exporter: un nodo assente da `PVE_NODES` non ha né l'uno né l'altra.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Il collector suddivide anche l'etichetta `id` in tre attributi di punto dati filtrabili per uguaglianza (il processore `transform/pve-identity`): i criteri dei monitor e i filtri delle dashboard si basano su questi:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attributo | Valori | Esempio per `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` e `lxc` diventano entrambi `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Tutto ciò che segue il primo `/` di `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "L'etichetta `id` originale resta invariata.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "L'agente legge tutto il cluster tramite l'API di un solo nodo: quella di `PVE_HOST` finché risponde. Ogni 15 secondi il container `oneuptime-pve-api-failover` controlla quel nodo, e quando la sua API smette di rispondere il collector legge il cluster dal nodo successivo di `PVE_NODES` che risponde, finché `PVE_HOST` non risponde di nuovo. Con il token API in `.env` salta anche un nodo che risponde ma è isolato dalla parte del cluster che ha il quorum, la cui vista darebbe per caduti tutti gli altri nodi. L'agente IA di OneUptime fa lo stesso per ognuna delle sue chiamate. Così, quando un nodo cade, scatta **Node Offline** per quel nodo e il resto del cluster continua a segnalare.",
  "Its logs say which node the cluster is read from, and why.":
    "I suoi log indicano da quale nodo viene letto il cluster, e perché.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Ciò che non può coprire è la macchina su cui gira l'agente: se cade, tutto il cluster tace e scatta **Cluster Stopped Reporting**. Esegui l'agente fuori dal cluster, o in una VM che Proxmox HA riavvia su un altro nodo (`ha-manager add vm:<vmid>`, su archiviazione condivisa), ed esegui un solo agente per cluster: ogni agente legge tutto il cluster, quindi un secondo segnalerebbe ogni risorsa due volte. Vedi [Quando un nodo cade](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Questo è il file `otel-collector-config.yaml` completo che l'agente esegue; il file `.env` fornisce i valori `${env:...}`. Il processore `transform/pve-identity` ricava gli attributi `pve.scope` / `pve.type` / `pve.id` su cui si basano i modelli di avviso Proxmox integrati e i filtri delle dashboard: mantienilo se personalizzi la configurazione:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Per impostazione predefinita l'agente invia solo metriche, quindi la scheda **Log** del cluster resta vuota. I servizi PVE scrivono i log nel journal di systemd, e la configurazione inclusa ha un receiver `journald` commentato per `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` e `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Esegui l'agente su un nodo PVE.** Il journal è di ciascun host, quindi un agente remoto non può leggerlo, e ogni nodo invia solo il proprio. Per tenere l'agente delle metriche fuori dal cluster, esegui invece su ogni nodo un secondo collector, solo per i log.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Togli il commento al receiver `journald` e alla pipeline `logs` in `otel-collector-config.yaml`, e ai due volumi del journal in `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Cambia l'immagine del collector.** L'immagine standard non ha `journalctl` e gira come un utente che non può leggere il journal. Crea questo wrapper e fai puntare `image:` in `docker-compose.yml` a esso:",
  "4. Apply it:": "4. Applicalo:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Preferisci tenere l'immagine standard? La documentazione ha un'alternativa con `filelog` che segue `/var/log/syslog`: [Invia i log dei servizi Proxmox](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Ogni attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto sul cluster: `oneuptime.label.<dimension>=<value>` è l'etichetta `<dimension>:<value>`. Aggiungili al processor `resource` in `otel-collector-config.yaml`, accanto a `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Poi riavvia il collector perché legga la nuova configurazione:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Il cluster compare con le etichette `team:platform` e `env:production`. Le etichette si confrontano senza distinguere maiuscole e minuscole, quindi un'etichetta `Production` esistente viene riusata; l'agente non rimuove mai le etichette aggiunte nell'interfaccia di OneUptime.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` esegue anche **`oneuptime-proxmox-ai-agent`**. Mentre OneUptime AI indaga su un incidente o un avviso di questo cluster, esegue tramite esso comandi `pvesh` in sola lettura: `pvesh get /cluster/status`, lo stato attuale di un guest, i task non riusciti di un nodo. Non contiene alcun binario `pvesh`: ogni comando diventa una chiamata all'API di Proxmox VE su `PVE_HOST`. Si registra come il cluster chiamato `PROXMOX_CLUSTER_NAME` e appare nella pagina **IA → Agente IA** del cluster.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **Il token API è il limite invalicabile.** Legge con il token PVEAuditor del collector (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), che può leggere e nient'altro. Se esegui il tuo exporter e non hai un token in `.env`, aggiungine uno.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- È in **sola lettura** a meno che tu non imposti `ONEUPTIME_AI_ALLOW_WRITES=true`. Le correzioni (avviare o riavviare un guest) richiedono anche un token proprio che possa accendere e spegnere i guest, impostato come `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; il README dell'agente riporta i comandi `pveum`. Se l'agente gira in un guest di questo cluster, metti il VMID di quel guest in `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Verificalo: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Non usi OneUptime AI? Elimina il servizio `oneuptime-proxmox-ai-agent` da `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Cosa può eseguire e come funzionano le correzioni: [Agenti IA per l'infrastruttura](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Esegui di nuovo lo script di installazione. Riusa ogni valore del tuo `.env` esistente (non viene chiesto nulla di nuovo), scarica gli ultimi `docker-compose.yml` e `otel-collector-config.yaml` (un file che hai modificato viene tenuto accanto al nuovo come `<file>.bak.<timestamp>`), scarica le immagini e ricrea l'agente con esse:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "La configurazione riporta la versione del collector che fissa come **Versione dell'agente** del cluster. Quando questo OneUptime ne fissa una più recente, un segnale di avviso accanto apre questi comandi.",
  "**Uninstall** the agent:": "**Disinstalla** l'agente:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Poi elimina il token API in *Datacenter → Permissions → API Tokens* se non ti serve più.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controlla tutta la catena (runtime dei container, interrogazione dell'exporter, l'apposizione del nome del cluster, la forma del token, le metriche proprie del collector) e chiede direttamente a OneUptime se accetta la tua chiave di acquisizione. Quest'ultimo controllo è il più importante: gli endpoint OTLP di OneUptime rifiutano una chiave errata con `401` o `422`, che il collector registra come una sola riga `Exporting failed` per batch, facile da non notare, quindi lo script interroga `GET /otlp/v1/validate` per un verdetto diretto 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Termina con un verdetto che nomina la causa più probabile.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Verifica che l'agente sia in esecuzione (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Cerca errori nei log dell'agente: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Verifica che l'URL di OneUptime e la chiave di acquisizione siano corretti.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Assicurati che la macchina dell'agente possa raggiungere l'istanza OneUptime in rete.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Verifica che l'exporter risponda. L'exporter incluso non pubblica la sua porta sull'host, quindi esegui curl nel suo namespace di rete: dovresti vedere righe di metriche `pve_*` (per il tuo exporter, interroga direttamente il suo `host:9221` con curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Verifica che il token API abbia il ruolo **PVEAuditor** sul percorso `/`, sul token e sul suo utente.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Controlla nei log del collector gli errori di interrogazione o di esportazione (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "Il token API è errato o non ha i permessi necessari. Ricontrolla il formato dell'ID del token (`user@realm!tokenname`), il segreto, e che il ruolo **PVEAuditor** sia concesso sul percorso `/` al token e al suo utente. I log dell'exporter stesso mostrano la risposta dell'API: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Le serie dei guest (ID `qemu/*`, `lxc/*`) arrivano dal collector di cluster dell\'exporter. La configurazione inclusa lo attiva (il parametro di interrogazione `cluster=1`): se hai personalizzato la configurazione, ripristina il parametro `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "I loro flag di avvio all'accensione e i loro job di replica arrivano dal nodo su cui girano, e l'agente legge solo i nodi di `PVE_NODES`. Elenca lì l'indirizzo proprio di ogni nodo, come `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, e applicalo con `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. Se il collector smette di avviarsi dopo una modifica, l'elenco ha perso le parentesi quadre. `troubleshoot.sh` controlla ogni nodo dell'elenco.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `PROXMOX_CLUSTER_NAME`, apposto su ogni metrica come `proxmox.cluster.name`. Correggilo in `.env` e applicalo con `docker compose up -d` in `/opt/oneuptime-proxmox-agent`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Nome del cluster**: inserisci esattamente **`pve-1`**; un nome diverso registra un cluster nuovo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `PROXMOX_CLUSTER_NAME`, apposto su ogni metrica come `proxmox.cluster.name`. Questo cluster è **`pve-1`**. Correggilo in `.env` e applicalo con `docker compose up -d` in `/opt/oneuptime-proxmox-agent`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Il comando contiene già l'URL di OneUptime e la chiave di acquisizione. Il resto lo chiede lo script:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Richiede Proxmox VE 8.3 o successivo. Il primo comando aggiunge una destinazione webhook chiamata `oneuptime`, che invia ogni notifica a OneUptime come log di questo cluster e conserva la chiave e il nome del cluster nei suoi segreti. Il secondo le invia tutte le notifiche. Sostituisci `my-proxmox-cluster` con il nome del cluster che hai dato all'agente, così le notifiche raggiungono lo stesso cluster.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "La pagina di ogni guest mostra poi il suo ultimo backup, e le **Raccomandazioni** del cluster propongono gli avvisi **Backup Job Failed** e **Node Fenced**. Per smettere di inviarle:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Richiede Proxmox VE 8.3 o successivo. Il primo comando aggiunge una destinazione webhook chiamata `oneuptime`, che invia ogni notifica a OneUptime come log di questo cluster e conserva la chiave e il nome del cluster nei suoi segreti. Il secondo le invia tutte le notifiche. Il comando nomina già **`pve-1`**, quindi le notifiche raggiungono questo cluster.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Scarica `docker-compose.yml` e `otel-collector-config.yaml` da questo OneUptime in una nuova cartella:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Crea un file `.env` accanto a essi: contiene il segreto del token, quindi tienilo privato con `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Sostituisci `my-proxmox-cluster` con un nome per questo cluster, ad esempio `pve-prod`. È il nome con cui il cluster appare in OneUptime, quindi mantienilo stabile: un nome nuovo registra un cluster nuovo.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Imposta `PVE_HOST` su un nodo qualsiasi del cluster: finché la sua API non risponde, l'agente legge il cluster dal nodo successivo di `PVE_NODES`, quindi non serve alcun IP virtuale.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Imposta `PVE_NODES` sull'indirizzo proprio di ogni nodo, tra parentesi quadre, mai un IP virtuale. L'exporter legge l'avvio all'accensione (Guest Down), la replica e la sottoscrizione solo per il nodo che interroga, quindi ogni nodo viene interrogato a turno; un nodo escluso resta invisibile.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Inserisci il token del passaggio precedente. `COMPOSE_PROFILES=pve-exporter` avvia anche il prometheus-pve-exporter incluso, che legge l'API con esso.",
  "Start the agent:": "Avvia l'agente:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "L'agente le legge dal file `.env` accanto a `docker-compose.yml`. Dopo averne cambiata una, applicala con `docker compose up -d` nella cartella con `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Lascia `COMPOSE_PROFILES` fuori da `.env` e indirizza invece l'agente al tuo exporter (`host:port`, senza schema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Eseguili nella cartella dell'agente, quella con `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Aggiornamento**: l'immagine del collector è fissata in `docker-compose.yml` e la sua configurazione è un file accanto, quindi scaricare l'immagine non basta a far avanzare l'agente. Scarica di nuovo entrambi i file; il tuo `.env` resta, e una modifica che avevi fatto a uno dei file va rifatta:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Poi scarica le immagini e ricrea l'agente, perché il collector legga la sua nuova configurazione:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Verifica che l'agente sia in esecuzione (nella cartella dell'agente): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Controlla nei log del collector gli errori di interrogazione o di esportazione (nella cartella dell'agente): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "I loro flag di avvio all'accensione e i loro job di replica arrivano dal nodo su cui girano, e l'agente legge solo i nodi di `PVE_NODES`. Elenca lì l'indirizzo proprio di ogni nodo, come `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`. Se il collector smette di avviarsi dopo una modifica, l'elenco ha perso le parentesi quadre. `troubleshoot.sh` controlla ogni nodo dell'elenco.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `PROXMOX_CLUSTER_NAME`, apposto su ogni metrica come `proxmox.cluster.name`. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Questo installa l'agente per **`pve-1`**: lascia `PROXMOX_CLUSTER_NAME` esattamente com'è, altrimenti i dati vengono registrati come un cluster nuovo.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "L'identità del cluster viene da `PROXMOX_CLUSTER_NAME`, apposto su ogni metrica come `proxmox.cluster.name`. Questo cluster è **`pve-1`**. Correggilo in `.env` e applicalo con `docker compose up -d` nella cartella con `docker-compose.yml`; tieni presente che un nome nuovo registra un cluster nuovo.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Nessun agente, ma meno dati.** Proxmox VE 9.0 e successivi inviano da sé a OneUptime le metriche di ogni nodo. Stato HA, avvio all'accensione (usato da **Guest Down**), copertura dei backup e replica non vengono inviati: usa lo script di installazione o Docker Compose se ti servono. Usa l'uno o l'altro per un cluster: con entrambi, ogni risorsa viene segnalata due volte.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 o successivo**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "L'interfaccia web di Proxmox, per aggiungere un server di metriche in *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Ogni nodo raggiunge `<YOUR_ONEUPTIME_HOST>` sulla porta `443`",
  "| Field | Value |": "| Campo | Valore |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (nome host) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (porta) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protocollo) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (percorso) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (intestazioni) | Il JSON qui sotto |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Aggiungilo una sola volta per il datacenter: ogni nodo del cluster invia poi le proprie metriche.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime traduce il push nelle stesse serie `pve_*` che invia l'agente. Il cluster si registra con il nome del tuo cluster Proxmox (un nodo autonomo con il suo nome di nodo) e compare nella sezione **Proxmox**, dove le pagine Nodi, Guest e Archiviazione, i grafici della panoramica, il catalogo delle metriche e i modelli di avviso per CPU, memoria e archiviazione funzionano come con l'agente.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Ogni nodo invia solo il proprio stato, quindi un nodo che cade non può segnalare da sé di essere caduto; lo segnalano per lui i nodi ancora attivi:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Risulta **Offline** nelle pagine di Proxmox circa 2 minuti dopo la sua ultima segnalazione, e **Node Offline** scatta dopo circa 5 minuti.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- Anche **Cluster Quorum at Risk** lo conta come offline; scatta circa 7–9 minuti dopo che il nodo ha smesso di segnalare, quando tutta la sua finestra di 5 minuti ha segnalazioni.",
  "- Its next report brings it back.":
    "- La sua segnalazione successiva lo riporta indietro.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "Offline significa «ha smesso di segnalare»: un `pvestatd` bloccato, un `pmxcfs` fermo o una rete interrotta verso OneUptime appaiono allo stesso modo. Un host autonomo o un intero cluster che tace non ha più nessuno che lo segnali, quindi il cluster passa invece a **Disconnesso**. Un nodo silenzioso da più di 7 giorni non viene più segnalato. Le segnalazioni sono marcate `oneuptime.proxmox.inferred=not-reporting` in Esplora metriche.",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Il cluster si registra con il nome del suo cluster Proxmox; un nodo autonomo si registra con il suo nome di nodo. Un attributo di risorsa `proxmox.cluster.name` impostato in *Resource Attributes* del server di metriche continua a essere usato al suo posto.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime traduce il push nelle serie `pve_*` che invia l'agente, quindi le pagine di Proxmox e i modelli di avviso per CPU, memoria e archiviazione funzionano senza modifiche. Le serie `proxmox_*` originali restano disponibili in Esplora metriche per tutto il resto che Proxmox VE segnala.",
  "Some alert templates need data only the agent collects:":
    "Alcuni modelli di avviso richiedono dati che raccoglie solo l'agente:",
  "| Needs the agent | Why |": "| Richiede l'agente | Perché |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| Stato HA | Non inviato: il modello **HA Resource in Error State** richiede l'agente |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Flag di avvio all'accensione | Non inviato: **Guest Down**, che avvisa solo per i guest impostati per avviarsi all'accensione, richiede l'agente |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Copertura dei backup e replica | Non inviate: **Guest Not Backed Up** e **Replication Failing** richiedono l'agente |",
  "Every node has stopped reporting, or never started.":
    "Nessun nodo segnala più, oppure nessuno ha mai iniziato.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. In *Datacenter → Metric Server*, controlla la voce OpenTelemetry: server `<YOUR_ONEUPTIME_HOST>`, porta `443`, protocollo `https`, percorso `/otlp/v1/metrics` e l'intestazione `x-oneuptime-token` con una chiave del passaggio 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Verifica che i nodi raggiungano `<YOUR_ONEUPTIME_HOST>` attraverso la rete.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Ha smesso di segnalare: un nodo non attivo, un `pvestatd` bloccato, un `pmxcfs` fermo o una rete interrotta verso OneUptime appaiono allo stesso modo. La sua segnalazione successiva lo riporta indietro. Se hai tolto il nodo dal cluster, usa **Rimuovi nodo** nella sua pagina, altrimenti resta Offline fino a 7 giorni.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Il push nativo non invia stato HA, avvio all'accensione, copertura dei backup né replica. Scegli **Script di installazione** o **Docker Compose** in cima a questa guida per eseguire invece l'agente, e rimuovi il server di metriche, perché con entrambi ogni risorsa viene segnalata due volte.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "In OneUptime questo cluster è **`pve-1`**. Se non è il nome proprio del cluster Proxmox, imposta `proxmox.cluster.name` su `pve-1` in *Resource Attributes* del server di metriche, altrimenti il push registra un nuovo cluster.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Richiede Proxmox VE 8.3 o successivo. Il primo comando aggiunge una destinazione webhook chiamata `oneuptime`, che invia ogni notifica a OneUptime come log di questo cluster e conserva la chiave e il nome del cluster nei suoi segreti. Il secondo le invia tutte le notifiche. Sostituisci `my-proxmox-cluster` con il nome con cui il cluster compare in OneUptime: il nome del suo cluster Proxmox, o il nome proprio di un nodo autonomo.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | No | Il nome del container del collector (predefinito: `oneuptime-proxmox-agent`). L'agente di un secondo cluster sulla stessa macchina ha bisogno di nomi propri: lo script di installazione dà ai container di un nuovo agente il nome della sua cartella, a meno che tu non li imposti, e li mantiene quando esegui di nuovo lo script |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | Il nome del container del sidecar di failover dell'API (predefinito: `oneuptime-pve-api-failover`). Lo script di installazione dà al sidecar di failover dell'API di un secondo cluster un nome ricavato da quello del suo collector (`oneuptime-pve-api-failover-cluster2` accanto a `oneuptime-proxmox-agent-cluster2`), a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | Il nome del container dell'exporter incluso (predefinito: `oneuptime-pve-exporter`). Lo script di installazione dà all'exporter incluso di un secondo cluster un nome ricavato da quello del suo collector (`oneuptime-pve-exporter-cluster2` accanto a `oneuptime-proxmox-agent-cluster2`), a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente IA (predefinito: `oneuptime-proxmox-ai-agent`). Lo script di installazione dà all'agente IA di un secondo cluster un nome ricavato da quello del suo collector (`oneuptime-proxmox-ai-agent-cluster2` accanto a `oneuptime-proxmox-agent-cluster2`), a meno che tu non lo imposti, e lo mantiene quando esegui di nuovo lo script |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Un agente legge un cluster. Per un secondo cluster, installa un secondo agente in una cartella sua, con nomi di container suoi, perché due container non possono condividere un nome:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Lo script dà ai container nomi ricavati dalla cartella, come `oneuptime-proxmox-agent-cluster2`, a meno che tu non imposti le loro variabili, come `PROXMOX_AGENT_CONTAINER_NAME`. Salva i nomi nel `.env` di quell'agente, quindi i nomi restano quando esegui di nuovo lo script con lo stesso `INSTALL_DIR` per aggiornare l'agente, e un agente di cui hai modificato una volta il `container_name` in `docker-compose.yml` mantiene quel nome.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Dai a ogni cartella un nome proprio: Docker Compose dà a un progetto il nome della sua sola cartella, quindi lo script rifiuta una cartella che si chiama come un'altra in cui gira già un agente altrove. Passa la cartella allo script di diagnostica con `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | No | Il nome del container del collector (predefinito: `oneuptime-proxmox-agent`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | Il nome del container del sidecar di failover dell'API (predefinito: `oneuptime-pve-api-failover`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | Il nome del container dell'exporter incluso (predefinito: `oneuptime-pve-exporter`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | Il nome del container dell'agente IA (predefinito: `oneuptime-proxmox-ai-agent`). L'agente di un secondo cluster sulla stessa macchina ne ha bisogno di uno proprio |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Un agente legge un cluster. Per un secondo cluster, configura un secondo agente in una cartella sua, con nomi di container suoi, perché due container non possono condividere un nome. Impostali nel `.env` di quell'agente:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Dai a ogni cartella un nome proprio: Docker Compose dà a un progetto il nome della sua sola cartella, quindi una seconda cartella con lo stesso nome sostituirebbe i container del primo agente. Tieni i nomi fuori da `docker-compose.yml`, che un aggiornamento sostituisce.",
};

export default TRANSLATION;
