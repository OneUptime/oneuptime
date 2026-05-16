# SMTP 設定

OneUptime は、3 つの認証方式によるカスタム SMTP サーバー経由のメール送信をサポートしています。

- **ユーザー名とパスワード** - 従来の SMTP 認証
- **OAuth 2.0** - Microsoft 365 および Google Workspace 向けのモダンな認証
- **なし** - 認証を必要としないリレーサーバー向け

このガイドでは、Microsoft 365 および Google Workspace の OAuth 2.0 認証の設定方法について説明します。

## OAuth 2.0 認証

OAuth 2.0 は、特に基本認証を無効にしているエンタープライズ環境において、メールサーバーへのより安全な認証方法を提供します。OneUptime は 2 種類の OAuth グラントタイプをサポートしています。

- **クライアント認証情報** - Microsoft 365 およびほとんどの OAuth プロバイダーで使用
- **JWT Bearer** - Google Workspace サービスアカウントで使用

### OAuth に必要なフィールド

OneUptime で OAuth 認証を使用して SMTP を設定する際に必要な情報は以下の通りです。

| フィールド | 説明 |
|-------|-------------|
| **ホスト名** | SMTP サーバーアドレス |
| **ポート** | SMTP ポート（通常 STARTTLS は 587、暗黙的 TLS は 465） |
| **ユーザー名** | 送信元メールアドレス |
| **認証タイプ** | "OAuth" を選択 |
| **OAuth プロバイダータイプ** | Microsoft 365 は "Client Credentials"、Google Workspace は "JWT Bearer" を選択 |
| **クライアント ID** | OAuth プロバイダーのアプリケーション/クライアント ID（Google の場合: サービスアカウントのメール） |
| **クライアントシークレット** | OAuth プロバイダーのクライアントシークレット（Google の場合: 秘密鍵） |
| **トークン URL** | OAuth トークンエンドポイント URL |
| **スコープ** | SMTP アクセスに必要な OAuth スコープ |

---

## Microsoft 365 の設定

Microsoft 365/Exchange Online で OAuth を使用するには、Microsoft Entra（Azure AD）にアプリケーションを登録し、適切な権限を設定する必要があります。

### ステップ 1: Microsoft Entra にアプリケーションを登録する

