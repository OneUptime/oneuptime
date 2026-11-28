import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der die Verwaltungsadresse des FlashArray über HTTPS (TCP 443) erreicht",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "Ein Administratorkonto auf dem FlashArray, um den Nur-Lese-Benutzer des Agenten anzulegen",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "Erstellen Sie das Token **ohne Ablaufdatum**, sonst hört der Agent an dem Tag auf, an dem es abläuft.",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "Melden Sie sich per SSH als Administrator am FlashArray an. Der erste Befehl fragt nach dem Passwort des neuen Benutzers; der zweite gibt sein API-Token aus:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. Öffnen Sie **Settings → Users and Policies** (in älteren Releases **Settings → Access**).",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. Wählen Sie im ⋮-Menü des Bereichs **Users** die Option **Create User…**, nennen Sie den Benutzer `oneuptime` und geben Sie ihm die Rolle **readonly**.",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. Wählen Sie im ⋮-Menü des neuen Benutzers **Create API Token…**, lassen Sie **Expires In** leer und kopieren Sie das Token.",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "Eine Zeile `purefa_info{...} 1` bedeutet, dass das Array seine Metriken nativ bereitstellt: Machen Sie weiter. Eine **404** bedeutet, dass sein Purity//FA älter ist (Pure dokumentiert den nativen Endpunkt für 6.7.0 und neuer; der Abkündigungshinweis seines Exporters nennt 6.6.11 und neuer) — wählen Sie dann oben in dieser Anleitung stattdessen **FlashArray, älteres Purity**.",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "Die erste Zeile lädt das Skript als `install.sh` herunter, damit Sie es lesen können, bevor Sie es ausführen.",
  "The command carries the platform you picked above. The script asks for:":
    "Der Befehl enthält die oben gewählte Plattform. Das Skript fragt nach:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- Ihrer **OneUptime-URL** und Ihrem **Ingestion-Schlüssel**, beide in Schritt 1 angezeigt (wählen Sie dort einen Schlüssel, damit sie hier ausgefüllt werden)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- einem **Array-Namen** — so erscheint das Array in OneUptime. Geben Sie jedem Array einen eigenen und halten Sie ihn stabil: Ein neuer Name registriert ein neues Speicher-Array",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- der **Verwaltungsadresse** des FlashArray (Hostname oder IP, ohne `https://`) und dem **API-Token** des Nur-Lese-Benutzers, das es einliest, ohne es anzuzeigen",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- ob das Zertifikat des Arrays geprüft werden soll — antworten Sie **N**, es sei denn, das Array hat ein Zertifikat einer CA, der Sie vertrauen (Arrays werden mit einem selbstsignierten ausgeliefert)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "Es installiert nach `/opt/oneuptime-storage-array-agent`, schreibt eine `.env`-Datei, die nur Sie lesen können (sie enthält das API-Token), und startet den Agenten mit Docker Compose.",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "Laden Sie die Compose-Datei und die Collector-Konfigurationen von diesem OneUptime in einen neuen Ordner herunter:",
  "Create a `.env` file next to them:":
    "Legen Sie daneben eine `.env`-Datei an:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Ersetzen Sie `my-storage-array` durch einen Namen für dieses Array, etwa `fa-prod-01`. Unter diesem Namen erscheint das Array in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert ein neues Speicher-Array.",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Setzen Sie `PURE_FA_ENDPOINT` auf die Verwaltungsadresse des FlashArray — Hostname oder IP, ohne `https://` — und `PURE_FA_API_TOKEN` auf das API-Token des Nur-Lese-Benutzers. Führen Sie `chmod 600 .env` aus: Die Datei enthält das Token.",
  "Start the agent:": "Starten Sie den Agenten:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "Suchen Sie in den Protokollen nach `Everything is ready. Begin running and processing data.`. Das Array erscheint dann nach seinem ersten Abruf automatisch im Bereich **Speicher-Arrays**, meist innerhalb von ein bis zwei Minuten.",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "Das Installationsskript schreibt diese nach `/opt/oneuptime-storage-array-agent/.env`; eine Installation mit Docker Compose liest sie aus der `.env`-Datei neben `docker-compose.yml`. Nachdem Sie eine geändert haben, übernehmen Sie sie mit `docker compose up -d` im Ordner des Agenten.",
  "| Variable | Required | Description |":
    "| Variable | Erforderlich | Beschreibung |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | Ja | Die URL Ihrer OneUptime-Instanz (z. B. `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Ja | Telemetrie-Ingestion-Schlüssel — der in Schritt 1 gewählte |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Der Name, unter dem sich dieses Array in OneUptime registriert. An jeder Metrik als Ressourcenattribut `storage.array.name` vermerkt. Halten Sie ihn stabil — eine Änderung registriert ein neues Speicher-Array |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | Nein | Die Plattform, als Ressourcenattribut `storage.system` vermerkt: `purestorage.flasharray` oder `purestorage.flashblade` (Standard: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Nein | Welche mitgelieferte Konfiguration läuft: `otel-collector-config.yaml` (FlashArray, nativ — der Standard), `otel-collector-config.flasharray-exporter.yaml` (älteres FlashArray) oder `otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | Nein | Startet den Exporter, den die Konfiguration braucht: leer für die native FlashArray-Konfiguration, `flasharray-exporter` oder `flashblade` für die anderen |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | Die Verwaltungsadresse des FlashArray — Hostname oder IP, ohne `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | API-Token des FlashArray-Benutzers mit der Rolle readonly |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | Die Verwaltungsadresse des FlashBlade — Hostname oder IP, ohne `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | API-Token des FlashBlade-Benutzers mit der Rolle readonly |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | Nein | `true` akzeptiert das selbstsignierte Zertifikat des Arrays am nativen Endpunkt; `false` prüft es (Standard: `true`). Die Exporter von Pure prüfen das Zertifikat des Arrays nie, daher gilt die Variable für sie nicht |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | Nein | Der Containername des Agenten (Standard: `oneuptime-storage-array-agent`). Der Agent eines zweiten Arrays auf demselben Rechner braucht einen eigenen: Das Installationsskript benennt einen neuen Agenten nach seinem Ordner, sofern Sie ihn nicht setzen, und behält ihn bei, wenn Sie das Skript erneut ausführen |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- Der Collector liest den eigenen OpenMetrics-Endpunkt des FlashArray über HTTPS, mit dem Token als Bearer-Anmeldedaten — es läuft kein Exporter.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **Ein Abrufjob pro Endpunkt**, jeder so oft gelesen, wie es sich lohnt: `/metrics/array` alle 60 Sekunden; `/metrics/volumes`, `/metrics/hosts` und `/metrics/pods` alle 2 Minuten; `/metrics/directories` alle 30 Minuten — den Platz von Verzeichnissen zu berechnen, ist für das Array aufwendig.",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **Jeder Job versieht seine Reihen mit dem Label `scrape_endpoint: <endpoint>`**, damit OneUptime weiß, von welchen Objekten ein Batch die vollständige Liste ist — so verlässt ein gelöschtes Objekt das Inventar. Lassen Sie die Labels so, wie sie ausgeliefert werden.",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **Die Latenz pro Volume und pro Host behält drei Dimensionen** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); eine Regel in `metric_relabel_configs` verwirft die Aufschlüsselung nach QoS, Warteschlange, SAN und Servicezeit, die die Zahl der Reihen eines großen Arrays vervielfacht. Die Aufschlüsselung für das ganze Array bleibt erhalten.",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **Kein `send_batch_max_size`.** OneUptime baut das Inventar aus einem ganzen Abruf neu auf, daher teilt der Prozessor `batch` nie einen auf.",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "Dies ist die vollständige `otel-collector-config.yaml`, die der Agent ausführt; die `.env`-Datei liefert die Werte `${env:...}`:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "Der Agent sendet nur Metriken, bis Sie seine Syslog-Receiver einschalten. Arrays leiten ihre Warnungen und Audit-Ereignisse als Syslog weiter; der Agent vermerkt `storage.array.name` an jeder Zeile, sodass sie auf der Seite **Protokolle** dieses Arrays landen.",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. Entfernen Sie in `otel-collector-config.yaml` die Kommentarzeichen vor den Receivern `syslog/tcp` und `syslog/udp` und vor der Pipeline `logs`. Klassische BSD-Syslog-Zeitstempel tragen keine Zeitzone: Setzen Sie `location` auf die Zeitzone des Arrays, sofern seine Uhr nicht auf UTC läuft.",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. Entfernen Sie in `docker-compose.yml` die Kommentarzeichen vor dem Block `ports:`, der `5514/tcp` und `5514/udp` veröffentlicht, und öffnen Sie den Port in der Firewall des Rechners für das Verwaltungsnetzwerk des Arrays.",
  "3. Apply both:": "3. Übernehmen Sie beides:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. Öffnen Sie auf dem FlashArray als Administrator **Settings → System → Syslog Servers**, fügen Sie `udp://<agent-host>:5514` (oder `tcp://<agent-host>:5514`) hinzu und senden Sie eine Testnachricht.",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einem Projekt-Label am Array: `oneuptime.label.<dimension>=<value>` ist das Label `<dimension>:<value>`. Fügen Sie sie dem Prozessor `resource` der verwendeten Collector-Konfiguration hinzu, neben `storage.array.name`:",
  "Then restart the collector so it reads the new config:":
    "Starten Sie dann den Collector neu, damit er die neue Konfiguration liest:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Das Array erscheint mit den Labels `team:storage` und `env:production`. Labels werden ohne Beachtung der Groß- und Kleinschreibung abgeglichen, sodass ein vorhandenes Label `Production` wiederverwendet wird; in der OneUptime-Oberfläche hinzugefügte Labels entfernt der Agent nie.",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Jeder Wert ist ein Gauge, den das FlashArray selbst berechnet — Latenz pro Operation in Mikrosekunden, Durchsatz pro Sekunde. Die Speicher-Array-Seiten, der Metrikkatalog und die Warnungsvorlagen von OneUptime bauen auf Folgendem auf:",
  "| Endpoint | Data |": "| Endpunkt | Daten |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **Array** (`/metrics/array`) | `purefa_info`, Kapazität und Datenreduktion (`purefa_array_space_*`), Leistung, offene Warnungen (`purefa_alerts_open`), Hardwarekomponenten, Laufwerke, Controller und Netzwerkschnittstellen |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **Volumes** (`/metrics/volumes`) | Latenz, IOPS, Bandbreite, Platz und Datenreduktion pro Volume |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **Hosts** (`/metrics/hosts`) | Konnektivität, verbundene Volumes, Latenz, IOPS und Platz pro Host |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pods** (`/metrics/pods`) | Verzögerung der Replikatverbindungen von ActiveCluster und ActiveDR, Mediator-Status, Leistung und Platz |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **Verzeichnisse** (`/metrics/directories`) | Platz und Leistung der verwalteten Verzeichnisse der FlashArray File Services |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "Ein Agent liest ein Array. Um mehrere vom selben Rechner aus zu überwachen, installieren Sie jeden in einen eigenen Ordner mit eigener `.env` und eigenem Containernamen — zwei Container können sich keinen Namen teilen:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "Ohne `STORAGE_ARRAY_AGENT_CONTAINER_NAME` benennt das Skript den Container nach dem Ordner. Es hinterlegt den Namen in der `.env` dieses Agenten, sodass ihn ein erneuter Aufruf des Skripts für ein Upgrade des Agenten beibehält, und ein Agent, dessen `container_name` Sie einmal in `docker-compose.yml` bearbeitet haben, behält diesen Namen. Setzen Sie bei Docker Compose stattdessen `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in der `.env` jedes Agenten.",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "Der Agent bringt eine systemd-Unit mit, die vom Ordner des Installationsskripts ausgeht, `/opt/oneuptime-storage-array-agent`. Das Installationsskript lädt sie nicht herunter, holen Sie sie also selbst:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**Upgrade** — das Collector-Image ist in `docker-compose.yml` festgelegt und seine Konfigurationen sind Dateien daneben, daher bringt Ziehen allein den Agenten nicht voran. Führen Sie das Installationsskript erneut aus. Es übernimmt jeden Wert aus Ihrer vorhandenen `.env` (es wird nichts erneut abgefragt), lädt die neueste `docker-compose.yml` und die neuesten Collector-Konfigurationen herunter — eine von Ihnen bearbeitete Datei bleibt als `<file>.bak.<timestamp>` neben der neuen erhalten — und erstellt den Agenten damit neu:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "Ein außerhalb von `/opt/oneuptime-storage-array-agent` installierter Agent (etwa der eines zweiten Arrays) braucht seinen Ordner: `INSTALL_DIR=<folder> bash install.sh`.",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "Stattdessen mit Docker Compose installiert? Laden Sie im Ordner des Agenten die Compose-Datei und die Collector-Konfigurationen erneut herunter; Ihre `.env` bleibt, und eine Änderung, die Sie an einer davon vorgenommen haben, müssen Sie erneut vornehmen:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "Ziehen Sie dann die Images und erstellen Sie den Agenten neu, damit der Collector seine neue Konfiguration liest:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "Die Konfiguration meldet die Collector-Version, die sie festlegt, als **Agent-Version** des Arrays. Legt dieses OneUptime eine neuere fest, öffnet ein Warnzeichen daneben diese Befehle.",
  "**Uninstall** the agent:": "**Deinstallieren** Sie den Agenten:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "Löschen Sie dann den Nur-Lese-Benutzer und sein API-Token auf dem Array, wenn Sie sie nicht mehr brauchen.",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` prüft die ganze Kette — Container-Laufzeit, den Array-Endpunkt genau so, wie der Collector ihn erreicht (den nativen Endpunkt oder den Exporter von Pure, DNS, TLS, das API-Token), das Vermerken des Array-Namens, die Selbstmetriken des Collectors — und fragt OneUptime direkt, ob es Ihren Ingestion-Schlüssel akzeptiert. Diese letzte Prüfung ist die wichtigste: Die OTLP-Endpunkte von OneUptime lehnen einen falschen Schlüssel mit `401` oder `422` ab, was der Collector pro Batch als eine einzige, leicht zu übersehende Zeile `Exporting failed` protokolliert; daher fragt das Skript `GET /otlp/v1/validate` nach einem direkten Urteil 200/401.",
  "It ends with a verdict naming the most likely cause.":
    "Es endet mit einem Urteil, das die wahrscheinlichste Ursache nennt.",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. Prüfen Sie die Collector-Protokolle: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` bedeutet, dass das Array das API-Token abgelehnt hat, `404`, dass das FlashArray keinen nativen Endpunkt hat, `x509`, dass die TLS-Prüfung gegen das selbstsignierte Zertifikat des Arrays aktiv ist, `no such host` oder `connection refused` ein falsches `PURE_FA_ENDPOINT` und ein `401` beim Export einen falschen Ingestion-Schlüssel.",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. Stellen Sie sicher, dass `STORAGE_ARRAY_NAME` gesetzt ist — die Erkennung richtet sich nach dem Ressourcenattribut `storage.array.name`, und ohne es startet der Collector nicht.",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. Stellen Sie sicher, dass `STORAGE_ARRAY_COLLECTOR_CONFIG` und `COMPOSE_PROFILES` dieselbe Plattform nennen.",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "Sein Purity//FA hat keinen nativen OpenMetrics-Endpunkt. Setzen Sie `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` und `COMPOSE_PROFILES=flasharray-exporter` in `.env` und führen Sie `docker compose up -d` aus — oder führen Sie `install.sh` erneut mit der Auswahl für ein älteres Purity aus. Nach dem Upgrade des Arrays auf Purity//FA 6.7 oder neuer wechseln Sie zurück zur nativen Konfiguration und entfernen das Profil.",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "Prüfen Sie, ob Sie das Token eingefügt haben und nicht das Passwort des Benutzers, ob der Benutzer noch existiert und die Rolle readonly hat und ob das Token nicht abgelaufen ist. Erstellen Sie ein neues Token (`pureadmin create --api-token oneuptime` auf einem FlashArray), tragen Sie es in `.env` als `PURE_FA_API_TOKEN` ein und führen Sie `docker compose up -d` aus.",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "Arrays präsentieren standardmäßig ein selbstsigniertes Zertifikat, dem kein Docker-Image vertraut. Setzen Sie `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (die pragmatische Wahl in einem privaten Verwaltungsnetzwerk) oder installieren Sie auf dem Array ein Zertifikat einer CA, der das Collector-Image vertraut.",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` oder `pure-fb-exporter` läuft nicht: `COMPOSE_PROFILES` muss zu `STORAGE_ARRAY_COLLECTOR_CONFIG` passen — `flasharray-exporter` für die FlashArray-Exporter-Konfiguration, `flashblade` für die FlashBlade-Konfiguration. Korrigieren Sie `.env` und führen Sie `docker compose up -d` aus; `docker compose ps` listet dann den Exporter auf.",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. Prüfen Sie, ob der Agent läuft: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. Prüfen Sie die Protokolle des Agenten auf Fehler: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. Prüfen Sie, ob Ihre OneUptime-URL und Ihr Ingestion-Schlüssel stimmen.",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Rechner des Agenten die OneUptime-Instanz über das Netzwerk erreicht.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Die Identität des Arrays kommt aus `STORAGE_ARRAY_NAME`, an jeder Metrik als `storage.array.name` vermerkt. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner des Agenten — beachten Sie, dass ein neuer Name ein neues Speicher-Array registriert.",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "Es registriert das Array als **`array-1`** — der Name, den dieses Array in OneUptime bereits hat.",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- Dies installiert den Agenten für **`array-1`** — lassen Sie `STORAGE_ARRAY_NAME` genau so, wie es ist, sonst werden die Daten als neues Speicher-Array registriert.",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "Die Identität des Arrays kommt aus `STORAGE_ARRAY_NAME`, an jeder Metrik als `storage.array.name` vermerkt. Dieses Array ist **`array-1`**. Korrigieren Sie sie in `.env` und übernehmen Sie sie mit `docker compose up -d` im Ordner des Agenten — beachten Sie, dass ein neuer Name ein neues Speicher-Array registriert.",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "Der Befehl enthält bereits Ihre OneUptime-URL, Ihren Ingestion-Schlüssel und die oben gewählte Plattform. Das Skript fragt nach:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "Zugriff von diesem Rechner auf `quay.io`, von wo Docker das Exporter-Image von Pure zieht",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` startet `pure-fa-exporter`, den Exporter von Pure, neben dem Collector; die beiden müssen zusammenpassen.",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "`docker compose ps` im Ordner des Agenten listet außerdem **`pure-fa-exporter`** auf, den Exporter von Pure, über den der Collector das FlashArray liest.",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Der Collector liest das FlashArray über `pure-fa-exporter`, den Exporter von Pure, der sich mit dem Token, das der Collector bei jedem Abruf mitschickt, an der REST-API des FlashArray anmeldet. Der Port des Exporters bleibt im Compose-Netzwerk.",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der die Verwaltungsadresse des FlashBlade über HTTPS (TCP 443) erreicht",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "Ein Administratorkonto auf dem FlashBlade, um den Nur-Lese-Benutzer des Agenten anzulegen",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "Legen Sie auf dem FlashBlade als Administrator einen Benutzer namens `oneuptime` mit der Rolle **readonly** an — in den Benutzereinstellungen der FlashBlade-GUI oder mit `pureadmin` in der Purity//FB-CLI — und erstellen Sie ein **API-Token** für ihn. Erstellen Sie das Token **ohne Ablaufdatum**, sonst hört der Agent an dem Tag auf, an dem es abläuft.",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "API-Tokens des FlashBlade beginnen mit `T-`. Ein Purity//FB-Release ohne lokale Benutzer nimmt stattdessen ein Konto eines Verzeichnisdienstes (LDAP oder Active Directory), dessen Gruppe der Rolle readonly zugeordnet ist.",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- der **Verwaltungsadresse** des FlashBlade (Hostname oder IP, ohne `https://`) und dem **API-Token** des Nur-Lese-Benutzers, das es einliest, ohne es anzuzeigen",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- Setzen Sie `PURE_FB_ENDPOINT` auf die Verwaltungsadresse des FlashBlade — Hostname oder IP, ohne `https://` — und `PURE_FB_API_TOKEN` auf das API-Token des Nur-Lese-Benutzers. Führen Sie `chmod 600 .env` aus: Die Datei enthält das Token.",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "`docker compose ps` im Ordner des Agenten listet außerdem **`pure-fb-exporter`** auf, den Exporter von Pure, über den der Collector das FlashBlade liest.",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- Der Collector liest das FlashBlade über `pure-fb-exporter`, den Exporter von Pure, der sich mit dem Token, das der Collector bei jedem Abruf mitschickt, an der REST-API des FlashBlade anmeldet. Der Port des Exporters bleibt im Compose-Netzwerk.",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **Ein Abrufjob pro Endpunkt**, jeder so oft gelesen, wie es sich lohnt: `/metrics/array` alle 60 Sekunden; `/metrics/filesystems` und `/metrics/objectstore` alle 5 Minuten — die REST-API des FlashBlade ist nicht dafür gebaut, jedes Dateisystem und jeden Bucket schnell zu melden.",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. Fügen Sie auf dem FlashBlade als Administrator in seinen Syslog-Einstellungen einen Syslog-Server `udp://<agent-host>:5514` (oder `tcp://`) hinzu.",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "Jeder Wert ist ein Gauge, den das FlashBlade selbst berechnet — Latenz pro Operation in Mikrosekunden, Durchsatz pro Sekunde. Die Speicher-Array-Seiten, der Metrikkatalog und die Warnungsvorlagen von OneUptime bauen auf Folgendem auf:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **Array** (`/metrics/array`) | `purefb_info`, Kapazität und Datenreduktion (`purefb_array_space_*`), Leistung pro Protokoll, offene Warnungen (`purefb_alerts_open`), Hardwarezustand (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **Dateisysteme** (`/metrics/filesystems`) | Platz, Datenreduktion und Leistung pro Dateisystem |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **Objektspeicher** (`/metrics/objectstore`) | Platz, Kontingent, Objektanzahl und Leistung pro Bucket |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 oder neuer mit dem Docker-Compose-v2-Plugin, auf einem Rechner, der jeden Knoten des Clusters über UDP 161 (SNMP) erreicht",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "Ein Administratorkonto auf dem Cluster, um SNMP einzuschalten und die Nur-Lese-Community oder den SNMPv3-Benutzer des Agenten festzulegen",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "Melden Sie sich per SSH als Administrator an einem beliebigen Knoten an: OneFS wendet SNMP-Einstellungen auf den ganzen Cluster an. Beantwortet der Cluster SNMP bereits für ein anderes Tool, geben Sie dem Agenten dieselbe Community oder denselben Benutzer und überspringen Sie diesen Schritt. Andernfalls schalten Sie SNMP v2c mit einer eigenen Nur-Lese-Community ein, nicht mit der Standard-Community `I$ilonpublic` von OneFS:",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "Oder schalten Sie SNMPv3 ein, das jede Abfrage authentifiziert und verschlüsselt. OneFS hat einen SNMPv3-Nur-Lese-Benutzer, `general`, bis Sie ihn umbenennen: Geben Sie ihm Passwörter mit mindestens acht Zeichen, ohne Leerzeichen:",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` zeigt die Einstellungen an, mit den Authentifizierungs- und Verschlüsselungsprotokollen des Benutzers. Erlauben Sie UDP 161 vom Rechner des Agenten zu jedem Knoten und listen Sie die Adressen der Knoten mit `isi network interfaces list` auf.",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- den **Adressen aller Knoten**, durch Kommas getrennt: jeweils der eigenen Adresse des Knotens, nie dem Namen der SmartConnect-Zone, da ein Knoten nur für seine eigenen Laufwerke, Sensoren und Ports antwortet",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- der **SNMP-Version**, dann der Nur-Lese-**Community** oder dem SNMPv3-**Benutzer** und seinen beiden Passwörtern, die es jeweils einliest, ohne sie anzuzeigen",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "Ein Benutzer, dessen Protokolle nicht SHA und AES sind, braucht `POWERSCALE_SNMP_AUTH_PROTOCOL` und `POWERSCALE_SNMP_PRIVACY_PROTOCOL` vor `bash install.sh`, ein Benutzer ohne Verschlüsselung `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "Es installiert nach `/opt/oneuptime-storage-array-agent`, schreibt eine `.env`-Datei, die nur Sie lesen können (sie enthält die Community oder die SNMPv3-Passwörter), mit einer Abfrage pro Knoten, und startet den Agenten mit Docker Compose. Kommt ein Knoten zum Cluster hinzu, fügen Sie seine Adresse in dieser Datei zu `POWERSCALE_NODES` hinzu und führen Sie `bash install.sh` erneut aus.",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- Ersetzen Sie `my-storage-array` durch einen Namen für diesen Cluster, etwa `ps-prod`. Unter diesem Namen erscheint der Cluster in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert ein neues Speicher-Array.",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- Führen Sie jeden Knoten in `POWERSCALE_NODES` auf und geben Sie jedem sein eigenes `POWERSCALE_NODE_<n>` und sein eigenes `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, bis zu 252, nach `snmp/cluster` und `snmp/quotas`. Eine IPv6-Adresse steht in eckigen Klammern, etwa `[fd00::11]`.",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- Setzen Sie für SNMPv3 statt der Community `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` und `POWERSCALE_SNMP_PRIVACY_PASSWORD`. Führen Sie `chmod 600 .env` aus: Die Datei enthält die Community oder die Passwörter.",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | Ja | Der Name, unter dem sich dieser Cluster in OneUptime registriert, an jeder Metrik als `storage.array.name` vermerkt. Halten Sie ihn stabil — eine Änderung registriert ein neues Speicher-Array |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | Ja | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Ja | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | Ja | Die Adressen aller Knoten, durch Kommas getrennt. Das Installationsskript schreibt daraus die Abfragen darunter |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | Ja | Der Knoten, über den Zustand, Kapazität und Kontingente des Clusters selbst gelesen werden: der erste in `POWERSCALE_NODES` |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | Ja | Die Abfragen, die der Collector ausführt: `snmp/cluster`, `snmp/quotas`, dann `snmp/node-<n>` für jeden Knoten |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | Ja | Die Adresse von Knoten `<n>`, von 1 bis 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | Nein | `v2c` (Standard) oder `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | Die Nur-Lese-Community des Clusters |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | Der SNMPv3-Nur-Lese-Benutzer des Clusters |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | Nein | `auth_priv` (Standard), `auth_no_priv` oder `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | Nein | `SHA` (Standard), `MD5`, `SHA224`, `SHA256`, `SHA384` oder `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | Das Authentifizierungspasswort des SNMPv3-Benutzers |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | Nein | `AES` (Standard), `DES`, `AES192`, `AES256`, `AES192C` oder `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | Das Verschlüsselungspasswort des SNMPv3-Benutzers |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **Ein Collector, kein Exporter.** Der eigene SNMP-Receiver des Collectors liest die ISILON-MIB von Dell; daneben läuft nichts anderes.",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **Die Objekte des Clusters einmal, über `POWERSCALE_ENDPOINT`:** sein Zustand, seine Kapazität, sein Durchsatz und seine Knotenzahlen alle 60 Sekunden (`snmp/cluster`) und seine SmartQuotas alle 5 Minuten (`snmp/quotas`).",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **Die Objekte jedes Knotens vom Knoten selbst:** sein Zustand, seine CPU, die Leistung seiner Protokolle, seine Laufwerke, Sensoren und Ports alle 60 Sekunden (`snmp/node-<n>`).",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **Jede Abfrage versieht ihre Reihen mit dem Label `scrape_endpoint: <poll>`**, damit OneUptime weiß, von welchen Objekten ein Batch die vollständige Liste ist — so verlässt ein gelöschtes Kontingent das Inventar. Lassen Sie die Labels so, wie sie ausgeliefert werden.",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "Die vollständige Konfiguration, ein SNMP-Receiver pro Knotenplatz, ist `otel-collector-config.powerscale.yaml` im Ordner des Agenten:",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "Schalten Sie dann SNMP auf dem Cluster aus oder ändern Sie die Community oder die SNMPv3-Passwörter des Agenten, wenn nichts anderes den Cluster abfragt.",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` prüft die ganze Kette — die Container-Laufzeit, die Knotenadressen und die Community oder den SNMPv3-Benutzer in `.env`, jeden Knoten mit `snmpget`, wenn der Rechner es hat, das Vermerken des Array-Namens, die Selbstmetriken des Collectors — und fragt OneUptime direkt, ob es Ihren Ingestion-Schlüssel akzeptiert.",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`Error scraping metrics` mit `request timeout` in `docker logs oneuptime-storage-array-agent` nennt einen Knoten, der von diesem Rechner aus nicht auf SNMP antwortet: SNMP ist für die Version, die der Agent verwendet, ausgeschaltet, die Community oder der SNMPv3-Benutzer gehört nicht zum Cluster, oder UDP 161 ist auf dem Weg blockiert. Ein Knoten, der antwortet, aber unter den Knoten des Clusters fehlt, steht nicht in `POWERSCALE_NODES`: Fügen Sie ihn hinzu und führen Sie `bash install.sh` erneut aus.",
};

export default TRANSLATION;
