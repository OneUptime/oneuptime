import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 eller nyere",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Podmans Docker-kompatible API-socket på `/run/podman/podman.sock`: slå den på med `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Containere du vil ha logger fra, må bruke loggdriveren `k8s-file`: rootful Podman bruker som standard `journald`, som agenten ikke kan lese",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Start deretter OneUptime KI-agenten ved siden av, med samme URL, nøkkel og vertsnavn. **KI-undersøkelser er slått på som standard**: mens OneUptime AI undersøker en hendelse eller et varsel på denne verten, kjører den skrivebeskyttede `docker`-kommandoer gjennom KI-agenten mot Podmans Docker-kompatible socket, og den endrer ingenting med mindre du tillater rettelser; se **OneUptime KI-agenten** under Avansert. Hopp over denne kommandoen for å kjøre innsamleren uten KI-undersøkelser.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Erstatt `my-podman-host` med et navn på denne verten, for eksempel `prod-podman-01`. Det er slik verten vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny vert.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "Look for this line in the logs:": "Se etter denne linjen i loggene:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Så snart agenten kobler til, vises verten automatisk i delen **Podman**, vanligvis innen et minutt eller så. OneUptime KI-agenten vises som Tilkoblet på vertens side **KI → AI-agent** og nederst i dens **Oversikt**.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Målinger, men ingen logger?** Rootful Podman skriver som standard containerlogger til `journald`, som agenten ikke kan lese. Kjør containerne dine med `--log-driver k8s-file`; se **Samle inn logger fra alle containere (loggdriver k8s-file)** under Avansert.",
  "| Variable | Required | Description |":
    "| Variabel | Påkrevd | Beskrivelse |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | URL-en til OneUptime-instansen din (f.eks. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Telemetri-inntaksnøkkelen fra trinn 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Nei | Et gjenkjennelig navn på denne verten. Standard er `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nei | Versjonen av Docker-API-et som agenten snakker med Podman-socketen. Tom som standard: agenten forhandler den med socketen. Sett den bare for å låse en versjon (se Feilsøking) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` til `ONEUPTIME_LOG_OPERATOR_5` | Nei | Dine egne operatorer for innsamleren, én per variabel som JSON, for et loggformat agenten ikke leser |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Gi hver av dem til `podman run` som `-e NAME=value`. For å endre en senere fjerner du agenten med `podman rm -f oneuptime-podman-agent` og kjører kommandoen på nytt med den nye verdien.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "Agenten leser filene som Podmans loggdriver **`k8s-file`** skriver (`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`), så den ser bare logger fra containere som bruker den (eller `json-file`, som Podman behandler som den samme filbaserte driveren). Standarden til rootful Podman er **`journald`**, som den ikke kan lese, og heller ikke en ekstern driver som `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Sjekk loggdriveren til en container og Podmans standard:",
  "Run a single container with `k8s-file`:":
    "Kjør én container med `k8s-file`:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Bytt en Compose-tjeneste til `k8s-file`, med rotasjon:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Eller endre standarden for alle containere som opprettes etterpå, i `containers.conf` (`/etc/containers/containers.conf` for rootful, `~/.config/containers/containers.conf` for rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Opprett** deretter de berørte containerne på nytt (en omstart er ikke nok): en container beholder loggdriveren den ble opprettet med. Må du beholde `journald`? Agenten samler fortsatt inn målinger gjennom socketen; bare containerlogger trenger den filbaserte driveren.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, den andre containeren som trinn 2 starter, kjører `docker`-kommandoene OneUptime AI ber om (gjennom Podmans Docker-kompatible socket) mens den undersøker en hendelse eller et varsel på denne verten. **KI-undersøkelser er slått på som standard**: så snart den kobler til, undersøker OneUptime AI med den, og vertens side **KI → AI-agent** og dens **Oversikt** viser statusen dens. Bruk **Hva AI kan gjøre** på den siden for å slå av undersøkelser; for å kjøre innsamleren uten KI-agenten fjerner du den med `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Skrivebeskyttet som standard.** Den kjører kommandoer som `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` og `docker stats --no-stream`, aldri `exec`, `run`, `rm` eller `prune`. Miljøverdier i utdataene fra `docker inspect` maskeres før noe forlater verten.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser må slås på.** Legg til `-e ONEUPTIME_AI_ALLOW_WRITES=true` i kommandoen for å la den starte på nytt, starte, stoppe, pause, drepe eller endre grensene for en navngitt container. `ONEUPTIME_AI_FIXES` ved siden av angir om hver rettelse trenger godkjenning (`ask-for-approval`, `automatic` eller `bypass-approval`), og vertens side **KI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerte globs som `web-*,api-*`) begrenser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` legger til containere den aldri får endre. Den endrer aldri seg selv eller innsamleren.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Den trenger den samme socketen som innsamleren, og kjører som root fordi socketen eies av root. Socketens `:ro`-montering gjør ikke API-et skrivebeskyttet: grensen er agentens kommandopolicy.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Loggene dens: `podman logs -f oneuptime-podman-ai-agent`. Hva den kan kjøre, og hvordan rettelser fungerer: [KI-agenter for infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tagg | Beskrivelse |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Siste stabile utgivelse (community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Siste stabile utgivelse (enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | En låst versjon, f.eks. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Samme image, speilet på GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Bruk en av dem i stedet for `oneuptime/podman-agent:release` på slutten av `podman run`-kommandoen.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Oppgrader**: hent det nyeste imaget og fjern agenten som kjører:",
  "Then run both `podman run` commands from step 2 again.":
    "Kjør deretter begge `podman run`-kommandoene fra trinn 2 på nytt.",
  "**Uninstall:**": "**Avinstaller:**",
  "| Category | Data |": "| Kategori | Data |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU-målinger** | Totalt forbruk, forbruk i prosent, strupetid (per container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Minnemålinger** | Forbruk, grense, prosent, RSS, hurtigbuffer (per container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Nettverksmålinger** | Mottatte/sendte byte og pakker (per container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Blokk-I/O-målinger** | Leste/skrevne byte og operasjoner (per container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Containerinfo** | Oppetid, antall omstarter, antall prosesser |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Containerlogger** | stdout/stderr-logger fra alle containere som bruker loggdriveren `k8s-file` |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Målingene kommer fra innsamlerens receiver `docker_stats` gjennom Podmans Docker-kompatible socket, så navnene deres er de samme som Docker-agentens. Hver logglinje får en alvorlighetsgrad fra nivået den nevner (`[ERROR]`, `level=warn`, `{"level":"info"}`); en linje uten nivå faller tilbake på strømmen sin: stderr er `ERROR`, stdout er `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "Agenten må kjøre som root for å lese `/run/podman/podman.sock`. Sørg for at flagget `--user 0:0` står i `podman run`-kommandoen din, og at socketen er slått på:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Det er socketen til rootful Podman, den agenten leser. Kjører du Podman rootless? Da er socketen `/run/user/<uid>/podman/podman.sock` (slå den på med `systemctl --user enable --now podman.socket`) og lagringen `~/.local/share/containers/storage`: monter dem i stedet på `/run/podman/podman.sock` og `/var/lib/containers/storage` i agentens container; se dokumentasjonen for Podman-agenten.",
  "The agent's logs show:": "Agentens logger viser:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "En server som håndhever et maksimum, avviser en nyere klient, innsamleren avslutter derfor, og containeren starter på nytt i en løkke. Agenten låser bare en Docker-API-versjon når `DOCKER_API_VERSION` angir en, og et eldre agent-image låste `1.44`. Fjern agenten (`podman rm -f oneuptime-podman-agent`), hent det nyeste imaget (`podman pull oneuptime/podman-agent:release`) og kjør kommandoen fra trinn 2 på nytt, uten `-e DOCKER_API_VERSION`. Agenten forhandler da versjonen med socketen.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "For å låse en versjon likevel, bruk ikke mer enn versjonen socketen rapporterer:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Legg den til i kommandoen, f.eks. `-e DOCKER_API_VERSION=1.41`. Nyere servere betjener fortsatt eldre API-versjoner, så en låst versjon fortsetter å fungere etter en oppgradering.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Sjekk at agenten kjører: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Sjekk agentens logger for feil: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Sjekk at OneUptime-URL-en og inntaksnøkkelen i `podman run`-kommandoen er riktige.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Sørg for at verten kan nå OneUptime-instansen din over nettverket.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Sjekk at Podman-socketen er montert i agenten. Imaget har ikke noe skall, så se etter fra en engangscontainer som deler monteringene dens:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Se deretter etter eksportfeil i agentens logger (`podman logs oneuptime-podman-agent 2>&1 | grep -i error`), og sørg for at inntaksnøkkelen er gyldig og ikke har utløpt.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Kommer det målinger, men fanen **Logger** er tom eller viser bare agentens egne logger? Containerne dine bruker mest sannsynlig ikke en filbasert loggdriver (`k8s-file` eller `json-file`): rootful Podman bruker som standard `journald`, som agenten ikke kan lese.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Hvis trinn 1 viser `no files match the configured criteria`, eller trinn 3 ikke viser noen filer for containerne dine, bruker de ikke `k8s-file`. Bytt dem (se **Samle inn logger fra alle containere (loggdriver k8s-file)** under Avansert), og opprett deretter hver enkelt på nytt: en container beholder loggdriveren den ble opprettet med:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "Siden til en vert viser dataene der vertsnavnet er vertens identifikator, som agenten henter fra `PODMAN_HOST_NAME`. Endrer du `PODMAN_HOST_NAME` etter at verten er registrert, registrerer OneUptime en ny vert under det nye navnet, og loggene ligger på den. Sjekk navnet agenten rapporterer:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Vertens navn kommer fra `PODMAN_HOST_NAME`. En agent som er startet uten den, rapporterer `podman-host`, så alle verter som er satt opp slik, ser ut som den samme verten. Sett `PODMAN_HOST_NAME` til et eget navn på hver vert, og opprett agenten på nytt: `podman rm -f oneuptime-podman-agent`, og kjør så kommandoen fra trinn 2 med det nye navnet.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dette installerer agenten for **`web-1`**: la `PODMAN_HOST_NAME` stå nøyaktig som den er, ellers registreres dataene som en ny vert.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "En Compose-leverandør for `podman compose`: `podman-compose` eller Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Den andre tjenesten er OneUptime KI-agenten, med samme URL, nøkkel og vertsnavn. **KI-undersøkelser er slått på som standard**: mens OneUptime AI undersøker en hendelse eller et varsel på denne verten, kjører den skrivebeskyttede `docker`-kommandoer gjennom KI-agenten mot Podmans Docker-kompatible socket, og den endrer ingenting med mindre du tillater rettelser; se **OneUptime KI-agenten** under Avansert. Slett tjenesten `oneuptime-podman-ai-agent` for å kjøre innsamleren uten KI-undersøkelser.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Sett hver av dem i agentens liste `environment:`, og kjør deretter `podman compose up -d` for å opprette den på nytt med de nye verdiene.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, den andre tjenesten i docker-compose.yml, kjører `docker`-kommandoene OneUptime AI ber om (gjennom Podmans Docker-kompatible socket) mens den undersøker en hendelse eller et varsel på denne verten. **KI-undersøkelser er slått på som standard**: så snart den kobler til, undersøker OneUptime AI med den, og vertens side **KI → AI-agent** og dens **Oversikt** viser statusen dens. Bruk **Hva AI kan gjøre** på den siden for å slå av undersøkelser; for å kjøre innsamleren uten KI-agenten sletter du tjenesten dens og kjører `podman compose up -d --remove-orphans`.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Rettelser må slås på.** Legg til `- ONEUPTIME_AI_ALLOW_WRITES=true` i listen `environment:` dens for å la den starte på nytt, starte, stoppe, pause, drepe eller endre grensene for en navngitt container. `ONEUPTIME_AI_FIXES` ved siden av angir om hver rettelse trenger godkjenning (`ask-for-approval`, `automatic` eller `bypass-approval`), og vertens side **KI → AI-agent** viser det. `ONEUPTIME_AI_WRITE_TARGETS` (kommaseparerte globs som `web-*,api-*`) begrenser hvilke containere; `ONEUPTIME_AI_PROTECTED_TARGETS` legger til containere den aldri får endre. Den endrer aldri seg selv eller innsamleren.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Bruk en av dem i stedet for `oneuptime/podman-agent:release` på agentens linje `image:`.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Oppgrader**: hent de nyeste imagene i mappen med docker-compose.yml, og opprett containerne på nytt:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Avinstaller**: stopp og fjern alt filen har startet:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'Agenten må kjøre som root for å lese `/run/podman/podman.sock`. Sørg for at agentens tjeneste har `user: "0:0"` i docker-compose.yml, og at socketen er slått på:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "En server som håndhever et maksimum, avviser en nyere klient, innsamleren avslutter derfor, og containeren starter på nytt i en løkke. Agenten låser bare en Docker-API-versjon når `DOCKER_API_VERSION` angir en, og et eldre agent-image låste `1.44`. Ta `DOCKER_API_VERSION` ut av agentens liste `environment:`, og kjør deretter `podman compose pull` og `podman compose up -d`. Agenten forhandler da versjonen med socketen.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Legg den til i agentens liste `environment:`, f.eks. `- DOCKER_API_VERSION=1.41`, og kjør `podman compose up -d`. Nyere servere betjener fortsatt eldre API-versjoner, så en låst versjon fortsetter å fungere etter en oppgradering.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Sjekk at OneUptime-URL-en og inntaksnøkkelen i docker-compose.yml er riktige.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Vertens navn kommer fra `PODMAN_HOST_NAME`. En agent som er startet uten den, rapporterer `podman-host`, så alle verter som er satt opp slik, ser ut som den samme verten. Sett `PODMAN_HOST_NAME` til et eget navn på hver vert, og kjør `podman compose up -d` for å opprette agenten på nytt med den.",
};

export default TRANSLATION;
