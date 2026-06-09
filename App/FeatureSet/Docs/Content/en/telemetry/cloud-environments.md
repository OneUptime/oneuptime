# Cloud Environments

## Overview

OneUptime groups managed cloud compute into **Cloud Environments** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner and Azure App Service. One environment is created per unique combination of `cloud.platform` + `cloud.account.id` + `cloud.region`, so something like *"AWS ECS · us-east-1 · 123456789012"* is a single entity that aggregates every workload running on it.

Raw virtual machines (EC2, Compute Engine, Azure VM) remain **Hosts**, and Kubernetes stays under **Kubernetes**. This view is specifically for managed / PaaS compute.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create one from *Project Settings → Telemetry Ingestion Keys*.
- An OpenTelemetry Collector or SDK running in/alongside your workloads.

## How OneUptime identifies an environment

| Attribute | Required | Purpose |
|---|---|---|
| `cloud.platform` | **yes** | Must be a managed-compute platform (e.g. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | no | Part of the environment key |
| `cloud.region` | no | Part of the environment key |
| `service.instance.id` | no | Tracked per task/instance under **Instances** (with live CPU / memory) |

These are normally filled in automatically by the OpenTelemetry **resource detectors**.

## Step 1 — Enable the cloud resource detector

In the OpenTelemetry Collector, add the `resourcedetection` processor:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

With an SDK, set `OTEL_RESOURCE_DETECTORS` instead:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Step 2 — Export OTLP to OneUptime

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

If you self-host OneUptime, use `https://YOUR-ONEUPTIME-HOST/otlp`.

## What you get

The environment overview shows:

- **CPU** and **Memory** per running task/instance (from `container.cpu.utilization` / `container.memory.usage`), plus a **Top instances by CPU** list.
- **Instances** — a live count of tasks.
- **Requests** and trend charts derived from your traces.
- Full **Logs**, **Traces**, **Metrics** and **Instances** tabs.

Per-service breakdown for the same workloads is available under **Services**.
