# GitHub統合

セルフホストのOneUptimeインスタンスとGitHubを統合するには、GitHub Appを作成して必要な環境変数を設定する必要があります。これにより、OneUptimeがコードリポジトリ管理のためにGitHubリポジトリに接続できるようになります。

## 前提条件

- GitHub アカウント（組織リポジトリの場合は組織管理者権限、個人アカウントリポジトリの場合は個人アカウントアクセス権）
- OneUptimeサーバー設定へのアクセス

## セットアップ手順

### ステップ1：GitHub Appの作成

1. GitHubにアクセスして、組織または個人の設定に移動します：

   - **組織の場合：** `https://github.com/organizations/YOUR_ORG/settings/apps` にアクセス
   - **個人アカウントの場合：** `https://github.com/settings/apps` にアクセス

2. **「New GitHub App」** をクリックします

3. 登録フォームを入力します：
   - **GitHub App名：** OneUptime（または任意の一意の名前）- **この名前を保存してください。`GITHUB_APP_NAME` 環境変数に必要です**
   - **ホームページURL：** `https://your-oneuptime-domain.com`
   - **コールバックURL：** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **セットアップURL：** `https://your-oneuptime-domain.com/api/github/auth/callback` - **重要：これはGitHubがAppインストール後にユーザーをリダイレクトするURLです。リダイレクトを機能させるには設定が必要です。**
   - **更新時にリダイレクト：** ユーザーがAppインストールを更新した後にリダイレクトするにはこのオプションにチェックを入れます
   - **Request user authorization (OAuth) during installation:** **この必須オプションを有効にしてください。** OneUptime は OAuth でインストールの所有権を確認し、この設定がない場合は接続を拒否します。
   - **WebhookURL：** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhookシークレット：** セキュアなランダム文字列を生成します（後で必要になります）

### ステップ2：Appの権限設定

「Permissions & events」セクションで以下の権限を設定します：

**リポジトリ権限：**

| 権限            | アクセスレベル | 目的                                                                       |
| --------------- | -------------- | -------------------------------------------------------------------------- |
| Contents        | Read & Write   | リポジトリファイルの読み取り、ブランチへのプッシュ（AIエージェントに必要） |
| Pull requests   | Read & Write   | プルリクエストの作成と管理                                                 |
| Issues          | Read & Write   | issueの読み取りとコメント                                                  |
| Commit statuses | Read           | ビルド/CIステータスの確認                                                  |
| Actions         | Read           | GitHub Actionsのワークフロー実行とログの読み取り                           |
| Metadata        | Read           | 基本的なリポジトリのメタデータ（必須）                                     |

**組織権限（組織で使用する場合）：**

| 権限    | アクセスレベル | 目的                   |
| ------- | -------------- | ---------------------- |
| Members | Read           | 組織メンバーの一覧表示 |

**アカウント権限：**

| 権限            | アクセスレベル | 目的                             |
| --------------- | -------------- | -------------------------------- |
| Email addresses | Read           | 通知用のユーザーメールの読み取り |

### ステップ3：Webhookイベントの購読

OneUptime は GitHub Apps が自動受信する `installation` と `installation_repositories` でインストールとリポジトリアクセスを同期します。**Pull request**、**Push**、**Workflow run** などは受信確認のみで、購読しても通知や CI/CD 自動化は有効になりません。

### ステップ4：インストールアクセスの設定

「Where can this GitHub App be installed?」で以下を選択します：

- **Only on this account** — プライベート/内部での使用
- **Any account** — 他のユーザーにAppのインストールを許可する場合

### ステップ5：GitHub Appの作成

1. **「Create GitHub App」** をクリックします
2. Appの設定ページにリダイレクトされます
3. 以下の値をメモしてください：
   - **App ID** — App設定ページの上部に表示
   - **Client ID** — 「About」セクションに表示

### ステップ6：クライアントシークレットの生成

1. GitHub Appの設定で「Client secrets」までスクロールします
2. **「Generate a new client secret」** をクリックします
3. シークレットを即座にコピーしてください。再表示されません

### ステップ7：秘密鍵の生成

1. 「Private keys」セクションまでスクロールします
2. **「Generate a private key」** をクリックします
3. `.pem` ファイルが自動的にダウンロードされます
4. このファイルを安全に保管してください。GitHub Appとして認証するために使用されます

### ステップ8：OneUptime環境変数の設定

#### Docker Compose

Docker Composeを使用している場合、`config.env` ファイルにこれらの環境変数を追加します：

