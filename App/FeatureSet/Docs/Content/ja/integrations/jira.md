# Jira 連携

OneUptime のインシデントが作成されるたびに [Jira](https://www.atlassian.com/software/jira) の課題を自動で開きます — 開発者がすでに使っている場所でエンジニアリング作業を追跡でき、インシデントへのリンクも保持されます。

この連携は**アウトバウンド**です: OneUptime が Jira の REST API を呼び出します。**Incident → On Create** トリガーと **API コンポーネント**を持つ OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。オプションで、Jira の課題をクローズしたときに OneUptime のインシデントを解決する**インバウンド**パスを追加することもできます。

```text
OneUptime Incident → On Create  ──►  API component (POST /rest/api/3/issue)  ──►  Jira issue
```

## 前提条件

- Jira Cloud サイト (`https://your-domain.atlassian.net`) と課題を登録するプロジェクト — **プロジェクトキー** (例: `OPS`) を控えておきます。
- 課題を作成できる Jira アカウントと、[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) で発行した**API トークン**。
- ワークフローを作成できる OneUptime プロジェクト。

> **Jira Data Center / Server (セルフマネージド) を使っている場合**は、手順はまったく同じです。自分のベース URL と [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) を使い、Basic 認証の代わりに `Bearer` 認証ヘッダーを使います。`/rest/api/2/issue` エンドポイントはプレーンテキストの説明を受け付けるため、テンプレートがシンプルになります。

## ステップ 1 — Jira の認証情報をシークレットとして保存する

Jira Cloud はメールアドレスと API トークンを base64 エンコードした **Basic 認証**を使います。

1. `email:api_token` を一度 base64 エンコードします。macOS/Linux では:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

2. OneUptime で **Workflows → Global Variables → Create** に移動します。
3. `JIRA_AUTH` という名前にして base64 文字列を値に貼り付け、**Is Secret** をオンにします。

これで `Basic {{variable.JIRA_AUTH}}` を認証ヘッダーとして使えます。トークンはワークフローやそのログには絶対に表示されません。

## ステップ 2 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → Jira` という名前にして **Builder** を開きます。
2. **Incident** トリガーをキャンバスにドラッグして **On Create** イベントを選びます。`Incident` にリネームします。
3. **API** ブロックをドラッグしてトリガーに接続します。次のように設定します:
   - **Method**: `POST`
   - **URL**: `https://your-domain.atlassian.net/rest/api/3/issue`
   - **Headers**:

     ```text
     Authorization: Basic {{variable.JIRA_AUTH}}
     Content-Type: application/json
     ```

   - **Body** (Jira Cloud v3 では説明に Atlassian Document Format を使用):

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime incident: {{Incident.title}}",
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 { "type": "text", "text": "{{Incident.description}}" }
               ]
             }
           ]
         }
       }
     }
     ```

   `OPS` を実際のプロジェクトキーに、`Bug` をそのプロジェクトに存在する課題タイプに置き換えます。
4. **Save** します。テストするまでワークフローを無効のままにしておきます。

## ステップ 3 — テストする

1. ワークフローの **Enabled** をオンにします。
2. OneUptime でテスト用インシデントを作成します (またはモニターからトリガーします)。
3. ワークフローの **Logs** タブを開きます。**API** ブロックが `201` ステータスと新しい課題の `key` (例: `OPS-1234`) を含むレスポンスボディを表示するはずです。
4. Jira を確認します — 課題が作成されています。

API ブロックがエラーを返した場合は、ログ内でそれを展開します — Jira のレスポンスに拒否されたフィールドの詳細が記載されています。[トラブルシューティング](#トラブルシューティング) を参照してください。

## ステップ 4 — インシデントを課題にリンクする (推奨)

インシデントに Jira 課題キーを保存しておくと、相互に行き来しやすくなります。

- API ブロックのレスポンスは `{{CreateIssue.response-body.key}}` として利用できます (ブロックを `CreateIssue` と命名した場合)。
- 後続に **Update Incident** ブロックを追加し、キーをラベル、カスタムフィールド、またはインシデントのノートに書き込みます。

これにより、以下のオプションの双方向同期も可能になります。

## 双方向同期 (オプション)

Jira の課題を誰かがクローズしたときに OneUptime のインシデントを解決するには、**インバウンド**ワークフローを追加します:

1. **Webhook** トリガーで始まる 2 つ目のワークフローを作成し、その URL をコピーします。
2. Jira で **Project settings → Automation → Create rule** に移動します:
   - **トリガー**: **Done** への課題遷移 (または課題解決)。
   - **アクション**: *Send web request* → メソッド `POST`、URL にワークフローの Webhook URL を設定し、ボディに課題キーと OneUptime のインシデント ID を含めます。例:

     ```json
     { "issueKey": "{{issue.key}}", "status": "resolved" }
     ```

3. ワークフロー内で **Find Incident** ブロックを使って保存したキーでインシデントを検索し、**Update Incident** ブロックで解決済み状態に変更します。

ステップ 4 でインシデントに Jira キーを保存していれば、マッチングは簡単です。[コンポーネント → OneUptime データコンポーネント](/docs/workflows/components#oneuptime-data-components) を参照してください。

## 課題のカスタマイズ

API ブロックのボディへのよくある変更:

- **優先度** — `fields` の中に `"priority": { "name": "High" }` を追加します。**Conditions** で `{{Incident.incidentSeverity.name}}` に分岐して OneUptime の重大度を Jira の優先度にマッピングできます。
- **ラベル** — `"labels": ["oneuptime", "incident"]` を追加します。
- **担当者** — `"assignee": { "id": "<accountId>" }` を追加します (Jira Cloud はユーザー名ではなくアカウント ID を使います)。
- **カスタムフィールド** — Jira 管理画面のフィールド ID を使って `"customfield_XXXXX": "..."` を追加します。

プロジェクトが期待するフィールド名を調べるには、ブラウザまたは `curl` で Jira の `GET /rest/api/3/issue/createmeta` エンドポイントを一度呼び出してください。

## トラブルシューティング

**`401 Unauthorized`。**
- `email:api_token` を `printf` (改行が追加される `echo` ではなく) で再エンコードして `JIRA_AUTH` 変数を更新します。末尾の改行が最もよくある原因です。
- API トークンを所有するアカウントがそのプロジェクトで課題を作成できるか確認します。

**フィールドに関する `400 Bad Request`。**
- 課題タイプまたは必須フィールドが間違っています。プロジェクトの**課題タイプ**名と必須カスタムフィールドの有無を確認します。必須項目を確認するには `createmeta` (上記) を使います。

**`404 Not Found`。**
- ベース URL を再確認して、`/rest/api/3/issue` (Cloud) または `/rest/api/2/issue` (Server/Data Center) を呼んでいるか確認します。

**説明が 1 行になっている / おかしな表示になる。**
- v3 では上記の Atlassian Document Format が必要です。プレーンテキストを送りたい場合は `/rest/api/2/issue` エンドポイントを使い、`"description": "{{Incident.description}}"` をプレーン文字列として記述します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンド/アウトバウンドのパターンと認証クイックリファレンス。
- [API コンポーネント](/docs/workflows/components#api) — メソッド、ヘッダー、レスポンスの読み取り。
- [変数](/docs/workflows/variables) — シークレットとインシデントフィールド。
- [PagerDuty](/docs/integrations/pagerduty) と [ServiceNow](/docs/integrations/servicenow) — 他のツールに対する同じアウトバウンドパターン。
