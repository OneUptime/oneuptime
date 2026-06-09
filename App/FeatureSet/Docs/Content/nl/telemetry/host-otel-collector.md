# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Overzicht

Je kunt de **OpenTelemetry Collector** als service rechtstreeks op je Linux-, macOS- of Windows-hosts draaien om host-telemetrie via OTLP naar OneUptime te versturen. Deze pagina leidt je door het installeren van de collector, het configureren ervan voor elk besturingssysteem en het kiezen van de juiste receivers voor wat je wilt verzamelen:

- **Host-metrieken** (CPU, geheugen, schijf, bestandssysteem, netwerk, belasting, processen) op elk besturingssysteem
- **Bestandsgebaseerde logs** onder `/var/log/**` (Linux, macOS) via de [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) via de [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) via de [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) die een getailde `log stream`-uitvoer omhult
- **Windows Event Logs** via de [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Windows-servicestatus** (voedt het host-tabblad **Services**) via de [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver)

> **Hoe zit het met de OneUptime Infrastructure Agent?** Die agent is een afzonderlijke, lichtgewicht Go-daemon die gericht is op basismetrieken en de functie *Server / VM Monitor* (status, processen, waarschuwingen). De hier beschreven OpenTelemetry Collector staat los daarvan en is het juiste hulpmiddel wanneer je logs (bestandslogs, journald, Windows Event Logs) of rijkere host-metrieken wilt opnemen als standaard-OTLP. Beide kunnen op dezelfde host draaien zonder elkaar te storen.

## Vereisten

- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via *Project Settings → Telemetry Ingestion Keys* en kopieer de waarde van `x-oneuptime-token`.
- De **OpenTelemetry Collector Contrib**-distributie (`otelcol-contrib`). De standaard `otelcol`-build bevat **geen** receivers zoals `windowseventlogreceiver`, `journaldreceiver` of `hostmetrics`-extra's — zorg ervoor dat je de `contrib`-distributie gebruikt.
- Root / Administrator op de host om de collector als service te installeren en (waar van toepassing) bevoorrechte logbronnen te lezen.

## Stap 1 — Installeer de OpenTelemetry Collector

Kies de sectie voor jouw besturingssysteem. Alle voorbeelden gaan ervan uit dat je de nieuwste `otelcol-contrib`-release installeert vanaf [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.107.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Het Debian-pakket installeert de binary op `/usr/bin/otelcol-contrib`, de standaardconfiguratie op `/etc/otelcol-contrib/config.yaml` en een systemd-unit op `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.107.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

De paden komen overeen met het Debian-pakket (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd-unit `otelcol-contrib`).

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.107.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

Je maakt `/etc/otelcol-contrib/config.yaml` in Stap 2 en een `launchd`-plist in Stap 3.

### Windows

Download de nieuwste `otelcol-contrib_*_windows_amd64.zip` (of `arm64`) van de [releasespagina](https://github.com/open-telemetry/opentelemetry-collector-releases/releases). Vanuit een **verhoogde** PowerShell-prompt:

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

Je maakt `C:\Program Files\otelcol-contrib\config.yaml` in Stap 2 en registreert een Windows-service in Stap 3.

## Stap 2 — Configureer de collector

Het configuratiebestand staat op:

| OS | Pad |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

Elke configuratie volgt dezelfde vorm — kies de receivers die je wilt, voeg een `batch`- en `resource`-processor toe en exporteer naar OneUptime via OTLP HTTP. De onderstaande voorbeelden tonen een complete, kopieer-en-plak-klare configuratie per besturingssysteem, en lopen vervolgens elk receiverblok door zodat je naar believen kunt combineren.

Vervang `YOUR_TELEMETRY_INGESTION_TOKEN` en de waarde van `service.name` zodat ze bij jouw omgeving passen.

### Gemeenschappelijke onderdelen (gebruikt door elk besturingssysteem)

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

- **`batch`** groepeert records vóór de export, zodat je niet één HTTP-rondreis per record betaalt.
- **`resource`** stempelt elk record met `service.name`. Gebruik een andere waarde per host (bijv. `prod-web-01`) als je wilt dat elke machine als zijn eigen telemetrieservice in OneUptime verschijnt.
- **`otlphttp`** verstuurt naar OneUptime via HTTPS met het ingestion-token erbij gevoegd.

### Host-metrieken (Linux, macOS, Windows)

Werkt op elk besturingssysteem. Pikt CPU-, geheugen-, schijf-, bestandssysteem-, netwerk-, belasting-, paging- en procesmetrieken op uit de host-kernel:

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

> Op Linux leest de collector `/proc` en `/sys`. Wanneer de collector in een container draait, mount je de `/proc` en `/sys` van de host en stel je de omgevingsvariabelen `HOST_PROC` / `HOST_SYS` in. Wanneer hij rechtstreeks als systemd-service draait (zoals hierboven geïnstalleerd), is er geen extra configuratie nodig.

### Bestandslogs (Linux, macOS)

Tail elk logbestand op schijf. Hieronder staat een veelgebruikte startset:

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

`start_at: end` betekent nieuwe regels vanaf het moment dat de collector start; verander naar `beginning` om bij de eerste run aan te vullen. De collector houdt bestands-offsets bij, dus hij hervat correct na herstarts.

**Stacktraces van host-logs omzetten in Exceptions.** OneUptime scant automatisch fout- en fatale logregels op stacktraces en bundelt ze in de weergave **Exceptions** (Issues), toegeschreven aan deze host — geen extra configuratie nodig. Om dit goed te laten groeperen, moet een meerregelige stacktrace (Java, Python, .NET, Ruby) als **één** logrecord binnenkomen, niet als één record per regel. Schakel meerregelige hercombinatie in op de `filelog`-receiver zodat een trace en zijn frames bij elkaar blijven:

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

Zonder hercombinatie wordt elk frame als een afzonderlijk log opgenomen en verschijnt de exception als een eenregelig, slecht gegroepeerd issue. Als je applicatie de OpenTelemetry-logattributen `exception.type` / `exception.message` / `exception.stacktrace` rechtstreeks kan uitzenden, doe dat dan in plaats daarvan — dat is het betrouwbaarste pad en is onafhankelijk van meerregelig parsen.

### systemd journal (Linux)

Als je host systemd gebruikt, past de `journald`-receiver vaak beter dan het tailen van `/var/log/*` — hij legt alles op één plek vast en behoudt gestructureerde velden:

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

De collector-binary moet `journalctl` kunnen uitvoeren (de Debian- / RPM-pakketten bevatten het al als afhankelijkheid).

### Apple Unified Log (macOS)

macOS heeft `/var/log/system.log` afgeschaft ten gunste van de Apple Unified Log, die wordt opgevraagd met `log show` / `log stream`. De eenvoudigste manier om deze op te nemen is om de `log`-uitvoer te streamen via de `filelog`-receiver met een kleine wrapper. Maak `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Maak het uitvoerbaar, draai het onder launchd (of `nohup` voor een snelle test) en wijs de collector dan naar het bestand:

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

(Als je de unified log niet nodig hebt, sla dit dan over — Mac-vloten draaien vaak prima met alleen host-metrieken + een paar bestandslogs.)

### Windows Event Logs

Abonneer je op de kanalen waar je om geeft via de native `wevtapi`:

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

Om het volumineuze `Security`-kanaal te beperken tot specifieke event-ID's:

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Om een aangepast of applicatiespecifiek kanaal te lezen (alles wat je kunt zien onder *Event Viewer → Applications and Services Logs*), gebruik je de exacte weergavenaam ervan:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (metrieken)

Rapporteer de actieve status en het opstarttype van Windows-services via de [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver). Dit is wat het tabblad **Services** op de host in OneUptime vult. Het is een *metrieken*-receiver, dus hij hoort in de metrieken-pipeline (niet logs):

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
```

De receiver zendt één `windows.service.status`-gauge per service uit — de integer is de Win32-servicestatus (`4` = actief, `1` = gestopt) — met de attributen `name` en `startup_mode`. Hij is **alleen voor Windows** (de collector start niet als je hem op Linux of macOS inschakelt) en is momenteel **alpha**, dus pin een recente `otelcol-contrib`-release. Door de service als `LocalSystem` te draaien (de standaard met `sc.exe create`) kan hij elke service lezen.

### Volledig voorbeeld — Linux-host

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

### Volledig voorbeeld — macOS-host

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

### Volledig voorbeeld — Windows-host

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
      # 'load' is not supported on Windows — omit it or the scraper errors.
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

## Stap 3 — Draai de collector als service

### Linux (systemd)

De Debian- / RPM-pakketten installeren al een systemd-unit. Schakel hem gewoon in en start hem:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Om de eigen logs van de collector te volgen:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Maak `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Laad het:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Vanuit een **verhoogde** PowerShell-prompt:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

De service draait standaard onder `LocalSystem`, dat de rechten heeft die nodig zijn om het `Security`-kanaal van de Windows Event Log te lezen.

## Stap 4 — Verifieer in OneUptime

1. Genereer wat signaal op de host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (schrijft naar syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` vanuit een verhoogde prompt.
2. Open in het OneUptime-dashboard **Telemetry → Services** en kies de `service.name` die je hebt geconfigureerd.
3. Open **Metrics** — host-metrieken (CPU, geheugen, bestandssysteem, enz.) zouden binnen een minuut moeten verschijnen.
4. Open **Logs** — je bestandslogs / journald-vermeldingen / Windows Event Logs zouden moeten binnenstromen. Nuttige doorzoekbare attributen zijn onder andere `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` en `winlog.provider.name`.

## Zelf-gehost OneUptime

Als je OneUptime zelf host, wijs de exporter dan naar je eigen host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Als je instantie alleen HTTP is, verander dan het schema naar `http://` en gebruik de juiste poort.

## Achter een proxy

De OpenTelemetry Collector respecteert de standaard omgevingsvariabelen `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Stel ze in op de service:

- **systemd (Linux):** plaats `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` met `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, en dan `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** voeg een `<EnvironmentVariables>`-dict toe aan de plist.
- **Windows-service:** stel omgevingsvariabelen in op de service via `sc.exe config` of het register onder `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Problemen oplossen

- **Er verschijnt geen telemetrie in OneUptime**
  - Voeg `service.telemetry.logs.level: debug` toe aan de configuratie en herstart de collector voor uitgebreide uitvoer.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) of `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** kijk onder *Event Viewer → Windows Logs → Application* voor de bron `otelcol-contrib`.
  - Bevestig dat de host `https://oneuptime.com/otlp` (of je zelf-gehoste endpoint) kan bereiken: `curl -v https://oneuptime.com/otlp` vanaf dezelfde machine.
- **HTTP 401 van de exporter** — het ingestion-token is ongeldig of ingetrokken. Genereer een nieuw token via *Project Settings → Telemetry Ingestion Keys*.
- **`Security` Windows Event Log geeft toegang geweigerd** — de service draait niet met voldoende rechten. Maak hem opnieuw aan onder `LocalSystem` (de standaard met `sc.exe create`) of verleen het serviceaccount het gebruikersrecht *Manage auditing and security log*.
- **`journald`-receiver start niet** — zorg ervoor dat `journalctl` op de `PATH` van de collector staat en dat `/var/log/journal` bestaat (voer `sudo systemd-tmpfiles --create --prefix /var/log/journal` uit als dat niet zo is).
- **Hoog volume / kosten** — beperk de receivers (specifieke Windows-kanalen, specifieke systemd-units, specifieke logbestanden), voeg een `query:`-filter toe op de Windows Event Log-receiver, of voeg een `filter`-processor toe om gebeurtenissen met lage ernst vóór de export te laten vallen.

## Volgende stappen

- Voeg **Logs Monitors** toe om te waarschuwen bij specifieke logpatronen (bijvoorbeeld waarschuwen wanneer er meer dan 5 mislukte aanmeldingen met `winlog.event_id = 4625` optreden binnen een venster van 5 minuten).
- Voeg **Metrics Monitors** toe op host-metrieken (CPU-verzadiging, weinig schijfruimte, swapgebruik).
- Combineer dit met de [Server / VM Monitor](/docs/monitor/server-monitor) en de [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) voor end-to-end host-zichtbaarheid.
- Verspreid dezelfde configuratie naar elke host via Ansible / Chef / Puppet / Group Policy / Intune / je bestaande configuratiebeheertools.
