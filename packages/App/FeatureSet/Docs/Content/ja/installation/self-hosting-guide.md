# セルフホスティングガイド

このページを上から順に進めると、空のサーバーから、HTTPS で動き、テストメールを送り、あなたに通知できる自分の OneUptime までたどり着けます。各手順の最後に、うまくいったことの確かめ方を示し、詳しくは長いページへのリンクを示します。

:::cards
- [OneUptime をインストールする](#oneuptime-をインストールする): 1 台のサーバーで Docker Compose、または Kubernetes で Helm チャート。
- [サーバーのセットアップを完了する](#サーバーのセットアップを完了する): メール、次に SMS と電話。それぞれテスト付きです。
- [インストールを確認する](#インストールを確認する): 何がおかしいかを教えてくれる 1 つのコマンド。
- [クイックスタート](/docs/introduction/quickstart): 最初のモニター、オンコールポリシー、ステータスページ。
:::

## 必要なもの

- **サーバー。** Docker Compose なら、OneUptime を試すにはメモリ 8 GB、4 コア、ディスク 20 GB の Linux サーバー、チームで使うなら 16 GB、8 コア、400 GB: [サイジングとキャパシティプランニング](/docs/installation/sizing)を参照してください。Helm チャートなら Kubernetes クラスター。
- **ドメイン名。** OneUptime を開くときに使う `oneuptime.example.com` のような名前で、サーバーを指す DNS の `A` レコードが必要です。最初はサーバーの IP アドレスでも始められますが、Let's Encrypt の証明書にはドメイン名が必要です。
- **ポート 80 と 443。** HTTPS のため、インターネットから到達できる必要があります。
- **メールを送る手段。** 自社のメールサーバー、Microsoft 365、Google Workspace などのメールサーバー、または Amazon SES、SendGrid、Mailgun、Postmark、Resend のアカウント。
- **Twilio アカウント。** SMS と電話で通知を受けるために使います。メールとプッシュ通知には不要です。

**うまくいったかどうか:** `dig +short oneuptime.example.com` がサーバーの IP アドレスを表示すれば完了です。

## OneUptime をインストールする

:::tabs
@tab Docker Compose
新しい Ubuntu、Debian、RHEL 系のサーバーなら、1 つのコマンドで、足りない Docker、Git、Node.js をインストールし、OneUptime を `oneuptime` フォルダーにクローンし、アクセスに使うアドレスを尋ね、起動まで行います:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

同じことを手作業で行う場合は、Docker、Git、Node.js をインストールしたうえで次を実行します:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

`config.env` を開き、最初の設定である `HOST` にドメイン名または IP アドレスを `http://` なしで設定します。変更が必要な設定はこれだけです。メール、SMS、電話は Admin Dashboard で設定し、`ADVANCED` より下の設定はそのままで動きます。次に OneUptime を起動します:

```bash
npm start
```

**うまくいったかどうか:** `npm start` が **OneUptime is up!** と開くべきアドレスを表示して終われば完了です。初回の起動は、Docker がイメージをダウンロードするため数分かかります。`npm start` がその前に止まった場合は、何を変えればよいかを表示します。詳しくは [Docker Compose](/docs/installation/docker-compose) を参照してください。
@tab Kubernetes
ドメイン名または IP アドレスを `http://` なしで書いた `values.yaml` を作成します:

```yaml title="values.yaml"
host: oneuptime.example.com
```

チャートはクラスターのデフォルトのストレージクラスにデータを保存します。`kubectl get storageclass` がどれも `(default)` と表示しない場合は、そのうちの 1 つの名前で `global.storageClass` を追加します。次にチャートをインストールします:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**うまくいったかどうか:** `kubectl get pods` がすべての Pod を `Running` と表示し、`helm install` が表示したアドレスで OneUptime が開けば完了です。詳しくは [チャートのインストールガイド](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md)を参照してください。
:::

## HTTPS を有効にする

ドメイン名がサーバーを指すようになったら、OneUptime に Let's Encrypt から無料の証明書を取得させます。証明書の更新も OneUptime が自分で行います。

:::tabs
@tab Docker Compose
`config.env` に次の値を設定し、もう一度 `npm start` を実行します:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Caddy、Nginx、ロードバランサーなどのリバースプロキシをすでに使っている場合は、`PROVISION_SSL=false` のままにし、`HTTP_PROTOCOL=https` と `TRUSTED_PROXY_HOPS=2` を設定して、[独自のリバースプロキシを使う](/docs/installation/docker-compose#独自のリバースプロキシを使う)を参照してください。
@tab Kubernetes
`values.yaml` に次の値を設定してから適用します:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

代わりに自前の Ingress コントローラーで TLS を終端する場合は、`ssl.provision` をオフのままにして `httpProtocol: https` だけを設定します。
:::

**うまくいったかどうか:** `https://oneuptime.example.com` が証明書の警告なしに開けば完了です。最初の証明書は通常数分以内に届きます。`localhost` で OneUptime を試している場合は、この手順を飛ばしてください。証明書にはドメイン名が必要です。

## 管理者アカウントを作成する

`https://oneuptime.example.com` のような自分のアドレスを開いてサインアップします。新しいサーバーの最初のアカウントがマスター管理者になり、`/admin` で Admin Dashboard を開けます。

**うまくいったかどうか:** `/admin` で Admin Dashboard が開けば完了です。メール、HTTPS、サインアップについての選択が終わるまでは、**このサーバーのセットアップを完了する** の画面で開きます。

## サーバーのセットアップを完了する

Admin Dashboard の **サーバーの設定** ページ (`/admin/setup`) には、新しいサーバーに必要なものが重要な順に並びます。メール、HTTPS、サインアップできる人の選択は必須です。SMS と電話、グローバルプローブ、バックアップ、更新の確認は推奨です。各項目には設定場所を開くボタンがあり、`npm start` は最後にこのページのアドレスを表示します。

:::steps
### メールを設定する

**メールを設定** をクリックします。**設定 > 通知 > メール** が開くので、メールサーバー (多くはポート `587` を使います) またはメールプロバイダーと、メールの送信元アドレスを入力します。保存したら **テストメールを送信** をクリックし、自分宛てに送ります。

**うまくいったかどうか:** メールが届き、チェックリストでメールが完了になれば完了です。テストが失敗した場合は、メールサーバーの応答が表示されます。[SMTP](/docs/emails/smtp#トラブルシューティング) を参照してください。

### サインアップできる人を選ぶ

アドレスを開ける人は誰でもサインアップできます。チームのアカウントがそろったら、**設定 > 認証** で **サインアップを許可** をオフにします。プロジェクトに招待した人は、それでも参加できます。サインアップを開いたままにするには、**登録を開放したままにする** をクリックします。

**うまくいったかどうか:** チェックリストでサインアップが完了になれば完了です。

### SMS と電話を設定するか、メールとプッシュだけを使う

SMS と電話で通知を受けるには、**SMS と電話を設定する** をクリックし、**設定 > 通知 > 通話と SMS** で Twilio アカウントを追加します。各値の見つけ方は [Twilio 統合](/docs/self-hosted/twilio-integration)にあります。次に **テスト SMS を送信** と **テスト電話をかける** をクリックします。代わりに自前のゲートウェイで送る場合は、[SMS・通話ゲートウェイ](/docs/self-hosted/sms-and-call-gateway)を参照してください。メールとプッシュ通知で十分なら、**メールとプッシュ通知だけを使う** をクリックします。

**うまくいったかどうか:** SMS が届いて電話が鳴るか、チェックリストにあなたの選択が表示されれば完了です。
:::

HTTPS の項目は [HTTPS を有効にする](#https-を有効にする) がうまくいった時点で完了になり、推奨の各項目には何をすればよいかが書かれています。

## インストールを確認する

:::tabs
@tab Docker Compose
`oneuptime` フォルダーで doctor を実行します:

```bash
npm run doctor
```

すべてのコンテナー、`config.env`、`HOST` がこのサーバーに届くか、証明書、空きディスクを確認し、メールやプローブなど、OneUptime 自身から見える状態を尋ねます。問題ごとに直し方が示されます。[インストールを確認する](/docs/installation/docker-compose#インストールを確認する)を参照してください。
@tab Kubernetes
[チャートのトラブルシューティングガイド](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it)の手順に従って、チャートの診断スクリプトをクラスターに対して実行します。読み取りだけを行い、見つかったことを深刻な順にまとめて終わります。
:::

**うまくいったかどうか:** doctor が **Everything looks right.** で終わり、`0` で終了すれば完了です。直すべきものがあれば `1`、確認を実行できなかった場合は `2` で終了します。Kubernetes では、まとめに `CRITICAL` の指摘がなければ完了です。

## 何かを監視して通知を受ける

これでサーバーはメールを送り、人に通知できます。[クイックスタート](/docs/introduction/quickstart)では製品の中で続きを進めます。Web サイトのモニター、サイトが落ちたときに通知するオンコールポリシー、ステータスページを、約 15 分で作成します。最後の部分ではテストインシデントを宣言するので、通知が届く様子を確認できます。

## トラブルシューティング

:::details npm start が止まり、HOST がまだアドレスではないと表示される
`config.env` の `HOST` に、`<your-address>` のようなプレースホルダーが残っています。ドメイン名または IP アドレスを `http://` なしで設定し、もう一度 `npm start` を実行してください。
:::

:::details テストメールが失敗する
ボタンの下のメッセージは、メールサーバーの応答です。ホスト名、ポート、ユーザー名、パスワードと、メールの送信元アドレスからの送信をメールサーバーが許可しているかを確認してください。[SMTP](/docs/emails/smtp#トラブルシューティング) を参照してください。
:::

:::details ブラウザーが証明書について警告する
Let's Encrypt には、インターネットから到達できるポート 80 と 443、そしてこのサーバーを指すドメイン名が必要です。数分待ってから `npm run doctor` を実行してください。証明書を確認し、何がおかしいかを表示します。
:::

## 次のステップ

:::cards
- [クイックスタート](/docs/introduction/quickstart): モニター、オンコールポリシー、ステータスページを 15 分で。
- [Docker Compose](/docs/installation/docker-compose): 自前のプロキシ、バックアップ、更新、本番運用のチェックリスト。
- [アップグレード](/docs/installation/upgrading): 新しいリリースへ、メジャーバージョンを 1 つずつ移行します。
- [アーキテクチャ](/docs/self-hosted/architecture): OneUptime の各部分の組み合わさり方。
:::
