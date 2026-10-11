# Azure Container Apps

Send the traces, logs and metrics of your Azure Container Apps to OneUptime. Every replica that reports `cloud.platform=azure_container_apps` joins one **Cloud Environment** per Azure subscription and region, such as _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, with the running replicas listed under **Instances**.

:::cards
- [How it works](#how-it-works): What the detectors set, and the two attributes you set yourself.
- [Set it up](#set-it-up): Store the token, configure the app with the Azure CLI or the portal, and check.
- [Use the environment's managed OpenTelemetry agent](#use-the-environments-managed-opentelemetry-agent): Forward every app in the environment without a sidecar.
- [Troubleshooting](#troubleshooting): Refused exports, missing environments and empty instances.
:::

## How it works

```mermaid title="Where the attributes of a Container Apps replica come from"
flowchart TB
    subgraph replica["Container Apps replica"]
        direction LR
        app["Your app"] -->|"OTLP to<br/>localhost:4318"| col["otel-collector<br/>(optional)"]
    end
    detector["Azure detector:<br/>platform, replica"] --> col
    manual["OTEL_RESOURCE_ATTRIBUTES:<br/>region, subscription"] --> col
    col -->|"OTLP over HTTPS"| ou["OneUptime"]
    ou --> env["Cloud Environment<br/>subscription and region"]
```

Container Apps has resource detectors: the Collector's `azurecontainerapps` detector, and the Node.js (`@opentelemetry/resource-detector-azure`) and .NET (`OpenTelemetry.Resources.Azure`) ones. They read `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME`, and set `cloud.provider`, `cloud.platform`, `service.name` and the replica ID. **None of them knows the region or the subscription**, so you set `cloud.region` and `cloud.account.id` yourself, in `OTEL_RESOURCE_ATTRIBUTES`.

| Attribute                         | Value                                                                     | Used for                                                     |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider`                  | `azure`                                                                   | Shown on the overview                                        |
| `cloud.platform`                  | `azure_container_apps`                                                    | Files the telemetry under **Cloud Environments**             |
| `cloud.region`                    | the environment's region, such as `eastus`: set by you                    | Part of the environment key                                  |
| `cloud.account.id`                | the subscription ID: set by you                                           | Part of the environment key                                  |
| `azure.container_app.instance.id` | the replica name, set by the detectors from `CONTAINER_APP_REPLICA_NAME` | Names one running replica: one row each under **Instances** |
| `service.instance.id`             | the replica name, if you set it yourself                                  | Used when no detector set the replica ID                     |

- **Dotted spellings work.** The Node.js and .NET detectors spell the platform `azure.container_apps`, with a dot. OneUptime rewrites it to `azure_container_apps` when it receives it, so both spellings land in the same environment.
- **The hostname is the replica name.** An SDK that runs only the `host` detector reports `host.name` as the replica name, and OneUptime names the instance by it when nothing more specific is there.

The environment key is `azure_container_apps|<subscription id>|eastus`.

## Before you begin

- **An ingestion key.** Create a **Server** key under **Project Settings → Telemetry & APM → Ingestion Keys** and copy its token.
- **The Azure CLI with the `containerapp` extension** (`az extension add --name containerapp --upgrade`), signed in to the subscription, or the Azure portal.
- **Your application instrumented with an OpenTelemetry SDK** that exports OTLP.

## Choose how telemetry leaves the app

|                    | SDK direct                                  | Sidecar collector                                            |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Extra container    | None                                        | `otel-collector` in the app, sharing the replica's CPU and memory |
| Sets the attributes | The SDK and `OTEL_RESOURCE_ATTRIBUTES` on the app | The collector, for everything that passes through            |
| The secret         | `oneuptime-otlp-headers`, the whole header  | `oneuptime-token`, the bare token                            |

A third way, the environment's managed OpenTelemetry agent, forwards every app in the environment without a sidecar: see [Use the environment's managed OpenTelemetry agent](#use-the-environments-managed-opentelemetry-agent). Each step below has a tab for SDK direct and the sidecar collector; pick one and every step follows it.

## Set it up

:::steps
### Store the token as a Container Apps secret

> [!IMPORTANT]
> The token is a secret. Store it as a Container Apps secret and reference it from environment variables with `secretref:`. Once set, a secret is not shown in `az containerapp show` or in the portal; a plain environment variable is.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

The SDK's `OTEL_EXPORTER_OTLP_HEADERS` wants the whole `name=value` header, so the secret holds it.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

The collector adds the header name itself, so the secret holds just the token.
:::

In the portal: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Type the key, pick the type **Container Apps secret**, paste the value and click **Add**.

If you keep secrets in **Key Vault**, reference the secret instead of copying its value. The app's managed identity needs the **Key Vault Secrets User** role on the vault:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Configure the container app

:::tabs
@tab SDK direct
Set the exporter, and the attributes no detector knows, on the application container. Replace the region and the subscription ID with your own:

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

For the replica's identity, turn on the SDK's Azure detector: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` in Node.js, or `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` with `OpenTelemetry.Resources.Azure` in .NET. It sets `azure.container_app.instance.id` from `CONTAINER_APP_REPLICA_NAME`.

Container Apps cannot put one environment variable inside another, so in other languages `service.instance.id` cannot go into `OTEL_RESOURCE_ATTRIBUTES`. Turn on the host detector (its `host.name` is the replica name), or set it in code:

```js title="tracing.js"
// Node.js: the file you load with --require before the app starts
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.instance.id": process.env.CONTAINER_APP_REPLICA_NAME,
  }),
});
sdk.start();
```

```python title="tracing.py"
# Python: before the tracer provider is created
import os
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.instance.id": os.environ.get("CONTAINER_APP_REPLICA_NAME", "")})
```

Whichever detector you use, keep `cloud.region` and `cloud.account.id` in `OTEL_RESOURCE_ATTRIBUTES`: no Container Apps detector sets them, and the environment key needs them.

In the portal instead: **Application → Containers → Edit and deploy**, select your container on the **Container** tab and click **Edit**. Under **Environment variables**, add each variable above with the source **Manual entry**, and `OTEL_EXPORTER_OTLP_HEADERS` with the source **Reference a secret**, pointing at `oneuptime-otlp-headers`.
@tab Sidecar collector
A sidecar runs in the same replica, so it sees the same `CONTAINER_APP_NAME` and `CONTAINER_APP_REPLICA_NAME`. Its `azurecontainerapps` detector turns them into `cloud.provider`, `cloud.platform`, `service.name` and `azure.container_app.instance.id`, and its `env` detector reads `cloud.region` and `cloud.account.id` from `OTEL_RESOURCE_ATTRIBUTES` in the collector's own environment. The application only exports to `http://localhost:4318`.

Export the app's definition, add the collector to `template.containers`, and apply it:

```bash
az containerapp show --name checkout-api --resource-group my-rg -o yaml > checkout-api.yaml
# edit checkout-api.yaml as below
az containerapp update --name checkout-api --resource-group my-rg --yaml checkout-api.yaml
```

```yaml title="checkout-api.yaml"
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

`az containerapp show` does not export secret values, so add the `secrets` entry back by hand, or leave it out if you set the secret in the first step: an update keeps existing secrets. Container Apps adds up the CPU and memory of every container in a replica, so the sidecar's `resources` count against the app's.

In the portal instead: on the **Container** tab, **+ Add** a container named `otel-collector` with the image `otel/opentelemetry-collector-contrib:latest` and the **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`. Add the environment variables `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` and `OTEL_COLLECTOR_CONFIG` (**Manual entry**, with the values above).
:::

If you host OneUptime yourself, use `https://YOUR-ONEUPTIME-HOST/otlp` as the endpoint.

### Deploy the new revision

`az containerapp update` deploys a new revision on its own. In the portal, click **Create**. If several revisions are active, move traffic to the new one under **Revisions and replicas**.

### Check the connection

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token is accepted. `401` means it is unknown, revoked, disabled or expired. Then read the collector's output:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Look for `Everything is ready`, and no `401` or `connection refused`. Within a minute of the first span, log or metric, the environment appears under **Cloud → All Environments** as _Azure Container Apps · eastus · <subscription id>_.
:::

## Use the environment's managed OpenTelemetry agent

A Container Apps **environment** can run Azure's managed OpenTelemetry agent. It receives OTLP from every app in the environment and forwards it to an endpoint you configure, with no sidecar in each app. The agent exports over **OTLP/gRPC only**, so it cannot use the `/otlp` HTTP path. Point it at the OneUptime host on port 443 instead, where OneUptime serves OTLP/gRPC over TLS:

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

- **Self-hosted:** use `YOUR-ONEUPTIME-HOST:443`. A self-hosted OneUptime takes OTLP/gRPC only over TLS: see [OTLP over gRPC](/docs/telemetry/open-telemetry#otlp-over-grpc).
- **The apps still set the attributes.** The agent puts its own `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` into every app, so leave those two out of the app and keep `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`. The agent forwards what the apps send, so `cloud.*` and the replica ID still come from each app.
- **Your `OTEL_RESOURCE_ATTRIBUTES` wins.** The agent sets `OTEL_RESOURCE_ATTRIBUTES` too, and a value set on the app replaces it: include the Container App name and the replica ID in yours, or set them in code.

## Networking

- **Outbound traffic is open by default.** A replica reaches `oneuptime.com:443` without any configuration, whether the environment's ingress is external or internal.
- **Custom VNets are the exception.** On a VNet with a user-defined route that sends `0.0.0.0/0` to a firewall or NAT gateway, or with a network security group on the subnet, allow TCP 443 to the OneUptime host (or your own host's port) on the firewall or NSG.
- **A self-hosted OneUptime inside the VNet** must be resolvable and routable from the environment's subnet.
- **No Azure role is needed for telemetry.** Only Key Vault references need the app's managed identity to hold **Key Vault Secrets User** on the vault.

## What you get

- **Overview**: requests, error rate and p95 latency from your traces. Container Apps does not show a replica's resource usage to a sidecar, so the **CPU** and **Memory** tiles fill only if you send `container.cpu.utilization` and `container.memory.usage` metrics carrying the replica's identity. Most teams leave those to Azure Monitor.
- **Instances**: one row per replica, named by the detectors' `azure.container_app.instance.id`, by `service.instance.id` when you set it yourself, or by `host.name` when only the host detector ran.
- **Logs**, **Traces** and **Metrics**, filtered to the environment, and the per-service view under **Services**.

## Troubleshooting

:::details Nothing appears, and the collector logs 401
The secret holds the wrong value. `oneuptime-token` must be the bare token; `oneuptime-otlp-headers` the whole header `x-oneuptime-token=...`.
:::

:::details The app is under Services, but no environment exists
`OTEL_RESOURCE_ATTRIBUTES` is missing, or `cloud.platform` is not exactly `azure_container_apps`. See what the app has with `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details The environment exists, but Instances is empty
None of `service.instance.id`, `azure.container_app.instance.id` or `host.name` is on the resource. Add the `azurecontainerapps` detector to the collector, turn on the SDK's Azure or host detector, or set `service.instance.id` in code.
:::

:::details Two environments for one subscription
One app sets `cloud.region` (or `cloud.account.id`) and another does not, or one writes the region differently (`eastus` and `East US`). The values must match character for character.
:::

Everything else is on [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting).

## Next steps

:::cards
- [Cloud Environments](/docs/telemetry/cloud-environments): How environments and instances are identified.
- [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms): Azure App Service and Azure Container Instances.
- [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting): The failures every platform shares.
- [Cloud Resources (IaaS & PaaS)](/docs/telemetry/cloud-resources): Every resource in your subscription, from Azure Monitor.
:::
