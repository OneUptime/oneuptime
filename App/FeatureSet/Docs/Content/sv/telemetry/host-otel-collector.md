# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Översikt

Du kan köra **OpenTelemetry Collector** som en tjänst direkt på dina Linux-, macOS- eller Windows-värdar för att skicka värdtelemetri till OneUptime över OTLP. Den här sidan går igenom hur du installerar collectorn, konfigurerar den för varje operativsystem och väljer rätt mottagare för det du vill samla in:

- **Värdmetriker** (CPU, minne, disk, filsystem, nätverk, belastning, processer) på alla operativsystem
- **Filbaserade loggar** under `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) som omsluter en tailad `log stream`-utdata
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-tjänststatus** (driver fliken **Services** på värden) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — *finns inte i den uppströms förbyggda collectorn; använd den förbyggda **OneUptime Host Collector** eller ett anpassat bygge (se "Windows Services (metriker)" nedan)*

> **Hur är det med OneUptime Infrastructure Agent?** Den agenten är en separat, lättviktig Go-daemon som fokuserar på grundläggande metriker och funktionen *Server / VM Monitor* (status, processer, larm). Den OpenTelemetry Collector som beskrivs här är fristående och är rätt verktyg när du vill ha loggar (filloggar, journald, Windows Event Logs) eller rikare värdmetriker inmatade som standard-OTLP. Båda kan köras på samma värd utan att störa varandra.

## Förutsättningar

- En **OneUptime Telemetry Ingestion Token** — skapa en från *Project Settings → Telemetry Ingestion Keys* och kopiera värdet för `x-oneuptime-token`.
- Distributionen **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Standardbygget `otelcol` inkluderar **inte** mottagare som `windowseventlogreceiver`, `journaldreceiver` eller `hostmetrics`-extrafunktioner — se till att använda `contrib`-distributionen. Ett undantag värt att känna till från början: alpha-mottagaren `windowsservicereceiver` (som driver fliken **Services** i Windows) är **inte** medföljande i den uppströms förbyggda `contrib`-binären — använd den förbyggda **OneUptime Host Collector** (som inkluderar den) eller bygg din egen; se "Windows Services (metriker)" nedan.
- Root / Administrator på värden för att installera collectorn som en tjänst och (där det är tillämpligt) läsa privilegierade loggkällor.

## Steg 1 — Installera OpenTelemetry Collector

Välj avsnittet för ditt operativsystem. Alla exempel förutsätter att du installerar den senaste `otelcol-contrib`-versionen från [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian-paketet installerar binären på `/usr/bin/otelcol-contrib`, standardkonfigurationen på `/etc/otelcol-contrib/config.yaml` och en systemd-enhet på `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Sökvägarna matchar Debian-paketet (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-enheten `otelcol-contrib`).

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

Du skapar `/etc/otelcol-contrib/config.yaml` i Steg 2 och en `launchd`-plist i Steg 3.

### Windows

På Windows installerar du **OneUptime Host Collector** — OneUptimes förbyggda collector som inkluderar mottagaren `windows_service` (som driver fliken **Services** på värden och *inte* finns i det uppströms `otelcol-contrib`-bygget). Från en **förhöjd** PowerShell-prompt:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Du skapar `C:\Program Files\OneUptimeHostCollector\config.yaml` i Steg 2 och registrerar en Windows-tjänst i Steg 3.

> Föredrar du det uppströms `otelcol-contrib`? Ladda ner `otelcol-contrib_*_windows_amd64.zip` från [OpenTelemetrys versionssida](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) i stället — allt nedan fungerar likadant, **förutom** fliken **Services** på värden, som behöver `windows_service` (finns inte i det uppströms bygget; se "Windows Services (metriker)").

## Steg 2 — Konfigurera collectorn

Konfigurationsfilen finns på:

| OS | Sökväg |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Varje konfiguration följer samma form — välj de mottagare du vill ha, lägg till en `batch`- och `resource`-processor och exportera till OneUptime över OTLP HTTP. Exemplen nedan visar en komplett, kopiera-och-klistra-bar konfiguration per operativsystem och går sedan igenom varje mottagarblock så att du kan blanda och matcha.

Ersätt `YOUR_TELEMETRY_INGESTION_TOKEN` och värdet för `service.name` så att de passar din miljö.

### Gemensamma delar (används av alla operativsystem)

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

