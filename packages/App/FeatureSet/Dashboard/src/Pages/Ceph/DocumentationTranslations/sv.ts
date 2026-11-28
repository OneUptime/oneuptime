import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 eller senare med Docker Compose v2-tillägget, på en maskin som når dina Ceph-mgr-daemoner på port 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Ett skal på en Ceph-administrationsnod där `ceph`-CLI:t fungerar med administratörsbehörighet",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Lista sedan dina mgr-daemoner: agenten behöver **alla**, den aktiva och standby-noderna:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Bara den **aktiva** mgr:en returnerar mätvärden (standby-noderna svarar med ett tomt svar), så när varje mgr skrapas fortsätter mätvärdena att komma när den aktiva byter.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet frågar efter din OneUptime-URL och din intagningsnyckel, som båda visas i steg 1 (välj en nyckel där så fylls de i här), och sedan efter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klusternamn**: hur klustret visas i OneUptime. Ge varje kluster ett eget och håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr-slutpunkter**: varje mgr från föregående steg som kommaseparerade `host:port`, t.ex. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Skriptet lägger till hakparenteserna.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI-agent**: om den får tillämpa korrigeringar; svara **N** för att hålla den skrivskyddad. Där `ceph` fungerar med administratörsbehörighet erbjuder skriptet också att skapa AI-agentens egen Ceph-klient.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerar i `/opt/oneuptime-ceph-agent`, skriver en `.env`-fil med `0600` och startar agenten med Docker Compose. Kör du skriptet igen återanvänder det allt i den `.env` i stället för att fråga igen, så det är också så du uppgraderar.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Leta efter `Everything is ready. Begin running and processing data.` i loggarna. Klustret visas sedan automatiskt i avsnittet **Ceph**, oftast inom en minut eller så.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose kör också **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Om installationsskriptet skapade dess Ceph-klient fungerar den redan; annars väntar den på en; se **OneUptime AI-agent** under Avancerad.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI-agent (på som standard, skrivskyddad).** AI-utredningar är på: så snart den har sin Ceph-klient låter den OneUptime AI utreda incidenter och larm på det här klustret med skrivskyddade `ceph`-kommandon, och den ändrar ingenting om du inte tillåter korrigeringar.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Installationsskriptet skriver dessa till `/opt/oneuptime-ceph-agent/.env`. När du har ändrat en tillämpar du den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-intagningsnyckeln, den som valdes i steg 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Ja | Klustrets identifierare, som visas i OneUptime. Sätts på varje mätvärde som resursattributet `ceph.cluster.name`. Håll den stabil: ändrar du den registreras ett nytt kluster (standard: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommaseparerad `host:port`-lista över **alla** mgr-daemoner inom hakparenteser, t.ex. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Installationsskriptet lägger till parenteserna åt dig |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egna inställningar finns under **OneUptime AI-agent**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Alla mgr:ar skrapas** (den aktiva och standby-noderna), så mätvärdena överlever en failover av den aktiva mgr:en.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Var 30:e sekund.** mgr:ens prometheus-modul cachar en skrapning i `mgr/prometheus/scrape_interval` (15 sekunder som standard): skrapa aldrig oftare än så, du skulle bara läsa cachen igen.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** behåller etiketterna som Ceph exporterar (`ceph_daemon`, `pool_id`) som de är, så att serierna förblir sammanhängande över mgr-failovers.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Det här är hela `otel-collector-config.yaml` som agenten kör; `.env`-filen ger värdena `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "Agenten kan följa `/var/log/ceph/ceph.log` och skicka den till OneUptime, vilket fyller sidan **Klusterlogg**. Det är av som standard eftersom agenten måste köra på en värd som har klusterloggen, som standard en mon-värd.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Avkommentera mottagaren `filelog` och pipelinen `logs` i `otel-collector-config.yaml`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Avkommentera volymen `/var/log/ceph:/var/log/ceph:ro` i `docker-compose.yml`.",
  "3. Apply both:": "3. Tillämpa båda:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Raderna skickas oförändrade; OneUptime tolkar ceph.log-formatet (tidsstämpel, daemon, nivå INF/WRN/ERR, meddelande) när den läser dem, och processorn `resource` sätter `ceph.cluster.name` så att loggen hamnar på det här klustret.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på klustret: `oneuptime.label.<dimension>=<value>` är etiketten `<dimension>:<value>`. Lägg till dem i processorn `resource` i `otel-collector-config.yaml`, bredvid `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Starta sedan om insamlaren så att den läser den nya konfigurationen:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klustret visas med etiketterna `team:storage` och `env:production`. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "Agenten skickar allt som mgr:ens prometheus-modul exporterar. OneUptimes Ceph-sidor, mätvärdeskatalog och larmmallar bygger på:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Klusterhälsa** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitorkvorum, total och använd råkapacitet |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Up-/in-tillstånd för varje OSD (per etikett `ceph_daemon`, t.ex. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Lagrade byte, max tillgängligt, antal objekt, läs-/skrivåtgärder och dataflöde per pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Antal aktiva, degraderade och underdimensionerade PG:er |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kör också **`oneuptime-ceph-ai-agent`**. Medan OneUptime AI utreder en incident eller larm på det här klustret kör den `ceph`-kommandon genom den: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Den registrerar sig som klustret med namnet `CEPH_CLUSTER_NAME` och visas på klustrets sida **AI → AI-agent**.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Den ansluter som sin egen Ceph-klient, `client.oneuptime-ai`, med klustrets minimala `ceph.conf` och den klientens nyckelring i en mapp `ceph/` bredvid `docker-compose.yml`. Installationsskriptet erbjuder att skapa dem vid en ny installation, när `ceph` fungerar med administratörsbehörighet på maskinen där du kör det. Annars, eller för att lägga till dem senare, på en Ceph-administrationsnod:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Om agenten körs på en annan maskin kopierar du de två filerna till dess mapp `ceph/` på samma sätt. **Lägg aldrig administratörens nyckelring där.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Klientens caps är den hårda gränsen.** Med de här läs-caps:en kan ingenting den kör ändra klustret. Korrigeringar (att markera en OSD som in igen, att ta bort `noout`) kräver också `ONEUPTIME_AI_ALLOW_WRITES=true` i `.env` och korrigerings-caps:en från agentens README.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Kontrollera den: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Använder du inte OneUptime AI? Ta bort tjänsten `oneuptime-ceph-ai-agent` från `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Vad den får köra och hur korrigeringar fungerar: [AI-agenter för infrastruktur](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Uppgradera**: insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Kör installationsskriptet igen. Det återanvänder varje värde i din befintliga `.env` (inget frågas igen), laddar ned de senaste `docker-compose.yml` och `otel-collector-config.yaml` (en fil du har redigerat behålls bredvid den nya som `<file>.bak.<timestamp>`), hämtar imagerna och återskapar agenten med dem. AI-agentens mapp `ceph/` förblir som den är:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterar insamlarversionen den fäster som klustrets **Agentversion**. När den här OneUptime fäster en nyare öppnar en varningssymbol bredvid den de här kommandona.",
  "**Uninstall** the agent:": "**Avinstallera** agenten:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Om du skapade AI-agentens Ceph-klient tar du bort den på en administrationsnod: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` kontrollerar hela kedjan (containerkörning, varje mgr-slutpunkt inklusive fällan med aktiv mot standby, stämplingen av klusternamnet, tokenens form, insamlarens egna mätvärden) och frågar OneUptime direkt om den godtar din intagningsnyckel. Den sista kontrollen betyder mest: OneUptimes OTLP-slutpunkter avvisar en felaktig nyckel med `401` eller `422`, vilket insamlaren loggar som en enda `Exporting failed`-rad per batch som är lätt att missa, så skriptet frågar `GET /otlp/v1/validate` om ett direkt utslag 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutas med ett utslag som nämner den mest sannolika orsaken.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Kontrollera insamlarens loggar: `docker logs oneuptime-ceph-agent`; leta efter exportfel (`401` betyder en felaktig intagningsnyckel, connection refused betyder en felaktig `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Bekräfta att en mgr-slutpunkt levererar mätvärden: `curl http://<active-mgr>:9283/metrics | head`; du bör se rader med `ceph_*`-mätvärden. Om inte, aktivera modulen: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Se till att `CEPH_MGR_ENDPOINTS` står inom hakparenteser: utan dem behandlar insamlaren hela den kommaseparerade strängen som ett enda (ogiltigt) mål.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Kontrollera att agenten körs: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Kontrollera agentens loggar efter fel: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekräfta att din OneUptime-URL och intagningsnyckel är korrekta.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Se till att agentens maskin når OneUptime-instansen över nätverket.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Du skrapar troligen bara den (tidigare) aktiva mgr:en. Lista **varje** mgr-daemon i `CEPH_MGR_ENDPOINTS`: skrapningar av standby-mgr:ar är billiga och returnerar tomma svar.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Det är väntat om `mgr/prometheus/standby_behaviour` är satt till `error` på ditt kluster: standby-noderna svarar då med HTTP 500. Skrapningen av den aktiva mgr:en lyckas ändå, så felen är brus; ställ tillbaka beteendet till `default` för att tysta dem.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `CEPH_CLUSTER_NAME`, som sätts på varje mätvärde som `ceph.cluster.name`. Rätta den i `.env` och tillämpa den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; observera att ett nytt namn registrerar ett nytt kluster.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Klusternamn**: ange exakt **`ceph-1`**; ett annat namn registrerar ett nytt kluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `CEPH_CLUSTER_NAME`, som sätts på varje mätvärde som `ceph.cluster.name`. Det här klustret är **`ceph-1`**. Rätta den i `.env` och tillämpa den med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; observera att ett nytt namn registrerar ett nytt kluster.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandot innehåller redan din OneUptime-URL och intagningsnyckel. Resten frågar skriptet efter:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Ladda ned `docker-compose.yml` och `otel-collector-config.yaml` från den här OneUptime till en ny mapp:",
  "Create a `.env` file next to them:": "Skapa en `.env`-fil bredvid dem:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Ersätt `my-ceph-cluster` med ett namn på det här klustret, till exempel `ceph-prod`. Det är så klustret visas i OneUptime, så håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Lista **varje** mgr-daemon i `CEPH_MGR_ENDPOINTS`, kommaseparerade och inom hakparenteser: utan parenteserna läser insamlaren hela listan som ett enda ogiltigt mål.",
  "Start the agent:": "Starta agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose startar också **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Den väntar på en egen Ceph-klient; se **OneUptime AI-agent** under Avancerad, eller ta bort dess tjänst från `docker-compose.yml` om du inte använder OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten läser dessa från `.env`-filen bredvid `docker-compose.yml`. När du har ändrat en tillämpar du den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommaseparerad `host:port`-lista över **alla** mgr-daemoner inom hakparenteser, t.ex. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Den ansluter som sin egen Ceph-klient, `client.oneuptime-ai`, med klustrets minimala `ceph.conf` och den klientens nyckelring i en mapp `ceph/` bredvid `docker-compose.yml`. På en Ceph-administrationsnod, i agentens mapp:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kör dessa i agentens mapp, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Uppgradera**: insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Ladda ned båda filerna igen; din `.env` blir kvar, och en ändring du gjort i någon av filerna måste göras igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hämta sedan imagerna och återskapa agenten så att insamlaren läser sin nya konfiguration:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `CEPH_CLUSTER_NAME`, som sätts på varje mätvärde som `ceph.cluster.name`. Rätta den i `.env` och tillämpa den med `docker compose up -d` i mappen med `docker-compose.yml`; observera att ett nytt namn registrerar ett nytt kluster.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Det här installerar agenten för **`ceph-1`**: låt `CEPH_CLUSTER_NAME` stå exakt som det är, annars registreras datan som ett nytt kluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klustrets identitet kommer från `CEPH_CLUSTER_NAME`, som sätts på varje mätvärde som `ceph.cluster.name`. Det här klustret är **`ceph-1`**. Rätta den i `.env` och tillämpa den med `docker compose up -d` i mappen med `docker-compose.yml`; observera att ett nytt namn registrerar ett nytt kluster.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nej | Insamlarens containernamn (standard: `oneuptime-ceph-agent`). Ett andra klusters agent på samma maskin behöver egna namn: installationsskriptet namnger en ny agents containrar efter dess mapp om du inte anger dem, och behåller dem när du kör skriptet igen |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernamn (standard: `oneuptime-ceph-ai-agent`). Installationsskriptet namnger ett andra klusters AI-agent efter dess insamlare (`oneuptime-ceph-ai-agent-cluster2` bredvid `oneuptime-ceph-agent-cluster2`) om du inte anger det, och behåller det när du kör skriptet igen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "En agent läser ett kluster. För ett andra kluster installerar du en andra agent i en egen mapp, med egna containernamn, eftersom två containrar inte kan dela ett namn:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Skriptet namnger containrarna efter mappen, till exempel `oneuptime-ceph-agent-cluster2`, om du inte anger deras variabler, till exempel `CEPH_AGENT_CONTAINER_NAME`. Det sparar namnen i den agentens `.env`, så namnen behålls när du kör skriptet igen med samma `INSTALL_DIR` för att uppgradera agenten, och en agent vars `container_name` du en gång redigerade i `docker-compose.yml` behåller det namnet.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Ge varje mapp ett eget namn: Docker Compose namnger ett projekt efter enbart dess mapp, så skriptet vägrar en mapp som heter som en som redan kör en agent någon annanstans. Skicka mappen till diagnosskriptet med `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nej | Insamlarens containernamn (standard: `oneuptime-ceph-agent`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nej | AI-agentens containernamn (standard: `oneuptime-ceph-ai-agent`). Ett andra klusters agent på samma maskin behöver ett eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "En agent läser ett kluster. För ett andra kluster sätter du upp en andra agent i en egen mapp, med egna containernamn, eftersom två containrar inte kan dela ett namn. Ange dem i den agentens `.env`:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Ge varje mapp ett eget namn: Docker Compose namnger ett projekt efter enbart dess mapp, så en andra mapp med samma namn skulle ersätta den första agentens containrar. Håll namnen utanför `docker-compose.yml`, som en uppgradering ersätter.",
};

export default TRANSLATION;
