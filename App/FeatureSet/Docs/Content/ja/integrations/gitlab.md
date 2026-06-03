# GitLab 連携

OneUptime のインシデントが作成されると自動的に [GitLab](https://gitlab.com) の Issue を開きます — 影響を受けるサービスを管理するプロジェクトで後続のエンジニアリング作業を追跡できます。

この連携は**アウトバウンド**です: OneUptime が [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html) を呼び出します。**Incident → On Create** トリガーと **API コンポーネント**を持つ OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。GitLab.com とセルフマネージド GitLab の両方で同じように動作します。

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## 前提条件

- GitLab プロジェクトとその **Project ID** (プロジェクト名の下、プロジェクトの概要ページに表示されています)。
- Issue を作成できるアクセストークン — `api` スコープを持つ**プロジェクト**、**グループ**、または**個人アクセストークン**: **Settings → Access Tokens**。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — トークンを保存する

1. **Workflows → Global Variables → Create** に移動します。
2. `GITLAB_TOKEN` という名前にして、トークンを貼り付け、**Is Secret** をオンにします。

## ステップ 2 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → GitLab Issues` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **API** ブロックを追加します:
   - **Method**: `POST`
   - **URL**: `https://gitlab.com/api/v4/projects/12345678/issues`  *(`12345678` を実際の Project ID に置き換えます。セルフマネージドの場合は自分のホストを使用)*
   - **Headers**:

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **Save** して有効化し、テスト用インシデントを作成します。ワークフローのログに `201 Created` が表示されれば Issue が作成されたことを意味し、レスポンスボディに `iid` と `web_url` が含まれます。

## ヒント

- **セルフマネージド GitLab**: `https://gitlab.com` を自分のインスタンス URL に置き換えます。`/api/v4/...` のパスは同じです。
- **ID の代わりにプロジェクトパスを使う**: 数値 ID の代わりに URL エンコードされたパス (例: `group%2Fproject`) を使えます。
- **担当者 / 期限**: ボディに `"assignee_ids": [42]` や `"due_date": "2026-01-31"` を追加します。
- **リンクを戻す**: `{{CreateIssue.response-body.web_url}}` を読み取り、**Update Incident** ブロックでインシデントに保存します。

## トラブルシューティング

- **`401`** — トークンが無効か有効期限切れ、または `api` スコープがありません。
- **`404`** — Project ID が間違っているか、トークンがプライベートプロジェクトにアクセスできません。
- **`400`** — 必須フィールドが欠けているか不正な形式です。`title` は必須です。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — パターンと認証クイックリファレンス。
- [GitHub](/docs/integrations/github) — GitHub に対する同じ考え方。
- [API コンポーネント](/docs/workflows/components#api) — レスポンスボディの読み取り。
