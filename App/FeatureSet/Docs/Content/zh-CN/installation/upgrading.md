# 升级 OneUptime

本指南介绍如何安全地升级您的自托管 OneUptime 安装。

## 通用指南

- 跨主版本逐步升级（例如 6 → 7 → 8）。不要跳过主版本。
- 只要遵循发布说明，您可以跨越次要/补丁版本（例如 8.1 → 8.4）。
- 升级前务必做好备份，并验证可以从备份中恢复。

## 从 OneUptime 11 升级到 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **执行运行手册** (on by default),
**执行 AI 代码修复** (off by default), and **执行 AI 补救命令** (off by
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

(Or open the Runner in **设置 → Runbook 代理** and use **显示设置说明**
for a pre-filled command.)

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

The **设置 → 人工智能 → AI 代理** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **设置 → Runbook 代理** and install it with the
   command from **显示设置说明**.
2. Enable **执行 AI 代码修复** on it. The change is picked up on the next
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
| Runners (was "Agents")  | 运行手册 → 设置 → 代理 (`…/runbooks/settings/agents`) | 设置 → Runbook 代理 (`…/settings/runners`)      |
| Runner Credentials      | 运行手册 → 设置 → 凭据 (`…/runbooks/settings/credentials`) | 设置 → Runner Credentials (`…/settings/runner-credentials`)                |
| AI Agents               | 设置 → 人工智能 → AI 代理 (`…/settings/ai-agents`) | Removed — Runners with the **执行 AI 代码修复** capability replace it   |

Runbook Secrets stays where it was, under 运行手册 → 设置 → 密钥.

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

## 从 OneUptime 10 升级到 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

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

OneUptime 11 重建了 ClickHouse 遥测存储。本页说明发生了哪些变化、谁需要采取行动,以及——对于想保留历史遥测数据的安装环境——完成迁移所需的每一条查询。

### v11 中的变化

遥测数据(日志、链路追踪、指标、异常、性能分析、监控日志、审计日志)迁移到新的 ClickHouse 表,新表采用基于时间的分区、按列压缩编解码器以及新的实体模型列:

| 旧表                  | 新表                  |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

所有遥测表中有两列被重命名:`serviceId` → `primaryEntityId`,`serviceType` → `primaryEntityType`。这是硬性重命名——**如果你直接使用 `serviceId`/`serviceType` 过滤条件查询 OneUptime analytics API,请更新为新名称。** OneUptime 内部的仪表盘、监控器和告警会自动迁移。

此次切换**只向前进行**:新表从空开始,升级后摄入的所有遥测数据会立即写入新表,历史数据随时间自然回填。旧表会在升级过程中**自动删除**以回收磁盘空间——如果你想保留迁移历史数据的选项,请在升级**之前**重命名它们(见下方第 0 步)。

> **已经在使用 11.0.0 或 11.0.1?** 这些版本会保留旧表(它们通过 TTL 逐渐清空,复制可以"升级后随时"执行)。之后的任何更新都会**在启动时删除它们**。如果你仍想进行历史数据复制且尚未完成,请在应用更新之前执行下方的第 0 步。

### 谁需要采取行动

- **全新安装:** 无需任何操作。
- **界面中不需要升级前遥测数据的升级:** 无需任何操作。遥测页面只显示升级时刻之后的数据;旧表会在升级过程中被删除。
- **希望看到升级前遥测数据的升级:** 在升级**之前**重命名旧表(见下方第 0 步),然后在升级后随时执行手动复制。

一如既往:主版本要逐级升级(10 → 11,不要跳级),并在升级前备份 Postgres 和 ClickHouse。

### 可选:迁移遥测历史数据

第 0 步在**升级之前**执行;从第 1 步开始的所有操作都在**升级完全启动之后**执行(新表及其物化视图必须已存在)。请直接在 ClickHouse 主机上连接——原生协议没有 HTTP 超时,因此运行数小时的语句也没有问题:

```bash
clickhouse-client --database oneuptime
```

开始之前需要了解:

- 复制可以在 OneUptime 在线运行时安全执行。新的遥测数据独立写入新表;复制的历史数据在其后填充。
- 大规模数据(数百 GB)预计需要数小时。
- 下面每条语句都带有 `insert_deduplication_token`,且新表自带去重窗口——因此**重新运行中途失败的语句是安全的**(已插入的块会被跳过,包括指标汇总中的块),前提是尽快重试。在高强度实时摄入下,窗口(每表最近 10,000 个插入块)最终会淘汰旧令牌。
- 复制指标还会自动重建预聚合的仪表盘汇总(每条复制的行都会重新馈入汇总物化视图)——这使得指标复制比其他复制更慢;请最后执行。

#### 第 0 步——升级前重命名旧表

升级会在启动时删除旧表,所以请先把你要作为复制来源的表移出它的作用范围。停止 OneUptime(将部署缩容到零),确保没有任何进程写入或能重建这些表,然后重命名——`RENAME TABLE` 是瞬时的元数据操作,`IF EXISTS` 让整个语句块跳过你的安装环境从未有过的表(早于 10.0.x 中期的部署可能没有 `AuditLogV1` 或某些 `…V2` 表——那就没有该类型的历史数据可复制):

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

然后执行升级,等 OneUptime 完全启动后再继续。

> 如果在重命名后回滚到 v10(v10 启动时会用旧名称重建空表),请在重启 v10 之前把 `_backup` 表改回原名——否则回滚期间摄入的遥测数据会进入重建的表,并在之后的升级中被删除。

#### 第 1 步——列出来源分区

每张旧表最多有 16 个分区。对每张来源表执行:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### 第 2 步——生成复制语句

不同安装环境的列集合可能略有差异(较旧的部署可能缺少最近新增的列),因此请基于你的实际 schema 生成语句,而不是照搬固定语句。把 `WITH` 子句中的 `src` 和 `dst` 设置为上表中的一对表(来源表带有第 0 步的 `_backup` 后缀),然后运行:

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

生成的语句只复制两张表共有的列(新列取默认值),即时重命名 `serviceId`/`serviceType`,对行进行确定性排序以便重试产生完全相同、可去重的块,并解除这种规模的语句所需的执行时间和分区数量限制。

#### 第 3 步——逐个分区执行

取生成的语句,将 `{PARTITION}`(出现两次——在 `WHERE` 和令牌中)替换为第 1 步得到的每个分区 id。逐条执行语句,然后对每对表重复第 1–3 步。

> 注意:如果某张来源表因在你的安装环境中不存在而在第 0 步被跳过,该表对的第 1 步会以 `UNKNOWN_TABLE` 失败——直接跳过该表对即可;没有该类型的历史数据可复制。

如果语句中途失败,请尽快重新运行**同一条**语句——已提交的块会被去重。如果间隔很久才重试,请先比较行数(第 5 步)。

#### 第 4 步(可选)——按主机的指标汇总历史

复制的原始指标行会自动重建服务级汇总,但不会重建**按主机**的汇总(旧行没有主机实体键)。第 0 步重命名的旧汇总表是这部分历史的唯一来源;通过从主机名计算新键来迁移它:

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

`ORDER BY` 很重要:它确保重试产生完全相同的插入块,从而能被去重令牌识别。没有它,重试可能被悄悄跳过或重复计数。(边缘情况:包含 `\`、`|` 或 `=` 的主机名——这些不是合法的 RFC 1123 主机名字符——计算出的键会与应用程序不同;除非你确定有这样的主机,否则可以忽略。)

#### 第 5 步——验证

按表对比较总数(新表还包含升级后的行,因此应大于或等于旧表):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 第 6 步——删除备份表

重命名后的表保留其保留期 TTL,因此会自行清空和收缩——但一旦你对复制结果满意,就删除它们以立即回收磁盘:

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

(`max_table_size_to_drop = 0` 仅为该条语句解除服务器 50 GB 的删除保护。)

> 提示:与所有主版本升级一样,请先在预发布环境中测试,并确认遥测数据正流入新表,再在生产环境中依赖复制结果。

## 从 OneUptime 9 升级到 10

没有需要手动操作的变更。按照标准升级流程操作即可。

## 从 OneUptime 8 升级到 9

Helm 图表不再配置 Kubernetes Ingress 资源。OneUptime 内置了一个 ingress 网关容器，该容器已经负责终止 TLS、管理状态页面域名并路由平台流量，因此不再需要集群 ingress 控制器。

- 在升级前，从您的自定义 `values.yaml` 文件中删除所有 `oneuptimeIngress` 覆盖项。这些键现在已被忽略，如果保留会导致验证错误。
- 确保 `nginx.service.type` 反映您希望暴露捆绑的 ingress 网关的方式（例如 `LoadBalancer`、`NodePort`，或带有外部负载均衡器的 `ClusterIP`）。
- 验证状态页面或主机的所有 DNS 记录是否仍指向 OneUptime ingress 网关前端的 Service 或负载均衡器。
- 升级后，确认 TLS 证书通过嵌入式网关继续续期，并且状态页面域名可正常解析。

## 从 OneUptime 7 升级到 8

如果您在 Kubernetes 上运行，存在重要的破坏性变更：

- 我们不再使用 Bitnami 图表用于 Postgres、Redis 和 ClickHouse，原因是 [Bitnami 许可证变更](https://github.com/bitnami/charts/issues/35164)
- 这些变更不向后兼容。您必须遵循 Helm 图表 `values.yaml` 中的新结构。
- 在升级前备份您的数据（Postgres、ClickHouse 和任何持久化卷）。

> 提示：先在预发布环境中测试升级。在升级生产环境之前，确认您的工作负载健康且数据完整。
