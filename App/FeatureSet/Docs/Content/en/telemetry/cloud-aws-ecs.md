# AWS ECS / Fargate

## Overview

OneUptime groups every ECS task that reports `cloud.platform=aws_ecs` into one **Cloud Environment** per AWS account and region — _AWS ECS · us-east-1 · 123456789012_ is a single environment whether it runs one service or fifty. The services themselves keep their own rows under **Services**; the environment is the roll-up, and its **Instances** tab lists the running tasks with live CPU and memory.

Two things have to be true for every task:

1. Its telemetry carries `cloud.platform`, `cloud.account.id` and `cloud.region`. On ECS the OpenTelemetry **ECS resource detector** fills these in from the task metadata endpoint, so nothing is hard-coded.
2. Its OTLP exporter can reach OneUptime with a valid ingestion token.

This page walks through both, with the full task definition at the end. It works for the Fargate and EC2 launch types alike.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create a **Server** key from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the `x-oneuptime-token` value.
- An ECS cluster, a task definition you can revise, and the AWS CLI configured for that account.
- Your application instrumented with an OpenTelemetry SDK (any language) that exports OTLP.

## How OneUptime identifies the environment

The ECS detector — in the SDK or in the Collector — stamps these resource attributes on everything the task emits:

| Attribute                                                          | Set by the ECS detector | Used for                                                                                                               |
| ------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cloud.platform`                                                   | `aws_ecs`               | Routes the telemetry to **Cloud Environments** (the value must be exact)                                               |
| `cloud.account.id`                                                 | `123456789012`          | Part of the environment key                                                                                            |
| `cloud.region`                                                     | `us-east-1`             | Part of the environment key                                                                                            |
| `aws.ecs.task.arn`                                                 | the task ARN            | Identity of one running task — shown under **Instances** as the task id                                                |
| `aws.ecs.task.id`                                                  | the task id             | Same purpose; newer detector versions set both                                                                         |
| `aws.ecs.cluster.arn`, `aws.ecs.task.family`, `aws.ecs.launchtype` | —                       | Kept on every span, log and metric as resource attributes (open a trace under **Traces**); not part of the environment |

The environment key is `aws_ecs|123456789012|us-east-1`. The task id is the instance identity even when the SDK also sets `service.instance.id` — the sidecar's container metrics carry only the task id, so keying on it keeps the app's spans and the task's CPU / memory on one row. See [Cloud Environments](/docs/telemetry/cloud-environments) for the full rule.

## Step 1 — Store the token in Secrets Manager

> **This token is a secret.** Keep it in AWS Secrets Manager and reference it from the task definition with `secrets` / `valueFrom`. A token pasted into a plain `environment` entry is visible to anyone who can read the task definition or the console, and it ends up in every `describe-task-definition` output and CloudFormation diff.

```bash
aws secretsmanager create-secret \
  --name oneuptime/ingestion-token \
  --region us-east-1 \
  --secret-string "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Note the ARN the command prints — it ends in a random suffix like `oneuptime/ingestion-token-AbCdEf` and you will paste it into the task definition.

The **task execution role** (the role ECS uses to start the task, not the role your code runs as) needs permission to read it. Attach this policy to `ecsTaskExecutionRole`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:oneuptime/ingestion-token-*"
    }
  ]
}
```

If the secret is encrypted with a customer-managed KMS key, the same role also needs `kms:Decrypt` on that key. Without either, the task fails to start with `ResourceInitializationError: unable to pull secrets`.

## Step 2 — Choose a deployment shape

**Shape A — the SDK exports straight to OneUptime.** No extra container. Enable the AWS resource detector in the SDK so it sets the `cloud.*` attributes, and point the exporter at OneUptime. Simplest, and the right choice for a single service. You do not get per-task CPU / memory this way, because nothing in the task reads the container stats.

**Shape B — a sidecar OpenTelemetry Collector.** A second container in the same task. The application exports to `http://localhost:4318`; the collector runs the `resourcedetection` processor so `cloud.*` is stamped on everything that passes through — including telemetry from libraries that never heard of ECS — and the `awsecscontainermetrics` receiver ships per-task CPU and memory so the environment's tiles fill in. One token in one place, and the app never sees it.

Most teams end up on Shape B. The rest of this page shows both; the full task definition in Step 4 is Shape B.

### Shape A — SDK resource detector switches

| Language | Enable the ECS detector                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Node.js  | `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws` (auto-instrumentations-node)                                     |
| Python   | `pip install opentelemetry-sdk-extension-aws` then `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs`               |
| Java     | `-Dotel.resource.providers.aws.enabled=true` (the agent ships the provider disabled)                            |
| Go       | `import "go.opentelemetry.io/contrib/detectors/aws/ecs"` and pass `ecs.NewResourceDetector()` to `resource.New` |
| .NET     | `OpenTelemetry.Resources.AWS` package: `.ConfigureResource(r => r.AddAWSECSDetector())`                         |

