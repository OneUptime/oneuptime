import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 eller nyere, koblet til poolene du vil overvåke. OpenMetrics-tillegget krever en Premium-lisens på en XOA; et Xen Orchestra bygget fra kildekoden har det med",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på en maskin som når Xen Orchestra over HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Et sertifikat på Xen Orchestra som navngir adressen agenten kobler til. Det selvsignerte sertifikatet Xen Orchestra lager til seg selv, navngir ingen, så ingen nåværende TLS-klient kan kontrollere det — se **Xen Orchestras sertifikat** under Avansert",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Åpne *Settings → Plugins* i Xen Orchestra, og finn **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Slå det på. Første gang det starter, lager det en hemmelighet og beholder den, og Xen Orchestra tar vare på den på tvers av omstarter.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Åpne innstillingene for tillegget, og kopier **Prometheus secret** — du gir den til agenten i neste trinn. Du kan også skrive inn en egen hemmelighet der og lagre den.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Tillegget svarer på Xen Orchestras egen adresse og med dets eget sertifikat, på `/openmetrics/metrics`, og bare på en forespørsel som har med hemmeligheten. Det leverer hver pool Xen Orchestra er koblet til, så én agent dekker dem alle.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet spør etter OneUptime-URL-en og inntaksnøkkelen din, som begge vises i trinn 1 (velg en nøkkel der for å få dem fylt inn her), og deretter etter:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestras adresse** — slik du åpner den i en nettleser, f.eks. `https://xo.example.com` eller `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics-tilleggets hemmelighet** — fra forrige trinn. Den vises ikke mens du skriver den.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Hva dette Xen Orchestra skal hete** — navnet hver av poolene viser under Innstillinger. Trykk Enter for å bruke adressen.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Deretter leser skriptet Xen Orchestras sertifikat. Når denne maskinen allerede stoler på det, stoler agenten på den samme CA-pakken. Når den ikke gjør det, viser skriptet sertifikatets SHA-256-fingeravtrykk: sammenlign det med det på Xen Orchestras maskin, og svar **y** for å stole på akkurat det sertifikatet og ingenting annet. Det slår aldri av kontrollen. Så ber det tillegget om målingene med hemmeligheten og sier hvilke pooler Xen Orchestra rapporterer, før det installerer noe.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerer i `/opt/oneuptime-xcp-ng-agent`, skriver en `.env`-fil med `0600` og starter agenten med Docker Compose. Kjører du skriptet på nytt, gjenbruker det alt i den `.env` i stedet for å spørre igjen, så det er også slik du oppgraderer.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` viser `oneuptime-xcp-ng-agent`. Se etter `Everything is ready. Begin running and processing data.` i loggene. Agenten leser Xen Orchestra hvert minutt, og hver pool den rapporterer, vises deretter i delen **XCP-ng** under navnet Xen Orchestra gir den, med verter, VM-er og lagring.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Installasjonsskriptet skriver disse til `/opt/oneuptime-xcp-ng-agent/.env`. Når du har endret en, tar du den i bruk med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-inntaksnøkkelen, den som ble valgt i trinn 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Ja | Xen Orchestras `host` eller `host:port`, uten skjema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Nei | `https` (standard). `http` bare i en testlab: hemmeligheten går da ukryptert over nettverket |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Ja | OpenMetrics-tilleggets hemmelighet, sendt som Bearer-token. Hvert `$` i den skrives som `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Nei | Hva dette Xen Orchestra skal hete i OneUptime, vist under Innstillinger for hver av poolene (standard: adressen) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Nei | Navnet Xen Orchestras sertifikat kontrolleres mot, når `XO_ADDRESS` er en adresse sertifikatet ikke lister opp |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | Nei | Containernavnet til agenten (standard: `oneuptime-xcp-ng-agent`). Agenten for et andre Xen Orchestra på samme maskin trenger sitt eget: installasjonsskriptet navngir en ny agent etter mappen dens med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Installasjonsskript | Xen Orchestras adresse slik den ble skrevet inn; skriptet utleder `XO_SCHEME` og `XO_ADDRESS` fra den |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Installasjonsskript | SHA-256-fingeravtrykket til Xen Orchestras eget sertifikat, når agenten stoler på akkurat det sertifikatet og ingenting annet |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Installasjonsskript | En CA-pakke som har utstedt Xen Orchestras sertifikat, og som skriptet kopierer til `xo-ca.pem` |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "Agenten kontrollerer Xen Orchestras sertifikat mot `xo-ca.pem` ved siden av `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "Agenten kontrollerer Xen Orchestras sertifikat ved hver lesing, mot `xo-ca.pem` og ingenting annet. Den filen inneholder én av tre ting:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestras eget sertifikat**, låst med SHA-256-fingeravtrykket sitt (`XO_TLS_FINGERPRINT`): agenten stoler på akkurat det sertifikatet og ingen andre.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **CA-en som utstedte det** (`XO_CA_FILE`), for et sertifikat fra en egen CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Denne maskinens CA-pakke**, for et sertifikat denne maskinen allerede stoler på.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "Uansett må sertifikatet navngi adressen agenten kobler til: agenten kontrollerer navnene et sertifikat er utstedt til, slik hver nåværende TLS-klient gjør, og ikke subject-feltet. Det selvsignerte sertifikatet Xen Orchestra lager til seg selv, navngir ingen, så agenten kan ikke stole på det, låst eller ikke, og feiler med `x509: certificate is not valid for any names`. Gi Xen Orchestra et sertifikat som navngir adressen — fra CA-en din, eller et selvsignert med et alternativt subject-navn (subject alternative name) —, slik [Xen Orchestras sertifikat](/docs/telemetry/xcp-ng#xen-orchestras-certificate) viser.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "Når sertifikatet navngir Xen Orchestra med et annet navn enn adressen i `XO_ADDRESS`, setter du `XO_TLS_SERVER_NAME` til det navnet. Når et låst sertifikat fornyes, slutter agenten å lese Xen Orchestra til den stoler på det nye. Kjør installasjonsskriptet på nytt: det viser det nye fingeravtrykket og stopper uten å endre noe. Kontroller det fingeravtrykket på Xen Orchestras maskin, og kjør så skriptet én gang til med det: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Hvert minutt leser agenten tillegget, som leser hver verts XAPI-round-robin-databaser med 60 sekunders oppløsning. Den beholder seriene `xcp_*` og flytter poolen til hver serie over i batchen den sender, som `xcp_ng.pool.id` (poolens UUID, som aldri endres) og `xcp_ng.pool.name`:",
  "| Category | Series |": "| Kategori | Serier |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — til stede så lenge Xen Orchestra er koblet til poolen |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Verter** | `xcp_host_status` (strømtilstand og om den er aktivert), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per grensesnitt, `xcp_host_disk_*` per lagringsrepositorium |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM-er** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU-konkurranse), `xcp_vm_memory_*`, `xcp_vm_network_*` per grensesnitt, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Lagring** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, på pooler som kjører XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Kontrolldomener rapporterer som VM-er med `is_control_domain="true"`; sidene skjuler dem med mindre du ber om dem.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra typer åtte gjennomstrømningsserier som tellere, selv om hver inneholder XAPIs rate per sekund: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total` og VM-enes serier for nettverk, nettverksfeil og disklesing og -skriving. Agenten gjør dem om til gauges med uendrede verdier, så OneUptime lagrer dem som ratene de er, i byte eller feil per sekund.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime legger til fire 0/1-serier for hver pool, som varselmalene leser: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` og `xcp_ng.vm.stopped_after_running` (en VM som er stoppet eller satt på pause, og som kjørte det siste døgnet). Den stempler også hvert punkt med `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` eller `xostor`) og `xcp_ng.id` (objektets UUID), som monitorer og dashbord filtrerer på.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Beholdes ikke: Xen Orchestras egne prosesserier (`xo_*`), som ikke hører til noen pool, og en verts strømforbruk lest via IPMI, som tillegget sender uten poolen. Hver VMs anslåtte andel av det beholdes.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "Én agent leser ett Xen Orchestra og hver pool det administrerer. For et andre Xen Orchestra installerer du en andre agent i en egen mappe, med sitt eget containernavn, for to containere kan ikke dele et navn:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Uten `XCP_NG_AGENT_CONTAINER_NAME` navngir skriptet containeren etter mappen. Det lagrer navnet i `.env` til den agenten, så når du kjører skriptet på nytt for å oppgradere agenten, beholdes navnet, og en agent der du en gang redigerte `container_name` i `docker-compose.yml`, beholder det navnet. Med Docker Compose setter du i stedet `XCP_NG_AGENT_CONTAINER_NAME` i `.env` til hver agent.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Ikke la to Xen Orchestra som administrerer den samme poolen, begge bli lest: poolen er én pool i OneUptime, via sin UUID, og ville blitt rapportert to ganger.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Alle ressursattributter med prefikset `oneuptime.label.` blir en prosjektetikett på hver pool agenten leser: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Legg dem til i prosessoren `resource` i `otel-collector-config.yaml`, ved siden av `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Start deretter innsamleren på nytt, så den leser den nye konfigurasjonen:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Poolene vises med etikettene `team:platform` og `env:production`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten. Kjører du installasjonsskriptet på nytt, erstatter det en redigert `otel-collector-config.yaml` og beholder din ved siden av som `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Oppgrader** — innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Kjør installasjonsskriptet på nytt. Det gjenbruker hver verdi i den eksisterende `.env` (ingenting spørres om igjen), kontrollerer Xen Orchestras sertifikat på samme måte, laster ned de nyeste `docker-compose.yml` og `otel-collector-config.yaml` — en fil du har redigert, beholdes ved siden av den nye som `<file>.bak.<timestamp>` —, henter imaget og oppretter agenten på nytt med det:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurasjonen rapporterer innsamlerversjonen den låser til som hver pools **Agentversjon**. Når denne OneUptime låser til en nyere, åpner et varseltegn ved siden av disse kommandoene.",
  "**Uninstall** the agent:": "**Avinstaller** agenten:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Slå deretter av OpenMetrics-tillegget i Xen Orchestra hvis ingenting annet leser det.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` sjekker hele kjeden — containeren, Xen Orchestras sertifikat mot `xo-ca.pem`, tillegget og hemmeligheten, poolene det rapporterer — og spør OneUptime direkte om den godtar inntaksnøkkelen din. Den siste sjekken betyr mest: OneUptimes OTLP-endepunkter avviser en feil nøkkel med `401` eller `422`, som innsamleren logger som én enkelt `Exporting failed`-linje per batch som er lett å overse.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Det avslutter med en avgjørelse som nevner den mest sannsynlige årsaken. Det skriver aldri ut hemmeligheten.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime merker en pool som Frakoblet når ingenting er lest for den på 15 minutter.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Hvis hver pool i dette Xen Orchestra er Frakoblet, sjekker du agenten (i `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` og `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Hvis det bare er én, har Xen Orchestra sluttet å rapportere den: under *Settings → Servers* i Xen Orchestra må poolens server være tilkoblet. Poolens verter, VM-er og lagring forblir slik Xen Orchestra sist rapporterte dem.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Innsamleren logger `server returned HTTP status 401 Unauthorized`. Kopier hemmeligheten på nytt fra *Settings → Plugins → openmetrics*, sett `XO_OPENMETRICS_SECRET` til den i `.env` — mellom enkle anførselstegn, hvert `$` skrevet som `$$` — og ta den i bruk med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`. Før 6.8 lagde Xen Orchestra en ny hemmelighet hver gang det startet på nytt.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra svarer, men OpenMetrics-tillegget gjør det ikke. Slå på tillegget under *Settings → Plugins → openmetrics* (en XOA krever en Premium-lisens for det), og kontroller at Xen Orchestra er 6.9 eller nyere. `/openmetrics/health` svarer `{"status":"ok"}` uten hemmelighet mens tillegget kjører.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — sertifikatet navngir ingen adresse, slik Xen Orchestras eget selvsignerte sertifikat. Gi Xen Orchestra et sertifikat som navngir adressen.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — koble til ett av de navnene, eller sett `XO_TLS_SERVER_NAME` til ett av dem.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` inneholder verken dette sertifikatet eller CA-en som utstedte det. Sertifikatet er fornyet, eller filen inneholder feil sertifikat: skriv den på nytt, slik **Xen Orchestras sertifikat** under Avansert beskriver.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra rapporterer bare poolene det er koblet til, og agenten leser bare det Xen Orchestra. Koble til poolens server under *Settings → Servers* i Xen Orchestra; poolen vises i OneUptime ved neste lesing. En pool som et annet Xen Orchestra leser, trenger sin egen agent, ved siden av det andre Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Hva dette Xen Orchestra skal hete** — kommandoen kaller det allerede **`xo-paris`**, slik denne poolens Innstillinger viser det.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen inneholder allerede OneUptime-URL-en og inntaksnøkkelen din. Resten spør skriptet om:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Last ned `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime til en ny mappe:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Opprett en `.env`-fil ved siden av dem; den inneholder tilleggets hemmelighet, så hold den privat med `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Sett `XO_ADDRESS` til Xen Orchestras `host` eller `host:port`, uten `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Sett tilleggets hemmelighet mellom enkle anførselstegn. Inneholder den et `$`, skriver du hvert som `$$`: innsamleren leser verdien én gang til.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` er det hver pools Innstillinger kaller dette Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Gi deretter agenten Xen Orchestras sertifikat, som `xo-ca.pem` ved siden av `docker-compose.yml` — agenten kontrollerer Xen Orchestra mot denne filen og ingenting annet. For å stole på Xen Orchestras eget sertifikat leser du det og kontrollerer fingeravtrykket mot det på Xen Orchestras maskin:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Hvis en egen CA utstedte det, kopierer du i stedet den CA-ens sertifikat til `xo-ca.pem`; hvis en offentlig CA gjorde det, kopierer du denne maskinens CA-pakke (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten leser disse fra `.env`-filen ved siden av `docker-compose.yml`. Når du har endret en, tar du den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "Når sertifikatet navngir Xen Orchestra med et annet navn enn adressen i `XO_ADDRESS`, setter du `XO_TLS_SERVER_NAME` til det navnet. Når sertifikatet i `xo-ca.pem` fornyes, leser du det på nytt som i trinn 3, og kjører deretter `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kjør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Oppgrader** — innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Last ned begge filene på nytt; `.env` og `xo-ca.pem` blir værende, og en endring du gjorde i en av filene, må gjøres på nytt:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Hent deretter imaget, og gjenopprett agenten, så innsamleren leser den nye konfigurasjonen:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Hvis hver pool i dette Xen Orchestra er Frakoblet, sjekker du agenten (i agentens mappe): `docker compose ps` og `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Innsamleren logger `server returned HTTP status 401 Unauthorized`. Kopier hemmeligheten på nytt fra *Settings → Plugins → openmetrics*, sett `XO_OPENMETRICS_SECRET` til den i `.env` — mellom enkle anførselstegn, hvert `$` skrevet som `$$` — og ta den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`. Før 6.8 lagde Xen Orchestra en ny hemmelighet hver gang det startet på nytt.",
};

export default TRANSLATION;
