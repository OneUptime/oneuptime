import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Span 以 `messaging.system` = `aws.sns` 标明系统（也接受：`aws_sns`、`amazonsns`、`sns`）。",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "队列来自你的 OpenTelemetry 检测已经产生的消息 span；不需要任何 OneUptime 专用的东西。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 AWS SDK 的 SNS 调用。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**：`OpenTelemetry.Instrumentation.AWS` 包，配合 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` 使用；它的默认属性集完全不会标明 SNS 主题。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**：`@opentelemetry/auto-instrumentations-node` 会追踪 AWS SDK。",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**：使用 `opentelemetry-instrumentation-botocore` 包。",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**：`otelaws`，通过 `otelaws.AppendMiddlewares(&cfg.APIOptions)` 添加。",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **其他任何客户端**：使用客户端库自带的 OpenTelemetry 支持，或者在发送和处理代码外围的 span 上设置 `messaging.system` = `aws.sns`、`messaging.destination.name` 和 span 类型（发布时为 PRODUCER，消费时为 CONSUMER）。",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "然后让 OTLP 导出器指向 OneUptime。大多数 SDK 和代理都会读取以下环境变量：",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **此令牌是机密。** 请使用 **服务器** 摄取密钥，并保存在你的部署的\n> 密钥库中。切勿把服务器密钥放进浏览器 JavaScript——那种场合\n> 有 **浏览器** 摄取密钥。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "用 Collector 的 `aws_cloudwatch` 接收器读取主题的 CloudWatch 指标，或者通过 CloudWatch Metric Stream 和 Amazon Data Firehose 把它们流式传输到 Collector 的 `awsfirehose` 接收器。",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch` 接收器使用 AWS SDK 的默认凭据（环境变量、共享配置文件或实例角色）轮询 CloudWatch 的 `GetMetricData` API，这些凭据需要 `cloudwatch:ListMetrics` 和 `cloudwatch:GetMetricData`：",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **不要设置 `stats`**。不设置时，每个指标按每个周期一条摘要到达，这正是 OneUptime 读取的内容。",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- 必须设置 `discovery.limit`，它限制每次抓取读取的指标数量。",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` 会等待 CloudWatch 发布一个周期，因此在此配置下，队列的 Broker 指标会延迟 11 到 17 分钟到达：基于它们的监视器需要更长的时间窗口（参见 [警报](/docs/telemetry/queues#alerting) 下的 **延迟到达的指标**）。",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- 一个接收器读取一个区域和一个命名空间：每个区域添加一个实例。",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "如果要改为流式传输指标（通过 CloudWatch Metric Stream 和 Amazon Data Firehose 发送到 Collector 的 `awsfirehose` 接收器），请参阅 [Amazon SQS](/docs/telemetry/queues#amazon-sqs)。",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "通过你的队列发送几条消息。OneUptime 每 10 分钟读取最近 15 分钟的 span，并在 **队列** 下列出其中至少 3 个 span 标明的每个目标（除 SERVER 以外任何类型的 span）。在自托管的 OneUptime 上，由 `MESSAGE_QUEUE_MIN_SPANS` 设置这个数量。",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "队列页面会绘图的 Broker 指标，哪怕只到达一个数据点，也会创建其队列：云监控指标会延迟到达，因此每次运行都会读取最近 60 分钟的数据。消息客户端指标，以及你自己带有 `messaging.system` 和 `messaging.destination.name` 的指标，都不会创建队列：它们显示在已有队列的 **指标** 选项卡上。",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "只有在项目尚未达到其 [自动创建额度](/docs/telemetry/queues#the-auto-create-budget) 时，队列才会自动创建。",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "队列的概览会在 **Broker 健康状况** 下绘制这些指标，每个仪表和每个周期计数都有 **创建监视器**。在第一个指标到达之前，该部分会说明它们从哪里来。",
  "| Metric | Shown as | Type |": "| 指标 | 显示为 | 类型 |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished`（JSON 流：`numberofmessagespublished`） | 已发布消息 | 每个周期的计数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered`（JSON 流：`numberofnotificationsdelivered`） | 已投递通知 | 每个周期的计数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed`（JSON 流：`numberofnotificationsfailed`） | 失败的通知 | 每个周期的计数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq`（JSON 流：`numberofnotificationsredriventodlq`） | 重新驱动到死信队列 | 每个周期的计数 |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- 它的 span 没有标明 OneUptime 能识别的消息系统：Celery 的 span、BullMQ 自身的遥测或自己编写的客户端都是这样。请添加 `messaging.system` 和 `messaging.destination.name`，并把 span 的类型设为 PRODUCER 或 CONSUMER。",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- 它的名称属于 OneUptime 忽略的名称（参见 [忽略的内容](/docs/telemetry/queues#what-is-ignored)），或者只有 SERVER span 标明了它。",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- 最近 15 分钟内到达的 span 少于 3 个，或者项目已达到其 [自动创建额度](/docs/telemetry/queues#the-auto-create-budget)。",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "如果它的 span 确实指明了它，请用相同的系统和目标手动创建它（**队列 → 创建队列**）：它的 **追踪** 选项卡会用已存储的 span 填充。",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "请参阅队列文档页面上的 [我的应用使用的队列没有被创建](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created)。",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- 检查 Collector 的日志。OneUptime 会以 `401` 拒绝错误的摄取密钥（已停用的密钥或浏览器密钥为 `422`），Collector 会为它丢弃的每个批次记录 `Exporting failed`。",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- 数据延迟到达。`aws_cloudwatch` 会等待 `delay`（10 分钟）让 CloudWatch 发布，因此它的数据点会延迟 11 到 17 分钟到达。",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "请参阅队列文档页面上的 [Broker 健康状况一直为空](/docs/telemetry/queues#broker-health-stays-empty)。",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- 两个系统都指明了它：Event Hubs 的 Kafka 端点上的 Kafka 客户端报告 `kafka`，Event Hubs SDK 报告 `eventhubs`。",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- 某次 Service Bus 或 Event Hubs 观测没有命名空间：模拟器或自定义域名。",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ 的 span 通常标明 exchange，而 Broker 的指标标明队列：除非 exchange 和队列同名，否则 OneUptime 中会出现两个队列。",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "归档你不需要的那个：已归档的队列会保持归档状态，指明它的内容也不再会创建新队列。",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "请参阅队列文档页面上的 [一个目标出现两个队列](/docs/telemetry/queues#two-queues-for-one-destination)。",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "按请求或按消费者命名、且 OneUptime 无法识别的目标（数字后缀、哈希）会为每个名称产生一个队列。UUID 已经会被合并（参见 [忽略的内容](/docs/telemetry/queues#what-is-ignored)）。请在检测中把这类目标标记为 `messaging.destination.temporary=true`，或给它们一个稳定的名称，然后归档已经创建的队列。",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "请参阅队列文档页面上的 [每个请求都产生一个新队列](/docs/telemetry/queues#a-new-queue-for-every-request)。",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 AWS SDK 的 SQS 调用。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**：`OpenTelemetry.Instrumentation.AWS` 包，配合 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` 使用；它的默认属性集只通过 URL 标明 SQS 队列。",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**：`opentelemetry-instrumentation-botocore` 或 `opentelemetry-instrumentation-boto3sqs`。",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**：`otelaws`（`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`），通过 `otelaws.AppendMiddlewares(&cfg.APIOptions)` 添加。它的 SQS span 在 `server.address` 中带有队列 URL，OneUptime 会把它读作队列。",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "用 Collector 的 `aws_cloudwatch` 接收器读取队列的 CloudWatch 指标，或者通过 CloudWatch Metric Stream 和 Amazon Data Firehose 把它们流式传输到 Collector 的 `awsfirehose` 接收器。",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible`（JSON 流：`approximatenumberofmessagesvisible`） | 可见消息 | 仪表 |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage`（JSON 流：`approximateageofoldestmessage`） | 最旧消息的时长 | 仪表 |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible`（JSON 流：`approximatenumberofmessagesnotvisible`） | 传输中的消息 | 仪表 |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent`（JSON 流：`numberofmessagessent`） | 已发送消息 | 每个周期的计数 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived`（JSON 流：`numberofmessagesreceived`） | 已接收消息 | 每个周期的计数 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted`（JSON 流：`numberofmessagesdeleted`） | 已删除消息 | 每个周期的计数 |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Span 以 `messaging.system` = `activemq` 标明系统（也接受：`artemis`、`activemq_artemis`）。",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 JMS 客户端（ActiveMQ、Artemis、IBM MQ 以及其他任何 JMS Broker）。无论背后是哪种 Broker，JMS span 都标明 `jms`；ActiveMQ 队列以该 JMS 系列为键，因此其客户端的 span 和其 Broker 的指标会落到同一个队列上。",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collector 没有 JMX 接收器，因此请在 ActiveMQ Classic broker 旁边以 `OTEL_JMX_TARGET_SYSTEM=activemq` 运行 OpenTelemetry JMX Scraper；它通过 OTLP 推送 broker 的目标指标。",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. 让 broker 接受 JMX 连接。使用 `apache/activemq-classic` 镜像或 `bin/activemq` 脚本时，在启动前设置 `ACTIVEMQ_SUNJMX_START`。此示例关闭了身份验证：把端口留在私有网络中，或者用密码文件开启 `jmxremote.authenticate`，并为抓取器提供 `OTEL_JMX_USERNAME` 和 `OTEL_JMX_PASSWORD`。",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. 在能访问该端口的位置，用 Java 运行时运行 Scraper。它会直接发送到 OneUptime：",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` 会保留 Scraper 自 1.53.0-alpha 起使用的指标名称（`activemq.message.queue.size`，目标在 `messaging.destination.name` 中）；OneUptime 也会读取旧名称（`activemq.message.current`，目标在 `destination` 中）。ActiveMQ Artemis 的 MBean 不同，这些规则不会读取。",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "队列页面会绘图的 Broker 指标，哪怕只到达一个数据点，也会创建其队列。消息客户端指标，以及你自己带有 `messaging.system` 和 `messaging.destination.name` 的指标，都不会创建队列：它们显示在已有队列的 **指标** 选项卡上。",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | 队列大小 | 仪表 |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | 队列大小（旧名称） | 仪表 |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | 已入队 | 计数器，按每秒速率绘图 |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | 已出队 | 计数器，按每秒速率绘图 |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | 已过期 | 计数器，按每秒速率绘图 |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | 消费者 | 仪表 |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | 队列中的平均时间 | 仪表 |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | 队列中的平均时间（旧名称） | 仪表 |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 指标对队列的命名与 span 不同（参见 [限制](/docs/telemetry/queues#limitations)）。",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Span 以 `messaging.system` = `kafka` 标明系统。",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 Kafka 生产者和消费者。",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**：`Confluent.Kafka` 配合 `OpenTelemetry.Instrumentation.ConfluentKafka` 包。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**：`@opentelemetry/auto-instrumentations-node` 会追踪 `kafkajs`。",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**：`opentelemetry-instrumentation-kafka-python`、`opentelemetry-instrumentation-confluent-kafka` 或 `opentelemetry-instrumentation-aiokafka`。",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**：OpenTelemetry Go 自动检测（`go.opentelemetry.io/auto`，eBPF，在 Linux 上）无需修改代码即可追踪 `segmentio/kafka-go` 的生产者和消费者。",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collector 的 `kafka_metrics` 接收器从 broker 读取消费者组滞后和分区偏移量；请启用它的 `topics` 和 `consumers` 抓取器。",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "对于使用 SASL 或 TLS 的集群，请取消 `auth` 和 `tls` 的注释。接收器在 `topic` 中标明每个主题，指标就是靠它找到主题的队列。它只在消费者组已提交过 offset 的主题上报告该组的延迟和已提交的 offset，并跳过名称以 `_` 开头的主题。",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | 消费者延迟 | 仪表 |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | 分区延迟 | 仪表 |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | 已消费 | 计数器，按每秒速率绘图 |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | 已生产 | 计数器，按每秒速率绘图 |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka 只有在消费者组提交 offset 之后才会报告该组的延迟。接收器会跳过名称以 `_` 开头的主题。",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Span 以 `messaging.system` = `pulsar` 标明系统（也接受：`apache_pulsar`）。",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 Pulsar 客户端。",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "每个 broker 都在其 Web 服务端口上提供主题和订阅指标；请抓取每个 broker，因为一个 broker 只报告它当前拥有的主题。",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar 用主题的完整名称（`persistent://public/default/orders`）标记每个序列，用分区的名称标记分区的序列：分区会汇总到其主题中。",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | 积压 | 仪表 |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | 订阅积压 | 仪表 |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | 积压时长 | 仪表 |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | 流入消息 | 计数器，按每秒速率绘图 |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | 流出消息 | 计数器，按每秒速率绘图 |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 RocketMQ 客户端。",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "在 broker 的 `broker.conf` 中设置 `metricsExporterType=PROM`，让 broker 提供它的滞后和吞吐量指标。",
  "Then scrape every broker:": "然后抓取每个 broker：",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | 就绪消息 | 仪表 |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | 已发送到死信队列 | 计数器，按每秒速率绘图 |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid 队列会根据向这些队列发布消息和从中消费消息的应用的消息 span，自动出现在 OneUptime 中。你也可以手动添加：**队列 → 创建队列**。",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor 有主题的投递和死信指标，由 Collector 的 `azure_monitor` 接收器读取；它们尚未在队列页面上绘制图表，请在指标中查看。",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "接收器通过 `azure_auth` 扩展登录：在订阅上为服务主体授予 **Monitoring Reader** 角色，并在 Collector 的环境中设置 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET` 和 `AZURE_SUBSCRIPTION_ID`。",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "消息客户端指标，以及你自己带有 `messaging.system` 和 `messaging.destination.name` 的指标，都不会创建队列：它们显示在已有队列的 **指标** 选项卡上。",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不会在 **Broker 健康状况** 下为 Azure Event Grid 绘制 Broker 指标：上面的 Collector 发送的数据只会进入 **指标** 浏览器。每个数据点都带有 `messaging.system` 和 `messaging.destination.name` 的指标会显示在队列的 **指标** 选项卡上。",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid 没有绘图的指标。它的指标在 **指标** 浏览器中。",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**：Azure SDK for Java 会追踪自身，OpenTelemetry Java 代理会把这些追踪接入 OpenTelemetry。",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**：Azure SDK 的 OpenTelemetry span 属于实验功能：设置 `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true`（或 `Azure.Experimental.EnableActivitySource` 开关），并用 `.AddSource("Azure.*")` 订阅 Azure 源。',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**：注册 `@azure/opentelemetry-instrumentation-azure-sdk` 中的 `createAzureSdkInstrumentation()`。",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**：安装 `azure-core-tracing-opentelemetry`，并设置 `settings.tracing_implementation = "opentelemetry"`（来自 `azure.core.settings`）。',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "已连接的 Azure 订阅无需运行任何程序，即可按事件中心读取命名空间的关键指标。要读取全部指标，请运行 Collector 的 `azure_monitor` 接收器，它按 EntityName 维度把指标拆分到每个事件中心。",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "接收器每天列出一次你的命名空间，因此新的命名空间最多可能需要 24 小时才会出现。",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | 传入消息 | 每个周期的计数 |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | 传出消息 | 每个周期的计数 |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | 服务器错误 | 每个周期的计数 |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | 用户错误 | 每个周期的计数 |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | 超出配额错误 | 每个周期的计数 |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | 被限流的请求 | 每个周期的计数 |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | 大小 | 仪表 |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 指标对队列的命名与 span 不同。没有命名空间主机的 Service Bus 和 Event Hubs span 与 Azure Monitor 的指标位于不同的队列（参见 [限制](/docs/telemetry/queues#limitations)）。",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- 除非调高 `maximum_number_of_records_per_resource`，否则 Azure Monitor 每个指标和命名空间只返回 10 个队列。第 3 步中的配置已调高它。",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- 接收器每天列出一次你的命名空间，因此新命名空间最多可能需要 24 小时才会出现。",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "已连接的 Azure 订阅无需运行任何程序，即可按队列和主题读取命名空间的关键指标。要读取全部指标，请运行 Collector 的 `azure_monitor` 接收器，它按 EntityName 维度把指标拆分到每个队列和主题。",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | 活动消息 | 仪表 |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | 死信消息 | 仪表 |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | 计划消息 | 仪表 |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | 已完成消息 | 每个周期的计数 |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | 已放弃的消息 | 每个周期的计数 |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | 服务器发送延迟 | 仪表 |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ 队列会根据向这些队列发布消息和从中消费消息的应用的消息 span，自动出现在 OneUptime 中。你也可以手动添加：**队列 → 创建队列**。",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ 自己的遥测（它的 `telemetry` 选项，由 `bullmq-otel` 包实现）在 `bullmq.queue.name` 中指明队列，并且不设置 `messaging.system`，因此单靠它不会创建队列。在你的应用所发送到的 Collector 中，一个 `transform` 处理器会在添加和处理作业的 span 以及 BullMQ 自己的指标上添加 OneUptime 读取的两个键：",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "只有添加作业的 PRODUCER span 和处理作业的 CONSUMER span 会被标记：BullMQ 的内部 span 也标明了队列，但它们不是消息。请让应用的 OTLP 导出器指向这个 Collector。",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ 把作业保存在 Redis 中，没有可抓取的 broker；请在应用中把队列深度作为携带 `messaging.system` 和 `messaging.destination.name` 的指标报告，就像 OneUptime 自己的 worker 用 `queue.size` 所做的那样。",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "在应用中观测作业数量；自身带有这两个键的仪表不需要转换：",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不会在 **Broker 健康状况** 下为 BullMQ 绘制 Broker 指标。Collector 发送的所有数据都在 **指标** 浏览器中，每个数据点都带有 `messaging.system` 和 `messaging.destination.name` 的指标会显示在队列的 **指标** 选项卡上。",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- 它的 span 没有标明 OneUptime 能识别的消息系统：Celery 的 span、BullMQ 自身的遥测或自己编写的客户端都是这样。请添加 `messaging.system` 和 `messaging.destination.name`，并把 span 的类型设为 PRODUCER 或 CONSUMER。 对于 BullMQ，第 2 步中的转换会完成这件事。",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ 没有绘图的指标。它的指标在 **指标** 浏览器中。",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**：只要客户端的 `Publisher` 和 `Subscriber` 构建器拿到 OpenTelemetry 实例和追踪开关（`setOpenTelemetry(GlobalOpenTelemetry.get())` 和 `setEnableOpenTelemetryTracing(true)`），客户端就会追踪自身。只调用其中一个则什么也不会追踪。",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**：使用 `new PubSub({ enableOpenTelemetryTracing: true })`。",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**：`PublisherOptions(enable_open_telemetry_tracing=True)` 和 `SubscriberOptions(enable_open_telemetry_tracing=True)`。",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**：使用 `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`。",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "用 Collector 的 `googlecloudmonitoring` 接收器从 Cloud Monitoring 读取主题和订阅的指标，并在 `metrics_list` 下列出每个指标类型。",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "接收器使用 Application Default Credentials（`GOOGLE_APPLICATION_CREDENTIALS`，或运行 Collector 的服务账号）登录，这些凭据需要项目上的 **Monitoring Viewer** 角色。把 `project_id` 设为你的项目：",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "`metrics_list` 中没有列出的指标类型永远不会被读取。订阅指标归属于订阅的队列（`subscription_id`），主题指标归属于主题的队列（`topic_id`）。",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | 未投递消息 | 仪表 |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | 最旧未确认消息的时长 | 仪表 |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | 死信消息 | 每个周期的计数 |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | 已确认消息 | 每个周期的计数 |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | 发布请求 | 每个周期的计数 |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- 指标对队列的命名与 span 不同。Pub/Sub 主题带有主题指标，其订阅带有订阅指标。",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring 只读取 `metrics_list` 中的类型。",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- 数据延迟到达。Pub/Sub 的指标会延迟几分钟到达。",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS 队列会根据向这些队列发布消息和从中消费消息的应用的消息 span，自动出现在 OneUptime 中。你也可以手动添加：**队列 → 创建队列**。",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS 是一种 API，它的 span 不会指明背后的 broker；当 broker 是 Apache ActiveMQ 时，针对它运行 OpenTelemetry JMX Scraper，其指标会并入同一个队列，该队列随后显示为 ActiveMQ 队列，而 IBM MQ 等其他 JMS broker 没有现成的指标途径。",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "它的指标会并入与 JMS span 相同的队列，此后该队列显示为 Apache ActiveMQ 队列。",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不会在 **Broker 健康状况** 下为 JMS 绘制 Broker 指标。Collector 发送的所有数据都在 **指标** 浏览器中，每个数据点都带有 `messaging.system` 和 `messaging.destination.name` 的指标会显示在队列的 **指标** 选项卡上。",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Apache ActiveMQ Broker 的指标一旦到达，该队列就会显示为 Apache ActiveMQ 队列，并在 **Broker 健康状况** 下绘制这些指标：参见 [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq)。",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ActiveMQ 以外的 JMS Broker 没有绘图的指标。它们的指标在 **指标** 浏览器中。对于 ActiveMQ Broker，请参阅 **高级** 下的 **如果 Broker 是 Apache ActiveMQ**。",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS 队列会根据向这些队列发布消息和从中消费消息的应用的消息 span，自动出现在 OneUptime 中。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 NATS 客户端，它的 NATS 检测会报告 `messaging.system` = `nats`。",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "针对服务器的监控端口以 `-jsz=all` 运行 prometheus-nats-exporter。它的 JetStream 指标按流和消费者划分，而不是按 subject 划分，因此不会附加到 subject 级别的队列上。",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "用 `-m 8222`（或在其配置中设置 `http_port: 8222`）开启服务器的监控端口，然后运行导出器：",
  "And scrape it:": "再抓取它：",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不会在 **Broker 健康状况** 下为 NATS 绘制 Broker 指标：上面的 Collector 发送的数据只会进入 **指标** 浏览器。每个数据点都带有 `messaging.system` 和 `messaging.destination.name` 的指标会显示在队列的 **指标** 选项卡上。",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS 没有绘图的指标。它的指标在 **指标** 浏览器中。",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ 队列会自动出现在 OneUptime 中，来源有两个：向这些队列发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。你也可以手动添加：**队列 → 创建队列**。",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理无需修改代码即可追踪 RabbitMQ 客户端。",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**：`RabbitMQ.Client` 7 会追踪自身：订阅 `RabbitMQ.Client.*`。MassTransit 也会追踪自身：订阅 `MassTransit`。",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**：`opentelemetry-instrumentation-pika` 或 `opentelemetry-instrumentation-aio-pika`。",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collector 的 `rabbitmq` 接收器以带有 `monitoring` 标签、可访问每个虚拟主机的用户身份，从管理插件的 HTTP API 读取每个队列的深度、消费者和消息速率。",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "启用管理插件并创建该用户。仅有 `monitoring` 标签，它看不到任何队列：请为它授予要监控的每个虚拟主机的访问权限。空模式授予该访问权限，但不授予任何配置、发布或消费的权利：",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "在 Collector 的环境中设置 `RABBITMQ_USERNAME` 和 `RABBITMQ_PASSWORD`。接收器以 RabbitMQ 中的名称报告每个队列，而大多数检测的 span 标明的是消息经过的 exchange：两者在通过默认 exchange 发送的消息上会对应起来，因为其 routing key 就是队列名。",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | 队列深度 | 仪表 |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | 已发布 | 计数器，按每秒速率绘图 |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | 已投递 | 计数器，按每秒速率绘图 |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | 已确认 | 计数器，按每秒速率绘图 |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | 已丢弃 | 计数器，按每秒速率绘图 |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- 指标对队列的命名与 span 不同。RabbitMQ 的 span 通常标明 exchange，而 Broker 的指标描述的是队列。两者在通过默认 exchange 发送的消息上会对应起来，因为其 routing key 就是队列名。",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ 只报告其用户有权访问的虚拟主机中的队列，对其余部分不记录任何错误。RabbitMQ 的计数器会在首次有活动时出现。",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Amazon SNS 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` 会等待 CloudWatch 发布一个周期，因此在此配置下，此队列的 Broker 指标会延迟 11 到 17 分钟到达：基于它们的监视器需要更长的时间窗口（参见 [警报](/docs/telemetry/queues#alerting) 下的 **延迟到达的指标**）。",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "通过 `orders` 发送几条消息。OneUptime 在摄取时会给每个标明此队列的 span 打上此队列的标记：这些 span 会填充 **概览**（发布和消费的消息、错误和处理时间，以及 **生产者** 和 **消费者** 下的服务）和 **追踪** 选项卡。",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "概览中的 **Broker 健康状况** 会随着 Broker 指标的到达而填充：在第 3 步的配置下，CloudWatch 的指标会延迟 11 到 17 分钟到达。",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "一旦发现过程找到标明此队列的 span 或 Broker 指标，标题就会显示 **最近出现过**。发现过程每 10 分钟运行一次，读取最近 15 分钟的遥测，并读取最近 60 分钟的云监控指标，因为它们会延迟到达。",
  "Names are compared without regard to case.": "名称比较时不区分大小写。",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**：`messaging.system` = `aws.sns`（或 `aws_sns`、`amazonsns`、`sns`），以及目标 `orders`（位于 `messaging.destination.name`，或 `messaging.destination` 这样的旧键中）。",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Broker 指标**：`Dimensions.TopicName` 或 `TopicName` = `orders`。",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Amazon SQS 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Apache ActiveMQ 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "概览中的 **Broker 健康状况** 会随着 Broker 指标的到达而填充。",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "一旦发现过程找到标明此队列的 span 或 Broker 指标，标题就会显示 **最近出现过**。发现过程每 10 分钟运行一次，读取最近 15 分钟的遥测。",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- 无论背后是哪种 Broker，JMS 客户端的 span 都标明 `jms`，因此它们和 Apache ActiveMQ Broker 的指标会落到这一个队列上。",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "JMX 主机已根据此队列的遥测报告的 Broker 地址（`broker-1.example.com:9092`）预先填好。",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Apache Kafka 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**：`messaging.system` = `kafka`，以及目标 `orders`（位于 `messaging.destination.name`，或 `messaging.destination` 这样的旧键中）。",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Broker 指标**：`topic` = `orders`。",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "对于使用 SASL 或 TLS 的集群，请取消 `auth` 和 `tls` 的注释。引导 Broker 已根据此队列的遥测报告的 Broker 地址（`broker-1.example.com:9092`）预先填好；如果 Collector 通过其他方式访问 Broker，请修改它。接收器在 `topic` 中标明每个主题，指标就是靠它找到主题的队列。它只在消费者组已提交过 offset 的主题上报告该组的延迟和已提交的 offset，并跳过名称以 `_` 开头的主题。",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Apache Pulsar 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**：`messaging.system` = `pulsar`（或 `apache_pulsar`），以及目标 `orders`（位于 `messaging.destination.name`，或 `messaging.destination` 这样的旧键中）。",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Apache RocketMQ 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "这是 Azure Event Grid 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及带有它的 `messaging.system` 和 `messaging.destination.name` 的指标。下面的内容都已为此队列预先填好。",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "每个数据点都带有它的 `messaging.system` 和 `messaging.destination.name` 的指标，会显示在它的 **指标** 选项卡上。",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "一旦发现过程找到标明此队列的 span 或消息客户端指标，标题就会显示 **最近出现过**。发现过程每 10 分钟运行一次，读取最近 15 分钟的遥测。",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Azure Event Hubs 队列 `orders`（命名空间 `orders-ns`）。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Span**：`messaging.system` = `eventhubs`（或 `azure_eventhubs`、`azure.eventhubs`、`microsoft.eventhub`），以及目标 `orders`（位于 `messaging.destination.name`，或 `messaging.destination` 这样的旧键中），来自连接到 `orders-ns.servicebus.windows.net` 的 SDK。",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Broker 指标**：`metadata_entityname` = `orders`，位于 `name` 为 `orders-ns` 的命名空间上。",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Azure Service Bus 队列 `orders`（命名空间 `orders-ns`）。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "这是 BullMQ 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及带有它的 `messaging.system` 和 `messaging.destination.name` 的指标。下面的内容都已为此队列预先填好。",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 Google Cloud Pub/Sub 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "这是 JMS 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及带有它的 `messaging.system` 和 `messaging.destination.name` 的指标。下面的内容都已为此队列预先填好。",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "它的指标会并入此队列，此后此队列显示为 Apache ActiveMQ 队列。",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "这是 NATS 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及带有它的 `messaging.system` 和 `messaging.destination.name` 的指标。下面的内容都已为此队列预先填好。",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "这是 RabbitMQ 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及 Broker 自身的指标。下面的内容都已为此队列预先填好。",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "在 Collector 的环境中设置 `RABBITMQ_USERNAME` 和 `RABBITMQ_PASSWORD`。管理端点的主机已根据此队列的遥测报告的 Broker 地址（`broker-1.example.com:9092`）预先填好；如果 Collector 通过其他方式访问 Broker，请修改它。接收器以 RabbitMQ 中的名称报告每个队列，而大多数检测的 span 标明的是消息经过的 exchange：两者在通过默认 exchange 发送的消息上会对应起来，因为其 routing key 就是队列名。",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "这是 `acme-bus` 队列 `orders`。它的数据来自向它发布消息和从中消费消息的应用的消息 span，以及带有它的 `messaging.system` 和 `messaging.destination.name` 的指标。下面的内容都已为此队列预先填好。",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime 不认识这个消息系统，因此没有现成的方式读取 Broker 的指标；在每个数据点上带上 `messaging.system` 和 `messaging.destination.name` 发送它们，它们就会归属到该队列。",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不会在 **Broker 健康状况** 下为 `acme-bus` 绘制 Broker 指标。Collector 发送的所有数据都在 **指标** 浏览器中，每个数据点都带有 `messaging.system` 和 `messaging.destination.name` 的指标会显示在队列的 **指标** 选项卡上。",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- 只有 Broker 自身的指标才需要 OneUptime 认识的系统（参见 [支持的消息系统](/docs/telemetry/queues#supported-messaging-systems)）。它的指标在 **指标** 浏览器中。",
};

export default TRANSLATION;
