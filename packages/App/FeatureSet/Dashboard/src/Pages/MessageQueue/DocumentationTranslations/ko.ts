import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The MessageQueue setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/MessageQueue/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Amazon SNS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SNS 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "Spans name the system as `messaging.system` = `aws.sns` (also accepted: `aws_sns`, `amazonsns`, `sns`).":
    "스팬은 시스템을 `messaging.system` = `aws.sns`(으)로 나타냅니다(`aws_sns`, `amazonsns`, `sns`도 허용됩니다).",
  "Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed.":
    "큐는 OpenTelemetry 계측이 이미 만들어 내는 메시징 스팬에서 생깁니다. OneUptime 전용으로 필요한 것은 없습니다.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SNS calls without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 AWS SDK의 SNS 호출을 트레이스합니다.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set does not name an SNS topic at all.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` 패키지를 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`와 함께 사용합니다. 기본 속성 집합은 SNS 토픽을 전혀 나타내지 않습니다.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces the AWS SDK.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node`가 AWS SDK를 트레이스합니다.",
  "- **Python**: `opentelemetry-instrumentation-botocore`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` 패키지를 사용합니다.",
  "- **Go**: `otelaws`, added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`.":
    "- **Go**: `otelaws`를 `otelaws.AppendMiddlewares(&cfg.APIOptions)`로 추가합니다.",
  "- **Any other client**: use the client library's own OpenTelemetry support, or set `messaging.system` = `aws.sns`, `messaging.destination.name` and the span kind (PRODUCER when publishing, CONSUMER when consuming) on the spans around your sends and handlers.":
    "- **그 밖의 클라이언트**: 클라이언트 라이브러리 자체의 OpenTelemetry 지원을 사용하거나, 전송과 핸들러를 감싸는 스팬에 `messaging.system` = `aws.sns`, `messaging.destination.name`, 스팬 종류(게시할 때는 PRODUCER, 소비할 때는 CONSUMER)를 설정하세요.",
  "Then point the OTLP exporter at OneUptime. Most SDKs and agents read these environment variables:":
    "그런 다음 OTLP 익스포터가 OneUptime을 가리키게 하세요. 대부분의 SDK와 에이전트는 다음 환경 변수를 읽습니다:",
  "> **This token is a secret.** Use a **Server** ingestion key, kept in your\n> deployment's secrets. Never put a Server key in browser JavaScript — a\n> **Browser** ingestion key exists for that.":
    "> **이 토큰은 비밀입니다.** **서버** 수집 키를 사용하고 배포의 시크릿에\n> 보관하세요. 서버 키를 브라우저 JavaScript에 넣지 마세요. 그 용도로는\n> **브라우저** 수집 키가 있습니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Collector의 `aws_cloudwatch` 리시버로 토픽의 CloudWatch 메트릭을 읽거나, CloudWatch Metric Stream과 Amazon Data Firehose를 거쳐 그 `awsfirehose` 리시버로 스트리밍하세요.",
  "The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API with the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:":
    "`aws_cloudwatch` 리시버는 AWS SDK의 기본 자격 증명(환경, 공유 프로필 또는 인스턴스 역할)으로 CloudWatch의 `GetMetricData` API를 폴링하며, 이 자격 증명에는 `cloudwatch:ListMetrics`와 `cloudwatch:GetMetricData`가 필요합니다:",
  "- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads.":
    "- **`stats`는 설정하지 마세요.** 설정하지 않으면 각 메트릭이 기간마다 요약 하나로 도착하며, OneUptime은 그것을 읽습니다.",
  "- `discovery.limit` must be set, and caps the metrics read per scrape.":
    "- `discovery.limit`는 반드시 설정해야 하며, 스크레이프 한 번에 읽는 메트릭 수의 상한입니다.",
  "- `delay` waits for CloudWatch to publish a period, so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](/docs/telemetry/queues#alerting)).":
    "- `delay`는 CloudWatch가 기간을 게시할 때까지 기다리므로, 이 구성에서는 큐의 브로커 메트릭이 11~17분 늦게 도착합니다. 이를 대상으로 하는 모니터에는 더 긴 기간이 필요합니다([경고](/docs/telemetry/queues#alerting)의 **늦게 도착하는 메트릭** 참조).",
  "- One receiver reads one region and one namespace: add an instance per region.":
    "- 하나의 리시버는 하나의 리전과 하나의 네임스페이스를 읽습니다: 리전마다 인스턴스를 추가하세요.",
  "To stream the metrics instead — a CloudWatch Metric Stream through Amazon Data Firehose to the collector's `awsfirehose` receiver — see [Amazon SQS](/docs/telemetry/queues#amazon-sqs).":
    "대신 메트릭을 스트리밍하려면(CloudWatch Metric Stream에서 Amazon Data Firehose를 거쳐 컬렉터의 `awsfirehose` 리시버로) [Amazon SQS](/docs/telemetry/queues#amazon-sqs)를 참조하세요.",
  "Send a few messages through your queues. Every 10 minutes OneUptime reads the last 15 minutes of spans and lists, under **Queues**, each destination at least 3 of them name (spans of any kind but SERVER). On a self-hosted OneUptime, `MESSAGE_QUEUE_MIN_SPANS` sets that number.":
    "큐로 메시지를 몇 개 보내세요. OneUptime은 10분마다 최근 15분의 스팬을 읽고, 그중 3개 이상이 나타내는 대상을 **큐**에 나열합니다(SERVER를 제외한 모든 종류의 스팬). 셀프 호스팅 OneUptime에서는 `MESSAGE_QUEUE_MIN_SPANS`로 이 수를 정합니다.",
  "One datapoint of a broker metric a queue page charts creates its queue too: cloud monitoring metrics arrive late, so each run reads them from the last 60 minutes. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "큐 페이지가 차트로 표시하는 브로커 메트릭은 데이터 포인트 하나만 도착해도 그 큐를 만듭니다. 클라우드 모니터링 메트릭은 늦게 도착하므로, 매 실행마다 최근 60분에서 읽습니다. 메시징 클라이언트 메트릭과, `messaging.system` 및 `messaging.destination.name`을 담은 자체 메트릭은 큐를 만들지 않습니다. 이미 있는 큐의 **메트릭** 탭에 표시됩니다.",
  "Queues are created on their own only while the project is under its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "큐는 프로젝트가 [자동 생성 한도](/docs/telemetry/queues#the-auto-create-budget) 아래에 있는 동안에만 자동으로 만들어집니다.",
  "The queue's Overview charts these under **Broker health**, and each gauge and each count per period has **Create monitor**. Until one arrives, the section says where they come from.":
    "큐의 개요는 이를 **브로커 상태**에 차트로 표시하며, 각 게이지와 기간별 개수마다 **모니터 생성**이 있습니다. 하나라도 도착하기 전까지 이 섹션은 메트릭이 어디서 오는지 알려 줍니다.",
  "| Metric | Shown as | Type |":
    "| 메트릭 | 표시 이름 | 유형 |",
  "| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |":
    "| `amazonaws.com/aws/sns/numberofmessagespublished`(JSON 스트림: `numberofmessagespublished`) | 게시된 메시지 | 기간별 개수 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsdelivered`(JSON 스트림: `numberofnotificationsdelivered`) | 전달된 알림 | 기간별 개수 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsfailed`(JSON 스트림: `numberofnotificationsfailed`) | 실패한 알림 | 기간별 개수 |",
  "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |":
    "| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq`(JSON 스트림: `numberofnotificationsredriventodlq`) | 배달 못 한 편지 큐로 재전송 | 기간별 개수 |",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.":
    "- 그 스팬이 OneUptime이 구분할 수 있는 메시징 시스템을 나타내지 않습니다. Celery의 스팬, BullMQ 자체의 텔레메트리 또는 직접 만든 클라이언트가 그렇습니다. `messaging.system`과 `messaging.destination.name`을 추가하고, 스팬의 종류를 PRODUCER 또는 CONSUMER로 지정하세요.",
  "- Its name is one OneUptime ignores (see [What is ignored](/docs/telemetry/queues#what-is-ignored)), or only SERVER spans name it.":
    "- 그 이름이 OneUptime이 무시하는 이름이거나([무시되는 항목](/docs/telemetry/queues#what-is-ignored) 참조), SERVER 스팬만 그 큐를 나타냅니다.",
  "- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](/docs/telemetry/queues#the-auto-create-budget).":
    "- 최근 15분 동안 도착한 스팬이 3개 미만이거나, 프로젝트가 [자동 생성 한도](/docs/telemetry/queues#the-auto-create-budget)에 도달했습니다.",
  "When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.":
    "스팬이 실제로 큐를 지정한다면 같은 시스템과 대상으로 직접 만드세요(**큐 → 큐 만들기**): 그 **트레이스** 탭은 이미 저장된 스팬으로 채워집니다.",
  "See [A queue my applications use was not created](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created) on the Queues documentation page.":
    "큐 문서 페이지의 [애플리케이션이 사용하는 큐가 생성되지 않음](/docs/telemetry/queues#a-queue-my-applications-use-was-not-created)을(를) 참조하세요.",
  "- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a Browser key), and the collector logs `Exporting failed` for every batch it drops.":
    "- 컬렉터의 로그를 확인하세요. OneUptime은 잘못된 수집 키를 `401`로 거부하고(비활성화된 키나 브라우저 키는 `422`), 컬렉터는 버리는 배치마다 `Exporting failed`를 기록합니다.",
  "- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late.":
    "- 늦게 도착하는 중입니다. `aws_cloudwatch`는 CloudWatch가 게시할 때까지 `delay`(10분)만큼 기다리므로, 데이터 포인트가 11~17분 늦게 도착합니다.",
  "See [Broker health stays empty](/docs/telemetry/queues#broker-health-stays-empty) on the Queues documentation page.":
    "큐 문서 페이지의 [브로커 상태가 비어 있음](/docs/telemetry/queues#broker-health-stays-empty)을(를) 참조하세요.",
  "- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.":
    "- 두 시스템이 그 대상을 지정합니다: Event Hubs의 Kafka 엔드포인트에 연결된 Kafka 클라이언트는 `kafka`를, Event Hubs SDK는 `eventhubs`를 보고합니다.",
  "- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.":
    "- Service Bus 또는 Event Hubs의 한 관측에 네임스페이스가 없습니다: 에뮬레이터나 사용자 지정 도메인입니다.",
  "- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name.":
    "- RabbitMQ 스팬은 보통 exchange를 나타내고 브로커의 메트릭은 큐를 나타냅니다. exchange와 큐의 이름이 같지 않으면 OneUptime에 큐가 두 개 생깁니다.",
  "Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.":
    "원하지 않는 큐를 보관하세요: 보관된 큐는 보관된 상태로 남으며, 그 큐를 지정하는 것이 더 이상 새 큐를 만들지 않습니다.",
  "See [Two queues for one destination](/docs/telemetry/queues#two-queues-for-one-destination) on the Queues documentation page.":
    "큐 문서 페이지의 [하나의 대상에 큐가 두 개](/docs/telemetry/queues#two-queues-for-one-destination)을(를) 참조하세요.",
  "A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](/docs/telemetry/queues#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.":
    "OneUptime이 인식하지 못하는, 요청이나 소비자마다 이름이 붙는 대상(숫자 접미사, 해시)은 이름마다 큐를 만듭니다. UUID는 이미 하나로 묶입니다([무시되는 항목](/docs/telemetry/queues#what-is-ignored) 참조). 그런 대상은 계측에서 `messaging.destination.temporary=true`로 표시하거나 고정된 이름을 붙인 다음, 이미 만들어진 큐를 보관하세요.",
  "See [A new queue for every request](/docs/telemetry/queues#a-new-queue-for-every-request) on the Queues documentation page.":
    "큐 문서 페이지의 [요청마다 새 큐가 생김](/docs/telemetry/queues#a-new-queue-for-every-request)을(를) 참조하세요.",
  "Amazon SQS queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Amazon SQS 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the OpenTelemetry Java agent traces the AWS SDK's SQS calls without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 AWS SDK의 SQS 호출을 트레이스합니다.",
  "- **.NET**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`; its default attribute set names an SQS queue only by its URL.":
    "- **.NET**: `OpenTelemetry.Instrumentation.AWS` 패키지를 `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`와 함께 사용합니다. 기본 속성 집합은 SQS 큐를 URL로만 나타냅니다.",
  "- **Python**: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs`.":
    "- **Python**: `opentelemetry-instrumentation-botocore` 또는 `opentelemetry-instrumentation-boto3sqs`를 사용합니다.",
  "- **Go**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.":
    "- **Go**: `otelaws`(`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`)를 `otelaws.AppendMiddlewares(&cfg.APIOptions)`로 추가합니다. 그 SQS 스팬은 `server.address`에 큐 URL을 담으며, OneUptime은 이를 큐로 읽습니다.",
  "Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.":
    "Collector의 `aws_cloudwatch` 리시버로 큐의 CloudWatch 메트릭을 읽거나, CloudWatch Metric Stream과 Amazon Data Firehose를 거쳐 그 `awsfirehose` 리시버로 스트리밍하세요.",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible`(JSON 스트림: `approximatenumberofmessagesvisible`) | 표시되는 메시지 | 게이지 |",
  "| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |":
    "| `amazonaws.com/aws/sqs/approximateageofoldestmessage`(JSON 스트림: `approximateageofoldestmessage`) | 가장 오래된 메시지 경과 시간 | 게이지 |",
  "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |":
    "| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible`(JSON 스트림: `approximatenumberofmessagesnotvisible`) | 처리 중인 메시지 | 게이지 |",
  "| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagessent`(JSON 스트림: `numberofmessagessent`) | 보낸 메시지 | 기간별 개수 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesreceived`(JSON 스트림: `numberofmessagesreceived`) | 받은 메시지 | 기간별 개수 |",
  "| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |":
    "| `amazonaws.com/aws/sqs/numberofmessagesdeleted`(JSON 스트림: `numberofmessagesdeleted`) | 삭제된 메시지 | 기간별 개수 |",
  "Apache ActiveMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache ActiveMQ 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "Spans name the system as `messaging.system` = `activemq` (also accepted: `artemis`, `activemq_artemis`).":
    "스팬은 시스템을 `messaging.system` = `activemq`(으)로 나타냅니다(`artemis`, `activemq_artemis`도 허용됩니다).",
  "- **Java**: the OpenTelemetry Java agent traces JMS clients — ActiveMQ, Artemis, IBM MQ and every other JMS broker — without code changes. JMS spans say `jms` whichever broker is behind them; an ActiveMQ queue is keyed on that JMS family, so its clients' spans and its broker's metrics land on one queue.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 JMS 클라이언트(ActiveMQ, Artemis, IBM MQ 및 그 밖의 모든 JMS 브로커)를 트레이스합니다. JMS 스팬은 뒤에 어떤 브로커가 있든 `jms`를 나타냅니다. ActiveMQ 큐는 그 JMS 계열로 식별되므로, 클라이언트의 스팬과 브로커의 메트릭이 하나의 큐에 모입니다.",
  "The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.":
    "Collector에는 JMX 리시버가 없으므로, ActiveMQ Classic 브로커 옆에서 `OTEL_JMX_TARGET_SYSTEM=activemq`로 OpenTelemetry JMX Scraper를 실행하세요. 스크레이퍼는 브로커의 대상 메트릭을 OTLP로 푸시합니다.",
  "1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.":
    "1. 브로커가 JMX 연결을 받도록 하세요. `apache/activemq-classic` 이미지나 `bin/activemq` 스크립트에서는 시작하기 전에 `ACTIVEMQ_SUNJMX_START`를 설정하세요. 이 예시는 인증을 끕니다: 포트를 사설 네트워크에 두거나, 암호 파일로 `jmxremote.authenticate`를 켜고 스크레이퍼에 `OTEL_JMX_USERNAME`과 `OTEL_JMX_PASSWORD`를 전달하세요.",
  "2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime:":
    "2. 그 포트에 닿는 곳에서 Java 런타임으로 스크레이퍼를 실행하세요. OneUptime으로 바로 보냅니다:",
  "`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`); OneUptime also reads the older names (`activemq.message.current`, with the destination in `destination`). ActiveMQ Artemis has different MBeans, which these rules do not read.":
    "`OTEL_JMX_TARGET_SOURCE=instrumentation`은 스크레이퍼가 1.53.0-alpha부터 써 온 메트릭 이름(`activemq.message.queue.size`, 대상은 `messaging.destination.name`)을 유지합니다. OneUptime은 이전 이름(`activemq.message.current`, 대상은 `destination`)도 읽습니다. ActiveMQ Artemis는 MBean이 달라 이 규칙으로 읽지 않습니다.",
  "One datapoint of a broker metric a queue page charts creates its queue too. Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "큐 페이지가 차트로 표시하는 브로커 메트릭은 데이터 포인트 하나만 도착해도 그 큐를 만듭니다. 메시징 클라이언트 메트릭과, `messaging.system` 및 `messaging.destination.name`을 담은 자체 메트릭은 큐를 만들지 않습니다. 이미 있는 큐의 **메트릭** 탭에 표시됩니다.",
  "| `activemq.message.queue.size` | Queue size | Gauge |":
    "| `activemq.message.queue.size` | 큐 크기 | 게이지 |",
  "| `activemq.message.current` | Queue size (legacy names) | Gauge |":
    "| `activemq.message.current` | 큐 크기(이전 이름) | 게이지 |",
  "| `activemq.message.enqueued` | Enqueued | Counter, charted per second |":
    "| `activemq.message.enqueued` | 큐에 추가됨 | 카운터, 초당 값으로 표시 |",
  "| `activemq.message.dequeued` | Dequeued | Counter, charted per second |":
    "| `activemq.message.dequeued` | 큐에서 제거됨 | 카운터, 초당 값으로 표시 |",
  "| `activemq.message.expired` | Expired | Counter, charted per second |":
    "| `activemq.message.expired` | 만료됨 | 카운터, 초당 값으로 표시 |",
  "| `activemq.consumer.count` | Consumers | Gauge |":
    "| `activemq.consumer.count` | 컨슈머 | 게이지 |",
  "| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |":
    "| `activemq.message.enqueue.average_duration` | 큐 평균 대기 시간 | 게이지 |",
  "| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |":
    "| `activemq.message.wait_time.avg` | 큐 평균 대기 시간(이전 이름) | 게이지 |",
  "- The metric names the queue differently from the spans (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 메트릭이 스팬과 다른 이름으로 큐를 나타냅니다([제한 사항](/docs/telemetry/queues#limitations) 참조).",
  "Apache Kafka queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Kafka 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "Spans name the system as `messaging.system` = `kafka`.":
    "스팬은 시스템을 `messaging.system` = `kafka`(으)로 나타냅니다.",
  "- **Java**: the OpenTelemetry Java agent traces Kafka producers and consumers without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 Kafka 프로듀서와 컨슈머를 트레이스합니다.",
  "- **.NET**: `Confluent.Kafka` with the `OpenTelemetry.Instrumentation.ConfluentKafka` package.":
    "- **.NET**: `Confluent.Kafka`를 `OpenTelemetry.Instrumentation.ConfluentKafka` 패키지와 함께 사용합니다.",
  "- **Node.js**: `@opentelemetry/auto-instrumentations-node` traces `kafkajs`.":
    "- **Node.js**: `@opentelemetry/auto-instrumentations-node`가 `kafkajs`를 트레이스합니다.",
  "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`.":
    "- **Python**: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` 또는 `opentelemetry-instrumentation-aiokafka`를 사용합니다.",
  "- **Go**: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces `segmentio/kafka-go` producers and consumers without code changes.":
    "- **Go**: OpenTelemetry Go 자동 계측(`go.opentelemetry.io/auto`, eBPF, Linux)이 코드 변경 없이 `segmentio/kafka-go`의 프로듀서와 컨슈머를 트레이스합니다.",
  "The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.":
    "Collector의 `kafka_metrics` 리시버는 브로커에서 컨슈머 그룹 지연과 파티션 오프셋을 읽습니다. `topics`와 `consumers` 스크레이퍼를 켜세요.",
  "For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_`.":
    "SASL 또는 TLS를 쓰는 클러스터라면 `auth`와 `tls`의 주석을 해제하세요. 리시버는 각 토픽을 `topic`에 나타내며, 메트릭은 이것으로 토픽의 큐를 찾습니다. 소비자 그룹의 지연과 커밋된 오프셋은 그룹이 오프셋을 커밋한 토픽에 대해서만 보고하며, 이름이 `_`로 시작하는 토픽은 건너뜁니다.",
  "| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |":
    "| `kafka.consumer_group.lag_sum` | 컨슈머 지연 | 게이지 |",
  "| `kafka.consumer_group.lag` | Partition lag | Gauge |":
    "| `kafka.consumer_group.lag` | 파티션 지연 | 게이지 |",
  "| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |":
    "| `kafka.consumer_group.offset_sum` | 소비됨 | 카운터, 초당 값으로 표시 |",
  "| `kafka.partition.current_offset` | Produced | Counter, charted per second |":
    "| `kafka.partition.current_offset` | 생성됨 | 카운터, 초당 값으로 표시 |",
  "- Kafka reports a consumer group's lag only after the group commits an offset. The receiver skips topics whose names start with `_`.":
    "- Kafka는 소비자 그룹이 오프셋을 커밋한 뒤에야 그 지연을 보고합니다. 리시버는 이름이 `_`로 시작하는 토픽을 건너뜁니다.",
  "Apache Pulsar queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache Pulsar 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "Spans name the system as `messaging.system` = `pulsar` (also accepted: `apache_pulsar`).":
    "스팬은 시스템을 `messaging.system` = `pulsar`(으)로 나타냅니다(`apache_pulsar`도 허용됩니다).",
  "- **Java**: the OpenTelemetry Java agent traces Pulsar clients without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 Pulsar 클라이언트를 트레이스합니다.",
  "Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.":
    "각 브로커는 토픽과 구독 메트릭을 웹 서비스 포트에서 제공합니다. 브로커는 현재 소유한 토픽만 보고하므로 모든 브로커를 스크레이프하세요.",
  "Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's: partitions add up into their topic.":
    "Pulsar는 각 시리즈에 토픽의 전체 이름(`persistent://public/default/orders`)을, 파티션의 시리즈에는 파티션의 이름을 레이블로 붙입니다. 파티션은 토픽으로 합산됩니다.",
  "| `pulsar_msg_backlog` | Backlog | Gauge |":
    "| `pulsar_msg_backlog` | 백로그 | 게이지 |",
  "| `pulsar_subscription_back_log` | Subscription backlog | Gauge |":
    "| `pulsar_subscription_back_log` | 구독 백로그 | 게이지 |",
  "| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |":
    "| `pulsar_storage_backlog_age_seconds` | 백로그 경과 시간 | 게이지 |",
  "| `pulsar_in_messages_total` | Messages in | Counter, charted per second |":
    "| `pulsar_in_messages_total` | 수신 메시지 | 카운터, 초당 값으로 표시 |",
  "| `pulsar_out_messages_total` | Messages out | Counter, charted per second |":
    "| `pulsar_out_messages_total` | 송신 메시지 | 카운터, 초당 값으로 표시 |",
  "Apache RocketMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Apache RocketMQ 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the OpenTelemetry Java agent traces RocketMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 RocketMQ 클라이언트를 트레이스합니다.",
  "Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.":
    "브로커의 `broker.conf`에 `metricsExporterType=PROM`을 설정해 브로커가 지연과 처리량 메트릭을 제공하게 하세요.",
  "Then scrape every broker:":
    "그런 다음 모든 브로커를 스크레이프하세요:",
  "| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |":
    "| `rocketmq_consumer_ready_messages` | 준비된 메시지 | 게이지 |",
  "| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |":
    "| `rocketmq_send_to_dlq_messages_total` | 배달 못 한 편지 큐로 전송 | 카운터, 초당 값으로 표시 |",
  "Azure Event Grid queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Grid 큐는 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬에서 OneUptime에 자동으로 나타납니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.":
    "Azure Monitor에는 토픽의 전달 및 데드 레터 메트릭이 있으며, Collector의 `azure_monitor` 리시버가 이를 읽습니다. 아직 큐 페이지에 차트로 표시되지 않으므로 메트릭에서 살펴보세요.",
  "The receiver signs in through the `azure_auth` extension: give the service principal the **Monitoring Reader** role on the subscription, and set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_SUBSCRIPTION_ID` in the collector's environment.":
    "리시버는 `azure_auth` 확장으로 로그인합니다. 서비스 주체에 구독의 **Monitoring Reader** 역할을 부여하고, 컬렉터의 환경에 `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`를 설정하세요.",
  "Messaging client metrics, and metrics of your own that carry `messaging.system` and `messaging.destination.name`, never create a queue: they show on the **Metrics** tab of one that exists.":
    "메시징 클라이언트 메트릭과, `messaging.system` 및 `messaging.destination.name`을 담은 자체 메트릭은 큐를 만들지 않습니다. 이미 있는 큐의 **메트릭** 탭에 표시됩니다.",
  "OneUptime charts no broker metrics for Azure Event Grid under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime은 Azure Event Grid의 브로커 메트릭을 **브로커 상태**에 차트로 표시하지 않습니다. 위의 컬렉터가 보내는 것은 **메트릭** 탐색기에만 도착합니다. 모든 데이터 포인트에 `messaging.system`과 `messaging.destination.name`을 담은 메트릭은 큐의 **메트릭** 탭에 표시됩니다.",
  "- Azure Event Grid has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- Azure Event Grid에는 차트로 표시되는 메트릭이 없습니다. 그 메트릭은 **메트릭** 탐색기에 있습니다.",
  "Azure Event Hubs queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Event Hubs 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the Azure SDK for Java traces itself, and the OpenTelemetry Java agent connects that tracing to OpenTelemetry.":
    "- **Java**: Azure SDK for Java는 스스로를 트레이스하며, OpenTelemetry Java 에이전트가 그 트레이스를 OpenTelemetry에 연결합니다.",
  "- **.NET**: the Azure SDK's OpenTelemetry spans are experimental: set `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch) and subscribe to the Azure sources with `.AddSource(\"Azure.*\")`.":
    "- **.NET**: Azure SDK의 OpenTelemetry 스팬은 실험적 기능입니다. `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true`(또는 `Azure.Experimental.EnableActivitySource` 스위치)를 설정하고 `.AddSource(\"Azure.*\")`로 Azure 소스를 구독하세요.",
  "- **Node.js**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.":
    "- **Node.js**: `@azure/opentelemetry-instrumentation-azure-sdk`의 `createAzureSdkInstrumentation()`을 등록합니다.",
  "- **Python**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = \"opentelemetry\"` (from `azure.core.settings`).":
    "- **Python**: `azure-core-tracing-opentelemetry`를 설치하고 `settings.tracing_implementation = \"opentelemetry\"`(`azure.core.settings`에서)를 설정합니다.",
  "A connected Azure subscription reads the namespace's key metrics for each event hub, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.":
    "연결된 Azure 구독은 아무것도 실행하지 않아도 네임스페이스의 주요 메트릭을 이벤트 허브별로 읽습니다. 모두 읽으려면 Collector의 `azure_monitor` 리시버를 실행하세요. 리시버는 EntityName 차원으로 메트릭을 이벤트 허브별로 나눕니다.",
  "The receiver lists your namespaces once a day, so a new one can take up to 24 hours to appear.":
    "리시버는 하루에 한 번 네임스페이스 목록을 읽으므로, 새 네임스페이스가 나타나기까지 최대 24시간이 걸릴 수 있습니다.",
  "| `azure_incomingmessages_total` | Incoming messages | Count per period |":
    "| `azure_incomingmessages_total` | 들어오는 메시지 | 기간별 개수 |",
  "| `azure_outgoingmessages_total` | Outgoing messages | Count per period |":
    "| `azure_outgoingmessages_total` | 나가는 메시지 | 기간별 개수 |",
  "| `azure_servererrors_total` | Server errors | Count per period |":
    "| `azure_servererrors_total` | 서버 오류 | 기간별 개수 |",
  "| `azure_usererrors_total` | User errors | Count per period |":
    "| `azure_usererrors_total` | 사용자 오류 | 기간별 개수 |",
  "| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |":
    "| `azure_quotaexceedederrors_total` | 할당량 초과 오류 | 기간별 개수 |",
  "| `azure_throttledrequests_total` | Throttled requests | Count per period |":
    "| `azure_throttledrequests_total` | 제한된 요청 | 기간별 개수 |",
  "| `azure_size_average` | Size | Gauge |":
    "| `azure_size_average` | 크기 | 게이지 |",
  "- The metric names the queue differently from the spans. Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](/docs/telemetry/queues#limitations)).":
    "- 메트릭이 스팬과 다른 이름으로 큐를 나타냅니다. 네임스페이스 호스트가 없는 Service Bus와 Event Hubs 스팬은 Azure Monitor의 메트릭과 다른 큐에 있습니다([제한 사항](/docs/telemetry/queues#limitations) 참조).",
  "- Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised. The config in step 3 raises it.":
    "- Azure Monitor는 `maximum_number_of_records_per_resource`를 높이지 않으면 메트릭과 네임스페이스마다 큐를 10개만 반환합니다. 3단계의 구성이 이 값을 높입니다.",
  "- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.":
    "- 리시버는 하루에 한 번 네임스페이스 목록을 가져오므로, 새 네임스페이스가 나타나기까지 최대 24시간이 걸릴 수 있습니다.",
  "Azure Service Bus queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Azure Service Bus 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "A connected Azure subscription reads the namespace's key metrics for each queue and topic, with nothing to run. To read all of them, run the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.":
    "연결된 Azure 구독은 아무것도 실행하지 않아도 네임스페이스의 주요 메트릭을 큐와 토픽별로 읽습니다. 모두 읽으려면 Collector의 `azure_monitor` 리시버를 실행하세요. 리시버는 EntityName 차원으로 메트릭을 큐와 토픽별로 나눕니다.",
  "| `azure_activemessages_average` | Active messages | Gauge |":
    "| `azure_activemessages_average` | 활성 메시지 | 게이지 |",
  "| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |":
    "| `azure_deadletteredmessages_average` | 배달 못 한 메시지 | 게이지 |",
  "| `azure_scheduledmessages_average` | Scheduled messages | Gauge |":
    "| `azure_scheduledmessages_average` | 예약된 메시지 | 게이지 |",
  "| `azure_completemessage_total` | Completed messages | Count per period |":
    "| `azure_completemessage_total` | 완료된 메시지 | 기간별 개수 |",
  "| `azure_abandonmessage_total` | Abandoned messages | Count per period |":
    "| `azure_abandonmessage_total` | 중단된 메시지 | 기간별 개수 |",
  "| `azure_serversendlatency_average` | Server send latency | Gauge |":
    "| `azure_serversendlatency_average` | 서버 전송 지연 시간 | 게이지 |",
  "BullMQ queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "BullMQ 큐는 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬에서 OneUptime에 자동으로 나타납니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:":
    "BullMQ 자체 텔레메트리(`bullmq-otel` 패키지가 구현하는 `telemetry` 옵션)는 큐를 `bullmq.queue.name`으로 지정하고 `messaging.system`을 설정하지 않으므로, 그것만으로는 큐를 생성하지 않습니다. 애플리케이션이 데이터를 보내는 Collector의 `transform` 프로세서가 작업을 추가하고 처리하는 스팬과 BullMQ 자체 메트릭에 OneUptime이 읽는 두 키를 추가합니다:",
  "Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans name the queue too, but are not messages. Point your applications' OTLP exporter at this collector.":
    "태그가 붙는 것은 작업을 추가하는 PRODUCER 스팬과 이를 처리하는 CONSUMER 스팬뿐입니다. BullMQ의 내부 스팬도 큐를 나타내지만 메시지가 아닙니다. 애플리케이션의 OTLP 익스포터가 이 컬렉터를 가리키게 하세요.",
  "BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.":
    "BullMQ는 작업을 Redis에 저장하며 스크레이프할 브로커가 없습니다. OneUptime의 자체 워커가 `queue.size`로 하는 것처럼, `messaging.system`과 `messaging.destination.name`을 가진 메트릭으로 애플리케이션에서 큐 깊이를 보고하세요.",
  "Observe the job counts in the application; a gauge that carries the two keys itself needs no transform:":
    "애플리케이션에서 작업 수를 관측하세요. 두 키를 직접 담은 게이지에는 변환이 필요 없습니다:",
  "OneUptime charts no broker metrics for BullMQ under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime은 BullMQ의 브로커 메트릭을 **브로커 상태**에 차트로 표시하지 않습니다. 컬렉터가 보내는 모든 것은 **메트릭** 탐색기에 있으며, 모든 데이터 포인트에 `messaging.system`과 `messaging.destination.name`을 담은 메트릭은 큐의 **메트릭** 탭에 표시됩니다.",
  "- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind. For BullMQ, the transform in step 2 does that.":
    "- 그 스팬이 OneUptime이 구분할 수 있는 메시징 시스템을 나타내지 않습니다. Celery의 스팬, BullMQ 자체의 텔레메트리 또는 직접 만든 클라이언트가 그렇습니다. `messaging.system`과 `messaging.destination.name`을 추가하고, 스팬의 종류를 PRODUCER 또는 CONSUMER로 지정하세요. BullMQ라면 2단계의 변환이 이를 처리합니다.",
  "- BullMQ has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- BullMQ에는 차트로 표시되는 메트릭이 없습니다. 그 메트릭은 **메트릭** 탐색기에 있습니다.",
  "Google Cloud Pub/Sub queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "Google Cloud Pub/Sub 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.":
    "- **Java**: `Publisher`와 `Subscriber` 빌더가 OpenTelemetry 인스턴스와 트레이스 스위치(`setOpenTelemetry(GlobalOpenTelemetry.get())`와 `setEnableOpenTelemetryTracing(true)`)를 받으면 클라이언트가 스스로를 트레이스합니다. 둘 중 하나만 호출하면 아무것도 트레이스하지 않습니다.",
  "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`.":
    "- **Node.js**: `new PubSub({ enableOpenTelemetryTracing: true })`를 사용합니다.",
  "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.":
    "- **Python**: `PublisherOptions(enable_open_telemetry_tracing=True)`와 `SubscriberOptions(enable_open_telemetry_tracing=True)`를 사용합니다.",
  "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.":
    "- **Go**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`를 사용합니다.",
  "Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.":
    "Collector의 `googlecloudmonitoring` 리시버로 Cloud Monitoring에서 토픽과 구독의 메트릭을 읽고, 각 메트릭 유형을 `metrics_list`에 나열하세요.",
  "The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project. Set `project_id` to your project:":
    "리시버는 Application Default Credentials(`GOOGLE_APPLICATION_CREDENTIALS` 또는 컬렉터가 실행되는 서비스 계정)로 로그인하며, 프로젝트의 **Monitoring Viewer** 역할이 필요합니다. `project_id`를 프로젝트로 설정하세요:",
  "A metric type missing from `metrics_list` is never read. Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`).":
    "`metrics_list`에 없는 메트릭 유형은 읽지 않습니다. 구독 메트릭은 구독의 큐(`subscription_id`)에, 토픽 메트릭은 토픽의 큐(`topic_id`)에 붙습니다.",
  "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |":
    "| `pubsub.googleapis.com/subscription/num_undelivered_messages` | 전달되지 않은 메시지 | 게이지 |",
  "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |":
    "| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | 가장 오래된 미확인 메시지 경과 시간 | 게이지 |",
  "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/dead_letter_message_count` | 배달 못 한 메시지 | 기간별 개수 |",
  "| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |":
    "| `pubsub.googleapis.com/subscription/ack_message_count` | 확인된 메시지 | 기간별 개수 |",
  "| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |":
    "| `pubsub.googleapis.com/topic/send_request_count` | 게시 요청 | 기간별 개수 |",
  "- The metric names the queue differently from the spans. A Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics.":
    "- 메트릭이 스팬과 다른 이름으로 큐를 나타냅니다. Pub/Sub 토픽에는 토픽 메트릭이, 그 구독에는 구독 메트릭이 붙습니다.",
  "- Cloud Monitoring reads only the types in `metrics_list`.":
    "- Cloud Monitoring은 `metrics_list`에 있는 유형만 읽습니다.",
  "- It is late. Pub/Sub's metrics arrive minutes late.":
    "- 늦게 도착하는 중입니다. Pub/Sub의 메트릭은 몇 분 늦게 도착합니다.",
  "JMS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "JMS 큐는 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬에서 OneUptime에 자동으로 나타납니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.":
    "JMS는 API이며, 그 스팬은 뒤에 있는 브로커를 지정하지 않습니다. 브로커가 Apache ActiveMQ라면 OpenTelemetry JMX Scraper를 그 브로커에 대해 실행하세요. 그러면 메트릭이 같은 큐에 합류하고 그 큐는 ActiveMQ 큐로 표시됩니다. IBM MQ 같은 다른 JMS 브로커에는 바로 쓸 수 있는 메트릭 경로가 없습니다.",
  "Its metrics join the same queue as the JMS spans, which from then on shows as an Apache ActiveMQ queue.":
    "그 메트릭은 JMS 스팬과 같은 큐에 합쳐지며, 그때부터 그 큐는 Apache ActiveMQ 큐로 표시됩니다.",
  "OneUptime charts no broker metrics for JMS under **Broker health**. Everything a collector sends is in the **Metrics** explorer, and a metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime은 JMS의 브로커 메트릭을 **브로커 상태**에 차트로 표시하지 않습니다. 컬렉터가 보내는 모든 것은 **메트릭** 탐색기에 있으며, 모든 데이터 포인트에 `messaging.system`과 `messaging.destination.name`을 담은 메트릭은 큐의 **메트릭** 탭에 표시됩니다.",
  "Once an Apache ActiveMQ broker's metrics arrive, the queue shows as an Apache ActiveMQ queue and charts them under **Broker health**: see [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq).":
    "Apache ActiveMQ 브로커의 메트릭이 도착하면 큐가 Apache ActiveMQ 큐로 표시되고, 이를 **브로커 상태**에 차트로 표시합니다. [Apache ActiveMQ](/docs/telemetry/queues#apache-activemq)를 참조하세요.",
  "- JMS brokers other than ActiveMQ have no charted metrics. Their metrics are in the **Metrics** explorer. For an ActiveMQ broker, see **If the broker is Apache ActiveMQ** under **Advanced**.":
    "- ActiveMQ 외의 JMS 브로커에는 차트로 표시되는 메트릭이 없습니다. 그 메트릭은 **메트릭** 탐색기에 있습니다. ActiveMQ 브로커라면 **고급**의 **브로커가 Apache ActiveMQ인 경우**를 참조하세요.",
  "NATS queues appear in OneUptime on their own, from the messaging spans of the applications that publish to and consume from them. You can also add one by hand: **Queues → Create Queue**.":
    "NATS 큐는 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬에서 OneUptime에 자동으로 나타납니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the OpenTelemetry Java agent traces NATS clients — its NATS instrumentation reports `messaging.system` = `nats` — without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 NATS 클라이언트를 트레이스합니다. 그 NATS 계측은 `messaging.system` = `nats`를 보고합니다.",
  "Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.":
    "서버의 모니터링 포트를 대상으로 `-jsz=all`과 함께 prometheus-nats-exporter를 실행하세요. 그 JetStream 메트릭은 서브젝트별이 아니라 스트림과 컨슈머별이므로, 서브젝트 수준의 큐에는 연결되지 않습니다.",
  "Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:":
    "`-m 8222`(또는 구성의 `http_port: 8222`)로 서버의 모니터링 포트를 켠 다음 익스포터를 실행하세요:",
  "And scrape it:":
    "그리고 익스포터를 스크레이프하세요:",
  "OneUptime charts no broker metrics for NATS under **Broker health**: what the collector above sends arrives only in the **Metrics** explorer. A metric that carries `messaging.system` and `messaging.destination.name` on each datapoint shows on the queue's **Metrics** tab.":
    "OneUptime은 NATS의 브로커 메트릭을 **브로커 상태**에 차트로 표시하지 않습니다. 위의 컬렉터가 보내는 것은 **메트릭** 탐색기에만 도착합니다. 모든 데이터 포인트에 `messaging.system`과 `messaging.destination.name`을 담은 메트릭은 큐의 **메트릭** 탭에 표시됩니다.",
  "- NATS has no charted metrics. Its metrics are in the **Metrics** explorer.":
    "- NATS에는 차트로 표시되는 메트릭이 없습니다. 그 메트릭은 **메트릭** 탐색기에 있습니다.",
  "RabbitMQ queues appear in OneUptime on their own, from two sources: the messaging spans of the applications that publish to and consume from them, and the broker's own metrics. You can also add one by hand: **Queues → Create Queue**.":
    "RabbitMQ 큐는 두 가지 소스에서 OneUptime에 자동으로 나타납니다. 큐에 게시하고 큐에서 소비하는 애플리케이션의 메시징 스팬과 브로커 자체의 메트릭입니다. 직접 추가할 수도 있습니다: **큐 → 큐 만들기**.",
  "- **Java**: the OpenTelemetry Java agent traces RabbitMQ clients without code changes.":
    "- **Java**: OpenTelemetry Java 에이전트가 코드 변경 없이 RabbitMQ 클라이언트를 트레이스합니다.",
  "- **.NET**: `RabbitMQ.Client` 7 traces itself: subscribe to `RabbitMQ.Client.*`. MassTransit traces itself too: subscribe to `MassTransit`.":
    "- **.NET**: `RabbitMQ.Client` 7은 스스로를 트레이스합니다. `RabbitMQ.Client.*`를 구독하세요. MassTransit도 스스로를 트레이스합니다. `MassTransit`을 구독하세요.",
  "- **Python**: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`.":
    "- **Python**: `opentelemetry-instrumentation-pika` 또는 `opentelemetry-instrumentation-aio-pika`를 사용합니다.",
  "The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.":
    "Collector의 `rabbitmq` 리시버는 `monitoring` 태그가 있고 각 가상 호스트에 접근할 수 있는 사용자로서, 관리 플러그인의 HTTP API에서 각 큐의 깊이, 컨슈머, 메시지 속도를 읽습니다.",
  "Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:":
    "관리 플러그인을 켜고 그 사용자를 만드세요. `monitoring` 태그만으로는 큐가 하나도 보이지 않으므로, 모니터링할 각 가상 호스트에 대한 접근 권한을 주세요. 빈 패턴은 구성, 게시, 소비 권한 없이 그 접근 권한만 줍니다:",
  "Set `RABBITMQ_USERNAME` and `RABBITMQ_PASSWORD` in the collector's environment. The receiver reports each queue under its RabbitMQ name, while most instrumentations' spans name the exchange a message went through: the two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "컬렉터의 환경에 `RABBITMQ_USERNAME`과 `RABBITMQ_PASSWORD`를 설정하세요. 리시버는 각 큐를 RabbitMQ 이름으로 보고하지만, 대부분의 계측 스팬은 메시지가 거쳐 간 exchange를 나타냅니다. 둘은 기본 exchange로 보낸 메시지에서는 일치합니다. 그 routing key가 큐의 이름이기 때문입니다.",
  "| `rabbitmq.message.current` | Queue depth | Gauge |":
    "| `rabbitmq.message.current` | 큐 깊이 | 게이지 |",
  "| `rabbitmq.message.published` | Published | Counter, charted per second |":
    "| `rabbitmq.message.published` | 게시됨 | 카운터, 초당 값으로 표시 |",
  "| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |":
    "| `rabbitmq.message.delivered` | 전달됨 | 카운터, 초당 값으로 표시 |",
  "| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |":
    "| `rabbitmq.message.acknowledged` | 인지됨 | 카운터, 초당 값으로 표시 |",
  "| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |":
    "| `rabbitmq.message.dropped` | 삭제됨 | 카운터, 초당 값으로 표시 |",
  "- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues. The two meet for messages sent through the default exchange, whose routing key is the queue's name.":
    "- 메트릭이 스팬과 다른 이름으로 큐를 나타냅니다. RabbitMQ 스팬은 보통 exchange를 나타내고, 브로커의 메트릭은 큐를 설명합니다. 둘은 기본 exchange로 보낸 메시지에서는 일치합니다. 그 routing key가 큐의 이름이기 때문입니다.",
  "- RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest. RabbitMQ's counters appear with the first activity.":
    "- RabbitMQ는 그 사용자가 접근할 수 있는 가상 호스트의 큐만 보고하며, 나머지에 대해서는 오류를 기록하지 않습니다. RabbitMQ의 카운터는 첫 활동과 함께 나타납니다.",
};

export default TRANSLATION;
