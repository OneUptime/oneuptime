# Configuration Reference

Every configurable value in the OneUptime chart, grouped by topic. Set these in
your `values.yaml` (see [Installation](installation.md)). For the full, always
up-to-date list see [`values.yaml`](../values.yaml).

🚨 = you almost always need to change this for a real deployment.

## Core / required

| Parameter          | Description                                                                                     | Default         | Change |
|--------------------|-------------------------------------------------------------------------------------------------|-----------------|:------:|
| `global.storageClass` | Storage class used for all persistent volumes.                                               | `nil`           | 🚨 |
| `host`             | Primary hostname served by OneUptime (used for routing and certificates).                       | `localhost`     | 🚨 |
| `httpProtocol`     | Set to `https` when the server has an SSL/TLS certificate, otherwise `http`.                     | `http`          | 🚨 |
| `ssl.provision`    | Auto-provision a Let's Encrypt certificate for the primary host (needs public ports 80 & 443).  | `false`         |    |
| `oneuptimeSecret`  | Value used for `ONEUPTIME_SECRET`. Set to a long random string in production.                    | `nil`           |    |
| `encryptionSecret` | Value used for `ENCRYPTION_SECRET`. Set to a long random string in production.                   | `nil`           |    |
| `global.clusterDomain` | Kubernetes cluster domain.                                                                   | `cluster.local` |    |
| `nodeEnvironment`  | Node environment. Leave as `production` unless doing local development.                          | `production`    |    |
| `logLevel`         | One of `INFO`, `WARN`, `ERROR`, `DEBUG`.                                                         | `INFO`          |    |

## Application secrets

`ONEUPTIME_SECRET`, `ENCRYPTION_SECRET` and `REGISTER_PROBE_KEY` can be supplied
in three ways, in this order of precedence:

1. Inline, via `oneuptimeSecret` / `encryptionSecret` / `registerProbeKey`.
2. From a Kubernetes Secret you manage yourself, via the `externalSecrets`
   block below. Leave the inline values blank when you use this.
3. Not at all — the chart then generates a random 32-character value into its
   own `<release>-secrets` Secret on install and keeps it across upgrades.

| Parameter                                              | Description                                                       | Default |
|--------------------------------------------------------|-------------------------------------------------------------------|---------|
| `externalSecrets.oneuptimeSecret.existingSecret.name`  | Name of an existing Secret holding `ONEUPTIME_SECRET`.             | `nil`   |
| `externalSecrets.oneuptimeSecret.existingSecret.passwordKey` | Key inside that Secret.                                      | `nil`   |
| `externalSecrets.encryptionSecret.existingSecret.name` | Name of an existing Secret holding `ENCRYPTION_SECRET`.            | `nil`   |
| `externalSecrets.encryptionSecret.existingSecret.passwordKey` | Key inside that Secret.                                     | `nil`   |
| `externalSecrets.registerProbeKey.existingSecret.name` | Name of an existing Secret holding `REGISTER_PROBE_KEY`.           | `nil`   |
| `externalSecrets.registerProbeKey.existingSecret.passwordKey` | Key inside that Secret.                                     | `nil`   |

Keys served by `externalSecrets` are not written into the chart-managed
`<release>-secrets` Secret at all — pods read them straight from your Secret, so
`helm diff` no longer reports them as changing on every render.

If you were already using `externalSecrets` before this change, the copies the
chart used to generate stay behind in the live `<release>-secrets` Secret: Helm
patches the `stringData` field, and the API server has already folded the old
values into `data`, so dropping a key from the template does not delete it from
the object. Nothing reads them, so leaving them is harmless. To clear them out:

```
kubectl patch secret <release>-secrets -n <namespace> --type=json \
  -p '[{"op":"remove","path":"/data/oneuptime-secret"},
       {"op":"remove","path":"/data/encryption-secret"},
       {"op":"remove","path":"/data/register-probe-key"}]'
```

