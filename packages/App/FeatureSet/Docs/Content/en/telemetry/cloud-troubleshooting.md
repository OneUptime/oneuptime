# Cloud Troubleshooting

Work down this page in order. Each step rules out one layer, and the order is the one in which these actually fail. The platform pages — [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs), [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run), [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps), [Other Cloud Platforms](/docs/telemetry/cloud-other-platforms) — each end with the failures specific to that platform; this page covers the ones that are the same everywhere.

## 1. Is the token valid?

Check this first, because it is the cheapest check and it invalidates everything below it:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

- `200` with `"valid": true` — the token resolves to a project. Move on.
- `401` — the token is missing, malformed, unknown or revoked. Create a new one in _Project Settings → Telemetry & APM → Ingestion Keys_ and re-deploy.

If you self-host, use `https://YOUR-ONEUPTIME-HOST/otlp/v1/validate`. Run the same command from inside the task, instance or replica when you can (ECS Exec, `gcloud run` jobs, `az containerapp exec`) — it proves egress from where the exporter actually runs, not from your laptop.

## 2. The environment does not appear

Nothing under **Cloud → All Environments** a minute after the first request. One of three things, in this order:

**`cloud.platform` is missing, or is not a managed value.** OneUptime files telemetry under Cloud Environments only when the resource carries `cloud.platform` set to one of the managed values — `aws_ecs`, `aws_elastic_beanstalk`, `aws_app_runner`, `gcp_cloud_run`, `gcp_app_engine`, `azure_container_apps`, `azure_container_instances`, `azure_app_service`. Anything else (or nothing) is not a cloud environment. The usual causes: the resource detector is not enabled in the SDK (`OTEL_NODE_RESOURCE_DETECTORS`, `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS`, `-Dotel.resource.providers.<cloud>.enabled=true`), the collector pipeline skips the `resourcedetection` processor, or on the platforms with no detector the `OTEL_RESOURCE_ATTRIBUTES` value has a typo. (The Node and .NET Azure detectors spell the value `azure.container_apps` / `azure.app_service` / `azure.functions`; OneUptime rewrites those to the underscore forms on ingest, so they do count.) Look at any trace of the service under **Services → Traces** and open the resource attributes: if `cloud.platform` is not there, that is the whole problem.

**Wrong token.** Step 1 returned `401`. The collector logs it as `Permanent error: ... 401`; SDKs log it once and stop retrying, which is correct OTLP behaviour and easy to miss.

**Egress is blocked.** The collector logs `connection refused`, `context deadline exceeded`, `i/o timeout` or a DNS failure. On ECS / Fargate a private subnet needs a NAT gateway or `assignPublicIp=ENABLED`, and the security group must allow egress on TCP 443. On Cloud Run, **VPC egress: all traffic** needs Cloud NAT. On Container Apps, a user-defined route to a firewall must allow the OneUptime host. On every platform, a self-hosted OneUptime behind a private DNS name must be resolvable from the workload's network.

## 3. It appears under Hosts instead

The resource carries a **virtual-machine** platform — `aws_ec2`, `gcp_compute_engine`, `azure_vm` — so it is filed under **Hosts**, which is right for a VM and wrong for managed compute. This happens when a VM detector wins over the managed one: `detectors: [ec2, elastic_beanstalk]` in the collector (the first detector to set `cloud.platform` wins — put `elastic_beanstalk` first), or an SDK whose merge order favours the EC2 detector. Fix the order, or set `cloud.platform` explicitly in `OTEL_RESOURCE_ATTRIBUTES` and keep only the `env` detector.

## 4. It appears only under Serverless Functions

The resource carries `faas.name` but no managed `cloud.platform`. Cloud Run and App Engine set both when the GCP detector runs; if you set `faas.name` by hand, or the detector runs in the SDK but the collector strips resource attributes, only the Serverless side is satisfied. Add the detector (or `cloud.platform=gcp_cloud_run` / `gcp_app_engine`, `cloud.account.id` and `cloud.region` explicitly). Note that on those platforms the service is **meant** to appear under both — the environment groups the project and region, the function view shows the single service.

## 5. The environment is there but Instances is empty

The telemetry carries no instance identity. OneUptime names an instance from the first of these resource attributes it finds:

1. `aws.ecs.task.id`
2. `aws.ecs.task.arn` (shortened to the task id)
3. `faas.instance`
4. `azure.container_app.instance.id`
5. `service.instance.id`
6. `container.id`
7. `host.id`
8. `host.name`

