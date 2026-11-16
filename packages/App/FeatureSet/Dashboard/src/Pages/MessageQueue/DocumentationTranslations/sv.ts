import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Spans namnger systemet som `messaging.system` = `aws.sns` (godtas också: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Köer kommer från de messaging-spans som din OpenTelemetry-instrumentering redan producerar; inget särskilt för OneUptime behövs.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar AWS SDK:ns SNS-anrop utan kodändringar.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: paketet `OpenTelemetry.Instrumentation.AWS`, med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; dess standarduppsättning av attribut namnger inte något SNS-topic alls.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` spårar AWS SDK:n.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: paketet `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, tillagt med `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Vilken annan klient som helst**: använd klientbibliotekets egen OpenTelemetry-stöd, eller sätt `messaging.system` = `aws.sns`, `messaging.destination.name` och span-typen (PRODUCER vid publicering, CONSUMER vid konsumtion) på spansen kring dina utskick och hanterare.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Peka sedan OTLP-exportören mot OneUptime. De flesta SDK:er och agenter läser de här miljövariablerna:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Den här token är en hemlighet.** Använd en **Server**-intagningsnyckel som förvaras i din\n> driftsättnings secrets. Lägg aldrig en Server-nyckel i JavaScript i webbläsaren — för det finns\n> en **Webbläsare**-intagningsnyckel.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Läs topicens CloudWatch-mätvärden med collectorns `aws_cloudwatch`-receiver, eller strömma dem genom en CloudWatch Metric Stream och Amazon Data Firehose till dess `awsfirehose`-receiver.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch`-receivern frågar CloudWatchs `GetMetricData`-API med AWS SDK:ns standardautentiseringsuppgifter (miljö, delad profil eller instansroll), som behöver `cloudwatch:ListMetrics` och `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Lämna `stats` oangiven.** Utan den kommer varje mätvärde som en sammanfattning per period, och det är den som OneUptime läser.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` måste vara angiven och begränsar de mätvärden som läses per skrapning.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` väntar på att CloudWatch publicerar en period, så med den här konfigurationen kommer en kös brokermätvärden 11 till 17 minuter för sent: en monitor över dem behöver ett längre fönster (se **Fördröjda mätvärden** under [Larm](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- En receiver läser en region och ett namespace: lägg till en instans per region.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "För att i stället strömma mätvärdena — en CloudWatch Metric Stream via Amazon Data Firehose till collectorns `awsfirehose`-receiver — se [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Skicka några meddelanden genom dina köer. Var 10:e minut läser OneUptime de senaste 15 minuternas spans och listar under **Köer** varje destination som minst 3 av dem namnger (spans av alla typer utom SERVER). På en självhostad OneUptime anger `MESSAGE_QUEUE_MIN_SPANS` det antalet.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "En enda datapunkt av ett brokermätvärde som en kösida visar i diagram skapar också dess kö: mätvärden från molnövervakning kommer sent, så varje körning läser dem från de senaste 60 minuterna. Mätvärden från messaging-klienter, och dina egna mätvärden som bär `messaging.system` och `messaging.destination.name`, skapar aldrig en kö: de visas på fliken **Mätvärden** för en kö som finns.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Köer skapas bara av sig själva så länge projektet ligger under sin [budget för automatiskt skapande](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Köns Översikt visar dessa i diagram under **Brokerhälsa**, och varje mätare och varje antal per period har **Skapa monitor**. Tills något kommer berättar avsnittet var de kommer ifrån.",
  "| Metric | Shown as | Type |": "| Mätvärde | Visas som | Typ |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-ström: `numberofmessagespublished`) | Publicerade meddelanden | Antal per period |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-ström: `numberofnotificationsdelivered`) | Levererade aviseringar | Antal per period |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-ström: `numberofnotificationsfailed`) | Misslyckade aviseringar | Antal per period |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-ström: `numberofnotificationsredriventodlq`) | Omdirigerade till dead-letter-kö | Antal per period |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Dess spans namnger inget messaging-system som OneUptime kan känna igen: Celerys spans, BullMQ:s egen telemetri eller en egenbyggd klient. Lägg till `messaging.system` och `messaging.destination.name`, och ge spansen typen PRODUCER eller CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Dess namn är ett av dem som OneUptime ignorerar (se [Vad som ignoreras](/docs/telemetry/queues#what-is-ignored)), eller så namnger bara SERVER-spans den.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Färre än 3 av dess spans kom under de senaste 15 minuterna, eller så har projektet nått sin [budget för automatiskt skapande](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "När dess span faktiskt namnger den skapar du den manuellt med samma system och destination (**Köer → Skapa Kö**): dess flik **Spår** fylls i från de span som redan har lagrats.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Se [En kö som mina applikationer använder skapades inte](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) på dokumentationssidan om köer.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Kontrollera collectorns logg. OneUptime avvisar en felaktig intagningsnyckel med `401` (`422` för en inaktiverad nyckel eller en Webbläsare-nyckel), och collectorn loggar `Exporting failed` för varje batch som den kastar.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- De är fördröjda. `aws_cloudwatch` väntar `delay` (10 minuter) på att CloudWatch publicerar, så dess punkter kommer 11 till 17 minuter för sent.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Se [Brokerhälsan förblir tom](/docs/telemetry/queues#broker-health-stays-empty) på dokumentationssidan om köer.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Två system namnger den: en Kafka-klient på Event Hubs Kafka-slutpunkt rapporterar `kafka`, Event Hubs-SDK:t `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- En observation från Service Bus eller Event Hubs har inget namespace: emulatorn eller en anpassad domän.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ-spans namnger oftast exchangen, och brokerns mätvärden kön: två köer i OneUptime, om inte exchangen och kön har samma namn.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Arkivera den du inte vill ha: en arkiverad kö förblir arkiverad, och det som namnger den skapar inte längre en ny.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Se [Två köer för en destination](/docs/telemetry/queues#two-queues-for-one-destination) på dokumentationssidan om köer.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "En destination som namnges per förfrågan eller per consumer och som OneUptime inte känner igen — ett numeriskt suffix, en hash — ger en kö per namn. UUID:er slås redan ihop (se [Vad som ignoreras](/docs/telemetry/queues#what-is-ignored)). Markera sådana destinationer med `messaging.destination.temporary=true` i din instrumentering, eller ge dem ett stabilt namn, och arkivera sedan de köer som redan skapats.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Se [En ny kö för varje förfrågan](/docs/telemetry/queues#a-new-queue-for-every-request) på dokumentationssidan om köer.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar AWS SDK:ns SQS-anrop utan kodändringar.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: paketet `OpenTelemetry.Instrumentation.AWS`, med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; dess standarduppsättning av attribut namnger en SQS-kö bara med dess URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, eller `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), tillagt med `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Dess SQS-spans bär köns URL i `server.address`, som OneUptime läser som kön.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Läs köernas CloudWatch-mätvärden med collectorns `aws_cloudwatch`-receiver, eller strömma dem genom en CloudWatch Metric Stream och Amazon Data Firehose till dess `awsfirehose`-receiver.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-ström: `approximatenumberofmessagesvisible`) | Synliga meddelanden | Mätare |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-ström: `approximateageofoldestmessage`) | Ålder på äldsta meddelandet | Mätare |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-ström: `approximatenumberofmessagesnotvisible`) | Meddelanden under överföring | Mätare |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-ström: `numberofmessagessent`) | Skickade meddelanden | Antal per period |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-ström: `numberofmessagesreceived`) | Mottagna meddelanden | Antal per period |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-ström: `numberofmessagesdeleted`) | Borttagna meddelanden | Antal per period |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Spans namnger systemet som `messaging.system` = `activemq` (godtas också: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java-agenten spårar JMS-klienter — ActiveMQ, Artemis, IBM MQ och alla andra JMS-brokers — utan kodändringar. JMS-spans säger `jms` oavsett vilken broker som finns bakom dem; en ActiveMQ-kö hör till den JMS-familjen, så dess klienters spans och dess brokers mätvärden hamnar på en kö.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collectorn har ingen JMX-receiver, så kör OpenTelemetry JMX Scraper med `OTEL_JMX_TARGET_SYSTEM=activemq` bredvid en ActiveMQ Classic-broker; den skickar brokerns destinationsmätvärden via OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Låt brokern ta emot JMX-anslutningar. Med avbildningen `apache/activemq-classic` eller skriptet `bin/activemq` anger du `ACTIVEMQ_SUNJMX_START` innan du startar den. Det här exemplet stänger av autentiseringen: håll porten i ett privat nätverk, eller slå på `jmxremote.authenticate` med en lösenordsfil och ge scrapern `OTEL_JMX_USERNAME` och `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Kör skraparen där den når den porten, med en Java-körmiljö. Den skickar direkt till OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` behåller de mätvärdesnamn som skraparen har använt sedan 1.53.0-alpha (`activemq.message.queue.size`, med destinationen i `messaging.destination.name`); OneUptime läser också de äldre namnen (`activemq.message.current`, med destinationen i `destination`). ActiveMQ Artemis har andra MBeans, som de här reglerna inte läser.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "En enda datapunkt av ett brokermätvärde som en kösida visar i diagram skapar också dess kö. Mätvärden från messaging-klienter, och dina egna mätvärden som bär `messaging.system` och `messaging.destination.name`, skapar aldrig en kö: de visas på fliken **Mätvärden** för en kö som finns.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Köstorlek | Mätare |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Köstorlek (gamla namn) | Mätare |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Köade | Räknare, visad per sekund |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Avköade | Räknare, visad per sekund |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Utgången | Räknare, visad per sekund |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Konsumenter | Mätare |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Genomsnittlig tid i kö | Mätare |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Genomsnittlig tid i kö (gamla namn) | Mätare |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Mätvärdet namnger kön annorlunda än spansen (se [Begränsningar](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Spans namnger systemet som `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar Kafka-producenter och -konsumenter utan kodändringar.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` med paketet `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` spårar `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` eller `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Gos automatiska instrumentering (`go.opentelemetry.io/auto`, eBPF, på Linux) spårar producenter och konsumenter i `segmentio/kafka-go` utan kodändringar.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collectorns `kafka_metrics`-receiver läser konsumentgruppers lagg och partitioners offsets från brokrarna; aktivera dess scrapers `topics` och `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "För ett kluster med SASL eller TLS avkommenterar du `auth` och `tls`. Receivern namnger varje topic i `topic`, och så hittar mätvärdena topicets kö. Den rapporterar en consumer-grupps lag och committade offsets bara för topics som gruppen har committat en offset till, och hoppar över topics vars namn börjar med `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Konsumentfördröjning | Mätare |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Partitionsfördröjning | Mätare |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Konsumerade | Räknare, visad per sekund |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Producerade | Räknare, visad per sekund |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka rapporterar en consumer-grupps lag först efter att gruppen har committat en offset. Receivern hoppar över topics vars namn börjar med `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Spans namnger systemet som `messaging.system` = `pulsar` (godtas också: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar Pulsar-klienter utan kodändringar.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Varje broker tillhandahåller sina topic- och prenumerationsmätvärden på sin webbtjänsts port; skrapa varje broker, eftersom en broker bara rapporterar de topics som den äger för tillfället.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar märker varje serie med topicets fullständiga namn (`persistent://public/default/orders`), och en partitions serier med partitionens: partitioner summeras i sitt topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Eftersläpning | Mätare |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Prenumerationens eftersläpning | Mätare |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Eftersläpningens ålder | Mätare |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Meddelanden in | Räknare, visad per sekund |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Meddelanden ut | Räknare, visad per sekund |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar RocketMQ-klienter utan kodändringar.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Ange `metricsExporterType=PROM` i brokerns `broker.conf` så att brokern tillhandahåller sina lagg- och genomströmningsmätvärden.",
  "Then scrape every broker:": "Skrapa sedan varje broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Redo meddelanden | Mätare |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Skickade till dead-letter-kö | Räknare, visad per sekund |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid-köer dyker upp i OneUptime av sig själva, från messaging-spans från applikationerna som publicerar till och konsumerar från dem. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor har topicens leverans- och dead-letter-mätvärden, som collectorns `azure_monitor`-receiver läser; de visas ännu inte på en kösida, så utforska dem under Mätvärden.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Receivern loggar in via tillägget `azure_auth`: ge tjänstens huvudnamn rollen **Monitoring Reader** på prenumerationen, och sätt `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` och `AZURE_SUBSCRIPTION_ID` i collectorns miljö.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Mätvärden från messaging-klienter, och dina egna mätvärden som bär `messaging.system` och `messaging.destination.name`, skapar aldrig en kö: de visas på fliken **Mätvärden** för en kö som finns.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime visar inga brokermätvärden för Azure Event Grid under **Brokerhälsa**: det som collectorn ovan skickar hamnar bara i **Mätvärden**-utforskaren. Ett mätvärde som bär `messaging.system` och `messaging.destination.name` på varje datapunkt visas på köns flik **Mätvärden**.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid har inga mätvärden i diagram. Dess mätvärden finns i **Mätvärden**-utforskaren.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK för Java spårar sig själv, och OpenTelemetry Java-agenten kopplar den spårningen till OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: Azure SDK:ns OpenTelemetry-spans är experimentella: sätt `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (eller växeln `Azure.Experimental.EnableActivitySource`) och prenumerera på Azure-källorna med `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registrera `createAzureSdkInstrumentation()` från `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: installera `azure-core-tracing-opentelemetry` och sätt `settings.tracing_implementation = "opentelemetry"` (från `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "En ansluten Azure-prenumeration läser namespacets viktigaste mätvärden för varje event hub, utan att du behöver köra något. För att läsa alla kör du collectorns `azure_monitor`-receiver, som delar upp dem per event hub efter dimensionen EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Receivern listar dina namnområden en gång om dagen, så det kan ta upp till 24 timmar innan ett nytt dyker upp.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Inkommande meddelanden | Antal per period |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Utgående meddelanden | Antal per period |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Serverfel | Antal per period |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Användarfel | Antal per period |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Fel vid överskriden kvot | Antal per period |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Strypta begäranden | Antal per period |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Storlek | Mätare |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Mätvärdet namnger kön annorlunda än spansen. Service Bus- och Event Hubs-spans utan namnområdesvärd hamnar på en annan kö än Azure Monitors mätvärden (se [Begränsningar](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor returnerar 10 köer per mätvärde och namnområde om inte `maximum_number_of_records_per_resource` höjs. Konfigurationen i steg 3 höjer den.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Receivern listar dina namespaces en gång om dagen, så ett nytt namespace kan ta upp till 24 timmar att dyka upp.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "En ansluten Azure-prenumeration läser namespacets viktigaste mätvärden för varje kö och topic, utan att du behöver köra något. För att läsa alla kör du collectorns `azure_monitor`-receiver, som delar upp dem per kö och topic efter dimensionen EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Aktiva meddelanden | Mätare |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Meddelanden i dead-letter | Mätare |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Schemalagda meddelanden | Mätare |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Slutförda meddelanden | Antal per period |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Övergivna meddelanden | Antal per period |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Serverns sändningslatens | Mätare |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ-köer dyker upp i OneUptime av sig själva, från messaging-spans från applikationerna som publicerar till och konsumerar från dem. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ:s egen telemetri (dess alternativ `telemetry`, som paketet `bullmq-otel` implementerar) namnger kön i `bullmq.queue.name` och sätter inget `messaging.system`, så ensam skapar den ingen kö. En `transform`-processor i den collector som dina applikationer skickar till lägger till de två nycklar som OneUptime läser, på de span som lägger till och bearbetar jobb och på BullMQ:s egna mätvärden:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Bara PRODUCER-spans som lägger till jobb och CONSUMER-spans som bearbetar dem märks: BullMQ:s interna spans namnger också kön, men är inte meddelanden. Peka dina applikationers OTLP-exportör mot den här collectorn.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ håller sina jobb i Redis och har ingen broker att skrapa; rapportera ködjupet från applikationen som ett mätvärde som bär `messaging.system` och `messaging.destination.name`, så som OneUptimes egna workers gör med `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Mät antalet jobb i applikationen; en mätare som själv bär de två nycklarna behöver ingen transform:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime visar inga brokermätvärden för BullMQ under **Brokerhälsa**. Allt som en collector skickar finns i **Mätvärden**-utforskaren, och ett mätvärde som bär `messaging.system` och `messaging.destination.name` på varje datapunkt visas på köns flik **Mätvärden**.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Dess spans namnger inget messaging-system som OneUptime kan känna igen: Celerys spans, BullMQ:s egen telemetri eller en egenbyggd klient. Lägg till `messaging.system` och `messaging.destination.name`, och ge spansen typen PRODUCER eller CONSUMER. För BullMQ gör transformen i steg 2 det.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ har inga mätvärden i diagram. Dess mätvärden finns i **Mätvärden**-utforskaren.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: klienten spårar sig själv så snart dess byggare `Publisher` och `Subscriber` får en OpenTelemetry-instans och spårningsväxeln — `setOpenTelemetry(GlobalOpenTelemetry.get())` och `setEnableOpenTelemetryTracing(true)`. Något av anropen ensamt spårar ingenting.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: med `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` och `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: med `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Läs topicens och prenumerationernas mätvärden från Cloud Monitoring med collectorns `googlecloudmonitoring`-receiver, och lista varje mätvärdestyp under `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Receivern loggar in med Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, eller tjänstkontot som collectorn körs som), som behöver rollen **Monitoring Viewer** på projektet. Sätt `project_id` till ditt projekt:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "En mätvärdestyp som saknas i `metrics_list` läses aldrig. Prenumerationsmätvärden hör till prenumerationens kö (`subscription_id`), topic-mätvärden till topicets (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Olevererade meddelanden | Mätare |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Ålder på äldsta obekräftade meddelandet | Mätare |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Meddelanden i dead-letter | Antal per period |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Bekräftade meddelanden | Antal per period |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Publiceringsbegäranden | Antal per period |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- Mätvärdet namnger kön annorlunda än spansen. Ett Pub/Sub-topic har topic-mätvärdena och dess prenumerationer prenumerationsmätvärdena.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring läser bara typerna i `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- De är fördröjda. Pub/Subs mätvärden kommer minuter för sent.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS-köer dyker upp i OneUptime av sig själva, från messaging-spans från applikationerna som publicerar till och konsumerar från dem. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS är ett API, och dess span namnger inte brokern bakom det; när brokern är Apache ActiveMQ kör du OpenTelemetry JMX Scraper mot den, och dess mätvärden ansluter till samma kö, som då visas som en ActiveMQ-kö, medan andra JMS-brokrar som IBM MQ inte har någon färdig väg för mätvärden.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Dess mätvärden hamnar på samma kö som JMS-spansen, som från och med då visas som en Apache ActiveMQ-kö.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime visar inga brokermätvärden för JMS under **Brokerhälsa**. Allt som en collector skickar finns i **Mätvärden**-utforskaren, och ett mätvärde som bär `messaging.system` och `messaging.destination.name` på varje datapunkt visas på köns flik **Mätvärden**.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Så snart en Apache ActiveMQ-brokers mätvärden kommer visas kön som en Apache ActiveMQ-kö och visar dem i diagram under **Brokerhälsa**: se [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Andra JMS-brokers än ActiveMQ har inga mätvärden i diagram. Deras mätvärden finns i **Mätvärden**-utforskaren. För en ActiveMQ-broker, se **Om brokern är Apache ActiveMQ** under **Avancerad**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS-köer dyker upp i OneUptime av sig själva, från messaging-spans från applikationerna som publicerar till och konsumerar från dem. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar NATS-klienter — dess NATS-instrumentering rapporterar `messaging.system` = `nats` — utan kodändringar.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Kör prometheus-nats-exporter med `-jsz=all` mot serverns övervakningsport. Dess JetStream-mätvärden gäller per ström och konsument, inte per subject, så de kopplas inte till köer på subject-nivå.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Slå på serverns övervakningsport med `-m 8222` (eller `http_port: 8222` i dess konfiguration), och kör sedan exportören:",
  "And scrape it:": "Och skrapa den:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime visar inga brokermätvärden för NATS under **Brokerhälsa**: det som collectorn ovan skickar hamnar bara i **Mätvärden**-utforskaren. Ett mätvärde som bär `messaging.system` och `messaging.destination.name` på varje datapunkt visas på köns flik **Mätvärden**.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS har inga mätvärden i diagram. Dess mätvärden finns i **Mätvärden**-utforskaren.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ-köer dyker upp i OneUptime av sig själva, från två källor: messaging-spans från applikationerna som publicerar till och konsumerar från dem, och brokerns egna mätvärden. Du kan också lägga till en manuellt: **Köer → Skapa Kö**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten spårar RabbitMQ-klienter utan kodändringar.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 spårar sig själv: prenumerera på `RabbitMQ.Client.*`. MassTransit spårar sig också själv: prenumerera på `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` eller `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collectorns `rabbitmq`-receiver läser varje kös djup, konsumenter och meddelandehastigheter från hanteringspluginets HTTP-API, som en användare med taggen `monitoring` och åtkomst till varje virtuell värd.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Aktivera management-pluginen och skapa den användaren. Taggen `monitoring` ensam visar den ingen kö: ge den åtkomst till varje virtuell värd som ska övervakas. Tomma mönster ger den åtkomsten utan någon rätt att konfigurera, publicera eller konsumera:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Sätt `RABBITMQ_USERNAME` och `RABBITMQ_PASSWORD` i collectorns miljö. Receivern rapporterar varje kö under dess RabbitMQ-namn, medan de flesta instrumenteringars spans namnger den exchange som ett meddelande gick genom: de två möts för meddelanden som skickas via standard-exchangen, vars routingnyckel är köns namn.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Ködjup | Mätare |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Publicerade | Räknare, visad per sekund |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Levererade | Räknare, visad per sekund |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Bekräftad | Räknare, visad per sekund |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Kasserade | Räknare, visad per sekund |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- Mätvärdet namnger kön annorlunda än spansen. RabbitMQ-spans namnger oftast exchangen, medan brokerns mätvärden beskriver köer. De två möts för meddelanden som skickas via standard-exchangen, vars routingnyckel är köns namn.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ rapporterar bara köerna i de virtuella värdar som dess användare har åtkomst till, och loggar inget fel för resten. RabbitMQ:s räknare visas vid första aktivitet.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Amazon SNS-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` väntar på att CloudWatch publicerar en period, så med den här konfigurationen kommer den här köns brokermätvärden 11 till 17 minuter för sent: en monitor över dem behöver ett längre fönster (se **Fördröjda mätvärden** under [Larm](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Skicka några meddelanden genom `orders`. Varje span som namnger den här kön märks med den när OneUptime tar emot det: spansen fyller **Översikt** — publicerade och konsumerade meddelanden, fel och bearbetningstid, och tjänsterna under **Producenter** och **Konsumenter** — och fliken **Spår**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Brokerhälsa** i Översikt fylls från brokerns mätvärden allteftersom de kommer: med konfigurationen i steg 3 kommer CloudWatchs 11 till 17 minuter för sent.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "Rubriken visar **Sedd nyligen** så snart identifieringen hittar spans eller brokermätvärden som namnger den här kön. Den körs var 10:e minut över de senaste 15 minuternas telemetri, och över de senaste 60 minuternas mätvärden från molnövervakning, som kommer sent.",
  "Names are compared without regard to case.":
    "Namn jämförs utan hänsyn till versaler och gemener.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `aws.sns` (eller `aws_sns`, `amazonsns` eller `sns`) och destinationen `orders` — i `messaging.destination.name`, eller en äldre nyckel som `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Brokermätvärden**: `Dimensions.TopicName` eller `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Amazon SQS-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Apache ActiveMQ-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Brokerhälsa** i Översikt fylls från brokerns mätvärden allteftersom de kommer.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "Rubriken visar **Sedd nyligen** så snart identifieringen hittar spans eller brokermätvärden som namnger den här kön. Den körs var 10:e minut över de senaste 15 minuternas telemetri.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- JMS-klienters spans säger `jms` oavsett vilken broker som finns bakom dem, så de och Apache ActiveMQ-brokerns mätvärden hamnar på den här enda kön.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "JMX-värden är förifylld från brokeradressen som den här köns telemetri rapporterar (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Apache Kafka-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `kafka` och destinationen `orders` — i `messaging.destination.name`, eller en äldre nyckel som `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Brokermätvärden**: `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "För ett kluster med SASL eller TLS avkommenterar du `auth` och `tls`. Bootstrap-brokern är förifylld från brokeradressen som den här köns telemetri rapporterar (`broker-1.example.com:9092`); ändra den om collectorn når brokern på ett annat sätt. Receivern namnger varje topic i `topic`, och så hittar mätvärdena topicets kö. Den rapporterar en consumer-grupps lag och committade offsets bara för topics som gruppen har committat en offset till, och hoppar över topics vars namn börjar med `_`.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Apache Pulsar-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `pulsar` (eller `apache_pulsar`) och destinationen `orders` — i `messaging.destination.name`, eller en äldre nyckel som `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Apache RocketMQ-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Det här är Azure Event Grid-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från mätvärden som bär dess `messaging.system` och `messaging.destination.name`. Allt nedan är förifyllt för den här kön.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Mätvärden som bär dess `messaging.system` och `messaging.destination.name` på varje datapunkt visas på dess flik **Mätvärden**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "Rubriken visar **Sedd nyligen** så snart identifieringen hittar spans eller mätvärden från messaging-klienter som namnger den här kön. Den körs var 10:e minut över de senaste 15 minuternas telemetri.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Azure Event Hubs-kön `orders` i namnområdet `orders-ns`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Spans**: `messaging.system` = `eventhubs` (eller `azure_eventhubs`, `azure.eventhubs` eller `microsoft.eventhub`) och destinationen `orders` — i `messaging.destination.name`, eller en äldre nyckel som `messaging.destination`, från ett SDK som är anslutet till `orders-ns.servicebus.windows.net`.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Brokermätvärden**: `metadata_entityname` = `orders`, på namnområdet vars `name` är `orders-ns`.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Azure Service Bus-kön `orders` i namnområdet `orders-ns`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Det här är BullMQ-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från mätvärden som bär dess `messaging.system` och `messaging.destination.name`. Allt nedan är förifyllt för den här kön.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är Google Cloud Pub/Sub-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Det här är JMS-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från mätvärden som bär dess `messaging.system` och `messaging.destination.name`. Allt nedan är förifyllt för den här kön.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Dess mätvärden hamnar på den här kön, som från och med då visas som en Apache ActiveMQ-kö.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Det här är NATS-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från mätvärden som bär dess `messaging.system` och `messaging.destination.name`. Allt nedan är förifyllt för den här kön.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Det här är RabbitMQ-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från brokerns egna mätvärden. Allt nedan är förifyllt för den här kön.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Sätt `RABBITMQ_USERNAME` och `RABBITMQ_PASSWORD` i collectorns miljö. Värden för management-endpointen är förifylld från brokeradressen som den här köns telemetri rapporterar (`broker-1.example.com:9092`); ändra den om collectorn når brokern på ett annat sätt. Receivern rapporterar varje kö under dess RabbitMQ-namn, medan de flesta instrumenteringars spans namnger den exchange som ett meddelande gick genom: de två möts för meddelanden som skickas via standard-exchangen, vars routingnyckel är köns namn.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Det här är `acme-bus`-kön `orders`. Den fylls från messaging-spans från applikationerna som publicerar till och konsumerar från den, och från mätvärden som bär dess `messaging.system` och `messaging.destination.name`. Allt nedan är förifyllt för den här kön.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime känner inte till det här meddelandesystemet och har därför inget färdigt sätt att läsa brokerns mätvärden; skicka dem med `messaging.system` och `messaging.destination.name` på varje datapunkt, så hör de till kön.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime visar inga brokermätvärden för `acme-bus` under **Brokerhälsa**. Allt som en collector skickar finns i **Mätvärden**-utforskaren, och ett mätvärde som bär `messaging.system` och `messaging.destination.name` på varje datapunkt visas på köns flik **Mätvärden**.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Bara brokerns egna mätvärden behöver ett system som OneUptime känner till (se [Meddelandesystem som stöds](/docs/telemetry/queues#supported-messaging-systems)). Dess mätvärden finns i **Mätvärden**-utforskaren.",
};

export default TRANSLATION;