And the exporter, as environment variables on the application container:

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# Injected from Secrets Manager — see the note below.
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

ECS injects a secret's value verbatim into the variable, and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair. So for Shape A store the secret as the **complete header** — `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN` — and reference it with `"secrets": [{ "name": "OTEL_EXPORTER_OTLP_HEADERS", "valueFrom": "<secret ARN>" }]`. For Shape B the secret holds just the token.

If you self-host OneUptime, replace the endpoint with `https://YOUR-ONEUPTIME-HOST/otlp`.

### Shape B — sidecar collector configuration

The collector is configured entirely through one environment variable, so there is no config file to bake into an image. Start the container with `--config=env:OTEL_COLLECTOR_CONFIG`, and the `${env:ONEUPTIME_TOKEN}` reference inside the YAML is expanded by the collector from the secret ECS injects:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317
  # Per-task and per-container CPU / memory from the ECS task metadata
  # endpoint. This is what fills the CPU and memory tiles in OneUptime.
  awsecscontainermetrics:
    collection_interval: 20s
processors:
  # Stamps cloud.provider, cloud.platform=aws_ecs, cloud.account.id,
  # cloud.region and aws.ecs.task.arn on every span, log and metric.
  resourcedetection:
    detectors: [env, ecs]
    timeout: 5s
  batch: {}
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp, awsecscontainermetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
```

Neither the `ecs` detector nor the `awsecscontainermetrics` receiver needs IAM permissions: both read the task metadata endpoint that ECS exposes to every container through `ECS_CONTAINER_METADATA_URI_V4`.

The application container then only needs:

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

In `awsvpc` network mode (always, on Fargate) every container in a task shares one network namespace, so `localhost` is the sidecar.

## Step 3 — Update the task definition in the console

If you prefer clicking to editing JSON:

1. **AWS Console → Amazon Elastic Container Service → Task definitions** → select the family → **Create new revision**.
2. Under **Container - 1** (your application), expand **Environment variables** and add `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://localhost:4318` for Shape B) and `OTEL_EXPORTER_OTLP_PROTOCOL`. For Shape A also add `OTEL_EXPORTER_OTLP_HEADERS` with **Value type: ValueFrom** and the secret ARN as the value, plus the detector switch for your language from the table above.
3. Shape B: **+ Add container**. Name `otel-collector`, image `otel/opentelemetry-collector-contrib:latest` (pin a version once it works), **Essential container: No**. Under **Docker configuration → Command** enter `--config=env:OTEL_COLLECTOR_CONFIG`.
4. Still on the collector container, under **Environment variables** add `ONEUPTIME_TOKEN` with **Value type: ValueFrom** and the secret ARN, and `OTEL_COLLECTOR_CONFIG` with **Value type: Value** and the YAML above pasted as the value.
5. Under **Startup dependency ordering** on the application container, add `otel-collector` with condition **Start**, so the app never boots before there is something listening on port 4318.
6. Under **Task execution role** confirm the role you attached the Secrets Manager policy to.
7. **Create**. Then **Clusters → your cluster → Services → select the service → Update → Task definition revision: latest → Deploy**.

## Step 4 — The full task definition (JSON)

The same thing as a file you can register with `aws ecs register-task-definition --cli-input-json file://task-definition.json`. Replace the account id, region, image and secret ARN:

```json
{
  "family": "checkout-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/checkout-api-task-role",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/checkout-api:1.4.2",
      "essential": true,
      "portMappings": [{ "containerPort": 8080, "protocol": "tcp" }],
      "environment": [
        { "name": "OTEL_SERVICE_NAME", "value": "checkout-api" },
        {
          "name": "OTEL_EXPORTER_OTLP_ENDPOINT",
          "value": "http://localhost:4318"
        },
        { "name": "OTEL_EXPORTER_OTLP_PROTOCOL", "value": "http/protobuf" }
      ],
      "dependsOn": [
        { "containerName": "otel-collector", "condition": "START" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/checkout-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "app"
        }
      }
    },
    {
      "name": "otel-collector",
      "image": "otel/opentelemetry-collector-contrib:latest",
      "essential": false,
      "command": ["--config=env:OTEL_COLLECTOR_CONFIG"],
      "secrets": [
        {
          "name": "ONEUPTIME_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:oneuptime/ingestion-token-AbCdEf"
        }
      ],
      "environment": [
        {
          "name": "OTEL_COLLECTOR_CONFIG",
          "value": "receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\n      grpc:\n        endpoint: 0.0.0.0:4317\n  awsecscontainermetrics:\n    collection_interval: 20s\nprocessors:\n  resourcedetection:\n    detectors: [env, ecs]\n    timeout: 5s\n  batch: {}\nexporters:\n  otlphttp/oneuptime:\n    endpoint: https://oneuptime.com/otlp\n    headers:\n      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      processors: [resourcedetection, batch]\n      exporters: [otlphttp/oneuptime]\n    metrics:\n      receivers: [otlp, awsecscontainermetrics]\n      processors: [resourcedetection, batch]\n      exporters: [otlphttp/oneuptime]\n    logs:\n      receivers: [otlp]\n      processors: [resourcedetection, batch]\n      exporters: [otlphttp/oneuptime]\n"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/checkout-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "otel"
        }
      }
    }
  ]
}
```

