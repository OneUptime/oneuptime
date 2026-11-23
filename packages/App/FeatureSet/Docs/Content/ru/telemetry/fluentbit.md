# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) — лёгкий агент, который собирает логи из файлов, systemd, контейнеров, syslog, HTTP и многих других источников. Его [выход OpenTelemetry](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) отправляет собранное на OpenTelemetry-адрес (OTLP) OneUptime, где логи становятся доступными для поиска в **Продукты → Журналы**.

:::cards
- [Настройка Fluent Bit](#настройка-fluent-bit): Добавьте выход OpenTelemetry и задайте имя службы.
- [Полный пример](#полный-пример): Целый файл конфигурации, с которого можно начать.
- [Собственная установка OneUptime](#собственная-установка-oneuptime): Направьте Fluent Bit на свой экземпляр.
:::

## Как это работает

```mermaid title="От Fluent Bit до OneUptime"
flowchart TB
    sources["Файлы, контейнеры, syslog, HTTP"] --> inputs["Входы Fluent Bit"]
    inputs --> envelope["Процессор opentelemetry_envelope"]
    envelope --> name["content_modifier задаёт service.name"]
    name --> output["Выход opentelemetry"]
    output -->|"OTLP/HTTP + ключ приёма"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Логи"]
```

Fluent Bit упаковывает каждую запись в конверт OpenTelemetry, чтобы она могла нести атрибуты ресурса, такие как `service.name`. Затем выход OpenTelemetry отправляет записи в OneUptime с вашим ключом приёма в заголовке `x-oneuptime-token`. OneUptime сохраняет их под службой, указанной в `service.name`, и создаёт эту службу при первой отправке.

## Перед началом

- **Установите Fluent Bit** — см. [руководство по установке](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). Конфигурация на этой странице использует формат YAML Fluent Bit и процессор `opentelemetry_envelope`, поэтому нужна актуальная версия.
- **Проект OneUptime.** В OneUptime Cloud телеметрия оплачивается за каждый принятый ГБ — см. [цены](https://oneuptime.com/pricing), — а проекту на плане Free нужен способ оплаты, прежде чем он сможет отправлять телеметрию.
- **Ключ приёма телеметрии.** Если его ещё нет:

:::steps
### Откройте ключи приёма

Перейдите в **Продукты → Настройки проекта**, откройте в боковом меню **Телеметрия и APM** и выберите **Ключи приёма**.

![Список «Ключи приёма», кнопка «Создать ключ приёма» обведена](screen:ingestion-keys)

### Создайте ключ

Нажмите **Создать ключ приёма**. В окне уже заполнено имя ключа и выбран тип **Сервер** — именно с таким ключом отправляют данные приложение или коллектор, — так что нажмите **Создать ключ приёма**, чтобы создать его, или сначала переименуйте.

### Скопируйте секрет

Новый ключ открывается на отдельной странице. Скопируйте его **Секретный ключ**: это `YOUR_TELEMETRY_INGESTION_TOKEN` в конфигурации ниже.

![Страница ключа приёма телеметрии с его секретным ключом](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Настройка Fluent Bit

Fluent Bit читает свою конфигурацию YAML из файла, например `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Добавьте выход OpenTelemetry

Добавьте выход `opentelemetry`, который отправляет данные в OneUptime. Оставьте выход `stdout` на время проверки, если хотите видеть записи локально:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` отправляет чанк заново, когда OneUptime перегружен (`429`) или перезапускается (`502`, `503`, `504`), примерно каждые 30 секунд (`scheduler.base` и `scheduler.cap`), около 72 часов; по умолчанию Fluent Bit пробует ещё один раз и отбрасывает его. `storage.path` хранит на диске чанки, которые ещё предстоит отправить, поэтому перезапуск Fluent Bit не теряет ни одного из них, для каждого входа с `storage.type: filesystem`, как в следующем шаге. Fluent Bit должен иметь право писать в эту папку: служба пакета работает от root, а вручную запускайте его через `sudo`. `storage.total_limit_size: 512M` хранит для вывода не больше 512 МБ; когда место кончается, самые старые чанки отбрасываются.

### Упакуйте логи в конверт OpenTelemetry и задайте имя службы

Добавьте к каждому входу процессор `opentelemetry_envelope`, а за ним — `content_modifier`, который задаёт `service.name`. Замените `YOUR_SERVICE_NAME` именем, под которым логи должны появляться в OneUptime:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` хранит место tail в каждом файле, поэтому после перезапуска чтение продолжается оттуда; без него Fluent Bit начинает заново с конца каждого файла, и строки, записанные, пока он не работал, так и не отправляются. `storage.type: filesystem` хранит чанки входа в `storage.path`.

### Перезапустите Fluent Bit

Служба пакета `fluent-bit` читает `/etc/fluent-bit/fluent-bit.conf`, собственный пример пакета, а не этот файл. Направьте её на `/etc/fluent-bit/fluent-bit.yaml` с помощью drop-in, затем запустите сейчас и при каждой загрузке:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

Пустой `ExecStart=` стирает собственную строку запуска пакета. Чтобы сначала попробовать файл на переднем плане, выполните `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: пакет кладёт программу в `/opt/fluent-bit/bin`, которой нет в `PATH`. Через несколько секунд логи появятся в **Продукты → Журналы**, а служба — в **Продукты → Сервисы**.
:::

## Полный пример

Эта конфигурация принимает логи по HTTP на порту `8888`, только с этого хоста, и пересылает их в OneUptime:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` принимает логи только с этого хоста: вход `http` не требует ключа, поэтому с `listen: 0.0.0.0` любой, кто может достучаться до порта, может отправлять логи в OneUptime под вашим ключом приёма. Замените вход `http` нужными вам входами — например, `tail` для файлов логов или `systemd` для журнала — и оставьте оба процессора и `storage.type: filesystem` на каждом из них.

## Отправка через выход HTTP

[Выход HTTP](https://docs.fluentbit.io/manual/pipeline/outputs/http) Fluent Bit может отправлять и на адрес Fluentd в OneUptime, который читает каждую запись так, как описано на [странице Fluentd](/docs/telemetry/fluentd). Задайте в `format` значение `json_lines`, как ниже, или `json`: OneUptime читает оба, сжатые через `compress: gzip` или нет. Формат Fluent Bit по умолчанию, `msgpack`, отклоняется.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Собственная установка OneUptime

Задайте в `host` хост вашего экземпляра OneUptime. Если он работает по обычному HTTP, а не по HTTPS, задайте также в `port` порт, на котором он слушает (обычно `80`), и уберите `tls`:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Устранение неполадок

:::details Fluent Bit пишет `401` от выхода OpenTelemetry
Ключ приёма отсутствует, неизвестен или истёк. Проверьте строку `header`: это `x-oneuptime-token`, пробел и затем **Секретный ключ** ключа.
:::

:::details Fluent Bit пишет `402` или `422`
`402`: в OneUptime Cloud проект на плане Free и без способа оплаты. Добавьте его в **Настройки проекта → Биллинг и счета → Биллинг**. `422`: ключ отключён, или это ключ браузера. Снова включите **Включено** в настройках ключа или создайте ключ типа **Сервер**.
:::

:::details Логи приходят под неожиданной службой
Служба берётся из `service.name`. Проверьте, что у каждого входа есть процессор `opentelemetry_envelope`, а за ним `content_modifier`, который её задаёт.
:::

:::details Ничего не приходит, а Fluent Bit пишет ошибки подключения
Проверьте, что для HTTPS-адреса заданы `tls: On` и `port: 443`, и что хост, на котором работает Fluent Bit, может связаться с хостом OneUptime по этому порту.
:::

:::details Fluent Bit пишет `cannot be retried`
Fluent Bit отбросил чанк, который не смог отправить. С `retry_limit: 8640`, как в конфигурации выше, он отправляет чанк, на который OneUptime отвечает `429`, `502`, `503` или `504`, заново примерно каждые 30 секунд, около 72 часов; по умолчанию Fluent Bit пробует только ещё один раз. Ответ `400`, `401`, `402`, `413`, `422` или `500` отбрасывается сразу, потому что он каждый раз один и тот же: проверьте ключ, тариф и размер запроса.
:::

Если у вас есть вопросы или нужна помощь с конфигурацией, напишите нам на support@oneuptime.com.

## Что дальше

:::cards
- [Конвейеры логов](/docs/telemetry/log-pipelines): Разбирайте и обогащайте логи, которые отправляет Fluent Bit.
- [Синтаксис поиска](/docs/telemetry/search-syntax): Находите логи в обозревателе журналов.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Адреса, ключи и ограничения для всей телеметрии.
- [Fluentd](/docs/telemetry/fluentd): Используйте вместо этого Fluentd.
:::
