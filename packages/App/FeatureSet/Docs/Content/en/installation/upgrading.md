# Upgrading OneUptime

This guide covers how to safely upgrade your self-hosted OneUptime installation.

## General Guidance

- Upgrade step-by-step across major versions (for example, 6 → 7 → 8). Do not skip major versions.
- You can leapfrog minor/patch versions (for example, 8.1 → 8.4) as long as you follow the release notes.
- Always take backups before upgrading, and validate you can restore them.

## Upgrading from OneUptime 12 → 13

OneUptime 13 replaces Redis with [Valkey](https://valkey.io) as the bundled
cache and queue engine. Redis 7.4 left the BSD licence and most of the original
Redis contributors moved to Valkey, which is a fork of Redis 7.2 and speaks the
same wire protocol. Nothing above the socket changed — and you can still point
OneUptime at a real Redis, or at a managed Redis-compatible service, if you
prefer.

Everything you configure is now named for it: the settings are `VALKEY_*`, the
Helm values are `valkey:` / `externalValkey:`, and the Kubernetes objects are
`<release>-valkey*`. **Every old name still works**, so an untouched
`config.env` or `values.yaml` upgrades and keeps running. There is no
configuration you are required to edit, and no data to migrate — the cache is
not a source of truth, and Postgres and ClickHouse are untouched.

What you need to do depends on how you deployed:

- **Docker Compose:** upgrade the usual way, with one flag that matters — see
  [Docker Compose upgrades](#docker-compose-upgrades).
- **Helm:** no values change, but the cache pod is recreated and comes back
  empty — see [Helm upgrades](#helm-upgrades).
- **You point OneUptime at a cache you run yourself** (managed Redis,
  ElastiCache, Memorystore, your own Valkey): read [If you run your own
  cache](#if-you-run-your-own-cache). This is the one setup that can quietly
  stop reaching your server.
- **You have dashboards, alerts, network policies or scripts keyed on the
  Kubernetes object names:** those names change — see
  [Helm upgrades](#helm-upgrades).

### What changed, and what did not

| | Until 12 | From 13 |
| --- | --- | --- |
| Engine | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| Settings | `REDIS_*` | `VALKEY_*` — `REDIS_*` still read |
| Compose service | `redis` | `valkey` — still answers to the hostname `redis` |
| Helm values | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — old keys still applied |
| Kubernetes objects | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| Generated Secret | `redis-password` in `<release>-redis` | `valkey-password` in `<release>-valkey` |
| External cache Secret | `<release>-external-redis` | `<release>-external-valkey` |

The ten renamed settings are `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`,
`VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`,
`VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` and `VALKEY_TLS_SENTINEL_MODE`. Where a
setting is present under both spellings the app prefers the `VALKEY_*` one. The
Helm chart resolves the collision the other way round: a legacy `redis:` key
wins over the new default, so a values file you never touched keeps behaving
exactly as it did.

**The cache restarts once**, on both deployment paths, because the container is
replaced. It holds nothing on disk (`appendonly no`, `save ""`), so it comes
back cold: cached values are gone, and BullMQ jobs that were waiting, delayed or
backing off are lost. Repeatable and cron jobs re-register themselves on
reconnect. Upgrade at a quiet moment if in-flight telemetry or workflow retries
matter to you.

### Docker Compose upgrades

The standard update is all you need:

```
git checkout release # Please make sure you're on release branch.
git pull
npm run update
```

- **Use `--remove-orphans` if you run compose by hand.** `npm run update` and
  `npm run start` already pass it, and it is what removes the old `redis`
  container. Leave that container running and two containers answer to the
  hostname `redis` — connections land on the stale one at random.
- **Your `config.env` is not rewritten.** `npm run update` normally appends any
  setting it finds in `config.example.env` and your file lacks, but it
  recognises these ten as renames and leaves your values — including your
  `REDIS_PASSWORD` — exactly where they are. It prints which ones it kept.
- Renaming your own keys to `VALKEY_*` is optional and safe to do later. Set
  only one spelling per setting.
- **If you set cache variables in a `docker-compose.override.yml`, rename them
  to `VALKEY_*`.** The base file now sets `VALKEY_HOST` from your `REDIS_HOST`,
  and the app reads `VALKEY_HOST` first, so an override that sets only
  `REDIS_HOST` no longer wins.

### Helm upgrades

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **No values change is needed.** `redis:` and `externalRedis:` still work —
  whatever you set under them is layered on top of the new `valkey:` /
  `externalValkey:` defaults — and `helm upgrade` prints a `DEPRECATED VALUES`
  notice listing the old keys it found. Rename them when convenient.
- **Nothing rotates.** The chart reads the password out of your existing
  `<release>-redis` Secret and carries it into `<release>-valkey`, rather than
  minting a new one.
- **Both old Secrets are kept.** `<release>-redis` and, if you bring your own
  cache, `<release>-external-redis` are annotated
  `helm.sh/resource-policy: keep`, so they stay behind holding now-unused
  copies. Delete them once the upgrade has stuck — but read
  [Rolling back](#rolling-back-to-12) first.
- **Object names change.** Update anything keyed on `<release>-redis` or
  `<release>-redis-master`: Grafana dashboards, alert rules, NetworkPolicies,
  ServiceMonitors, backup jobs.
- The Service is also published under its old name, `<release>-redis-master`,
  so pods that have not rolled yet reconnect on their own instead of resolving
  nothing for the length of the rollout. Set `valkey.legacyServiceAlias: false`
  to drop it once every workload has rolled.
- **If you had `persistence.enabled: true`**, the new StatefulSet claims a fresh
  `data-<release>-valkey-0` volume. The old `data-<release>-redis-0` never held
  anything, so delete it to stop paying for it.

### If you run your own cache

Pointing OneUptime at a cache it does not run is still fully supported, and the
server on the other end can be Valkey, Redis, or a managed Redis-compatible
service. What changes is the name of the block that configures it.

- Rename `externalRedis:` to `externalValkey:` in your values file. Optional —
  the old key is still applied — but it is what the chart documents now.
- The chart re-renders the Secret under the new name, `<release>-external-valkey`.
  The old `<release>-external-redis` is kept and no longer updated, so if any of
  your own manifests reference it by name, repoint them.
- **`extraEnv` overrides stop reaching the cache — this one fails silently.** If
  you point at a managed cache with `extraEnv: [{name: REDIS_HOST, ...}]`
  instead of the `externalValkey:` block, your entry still wins the `REDIS_HOST`
  slot, but the app now reads `VALKEY_HOST` first — and the chart sets that to
  its own in-cluster cache. Your override is present in the pod spec and
  ignored. Rename those entries to `VALKEY_*`, or move the settings into
  `externalValkey:`, which is the supported way. `helm upgrade` warns about
  chart-wide `extraEnv` entries; it cannot see per-service
  `<service>.extraEnv` lists, so check those yourself. The Compose equivalent is
  an override file that sets only `REDIS_HOST`.

### Verify the upgrade

- **Admin Dashboard → Health → Valkey** should read Connected, with a memory
  figure. This is the same reachability check the health warning emails use.
- **Compose:** `docker compose ps` lists a `valkey` service and no `redis`
  container.
- **Helm:** `kubectl get pods,svc -n <namespace>` shows `<release>-valkey-0`
  Running and the `<release>-valkey-master` Service. Run
  `helm get notes my-oneuptime` to replay the deprecation notices the upgrade
  printed.
- For a deeper look, `HelmChart/Public/diagnose.sh` reports cache memory,
  evictions and connectivity, and understands both the old and new object names.

### Rolling back to 12

- **Helm:** `helm rollback` works, because the 12 chart finds the
  `<release>-redis` Secret it created still in place and reuses its password.
  This is why the old Secrets are kept — do not delete them until you are
  confident you are staying on 13.
- **Docker Compose:** keep the `REDIS_*` spelling in `config.env` until you are
  confident. OneUptime 12 reads only `REDIS_*`, so rolling back a `config.env`
  whose keys you renamed leaves the cache with no configured password, and it
  starts wide open on the compose network with the app unable to authenticate.
  Keeping both spellings, with identical values, also works.
- Rolling back restarts the cache again, with the same cold-start cost.

### Names that stayed Redis on purpose

These are not oversights, and none of them need action:

- **The API keeps its shape.** `components.redis` and `summary.redis` in the
  instance health payload, the `/api/admin/health/redis` route, and the `redis`
  engine value in the admin Query Console are wire keys, not display text.
  Anything you have scripted against them keeps working.
- **Redis-protocol vocabulary:** `redis-cli`, the `redis_version` field in
  `INFO`, and the stored memory-baseline key that the health notifications
  compare against. Renaming that key would discard every instance's history.
- **The default hostname is still `redis`**, for hand-written manifests and bare
  `docker run` setups. It is only used when neither `VALKEY_HOST` nor
  `REDIS_HOST` is set, which never happens in our own Compose or Helm.
- Internal class names and Postgres column names, which no reader sees and whose
  rename would cost a migration.

## Upgrading from OneUptime 11 → 12

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Settings → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Settings → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `update.sh` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Upgrading from OneUptime 10 → 11

OneUptime 11 has two changes that need your attention before you upgrade:

1. **Identity features (SSO, OIDC, SCIM) moved to the Enterprise Edition** —
   if you sign in with SSO on a self-hosted Community build, read this first.
2. **The ClickHouse telemetry storage was rebuilt** — relevant if you want to
   carry historical telemetry forward.

This page explains both — what changes, who needs to act, and (for the
telemetry rebuild) every query needed to migrate history.

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

### What changes in v11 (telemetry storage)

Telemetry (logs, traces, metrics, exceptions, profiles, monitor logs,
audit logs) moves to new ClickHouse tables with time-based partitioning,
per-column compression codecs, and the new entity-model columns:

| Old table             | New table             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Two columns are renamed on every telemetry table: `serviceId` →
`primaryEntityId` and `serviceType` → `primaryEntityType`. This is a hard
rename — **if you query the OneUptime analytics API directly with
`serviceId`/`serviceType` filters, update them to the new names.**
Dashboards, monitors, and alerts inside OneUptime are migrated
automatically.

The cut is **forward-only**: the new tables start empty, all telemetry
ingested after the upgrade lands in them immediately, and history fills
back in naturally as time passes. The old tables are **dropped
automatically** during the upgrade to reclaim their disk — if you want
the option of carrying history forward, rename them **before**
upgrading (Step 0 below).

> **Already on 11.0.0 or 11.0.1?** Those releases kept the old tables
> (they drained via TTL, and the copy could be run "any time after the
> upgrade"). Any later update **drops them at boot**. If you still want
> the history copy and have not done it yet, run Step 0 below before
> applying the update.

### Who needs to do anything

- **Fresh installations:** nothing to do.
- **Upgrades that don't need pre-upgrade telemetry in the UI:** nothing to
  do. Telemetry pages simply show data from the upgrade moment onward;
  the old tables are dropped during the upgrade.
- **Upgrades that want pre-upgrade telemetry visible:** rename the old
  tables **before** the upgrade (Step 0 below), then run the manual copy
  any time after it.

As always: upgrade major versions step-by-step (10 → 11, do not skip),
and take backups of Postgres and ClickHouse before upgrading.

### Optional: carry telemetry history forward

Step 0 runs **before the upgrade**; everything from Step 1 on runs
**after the upgrade has fully booted** (the new tables and their
materialized views must exist). Connect directly on your ClickHouse
host — the native protocol has no HTTP timeouts, so multi-hour statements
are fine:

```bash
clickhouse-client --database oneuptime
```

Good to know before starting:

- The copy is safe to run while OneUptime is live. New telemetry writes
  to the new tables independently; copied history fills in behind it.
- Expect hours at large scale (hundreds of GB).
- Every statement below carries an `insert_deduplication_token`, and the
  new tables ship with a deduplication window — so **re-running a
  statement that failed partway is safe** (already-inserted blocks are
  skipped, including in the metric rollups), provided you re-run it
  reasonably soon. Under heavy live ingest the window (last 10,000 insert
  blocks per table) eventually evicts old tokens.
- Copying metrics also rebuilds the pre-aggregated dashboard rollups
  automatically (each copied row re-feeds the rollup materialized views)
  — this makes the metric copy slower than the others; run it last.

#### Step 0 — before upgrading, rename the old tables

The upgrade drops the old tables at boot, so move the ones you want to
copy from out of its reach first. Stop OneUptime (scale the deployment
down) so nothing is writing to or able to recreate them, then rename —
`RENAME TABLE` is an instant metadata operation, and `IF EXISTS` lets
the batch skip tables your installation never had (deployments older
than mid-10.0.x may lack `AuditLogV1` or some `…V2` tables entirely —
there is no history of that type to copy):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Then upgrade and let OneUptime boot fully before continuing.

> If you roll back to v10 after renaming (v10 recreates empty old-name
> tables at boot), rename the `_backup` tables back to their original
> names before restarting v10 — otherwise telemetry ingested during the
> rollback lands in the recreated tables and is dropped at the eventual
> upgrade.

#### Step 1 — list the source partitions

Each old table has at most 16 partitions. For each source table:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — generate the copy statement

Column sets can differ slightly between installations (older deployments
may lack recently added columns), so generate the statement from your
live schema rather than copy-pasting a fixed one. Set `src` and `dst` in
the `WITH` clause to one of the table pairs from the table above (the
source carries the `_backup` suffix from Step 0), and run:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

The generated statement copies only the columns both tables share (new
columns take their defaults), renames `serviceId`/`serviceType` on the
fly, orders rows deterministically so a retry produces identical,
deduplicatable blocks, and lifts the execution-time and partition-count
limits that a statement this size needs.

#### Step 3 — run it, one partition at a time

Take the generated statement and substitute `{PARTITION}` (it appears
twice — in the `WHERE` and in the token) with each partition id from
Step 1. Run the statements one at a time, then repeat Steps 1–3 for each
table pair.

> Note: if a source table was skipped in Step 0 because it did not exist
> on your installation, Step 1 fails with `UNKNOWN_TABLE` for that pair —
> simply skip the pair; there is no history of that type to copy.

If a statement fails partway, re-run the **same** statement promptly —
already-committed blocks deduplicate. If re-running much later, compare
row counts first (Step 5).

#### Step 4 (optional) — per-host metric rollup history

Copied raw metric rows rebuild the service-level rollups automatically,
but not the **per-host** rollup (old rows have no host entity key). The
renamed old rollup table from Step 0 is the only source for this
history; carry it forward by computing the new key from the hostname:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

The `ORDER BY` matters: it makes a re-run produce identical insert blocks
so the deduplication token can recognize them. Without it, a retry could
be silently skipped or double-counted. (Edge case: hostnames containing
`\`, `|`, or `=` — not legal RFC-1123 hostname characters — would compute
a different key than the application; ignore unless you know you have
such hosts.)

#### Step 5 — verify

Compare totals per table pair (the new table also contains post-upgrade
rows, so it should be greater than or equal to the old one):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — drop the backups

The renamed tables keep their retention TTL, so they drain and shrink by
themselves — but once you are satisfied with the copy, drop them to
reclaim the disk immediately:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` lifts the server's 50 GB drop protection
for that one statement.)

> Tip: as with every major upgrade, test in a staging environment first
> and confirm telemetry is flowing into the new tables before relying on
> the copy in production.

## Upgrading from OneUptime 9 → 10

No changes that require manual action. Just follow the standard upgrade process.

## Upgrading from OneUptime 8 → 9

The Helm chart no longer provisions a Kubernetes Ingress resource. OneUptime ships an ingress gateway container that already terminates TLS, manages status page domains, and routes traffic for the platform, so a cluster ingress controller is no longer necessary.

- Remove any `oneuptimeIngress` overrides from your custom `values.yaml` files before upgrading. Those keys are now ignored and will cause validation errors if left in place.
- Ensure `nginx.service.type` reflects how you want to expose the bundled ingress gateway (for example `LoadBalancer`, `NodePort`, or `ClusterIP` with an external load balancer).
- Verify any DNS records for status pages or primary hosts still point to the Service or load balancer that fronts the OneUptime ingress gateway.
- After the upgrade, confirm TLS certificates continue to renew via the embedded gateway and that status page domains resolve correctly.

## Upgrading from OneUptime 7 → 8

If you're running on Kubernetes, there are important breaking changes:

- We no longer use Bitnami charts for Postgres, Redis, and ClickHouse because of [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164)
- These changes are not backward compatible. You must follow the new structure in the Helm chart `values.yaml`.
- Backup your data (Postgres, ClickHouse, and any persistent volumes) before upgrading.

> Tip: Test the upgrade in a staging environment first. Confirm your workloads are healthy and data is intact before upgrading production.
