# 升級 OneUptime

本指南說明如何安全地升級您自行託管的 OneUptime 安裝環境。

## 一般指引

- 跨主要版本時請逐步升級（例如 6 → 7 → 8）。請勿跳過主要版本。
- 只要您依循發行說明，便可跨越多個次要／修補版本（例如 8.1 → 8.4）。
- 升級前請務必進行備份，並驗證您能夠成功還原這些備份。

## 從 OneUptime 11 升級到 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

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

## 從 OneUptime 10 升級到 11

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

OneUptime 11 重建了 ClickHouse 遙測儲存。本頁說明有哪些變更、誰需要採取行動,以及——對於想保留歷史遙測資料的安裝環境——完成這件事所需的每一條查詢。

### v11 的變更

遙測資料(日誌、追蹤、指標、例外、效能分析、監控日誌、稽核日誌)遷移到新的 ClickHouse 資料表,新表採用基於時間的分割、逐欄壓縮編解碼器以及新的實體模型欄位:

| 舊資料表              | 新資料表              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

所有遙測資料表中有兩個欄位被重新命名:`serviceId` → `primaryEntityId`,`serviceType` → `primaryEntityType`。這是硬性重新命名——**如果你直接以 `serviceId`/`serviceType` 篩選條件查詢 OneUptime analytics API,請更新為新名稱。** OneUptime 內部的儀表板、監控器和警示會自動遷移。

這次切換**只向前進行**:新表從空白開始,升級後攝入的所有遙測資料會立即寫入新表,歷史資料隨時間自然回填。舊表會在升級過程中**自動刪除**以回收磁碟空間——如果你想保留遷移歷史資料的選項,請在升級**之前**重新命名它們(見下方步驟 0)。

> **已經在使用 11.0.0 或 11.0.1?** 這些版本會保留舊表(它們透過 TTL 逐漸清空,複製可以「升級後隨時」執行)。之後的任何更新都會**在啟動時刪除它們**。如果你仍想進行歷史資料複製且尚未完成,請在套用更新之前執行下方的步驟 0。

### 誰需要採取行動

- **全新安裝:** 無需任何操作。
- **介面中不需要升級前遙測資料的升級:** 無需任何操作。遙測頁面只顯示升級時刻之後的資料;舊表會在升級過程中被刪除。
- **希望看到升級前遙測資料的升級:** 在升級**之前**重新命名舊表(見下方步驟 0),然後在升級後隨時執行手動複製。

一如既往:主版本要逐級升級(10 → 11,不要跳版),並在升級前備份 Postgres 和 ClickHouse。

### 選用:遷移遙測歷史資料

步驟 0 在**升級之前**執行;從步驟 1 開始的所有操作都在**升級完全啟動之後**執行(新表及其物化檢視必須已存在)。請直接在 ClickHouse 主機上連線——原生協定沒有 HTTP 逾時,因此執行數小時的陳述式也沒有問題:

```bash
clickhouse-client --database oneuptime
```

開始之前需要瞭解:

- 複製可以在 OneUptime 上線運行時安全執行。新的遙測資料獨立寫入新表;複製的歷史資料在其後填充。
- 大規模資料(數百 GB)預計需要數小時。
- 下面每條陳述式都帶有 `insert_deduplication_token`,且新表內建去重視窗——因此**重新執行中途失敗的陳述式是安全的**(已插入的區塊會被跳過,包括指標彙總中的區塊),前提是盡快重試。在高強度即時攝入下,視窗(每表最近 10,000 個插入區塊)最終會淘汰舊權杖。
- 複製指標還會自動重建預先彙總的儀表板彙總(每條複製的列都會重新饋入彙總物化檢視)——這使得指標複製比其他複製更慢;請最後執行。

#### 步驟 0——升級前重新命名舊表

升級會在啟動時刪除舊表,所以請先把你要作為複製來源的表移出它的影響範圍。停止 OneUptime(將部署縮減到零),確保沒有任何程序寫入或能重建這些表,然後重新命名——`RENAME TABLE` 是瞬時的中繼資料操作,`IF EXISTS` 讓整個區塊跳過你的安裝環境從未有過的表(早於 10.0.x 中期的部署可能沒有 `AuditLogV1` 或某些 `…V2` 表——那就沒有該類型的歷史資料可複製):

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

然後執行升級,等 OneUptime 完全啟動後再繼續。

> 如果在重新命名後回滾到 v10(v10 啟動時會以舊名稱重建空表),請在重新啟動 v10 之前把 `_backup` 表改回原名——否則回滾期間攝入的遙測資料會進入重建的表,並在之後的升級中被刪除。

