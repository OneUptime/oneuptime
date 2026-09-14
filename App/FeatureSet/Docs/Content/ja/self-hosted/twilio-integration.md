# Twilio SMS・音声通話の統合

セルフホスト型のOneUptimeは、お客様のTwilioアカウントを使用してSMSと音声アラートを送信します。料金はTwilioに直接支払います。認証情報はOneUptimeのダッシュボードで設定してください。通知の配信には保存済みの設定が使用され、HelmチャートにはTwilioの認証情報を設定する値はありません。過去の移行処理では`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_PHONE_NUMBER`が取り込まれましたが、これらの変数を変更しても既存の環境の認証情報は更新できません。

## 1. Twilioアカウントを準備する

1. [Twilio Console](https://console.twilio.com/)を開き、**Account SID**と**Auth Token**を取得します。
2. 必要なSMSや音声通話機能を備えたTwilioの電話番号を取得します。発信元と宛先の番号には、国番号を含むE.164形式を使用します。
3. アカウント残高、宛先国への送信許可、適用される送信者登録要件を確認します。試用アカウントには宛先、地域などの制限があり、実際のOneUptimeアラートを送信できない場合があります。テスト前に[Twilioのアカウントと試用版の説明](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)を確認してください。本番環境ではアップグレードしたアカウントを使用します。

## 2. OneUptimeに認証情報を保存する

プロジェクト単位で設定する場合：

1. **プロジェクト設定 > 通知 > 通知設定**に移動します。
2. **Twilio設定**で**Twilio設定を作成**を選択します。
3. 名前、**Twilio Account SID**、**Twilio Auth Token**、**Twilioプライマリ電話番号**を入力します。必要に応じて、他の国向けの**Twilioセカンダリ電話番号**をカンマ区切りで入力します。
4. **プロジェクトのデフォルトに設定**を有効にすると、オンコール通知を含むプロジェクトメンバーへのSMSと通話にこの設定が使用されます。設定を作成しただけでは、これらの通知に使用する設定として選択されません。
5. 保存します。プロジェクトのデフォルトに指定できる設定は1つだけです。ステータスページでは、各ページに明示的に割り当てられた設定が使用されます。

環境全体のデフォルトを設定する場合、管理者は**管理ダッシュボード > 設定 > 通話とSMS**を開き、Twilioの認証情報と電話番号を編集して保存できます。プロジェクトにデフォルトがない場合、メンバー通知にはこの全体設定が使用されます。Auth Tokenは機密情報として管理してください。

## 3. ネットワークアクセスを設定する

プライベート環境からSMSや通話を送信するには、TwilioへのアウトバウンドHTTPSアクセスが必要です。APIのアドレスは動的に変わるため、Twilioは`*.twilio.com`へのアウトバウンドHTTPSを許可するよう推奨しています。[TwilioのIPアドレス](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)を参照してください。KubernetesのNetworkPoliciesや外部ファイアウォールを含め、OneUptimeアプリケーションのワークロードからの送信通信に適用します。 OneUptimeアプリケーションからのDNS解決とアウトバウンドHTTPS (TCP 443)を許可します。

インバウンドアクセスの必要性は機能によって異なります。

| 機能 | TwilioからOneUptimeへのアクセスは必要ですか？ |
| --- | --- |
| SMSの送信要求 | 不要です。ただし、配信状況の更新にはコールバックが必要です。 |
| 通常のテスト音声通話 | 不要です。OneUptimeは発信APIリクエストに読み上げ指示を含めます。 |
| 1を押してオンコールアラートを確認 | 必要です。Twilioはキーパッド入力をOneUptimeに送信します。 |
| 着信通話ポリシー | 必要です。Twilioは通話指示を取得し、発信結果を報告します。 |

以下はOneUptimeのNginxゲートウェイを通る外部パスです。プレースホルダーは通知ごとに異なります。

| メソッド | パス | 用途 |
| --- | --- | --- |
| POST | `/notification/sms/status-callback/:smsLogId/:token` | SMSの配信状況 |
| POST | `/api/user-notification-log-timeline/call/gather-input/:itemId?token=...` | キーパッドによる確認 |
| POST | `/notification/incoming-call/voice` | 任意の着信通話指示 |
| POST | `/notification/incoming-call/dial-status/:callLogId/:callLogItemId` | 任意の着信通話ルーティング結果 |

OneUptimeはSMSと確認操作のURLを自動生成します。これらのトークンを固定のWebhook URLに置き換えないでください。着信通話については、電話番号を関連付ける際にその番号のWebhookを設定する[着信通話ポリシー](/docs/on-call/incoming-call-policy)に従ってください。

Twilioには[公開アクセス可能なWebhook URL](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)が必要です。公開認証局の信頼されたTLS証明書を使用し、プロキシ経由でも元のホスト、プロトコル、パス、クエリパラメーター、本文、`X-Twilio-Signature`ヘッダーを維持してください。着信通話のハンドラーはTwilioの署名を検証します。SMS配信にはメッセージごとのURLトークンを、キーパッドによる確認には署名付きクエリトークンを使用します。共有するログやスクリーンショットにトークンを含めないでください。[TwilioのWebhookセキュリティ](https://www.twilio.com/docs/usage/webhooks/webhooks-security)を参照してください。

### 本番環境：プライベート環境へのゲートウェイを公開する

1. **ホスト名を選択します**。例：`oneuptime.example.com`。インターネットに公開したゲートウェイを指す公開DNSレコードを作成します。プライベートIPアドレスや内部専用のDNS名には、プロバイダーから到達できません。スプリットDNSを使用すると、従業員は同じホスト名をプライベートイングレスに解決し、VPN経由でダッシュボードを引き続き使用できます。プライベートイングレスでも、そのホスト名に有効な証明書でHTTPSを提供する必要があります。

2. **ゲートウェイをOneUptimeに接続します。** プライベートイングレスへの経路を持つDMZに配置するか、独自のサイト間VPNまたはプライベートリンクで接続された公開ゲートウェイを使用します。ゲートウェイからイングレスへの通信を、上流サービスのポートで許可してください。Kubernetes/Portainerでは、非公開の`ClusterIP`サービスだけでは不十分です。ゲートウェイにはイングレス・コントローラー、または到達可能な上流接続先が必要です。データベースやその他の内部サービスは非公開のままにします。

3. **ポート443でHTTPSを終端します。** 公開認証局の信頼された証明書と完全な中間証明書チェーンを使用します。ゲートウェイへのインバウンドTCP 443を許可してください。証明書のインストールやDNSの変更だけでは、プライベートな上流接続先への経路は作成されません。

4. 上の表にある必要なコールバックパスだけをOneUptimeのNginxゲートウェイ経由で公開します。このゲートウェイは`/notification`をアプリケーションへ転送します。キー入力による確認のパスでは`/api`を保持してください。 メソッド、パス、クエリ文字列、本文、認証ヘッダー（`X-Twilio-Signature`）を保持します。公開`Host`を維持し、信頼できる`X-Forwarded-Host`と`X-Forwarded-Proto: https`を設定してください。リダイレクトは追加しないでください。

5. これらのパスをブラウザーSSO、CAPTCHA、プロキシのログイン画面の対象外にします。OneUptimeの認証は有効に保ちます。オリジンへのアクセスはゲートウェイと許可済みの内部クライアントに制限し、ログではトークンを隠してください。

6. **OneUptimeの正規URLを設定します**:

   Docker Composeでは`config.env`に設定します。

   ```dotenv
   HOST=oneuptime.example.com
   HTTP_PROTOCOL=https
   ```

   Helm/Portainerの値：

   ```yaml
   host: oneuptime.example.com
   httpProtocol: https
   ```

   例を実際のドメインに置き換えてください。これらの設定はURLを生成するもので、DNS、TLS、ファイアウォール規則は作成しません。Compose設定またはHelm更新を適用し、アプリケーションの再起動を待ちます。 OneUptimeにはTwilioコールバック専用のホスト名設定はありません。名前を変更した場合は、既存のTwilio電話番号のWebhookも更新してください。

[プライベートネットワークアクセス設定](/docs/self-hosted/private-network-access)は、OneUptimeから内部サービスへのアウトバウンドリクエストを制御します。`ALLOW_PRIVATE_NETWORK_WEBHOOKS`を有効にしても、TwilioからOneUptimeに到達できるようにはなりません。

### アウトバウンドアクセスとIP制限

通常のTwilio Webhookの送信元アドレスは変わります。SIPやメディアの範囲をコールバック許可リストに使わないでください。対象エディションでは[Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)を利用できます。利用資格と対応製品を確認し、最新の公開範囲でファイアウォールを設定します。コールバック認証は継続してください。

### テストとインバウンドアクセスのない環境

受信アクセスがなくても、送信HTTPSがあればSMS送信と単純な音声再生は可能です。配信状態、キー入力による確認、着信ルーティングには到達可能なコールバックが必要です。完全に切断された環境ではTwilioを利用できません。

開発時の公開トンネルについては、Twilioの[Webhookテストガイド](https://www.twilio.com/docs/usage/webhooks/webhook-testing)を参照してください。必要なパスだけを許可するプロキシへ転送し、取得したホスト名を上記のとおり設定して、テスト後に停止します。トンネルも受信アクセスを公開します。

## 4. 配信とコールバックを別々にテストする

1. 社内ネットワークとVPNの外部から、コールバックのホスト名が公開ゲートウェイに解決され、有効なTLS証明書を提示することを確認します。ブラウザーのGETではこれらのPOSTコールバックを検証できません。
2. プロジェクトのTwilio設定で**テストSMSを送信**と**テスト通話を発信**を使用します。宛先の電話で受信を確認します。
3. ユーザーの確認済みSMS・通話連絡先と通知ルールを設定し、管理されたテスト用オンコールアラートを発生させます。1を押して、OneUptimeで確認済みになったことを確認します。 着信ポリシーを利用する場合は、設定した番号に電話してルーティングと通話ログを確認してください。
4. OneUptimeとTwilioのメッセージログでSMSの配信状況を確認します。送信要求の受理は配信成功の証明ではありません。[Twilioは後続のステータス変更をコールバックで通知します](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status)。

送信に失敗した場合は、認証情報、電話番号の機能、アカウントの制限、アウトバウンド接続を確認してください。メッセージや通話は届いてもステータスや確認状態が更新されない場合は、コールバックURLと公開イングレスのログを調べます。Twilioの[HTTP取得失敗に関する説明](https://www.twilio.com/docs/api/errors/11200)は、到達できないコールバック、TLSの問題、HTTPエラーの診断に役立ちます。テスト通話の成功だけではコールバックへのアクセスは検証できません。