Remove only the keys you actually serve via `externalSecrets`. Deleting them is
not free: if you later drop the `externalSecrets` block, the chart generates a
brand-new value for any key that is no longer in `<release>-secrets`, and a new
`ENCRYPTION_SECRET` means existing encrypted data can no longer be read. Leaving
the old copies in place is the safer default — an install that adopted
`externalSecrets` after running on chart-managed secrets had to copy its
`ENCRYPTION_SECRET` into its own Secret to keep its data readable, so the
retained copy is the same value and switching back picks it up again.

If your install used `externalSecrets` from day one, the retained copies are
values no pod ever read, and neither keeping nor deleting them gives you a
working fallback. Switch back by copying the real values out of your own Secret
first — set them inline as `oneuptimeSecret` / `encryptionSecret` /
`registerProbeKey`, or write them into `<release>-secrets` yourself.

Example:

```yaml
externalSecrets:
  oneuptimeSecret:
    existingSecret:
      name: one-uptime
      passwordKey: one-uptime-secret
  encryptionSecret:
    existingSecret:
      name: one-uptime
      passwordKey: encryption-secret
  registerProbeKey:
    existingSecret:
      name: one-uptime
      passwordKey: register-probe-key
```

## Networking & ingress

| Parameter                    | Description                                                          | Default        |
|------------------------------|----------------------------------------------------------------------|----------------|
| `nginx.service.type`         | Service type for the bundled OneUptime ingress gateway.              | `LoadBalancer` |
| `nginx.service.loadBalancerIP` | Load balancer IP for the nginx service.                            | `nil`          |
| `statusPage.cnameRecord`     | CNAME record for the status page. See [Custom domains](custom-domains.md). | `nil`    |

## Images

| Parameter             | Description                                                                              | Default              |
|-----------------------|------------------------------------------------------------------------------------------|----------------------|
| `image.registry`      | Docker image registry.                                                                   | `docker.io`          |
| `image.repository`    | Docker image repository.                                                                 | `oneuptime`          |
| `image.tag`           | Docker image tag. Pin this in production (see [Production checklist](production-checklist.md)). | `release`     |
| `image.pullPolicy`    | Image pull policy.                                                                        | `IfNotPresent`       |
| `image.type`          | `community-edition` or `enterprise-edition` (enterprise requires a valid license).        | `community-edition`  |
| `image.restartPolicy` | Image restart policy.                                                                     | `Always`             |

## Autoscaling & availability

| Parameter                                       | Description                                                                                   | Default |
|-------------------------------------------------|-----------------------------------------------------------------------------------------------|---------|
| `deployment.replicaCount`                       | Number of replicas.                                                                            | `1`     |
| `autoscaling.enabled`                           | Enable autoscaling.                                                                            | `false` |
| `autoscaling.minReplicas`                       | Minimum number of replicas.                                                                    | `1`     |
| `autoscaling.maxReplicas`                       | Maximum number of replicas.                                                                    | `100`   |
| `autoscaling.targetCPUUtilizationPercentage`    | Target CPU utilization percentage.                                                            | `80`    |
| `autoscaling.targetMemoryUtilizationPercentage` | Target memory utilization percentage.                                                        | `80`    |
| `podDisruptionBudget.enabled`                   | Create a PodDisruptionBudget for each stateless deployment (app, worker, nginx, home, runner, probes, pgbouncer) to cap voluntary disruptions during node drains / upgrades. | `false` |
| `podDisruptionBudget.minAvailable`              | Minimum pods that must stay available. Integer or percentage (e.g. `"50%"`). Takes precedence over `maxUnavailable`. Leave empty to use `maxUnavailable`. | `""` |
| `podDisruptionBudget.maxUnavailable`            | Maximum pods that may be unavailable during a voluntary disruption. Integer or percentage.    | `1`     |
| `<service>.podDisruptionBudget`                 | Per-service override of the global block. Omitted keys inherit the global value. `<service>` = app/worker/nginx/home/runner/probes.&lt;key&gt;/pgbouncer. | `{}` (inherit) |

