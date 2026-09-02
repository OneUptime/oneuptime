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

### Probe and Runner identity keys

`PROBE_KEY` and `ONEUPTIME_RUNNER_KEY` are not shared application secrets — each
one is the *identity* of a single probe or of the Runner. The server registers a
brand-new probe (or Runner) the first time it sees a key it does not recognise.
They are configured per component rather than in `externalSecrets`, and follow
the same three-way precedence:

| Parameter                                    | Description                                                        | Default |
|----------------------------------------------|--------------------------------------------------------------------|---------|
| `probes.<key>.existingSecret.name`           | Name of an existing Secret holding this probe's `PROBE_KEY`.        | `nil`   |
| `probes.<key>.existingSecret.passwordKey`    | Key inside that Secret.                                             | `nil`   |
| `runner.existingSecret.name`                 | Name of an existing Secret holding `ONEUPTIME_RUNNER_KEY`.          | `nil`   |
| `runner.existingSecret.passwordKey`          | Key inside that Secret.                                             | `nil`   |

An inline `probes.<key>.key` / `runner.key` still wins; with neither set, the
chart generates the value into `<release>-secrets` as before. As with
`externalSecrets`, a key you serve yourself is not written into the chart-managed
Secret at all.

**Why this matters for GitOps.** `helm template` — what Argo CD and Flux render
with — always takes the chart's install branch, so a chart-generated key is a new
random value on every reconcile. For an identity key that means a new probe is
registered each time and the previous one is orphaned. Because a monitor's probe
list is fixed when the monitor is created and never back-filled, the monitor keeps
pointing at a probe that no longer runs and **monitoring stops with no error
anywhere**. Point these at Secrets you own to pin the identities.

```yaml
probes:
  one:
    existingSecret:
      name: oneuptime-identities
      passwordKey: probe-one-key
runner:
  existingSecret:
    name: oneuptime-identities
    passwordKey: runner-key
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
| `keda.enabled`                                  | Render the chart's KEDA `ScaledObject`s, so the opted-in tiers scale on queue backlog instead of a plain HorizontalPodAutoscaler. Opt a tier in with `<service>.keda.enabled`. | `false` |
| `keda.install`                                  | Install the bundled KEDA operator. Unset by default, which makes it follow `keda.enabled`; set it to `false` to use a KEDA your platform team already runs. See [KEDA Ops](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/Keda.md). | unset |
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
| `probes.<key>.existingSecret.name`                | Read this probe's `PROBE_KEY` from a Secret you manage instead. See [Probe and Runner identity keys](#probe-and-runner-identity-keys). | `nil`   |
| `probes.<key>.existingSecret.passwordKey`         | Key inside that Secret.                                               | `nil`   |
| `probes.<key>.monitoringWorkers`                  | Number of parallel processes used to monitor resources.               | `3`     |
| `probes.<key>.monitorFetchLimit`                  | Number of resources monitored in parallel.                            | `10`    |
| `probes.<key>.automountServiceAccountToken`       | Mount a Kubernetes service-account token into Probe pods. Disabled by default because Probes do not require Kubernetes API credentials. | `false` |
| `probes.<key>.syntheticMonitorScriptTimeoutInMs`  | Timeout for synthetic monitor scripts in milliseconds (`1`–`2147363647`). The upper bound reserves 120 seconds for browser and worker startup within Node.js's safe timer range. | `60000` |
| `probes.<key>.syntheticMonitorMaxConcurrency`     | Maximum isolated synthetic browser processes per Probe; extra executions queue FIFO. | `4` |
| `probes.<key>.syntheticMonitorMaxProcessTreeRssBytes` | Aggregate RSS ceiling for each isolated worker and all browser descendants. | `1610612736` |
| `probes.<key>.syntheticMonitorMaxDiskBytes` | Writable disk ceiling for each isolated execution, including browser profiles, caches, IndexedDB, and OPFS. | `268435456` |
| `probes.<key>.syntheticMonitorTempStorageSizeLimit` | Pod-level `emptyDir` ceiling for `/tmp`, providing a backstop across all concurrent synthetic executions. Increase this when raising concurrency or the per-run disk ceiling. | `2Gi` |
| `probes.<key>.syntheticMonitorChromiumSandboxEnabled` | Require Chromium's OS sandbox. Enable only after installing a Playwright-compatible Localhost seccomp profile on every Probe node; launch fails closed when the sandbox is unavailable. | `false` |
| `probes.<key>.customCodeMonitorScriptTimeoutInMs` | Timeout for custom code monitor scripts.                              | `60000` |
| `probes.<key>.proxy.httpProxyUrl`                 | HTTP proxy URL for HTTP requests made by the probe (optional).        | `nil`   |
| `probes.<key>.proxy.httpsProxyUrl`                | HTTPS proxy URL for HTTPS requests made by the probe (optional).      | `nil`   |
| `probes.<key>.proxy.noProxy`                      | Comma-separated hosts that bypass the proxy (optional).               | `nil`   |
| `probes.<key>.additionalContainers`              | Additional containers to add to the probe pod.                        | `nil`   |
| `probes.<key>.resources`                          | Pod resources (limits, requests).                                     | `nil`   |
| `probes.<key>.dnsConfig`                          | Per-probe [`dnsConfig`](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/#pod-dns-config) override. Unset by default — the probe inherits the chart-wide `dnsConfig` (see below). A per-probe value fully replaces the chart-wide default (not merged). | `nil` (inherits chart-wide) |
| `probes.<key>.dnsPolicy`                          | Per-probe `dnsPolicy` override. Unset by default — inherits the chart-wide `dnsPolicy`. | `nil` (inherits chart-wide) |

Synthetic executions always run in short-lived processes and browser workers.
The image's default root Probe supervisor additionally assigns each execution a
unique, low-privilege UID. An explicit non-root Probe override remains supported,
but workers then share the Probe UID and lose that extra UID boundary. The stock
`RuntimeDefault` seccomp profile keeps the chart portable but commonly blocks
the user-namespace calls Chromium's additional OS sandbox requires. To enable
that defense in depth, install a CRI/OCI-compatible profile derived from your
container runtime's default with `clone`, `setns`, and `unshare` enabled in the
kubelet seccomp directory on every Probe node, then configure the matching path.
Do not use `Probe/seccomp_profile.json` verbatim here: it contains
Moby-specific conditional fields for Docker Compose rather than Kubernetes CRI.

```yaml
probes:
  one:
    syntheticMonitorChromiumSandboxEnabled: true
    containerSecurityContext:
      seccompProfile:
        type: Localhost
        localhostProfile: profiles/oneuptime-playwright.json
