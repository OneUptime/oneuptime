# Google Cloud Run

## Overview

OneUptime groups every Cloud Run service and job that reports `cloud.platform=gcp_cloud_run` into one **Cloud Environment** per Google Cloud project and region — _GCP Cloud Run · us-central1 · my-project_ — and lists the running instances under its **Instances** tab.

The OpenTelemetry **GCP resource detector** does the identification. On Cloud Run it reads the metadata server and the `K_SERVICE` / `K_REVISION` environment variables and sets:

| Attribute          | Value on Cloud Run             | Used for                                                                                 |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `cloud.platform`   | `gcp_cloud_run`                | Routes the telemetry to **Cloud Environments**                                           |
| `cloud.account.id` | the project id                 | Part of the environment key                                                              |
| `cloud.region`     | `us-central1`                  | Part of the environment key                                                              |
| `faas.name`        | the service name (`K_SERVICE`) | Also registers the service under **Serverless Functions**                                |
| `faas.version`     | the revision (`K_REVISION`)    | Shown on the service's **Serverless Function** overview; the environment does not use it |
| `faas.instance`    | the instance id                | Identity of one running instance — one row each under **Instances**                      |

> **Cloud Run shows up in two places, on purpose.** Because the detector sets `faas.name`, each service is also a **Serverless Function** with its own invocation, error-rate and duration view. The **Cloud Environment** is the roll-up of every service in that project and region. Nothing is duplicated — the same telemetry is filed under both lenses.

The environment key is `gcp_cloud_run|my-project|us-central1`.

## Prerequisites

- A **OneUptime Telemetry Ingestion Token** — create a **Server** key from _Project Settings → Telemetry & APM → Ingestion Keys_.
- `gcloud` authenticated against the project, with the **Secret Manager API** enabled (`gcloud services enable secretmanager.googleapis.com`).
- Your application instrumented with an OpenTelemetry SDK that exports OTLP.

## Step 1 — Store the token in Secret Manager

> **This token is a secret.** Put it in Secret Manager and reference it from the service as a secret-backed environment variable. A plain environment variable is visible to every project Viewer in the console and in `gcloud run services describe`.

```bash
printf '%s' "YOUR_TELEMETRY_INGESTION_TOKEN" | gcloud secrets create oneuptime-ingestion-token \
  --data-file=- \
  --replication-policy=automatic
```

The **runtime service account** of the Cloud Run service (not your own user) needs to read it:

```bash
gcloud secrets add-iam-policy-binding oneuptime-ingestion-token \
  --member="serviceAccount:checkout-api@my-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Without `roles/secretmanager.secretAccessor` the revision fails to deploy with `Permission denied on secret`. If the service still runs as the default compute service account, grant the role to that account instead — and consider giving the service its own account, since the default one is shared by everything in the project.

Shape A below binds a secret straight to `OTEL_EXPORTER_OTLP_HEADERS`, which needs the **whole** `name=value` header, not the bare token. Create a second secret holding the complete header and grant the same role on it (Shape B uses only the first secret):

```bash
printf '%s' "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" | gcloud secrets create oneuptime-otlp-headers \
  --data-file=- \
  --replication-policy=automatic

gcloud secrets add-iam-policy-binding oneuptime-otlp-headers \
  --member="serviceAccount:checkout-api@my-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 2 — Choose a deployment shape

**Shape A — the SDK exports straight to OneUptime.** No sidecar. Enable the GCP detector in the SDK and point the exporter at OneUptime. Right for one service, and for Cloud Run **jobs**, where there is nothing to keep a sidecar alive for.

**Shape B — a sidecar OpenTelemetry Collector.** A second container in the service; the application exports to `http://localhost:4318`, the collector stamps the `cloud.*` and `faas.*` attributes on everything through the `resourcedetection` processor and holds the token. Right when several services share one project, or when the application's SDK cannot run a detector.

### Shape A — SDK resource detector switches

