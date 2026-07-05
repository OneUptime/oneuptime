# MCP サーバー

OneUptime Model Context Protocol（MCP）サーバーは、LLM に OneUptime インスタンスへの直接アクセスを提供し、AI を活用した監視、インシデント管理、可観測性の操作を可能にします。

## OneUptime MCP サーバーとは？

OneUptime MCP サーバーは、大規模言語モデル（LLM）と OneUptime インスタンスの橋渡し役です。Model Context Protocol（MCP）を実装しており、Claude などの AI アシスタントが監視インフラと直接やり取りできるようにします。

## 仕組み

MCP サーバーは OneUptime インスタンスと並行してホストされており、Streamable HTTP トランスポート経由でアクセスできます。ローカルへのインストールは不要です。

**クラウドユーザー**: `https://oneuptime.com/mcp`
**セルフホストユーザー**: `https://your-oneuptime-domain.com/mcp`

## 主な機能

- **約 155 のツール**: 22 のリソースタイプ（インシデント、アラート、モニター、ステータスページ、オンコールなど）に対する完全な CRUD ツール、読み取り専用のテレメトリツール、さらにワークフローツールとヘルパーツール
- **リアルタイム操作**: リアルタイムでのリソースの作成、読み取り、更新、削除
- **型安全なインターフェース**: 包括的な入力検証を伴う完全な型付け
- **安全な認証**: 適切なエラー処理を備えたリクエストごとの API キー認証
- **安全性アノテーション**: 読み取り専用ツールには `readOnlyHint`、削除ツールには `destructiveHint` が付与されているため、MCP クライアントは安全な呼び出しを自動承認し、破壊的な操作の前には確認を求められます
- **簡単な統合**: Claude Desktop およびその他の MCP 対応クライアントと連携
- **ステートレス設計**: セッション ID なし — すべてのリクエストが自己完結しているため、ロードバランサーの背後やマルチレプリカ構成でも動作します

## できること

OneUptime MCP サーバーを使用すると、AI アシスタントが以下の操作を支援します。

- **モニター管理**: モニターの作成と設定、ステータスの確認、ステータス履歴の確認
- **インシデント対応**: インシデントの作成、確認応答、解決、内部または公開ノートの追加、解決の追跡
- **チーム操作**: チームとオンコールポリシーの管理
- **ステータスページ**: ステータスページの管理とアナウンスの作成
- **アラート**: アラートの確認応答と解決、アラートノートの追加、アラートの状態と重大度の管理
- **スケジュールメンテナンス**: スケジュールされたメンテナンスイベントの作成と管理
- **テレメトリ**: ログ、メトリクス、トレース、例外、モニターログのクエリ（読み取り専用）

## 要件

- OneUptime インスタンス（クラウドまたはセルフホスト）
- MCP 対応クライアント（Claude Desktop、VS Code with GitHub Copilot など）
- 有効な OneUptime API キー（認証が必要な操作のみ必須 - パブリックツールは不要）

## API キーの取得

1. OneUptime インスタンスにログインします
2. **設定** → **API キー** に移動します
3. **API キーを作成** をクリックします
4. 名前を入力します（例: "MCP Server"）
5. 用途に応じた適切な権限を選択します
6. 生成された API キーをコピーします

API キーはプロジェクトスコープです。MCP サーバーはキーからプロジェクトを推測するため、作成ツールに `projectId` 引数を渡す必要はありません。

> **警告 — AI エージェントにマスターキーを渡さないでください。** OneUptime の*マスター* API キーもこのヘッダーで受け付けられ、インスタンス全体の管理者アクセスを付与してしまいます。エージェントに必要な最小限の権限を持つプロジェクト API キーを必ず使用してください（すべての `get_`/`list_`/`count_` ツールには読み取り専用キーで十分です）。

## 設定

### Claude Desktop の設定

Claude Desktop 設定ファイルを見つけます。

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### OneUptime クラウドの場合

以下の設定を追加します。

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### セルフホスト OneUptime の場合

`oneuptime.com` をお使いの OneUptime ドメインに置き換えます。

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### パブリックアクセス（API キー不要）

パブリックツールのみ使用する場合（ステータスページ情報、ヘルプ）、API キーなしで接続できます。

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

この設定により、認証なしでパブリックステータスページツールとヘルプリソースにアクセスできます。

### VS Code with GitHub Copilot

VS Code は GitHub Copilot（バージョン 1.99 以降）を使用して MCP サーバーをネイティブにサポートしています。これにより、Copilot が OneUptime データに直接アクセスできるようになります。

#### ステップ 1: 要件

- VS Code バージョン 1.99 以降
- GitHub Copilot 拡張機能がインストールされ有効化されていること
- GitHub Copilot Chat が有効化されていること

