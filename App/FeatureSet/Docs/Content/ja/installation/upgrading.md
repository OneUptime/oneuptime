# OneUptime のアップグレード

このガイドでは、セルフホスト版 OneUptime インストールを安全にアップグレードする方法について説明します。

## 一般的なガイダンス

- メジャーバージョンを段階的にアップグレードします（例: 6 → 7 → 8）。メジャーバージョンをスキップしないでください。
- リリースノートに従う限り、マイナーバージョンやパッチバージョンはスキップできます（例: 8.1 → 8.4）。
- アップグレード前に必ずバックアップを取り、復元できることを確認してください。

## OneUptime 11 → 12 へのアップグレード

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

## OneUptime 10 → 11 へのアップグレード

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

OneUptime 11 は ClickHouse のテレメトリーストレージを再構築します。このページでは、何が変わるのか、誰が対応する必要があるのか、そして過去のテレメトリーを引き継ぎたいインストール環境向けに、そのために必要なすべてのクエリを説明します。

### v11 で変わること

テレメトリー(ログ、トレース、メトリクス、例外、プロファイル、モニターログ、監査ログ)は、時間ベースのパーティショニング、列ごとの圧縮コーデック、新しいエンティティモデル列を備えた新しい ClickHouse テーブルへ移行します:

| 旧テーブル            | 新テーブル            |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

すべてのテレメトリーテーブルで 2 つの列名が変更されます: `serviceId` → `primaryEntityId`、`serviceType` → `primaryEntityType`。これは厳格なリネームです — **OneUptime の analytics API を `serviceId`/`serviceType` フィルターで直接クエリしている場合は、新しい名前に更新してください。** OneUptime 内のダッシュボード、モニター、アラートは自動的に移行されます。

この切り替えは**前方専用**です: 新しいテーブルは空の状態で始まり、アップグレード後に取り込まれたテレメトリーはすぐにそこへ入り、履歴は時間の経過とともに自然に埋まっていきます。古いテーブルはディスクを解放するため、アップグレード中に**自動的に削除されます** — 履歴を引き継ぐ選択肢を残したい場合は、アップグレードの**前に**リネームしてください(下記の Step 0)。

> **すでに 11.0.0 または 11.0.1 をお使いですか?** これらのリリースでは古いテーブルは保持されていました(TTL によって徐々に空になり、コピーは「アップグレード後いつでも」実行できました)。それ以降のアップデートは**起動時にそれらを削除します**。履歴のコピーをまだ実行しておらず、これから行いたい場合は、アップデートを適用する前に下記の Step 0 を実行してください。

### 対応が必要なのは誰か

- **新規インストール:** 何もする必要はありません。
- **アップグレード前のテレメトリーを UI で見る必要がないアップグレード:** 何もする必要はありません。テレメトリーページはアップグレード時点以降のデータを表示するだけです。古いテーブルはアップグレード中に削除されます。
- **アップグレード前のテレメトリーを表示したいアップグレード:** アップグレードの**前に**古いテーブルをリネームし(下記の Step 0)、その後いつでも手動コピーを実行してください。

いつもどおり、メジャーバージョンは一つずつアップグレードし(10 → 11、飛ばさない)、アップグレード前に Postgres と ClickHouse のバックアップを取ってください。

### オプション: テレメトリー履歴の引き継ぎ

Step 0 は**アップグレード前**に実行します。Step 1 以降はすべて、**アップグレードが完全に起動した後**に実行します(新しいテーブルとそのマテリアライズドビューが存在している必要があります)。ClickHouse ホスト上で直接接続してください — ネイティブプロトコルには HTTP タイムアウトがないため、数時間かかるステートメントでも問題ありません:

```bash
clickhouse-client --database oneuptime
```

始める前に知っておくべきこと:

- コピーは OneUptime が稼働中でも安全に実行できます。新しいテレメトリーは独立して新しいテーブルに書き込まれ、コピーされた履歴はその背後で埋まっていきます。
- 大規模環境(数百 GB)では数時間かかると見込んでください。
- 以下の各ステートメントは `insert_deduplication_token` を持ち、新しいテーブルには重複排除ウィンドウが備わっています — そのため**途中で失敗したステートメントの再実行は安全です**(挿入済みのブロックはメトリクスのロールアップも含めてスキップされます)。ただし、それなりに早く再実行することが条件です。激しいライブ取り込みの下では、ウィンドウ(テーブルごとの直近 10,000 挿入ブロック)が最終的に古いトークンを追い出します。
- メトリクスのコピーは、事前集計されたダッシュボードのロールアップも自動的に再構築します(コピーされた各行がロールアップのマテリアライズドビューに再供給されます)— このためメトリクスのコピーは他より遅くなります。最後に実行してください。

#### Step 0 — アップグレード前に古いテーブルをリネームする

アップグレードは起動時に古いテーブルを削除するため、コピー元にしたいテーブルを先にその手の届かない場所へ移します。OneUptime を停止し(デプロイメントをゼロにスケール)、何もテーブルへ書き込んだり再作成したりできない状態にしてからリネームします — `RENAME TABLE` は瞬時のメタデータ操作で、`IF EXISTS` によりお使いの環境に存在しなかったテーブルはスキップされます(10.0.x 中盤より古いデプロイメントには `AuditLogV1` や一部の `…V2` テーブルがない場合があります — その場合、そのタイプのコピーすべき履歴は存在しません):

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

その後アップグレードし、続行する前に OneUptime が完全に起動するのを待ちます。