| Language | Enable the GCP detector                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| Node.js  | `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp` (auto-instrumentations-node)                                        |
| Python   | `pip install opentelemetry-resourcedetector-gcp` then `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector` |
| Java     | `-Dotel.resource.providers.gcp.enabled=true`                                                                       |
| Go       | `import "go.opentelemetry.io/contrib/detectors/gcp"` and pass `gcp.NewDetector()` to `resource.New`                |
| .NET     | `OpenTelemetry.Resources.Gcp` package: `.ConfigureResource(r => r.AddGcpDetector())`                               |

Environment variables on the container:

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# Secret-backed — see the note below.
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Cloud Run injects a secret's value verbatim, and `OTEL_EXPORTER_OTLP_HEADERS` needs the whole `name=value` pair — which is why Step 1 created `oneuptime-otlp-headers` holding the **complete header**; bind that one to `OTEL_EXPORTER_OTLP_HEADERS`. Shape B uses `oneuptime-ingestion-token`, which holds just the token.

If you self-host OneUptime, replace the endpoint with `https://YOUR-ONEUPTIME-HOST/otlp`.

Deploying Shape A from the CLI:

```bash
gcloud run services update checkout-api --region us-central1 \
  --set-env-vars "^@^OTEL_SERVICE_NAME=checkout-api@OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp@OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf@OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp" \
  --set-secrets "OTEL_EXPORTER_OTLP_HEADERS=oneuptime-otlp-headers:latest"
```

The `^@^` prefix switches gcloud's list separator from `,` to `@` for that flag. Without it gcloud splits `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp` at every comma and fails with `Bad syntax for dict arg [host]`.

### Shape B — the service YAML with a sidecar

The collector is configured through one environment variable (`--config=env:OTEL_COLLECTOR_CONFIG`) and reads the token from the secret through `${env:ONEUPTIME_TOKEN}`. The `run.googleapis.com/container-dependencies` annotation makes Cloud Run start the collector first and wait for its startup probe before starting the application:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: checkout-api
spec:
  template:
    metadata:
      annotations:
        # "app" depends on "otel-collector": the collector starts first and
        # must pass its startup probe before the app container is started.
        run.googleapis.com/container-dependencies: '{"app":["otel-collector"]}'
    spec:
      serviceAccountName: checkout-api@my-project.iam.gserviceaccount.com
      containers:
        - name: app
          image: us-central1-docker.pkg.dev/my-project/apps/checkout-api:1.4.2
          ports:
            - containerPort: 8080
          env:
            - name: OTEL_SERVICE_NAME
              value: checkout-api
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://localhost:4318
            - name: OTEL_EXPORTER_OTLP_PROTOCOL
              value: http/protobuf
        - name: otel-collector
          image: otel/opentelemetry-collector-contrib:latest
          args:
            - --config=env:OTEL_COLLECTOR_CONFIG
          env:
            - name: ONEUPTIME_TOKEN
              valueFrom:
                secretKeyRef:
                  name: oneuptime-ingestion-token
                  key: latest
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
                  # Stamps cloud.provider, cloud.platform=gcp_cloud_run,
                  # cloud.account.id, cloud.region and faas.* on everything.
                  resourcedetection:
                    detectors: [env, gcp]
                    timeout: 5s
                  batch: {}
                exporters:
                  otlphttp/oneuptime:
                    endpoint: https://oneuptime.com/otlp
                    headers:
                      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}
                extensions:
                  health_check:
                    endpoint: 0.0.0.0:13133
                service:
                  extensions: [health_check]
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
          startupProbe:
            httpGet:
              path: /
              port: 13133
            periodSeconds: 2
            failureThreshold: 15
          resources:
            limits:
              cpu: 500m
              memory: 256Mi
