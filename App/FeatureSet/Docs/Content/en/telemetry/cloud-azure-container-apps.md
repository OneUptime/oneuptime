# Azure Container Apps

## Overview

OneUptime groups every Container Apps replica that reports `cloud.platform=azure_container_apps` into one **Cloud Environment** per Azure subscription and region — _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_ — and lists the running replicas under its **Instances** tab.

Container Apps has resource detectors — the Collector's `azurecontainerapps` detector, and the Node (`@opentelemetry/resource-detector-azure`) and .NET (`OpenTelemetry.Resources.Azure`) ones — but they know less than the ECS or GCP detectors do. They read `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME` and set `cloud.provider`, `cloud.platform`, `service.name` and the replica id; **none of them knows the region or the subscription**, so `cloud.region` and `cloud.account.id` are still set by hand. This page shows where the values go — as environment variables through the CLI or the portal, or in a sidecar collector that stamps them on everything.

| Attribute                         | Value                                                                    | Used for                                                           |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `cloud.provider`                  | `azure`                                                                  | Shown on the overview                                              |
| `cloud.platform`                  | `azure_container_apps`                                                   | Routes the telemetry to **Cloud Environments**                     |
| `cloud.region`                    | the environment's region, e.g. `eastus` — **by hand**                    | Part of the environment key                                        |
| `cloud.account.id`                | the subscription id — **by hand**                                        | Part of the environment key                                        |
| `azure.container_app.instance.id` | the replica name, set by the detectors from `CONTAINER_APP_REPLICA_NAME` | Identity of one running replica — one row each under **Instances** |
| `service.instance.id`             | the replica name, if you set it yourself                                 | Used when no detector supplied the replica id                      |

The Node and .NET detectors spell the platform `azure.container_apps` (with a dot); OneUptime rewrites that to `azure_container_apps` on ingest, so both spellings land in the same environment. Container Apps also sets the container's hostname to the replica name, so an SDK that runs only the `host` detector reports `host.name` = replica name and OneUptime uses that as the instance identity when nothing more specific is present.

The environment key is `azure_container_apps|<subscription id>|eastus`.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create a **Server** key from _Project Settings → Telemetry & APM → Ingestion Keys_.
- The Azure CLI with the `containerapp` extension (`az extension add --name containerapp --upgrade`), logged in to the subscription.
- Your application instrumented with an OpenTelemetry SDK that exports OTLP.

## Step 1 — Store the token as a Container Apps secret

> **This token is a secret.** Store it as a Container App secret and reference it from environment variables with `secretref:`. Secrets are not shown in `az containerapp show` output or in the portal once set; a plain environment variable is.

```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN \
            oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Two secrets because the two shapes below need different values: the SDK's `OTEL_EXPORTER_OTLP_HEADERS` wants the whole `name=value` header, the collector wants just the token. Keep the one you use.

If you keep secrets in **Key Vault**, reference them instead of copying the value — the app's managed identity needs the **Key Vault Secrets User** role on the vault:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

## Step 2 — Shape A: the SDK exports straight to OneUptime

Set the exporter and the explicit resource attributes on the application container. Replace the region and subscription id with your own:

```bash
az containerapp update \
  --name checkout-api \
  --resource-group my-rg \
  --set-env-vars \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000"
```

If you self-host OneUptime, replace the endpoint with `https://YOUR-ONEUPTIME-HOST/otlp`.

For the replica identity, enable the SDK's Azure detector — `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` on Node, `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` with `OpenTelemetry.Resources.Azure` on .NET — which sets `azure.container_app.instance.id` from `CONTAINER_APP_REPLICA_NAME`. Container Apps cannot expand one environment variable inside another, so on other languages `service.instance.id` cannot be written into `OTEL_RESOURCE_ATTRIBUTES`; either enable the host detector (`host.name` is the replica name) or set it in code:

```js
// Node.js — in the file you load with --require before the app starts
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.instance.id": process.env.CONTAINER_APP_REPLICA_NAME,
  }),
});
sdk.start();
```

```python
# Python — before the tracer provider is created
import os
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.instance.id": os.environ.get("CONTAINER_APP_REPLICA_NAME", "")})
```