## Probes

Configured per probe under `probes.<key>`.

| Parameter                                         | Description                                                            | Default |
|---------------------------------------------------|------------------------------------------------------------------------|---------|
| `probes.<key>.name`                               | Probe name.                                                            | `<key>` |
| `probes.<key>.description`                         | Probe description.                                                     | `nil`   |
| `probes.<key>.key`                                | Probe key. Set to a long random string to secure your probes.         | `nil`   |
| `probes.<key>.monitoringWorkers`                  | Number of parallel processes used to monitor resources.               | `3`     |
| `probes.<key>.monitorFetchLimit`                  | Number of resources monitored in parallel.                            | `10`    |
| `probes.<key>.syntheticMonitorScriptTimeoutInMs`  | Timeout for synthetic monitor scripts.                                | `60000` |
| `probes.<key>.customCodeMonitorScriptTimeoutInMs` | Timeout for custom code monitor scripts.                              | `60000` |
| `probes.<key>.proxy.httpProxyUrl`                 | HTTP proxy URL for HTTP requests made by the probe (optional).        | `nil`   |
| `probes.<key>.proxy.httpsProxyUrl`                | HTTPS proxy URL for HTTPS requests made by the probe (optional).      | `nil`   |
| `probes.<key>.proxy.noProxy`                      | Comma-separated hosts that bypass the proxy (optional).               | `nil`   |
| `probes.<key>.additionalContainers`              | Additional containers to add to the probe pod.                        | `nil`   |
| `probes.<key>.resources`                          | Pod resources (limits, requests).                                     | `nil`   |
| `probes.<key>.dnsConfig`                          | Per-probe [`dnsConfig`](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-config) override. Unset by default — the probe inherits the chart-wide `dnsConfig` (see below). A per-probe value fully replaces the chart-wide default (not merged). | `nil` (inherits chart-wide) |
| `probes.<key>.dnsPolicy`                          | Per-probe `dnsPolicy` override. Unset by default — inherits the chart-wide `dnsPolicy`. | `nil` (inherits chart-wide) |

> **Why probes have custom DNS settings.** Probes resolve mostly *external* hostnames. The Kubernetes default (`ndots:5` plus a multi-entry search list) turns every external lookup into ~7 DNS queries funneled through a single upstream resolver, which under load causes intermittent `getaddrinfo EAI_AGAIN` failures and false monitor-down alerts. The chart ships a **chart-wide `dnsConfig` default** (`ndots:1`, which removes the search-domain fan-out, plus public fallback nameservers `8.8.8.8`/`1.1.1.1`); `dnsPolicy` stays `ClusterFirst` so `*.svc.cluster.local` (the OneUptime API the probe calls) still resolves. Each probe inherits this fallback unless it sets its own `probes.<key>.dnsConfig`. On **air-gapped clusters** with no egress to public DNS, drop the chart-wide `nameservers` list (keep the `options` block) or set `dnsConfig: {}`.

## Incidents & alerts

| Parameter                            | Description                                                                          | Default |
|--------------------------------------|--------------------------------------------------------------------------------------|---------|
| `incidents.disableAutomaticCreation` | Disable automatic incident creation (useful during emergencies / alert overload).    | `false` |
| `alerts.disableAutomaticCreation`    | Disable automatic alert creation (useful during emergencies / alert overload).       | `false` |

## Queue dashboard

| Parameter                | Description                                                                                                        | Default |
|--------------------------|--------------------------------------------------------------------------------------------------------------------|---------|
| `queueDashboard.enabled` | Mount the BullMQ (Bull Board) queue inspector UI at `/worker/inspect/queue/<queueDashboard.secret>`. Requires a non-empty `secret`. | `false` |
| `queueDashboard.secret`  | URL path segment used to reach the queue dashboard. Set to a long random string. Not mounted while empty.         | `nil`   |

## Security & scheduling

Refer to the Kubernetes documentation for these. This chart depends on other
Bitnami charts — you will need to set the security context for those as well.

