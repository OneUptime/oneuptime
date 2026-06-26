# Интеграции

OneUptime подключается к инструментам, которыми уже пользуется ваша команда, — Zabbix, Jira, PagerDuty, Slack и многим другим, — через **[Workflows](/docs/workflows/index)**, встроенный движок автоматизации. Устанавливать отдельные плагины не нужно. Вы собираете интеграцию на холсте с перетаскиванием, и она запускается всякий раз, когда что-то происходит.

Эта страница объясняет два паттерна, которые используют все интеграции. Как только вы их поймёте, вы сможете подключить OneUptime практически к чему угодно — даже к инструментам, у которых нет собственной страницы здесь.

## Два паттерна

Каждая интеграция передаёт данные в одном из двух направлений (многие используют оба).

### Входящий — другой инструмент отправляет данные в OneUptime

Используйте этот паттерн, когда внешняя система должна _создать или обновить что-то в OneUptime_ — обычно открыть инцидент или оповещение, когда обнаруживает проблему.

1. Создайте рабочий процесс, начинающийся с **[триггера Webhook](/docs/workflows/triggers#webhook)**. OneUptime выдаст вам уникальный URL.
2. В другом инструменте настройте webhook или действие уведомления, которое отправляет `POST` на этот URL при наступлении события.
3. В рабочем процессе прочитайте входящую нагрузку и используйте компонент **Create Incident** (или Create Alert), чтобы зафиксировать её.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Исходящий — OneUptime отправляет данные в другой инструмент

Используйте этот паттерн, когда _что-то в OneUptime должно отобразиться в другом инструменте_ — открыть тикет в Jira, вызвать кого-то через PagerDuty, опубликовать в Slack.

1. Создайте рабочий процесс с **[триггером события OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** — например, **Incident → On Create**.
2. Добавьте **[компонент API](/docs/workflows/components#api)**, который вызывает REST API другого инструмента с деталями инцидента.
3. Храните любые API-ключи как **секретные [глобальные переменные](/docs/workflows/variables#global-variables)**, чтобы они никогда не появлялись в рабочем процессе или его журналах.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Каталог

| Инструмент                                                            | Направление            | Что делает                                                                            |
| --------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Входящий               | Превращает проблемы Zabbix в инциденты OneUptime (и разрешает их при восстановлении). |
| [Jira](/docs/integrations/jira)                                       | Исходящий (+ входящий) | Открывает задачу Jira для каждого инцидента; синхронизирует статус обратно.           |
| [PagerDuty](/docs/integrations/pagerduty)                             | Исходящий (+ входящий) | Создаёт и разрешает события PagerDuty из инцидентов OneUptime.                        |
| [Opsgenie](/docs/integrations/opsgenie)                               | Исходящий (+ входящий) | Создаёт и закрывает оповещения Opsgenie.                                              |
| [ServiceNow](/docs/integrations/servicenow)                           | Исходящий (+ входящий) | Открывает инциденты ServiceNow из OneUptime.                                          |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Входящий               | Преобразует уведомления Alertmanager в инциденты.                                     |
| [Grafana](/docs/integrations/grafana)                                 | Входящий               | Преобразует оповещения Grafana в инциденты.                                           |
| [Datadog](/docs/integrations/datadog)                                 | Входящий               | Преобразует оповещения мониторов Datadog в инциденты.                                 |
| [GitHub](/docs/integrations/github)                                   | Исходящий              | Открывает задачу GitHub для инцидента.                                                |
| [GitLab](/docs/integrations/gitlab)                                   | Исходящий              | Открывает задачу GitLab для инцидента.                                                |
| [Discord](/docs/integrations/discord)                                 | Исходящий              | Публикует обновления инцидентов в канал Discord.                                      |
| [Telegram](/docs/integrations/telegram)                               | Исходящий              | Отправляет обновления инцидентов в чат Telegram.                                      |
| [Slack](/docs/workspace-connections/slack)                            | Оба                    | Нативное подключение рабочего пространства — каналы, оповещения и дежурства.          |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Оба                    | Нативное подключение рабочего пространства.                                           |

> **Slack и Microsoft Teams** имеют более глубокую нативную интеграцию, выходящую за рамки рабочих процессов: автоматические каналы инцидентов, двусторонние действия и уведомления о дежурствах. Для них используйте подключения рабочих пространств [Slack](/docs/workspace-connections/slack) и [Microsoft Teams](/docs/workspace-connections/microsoft-teams), а не собирайте рабочий процесс вручную.

## Работа с секретами

Никогда не вставляйте API-ключ или токен прямо в блок. Вместо этого:

1. Перейдите в **Workflows → Global Variables**.
2. Создайте переменную — например, `JIRA_AUTH` — и включите **Is Secret**.
3. Ссылайтесь на неё в любом месте через `{{variable.JIRA_AUTH}}`.

Секретные переменные скрываются в интерфейсе после сохранения и очищаются из журналов запусков. См. [Переменные](/docs/workflows/variables#global-variables).

## Шпаргалка по аутентификации

Большинству исходящих интеграций требуется заголовок `Authorization` в блоке API. Распространённые схемы:

| Схема                         | Значение заголовка                         | Используется в                 |
| ----------------------------- | ------------------------------------------ | ------------------------------ |
| Bearer-токен                  | `Bearer {{variable.TOKEN}}`                | GitHub, многие современные API |
| Basic auth                    | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow               |
| Заголовок с API-ключом        | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                       |
| Токен в теле                  | поле `routing_key` в теле JSON             | PagerDuty Events API           |
| Заголовок с приватным токеном | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                         |

Для Basic auth: закодируйте `username:password` (или `email:api_token`) в base64 **один раз**, затем сохраните результат как секрет. На macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Нет вашего инструмента?

Практически любой инструмент подходит под один из двух паттернов выше:

- Если инструмент умеет **отправлять webhook** при наступлении события — используйте **входящий** паттерн: направьте его webhook на триггер Webhook в OneUptime.
- Если у инструмента есть **REST API** — используйте **исходящий** паттерн: вызовите его из **компонента API**.
- Если нужно преобразовать данные между двумя частями — добавьте блок **[Custom Code](/docs/workflows/components#custom-code)**.

Это охватывает длинный хвост: Zendesk, AWS CloudWatch (через SNS), New Relic, Splunk, StatusCake и т. д. Рецепт одинаков; меняются только URL и нагрузка.

## Что читать дальше

- [Обзор рабочих процессов](/docs/workflows/index) — как работает движок автоматизации.
- [Триггеры](/docs/workflows/triggers) — Webhook и триггеры событий OneUptime подробно.
- [Компоненты](/docs/workflows/components) — компоненты API, Webhook и данных.
- [Переменные](/docs/workflows/variables) — секреты и передача данных между блоками.
- [Zabbix](/docs/integrations/zabbix) и [Jira](/docs/integrations/jira) — полные рабочие примеры.
