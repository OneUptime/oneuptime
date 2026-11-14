# メールプロバイダー

OneUptime のメールを、SMTP サーバーの代わりにメールプロバイダーの HTTPS API から送信します。対応しているのは Amazon SES、SendGrid、Mailgun、Postmark、Resend です。プロジェクトでは SMTP 設定でプロバイダーを選べます。セルフホストのインストールでは、OneUptime 自身のメールをすべてプロバイダー経由で送信できます。API にはポート 443 の HTTPS で接続するため、SMTP のポートをブロックしているネットワークからでもメールを送信でき、各プロバイダーのキーは暗号化して保存されます。

:::cards
- [Amazon SES](#amazon-ses): IAM のアクセスキー、またはサーバー自身の IAM ロールと、送信者を検証したリージョン。
- [SendGrid](#sendgrid): Mail Send のアクセス権を持つ API キー。
- [Mailgun](#mailgun): API キー、送信ドメインとそのリージョン。
- [Postmark](#postmark): サーバーの API トークン。
- [Resend](#resend): 送信のアクセス権を持つ API キー。
- [トラブルシューティング](#トラブルシューティング): 各プロバイダーの拒否とその意味。
:::

## プロバイダーを選ぶ

:::tabs
@tab プロジェクト
**プロジェクト設定 > 通知 > 通知チャネル** で **その他の設定** を開き、**カスタム SMTP 設定** カードで **SMTP 設定を作成** をクリックします。**プロバイダー** ステップで **名前** を入力し、プロバイダーを選びます。次のステップではそのプロバイダーの設定を、**送信者** ステップでは **送信元メールアドレス** と **差出人名** を尋ねられます。保存すると、設定の行にある **テストメールを送信** で動作を確認できます。
@tab セルフホストのインスタンス
Admin Dashboard で **設定** を開き、**通知 > メール** を開きます。**メールサーバー設定** カードで **サーバーを編集** をクリックし、**メールサーバーの種類** としてプロバイダーを選びます。その下に **Amazon SES設定** のようなプロバイダーのカードが表示されます。**Amazon SESを編集** のような編集ボタンをクリックし、プロバイダーの設定と **送信者** ステップを入力します。必要な設定がそろうまでは、カードに足りないものが表示され、メールはどれも、入力すべき設定を示して拒否されます。
:::

| プロバイダー | 必要な設定 | OneUptime の送信先 |
| --- | --- | --- |
| Amazon SES | アクセスキー ID、シークレットアクセスキー、リージョン | `https://email.<region>.amazonaws.com` (SES API v2) |
| SendGrid | API キー | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API キー、ドメイン、リージョン | `https://api.mailgun.net` または `https://api.eu.mailgun.net` |
| Postmark | サーバー API トークン | `https://api.postmarkapp.com/email` |
| Resend | API キー | `https://api.resend.com/emails` |

どのメールにも、テキストパートと、インライン添付ファイルとしての画像 (OneUptime のロゴやスクリーンショット) が含まれます。プロバイダーが送信速度を制限したときや、プロバイダー側で障害が起きたときは、OneUptime はプロバイダーが指定する時間だけ待ってから再試行します。それ以外の拒否は、プロバイダーの応答とともに通知ログに残ります。

## Amazon SES

:::steps
### 送信者を検証する

[Amazon SES コンソール](https://console.aws.amazon.com/ses/) で送信に使うリージョンを選び、**Identities** で送信元のアドレスまたはそのドメインを検証します。アカウントが SES のサンドボックスにある間は、受信者もそれぞれ検証するか、本番アクセスをリクエストしてください。

### アクセスキーを作成する

OneUptime 用の IAM ユーザーを作成して、検証したアイデンティティに対する `ses:SendEmail` を許可するポリシーを付け、そのユーザーのアクセスキーを作成します。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

AWS 上のセルフホスト環境では、キーを使わずに、同じポリシーで [サーバーの IAM ロールでサインインする](#サーバーの-iam-ロールでサインインする) こともできます。

### Amazon SES のステップを入力する

**アクセスキー ID** と **シークレットアクセスキー**、そしてアイデンティティを検証した **リージョン** (`us-east-1` など) を入力します。
:::

### サーバーの IAM ロールでサインインする

AWS 上のセルフホスト環境は、AWS がサーバーに与える IAM ロールとして自身のメールを送信でき、OneUptime にアクセスキーは保存されません。AWS が発行する認証情報は数時間で期限切れになり、OneUptime は期限が切れる前に新しいものを取得します。これはサーバー自身のメール専用です。プロジェクトの Amazon SES 設定は常にアクセスキーでサインインします。サーバーのロールはプロジェクトのものではなく、サーバー自身の AWS ID だからです。

ロールに上記のポリシーを付け、OneUptime をそのロールで実行します。

:::tabs
@tab Amazon EKS
サービスアカウントの IAM ロールを使う場合は、クラスターの OIDC プロバイダーを信頼するポリシーでロールを作成し、Helm チャートにそのロールの ARN を持つサービスアカウントを作成させます。OneUptime の app と worker の Pod はこのアカウントで実行されます。

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

EKS Pod Identity を使う場合は、代わりにロールとそのサービスアカウントの Pod Identity の関連付けを作成し、アノテーションは省きます。
@tab Amazon ECS
ロールを OneUptime のタスク定義の **Task role** に設定します。
@tab Amazon EC2
ロールをインスタンスプロファイルとしてインスタンスにアタッチします。インスタンス上の Docker で OneUptime を実行する場合は、コンテナからアクセスできるように、インスタンスメタデータのホップ制限を 2 に上げます。

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

次に Admin Dashboard で **Amazon SESを編集** をクリックし、**認証タイプ** として **このサーバーの IAM ロール** を選び、**リージョン** を入力します。保存すると、それまでに保存されていたアクセスキーは削除されます。

OneUptime は AWS SDK と同じ場所を、次の順序で探してサーバーの認証情報を見つけます: 環境の `AWS_ACCESS_KEY_ID` と `AWS_SECRET_ACCESS_KEY`、Web ID トークン (`AWS_ROLE_ARN` と `AWS_WEB_IDENTITY_TOKEN_FILE`)、Amazon ECS と EKS Pod Identity のコンテナ認証情報エンドポイント、最後に EC2 のインスタンスメタデータサービス (IMDSv2)。

## SendGrid

SendGrid で **Settings > API Keys** を開いて **Mail Send** のアクセス権を持つキーを作成し、送信元のアドレス (Single Sender Verification) またはそのドメイン (Domain Authentication) を検証します。そのキーを **SendGrid** ステップの **API キー** に入力します。

## Mailgun

Mailgun で `mg.example.com` のような送信ドメインを追加して検証し、そのドメイン用の送信キーを作成するか、アカウントの API キーを使います。**Mailgun** ステップで **API キー** と **ドメイン** を入力し、ドメインを作成した **リージョン** を選びます: Mailgun の EU リージョンのドメインなら `EU`、それ以外なら `US` です。**送信元メールアドレス** は、そのドメインのアドレスでなければなりません。サンドボックスドメインは、承認された受信者にしか送信しません。

## Postmark

Postmark で送信に使うサーバーを開き、その **API Tokens** タブでサーバー API トークンをコピーします。アカウントトークンでは送信できません。それを **Postmark** ステップの **サーバー API トークン** に入力します。**送信元メールアドレス** は、確認済みの送信者署名か、検証済みドメインのアドレスでなければなりません。Postmark がアカウントを承認するまでは、自分のドメインのアドレスにしか送信されません。

## Resend

Resend の **Domains** でドメインを追加して検証し、**API Keys** で送信のアクセス権を持つ API キーを作成します。それを **Resend** ステップの **API キー** に入力し、**送信元メールアドレス** には検証済みドメインのアドレスを使います。Resend 自身のテスト用ドメインは、自分のアドレスにしか送信しません。

## トラブルシューティング

テストメールが送信されなかった場合は、その理由が表示されます。それ以外のメールについては、**プロジェクト設定 > 通知 > 通知ログ** の **メール** タブを開き、該当する行で **ステータスメッセージを表示** を選んでください。

:::details "Amazon SES needs a verified identity in …"
**送信元メールアドレス** またはそのドメインが、設定で指定したリージョンで検証されていないか、アカウントが SES のサンドボックスにあり、受信者が検証されていません。そのリージョンで検証するか、本番アクセスをリクエストしてください。
:::

:::details "Amazon SES does not recognize the access key" または "did not accept the request's signature"
**アクセスキー ID** と、そのキーが IAM で有効になっていること、**シークレットアクセスキー** がそのキーと一緒に作成されたものであることを確認してください。サーバーの時計がずれている場合も、署名は拒否されます。
:::

:::details "The access key may not send with Amazon SES"
IAM ユーザーのポリシーで、アイデンティティに対する `ses:SendEmail` が許可されていません。上記のポリシーを追加してください。
:::

:::details "This server has no AWS credentials"
サーバーは IAM ロールでサインインしますが、AWS が認証情報を与えていません。[サーバーの IAM ロールでサインインする](#サーバーの-iam-ロールでサインインする) のとおりにロールで実行してから、OneUptime の Pod またはタスクを再起動してください。Pod は起動時にロールの設定を受け取ります。Amazon EC2 上の Docker では、インスタンスメタデータのホップ制限が低すぎる場合もメッセージに示されます。
:::

:::details "This server's IAM role may not send with Amazon SES" または "did not let this server assume the role"
ロールのポリシーで、アイデンティティに対する `ses:SendEmail` が許可されていません。上記のポリシーを追加してください。または Amazon EKS では、ロールの信頼ポリシーで、クラスターの OIDC プロバイダーと OneUptime のサービスアカウントに対する `sts:AssumeRoleWithWebIdentity` が許可されていません。
:::

:::details "Mailgun has no domain … in its US region"
ドメインが、設定で送信先にしているリージョンにありません。**ドメイン** を確認し、ドメインを EU リージョンで作成した場合は **リージョン** を `EU` に設定します。
:::

:::details "is not a confirmed sender signature in Postmark" または "is not a verified domain in Resend"
プロバイダーのダッシュボードで、**送信元メールアドレス** を送信者として確認するか、そのドメインを検証してください。
:::

:::details "did not accept the API key" または "did not accept the server API token"
設定のキーを確認してください: SendGrid のキーには Mail Send のアクセス権が必要で、Mailgun の送信キーはそのドメインでしか使えません。Postmark にはサーバーのトークンが必要で、Resend のキーには送信のアクセス権が必要です。
:::

## 次のステップ

:::cards
- [SMTP](/docs/emails/smtp): 代わりに自分のメールサーバーや Microsoft 365 から送信します。
- [購読者とお知らせ](/docs/status-pages/subscribers): プロジェクトの SMTP 設定を使って、ステータスページの購読者にメールを送ります。
:::