The platform's own identity comes before `service.instance.id` so that an SDK-minted per-process id (the Node SDK sets one by default) cannot split a task away from the sidecar's CPU / memory points. None present means the environment aggregates fine but has no rows to list. Per platform: on ECS the `ecs` detector sets the task ARN; on Cloud Run and App Engine the `gcp` detector sets `faas.instance`; on Container Apps the Collector's `azurecontainerapps` detector sets `azure.container_app.instance.id` (or set `service.instance.id` from `CONTAINER_APP_REPLICA_NAME`, or run the host detector, whose `host.name` is the replica name); on App Runner and Container Instances run the host detector; on App Service and Beanstalk the platform detector sets `service.instance.id`. An instance row appears within a minute of the first signal that carries the attribute.

## 6. Instances are listed but CPU / memory are empty

The overview's **CPU** and **Memory** tiles and the Instances table's CPU % / memory columns are filled from metrics, not traces. They need `container.cpu.utilization` and `container.memory.usage` (or `container.memory.usage.total`) data points whose resource carries the **same instance identity** as the traces, plus `cloud.platform`. On ECS the `awsecscontainermetrics` receiver in a sidecar collector supplies them as `ecs.task.cpu.utilized` / `ecs.task.memory.utilized`; keep it in the `metrics` pipeline and keep `resourcedetection` in that pipeline too, or the metrics arrive without `cloud.platform` and are filed elsewhere. Cloud Run, Container Apps and the other PaaS platforms do not expose container stats to a sidecar; there, the tiles stay empty unless you ship those metric names yourself, and the Requests tiles are the ones to read.

The Shape A path — SDK straight to OneUptime — never ships container metrics, so empty CPU / memory tiles there are expected.

## 7. Status shows Disconnected

An environment goes **Disconnected** when no telemetry has arrived for it in **15 minutes**; the next span, log or metric flips it back to connected. Under continuous traffic the last-seen timestamp can legitimately lag by up to five minutes, so 15 minutes is the threshold that separates "quiet" from "gone". If a busy environment shows Disconnected, the exporter has stopped — check the collector logs for the `401` / egress errors from step 2. A staging environment that scales to zero overnight will show Disconnected until the morning's first request, which is accurate.

Instances have two clocks. The **Stale** label on the Instances tab, and the overview's live-instance count, use a fixed 15-minute wall-clock window: a task, instance or replica that has not reported in the last 15 minutes is shown as Stale. Separately, the sweeper hard-deletes instance rows not seen for `CLOUD_INSTANCE_STALE_MINUTES` (default 15, minimum 10), measured against the environment's own last telemetry so a collector outage freezes that clock instead of wiping the last-known task list; Serverless functions use `SERVERLESS_INSTANCE_STALE_MINUTES`. Raising the sweeper threshold keeps rows around longer; it does not change when the label flips to Stale.

## 8. Two environments where there should be one

The environment key is `cloud.platform|cloud.account.id|cloud.region` — three values, joined with `|`, matched character for character. If some workloads set `cloud.account.id` and others leave it empty, or one says `eastus` and another `East US`, or one collector runs the `ecs` detector and another does not, you get `aws_ecs|123456789012|us-east-1` and `aws_ecs||us-east-1` side by side. Open each environment's **Overview**: the Resource Identifier shows which segment differs. Fix the workload that is missing the value; the empty-segment environment stops receiving telemetry and can be archived.

## 9. A hand-created environment never matches

You can create an environment by hand under **Cloud → All Environments → Create**, but ingest matches on the **Resource Identifier alone**. It must equal `platform|account|region` exactly — `aws_ecs|123456789012|us-east-1` — with the same platform string, the same account id and the same region spelling the telemetry carries, and no spaces around the separators. Anything else, and ingest creates a second environment with the key it computed, leaving yours empty. The create form has no identifier field: it derives the key from the **Cloud Platform**, **Cloud Account ID** and **Cloud Region** fields, so those three must match the telemetry character for character. If they do not, archive the hand-made environment and let ingest create the right one, or create it again with the corrected values.

## 10. Still stuck

Collect these before asking for help:

- The `resource.attributes` list from one actual span or log record of the workload (the collector's `debug` exporter prints them, or open any trace under **Services → Traces**).
- The output of the `/otlp/v1/validate` call from inside the workload.
- The last 50 lines of the collector's log (or the SDK's diagnostic log with `OTEL_LOG_LEVEL=debug`).
- The Resource Identifier of any environment that did appear.

Then contact support@oneuptime.com, or open an issue on [GitHub](https://github.com/OneUptime/oneuptime).
