# Cloud Environments

## Overview

OneUptime groups managed cloud compute into **Cloud Environments**. An environment is neither a service nor a machine: it is the place your containers run — an ECS cluster's account and region, a Cloud Run project and region, a Container Apps environment — and it aggregates every workload there. Telemetry creates environments automatically the moment it arrives with the right resource attributes; there is nothing to register by hand.

The same workloads keep their per-service breakdown under **Services**. The environment is the roll-up, with the running tasks, instances and replicas under its **Instances** tab and live CPU / memory where the platform can supply it.

This page explains how an environment is identified and which platforms qualify. The setup itself — where the exporter settings go in each cloud's console, whether you need a sidecar collector, the IAM and networking that has to be in place — is on one page per platform:

- [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs)
- [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run)
- [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps)
- [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms) — Elastic Beanstalk, App Runner, App Engine, App Service, Container Instances
- [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting)

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create a **Server** key from _Project Settings → Telemetry & APM → Ingestion Keys_ and copy the `x-oneuptime-token` value. It is a secret; every platform page shows the platform's own secret store for it.
- An OpenTelemetry SDK in your application, or an OpenTelemetry Collector running alongside it, exporting OTLP.

## How OneUptime identifies an environment

One environment exists per unique combination of three resource attributes:

| Attribute          | Required | Purpose                                                                                                        |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| `cloud.platform`   | **yes**  | Must be one of the managed values in the table below — `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`, ... |
| `cloud.account.id` | no       | The AWS account id, Google Cloud project id or Azure subscription id. Part of the environment key              |
| `cloud.region`     | no       | `us-east-1`, `us-central1`, `eastus`, ... Part of the environment key                                          |

The three are joined with `|` into the **environment key**, which is the environment's Resource Identifier:

```
aws_ecs|123456789012|us-east-1
gcp_cloud_run|my-project|us-central1
azure_container_apps|00000000-0000-0000-0000-000000000000|eastus
```

A missing part is kept as an empty segment rather than dropped — `aws_ecs||us-east-1` — so a workload that omits `cloud.account.id` lands in a **different** environment from one that sets it. That is the usual reason for seeing two environments where you expected one. The display name is built from the same values: _AWS ECS · us-east-1 · 123456789012_.

Ingest mints both the key and the name. An environment you create by hand is matched on the key alone, so its Resource Identifier must be exactly `platform|account|region`.

### Instance identity

Within an environment, one row per running task / instance / replica is created from the first of these resource attributes present: `aws.ecs.task.id`, `aws.ecs.task.arn` (shortened to the task id), `faas.instance`, `azure.container_app.instance.id`, then `service.instance.id`, `container.id`, `host.id`, `host.name`.

