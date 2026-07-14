# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Oversigt

Du kan køre **OpenTelemetry Collector** som en tjeneste direkte på dine Linux-, macOS- eller Windows-hosts for at sende host-telemetri til OneUptime over OTLP. Denne side gennemgår, hvordan du installerer collectoren, konfigurerer den til hvert operativsystem og vælger de rigtige receivere til det, du vil indsamle:

- **Host-metrikker** (CPU, hukommelse, disk, filsystem, netværk, load, processer) på alle operativsystemer
- **Filbaserede logs** under `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor), der indkapsler et tailed `log stream`-output
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-tjenestestatus** (driver host-fanen **Services**) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — medleveres i upstream-`otelcol-contrib`-buildet fra **v0.155.0** og frem (se "Windows Services (metrikker)" nedenfor)

> **Hvad med OneUptime Infrastructure Agent?** Den agent er en separat, letvægts Go-dæmon med fokus på grundlæggende metrikker og funktionen _Server / VM Monitor_ (status, processer, alarmering). Den OpenTelemetry Collector, der beskrives her, er uafhængig og er det rette værktøj, når du ønsker logs (filbaserede logs, journald, Windows Event Logs) eller rigere host-metrikker indsamlet som standard OTLP. Begge kan køre på den samme host uden at forstyrre hinanden.

## Forudsætninger

- Et **OneUptime Telemetry Ingestion Token** — opret et fra _Project Settings → Telemetry Ingestion Keys_ og kopiér værdien `x-oneuptime-token`.
- Distributionen **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Standard-`otelcol`-buildet inkluderer **ikke** receivere som `windowseventlogreceiver`, `journaldreceiver` eller `hostmetrics`-ekstraer — sørg for at bruge `contrib`-distributionen. Alpha-receiveren `windowsservicereceiver`, som driver Windows-fanen **Services**, medleveres i `otelcol-contrib` fra **v0.155.0** og frem, så installér en aktuel udgivelse; se "Windows Services (metrikker)" nedenfor.
- Root / Administrator på hosten for at installere collectoren som en tjeneste og (hvor det er relevant) læse privilegerede logkilder.

## Trin 1 — Installér OpenTelemetry Collector

Vælg afsnittet for dit operativsystem. Alle eksempler antager, at du installerer den nyeste `otelcol-contrib`-udgivelse fra [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian-pakken installerer binæren på `/usr/bin/otelcol-contrib`, standardkonfigurationen på `/etc/otelcol-contrib/config.yaml` og en systemd-unit på `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Stier matcher Debian-pakken (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-unit `otelcol-contrib`).

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

Du opretter `/etc/otelcol-contrib/config.yaml` i Trin 2 og en `launchd`-plist i Trin 3.

### Windows

På Windows skal du downloade upstream-**`otelcol-contrib`**-udgivelsen — den medleverer `windows_service`-receiveren, der driver host-fanen **Services** (fra **v0.155.0** og frem). Fra en **forhøjet** PowerShell-prompt:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

Dette udpakker `otelcol-contrib.exe` til `C:\Program Files\otelcol-contrib`. Du opretter `config.yaml` i den samme mappe i Trin 2 og registrerer en Windows-tjeneste i Trin 3.

