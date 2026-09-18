# SendGridインバウンドメール統合

OneUptimeの **受信メールモニター** を使用すると、モニター固有のメールアドレスに送信されたメールに基づいてアラートの作成と解決ができます。これはレガシーシステム、アラートツール、またはメールを送信できる任意のサービスとの統合に役立ちます。

このガイドでは、受信メールをセルフホストのOneUptimeインスタンスに転送するためのSendGrid Inbound Parseのセットアップ方法を説明します。

## 前提条件

- Inbound Parse にアクセスできる SendGrid アカウント
- 管理権限を持つドメイン（DNSの設定変更可能なもの）
- SendGrid Webhook を OneUptime に転送する公開 HTTPS エンドポイント

## ネットワークアクセス

Inbound Parse では SendGrid から OneUptime への接続が必要です。OneUptime からインターネットへのアウトバウンド通信だけでは動作しません。

| 方向 | 宛先 | プロトコル / ポート | 用途 |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | 解析済みメールを multipart POST で配信します。 |
| 送信元メールサーバー → SendGrid | 受信ドメインの公開 MX レコードで指定した `mx.sendgrid.net` | SMTP / TCP 25 | SendGrid でメールを受信します。OneUptime サーバーへの接続ではありません。 |
| OneUptime → SendGrid（メール送信を別途設定した場合のみ） | `api.sendgrid.com` | HTTPS / TCP 443 | Mail Send API で通知メールを送信します。 |

Webhook のホスト名に公開 DNS を設定し、公開クライアントが信頼する証明書を使用してください。プライベート環境では、OneUptime に内部接続できる公開リバースプロキシやゲートウェイを通じて Webhook パスだけを公開できます。パス、シークレット、コンテンツタイプ、multipart 本文を保持し、対話的ログインやブラウザー検証なしで POST を許可します。OneUptime に受信用 SMTP リスナーは不要です。[SendGrid の設定手順](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook)を参照してください。

`INBOUND_EMAIL_WEBHOOK_SECRET` に強力なランダム値を設定し、`YOUR_SECRET` をその値に置き換えます。最後のパス要素は必須です。OneUptime は設定済みシークレットと比較し、変数が空の場合は検証を無効にします。完全な URL とモニターのメールアドレスはプロキシログも含めて秘密にしてください。OneUptime は現在 SendGrid の Inbound Parse 署名ヘッダーや OAuth トークンを検証しません。必要な場合は、[SendGrid のセキュリティ文書](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks)に従ってゲートウェイで検証してから転送します。

SendGrid は Inbound Parse 送信元の信頼できる固定 IP リストを提供していません。メール送信 IP や `mx.sendgrid.net` の DNS 解決結果を Webhook の許可リストに使用しないでください。[SendGrid のファイアウォール指針](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs)を参照してください。

Inbound Parse とメール送信は別機能です。受信のために OneUptime が SendGrid API を呼び出す必要はありません。SendGrid で通知も送信する場合は DNS と `api.sendgrid.com` へのアウトバウンド HTTPS を許可します。[Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)への送信にインバウンドコールバックは不要です。SMTP の場合は OneUptime に設定したサーバーとポートを許可します。

公開 MX を確認し、テストモニターにメールを送り、Webhook の受信と該当アラートの作成または解決を確認してください。空の POST や送信メールのテスト成功だけでは Inbound Parse の一連の処理を検証できません。

## 仕組み

1. OneUptimeで **受信メールモニター** を作成します
2. OneUptimeがそのモニター用の一意のメールアドレスを生成します（例：`monitor-abc123@inbound.yourdomain.com`）
3. そのアドレスにメールが送信されると、SendGridがそれを受信してWebhook経由でOneUptimeに転送します
4. OneUptimeは設定した条件に基づいてメールを評価してアラートを作成または解決します

## セットアップ手順

### ステップ1：インバウンドメールドメインの選択

受信メール専用のサブドメインが必要です。以下のようなサブドメインの使用を推奨します：

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

このサブドメインはOneUptimeのモニターメール専用として使用されます。

### ステップ2：DNS MXレコードの設定

インバウンドサブドメインのメールをSendGridにルーティングするために、DNS設定にMXレコードを追加します。