1. [Microsoft Entra 管理センター](https://entra.microsoft.com) にサインインします
2. **ID** > **アプリケーション** > **アプリの登録** に移動します
3. **新規登録** をクリックします
4. アプリケーションの名前を入力します（例: "OneUptime SMTP"）
5. **サポートされているアカウントの種類** で「この組織ディレクトリのみのアカウント」を選択します
6. **リダイレクト URI** は空白のままにします（クライアント認証情報フローには不要）
7. **登録** をクリックします

登録後、**概要** ページから以下の値をメモしておきます。
- **アプリケーション（クライアント）ID** - これがクライアント ID です
- **ディレクトリ（テナント）ID** - トークン URL に必要です

### ステップ 2: クライアントシークレットを作成する

1. アプリの登録で **証明書とシークレット** に移動します
2. **新しいクライアントシークレット** をクリックします
3. 説明を追加し、有効期限を選択します
4. **追加** をクリックします
5. **シークレット値を直ちにコピーします** - 後から表示されません

### ステップ 3: SMTP API 権限を追加する

1. **API のアクセス許可** に移動します
2. **アクセス許可の追加** をクリックします
3. **自分の組織で使用している API** を選択します
4. **Office 365 Exchange Online** を検索して選択します
5. **アプリケーションのアクセス許可** を選択します
6. **SMTP.SendAsApp** を見つけてチェックします
7. **アクセス許可の追加** をクリックします
8. **[組織名] に管理者の同意を与えます** をクリックします（管理者権限が必要）

### ステップ 4: Exchange Online にサービスプリンシパルを登録する

アプリケーションがメールを送信できるようにするには、Exchange Online にサービスプリンシパルを登録し、メールボックスの権限を付与する必要があります。

1. Exchange Online PowerShell モジュールをインストールします。

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Exchange Online に接続します。

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. サービスプリンシパルを登録します（アプリの登録ではなく、**エンタープライズアプリケーション** のオブジェクト ID を使用）。

```powershell
# Microsoft Entra > エンタープライズアプリケーション > アプリ > オブジェクト ID でオブジェクト ID を確認
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. 特定のメールボックスに代わって送信する権限をサービスプリンシパルに付与します。

```powershell
# サービスプリンシパルにメールボックスへのフルアクセスを付与
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> **注意:** `Add-RecipientPermission` ではなく `Add-MailboxPermission` を使用してください。`Add-RecipientPermission` は受信者への `SendAs` 権限のみを付与し、サービスプリンシパルが OAuth を使用して SMTP 経由でメールを送信するには不十分です（送信時に認証/権限エラーが発生します）。`FullAccess` を指定した `Add-MailboxPermission` が実際に機能するコマンドです。

### ステップ 5: OneUptime で設定する

OneUptime で以下の設定を使用して SMTP 設定を作成または編集します。

| フィールド | 値 |
|-------|-------|
| ホスト名 | `smtp.office365.com` |
| ポート | `587` |
| ユーザー名 | 権限を付与したメールアドレス（例: `sender@yourdomain.com`） |
| 認証タイプ | `OAuth` |
| OAuth プロバイダータイプ | `Client Credentials` |
| クライアント ID | ステップ 1 のアプリケーション（クライアント）ID |
| クライアントシークレット | ステップ 2 のシークレット値 |
| トークン URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| スコープ | `https://outlook.office365.com/.default` |
| 送信元メール | ユーザー名と同じ |
| セキュア（TLS） | 有効 |

`<tenant-id>` をステップ 1 のディレクトリ（テナント）ID に置き換えてください。

---

## Google Workspace の設定

Google Workspace では、ユーザーに代わってメールを送信するために、ドメイン全体の委任を持つ **サービスアカウント** が必要です。これは、Google の SMTP サーバーが Gmail の直接 OAuth クライアント認証情報フローをサポートしていないためです。

### 前提条件

- Google Workspace アカウント（通常の Gmail ではなく - 一般ユーザーの Gmail アカウントはサポートしていません）
- Google Workspace 管理コンソールへのスーパー管理者アクセス
- Google Cloud コンソールへのアクセス

### ステップ 1: Google Cloud プロジェクトを作成する

1. [Google Cloud コンソール](https://console.cloud.google.com) に移動します
2. プロジェクトのドロップダウンをクリックし、**新しいプロジェクト** を選択します
3. プロジェクト名を入力して **作成** をクリックします
4. 新しいプロジェクトを選択します

### ステップ 2: Gmail API を有効にする

1. **API とサービス** > **ライブラリ** に移動します
2. "Gmail API" を検索します
3. **Gmail API** をクリックして **有効にする** をクリックします

### ステップ 3: サービスアカウントを作成する

1. **API とサービス** > **認証情報** に移動します
2. **認証情報を作成** > **サービスアカウント** をクリックします
3. サービスアカウントの名前と説明を入力します
4. **作成して続行** をクリックします
5. 任意のステップをスキップして **完了** をクリックします

### ステップ 4: サービスアカウントキーを作成する

1. 作成したサービスアカウントをクリックします
2. **キー** タブに移動します
3. **キーを追加** > **新しいキーを作成** をクリックします
4. **JSON** を選択して **作成** をクリックします
5. ダウンロードされた JSON ファイルを安全な場所に保存します。ファイルには以下が含まれています。
   - `client_id` - クライアント ID
   - `private_key` - クライアントシークレット（秘密鍵）

### ステップ 5: ドメイン全体の委任を有効にする

1. サービスアカウントの詳細で **詳細設定を表示** をクリックします
2. **クライアント ID**（数値 ID）をメモします
3. **Google Workspace ドメイン全体の委任を有効にする** をチェックします
4. **保存** をクリックします

### ステップ 6: Google Workspace 管理コンソールでサービスアカウントを承認する

1. [Google Workspace 管理コンソール](https://admin.google.com) にサインインします
2. **セキュリティ** > **アクセスとデータコントロール** > **API コントロール** に移動します
3. **ドメイン全体の委任を管理** をクリックします
4. **新規追加** をクリックします
5. ステップ 5 の **クライアント ID** を入力します
6. **OAuth スコープ** に `https://mail.google.com/` を入力します
7. **承認** をクリックします

注意: 委任の伝播には数分から 24 時間かかる場合があります。

### ステップ 7: OneUptime で設定する

OneUptime で以下の設定を使用して SMTP 設定を作成または編集します。

| フィールド | 値 |
|-------|-------|
| ホスト名 | `smtp.gmail.com` |
| ポート | `587` |
| ユーザー名 | 送信元 Google Workspace のメールアドレス（例: `notifications@yourdomain.com`）。このユーザーはサービスアカウントによって偽装されます。 |
| 認証タイプ | `OAuth` |
| OAuth プロバイダータイプ | `JWT Bearer` |
| クライアント ID | サービスアカウント JSON の `client_email`（例: `your-service@your-project.iam.gserviceaccount.com`） |
| クライアントシークレット | サービスアカウント JSON の `private_key`（`-----BEGIN PRIVATE KEY-----` と `-----END PRIVATE KEY-----` を含む鍵全体） |
| トークン URL | `https://oauth2.googleapis.com/token` |
| スコープ | `https://mail.google.com/` |
| 送信元メール | ユーザー名と同じ |
| セキュア（TLS） | 有効 |

**重要:** Google（JWT Bearer）の場合、クライアント ID は数値の `client_id` ではなく、**サービスアカウントのメール**（`client_email`）です。サービスアカウントはユーザー名フィールドで指定されたユーザーを偽装してメールを送信します。

---

## トラブルシューティング

### Microsoft 365

| 問題 | 解決策 |
|-------|----------|
| "Authentication unsuccessful" | サービスプリンシパルが Exchange に登録されており、メールボックスの権限があることを確認します |
| "AADSTS700016: Application not found" | クライアント ID が正しく、テナントにアプリが存在することを確認します |
| "AADSTS7000215: Invalid client secret" | クライアントシークレットを再生成します - 期限切れの可能性があります |
| "The mailbox is not enabled for this operation" | `Add-MailboxPermission` を実行してメールボックスへのアクセス権を付与します |

### Google Workspace

| 問題 | 解決策 |
|-------|----------|
| "invalid_grant" | ドメイン全体の委任が適切に設定され、伝播されていることを確認します |
| "unauthorized_client" | Google Workspace 管理コンソールでクライアント ID が承認されていることを確認します |
| "access_denied" | スコープ `https://mail.google.com/` が承認されていることを確認します |
| "Domain policy has disabled third-party Drive apps" | Google Workspace 管理 > セキュリティ > API コントロールで API アクセスを有効にします |

### 全般

- **設定のテスト**: OneUptime の「テストメールを送信」ボタンを使用してセットアップを確認します
- **ログの確認**: 詳細なエラーメッセージについては OneUptime のログを確認します
- **トークンキャッシュ**: OneUptime は OAuth トークンをキャッシュし、有効期限前に自動的に更新します

---

## セキュリティのベストプラクティス

1. **定期的にシークレットをローテーションする**: クライアントシークレットが期限切れになる前にローテーションするためのカレンダーリマインダーを設定します
2. **専用サービスアカウントを使用する**: 他のアプリケーションと共有するのではなく、OneUptime 専用の認証情報を作成します
3. **最小権限の原則**: 必要最小限の権限のみを付与します（Microsoft は SMTP.SendAsApp、Google は mail.google.com スコープ）
4. **使用状況を監視する**: 異常なアクティビティがないか、メールログと OAuth アプリケーションのサインインを確認します
5. **安全な保管**: クライアントシークレットをバージョン管理にコミットしないようにします

---

## 追加リソース

### Microsoft 365
- [IMAP、POP、または SMTP 接続を OAuth で認証する](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Microsoft ID プラットフォームにアプリケーションを登録する](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [サーバー間アプリケーションへの OAuth 2.0 の使用](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API ドキュメント](https://developers.google.com/gmail/api)
- [XOAUTH2 プロトコル](https://developers.google.com/gmail/imap/xoauth2-protocol)