```

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
| `probeContainerSecurityContext` | Probe-only container security defaults, merged beneath chart-wide and per-probe overrides. Keeps the root supervisor able to drop worker UIDs while applying `allowPrivilegeEscalation: false`, reduced capabilities, and `RuntimeDefault` seccomp. | see `values.yaml` |
| `nodeSelector`             | Node selector.             | `{}`    |
| `tolerations`              | Tolerations.               | `[]`    |
| `affinity`                 | Affinity.                  | `{}`    |

## Extra environment variables and volumes

Every workload the chart runs takes `extraEnv`, `extraVolumes` and
`extraVolumeMounts`. They are passed through to the pod spec verbatim, so
anything Kubernetes accepts in an `EnvVar`, `Volume` or `VolumeMount` works.
They are empty by default and render nothing at all, so an install that does not
set them is unaffected.

Set them at the top level to apply to every workload, or under a single service
to apply to just that one:

| Parameter                        | Description                                                                      | Default |
|----------------------------------|----------------------------------------------------------------------------------|---------|
| `extraEnv`                       | Extra environment variables added to every workload.                             | `[]`    |
| `extraVolumes`                   | Extra pod volumes added to every workload.                                       | `[]`    |
| `extraVolumeMounts`              | Extra container volume mounts added to every workload.                           | `[]`    |
| `<service>.extraEnv`             | Extra environment variables for one service. Replaces the chart-wide list.        | `[]`    |
| `<service>.extraVolumes`         | Extra pod volumes for one service. Replaces the chart-wide list.                  | `[]`    |
| `<service>.extraVolumeMounts`    | Extra container volume mounts for one service. Replaces the chart-wide list.      | `[]`    |

`<service>` is any of `app`, `worker`, `probes.<name>`, `runner`, `home`,
`telemetryWriter`, `nginx`, `pgbouncer`, `testServer`, `migrate`, `vllm` or
`cronJobs.e2e`.

A service's list **replaces** the chart-wide one — the two are not merged. That
is the precedence the chart already uses for `hostAliases`, `nodeSelector` and
the security contexts, and for volumes it is the only safe one: concatenating
would produce two volumes with the same `name` as soon as you narrowed a
chart-wide volume for one service, and the API server rejects that pod outright.
Setting a service's list to `[]` inherits the chart-wide list rather than
clearing it, so a service cannot opt out of a chart-wide entry — scope the entry
per-service instead of chart-wide when only some services should get it.

`extraEnv` entries are appended after the variables the chart sets itself, so
Kubernetes — which applies the last entry for a repeated name — uses yours. Two
names are worth not repeating: `DISABLE_QUEUE_WORKERS` is what makes a pod a
`worker` rather than an API pod (and the reverse on `telemetryWriter`), so
setting it chart-wide silently changes what those tiers do.


The bundled databases (`postgresql`, `redis`, `clickhouse` and the ClickHouse
Keeper) and the `cronJobs.cleanup` jobs deliberately do not take these. The
databases are servers rather than clients, already expose their TLS and tuning
settings as first-class values, and have operator-managed twins whose pods come
from a CR rather than from these templates — so the setting would apply to only
half of an install. The cleanup jobs run `bitnami/kubectl` against the
in-cluster API server, which is trusted through the ServiceAccount CA.

### Example: trust an internal CA

The case these exist for. OneUptime's services are Node.js, so pointing
`NODE_EXTRA_CA_CERTS` at a mounted bundle is enough for every outbound TLS call
— webhooks, SMTP, custom monitors, an internal container registry, an
OIDC provider with a private issuer.

Put the bundle in a ConfigMap first:

```console
kubectl create configmap internal-ca-bundle -n oneuptime --from-file=ca.crt=/path/to/internal-ca.crt
```

Then, in your `values.yaml`:

```yaml
extraVolumes:
  - name: internal-ca
    configMap:
      name: internal-ca-bundle