The `OTEL_COLLECTOR_CONFIG` value is the YAML from Step 2 as a single JSON string. Rather than escaping it by hand, keep the YAML in `collector.yaml` and let `jq` do it:

```bash
jq --rawfile cfg collector.yaml \
  '.containerDefinitions[1].environment[0].value = $cfg' \
  task-definition.json > task-definition.rendered.json
aws ecs register-task-definition --cli-input-json file://task-definition.rendered.json
```

## Step 5 — Networking

The task has to reach two things: Secrets Manager (to start) and OneUptime (to export). Neither is inside your VPC.

- **Fargate tasks in private subnets** need a route to the internet: a **NAT gateway** on the subnet's route table, or run the task in a public subnet with `assignPublicIp=ENABLED` in the service's network configuration. A task with neither hangs at `PENDING` on the secret pull, long before the collector sends anything.
- **Security group egress** must allow TCP **443** to the OneUptime host (`oneuptime.com`, or your own host if you self-host — on whatever port it listens on). The default security group allows all egress; a locked-down one usually does not. No inbound rule is needed for telemetry.
- If you want to avoid the NAT path for AWS services, add **VPC interface endpoints** for `com.amazonaws.us-east-1.secretsmanager` (and `ecr.api` / `ecr.dkr` / S3 for image pulls). OneUptime itself still needs the internet route.

```bash
aws ecs update-service \
  --cluster production \
  --service checkout-api \
  --task-definition checkout-api \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0abc1234],securityGroups=[sg-0def5678],assignPublicIp=ENABLED}"
```

## Step 6 — Verify

Check the token before you look anywhere else — it is the cheapest check and it invalidates everything after it:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project; `401` means it is unknown, revoked or mistyped. Run the same command from inside the task with ECS Exec to prove egress works from where it matters:

```bash
aws ecs execute-command --cluster production --task <task id> \
  --container app --interactive --command "sh"
```

Then watch the collector's CloudWatch log stream (`otel/otel-collector/...`) for `Everything is ready` and the absence of `401` / `connection refused` lines. Within a minute of the first span, log or metric the environment appears at **Cloud → All Environments** as _AWS ECS · us-east-1 · 123456789012_.

## What you get

- **Overview** — request volume, error rate and p95 latency derived from traces, plus **CPU** and **Memory** tiles and a **Top instances by CPU** list. The tiles fill from the `awsecscontainermetrics` receiver's `ecs.task.cpu.utilized` / `ecs.task.memory.utilized` (or any `container.cpu.utilization` / `container.memory.usage` metric carrying the task identity) — Shape A does not ship these.
- **Instances** — one row per running task, named by the task id (the tail of `aws.ecs.task.arn`), with its latest CPU %, memory and last-seen time. Rows go stale when a task stops.
- **Logs**, **Traces** and **Metrics** tabs scoped to the environment — everything that carried `cloud.platform=aws_ecs` for this account and region.
- Per-service breakdown for the same tasks under **Services**, keyed by `service.name`.

## Troubleshooting

The most common ECS-specific failures, in the order they happen:

- **Task stuck in `PENDING` with `ResourceInitializationError: unable to pull secrets`** — the execution role lacks `secretsmanager:GetSecretValue` on the secret, or the task has no route to Secrets Manager (no NAT, no VPC endpoint).
- **Collector logs `401`** — the secret holds the wrong value. For Shape B it must be the bare token; for Shape A the whole `x-oneuptime-token=...` header.
- **Environment appears but Instances is empty** — the telemetry has no task identity. Make sure the `ecs` detector is in the pipeline (the resource must carry `aws.ecs.task.arn`, `aws.ecs.task.id` or `service.instance.id`).
- **Instances fill but the CPU / memory tiles stay empty** — the `awsecscontainermetrics` receiver is missing from the `metrics` pipeline, or the metrics pipeline skips the `resourcedetection` processor so the container metrics arrive without `cloud.platform`.

Everything else — an environment that never appears, lands under **Hosts** or **Serverless Functions**, goes **Disconnected**, or splits into duplicates — is on the shared [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting) page.
