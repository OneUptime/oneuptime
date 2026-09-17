# OneUptime のアップグレード

このガイドでは、セルフホスト版 OneUptime インストールを安全にアップグレードする方法について説明します。

## 一般的なガイダンス

- メジャーバージョンを段階的にアップグレードします（例: 6 → 7 → 8）。メジャーバージョンをスキップしないでください。
- リリースノートに従う限り、マイナーバージョンやパッチバージョンはスキップできます（例: 8.1 → 8.4）。
- アップグレード前に必ずバックアップを取り、復元できることを確認してください。

## OneUptime 12 → 13 へのアップグレード

OneUptime 13 では、同梱のキャッシュ／キューエンジンが Redis から [Valkey](https://valkey.io) に置き換わりました。Redis 7.4 が BSD ライセンスから離れ、当初からの Redis 開発者の多くが Valkey に移ったためです。Valkey は Redis 7.2 のフォークで、同じプロトコルを話します。ソケットより上の層は何も変わっておらず、希望すれば引き続き本物の Redis やマネージドの Redis 互換サービスを指定できます。

設定するもの一式がその名前に揃いました。設定は `VALKEY_*`、Helm の値は `valkey:` / `externalValkey:`、Kubernetes オブジェクトは `<release>-valkey*` です。**古い名前はすべて引き続き有効**なので、手を加えていない `config.env` や `values.yaml` でもそのままアップグレードでき、動き続けます。編集が必須の設定はなく、移行が必要なデータもありません。キャッシュは信頼できる情報源ではなく、Postgres と ClickHouse には影響しません。

必要な作業は、導入方法によって異なります。

- **Docker Compose:** いつもどおり更新します。ただし重要なオプションが 1 つあります — [Docker Compose でのアップグレード](#docker-compose-でのアップグレード)を参照してください。
- **Helm:** 値の変更は不要ですが、キャッシュ Pod が作り直されて空の状態で戻ります — [Helm でのアップグレード](#helm-でのアップグレード)を参照してください。
- **自分で運用しているキャッシュを OneUptime に指定している場合**（マネージド Redis、ElastiCache、Memorystore、自前の Valkey）: [自分でキャッシュを運用している場合](#自分でキャッシュを運用している場合)をお読みください。これは、気づかないうちにサーバーへ到達しなくなり得る唯一の構成です。
- **Kubernetes のオブジェクト名を前提にしたダッシュボード、アラート、ネットワークポリシー、スクリプトがある場合:** それらの名前は変わります — [Helm でのアップグレード](#helm-でのアップグレード)を参照してください。

### 変わったものと変わらないもの

| | 12 まで | 13 から |
| --- | --- | --- |
| エンジン | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| 設定 | `REDIS_*` | `VALKEY_*` — `REDIS_*` も引き続き読み取り |
| Compose サービス | `redis` | `valkey` — ホスト名 `redis` でも引き続き応答 |
| Helm の値 | `redis:`、`externalRedis:` | `valkey:`、`externalValkey:` — 古いキーも引き続き適用 |
| Kubernetes オブジェクト | `<release>-redis`、`<release>-redis-master` | `<release>-valkey`、`<release>-valkey-master` |
| 生成される Secret | `<release>-redis` の `redis-password` | `<release>-valkey` の `valkey-password` |
| 外部キャッシュの Secret | `<release>-external-redis` | `<release>-external-valkey` |

名称が変わった設定は `VALKEY_HOST`、`VALKEY_PORT`、`VALKEY_DB`、`VALKEY_USERNAME`、`VALKEY_PASSWORD`、`VALKEY_IP_FAMILY`、`VALKEY_TLS_CA`、`VALKEY_TLS_CERT`、`VALKEY_TLS_KEY`、`VALKEY_TLS_SENTINEL_MODE` の 10 個です。両方の表記が存在する場合、アプリケーションは `VALKEY_*` を優先します。Helm チャートは逆で、従来の `redis:` キーが新しい既定値より優先されるため、一度も編集していない値ファイルはこれまでとまったく同じ挙動になります。

**キャッシュは 1 回だけ再起動します。** コンテナが置き換わるため、どちらの導入方法でも同じです。ディスクには何も保持しないので（`appendonly no`、`save ""`）、空の状態で戻ります。キャッシュ済みの値は失われ、待機中・遅延中・バックオフ中だった BullMQ ジョブも失われます。繰り返しジョブと cron ジョブは再接続時に自動で登録し直されます。処理中のテレメトリーやワークフローの再試行が重要なら、負荷の低い時間帯にアップグレードしてください。

### Docker Compose でのアップグレード

通常の更新手順だけで十分です。

```
git checkout release # release ブランチにいることを確認してください。
git pull
npm run update
```

- **Compose を手動で実行する場合は `--remove-orphans` を付けてください。** `npm run update` と `npm run start` はすでに付けており、これが古い `redis` コンテナを削除します。動かしたままにすると 2 つのコンテナがホスト名 `redis` に応答し、接続がランダムに古い方へ届きます。
- **`config.env` は書き換えられません。** `npm run update` は通常、`config.example.env` にあってお使いのファイルにない設定を追記しますが、この 10 個は改名として認識し、`REDIS_PASSWORD` を含めて値をそのままの場所に残します。どれを保持したかも出力します。
- 自分のキーを `VALKEY_*` に改名するのは任意で、あとから行っても問題ありません。1 つの設定につき表記は 1 つだけにしてください。
- **`docker-compose.override.yml` でキャッシュ変数を設定している場合は `VALKEY_*` に改名してください。** ベースファイルはお使いの `REDIS_HOST` から `VALKEY_HOST` を設定するようになり、アプリケーションは `VALKEY_HOST` を先に読むため、`REDIS_HOST` だけを設定するオーバーライドはもう優先されません。

### Helm でのアップグレード

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **値の変更は不要です。** `redis:` と `externalRedis:` は引き続き機能し、そこに書いた内容は `valkey:` / `externalValkey:` の新しい既定値に重ねられます。`helm upgrade` は見つかった古いキーを列挙する `DEPRECATED VALUES` の通知を表示します。都合のよいときに改名してください。
- **ローテーションは起きません。** チャートは既存の `<release>-redis` Secret からパスワードを読み取り、新しく生成する代わりに `<release>-valkey` へ引き継ぎます。
- **古い Secret は 2 つとも残ります。** `<release>-redis` と、自前のキャッシュを使っている場合は `<release>-external-redis` に `helm.sh/resource-policy: keep` が付いているため、使われないコピーとして残ります。アップグレードが安定したら削除してかまいませんが、先に[12 へのロールバック](#12-へのロールバック)をお読みください。
- **オブジェクト名が変わります。** `<release>-redis` や `<release>-redis-master` に依存しているもの、つまり Grafana ダッシュボード、アラートルール、NetworkPolicy、ServiceMonitor、バックアップジョブを更新してください。
- Service は旧名 `<release>-redis-master` でも公開されるため、まだ入れ替わっていない Pod は名前解決に失敗し続けることなく自力で再接続できます。すべてのワークロードが入れ替わったら `valkey.legacyServiceAlias: false` を設定して取り除いてください。
- **`persistence.enabled: true` にしていた場合**、新しい StatefulSet は新規ボリューム `data-<release>-valkey-0` を要求します。古い `data-<release>-redis-0` には何も入っていなかったので、課金を止めるために削除してください。

### 自分でキャッシュを運用している場合

OneUptime 自身が起動しないキャッシュを指定する構成は引き続き完全にサポートされ、接続先のサーバーは Valkey でも Redis でもマネージドの Redis 互換サービスでもかまいません。変わったのは、それを設定するブロックの名前です。

- 値ファイルの `externalRedis:` を `externalValkey:` に改名してください。任意です（古いキーも引き続き適用されます）が、チャートが現在ドキュメント化しているのはこちらです。
- チャートは Secret を新しい名前 `<release>-external-valkey` で作り直します。古い `<release>-external-redis` は残りますが更新されなくなるため、自分のマニフェストが名前で参照している場合は向き先を変えてください。
- **`extraEnv` によるオーバーライドはキャッシュに届かなくなります。しかも無言で失敗します。** `externalValkey:` ブロックではなく `extraEnv: [{name: REDIS_HOST, ...}]` でマネージドキャッシュを指定している場合、その項目は今も `REDIS_HOST` の枠を取りますが、アプリケーションは `VALKEY_HOST` を先に読み、チャートはそこにクラスター内の自前キャッシュを設定します。つまりオーバーライドは Pod 仕様に存在したまま無視されます。これらの項目を `VALKEY_*` に改名するか、サポートされている方法である `externalValkey:` に設定を移してください。`helm upgrade` はチャート全体の `extraEnv` 項目については警告しますが、サービスごとの `<service>.extraEnv` は見えないので自分で確認してください。Compose での同等物は、`REDIS_HOST` だけを設定するオーバーライドファイルです。

### アップグレードの確認

- **管理ダッシュボード → Health → Valkey** に「Connected」とメモリ量が表示されるはずです。これはヘルス警告メールが使うのと同じ到達性チェックです。
- **Compose:** `docker compose ps` に `valkey` サービスが表示され、`redis` コンテナは表示されません。
- **Helm:** `kubectl get pods,svc -n <namespace>` で `<release>-valkey-0` が Running になり、Service `<release>-valkey-master` が見えます。`helm get notes my-oneuptime` でアップグレード時の通知を再表示できます。
- さらに詳しく見るには、`HelmChart/Public/diagnose.sh` がキャッシュのメモリ、エビクション、接続性を報告します。新旧どちらのオブジェクト名も理解します。

### 12 へのロールバック

- **Helm:** `helm rollback` は機能します。12 のチャートは自分が作成した `<release>-redis` Secret がそのまま残っているのを見つけ、そのパスワードを再利用するからです。古い Secret を残しているのはこのためです。13 に留まると確信できるまで削除しないでください。
- **Docker Compose:** 確信が持てるまでは `config.env` の表記を `REDIS_*` のままにしてください。OneUptime 12 は `REDIS_*` しか読まないため、キーを改名した `config.env` のままロールバックすると、キャッシュはパスワード未設定で起動して Compose ネットワーク上に開かれ、一方でアプリケーションは認証できません。両方の表記を同じ値で残しておく方法も有効です。
- ロールバックでもキャッシュはもう一度再起動し、同じコールドスタートの代償が生じます。

### あえて Redis のままにした名前

これらは見落としではなく、どれも対応は不要です。

- **API の形は変わりません。** インスタンスのヘルス応答に含まれる `components.redis` と `summary.redis`、ルート `/api/admin/health/redis`、管理画面のクエリコンソールにあるエンジン値 `redis` は、表示テキストではなくプロトコル上のキーです。これらを対象に組んだスクリプトはそのまま動きます。
- **Redis プロトコルの用語:** `redis-cli`、`INFO` の `redis_version` フィールド、そしてヘルス通知が比較に使う保存済みのメモリ基準値。このキーを改名すると、各インスタンスの履歴が失われます。
- **既定のホスト名は今も `redis` です。** 手書きのマニフェストや素の `docker run` 構成のためです。`VALKEY_HOST` も `REDIS_HOST` も設定されていないときにだけ使われ、当社の Compose や Helm ではその状況は起きません。
- 内部のクラス名と Postgres の列名。誰の目にも触れず、改名にはマイグレーションのコストがかかるだけです。

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
toggled per Runner in the dashboard: **Runbook を実行** (on by default),
**AI コード修正を実行** (off by default), and **AI 修復コマンドを実行** (off by
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

(Or open the Runner in **設定 → Runbook エージェント** and use **セットアップ手順を表示**
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

The **設定 → AI → AI エージェント** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **設定 → Runbook エージェント** and install it with the
   command from **セットアップ手順を表示**.
2. Enable **AI コード修正を実行** on it. The change is picked up on the next
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
| Runners (was "Agents")  | Runbook → 設定 → エージェント (`…/runbooks/settings/agents`) | 設定 → Runbook エージェント (`…/settings/runners`) |
| Runner Credentials      | Runbook → 設定 → 認証情報 (`…/runbooks/settings/credentials`)         | 設定 → Runner Credentials (`…/settings/runner-credentials`)     |
| AI Agents               | 設定 → AI → AI エージェント (`…/settings/ai-agents`) | Removed — Runners with the **AI コード修正を実行** capability replace it |

Runbook Secrets stays where it was, under Runbook → 設定 → シークレット.

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
- **OpenID Connect（OIDC）** — both project login and status-page login
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