| タイプ | ホスト/名前 | 優先度 | 値              |
| ------ | ----------- | ------ | --------------- |
| MX     | inbound     | 10     | mx.sendgrid.net |

**例：** ドメインが `example.com` で `inbound.example.com` を使用する場合：

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**注意：** DNSの変更は伝播に最大48時間かかる場合がありますが、通常は数時間で完了します。

### ステップ3：SendGrid でドメインを認証する

受信ドメインは、[SendGrid で認証済みのドメイン](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse)に属する必要があります。

1. [SendGridダッシュボード](https://app.sendgrid.com) にログインします
2. **設定** > **送信者認証** に移動します
3. **ドメインを認証** をクリックします
4. 必要なDNSレコードを追加するためのプロンプトに従います（DKIM用のCNAMEレコード）

### ステップ4：SendGrid Inbound Parseの設定

1. [SendGridダッシュボード](https://app.sendgrid.com) にログインします
2. **設定** > **Inbound Parse** に移動します
3. **「ホストとURLを追加」** をクリックします
4. 以下を設定します：

| フィールド                         | 値                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------- |
| **受信ドメイン**                   | インバウンドサブドメイン（例：`inbound.yourdomain.com`）                |
| **宛先URL**                        | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **受信メールのスパムチェック**     | オプション — 必要に応じて有効にする                                     |
| **生の完全なMIMEメッセージを送信** | チェック不要                                                            |
| **生の完全なMIMEメッセージをPOST** | チェック不要                                                            |

5. **「追加」** をクリックします

### ステップ5：OneUptime環境変数の設定

#### Docker Compose

`config.env` ファイルにこれらの環境変数を追加します：

```bash
# インバウンドメール設定
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### KubernetesとHelm

`values.yaml` ファイルにこれらを追加します：

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

ステップ4の送信先 URL と同じシークレットを設定し、変更後に OneUptime を再起動してください。

### ステップ6：受信メールモニターの作成

1. OneUptime ダッシュボードにログインします
2. **モニター** > **モニターを作成** に移動します
3. モニタータイプとして **受信メール** を選択します
4. モニターを設定します：
   - **名前：** モニターのわかりやすい名前を入力
   - **説明：** このモニターの目的を記述
5. **アラート作成条件** を設定します（アラートを作成するタイミング）：
   - 例：メール件名に「ALERT」または「CRITICAL」が含まれる
6. **アラート解決条件** を設定します（アラートを解決するタイミング）：
   - 例：メール件名に「RESOLVED」または「OK」が含まれる
7. **作成** をクリックします

作成後、このモニター用の一意のメールアドレスが表示されます（例：`monitor-abc123def456@inbound.yourdomain.com`）。

### ステップ7：統合のテスト

1. OneUptime ダッシュボードからモニターのメールアドレスをコピーします
2. アラート条件と一致する件名でそのアドレスにテストメールを送信します
3. OneUptime ダッシュボードで以下を確認します：
   - メールが受信されたか（モニターサマリーで確認可能）
   - アラートが作成されたか（条件と一致した場合）

## 環境変数リファレンス

| 変数                           | 説明                                                                                                         | 必須   | デフォルト |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------ | ---------- |
| `INBOUND_EMAIL_PROVIDER`       | 使用するインバウンドメールプロバイダー                                                                       | はい   | -          |
| `INBOUND_EMAIL_DOMAIN`         | インバウンドメール用に設定したサブドメイン                                                                   | はい   | -          |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | `/incoming-email/sendgrid/YOUR_SECRET` の最後のパス要素と比較します。公開エンドポイントでは設定してください。空値は検証を無効にします。 | 推奨 | - |

## サポートされるメール条件

受信メールモニターを設定する際、以下のフィールドに基づいて条件を作成できます。

| フィールド         | 説明                               | 利用可能なフィルター                                                 |
| ------------------ | ---------------------------------- | -------------------------------------------------------------------- |
| **メールの件名**   | メールの件名                       | 含む、含まない、等しい、等しくない、始まる、終わる、空白、空白でない |
| **送信元メール**   | 送信者のメールアドレス             | 含む、含まない、等しい、等しくない、始まる、終わる、空白、空白でない |
| **メール本文**     | メールのプレーンテキスト本文       | 含む、含まない、等しい、等しくない、始まる、終わる、空白、空白でない |
| **メール宛先**     | 受信者のメールアドレス             | 含む、含まない、等しい、等しくない、始まる、終わる、空白、空白でない |
| **メール受信日時** | 最後のメールが受信されてからの時間 | X分以内に受信、X分以内に未受信                                       |

## ユースケース例

### レガシーシステムのアラート

多くのレガシーシステムはメールアラートのみ送信できます。受信メールモニターを使用して：

- レガシーシステムが `[CRITICAL]` メールを送信したときにOneUptimeアラートを作成する
- `[RESOLVED]` メールを受信したときにアラートを解決する

### サードパーティサービスの統合

メール通知を送信するサービスとの統合：

- API統合のない監視ツール
- クラウドプロバイダーの通知
- セキュリティスキャンツール

### メールによるハートビート

定期的なメールが受信されることを確認するために「メール受信日時」条件を使用します：

- 60分間メールが受信されなかった場合にアラートを作成する
- 完了メールを送信するバッチジョブやスケジュールタスクの監視に役立ちます

## トラブルシューティング

### メールが受信されない場合

1. **DNSの伝播を確認：**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   `mx.sendgrid.net` が返されることを確認してください

2. **SendGrid Inbound Parseの設定を確認：**

   - SendGridダッシュボードにログイン
   - 設定 > Inbound Parseに移動
   - ドメインとWebhookURLが正しいことを確認

3. **OneUptimeのログを確認：**
   - OneUptime のアプリケーションログ（Telemetry / ProbeIngest）で受信メール Webhook を確認します。
   - エラーメッセージがないか確認

### Webhookが失敗する場合

- シークレットを含む完全な HTTPS URL にインターネットから到達できる必要があります。最後のパス要素がない URL はルートに一致しません。
- ログインへのリダイレクトやブラウザー検証を要求せず POST を許可してください。SendGrid のメール送信 IP は Webhook 送信元の許可リストではありません。
- 公開クライアントが信頼する証明書と完全な証明書チェーンを使用し、「ネットワークアクセス」の手順で配信を確認してください。

### モニターがアラートを作成しない場合

1. **条件設定を確認：**

   - アラート作成条件がメール内容と一致しているか確認
   - パターンマッチングを使用する前に完全一致の文字列でテスト

2. **モニターのステータスを確認：**

   - モニターが無効になっていないことを確認
   - モニタータイプが「受信メール」であることを確認

3. **モニターサマリーを確認：**
   - メールが受信・処理されたか確認
   - 条件マッチングの評価ログを確認

### SendGridのWebhook配信ログ

SendGridがWebhookを正常に送信しているか確認するには：

1. 残念ながら、SendGridはInbound Parseの詳細なログを提供していません
2. OneUptimeサーバーのログで受信WebhookリクエストをN確認します
3. [RequestBin](https://requestbin.com) などのツールを一時的にWebhook配信テストに使用します

## セキュリティのベストプラクティス

1. **HTTPSを使用する：** WebhookエンドポイントにはHTTPSを使用してください
2. **Webhookシークレット：** `INBOUND_EMAIL_WEBHOOK_SECRET` を設定してWebhookURL（例：`/incoming-email/sendgrid/your-secret`）に含めることで、追加の検証ができます
3. **ドメイン認証：** より良いメールセキュリティのためにSendGridでドメインを認証してください
4. **アクセスを制限する：** 信頼できるメールソースのみのモニターを作成してください
5. **ログを監視する：** 不審なアクティビティのために受信メールのログを定期的に確認してください

## 代替プロバイダー

OneUptimeは複数のインバウンドメールプロバイダーをサポートするよう設計されています。現在サポートされているプロバイダー：

| プロバイダー           | ステータス   |
| ---------------------- | ------------ |
| SendGrid               | サポート済み |
| Haraka（セルフホスト） | 計画中       |

別のプロバイダーのサポートが必要な場合は、お問い合わせいただくか、機能リクエストを提出してください。

## サポート

SendGridインバウンドメール統合に問題が発生した場合：

1. 上記のトラブルシューティングセクションを確認する
2. OneUptimeのログで詳細なエラーメッセージを確認する
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) に連絡する

この統合の改善のためのフィードバックをお待ちしています！
