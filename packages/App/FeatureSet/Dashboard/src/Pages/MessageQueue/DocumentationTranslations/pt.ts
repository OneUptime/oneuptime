import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Portuguese (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Portuguese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Portuguese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Amazon SNS aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "Os spans nomeiam o sistema como `messaging.system` = `aws.sns` (também aceitos: `aws_sns`, `amazonsns`, `sns`).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "As filas vêm dos spans de mensageria que a sua instrumentação OpenTelemetry já produz; nada específico do OneUptime é necessário.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia as chamadas de SNS do AWS SDK sem mudanças no código.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: o pacote `OpenTelemetry.Instrumentation.AWS`, com `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; o conjunto de atributos padrão dele não nomeia nenhum tópico do SNS.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` rastreia o AWS SDK.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: o pacote `opentelemetry-instrumentation-botocore`.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`, adicionado com `otelaws.AppendMiddlewares(&cfg.APIOptions)`.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **Qualquer outro cliente**: use o suporte a OpenTelemetry da própria biblioteca cliente, ou defina `messaging.system` = `aws.sns`, `messaging.destination.name` e o tipo de span (PRODUCER ao publicar, CONSUMER ao consumir) nos spans em torno dos seus envios e handlers.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "Depois aponte o exportador OTLP para o OneUptime. A maioria dos SDKs e agentes lê estas variáveis de ambiente:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **Este token é um segredo.** Use uma chave de ingestão de **Servidor**, guardada nos segredos\n> da sua implantação. Nunca coloque uma chave de Servidor em JavaScript de navegador — existe\n> uma chave de ingestão de **Navegador** para isso.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Leia as métricas do CloudWatch dos tópicos com o receptor `aws_cloudwatch` do coletor, ou transmita-as por um CloudWatch Metric Stream e o Amazon Data Firehose para o receptor `awsfirehose` dele.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "O receptor `aws_cloudwatch` consulta a API `GetMetricData` do CloudWatch com as credenciais padrão do AWS SDK (ambiente, perfil compartilhado ou função da instância), que precisam de `cloudwatch:ListMetrics` e `cloudwatch:GetMetricData`:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **Deixe `stats` sem definir.** Sem ele, cada métrica chega como um resumo por período, que é o que o OneUptime lê.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit` precisa estar definido, e limita as métricas lidas a cada coleta.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay` espera o CloudWatch publicar um período, então com esta configuração as métricas de broker de uma fila chegam com 11 a 17 minutos de atraso: um monitor sobre elas precisa de uma janela mais longa (veja **Métricas atrasadas** em [Alertas](/docs/telemetry/queues#alerting)).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- Um receptor lê uma região e um namespace: adicione uma instância por região.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "Para transmitir as métricas em vez disso — um CloudWatch Metric Stream pelo Amazon Data Firehose até o receptor `awsfirehose` do coletor —, veja [Amazon SQS](/docs/telemetry/queues#amazon-sqs).",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "Envie algumas mensagens pelas suas filas. A cada 10 minutos o OneUptime lê os spans dos últimos 15 minutos e lista, em **Filas**, cada destino que pelo menos 3 deles nomeiam (spans de qualquer tipo, exceto SERVER). Em um OneUptime auto-hospedado, `MESSAGE_QUEUE_MIN_SPANS` define esse número.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Um único ponto de dados de uma métrica de broker que uma página de fila exibe em gráfico também cria a fila dela: as métricas de monitoramento em nuvem chegam atrasadas, então cada execução as lê dos últimos 60 minutos. As métricas de clientes de mensageria, e as suas próprias métricas que carregam `messaging.system` e `messaging.destination.name`, nunca criam uma fila: elas aparecem na aba **Métricas** de uma fila que já existe.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "As filas só são criadas sozinhas enquanto o projeto estiver abaixo do seu [orçamento de criação automática](/docs/telemetry/queues#the-auto-create-budget).",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "A Visão geral da fila exibe essas métricas em gráficos em **Saúde do broker**, e cada medidor e cada contagem por período tem **Criar monitor**. Até que chegue uma, a seção diz de onde elas vêm.",
  "| Metric | Shown as | Type |": "| Métrica | Exibida como | Tipo |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished` (stream JSON: `numberofmessagespublished`) | Mensagens publicadas | Contagem por período |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (stream JSON: `numberofnotificationsdelivered`) | Notificações entregues | Contagem por período |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (stream JSON: `numberofnotificationsfailed`) | Notificações com falha | Contagem por período |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (stream JSON: `numberofnotificationsredriventodlq`) | Redirecionadas para a fila de dead-letter | Contagem por período |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- Os spans dela não nomeiam nenhum sistema de mensageria que o OneUptime saiba reconhecer: os spans do Celery, a telemetria do próprio BullMQ ou um cliente feito à mão. Adicione `messaging.system` e `messaging.destination.name`, e dê aos spans o tipo PRODUCER ou CONSUMER.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- O nome dela é um dos que o OneUptime ignora (veja [O que é ignorado](/docs/telemetry/queues#what-is-ignored)), ou apenas spans SERVER a nomeiam.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- Menos de 3 dos spans dela chegaram nos últimos 15 minutos, ou o projeto atingiu o seu [orçamento de criação automática](/docs/telemetry/queues#the-auto-create-budget).",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "Quando os spans dela a nomeiam de fato, crie-a manualmente com o mesmo sistema e destino (**Filas → Criar: Fila**): a guia **Traços** dela é preenchida com os spans já armazenados.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "Veja [Uma fila que meus aplicativos usam não foi criada](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) na página de documentação de filas.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- Verifique o log do coletor. O OneUptime recusa uma chave de ingestão errada com `401` (`422` para uma chave desativada ou uma chave de Navegador), e o coletor registra `Exporting failed` para cada lote que descarta.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- Elas estão atrasadas. `aws_cloudwatch` espera `delay` (10 minutos) pela publicação do CloudWatch, então os pontos dele chegam com 11 a 17 minutos de atraso.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "Veja [A saúde do broker continua vazia](/docs/telemetry/queues#broker-health-stays-empty) na página de documentação de filas.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- Dois sistemas o nomeiam: um cliente Kafka no endpoint Kafka do Event Hubs informa `kafka`, e o SDK do Event Hubs, `eventhubs`.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Uma observação do Service Bus ou do Event Hubs não tem namespace: o emulador ou um domínio personalizado.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- Os spans do RabbitMQ costumam nomear a exchange, e as métricas do broker a fila: duas filas no OneUptime, a menos que a exchange e a fila tenham o mesmo nome.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "Arquive a que você não quer: uma fila arquivada continua arquivada, e o que a nomeia não cria mais uma nova.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "Veja [Duas filas para um só destino](/docs/telemetry/queues#two-queues-for-one-destination) na página de documentação de filas.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "Um destino nomeado por requisição ou por consumidor que o OneUptime não reconhece — um sufixo numérico, um hash — gera uma fila por nome. UUIDs já são agrupados (veja [O que é ignorado](/docs/telemetry/queues#what-is-ignored)). Marque esses destinos com `messaging.destination.temporary=true` na sua instrumentação, ou dê a eles um nome estável, e depois arquive as filas já criadas.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "Veja [Uma fila nova para cada requisição](/docs/telemetry/queues#a-new-queue-for-every-request) na página de documentação de filas.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Amazon SQS aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia as chamadas de SQS do AWS SDK sem mudanças no código.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: o pacote `OpenTelemetry.Instrumentation.AWS`, com `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; o conjunto de atributos padrão dele nomeia uma fila do SQS apenas pela URL dela.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore`, ou `opentelemetry-instrumentation-boto3sqs`.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), adicionado com `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Os spans de SQS dele carregam a URL da fila em `server.address`, que o OneUptime lê como a fila.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Leia as métricas do CloudWatch das filas com o receptor `aws_cloudwatch` do coletor, ou transmita-as por um CloudWatch Metric Stream e o Amazon Data Firehose para o receptor `awsfirehose` dele.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (stream JSON: `approximatenumberofmessagesvisible`) | Mensagens visíveis | Medidor |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (stream JSON: `approximateageofoldestmessage`) | Idade da mensagem mais antiga | Medidor |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (stream JSON: `approximatenumberofmessagesnotvisible`) | Mensagens em trânsito | Medidor |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent` (stream JSON: `numberofmessagessent`) | Mensagens enviadas | Contagem por período |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (stream JSON: `numberofmessagesreceived`) | Mensagens recebidas | Contagem por período |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (stream JSON: `numberofmessagesdeleted`) | Mensagens excluídas | Contagem por período |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Apache ActiveMQ aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "Os spans nomeiam o sistema como `messaging.system` = `activemq` (também aceitos: `artemis`, `activemq_artemis`).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: o agente Java do OpenTelemetry rastreia clientes JMS — ActiveMQ, Artemis, IBM MQ e qualquer outro broker JMS — sem mudanças no código. Os spans JMS dizem `jms` seja qual for o broker por trás deles; uma fila do ActiveMQ é identificada por essa família JMS, então os spans dos clientes dela e as métricas do broker dela chegam a uma só fila.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "O coletor não tem receptor JMX, então execute o OpenTelemetry JMX Scraper com `OTEL_JMX_TARGET_SYSTEM=activemq` ao lado de um broker ActiveMQ Classic; ele envia as métricas de destino do broker por OTLP.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. Faça o broker aceitar conexões JMX. Com a imagem `apache/activemq-classic` ou o script `bin/activemq`, defina `ACTIVEMQ_SUNJMX_START` antes de iniciá-lo. Este exemplo desativa a autenticação: mantenha a porta em uma rede privada, ou ative `jmxremote.authenticate` com um arquivo de senhas e dê ao scraper `OTEL_JMX_USERNAME` e `OTEL_JMX_PASSWORD`.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. Execute o scraper onde ele alcance essa porta, com um runtime Java. Ele envia direto para o OneUptime:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation` mantém os nomes de métrica que o scraper usa desde a 1.53.0-alpha (`activemq.message.queue.size`, com o destino em `messaging.destination.name`); o OneUptime também lê os nomes antigos (`activemq.message.current`, com o destino em `destination`). O ActiveMQ Artemis tem outros MBeans, que estas regras não leem.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "Um único ponto de dados de uma métrica de broker que uma página de fila exibe em gráfico também cria a fila dela. As métricas de clientes de mensageria, e as suas próprias métricas que carregam `messaging.system` e `messaging.destination.name`, nunca criam uma fila: elas aparecem na aba **Métricas** de uma fila que já existe.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | Tamanho da fila | Medidor |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | Tamanho da fila (nomes antigos) | Medidor |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | Enfileiradas | Contador, exibido por segundo |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | Removidas da fila | Contador, exibido por segundo |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | Expirado | Contador, exibido por segundo |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | Consumidores | Medidor |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | Tempo médio na fila | Medidor |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | Tempo médio na fila (nomes antigos) | Medidor |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- A métrica nomeia a fila de forma diferente dos spans (veja [Limitações](/docs/telemetry/queues#limitations)).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Apache Kafka aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "Os spans nomeiam o sistema como `messaging.system` = `kafka`.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia produtores e consumidores do Kafka sem mudanças no código.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka` com o pacote `OpenTelemetry.Instrumentation.ConfluentKafka`.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node` rastreia `kafkajs`.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` ou `opentelemetry-instrumentation-aiokafka`.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: a autoinstrumentação do OpenTelemetry Go (`go.opentelemetry.io/auto`, eBPF, no Linux) rastreia produtores e consumidores do `segmentio/kafka-go` sem mudanças no código.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "O receptor `kafka_metrics` do coletor lê dos brokers o atraso dos grupos de consumidores e os offsets das partições; ative os scrapers `topics` e `consumers` dele.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "Para um cluster com SASL ou TLS, descomente `auth` e `tls`. O receptor nomeia cada tópico em `topic`, e é assim que as métricas encontram a fila do tópico. Ele informa o atraso e os offsets confirmados de um grupo de consumidores apenas nos tópicos em que o grupo confirmou um offset, e ignora os tópicos cujo nome começa com `_`.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | Atraso dos consumidores | Medidor |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | Atraso da partição | Medidor |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | Consumidas | Contador, exibido por segundo |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | Produzidas | Contador, exibido por segundo |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- O Kafka informa o atraso de um grupo de consumidores só depois que o grupo confirma um offset. O receptor ignora os tópicos cujo nome começa com `_`.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Apache Pulsar aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "Os spans nomeiam o sistema como `messaging.system` = `pulsar` (também aceitos: `apache_pulsar`).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia clientes do Pulsar sem mudanças no código.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "Cada broker expõe as métricas de tópicos e assinaturas na porta do seu serviço web; colete cada broker, porque um broker só informa os tópicos que possui naquele momento.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "O Pulsar rotula cada série com o nome completo do tópico (`persistent://public/default/orders`), e as de uma partição com o da partição: as partições se somam no tópico delas.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | Acúmulo | Medidor |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | Acúmulo da assinatura | Medidor |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | Idade do acúmulo | Medidor |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | Mensagens de entrada | Contador, exibido por segundo |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | Mensagens de saída | Contador, exibido por segundo |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Apache RocketMQ aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia clientes do RocketMQ sem mudanças no código.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "Defina `metricsExporterType=PROM` no `broker.conf` do broker para que o broker exponha suas métricas de atraso e vazão.",
  "Then scrape every broker:": "Depois colete cada broker:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | Mensagens prontas | Medidor |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | Enviadas para a fila de dead-letter | Contador, exibido por segundo |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Azure Event Grid aparecem sozinhas no OneUptime, a partir dos spans de mensageria dos aplicativos que publicam nelas e consomem delas. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "O Azure Monitor tem as métricas de entrega e de mensagens mortas dos tópicos, que o receptor `azure_monitor` do coletor lê; elas ainda não aparecem nos gráficos de uma página de fila, então explore-as em Métricas.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "O receptor se autentica pela extensão `azure_auth`: dê à entidade de serviço a função **Monitoring Reader** na assinatura, e defina `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` e `AZURE_SUBSCRIPTION_ID` no ambiente do coletor.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "As métricas de clientes de mensageria, e as suas próprias métricas que carregam `messaging.system` e `messaging.destination.name`, nunca criam uma fila: elas aparecem na aba **Métricas** de uma fila que já existe.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "O OneUptime não exibe métricas de broker para Azure Event Grid em **Saúde do broker**: o que o coletor acima envia chega apenas ao explorador de **Métricas**. Uma métrica que carrega `messaging.system` e `messaging.destination.name` em cada ponto de dados aparece na aba **Métricas** da fila.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid não tem métricas exibidas em gráficos. As métricas dele estão no explorador de **Métricas**.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Azure Event Hubs aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: o Azure SDK para Java rastreia a si mesmo, e o agente Java do OpenTelemetry conecta esse rastreamento ao OpenTelemetry.",
  '- **.NET**: the Azure SDK\'s OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource("Azure.*")`.':
    '- **.NET**: os spans OpenTelemetry do Azure SDK são experimentais: defina `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (ou a opção `Azure.Experimental.EnableActivitySource`) e assine as fontes do Azure com `.AddSource("Azure.*")`.',
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: registre `createAzureSdkInstrumentation()` de `@azure/opentelemetry-instrumentation-azure-sdk`.",
  '- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).':
    '- **Python**: instale `azure-core-tracing-opentelemetry` e defina `settings.tracing_implementation = "opentelemetry"` (de `azure.core.settings`).',
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "Uma assinatura do Azure conectada lê as métricas principais do namespace para cada event hub, sem nada para executar. Para ler todas, execute o receptor `azure_monitor` do coletor, que as divide por event hub segundo a dimensão EntityName.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "O receptor lista seus namespaces uma vez por dia, então um namespace novo pode levar até 24 horas para aparecer.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | Mensagens recebidas | Contagem por período |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | Mensagens enviadas | Contagem por período |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | Erros do servidor | Contagem por período |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | Erros do usuário | Contagem por período |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | Erros de cota excedida | Contagem por período |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | Solicitações limitadas | Contagem por período |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | Tamanho | Medidor |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- A métrica nomeia a fila de forma diferente dos spans. Os spans do Service Bus e do Event Hubs sem host de namespace ficam em uma fila diferente das métricas do Azure Monitor (veja [Limitações](/docs/telemetry/queues#limitations)).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- O Azure Monitor retorna 10 filas por métrica e namespace, a menos que `maximum_number_of_records_per_resource` seja aumentado. A configuração da etapa 3 o aumenta.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- O receptor lista seus namespaces uma vez por dia, então um namespace novo pode levar até 24 horas para aparecer.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Azure Service Bus aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "Uma assinatura do Azure conectada lê as métricas principais do namespace para cada fila e tópico, sem nada para executar. Para ler todas, execute o receptor `azure_monitor` do coletor, que as divide por fila e tópico segundo a dimensão EntityName.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | Mensagens ativas | Medidor |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | Mensagens em dead-letter | Medidor |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | Mensagens agendadas | Medidor |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | Mensagens concluídas | Contagem por período |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | Mensagens abandonadas | Contagem por período |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | Latência de envio do servidor | Medidor |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de BullMQ aparecem sozinhas no OneUptime, a partir dos spans de mensageria dos aplicativos que publicam nelas e consomem delas. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "A telemetria própria do BullMQ (a opção `telemetry` dele, que o pacote `bullmq-otel` implementa) nomeia a fila em `bullmq.queue.name` e não define nenhum `messaging.system`, então sozinha não cria nenhuma fila. Um processador `transform` no coletor para o qual seus aplicativos enviam acrescenta as duas chaves que o OneUptime lê, nos spans que adicionam e processam jobs e nas métricas do próprio BullMQ:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "Só os spans PRODUCER que adicionam jobs e os spans CONSUMER que os processam são marcados: os spans internos do BullMQ também nomeiam a fila, mas não são mensagens. Aponte o exportador OTLP dos seus aplicativos para este coletor.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "O BullMQ guarda seus jobs no Redis e não tem um broker para coletar; informe a profundidade da fila a partir do aplicativo como uma métrica que carregue `messaging.system` e `messaging.destination.name`, como os próprios workers do OneUptime fazem com `queue.size`.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "Observe as contagens de jobs no aplicativo; um medidor que já carrega as duas chaves não precisa de transformação:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "O OneUptime não exibe métricas de broker para BullMQ em **Saúde do broker**. Tudo o que um coletor envia está no explorador de **Métricas**, e uma métrica que carrega `messaging.system` e `messaging.destination.name` em cada ponto de dados aparece na aba **Métricas** da fila.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- Os spans dela não nomeiam nenhum sistema de mensageria que o OneUptime saiba reconhecer: os spans do Celery, a telemetria do próprio BullMQ ou um cliente feito à mão. Adicione `messaging.system` e `messaging.destination.name`, e dê aos spans o tipo PRODUCER ou CONSUMER. Para o BullMQ, a transformação da etapa 2 faz isso.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ não tem métricas exibidas em gráficos. As métricas dele estão no explorador de **Métricas**.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de Google Cloud Pub/Sub aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: o cliente rastreia a si mesmo assim que os builders `Publisher` e `Subscriber` dele recebem uma instância do OpenTelemetry e a opção de rastreamento — `setOpenTelemetry(GlobalOpenTelemetry.get())` e `setEnableOpenTelemetryTracing(true)`. Qualquer uma das chamadas sozinha não rastreia nada.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: com `new PubSub({ enableOpenTelemetryTracing: true })`.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` e `SubscriberOptions(enable_open_telemetry_tracing=True)`.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: com `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Leia as métricas dos tópicos e das assinaturas no Cloud Monitoring com o receptor `googlecloudmonitoring` do coletor, listando cada tipo de métrica em `metrics_list`.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "O receptor se autentica com o Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, ou a conta de serviço com que o coletor roda), que precisa da função **Monitoring Viewer** no projeto. Defina `project_id` como o seu projeto:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "Um tipo de métrica que falta em `metrics_list` nunca é lido. As métricas de assinatura vão para a fila da assinatura (`subscription_id`), as de tópico para a do tópico (`topic_id`).",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Mensagens não entregues | Medidor |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Idade da mensagem não confirmada mais antiga | Medidor |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Mensagens em dead-letter | Contagem por período |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | Mensagens confirmadas | Contagem por período |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | Solicitações de publicação | Contagem por período |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- A métrica nomeia a fila de forma diferente dos spans. Um tópico do Pub/Sub tem as métricas de tópico e as assinaturas dele as métricas de assinatura.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- O Cloud Monitoring lê apenas os tipos em `metrics_list`.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- Elas estão atrasadas. As métricas do Pub/Sub chegam com minutos de atraso.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de JMS aparecem sozinhas no OneUptime, a partir dos spans de mensageria dos aplicativos que publicam nelas e consomem delas. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "O JMS é uma API, e os spans dele não nomeiam o broker por trás; quando o broker é o Apache ActiveMQ, execute o OpenTelemetry JMX Scraper contra ele e as métricas dele se juntam à mesma fila, que então aparece como uma fila do ActiveMQ, enquanto outros brokers JMS como o IBM MQ não têm um caminho de métricas pronto.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "As métricas dele se juntam à mesma fila dos spans JMS, que a partir daí aparece como uma fila do Apache ActiveMQ.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "O OneUptime não exibe métricas de broker para JMS em **Saúde do broker**. Tudo o que um coletor envia está no explorador de **Métricas**, e uma métrica que carrega `messaging.system` e `messaging.destination.name` em cada ponto de dados aparece na aba **Métricas** da fila.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Assim que chegam as métricas de um broker Apache ActiveMQ, a fila aparece como uma fila do Apache ActiveMQ e as exibe em gráficos em **Saúde do broker**: veja [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- Brokers JMS além do ActiveMQ não têm métricas em gráficos. As métricas deles estão no explorador de **Métricas**. Para um broker ActiveMQ, veja **Se o broker for Apache ActiveMQ** em **Avançado**.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de NATS aparecem sozinhas no OneUptime, a partir dos spans de mensageria dos aplicativos que publicam nelas e consomem delas. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia clientes NATS — a instrumentação NATS dele informa `messaging.system` = `nats` — sem mudanças no código.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "Execute o prometheus-nats-exporter com `-jsz=all` contra a porta de monitoramento do servidor. As métricas JetStream dele são por stream e por consumidor, não por subject, então não se associam às filas no nível do subject.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "Ative a porta de monitoramento do servidor com `-m 8222` (ou `http_port: 8222` na configuração dele) e depois execute o exportador:",
  "And scrape it:": "E colete-o:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "O OneUptime não exibe métricas de broker para NATS em **Saúde do broker**: o que o coletor acima envia chega apenas ao explorador de **Métricas**. Uma métrica que carrega `messaging.system` e `messaging.destination.name` em cada ponto de dados aparece na aba **Métricas** da fila.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS não tem métricas exibidas em gráficos. As métricas dele estão no explorador de **Métricas**.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "As filas de RabbitMQ aparecem sozinhas no OneUptime, a partir de duas fontes: os spans de mensageria dos aplicativos que publicam nelas e consomem delas, e as métricas do próprio broker. Você também pode adicionar uma manualmente: **Filas → Criar: Fila**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: o agente Java do OpenTelemetry rastreia clientes do RabbitMQ sem mudanças no código.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7 rastreia a si mesmo: assine `RabbitMQ.Client.*`. O MassTransit também rastreia a si mesmo: assine `MassTransit`.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` ou `opentelemetry-instrumentation-aio-pika`.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "O receptor `rabbitmq` do coletor lê a profundidade, os consumidores e as taxas de mensagens de cada fila pela API HTTP do plugin de gerenciamento, como um usuário com a tag `monitoring` e acesso a cada host virtual.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "Ative o plugin de gerenciamento e crie esse usuário. A tag `monitoring` sozinha não mostra nenhuma fila a ele: dê a ele acesso a cada virtual host a monitorar. Padrões vazios concedem esse acesso sem nenhum direito de configurar, publicar ou consumir:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "Defina `RABBITMQ_USERNAME` e `RABBITMQ_PASSWORD` no ambiente do coletor. O receptor informa cada fila pelo nome dela no RabbitMQ, enquanto os spans da maioria das instrumentações nomeiam a exchange pela qual uma mensagem passou: os dois se encontram nas mensagens enviadas pela exchange padrão, cuja routing key é o nome da fila.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | Profundidade da fila | Medidor |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | Publicadas | Contador, exibido por segundo |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | Entregues | Contador, exibido por segundo |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | Confirmado | Contador, exibido por segundo |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | Descartadas | Contador, exibido por segundo |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- A métrica nomeia a fila de forma diferente dos spans. Os spans do RabbitMQ costumam nomear a exchange, enquanto as métricas do broker descrevem filas. Os dois se encontram nas mensagens enviadas pela exchange padrão, cuja routing key é o nome da fila.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- O RabbitMQ informa apenas as filas dos virtual hosts aos quais o usuário dele tem acesso, e não registra erro para o resto. Os contadores do RabbitMQ aparecem com a primeira atividade.",
};

export default TRANSLATION;