| Parameter                  | Description                | Default |
|----------------------------|----------------------------|---------|
| `podSecurityContext`       | Pod security context.      | `{}`    |
| `containerSecurityContext` | Container security context.| `{}`    |
| `nodeSelector`             | Node selector.             | `{}`    |
| `tolerations`              | Tolerations.               | `[]`    |
| `affinity`                 | Affinity.                  | `{}`    |

## Local AI (vLLM)

Run a local, OpenAI-compatible LLM server in-cluster for OneUptime's AI
features. See the full [Local AI with vLLM](ai-vllm.md) guide.

| Parameter                                              | Description                                                                                     | Default |
|--------------------------------------------------------|-------------------------------------------------------------------------------------------------|---------|
| `vllm.enabled`                                         | Deploy a vLLM server (requires NVIDIA GPU nodes).                                                | `false` |
| `vllm.image.repository` / `vllm.image.tag`             | vLLM image to run. The image is ~10GB+, so the first pull can take several minutes.             | `vllm/vllm-openai` / pinned |
| `vllm.model`                                           | HuggingFace model id to serve. The default is small, Apache-2.0 licensed and not gated.         | `Qwen/Qwen2.5-1.5B-Instruct` |
| `vllm.servedModelName`                                 | Optional model alias exposed on `/v1/models`. If empty, use the full model id.                  | `""`    |
| `vllm.toolCalling.enabled` / `vllm.toolCalling.parser` | Enable OpenAI tool/function calling. Required for the AI copilot & agents. Parser is model-family specific (`hermes` for Qwen). | `true` / `hermes` |
| `vllm.apiKey`                                           | Optional API key guarding `/v1/*`. If unset, the server is unauthenticated (in-cluster only).   | `""`    |
| `vllm.huggingFace.token`                               | HuggingFace token for gated models (e.g. `meta-llama/*`). Not needed for the default model.     | `""`    |
| `vllm.persistence.enabled` / `vllm.persistence.size`   | Persistent cache for model weights and compile artifacts (one PVC per replica).                 | `true` / `50Gi` |
| `vllm.resources`                                       | Pod resources. Defaults request one `nvidia.com/gpu`.                                            | see `values.yaml` |
| `vllm.nodeSelector` / `vllm.tolerations`               | Schedule vLLM onto your GPU nodes.                                                               | `{}` / `[]` |

## Telemetry writer tier

Optional fixed-size deployment that owns all telemetry ClickHouse inserts.
When enabled, app/worker pods ship their batched inserts to it over
cluster-key-authenticated HTTP instead of inserting directly, so telemetry
ingest workers can scale out without adding ClickHouse insert concurrency
(which stays at `replicaCount × telemetryFanInMaxConcurrentInserts`). See the
sizing guidance in [production-checklist.md](production-checklist.md).

| Parameter                                            | Description                                                                                          | Default |
|------------------------------------------------------|------------------------------------------------------------------------------------------------------|---------|
| `telemetryWriter.enabled`                            | Deploy the tier and route app/worker telemetry inserts through it.                                   | `false` |
| `telemetryWriter.replicaCount`                       | Fixed pod count — a ClickHouse capacity decision, not a demand one. Never autoscaled on queue depth. | `2` |
| `telemetryWriter.autoscaling.enabled`                | Opt-in CPU/memory HPA (explicit enable only — the global `autoscaling` block never applies here). Requires `resources.requests`. | `false` |
| `telemetryWriter.keda.enabled`                       | Opt-in KEDA scaling on the tier-wide shed rate (429s over ~2 min, Redis-backed); optional CPU/memory triggers compose. | `false` |
| `telemetryWriter.keda.shedCountThreshold`            | Sheds in the last ~2 minutes per replica before scaling up.                                          | `100` |
| `telemetryWriter.telemetryFanInMaxConcurrentInserts` | Concurrent ClickHouse INSERTs per pod. Cluster-wide = replicas × this.                               | `4` |
| `telemetryWriter.maxInflightRequests`                | Insert requests served concurrently per pod before shedding with 429 (bounds pod memory).            | `100` |
| `telemetryWriter.telemetryFanIn*`                    | Same batching/retry knobs as `worker.telemetryFanIn*`.                                               | see `values.yaml` |
| `telemetryWriter.clickhouseMaxOpenConnections` / `telemetryWriter.clickhouseIngestMaxOpenConnections` | Per-pod ClickHouse pool ceilings.                                    | `100` / inherit |

