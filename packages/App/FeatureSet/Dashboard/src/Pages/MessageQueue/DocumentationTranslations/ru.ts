import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Amazon SNS появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Спаны называют систему через `messaging.system` = `aws.sns` (также принимаются: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Очереди берутся из спанов обмена сообщениями, которые ваша инструментация OpenTelemetry уже создаёт; ничего специфичного для OneUptime не нужно.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует вызовы SNS в AWS SDK без изменений в коде.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: пакет `OpenTelemetry.Instrumentation.AWS` с `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; его набор атрибутов по умолчанию вообще не называет топик SNS.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` трассирует AWS SDK.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: пакет `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, подключается через `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Любой другой клиент**: используйте собственную поддержку OpenTelemetry в клиентской библиотеке или задайте `messaging.system` = `aws.sns`, `messaging.destination.name` и вид спана (PRODUCER при публикации, CONSUMER при потреблении) на спанах вокруг ваших отправок и обработчиков.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Затем направьте экспортер OTLP на OneUptime. Большинство SDK и агентов читают эти переменные окружения:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Этот токен — секрет.** Используйте ключ приёма типа **Сервер**, который хранится в секретах\n> вашего развёртывания. Никогда не помещайте ключ «Сервер» в JavaScript браузера — для этого есть\n> ключ приёма типа **Браузер**.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Читайте метрики топиков из CloudWatch приёмником `aws_cloudwatch` коллектора или передавайте их потоком через CloudWatch Metric Stream и Amazon Data Firehose в его приёмник `awsfirehose`.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "Приёмник `aws_cloudwatch` опрашивает API `GetMetricData` CloudWatch с учётными данными AWS SDK по умолчанию (окружение, общий профиль или роль экземпляра), которым нужны `cloudwatch:ListMetrics` и `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Не задавайте `stats`.** Без него каждая метрика приходит как одна сводка за период — именно её и читает OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` должен быть задан: он ограничивает число метрик, читаемых за один сбор.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` ждёт, пока CloudWatch опубликует период, поэтому с этой конфигурацией метрики брокера очереди приходят с опозданием на 11–17 минут: монитору по ним нужно более длинное окно (см. **Запаздывающие метрики** в разделе [Оповещения](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Один приёмник читает один регион и одно пространство имён: добавьте по экземпляру на каждый регион.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Чтобы вместо этого передавать метрики потоком — через CloudWatch Metric Stream и Amazon Data Firehose в приёмник `awsfirehose` коллектора, — см. [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Отправьте несколько сообщений через ваши очереди. Каждые 10 минут OneUptime читает спаны за последние 15 минут и показывает в разделе **Очереди** каждое назначение, которое называют хотя бы 3 из них (спаны любого вида, кроме SERVER). В OneUptime с самостоятельным размещением это число задаёт `MESSAGE_QUEUE_MIN_SPANS`.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Одна точка данных метрики брокера, которую страница очереди показывает на графике, тоже создаёт её очередь: метрики облачного мониторинга приходят с опозданием, поэтому каждый запуск читает их за последние 60 минут. Метрики клиентов обмена сообщениями и ваши собственные метрики с `messaging.system` и `messaging.destination.name` никогда не создают очередь: они показываются на вкладке **Метрики** уже существующей очереди.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Очереди создаются сами только до тех пор, пока проект не исчерпал свой [бюджет автосоздания](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Обзор очереди показывает эти метрики на графиках в разделе **Состояние брокера**, и у каждого измерителя и каждого количества за период есть **Создать монитор**. Пока ни одна не пришла, раздел подсказывает, откуда они берутся.",
  "| Metric | Shown as | Type |": "| Метрика | Показывается как | Тип |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-поток: `numberofmessagespublished`) | Опубликованные сообщения | Количество за период |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-поток: `numberofnotificationsdelivered`) | Доставленные уведомления | Количество за период |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-поток: `numberofnotificationsfailed`) | Неудачные уведомления | Количество за период |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-поток: `numberofnotificationsredriventodlq`) | Перенаправлено в очередь недоставленных | Количество за период |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Её спаны не называют ни одной системы обмена сообщениями, которую OneUptime умеет распознать: спаны Celery, собственная телеметрия BullMQ или самописный клиент. Добавьте `messaging.system` и `messaging.destination.name` и задайте спанам вид PRODUCER или CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Её имя из тех, что OneUptime игнорирует (см. [Что игнорируется](/docs/telemetry/queues#what-is-ignored)), или её называют только спаны SERVER.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- За последние 15 минут пришло меньше 3 её спанов, или проект исчерпал свой [бюджет автосоздания](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Если её спаны всё же её называют, создайте её вручную с той же системой и тем же назначением (**Очереди → Создать: Очередь**): её вкладка **Трассировки** заполнится из уже сохранённых спанов.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "См. [Очередь, которую используют мои приложения, не была создана](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) на странице документации об очередях.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Проверьте журнал коллектора. OneUptime отклоняет неверный ключ приёма с кодом `401` (`422` для отключённого ключа или ключа «Браузер»), а коллектор пишет `Exporting failed` для каждого отброшенного пакета.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Данные запаздывают. `aws_cloudwatch` ждёт `delay` (10 минут), пока CloudWatch опубликует данные, поэтому его точки приходят с опозданием на 11–17 минут.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "См. [Состояние брокера остаётся пустым](/docs/telemetry/queues#broker-health-stays-empty) на странице документации об очередях.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Его называют две системы: клиент Kafka на конечной точке Kafka в Event Hubs сообщает `kafka`, а SDK Event Hubs — `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- У одного наблюдения Service Bus или Event Hubs нет пространства имён: эмулятор или собственный домен.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- Спаны RabbitMQ обычно называют exchange, а метрики брокера — очередь: в OneUptime получаются две очереди, если только у exchange и очереди не одно имя.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Заархивируйте ненужную: архивированная очередь остаётся архивированной, и то, что её называет, больше не создаёт новую.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "См. [Две очереди для одного назначения](/docs/telemetry/queues#two-queues-for-one-destination) на странице документации об очередях.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Назначение, названное по запросу или по потребителю, которое OneUptime не распознаёт, — числовой суффикс, хеш — порождает по очереди на каждое имя. UUID уже сворачиваются (см. [Что игнорируется](/docs/telemetry/queues#what-is-ignored)). Пометьте такие назначения в инструментации как `messaging.destination.temporary=true` или дайте им стабильное имя, а затем архивируйте уже созданные очереди.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "См. [Новая очередь для каждого запроса](/docs/telemetry/queues#a-new-queue-for-every-request) на странице документации об очередях.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Amazon SQS появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует вызовы SQS в AWS SDK без изменений в коде.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: пакет `OpenTelemetry.Instrumentation.AWS` с `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; его набор атрибутов по умолчанию называет очередь SQS только по её URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` или `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), подключается через `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Его спаны SQS несут URL очереди в `server.address`, который OneUptime читает как очередь.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Читайте метрики очередей из CloudWatch приёмником `aws_cloudwatch` коллектора или передавайте их потоком через CloudWatch Metric Stream и Amazon Data Firehose в его приёмник `awsfirehose`.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-поток: `approximatenumberofmessagesvisible`) | Видимые сообщения | Измеритель |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-поток: `approximateageofoldestmessage`) | Возраст самого старого сообщения | Измеритель |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-поток: `approximatenumberofmessagesnotvisible`) | Сообщения в обработке | Измеритель |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-поток: `numberofmessagessent`) | Отправленные сообщения | Количество за период |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-поток: `numberofmessagesreceived`) | Полученные сообщения | Количество за период |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-поток: `numberofmessagesdeleted`) | Удалённые сообщения | Количество за период |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Apache ActiveMQ появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Спаны называют систему через `messaging.system` = `activemq` (также принимаются: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: агент OpenTelemetry для Java трассирует клиенты JMS — ActiveMQ, Artemis, IBM MQ и любого другого брокера JMS — без изменений в коде. Спаны JMS говорят `jms`, какой бы брокер за ними ни стоял; очередь ActiveMQ привязана к этому семейству JMS, поэтому спаны её клиентов и метрики её брокера попадают в одну очередь.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "У коллектора нет приёмника JMX, поэтому запустите OpenTelemetry JMX Scraper с `OTEL_JMX_TARGET_SYSTEM=activemq` рядом с брокером ActiveMQ Classic; он отправляет метрики назначений брокера по OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Разрешите брокеру принимать подключения JMX. С образом `apache/activemq-classic` или скриптом `bin/activemq` задайте `ACTIVEMQ_SUNJMX_START` перед его запуском. В этом примере аутентификация отключена: держите порт в частной сети или включите `jmxremote.authenticate` с файлом паролей и передайте скрейперу `OTEL_JMX_USERNAME` и `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Запустите скрейпер там, где он может достучаться до этого порта, со средой выполнения Java. Он отправляет данные прямо в OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` сохраняет имена метрик, которые скрейпер использует начиная с 1.53.0-alpha (`activemq.message.queue.size`, с назначением в `messaging.destination.name`); OneUptime читает и старые имена (`activemq.message.current`, с назначением в `destination`). У ActiveMQ Artemis другие MBean, которые эти правила не читают.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Одна точка данных метрики брокера, которую страница очереди показывает на графике, тоже создаёт её очередь. Метрики клиентов обмена сообщениями и ваши собственные метрики с `messaging.system` и `messaging.destination.name` никогда не создают очередь: они показываются на вкладке **Метрики** уже существующей очереди.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Размер очереди | Измеритель |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Размер очереди (старые имена) | Измеритель |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Поставлено в очередь | Счётчик, на графике в секунду |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Извлечено из очереди | Счётчик, на графике в секунду |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Истёк | Счётчик, на графике в секунду |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Потребители | Измеритель |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Среднее время в очереди | Измеритель |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Среднее время в очереди (старые имена) | Измеритель |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Метрика называет очередь иначе, чем спаны (см. [Ограничения](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Apache Kafka появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Спаны называют систему через `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует производителей и потребителей Kafka без изменений в коде.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` с пакетом `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` трассирует `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` или `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: автоинструментация OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, в Linux) трассирует производителей и потребителей `segmentio/kafka-go` без изменений в коде.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Приёмник `kafka_metrics` коллектора читает отставание групп потребителей и смещения разделов у брокеров; включите его скрейперы `topics` и `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Для кластера с SASL или TLS раскомментируйте `auth` и `tls`. Приёмник называет каждый топик в `topic`, и так метрики находят очередь топика. Отставание и зафиксированные смещения группы потребителей он сообщает только по топикам, в которых группа зафиксировала смещение, и пропускает топики, чьи имена начинаются с `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Отставание потребителей | Измеритель |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Отставание раздела | Измеритель |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Получено | Счётчик, на графике в секунду |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Произведено | Счётчик, на графике в секунду |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka сообщает отставание группы потребителей только после того, как группа зафиксирует смещение. Приёмник пропускает топики, чьи имена начинаются с `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Apache Pulsar появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Спаны называют систему через `messaging.system` = `pulsar` (также принимаются: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует клиенты Pulsar без изменений в коде.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Каждый брокер отдаёт метрики своих топиков и подписок на порту своей веб-службы; опрашивайте каждый брокер, потому что брокер сообщает только о топиках, которыми он сейчас владеет.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar помечает каждый ряд полным именем топика (`persistent://public/default/orders`), а ряды раздела — именем раздела: разделы суммируются в свой топик.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Накопившиеся сообщения | Измеритель |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Накопившиеся сообщения подписки | Измеритель |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Возраст накопившихся сообщений | Измеритель |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Входящие сообщения | Счётчик, на графике в секунду |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Исходящие сообщения | Счётчик, на графике в секунду |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Apache RocketMQ появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует клиенты RocketMQ без изменений в коде.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Задайте `metricsExporterType=PROM` в `broker.conf` брокера, чтобы брокер отдавал свои метрики отставания и пропускной способности.",
  "Then scrape every broker:": "Затем опрашивайте каждый брокер:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Готовые сообщения | Измеритель |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Отправлено в очередь недоставленных | Счётчик, на графике в секунду |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Azure Event Grid появляются в OneUptime сами, из спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "В Azure Monitor есть метрики доставки и недоставленных сообщений топиков, которые читает приёмник `azure_monitor` коллектора; на странице очереди они пока не показываются, поэтому изучайте их в разделе «Метрики».",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Приёмник входит через расширение `azure_auth`: выдайте субъекту-службе роль **Monitoring Reader** в подписке и задайте `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` и `AZURE_SUBSCRIPTION_ID` в окружении коллектора.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Метрики клиентов обмена сообщениями и ваши собственные метрики с `messaging.system` и `messaging.destination.name` никогда не создают очередь: они показываются на вкладке **Метрики** уже существующей очереди.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime не строит графики метрик брокера для Azure Event Grid в разделе **Состояние брокера**: то, что отправляет коллектор выше, попадает только в обозреватель **Метрики**. Метрика, у которой на каждой точке данных есть `messaging.system` и `messaging.destination.name`, показывается на вкладке **Метрики** очереди.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- У Azure Event Grid нет метрик на графиках. Его метрики находятся в обозревателе **Метрики**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Azure Event Hubs появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK для Java трассирует себя сам, а агент OpenTelemetry для Java связывает эту трассировку с OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: спаны OpenTelemetry в Azure SDK экспериментальные: задайте `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (или переключатель `Azure.Experimental.EnableActivitySource`) и подпишитесь на источники Azure через `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: зарегистрируйте `createAzureSdkInstrumentation()` из `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: установите `azure-core-tracing-opentelemetry` и задайте `settings.tracing_implementation = "opentelemetry"` (из `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Подключённая подписка Azure читает ключевые метрики пространства имён для каждого концентратора событий, и ничего запускать не нужно. Чтобы читать все метрики, запустите приёмник `azure_monitor` коллектора, который разделяет их по концентраторам событий по измерению EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Приёмник получает список ваших пространств имён раз в сутки, поэтому новое может появиться только через 24 часа.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Входящие сообщения | Количество за период |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Исходящие сообщения | Количество за период |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Ошибки сервера | Количество за период |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Ошибки пользователя | Количество за период |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Ошибки превышения квоты | Количество за период |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Ограниченные запросы | Количество за период |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Размер | Измеритель |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Метрика называет очередь иначе, чем спаны. Спаны Service Bus и Event Hubs без хоста пространства имён попадают в другую очередь, чем метрики Azure Monitor (см. [Ограничения](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor возвращает 10 очередей на метрику и пространство имён, если не увеличить `maximum_number_of_records_per_resource`. Конфигурация на шаге 3 его увеличивает.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Приёмник получает список ваших пространств имён раз в сутки, поэтому новое пространство имён может появиться с задержкой до 24 часов.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Azure Service Bus появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Подключённая подписка Azure читает ключевые метрики пространства имён для каждой очереди и топика, и ничего запускать не нужно. Чтобы читать все метрики, запустите приёмник `azure_monitor` коллектора, который разделяет их по очередям и топикам по измерению EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Активные сообщения | Измеритель |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Сообщения в очереди недоставленных | Измеритель |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Запланированные сообщения | Измеритель |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Завершённые сообщения | Количество за период |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Отклонённые сообщения | Количество за период |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Задержка отправки на сервере | Измеритель |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди BullMQ появляются в OneUptime сами, из спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "Собственная телеметрия BullMQ (его опция `telemetry`, которую реализует пакет `bullmq-otel`) называет очередь в `bullmq.queue.name` и не задаёт `messaging.system`, поэтому сама по себе очередь не создаёт. Процессор `transform` в коллекторе, в который отправляют данные ваши приложения, добавляет два ключа, которые читает OneUptime, к спанам, которые добавляют и обрабатывают задания, и к собственным метрикам BullMQ:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Помечаются только спаны PRODUCER, которые добавляют задания, и спаны CONSUMER, которые их обрабатывают: внутренние спаны BullMQ тоже называют очередь, но сообщениями не являются. Направьте экспортер OTLP ваших приложений на этот коллектор.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ хранит свои задания в Redis, и у него нет брокера, который можно опрашивать; сообщайте глубину очереди из приложения как метрику, несущую `messaging.system` и `messaging.destination.name`, как это делают собственные воркеры OneUptime с `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Наблюдайте количество заданий в приложении; измерителю, который сам несёт оба ключа, преобразование не нужно:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime не строит графики метрик брокера для BullMQ в разделе **Состояние брокера**. Всё, что отправляет коллектор, есть в обозревателе **Метрики**, а метрика, у которой на каждой точке данных есть `messaging.system` и `messaging.destination.name`, показывается на вкладке **Метрики** очереди.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Её спаны не называют ни одной системы обмена сообщениями, которую OneUptime умеет распознать: спаны Celery, собственная телеметрия BullMQ или самописный клиент. Добавьте `messaging.system` и `messaging.destination.name` и задайте спанам вид PRODUCER или CONSUMER. Для BullMQ это делает преобразование на шаге 2.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- У BullMQ нет метрик на графиках. Его метрики находятся в обозревателе **Метрики**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди Google Cloud Pub/Sub появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: клиент трассирует себя сам, как только его билдеры `Publisher` и `Subscriber` получают экземпляр OpenTelemetry и переключатель трассировки — `setOpenTelemetry(GlobalOpenTelemetry.get())` и `setEnableOpenTelemetryTracing(true)`. По отдельности ни один из вызовов ничего не трассирует.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: через `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` и `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: через `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Читайте метрики топиков и подписок из Cloud Monitoring приёмником `googlecloudmonitoring` коллектора, перечисляя каждый тип метрики в `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Приёмник входит с Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` или сервисный аккаунт, под которым работает коллектор), которым нужна роль **Monitoring Viewer** в проекте. Задайте в `project_id` ваш проект:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Тип метрики, которого нет в `metrics_list`, никогда не читается. Метрики подписки относятся к очереди подписки (`subscription_id`), метрики топика — к очереди топика (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Недоставленные сообщения | Измеритель |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Возраст самого старого неподтверждённого сообщения | Измеритель |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Сообщения в очереди недоставленных | Количество за период |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Подтверждённые сообщения | Количество за период |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Запросы публикации | Количество за период |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- Метрика называет очередь иначе, чем спаны. У топика Pub/Sub — метрики топика, а у его подписок — метрики подписок.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring читает только типы из `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Данные запаздывают. Метрики Pub/Sub приходят с опозданием в несколько минут.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди JMS появляются в OneUptime сами, из спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS — это API, и его спаны не называют брокер, который стоит за ним; когда брокер — Apache ActiveMQ, запустите для него OpenTelemetry JMX Scraper, и его метрики присоединятся к той же очереди, которая затем отображается как очередь ActiveMQ, а у других JMS-брокеров, таких как IBM MQ, готового пути для метрик нет.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Его метрики попадают в ту же очередь, что и спаны JMS, и с этого момента она показывается как очередь Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime не строит графики метрик брокера для JMS в разделе **Состояние брокера**. Всё, что отправляет коллектор, есть в обозревателе **Метрики**, а метрика, у которой на каждой точке данных есть `messaging.system` и `messaging.destination.name`, показывается на вкладке **Метрики** очереди.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Как только приходят метрики брокера Apache ActiveMQ, очередь показывается как очередь Apache ActiveMQ и строит по ним графики в разделе **Состояние брокера**: см. [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- У брокеров JMS, кроме ActiveMQ, нет метрик на графиках. Их метрики находятся в обозревателе **Метрики**. Для брокера ActiveMQ см. **Если брокер — Apache ActiveMQ** в разделе **Расширенный**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди NATS появляются в OneUptime сами, из спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует клиенты NATS — его инструментация NATS сообщает `messaging.system` = `nats` — без изменений в коде.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Запустите prometheus-nats-exporter с `-jsz=all`, направив его на порт мониторинга сервера. Его метрики JetStream относятся к потокам и потребителям, а не к subject-ам, поэтому не присоединяются к очередям уровня subject.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Включите порт мониторинга сервера через `-m 8222` (или `http_port: 8222` в его конфигурации), затем запустите экспортёр:",
  "And scrape it:": "И опрашивайте его:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime не строит графики метрик брокера для NATS в разделе **Состояние брокера**: то, что отправляет коллектор выше, попадает только в обозреватель **Метрики**. Метрика, у которой на каждой точке данных есть `messaging.system` и `messaging.destination.name`, показывается на вкладке **Метрики** очереди.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- У NATS нет метрик на графиках. Его метрики находятся в обозревателе **Метрики**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Очереди RabbitMQ появляются в OneUptime сами, из двух источников: спанов обмена сообщениями от приложений, которые публикуют в них и потребляют из них, и собственных метрик брокера. Очередь можно добавить и вручную: **Очереди → Создать: Очередь**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: агент OpenTelemetry для Java трассирует клиенты RabbitMQ без изменений в коде.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 трассирует себя сам: подпишитесь на `RabbitMQ.Client.*`. MassTransit тоже трассирует себя сам: подпишитесь на `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` или `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Приёмник `rabbitmq` коллектора читает глубину, потребителей и скорости сообщений каждой очереди из HTTP API плагина управления от имени пользователя с тегом `monitoring` и доступом к каждому виртуальному хосту.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Включите плагин управления и создайте этого пользователя. Один тег `monitoring` не показывает ему ни одной очереди: дайте ему доступ к каждому виртуальному хосту, который нужно отслеживать. Пустые шаблоны дают этот доступ без каких-либо прав на настройку, публикацию или потребление:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Задайте `RABBITMQ_USERNAME` и `RABBITMQ_PASSWORD` в окружении коллектора. Приёмник сообщает каждую очередь под её именем в RabbitMQ, а спаны большинства инструментаций называют exchange, через который прошло сообщение: они совпадают для сообщений, отправленных через exchange по умолчанию, ключ маршрутизации которого — имя очереди.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Глубина очереди | Измеритель |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Опубликовано | Счётчик, на графике в секунду |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Доставлено | Счётчик, на графике в секунду |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Подтверждён | Счётчик, на графике в секунду |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Отброшено | Счётчик, на графике в секунду |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- Метрика называет очередь иначе, чем спаны. Спаны RabbitMQ обычно называют exchange, а метрики брокера описывают очереди. Они совпадают для сообщений, отправленных через exchange по умолчанию, ключ маршрутизации которого — имя очереди.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ сообщает только очереди виртуальных хостов, к которым у его пользователя есть доступ, и не пишет ошибок для остальных. Счётчики RabbitMQ появляются с первой активностью.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Amazon SNS `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` ждёт, пока CloudWatch опубликует период, поэтому с этой конфигурацией метрики брокера этой очереди приходят с опозданием на 11–17 минут: монитору по ним нужно более длинное окно (см. **Запаздывающие метрики** в разделе [Оповещения](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Отправьте несколько сообщений через `orders`. Каждый спан, который называет эту очередь, помечается ею, когда OneUptime его принимает: спаны заполняют **Обзор** — опубликованные и потреблённые сообщения, ошибки и время обработки, а также сервисы в разделах **Производители** и **Потребители** — и вкладку **Трассировки**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Состояние брокера** в Обзоре заполняется метриками брокера по мере их поступления: с конфигурацией из шага 3 метрики CloudWatch приходят с опозданием на 11–17 минут.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "В заголовке появляется **Недавно на связи**, как только обнаружение находит спаны или метрики брокера, называющие эту очередь. Оно запускается каждые 10 минут и смотрит телеметрию за последние 15 минут, а метрики облачного мониторинга, которые приходят с опозданием, — за последние 60 минут.",
  "Names are compared without regard to case.":
    "Имена сравниваются без учёта регистра.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Спаны**: `messaging.system` = `aws.sns` (или `aws_sns`, `amazonsns` или `sns`) и назначение `orders` — в `messaging.destination.name` или в более старом ключе, например `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Метрики брокера**: `Dimensions.TopicName` или `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Amazon SQS `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Apache ActiveMQ `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Состояние брокера** в Обзоре заполняется метриками брокера по мере их поступления.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "В заголовке появляется **Недавно на связи**, как только обнаружение находит спаны или метрики брокера, называющие эту очередь. Оно запускается каждые 10 минут и смотрит телеметрию за последние 15 минут.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- Спаны клиентов JMS говорят `jms`, какой бы брокер за ними ни стоял, поэтому они и метрики брокера Apache ActiveMQ попадают в эту одну очередь.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "Хост JMX заполнен заранее по адресу брокера, который сообщает телеметрия этой очереди (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Apache Kafka `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Спаны**: `messaging.system` = `kafka` и назначение `orders` — в `messaging.destination.name` или в более старом ключе, например `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Метрики брокера**: `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Для кластера с SASL или TLS раскомментируйте `auth` и `tls`. Брокер начальной загрузки заполнен заранее по адресу брокера, который сообщает телеметрия этой очереди (`broker-1.example.com:9092`); измените его, если коллектор достигает брокера другим путём. Приёмник называет каждый топик в `topic`, и так метрики находят очередь топика. Отставание и зафиксированные смещения группы потребителей он сообщает только по топикам, в которых группа зафиксировала смещение, и пропускает топики, чьи имена начинаются с `_`.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Apache Pulsar `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Спаны**: `messaging.system` = `pulsar` (или `apache_pulsar`) и назначение `orders` — в `messaging.destination.name` или в более старом ключе, например `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Apache RocketMQ `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Это очередь Azure Event Grid `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из метрик, которые несут её `messaging.system` и `messaging.destination.name`. Всё ниже заполнено для этой очереди заранее.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Метрики, у которых на каждой точке данных есть её `messaging.system` и `messaging.destination.name`, показываются на её вкладке **Метрики**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "В заголовке появляется **Недавно на связи**, как только обнаружение находит спаны или метрики клиентов обмена сообщениями, называющие эту очередь. Оно запускается каждые 10 минут и смотрит телеметрию за последние 15 минут.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Azure Event Hubs `orders` в пространстве имён `orders-ns`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Спаны**: `messaging.system` = `eventhubs` (или `azure_eventhubs`, `azure.eventhubs` или `microsoft.eventhub`) и назначение `orders` — в `messaging.destination.name` или в более старом ключе, например `messaging.destination`, от SDK, подключённого к `orders-ns.servicebus.windows.net`.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Метрики брокера**: `metadata_entityname` = `orders`, в пространстве имён, чей `name` — `orders-ns`.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Azure Service Bus `orders` в пространстве имён `orders-ns`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Это очередь BullMQ `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из метрик, которые несут её `messaging.system` и `messaging.destination.name`. Всё ниже заполнено для этой очереди заранее.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь Google Cloud Pub/Sub `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Это очередь JMS `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из метрик, которые несут её `messaging.system` и `messaging.destination.name`. Всё ниже заполнено для этой очереди заранее.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Его метрики попадают в эту очередь, и с этого момента она показывается как очередь Apache ActiveMQ.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Это очередь NATS `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из метрик, которые несут её `messaging.system` и `messaging.destination.name`. Всё ниже заполнено для этой очереди заранее.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Это очередь RabbitMQ `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из собственных метрик брокера. Всё ниже заполнено для этой очереди заранее.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Задайте `RABBITMQ_USERNAME` и `RABBITMQ_PASSWORD` в окружении коллектора. Хост конечной точки управления заполнен заранее по адресу брокера, который сообщает телеметрия этой очереди (`broker-1.example.com:9092`); измените его, если коллектор достигает брокера другим путём. Приёмник сообщает каждую очередь под её именем в RabbitMQ, а спаны большинства инструментаций называют exchange, через который прошло сообщение: они совпадают для сообщений, отправленных через exchange по умолчанию, ключ маршрутизации которого — имя очереди.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Это очередь `acme-bus` `orders`. Она заполняется из спанов обмена сообщениями от приложений, которые публикуют в неё и потребляют из неё, и из метрик, которые несут её `messaging.system` и `messaging.destination.name`. Всё ниже заполнено для этой очереди заранее.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime не знает эту систему обмена сообщениями, поэтому у него нет готового способа читать метрики брокера; отправляйте их с `messaging.system` и `messaging.destination.name` на каждой точке данных, и они привяжутся к очереди.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime не строит графики метрик брокера для `acme-bus` в разделе **Состояние брокера**. Всё, что отправляет коллектор, есть в обозревателе **Метрики**, а метрика, у которой на каждой точке данных есть `messaging.system` и `messaging.destination.name`, показывается на вкладке **Метрики** очереди.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Знакомая OneUptime система нужна только для собственных метрик брокера (см. [Поддерживаемые системы обмена сообщениями](/docs/telemetry/queues#supported-messaging-systems)). Его метрики находятся в обозревателе **Метрики**.",
};

export default TRANSLATION;
