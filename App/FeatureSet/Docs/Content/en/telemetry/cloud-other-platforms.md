# Other Cloud Platforms

## Overview

The three big container platforms have their own pages — [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs), [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run) and [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps). This page covers the rest of the managed compute OneUptime files under **Cloud Environments**: AWS Elastic Beanstalk, AWS App Runner, Google App Engine, Azure App Service and Azure Container Instances.

The rule is the same everywhere. Telemetry that carries a managed `cloud.platform` value plus `cloud.account.id` and `cloud.region` lands in one environment per platform + account + region; an instance identity attribute gives you one row per running instance under **Instances**. What differs per platform is whether an OpenTelemetry resource detector fills those attributes in for you, and where in the console the exporter settings go.

| Platform                  | `cloud.platform`            | `cloud.*` filled in by                                                                 | Instance identity                                           |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| AWS Elastic Beanstalk     | `aws_elastic_beanstalk`     | Collector `elastic_beanstalk` + `ec2` detectors; Node `aws`                            | `host.id` (drop the deployment-level `service.instance.id`) |
| AWS App Runner            | `aws_app_runner`            | By hand (no detector)                                                                  | `host.name`                                                 |
| Google App Engine         | `gcp_app_engine`            | The `gcp` detector (Collector and every SDK)                                           | `faas.instance`                                             |
| Azure App Service         | `azure_app_service`         | Collector `azureappservice`; Node / .NET `azure` detectors; `cloud.account.id` by hand | `service.instance.id`, then `host.id`                       |
| Azure Container Instances | `azure_container_instances` | By hand (no detector)                                                                  | `host.name`                                                 |

Every section below assumes the two things you always need: a **Server** ingestion token from _Project Settings → Telemetry & APM → Ingestion Keys_, and an application instrumented with an OpenTelemetry SDK. Replace `https://oneuptime.com/otlp` with `https://YOUR-ONEUPTIME-HOST/otlp` if you self-host.

> **The token is a secret on every one of these platforms.** Each section names the platform's secret store. A token typed into a plain environment variable is readable by everyone with read access to the app's configuration.

## AWS Elastic Beanstalk

`cloud.platform`: `aws_elastic_beanstalk`. The Beanstalk detector reads `/var/elasticbeanstalk/xray/environment.conf` on the instance and sets `cloud.platform`, `service.instance.id`, `service.version` and the environment name; it does **not** know the account or region, so pair it with the EC2 detector, which does. Its `service.instance.id` is the **deployment** id — shared by every instance of a deployment — so left in place it collapses all of them into one row under **Instances**; delete it with a `resource` processor (`action: delete`) and the EC2 detector's `host.id` (the instance id) becomes the identity. In the Collector the first detector to set an attribute wins, so keep `elastic_beanstalk` ahead of `ec2`:

```yaml
processors:
  resourcedetection:
    detectors: [env, elastic_beanstalk, ec2]
    timeout: 5s
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}
```

Run the collector on the instance with a `.platform/hooks/postdeploy/` script (or `.ebextensions`) that installs the `otelcol-contrib` package and writes this file; the token comes from an environment property or from Secrets Manager via the instance profile. Node applications can skip the collector and use the SDK's detector — `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws` includes the Beanstalk and EC2 detectors — then check the resource attributes in a trace: if `cloud.platform` comes out as `aws_ec2`, the merge order in your SDK version favoured the EC2 detector and the collector path is the reliable one.

Console steps:

1. **AWS Console → Elastic Beanstalk → Environments → your environment → Configuration**.
2. In the **Updates, monitoring, and logging** category click **Edit** and scroll to **Environment properties**.
3. Add `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` (`http://localhost:4318` with a collector on the instance, `https://oneuptime.com/otlp` without) and, without a collector, `OTEL_EXPORTER_OTLP_HEADERS` = `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN` and `OTEL_NODE_RESOURCE_DETECTORS` = `env,host,os,aws`. Environment properties are stored in the environment's configuration, not in a secret store — for the token, prefer reading Secrets Manager from the hook script with the instance profile (it needs `secretsmanager:GetSecretValue`).
4. **Apply**. Beanstalk restarts the application with the new properties.

