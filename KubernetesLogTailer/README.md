# OneUptime Kubernetes Log Tailer

A small Node.js service that collects pod logs from a Kubernetes cluster via
the **Kubernetes API** (`GET /api/v1/namespaces/{ns}/pods/{pod}/log?follow=true`)
and forwards them to OneUptime via OTLP-HTTP.

## Why this exists

The default OneUptime Kubernetes agent collects logs via a DaemonSet that
mounts `/var/log/pods` using a hostPath volume. That approach doesn't work on
managed Kubernetes offerings that block hostPath — most notably **GKE
Autopilot**.

This tailer runs as a single-replica **Deployment** with no hostPath, no
hostNetwork, no privileged containers, and no host access of any kind. It only
needs read-only access to pods and pods/log via the Kubernetes API — the same
permissions `kubectl logs` needs. That makes it compatible with GKE Autopilot,
EKS Fargate, and any other restricted Kubernetes environment.

## What it does

- Watches pods across all allowed namespaces via a Kubernetes informer.
- For each running container (main, init, and ephemeral), opens a follow
  stream to the Kubernetes API log endpoint.
- Parses RFC3339Nano timestamps and derives log severity from the message
  body (`ERROR`, `WARN`, `INFO`, etc.) with a fallback to the stderr/stdout
  marker when no severity keyword is present.
- Batches records and exports via OTLP-HTTP JSON to `<oneuptime>/otlp/v1/logs`
  with the `x-oneuptime-token` authentication header.
- Reconnects streams with exponential backoff when connections drop or the
  Kubernetes API returns a transient error.
- Skips its own pods (identified by a configurable label selector) to avoid a
  feedback loop.

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ONEUPTIME_URL` | yes | — | Base URL of your OneUptime instance (e.g. `https://oneuptime.example.com`). |
| `ONEUPTIME_API_KEY` | yes | — | Project API key. |
| `CLUSTER_NAME` | yes | — | Stamped as `k8s.cluster.name` on every log record. |
| `NAMESPACE_INCLUDE` | no | (empty) | Comma-separated allowlist. If set, only these namespaces are tailed. |
| `NAMESPACE_EXCLUDE` | no | `kube-system` | Comma-separated denylist. |
| `AGENT_NAMESPACE` | no | (empty) | Scope the self-exclusion label selector to this namespace. |
| `AGENT_LABEL_SELECTOR` | no | `app.kubernetes.io/part-of=oneuptime` | Pods matching this selector are skipped to prevent feedback loops. |
| `BATCH_MAX_RECORDS` | no | `500` | Flush the batch after this many records. |
| `BATCH_MAX_MS` | no | `5000` | Flush the batch after this many milliseconds. |
| `EXPORT_MAX_RETRIES` | no | `5` | Max retries for a failed OTLP export (exponential backoff). |
| `SINCE_SECONDS_ON_START` | no | `10` | When a stream first connects, fetch the last N seconds of log buffer. Reconnects use 1s to minimize duplication. |
| `HEALTH_PORT` | no | `13133` | HTTP port for `/healthz`. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`. |

## Health

- `GET /healthz` returns `200` when the tailer has had a recent successful
  export (or hasn't attempted one yet), and `503` otherwise. The body includes
  `activeStreams` and the last export error if any.

## Scale considerations

The tailer runs as a single replica. In practice one replica can tail a few
thousand containers before hitting network or API-server throughput limits.
For very large clusters, shard by namespace (run multiple replicas, each with
its own `NAMESPACE_INCLUDE`) or fall back to the existing DaemonSet/filelog
mode on clusters that allow hostPath.

## Security context

The container runs as UID/GID 1000 (non-root) and requires no Linux
capabilities, hostPath volumes, hostNetwork, or privileged mode.
