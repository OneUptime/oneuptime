import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginet, på en maskine, der kan nå FlashArrays administrationsadresse over HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "En administratorkonto på FlashArray til at oprette agentens skrivebeskyttede bruger",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Opret tokenet **uden udløbsdato**, ellers stopper agenten den dag, det udløber.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Opret forbindelse til FlashArray med SSH som administrator. Den første kommando spørger efter den nye brugers adgangskode; den anden udskriver brugerens API-token:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Åbn **Settings → Users and Policies** (**Settings → Access** i ældre udgivelser).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Vælg **Create User…** i ⋮-menuen i panelet **Users**, giv brugeren navnet `oneuptime`, og tildel den rollen **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Vælg **Create API Token…** i den nye brugers ⋮-menu, lad **Expires In** være tom, og kopiér tokenet.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "En linje `purefa_info{...} 1` betyder, at arrayet leverer sine metrikker indbygget: fortsæt. En **404** betyder, at dets Purity//FA er ældre (Pure dokumenterer det indbyggede endpoint for 6.7.0 og nyere; udfasningsmeddelelsen for deres exporter siger 6.6.11 og nyere): vælg i stedet **FlashArray, ældre Purity** øverst i denne vejledning.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "Den første linje henter scriptet som `install.sh`, så du kan læse det, før du kører det.",
  "The command carries the platform you picked above. The script asks for:":
    "Kommandoen indeholder den platform, du valgte ovenfor. Scriptet spørger efter:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- din **OneUptime-URL** og din **indtagelsesnøgle**, som begge vises i trin 1 (vælg en nøgle dér for at få dem udfyldt her)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- et **arraynavn**: hvordan arrayet vises i OneUptime. Giv hvert array sit eget, og hold det stabilt: et nyt navn registrerer et nyt lagerarray",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArrays **administrationsadresse** (værtsnavn eller IP, uden `https://`) og den skrivebeskyttede brugers **API-token**, som det læser uden at vise det",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- om arrayets certifikat skal verificeres: svar **N**, medmindre arrayet har et certifikat fra en CA, du har tillid til (arrays leveres med et selvsigneret)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Det installerer i `/opt/oneuptime-storage-array-agent`, skriver en `.env`-fil, som kun du kan læse (den indeholder API-tokenet), og starter agenten med Docker Compose.",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "Hent compose-filen og de tre collector-konfigurationer fra denne OneUptime ned i en ny mappe:",
  "Create a `.env` file next to them:": "Opret en `.env`-fil ved siden af dem:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Erstat `my-storage-array` med et navn til dette array, f.eks. `fa-prod-01`. Det er sådan, arrayet vises i OneUptime, så hold det stabilt: et nyt navn registrerer et nyt lagerarray.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sæt `PURE_FA_ENDPOINT` til FlashArrays administrationsadresse (værtsnavn eller IP, uden `https://`) og `PURE_FA_API_TOKEN` til den skrivebeskyttede brugers API-token. Kør `chmod 600 .env`: filen indeholder tokenet.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Kig efter `Everything is ready. Begin running and processing data.` i protokollerne. Arrayet vises derefter automatisk i afsnittet **Lagerarrays** efter sin første aflæsning, som regel inden for et par minutter.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Installationsscriptet skriver disse til `/opt/oneuptime-storage-array-agent/.env`; en installation med Docker Compose læser dem fra `.env`-filen ved siden af `docker-compose.yml`. Når du har ændret en, skal du anvende den med `docker compose up -d` i agentens mappe.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-indtagelsesnøglen, den der blev valgt i trin 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Det navn, arrayet registreres under i OneUptime. Sat på hver metrik som ressourceattributten `storage.array.name`. Hold det stabilt: ændrer du det, registreres et nyt lagerarray |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Nej | Platformen, sat som ressourceattributten `storage.system`: `purestorage.flasharray` eller `purestorage.flashblade` (standard: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nej | Hvilken medfølgende konfiguration der kører: `otel-collector-config.yaml` (FlashArray, indbygget; standarden), `otel-collector-config.flasharray-exporter.yaml` (ældre FlashArray) eller `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Nej | Starter den exporter, konfigurationen har brug for: tom for den indbyggede FlashArray-konfiguration, `flasharray-exporter` eller `flashblade` for de andre |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArrays administrationsadresse: værtsnavn eller IP, uden `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | API-token for FlashArray-brugeren med rollen readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlades administrationsadresse: værtsnavn eller IP, uden `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | API-token for FlashBlade-brugeren med rollen readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nej | `true` accepterer arrayets selvsignerede certifikat på det indbyggede endpoint; `false` verificerer det (standard: `true`). Pures exportere verificerer aldrig arrayets certifikat, så den gælder ikke for dem |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Nej | Agentens containernavn (standard: `oneuptime-storage-array-agent`). Et andet arrays agent på samme maskine skal have sit eget: installationsscriptet navngiver en ny agent efter dens mappe, medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Collectoren læser FlashArrays eget OpenMetrics-endpoint over HTTPS med tokenet som Bearer-legitimation: der kører ingen exporter.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Ét aflæsningsjob pr. endpoint**, hvert læst så ofte, som det er værd: `/metrics/array` hvert 60. sekund; `/metrics/volumes`, `/metrics/hosts` og `/metrics/pods` hvert 2. minut; `/metrics/directories` hvert 30. minut, for mappers plads er dyr for arrayet at beregne.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Hvert job sætter labelet `scrape_endpoint: <endpoint>` på sine serier**, så OneUptime ved, hvilke objekter en batch er den fulde liste over: sådan forsvinder et slettet objekt fra inventaret. Bevar labels, som de leveres.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **Latens pr. diskenhed og pr. vært beholder tre dimensioner** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); en regel i `metric_relabel_configs` dropper opdelingen efter QoS, kø, SAN og servicetid, som ganger antallet af serier for et stort array. Opdelingen for hele arrayet bevares.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Ingen `send_batch_max_size`.** OneUptime genopbygger inventaret ud fra én hel aflæsning, så processoren `batch` deler aldrig en op.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dette er den fulde `otel-collector-config.yaml`, som agenten kører; `.env`-filen leverer værdierne `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "Agenten sender kun metrikker, indtil du slår dens syslog-receivere til. Arrays videresender deres advarsler og revisionshændelser som syslog; agenten sætter `storage.array.name` på hver linje, så de lander på dette arrays side **Protokoller**.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Fjern i `otel-collector-config.yaml` udkommenteringen af receiverne `syslog/tcp` og `syslog/udp` og pipelinen `logs`. Klassiske BSD-syslog-tidsstempler har ingen tidszone: sæt `location` til arrayets tidszone, medmindre dets ur kører i UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Fjern i `docker-compose.yml` udkommenteringen af blokken `ports:`, der udgiver `5514/tcp` og `5514/udp`, og åbn porten i maskinens firewall for arrayets administrationsnetværk.",
  "3. Apply both:": "3. Anvend begge:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Åbn som administrator på FlashArray **Settings → System → Syslog Servers**, tilføj `udp://<agent-host>:5514` (eller `tcp://<agent-host>:5514`), og send en testmeddelelse.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver et projektlabel på arrayet: `oneuptime.label.<dimension>=<value>` er labelet `<dimension>:<value>`. Tilføj dem til processoren `resource` i den collector-konfiguration, du bruger, ved siden af `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Genstart derefter collectoren, så den læser den nye konfiguration:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Arrayet vises med labelerne `team:storage` og `env:production`. Labels sammenlignes uden hensyn til store og små bogstaver, så et eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Hver værdi er en gauge, som FlashArray selv beregner: latens pr. operation i mikrosekunder, gennemløb pr. sekund. OneUptimes lagerarray-sider, metrikkatalog og advarselsskabeloner bygger på:",
  "| Endpoint | Data |": "| Endpoint | Indsamlede data |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, kapacitet og datareduktion (`purefa_array_space_*`), ydeevne, åbne advarsler (`purefa_alerts_open`), hardwarekomponenter, drev, controllere og netværksgrænseflader |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Diskenheder** (`/metrics/volumes`) | Latens, IOPS, båndbredde, plads og datareduktion pr. diskenhed |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Værter** (`/metrics/hosts`) | Forbindelse, tilsluttede diskenheder, latens, IOPS og plads pr. vært |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Forsinkelse på replikaforbindelser for ActiveCluster og ActiveDR, mediatorstatus, ydeevne og plads |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Mapper** (`/metrics/directories`) | Plads og ydeevne for de administrerede mapper i FlashArrays filtjenester |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Én agent læser ét array. For at overvåge flere fra samme maskine skal du installere hver i sin egen mappe med sin egen `.env` og sit eget containernavn, for to containere kan ikke dele et navn:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Uden `STORAGE_ARRAY_AGENT_CONTAINER_NAME` navngiver scriptet containeren efter mappen. Det gemmer navnet i den agents `.env`, så når du kører scriptet igen for at opgradere agenten, beholdes navnet, og en agent, hvis `container_name` du engang redigerede i `docker-compose.yml`, beholder det navn. Med Docker Compose sætter du i stedet `STORAGE_ARRAY_AGENT_CONTAINER_NAME` i hver agents `.env`.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "Agenten leveres med en systemd-unit, der forudsætter installationsscriptets mappe, `/opt/oneuptime-storage-array-agent`. Installationsscriptet henter den ikke, så hent den selv:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Opgrader**: collector-imaget er fastlåst i `docker-compose.yml`, og dens konfigurationer er filer ved siden af, så det at hente imaget alene bringer ikke agenten videre. Kør installationsscriptet igen. Det genbruger hver værdi i din eksisterende `.env` (der spørges ikke om noget igen), henter den seneste `docker-compose.yml` og de seneste collector-konfigurationer (en fil, du har redigeret, beholdes ved siden af den nye som `<file>.bak.<timestamp>`) og genopretter agenten med dem:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "En agent, der er installeret uden for `/opt/oneuptime-storage-array-agent` (f.eks. et andet arrays), skal have sin mappe: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Installerede du den med Docker Compose i stedet? Hent compose-filen og de tre collector-konfigurationer igen i agentens mappe; din `.env` bliver, og en ændring, du har lavet i nogen af dem, skal laves igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent derefter imagene, og genopret agenten, så collectoren læser sin nye konfiguration:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterer den collector-version, den fastlåser, som arrayets **Agentversion**. Når denne OneUptime fastlåser en nyere, åbner et advarselstegn ved siden af disse kommandoer.",
  "**Uninstall** the agent:": "**Afinstallér** agenten:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Slet derefter den skrivebeskyttede bruger og dens API-token på arrayet, hvis du ikke længere har brug for dem.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` tjekker hele kæden (container-runtime, arrayets endpoint præcis, som collectoren når det, altså det indbyggede endpoint eller Pures exporter, med DNS, TLS og API-tokenet, påsætningen af arraynavnet, collectorens egne metrikker) og spørger OneUptime direkte, om den accepterer din indtagelsesnøgle. Det sidste tjek betyder mest: OneUptimes OTLP-endpoints afviser en forkert nøgle med `401` eller `422`, hvilket collectoren logger som én enkelt, let overset linje `Exporting failed` pr. batch, så scriptet spørger `GET /otlp/v1/validate` om en direkte afgørelse 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det slutter med en afgørelse, der nævner den mest sandsynlige årsag.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Tjek collectorens protokoller: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` betyder, at arrayet afviste API-tokenet, `404`, at FlashArray ikke har et indbygget endpoint, `x509`, at TLS-verificering er slået til over for arrayets selvsignerede certifikat, `no such host` eller `connection refused` et forkert `PURE_FA_ENDPOINT`, og en `401` ved eksport en forkert indtagelsesnøgle.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Sørg for, at `STORAGE_ARRAY_NAME` er sat: registreringen bygger på ressourceattributten `storage.array.name`, og collectoren nægter at starte uden den.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Sørg for, at `STORAGE_ARRAY_COLLECTOR_CONFIG` og `COMPOSE_PROFILES` angiver den samme platform.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Dets Purity//FA har intet indbygget OpenMetrics-endpoint. Sæt `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` og `COMPOSE_PROFILES=flasharray-exporter` i `.env`, og kør `docker compose up -d`, eller kør `install.sh` igen med valget for ældre Purity. Når arrayet er opgraderet til Purity//FA 6.7 eller nyere, skifter du tilbage til den indbyggede konfiguration og fjerner profilen.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Tjek, at du har indsat tokenet og ikke brugerens adgangskode, at brugeren stadig findes og har rollen readonly, og at tokenet ikke er udløbet. Opret et nyt token (`pureadmin create --api-token oneuptime` på en FlashArray), læg det i `.env` som `PURE_FA_API_TOKEN`, og kør `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Arrays præsenterer som standard et selvsigneret certifikat, som intet Docker-image har tillid til. Sæt `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (det pragmatiske valg på et privat administrationsnetværk), eller installér et certifikat på arrayet fra en CA, som collector-imaget har tillid til.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` eller `pure-fb-exporter` kører ikke: `COMPOSE_PROFILES` skal passe til `STORAGE_ARRAY_COLLECTOR_CONFIG`, altså `flasharray-exporter` til FlashArray-exporter-konfigurationen og `flashblade` til FlashBlade-konfigurationen. Ret `.env`, og kør `docker compose up -d`; `docker compose ps` viser derefter exporteren.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Tjek, at agenten kører: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Tjek agentens protokoller for fejl: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekræft, at din OneUptime-URL og indtagelsesnøgle er korrekte.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for, at agentens maskine kan nå OneUptime-instansen over netværket.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Arrayets identitet kommer fra `STORAGE_ARRAY_NAME`, sat på hver metrik som `storage.array.name`. Ret den i `.env`, og anvend den med `docker compose up -d` i agentens mappe; bemærk, at et nyt navn registrerer et nyt lagerarray.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Det registrerer arrayet som **`array-1`**, det navn, dette array allerede har i OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Dette installerer agenten for **`array-1`**: lad `STORAGE_ARRAY_NAME` stå præcis, som det er, ellers registreres dataene som et nyt lagerarray.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Arrayets identitet kommer fra `STORAGE_ARRAY_NAME`, sat på hver metrik som `storage.array.name`. Dette array er **`array-1`**. Ret den i `.env`, og anvend den med `docker compose up -d` i agentens mappe; bemærk, at et nyt navn registrerer et nyt lagerarray.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Kommandoen indeholder allerede din OneUptime-URL, din indtagelsesnøgle og den platform, du valgte ovenfor. Scriptet spørger efter:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Adgang fra den maskine til `quay.io`, hvorfra Docker henter Pures exporter-image",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` starter `pure-fa-exporter`, Pures exporter, ved siden af collectoren; de to skal passe sammen.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` i agentens mappe viser også **`pure-fa-exporter`**, Pures exporter, som collectoren læser FlashArray gennem.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Collectoren læser FlashArray gennem `pure-fa-exporter`, Pures exporter, som logger på FlashArrays REST API med det token, collectoren sender ved hver aflæsning. Exporterens port bliver på compose-netværket.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginet, på en maskine, der kan nå FlashBlades administrationsadresse over HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "En administratorkonto på FlashBlade til at oprette agentens skrivebeskyttede bruger",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Opret som administrator på FlashBlade en bruger ved navn `oneuptime` med rollen **readonly** (i brugerindstillingerne i FlashBlades GUI eller med `pureadmin` i Purity//FB-CLI'en), og opret et **API-token** til den. Opret tokenet **uden udløbsdato**, ellers stopper agenten den dag, det udløber.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlades API-tokens starter med `T-`. En Purity//FB-udgivelse uden lokale brugere bruger i stedet en konto fra en katalogtjeneste (LDAP eller Active Directory), hvis gruppe er knyttet til rollen readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlades **administrationsadresse** (værtsnavn eller IP, uden `https://`) og den skrivebeskyttede brugers **API-token**, som det læser uden at vise det",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sæt `PURE_FB_ENDPOINT` til FlashBlades administrationsadresse (værtsnavn eller IP, uden `https://`) og `PURE_FB_API_TOKEN` til den skrivebeskyttede brugers API-token. Kør `chmod 600 .env`: filen indeholder tokenet.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` i agentens mappe viser også **`pure-fb-exporter`**, Pures exporter, som collectoren læser FlashBlade gennem.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Collectoren læser FlashBlade gennem `pure-fb-exporter`, Pures exporter, som logger på FlashBlades REST API med det token, collectoren sender ved hver aflæsning. Exporterens port bliver på compose-netværket.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Ét aflæsningsjob pr. endpoint**, hvert læst så ofte, som det er værd: `/metrics/array` hvert 60. sekund; `/metrics/filesystems` og `/metrics/objectstore` hvert 5. minut, for FlashBlades REST API er ikke bygget til hurtigt at rapportere hvert filsystem og hver bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Tilføj som administrator på FlashBlade en syslog-server `udp://<agent-host>:5514` (eller `tcp://`) i dens syslog-indstillinger.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Hver værdi er en gauge, som FlashBlade selv beregner: latens pr. operation i mikrosekunder, gennemløb pr. sekund. OneUptimes lagerarray-sider, metrikkatalog og advarselsskabeloner bygger på:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, kapacitet og datareduktion (`purefb_array_space_*`), ydeevne pr. protokol, åbne advarsler (`purefb_alerts_open`), hardwaretilstand (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Filsystemer** (`/metrics/filesystems`) | Plads, datareduktion og ydeevne pr. filsystem |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Objektlager** (`/metrics/objectstore`) | Plads, kvote, antal objekter og ydeevne pr. bucket |",
};

export default TRANSLATION;