The platform's own task or instance identity comes first on purpose. A sidecar collector and the application's SDK both see it and it survives process restarts, whereas an SDK-minted `service.instance.id` is usually a random id per process (the Node SDK's default `serviceinstance` detector does exactly that); keying on it would split one ECS task into two rows the moment the `awsecscontainermetrics` receiver reports the task under its task id. `service.instance.id` is used when the platform sets no identity of its own. The **Instance identity** column below names the attribute a typical setup on that platform keys on.

## Supported platforms

| Platform                  | `cloud.platform`            | `cloud.*` filled in by | Instance identity                 | Guide                                                              |
| ------------------------- | --------------------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| AWS ECS / Fargate         | `aws_ecs`                   | resource detector      | `aws.ecs.task.arn`                | [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs)                 |
| AWS Elastic Beanstalk     | `aws_elastic_beanstalk`     | resource detector      | `host.id`                         | [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms)     |
| AWS App Runner            | `aws_app_runner`            | set by hand            | `host.name`                       | [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms)     |
| Google Cloud Run          | `gcp_cloud_run`             | resource detector      | `faas.instance`                   | [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run)            |
| Google App Engine         | `gcp_app_engine`            | resource detector      | `faas.instance`                   | [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms)     |
| Azure Container Apps      | `azure_container_apps`      | resource detector      | `azure.container_app.instance.id` | [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps) |
| Azure Container Instances | `azure_container_instances` | set by hand            | `host.name`                       | [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms)     |
| Azure App Service         | `azure_app_service`         | resource detector      | `host.id`                         | [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms)     |

"Resource detector" means an OpenTelemetry resource detector — in the SDK or in the Collector's `resourcedetection` processor — reads the platform's metadata and sets the `cloud.*` attributes for you. "Set by hand" means no upstream detector exists and you put them in `OTEL_RESOURCE_ATTRIBUTES`; the platform page shows the exact line. Two Azure notes. The Container Apps detectors know the platform and the replica but neither the region nor the subscription, and the App Service detectors know the platform, the region and the instance but not the subscription — type in whatever is missing. And the Node / .NET Azure detectors spell the platform with a dot (`azure.container_apps`, `azure.app_service`) — OneUptime rewrites those to the underscore values above on ingest.

## What is not a cloud environment

| You run on                                                                                        | Where it appears         | Why                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| EC2, Compute Engine, Azure VM (`aws_ec2`, `gcp_compute_engine`, `azure_vm`)                       | **Hosts**                | A virtual machine is a host. See [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) |
| EKS, GKE, AKS, self-managed Kubernetes                                                            | **Kubernetes**           | Routed by the `k8s.*` attributes. See [Kubernetes Agent](/docs/telemetry/kubernetes-agent)           |
| Lambda, Cloud Functions, Azure Functions (`aws_lambda`, `gcp_cloud_functions`, `azure_functions`) | **Serverless Functions** | Routed by `faas.name`. See [Serverless Functions](/docs/telemetry/serverless-functions)              |

Cloud Run and App Engine straddle the line on purpose: their detector sets both a managed `cloud.platform` and `faas.name`, so each service appears under **Serverless Functions** on its own while the **Cloud Environment** groups every service in that project and region.

## Step 1 — Get the attributes onto your telemetry

There are two shapes, and every platform page shows both:

**Shape A — the SDK exports straight to OneUptime.** Enable the platform's resource detector in the SDK (Node `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws` / `gcp` / `azure`; Python `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=aws_ecs` or `gcp_resource_detector`; Java `-Dotel.resource.providers.aws.enabled=true` / `gcp`; Go's contrib detectors; .NET's `OpenTelemetry.Resources.*` packages) and point its OTLP exporter at OneUptime. No extra container; no container CPU / memory.

**Shape B — a sidecar OpenTelemetry Collector.** A second container in the task / instance / replica. The application exports to `localhost:4318`; the collector's `resourcedetection` processor stamps `cloud.*` on everything passing through, it holds the token, and on ECS it also ships per-task CPU / memory:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # [env, gcp] on Cloud Run / App Engine; [env, azurecontainerapps] on Container Apps
    timeout: 5s
```

## Step 2 — Export OTLP to OneUptime

```yaml
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
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
```

`${env:ONEUPTIME_TOKEN}` is expanded by the collector from an environment variable that the platform injects from its secret store — Secrets Manager, Secret Manager, Container Apps secrets. Or, for Shape A, on the application itself:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

If you self-host OneUptime, use `https://YOUR-ONEUPTIME-HOST/otlp`.

## Step 3 — Verify

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project; `401` means it is unknown, revoked or mistyped. Within a minute of the first span, log or metric the environment appears at **Cloud → All Environments**.

## What you get

The environment overview shows:

- **Requests**, error rate and p95 latency, with trend charts, derived from your traces.
- **CPU** and **Memory** per running task / instance, plus a **Top instances by CPU** list — from `container.cpu.utilization` / `container.memory.usage` metrics (on ECS, the `awsecscontainermetrics` receiver's `ecs.task.cpu.utilized` / `ecs.task.memory.utilized`) that carry the instance identity.
- **Instances** — a live count of tasks, and a tab with one row each.
- Full **Logs**, **Traces** and **Metrics** tabs scoped to the environment.

An environment whose telemetry stops for 15 minutes shows **Disconnected** and recovers on the next signal. Per-service breakdown for the same workloads is under **Services**.

## Troubleshooting

See [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting): the environment does not appear, appears under Hosts or only under Serverless Functions, has no Instances or no CPU / memory, shows Disconnected, is duplicated, or a hand-created one never matches.
