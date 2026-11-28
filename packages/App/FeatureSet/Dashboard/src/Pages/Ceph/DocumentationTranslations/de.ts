import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der Ihre Ceph-mgr-Daemons auf Port 9283 erreicht",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Eine Shell auf einem Ceph-Admin-Knoten, auf dem die `ceph`-CLI mit Admin-Rechten funktioniert",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "Listen Sie dann Ihre mgr-Daemons auf — der Agent braucht **alle**, den aktiven und die Standbys:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "Nur der **aktive** mgr liefert Metriken — Standbys antworten mit einer leeren Antwort —, daher hält das Abfragen jedes mgr die Metriken am Laufen, wenn der aktive ausfällt und übergibt.",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "Das Skript fragt nach Ihrer OneUptime-URL und Ihrem Ingestion-Schlüssel, beide in Schritt 1 angezeigt (wählen Sie dort einen Schlüssel, damit sie hier ausgefüllt werden), und danach nach:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **Clustername** — wie der Cluster in OneUptime erscheint. Geben Sie jedem Cluster einen eigenen und halten Sie ihn stabil: Ein neuer Name registriert einen neuen Cluster.",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr-Endpunkte** — jeder mgr aus dem vorigen Schritt als kommagetrenntes `host:port`, z. B. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. Das Skript fügt die eckigen Klammern hinzu.",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime-KI-Agent** — ob er Korrekturen anwenden darf; antworten Sie **N**, damit er schreibgeschützt bleibt. Wo `ceph` mit Admin-Rechten funktioniert, bietet das Skript außerdem an, den eigenen Ceph-Client des KI-Agenten anzulegen.",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "Es installiert nach `/opt/oneuptime-ceph-agent`, schreibt eine `.env`-Datei mit `0600` und startet den Agenten mit Docker Compose. Ein erneuter Aufruf des Skripts übernimmt alles aus dieser `.env`, statt erneut zu fragen; so führen Sie auch ein Upgrade durch.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "Suchen Sie in den Protokollen nach `Everything is ready. Begin running and processing data.`. Der Cluster erscheint dann automatisch im Bereich **Ceph**, meist innerhalb etwa einer Minute.",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose führt außerdem **`oneuptime-ceph-ai-agent`** aus, den KI-Agenten von OneUptime. Hat das Installationsskript seinen Ceph-Client angelegt, arbeitet er bereits; andernfalls wartet er auf einen — siehe **OneUptime-KI-Agent** unter Erweitert.",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**KI-Agent von OneUptime (standardmäßig aktiv, schreibgeschützt).** KI-Untersuchungen sind aktiviert: Sobald er seinen Ceph-Client hat, untersucht OneUptime AI mit ihm Vorfälle und Warnungen auf diesem Cluster mit schreibgeschützten `ceph`-Befehlen und ändert nichts, solange Sie keine Korrekturen erlauben.",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "Das Installationsskript schreibt diese in `/opt/oneuptime-ceph-agent/.env`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-ceph-agent`.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetrie-Ingestion-Schlüssel — der in Schritt 1 gewählte |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | Ja | Die Kennung des Clusters in OneUptime. An jeder Metrik als Ressourcenattribut `ceph.cluster.name` vermerkt. Halten Sie sie stabil — eine Änderung registriert einen neuen Cluster (Standard: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommagetrennte `host:port`-Liste **aller** mgr-Daemons in eckigen Klammern, z. B. `[ceph-mon-1:9283,ceph-mon-2:9283]`. Das Installationsskript fügt die Klammern für Sie hinzu |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "Die eigenen Einstellungen des KI-Agenten von OneUptime stehen unter **OneUptime-KI-Agent**.",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **Alle mgrs werden abgefragt** (der aktive und die Standbys), daher überstehen Metriken einen Failover des aktiven mgr.",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **Alle 30 Sekunden.** Das prometheus-Modul des mgr speichert eine Abfrage für `mgr/prometheus/scrape_interval` zwischen (standardmäßig 15 Sekunden) — fragen Sie nie häufiger ab, Sie würden nur den Cache erneut lesen.",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** behält die Labels, die Ceph exportiert (`ceph_daemon`, `pool_id`), unverändert bei, sodass die Zeitreihen über mgr-Failover hinweg durchgehend bleiben.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dies ist die vollständige `otel-collector-config.yaml`, die der Agent ausführt; die `.env`-Datei liefert die Werte `${env:...}`:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "Der Agent kann `/var/log/ceph/ceph.log` mitlesen und an OneUptime senden, was die Seite **Cluster-Protokoll** füllt. Standardmäßig ist das aus, weil der Agent auf einem Host laufen muss, der das Cluster-Protokoll hat — standardmäßig ein mon-Host.",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. Kommentieren Sie in `otel-collector-config.yaml` den Receiver `filelog` und die Pipeline `logs` ein.",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. Kommentieren Sie in `docker-compose.yml` das Volume `/var/log/ceph:/var/log/ceph:ro` ein.",
  "3. Apply both:": "3. Übernehmen Sie beides:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "Zeilen werden unverändert gesendet; OneUptime liest beim Einlesen das ceph.log-Format (Zeitstempel, Daemon, Stufe INF/WRN/ERR, Nachricht), und der Prozessor `resource` vermerkt `ceph.cluster.name`, sodass das Protokoll bei diesem Cluster landet.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einem Projekt-Label am Cluster: `oneuptime.label.<dimension>=<value>` ist das Label `<dimension>:<value>`. Fügen Sie sie dem Prozessor `resource` in `otel-collector-config.yaml` hinzu, neben `ceph.cluster.name`:",
  "Then restart the collector so it reads the new config:":
    "Starten Sie dann den Collector neu, damit er die neue Konfiguration liest:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Der Cluster erscheint mit den Labels `team:storage` und `env:production`. Labels werden ohne Beachtung der Groß- und Kleinschreibung abgeglichen, sodass ein vorhandenes Label `Production` wiederverwendet wird; in der OneUptime-Oberfläche hinzugefügte Labels entfernt der Agent nie.",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "Der Agent sendet alles, was das prometheus-Modul des mgr exportiert. Die Ceph-Seiten, der Metrikkatalog und die Warnungsvorlagen von OneUptime bauen auf Folgendem auf:",
  "| Category | Data |": "| Kategorie | Daten |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **Cluster-Zustand** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), Monitor-Quorum, gesamte und belegte Rohkapazität |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | Up-/In-Zustand jedes OSD (pro Label `ceph_daemon`, z. B. `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **Pool** | Gespeicherte Bytes, maximal verfügbar, Objektanzahl, Lese-/Schreibvorgänge und Durchsatz pro Pool |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Groups** | Anzahl aktiver, beeinträchtigter und unterbesetzter PGs |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` führt außerdem **`oneuptime-ceph-ai-agent`** aus. Während OneUptime AI einen Vorfall oder eine Warnung auf diesem Cluster untersucht, führt es darüber `ceph`-Befehle aus — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. Er meldet sich als der Cluster namens `CEPH_CLUSTER_NAME` an und erscheint auf der Seite **KI → KI-Agent** des Clusters.",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "Er verbindet sich als eigener Ceph-Client, `client.oneuptime-ai`, mit der minimalen `ceph.conf` des Clusters und dem Keyring dieses Clients in einem Ordner `ceph/` neben `docker-compose.yml`. Das Installationsskript bietet bei einer Neuinstallation an, beides anzulegen, wenn `ceph` auf dem Rechner, auf dem Sie es ausführen, mit Admin-Rechten funktioniert. Andernfalls, oder um sie später hinzuzufügen, auf einem Ceph-Admin-Knoten:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "Läuft der Agent auf einem anderen Rechner, kopieren Sie die beiden Dateien auf dieselbe Weise in dessen Ordner `ceph/`. **Legen Sie dort niemals den Admin-Keyring ab.**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **Die Caps des Clients sind die harte Grenze.** Mit diesen Lese-Caps kann nichts, was er ausführt, den Cluster ändern. Korrekturen — ein OSD wieder auf „in“ setzen, `noout` aufheben — brauchen außerdem `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` und die Korrektur-Caps aus der README des Agenten.",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- Prüfen Sie ihn: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- Sie nutzen OneUptime AI nicht? Löschen Sie den Dienst `oneuptime-ceph-ai-agent` aus `docker-compose.yml`.",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "Was er ausführen darf und wie Korrekturen funktionieren: [KI-Agenten für die Infrastruktur](/docs/ai/infrastructure-ai-agents#ceph-clusters).",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Führen Sie das Installationsskript erneut aus. Es übernimmt jeden Wert aus Ihrer vorhandenen `.env` (es wird nichts erneut gefragt), lädt die neueste `docker-compose.yml` und `otel-collector-config.yaml` herunter — eine von Ihnen bearbeitete Datei bleibt als `<file>.bak.<timestamp>` neben der neuen erhalten —, zieht die Images und erstellt den Agenten damit neu. Der Ordner `ceph/` des KI-Agenten bleibt, wie er ist:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Die Konfiguration meldet die Collector-Version, die sie festlegt, als **Agent-Version** des Clusters. Legt dieses OneUptime eine neuere fest, öffnet ein Warnzeichen daneben diese Befehle.",
  "**Uninstall** the agent:": "**Deinstallieren** Sie den Agenten:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "Wenn Sie den Ceph-Client des KI-Agenten angelegt haben, entfernen Sie ihn auf einem Admin-Knoten: `ceph auth del client.oneuptime-ai`.",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` prüft die ganze Kette — Container-Laufzeit, jeden mgr-Endpunkt (einschließlich der Falle aktiv gegen Standby), das Vermerken des Clusternamens, die Form des Tokens, die Selbstmetriken des Collectors — und fragt OneUptime direkt, ob es Ihren Ingestion-Schlüssel akzeptiert. Diese letzte Prüfung ist die wichtigste: Die OTLP-Endpunkte von OneUptime lehnen einen falschen Schlüssel mit `401` oder `422` ab, was der Collector pro Batch als eine einzige, leicht zu übersehende Zeile `Exporting failed` protokolliert; daher fragt das Skript `GET /otlp/v1/validate` nach einem direkten Urteil 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Es endet mit einem Urteil, das die wahrscheinlichste Ursache nennt.",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. Prüfen Sie die Protokolle des Collectors: `docker logs oneuptime-ceph-agent` — suchen Sie nach Exportfehlern (`401` heißt falscher Ingestion-Schlüssel, Connection refused heißt falsche `ONEUPTIME_URL`).",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. Prüfen Sie, ob ein mgr-Endpunkt Metriken liefert: `curl http://<active-mgr>:9283/metrics | head` — Sie sollten Zeilen mit `ceph_*`-Metriken sehen. Wenn nicht, aktivieren Sie das Modul: `ceph mgr module enable prometheus`.",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. Stellen Sie sicher, dass `CEPH_MGR_ENDPOINTS` in eckigen Klammern steht — ohne sie behandelt der Collector die ganze kommagetrennte Zeichenkette als ein einziges (ungültiges) Ziel.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. Prüfen Sie, ob der Agent läuft: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. Prüfen Sie die Protokolle des Agenten auf Fehler: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Prüfen Sie, ob Ihre OneUptime-URL und Ihr Ingestion-Schlüssel stimmen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Rechner des Agenten die OneUptime-Instanz über das Netzwerk erreicht.",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "Wahrscheinlich fragen Sie nur den (zuvor) aktiven mgr ab. Nennen Sie **jeden** mgr-Daemon in `CEPH_MGR_ENDPOINTS` — Abfragen von Standby-mgrs sind günstig und liefern leere Antworten.",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "Zu erwarten, wenn `mgr/prometheus/standby_behaviour` auf Ihrem Cluster auf `error` steht — Standbys antworten dann mit HTTP 500. Die Abfrage des aktiven mgr gelingt trotzdem, die Fehler sind also Rauschen; stellen Sie das Verhalten wieder auf `default`, um sie abzustellen.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `CEPH_CLUSTER_NAME`, an jeder Metrik als `ceph.cluster.name` vermerkt. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-ceph-agent` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **Clustername** — geben Sie genau **`ceph-1`** ein; ein anderer Name registriert einen neuen Cluster.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `CEPH_CLUSTER_NAME`, an jeder Metrik als `ceph.cluster.name` vermerkt. Dieser Cluster ist **`ceph-1`**. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` in `/opt/oneuptime-ceph-agent` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "Der Befehl enthält bereits Ihre OneUptime-URL und Ihren Ingestion-Schlüssel. Nach dem Rest fragt das Skript:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "Laden Sie `docker-compose.yml` und `otel-collector-config.yaml` von diesem OneUptime in einen neuen Ordner herunter:",
  "Create a `.env` file next to them:":
    "Legen Sie daneben eine `.env`-Datei an:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- Ersetzen Sie `my-ceph-cluster` durch einen Namen für diesen Cluster, etwa `ceph-prod`. Unter diesem Namen erscheint der Cluster in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Cluster.",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- Nennen Sie **jeden** mgr-Daemon in `CEPH_MGR_ENDPOINTS`, kommagetrennt und in eckigen Klammern — ohne die Klammern liest der Collector die ganze Liste als ein ungültiges Ziel.",
  "Start the agent:": "Starten Sie den Agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose startet außerdem **`oneuptime-ceph-ai-agent`**, den KI-Agenten von OneUptime. Er wartet auf einen eigenen Ceph-Client — siehe **OneUptime-KI-Agent** unter Erweitert, oder löschen Sie seinen Dienst aus `docker-compose.yml`, wenn Sie OneUptime AI nicht nutzen.",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "Der Agent liest diese aus der `.env`-Datei neben `docker-compose.yml`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml`.",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | Ja | Kommagetrennte `host:port`-Liste **aller** mgr-Daemons in eckigen Klammern, z. B. `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "Er verbindet sich als eigener Ceph-Client, `client.oneuptime-ai`, mit der minimalen `ceph.conf` des Clusters und dem Keyring dieses Clients in einem Ordner `ceph/` neben `docker-compose.yml`. Auf einem Ceph-Admin-Knoten, im Ordner des Agenten:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "Führen Sie diese im Ordner des Agenten aus, dem mit `docker-compose.yml`.",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfiguration ist eine Datei daneben, daher bringt Ziehen allein den Agenten nicht voran. Laden Sie beide Dateien erneut herunter; Ihre `.env` bleibt, und eine Änderung, die Sie an einer der Dateien vorgenommen haben, müssen Sie erneut vornehmen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Ziehen Sie dann die Images und erstellen Sie den Agenten neu, damit der Collector seine neue Konfiguration liest:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `CEPH_CLUSTER_NAME`, an jeder Metrik als `ceph.cluster.name` vermerkt. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- Dies installiert den Agenten für **`ceph-1`** — lassen Sie `CEPH_CLUSTER_NAME` genau so, wie es ist, sonst werden die Daten als neuer Cluster registriert.",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "Die Identität des Clusters kommt aus `CEPH_CLUSTER_NAME`, an jeder Metrik als `ceph.cluster.name` vermerkt. Dieser Cluster ist **`ceph-1`**. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner mit `docker-compose.yml` — beachten Sie, dass ein neuer Name einen neuen Cluster registriert.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nein | Der Containername des Collectors (Standard: `oneuptime-ceph-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht eigene Namen: Das Installationsskript benennt die Container eines neuen Agenten nach seinem Ordner, sofern Sie sie nicht setzen, und behält sie bei, wenn Sie das Skript erneut ausführen |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nein | Der Containername des KI-Agenten (Standard: `oneuptime-ceph-ai-agent`). Den KI-Agenten eines zweiten Clusters benennt das Installationsskript nach seinem Collector (`oneuptime-ceph-ai-agent-cluster2` neben `oneuptime-ceph-agent-cluster2`), sofern Sie den Namen nicht setzen, und behält ihn bei, wenn Sie das Skript erneut ausführen |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "Ein Agent liest einen Cluster. Für einen zweiten Cluster installieren Sie einen zweiten Agenten in einem eigenen Ordner, mit eigenen Containernamen — zwei Container können sich keinen Namen teilen:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "Das Skript benennt die Container nach dem Ordner, etwa `oneuptime-ceph-agent-cluster2`, sofern Sie ihre Variablen nicht setzen, etwa `CEPH_AGENT_CONTAINER_NAME`. Es hinterlegt die Namen in der `.env` dieses Agenten, sodass sie ein erneuter Aufruf des Skripts mit demselben `INSTALL_DIR` für ein Upgrade des Agenten beibehält, und ein Agent, dessen `container_name` Sie einmal in `docker-compose.yml` bearbeitet haben, behält diesen Namen.",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "Geben Sie jedem Ordner einen eigenen Namen: Docker Compose benennt ein Projekt allein nach seinem Ordner, daher lehnt das Skript einen Ordner ab, der so heißt wie einer, in dem bereits anderswo ein Agent läuft. Übergeben Sie den Ordner mit `-d` an das Diagnoseskript.",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | Nein | Der Containername des Collectors (Standard: `oneuptime-ceph-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | Nein | Der Containername des KI-Agenten (Standard: `oneuptime-ceph-ai-agent`). Der Agent eines zweiten Clusters auf demselben Rechner braucht einen eigenen |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "Ein Agent liest einen Cluster. Für einen zweiten Cluster richten Sie einen zweiten Agenten in einem eigenen Ordner ein, mit eigenen Containernamen — zwei Container können sich keinen Namen teilen. Setzen Sie sie in der `.env` dieses Agenten:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "Geben Sie jedem Ordner einen eigenen Namen: Docker Compose benennt ein Projekt allein nach seinem Ordner, daher würde ein zweiter Ordner mit demselben Namen die Container des ersten Agenten ersetzen. Halten Sie die Namen aus `docker-compose.yml` heraus, das ein Upgrade ersetzt.",
};

export default TRANSLATION;
