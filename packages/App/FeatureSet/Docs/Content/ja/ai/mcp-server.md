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
- **安全な認証**: OneUptime アカウントでのサインイン（OAuth 2.1）、または無人で動作するエージェント向けのリクエストごとの API キー送信
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
- **定期メンテナンス**: スケジュールされたメンテナンスイベントの作成と管理
- **テレメトリ**: ログ、メトリクス、トレース、例外、モニターログのクエリ（読み取り専用）

## 要件

- OneUptime インスタンス（クラウドまたはセルフホスト）
- MCP 対応クライアント（Claude Desktop、VS Code with GitHub Copilot など）
- サインインに使用する OneUptime アカウント、または無人で動作するエージェント用の OneUptime API キー（認証が必要な操作のみ必須 - パブリックツールはどちらも不要）

## OneUptime でのサインイン

最も簡単な接続方法は、MCP クライアントにサーバーの URL だけを指定することです。クライアントが初めてデータを必要としたときに、ブラウザで OneUptime のページが開くので、そこで次の操作を行います。

1. まだサインインしていない場合は、OneUptime にサインインします
2. クライアントが作業するプロジェクトを選択します
3. クライアントに **読み取りと書き込み** を許可するか、**読み取り専用** にするかを選択します
4. **許可する** をクリックします

以後、クライアントはそのプロジェクトであなたとして動作します。作成、コピー、ローテーションが必要な API キーはなく、秘密情報が設定ファイルに保存されることもありません。

接続済みクライアントにできることは次のとおりです。

- **あなたの権限を持ち、それを超えることは決してありません。** プロジェクトであなたが所属チームから許可されている操作が、そのままクライアントにできる操作です。あなたのロールが変わったり、プロジェクトを離れたりした場合は、クライアントの直後のリクエストから反映されます。
- **読み取り専用は、あくまで読み取り専用です。** 読み取り専用として許可されたクライアントは、`get_`、`list_`、`count_` ツールを使用できます。作成、更新、削除、確認応答、解決を行うツールは、MCP サーバーと、その背後にある OneUptime API の両方で拒否されます。クライアントが要求した以上のアクセスを与えることは決してできません。
- **1 つのプロジェクト専用です。** 別のプロジェクトを使用するには、クライアントをもう一度接続し、そのプロジェクトを選択します。
- **MCP サーバー経由でのみ機能します。** クライアントのアクセストークンは MCP エンドポイントでのみ受け付けられ、それ以外の場所では受け付けられません。OneUptime REST API を直接呼び出すために使用することはできません。
- **インスタンス管理者も特別扱いされません。** マスター管理者が接続したクライアントが持つのは、その人のチームがプロジェクトで付与している権限であり、インスタンス全体へのアクセスではありません。

### 接続済みクライアントの管理

サインインによって接続されたクライアントはすべて、**プロジェクト設定** → **MCP サーバー** → **Connected MCP Clients** に一覧表示され、接続したユーザー、許可されている操作、最後に使用された日時を確認できます。表示されるのは自分が接続したクライアントです。プロジェクトのオーナーと管理者には、全員のクライアントが表示されます。

クライアントをサインアウトさせるには、**Disconnect** をクリックします。クライアントは直ちに動作しなくなります。

クライアントは、使用されている限り接続されたままです。30 日間使用されなかったクライアントは、もう一度サインインする必要があります。

### クライアントを接続できるユーザーの制御

デフォルトでは、プロジェクトのすべてのメンバーが MCP クライアントを接続できます。あるチームのメンバーが接続できないようにするには、そのチームを開いて **ブロック権限** に移動し、**Authorize MCP Client** 権限を追加します。そのチームのメンバーがすでに接続していたクライアントは、直ちに動作しなくなります。

プロジェクトでシングルサインオンが必須の場合は、クライアントを許可する前に、ブラウザで SSO を使用してプロジェクトにサインインしてください。クライアントの接続は、その SSO サインインが有効な間だけ持続します。SSO サインインが失効した場合は、クライアントをもう一度接続してください。

