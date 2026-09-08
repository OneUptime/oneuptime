# Releases, Upgrade Notes & Dependencies

## Releases

We release frequently, sometimes multiple times a day. It's usually safe to
upgrade to the latest version. Any breaking changes are documented in the
[release notes](https://github.com/OneUptime/oneuptime/releases) — please read
them before upgrading.

See [Installation & Upgrades](installation.md#upgrading) for the upgrade command.

## Upgrade notes

- **13.0.0 (2026-09-07)** — The cache and queue tier is Valkey, the
  BSD-licensed fork of Redis 7.2, and everything is named for it. **No values
  file needs editing**, but read the last two bullets before upgrading
  production.

  - Values: `redis:` → `valkey:` and `externalRedis:` → `externalValkey:`. The
    old keys still work — whatever you set under them is layered on top of the
    new defaults — and `helm upgrade` prints a deprecation notice listing the
    ones it found. Where you set the same setting under both names, the legacy
    one wins.
  - Objects: `<release>-redis` → `<release>-valkey`, `<release>-redis-master` →
    `<release>-valkey-master`, the generated Secret's key `redis-password` →
    `valkey-password`, and — if you bring your own cache — the Secret
    `<release>-external-redis` → `<release>-external-valkey`. The chart reads
    your existing `<release>-redis` Secret and carries the password across, so
    nothing rotates; the external one is re-rendered from your values (legacy
    `externalRedis:` keys included), so its contents carry across too. Both old
    Secrets are annotated `helm.sh/resource-policy: keep`, so they stay behind
    holding now-unused copies — delete them once the upgrade has stuck. Until
    you do, your own manifests that reference `<release>-external-redis` by name
    keep resolving, but against a copy the chart no longer updates: repoint them
    at `<release>-external-valkey`.
  - Environment: the app now reads `VALKEY_*` and falls back to `REDIS_*`. The
    chart emits both, from the same values and the same secret key, so an app
    image pinned to an older release keeps working.
  - **`extraEnv` overrides need renaming.** If you point at a managed cache with
    `extraEnv: [{name: REDIS_HOST, ...}]` rather than with `externalValkey:`,
    your override is now ignored: the app reads `VALKEY_HOST`, which this chart
    sets to its own cache. Rename those entries to `VALKEY_*` — the chart warns
    on install if it finds chart-wide ones, but it cannot see per-service lists.
  - **The cache and queue restart once.** Renaming the StatefulSet recreates its
    pod, and the bundled cache holds nothing on disk (`appendonly no`, `save ""`,
    no `dir`), so the cache is cold afterwards and BullMQ jobs that were waiting,
    delayed or backing off are gone. Repeatable/cron jobs re-register themselves
    on reconnect. Upgrade at a quiet moment if in-flight telemetry or workflow
    retries matter to you. For the same reason a `persistence.enabled: true`
    volume never held anything: the new StatefulSet takes a fresh
    `data-<release>-valkey-0` and the old `data-<release>-redis-0` can simply be
    deleted to stop paying for it.
  - The Service is also published under its old name, `<release>-redis-master`,
    so pods that have not yet rolled reconnect on their own rather than resolving
    NXDOMAIN for the length of the rollout. Set `valkey.legacyServiceAlias: false`
    to drop it once everything has rolled.
  - See the [upgrading guide](https://oneuptime.com/docs/installation/upgrading)
    for the full 12 -> 13 migration, including how to verify the cache
    afterwards and what a rollback to 12 needs.

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
