import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Span 以 `messaging.system` = `aws.sns` 標明系統（也接受：`aws_sns`、`amazonsns`、`sns`）。",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "佇列來自你的 OpenTelemetry 檢測已經產生的訊息 span；不需要任何 OneUptime 專用的東西。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 AWS SDK 的 SNS 呼叫。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**：`OpenTelemetry.Instrumentation.AWS` 套件，搭配 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` 使用；它的預設屬性集完全不會標明 SNS 主題。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**：`@opentelemetry/auto-instrumentations-node` 會追蹤 AWS SDK。",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**：使用 `opentelemetry-instrumentation-botocore` 套件。",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**：`otelaws`，透過 `otelaws.AppendMiddlewares(&cfg.APIOptions)` 加入。",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **其他任何用戶端**：使用用戶端程式庫內建的 OpenTelemetry 支援，或在傳送與處理程式碼外圍的 span 上設定 `messaging.system` = `aws.sns`、`messaging.destination.name` 和 span 類型（發布時為 PRODUCER，取用時為 CONSUMER）。",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "接著讓 OTLP 匯出器指向 OneUptime。大多數 SDK 和代理程式都會讀取以下環境變數：",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **此權杖是機密。** 請使用 **伺服器** 擷取金鑰，並保存在你的部署的\n> 機密中。切勿把伺服器金鑰放進瀏覽器 JavaScript——那種情況\n> 有 **瀏覽器** 擷取金鑰可用。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "以 Collector 的 `aws_cloudwatch` 接收器讀取主題的 CloudWatch 指標，或透過 CloudWatch Metric Stream 和 Amazon Data Firehose 把它們串流傳送到 Collector 的 `awsfirehose` 接收器。",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch` 接收器使用 AWS SDK 的預設憑證（環境變數、共用設定檔或執行個體角色）輪詢 CloudWatch 的 `GetMetricData` API，這些憑證需要 `cloudwatch:ListMetrics` 和 `cloudwatch:GetMetricData`：",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **不要設定 `stats`**。不設定時，每個指標會依每個週期一筆摘要送達，這正是 OneUptime 讀取的內容。",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- 必須設定 `discovery.limit`，它會限制每次抓取讀取的指標數量。",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` 會等待 CloudWatch 發布一個週期，因此在此設定下，佇列的 Broker 指標會延遲 11 到 17 分鐘送達：以它們為對象的監測器需要更長的時間範圍（請參閱 [警示](/docs/telemetry/queues#alerting) 下的 **延遲送達的指標**）。",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- 一個接收器讀取一個區域和一個命名空間：每個區域新增一個執行個體。",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "若要改為串流傳輸指標（透過 CloudWatch Metric Stream 和 Amazon Data Firehose 傳送到 Collector 的 `awsfirehose` 接收器），請參閱 [Amazon SQS](/docs/telemetry/queues#amazon-sqs)。",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "透過你的佇列傳送幾則訊息。OneUptime 每 10 分鐘讀取最近 15 分鐘的 span，並在 **佇列** 下列出其中至少 3 個 span 標明的每個目的地（SERVER 以外任何類型的 span）。在自行託管的 OneUptime 上，由 `MESSAGE_QUEUE_MIN_SPANS` 設定這個數量。",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "佇列頁面會繪圖的 Broker 指標，哪怕只送達一個資料點，也會建立其佇列：雲端監控指標會延遲送達，因此每次執行都會讀取最近 60 分鐘的資料。訊息用戶端指標，以及你自己帶有 `messaging.system` 和 `messaging.destination.name` 的指標，都不會建立佇列：它們會顯示在既有佇列的 **指標** 分頁上。",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "只有在專案尚未達到其 [自動建立額度](/docs/telemetry/queues#the-auto-create-budget) 時，佇列才會自動建立。",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "佇列的概覽會在 **Broker 健康狀態** 下繪製這些指標，每個量測值和每個週期計數都有 **建立監測器**。在第一個指標送達之前，該區段會說明它們從哪裡來。",
  "| Metric | Shown as | Type |": "| 指標 | 顯示為 | 類型 |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished`（JSON 串流：`numberofmessagespublished`） | 已發布訊息 | 每個週期的計數 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered`（JSON 串流：`numberofnotificationsdelivered`） | 已傳遞通知 | 每個週期的計數 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed`（JSON 串流：`numberofnotificationsfailed`） | 失敗的通知 | 每個週期的計數 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq`（JSON 串流：`numberofnotificationsredriventodlq`） | 重新導向至無效信件佇列 | 每個週期的計數 |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- 它的 span 沒有標明 OneUptime 能辨識的訊息系統：Celery 的 span、BullMQ 本身的遙測或自行撰寫的用戶端都是如此。請加入 `messaging.system` 和 `messaging.destination.name`，並把 span 的類型設為 PRODUCER 或 CONSUMER。",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- 它的名稱屬於 OneUptime 忽略的名稱（請參閱 [忽略的內容](/docs/telemetry/queues#what-is-ignored)），或者只有 SERVER span 標明了它。",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- 最近 15 分鐘內送達的 span 少於 3 個，或者專案已達到其 [自動建立額度](/docs/telemetry/queues#the-auto-create-budget)。",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "如果它的 span 確實指明了它，請以相同的系統和目的地手動建立它（**佇列 → 建立佇列**）：它的 **追蹤** 分頁會從已儲存的 span 填入內容。",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "請參閱佇列文件頁面上的 [我的應用程式使用的佇列沒有被建立](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created)。",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- 檢查 Collector 的記錄。OneUptime 會以 `401` 拒絕錯誤的擷取金鑰（已停用的金鑰或瀏覽器金鑰為 `422`），Collector 會為它捨棄的每個批次記錄 `Exporting failed`。",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- 資料延遲送達。`aws_cloudwatch` 會等待 `delay`（10 分鐘）讓 CloudWatch 發布，因此它的資料點會延遲 11 到 17 分鐘送達。",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "請參閱佇列文件頁面上的 [Broker 健康狀態一直為空](/docs/telemetry/queues#broker-health-stays-empty)。",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- 兩個系統指明了它：Event Hubs Kafka 端點上的 Kafka 用戶端回報 `kafka`，Event Hubs SDK 回報 `eventhubs`。",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- 某次 Service Bus 或 Event Hubs 觀測沒有命名空間：模擬器或自訂網域。",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ 的 span 通常標明 exchange，而 Broker 的指標標明佇列：除非 exchange 和佇列同名，否則 OneUptime 中會出現兩個佇列。",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "封存你不想要的那個：已封存的佇列會保持封存，指明它的內容也不會再建立新佇列。",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "請參閱佇列文件頁面上的 [一個目的地出現兩個佇列](/docs/telemetry/queues#two-queues-for-one-destination)。",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "依請求或依消費者命名、且 OneUptime 無法辨識的目的地（數字後綴、雜湊）會為每個名稱產生一個佇列。UUID 已經會被合併（請參閱 [忽略的內容](/docs/telemetry/queues#what-is-ignored)）。請在檢測中把這類目的地標記為 `messaging.destination.temporary=true`，或給它們一個穩定的名稱，然後封存已經建立的佇列。",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "請參閱佇列文件頁面上的 [每個請求都產生一個新佇列](/docs/telemetry/queues#a-new-queue-for-every-request)。",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 AWS SDK 的 SQS 呼叫。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**：`OpenTelemetry.Instrumentation.AWS` 套件，搭配 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` 使用；它的預設屬性集只透過 URL 標明 SQS 佇列。",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**：`opentelemetry-instrumentation-botocore` 或 `opentelemetry-instrumentation-boto3sqs`。",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**：`otelaws`（`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`），透過 `otelaws.AppendMiddlewares(&cfg.APIOptions)` 加入。它的 SQS span 在 `server.address` 中帶有佇列 URL，OneUptime 會把它讀作佇列。",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "以 Collector 的 `aws_cloudwatch` 接收器讀取佇列的 CloudWatch 指標，或透過 CloudWatch Metric Stream 和 Amazon Data Firehose 把它們串流傳送到 Collector 的 `awsfirehose` 接收器。",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible`（JSON 串流：`approximatenumberofmessagesvisible`） | 可見訊息 | 量測值 |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage`（JSON 串流：`approximateageofoldestmessage`） | 最舊訊息的時長 | 量測值 |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible`（JSON 串流：`approximatenumberofmessagesnotvisible`） | 傳輸中的訊息 | 量測值 |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent`（JSON 串流：`numberofmessagessent`） | 已傳送訊息 | 每個週期的計數 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived`（JSON 串流：`numberofmessagesreceived`） | 已接收訊息 | 每個週期的計數 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted`（JSON 串流：`numberofmessagesdeleted`） | 已刪除訊息 | 每個週期的計數 |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Span 以 `messaging.system` = `activemq` 標明系統（也接受：`artemis`、`activemq_artemis`）。",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 JMS 用戶端（ActiveMQ、Artemis、IBM MQ 以及其他任何 JMS Broker）。無論背後是哪種 Broker，JMS span 都標明 `jms`；ActiveMQ 佇列以該 JMS 系列為鍵，因此其用戶端的 span 和其 Broker 的指標會落在同一個佇列上。",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collector 沒有 JMX 接收器，因此請在 ActiveMQ Classic broker 旁邊以 `OTEL_JMX_TARGET_SYSTEM=activemq` 執行 OpenTelemetry JMX Scraper；它透過 OTLP 推送 broker 的目的地指標。",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. 讓 broker 接受 JMX 連線。使用 `apache/activemq-classic` 映像檔或 `bin/activemq` 指令碼時，在啟動前設定 `ACTIVEMQ_SUNJMX_START`。此範例關閉了驗證：把連接埠留在私人網路中，或用密碼檔開啟 `jmxremote.authenticate`，並為抓取器提供 `OTEL_JMX_USERNAME` 和 `OTEL_JMX_PASSWORD`。",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. 在能連到該連接埠的位置，用 Java 執行環境執行 Scraper。它會直接傳送到 OneUptime：",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` 會保留 Scraper 自 1.53.0-alpha 起使用的指標名稱（`activemq.message.queue.size`，目的地在 `messaging.destination.name` 中）；OneUptime 也會讀取舊名稱（`activemq.message.current`，目的地在 `destination` 中）。ActiveMQ Artemis 的 MBean 不同，這些規則不會讀取。",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "佇列頁面會繪圖的 Broker 指標，哪怕只送達一個資料點，也會建立其佇列。訊息用戶端指標，以及你自己帶有 `messaging.system` 和 `messaging.destination.name` 的指標，都不會建立佇列：它們會顯示在既有佇列的 **指標** 分頁上。",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | 佇列大小 | 量測值 |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | 佇列大小（舊名稱） | 量測值 |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | 已加入佇列 | 計數器，以每秒速率繪圖 |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | 已移出佇列 | 計數器，以每秒速率繪圖 |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | 已過期 | 計數器，以每秒速率繪圖 |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | 消費者 | 量測值 |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | 佇列中的平均時間 | 量測值 |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | 佇列中的平均時間（舊名稱） | 量測值 |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 指標對佇列的命名與 span 不同（請參閱 [限制](/docs/telemetry/queues#limitations)）。",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Span 以 `messaging.system` = `kafka` 標明系統。",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 Kafka 生產者和消費者。",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**：`Confluent.Kafka` 搭配 `OpenTelemetry.Instrumentation.ConfluentKafka` 套件。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**：`@opentelemetry/auto-instrumentations-node` 會追蹤 `kafkajs`。",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**：`opentelemetry-instrumentation-kafka-python`、`opentelemetry-instrumentation-confluent-kafka` 或 `opentelemetry-instrumentation-aiokafka`。",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**：OpenTelemetry Go 自動檢測（`go.opentelemetry.io/auto`，eBPF，在 Linux 上）無須修改程式碼即可追蹤 `segmentio/kafka-go` 的生產者和消費者。",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collector 的 `kafka_metrics` 接收器從 broker 讀取消費者群組落後量和分割區位移；請啟用它的 `topics` 和 `consumers` 抓取器。",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "對於使用 SASL 或 TLS 的叢集，請取消 `auth` 和 `tls` 的註解。接收器在 `topic` 中標明每個主題，指標就是靠它找到主題的佇列。它只在消費者群組已提交過 offset 的主題上回報該群組的延遲和已提交的 offset，並略過名稱以 `_` 開頭的主題。",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | 消費者延遲 | 量測值 |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | 分割區延遲 | 量測值 |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | 已消費 | 計數器，以每秒速率繪圖 |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | 已生產 | 計數器，以每秒速率繪圖 |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka 只有在消費者群組提交 offset 之後才會回報該群組的延遲。接收器會略過名稱以 `_` 開頭的主題。",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Span 以 `messaging.system` = `pulsar` 標明系統（也接受：`apache_pulsar`）。",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 Pulsar 用戶端。",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "每個 broker 都在其 Web 服務連接埠上提供主題和訂閱指標；請抓取每個 broker，因為一個 broker 只回報它目前擁有的主題。",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar 用主題的完整名稱（`persistent://public/default/orders`）標記每個序列，用分割區的名稱標記分割區的序列：分割區會加總到其主題中。",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | 積壓 | 量測值 |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | 訂閱積壓 | 量測值 |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | 積壓時長 | 量測值 |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | 流入訊息 | 計數器，以每秒速率繪圖 |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | 流出訊息 | 計數器，以每秒速率繪圖 |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 RocketMQ 用戶端。",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "在 broker 的 `broker.conf` 中設定 `metricsExporterType=PROM`，讓 broker 提供其落後量和輸送量指標。",
  "Then scrape every broker:": "然後抓取每個 broker：",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | 就緒訊息 | 量測值 |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | 已傳送至無效信件佇列 | 計數器，以每秒速率繪圖 |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid 佇列會根據向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，自動出現在 OneUptime 中。你也可以手動新增：**佇列 → 建立佇列**。",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor 有主題的傳遞和無效信件指標，由 Collector 的 `azure_monitor` 接收器讀取；它們尚未繪製在佇列頁面上，因此請在「指標」下查看它們。",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "接收器透過 `azure_auth` 擴充功能登入：在訂閱上為服務主體授予 **Monitoring Reader** 角色，並在 Collector 的環境中設定 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET` 和 `AZURE_SUBSCRIPTION_ID`。",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "訊息用戶端指標，以及你自己帶有 `messaging.system` 和 `messaging.destination.name` 的指標，都不會建立佇列：它們會顯示在既有佇列的 **指標** 分頁上。",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不會在 **Broker 健康狀態** 下為 Azure Event Grid 繪製 Broker 指標：上面的 Collector 傳送的資料只會進入 **指標** 瀏覽器。每個資料點都帶有 `messaging.system` 和 `messaging.destination.name` 的指標會顯示在佇列的 **指標** 分頁上。",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid 沒有繪圖的指標。它的指標在 **指標** 瀏覽器中。",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**：Azure SDK for Java 會追蹤自身，OpenTelemetry Java 代理程式會把這些追蹤接入 OpenTelemetry。",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**：Azure SDK 的 OpenTelemetry span 屬於實驗功能：設定 `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true`（或 `Azure.Experimental.EnableActivitySource` 開關），並用 `.AddSource("Azure.*")` 訂閱 Azure 來源。',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**：註冊 `@azure/opentelemetry-instrumentation-azure-sdk` 中的 `createAzureSdkInstrumentation()`。",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**：安裝 `azure-core-tracing-opentelemetry`，並設定 `settings.tracing_implementation = "opentelemetry"`（來自 `azure.core.settings`）。',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "已連接的 Azure 訂用帳戶不需執行任何程式，即可依事件中樞讀取命名空間的關鍵指標。若要讀取全部指標，請執行 Collector 的 `azure_monitor` 接收器，它會依 EntityName 維度把指標拆分到每個事件中樞。",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "接收器每天列出一次你的命名空間，因此新的命名空間最多可能需要 24 小時才會出現。",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | 傳入訊息 | 每個週期的計數 |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | 傳出訊息 | 每個週期的計數 |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | 伺服器錯誤 | 每個週期的計數 |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | 使用者錯誤 | 每個週期的計數 |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | 超出配額錯誤 | 每個週期的計數 |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | 被節流的要求 | 每個週期的計數 |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | 大小 | 量測值 |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 指標對佇列的命名與 span 不同。沒有命名空間主機的 Service Bus 和 Event Hubs span 與 Azure Monitor 的指標位於不同的佇列（請參閱 [限制](/docs/telemetry/queues#limitations)）。",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- 除非調高 `maximum_number_of_records_per_resource`，否則 Azure Monitor 每個指標和命名空間只會傳回 10 個佇列。第 3 步中的設定已調高它。",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- 接收器每天列出一次你的命名空間，因此新的命名空間最多可能需要 24 小時才會出現。",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "已連接的 Azure 訂用帳戶不需執行任何程式，即可依佇列和主題讀取命名空間的關鍵指標。若要讀取全部指標，請執行 Collector 的 `azure_monitor` 接收器，它會依 EntityName 維度把指標拆分到每個佇列和主題。",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | 作用中訊息 | 量測值 |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | 無效信件訊息 | 量測值 |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | 排程訊息 | 量測值 |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | 已完成訊息 | 每個週期的計數 |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | 已放棄的訊息 | 每個週期的計數 |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | 伺服器傳送延遲 | 量測值 |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ 佇列會根據向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，自動出現在 OneUptime 中。你也可以手動新增：**佇列 → 建立佇列**。",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ 自己的遙測（它的 `telemetry` 選項，由 `bullmq-otel` 套件實作）在 `bullmq.queue.name` 中指明佇列，且不設定 `messaging.system`，因此它本身不會建立佇列。在你的應用程式傳送到的 Collector 中，一個 `transform` 處理器會在新增和處理作業的 span 上以及 BullMQ 自己的指標上，加入 OneUptime 讀取的兩個鍵：",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "只有新增作業的 PRODUCER span 和處理作業的 CONSUMER span 會被標記：BullMQ 的內部 span 也標明了佇列，但它們不是訊息。請讓應用程式的 OTLP 匯出器指向這個 Collector。",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ 把它的作業保存在 Redis 中，沒有可以抓取的 broker；請從應用程式以帶有 `messaging.system` 和 `messaging.destination.name` 的指標回報佇列深度，就像 OneUptime 自己的 worker 以 `queue.size` 所做的那樣。",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "在應用程式中觀測作業數量；本身帶有這兩個鍵的量測值不需要轉換：",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不會在 **Broker 健康狀態** 下為 BullMQ 繪製 Broker 指標。Collector 傳送的所有資料都在 **指標** 瀏覽器中，每個資料點都帶有 `messaging.system` 和 `messaging.destination.name` 的指標會顯示在佇列的 **指標** 分頁上。",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- 它的 span 沒有標明 OneUptime 能辨識的訊息系統：Celery 的 span、BullMQ 本身的遙測或自行撰寫的用戶端都是如此。請加入 `messaging.system` 和 `messaging.destination.name`，並把 span 的類型設為 PRODUCER 或 CONSUMER。 對於 BullMQ，第 2 步中的轉換會完成這件事。",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ 沒有繪圖的指標。它的指標在 **指標** 瀏覽器中。",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**：只要用戶端的 `Publisher` 和 `Subscriber` 建構器拿到 OpenTelemetry 執行個體和追蹤開關（`setOpenTelemetry(GlobalOpenTelemetry.get())` 和 `setEnableOpenTelemetryTracing(true)`），用戶端就會追蹤自身。只呼叫其中一個則什麼也不會追蹤。",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**：使用 `new PubSub({ enableOpenTelemetryTracing: true })`。",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**：`PublisherOptions(enable_open_telemetry_tracing=True)` 和 `SubscriberOptions(enable_open_telemetry_tracing=True)`。",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**：使用 `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`。",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "以 Collector 的 `googlecloudmonitoring` 接收器從 Cloud Monitoring 讀取主題和訂閱的指標，並在 `metrics_list` 下列出每種指標類型。",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "接收器使用 Application Default Credentials（`GOOGLE_APPLICATION_CREDENTIALS`，或執行 Collector 的服務帳戶）登入，這些憑證需要專案上的 **Monitoring Viewer** 角色。把 `project_id` 設為你的專案：",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "`metrics_list` 中沒有列出的指標類型永遠不會被讀取。訂閱指標歸屬於訂閱的佇列（`subscription_id`），主題指標歸屬於主題的佇列（`topic_id`）。",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | 未傳遞訊息 | 量測值 |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | 最舊未確認訊息的時長 | 量測值 |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | 無效信件訊息 | 每個週期的計數 |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | 已確認訊息 | 每個週期的計數 |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | 發布要求 | 每個週期的計數 |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- 指標對佇列的命名與 span 不同。Pub/Sub 主題帶有主題指標，其訂閱帶有訂閱指標。",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring 只讀取 `metrics_list` 中的類型。",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- 資料延遲送達。Pub/Sub 的指標會延遲幾分鐘送達。",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS 佇列會根據向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，自動出現在 OneUptime 中。你也可以手動新增：**佇列 → 建立佇列**。",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS 是一個 API，它的 span 不會指明背後的 broker；當 broker 是 Apache ActiveMQ 時，對它執行 OpenTelemetry JMX Scraper，它的指標就會併入同一個佇列，該佇列隨後顯示為 ActiveMQ 佇列，而 IBM MQ 等其他 JMS broker 則沒有現成的指標途徑。",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "它的指標會併入與 JMS span 相同的佇列，此後該佇列會顯示為 Apache ActiveMQ 佇列。",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不會在 **Broker 健康狀態** 下為 JMS 繪製 Broker 指標。Collector 傳送的所有資料都在 **指標** 瀏覽器中，每個資料點都帶有 `messaging.system` 和 `messaging.destination.name` 的指標會顯示在佇列的 **指標** 分頁上。",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Apache ActiveMQ Broker 的指標一旦送達，該佇列就會顯示為 Apache ActiveMQ 佇列，並在 **Broker 健康狀態** 下繪製這些指標：請參閱 [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq)。",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ActiveMQ 以外的 JMS Broker 沒有繪圖的指標。它們的指標在 **指標** 瀏覽器中。對於 ActiveMQ Broker，請參閱 **進階** 下的 **如果 Broker 是 Apache ActiveMQ**。",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS 佇列會根據向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，自動出現在 OneUptime 中。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 NATS 用戶端，它的 NATS 檢測會回報 `messaging.system` = `nats`。",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "以 `-jsz=all` 對伺服器的監控連接埠執行 prometheus-nats-exporter。它的 JetStream 指標是依串流和消費者區分，而不是依 subject 區分，因此不會附加到 subject 層級的佇列。",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "以 `-m 8222`（或在其設定中以 `http_port: 8222`）開啟伺服器的監控連接埠，然後執行匯出器：",
  "And scrape it:": "並抓取它：",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime 不會在 **Broker 健康狀態** 下為 NATS 繪製 Broker 指標：上面的 Collector 傳送的資料只會進入 **指標** 瀏覽器。每個資料點都帶有 `messaging.system` 和 `messaging.destination.name` 的指標會顯示在佇列的 **指標** 分頁上。",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS 沒有繪圖的指標。它的指標在 **指標** 瀏覽器中。",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ 佇列會自動出現在 OneUptime 中，來源有兩個：向這些佇列發布訊息和從中取用訊息的應用程式的訊息 span，以及 Broker 本身的指標。你也可以手動新增：**佇列 → 建立佇列**。",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**：OpenTelemetry Java 代理程式無須修改程式碼即可追蹤 RabbitMQ 用戶端。",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**：`RabbitMQ.Client` 7 會追蹤自身：訂閱 `RabbitMQ.Client.*`。MassTransit 也會追蹤自身：訂閱 `MassTransit`。",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**：`opentelemetry-instrumentation-pika` 或 `opentelemetry-instrumentation-aio-pika`。",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collector 的 `rabbitmq` 接收器以標記為 `monitoring`、且可存取每個虛擬主機的使用者身分，從管理外掛程式的 HTTP API 讀取每個佇列的深度、消費者和訊息速率。",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "啟用管理外掛程式並建立該使用者。僅有 `monitoring` 標籤，它看不到任何佇列：請為它授予要監控的每個虛擬主機的存取權。空模式會授予該存取權，但不授予任何設定、發布或取用的權利：",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "在 Collector 的環境中設定 `RABBITMQ_USERNAME` 和 `RABBITMQ_PASSWORD`。接收器以 RabbitMQ 中的名稱回報每個佇列，而大多數檢測的 span 標明的是訊息經過的 exchange：兩者在透過預設 exchange 傳送的訊息上會對應起來，因為其 routing key 就是佇列名稱。",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | 佇列深度 | 量測值 |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | 已發布 | 計數器，以每秒速率繪圖 |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | 已傳遞 | 計數器，以每秒速率繪圖 |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | 已確認 | 計數器，以每秒速率繪圖 |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | 已捨棄 | 計數器，以每秒速率繪圖 |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- 指標對佇列的命名與 span 不同。RabbitMQ 的 span 通常標明 exchange，而 Broker 的指標描述的是佇列。兩者在透過預設 exchange 傳送的訊息上會對應起來，因為其 routing key 就是佇列名稱。",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ 只回報其使用者有權存取的虛擬主機中的佇列，對其餘部分不記錄任何錯誤。RabbitMQ 的計數器會在首次有活動時出現。",
};

export default TRANSLATION;
