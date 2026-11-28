import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 eller senare, anslutet till de pooler du vill övervaka. Dess OpenMetrics-plugin kräver en Premium-licens på en XOA; ett Xen Orchestra byggt från källkoden har det inbyggt",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 eller senare med Docker Compose v2-tillägget, på en maskin som når Xen Orchestra över HTTPS",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Ett certifikat på Xen Orchestra som namnger adressen som agenten ansluter till. Det självsignerade certifikat som Xen Orchestra skapar åt sig själv namnger ingen, så ingen aktuell TLS-klient kan kontrollera det — se **Xen Orchestras certifikat** under Avancerad",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Öppna *Settings → Plugins* i Xen Orchestra och leta upp **openmetrics**.",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. Aktivera det. Första gången det startar skapar det en hemlighet och behåller den, och Xen Orchestra behåller den mellan omstarter.",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. Öppna pluginets inställningar och kopiera dess **Prometheus secret** — du ger den till agenten i nästa steg. Du kan också skriva in en egen hemlighet där och spara den.",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "Pluginet svarar på Xen Orchestras egen adress och med dess eget certifikat, på `/openmetrics/metrics`, och bara på en begäran som har med dess hemlighet. Det levererar varje pool som Xen Orchestra är anslutet till, så en agent täcker dem alla.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Skriptet frågar efter din OneUptime-URL och din intagningsnyckel, som båda visas i steg 1 (välj en nyckel där så fylls de i här), och sedan efter:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestras adress** — så som du öppnar den i en webbläsare, t.ex. `https://xo.example.com` eller `https://10.0.0.5:8443`.",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics-pluginets hemlighet** — från föregående steg. Den visas inte medan du skriver den.",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **Vad det här Xen Orchestra ska heta** — namnet som var och en av dess pooler visar under sina Inställningar. Tryck på Enter för att använda dess adress.",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "Sedan läser skriptet Xen Orchestras certifikat. När den här maskinen redan litar på det litar agenten på samma CA-paket. När den inte gör det visar skriptet certifikatets SHA-256-fingeravtryck: jämför det med det på Xen Orchestras maskin och svara **y** för att lita på just det certifikatet och inget annat. Det stänger aldrig av kontrollen. Därefter ber det pluginet om dess mätvärden med hemligheten och säger vilka pooler Xen Orchestra rapporterar, innan det installerar något.",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Det installerar i `/opt/oneuptime-xcp-ng-agent`, skriver en `.env`-fil med `0600` och startar agenten med Docker Compose. Kör du skriptet igen återanvänder det allt i den `.env` i stället för att fråga igen, så det är också så du uppgraderar.",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` listar `oneuptime-xcp-ng-agent`. Leta efter `Everything is ready. Begin running and processing data.` i dess loggar. Agenten läser Xen Orchestra varje minut, och varje pool som den rapporterar visas sedan i avsnittet **XCP-ng** under det namn Xen Orchestra ger den, med dess värdar, VM:ar och lagring.",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "Installationsskriptet skriver dessa till `/opt/oneuptime-xcp-ng-agent/.env`. När du har ändrat en tillämpar du den med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetri-intagningsnyckeln, den som valdes i steg 1 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | Ja | Xen Orchestras `host` eller `host:port`, utan schema |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | Nej | `https` (standard). `http` bara i en testmiljö: hemligheten går då okrypterad över nätverket |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | Ja | OpenMetrics-pluginets hemlighet, skickad som Bearer-token. Varje `$` i den skrivs som `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | Nej | Vad det här Xen Orchestra ska heta i OneUptime, visat under Inställningar för var och en av dess pooler (standard: dess adress) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | Nej | Namnet som Xen Orchestras certifikat kontrolleras mot, när `XO_ADDRESS` är en adress som certifikatet inte listar |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | Nej | Agentens containernamn (standard: `oneuptime-xcp-ng-agent`). Ett andra Xen Orchestras agent på samma maskin behöver ett eget: installationsskriptet namnger en ny agent efter dess mapp om du inte anger det, och behåller det när du kör skriptet igen |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | Installationsskript | Xen Orchestras adress så som den skrevs in; skriptet härleder `XO_SCHEME` och `XO_ADDRESS` ur den |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | Installationsskript | SHA-256-fingeravtrycket för Xen Orchestras eget certifikat, när agenten litar på just det certifikatet och inget annat |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | Installationsskript | Ett CA-paket som har utfärdat Xen Orchestras certifikat, och som skriptet kopierar till `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | Nej | En token för en Xen Orchestra-användare med en kopia av den inbyggda rollen **Read only** och inget annat: XCP-ng-AI-agenten körs när den är satt, och läser med den |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | Nej | Bara för åtgärder: en token för en annan användare vars roll tillåter dem. Utan den ändrar AI-agenten ingenting |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | Nej | XAPI-UUID:t för den pool som AI-agenten hanterar (standard: den enda pool som dess lästoken kan se) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | Nej | Åsidosätter `XCP_NG_POOL_ID` som den pool som AI-agenten registrerar sig som |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | Nej | `true` eller `false`: om OneUptime AI får köra AI-agentens skrivskyddade kommandon medan den utreder (standard: på) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | Nej | `off`, `ask-for-approval`, `automatic` eller `bypass-approval`: hur OneUptime AI får tillämpa en åtgärd |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | Nej | `true` låter AI-agenten tillämpa åtgärder, med token för ändringar. Allt annat håller den skrivskyddad |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | Nej | De `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` eller `schedule/<uuid>` som en åtgärd får röra, kommaseparerade (standard: alla) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | Nej | Samma sak, för det som OneUptime AI aldrig får ändra: den VM som AI-agenten körs i, och Xen Orchestras egen |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | Nej | AI-agentens loggnivå: `debug`, `info` (standard), `warn` eller `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | Nej | `xcp-ng-ai-agent` startar AI-agenten; installationsskriptet skriver det när lästoken är satt |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "Agenten kontrollerar Xen Orchestras certifikat mot `xo-ca.pem` bredvid `docker-compose.yml`.",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "Agenten kontrollerar Xen Orchestras certifikat vid varje läsning, mot `xo-ca.pem` och inget annat. Den filen innehåller en av tre saker:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestras eget certifikat**, fäst via sitt SHA-256-fingeravtryck (`XO_TLS_FINGERPRINT`): agenten litar på just det certifikatet och inget annat.",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **CA:n som utfärdade det** (`XO_CA_FILE`), för ett certifikat från en egen CA.",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **Den här maskinens CA-paket**, för ett certifikat som den här maskinen redan litar på.",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "Hur som helst måste certifikatet namnge adressen som agenten ansluter till: agenten kontrollerar de namn ett certifikat är utfärdat för, som varje aktuell TLS-klient gör, och inte dess subject. Det självsignerade certifikat som Xen Orchestra skapar åt sig själv namnger inga, så agenten kan inte lita på det, fäst eller inte, och misslyckas med `x509: certificate is not valid for any names`. Ge Xen Orchestra ett certifikat som namnger dess adress — från din CA, eller ett självsignerat med ett alternativt subject-namn (subject alternative name) —, så som [Xen Orchestras certifikat](/docs/telemetry/xcp-ng#xen-orchestras-certificate) visar.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "När certifikatet namnger Xen Orchestra med ett annat namn än adressen i `XO_ADDRESS` sätter du `XO_TLS_SERVER_NAME` till det namnet. När ett fäst certifikat förnyas slutar agenten läsa Xen Orchestra tills den litar på det nya. Kör installationsskriptet igen: det visar det nya fingeravtrycket och stannar, utan att ändra något. Kontrollera det fingeravtrycket på Xen Orchestras maskin och kör sedan skriptet en gång till med det: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "Varje minut läser agenten pluginet, som läser varje värds XAPI-round-robin-databaser med 60 sekunders upplösning. Den behåller serierna `xcp_*` och flyttar varje series pool till den batch den skickar, som `xcp_ng.pool.id` (poolens UUID, som aldrig ändras) och `xcp_ng.pool.name`:",
  "| Category | Series |": "| Kategori | Serier |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **Pool** | `xcp_pool_connected` — finns så länge Xen Orchestra är anslutet till poolen |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **Värdar** | `xcp_host_status` (strömläge och om den är aktiverad), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per gränssnitt, `xcp_host_disk_*` per lagringsrepository |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM:ar** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU-konkurrens), `xcp_vm_memory_*`, `xcp_vm_network_*` per gränssnitt, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **Lagring** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`, på pooler som kör XOSTOR |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'Kontrolldomäner rapporteras som VM:ar med `is_control_domain="true"`; sidorna döljer dem om du inte ber om dem.',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra typar åtta genomströmningsserier som räknare, trots att var och en innehåller XAPI:s takt per sekund: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total` och VM:arnas serier för nätverk, nätverksfel och diskläsning och -skrivning. Agenten gör om dem till gauges med oförändrade värden, så att OneUptime lagrar dem som de takter de är, i byte eller fel per sekund.",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime lägger till fyra 0/1-serier för varje pool, som larmmallarna läser: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` och `xcp_ng.vm.stopped_after_running` (en VM som är stoppad eller pausad och som körde under det senaste dygnet). Det stämplar också varje punkt med `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` eller `xostor`) och `xcp_ng.id` (det objektets UUID), som monitorer och instrumentpaneler filtrerar på.",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "Behålls inte: Xen Orchestras egna processerier (`xo_*`), som inte hör till någon pool, och en värds effekt läst via IPMI, som pluginet skickar utan sin pool. Varje VM:s uppskattade andel av den behålls.",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "En agent läser ett Xen Orchestra och varje pool det hanterar. För ett andra Xen Orchestra installerar du en andra agent i en egen mapp, med ett eget containernamn, eftersom två containrar inte kan dela ett namn:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Utan `XCP_NG_AGENT_CONTAINER_NAME` namnger skriptet containern efter mappen. Det sparar namnet i den agentens `.env`, så namnet behålls när du kör skriptet igen för att uppgradera agenten, och en agent vars `container_name` du en gång redigerade i `docker-compose.yml` behåller det namnet. Med Docker Compose sätter du i stället `XCP_NG_AGENT_CONTAINER_NAME` i varje agents `.env`.",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "Låt inte två Xen Orchestra som hanterar samma pool båda läsas: poolen är en enda pool i OneUptime, via sitt UUID, och skulle rapporteras två gånger.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på varje pool som agenten läser: `oneuptime.label.<dimension>=<value>` är etiketten `<dimension>:<value>`. Lägg till dem i processorn `resource` i `otel-collector-config.yaml`, bredvid `oneuptime.agent.version`:",
  "Then restart the collector so it reads the new config:":
    "Starta sedan om insamlaren så att den läser den nya konfigurationen:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "Poolerna visas med etiketterna `team:platform` och `env:production`. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten. Kör du installationsskriptet igen ersätter det en redigerad `otel-collector-config.yaml` och behåller din bredvid som `otel-collector-config.yaml.bak.<timestamp>`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**Uppgradera** — insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Kör installationsskriptet igen. Det återanvänder varje värde i din befintliga `.env` (inget frågas igen), kontrollerar Xen Orchestras certifikat på samma sätt, laddar ned de senaste `docker-compose.yml` och `otel-collector-config.yaml` — en fil du har redigerat behålls bredvid den nya som `<file>.bak.<timestamp>` —, hämtar imagen och skapar om agenten med den:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Konfigurationen rapporterar den insamlarversion den låser till som varje pools **Agentversion**. När den här OneUptime låser till en nyare öppnar ett varningstecken bredvid dessa kommandon.",
  "**Uninstall** the agent:": "**Avinstallera** agenten:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "Stäng sedan av OpenMetrics-pluginet i Xen Orchestra om inget annat läser det.",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` kontrollerar hela kedjan — containern, Xen Orchestras certifikat mot `xo-ca.pem`, pluginet och dess hemlighet, poolerna det rapporterar — och frågar OneUptime direkt om den godtar din intagningsnyckel. Den sista kontrollen är viktigast: OneUptimes OTLP-slutpunkter avvisar en felaktig nyckel med `401` eller `422`, vilket insamlaren loggar som en enda `Exporting failed`-rad per batch som är lätt att missa.",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "Det avslutas med ett utslag som nämner den mest sannolika orsaken. Det skriver aldrig ut hemligheten.",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime markerar en pool som Frånkopplad när inget har lästs för den på 15 minuter.",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Om varje pool i det här Xen Orchestra är Frånkopplad kontrollerar du agenten (i `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` och `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. Om bara en är det har Xen Orchestra slutat rapportera den: under *Settings → Servers* i Xen Orchestra måste poolens server vara ansluten. Poolens värdar, VM:ar och lagring förblir som Xen Orchestra senast rapporterade dem.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Insamlaren loggar `server returned HTTP status 401 Unauthorized`. Kopiera hemligheten igen från *Settings → Plugins → openmetrics*, sätt `XO_OPENMETRICS_SECRET` till den i `.env` — inom enkla citattecken, varje `$` skrivet som `$$` — och tillämpa den med `docker compose up -d` i `/opt/oneuptime-xcp-ng-agent`. Före 6.8 skapade Xen Orchestra en ny hemlighet varje gång det startades om.",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra svarar, men inte dess OpenMetrics-plugin. Aktivera pluginet under *Settings → Plugins → openmetrics* (en XOA kräver en Premium-licens för det) och kontrollera att Xen Orchestra är 6.9 eller senare. `/openmetrics/health` svarar `{"status":"ok"}` utan hemlighet medan pluginet körs.',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — certifikatet namnger ingen adress, som Xen Orchestras eget självsignerade certifikat. Ge Xen Orchestra ett certifikat som namnger dess adress.",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — anslut till ett av de namnen, eller sätt `XO_TLS_SERVER_NAME` till ett av dem.",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` innehåller varken det här certifikatet eller CA:n som utfärdade det. Certifikatet har förnyats, eller så innehåller filen fel certifikat: skriv den igen, så som **Xen Orchestras certifikat** under Avancerad beskriver.",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra rapporterar bara de pooler det är anslutet till, och agenten läser bara det Xen Orchestra. Anslut poolens server under *Settings → Servers* i Xen Orchestra; poolen visas i OneUptime vid nästa läsning. En pool som ett annat Xen Orchestra läser behöver en egen agent, bredvid det andra Xen Orchestra.",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **Vad det här Xen Orchestra ska heta** — kommandot namnger det redan **`xo-paris`**, så som den här poolens Inställningar visar det.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Kommandot innehåller redan din OneUptime-URL och intagningsnyckel. Resten frågar skriptet efter:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Ladda ned `docker-compose.yml` och `otel-collector-config.yaml` från den här OneUptime till en ny mapp:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "Skapa en `.env`-fil bredvid dem; den innehåller pluginets hemlighet, så håll den privat med `chmod 600 .env`:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- Sätt `XO_ADDRESS` till Xen Orchestras `host` eller `host:port`, utan `https://`.",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- Sätt pluginets hemlighet inom enkla citattecken. Innehåller den ett `$` skriver du vart och ett som `$$`: insamlaren läser värdet en gång till.",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` är det som varje pools Inställningar kallar det här Xen Orchestra.",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "Ge sedan agenten Xen Orchestras certifikat, som `xo-ca.pem` bredvid `docker-compose.yml` — agenten kontrollerar Xen Orchestra mot den här filen och inget annat. För att lita på Xen Orchestras eget certifikat läser du det och kontrollerar dess fingeravtryck mot det på Xen Orchestras maskin:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "Om en egen CA utfärdade det kopierar du i stället den CA:ns certifikat till `xo-ca.pem`; om en offentlig CA gjorde det kopierar du den här maskinens CA-paket (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).",
  "Start the agent:": "Starta agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Agenten läser dessa från `.env`-filen bredvid `docker-compose.yml`. När du har ändrat en tillämpar du den med `docker compose up -d` i mappen med `docker-compose.yml`.",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "När certifikatet namnger Xen Orchestra med ett annat namn än adressen i `XO_ADDRESS` sätter du `XO_TLS_SERVER_NAME` till det namnet. När certifikatet i `xo-ca.pem` förnyas läser du det igen som i steg 3 och kör sedan `docker compose up -d --force-recreate`.",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Kör dessa i agentens mapp, den med `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**Uppgradera** — insamlarens image är fäst i `docker-compose.yml` och dess konfiguration är en fil bredvid, så att bara hämta imagen flyttar inte agenten framåt. Ladda ned båda filerna igen; din `.env` och `xo-ca.pem` blir kvar, och en ändring du gjort i någon av filerna måste göras igen:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "Hämta sedan imagen och återskapa agenten så att insamlaren läser sin nya konfiguration:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. Om varje pool i det här Xen Orchestra är Frånkopplad kontrollerar du agenten (i agentens mapp): `docker compose ps` och `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "Insamlaren loggar `server returned HTTP status 401 Unauthorized`. Kopiera hemligheten igen från *Settings → Plugins → openmetrics*, sätt `XO_OPENMETRICS_SECRET` till den i `.env` — inom enkla citattecken, varje `$` skrivet som `$$` — och tillämpa den med `docker compose up -d` i mappen med `docker-compose.yml`. Före 6.8 skapade Xen Orchestra en ny hemlighet varje gång det startades om.",
};

export default TRANSLATION;