- **`batch`** grupperar poster före export så att du inte betalar en HTTP-tur-och-retur per post.
- **`resource`** stämplar varje post med `service.name`. Använd ett annat värde per värd (t.ex. `prod-web-01`) om du vill att varje maskin ska visas som sin egen telemetritjänst i OneUptime.
- **`otlphttp`** skickar till OneUptime över HTTPS med inmatningstoken bifogad.

### Värdmetriker (Linux, macOS, Windows)

Fungerar på alla operativsystem. Hämtar CPU-, minnes-, disk-, filsystem-, nätverks-, belastnings-, paging- och processmetriker från värdens kärna:

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

> På Linux läser collectorn `/proc` och `/sys`. När collectorn körs i en container, montera värdens `/proc` och `/sys` och sätt miljövariablerna `HOST_PROC` / `HOST_SYS`. När den körs direkt som en systemd-tjänst (som installerat ovan) behövs ingen extra konfiguration.

### Filloggar (Linux, macOS)

Taila valfri loggfil på disk. Nedan finns en vanlig startuppsättning:

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

`start_at: end` betyder nya rader från det ögonblick collectorn startar; ändra till `beginning` för att fylla på historik vid första körningen. Collectorn håller reda på filoffset, så den återupptar korrekt mellan omstarter.

**Förvandla stackspårningar i värdloggar till Exceptions.** OneUptime skannar automatiskt error- och fatal-loggrader efter stackspårningar och rullar upp dem i vyn **Exceptions** (Issues), attribuerade till den här värden — ingen extra konfiguration behövs. För att detta ska gruppera bra måste en flerradig stackspårning (Java, Python, .NET, Ruby) komma fram som **en** loggpost, inte en post per rad. Aktivera flerradig återkombinering på `filelog`-mottagaren så att en spårning och dess ramar hålls samman:

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

Utan återkombinering matas varje ram in som en separat logg och undantaget visas som ett enradigt, dåligt grupperat ärende. Om din applikation kan skicka OpenTelemetry-loggattributen `exception.type` / `exception.message` / `exception.stacktrace` direkt, gör det istället — det är den mest tillförlitliga vägen och är oberoende av flerradig tolkning.

### systemd journal (Linux)

Om din värd använder systemd är `journald`-mottagaren ofta ett bättre val än att taila `/var/log/*` — den fångar allt på ett ställe och bevarar strukturerade fält:

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

Collector-binären måste kunna köra `journalctl` (Debian- / RPM-paketen inkluderar det redan som ett beroende).

### Apple Unified Log (macOS)

macOS har fasat ut `/var/log/system.log` till förmån för Apple Unified Log, som frågas med `log show` / `log stream`. Det enklaste sättet att mata in den är att strömma `log`-utdata via `filelog`-mottagaren med en liten wrapper. Skapa `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Gör den körbar, kör den under launchd (eller `nohup` för ett snabbt test) och peka sedan collectorn mot filen:

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
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
```

(Om du inte behöver den enhetliga loggen, hoppa över detta — Mac-flottor klarar sig ofta bra med bara värdmetriker + några filloggar.)

### Windows Event Logs

Prenumerera på de kanaler du bryr dig om via det inbyggda `wevtapi`:

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

För att begränsa den högvolymsmässiga `Security`-kanalen till specifika händelse-ID:n:

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

För att läsa en anpassad eller applikationsspecifik kanal (allt du kan se under *Event Viewer → Applications and Services Logs*), använd dess exakta visningsnamn:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (metriker)

