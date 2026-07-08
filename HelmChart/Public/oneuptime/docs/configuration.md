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
| `podDisruptionBudget.enabled`                   | Create a PodDisruptionBudget for each stateless deployment (app, worker, nginx, home, ai-agent, probes, pgbouncer) to cap voluntary disruptions during node drains / upgrades. | `false` |
| `podDisruptionBudget.minAvailable`              | Minimum pods that must stay available. Integer or percentage (e.g. `"50%"`). Takes precedence over `maxUnavailable`. Leave empty to use `maxUnavailable`. | `""` |
| `podDisruptionBudget.maxUnavailable`            | Maximum pods that may be unavailable during a voluntary disruption. Integer or percentage.    | `1`     |
| `<service>.podDisruptionBudget`                 | Per-service override of the global block. Omitted keys inherit the global value. `<service>` = app/worker/nginx/home/aiAgent/probes.&lt;key&gt;/pgbouncer. | `{}` (inherit) |

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

## Other

| Parameter                          | Description                              | Default |
|------------------------------------|------------------------------------------|---------|
| `extraTemplates`                   | Extra templates to add to the deployment.| `[]`    |
| `script.workflowScriptTimeoutInMs` | Timeout for workflow scripts.            | `5000`  |
| `dnsConfig`                        | Chart-wide fallback pod `dnsConfig` used by services that support DNS overrides (currently the probes) when they don't set their own. Ships an `ndots:1` + fallback-nameservers default to avoid `getaddrinfo EAI_AGAIN` — see [Probes](#probes). | `ndots:1` + `8.8.8.8`/`1.1.1.1` |
| `dnsPolicy`                        | Chart-wide fallback pod `dnsPolicy`. Left unset so Kubernetes uses `ClusterFirst` (in-cluster API keeps resolving). | `nil`   |

## Related pages

- [Databases](databases.md) — PostgreSQL, Redis, and ClickHouse (built-in, external, and HA operators).
- [Custom domains](custom-domains.md) — status page domains and Let's Encrypt.
- [Production checklist](production-checklist.md) — hardening for real deployments.