> Foretrækker du et native installeringsprogram? OpenTelemetry publicerer også en signeret **`.msi`** (`otelcol-contrib_<version>_windows_x64.msi`) på den samme [udgivelsesside](https://github.com/open-telemetry/opentelemetry-collector-releases/releases), som registrerer collectoren som en Windows-tjeneste for dig. Hvis du bruger den, skal du pege den mod `config.yaml` fra Trin 2 og sørge for, at tjenesten kører som `LocalSystem`, så fanen **Services** kan læse Service Control Manager.

## Trin 2 — Konfigurér collectoren

Konfigurationsfilen ligger på:

| OS      | Sti                                                   |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

Hver konfiguration følger den samme form — vælg de receivere, du vil have, tilføj en `batch`- og `resource`-processor, og eksportér til OneUptime over OTLP HTTP. Eksemplerne nedenfor viser en komplet konfiguration, der kan kopieres og indsættes, pr. operativsystem, og gennemgår derefter hver receiver-blok, så du kan kombinere efter behov.

Erstat `YOUR_TELEMETRY_INGESTION_TOKEN` og `service.name`-værdien, så de passer til dit miljø.

### Fælles dele (bruges af alle operativsystemer)

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

- **`batch`** grupperer poster før eksport, så du ikke betaler én HTTP-rundtur pr. post.
- **`resource`** stempler hver post med `service.name`. Brug en forskellig værdi pr. host (f.eks. `prod-web-01`), hvis du vil have hver maskine til at fremstå som sin egen telemetri-tjeneste i OneUptime.
- **`otlphttp`** sender til OneUptime over HTTPS med ingestion-tokenet vedhæftet.

### Host-metrikker (Linux, macOS, Windows)

Virker på alle operativsystemer. Henter CPU-, hukommelses-, disk-, filsystem-, netværks-, load-, paging- og procesmetrikker fra host-kernen:

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

> På Linux læser collectoren `/proc` og `/sys`. Når collectoren kører i en container, skal du montere hostens `/proc` og `/sys` og sætte miljøvariablerne `HOST_PROC` / `HOST_SYS`. Når den kører direkte som en systemd-tjeneste (som installeret ovenfor), kræves ingen ekstra opsætning.

### Filbaserede logs (Linux, macOS)

Tail enhver logfil på disken. Nedenfor er et almindeligt startsæt:

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

`start_at: end` betyder nye linjer fra det øjeblik, collectoren starter; skift til `beginning` for at indhente ved første kørsel. Collectoren holder styr på file-offsets, så den genoptager korrekt på tværs af genstarter.

**Omdannelse af host-log-stack traces til Exceptions.** OneUptime scanner automatisk error- og fatal-loglinjer for stack traces og samler dem op i visningen **Exceptions** (Issues), tilskrevet denne host — ingen ekstra konfiguration nødvendig. For at dette grupperes godt, skal en flerliniet stack trace (Java, Python, .NET, Ruby) ankomme som **én** logpost, ikke én post pr. linje. Aktivér multiline-rekombination på `filelog`-receiveren, så en trace og dens frames forbliver samlet:

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

Uden rekombination indsamles hver frame som en separat log, og undtagelsen vil fremstå som et enliniet, dårligt grupperet issue. Hvis din applikation kan udsende OpenTelemetry-log-attributterne `exception.type` / `exception.message` / `exception.stacktrace` direkte, så gør det i stedet — det er den mest pålidelige vej og er uafhængig af multiline-parsing.

### systemd journal (Linux)

Hvis din host bruger systemd, er `journald`-receiveren ofte et bedre valg end at tail'e `/var/log/*` — den indfanger alt ét sted og bevarer strukturerede felter:

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

Collector-binæren skal kunne eksekvere `journalctl` (Debian- / RPM-pakkerne inkluderer det allerede som en afhængighed).

### Apple Unified Log (macOS)

macOS udfasede `/var/log/system.log` til fordel for Apple Unified Log, der forespørges med `log show` / `log stream`. Den enkleste måde at indsamle den på er at streame `log`-output via `filelog`-receiveren med en lille wrapper. Opret `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Gør den eksekverbar, kør den under launchd (eller `nohup` til en hurtig test), og peg derefter collectoren mod filen:

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

(Hvis du ikke har brug for den samlede log, så spring dette over — Mac-flåder kører ofte fint med blot host-metrikker + nogle få filbaserede logs.)

### Windows Event Logs

Abonnér på de kanaler, du bekymrer dig om, via den indbyggede `wevtapi`:

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

For at indsnævre den højvolumen-`Security`-kanal til specifikke event-ID'er:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

For at læse en brugerdefineret eller applikationsspecifik kanal (alt, hvad du kan se under _Event Viewer → Applications and Services Logs_), skal du bruge dens nøjagtige visningsnavn:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (metrikker)

Host-fanen **Services** drives af [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (config-typen `windows_service`), som rapporterer den kørende tilstand og opstartstype for Windows-tjenester som metrikker.

**Denne receiver medleveres i upstream-`otelcol-contrib`-binæren fra v0.155.0 og frem** — på tidligere udgivelser fejler tilføjelse af `windows_service` ved opstart med `'receivers' unknown type: "windows_service"`. Installér en aktuel udgivelse (Trin 1), aktivér den derefter i din `config.yaml`, og tilføj den til metrik-pipelinen:

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

Receiveren udsender én `windows.service.status`-gauge pr. tjeneste — heltallet er Win32-tjenestetilstanden (`4` = kører, `1` = stoppet) — med `name`- og `startup_mode`-attributter. Kør collectoren som `LocalSystem` (`sc.exe`-standarden), så den kan læse hver tjeneste; enhver, den ikke kan åbne, springes over. Receiveren er **alpha** og **kun til Windows**; kendte problemer inkluderer en scrape-fejl, der kan få collectoren til at gå ned, og en `access denied` på én tjeneste, der påvirker andre — begræns til `include_services`, hvis du støder på dem.

> **`include_services` har ingen effekt?** Filteret kan kun nogensinde *indsnævre* mængden, så hvis du angiver tjenester og stadig ser dem alle, er den redigerede konfiguration næsten helt sikkert ikke nået frem til den kørende collector. Genstart tjenesten efter redigering (Trin 3); sørg for, at `include_services` er en udfyldt liste med samme indrykning som `collection_interval` (ikke ladt udkommenteret eller tom); og giv fanen **Services** et par minutter, så tjenester, der blev rapporteret før ændringen, ældes ud af dens rullende vindue. Navnene er nøjagtige, versalfølsomme Windows-tjeneste-_nøgle_navne (f.eks. `Spooler`, `W3SVC`), som du kan liste med `Get-Service | Select-Object Name`.

### Komplet eksempel — Linux-host

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

### Komplet eksempel — macOS-host

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

### Komplet eksempel — Windows-host

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

## Trin 3 — Kør collectoren som en tjeneste

### Linux (systemd)

Debian- / RPM-pakkerne installerer allerede en systemd-unit. Aktivér og start den blot:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

For at følge collectorens egne logs:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Opret `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Indlæs den:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Fra en **forhøjet** PowerShell-prompt:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Tjenesten kører som standard under `LocalSystem`, som har de privilegier, der kræves for at læse `Security`-kanalen i Windows Event Log.

## Trin 4 — Verificér i OneUptime

1. Generér noget signal på hosten:
   - **Linux / macOS:** `logger "hello from oneuptime"` (skriver til syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` fra en forhøjet prompt.
2. I OneUptime-dashboardet skal du åbne **Telemetry → Services** og vælge den `service.name`, du konfigurerede.
3. Åbn **Metrics** — host-metrikker (CPU, hukommelse, filsystem osv.) bør vises inden for et minut.
4. Åbn **Logs** — dine filbaserede logs / journald-poster / Windows Event Logs bør streame ind. Nyttige søgbare attributter inkluderer `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` og `winlog.provider.name`.

## Reduktion af mængden af indsamlede data

Fordi du selv ejer collector-konfigurationen, bestemmer du præcis, hvad der forlader hosten — intet indsamles, medmindre en receiver, du har tilføjet, beder om det. Hvis en host sender mere, end du ønsker (hvilket viser sig som højere ingest-volumen og, på OneUptime Cloud, højere omkostning), så justér det her. De to største løftestænger er **hvilke logkilder du tail'er** og **hvor ofte du scraper metrikker**; en `filter`-processor klarer resten.

Princippet er det samme som selve konfigurationen: **tilføj kun de receivere, hvis data du vil kigge på**, og skær derefter ind i dem. Hver ændring nedenfor er en redigering af `config.yaml` — anvend den, og genstart collectoren (Trin 3).

### Hvor volumen kommer fra

| Signal                  | Største kilde                                   | Skru ned med                                                              |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| **Logs**                | Hver linje fra hver fil / journald-unit / kanal | Indsnævr receivere; `query:`-filtre; en `filter`-processor på alvorlighed |
| **Host-metrikker**      | Scrape-frekvens × antal serier                  | `collection_interval`; drop `process`-scraperen; scraper-valg             |
| **Metrik-kardinalitet** | Per-proces-metrikker (ét sæt serier pr. proces) | Udelad eller afgræns `process`-scraperen                                  |

### Løftestang 1 — Tail kun de logkilder, du har brug for

Logs er næsten altid den største andel. Collectoren læser kun det, du angiver, så løsningen er at angive mindre:

- **Filer** — peg `filelog` mod specifikke stier, ikke brede globs. `/var/log/myapp/error.log` i stedet for `/var/log/**`.
- **journald** — begræns `units:` til de tjenester, du bekymrer dig om, og hæv `priority:`, så du dropper snakkesalige `info`/`debug`-poster ved kilden:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — `Security`-kanalen har langt det højeste volumen. Indsnævr den til de event-ID'er, du faktisk auditerer, med et `query:` (som vist i [Windows Event Logs](#windows-event-logs) ovenfor), eller drop kanalen helt, hvis du ikke har brug for den.

### Løftestang 2 — Sænk metrik-frekvensen

`hostmetrics`-volumen skalerer direkte med `collection_interval`. Hvis du ikke har brug for 30-sekunders opløsning, halverer 60s antallet af datapunkter:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Løftestang 3 — Drop per-proces-scraperen (kardinalitetsdriveren)

`process`-scraperen udsender et separat sæt serier **for hver kørende proces** på hosten — på en travl maskine er det den enkeltstørste kilde til metrik-kardinalitet. Medmindre du har brug for CPU/hukommelse pr. proces, så lad den være ude af `scrapers:`-listen. Behold `processes` (som blot er en håndfuld aggregerede metrikker for procesantal) — den er billig. Hvis du alligevel ønsker per-proces-metrikker, så afgræns dem til de processer, der betyder noget:

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

### Løftestang 4 — Drop poster med lav værdi med en `filter`-processor

Når du vil have receiveren, men ikke hele dens output, så tilføj en [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor)-processor — den evaluerer en [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md)-betingelse og **dropper enhver post, der matcher**, før noget eksporteres.

Drop logs under en alvorlighedstærskel:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

Drop en specifik støjende metrik, du ikke laver diagrammer over:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

Tilføj derefter processoren til den relevante pipeline — rækkefølgen betyder noget, så placér `filter` før `batch`:

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

### Et slankt udgangspunkt

En **kun-metrikker**-host — ingen logs, groft interval, ingen per-proces-serier — er det mindste nyttige fodaftryk:

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

Tilføj en `logs`-pipeline igen med en snævert afgrænset `filelog`- eller `journald`-receiver, når du har brug for det.

> **Pas på, hvad du skærer væk.** Log-baserede alarmer kræver, at logsene ankommer: hvis du filtrerer en alvorlighed eller en kanal fra, forstummer de monitorer, der nøgles på den. Skær de kilder væk, du ikke handler på, ikke dem, en monitor overvåger. Ændr én løftestang ad gangen, og bekræft faldet under **Project Settings → Usage History** (forbruget aggregeres dagligt, så giv det en dag eller to), før du går videre til den næste.

## Selvhostet OneUptime

Hvis du selv hoster OneUptime, skal du pege eksportøren mod din egen host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Hvis din instans kun er HTTP, skal du ændre skemaet til `http://` og bruge den relevante port.

## Bag en proxy

OpenTelemetry Collector respekterer standard-miljøvariablerne `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Sæt dem på tjenesten:

- **systemd (Linux):** drop ind `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` med `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, og derefter `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** tilføj en `<EnvironmentVariables>`-dict til plisten.
- **Windows-tjeneste:** sæt miljøvariabler på tjenesten via `sc.exe config` eller registreringsdatabasen under `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Fejlfinding

- **Ingen telemetri vises i OneUptime**
  - Tilføj `service.telemetry.logs.level: debug` til konfigurationen, og genstart collectoren for udførligt output.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) eller `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** kig under _Event Viewer → Windows Logs → Application_ efter kilden `otelcol-contrib`.
  - Bekræft, at hosten kan nå `https://oneuptime.com/otlp` (eller dit selvhostede endpoint): `curl -v https://oneuptime.com/otlp` fra den samme maskine.
- **HTTP 401 fra eksportøren** — ingestion-tokenet er ugyldigt eller tilbagekaldt. Generér et nyt fra _Project Settings → Telemetry Ingestion Keys_.
- **`Security` Windows Event Log returnerer access denied** — tjenesten kører ikke med tilstrækkelige privilegier. Genopret den under `LocalSystem` (standarden med `sc.exe create`), eller tildel tjenestekontoen brugerrettigheden _Manage auditing and security log_.
- **`journald`-receiveren undlader at starte** — sørg for, at `journalctl` er på collectorens `PATH`, og at `/var/log/journal` eksisterer (kør `sudo systemd-tmpfiles --create --prefix /var/log/journal`, hvis ikke).
- **Højt volumen / omkostning** — se [Reduktion af mængden af indsamlede data](#reducing-the-volume-of-data-collected): indsnævr receiverne (specifikke Windows-kanaler, systemd-units, logfiler), hæv metrikkernes `collection_interval`, drop per-proces-scraperen, eller tilføj en `filter`-processor for at droppe poster med lav alvorlighed før eksport.

## Næste trin

- Tilføj **Logs Monitors** for at alarmere på specifikke logmønstre (alarmér f.eks., når der forekommer mere end 5 `winlog.event_id = 4625` mislykkede logons i et 5-minutters vindue).
- Tilføj **Metrics Monitors** på host-metrikker (CPU-mætning, lav diskplads, swap-forbrug).
- Kombinér dette med [Server / VM Monitor](/docs/monitor/server-monitor) og [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) for end-to-end host-synlighed.
- Send den samme konfiguration til hver host via Ansible / Chef / Puppet / Group Policy / Intune / dit eksisterende konfigurationsstyringsværktøj.
