# Host OpenTelemetry Collector (Linux, macOS, Windows)

## Обзор

Вы можете запускать **OpenTelemetry Collector** как службу непосредственно на ваших хостах Linux, macOS или Windows, чтобы отправлять телеметрию хоста в OneUptime по OTLP. На этой странице рассматривается установка коллектора, его настройка для каждой ОС и выбор подходящих приёмников (receivers) под то, что вы хотите собирать:

- **Метрики хоста** (CPU, память, диск, файловая система, сеть, нагрузка, процессы) в любой ОС
- **Логи на основе файлов** в `/var/log/**` (Linux, macOS) через [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver)
- **журнал systemd** (Linux) через [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver)
- **Apple Unified Log** (macOS) через [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor), оборачивающий считываемый вывод `log stream`
- **Журналы событий Windows** через [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver)
- **Статус служб Windows** (питает вкладку **Services** хоста) через [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) — входит в сборку `otelcol-contrib` из апстрима начиная с **v0.155.0** (см. «Службы Windows (метрики)» ниже)

> **А что насчёт OneUptime Infrastructure Agent?** Этот агент — отдельный, легковесный демон на Go, ориентированный на базовые метрики и функцию _Server / VM Monitor_ (статус, процессы, оповещения). Описанный здесь OpenTelemetry Collector независим и является правильным инструментом, когда вам нужны логи (файловые логи, journald, журналы событий Windows) или более богатые метрики хоста, принимаемые как стандартный OTLP. Оба могут работать на одном хосте, не мешая друг другу.

## Предварительные требования

- **OneUptime Telemetry Ingestion Token** — создайте его в _Project Settings → Telemetry Ingestion Keys_ и скопируйте значение `x-oneuptime-token`.
- Дистрибутив **OpenTelemetry Collector Contrib** (`otelcol-contrib`). Сборка `otelcol` по умолчанию **не** включает приёмники вроде `windowseventlogreceiver`, `journaldreceiver` или дополнения `hostmetrics` — обязательно используйте дистрибутив `contrib`. Alpha-приёмник `windowsservicereceiver`, который питает вкладку **Services** в Windows, входит в `otelcol-contrib` начиная с **v0.155.0**, поэтому установите актуальный релиз; см. «Службы Windows (метрики)» ниже.
- Права root / Администратора на хосте, чтобы установить коллектор как службу и (где применимо) читать привилегированные источники логов.

## Шаг 1 — Установите OpenTelemetry Collector

Выберите раздел для вашей ОС. Все примеры предполагают, что вы устанавливаете последний релиз `otelcol-contrib` из [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases).

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Пакет Debian устанавливает бинарный файл в `/usr/bin/otelcol-contrib`, конфигурацию по умолчанию в `/etc/otelcol-contrib/config.yaml`, а юнит systemd — в `/etc/systemd/system/otelcol-contrib.service`.

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

Пути совпадают с пакетом Debian (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, юнит systemd `otelcol-contrib`).

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

Вы создадите `/etc/otelcol-contrib/config.yaml` на Шаге 2 и plist для `launchd` на Шаге 3.

### Windows

В Windows загрузите релиз **`otelcol-contrib`** из апстрима — он включает приёмник `windows_service`, который питает вкладку **Services** хоста (начиная с **v0.155.0**). Из **командной строки PowerShell с повышенными правами**:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

Это распаковывает `otelcol-contrib.exe` в `C:\Program Files\otelcol-contrib`. Вы создадите `config.yaml` в той же папке на Шаге 2 и зарегистрируете службу Windows на Шаге 3.

