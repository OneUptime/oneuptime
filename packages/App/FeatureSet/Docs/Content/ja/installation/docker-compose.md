# Docker Compose

Docker Compose を使って、完全で無料の OneUptime インスタンスを 1 台の Linux サーバーで動かします。このページでは、新しいサーバーからインスタンスが動き出すまでを案内し、続いて HTTPS、本番向けの強化、バックアップ、アップデート、削除について説明します。OneUptime 自体のコードを開発する場合は、 [ローカル開発](/docs/installation/local-development) を参照してください。

:::cards
- [OneUptime をインストールする](#oneuptime-をインストールする): 新しいサーバーから最初のアカウントまで 5 ステップ。
- [HTTPS を設定する](#https-を設定する): OneUptime に証明書を取得させるか、自分のプロキシを前に置きます。
- [本番環境のチェックリスト](#本番環境のチェックリスト): 実際のトラフィックが来る前に決めておくこと。
- [OneUptime をアップデートする](#oneuptime-をアップデートする): 最新リリースに移行します。
:::

## 仕組み

Docker Compose は OneUptime の各部分をサーバー上のコンテナーとして実行します。すべてのトラフィックは `ingress` コンテナーから入り、`app` にルーティングされます。アプリはデータを PostgreSQL、ClickHouse、Valkey に保存します。同梱のプローブがモニターのチェックを実行し、結果を ingress 経由で報告します。

```mermaid title="Docker Compose によるデプロイ"
flowchart TB
    Users["ユーザーと<br/>エージェント"]
    Proxy["独自の<br/>リバースプロキシ<br/>(任意)"]
    Targets["監視対象のサイト"]
    subgraph Server["あなたのサーバー"]
        Ingress["ingress"]
        App["app"]
        Probe["probe-1"]
        Runner["global-runner"]
        subgraph Data["データストア"]
            direction LR
            PG[("postgres")]
            CH[("clickhouse")]
            VK[("valkey")]
        end
    end
    Users -->|HTTPS| Proxy
    Proxy -->|HTTP| Ingress
    Users -.->|"プロキシなし"| Ingress
    Ingress --> App
    App --> PG
    App --> CH
    App --> VK
    Probe -->|結果| Ingress
    Runner -->|ジョブ| App
    Probe -->|チェック| Targets
    Data ~~~ Probe
    Data ~~~ Runner
```

| サービス | イメージ | 役割 |
| --- | --- | --- |
| `ingress` | `oneuptime/nginx` | ポート 80 と 443 ですべてのトラフィックを受け、アプリにルーティングします。OneUptime が証明書を管理する場合は HTTPS を提供します。 |
| `app` | `oneuptime/app` | ダッシュボード、API、ステータスページ、テレメトリの取り込み、バックグラウンドワーカー。 |
| `probe-1` | `oneuptime/probe` | モニターのチェックを実行するグローバルプローブ。ホストのネットワークを使います。 |
| `global-runner` | `oneuptime/runner` | すべてのプロジェクトの Runbook の JavaScript のステップと OneUptime AI のコード修正を実行する、同梱のグローバル Runner。 |
| `postgres` | `postgres:15` | 設定と状態: モニター、インシデント、ユーザー。`postgres` ボリュームに保存されます。 |
| `clickhouse` | `clickhouse/clickhouse-server:26.7` | テレメトリ: ログ、メトリクス、トレース、例外。`clickhouse` ボリュームに保存されます。 |
| `valkey` | `valkey/valkey:9.1-alpine` | キャッシュとキュー。ディスクには何も保存しません。 |

> [!NOTE]
> `valkey` サービスは、Redis 7.2 の BSD ライセンスのフォークである [Valkey](https://valkey.io) を実行し、`config.env` の `VALKEY_*` 設定で構成します。Redis プロトコルを話すサーバーならどれでも動作します。必要ならマネージド Redis に `VALKEY_HOST` を向けてください。これらの設定は 13.0.0 までは `REDIS_*` という名前でした。古い名前も引き続き読み込まれ、コンテナーは引き続きホスト名 `redis` にも応答し、`npm run update` はそれらを書き換えないため、古い `config.env` を編集する必要はありません。

大規模な本番環境や高可用性が必要な場合は、代わりに Kubernetes で [Helm チャート](https://artifacthub.io/packages/helm/oneuptime/oneuptime) を使ってください。Docker Compose は 1 台のサーバーで各サービスを 1 つずつ実行します。

## 要件

サーバーのサイズは、そこで何を動かすかで選びます。メモリとディスクを左右するのはテレメトリ (ログ、メトリクス、トレース) です。データ量がわかったら [サイジングとキャパシティプランニング](/docs/installation/sizing) を参照してください。

| | 推奨 | ホームラボの最小構成 |
| --- | --- | --- |
| **メモリ** | 16 GB | 8 GB |
| **CPU** | 8 コア | 4 コア |
| **ディスク** | 400 GB | 20 GB |
| **システム** | Ubuntu 22.04、または Debian、Ubuntu、RHEL ベースの Linux | 同じ |
| **アーキテクチャ** | x86-64 (`amd64`) または ARM (`arm64`) | 同じ |

ホームラボの最小構成は、個人利用や実験向けです。Raspberry Pi で OneUptime を動かしているユーザーもいます。

ほかにも次のものが必要です。

- **Docker** と **Docker Compose v2** プラグイン (`docker compose` コマンド)。
- **Git**。OneUptime の取得に使います。
- **Node.js と npm**。Docker Compose をラップする `npm start` と `npm run update` スクリプトを実行します。
- **空いているポート 80 と 443**。下の表に、OneUptime がホストで使うすべてのポートを示します。

| ホストのポート | 使用元 | 設定 | 用途 |
| --- | --- | --- | --- |
| 80 | `ingress` | `ONEUPTIME_HTTP_PORT` | ダッシュボード、API、テレメトリの取り込み、Let's Encrypt の検証。 |
| 443 | `ingress` | `STATUS_PAGE_HTTPS_PORT` | OneUptime が証明書を管理する場合のインスタンスの HTTPS、およびカスタムドメインのステータスページとダッシュボード。 |
| 5400 | `postgres` | `DATABASE_PUBLISHED_PORT` | `npm run backup` と `restore.sh` がサーバー自身から PostgreSQL に到達するためのもの。`127.0.0.1` だけで公開されます。 |
| 3874 | `probe-1` | `GLOBAL_PROBE_1_PORT` | プローブ自身のサーバー。サーバーの外からは必要ありません。 |

インストールの [動画ウォークスルー](https://youtu.be/j1SWmMW2oL4) もあります。

## OneUptime をインストールする

新しい Ubuntu、Debian、または RHEL 系のサーバーでは、1 つのコマンドで以下の手順をまとめて実行できます。足りない Docker、Git、Node.js をインストールし、release ブランチを `oneuptime` フォルダーにクローンし、利用者が開くアドレスを尋ねてから `npm start` を実行します。

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

:::steps
### release ブランチをクローンする

`release` ブランチには最新リリースのファイルが入っています。

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
```

### config.env を作成する

OneUptime の設定はすべて `config.env` にあります。サンプルから始めます。

```bash
cp config.example.env config.env
```

### ホスト名を設定する

`config.env` を開き、`HOST` に OneUptime へのアクセスに使うドメイン名または IP アドレスを `http://` なしで設定します。`localhost` のままにするのは、自分のコンピューターで OneUptime を試す場合だけにしてください。

```ini title="config.env"
HOST=oneuptime.example.com
```

### OneUptime を起動する

:::tabs
@tab npm
```bash
npm start
```
@tab Docker CLI
```bash
sh Scripts/Install/WithConfig.sh docker compose up --remove-orphans -d
```
最初の起動の前に、[ランダムなシークレットを生成する](#ランダムなシークレットを生成する) のとおりにプレースホルダーのシークレットを自分で置き換えてください。自動で置き換えるのは `npm start` だけです。
:::

`npm start` は最初にサーバーを確認します。対象は Docker、メモリー、ディスクの空き容量、OneUptime が使うポート、そして `HOST` です。OneUptime の動作を妨げる問題があればそこで止まり、何を変えればよいかを示します。続いて `config.env` のプレースホルダーのシークレットそれぞれにランダムな値を設定し、OneUptime を起動して、すべての部分が応答するまで待ちます。最初の起動には数分かかります。Docker がイメージをダウンロードし、OneUptime がデータベースを作成するためです。最後に **OneUptime is up!** と開くアドレスを表示して終了します。

### 最初のアカウントを作成する

`http://` に続けて `HOST` を開き (例: `http://localhost`)、サインアップします。新しいインスタンスの最初のアカウントはマスター管理者になり、`/admin` で Admin Dashboard を開けます。

ページにアクセスできる人は誰でも、あなたのあとにサインアップできます。それを止めるには、Admin Dashboard を開いて **設定 > 認証** に移動し、 **サインアップを許可** をオフにします。プロジェクトに招待した人は引き続きアカウントを作成できます。
:::

### ランダムなシークレットを生成する

`config.example.env` では、すべてのシークレットが GitHub で公開されているプレースホルダーになっています。`npm start` は何かを起動する前にそれぞれへ独自のランダムな値を設定し、埋めた設定の名前を表示します。

| 設定 | 保護するもの |
| --- | --- |
| `ONEUPTIME_SECRET` | OneUptime の内部サービス間の呼び出し。 |
| `ENCRYPTION_SECRET` | OneUptime が保存するシークレット (統合のトークンや SMTP パスワードなど) と、発行するサインイントークン。 |
| `DATABASE_PASSWORD`、`CLICKHOUSE_PASSWORD`、`VALKEY_PASSWORD` | 3 つのデータストア。 |
| `REGISTER_PROBE_KEY` | インスタンスへのプローブの登録。 |
| `GLOBAL_PROBE_1_KEY`、`GLOBAL_PROBE_2_KEY` | Docker Compose が実行できるグローバルプローブ (デフォルトでは `probe-1` が動きます)。 |
| `GLOBAL_RUNNER_KEY` | すべてのプロジェクトの JavaScript のステップと AI によるコード修正を実行する、同梱のグローバル Runner。 |

> [!IMPORTANT]
> OneUptime を起動したあとは、シークレットを変えないでください。PostgreSQL はデータベースを作成するときにしかパスワードを受け取りません。また、あとから `ENCRYPTION_SECRET` を変えると、古い値で暗号化されたものはすべて読めなくなります。そのため `npm start` が `DATABASE_PASSWORD` と `ENCRYPTION_SECRET` を設定するのは、PostgreSQL がデータベースを作成する前の新規インストールのときだけです。

Docker CLI を使う場合は、最初の起動の前にプレースホルダーを自分で置き換えます。

```bash
while grep -q "please-change-this-to-random-value" config.env; do
  sed -i "0,/please-change-this-to-random-value/{s/please-change-this-to-random-value/$(openssl rand -hex 32)/}" config.env
done
grep -c "please-change-this" config.env
```

最後のコマンドが `0` を出力すれば、プレースホルダーは残っていません。ループは GNU `sed` を使い、これはどの Linux サーバーにもあります。

## HTTPS を設定する

OneUptime は、HTTPS を追加する 2 つの方法のどちらかを選ぶまで、通常の HTTP で提供します。

| | OneUptime に証明書を取得させる | 独自のリバースプロキシを使う |
| --- | --- | --- |
| **TLS の終端** | OneUptime の `ingress`。無料の Let's Encrypt 証明書を自分で更新します | あなたのプロキシ: Caddy、Nginx、またはロードバランサー |
| **必要なもの** | サーバーを指す公開ドメイン名と、インターネットから到達できるポート 80 と 443 | プロキシと、ドメインの証明書 |
| **設定** | `PROVISION_SSL=true`、`HTTP_PROTOCOL=https` | `PROVISION_SSL=false`、`HTTP_PROTOCOL=https`、`TRUSTED_PROXY_HOPS=2` |
| **カスタムドメインのステータスページ** | 追加の設定なしで動作します | プロキシがそのドメインも提供する必要があります |

ステータスページやダッシュボードをカスタムドメインに置く場合は、OneUptime に TLS を任せるほうが簡単です。ingress がそれらのドメインの証明書を自分で注文し、提供します。

`HTTP_PROTOCOL=https` を設定すると、OneUptime は HTTPS のリンクを作り、サインイン用の Cookie を HTTPS 上に保ち、ブラウザーに `HOST` へは HTTPS でだけアクセスするよう伝えます。ブラウザーはその名前のすべてのポートについて、一年間これを守ります。そのため、いつか `HOST` が再び通常の HTTP で応答する必要がある場合は、しばらく前に `HSTS_MAX_AGE_SECONDS=0` を `config.env` に設定してください。ブラウザーは次回のアクセス時にこのルールを忘れます。

### OneUptime に証明書を取得させる

:::steps
#### ドメインをサーバーに向ける

ドメインの DNS `A` レコード (IPv6 の場合は `AAAA`) を作成し、値にサーバーの公開 IP アドレスを設定します。`AAAA` レコードを作る場合は、OneUptime の IPv6 もオンにしてください ([訪問者のアドレス](#訪問者のアドレス)を参照)。

#### 証明書の取得をオンにする

`config.env` に次の値を設定します。

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

`HOST` はドメイン名である必要があります。OneUptime は IP アドレスや `localhost` の証明書は取得できません。

#### 新しい設定で再起動する

```bash
npm start
```

#### HTTPS でインスタンスを開く

`https://oneuptime.example.com` を開きます。OneUptime は起動時に証明書を注文し、その後は 1 時間ごとに確認して、残りが 30 日を切ると更新します。最初の証明書が届くまで (通常は数分以内)、ingress は一時的な自己署名証明書を提供し、ブラウザーが警告を表示します。
:::

### 独自のリバースプロキシを使う

この手順では、OneUptime と同じサーバーでプロキシを実行します。プロキシが別のマシンで動いている場合は最初の手順を飛ばし、このサーバーのポート 80 にプロキシを向けたうえで、クラウドプロバイダーのファイアウォールでポート 80 と 443 にはプロキシだけが届くようにしてください。プロキシを通らずに OneUptime に届いた訪問者は、OneUptime が自分を数えるアドレスを選べてしまいます。

:::steps
#### ingress をポート 80 と 443 から移す

プロキシがポート 80 と 443 を使うので、ingress を別のポートに移し、このサーバーのループバックアドレス `127.0.0.1` だけで公開して、訪問者がプロキシを通してしか OneUptime に届かないようにします。

```ini title="config.env"
ONEUPTIME_HTTP_PORT=127.0.0.1:8080
STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443
```

プローブはホストのネットワークを使い、`http://localhost` 経由で OneUptime に到達します。`npm start` がこれを ingress の新しいポート `http://localhost:8080` に移し、そのことを表示します。

#### プロキシの背後にあることを OneUptime に伝える

```ini title="config.env"
HOST=oneuptime.example.com
HTTP_PROTOCOL=https
PROVISION_SSL=false
TRUSTED_PROXY_HOPS=2
```

`HTTP_PROTOCOL=https` を設定すると、OneUptime が作るリンクが HTTPS になります。`TRUSTED_PROXY_HOPS=2` はあなたのプロキシと OneUptime の ingress を数えるので、OneUptime は IP 許可リストとレート制限に訪問者の実際のアドレスを使います。CDN やロードバランサーなど、`X-Forwarded-For` に追記するプロキシがほかにもあれば、その分だけ 1 ずつ増やしてください。

#### 新しいポートで OneUptime を再起動する

```bash
npm start
```

`npm start` は新しいポート `localhost:8080` で OneUptime を確認し、最後に **OneUptime is up!** と表示して終了します。

#### プロキシを構成する

:::tabs
@tab Caddy
```text title="Caddyfile"
oneuptime.example.com {
	reverse_proxy localhost:8080
}
```
Caddy は証明書を自分で取得・更新し、HTTP を HTTPS にリダイレクトし、WebSocket 接続を通します。ファイルを変更したら、`sudo systemctl reload caddy` などで Caddy を再読み込みしてください。
@tab Nginx
```nginx title="/etc/nginx/conf.d/oneuptime.conf"
map $http_upgrade $oneuptime_connection_upgrade {
    default upgrade;
    ""      close;
}

server {
    listen 80;
    server_name oneuptime.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name oneuptime.example.com;

    ssl_certificate     /etc/letsencrypt/live/oneuptime.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oneuptime.example.com/privkey.pem;

    # The limits OneUptime's own ingress uses.
    client_max_body_size 50M;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $oneuptime_connection_upgrade;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }

    # MCP clients keep a stream open.
    location /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
証明書のパスは、Certbot が Let's Encrypt 証明書を置く場所です。証明書をほかから入手した場合は、そのパスを使ってください。`sudo nginx -t && sudo systemctl reload nginx` でファイルを確認し、Nginx を再読み込みします。
:::

どちらも `X-Forwarded-Proto` を送ります。これは、訪問者が HTTPS で来たことを OneUptime に伝えます。ほかのプロキシを使う場合もこれを送る必要があります。送らないと、カスタムドメイン上のステータスページとダッシュボードのサインイン用 Cookie が HTTPS 上に保たれません。

#### プロキシ経由でインスタンスを開く

`https://oneuptime.example.com` を開きます。プロキシの証明書で提供された OneUptime のサインインページが表示されるはずです。
:::

> [!NOTE]
> 独自のプロキシの背後では、テレメトリを OTLP/HTTP (`/otlp`) で送信してください。gRPC による OTLP が OneUptime に届くのは、OneUptime 自身の ingress が TLS を終端する場合 (`PROVISION_SSL=true`) だけです。

## 訪問者のアドレス

OneUptime は、訪問者が接続してくるアドレスでそれぞれの訪問者を数えます。サインインの制限、そのほかのアドレスごとの制限、ステータスページとダッシュボードの IP 許可リストは、どれもこのアドレスを使います。次の 2 つの構成では、このアドレスを訪問者自身のものにするための設定が必要です。

| 構成 | 設定 |
| --- | --- |
| IPv6 で OneUptime にアクセスする人がいる (たとえば `AAAA` レコード経由) | `docker-compose.override.yml` で OneUptime のネットワークの IPv6 をオン |
| OneUptime の前に独自のリバースプロキシがある | `TRUSTED_PROXY_HOPS=2` と、`127.0.0.1` で公開した ingress ([独自のリバースプロキシを使う](#独自のリバースプロキシを使う)を参照) |

OneUptime のネットワークで IPv6 がオンになっていないと、Docker は IPv6 で来た訪問者をすべて自分の 1 つのアドレスから OneUptime に渡すため、OneUptime は全員を 1 人の訪問者として数えます。その結果、1 人のサインイン失敗によって他の人が締め出されることがあります。IPv6 をオンにするには Docker Engine 27 以降が必要です (`docker version` で確認できます)。

:::steps
### IPv6 をオンにする

`docker-compose.override.yml` を `docker-compose.yml` の隣に作成するか、すでにあるファイルに次を追加します。`npm start` と `npm run update` はこのファイルを読み込みます。

```yaml title="docker-compose.override.yml"
networks:
  oneuptime:
    enable_ipv6: true
```

### OneUptime を再起動する

```bash
npm stop
npm start
```

OneUptime がいったん止まり、ネットワークの IPv6 がオンになった状態で再び起動します。データはそのまま残ります。自分のコンテナー (リバースプロキシなど) がつながっているネットワークは Docker が削除できないため、先に OneUptime のネットワークから切り離し、あとでつなぎ直してください。`npm start` が `has active endpoints` で止まった場合は、切り離してから `npm stop` と `npm start` をもう一度実行します。

### ネットワークを確認する

```bash
docker network ls --quiet --filter name=_oneuptime | xargs docker network inspect | grep EnableIPv6
```

`"EnableIPv6": true,` と表示されます。
:::

複数の人が同じプライベートネットワークアドレスからサインインしている場合は、Admin Dashboard の **OneUptime の正常性** ページがそのことと、それを変える設定を知らせます。

## 本番環境のチェックリスト

Docker Compose は 1 台のサーバーで各サービスを 1 つずつ実行するため、小規模なチームやホームラボに向いています。本番で使う前に、このリストを確認してください。

| 項目 | やること |
| --- | --- |
| **シークレット** | `config.env` に `please-change-this-to-random-value` のプレースホルダーが残っていない。 [ランダムなシークレットを生成する](#ランダムなシークレットを生成する) を参照してください。プレースホルダーの `DATABASE_PASSWORD` のまま起動したインストールは [データベースのパスワードを変更する](#データベースのパスワードを変更する) を参照してください。 |
| **HTTPS** | OneUptime に HTTPS でアクセスでき、`HTTP_PROTOCOL=https` が設定されている。 [HTTPS を設定する](#https-を設定する) を参照してください。 |
| **サインアップ** | チームのアカウントがそろったら、Admin Dashboard の **設定 > 認証** で **サインアップを許可** をオフにする。 |
| **ファイアウォール** | インターネットに開いているのはポート 80 と 443 (と SSH) だけ。OneUptime は PostgreSQL のポート 5400 を `127.0.0.1` だけで公開します。自分で公開するほかのポートは、クラウドプロバイダーのファイアウォールで閉じてください。`ufw` のルールは Docker が公開するポートには適用されません。 |
| **訪問者のアドレス** | Admin Dashboard の **OneUptime の正常性** ページが、複数の人が 1 つのアドレスからサインインしていると知らせていない。[訪問者のアドレス](#訪問者のアドレス)を参照。 |
| **バックアップ** | PostgreSQL を毎日バックアップし、コピーをサーバーの外に置く。 [バックアップと復元](#バックアップと復元) を参照してください。 |
| **メール** | OneUptime が招待と通知を送れるよう、Admin Dashboard の **設定 > 通知 > メール** でメールサーバーを設定する。 [SMTP](/docs/emails/smtp) を参照してください。 |
| **ディスク** | 空き容量を監視する。ClickHouse は保持するテレメトリに応じて大きくなります ( [サイジングとキャパシティプランニング](/docs/installation/sizing) を参照)。各コンテナーのログは 1000 MB が上限です。 |
| **アップデート** | OneUptime を少なくとも週に 1 回アップデートする。リリースは頻繁に出ます。 [OneUptime をアップデートする](#oneuptime-をアップデートする) を参照してください。 |
| **高可用性** | 必要なら、Kubernetes の [Helm チャート](https://artifacthub.io/packages/helm/oneuptime/oneuptime) に移行する。 |

### データベースのパスワードを変更する

PostgreSQL は作成されたときのパスワードを保ち続けるため、`config.env` の `DATABASE_PASSWORD` だけを変えると、OneUptime は自分のデータベースに接続できなくなります。プレースホルダーのまま起動したインストールに専用のパスワードを設定するには、PostgreSQL と `config.env` の両方で同時に変更してから、OneUptime をもう一度起動します。

```bash
NEW_PASSWORD=$(openssl rand -hex 32) &&
  echo "ALTER USER CURRENT_USER PASSWORD '$NEW_PASSWORD';" | sh Scripts/Install/WithConfig.sh sh -c 'docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DATABASE_USERNAME" -d "$DATABASE_NAME"' &&
  sed -i "s/^DATABASE_PASSWORD=.*/DATABASE_PASSWORD=$NEW_PASSWORD/" config.env
npm start
```

`DATABASE_BACKUP_PASSWORD` と `DATABASE_RESTORE_PASSWORD` を設定している場合は、それらにも新しい値を設定してください。

## バックアップと復元

PostgreSQL には、モニター、インシデント、ステータスページ、ユーザーなど、設定したものがすべて入っています。`npm run backup` はそれを `Backups` フォルダーのファイルにダンプします。Enterprise Edition では、Admin Dashboard から PostgreSQL と ClickHouse を自分のストレージにスケジュールでバックアップすることもできます。[バックアップ](/docs/installation/backups)を参照してください。

:::steps
### バックアップスクリプトにデータベースのパスワードを渡す

`config.env` で、`DATABASE_BACKUP_PASSWORD` に `DATABASE_PASSWORD` の値を設定します。スクリプトは `config.env` をプレーンテキストとして読むため、同梱の `${DATABASE_PASSWORD}` が置き換えられることはありません。

### バックアップを実行する

```bash
npm run backup
```

sudo のパスワードを求められ、`Backups/db-<day of the month>.backup` が書き込まれます。そのため、毎日のバックアップは 1 か月前のものを置き換えます。少なくとも 1 日 1 回は実行してください。

### バックアップをサーバーの外にコピーする

データベースと同じディスクにあるバックアップは、そのディスクが失われると一緒に失われます。
:::

PostgreSQL に到達できるのはサーバー自身だけで、`127.0.0.1` のポート 5400 で応答します。別のマシンからバックアップするには、そのマシンから SSH トンネルを開き、そのマシン自身のポート 5400 に接続します。

```bash
ssh -N -L 5400:127.0.0.1:5400 you@oneuptime.example.com
```

:::details PostgreSQL をプライベートネットワークのアドレスで公開する
プライベートネットワーク上のツールがトンネルなしで PostgreSQL に到達する必要がある場合は、そのネットワークでのサーバーのアドレスでも、別のポートで公開します。`docker-compose.yml` の隣に `docker-compose.override.yml` を作成します。`npm start` と `npm run update` はこのファイルを読み込みます。

```yaml title="docker-compose.override.yml"
services:
  postgres:
    ports:
      - "10.0.0.5:5401:5432"
```

`10.0.0.5` の代わりにサーバー自身のプライベートアドレスを指定し、パブリックなアドレスは決して使わないでください。また、先に PostgreSQL に専用のパスワードを設定してください ([データベースのパスワードを変更する](#データベースのパスワードを変更する) を参照)。そのあと `npm start` を実行すると、PostgreSQL はそのアドレスのポート 5401 でも応答します。
:::

ClickHouse はテレメトリを Docker ボリューム `oneuptime_clickhouse` に保存しており、これをバックアップするスクリプトはありません。そのテレメトリを残す必要がある場合は、[clickhouse-backup](https://github.com/Altinity/clickhouse-backup) などの ClickHouse ツールでボリュームをバックアップするか、OneUptime を停止してからコピーしてください。

PostgreSQL を復元するには、`config.env` で `DATABASE_RESTORE_*` の値を設定します。`DATABASE_RESTORE_PASSWORD` にはバックアップのときと同じく `DATABASE_PASSWORD` の値を、`DATABASE_RESTORE_FILENAME` には復元するバックアップ (例: `db-31.backup`) を設定します。続いて `bash restore.sh` を実行します。復元先のデータベースはすでに存在している必要があります。稼働中のインストールであれば存在します。

> [!CAUTION]
> `restore.sh` は、バックアップに含まれる各オブジェクトを復元先のデータベースから削除してから作り直します。開始前に確認を求めるので、表示されるデータベース名を確かめてください。

## OneUptime をアップデートする

まずバックアップを取り、次に以下を実行します。

```bash
git checkout release
git pull
npm run update
```

`npm run update` は `config.example.env` の新しい設定を `config.env` に追加し (独自の値はそのまま残ります)、新しいイメージを取得して OneUptime を再起動します。`npm start` と同様に、最後に **OneUptime is up!** と表示して終了します。

新しいメジャーバージョンへの移行 (たとえば 13 から 14) では、さらに作業が必要な場合があります。始める前に [OneUptime のアップグレード](/docs/installation/upgrading) を読んでください。

`config.env` の `APP_TAG=release` は、常に Community Edition の最新リリースを取得します。特定のバージョンにとどまるには、`APP_TAG` にその番号 (例: `14.0.22`) を設定します。Enterprise Edition のタグは `enterprise-release` と `enterprise-14.0.22` です。

## OneUptime をアンインストールする

OneUptime を停止し、コンテナーとネットワークを削除します。

```bash
npm run down
```

データは `oneuptime_postgres` と `oneuptime_clickhouse` のボリュームに残り、`oneuptime` フォルダーには `config.env` とバックアップが残ります。データも削除するには次を実行します。

```bash
sh Scripts/Install/WithConfig.sh docker compose down --volumes --remove-orphans
```

その後、`oneuptime` フォルダーを削除します。

> [!CAUTION]
> `--volumes` は、すべてのモニター、インシデント、ユーザー、テレメトリを完全に削除します。どれかが必要になる可能性があるなら、先にバックアップを取ってください。

## トラブルシューティング

:::details npm start が OneUptime を起動する前に止まる
`npm start` は最初にサーバーを確認し、OneUptime の動作を妨げる問題があればそこで止まります。Docker やその Compose プラグインがない、Docker が動いていないかユーザーから使えない、別のプログラムがポートを使っている、`HOST` がどのブラウザーでも開けないアドレスになっている、といった場合です。✗ の付いた各行が、何を変えればよいかを示します。それを直してから、もう一度 `npm start` を実行します。チェックがサーバーについて誤っている場合は、チェックなしで起動します。

```bash
ONEUPTIME_SKIP_PREFLIGHT=true npm start
```
:::

:::details npm start を実行すると Docker が "permission denied" と表示する
ユーザーが Docker デーモンにアクセスできません。ユーザーを `docker` グループに追加し、サインアウトしてからサインインし直します。

```bash
sudo usermod -aG docker $USER
```
:::

:::details ポート 80 または 443 が使用中で ingress が起動できない
サーバー上の別のプログラム (多くの場合は Web サーバー) がポートを使っています。`npm start` は何かを起動する前にポートを確認し、ポートを使っているのが Docker のコンテナーならその名前を表示します。そのプログラムを停止するか、ingress を別のポートに移し、 [独自のリバースプロキシを使う](#独自のリバースプロキシを使う) の説明どおりにそのプログラムを OneUptime の前に置きます。
:::

:::details npm start が "Maximum retries reached" で終了する
`npm start` の最後のチェックが、OneUptime が応答する前にあきらめました。イメージのダウンロードとデータベースの作成が進む最初の起動では、チェックの待ち時間より長くかかることがあります。何が動いているかを確認し、ログを読みます。

```bash
npm run ps
npm run logs
```

すべてのコンテナーが動いたら、`npm run status-check` でもう一度チェックします。このチェックは、`ONEUPTIME_HTTP_PORT` が指定するポートで ingress を確認します。
:::

:::details ブラウザーに "このアドレスでは OneUptime が設定されていません" と表示される
`HOST` とは別のアドレスで OneUptime を開いています。たとえば `HOST` がまだ `localhost` のまま、サーバーの IP アドレスで開いた場合です。ページには開いたアドレス用の `HOST` の行と、それをコピーするボタンが表示されます。その行を `config.env` に書き、`npm start` を実行してください。`HOST` のアドレスで開いたのに、プロキシがアドレスを渡していないとページに表示される場合は、ブラウザーが要求したホスト名をそのまま渡すようにプロキシを設定します。Caddy は既定でそうします。Nginx では `proxy_set_header Host $host;`、Apache では `ProxyPreserveHost On` を使います。
:::

:::details 一部のページは表示されるが、ライブ更新やアップロードが失敗する
`HOST` のアドレスで OneUptime を開いてください。ingress はホスト名でリクエストをルーティングします。アプリケーション全体に到達するのは `HOST` と `localhost` だけで、サーバーの IP アドレスなどそれ以外の名前はステータスページのドメインとして扱われます。`HOST` を実際に使う名前に設定し、`npm start` を実行してください。
:::

:::details サインアップやサインインが "Page not found" で失敗する
サインアップページは表示されますが、サインアップは `Page not found - /identity/signup`、サインインは `Page not found - /identity/login` で失敗します。リクエストが `HOST` 以外のホスト名で OneUptime に届いたため、ingress はそれをステータスページのカスタムドメインとしてルーティングしました。そこでは OneUptime 自体のサインアップとサインインは提供されません。次の両方を確認してください。

- `HOST` が、利用者が開くアドレスになっていること。ポートを使う場合は `oneuptime.example.com:8080` のようにポートも含めます。変更したら `npm start` を実行してください。
- OneUptime の前段のプロキシが、ブラウザーが要求したホスト名をそのまま渡していること。Caddy は既定でそうします。Nginx では [独自のリバースプロキシを使う](#独自のリバースプロキシを使う) のとおり `proxy_set_header Host $host;`、Apache では `ProxyPreserveHost On` を使います。
:::

:::details PROVISION_SSL を設定したあと、ブラウザーが証明書について警告する
Let's Encrypt が証明書を発行するまで、ingress は一時的な自己署名証明書を提供します。数分たっても警告が消えない場合は、次を確認します。

- `HOST` が IP アドレスや `localhost` ではなく、ドメイン名であること。
- ドメインの DNS レコードがこのサーバーを指していること。
- Let's Encrypt がドメインを検証できるよう、ポート 80 にインターネットから到達できること。

注文が失敗すると、アプリは `CoreSSL:EnsurePrimaryHostCertificate` で始まり、理由が続くエラーをログに記録します。

```bash
sh Scripts/Install/WithConfig.sh docker compose logs app | grep -A 5 CoreSSL
```
:::

:::details ingress のポートを移したあと、同梱のプローブが切断済みと表示される
Admin Dashboard は **設定 > 監視 > グローバルプローブ** でプローブを表示します。プローブは `GLOBAL_PROBE_1_ONEUPTIME_URL` で OneUptime に到達し、その値はデフォルトで `http://localhost` (ポート 80) です。これが `localhost` を指している間は、`npm start` が ingress のポートに合わせて移します。別のアドレスに設定した場合や、Docker CLI で OneUptime を起動した場合は、これを ingress の新しいポート (例: `http://localhost:8080`) に設定してから OneUptime を再起動します。
:::

## 次のステップ

:::cards
- [OneUptime のアップグレード](/docs/installation/upgrading): 各メジャーバージョンで必要な作業。
- [サイジングとキャパシティプランニング](/docs/installation/sizing): テレメトリに必要なメモリとディスクを計画します。
- [セルフホストのアーキテクチャ](/docs/self-hosted/architecture): コンポーネントの組み合わさり方。
- [エンタープライズ版](/docs/self-hosted/enterprise): Enterprise イメージで追加されるものと、そのライセンス。
:::
