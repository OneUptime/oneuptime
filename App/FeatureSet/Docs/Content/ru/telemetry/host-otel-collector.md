# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Обзор

Вы можете запускать **OpenTelemetry Collector** как службу непосредственно на ваших хостах Linux, macOS или Windows, чтобы отправлять телеметрию хоста в OneUptime по OTLP. На этой странице рассматривается установка коллектора, его настройка для каждой ОС и выбор подходящих приёмников (receivers) под то, что вы хотите собирать:

- **Метрики хоста** (CPU, память, диск, файловая система, сеть, нагрузка, процессы) в любой ОС
- **Логи на основе файлов** в `/var/log/**` (Linux, macOS) через [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **журнал systemd** (Linux) через [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) через [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor), оборачивающий считываемый вывод `log stream`
- **Журналы событий Windows** через [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Статус служб Windows** (питает вкладку **Services** хоста) через [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — _отсутствует в готовом коллекторе из апстрима; используйте готовый **OneUptime Host Collector** или пользовательскую сборку (см. «Службы Windows (метрики)» ниже)_

> **А что насчёт OneUptime Infrastructure Agent?** Этот агент — отдельный, легковесный демон на Go, ориентированный на базовые метрики и функцию _Server / VM Monitor_ (статус, процессы, оповещения). Описанный здесь OpenTelemetry Collector независим и является правильным инструментом, когда вам нужны логи (файловые логи, journald, журналы событий Windows) или более богатые метрики хоста, принимаемые как стандартный OTLP. Оба могут работать на одном хосте, не мешая друг другу.

## Предварительные требования

- **OneUptime Telemetry Ingestion Token** — создайте его в _Project Settings → Telemetry Ingestion Keys_ и скопируйте значение `x-oneuptime-token`.
- Дистрибутив **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Сборка `otelcol` по умолчанию **не** включает приёмники вроде `windowseventlogreceiver`, `journaldreceiver` или дополнения `hostmetrics` — обязательно используйте дистрибутив `contrib`. Одно исключение, о котором стоит знать заранее: alpha-приёмник `windowsservicereceiver` (который питает вкладку **Services** в Windows) **не** входит в готовый бинарный файл `contrib` из апстрима — используйте готовый **OneUptime Host Collector** (который его включает) или соберите свой собственный; см. «Службы Windows (метрики)» ниже.
- Права root / Администратора на хосте, чтобы установить коллектор как службу и (где применимо) читать привилегированные источники логов.

## Шаг 1 — Установите OpenTelemetry Collector

Выберите раздел для вашей ОС. Все примеры предполагают, что вы устанавливаете последний релиз `otelcol-contrib` из [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Пакет Debian устанавливает бинарный файл в `/usr/bin/otelcol-contrib`, конфигурацию по умолчанию в `/etc/otelcol-contrib/config.yaml`, а юнит systemd — в `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Пути совпадают с пакетом Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, юнит systemd `otelcol-contrib`).

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

Вы создадите `/etc/otelcol-contrib/config.yaml` на Шаге 2 и plist для `launchd` на Шаге 3.

### Windows

В Windows установите **OneUptime Host Collector** — готовый коллектор от OneUptime, который включает приёмник `windows_service` (он питает вкладку **Services** хоста и _отсутствует_ в сборке `otelcol-contrib` из апстрима). Из **командной строки PowerShell с повышенными правами**:

```powershell
$dest = "C:\Program Files\OneUptimeHostCollector"
$zip  = "$env:TEMP\oneuptime-host-collector.zip"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _arm64.zip asset on ARM
Invoke-WebRequest -Uri "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-host-collector_windows_amd64.zip" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $dest -Force
```

Вы создадите `C:\Program Files\OneUptimeHostCollector\config.yaml` на Шаге 2 и зарегистрируете службу Windows на Шаге 3.

> Предпочитаете `otelcol-contrib` из апстрима? Вместо этого загрузите `otelcol-contrib_*_windows_amd64.zip` со [страницы релизов OpenTelemetry](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) — всё, что ниже, работает так же, **кроме** вкладки **Services** хоста, для которой нужен `windows_service` (отсутствует в сборке из апстрима; см. «Службы Windows (метрики)»).

## Шаг 2 — Настройте коллектор

Файл конфигурации находится по адресу:

| ОС      | Путь                                                  |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\OneUptimeHostCollector\config.yaml` |

Каждая конфигурация имеет одну и ту же форму — выберите нужные приёмники, добавьте процессоры `batch` и `resource` и экспортируйте в OneUptime по OTLP HTTP. Примеры ниже показывают полную, готовую к копированию конфигурацию для каждой ОС, а затем разбирают каждый блок приёмника, чтобы вы могли их комбинировать.

Замените `YOUR_TELEMETRY_INGESTION_TOKEN` и значение `service.name` под ваше окружение.

### Общие части (используются каждой ОС)

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

- **`batch`** группирует записи перед экспортом, чтобы вы не платили за один HTTP-обмен на каждую запись.
- **`resource`** проставляет каждой записи `service.name`. Используйте разные значения для каждого хоста (например, `prod-web-01`), если хотите, чтобы каждая машина отображалась как отдельная служба телеметрии в OneUptime.
- **`otlphttp`** отправляет данные в OneUptime по HTTPS с прикреплённым токеном приёма данных.

### Метрики хоста (Linux, macOS, Windows)

Работает в любой ОС. Подхватывает метрики CPU, памяти, диска, файловой системы, сети, нагрузки, страничной подкачки и процессов из ядра хоста:

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

> В Linux коллектор читает `/proc` и `/sys`. Когда коллектор работает в контейнере, смонтируйте `/proc` и `/sys` хоста и задайте переменные окружения `HOST_PROC` / `HOST_SYS`. Когда он работает напрямую как служба systemd (как установлено выше), дополнительная настройка не требуется.

### Файловые логи (Linux, macOS)

Считывайте любой файл логов на диске. Ниже приведён распространённый стартовый набор:

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

`start_at: end` означает новые строки с момента запуска коллектора; смените на `beginning`, чтобы дозаполнить при первом запуске. Коллектор отслеживает смещения в файлах, поэтому корректно возобновляет работу после перезапусков.

**Превращение трассировок стека из логов хоста в Exceptions.** OneUptime автоматически сканирует строки логов уровня error и fatal на наличие трассировок стека и сворачивает их в представление **Exceptions** (Issues), привязывая к этому хосту — без дополнительной настройки. Чтобы они хорошо группировались, многострочная трассировка стека (Java, Python, .NET, Ruby) должна приходить как **одна** запись лога, а не как одна запись на строку. Включите многострочное объединение на приёмнике `filelog`, чтобы трассировка и её кадры оставались вместе:

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

Без объединения каждый кадр принимается как отдельный лог, и исключение появится как однострочная, плохо сгруппированная проблема. Если ваше приложение может напрямую выдавать атрибуты логов OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace`, делайте лучше это — это наиболее надёжный путь, и он не зависит от многострочного парсинга.

### Журнал systemd (Linux)

Если ваш хост использует systemd, приёмник `journald` часто подходит лучше, чем считывание `/var/log/*` — он собирает всё в одном месте и сохраняет структурированные поля:

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

Бинарный файл коллектора должен иметь возможность выполнять `journalctl` (пакеты Debian / RPM уже включают его как зависимость).

### Apple Unified Log (macOS)

macOS объявила `/var/log/system.log` устаревшим в пользу Apple Unified Log, который запрашивается через `log show` / `log stream`. Самый простой способ его принять — стримить вывод `log` через приёмник `filelog` с небольшой обёрткой. Создайте `/usr/local/otelcol-contrib/log-stream.sh`:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

Сделайте его исполняемым, запустите под launchd (или `nohup` для быстрого теста), затем укажите коллектору на файл:

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

(Если унифицированный лог вам не нужен, пропустите это — парки Mac часто прекрасно работают только с метриками хоста + несколькими файловыми логами.)

### Журналы событий Windows

Подпишитесь на интересующие вас каналы через нативный `wevtapi`:

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

Чтобы сузить высоконагруженный канал `Security` до конкретных идентификаторов событий:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

Чтобы читать пользовательский или специфичный для приложения канал (всё, что вы видите в _Event Viewer → Applications and Services Logs_), используйте его точное отображаемое имя:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Службы Windows (метрики)

Вкладка **Services** хоста питается приёмником [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (тип конфигурации `windows_service`), который сообщает о состоянии работы и типе запуска служб Windows в виде метрик.

**OneUptime Host Collector (установленный на Шаге 1, вариант по умолчанию в Windows) уже включает этот приёмник.** Включите его в вашем `config.yaml` и добавьте в конвейер метрик:

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

Приёмник выдаёт один датчик `windows.service.status` на службу — целое число соответствует состоянию службы Win32 (`4` = выполняется, `1` = остановлена) — с атрибутами `name` и `startup_mode`. Запускайте коллектор как `LocalSystem` (по умолчанию при `sc.exe`), чтобы он мог читать каждую службу; любая, которую он не может открыть, пропускается. Приёмник находится в стадии **alpha** и работает **только в Windows**; среди известных проблем — ошибка сбора данных, которая может привести к сбою коллектора, и `access denied` на одной службе, влияющий на другие; ограничьтесь `include_services`, если столкнётесь с ними.

#### Используете коллектор из апстрима вместо этого?

Готовый бинарный файл `otelcol-contrib` из апстрима **не** включает `windowsservicereceiver` — добавление `windows_service` приводит к ошибке при запуске `'receivers' unknown type: "windows_service"`, и **никакое обновление версии это не исправит** (он не входит ни в одну выпущенную сборку `otelcol-contrib`). Либо переключитесь на OneUptime Host Collector (Шаг 1), либо соберите свой собственный с помощью [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) — создайте `builder-config.yaml` (держите все версии на одном релизе коллектора):

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

Затем запустите получившийся `otelcol-oneuptime.exe` и включите `windows_service`, как показано выше.

### Полный пример — хост Linux

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

### Полный пример — хост macOS

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

### Полный пример — хост Windows

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

## Шаг 3 — Запустите коллектор как службу

### Linux (systemd)

Пакеты Debian / RPM уже устанавливают юнит systemd. Просто включите и запустите его:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

Чтобы следить за собственными логами коллектора:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

Создайте `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:

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

Загрузите его:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

Из **командной строки PowerShell с повышенными правами**:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe description "OneUptimeHostCollector" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "OneUptimeHostCollector"
sc.exe query "OneUptimeHostCollector"
```

Служба по умолчанию работает под `LocalSystem`, у которой есть привилегии, необходимые для чтения канала журнала событий Windows `Security` и каждой службы Windows.

## Шаг 4 — Проверьте в OneUptime

1. Сгенерируйте какой-нибудь сигнал на хосте:
   - **Linux / macOS:** `logger "hello from oneuptime"` (пишет в syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` из командной строки с повышенными правами.
2. В панели управления OneUptime откройте **Telemetry → Services** и выберите настроенный вами `service.name`.
3. Откройте **Metrics** — метрики хоста (CPU, память, файловая система и т. д.) должны появиться в течение минуты.
4. Откройте **Logs** — ваши файловые логи / записи journald / журналы событий Windows должны поступать в потоке. Полезные для поиска атрибуты включают `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` и `winlog.provider.name`.

## Self-hosted OneUptime

Если вы размещаете OneUptime самостоятельно, направьте экспортёр на ваш собственный хост:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

Если ваш экземпляр работает только по HTTP, измените схему на `http://` и используйте соответствующий порт.

## За прокси

OpenTelemetry Collector учитывает стандартные переменные окружения `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. Задайте их для службы:

- **systemd (Linux):** добавьте `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` с `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"`, затем `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`.
- **launchd (macOS):** добавьте словарь `<EnvironmentVariables>` в plist.
- **Служба Windows:** задайте переменные окружения для службы через `sc.exe config` или в реестре под `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment`.

## Устранение неполадок

- **Телеметрия не появляется в OneUptime**
  - Добавьте `service.telemetry.logs.level: debug` в конфигурацию и перезапустите коллектор для подробного вывода.
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) или `tail -f /var/log/otelcol-contrib.err.log` (macOS).
  - **Windows:** смотрите в _Event Viewer → Windows Logs → Application_ по источнику `otelcol-contrib`.
  - Убедитесь, что хост может достучаться до `https://oneuptime.com/otlp` (или вашей самостоятельно размещённой конечной точки): `curl -v https://oneuptime.com/otlp` с той же машины.
- **HTTP 401 от экспортёра** — токен приёма данных недействителен или отозван. Сгенерируйте новый в _Project Settings → Telemetry Ingestion Keys_.
- **Журнал событий Windows `Security` возвращает «access denied»** — служба работает с недостаточными привилегиями. Пересоздайте её под `LocalSystem` (по умолчанию при `sc.exe create`) или предоставьте учётной записи службы право пользователя _Manage auditing and security log_.
- **Приёмник `journald` не запускается** — убедитесь, что `journalctl` находится в `PATH` коллектора и что `/var/log/journal` существует (выполните `sudo systemd-tmpfiles --create --prefix /var/log/journal`, если нет).
- **Большой объём / стоимость** — сузьте приёмники (конкретные каналы Windows, конкретные юниты systemd, конкретные файлы логов), добавьте фильтр `query:` на приёмнике журнала событий Windows или добавьте процессор `filter`, чтобы отбрасывать события низкой важности перед экспортом.

## Дальнейшие шаги

- Добавьте **Logs Monitors**, чтобы оповещать о конкретных шаблонах логов (например, оповещать, когда более 5 неудачных входов `winlog.event_id = 4625` происходят в окне 5 минут).
- Добавьте **Metrics Monitors** на метрики хоста (насыщение CPU, нехватка места на диске, использование подкачки).
- Сочетайте это с [Server / VM Monitor](/docs/monitor/server-monitor) и [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) для сквозной видимости хоста.
- Доставляйте одну и ту же конфигурацию на каждый хост через Ansible / Chef / Puppet / Group Policy / Intune / ваш существующий инструментарий управления конфигурацией.
