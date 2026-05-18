# Runbook の設定と安全性

## Bash と JavaScript の実際の動き方

Bash と JavaScript ステップは **OneUptime ワーカー上で実行されません**。これらは特定の [Runbook エージェント](/docs/runbooks/agents) — お客様自身のインフラ内のホストにインストールする小さなプロセス — にジョブとしてディスパッチされます。

ディスパッチモデル:

1. Runbook ステップの作成者がステップを書くときにドロップダウンから Runbook エージェントを選択します。
2. ステップが動くとき、ワーカーは `RunbookAgentJob` に `targetAgentId` をそのエージェントの ID にし、ステータスを `Pending` にした行を挿入します。
3. その特定のエージェント (そしてそのエージェントだけ) がジョブを原子的に取得し、スクリプトをローカルで実行 — Bash は `bash -c <script>`、JavaScript は `isolated-vm` サンドボックス内 — 結果を返します。
4. ワーカーは結果を持って Runbook を再開します。

`RUNBOOK_BASH_ENABLED` 環境変数フラグはもうありません。デプロイで Bash や JavaScript ステップが動くかどうかは、そのプロジェクトに少なくとも 1 つの接続済み Runbook エージェントがあるかどうかだけで決まります。

## 出力上限とタイムアウト

- ステップあたりの出力: **50&nbsp;KB**。それより大きい出力はマーカー付きで切り詰められます。
- ステップあたりの実行タイムアウトのデフォルト: JavaScript、Bash、HTTP で **30 秒**。ステップごとに設定可能。
- Bash と JavaScript ステップの**取得タイムアウト**: **2 分** — 選択されたエージェントがジョブを取得するまでワーカーが失敗扱いにせずに待つ時間。

## 権限

Runbook の権限は `Runbook` 権限グループにあります:

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook` — Runbook テンプレートを管理。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution` — 実行の開始、チェック、閲覧。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule` — 自動トリガールールの管理。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — Bash と JavaScript ステップをお客様自身のインフラで実行する Runbook エージェントの管理。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer` (ロール) — チームに割り当ててそれぞれフル制御・日常利用・読み取り専用を付与。`RunbookAdmin` は上記の細粒度権限をすべて束ねたもの。

## キュー & ワーカー

Runbook の実行は `Runbook` BullMQ キューで動きます。ワーカーの並行数は 25 — 同時実行が多ければデプロイで調整してください。

API で Manual ステップにチェックが入ると、実行は次のステップから続行するためにキューに再投入されます。残りの Runbook のためにワーカーを温かく保ちます。

## ハードニングについての注意

- **JavaScript と Bash** はお客様が制御する Runbook エージェントホスト上で動き、OneUptime ワーカー上では動きません。JavaScript は通常のプリリュード付きの `isolated-vm` サンドボックスでラップされます (プロトタイプチェーンを切断、`Function`/`eval` を削除、組み込みプロトタイプを凍結)。Bash はエージェント上でタイムアウト強制つきの `bash -c` で動きます。
- **HTTP ステップ** は緩いステータスバリデータを使うので、4xx や 5xx のレスポンスは例外ではなく失敗ステップとして記録されます。これにより記録された出力が上流が実際に返したものを反映します。
- **エージェント認証** はエージェントコンテナの環境変数として設定する ID + シークレットキーで行います。サーバー側では、提示された ID/キーをキーに DB 行から正規のエージェントアイデンティティを取り出します — キーが漏れてもクライアントは別のエージェントを偽装できません。

## データベーステーブル

- `Runbook` — テンプレート (name、slug、description、isEnabled、steps JSON)。
- `RunbookExecution` — 1 回の実行ごとに 1 行。`incidentId`、`alertId`、`scheduledMaintenanceId` のいずれかが入る (nullable) 外部キーと、ステップとステップごとの状態をスナップショットした JSON `stepExecutions` 配列を持つ。
- `RunbookRule` — 自動トリガールール。`triggerEntityType` の識別子 (Incident、Alert、ScheduledMaintenance) と、起動する Runbook への多対多のリレーションを持つ。
- `RunbookAgent` — インストール済みエージェントごとに 1 行: name、secret key、`lastAlive`、`connectionStatus`、ホスト情報。
- `RunbookAgentJob` — ディスパッチされた Bash または JavaScript ステップごとに 1 行: `targetAgentId` (ステップの作成者が選んだエージェント)、ステップ種別、スクリプト、ステータス (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`)、取得期限、リース、出力、終了コード。

## 運用のヒント

- **ステップで選ぶエージェントが健全であることを確認しましょう。** 冗長性が必要なら 2 つ目のエージェントを動かしてステップを分けるか、別エージェントを対象とするバックアップ Runbook を用意してください。
- **ブロブではなく URL を捕捉しましょう。** ステップが数 KB 以上を出力するなら、S3 やログスタックに書いて URL を返します。
- **冪等性が重要。** 自動ステップ (HTTP、JavaScript、Bash) はワーカーがステップ途中で再起動したり、スクリプトが動いている間にエージェントのリースが切れると、複数回実行される可能性があります。再試行しても安全なように設計してください。
