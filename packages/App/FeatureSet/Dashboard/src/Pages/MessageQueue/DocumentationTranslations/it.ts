import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Amazon SNS compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Gli span nominano il sistema come `messaging.system` = `aws.sns` (accettati anche: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Le code nascono dagli span di messaggistica che la tua strumentazione OpenTelemetry produce già; non serve nulla di specifico per OneUptime.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia le chiamate SNS dell'SDK AWS senza modifiche al codice.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: il pacchetto `OpenTelemetry.Instrumentation.AWS`, con `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; il suo insieme di attributi predefinito non nomina affatto un topic SNS.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traccia l'SDK AWS.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: il pacchetto `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, aggiunto con `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Qualsiasi altro client**: usa il supporto OpenTelemetry della libreria client, oppure imposta `messaging.system` = `aws.sns`, `messaging.destination.name` e il tipo di span (PRODUCER quando pubblica, CONSUMER quando consuma) sugli span attorno ai tuoi invii e handler.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Poi punta l'exporter OTLP su OneUptime. La maggior parte degli SDK e degli agenti legge queste variabili d'ambiente:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Questo token è un segreto.** Usa una chiave di acquisizione **Server**, conservata nei secret\n> del tuo deployment. Non mettere mai una chiave Server nel JavaScript del browser: per quello esiste\n> una chiave di acquisizione **Browser**.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Leggi le metriche CloudWatch dei topic con il receiver `aws_cloudwatch` del collector, oppure trasmettile tramite un CloudWatch Metric Stream e Amazon Data Firehose al suo receiver `awsfirehose`.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "Il receiver `aws_cloudwatch` interroga l'API `GetMetricData` di CloudWatch con le credenziali predefinite dell'SDK AWS (ambiente, profilo condiviso o ruolo dell'istanza), che richiedono `cloudwatch:ListMetrics` e `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Lascia `stats` non impostato.** Senza di esso ogni metrica arriva come un riepilogo per periodo, che è ciò che OneUptime legge.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` deve essere impostato, e limita le metriche lette a ogni raccolta.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` attende che CloudWatch pubblichi un periodo, quindi con questa configurazione le metriche del broker di una coda arrivano con un ritardo da 11 a 17 minuti: un monitor su di esse richiede una finestra più lunga (vedi **Metriche in ritardo** in [Avvisi](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Un receiver legge una regione e un namespace: aggiungi un'istanza per regione.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Per trasmettere invece le metriche in streaming — un CloudWatch Metric Stream tramite Amazon Data Firehose verso il receiver `awsfirehose` del collector — vedi [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Invia qualche messaggio attraverso le tue code. Ogni 10 minuti OneUptime legge gli span degli ultimi 15 minuti ed elenca, in **Code**, ogni destinazione nominata da almeno 3 di essi (span di qualsiasi tipo tranne SERVER). Su un OneUptime self-hosted, `MESSAGE_QUEUE_MIN_SPANS` imposta questo numero.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Anche un solo punto dati di una metrica del broker che una pagina di coda mostra nei grafici crea la sua coda: le metriche del monitoraggio cloud arrivano in ritardo, quindi ogni esecuzione le legge dagli ultimi 60 minuti. Le metriche dei client di messaggistica, e le tue metriche che portano `messaging.system` e `messaging.destination.name`, non creano mai una coda: compaiono nella scheda **Metriche** di una coda esistente.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Le code vengono create da sole solo finché il progetto resta sotto il suo [budget di creazione automatica](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "La Panoramica della coda mostra queste metriche in **Salute del broker**, e ogni indicatore e ogni conteggio per periodo ha **Crea monitor**. Finché non ne arriva una, la sezione indica da dove provengono.",
  "| Metric | Shown as | Type |": "| Metrica | Mostrata come | Tipo |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (stream JSON: `numberofmessagespublished`) | Messaggi pubblicati | Conteggio per periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (stream JSON: `numberofnotificationsdelivered`) | Notifiche consegnate | Conteggio per periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (stream JSON: `numberofnotificationsfailed`) | Notifiche non riuscite | Conteggio per periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (stream JSON: `numberofnotificationsredriventodlq`) | Reindirizzati alla coda dead-letter | Conteggio per periodo |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- I suoi span non nominano alcun sistema di messaggistica che OneUptime sappia riconoscere: gli span di Celery, la telemetria di BullMQ o un client fatto in casa. Aggiungi `messaging.system` e `messaging.destination.name`, e dai agli span il tipo PRODUCER o CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Il suo nome è tra quelli che OneUptime ignora (vedi [Cosa viene ignorato](/docs/telemetry/queues#what-is-ignored)), oppure la nominano solo span SERVER.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Negli ultimi 15 minuti sono arrivati meno di 3 dei suoi span, oppure il progetto ha raggiunto il suo [budget di creazione automatica](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Quando i suoi span la indicano davvero, creala a mano con lo stesso sistema e la stessa destinazione (**Code → Crea: Coda**): la sua scheda **Tracce** si riempie con gli span già memorizzati.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Vedi [Una coda che le mie applicazioni usano non è stata creata](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) nella pagina della documentazione delle code.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Controlla il log del collector. OneUptime rifiuta una chiave di acquisizione errata con `401` (`422` per una chiave disattivata o una chiave Browser), e il collector registra `Exporting failed` per ogni batch che scarta.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Sono in ritardo. `aws_cloudwatch` attende `delay` (10 minuti) che CloudWatch pubblichi, quindi i suoi punti arrivano con un ritardo da 11 a 17 minuti.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Vedi [La salute del broker resta vuota](/docs/telemetry/queues#broker-health-stays-empty) nella pagina della documentazione delle code.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Due sistemi la indicano: un client Kafka sull'endpoint Kafka di Event Hubs segnala `kafka`, l'SDK di Event Hubs `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Un avvistamento di Service Bus o Event Hubs non ha namespace: l'emulatore o un dominio personalizzato.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- Gli span RabbitMQ di solito nominano l'exchange, e le metriche del broker la coda: due code in OneUptime, a meno che exchange e coda non abbiano lo stesso nome.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Archivia quella che non vuoi: una coda archiviata resta archiviata, e ciò che la indica non ne crea più una nuova.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Vedi [Due code per un'unica destinazione](/docs/telemetry/queues#two-queues-for-one-destination) nella pagina della documentazione delle code.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Una destinazione nominata per richiesta o per consumer che OneUptime non riconosce — un suffisso numerico, un hash — crea una coda per ogni nome. Gli UUID sono già raggruppati (vedi [Cosa viene ignorato](/docs/telemetry/queues#what-is-ignored)). Contrassegna queste destinazioni con `messaging.destination.temporary=true` nella tua strumentazione, o dai loro un nome stabile, poi archivia le code già create.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Vedi [Una nuova coda per ogni richiesta](/docs/telemetry/queues#a-new-queue-for-every-request) nella pagina della documentazione delle code.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Amazon SQS compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia le chiamate SQS dell'SDK AWS senza modifiche al codice.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: il pacchetto `OpenTelemetry.Instrumentation.AWS`, con `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; il suo insieme di attributi predefinito nomina una coda SQS solo tramite il suo URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, oppure `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), aggiunto con `otelaws.AppendMiddlewares(&cfg.APIOptions)`. I suoi span SQS portano l'URL della coda in `server.address`, che OneUptime legge come la coda.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Leggi le metriche CloudWatch delle code con il receiver `aws_cloudwatch` del collector, oppure trasmettile tramite un CloudWatch Metric Stream e Amazon Data Firehose al suo receiver `awsfirehose`.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (stream JSON: `approximatenumberofmessagesvisible`) | Messaggi visibili | Indicatore |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (stream JSON: `approximateageofoldestmessage`) | Età del messaggio più vecchio | Indicatore |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (stream JSON: `approximatenumberofmessagesnotvisible`) | Messaggi in transito | Indicatore |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (stream JSON: `numberofmessagessent`) | Messaggi inviati | Conteggio per periodo |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (stream JSON: `numberofmessagesreceived`) | Messaggi ricevuti | Conteggio per periodo |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (stream JSON: `numberofmessagesdeleted`) | Messaggi eliminati | Conteggio per periodo |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Apache ActiveMQ compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Gli span nominano il sistema come `messaging.system` = `activemq` (accettati anche: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: l'agente Java di OpenTelemetry traccia i client JMS — ActiveMQ, Artemis, IBM MQ e ogni altro broker JMS — senza modifiche al codice. Gli span JMS dicono `jms` qualunque broker ci sia dietro; una coda ActiveMQ è identificata da quella famiglia JMS, così gli span dei suoi client e le metriche del suo broker arrivano su un'unica coda.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Il collector non ha un receiver JMX, quindi esegui l'OpenTelemetry JMX Scraper con `OTEL_JMX_TARGET_SYSTEM=activemq` accanto a un broker ActiveMQ Classic; invia le metriche delle destinazioni del broker via OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Fai accettare al broker le connessioni JMX. Con l'immagine `apache/activemq-classic` o lo script `bin/activemq`, imposta `ACTIVEMQ_SUNJMX_START` prima di avviarlo. Questo esempio disattiva l'autenticazione: tieni la porta su una rete privata, oppure attiva `jmxremote.authenticate` con un file di password e dai allo scraper `OTEL_JMX_USERNAME` e `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Esegui lo scraper dove può raggiungere quella porta, con un runtime Java. Invia direttamente a OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` mantiene i nomi delle metriche che lo scraper usa dalla 1.53.0-alpha (`activemq.message.queue.size`, con la destinazione in `messaging.destination.name`); OneUptime legge anche i nomi precedenti (`activemq.message.current`, con la destinazione in `destination`). ActiveMQ Artemis ha MBean diversi, che queste regole non leggono.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Anche un solo punto dati di una metrica del broker che una pagina di coda mostra nei grafici crea la sua coda. Le metriche dei client di messaggistica, e le tue metriche che portano `messaging.system` e `messaging.destination.name`, non creano mai una coda: compaiono nella scheda **Metriche** di una coda esistente.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Dimensione della coda | Indicatore |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Dimensione della coda (nomi precedenti) | Indicatore |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Accodati | Contatore, mostrato al secondo |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Rimossi dalla coda | Contatore, mostrato al secondo |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Scaduto | Contatore, mostrato al secondo |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consumatori | Indicatore |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Tempo medio in coda | Indicatore |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Tempo medio in coda (nomi precedenti) | Indicatore |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La metrica nomina la coda diversamente dagli span (vedi [Limitazioni](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Apache Kafka compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Gli span nominano il sistema come `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia producer e consumer Kafka senza modifiche al codice.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` con il pacchetto `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traccia `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` o `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: l'auto-strumentazione di OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, su Linux) traccia producer e consumer di `segmentio/kafka-go` senza modifiche al codice.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Il receiver `kafka_metrics` del collector legge dai broker il lag dei gruppi di consumer e gli offset delle partizioni; attiva i suoi scraper `topics` e `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Per un cluster con SASL o TLS, togli il commento a `auth` e `tls`. Il receiver nomina ogni topic in `topic`, ed è così che le metriche trovano la coda del topic. Riporta il lag e gli offset confermati di un consumer group solo sui topic su cui il gruppo ha confermato un offset, e salta i topic il cui nome inizia con `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Ritardo dei consumatori | Indicatore |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Ritardo della partizione | Indicatore |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Consumati | Contatore, mostrato al secondo |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Prodotti | Contatore, mostrato al secondo |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka riporta il lag di un consumer group solo dopo che il gruppo ha confermato un offset. Il receiver salta i topic il cui nome inizia con `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Apache Pulsar compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Gli span nominano il sistema come `messaging.system` = `pulsar` (accettati anche: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia i client Pulsar senza modifiche al codice.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Ogni broker espone le sue metriche di topic e sottoscrizioni sulla porta del suo servizio web; raccogli ogni broker, perché un broker segnala solo i topic che possiede in quel momento.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar etichetta ogni serie con il nome completo del topic (`persistent://public/default/orders`), e quelle di una partizione con quello della partizione: le partizioni si sommano nel loro topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Arretrato | Indicatore |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Arretrato della sottoscrizione | Indicatore |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Età dell'arretrato | Indicatore |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Messaggi in ingresso | Contatore, mostrato al secondo |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Messaggi in uscita | Contatore, mostrato al secondo |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Apache RocketMQ compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia i client RocketMQ senza modifiche al codice.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Imposta `metricsExporterType=PROM` nel `broker.conf` del broker affinché il broker esponga le sue metriche di lag e di throughput.",
  "Then scrape every broker:": "Poi raccogli ogni broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Messaggi pronti | Indicatore |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Inviati alla coda dead-letter | Contatore, mostrato al secondo |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Azure Event Grid compaiono da sole in OneUptime, dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor ha le metriche di consegna e di dead letter dei topic, che il receiver `azure_monitor` del collector legge; non vengono ancora mostrate in una pagina di coda, quindi esplorale in Metriche.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Il receiver si autentica tramite l'estensione `azure_auth`: assegna all'entità servizio il ruolo **Monitoring Reader** sulla sottoscrizione, e imposta `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_SUBSCRIPTION_ID` nell'ambiente del collector.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Le metriche dei client di messaggistica, e le tue metriche che portano `messaging.system` e `messaging.destination.name`, non creano mai una coda: compaiono nella scheda **Metriche** di una coda esistente.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime non mostra nei grafici alcuna metrica del broker per Azure Event Grid in **Salute del broker**: ciò che invia il collector qui sopra arriva solo nell'explorer **Metriche**. Una metrica che porta `messaging.system` e `messaging.destination.name` su ogni punto dati compare nella scheda **Metriche** della coda.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid non ha metriche nei grafici. Le sue metriche si trovano nell'explorer **Metriche**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Azure Event Hubs compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: l'Azure SDK per Java si traccia da sé, e l'agente Java di OpenTelemetry collega quel tracciamento a OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    "- **.NET**: gli span OpenTelemetry dell'Azure SDK sono sperimentali: imposta `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (o l'opzione `Azure.Experimental.EnableActivitySource`) e iscriviti alle sorgenti Azure con `.AddSource(\"Azure.*\")`.",
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registra `createAzureSdkInstrumentation()` da `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: installa `azure-core-tracing-opentelemetry` e imposta `settings.tracing_implementation = "opentelemetry"` (da `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Una sottoscrizione Azure connessa legge le metriche chiave del namespace per ogni event hub, senza nulla da eseguire. Per leggerle tutte, esegui il receiver `azure_monitor` del collector, che le suddivide per event hub in base alla dimensione EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Il receiver elenca i tuoi namespace una volta al giorno, quindi un nuovo namespace può impiegare fino a 24 ore per comparire.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Messaggi in arrivo | Conteggio per periodo |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Messaggi in uscita | Conteggio per periodo |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Errori del server | Conteggio per periodo |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Errori utente | Conteggio per periodo |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Errori di quota superata | Conteggio per periodo |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Richieste limitate | Conteggio per periodo |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Dimensione | Indicatore |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La metrica nomina la coda diversamente dagli span. Gli span di Service Bus ed Event Hubs senza host del namespace finiscono su una coda diversa da quella delle metriche di Azure Monitor (vedi [Limitazioni](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor restituisce 10 code per metrica e namespace, a meno che `maximum_number_of_records_per_resource` non venga aumentato. La configurazione del passaggio 3 lo aumenta.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Il receiver elenca i tuoi namespace una volta al giorno, quindi un nuovo namespace può impiegare fino a 24 ore per comparire.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Azure Service Bus compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Una sottoscrizione Azure connessa legge le metriche chiave del namespace per ogni coda e topic, senza nulla da eseguire. Per leggerle tutte, esegui il receiver `azure_monitor` del collector, che le suddivide per coda e topic in base alla dimensione EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Messaggi attivi | Indicatore |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Messaggi in dead-letter | Indicatore |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Messaggi pianificati | Indicatore |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Messaggi completati | Conteggio per periodo |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Messaggi abbandonati | Conteggio per periodo |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Latenza di invio del server | Indicatore |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di BullMQ compaiono da sole in OneUptime, dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "La telemetria propria di BullMQ (la sua opzione `telemetry`, implementata dal pacchetto `bullmq-otel`) indica la coda in `bullmq.queue.name` e non imposta alcun `messaging.system`, quindi da sola non crea alcuna coda. Un processor `transform` nel collector a cui inviano le tue applicazioni aggiunge le due chiavi che OneUptime legge, sugli span che aggiungono ed elaborano job e sulle metriche di BullMQ stesso:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Vengono etichettati solo gli span PRODUCER che aggiungono job e gli span CONSUMER che li elaborano: anche gli span interni di BullMQ nominano la coda, ma non sono messaggi. Punta l'exporter OTLP delle tue applicazioni su questo collector.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ tiene i suoi job in Redis e non ha un broker da raccogliere; segnala la profondità della coda dall'applicazione come metrica che riporta `messaging.system` e `messaging.destination.name`, come fanno i worker di OneUptime con `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Osserva il numero di job nell'applicazione; un indicatore che porta già le due chiavi non ha bisogno di trasformazione:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime non mostra nei grafici alcuna metrica del broker per BullMQ in **Salute del broker**. Tutto ciò che invia un collector si trova nell'explorer **Metriche**, e una metrica che porta `messaging.system` e `messaging.destination.name` su ogni punto dati compare nella scheda **Metriche** della coda.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- I suoi span non nominano alcun sistema di messaggistica che OneUptime sappia riconoscere: gli span di Celery, la telemetria di BullMQ o un client fatto in casa. Aggiungi `messaging.system` e `messaging.destination.name`, e dai agli span il tipo PRODUCER o CONSUMER. Per BullMQ, se ne occupa la trasformazione del passaggio 2.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ non ha metriche nei grafici. Le sue metriche si trovano nell'explorer **Metriche**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di Google Cloud Pub/Sub compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: il client si traccia da sé non appena i suoi builder `Publisher` e `Subscriber` ricevono un'istanza OpenTelemetry e l'opzione di tracciamento — `setOpenTelemetry(GlobalOpenTelemetry.get())` e `setEnableOpenTelemetryTracing(true)`. Una sola delle due chiamate non traccia nulla.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: con `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` e `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: con `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Leggi le metriche dei topic e delle sottoscrizioni da Cloud Monitoring con il receiver `googlecloudmonitoring` del collector, elencando ogni tipo di metrica in `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Il receiver si autentica con le Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, o l'account di servizio con cui gira il collector), che richiedono il ruolo **Monitoring Viewer** sul progetto. Imposta `project_id` sul tuo progetto:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Un tipo di metrica assente da `metrics_list` non viene mai letto. Le metriche di sottoscrizione si associano alla coda della sottoscrizione (`subscription_id`), quelle di topic a quella del topic (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Messaggi non consegnati | Indicatore |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Età del messaggio non confermato più vecchio | Indicatore |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Messaggi in dead-letter | Conteggio per periodo |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Messaggi confermati | Conteggio per periodo |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Richieste di pubblicazione | Conteggio per periodo |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- La metrica nomina la coda diversamente dagli span. Un topic Pub/Sub ha le metriche di topic e le sue sottoscrizioni quelle di sottoscrizione.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring legge solo i tipi in `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Sono in ritardo. Le metriche di Pub/Sub arrivano con qualche minuto di ritardo.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di JMS compaiono da sole in OneUptime, dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS è un'API, e i suoi span non indicano il broker che c'è dietro; quando il broker è Apache ActiveMQ, esegui l'OpenTelemetry JMX Scraper su di esso e le sue metriche si uniscono alla stessa coda, che viene allora mostrata come coda ActiveMQ, mentre gli altri broker JMS come IBM MQ non hanno un percorso di metriche pronto all'uso.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Le sue metriche si uniscono alla stessa coda degli span JMS, che da quel momento compare come coda Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime non mostra nei grafici alcuna metrica del broker per JMS in **Salute del broker**. Tutto ciò che invia un collector si trova nell'explorer **Metriche**, e una metrica che porta `messaging.system` e `messaging.destination.name` su ogni punto dati compare nella scheda **Metriche** della coda.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Non appena arrivano le metriche di un broker Apache ActiveMQ, la coda compare come coda Apache ActiveMQ e le mostra nei grafici in **Salute del broker**: vedi [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- I broker JMS diversi da ActiveMQ non hanno metriche nei grafici. Le loro metriche si trovano nell'explorer **Metriche**. Per un broker ActiveMQ, vedi **Se il broker è Apache ActiveMQ** in **Avanzato**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di NATS compaiono da sole in OneUptime, dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia i client NATS — la sua strumentazione NATS riporta `messaging.system` = `nats` — senza modifiche al codice.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Esegui prometheus-nats-exporter con `-jsz=all` sulla porta di monitoraggio del server. Le sue metriche JetStream sono per stream e consumer, non per subject, quindi non si associano alle code a livello di subject.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Attiva la porta di monitoraggio del server con `-m 8222` (o `http_port: 8222` nella sua configurazione), poi esegui l'exporter:",
  "And scrape it:": "E raccoglilo:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime non mostra nei grafici alcuna metrica del broker per NATS in **Salute del broker**: ciò che invia il collector qui sopra arriva solo nell'explorer **Metriche**. Una metrica che porta `messaging.system` e `messaging.destination.name` su ogni punto dati compare nella scheda **Metriche** della coda.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS non ha metriche nei grafici. Le sue metriche si trovano nell'explorer **Metriche**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Le code di RabbitMQ compaiono da sole in OneUptime, da due fonti: gli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e le metriche del broker stesso. Puoi anche aggiungerne una a mano: **Code → Crea: Coda**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: l'agente Java di OpenTelemetry traccia i client RabbitMQ senza modifiche al codice.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 si traccia da sé: iscriviti a `RabbitMQ.Client.*`. Anche MassTransit si traccia da sé: iscriviti a `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` o `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Il receiver `rabbitmq` del collector legge la profondità, i consumer e le frequenze dei messaggi di ogni coda dall'API HTTP del plugin di gestione, come un utente con il tag `monitoring` e accesso a ogni host virtuale.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Abilita il plugin di gestione e crea quell'utente. Il tag `monitoring` da solo non gli mostra alcuna coda: dagli accesso a ogni virtual host da monitorare. I pattern vuoti concedono quell'accesso senza alcun diritto di configurare, pubblicare o consumare:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Imposta `RABBITMQ_USERNAME` e `RABBITMQ_PASSWORD` nell'ambiente del collector. Il receiver riporta ogni coda con il suo nome RabbitMQ, mentre gli span della maggior parte delle strumentazioni nominano l'exchange attraverso cui è passato un messaggio: i due si incontrano per i messaggi inviati tramite l'exchange predefinito, la cui routing key è il nome della coda.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Profondità della coda | Indicatore |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Pubblicati | Contatore, mostrato al secondo |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Consegnati | Contatore, mostrato al secondo |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Riconosciuto | Contatore, mostrato al secondo |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Scartati | Contatore, mostrato al secondo |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- La metrica nomina la coda diversamente dagli span. Gli span RabbitMQ di solito nominano l'exchange, mentre le metriche del broker descrivono le code. I due si incontrano per i messaggi inviati tramite l'exchange predefinito, la cui routing key è il nome della coda.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ riporta solo le code dei virtual host a cui il suo utente ha accesso, e non registra alcun errore per gli altri. I contatori di RabbitMQ compaiono con la prima attività.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Amazon SNS `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` attende che CloudWatch pubblichi un periodo, quindi con questa configurazione le metriche del broker di questa coda arrivano con un ritardo da 11 a 17 minuti: un monitor su di esse richiede una finestra più lunga (vedi **Metriche in ritardo** in [Avvisi](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Invia qualche messaggio attraverso `orders`. Ogni span che nomina questa coda viene etichettato con essa quando OneUptime lo acquisisce: gli span riempiono la **Panoramica** — messaggi pubblicati e consumati, errori e tempo di elaborazione, e i servizi in **Produttori** e **Consumatori** — e la scheda **Tracce**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Salute del broker** nella Panoramica si riempie dalle metriche del broker man mano che arrivano: con la configurazione del passaggio 3, quelle di CloudWatch arrivano con un ritardo da 11 a 17 minuti.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "L'intestazione mostra **Visto di recente** non appena il rilevamento trova span o metriche del broker che nominano questa coda. Viene eseguito ogni 10 minuti sugli ultimi 15 minuti di telemetria, e sugli ultimi 60 minuti di metriche del monitoraggio cloud, che arrivano in ritardo.",
  "Names are compared without regard to case.":
    "I nomi vengono confrontati senza distinguere tra maiuscole e minuscole.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**: `messaging.system` = `aws.sns` (o `aws_sns`, `amazonsns` o `sns`) e la destinazione `orders` — in `messaging.destination.name`, o in una chiave più vecchia come `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Metriche del broker**: `Dimensions.TopicName` o `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Amazon SQS `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Apache ActiveMQ `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Salute del broker** nella Panoramica si riempie dalle metriche del broker man mano che arrivano.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "L'intestazione mostra **Visto di recente** non appena il rilevamento trova span o metriche del broker che nominano questa coda. Viene eseguito ogni 10 minuti sugli ultimi 15 minuti di telemetria.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- Gli span dei client JMS dicono `jms` qualunque broker ci sia dietro, così loro e le metriche del broker Apache ActiveMQ arrivano su quest'unica coda.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "L'host JMX è precompilato dall'indirizzo del broker che la telemetria di questa coda riporta (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Apache Kafka `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**: `messaging.system` = `kafka` e la destinazione `orders` — in `messaging.destination.name`, o in una chiave più vecchia come `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Metriche del broker**: `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Per un cluster con SASL o TLS, togli il commento a `auth` e `tls`. Il broker di bootstrap è precompilato dall'indirizzo del broker che la telemetria di questa coda riporta (`broker-1.example.com:9092`); cambialo se il collector raggiunge il broker in un altro modo. Il receiver nomina ogni topic in `topic`, ed è così che le metriche trovano la coda del topic. Riporta il lag e gli offset confermati di un consumer group solo sui topic su cui il gruppo ha confermato un offset, e salta i topic il cui nome inizia con `_`.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Apache Pulsar `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Span**: `messaging.system` = `pulsar` (o `apache_pulsar`) e la destinazione `orders` — in `messaging.destination.name`, o in una chiave più vecchia come `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Apache RocketMQ `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Questa è la coda di Azure Event Grid `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche che portano il suo `messaging.system` e il suo `messaging.destination.name`. Tutto ciò che segue è precompilato per questa coda.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Le metriche che portano il suo `messaging.system` e il suo `messaging.destination.name` su ogni punto dati compaiono nella sua scheda **Metriche**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "L'intestazione mostra **Visto di recente** non appena il rilevamento trova span o metriche dei client di messaggistica che nominano questa coda. Viene eseguito ogni 10 minuti sugli ultimi 15 minuti di telemetria.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Azure Event Hubs `orders` nel namespace `orders-ns`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Span**: `messaging.system` = `eventhubs` (o `azure_eventhubs`, `azure.eventhubs` o `microsoft.eventhub`) e la destinazione `orders` — in `messaging.destination.name`, o in una chiave più vecchia come `messaging.destination`, da un SDK connesso a `orders-ns.servicebus.windows.net`.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Metriche del broker**: `metadata_entityname` = `orders`, sul namespace il cui `name` è `orders-ns`.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Azure Service Bus `orders` nel namespace `orders-ns`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Questa è la coda di BullMQ `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche che portano il suo `messaging.system` e il suo `messaging.destination.name`. Tutto ciò che segue è precompilato per questa coda.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di Google Cloud Pub/Sub `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Questa è la coda di JMS `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche che portano il suo `messaging.system` e il suo `messaging.destination.name`. Tutto ciò che segue è precompilato per questa coda.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Le sue metriche si uniscono a questa coda, che da quel momento compare come coda Apache ActiveMQ.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Questa è la coda di NATS `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche che portano il suo `messaging.system` e il suo `messaging.destination.name`. Tutto ciò che segue è precompilato per questa coda.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Questa è la coda di RabbitMQ `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche del broker stesso. Tutto ciò che segue è precompilato per questa coda.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Imposta `RABBITMQ_USERNAME` e `RABBITMQ_PASSWORD` nell'ambiente del collector. L'host dell'endpoint di gestione è precompilato dall'indirizzo del broker che la telemetria di questa coda riporta (`broker-1.example.com:9092`); cambialo se il collector raggiunge il broker in un altro modo. Il receiver riporta ogni coda con il suo nome RabbitMQ, mentre gli span della maggior parte delle strumentazioni nominano l'exchange attraverso cui è passato un messaggio: i due si incontrano per i messaggi inviati tramite l'exchange predefinito, la cui routing key è il nome della coda.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Questa è la coda di `acme-bus` `orders`. Si riempie dagli span di messaggistica delle applicazioni che vi pubblicano e ne consumano, e dalle metriche che portano il suo `messaging.system` e il suo `messaging.destination.name`. Tutto ciò che segue è precompilato per questa coda.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime non conosce questo sistema di messaggistica, quindi non ha un modo pronto per leggere le metriche del broker; inviale con `messaging.system` e `messaging.destination.name` su ogni punto dati e si associano alla coda.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime non mostra nei grafici alcuna metrica del broker per `acme-bus` in **Salute del broker**. Tutto ciò che invia un collector si trova nell'explorer **Metriche**, e una metrica che porta `messaging.system` e `messaging.destination.name` su ogni punto dati compare nella scheda **Metriche** della coda.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Solo le metriche del broker stesso richiedono un sistema che OneUptime conosce (vedi [Sistemi di messaggistica supportati](/docs/telemetry/queues#supported-messaging-systems)). Le sue metriche si trovano nell'explorer **Metriche**.",
};

export default TRANSLATION;