```

Deploy it:

```bash
gcloud run services replace service.yaml --region us-central1
```

Only the ingress container (`app`) declares `ports`; a sidecar must not. Cloud Run containers in one instance share `localhost`, which is how the app reaches the collector.

## Step 3 — Or do it in the console

1. **Google Cloud console → Cloud Run → click the service → Edit & deploy new revision**.
2. On the **Containers** tab, open the application container and go to **Variables & Secrets**. Add `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL` as variables. For Shape A, click **Reference a secret**, choose `oneuptime-otlp-headers` (the whole-header secret from Step 1) and version `latest`, expose it as an **environment variable** named `OTEL_EXPORTER_OTLP_HEADERS`, and add the detector switch for your language.
3. Shape B: click **+ Add container**. Container image URL `otel/opentelemetry-collector-contrib:latest`; under **Container command and arguments** set the argument `--config=env:OTEL_COLLECTOR_CONFIG`.
4. On the new container's **Variables & Secrets** tab, **Reference a secret** `oneuptime-ingestion-token` as environment variable `ONEUPTIME_TOKEN`, and add a variable `OTEL_COLLECTOR_CONFIG` with the YAML above as its value.
5. On the collector's **Settings** tab add a **Startup probe** (HTTP, path `/`, port `13133`), and under **Container start-up order** make the application container depend on `otel-collector`.
6. On the **Security** tab confirm the **Service account** is the one you granted `roles/secretmanager.secretAccessor` to.
7. **Deploy**.

## Step 4 — Networking

By default a Cloud Run service reaches the public internet directly, and nothing more is needed to export to `oneuptime.com`.

If the service is configured to **route all traffic through a VPC** — Direct VPC egress or a Serverless VPC Access connector with **VPC egress: All traffic** (`--vpc-egress all-traffic`) — its outbound traffic leaves through the VPC, and the VPC needs a **Cloud NAT** gateway (or a route to a proxy) for the OneUptime host to be reachable. With the default `private-ranges-only` setting, only RFC 1918 destinations use the VPC and OneUptime is reached directly. Either way, VPC firewall egress rules must allow TCP **443** to the OneUptime host.

A self-hosted OneUptime inside the VPC is the reverse case: route `private-ranges-only` (or `all-traffic`) through the VPC so `https://YOUR-ONEUPTIME-HOST/otlp` resolves inside it.

## Step 5 — Verify

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` with `"valid": true` means the token resolves to a project; `401` means it is unknown, revoked or mistyped. Then send one request to the service and read the collector's logs in **Cloud Logging** (filter on the `otel-collector` container) for `401`, `connection refused` or `context deadline exceeded`. Within a minute the environment appears at **Cloud → All Environments** as _GCP Cloud Run · us-central1 · my-project_, and the service under **Serverless Functions** as well.

## What you get

- **Overview** — request volume, error rate and p95 latency derived from traces.
- **Instances** — one row per Cloud Run instance, keyed by `faas.instance`. Cloud Run does not expose a container's cgroup statistics to a sidecar, so the **CPU** and **Memory** tiles stay empty unless you ship `container.cpu.utilization` / `container.memory.usage` metrics carrying the same `faas.instance` yourself; most teams read the **Requests** tiles instead and leave instance CPU / memory to Cloud Monitoring.
- **Logs**, **Traces** and **Metrics** tabs scoped to the environment.
- The same service under **Serverless Functions** (via `faas.name`) and under **Services** (via `service.name`).

## Troubleshooting

- **Revision fails with `Permission denied on secret`** — the runtime service account lacks `roles/secretmanager.secretAccessor`, or the binding is on a different secret name than the YAML references.
- **`container-dependencies` rejected** — the annotation names a container that does not exist, or the collector has no startup probe and Cloud Run cannot tell when it is ready.
- **Only Serverless Functions shows the service, no environment** — `cloud.platform` is missing: the GCP detector is not enabled in the SDK (Shape A) or `gcp` is not in the collector's `detectors` list (Shape B).
- **Environment is there, Instances is empty** — the telemetry has no `faas.instance` or `service.instance.id`; the same missing-detector cause.

Everything else — an environment that never appears, goes **Disconnected**, or splits into duplicates — is on the shared [Cloud Troubleshooting](/docs/telemetry/cloud-troubleshooting) page.