#### ステップ 2: MCP 設定を開く

1. `Ctrl+Shift+P`（Windows/Linux）または `Cmd+Shift+P`（macOS）を押します
2. "MCP: Open User Configuration" と入力して Enter を押します
3. `mcp.json` 設定ファイルが開かれるか作成されます

または、プロジェクト固有の設定として `.vscode/mcp.json` をワークスペースに作成します。

#### OneUptime クラウドの場合

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### セルフホスト OneUptime の場合

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### ステップ 3: MCP サーバーを起動する

1. `Ctrl+Shift+P` / `Cmd+Shift+P` を押します
2. "MCP: List Servers" と入力して利用可能なサーバーを確認します
3. "oneuptime" をクリックしてサーバーを起動します
4. プロンプトが表示されたら、OneUptime API キーを入力します

#### ステップ 4: Copilot Chat で使用する

GitHub Copilot Chat を開き、エージェントモード（`@workspace` または直接質問）を使用します。

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### セキュリティに関する注意

上記の設定では、`"password": true` を持つ入力変数を使用して、API キーをプレーンテキストで保存するのではなく、安全にプロンプトで入力できるようにしています。VS Code は MCP サーバーを初めて起動するときに信頼の確認を求めます。

## 利用可能なエンドポイント

| エンドポイント | メソッド | 説明                                                                   |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | ツール呼び出しやその他の操作のための JSON-RPC リクエスト                                                                            |
| `/mcp`        | GET    | SSE の `Accept` ヘッダーがない場合: わかりやすい JSON のディスカバリーペイロード。ある場合: `405` — ステートレスサーバーは独立した SSE ストリームを提供しません（準拠クライアントはそれなしで処理を続行します） |
| `/mcp`        | DELETE | 何も行いません（サーバーはステートレスであり、終了すべきセッションが存在しないため）                                                             |
| `/mcp/health` | GET    | ヘルスチェックエンドポイント                                                                                                            |
| `/mcp/tools`  | GET    | 利用可能なツールを一覧表示する REST API                                                                                                 |

## 認証

MCP サーバーは 2 つの操作モードをサポートしています。

### パブリックツール（認証不要）

API キーなしで MCP サーバーに接続してパブリックツールにアクセスできます。

- **`oneuptime_help`**: OneUptime MCP の機能に関するヘルプとガイダンスを取得します
- **`oneuptime_list_resources`**: 利用可能なリソースとその操作を一覧表示します
- **`get_public_status_page_overview`**: パブリックステータスページの概要を取得します
- **`get_public_status_page_incidents`**: パブリックステータスページからインシデントを取得します
- **`get_public_status_page_scheduled_maintenance`**: スケジュールされたメンテナンスイベントを取得します
- **`get_public_status_page_announcements`**: パブリックステータスページからアナウンスを取得します

パブリックステータスページツールは、ステータスページ ID（UUID）またはステータスページドメイン名のいずれかを受け付けます。

### 認証済みツール（API キー必須）

その他のすべての操作（モニター、インシデント、チームの管理など）には、以下のいずれかのヘッダーによる認証が必要です。

- `x-api-key`: OneUptime API キー
- `Authorization`: API キーを含む Bearer トークン（例: `Bearer your-api-key-here`）

`Bearer` スキームは大文字と小文字を区別しません。ツールのエラーは MCP プロトコルエラーとしてではなく、`statusCode`、詳細、提案を含むインバンドのツール結果（`isError: true`）として返されるため、エージェントは失敗内容を読み取って自己修正できます。

## ワークフローツール

リソースごとの CRUD ツールに加えて、サーバーはインシデント対応とアラート対応のための専用ワークフローツールを提供しています。

- **`acknowledge_incident`** / **`resolve_incident`**: インシデントをプロジェクトの「確認済み」または「解決済み」の状態に移行します — ダッシュボードでボタンを押すのと同等の操作です
- **`acknowledge_alert`** / **`resolve_alert`**: アラートに対する同様の操作です
- **`add_incident_note`**: `visibility: "internal"`（チームのみ、デフォルト）または `visibility: "public"`（ステータスページに投稿）を指定してインシデントにノートを追加します。Markdown がサポートされています
- **`add_alert_note`**: アラートに内部ノートを追加します

典型的なフロー: `list_incidents` → `acknowledge_incident` → `list_logs` で調査 → `add_incident_note`（公開）→ `resolve_incident`。

## Who Am I

**`oneuptime_whoami`** ツールは、API キーが属するプロジェクト（ID と名前）を返します。エージェントが自身の状況を把握するための最初の呼び出しとして便利です — また、作成ツールは API キーから `projectId` を推測するため、エージェントがプロジェクト ID を渡す必要は一切ありません。

## テレメトリのクエリ

