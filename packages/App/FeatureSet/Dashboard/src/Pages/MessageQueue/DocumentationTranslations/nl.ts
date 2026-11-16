import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Spans noemen het systeem als `messaging.system` = `aws.sns` (ook geaccepteerd: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Wachtrijen komen uit de messaging-spans die uw OpenTelemetry-instrumentatie al produceert; er is niets OneUptime-specifieks nodig.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet de SNS-aanroepen van de AWS SDK zonder codewijzigingen.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: het pakket `OpenTelemetry.Instrumentation.AWS`, met `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; de standaard attributenset ervan noemt helemaal geen SNS-topic.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracet de AWS SDK.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: het pakket `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, toegevoegd met `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Elke andere client**: gebruik de eigen OpenTelemetry-ondersteuning van de clientbibliotheek, of zet `messaging.system` = `aws.sns`, `messaging.destination.name` en het span-type (PRODUCER bij publiceren, CONSUMER bij consumeren) op de spans rond uw verzendingen en handlers.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Richt daarna de OTLP-exporter op OneUptime. De meeste SDK's en agents lezen deze omgevingsvariabelen:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Dit token is geheim.** Gebruik een **Server**-innamesleutel, bewaard in de secrets van\n> uw deployment. Zet een Server-sleutel nooit in browser-JavaScript — daarvoor bestaat\n> een **Browser**-innamesleutel.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een inname-sleutel om `<YOUR_API_KEY>` in te vullen.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lees de CloudWatch-metrics van de topics met de `aws_cloudwatch`-receiver van de collector, of stream ze via een CloudWatch Metric Stream en Amazon Data Firehose naar zijn `awsfirehose`-receiver.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "De `aws_cloudwatch`-receiver bevraagt de `GetMetricData`-API van CloudWatch met de standaardreferenties van de AWS SDK (omgeving, gedeeld profiel of instantierol), die `cloudwatch:ListMetrics` en `cloudwatch:GetMetricData` nodig hebben:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Laat `stats` leeg.** Zonder die instelling komt elke metriek aan als één samenvatting per periode, en die leest OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` moet zijn ingesteld en begrenst de metrieken die per scrape worden gelezen.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` wacht tot CloudWatch een periode publiceert, dus met deze configuratie komen de brokermetrieken van een wachtrij 11 tot 17 minuten te laat aan: een monitor daarop heeft een langer venster nodig (zie **Late metrieken** onder [Waarschuwingen](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Eén receiver leest één regio en één namespace: voeg per regio een instantie toe.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Om de metrieken in plaats daarvan te streamen — een CloudWatch Metric Stream via Amazon Data Firehose naar de `awsfirehose`-receiver van de collector — zie [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Stuur een paar berichten door uw wachtrijen. Elke 10 minuten leest OneUptime de spans van de laatste 15 minuten en toont onder **Wachtrijen** elke bestemming die minstens 3 ervan noemen (spans van elk type behalve SERVER). Op een zelf gehoste OneUptime stelt `MESSAGE_QUEUE_MIN_SPANS` dat aantal in.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Eén datapunt van een brokermetriek die een wachtrijpagina in een grafiek toont, maakt ook haar wachtrij aan: metrieken uit cloudmonitoring komen te laat aan, dus elke run leest ze uit de laatste 60 minuten. Metrieken van messaging-clients, en uw eigen metrieken die `messaging.system` en `messaging.destination.name` dragen, maken nooit een wachtrij aan: ze verschijnen op het tabblad **Metrieken** van een bestaande.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Wachtrijen worden alleen vanzelf aangemaakt zolang het project onder zijn [budget voor automatisch aanmaken](/docs/telemetry/queues#the-auto-create-budget) blijft.",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Het Overzicht van de wachtrij toont deze in grafieken onder **Brokergezondheid**, en elke meter en elk aantal per periode heeft **Monitor maken**. Tot er een aankomt, vertelt de sectie waar ze vandaan komen.",
  "| Metric | Shown as | Type |": "| Metriek | Getoond als | Type |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-stream: `numberofmessagespublished`) | Gepubliceerde berichten | Aantal per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-stream: `numberofnotificationsdelivered`) | Afgeleverde meldingen | Aantal per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-stream: `numberofnotificationsfailed`) | Mislukte meldingen | Aantal per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-stream: `numberofnotificationsredriventodlq`) | Omgeleid naar de dead-letterwachtrij | Aantal per periode |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Haar spans noemen geen messaging-systeem dat OneUptime kan herkennen: de spans van Celery, de eigen telemetrie van BullMQ of een zelfgebouwde client. Voeg `messaging.system` en `messaging.destination.name` toe en geef de spans het type PRODUCER of CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Haar naam is er een die OneUptime negeert (zie [Wat wordt genegeerd](/docs/telemetry/queues#what-is-ignored)), of alleen SERVER-spans noemen haar.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Er kwamen minder dan 3 van haar spans aan in de laatste 15 minuten, of het project heeft zijn [budget voor automatisch aanmaken](/docs/telemetry/queues#the-auto-create-budget) bereikt.",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Als haar spans haar wel noemen, maak haar dan handmatig aan met hetzelfde systeem en dezelfde bestemming (**Wachtrijen → Wachtrij aanmaken**): haar tabblad **Traces** vult zich met de spans die al zijn opgeslagen.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Zie [Een wachtrij die mijn applicaties gebruiken, is niet aangemaakt](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) op de documentatiepagina over wachtrijen.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Bekijk het log van de collector. OneUptime weigert een verkeerde innamesleutel met `401` (`422` voor een uitgeschakelde sleutel of een Browser-sleutel), en de collector logt `Exporting failed` voor elke batch die hij laat vallen.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Ze zijn te laat. `aws_cloudwatch` wacht `delay` (10 minuten) tot CloudWatch publiceert, dus zijn punten komen 11 tot 17 minuten te laat aan.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Zie [De brokergezondheid blijft leeg](/docs/telemetry/queues#broker-health-stays-empty) op de documentatiepagina over wachtrijen.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Twee systemen noemen haar: een Kafka-client op het Kafka-endpoint van Event Hubs rapporteert `kafka`, de Event Hubs-SDK `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Een waarneming van Service Bus of Event Hubs heeft geen namespace: de emulator of een eigen domein.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ-spans noemen meestal de exchange, en de metrieken van de broker de wachtrij: twee wachtrijen in OneUptime, tenzij de exchange en de wachtrij dezelfde naam hebben.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Archiveer de wachtrij die je niet wilt: een gearchiveerde wachtrij blijft gearchiveerd, en wat haar noemt, maakt geen nieuwe meer aan.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Zie [Twee wachtrijen voor één bestemming](/docs/telemetry/queues#two-queues-for-one-destination) op de documentatiepagina over wachtrijen.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Een bestemming met een naam per aanvraag of per consumer die OneUptime niet herkent — een numeriek achtervoegsel, een hash — maakt een wachtrij per naam. UUID's worden al samengevoegd (zie [Wat wordt genegeerd](/docs/telemetry/queues#what-is-ignored)). Markeer zulke bestemmingen in uw instrumentatie met `messaging.destination.temporary=true`, of geef ze een stabiele naam, en archiveer daarna de al aangemaakte wachtrijen.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Zie [Een nieuwe wachtrij voor elke aanvraag](/docs/telemetry/queues#a-new-queue-for-every-request) op de documentatiepagina over wachtrijen.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet de SQS-aanroepen van de AWS SDK zonder codewijzigingen.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: het pakket `OpenTelemetry.Instrumentation.AWS`, met `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; de standaard attributenset ervan noemt een SQS-wachtrij alleen bij haar URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, of `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), toegevoegd met `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Zijn SQS-spans dragen de URL van de wachtrij in `server.address`, die OneUptime als de wachtrij leest.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lees de CloudWatch-metrics van de wachtrijen met de `aws_cloudwatch`-receiver van de collector, of stream ze via een CloudWatch Metric Stream en Amazon Data Firehose naar zijn `awsfirehose`-receiver.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-stream: `approximatenumberofmessagesvisible`) | Zichtbare berichten | Meter |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-stream: `approximateageofoldestmessage`) | Leeftijd van het oudste bericht | Meter |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-stream: `approximatenumberofmessagesnotvisible`) | Berichten onderweg | Meter |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-stream: `numberofmessagessent`) | Verzonden berichten | Aantal per periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-stream: `numberofmessagesreceived`) | Ontvangen berichten | Aantal per periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-stream: `numberofmessagesdeleted`) | Verwijderde berichten | Aantal per periode |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Spans noemen het systeem als `messaging.system` = `activemq` (ook geaccepteerd: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: de OpenTelemetry Java-agent tracet JMS-clients — ActiveMQ, Artemis, IBM MQ en elke andere JMS-broker — zonder codewijzigingen. JMS-spans zeggen `jms`, welke broker er ook achter zit; een ActiveMQ-wachtrij hoort bij die JMS-familie, zodat de spans van haar clients en de metrieken van haar broker op één wachtrij belanden.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "De collector heeft geen JMX-receiver, dus draai de OpenTelemetry JMX Scraper met `OTEL_JMX_TARGET_SYSTEM=activemq` naast een ActiveMQ Classic-broker; hij pusht de bestemmingsmetrics van de broker via OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Laat de broker JMX-verbindingen accepteren. Stel bij de image `apache/activemq-classic` of het script `bin/activemq` vóór het starten `ACTIVEMQ_SUNJMX_START` in. Dit voorbeeld zet authenticatie uit: houd de poort in een privénetwerk, of zet `jmxremote.authenticate` aan met een wachtwoordbestand en geef de scraper `OTEL_JMX_USERNAME` en `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Draai de scraper waar hij die poort kan bereiken, met een Java-runtime. Hij verstuurt rechtstreeks naar OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` behoudt de metrieknamen die de scraper sinds 1.53.0-alpha gebruikt (`activemq.message.queue.size`, met de bestemming in `messaging.destination.name`); OneUptime leest ook de oudere namen (`activemq.message.current`, met de bestemming in `destination`). ActiveMQ Artemis heeft andere MBeans, die deze regels niet lezen.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Eén datapunt van een brokermetriek die een wachtrijpagina in een grafiek toont, maakt ook haar wachtrij aan. Metrieken van messaging-clients, en uw eigen metrieken die `messaging.system` en `messaging.destination.name` dragen, maken nooit een wachtrij aan: ze verschijnen op het tabblad **Metrieken** van een bestaande.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Wachtrijgrootte | Meter |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Wachtrijgrootte (oude namen) | Meter |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | In wachtrij geplaatst | Teller, per seconde in de grafiek |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Uit wachtrij gehaald | Teller, per seconde in de grafiek |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Verlopen | Teller, per seconde in de grafiek |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consumenten | Meter |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Gemiddelde tijd in wachtrij | Meter |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Gemiddelde tijd in wachtrij (oude namen) | Meter |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- De metriek noemt de wachtrij anders dan de spans (zie [Beperkingen](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Spans noemen het systeem als `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet Kafka-producers en -consumers zonder codewijzigingen.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` met het pakket `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracet `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` of `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: de automatische instrumentatie van OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, op Linux) tracet producers en consumers van `segmentio/kafka-go` zonder codewijzigingen.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "De `kafka_metrics`-receiver van de collector leest de lag van consumergroepen en de offsets van partities bij de brokers; schakel zijn scrapers `topics` en `consumers` in.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Haal voor een cluster met SASL of TLS het commentaar weg bij `auth` en `tls`. De receiver noemt elk topic in `topic`, en zo vinden de metrieken de wachtrij van het topic. Hij rapporteert de lag en gecommitte offsets van een consumergroep alleen voor topics waarop de groep een offset heeft gecommit, en slaat topics over waarvan de naam met `_` begint.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Consumentenachterstand | Meter |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Partitieachterstand | Meter |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Geconsumeerd | Teller, per seconde in de grafiek |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Geproduceerd | Teller, per seconde in de grafiek |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka rapporteert de lag van een consumergroep pas nadat de groep een offset heeft gecommit. De receiver slaat topics over waarvan de naam met `_` begint.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Spans noemen het systeem als `messaging.system` = `pulsar` (ook geaccepteerd: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet Pulsar-clients zonder codewijzigingen.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Elke broker biedt zijn topic- en abonnementsmetrics aan op de poort van zijn webservice; scrape elke broker, want een broker rapporteert alleen de topics die hij op dat moment bezit.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar labelt elke reeks met de volledige naam van het topic (`persistent://public/default/orders`), en die van een partitie met die van de partitie: partities tellen op tot hun topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Achterstand | Meter |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Achterstand van het abonnement | Meter |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Leeftijd van de achterstand | Meter |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Berichten in | Teller, per seconde in de grafiek |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Berichten uit | Teller, per seconde in de grafiek |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet RocketMQ-clients zonder codewijzigingen.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Stel `metricsExporterType=PROM` in in de `broker.conf` van de broker, zodat de broker zijn lag- en doorvoermetrics aanbiedt.",
  "Then scrape every broker:": "Scrape daarna elke broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Gereedstaande berichten | Meter |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Naar de dead-letterwachtrij verzonden | Teller, per seconde in de grafiek |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid-wachtrijen verschijnen vanzelf in OneUptime, uit de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor heeft de aflever- en dead-lettermetrics van de topics, die de `azure_monitor`-receiver van de collector leest; ze worden nog niet op een wachtrijpagina getoond, dus verken ze onder Metrics.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "De receiver meldt zich aan via de extensie `azure_auth`: geef de service-principal de rol **Monitoring Reader** op het abonnement, en zet `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` en `AZURE_SUBSCRIPTION_ID` in de omgeving van de collector.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Metrieken van messaging-clients, en uw eigen metrieken die `messaging.system` en `messaging.destination.name` dragen, maken nooit een wachtrij aan: ze verschijnen op het tabblad **Metrieken** van een bestaande.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime toont voor Azure Event Grid geen brokermetrieken onder **Brokergezondheid**: wat de collector hierboven verstuurt, komt alleen in de **Metrieken**-verkenner aan. Een metriek die `messaging.system` en `messaging.destination.name` op elk datapunt draagt, verschijnt op het tabblad **Metrieken** van de wachtrij.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid heeft geen metrieken in grafieken. Zijn metrieken staan in de **Metrieken**-verkenner.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: de Azure SDK voor Java tracet zichzelf, en de OpenTelemetry Java-agent verbindt die tracing met OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: de OpenTelemetry-spans van de Azure SDK zijn experimenteel: zet `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (of de schakelaar `Azure.Experimental.EnableActivitySource`) en abonneer u op de Azure-bronnen met `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registreer `createAzureSdkInstrumentation()` uit `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: installeer `azure-core-tracing-opentelemetry` en zet `settings.tracing_implementation = "opentelemetry"` (uit `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Een gekoppeld Azure-abonnement leest de belangrijkste metrics van de namespace per event hub, zonder dat je iets hoeft te draaien. Draai om ze allemaal te lezen de `azure_monitor`-receiver van de collector, die ze per event hub opsplitst via de dimensie EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "De receiver somt uw namespaces één keer per dag op, dus het kan tot 24 uur duren voordat een nieuwe verschijnt.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Inkomende berichten | Aantal per periode |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Uitgaande berichten | Aantal per periode |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Serverfouten | Aantal per periode |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Gebruikersfouten | Aantal per periode |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Fouten door overschreden quotum | Aantal per periode |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Beperkte aanvragen | Aantal per periode |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Grootte | Meter |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- De metriek noemt de wachtrij anders dan de spans. Spans van Service Bus en Event Hubs zonder namespace-host staan op een andere wachtrij dan de metrieken van Azure Monitor (zie [Beperkingen](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor geeft 10 wachtrijen per metriek en namespace terug, tenzij `maximum_number_of_records_per_resource` wordt verhoogd. De configuratie in stap 3 verhoogt het.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- De receiver somt je namespaces één keer per dag op, dus een nieuwe namespace kan tot 24 uur nodig hebben om te verschijnen.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Een gekoppeld Azure-abonnement leest de belangrijkste metrics van de namespace per wachtrij en topic, zonder dat je iets hoeft te draaien. Draai om ze allemaal te lezen de `azure_monitor`-receiver van de collector, die ze per wachtrij en topic opsplitst via de dimensie EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Actieve berichten | Meter |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Berichten in dead-letter | Meter |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Geplande berichten | Meter |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Voltooide berichten | Aantal per periode |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Verlaten berichten | Aantal per periode |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Verzendlatentie van de server | Meter |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ-wachtrijen verschijnen vanzelf in OneUptime, uit de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "De eigen telemetrie van BullMQ (zijn optie `telemetry`, die het pakket `bullmq-otel` implementeert) noemt de wachtrij in `bullmq.queue.name` en zet geen `messaging.system`, dus op zichzelf maakt ze geen wachtrij aan. Een `transform`-processor in de collector waarnaar je applicaties versturen, voegt de twee sleutels toe die OneUptime leest, op de spans die jobs toevoegen en verwerken en op de eigen metrics van BullMQ:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Alleen de PRODUCER-spans die jobs toevoegen en de CONSUMER-spans die ze verwerken worden gelabeld: de interne spans van BullMQ noemen de wachtrij ook, maar zijn geen berichten. Richt de OTLP-exporter van uw applicaties op deze collector.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ bewaart zijn jobs in Redis en heeft geen broker om te scrapen; rapporteer de wachtrijdiepte vanuit de applicatie als metric met `messaging.system` en `messaging.destination.name`, zoals de eigen workers van OneUptime doen met `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Meet de jobaantallen in de applicatie; een meter die de twee sleutels zelf draagt, heeft geen transformatie nodig:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime toont voor BullMQ geen brokermetrieken onder **Brokergezondheid**. Alles wat een collector verstuurt, staat in de **Metrieken**-verkenner, en een metriek die `messaging.system` en `messaging.destination.name` op elk datapunt draagt, verschijnt op het tabblad **Metrieken** van de wachtrij.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Haar spans noemen geen messaging-systeem dat OneUptime kan herkennen: de spans van Celery, de eigen telemetrie van BullMQ of een zelfgebouwde client. Voeg `messaging.system` en `messaging.destination.name` toe en geef de spans het type PRODUCER of CONSUMER. Voor BullMQ doet de transformatie in stap 2 dat.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ heeft geen metrieken in grafieken. Zijn metrieken staan in de **Metrieken**-verkenner.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: de client tracet zichzelf zodra zijn builders `Publisher` en `Subscriber` een OpenTelemetry-instantie en de tracing-schakelaar krijgen — `setOpenTelemetry(GlobalOpenTelemetry.get())` en `setEnableOpenTelemetryTracing(true)`. Elk van beide aanroepen alleen tracet niets.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: met `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` en `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: met `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Lees de metrics van de topics en abonnementen uit Cloud Monitoring met de `googlecloudmonitoring`-receiver van de collector, en vermeld elk metrictype onder `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "De receiver meldt zich aan met Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, of het serviceaccount waaronder de collector draait), die de rol **Monitoring Viewer** op het project nodig hebben. Zet `project_id` op uw project:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Een metriektype dat in `metrics_list` ontbreekt, wordt nooit gelezen. Subscription-metrieken horen bij de wachtrij van de subscription (`subscription_id`), topic-metrieken bij die van het topic (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Niet-afgeleverde berichten | Meter |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Leeftijd van het oudste onbevestigde bericht | Meter |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Berichten in dead-letter | Aantal per periode |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Bevestigde berichten | Aantal per periode |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Publicatieverzoeken | Aantal per periode |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- De metriek noemt de wachtrij anders dan de spans. Een Pub/Sub-topic heeft de topic-metrieken en zijn subscriptions de subscription-metrieken.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring leest alleen de typen in `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Ze zijn te laat. De metrieken van Pub/Sub komen minuten te laat aan.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS-wachtrijen verschijnen vanzelf in OneUptime, uit de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS is een API, en de spans ervan noemen de broker erachter niet; als de broker Apache ActiveMQ is, draai je de OpenTelemetry JMX Scraper ertegen en sluiten de metrics ervan aan bij dezelfde wachtrij, die dan als ActiveMQ-wachtrij wordt getoond, terwijl andere JMS-brokers zoals IBM MQ geen kant-en-klaar metricpad hebben.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Zijn metrieken komen op dezelfde wachtrij als de JMS-spans, die vanaf dan als Apache ActiveMQ-wachtrij wordt getoond.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime toont voor JMS geen brokermetrieken onder **Brokergezondheid**. Alles wat een collector verstuurt, staat in de **Metrieken**-verkenner, en een metriek die `messaging.system` en `messaging.destination.name` op elk datapunt draagt, verschijnt op het tabblad **Metrieken** van de wachtrij.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Zodra de metrieken van een Apache ActiveMQ-broker aankomen, wordt de wachtrij als Apache ActiveMQ-wachtrij getoond en toont ze die in grafieken onder **Brokergezondheid**: zie [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Andere JMS-brokers dan ActiveMQ hebben geen metrieken in grafieken. Hun metrieken staan in de **Metrieken**-verkenner. Zie voor een ActiveMQ-broker **Als de broker Apache ActiveMQ is** onder **Geavanceerd**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS-wachtrijen verschijnen vanzelf in OneUptime, uit de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet NATS-clients — zijn NATS-instrumentatie rapporteert `messaging.system` = `nats` — zonder codewijzigingen.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Draai prometheus-nats-exporter met `-jsz=all` tegen de monitoringpoort van de server. Zijn JetStream-metrics gelden per stream en consumer, niet per subject, dus horen ze niet bij wachtrijen op subjectniveau.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Zet de monitoringpoort van de server aan met `-m 8222` (of `http_port: 8222` in zijn configuratie), en draai daarna de exporter:",
  "And scrape it:": "En scrape hem:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime toont voor NATS geen brokermetrieken onder **Brokergezondheid**: wat de collector hierboven verstuurt, komt alleen in de **Metrieken**-verkenner aan. Een metriek die `messaging.system` en `messaging.destination.name` op elk datapunt draagt, verschijnt op het tabblad **Metrieken** van de wachtrij.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS heeft geen metrieken in grafieken. Zijn metrieken staan in de **Metrieken**-verkenner.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ-wachtrijen verschijnen vanzelf in OneUptime, uit twee bronnen: de messaging-spans van de applicaties die ernaar publiceren en eruit consumeren, en de eigen metrieken van de broker. U kunt er ook met de hand een toevoegen: **Wachtrijen → Wachtrij aanmaken**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: de OpenTelemetry Java-agent tracet RabbitMQ-clients zonder codewijzigingen.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 tracet zichzelf: abonneer u op `RabbitMQ.Client.*`. Ook MassTransit tracet zichzelf: abonneer u op `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` of `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "De `rabbitmq`-receiver van de collector leest de diepte, de consumers en de berichtsnelheden van elke wachtrij uit de HTTP-API van de beheerplugin, als gebruiker met de tag `monitoring` en toegang tot elke virtuele host.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Schakel de management-plugin in en maak die gebruiker aan. De tag `monitoring` alleen laat hem geen wachtrij zien: geef hem toegang tot elke virtuele host die u wilt monitoren. Lege patronen geven die toegang zonder enig recht om te configureren, te publiceren of te consumeren:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Zet `RABBITMQ_USERNAME` en `RABBITMQ_PASSWORD` in de omgeving van de collector. De receiver rapporteert elke wachtrij onder haar RabbitMQ-naam, terwijl de spans van de meeste instrumentaties de exchange noemen waar een bericht doorheen ging: de twee komen samen bij berichten die via de standaard-exchange worden verstuurd, waarvan de routing key de naam van de wachtrij is.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Wachtrijdiepte | Meter |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Gepubliceerd | Teller, per seconde in de grafiek |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Afgeleverd | Teller, per seconde in de grafiek |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Bevestigd | Teller, per seconde in de grafiek |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Verworpen | Teller, per seconde in de grafiek |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- De metriek noemt de wachtrij anders dan de spans. RabbitMQ-spans noemen meestal de exchange, terwijl de metrieken van de broker wachtrijen beschrijven. De twee komen samen bij berichten die via de standaard-exchange worden verstuurd, waarvan de routing key de naam van de wachtrij is.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ rapporteert alleen de wachtrijen van virtuele hosts waartoe zijn gebruiker toegang heeft, en logt geen fout voor de rest. De tellers van RabbitMQ verschijnen bij de eerste activiteit.",
};

export default TRANSLATION;
