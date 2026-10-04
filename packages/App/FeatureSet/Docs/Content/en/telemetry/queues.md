# Queues

## Overview

**Queues** (_Resources → Queues_ in the dashboard) gives every message queue, topic and subscription your applications use its own page: which services publish to it and which consume from it, how many messages go through, how many fail and how long processing takes, its traces and metrics — and, once the broker's own metrics reach OneUptime, its backlog, consumer lag, dead letters and throttling. Queues have labels, owners, label and owner rules and archiving, like every other resource.

It works the same way for every broker — Apache Kafka, RabbitMQ, Apache ActiveMQ and other JMS brokers, Amazon SQS and SNS, Google Cloud Pub/Sub, Azure Service Bus, Event Hubs and Event Grid, Apache Pulsar, Apache RocketMQ, NATS and BullMQ (see [Supported messaging systems](#supported-messaging-systems)) — and for any other broker your spans name in `messaging.system`. Most queues appear on their own, from two sources:

| Source | What it needs from you | What it adds to the queue's page |
| --- | --- | --- |
| **Application traces** | Instrumented applications (OpenTelemetry) — see [Instrumenting applications](#instrumenting-applications) | Messages published and consumed, errors and processing time, the services on each side, and the traces themselves |
| **Broker metrics** (an OpenTelemetry Collector) | The collector receiver or scrape for your broker — see [Broker health metrics](#broker-health-metrics) | **Broker health**: backlog, consumer lag, dead letters, oldest message age, throttling and the broker's own message rates |

Traces tell OneUptime that a queue exists and how applications use it, but not how full it is. That comes from the broker itself or its cloud provider's monitoring API — or, for [BullMQ](#bullmq), which keeps its jobs in Redis and has no broker to ask, from a gauge the application reports.

You can also add a queue by hand: **Queues → Create Queue**, with its messaging system and destination name — and, for Azure Service Bus and Event Hubs, its namespace. The form asks for those on its first step, **Messaging System**, then for an optional name and description, with labels under **More fields** (**Queue Info**). Leave the namespace empty only for a queue your applications reach through an emulator or a custom domain name: their spans name no namespace, and Azure Monitor's metrics never reach such a queue (see [Limitations](#limitations)).

This page covers the [supported messaging systems](#supported-messaging-systems), [how queues are discovered](#how-queues-are-discovered) and what makes two sightings one queue, [instrumenting applications](#instrumenting-applications), setting up [broker health metrics](#broker-health-metrics) for each system, [alerting](#alerting), [limitations](#limitations) and [troubleshooting](#troubleshooting).

## Supported messaging systems

OneUptime knows the messaging systems below by name. It normalises what instrumentations put in `messaging.system` to the value in the second column — the OpenTelemetry well-known value where there is one — without regard to case, so `AmazonSQS`, `aws.sqs` and `aws_sqs` are one system. `nats` and `bullmq` are not OpenTelemetry well-known values: `nats` is what the Java agent's NATS instrumentation reports, and `bullmq` is the value to set for BullMQ (see [BullMQ](#bullmq)).

A system OneUptime does not know still works: a well-formed value (`ibmmq`, `solace`, `mqtt` — lowercase letters, digits, `.`, `_` and `-`, up to 64 characters) is kept as it came, so that broker's queues are discovered and shown under that name; only the broker's own metrics need a system from this table. `spring_integration` is ignored: Spring Integration's channels are method calls inside one process, not a broker.

**Broker metrics** says where a system's health metrics come from: a collector-contrib receiver, a Prometheus endpoint (`:port/path`, scraped with the collector's `prometheus` receiver), the cloud provider's monitoring API, or a program outside the collector that pushes them over OTLP. Each system links to its setup below, and each queue's **Documentation** tab turns it into a configuration for that queue.

| System | `messaging.system` | Also accepted | Broker metrics |
| --- | --- | --- | --- |
| [Amazon SNS](#amazon-sns) | `aws.sns` | `aws_sns`, `amazonsns`, `sns` | `aws_cloudwatch` or `awsfirehose` receiver (cloud monitoring) |
| [Amazon SQS](#amazon-sqs) | `aws_sqs` | `aws.sqs`, `amazonsqs`, `sqs` | `aws_cloudwatch` or `awsfirehose` receiver (cloud monitoring) |
| [Apache ActiveMQ](#apache-activemq) | `activemq` | `artemis`, `activemq_artemis` | OpenTelemetry JMX Scraper (pushes OTLP) |
| [Apache Kafka](#apache-kafka) | `kafka` | — | `kafka_metrics` receiver |
| [Apache Pulsar](#apache-pulsar) | `pulsar` | `apache_pulsar` | Prometheus (Pulsar broker), `:8080/metrics/` |
| [Apache RocketMQ](#apache-rocketmq) | `rocketmq` | — | Prometheus (RocketMQ broker), `:5557/metrics` |
| [Azure Event Grid](#azure-event-grid) | `eventgrid` | `azure_eventgrid`, `azure.eventgrid`, `microsoft.eventgrid` | `azure_monitor` receiver (cloud monitoring) |
| [Azure Event Hubs](#azure-event-hubs) | `eventhubs` | `azure_eventhubs`, `azure.eventhubs`, `microsoft.eventhub` | `azure_monitor` receiver (cloud monitoring) |
| [Azure Service Bus](#azure-service-bus) | `servicebus` | `azure_servicebus`, `azure.servicebus`, `microsoft.servicebus` | `azure_monitor` receiver (cloud monitoring) |
| [BullMQ](#bullmq) | `bullmq` | — | None built in |
| [Google Cloud Pub/Sub](#google-cloud-pubsub) | `gcp_pubsub` | `gcp.pubsub`, `pubsub`, `google_pubsub` | `googlecloudmonitoring` receiver (cloud monitoring) |
| [JMS](#jms) | `jms` | — | None built in |
| [NATS](#nats) | `nats` | `jetstream` | Prometheus (prometheus-nats-exporter), `:7777/metrics` |
| [RabbitMQ](#rabbitmq) | `rabbitmq` | — | `rabbitmq` receiver |

A queue is one destination of one system. For **Azure Service Bus** and **Azure Event Hubs** its namespace is part of it too, since two namespaces can each hold a queue called `orders`. **JMS** and **Apache ActiveMQ** share their queues: Java applications reach ActiveMQ through the JMS API, whose spans say `jms` whatever the broker, while the broker's own metrics can only say `activemq` — so both land on one queue (see [What makes two sightings one queue](#what-makes-two-sightings-one-queue)).

## How queues are discovered

Each queue records whether traces, broker metrics or a person created it. Everything that names the same queue later adds to it rather than creating another one (see [What makes two sightings one queue](#what-makes-two-sightings-one-queue)).

### From application traces

Every 10 minutes OneUptime summarises the spans your applications sent in the last 15 minutes that carry any of `messaging.system`, `messaging.destination.name`, `messaging.destination`, `message_bus.destination`, `az.namespace`, `azure.resource_provider.namespace`, `aws.sqs.queue.url`, `aws.queue_url` or `aws.sns.topic.arn`. Every span but a SERVER span counts: PRODUCER, CONSUMER, CLIENT and INTERNAL spans, and spans a trace pipeline's **Span Kind Remapper** gave another kind (such as Unspecified) or none; a SERVER span never names a queue.

Every messaging attribute in OpenTelemetry is still marked as in development, so applications in one project report the same things under up to five generations of names. OneUptime reads them all, newest first, and never parses span names, whose format changed in semantic conventions 1.27 and which vendors choose freely:

- **The system**: `messaging.system`, normalised as in [Supported messaging systems](#supported-messaging-systems). Without it, the Azure SDKs' `az.namespace` or `azure.resource_provider.namespace` (`Microsoft.ServiceBus`, `Microsoft.EventHub`), the older Azure SDK `component` key, an AWS SDK span (`rpc.system` = `aws-api`) calling SQS or SNS — the Java agent's SNS spans carry no `messaging.system` — or an SQS queue URL or SNS topic ARN key.
- **The destination**: the first of `messaging.destination.template`, `messaging.destination.name`, `messaging.source.template`, `messaging.source.name`, `messaging.destination` and `message_bus.destination` that the span carries. A span with none of them falls back to its system's own keys: the SQS queue URL (`aws.sqs.queue.url`, `aws.queue_url`, or a queue URL in `messaging.url`, `server.address` or `net.peer.name`), the SNS topic ARN (`aws.sns.topic.arn`), and for RabbitMQ the routing key (`messaging.rabbitmq.destination.routing_key` or `messaging.rabbitmq.routing_key`), which is the queue's name when a message goes through the default exchange.
- **The direction**: `messaging.operation.type` first, then the span kind — PRODUCER publishes, CONSUMER consumes — then the older `messaging.operation`, then `messaging.operation.name`, and for SQS and SNS the AWS SDK operation in `rpc.method` (`SendMessage`, `ReceiveMessage`, …). The kind outranks the older keys because some instrumentations filled them in wrongly: confluent-kafka for Python wrote `receive` on its producer spans.

A queue is **created** from traces once its spans in the 15-minute window a run looks at number at least 3 (`MESSAGE_QUEUE_MIN_SPANS`), so a one-off script does not create one, and only while the project is under its [auto-create budget](#the-auto-create-budget). Spans that do not create a queue still count towards one that exists.

Every messaging span is also tagged with its queue when it is ingested, so the queue's **Traces** tab shows every span that names it — including spans sent before the queue was created.

### From broker metrics

A broker metric from the lists under [Broker health metrics](#broker-health-metrics) names its queue in the broker's own attribute — Kafka's `topic`, RabbitMQ's `rabbitmq.queue.name`, Azure Monitor's `EntityName` dimension, CloudWatch's `QueueName` — and OneUptime matches it to that queue when it is ingested. Broker metrics carry no `messaging.system`: each is recognised by its name (`kafka.consumer_group.lag_sum`) and, where two systems share one — Azure Monitor names Service Bus's and Event Hubs' metrics alike — by the resource type the datapoint carries.

The next discovery run creates the queue if it does not exist yet: one broker metric is enough, within the [auto-create budget](#the-auto-create-budget). So a queue no instrumented application touches still appears once its broker reports it.

Cloud monitoring APIs — CloudWatch, Azure Monitor and Cloud Monitoring — publish each number minutes after the time it measures, and it is stored under that time. So each run reads their metrics from the last hour, rather than from the last 15 minutes it reads spans and other metrics from: a datapoint that arrives late still sights its queue, or creates it.

### From messaging client metrics

Instrumented clients can report metrics too: OpenTelemetry's messaging client metrics `messaging.client.sent.messages`, `messaging.client.consumed.messages`, `messaging.client.operation.duration` and `messaging.process.duration`, their older names `messaging.publish.duration`, `messaging.receive.duration`, `messaging.publish.messages`, `messaging.receive.messages`, `messaging.process.messages` and `messaging.client.published.messages`, and the Azure SDK for Java's `messaging.servicebus.messages.sent`, `messaging.servicebus.receiver.lag`, `messaging.servicebus.settlement.request.duration` and `messaging.servicebus.settlement.sequence_number`. Each datapoint names its system and destination the way a span does — the Azure SDK's Service Bus metrics name no system, so their name stands in for it — and is matched to that queue when it is ingested, so it shows on the queue's **Metrics** tab. So does any metric of your own that carries `messaging.system` and `messaging.destination.name` on each datapoint — not on the resource, where they are not read — such as a queue-depth gauge (see [BullMQ](#bullmq)).

Messaging client metrics never create a queue: traces, broker metrics or a person do. A client metric that names a queue that exists keeps its **Last seen** current, as its spans do. A metric of your own does neither: it only shows on the queue's **Metrics** tab.

### What makes two sightings one queue

A queue's identity is its **system** and its **destination**, compared without regard to case: `Orders` and `orders` are one queue, shown under the name as it was first seen. For Azure Service Bus and Event Hubs the identity also holds the **namespace**:

- on a span, the first DNS label of the host the SDK connected to, from `server.address`, `net.peer.name`, `peer.address` or `network.peer.address` in that order, when that host is a namespace host: `<namespace>.servicebus.windows.net`, or a sovereign cloud's `.servicebus.usgovcloudapi.net`, `.servicebus.chinacloudapi.cn` or `.servicebus.cloudapi.de`. Event Hubs shares Service Bus's domain;
- on an Azure Monitor metric, the `name` of the namespace it reports on.

Nothing else is part of it, so none of these ever splits a queue: the broker's address (Kafka clients rarely report one, and an Azure namespace answers on many), the consumer group or subscription (a topic's consumers are not separate queues), the partition, and a dead-letter sub-queue. Of these, a queue keeps only the broker's address, for display.

**JMS and ActiveMQ are one family.** Every JMS span says `jms` whichever broker is behind it, and the broker's own metrics (the [OpenTelemetry JMX Scraper](#apache-activemq)) can only say `activemq`, so OneUptime keys an ActiveMQ queue on its JMS family: the spans and the broker metrics of `orders` land on one queue. It shows as JMS until the broker's metrics arrive, and as Apache ActiveMQ from then on — never the other way round. A queue you create by hand as Apache ActiveMQ is that same queue.

### How destination names are read

Instrumentations name one queue in many ways, and OneUptime reduces what they report to the queue's own name:

| System | Reported as | Queue |
| --- | --- | --- |
| Amazon SQS | `https://sqs.us-east-1.amazonaws.com/123456789012/orders`, a queue URL (Go's `otelaws` puts it in `server.address`) | `orders` |
| Amazon SNS | `arn:aws:sns:us-east-1:123456789012:order-events`, a topic ARN | `order-events` |
| Google Cloud Pub/Sub | `projects/shop/topics/orders`, a resource name | `orders` |
| Azure Service Bus | `orders/Subscriptions/billing`, the entity path of the topic's subscription `billing` | `orders` |
| Azure Service Bus | `orders/$DeadLetterQueue`, the entity path of the queue's dead-letter sub-queue | `orders` |
| Azure Event Hubs | `telemetry/ConsumerGroups/$Default/Partitions/3`, a receiver's entity path, for consumer group `$Default` | `telemetry` |
| Apache Pulsar | `orders-partition-3`, a partition of a short-named topic | `persistent://public/default/orders` |
| Apache Pulsar | `acme/shop/orders`, a topic without its domain | `persistent://acme/shop/orders` |
| JMS | `queue://orders`, with its destination-type prefix | `orders` |
| RabbitMQ | `shop:new-order:orders`, exchange, routing key and queue on a consumer (semantic conventions 1.30 and later) | `orders` |
| RabbitMQ | `amq.default`, the default exchange, with routing key `orders` | `orders` |
| RabbitMQ | `,orders`, aio-pika's `{exchange},{routing key}` through the default exchange | `orders` |
| RabbitMQ | `shop,new-order`, aio-pika's `{exchange},{routing key}` | `shop` |

A Pulsar partition folds into its topic, and a name without a domain is completed the way Pulsar itself completes it — a short name into the `public/default` namespace — so the Java agent's names join the brokers' fully qualified metric labels. A RabbitMQ span usually names the exchange a message went through, on the publishing and the consuming side alike; the default exchange (`amq.default`, `<default>` or an empty name) stands for its routing key, which is the queue's name. Semantic conventions 1.30 join exchange, routing key and queue with `:` — the Java agent's opt-in names — and OneUptime keeps the queue from a consumer's joined name and the exchange from a publisher's. aio-pika joins exchange and routing key with a comma on the publish side, and OneUptime splits that the same way.

### What is ignored

OneUptime errs on the side of no queue: a name that is made up per request or per consumer would otherwise create a queue nobody owns for every message. These never become queues:

- **SERVER spans**, and spans whose `messaging.system` is `spring_integration`.
- **Destinations marked temporary or anonymous**: `messaging.destination.temporary`, `messaging.destination.anonymous`, `messaging.source.temporary` or `messaging.source.anonymous` set to `true`. The older `messaging.temp_destination` is not trusted: Python's pika and aio-pika instrumentations set it on every publish.
- **Placeholders instrumentations report instead of a name**: `(temporary)`, `(anonymous)`, `<generated>`, `unknown` (a Kafka batch across several topics), `aws:sqs` (the Java agent's Lambda SQS events), Azure Monitor's `-NamespaceOnlyMetric-`, and a value OneUptime's own data scrubbing replaced whole (`[REDACTED]`).
- **Generated and reply destinations**: RabbitMQ's `amq.gen-JzTY20BRgKO-HjmUJj0wLg`-style server-named queues, Spring's `spring.gen-…` queues and Spring Cloud Stream's `<destination>.anonymous.<id>` queues of consumers without a group, and direct reply-to (`amq.rabbitmq.reply-to…`); JMS temporary destinations (`temp-queue://…`, `temp-topic://…`) and TIBCO's `$TMP$…`; ActiveMQ's advisory topics (`ActiveMQ.Advisory.…`); NATS inboxes (`_INBOX.…`) and JetStream acknowledgement subjects (`$JS.ACK.…`); Pulsar's system topics (`__change_events`, `__transaction_…`, and anything below a `/__` segment); and a destination that is nothing but a UUID.
- **SNS text messages and mobile push**: a phone number (`+15555550123`, or `phone_number:**` from botocore) or a platform endpoint ARN (`arn:aws:sns:us-east-1:123456789012:endpoint/GCM/shop-app/1234`) is a device, not a topic.
- **Names that cannot be one queue**: a list of destinations from a batch (`["orders","payments"]`), a name holding a control character, and a name longer than 255 characters.

**UUIDs are templated.** Each UUID inside a destination is replaced with `{uuid}`, so per-request names such as `reply-7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70` become one queue, `reply-{uuid}`, rather than one queue each.

### The auto-create budget

Traces and broker metrics create queues on their own only while the project holds fewer than 500 live, non-archived discovered queues (`MESSAGE_QUEUE_AUTO_CREATE_BUDGET`, see [Self-hosted tuning](#self-hosted-tuning)). Queues you create by hand never count and are never blocked; archived queues do not count, so [automatic archiving](#lifecycle-and-archiving) frees budget; and queues that already exist keep being matched and updated.

### Lifecycle and archiving

- **Last seen** is when discovery last saw the queue, in traces, messaging client metrics or broker metrics.
- **Archive to dismiss.** Deleting a discovered queue removes it only until it is seen again: its next sighting brings it back as a new queue. To dismiss one for good, **archive** it. An archived queue keeps its identity, so whatever names it stays attached to the archived queue instead of creating a new one.
- **Automatic archiving.** A discovered queue that has not been seen for 7 days (`MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS`) is archived automatically, unless a person has renamed it, described it, labelled it or given it owners. Labels and owners that label or owner rules attached on their own do not count.
- **Restoring.** A queue archived automatically is restored automatically when it is seen again. Queues you created by hand, and queues a person archived, are never archived or restored by discovery. A queue a person restores stays restored for 30 days (or the archive window, if that is longer) even while nothing sees it; from its next sighting the 7-day rule applies again.

## Instrumenting applications

Queues come from the messaging spans your OpenTelemetry instrumentation already produces; nothing OneUptime-specific is needed. Send the traces to OneUptime as [OpenTelemetry](/docs/telemetry/open-telemetry) describes, then check the list for your language.

### Java

The OpenTelemetry Java agent traces Kafka, RabbitMQ, JMS (ActiveMQ, Artemis, IBM MQ and every other JMS broker), Amazon SQS and SNS, Pulsar, RocketMQ and NATS clients without code changes. OneUptime reads both the attribute names it emits by default and the newer ones it emits with `OTEL_SEMCONV_STABILITY_OPT_IN=messaging` (agent 2.31.0 and later). JMS spans say `jms` whichever broker is behind them (see [JMS](#jms)).

- **Azure Service Bus and Event Hubs**: the Azure SDK for Java traces itself, and the Java agent connects that tracing to OpenTelemetry.
- **Google Cloud Pub/Sub**: the client traces itself once its `Publisher` and `Subscriber` builders get an OpenTelemetry instance and the tracing switch — `setOpenTelemetry(GlobalOpenTelemetry.get())` and `setEnableOpenTelemetryTracing(true)`. Either call alone traces nothing.

### .NET

- **Azure Service Bus and Event Hubs** (`Azure.Messaging.ServiceBus`, `Azure.Messaging.EventHubs`): their OpenTelemetry spans are experimental in the Azure SDK. Turn them on with the environment variable `AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true` (or the `Azure.Experimental.EnableActivitySource` switch below), and subscribe to the `Azure.*` sources.
- **RabbitMQ.Client** 7 traces itself: subscribe to `RabbitMQ.Client.*`.
- **MassTransit** traces itself: subscribe to `MassTransit` (see [Limitations](#limitations) for what its spans leave out).
- **Confluent.Kafka**: the `OpenTelemetry.Instrumentation.ConfluentKafka` package.
- **Amazon SQS and SNS**: the `OpenTelemetry.Instrumentation.AWS` package, with `.AddAWSInstrumentation(opt => opt.SemanticConventionVersion = SemanticConventionVersion.Latest)`. Its default attribute set (`V1_28_0`) names an SQS queue only by its URL (`aws.queue_url`, which OneUptime reads) and an SNS topic not at all.

```csharp
// Before any Azure client is created; or set AZURE_EXPERIMENTAL_ENABLE_ACTIVITY_SOURCE=true.
AppContext.SetSwitch("Azure.Experimental.EnableActivitySource", true);

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddSource("Azure.*")
        .AddSource("RabbitMQ.Client.*")
        .AddSource("MassTransit")
        .AddOtlpExporter());
```

### Node.js

- `@opentelemetry/auto-instrumentations-node` traces `amqplib` (RabbitMQ), `kafkajs` and the AWS SDK (SQS and SNS).
- **Azure Service Bus and Event Hubs**: register `createAzureSdkInstrumentation()` from `@azure/opentelemetry-instrumentation-azure-sdk`.
- **Google Cloud Pub/Sub**: `new PubSub({ enableOpenTelemetryTracing: true })`.
- **BullMQ**: see [BullMQ](#bullmq) — its own telemetry needs two attributes added.

### Python

- Kafka: `opentelemetry-instrumentation-kafka-python`, `opentelemetry-instrumentation-confluent-kafka` or `opentelemetry-instrumentation-aiokafka`. RabbitMQ: `opentelemetry-instrumentation-pika` or `opentelemetry-instrumentation-aio-pika`. SQS and SNS: `opentelemetry-instrumentation-botocore`, or `opentelemetry-instrumentation-boto3sqs` for SQS. `opentelemetry-bootstrap -a install` picks the ones your installed libraries need.
- **Azure Service Bus and Event Hubs**: install `azure-core-tracing-opentelemetry` and set `settings.tracing_implementation = "opentelemetry"` (from `azure.core.settings`).
- **Google Cloud Pub/Sub**: `PublisherOptions(enable_open_telemetry_tracing=True)` and `SubscriberOptions(enable_open_telemetry_tracing=True)`.
- Celery's spans carry no `messaging.system` and name no broker, so they do not create queues.

### Go

- **Amazon SQS and SNS**: `otelaws` (`go.opentelemetry.io/contrib/instrumentation/github.com/aws/aws-sdk-go-v2/otelaws`), added with `otelaws.AppendMiddlewares(&cfg.APIOptions)`. Its SQS spans carry the queue URL in `server.address`, which OneUptime reads as the queue.
- **Google Cloud Pub/Sub**: `pubsub.ClientConfig{EnableOpenTelemetryTracing: true}`.
- **Kafka** with `segmentio/kafka-go`: OpenTelemetry Go auto-instrumentation (`go.opentelemetry.io/auto`, eBPF, on Linux) traces its producers and consumers without code changes.
- OpenTelemetry's Go contrib libraries have no Kafka, RabbitMQ or NATS instrumentation. For other clients, use the client library's own OpenTelemetry support, or set `messaging.system`, `messaging.destination.name` and the span kind on the spans around your sends and handlers.

## Broker health metrics

A broker knows what no application can see: how many messages are waiting, how far each consumer group is behind, what went to a dead-letter queue. Each section below has the collector configuration for one system — a complete OpenTelemetry Collector config ending in the OTLP exporter that sends to OneUptime. Put a telemetry ingestion key (_Project Settings → Telemetry & APM → Ingestion Keys_) in `x-oneuptime-token`, replace `https://oneuptime.com` with your own host if you self-host, and run it with `otel/opentelemetry-collector-contrib` 0.161.0 or later (every config here is validated against 0.161.0). Recent collectors log that `otlphttp` is deprecated in favour of `otlp_http`; both names are the same exporter. To collect several systems, merge their receivers into one collector.

Each queue's **Broker health** section charts the metrics listed for its system — a gauge as its value, a count per period summed per interval, a counter as a rate per second — combining a queue's series the way each metric needs (a RabbitMQ queue's ready and unacknowledged messages add up; the consumer group furthest behind is the lag). Everything the collector sends is also in the **Metrics** explorer. While no listed metric has arrived for a queue, the section shows where that system's metrics come from, with a link to its section here.

### Amazon SNS

Read the topics' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.

The `aws_cloudwatch` receiver polls CloudWatch's `GetMetricData` API, one namespace per receiver, so SNS gets its own instance next to [Amazon SQS](#amazon-sqs)'s. It uses the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:

```yaml
receivers:
  aws_cloudwatch/sns:
    region: us-east-1
    metrics:
      collection_interval: 5m
      period: 1m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/SNS
        limit: 500

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [aws_cloudwatch/sns]
      processors: [batch]
      exporters: [otlphttp]
```

Leave `stats` unset, as in [Amazon SQS](#amazon-sqs). A Metric Stream carries SNS and SQS together: add `AWS/SNS` to the stream's namespaces in the [Amazon SQS](#amazon-sqs) setup.

A topic is named the same way from both sides: spans report its ARN or its name, and OneUptime keeps the name after the ARN's last `:`.

| Metric | Shown as | Type |
| --- | --- | --- |
| `amazonaws.com/aws/sns/numberofmessagespublished` (JSON stream: `numberofmessagespublished`) | Messages published | Count per period |
| `amazonaws.com/aws/sns/numberofnotificationsdelivered` (JSON stream: `numberofnotificationsdelivered`) | Notifications delivered | Count per period |
| `amazonaws.com/aws/sns/numberofnotificationsfailed` (JSON stream: `numberofnotificationsfailed`) | Notifications failed | Count per period |
| `amazonaws.com/aws/sns/numberofnotificationsredriventodlq` (JSON stream: `numberofnotificationsredriventodlq`) | Redriven to dead-letter queue | Count per period |

### Amazon SQS

Read the queues' CloudWatch metrics with the collector's `aws_cloudwatch` receiver, or stream them through a CloudWatch Metric Stream and Amazon Data Firehose to its `awsfirehose` receiver.

**Polling CloudWatch** needs nothing on the AWS side but credentials. The receiver uses the AWS SDK's default credentials (environment, shared profile or instance role), which need `cloudwatch:ListMetrics` and `cloudwatch:GetMetricData`:

```yaml
receivers:
  aws_cloudwatch/sqs:
    region: us-east-1
    metrics:
      collection_interval: 5m
      period: 1m
      delay: 10m
      discovery:
        filters:
          namespace: AWS/SQS
        # Metrics per scrape: about nine per queue. Must be set.
        limit: 500

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [aws_cloudwatch/sqs]
      processors: [batch]
      exporters: [otlphttp]
```

- **Leave `stats` unset.** Without it each metric arrives as one summary per period, which is what OneUptime reads; with it, each statistic becomes a series of its own and the charts mix them.
- `discovery.limit` must be set, and caps the metrics read per scrape — about nine per queue. Each one costs four `GetMetricData` sub-queries per scrape, which AWS bills.
- `delay` waits for CloudWatch to publish a period (it takes a few minutes), so with this configuration a queue's broker metrics arrive 11 to 17 minutes late: a monitor over them needs a longer window (see **Late metrics** under [Alerting](#alerting)).
- One receiver reads one region and one namespace: add an instance per region.

**Streaming** pushes the metrics as CloudWatch publishes them. Create a CloudWatch Metric Stream for the `AWS/SQS` (and `AWS/SNS`) namespaces with the **OpenTelemetry 1.0** output format, delivering to an Amazon Data Firehose stream whose destination is an HTTP endpoint: your collector, with an access key. Firehose only delivers to `https://` on port 443, so the collector needs a certificate and a public port 443 (for example behind a load balancer):

```yaml
extensions:
  awscloudwatchmetricstreams_encoding:
    format: opentelemetry1.0

receivers:
  awsfirehose:
    # Firehose delivers to HTTPS on port 443 only: expose this port as 443,
    # for example behind a load balancer.
    endpoint: 0.0.0.0:4433
    encoding: awscloudwatchmetricstreams_encoding
    access_key: ${env:FIREHOSE_ACCESS_KEY}
    tls:
      cert_file: /etc/otelcol/tls/server.crt
      key_file: /etc/otelcol/tls/server.key

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  extensions: [awscloudwatchmetricstreams_encoding]
  pipelines:
    metrics:
      receivers: [awsfirehose]
      processors: [batch]
      exporters: [otlphttp]
```

A stream in the **JSON** output format (`format: json`) works too: it sends each metric under its bare name, and OneUptime tells SQS's from SNS's by the `service.name` the stream stamps (`SQS`, `SNS`).

A dead-letter queue is an ordinary SQS queue with metrics of its own, so it is a queue of its own in OneUptime. Queues are named by their name alone, not their account or region (see [Limitations](#limitations)).

| Metric | Shown as | Type |
| --- | --- | --- |
| `amazonaws.com/aws/sqs/approximatenumberofmessagesvisible` (JSON stream: `approximatenumberofmessagesvisible`) | Messages visible | Gauge |
| `amazonaws.com/aws/sqs/approximateageofoldestmessage` (JSON stream: `approximateageofoldestmessage`) | Oldest message age | Gauge |
| `amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible` (JSON stream: `approximatenumberofmessagesnotvisible`) | Messages in flight | Gauge |
| `amazonaws.com/aws/sqs/numberofmessagessent` (JSON stream: `numberofmessagessent`) | Messages sent | Count per period |
| `amazonaws.com/aws/sqs/numberofmessagesreceived` (JSON stream: `numberofmessagesreceived`) | Messages received | Count per period |
| `amazonaws.com/aws/sqs/numberofmessagesdeleted` (JSON stream: `numberofmessagesdeleted`) | Messages deleted | Count per period |

### Apache ActiveMQ

The collector has no JMX receiver, so run the OpenTelemetry JMX Scraper with `OTEL_JMX_TARGET_SYSTEM=activemq` beside an ActiveMQ Classic broker; it pushes the broker's destination metrics over OTLP.

1. Let the broker accept JMX connections. With the `apache/activemq-classic` image or the `bin/activemq` script, set `ACTIVEMQ_SUNJMX_START` before starting it. This example turns authentication off: keep the port on a private network, or turn `jmxremote.authenticate` on with a password file and give the scraper `OTEL_JMX_USERNAME` and `OTEL_JMX_PASSWORD`.

```bash
ACTIVEMQ_SUNJMX_START="-Dcom.sun.management.jmxremote.port=1099 -Dcom.sun.management.jmxremote.rmi.port=1099 -Dcom.sun.management.jmxremote.authenticate=false -Dcom.sun.management.jmxremote.ssl=false -Djava.rmi.server.hostname=activemq"
```

2. Run the scraper where it can reach that port, with a Java runtime. It sends straight to OneUptime; to route it through your own collector instead, point `OTEL_EXPORTER_OTLP_ENDPOINT` at the collector's OTLP receiver.

```bash
curl -fsSLo opentelemetry-jmx-scraper.jar https://github.com/open-telemetry/opentelemetry-java-contrib/releases/latest/download/opentelemetry-jmx-scraper.jar

export OTEL_JMX_SERVICE_URL=service:jmx:rmi:///jndi/rmi://activemq:1099/jmxrmi
export OTEL_JMX_TARGET_SYSTEM=activemq
export OTEL_JMX_TARGET_SOURCE=instrumentation
export OTEL_METRIC_EXPORT_INTERVAL=30000
export OTEL_SERVICE_NAME=activemq-prod
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
java -jar opentelemetry-jmx-scraper.jar
```

`OTEL_JMX_TARGET_SOURCE=instrumentation` keeps the metric names the scraper has used since 1.53.0-alpha (`activemq.message.queue.size`, with the destination in `messaging.destination.name`). OneUptime also reads the names of older scrapers and of `OTEL_JMX_TARGET_SOURCE=legacy` (`activemq.message.current`, with the destination in `destination`).

The broker's metrics join the queue its JMS clients' spans created — and from then on the queue shows as Apache ActiveMQ (see [What makes two sightings one queue](#what-makes-two-sightings-one-queue)). The scraper reports every destination: OneUptime ignores the advisory topics, while dead-letter queues (`ActiveMQ.DLQ`, or `DLQ.<destination>` with an individual dead-letter strategy) are queues of their own. ActiveMQ Artemis has different MBeans, which these rules do not read: Artemis queues still come from their JMS spans, without broker health.

| Metric | Shown as | Type |
| --- | --- | --- |
| `activemq.message.queue.size` | Queue size | Gauge |
| `activemq.message.current` | Queue size (legacy names) | Gauge |
| `activemq.message.enqueued` | Enqueued | Counter, charted per second |
| `activemq.message.dequeued` | Dequeued | Counter, charted per second |
| `activemq.message.expired` | Expired | Counter, charted per second |
| `activemq.consumer.count` | Consumers | Gauge |
| `activemq.message.enqueue.average_duration` | Average time in queue | Gauge |
| `activemq.message.wait_time.avg` | Average time in queue (legacy names) | Gauge |

### Apache Kafka

The collector's `kafka_metrics` receiver reads consumer-group lag and partition offsets from the brokers; enable its `topics` and `consumers` scrapers.

```yaml
receivers:
  kafka_metrics:
    brokers: ["kafka-1:9092", "kafka-2:9092"]
    # topics: each partition's log-end offset; consumers: each group's
    # committed offsets and lag. brokers: the broker count.
    scrapers: [brokers, topics, consumers]
    collection_interval: 30s
    # auth:
    #   sasl:
    #     mechanism: SCRAM-SHA-512
    #     username: ${env:KAFKA_USERNAME}
    #     password: ${env:KAFKA_PASSWORD}
    # tls:
    #   ca_file: /etc/kafka/ca.pem

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [kafka_metrics]
      processors: [batch]
      exporters: [otlphttp]
```

For a cluster with SASL or TLS, uncomment `auth` and `tls`. The receiver names each topic in `topic`, which is how the metrics find the topic's queue. It reports a consumer group's lag and committed offsets only on topics the group has committed an offset to, and skips topics whose names start with `_` — Kafka's internal ones (`topic_match` defaults to `^[^_].*$`).

| Metric | Shown as | Type |
| --- | --- | --- |
| `kafka.consumer_group.lag_sum` | Consumer lag | Gauge |
| `kafka.consumer_group.lag` | Partition lag | Gauge |
| `kafka.consumer_group.offset_sum` | Consumed | Counter, charted per second |
| `kafka.partition.current_offset` | Produced | Counter, charted per second |

### Apache Pulsar

Every broker serves its topic and subscription metrics on its web service port; scrape each broker, because a broker reports only the topics it currently owns.

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: pulsar-broker
          scrape_interval: 30s
          metrics_path: /metrics/
          # Every broker: each one reports only the topics it owns.
          static_configs:
            - targets: ["pulsar-broker-0:8080", "pulsar-broker-1:8080"]
          # Keeps the families the queue page charts; remove it to keep all.
          metric_relabel_configs:
            - source_labels: [__name__]
              regex: "pulsar_(msg_backlog|subscription_back_log|storage_backlog_age_seconds|in_messages_total|out_messages_total)"
              action: keep

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp]
```

- Topic and subscription series need `exposeTopicLevelMetricsInPrometheus=true` in `broker.conf`, which is the default.
- Pulsar labels each series with the topic's full name (`persistent://public/default/orders`), and a partition's with the partition's (`persistent://public/default/orders-partition-3`): partitions add up into their topic.
- Backlog is counted in entries, and Pulsar counts a batch of messages as one entry.
- Pulsar repeats `pulsar_out_messages_total` per consumer when `exposeConsumerLevelMetricsInPrometheus=true`; those per-consumer series are left out of the charts, so no message counts twice.
- `pulsar_storage_backlog_age_seconds` reads `-1` while the broker cannot tell.
- The native OpenTelemetry metrics of Pulsar 3.3 and later (experimental, off by default) use other names, which are not charted.

| Metric | Shown as | Type |
| --- | --- | --- |
| `pulsar_msg_backlog` | Backlog | Gauge |
| `pulsar_subscription_back_log` | Subscription backlog | Gauge |
| `pulsar_storage_backlog_age_seconds` | Backlog age | Gauge |
| `pulsar_in_messages_total` | Messages in | Counter, charted per second |
| `pulsar_out_messages_total` | Messages out | Counter, charted per second |

### Apache RocketMQ

Set `metricsExporterType=PROM` in the broker's `broker.conf` so the broker serves its lag and throughput metrics.

```text
metricsExporterType=PROM
metricsPromExporterPort=5557
metricsPromExporterHost=0.0.0.0
```

Then scrape every broker:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: rocketmq-broker
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets: ["rocketmq-broker-a:5557", "rocketmq-broker-b:5557"]

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp]
```

This is RocketMQ 5's built-in exporter. RocketMQ 4 has none; the separate `rocketmq-exporter` it uses reports other metric names, which are not charted. A consumer group's dead-letter topic (`%DLQ%<group>`) is a queue of its own.

| Metric | Shown as | Type |
| --- | --- | --- |
| `rocketmq_consumer_lag_messages` | Consumer lag | Gauge |
| `rocketmq_consumer_ready_messages` | Ready messages | Gauge |
| `rocketmq_send_to_dlq_messages_total` | Sent to dead-letter queue | Counter, charted per second |
| `rocketmq_messages_in_total` | Messages in | Counter, charted per second |

### Azure Event Grid

Azure Monitor has the topics' delivery and dead-letter metrics, which the collector's `azure_monitor` receiver reads; they are not yet charted on a queue page, so explore them under Metrics.

The receiver signs in through the `azure_auth` extension. Give the service principal the **Monitoring Reader** role on the subscription:

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/eventgrid:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    services:
      - Microsoft.EventGrid/topics
      - Microsoft.EventGrid/systemTopics
      - Microsoft.EventGrid/domains
    maximum_number_of_records_per_resource: 1000

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  extensions: [azure_auth]
  pipelines:
    metrics:
      receivers: [azure_monitor/eventgrid]
      processors: [batch]
      exporters: [otlphttp]
```

OneUptime does not chart Event Grid's metrics on a queue's page: Azure Monitor reports them per Event Grid resource and event subscription, not in a form that names one of your queues. They arrive in the **Metrics** explorer — `azure_publishsuccesscount_total`, `azure_deliverysuccesscount_total`, `azure_deadletteredcount_total` and the rest. For Event Grid namespaces, add `Microsoft.EventGrid/namespaces` to `services`.

### Azure Event Hubs

Read the namespace's metrics from Azure Monitor with the collector's `azure_monitor` receiver, which splits them per event hub by the EntityName dimension.

The receiver signs in through the `azure_auth` extension. Give the service principal the **Monitoring Reader** role on the subscription:

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/eventhubs:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    services: [Microsoft.EventHub/namespaces]
    maximum_number_of_records_per_resource: 1000
    metrics:
      "Microsoft.EventHub/namespaces":
        IncomingMessages: [Total]
        OutgoingMessages: [Total]
        ServerErrors: [Total]
        UserErrors: [Total]
        QuotaExceededErrors: [Total]
        ThrottledRequests: [Total]

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  extensions: [azure_auth]
  pipelines:
    metrics:
      receivers: [azure_monitor/eventhubs]
      processors: [batch]
      exporters: [otlphttp]
```

The metrics find their event hub by the namespace (`name`) and the event hub (`EntityName`) — the namespace spans report as `<namespace>.servicebus.windows.net`. `maximum_number_of_records_per_resource` is how many series Azure returns per metric and namespace, 10 unless you raise it: keep it above your number of event hubs, or the rest go unreported. Leave `use_batch_api` off, as it is by default: the batch API has failed for Event Hubs namespaces since collector 0.155.0.

Azure Monitor has no consumer-lag metric for Event Hubs: its `ConsumerLag` exists only in the application metrics logs of the Premium and Dedicated tiers, which this receiver does not read.

| Metric | Shown as | Type |
| --- | --- | --- |
| `azure_incomingmessages_total` | Incoming messages | Count per period |
| `azure_outgoingmessages_total` | Outgoing messages | Count per period |
| `azure_servererrors_total` | Server errors | Count per period |
| `azure_usererrors_total` | User errors | Count per period |
| `azure_quotaexceedederrors_total` | Quota exceeded errors | Count per period |
| `azure_throttledrequests_total` | Throttled requests | Count per period |

### Azure Service Bus

Read the namespace's metrics from Azure Monitor with the collector's `azure_monitor` receiver, which splits them per queue and topic by the EntityName dimension.

The receiver signs in through the `azure_auth` extension. Give the service principal the **Monitoring Reader** role on the subscription:

```yaml
extensions:
  azure_auth:
    service_principal:
      tenant_id: ${env:AZURE_TENANT_ID}
      client_id: ${env:AZURE_CLIENT_ID}
      client_secret: ${env:AZURE_CLIENT_SECRET}

receivers:
  azure_monitor/servicebus:
    subscription_ids: ["${env:AZURE_SUBSCRIPTION_ID}"]
    auth:
      authenticator: azure_auth
    collection_interval: 60s
    services: [Microsoft.ServiceBus/namespaces]
    # Series Azure returns per metric and namespace (default 10): keep it
    # above your number of queues and topics.
    maximum_number_of_records_per_resource: 1000
    metrics:
      "Microsoft.ServiceBus/namespaces":
        ActiveMessages: [Average]
        DeadletteredMessages: [Average]
        IncomingMessages: [Total]
        OutgoingMessages: [Total]
        CompleteMessage: [Total]
        AbandonMessage: [Total]
        ServerErrors: [Total]
        UserErrors: [Total]
        ThrottledRequests: [Total]

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  extensions: [azure_auth]
  pipelines:
    metrics:
      receivers: [azure_monitor/servicebus]
      processors: [batch]
      exporters: [otlphttp]
```

- The metrics find their queue or topic by the namespace (`name`) and the entity (`EntityName`); the SDKs' spans name the same namespace as `<namespace>.servicebus.windows.net`. A span on `orders/Subscriptions/billing` or `orders/$DeadLetterQueue` belongs to `orders`, like the metrics.
- `maximum_number_of_records_per_resource` is how many series Azure returns per metric and namespace, 10 unless you raise it: keep it above your number of queues and topics — the error metrics split each entity further by result — or the rest go unreported.
- Azure Monitor does not split by topic subscription: a topic's counts cover all its subscriptions.
- The `metrics` list collects exactly what the queue page charts, each with the one aggregation it charts; add a metric (`ScheduledMessages`, `Size`, …) to collect it too.
- The receiver lists your namespaces once a day, so a new namespace can take up to 24 hours to appear.

| Metric | Shown as | Type |
| --- | --- | --- |
| `azure_activemessages_average` | Active messages | Gauge |
| `azure_deadletteredmessages_average` | Dead-lettered messages | Gauge |
| `azure_incomingmessages_total` | Incoming messages | Count per period |
| `azure_outgoingmessages_total` | Outgoing messages | Count per period |
| `azure_completemessage_total` | Completed messages | Count per period |
| `azure_abandonmessage_total` | Abandoned messages | Count per period |
| `azure_servererrors_total` | Server errors | Count per period |
| `azure_usererrors_total` | User errors | Count per period |
| `azure_throttledrequests_total` | Throttled requests | Count per period |

### BullMQ

BullMQ keeps its jobs in Redis and has no broker to scrape; report queue depth from the application as a metric carrying `messaging.system` and `messaging.destination.name`, as OneUptime's own workers do with `queue.size`.

BullMQ's own telemetry — its `telemetry` option, which the `bullmq-otel` package implements — names the queue in `bullmq.queue.name` and sets no `messaging.system`, so on its own it creates no queue. A `transform` processor in the collector your applications send to adds the two keys OneUptime reads, on the spans that add and process jobs and on BullMQ's own metrics:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  # BullMQ names the queue in bullmq.queue.name and sets no
  # messaging.system: copy it into the keys OneUptime reads, on the spans
  # that publish (add) and process jobs, and on BullMQ's own metrics.
  transform/bullmq:
    error_mode: ignore
    trace_statements:
      - set(span.attributes["messaging.system"], "bullmq") where span.attributes["bullmq.queue.name"] != nil and span.attributes["messaging.system"] == nil and (span.kind == SPAN_KIND_PRODUCER or span.kind == SPAN_KIND_CONSUMER)
      - set(span.attributes["messaging.destination.name"], span.attributes["bullmq.queue.name"]) where span.attributes["messaging.system"] == "bullmq" and span.attributes["messaging.destination.name"] == nil
    metric_statements:
      - set(datapoint.attributes["messaging.system"], "bullmq") where datapoint.attributes["bullmq.queue.name"] != nil and datapoint.attributes["messaging.system"] == nil
      - set(datapoint.attributes["messaging.destination.name"], datapoint.attributes["bullmq.queue.name"]) where datapoint.attributes["messaging.system"] == "bullmq" and datapoint.attributes["messaging.destination.name"] == nil
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [transform/bullmq, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      processors: [transform/bullmq, batch]
      exporters: [otlphttp]
```

Only the PRODUCER spans that add jobs and the CONSUMER spans that process them are tagged: BullMQ's internal spans (fetching the next job, extending locks) name the queue too, but are not messages. For queue depth, observe the job counts in the application; a gauge that carries the two keys itself needs no transform:

```ts
import { metrics } from "@opentelemetry/api";
import { Queue } from "bullmq";

const queue = new Queue("orders", { connection: { host: "redis" } });

metrics
  .getMeter("bullmq-queues")
  .createObservableGauge("queue.size", { unit: "{job}" })
  .addCallback(async (result) => {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
    for (const [state, count] of Object.entries(counts)) {
      result.observe(count, {
        "messaging.system": "bullmq",
        "messaging.destination.name": queue.name,
        state,
      });
    }
  });
```

It shows on the queue's **Metrics** tab. OneUptime has no BullMQ metrics of its own to chart under **Broker health**.

### Google Cloud Pub/Sub

Read the topics' and subscriptions' metrics from Cloud Monitoring with the collector's `googlecloudmonitoring` receiver, listing each metric type under `metrics_list`.

The receiver signs in with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the service account the collector runs as), which need the **Monitoring Viewer** role on the project:

```yaml
receivers:
  googlecloudmonitoring:
    project_id: my-gcp-project
    collection_interval: 2m
    # Only the metric types listed here are read.
    metrics_list:
      - metric_name: pubsub.googleapis.com/subscription/num_undelivered_messages
      - metric_name: pubsub.googleapis.com/subscription/oldest_unacked_message_age
      - metric_name: pubsub.googleapis.com/subscription/dead_letter_message_count
      - metric_name: pubsub.googleapis.com/subscription/ack_message_count
      - metric_name: pubsub.googleapis.com/topic/send_request_count

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [googlecloudmonitoring]
      processors: [batch]
      exporters: [otlphttp]
```

- A metric type missing from `metrics_list` is never read, and the list is read when the collector starts: restart it after a change.
- `collection_interval` is at least one minute. Cloud Monitoring publishes Pub/Sub's metrics two to four minutes late.
- Subscription metrics attach to the subscription's queue (`subscription_id`), topic metrics to the topic's (`topic_id`) — which is also how the client libraries' spans name them (see [Limitations](#limitations)).

| Metric | Shown as | Type |
| --- | --- | --- |
| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Undelivered messages | Gauge |
| `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Oldest unacked message age | Gauge |
| `pubsub.googleapis.com/subscription/dead_letter_message_count` | Dead-lettered messages | Count per period |
| `pubsub.googleapis.com/subscription/ack_message_count` | Acknowledged messages | Count per period |
| `pubsub.googleapis.com/topic/send_request_count` | Publish requests | Count per period |

### JMS

JMS is an API, and its spans do not name the broker behind it; when the broker is Apache ActiveMQ, run the OpenTelemetry JMX Scraper against it and its metrics join the same queue, which is then shown as an ActiveMQ queue, while other JMS brokers such as IBM MQ have no ready-made metrics path.

Queues of JMS applications appear from their spans, whatever the broker: see [Apache ActiveMQ](#apache-activemq) for the scraper. For any other broker, send its metrics with `messaging.system` set to `jms` and `messaging.destination.name` set to the queue's name on each datapoint: they then attach to the same queue as the spans, and show on its **Metrics** tab.

### NATS

Run prometheus-nats-exporter with `-jsz=all` against the server's monitoring port. Its JetStream metrics are per stream and consumer, not per subject, so they do not attach to subject-level queues.

Turn on the server's monitoring port with `-m 8222` (or `http_port: 8222` in its configuration), then run the exporter:

```bash
prometheus-nats-exporter -varz -jsz=all http://nats:8222
```

And scrape it:

```yaml
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          scrape_interval: 30s
          metrics_path: /metrics
          static_configs:
            - targets: ["nats-exporter:7777"]

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp]
```

NATS queues are subjects (`orders.created`), named by the Java agent's spans, and JetStream's streams and consumers do not map onto one subject, so OneUptime charts none of these on a queue's page. They arrive in the **Metrics** explorer: `jetstream_consumer_num_pending`, `jetstream_consumer_num_ack_pending`, `jetstream_stream_total_messages` and the rest.

### RabbitMQ

The collector's `rabbitmq` receiver reads each queue's depth, consumers and message rates from the management plugin's HTTP API, as a user tagged `monitoring` with access to each virtual host.

Enable the management plugin and create that user. The `monitoring` tag alone shows it no queue: the management API lists a user only the queues of the virtual hosts it has access to, so give it access to each virtual host to monitor. Empty patterns grant that access without any right to configure, publish or consume:

```bash
rabbitmq-plugins enable rabbitmq_management
rabbitmqctl add_user otel 'a-strong-password'
rabbitmqctl set_user_tags otel monitoring
# Once per virtual host to monitor; "/" is the default one.
rabbitmqctl set_permissions -p / otel "" "" ""
```

```yaml
receivers:
  rabbitmq:
    endpoint: http://rabbitmq:15672
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
    collection_interval: 30s

processors:
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [rabbitmq]
      processors: [batch]
      exporters: [otlphttp]
```

- The receiver reports each queue under its RabbitMQ name. Most instrumentations' spans name the exchange instead, on publishers and consumers alike, so they land on a queue of their own in OneUptime. Spans name the queue itself for messages sent through the default exchange, and on consumers the Java agent traces with `OTEL_SEMCONV_STABILITY_OPT_IN=messaging` (see [Limitations](#limitations)).
- Without access to a virtual host, the receiver sees none of its queues: it sends nothing for them and logs no error.
- The published, delivered, acknowledged and dropped counters appear only once the queue has seen that activity: until then the receiver sends nothing, not 0.

| Metric | Shown as | Type |
| --- | --- | --- |
| `rabbitmq.message.current` | Queue depth | Gauge |
| `rabbitmq.message.published` | Published | Counter, charted per second |
| `rabbitmq.message.delivered` | Delivered | Counter, charted per second |
| `rabbitmq.message.acknowledged` | Acknowledged | Counter, charted per second |
| `rabbitmq.message.dropped` | Dropped | Counter, charted per second |
| `rabbitmq.consumer.count` | Consumers | Gauge |

## Alerting

Queues are watched with **Metrics** monitors over their broker metrics (see [Metrics Monitor](/docs/monitor/metrics-monitor)).

**From the queue's page.** Each gauge and each count per period in **Broker health** has **Create monitor**: it opens a new Metrics monitor over that metric, filtered on the exact attribute values that name this queue in it, with a starting threshold where the metric measures something with an obvious bad direction — backlog, dead letters, consumer lag, oldest message age, throttling or errors. Four of those start without one, because a fixed threshold on them misleads: Kafka's partition lag (`kafka.consumer_group.lag`), which its consumer group's lag already covers; ActiveMQ's average time in queue (`activemq.message.enqueue.average_duration`, `activemq.message.wait_time.avg`), an average since the broker started that stays high long after a stall; and Pulsar's backlog age (`pulsar_storage_backlog_age_seconds`), which reads `-1` while the broker cannot tell. Counters get no monitor: their chart shows a rate, and a monitor has no rate function.

**Counters.** RabbitMQ's, Apache ActiveMQ's and Apache RocketMQ's counters reach the collector as cumulative sums, which a `cumulative_to_delta` processor (`cumulativetodelta` in older collectors) turns into deltas that a monitor can alert on. Convert a copy under a name of its own, never the counter itself: the queue page reads each of these counters as a running total and charts how fast it grows, so a counter turned into deltas charts nonsense under **Broker health** and on the **Metrics** tab — steady traffic reads as 0 messages per second. Apache Kafka's offsets (`kafka.consumer_group.offset_sum`, `kafka.partition.current_offset`) and Apache Pulsar's `pulsar_in_messages_total` and `pulsar_out_messages_total` arrive as gauges, which `cumulative_to_delta` leaves alone: alert on those systems' lag and backlog gauges instead.

The [RabbitMQ](#rabbitmq) config with a copy of `rabbitmq.message.published` to alert on:

```yaml
receivers:
  rabbitmq:
    endpoint: http://rabbitmq:15672
    username: ${env:RABBITMQ_USERNAME}
    password: ${env:RABBITMQ_PASSWORD}
    collection_interval: 30s

processors:
  # A copy of each counter to alert on, under a name of its own: the queue
  # page keeps charting the original.
  transform/alerting:
    error_mode: ignore
    metric_statements:
      - copy_metric(name="rabbitmq.message.published.delta") where metric.name == "rabbitmq.message.published"
  # Turns only the copies into deltas. `drop` keeps back each copy's first
  # point after a start, which would otherwise be the counter's whole total.
  cumulative_to_delta/alerting:
    initial_value: drop
    include:
      metrics:
        - rabbitmq.message.published.delta
      match_type: strict
  batch: {}

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [rabbitmq]
      processors: [transform/alerting, cumulative_to_delta/alerting, batch]
      exporters: [otlphttp]
```

Each point of `rabbitmq.message.published.delta` is the number of messages published since the previous scrape, so a Metrics monitor on it, filtered on `resource.rabbitmq.queue.name` and summed over its window, counts what was published in that window: below 1 over 15 minutes, nobody publishes. After every collector start, the processor has no earlier value to subtract a queue's first point from, and by default it sends that point as it is: the counter's whole running total, as if every message the queue ever had were published in one scrape. `initial_value: drop` keeps that point back, so a queue's copy starts with the second scrape that reports its counter. Copy another counter the same way, with a `copy_metric` statement and an `include` entry each. ActiveMQ's JMX Scraper must then send through such a collector, to an `otlp` receiver in place of `rabbitmq`; RocketMQ's counters take the same two processors in the pipeline of its `prometheus` receiver.

**By hand**, filter on the attribute that names the queue in that metric — they are the same for every queue of a system:

| Alert when | Metric | Filter | Aggregation |
| --- | --- | --- | --- |
| A Kafka consumer group falls behind | `kafka.consumer_group.lag_sum` | `topic` = `orders` | Max |
| An SQS queue's oldest message gets old | `amazonaws.com/aws/sqs/approximateageofoldestmessage` | `Dimensions.QueueName` = `orders` | Max |
| Messages reach a Service Bus dead-letter queue | `azure_deadletteredmessages_average` | `name` = `shop-prod`, `metadata_entityname` = `orders` | Max |
| A Pub/Sub subscription's backlog grows | `pubsub.googleapis.com/subscription/num_undelivered_messages` | `resource.subscription_id` = `orders-billing` | Max |
| Nobody consumes a RabbitMQ queue | `rabbitmq.consumer.count` | `resource.rabbitmq.queue.name` = `orders` | Min |

To watch every queue of a system with one monitor, group by that attribute instead of filtering on it: each queue then alerts on its own (see [Per-Series Alerting](/docs/monitor/metrics-monitor#per-series-alerting-group-by)). A RabbitMQ queue's depth (`rabbitmq.message.current`) arrives as two series, `state` = `ready` and `state` = `unacknowledged`. The monitor **Create monitor** builds adds them up the way the queue page does: a query per state, `a_ready` and `a_unacknowledged`, and the formula `a_ready + a_unacknowledged`, whose alias `a` its starting threshold applies to. A monitor built by hand should do the same, with its criteria on the formula.

**Late metrics.** Cloud monitoring APIs publish their numbers minutes after the fact: the `aws_cloudwatch` receiver's newest point is 11 to 17 minutes old with the configuration on this page, and up to 25 with the receiver's default five-minute `period`; the `googlecloudmonitoring` receiver's is up to 9. A monitor over SQS, SNS or Pub/Sub metrics therefore needs a window longer than that, or it sees no data and never fires; **Create monitor** starts those monitors at 30 and 15 minutes.

## Limitations

- **Same-named destinations on two clusters or accounts are one queue.** A Kafka topic, a RabbitMQ queue or an SQS queue is keyed by its name alone: spans rarely name their cluster (the Java agent, kafkajs and Confluent's .NET client report no broker address), so a cluster in the identity would split every topic by instrumentation instead. Two clusters with a topic called `orders`, or two AWS accounts or regions with a queue called `orders`, share one queue in a project. Azure Service Bus and Event Hubs are the exception: their namespace is part of the identity.
- **Kafka clients on Event Hubs are Kafka.** A Kafka client connected to Event Hubs' Kafka endpoint reports `kafka`, so its topic is a Kafka queue, separate from the event hub's own Azure Event Hubs queue and its Azure Monitor metrics.
- **Service Bus spans without a namespace host key apart.** The namespace comes from the host the SDK connected to. Spans sent to the Service Bus emulator or through a custom domain name no namespace, so their queue is a different one from the queue Azure Monitor's metrics attach to.
- **RabbitMQ spans usually name exchanges; the broker's metrics name queues.** Most instrumentations — the Java agent by default, amqplib for Node.js, pika and aio-pika for Python, RabbitMQ.Client for .NET — name the exchange a message went through, on the publishing and the consuming side alike. Their spans land on a queue named after the exchange, and the `rabbitmq` receiver's metrics on the queue itself. The two meet for messages sent through the default exchange, whose routing key is the queue's name, and for consumers traced by the Java agent 2.31.0 or later with `OTEL_SEMCONV_STABILITY_OPT_IN=messaging`, whose spans name exchange, routing key and queue (`shop:new-order:orders`), from which OneUptime takes the queue. MassTransit names one exchange per message type (`Namespace:Type`), kept whole, and its receive spans set no `messaging.system`, so they create no queue and do not show as its consumers.
- **Pub/Sub publishers name topics; subscribers name subscriptions.** Every Google client library reports the topic on the publishing side and the subscription on the consuming side, so a topic and each of its subscriptions are separate queues: publish spans and topic metrics on one, consume spans and subscription metrics on the others.
- **Pulsar's per-consumer series are left out of charts**, so messages delivered to a subscription are not counted twice.
- **Azure Storage Queues have no per-queue metrics.** Azure Monitor reports only a whole storage account's message count, once an hour, so they have no broker health.
- **RocketMQ's retry and system topics are not filtered out of broker metrics.** Series RocketMQ marks with `is_retry` or `is_system` count like any other.

## Self-hosted tuning

Self-hosted installations can tune discovery with these environment variables on the OneUptime app:

| Variable | Default | What it controls |
| --- | --- | --- |
| `MESSAGE_QUEUE_MIN_SPANS` | `3` | Spans a destination needs within the 15-minute window each 10-minute run looks at before traces create a queue for it |
| `MESSAGE_QUEUE_AUTO_CREATE_BUDGET` | `500` | Live, non-archived discovered queues a project can have before traces and broker metrics stop creating new ones. Queues created by hand are exempt; `0` turns automatic creation off |
| `MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS` | `7` | Days unseen before an untouched discovered queue is archived (minimum 1) |

## Troubleshooting

### A queue my applications use was not created

- Its spans name no messaging system OneUptime can tell: Celery's spans, BullMQ's own telemetry (see [BullMQ](#bullmq)) or a hand-rolled client. Add `messaging.system` and `messaging.destination.name`, and give the spans the PRODUCER or CONSUMER kind.
- Its name is one OneUptime ignores (see [What is ignored](#what-is-ignored)), or only SERVER spans name it.
- Fewer than 3 of its spans arrived in the last 15 minutes, or the project reached its [auto-create budget](#the-auto-create-budget).

When its spans do name it, create it by hand with the same system and destination (**Queues → Create Queue**): its **Traces** tab fills in from the spans already stored.

### Broker health stays empty

- Check the collector's log. OneUptime refuses a wrong ingestion key with `401` (`422` for a disabled key or a browser key), and the collector logs `Exporting failed` for every batch it drops.
- The metric names the queue differently from the spans. RabbitMQ spans usually name the exchange, while the broker's metrics describe queues; a Pub/Sub topic has the topic metrics and its subscriptions the subscription metrics; Service Bus and Event Hubs spans without a namespace host are on a different queue from Azure Monitor's metrics (see [Limitations](#limitations)).
- The receiver does not report it. Kafka reports a consumer group's lag only after the group commits an offset; RabbitMQ reports only the queues of virtual hosts its user has access to, and logs no error for the rest (see [RabbitMQ](#rabbitmq)); RabbitMQ's counters appear with the first activity; Azure Monitor returns 10 queues per metric and namespace unless `maximum_number_of_records_per_resource` is raised; Cloud Monitoring reads only the types in `metrics_list`.
- It is late. `aws_cloudwatch` waits `delay` (10 minutes) for CloudWatch to publish, so its points arrive 11 to 17 minutes late, and Pub/Sub's metrics arrive minutes late.
- The system has no charted metrics: Azure Event Grid, NATS, JMS brokers other than ActiveMQ and BullMQ (see their sections). Their metrics are in the **Metrics** explorer.

### Two queues for one destination

- Two systems name it: a Kafka client on Event Hubs' Kafka endpoint reports `kafka`, the Event Hubs SDK `eventhubs`.
- One Service Bus or Event Hubs sighting has no namespace: the emulator or a custom domain.
- RabbitMQ spans usually name the exchange, and the broker's metrics the queue: two queues in OneUptime unless the exchange and the queue share a name (see [Limitations](#limitations)).

Archive the one you do not want: an archived queue stays archived, and what names it no longer creates a new one.

### A new queue for every request

A destination named per request or per consumer that OneUptime does not recognise — a numeric suffix, a hash — makes a queue per name. UUIDs are already folded (see [What is ignored](#what-is-ignored)). Mark such destinations `messaging.destination.temporary=true` in your instrumentation, or give them a stable name, then archive the queues already created.

## Next steps

- [Instrument your applications](#instrumenting-applications) so their queues appear, and set up [broker health metrics](#broker-health-metrics) for your broker.
- Build a [Metrics monitor](/docs/monitor/metrics-monitor) on a queue's backlog, lag or dead letters (see [Alerting](#alerting)).
- For Azure Functions triggered by Service Bus, see [Serverless Functions](/docs/telemetry/serverless-functions#azure-functions).
