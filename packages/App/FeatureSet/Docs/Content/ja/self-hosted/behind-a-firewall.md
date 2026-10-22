# VPN またはファイアウォールの内側

セルフホストの OneUptime は、インターネットに公開しないまま運用できます。すべてのアラートを外向きの接続で送信するからです。ただし、外から入ってくるものもいくつかあります。対応者がメッセージ内の **Acknowledge** をタップする、Twilio が通話中に押されたキーを報告する、Slack がボタンのクリックを報告する、といったものです。このページでは、それぞれについて、誰がどのパスでサーバーに接続するかを示します。これを見れば、使うものだけを公開することも、何も公開しないこともできます。

:::cards
- [サーバーに接続するもの](#サーバーに接続するもの): 対応者のスマートフォンと、コールバックしてくるプロバイダー。
- [すべてを非公開に保つ](#すべてを非公開に保つ): 対応者のスマートフォンを VPN に接続しておきます。
- [確認応答ページだけを公開する](#確認応答ページだけを公開する): 確認応答リンクのための狭い入り口。
- [プロバイダーのコールバック](#プロバイダーのコールバック): Telegram、Twilio、WhatsApp、Slack、Microsoft Teams。
:::

## サーバーに接続するもの

送信に内向きのアクセスは一切必要ありません。OneUptime のほうから、メールサーバー、Twilio、Telegram、Meta、Slack、Microsoft、プッシュリレーに外向きに接続します。内向きに入ってくるのは、次のいずれかです。

| 起きること | サーバーに接続するもの | 送信元アドレスの許可リストで対応できるか |
| --- | --- | --- |
| 対応者がメール、SMS、WhatsApp、Telegram のメッセージで **Acknowledge** をタップする | 対応者のスマートフォンまたはコンピューター | いいえ。対応者がいる場所から接続します |
| 対応者が OneUptime On-Call アプリで確認応答する | 対応者のスマートフォン | いいえ。理由は同じです |
| 対応者がオンコールの電話で 1 を押す | Twilio | Twilio の Static Proxy for Webhooks を使う場合のみ |
| 誰かが自分の Telegram アカウントをリンクする | Telegram | はい。または Telegram をポーリングすれば、何も許可せずに済みます |
| 誰かが Slack または Microsoft Teams のメッセージでボタンをクリックする | Slack または Microsoft | いいえ。どちらも固定のアドレスを公開していません |
| WhatsApp がメッセージの配信または既読を報告する | Meta | いいえ。Meta は固定のアドレスを公開していません |

セルフホストのサーバーはこれらのプロバイダーと直接通信し、OneUptime 自身のサーバーを経由することはありません。そのため、許可すべき OneUptime のアドレスの一覧はありません。

## すべてを非公開に保つ

対応者のスマートフォンを VPN に接続しておきます。常時接続にするか、OneUptime のホスト名へのアクセス時にオンデマンドで接続するようにしておけば、午前 3 時の呼び出しに確認応答する前に、誰かが VPN を接続する必要はありません。何も公開しなくても、次のように動作します。

- メール、SMS、WhatsApp、Telegram のメッセージ内の確認応答リンクが開きます。スマートフォンがサーバーに到達できるからです。
- OneUptime On-Call アプリが動作します。アプリにサーバーのアドレスを設定してください。プッシュ通知に内向きのアクセスは不要です。サーバーはプッシュリレーを経由して送信するからです。
- ポーリングを有効にすると、各自が Telegram アカウントをリンクできます ([Telegram](#telegram) を参照)。

メッセージングアプリ内のリンクは、そのアプリ自身のブラウザーか、スマートフォンの既定のブラウザーで開き、OneUptime アプリで開くことはありません。そのため、アプリ単位の VPN では、OneUptime アプリだけでなく、メッセージングアプリとブラウザーも対象にする必要があります。

通話中に 1 を押す操作、Slack と Microsoft Teams のメッセージのボタン、WhatsApp の配信通知には、引き続きそれぞれのプロバイダーからサーバーへの到達が必要です。

## 確認応答ページだけを公開する

対応者のスマートフォンが VPN を使えない場合は、確認応答リンクが開くページだけを公開し、それ以外は何も公開しないでください。OneUptime の前にリバースプロキシを置くか、内向きのファイアウォールルールが不要な Cloudflare Tunnel などの外向きのトンネルを置き、次のパスだけを通します。

| メソッド | パス | 提供するもの |
| --- | --- | --- |
| GET | `/l/*` | SMS、WhatsApp、Telegram のメッセージ内の短縮リンク |
| GET | `/api/user-notification-log-timeline/acknowledge-page/*` | 呼び出しの内容と **Acknowledge** ボタンを表示するページ |
| GET | `/api/user-notification-log-timeline/acknowledge/*` | **Acknowledge** ボタン |
| GET | `/api/user-notification-log-timeline/pass-on-page/*` | 任意: 呼び出しを次の人にパスするページ |
| POST | `/api/user-notification-log-timeline/pass-on/*` | 任意: そのページのボタン |
| GET | `/oneuptime-assets/*` | これらのページのフォント、スタイル、ロゴ |

:::steps
### 公開用の名前をプロキシに向ける
メッセージ内のリンクは `HOST` の設定から作られます。そのため、その名前はインターネット上でプロキシに解決され、公的に信頼された証明書を備えている必要があります。スプリット DNS を使えば、社内ネットワークの利用者はこれまでどおりプライベートアドレスに解決し、それ以外もすべて従来どおり使えます。

### パスをそのまま転送する
これらのパスを、メソッド、パス、クエリ文字列を変えずに OneUptime の ingress に送り、それ以外のリクエストにはすべて 404 で応答します。

### レート制限をかける
どのリンクにもランダムな ID が含まれ、短縮リンクは英字 8 文字です。各アドレスが送れるリクエストの数を制限し、誰も ID を高速に試せないようにします。
:::

対応者が確認応答すると、ページはダッシュボードでアラートを開きます。ダッシュボードは社内ネットワークでしか読み込まれませんが、その時点で確認応答はすでに保存されています。

## プロバイダーのコールバック

### Telegram

アラートの送信に必要なのは、`api.telegram.org` への外向きの HTTPS だけです。アカウントをリンクするには、利用者がボットに送る `/start` メッセージをサーバーが受け取る必要があり、その方法は次の 2 つです。

- **ポーリング方式**: **Poll Telegram for Messages** を **Admin Dashboard > 設定 > Telegram** でオンにします。OneUptime が外向きの HTTPS で数秒ごとに Telegram からボットのメッセージを取得するため、サーバーには何も到達する必要がありません。
- **Webhook 方式**: Telegram が各メッセージを `POST /api/notification/telegram/webhook` に送信します。Telegram は `149.154.160.0/20` と `91.108.4.0/22` から [Webhook を送信する](https://core.telegram.org/bots/webhooks)ため、これらのアドレスだけを許可できます。

### Twilio

対応者が通話中に 1 を押して確認応答すると、Twilio はそのキーを `POST /api/user-notification-log-timeline/call/gather-input/*` に送信します。お使いの Twilio のエディションに [Static Proxy for Webhooks](https://www.twilio.com/docs/iam/twilio-editions/twilio-static-proxy) が含まれていない限り、Twilio の Webhook の送信元アドレスは変わります。SMS の配信状況の更新と着信については、[Twilio 統合](/docs/self-hosted/twilio-integration)で説明しています。

### WhatsApp

アラートと確認応答に内向きのアクセスは不要です。Meta は配信通知と既読通知を `/api/notification/whatsapp/webhook` に送信します。これがないと、Meta がメッセージを受け付けた後に、そのメッセージが配信されたか、読まれたか、失敗したかを OneUptime の WhatsApp ログに表示できません。Meta はすべてのリクエストに署名しますが、固定のアドレスは公開していません。

### Slack と Microsoft Teams

これらのメッセージのボタン、メニュー、コマンドは、どちらのサービスも公開していないアドレスからサーバーを呼び出します。パスとその公開方法は、[Slack 統合](/docs/self-hosted/slack-integration)と [Microsoft Teams 統合](/docs/self-hosted/microsoft-teams-integration)にあります。

## 次のステップ

:::cards
- [Twilio 統合](/docs/self-hosted/twilio-integration): 自分の Twilio アカウントを通じた SMS と通話。
- [プッシュ通知](/docs/self-hosted/push-notifications): プッシュリレーと、サーバーとスマートフォンが到達する先。
- [アプリの概要](/docs/mobile-desktop-apps/index): OneUptime On-Call アプリをサーバーに接続します。
- [プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access): 逆方向です。OneUptime から社内ツールに到達できるようにします。
:::
