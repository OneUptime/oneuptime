# ServiceNow 連携

OneUptime のインシデントが作成されるたびに [ServiceNow](https://www.servicenow.com) のインシデントを自動で開きます — ITSM と監視を連動させます。

この連携は**アウトバウンド**です: OneUptime が ServiceNow の [Table API](https://docs.servicenow.com/bundle/utah-application-development/page/integrate/inbound-rest/concept/c_TableAPI.html) を呼び出します。**Incident → On Create** トリガーと **API コンポーネント**を持つ OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。

```text
OneUptime Incident → On Create  ──►  API component (POST /api/now/table/incident)  ──►  ServiceNow incident
```

## 前提条件

- ServiceNow インスタンス (`https://your-instance.service-now.com`)。
- `rest_api_explorer` / `itil` ロール (または `incident` レコードを作成するのに十分な権限) を持つ ServiceNow ユーザー。このユーザーの認証情報を使った Basic 認証が最もシンプルな出発点です。本番環境では OAuth を推奨します。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — 認証情報をシークレットとして保存する

ServiceNow の Table API は **Basic 認証**を受け付けます。

1. `username:password` を一度 base64 エンコードします:

   ```bash
   printf '%s' 'integration_user:password' | base64
   ```

2. OneUptime で **Workflows → Global Variables → Create** に移動し、`SERVICENOW_AUTH` という名前にして base64 文字列を貼り付け、**Is Secret** をオンにします。

## ステップ 2 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → ServiceNow` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **API** ブロックを追加します:

   - **Method**: `POST`
   - **URL**: `https://your-instance.service-now.com/api/now/table/incident`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.SERVICENOW_AUTH}}
     Content-Type: application/json
     Accept: application/json
     ```

   - **Body**:

     ```json
     {
       "short_description": "OneUptime: {{Incident.title}}",
       "description": "{{Incident.description}}",
       "urgency": "1",
       "impact": "1",
       "correlation_id": "oneuptime-{{Incident._id}}"
     }
     ```

   `correlation_id` は OneUptime のインシデントへのリンクを保持します — 後で解決ステップを追加する場合に便利です。ServiceNow の `urgency`/`impact` は `1` (高)、`2` (中)、`3` (低) を使います。

4. **Save** して有効化し、テスト用インシデントを作成します。ワークフローのログに `201 Created` レスポンスが表示され、新しいレコードの `sys_id` と `number` (例: `INC0012345`) が返されます。

## ステップ 3 — OneUptime の解決時に解決する (オプション)

1. **Incident → On Update** トリガーと、インシデントが解決済みかどうかをチェックする **Conditions** ブロックを持つ**2 つ目のワークフロー**を作成します。
2. 正しい ServiceNow レコードを更新するには `sys_id` が必要です。ステップ 2 で `{{CreateRecord.response-body.result.sys_id}}` を読み取って **Update Incident** でラベルに書き込んで OneUptime インシデントに保存するか、`GET` で `/api/now/table/incident?sysparm_query=correlation_id=oneuptime-{{Incident._id}}` を呼び出してレコードを検索します。
3. **API** ブロックを追加します: **Method** `PATCH`、**URL** `https://your-instance.service-now.com/api/now/table/incident/<sys_id>`、ボディ `{ "state": "6", "close_code": "Resolved by monitoring", "close_notes": "Resolved in OneUptime" }` (`state` `6` はデフォルトの ITIL ワークフローで「解決済み」を意味します)。

## トラブルシューティング

- **`401`** — `printf` (`echo` は改行が追加されるため不可) を使って `username:password` を再エンコードし、`SERVICENOW_AUTH` を更新します。
- **`403`** — ユーザーに `incident` テーブルへの書き込み権限がありません。`itil` ロールを追加してください。
- **`400`** — フィールド名または値がインスタンスのカスタマイズに合っていません。**System Definition → Tables → incident** でフィールド名を確認してください。
- **インスタンスが呼び出しを拒否する** — インスタンスによっては Table API が制限されています。REST が有効になっており、IP が ACL でブロックされていないか確認してください。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — パターンと認証クイックリファレンス。
- [Jira](/docs/integrations/jira) — Jira に対する同じアウトバウンドパターン。
- [API コンポーネント](/docs/workflows/components#api) — レスポンスボディの読み取り。
