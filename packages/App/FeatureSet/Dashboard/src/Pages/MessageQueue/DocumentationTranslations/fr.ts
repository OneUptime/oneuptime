import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Amazon SNS apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Les spans nomment le système par `messaging.system` = `aws.sns` (également accepté : `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Les files viennent des spans de messagerie que votre instrumentation OpenTelemetry produit déjà ; rien de propre à OneUptime n'est nécessaire.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les appels SNS du SDK AWS sans modification du code.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET** : le package `OpenTelemetry.Instrumentation.AWS`, avec `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` ; son jeu d'attributs par défaut ne nomme aucun topic SNS.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js** : `@opentelemetry/auto-instrumentations-node` trace le SDK AWS.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python** : le package `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go** : `otelaws`, ajouté avec `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Tout autre client** : utilisez la prise en charge d'OpenTelemetry propre à la bibliothèque cliente, ou définissez `messaging.system` = `aws.sns`, `messaging.destination.name` et le type de span (PRODUCER à la publication, CONSUMER à la consommation) sur les spans autour de vos envois et de vos gestionnaires.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Pointez ensuite l'exportateur OTLP vers OneUptime. La plupart des SDK et des agents lisent ces variables d'environnement :",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Ce jeton est un secret.** Utilisez une clé d'ingestion **Serveur**, conservée dans les secrets\n> de votre déploiement. Ne mettez jamais une clé Serveur dans du JavaScript de navigateur — une clé\n> d'ingestion **Navigateur** existe pour cela.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lisez les métriques CloudWatch des topics avec le récepteur `aws_cloudwatch` du collecteur, ou diffusez-les via un CloudWatch Metric Stream et Amazon Data Firehose vers son récepteur `awsfirehose`.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "Le récepteur `aws_cloudwatch` interroge l'API `GetMetricData` de CloudWatch avec les identifiants par défaut du SDK AWS (environnement, profil partagé ou rôle d'instance), qui ont besoin de `cloudwatch:ListMetrics` et `cloudwatch:GetMetricData` :",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Laissez `stats` non défini.** Sans lui, chaque métrique arrive sous forme d'un résumé par période, ce que lit OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` doit être défini, et plafonne les métriques lues à chaque collecte.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` attend que CloudWatch publie une période ; avec cette configuration, les métriques de broker d'une file arrivent donc avec 11 à 17 minutes de retard : un moniteur sur ces métriques a besoin d'une fenêtre plus longue (voir **Métriques en retard** sous [Alertes](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Un récepteur lit une région et un espace de noms : ajoutez une instance par région.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Pour diffuser plutôt les métriques — un CloudWatch Metric Stream via Amazon Data Firehose vers le récepteur `awsfirehose` du collecteur —, voir [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Envoyez quelques messages dans vos files. Toutes les 10 minutes, OneUptime lit les spans des 15 dernières minutes et liste, sous **Files d'attente**, chaque destination qu'au moins 3 d'entre eux nomment (spans de tout type sauf SERVER). Sur un OneUptime auto-hébergé, `MESSAGE_QUEUE_MIN_SPANS` définit ce nombre.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Un seul point de données d'une métrique de broker qu'affiche une page de file crée aussi sa file : les métriques de supervision cloud arrivent en retard, donc chaque exécution les lit sur les 60 dernières minutes. Les métriques des clients de messagerie, et vos propres métriques qui portent `messaging.system` et `messaging.destination.name`, ne créent jamais de file : elles s'affichent dans l'onglet **Métriques** d'une file existante.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Les files ne sont créées d'elles-mêmes que tant que le projet reste sous son [budget de création automatique](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "La Vue d'ensemble de la file affiche ces métriques sous **Santé du broker**, et chaque jauge et chaque nombre par période a **Créer un moniteur**. Tant qu'aucune n'est arrivée, la section indique d'où elles viennent.",
  "| Metric | Shown as | Type |": "| Métrique | Affichée comme | Type |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (flux JSON : `numberofmessagespublished`) | Messages publiés | Nombre par période |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (flux JSON : `numberofnotificationsdelivered`) | Notifications livrées | Nombre par période |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (flux JSON : `numberofnotificationsfailed`) | Notifications en échec | Nombre par période |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (flux JSON : `numberofnotificationsredriventodlq`) | Redirigés vers la file de lettres mortes | Nombre par période |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Ses spans ne nomment aucun système de messagerie que OneUptime sait reconnaître : les spans de Celery, la télémétrie propre de BullMQ ou un client fait maison. Ajoutez `messaging.system` et `messaging.destination.name`, et donnez aux spans le type PRODUCER ou CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Son nom fait partie de ceux que OneUptime ignore (voir [Ce qui est ignoré](/docs/telemetry/queues#what-is-ignored)), ou seuls des spans SERVER la nomment.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Moins de 3 de ses spans sont arrivés dans les 15 dernières minutes, ou le projet a atteint son [budget de création automatique](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Quand ses spans la nomment bien, créez-la à la main avec le même système et la même destination (**Files d'attente → Créer : File d'attente**) : son onglet **Traces** se remplit à partir des spans déjà stockés.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Voir [Une file qu'utilisent mes applications n'a pas été créée](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) sur la page de documentation des files d'attente.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Consultez le journal du collecteur. OneUptime refuse une mauvaise clé d'ingestion avec `401` (`422` pour une clé désactivée ou une clé Navigateur), et le collecteur journalise `Exporting failed` pour chaque lot qu'il abandonne.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Elles sont en retard. `aws_cloudwatch` attend `delay` (10 minutes) que CloudWatch publie, si bien que ses points arrivent avec 11 à 17 minutes de retard.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Voir [La santé du broker reste vide](/docs/telemetry/queues#broker-health-stays-empty) sur la page de documentation des files d'attente.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Deux systèmes la nomment : un client Kafka sur le point de terminaison Kafka d'Event Hubs rapporte `kafka`, le SDK Event Hubs `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Une observation Service Bus ou Event Hubs n'a pas d'espace de noms : l'émulateur ou un domaine personnalisé.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- Les spans RabbitMQ nomment généralement l'exchange, et les métriques du broker la file : deux files dans OneUptime, sauf si l'exchange et la file portent le même nom.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Archivez celle dont vous ne voulez pas : une file archivée reste archivée, et ce qui la nomme n'en crée plus de nouvelle.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Voir [Deux files pour une seule destination](/docs/telemetry/queues#two-queues-for-one-destination) sur la page de documentation des files d'attente.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Une destination nommée par requête ou par consommateur que OneUptime ne reconnaît pas — un suffixe numérique, un hachage — crée une file par nom. Les UUID sont déjà regroupés (voir [Ce qui est ignoré](/docs/telemetry/queues#what-is-ignored)). Marquez ces destinations avec `messaging.destination.temporary=true` dans votre instrumentation, ou donnez-leur un nom stable, puis archivez les files déjà créées.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Voir [Une nouvelle file pour chaque requête](/docs/telemetry/queues#a-new-queue-for-every-request) sur la page de documentation des files d'attente.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Amazon SQS apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les appels SQS du SDK AWS sans modification du code.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET** : le package `OpenTelemetry.Instrumentation.AWS`, avec `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)` ; son jeu d'attributs par défaut ne nomme une file SQS que par son URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python** : `opentelemetry-instrumentation-botocore`, ou `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go** : `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), ajouté avec `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Ses spans SQS portent l'URL de la file dans `server.address`, que OneUptime lit comme la file.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lisez les métriques CloudWatch des files avec le récepteur `aws_cloudwatch` du collecteur, ou diffusez-les via un CloudWatch Metric Stream et Amazon Data Firehose vers son récepteur `awsfirehose`.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (flux JSON : `approximatenumberofmessagesvisible`) | Messages visibles | Jauge |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (flux JSON : `approximateageofoldestmessage`) | Âge du plus ancien message | Jauge |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (flux JSON : `approximatenumberofmessagesnotvisible`) | Messages en transit | Jauge |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (flux JSON : `numberofmessagessent`) | Messages envoyés | Nombre par période |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (flux JSON : `numberofmessagesreceived`) | Messages reçus | Nombre par période |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (flux JSON : `numberofmessagesdeleted`) | Messages supprimés | Nombre par période |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Apache ActiveMQ apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Les spans nomment le système par `messaging.system` = `activemq` (également accepté : `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java** : l'agent Java OpenTelemetry trace les clients JMS — ActiveMQ, Artemis, IBM MQ et tous les autres brokers JMS — sans modification du code. Les spans JMS disent `jms` quel que soit le broker derrière eux ; une file ActiveMQ est rattachée à cette famille JMS, si bien que les spans de ses clients et les métriques de son broker arrivent sur une seule file.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Le collecteur n'a pas de récepteur JMX ; exécutez donc l'OpenTelemetry JMX Scraper avec `OTEL_JMX_TARGET_SYSTEM=activemq` à côté d'un broker ActiveMQ Classic ; il pousse les métriques de destination du broker en OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Laissez le broker accepter les connexions JMX. Avec l'image `apache/activemq-classic` ou le script `bin/activemq`, définissez `ACTIVEMQ_SUNJMX_START` avant de le démarrer. Cet exemple désactive l'authentification : gardez le port sur un réseau privé, ou activez `jmxremote.authenticate` avec un fichier de mots de passe et donnez au scraper `OTEL_JMX_USERNAME` et `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Exécutez le scraper là où il peut joindre ce port, avec un environnement d'exécution Java. Il envoie directement à OneUptime :",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` conserve les noms de métriques que le scraper utilise depuis 1.53.0-alpha (`activemq.message.queue.size`, avec la destination dans `messaging.destination.name`) ; OneUptime lit aussi les anciens noms (`activemq.message.current`, avec la destination dans `destination`). ActiveMQ Artemis a d'autres MBeans, que ces règles ne lisent pas.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Un seul point de données d'une métrique de broker qu'affiche une page de file crée aussi sa file. Les métriques des clients de messagerie, et vos propres métriques qui portent `messaging.system` et `messaging.destination.name`, ne créent jamais de file : elles s'affichent dans l'onglet **Métriques** d'une file existante.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Taille de la file | Jauge |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Taille de la file (anciens noms) | Jauge |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Mis en file | Compteur, affiché par seconde |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Retirés de la file | Compteur, affiché par seconde |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Expiré | Compteur, affiché par seconde |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consommateurs | Jauge |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Temps moyen dans la file | Jauge |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Temps moyen dans la file (anciens noms) | Jauge |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La métrique nomme la file autrement que les spans (voir [Limites](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Apache Kafka apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Les spans nomment le système par `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les producteurs et consommateurs Kafka sans modification du code.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET** : `Confluent.Kafka` avec le package `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js** : `@opentelemetry/auto-instrumentations-node` trace `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python** : `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` ou `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go** : l'auto-instrumentation OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, sous Linux) trace les producteurs et consommateurs `segmentio/kafka-go` sans modification du code.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Le récepteur `kafka_metrics` du collecteur lit le retard des groupes de consommateurs et les offsets des partitions auprès des brokers ; activez ses scrapers `topics` et `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Pour un cluster avec SASL ou TLS, décommentez `auth` et `tls`. Le récepteur nomme chaque topic dans `topic`, et c'est ainsi que les métriques trouvent la file du topic. Il ne rapporte le retard et les offsets validés d'un groupe de consommateurs que pour les topics sur lesquels le groupe a validé un offset, et ignore les topics dont le nom commence par `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Retard des consommateurs | Jauge |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Retard de partition | Jauge |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Consommé | Compteur, affiché par seconde |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Produits | Compteur, affiché par seconde |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka ne rapporte le retard d'un groupe de consommateurs qu'après que le groupe a validé un offset. Le récepteur ignore les topics dont le nom commence par `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Apache Pulsar apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Les spans nomment le système par `messaging.system` = `pulsar` (également accepté : `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les clients Pulsar sans modification du code.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Chaque broker sert ses métriques de topics et d'abonnements sur le port de son service web ; collectez chaque broker, car un broker ne rapporte que les topics qu'il possède à ce moment-là.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar étiquette chaque série avec le nom complet du topic (`persistent://public/default/orders`), et celles d'une partition avec celui de la partition : les partitions s'additionnent dans leur topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Messages en attente | Jauge |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Messages en attente de l'abonnement | Jauge |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Âge des messages en attente | Jauge |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Messages entrants | Compteur, affiché par seconde |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Messages sortants | Compteur, affiché par seconde |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Apache RocketMQ apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les clients RocketMQ sans modification du code.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Définissez `metricsExporterType=PROM` dans le `broker.conf` du broker pour que le broker serve ses métriques de retard et de débit.",
  "Then scrape every broker:": "Puis collectez chaque broker :",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Messages prêts | Jauge |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Envoyés à la file de lettres mortes | Compteur, affiché par seconde |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Azure Event Grid apparaissent d'elles-mêmes dans OneUptime, à partir des spans de messagerie des applications qui y publient et en consomment. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor dispose des métriques de livraison et de lettres mortes des topics, que lit le récepteur `azure_monitor` du collecteur ; elles ne sont pas encore affichées sur une page de file, explorez-les donc sous Métriques.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "Le récepteur se connecte via l'extension `azure_auth` : donnez au principal de service le rôle **Monitoring Reader** sur l'abonnement, et définissez `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` et `AZURE_SUBSCRIPTION_ID` dans l'environnement du collecteur.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Les métriques des clients de messagerie, et vos propres métriques qui portent `messaging.system` et `messaging.destination.name`, ne créent jamais de file : elles s'affichent dans l'onglet **Métriques** d'une file existante.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime n'affiche aucune métrique de broker pour Azure Event Grid sous **Santé du broker** : ce qu'envoie le collecteur ci-dessus n'arrive que dans l'explorateur **Métriques**. Une métrique qui porte `messaging.system` et `messaging.destination.name` sur chaque point de données s'affiche dans l'onglet **Métriques** de la file.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid n'a aucune métrique affichée. Ses métriques se trouvent dans l'explorateur **Métriques**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Azure Event Hubs apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java** : le SDK Azure pour Java se trace lui-même, et l'agent Java OpenTelemetry relie ce traçage à OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET** : les spans OpenTelemetry du SDK Azure sont expérimentaux : définissez `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (ou l\'interrupteur `Azure.Experimental.EnableActivitySource`) et abonnez-vous aux sources Azure avec `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js** : enregistrez `createAzureSdkInstrumentation()` depuis `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python** : installez `azure-core-tracing-opentelemetry` et définissez `settings.tracing_implementation = "opentelemetry"` (depuis `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Un abonnement Azure connecté lit les métriques clés de l'espace de noms pour chaque event hub, sans rien à exécuter. Pour les lire toutes, exécutez le récepteur `azure_monitor` du collecteur, qui les répartit par event hub selon la dimension EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "Le récepteur liste vos espaces de noms une fois par jour, si bien qu'un nouvel espace de noms peut mettre jusqu'à 24 heures à apparaître.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Messages entrants | Nombre par période |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Messages sortants | Nombre par période |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Erreurs serveur | Nombre par période |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Erreurs utilisateur | Nombre par période |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Erreurs de quota dépassé | Nombre par période |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Requêtes limitées | Nombre par période |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Taille | Jauge |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La métrique nomme la file autrement que les spans. Les spans Service Bus et Event Hubs sans hôte d'espace de noms sont sur une autre file que les métriques d'Azure Monitor (voir [Limites](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor renvoie 10 files par métrique et par espace de noms, sauf si `maximum_number_of_records_per_resource` est relevé. La configuration de l'étape 3 le relève.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- Le récepteur liste vos espaces de noms une fois par jour, si bien qu'un nouvel espace de noms peut mettre jusqu'à 24 heures à apparaître.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Azure Service Bus apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Un abonnement Azure connecté lit les métriques clés de l'espace de noms pour chaque file et chaque topic, sans rien à exécuter. Pour les lire toutes, exécutez le récepteur `azure_monitor` du collecteur, qui les répartit par file et par topic selon la dimension EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Messages actifs | Jauge |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Messages en lettre morte | Jauge |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Messages planifiés | Jauge |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Messages terminés | Nombre par période |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Messages abandonnés | Nombre par période |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Latence d'envoi du serveur | Jauge |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Les files BullMQ apparaissent d'elles-mêmes dans OneUptime, à partir des spans de messagerie des applications qui y publient et en consomment. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "La télémétrie propre de BullMQ — son option `telemetry`, qu'implémente le package `bullmq-otel` — nomme la file dans `bullmq.queue.name` et ne définit pas de `messaging.system` ; seule, elle ne crée donc aucune file. Un processeur `transform` dans le collecteur auquel vos applications envoient ajoute les deux clés que lit OneUptime, sur les spans qui ajoutent et traitent des jobs et sur les métriques propres de BullMQ :",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Seuls les spans PRODUCER qui ajoutent des jobs et les spans CONSUMER qui les traitent sont étiquetés : les spans internes de BullMQ nomment aussi la file, mais ne sont pas des messages. Pointez l'exportateur OTLP de vos applications vers ce collecteur.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ garde ses jobs dans Redis et n'a pas de broker à collecter ; rapportez la profondeur de la file depuis l'application sous forme de métrique portant `messaging.system` et `messaging.destination.name`, comme le font les propres workers de OneUptime avec `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Observez le nombre de jobs dans l'application ; une jauge qui porte elle-même les deux clés n'a pas besoin de transformation :",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime n'affiche aucune métrique de broker pour BullMQ sous **Santé du broker**. Tout ce qu'envoie un collecteur se trouve dans l'explorateur **Métriques**, et une métrique qui porte `messaging.system` et `messaging.destination.name` sur chaque point de données s'affiche dans l'onglet **Métriques** de la file.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Ses spans ne nomment aucun système de messagerie que OneUptime sait reconnaître : les spans de Celery, la télémétrie propre de BullMQ ou un client fait maison. Ajoutez `messaging.system` et `messaging.destination.name`, et donnez aux spans le type PRODUCER ou CONSUMER. Pour BullMQ, la transformation de l'étape 2 s'en charge.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ n'a aucune métrique affichée. Ses métriques se trouvent dans l'explorateur **Métriques**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files Google Cloud Pub/Sub apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java** : le client se trace lui-même dès que ses builders `Publisher` et `Subscriber` reçoivent une instance OpenTelemetry et l'interrupteur de traçage — `setOpenTelemetry(GlobalOpenTelemetry.get())` et `setEnableOpenTelemetryTracing(true)`. L'un de ces appels seul ne trace rien.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js** : avec `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python** : `PublisherOptions(enable_open_telemetry_tracing=True)` et `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go** : avec `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Lisez les métriques des topics et des abonnements depuis Cloud Monitoring avec le récepteur `googlecloudmonitoring` du collecteur, en listant chaque type de métrique sous `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "Le récepteur se connecte avec les Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, ou le compte de service sous lequel tourne le collecteur), qui ont besoin du rôle **Monitoring Viewer** sur le projet. Définissez `project_id` sur votre projet :",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Un type de métrique absent de `metrics_list` n'est jamais lu. Les métriques d'abonnement se rattachent à la file de l'abonnement (`subscription_id`), les métriques de topic à celle du topic (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Messages non livrés | Jauge |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Âge du plus ancien message non acquitté | Jauge |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Messages en lettre morte | Nombre par période |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Messages acquittés | Nombre par période |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Requêtes de publication | Nombre par période |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- La métrique nomme la file autrement que les spans. Un topic Pub/Sub a les métriques de topic, et ses abonnements les métriques d'abonnement.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring ne lit que les types listés dans `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Elles sont en retard. Les métriques de Pub/Sub arrivent avec quelques minutes de retard.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Les files JMS apparaissent d'elles-mêmes dans OneUptime, à partir des spans de messagerie des applications qui y publient et en consomment. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS est une API, et ses spans ne nomment pas le broker qui se trouve derrière ; quand le broker est Apache ActiveMQ, exécutez l'OpenTelemetry JMX Scraper contre lui et ses métriques rejoignent la même file, qui s'affiche alors comme une file ActiveMQ, tandis que les autres brokers JMS comme IBM MQ n'ont pas de chemin de métriques prêt à l'emploi.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Ses métriques rejoignent la même file que les spans JMS, qui s'affiche dès lors comme une file Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime n'affiche aucune métrique de broker pour JMS sous **Santé du broker**. Tout ce qu'envoie un collecteur se trouve dans l'explorateur **Métriques**, et une métrique qui porte `messaging.system` et `messaging.destination.name` sur chaque point de données s'affiche dans l'onglet **Métriques** de la file.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Dès que les métriques d'un broker Apache ActiveMQ arrivent, la file s'affiche comme une file Apache ActiveMQ et les affiche sous **Santé du broker** : voir [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Les brokers JMS autres qu'ActiveMQ n'ont aucune métrique affichée. Leurs métriques se trouvent dans l'explorateur **Métriques**. Pour un broker ActiveMQ, voir **Si le broker est Apache ActiveMQ** sous **Avancé**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Les files NATS apparaissent d'elles-mêmes dans OneUptime, à partir des spans de messagerie des applications qui y publient et en consomment. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les clients NATS — son instrumentation NATS rapporte `messaging.system` = `nats` — sans modification du code.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Exécutez prometheus-nats-exporter avec `-jsz=all` contre le port de supervision du serveur. Ses métriques JetStream sont par stream et par consommateur, pas par sujet, elles ne se rattachent donc pas aux files au niveau des sujets.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Activez le port de supervision du serveur avec `-m 8222` (ou `http_port: 8222` dans sa configuration), puis exécutez l'exportateur :",
  "And scrape it:": "Et collectez-le :",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime n'affiche aucune métrique de broker pour NATS sous **Santé du broker** : ce qu'envoie le collecteur ci-dessus n'arrive que dans l'explorateur **Métriques**. Une métrique qui porte `messaging.system` et `messaging.destination.name` sur chaque point de données s'affiche dans l'onglet **Métriques** de la file.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS n'a aucune métrique affichée. Ses métriques se trouvent dans l'explorateur **Métriques**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Les files RabbitMQ apparaissent d'elles-mêmes dans OneUptime, à partir de deux sources : les spans de messagerie des applications qui y publient et en consomment, et les métriques propres du broker. Vous pouvez aussi en ajouter une à la main : **Files d'attente → Créer : File d'attente**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java** : l'agent Java OpenTelemetry trace les clients RabbitMQ sans modification du code.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET** : `RabbitMQ.Client` 7 se trace lui-même : abonnez-vous à `RabbitMQ.Client.*`. MassTransit se trace lui-même aussi : abonnez-vous à `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python** : `opentelemetry-instrumentation-pika` ou `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Le récepteur `rabbitmq` du collecteur lit la profondeur, les consommateurs et les débits de messages de chaque file depuis l'API HTTP du plugin de gestion, en tant qu'utilisateur portant le tag `monitoring` et ayant accès à chaque hôte virtuel.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Activez le plugin de gestion et créez cet utilisateur. Le tag `monitoring` seul ne lui montre aucune file : donnez-lui accès à chaque hôte virtuel à surveiller. Des motifs vides accordent cet accès sans aucun droit de configurer, de publier ou de consommer :",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Définissez `RABBITMQ_USERNAME` et `RABBITMQ_PASSWORD` dans l'environnement du collecteur. Le récepteur rapporte chaque file sous son nom RabbitMQ, alors que les spans de la plupart des instrumentations nomment l'exchange par lequel un message est passé : les deux se rejoignent pour les messages envoyés via l'exchange par défaut, dont la clé de routage est le nom de la file.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Profondeur de la file | Jauge |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Publié | Compteur, affiché par seconde |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Livrés | Compteur, affiché par seconde |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Pris en compte | Compteur, affiché par seconde |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Abandonné | Compteur, affiché par seconde |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- La métrique nomme la file autrement que les spans. Les spans RabbitMQ nomment généralement l'exchange, alors que les métriques du broker décrivent des files. Les deux se rejoignent pour les messages envoyés via l'exchange par défaut, dont la clé de routage est le nom de la file.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ ne rapporte que les files des hôtes virtuels auxquels son utilisateur a accès, et ne journalise aucune erreur pour les autres. Les compteurs de RabbitMQ apparaissent avec la première activité.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Amazon SNS `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` attend que CloudWatch publie une période ; avec cette configuration, les métriques de broker de cette file arrivent donc avec 11 à 17 minutes de retard : un moniteur sur ces métriques a besoin d'une fenêtre plus longue (voir **Métriques en retard** sous [Alertes](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Envoyez quelques messages dans `orders`. Chaque span qui nomme cette file est étiqueté avec elle quand OneUptime l'ingère : les spans remplissent la **Vue d'ensemble** — messages publiés et consommés, erreurs et temps de traitement, et les services sous **Producteurs** et **Consommateurs** — et l'onglet **Traces**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Santé du broker**, dans la Vue d'ensemble, se remplit à partir des métriques du broker à mesure qu'elles arrivent : avec la configuration de l'étape 3, celles de CloudWatch arrivent avec 11 à 17 minutes de retard.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "L'en-tête affiche **Vu récemment** dès que la découverte trouve des spans ou des métriques de broker qui nomment cette file. Elle s'exécute toutes les 10 minutes sur les 15 dernières minutes de télémétrie, et sur les 60 dernières minutes de métriques de supervision cloud, qui arrivent en retard.",
  "Names are compared without regard to case.":
    "Les noms sont comparés sans tenir compte de la casse.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans** : `messaging.system` = `aws.sns` (ou `aws_sns`, `amazonsns` ou `sns`) et la destination `orders` — dans `messaging.destination.name`, ou une clé plus ancienne comme `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Métriques du broker** : `Dimensions.TopicName` ou `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Amazon SQS `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Apache ActiveMQ `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Santé du broker**, dans la Vue d'ensemble, se remplit à partir des métriques du broker à mesure qu'elles arrivent.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "L'en-tête affiche **Vu récemment** dès que la découverte trouve des spans ou des métriques de broker qui nomment cette file. Elle s'exécute toutes les 10 minutes sur les 15 dernières minutes de télémétrie.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- Les spans des clients JMS disent `jms` quel que soit le broker derrière eux, si bien qu'eux et les métriques du broker Apache ActiveMQ arrivent sur cette seule file.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "L'hôte JMX est prérempli à partir de l'adresse du broker que signale la télémétrie de cette file (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Apache Kafka `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans** : `messaging.system` = `kafka` et la destination `orders` — dans `messaging.destination.name`, ou une clé plus ancienne comme `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Métriques du broker** : `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Pour un cluster avec SASL ou TLS, décommentez `auth` et `tls`. Le broker d'amorçage est prérempli à partir de l'adresse du broker que signale la télémétrie de cette file (`broker-1.example.com:9092`) ; modifiez-le si le collecteur joint le broker autrement. Le récepteur nomme chaque topic dans `topic`, et c'est ainsi que les métriques trouvent la file du topic. Il ne rapporte le retard et les offsets validés d'un groupe de consommateurs que pour les topics sur lesquels le groupe a validé un offset, et ignore les topics dont le nom commence par `_`.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Apache Pulsar `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans** : `messaging.system` = `pulsar` (ou `apache_pulsar`) et la destination `orders` — dans `messaging.destination.name`, ou une clé plus ancienne comme `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Apache RocketMQ `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Voici la file Azure Event Grid `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques qui portent son `messaging.system` et son `messaging.destination.name`. Tout ce qui suit est prérempli pour cette file.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Les métriques qui portent son `messaging.system` et son `messaging.destination.name` sur chaque point de données s'affichent dans son onglet **Métriques**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "L'en-tête affiche **Vu récemment** dès que la découverte trouve des spans ou des métriques de clients de messagerie qui nomment cette file. Elle s'exécute toutes les 10 minutes sur les 15 dernières minutes de télémétrie.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Azure Event Hubs `orders` dans l'espace de noms `orders-ns`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Spans** : `messaging.system` = `eventhubs` (ou `azure_eventhubs`, `azure.eventhubs` ou `microsoft.eventhub`) et la destination `orders` — dans `messaging.destination.name`, ou une clé plus ancienne comme `messaging.destination`, depuis un SDK connecté à `orders-ns.servicebus.windows.net`.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Métriques du broker** : `metadata_entityname` = `orders`, sur l'espace de noms dont le `name` est `orders-ns`.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Azure Service Bus `orders` dans l'espace de noms `orders-ns`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Voici la file BullMQ `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques qui portent son `messaging.system` et son `messaging.destination.name`. Tout ce qui suit est prérempli pour cette file.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file Google Cloud Pub/Sub `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Voici la file JMS `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques qui portent son `messaging.system` et son `messaging.destination.name`. Tout ce qui suit est prérempli pour cette file.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Ses métriques rejoignent cette file, qui s'affiche dès lors comme une file Apache ActiveMQ.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Voici la file NATS `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques qui portent son `messaging.system` et son `messaging.destination.name`. Tout ce qui suit est prérempli pour cette file.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Voici la file RabbitMQ `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques propres du broker. Tout ce qui suit est prérempli pour cette file.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Définissez `RABBITMQ_USERNAME` et `RABBITMQ_PASSWORD` dans l'environnement du collecteur. L'hôte du point de terminaison de gestion est prérempli à partir de l'adresse du broker que signale la télémétrie de cette file (`broker-1.example.com:9092`) ; modifiez-le si le collecteur joint le broker autrement. Le récepteur rapporte chaque file sous son nom RabbitMQ, alors que les spans de la plupart des instrumentations nomment l'exchange par lequel un message est passé : les deux se rejoignent pour les messages envoyés via l'exchange par défaut, dont la clé de routage est le nom de la file.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Voici la file `acme-bus` `orders`. Elle se remplit à partir des spans de messagerie des applications qui y publient et en consomment, et des métriques qui portent son `messaging.system` et son `messaging.destination.name`. Tout ce qui suit est prérempli pour cette file.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime ne connaît pas ce système de messagerie, il n'a donc aucun moyen prêt à l'emploi de lire les métriques du broker ; envoyez-les avec `messaging.system` et `messaging.destination.name` sur chaque point de données et elles se rattachent à la file.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime n'affiche aucune métrique de broker pour `acme-bus` sous **Santé du broker**. Tout ce qu'envoie un collecteur se trouve dans l'explorateur **Métriques**, et une métrique qui porte `messaging.system` et `messaging.destination.name` sur chaque point de données s'affiche dans l'onglet **Métriques** de la file.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Seules les métriques propres du broker ont besoin d'un système que OneUptime connaît (voir [Systèmes de messagerie pris en charge](/docs/telemetry/queues#supported-messaging-systems)). Ses métriques se trouvent dans l'explorateur **Métriques**.",
};

export default TRANSLATION;
