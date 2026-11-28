import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 of nieuwer",
  "Access to `/var/run/docker.sock` on the host":
    "Toegang tot `/var/run/docker.sock` op de host",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Containers waarvan je de logboeken wilt, moeten de logdriver `json-file` gebruiken, de standaard van Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Start daarna de OneUptime AI-agent ernaast, met dezelfde URL, sleutel en hostnaam. **AI-onderzoeken staan standaard aan**: terwijl OneUptime AI een incident of waarschuwing op deze host onderzoekt, voert het via de AI-agent alleen-lezen `docker`-opdrachten uit, en het verandert niets tenzij je oplossingen toestaat; zie **De OneUptime AI-agent** onder Geavanceerd. Sla deze opdracht over om de collector zonder AI-onderzoeken te draaien.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Vervang `my-docker-host` door een naam voor deze host, zoals `prod-docker-01`. Onder die naam verschijnt de host in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuwe host.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "Look for this line in the logs:": "Zoek deze regel in de logboeken:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Zodra de agent verbinding heeft, verschijnt de host automatisch in het onderdeel **Docker**, meestal binnen een minuut of zo. De OneUptime AI-agent staat als Verbonden op de pagina **AI → AI-agent** van de host en onderaan zijn **Overzicht**.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | De telemetrie-ingestiesleutel uit stap 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Nee | Een herkenbare naam voor deze host. Standaard `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nee | De versie van de Docker Engine-API die de agent spreekt. Standaard leeg: de agent onderhandelt hem met de daemon, zodat elke Docker Engine vanaf 20.10 werkt. Stel hem alleen in om een versie vast te zetten (zie Probleemoplossing) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` tot en met `ONEUPTIME_LOG_OPERATOR_5` | Nee | Eigen collector-operators, één per variabele als JSON, voor een logformaat dat de agent niet leest |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Geef elk ervan aan `docker run` mee als `-e NAME=value`. Om er later een te wijzigen, verwijder je de agent met `docker rm -f oneuptime-docker-agent` en voer je de opdracht opnieuw uit met de nieuwe waarde.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "De agent volgt `/var/lib/docker/containers/*/*-json.log`, dus hij ziet alleen logboeken van containers die de logdriver **`json-file`** van Docker gebruiken. Dat is de standaard van Docker, maar sommige hosts stappen over op `local` (binaire bestanden die de agent niet kan lezen) of op een externe driver (`journald`, `syslog`, `fluentd`, `gelf`, …), die geen bestanden achterlaten om te lezen.",
  "Check a container's log driver, and the daemon's default:":
    "Controleer de logdriver van een container en de standaard van de daemon:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Zet een Compose-service over op `json-file`, met rotatie:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Of wijzig de standaard van de daemon voor elke container die daarna wordt gemaakt, in `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Start Docker daarna opnieuw en **maak de betreffende containers opnieuw aan** (opnieuw starten is niet genoeg): een container houdt de logdriver waarmee hij is gemaakt.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, de tweede container die stap 2 start, voert de `docker`-opdrachten uit waar OneUptime AI om vraagt terwijl het een incident of waarschuwing op deze host onderzoekt. **AI-onderzoeken staan standaard aan**: zodra hij verbinding heeft, onderzoekt OneUptime AI ermee, en de pagina **AI → AI-agent** van de host en zijn **Overzicht** tonen zijn status. Gebruik **Wat AI mag doen** op die pagina om onderzoeken uit te zetten; om de collector zonder de AI-agent te draaien, verwijder je hem met `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Standaard alleen-lezen.** Hij voert opdrachten uit zoals `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` en `docker stats --no-stream`, nooit `exec`, `run`, `rm` of `prune`. Omgevingswaarden in de uitvoer van `docker inspect` worden gemaskeerd voordat er iets de host verlaat.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Oplossingen zijn opt-in.** Voeg `-e ONEUPTIME_AI_ALLOW_WRITES=true` toe aan de opdracht om hem een benoemde container opnieuw te laten starten, starten, stoppen, pauzeren, beëindigen of de limieten ervan te laten wijzigen. `ONEUPTIME_AI_FIXES` ernaast bepaalt of elke oplossing goedkeuring nodig heeft (`ask-for-approval`, `automatic` of `bypass-approval`), en de pagina **AI → AI-agent** van de host toont het. `ONEUPTIME_AI_WRITE_TARGETS` (kommagescheiden globs zoals `web-*,api-*`) beperkt welke containers; `ONEUPTIME_AI_PROTECTED_TARGETS` voegt containers toe die hij nooit mag wijzigen. Hij wijzigt nooit zichzelf of de collector.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Hij draait als root omdat de Docker-socket van root is. De `:ro`-mount van de socket maakt de Docker-API niet alleen-lezen: de grens is het opdrachtenbeleid van de agent.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Zijn logboeken: `docker logs -f oneuptime-docker-ai-agent`. Wat hij mag uitvoeren en hoe oplossingen werken: [AI-agents voor infrastructuur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beschrijving |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Nieuwste stabiele release (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Nieuwste stabiele release (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Een vastgezette versie, bijv. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | Dezelfde image, gespiegeld op GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Gebruik er een in plaats van `oneuptime/docker-agent:release` aan het eind van de `docker run`-opdracht.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Upgraden**: haal de nieuwste image op en verwijder de draaiende agent:",
  "Then run both `docker run` commands from step 2 again.":
    "Voer daarna beide `docker run`-opdrachten uit stap 2 opnieuw uit.",
  "**Uninstall:**": "**Verwijderen:**",
  "| Category | Data |": "| Categorie | Gegevens |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU-metrics** | Totaal gebruik, gebruikspercentage, throttlingtijd (per container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Geheugenmetrics** | Gebruik, limiet, percentage, RSS, cache (per container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Netwerkmetrics** | Ontvangen/verzonden bytes en pakketten (per container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Block-I/O-metrics** | Gelezen/geschreven bytes en bewerkingen (per container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Containerinfo** | Looptijd, aantal herstarts, aantal processen |",
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Containerlogboeken** | stdout/stderr-logboeken van alle containers |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Elke logregel krijgt een ernst op basis van het niveau dat hij noemt (`[ERROR]`, `level=warn`, `{"level":"info"}`); een regel zonder niveau valt terug op zijn stream: stderr is `ERROR`, stdout is `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "De agent moet als root draaien om `/var/run/docker.sock` te lezen. Zorg dat de vlag `--user 0:0` in je `docker run`-opdracht staat.",
  "The agent's logs show:": "De logboeken van de agent tonen:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "De daemon weigert een client die nieuwer is dan zijn eigen maximum, de collector stopt daardoor en de container blijft herstarten. De agent zet alleen een versie vast als `DOCKER_API_VERSION` er een noemt, en een oudere agent-image zette `1.44` vast, die Docker Engine 20.10 tot en met 24 weigeren. Verwijder de agent (`docker rm -f oneuptime-docker-agent`), haal de nieuwste image op (`docker pull oneuptime/docker-agent:release`) en voer de opdracht uit stap 2 opnieuw uit, zonder `-e DOCKER_API_VERSION`. De agent onderhandelt de versie dan met de daemon.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Wil je toch een versie vastzetten, gebruik dan niet meer dan het maximum van de daemon:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Voeg hem toe aan de opdracht, bijv. `-e DOCKER_API_VERSION=1.41`. Nieuwere daemons bedienen nog steeds oudere API-versies, dus een vastgezette versie blijft werken nadat je Docker hebt geüpgraded.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Controleer of de agent draait: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Controleer de logboeken van de agent op fouten: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in de `docker run`-opdracht kloppen.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Zorg dat de host je OneUptime-instantie via het netwerk kan bereiken.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Controleer of de Docker-socket in de agent is gemount. Zijn image heeft geen shell, dus kijk vanuit een wegwerpcontainer die zijn mounts deelt:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Zoek daarna naar exportfouten in de logboeken van de agent (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`) en controleer of de ingestiesleutel geldig is en niet is verlopen.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Komen er metrics binnen, maar is het tabblad **Logboeken** leeg of toont het alleen de eigen logboeken van de agent? Je containers gebruiken hoogstwaarschijnlijk niet de logdriver `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Als stap 1 `no files match the configured criteria` toont, of stap 3 geen bestanden voor je containers toont, gebruiken ze geen `json-file`. Zet ze om (zie **Logboeken van alle containers verzamelen (logdriver json-file)** onder Geavanceerd) en maak ze daarna stuk voor stuk opnieuw aan: een container houdt de logdriver waarmee hij is gemaakt:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "De pagina van een host toont de gegevens waarvan de hostnaam de identificatie van die host is, die de agent uit `DOCKER_HOST_NAME` haalt. Wijzig je `DOCKER_HOST_NAME` nadat de host is geregistreerd, dan registreert OneUptime een tweede host onder de nieuwe naam, en daar staan de logboeken. Controleer de naam die de agent meldt:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "De naam van de host komt uit `DOCKER_HOST_NAME`. Een agent die zonder deze variabele is gestart, meldt `docker-host`, dus elke host die zo is ingericht, lijkt op dezelfde host. Geef `DOCKER_HOST_NAME` op elke host een eigen naam en maak de agent opnieuw aan: `docker rm -f oneuptime-docker-agent`, en voer daarna de opdracht uit stap 2 uit met de nieuwe naam.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dit installeert de agent voor **`web-1`**: laat `DOCKER_HOST_NAME` precies zoals het is, anders worden de gegevens als een nieuwe host geregistreerd.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (de opdracht `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "De tweede service is de OneUptime AI-agent, met dezelfde URL, sleutel en hostnaam. **AI-onderzoeken staan standaard aan**: terwijl OneUptime AI een incident of waarschuwing op deze host onderzoekt, voert het via de AI-agent alleen-lezen `docker`-opdrachten uit, en het verandert niets tenzij je oplossingen toestaat; zie **De OneUptime AI-agent** onder Geavanceerd. Verwijder de service `oneuptime-docker-ai-agent` om de collector zonder AI-onderzoeken te draaien.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Stel elk ervan in in de lijst `environment:` van de agent en voer daarna `docker compose up -d` uit om hem met de nieuwe waarden opnieuw aan te maken.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, de tweede service in docker-compose.yml, voert de `docker`-opdrachten uit waar OneUptime AI om vraagt terwijl het een incident of waarschuwing op deze host onderzoekt. **AI-onderzoeken staan standaard aan**: zodra hij verbinding heeft, onderzoekt OneUptime AI ermee, en de pagina **AI → AI-agent** van de host en zijn **Overzicht** tonen zijn status. Gebruik **Wat AI mag doen** op die pagina om onderzoeken uit te zetten; om de collector zonder de AI-agent te draaien, verwijder je zijn service en voer je `docker compose up -d --remove-orphans` uit.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Oplossingen zijn opt-in.** Voeg `- ONEUPTIME_AI_ALLOW_WRITES=true` toe aan zijn lijst `environment:` om hem een benoemde container opnieuw te laten starten, starten, stoppen, pauzeren, beëindigen of de limieten ervan te laten wijzigen. `ONEUPTIME_AI_FIXES` ernaast bepaalt of elke oplossing goedkeuring nodig heeft (`ask-for-approval`, `automatic` of `bypass-approval`), en de pagina **AI → AI-agent** van de host toont het. `ONEUPTIME_AI_WRITE_TARGETS` (kommagescheiden globs zoals `web-*,api-*`) beperkt welke containers; `ONEUPTIME_AI_PROTECTED_TARGETS` voegt containers toe die hij nooit mag wijzigen. Hij wijzigt nooit zichzelf of de collector.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Gebruik er een in plaats van `oneuptime/docker-agent:release` op de regel `image:` van de agent.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Upgraden**: haal in de map met docker-compose.yml de nieuwste images op en maak de containers opnieuw aan:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Verwijderen**: stop en verwijder alles wat het bestand heeft gestart:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'De agent moet als root draaien om `/var/run/docker.sock` te lezen. Zorg dat de service van de agent `user: "0:0"` heeft in docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "De daemon weigert een client die nieuwer is dan zijn eigen maximum, de collector stopt daardoor en de container blijft herstarten. De agent zet alleen een versie vast als `DOCKER_API_VERSION` er een noemt, en een oudere agent-image zette `1.44` vast, die Docker Engine 20.10 tot en met 24 weigeren. Haal `DOCKER_API_VERSION` uit de lijst `environment:` van de agent en voer daarna `docker compose pull` en `docker compose up -d` uit. De agent onderhandelt de versie dan met de daemon.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Voeg hem toe aan de lijst `environment:` van de agent, bijv. `- DOCKER_API_VERSION=1.41`, en voer `docker compose up -d` uit. Nieuwere daemons bedienen nog steeds oudere API-versies, dus een vastgezette versie blijft werken nadat je Docker hebt geüpgraded.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in docker-compose.yml kloppen.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "De naam van de host komt uit `DOCKER_HOST_NAME`. Een agent die zonder deze variabele is gestart, meldt `docker-host`, dus elke host die zo is ingericht, lijkt op dezelfde host. Geef `DOCKER_HOST_NAME` op elke host een eigen naam en voer `docker compose up -d` uit om de agent ermee opnieuw aan te maken.",
};

export default TRANSLATION;