Networking: instances in a private subnet need a NAT gateway; the instance security group must allow egress on TCP 443 to the OneUptime host.

## AWS App Runner

`cloud.platform`: `aws_app_runner`. No detector exists, so set the attributes by hand. App Runner can inject a Secrets Manager (or SSM Parameter Store) secret into an environment variable, and the **instance role** needs `secretsmanager:GetSecretValue` on it.

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# Secret: store the whole header as the secret value.
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
OTEL_RESOURCE_ATTRIBUTES=cloud.provider=aws,cloud.platform=aws_app_runner,cloud.region=us-east-1,cloud.account.id=123456789012
OTEL_NODE_RESOURCE_DETECTORS=env,host,os
```

The `host` detector supplies `host.name` — the container's hostname, unique per App Runner instance — which OneUptime uses as the instance identity.

Console steps:

1. **AWS Console → App Runner → Services → your service → Configuration → Configure service** (in the **Configuration** tab click **Edit**).
2. Under **Environment variables** click **Add environment variable** for each plain value above.
3. For the token, add `OTEL_EXPORTER_OTLP_HEADERS` with **Source: Secrets Manager** and the secret ARN, then under **Security → Instance role** pick a role that can read it.
4. **Save changes**. App Runner deploys a new version.

Networking: a service without a VPC connector reaches the internet directly. With **Outgoing network traffic: Custom VPC**, egress goes through your VPC and needs a NAT gateway plus a security group egress rule on TCP 443 to the OneUptime host.

## Google App Engine

`cloud.platform`: `gcp_app_engine`. The GCP detector recognises App Engine standard and flexible from `GAE_SERVICE` / `GAE_VERSION` / `GAE_INSTANCE` and the metadata server, and sets `cloud.account.id` (the project), `cloud.region`, `faas.name`, `faas.version` and `faas.instance`. As on Cloud Run, the `faas.name` means each App Engine service also appears under **Serverless Functions**; the environment groups the project and region.

| Language | Enable the GCP detector                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Node.js  | `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp`                                                                     |
| Python   | `pip install opentelemetry-resourcedetector-gcp` then `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector` |
| Java     | `-Dotel.resource.providers.gcp.enabled=true`                                                                       |
| Go       | `go.opentelemetry.io/contrib/detectors/gcp` → `gcp.NewDetector()`                                                  |
| .NET     | `OpenTelemetry.Resources.Gcp` → `.AddGcpDetector()`                                                                |

App Engine has no console editor for environment variables: they live in `app.yaml`.

```yaml
runtime: nodejs22
env_variables:
  OTEL_SERVICE_NAME: checkout-api
  OTEL_EXPORTER_OTLP_ENDPOINT: https://oneuptime.com/otlp
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_NODE_RESOURCE_DETECTORS: env,host,os,gcp
  # Do not commit the real value. Template it in CI, or read the secret at
  # start-up with the Secret Manager client instead.
  OTEL_EXPORTER_OTLP_HEADERS: x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Steps:

1. Store the token in **Secret Manager** (`gcloud secrets create oneuptime-ingestion-token --data-file=-`) and grant the App Engine service account `roles/secretmanager.secretAccessor`.
2. Either substitute the value into `app.yaml` in your deploy pipeline (keep the committed file with a placeholder), or read `projects/PROJECT_ID/secrets/oneuptime-ingestion-token/versions/latest` at start-up and pass it to the exporter's `headers` option in code.
3. `gcloud app deploy`. In the console, **App Engine → Versions** shows the new version; **App Engine → Services** shows the service that will appear under Serverless Functions.

