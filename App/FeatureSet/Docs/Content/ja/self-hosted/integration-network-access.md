# プライベートネットワークからの統合アクセス

セルフホスト型のOneUptimeは、TwilioやMicrosoftにリクエストを送信できても、それらのクラウドサービスからは到達できない場合があります。従業員のVPN接続は、どちらのプロバイダーにもプライベートネットワークへのアクセスを提供しません。[Twilioの設定ガイド](/docs/self-hosted/twilio-integration)と[Teamsの設定ガイド](/docs/self-hosted/microsoft-teams-integration)を、以下のネットワーク設定手順と併せて使用してください。

## どちらの方向にアクセスが必要ですか？

| 機能 | OneUptimeからプロバイダー | プロバイダーからOneUptime |
| --- | --- | --- |
| SMS送信または単純な発信音声アラートの再生 | HTTPS | SMSの送信要求やインライン音声指示の再生には不要 |
| SMS配信状況の更新、音声通話のキーパッド操作、着信通話のルーティング | HTTPS | コールバックが必要。ルートはTwilioガイドを参照 |
| Teams通知 | Microsoft APIへのHTTPS | 会話の検出を含む完全なボット統合には必要 |
| Teamsコマンド、カードのボタン、チャットへのインストールイベント | HTTPS | `POST /api/microsoft-bot/messages` |

[プライベートネットワークアクセス設定](/docs/self-hosted/private-network-access)は、OneUptimeから内部サービスへのアウトバウンドリクエストを制御します。`ALLOW_PRIVATE_NETWORK_WEBHOOKS`を有効にしても、TwilioやTeamsからOneUptimeに到達できるようにはなりません。

## 本番環境：プライベート環境へのゲートウェイを公開する

```text
Twilio / Azure Bot Service
          | HTTPS :443
          v
公開ゲートウェイ（リバースプロキシまたはロードバランサー）
          | プライベート接続、コールバックルートのみ
          v
プライベートOneUptimeイングレス -> OneUptimeアプリケーション
```