Whichever detector you use, keep `cloud.region` and `cloud.account.id` in `OTEL_RESOURCE_ATTRIBUTES` — no Container Apps detector sets them, and the environment key needs them.

## Step 3 — Shape B: a sidecar collector

A sidecar runs in the same replica, so it sees the same `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME`. The `resourcedetection` processor's `azurecontainerapps` detector turns those into `cloud.provider`, `cloud.platform`, `service.name` and `azure.container_app.instance.id`, and its `env` detector reads `cloud.region` / `cloud.account.id` from `OTEL_RESOURCE_ATTRIBUTES` in the collector's own environment. The application only exports to `http://localhost:4318`; the collector stamps `cloud.*` and the replica id on everything and holds the token.

Export the app's current definition, edit the `template.containers` list, and apply it:

```bash
az containerapp show --name checkout-api --resource-group my-rg -o yaml > checkout-api.yaml
# edit checkout-api.yaml as below
az containerapp update --name checkout-api --resource-group my-rg --yaml checkout-api.yaml
```

The relevant part of `checkout-api.yaml`:

```yaml
properties:
  configuration:
    secrets:
      - name: oneuptime-token
        value: YOUR_TELEMETRY_INGESTION_TOKEN
  template:
    containers:
      - name: app
        image: myregistry.azurecr.io/checkout-api:1.4.2
        env:
          - name: OTEL_SERVICE_NAME
            value: checkout-api
          - name: OTEL_EXPORTER_OTLP_ENDPOINT
            value: http://localhost:4318
          - name: OTEL_EXPORTER_OTLP_PROTOCOL
            value: http/protobuf
        resources:
          cpu: 0.5
          memory: 1Gi
      - name: otel-collector
        image: otel/opentelemetry-collector-contrib:latest
        args:
          - --config=env:OTEL_COLLECTOR_CONFIG
        env:
          - name: ONEUPTIME_TOKEN
            secretRef: oneuptime-token
          # Read by the resourcedetection processor's env detector.
          - name: OTEL_RESOURCE_ATTRIBUTES
            value: cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000
          - name: OTEL_COLLECTOR_CONFIG
            value: |
              receivers:
                otlp:
                  protocols:
                    http:
                      endpoint: 0.0.0.0:4318
                    grpc:
                      endpoint: 0.0.0.0:4317
              processors:
                # env: cloud.region + cloud.account.id from OTEL_RESOURCE_ATTRIBUTES.
                # azurecontainerapps: cloud.provider, cloud.platform, service.name
                # and azure.container_app.instance.id from the CONTAINER_APP_*
                # variables. override: false keeps the service.name the
                # application set instead of the Container App's name.
                resourcedetection:
                  detectors: [env, azurecontainerapps]
                  timeout: 2s
                  override: false
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
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
                  logs:
                    receivers: [otlp]
                    processors: [resourcedetection, batch]
                    exporters: [otlphttp/oneuptime]
        resources:
          cpu: 0.25
          memory: 0.5Gi
```

`az containerapp show` does not export secret values, so the `secrets` entry above has to be added back by hand (or left out, if you already set the secret in Step 1 — an update keeps existing secrets). Container Apps sums the CPU and memory of all containers in a replica, so the sidecar's `resources` count against the app's allocation.

## Step 4 — Or do it in the portal