Fliken **Services** på värden drivs av [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (konfigurationstyp `windows_service`), som rapporterar körningstillståndet och starttypen för Windows-tjänster som metriker.

**OneUptime Host Collector (installerad i Steg 1, standardvalet på Windows) inkluderar redan den här mottagaren.** Aktivera den i din `config.yaml` och lägg till den i metrikpipelinen:

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

Mottagaren avger en `windows.service.status`-gauge per tjänst — heltalet är Win32-tjänstens tillstånd (`4` = körs, `1` = stoppad) — med attributen `name` och `startup_mode`. Kör collectorn som `LocalSystem` (standard för `sc.exe`) så att den kan läsa varje tjänst; alla den inte kan öppna hoppas över. Mottagaren är **alpha** och **endast för Windows**; kända problem inkluderar ett skrapfel som kan krascha collectorn och en `access denied` på en tjänst som påverkar andra — begränsa till `include_services` om du stöter på dem.

#### Använda den uppströms collectorn i stället?

Den uppströms förbyggda `otelcol-contrib`-binären inkluderar **inte** `windowsservicereceiver` — att lägga till `windows_service` misslyckas vid start med `'receivers' unknown type: "windows_service"`, och **ingen versionsuppgradering åtgärdar detta** (den finns inte i något utgivet `otelcol-contrib`-bygge). Antingen byter du till OneUptime Host Collector (Steg 1), eller så bygger du din egen med [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — skapa `builder-config.yaml` (håll varje version på samma collector-utgåva):

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

Kör sedan den resulterande `otelcol-oneuptime.exe` och aktivera `windows_service` som visas ovan.

### Komplett exempel — Linux-värd

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

### Komplett exempel — macOS-värd

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

### Komplett exempel — Windows-värd

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

## Steg 3 — Kör collectorn som en tjänst

### Linux (systemd)

Debian- / RPM-paketen installerar redan en systemd-enhet. Aktivera och starta den bara:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

För att följa collectorns egna loggar:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Skapa `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Ladda den:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Från en **förhöjd** PowerShell-prompt:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

Tjänsten körs under `LocalSystem` som standard, vilket har de behörigheter som behövs för att läsa Windows Event Log-kanalen `Security`.

## Steg 4 — Verifiera i OneUptime

1. Generera lite signal på värden:
   - **Linux / macOS:** `logger "hello from oneuptime"` (skriver till syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` från en förhöjd prompt.
2. I OneUptime-instrumentpanelen, öppna **Telemetry → Services** och välj den `service.name` du konfigurerade.
3. Öppna **Metrics** — värdmetriker (CPU, minne, filsystem osv.) bör visas inom en minut.
4. Öppna **Logs** — dina filloggar / journald-poster / Windows Event Logs bör strömma in. Användbara sökbara attribut inkluderar `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` och `winlog.provider.name`.

## Självhostad OneUptime

Om du självhostar OneUptime, peka exportören mot din egen värd:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Om din instans endast använder HTTP, ändra schemat till `http://` och använd lämplig port.

## Bakom en proxy

OpenTelemetry Collector respekterar standardmiljövariablerna `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Sätt dem på tjänsten:

- **systemd (Linux):** lägg in `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` med `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, kör sedan `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** lägg till en `<EnvironmentVariables>`-dict i plisten.
- **Windows-tjänst:** sätt miljövariabler på tjänsten via `sc.exe config` eller registret under `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Felsökning

- **Ingen telemetri visas i OneUptime**
  - Lägg till `service.telemetry.logs.level: debug` i konfigurationen och starta om collectorn för utförlig utdata.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) eller `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** titta under *Event Viewer → Windows Logs → Application* efter källan `otelcol-contrib`.
  - Bekräfta att värden kan nå `https://oneuptime.com/otlp` (eller din självhostade slutpunkt): `curl -v https://oneuptime.com/otlp` från samma maskin.
- **HTTP 401 från exportören** — inmatningstoken är ogiltig eller återkallad. Generera en ny från *Project Settings → Telemetry Ingestion Keys*.
- **Windows Event Log `Security` returnerar access denied** — tjänsten körs inte med tillräckliga behörigheter. Återskapa den under `LocalSystem` (standard med `sc.exe create`) eller ge tjänstkontot användarrättigheten *Manage auditing and security log*.
- **`journald`-mottagaren misslyckas med att starta** — se till att `journalctl` finns i collectorns `PATH` och att `/var/log/journal` existerar (kör `sudo systemd-tmpfiles --create --prefix /var/log/journal` om inte).
- **Hög volym / kostnad** — begränsa mottagarna (specifika Windows-kanaler, specifika systemd-enheter, specifika loggfiler), lägg till ett `query:`-filter på Windows Event Log-mottagaren eller lägg till en `filter`-processor för att släppa händelser med låg allvarlighetsgrad före export.

## Nästa steg

- Lägg till **Logs Monitors** för att larma om specifika loggmönster (till exempel larma när mer än 5 misslyckade inloggningar med `winlog.event_id = 4625` inträffar inom ett 5-minutersfönster).
- Lägg till **Metrics Monitors** på värdmetriker (CPU-mättnad, lågt diskutrymme, swap-användning).
- Kombinera detta med [Server / VM Monitor](/docs/monitor/server-monitor) och [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) för end-to-end-värdsynlighet.
- Skicka samma konfiguration till varje värd via Ansible / Chef / Puppet / Group Policy / Intune / din befintliga konfigurationshanteringsverktygskedja.
