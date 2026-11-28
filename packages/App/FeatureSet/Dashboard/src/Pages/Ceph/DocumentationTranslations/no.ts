import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 eller nyere med Docker Compose v2-tillegget, på en maskin som når Ceph-mgr-daemonene dine på port 9283",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Et skall på en Ceph-administrasjonsnode, der `ceph`-CLI-en virker med administratorrettigheter",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "List deretter mgr-daemonene dine: agenten trenger **alle**, den aktive og standby-ene:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Bare den **aktive** mgr-en returnerer målinger (standby-ene svarer med et tomt svar), så når hver mgr skrapes, fortsetter målingene å komme når den aktive bytter.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet spør etter OneUptime-URL-en og inntaksnøkkelen din, som begge vises i trinn 1 (velg en nøkkel der for å få dem fylt inn her), og deretter etter:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Klyngenavn**: hvordan klyngen vises i OneUptime. Gi hver klynge sitt eget, og hold det stabilt: et nytt navn registrerer en ny klynge.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr-endepunkter**: hver mgr fra forrige trinn som kommaseparerte `host:port`, f.eks. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Skriptet legger til hakeparentesene.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI-agent**: om den kan bruke rettelser; svar **N** for å holde den skrivebeskyttet. Der `ceph` virker med administratorrettigheter, tilbyr skriptet også å opprette AI-agentens egen Ceph-klient.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerer i `/opt/oneuptime-ceph-agent`, skriver en `.env`-fil med `0600` og starter agenten med Docker Compose. Kjører du skriptet på nytt, gjenbruker det alt i den `.env` i stedet for å spørre igjen, så det er også slik du oppgraderer.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Se etter `Everything is ready. Begin running and processing data.` i loggene. Klyngen vises deretter automatisk i delen **Ceph**, vanligvis innen et minutt eller så.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose kjører også **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Hvis installasjonsskriptet opprettet Ceph-klienten dens, virker den allerede; ellers venter den på en; se **OneUptime AI-agent** under Avansert.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI-agent (på som standard, skrivebeskyttet).** KI-undersøkelser er på: så snart den har Ceph-klienten sin, lar den OneUptime AI undersøke hendelser og varsler på denne klyngen med skrivebeskyttede `ceph`-kommandoer, og den endrer ingenting med mindre du tillater rettelser.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Installasjonsskriptet skriver disse til `/opt/oneuptime-ceph-agent/.env`. Når du har endret en, tar du den i bruk med `docker compose up -d` i `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-inntaksnøkkelen, den som ble valgt i trinn 1 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Ja | Klyngens identifikator, som vises i OneUptime. Satt på hver måling som ressursattributtet `ceph.cluster.name`. Hold den stabil: endrer du den, registreres en ny klynge (standard: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommaseparert `host:port`-liste over **alle** mgr-daemoner i hakeparenteser, f.eks. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Installasjonsskriptet legger til parentesene for deg |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI-agentens egne innstillinger står under **OneUptime AI-agent**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Alle mgr-er skrapes** (den aktive og standby-ene), så målingene overlever et failover av den aktive mgr-en.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Hvert 30. sekund.** mgr-ens prometheus-modul hurtigbufrer en skraping i `mgr/prometheus/scrape_interval` (15 sekunder som standard): skrap aldri oftere enn det, du ville bare lese hurtigbufferen på nytt.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** beholder etikettene Ceph eksporterer (`ceph_daemon`, `pool_id`) som de er, så seriene forblir sammenhengende på tvers av mgr-failovere.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dette er den fullstendige `otel-collector-config.yaml` som agenten kjører; `.env`-filen gir verdiene `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "Agenten kan følge `/var/log/ceph/ceph.log` og sende den til OneUptime, noe som fyller siden **Klyngelogg**. Det er av som standard, fordi agenten må kjøre på en vert som har klyngeloggen, som standard en mon-vert.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Fjern kommentaren fra mottakeren `filelog` og pipelinen `logs` i `otel-collector-config.yaml`.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Fjern kommentaren fra volumet `/var/log/ceph:/var/log/ceph:ro` i `docker-compose.yml`.",
  "3. Apply both:": "3. Ta i bruk begge:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Linjene sendes uendret; OneUptime tolker ceph.log-formatet (tidsstempel, daemon, nivå INF/WRN/ERR, melding) når den leser dem, og prosessoren `resource` setter `ceph.cluster.name`, så loggen havner på denne klyngen.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Alle ressursattributter med prefikset `oneuptime.label.` blir en prosjektetikett på klyngen: `oneuptime.label.<dimension>=<value>` er etiketten `<dimension>:<value>`. Legg dem til i prosessoren `resource` i `otel-collector-config.yaml`, ved siden av `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Start deretter innsamleren på nytt, så den leser den nye konfigurasjonen:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Klyngen vises med etikettene `team:storage` og `env:production`. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "Agenten sender alt som mgr-ens prometheus-modul eksporterer. OneUptimes Ceph-sider, målingskatalog og varselmaler bygger på:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Klyngens helse** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitorkvorum, total og brukt råkapasitet |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Up-/in-tilstand for hver OSD (per etikett `ceph_daemon`, f.eks. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Lagrede byte, maks. tilgjengelig, antall objekter, lese-/skriveoperasjoner og gjennomstrømning per pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Antall aktive, degraderte og underdimensjonerte PG-er |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` kjører også **`oneuptime-ceph-ai-agent`**. Mens OneUptime AI undersøker en hendelse eller et varsel på denne klyngen, kjører den `ceph`-kommandoer gjennom den: `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Den registrerer seg som klyngen med navnet `CEPH_CLUSTER_NAME` og vises på klyngens side **KI → AI-agent**.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Den kobler til som sin egen Ceph-klient, `client.oneuptime-ai`, med klyngens minimale `ceph.conf` og den klientens nøkkelring i en mappe `ceph/` ved siden av `docker-compose.yml`. Installasjonsskriptet tilbyr å opprette dem ved en ny installasjon, når `ceph` virker med administratorrettigheter på maskinen du kjører det på. Ellers, eller for å legge dem til senere, på en Ceph-administrasjonsnode:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Kjører agenten på en annen maskin, kopierer du de to filene til mappen `ceph/` dens på samme måte. **Legg aldri administratornøkkelringen der.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Klientens caps er den harde grensen.** Med disse lese-caps-ene kan ingenting den kjører, endre klyngen. Rettelser (å sette en OSD inn igjen, å fjerne `noout`) krever også `ONEUPTIME_AI_ALLOW_WRITES=true` i `.env` og rettelses-caps-ene fra agentens README.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Sjekk den: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Bruker du ikke OneUptime AI? Slett tjenesten `oneuptime-ceph-ai-agent` fra `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Hva den kan kjøre, og hvordan rettelser virker: [KI-agenter for infrastruktur](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Oppgrader**: innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Kjør installasjonsskriptet på nytt. Det gjenbruker hver verdi i den eksisterende `.env` (ingenting spørres om igjen), laster ned de nyeste `docker-compose.yml` og `otel-collector-config.yaml` (en fil du har redigert, beholdes ved siden av den nye som `<file>.bak.<timestamp>`), henter imagene og gjenoppretter agenten med dem. AI-agentens mappe `ceph/` forblir som den er:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurasjonen rapporterer innsamlerversjonen den låser, som klyngens **Agentversjon**. Når denne OneUptime låser en nyere, åpner et varseltegn ved siden av den disse kommandoene.",
  "**Uninstall** the agent:": "**Avinstaller** agenten:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Har du opprettet AI-agentens Ceph-klient, fjerner du den på en administrasjonsnode: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` sjekker hele kjeden (containerkjøretid, hvert mgr-endepunkt inkludert fellen med aktiv mot standby, påføringen av klyngenavnet, tokenets form, innsamlerens egne målinger) og spør OneUptime direkte om den godtar inntaksnøkkelen din. Den siste sjekken betyr mest: OneUptimes OTLP-endepunkter avviser en feil nøkkel med `401` eller `422`, som innsamleren logger som én enkelt `Exporting failed`-linje per batch som er lett å overse, så skriptet spør `GET /otlp/v1/validate` om en direkte avgjørelse 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutter med en avgjørelse som nevner den mest sannsynlige årsaken.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Sjekk innsamlerens logger: `docker logs oneuptime-ceph-agent`; se etter eksportfeil (`401` betyr en feil inntaksnøkkel, connection refused betyr en feil `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Bekreft at et mgr-endepunkt leverer målinger: `curl http://<active-mgr>:9283/metrics | head`; du bør se linjer med `ceph_*`-målinger. Hvis ikke, slår du på modulen: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Sørg for at `CEPH_MGR_ENDPOINTS` står i hakeparenteser: uten dem behandler innsamleren hele den kommaseparerte strengen som ett enkelt (ugyldig) mål.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Sjekk at agenten kjører: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Sjekk agentens logger for feil: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen din er riktige.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Sørg for at agentens maskin når OneUptime-instansen over nettverket.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Du skraper sannsynligvis bare den (tidligere) aktive mgr-en. List **hver** mgr-daemon i `CEPH_MGR_ENDPOINTS`: skraping av standby-mgr-er er billig og returnerer tomme svar.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Det er forventet hvis `mgr/prometheus/standby_behaviour` er satt til `error` på klyngen din: standby-ene svarer da med HTTP 500. Skrapingen av den aktive mgr-en lykkes fortsatt, så feilene er støy; sett atferden tilbake til `default` for å dempe dem.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, satt på hver måling som `ceph.cluster.name`. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; merk at et nytt navn registrerer en ny klynge.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Klyngenavn**: skriv inn nøyaktig **`ceph-1`**; et annet navn registrerer en ny klynge.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, satt på hver måling som `ceph.cluster.name`. Denne klyngen er **`ceph-1`**. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i `/opt/oneuptime-ceph-agent`; merk at et nytt navn registrerer en ny klynge.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandoen inneholder allerede OneUptime-URL-en og inntaksnøkkelen din. Resten spør skriptet om:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Last ned `docker-compose.yml` og `otel-collector-config.yaml` fra denne OneUptime til en ny mappe:",
  "Create a `.env` file next to them:":
    "Opprett en `.env`-fil ved siden av dem:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Erstatt `my-ceph-cluster` med et navn på denne klyngen, for eksempel `ceph-prod`. Det er slik klyngen vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny klynge.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- List **hver** mgr-daemon i `CEPH_MGR_ENDPOINTS`, kommaseparert og i hakeparenteser: uten parentesene leser innsamleren hele listen som ett ugyldig mål.",
  "Start the agent:": "Start agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose starter også **`oneuptime-ceph-ai-agent`**, OneUptime AI-agenten. Den venter på en egen Ceph-klient; se **OneUptime AI-agent** under Avansert, eller slett tjenesten dens fra `docker-compose.yml` hvis du ikke bruker OneUptime AI.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten leser disse fra `.env`-filen ved siden av `docker-compose.yml`. Når du har endret en, tar du den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommaseparert `host:port`-liste over **alle** mgr-daemoner i hakeparenteser, f.eks. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Den kobler til som sin egen Ceph-klient, `client.oneuptime-ai`, med klyngens minimale `ceph.conf` og den klientens nøkkelring i en mappe `ceph/` ved siden av `docker-compose.yml`. På en Ceph-administrasjonsnode, i agentens mappe:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kjør disse i agentens mappe, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Oppgrader**: innsamlerimaget er låst i `docker-compose.yml`, og konfigurasjonen er en fil ved siden av, så å hente imaget alene flytter ikke agenten videre. Last ned begge filene på nytt; `.env` blir værende, og en endring du gjorde i en av filene, må gjøres på nytt:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hent deretter imagene, og gjenopprett agenten, så innsamleren leser den nye konfigurasjonen:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, satt på hver måling som `ceph.cluster.name`. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`; merk at et nytt navn registrerer en ny klynge.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dette installerer agenten for **`ceph-1`**: la `CEPH_CLUSTER_NAME` stå nøyaktig som det er, ellers registreres dataene som en ny klynge.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Klyngens identitet kommer fra `CEPH_CLUSTER_NAME`, satt på hver måling som `ceph.cluster.name`. Denne klyngen er **`ceph-1`**. Rett den i `.env`, og ta den i bruk med `docker compose up -d` i mappen med `docker-compose.yml`; merk at et nytt navn registrerer en ny klynge.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-ceph-agent`). Agenten for en andre klynge på samme maskin trenger sine egne navn: installasjonsskriptet navngir containerne til en ny agent etter mappen dens med mindre du angir dem, og beholder dem når du kjører skriptet på nytt |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-ceph-ai-agent`). Installasjonsskriptet navngir AI-agenten for en andre klynge etter innsamleren (`oneuptime-ceph-ai-agent-cluster2` ved siden av `oneuptime-ceph-agent-cluster2`) med mindre du angir det, og beholder det når du kjører skriptet på nytt |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Én agent leser én klynge. For en andre klynge installerer du en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Skriptet navngir containerne etter mappen, for eksempel `oneuptime-ceph-agent-cluster2`, med mindre du angir variablene deres, for eksempel `CEPH_AGENT_CONTAINER_NAME`. Det lagrer navnene i `.env` til den agenten, så når du kjører skriptet på nytt med samme `INSTALL_DIR` for å oppgradere agenten, beholdes navnene, og en agent der du en gang redigerte `container_name` i `docker-compose.yml`, beholder det navnet.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så skriptet avviser en mappe med samme navn som en som allerede kjører en agent et annet sted. Send mappen til diagnoseskriptet med `-d`.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nei | Containernavnet til innsamleren (standard: `oneuptime-ceph-agent`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nei | Containernavnet til AI-agenten (standard: `oneuptime-ceph-ai-agent`). Agenten for en andre klynge på samme maskin trenger sitt eget |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Én agent leser én klynge. For en andre klynge setter du opp en andre agent i en egen mappe, med sine egne containernavn, for to containere kan ikke dele et navn. Angi dem i `.env` til den agenten:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Gi hver mappe sitt eget navn: Docker Compose navngir et prosjekt etter mappen alene, så en andre mappe med samme navn ville erstattet containerne til den første agenten. Hold navnene utenfor `docker-compose.yml`, som en oppgradering erstatter.",
};

export default TRANSLATION;