OneUptime Cloud では、MCP クライアントの接続は API キーと同じプラン（Growth 以上）で利用できます。

Enterprise Edition では、接続済みクライアントが行ったすべての変更が、クライアントの名前とともに、接続したユーザーの操作として監査ログに記録されます。API キーで行われた変更には、キーの名前が表示されます。

## API キーの取得

API キーは、サインインする人がいない、無人で動作するエージェント（スケジュールされたジョブや CI パイプライン）に使用します。

1. OneUptime インスタンスにログインします
2. **プロジェクト設定** → **API キー** に移動します
3. **API キーを作成** をクリックします
4. 名前を入力します（例: "MCP Server"）
5. 用途に応じた適切な権限を選択します
6. 生成された API キーをコピーします

API キーはプロジェクトスコープです。MCP サーバーはキーからプロジェクトを推測するため、作成ツールに `projectId` 引数を渡す必要はありません。

> **警告 — AI エージェントにマスターキーを渡さないでください。** OneUptime の*マスター* API キーもこのヘッダーで受け付けられ、インスタンス全体の管理者アクセスを付与してしまいます。エージェントに必要な最小限の権限を持つプロジェクト API キーを必ず使用してください（すべての `get_`/`list_`/`count_` ツールには読み取り専用キーで十分です）。

## 設定

### サインインによる接続

認証情報を指定せずに、サーバーの URL をクライアントに追加します。セルフホストインスタンスの場合は `https://your-oneuptime-domain.com/mcp` を使用します。

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

続いて、Claude Code 内で `/mcp` を実行し、**oneuptime** を選択してサインインします。

**Claude（Web およびデスクトップ）**

**Customize** → **Connectors** を開き、**Add custom connector** を選択して、`https://oneuptime.com/mcp` を入力します。Claude は、初めてデータを必要としたときに、OneUptime へのサインインを求めます。

**VS Code with GitHub Copilot**

