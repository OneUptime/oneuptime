# Интеграция с Prometheus Alertmanager

Превращайте уведомления [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) в инциденты OneUptime. Prometheus вычисляет ваши правила оповещения, Alertmanager маршрутизирует их, а OneUptime фиксирует и эскалирует.

Эта интеграция — **входящая**, и построить её можно двумя способами:

| Подход                                                                                  | Когда использовать                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Монитор входящих запросов](/docs/monitor/incoming-request-monitor)** (рекомендуется) | Вы хотите, чтобы оповещения становились инцидентами с эскалацией на дежурных, по одному инциденту на оповещение и с автозакрытием при восстановлении. Никакой своей логики поддерживать не нужно. |
| **[Рабочий процесс](/docs/workflows/index) с триггером Webhook**                        | Нужна логика маршрутизации, которой у OneUptime нет из коробки — вызвать другие системы, преобразовать нагрузку, ветвиться по условию.                                                            |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Предварительные требования

- Установка Prometheus + Alertmanager, где вы можете редактировать `alertmanager.yml`.
- Alertmanager должен иметь доступ к вашему экземпляру OneUptime по HTTPS.
- Проект OneUptime, где вы можете создавать мониторы (или рабочие процессы).

## Вариант 1 — Монитор входящих запросов

### Шаг 1 — Создайте монитор

1. Перейдите в **Мониторы → Создать монитор** и выберите **Входящий запрос**.
2. Откройте монитор и нажмите **Documentation** в левом меню. Скопируйте URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Используйте свой хост, если разворачиваете самостоятельно. Секретный ключ в пути — единственные учётные данные.

### Шаг 2 — Направьте Alertmanager на этот URL

В `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` обязателен — именно он сообщает OneUptime, что оповещение восстановилось. Перезагрузите Alertmanager командой `curl -X POST http://localhost:9093/-/reload` или перезапустите его.

Alertmanager отправляет `Content-Type: application/json`, который нужен OneUptime, чтобы читать поля из нагрузки.

### Шаг 3 — Настройте критерии

Откройте **Criteria** монитора и отредактируйте первый критерий.

**Фильтр**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  Кавычки вокруг плейсхолдера обязательны для строкового сравнения. Если не хотите использовать выражение, подойдёт и фильтр `Request Body` / `Contains` / `"status":"firing"`.

**Действия**

- Включите _When filters match, change monitor status_ и задайте **Offline** (или Degraded).
- Включите _When filters match, declare an incident_. Задайте **Title**, **Severity** и **On-Call Policies**, которых нужно вызвать.
- В разделе **Advanced Options** этого инцидента включите **Auto Resolve Incident**. Без этого уведомления о восстановлении игнорируются, а инциденты остаются открытыми навсегда.

**Settings → Group incidents and alerts by a payload field**

Включите это, чтобы одна конечная точка держала несколько одновременных инцидентов — по одному на оповещение — вместо одного инцидента на уведомление.

| Поле                               | Значение                            |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` разворачивается по массиву `alerts` Alertmanager, открывая по одному инциденту на каждое **уникальное** извлечённое значение. Поскольку `[*]` используется в обоих путях, восстановление оценивается по каждому оповещению: в нагрузке, где одно оповещение закрылось, а два ещё активны, закроется только закрывшееся.

> **Warning:** Группируйте по чему-то по-настоящему уникальному для каждого оповещения. `fingerprint` в Alertmanager — это хеш полного набора меток оповещения, поэтому он всегда уникален. Метка подойдёт, только если она меняется **внутри** одного уведомления, — а любая метка из `group_by` вашего маршрута не меняется никогда, потому что именно она и определяет группу агрегации. С приведённым выше `group_by: ["alertname", "instance"]` группировка по `requestBody.alerts[*].labels.alertname` извлечёт одно и то же значение из каждого оповещения в нагрузке, и все они схлопнутся в один инцидент. Хуже того, из повторяющихся значений сохраняется только **первое** вхождение, поэтому нагрузка, где первое оповещение — `resolved`, закроет этот инцидент, пока остальные ещё активны.

### Шаг 4 — Напишите заголовок и описание инцидента

Ключ группировки доступен как переменная, названная по последнему сегменту пути, поэтому `requestBody.alerts[*].fingerprint` даёт `{{fingerprint}}`. Это хеш, и показывать его дежурному не стоит — лучше формируйте заголовок инцидента из меток, общих для всего уведомления. `commonLabels` содержит все метки из `group_by` вашего маршрута, поэтому при конфигурации выше доступны и `alertname`, и `instance`:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` и `commonAnnotations` содержат поля, общие для всего уведомления. Путь к отдельному оповещению вроде `requestBody.alerts[0].annotations.summary` всегда читает _первое_ оповещение в нагрузке, а не то, ради которого был открыт именно этот инцидент, — поэтому держите `group_by` узким, если хотите, чтобы у каждого инцидента был свой текст аннотации. Путь, который не разрешается, выводится дословно, вместе с фигурными скобками, а не остаётся пустым. Полный список переменных см. в [Динамических шаблонах инцидентов и оповещений](/docs/monitor/incident-alert-templating).

### Шаг 5 — Верните монитор в Operational (необязательно)

Критерии срабатывают только при совпадении, поэтому добавьте второй критерий, чтобы монитор не оставался в Offline после того, как всё улеглось:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, и не объявляйте инцидент.

