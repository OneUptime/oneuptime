# Runbook の設定と安全性

## 出力上限

- ステップごとの出力: **50KB**。これを超えるとマーカー付きで切り詰められます。
- ステップごとの既定タイムアウト: JavaScript、Bash、HTTP すべて **30 秒**。ステップごとに設定可能。
- Bash ステップの **Claim タイムアウト** 既定値: **2 分** — Runbook エージェントがジョブを取得するまで Worker が待つ最大時間。これを超えるとステップは失敗します。

## 権限

Runbook の権限は `Runbook` 権限グループに属します:

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook` — Runbook テンプレートを管理。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution` — 実行の開始、チェック、閲覧。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule` — 自動トリガールールを管理。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — お客様のインフラ内で Bash ステップを実行する Runbook エージェントを管理。
- `RunbookManager` (ロール) — 上記をまとめたもの。チームに割り当てれば Runbook 全体を扱えます。

## キューとワーカー

Runbook 実行は BullMQ の `Runbook` キューで処理されます。ワーカーの並列度は 25 — 大規模な同時実行があるデプロイでは調整してください。

API 経由で Manual ステップがチェックされると、実行は次のステップから続行するためキューに戻されます。これにより Runbook の残りを引き続き処理できる状態を保ちます。

## ハードニングのメモ

- **JavaScript ステップ**は `isolated-vm` 上でサンドボックスハードニングのプリアンブル付きで動作します (プロトタイプチェーンを切断、`Function` と `eval` を削除、組み込みプロトタイプを凍結)。
- **Bash ステップ**は OneUptime Worker 上では決して実行されません。お客様自身のインフラに設置した [Runbook エージェント](/docs/runbooks/agents) にジョブとして送られます。Worker はステップの **Agent Tag** を付けてジョブをキューに入れ、エージェントがアトミックに取得し、ローカルで `bash -c <スクリプト>` を実行し、結果を送り返します。Worker プロセス自身はお客様の環境にシェルアクセスを持ちません。
- **HTTP ステップ**は寛容なステータスバリデータを使うため、4xx / 5xx レスポンスは投げられずに失敗ステップとして記録されます。これにより取り込まれた出力は実際に相手が返した内容を反映します。

## データベーステーブル

- `Runbook` — テンプレート (name、slug、description、isEnabled、ステップ JSON)。
- `RunbookExecution` — 1 走行ごとの行。null 許容の `incidentId`、`alertId`、`scheduledMaintenanceId` 外部キーと、ステップおよびステップごとの状態をスナップショットする JSON 配列 `stepExecutions` を持つ。
- `RunbookRule` — `triggerEntityType` ディスクリミネータ (Incident、Alert、ScheduledMaintenance) と起動する Runbook への many-to-many 関連を持つ自動トリガールール。
- `RunbookAgent` — インストールされたエージェントごとに 1 行: 名前、タグ、秘密鍵、`lastAlive`、`connectionStatus`、ホスト情報。
- `RunbookAgentJob` — ディスパッチされた Bash ステップごとに 1 行: 必要タグ、スクリプト、状態 (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled)、claim 期限、リース、出力、終了コード。

## 運用のヒント

- **狙うタグごとに最低 1 つのエージェントを動かす**、高可用性なら 2 つ。同じタグの 2 つのエージェントがあれば、どちらでもジョブを取得できる — Runbook を壊さずにローリング再起動ができます。
- **blob ではなく URL を取り込む。** 数 KB を超える出力を生成するステップでは、S3 やログスタックに書き出し、URL を返してください。
- **冪等性が重要。** 自動ステップ (HTTP、JavaScript、Bash) はワーカーが途中で再起動した場合、またはスクリプト実行中にエージェントのリースが切れた場合に複数回走ることがあります。リトライしても安全になるよう設計してください。
