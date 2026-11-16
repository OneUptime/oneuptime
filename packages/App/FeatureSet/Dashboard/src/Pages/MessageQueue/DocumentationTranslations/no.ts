import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Spans navngir systemet som `messaging.system` = `aws.sns` (godtas også: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Køer kommer fra messaging-spansene OpenTelemetry-instrumenteringen din allerede produserer; ingenting spesielt for OneUptime trengs.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer AWS SDK-ens SNS-kall uten kodeendringer.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: pakken `OpenTelemetry.Instrumentation.AWS`, med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; standardsettet med attributter navngir ikke noe SNS-topic i det hele tatt.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracer AWS SDK-en.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: pakken `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, lagt til med `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Enhver annen klient**: bruk klientbibliotekets egen OpenTelemetry-støtte, eller sett `messaging.system` = `aws.sns`, `messaging.destination.name` og span-typen (PRODUCER ved publisering, CONSUMER ved konsumering) på spansene rundt sendingene og handlerne dine.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Pek deretter OTLP-eksportøren mot OneUptime. De fleste SDK-er og agenter leser disse miljøvariablene:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Dette tokenet er en hemmelighet.** Bruk en **Server**-ingestion-nøkkel, oppbevart i\n> utrullingens secrets. Legg aldri en Server-nøkkel i nettleser-JavaScript — til det finnes\n> en **Nettleser**-ingestion-nøkkel.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en ingestion-nøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Les CloudWatch-målingene til topicene med collectorens `aws_cloudwatch`-receiver, eller strøm dem gjennom en CloudWatch Metric Stream og Amazon Data Firehose til dens `awsfirehose`-receiver.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch`-receiveren spør CloudWatchs `GetMetricData`-API med AWS SDK-ens standardlegitimasjon (miljø, delt profil eller instansrolle), som trenger `cloudwatch:ListMetrics` og `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **La `stats` være uangitt.** Uten den kommer hver måling som én oppsummering per periode, og det er den OneUptime leser.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` må være angitt, og begrenser målingene som leses per scrape.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` venter på at CloudWatch publiserer en periode, så med denne konfigurasjonen kommer en køs brokermålinger 11 til 17 minutter for sent: en monitor over dem trenger et lengre vindu (se **Forsinkede målinger** under [Varsling](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Én receiver leser én region og ett namespace: legg til en instans per region.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "For å strømme målingene i stedet — en CloudWatch Metric Stream gjennom Amazon Data Firehose til collectorens `awsfirehose`-receiver — se [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Send noen meldinger gjennom køene dine. Hvert 10. minutt leser OneUptime spansene fra de siste 15 minuttene og lister under **Køer** hver destinasjon som minst 3 av dem navngir (spans av alle typer unntatt SERVER). På en selvhostet OneUptime setter `MESSAGE_QUEUE_MIN_SPANS` det tallet.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Ett datapunkt av en brokermåling som en køside viser i en graf, oppretter også køen: målinger fra skyovervåkingen kommer sent, så hver kjøring leser dem fra de siste 60 minuttene. Målinger fra messaging-klienter, og dine egne målinger som bærer `messaging.system` og `messaging.destination.name`, oppretter aldri en kø: de vises i fanen **Målinger** for en kø som finnes.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Køer opprettes bare av seg selv så lenge prosjektet er under [budsjettet for automatisk oppretting](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Køens Oversikt viser disse i grafer under **Brokerhelse**, og hver måler og hvert antall per periode har **Opprett monitor**. Til en kommer, forteller seksjonen hvor de kommer fra.",
  "| Metric | Shown as | Type |": "| Måling | Vises som | Type |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-strøm: `numberofmessagespublished`) | Publiserte meldinger | Antall per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-strøm: `numberofnotificationsdelivered`) | Leverte varslinger | Antall per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-strøm: `numberofnotificationsfailed`) | Mislykkede varslinger | Antall per periode |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-strøm: `numberofnotificationsredriventodlq`) | Omdirigert til dead-letter-kø | Antall per periode |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Spansene navngir ikke noe messaging-system OneUptime kan kjenne igjen: Celerys spans, BullMQs egen telemetri eller en hjemmelaget klient. Legg til `messaging.system` og `messaging.destination.name`, og gi spansene typen PRODUCER eller CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Navnet er et av dem OneUptime ignorerer (se [Hva som ignoreres](/docs/telemetry/queues#what-is-ignored)), eller bare SERVER-spans navngir den.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Færre enn 3 av spansene kom i løpet av de siste 15 minuttene, eller prosjektet har nådd [budsjettet for automatisk oppretting](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Når spanene faktisk navngir den, oppretter du den manuelt med samme system og destinasjon (**Køer → Opprett Kø**): fanen **Spor** fylles fra spanene som allerede er lagret.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Se [En kø som applikasjonene mine bruker, ble ikke opprettet](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) på dokumentasjonssiden om køer.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Sjekk collectorens logg. OneUptime avviser en feil ingestion-nøkkel med `401` (`422` for en deaktivert nøkkel eller en Nettleser-nøkkel), og collectoren logger `Exporting failed` for hver batch den forkaster.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- De er forsinket. `aws_cloudwatch` venter `delay` (10 minutter) på at CloudWatch publiserer, så punktene kommer 11 til 17 minutter for sent.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Se [Brokerhelsen forblir tom](/docs/telemetry/queues#broker-health-stays-empty) på dokumentasjonssiden om køer.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- To systemer navngir den: en Kafka-klient på Kafka-endepunktet til Event Hubs rapporterer `kafka`, Event Hubs-SDK-et `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- En observasjon fra Service Bus eller Event Hubs har ikke noe namespace: emulatoren eller et egendefinert domene.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ-spans navngir vanligvis exchangen, og brokerens målinger køen: to køer i OneUptime, med mindre exchangen og køen har samme navn.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Arkiver den du ikke vil ha: en arkivert kø forblir arkivert, og det som navngir den, oppretter ikke lenger en ny.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Se [To køer for én destinasjon](/docs/telemetry/queues#two-queues-for-one-destination) på dokumentasjonssiden om køer.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "En destinasjon navngitt per forespørsel eller per consumer som OneUptime ikke kjenner igjen — et numerisk suffiks, en hash — gir én kø per navn. UUID-er slås allerede sammen (se [Hva som ignoreres](/docs/telemetry/queues#what-is-ignored)). Merk slike destinasjoner med `messaging.destination.temporary=true` i instrumenteringen, eller gi dem et stabilt navn, og arkiver deretter køene som allerede er opprettet.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Se [En ny kø for hver forespørsel](/docs/telemetry/queues#a-new-queue-for-every-request) på dokumentasjonssiden om køer.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer AWS SDK-ens SQS-kall uten kodeendringer.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: pakken `OpenTelemetry.Instrumentation.AWS`, med `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; standardsettet med attributter navngir en SQS-kø bare ved URL-en.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, eller `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), lagt til med `otelaws.AppendMiddlewares(&cfg.APIOptions)`. SQS-spansene bærer køens URL i `server.address`, som OneUptime leser som køen.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Les CloudWatch-målingene til køene med collectorens `aws_cloudwatch`-receiver, eller strøm dem gjennom en CloudWatch Metric Stream og Amazon Data Firehose til dens `awsfirehose`-receiver.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-strøm: `approximatenumberofmessagesvisible`) | Synlige meldinger | Måler |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-strøm: `approximateageofoldestmessage`) | Alder på eldste melding | Måler |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-strøm: `approximatenumberofmessagesnotvisible`) | Meldinger underveis | Måler |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-strøm: `numberofmessagessent`) | Sendte meldinger | Antall per periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-strøm: `numberofmessagesreceived`) | Mottatte meldinger | Antall per periode |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-strøm: `numberofmessagesdeleted`) | Slettede meldinger | Antall per periode |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Spans navngir systemet som `messaging.system` = `activemq` (godtas også: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java-agenten tracer JMS-klienter — ActiveMQ, Artemis, IBM MQ og alle andre JMS-brokere — uten kodeendringer. JMS-spans sier `jms` uansett hvilken broker som står bak; en ActiveMQ-kø hører til den JMS-familien, så klientenes spans og brokerens målinger havner på én kø.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collectoren har ingen JMX-receiver, så kjør OpenTelemetry JMX Scraper med `OTEL_JMX_TARGET_SYSTEM=activemq` ved siden av en ActiveMQ Classic-broker; den sender brokerens destinasjonsmålinger over OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. La brokeren godta JMX-tilkoblinger. Med imaget `apache/activemq-classic` eller skriptet `bin/activemq` setter du `ACTIVEMQ_SUNJMX_START` før du starter den. Dette eksemplet slår av autentisering: hold porten på et privat nettverk, eller slå på `jmxremote.authenticate` med en passordfil og gi scraperen `OTEL_JMX_USERNAME` og `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Kjør scraperen der den når den porten, med en Java-runtime. Den sender rett til OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` beholder målingsnavnene scraperen har brukt siden 1.53.0-alpha (`activemq.message.queue.size`, med destinasjonen i `messaging.destination.name`); OneUptime leser også de eldre navnene (`activemq.message.current`, med destinasjonen i `destination`). ActiveMQ Artemis har andre MBeans, som disse reglene ikke leser.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Ett datapunkt av en brokermåling som en køside viser i en graf, oppretter også køen. Målinger fra messaging-klienter, og dine egne målinger som bærer `messaging.system` og `messaging.destination.name`, oppretter aldri en kø: de vises i fanen **Målinger** for en kø som finnes.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Køstørrelse | Måler |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Køstørrelse (gamle navn) | Måler |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Satt i kø | Teller, vist per sekund |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Tatt ut av kø | Teller, vist per sekund |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Utløpt | Teller, vist per sekund |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Forbrukere | Måler |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Gjennomsnittlig tid i kø | Måler |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Gjennomsnittlig tid i kø (gamle navn) | Måler |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Målingen navngir køen annerledes enn spansene (se [Begrensninger](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Spans navngir systemet som `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer Kafka-produsenter og -konsumenter uten kodeendringer.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` med pakken `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracer `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` eller `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Gos automatiske instrumentering (`go.opentelemetry.io/auto`, eBPF, på Linux) tracer produsenter og konsumenter i `segmentio/kafka-go` uten kodeendringer.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collectorens `kafka_metrics`-receiver leser lag for consumergrupper og partisjonsoffsets fra brokerne; slå på scraperne `topics` og `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "For en klynge med SASL eller TLS fjerner du kommentartegnet foran `auth` og `tls`. Receiveren navngir hvert topic i `topic`, og slik finner målingene topicets kø. Den rapporterer en consumer-gruppes lag og committede offset bare for topics gruppen har committet et offset til, og hopper over topics der navnet begynner med `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Forbrukerforsinkelse | Måler |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Partisjonsforsinkelse | Måler |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Konsumert | Teller, vist per sekund |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Produsert | Teller, vist per sekund |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka rapporterer en consumer-gruppes lag først etter at gruppen har committet et offset. Receiveren hopper over topics der navnet begynner med `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Spans navngir systemet som `messaging.system` = `pulsar` (godtas også: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer Pulsar-klienter uten kodeendringer.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Hver broker leverer topic- og abonnementsmålingene sine på porten til webtjenesten sin; skrap hver broker, for en broker rapporterer bare topicene den eier for øyeblikket.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar merker hver serie med topicets fulle navn (`persistent://public/default/orders`), og en partisjons serier med partisjonens: partisjoner summeres i sitt topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Etterslep | Måler |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Abonnementets etterslep | Måler |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Etterslepets alder | Måler |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Meldinger inn | Teller, vist per sekund |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Meldinger ut | Teller, vist per sekund |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer RocketMQ-klienter uten kodeendringer.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Sett `metricsExporterType=PROM` i brokerens `broker.conf` slik at brokeren leverer lag- og gjennomstrømningsmålingene sine.",
  "Then scrape every broker:": "Skrap deretter hver broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Klare meldinger | Måler |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Sendt til dead-letter-kø | Teller, vist per sekund |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid-køer dukker opp i OneUptime av seg selv, fra messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor har leverings- og dead-letter-målingene til topicene, som collectorens `azure_monitor`-receiver leser; de vises ennå ikke på en køside, så utforsk dem under Målinger.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Receiveren logger inn gjennom utvidelsen `azure_auth`: gi tjenestekontohaveren rollen **Monitoring Reader** på abonnementet, og sett `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` og `AZURE_SUBSCRIPTION_ID` i collectorens miljø.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Målinger fra messaging-klienter, og dine egne målinger som bærer `messaging.system` og `messaging.destination.name`, oppretter aldri en kø: de vises i fanen **Målinger** for en kø som finnes.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermålinger for Azure Event Grid under **Brokerhelse**: det collectoren ovenfor sender, kommer bare fram til **Målinger**-utforskeren. En måling som bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises i køens fane **Målinger**.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid har ingen målinger i grafer. Målingene ligger i **Målinger**-utforskeren.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK for Java tracer seg selv, og OpenTelemetry Java-agenten kobler den tracingen til OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: Azure SDK-ens OpenTelemetry-spans er eksperimentelle: sett `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (eller bryteren `Azure.Experimental.EnableActivitySource`) og abonner på Azure-kildene med `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registrer `createAzureSdkInstrumentation()` fra `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: installer `azure-core-tracing-opentelemetry` og sett `settings.tracing_implementation = "opentelemetry"` (fra `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Et tilkoblet Azure-abonnement leser namespacets viktigste målinger for hver event hub, uten at du trenger å kjøre noe. For å lese alle kjører du collectorens `azure_monitor`-receiver, som deler dem opp per event hub etter dimensjonen EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Receiveren lister navnerommene dine én gang i døgnet, så det kan ta opptil 24 timer før et nytt dukker opp.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Innkommende meldinger | Antall per periode |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Utgående meldinger | Antall per periode |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Serverfeil | Antall per periode |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Brukerfeil | Antall per periode |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Feil ved overskredet kvote | Antall per periode |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Strupte forespørsler | Antall per periode |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Størrelse | Måler |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Målingen navngir køen annerledes enn spansene. Service Bus- og Event Hubs-spans uten navneromsvert havner på en annen kø enn Azure Monitors målinger (se [Begrensninger](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor returnerer 10 køer per måling og navnerom med mindre `maximum_number_of_records_per_resource` heves. Konfigurasjonen i trinn 3 hever den.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Receiveren lister namespacene dine én gang om dagen, så et nytt namespace kan bruke opptil 24 timer på å dukke opp.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Et tilkoblet Azure-abonnement leser namespacets viktigste målinger for hver kø og hvert topic, uten at du trenger å kjøre noe. For å lese alle kjører du collectorens `azure_monitor`-receiver, som deler dem opp per kø og topic etter dimensjonen EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Aktive meldinger | Måler |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Meldinger i dead-letter | Måler |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Planlagte meldinger | Måler |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Fullførte meldinger | Antall per periode |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Forlatte meldinger | Antall per periode |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Serverens sendelatens | Måler |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ-køer dukker opp i OneUptime av seg selv, fra messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQs egen telemetri (innstillingen `telemetry`, som pakken `bullmq-otel` implementerer) navngir køen i `bullmq.queue.name` og setter ikke `messaging.system`, så alene oppretter den ingen kø. En `transform`-prosessor i collectoren som applikasjonene dine sender til, legger til de to nøklene som OneUptime leser, på spanene som legger til og behandler jobber og på BullMQs egne målinger:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Bare PRODUCER-spansene som legger til jobber og CONSUMER-spansene som behandler dem, merkes: BullMQs interne spans navngir også køen, men er ikke meldinger. Pek applikasjonenes OTLP-eksportør mot denne collectoren.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ holder jobbene sine i Redis og har ingen broker å skrape; rapporter kødybden fra applikasjonen som en måling som bærer `messaging.system` og `messaging.destination.name`, slik OneUptimes egne workers gjør med `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Mål antall jobber i applikasjonen; en måler som selv bærer de to nøklene, trenger ingen transform:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermålinger for BullMQ under **Brokerhelse**. Alt en collector sender, ligger i **Målinger**-utforskeren, og en måling som bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises i køens fane **Målinger**.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Spansene navngir ikke noe messaging-system OneUptime kan kjenne igjen: Celerys spans, BullMQs egen telemetri eller en hjemmelaget klient. Legg til `messaging.system` og `messaging.destination.name`, og gi spansene typen PRODUCER eller CONSUMER. For BullMQ gjør transformen i trinn 2 det.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ har ingen målinger i grafer. Målingene ligger i **Målinger**-utforskeren.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: klienten tracer seg selv så snart builderne `Publisher` og `Subscriber` får en OpenTelemetry-instans og tracing-bryteren — `setOpenTelemetry(GlobalOpenTelemetry.get())` og `setEnableOpenTelemetryTracing(true)`. Hvert av kallene alene tracer ingenting.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: med `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` og `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: med `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Les målingene til topicene og abonnementene fra Cloud Monitoring med collectorens `googlecloudmonitoring`-receiver, og list opp hver målingstype under `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Receiveren logger inn med Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, eller tjenestekontoen collectoren kjører som), som trenger rollen **Monitoring Viewer** på prosjektet. Sett `project_id` til prosjektet ditt:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "En målingstype som mangler i `metrics_list`, leses aldri. Abonnementsmålinger hører til abonnementets kø (`subscription_id`), topic-målinger til topicets (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Ikke-leverte meldinger | Måler |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Alder på eldste ubekreftede melding | Måler |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Meldinger i dead-letter | Antall per periode |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Bekreftede meldinger | Antall per periode |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Publiseringsforespørsler | Antall per periode |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- Målingen navngir køen annerledes enn spansene. Et Pub/Sub-topic har topic-målingene og abonnementene dets abonnementsmålingene.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring leser bare typene i `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- De er forsinket. Pub/Subs målinger kommer minutter for sent.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS-køer dukker opp i OneUptime av seg selv, fra messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS er et API, og spanene navngir ikke brokeren bak; når brokeren er Apache ActiveMQ, kjører du OpenTelemetry JMX Scraper mot den, så målingene slutter seg til den samme køen, som da vises som en ActiveMQ-kø, mens andre JMS-brokere som IBM MQ ikke har noen ferdig vei for målinger.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Målingene havner på samme kø som JMS-spansene, som fra da av vises som en Apache ActiveMQ-kø.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermålinger for JMS under **Brokerhelse**. Alt en collector sender, ligger i **Målinger**-utforskeren, og en måling som bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises i køens fane **Målinger**.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Så snart målingene fra en Apache ActiveMQ-broker kommer, vises køen som en Apache ActiveMQ-kø og viser dem i grafer under **Brokerhelse**: se [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Andre JMS-brokere enn ActiveMQ har ingen målinger i grafer. Målingene deres ligger i **Målinger**-utforskeren. For en ActiveMQ-broker, se **Hvis brokeren er Apache ActiveMQ** under **Avansert**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS-køer dukker opp i OneUptime av seg selv, fra messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer NATS-klienter — NATS-instrumenteringen rapporterer `messaging.system` = `nats` — uten kodeendringer.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Kjør prometheus-nats-exporter med `-jsz=all` mot serverens overvåkingsport. JetStream-målingene gjelder per strøm og konsument, ikke per subject, så de knyttes ikke til køer på subject-nivå.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Slå på serverens overvåkingsport med `-m 8222` (eller `http_port: 8222` i konfigurasjonen), og kjør deretter eksportøren:",
  "And scrape it:": "Og skrap den:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime viser ingen brokermålinger for NATS under **Brokerhelse**: det collectoren ovenfor sender, kommer bare fram til **Målinger**-utforskeren. En måling som bærer `messaging.system` og `messaging.destination.name` på hvert datapunkt, vises i køens fane **Målinger**.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS har ingen målinger i grafer. Målingene ligger i **Målinger**-utforskeren.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ-køer dukker opp i OneUptime av seg selv, fra to kilder: messaging-spans fra applikasjonene som publiserer til og konsumerer fra dem, og brokerens egne målinger. Du kan også legge til en manuelt: **Køer → Opprett Kø**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java-agenten tracer RabbitMQ-klienter uten kodeendringer.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 tracer seg selv: abonner på `RabbitMQ.Client.*`. MassTransit tracer seg også selv: abonner på `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` eller `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collectorens `rabbitmq`-receiver leser dybden, konsumentene og meldingsratene til hver kø fra HTTP-API-et i administrasjonspluginen, som en bruker med taggen `monitoring` og tilgang til hver virtuelle vert.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Aktiver management-pluginen og opprett den brukeren. Taggen `monitoring` alene viser den ingen kø: gi den tilgang til hver virtuell vert som skal følges med på. Tomme mønstre gir den tilgangen uten noen rett til å konfigurere, publisere eller konsumere:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Sett `RABBITMQ_USERNAME` og `RABBITMQ_PASSWORD` i collectorens miljø. Receiveren rapporterer hver kø under RabbitMQ-navnet, mens de fleste instrumenteringers spans navngir exchangen en melding gikk gjennom: de to møtes for meldinger sendt gjennom standard-exchangen, der routing-nøkkelen er køens navn.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Kødybde | Måler |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Publisert | Teller, vist per sekund |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Levert | Teller, vist per sekund |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Bekreftet | Teller, vist per sekund |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Forkastet | Teller, vist per sekund |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- Målingen navngir køen annerledes enn spansene. RabbitMQ-spans navngir vanligvis exchangen, mens brokerens målinger beskriver køer. De to møtes for meldinger sendt gjennom standard-exchangen, der routing-nøkkelen er køens navn.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ rapporterer bare køene i de virtuelle vertene brukeren har tilgang til, og logger ingen feil for resten. RabbitMQs tellere vises ved første aktivitet.",
};

export default TRANSLATION;
