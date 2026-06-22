# Host-OpenTelemetry-Collector (Linux, macOS, Windows)

## Überblick

Sie können den **OpenTelemetry Collector** als Dienst direkt auf Ihren Linux-, macOS- oder Windows-Hosts betreiben, um Host-Telemetrie über OTLP an OneUptime zu senden. Diese Seite führt Sie durch die Installation des Collectors, die Konfiguration für jedes Betriebssystem und die Auswahl der richtigen Receiver für das, was Sie erfassen möchten:

- **Host-Metriken** (CPU, Arbeitsspeicher, Festplatte, Dateisystem, Netzwerk, Last, Prozesse) auf jedem Betriebssystem
- **Dateibasierte Logs** unter `/var/log/**` (Linux, macOS) über den [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) über den [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) über den [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor), der eine getailte `log stream`-Ausgabe umschließt
- **Windows Event Logs** über den [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-Dienststatus** (versorgt den Host-Tab **Services**) über den [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — _nicht im vorgefertigten Upstream-Collector enthalten; verwenden Sie den vorgefertigten **OneUptime Host Collector** oder einen benutzerdefinierten Build (siehe „Windows Services (Metriken)" weiter unten)_

> **Was ist mit dem OneUptime Infrastructure Agent?** Dieser Agent ist ein separater, leichtgewichtiger Go-Daemon, der sich auf grundlegende Metriken und die Funktion _Server / VM Monitor_ (Status, Prozesse, Alerting) konzentriert. Der hier beschriebene OpenTelemetry Collector ist unabhängig davon und das richtige Werkzeug, wenn Sie Logs (Dateilogs, journald, Windows Event Logs) oder umfangreichere Host-Metriken als standardisiertes OTLP erfassen möchten. Beide können auf demselben Host laufen, ohne sich gegenseitig zu beeinträchtigen.

## Voraussetzungen

- Ein **OneUptime Telemetry Ingestion Token** — erstellen Sie eines unter _Project Settings → Telemetry Ingestion Keys_ und kopieren Sie den Wert von `x-oneuptime-token`.
- Die Distribution **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Der standardmäßige `otelcol`-Build enthält Receiver wie `windowseventlogreceiver`, `journaldreceiver` oder `hostmetrics`-Extras **nicht** — stellen Sie sicher, dass Sie die `contrib`-Distribution verwenden. Eine Ausnahme, die Sie von vornherein kennen sollten: Der Alpha-`windowsservicereceiver` (der den Windows-**Services**-Tab versorgt) ist **nicht** in der vorgefertigten Upstream-`contrib`-Binärdatei enthalten — verwenden Sie den vorgefertigten **OneUptime Host Collector** (der ihn enthält) oder erstellen Sie Ihren eigenen; siehe „Windows Services (Metriken)" weiter unten.
- Root-/Administratorrechte auf dem Host, um den Collector als Dienst zu installieren und (sofern zutreffend) privilegierte Log-Quellen zu lesen.

## Schritt 1 — Den OpenTelemetry Collector installieren

Wählen Sie den Abschnitt für Ihr Betriebssystem. Alle Beispiele gehen davon aus, dass Sie das neueste `otelcol-contrib`-Release von [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) installieren.

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Das Debian-Paket installiert die Binärdatei unter `/usr/bin/otelcol-contrib`, die Standardkonfiguration unter `/etc/otelcol-contrib/config.yaml` und eine systemd-Unit unter `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Die Pfade entsprechen denen des Debian-Pakets (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-Unit `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.154.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Sie erstellen `/etc/otelcol-contrib/config.yaml` in Schritt 2 und eine `launchd`-plist in Schritt 3.

### Windows

Installieren Sie unter Windows den **OneUptime Host Collector** — den vorgefertigten Collector von OneUptime, der den `windows_service`-Receiver mitbringt (der den Host-Tab **Services** versorgt und _nicht_ im Upstream-`otelcol-contrib`-Build enthalten ist). Über eine PowerShell-Eingabeaufforderung **mit erhöhten Rechten**:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Sie erstellen `C:\Program Files\OneUptimeHostCollector\config.yaml` in Schritt 2 und registrieren in Schritt 3 einen Windows-Dienst.

> Bevorzugen Sie das Upstream-`otelcol-contrib`? Laden Sie stattdessen `otelcol-contrib_*_windows_amd64.zip` von der [OpenTelemetry-Releases-Seite](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) herunter — alles Weitere funktioniert genauso, **außer** dem Host-Tab **Services**, der `windows_service` benötigt (nicht im Upstream-Build enthalten; siehe „Windows Services (Metriken)").

## Schritt 2 — Den Collector konfigurieren

Die Konfigurationsdatei befindet sich unter:

| Betriebssystem | Pfad                                                  |
| -------------- | ----------------------------------------------------- |
| Linux          | `/etc/otelcol-contrib/config.yaml`                    |
| macOS          | `/etc/otelcol-contrib/config.yaml`                    |
| Windows        | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Jede Konfiguration folgt demselben Aufbau — wählen Sie die gewünschten Receiver aus, fügen Sie einen `batch`- und einen `resource`-Processor hinzu und exportieren Sie über OTLP HTTP an OneUptime. Die folgenden Beispiele zeigen eine vollständige, kopierbare Konfiguration pro Betriebssystem und gehen anschließend jeden Receiver-Block durch, sodass Sie beliebig kombinieren können.

Ersetzen Sie `YOUR_TELEMETRY_INGESTION_TOKEN` und den Wert von `service.name` passend zu Ihrer Umgebung.

### Gemeinsame Bestandteile (von jedem Betriebssystem verwendet)

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** gruppiert Datensätze vor dem Export, sodass Sie nicht einen HTTP-Roundtrip pro Datensatz aufwenden müssen.
- **`resource`** versieht jeden Datensatz mit `service.name`. Verwenden Sie pro Host einen anderen Wert (z. B. `prod-web-01`), wenn jeder Rechner als eigener Telemetrie-Dienst in OneUptime erscheinen soll.
- **`otlphttp`** sendet über HTTPS an OneUptime, wobei das Ingestion-Token angehängt wird.

### Host-Metriken (Linux, macOS, Windows)

Funktioniert auf jedem Betriebssystem. Erfasst CPU-, Arbeitsspeicher-, Festplatten-, Dateisystem-, Netzwerk-, Last-, Paging- und Prozessmetriken aus dem Host-Kernel:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
```

> Unter Linux liest der Collector `/proc` und `/sys`. Wenn der Collector in einem Container läuft, binden Sie das `/proc` und `/sys` des Hosts ein und setzen Sie die Umgebungsvariablen `HOST_PROC` / `HOST_SYS`. Wenn er direkt als systemd-Dienst läuft (wie oben installiert), ist keine zusätzliche Einrichtung erforderlich.

### Dateilogs (Linux, macOS)

Tailen Sie jede beliebige Logdatei auf der Festplatte. Nachfolgend ein gängiges Einstiegsset:

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

`start_at: end` bedeutet neue Zeilen ab dem Moment, in dem der Collector startet; ändern Sie es auf `beginning`, um beim ersten Lauf nachzufüllen. Der Collector verfolgt die Datei-Offsets und setzt daher über Neustarts hinweg korrekt fort.

**Stacktraces aus Host-Logs in Exceptions umwandeln.** OneUptime durchsucht Error- und Fatal-Logzeilen automatisch nach Stacktraces und fasst sie in der Ansicht **Exceptions** (Issues) zusammen, zugeordnet zu diesem Host — ohne zusätzliche Konfiguration. Damit dies gut gruppiert wird, muss ein mehrzeiliger Stacktrace (Java, Python, .NET, Ruby) als **ein** Logdatensatz ankommen, nicht als ein Datensatz pro Zeile. Aktivieren Sie die Mehrzeilen-Zusammenführung auf dem `filelog`-Receiver, damit ein Trace und seine Frames zusammenbleiben:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

Ohne Zusammenführung wird jeder Frame als separates Log erfasst und die Exception erscheint als einzeiliges, schlecht gruppiertes Issue. Wenn Ihre Anwendung die OpenTelemetry-Log-Attribute `exception.type` / `exception.message` / `exception.stacktrace` direkt ausgeben kann, tun Sie stattdessen das — das ist der zuverlässigste Weg und unabhängig vom Parsen mehrzeiliger Logs.

### systemd journal (Linux)

Wenn Ihr Host systemd verwendet, ist der `journald`-Receiver oft besser geeignet als das Tailen von `/var/log/*` — er erfasst alles an einem Ort und bewahrt strukturierte Felder:

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

Die Collector-Binärdatei muss `journalctl` ausführen können (die Debian-/RPM-Pakete enthalten es bereits als Abhängigkeit).

### Apple Unified Log (macOS)

macOS hat `/var/log/system.log` zugunsten des Apple Unified Log abgekündigt, das mit `log show` / `log stream` abgefragt wird. Der einfachste Weg, es zu erfassen, besteht darin, die `log`-Ausgabe über den `filelog`-Receiver mit einem kleinen Wrapper zu streamen. Erstellen Sie `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Machen Sie es ausführbar, führen Sie es unter launchd aus (oder mit `nohup` für einen schnellen Test) und richten Sie den Collector dann auf die Datei aus:

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
```

(Wenn Sie das Unified Log nicht benötigen, überspringen Sie dies — Mac-Flotten laufen oft problemlos mit nur Host-Metriken + einigen wenigen Dateilogs.)

### Windows Event Logs

Abonnieren Sie die Kanäle, die Sie interessieren, über die native `wevtapi`:

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

Um den volumenstarken `Security`-Kanal auf bestimmte Event-IDs einzugrenzen:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Um einen benutzerdefinierten oder anwendungsspezifischen Kanal zu lesen (alles, was Sie unter _Event Viewer → Applications and Services Logs_ sehen können), verwenden Sie dessen exakten Anzeigenamen:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (Metriken)

Der Host-**Services**-Tab wird vom [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (Konfigurationstyp `windows_service`) versorgt, der den Laufzustand und den Starttyp von Windows-Diensten als Metriken meldet.

**Der OneUptime Host Collector (in Schritt 1 installiert, der Standard unter Windows) enthält diesen Receiver bereits.** Aktivieren Sie ihn in Ihrer `config.yaml` und fügen Sie ihn der Metriken-Pipeline hinzu:

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
```

Der Receiver gibt pro Dienst einen `windows.service.status`-Gauge aus — die Ganzzahl ist der Win32-Dienstzustand (`4` = läuft, `1` = gestoppt) — mit den Attributen `name` und `startup_mode`. Führen Sie den Collector als `LocalSystem` aus (der `sc.exe`-Standard), damit er jeden Dienst lesen kann; jeder Dienst, den er nicht öffnen kann, wird übersprungen. Der Receiver ist **Alpha** und **nur für Windows**; bekannte Probleme umfassen einen Scrape-Fehler, der den Collector zum Absturz bringen könnte, und ein `access denied` bei einem Dienst, das andere beeinträchtigt — beschränken Sie sich auf `include_services`, falls Sie darauf stoßen.

#### Lieber den Upstream-Collector verwenden?

Die vorgefertigte Upstream-`otelcol-contrib`-Binärdatei enthält `windowsservicereceiver` **nicht** — das Hinzufügen von `windows_service` schlägt beim Start mit `'receivers' unknown type: "windows_service"` fehl, und **kein Versions-Upgrade behebt dies** (er ist in keinem veröffentlichten `otelcol-contrib`-Build enthalten). Wechseln Sie entweder zum OneUptime Host Collector (Schritt 1) oder erstellen Sie Ihren eigenen mit dem [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — erstellen Sie `builder-config.yaml` (halten Sie jede Version auf demselben Collector-Release):

```yaml
dist:
  name: otelcol-oneuptime
  description: OpenTelemetry Collector with the Windows service receiver
  output_path: ./otelcol-oneuptime
  otelcol_version: 0.154.0

receivers:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/hostmetricsreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowseventlogreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowsservicereceiver v0.154.0

processors:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourcedetectionprocessor v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor v0.154.0
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.154.0

exporters:
  - gomod: go.opentelemetry.io/collector/exporter/otlphttpexporter v0.154.0
```

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

Führen Sie dann die resultierende `otelcol-oneuptime.exe` aus und aktivieren Sie `windows_service` wie oben gezeigt.

### Vollständiges Beispiel — Linux-Host

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Vollständiges Beispiel — macOS-Host

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### Vollständiges Beispiel — Windows-Host

`C:\Program Files\OneUptimeHostCollector\config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  # Powers the Services tab. Included in the OneUptime Host Collector (Step 1).
  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resource, batch]
      exporters: [otlphttp]
```

## Schritt 3 — Den Collector als Dienst ausführen

### Linux (systemd)

Die Debian-/RPM-Pakete installieren bereits eine systemd-Unit. Aktivieren und starten Sie sie einfach:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Um die eigenen Logs des Collectors zu verfolgen:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Erstellen Sie `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

Laden Sie sie:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Über eine PowerShell-Eingabeaufforderung **mit erhöhten Rechten**:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

Der Dienst läuft standardmäßig unter `LocalSystem`, das über die nötigen Berechtigungen verfügt, um den Windows-Event-Log-Kanal `Security` und jeden Windows-Dienst zu lesen.

## Schritt 4 — In OneUptime verifizieren

1. Erzeugen Sie ein Signal auf dem Host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (schreibt nach syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` von einer Eingabeaufforderung mit erhöhten Rechten.
2. Öffnen Sie im OneUptime-Dashboard **Telemetry → Services** und wählen Sie den von Ihnen konfigurierten `service.name`.
3. Öffnen Sie **Metrics** — Host-Metriken (CPU, Arbeitsspeicher, Dateisystem usw.) sollten innerhalb einer Minute erscheinen.
4. Öffnen Sie **Logs** — Ihre Dateilogs / journald-Einträge / Windows Event Logs sollten eintreffen. Nützliche durchsuchbare Attribute sind u. a. `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` und `winlog.provider.name`.

## Selbst gehostetes OneUptime

Wenn Sie OneUptime selbst hosten, richten Sie den Exporter auf Ihren eigenen Host aus:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Wenn Ihre Instanz nur HTTP unterstützt, ändern Sie das Schema auf `http://` und verwenden Sie den entsprechenden Port.

## Hinter einem Proxy

Der OpenTelemetry Collector berücksichtigt die standardmäßigen Umgebungsvariablen `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Setzen Sie sie für den Dienst:

- **systemd (Linux):** Legen Sie `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` mit `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"` an und führen Sie dann `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib` aus.
- **launchd (macOS):** Fügen Sie der plist ein `<EnvironmentVariables>`-Dict hinzu.
- **Windows-Dienst:** Setzen Sie Umgebungsvariablen für den Dienst über `sc.exe config` oder die Registry unter `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Fehlerbehebung

- **Es erscheint keine Telemetrie in OneUptime**
  - Fügen Sie `service.telemetry.logs.level: debug` zur Konfiguration hinzu und starten Sie den Collector für ausführliche Ausgaben neu.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) oder `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** Schauen Sie unter _Event Viewer → Windows Logs → Application_ nach der Quelle `otelcol-contrib`.
  - Stellen Sie sicher, dass der Host `https://oneuptime.com/otlp` (oder Ihren selbst gehosteten Endpunkt) erreichen kann: `curl -v https://oneuptime.com/otlp` von demselben Rechner.
- **HTTP 401 vom Exporter** — das Ingestion-Token ist ungültig oder widerrufen. Erstellen Sie ein neues unter _Project Settings → Telemetry Ingestion Keys_.
- **Der Windows-Event-Log-Kanal `Security` gibt „access denied“ zurück** — der Dienst läuft nicht mit ausreichenden Berechtigungen. Erstellen Sie ihn unter `LocalSystem` neu (der Standard bei `sc.exe create`) oder erteilen Sie dem Dienstkonto das Benutzerrecht _Manage auditing and security log_.
- **Der `journald`-Receiver startet nicht** — stellen Sie sicher, dass `journalctl` im `PATH` des Collectors liegt und dass `/var/log/journal` existiert (führen Sie andernfalls `sudo systemd-tmpfiles --create --prefix /var/log/journal` aus).
- **Hohes Volumen / hohe Kosten** — grenzen Sie die Receiver ein (bestimmte Windows-Kanäle, bestimmte systemd-Units, bestimmte Logdateien), fügen Sie einen `query:`-Filter zum Windows-Event-Log-Receiver hinzu oder fügen Sie einen `filter`-Processor hinzu, um Ereignisse mit niedrigem Schweregrad vor dem Export zu verwerfen.

## Nächste Schritte

- Fügen Sie **Logs Monitors** hinzu, um auf bestimmte Logmuster zu alarmieren (zum Beispiel alarmieren, wenn innerhalb eines Zeitfensters von 5 Minuten mehr als 5 fehlgeschlagene Anmeldungen mit `winlog.event_id = 4625` auftreten).
- Fügen Sie **Metrics Monitors** auf Host-Metriken hinzu (CPU-Auslastung, wenig Festplattenspeicher, Swap-Nutzung).
- Kombinieren Sie dies mit dem [Server / VM Monitor](/docs/monitor/server-monitor) und dem [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) für End-to-End-Sichtbarkeit des Hosts.
- Verteilen Sie dieselbe Konfiguration über Ansible / Chef / Puppet / Group Policy / Intune / Ihr bestehendes Konfigurationsmanagement-Tooling an jeden Host.
