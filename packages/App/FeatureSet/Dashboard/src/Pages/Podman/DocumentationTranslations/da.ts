import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 eller nyere",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Podmans Docker-kompatible API-socket på `/run/podman/podman.sock`: slå den til med `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Containere, hvis protokoller du vil have, skal bruge logdriveren `k8s-file`: rootful Podman bruger som standard `journald`, som agenten ikke kan læse",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Start derefter OneUptime AI-agenten ved siden af, med samme URL, nøgle og værtsnavn. **AI-undersøgelser er slået til som standard**: mens OneUptime AI undersøger en hændelse eller advarsel på denne vært, kører den skrivebeskyttede `docker`-kommandoer gennem AI-agenten mod Podmans Docker-kompatible socket, og den ændrer intet, medmindre du tillader rettelser; se **OneUptime AI-agenten** under Avanceret. Spring denne kommando over for at køre collectoren uden AI-undersøgelser.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Erstat `my-podman-host` med et navn til denne vært, f.eks. `prod-podman-01`. Det er sådan, værten vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny vært.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Kig efter denne linje i protokollerne:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Så snart agenten forbinder, vises værten automatisk i afsnittet **Podman**, som regel inden for et minuts tid. OneUptime AI-agenten vises som Forbundet på værtens side **AI → AI-agent** og nederst i dens **Oversigt**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Metrikker, men ingen protokoller?** Rootful Podman skriver som standard containerprotokoller til `journald`, som agenten ikke kan læse. Kør dine containere med `--log-driver k8s-file`; se **Indsaml protokoller fra alle containere (logdriver k8s-file)** under Avanceret.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetri-indtagelsesnøglen fra trin 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Nej | Et genkendeligt navn til denne vært. Standard er `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nej | Den version af Docker-API'et, som agenten taler med Podman-socketten. Tom som standard: agenten forhandler den med socketten. Sæt den kun for at fastlåse en version (se Fejlfinding) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` til `ONEUPTIME_LOG_OPERATOR_5` | Nej | Dine egne collector-operatorer, én pr. variabel som JSON, til et logformat, agenten ikke læser |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Giv hver af dem til `podman run` som `-e NAME=value`. For at ændre en senere skal du fjerne agenten med `podman rm -f oneuptime-podman-agent` og køre kommandoen igen med den nye værdi.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "Agenten læser de filer, som Podmans logdriver **`k8s-file`** skriver (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), så den ser kun protokoller fra containere, der bruger den (eller `json-file`, som Podman behandler som den samme filbaserede driver). Rootful Podmans standard er **`journald`**, som den ikke kan læse, og det kan den heller ikke med en fjern driver som `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Tjek en containers logdriver og Podmans standard:",
  "Run a single container with `k8s-file`:":
    "Kør en enkelt container med `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Skift en Compose-tjeneste til `k8s-file`, med rotation:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Eller skift standarden for alle containere, der oprettes bagefter, i `containers.conf` (`/etc/containers/containers.conf` for rootful, `~/.config/containers/containers.conf` for rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Genopret** derefter (ikke bare genstart) de berørte containere: en container beholder den logdriver, den blev oprettet med. Skal du beholde `journald`? Agenten indsamler stadig metrikker gennem socketten; kun containerprotokoller kræver den filbaserede driver.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, den anden container, som trin 2 starter, kører de `docker`-kommandoer, OneUptime AI beder om (gennem Podmans Docker-kompatible socket), mens den undersøger en hændelse eller advarsel på denne vært. **AI-undersøgelser er slået til som standard**: så snart den forbinder, undersøger OneUptime AI med den, og værtens side **AI → AI-agent** og dens **Oversigt** viser dens status. Brug **Hvad AI må gøre** på den side for at slå undersøgelser fra; for at køre collectoren uden AI-agenten skal du fjerne den med `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Skrivebeskyttet som standard.** Den kører kommandoer som `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` og `docker stats --no-stream`, aldrig `exec`, `run`, `rm` eller `prune`. Miljøværdier i outputtet fra `docker inspect` maskeres, før noget forlader værten.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser skal slås til.** Tilføj `-e ONEUPTIME_AI_ALLOW_WRITES=true` til kommandoen for at lade den genstarte, starte, stoppe, sætte på pause, dræbe eller ændre grænserne for en navngiven container. `ONEUPTIME_AI_FIXES` ved siden af angiver, om hver rettelse kræver godkendelse (`ask-for-approval`, `automatic` eller `bypass-approval`), og værtens side **AI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerede globs som `web-*,api-*`) begrænser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` tilføjer containere, den aldrig må ændre. Den ændrer aldrig sig selv eller collectoren.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Den kræver den samme socket som collectoren og kører som root, fordi socketten ejes af root. Socketens `:ro`-mount gør ikke API'et skrivebeskyttet: grænsen er agentens kommandopolitik.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Dens protokoller: `podman logs -f oneuptime-podman-ai-agent`. Hvad den må køre, og hvordan rettelser virker: [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beskrivelse |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Seneste stabile udgivelse (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Seneste stabile udgivelse (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | En fastlåst version, f.eks. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Det samme image, spejlet på GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Brug et af dem i stedet for `oneuptime/podman-agent:release` i slutningen af `podman run`-kommandoen.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Opgrader**: hent det seneste image, og fjern den kørende agent:",
  "Then run both `podman run` commands from step 2 again.":
    "Kør derefter begge `podman run`-kommandoer fra trin 2 igen.",
  "**Uninstall:**": "**Afinstallér:**",
  "| Category | Data |": "| Kategori | Data |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU-metrikker** | Samlet forbrug, forbrug i procent, drosselingstid (pr. container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Hukommelsesmetrikker** | Forbrug, grænse, procent, RSS, cache (pr. container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Netværksmetrikker** | Modtagne/sendte bytes og pakker (pr. container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Blok-I/O-metrikker** | Læste/skrevne bytes og operationer (pr. container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Containerinfo** | Oppetid, antal genstarter, antal processer |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Containerlogs** | stdout/stderr-protokoller fra alle containere, der bruger logdriveren `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Metrikkerne kommer fra collectorens receiver `docker_stats` gennem Podmans Docker-kompatible socket, så deres navne er de samme som Docker-agentens. Hver protokollinje får en alvorlighed ud fra det niveau, den nævner (`[ERROR]`, `level=warn`, `{"level":"info"}`); en linje uden niveau falder tilbage på sin strøm: stderr er `ERROR`, stdout er `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "Agenten skal køre som root for at læse `/run/podman/podman.sock`. Sørg for, at flaget `--user 0:0` står i din `podman run`-kommando, og at socketten er slået til:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Det er rootful Podmans socket, den som agenten læser. Kører du Podman rootless? Så er dens socket `/run/user/<uid>/podman/podman.sock` (slå den til med `systemctl --user enable --now podman.socket`) og dens lager `~/.local/share/containers/storage`: montér dem i stedet på `/run/podman/podman.sock` og `/var/lib/containers/storage` i agentens container; se dokumentationen til Podman-agenten.",
  "The agent's logs show:": "Agentens protokoller viser:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "En server, der håndhæver et maksimum, afviser en nyere klient, collectoren afslutter derfor, og containeren genstarter i en løkke. Agenten fastlåser kun en Docker-API-version, når `DOCKER_API_VERSION` angiver en, og et ældre agent-image fastlåste `1.44`. Fjern agenten (`podman rm -f oneuptime-podman-agent`), hent det seneste image (`podman pull oneuptime/podman-agent:release`), og kør kommandoen fra trin 2 igen, uden `-e DOCKER_API_VERSION`. Agenten forhandler så versionen med socketten.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "For at fastlåse en version alligevel skal du ikke bruge mere end den version, socketten rapporterer:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Tilføj den til kommandoen, f.eks. `-e DOCKER_API_VERSION=1.41`. Nyere servere betjener stadig ældre API-versioner, så en fastlåst version bliver ved med at virke efter en opgradering.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Tjek, at agenten kører: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Tjek agentens protokoller for fejl: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Tjek, at OneUptime-URL'en og indtagelsesnøglen i `podman run`-kommandoen er korrekte.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Sørg for, at værten kan nå din OneUptime-instans over netværket.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Tjek, at Podman-socketten er monteret i agenten. Dens image har ingen shell, så kig fra en engangscontainer, der deler dens mounts:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Kig derefter efter eksportfejl i agentens protokoller (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`), og sørg for, at indtagelsesnøglen er gyldig og ikke er udløbet.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Kommer der metrikker, men er fanen **Protokoller** tom eller viser kun agentens egne protokoller? Dine containere bruger højst sandsynligt ikke en filbaseret logdriver (`k8s-file` eller `json-file`): rootful Podman bruger som standard `journald`, som agenten ikke kan læse.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Hvis trin 1 viser `no files match the configured criteria`, eller trin 3 ikke viser nogen filer for dine containere, bruger de ikke `k8s-file`. Skift dem (se **Indsaml protokoller fra alle containere (logdriver k8s-file)** under Avanceret), og genopret derefter hver enkelt: en container beholder den logdriver, den blev oprettet med:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "En værts side viser de data, hvis værtsnavn er den værts identifikator, som agenten tager fra `PODMAN_HOST_NAME`. Ændrer du `PODMAN_HOST_NAME`, efter at værten er registreret, registrerer OneUptime en ny vært under det nye navn, og protokollerne ligger på den. Tjek det navn, agenten rapporterer:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Værtens navn kommer fra `PODMAN_HOST_NAME`. En agent, der er startet uden det, rapporterer `podman-host`, så alle værter, der er sat op på den måde, ligner den samme vært. Sæt `PODMAN_HOST_NAME` til et eget navn på hver vært, og genopret agenten: `podman rm -f oneuptime-podman-agent`, og kør derefter kommandoen fra trin 2 med det nye navn.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dette installerer agenten for **`web-1`**: lad `PODMAN_HOST_NAME` stå præcis, som det er, ellers registreres dataene som en ny vært.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "En Compose-udbyder til `podman compose`: `podman-compose` eller Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Den anden tjeneste er OneUptime AI-agenten, med samme URL, nøgle og værtsnavn. **AI-undersøgelser er slået til som standard**: mens OneUptime AI undersøger en hændelse eller advarsel på denne vært, kører den skrivebeskyttede `docker`-kommandoer gennem AI-agenten mod Podmans Docker-kompatible socket, og den ændrer intet, medmindre du tillader rettelser; se **OneUptime AI-agenten** under Avanceret. Slet tjenesten `oneuptime-podman-ai-agent` for at køre collectoren uden AI-undersøgelser.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Sæt hver af dem i agentens liste `environment:`, og kør derefter `podman compose up -d` for at genoprette den med de nye værdier.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, den anden tjeneste i docker-compose.yml, kører de `docker`-kommandoer, OneUptime AI beder om (gennem Podmans Docker-kompatible socket), mens den undersøger en hændelse eller advarsel på denne vært. **AI-undersøgelser er slået til som standard**: så snart den forbinder, undersøger OneUptime AI med den, og værtens side **AI → AI-agent** og dens **Oversigt** viser dens status. Brug **Hvad AI må gøre** på den side for at slå undersøgelser fra; for at køre collectoren uden AI-agenten skal du slette dens tjeneste og køre `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser skal slås til.** Tilføj `- ONEUPTIME_AI_ALLOW_WRITES=true` til dens liste `environment:` for at lade den genstarte, starte, stoppe, sætte på pause, dræbe eller ændre grænserne for en navngiven container. `ONEUPTIME_AI_FIXES` ved siden af angiver, om hver rettelse kræver godkendelse (`ask-for-approval`, `automatic` eller `bypass-approval`), og værtens side **AI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerede globs som `web-*,api-*`) begrænser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` tilføjer containere, den aldrig må ændre. Den ændrer aldrig sig selv eller collectoren.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Brug et af dem i stedet for `oneuptime/podman-agent:release` på agentens linje `image:`.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Opgrader**: hent de seneste images i mappen med docker-compose.yml, og genopret containerne:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Afinstallér**: stop og fjern alt, hvad filen har startet:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'Agenten skal køre som root for at læse `/run/podman/podman.sock`. Sørg for, at agentens tjeneste har `user: "0:0"` i docker-compose.yml, og at socketten er slået til:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "En server, der håndhæver et maksimum, afviser en nyere klient, collectoren afslutter derfor, og containeren genstarter i en løkke. Agenten fastlåser kun en Docker-API-version, når `DOCKER_API_VERSION` angiver en, og et ældre agent-image fastlåste `1.44`. Tag `DOCKER_API_VERSION` ud af agentens liste `environment:`, og kør derefter `podman compose pull` og `podman compose up -d`. Agenten forhandler så versionen med socketten.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Tilføj den til agentens liste `environment:`, f.eks. `- DOCKER_API_VERSION=1.41`, og kør `podman compose up -d`. Nyere servere betjener stadig ældre API-versioner, så en fastlåst version bliver ved med at virke efter en opgradering.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Tjek, at OneUptime-URL'en og indtagelsesnøglen i docker-compose.yml er korrekte.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Værtens navn kommer fra `PODMAN_HOST_NAME`. En agent, der er startet uden det, rapporterer `podman-host`, så alle værter, der er sat op på den måde, ligner den samme vært. Sæt `PODMAN_HOST_NAME` til et eget navn på hver vært, og kør `podman compose up -d` for at genoprette agenten med det.",
};

export default TRANSLATION;
