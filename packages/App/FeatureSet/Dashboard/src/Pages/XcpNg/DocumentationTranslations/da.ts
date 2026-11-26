import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 eller nyere, forbundet med de pools, du vil overvåge. Dets OpenMetrics-plugin kræver en Premium-licens på en XOA; et Xen Orchestra bygget fra kildekoden indeholder det",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginet, på en maskine, der kan nå Xen Orchestra over HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Et certifikat på Xen Orchestra, der nævner den adresse, agenten forbinder til. Det selvsignerede certifikat, Xen Orchestra laver til sig selv, nævner ingen, så ingen nuværende TLS-klient kan kontrollere det — se **Xen Orchestras certifikat** under Avanceret",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Åbn *Settings → Plugins* i Xen Orchestra, og find **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Slå det til. Første gang det starter, laver det en hemmelighed og beholder den, og Xen Orchestra bevarer den på tværs af genstarter.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Åbn pluginets indstillinger, og kopiér dets **Prometheus secret** — du giver den til agenten i næste trin. Du kan også skrive din egen hemmelighed der og gemme den.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Pluginet svarer på Xen Orchestras egen adresse og med dets eget certifikat, på `/openmetrics/metrics`, og kun på en anmodning, der har dets hemmelighed med. Det leverer hver pool, Xen Orchestra er forbundet med, så én agent dækker dem alle.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Scriptet spørger efter din OneUptime-URL og din indtagelsesnøgle, som begge vises i trin 1 (vælg en nøgle dér for at få dem udfyldt her), og derefter efter:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestras adresse** — som du åbner den i en browser, f.eks. `https://xo.example.com` eller `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics-pluginets hemmelighed** — fra det forrige trin. Den vises ikke, mens du skriver den.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Hvad dette Xen Orchestra skal hedde** — det navn, hver af dets pools viser under sine Indstillinger. Tryk Enter for at bruge dets adresse.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Derefter læser scriptet Xen Orchestras certifikat. Når denne maskine allerede har tillid til det, har agenten tillid til det samme CA-bundle. Når den ikke har, viser scriptet certifikatets SHA-256-fingeraftryk: sammenlign det med det på Xen Orchestras maskine, og svar **y** for at have tillid til netop det certifikat og intet andet. Det slår aldrig kontrollen fra. Derefter beder det pluginet om dets metrikker med hemmeligheden og fortæller, hvilke pools Xen Orchestra rapporterer, før det installerer noget.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerer i `/opt/oneuptime-xcp-ng-agent`, skriver en `.env`-fil med `0600` og starter agenten med Docker Compose. Kører du scriptet igen, genbruger det alt i den `.env` i stedet for at spørge igen, så det er også sådan, du opgraderer.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` viser `oneuptime-xcp-ng-agent`. Kig efter `Everything is ready. Begin running and processing data.` i dens logs. Agenten læser Xen Orchestra hvert minut, og hver pool, den rapporterer, vises derefter i sektionen **XCP-ng** under det navn, Xen Orchestra giver den, med dens værter, VM'er og lagerplads.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Installationsscriptet skriver disse til `/opt/oneuptime-xcp-ng-agent/.env`. Når du har ændret en, skal du anvende den med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-indtagelsesnøglen, den der blev valgt i trin 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Ja | Xen Orchestras `host` eller `host:port`, uden skema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Nej | `https` (standard). `http` kun i et testmiljø: hemmeligheden krydser så netværket ukrypteret |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Ja | OpenMetrics-pluginets hemmelighed, sendt som Bearer-token. Hvert `$` i den skrives som `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Nej | Hvad dette Xen Orchestra skal hedde i OneUptime, vist under Indstillinger for hver af dets pools (standard: dets adresse) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Nej | Det navn, Xen Orchestras certifikat kontrolleres mod, når `XO_ADDRESS` er en adresse, certifikatet ikke angiver |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Installationsscript | Xen Orchestras adresse, som den blev indtastet; scriptet udleder `XO_SCHEME` og `XO_ADDRESS` af den |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Installationsscript | SHA-256-fingeraftrykket af Xen Orchestras eget certifikat, når agenten har tillid til netop det certifikat og intet andet |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Installationsscript | Et CA-bundle, der har udstedt Xen Orchestras certifikat, og som scriptet kopierer til `xo-ca.pem` |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "Agenten kontrollerer Xen Orchestras certifikat mod `xo-ca.pem` ved siden af `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "Agenten kontrollerer Xen Orchestras certifikat ved hver læsning, mod `xo-ca.pem` og intet andet. Den fil indeholder én af tre ting:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestras eget certifikat**, fastlåst via dets SHA-256-fingeraftryk (`XO_TLS_FINGERPRINT`): agenten har tillid til netop det certifikat og intet andet.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **Den CA, der udstedte det** (`XO_CA_FILE`), for et certifikat fra din egen CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Denne maskines CA-bundle**, for et certifikat, som denne maskine allerede har tillid til.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "Under alle omstændigheder skal certifikatet nævne den adresse, agenten forbinder til: agenten kontrollerer de navne, et certifikat er udstedt til, som enhver nuværende TLS-klient gør, og ikke dets subject. Det selvsignerede certifikat, Xen Orchestra laver til sig selv, nævner ingen, så agenten kan ikke have tillid til det, fastlåst eller ej, og fejler med `x509: certificate is not valid for any names`. Giv Xen Orchestra et certifikat, der nævner dets adresse — fra din CA eller et selvsigneret med et alternativt subject-navn (subject alternative name) —, som [Xen Orchestras certifikat](/docs/telemetry/xcp-ng#xen-orchestras-certificate) viser.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Når certifikatet nævner Xen Orchestra ved et andet navn end adressen i `XO_ADDRESS`, så sæt `XO_TLS_SERVER_NAME` til det navn. Når et fastlåst certifikat fornyes, holder agenten op med at læse Xen Orchestra, indtil den har tillid til det nye. Kør installationsscriptet igen: det viser det nye fingeraftryk og stopper uden at ændre noget. Kontrollér det fingeraftryk på Xen Orchestras maskine, og kør så scriptet én gang til med det: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Hvert minut læser agenten pluginet, som læser hver værts XAPI-round-robin-databaser med 60 sekunders opløsning. Den beholder serierne `xcp_*` og flytter hver series pool til det batch, den sender, som `xcp_ng.pool.id` (poolens UUID, som aldrig ændrer sig) og `xcp_ng.pool.name`:",
  "| Category | Series |": "| Kategori | Serier |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — til stede, så længe Xen Orchestra er forbundet med poolen |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Værter** | `xcp_host_status` (strømtilstand, og om den er aktiveret), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` pr. interface, `xcp_host_disk_*` pr. lagerdepot |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM'er** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU-konkurrence), `xcp_vm_memory_*`, `xcp_vm_network_*` pr. interface, `xcp_vm_disk_*` pr. disk, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Lagerplads** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, på pools, der kører XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Kontroldomæner rapporterer som VM\'er med `is_control_domain="true"`; siderne skjuler dem, medmindre du beder om dem.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra typer otte gennemløbsserier som tællere, selv om hver indeholder XAPI's rate pr. sekund: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total` og VM'ernes serier for netværk, netværksfejl og disklæsning og -skrivning. Agenten gør dem til gauges med uændrede værdier, så OneUptime gemmer dem som de rater, de er, i bytes eller fejl pr. sekund.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime tilføjer fire 0/1-serier for hver pool, som advarselsskabelonerne læser: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` og `xcp_ng.vm.stopped_after_running` (en VM, der er stoppet eller sat på pause, og som kørte inden for det seneste døgn). Den stempler også hvert punkt med `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` eller `xostor`) og `xcp_ng.id` (det objekts UUID), som monitorer og dashboards filtrerer på.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Beholdes ikke: Xen Orchestras egne processerier (`xo_*`), som ikke hører til nogen pool, og en værts strømforbrug læst via IPMI, som pluginet sender uden dens pool. Hver VM's anslåede andel af det beholdes.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "Én agent læser ét Xen Orchestra og hver pool, det administrerer. Til et andet Xen Orchestra skal du installere en anden agent i sin egen mappe, med sit eget `container_name` i sin `docker-compose.yml`:",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Lad ikke to Xen Orchestra, der administrerer den samme pool, begge blive læst: poolen er én pool i OneUptime, via sit UUID, og ville blive rapporteret to gange.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver en projektetiket på hver pool, agenten læser: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Tilføj dem til processoren `resource` i `otel-collector-config.yaml` ved siden af `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Genstart derefter collectoren, så den læser den nye konfiguration:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Poolene vises med etiketterne `team:platform` og `env:production`. Etiketter sammenlignes uden hensyn til store og små bogstaver, så en eksisterende etiket `Production` genbruges; etiketter, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten. Kører du installationsscriptet igen, erstatter det en redigeret `otel-collector-config.yaml` og beholder din ved siden af som `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Opgrader** — collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Kør installationsscriptet igen. Det genbruger hver værdi i din eksisterende `.env` (der spørges ikke om noget igen), kontrollerer Xen Orchestras certifikat på samme måde, henter den seneste `docker-compose.yml` og `otel-collector-config.yaml` — en fil, du har redigeret, beholdes ved siden af den nye som `<file>.bak.<timestamp>` —, henter imaget og genopretter agenten med det:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterer den collector-version, den låser til, som hver pools **Agentversion**. Når denne OneUptime låser til en nyere, åbner et advarselstegn ved siden af disse kommandoer.",
  "**Uninstall** the agent:": "**Afinstallér** agenten:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Slå derefter OpenMetrics-pluginet fra i Xen Orchestra, hvis intet andet læser det.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` tjekker hele kæden — containeren, Xen Orchestras certifikat mod `xo-ca.pem`, pluginet og dets hemmelighed, de pools, det rapporterer — og spørger OneUptime direkte, om den accepterer din indtagelsesnøgle. Det sidste tjek betyder mest: OneUptimes OTLP-endpoints afviser en forkert nøgle med `401` eller `422`, som collectoren logger som en enkelt `Exporting failed`-linje pr. batch, der er let at overse.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Det slutter med en afgørelse, der nævner den mest sandsynlige årsag. Det udskriver aldrig hemmeligheden.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime markerer en pool som Afbrudt, når intet er blevet læst for den i 15 minutter.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Hvis hver pool i dette Xen Orchestra er Afbrudt, så tjek agenten (i `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` og `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Hvis det kun er én, er Xen Orchestra holdt op med at rapportere den: under *Settings → Servers* i Xen Orchestra skal poolens server være forbundet. Poolens værter, VM'er og lagerplads forbliver, som Xen Orchestra sidst rapporterede dem.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Collectoren logger `server returned HTTP status 401 Unauthorized`. Kopiér hemmeligheden igen fra *Settings → Plugins → openmetrics*, sæt `XO_OPENMETRICS_SECRET` til den i `.env` — mellem enkelte anførselstegn, hvert `$` skrevet som `$$` — og anvend den med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`. Før 6.8 lavede Xen Orchestra en ny hemmelighed, hver gang det genstartede.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra svarer, men dets OpenMetrics-plugin gør ikke. Slå pluginet til under *Settings → Plugins → openmetrics* (en XOA kræver en Premium-licens til det), og kontrollér, at Xen Orchestra er 6.9 eller nyere. `/openmetrics/health` svarer `{"status":"ok"}` uden hemmelighed, mens pluginet kører.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — certifikatet nævner ingen adresse, som Xen Orchestras eget selvsignerede certifikat. Giv Xen Orchestra et certifikat, der nævner dets adresse.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — forbind til et af disse navne, eller sæt `XO_TLS_SERVER_NAME` til et af dem.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` indeholder hverken dette certifikat eller den CA, der udstedte det. Certifikatet er blevet fornyet, eller filen indeholder det forkerte: skriv den igen, som **Xen Orchestras certifikat** under Avanceret beskriver.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra rapporterer kun de pools, det er forbundet med, og agenten læser kun det Xen Orchestra. Forbind poolens server under *Settings → Servers* i Xen Orchestra; poolen vises i OneUptime ved næste læsning. En pool, som et andet Xen Orchestra læser, har brug for sin egen agent, ved siden af det andet Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Hvad dette Xen Orchestra skal hedde** — kommandoen nævner det allerede **`xo-paris`**, som denne pools Indstillinger viser det.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen indeholder allerede din OneUptime-URL og indtagelsesnøgle. Resten spørger scriptet om:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Hent `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime ned i en ny mappe:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Opret en `.env`-fil ved siden af dem; den indeholder pluginets hemmelighed, så hold den privat med `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Sæt `XO_ADDRESS` til Xen Orchestras `host` eller `host:port`, uden `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Sæt pluginets hemmelighed i enkelte anførselstegn. Indeholder den et `$`, så skriv hvert som `$$`: collectoren læser værdien én gang til.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` er det, hver pools Indstillinger kalder dette Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Giv derefter agenten Xen Orchestras certifikat, som `xo-ca.pem` ved siden af `docker-compose.yml` — agenten kontrollerer Xen Orchestra mod denne fil og intet andet. For at have tillid til Xen Orchestras eget certifikat skal du læse det og kontrollere dets fingeraftryk mod det på Xen Orchestras maskine:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Hvis din egen CA har udstedt det, så kopiér i stedet den CA's certifikat til `xo-ca.pem`; hvis en offentlig CA har, så kopiér denne maskines CA-bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten læser disse fra `.env`-filen ved siden af `docker-compose.yml`. Når du har ændret en, skal du anvende den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Når certifikatet nævner Xen Orchestra ved et andet navn end adressen i `XO_ADDRESS`, så sæt `XO_TLS_SERVER_NAME` til det navn. Når certifikatet i `xo-ca.pem` fornyes, så læs det igen som i trin 3, og kør derefter `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Opgrader** — collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Hent begge filer igen; din `.env` og `xo-ca.pem` bliver, og en ændring, du havde lavet i en af filerne, skal laves igen:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Hent derefter imaget, og genopret agenten, så collectoren læser sin nye konfiguration:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Hvis hver pool i dette Xen Orchestra er Afbrudt, så tjek agenten (i agentens mappe): `docker compose ps` og `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Collectoren logger `server returned HTTP status 401 Unauthorized`. Kopiér hemmeligheden igen fra *Settings → Plugins → openmetrics*, sæt `XO_OPENMETRICS_SECRET` til den i `.env` — mellem enkelte anførselstegn, hvert `$` skrevet som `$$` — og anvend den med `docker compose up -d` i mappen med `docker-compose.yml`. Før 6.8 lavede Xen Orchestra en ny hemmelighed, hver gang det genstartede.",
};

export default TRANSLATION;
