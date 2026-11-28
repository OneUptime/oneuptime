import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-pluginet, på en maskine, der kan nå dine Ceph-mgr-daemoner på port 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "En shell på en Ceph-administrationsnode, hvor `ceph`-CLI'en virker med administratorrettigheder",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "List derefter dine mgr-daemoner: agenten skal bruge **alle**, den aktive og standby'erne:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Kun den **aktive** mgr returnerer metrikker (standby'er svarer med et tomt svar), så ved at aflæse hver mgr bliver metrikkerne ved med at komme, når den aktive skifter.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Scriptet spørger efter din OneUptime-URL og din indtagelsesnøgle, som begge vises i trin 1 (vælg en nøgle dér for at få dem udfyldt her), og derefter efter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klyngenavn**: hvordan klyngen vises i OneUptime. Giv hver klynge sit eget, og hold det stabilt: et nyt navn registrerer en ny klynge.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr-endpoints**: hver mgr fra det forrige trin som kommaseparerede `host:port`, f.eks. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Scriptet tilføjer de firkantede parenteser.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI-agent**: om den må anvende rettelser; svar **N** for at holde den skrivebeskyttet. Hvor `ceph` virker med administratorrettigheder, tilbyder scriptet også at oprette AI-agentens egen Ceph-klient.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerer i `/opt/oneuptime-ceph-agent`, skriver en `.env`-fil med `0600` og starter agenten med Docker Compose. Kører du scriptet igen, genbruger det alt i den `.env` i stedet for at spørge igen, så det er også sådan, du opgraderer.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Kig efter `Everything is ready. Begin running and processing data.` i protokollerne. Klyngen vises derefter automatisk i afsnittet **Ceph**, som regel inden for et minuts tid.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose kører også **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Hvis installationsscriptet oprettede dens Ceph-klient, virker den allerede; ellers venter den på en; se **OneUptime AI-agent** under Avanceret.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI-agent (slået til som standard, skrivebeskyttet).** AI-undersøgelser er slået til: så snart den har sin Ceph-klient, lader den OneUptime AI undersøge hændelser og advarsler på denne klynge med skrivebeskyttede `ceph`-kommandoer, og den ændrer intet, medmindre du tillader rettelser.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Installationsscriptet skriver disse til `/opt/oneuptime-ceph-agent/.env`. Når du har ændret en, skal du anvende den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-indtagelsesnøglen, den der blev valgt i trin 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Ja | Klyngens identifikator, som vises i OneUptime. Sat på hver metrik som ressourceattributten `ceph.cluster.name`. Hold den stabil: ændrer du den, registreres en ny klynge (standard: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommasepareret `host:port`-liste over **alle** mgr-daemoner i firkantede parenteser, f.eks. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Installationsscriptet tilføjer parenteserne for dig |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egne indstillinger står under **OneUptime AI-agent**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Alle mgr'er aflæses** (den aktive og standby'erne), så metrikkerne overlever et failover af den aktive mgr.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Hvert 30. sekund.** mgr'ens prometheus-modul cacher en aflæsning i `mgr/prometheus/scrape_interval` (15 sekunder som standard): aflæs aldrig oftere, du ville bare læse cachen igen.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** bevarer de labels, Ceph eksporterer (`ceph_daemon`, `pool_id`), som de er, så serierne forbliver sammenhængende på tværs af mgr-failovers.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dette er den fulde `otel-collector-config.yaml`, som agenten kører; `.env`-filen leverer værdierne `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "Agenten kan følge `/var/log/ceph/ceph.log` og sende den til OneUptime, hvilket udfylder siden **Klyngelog**. Det er slået fra som standard, fordi agenten skal køre på en vært, der har klyngeloggen, som standard en mon-vært.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Fjern i `otel-collector-config.yaml` kommentaren fra receiveren `filelog` og pipelinen `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Fjern i `docker-compose.yml` kommentaren fra volumen `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Anvend begge:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Linjerne sendes uændret; OneUptime fortolker ceph.log-formatet (tidsstempel, daemon, niveau INF/WRN/ERR, meddelelse), når den læser dem, og processoren `resource` sætter `ceph.cluster.name`, så loggen lander på denne klynge.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver et projektlabel på klyngen: `oneuptime.label.<dimension>=<value>` er labelet `<dimension>:<value>`. Tilføj dem til processoren `resource` i `otel-collector-config.yaml` ved siden af `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Genstart derefter collectoren, så den læser den nye konfiguration:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klyngen vises med labelerne `team:storage` og `env:production`. Labels sammenlignes uden hensyn til store og små bogstaver, så et eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "Agenten sender alt, hvad mgr'ens prometheus-modul eksporterer. OneUptimes Ceph-sider, metrikkatalog og advarselsskabeloner bygger på:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Klyngens sundhed** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitorkvorum, samlet og brugt rå kapacitet |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Up-/in-tilstand for hver OSD (pr. label `ceph_daemon`, f.eks. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Lagrede bytes, maks. tilgængelig, antal objekter, læse-/skriveoperationer og gennemløb pr. pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Antal aktive, forringede og underdimensionerede PG'er |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kører også **`oneuptime-ceph-ai-agent`**. Mens OneUptime AI undersøger en hændelse eller advarsel på denne klynge, kører den `ceph`-kommandoer gennem den: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Den registrerer sig som klyngen med navnet `CEPH_CLUSTER_NAME` og vises på klyngens side **AI → AI-agent**.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Den forbinder som sin egen Ceph-klient, `client.oneuptime-ai`, med klyngens minimale `ceph.conf` og den klients keyring i en mappe `ceph/` ved siden af `docker-compose.yml`. Installationsscriptet tilbyder at oprette dem ved en ny installation, når `ceph` virker med administratorrettigheder på den maskine, du kører det på. Ellers, eller for at tilføje dem senere, på en Ceph-administrationsnode:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Kører agenten på en anden maskine, skal du kopiere de to filer til dens mappe `ceph/` på samme måde. **Læg aldrig administrator-keyringen dér.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Klientens caps er den hårde grænse.** Med disse læsecaps kan intet, den kører, ændre klyngen. Rettelser (at sætte en OSD tilbage til in, at fjerne `noout`) kræver også `ONEUPTIME_AI_ALLOW_WRITES=true` i `.env` og rettelses-caps'ene fra agentens README.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Tjek den: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Bruger du ikke OneUptime AI? Slet tjenesten `oneuptime-ceph-ai-agent` fra `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Hvad den må køre, og hvordan rettelser virker: [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Opgrader**: collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Kør installationsscriptet igen. Det genbruger hver værdi i din eksisterende `.env` (der spørges ikke om noget igen), henter den seneste `docker-compose.yml` og `otel-collector-config.yaml` (en fil, du har redigeret, beholdes ved siden af den nye som `<file>.bak.<timestamp>`), henter imagene og genopretter agenten med dem. AI-agentens mappe `ceph/` forbliver, som den er:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterer den collector-version, den fastlåser, som klyngens **Agentversion**. Når denne OneUptime fastlåser en nyere, åbner et advarselstegn ved siden af disse kommandoer.",
  "**Uninstall** the agent:": "**Afinstallér** agenten:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Har du oprettet AI-agentens Ceph-klient, skal du fjerne den på en administrationsnode: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` tjekker hele kæden (container-runtime, hvert mgr-endpoint inklusive fælden med aktiv over for standby, påsætningen af klyngenavnet, tokenets form, collectorens egne metrikker) og spørger OneUptime direkte, om den accepterer din indtagelsesnøgle. Det sidste tjek betyder mest: OneUptimes OTLP-endpoints afviser en forkert nøgle med `401` eller `422`, hvilket collectoren logger som én enkelt, let overset linje `Exporting failed` pr. batch, så scriptet spørger `GET /otlp/v1/validate` om en direkte afgørelse 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det slutter med en afgørelse, der nævner den mest sandsynlige årsag.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Tjek collectorens protokoller: `docker logs oneuptime-ceph-agent`; kig efter eksportfejl (`401` betyder en forkert indtagelsesnøgle, connection refused betyder en forkert `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Bekræft, at et mgr-endpoint leverer metrikker: `curl http://<active-mgr>:9283/metrics | head`; du burde se linjer med `ceph_*`-metrikker. Hvis ikke, skal du slå modulet til: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Sørg for, at `CEPH_MGR_ENDPOINTS` står i firkantede parenteser: uden dem behandler collectoren hele den kommaseparerede streng som ét (ugyldigt) mål.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Tjek, at agenten kører: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Tjek agentens protokoller for fejl: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekræft, at din OneUptime-URL og indtagelsesnøgle er korrekte.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for, at agentens maskine kan nå OneUptime-instansen over netværket.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Du aflæser sandsynligvis kun den (tidligere) aktive mgr. List **hver** mgr-daemon i `CEPH_MGR_ENDPOINTS`: aflæsninger af standby-mgr'er er billige og returnerer tomme svar.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Det er forventet, hvis `mgr/prometheus/standby_behaviour` er sat til `error` på din klynge: standby'er svarer så med HTTP 500. Aflæsningen af den aktive mgr lykkes stadig, så fejlene er støj; sæt adfærden tilbage til `default` for at få dem til at tie.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, sat på hver metrik som `ceph.cluster.name`. Ret den i `.env`, og anvend den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; bemærk, at et nyt navn registrerer en ny klynge.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Klyngenavn**: indtast præcis **`ceph-1`**; et andet navn registrerer en ny klynge.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, sat på hver metrik som `ceph.cluster.name`. Denne klynge er **`ceph-1`**. Ret den i `.env`, og anvend den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; bemærk, at et nyt navn registrerer en ny klynge.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen indeholder allerede din OneUptime-URL og indtagelsesnøgle. Resten spørger scriptet om:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Hent `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime ned i en ny mappe:",
  "Create a `.env` file next to them:": "Opret en `.env`-fil ved siden af dem:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Erstat `my-ceph-cluster` med et navn til denne klynge, f.eks. `ceph-prod`. Det er sådan, klyngen vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny klynge.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- List **hver** mgr-daemon i `CEPH_MGR_ENDPOINTS`, kommaseparerede og i firkantede parenteser: uden parenteserne læser collectoren hele listen som ét ugyldigt mål.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose starter også **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Den venter på sin egen Ceph-klient; se **OneUptime AI-agent** under Avanceret, eller slet dens tjeneste fra `docker-compose.yml`, hvis du ikke bruger OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten læser disse fra `.env`-filen ved siden af `docker-compose.yml`. Når du har ændret en, skal du anvende den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommasepareret `host:port`-liste over **alle** mgr-daemoner i firkantede parenteser, f.eks. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Den forbinder som sin egen Ceph-klient, `client.oneuptime-ai`, med klyngens minimale `ceph.conf` og den klients keyring i en mappe `ceph/` ved siden af `docker-compose.yml`. På en Ceph-administrationsnode, i agentens mappe:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Opgrader**: collector-imaget er fastlåst i `docker-compose.yml`, og dens konfiguration er en fil ved siden af, så det at hente imaget alene bringer ikke agenten videre. Hent begge filer igen; din `.env` bliver, og en ændring, du havde lavet i en af filerne, skal laves igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent derefter imagene, og genopret agenten, så collectoren læser sin nye konfiguration:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, sat på hver metrik som `ceph.cluster.name`. Ret den i `.env`, og anvend den med `docker compose up -d` i mappen med `docker-compose.yml`; bemærk, at et nyt navn registrerer en ny klynge.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dette installerer agenten for **`ceph-1`**: lad `CEPH_CLUSTER_NAME` stå præcis, som det er, ellers registreres dataene som en ny klynge.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, sat på hver metrik som `ceph.cluster.name`. Denne klynge er **`ceph-1`**. Ret den i `.env`, og anvend den med `docker compose up -d` i mappen med `docker-compose.yml`; bemærk, at et nyt navn registrerer en ny klynge.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-ceph-agent`). En anden klynges agent på samme maskine skal have sine egne navne: installationsscriptet navngiver en ny agents containere efter dens mappe, medmindre du angiver dem, og beholder dem, når du kører scriptet igen |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-ceph-ai-agent`). Installationsscriptet navngiver en anden klynges AI-agent efter dens collector (`oneuptime-ceph-ai-agent-cluster2` ved siden af `oneuptime-ceph-agent-cluster2`), medmindre du angiver det, og beholder det, når du kører scriptet igen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent læser én klynge. Til en anden klynge skal du installere en anden agent i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Scriptet navngiver containerne efter mappen, fx `oneuptime-ceph-agent-cluster2`, medmindre du angiver deres variabler, fx `CEPH_AGENT_CONTAINER_NAME`. Det gemmer navnene i den agents `.env`, så når du kører scriptet igen med samme `INSTALL_DIR` for at opgradere agenten, beholdes navnene, og en agent, hvis `container_name` du engang redigerede i `docker-compose.yml`, beholder det navn.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så scriptet afviser en mappe, der hedder det samme som en, der allerede kører en agent et andet sted. Giv mappen til diagnosescriptet med `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nej | Collectorens containernavn (standard: `oneuptime-ceph-agent`). En anden klynges agent på samme maskine skal have sit eget |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernavn (standard: `oneuptime-ceph-ai-agent`). En anden klynges agent på samme maskine skal have sit eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent læser én klynge. Til en anden klynge skal du sætte en anden agent op i sin egen mappe, med sine egne containernavne, for to containere kan ikke dele et navn. Angiv dem i den agents `.env`:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Giv hver mappe sit eget navn: Docker Compose navngiver et projekt efter dets mappe alene, så en anden mappe med samme navn ville erstatte den første agents containere. Hold navnene ude af `docker-compose.yml`, som en opgradering erstatter.",
};

export default TRANSLATION;
