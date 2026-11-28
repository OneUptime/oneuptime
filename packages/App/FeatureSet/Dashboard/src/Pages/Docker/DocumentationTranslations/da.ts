import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 eller nyere",
  "Access to `/var/run/docker.sock` on the host":
    "Adgang til `/var/run/docker.sock` på værten",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Containere, hvis protokoller du vil have, skal bruge logdriveren `json-file`, som er Dockers standard",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Start derefter OneUptime AI-agenten ved siden af, med samme URL, nøgle og værtsnavn. **AI-undersøgelser er slået til som standard**: mens OneUptime AI undersøger en hændelse eller advarsel på denne vært, kører den skrivebeskyttede `docker`-kommandoer gennem AI-agenten, og den ændrer intet, medmindre du tillader rettelser; se **OneUptime AI-agenten** under Avanceret. Spring denne kommando over for at køre collectoren uden AI-undersøgelser.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Erstat `my-docker-host` med et navn til denne vært, f.eks. `prod-docker-01`. Det er sådan, værten vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny vært.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Kig efter denne linje i protokollerne:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Så snart agenten forbinder, vises værten automatisk i afsnittet **Docker**, som regel inden for et minuts tid. OneUptime AI-agenten vises som Forbundet på værtens side **AI → AI-agent** og nederst i dens **Oversigt**.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrævet | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL'en til din OneUptime-instans (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetri-indtagelsesnøglen fra trin 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Nej | Et genkendeligt navn til denne vært. Standard er `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nej | Den version af Docker Engine-API'et, som agenten taler. Tom som standard: agenten forhandler den med daemonen, så enhver Docker Engine fra 20.10 virker. Sæt den kun for at fastlåse en version (se Fejlfinding) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` til `ONEUPTIME_LOG_OPERATOR_5` | Nej | Dine egne collector-operatorer, én pr. variabel som JSON, til et logformat, agenten ikke læser |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Giv hver af dem til `docker run` som `-e NAME=value`. For at ændre en senere skal du fjerne agenten med `docker rm -f oneuptime-docker-agent` og køre kommandoen igen med den nye værdi.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "Agenten følger `/var/lib/docker/containers/*/*-json.log`, så den ser kun protokoller fra containere, der bruger Dockers logdriver **`json-file`**. Det er Dockers standard, men nogle værter skifter til `local` (binære filer, som agenten ikke kan læse) eller til en fjern driver (`journald`, `syslog`, `fluentd`, `gelf`, …), som ikke efterlader filer at læse.",
  "Check a container's log driver, and the daemon's default:":
    "Tjek en containers logdriver og daemonens standard:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Skift en Compose-tjeneste til `json-file`, med rotation:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Eller skift daemonens standard for alle containere, der oprettes bagefter, i `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Genstart derefter Docker, og **genopret** (ikke bare genstart) de berørte containere: en container beholder den logdriver, den blev oprettet med.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, den anden container, som trin 2 starter, kører de `docker`-kommandoer, OneUptime AI beder om, mens den undersøger en hændelse eller advarsel på denne vært. **AI-undersøgelser er slået til som standard**: så snart den forbinder, undersøger OneUptime AI med den, og værtens side **AI → AI-agent** og dens **Oversigt** viser dens status. Brug **Hvad AI må gøre** på den side for at slå undersøgelser fra; for at køre collectoren uden AI-agenten skal du fjerne den med `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Skrivebeskyttet som standard.** Den kører kommandoer som `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` og `docker stats --no-stream`, aldrig `exec`, `run`, `rm` eller `prune`. Miljøværdier i outputtet fra `docker inspect` maskeres, før noget forlader værten.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser skal slås til.** Tilføj `-e ONEUPTIME_AI_ALLOW_WRITES=true` til kommandoen for at lade den genstarte, starte, stoppe, sætte på pause, dræbe eller ændre grænserne for en navngiven container. `ONEUPTIME_AI_FIXES` ved siden af angiver, om hver rettelse kræver godkendelse (`ask-for-approval`, `automatic` eller `bypass-approval`), og værtens side **AI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerede globs som `web-*,api-*`) begrænser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` tilføjer containere, den aldrig må ændre. Den ændrer aldrig sig selv eller collectoren.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Den kører som root, fordi Docker-socketten ejes af root. Socketens `:ro`-mount gør ikke Docker-API'et skrivebeskyttet: grænsen er agentens kommandopolitik.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Dens protokoller: `docker logs -f oneuptime-docker-ai-agent`. Hvad den må køre, og hvordan rettelser virker: [AI-agenter til infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beskrivelse |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Seneste stabile udgivelse (community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Seneste stabile udgivelse (enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | En fastlåst version, f.eks. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | Det samme image, spejlet på GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Brug et af dem i stedet for `oneuptime/docker-agent:release` i slutningen af `docker run`-kommandoen.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Opgrader**: hent det seneste image, og fjern den kørende agent:",
  "Then run both `docker run` commands from step 2 again.":
    "Kør derefter begge `docker run`-kommandoer fra trin 2 igen.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Containerlogs** | stdout/stderr-protokoller fra alle containere |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Hver protokollinje får en alvorlighed ud fra det niveau, den nævner (`[ERROR]`, `level=warn`, `{"level":"info"}`); en linje uden niveau falder tilbage på sin strøm: stderr er `ERROR`, stdout er `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "Agenten skal køre som root for at læse `/var/run/docker.sock`. Sørg for, at flaget `--user 0:0` står i din `docker run`-kommando.",
  "The agent's logs show:": "Agentens protokoller viser:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Daemonen afviser en klient, der er nyere end dens eget maksimum, collectoren afslutter derfor, og containeren genstarter i en løkke. Agenten fastlåser kun en version, når `DOCKER_API_VERSION` angiver en, og et ældre agent-image fastlåste `1.44`, som Docker Engine 20.10 til 24 afviser. Fjern agenten (`docker rm -f oneuptime-docker-agent`), hent det seneste image (`docker pull oneuptime/docker-agent:release`), og kør kommandoen fra trin 2 igen, uden `-e DOCKER_API_VERSION`. Agenten forhandler så versionen med daemonen.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "For at fastlåse en version alligevel skal du ikke bruge mere end daemonens maksimum:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Tilføj den til kommandoen, f.eks. `-e DOCKER_API_VERSION=1.41`. Nyere daemoner betjener stadig ældre API-versioner, så en fastlåst version bliver ved med at virke, efter du har opgraderet Docker.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Tjek, at agenten kører: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Tjek agentens protokoller for fejl: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Tjek, at OneUptime-URL'en og indtagelsesnøglen i `docker run`-kommandoen er korrekte.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Sørg for, at værten kan nå din OneUptime-instans over netværket.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Tjek, at Docker-socketten er monteret i agenten. Dens image har ingen shell, så kig fra en engangscontainer, der deler dens mounts:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Kig derefter efter eksportfejl i agentens protokoller (`docker logs oneuptime-docker-agent 2>&1 | grep -i error`), og sørg for, at indtagelsesnøglen er gyldig og ikke er udløbet.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Kommer der metrikker, men er fanen **Protokoller** tom eller viser kun agentens egne protokoller? Dine containere bruger højst sandsynligt ikke logdriveren `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Hvis trin 1 viser `no files match the configured criteria`, eller trin 3 ikke viser nogen filer for dine containere, bruger de ikke `json-file`. Skift dem (se **Indsaml protokoller fra alle containere (logdriver json-file)** under Avanceret), og genopret derefter hver enkelt: en container beholder den logdriver, den blev oprettet med:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "En værts side viser de data, hvis værtsnavn er den værts identifikator, som agenten tager fra `DOCKER_HOST_NAME`. Ændrer du `DOCKER_HOST_NAME`, efter at værten er registreret, registrerer OneUptime en ny vært under det nye navn, og protokollerne ligger på den. Tjek det navn, agenten rapporterer:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Værtens navn kommer fra `DOCKER_HOST_NAME`. En agent, der er startet uden det, rapporterer `docker-host`, så alle værter, der er sat op på den måde, ligner den samme vært. Sæt `DOCKER_HOST_NAME` til et eget navn på hver vært, og genopret agenten: `docker rm -f oneuptime-docker-agent`, og kør derefter kommandoen fra trin 2 med det nye navn.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dette installerer agenten for **`web-1`**: lad `DOCKER_HOST_NAME` stå præcis, som det er, ellers registreres dataene som en ny vært.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (kommandoen `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Den anden tjeneste er OneUptime AI-agenten, med samme URL, nøgle og værtsnavn. **AI-undersøgelser er slået til som standard**: mens OneUptime AI undersøger en hændelse eller advarsel på denne vært, kører den skrivebeskyttede `docker`-kommandoer gennem AI-agenten, og den ændrer intet, medmindre du tillader rettelser; se **OneUptime AI-agenten** under Avanceret. Slet tjenesten `oneuptime-docker-ai-agent` for at køre collectoren uden AI-undersøgelser.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Sæt hver af dem i agentens liste `environment:`, og kør derefter `docker compose up -d` for at genoprette den med de nye værdier.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, den anden tjeneste i docker-compose.yml, kører de `docker`-kommandoer, OneUptime AI beder om, mens den undersøger en hændelse eller advarsel på denne vært. **AI-undersøgelser er slået til som standard**: så snart den forbinder, undersøger OneUptime AI med den, og værtens side **AI → AI-agent** og dens **Oversigt** viser dens status. Brug **Hvad AI må gøre** på den side for at slå undersøgelser fra; for at køre collectoren uden AI-agenten skal du slette dens tjeneste og køre `docker compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser skal slås til.** Tilføj `- ONEUPTIME_AI_ALLOW_WRITES=true` til dens liste `environment:` for at lade den genstarte, starte, stoppe, sætte på pause, dræbe eller ændre grænserne for en navngiven container. `ONEUPTIME_AI_FIXES` ved siden af angiver, om hver rettelse kræver godkendelse (`ask-for-approval`, `automatic` eller `bypass-approval`), og værtens side **AI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerede globs som `web-*,api-*`) begrænser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` tilføjer containere, den aldrig må ændre. Den ændrer aldrig sig selv eller collectoren.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Brug et af dem i stedet for `oneuptime/docker-agent:release` på agentens linje `image:`.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Opgrader**: hent de seneste images i mappen med docker-compose.yml, og genopret containerne:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Afinstallér**: stop og fjern alt, hvad filen har startet:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'Agenten skal køre som root for at læse `/var/run/docker.sock`. Sørg for, at agentens tjeneste har `user: "0:0"` i docker-compose.yml.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Daemonen afviser en klient, der er nyere end dens eget maksimum, collectoren afslutter derfor, og containeren genstarter i en løkke. Agenten fastlåser kun en version, når `DOCKER_API_VERSION` angiver en, og et ældre agent-image fastlåste `1.44`, som Docker Engine 20.10 til 24 afviser. Tag `DOCKER_API_VERSION` ud af agentens liste `environment:`, og kør derefter `docker compose pull` og `docker compose up -d`. Agenten forhandler så versionen med daemonen.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Tilføj den til agentens liste `environment:`, f.eks. `- DOCKER_API_VERSION=1.41`, og kør `docker compose up -d`. Nyere daemoner betjener stadig ældre API-versioner, så en fastlåst version bliver ved med at virke, efter du har opgraderet Docker.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Tjek, at OneUptime-URL'en og indtagelsesnøglen i docker-compose.yml er korrekte.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Værtens navn kommer fra `DOCKER_HOST_NAME`. En agent, der er startet uden det, rapporterer `docker-host`, så alle værter, der er sat op på den måde, ligner den samme vært. Sæt `DOCKER_HOST_NAME` til et eget navn på hver vært, og kør `docker compose up -d` for at genoprette agenten med det.",
};

export default TRANSLATION;
