import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "स्पैन सिस्टम को `messaging.system` = `aws.sns` के रूप में बताते हैं (ये भी स्वीकार्य हैं: `aws_sns`, `amazonsns`, `sns`)।",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "क्यू उन मैसेजिंग स्पैन से बनती हैं जो आपका OpenTelemetry इंस्ट्रुमेंटेशन पहले से बनाता है; OneUptime के लिए कुछ खास नहीं चाहिए।",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले AWS SDK की SNS कॉल को ट्रेस करता है।",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` पैकेज, `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` के साथ; इसका डिफ़ॉल्ट एट्रिब्यूट सेट किसी SNS टॉपिक का नाम नहीं लेता।",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` AWS SDK को ट्रेस करता है।",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` पैकेज।",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, जिसे `otelaws.AppendMiddlewares(&cfg.APIOptions)` से जोड़ा जाता है।",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **कोई भी दूसरा क्लाइंट**: क्लाइंट लाइब्रेरी का अपना OpenTelemetry सपोर्ट इस्तेमाल करें, या अपने भेजने वाले कोड और हैंडलर के आसपास के स्पैन पर `messaging.system` = `aws.sns`, `messaging.destination.name` और स्पैन का प्रकार (प्रकाशित करते समय PRODUCER, उपभोग करते समय CONSUMER) सेट करें।",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "फिर OTLP एक्सपोर्टर को OneUptime की ओर करें। ज़्यादातर SDK और एजेंट ये एनवायरनमेंट वेरिएबल पढ़ते हैं:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **यह टोकन एक सीक्रेट है।** **सर्वर** इंजेशन कुंजी इस्तेमाल करें, जो आपके\n> डिप्लॉयमेंट के सीक्रेट में रखी जाए। सर्वर कुंजी को कभी ब्राउज़र JavaScript में न रखें — उसके लिए\n> **ब्राउज़र** इंजेशन कुंजी होती है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "टॉपिक की CloudWatch मेट्रिक्स कलेक्टर के `aws_cloudwatch` रिसीवर से पढ़ें, या उन्हें CloudWatch Metric Stream और Amazon Data Firehose के ज़रिए उसके `awsfirehose` रिसीवर तक स्ट्रीम करें।",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch` रिसीवर AWS SDK के डिफ़ॉल्ट क्रेडेंशियल (एनवायरनमेंट, शेयर्ड प्रोफ़ाइल या इंस्टेंस रोल) से CloudWatch के `GetMetricData` API को पोल करता है, जिन्हें `cloudwatch:ListMetrics` और `cloudwatch:GetMetricData` चाहिए:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **`stats` सेट न करें।** इसके बिना हर मेट्रिक प्रति अवधि एक सारांश के रूप में आता है, और OneUptime वही पढ़ता है।",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` सेट होना ज़रूरी है, और यह हर स्क्रेप में पढ़े जाने वाले मेट्रिक्स की सीमा तय करता है।",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` CloudWatch के किसी अवधि को प्रकाशित करने तक रुकता है, इसलिए इस कॉन्फ़िगरेशन में किसी क्यू के ब्रोकर मेट्रिक्स 11 से 17 मिनट देर से आते हैं: उन पर बने मॉनिटर को लंबी विंडो चाहिए ([अलर्टिंग](/docs/telemetry/queues#alerting) के अंतर्गत **देर से आने वाली मेट्रिक्स** देखें)।",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- एक रिसीवर एक क्षेत्र और एक नेमस्पेस पढ़ता है: हर क्षेत्र के लिए एक इंस्टेंस जोड़ें।",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "इसके बजाय मेट्रिक्स स्ट्रीम करने के लिए — CloudWatch Metric Stream से Amazon Data Firehose होते हुए कलेक्टर के `awsfirehose` रिसीवर तक — [Amazon SQS](/docs/telemetry/queues#amazon-sqs) देखें।",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "अपनी क्यू से कुछ संदेश भेजें। हर 10 मिनट में OneUptime पिछले 15 मिनट के स्पैन पढ़ता है और **क्यू** के अंतर्गत हर वह डेस्टिनेशन सूचीबद्ध करता है जिसका नाम उनमें से कम से कम 3 लेते हैं (SERVER को छोड़कर किसी भी प्रकार के स्पैन)। सेल्फ़-होस्टेड OneUptime पर `MESSAGE_QUEUE_MIN_SPANS` यह संख्या तय करता है।",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "क्यू पेज जिस ब्रोकर मेट्रिक को चार्ट करता है, उसका एक डेटा पॉइंट भी उसकी क्यू बना देता है: क्लाउड मॉनिटरिंग मेट्रिक्स देर से आते हैं, इसलिए हर रन उन्हें पिछले 60 मिनट से पढ़ता है। मैसेजिंग क्लाइंट मेट्रिक्स, और `messaging.system` व `messaging.destination.name` रखने वाले आपके अपने मेट्रिक्स, कभी क्यू नहीं बनाते: ये पहले से मौजूद क्यू के **मेट्रिक्स** टैब पर दिखते हैं।",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "क्यू अपने आप तभी बनती हैं जब तक प्रोजेक्ट अपने [ऑटो-क्रिएट बजट](/docs/telemetry/queues#the-auto-create-budget) से नीचे है।",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "क्यू का अवलोकन इन्हें **ब्रोकर स्वास्थ्य** के अंतर्गत चार्ट करता है, और हर गेज और हर प्रति अवधि गिनती पर **मॉनिटर बनाएं** होता है। जब तक कोई नहीं आता, यह सेक्शन बताता है कि ये कहाँ से आते हैं।",
  "| Metric | Shown as | Type |": "| मेट्रिक | इस नाम से दिखता है | प्रकार |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON स्ट्रीम: `numberofmessagespublished`) | प्रकाशित संदेश | प्रति अवधि गिनती |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON स्ट्रीम: `numberofnotificationsdelivered`) | डिलीवर की गई सूचनाएँ | प्रति अवधि गिनती |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON स्ट्रीम: `numberofnotificationsfailed`) | विफल सूचनाएँ | प्रति अवधि गिनती |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON स्ट्रीम: `numberofnotificationsredriventodlq`) | डेड-लेटर क्यू में भेजे गए | प्रति अवधि गिनती |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- इसके स्पैन कोई ऐसा मैसेजिंग सिस्टम नहीं बताते जिसे OneUptime पहचान सके: Celery के स्पैन, BullMQ की अपनी टेलीमेट्री या खुद बनाया गया क्लाइंट। `messaging.system` और `messaging.destination.name` जोड़ें, और स्पैन को PRODUCER या CONSUMER प्रकार दें।",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- इसका नाम उनमें से है जिन्हें OneUptime अनदेखा करता है ([क्या अनदेखा किया जाता है](/docs/telemetry/queues#what-is-ignored) देखें), या केवल SERVER स्पैन इसका नाम लेते हैं।",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- पिछले 15 मिनट में इसके 3 से कम स्पैन आए, या प्रोजेक्ट अपने [ऑटो-क्रिएट बजट](/docs/telemetry/queues#the-auto-create-budget) तक पहुँच गया।",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "जब उसके स्पैन उसका नाम देते हैं, तो उसे उसी सिस्टम और डेस्टिनेशन के साथ हाथ से बनाएँ (**क्यू → क्यू बनाएँ**): उसका **ट्रेस** टैब पहले से सहेजे गए स्पैन से भर जाता है।",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "क्यू के दस्तावेज़ पेज पर [मेरे एप्लिकेशन जिस क्यू का इस्तेमाल करते हैं, वह नहीं बनी](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) देखें।",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- कलेक्टर का लॉग जाँचें। OneUptime गलत इंजेशन कुंजी को `401` के साथ अस्वीकार करता है (बंद की गई कुंजी या ब्राउज़र कुंजी के लिए `422`), और कलेक्टर हर छोड़े गए बैच के लिए `Exporting failed` लॉग करता है।",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- डेटा देर से आ रहा है। `aws_cloudwatch` CloudWatch के प्रकाशित करने के लिए `delay` (10 मिनट) रुकता है, इसलिए इसके पॉइंट 11 से 17 मिनट देर से आते हैं।",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "क्यू के दस्तावेज़ पेज पर [ब्रोकर स्वास्थ्य खाली रहता है](/docs/telemetry/queues#broker-health-stays-empty) देखें।",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- दो सिस्टम उसका नाम देते हैं: Event Hubs के Kafka एंडपॉइंट पर Kafka क्लाइंट `kafka` रिपोर्ट करता है, Event Hubs SDK `eventhubs`।",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Service Bus या Event Hubs के किसी एक बार दिखने में कोई नेमस्पेस नहीं है: एम्युलेटर या कोई कस्टम डोमेन।",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ स्पैन आमतौर पर exchange का नाम लेते हैं, और ब्रोकर के मेट्रिक्स क्यू का: जब तक exchange और क्यू का नाम एक न हो, OneUptime में दो क्यू बनती हैं।",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "जो आपको नहीं चाहिए उसे आर्काइव करें: आर्काइव की गई क्यू आर्काइव ही रहती है, और जो उसका नाम देता है वह अब नई क्यू नहीं बनाता।",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "क्यू के दस्तावेज़ पेज पर [एक डेस्टिनेशन के लिए दो क्यू](/docs/telemetry/queues#two-queues-for-one-destination) देखें।",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "हर अनुरोध या हर कंज़्यूमर के हिसाब से नामित डेस्टिनेशन जिसे OneUptime नहीं पहचानता — कोई संख्यात्मक प्रत्यय, कोई हैश — हर नाम के लिए एक क्यू बनाता है। UUID पहले से मिला दिए जाते हैं ([क्या अनदेखा किया जाता है](/docs/telemetry/queues#what-is-ignored) देखें)। ऐसे डेस्टिनेशन को अपने इंस्ट्रुमेंटेशन में `messaging.destination.temporary=true` से चिह्नित करें, या उन्हें एक स्थिर नाम दें, फिर पहले से बनी क्यू को आर्काइव करें।",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "क्यू के दस्तावेज़ पेज पर [हर अनुरोध के लिए एक नई क्यू](/docs/telemetry/queues#a-new-queue-for-every-request) देखें।",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले AWS SDK की SQS कॉल को ट्रेस करता है।",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` पैकेज, `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` के साथ; इसका डिफ़ॉल्ट एट्रिब्यूट सेट SQS क्यू को केवल उसके URL से बताता है।",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, या `opentelemetry-instrumentation-boto3sqs`।",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), जिसे `otelaws.AppendMiddlewares(&cfg.APIOptions)` से जोड़ा जाता है। इसके SQS स्पैन `server.address` में क्यू का URL रखते हैं, जिसे OneUptime क्यू के रूप में पढ़ता है।",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "क्यू की CloudWatch मेट्रिक्स कलेक्टर के `aws_cloudwatch` रिसीवर से पढ़ें, या उन्हें CloudWatch Metric Stream और Amazon Data Firehose के ज़रिए उसके `awsfirehose` रिसीवर तक स्ट्रीम करें।",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON स्ट्रीम: `approximatenumberofmessagesvisible`) | दिखाई देने वाले संदेश | गेज |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON स्ट्रीम: `approximateageofoldestmessage`) | सबसे पुराने संदेश की आयु | गेज |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON स्ट्रीम: `approximatenumberofmessagesnotvisible`) | प्रक्रिया में संदेश | गेज |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON स्ट्रीम: `numberofmessagessent`) | भेजे गए संदेश | प्रति अवधि गिनती |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON स्ट्रीम: `numberofmessagesreceived`) | प्राप्त संदेश | प्रति अवधि गिनती |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON स्ट्रीम: `numberofmessagesdeleted`) | हटाए गए संदेश | प्रति अवधि गिनती |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "स्पैन सिस्टम को `messaging.system` = `activemq` के रूप में बताते हैं (ये भी स्वीकार्य हैं: `artemis`, `activemq_artemis`)।",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले JMS क्लाइंट — ActiveMQ, Artemis, IBM MQ और हर दूसरे JMS ब्रोकर — को ट्रेस करता है। JMS स्पैन `jms` कहते हैं, चाहे उनके पीछे कोई भी ब्रोकर हो; ActiveMQ क्यू उसी JMS परिवार से पहचानी जाती है, इसलिए इसके क्लाइंट के स्पैन और इसके ब्रोकर के मेट्रिक्स एक ही क्यू पर आते हैं।",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "कलेक्टर में कोई JMX रिसीवर नहीं है, इसलिए ActiveMQ Classic ब्रोकर के बगल में `OTEL_JMX_TARGET_SYSTEM=activemq` के साथ OpenTelemetry JMX Scraper चलाएँ; यह ब्रोकर की डेस्टिनेशन मेट्रिक्स OTLP पर पुश करता है।",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. ब्रोकर को JMX कनेक्शन स्वीकार करने दें। `apache/activemq-classic` इमेज या `bin/activemq` स्क्रिप्ट के साथ, शुरू करने से पहले `ACTIVEMQ_SUNJMX_START` सेट करें। यह उदाहरण प्रमाणीकरण बंद कर देता है: पोर्ट को किसी निजी नेटवर्क पर रखें, या पासवर्ड फ़ाइल के साथ `jmxremote.authenticate` चालू करें और स्क्रेपर को `OTEL_JMX_USERNAME` और `OTEL_JMX_PASSWORD` दें।",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. स्क्रेपर को वहाँ चलाएँ जहाँ से वह उस पोर्ट तक पहुँच सके, Java रनटाइम के साथ। यह सीधे OneUptime को भेजता है:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` वे मेट्रिक नाम बनाए रखता है जो स्क्रेपर 1.53.0-alpha से इस्तेमाल कर रहा है (`activemq.message.queue.size`, डेस्टिनेशन `messaging.destination.name` में); OneUptime पुराने नाम भी पढ़ता है (`activemq.message.current`, डेस्टिनेशन `destination` में)। ActiveMQ Artemis के MBean अलग हैं, जिन्हें ये नियम नहीं पढ़ते।",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "क्यू पेज जिस ब्रोकर मेट्रिक को चार्ट करता है, उसका एक डेटा पॉइंट भी उसकी क्यू बना देता है। मैसेजिंग क्लाइंट मेट्रिक्स, और `messaging.system` व `messaging.destination.name` रखने वाले आपके अपने मेट्रिक्स, कभी क्यू नहीं बनाते: ये पहले से मौजूद क्यू के **मेट्रिक्स** टैब पर दिखते हैं।",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | क्यू आकार | गेज |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | क्यू आकार (पुराने नाम) | गेज |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | क्यू में डाले गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | क्यू से निकाले गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | समय-सीमा खत्म | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | कंज़्यूमर | गेज |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | क्यू में औसत समय | गेज |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | क्यू में औसत समय (पुराने नाम) | गेज |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- मेट्रिक क्यू को स्पैन से अलग नाम देता है ([सीमाएँ](/docs/telemetry/queues#limitations) देखें)।",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "Spans name the system as `messaging.system` = `kafka`.":
    "स्पैन सिस्टम को `messaging.system` = `kafka` के रूप में बताते हैं।",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले Kafka प्रोड्यूसर और कंज़्यूमर को ट्रेस करता है।",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka`, `OpenTelemetry.Instrumentation.ConfluentKafka` पैकेज के साथ।",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` `kafkajs` को ट्रेस करता है।",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` या `opentelemetry-instrumentation-aiokafka`।",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Go ऑटो-इंस्ट्रुमेंटेशन (`go.opentelemetry.io/auto`, eBPF, Linux पर) बिना कोड बदले `segmentio/kafka-go` के प्रोड्यूसर और कंज़्यूमर को ट्रेस करता है।",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "कलेक्टर का `kafka_metrics` रिसीवर ब्रोकर से कंज़्यूमर-ग्रुप लैग और पार्टिशन ऑफ़सेट पढ़ता है; इसके `topics` और `consumers` स्क्रेपर चालू करें।",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "SASL या TLS वाले क्लस्टर के लिए `auth` और `tls` को अनकमेंट करें। रिसीवर हर टॉपिक का नाम `topic` में देता है, और इसी से मेट्रिक्स टॉपिक की क्यू ढूँढते हैं। यह किसी कंज़्यूमर ग्रुप का लैग और कमिट किए गए ऑफ़सेट केवल उन टॉपिक पर रिपोर्ट करता है जिन पर ग्रुप ने ऑफ़सेट कमिट किया है, और उन टॉपिक को छोड़ देता है जिनके नाम `_` से शुरू होते हैं।",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | कंज़्यूमर लैग | गेज |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | पार्टिशन लैग | गेज |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | उपभोग किए गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | उत्पादित | काउंटर, प्रति सेकंड के चार्ट में |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka किसी कंज़्यूमर ग्रुप का लैग तभी रिपोर्ट करता है जब ग्रुप कोई ऑफ़सेट कमिट कर दे। रिसीवर उन टॉपिक को छोड़ देता है जिनके नाम `_` से शुरू होते हैं।",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "स्पैन सिस्टम को `messaging.system` = `pulsar` के रूप में बताते हैं (ये भी स्वीकार्य हैं: `apache_pulsar`)।",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले Pulsar क्लाइंट को ट्रेस करता है।",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "हर ब्रोकर अपने टॉपिक और सब्सक्रिप्शन की मेट्रिक्स अपने वेब सर्विस पोर्ट पर देता है; हर ब्रोकर को स्क्रेप करें, क्योंकि कोई ब्रोकर सिर्फ़ उन्हीं टॉपिक को रिपोर्ट करता है जो इस समय उसके पास हैं।",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar हर सीरीज़ पर टॉपिक का पूरा नाम (`persistent://public/default/orders`) लेबल करता है, और किसी पार्टीशन की सीरीज़ पर पार्टीशन का: पार्टीशन जुड़कर अपने टॉपिक में आते हैं।",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | बैकलॉग | गेज |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | सब्सक्रिप्शन बैकलॉग | गेज |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | बैकलॉग की आयु | गेज |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | आने वाले संदेश | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | जाने वाले संदेश | काउंटर, प्रति सेकंड के चार्ट में |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले RocketMQ क्लाइंट को ट्रेस करता है।",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "ब्रोकर की `broker.conf` में `metricsExporterType=PROM` सेट करें ताकि ब्रोकर अपनी लैग और थ्रूपुट मेट्रिक्स दे।",
  "Then scrape every broker:": "फिर हर ब्रोकर को स्क्रेप करें:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | तैयार संदेश | गेज |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | डेड-लेटर क्यू में भेजे गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid क्यू OneUptime में अपने आप दिखती हैं, उन एप्लिकेशन के मैसेजिंग स्पैन से जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor के पास टॉपिक की डिलीवरी और डेड-लेटर मेट्रिक्स हैं, जिन्हें कलेक्टर का `azure_monitor` रिसीवर पढ़ता है; अभी उनका चार्ट किसी क्यू के पेज पर नहीं बनता, इसलिए उन्हें मेट्रिक्स में देखें।",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "रिसीवर `azure_auth` एक्सटेंशन से साइन इन करता है: सर्विस प्रिंसिपल को सब्सक्रिप्शन पर **Monitoring Reader** रोल दें, और कलेक्टर के एनवायरनमेंट में `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` और `AZURE_SUBSCRIPTION_ID` सेट करें।",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "मैसेजिंग क्लाइंट मेट्रिक्स, और `messaging.system` व `messaging.destination.name` रखने वाले आपके अपने मेट्रिक्स, कभी क्यू नहीं बनाते: ये पहले से मौजूद क्यू के **मेट्रिक्स** टैब पर दिखते हैं।",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime **ब्रोकर स्वास्थ्य** के अंतर्गत Azure Event Grid के लिए कोई ब्रोकर मेट्रिक्स चार्ट नहीं करता: ऊपर वाला कलेक्टर जो भेजता है, वह केवल **मेट्रिक्स** एक्सप्लोरर में पहुँचता है। जो मेट्रिक हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` रखता है, वह क्यू के **मेट्रिक्स** टैब पर दिखता है।",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid के कोई चार्ट किए गए मेट्रिक्स नहीं हैं। इसके मेट्रिक्स **मेट्रिक्स** एक्सप्लोरर में हैं।",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Java के लिए Azure SDK खुद को ट्रेस करता है, और OpenTelemetry Java एजेंट उस ट्रेसिंग को OpenTelemetry से जोड़ता है।",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: Azure SDK के OpenTelemetry स्पैन प्रायोगिक हैं: `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (या `Azure.Experimental.EnableActivitySource` स्विच) सेट करें और `.AddSource("Azure.*")` से Azure स्रोतों को सब्सक्राइब करें।',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: `@azure/opentelemetry-instrumentation-azure-sdk` से `createAzureSdkInstrumentation()` रजिस्टर करें।",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: `azure-core-tracing-opentelemetry` इंस्टॉल करें और `settings.tracing_implementation = "opentelemetry"` (`azure.core.settings` से) सेट करें।',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "एक कनेक्ट किया गया Azure सब्सक्रिप्शन, बिना कुछ चलाए, हर इवेंट हब के लिए नेमस्पेस की मुख्य मेट्रिक्स पढ़ता है। सभी मेट्रिक्स पढ़ने के लिए कलेक्टर का `azure_monitor` रिसीवर चलाएँ, जो उन्हें EntityName डाइमेंशन के हिसाब से हर इवेंट हब में बाँटता है।",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "रिसीवर दिन में एक बार आपके नेमस्पेस की सूची लेता है, इसलिए नए नेमस्पेस को दिखने में 24 घंटे तक लग सकते हैं।",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | आने वाले संदेश | प्रति अवधि गिनती |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | जाने वाले संदेश | प्रति अवधि गिनती |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | सर्वर त्रुटियाँ | प्रति अवधि गिनती |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | उपयोगकर्ता त्रुटियाँ | प्रति अवधि गिनती |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | कोटा पार होने की त्रुटियाँ | प्रति अवधि गिनती |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | थ्रॉटल किए गए अनुरोध | प्रति अवधि गिनती |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | आकार | गेज |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- मेट्रिक क्यू को स्पैन से अलग नाम देता है। बिना नेमस्पेस होस्ट वाले Service Bus और Event Hubs स्पैन, Azure Monitor के मेट्रिक्स से अलग क्यू पर होते हैं ([सीमाएँ](/docs/telemetry/queues#limitations) देखें)।",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- जब तक `maximum_number_of_records_per_resource` बढ़ाया न जाए, Azure Monitor हर मेट्रिक और नेमस्पेस के लिए 10 क्यू लौटाता है। चरण 3 का कॉन्फ़िग इसे बढ़ाता है।",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- रिसीवर आपके नेमस्पेस दिन में एक बार सूचीबद्ध करता है, इसलिए नए नेमस्पेस को दिखने में 24 घंटे तक लग सकते हैं।",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "एक कनेक्ट किया गया Azure सब्सक्रिप्शन, बिना कुछ चलाए, हर क्यू और टॉपिक के लिए नेमस्पेस की मुख्य मेट्रिक्स पढ़ता है। सभी मेट्रिक्स पढ़ने के लिए कलेक्टर का `azure_monitor` रिसीवर चलाएँ, जो उन्हें EntityName डाइमेंशन के हिसाब से हर क्यू और टॉपिक में बाँटता है।",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | सक्रिय संदेश | गेज |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | डेड-लेटर संदेश | गेज |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | शेड्यूल किए गए संदेश | गेज |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | पूर्ण संदेश | प्रति अवधि गिनती |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | छोड़े गए संदेश | प्रति अवधि गिनती |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | सर्वर भेजने की विलंबता | गेज |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ क्यू OneUptime में अपने आप दिखती हैं, उन एप्लिकेशन के मैसेजिंग स्पैन से जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ की अपनी टेलीमेट्री — उसका `telemetry` विकल्प, जिसे `bullmq-otel` पैकेज लागू करता है — क्यू का नाम `bullmq.queue.name` में देती है और कोई `messaging.system` सेट नहीं करती, इसलिए अपने आप में वह कोई क्यू नहीं बनाती। जिस कलेक्टर को आपके एप्लिकेशन भेजते हैं, उसमें एक `transform` प्रोसेसर वे दो कुंजियाँ जोड़ता है जिन्हें OneUptime पढ़ता है, जॉब जोड़ने और प्रोसेस करने वाले स्पैन पर और BullMQ की अपनी मेट्रिक्स पर:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "केवल जॉब जोड़ने वाले PRODUCER स्पैन और उन्हें प्रोसेस करने वाले CONSUMER स्पैन टैग होते हैं: BullMQ के आंतरिक स्पैन भी क्यू का नाम लेते हैं, पर वे संदेश नहीं हैं। अपने एप्लिकेशन के OTLP एक्सपोर्टर को इस कलेक्टर की ओर करें।",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ अपने जॉब Redis में रखता है और उसके पास स्क्रेप करने के लिए कोई ब्रोकर नहीं है; क्यू की गहराई एप्लिकेशन से ऐसी मेट्रिक के रूप में रिपोर्ट करें जिसमें `messaging.system` और `messaging.destination.name` हों, जैसा OneUptime के अपने वर्कर `queue.size` के साथ करते हैं।",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "एप्लिकेशन में जॉब की गिनती देखें; जो गेज दोनों कुंजियाँ खुद रखता है, उसे ट्रांसफ़ॉर्म की ज़रूरत नहीं:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime **ब्रोकर स्वास्थ्य** के अंतर्गत BullMQ के लिए कोई ब्रोकर मेट्रिक्स चार्ट नहीं करता। कलेक्टर जो कुछ भी भेजता है, वह **मेट्रिक्स** एक्सप्लोरर में है, और जो मेट्रिक हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` रखता है, वह क्यू के **मेट्रिक्स** टैब पर दिखता है।",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- इसके स्पैन कोई ऐसा मैसेजिंग सिस्टम नहीं बताते जिसे OneUptime पहचान सके: Celery के स्पैन, BullMQ की अपनी टेलीमेट्री या खुद बनाया गया क्लाइंट। `messaging.system` और `messaging.destination.name` जोड़ें, और स्पैन को PRODUCER या CONSUMER प्रकार दें। BullMQ के लिए, चरण 2 का ट्रांसफ़ॉर्म यह करता है।",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ के कोई चार्ट किए गए मेट्रिक्स नहीं हैं। इसके मेट्रिक्स **मेट्रिक्स** एक्सप्लोरर में हैं।",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: क्लाइंट खुद को तब ट्रेस करता है जब उसके `Publisher` और `Subscriber` बिल्डर को OpenTelemetry इंस्टेंस और ट्रेसिंग स्विच मिलें — `setOpenTelemetry(GlobalOpenTelemetry.get())` और `setEnableOpenTelemetryTracing(true)`। इनमें से कोई एक कॉल अकेले कुछ ट्रेस नहीं करती।",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })` के साथ।",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` और `SubscriberOptions(enable_open_telemetry_tracing=True)`।",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}` के साथ।",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "टॉपिक और सब्सक्रिप्शन की मेट्रिक्स Cloud Monitoring से कलेक्टर के `googlecloudmonitoring` रिसीवर के साथ पढ़ें, और हर मेट्रिक प्रकार को `metrics_list` में सूचीबद्ध करें।",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "रिसीवर Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, या वह सर्विस अकाउंट जिससे कलेक्टर चलता है) से साइन इन करता है, जिन्हें प्रोजेक्ट पर **Monitoring Viewer** रोल चाहिए। `project_id` को अपने प्रोजेक्ट पर सेट करें:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "`metrics_list` में न होने वाला मेट्रिक प्रकार कभी नहीं पढ़ा जाता। सब्सक्रिप्शन मेट्रिक्स सब्सक्रिप्शन की क्यू (`subscription_id`) से जुड़ते हैं, टॉपिक मेट्रिक्स टॉपिक की क्यू (`topic_id`) से।",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | डिलीवर न किए गए संदेश | गेज |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | सबसे पुराने अस्वीकृत संदेश की आयु | गेज |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | डेड-लेटर संदेश | प्रति अवधि गिनती |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | स्वीकार किए गए संदेश | प्रति अवधि गिनती |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | प्रकाशन अनुरोध | प्रति अवधि गिनती |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- मेट्रिक क्यू को स्पैन से अलग नाम देता है। Pub/Sub टॉपिक के पास टॉपिक मेट्रिक्स होते हैं और उसके सब्सक्रिप्शन के पास सब्सक्रिप्शन मेट्रिक्स।",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring केवल `metrics_list` के प्रकार पढ़ता है।",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- डेटा देर से आ रहा है। Pub/Sub के मेट्रिक्स कुछ मिनट देर से आते हैं।",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS क्यू OneUptime में अपने आप दिखती हैं, उन एप्लिकेशन के मैसेजिंग स्पैन से जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS एक API है, और उसके स्पैन उसके पीछे के ब्रोकर का नाम नहीं देते; जब ब्रोकर Apache ActiveMQ हो, तो उस पर OpenTelemetry JMX Scraper चलाएँ और उसकी मेट्रिक्स उसी क्यू से जुड़ जाती हैं, जो तब ActiveMQ क्यू के रूप में दिखती है, जबकि IBM MQ जैसे दूसरे JMS ब्रोकर के लिए मेट्रिक्स का कोई तैयार रास्ता नहीं है।",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "इसके मेट्रिक्स JMS स्पैन वाली उसी क्यू में जुड़ते हैं, जो तब से Apache ActiveMQ क्यू के रूप में दिखती है।",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime **ब्रोकर स्वास्थ्य** के अंतर्गत JMS के लिए कोई ब्रोकर मेट्रिक्स चार्ट नहीं करता। कलेक्टर जो कुछ भी भेजता है, वह **मेट्रिक्स** एक्सप्लोरर में है, और जो मेट्रिक हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` रखता है, वह क्यू के **मेट्रिक्स** टैब पर दिखता है।",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "जैसे ही किसी Apache ActiveMQ ब्रोकर के मेट्रिक्स आते हैं, क्यू Apache ActiveMQ क्यू के रूप में दिखती है और उन्हें **ब्रोकर स्वास्थ्य** के अंतर्गत चार्ट करती है: [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq) देखें।",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ActiveMQ के अलावा दूसरे JMS ब्रोकर के कोई चार्ट किए गए मेट्रिक्स नहीं हैं। उनके मेट्रिक्स **मेट्रिक्स** एक्सप्लोरर में हैं। ActiveMQ ब्रोकर के लिए **उन्नत** के अंतर्गत **अगर ब्रोकर Apache ActiveMQ है** देखें।",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS क्यू OneUptime में अपने आप दिखती हैं, उन एप्लिकेशन के मैसेजिंग स्पैन से जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले NATS क्लाइंट को ट्रेस करता है — इसका NATS इंस्ट्रुमेंटेशन `messaging.system` = `nats` रिपोर्ट करता है।",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "सर्वर के मॉनिटरिंग पोर्ट पर `-jsz=all` के साथ prometheus-nats-exporter चलाएँ। इसकी JetStream मेट्रिक्स हर स्ट्रीम और कंज़्यूमर की होती हैं, हर सब्जेक्ट की नहीं, इसलिए वे सब्जेक्ट-स्तर की क्यू से नहीं जुड़तीं।",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "सर्वर का मॉनिटरिंग पोर्ट `-m 8222` से (या उसके कॉन्फ़िगरेशन में `http_port: 8222` से) चालू करें, फिर एक्सपोर्टर चलाएँ:",
  "And scrape it:": "और उसे स्क्रेप करें:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime **ब्रोकर स्वास्थ्य** के अंतर्गत NATS के लिए कोई ब्रोकर मेट्रिक्स चार्ट नहीं करता: ऊपर वाला कलेक्टर जो भेजता है, वह केवल **मेट्रिक्स** एक्सप्लोरर में पहुँचता है। जो मेट्रिक हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` रखता है, वह क्यू के **मेट्रिक्स** टैब पर दिखता है।",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS के कोई चार्ट किए गए मेट्रिक्स नहीं हैं। इसके मेट्रिक्स **मेट्रिक्स** एक्सप्लोरर में हैं।",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ क्यू OneUptime में अपने आप दिखती हैं, दो स्रोतों से: उन एप्लिकेशन के मैसेजिंग स्पैन जो उनमें प्रकाशित करते हैं और उनसे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स। आप हाथ से भी एक क्यू जोड़ सकते हैं: **क्यू → क्यू बनाएँ**।",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java एजेंट बिना कोड बदले RabbitMQ क्लाइंट को ट्रेस करता है।",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 खुद को ट्रेस करता है: `RabbitMQ.Client.*` को सब्सक्राइब करें। MassTransit भी खुद को ट्रेस करता है: `MassTransit` को सब्सक्राइब करें।",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` या `opentelemetry-instrumentation-aio-pika`।",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "कलेक्टर का `rabbitmq` रिसीवर हर क्यू की गहराई, कंज़्यूमर और संदेश दरें मैनेजमेंट प्लगइन के HTTP API से पढ़ता है, ऐसे उपयोगकर्ता के रूप में जिस पर `monitoring` टैग हो और जिसे हर वर्चुअल होस्ट तक पहुँच हो।",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "मैनेजमेंट प्लगइन चालू करें और वह यूज़र बनाएँ। केवल `monitoring` टैग से उसे कोई क्यू नहीं दिखती: उसे हर उस वर्चुअल होस्ट तक पहुँच दें जिसे मॉनिटर करना है। खाली पैटर्न यह पहुँच देते हैं, बिना कॉन्फ़िगर, प्रकाशित या उपभोग करने के किसी अधिकार के:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "कलेक्टर के एनवायरनमेंट में `RABBITMQ_USERNAME` और `RABBITMQ_PASSWORD` सेट करें। रिसीवर हर क्यू को उसके RabbitMQ नाम से रिपोर्ट करता है, जबकि ज़्यादातर इंस्ट्रुमेंटेशन के स्पैन उस exchange का नाम लेते हैं जिससे संदेश गुज़रा: दोनों डिफ़ॉल्ट exchange से भेजे गए संदेशों के लिए मेल खाते हैं, जिसकी routing key क्यू का नाम होती है।",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | क्यू गहराई | गेज |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | प्रकाशित | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | डिलीवर किए गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | स्वीकार किया गया | काउंटर, प्रति सेकंड के चार्ट में |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | छोड़े गए | काउंटर, प्रति सेकंड के चार्ट में |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- मेट्रिक क्यू को स्पैन से अलग नाम देता है। RabbitMQ स्पैन आमतौर पर exchange का नाम लेते हैं, जबकि ब्रोकर के मेट्रिक्स क्यू का वर्णन करते हैं। दोनों डिफ़ॉल्ट exchange से भेजे गए संदेशों के लिए मेल खाते हैं, जिसकी routing key क्यू का नाम होती है।",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ केवल उन वर्चुअल होस्ट की क्यू रिपोर्ट करता है जिन तक उसके यूज़र की पहुँच है, और बाकी के लिए कोई त्रुटि लॉग नहीं करता। RabbitMQ के काउंटर पहली गतिविधि के साथ दिखते हैं।",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Amazon SNS क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` CloudWatch के किसी अवधि को प्रकाशित करने तक रुकता है, इसलिए इस कॉन्फ़िगरेशन में इस क्यू के ब्रोकर मेट्रिक्स 11 से 17 मिनट देर से आते हैं: उन पर बने मॉनिटर को लंबी विंडो चाहिए ([अलर्टिंग](/docs/telemetry/queues#alerting) के अंतर्गत **देर से आने वाली मेट्रिक्स** देखें)।",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "`orders` से कुछ संदेश भेजें। इस क्यू का नाम लेने वाला हर स्पैन OneUptime के ग्रहण करते समय इस क्यू से टैग होता है: स्पैन **अवलोकन** भरते हैं — प्रकाशित और उपभोग किए गए संदेश, त्रुटियाँ और प्रोसेसिंग समय, और **प्रोड्यूसर** व **कंज़्यूमर** के अंतर्गत सेवाएँ — और **ट्रेस** टैब भी।",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "अवलोकन पर **ब्रोकर स्वास्थ्य** ब्रोकर के मेट्रिक्स आने के साथ भरता है: चरण 3 के कॉन्फ़िगरेशन में CloudWatch के मेट्रिक्स 11 से 17 मिनट देर से आते हैं।",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "जैसे ही डिस्कवरी इस क्यू का नाम लेने वाले स्पैन या ब्रोकर मेट्रिक्स पाती है, हेडर में **हाल में देखा गया** दिखता है। डिस्कवरी हर 10 मिनट में पिछले 15 मिनट की टेलीमेट्री पर चलती है, और क्लाउड मॉनिटरिंग मेट्रिक्स के लिए पिछले 60 मिनट पर, क्योंकि वे देर से आते हैं।",
  "Names are compared without regard to case.":
    "नामों की तुलना बड़े-छोटे अक्षरों का ध्यान रखे बिना होती है।",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **स्पैन**: `messaging.system` = `aws.sns` (या `aws_sns`, `amazonsns` या `sns`) और डेस्टिनेशन `orders` — `messaging.destination.name` में, या `messaging.destination` जैसी किसी पुरानी कुंजी में।",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **ब्रोकर मेट्रिक्स**: `Dimensions.TopicName` या `TopicName` = `orders`।",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Amazon SQS क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Apache ActiveMQ क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "अवलोकन पर **ब्रोकर स्वास्थ्य** ब्रोकर के मेट्रिक्स आने के साथ भरता है।",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "जैसे ही डिस्कवरी इस क्यू का नाम लेने वाले स्पैन या ब्रोकर मेट्रिक्स पाती है, हेडर में **हाल में देखा गया** दिखता है। डिस्कवरी हर 10 मिनट में पिछले 15 मिनट की टेलीमेट्री पर चलती है।",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- JMS क्लाइंट के स्पैन `jms` कहते हैं, चाहे उनके पीछे कोई भी ब्रोकर हो, इसलिए वे और Apache ActiveMQ ब्रोकर के मेट्रिक्स इसी एक क्यू पर आते हैं।",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "JMX होस्ट इस क्यू की टेलीमेट्री के रिपोर्ट किए ब्रोकर पते (`broker-1.example.com:9092`) से पहले से भरा है।",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Apache Kafka क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **स्पैन**: `messaging.system` = `kafka` और डेस्टिनेशन `orders` — `messaging.destination.name` में, या `messaging.destination` जैसी किसी पुरानी कुंजी में।",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **ब्रोकर मेट्रिक्स**: `topic` = `orders`।",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "SASL या TLS वाले क्लस्टर के लिए `auth` और `tls` को अनकमेंट करें। बूटस्ट्रैप ब्रोकर इस क्यू की टेलीमेट्री के रिपोर्ट किए ब्रोकर पते (`broker-1.example.com:9092`) से पहले से भरा है; अगर कलेक्टर ब्रोकर तक किसी और रास्ते से पहुँचता है तो इसे बदलें। रिसीवर हर टॉपिक का नाम `topic` में देता है, और इसी से मेट्रिक्स टॉपिक की क्यू ढूँढते हैं। यह किसी कंज़्यूमर ग्रुप का लैग और कमिट किए गए ऑफ़सेट केवल उन टॉपिक पर रिपोर्ट करता है जिन पर ग्रुप ने ऑफ़सेट कमिट किया है, और उन टॉपिक को छोड़ देता है जिनके नाम `_` से शुरू होते हैं।",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Apache Pulsar क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **स्पैन**: `messaging.system` = `pulsar` (या `apache_pulsar`) और डेस्टिनेशन `orders` — `messaging.destination.name` में, या `messaging.destination` जैसी किसी पुरानी कुंजी में।",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Apache RocketMQ क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "यह Azure Event Grid क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और उन मेट्रिक्स से जो इसका `messaging.system` और `messaging.destination.name` रखते हैं। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "जो मेट्रिक्स हर डेटा पॉइंट पर इसका `messaging.system` और `messaging.destination.name` रखते हैं, वे इसके **मेट्रिक्स** टैब पर दिखते हैं।",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "जैसे ही डिस्कवरी इस क्यू का नाम लेने वाले स्पैन या मैसेजिंग क्लाइंट मेट्रिक्स पाती है, हेडर में **हाल में देखा गया** दिखता है। डिस्कवरी हर 10 मिनट में पिछले 15 मिनट की टेलीमेट्री पर चलती है।",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Azure Event Hubs क्यू `orders` (नेमस्पेस `orders-ns`) है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **स्पैन**: `messaging.system` = `eventhubs` (या `azure_eventhubs`, `azure.eventhubs` या `microsoft.eventhub`) और डेस्टिनेशन `orders` — `messaging.destination.name` में, या `messaging.destination` जैसी किसी पुरानी कुंजी में, `orders-ns.servicebus.windows.net` से जुड़े SDK से।",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **ब्रोकर मेट्रिक्स**: `metadata_entityname` = `orders`, उस नेमस्पेस पर जिसका `name` `orders-ns` है।",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Azure Service Bus क्यू `orders` (नेमस्पेस `orders-ns`) है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "यह BullMQ क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और उन मेट्रिक्स से जो इसका `messaging.system` और `messaging.destination.name` रखते हैं। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह Google Cloud Pub/Sub क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "यह JMS क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और उन मेट्रिक्स से जो इसका `messaging.system` और `messaging.destination.name` रखते हैं। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "इसके मेट्रिक्स इस क्यू में जुड़ते हैं, जो तब से Apache ActiveMQ क्यू के रूप में दिखती है।",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "यह NATS क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और उन मेट्रिक्स से जो इसका `messaging.system` और `messaging.destination.name` रखते हैं। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "यह RabbitMQ क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और ब्रोकर के अपने मेट्रिक्स से। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "कलेक्टर के एनवायरनमेंट में `RABBITMQ_USERNAME` और `RABBITMQ_PASSWORD` सेट करें। मैनेजमेंट एंडपॉइंट का होस्ट इस क्यू की टेलीमेट्री के रिपोर्ट किए ब्रोकर पते (`broker-1.example.com:9092`) से पहले से भरा है; अगर कलेक्टर ब्रोकर तक किसी और रास्ते से पहुँचता है तो इसे बदलें। रिसीवर हर क्यू को उसके RabbitMQ नाम से रिपोर्ट करता है, जबकि ज़्यादातर इंस्ट्रुमेंटेशन के स्पैन उस exchange का नाम लेते हैं जिससे संदेश गुज़रा: दोनों डिफ़ॉल्ट exchange से भेजे गए संदेशों के लिए मेल खाते हैं, जिसकी routing key क्यू का नाम होती है।",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "यह `acme-bus` क्यू `orders` है। यह उन एप्लिकेशन के मैसेजिंग स्पैन से भरती है जो इसमें प्रकाशित करते हैं और इससे उपभोग करते हैं, और उन मेट्रिक्स से जो इसका `messaging.system` और `messaging.destination.name` रखते हैं। नीचे सब कुछ इस क्यू के लिए पहले से भरा है।",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime इस मैसेजिंग सिस्टम को नहीं जानता, इसलिए उसके पास ब्रोकर के मेट्रिक्स पढ़ने का कोई तैयार तरीका नहीं है; उन्हें हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` के साथ भेजें, तो वे क्यू से जुड़ जाते हैं।",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime **ब्रोकर स्वास्थ्य** के अंतर्गत `acme-bus` के लिए कोई ब्रोकर मेट्रिक्स चार्ट नहीं करता। कलेक्टर जो कुछ भी भेजता है, वह **मेट्रिक्स** एक्सप्लोरर में है, और जो मेट्रिक हर डेटा पॉइंट पर `messaging.system` और `messaging.destination.name` रखता है, वह क्यू के **मेट्रिक्स** टैब पर दिखता है।",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- केवल ब्रोकर के अपने मेट्रिक्स को ऐसा सिस्टम चाहिए जिसे OneUptime जानता हो ([समर्थित मैसेजिंग सिस्टम](/docs/telemetry/queues#supported-messaging-systems) देखें)। इसके मेट्रिक्स **मेट्रिक्स** एक्सप्लोरर में हैं।",
};

export default TRANSLATION;
