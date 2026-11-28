import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginen, på en maskin som når hver nodes Proxmox VE-API på port 8006",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "Et root-skall på en hvilken som helst PVE-node, eller Proxmox' nettgrensesnitt, for å opprette et skrivebeskyttet API-token",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "Helst en maskin utenfor klyngen, eller en VM som Proxmox HA starter på nytt på en annen node: agenten leser klyngen fra en annen node når én går ned, men ikke når dens egen maskin gjør det",
  "As root on any PVE node:": "Som root på en hvilken som helst PVE-node:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- Den første linjen feiler bare, og uten skade, hvis `monitoring@pam` allerede finnes. API-tokener har sin egen hemmelighet, så brukeren trenger verken passord eller systemkonto.",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` skriver ut tokenets hemmelighet: kopier den nå, den vises bare én gang. Token-ID-en er `monitoring@pam!oneuptime`.",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- Rollen settes på både brukeren og tokenet, fordi et token med atskilte rettigheter bare får tillatelsene som brukeren også har. Den må ligge på rotstien `/`: pve-exporter leser status for hele klyngen, og et token som er begrenset til en understi, feiler med `Permission check failed (/, Sys.Audit)`.",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. Gå til *Datacenter → Permissions → API Tokens* og klikk på **Add**.",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. Velg (eller opprett) en bruker, gi tokenet en ID som `oneuptime`, sørg for at **Privilege Separation** er avkrysset, og klikk på **Add**.",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. Kopier token-ID-en (`user@realm!tokenname`) og hemmeligheten: hemmeligheten vises bare én gang.",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. Klikk på **Add** to ganger under *Datacenter → Permissions* for å gi stien `/` rollen **PVEAuditor**: én gang som **API Token Permission** for tokenet og én gang som **User Permission** for brukeren.",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "Et token med atskilte rettigheter får bare tillatelsene som brukeren også har, så begge trenger rollen. Den må ligge på rotstien `/`: pve-exporter leser status for hele klyngen, og et token som er begrenset til en understi, feiler med `Permission check failed (/, Sys.Audit)`.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet spør etter OneUptime-URL-en og inntaksnøkkelen din, som begge vises i trinn 1 (velg en nøkkel der for å få dem fylt inn her), og deretter etter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klyngenavn**: hvordan klyngen vises i OneUptime. Gi hver klynge sitt eget, og hold det stabilt: et nytt navn registrerer en ny klynge.",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE-API-vert**: en hvilken som helst node, f.eks. `192.168.1.10`. Så lenge API-et ikke svarer, leser agenten klyngen fra neste node i listen nedenfor.",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **Medfølgende prometheus-pve-exporter**: svar **Y** med mindre du allerede kjører en.",
  "- **API token** — the token id and secret from the previous step.":
    "- **API-token**: token-ID-en og hemmeligheten fra forrige trinn.",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **Adressen til hver node**: hver nodes egen adresse, kommaseparert, aldri en virtuell IP. Med tokenet tilbyr skriptet klyngens egen liste: trykk Enter for å bruke den. Agenten leser også klyngen fra disse nodene når den første er nede.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI-agent**: om den kan bruke rettelser; svar **N** for å holde den skrivebeskyttet.",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installeres i `/opt/oneuptime-proxmox-agent`, skriver en `.env`-fil med rettighetene `0600` og starter alt med Docker Compose. Kjører du skriptet på nytt, gjenbruker det alt i den `.env` i stedet for å spørre igjen, så det er også slik du oppgraderer.",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` viser innsamleren (`oneuptime-proxmox-agent`), failover mellom nodene (`oneuptime-pve-api-failover`), den medfølgende eksportøren (`oneuptime-pve-exporter`, med mindre du bruker din egen) og OneUptime AI-agenten (`oneuptime-proxmox-ai-agent`). Se etter `Everything is ready. Begin running and processing data.` i innsamlerens logger. Klyngen vises deretter automatisk i delen **Proxmox**.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI-agent (på som standard, skrivebeskyttet).** KI-undersøkelser er på: den lar OneUptime AI undersøke hendelser og varsler på denne klyngen med skrivebeskyttede `pvesh`-forespørsler, og den endrer ingenting med mindre du tillater rettelser; se **OneUptime AI-agent** under Avansert.",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Krever Proxmox VE 8.3 eller nyere. Velg en inntaksnøkkel i trinn 1 for å vise de to kommandoene: de inneholder nøkkelen, som Proxmox VE lagrer i webhook-målet de legger til.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "Hver gjests side viser deretter den siste sikkerhetskopien, og klyngens **Anbefalinger** tilbyr varslene **Backup Job Failed** og **Node Fenced**.",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "Installasjonsskriptet skriver disse til `/opt/oneuptime-proxmox-agent/.env`. Når du har endret en, tar du den i bruk med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-inntaksnøkkelen, den som ble valgt i trinn 1 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | Ja | Klyngens identifikator, som vises i OneUptime. Satt på hver måling som ressursattributtet `proxmox.cluster.name`. Hold den stabil: endrer du den, registreres en ny klynge (standard: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | Ja | Noden der eksportøren leser klyngen gjennom Proxmox VE-API-et og som AI-agenten spør, f.eks. `192.168.1.10`. Så lenge API-et ikke svarer, bruker begge neste node i `PVE_NODES` som svarer |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | I en klynge | Hver nodes egen API-adresse, kommaseparert i hakeparenteser, f.eks. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Som standard bare `PVE_HOST`, som er nok for én enkelt node. Eksportøren leser start ved oppstart (Guest Down), replikering og abonnementet bare for noden den spør, så hver node blir spurt etter tur; en node som er utelatt, forblir usynlig. Agenten leser også klyngen fra den neste av dem når `PVE_HOST` går ned. |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | Nei | Adressen (`host:port`, uten skjema) til prometheus-pve-exporter. Som standard den medfølgende eksportøren (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | Medfølgende eksportør og AI-agent | Full ID for Proxmox-API-tokenet, f.eks. `monitoring@pam!oneuptime` (PVEAuditor, skrivebeskyttet) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | Medfølgende eksportør og AI-agent | Hemmeligheten til Proxmox-API-tokenet |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | Nei | Bekreft TLS-sertifikatet til Proxmox-API-et (standard: `false`; PVE leveres med selvsignerte sertifikater) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | Nei | Sett til `pve-exporter` for å starte containeren med den medfølgende eksportøren |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egne innstillinger står under **OneUptime AI-agent**.",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "Når installasjonsskriptet spør **Run the bundled prometheus-pve-exporter?**, svarer du **n** og oppgir adressen til eksportøren din (`host:port`, uten skjema).",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "Bruk en adresse som agentens container når, vertens LAN-IP eller DNS-navn: `localhost` inne i containeren er containeren selv. Behold `PVE_API_TOKEN_ID` og `PVE_API_TOKEN_SECRET` i `.env` hvis du bruker OneUptime AI-agenten, som leser API-et med det tokenet.",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "Agenten skraper eksportøren hvert 30. sekund: klyngeinnsamlerne én gang, på `PVE_HOST` (eller noden den leser klyngen fra mens `PVE_HOST` er nede), og nodeinnsamlerne én gang for hver node i `PVE_NODES`. Hver serie har en etikett `id` som identifiserer ressursen: `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>` eller `storage/<node>/<storage>`:",
  "| Category | Metrics |": "| Kategori | Målinger |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **Tilgjengelighet** | `pve_up`, `pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **Noder** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **Gjester (VM / LXC)** | `pve_guest_info`, pluss serier for CPU, minne og nettverk på ID-ene `qemu/*` og `lxc/*` |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **Lagring** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |",
  "| **HA** | `pve_ha_state` |":
    "| **HA** (høy tilgjengelighet) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **Dekning av sikkerhetskopier** | `pve_not_backed_up_total`, `pve_not_backed_up_info`: gjester som ingen sikkerhetskopieringsjobb velger (om sikkerhetskopiene kjørte eller lyktes, vises ikke) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **Start ved oppstart** | `pve_onboot_status` per gjest, som **Guest Down** leser |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **Replikering** | `pve_replication_*`-serier per replikeringsjobb for lagring: etiketten `id` deres er jobb-ID-en (f.eks. `100-0`), ikke en ressurs |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "Start ved oppstart og replikering kommer fra eksportørens nodeinnsamlere, som bare leser noden eksportøren spør: en node som mangler i `PVE_NODES`, har ingen av delene.",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "Innsamleren deler også etiketten `id` opp i tre datapunktattributter som kan filtreres på likhet (prosessoren `transform/pve-identity`); monitorkriterier og dashbordfiltre matcher på disse:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| Attributt | Verdier | Eksempel for `qemu/100` |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` og `lxc` blir begge til `guest`) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | Alt etter den første `/` i `id` (`pve1`, `100`, `pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "Den opprinnelige etiketten `id` beholdes uendret.",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "Agenten leser hele klyngen gjennom én nodes API: `PVE_HOST` sitt, så lenge den svarer. Hvert 15. sekund sjekker containeren `oneuptime-pve-api-failover` den noden, og når API-et slutter å svare, leser innsamleren klyngen fra neste node i `PVE_NODES` som svarer, til `PVE_HOST` svarer igjen. Med API-tokenet i `.env` hopper den også over en node som svarer, men som er avskåret fra den delen av klyngen som har quorum, for sett derfra ville alle andre noder være nede. OneUptime AI-agenten gjør det samme for hvert av kallene sine. Så når en node svikter, utløses **Node Offline** for den, og resten av klyngen fortsetter å rapportere.",
  "Its logs say which node the cluster is read from, and why.":
    "Loggene viser hvilken node klyngen leses fra, og hvorfor.",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "Det den ikke kan dekke, er maskinen agenten kjører på: går den ned, blir hele klyngen stille, og **Cluster Stopped Reporting** utløses. Kjør agenten utenfor klyngen, eller i en VM som Proxmox HA starter på nytt på en annen node (`ha-manager add vm:<vmid>`, på delt lagring), og kjør én agent per klynge: hver agent leser hele klyngen, så en agent til ville rapportert hver ressurs to ganger. Se [Når en node går ned](/docs/telemetry/proxmox#when-a-node-goes-down).",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "Dette er hele `otel-collector-config.yaml` som agenten kjører; `.env`-filen gir verdiene `${env:...}`. Prosessoren `transform/pve-identity` utleder attributtene `pve.scope` / `pve.type` / `pve.id` som de innebygde Proxmox-varselmalene og dashbordfiltrene bygger på; behold den hvis du tilpasser konfigurasjonen:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "Som standard sender agenten bare målinger, så klyngens fane **Logger** forblir tom. PVE-tjenestene logger til systemd-journalen, og den medfølgende konfigurasjonen har en utkommentert receiver `journald` for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` og `qmeventd`.",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **Kjør agenten på en PVE-node.** Journalen finnes per vert, så en ekstern agent kan ikke lese den, og hver node sender bare sin egen. For å holde målingsagenten utenfor klyngen kan du i stedet kjøre en ekstra innsamler bare for logger på hver node.",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. Fjern kommenteringen av receiveren `journald` og pipelinen `logs` i `otel-collector-config.yaml`, og av de to journal-volumene i `docker-compose.yml`.",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **Bytt innsamlerimaget.** Standardimaget har ikke `journalctl` og kjører som en bruker som ikke kan lese journalen. Bygg denne wrapperen og la `image:` i `docker-compose.yml` peke på den:",
  "4. Apply it:": "4. Ta det i bruk:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "Vil du heller beholde standardimaget? Dokumentasjonen har et alternativ med `filelog` som følger `/var/log/syslog`: [Send loggene til Proxmox-tjenestene](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "Alle ressursattributter med prefikset `oneuptime.label.` blir en prosjektetikett på klyngen: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Legg dem til i prosessoren `resource` i `otel-collector-config.yaml`, ved siden av `proxmox.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Start deretter innsamleren på nytt, så den leser den nye konfigurasjonen:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klyngen vises med etikettene `team:platform` og `env:production`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten.",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kjører også **`oneuptime-proxmox-ai-agent`**. Mens OneUptime AI undersøker en hendelse eller et varsel på denne klyngen, kjører den skrivebeskyttede `pvesh`-kommandoer gjennom den: `pvesh get /cluster/status`, en gjests nåværende status, en nodes mislykkede oppgaver. Det finnes ikke noe `pvesh`-program i den: hver kommando blir ett kall til Proxmox VE-API-et på `PVE_HOST`. Den registrerer seg som klyngen med navnet `PROXMOX_CLUSTER_NAME` og vises på klyngens side **KI → AI-agent**.",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API-tokenet er den harde grensen.** Den leser med innsamlerens PVEAuditor-token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), som kan lese og ingenting annet. Kjører du din egen eksportør og har ikke noe token i `.env`, legger du til et.",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- Den er **skrivebeskyttet** med mindre du setter `ONEUPTIME_AI_ALLOW_WRITES=true`. Rettelser (å starte eller starte en gjest på nytt) trenger i tillegg et eget token som kan slå gjester av og på, satt som `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; agentens README har `pveum`-kommandoene. Kjører agenten i en gjest i denne klyngen, setter du VMID-en til den gjesten i `ONEUPTIME_AI_PROTECTED_TARGETS`.",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Sjekk den: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- Bruker du ikke OneUptime AI? Slett tjenesten `oneuptime-proxmox-ai-agent` fra `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "Hva den kan kjøre, og hvordan rettelser virker: [KI-agenter for infrastruktur](/docs/ai/infrastructure-ai-agents#proxmox-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**Oppgrader**: innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Kjør installasjonsskriptet på nytt. Det gjenbruker hver verdi i den eksisterende `.env` (ingenting spørres om igjen), laster ned de nyeste `docker-compose.yml` og `otel-collector-config.yaml` (en fil du har redigert, beholdes ved siden av den nye som `<file>.bak.<timestamp>`), henter imagene og oppretter agenten på nytt med dem:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurasjonen rapporterer innsamlerversjonen den låser, som klyngens **Agentversjon**. Når denne OneUptime låser en nyere, åpner et varseltegn ved siden av den disse kommandoene.",
  "**Uninstall** the agent:": "**Avinstaller** agenten:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "Slett deretter API-tokenet under *Datacenter → Permissions → API Tokens* hvis du ikke trenger det lenger.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` sjekker hele kjeden (containerkjøretid, skrapingen av eksportøren, påføringen av klyngenavnet, tokenets form, innsamlerens egne målinger) og spør OneUptime direkte om den godtar inntaksnøkkelen din. Den siste sjekken betyr mest: OneUptimes OTLP-endepunkter avviser en feil nøkkel med `401` eller `422`, som innsamleren logger som én enkelt `Exporting failed`-linje per batch som er lett å overse, så skriptet spør `GET /otlp/v1/validate` om en direkte dom 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutter med en avgjørelse som nevner den mest sannsynlige årsaken.",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. Sjekk at agenten kjører (i `/opt/oneuptime-proxmox-agent`): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. Sjekk agentens logger for feil: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen din er riktige.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for at agentens maskin når OneUptime-instansen over nettverket.",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. Sjekk at eksportøren svarer. Den medfølgende eksportøren publiserer ikke porten sin på verten, så kjør curl i nettverksnavnerommet dens; du skal se `pve_*`-målingslinjer (for din egen eksportør kaller du `host:9221` direkte med curl):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. Bekreft at API-tokenet har rollen **PVEAuditor** på stien `/`, på tokenet og på brukeren.",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. Sjekk innsamlerens logger for skrape- eller eksportfeil (i `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API-tokenet er feil eller mangler tillatelser. Sjekk på nytt formatet på token-ID-en (`user@realm!tokenname`), hemmeligheten og at rollen **PVEAuditor** er gitt på stien `/` til tokenet og til brukeren. Eksportørens egne logger viser svaret fra API-et: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'Gjesteserier (ID-ene `qemu/*`, `lxc/*`) kommer fra eksportørens klyngeinnsamler. Den medfølgende konfigurasjonen slår den på (skrapeparameteren `cluster=1`); har du tilpasset konfigurasjonen, gjenoppretter du parameteren `cluster: ["1"]`.',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Flaggene for start ved oppstart og replikeringsjobbene deres kommer fra noden de kjører på, og agenten leser bare nodene i `PVE_NODES`. Før opp hver nodes egen adresse der, slik som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, og ta det i bruk med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`. Slutter innsamleren å starte etter en endring, har listen mistet hakeparentesene. `troubleshoot.sh` sjekker hver node i listen.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, satt på hver måling som `proxmox.cluster.name`. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; merk at et nytt navn registrerer en ny klynge.",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **Klyngenavn**: skriv inn nøyaktig **`pve-1`**; et annet navn registrerer en ny klynge.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, satt på hver måling som `proxmox.cluster.name`. Denne klyngen er **`pve-1`**. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i `/opt/oneuptime-proxmox-agent`; merk at et nytt navn registrerer en ny klynge.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen inneholder allerede OneUptime-URL-en og inntaksnøkkelen din. Resten spør skriptet om:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Krever Proxmox VE 8.3 eller nyere. Den første kommandoen legger til et webhook-mål med navnet `oneuptime`, som sender hver varsling til OneUptime som en logg for denne klyngen og lagrer nøkkelen og klyngens navn i hemmelighetene sine. Den andre sender hver varsling dit. Erstatt `my-proxmox-cluster` med klyngenavnet du ga agenten, slik at varslingene når den samme klyngen.",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "Hver gjests side viser deretter den siste sikkerhetskopien, og klyngens **Anbefalinger** tilbyr varslene **Backup Job Failed** og **Node Fenced**. Slik slutter du å sende dem:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Krever Proxmox VE 8.3 eller nyere. Den første kommandoen legger til et webhook-mål med navnet `oneuptime`, som sender hver varsling til OneUptime som en logg for denne klyngen og lagrer nøkkelen og klyngens navn i hemmelighetene sine. Den andre sender hver varsling dit. Kommandoen nevner allerede **`pve-1`**, så varslingene når denne klyngen.",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Last ned `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime til en ny mappe:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "Opprett en `.env`-fil ved siden av dem; den inneholder tokenets hemmelighet, så hold den privat med `chmod 600 .env`:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Erstatt `my-proxmox-cluster` med et navn på denne klyngen, for eksempel `pve-prod`. Det er slik klyngen vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny klynge.",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- Sett `PVE_HOST` til en hvilken som helst node i klyngen: så lenge API-et ikke svarer, leser agenten klyngen fra neste node i `PVE_NODES`, så den trenger ingen virtuell IP.",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- Sett `PVE_NODES` til hver nodes egen adresse, i hakeparenteser, aldri en virtuell IP. Eksportøren leser start ved oppstart (Guest Down), replikering og abonnementet bare for noden den spør, så hver node blir spurt etter tur; en node som er utelatt, forblir usynlig.",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- Fyll inn tokenet fra forrige trinn. `COMPOSE_PROFILES=pve-exporter` starter også den medfølgende prometheus-pve-exporter, som leser API-et med det.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten leser disse fra `.env`-filen ved siden av `docker-compose.yml`. Når du har endret en, tar du den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "Utelat `COMPOSE_PROFILES` fra `.env` og la agenten i stedet peke på eksportøren din (`host:port`, uten skjema):",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kjør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Oppgrader**: innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Last ned begge filene på nytt; `.env` blir værende, og en endring du gjorde i en av filene, må gjøres på nytt:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent deretter imagene, og gjenopprett agenten, så innsamleren leser den nye konfigurasjonen:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. Sjekk at agenten kjører (i agentens mappe): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. Sjekk innsamlerens logger for skrape- eller eksportfeil (i agentens mappe): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "Flaggene for start ved oppstart og replikeringsjobbene deres kommer fra noden de kjører på, og agenten leser bare nodene i `PVE_NODES`. Før opp hver nodes egen adresse der, slik som `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, og ta det i bruk med `docker compose up -d` i mappen med `docker-compose.yml`. Slutter innsamleren å starte etter en endring, har listen mistet hakeparentesene. `troubleshoot.sh` sjekker hver node i listen.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, satt på hver måling som `proxmox.cluster.name`. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`; merk at et nytt navn registrerer en ny klynge.",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dette installerer agenten for **`pve-1`**: la `PROXMOX_CLUSTER_NAME` stå nøyaktig som det er, ellers registreres dataene som en ny klynge.",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `PROXMOX_CLUSTER_NAME`, satt på hver måling som `proxmox.cluster.name`. Denne klyngen er **`pve-1`**. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`; merk at et nytt navn registrerer en ny klynge.",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**Ingen agent, men mindre data.** Proxmox VE 9.0 og nyere sender selv hver nodes målinger til OneUptime. HA-tilstand, start ved oppstart (brukt av **Guest Down**), dekning av sikkerhetskopier og replikering sendes ikke; bruk installasjonsskriptet eller Docker Compose hvis du trenger dem. Bruk det ene eller det andre for en klynge: kjører begge, rapporteres hver ressurs to ganger.",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 eller nyere**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Proxmox' nettgrensesnitt, for å legge til en målingsserver under *Datacenter → Metric Server*",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "Hver node når `<YOUR_ONEUPTIME_HOST>` på port `443`",
  "| Field | Value |": "| Felt | Verdi |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (vertsnavn) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (portnummer) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (protokoll) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (sti) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |":
    "| **Headers** (hoder) | JSON-en nedenfor |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "Legg den til én gang for datasenteret: hver node i klyngen sender da sine egne målinger.",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime oversetter pushen til de samme `pve_*`-seriene som agenten sender. Klyngen registrerer seg under Proxmox-klyngenavnet ditt (en frittstående node under nodenavnet sitt) og vises i delen **Proxmox**, der sidene Noder, Gjester og Lagring, oversiktsdiagrammene, målingskatalogen og varselmalene for CPU, minne og lagring virker som de gjør med agenten.",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "Hver node sender bare sin egen status, så en node som går ned, kan ikke melde seg selv nede; nodene som fortsatt kjører, melder det for den:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- Den vises som **Offline** på Proxmox-sidene omtrent 2 minutter etter sin siste rapport, og **Node Offline** utløses etter omtrent 5 minutter.",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** teller den også som offline; varselet utløses omtrent 7–9 minutter etter at noden ble stille, når hele vinduet på 5 minutter har rapporter.",
  "- Its next report brings it back.":
    "- Neste rapport fra den bringer den tilbake.",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    'Offline betyr "rapporterer ikke lenger": en `pvestatd` som henger, en stoppet `pmxcfs` eller et brutt nettverk til OneUptime ser likt ut. En frittstående vert eller en hel klynge som blir stille, har ingen igjen til å melde det, så klyngen blir i stedet **Frakoblet**. En node som har vært stille i mer enn 7 dager, meldes ikke lenger. Rapportene er merket `oneuptime.proxmox.inferred=not-reporting` i Målingsutforsker.',
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "Klyngen registrerer seg under Proxmox-klyngenavnet sitt; en frittstående node registrerer seg under nodenavnet sitt. Et ressursattributt `proxmox.cluster.name` som er satt under målingsserverens *Resource Attributes*, brukes fortsatt i stedet.",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime oversetter pushen til `pve_*`-seriene som agenten sender, så Proxmox-sidene og varselmalene for CPU, minne og lagring virker uendret. De opprinnelige `proxmox_*`-seriene er fortsatt tilgjengelige i Målingsutforsker for alt annet Proxmox VE rapporterer.",
  "Some alert templates need data only the agent collects:":
    "Noen varselmaler trenger data som bare agenten samler inn:",
  "| Needs the agent | Why |": "| Trenger agenten | Hvorfor |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA-tilstand | Sendes ikke: malen **HA Resource in Error State** trenger agenten |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| Flagg for start ved oppstart | Sendes ikke: **Guest Down**, som bare varsler for gjester som skal starte ved oppstart, trenger agenten |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| Dekning av sikkerhetskopier og replikering | Sendes ikke: **Guest Not Backed Up** og **Replication Failing** trenger agenten |",
  "Every node has stopped reporting, or never started.":
    "Alle nodene har sluttet å rapportere, eller de har aldri begynt.",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. Sjekk OpenTelemetry-oppføringen under *Datacenter → Metric Server*: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protokoll `https`, sti `/otlp/v1/metrics` og hodet `x-oneuptime-token` med en nøkkel fra trinn 1.",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. Sjekk at nodene når `<YOUR_ONEUPTIME_HOST>` over nettverket.",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "Den har sluttet å rapportere: en node som er nede, en `pvestatd` som henger, en stoppet `pmxcfs` eller et brutt nettverk til OneUptime ser likt ut. Neste rapport fra den bringer den tilbake. Har du tatt noden ut av klyngen, bruker du **Fjern node** på siden dens; ellers forblir den Offline i opptil 7 dager.",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "Den innebygde pushen sender ikke HA-tilstand, start ved oppstart, dekning av sikkerhetskopier eller replikering. Velg **Installasjonsskript** eller **Docker Compose** øverst i denne veiledningen for å kjøre agenten i stedet, og fjern målingsserveren, for kjører begge, rapporteres hver ressurs to ganger.",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "Denne klyngen er **`pve-1`** i OneUptime. Er ikke det Proxmox-klyngens eget navn, setter du `proxmox.cluster.name` til `pve-1` under målingsserverens *Resource Attributes*, ellers registrerer pushen en ny klynge.",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Krever Proxmox VE 8.3 eller nyere. Den første kommandoen legger til et webhook-mål med navnet `oneuptime`, som sender hver varsling til OneUptime som en logg for denne klyngen og lagrer nøkkelen og klyngens navn i hemmelighetene sine. Den andre sender hver varsling dit. Erstatt `my-proxmox-cluster` med navnet klyngen vises under i OneUptime: Proxmox-klyngenavnet dens, eller en frittstående nodes eget navn.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-proxmox-agent`). Agenten for en andre klynge på samme maskin trenger sine egne navn: installasjonsskriptet navngir containerne til en ny agent etter mappen dens med mindre du angir dem, og beholder dem når du kjører skriptet på nytt |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nei | Containernavnet til API-failover-sidecaren (standard: `oneuptime-pve-api-failover`). Installasjonsskriptet navngir API-failover-sidecaren for en andre klynge etter innsamleren (`oneuptime-pve-api-failover-cluster2` ved siden av `oneuptime-proxmox-agent-cluster2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til den medfølgende eksportøren (standard: `oneuptime-pve-exporter`). Installasjonsskriptet navngir den medfølgende eksportøren for en andre klynge etter innsamleren (`oneuptime-pve-exporter-cluster2` ved siden av `oneuptime-proxmox-agent-cluster2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-proxmox-ai-agent`). Installasjonsskriptet navngir AI-agenten for en andre klynge etter innsamleren (`oneuptime-proxmox-ai-agent-cluster2` ved siden av `oneuptime-proxmox-agent-cluster2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent leser én klynge. For en andre klynge installerer du en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Skriptet navngir containerne etter mappen, for eksempel `oneuptime-proxmox-agent-cluster2`, med mindre du angir variablene deres, for eksempel `PROXMOX_AGENT_CONTAINER_NAME`. Det lagrer navnene i `.env` til den agenten, så når du kjører skriptet på nytt med samme `INSTALL_DIR` for å oppgradere agenten, beholdes navnene, og en agent der du en gang redigerte `container_name` i `docker-compose.yml`, beholder det navnet.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så skriptet avviser en mappe med samme navn som en som allerede kjører en agent et annet sted. Send mappen til diagnoseskriptet med `-d`.",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-proxmox-agent`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | Nei | Containernavnet til API-failover-sidecaren (standard: `oneuptime-pve-api-failover`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | Nei | Containernavnet til den medfølgende eksportøren (standard: `oneuptime-pve-exporter`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-proxmox-ai-agent`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent leser én klynge. For en andre klynge setter du opp en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn. Angi dem i `.env` til den agenten:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så en andre mappe med samme navn ville erstattet containerne til den første agenten. Hold navnene utenfor `docker-compose.yml`, som en oppgradering erstatter.",
};

export default TRANSLATION;
