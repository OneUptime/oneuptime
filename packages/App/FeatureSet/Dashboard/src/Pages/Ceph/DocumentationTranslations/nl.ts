import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 of nieuwer met de plugin Docker Compose v2, op een machine die je Ceph-mgr-daemons op poort 9283 kan bereiken",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Een shell op een Ceph-beheerknooppunt, waar de `ceph`-CLI met beheerrechten werkt",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Toon daarna je mgr-daemons: de agent heeft ze **allemaal** nodig, de actieve en de standby's:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Alleen de **actieve** mgr levert metrieken (standby's antwoorden met een leeg antwoord), dus door elke mgr uit te lezen blijven de metrieken binnenkomen als de actieve overschakelt.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Het script vraagt om je OneUptime-URL en je ingestiesleutel, die allebei in stap 1 staan (kies daar een sleutel om ze hier ingevuld te krijgen), en daarna om:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Clusternaam**: hoe het cluster in OneUptime verschijnt. Geef elk cluster een eigen naam en houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr-endpoints**: elke mgr uit de vorige stap als kommagescheiden `host:port`, bijv. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Het script voegt de vierkante haken toe.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI-agent**: of hij oplossingen mag toepassen; antwoord **N** om hem alleen-lezen te houden. Waar `ceph` met beheerrechten werkt, biedt het script ook aan de eigen Ceph-client van de AI-agent aan te maken.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Het installeert naar `/opt/oneuptime-ceph-agent`, schrijft een `.env`-bestand met `0600` en start de agent met Docker Compose. Het script opnieuw draaien hergebruikt alles in die `.env` in plaats van opnieuw te vragen, en zo upgrade je ook.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Zoek naar `Everything is ready. Begin running and processing data.` in de logboeken. Het cluster verschijnt dan automatisch in het onderdeel **Ceph**, meestal binnen een minuut of zo.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose draait ook **`oneuptime-ceph-ai-agent`**, de OneUptime AI-agent. Als het installatiescript zijn Ceph-client heeft aangemaakt, werkt hij al; anders wacht hij op een; zie **OneUptime AI-agent** onder Geavanceerd.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI-agent (standaard aan, alleen-lezen).** AI-onderzoeken staan aan: zodra hij zijn Ceph-client heeft, laat hij OneUptime AI incidenten en waarschuwingen op dit cluster onderzoeken met alleen-lezen `ceph`-opdrachten, en hij verandert niets tenzij je oplossingen toestaat.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Het installatiescript schrijft deze naar `/opt/oneuptime-ceph-agent/.env`. Pas na een wijziging de waarde toe met `docker compose up -d` in `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | De telemetrie-ingestiesleutel, die je in stap 1 hebt gekozen |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Ja | De clusteraanduiding die OneUptime toont. Op elke metriek gezet als het resourceattribuut `ceph.cluster.name`. Houd hem stabiel: wijzigen registreert een nieuw cluster (standaard: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommagescheiden `host:port`-lijst van **alle** mgr-daemons, tussen vierkante haken, bijv. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Het installatiescript voegt de haken voor je toe |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "De eigen instellingen van de OneUptime AI-agent staan onder **OneUptime AI-agent**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Alle mgr's worden uitgelezen** (de actieve en de standby's), zodat metrieken een failover van de actieve mgr overleven.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Elke 30 seconden.** De prometheus-module van de mgr cachet een uitlezing gedurende `mgr/prometheus/scrape_interval` (standaard 15 seconden): lees nooit vaker uit, je zou alleen de cache opnieuw lezen.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** houdt de labels die Ceph exporteert (`ceph_daemon`, `pool_id`) zoals ze zijn, zodat de reeksen doorlopend blijven over mgr-failovers heen.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dit is de volledige `otel-collector-config.yaml` die de agent draait; het `.env`-bestand levert de waarden `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "De agent kan `/var/log/ceph/ceph.log` volgen en naar OneUptime sturen, wat de pagina **Clusterlogboek** vult. Het staat standaard uit, omdat de agent moet draaien op een host die het clusterlogboek heeft, standaard een mon-host.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Haal in `otel-collector-config.yaml` het commentaar weg bij de receiver `filelog` en de pipeline `logs`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Haal in `docker-compose.yml` het commentaar weg bij het volume `/var/log/ceph:/var/log/ceph:ro`.",
  "3. Apply both:": "3. Pas beide toe:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Regels gaan ongewijzigd mee; OneUptime ontleedt het ceph.log-formaat (tijdstempel, daemon, niveau INF/WRN/ERR, bericht) bij het lezen, en de processor `resource` zet `ceph.cluster.name`, zodat het logboek bij dit cluster terechtkomt.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op het cluster: `oneuptime.label.<dimension>=<value>` is het label `<dimension>:<value>`. Voeg ze toe aan de processor `resource` in `otel-collector-config.yaml`, naast `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Herstart daarna de collector zodat hij de nieuwe configuratie leest:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Het cluster verschijnt met de labels `team:storage` en `env:production`. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "De agent stuurt alles wat de prometheus-module van de mgr exporteert. De Ceph-pagina's, de metriekcatalogus en de waarschuwingssjablonen van OneUptime zijn gebaseerd op:",
  "| Category | Data |": "| Categorie | Gegevens |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Clustergezondheid** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitorquorum, totale en gebruikte ruwe capaciteit |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Up-/in-status van elke OSD (per label `ceph_daemon`, bijv. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Opgeslagen bytes, maximaal beschikbaar, aantal objecten, lees-/schrijfbewerkingen en doorvoer per pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Aantal actieve, gedegradeerde en onderbezette PG's |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` draait ook **`oneuptime-ceph-ai-agent`**. Terwijl OneUptime AI een incident of waarschuwing op dit cluster onderzoekt, voert het daarmee `ceph`-opdrachten uit: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Hij meldt zich aan als het cluster met de naam `CEPH_CLUSTER_NAME` en staat op de pagina **AI → AI-agent** van het cluster.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Hij maakt verbinding als eigen Ceph-client, `client.oneuptime-ai`, met de minimale `ceph.conf` van het cluster en de keyring van die client in een map `ceph/` naast `docker-compose.yml`. Het installatiescript biedt bij een nieuwe installatie aan ze aan te maken, als `ceph` met beheerrechten werkt op de machine waarop je het draait. Anders, of om ze later toe te voegen, op een Ceph-beheerknooppunt:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Draait de agent op een andere machine, kopieer de twee bestanden dan op dezelfde manier naar zijn map `ceph/`. **Zet daar nooit de beheerkeyring.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **De caps van de client zijn de harde grens.** Met deze leescaps kan niets wat hij uitvoert het cluster wijzigen. Oplossingen (een OSD weer op in zetten, `noout` wissen) hebben ook `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` nodig en de caps voor oplossingen uit de README van de agent.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Controleer hem: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Gebruik je OneUptime AI niet? Verwijder de service `oneuptime-ceph-ai-agent` uit `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Wat hij mag uitvoeren en hoe oplossingen werken: [AI-agents voor infrastructuur](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Upgraden**: de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Draai het installatiescript opnieuw. Het hergebruikt elke waarde in je bestaande `.env` (er wordt niets opnieuw gevraagd), downloadt de nieuwste `docker-compose.yml` en `otel-collector-config.yaml` (een bestand dat je hebt bewerkt, blijft naast het nieuwe staan als `<file>.bak.<timestamp>`), haalt de images op en maakt de agent er opnieuw mee aan. De map `ceph/` van de AI-agent blijft zoals hij is:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "De configuratie meldt de collectorversie die ze vastzet als de **Agentversie** van het cluster. Zet deze OneUptime een nieuwere vast, dan opent een waarschuwingsteken ernaast deze opdrachten.",
  "**Uninstall** the agent:": "**Verwijder** de agent:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Heb je de Ceph-client van de AI-agent aangemaakt, verwijder hem dan op een beheerknooppunt: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` controleert de hele keten (containerruntime, elk mgr-endpoint inclusief de valkuil actief tegenover standby, het zetten van de clusternaam, de vorm van het token, de eigen metrieken van de collector) en vraagt OneUptime rechtstreeks of het je ingestiesleutel accepteert. Die laatste controle telt het zwaarst: de OTLP-endpoints van OneUptime weigeren een verkeerde sleutel met `401` of `422`, wat de collector per batch logt als één makkelijk te missen regel `Exporting failed`, dus het script vraagt `GET /otlp/v1/validate` om een direct oordeel 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Het eindigt met een oordeel dat de waarschijnlijkste oorzaak noemt.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Controleer de logboeken van de collector: `docker logs oneuptime-ceph-agent`; zoek naar exportfouten (`401` betekent een verkeerde ingestiesleutel, connection refused een verkeerde `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Controleer of een mgr-endpoint metrieken levert: `curl http://<active-mgr>:9283/metrics | head`; je zou regels met `ceph_*`-metrieken moeten zien. Zo niet, zet de module aan: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Zorg dat `CEPH_MGR_ENDPOINTS` tussen vierkante haken staat: zonder haken behandelt de collector de hele kommagescheiden tekenreeks als één (ongeldig) doel.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Controleer of de agent draait: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Controleer de logboeken van de agent op fouten: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Controleer of je OneUptime-URL en ingestiesleutel kloppen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Zorg dat de machine van de agent de OneUptime-instantie via het netwerk kan bereiken.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Waarschijnlijk lees je alleen de (eerder) actieve mgr uit. Zet **elke** mgr-daemon in `CEPH_MGR_ENDPOINTS`: uitlezingen van standby-mgr's zijn goedkoop en leveren lege antwoorden.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Te verwachten als `mgr/prometheus/standby_behaviour` op je cluster op `error` staat: standby's antwoorden dan met HTTP 500. De uitlezing van de actieve mgr slaagt nog steeds, dus de fouten zijn ruis; zet het gedrag terug op `default` om ze stil te zetten.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `CEPH_CLUSTER_NAME`, op elke metriek gezet als `ceph.cluster.name`. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in `/opt/oneuptime-ceph-agent`; let op: een nieuwe naam registreert een nieuw cluster.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Clusternaam**: vul precies **`ceph-1`** in; een andere naam registreert een nieuw cluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `CEPH_CLUSTER_NAME`, op elke metriek gezet als `ceph.cluster.name`. Dit cluster is **`ceph-1`**. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in `/opt/oneuptime-ceph-agent`; let op: een nieuwe naam registreert een nieuw cluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "De opdracht bevat al je OneUptime-URL en ingestiesleutel. Naar de rest vraagt het script:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Download `docker-compose.yml` en `otel-collector-config.yaml` van deze OneUptime naar een nieuwe map:",
  "Create a `.env` file next to them:": "Maak er een `.env`-bestand naast:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Vervang `my-ceph-cluster` door een naam voor dit cluster, zoals `ceph-prod`. Onder die naam verschijnt het cluster in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Zet **elke** mgr-daemon in `CEPH_MGR_ENDPOINTS`, kommagescheiden en tussen vierkante haken: zonder de haken leest de collector de hele lijst als één ongeldig doel.",
  "Start the agent:": "Start de agent:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose start ook **`oneuptime-ceph-ai-agent`**, de OneUptime AI-agent. Hij wacht op een eigen Ceph-client; zie **OneUptime AI-agent** onder Geavanceerd, of verwijder zijn service uit `docker-compose.yml` als je OneUptime AI niet gebruikt.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "De agent leest deze uit het `.env`-bestand naast `docker-compose.yml`. Pas na een wijziging de waarde toe met `docker compose up -d` in de map met `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommagescheiden `host:port`-lijst van **alle** mgr-daemons, tussen vierkante haken, bijv. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Hij maakt verbinding als eigen Ceph-client, `client.oneuptime-ai`, met de minimale `ceph.conf` van het cluster en de keyring van die client in een map `ceph/` naast `docker-compose.yml`. Op een Ceph-beheerknooppunt, in de map van de agent:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Voer deze uit in de map van de agent, die met `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Upgraden**: de collectorimage staat vast in `docker-compose.yml` en zijn configuratie is een bestand ernaast, dus alleen ophalen brengt de agent niet verder. Download beide bestanden opnieuw; je `.env` blijft, en een wijziging die je in een van de bestanden had gemaakt, moet je opnieuw maken:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Haal daarna de images op en maak de agent opnieuw aan, zodat de collector zijn nieuwe configuratie leest:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `CEPH_CLUSTER_NAME`, op elke metriek gezet als `ceph.cluster.name`. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map met `docker-compose.yml`; let op: een nieuwe naam registreert een nieuw cluster.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dit installeert de agent voor **`ceph-1`**: laat `CEPH_CLUSTER_NAME` precies zoals het is, anders worden de gegevens als een nieuw cluster geregistreerd.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "De identiteit van het cluster komt uit `CEPH_CLUSTER_NAME`, op elke metriek gezet als `ceph.cluster.name`. Dit cluster is **`ceph-1`**. Corrigeer hem in `.env` en pas hem toe met `docker compose up -d` in de map met `docker-compose.yml`; let op: een nieuwe naam registreert een nieuw cluster.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nee | De containernaam van de collector (standaard: `oneuptime-ceph-agent`). De agent van een tweede cluster op dezelfde machine heeft eigen namen nodig: het installatiescript noemt de containers van een nieuwe agent naar zijn map, tenzij je ze instelt, en behoudt ze wanneer je het script opnieuw draait |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nee | De containernaam van de AI-agent (standaard: `oneuptime-ceph-ai-agent`). Het installatiescript noemt de AI-agent van een tweede cluster naar zijn collector (`oneuptime-ceph-ai-agent-cluster2` naast `oneuptime-ceph-agent-cluster2`), tenzij je hem instelt, en behoudt hem wanneer je het script opnieuw draait |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Eén agent leest één cluster. Installeer voor een tweede cluster een tweede agent in een eigen map, met eigen containernamen, want twee containers kunnen geen naam delen:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Het script noemt de containers naar de map, zoals `oneuptime-ceph-agent-cluster2`, tenzij je hun variabelen instelt, zoals `CEPH_AGENT_CONTAINER_NAME`. Het bewaart de namen in de `.env` van die agent, dus als je het script opnieuw draait met dezelfde `INSTALL_DIR` om de agent te upgraden, blijven de namen behouden, en een agent waarvan je de `container_name` ooit in `docker-compose.yml` hebt bewerkt, behoudt die naam.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Geef elke map een eigen naam: Docker Compose noemt een project alleen naar zijn map, dus het script weigert een map die net zo heet als een map waarin elders al een agent draait. Geef de map met `-d` door aan het diagnosescript.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nee | De containernaam van de collector (standaard: `oneuptime-ceph-agent`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nee | De containernaam van de AI-agent (standaard: `oneuptime-ceph-ai-agent`). De agent van een tweede cluster op dezelfde machine heeft een eigen naam nodig |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Eén agent leest één cluster. Zet voor een tweede cluster een tweede agent op in een eigen map, met eigen containernamen, want twee containers kunnen geen naam delen. Stel ze in de `.env` van die agent in:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Geef elke map een eigen naam: Docker Compose noemt een project alleen naar zijn map, dus een tweede map met dezelfde naam zou de containers van de eerste agent vervangen. Houd de namen buiten `docker-compose.yml`, dat een upgrade vervangt.",
};

export default TRANSLATION;