> リネーム後に v10 へロールバックする場合(v10 は起動時に旧名の空テーブルを再作成します)、v10 を再起動する前に `_backup` テーブルを元の名前に戻してください — そうしないと、ロールバック中に取り込まれたテレメトリーが再作成されたテーブルに入り、その後のアップグレードで削除されてしまいます。

#### Step 1 — コピー元のパーティションを列挙する

各旧テーブルのパーティションは最大 16 個です。各コピー元テーブルについて:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — コピーステートメントを生成する

列の構成はインストール環境によって若干異なる場合があります(古いデプロイメントには最近追加された列がないことがあります)。固定のステートメントを貼り付けるのではなく、実際のスキーマからステートメントを生成してください。`WITH` 句の `src` と `dst` を上の表のテーブルペアのいずれかに設定し(コピー元には Step 0 の `_backup` サフィックスが付きます)、実行します:

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

生成されたステートメントは、両テーブルが共有する列のみをコピーし(新しい列はデフォルト値になります)、`serviceId`/`serviceType` をその場でリネームし、再実行時に同一の重複排除可能なブロックが生成されるよう行を決定論的に並べ、このサイズのステートメントに必要な実行時間とパーティション数の制限を解除します。

#### Step 3 — パーティションごとに 1 つずつ実行する

生成されたステートメントの `{PARTITION}`(`WHERE` 内とトークン内の 2 か所に登場)を Step 1 の各パーティション ID に置き換えます。ステートメントを 1 つずつ実行し、その後テーブルペアごとに Step 1–3 を繰り返します。

> 注意: コピー元テーブルがお使いの環境に存在せず Step 0 でスキップされた場合、そのペアの Step 1 は `UNKNOWN_TABLE` で失敗します — そのペアは単にスキップしてください。そのタイプのコピーすべき履歴は存在しません。

ステートメントが途中で失敗した場合は、速やかに**同じ**ステートメントを再実行してください — コミット済みのブロックは重複排除されます。かなり後になってから再実行する場合は、先に行数を比較してください(Step 5)。

#### Step 4(オプション)— ホスト別メトリクスロールアップの履歴

コピーされた生のメトリクス行はサービスレベルのロールアップを自動的に再構築しますが、**ホスト別**ロールアップは再構築しません(古い行にはホストエンティティキーがありません)。Step 0 でリネームした古いロールアップテーブルがこの履歴の唯一のソースです。ホスト名から新しいキーを計算して引き継ぎます:

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

`ORDER BY` は重要です: 再実行時に重複排除トークンが認識できる同一の挿入ブロックを生成します。これがないと、再実行が静かにスキップされたり二重にカウントされたりする可能性があります。(エッジケース: `\`、`|`、`=` を含むホスト名 — RFC 1123 で許可されないホスト名文字 — はアプリケーションと異なるキーを計算します。そのようなホストがあると分かっている場合を除き、無視してください。)

#### Step 5 — 検証する

テーブルペアごとに合計を比較します(新しいテーブルにはアップグレード後の行も含まれるため、古いテーブル以上になるはずです):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — バックアップを削除する

リネームされたテーブルは保持期間の TTL を維持するため、自然に空になり縮小していきます — ただしコピーに満足したら、削除してディスクをすぐに解放してください:

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

(`max_table_size_to_drop = 0` は、そのステートメントに限りサーバーの 50 GB 削除保護を解除します。)

> ヒント: 他のメジャーアップグレードと同様、まずステージング環境でテストし、本番でコピーに依存する前にテレメトリーが新しいテーブルへ流れていることを確認してください。

## OneUptime 9 → 10 へのアップグレード

手動の対応が必要な変更はありません。標準のアップグレード手順に従ってください。

## OneUptime 8 → 9 へのアップグレード

Helm チャートで Kubernetes Ingress リソースのプロビジョニングが不要になりました。OneUptime は TLS の終端、ステータスページドメインの管理、プラットフォームのトラフィックルーティングをすでに処理する Ingress ゲートウェイコンテナを含んでいるため、クラスター Ingress コントローラーは不要になりました。

- アップグレード前に、カスタムの `values.yaml` ファイルから `oneuptimeIngress` のオーバーライドを削除してください。これらのキーは無視されるようになり、残っている場合は検証エラーが発生します。
- `nginx.service.type` が、バンドルされた Ingress ゲートウェイを公開する方法を反映していることを確認してください（例: `LoadBalancer`、`NodePort`、または外部ロードバランサーを持つ `ClusterIP`）。
- ステータスページまたはプライマリホストの DNS レコードが、OneUptime Ingress ゲートウェイの前面にあるサービスまたはロードバランサーを引き続き指していることを確認してください。
- アップグレード後、TLS 証明書が組み込みゲートウェイ経由で更新され続け、ステータスページのドメインが正しく解決されることを確認してください。

## OneUptime 7 → 8 へのアップグレード

Kubernetes で実行している場合、重要な破壊的変更があります。

- [Bitnami ライセンス変更](https://github.com/bitnami/charts/issues/35164) のため、Postgres、Redis、ClickHouse に Bitnami チャートを使用しなくなりました
- これらの変更は後方互換性がありません。Helm チャートの `values.yaml` の新しい構造に従う必要があります。
- アップグレード前にデータ（Postgres、ClickHouse、および永続ボリューム）をバックアップしてください。

> ヒント: まずステージング環境でアップグレードをテストしてください。本番環境をアップグレードする前に、ワークロードが正常であり、データが完全であることを確認してください。
