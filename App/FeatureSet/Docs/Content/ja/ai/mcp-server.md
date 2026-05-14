# MCP サーバー

OneUptime Model Context Protocol（MCP）サーバーは、LLM に OneUptime インスタンスへの直接アクセスを提供し、AI を活用した監視、インシデント管理、可観測性の操作を可能にします。

## OneUptime MCP サーバーとは？

OneUptime MCP サーバーは、大規模言語モデル（LLM）と OneUptime インスタンスの橋渡し役です。Model Context Protocol（MCP）を実装しており、Claude などの AI アシスタントが監視インフラと直接やり取りできるようにします。

## 仕組み

MCP サーバーは OneUptime インスタンスと並行してホストされており、Streamable HTTP トランスポート経由でアクセスできます。ローカルへのインストールは不要です。

**クラウドユーザー**: `https://oneuptime.com/mcp`
**セルフホストユーザー**: `https://your-oneuptime-domain.com/mcp`

## 主な機能

- **完全な API カバレッジ**: 711 の OneUptime API エンドポイントへのアクセス
- **126 のリソースタイプ**: モニター、インシデント、チーム、プローブなど、すべての OneUptime リソースを管理
- **リアルタイム操作**: リアルタイムでのリソースの作成、読み取り、更新、削除
- **型安全なインターフェース**: 包括的な入力検証を伴う完全な型付け
- **安全な認証**: 適切なエラー処理を備えた API キーベースの認証
- **簡単な統合**: Claude Desktop およびその他の MCP 対応クライアントと連携
- **セッション管理**: 自動再接続サポートを備えた組み込みセッション処理

## できること

OneUptime MCP サーバーを使用すると、AI アシスタントが以下の操作を支援します。

- **モニター管理**: モニターの作成と設定、ステータスの確認、モニターグループの管理
- **インシデント対応**: インシデントの作成、ノートの追加、チームメンバーのアサイン、解決の追跡
- **チーム操作**: チーム、権限、オンコールスケジュールの管理
- **ステータスページ**: ステータスページの更新、アナウンスの作成、サブスクライバーの管理
- **アラート**: アラートルールの設定、エスカレーションポリシーの管理、通知ログの確認
- **プローブ**: さまざまな場所への監視プローブのデプロイと管理
- **レポートと分析**: レポートの生成と監視データの分析

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

| エンドポイント | メソッド | 説明 |
|----------|--------|-------------|
| `/mcp` | GET | サーバーからクライアントへの通知のための Server-Sent Events ストリーム |
| `/mcp` | POST | ツール呼び出しやその他の操作のための JSON-RPC リクエスト |
| `/mcp` | DELETE | セッションのクリーンアップと終了 |
| `/mcp/health` | GET | ヘルスチェックエンドポイント |
| `/mcp/tools` | GET | 利用可能なツールを一覧表示する REST API |

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

## 確認

MCP サーバーが稼働していることを確認します。

```bash
# OneUptime クラウドの場合
curl https://oneuptime.com/mcp/health

# セルフホストの場合
curl https://your-oneuptime-domain.com/mcp/health
```

利用可能なツールを一覧表示します。

```bash
# OneUptime クラウドの場合
curl https://oneuptime.com/mcp/tools

# セルフホストの場合
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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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
- MCP サーバーはセッションを追跡するために `mcp-session-id` ヘッダーを使用します
- クライアントがサーバーから返されるセッション ID を適切に処理することを確認します
- セッションは接続が閉じると自動的にクリーンアップされます

## 利用可能なリソース

MCP サーバーは以下を含む 126 のリソースタイプへのアクセスを提供します。

**監視**: Monitor、MonitorStatus、MonitorGroup、Probe
**インシデント**: Incident、IncidentState、IncidentNote、IncidentTemplate
**アラート**: Alert、AlertState、AlertSeverity
**ステータスページ**: StatusPage、StatusPageAnnouncement、StatusPageSubscriber
**オンコール**: On-CallPolicy、EscalationRule、On-CallSchedule
**チーム**: Team、TeamMember、TeamPermission
**テレメトリ**: TelemetryService、Log、Span、Metric
**ワークフロー**: Workflow、WorkflowVariable、WorkflowLog

各リソースは標準操作をサポートしています: 一覧表示、カウント、取得、作成、更新、削除。