1. **ホスト名を選択します**。例：`oneuptime.example.com`。インターネットに公開したゲートウェイを指す公開DNSレコードを作成します。プライベートIPアドレスや内部専用のDNS名には、プロバイダーから到達できません。スプリットDNSを使用すると、従業員は同じホスト名をプライベートイングレスに解決し、VPN経由でダッシュボードを引き続き使用できます。プライベートイングレスでも、そのホスト名に有効な証明書でHTTPSを提供する必要があります。
2. **ゲートウェイをOneUptimeに接続します。** プライベートイングレスへの経路を持つDMZに配置するか、独自のサイト間VPNまたはプライベートリンクで接続された公開ゲートウェイを使用します。ゲートウェイからイングレスへの通信を、上流サービスのポートで許可してください。Kubernetes/Portainerでは、非公開の`ClusterIP`サービスだけでは不十分です。ゲートウェイにはイングレス・コントローラー、または到達可能な上流接続先が必要です。データベースやその他の内部サービスは非公開のままにします。
3. **ポート443でHTTPSを終端します。** 公開認証局の信頼された証明書と完全な中間証明書チェーンを使用します。ゲートウェイへのインバウンドTCP 443を許可してください。証明書のインストールやDNSの変更だけでは、プライベートな上流接続先への経路は作成されません。
4. **必要なコールバックパスのみを転送します。** Twilioガイドの表のパスと、Teamsの`/api/microsoft-bot/messages`が対象です。`/notification`をアプリケーションにマッピングしているOneUptimeのイングレスを経由させます。メソッド、元のパス、クエリ文字列、本文、`Authorization`、`X-Twilio-Signature`を維持してください。公開`Host`を維持し、ゲートウェイで信頼できる`X-Forwarded-Host`と`X-Forwarded-Proto: https`を設定します。`/api`を削除したりリダイレクトを追加したりしないでください。公開ゲートウェイでは他のパスを拒否します。従業員はプライベートイングレスでダッシュボードやブラウザーのサインインコールバックにアクセスできます。
5. **コールバック認証を維持します。** プロバイダーはブラウザーSSO、CAPTCHA、プロキシのログインページを操作できないため、これらのルートをその対象から除外してください。OneUptimeは引き続きコールバックトークン、着信通話ルートのTwilio署名、Bot Framework認証を検証します。これらの検証を削除しないでください。オリジンへのアクセスはゲートウェイと許可された内部クライアントに限定し、ログからコールバックトークンを伏せます。Twilioはこの[DMZプロキシ構成とWebhookセキュリティ](https://www.twilio.com/docs/usage/webhooks/webhooks-security)を説明しています。
6. どちらの統合も設定する前に、**OneUptimeの正規URLを設定します**。

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

   これらの設定は生成されるURLを制御します。DNS、TLS、ファイアウォールアクセスは構成しません。Compose設定またはHelmリリースの更新を適用し、アプリケーションの再起動を待ちます。OneUptimeにはTwilioコールバック専用のホスト名設定はありません。ホスト名を変更した場合は、既存のTwilio電話番号のWebhook、Azure Botのメッセージングエンドポイント、アプリ登録のリダイレクトURIを更新し、Teamsマニフェストを再度ダウンロードしてアップロードしてください。

## アウトバウンドアクセスとIP制限

OneUptimeアプリケーションからのDNS解決とアウトバウンドHTTPSを許可します。APIのアドレスが変わるため、Twilioは`*.twilio.com`へのアクセスを推奨しています。[TwilioのIPアドレスに関する説明](https://help.twilio.com/articles/115015934048-All-About-Twilio-IP-Addresses)を参照してください。Teamsは`graph.microsoft.com`、`login.microsoftonline.com`、Bot Frameworkの認証・チャネルエンドポイント、会話のコネクターサービスURLを使用します。[Microsoftのファイアウォールに関する説明](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)を参照し、テスト時にブロックされた通信を確認してください。これらは例であり、ドメインの完全な一覧ではありません。

TwilioのSIP・メディア範囲やTeamsクライアントのメディア範囲を、Webhook送信元の許可リストに使用しないでください。通常のTwilio Webhookのアドレスは動的です。対象となるTwilioエディションには[Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy)が提供されていますが、Twilioとの別途の設定が必要です。Microsoftのファイアウォールの説明では、Bot Frameworkの固定インバウンドIP許可リストはサポートされないとされています。固定の送信元IPだけで本人性を判断せず、アプリケーションでコールバックを認証してください。

## テストとインバウンドアクセスのない環境

VPN外のネットワークから公開DNSとTLSを確認し、Teamsのルートを確認します：

```bash
curl -sS -i https://oneuptime.example.com/api/microsoft-bot/messages
```

現在のOneUptimeでは、`Allow: POST`を伴う`405 Method Not Allowed`が返るのが期待される動作です。これはGETがルートに到達したことを確認するもので、認証済みボットのPOSTが動作することを確認するものではありません。古いバージョンではOneUptimeのJSON形式の404が返る場合があります。レスポンス本文とプロキシのログを確認してください。TLSエラー、タイムアウト、プロキシのHTMLエラーページは、証明書またはルーティングの問題を示します。

ブラウザーのGETではTwilioのPOSTコールバックはテストできません。実際のテストSMSを送信して配信状況の更新を確認し、テスト用インシデント通話に応答してキーパッドを操作します。その後Teamsボットにメッセージを送り、カードのボタンを押します。トークンを伏せたうえで、プロバイダーの配信診断とゲートウェイ・アプリケーションのログを照合してください。アウトバウンド配信の成功だけではコールバックの動作は確認できません。

開発向けに、Twilioは[トンネルを使ったテスト](https://www.twilio.com/docs/usage/webhooks/webhooks-overview)、Microsoftは[Teamsのローカルデバッグ](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug)を説明しています。必要なルートだけを許可するプロキシへ公開HTTPSトンネルを転送し、得られたホスト名を上記のように設定して、テスト後にトンネルを停止してください。トンネルもインバウンドエンドポイントを公開する仕組みであり、環境を外部から完全に分離するものではありません。

ポリシーでインバウンド接続が全面的に禁止されている場合でも、SMSの送信要求と単純なインライン音声再生はアウトバウンドHTTPSで動作できます。ただし、配信コールバック、キーパッド操作、着信通話のルーティング、完全なTeamsボット統合は動作できません。Direct Line向けのAzure BotプライベートエンドポイントはTeamsの接続問題を解決しません。Microsoftの[ネットワーク分離ガイド](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)では、公開アクセスを無効にするとTeamsを含む他のチャネルが削除されると説明されています。外部ネットワークから完全に切り離された環境では、これらのクラウド統合を使用できません。