> Предпочитаете нативный установщик? OpenTelemetry также публикует подписанный **`.msi`** (`otelcol-contrib_<version>_windows_x64.msi`) на той же [странице релизов](https://github.com/open-telemetry/opentelemetry-collector-releases/releases), который регистрирует коллектор как службу Windows за вас. Если вы его используете, укажите ему на `config.yaml` из Шага 2 и убедитесь, что служба работает под `LocalSystem`, чтобы вкладка **Services** могла читать Service Control Manager.

## Шаг 2 — Настройте коллектор

Файл конфигурации находится по адресу:

| ОС      | Путь                                                  |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

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

**Этот приёмник входит в бинарный файл `otelcol-contrib` из апстрима начиная с v0.155.0** — на более ранних релизах добавление `windows_service` приводит к ошибке при запуске `'receivers' unknown type: "windows_service"`. Установите актуальный релиз (Шаг 1), затем включите его в вашем `config.yaml` и добавьте в конвейер метрик:

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

> **`include_services` не действует?** Фильтр может только *сужать* набор, поэтому если вы перечислили службы, но по-прежнему видите все, отредактированная конфигурация почти наверняка не дошла до работающего коллектора. Перезапустите службу после редактирования (Шаг 3); убедитесь, что `include_services` — это заполненный список с тем же отступом, что и `collection_interval` (а не оставлен закомментированным или пустым); и дайте вкладке **Services** несколько минут, чтобы службы, о которых сообщалось до изменения, вышли из её скользящего окна. Имена — это точные, чувствительные к регистру _ключевые_ имена служб Windows (например, `Spooler`, `W3SVC`), которые вы можете вывести с помощью `Get-Service | Select-Object Name`.

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
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

Служба по умолчанию работает под `LocalSystem`, у которой есть привилегии, необходимые для чтения канала журнала событий Windows `Security` и каждой службы Windows.

## Шаг 4 — Проверьте в OneUptime

1. Сгенерируйте какой-нибудь сигнал на хосте:
   - **Linux / macOS:** `logger "hello from oneuptime"` (пишет в syslog / journald).
   - **Windows:** `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"` из командной строки с повышенными правами.
2. В панели управления OneUptime откройте **Telemetry → Services** и выберите настроенный вами `service.name`.
3. Откройте **Metrics** — метрики хоста (CPU, память, файловая система и т. д.) должны появиться в течение минуты.
4. Откройте **Logs** — ваши файловые логи / записи journald / журналы событий Windows должны поступать в потоке. Полезные для поиска атрибуты включают `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id` и `winlog.provider.name`.

## Уменьшение объёма собираемых данных

Поскольку конфигурация коллектора принадлежит вам, вы точно решаете, что покидает хост — ничего не собирается, пока добавленный вами приёмник этого не запросит. Если хост отправляет больше, чем вам нужно (что проявляется как более высокий объём приёма данных, а в OneUptime Cloud — как более высокая стоимость), настройте его здесь. Два самых больших рычага — это **какие источники логов вы считываете** и **как часто вы собираете метрики**; процессор `filter` берёт на себя остальное.

Принцип тот же, что и у самой конфигурации: **добавляйте только те приёмники, данные которых вы будете смотреть**, а затем сокращайте объём внутри них. Каждое изменение ниже — это правка `config.yaml`; примените его и перезапустите коллектор (Шаг 3).

### Откуда берётся объём

| Сигнал                    | Крупнейший источник                                      | Как уменьшить                                                      |
| ------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| **Логи**                  | Каждая строка из каждого файла / юнита journald / канала | Сузьте приёмники; фильтры `query:`; процессор `filter` по важности |
| **Метрики хоста**         | Частота сбора × количество рядов                         | `collection_interval`; уберите scraper `process`; выбор scraper'ов |
| **Кардинальность метрик** | Метрики по процессам (один набор рядов на процесс)       | Уберите или ограничьте scraper `process`                           |

### Рычаг 1 — Считывайте только нужные источники логов

Логи почти всегда — самая большая доля. Коллектор читает только то, что вы перечислили, поэтому решение — перечислять меньше:

- **Файлы** — направляйте `filelog` на конкретные пути, а не на широкие маски. `/var/log/myapp/error.log` вместо `/var/log/**`.
- **journald** — ограничьте `units:` службами, которые вам важны, и повысьте `priority:`, чтобы отбрасывать болтливые записи `info`/`debug` у источника:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Журналы событий Windows** — канал `Security` безусловно самый высоконагруженный. Сузьте его до идентификаторов событий, которые вы действительно аудируете, с помощью `query:` (как показано в разделе [Журналы событий Windows](#windows-event-logs) выше), или уберите канал целиком, если он вам не нужен.

### Рычаг 2 — Замедлите интервал сбора метрик

Объём `hostmetrics` напрямую масштабируется с `collection_interval`. Если вам не нужно 30-секундное разрешение, 60s вдвое сокращает количество точек данных:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### Рычаг 3 — Уберите scraper по каждому процессу (источник кардинальности)

Scraper `process` выдаёт отдельный набор рядов **для каждого запущенного процесса** на хосте — на нагруженной машине это самый крупный источник кардинальности метрик. Если вам не нужны CPU/память по каждому процессу, не включайте его в список `scrapers:`. Оставьте `processes` (это всего лишь несколько агрегированных метрик количества процессов) — это дёшево. Если вам всё же нужны метрики по процессам, ограничьте их процессами, которые действительно важны:

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

### Рычаг 4 — Отбрасывайте малоценные записи процессором `filter`

Когда вам нужен приёмник, но не весь его вывод, добавьте процессор [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) — он вычисляет условие [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) и **отбрасывает любую запись, которая ему соответствует**, до того как что-либо будет экспортировано.

Отбрасывайте логи ниже порога важности:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        - "severity_number < SEVERITY_NUMBER_WARN"
```

Отбрасывайте конкретную шумную метрику, которую вы не отображаете на графиках:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        - 'name == "system.paging.faults"'
```

Затем добавьте процессор в соответствующий конвейер — порядок имеет значение, поэтому поставьте `filter` перед `batch`:

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

### Экономная отправная точка

Хост **только с метриками** — без логов, с грубым интервалом, без рядов по каждому процессу — это наименьший полезный объём:

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

Верните конвейер `logs` с узко ограниченным приёмником `filelog` или `journald`, когда он вам понадобится.

> **Следите за тем, что вырезаете.** Оповещения на основе логов требуют, чтобы логи поступали: если вы отфильтруете важность или канал, мониторы, завязанные на них, замолчат. Сокращайте источники, на которые вы не реагируете, а не те, за которыми следит монитор. Меняйте по одному рычагу за раз и подтверждайте снижение в **Project Settings → Usage History** (использование агрегируется ежедневно, поэтому дайте день-два) перед переходом к следующему.

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
- **Большой объём / стоимость** — см. [Уменьшение объёма собираемых данных](#reducing-the-volume-of-data-collected): сузьте приёмники (конкретные каналы Windows, конкретные юниты systemd, конкретные файлы логов), увеличьте `collection_interval` метрик, уберите scraper по каждому процессу или добавьте процессор `filter`, чтобы отбрасывать записи низкой важности перед экспортом.

## Дальнейшие шаги

- Добавьте **Logs Monitors**, чтобы оповещать о конкретных шаблонах логов (например, оповещать, когда более 5 неудачных входов `winlog.event_id = 4625` происходят в окне 5 минут).
- Добавьте **Metrics Monitors** на метрики хоста (насыщение CPU, нехватка места на диске, использование подкачки).
- Сочетайте это с [Server / VM Monitor](/docs/monitor/server-monitor) и [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) для сквозной видимости хоста.
- Доставляйте одну и ту же конфигурацию на каждый хост через Ansible / Chef / Puppet / Group Policy / Intune / ваш существующий инструментарий управления конфигурацией.