```bash
# GitHub App設定
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # GitHub Appの正確な名前（例：「OneUptime」）
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**注意：** 秘密鍵はbase64でエンコードし、環境変数が複数行の文字列をサポートしていない場合は改行なしで貼り付けてください。

#### KubernetesとHelm

KubernetesとHelmを使用している場合、`values.yaml` ファイルにこれらを追加します：

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # GitHub Appの正確な名前
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**重要：** これらの環境変数を追加した後、OneUptimeサーバーを再起動して反映させてください。

### ステップ9：GitHub Appのインストール

1. GitHub Appの公開ページにアクセスします：`https://github.com/apps/YOUR_APP_NAME`
2. **「Install」** または **「Configure」** をクリックします
3. Appをインストールする組織またはアカウントを選択します
4. Appがアクセスできるリポジトリを選択します：
   - **All repositories** — 現在および将来のすべてのリポジトリにアクセス
   - **Only select repositories** — 特定のリポジトリを選択
5. **「Install」** をクリックします

### ステップ10：OneUptimeでリポジトリを接続

1. OneUptime ダッシュボードにログインします
2. **製品** > **コードリポジトリ** に移動します
3. **「リポジトリの作成」** をクリックするか、GitHub Appのインストールフローを使用します
4. GitHubからリダイレクトされた場合、インストールIDが自動的にキャプチャされます
5. 接続したいリポジトリをリストから選択します
6. **「Connect」** をクリックしてリポジトリをOneUptimeプロジェクトにリンクします

## 環境変数リファレンス

| 変数                        | 説明                                                  | 必須           |
| --------------------------- | ----------------------------------------------------- | -------------- |
| `GITHUB_APP_ID`             | GitHub App設定のApp ID                                | はい           |
| `GITHUB_APP_NAME`           | GitHub Appの正確な名前（インストールURLに使用）       | はい           |
| `GITHUB_APP_CLIENT_ID`      | GitHub App設定のClient ID                             | はい           |
| `GITHUB_APP_CLIENT_SECRET`  | 生成したクライアントシークレット                      | はい           |
| `GITHUB_APP_PRIVATE_KEY`    | 秘密鍵（.pemファイル）の内容                          | はい           |
| `GITHUB_APP_WEBHOOK_SECRET` | WebhookペイロードNを検証するためのWebhookシークレット | Webhook には必須 |

## セルフホスト環境のネットワークアクセス

### 通信方向とエンドポイント

| 通信 | 必要なアクセス |
| --- | --- |
| OneUptime → GitHub | DNS と TCP 443 の外向き HTTPS。アプリトークンとリポジトリ API は `api.github.com`、OAuth 交換と HTTPS Git 操作は `github.com` |
| GitHub → OneUptime | インストールとリポジトリアクセスの同期用に `POST /api/github/webhook` への TCP 443 の公開 HTTPS |
| ユーザーのブラウザー → OneUptime | ダッシュボードとインストール・認可のリダイレクト先 `GET /api/github/auth/callback`。ユーザーの VPN 経由でも構いません |

Callback/Setup URL は[ブラウザーのリダイレクト先](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)で、Webhook は GitHub のサーバーから呼び出されます。ユーザーの VPN は GitHub に Webhook 接続を提供しません。記載ドメインは主要な通信先であり、ツール、ダウンロード、LFS、パッケージには別の宛先が必要な場合があります。GitHub.com 向けの設定であり、ファイアウォールの変更だけで GitHub Enterprise Server のホスト名がサポートされるわけではありません。

### プライベート環境とコールバックのセキュリティ

公開 DNS と、公的に信頼された HTTPS 証明書、完全な証明書チェーン、OneUptime ingress へのプライベート経路を持つゲートウェイを使用します。受信 TCP 443 を許可し、上記のプロバイダー POST コールバックだけを公開します。プライベート `ClusterIP`、内部 DNS、従業員の VPN だけではプロバイダーは接続できません。スプリット DNS を使えば、同じホスト名でダッシュボードとブラウザーの OAuth ルートを非公開にできます。

`config.env` に `HOST=oneuptime.example.com` と `HTTP_PROTOCOL=https`、または Helm に `host: oneuptime.example.com` と `httpProtocol: https` を設定します。適用後は再起動を待ちます。これらは URL を生成する設定であり、DNS、TLS、ファイアウォールを構築するものではありません。 ホスト名を変更したら GitHub App の Webhook、Callback、Setup、Homepage URL を更新します。

