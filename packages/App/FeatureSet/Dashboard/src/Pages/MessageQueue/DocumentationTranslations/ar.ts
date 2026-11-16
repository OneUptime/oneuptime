import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Amazon SNS في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "تسمّي الامتدادات النظام بـ `messaging.system` = `aws.sns` (ويُقبل أيضًا: `aws_sns`، `amazonsns`، `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "تأتي قوائم الانتظار من امتدادات المراسلة التي ينتجها تجهيز OpenTelemetry لديك بالفعل؛ لا حاجة إلى أي شيء خاص بـ OneUptime.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry استدعاءات SNS في AWS SDK دون أي تغيير في الشيفرة.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: الحزمة `OpenTelemetry.Instrumentation.AWS`، مع `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`؛ ومجموعة سماتها الافتراضية لا تسمّي أي موضوع SNS إطلاقًا.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: تتبّع `@opentelemetry/auto-instrumentations-node` حزمة AWS SDK.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: الحزمة `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`، ويُضاف بـ `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **أي عميل آخر**: استخدم دعم OpenTelemetry الخاص بمكتبة العميل، أو اضبط `messaging.system` = `aws.sns` و`messaging.destination.name` ونوع الامتداد (PRODUCER عند النشر، وCONSUMER عند الاستهلاك) على الامتدادات المحيطة بعمليات الإرسال والمعالجات لديك.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "ثم وجّه مُصدِّر OTLP إلى OneUptime. تقرأ معظم حِزم SDK والوكلاء متغيرات البيئة هذه:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **هذا الرمز سرّ.** استخدم مفتاح استيعاب من نوع **الخادم**، محفوظًا في\n> أسرار النشر لديك. لا تضع مفتاح الخادم أبدًا في JavaScript المتصفح — فلذلك يوجد\n> مفتاح استيعاب من نوع **المتصفح**.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "اقرأ مقاييس CloudWatch للمواضيع باستخدام المستقبِل `aws_cloudwatch` في المجمّع، أو بثّها عبر CloudWatch Metric Stream وAmazon Data Firehose إلى المستقبِل `awsfirehose` فيه.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "يستطلع المستقبِل `aws_cloudwatch` واجهة `GetMetricData` في CloudWatch ببيانات الاعتماد الافتراضية لـ AWS SDK (البيئة، أو الملف الشخصي المشترك، أو دور المثيل)، والتي تحتاج إلى `cloudwatch:ListMetrics` و`cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **اترك `stats` دون ضبط.** فبدونه يصل كل مقياس كملخص واحد لكل فترة، وهذا ما يقرؤه OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- يجب ضبط `discovery.limit`، وهو يحدّ المقاييس المقروءة في كل جمع.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- ينتظر `delay` أن ينشر CloudWatch الفترة، لذا تصل مقاييس الوسيط لقائمة الانتظار بهذا الإعداد متأخرة من 11 إلى 17 دقيقة: والمراقبة عليها تحتاج إلى نافذة أطول (راجع **المقاييس المتأخرة** ضمن [التنبيهات](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- يقرأ المستقبِل الواحد منطقة واحدة ومساحة اسم واحدة: أضف نسخة لكل منطقة.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "لبثّ المقاييس بدلًا من ذلك — عبر CloudWatch Metric Stream وAmazon Data Firehose إلى المستقبِل `awsfirehose` في المجمّع — راجع [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "أرسل بضع رسائل عبر قوائم الانتظار لديك. كل 10 دقائق يقرأ OneUptime امتدادات آخر 15 دقيقة ويسرد ضمن **قوائم الانتظار** كل وجهة يسمّيها 3 منها على الأقل (امتدادات من أي نوع عدا SERVER). وفي OneUptime المستضاف ذاتيًا، يحدّد `MESSAGE_QUEUE_MIN_SPANS` هذا العدد.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "نقطة بيانات واحدة من مقياس وسيط ترسمه صفحة قائمة الانتظار تنشئ قائمة انتظاره أيضًا: مقاييس المراقبة السحابية تصل متأخرة، لذا يقرؤها كل تشغيل من آخر 60 دقيقة. مقاييس عملاء المراسلة، ومقاييسك الخاصة التي تحمل `messaging.system` و`messaging.destination.name`، لا تنشئ قائمة انتظار أبدًا: إنها تظهر في علامة التبويب **المقاييس** لقائمة انتظار موجودة.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "لا تُنشأ قوائم الانتظار تلقائيًا إلا ما دام المشروع دون [ميزانية الإنشاء التلقائي](/docs/telemetry/queues#the-auto-create-budget) الخاصة به.",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "ترسم النظرة العامة لقائمة الانتظار هذه المقاييس ضمن **سلامة الوسيط**، ولكل مؤشر وكل عدد في الفترة زر **إنشاء مراقبة**. وإلى أن يصل أحدها، يوضّح القسم من أين تأتي.",
  "| Metric | Shown as | Type |": "| المقياس | يظهر باسم | النوع |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (تدفق JSON: `numberofmessagespublished`) | الرسائل المنشورة | العدد في كل فترة |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (تدفق JSON: `numberofnotificationsdelivered`) | الإشعارات المُسلَّمة | العدد في كل فترة |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (تدفق JSON: `numberofnotificationsfailed`) | الإشعارات الفاشلة | العدد في كل فترة |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (تدفق JSON: `numberofnotificationsredriventodlq`) | مُحوَّل إلى قائمة الرسائل الميتة | العدد في كل فترة |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- لا تسمّي امتداداتها أي نظام مراسلة يستطيع OneUptime تمييزه: امتدادات Celery، أو قياسات BullMQ عن بُعد الخاصة به، أو عميل مكتوب يدويًا. أضف `messaging.system` و`messaging.destination.name`، واجعل نوع الامتدادات PRODUCER أو CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- اسمها من الأسماء التي يتجاهلها OneUptime (راجع [ما يُتجاهَل](/docs/telemetry/queues#what-is-ignored))، أو لا تسمّيها إلا امتدادات SERVER.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- وصل أقل من 3 من امتداداتها في آخر 15 دقيقة، أو بلغ المشروع [ميزانية الإنشاء التلقائي](/docs/telemetry/queues#the-auto-create-budget) الخاصة به.",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "حين تسمّيها امتداداتها فعلًا، أنشئها يدويًا بالنظام والوجهة نفسيهما (**قوائم الانتظار ← إنشاء قائمة الانتظار**): فتمتلئ علامة التبويب **التتبعات** الخاصة بها من الامتدادات المخزّنة مسبقًا.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "راجع [لم تُنشأ قائمة انتظار تستخدمها تطبيقاتي](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) في صفحة توثيق قوائم الانتظار.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- افحص سجل المجمّع. يرفض OneUptime مفتاح الاستيعاب الخاطئ بـ `401` (و`422` للمفتاح المعطّل أو مفتاح المتصفح)، ويسجّل المجمّع `Exporting failed` لكل دفعة يُسقطها.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- البيانات متأخرة. ينتظر `aws_cloudwatch` مدة `delay` (10 دقائق) حتى ينشر CloudWatch، لذا تصل نقاطه متأخرة من 11 إلى 17 دقيقة.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "راجع [تبقى سلامة الوسيط فارغة](/docs/telemetry/queues#broker-health-stays-empty) في صفحة توثيق قوائم الانتظار.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- يسمّيها نظامان: عميل Kafka على نقطة نهاية Kafka في Event Hubs يبلّغ `kafka`، وحزمة Event Hubs SDK تبلّغ `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- إحدى مشاهدات Service Bus أو Event Hubs بلا مساحة اسم: المحاكي أو نطاق مخصص.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- تسمّي امتدادات RabbitMQ عادةً الـ exchange، وتسمّي مقاييس الوسيط قائمة الانتظار: فتظهر قائمتا انتظار في OneUptime ما لم يتشارك الـ exchange وقائمة الانتظار الاسم نفسه.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "أرشِف القائمة التي لا تريدها: تبقى قائمة الانتظار المؤرشفة مؤرشفة، ولا يعود ما يسمّيها ينشئ قائمة جديدة.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "راجع [قائمتا انتظار لوجهة واحدة](/docs/telemetry/queues#two-queues-for-one-destination) في صفحة توثيق قوائم الانتظار.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "الوجهة المسمّاة لكل طلب أو لكل مستهلك ولا يتعرّف عليها OneUptime — لاحقة رقمية، أو تجزئة — تنشئ قائمة انتظار لكل اسم. معرّفات UUID تُدمج بالفعل (راجع [ما يُتجاهَل](/docs/telemetry/queues#what-is-ignored)). علّم مثل هذه الوجهات بـ `messaging.destination.temporary=true` في التجهيز لديك، أو امنحها اسمًا ثابتًا، ثم أرشِف قوائم الانتظار التي أُنشئت بالفعل.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "راجع [قائمة انتظار جديدة لكل طلب](/docs/telemetry/queues#a-new-queue-for-every-request) في صفحة توثيق قوائم الانتظار.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Amazon SQS في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry استدعاءات SQS في AWS SDK دون أي تغيير في الشيفرة.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: الحزمة `OpenTelemetry.Instrumentation.AWS`، مع `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`؛ ومجموعة سماتها الافتراضية لا تسمّي قائمة انتظار SQS إلا بعنوان URL الخاص بها.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`، أو `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`)، ويُضاف بـ `otelaws.AppendMiddlewares(&cfg.APIOptions)`. تحمل امتدادات SQS فيه عنوان URL لقائمة الانتظار في `server.address`، ويقرؤه OneUptime على أنه قائمة الانتظار.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "اقرأ مقاييس CloudWatch لقوائم الانتظار باستخدام المستقبِل `aws_cloudwatch` في المجمّع، أو بثّها عبر CloudWatch Metric Stream وAmazon Data Firehose إلى المستقبِل `awsfirehose` فيه.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (تدفق JSON: `approximatenumberofmessagesvisible`) | الرسائل المرئية | المؤشر |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (تدفق JSON: `approximateageofoldestmessage`) | عمر أقدم رسالة | المؤشر |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (تدفق JSON: `approximatenumberofmessagesnotvisible`) | الرسائل قيد المعالجة | المؤشر |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (تدفق JSON: `numberofmessagessent`) | الرسائل المُرسَلة | العدد في كل فترة |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (تدفق JSON: `numberofmessagesreceived`) | الرسائل المُستلَمة | العدد في كل فترة |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (تدفق JSON: `numberofmessagesdeleted`) | الرسائل المحذوفة | العدد في كل فترة |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Apache ActiveMQ في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "تسمّي الامتدادات النظام بـ `messaging.system` = `activemq` (ويُقبل أيضًا: `artemis`، `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry عملاء JMS — ActiveMQ وArtemis وIBM MQ وكل وسيط JMS آخر — دون أي تغيير في الشيفرة. تقول امتدادات JMS `jms` أيًّا كان الوسيط خلفها؛ وتُعرَّف قائمة انتظار ActiveMQ بعائلة JMS هذه، فتصل امتدادات عملائها ومقاييس وسيطها إلى قائمة انتظار واحدة.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "لا يملك المجمّع مستقبِل JMX، لذا شغّل OpenTelemetry JMX Scraper مع `OTEL_JMX_TARGET_SYSTEM=activemq` بجوار وسيط ActiveMQ Classic؛ فهو يدفع مقاييس الوجهات في الوسيط عبر OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. اجعل الوسيط يقبل اتصالات JMX. مع الصورة `apache/activemq-classic` أو البرنامج النصي `bin/activemq`، اضبط `ACTIVEMQ_SUNJMX_START` قبل تشغيله. يُوقف هذا المثال المصادقة: أبقِ المنفذ على شبكة خاصة، أو فعّل `jmxremote.authenticate` بملف كلمات مرور وأعطِ الأداة `OTEL_JMX_USERNAME` و`OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. شغّل الأداة حيث تستطيع الوصول إلى ذلك المنفذ، مع بيئة تشغيل Java. وهي ترسل مباشرة إلى OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "يُبقي `OTEL_JMX_TARGET_SOURCE=instrumentation` أسماء المقاييس التي تستخدمها الأداة منذ 1.53.0-alpha (`activemq.message.queue.size`، والوجهة في `messaging.destination.name`)؛ ويقرأ OneUptime أيضًا الأسماء الأقدم (`activemq.message.current`، والوجهة في `destination`). أما ActiveMQ Artemis فله MBeans مختلفة لا تقرؤها هذه القواعد.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "نقطة بيانات واحدة من مقياس وسيط ترسمه صفحة قائمة الانتظار تنشئ قائمة انتظاره أيضًا. مقاييس عملاء المراسلة، ومقاييسك الخاصة التي تحمل `messaging.system` و`messaging.destination.name`، لا تنشئ قائمة انتظار أبدًا: إنها تظهر في علامة التبويب **المقاييس** لقائمة انتظار موجودة.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | حجم قائمة الانتظار | المؤشر |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | حجم قائمة الانتظار (الأسماء القديمة) | المؤشر |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | مُضاف إلى قائمة الانتظار | عدّاد، يُرسم في الثانية |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | مُزال من قائمة الانتظار | عدّاد، يُرسم في الثانية |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | منتهي الصلاحية | عدّاد، يُرسم في الثانية |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | المستهلكون | المؤشر |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | متوسط الوقت في قائمة الانتظار | المؤشر |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | متوسط الوقت في قائمة الانتظار (الأسماء القديمة) | المؤشر |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- يسمّي المقياس قائمة الانتظار باسم مختلف عن اسمها في الامتدادات (راجع [القيود](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Apache Kafka في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "تسمّي الامتدادات النظام بـ `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry منتجي Kafka ومستهلكيه دون أي تغيير في الشيفرة.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` مع الحزمة `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: تتبّع `@opentelemetry/auto-instrumentations-node` المكتبة `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`، أو `opentelemetry-instrumentation-confluent-kafka`، أو `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: يتتبّع التجهيز التلقائي لـ OpenTelemetry Go (`go.opentelemetry.io/auto`، eBPF، على Linux) منتجي `segmentio/kafka-go` ومستهلكيها دون أي تغيير في الشيفرة.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "يقرأ المستقبِل `kafka_metrics` في المجمّع تأخر مجموعات المستهلكين وإزاحات الأقسام من الوسطاء؛ فعّل أداتي الجمع `topics` و`consumers` فيه.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "لعنقود يستخدم SASL أو TLS، أزل التعليق عن `auth` و`tls`. يسمّي المستقبِل كل موضوع في `topic`، وبه تجد المقاييس قائمة انتظار الموضوع. ولا يبلّغ عن تأخر مجموعة المستهلكين وإزاحاتها المثبّتة إلا للمواضيع التي ثبّتت فيها المجموعة إزاحة، ويتخطى المواضيع التي تبدأ أسماؤها بـ `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | تأخر المستهلك | المؤشر |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | تأخر القسم | المؤشر |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | مُستهلَك | عدّاد، يُرسم في الثانية |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | مُنتَج | عدّاد، يُرسم في الثانية |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- لا يبلّغ Kafka عن تأخر مجموعة المستهلكين إلا بعد أن تثبّت المجموعة إزاحة. ويتخطى المستقبِل المواضيع التي تبدأ أسماؤها بـ `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Apache Pulsar في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "تسمّي الامتدادات النظام بـ `messaging.system` = `pulsar` (ويُقبل أيضًا: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry عملاء Pulsar دون أي تغيير في الشيفرة.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "يقدّم كل وسيط مقاييس مواضيعه واشتراكاته على منفذ خدمة الويب لديه؛ اجمع من كل وسيط، لأن الوسيط لا يبلّغ إلا عن المواضيع التي يملكها حاليًا.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "يوسم Pulsar كل سلسلة بالاسم الكامل للموضوع (`persistent://public/default/orders`)، وسلاسل القسم باسم القسم: فتُجمع الأقسام في موضوعها.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | التراكم | المؤشر |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | تراكم الاشتراك | المؤشر |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | عمر التراكم | المؤشر |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | الرسائل الداخلة | عدّاد، يُرسم في الثانية |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | الرسائل الخارجة | عدّاد، يُرسم في الثانية |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Apache RocketMQ في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry عملاء RocketMQ دون أي تغيير في الشيفرة.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "اضبط `metricsExporterType=PROM` في `broker.conf` الخاص بالوسيط ليقدّم الوسيط مقاييس التأخر والإنتاجية.",
  "Then scrape every broker:": "ثم اجمع من كل وسيط:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | الرسائل الجاهزة | المؤشر |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | مُرسَل إلى قائمة الرسائل الميتة | عدّاد، يُرسم في الثانية |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Azure Event Grid في OneUptime تلقائيًا، من امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "يملك Azure Monitor مقاييس التسليم والرسائل الميتة للمواضيع، ويقرؤها المستقبِل `azure_monitor` في المجمّع؛ لكنها لا تُرسم بعد على صفحة قائمة انتظار، فاستكشفها ضمن المقاييس.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "يسجّل المستقبِل الدخول عبر الامتداد البرمجي `azure_auth`: امنح كيان الخدمة الدور **Monitoring Reader** على الاشتراك، واضبط `AZURE_TENANT_ID` و`AZURE_CLIENT_ID` و`AZURE_CLIENT_SECRET` و`AZURE_SUBSCRIPTION_ID` في بيئة المجمّع.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "مقاييس عملاء المراسلة، ومقاييسك الخاصة التي تحمل `messaging.system` و`messaging.destination.name`، لا تنشئ قائمة انتظار أبدًا: إنها تظهر في علامة التبويب **المقاييس** لقائمة انتظار موجودة.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "لا يرسم OneUptime أي مقاييس وسيط لـ Azure Event Grid ضمن **سلامة الوسيط**: ما يرسله المجمّع أعلاه لا يصل إلا إلى مستكشف **المقاييس**. أما المقياس الذي يحمل `messaging.system` و`messaging.destination.name` على كل نقطة بيانات فيظهر في علامة التبويب **المقاييس** لقائمة الانتظار.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- ليست لـ Azure Event Grid مقاييس مرسومة. مقاييسه موجودة في مستكشف **المقاييس**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Azure Event Hubs في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: تتتبّع Azure SDK for Java نفسها، ويربط وكيل Java الخاص بـ OpenTelemetry ذلك التتبّع بـ OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: امتدادات OpenTelemetry في Azure SDK تجريبية: اضبط `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (أو المفتاح `Azure.Experimental.EnableActivitySource`) واشترك في مصادر Azure بـ `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: سجّل `createAzureSdkInstrumentation()` من `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: ثبّت `azure-core-tracing-opentelemetry` واضبط `settings.tracing_implementation = "opentelemetry"` (من `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "يقرأ اشتراك Azure المتصل المقاييس الرئيسية لمساحة الاسم لكل مركز أحداث، دون تشغيل أي شيء. ولقراءتها كلها، شغّل المستقبِل `azure_monitor` في المجمّع، الذي يقسّمها حسب البُعد EntityName لكل مركز أحداث.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "يسرد المستقبِل مساحات الأسماء لديك مرة واحدة يوميًا، لذا قد يستغرق ظهور مساحة اسم جديدة ما يصل إلى 24 ساعة.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | الرسائل الواردة | العدد في كل فترة |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | الرسائل الصادرة | العدد في كل فترة |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | أخطاء الخادم | العدد في كل فترة |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | أخطاء المستخدم | العدد في كل فترة |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | أخطاء تجاوز الحصة | العدد في كل فترة |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | الطلبات المقيَّدة | العدد في كل فترة |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | الحجم | المؤشر |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- يسمّي المقياس قائمة الانتظار باسم مختلف عن اسمها في الامتدادات. امتدادات Service Bus وEvent Hubs التي لا تحمل مضيف مساحة الاسم تقع على قائمة انتظار غير التي تحمل مقاييس Azure Monitor (راجع [القيود](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- يعيد Azure Monitor عشر قوائم انتظار لكل مقياس ومساحة اسم ما لم يُرفع `maximum_number_of_records_per_resource`. والإعداد في الخطوة 3 يرفعه.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- يسرد المستقبِل مساحات الأسماء لديك مرة واحدة يوميًا، لذا قد يستغرق ظهور مساحة اسم جديدة ما يصل إلى 24 ساعة.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Azure Service Bus في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "يقرأ اشتراك Azure المتصل المقاييس الرئيسية لمساحة الاسم لكل قائمة انتظار وموضوع، دون تشغيل أي شيء. ولقراءتها كلها، شغّل المستقبِل `azure_monitor` في المجمّع، الذي يقسّمها حسب البُعد EntityName لكل قائمة انتظار وموضوع.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | الرسائل النشطة | المؤشر |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | الرسائل الميتة | المؤشر |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | الرسائل المجدولة | المؤشر |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | الرسائل المكتملة | العدد في كل فترة |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | الرسائل المتروكة | العدد في كل فترة |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | زمن انتقال الإرسال في الخادم | المؤشر |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار BullMQ في OneUptime تلقائيًا، من امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "قياسات BullMQ عن بُعد الخاصة به — خياره `telemetry`، الذي تنفّذه الحزمة `bullmq-otel` — تسمّي قائمة الانتظار في `bullmq.queue.name` ولا تضبط `messaging.system`، فلا تنشئ وحدها أي قائمة انتظار. يضيف معالج `transform` في المجمّع الذي ترسل إليه تطبيقاتك المفتاحين اللذين يقرؤهما OneUptime، على الامتدادات التي تضيف المهام وتعالجها وعلى مقاييس BullMQ الخاصة به:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "لا يُوسم إلا امتدادات PRODUCER التي تضيف المهام وامتدادات CONSUMER التي تعالجها: فامتدادات BullMQ الداخلية تسمّي قائمة الانتظار أيضًا، لكنها ليست رسائل. وجّه مُصدِّر OTLP في تطبيقاتك إلى هذا المجمّع.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "يحفظ BullMQ مهامه في Redis وليس لديه وسيط يُجمع منه؛ أبلغ عن عمق قائمة الانتظار من التطبيق كمقياس يحمل `messaging.system` و`messaging.destination.name`، كما تفعل عمّال OneUptime نفسه مع `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "راقب أعداد المهام في التطبيق؛ والمؤشر الذي يحمل المفتاحين بنفسه لا يحتاج إلى تحويل:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "لا يرسم OneUptime أي مقاييس وسيط لـ BullMQ ضمن **سلامة الوسيط**. كل ما يرسله المجمّع موجود في مستكشف **المقاييس**، والمقياس الذي يحمل `messaging.system` و`messaging.destination.name` على كل نقطة بيانات يظهر في علامة التبويب **المقاييس** لقائمة الانتظار.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- لا تسمّي امتداداتها أي نظام مراسلة يستطيع OneUptime تمييزه: امتدادات Celery، أو قياسات BullMQ عن بُعد الخاصة به، أو عميل مكتوب يدويًا. أضف `messaging.system` و`messaging.destination.name`، واجعل نوع الامتدادات PRODUCER أو CONSUMER. وبالنسبة إلى BullMQ، يتولى ذلك التحويلُ في الخطوة 2.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- ليست لـ BullMQ مقاييس مرسومة. مقاييسه موجودة في مستكشف **المقاييس**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار Google Cloud Pub/Sub في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: يتتبّع العميل نفسه بمجرد أن يحصل مُنشئا `Publisher` و`Subscriber` لديه على مثيل OpenTelemetry ومفتاح التتبّع — `setOpenTelemetry(GlobalOpenTelemetry.get())` و`setEnableOpenTelemetryTracing(true)`. وأيّ الاستدعاءين وحده لا يتتبّع شيئًا.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: باستخدام `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` و`SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: باستخدام `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "اقرأ مقاييس المواضيع والاشتراكات من Cloud Monitoring باستخدام المستقبِل `googlecloudmonitoring` في المجمّع، مع سرد كل نوع مقياس ضمن `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "يسجّل المستقبِل الدخول ببيانات Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`، أو حساب الخدمة الذي يعمل به المجمّع)، التي تحتاج إلى الدور **Monitoring Viewer** على المشروع. اضبط `project_id` على مشروعك:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "نوع المقياس الغائب عن `metrics_list` لا يُقرأ أبدًا. تُلحق مقاييس الاشتراك بقائمة انتظار الاشتراك (`subscription_id`)، ومقاييس الموضوع بقائمة انتظار الموضوع (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | الرسائل غير المُسلَّمة | المؤشر |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | عمر أقدم رسالة غير مُقَرّ بها | المؤشر |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | الرسائل الميتة | العدد في كل فترة |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | الرسائل المُقَرّ بها | العدد في كل فترة |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | طلبات النشر | العدد في كل فترة |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- يسمّي المقياس قائمة الانتظار باسم مختلف عن اسمها في الامتدادات. لموضوع Pub/Sub مقاييس الموضوع، ولاشتراكاته مقاييس الاشتراك.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- لا يقرأ Cloud Monitoring إلا الأنواع الواردة في `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- البيانات متأخرة. تصل مقاييس Pub/Sub متأخرة بضع دقائق.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار JMS في OneUptime تلقائيًا، من امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS واجهة برمجة، وامتداداتها لا تسمّي الوسيط الذي خلفها؛ وحين يكون الوسيط Apache ActiveMQ، شغّل OpenTelemetry JMX Scraper عليه فتنضم مقاييسه إلى قائمة الانتظار نفسها، التي تظهر حينها كقائمة انتظار ActiveMQ، بينما لا يوجد مسار جاهز لمقاييس وسطاء JMS الآخرين مثل IBM MQ.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "تنضم مقاييسه إلى قائمة الانتظار نفسها التي تحمل امتدادات JMS، والتي تظهر منذ ذلك الحين كقائمة انتظار Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "لا يرسم OneUptime أي مقاييس وسيط لـ JMS ضمن **سلامة الوسيط**. كل ما يرسله المجمّع موجود في مستكشف **المقاييس**، والمقياس الذي يحمل `messaging.system` و`messaging.destination.name` على كل نقطة بيانات يظهر في علامة التبويب **المقاييس** لقائمة الانتظار.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "بمجرد وصول مقاييس وسيط Apache ActiveMQ، تظهر قائمة الانتظار كقائمة انتظار Apache ActiveMQ وترسمها ضمن **سلامة الوسيط**: راجع [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ليست لوسطاء JMS غير ActiveMQ مقاييس مرسومة. مقاييسهم موجودة في مستكشف **المقاييس**. ولوسيط ActiveMQ، راجع **إذا كان الوسيط Apache ActiveMQ** ضمن **متقدم**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار NATS في OneUptime تلقائيًا، من امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry عملاء NATS — ويبلّغ تجهيز NATS فيه `messaging.system` = `nats` — دون أي تغيير في الشيفرة.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "شغّل prometheus-nats-exporter مع `-jsz=all` على منفذ المراقبة في الخادم. مقاييس JetStream فيه لكل تدفق ومستهلك، لا لكل موضوع رسائل، لذا لا تُلحق بقوائم الانتظار على مستوى الموضوع.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "فعّل منفذ المراقبة في الخادم بـ `-m 8222` (أو `http_port: 8222` في إعداده)، ثم شغّل أداة التصدير:",
  "And scrape it:": "ثم اجمع منها:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "لا يرسم OneUptime أي مقاييس وسيط لـ NATS ضمن **سلامة الوسيط**: ما يرسله المجمّع أعلاه لا يصل إلا إلى مستكشف **المقاييس**. أما المقياس الذي يحمل `messaging.system` و`messaging.destination.name` على كل نقطة بيانات فيظهر في علامة التبويب **المقاييس** لقائمة الانتظار.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- ليست لـ NATS مقاييس مرسومة. مقاييسه موجودة في مستكشف **المقاييس**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "تظهر قوائم انتظار RabbitMQ في OneUptime تلقائيًا، من مصدرين: امتدادات المراسلة في التطبيقات التي تنشر إليها وتستهلك منها، ومقاييس الوسيط نفسه. ويمكنك أيضًا إضافة قائمة انتظار يدويًا: **قوائم الانتظار ← إنشاء قائمة الانتظار**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: يتتبّع وكيل Java الخاص بـ OpenTelemetry عملاء RabbitMQ دون أي تغيير في الشيفرة.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: تتتبّع `RabbitMQ.Client` 7 نفسها: اشترك في `RabbitMQ.Client.*`. وتتتبّع MassTransit نفسها أيضًا: اشترك في `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` أو `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "يقرأ المستقبِل `rabbitmq` في المجمّع عمق كل قائمة انتظار ومستهلكيها ومعدلات رسائلها من واجهة HTTP لمكوّن الإدارة الإضافي، بصفته مستخدمًا موسومًا بـ `monitoring` وله وصول إلى كل مضيف افتراضي.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "فعّل مكوّن الإدارة الإضافي وأنشئ ذلك المستخدم. الوسم `monitoring` وحده لا يُظهر له أي قائمة انتظار: امنحه الوصول إلى كل مضيف افتراضي تريد مراقبته. والأنماط الفارغة تمنح هذا الوصول دون أي حق في الإعداد أو النشر أو الاستهلاك:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "اضبط `RABBITMQ_USERNAME` و`RABBITMQ_PASSWORD` في بيئة المجمّع. يبلّغ المستقبِل عن كل قائمة انتظار باسمها في RabbitMQ، بينما تسمّي امتدادات معظم أدوات التجهيز الـ exchange الذي مرّت به الرسالة: والاثنان يلتقيان في الرسائل المرسلة عبر الـ exchange الافتراضي، لأن مفتاح التوجيه فيه هو اسم قائمة الانتظار.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | عمق قائمة الانتظار | المؤشر |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | المنشورة | عدّاد، يُرسم في الثانية |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | مُسلَّم | عدّاد، يُرسم في الثانية |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | تم الإقرار | عدّاد، يُرسم في الثانية |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | المُسقَط | عدّاد، يُرسم في الثانية |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- يسمّي المقياس قائمة الانتظار باسم مختلف عن اسمها في الامتدادات. تسمّي امتدادات RabbitMQ عادةً الـ exchange، بينما تصف مقاييس الوسيط قوائم الانتظار. والاثنان يلتقيان في الرسائل المرسلة عبر الـ exchange الافتراضي، لأن مفتاح التوجيه فيه هو اسم قائمة الانتظار.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- لا يبلّغ RabbitMQ إلا عن قوائم الانتظار في المضيفين الافتراضيين الذين يملك مستخدمه وصولًا إليهم، ولا يسجّل أي خطأ للبقية. تظهر عدّادات RabbitMQ مع أول نشاط.",
};

export default TRANSLATION;
