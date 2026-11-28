import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 of nieuwer",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "De Docker-compatibele API-socket van Podman op `/run/podman/podman.sock`: zet hem aan met `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Containers waarvan je de logboeken wilt, moeten de logdriver `k8s-file` gebruiken: rootful Podman gebruikt standaard `journald`, dat de agent niet kan lezen",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Start daarna de OneUptime AI-agent ernaast, met dezelfde URL, sleutel en hostnaam. **AI-onderzoeken staan standaard aan**: terwijl OneUptime AI een incident of waarschuwing op deze host onderzoekt, voert het via de AI-agent alleen-lezen `docker`-opdrachten uit tegen de Docker-compatibele socket van Podman, en het verandert niets tenzij je oplossingen toestaat; zie **De OneUptime AI-agent** onder Geavanceerd. Sla deze opdracht over om de collector zonder AI-onderzoeken te draaien.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Vervang `my-podman-host` door een naam voor deze host, zoals `prod-podman-01`. Onder die naam verschijnt de host in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuwe host.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "Look for this line in the logs:": "Zoek deze regel in de logboeken:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Zodra de agent verbinding heeft, verschijnt de host automatisch in het onderdeel **Podman**, meestal binnen een minuut of zo. De OneUptime AI-agent staat als Verbonden op de pagina **AI → AI-agent** van de host en onderaan zijn **Overzicht**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Metrics maar geen logboeken?** Rootful Podman schrijft containerlogboeken standaard naar `journald`, dat de agent niet kan lezen. Draai je containers met `--log-driver k8s-file`; zie **Logboeken van alle containers verzamelen (logdriver k8s-file)** onder Geavanceerd.",
  "| Variable | Required | Description |":
    "| Variabele | Verplicht | Beschrijving |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | De URL van je OneUptime-instantie (bijv. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | De telemetrie-ingestiesleutel uit stap 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Nee | Een herkenbare naam voor deze host. Standaard `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nee | De versie van de Docker-API die de agent met de Podman-socket spreekt. Standaard leeg: de agent onderhandelt hem met de socket. Stel hem alleen in om een versie vast te zetten (zie Probleemoplossing) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` tot en met `ONEUPTIME_LOG_OPERATOR_5` | Nee | Eigen collector-operators, één per variabele als JSON, voor een logformaat dat de agent niet leest |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Geef elk ervan aan `podman run` mee als `-e NAME=value`. Om er later een te wijzigen, verwijder je de agent met `podman rm -f oneuptime-podman-agent` en voer je de opdracht opnieuw uit met de nieuwe waarde.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "De agent leest de bestanden die de logdriver **`k8s-file`** van Podman schrijft (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), dus hij ziet alleen logboeken van containers die hem gebruiken (of `json-file`, dat Podman als dezelfde bestandsgebaseerde driver behandelt). De standaard van rootful Podman is **`journald`**, dat hij niet kan lezen, net zomin als een externe driver zoals `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Controleer de logdriver van een container en de standaard van Podman:",
  "Run a single container with `k8s-file`:":
    "Draai één container met `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Zet een Compose-service over op `k8s-file`, met rotatie:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Of wijzig de standaard voor elke container die daarna wordt gemaakt, in `containers.conf` (`/etc/containers/containers.conf` voor rootful, `~/.config/containers/containers.conf` voor rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Maak daarna de betreffende containers opnieuw aan** (opnieuw starten is niet genoeg): een container houdt de logdriver waarmee hij is gemaakt. Moet je `journald` houden? De agent verzamelt nog steeds metrics via de socket; alleen containerlogboeken hebben de bestandsgebaseerde driver nodig.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, de tweede container die stap 2 start, voert de `docker`-opdrachten uit waar OneUptime AI om vraagt (via de Docker-compatibele socket van Podman) terwijl het een incident of waarschuwing op deze host onderzoekt. **AI-onderzoeken staan standaard aan**: zodra hij verbinding heeft, onderzoekt OneUptime AI ermee, en de pagina **AI → AI-agent** van de host en zijn **Overzicht** tonen zijn status. Gebruik **Wat AI mag doen** op die pagina om onderzoeken uit te zetten; om de collector zonder de AI-agent te draaien, verwijder je hem met `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Standaard alleen-lezen.** Hij voert opdrachten uit zoals `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` en `docker stats --no-stream`, nooit `exec`, `run`, `rm` of `prune`. Omgevingswaarden in de uitvoer van `docker inspect` worden gemaskeerd voordat er iets de host verlaat.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Oplossingen zijn opt-in.** Voeg `-e ONEUPTIME_AI_ALLOW_WRITES=true` toe aan de opdracht om hem een benoemde container opnieuw te laten starten, starten, stoppen, pauzeren, beëindigen of de limieten ervan te laten wijzigen. `ONEUPTIME_AI_FIXES` ernaast bepaalt of elke oplossing goedkeuring nodig heeft (`ask-for-approval`, `automatic` of `bypass-approval`), en de pagina **AI → AI-agent** van de host toont het. `ONEUPTIME_AI_WRITE_TARGETS` (kommagescheiden globs zoals `web-*,api-*`) beperkt welke containers; `ONEUPTIME_AI_PROTECTED_TARGETS` voegt containers toe die hij nooit mag wijzigen. Hij wijzigt nooit zichzelf of de collector.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Hij heeft dezelfde socket nodig als de collector en draait als root omdat de socket van root is. De `:ro`-mount van de socket maakt de API niet alleen-lezen: de grens is het opdrachtenbeleid van de agent.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Zijn logboeken: `podman logs -f oneuptime-podman-ai-agent`. Wat hij mag uitvoeren en hoe oplossingen werken: [AI-agents voor infrastructuur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beschrijving |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Nieuwste stabiele release (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Nieuwste stabiele release (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Een vastgezette versie, bijv. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Dezelfde image, gespiegeld op GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Gebruik er een in plaats van `oneuptime/podman-agent:release` aan het eind van de `podman run`-opdracht.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Upgraden**: haal de nieuwste image op en verwijder de draaiende agent:",
  "Then run both `podman run` commands from step 2 again.":
    "Voer daarna beide `podman run`-opdrachten uit stap 2 opnieuw uit.",
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
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Containerlogboeken** | stdout/stderr-logboeken van alle containers die de logdriver `k8s-file` gebruiken |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'De metrics komen van de receiver `docker_stats` van de collector, via de Docker-compatibele socket van Podman, dus ze heten hetzelfde als die van de Docker-agent. Elke logregel krijgt een ernst op basis van het niveau dat hij noemt (`[ERROR]`, `level=warn`, `{"level":"info"}`); een regel zonder niveau valt terug op zijn stream: stderr is `ERROR`, stdout is `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "De agent moet als root draaien om `/run/podman/podman.sock` te lezen. Zorg dat de vlag `--user 0:0` in je `podman run`-opdracht staat en dat de socket aanstaat:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Dat is de socket van rootful Podman, de socket die de agent leest. Draai je Podman rootless? Dan is zijn socket `/run/user/<uid>/podman/podman.sock` (zet hem aan met `systemctl --user enable --now podman.socket`) en zijn opslag `~/.local/share/containers/storage`: mount die in plaats daarvan op `/run/podman/podman.sock` en `/var/lib/containers/storage` in de container van de agent; zie de documentatie van de Podman-agent.",
  "The agent's logs show:": "De logboeken van de agent tonen:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Een server die een maximum afdwingt, weigert een nieuwere client, de collector stopt daardoor en de container blijft herstarten. De agent zet alleen een Docker-API-versie vast als `DOCKER_API_VERSION` er een noemt, en een oudere agent-image zette `1.44` vast. Verwijder de agent (`podman rm -f oneuptime-podman-agent`), haal de nieuwste image op (`podman pull oneuptime/podman-agent:release`) en voer de opdracht uit stap 2 opnieuw uit, zonder `-e DOCKER_API_VERSION`. De agent onderhandelt de versie dan met de socket.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Wil je toch een versie vastzetten, gebruik dan niet meer dan de versie die de socket meldt:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Voeg hem toe aan de opdracht, bijv. `-e DOCKER_API_VERSION=1.41`. Nieuwere servers bedienen nog steeds oudere API-versies, dus een vastgezette versie blijft werken na een upgrade.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Controleer of de agent draait: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Controleer de logboeken van de agent op fouten: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in de `podman run`-opdracht kloppen.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Zorg dat de host je OneUptime-instantie via het netwerk kan bereiken.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Controleer of de Podman-socket in de agent is gemount. Zijn image heeft geen shell, dus kijk vanuit een wegwerpcontainer die zijn mounts deelt:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Zoek daarna naar exportfouten in de logboeken van de agent (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`) en controleer of de ingestiesleutel geldig is en niet is verlopen.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Komen er metrics binnen, maar is het tabblad **Logboeken** leeg of toont het alleen de eigen logboeken van de agent? Je containers gebruiken hoogstwaarschijnlijk geen bestandsgebaseerde logdriver (`k8s-file` of `json-file`): rootful Podman gebruikt standaard `journald`, dat de agent niet kan lezen.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Als stap 1 `no files match the configured criteria` toont, of stap 3 geen bestanden voor je containers toont, gebruiken ze geen `k8s-file`. Zet ze om (zie **Logboeken van alle containers verzamelen (logdriver k8s-file)** onder Geavanceerd) en maak ze daarna stuk voor stuk opnieuw aan: een container houdt de logdriver waarmee hij is gemaakt:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "De pagina van een host toont de gegevens waarvan de hostnaam de identificatie van die host is, die de agent uit `PODMAN_HOST_NAME` haalt. Wijzig je `PODMAN_HOST_NAME` nadat de host is geregistreerd, dan registreert OneUptime een tweede host onder de nieuwe naam, en daar staan de logboeken. Controleer de naam die de agent meldt:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "De naam van de host komt uit `PODMAN_HOST_NAME`. Een agent die zonder deze variabele is gestart, meldt `podman-host`, dus elke host die zo is ingericht, lijkt op dezelfde host. Geef `PODMAN_HOST_NAME` op elke host een eigen naam en maak de agent opnieuw aan: `podman rm -f oneuptime-podman-agent`, en voer daarna de opdracht uit stap 2 uit met de nieuwe naam.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dit installeert de agent voor **`web-1`**: laat `PODMAN_HOST_NAME` precies zoals het is, anders worden de gegevens als een nieuwe host geregistreerd.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Een Compose-provider voor `podman compose`: `podman-compose` of Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "De tweede service is de OneUptime AI-agent, met dezelfde URL, sleutel en hostnaam. **AI-onderzoeken staan standaard aan**: terwijl OneUptime AI een incident of waarschuwing op deze host onderzoekt, voert het via de AI-agent alleen-lezen `docker`-opdrachten uit tegen de Docker-compatibele socket van Podman, en het verandert niets tenzij je oplossingen toestaat; zie **De OneUptime AI-agent** onder Geavanceerd. Verwijder de service `oneuptime-podman-ai-agent` om de collector zonder AI-onderzoeken te draaien.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Stel elk ervan in in de lijst `environment:` van de agent en voer daarna `podman compose up -d` uit om hem met de nieuwe waarden opnieuw aan te maken.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, de tweede service in docker-compose.yml, voert de `docker`-opdrachten uit waar OneUptime AI om vraagt (via de Docker-compatibele socket van Podman) terwijl het een incident of waarschuwing op deze host onderzoekt. **AI-onderzoeken staan standaard aan**: zodra hij verbinding heeft, onderzoekt OneUptime AI ermee, en de pagina **AI → AI-agent** van de host en zijn **Overzicht** tonen zijn status. Gebruik **Wat AI mag doen** op die pagina om onderzoeken uit te zetten; om de collector zonder de AI-agent te draaien, verwijder je zijn service en voer je `podman compose up -d --remove-orphans` uit.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Oplossingen zijn opt-in.** Voeg `- ONEUPTIME_AI_ALLOW_WRITES=true` toe aan zijn lijst `environment:` om hem een benoemde container opnieuw te laten starten, starten, stoppen, pauzeren, beëindigen of de limieten ervan te laten wijzigen. `ONEUPTIME_AI_FIXES` ernaast bepaalt of elke oplossing goedkeuring nodig heeft (`ask-for-approval`, `automatic` of `bypass-approval`), en de pagina **AI → AI-agent** van de host toont het. `ONEUPTIME_AI_WRITE_TARGETS` (kommagescheiden globs zoals `web-*,api-*`) beperkt welke containers; `ONEUPTIME_AI_PROTECTED_TARGETS` voegt containers toe die hij nooit mag wijzigen. Hij wijzigt nooit zichzelf of de collector.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Gebruik er een in plaats van `oneuptime/podman-agent:release` op de regel `image:` van de agent.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Upgraden**: haal in de map met docker-compose.yml de nieuwste images op en maak de containers opnieuw aan:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Verwijderen**: stop en verwijder alles wat het bestand heeft gestart:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'De agent moet als root draaien om `/run/podman/podman.sock` te lezen. Zorg dat de service van de agent `user: "0:0"` heeft in docker-compose.yml en dat de socket aanstaat:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Een server die een maximum afdwingt, weigert een nieuwere client, de collector stopt daardoor en de container blijft herstarten. De agent zet alleen een Docker-API-versie vast als `DOCKER_API_VERSION` er een noemt, en een oudere agent-image zette `1.44` vast. Haal `DOCKER_API_VERSION` uit de lijst `environment:` van de agent en voer daarna `podman compose pull` en `podman compose up -d` uit. De agent onderhandelt de versie dan met de socket.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Voeg hem toe aan de lijst `environment:` van de agent, bijv. `- DOCKER_API_VERSION=1.41`, en voer `podman compose up -d` uit. Nieuwere servers bedienen nog steeds oudere API-versies, dus een vastgezette versie blijft werken na een upgrade.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in docker-compose.yml kloppen.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "De naam van de host komt uit `PODMAN_HOST_NAME`. Een agent die zonder deze variabele is gestart, meldt `podman-host`, dus elke host die zo is ingericht, lijkt op dezelfde host. Geef `PODMAN_HOST_NAME` op elke host een eigen naam en voer `podman compose up -d` uit om de agent ermee opnieuw aan te maken.",
};

export default TRANSLATION;
