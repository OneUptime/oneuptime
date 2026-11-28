import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 oder neuer",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Der Docker-kompatible API-Socket von Podman unter `/run/podman/podman.sock` — aktivieren Sie ihn mit `sudo systemctl enable --now podman.socket`",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "Container, deren Protokolle Sie erfassen möchten, müssen den Log-Treiber `k8s-file` verwenden — rootful Podman verwendet standardmäßig `journald`, das der Agent nicht lesen kann",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Starten Sie dann daneben den KI-Agenten von OneUptime, mit derselben URL, demselben Schlüssel und demselben Hostnamen. **KI-Untersuchungen sind standardmäßig aktiviert**: Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Host untersucht, führt es über den KI-Agenten schreibgeschützte `docker`-Befehle gegen den Docker-kompatiblen Socket von Podman aus und ändert nichts, solange Sie keine Korrekturen erlauben — siehe **Der KI-Agent von OneUptime** unter Erweitert. Lassen Sie diesen Befehl weg, um den Collector ohne KI-Untersuchungen auszuführen.",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Ersetzen Sie `my-podman-host` durch einen Namen für diesen Host, etwa `prod-podman-01`. Unter diesem Namen erscheint der Host in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Host.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Look for this line in the logs:":
    "Suchen Sie in den Protokollen nach dieser Zeile:",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Sobald der Agent verbunden ist, erscheint der Host automatisch im Bereich **Podman** — meist innerhalb etwa einer Minute. Der KI-Agent von OneUptime wird auf der Seite **KI → KI-Agent** des Hosts und unten in seiner **Übersicht** als Verbunden angezeigt.",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**Metriken, aber keine Protokolle?** Rootful Podman schreibt Container-Protokolle standardmäßig nach `journald`, das der Agent nicht lesen kann. Führen Sie Ihre Container mit `--log-driver k8s-file` aus — siehe **Protokolle aller Container erfassen (Log-Treiber k8s-file)** unter Erweitert.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Der Telemetrie-Ingestion-Schlüssel aus Schritt 1 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | Nein | Ein sprechender Name für diesen Host. Standard: `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nein | Die Version der Docker-API, die der Agent mit dem Podman-Socket spricht. Standardmäßig leer: Der Agent handelt sie mit dem Socket aus. Setzen Sie sie nur, um eine Version festzulegen (siehe Fehlerbehebung) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` bis `ONEUPTIME_LOG_OPERATOR_5` | Nein | Eigene Collector-Operatoren, je einer als JSON, für ein Log-Format, das der Agent nicht liest |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "Übergeben Sie jede an `podman run` als `-e NAME=value`. Um eine später zu ändern, entfernen Sie den Agenten mit `podman rm -f oneuptime-podman-agent` und führen Sie den Befehl mit dem neuen Wert erneut aus.",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "Der Agent liest die Dateien, die Podmans Log-Treiber **`k8s-file`** schreibt — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` —, und sieht daher nur Protokolle von Containern, die ihn verwenden (oder `json-file`, das Podman als denselben dateibasierten Treiber behandelt). Die Voreinstellung von rootful Podman ist **`journald`**, das er nicht lesen kann, ebenso wenig wie einen entfernten Treiber wie `syslog`.",
  "Check a container's log driver, and Podman's default:":
    "Prüfen Sie den Log-Treiber eines Containers und die Voreinstellung von Podman:",
  "Run a single container with `k8s-file`:":
    "Führen Sie einen einzelnen Container mit `k8s-file` aus:",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "Stellen Sie einen Compose-Dienst auf `k8s-file` um, mit Rotation:",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "Oder ändern Sie die Voreinstellung für jeden danach erstellten Container, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "**Erstellen Sie dann die betroffenen Container neu** (ein Neustart genügt nicht): Ein Container behält den Log-Treiber, mit dem er erstellt wurde. Müssen Sie bei `journald` bleiben? Der Agent erfasst Metriken weiterhin über den Socket; nur Container-Protokolle brauchen den dateibasierten Treiber.",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent`, der zweite Container, den Schritt 2 startet, führt die `docker`-Befehle aus, die OneUptime AI anfordert — über den Docker-kompatiblen Socket von Podman —, während es einen Vorfall oder eine Warnung auf diesem Host untersucht. **KI-Untersuchungen sind standardmäßig aktiviert**: Sobald er verbunden ist, untersucht OneUptime AI damit, und die Seite **KI → KI-Agent** des Hosts sowie seine **Übersicht** zeigen seinen Status. Um Untersuchungen auszuschalten, verwenden Sie auf dieser Seite **Was die KI tun darf**; um den Collector ohne den KI-Agenten auszuführen, entfernen Sie ihn mit `podman rm -f oneuptime-podman-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Standardmäßig schreibgeschützt.** Er führt Befehle wie `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` und `docker stats --no-stream` aus — niemals `exec`, `run`, `rm` oder `prune`. Umgebungswerte in der Ausgabe von `docker inspect` werden maskiert, bevor irgendetwas den Host verlässt.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Korrekturen nur auf Wunsch.** Fügen Sie dem Befehl `-e ONEUPTIME_AI_ALLOW_WRITES=true` hinzu, damit er einen benannten Container neu starten, starten, stoppen, pausieren, beenden oder seine Limits ändern darf. `ONEUPTIME_AI_FIXES` daneben legt fest, ob jede Korrektur eine Genehmigung braucht (`ask-for-approval`, `automatic` oder `bypass-approval`), und die Seite **KI → KI-Agent** des Hosts zeigt es an. `ONEUPTIME_AI_WRITE_TARGETS` (kommagetrennte Globs wie `web-*,api-*`) beschränkt, welche Container; `ONEUPTIME_AI_PROTECTED_TARGETS` fügt Container hinzu, die er niemals ändern darf. Sich selbst und den Collector ändert er nie.",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- Er braucht denselben Socket wie der Collector und läuft als root, weil der Socket root gehört. Das `:ro`-Mount des Sockets macht die API nicht schreibgeschützt — die Grenze ist die Befehlsrichtlinie des Agenten.",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Seine Protokolle: `podman logs -f oneuptime-podman-ai-agent`. Was er ausführen darf und wie Korrekturen funktionieren: [KI-Agenten für die Infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beschreibung |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | Neueste stabile Version (Community) |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | Neueste stabile Version (Enterprise) |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | Eine festgelegte Version, z. B. `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | Dasselbe Image, gespiegelt auf GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "Verwenden Sie eines davon anstelle von `oneuptime/podman-agent:release` am Ende des `podman run`-Befehls.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Upgrade** — ziehen Sie das neueste Image und entfernen Sie den laufenden Agenten:",
  "Then run both `podman run` commands from step 2 again.":
    "Führen Sie dann beide `podman run`-Befehle aus Schritt 2 erneut aus.",
  "**Uninstall:**": "**Deinstallieren:**",
  "| Category | Data |": "| Kategorie | Daten |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU-Metriken** | Gesamtnutzung, Nutzung in Prozent, Drosselungszeit (pro Container) |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **Speicher-Metriken** | Nutzung, Limit, Prozent, RSS, Cache (pro Container) |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **Netzwerk-Metriken** | Empfangene/gesendete Bytes und Pakete (pro Container) |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **Block-I/O-Metriken** | Gelesene/geschriebene Bytes und Vorgänge (pro Container) |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **Container-Info** | Laufzeit, Anzahl der Neustarts, Anzahl der Prozesse |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **Container-Protokolle** | stdout/stderr-Protokolle aller Container, die den Log-Treiber `k8s-file` verwenden |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Die Metriken stammen vom Receiver `docker_stats` des Collectors, über den Docker-kompatiblen Socket von Podman, daher heißen sie wie die des Docker-Agenten. Jede Protokollzeile erhält einen Schweregrad aus der Stufe, die sie nennt (`[ERROR]`, `level=warn`, `{"level":"info"}`); eine Zeile ohne Stufe fällt auf ihren Stream zurück — stderr ist `ERROR`, stdout ist `INFO`.',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "Der Agent muss als root laufen, um `/run/podman/podman.sock` zu lesen. Stellen Sie sicher, dass das Flag `--user 0:0` in Ihrem `podman run`-Befehl steht und dass der Socket aktiviert ist:",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "Das ist der Socket von rootful Podman, den der Agent liest. Betreiben Sie Podman rootless? Dann ist sein Socket `/run/user/<uid>/podman/podman.sock` (aktivieren Sie ihn mit `systemctl --user enable --now podman.socket`) und sein Speicher `~/.local/share/containers/storage`: Binden Sie diese stattdessen unter `/run/podman/podman.sock` und `/var/lib/containers/storage` in den Container des Agenten ein — siehe die Dokumentation des Podman-Agenten.",
  "The agent's logs show:": "Die Protokolle des Agenten zeigen:",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "Ein Server, der ein Maximum durchsetzt, lehnt einen neueren Client ab, der Collector beendet sich deshalb, und der Container startet in einer Schleife neu. Der Agent legt eine Docker-API-Version nur fest, wenn `DOCKER_API_VERSION` eine nennt, und ein älteres Agent-Image legte `1.44` fest. Entfernen Sie den Agenten (`podman rm -f oneuptime-podman-agent`), ziehen Sie das neueste Image (`podman pull oneuptime/podman-agent:release`) und führen Sie den Befehl aus Schritt 2 erneut aus, ohne `-e DOCKER_API_VERSION`. Der Agent handelt die Version dann mit dem Socket aus.",
  "To pin a version anyway, use no more than the version the socket reports:":
    "Um trotzdem eine Version festzulegen, verwenden Sie höchstens die Version, die der Socket meldet:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Fügen Sie sie dem Befehl hinzu, z. B. `-e DOCKER_API_VERSION=1.41`. Neuere Server bedienen weiterhin ältere API-Versionen, sodass eine festgelegte Version auch nach einem Upgrade funktioniert.",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. Prüfen Sie, ob der Agent läuft: `podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. Prüfen Sie die Protokolle des Agenten auf Fehler: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel im `podman run`-Befehl stimmen.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Host Ihre OneUptime-Instanz über das Netzwerk erreicht.",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Prüfen Sie, ob der Podman-Socket in den Agenten eingebunden ist. Sein Image hat keine Shell, sehen Sie also von einem Wegwerf-Container aus nach, der seine Mounts teilt:",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Suchen Sie dann in den Protokollen des Agenten nach Exportfehlern — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — und stellen Sie sicher, dass der Ingestion-Schlüssel gültig und nicht abgelaufen ist.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "Metriken kommen an, aber der Tab **Protokolle** ist leer oder zeigt nur die eigenen Protokolle des Agenten? Ihre Container verwenden höchstwahrscheinlich keinen dateibasierten Log-Treiber (`k8s-file` oder `json-file`) — rootful Podman verwendet standardmäßig `journald`, das der Agent nicht lesen kann.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Wenn Schritt 1 `no files match the configured criteria` zeigt oder Schritt 3 keine Dateien für Ihre Container auflistet, verwenden sie nicht `k8s-file`. Stellen Sie sie um (siehe **Protokolle aller Container erfassen (Log-Treiber k8s-file)** unter Erweitert) und erstellen Sie dann jeden neu — ein Container behält den Log-Treiber, mit dem er erstellt wurde:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "Die Seite eines Hosts zeigt die Daten, deren Hostname die Kennung dieses Hosts ist, die der Agent aus `PODMAN_HOST_NAME` übernimmt. Ändern Sie `PODMAN_HOST_NAME`, nachdem der Host registriert wurde, registriert OneUptime einen zweiten Host unter dem neuen Namen — die Protokolle liegen bei diesem. Prüfen Sie den Namen, den der Agent meldet:",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "Der Name des Hosts kommt aus `PODMAN_HOST_NAME`. Ein Agent, der ohne ihn gestartet wurde, meldet `podman-host`, sodass jeder so eingerichtete Host wie derselbe Host aussieht. Setzen Sie `PODMAN_HOST_NAME` auf jedem Host auf einen eigenen Namen und erstellen Sie den Agenten neu — `podman rm -f oneuptime-podman-agent`, dann führen Sie den Befehl aus Schritt 2 mit dem neuen Namen aus.",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dies installiert den Agenten für **`web-1`** — lassen Sie `PODMAN_HOST_NAME` genau so, wie es ist, sonst werden die Daten als neuer Host registriert.",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "Ein Compose-Provider für `podman compose`: `podman-compose` oder Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "Der zweite Dienst ist der KI-Agent von OneUptime, mit derselben URL, demselben Schlüssel und demselben Hostnamen. **KI-Untersuchungen sind standardmäßig aktiviert**: Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Host untersucht, führt es über den KI-Agenten schreibgeschützte `docker`-Befehle gegen den Docker-kompatiblen Socket von Podman aus und ändert nichts, solange Sie keine Korrekturen erlauben — siehe **Der KI-Agent von OneUptime** unter Erweitert. Löschen Sie den Dienst `oneuptime-podman-ai-agent`, um den Collector ohne KI-Untersuchungen auszuführen.",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "Setzen Sie jede in der Liste `environment:` des Agenten und führen Sie dann `podman compose up -d` aus, um ihn mit den neuen Werten neu zu erstellen.",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent`, der zweite Dienst in docker-compose.yml, führt die `docker`-Befehle aus, die OneUptime AI anfordert — über den Docker-kompatiblen Socket von Podman —, während es einen Vorfall oder eine Warnung auf diesem Host untersucht. **KI-Untersuchungen sind standardmäßig aktiviert**: Sobald er verbunden ist, untersucht OneUptime AI damit, und die Seite **KI → KI-Agent** des Hosts sowie seine **Übersicht** zeigen seinen Status. Um Untersuchungen auszuschalten, verwenden Sie auf dieser Seite **Was die KI tun darf**; um den Collector ohne den KI-Agenten auszuführen, löschen Sie seinen Dienst und führen Sie `podman compose up -d --remove-orphans` aus.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Korrekturen nur auf Wunsch.** Fügen Sie seiner Liste `environment:` den Eintrag `- ONEUPTIME_AI_ALLOW_WRITES=true` hinzu, damit er einen benannten Container neu starten, starten, stoppen, pausieren, beenden oder seine Limits ändern darf. `ONEUPTIME_AI_FIXES` daneben legt fest, ob jede Korrektur eine Genehmigung braucht (`ask-for-approval`, `automatic` oder `bypass-approval`), und die Seite **KI → KI-Agent** des Hosts zeigt es an. `ONEUPTIME_AI_WRITE_TARGETS` (kommagetrennte Globs wie `web-*,api-*`) beschränkt, welche Container; `ONEUPTIME_AI_PROTECTED_TARGETS` fügt Container hinzu, die er niemals ändern darf. Sich selbst und den Collector ändert er nie.",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "Verwenden Sie eines davon anstelle von `oneuptime/podman-agent:release` in der Zeile `image:` des Agenten.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Upgrade** — ziehen Sie im Ordner mit der docker-compose.yml die neuesten Images und erstellen Sie die Container neu:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Deinstallieren** — stoppen und entfernen Sie alles, was die Datei gestartet hat:",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    'Der Agent muss als root laufen, um `/run/podman/podman.sock` zu lesen. Stellen Sie sicher, dass der Dienst des Agenten in docker-compose.yml `user: "0:0"` hat und dass der Socket aktiviert ist:',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "Ein Server, der ein Maximum durchsetzt, lehnt einen neueren Client ab, der Collector beendet sich deshalb, und der Container startet in einer Schleife neu. Der Agent legt eine Docker-API-Version nur fest, wenn `DOCKER_API_VERSION` eine nennt, und ein älteres Agent-Image legte `1.44` fest. Nehmen Sie `DOCKER_API_VERSION` aus der Liste `environment:` des Agenten heraus und führen Sie dann `podman compose pull` und `podman compose up -d` aus. Der Agent handelt die Version dann mit dem Socket aus.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "Fügen Sie sie der Liste `environment:` des Agenten hinzu, z. B. `- DOCKER_API_VERSION=1.41`, und führen Sie `podman compose up -d` aus. Neuere Server bedienen weiterhin ältere API-Versionen, sodass eine festgelegte Version auch nach einem Upgrade funktioniert.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel in docker-compose.yml stimmen.",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "Der Name des Hosts kommt aus `PODMAN_HOST_NAME`. Ein Agent, der ohne ihn gestartet wurde, meldet `podman-host`, sodass jeder so eingerichtete Host wie derselbe Host aussieht. Setzen Sie `PODMAN_HOST_NAME` auf jedem Host auf einen eigenen Namen und führen Sie `podman compose up -d` aus, um den Agenten damit neu zu erstellen.",
};

export default TRANSLATION;
