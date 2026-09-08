# Slack 連携

セルフホストの OneUptime プロジェクトを Slack に接続し、通知、インシデント操作、コマンド、メッセージイベントを利用できます。

## 設定

1. 下記に従って OneUptime のホスト名と HTTPS を設定します。**Settings > Slack Integration** で生成されたマニフェストをコピーします。`https://your-oneuptime-domain.com/api/slack/app-manifest` でも取得できます。
2. 自分の環境で生成したマニフェストを使ってワークスペースに [Slack アプリを作成](https://api.slack.com/apps)します。これにより URL がホスト名と一致します。
3. アプリの **Basic Information** にある **Client ID**、**Client Secret**、**Signing Secret** を Docker Compose の `config.env` にコピーします。

   ```dotenv
   SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
   SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
   SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
   ```

   Helm では次の値を設定します。

   ```yaml
   slackApp:
     clientId: "YOUR_SLACK_APP_CLIENT_ID"
     clientSecret: "YOUR_SLACK_APP_CLIENT_SECRET"
     signingSecret: "YOUR_SLACK_APP_SIGNING_SECRET"
   ```

4. 設定を適用し、OneUptime の再起動を待ちます。署名シークレットの設定前に Events URL の検証に失敗した場合は、再試行してください。
5. **Settings > Slack Integration** に戻り、**Connect to Slack** を選択してアプリを認可します。ユーザーの識別が必要な操作では、OneUptime に個人の Slack アカウントも接続してください。

## セルフホスト環境のネットワークアクセス

### 通信方向とエンドポイント

| 通信 | 必要なアクセス |
| --- | --- |
| OneUptime → Slack | DNS と TCP 443 の外向き HTTPS。Web API と OAuth トークン交換には `slack.com`、コマンド応答と利用中の Incoming Webhook 通知には `hooks.slack.com` |
| Slack → OneUptime | 完全な連携には、下記 4 つの POST ルートへの TCP 443 の公開 HTTPS |
| ユーザーのブラウザー → OneUptime | ダッシュボードと `/api/slack/auth/:projectId/:userId`、`/api/slack/auth/:projectId/:userId/user` への OAuth リダイレクト。ユーザーの VPN 経由でアクセス可能なままで構いません |

これらの送信先ドメインは OneUptime の連携用であり、Slack クライアントや全機能の完全な許可リストではありません。Slack の Incoming Webhook は Slack 側にあり、OneUptime がそこに送信します。OneUptime サーバーの受信エンドポイントではありません。[Incoming Webhook ガイド](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)を参照してください。

以下のプロバイダーコールバックを ingress 経由で OneUptime アプリケーションに転送します。

| メソッドとパス | 用途 |
| --- | --- |
| `POST /api/slack/events` | Events API の検証、リアクション、メンション、メッセージ |
| `POST /api/slack/interactive` | ボタン、ショートカット、モーダル送信、`/incident`、`/maintenance` |
| `POST /api/slack/options-load` | 対話型メニューの選択肢リクエスト |
| `POST /api/slack/command` | `/oneuptime` コマンド |

OAuth は[ブラウザーのリダイレクト後にサーバーでトークンを交換](https://docs.slack.dev/authentication/installing-with-oauth/)します。マニフェストは `/api/slack/auth` を URL プレフィックスとして登録し、OneUptime が認可時にプロジェクトとユーザーのパスを追加します。ブラウザーがアクセスできるだけでは、Slack はイベントやボタン操作を配信できません。

### プライベート環境とコールバックのセキュリティ

公開 DNS と、公的に信頼された HTTPS 証明書、完全な証明書チェーン、OneUptime ingress へのプライベート経路を持つゲートウェイを使用します。受信 TCP 443 を許可し、上記のプロバイダー POST コールバックだけを公開します。プライベート `ClusterIP`、内部 DNS、従業員の VPN だけではプロバイダーは接続できません。スプリット DNS を使えば、同じホスト名でダッシュボードとブラウザーの OAuth ルートを非公開にできます。

`config.env` に `HOST=oneuptime.example.com` と `HTTP_PROTOCOL=https`、または Helm に `host: oneuptime.example.com` と `httpProtocol: https` を設定します。適用後は再起動を待ちます。これらは URL を生成する設定であり、DNS、TLS、ファイアウォールを構築するものではありません。 ホスト名を変更したら Slack マニフェストを再生成して更新します。

メソッド、パス、クエリ文字列、元の本文、`Content-Type`、`X-Slack-Signature`、`X-Slack-Request-Timestamp` を保持します。信頼できるプロキシヘッダーで公開ホストと HTTPS スキームを保持します。コールバックはブラウザー SSO、CAPTCHA、プロキシログインの対象外にし、OneUptime の署名・タイムスタンプ検証は維持してください。サーバー時刻を同期します。送信元 IP の検査は [Slack の署名検証](https://docs.slack.dev/authentication/verifying-requests-from-slack/)の代わりにはなりません。

### 接続の確認と制限事項

**Event Subscriptions** で Events Request URL を検証します。Slack は [POST チャレンジを送信し、TLS を検査](https://docs.slack.dev/apis/events-api/using-http-request-urls/)します。その後、テスト通知、スラッシュコマンド、インシデントボタン、購読イベントを実行します。秘密情報を記録せずにゲートウェイと OneUptime のログを確認してください。Slack は迅速な応答を要求し、[対話操作は 3 秒以内の応答](https://docs.slack.dev/interactivity/handling-user-interaction/)が必要です。ブラウザーの GET や送信成功だけでは POST コールバックを検証できません。

受信接続をすべて禁止すると、認可済みアプリは外向き HTTPS でメッセージを送信できても、イベント、ボタン、ショートカット、コマンドは動作しません。OneUptime マニフェストは HTTP コールバックを使い、Socket Mode を無効にしています。Slack Socket Mode を有効にする方法はサポートされた代替手段ではありません。[プライベートネットワークアクセス設定](/docs/self-hosted/private-network-access)はプライベート宛先への送信を制御するもので、コールバックを公開しません。
