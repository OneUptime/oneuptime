# SMTP

OneUptime のメールを自分のメールサーバーから送信します。プロジェクトは、そのステータスページがメールを送るための SMTP 設定を追加でき、セルフホストのインストールでは、OneUptime がそれ以外のすべてを送るサーバーを設定します。どちらも 3 つのサインイン方法に対応しています。

- **ユーザー名とパスワード**: 従来の SMTP 認証。
- **OAuth 2.0**: 基本認証がオフになっていることの多い Microsoft 365 と Google Workspace 向け。
- **なし**: 認証を必要としないリレーサーバー向け。

```mermaid title="どのメールサーバーが何を送るか"
flowchart TB
    SP["ステータスページのメール"] --> Q{"ページにカスタム SMTP 設定が<br/>選ばれている?"}
    Q -->|"はい"| P["プロジェクトの SMTP 設定"]
    Q -->|"いいえ"| D["OneUptime 自身の<br/>メールサーバー"]
    E["OneUptime のその他のメール"] --> D
```

セルフホストのインストールでは、OneUptime 自身のメールサーバーは Admin Dashboard で設定したものです。ステータスページは、自身の **購読者設定** ページにある **カスタム SMTP** カードで SMTP 設定を選びます。

:::cards
- [メールサーバーを追加する](#smtp-サーバーを追加する): 2 つのステップ。それ以外はすべて折りたたまれています。
- [Microsoft 365](#microsoft-365-の設定): Entra のアプリ登録を使った OAuth。
- [Google Workspace](#google-workspace-の設定): サービスアカウントを使った OAuth。
- [トラブルシューティング](#トラブルシューティング): よくあるエラーとその意味。
:::

## SMTP サーバーを追加する

プロジェクトのメールサーバーは、**プロジェクト設定 > 通知 > 通知設定** の **カスタム SMTP 設定** カードで追加します。セルフホストのインストールでは、OneUptime 自身が送信に使うサーバーを **Admin Dashboard > 設定 > 通知 > メール** の **カスタムメールとSMTP設定** カードで設定します。どちらのフォームも、2 つのステップで同じ内容を尋ねます。

:::steps
### フォームを開く

:::tabs
@tab プロジェクト
**プロジェクト設定 > 通知 > 通知設定** の **カスタム SMTP 設定** カードで **SMTP 設定を作成** をクリックします。
@tab セルフホストのインスタンス
Admin Dashboard で **設定** を開き、サイドメニューの **通知 > メール** を開きます (**通知** は最初は折りたたまれています)。**メールサーバー設定** カードで **サーバーを編集** をクリックし、**メールサーバーの種類** を `Custom SMTP` に設定します。次に、その下に表示される **カスタムメールとSMTP設定** カードで **SMTP設定を編集** をクリックします。
:::

### サーバーのステップを入力する

**サーバー** ステップで、**名前** (プロジェクトの設定のみ)、**ホスト名**、**ポート** (新しいプロジェクトの設定は `587` から始まります)、**ユーザー名**、**パスワード** を入力します。

### その他の項目を確認する

それ以外の設定はすべて、**サーバー** ステップの最後にある **その他の項目** に折りたたまれています。折りたたまれている間は、見出しにメールの送信方法が表示されます。たとえば「メールは SMTP で送信され、ユーザー名とパスワードでサインインします。TLS は必須です。」のように表示されます。下の表にある設定を変更する必要があるときだけ開いてください。

### 送信者のステップを入力する

**送信者** ステップで、メールの送り主となる **送信元メールアドレス** と **差出人名** を入力します。そのアドレスからの送信を、サーバーが許可している必要があります。

### 保存してテストメールを送る

設定を保存します。プロジェクトの設定を保存すると、その行の **テストメールを送信** で動作を確認できます。これには SMTP 設定を追加する権限が必要です: **Project Owner**、**Project Admin**、またはカスタムロールの **Create SMTP Config** と **Read SMTP Config** です。OneUptime Cloud では、設定の追加と同じく **Growth** プランも必要です。それ以外のユーザーにはボタンがロックされ、ツールチップに必要なものが表示されます。

テストでは送信先の **メール** アドレスを尋ねられます。最初は自分のアドレスが入っています。メッセージが届くことを確認してください。
:::

**その他の項目** にある設定は次のとおりです。

| 項目 | 内容 |
| --- | --- |
| **トランスポート** | `SMTP` (既定値)、または SMTP AUTH がオフになっている Microsoft 365 テナント向けの `Microsoft Graph`。Microsoft Graph を選ぶと、ホスト名、ポート、ユーザー名、パスワードが非表示になり、OAuth の項目が表示されます。 |
| **TLS を必須にする** | 新しいプロジェクトの設定ではオン。メールは有効な証明書を持つ暗号化された接続でのみ送信されます。オフの場合、メールはサーバーが対応しているときだけ暗号化され、証明書は確認されません。ポート 465 は常に暗号化されます。 |
| **認証タイプ** | `Username and Password` (既定値)、`OAuth`、またはサインイン不要のリレー向けの `None`。 |
| **OAuth の項目** | **OAuth プロバイダータイプ**、**OAuth クライアント ID**、**OAuth クライアントシークレット**、**OAuth トークン URL**、**OAuth スコープ**。OAuth または Microsoft Graph を選ぶと表示されます。 |
| **説明** | チーム向けのメモ (プロジェクトの設定のみ)。 |

**Microsoft Graph.** **その他の項目** を開いて **トランスポート** を `Microsoft Graph` に設定し、**Mail.Send** アプリケーション権限を持つ Azure アプリの情報を入力します: クライアント ID とクライアントシークレット、トークン URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`、スコープ `https://graph.microsoft.com/.default` です。メールは **送信元メールアドレス** のメールボックスから送信されます。これはテナント内のライセンスのあるメールボックスでなければなりません。

> [!NOTE]
> OneUptime Cloud では、プロジェクトのメールサーバーはインターネットから到達できる必要があります。プライベートまたは内部のアドレスに解決されるホストは拒否されます。セルフホストのインストールでは、`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` が `true` でない限りプライベートアドレスは許可されますが、ループバックとリンクローカルのアドレスは常に拒否されます。インスタンス自身のメールサーバーは、このようにはチェックされません。

## OAuth 2.0 認証

OAuth 2.0 を使うと、OneUptime はパスワードなしでメールサーバーにサインインできます。企業向けのメールサービスでは、これを求めることが増えています。OneUptime は 2 種類の OAuth グラントタイプに対応しています。

- **Client Credentials**: Microsoft 365 とほとんどの OAuth プロバイダーで使われます。
- **JWT Bearer**: Google Workspace のサービスアカウントで使われます。

```mermaid title="OneUptime が OAuth でサインインする流れ"
sequenceDiagram
    participant O as OneUptime
    participant T as トークン URL
    participant M as メールサーバー
    O->>T: アクセストークンを要求する
    T-->>O: アクセストークン
    Note over O: キャッシュされ、<br/>期限切れ前に更新される
    O->>M: トークンでサインインする
    O->>M: メールを送信する
```

**認証タイプ** と OAuth の項目は、フォームのサーバーのステップにある **その他の項目** の下にあります。OAuth でサインインするには、次を入力します。

| 項目 | 説明 |
| --- | --- |
| **ホスト名** | SMTP サーバーのアドレス |
| **ポート** | SMTP ポート (通常は STARTTLS なら 587、暗黙的 TLS なら 465) |
| **ユーザー名** | 送信するメールボックスのメールアドレス |
| **認証タイプ** | `OAuth` |
| **OAuth プロバイダータイプ** | Microsoft 365 なら `Client Credentials`、Google Workspace なら `JWT Bearer` |
| **OAuth クライアント ID** | OAuth プロバイダーのアプリケーション (クライアント) ID (Google の場合はサービスアカウントのメールアドレス) |
| **OAuth クライアントシークレット** | OAuth プロバイダーのクライアントシークレット (Google の場合は秘密鍵) |
| **OAuth トークン URL** | プロバイダーの OAuth トークンエンドポイント |
| **OAuth スコープ** | SMTP へのアクセスを許可する OAuth スコープ |

OneUptime は OAuth トークンをキャッシュし、期限が切れる前に自動で更新します。

## Microsoft 365 の設定

Microsoft 365 (Exchange Online) で OAuth を使うには、Microsoft Entra でアプリケーションを登録し、SMTP でメールを送信する権限を与え、送信に使うメールボックスへのアクセスを許可します。

:::steps
### Microsoft Entra でアプリケーションを登録する

1. [Microsoft Entra 管理センター](https://entra.microsoft.com) にサインインします。
2. **Identity** > **Applications** > **App registrations** に移動し、**New registration** をクリックします。
3. 名前 (たとえば「OneUptime SMTP」) を入力し、「Accounts in this organizational directory only」を選び、**Redirect URI** は空欄のままにします。
4. **Register** をクリックします。

**Overview** ページで、**Application (client) ID** (クライアント ID) と **Directory (tenant) ID** (トークン URL 用) を控えておきます。

### クライアントシークレットを作成する

1. アプリの登録で **Certificates & secrets** に移動し、**New client secret** をクリックします。
2. 説明を追加し、有効期限を選んで **Add** をクリックします。
3. **シークレットの値はすぐにコピーしてください**: 二度と表示されません。

### SMTP の権限を追加する

1. **API permissions** に移動し、**Add a permission** をクリックします。
2. **APIs my organization uses** を選び、**Office 365 Exchange Online** を検索して選びます。
3. **Application permissions** を選び、**SMTP.SendAsApp** にチェックを入れて **Add permissions** をクリックします。
4. **Grant admin consent for [your organization]** をクリックします (管理者権限が必要です)。

### Exchange Online でサービスプリンシパルを登録する

アプリケーションがメールを送信できるようにするには、Exchange Online でそのサービスプリンシパルを登録し、送信に使うメールボックスへのアクセス権を与えます。

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> `Add-RecipientPermission` ではなく `Add-MailboxPermission` を使ってください。`Add-RecipientPermission` は受信者に対する `SendAs` しか付与しないため、サービスプリンシパルが OAuth で SMTP からメールを送信するには不十分で、送信は認証エラーまたは権限エラーで失敗します。

### OneUptime で SMTP 設定を作成する

次の設定で SMTP 設定を作成または編集します。`<tenant-id>` は **Directory (tenant) ID** に置き換えます。

| 項目 | 値 |
| --- | --- |
| ホスト名 | `smtp.office365.com` |
| ポート | `587` |
| ユーザー名 | 権限を付与したメールアドレス (例: `sender@yourdomain.com`) |
| 認証タイプ | `OAuth` |
| OAuth プロバイダータイプ | `Client Credentials` |
| OAuth クライアント ID | **Application (client) ID** |
| OAuth クライアントシークレット | クライアントシークレットの値 |
| OAuth トークン URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| OAuth スコープ | `https://outlook.office365.com/.default` |
| 送信元メールアドレス | ユーザー名と同じ |
| TLS を必須にする | オン |

その後、**テストメールを送信** で確認します。
:::

## Google Workspace の設定

Google Workspace には、ドメイン全体の委任を持つ **サービスアカウント** が必要です。サービスアカウントは、ドメイン内のユーザーに代わってメールを送信します。Google の SMTP サーバーは、Gmail 向けの単純な client credentials フローには対応していません。

### Google Workspace を始める前に

- Google Workspace アカウント。個人用の Gmail アカウントでは使えません。
- Google Workspace 管理コンソールへの特権管理者のアクセス。
- Google Cloud Console へのアクセス。

:::steps
### Google Cloud プロジェクトを作成する

1. [Google Cloud Console](https://console.cloud.google.com) に移動します。
2. プロジェクトの選択メニューをクリックし、**New Project** を選びます。
3. プロジェクト名を入力して **Create** をクリックし、新しいプロジェクトを選びます。

### Gmail API を有効にする

1. **APIs & Services** > **Library** に移動します。
2. 「Gmail API」を検索し、**Gmail API** をクリックしてから **Enable** をクリックします。

### サービスアカウントを作成する

1. **APIs & Services** > **Credentials** に移動します。
2. **Create Credentials** > **Service account** をクリックします。
3. 名前と説明を入力して **Create and Continue** をクリックし、任意の手順は飛ばして **Done** をクリックします。

### サービスアカウントの鍵を作成する

1. 作成したサービスアカウントをクリックし、**Keys** タブに移動します。
2. **Add Key** > **Create new key** をクリックし、**JSON** を選んで **Create** をクリックします。
3. ダウンロードした JSON ファイルは安全に保管してください。その `client_email` が OAuth のクライアント ID、`private_key` が OAuth のクライアントシークレットです。

### ドメイン全体の委任を有効にする

1. サービスアカウントの詳細で **Show Advanced Settings** をクリックします。
2. 数字の **Client ID** を控えておきます。
3. **Enable Google Workspace Domain-wide Delegation** にチェックを入れ、**Save** をクリックします。

### Google Workspace 管理コンソールでサービスアカウントを承認する

1. [Google Workspace 管理コンソール](https://admin.google.com) にサインインします。
2. **Security** > **Access and data control** > **API Controls** に移動し、**Manage Domain Wide Delegation** をクリックします。
3. **Add new** をクリックし、前の手順で控えた数字の **Client ID** を入力し、**OAuth Scopes** に `https://mail.google.com/` を入力します。
4. **Authorize** をクリックします。

委任が有効になるまで、数分から最長 24 時間かかることがあります。

### Google Workspace 用の SMTP 設定を作成する

次の設定で SMTP 設定を作成または編集します。

| 項目 | 値 |
| --- | --- |
| ホスト名 | `smtp.gmail.com` |
| ポート | `587` |
| ユーザー名 | 送信元にする Google Workspace のメールアドレス (例: `notifications@yourdomain.com`)。サービスアカウントはこのユーザーになりすまして送信します。 |
| 認証タイプ | `OAuth` |
| OAuth プロバイダータイプ | `JWT Bearer` |
| OAuth クライアント ID | サービスアカウントの JSON にある `client_email` (例: `your-service@your-project.iam.gserviceaccount.com`) |
| OAuth クライアントシークレット | サービスアカウントの JSON にある `private_key` (`-----BEGIN PRIVATE KEY-----` と `-----END PRIVATE KEY-----` を含む鍵全体) |
| OAuth トークン URL | `https://oauth2.googleapis.com/token` |
| OAuth スコープ | `https://mail.google.com/` |
| 送信元メールアドレス | ユーザー名と同じ |
| TLS を必須にする | オン |

その後、**テストメールを送信** で確認します。
:::

> [!IMPORTANT]
> Google (JWT Bearer) の場合、**OAuth クライアント ID** は数字の `client_id` ではなく、**サービスアカウントのメールアドレス** (`client_email`) です。サービスアカウントは **ユーザー名** のユーザーになりすましてメールを送信します。

## トラブルシューティング

### Microsoft 365 のエラー

| 問題 | 解決策 |
| --- | --- |
| "Authentication unsuccessful" | サービスプリンシパルが Exchange に登録され、メールボックスの権限を持っていることを確認します |
| "AADSTS700016: Application not found" | クライアント ID が正しく、アプリがテナントに存在することを確認します |
| "AADSTS7000215: Invalid client secret" | 新しいクライアントシークレットを作成します。古いものが期限切れになっている可能性があります |
| "The mailbox is not enabled for this operation" | `Add-MailboxPermission` を実行して、メールボックスへのアクセス権を付与します |

### Google Workspace のエラー

| 問題 | 解決策 |
| --- | --- |
| "invalid_grant" | ドメイン全体の委任が正しく設定され、反映済みであることを確認します |
| "unauthorized_client" | クライアント ID が Google Workspace 管理コンソールで承認されていることを確認します |
| "access_denied" | スコープ `https://mail.google.com/` が承認されていることを確認します |
| "Domain policy has disabled third-party Drive apps" | Google Workspace の管理画面で、Security > API Controls から API アクセスを有効にします |

### その他の問題

:::details "Cannot send email. Please check your SMTP config."
ユーザー名とパスワードでサインインするサーバー、またはサインインしないサーバーがメールを受け付けないときに、**テストメールを送信** にこのメッセージが表示されます。**ホスト名**、**ポート**、**ユーザー名**、**パスワード** を確認してください。サーバーが TLS に対応していない場合や、証明書がホスト名に対して有効でない場合は、**その他の項目** で **TLS を必須にする** をオフにしてもう一度試します。サーバー自身の応答はテストとともに保存されています。**プロジェクト設定 > 通知 > 通知ログ** の **メール** タブを開き、該当する行で **ステータスメッセージを表示** を選んでください。
:::

:::details "Cannot send email with OAuth authentication"
OAuth でのサインインに失敗しました。メッセージの末尾には、プロバイダーが返したエラーが付いています。**OAuth クライアント ID**、**OAuth クライアントシークレット**、**OAuth トークン URL**、**OAuth スコープ** を確認し、アプリケーションに上記の権限があること、管理者の同意が付与されていることを確認してください。Microsoft 365 テナントで SMTP AUTH がオフになっている場合は、代わりに **トランスポート** を `Microsoft Graph` に設定します。
:::

:::details "Microsoft Graph send failed"
**トランスポート** が `Microsoft Graph` の設定で、Graph がメールを受け付けないときにこのメッセージが表示され、続けて Microsoft 自身のエラーが示されます。アプリに管理者の同意付きの **Mail.Send** アプリケーション権限があること、**OAuth スコープ** が `https://graph.microsoft.com/.default` であること、**送信元メールアドレス** がテナント内のライセンスのあるメールボックスであることを確認してください。
:::

:::details "SMTP server host … could not be reached"
OneUptime がプロジェクトのメールサーバーへの接続を拒否しました。OneUptime Cloud では、名前解決できないホスト名、またはプライベート、ループバック、リンクローカルのアドレスに解決されるホスト名は、このメッセージで拒否されます。どの場合かはメッセージには示されません。メールサーバーの公開ホスト名を使ってください。セルフホストのインストールや、IP アドレスで指定したメールサーバーの場合は、代わりに理由がメッセージに示されます。**テストメールを送信** がこのメッセージを表示するのは OAuth の設定の場合だけです。それ以外の設定では、通知ログの **メール** タブで **ステータスメッセージを表示** から確認できます。
:::

:::details テストメールが届かない
**送信元メールアドレス** を確認してください。そのアドレスからの送信を、サーバーが許可している必要があります。次に、受信者の迷惑メールフォルダーと、メールサーバーのログで送信の試行を確認します。
:::

## セキュリティのベストプラクティス

- **シークレットを定期的にローテーションする。** クライアントシークレットが期限切れになる前に置き換えるよう、リマインダーを設定します。
- **専用の認証情報を使う。** 他のアプリケーションと共有せず、OneUptime 専用の認証情報を作成します。
- **最小限の権限を与える。** 送信に必要なものだけを付与します: Microsoft では **SMTP.SendAsApp**、Google ではスコープ `https://mail.google.com/` です。
- **使用状況を監視する。** メールのログと OAuth アプリケーションのサインインに、普段と違う動きがないか確認します。
- **シークレットを安全に保管する。** クライアントシークレットをバージョン管理にコミットしないでください。

## 参考資料

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## 次のステップ

:::cards
- [通知のまとめ](/docs/emails/notification-rollup): 所有者宛てのメールが集中したときに OneUptime がどうまとめるか。
- [購読者とお知らせ](/docs/status-pages/subscribers): プロジェクトの SMTP 設定を使って、ステータスページの購読者にメールを送ります。
:::