extraVolumeMounts:
  - name: internal-ca
    mountPath: /etc/ssl/internal
    readOnly: true
extraEnv:
  - name: NODE_EXTRA_CA_CERTS
    value: /etc/ssl/internal/ca.crt
```

That reaches app, worker, every probe, runner, home, telemetry-writer, nginx,
pgbouncer, test-server, the migrate Job and the e2e cron in one setting. The
migrate Job matters here: it talks to Postgres and ClickHouse before any app pod
does, so a CA it cannot see fails the install rather than degrading it.

`NODE_EXTRA_CA_CERTS` covers Node.js, which is every outbound call OneUptime's
own code makes. It does **not** reach the Chromium that probes drive for
synthetic browser monitors, or the one the e2e cron uses: Chromium reads the OS
trust store instead. Synthetic monitors against an internally-signed site need
the certificate baked into the image's `/usr/local/share/ca-certificates` and
`update-ca-certificates` run at build time.

Confirm what an upgrade would actually change before you run it:

```console
helm template my-oneuptime oneuptime/oneuptime -f values.yaml | grep -c NODE_EXTRA_CA_CERTS
```

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

## On-call calendar feeds

People can subscribe Google Calendar, Outlook or Apple Calendar to their
on-call shifts through a secret `.ics` URL of the form
`https://<host>/api/on-call-calendar/user/<token>/shifts.ics` (schedule-wide
and project-wide feeds live under `/schedule/` and `/project/`). The token in
the path is the whole credential, so treat those URLs like passwords: the
chart's own nginx does not write them to its access log, but any proxy, WAF or
CDN you put in front will log the URI unless you tell it not to.

`onCallCalendarFeed.disabled: true` switches every feed URL off. Clients get a
`503` with `Retry-After: 3600`, keep the copy they already have and try again in
an hour; nothing is deleted, and flipping it back resumes the feeds.

The rate limits bound those public routes. `perTokenPerWindow` is the budget one
subscribed calendar gets (keyed on token + client address); `perIpPerWindow` is
the ceiling that survives a caller rotating tokens. Calendar clients poll about
hourly -- Apple Calendar every five minutes at most -- so the defaults leave
plenty of room for a whole team's clients behind one office address. The client
address is the one `trustedProxyHops` selects, so a deployment behind an extra
load balancer needs that set correctly for the per-address limit to mean
anything. The limiter fails open when Redis is unreachable: it is load control,
not the only thing guarding the token.

| Parameter                                    | Description                                                                             | Default |
|----------------------------------------------|-----------------------------------------------------------------------------------------|---------|
| `onCallCalendarFeed.disabled`                | Set to `true` to answer every feed URL with `503` + `Retry-After: 3600`.                | `false` |
| `onCallCalendarFeed.rateLimit.windowSeconds` | Length of the fixed rate-limit window.                                                  | `60`    |
| `onCallCalendarFeed.rateLimit.perTokenPerWindow` | Requests one token may make from one client address per window.                     | `60`    |
| `onCallCalendarFeed.rateLimit.perIpPerWindow` | Requests one client address may make across all tokens per window.                    | `3000`  |

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
