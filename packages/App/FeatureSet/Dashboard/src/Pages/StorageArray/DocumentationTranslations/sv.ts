import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller senare med Docker Compose v2-tillägget, på en maskin som når FlashArrays hanteringsadress över HTTPS (TCP 443)",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Ett administratörskonto på FlashArray, för att skapa agentens skrivskyddade användare",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Skapa tokenen **utan utgångsdatum**, annars slutar agenten fungera den dag den går ut.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Anslut till FlashArray med SSH som administratör. Det första kommandot frågar efter den nya användarens lösenord; det andra skriver ut användarens API-token:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Öppna **Settings → Users and Policies** (**Settings → Access** i äldre versioner).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Välj **Create User…** i ⋮-menyn i panelen **Users**, döp användaren till `oneuptime` och ge den rollen **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Välj **Create API Token…** i den nya användarens ⋮-meny, lämna **Expires In** tomt och kopiera tokenen.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "En rad `purefa_info{...} 1` betyder att arrayen levererar sina mätvärden inbyggt: fortsätt. En **404** betyder att dess Purity//FA är äldre (Pure dokumenterar den inbyggda slutpunkten för 6.7.0 och senare; utfasningsmeddelandet för deras exportör anger 6.6.11 och senare): välj i stället **FlashArray, äldre Purity** högst upp i den här guiden.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "Den första raden laddar ned skriptet som `install.sh`, så att du kan läsa det innan du kör det.",
  "The command carries the platform you picked above. The script asks for:":
    "Kommandot innehåller plattformen du valde ovan. Skriptet frågar efter:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- din **OneUptime-URL** och din **intagningsnyckel**, som båda visas i steg 1 (välj en nyckel där så fylls de i här)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- ett **arraynamn**: hur arrayen visas i OneUptime. Ge varje array ett eget och håll det stabilt: ett nytt namn registrerar en ny lagringsarray",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArrays **hanteringsadress** (värdnamn eller IP, utan `https://`) och den skrivskyddade användarens **API-token**, som det läser in utan att visa den",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- om arrayens certifikat ska verifieras: svara **N** om inte arrayen har ett certifikat från en CA du litar på (arrayer levereras med ett självsignerat)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Det installerar till `/opt/oneuptime-storage-array-agent`, skriver en `.env`-fil som bara du kan läsa (den innehåller API-tokenen) och startar agenten med Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Ladda ned compose-filen och insamlarkonfigurationerna från den här OneUptime till en ny mapp:",
  "Create a `.env` file next to them:": "Skapa en `.env`-fil bredvid dem:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Ersätt `my-storage-array` med ett namn på den här arrayen, till exempel `fa-prod-01`. Det är så arrayen visas i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny lagringsarray.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sätt `PURE_FA_ENDPOINT` till FlashArrays hanteringsadress (värdnamn eller IP, utan `https://`) och `PURE_FA_API_TOKEN` till den skrivskyddade användarens API-token. Kör `chmod 600 .env`: filen innehåller tokenen.",
  "Start the agent:": "Starta agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Leta efter `Everything is ready. Begin running and processing data.` i loggarna. Arrayen visas sedan automatiskt i avsnittet **Lagringsarrayer** efter sin första skrapning, oftast inom ett par minuter.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Installationsskriptet skriver dessa till `/opt/oneuptime-storage-array-agent/.env`; en installation med Docker Compose läser dem från `.env`-filen bredvid `docker-compose.yml`. När du har ändrat en tillämpar du den med `docker compose up -d` i agentens mapp.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-intagningsnyckeln, den som valdes i steg 1 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Namnet som den här arrayen registreras under i OneUptime. Sätts på varje mätvärde som resursattributet `storage.array.name`. Håll det stabilt: ändrar du det registreras en ny lagringsarray |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Nej | Plattformen, som sätts som resursattributet `storage.system`: `purestorage.flasharray` eller `purestorage.flashblade` (standard: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nej | Vilken medföljande konfiguration som körs: `otel-collector-config.yaml` (FlashArray, inbyggd; standard), `otel-collector-config.flasharray-exporter.yaml` (äldre FlashArray) eller `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Nej | Startar exportören som konfigurationen behöver: tom för den inbyggda FlashArray-konfigurationen, `flasharray-exporter` eller `flashblade` för de andra |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArrays hanteringsadress: värdnamn eller IP, utan `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | API-token för FlashArray-användaren med rollen readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlades hanteringsadress: värdnamn eller IP, utan `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | API-token för FlashBlade-användaren med rollen readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nej | `true` godtar arrayens självsignerade certifikat på den inbyggda slutpunkten; `false` verifierar det (standard: `true`). Pures exportörer verifierar aldrig arrayens certifikat, så den gäller inte för dem |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Nej | Agentens containernamn (standard: `oneuptime-storage-array-agent`). En andra arrays agent på samma maskin behöver ett eget: installationsskriptet namnger en ny agent efter dess mapp om du inte anger det, och behåller det när du kör skriptet igen |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Insamlaren läser FlashArrays egen OpenMetrics-slutpunkt över HTTPS med tokenen som Bearer-autentiseringsuppgift: ingen exportör körs.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Ett skrapjobb per slutpunkt**, vart och ett läst så ofta som det är värt: `/metrics/array` var 60:e sekund; `/metrics/volumes`, `/metrics/hosts` och `/metrics/pods` varannan minut; `/metrics/directories` var 30:e minut, eftersom katalogers utrymme är dyrt för arrayen att beräkna.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Varje jobb sätter etiketten `scrape_endpoint: <endpoint>` på sina serier**, så att OneUptime vet vilka objekt en batch är den fullständiga listan över: så försvinner ett borttaget objekt ur inventariet. Behåll etiketterna som de levereras.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **Latens per volym och per värd behåller tre dimensioner** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); en regel i `metric_relabel_configs` tar bort uppdelningen efter QoS, kö, SAN och tjänstetid, som mångdubblar antalet serier för en stor array. Uppdelningen för hela arrayen behålls.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Ingen `send_batch_max_size`.** OneUptime bygger upp inventariet på nytt från en hel skrapning, så processorn `batch` delar aldrig upp en.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Det här är hela `otel-collector-config.yaml` som agenten kör; `.env`-filen ger värdena `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "Agenten skickar bara mätvärden tills du slår på dess syslog-mottagare. Arrayer vidarebefordrar sina larm och granskningshändelser som syslog; agenten sätter `storage.array.name` på varje rad, så att de hamnar på sidan **Loggar** för den här arrayen.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Avkommentera mottagarna `syslog/tcp` och `syslog/udp` och pipelinen `logs` i `otel-collector-config.yaml`. Klassiska BSD-syslog-tidsstämplar saknar tidszon: sätt `location` till arrayens tidszon om inte dess klocka går på UTC.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Avkommentera blocket `ports:` som publicerar `5514/tcp` och `5514/udp` i `docker-compose.yml`, och öppna porten i maskinens brandvägg för arrayens hanteringsnätverk.",
  "3. Apply both:": "3. Tillämpa båda:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Öppna **Settings → System → Syslog Servers** på FlashArray som administratör, lägg till `udp://<agent-host>:5514` (eller `tcp://<agent-host>:5514`) och skicka ett testmeddelande.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på arrayen: `oneuptime.label.<dimension>=<value>` är etiketten `<dimension>:<value>`. Lägg till dem i processorn `resource` i den insamlarkonfiguration du använder, bredvid `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Starta sedan om insamlaren så att den läser den nya konfigurationen:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Arrayen visas med etiketterna `team:storage` och `env:production`. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Varje värde är en gauge som FlashArray själv beräknar: latens per operation i mikrosekunder, genomströmning per sekund. OneUptimes lagringsarraysidor, mätvärdeskatalog och larmmallar bygger på:",
  "| Endpoint | Data |": "| Slutpunkt | Data |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, kapacitet och datareduktion (`purefa_array_space_*`), prestanda, öppna larm (`purefa_alerts_open`), hårdvarukomponenter, enheter, styrenheter och nätverksgränssnitt |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volymer** (`/metrics/volumes`) | Latens, IOPS, bandbredd, utrymme och datareduktion per volym |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Värdar** (`/metrics/hosts`) | Anslutning, anslutna volymer, latens, IOPS och utrymme per värd |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Fördröjning i replikalänkarna för ActiveCluster och ActiveDR, medlarstatus, prestanda och utrymme |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Kataloger** (`/metrics/directories`) | Utrymme och prestanda för de hanterade katalogerna i FlashArrays filtjänster |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "En agent läser en array. För att övervaka flera från samma maskin installerar du var och en i en egen mapp med en egen `.env` och ett eget containernamn, eftersom två containrar inte kan dela ett namn:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Utan `STORAGE_ARRAY_AGENT_CONTAINER_NAME` namnger skriptet containern efter mappen. Det sparar namnet i den agentens `.env`, så namnet behålls när du kör skriptet igen för att uppgradera agenten, och en agent vars `container_name` du en gång redigerade i `docker-compose.yml` behåller det namnet. Med Docker Compose sätter du i stället `STORAGE_ARRAY_AGENT_CONTAINER_NAME` i varje agents `.env`.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "Agenten levereras med en systemd-enhet som förutsätter installationsskriptets mapp, `/opt/oneuptime-storage-array-agent`. Installationsskriptet laddar inte ned den, så hämta den själv:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Uppgradera**: insamlarens image är fäst i `docker-compose.yml` och dess konfigurationer är filer bredvid, så att bara hämta imagen flyttar inte agenten framåt. Kör installationsskriptet igen. Det återanvänder varje värde i din befintliga `.env` (inget frågas igen), laddar ned de senaste `docker-compose.yml` och insamlarkonfigurationerna (en fil du har redigerat behålls bredvid den nya som `<file>.bak.<timestamp>`) och återskapar agenten med dem:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "En agent som är installerad utanför `/opt/oneuptime-storage-array-agent` (till exempel för en andra array) behöver sin mapp: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Installerade du den med Docker Compose i stället? Ladda ned compose-filen och insamlarkonfigurationerna igen i agentens mapp; din `.env` blir kvar, och en ändring du har gjort i någon av dem måste göras igen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Hämta sedan imagerna och återskapa agenten så att insamlaren läser sin nya konfiguration:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterar insamlarversionen den fäster som arrayens **Agentversion**. När den här OneUptime fäster en nyare öppnar en varningssymbol bredvid den de här kommandona.",
  "**Uninstall** the agent:": "**Avinstallera** agenten:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Ta sedan bort den skrivskyddade användaren och dess API-token på arrayen om du inte längre behöver dem.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` kontrollerar hela kedjan (containerkörning, arrayens slutpunkt precis som insamlaren når den, alltså den inbyggda slutpunkten eller Pures exportör, med DNS, TLS och API-tokenen, stämplingen av arraynamnet, insamlarens egna mätvärden) och frågar OneUptime direkt om den godtar din intagningsnyckel. Den sista kontrollen betyder mest: OneUptimes OTLP-slutpunkter avvisar en felaktig nyckel med `401` eller `422`, vilket insamlaren loggar som en enda lätt missad rad `Exporting failed` per batch, så skriptet frågar `GET /otlp/v1/validate` efter ett direkt utslag 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Det avslutas med ett utslag som nämner den mest sannolika orsaken.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Kontrollera insamlarens loggar: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` betyder att arrayen avvisade API-tokenen, `404` att FlashArray saknar inbyggd slutpunkt, `x509` att TLS-verifiering är på mot arrayens självsignerade certifikat, `no such host` eller `connection refused` en felaktig `PURE_FA_ENDPOINT`, och en `401` vid export en felaktig intagningsnyckel.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Se till att `STORAGE_ARRAY_NAME` är satt: identifieringen bygger på resursattributet `storage.array.name`, och insamlaren vägrar starta utan det.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Se till att `STORAGE_ARRAY_COLLECTOR_CONFIG` och `COMPOSE_PROFILES` anger samma plattform.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Dess Purity//FA saknar inbyggd OpenMetrics-slutpunkt. Sätt `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` och `COMPOSE_PROFILES=flasharray-exporter` i `.env` och kör `docker compose up -d`, eller kör `install.sh` igen med valet för äldre Purity. När arrayen har uppgraderats till Purity//FA 6.7 eller senare byter du tillbaka till den inbyggda konfigurationen och tar bort profilen.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Kontrollera att du klistrade in tokenen och inte användarens lösenord, att användaren fortfarande finns och har rollen readonly, och att tokenen inte har gått ut. Skapa en ny token (`pureadmin create --api-token oneuptime` på en FlashArray), lägg den i `.env` som `PURE_FA_API_TOKEN` och kör `docker compose up -d`.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Arrayer presenterar som standard ett självsignerat certifikat, som ingen Docker-image litar på. Sätt `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (det pragmatiska valet på ett privat hanteringsnätverk), eller installera ett certifikat på arrayen från en CA som insamlarens image litar på.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` eller `pure-fb-exporter` körs inte: `COMPOSE_PROFILES` måste matcha `STORAGE_ARRAY_COLLECTOR_CONFIG`, alltså `flasharray-exporter` för konfigurationen med FlashArray-exportören och `flashblade` för FlashBlade-konfigurationen. Rätta `.env` och kör `docker compose up -d`; `docker compose ps` visar sedan exportören.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Kontrollera att agenten körs: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Kontrollera agentens loggar efter fel: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Bekräfta att din OneUptime-URL och intagningsnyckel är korrekta.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Se till att agentens maskin når OneUptime-instansen över nätverket.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Arrayens identitet kommer från `STORAGE_ARRAY_NAME`, som sätts på varje mätvärde som `storage.array.name`. Rätta det i `.env` och tillämpa det med `docker compose up -d` i agentens mapp; observera att ett nytt namn registrerar en ny lagringsarray.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Det registrerar arrayen som **`array-1`**, namnet som den här arrayen redan har i OneUptime.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Det här installerar agenten för **`array-1`**: låt `STORAGE_ARRAY_NAME` stå exakt som det är, annars registreras datan som en ny lagringsarray.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Arrayens identitet kommer från `STORAGE_ARRAY_NAME`, som sätts på varje mätvärde som `storage.array.name`. Den här arrayen är **`array-1`**. Rätta det i `.env` och tillämpa det med `docker compose up -d` i agentens mapp; observera att ett nytt namn registrerar en ny lagringsarray.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Kommandot innehåller redan din OneUptime-URL, din intagningsnyckel och plattformen du valde ovan. Skriptet frågar efter:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Åtkomst från den maskinen till `quay.io`, där Docker hämtar Pures exportörimage",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` startar `pure-fa-exporter`, Pures exportör, bredvid insamlaren; de två måste matcha.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` i agentens mapp visar också **`pure-fa-exporter`**, Pures exportör, som insamlaren läser FlashArray genom.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Insamlaren läser FlashArray genom `pure-fa-exporter`, Pures exportör, som loggar in på FlashArrays REST-API med den token som insamlaren skickar vid varje skrapning. Exportörens port stannar på compose-nätverket.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 eller senare med Docker Compose v2-tillägget, på en maskin som når FlashBlades hanteringsadress över HTTPS (TCP 443)",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Ett administratörskonto på FlashBlade, för att skapa agentens skrivskyddade användare",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Skapa som administratör på FlashBlade en användare med namnet `oneuptime` och rollen **readonly** (i användarinställningarna i FlashBlades GUI eller med `pureadmin` i Purity//FB-CLI:t) och skapa en **API-token** för den. Skapa tokenen **utan utgångsdatum**, annars slutar agenten fungera den dag den går ut.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlades API-tokens börjar med `T-`. En Purity//FB-version utan lokala användare använder i stället ett konto från en katalogtjänst (LDAP eller Active Directory) vars grupp är kopplad till rollen readonly.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlades **hanteringsadress** (värdnamn eller IP, utan `https://`) och den skrivskyddade användarens **API-token**, som det läser in utan att visa den",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Sätt `PURE_FB_ENDPOINT` till FlashBlades hanteringsadress (värdnamn eller IP, utan `https://`) och `PURE_FB_API_TOKEN` till den skrivskyddade användarens API-token. Kör `chmod 600 .env`: filen innehåller tokenen.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` i agentens mapp visar också **`pure-fb-exporter`**, Pures exportör, som insamlaren läser FlashBlade genom.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Insamlaren läser FlashBlade genom `pure-fb-exporter`, Pures exportör, som loggar in på FlashBlades REST-API med den token som insamlaren skickar vid varje skrapning. Exportörens port stannar på compose-nätverket.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Ett skrapjobb per slutpunkt**, vart och ett läst så ofta som det är värt: `/metrics/array` var 60:e sekund; `/metrics/filesystems` och `/metrics/objectstore` var 5:e minut, eftersom FlashBlades REST-API inte är byggt för att snabbt rapportera varje filsystem och varje bucket.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Lägg som administratör på FlashBlade till en syslog-server `udp://<agent-host>:5514` (eller `tcp://`) i dess syslog-inställningar.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Varje värde är en gauge som FlashBlade själv beräknar: latens per operation i mikrosekunder, genomströmning per sekund. OneUptimes lagringsarraysidor, mätvärdeskatalog och larmmallar bygger på:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, kapacitet och datareduktion (`purefb_array_space_*`), prestanda per protokoll, öppna larm (`purefb_alerts_open`), hårdvarans hälsa (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Filsystem** (`/metrics/filesystems`) | Utrymme, datareduktion och prestanda per filsystem |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Objektlagring** (`/metrics/objectstore`) | Utrymme, kvot, antal objekt och prestanda per bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 eller senare med Docker Compose v2-tillägget, på en maskin som når alla klustrets noder på UDP 161 (SNMP)",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Ett administratörskonto på klustret, för att slå på SNMP och ange agentens skrivskyddade community eller SNMPv3-användare",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Anslut till valfri nod med SSH som administratör: OneFS tillämpar SNMP-inställningar på hela klustret. Om klustret redan svarar på SNMP för ett annat verktyg ger du agenten samma community eller användare och hoppar över det här steget. Annars slår du på SNMP v2c med en egen skrivskyddad community, inte OneFS standard-community `I$ilonpublic`:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "Eller slå på SNMPv3, som autentiserar och krypterar varje avfrågning. OneFS har en skrivskyddad SNMPv3-användare, `general` tills du byter namn på den: ge den lösenord på minst åtta tecken, utan mellanslag:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` visar inställningarna, med användarens autentiserings- och sekretessprotokoll. Tillåt UDP 161 från agentens maskin till varje nod och lista nodernas adresser med `isi network interfaces list`.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **alla noders adresser**, avgränsade med kommatecken: varje nods egen adress, aldrig SmartConnect-zonens namn, eftersom en nod bara svarar för sina egna diskar, sensorer och portar",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **SNMP-versionen**, sedan den skrivskyddade **communityn**, eller SNMPv3-**användaren** och dess två lösenord, som vart och ett läses in utan att visas",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "En användare vars protokoll inte är SHA och AES behöver `POWERSCALE_SNMP_AUTH_PROTOCOL` och `POWERSCALE_SNMP_PRIVACY_PROTOCOL` före `bash install.sh`, och en användare utan sekretess `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Det installerar till `/opt/oneuptime-storage-array-agent`, skriver en `.env`-fil som bara du kan läsa (den innehåller communityn eller SNMPv3-lösenorden), med en avfrågning per nod, och startar agenten med Docker Compose. När klustret får en ny nod lägger du till dess adress i `POWERSCALE_NODES` i den filen och kör `bash install.sh` igen.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Ersätt `my-storage-array` med ett namn på det här klustret, till exempel `ps-prod`. Det är så klustret visas i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny lagringsarray.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Lista varje nod i `POWERSCALE_NODES` och ge var och en sin egen `POWERSCALE_NODE_<n>` och sin egen `snmp/node-<n>` i `POWERSCALE_SNMP_RECEIVERS`, upp till 252, efter `snmp/cluster` och `snmp/quotas`. En IPv6-adress skrivs inom hakparenteser, till exempel `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- För SNMPv3 sätter du `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` och `POWERSCALE_SNMP_PRIVACY_PASSWORD` i stället för communityn. Kör `chmod 600 .env`: filen innehåller communityn eller lösenorden.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Namnet som det här klustret registreras under i OneUptime, som sätts på varje mätvärde som `storage.array.name`. Håll det stabilt: ändrar du det registreras en ny lagringsarray |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Ja | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Ja | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Ja | Alla noders adresser, avgränsade med kommatecken. Installationsskriptet skriver avfrågningarna nedan utifrån den |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Ja | Noden som klustrets egen hälsa, kapacitet och kvoter läses genom: den första i `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Ja | Avfrågningarna som insamlaren kör: `snmp/cluster`, `snmp/quotas`, sedan `snmp/node-<n>` för varje nod |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Ja | Adressen till nod `<n>`, från 1 till 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | Nej | `v2c` (standard) eller `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | Klustrets skrivskyddade community |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | Klustrets skrivskyddade SNMPv3-användare |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | Nej | `auth_priv` (standard), `auth_no_priv` eller `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | Nej | `SHA` (standard), `MD5`, `SHA224`, `SHA256`, `SHA384` eller `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | SNMPv3-användarens autentiseringslösenord |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | Nej | `AES` (standard), `DES`, `AES192`, `AES256`, `AES192C` eller `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | SNMPv3-användarens sekretesslösenord |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **En insamlare, ingen exportör.** Insamlarens egen SNMP-mottagare läser Dells ISILON-MIB; inget annat körs bredvid den.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Klustrets objekt en gång, genom `POWERSCALE_ENDPOINT`:** dess hälsa, kapacitet, genomströmning och antal noder var 60:e sekund (`snmp/cluster`), och dess SmartQuotas var 5:e minut (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Varje nods objekt från noden själv:** dess hälsa, CPU, protokollprestanda, diskar, sensorer och portar var 60:e sekund (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Varje avfrågning sätter etiketten `scrape_endpoint: <poll>` på sina serier**, så att OneUptime vet vilka objekt en batch är den fullständiga listan över: så försvinner en borttagen kvot ur inventariet. Behåll etiketterna som de levereras.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "Hela konfigurationen, med en SNMP-mottagare per nodplats, är `otel-collector-config.powerscale.yaml` i agentens mapp:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Slå sedan av SNMP på klustret, eller byt agentens community eller SNMPv3-lösenord, om inget annat avfrågar klustret.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` kontrollerar hela kedjan (containerkörning, nodadresserna och communityn eller SNMPv3-användaren i `.env`, varje nod med `snmpget` när maskinen har det, stämplingen av arraynamnet, insamlarens egna mätvärden) och frågar OneUptime direkt om den godtar din intagningsnyckel.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` med `request timeout` i `docker logs oneuptime-storage-array-agent` pekar ut en nod som inte svarar på SNMP från den här maskinen: SNMP är avslaget för versionen som agenten använder, communityn eller SNMPv3-användaren är inte klustrets, eller UDP 161 blockeras på vägen. En nod som svarar men saknas bland klustrets noder finns inte i `POWERSCALE_NODES`: lägg till den och kör `bash install.sh` igen.",
};

export default TRANSLATION;
