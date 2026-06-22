# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Panoramica

Puoi eseguire l'**OpenTelemetry Collector** come servizio direttamente sui tuoi host Linux, macOS o Windows per inviare la telemetria dell'host a OneUptime tramite OTLP. Questa pagina ti guida nell'installazione del collector, nella sua configurazione per ciascun sistema operativo e nella scelta dei receiver giusti in base a ciò che vuoi raccogliere:

- **Metriche dell'host** (CPU, memoria, disco, filesystem, rete, carico, processi) su ogni sistema operativo
- **Log basati su file** sotto `/var/log/**` (Linux, macOS) tramite il [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **systemd journal** (Linux) tramite il [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) tramite il [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) che incapsula l'output di un `log stream` sottoposto a tailing
- **Windows Event Logs** tramite il [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Stato dei servizi Windows** (che alimenta la scheda **Services** dell'host) tramite il [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — *non incluso nel collector precompilato upstream; usa l'**OneUptime Host Collector** precompilato o una build personalizzata (vedi "Windows Services (metriche)" più avanti)*

> **E l'Infrastructure Agent di OneUptime?** Quell'agente è un daemon Go separato e leggero, focalizzato sulle metriche di base e sulla funzionalità *Server / VM Monitor* (stato, processi, alerting). L'OpenTelemetry Collector descritto qui è indipendente ed è lo strumento giusto quando vuoi log (log da file, journald, Windows Event Logs) o metriche dell'host più ricche acquisite come OTLP standard. Entrambi possono essere eseguiti sullo stesso host senza interferire.

## Prerequisiti

- Un **OneUptime Telemetry Ingestion Token** — creane uno da *Project Settings → Telemetry Ingestion Keys* e copia il valore `x-oneuptime-token`.
- La distribuzione **OpenTelemetry Collector Contrib** (`otelcol-contrib`). La build predefinita `otelcol` **non** include receiver come `windowseventlogreceiver`, `journaldreceiver` o gli extra di `hostmetrics` — assicurati di usare la distribuzione `contrib`. Un'eccezione da conoscere fin da subito: il `windowsservicereceiver` alpha (che alimenta la scheda Windows **Services**) **non** è incluso nel binario `contrib` precompilato upstream — usa l'**OneUptime Host Collector** precompilato (che lo include) oppure compila la tua build; vedi "Windows Services (metriche)" più avanti.
- Root / Administrator sull'host per installare il collector come servizio e (ove applicabile) leggere le sorgenti di log privilegiate.

## Passo 1 — Installa l'OpenTelemetry Collector

Scegli la sezione per il tuo sistema operativo. Tutti gli esempi presuppongono che tu stia installando l'ultima release `otelcol-contrib` da [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Il pacchetto Debian installa il binario in `/usr/bin/otelcol-contrib`, la configurazione predefinita in `/etc/otelcol-contrib/config.yaml` e un'unità systemd in `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

I percorsi corrispondono a quelli del pacchetto Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, unità systemd `otelcol-contrib`).

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

Creerai `/etc/otelcol-contrib/config.yaml` nel Passo 2 e un plist `launchd` nel Passo 3.

### Windows

Su Windows, installa l'**OneUptime Host Collector** — il collector precompilato di OneUptime che include il receiver `windows_service` (che alimenta la scheda **Services** dell'host e *non* è presente nella build `otelcol-contrib` upstream). Da un prompt PowerShell **con privilegi elevati**:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Creerai `C:\Program Files\OneUptimeHostCollector\config.yaml` nel Passo 2 e registrerai un servizio Windows nel Passo 3.

> Preferisci l'`otelcol-contrib` upstream? Scarica invece `otelcol-contrib_*_windows_amd64.zip` dalla [pagina delle release di OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) — tutto ciò che segue funziona allo stesso modo, **tranne** la scheda **Services** dell'host, che necessita di `windows_service` (non presente nella build upstream; vedi "Windows Services (metriche)").

## Passo 2 — Configura il collector

Il file di configurazione si trova in:

| Sistema operativo | Percorso |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Ogni configurazione segue la stessa struttura — scegli i receiver che desideri, aggiungi un processor `batch` e `resource` ed esporta verso OneUptime tramite OTLP HTTP. Gli esempi seguenti mostrano una configurazione completa e pronta da copiare e incollare per ciascun sistema operativo, quindi illustrano ogni blocco receiver in modo che tu possa combinarli a piacimento.

Sostituisci `YOUR_TELEMETRY_INGESTION_TOKEN` e il valore `service.name` per adattarli al tuo ambiente.

### Elementi comuni (usati da ogni sistema operativo)

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

- **`batch`** raggruppa i record prima dell'esportazione, così non paghi un round trip HTTP per ogni record.
- **`resource`** marca ogni record con `service.name`. Usa un valore diverso per ogni host (ad es. `prod-web-01`) se vuoi che ogni macchina appaia come un proprio servizio di telemetria in OneUptime.
- **`otlphttp`** invia a OneUptime tramite HTTPS con il token di ingestione allegato.

### Metriche dell'host (Linux, macOS, Windows)

Funziona su ogni sistema operativo. Raccoglie le metriche di CPU, memoria, disco, filesystem, rete, carico, paging e processi dal kernel dell'host:

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

> Su Linux, il collector legge `/proc` e `/sys`. Quando il collector viene eseguito in un container, monta i `/proc` e `/sys` dell'host e imposta le variabili d'ambiente `HOST_PROC` / `HOST_SYS`. Quando viene eseguito direttamente come servizio systemd (come installato sopra), non è necessaria alcuna configurazione aggiuntiva.

### Log da file (Linux, macOS)

Esegui il tailing di qualsiasi file di log su disco. Di seguito un insieme di partenza comune:

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

`start_at: end` significa nuove righe dal momento in cui il collector si avvia; cambia in `beginning` per recuperare i dati pregressi al primo avvio. Il collector tiene traccia degli offset dei file, quindi riprende correttamente dopo i riavvii.

**Trasformare le stack trace dei log dell'host in Exceptions.** OneUptime analizza automaticamente le righe di log di tipo error e fatal alla ricerca di stack trace e le aggrega nella vista **Exceptions** (Issues), attribuendole a questo host — senza alcuna configurazione aggiuntiva. Perché il raggruppamento funzioni bene, una stack trace multiriga (Java, Python, .NET, Ruby) deve arrivare come **un unico** record di log, non come un record per riga. Abilita la ricombinazione multiriga sul receiver `filelog`, così una trace e i suoi frame rimangono insieme:

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

Senza la ricombinazione, ogni frame viene acquisito come un log separato e l'eccezione apparirà come un problema su una sola riga, scarsamente raggruppato. Se la tua applicazione è in grado di emettere direttamente gli attributi di log OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace`, fai così invece — è il percorso più affidabile ed è indipendente dal parsing multiriga.

### systemd journal (Linux)

Se il tuo host usa systemd, il receiver `journald` è spesso più adatto rispetto al tailing di `/var/log/*` — cattura tutto in un unico posto e preserva i campi strutturati:

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

Il binario del collector deve essere in grado di eseguire `journalctl` (i pacchetti Debian / RPM lo includono già come dipendenza).

### Apple Unified Log (macOS)

macOS ha deprecato `/var/log/system.log` a favore dell'Apple Unified Log, che viene interrogato con `log show` / `log stream`. Il modo più semplice per acquisirlo è inviare l'output di `log` tramite il receiver `filelog` con un piccolo wrapper. Crea `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Rendilo eseguibile, eseguilo sotto launchd (o con `nohup` per un test rapido), quindi punta il collector al file:

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

(Se non hai bisogno dell'unified log, salta questa parte — le flotte di Mac spesso funzionano bene con le sole metriche dell'host + qualche log da file.)

### Windows Event Logs

Sottoscrivi i canali che ti interessano tramite il `wevtapi` nativo:

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

Per restringere il canale `Security` ad alto volume a specifici event ID:

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Per leggere un canale personalizzato o specifico di un'applicazione (qualsiasi cosa tu possa vedere sotto *Event Viewer → Applications and Services Logs*), usa il suo nome visualizzato esatto:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (metriche)

La scheda **Services** dell'host è alimentata dal [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (tipo di configurazione `windows_service`), che riporta lo stato di esecuzione e il tipo di avvio dei servizi Windows come metriche.

> **Questo receiver _non_ è incluso nel binario `otelcol-contrib` precompilato upstream.** Sebbene i suoi metadati dichiarino la distribuzione `contrib`, non è stato aggiunto al manifest di release di contrib, quindi il collector ufficiale precompilato che hai installato nel Passo 1 non lo contiene. Aggiungere `windows_service` a quel collector fallisce all'avvio con `'receivers' unknown type: "windows_service"` — e **nessun aggiornamento di versione risolve il problema**, perché non viene distribuito in nessuna build `otelcol-contrib` rilasciata. Il receiver è inoltre **alpha** e **solo per Windows**.

Hai due modi per ottenere un collector che lo include. Se non hai bisogno dello stato per singolo servizio, puoi saltare interamente questa parte — le metriche dell'host, i Windows Event Logs e tutto il resto funzionano con il collector standard.

#### Opzione A — Usa l'OneUptime Host Collector (consigliato)

OneUptime pubblica un collector precompilato — l'**OneUptime Host Collector** — che include già `windows_service` (oltre a `hostmetrics`, `windowseventlog`, `filelog` e l'exporter OTLP). Nessun toolchain Go o compilazione richiesti.

1. Scarica l'asset Windows dalla [pagina delle release di OneUptime](https://github.com/OneUptime/oneuptime/releases) — `oneuptime-host-collector_windows_amd64.zip` (o `_arm64.zip`) oppure l'installer `oneuptime-host-collector-amd64.msi`.
2. Estrai in `C:\Program Files\OneUptimeHostCollector\` (l'MSI lo installa lì per te). L'archivio include un `config.yaml` che abilita già `windows_service`.
3. Modifica `config.yaml` e imposta il tuo `x-oneuptime-token` (e l'endpoint se ospiti in self-hosting).
4. Registralo e avvialo come servizio Windows da un prompt PowerShell **con privilegi elevati**:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe start "OneUptimeHostCollector"
```

Viene eseguito come `LocalSystem` (l'impostazione predefinita di `sc.exe`) così può leggere ogni servizio. La scheda **Services** si popola automaticamente non appena arrivano le metriche. È lo stesso collector anche per Linux/macOS (quegli asset omettono semplicemente il receiver solo per Windows).

#### Opzione B — Compila la tua build con `ocb`

Se preferisci compilare il tuo collector (o esegui già una distribuzione personalizzata), creane uno con l'[OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder).

**1. Compila un collector personalizzato con `ocb`.** Crea `builder-config.yaml` (mantieni ogni versione sulla stessa release del collector):

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

Quindi compilalo (richiede Go) — l'output è un singolo `otelcol-oneuptime.exe` da eseguire al posto di `otelcol-contrib`:

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

**2. Abilita il receiver** nel tuo `config.yaml` e aggiungilo alla pipeline delle metriche:

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

Il receiver emette un gauge `windows.service.status` per servizio — l'intero è lo stato del servizio Win32 (`4` = running, `1` = stopped) — con gli attributi `name` e `startup_mode`. Esegui il collector come `LocalSystem` (l'impostazione predefinita con `sc.exe create`) così può leggere ogni servizio; quelli che non riesce ad aprire vengono saltati. Poiché il receiver è alpha, fissa e testa la versione prima della produzione — tra i problemi noti ci sono un errore di scrape che potrebbe far crashare il collector e un `access denied` su un servizio che ne compromette altri; limita con `include_services` se li incontri.

### Esempio completo — host Linux

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

### Esempio completo — host macOS

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

### Esempio completo — host Windows

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

  # Windows service status (the Services tab) needs the windows_service
  # receiver, which is NOT in the prebuilt collector — see
  # "Windows Services (metrics)" above to build a collector that includes it.

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
      receivers: [hostmetrics]
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

## Passo 3 — Esegui il collector come servizio

### Linux (systemd)

I pacchetti Debian / RPM installano già un'unità systemd. Basta abilitarla e avviarla:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Per seguire i log del collector stesso:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Crea `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Caricalo:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Da un prompt PowerShell **con privilegi elevati**:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Per impostazione predefinita il servizio viene eseguito come `LocalSystem`, che dispone dei privilegi necessari per leggere il canale `Security` del Windows Event Log.

## Passo 4 — Verifica in OneUptime

1. Genera qualche segnale sull'host:
   - **Linux / macOS:** `logger "hello from oneuptime"` (scrive su syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` da un prompt con privilegi elevati.
2. Nella dashboard di OneUptime, apri **Telemetry → Services** e seleziona il `service.name` che hai configurato.
3. Apri **Metrics** — le metriche dell'host (CPU, memoria, filesystem, ecc.) dovrebbero apparire entro un minuto.
4. Apri **Logs** — i tuoi log da file / le voci di journald / i Windows Event Logs dovrebbero arrivare in streaming. Tra gli attributi utili e ricercabili figurano `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` e `winlog.provider.name`.

## OneUptime self-hosted

Se ospiti OneUptime in self-hosting, punta l'exporter al tuo host:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Se la tua istanza è solo HTTP, cambia lo schema in `http://` e usa la porta appropriata.

## Dietro un proxy

L'OpenTelemetry Collector rispetta le variabili d'ambiente standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Impostale sul servizio:

- **systemd (Linux):** inserisci `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` con `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, quindi `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** aggiungi un dict `<EnvironmentVariables>` al plist.
- **Servizio Windows:** imposta le variabili d'ambiente sul servizio tramite `sc.exe config` o il registro sotto `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Risoluzione dei problemi

- **Nessuna telemetria appare in OneUptime**
  - Aggiungi `service.telemetry.logs.level: debug` alla configurazione e riavvia il collector per un output dettagliato.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) o `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** cerca sotto *Event Viewer → Windows Logs → Application* la sorgente `otelcol-contrib`.
  - Verifica che l'host possa raggiungere `https://oneuptime.com/otlp` (o il tuo endpoint self-hosted): `curl -v https://oneuptime.com/otlp` dalla stessa macchina.
- **HTTP 401 dall'exporter** — il token di ingestione non è valido o è stato revocato. Generane uno nuovo da *Project Settings → Telemetry Ingestion Keys*.
- **Il canale `Security` del Windows Event Log restituisce access denied** — il servizio non viene eseguito con privilegi sufficienti. Ricrealo come `LocalSystem` (l'impostazione predefinita con `sc.exe create`) o concedi all'account del servizio il diritto utente *Manage auditing and security log*.
- **Il receiver `journald` non si avvia** — assicurati che `journalctl` sia nel `PATH` del collector e che `/var/log/journal` esista (esegui `sudo systemd-tmpfiles --create --prefix /var/log/journal` in caso contrario).
- **Volume / costo elevato** — restringi i receiver (canali Windows specifici, unità systemd specifiche, file di log specifici), aggiungi un filtro `query:` sul receiver del Windows Event Log, oppure aggiungi un processor `filter` per scartare gli eventi a bassa severità prima dell'esportazione.

## Prossimi passi

- Aggiungi **Logs Monitors** per generare alert su pattern di log specifici (ad esempio, generare un alert quando si verificano più di 5 accessi falliti con `winlog.event_id = 4625` in una finestra di 5 minuti).
- Aggiungi **Metrics Monitors** sulle metriche dell'host (saturazione della CPU, spazio su disco insufficiente, utilizzo dello swap).
- Combina questo con il [Server / VM Monitor](/docs/monitor/server-monitor) e l'[OneUptime Infrastructure Agent](/docs/monitor/server-monitor) per una visibilità end-to-end dell'host.
- Distribuisci la stessa configurazione a ogni host tramite Ansible / Chef / Puppet / Group Policy / Intune / i tuoi strumenti di configuration management esistenti.
