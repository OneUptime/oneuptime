import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Spans navngiver systemet som `messaging.system` = `aws.sns` (accepteres også: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Køer kommer fra de messaging-spans, som din OpenTelemetry-instrumentering allerede producerer; der kræves intet særligt for OneUptime.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer AWS SDK'ets SNS-kald uden kodeændringer.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: pakken `OpenTelemetry.Instrumentation.AWS` med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; dens standardsæt af attributter navngiver slet ikke et SNS-topic.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracer AWS SDK'et.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: pakken `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, tilføjet med `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Enhver anden klient**: brug klientbibliotekets egen OpenTelemetry-understøttelse, eller sæt `messaging.system` = `aws.sns`, `messaging.destination.name` og span-typen (PRODUCER ved publicering, CONSUMER ved forbrug) på spansene omkring dine afsendelser og handlere.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Peg derefter OTLP-exporteren mod OneUptime. De fleste SDK'er og agenter læser disse miljøvariabler:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Dette token er en hemmelighed.** Brug en **Server**-ingestion-nøgle, der opbevares i din\n> udrulnings secrets. Læg aldrig en Server-nøgle i browser-JavaScript — til det findes der\n> en **Browser**-ingestion-nøgle.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en ingestion-nøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Læs topicsenes CloudWatch-metrikker med collectorens `aws_cloudwatch`-receiver, eller stream dem gennem en CloudWatch Metric Stream og Amazon Data Firehose til dens `awsfirehose`-receiver.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch`-receiveren forespørger CloudWatch' `GetMetricData`-API med AWS SDK'ets standardlegitimationsoplysninger (miljø, delt profil eller instansrolle), som skal have `cloudwatch:ListMetrics` og `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Lad `stats` være uangivet.** Uden den ankommer hver metrik som én opsummering pr. periode, og det er den, OneUptime læser.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` skal være angivet og begrænser de metrikker, der læses pr. scrape.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` venter på, at CloudWatch udgiver en periode, så med denne konfiguration ankommer en køs brokermetrikker 11 til 17 minutter for sent: en monitor over dem skal have et længere vindue (se **Forsinkede metrikker** under [Advarsler](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Én receiver læser én region og ét namespace: tilføj en instans pr. region.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "For i stedet at streame metrikkerne — en CloudWatch Metric Stream gennem Amazon Data Firehose til collectorens `awsfirehose`-receiver — se [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Send et par beskeder gennem dine køer. Hvert 10. minut læser OneUptime de seneste 15 minutters spans og lister under **Køer** hver destination, som mindst 3 af dem navngiver (spans af enhver type undtagen SERVER). På en selvhostet OneUptime angiver `MESSAGE_QUEUE_MIN_SPANS` det tal.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Ét datapunkt af en brokermetrik, som en køside viser i en graf, opretter også dens kø: metrikker fra cloudovervågning ankommer sent, så hver kørsel læser dem fra de seneste 60 minutter. Metrikker fra messaging-klienter og dine egne metrikker, der bærer `messaging.system` og `messaging.destination.name`, opretter aldrig en kø: de vises på fanen **Metrikker** for en kø, der findes.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Køer oprettes kun af sig selv, så længe projektet er under sit [budget for automatisk oprettelse](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Køens Oversigt viser dem i grafer under **Brokersundhed**, og hver måler og hvert antal pr. periode har **Opret monitor**. Indtil en ankommer, fortæller sektionen, hvor de kommer fra.",
  "| Metric | Shown as | Type |": "| Metrik | Vises som | Type |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-stream: `numberofmessagespublished`) | Udgivne beskeder | Antal pr. periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-stream: `numberofnotificationsdelivered`) | Leverede notifikationer | Antal pr. periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-stream: `numberofnotificationsfailed`) | Mislykkede notifikationer | Antal pr. periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-stream: `numberofnotificationsredriventodlq`) | Omdirigeret til dead-letter-kø | Antal pr. periode |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Dens spans navngiver intet messaging-system, som OneUptime kan genkende: Celerys spans, BullMQ's egen telemetri eller en hjemmelavet klient. Tilføj `messaging.system` og `messaging.destination.name`, og giv spansene typen PRODUCER eller CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Dens navn er et af dem, OneUptime ignorerer (se [Hvad der ignoreres](/docs/telemetry/queues#what-is-ignored)), eller kun SERVER-spans navngiver den.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Færre end 3 af dens spans ankom inden for de seneste 15 minutter, eller projektet har nået sit [budget for automatisk oprettelse](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Når dens spans faktisk nævner den, så opret den manuelt med samme system og destination (**Køer → Opret Kø**): dens fane **Spor** fyldes ud fra de spans, der allerede er gemt.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Se [En kø, som mine applikationer bruger, blev ikke oprettet](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) på dokumentationssiden om køer.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Tjek collectorens log. OneUptime afviser en forkert ingestion-nøgle med `401` (`422` for en deaktiveret nøgle eller en Browser-nøgle), og collectoren logger `Exporting failed` for hver batch, den smider væk.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- De er forsinkede. `aws_cloudwatch` venter `delay` (10 minutter) på, at CloudWatch udgiver, så dens punkter ankommer 11 til 17 minutter for sent.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Se [Brokersundheden forbliver tom](/docs/telemetry/queues#broker-health-stays-empty) på dokumentationssiden om køer.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- To systemer nævner den: en Kafka-klient på Event Hubs' Kafka-endpoint rapporterer `kafka`, Event Hubs-SDK'et `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- En observation fra Service Bus eller Event Hubs har intet namespace: emulatoren eller et brugerdefineret domæne.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ-spans navngiver som regel exchangen og brokerens metrikker køen: to køer i OneUptime, medmindre exchangen og køen har samme navn.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Arkiver den, du ikke vil have: en arkiveret kø forbliver arkiveret, og det, der nævner den, opretter ikke længere en ny.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Se [To køer for én destination](/docs/telemetry/queues#two-queues-for-one-destination) på dokumentationssiden om køer.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "En destination navngivet pr. anmodning eller pr. consumer, som OneUptime ikke genkender — et numerisk suffiks, en hash — giver én kø pr. navn. UUID'er foldes allerede sammen (se [Hvad der ignoreres](/docs/telemetry/queues#what-is-ignored)). Markér sådanne destinationer med `messaging.destination.temporary=true` i din instrumentering, eller giv dem et stabilt navn, og arkivér derefter de køer, der allerede er oprettet.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Se [En ny kø for hver anmodning](/docs/telemetry/queues#a-new-queue-for-every-request) på dokumentationssiden om køer.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer AWS SDK'ets SQS-kald uden kodeændringer.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: pakken `OpenTelemetry.Instrumentation.AWS` med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; dens standardsæt af attributter navngiver kun en SQS-kø ved dens URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` eller `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), tilføjet med `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Dens SQS-spans bærer køens URL i `server.address`, som OneUptime læser som køen.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Læs køernes CloudWatch-metrikker med collectorens `aws_cloudwatch`-receiver, eller stream dem gennem en CloudWatch Metric Stream og Amazon Data Firehose til dens `awsfirehose`-receiver.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-stream: `approximatenumberofmessagesvisible`) | Synlige beskeder | Måler |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-stream: `approximateageofoldestmessage`) | Alder på ældste besked | Måler |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-stream: `approximatenumberofmessagesnotvisible`) | Beskeder undervejs | Måler |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-stream: `numberofmessagessent`) | Sendte beskeder | Antal pr. periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-stream: `numberofmessagesreceived`) | Modtagne beskeder | Antal pr. periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-stream: `numberofmessagesdeleted`) | Slettede beskeder | Antal pr. periode |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Spans navngiver systemet som `messaging.system` = `activemq` (accepteres også: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java-agenten tracer JMS-klienter — ActiveMQ, Artemis, IBM MQ og alle andre JMS-brokere — uden kodeændringer. JMS-spans siger `jms`, uanset hvilken broker der står bag dem; en ActiveMQ-kø hører til den JMS-familie, så dens klienters spans og dens brokers metrikker lander på én kø.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collectoren har ingen JMX-receiver, så kør OpenTelemetry JMX Scraper med `OTEL_JMX_TARGET_SYSTEM=activemq` ved siden af en ActiveMQ Classic-broker; den sender brokerens destinationsmetrikker via OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Lad brokeren tage imod JMX-forbindelser. Med imaget `apache/activemq-classic` eller scriptet `bin/activemq` skal du sætte `ACTIVEMQ_SUNJMX_START`, før du starter den. Dette eksempel slår godkendelse fra: hold porten på et privat netværk, eller slå `jmxremote.authenticate` til med en adgangskodefil, og giv scraperen `OTEL_JMX_USERNAME` og `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Kør scraperen, hvor den kan nå den port, med et Java-runtime. Den sender direkte til OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` beholder de metriknavne, scraperen har brugt siden 1.53.0-alpha (`activemq.message.queue.size`, med destinationen i `messaging.destination.name`); OneUptime læser også de ældre navne (`activemq.message.current`, med destinationen i `destination`). ActiveMQ Artemis har andre MBeans, som disse regler ikke læser.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Ét datapunkt af en brokermetrik, som en køside viser i en graf, opretter også dens kø. Metrikker fra messaging-klienter og dine egne metrikker, der bærer `messaging.system` og `messaging.destination.name`, opretter aldrig en kø: de vises på fanen **Metrikker** for en kø, der findes.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Køstørrelse | Måler |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Køstørrelse (gamle navne) | Måler |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Sat i kø | Tæller, vist pr. sekund |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Taget ud af kø | Tæller, vist pr. sekund |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Udløbet | Tæller, vist pr. sekund |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Forbrugere | Måler |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Gennemsnitlig tid i kø | Måler |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Gennemsnitlig tid i kø (gamle navne) | Måler |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Metrikken navngiver køen anderledes end spansene (se [Begrænsninger](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Spans navngiver systemet som `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer Kafka-producere og -consumere uden kodeændringer.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` med pakken `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracer `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` eller `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Go's automatiske instrumentering (`go.opentelemetry.io/auto`, eBPF, på Linux) tracer producere og consumere i `segmentio/kafka-go` uden kodeændringer.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collectorens `kafka_metrics`-receiver læser consumergruppers lag og partitioners offsets fra brokerne; aktivér dens scrapers `topics` og `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "For en klynge med SASL eller TLS skal du fjerne udkommenteringen af `auth` og `tls`. Receiveren navngiver hvert topic i `topic`, og sådan finder metrikkerne topicets kø. Den rapporterer en consumer-gruppes lag og committede offsets kun for topics, som gruppen har committet et offset til, og springer topics over, hvis navne begynder med `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Forbrugerforsinkelse | Måler |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Partitionsforsinkelse | Måler |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Forbrugt | Tæller, vist pr. sekund |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Produceret | Tæller, vist pr. sekund |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka rapporterer først en consumer-gruppes lag, når gruppen har committet et offset. Receiveren springer topics over, hvis navne begynder med `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Spans navngiver systemet som `messaging.system` = `pulsar` (accepteres også: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer Pulsar-klienter uden kodeændringer.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Hver broker udstiller sine topic- og abonnementsmetrikker på sin webservices port; scrape hver broker, for en broker rapporterer kun de topics, den ejer i øjeblikket.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar mærker hver serie med topicets fulde navn (`persistent://public/default/orders`) og en partitions serier med partitionens: partitioner lægges sammen i deres topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Efterslæb | Måler |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Abonnementets efterslæb | Måler |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Efterslæbets alder | Måler |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Beskeder ind | Tæller, vist pr. sekund |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Beskeder ud | Tæller, vist pr. sekund |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer RocketMQ-klienter uden kodeændringer.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Sæt `metricsExporterType=PROM` i brokerens `broker.conf`, så brokeren udstiller sine lag- og gennemløbsmetrikker.",
  "Then scrape every broker:": "Scrape derefter hver broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Klar-beskeder | Måler |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Sendt til dead-letter-kø | Tæller, vist pr. sekund |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid-køer dukker op i OneUptime af sig selv, fra messaging-spans fra de applikationer, der publicerer til og forbruger fra dem. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor har topicsenes leverings- og dead-letter-metrikker, som collectorens `azure_monitor`-receiver læser; de vises endnu ikke på en køside, så udforsk dem under Metrikker.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Receiveren logger ind via udvidelsen `azure_auth`: giv tjenesteprincipalen rollen **Monitoring Reader** på abonnementet, og sæt `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` og `AZURE_SUBSCRIPTION_ID` i collectorens miljø.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Metrikker fra messaging-klienter og dine egne metrikker, der bærer `messaging.system` og `messaging.destination.name`, opretter aldrig en kø: de vises på fanen **Metrikker** for en kø, der findes.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermetrikker for Azure Event Grid under **Brokersundhed**: det, collectoren ovenfor sender, når kun frem til **Metrikker**-udforskeren. En metrik, der bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises på køens fane **Metrikker**.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid har ingen metrikker i grafer. Dets metrikker ligger i **Metrikker**-udforskeren.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK til Java tracer sig selv, og OpenTelemetry Java-agenten forbinder den tracing med OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: Azure SDK\'ets OpenTelemetry-spans er eksperimentelle: sæt `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (eller kontakten `Azure.Experimental.EnableActivitySource`), og abonnér på Azure-kilderne med `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registrér `createAzureSdkInstrumentation()` fra `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: installér `azure-core-tracing-opentelemetry`, og sæt `settings.tracing_implementation = "opentelemetry"` (fra `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Et forbundet Azure-abonnement læser namespacets vigtigste metrikker for hver event hub, uden at du skal køre noget. For at læse dem alle skal du køre collectorens `azure_monitor`-receiver, som deler dem op pr. event hub efter dimensionen EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Receiveren lister dine navneområder én gang om dagen, så det kan tage op til 24 timer, før et nyt dukker op.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Indgående beskeder | Antal pr. periode |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Udgående beskeder | Antal pr. periode |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Serverfejl | Antal pr. periode |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Brugerfejl | Antal pr. periode |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Fejl ved overskredet kvote | Antal pr. periode |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Begrænsede anmodninger | Antal pr. periode |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Størrelse | Måler |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Metrikken navngiver køen anderledes end spansene. Service Bus- og Event Hubs-spans uden navneområdevært ligger på en anden kø end Azure Monitors metrikker (se [Begrænsninger](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor returnerer 10 køer pr. metrik og navneområde, medmindre `maximum_number_of_records_per_resource` hæves. Konfigurationen i trin 3 hæver den.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Receiveren lister dine namespaces én gang om dagen, så et nyt namespace kan tage op til 24 timer om at dukke op.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Et forbundet Azure-abonnement læser namespacets vigtigste metrikker for hver kø og hvert topic, uden at du skal køre noget. For at læse dem alle skal du køre collectorens `azure_monitor`-receiver, som deler dem op pr. kø og topic efter dimensionen EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Aktive beskeder | Måler |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Beskeder i dead-letter | Måler |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Planlagte beskeder | Måler |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Fuldførte beskeder | Antal pr. periode |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Opgivne beskeder | Antal pr. periode |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Serverens afsendelseslatens | Måler |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ-køer dukker op i OneUptime af sig selv, fra messaging-spans fra de applikationer, der publicerer til og forbruger fra dem. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ's egen telemetri (dens indstilling `telemetry`, som pakken `bullmq-otel` implementerer) nævner køen i `bullmq.queue.name` og sætter intet `messaging.system`, så alene opretter den ingen kø. En `transform`-processor i den collector, som dine applikationer sender til, tilføjer de to nøgler, som OneUptime læser, på de spans, der tilføjer og behandler jobs, og på BullMQ's egne metrikker:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Kun PRODUCER-spans, der tilføjer jobs, og CONSUMER-spans, der behandler dem, mærkes: BullMQ's interne spans navngiver også køen, men er ikke beskeder. Peg dine applikationers OTLP-exporter mod denne collector.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ gemmer sine jobs i Redis og har ingen broker at scrape; rapportér kødybden fra applikationen som en metrik, der bærer `messaging.system` og `messaging.destination.name`, som OneUptimes egne workers gør med `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Mål antallet af jobs i applikationen; en måler, der selv bærer de to nøgler, behøver ingen transform:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermetrikker for BullMQ under **Brokersundhed**. Alt, hvad en collector sender, ligger i **Metrikker**-udforskeren, og en metrik, der bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises på køens fane **Metrikker**.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Dens spans navngiver intet messaging-system, som OneUptime kan genkende: Celerys spans, BullMQ's egen telemetri eller en hjemmelavet klient. Tilføj `messaging.system` og `messaging.destination.name`, og giv spansene typen PRODUCER eller CONSUMER. For BullMQ gør transformen i trin 2 det.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ har ingen metrikker i grafer. Dets metrikker ligger i **Metrikker**-udforskeren.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: klienten tracer sig selv, så snart dens builders `Publisher` og `Subscriber` får en OpenTelemetry-instans og tracing-kontakten — `setOpenTelemetry(GlobalOpenTelemetry.get())` og `setEnableOpenTelemetryTracing(true)`. Hvert af kaldene alene tracer intet.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: med `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` og `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: med `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Læs topicsenes og abonnementernes metrikker fra Cloud Monitoring med collectorens `googlecloudmonitoring`-receiver, og angiv hver metriktype under `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Receiveren logger ind med Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` eller den tjenestekonto, collectoren kører som), som skal have rollen **Monitoring Viewer** på projektet. Sæt `project_id` til dit projekt:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "En metriktype, der mangler i `metrics_list`, læses aldrig. Subscription-metrikker hører til subscriptionens kø (`subscription_id`), topic-metrikker til topicets (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Ikke-leverede beskeder | Måler |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Alder på ældste ubekræftede besked | Måler |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Beskeder i dead-letter | Antal pr. periode |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Bekræftede beskeder | Antal pr. periode |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Udgivelsesanmodninger | Antal pr. periode |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- Metrikken navngiver køen anderledes end spansene. Et Pub/Sub-topic har topic-metrikkerne og dets subscriptions subscription-metrikkerne.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring læser kun typerne i `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- De er forsinkede. Pub/Sub's metrikker ankommer minutter for sent.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS-køer dukker op i OneUptime af sig selv, fra messaging-spans fra de applikationer, der publicerer til og forbruger fra dem. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS er et API, og dets spans nævner ikke brokeren bag det; når brokeren er Apache ActiveMQ, skal du køre OpenTelemetry JMX Scraper mod den, så dens metrikker slutter sig til den samme kø, som så vises som en ActiveMQ-kø, mens andre JMS-brokere som IBM MQ ikke har en færdig vej for metrikker.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Dens metrikker havner på samme kø som JMS-spansene, som derefter vises som en Apache ActiveMQ-kø.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermetrikker for JMS under **Brokersundhed**. Alt, hvad en collector sender, ligger i **Metrikker**-udforskeren, og en metrik, der bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises på køens fane **Metrikker**.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Så snart en Apache ActiveMQ-brokers metrikker ankommer, vises køen som en Apache ActiveMQ-kø og viser dem i grafer under **Brokersundhed**: se [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Andre JMS-brokere end ActiveMQ har ingen metrikker i grafer. Deres metrikker ligger i **Metrikker**-udforskeren. For en ActiveMQ-broker, se **Hvis brokeren er Apache ActiveMQ** under **Avanceret**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS-køer dukker op i OneUptime af sig selv, fra messaging-spans fra de applikationer, der publicerer til og forbruger fra dem. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer NATS-klienter — dens NATS-instrumentering rapporterer `messaging.system` = `nats` — uden kodeændringer.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Kør prometheus-nats-exporter med `-jsz=all` mod serverens overvågningsport. Dens JetStream-metrikker gælder pr. stream og forbruger, ikke pr. subject, så de knyttes ikke til køer på subject-niveau.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Slå serverens overvågningsport til med `-m 8222` (eller `http_port: 8222` i dens konfiguration), og kør derefter exporteren:",
  "And scrape it:": "Og scrape den:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermetrikker for NATS under **Brokersundhed**: det, collectoren ovenfor sender, når kun frem til **Metrikker**-udforskeren. En metrik, der bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises på køens fane **Metrikker**.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS har ingen metrikker i grafer. Dets metrikker ligger i **Metrikker**-udforskeren.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ-køer dukker op i OneUptime af sig selv, fra to kilder: messaging-spans fra de applikationer, der publicerer til og forbruger fra dem, og brokerens egne metrikker. Du kan også tilføje en manuelt: **Køer → Opret Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer RabbitMQ-klienter uden kodeændringer.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 tracer sig selv: abonnér på `RabbitMQ.Client.*`. MassTransit tracer også sig selv: abonnér på `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` eller `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collectorens `rabbitmq`-receiver læser hver køs dybde, forbrugere og beskedrater fra management-pluginets HTTP-API som en bruger med tagget `monitoring` og adgang til hver virtuel vært.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Aktivér management-pluginet, og opret den bruger. Tagget `monitoring` alene viser den ingen kø: giv den adgang til hver virtuel vært, der skal overvåges. Tomme mønstre giver den adgang uden nogen ret til at konfigurere, publicere eller forbruge:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Sæt `RABBITMQ_USERNAME` og `RABBITMQ_PASSWORD` i collectorens miljø. Receiveren rapporterer hver kø under dens RabbitMQ-navn, mens de fleste instrumenteringers spans navngiver den exchange, en besked gik igennem: de to mødes for beskeder, der sendes gennem standard-exchangen, hvis routing key er køens navn.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Kødybde | Måler |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Udgivet | Tæller, vist pr. sekund |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Leveret | Tæller, vist pr. sekund |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Bekræftet | Tæller, vist pr. sekund |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Kasseret | Tæller, vist pr. sekund |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- Metrikken navngiver køen anderledes end spansene. RabbitMQ-spans navngiver som regel exchangen, mens brokerens metrikker beskriver køer. De to mødes for beskeder, der sendes gennem standard-exchangen, hvis routing key er køens navn.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ rapporterer kun køerne i de virtuelle værter, som dens bruger har adgang til, og logger ingen fejl for resten. RabbitMQ's tællere vises ved første aktivitet.",
};

export default TRANSLATION;
