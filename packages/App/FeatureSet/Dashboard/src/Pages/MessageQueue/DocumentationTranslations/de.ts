import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Spans nennen das System als `messaging.system` = `aws.sns` (ebenfalls akzeptiert: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Warteschlangen entstehen aus den Messaging-Spans, die Ihre OpenTelemetry-Instrumentierung bereits erzeugt; nichts OneUptime-Spezifisches ist nötig.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet die SNS-Aufrufe des AWS SDK ohne Codeänderungen.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: das Paket `OpenTelemetry.Instrumentation.AWS` mit `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; sein Standard-Attributsatz nennt überhaupt kein SNS-Topic.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracet das AWS SDK.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: das Paket `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, hinzugefügt mit `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Jeder andere Client**: Nutzen Sie die eigene OpenTelemetry-Unterstützung der Client-Bibliothek, oder setzen Sie `messaging.system` = `aws.sns`, `messaging.destination.name` und die Span-Art (PRODUCER beim Veröffentlichen, CONSUMER beim Konsumieren) auf den Spans rund um Ihre Sendevorgänge und Handler.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Richten Sie dann den OTLP-Exporter auf OneUptime aus. Die meisten SDKs und Agenten lesen diese Umgebungsvariablen:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Dieses Token ist geheim.** Verwenden Sie einen **Server**-Aufnahmeschlüssel, der in den\n> Secrets Ihres Deployments liegt. Legen Sie einen Server-Schlüssel nie in Browser-JavaScript ab — dafür\n> gibt es einen **Browser**-Aufnahmeschlüssel.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Aufnahmeschlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lesen Sie die CloudWatch-Metriken der Topics mit dem `aws_cloudwatch`-Receiver des Collectors, oder streamen Sie sie über einen CloudWatch Metric Stream und Amazon Data Firehose an seinen `awsfirehose`-Receiver.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "Der `aws_cloudwatch`-Receiver fragt die `GetMetricData`-API von CloudWatch mit den Standard-Anmeldedaten des AWS SDK ab (Umgebung, gemeinsames Profil oder Instanzrolle), die `cloudwatch:ListMetrics` und `cloudwatch:GetMetricData` benötigen:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Lassen Sie `stats` ungesetzt.** Ohne diese Einstellung kommt jede Metrik als eine Zusammenfassung pro Zeitraum an, und genau die liest OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` muss gesetzt sein und begrenzt die pro Abruf gelesenen Metriken.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` wartet, bis CloudWatch einen Zeitraum veröffentlicht, daher kommen die Broker-Metriken einer Warteschlange mit dieser Konfiguration 11 bis 17 Minuten verspätet an: Ein Monitor darüber braucht ein längeres Zeitfenster (siehe **Verspätete Metriken** unter [Warnungen](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Ein Receiver liest eine Region und einen Namespace: Fügen Sie pro Region eine Instanz hinzu.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Um die Metriken stattdessen zu streamen — über einen CloudWatch Metric Stream und Amazon Data Firehose an den `awsfirehose`-Receiver des Collectors —, siehe [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Senden Sie ein paar Nachrichten durch Ihre Warteschlangen. Alle 10 Minuten liest OneUptime die Spans der letzten 15 Minuten und führt unter **Warteschlangen** jedes Ziel auf, das mindestens 3 davon nennen (Spans jeder Art außer SERVER). In einem selbst gehosteten OneUptime legt `MESSAGE_QUEUE_MIN_SPANS` diese Zahl fest.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Auch ein einzelner Datenpunkt einer Broker-Metrik, die eine Warteschlangenseite darstellt, legt ihre Warteschlange an: Metriken aus dem Cloud-Monitoring kommen verspätet an, daher liest jeder Lauf sie aus den letzten 60 Minuten. Metriken von Messaging-Clients und eigene Metriken, die `messaging.system` und `messaging.destination.name` tragen, legen nie eine Warteschlange an: Sie erscheinen im Tab **Metriken** einer bestehenden.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Warteschlangen werden nur von selbst angelegt, solange das Projekt unter seinem [Budget für automatisches Anlegen](/docs/telemetry/queues#the-auto-create-budget) liegt.",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "Die Übersicht der Warteschlange stellt diese unter **Broker-Zustand** dar, und jeder Messwert und jede Anzahl pro Zeitraum hat **Monitor erstellen**. Bis einer eintrifft, sagt der Abschnitt, woher sie kommen.",
  "| Metric | Shown as | Type |": "| Metrik | Angezeigt als | Typ |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON-Stream: `numberofmessagespublished`) | Veröffentlichte Nachrichten | Anzahl pro Zeitraum |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON-Stream: `numberofnotificationsdelivered`) | Zugestellte Benachrichtigungen | Anzahl pro Zeitraum |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON-Stream: `numberofnotificationsfailed`) | Fehlgeschlagene Benachrichtigungen | Anzahl pro Zeitraum |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON-Stream: `numberofnotificationsredriventodlq`) | In die Dead-Letter-Warteschlange umgeleitet | Anzahl pro Zeitraum |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Ihre Spans nennen kein Messaging-System, das OneUptime erkennt: die Spans von Celery, die eigene Telemetrie von BullMQ oder ein selbst gebauter Client. Fügen Sie `messaging.system` und `messaging.destination.name` hinzu und geben Sie den Spans die Art PRODUCER oder CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Ihr Name gehört zu denen, die OneUptime ignoriert (siehe [Was ignoriert wird](/docs/telemetry/queues#what-is-ignored)), oder nur SERVER-Spans nennen sie.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Weniger als 3 ihrer Spans sind in den letzten 15 Minuten eingetroffen, oder das Projekt hat sein [Budget für automatisches Anlegen](/docs/telemetry/queues#the-auto-create-budget) erreicht.",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Wenn ihre Spans sie doch nennen, legen Sie sie von Hand mit demselben System und Ziel an (**Warteschlangen → Warteschlange erstellen**): Ihr Tab **Traces** füllt sich aus den bereits gespeicherten Spans.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Siehe [Eine Warteschlange, die meine Anwendungen nutzen, wurde nicht angelegt](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) auf der Dokumentationsseite zu Warteschlangen.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Prüfen Sie das Log des Collectors. OneUptime lehnt einen falschen Aufnahmeschlüssel mit `401` ab (`422` bei einem deaktivierten Schlüssel oder einem Browser-Schlüssel), und der Collector protokolliert `Exporting failed` für jeden Batch, den er verwirft.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Die Daten sind verspätet. `aws_cloudwatch` wartet `delay` (10 Minuten), bis CloudWatch veröffentlicht, daher kommen seine Datenpunkte 11 bis 17 Minuten verspätet an.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Siehe [Der Broker-Zustand bleibt leer](/docs/telemetry/queues#broker-health-stays-empty) auf der Dokumentationsseite zu Warteschlangen.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Zwei Systeme nennen es: Ein Kafka-Client am Kafka-Endpunkt von Event Hubs meldet `kafka`, das Event Hubs SDK `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Eine Sichtung von Service Bus oder Event Hubs hat keinen Namespace: der Emulator oder eine eigene Domain.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ-Spans nennen meist den Exchange und die Metriken des Brokers die Warteschlange: zwei Warteschlangen in OneUptime, es sei denn, Exchange und Warteschlange tragen denselben Namen.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Archivieren Sie die, die Sie nicht wollen: Eine archivierte Warteschlange bleibt archiviert, und was sie nennt, legt keine neue mehr an.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Siehe [Zwei Warteschlangen für ein Ziel](/docs/telemetry/queues#two-queues-for-one-destination) auf der Dokumentationsseite zu Warteschlangen.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Ein pro Anfrage oder pro Consumer benanntes Ziel, das OneUptime nicht erkennt — ein numerisches Suffix, ein Hash —, erzeugt eine Warteschlange pro Name. UUIDs werden bereits zusammengefasst (siehe [Was ignoriert wird](/docs/telemetry/queues#what-is-ignored)). Markieren Sie solche Ziele in Ihrer Instrumentierung mit `messaging.destination.temporary=true` oder geben Sie ihnen einen stabilen Namen, und archivieren Sie dann die bereits angelegten Warteschlangen.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Siehe [Eine neue Warteschlange für jede Anfrage](/docs/telemetry/queues#a-new-queue-for-every-request) auf der Dokumentationsseite zu Warteschlangen.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet die SQS-Aufrufe des AWS SDK ohne Codeänderungen.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: das Paket `OpenTelemetry.Instrumentation.AWS` mit `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; sein Standard-Attributsatz nennt eine SQS-Warteschlange nur über ihre URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` oder `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), hinzugefügt mit `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Seine SQS-Spans tragen die Warteschlangen-URL in `server.address`, die OneUptime als Warteschlange liest.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lesen Sie die CloudWatch-Metriken der Warteschlangen mit dem `aws_cloudwatch`-Receiver des Collectors, oder streamen Sie sie über einen CloudWatch Metric Stream und Amazon Data Firehose an seinen `awsfirehose`-Receiver.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON-Stream: `approximatenumberofmessagesvisible`) | Sichtbare Nachrichten | Messwert |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON-Stream: `approximateageofoldestmessage`) | Alter der ältesten Nachricht | Messwert |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON-Stream: `approximatenumberofmessagesnotvisible`) | Nachrichten in Bearbeitung | Messwert |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON-Stream: `numberofmessagessent`) | Gesendete Nachrichten | Anzahl pro Zeitraum |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON-Stream: `numberofmessagesreceived`) | Empfangene Nachrichten | Anzahl pro Zeitraum |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON-Stream: `numberofmessagesdeleted`) | Gelöschte Nachrichten | Anzahl pro Zeitraum |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Spans nennen das System als `messaging.system` = `activemq` (ebenfalls akzeptiert: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet JMS-Clients — ActiveMQ, Artemis, IBM MQ und jeden anderen JMS-Broker — ohne Codeänderungen. JMS-Spans sagen `jms`, welcher Broker auch dahintersteht; eine ActiveMQ-Warteschlange wird über diese JMS-Familie zugeordnet, sodass die Spans ihrer Clients und die Metriken ihres Brokers in einer Warteschlange landen.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Der Collector hat keinen JMX-Receiver, führen Sie also den OpenTelemetry JMX Scraper mit `OTEL_JMX_TARGET_SYSTEM=activemq` neben einem ActiveMQ-Classic-Broker aus; er sendet die Zielmetriken des Brokers per OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Lassen Sie den Broker JMX-Verbindungen annehmen. Setzen Sie beim Image `apache/activemq-classic` oder dem Skript `bin/activemq` vor dem Start `ACTIVEMQ_SUNJMX_START`. Dieses Beispiel schaltet die Authentifizierung aus: Halten Sie den Port in einem privaten Netzwerk, oder schalten Sie `jmxremote.authenticate` mit einer Passwortdatei ein und geben Sie dem Scraper `OTEL_JMX_USERNAME` und `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Führen Sie den Scraper mit einer Java-Laufzeitumgebung dort aus, wo er diesen Port erreicht. Er sendet direkt an OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` behält die Metriknamen bei, die der Scraper seit 1.53.0-alpha verwendet (`activemq.message.queue.size`, mit dem Ziel in `messaging.destination.name`); OneUptime liest auch die älteren Namen (`activemq.message.current`, mit dem Ziel in `destination`). ActiveMQ Artemis hat andere MBeans, die diese Regeln nicht lesen.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Auch ein einzelner Datenpunkt einer Broker-Metrik, die eine Warteschlangenseite darstellt, legt ihre Warteschlange an. Metriken von Messaging-Clients und eigene Metriken, die `messaging.system` und `messaging.destination.name` tragen, legen nie eine Warteschlange an: Sie erscheinen im Tab **Metriken** einer bestehenden.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Warteschlangengröße | Messwert |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Warteschlangengröße (alte Namen) | Messwert |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Eingereiht | Zähler, als Rate pro Sekunde |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Entnommen | Zähler, als Rate pro Sekunde |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Abgelaufen | Zähler, als Rate pro Sekunde |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consumer | Messwert |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Durchschnittliche Zeit in der Warteschlange | Messwert |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Durchschnittliche Zeit in der Warteschlange (alte Namen) | Messwert |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Die Metrik nennt die Warteschlange anders als die Spans (siehe [Einschränkungen](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Spans nennen das System als `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet Kafka-Producer und -Consumer ohne Codeänderungen.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` mit dem Paket `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` tracet `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` oder `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: Die automatische Instrumentierung von OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, unter Linux) tracet Producer und Consumer von `segmentio/kafka-go` ohne Codeänderungen.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Der `kafka_metrics`-Receiver des Collectors liest den Lag der Consumer-Gruppen und die Partitions-Offsets von den Brokern; aktivieren Sie seine Scraper `topics` und `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Kommentieren Sie für einen Cluster mit SASL oder TLS `auth` und `tls` ein. Der Receiver nennt jedes Topic in `topic`, und so finden die Metriken die Warteschlange des Topics. Lag und committete Offsets einer Consumer-Gruppe meldet er nur für Topics, auf die die Gruppe einen Offset committet hat, und er überspringt Topics, deren Namen mit `_` beginnen.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Consumer-Lag | Messwert |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Partitions-Lag | Messwert |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Verbraucht | Zähler, als Rate pro Sekunde |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Produziert | Zähler, als Rate pro Sekunde |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka meldet den Lag einer Consumer-Gruppe erst, nachdem die Gruppe einen Offset committet hat. Der Receiver überspringt Topics, deren Namen mit `_` beginnen.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Spans nennen das System als `messaging.system` = `pulsar` (ebenfalls akzeptiert: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet Pulsar-Clients ohne Codeänderungen.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Jeder Broker stellt seine Topic- und Subscription-Metriken an seinem Webservice-Port bereit; scrapen Sie jeden Broker, denn ein Broker meldet nur die Topics, die er gerade besitzt.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar beschriftet jede Serie mit dem vollständigen Namen des Topics (`persistent://public/default/orders`) und die einer Partition mit dem der Partition: Partitionen summieren sich zu ihrem Topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Rückstand | Messwert |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Rückstand des Abonnements | Messwert |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Alter des Rückstands | Messwert |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Eingehende Nachrichten | Zähler, als Rate pro Sekunde |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Ausgehende Nachrichten | Zähler, als Rate pro Sekunde |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet RocketMQ-Clients ohne Codeänderungen.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Setzen Sie `metricsExporterType=PROM` in der `broker.conf` des Brokers, damit der Broker seine Lag- und Durchsatzmetriken bereitstellt.",
  "Then scrape every broker:": "Scrapen Sie dann jeden Broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Bereite Nachrichten | Messwert |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | An die Dead-Letter-Warteschlange gesendet | Zähler, als Rate pro Sekunde |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid-Warteschlangen erscheinen in OneUptime von selbst, aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor hat die Zustellungs- und Dead-Letter-Metriken der Topics, die der `azure_monitor`-Receiver des Collectors liest; sie werden noch auf keiner Warteschlangenseite dargestellt, erkunden Sie sie also unter Metriken.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Der Receiver meldet sich über die Erweiterung `azure_auth` an: Geben Sie dem Dienstprinzipal die Rolle **Monitoring Reader** für das Abonnement, und setzen Sie `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` und `AZURE_SUBSCRIPTION_ID` in der Umgebung des Collectors.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Metriken von Messaging-Clients und eigene Metriken, die `messaging.system` und `messaging.destination.name` tragen, legen nie eine Warteschlange an: Sie erscheinen im Tab **Metriken** einer bestehenden.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime zeigt für Azure Event Grid keine Broker-Metriken unter **Broker-Zustand**: Was der Collector oben sendet, kommt nur im **Metriken**-Explorer an. Eine Metrik, die `messaging.system` und `messaging.destination.name` an jedem Datenpunkt trägt, erscheint im Tab **Metriken** der Warteschlange.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid hat keine dargestellten Metriken. Seine Metriken stehen im **Metriken**-Explorer.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Das Azure SDK für Java tracet sich selbst, und der OpenTelemetry-Java-Agent verbindet dieses Tracing mit OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: Die OpenTelemetry-Spans des Azure SDK sind experimentell: Setzen Sie `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (oder den Schalter `Azure.Experimental.EnableActivitySource`) und abonnieren Sie die Azure-Quellen mit `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: Registrieren Sie `createAzureSdkInstrumentation()` aus `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: Installieren Sie `azure-core-tracing-opentelemetry` und setzen Sie `settings.tracing_implementation = "opentelemetry"` (aus `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Ein verbundenes Azure-Abonnement liest die wichtigsten Metriken des Namespace für jeden Event Hub, ohne dass etwas laufen muss. Um alle zu lesen, führen Sie den `azure_monitor`-Receiver des Collectors aus, der sie über die Dimension EntityName pro Event Hub aufteilt.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Der Receiver listet Ihre Namespaces einmal am Tag auf, daher kann es bis zu 24 Stunden dauern, bis ein neuer erscheint.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Eingehende Nachrichten | Anzahl pro Zeitraum |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Ausgehende Nachrichten | Anzahl pro Zeitraum |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Serverfehler | Anzahl pro Zeitraum |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Benutzerfehler | Anzahl pro Zeitraum |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Fehler wegen überschrittenem Kontingent | Anzahl pro Zeitraum |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Gedrosselte Anforderungen | Anzahl pro Zeitraum |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Größe | Messwert |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- Die Metrik nennt die Warteschlange anders als die Spans. Spans von Service Bus und Event Hubs ohne Namespace-Host landen in einer anderen Warteschlange als die Metriken von Azure Monitor (siehe [Einschränkungen](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor liefert 10 Warteschlangen pro Metrik und Namespace, sofern `maximum_number_of_records_per_resource` nicht erhöht wird. Die Konfiguration in Schritt 3 erhöht den Wert.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Der Receiver listet Ihre Namespaces einmal am Tag auf, daher kann es bis zu 24 Stunden dauern, bis ein neuer Namespace erscheint.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Ein verbundenes Azure-Abonnement liest die wichtigsten Metriken des Namespace für jede Warteschlange und jedes Topic, ohne dass etwas laufen muss. Um alle zu lesen, führen Sie den `azure_monitor`-Receiver des Collectors aus, der sie über die Dimension EntityName pro Warteschlange und Topic aufteilt.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Aktive Nachrichten | Messwert |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Unzustellbare Nachrichten | Messwert |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Geplante Nachrichten | Messwert |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Abgeschlossene Nachrichten | Anzahl pro Zeitraum |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Abgebrochene Nachrichten | Anzahl pro Zeitraum |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Sendelatenz des Servers | Messwert |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ-Warteschlangen erscheinen in OneUptime von selbst, aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "Die eigene Telemetrie von BullMQ — seine Option `telemetry`, die das Paket `bullmq-otel` implementiert — nennt die Warteschlange in `bullmq.queue.name` und setzt kein `messaging.system`, legt also allein keine Warteschlange an. Ein `transform`-Prozessor im Collector, an den Ihre Anwendungen senden, fügt die beiden Schlüssel, die OneUptime liest, zu den Spans hinzu, die Jobs hinzufügen und verarbeiten, und zu den eigenen Metriken von BullMQ:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Nur die PRODUCER-Spans, die Jobs hinzufügen, und die CONSUMER-Spans, die sie verarbeiten, werden gekennzeichnet: Die internen Spans von BullMQ nennen die Warteschlange zwar auch, sind aber keine Nachrichten. Richten Sie den OTLP-Exporter Ihrer Anwendungen auf diesen Collector aus.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ hält seine Jobs in Redis und hat keinen Broker zum Scrapen; melden Sie die Warteschlangentiefe aus der Anwendung als Metrik mit `messaging.system` und `messaging.destination.name`, wie es die eigenen Worker von OneUptime mit `queue.size` tun.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Erfassen Sie die Job-Anzahlen in der Anwendung; ein Messwert, der die beiden Schlüssel selbst trägt, braucht keine Transformation:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime zeigt für BullMQ keine Broker-Metriken unter **Broker-Zustand**. Alles, was ein Collector sendet, steht im **Metriken**-Explorer, und eine Metrik, die `messaging.system` und `messaging.destination.name` an jedem Datenpunkt trägt, erscheint im Tab **Metriken** der Warteschlange.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Ihre Spans nennen kein Messaging-System, das OneUptime erkennt: die Spans von Celery, die eigene Telemetrie von BullMQ oder ein selbst gebauter Client. Fügen Sie `messaging.system` und `messaging.destination.name` hinzu und geben Sie den Spans die Art PRODUCER oder CONSUMER. Für BullMQ erledigt das die Transformation in Schritt 2.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ hat keine dargestellten Metriken. Seine Metriken stehen im **Metriken**-Explorer.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: Der Client tracet sich selbst, sobald seine Builder `Publisher` und `Subscriber` eine OpenTelemetry-Instanz und den Tracing-Schalter bekommen — `setOpenTelemetry(GlobalOpenTelemetry.get())` und `setEnableOpenTelemetryTracing(true)`. Jeder der beiden Aufrufe allein tracet nichts.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: mit `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` und `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: mit `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Lesen Sie die Metriken der Topics und Subscriptions aus Cloud Monitoring mit dem `googlecloudmonitoring`-Receiver des Collectors, wobei Sie jeden Metriktyp unter `metrics_list` aufführen.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Der Receiver meldet sich mit Application Default Credentials an (`GOOGLE_APPLICATION_CREDENTIALS` oder das Dienstkonto, unter dem der Collector läuft), die die Rolle **Monitoring Viewer** für das Projekt benötigen. Setzen Sie `project_id` auf Ihr Projekt:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Ein Metriktyp, der in `metrics_list` fehlt, wird nie gelesen. Subscription-Metriken gehören zur Warteschlange der Subscription (`subscription_id`), Topic-Metriken zu der des Topics (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Nicht zugestellte Nachrichten | Messwert |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Alter der ältesten unbestätigten Nachricht | Messwert |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Unzustellbare Nachrichten | Anzahl pro Zeitraum |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Bestätigte Nachrichten | Anzahl pro Zeitraum |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Veröffentlichungsanforderungen | Anzahl pro Zeitraum |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- Die Metrik nennt die Warteschlange anders als die Spans. Ein Pub/Sub-Topic hat die Topic-Metriken und seine Subscriptions die Subscription-Metriken.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring liest nur die Typen in `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Die Daten sind verspätet. Die Metriken von Pub/Sub kommen Minuten zu spät an.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS-Warteschlangen erscheinen in OneUptime von selbst, aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS ist eine API, und ihre Spans nennen den Broker dahinter nicht; ist der Broker Apache ActiveMQ, führen Sie den OpenTelemetry JMX Scraper gegen ihn aus, und seine Metriken landen in derselben Warteschlange, die dann als ActiveMQ-Warteschlange angezeigt wird, während andere JMS-Broker wie IBM MQ keinen fertigen Weg für Metriken haben.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Seine Metriken landen in derselben Warteschlange wie die JMS-Spans, die von da an als Apache ActiveMQ-Warteschlange angezeigt wird.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime zeigt für JMS keine Broker-Metriken unter **Broker-Zustand**. Alles, was ein Collector sendet, steht im **Metriken**-Explorer, und eine Metrik, die `messaging.system` und `messaging.destination.name` an jedem Datenpunkt trägt, erscheint im Tab **Metriken** der Warteschlange.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Sobald die Metriken eines Apache ActiveMQ-Brokers eintreffen, wird die Warteschlange als Apache ActiveMQ-Warteschlange angezeigt und stellt sie unter **Broker-Zustand** dar: siehe [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Andere JMS-Broker als ActiveMQ haben keine dargestellten Metriken. Ihre Metriken stehen im **Metriken**-Explorer. Für einen ActiveMQ-Broker siehe **Wenn der Broker Apache ActiveMQ ist** unter **Erweitert**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS-Warteschlangen erscheinen in OneUptime von selbst, aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet NATS-Clients — seine NATS-Instrumentierung meldet `messaging.system` = `nats` — ohne Codeänderungen.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Führen Sie prometheus-nats-exporter mit `-jsz=all` gegen den Monitoring-Port des Servers aus. Seine JetStream-Metriken gelten pro Stream und Consumer, nicht pro Subject, und gehören daher nicht zu Warteschlangen auf Subject-Ebene.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Schalten Sie den Monitoring-Port des Servers mit `-m 8222` ein (oder `http_port: 8222` in seiner Konfiguration), und führen Sie dann den Exporter aus:",
  "And scrape it:": "Und scrapen Sie ihn:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime zeigt für NATS keine Broker-Metriken unter **Broker-Zustand**: Was der Collector oben sendet, kommt nur im **Metriken**-Explorer an. Eine Metrik, die `messaging.system` und `messaging.destination.name` an jedem Datenpunkt trägt, erscheint im Tab **Metriken** der Warteschlange.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS hat keine dargestellten Metriken. Seine Metriken stehen im **Metriken**-Explorer.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ-Warteschlangen erscheinen in OneUptime von selbst, aus zwei Quellen: den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihnen konsumieren, und den eigenen Metriken des Brokers. Sie können eine auch von Hand hinzufügen: **Warteschlangen → Warteschlange erstellen**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: Der OpenTelemetry-Java-Agent tracet RabbitMQ-Clients ohne Codeänderungen.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 tracet sich selbst: Abonnieren Sie `RabbitMQ.Client.*`. Auch MassTransit tracet sich selbst: Abonnieren Sie `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` oder `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Der `rabbitmq`-Receiver des Collectors liest Tiefe, Consumer und Nachrichtenraten jeder Warteschlange aus der HTTP-API des Management-Plugins, als Benutzer mit dem Tag `monitoring` und Zugriff auf jeden virtuellen Host.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Aktivieren Sie das Management-Plugin und legen Sie diesen Benutzer an. Das Tag `monitoring` allein zeigt ihm keine Warteschlange: Geben Sie ihm Zugriff auf jeden zu überwachenden virtuellen Host. Leere Muster gewähren diesen Zugriff ohne jedes Recht zum Konfigurieren, Veröffentlichen oder Konsumieren:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Setzen Sie `RABBITMQ_USERNAME` und `RABBITMQ_PASSWORD` in der Umgebung des Collectors. Der Receiver meldet jede Warteschlange unter ihrem RabbitMQ-Namen, während die Spans der meisten Instrumentierungen den Exchange nennen, über den eine Nachricht lief: Beide treffen sich bei Nachrichten über den Standard-Exchange, dessen Routing-Key der Name der Warteschlange ist.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Warteschlangentiefe | Messwert |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Veröffentlicht | Zähler, als Rate pro Sekunde |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Zugestellt | Zähler, als Rate pro Sekunde |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Bestätigt | Zähler, als Rate pro Sekunde |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Verworfen | Zähler, als Rate pro Sekunde |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- Die Metrik nennt die Warteschlange anders als die Spans. RabbitMQ-Spans nennen meist den Exchange, während die Metriken des Brokers Warteschlangen beschreiben. Beide treffen sich bei Nachrichten über den Standard-Exchange, dessen Routing-Key der Name der Warteschlange ist.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ meldet nur die Warteschlangen der virtuellen Hosts, auf die sein Benutzer Zugriff hat, und protokolliert für den Rest keinen Fehler. Die Zähler von RabbitMQ erscheinen mit der ersten Aktivität.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Amazon SNS-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` wartet, bis CloudWatch einen Zeitraum veröffentlicht, daher kommen die Broker-Metriken dieser Warteschlange mit dieser Konfiguration 11 bis 17 Minuten verspätet an: Ein Monitor darüber braucht ein längeres Zeitfenster (siehe **Verspätete Metriken** unter [Warnungen](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Senden Sie ein paar Nachrichten durch `orders`. Jeder Span, der diese Warteschlange nennt, wird beim Aufnehmen durch OneUptime mit ihr markiert: Die Spans füllen die **Übersicht** — veröffentlichte und konsumierte Nachrichten, Fehler und Verarbeitungszeit sowie die Dienste unter **Producer** und **Consumer** — und den Tab **Traces**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Broker-Zustand** in der Übersicht füllt sich aus den Metriken des Brokers, sobald sie eintreffen: Mit der Konfiguration in Schritt 3 kommen die von CloudWatch 11 bis 17 Minuten verspätet an.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "Der Kopfbereich zeigt **Kürzlich gesehen**, sobald die Erkennung Spans oder Broker-Metriken findet, die diese Warteschlange nennen. Sie läuft alle 10 Minuten über die Telemetrie der letzten 15 Minuten und über die Cloud-Monitoring-Metriken der letzten 60 Minuten, die verspätet ankommen.",
  "Names are compared without regard to case.":
    "Namen werden ohne Rücksicht auf Groß- und Kleinschreibung verglichen.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `aws.sns` (oder `aws_sns`, `amazonsns` oder `sns`) und das Ziel `orders` — in `messaging.destination.name` oder einem älteren Schlüssel wie `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Broker-Metriken**: `Dimensions.TopicName` oder `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Amazon SQS-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Apache ActiveMQ-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Broker-Zustand** in der Übersicht füllt sich aus den Metriken des Brokers, sobald sie eintreffen.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "Der Kopfbereich zeigt **Kürzlich gesehen**, sobald die Erkennung Spans oder Broker-Metriken findet, die diese Warteschlange nennen. Sie läuft alle 10 Minuten über die Telemetrie der letzten 15 Minuten.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- Die Spans von JMS-Clients sagen `jms`, welcher Broker auch dahintersteht, daher landen sie und die Metriken des Apache ActiveMQ-Brokers in dieser einen Warteschlange.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "Der JMX-Host ist aus der Broker-Adresse vorausgefüllt, die die Telemetrie dieser Warteschlange meldet (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Apache Kafka-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `kafka` und das Ziel `orders` — in `messaging.destination.name` oder einem älteren Schlüssel wie `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Broker-Metriken**: `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Kommentieren Sie für einen Cluster mit SASL oder TLS `auth` und `tls` ein. Der Bootstrap-Broker ist aus der Broker-Adresse vorausgefüllt, die die Telemetrie dieser Warteschlange meldet (`broker-1.example.com:9092`); ändern Sie ihn, wenn der Collector den Broker auf anderem Weg erreicht. Der Receiver nennt jedes Topic in `topic`, und so finden die Metriken die Warteschlange des Topics. Lag und committete Offsets einer Consumer-Gruppe meldet er nur für Topics, auf die die Gruppe einen Offset committet hat, und er überspringt Topics, deren Namen mit `_` beginnen.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Apache Pulsar-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `pulsar` (oder `apache_pulsar`) und das Ziel `orders` — in `messaging.destination.name` oder einem älteren Schlüssel wie `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Apache RocketMQ-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Dies ist die Azure Event Grid-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` tragen. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` an jedem Datenpunkt tragen, erscheinen in ihrem Tab **Metriken**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "Der Kopfbereich zeigt **Kürzlich gesehen**, sobald die Erkennung Spans oder Metriken von Messaging-Clients findet, die diese Warteschlange nennen. Sie läuft alle 10 Minuten über die Telemetrie der letzten 15 Minuten.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Azure Event Hubs-Warteschlange `orders` im Namespace `orders-ns`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Spans**: `messaging.system` = `eventhubs` (oder `azure_eventhubs`, `azure.eventhubs` oder `microsoft.eventhub`) und das Ziel `orders` — in `messaging.destination.name` oder einem älteren Schlüssel wie `messaging.destination`, von einem SDK, das mit `orders-ns.servicebus.windows.net` verbunden ist.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Broker-Metriken**: `metadata_entityname` = `orders`, im Namespace, dessen `name` `orders-ns` ist.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Azure Service Bus-Warteschlange `orders` im Namespace `orders-ns`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Dies ist die BullMQ-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` tragen. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die Google Cloud Pub/Sub-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Dies ist die JMS-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` tragen. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Seine Metriken landen in dieser Warteschlange, die von da an als Apache ActiveMQ-Warteschlange angezeigt wird.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Dies ist die NATS-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` tragen. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Dies ist die RabbitMQ-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus den eigenen Metriken des Brokers. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Setzen Sie `RABBITMQ_USERNAME` und `RABBITMQ_PASSWORD` in der Umgebung des Collectors. Der Host des Management-Endpunkts ist aus der Broker-Adresse vorausgefüllt, die die Telemetrie dieser Warteschlange meldet (`broker-1.example.com:9092`); ändern Sie ihn, wenn der Collector den Broker auf anderem Weg erreicht. Der Receiver meldet jede Warteschlange unter ihrem RabbitMQ-Namen, während die Spans der meisten Instrumentierungen den Exchange nennen, über den eine Nachricht lief: Beide treffen sich bei Nachrichten über den Standard-Exchange, dessen Routing-Key der Name der Warteschlange ist.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Dies ist die `acme-bus`-Warteschlange `orders`. Sie füllt sich aus den Messaging-Spans der Anwendungen, die an sie veröffentlichen und aus ihr konsumieren, und aus Metriken, die ihr `messaging.system` und ihren `messaging.destination.name` tragen. Alles unten ist für diese Warteschlange vorausgefüllt.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime kennt dieses Messaging-System nicht und hat daher keinen fertigen Weg, die Metriken des Brokers zu lesen; senden Sie sie mit `messaging.system` und `messaging.destination.name` an jedem Datenpunkt, dann gehören sie zur Warteschlange.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime zeigt für `acme-bus` keine Broker-Metriken unter **Broker-Zustand**. Alles, was ein Collector sendet, steht im **Metriken**-Explorer, und eine Metrik, die `messaging.system` und `messaging.destination.name` an jedem Datenpunkt trägt, erscheint im Tab **Metriken** der Warteschlange.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Nur die eigenen Metriken des Brokers brauchen ein System, das OneUptime kennt (siehe [Unterstützte Messaging-Systeme](/docs/telemetry/queues#supported-messaging-systems)). Seine Metriken stehen im **Metriken**-Explorer.",
};

export default TRANSLATION;