以下を MCP 設定に追加します（設定ファイルの場所については [VS Code with GitHub Copilot](#vs-code-with-github-copilot) を参照してください）。サーバーを起動すると、VS Code が OneUptime を開き、サインインできるようになります。

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

MCP 認可をサポートするその他のクライアントも同じように動作します。URL を指定すれば、残りはすべてクライアントが自動的に検出します。プロトコルの詳細については [サインイン（OAuth 2.1）](#サインインoauth-21) を参照してください。

このセクションの残りの部分では、同じクライアントを、代わりに API キーを使用して設定する方法を示します。

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

サインインする MCP クライアントは、以下の OAuth エンドポイントも使用します。クライアントはこれらを自動的に見つけます。ここでは、クライアントを開発する人やプロキシを設定する人のために記載しています。

| エンドポイント                                | メソッド | 説明                                                                   |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | 保護リソースのメタデータ（RFC 9728）。`/.well-known/oauth-protected-resource/mcp` でも提供されます |
| `/.well-known/oauth-authorization-server/mcp` | GET    | 認可サーバーのメタデータ（RFC 8414）。`/mcp/.well-known/oauth-authorization-server` でも提供されます |
| `/mcp/oauth/authorize`                        | GET    | 認可エンドポイント: クライアントがサインインのためにブラウザを誘導する先です |
| `/mcp/oauth/token`                            | POST   | トークンエンドポイント: 認可コードまたはリフレッシュトークンを交換します |
| `/mcp/oauth/register`                         | POST   | Dynamic Client Registration（RFC 7591）                                  |
| `/mcp/oauth/revoke`                           | POST   | トークンの失効（RFC 7009）                                               |

## 認証

MCP サーバーは 3 つの操作モードをサポートしています。

### パブリックツール（認証不要）

API キーなしで MCP サーバーに接続してパブリックツールにアクセスできます。

- **`oneuptime_help`**: OneUptime MCP の機能に関するヘルプとガイダンスを取得します
- **`oneuptime_list_resources`**: 利用可能なリソースとその操作を一覧表示します
- **`get_public_status_page_overview`**: パブリックステータスページの概要を取得します
- **`get_public_status_page_incidents`**: パブリックステータスページからインシデントを取得します
- **`get_public_status_page_scheduled_maintenance`**: スケジュールされたメンテナンスイベントを取得します
- **`get_public_status_page_announcements`**: パブリックステータスページからアナウンスを取得します

パブリックステータスページツールは、ステータスページ ID（UUID）またはステータスページドメイン名のいずれかを受け付けます。

### サインイン（OAuth 2.1）

その他のすべての操作（モニター、インシデント、チームの管理など）では、呼び出し元を識別する必要があります。認証情報を送信せずにこれらのツールのいずれかを呼び出したクライアントには、`401 Unauthorized` と、サーバーの保護リソースのメタデータを指す `WWW-Authenticate` ヘッダーが返されます。これが、MCP クライアントがサインイン処理を開始する合図です。`initialize`、`tools/list`、およびパブリックツールがサインインを求めることはありません。

サーバーは [MCP 認可仕様](https://modelcontextprotocol.io/specification/latest/basic/authorization) を実装しています。

- **フロー**: PKCE（`S256` のみ）を使用する OAuth 2.1 認可コードフロー。アクセストークンは `Authorization: Bearer` として送信されます。
- **ディスカバリー**: 保護リソースのメタデータ（RFC 9728）と認可サーバーのメタデータ（RFC 8414）。発行者とリソースはどちらも `https://<host>/mcp` です。
- **クライアントの識別**: Client ID Metadata Document（クライアント ID は、サーバーがアクセスして内容を取得する `https` URL です）、または Dynamic Client Registration（RFC 7591）。管理者がクライアントを登録する必要はありません。
- **スコープ**: `mcp:read` は `get_`、`list_`、`count_` ツール用です。`mcp:write` は `mcp:read` を含み、さらに何かを変更するすべてのツールが対象になります。読み取り専用のトークンで書き込みツールを呼び出すと、`403` と `error="insufficient_scope"` が返されます。
- **トークンの有効期間**: アクセストークンの有効期間は 1 時間です。リフレッシュトークンの有効期間は 30 日間で、使用されるたびに置き換えられます。すでに置き換えられたリフレッシュトークンを使用すると、接続は終了します。
- **リソースインジケーター**（RFC 8707）: トークンは `https://<host>/mcp` に対して発行され、それ以外の場所では受け付けられません。
- **失効**（RFC 7009）: いずれかのトークンを失効させると、接続は終了します。

### API キー

無人で動作するエージェントは、以下のいずれかのヘッダーに OneUptime API キーを指定して認証します。

- `x-api-key`: OneUptime API キー
- `Authorization`: API キーを含む Bearer トークン（例: `Bearer your-api-key-here`）

`Bearer` スキームは大文字と小文字を区別しません。API キーを含むリクエストに対してサインインが求められることはありません。

ツールのエラーは MCP プロトコルエラーとしてではなく、`statusCode`、詳細、提案を含むインバンドのツール結果（`isError: true`）として返されるため、エージェントは失敗内容を読み取って自己修正できます。

## ワークフローツール

リソースごとの CRUD ツールに加えて、サーバーはインシデント対応とアラート対応のための専用ワークフローツールを提供しています。

- **`acknowledge_incident`** / **`resolve_incident`**: インシデントをプロジェクトの「確認済み」または「解決済み」の状態に移行します — ダッシュボードでボタンを押すのと同等の操作です
- **`acknowledge_alert`** / **`resolve_alert`**: アラートに対する同様の操作です
- **`add_incident_note`**: `visibility: "internal"`（チームのみ、デフォルト）または `visibility: "public"`（ステータスページに投稿）を指定してインシデントにノートを追加します。Markdown がサポートされています
- **`add_alert_note`**: アラートに内部ノートを追加します

典型的なフロー: `list_incidents` → `acknowledge_incident` → `list_logs` で調査 → `add_incident_note`（公開）→ `resolve_incident`。

## Who Am I

**`oneuptime_whoami`** ツールは、認証情報が属するプロジェクト（ID と名前）を返します。サインインしたクライアントの場合は、誰としてサインインしているか、および変更を行えるかどうかも返します。エージェントが自身の状況を把握するための最初の呼び出しとして便利です — また、作成ツールは認証情報から `projectId` を推測するため、エージェントがプロジェクト ID を渡す必要は一切ありません。

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

## セルフホスト向けの設定

サインインは、セルフホストインスタンスで追加の設定なしに機能します。次の 2 つの設定を利用できます。

| 環境変数 | Helm の値 | 動作 |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | `true` に設定すると、サインインが無効になります。OAuth エンドポイントは提供されなくなり、MCP サーバーは API キーのみを受け付けます。何も削除されません。設定を元に戻すと、接続済みクライアントは再び動作します。 |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | インターネットに接続できないインスタンスでは `true` に設定します。クライアントは、OneUptime がアクセスして内容を取得する URL によって自身が何者であるかを示すことができますが、この設定を有効にすると、代わりにインスタンスに直接登録するようになるため、外向きのリクエストは不要になります。 |

OneUptime の前段に独自のリバースプロキシを配置している場合は、`/mcp` とともに、`/.well-known/oauth-protected-resource` と `/.well-known/oauth-authorization-server`（およびそれぞれの配下のすべて）を OneUptime に転送してください。同梱のイングレスでは、すでにそのように設定されています。

サーバーはすべての OAuth URL を `HOST` と `HTTP_PROTOCOL` の設定から組み立てるため、これらの設定は、ユーザーがインスタンスにアクセスするときに使用するアドレスと一致している必要があります。

## トラブルシューティング

### サインインの問題

- **クライアントがサインインを求めてこない**: クライアントが MCP 認可をサポートしていないか、API キーヘッダーを使用するよう設定されている可能性があります。API キーヘッダーが優先されます。代わりにサインインするには、このヘッダーを削除してください。
- **クライアントを許可するページでプロジェクトがグレーアウトされている**: 理由はページのプロジェクト名の横に表示されます - プロジェクトのプランに MCP クライアントの接続が含まれていないか、プロジェクトで SSO が必須なのにこのブラウザではそのプロジェクトに SSO でサインインしていないか、所属チームでクライアントの接続がブロックされているかのいずれかです。
- **ツールが "read-only" で拒否される**: クライアントは読み取り専用として許可されています。もう一度接続し、**読み取りと書き込み** を選択してください。
- **クライアントが動作しなくなった**: 接続が解除されたか、30 日間使用されなかったか、あなたがプロジェクトから削除されたか、プロジェクトへの SSO サインインが失効したかのいずれかです。もう一度接続してください。
- **セルフホスト - クライアントが認可サーバーを見つけられないと報告する**: `HOST` と `HTTP_PROTOCOL` が公開アドレスと一致していること、およびプロキシが `/.well-known/oauth-*` パスを転送していることを確認してください。

### 権限エラー

API キー（サインインしたクライアントの場合は、あなた自身のアカウント）に必要な権限があることを確認します。

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
**定期メンテナンス**: スケジュールメンテナンスイベント、スケジュールメンテナンス状態、スケジュールメンテナンス状態タイムライン
**チームとオンコール**: チーム、オンコールポリシー
**ラベル**: ラベル
**テレメトリ（読み取り専用）**: ログ、メトリクス、スパン、例外インスタンス、モニターログ

各データベースリソースは、snake_case のツールを通じて作成、取得、一覧表示、更新、削除、カウントをサポートしています — 例: `create_incident`、`get_incident`、`list_incidents`、`update_incident`、`delete_incident`、`count_incidents`。テレメトリリソースは `list_` と `count_` ツールのみを公開します（例: `list_logs`、`count_spans`）。
