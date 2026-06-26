# GitHub 連携

OneUptime のインシデントが作成されると自動的に [GitHub](https://github.com) の Issue を開きます — 影響を受けるサービスを管理するリポジトリで後続のエンジニアリング作業を追跡できます。

この連携は**アウトバウンド**です: OneUptime が [GitHub REST API](https://docs.github.com/en/rest/issues/issues) を呼び出します。**Incident → On Create** トリガーと **API コンポーネント**を持つ OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。

> **より深い GitHub 接続をお探しですか?** OneUptime にはコードリポジトリを接続するためのネイティブ **GitHub App** インテグレーションもあります (AI エージェントとコード機能で使用)。これはワークフローではなく環境変数で設定します — [GitHub 連携 (セルフホスト)](/docs/self-hosted/github-integration) を参照してください。このページはインシデントから *Issue を登録する*ことについてです。

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## 前提条件

- Issue を登録したい GitHub リポジトリ。
- Issue を作成できるトークン:

  - そのリポジトリに **Issues: Read and write** 権限を持つ**細かいスコープの PAT**、または
  - `repo` スコープを持つ**クラシック PAT**。

  [github.com/settings/tokens](https://github.com/settings/tokens) で作成します。

- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — トークンを保存する

1. **Workflows → Global Variables → Create** に移動します。
2. `GITHUB_TOKEN` という名前にして、トークンを貼り付け、**Is Secret** をオンにします。

## ステップ 2 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → GitHub Issues` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **API** ブロックを追加します:

   - **Method**: `POST`
   - **URL**: `https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**:

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**:

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **Save** して有効化し、テスト用インシデントを作成します。ワークフローのログに `201 Created` が表示されれば Issue が作成されたことを意味し、レスポンスボディに `number` と `html_url` が含まれます。

## ヒント

- **GitHub Enterprise Server**: `https://your-host/api/v3/repos/{owner}/{repo}/issues` を使います。
- **担当者 / マイルストーン**: ボディに `"assignees": ["octocat"]` や `"milestone": 3` を追加します。
- **リンクを戻す**: `{{CreateIssue.response-body.html_url}}` を読み取り、**Update Incident** ブロックでインシデントに保存します。

## トラブルシューティング

- **`401`** — トークンが間違っているか有効期限切れです。細かいスコープのトークンはリポジトリと **Issues** 権限を明示的に付与する必要があります。
- **`403` / レート制限** — `User-Agent` ヘッダーを含めてください (GitHub はこれがないリクエストを拒否します)。レート制限にかかっていないか確認します。
- **`404`** — `owner/repo` パスが間違っているか、トークンがプライベートリポジトリを参照できません。
- **`422`** — 存在しないラベルは問題ありません (GitHub は参照されたラベルを作成します) が、不正な形式のボディは拒否されます — JSON を確認してください。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — パターンと認証クイックリファレンス。
- [GitLab](/docs/integrations/gitlab) — GitLab に対する同じ考え方。
- [GitHub 連携 (セルフホスト)](/docs/self-hosted/github-integration) — ネイティブ GitHub App 接続。