#### 步驟 1——列出來源分割區

每張舊表最多有 16 個分割區。對每張來源表執行:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### 步驟 2——產生複製陳述式

不同安裝環境的欄位集合可能略有差異(較舊的部署可能缺少最近新增的欄位),因此請基於你的實際 schema 產生陳述式,而不是照搬固定陳述式。把 `WITH` 子句中的 `src` 和 `dst` 設定為上表中的一對表(來源表帶有步驟 0 的 `_backup` 後綴),然後執行:

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

產生的陳述式只複製兩張表共有的欄位(新欄位取預設值),即時重新命名 `serviceId`/`serviceType`,對列進行確定性排序以便重試產生完全相同、可去重的區塊,並解除這種規模的陳述式所需的執行時間和分割區數量限制。

#### 步驟 3——逐一分割區執行

取產生的陳述式,將 `{PARTITION}`(出現兩次——在 `WHERE` 和權杖中)替換為步驟 1 得到的每個分割區 id。逐條執行陳述式,然後對每對表重複步驟 1–3。

> 注意:如果某張來源表因在你的安裝環境中不存在而在步驟 0 被跳過,該表對的步驟 1 會以 `UNKNOWN_TABLE` 失敗——直接跳過該表對即可;沒有該類型的歷史資料可複製。

如果陳述式中途失敗,請盡快重新執行**同一條**陳述式——已提交的區塊會被去重。如果間隔很久才重試,請先比較列數(步驟 5)。

#### 步驟 4(選用)——按主機的指標彙總歷史

複製的原始指標列會自動重建服務層級彙總,但不會重建**按主機**的彙總(舊列沒有主機實體鍵)。步驟 0 重新命名的舊彙總表是這部分歷史的唯一來源;透過從主機名稱計算新鍵來遷移它:

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

`ORDER BY` 很重要:它確保重試產生完全相同的插入區塊,從而能被去重權杖識別。沒有它,重試可能被悄悄跳過或重複計算。(邊緣情況:包含 `\`、`|` 或 `=` 的主機名稱——這些不是合法的 RFC 1123 主機名稱字元——計算出的鍵會與應用程式不同;除非你確定有這樣的主機,否則可以忽略。)

#### 步驟 5——驗證

按表對比較總數(新表還包含升級後的列,因此應大於或等於舊表):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### 步驟 6——刪除備份表

重新命名後的表保留其保留期 TTL,因此會自行清空和縮小——但一旦你對複製結果滿意,就刪除它們以立即回收磁碟:

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

(`max_table_size_to_drop = 0` 僅為該條陳述式解除伺服器 50 GB 的刪除保護。)

> 提示:與所有主版本升級一樣,請先在預備環境中測試,並確認遙測資料正流入新表,再於正式環境依賴複製結果。

## 從 OneUptime 9 升級至 10

沒有需要手動處理的變更。只需依循標準升級程序即可。

## 從 OneUptime 8 升級至 9

Helm chart 不再佈建 Kubernetes Ingress 資源。OneUptime 隨附一個 ingress gateway 容器，該容器已負責終止 TLS、管理狀態頁面網域，並為平台路由流量，因此不再需要叢集 ingress controller。

- 升級前，請從您自訂的 `values.yaml` 檔案中移除任何 `oneuptimeIngress` 覆寫設定。這些鍵值現已被忽略，若保留將會造成驗證錯誤。
- 確保 `nginx.service.type` 反映您希望如何公開內建的 ingress gateway（例如 `LoadBalancer`、`NodePort`，或搭配外部負載平衡器的 `ClusterIP`）。
- 確認狀態頁面或主要主機的任何 DNS 記錄仍指向位於 OneUptime ingress gateway 前端的 Service 或負載平衡器。
- 升級後，請確認 TLS 憑證持續透過內嵌 gateway 進行更新，且狀態頁面網域可正確解析。

## 從 OneUptime 7 升級至 8

如果您在 Kubernetes 上執行，將會有重要的破壞性變更：

- 由於 [Bitnami 授權變更](https://github.com/bitnami/charts/issues/35164)，我們不再為 Postgres、Redis 與 ClickHouse 使用 Bitnami charts
- 這些變更不向下相容。您必須依循 Helm chart `values.yaml` 中的新結構。
- 升級前請備份您的資料（Postgres、ClickHouse，以及任何持久性磁碟區）。

> 提示：請先在預備（staging）環境中測試升級。在升級正式環境之前，請確認您的工作負載正常且資料完整無損。
