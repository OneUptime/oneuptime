# Отправка данных Syslog в OneUptime

## Обзор

Сервис приёма OpenTelemetry теперь принимает нативные нагрузки Syslog. Вы можете пересылать сообщения из любого RFC3164 или RFC5424 совместимого источника напрямую в OneUptime по HTTPS. OneUptime разбирает приоритет syslog, объект, серьёзность, структурированные данные и тело сообщения, сохраняя всё это как доступные для поиска журналы.

## Предварительные требования

- **Токен приёма телеметрии** — создайте его в *Настройки проекта → Ключи приёма телеметрии* и скопируйте значение `x-oneuptime-token`.
- **Форвардер Syslog** — любой инструмент, способный отправлять HTTP POST-запросы (например, `curl`, `rsyslog` через `omhttp` или `syslog-ng` с плагином HTTP-назначения).
- **Имя сервиса (необязательно)** — установите заголовок `x-oneuptime-service-name` для группировки входящих журналов под определённым телеметрическим сервисом. При отсутствии OneUptime использует `APP-NAME` syslog, имя хоста или `Syslog`.

## Конечная точка

```
POST https://oneuptime.com/syslog/v1/logs
```

- Замените `oneuptime.com` на ваш хост при самостоятельном хостинге OneUptime.
- Всегда включайте заголовок `x-oneuptime-token` в запрос.

## Тело запроса

Отправьте строки Syslog, разделённые символом новой строки, или JSON-нагрузку с массивом `messages`. Поддерживаются форматы RFC3164 (BSD) и RFC5424.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Поддерживаемые типы содержимого

- `application/json` — рекомендуется.
- `text/plain` — сообщения, разделённые символом новой строки.
- `application/octet-stream` — необработанные нагрузки. Также принимается gzip-сжатие (`Content-Encoding: gzip`).

## Быстрый тест с помощью curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Пересылка из rsyslog

1. Установите HTTP-модуль вывода:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Добавьте назначение в `/etc/rsyslog.d/oneuptime.conf`:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. Перезапустите rsyslog:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Распространённые варианты использования

### 1. Сетевые устройства и устройства безопасности

Большинство сетевого оборудования по-прежнему передаёт изменения конфигурации, срабатывания ACL и обнаружение угроз исключительно через syslog. Направьте ваш существующий ретранслятор (Palo Alto, Fortinet, Cisco ASA, Juniper, pfSense и другие) напрямую в OneUptime, или сохраните внутренний ретранслятор и пересылайте по HTTPS:

```bash
# Фрагмент rsyslog, пакетирующий сообщения в JSON и отправляющий в OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux-серверы и cron-задания

Многие cron-задания и устаревшие демоны по-прежнему записывают журналы исключительно через системный объект syslog. Пересылка `/var/log/syslog` или записей journald обеспечивает хранение операционных данных в одном месте. Хосты на Systemd могут использовать мост journald → syslog:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

Поскольку мы сопоставляем коды серьёзности, вы можете получать оповещения по `syslog.severity.name = "error"` или фильтровать по `syslog.hostname` для быстрого выявления шумных хостов.

### 3. Ingress-контроллеры Kubernetes и граничные узлы

Если у вас уже запущены Fluent Bit или Fluentd, оставьте их для журналов контейнеров и добавьте лёгкий приёмник syslog для хостов или устройств на периметре. Входной плагин `syslog` в Fluent Bit хорошо сочетается с HTTP-выводом:

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

Эта конфигурация позволяет принимать syslog с физических воркеров или аппаратных балансировщиков нагрузки без создания дополнительного стека журналирования.

### 4. Архивирование для соответствия требованиям без задержек

Нужно хранить журналы брандмауэра для PCI или SOX? Отправляйте их напрямую в OneUptime, применяйте длительную политику хранения к телеметрическому сервису и экспортируйте в холодное хранилище из одного места. Больше никакого экспорта из нескольких ретрансляторов syslog.

## Разобранные атрибуты

OneUptime автоматически добавляет следующие атрибуты к каждой записи журнала:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (сглаженные структурированные данные RFC5424)
- `syslog.raw` (исходное сообщение для обеспечения трассируемости)

Эти атрибуты становятся доступными для поиска в обозревателе журналов Телеметрия → Журналы.

## Устранение неполадок

- **HTTP 401 или пустые результаты** — убедитесь, что заголовок `x-oneuptime-token` принадлежит проекту, принимающему журналы.
- **Журналы не появляются** — убедитесь, что тело запроса действительно содержит строки syslog. Пустые тела отклоняются с HTTP 400.
- **Неожиданное имя сервиса** — установите `x-oneuptime-service-name` для переопределения логики определения по умолчанию.
- **Большие пакеты** — поддерживается пакетирование до 1000 строк в одном запросе. Большие пакеты помещаются в очередь и обрабатываются асинхронно.
