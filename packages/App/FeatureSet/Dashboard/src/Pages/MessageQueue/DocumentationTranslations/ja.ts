import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "スパンはシステムを `messaging.system` = `aws.sns` として示します（`aws_sns`、`amazonsns`、`sns` も受け付けます）。",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "キューは、OpenTelemetry の計装がすでに生成しているメッセージングスパンから作られます。OneUptime 固有のものは必要ありません。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに AWS SDK の SNS 呼び出しをトレースします。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` パッケージを `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` で使います。既定の属性セットは SNS トピックをまったく示しません。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` が AWS SDK をトレースします。",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` パッケージを使います。",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws` を `otelaws.AppendMiddlewares(&cfg.APIOptions)` で追加します。",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **その他のクライアント**: クライアントライブラリ自身の OpenTelemetry サポートを使うか、送信とハンドラーを囲むスパンに `messaging.system` = `aws.sns`、`messaging.destination.name`、スパンの種類（発行時は PRODUCER、消費時は CONSUMER）を設定します。",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "次に、OTLP エクスポーターの送信先を OneUptime にします。ほとんどの SDK とエージェントは次の環境変数を読みます:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **このトークンはシークレットです。** **サーバー** の取り込みキーを使い、デプロイの\n> シークレットに保管してください。サーバーキーをブラウザーの JavaScript に置いてはいけません。\n> そのためには **ブラウザー** の取り込みキーがあります。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "トピックの CloudWatch メトリクスを Collector の `aws_cloudwatch` レシーバーで読み取るか、CloudWatch Metric Stream と Amazon Data Firehose を経由して、その `awsfirehose` レシーバーにストリーミングします。",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch` レシーバーは、AWS SDK の既定の認証情報（環境変数、共有プロファイル、インスタンスロール）で CloudWatch の `GetMetricData` API をポーリングします。この認証情報には `cloudwatch:ListMetrics` と `cloudwatch:GetMetricData` が必要です:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **`stats` は設定しないでください**。設定しなければ、各メトリクスは期間ごとに 1 つのサマリーとして届き、OneUptime はそれを読みます。",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` は必須で、1 回のスクレイプで読むメトリクスの上限になります。",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` は CloudWatch が期間を公開するのを待つため、この設定ではキューのブローカーメトリクスが 11〜17 分遅れて届きます。それを対象にするモニターには長めのウィンドウが必要です（[アラート](/docs/telemetry/queues#alerting) の **遅れて届くメトリクス** を参照）。",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- 1 つのレシーバーは 1 つのリージョンと 1 つの名前空間を読み取ります: リージョンごとにインスタンスを追加します。",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "代わりにメトリクスをストリーミングする場合（CloudWatch Metric Stream から Amazon Data Firehose を経て Collector の `awsfirehose` レシーバーへ）は、[Amazon SQS](/docs/telemetry/queues#amazon-sqs) を参照してください。",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "キューにいくつかメッセージを流してください。OneUptime は 10 分ごとに直近 15 分のスパンを読み、そのうち少なくとも 3 つが示す宛先を **キュー** に一覧します（SERVER 以外の種類のスパン）。セルフホストの OneUptime では、この数を `MESSAGE_QUEUE_MIN_SPANS` で設定します。",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "キューのページがグラフ表示するブローカーメトリクスは、データポイントが 1 つ届くだけでもそのキューを作成します。クラウドの監視メトリクスは遅れて届くため、毎回直近 60 分から読みます。メッセージングクライアントのメトリクスや、`messaging.system` と `messaging.destination.name` を持つ独自のメトリクスがキューを作成することはありません。既存のキューの **メトリクス** タブに表示されます。",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "キューが自動的に作成されるのは、プロジェクトが [自動作成の上限](/docs/telemetry/queues#the-auto-create-budget) に達していない間だけです。",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "キューの概要はこれらを **ブローカーのヘルス** にグラフ表示し、各ゲージと期間ごとの各件数には **モニターを作成** があります。届くまでは、そのセクションにメトリクスの送り元が表示されます。",
  "| Metric | Shown as | Type |":
    "| メトリクス | 表示名 | 種類 |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished`（JSON ストリーム: `numberofmessagespublished`） | パブリッシュされたメッセージ | 期間ごとの件数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered`（JSON ストリーム: `numberofnotificationsdelivered`） | 配信された通知 | 期間ごとの件数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed`（JSON ストリーム: `numberofnotificationsfailed`） | 失敗した通知 | 期間ごとの件数 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq`（JSON ストリーム: `numberofnotificationsredriventodlq`） | デッドレターキューに再送 | 期間ごとの件数 |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- そのスパンが、OneUptime が判別できるメッセージングシステムを示していません。Celery のスパン、BullMQ 自身のテレメトリー、自作のクライアントなどです。`messaging.system` と `messaging.destination.name` を追加し、スパンの種類を PRODUCER または CONSUMER にしてください。",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- その名前が OneUptime の無視する名前である（[無視されるもの](/docs/telemetry/queues#what-is-ignored) を参照）か、SERVER スパンだけがそれを示しています。",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- 直近 15 分に届いたスパンが 3 つ未満か、プロジェクトが [自動作成の上限](/docs/telemetry/queues#the-auto-create-budget) に達しています。",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "スパンがキューを示しているなら、同じシステムと宛先で手動で作成します (**キュー → キューを作成**): その **トレース** タブには、すでに保存されているスパンが表示されます。",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "キューのドキュメントページの [アプリケーションが使うキューが作成されなかった](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) を参照してください。",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Collector のログを確認してください。OneUptime は誤った取り込みキーを `401` で拒否し（無効化されたキーやブラウザーキーは `422`）、Collector は破棄したバッチごとに `Exporting failed` をログに出します。",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- 遅れて届いています。 `aws_cloudwatch` は CloudWatch が公開するまで `delay`（10 分）待つため、そのデータポイントは 11〜17 分遅れて届きます。",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "キューのドキュメントページの [ブローカーのヘルスが空のまま](/docs/telemetry/queues#broker-health-stays-empty) を参照してください。",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- 2 つのシステムがそれを示しています: Event Hubs の Kafka エンドポイント上の Kafka クライアントは `kafka` と報告し、Event Hubs SDK は `eventhubs` と報告します。",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Service Bus または Event Hubs の一方の観測に名前空間がありません: エミュレーターまたはカスタムドメインです。",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ のスパンは通常 exchange を示し、ブローカーのメトリクスはキューを示します。exchange とキューが同じ名前でない限り、OneUptime ではキューが 2 つになります。",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "不要なほうをアーカイブします: アーカイブされたキューはアーカイブされたままになり、それを示すものが新しいキューを作ることはなくなります。",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "キューのドキュメントページの [1 つの宛先に 2 つのキューがある](/docs/telemetry/queues#two-queues-for-one-destination) を参照してください。",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "OneUptime が認識できない、リクエストごとやコンシューマーごとに名前が付く宛先（数字のサフィックスやハッシュ）は、名前ごとにキューを作ります。UUID はすでにまとめられます（[無視されるもの](/docs/telemetry/queues#what-is-ignored) を参照）。そうした宛先は計装で `messaging.destination.temporary=true` を付けるか、安定した名前を付けてから、作成済みのキューをアーカイブしてください。",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "キューのドキュメントページの [リクエストごとに新しいキューができる](/docs/telemetry/queues#a-new-queue-for-every-request) を参照してください。",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに AWS SDK の SQS 呼び出しをトレースします。",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` パッケージを `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` で使います。既定の属性セットは SQS キューを URL だけで示します。",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` または `opentelemetry-instrumentation-boto3sqs` を使います。",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws`（`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`）を `otelaws.AppendMiddlewares(&cfg.APIOptions)` で追加します。その SQS スパンは `server.address` にキューの URL を持ち、OneUptime はそれをキューとして読みます。",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "キューの CloudWatch メトリクスを Collector の `aws_cloudwatch` レシーバーで読み取るか、CloudWatch Metric Stream と Amazon Data Firehose を経由して、その `awsfirehose` レシーバーにストリーミングします。",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible`（JSON ストリーム: `approximatenumberofmessagesvisible`） | 表示可能なメッセージ | ゲージ |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage`（JSON ストリーム: `approximateageofoldestmessage`） | 最も古いメッセージの経過時間 | ゲージ |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible`（JSON ストリーム: `approximatenumberofmessagesnotvisible`） | 処理中のメッセージ | ゲージ |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent`（JSON ストリーム: `numberofmessagessent`） | 送信されたメッセージ | 期間ごとの件数 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived`（JSON ストリーム: `numberofmessagesreceived`） | 受信されたメッセージ | 期間ごとの件数 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted`（JSON ストリーム: `numberofmessagesdeleted`） | 削除されたメッセージ | 期間ごとの件数 |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "スパンはシステムを `messaging.system` = `activemq` として示します（`artemis`、`activemq_artemis` も受け付けます）。",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに JMS クライアント（ActiveMQ、Artemis、IBM MQ、その他すべての JMS ブローカー）をトレースします。JMS のスパンは、背後にどのブローカーがあっても `jms` を示します。ActiveMQ のキューはその JMS ファミリーで識別されるため、クライアントのスパンとブローカーのメトリクスは 1 つのキューに届きます。",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collector には JMX レシーバーがないため、ActiveMQ Classic ブローカーの横で `OTEL_JMX_TARGET_SYSTEM=activemq` を指定して OpenTelemetry JMX Scraper を実行します。スクレイパーはブローカーの宛先メトリクスを OTLP でプッシュします。",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. ブローカーが JMX 接続を受け付けるようにします。`apache/activemq-classic` イメージまたは `bin/activemq` スクリプトでは、起動前に `ACTIVEMQ_SUNJMX_START` を設定します。この例では認証を無効にしています: ポートはプライベートネットワーク内に置くか、パスワードファイルを使って `jmxremote.authenticate` を有効にし、スクレイパーに `OTEL_JMX_USERNAME` と `OTEL_JMX_PASSWORD` を渡します。",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. そのポートに届く場所で、Java ランタイムを使ってスクレイパーを実行します。OneUptime に直接送信します:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` は、スクレイパーが 1.53.0-alpha から使っているメトリクス名（`activemq.message.queue.size`、宛先は `messaging.destination.name`）を維持します。OneUptime は旧名（`activemq.message.current`、宛先は `destination`）も読みます。ActiveMQ Artemis は MBean が異なり、これらのルールでは読みません。",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "キューのページがグラフ表示するブローカーメトリクスは、データポイントが 1 つ届くだけでもそのキューを作成します。メッセージングクライアントのメトリクスや、`messaging.system` と `messaging.destination.name` を持つ独自のメトリクスがキューを作成することはありません。既存のキューの **メトリクス** タブに表示されます。",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | キューのサイズ | ゲージ |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | キューのサイズ（旧名） | ゲージ |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | キューに追加 | カウンター（毎秒の値でグラフ化） |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | キューから取り出し | カウンター（毎秒の値でグラフ化） |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | 期限切れ | カウンター（毎秒の値でグラフ化） |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | コンシューマー | ゲージ |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | キュー内の平均時間 | ゲージ |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | キュー内の平均時間（旧名） | ゲージ |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- メトリクスがスパンとは別の名前でキューを示しています（[制限事項](/docs/telemetry/queues#limitations) を参照）。",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "Spans name the system as `messaging.system` = `kafka`.":
    "スパンはシステムを `messaging.system` = `kafka` として示します。",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに Kafka のプロデューサーとコンシューマーをトレースします。",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` と `OpenTelemetry.Instrumentation.ConfluentKafka` パッケージを使います。",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` が `kafkajs` をトレースします。",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`、`opentelemetry-instrumentation-confluent-kafka`、`opentelemetry-instrumentation-aiokafka` のいずれかを使います。",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Go の自動計装（`go.opentelemetry.io/auto`、eBPF、Linux）が、コードを変更せずに `segmentio/kafka-go` のプロデューサーとコンシューマーをトレースします。",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collector の `kafka_metrics` レシーバーは、ブローカーからコンシューマーグループのラグとパーティションのオフセットを読み取ります。`topics` と `consumers` のスクレイパーを有効にします。",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "SASL や TLS を使うクラスターでは、`auth` と `tls` のコメントを外してください。レシーバーは各トピックを `topic` で示し、メトリクスはそれでトピックのキューを見つけます。コンシューマーグループのラグとコミット済みオフセットは、グループがオフセットをコミットしたトピックについてだけ報告し、名前が `_` で始まるトピックはスキップします。",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | コンシューマーラグ | ゲージ |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | パーティションのラグ | ゲージ |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | コンシューム | カウンター（毎秒の値でグラフ化） |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | プロデュース | カウンター（毎秒の値でグラフ化） |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka は、コンシューマーグループがオフセットをコミットして初めてそのラグを報告します。レシーバーは名前が `_` で始まるトピックをスキップします。",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "スパンはシステムを `messaging.system` = `pulsar` として示します（`apache_pulsar` も受け付けます）。",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに Pulsar クライアントをトレースします。",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "各ブローカーは、トピックとサブスクリプションのメトリクスを Web サービスのポートで提供します。ブローカーは現在所有しているトピックしか報告しないため、すべてのブローカーをスクレイプします。",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar は各系列にトピックの完全な名前（`persistent://public/default/orders`）を、パーティションの系列にはパーティションの名前をラベル付けします。パーティションはトピックに合算されます。",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | バックログ | ゲージ |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | サブスクリプションのバックログ | ゲージ |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | バックログの経過時間 | ゲージ |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | 受信メッセージ | カウンター（毎秒の値でグラフ化） |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | 送信メッセージ | カウンター（毎秒の値でグラフ化） |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに RocketMQ クライアントをトレースします。",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "ブローカーの `broker.conf` で `metricsExporterType=PROM` を設定し、ブローカーがラグとスループットのメトリクスを提供するようにします。",
  "Then scrape every broker:":
    "次に、すべてのブローカーをスクレイプします:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | 準備完了のメッセージ | ゲージ |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | デッドレターキューに送信 | カウンター（毎秒の値でグラフ化） |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid のキューは、キューに発行し、キューから消費するアプリケーションのメッセージングスパンから、OneUptime に自動的に表示されます。手動で追加することもできます: **キュー → キューを作成**。",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor にはトピックの配信とデッドレターのメトリクスがあり、Collector の `azure_monitor` レシーバーがそれを読み取ります。まだキューのページにはグラフ表示されないため、メトリクスで確認してください。",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "レシーバーは `azure_auth` 拡張機能でサインインします。サービスプリンシパルにサブスクリプションの **Monitoring Reader** ロールを付与し、Collector の環境に `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET`、`AZURE_SUBSCRIPTION_ID` を設定してください。",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "メッセージングクライアントのメトリクスや、`messaging.system` と `messaging.destination.name` を持つ独自のメトリクスがキューを作成することはありません。既存のキューの **メトリクス** タブに表示されます。",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime は Azure Event Grid のブローカーメトリクスを **ブローカーのヘルス** にグラフ表示しません。上の Collector が送るものは **メトリクス** エクスプローラーにだけ届きます。各データポイントに `messaging.system` と `messaging.destination.name` を持つメトリクスは、キューの **メトリクス** タブに表示されます。",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid にはグラフ表示されるメトリクスがありません。そのメトリクスは **メトリクス** エクスプローラーにあります。",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK for Java は自身をトレースし、OpenTelemetry Java エージェントがそのトレースを OpenTelemetry につなぎます。",
  "- **.NET**: the Azure SDK's OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource(\"Azure.*\")`.":
    "- **.NET**: Azure SDK の OpenTelemetry スパンは実験的です。`AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true`（または `Azure.Experimental.EnableActivitySource` スイッチ）を設定し、`.AddSource(\"Azure.*\")` で Azure のソースを購読してください。",
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: `@azure/opentelemetry-instrumentation-azure-sdk` の `createAzureSdkInstrumentation()` を登録します。",
  "- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = \"opentelemetry\"` (from `azure.core.settings`).":
    "- **Python**: `azure-core-tracing-opentelemetry` をインストールし、`settings.tracing_implementation = \"opentelemetry\"`（`azure.core.settings` から）を設定します。",
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "接続済みの Azure サブスクリプションは、何も実行せずに、名前空間の主要メトリクスをイベントハブごとに読み取ります。すべてを読み取るには、Collector の `azure_monitor` レシーバーを実行します。レシーバーは EntityName ディメンションでそれらをイベントハブごとに分割します。",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "レシーバーは 1 日に 1 回名前空間を一覧するため、新しい名前空間が表示されるまで最大 24 時間かかることがあります。",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | 受信メッセージ | 期間ごとの件数 |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | 送信メッセージ | 期間ごとの件数 |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | サーバーエラー | 期間ごとの件数 |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | ユーザーエラー | 期間ごとの件数 |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | クォータ超過エラー | 期間ごとの件数 |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | スロットリングされた要求 | 期間ごとの件数 |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | サイズ | ゲージ |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- メトリクスがスパンとは別の名前でキューを示しています。名前空間のホストを持たない Service Bus と Event Hubs のスパンは、Azure Monitor のメトリクスとは別のキューになります（[制限事項](/docs/telemetry/queues#limitations) を参照）。",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor は、`maximum_number_of_records_per_resource` を引き上げない限り、メトリクスと名前空間ごとに 10 個のキューしか返しません。手順 3 の設定で引き上げています。",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- レシーバーは 1 日に 1 回名前空間を一覧するため、新しい名前空間が表示されるまで最大 24 時間かかることがあります。",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "接続済みの Azure サブスクリプションは、何も実行せずに、名前空間の主要メトリクスをキューとトピックごとに読み取ります。すべてを読み取るには、Collector の `azure_monitor` レシーバーを実行します。レシーバーは EntityName ディメンションでそれらをキューとトピックごとに分割します。",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | アクティブなメッセージ | ゲージ |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | デッドレターメッセージ | ゲージ |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | スケジュールされたメッセージ | ゲージ |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | 完了したメッセージ | 期間ごとの件数 |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | 破棄されたメッセージ | 期間ごとの件数 |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | サーバー送信レイテンシ | ゲージ |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ のキューは、キューに発行し、キューから消費するアプリケーションのメッセージングスパンから、OneUptime に自動的に表示されます。手動で追加することもできます: **キュー → キューを作成**。",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ 自身のテレメトリ (`bullmq-otel` パッケージが実装する `telemetry` オプション) は、キューを `bullmq.queue.name` で示し、`messaging.system` を設定しないため、それだけではキューを作成しません。アプリケーションの送信先の Collector で `transform` プロセッサーを使い、ジョブを追加・処理するスパンと BullMQ 自身のメトリクスに、OneUptime が読み取る 2 つのキーを追加します:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "タグ付けされるのは、ジョブを追加する PRODUCER スパンと、それを処理する CONSUMER スパンだけです。BullMQ の内部スパンもキューを示しますが、メッセージではありません。アプリケーションの OTLP エクスポーターの送信先をこの Collector にしてください。",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ はジョブを Redis に保持し、スクレイプするブローカーを持ちません。OneUptime 自身のワーカーが `queue.size` で行っているように、`messaging.system` と `messaging.destination.name` を持つメトリクスとして、アプリケーションからキューの深さを報告します。",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "アプリケーションでジョブ数を観測します。2 つのキーを自身で持つゲージには、変換は不要です:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime は BullMQ のブローカーメトリクスを **ブローカーのヘルス** にグラフ表示しません。Collector が送るものはすべて **メトリクス** エクスプローラーにあり、各データポイントに `messaging.system` と `messaging.destination.name` を持つメトリクスは、キューの **メトリクス** タブに表示されます。",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- そのスパンが、OneUptime が判別できるメッセージングシステムを示していません。Celery のスパン、BullMQ 自身のテレメトリー、自作のクライアントなどです。`messaging.system` と `messaging.destination.name` を追加し、スパンの種類を PRODUCER または CONSUMER にしてください。 BullMQ の場合は、手順 2 の変換がそれを行います。",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ にはグラフ表示されるメトリクスがありません。そのメトリクスは **メトリクス** エクスプローラーにあります。",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: `Publisher` と `Subscriber` のビルダーに OpenTelemetry インスタンスとトレースのスイッチ（`setOpenTelemetry(GlobalOpenTelemetry.get())` と `setEnableOpenTelemetryTracing(true)`）を渡すと、クライアントが自身をトレースします。どちらか一方の呼び出しだけでは何もトレースされません。",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })` を使います。",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` と `SubscriberOptions(enable_open_telemetry_tracing=True)` を使います。",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}` を使います。",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Collector の `googlecloudmonitoring` レシーバーで Cloud Monitoring からトピックとサブスクリプションのメトリクスを読み取り、各メトリクスタイプを `metrics_list` に列挙します。",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "レシーバーは Application Default Credentials（`GOOGLE_APPLICATION_CREDENTIALS`、または Collector を実行しているサービスアカウント）でサインインします。これにはプロジェクトの **Monitoring Viewer** ロールが必要です。`project_id` に自分のプロジェクトを設定してください:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "`metrics_list` にないメトリクスタイプは読まれません。サブスクリプションのメトリクスはサブスクリプションのキュー（`subscription_id`）に、トピックのメトリクスはトピックのキュー（`topic_id`）に付きます。",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | 未配信のメッセージ | ゲージ |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | 最も古い未確認メッセージの経過時間 | ゲージ |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | デッドレターメッセージ | 期間ごとの件数 |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | 確認済みのメッセージ | 期間ごとの件数 |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | パブリッシュ要求 | 期間ごとの件数 |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- メトリクスがスパンとは別の名前でキューを示しています。Pub/Sub のトピックにはトピックのメトリクスが、そのサブスクリプションにはサブスクリプションのメトリクスが付きます。",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring は `metrics_list` にあるタイプだけを読みます。",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- 遅れて届いています。 Pub/Sub のメトリクスは数分遅れて届きます。",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS のキューは、キューに発行し、キューから消費するアプリケーションのメッセージングスパンから、OneUptime に自動的に表示されます。手動で追加することもできます: **キュー → キューを作成**。",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS は API であり、そのスパンは背後のブローカーを示しません。ブローカーが Apache ActiveMQ の場合は、それに対して OpenTelemetry JMX Scraper を実行すると、メトリクスが同じキューに加わり、そのキューは ActiveMQ のキューとして表示されます。IBM MQ などのほかの JMS ブローカーには、メトリクスを送る既製の手段がありません。",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "そのメトリクスは JMS スパンと同じキューに加わり、以後そのキューは Apache ActiveMQ のキューとして表示されます。",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime は JMS のブローカーメトリクスを **ブローカーのヘルス** にグラフ表示しません。Collector が送るものはすべて **メトリクス** エクスプローラーにあり、各データポイントに `messaging.system` と `messaging.destination.name` を持つメトリクスは、キューの **メトリクス** タブに表示されます。",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Apache ActiveMQ ブローカーのメトリクスが届くと、キューは Apache ActiveMQ のキューとして表示され、それらを **ブローカーのヘルス** にグラフ表示します。[Apache ActiveMQ](/docs/telemetry/queues#apache-activemq) を参照してください。",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ActiveMQ 以外の JMS ブローカーには、グラフ表示されるメトリクスがありません。そのメトリクスは **メトリクス** エクスプローラーにあります。ActiveMQ ブローカーについては、**詳細** の **ブローカーが Apache ActiveMQ の場合** を参照してください。",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS のキューは、キューに発行し、キューから消費するアプリケーションのメッセージングスパンから、OneUptime に自動的に表示されます。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに NATS クライアントをトレースします。その NATS の計装は `messaging.system` = `nats` を報告します。",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "サーバーの監視ポートに対して、`-jsz=all` を指定して prometheus-nats-exporter を実行します。その JetStream メトリクスはストリームとコンシューマーごとであり、サブジェクトごとではないため、サブジェクト単位のキューには結び付きません。",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "`-m 8222` (または構成の `http_port: 8222`) でサーバーの監視ポートを有効にし、エクスポーターを実行します:",
  "And scrape it:":
    "そして、それをスクレイプします:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime は NATS のブローカーメトリクスを **ブローカーのヘルス** にグラフ表示しません。上の Collector が送るものは **メトリクス** エクスプローラーにだけ届きます。各データポイントに `messaging.system` と `messaging.destination.name` を持つメトリクスは、キューの **メトリクス** タブに表示されます。",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS にはグラフ表示されるメトリクスがありません。そのメトリクスは **メトリクス** エクスプローラーにあります。",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ のキューは、2 つのソースから OneUptime に自動的に表示されます。キューに発行し、キューから消費するアプリケーションのメッセージングスパンと、ブローカー自身のメトリクスです。手動で追加することもできます: **キュー → キューを作成**。",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java エージェントが、コードを変更せずに RabbitMQ クライアントをトレースします。",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 は自身をトレースします。`RabbitMQ.Client.*` を購読してください。MassTransit も自身をトレースします。`MassTransit` を購読してください。",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` または `opentelemetry-instrumentation-aio-pika` を使います。",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collector の `rabbitmq` レシーバーは、`monitoring` タグを持ち各仮想ホストにアクセスできるユーザーとして、管理プラグインの HTTP API から各キューの深さ、コンシューマー、メッセージレートを読み取ります。",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "管理プラグインを有効にし、そのユーザーを作成します。`monitoring` タグだけではキューは 1 つも見えません。監視する各仮想ホストへのアクセス権を与えてください。空のパターンは、設定・発行・消費の権限を一切与えずにそのアクセス権を付与します:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Collector の環境に `RABBITMQ_USERNAME` と `RABBITMQ_PASSWORD` を設定します。レシーバーは各キューを RabbitMQ での名前で報告しますが、ほとんどの計装のスパンはメッセージが通った exchange を示します。両者は、デフォルトの exchange を通して送られたメッセージでは一致します。その routing key がキューの名前だからです。",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | キューの深さ | ゲージ |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | パブリッシュ | カウンター（毎秒の値でグラフ化） |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | 配信済み | カウンター（毎秒の値でグラフ化） |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | 確認済み | カウンター（毎秒の値でグラフ化） |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | 破棄済み | カウンター（毎秒の値でグラフ化） |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- メトリクスがスパンとは別の名前でキューを示しています。RabbitMQ のスパンは通常 exchange を示し、ブローカーのメトリクスはキューを表します。両者は、デフォルトの exchange を通して送られたメッセージでは一致します。その routing key がキューの名前だからです。",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ は、そのユーザーがアクセスできる仮想ホストのキューだけを報告し、それ以外についてはエラーを記録しません。RabbitMQ のカウンターは最初のアクティビティで現れます。",
};

export default TRANSLATION;