メソッド、元のパス、クエリ文字列、本文、`Content-Type`、`X-Hub-Signature-256`、`X-GitHub-Event`、`X-GitHub-Delivery` を保持します。信頼できるプロキシヘッダーで公開ホストと HTTPS を保持します。Webhook はブラウザー SSO、CAPTCHA、プロキシログインの対象外にします。GitHub の SSL 検証を有効にし、両システムで同じ `GITHUB_APP_WEBHOOK_SECRET` を設定します。OneUptime は署名のないリクエストを拒否し、このシークレットがなければ Webhook を検証できません。[GitHub の検証ガイド](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)を参照してください。

送信元 IP も制限する場合は、GitHub Meta API の最新の `hooks` 範囲を使い、定期更新します。GitHub Actions ランナーの範囲に置き換えず、署名検証も維持します。GitHub は[アドレスが変わり、一覧も完全ではない](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses)と説明しています。

### 接続の確認と制限事項

OneUptime からインストールを完了し、GitHub App の **Advanced > Recent Deliveries** を確認します。テスト配信または再配信で転送と受理を確認します。テスト用リポジトリをインストールに追加・削除し、接続リストが更新されることを確認してください。GitHub の[配信診断](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries)と、[10 秒以内の 2xx 応答要件](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)を参照してください。ブラウザー GET は署名付き POST のテストにはなりません。

受信アクセスがなくてもブラウザー認可や外向き API/Git 操作は動作する場合がありますが、インストール削除やリポジトリアクセス変更は Webhook で同期されません。現在 OneUptime が処理するのは `installation` と `installation_repositories` です。他のイベントの受理は追加の自動処理を意味しません。[プライベートネットワークアクセス設定](/docs/self-hosted/private-network-access)はプライベート宛先への送信を制御し、Webhook を到達可能にはしません。

## トラブルシューティング

### 一般的な問題

**GitHub Appのインストール後にOneUptimeにリダイレクトされない：**

- GitHub Appの設定で **セットアップURL** が `https://your-oneuptime-domain.com/api/github/auth/callback` に設定されていることを確認します
- GitHub Appの設定 > 「Post installation」セクションに移動し、セットアップURLが正しく設定されていることを確認します
- 「Redirect on update」オプションもチェックされていることを確認します
- 注意：セットアップURLはコールバックURLとは異なります。両方が同じ `/api/github/auth/callback` エンドポイントを指す必要があります

**「GitHub App is not configured」エラー：**

- `GITHUB_APP_CLIENT_ID` 環境変数が設定されていることを確認します
- 環境変数を設定した後にOneUptimeサーバーを再起動します

**「Invalid webhook signature」エラー：**

- `GITHUB_APP_WEBHOOK_SECRET` がGitHubで設定したシークレットと一致していることを確認します
- WebhookURLが正しく、インターネットからアクセス可能であることを確認します

**「Failed to get installation access token」エラー：**

- `GITHUB_APP_PRIVATE_KEY` が正しい形式であることを確認します
- 秘密鍵にBEGIN/ENDマーカーが含まれていることを確認します
- App IDが正しいことを確認します

**インストール後にリポジトリが見えない：**

- GitHub Appが接続したいリポジトリへのアクセス権を持っているか確認します
- GitHubのインストール権限を確認します（設定 > アプリケーション > インストール済みGitHub Apps）

**Webhookイベントが受信されない：**

- WebhookURLが公開アクセス可能であることを確認します
- App設定でGitHub AppのWebhook配信ログを確認します
- Webhookシークレットが正しく設定されていることを確認します

### Webhookの配信確認

1. GitHub Appの設定に移動します
2. サイドバーの「Advanced」をクリックします
3. 「Recent Deliveries」でWebhookの試行とレスポンスを確認します

## セキュリティのベストプラクティス

1. **シークレットを定期的にローテーションする** — 定期的に新しいクライアントシークレットと秘密鍵を生成します
2. **Webhookシークレットを使用する** — ペイロードの真正性を検証するために常にWebhookシークレットを設定します
3. **リポジトリアクセスを制限する** — 接続する必要があるリポジトリへのアクセスのみを許可します
4. **Webhookの配信を監視する** — 失敗した配信や不審なアクティビティを定期的に確認します
5. **秘密鍵を安全に保管する** — バージョン管理に秘密鍵をコミットしないでください

## サポート

GitHub統合に関する問題は、以下の手順で対応してください：

1. 上記のトラブルシューティングセクションを確認する
2. OneUptimeのログで詳細なエラーメッセージを確認する
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) に連絡する

この統合の改善のためのフィードバックをお待ちしています！
