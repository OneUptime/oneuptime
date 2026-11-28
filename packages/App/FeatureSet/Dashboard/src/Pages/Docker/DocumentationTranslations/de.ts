import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Docker setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Docker/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+": "Docker Engine 20.10 oder neuer",
  "Access to `/var/run/docker.sock` on the host":
    "Zugriff auf `/var/run/docker.sock` auf dem Host",
  "Containers whose logs you want must use the `json-file` log driver — Docker's default":
    "Container, deren Protokolle Sie erfassen möchten, müssen den Log-Treiber `json-file` verwenden — die Voreinstellung von Docker",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "Starten Sie dann daneben den KI-Agenten von OneUptime, mit derselben URL, demselben Schlüssel und demselben Hostnamen. **KI-Untersuchungen sind standardmäßig aktiviert**: Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Host untersucht, führt es über den KI-Agenten schreibgeschützte `docker`-Befehle aus und ändert nichts, solange Sie keine Korrekturen erlauben — siehe **Der KI-Agent von OneUptime** unter Erweitert. Lassen Sie diesen Befehl weg, um den Collector ohne KI-Untersuchungen auszuführen.",
  "Replace `my-docker-host` with a name for this host, such as `prod-docker-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "Ersetzen Sie `my-docker-host` durch einen Namen für diesen Host, etwa `prod-docker-01`. Unter diesem Namen erscheint der Host in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Host.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Look for this line in the logs:":
    "Suchen Sie in den Protokollen nach dieser Zeile:",
  "Once the agent connects, the host appears automatically in the **Docker** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "Sobald der Agent verbunden ist, erscheint der Host automatisch im Bereich **Docker** — meist innerhalb etwa einer Minute. Der KI-Agent von OneUptime wird auf der Seite **KI → KI-Agent** des Hosts und unten in seiner **Übersicht** als Verbunden angezeigt.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | Ja | Der Telemetrie-Ingestion-Schlüssel aus Schritt 1 |",
  "| `DOCKER_HOST_NAME` | No | Friendly name for this host. Defaults to `docker-host` |":
    "| `DOCKER_HOST_NAME` | Nein | Ein sprechender Name für diesen Host. Standard: `docker-host` |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the agent speaks. Empty by default: the agent negotiates it with the daemon, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | Nein | Die Version der Docker-Engine-API, die der Agent spricht. Standardmäßig leer: Der Agent handelt sie mit dem Daemon aus, sodass jede Docker Engine ab 20.10 funktioniert. Setzen Sie sie nur, um eine Version festzulegen (siehe Fehlerbehebung) |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` bis `ONEUPTIME_LOG_OPERATOR_5` | Nein | Eigene Collector-Operatoren, je einer als JSON, für ein Log-Format, das der Agent nicht liest |",
  "Pass each one to `docker run` as `-e NAME=value`. To change one later, remove the agent with `docker rm -f oneuptime-docker-agent` and run the command again with the new value.":
    "Übergeben Sie jede an `docker run` als `-e NAME=value`. Um eine später zu ändern, entfernen Sie den Agenten mit `docker rm -f oneuptime-docker-agent` und führen Sie den Befehl mit dem neuen Wert erneut aus.",
  "The agent tails `/var/lib/docker/containers/*/*-json.log`, so it only sees logs from containers that use Docker's **`json-file`** log driver. That is Docker's default, but some hosts switch to `local` (binary files the agent cannot parse) or to a remote driver (`journald`, `syslog`, `fluentd`, `gelf`, …), which leave no files to read.":
    "Der Agent liest `/var/lib/docker/containers/*/*-json.log` mit und sieht daher nur Protokolle von Containern, die Dockers Log-Treiber **`json-file`** verwenden. Das ist die Voreinstellung von Docker, aber manche Hosts wechseln zu `local` (Binärdateien, die der Agent nicht lesen kann) oder zu einem entfernten Treiber (`journald`, `syslog`, `fluentd`, `gelf`, …), der keine Dateien zum Lesen hinterlässt.",
  "Check a container's log driver, and the daemon's default:":
    "Prüfen Sie den Log-Treiber eines Containers und die Voreinstellung des Daemons:",
  "Switch a Compose service to `json-file`, with rotation:":
    "Stellen Sie einen Compose-Dienst auf `json-file` um, mit Rotation:",
  "Or change the daemon's default for every container created afterwards, in `/etc/docker/daemon.json`:":
    "Oder ändern Sie die Voreinstellung des Daemons für jeden danach erstellten Container, in `/etc/docker/daemon.json`:",
  "Then restart Docker and **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with.":
    "Starten Sie Docker dann neu und **erstellen Sie die betroffenen Container neu** (ein Neustart genügt nicht): Ein Container behält den Log-Treiber, mit dem er erstellt wurde.",
  "`oneuptime-docker-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `docker rm -f oneuptime-docker-ai-agent`.":
    "`oneuptime-docker-ai-agent`, der zweite Container, den Schritt 2 startet, führt die `docker`-Befehle aus, die OneUptime AI anfordert, während es einen Vorfall oder eine Warnung auf diesem Host untersucht. **KI-Untersuchungen sind standardmäßig aktiviert**: Sobald er verbunden ist, untersucht OneUptime AI damit, und die Seite **KI → KI-Agent** des Hosts sowie seine **Übersicht** zeigen seinen Status. Um Untersuchungen auszuschalten, verwenden Sie auf dieser Seite **Was die KI tun darf**; um den Collector ohne den KI-Agenten auszuführen, entfernen Sie ihn mit `docker rm -f oneuptime-docker-ai-agent`.",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **Standardmäßig schreibgeschützt.** Er führt Befehle wie `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` und `docker stats --no-stream` aus — niemals `exec`, `run`, `rm` oder `prune`. Umgebungswerte in der Ausgabe von `docker inspect` werden maskiert, bevor irgendetwas den Host verlässt.",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Korrekturen nur auf Wunsch.** Fügen Sie dem Befehl `-e ONEUPTIME_AI_ALLOW_WRITES=true` hinzu, damit er einen benannten Container neu starten, starten, stoppen, pausieren, beenden oder seine Limits ändern darf. `ONEUPTIME_AI_FIXES` daneben legt fest, ob jede Korrektur eine Genehmigung braucht (`ask-for-approval`, `automatic` oder `bypass-approval`), und die Seite **KI → KI-Agent** des Hosts zeigt es an. `ONEUPTIME_AI_WRITE_TARGETS` (kommagetrennte Globs wie `web-*,api-*`) beschränkt, welche Container; `ONEUPTIME_AI_PROTECTED_TARGETS` fügt Container hinzu, die er niemals ändern darf. Sich selbst und den Collector ändert er nie.",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- Er läuft als root, weil der Docker-Socket root gehört. Das `:ro`-Mount des Sockets macht die Docker-API nicht schreibgeschützt — die Grenze ist die Befehlsrichtlinie des Agenten.",
  "- Its logs: `docker logs -f oneuptime-docker-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- Seine Protokolle: `docker logs -f oneuptime-docker-ai-agent`. Was er ausführen darf und wie Korrekturen funktionieren: [KI-Agenten für die Infrastruktur](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).",
  "| Tag | Description |": "| Tag | Beschreibung |",
  "| `oneuptime/docker-agent:release` | Latest stable release (community) |":
    "| `oneuptime/docker-agent:release` | Neueste stabile Version (Community) |",
  "| `oneuptime/docker-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/docker-agent:enterprise-release` | Neueste stabile Version (Enterprise) |",
  "| `oneuptime/docker-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/docker-agent:<version>` | Eine festgelegte Version, z. B. `10.0.31` |",
  "| `ghcr.io/oneuptime/docker-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/docker-agent:release` | Dasselbe Image, gespiegelt auf GHCR |",
  "Use one in place of `oneuptime/docker-agent:release` at the end of the `docker run` command.":
    "Verwenden Sie eines davon anstelle von `oneuptime/docker-agent:release` am Ende des `docker run`-Befehls.",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**Upgrade** — ziehen Sie das neueste Image und entfernen Sie den laufenden Agenten:",
  "Then run both `docker run` commands from step 2 again.":
    "Führen Sie dann beide `docker run`-Befehle aus Schritt 2 erneut aus.",
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
  "| **Container Logs** | stdout/stderr logs from all containers |":
    "| **Container-Protokolle** | stdout/stderr-Protokolle aller Container |",
  'Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    'Jede Protokollzeile erhält einen Schweregrad aus der Stufe, die sie nennt (`[ERROR]`, `level=warn`, `{"level":"info"}`); eine Zeile ohne Stufe fällt auf ihren Stream zurück — stderr ist `ERROR`, stdout ist `INFO`.',
  "The agent must run as root to read `/var/run/docker.sock`. Make sure the `--user 0:0` flag is in your `docker run` command.":
    "Der Agent muss als root laufen, um `/var/run/docker.sock` zu lesen. Stellen Sie sicher, dass das Flag `--user 0:0` in Ihrem `docker run`-Befehl steht.",
  "The agent's logs show:": "Die Protokolle des Agenten zeigen:",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Remove the agent (`docker rm -f oneuptime-docker-agent`), pull the latest image (`docker pull oneuptime/docker-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the daemon.":
    "Der Daemon lehnt einen Client ab, der neuer ist als sein eigenes Maximum, der Collector beendet sich deshalb, und der Container startet in einer Schleife neu. Der Agent legt eine Version nur fest, wenn `DOCKER_API_VERSION` eine nennt, und ein älteres Agent-Image legte `1.44` fest, was Docker Engine 20.10 bis 24 ablehnen. Entfernen Sie den Agenten (`docker rm -f oneuptime-docker-agent`), ziehen Sie das neueste Image (`docker pull oneuptime/docker-agent:release`) und führen Sie den Befehl aus Schritt 2 erneut aus, ohne `-e DOCKER_API_VERSION`. Der Agent handelt die Version dann mit dem Daemon aus.",
  "To pin a version anyway, use no more than the daemon's maximum:":
    "Um trotzdem eine Version festzulegen, verwenden Sie höchstens das Maximum des Daemons:",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Fügen Sie sie dem Befehl hinzu, z. B. `-e DOCKER_API_VERSION=1.41`. Neuere Daemons bedienen weiterhin ältere API-Versionen, sodass eine festgelegte Version auch nach einem Docker-Upgrade funktioniert.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-docker-agent`":
    "1. Prüfen Sie, ob der Agent läuft: `docker ps --filter name=oneuptime-docker-agent`",
  "2. Check the agent's logs for errors: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`":
    "2. Prüfen Sie die Protokolle des Agenten auf Fehler: `docker logs oneuptime-docker-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `docker run` command are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel im `docker run`-Befehl stimmen.",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Host Ihre OneUptime-Instanz über das Netzwerk erreicht.",
  "Check that the Docker socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "Prüfen Sie, ob der Docker-Socket in den Agenten eingebunden ist. Sein Image hat keine Shell, sehen Sie also von einem Wegwerf-Container aus nach, der seine Mounts teilt:",
  "Then look for export errors in the agent's logs — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "Suchen Sie dann in den Protokollen des Agenten nach Exportfehlern — `docker logs oneuptime-docker-agent 2>&1 | grep -i error` — und stellen Sie sicher, dass der Ingestion-Schlüssel gültig und nicht abgelaufen ist.",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using the `json-file` log driver.":
    "Metriken kommen an, aber der Tab **Protokolle** ist leer oder zeigt nur die eigenen Protokolle des Agenten? Ihre Container verwenden höchstwahrscheinlich nicht den Log-Treiber `json-file`.",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `json-file`. Switch them (see **Collect logs from every container (json-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "Wenn Schritt 1 `no files match the configured criteria` zeigt oder Schritt 3 keine Dateien für Ihre Container auflistet, verwenden sie nicht `json-file`. Stellen Sie sie um (siehe **Protokolle aller Container erfassen (Log-Treiber json-file)** unter Erweitert) und erstellen Sie dann jeden neu — ein Container behält den Log-Treiber, mit dem er erstellt wurde:",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `DOCKER_HOST_NAME`. Change `DOCKER_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "Die Seite eines Hosts zeigt die Daten, deren Hostname die Kennung dieses Hosts ist, die der Agent aus `DOCKER_HOST_NAME` übernimmt. Ändern Sie `DOCKER_HOST_NAME`, nachdem der Host registriert wurde, registriert OneUptime einen zweiten Host unter dem neuen Namen — die Protokolle liegen bei diesem. Prüfen Sie den Namen, den der Agent meldet:",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and recreate the agent — `docker rm -f oneuptime-docker-agent`, then run the command from step 2 with the new name.":
    "Der Name des Hosts kommt aus `DOCKER_HOST_NAME`. Ein Agent, der ohne ihn gestartet wurde, meldet `docker-host`, sodass jeder so eingerichtete Host wie derselbe Host aussieht. Setzen Sie `DOCKER_HOST_NAME` auf jedem Host auf einen eigenen Namen und erstellen Sie den Agenten neu — `docker rm -f oneuptime-docker-agent`, dann führen Sie den Befehl aus Schritt 2 mit dem neuen Namen aus.",
  "This installs the agent for **`web-1`** — keep `DOCKER_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "Dies installiert den Agenten für **`web-1`** — lassen Sie `DOCKER_HOST_NAME` genau so, wie es ist, sonst werden die Daten als neuer Host registriert.",
  "Docker Compose v2 (the `docker compose` command)":
    "Docker Compose v2 (der Befehl `docker compose`)",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-docker-ai-agent` service to run the collector without AI investigations.":
    "Der zweite Dienst ist der KI-Agent von OneUptime, mit derselben URL, demselben Schlüssel und demselben Hostnamen. **KI-Untersuchungen sind standardmäßig aktiviert**: Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Host untersucht, führt es über den KI-Agenten schreibgeschützte `docker`-Befehle aus und ändert nichts, solange Sie keine Korrekturen erlauben — siehe **Der KI-Agent von OneUptime** unter Erweitert. Löschen Sie den Dienst `oneuptime-docker-ai-agent`, um den Collector ohne KI-Untersuchungen auszuführen.",
  "Set each one in the agent's `environment:` list, then run `docker compose up -d` to recreate it with the new values.":
    "Setzen Sie jede in der Liste `environment:` des Agenten und führen Sie dann `docker compose up -d` aus, um ihn mit den neuen Werten neu zu erstellen.",
  "`oneuptime-docker-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `docker compose up -d --remove-orphans`.":
    "`oneuptime-docker-ai-agent`, der zweite Dienst in docker-compose.yml, führt die `docker`-Befehle aus, die OneUptime AI anfordert, während es einen Vorfall oder eine Warnung auf diesem Host untersucht. **KI-Untersuchungen sind standardmäßig aktiviert**: Sobald er verbunden ist, untersucht OneUptime AI damit, und die Seite **KI → KI-Agent** des Hosts sowie seine **Übersicht** zeigen seinen Status. Um Untersuchungen auszuschalten, verwenden Sie auf dieser Seite **Was die KI tun darf**; um den Collector ohne den KI-Agenten auszuführen, löschen Sie seinen Dienst und führen Sie `docker compose up -d --remove-orphans` aus.",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **Korrekturen nur auf Wunsch.** Fügen Sie seiner Liste `environment:` den Eintrag `- ONEUPTIME_AI_ALLOW_WRITES=true` hinzu, damit er einen benannten Container neu starten, starten, stoppen, pausieren, beenden oder seine Limits ändern darf. `ONEUPTIME_AI_FIXES` daneben legt fest, ob jede Korrektur eine Genehmigung braucht (`ask-for-approval`, `automatic` oder `bypass-approval`), und die Seite **KI → KI-Agent** des Hosts zeigt es an. `ONEUPTIME_AI_WRITE_TARGETS` (kommagetrennte Globs wie `web-*,api-*`) beschränkt, welche Container; `ONEUPTIME_AI_PROTECTED_TARGETS` fügt Container hinzu, die er niemals ändern darf. Sich selbst und den Collector ändert er nie.",
  "Use one in place of `oneuptime/docker-agent:release` on the agent's `image:` line.":
    "Verwenden Sie eines davon anstelle von `oneuptime/docker-agent:release` in der Zeile `image:` des Agenten.",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**Upgrade** — ziehen Sie im Ordner mit der docker-compose.yml die neuesten Images und erstellen Sie die Container neu:",
  "**Uninstall** — stop and remove everything the file started:":
    "**Deinstallieren** — stoppen und entfernen Sie alles, was die Datei gestartet hat:",
  'The agent must run as root to read `/var/run/docker.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml.':
    'Der Agent muss als root laufen, um `/var/run/docker.sock` zu lesen. Stellen Sie sicher, dass der Dienst des Agenten in docker-compose.yml `user: "0:0"` hat.',
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The agent pins a version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `docker compose pull` and `docker compose up -d`. The agent then negotiates the version with the daemon.":
    "Der Daemon lehnt einen Client ab, der neuer ist als sein eigenes Maximum, der Collector beendet sich deshalb, und der Container startet in einer Schleife neu. Der Agent legt eine Version nur fest, wenn `DOCKER_API_VERSION` eine nennt, und ein älteres Agent-Image legte `1.44` fest, was Docker Engine 20.10 bis 24 ablehnen. Nehmen Sie `DOCKER_API_VERSION` aus der Liste `environment:` des Agenten heraus und führen Sie dann `docker compose pull` und `docker compose up -d` aus. Der Agent handelt die Version dann mit dem Daemon aus.",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `docker compose up -d`. Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "Fügen Sie sie der Liste `environment:` des Agenten hinzu, z. B. `- DOCKER_API_VERSION=1.41`, und führen Sie `docker compose up -d` aus. Neuere Daemons bedienen weiterhin ältere API-Versionen, sodass eine festgelegte Version auch nach einem Docker-Upgrade funktioniert.",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel in docker-compose.yml stimmen.",
  "The host's name comes from `DOCKER_HOST_NAME`. An agent started without it reports `docker-host`, so every host set up that way looks like the same host. Set `DOCKER_HOST_NAME` to a name of its own on each host and run `docker compose up -d` to recreate the agent with it.":
    "Der Name des Hosts kommt aus `DOCKER_HOST_NAME`. Ein Agent, der ohne ihn gestartet wurde, meldet `docker-host`, sodass jeder so eingerichtete Host wie derselbe Host aussieht. Setzen Sie `DOCKER_HOST_NAME` auf jedem Host auf einen eigenen Namen und führen Sie `docker compose up -d` aus, um den Agenten damit neu zu erstellen.",
};

export default TRANSLATION;