Networking: App Engine standard reaches the internet directly. Flexible environment instances live in a VPC and need a route to the internet (Cloud NAT) if the subnet has no external IPs; firewall egress on TCP 443 to the OneUptime host.

## Azure App Service

`cloud.platform`: `azure_app_service`. The Node and .NET Azure detectors (and the Collector's `azureappservice` detector) read the `WEBSITE_*` variables App Service sets and fill in `cloud.platform`, `cloud.region`, `service.instance.id` (`WEBSITE_INSTANCE_ID`), `deployment.environment` (the slot) and `host.id`. The SDK detectors spell the platform `azure.app_service` (with a dot); OneUptime rewrites it to `azure_app_service` on ingest. None of them sets `cloud.account.id`, so add the subscription id by hand or the environment key will have an empty account segment.

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=00000000-0000-0000-0000-000000000000
# Node.js:
OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure
```

.NET: add `OpenTelemetry.Resources.Azure` and call `.ConfigureResource(r => r.AddAzureAppServiceDetector())`. Other languages set `cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>` in `OTEL_RESOURCE_ATTRIBUTES` and take `service.instance.id` from `WEBSITE_INSTANCE_ID` in code.

Console steps:

1. **Azure portal → App Services → your app → Settings → Environment variables** (called **Configuration → Application settings** on older portals).
2. **+ Add** each variable above. For the token use a **Key Vault reference** as the value — `@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/oneuptime-otlp-headers/)` — after enabling the app's **system-assigned managed identity** (**Settings → Identity**) and granting it **Key Vault Secrets User** on the vault. Store the secret as the whole `x-oneuptime-token=...` header.
3. **Apply**, then **Confirm** — the app restarts with the new settings. Deployment slots have their own settings; mark the token as a **deployment slot setting** if only one slot should send telemetry.

Networking: App Service reaches the internet directly unless **VNet integration** with **Route All** is on, in which case the VNet needs a NAT gateway or a route to a firewall that allows TCP 443 to the OneUptime host.

## Azure Container Instances

`cloud.platform`: `azure_container_instances`. No detector exists; set the attributes by hand. A container group's environment variables are fixed at creation, so changing them means recreating the group — use `--secure-environment-variables` for the token so it is not returned by `az container show`:

```bash
az container create \
  --resource-group my-rg \
  --name checkout-api \
  --image myregistry.azurecr.io/checkout-api:1.4.2 \
  --location eastus \
  --environment-variables \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_instances,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000" \
    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \
  --secure-environment-variables \
    "OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

The `host` detector's `host.name` (the container group's hostname) is the instance identity. A sidecar collector works here too — a container group is a multi-container unit like an ECS task — with the same `detectors: [env]` plus `OTEL_RESOURCE_ATTRIBUTES` pattern as [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps).

Console steps:

1. **Azure portal → Container Instances → + Create**. Fill in the **Basics** tab (resource group, name, region, image).
2. On the **Advanced** tab, under **Environment variables**, add each variable. For `OTEL_EXPORTER_OTLP_HEADERS` set **Mark as secure: Yes** so the value is hidden from the portal and the API afterwards.
3. **Review + create → Create**. To change a variable later, delete and recreate the group with the new values.

Networking: a container group with a public IP reaches the internet directly. One deployed into a VNet subnet has outbound access only through the VNet's route — add a NAT gateway or allow TCP 443 to the OneUptime host on the firewall / NSG.

## Verify

Whichever platform, check the token first, then look for the environment:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project; `401` means it is unknown, revoked or mistyped. Within a minute of the first span, log or metric the environment appears at **Cloud → All Environments**, named after the platform, region and account.

## Troubleshooting

See the shared [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting) page — in particular _appears under Hosts_ (a VM detector won the `cloud.platform` race), _appears only under Serverless_ (App Engine without the GCP detector) and _duplicate environments_ (`cloud.account.id` set on some deployments and not others).
