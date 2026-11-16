import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Amazon SNS خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "اسپن‌ها سیستم را با `messaging.system` = `aws.sns` نام می‌برند (این‌ها هم پذیرفته می‌شوند: `aws_sns`، `amazonsns`، `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "صف‌ها از اسپن‌های پیام‌رسانی‌ای می‌آیند که ابزارگذاری OpenTelemetry شما از قبل تولید می‌کند؛ هیچ چیز ویژه OneUptime لازم نیست.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد فراخوانی‌های SNS در AWS SDK را ترِیس می‌کند.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: بسته `OpenTelemetry.Instrumentation.AWS`، همراه با `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`؛ مجموعه ویژگی‌های پیش‌فرض آن اصلاً هیچ تاپیک SNS را نام نمی‌برد.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` AWS SDK را ترِیس می‌کند.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: بسته `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`، که با `otelaws.AppendMiddlewares(&cfg.APIOptions)` اضافه می‌شود.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **هر کلاینت دیگر**: از پشتیبانی OpenTelemetry خود کتابخانه کلاینت استفاده کنید، یا روی اسپن‌های اطراف ارسال‌ها و هندلرهای خود `messaging.system` = `aws.sns`، `messaging.destination.name` و نوع اسپن (PRODUCER هنگام انتشار، CONSUMER هنگام مصرف) را تنظیم کنید.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "سپس صادرکننده OTLP را به سمت OneUptime بگیرید. بیشتر SDKها و عامل‌ها این متغیرهای محیطی را می‌خوانند:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **این توکن یک راز است.** از یک کلید دریافت داده **سرور** استفاده کنید که در\n> رازهای استقرار شما نگه داشته می‌شود. هرگز کلید سرور را در JavaScript مرورگر نگذارید — برای آن\n> یک کلید دریافت داده **مرورگر** وجود دارد.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "متریک‌های CloudWatch تاپیک‌ها را با گیرنده `aws_cloudwatch` کالکتور بخوانید، یا آن‌ها را از راه یک CloudWatch Metric Stream و Amazon Data Firehose به گیرنده `awsfirehose` آن جریان دهید.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "گیرنده `aws_cloudwatch` با اعتبارنامه‌های پیش‌فرض AWS SDK (محیط، پروفایل مشترک یا نقش نمونه) API‌ی `GetMetricData` در CloudWatch را پرس‌وجو می‌کند، و این اعتبارنامه‌ها به `cloudwatch:ListMetrics` و `cloudwatch:GetMetricData` نیاز دارند:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **`stats` را تنظیم نکنید.** بدون آن هر متریک به‌صورت یک خلاصه در هر دوره می‌رسد، و OneUptime همین را می‌خواند.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` باید تنظیم شود، و سقف متریک‌هایی را که در هر اسکرپ خوانده می‌شوند تعیین می‌کند.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` منتظر می‌ماند تا CloudWatch یک دوره را منتشر کند، پس با این پیکربندی متریک‌های بروکر یک صف 11 تا 17 دقیقه دیر می‌رسند: مانیتوری که روی آن‌ها ساخته شود به پنجره طولانی‌تری نیاز دارد (**متریک‌های دیررس** را زیر [هشداردهی](/docs/telemetry/queues#alerting) ببینید).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- یک گیرنده یک منطقه و یک فضای نام را می‌خواند: برای هر منطقه یک نمونه بیفزایید.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "برای اینکه متریک‌ها را به‌جای آن جریانی بفرستید — یک CloudWatch Metric Stream از طریق Amazon Data Firehose به گیرنده `awsfirehose` کالکتور — [Amazon SQS](/docs/telemetry/queues#amazon-sqs) را ببینید.",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "چند پیام از صف‌هایتان عبور دهید. OneUptime هر 10 دقیقه اسپن‌های 15 دقیقه اخیر را می‌خواند و هر مقصدی را که دست‌کم 3 اسپن از آن‌ها نام می‌برند زیر **صف‌ها** فهرست می‌کند (اسپن‌های هر نوعی جز SERVER). در OneUptime خودمیزبان، `MESSAGE_QUEUE_MIN_SPANS` این عدد را تعیین می‌کند.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "یک نقطه داده از متریک بروکری که صفحه صف نمودارش می‌کند هم صفِ آن را می‌سازد: متریک‌های پایش ابری دیر می‌رسند، پس هر اجرا آن‌ها را از 60 دقیقه اخیر می‌خواند. متریک‌های کلاینت پیام‌رسانی، و متریک‌های خود شما که `messaging.system` و `messaging.destination.name` دارند، هرگز صفی نمی‌سازند: در زبانه **متریک‌ها** در صفحه صفی که وجود دارد نمایش داده می‌شوند.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "صف‌ها فقط تا وقتی خودبه‌خود ساخته می‌شوند که پروژه زیر [سقف ساخت خودکار](/docs/telemetry/queues#the-auto-create-budget) خود باشد.",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "نمای کلی صف این‌ها را زیر **سلامت بروکر** نمودار می‌کند، و هر گِیج و هر شمارش در هر دوره دکمه **ساخت مانیتور** دارد. تا وقتی یکی نرسیده، این بخش می‌گوید از کجا می‌آیند.",
  "| Metric | Shown as | Type |": "| متریک | نمایش با نام | نوع |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (جریان JSON: `numberofmessagespublished`) | پیام‌های منتشرشده | شمارش در هر دوره |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (جریان JSON: `numberofnotificationsdelivered`) | اعلان‌های تحویل‌شده | شمارش در هر دوره |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (جریان JSON: `numberofnotificationsfailed`) | اعلان‌های ناموفق | شمارش در هر دوره |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (جریان JSON: `numberofnotificationsredriventodlq`) | هدایت‌شده به صف dead-letter | شمارش در هر دوره |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- اسپن‌های آن هیچ سیستم پیام‌رسانی‌ای را که OneUptime بشناسد نام نمی‌برند: اسپن‌های Celery، تله‌متری خود BullMQ یا یک کلاینت دست‌ساز. `messaging.system` و `messaging.destination.name` را اضافه کنید و نوع اسپن‌ها را PRODUCER یا CONSUMER بگذارید.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- نام آن از نام‌هایی است که OneUptime نادیده می‌گیرد ([چه چیزی نادیده گرفته می‌شود](/docs/telemetry/queues#what-is-ignored) را ببینید)، یا فقط اسپن‌های SERVER آن را نام می‌برند.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- کمتر از 3 اسپن آن در 15 دقیقه اخیر رسیده، یا پروژه به [سقف ساخت خودکار](/docs/telemetry/queues#the-auto-create-budget) خود رسیده است.",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "وقتی اسپن‌هایش واقعاً نامش را می‌برند، آن را دستی با همان سیستم و مقصد بسازید (**صف‌ها ← ساخت صف**): زبانه **ترِیس‌ها** آن از اسپن‌هایی که از پیش ذخیره شده‌اند پر می‌شود.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "[صفی که برنامه‌هایم به کار می‌برند ساخته نشده است](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) را در صفحه مستندات صف‌ها ببینید.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- لاگ کالکتور را بررسی کنید. OneUptime کلید دریافت داده نادرست را با `401` رد می‌کند (`422` برای کلید غیرفعال یا کلید مرورگر)، و کالکتور برای هر دسته‌ای که کنار می‌گذارد `Exporting failed` را ثبت می‌کند.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- داده‌ها دیر می‌رسند. `aws_cloudwatch` به اندازه `delay` (10 دقیقه) منتظر انتشار CloudWatch می‌ماند، پس نقطه‌هایش 11 تا 17 دقیقه دیر می‌رسند.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "[سلامت بروکر خالی می‌ماند](/docs/telemetry/queues#broker-health-stays-empty) را در صفحه مستندات صف‌ها ببینید.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- دو سیستم نامش را می‌برند: کلاینت Kafka روی نقطه پایانی Kafka در Event Hubs `kafka` گزارش می‌کند، و SDK Event Hubs `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- یکی از مشاهده‌های Service Bus یا Event Hubs فضای نام ندارد: شبیه‌ساز یا یک دامنه سفارشی.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- اسپن‌های RabbitMQ معمولاً exchange را نام می‌برند، و متریک‌های بروکر صف را: دو صف در OneUptime، مگر اینکه exchange و صف هم‌نام باشند.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "آن را که نمی‌خواهید بایگانی کنید: صف بایگانی‌شده بایگانی می‌ماند، و آنچه نامش را می‌برد دیگر صف تازه‌ای نمی‌سازد.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "[دو صف برای یک مقصد](/docs/telemetry/queues#two-queues-for-one-destination) را در صفحه مستندات صف‌ها ببینید.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "مقصدی که برای هر درخواست یا هر مصرف‌کننده نام می‌گیرد و OneUptime آن را نمی‌شناسد — یک پسوند عددی، یک هش — برای هر نام یک صف می‌سازد. UUIDها از قبل یکی می‌شوند ([چه چیزی نادیده گرفته می‌شود](/docs/telemetry/queues#what-is-ignored) را ببینید). چنین مقصدهایی را در ابزارگذاری خود با `messaging.destination.temporary=true` علامت بزنید، یا به آن‌ها نامی پایدار بدهید، سپس صف‌هایی را که از قبل ساخته شده‌اند بایگانی کنید.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "[یک صف تازه برای هر درخواست](/docs/telemetry/queues#a-new-queue-for-every-request) را در صفحه مستندات صف‌ها ببینید.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Amazon SQS خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد فراخوانی‌های SQS در AWS SDK را ترِیس می‌کند.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: بسته `OpenTelemetry.Instrumentation.AWS`، همراه با `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`؛ مجموعه ویژگی‌های پیش‌فرض آن یک صف SQS را فقط با URL آن نام می‌برد.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`، یا `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`)، که با `otelaws.AppendMiddlewares(&cfg.APIOptions)` اضافه می‌شود. اسپن‌های SQS آن نشانی صف را در `server.address` دارند، که OneUptime آن را به‌عنوان صف می‌خواند.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "متریک‌های CloudWatch صف‌ها را با گیرنده `aws_cloudwatch` کالکتور بخوانید، یا آن‌ها را از راه یک CloudWatch Metric Stream و Amazon Data Firehose به گیرنده `awsfirehose` آن جریان دهید.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (جریان JSON: `approximatenumberofmessagesvisible`) | پیام‌های قابل مشاهده | گِیج |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (جریان JSON: `approximateageofoldestmessage`) | عمر قدیمی‌ترین پیام | گِیج |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (جریان JSON: `approximatenumberofmessagesnotvisible`) | پیام‌های در حال پردازش | گِیج |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (جریان JSON: `numberofmessagessent`) | پیام‌های ارسال‌شده | شمارش در هر دوره |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (جریان JSON: `numberofmessagesreceived`) | پیام‌های دریافت‌شده | شمارش در هر دوره |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (جریان JSON: `numberofmessagesdeleted`) | پیام‌های حذف‌شده | شمارش در هر دوره |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Apache ActiveMQ خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "اسپن‌ها سیستم را با `messaging.system` = `activemq` نام می‌برند (این‌ها هم پذیرفته می‌شوند: `artemis`، `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد کلاینت‌های JMS — ActiveMQ، Artemis، IBM MQ و هر بروکر JMS دیگری — را ترِیس می‌کند. اسپن‌های JMS، هر بروکری که پشتشان باشد، `jms` می‌گویند؛ یک صف ActiveMQ با همین خانواده JMS شناخته می‌شود، پس اسپن‌های کلاینت‌هایش و متریک‌های بروکرش روی یک صف می‌نشینند.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "کالکتور گیرنده JMX ندارد، پس OpenTelemetry JMX Scraper را با `OTEL_JMX_TARGET_SYSTEM=activemq` کنار یک بروکر ActiveMQ Classic اجرا کنید؛ متریک‌های مقصدِ بروکر را روی OTLP می‌فرستد.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. بگذارید بروکر اتصال‌های JMX را بپذیرد. با ایمیج `apache/activemq-classic` یا اسکریپت `bin/activemq`، پیش از راه‌اندازی آن `ACTIVEMQ_SUNJMX_START` را تنظیم کنید. این نمونه احراز هویت را خاموش می‌کند: پورت را روی یک شبکه خصوصی نگه دارید، یا `jmxremote.authenticate` را با یک فایل گذرواژه روشن کنید و `OTEL_JMX_USERNAME` و `OTEL_JMX_PASSWORD` را به خراشگر بدهید.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. اسکرپر را جایی اجرا کنید که به آن پورت دسترسی دارد، با یک محیط اجرای Java. مستقیماً به OneUptime می‌فرستد:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` نام‌های متریکی را که اسکرپر از 1.53.0-alpha به کار برده نگه می‌دارد (`activemq.message.queue.size`، با مقصد در `messaging.destination.name`)؛ OneUptime نام‌های قدیمی‌تر را هم می‌خواند (`activemq.message.current`، با مقصد در `destination`). ActiveMQ Artemis MBeanهای دیگری دارد که این قاعده‌ها نمی‌خوانند.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "یک نقطه داده از متریک بروکری که صفحه صف نمودارش می‌کند هم صفِ آن را می‌سازد. متریک‌های کلاینت پیام‌رسانی، و متریک‌های خود شما که `messaging.system` و `messaging.destination.name` دارند، هرگز صفی نمی‌سازند: در زبانه **متریک‌ها** در صفحه صفی که وجود دارد نمایش داده می‌شوند.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | اندازهٔ صف | گِیج |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | اندازهٔ صف (نام‌های قدیمی) | گِیج |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | واردشده به صف | شمارنده، با نمودار در ثانیه |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | خارج‌شده از صف | شمارنده، با نمودار در ثانیه |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | منقضی‌شده | شمارنده، با نمودار در ثانیه |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | مصرف‌کنندگان | گِیج |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | میانگین زمان در صف | گِیج |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | میانگین زمان در صف (نام‌های قدیمی) | گِیج |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- متریک صف را با نامی متفاوت از اسپن‌ها نام می‌برد ([محدودیت‌ها](/docs/telemetry/queues#limitations) را ببینید).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Apache Kafka خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "اسپن‌ها سیستم را با `messaging.system` = `kafka` نام می‌برند.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد تولیدکننده‌ها و مصرف‌کننده‌های Kafka را ترِیس می‌کند.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` با بسته `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` `kafkajs` را ترِیس می‌کند.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`، `opentelemetry-instrumentation-confluent-kafka` یا `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: ابزارگذاری خودکار OpenTelemetry Go (`go.opentelemetry.io/auto`، eBPF، روی Linux) بدون تغییر کد تولیدکننده‌ها و مصرف‌کننده‌های `segmentio/kafka-go` را ترِیس می‌کند.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "گیرنده `kafka_metrics` کالکتور، عقب‌ماندگی گروه‌های مصرف‌کننده و آفست‌های پارتیشن‌ها را از بروکرها می‌خواند؛ خراشگرهای `topics` و `consumers` آن را روشن کنید.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "برای کلاستری با SASL یا TLS، `auth` و `tls` را از حالت توضیح خارج کنید. گیرنده هر تاپیک را در `topic` نام می‌برد، و متریک‌ها از همین راه صف آن تاپیک را پیدا می‌کنند. تأخیر و آفست‌های ثبت‌شده یک گروه مصرف‌کننده را فقط برای تاپیک‌هایی گزارش می‌کند که گروه در آن‌ها آفستی ثبت کرده باشد، و از تاپیک‌هایی که نامشان با `_` شروع می‌شود می‌گذرد.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | تأخیر مصرف‌کننده | گِیج |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | تأخیر پارتیشن | گِیج |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | مصرف‌شده | شمارنده، با نمودار در ثانیه |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | تولیدشده | شمارنده، با نمودار در ثانیه |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka تأخیر یک گروه مصرف‌کننده را فقط پس از ثبت یک آفست توسط گروه گزارش می‌کند. گیرنده از تاپیک‌هایی که نامشان با `_` شروع می‌شود می‌گذرد.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Apache Pulsar خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "اسپن‌ها سیستم را با `messaging.system` = `pulsar` نام می‌برند (این‌ها هم پذیرفته می‌شوند: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد کلاینت‌های Pulsar را ترِیس می‌کند.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "هر بروکر متریک‌های تاپیک‌ها و اشتراک‌هایش را روی پورت سرویس وب خود ارائه می‌دهد؛ هر بروکر را خراش دهید، چون هر بروکر فقط تاپیک‌هایی را گزارش می‌کند که اکنون در اختیار دارد.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar هر سری را با نام کامل تاپیک (`persistent://public/default/orders`) برچسب می‌زند، و سری‌های یک پارتیشن را با نام آن پارتیشن: پارتیشن‌ها در تاپیک خود جمع می‌شوند.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | انباشت | گِیج |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | انباشت اشتراک | گِیج |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | عمر انباشت | گِیج |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | پیام‌های ورودی | شمارنده، با نمودار در ثانیه |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | پیام‌های خروجی | شمارنده، با نمودار در ثانیه |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Apache RocketMQ خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد کلاینت‌های RocketMQ را ترِیس می‌کند.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "`metricsExporterType=PROM` را در `broker.conf` بروکر تنظیم کنید تا بروکر متریک‌های عقب‌ماندگی و توان عملیاتی خود را ارائه دهد.",
  "Then scrape every broker:": "سپس هر بروکر را خراش دهید:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | پیام‌های آماده | گِیج |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | ارسال‌شده به صف dead-letter | شمارنده، با نمودار در ثانیه |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Azure Event Grid خودبه‌خود در OneUptime ظاهر می‌شوند، از اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor متریک‌های تحویل و پیام‌های مرده تاپیک‌ها را دارد، که گیرنده `azure_monitor` کالکتور می‌خواند؛ این‌ها هنوز روی صفحه صف نمودار نمی‌شوند، پس آن‌ها را در متریک‌ها بکاوید.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "گیرنده از طریق افزونه `azure_auth` وارد می‌شود: به service principal نقش **Monitoring Reader** را روی اشتراک بدهید، و `AZURE_TENANT_ID`، `AZURE_CLIENT_ID`، `AZURE_CLIENT_SECRET` و `AZURE_SUBSCRIPTION_ID` را در محیط کالکتور تنظیم کنید.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "متریک‌های کلاینت پیام‌رسانی، و متریک‌های خود شما که `messaging.system` و `messaging.destination.name` دارند، هرگز صفی نمی‌سازند: در زبانه **متریک‌ها** در صفحه صفی که وجود دارد نمایش داده می‌شوند.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime برای Azure Event Grid هیچ متریک بروکری را زیر **سلامت بروکر** نمودار نمی‌کند: آنچه کالکتور بالا می‌فرستد فقط به کاوشگر **متریک‌ها** می‌رسد. متریکی که روی هر نقطه داده `messaging.system` و `messaging.destination.name` دارد، در زبانه **متریک‌ها** در صفحه صف نمایش داده می‌شود.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid هیچ متریک نموداری ندارد. متریک‌هایش در کاوشگر **متریک‌ها** هستند.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Azure Event Hubs خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK برای Java خودش را ترِیس می‌کند، و عامل Java مربوط به OpenTelemetry آن ترِیس را به OpenTelemetry وصل می‌کند.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: اسپن‌های OpenTelemetry در Azure SDK آزمایشی هستند: `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (یا سوئیچ `Azure.Experimental.EnableActivitySource`) را تنظیم کنید و با `.AddSource("Azure.*")` منابع Azure را دنبال کنید.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: `createAzureSdkInstrumentation()` را از `@azure/opentelemetry-instrumentation-azure-sdk` ثبت کنید.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: `azure-core-tracing-opentelemetry` را نصب کنید و `settings.tracing_implementation = "opentelemetry"` (از `azure.core.settings`) را تنظیم کنید.',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "یک اشتراک Azure متصل، بی‌آنکه چیزی اجرا کنید، متریک‌های کلیدی فضای نام را برای هر Event Hub می‌خواند. برای خواندن همهٔ آن‌ها، گیرنده `azure_monitor` کالکتور را اجرا کنید، که آن‌ها را بر پایه بُعد EntityName برای هر Event Hub جدا می‌کند.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "گیرنده فهرست فضاهای نام شما را روزی یک بار می‌گیرد، پس ظاهر شدن یک فضای نام تازه می‌تواند تا 24 ساعت طول بکشد.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | پیام‌های ورودی | شمارش در هر دوره |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | پیام‌های خروجی | شمارش در هر دوره |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | خطاهای سرور | شمارش در هر دوره |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | خطاهای کاربر | شمارش در هر دوره |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | خطاهای فراتر رفتن از سهمیه | شمارش در هر دوره |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | درخواست‌های محدودشده | شمارش در هر دوره |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | اندازه | گِیج |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- متریک صف را با نامی متفاوت از اسپن‌ها نام می‌برد. اسپن‌های Service Bus و Event Hubs که میزبان فضای نام ندارند روی صفی جدا از متریک‌های Azure Monitor هستند ([محدودیت‌ها](/docs/telemetry/queues#limitations) را ببینید).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor برای هر متریک و فضای نام 10 صف برمی‌گرداند، مگر اینکه `maximum_number_of_records_per_resource` بالا برده شود. پیکربندی مرحله 3 آن را بالا می‌برد.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- گیرنده فضاهای نام شما را روزی یک بار فهرست می‌کند، پس ظاهر شدن یک فضای نام تازه ممکن است تا ۲۴ ساعت طول بکشد.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Azure Service Bus خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "یک اشتراک Azure متصل، بی‌آنکه چیزی اجرا کنید، متریک‌های کلیدی فضای نام را برای هر صف و تاپیک می‌خواند. برای خواندن همهٔ آن‌ها، گیرنده `azure_monitor` کالکتور را اجرا کنید، که آن‌ها را بر پایه بُعد EntityName برای هر صف و تاپیک جدا می‌کند.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | پیام‌های فعال | گِیج |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | پیام‌های dead-letter | گِیج |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | پیام‌های زمان‌بندی‌شده | گِیج |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | پیام‌های تکمیل‌شده | شمارش در هر دوره |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | پیام‌های رهاشده | شمارش در هر دوره |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | تأخیر ارسال سرور | گِیج |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های BullMQ خودبه‌خود در OneUptime ظاهر می‌شوند، از اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "تله‌متری خودِ BullMQ — گزینه `telemetry` آن، که بسته `bullmq-otel` پیاده‌اش می‌کند — نام صف را در `bullmq.queue.name` می‌برد و هیچ `messaging.system`ی تنظیم نمی‌کند، پس به‌تنهایی صفی نمی‌سازد. یک پردازنده `transform` در کالکتوری که برنامه‌هایتان به آن می‌فرستند، دو کلیدی را که OneUptime می‌خواند روی اسپن‌هایی که کارها را می‌افزایند و پردازش می‌کنند و روی متریک‌های خودِ BullMQ می‌افزاید:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "فقط اسپن‌های PRODUCER که کار اضافه می‌کنند و اسپن‌های CONSUMER که آن‌ها را پردازش می‌کنند برچسب می‌خورند: اسپن‌های داخلی BullMQ هم صف را نام می‌برند، اما پیام نیستند. صادرکننده OTLP برنامه‌هایتان را به سمت این کالکتور بگیرید.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ کارهایش را در Redis نگه می‌دارد و بروکری برای خراش دادن ندارد؛ عمق صف را از برنامه به‌صورت متریکی گزارش کنید که `messaging.system` و `messaging.destination.name` را دارد، همان‌طور که کارگرهای خودِ OneUptime با `queue.size` می‌کنند.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "تعداد کارها را در برنامه مشاهده کنید؛ گِیجی که خودش هر دو کلید را دارد به تبدیل نیازی ندارد:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime برای BullMQ هیچ متریک بروکری را زیر **سلامت بروکر** نمودار نمی‌کند. هر چه کالکتور بفرستد در کاوشگر **متریک‌ها** است، و متریکی که روی هر نقطه داده `messaging.system` و `messaging.destination.name` دارد، در زبانه **متریک‌ها** در صفحه صف نمایش داده می‌شود.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- اسپن‌های آن هیچ سیستم پیام‌رسانی‌ای را که OneUptime بشناسد نام نمی‌برند: اسپن‌های Celery، تله‌متری خود BullMQ یا یک کلاینت دست‌ساز. `messaging.system` و `messaging.destination.name` را اضافه کنید و نوع اسپن‌ها را PRODUCER یا CONSUMER بگذارید. برای BullMQ، تبدیل مرحله 2 این کار را می‌کند.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ هیچ متریک نموداری ندارد. متریک‌هایش در کاوشگر **متریک‌ها** هستند.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های Google Cloud Pub/Sub خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: کلاینت وقتی سازنده‌های `Publisher` و `Subscriber` آن یک نمونه OpenTelemetry و سوئیچ ترِیس را بگیرند، خودش را ترِیس می‌کند — `setOpenTelemetry(GlobalOpenTelemetry.get())` و `setEnableOpenTelemetryTracing(true)`. هیچ‌کدام از این دو فراخوانی به‌تنهایی چیزی را ترِیس نمی‌کند.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: با `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` و `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: با `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "متریک‌های تاپیک‌ها و اشتراک‌ها را با گیرنده `googlecloudmonitoring` کالکتور از Cloud Monitoring بخوانید، و هر نوع متریک را زیر `metrics_list` فهرست کنید.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "گیرنده با Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`، یا حساب سرویسی که کالکتور با آن اجرا می‌شود) وارد می‌شود، که به نقش **Monitoring Viewer** روی پروژه نیاز دارد. `project_id` را روی پروژه خود بگذارید:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "نوع متریکی که در `metrics_list` نیست هرگز خوانده نمی‌شود. متریک‌های اشتراک به صف اشتراک (`subscription_id`) و متریک‌های تاپیک به صف تاپیک (`topic_id`) می‌پیوندند.",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | پیام‌های تحویل‌نشده | گِیج |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | عمر قدیمی‌ترین پیام تأییدنشده | گِیج |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | پیام‌های dead-letter | شمارش در هر دوره |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | پیام‌های تأییدشده | شمارش در هر دوره |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | درخواست‌های انتشار | شمارش در هر دوره |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- متریک صف را با نامی متفاوت از اسپن‌ها نام می‌برد. یک تاپیک Pub/Sub متریک‌های تاپیک را دارد و اشتراک‌هایش متریک‌های اشتراک را.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring فقط نوع‌های موجود در `metrics_list` را می‌خواند.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- داده‌ها دیر می‌رسند. متریک‌های Pub/Sub چند دقیقه دیر می‌رسند.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های JMS خودبه‌خود در OneUptime ظاهر می‌شوند، از اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS یک API است و اسپن‌هایش نام بروکرِ پشت آن را نمی‌برند؛ وقتی بروکر Apache ActiveMQ باشد، OpenTelemetry JMX Scraper را روی آن اجرا کنید تا متریک‌هایش به همان صف بپیوندند، که سپس به‌صورت یک صف ActiveMQ نشان داده می‌شود، در حالی که بروکرهای JMS دیگر مانند IBM MQ هیچ راه آماده‌ای برای متریک ندارند.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "متریک‌های آن به همان صفِ اسپن‌های JMS می‌پیوندند، که از آن پس به‌عنوان صف Apache ActiveMQ نمایش داده می‌شود.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime برای JMS هیچ متریک بروکری را زیر **سلامت بروکر** نمودار نمی‌کند. هر چه کالکتور بفرستد در کاوشگر **متریک‌ها** است، و متریکی که روی هر نقطه داده `messaging.system` و `messaging.destination.name` دارد، در زبانه **متریک‌ها** در صفحه صف نمایش داده می‌شود.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "همین که متریک‌های یک بروکر Apache ActiveMQ برسد، صف به‌عنوان صف Apache ActiveMQ نمایش داده می‌شود و آن‌ها را زیر **سلامت بروکر** نمودار می‌کند: [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq) را ببینید.",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- بروکرهای JMS به‌جز ActiveMQ هیچ متریک نموداری ندارند. متریک‌هایشان در کاوشگر **متریک‌ها** هستند. برای یک بروکر ActiveMQ، **اگر کارگزار Apache ActiveMQ است** را زیر **پیشرفته** ببینید.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های NATS خودبه‌خود در OneUptime ظاهر می‌شوند، از اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد کلاینت‌های NATS را ترِیس می‌کند — ابزارگذاری NATS آن `messaging.system` = `nats` را گزارش می‌کند.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "prometheus-nats-exporter را با `-jsz=all` روی پورت پایش سرور اجرا کنید. متریک‌های JetStream آن برای هر جریان و مصرف‌کننده‌اند، نه برای هر subject، پس به صف‌های سطح subject وصل نمی‌شوند.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "پورت پایش سرور را با `-m 8222` (یا `http_port: 8222` در پیکربندی آن) روشن کنید، سپس صادرکننده را اجرا کنید:",
  "And scrape it:": "و آن را خراش دهید:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime برای NATS هیچ متریک بروکری را زیر **سلامت بروکر** نمودار نمی‌کند: آنچه کالکتور بالا می‌فرستد فقط به کاوشگر **متریک‌ها** می‌رسد. متریکی که روی هر نقطه داده `messaging.system` و `messaging.destination.name` دارد، در زبانه **متریک‌ها** در صفحه صف نمایش داده می‌شود.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS هیچ متریک نموداری ندارد. متریک‌هایش در کاوشگر **متریک‌ها** هستند.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "صف‌های RabbitMQ خودبه‌خود در OneUptime ظاهر می‌شوند، از دو منبع: اسپن‌های پیام‌رسانی برنامه‌هایی که در آن‌ها منتشر می‌کنند و از آن‌ها مصرف می‌کنند، و متریک‌های خود بروکر. می‌توانید یک صف را دستی هم اضافه کنید: **صف‌ها ← ساخت صف**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: عامل Java مربوط به OpenTelemetry بدون تغییر کد کلاینت‌های RabbitMQ را ترِیس می‌کند.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 خودش را ترِیس می‌کند: `RabbitMQ.Client.*` را دنبال کنید. MassTransit هم خودش را ترِیس می‌کند: `MassTransit` را دنبال کنید.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` یا `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "گیرنده `rabbitmq` کالکتور عمق، مصرف‌کنندگان و نرخ پیام هر صف را از API HTTP افزونه مدیریت می‌خواند، به‌عنوان کاربری با برچسب `monitoring` که به هر میزبان مجازی دسترسی دارد.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "افزونه مدیریت را فعال کنید و آن کاربر را بسازید. برچسب `monitoring` به‌تنهایی هیچ صفی را به او نشان نمی‌دهد: به او به هر میزبان مجازی که باید پایش شود دسترسی بدهید. الگوهای خالی این دسترسی را بدون هیچ حقی برای پیکربندی، انتشار یا مصرف می‌دهند:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "`RABBITMQ_USERNAME` و `RABBITMQ_PASSWORD` را در محیط کالکتور تنظیم کنید. گیرنده هر صف را با نام RabbitMQ آن گزارش می‌کند، در حالی که اسپن‌های بیشتر ابزارگذاری‌ها exchangeی را نام می‌برند که پیام از آن گذشته است: این دو برای پیام‌هایی که از exchange پیش‌فرض فرستاده می‌شوند با هم جور درمی‌آیند، چون routing key آن نام صف است.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | عمق صف | گِیج |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | منتشرشده | شمارنده، با نمودار در ثانیه |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | تحویل‌شده | شمارنده، با نمودار در ثانیه |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | تأییدشده | شمارنده، با نمودار در ثانیه |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | رهاشده | شمارنده، با نمودار در ثانیه |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- متریک صف را با نامی متفاوت از اسپن‌ها نام می‌برد. اسپن‌های RabbitMQ معمولاً exchange را نام می‌برند، در حالی که متریک‌های بروکر صف‌ها را توصیف می‌کنند. این دو برای پیام‌هایی که از exchange پیش‌فرض فرستاده می‌شوند با هم جور درمی‌آیند، چون routing key آن نام صف است.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ فقط صف‌های میزبان‌های مجازی‌ای را گزارش می‌کند که کاربرش به آن‌ها دسترسی دارد، و برای بقیه هیچ خطایی ثبت نمی‌کند. شمارنده‌های RabbitMQ با نخستین فعالیت ظاهر می‌شوند.",
};

export default TRANSLATION;
