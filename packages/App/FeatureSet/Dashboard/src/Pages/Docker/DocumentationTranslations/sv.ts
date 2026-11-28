import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 eller senare",
  "Access to `/var/run/docker.sock` on the host":
    "Åtkomst till `/var/run/docker.sock` på värden",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Containrar vars loggar du vill ha måste använda loggdrivrutinen `json-file`, som är Dockers standard",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Starta sedan OneUptimes AI-agent bredvid, med samma URL, nyckel och värdnamn. **AI-utredningar är påslagna som standard**: medan OneUptime AI utreder en incident eller ett larm på den här värden kör den skrivskyddade `docker`-kommandon via AI-agenten, och den ändrar ingenting om du inte tillåter åtgärder; se **OneUptimes AI-agent** under Avancerad. Hoppa över det här kommandot för att köra insamlaren utan AI-utredningar.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Ersätt `my-docker-host` med ett namn för den här värden, till exempel `prod-docker-01`. Det är så värden visas i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny värd.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Leta efter den här raden i loggarna:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Så snart agenten ansluter visas värden automatiskt i avsnittet **Docker**, oftast inom någon minut. OneUptimes AI-agent visas som Ansluten på värdens sida **AI → AI-agent** och längst ner i dess **Översikt**.",
  "| Variable | Required | Description |":
    "| Variabel | Obligatorisk | Beskrivning |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL:en till din OneUptime-instans (t.ex. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetrins intagningsnyckel från steg 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Nej | Ett lättigenkännligt namn för den här värden. Standard är `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nej | Den version av Docker Engine-API:t som agenten talar. Tom som standard: agenten förhandlar fram den med daemonen, så alla Docker Engine från 20.10 fungerar. Ange den bara för att låsa en version (se Felsökning) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` till `ONEUPTIME_LOG_OPERATOR_5` | Nej | Egna operatorer för insamlaren, en per variabel som JSON, för ett loggformat som agenten inte läser |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Skicka var och en till `docker run` som `-e NAME=value`. För att ändra en senare tar du bort agenten med `docker rm -f oneuptime-docker-agent` och kör kommandot igen med det nya värdet.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "Agenten följer `/var/lib/docker/containers/*/*-json.log`, så den ser bara loggar från containrar som använder Dockers loggdrivrutin **`json-file`**. Det är Dockers standard, men vissa värdar byter till `local` (binära filer som agenten inte kan tolka) eller till en fjärrdrivrutin (`journald`, `syslog`, `fluentd`, `gelf`, …), som inte lämnar några filer att läsa.",
  "Check a container's log driver, and the daemon's default:":
    "Kontrollera en containers loggdrivrutin och daemonens standard:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Byt en Compose-tjänst till `json-file`, med rotation:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Eller ändra daemonens standard för alla containrar som skapas därefter, i `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Starta sedan om Docker och **återskapa** (inte bara starta om) de berörda containrarna: en container behåller den loggdrivrutin den skapades med.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, den andra containern som steg 2 startar, kör de `docker`-kommandon som OneUptime AI ber om medan den utreder en incident eller ett larm på den här värden. **AI-utredningar är påslagna som standard**: så snart den ansluter utreder OneUptime AI med den, och värdens sida **AI → AI-agent** och dess **Översikt** visar dess status. Använd **Vad AI får göra** på den sidan för att stänga av utredningar; för att köra insamlaren utan AI-agenten tar du bort den med `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Skrivskyddad som standard.** Den kör kommandon som `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` och `docker stats --no-stream`, aldrig `exec`, `run`, `rm` eller `prune`. Miljövärden i utdata från `docker inspect` maskeras innan något lämnar värden.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Åtgärder slås på vid behov.** Lägg till `-e ONEUPTIME_AI_ALLOW_WRITES=true` i kommandot för att låta den starta om, starta, stoppa, pausa, döda eller ändra gränserna för en namngiven container. `ONEUPTIME_AI_FIXES` bredvid anger om varje åtgärd kräver godkännande (`ask-for-approval`, `automatic` eller `bypass-approval`), och värdens sida **AI → AI-agent** visar det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerade globmönster som `web-*,api-*`) begränsar vilka containrar; `ONEUPTIME_AI_PROTECTED_TARGETS` lägger till containrar som den aldrig får ändra. Den ändrar aldrig sig själv eller insamlaren.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Den körs som root eftersom Docker-socketen ägs av root. Socketens `:ro`-montering gör inte Docker-API:t skrivskyddat: gränsen är agentens kommandopolicy.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Dess loggar: `docker logs -f oneuptime-docker-ai-agent`. Vad den får köra och hur åtgärder fungerar: [AI-agenter för infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tagg | Beskrivning |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Senaste stabila version (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Senaste stabila version (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | En låst version, t.ex. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | Samma avbild, speglad på GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Använd en av dem i stället för `oneuptime/docker-agent:release` i slutet av `docker run`-kommandot.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Uppgradera**: hämta den senaste avbilden och ta bort agenten som körs:",
  "Then run both `docker run` commands from step 2 again.":
    "Kör sedan båda `docker run`-kommandona från steg 2 igen.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Behållarloggar** | stdout/stderr-loggar från alla containrar |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Varje loggrad får en allvarlighetsgrad från den nivå den anger (`[ERROR]`, `level=warn`, `{"level":"info"}`); en rad utan nivå faller tillbaka på sin ström: stderr är `ERROR`, stdout är `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "Agenten måste köras som root för att läsa `/var/run/docker.sock`. Se till att flaggan `--user 0:0` finns i ditt `docker run`-kommando.",
  "The agent's logs show:": "Agentens loggar visar:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Daemonen avvisar en klient som är nyare än dess eget maximum, insamlaren avslutas därför och containern startar om i en loop. Agenten låser bara en version när `DOCKER_API_VERSION` anger en, och en äldre agentavbild låste `1.44`, som Docker Engine 20.10 till 24 avvisar. Ta bort agenten (`docker rm -f oneuptime-docker-agent`), hämta den senaste avbilden (`docker pull oneuptime/docker-agent:release`) och kör kommandot från steg 2 igen, utan `-e DOCKER_API_VERSION`. Agenten förhandlar sedan fram versionen med daemonen.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "För att ändå låsa en version, använd inte mer än daemonens maximum:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Lägg till den i kommandot, t.ex. `-e DOCKER_API_VERSION=1.41`. Nyare daemoner betjänar fortfarande äldre API-versioner, så en låst version fortsätter att fungera efter att du har uppgraderat Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Kontrollera att agenten körs: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Leta efter fel i agentens loggar: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Kontrollera att OneUptime-URL:en och intagningsnyckeln i `docker run`-kommandot är rätt.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Se till att värden kan nå din OneUptime-instans över nätverket.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Kontrollera att Docker-socketen är monterad i agenten. Dess avbild har inget skal, så titta från en engångscontainer som delar dess monteringar:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Leta sedan efter exportfel i agentens loggar (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) och se till att intagningsnyckeln är giltig och inte har gått ut.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Kommer det mätvärden, men fliken **Loggar** är tom eller visar bara agentens egna loggar? Dina containrar använder sannolikt inte loggdrivrutinen `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Om steg 1 visar `no files match the configured criteria`, eller steg 3 inte listar några filer för dina containrar, använder de inte `json-file`. Byt dem (se **Samla in loggar från alla containrar (loggdrivrutin json-file)** under Avancerad) och återskapa sedan var och en: en container behåller den loggdrivrutin den skapades med:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "En värds sida visar de data vars värdnamn är värdens identifierare, som agenten tar från `DOCKER_HOST_NAME`. Ändrar du `DOCKER_HOST_NAME` efter att värden har registrerats registrerar OneUptime en andra värd under det nya namnet, och loggarna finns på den. Kontrollera namnet som agenten rapporterar:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Värdens namn kommer från `DOCKER_HOST_NAME`. En agent som startats utan den rapporterar `docker-host`, så alla värdar som konfigurerats så ser ut som samma värd. Ge `DOCKER_HOST_NAME` ett eget namn på varje värd och återskapa agenten: `docker rm -f oneuptime-docker-agent`, och kör sedan kommandot från steg 2 med det nya namnet.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Det här installerar agenten för **`web-1`**: låt `DOCKER_HOST_NAME` vara exakt som den är, annars registreras data som en ny värd.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (kommandot `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Den andra tjänsten är OneUptimes AI-agent, med samma URL, nyckel och värdnamn. **AI-utredningar är påslagna som standard**: medan OneUptime AI utreder en incident eller ett larm på den här värden kör den skrivskyddade `docker`-kommandon via AI-agenten, och den ändrar ingenting om du inte tillåter åtgärder; se **OneUptimes AI-agent** under Avancerad. Ta bort tjänsten `oneuptime-docker-ai-agent` för att köra insamlaren utan AI-utredningar.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Ange var och en i agentens lista `environment:` och kör sedan `docker compose up -d` för att återskapa den med de nya värdena.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, den andra tjänsten i docker-compose.yml, kör de `docker`-kommandon som OneUptime AI ber om medan den utreder en incident eller ett larm på den här värden. **AI-utredningar är påslagna som standard**: så snart den ansluter utreder OneUptime AI med den, och värdens sida **AI → AI-agent** och dess **Översikt** visar dess status. Använd **Vad AI får göra** på den sidan för att stänga av utredningar; för att köra insamlaren utan AI-agenten tar du bort dess tjänst och kör `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Åtgärder slås på vid behov.** Lägg till `- ONEUPTIME_AI_ALLOW_WRITES=true` i dess lista `environment:` för att låta den starta om, starta, stoppa, pausa, döda eller ändra gränserna för en namngiven container. `ONEUPTIME_AI_FIXES` bredvid anger om varje åtgärd kräver godkännande (`ask-for-approval`, `automatic` eller `bypass-approval`), och värdens sida **AI → AI-agent** visar det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerade globmönster som `web-*,api-*`) begränsar vilka containrar; `ONEUPTIME_AI_PROTECTED_TARGETS` lägger till containrar som den aldrig får ändra. Den ändrar aldrig sig själv eller insamlaren.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Använd en av dem i stället för `oneuptime/docker-agent:release` på agentens rad `image:`.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Uppgradera**: hämta de senaste avbilderna i mappen med docker-compose.yml och återskapa containrarna:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Avinstallera**: stoppa och ta bort allt som filen har startat:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'Agenten måste köras som root för att läsa `/var/run/docker.sock`. Se till att agentens tjänst har `user: "0:0"` i docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Daemonen avvisar en klient som är nyare än dess eget maximum, insamlaren avslutas därför och containern startar om i en loop. Agenten låser bara en version när `DOCKER_API_VERSION` anger en, och en äldre agentavbild låste `1.44`, som Docker Engine 20.10 till 24 avvisar. Ta bort `DOCKER_API_VERSION` från agentens lista `environment:` och kör sedan `docker compose pull` och `docker compose up -d`. Agenten förhandlar sedan fram versionen med daemonen.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Lägg till den i agentens lista `environment:`, t.ex. `- DOCKER_API_VERSION=1.41`, och kör `docker compose up -d`. Nyare daemoner betjänar fortfarande äldre API-versioner, så en låst version fortsätter att fungera efter att du har uppgraderat Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Kontrollera att OneUptime-URL:en och intagningsnyckeln i docker-compose.yml är rätt.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Värdens namn kommer från `DOCKER_HOST_NAME`. En agent som startats utan den rapporterar `docker-host`, så alla värdar som konfigurerats så ser ut som samma värd. Ge `DOCKER_HOST_NAME` ett eget namn på varje värd och kör `docker compose up -d` för att återskapa agenten med det.",
};

export default TRANSLATION;
