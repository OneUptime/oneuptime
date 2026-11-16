import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Amazon SNS aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Los spans nombran el sistema como `messaging.system` = `aws.sns` (también se acepta: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "Las colas salen de los spans de mensajería que tu instrumentación de OpenTelemetry ya produce; no hace falta nada específico de OneUptime.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza las llamadas a SNS del SDK de AWS sin cambios en el código.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: el paquete `OpenTelemetry.Instrumentation.AWS`, con `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; su conjunto de atributos predeterminado no nombra ningún topic de SNS.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traza el SDK de AWS.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: el paquete `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, añadido con `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Cualquier otro cliente**: usa el soporte de OpenTelemetry propio de la biblioteca cliente, o define `messaging.system` = `aws.sns`, `messaging.destination.name` y el tipo de span (PRODUCER al publicar, CONSUMER al consumir) en los spans que rodean tus envíos y manejadores.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Después apunta el exportador OTLP a OneUptime. La mayoría de los SDK y agentes leen estas variables de entorno:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Este token es un secreto.** Usa una clave de ingesta de **Servidor**, guardada en los secretos\n> de tu despliegue. Nunca pongas una clave de Servidor en JavaScript del navegador: para eso existe\n> una clave de ingesta de **Navegador**.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lee las métricas de CloudWatch de los topics con el receptor `aws_cloudwatch` del colector, o transmítelas mediante un CloudWatch Metric Stream y Amazon Data Firehose a su receptor `awsfirehose`.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "El receptor `aws_cloudwatch` consulta la API `GetMetricData` de CloudWatch con las credenciales predeterminadas del SDK de AWS (entorno, perfil compartido o rol de instancia), que necesitan `cloudwatch:ListMetrics` y `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Deja `stats` sin definir.** Sin él, cada métrica llega como un resumen por periodo, que es lo que lee OneUptime.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` debe estar definido, y limita las métricas leídas en cada recolección.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` espera a que CloudWatch publique un periodo, así que con esta configuración las métricas de broker de una cola llegan con 11 a 17 minutos de retraso: un monitor sobre ellas necesita una ventana más larga (consulta **Métricas tardías** en [Alertas](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Un receptor lee una región y un espacio de nombres: añade una instancia por región.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Para transmitir las métricas en su lugar —un CloudWatch Metric Stream a través de Amazon Data Firehose hacia el receptor `awsfirehose` del colector—, consulta [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Envía unos cuantos mensajes por tus colas. Cada 10 minutos OneUptime lee los spans de los últimos 15 minutos y lista, en **Colas**, cada destino que nombran al menos 3 de ellos (spans de cualquier tipo salvo SERVER). En un OneUptime autoalojado, `MESSAGE_QUEUE_MIN_SPANS` fija ese número.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Un solo punto de datos de una métrica de broker que grafica una página de cola también crea su cola: las métricas de monitorización en la nube llegan tarde, así que cada ejecución las lee de los últimos 60 minutos. Las métricas de clientes de mensajería, y las métricas propias que llevan `messaging.system` y `messaging.destination.name`, nunca crean una cola: aparecen en la pestaña **Métricas** de una que ya existe.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "Las colas solo se crean solas mientras el proyecto esté por debajo de su [presupuesto de creación automática](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "La Vista general de la cola grafica estas métricas en **Salud del broker**, y cada indicador y cada recuento por periodo tiene **Crear monitor**. Hasta que llega una, la sección indica de dónde vienen.",
  "| Metric | Shown as | Type |": "| Métrica | Se muestra como | Tipo |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (flujo JSON: `numberofmessagespublished`) | Mensajes publicados | Recuento por periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (flujo JSON: `numberofnotificationsdelivered`) | Notificaciones entregadas | Recuento por periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (flujo JSON: `numberofnotificationsfailed`) | Notificaciones fallidas | Recuento por periodo |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (flujo JSON: `numberofnotificationsredriventodlq`) | Redirigidos a la cola de mensajes con problemas de entrega | Recuento por periodo |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Sus spans no nombran ningún sistema de mensajería que OneUptime sepa reconocer: los spans de Celery, la telemetría propia de BullMQ o un cliente hecho a mano. Añade `messaging.system` y `messaging.destination.name`, y da a los spans el tipo PRODUCER o CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- Su nombre es uno de los que OneUptime ignora (consulta [Qué se ignora](/docs/telemetry/queues#what-is-ignored)), o solo la nombran spans SERVER.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Llegaron menos de 3 de sus spans en los últimos 15 minutos, o el proyecto alcanzó su [presupuesto de creación automática](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Cuando sus spans sí la nombran, créala a mano con el mismo sistema y destino (**Colas → Crear Cola**): su pestaña **Trazas** se rellena con los spans ya almacenados.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Consulta [No se creó una cola que usan mis aplicaciones](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) en la página de documentación de colas.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Revisa el log del colector. OneUptime rechaza una clave de ingesta incorrecta con `401` (`422` para una clave desactivada o una clave de Navegador), y el colector registra `Exporting failed` por cada lote que descarta.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Llegan tarde. `aws_cloudwatch` espera `delay` (10 minutos) a que CloudWatch publique, así que sus puntos llegan con 11 a 17 minutos de retraso.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Consulta [La salud del broker sigue vacía](/docs/telemetry/queues#broker-health-stays-empty) en la página de documentación de colas.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Dos sistemas lo nombran: un cliente de Kafka en el endpoint de Kafka de Event Hubs informa `kafka`, y el SDK de Event Hubs `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Un avistamiento de Service Bus o Event Hubs no tiene espacio de nombres: el emulador o un dominio personalizado.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- Los spans de RabbitMQ suelen nombrar el exchange, y las métricas del broker la cola: dos colas en OneUptime salvo que el exchange y la cola compartan nombre.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Archiva la que no quieras: una cola archivada sigue archivada, y lo que la nombra ya no crea una nueva.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Consulta [Dos colas para un mismo destino](/docs/telemetry/queues#two-queues-for-one-destination) en la página de documentación de colas.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Un destino nombrado por solicitud o por consumidor que OneUptime no reconoce —un sufijo numérico, un hash— crea una cola por nombre. Los UUID ya se agrupan (consulta [Qué se ignora](/docs/telemetry/queues#what-is-ignored)). Marca esos destinos con `messaging.destination.temporary=true` en tu instrumentación, o dales un nombre estable, y luego archiva las colas ya creadas.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Consulta [Una cola nueva por cada solicitud](/docs/telemetry/queues#a-new-queue-for-every-request) en la página de documentación de colas.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Amazon SQS aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza las llamadas a SQS del SDK de AWS sin cambios en el código.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: el paquete `OpenTelemetry.Instrumentation.AWS`, con `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; su conjunto de atributos predeterminado nombra una cola de SQS solo por su URL.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, o `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), añadido con `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Sus spans de SQS llevan la URL de la cola en `server.address`, que OneUptime lee como la cola.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Lee las métricas de CloudWatch de las colas con el receptor `aws_cloudwatch` del colector, o transmítelas mediante un CloudWatch Metric Stream y Amazon Data Firehose a su receptor `awsfirehose`.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (flujo JSON: `approximatenumberofmessagesvisible`) | Mensajes visibles | Indicador |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (flujo JSON: `approximateageofoldestmessage`) | Antigüedad del mensaje más antiguo | Indicador |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (flujo JSON: `approximatenumberofmessagesnotvisible`) | Mensajes en tránsito | Indicador |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (flujo JSON: `numberofmessagessent`) | Mensajes enviados | Recuento por periodo |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (flujo JSON: `numberofmessagesreceived`) | Mensajes recibidos | Recuento por periodo |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (flujo JSON: `numberofmessagesdeleted`) | Mensajes eliminados | Recuento por periodo |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Apache ActiveMQ aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Los spans nombran el sistema como `messaging.system` = `activemq` (también se acepta: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: el agente Java de OpenTelemetry traza clientes JMS —ActiveMQ, Artemis, IBM MQ y cualquier otro broker JMS— sin cambios en el código. Los spans JMS dicen `jms` sea cual sea el broker que hay detrás; una cola de ActiveMQ se identifica por esa familia JMS, así que los spans de sus clientes y las métricas de su broker llegan a una sola cola.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "El colector no tiene un receptor JMX, así que ejecuta el OpenTelemetry JMX Scraper con `OTEL_JMX_TARGET_SYSTEM=activemq` junto a un broker ActiveMQ Classic; envía las métricas de destino del broker por OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Permite que el broker acepte conexiones JMX. Con la imagen `apache/activemq-classic` o el script `bin/activemq`, establece `ACTIVEMQ_SUNJMX_START` antes de iniciarlo. Este ejemplo desactiva la autenticación: mantén el puerto en una red privada, o activa `jmxremote.authenticate` con un archivo de contraseñas y dale al scraper `OTEL_JMX_USERNAME` y `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Ejecuta el scraper donde pueda alcanzar ese puerto, con un entorno de ejecución de Java. Envía directamente a OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` mantiene los nombres de métrica que el scraper usa desde la 1.53.0-alpha (`activemq.message.queue.size`, con el destino en `messaging.destination.name`); OneUptime también lee los nombres anteriores (`activemq.message.current`, con el destino en `destination`). ActiveMQ Artemis tiene otros MBeans, que estas reglas no leen.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Un solo punto de datos de una métrica de broker que grafica una página de cola también crea su cola. Las métricas de clientes de mensajería, y las métricas propias que llevan `messaging.system` y `messaging.destination.name`, nunca crean una cola: aparecen en la pestaña **Métricas** de una que ya existe.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Tamaño de la cola | Indicador |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Tamaño de la cola (nombres antiguos) | Indicador |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Encolados | Contador, graficado por segundo |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Desencolados | Contador, graficado por segundo |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Caducado | Contador, graficado por segundo |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consumidores | Indicador |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Tiempo medio en la cola | Indicador |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Tiempo medio en la cola (nombres antiguos) | Indicador |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La métrica nombra la cola de otra forma que los spans (consulta [Limitaciones](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Apache Kafka aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Los spans nombran el sistema como `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza productores y consumidores de Kafka sin cambios en el código.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` con el paquete `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traza `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` o `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: la autoinstrumentación de OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, en Linux) traza productores y consumidores de `segmentio/kafka-go` sin cambios en el código.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "El receptor `kafka_metrics` del colector lee de los brokers el retraso de los grupos de consumidores y los offsets de las particiones; activa sus scrapers `topics` y `consumers`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Para un clúster con SASL o TLS, descomenta `auth` y `tls`. El receptor nombra cada topic en `topic`, y así es como las métricas encuentran la cola del topic. Solo informa del retraso y los offsets confirmados de un grupo de consumidores en los topics en los que el grupo ha confirmado un offset, y omite los topics cuyo nombre empieza por `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Retraso de consumidores | Indicador |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Retraso de partición | Indicador |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Consumido | Contador, graficado por segundo |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Producidos | Contador, graficado por segundo |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka informa del retraso de un grupo de consumidores solo después de que el grupo confirme un offset. El receptor omite los topics cuyo nombre empieza por `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Apache Pulsar aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Los spans nombran el sistema como `messaging.system` = `pulsar` (también se acepta: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza clientes de Pulsar sin cambios en el código.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Cada broker sirve sus métricas de topics y suscripciones en el puerto de su servicio web; recopila cada broker, porque un broker solo informa de los topics que posee en ese momento.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar etiqueta cada serie con el nombre completo del topic (`persistent://public/default/orders`), y las de una partición con el de la partición: las particiones suman en su topic.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Acumulado | Indicador |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Acumulado de la suscripción | Indicador |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Antigüedad del acumulado | Indicador |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Mensajes de entrada | Contador, graficado por segundo |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Mensajes de salida | Contador, graficado por segundo |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Apache RocketMQ aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza clientes de RocketMQ sin cambios en el código.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Establece `metricsExporterType=PROM` en el `broker.conf` del broker para que el broker sirva sus métricas de retraso y rendimiento.",
  "Then scrape every broker:": "Luego recopila cada broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Mensajes listos | Indicador |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Enviados a la cola de mensajes con problemas de entrega | Contador, graficado por segundo |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Azure Event Grid aparecen solas en OneUptime, a partir de los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor tiene las métricas de entrega y de mensajes fallidos de los topics, que lee el receptor `azure_monitor` del colector; todavía no se representan en una página de cola, así que explóralas en Métricas.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "El receptor inicia sesión mediante la extensión `azure_auth`: da a la entidad de servicio el rol **Monitoring Reader** en la suscripción, y define `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` y `AZURE_SUBSCRIPTION_ID` en el entorno del colector.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Las métricas de clientes de mensajería, y las métricas propias que llevan `messaging.system` y `messaging.destination.name`, nunca crean una cola: aparecen en la pestaña **Métricas** de una que ya existe.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime no grafica métricas de broker para Azure Event Grid en **Salud del broker**: lo que envía el colector de arriba solo llega al explorador de **Métricas**. Una métrica que lleva `messaging.system` y `messaging.destination.name` en cada punto de datos aparece en la pestaña **Métricas** de la cola.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid no tiene métricas graficadas. Sus métricas están en el explorador de **Métricas**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Azure Event Hubs aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: el SDK de Azure para Java se traza a sí mismo, y el agente Java de OpenTelemetry conecta ese trazado con OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: los spans de OpenTelemetry del SDK de Azure son experimentales: define `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (o el interruptor `Azure.Experimental.EnableActivitySource`) y suscríbete a las fuentes de Azure con `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registra `createAzureSdkInstrumentation()` de `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: instala `azure-core-tracing-opentelemetry` y define `settings.tracing_implementation = "opentelemetry"` (de `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Una suscripción de Azure conectada lee las métricas clave del espacio de nombres para cada event hub, sin nada que ejecutar. Para leerlas todas, ejecuta el receptor `azure_monitor` del colector, que las divide por event hub según la dimensión EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "El receptor lista tus espacios de nombres una vez al día, así que un espacio de nombres nuevo puede tardar hasta 24 horas en aparecer.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Mensajes entrantes | Recuento por periodo |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Mensajes salientes | Recuento por periodo |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Errores del servidor | Recuento por periodo |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Errores de usuario | Recuento por periodo |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Errores de cuota superada | Recuento por periodo |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Solicitudes limitadas | Recuento por periodo |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Tamaño | Indicador |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- La métrica nombra la cola de otra forma que los spans. Los spans de Service Bus y Event Hubs sin host de espacio de nombres están en una cola distinta de las métricas de Azure Monitor (consulta [Limitaciones](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor devuelve 10 colas por métrica y espacio de nombres salvo que se aumente `maximum_number_of_records_per_resource`. La configuración del paso 3 lo aumenta.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- El receptor lista tus espacios de nombres una vez al día, así que un espacio de nombres nuevo puede tardar hasta 24 horas en aparecer.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Azure Service Bus aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Una suscripción de Azure conectada lee las métricas clave del espacio de nombres para cada cola y topic, sin nada que ejecutar. Para leerlas todas, ejecuta el receptor `azure_monitor` del colector, que las divide por cola y topic según la dimensión EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Mensajes activos | Indicador |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Mensajes con problemas de entrega | Indicador |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Mensajes programados | Indicador |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Mensajes completados | Recuento por periodo |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Mensajes abandonados | Recuento por periodo |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Latencia de envío del servidor | Indicador |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de BullMQ aparecen solas en OneUptime, a partir de los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "La telemetría propia de BullMQ (su opción `telemetry`, que implementa el paquete `bullmq-otel`) nombra la cola en `bullmq.queue.name` y no establece ningún `messaging.system`, así que por sí sola no crea ninguna cola. Un procesador `transform` en el colector al que envían tus aplicaciones añade las dos claves que lee OneUptime, en los spans que añaden y procesan trabajos y en las métricas propias de BullMQ:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Solo se etiquetan los spans PRODUCER que añaden jobs y los spans CONSUMER que los procesan: los spans internos de BullMQ también nombran la cola, pero no son mensajes. Apunta el exportador OTLP de tus aplicaciones a este colector.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ guarda sus trabajos en Redis y no tiene un broker que recopilar; informa la profundidad de la cola desde la aplicación como una métrica que lleve `messaging.system` y `messaging.destination.name`, como hacen los propios workers de OneUptime con `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Observa los recuentos de jobs en la aplicación; un indicador que lleva él mismo las dos claves no necesita transformación:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime no grafica métricas de broker para BullMQ en **Salud del broker**. Todo lo que envía un colector está en el explorador de **Métricas**, y una métrica que lleva `messaging.system` y `messaging.destination.name` en cada punto de datos aparece en la pestaña **Métricas** de la cola.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Sus spans no nombran ningún sistema de mensajería que OneUptime sepa reconocer: los spans de Celery, la telemetría propia de BullMQ o un cliente hecho a mano. Añade `messaging.system` y `messaging.destination.name`, y da a los spans el tipo PRODUCER o CONSUMER. Para BullMQ, la transformación del paso 2 se encarga de ello.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ no tiene métricas graficadas. Sus métricas están en el explorador de **Métricas**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de Google Cloud Pub/Sub aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: el cliente se traza a sí mismo en cuanto sus builders `Publisher` y `Subscriber` reciben una instancia de OpenTelemetry y el interruptor de trazado: `setOpenTelemetry(GlobalOpenTelemetry.get())` y `setEnableOpenTelemetryTracing(true)`. Cualquiera de las dos llamadas por sí sola no traza nada.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: con `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` y `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: con `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Lee las métricas de los topics y las suscripciones desde Cloud Monitoring con el receptor `googlecloudmonitoring` del colector, listando cada tipo de métrica en `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "El receptor inicia sesión con Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, o la cuenta de servicio con la que se ejecuta el colector), que necesitan el rol **Monitoring Viewer** en el proyecto. Define `project_id` con tu proyecto:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Un tipo de métrica que falta en `metrics_list` nunca se lee. Las métricas de suscripción se asocian a la cola de la suscripción (`subscription_id`), las métricas de topic a la del topic (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Mensajes no entregados | Indicador |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Antigüedad del mensaje sin confirmar más antiguo | Indicador |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Mensajes con problemas de entrega | Recuento por periodo |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Mensajes confirmados | Recuento por periodo |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Solicitudes de publicación | Recuento por periodo |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- La métrica nombra la cola de otra forma que los spans. Un topic de Pub/Sub tiene las métricas de topic y sus suscripciones las métricas de suscripción.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring solo lee los tipos de `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Llegan tarde. Las métricas de Pub/Sub llegan con minutos de retraso.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de JMS aparecen solas en OneUptime, a partir de los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS es una API, y sus spans no nombran el broker que hay detrás; cuando el broker es Apache ActiveMQ, ejecuta el OpenTelemetry JMX Scraper contra él y sus métricas se unen a la misma cola, que entonces se muestra como una cola de ActiveMQ, mientras que otros brokers JMS como IBM MQ no tienen una vía de métricas lista para usar.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "Sus métricas se unen a la misma cola que los spans JMS, que a partir de entonces se muestra como una cola de Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime no grafica métricas de broker para JMS en **Salud del broker**. Todo lo que envía un colector está en el explorador de **Métricas**, y una métrica que lleva `messaging.system` y `messaging.destination.name` en cada punto de datos aparece en la pestaña **Métricas** de la cola.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "En cuanto llegan las métricas de un broker de Apache ActiveMQ, la cola se muestra como una cola de Apache ActiveMQ y las grafica en **Salud del broker**: consulta [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Los brokers JMS distintos de ActiveMQ no tienen métricas graficadas. Sus métricas están en el explorador de **Métricas**. Para un broker de ActiveMQ, consulta **Si el broker es Apache ActiveMQ** en **Avanzado**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de NATS aparecen solas en OneUptime, a partir de los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza clientes de NATS —su instrumentación de NATS informa `messaging.system` = `nats`— sin cambios en el código.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Ejecuta prometheus-nats-exporter con `-jsz=all` contra el puerto de monitorización del servidor. Sus métricas de JetStream son por stream y consumidor, no por subject, así que no se asocian a colas a nivel de subject.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Activa el puerto de monitorización del servidor con `-m 8222` (o `http_port: 8222` en su configuración) y luego ejecuta el exportador:",
  "And scrape it:": "Y recopílalo:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime no grafica métricas de broker para NATS en **Salud del broker**: lo que envía el colector de arriba solo llega al explorador de **Métricas**. Una métrica que lleva `messaging.system` y `messaging.destination.name` en cada punto de datos aparece en la pestaña **Métricas** de la cola.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS no tiene métricas graficadas. Sus métricas están en el explorador de **Métricas**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Las colas de RabbitMQ aparecen solas en OneUptime, a partir de dos fuentes: los spans de mensajería de las aplicaciones que publican en ellas y consumen de ellas, y las métricas propias del broker. También puedes añadir una a mano: **Colas → Crear Cola**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: el agente Java de OpenTelemetry traza clientes de RabbitMQ sin cambios en el código.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 se traza a sí mismo: suscríbete a `RabbitMQ.Client.*`. MassTransit también se traza a sí mismo: suscríbete a `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` o `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "El receptor `rabbitmq` del colector lee la profundidad, los consumidores y las tasas de mensajes de cada cola desde la API HTTP del plugin de administración, como un usuario con la etiqueta `monitoring` y acceso a cada host virtual.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Habilita el plugin de administración y crea ese usuario. La etiqueta `monitoring` por sí sola no le muestra ninguna cola: dale acceso a cada host virtual que quieras monitorizar. Los patrones vacíos conceden ese acceso sin ningún derecho a configurar, publicar o consumir:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Define `RABBITMQ_USERNAME` y `RABBITMQ_PASSWORD` en el entorno del colector. El receptor informa de cada cola con su nombre de RabbitMQ, mientras que los spans de la mayoría de las instrumentaciones nombran el exchange por el que pasó un mensaje: ambos coinciden en los mensajes enviados a través del exchange predeterminado, cuya clave de enrutamiento es el nombre de la cola.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Profundidad de la cola | Indicador |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Publicado | Contador, graficado por segundo |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Entregados | Contador, graficado por segundo |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Reconocido | Contador, graficado por segundo |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Descartado | Contador, graficado por segundo |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- La métrica nombra la cola de otra forma que los spans. Los spans de RabbitMQ suelen nombrar el exchange, mientras que las métricas del broker describen colas. Ambos coinciden en los mensajes enviados a través del exchange predeterminado, cuya clave de enrutamiento es el nombre de la cola.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ solo informa de las colas de los hosts virtuales a los que su usuario tiene acceso, y no registra ningún error para el resto. Los contadores de RabbitMQ aparecen con la primera actividad.",
  "This is the Amazon SNS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Amazon SNS `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration this queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` espera a que CloudWatch publique un periodo, así que con esta configuración las métricas de broker de esta cola llegan con 11 a 17 minutos de retraso: un monitor sobre ellas necesita una ventana más larga (consulta **Métricas tardías** en [Alertas](/docs/telemetry/queues#alerting)).",
  "Send a few messages through `orders`. Every span that names this queue is tagged with it as OneUptime ingests it: the spans fill in the **Overview** — messages published and consumed, errors and processing time, and the services under **Producers** and **Consumers** — and the **Traces** tab.":
    "Envía unos cuantos mensajes por `orders`. Cada span que nombra esta cola se etiqueta con ella cuando OneUptime lo ingiere: los spans rellenan la **Vista general** (mensajes publicados y consumidos, errores y tiempo de procesamiento, y los servicios en **Productores** y **Consumidores**) y la pestaña **Trazas**.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive: with the configuration in step 3, CloudWatch's arrive 11 to 17 minutes late.":
    "**Salud del broker**, en la Vista general, se rellena con las métricas del broker a medida que llegan: con la configuración del paso 3, las de CloudWatch llegan con 11 a 17 minutos de retraso.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry, and over the last 60 minutes of cloud monitoring metrics, which arrive late.":
    "La cabecera muestra **Visto recientemente** en cuanto el descubrimiento encuentra spans o métricas de broker que nombran esta cola. Se ejecuta cada 10 minutos sobre los últimos 15 minutos de telemetría, y sobre los últimos 60 minutos de métricas de monitorización en la nube, que llegan tarde.",
  "Names are compared without regard to case.":
    "Los nombres se comparan sin distinguir mayúsculas de minúsculas.",
  "- **Spans**: `messaging.system` = `aws.sns` (or `aws_sns`, `amazonsns` or `sns`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `aws.sns` (o `aws_sns`, `amazonsns` o `sns`) y el destino `orders`: en `messaging.destination.name`, o en una clave más antigua como `messaging.destination`.",
  "- **Broker metrics**: `Dimensions.TopicName` or `TopicName` = `orders`.":
    "- **Métricas del broker**: `Dimensions.TopicName` o `TopicName` = `orders`.",
  "This is the Amazon SQS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Amazon SQS `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the Apache ActiveMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Apache ActiveMQ `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "**Broker health** on the Overview fills in from the broker's metrics as they arrive.":
    "**Salud del broker**, en la Vista general, se rellena con las métricas del broker a medida que llegan.",
  "The header reads **Seen recently** once discovery finds spans or broker metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "La cabecera muestra **Visto recientemente** en cuanto el descubrimiento encuentra spans o métricas de broker que nombran esta cola. Se ejecuta cada 10 minutos sobre los últimos 15 minutos de telemetría.",
  "- JMS clients' spans say `jms` whichever broker is behind them, so they and the Apache ActiveMQ broker's metrics land on this one queue.":
    "- Los spans de los clientes JMS dicen `jms` sea cual sea el broker que hay detrás, así que ellos y las métricas del broker de Apache ActiveMQ llegan a esta única cola.",
  "The JMX host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`).":
    "El host JMX viene rellenado con la dirección del broker que informa la telemetría de esta cola (`broker-1.example.com:9092`).",
  "This is the Apache Kafka queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Apache Kafka `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "- **Spans**: `messaging.system` = `kafka` and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `kafka` y el destino `orders`: en `messaging.destination.name`, o en una clave más antigua como `messaging.destination`.",
  "- **Broker metrics**: `topic` = `orders`.":
    "- **Métricas del broker**: `topic` = `orders`.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The bootstrap broker is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Para un clúster con SASL o TLS, descomenta `auth` y `tls`. El broker de arranque viene rellenado con la dirección del broker que informa la telemetría de esta cola (`broker-1.example.com:9092`); cámbialo si el colector llega al broker por otro camino. El receptor nombra cada topic en `topic`, y así es como las métricas encuentran la cola del topic. Solo informa del retraso y los offsets confirmados de un grupo de consumidores en los topics en los que el grupo ha confirmado un offset, y omite los topics cuyo nombre empieza por `_`.",
  "This is the Apache Pulsar queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Apache Pulsar `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "- **Spans**: `messaging.system` = `pulsar` (or `apache_pulsar`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`.":
    "- **Spans**: `messaging.system` = `pulsar` (o `apache_pulsar`) y el destino `orders`: en `messaging.destination.name`, o en una clave más antigua como `messaging.destination`.",
  "This is the Apache RocketMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Apache RocketMQ `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the Azure Event Grid queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Esta es la cola de Azure Event Grid `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas que llevan su `messaging.system` y su `messaging.destination.name`. Todo lo de abajo viene ya rellenado para esta cola.",
  "Metrics that carry its `messaging.system` and `messaging.destination.name` on each datapoint show on its **Metrics** tab.":
    "Las métricas que llevan su `messaging.system` y su `messaging.destination.name` en cada punto de datos aparecen en su pestaña **Métricas**.",
  "The header reads **Seen recently** once discovery finds spans or messaging client metrics naming this queue. It runs every 10 minutes over the last 15 minutes of telemetry.":
    "La cabecera muestra **Visto recientemente** en cuanto el descubrimiento encuentra spans o métricas de clientes de mensajería que nombran esta cola. Se ejecuta cada 10 minutos sobre los últimos 15 minutos de telemetría.",
  "This is the Azure Event Hubs queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Azure Event Hubs `orders` en el espacio de nombres `orders-ns`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "- **Spans**: `messaging.system` = `eventhubs` (or `azure_eventhubs`, `azure.eventhubs` or `microsoft.eventhub`) and the destination `orders` — in `messaging.destination.name`, or an older key such as `messaging.destination`, from an SDK connected to `orders-ns.servicebus.windows.net`.":
    "- **Spans**: `messaging.system` = `eventhubs` (o `azure_eventhubs`, `azure.eventhubs` o `microsoft.eventhub`) y el destino `orders`: en `messaging.destination.name`, o en una clave más antigua como `messaging.destination`, desde un SDK conectado a `orders-ns.servicebus.windows.net`.",
  "- **Broker metrics**: `metadata_entityname` = `orders`, on the namespace whose `name` is `orders-ns`.":
    "- **Métricas del broker**: `metadata_entityname` = `orders`, en el espacio de nombres cuyo `name` es `orders-ns`.",
  "This is the Azure Service Bus queue `orders` in the `orders-ns` namespace. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Azure Service Bus `orders` en el espacio de nombres `orders-ns`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the BullMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Esta es la cola de BullMQ `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas que llevan su `messaging.system` y su `messaging.destination.name`. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the Google Cloud Pub/Sub queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de Google Cloud Pub/Sub `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the JMS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Esta es la cola de JMS `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas que llevan su `messaging.system` y su `messaging.destination.name`. Todo lo de abajo viene ya rellenado para esta cola.",
  "Its metrics join this queue, which from then on shows as an Apache ActiveMQ queue.":
    "Sus métricas se unen a esta cola, que a partir de entonces se muestra como una cola de Apache ActiveMQ.",
  "This is the NATS queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Esta es la cola de NATS `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas que llevan su `messaging.system` y su `messaging.destination.name`. Todo lo de abajo viene ya rellenado para esta cola.",
  "This is the RabbitMQ queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from the broker's own metrics. Everything below is prefilled for this queue.":
    "Esta es la cola de RabbitMQ `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas propias del broker. Todo lo de abajo viene ya rellenado para esta cola.",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The management endpoint's host is prefilled from the broker address this queue's telemetry reports (`broker-1.example.com:9092`); change it if the collector reaches the broker another way. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Define `RABBITMQ_USERNAME` y `RABBITMQ_PASSWORD` en el entorno del colector. El host del endpoint de administración viene rellenado con la dirección del broker que informa la telemetría de esta cola (`broker-1.example.com:9092`); cámbialo si el colector llega al broker por otro camino. El receptor informa de cada cola con su nombre de RabbitMQ, mientras que los spans de la mayoría de las instrumentaciones nombran el exchange por el que pasó un mensaje: ambos coinciden en los mensajes enviados a través del exchange predeterminado, cuya clave de enrutamiento es el nombre de la cola.",
  "This is the `acme-bus` queue `orders`. It fills in from the messaging spans of the applications that publish to and consume from it, and from metrics that carry its `messaging.system` and `messaging.destination.name`. Everything below is prefilled for this queue.":
    "Esta es la cola de `acme-bus` `orders`. Se rellena con los spans de mensajería de las aplicaciones que publican en ella y consumen de ella, y con las métricas que llevan su `messaging.system` y su `messaging.destination.name`. Todo lo de abajo viene ya rellenado para esta cola.",
  "OneUptime does not know this messaging system, so it has no ready-made way to read the broker's metrics; send them with `messaging.system` and `messaging.destination.name` on each datapoint and they attach to the queue.":
    "OneUptime no conoce este sistema de mensajería, así que no tiene una forma lista para leer las métricas del broker; envíalas con `messaging.system` y `messaging.destination.name` en cada punto de datos y se asociarán a la cola.",
  "OneUptime charts no broker metrics for `acme-bus` under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime no grafica métricas de broker para `acme-bus` en **Salud del broker**. Todo lo que envía un colector está en el explorador de **Métricas**, y una métrica que lleva `messaging.system` y `messaging.destination.name` en cada punto de datos aparece en la pestaña **Métricas** de la cola.",
  "- Only the broker's own metrics need a system OneUptime knows (see [Supported messaging systems](/docs/telemetry/queues#supported-messaging-systems)). Its metrics are in the **Metrics** explorer.":
    "- Solo las métricas propias del broker necesitan un sistema que OneUptime conozca (consulta [Sistemas de mensajería compatibles](/docs/telemetry/queues#supported-messaging-systems)). Sus métricas están en el explorador de **Métricas**.",
};

export default TRANSLATION;