1. **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Key `oneuptime-token`, type **Container Apps secret**, paste the token. **Add**.
2. **Application → Containers → Edit and deploy**. On the **Container** tab select the application container → **Edit**.
3. Under **Environment variables**, add `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL` and `OTEL_RESOURCE_ATTRIBUTES` with source **Manual entry**. For Shape A add `OTEL_EXPORTER_OTLP_HEADERS` with source **Reference a secret** pointing at `oneuptime-otlp-headers`. **Save**.
4. Shape B: still on the **Container** tab, **+ Add** a container. Name `otel-collector`, image `otel/opentelemetry-collector-contrib:latest`, **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`; environment variables `ONEUPTIME_TOKEN` (**Reference a secret** → `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_COLLECTOR_CONFIG` (**Manual entry**, paste the YAML from Step 3). **Save**.
5. **Create** — this deploys a new revision. With multiple revisions active, shift traffic to the new one under **Revisions and replicas**.

## Alternative — the managed OpenTelemetry agent

A Container Apps **environment** can run Azure's managed OpenTelemetry agent (preview), which receives OTLP from every app in the environment and forwards it to an endpoint you configure — no sidecar per app. The agent exports over **OTLP/gRPC only**, so it cannot use the `/otlp` HTTP path; point it at the OneUptime host on port 443 instead, where OneUptime serves OTLP/gRPC over TLS on the same hostname:

```bash
az containerapp env telemetry otlp add \
  --name my-aca-env \
  --resource-group my-rg \
  --otlp-name oneuptime \
  --endpoint oneuptime.com:443 \
  --insecure false \
  --headers "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true \
  --enable-open-telemetry-metrics true
```

If you self-host, use `YOUR-ONEUPTIME-HOST:443` — the bundled Nginx terminates TLS with HTTP/2 and proxies the gRPC service to ingest, so nothing else needs to be opened. The agent injects `OTEL_EXPORTER_OTLP_ENDPOINT` (its own gRPC address) and `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` into every app, so drop the endpoint and protocol variables from Step 2 and keep only `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`: the agent forwards what the apps send it, and the `cloud.*` attributes and the replica id still have to come from each app. Note that the agent also sets `OTEL_RESOURCE_ATTRIBUTES` itself; a value you set on the app overrides it, so include the Container App name and the replica id in yours or set them in code.

## Step 5 — Networking

Outbound traffic from a Container Apps environment is **open by default** — a replica reaches `oneuptime.com:443` without any configuration, whether the environment has external or internal ingress.

The exceptions are environments on a custom VNet with a **user-defined route** that sends `0.0.0.0/0` to a firewall or NAT gateway, or with a network security group on the subnet. There, allow TCP **443** to the OneUptime host (or the port your self-hosted instance listens on) on the firewall / NSG. If you self-host OneUptime inside the VNet, make sure the environment's subnet can resolve and route to it.

No Azure role assignment is needed for telemetry itself. Key Vault references need the app's managed identity to hold **Key Vault Secrets User** on the vault.

## Step 6 — Verify

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project; `401` means it is unknown, revoked or mistyped. Then read the collector's output:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Look for `Everything is ready` and the absence of `401` / `connection refused`. Within a minute of the first span, log or metric the environment appears at **Cloud → All Environments** as _Azure Container Apps · eastus · <subscription id>_.

## What you get

- **Overview** — request volume, error rate and p95 latency derived from traces. The **CPU** and **Memory** tiles fill only if you ship `container.cpu.utilization` / `container.memory.usage` metrics that carry the replica's identity — Container Apps does not expose replica cgroup stats to a sidecar, so most teams leave those to Azure Monitor.
- **Instances** — one row per replica, keyed by the detector's `azure.container_app.instance.id`, by `service.instance.id` when no detector ran and you set it yourself, or by `host.name` when only the host detector ran.
- **Logs**, **Traces** and **Metrics** tabs scoped to the environment, and the per-service breakdown under **Services**.

## Troubleshooting

- **Nothing appears, collector logs `401`** — the secret holds the wrong value. `oneuptime-token` must be the bare token; `oneuptime-otlp-headers` the whole `x-oneuptime-token=...` header.
- **The app is under Services but no environment exists** — `OTEL_RESOURCE_ATTRIBUTES` is missing or `cloud.platform` is not exactly `azure_container_apps`. Check with `az containerapp show ... --query properties.template.containers[].env`.
- **Environment exists, Instances is empty** — none of `service.instance.id`, `azure.container_app.instance.id` or `host.name` is on the resource. Add the `azurecontainerapps` detector (Step 3), enable the SDK's Azure or host detector, or set `service.instance.id` in code.
- **Two environments for one subscription** — one app sets `cloud.region` (or `cloud.account.id`) and another does not, or spells the region differently (`eastus` vs `East US`). The values must match character for character.

Everything else is on the shared [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting) page.