## Update check

Once a day the worker asks GitHub which OneUptime version is the latest
release, so admins are shown an "update available" notice in the dashboard. No
usage data is sent — GitHub sees your public IP and a `User-Agent` naming
OneUptime and the version you run. An installation with no route to
`api.github.com` does not need to change anything: the request fails, is
logged, and nothing is shown.

| Parameter              | Description                                                                                                            | Default |
|------------------------|------------------------------------------------------------------------------------------------------------------------|---------|
| `updateCheck.disabled` | Set to `true` to make no outbound call at all.                                                                          | `false` |
| `updateCheck.url`      | Point the check at an internal mirror. Must answer with GitHub's release shape (`tag_name`, `html_url`, `published_at`). | `""` (GitHub) |

## Trusted proxies

`X-Forwarded-For` is a list, and each proxy appends the address it accepted the
connection from — so a caller can put whatever they like at the *front* of it.
Only the entries written by a proxy you run mean anything, and those are at the
*end*. `trustedProxyHops` says how far in from that end the real client sits,
and it is what decides which address status page and public dashboard IP
allowlists — and IP rate limits — actually check.

The default of `1` is correct for a stock install: the chart's own nginx
gateway is the only thing that touches the header, and the `LoadBalancer`
Service in front of it is L4 and does not.

**Raise it if you put your own HTTP proxy in front.** A CDN or WAF that appends
to `X-Forwarded-For` — Cloudflare, an AWS ALB, an ingress-nginx of your own —
makes this `2`, and each further appending proxy adds one.

Getting it wrong is visible in both directions. Set it too low and every
visitor is attributed to your own proxy, so allowlists match nobody. Set it too
high and you read an entry the caller writes, so a visitor can name any address
they like and the allowlist stops meaning anything.

Note that the allowlists assume the app is reachable only *through* those
proxies. Keep the app Service internal; a caller who can open a connection to
it directly is the peer, and no header setting compensates for that.

| Parameter          | Description                                                                                          | Default |
|--------------------|------------------------------------------------------------------------------------------------------|---------|
| `trustedProxyHops` | Number of appending reverse proxies you run in front of OneUptime. `0` ignores `X-Forwarded-For` entirely and uses the connecting address. | `1` |

## Other

| Parameter                          | Description                              | Default |
|------------------------------------|------------------------------------------|---------|
| `extraTemplates`                   | Extra templates to add to the deployment.| `[]`    |
| `script.workflowScriptTimeoutInMs` | Timeout for workflow scripts.            | `5000`  |
| `script.workflowTimeoutInMs`       | Wall-clock timeout for a workflow execution attempt. | `120000` |
| `dnsConfig`                        | Chart-wide fallback pod `dnsConfig` used by services that support DNS overrides (currently the probes) when they don't set their own. Ships an `ndots:1` + fallback-nameservers default to avoid `getaddrinfo EAI_AGAIN` — see [Probes](#probes). | `ndots:1` + `8.8.8.8`/`1.1.1.1` |
| `dnsPolicy`                        | Chart-wide fallback pod `dnsPolicy`. Left unset so Kubernetes uses `ClusterFirst` (in-cluster API keeps resolving). | `nil`   |

## Related pages

- [Databases](databases.md) — PostgreSQL, Redis, and ClickHouse (built-in, external, and HA operators).
- [Custom domains](custom-domains.md) — status page domains and Let's Encrypt.
- [Production checklist](production-checklist.md) — hardening for real deployments.
