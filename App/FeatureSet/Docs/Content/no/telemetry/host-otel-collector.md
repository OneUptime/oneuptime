# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Oversikt

Du kan kjore **OpenTelemetry Collector** som en tjeneste direkte pa Linux-, macOS- eller Windows-hostene dine for a sende host-telemetri til OneUptime over OTLP. Denne siden gar gjennom hvordan du installerer collectoren, konfigurerer den for hvert OS, og velger riktige receivere for det du vil samle inn:

- **Host-metrikker** (CPU, minne, disk, filsystem, nettverk, last, prosesser) pa alle OS
- **Filbaserte logger** under `/var/log/**` (Linux, macOS) via [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) som omslutter en tailet `log stream`-utdata
- **Windows Event Logs** via [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-tjenestestatus** (driver host-fanen **Services**) via [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — _ikke i den oppstroms forhandsbygde collectoren; bruk den forhandsbygde **OneUptime Host Collector** eller et egendefinert bygg (se "Windows Services (metrikker)" nedenfor)_

> **Hva med OneUptime Infrastructure Agent?** Den agenten er en separat, lettvekts Go-daemon som fokuserer pa grunnleggende metrikker og _Server / VM Monitor_-funksjonen (status, prosesser, varsling). OpenTelemetry Collector som er beskrevet her er uavhengig og er riktig verktoy nar du vil ha logger (filloggene, journald, Windows Event Logs) eller rikere host-metrikker ingestert som standard OTLP. Begge kan kjore pa samme host uten a forstyrre hverandre.

## Forutsetninger

- En **OneUptime Telemetry Ingestion Token** — opprett en fra _Project Settings → Telemetry Ingestion Keys_ og kopier `x-oneuptime-token`-verdien.
- **OpenTelemetry Collector Contrib**-distribusjonen (`otelcol-contrib`). Standard `otelcol`-bygget inkluderer **ikke** receivere som `windowseventlogreceiver`, `journaldreceiver` eller `hostmetrics`-tillegg — pass pa a bruke `contrib`-distribusjonen. Ett unntak verdt a vite om pa forhand: alpha-receiveren `windowsservicereceiver` (som driver Windows-fanen **Services**) er **ikke** buntet i den oppstroms forhandsbygde `contrib`-binaerfilen — bruk den forhandsbygde **OneUptime Host Collector** (som inkluderer den) eller bygg din egen; se "Windows Services (metrikker)" nedenfor.
- Root / Administrator pa hosten for a installere collectoren som en tjeneste og (der det er aktuelt) lese privilegerte loggkilder.

## Trinn 1 — Installer OpenTelemetry Collector

Velg seksjonen for ditt OS. Alle eksempler antar at du installerer den nyeste `otelcol-contrib`-utgaven fra [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian-pakken installerer binaerfilen pa `/usr/bin/otelcol-contrib`, standardkonfigurasjonen pa `/etc/otelcol-contrib/config.yaml`, og en systemd-enhet pa `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Stiene samsvarer med Debian-pakken (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-enhet `otelcol-contrib`).

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

Du oppretter `/etc/otelcol-contrib/config.yaml` i Trinn 2 og en `launchd`-plist i Trinn 3.

### Windows

Pa Windows installerer du **OneUptime Host Collector** — OneUptimes forhandsbygde collector som bunter med `windows_service`-receiveren (som driver host-fanen **Services** og _ikke_ finnes i det oppstroms `otelcol-contrib`-bygget). Fra en **forhoyet** PowerShell-ledetekst:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Du oppretter `C:\Program Files\OneUptimeHostCollector\config.yaml` i Trinn 2 og registrerer en Windows-tjeneste i Trinn 3.

> Foretrekker du det oppstroms `otelcol-contrib`? Last ned `otelcol-contrib_*_windows_amd64.zip` fra [OpenTelemetry-utgivelsessiden](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) i stedet — alt nedenfor fungerer pa samme mate, **bortsett fra** host-fanen **Services**, som krever `windows_service` (ikke i det oppstroms bygget; se "Windows Services (metrikker)").

## Trinn 2 — Konfigurer collectoren

Konfigurasjonsfilen ligger pa:

| OS      | Sti                                                   |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Hver konfigurasjon folger samme form — velg receiverne du vil ha, legg til en `batch`- og `resource`-prosessor, og eksporter til OneUptime over OTLP HTTP. Eksemplene nedenfor viser en komplett konfigurasjon som kan kopieres og limes inn per OS, og gar deretter gjennom hver receiver-blokk slik at du kan blande og matche.

Erstatt `YOUR_TELEMETRY_INGESTION_TOKEN` og `service.name`-verdien slik at de passer til ditt miljo.

### Felles deler (brukt av alle OS)

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

- **`batch`** grupperer poster for eksport slik at du ikke betaler en HTTP-rundtur per post.
- **`resource`** stempler hver post med `service.name`. Bruk en annen verdi per host (f.eks. `prod-web-01`) hvis du vil at hver maskin skal vises som sin egen telemetritjeneste i OneUptime.
- **`otlphttp`** sender til OneUptime over HTTPS med ingestion-tokenet vedlagt.

### Host-metrikker (Linux, macOS, Windows)

Fungerer pa alle OS. Henter CPU-, minne-, disk-, filsystem-, nettverks-, last-, paging- og prosessmetrikker fra host-kjernen:

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

> Pa Linux leser collectoren `/proc` og `/sys`. Nar collectoren kjorer i en container, monter hostens `/proc` og `/sys` og sett miljovariablene `HOST_PROC` / `HOST_SYS`. Nar den kjorer direkte som en systemd-tjeneste (som installert ovenfor), trengs ingen ekstra oppsett.

### Filloggene (Linux, macOS)

Tail hvilken som helst loggfil pa disk. Nedenfor er et vanlig startsett:

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

`start_at: end` betyr nye linjer fra det oyeblikket collectoren starter; endre til `beginning` for a fylle inn tilbake i tid ved forste kjoring. Collectoren sporer filforskyvninger, sa den gjenopptar korrekt pa tvers av omstarter.

**Gjore stack traces fra host-logger om til Exceptions.** OneUptime skanner automatisk error- og fatal-loggslinjer etter stack traces og ruller dem opp i visningen **Exceptions** (Issues), tilskrevet denne hosten — ingen ekstra konfigurasjon nodvendig. For at dette skal grupperes godt, ma en flerlinjet stack trace (Java, Python, .NET, Ruby) ankomme som **en** loggspost, ikke en post per linje. Aktiver flerlinjet rekombinasjon pa `filelog`-receiveren slik at en trace og rammene dens holdes sammen:

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

Uten rekombinasjon blir hver ramme ingestert som en separat logg, og unntaket vil vises som en enlinjet, darlig gruppert issue. Hvis applikasjonen din kan sende OpenTelemetry-loggsattributtene `exception.type` / `exception.message` / `exception.stacktrace` direkte, gjor det i stedet — det er den mest palitelige veien og er uavhengig av flerlinjeparsing.

### systemd journal (Linux)

Hvis hosten din bruker systemd, er `journald`-receiveren ofte et bedre valg enn a taile `/var/log/*` — den fanger alt pa ett sted og bevarer strukturerte felter:

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

Collector-binaerfilen ma kunne kjore `journalctl` (Debian- / RPM-pakkene inkluderer den allerede som en avhengighet).

### Apple Unified Log (macOS)

macOS avviklet `/var/log/system.log` til fordel for Apple Unified Log, som spores med `log show` / `log stream`. Den enkleste maten a ingestere den pa er a streame `log`-utdata via `filelog`-receiveren med en liten wrapper. Opprett `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Gjor den kjorbar, kjor den under launchd (eller `nohup` for en rask test), og pek deretter collectoren mot filen:

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

(Hvis du ikke trenger den samlede loggen, hopp over dette — Mac-flater kjorer ofte fint med bare host-metrikker + noen fa filloggene.)

### Windows Event Logs

Abonner pa kanalene du bryr deg om via det innebygde `wevtapi`:

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

For a innsnevre den hoyvolumiske `Security`-kanalen til spesifikke hendelses-ID-er:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

For a lese en egendefinert eller applikasjonsspesifikk kanal (alt du kan se under _Event Viewer → Applications and Services Logs_), bruk dens noyaktige visningsnavn:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (metrikker)

Host-fanen **Services** drives av [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (konfigtype `windows_service`), som rapporterer kjoretilstanden og oppstartstypen til Windows-tjenester som metrikker.

**OneUptime Host Collector (installert i Trinn 1, standarden pa Windows) inkluderer allerede denne receiveren.** Aktiver den i `config.yaml`-en din og legg den til i metrikk-pipelinen:

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

Receiveren sender ut en `windows.service.status`-gauge per tjeneste — heltallet er Win32-tjenestetilstanden (`4` = kjorer, `1` = stoppet) — med attributtene `name` og `startup_mode`. Kjor collectoren som `LocalSystem` (`sc.exe`-standarden) slik at den kan lese alle tjenester; de den ikke klarer a apne, hoppes over. Receiveren er **alpha** og **kun for Windows**; kjente problemer inkluderer en scrape-feil som kan krasje collectoren og en `access denied` pa en tjeneste som pavirker andre — begrens til `include_services` hvis du treffer pa dem.

#### Bruker du det oppstroms collectoren i stedet?

Det oppstroms forhandsbygde `otelcol-contrib`-binaerfilen inkluderer **ikke** `windowsservicereceiver` — a legge til `windows_service` feiler ved oppstart med `'receivers' unknown type: "windows_service"`, og **ingen versjonsoppgradering loser dette** (den finnes ikke i noe utgitt `otelcol-contrib`-bygg). Bytt enten til OneUptime Host Collector (Trinn 1), eller bygg din egen med [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — opprett `builder-config.yaml` (hold alle versjoner pa samme collector-utgave):

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

Kjor deretter den resulterende `otelcol-oneuptime.exe` og aktiver `windows_service` som vist ovenfor.

### Komplett eksempel — Linux-host

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

### Komplett eksempel — macOS-host

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

### Komplett eksempel — Windows-host

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

## Trinn 3 — Kjor collectoren som en tjeneste

### Linux (systemd)

Debian- / RPM-pakkene installerer allerede en systemd-enhet. Bare aktiver og start den:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

For a folge collectorens egne logger:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Opprett `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Last den inn:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Fra en **forhoyet** PowerShell-ledetekst:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

Tjenesten kjorer under `LocalSystem` som standard, som har privilegiene som trengs for a lese `Security`-kanalen i Windows Event Log.

## Trinn 4 — Verifiser i OneUptime

1. Generer noe signal pa hosten:
   - **Linux / macOS:** `logger "hello from oneuptime"` (skriver til syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` fra en forhoyet ledetekst.
2. I OneUptime-dashbordet, apne **Telemetry → Services** og velg `service.name`-en du konfigurerte.
3. Apne **Metrics** — host-metrikker (CPU, minne, filsystem osv.) bor vises innen et minutt.
4. Apne **Logs** — filloggene / journald-oppforingene / Windows Event Logs bor streame inn. Nyttige sokbare attributter inkluderer `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` og `winlog.provider.name`.

## Selvhostet OneUptime

Hvis du selvhoster OneUptime, pek eksportoren mot din egen host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Hvis instansen din kun er HTTP, endre skjemaet til `http://` og bruk passende port.

## Bak en proxy

OpenTelemetry Collector respekterer standardmiljovariablene `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Sett dem pa tjenesten:

- **systemd (Linux):** legg inn `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` med `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, deretter `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** legg til en `<EnvironmentVariables>`-dict i plisten.
- **Windows-tjeneste:** sett miljovariabler pa tjenesten via `sc.exe config` eller registret under `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Feilsoking

- **Ingen telemetri vises i OneUptime**
  - Legg til `service.telemetry.logs.level: debug` i konfigurasjonen og start collectoren pa nytt for detaljert utdata.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) eller `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** se under _Event Viewer → Windows Logs → Application_ etter kilden `otelcol-contrib`.
  - Bekreft at hosten kan na `https://oneuptime.com/otlp` (eller ditt selvhostede endepunkt): `curl -v https://oneuptime.com/otlp` fra samme maskin.
- **HTTP 401 fra eksportoren** — ingestion-tokenet er ugyldig eller tilbakekalt. Generer et nytt fra _Project Settings → Telemetry Ingestion Keys_.
- **`Security`-kanalen i Windows Event Log returnerer access denied** — tjenesten kjorer ikke med tilstrekkelige privilegier. Gjenopprett den under `LocalSystem` (standarden med `sc.exe create`) eller gi tjenestekontoen brukerrettigheten _Manage auditing and security log_.
- **`journald`-receiveren klarer ikke a starte** — pass pa at `journalctl` er pa collectorens `PATH` og at `/var/log/journal` finnes (kjor `sudo systemd-tmpfiles --create --prefix /var/log/journal` hvis ikke).
- **Hoyt volum / kostnad** — innsnevre receiverne (spesifikke Windows-kanaler, spesifikke systemd-enheter, spesifikke loggfiler), legg til et `query:`-filter pa Windows Event Log-receiveren, eller legg til en `filter`-prosessor for a slippe hendelser med lav alvorlighetsgrad for eksport.

## Neste trinn

- Legg til **Logs Monitors** for a varsle pa spesifikke loggmonstre (for eksempel, varsle nar mer enn 5 `winlog.event_id = 4625` mislykkede palogginger skjer innenfor et vindu pa 5 minutter).
- Legg til **Metrics Monitors** pa host-metrikker (CPU-metning, lite diskplass, swap-bruk).
- Kombiner dette med [Server / VM Monitor](/docs/monitor/server-monitor) og [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) for ende-til-ende host-synlighet.
- Send den samme konfigurasjonen til hver host via Ansible / Chef / Puppet / Group Policy / Intune / ditt eksisterende verktoy for konfigurasjonshandtering.