### Шаг 6 — Проверьте

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

Вы должны получить два инцидента — по одному на `fingerprint`. Отправьте запрос повторно со `status`, равным `resolved`, у обоих оповещений, и оба должны закрыться.

Можно также вызвать настоящее оповещение через `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Вариант 2 — Рабочий процесс

Используйте его, когда нужна логика сложнее, чем «оповещение становится инцидентом».

1. Откройте **Рабочие процессы → Создать рабочий процесс**, назовите его `Alertmanager → Incidents` и откройте **Конструктор**.
2. Добавьте триггер **Webhook** и **скопируйте его URL**. Переименуйте блок в `Alertmanager`.
3. Добавьте блок **Условия**, соединённый с триггером:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. Из выхода **Да** добавьте блок **Создать инцидент**:
   - **Заголовок**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Описание**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Серьёзность**: выберите один (или сначала ветвитесь по `{{Alertmanager.Request Body.commonLabels.severity}}`).
5. **Сохраните**, а затем направьте URL из `webhook_configs` в Шаге 2 выше на URL рабочего процесса.

Чтобы получать по инциденту на каждое оповещение, добавьте блок [Custom Code](/docs/workflows/components#custom-code), который перебирает `Request Body.alerts`. При `send_resolved: true` добавьте вторую ветку **Условия** по `status == resolved`, которая находит соответствующий инцидент и переводит его в ваш статус «решено» через **Update Incident**.

## Выключатель мёртвой руки

Ни один из вариантов не подскажет, когда перестал работать сам Prometheus: отсутствие оповещений выглядит ровно так же, как отсутствие проблем. Обычное решение — постоянно активное оповещение, направляемое на монитор, который ожидает его по расписанию. В [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) такое есть под именем `Watchdog`; на «голом» Prometheus добавьте правило оповещения с всегда истинным выражением (`vector(1)`).

Создайте **второй** монитор входящих запросов, направьте на него `Watchdog` с коротким `repeat_interval` и задайте этому монитору критерий **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes**. Это единственный случай, когда критерий отсутствующего запроса уместен на приёмнике оповещений.

Ниже — конфигурация из Шага 2 с добавленными маршрутом и приёмником watchdog: подмаршрут проверяется раньше собственного приёмника родительского маршрута, поэтому `Watchdog` уходит на второй монитор, а всё остальное по-прежнему на первый:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Устранение неполадок

- **Ничего не приходит** — убедитесь, что Alertmanager может достучаться до URL; проверьте его журналы на ошибки доставки. OneUptime отвечает на каждый запрос пустым `200` до всякой проверки, поэтому `200` не подтверждает, что нагрузка принята. Смотрите вместо этого таймлайн монитора.
- **Инциденты открываются, но не закрываются** — проверьте `send_resolved: true` в Alertmanager, поле и значение восстановления в критерии (сравнение чувствительно к регистру) и **Auto Resolve Incident** в **Advanced Options** инцидента. Есть две менее очевидные причины: нагрузка с большим числом уникальных ключей, чем **Max incidents per request**, скрывает ключи за пределами лимита и от восстановления; а если объединением на приёме (см. ниже) отброшено именно уведомление `resolved`, инцидент застревает навсегда, потому что Alertmanager повторяет уведомления о срабатывании, но не о закрытии. Такие инциденты закрывайте вручную.
- **Инцидентов нет вовсе, статус монитора не меняется** — путь группировки должен начинаться с буквального `requestBody.`, и подстановочным знаком является только первый `[*]` в пути. Обе ошибки происходят молча.
- **В тексте инцидента видны сырые плейсхолдеры `{{...}}`** — путь не разрешился, а OneUptime оставляет неразрешённые плейсхолдеры на месте, а не очищает их. Разные правила задают разные аннотации, поэтому ссылайтесь на поля, которые действительно есть у ваших правил (`commonAnnotations` против `annotations` каждого оповещения).
- **Один инцидент на нагрузку, полную оповещений** — вы сгруппировали по метке, которая не меняется внутри уведомления, чаще всего по той, что есть и в `group_by` вашего маршрута. Группируйте вместо этого по `requestBody.alerts[*].fingerprint`.
- **Слишком много инцидентов** — расширьте `group_by` / `group_interval`, чтобы Alertmanager объединял связанные оповещения. Снижение **Max incidents per request** ограничит их количество, но также скроет ключи за пределами лимита от восстановления.
- **Часть уведомлений будто пропускается при сильных всплесках** — запросы к одному и тому же монитору объединяются на приёме, чтобы один отправитель не мог его перегрузить, из-за чего промежуточная нагрузка может быть отброшена, если уведомления идут подряд. Увеличение `group_wait` и `group_interval` разносит их во времени. Объединение управляется переменной окружения `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` контейнера приложения, включённой по умолчанию; администраторы self-hosted-установок, которым нужно оценивать каждую нагрузку, могут выставить её в `false` на этом контейнере.

## Что читать дальше

- [Монитор входящих запросов](/docs/monitor/incoming-request-monitor) — тип монитора, его критерии и группировка инцидентов целиком.
- [Обзор интеграций](/docs/integrations/index) — входящий и исходящий паттерны.
- [Grafana](/docs/integrations/grafana) — та же идея для оповещений Grafana.
- [Триггер Webhook](/docs/workflows/triggers#webhook) — как работает принимающий URL рабочего процесса.