ログ、メトリクス、トレース（スパン）、例外、モニターログは、読み取り専用の `list_` および `count_` ツール（`list_logs`、`list_metrics`、`list_spans`、`list_exception_instances`、`list_monitor_logs` と、それぞれに対応する `count_` ツール）として公開されています。テレメトリは OpenTelemetry 経由で取り込まれるため、作成ツールはありません。

テレメトリのクエリには必ず時間範囲フィルターを指定してください。クエリフィールドは、直接の値または演算子オブジェクトのいずれかを受け付けます。

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

サポートされている演算子: `EqualTo`、`NotEqual`、`IsNull`、`NotNull`、`EqualToOrNull`、`GreaterThan`、`LessThan`、`GreaterThanOrEqual`、`LessThanOrEqual`、`InBetween`、`Search`、`Includes`。ソートの値は `"ASC"` または `"DESC"` です。

## フィールド選択とページネーション

`get_` および `list_` ツールは、フィールド名の配列を指定する省略可能な `select` を受け付けます。デフォルトでは、重いフィールド（JSON、非常に長いテキスト、HTML の各カラム）を除くすべての読み取り可能なフィールドが返されます。これらの重いフィールドは `select` で明示的に指定する必要があります。

一覧ツールは `limit`（デフォルト 10、最大 100）と `skip` でページネーションを行い、すべての一覧レスポンスには実際に返された内容が正確に報告されます。

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## 確認

MCP サーバーが稼働していることを確認します。

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

利用可能なツールを一覧表示します。

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## 使用例

### 基本的な情報クエリ

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### モニター管理

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### インシデント管理

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### チームとオンコール

```
"List the teams in this project"
"Show me our on-call policies"
```

### ステータスページ管理

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### パブリックステータスページのクエリ（API キー不要）

これらのクエリはパブリックステータスページツールのみを使用して、認証なしで機能します。

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### 高度な操作

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API キーの権限

### 読み取り専用アクセス

データの閲覧のみの場合は、API キーに読み取り権限を追加してください。

### フルアクセス

リソースの作成、更新、削除のためのフルアクセスには、API キーにプロジェクト管理者権限があることを確認してください。

### ベストプラクティス

- 特定の権限を使用する: 必要最小限の権限のみを付与します
- API キーをローテーションする: 定期的に API キーをローテーションします
- 使用状況を監視する: OneUptime で API キーの使用状況を追跡します
- キーを分離する: 環境ごとに異なる API キーを使用します

## トラブルシューティング

### 権限エラー

API キーに必要な権限があることを確認します。

- リソース一覧表示のための読み取りアクセス
- リソース作成/更新のための書き込みアクセス
- リソースを削除したい場合の削除アクセス

### 接続の問題

1. OneUptime URL が正しいことを確認します
2. API キーが有効であることを確認します
3. OneUptime インスタンスにアクセスできることを確認します
4. ヘルスエンドポイントをテストします

### 無効な API キー

- OneUptime 設定で API キーを確認します
- 余分なスペースや文字がないか確認します
- キーが期限切れになっていないことを確認します

### セッションエラー

セッション関連のエラーが発生した場合:

- MCP サーバーはステートレスです — セッション ID の発行も追跡も行わないため、すべてのリクエストはどのサーバーレプリカに対しても機能します
- 以前のバージョンのサーバーから受け取った `mcp-session-id` ヘッダーを送信しているクライアントは、単にそれを省略できます。このヘッダーは無視されます
- サーバーからセッション ID が返されることを想定している古い MCP クライアント設定は更新してください

## 利用可能なリソース

MCP サーバーは以下のリソースに対するツールを提供します。

**監視**: モニター、モニターステータス、モニターステータスイベント
**インシデント**: インシデント、インシデント状態、インシデント重大度、インシデント状態タイムライン、インシデント公開ノート、インシデント内部ノート
**アラート**: アラート、アラート状態、アラート重大度、アラート状態タイムライン、アラート内部ノート
**ステータスページ**: ステータスページ、ステータスページアナウンス
**スケジュールメンテナンス**: スケジュールメンテナンスイベント、スケジュールメンテナンス状態、スケジュールメンテナンス状態タイムライン
**チームとオンコール**: チーム、オンコールポリシー
**ラベル**: ラベル
**テレメトリ（読み取り専用）**: ログ、メトリクス、スパン、例外インスタンス、モニターログ

各データベースリソースは、snake_case のツールを通じて作成、取得、一覧表示、更新、削除、カウントをサポートしています — 例: `create_incident`、`get_incident`、`list_incidents`、`update_incident`、`delete_incident`、`count_incidents`。テレメトリリソースは `list_` と `count_` ツールのみを公開します（例: `list_logs`、`count_spans`）。
