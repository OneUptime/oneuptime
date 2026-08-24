# Releases, Upgrade Notes & Dependencies

## Releases

We release frequently, sometimes multiple times a day. It's usually safe to
upgrade to the latest version. Any breaking changes are documented in the
[release notes](https://github.com/OneUptime/oneuptime/releases) — please read
them before upgrading.

See [Installation & Upgrades](installation.md#upgrading) for the upgrade command.

## Upgrade notes

- **12.0.21 (2026-08-24)** — The Cal.com booking webhook is removed. Delete any
  `marketing.cal:` block from your values files — the chart schema rejects
  unknown keys, so `helm upgrade` fails validation with
  `marketing: Additional property cal is not allowed` while one remains. The
  key set `CAL_WEBHOOK_SECRET` on the App, which verified inbound Cal.com
  `BOOKING_CREATED` deliveries and emitted them as `meeting_booked` marketing
  events; no booking webhook is received or emitted any more, so any Cal.com
  webhook pointed at `/api/cal-webhook` can be deleted on the Cal.com side too.
  `marketing.webhook.url` / `marketing.webhook.secret` are unaffected — they
  keep delivering the remaining conversion events, minus `meeting_booked`.

- **12.0.0 (2026-08-04)** — The AI Agent and the Runbook Agent merged into the
  OneUptime Runner. Rename any `aiAgent:` block in your values files to
  `runner:` (subkeys are unchanged) — the chart schema rejects unknown keys,
  so `helm upgrade` fails validation while an `aiAgent:` block remains.
  Workloads are renamed from `<release>-ai-agent` to `<release>-runner`, and
  the release secret key `ai-agent-key` becomes `runner-key` (regenerated
  automatically; the in-cluster Runner re-registers itself). The KEDA metric
  name `oneuptime_ai_agent_queue_size` is unchanged. See the
  [upgrading guide](https://oneuptime.com/docs/installation/upgrading) for
  the full v11 → v12 migration, including redeploying Runbook Agents
  installed on your own hosts.

- **9.0.0 (2025-11-21)** — Kubernetes Ingress objects are no longer created.
  OneUptime already ships an ingress gateway container that manages TLS
  certificates, status page domains, and routing. Remove any `oneuptimeIngress`
  overrides from your values files and ensure `nginx.service.type` matches how
  you expose the ingress gateway (for example `LoadBalancer`).

## Chart dependencies

These charts are used as dependencies for some components. You don't need to
install them separately. Read each chart's own README to understand its
configuration options.

| Chart                          | Description                                                                                 | Repository |
|--------------------------------|---------------------------------------------------------------------------------------------|------------|
| `keda`                         | Kubernetes Event-driven Autoscaling — installed only when `keda.install` (or, unset, `keda.enabled`) is `true`. | https://kedacore.github.io/charts |
| `cloudnative-pg`               | CloudNativePG operator — installed only when `postgresOperator.cnpg.enabled` is `true`.     | https://cloudnative-pg.github.io/charts |
| `altinity-clickhouse-operator` | Altinity ClickHouse operator — installed only when `clickhouseOperator.altinity.enabled` is `true`. | https://helm.altinity.com/ |
