# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Översikt

Du kan köra **OpenTelemetry Collector** som en tjänst direkt på dina Linux-, macOS- eller Windows-värdar för att skicka värdtelemetri till OneUptime över OTLP. Den här sidan går igenom hur du installerar collectorn, konfigurerar den för varje operativsystem och väljer rätt mottagare för det du vill samla in:

- **Värdmetriker** (CPU, minne, disk, filsystem, nätverk, belastning, processer) på alla operativsystem
- **Filbaserade loggar** under `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) som omsluter en tailad `log stream`-utdata
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-tjänststatus** (driver fliken **Services** på värden) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — medföljer det uppströms `otelcol-contrib`-bygget från och med **v0.155.0** (se "Windows Services (metriker)" nedan)

> **Hur är det med OneUptime Infrastructure Agent?** Den agenten är en separat, lättviktig Go-daemon som fokuserar på grundläggande metriker och funktionen _Server / VM Monitor_ (status, processer, larm). Den OpenTelemetry Collector som beskrivs här är fristående och är rätt verktyg när du vill ha loggar (filloggar, journald, Windows Event Logs) eller rikare värdmetriker inmatade som standard-OTLP. Båda kan köras på samma värd utan att störa varandra.

## Förutsättningar

- En **OneUptime Telemetry Ingestion Token** — skapa en från _Project Settings → Telemetry Ingestion Keys_ och kopiera värdet för `x-oneuptime-token`.
- Distributionen **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Standardbygget `otelcol` inkluderar **inte** mottagare som `windowseventlogreceiver`, `journaldreceiver` eller `hostmetrics`-extrafunktioner — se till att använda `contrib`-distributionen. Alpha-mottagaren `windowsservicereceiver` som driver fliken **Services** i Windows medföljer `otelcol-contrib` från och med **v0.155.0**, så installera en aktuell version; se "Windows Services (metriker)" nedan.
- Root / Administrator på värden för att installera collectorn som en tjänst och (där det är tillämpligt) läsa privilegierade loggkällor.

## Steg 1 — Installera OpenTelemetry Collector

Välj avsnittet för ditt operativsystem. Alla exempel förutsätter att du installerar den senaste `otelcol-contrib`-versionen från [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian-paketet installerar binären på `/usr/bin/otelcol-contrib`, standardkonfigurationen på `/etc/otelcol-contrib/config.yaml` och en systemd-enhet på `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Sökvägarna matchar Debian-paketet (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-enheten `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.156.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Du skapar `/etc/otelcol-contrib/config.yaml` i Steg 2 och en `launchd`-plist i Steg 3.

### Windows

På Windows laddar du ner den uppströms **`otelcol-contrib`**-versionen — den inkluderar mottagaren `windows_service` som driver fliken **Services** på värden (från och med **v0.155.0**). Från en **förhöjd** PowerShell-prompt:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

Detta packar upp `otelcol-contrib.exe` i `C:\Program Files\otelcol-contrib`. Du skapar `config.yaml` i samma mapp i Steg 2 och registrerar en Windows-tjänst i Steg 3.

> Föredrar du en inbyggd installer? OpenTelemetry publicerar också en signerad **`.msi`** (`otelcol-contrib_<version>_windows_x64.msi`) på samma [versionssida](https://github.com/open-telemetry/opentelemetry-collector-releases/releases), som registrerar collectorn som en Windows-tjänst åt dig. Om du använder den, peka den mot `config.yaml` från Steg 2 och se till att tjänsten körs som `LocalSystem` så att fliken **Services** kan läsa Service Control Manager.

## Steg 2 — Konfigurera collectorn

Konfigurationsfilen finns på:

| OS      | Sökväg                                                |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

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
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
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

För att läsa en anpassad eller applikationsspecifik kanal (allt du kan se under _Event Viewer → Applications and Services Logs_), använd dess exakta visningsnamn:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (metriker)

Fliken **Services** på värden drivs av [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (konfigurationstyp `windows_service`), som rapporterar körningstillståndet och starttypen för Windows-tjänster som metriker.

**Den här mottagaren medföljer den uppströms `otelcol-contrib`-binären från och med v0.155.0** — på tidigare versioner misslyckas tillägget av `windows_service` vid start med `'receivers' unknown type: "windows_service"`. Installera en aktuell version (Steg 1), aktivera den sedan i din `config.yaml` och lägg till den i metrikpipelinen:

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

> **`include_services` har ingen effekt?** Filtret kan bara någonsin *begränsa* uppsättningen, så om du listar tjänster och ändå ser varenda en har den redigerade konfigurationen nästan säkert inte nått den körande collectorn. Starta om tjänsten efter redigering (Steg 3); se till att `include_services` är en ifylld lista med samma indrag som `collection_interval` (inte utkommenterad eller tom); och ge fliken **Services** några minuter så att tjänster som rapporterats före ändringen åldras ut ur dess rullande fönster. Namnen är exakta, skiftlägeskänsliga Windows-tjänsters _nyckel_-namn (t.ex. `Spooler`, `W3SVC`), som du kan lista med `Get-Service | Select-Object Name`.

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

`C:\Program Files\otelcol-contrib\config.yaml`:

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

  # Powers the Services tab (otelcol-contrib v0.155.0+).
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
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Tjänsten körs under `LocalSystem` som standard, vilket har de behörigheter som behövs för att läsa Windows Event Log-kanalen `Security`.

## Steg 4 — Verifiera i OneUptime

1. Generera lite signal på värden:
   - **Linux / macOS:** `logger "hello from oneuptime"` (skriver till syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` från en förhöjd prompt.
2. I OneUptime-instrumentpanelen, öppna **Telemetry → Services** och välj den `service.name` du konfigurerade.
3. Öppna **Metrics** — värdmetriker (CPU, minne, filsystem osv.) bör visas inom en minut.
4. Öppna **Logs** — dina filloggar / journald-poster / Windows Event Logs bör strömma in. Användbara sökbara attribut inkluderar `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` och `winlog.provider.name`.

## Minska volymen av insamlad data

Eftersom du äger collector-konfigurationen bestämmer du exakt vad som lämnar värden — ingenting samlas in om inte en mottagare du lagt till efterfrågar det. Om en värd skickar mer än du vill (vilket visar sig som högre inmatningsvolym, och på OneUptime Cloud, högre kostnad), justera det här. De två största reglagen är **vilka loggkällor du tailar** och **hur ofta du skrapar metriker**; en `filter`-processor sköter resten.

Principen är densamma som för själva konfigurationen: **lägg bara till de mottagare vars data du kommer att titta på**, och trimma sedan inom dem. Varje ändring nedan är en redigering av `config.yaml` — tillämpa den och starta om collectorn (Steg 3).

### Var volymen kommer ifrån

| Signal                 | Största orsaken                                        | Skruva ner det med                                                              |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Loggar**             | Varje rad från varje fil / journald-enhet / kanal      | Begränsa mottagare; `query:`-filter; en `filter`-processor på allvarlighetsgrad |
| **Värdmetriker**       | Skrapfrekvens × antal serier                           | `collection_interval`; ta bort `process`-skraparen; val av skrapare             |
| **Metrikkardinalitet** | Metriker per process (en serieuppsättning per process) | Utelämna eller begränsa `process`-skraparen                                     |

### Reglage 1 — Taila bara de loggkällor du behöver

Loggar är nästan alltid den största delen. Collectorn läser bara det du listar, så lösningen är att lista mindre:

- **Filer** — peka `filelog` mot specifika sökvägar, inte breda globmönster. `/var/log/myapp/error.log` i stället för `/var/log/**`.
- **journald** — begränsa `units:` till de tjänster du bryr dig om och höj `priority:` så att du släpper pratsamma `info`/`debug`-poster vid källan:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — `Security`-kanalen är den överlägset mest högvolymsmässiga. Begränsa den till de händelse-ID:n du faktiskt granskar med ett `query:` (som visas i [Windows Event Logs](#windows-event-logs) ovan), eller ta bort kanalen helt om du inte behöver den.

### Reglage 2 — Sakta ner metrikintervallet

`hostmetrics`-volymen skalar direkt med `collection_interval`. Om du inte behöver 30-sekundersupplösning halverar 60s antalet datapunkter:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Reglage 3 — Ta bort skraparen per process (orsaken till kardinalitet)

`process`-skraparen avger en separat uppsättning serier **för varje körande process** på värden — på en upptagen maskin är det den enskilt största källan till metrikkardinalitet. Om du inte behöver CPU/minne per process, lämna den utanför `scrapers:`-listan. Behåll `processes` (som bara är en handfull aggregerade processantalsmetriker) — den är billig. Om du vill ha metriker per process, begränsa dem till de processer som är viktiga:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes: # aggregate counts only — cheap
      # 'process:' (per-process series) intentionally omitted.
      # If you need it, scope it instead of collecting every process:
      # process:
      #   mute_process_name_error: true
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### Reglage 4 — Släpp poster med lågt värde med en `filter`-processor

När du vill ha mottagaren men inte all dess utdata, lägg till en [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor)-processor — den utvärderar ett [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md)-villkor och **släpper varje post som matchar**, innan något exporteras.

Släpp loggar under en allvarlighetströskel:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Släpp allt som är mindre allvarligt än WARN (info, debug, trace).
        # UNSPECIFIED-skyddet krävs — se varningen nedan.
        - "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_WARN"
```

> **Ta inte bort `UNSPECIFIED`-skyddet.** `SEVERITY_NUMBER_UNSPECIFIED` är `0` och `SEVERITY_NUMBER_WARN` är `13`, så ett naket `severity_number < SEVERITY_NUMBER_WARN` blir `0 < 13` — **sant för varje post vars allvarlighetsgrad aldrig tolkades**. En vanlig `filelog`-mottagare tolkar inte fram någon allvarlighetsgrad ur loggraden: inget av den här sidans `filelog`-exempel sätter `operators:`, så de posterna anländer till filtret med `severity_number: 0`. Utan skyddet raderar det villkoret tyst **100 % av** `/var/log/syslog`, `/var/log/messages` och `/var/log/auth.log` — utan något felmeddelande någonstans. Med skyddet behålls oklassificerade poster och du kommer att se dem anlända i OneUptime med allvarlighetsgraden `Unspecified`, vilket talar om för dig att det du egentligen behöver är en allvarlighetsgradstolk.

För att filtrera filloggar efter allvarlighetsgrad *ordentligt*, tolka först fram en allvarlighetsgrad med en [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md)-operator på mottagaren, så att posterna bär en riktig nivå innan de når filtret:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    operators:
      # Plocka ut en nivå ur rader som "2026-01-01 ERROR something broke".
      - type: regex_parser
        regex: '(?i)(?P<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)'
        parse_from: body
        # Rader utan igenkännbar nivå faller igenom otolkade i stället för
        # att kastas bort, och behålls sedan av skyddet ovan.
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        preset: default
        mapping:
          warn: warning
          error: err
          fatal: panic
```

På systemd-värdar behöver du inget av detta — `journald`s `priority:` (Reglage 1) filtrerar efter nivå i `journalctl` självt, innan någon OTel-post existerar.

Släpp metriker som du inte visar i något diagram — exakt namn, eller ett mönster:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        # Exakt metriknamn.
        - 'name == "system.paging.faults"'
        # Eller en hel familj. IsMatch är RE2 och OFÖRANKRAD, så förankra
        # den själv med ^ när du menar "börjar med".
        - 'IsMatch(name, "^system\\.paging\\.")'
```

Skicka **endast** en fast uppsättning metriker (en tillåtelselista) genom att invertera villkoret — `filter` släpper det som matchar, så `not (...)` släpper allt du inte namngav:

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

Håll det villkoret på **en rad**. En tillåtelselista är en trubbig slägga: allt du glömmer att namnge är borta, tillsammans med de monitorer som byggts på det. Föredra att släppa de få metriker du inte vill ha, eller att helt enkelt utelämna skraparen som producerar dem (Reglage 3) — en metrik som aldrig samlas in kostar ingenting att filtrera.

Lägg sedan till processorn i den relevanta pipelinen — ordningen spelar roll, så placera `filter` före `batch`:

```yaml
service:
  pipelines:
    logs:
      receivers: [journald]
      processors: [filter/drop-low-severity, resource, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [hostmetrics]
      processors: [filter/drop-metrics, resource, batch]
      exporters: [otlphttp]
```

> **Redigerar du konfigurationen som OneUptime genererade åt dig?** Pipelinen ovan matchar de kompletta exemplen på den här sidan. Konfigurationen från instrumentpanelen (Hosts → Documentation) namnger saker annorlunda: dess processorer är `resourcedetection` och `batch` (det finns **ingen** `resource`-processor) och dess exportör är `otlphttp/oneuptime`. Att referera till en processor som inte är definierad stoppar collectorn vid start med `references processor "resource" which is not configured`. Lägg till filtret i det som redan finns i stället för att klistra in det här blocket över det:
>
> ```yaml
> service:
>   pipelines:
>     metrics:
>       receivers: [hostmetrics]
>       processors: [filter/drop-metrics, resourcedetection, batch]
>       exporters: [otlphttp/oneuptime]
> ```
>
> Behåll `resourcedetection` — OneUptime matchar telemetri mot en värd med hjälp av `host.name` / `host.id` som den sätter. Den genererade konfigurationen är också **enbart metriker**: den har ingen `logs:`-pipeline förrän du lägger till en, så en `filter/drop-low-severity` har inget att filtrera förrän du lägger till en `filelog`- eller `journald`-mottagare vid sidan av den.

> **På macOS, använd tarballen, inte Homebrew.** Homebrew-formeln levererar **core**-collectorn, och `filter` är en processor som bara finns i contrib — collectorn kommer att vägra starta oavsett om din YAML är korrekt eller inte.

### En slimmad utgångspunkt

En värd med **enbart metriker** — inga loggar, grovt intervall, inga serier per process — är det minsta användbara fotavtrycket:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

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
```

Lägg tillbaka en `logs`-pipeline med en snävt avgränsad `filelog`- eller `journald`-mottagare när du behöver det.

> **Var försiktig med vad du skär bort.** Loggbaserade larm behöver att loggarna kommer fram: om du filtrerar bort en allvarlighetsgrad eller en kanal tystnar monitorer som utgår från den. Trimma de källor du inte agerar på, inte de som en monitor bevakar. Ändra ett reglage i taget och bekräfta minskningen under **Project Settings → Usage History** (användning aggregeras dagligen, så ge det en dag eller två) innan du går vidare till nästa.

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
  - **Windows:** titta under _Event Viewer → Windows Logs → Application_ efter källan `otelcol-contrib`.
  - Bekräfta att värden kan nå `https://oneuptime.com/otlp` (eller din självhostade slutpunkt): `curl -v https://oneuptime.com/otlp` från samma maskin.
- **HTTP 401 från exportören** — inmatningstoken är ogiltig eller återkallad. Generera en ny från _Project Settings → Telemetry Ingestion Keys_.
- **Windows Event Log `Security` returnerar access denied** — tjänsten körs inte med tillräckliga behörigheter. Återskapa den under `LocalSystem` (standard med `sc.exe create`) eller ge tjänstkontot användarrättigheten _Manage auditing and security log_.
- **`journald`-mottagaren misslyckas med att starta** — se till att `journalctl` finns i collectorns `PATH` och att `/var/log/journal` existerar (kör `sudo systemd-tmpfiles --create --prefix /var/log/journal` om inte).
- **Hög volym / kostnad** — se [Minska volymen av insamlad data](#minska-volymen-av-insamlad-data): begränsa mottagarna (specifika Windows-kanaler, specifika systemd-enheter, specifika loggfiler), höj metrikernas `collection_interval`, ta bort skraparen per process eller lägg till en `filter`-processor för att släppa poster med låg allvarlighetsgrad före export.

## Nästa steg

- Lägg till **Logs Monitors** för att larma om specifika loggmönster (till exempel larma när mer än 5 misslyckade inloggningar med `winlog.event_id = 4625` inträffar inom ett 5-minutersfönster).
- Lägg till **Metrics Monitors** på värdmetriker (CPU-mättnad, lågt diskutrymme, swap-användning).
- Kombinera detta med [Server / VM Monitor](/docs/monitor/server-monitor) och [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) för end-to-end-värdsynlighet.
- Skicka samma konfiguration till varje värd via Ansible / Chef / Puppet / Group Policy / Intune / din befintliga konfigurationshanteringsverktygskedja.
