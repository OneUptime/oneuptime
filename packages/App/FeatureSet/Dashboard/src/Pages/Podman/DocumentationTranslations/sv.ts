import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 eller senare",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Podmans Docker-kompatibla API-socket på `/run/podman/podman.sock`: slå på den med `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Containrar vars loggar du vill ha måste använda loggdrivrutinen `k8s-file`: rootful Podman använder som standard `journald`, som agenten inte kan läsa",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Starta sedan OneUptimes AI-agent bredvid, med samma URL, nyckel och värdnamn. **AI-utredningar är påslagna som standard**: medan OneUptime AI utreder en incident eller ett larm på den här värden kör den skrivskyddade `docker`-kommandon via AI-agenten mot Podmans Docker-kompatibla socket, och den ändrar ingenting om du inte tillåter åtgärder; se **OneUptimes AI-agent** under Avancerad. Hoppa över det här kommandot för att köra insamlaren utan AI-utredningar.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Ersätt `my-podman-host` med ett namn för den här värden, till exempel `prod-podman-01`. Det är så värden visas i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny värd.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Leta efter den här raden i loggarna:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Så snart agenten ansluter visas värden automatiskt i avsnittet **Podman**, oftast inom någon minut. OneUptimes AI-agent visas som Ansluten på värdens sida **AI → AI-agent** och längst ner i dess **Översikt**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Mätvärden men inga loggar?** Rootful Podman skriver som standard containerloggar till `journald`, som agenten inte kan läsa. Kör dina containrar med `--log-driver k8s-file`; se **Samla in loggar från alla containrar (loggdrivrutin k8s-file)** under Avancerad.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetrins intagningsnyckel från steg 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Nej | Ett lättigenkännligt namn för den här värden. Standard är `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nej | Den version av Docker-API:t som agenten talar med Podman-socketen. Tom som standard: agenten förhandlar fram den med socketen. Ange den bara för att låsa en version (se Felsökning) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` till `ONEUPTIME_LOG_OPERATOR_5` | Nej | Egna operatorer för insamlaren, en per variabel som JSON, för ett loggformat som agenten inte läser |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Skicka var och en till `podman run` som `-e NAME=value`. För att ändra en senare tar du bort agenten med `podman rm -f oneuptime-podman-agent` och kör kommandot igen med det nya värdet.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "Agenten läser filerna som Podmans loggdrivrutin **`k8s-file`** skriver (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), så den ser bara loggar från containrar som använder den (eller `json-file`, som Podman behandlar som samma filbaserade drivrutin). Standard för rootful Podman är **`journald`**, som den inte kan läsa, och inte heller en fjärrdrivrutin som `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Kontrollera en containers loggdrivrutin och Podmans standard:",
  "Run a single container with `k8s-file`:":
    "Kör en enskild container med `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Byt en Compose-tjänst till `k8s-file`, med rotation:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Eller ändra standarden för alla containrar som skapas därefter, i `containers.conf` (`/etc/containers/containers.conf` för rootful, `~/.config/containers/containers.conf` för rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Återskapa** sedan (inte bara starta om) de berörda containrarna: en container behåller den loggdrivrutin den skapades med. Måste du behålla `journald`? Agenten samlar fortfarande in mätvärden via socketen; bara containerloggar kräver den filbaserade drivrutinen.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, den andra containern som steg 2 startar, kör de `docker`-kommandon som OneUptime AI ber om (via Podmans Docker-kompatibla socket) medan den utreder en incident eller ett larm på den här värden. **AI-utredningar är påslagna som standard**: så snart den ansluter utreder OneUptime AI med den, och värdens sida **AI → AI-agent** och dess **Översikt** visar dess status. Använd **Vad AI får göra** på den sidan för att stänga av utredningar; för att köra insamlaren utan AI-agenten tar du bort den med `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Skrivskyddad som standard.** Den kör kommandon som `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` och `docker stats --no-stream`, aldrig `exec`, `run`, `rm` eller `prune`. Miljövärden i utdata från `docker inspect` maskeras innan något lämnar värden.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Åtgärder slås på vid behov.** Lägg till `-e ONEUPTIME_AI_ALLOW_WRITES=true` i kommandot för att låta den starta om, starta, stoppa, pausa, döda eller ändra gränserna för en namngiven container. `ONEUPTIME_AI_FIXES` bredvid anger om varje åtgärd kräver godkännande (`ask-for-approval`, `automatic` eller `bypass-approval`), och värdens sida **AI → AI-agent** visar det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerade globmönster som `web-*,api-*`) begränsar vilka containrar; `ONEUPTIME_AI_PROTECTED_TARGETS` lägger till containrar som den aldrig får ändra. Den ändrar aldrig sig själv eller insamlaren.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Den behöver samma socket som insamlaren och körs som root eftersom socketen ägs av root. Socketens `:ro`-montering gör inte API:t skrivskyddat: gränsen är agentens kommandopolicy.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Dess loggar: `podman logs -f oneuptime-podman-ai-agent`. Vad den får köra och hur åtgärder fungerar: [AI-agenter för infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tagg | Beskrivning |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Senaste stabila version (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Senaste stabila version (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | En låst version, t.ex. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Samma avbild, speglad på GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Använd en av dem i stället för `oneuptime/podman-agent:release` i slutet av `podman run`-kommandot.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Uppgradera**: hämta den senaste avbilden och ta bort agenten som körs:",
  "Then run both `podman run` commands from step 2 again.":
    "Kör sedan båda `podman run`-kommandona från steg 2 igen.",
  "**Uninstall:**": "**Avinstallera:**",
  "| Category | Data |": "| Kategori | Data |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU-mätvärden** | Total användning, användning i procent, strypningstid (per container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Minnesmätvärden** | Användning, gräns, procent, RSS, cache (per container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Nätverksmätvärden** | Mottagna/skickade byte och paket (per container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Block-I/O-mätvärden** | Lästa/skrivna byte och operationer (per container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Containerinfo** | Drifttid, antal omstarter, antal processer |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Behållarloggar** | stdout/stderr-loggar från alla containrar som använder loggdrivrutinen `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Mätvärdena kommer från insamlarens mottagare `docker_stats` via Podmans Docker-kompatibla socket, så deras namn är desamma som Docker-agentens. Varje loggrad får en allvarlighetsgrad från den nivå den anger (`[ERROR]`, `level=warn`, `{"level":"info"}`); en rad utan nivå faller tillbaka på sin ström: stderr är `ERROR`, stdout är `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "Agenten måste köras som root för att läsa `/run/podman/podman.sock`. Se till att flaggan `--user 0:0` finns i ditt `podman run`-kommando och att socketen är påslagen:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Det är rootful Podmans socket, den som agenten läser. Kör du Podman rootless? Då är dess socket `/run/user/<uid>/podman/podman.sock` (slå på den med `systemctl --user enable --now podman.socket`) och dess lagring `~/.local/share/containers/storage`: montera dem i stället på `/run/podman/podman.sock` och `/var/lib/containers/storage` i agentens container; se dokumentationen för Podman-agenten.",
  "The agent's logs show:": "Agentens loggar visar:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "En server som tillämpar ett maximum avvisar en nyare klient, insamlaren avslutas därför och containern startar om i en loop. Agenten låser bara en Docker-API-version när `DOCKER_API_VERSION` anger en, och en äldre agentavbild låste `1.44`. Ta bort agenten (`podman rm -f oneuptime-podman-agent`), hämta den senaste avbilden (`podman pull oneuptime/podman-agent:release`) och kör kommandot från steg 2 igen, utan `-e DOCKER_API_VERSION`. Agenten förhandlar sedan fram versionen med socketen.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "För att ändå låsa en version, använd inte mer än den version som socketen rapporterar:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Lägg till den i kommandot, t.ex. `-e DOCKER_API_VERSION=1.41`. Nyare servrar betjänar fortfarande äldre API-versioner, så en låst version fortsätter att fungera efter en uppgradering.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Kontrollera att agenten körs: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Leta efter fel i agentens loggar: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Kontrollera att OneUptime-URL:en och intagningsnyckeln i `podman run`-kommandot är rätt.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Se till att värden kan nå din OneUptime-instans över nätverket.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Kontrollera att Podman-socketen är monterad i agenten. Dess avbild har inget skal, så titta från en engångscontainer som delar dess monteringar:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Leta sedan efter exportfel i agentens loggar (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) och se till att intagningsnyckeln är giltig och inte har gått ut.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Kommer det mätvärden, men fliken **Loggar** är tom eller visar bara agentens egna loggar? Dina containrar använder sannolikt inte en filbaserad loggdrivrutin (`k8s-file` eller `json-file`): rootful Podman använder som standard `journald`, som agenten inte kan läsa.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Om steg 1 visar `no files match the configured criteria`, eller steg 3 inte listar några filer för dina containrar, använder de inte `k8s-file`. Byt dem (se **Samla in loggar från alla containrar (loggdrivrutin k8s-file)** under Avancerad) och återskapa sedan var och en: en container behåller den loggdrivrutin den skapades med:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "En värds sida visar de data vars värdnamn är värdens identifierare, som agenten tar från `PODMAN_HOST_NAME`. Ändrar du `PODMAN_HOST_NAME` efter att värden har registrerats registrerar OneUptime en andra värd under det nya namnet, och loggarna finns på den. Kontrollera namnet som agenten rapporterar:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Värdens namn kommer från `PODMAN_HOST_NAME`. En agent som startats utan den rapporterar `podman-host`, så alla värdar som konfigurerats så ser ut som samma värd. Ge `PODMAN_HOST_NAME` ett eget namn på varje värd och återskapa agenten: `podman rm -f oneuptime-podman-agent`, och kör sedan kommandot från steg 2 med det nya namnet.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Det här installerar agenten för **`web-1`**: låt `PODMAN_HOST_NAME` vara exakt som den är, annars registreras data som en ny värd.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "En Compose-leverantör för `podman compose`: `podman-compose` eller Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Den andra tjänsten är OneUptimes AI-agent, med samma URL, nyckel och värdnamn. **AI-utredningar är påslagna som standard**: medan OneUptime AI utreder en incident eller ett larm på den här värden kör den skrivskyddade `docker`-kommandon via AI-agenten mot Podmans Docker-kompatibla socket, och den ändrar ingenting om du inte tillåter åtgärder; se **OneUptimes AI-agent** under Avancerad. Ta bort tjänsten `oneuptime-podman-ai-agent` för att köra insamlaren utan AI-utredningar.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Ange var och en i agentens lista `environment:` och kör sedan `podman compose up -d` för att återskapa den med de nya värdena.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, den andra tjänsten i docker-compose.yml, kör de `docker`-kommandon som OneUptime AI ber om (via Podmans Docker-kompatibla socket) medan den utreder en incident eller ett larm på den här värden. **AI-utredningar är påslagna som standard**: så snart den ansluter utreder OneUptime AI med den, och värdens sida **AI → AI-agent** och dess **Översikt** visar dess status. Använd **Vad AI får göra** på den sidan för att stänga av utredningar; för att köra insamlaren utan AI-agenten tar du bort dess tjänst och kör `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Åtgärder slås på vid behov.** Lägg till `- ONEUPTIME_AI_ALLOW_WRITES=true` i dess lista `environment:` för att låta den starta om, starta, stoppa, pausa, döda eller ändra gränserna för en namngiven container. `ONEUPTIME_AI_FIXES` bredvid anger om varje åtgärd kräver godkännande (`ask-for-approval`, `automatic` eller `bypass-approval`), och värdens sida **AI → AI-agent** visar det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerade globmönster som `web-*,api-*`) begränsar vilka containrar; `ONEUPTIME_AI_PROTECTED_TARGETS` lägger till containrar som den aldrig får ändra. Den ändrar aldrig sig själv eller insamlaren.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Använd en av dem i stället för `oneuptime/podman-agent:release` på agentens rad `image:`.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Uppgradera**: hämta de senaste avbilderna i mappen med docker-compose.yml och återskapa containrarna:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Avinstallera**: stoppa och ta bort allt som filen har startat:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'Agenten måste köras som root för att läsa `/run/podman/podman.sock`. Se till att agentens tjänst har `user: "0:0"` i docker-compose.yml och att socketen är påslagen:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "En server som tillämpar ett maximum avvisar en nyare klient, insamlaren avslutas därför och containern startar om i en loop. Agenten låser bara en Docker-API-version när `DOCKER_API_VERSION` anger en, och en äldre agentavbild låste `1.44`. Ta bort `DOCKER_API_VERSION` från agentens lista `environment:` och kör sedan `podman compose pull` och `podman compose up -d`. Agenten förhandlar sedan fram versionen med socketen.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Lägg till den i agentens lista `environment:`, t.ex. `- DOCKER_API_VERSION=1.41`, och kör `podman compose up -d`. Nyare servrar betjänar fortfarande äldre API-versioner, så en låst version fortsätter att fungera efter en uppgradering.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Kontrollera att OneUptime-URL:en och intagningsnyckeln i docker-compose.yml är rätt.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Värdens namn kommer från `PODMAN_HOST_NAME`. En agent som startats utan den rapporterar `podman-host`, så alla värdar som konfigurerats så ser ut som samma värd. Ge `PODMAN_HOST_NAME` ett eget namn på varje värd och kör `podman compose up -d` för att återskapa agenten med det.",
};

export default TRANSLATION;
