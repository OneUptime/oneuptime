# カスタム プローブ

カスタムプローブは、自分のネットワーク内で実行する小さなエージェントです。追加したモニター (社内の Web サイト、API、ファイアウォールの内側のサーバーなど) をチェックし、結果を OneUptime に送ります。HTTPS で外向きの接続だけを開くため、ネットワーク内のどこにもインターネットからの接続を受け入れる必要はありません。

:::cards
- [仕組み](#仕組み): プローブが行うことと、OneUptime がプローブの稼働を知る方法。
- [プローブをインストールする](#プローブをインストールする): OneUptime で作成し、Docker、Docker Compose、Kubernetes で実行して、モニターに追加します。
- [環境変数](#環境変数): プローブが読むすべての設定とそのデフォルト値。
- [切断されたプローブを調べる](#切断されたプローブを調べる): プローブから OneUptime へのリクエストがどこで止まっているかを突き止めます。
:::

## 仕組み

```mermaid title="カスタムプローブが行うこと"
sequenceDiagram
    participant P as カスタムプローブ
    participant S as あなたのサービス
    participant O as OneUptime
    P->>O: 稼働中です (毎分)
    P->>O: 自分のモニターのうち、どれが実行時期?
    O-->>P: チェックするモニター
    P->>S: それぞれをチェック
    P->>O: 結果を送信
    O->>O: ステータスを更新し、インシデントやアラートを開く
```

- **プローブは外向きに接続します。** すべてのリクエストはプローブから `ONEUPTIME_URL` へ HTTPS で送られます。ネットワークの外からプローブに届く必要のあるものはありません。
- **自分のモニターだけをチェックします。** プローブは自分が追加されているモニターを OneUptime に問い合わせ、それぞれを実行時期にチェックして結果を返します。モニターのステータスが変わるかどうかは、OneUptime が結果をもとに判断します。
- **OneUptime はプローブの稼働を見守ります。** プローブからのリクエストはどれも生存の合図として数えられ、プローブは少なくとも毎分 1 回送ります。約 3 分間何も届かないと、プローブは **切断済み** と表示され、その所有者に通知されます。所有者のいないプローブでは、プロジェクトの所有者に通知されます。

## 始める前に

- **OneUptime Cloud では Growth プラン。** プローブの作成に必要です。セルフホストのインストールにはプランの制限はありません。
- **プローブを作成する権限。** プロジェクトのオーナー、管理者、メンバーが持っており、ロールでプローブの作成が許可されている人も持っています。
- **監視したいネットワーク内のマシン。** Docker、Docker Compose、Kubernetes のいずれか、プローブがチェックするサービスへの経路、`ONEUPTIME_URL` への外向きの HTTPS が必要です。

## プローブをインストールする

:::steps
### プローブを作成する

**モニター → 設定 → プローブ** を開き、 **プローブを作成** をクリックします。 **名前** と **説明** を入力します。どちらも必須です。 **その他の項目** には **プローブロゴ** 、作成するすべての新しいモニターでこのプローブを選択する **新しいモニターで自動的に監視を有効化** 、そして **ラベル** があります。

### ID とキーをコピーする

プローブの接続には ID とキーが必要です。コピーするには、 **カスタムプローブ** テーブルでプローブのメニューを開き、 **ID とキーを表示** を選びます。テーブルを見られる人は誰でもプローブの ID をコピーできますが、キーが表示されるのはプロジェクトのオーナーと管理者だけです。彼らには **ID とキーを表示** が表示され、他の人には **ID を表示** が表示されます。

プロジェクトのオーナーと管理者はプローブをクリックすることもできます。そのページの **カスタムプローブをセットアップ** カードには、ID とキーが入力済みの Docker コマンドが表示されます。

### プローブを実行する

選んだマシンで、プローブの ID とキーを使って実行します。OneUptime をセルフホストしている場合は、 `ONEUPTIME_URL` を `https://oneuptime.com` ではなく自分のインストールの URL にしてください。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

その後、 `docker compose up -d` で起動します。
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

その後、 `kubectl apply -f oneuptime-probe.yaml` で適用します。
:::

ホストネットワーク (`--network host`、 `network_mode: host`) を使うと、プローブはホスト自身のネットワークを IPv6 も含めて使えます。ホストネットワークなしで実行する前に、 [IPv6 の宛先を監視する](#ipv6-の宛先を監視する) をお読みください。

### 接続を確認する

1、2 分以内に、 **カスタムプローブ** テーブルのプローブの **ステータス** が **接続済み** になります。 **切断済み** のままなら、理由はプローブのログに書かれています。 [切断されたプローブを調べる](#切断されたプローブを調べる) を参照してください。

### プローブにモニターをチェックさせる

プローブがチェックするのは、追加されているモニターだけです。新しいモニターは **モニターを作成** の **プローブと間隔** ステップでプローブを選びます。既存のモニターでは、モニターを開いて **構成 → プローブと間隔** に移動します。このページには 3 枚のカードがあります。

- **監視間隔** : モニターの各プローブがどのくらいの頻度でチェックするか。間隔を選ぶとすぐに保存されます。合成、Custom Code、SSL 証明書のモニターでは 5 分以上の間隔が提示されます。すでにそれより短い間隔や API で設定したスケジュールのモニターは、その設定を保ったまま一覧に表示します。
- **プローブ** : **プローブを追加** をクリックし、カスタムプローブを選びます。プローブにこのモニターのチェックをやめさせるには、行のメニューの **編集** でオフにするか、行を削除します。
- **プローブの合意** : ステータスが変わる前に、モニターのプローブのうちいくつが同じ結果を見る必要があるか。「... のプローブが一致したら、このモニターのステータスを変更する」という文に入力します。すべてのプローブにするにはボックスを空のままにします。参加するのはオンで接続中のプローブだけなので、それより大きい数もすべてを意味します。数はボックスを離れるか **Enter** を押すと保存されます。

プローブがチェックしないモニター (手動、受信リクエスト、受信メール、サーバー、ネットワークデバイス、テレメトリのモニター) には、プローブと間隔のページはありません。
:::

> [!TIP]
> `http://10.0.0.5/health` のようなプライベートアドレスをチェックするプローブには `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` が必要です。許可するまで、プローブはプライベートアドレスを拒否します。 [プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access) を参照してください。

## プロキシ経由で接続する

プローブが OneUptime やチェック対象のサイトに届くためにプロキシを通す必要がある場合は、プロキシのアドレスを指定します。

| 変数 | 役割 |
| --- | --- |
| `HTTPS_PROXY_URL` | OneUptime 自体やほとんどのサイトを含む、HTTPS アドレス用のプロキシ。 |
| `HTTP_PROXY_URL` | 平文の HTTP アドレス用のプロキシ。 |
| `NO_PROXY` | プローブが直接接続するホスト。カンマ区切りです。 |

プロキシのアドレスは `http://proxy.example.com:8080` と書き、ユーザー名とパスワードを求めるプロキシなら `http://username:password@proxy.example.com:8080` と書きます。ほとんどのプロキシは両方の種類のアドレスを扱うので、両方の変数に同じ URL を設定してください。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

プロキシを通るもの:

- **プローブ自身から OneUptime へのリクエスト。**
- **モニターの HTTP チェック** : Website、API、External Status Page、Custom Code、SSL 証明書、合成、ドメインのモニター。SSL 証明書と合成のモニターは `HTTPS_PROXY_URL` を使い、それだけが設定されている場合は `HTTP_PROXY_URL` を使います。
- **その他のチェックは通りません。** Ping、Port、DNS、SNMP など HTTP ではないチェックは直接接続します。

`NO_PROXY` のエントリーは、ホスト名 (`api.internal`)、先頭にドットか `*.` を付けてその下のすべての名前を表すドメイン (`.internal.example.com`)、そのどちらかに `:port` を付けたもの、またはすべてを表す `*` です。IP の範囲は読み取られないので、アドレスを 1 つずつ並べてください。小文字の `http_proxy`、 `https_proxy`、 `no_proxy`、そして `HTTP_PROXY` と `HTTPS_PROXY` も使えます。

## IPv6 の宛先を監視する

プローブが IPv6 の宛先を監視できるのは、プローブ自身のネットワークに IPv6 がある場合だけです。

- **`--network host` 付きの Docker、または `network_mode: host` 付きの Compose** (上記の構成): プローブはホストのネットワークを共有するので、ホストに IPv6 があるときに限り IPv6 があります。
- **Docker のブリッジネットワーク** (ホストネットワークなしの場合): そのネットワークで IPv6 をオンにしない限り IPv6 はありません (下記参照)。
- **Kubernetes** : Pod に IPv6 があるのは、デュアルスタックまたは IPv6 のみのクラスターだけです。

確認するには、プローブの内側から公開 IPv6 アドレスに ping します。

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` は、プローブが IPv6 の宛先に届くことを意味します。プローブに使える IPv6 がない場合、 `ping` はすぐに失敗し、エラーがその理由を示します。

| エラー | 意味 |
| --- | --- |
| `Network is unreachable` | プローブのネットワークに IPv6 のルートがありません。IPv6 のない Docker のブリッジネットワーク、IPv4 のみの Kubernetes クラスター、または IPv6 接続のないホストです。 |
| `Cannot assign requested address` | プローブのネットワーク名前空間で IPv6 がオフになっています。 `net.ipv6.conf.all.disable_ipv6` と `net.ipv6.conf.lo.disable_ipv6` を確認してください。プローブ内で `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` を実行すると、オフのときは `1` が出力されます。ホストネットワークでは、これらはホストの設定です。 |
| `Address family not supported by protocol` | カーネルが `ipv6.disable=1` で起動されているため、マシンに IPv6 がまったくありません。カーネルのコマンドラインから外して再起動するか、別のマシンでプローブを実行してください。 |

いずれの場合も宛先には何も送られていないので、プローブには宛先が稼働しているかどうかがわかりません。チェックはそれでも失敗しますが、Ping モニターの失敗理由は、宛先が応答しなかったとは言わず、プローブ側の問題であることを示します。

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

失敗とともに記録されるネットワークパスには `Traceroute could not run: this probe cannot send IPv6 traffic (...)` と表示されます。プローブのネットワークを直すか、IPv6 のあるプローブにモニターを移してください。

### ホストネットワークなしの IPv6

ホストネットワークを使えない場合は、IPv6 をオンにした Docker ネットワークにプローブを接続します。ホスト自体には引き続き IPv6 が必要です。

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 以降は、ネットワーク用の IPv6 サブネットを選び、プローブの外向きの IPv6 をホストのアドレスの背後でマスカレードします。それより古いバージョンでは、明示的な IPv6 サブネット (例: `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) と、 `/etc/docker/daemon.json` の `"ip6tables": true` と `"experimental": true` が必要です。Docker Compose では、 `network_mode: host` を外し、プローブのネットワークに `enable_ipv6: true` を設定します。

## 検出スキャンでの NetBIOS 名の照会

**Windows 名を照会（NetBIOS）** をオンにした [ネットワーク検出スキャン](/docs/monitor/network-device-monitor) は、SNMP システム名のない各ホストに、プローブから NetBIOS 名の照会 (NBSTAT) を送ります。これを使うスキャンでは、次の通信を許可してください。

- **照会されるホスト:** SNMP システム名も逆引き DNS 名 (PTR) もない検出済みのホストで、プライベートアドレス (`10.0.0.0/8`、 `172.16.0.0/12`、 `192.168.0.0/16`) またはキャリアグレード NAT アドレス (`100.64.0.0/10`) のものだけです。公開アドレスは照会されず、プローブからの逆引き DNS で名前が得られたホストには照会が送られません。逆引きが失敗した、タイムアウトした、または照会の時間予算が尽きて飛ばされたホストは、PTR レコードがあっても照会されることがあります。
- **送信:** プローブの 1 つのエフェメラル (ランダムで大きな番号の) 送信元ポートから、それらのホストの UDP ポート 137 への UDP。上記のプロキシ設定は適用されません。
- **受信:** 各ホストの UDP ポート 137 からそのエフェメラルポートへの応答。ステートフルファイアウォールなら自動的に許可されます。応答がないと、ホストは IP アドレスで呼ばれたままになります。

この照会にはコンテナーの追加の capability は不要で、Kubernetes の Pod ネットワークからも動作します。1 回のスキャンで照会するのは最大 2,000 ホスト (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` で 4,000 まで増やせます) で、応答のないホストにはもう 1 回だけ照会を送り、照会を毎秒約 100 件のペースで送り、その作業に合わせた時間制限で止まります - 2,000 ホストの完全な照会で約 54 秒、どんな場合も 2 分以内です。グローバルプローブはスキャンの設定にかかわらず NetBIOS の照会を送らないので、NetBIOS 名が必要なスキャンはカスタムプローブから実行してください。このオプションは新しいスキャンではオンです。多数のホストへの NBSTAT 照会は侵入検知のルールに引っかかることがあるため、それが問題になるネットワークのスキャンではオフにするか、事前にセキュリティチームに伝えてください。

## 環境変数

プローブは起動時に環境から設定を読みます。設定を変えたら、プローブを再起動してください。プローブが読めない数値や、変数が許す範囲外の数値は無視され、デフォルト値が使われます。パケットキャプチャの上限だけは、代わりにその範囲内に収められます。

### 必須

| 変数 | 内容 |
| --- | --- |
| `PROBE_KEY` | **ID とキーを表示** で得られるプローブのキー。これがないとプローブは起動時に停止します。 |
| `PROBE_ID` | **ID とキーを表示** で得られるプローブの ID。これがないとプローブは起動時に停止します。 |
| `ONEUPTIME_URL` | OneUptime の場所。 `https://oneuptime.com` または自分のインストールの URL です。これがないとプローブは起動時に停止します。 |

### モニターのチェック

| 変数 | デフォルト | 役割 |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | プローブが同時にチェックするモニターのバッチ数。 |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | 1 つのバッチに含まれるモニターの数。 |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | 失敗したモニターチェックの最初の試行の後の再試行回数。ステップが独自の回数を設定していないときに使われ、最大 4 回の試行になります。 `0` で再試行をオフにします。 |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | 1 つのモニターをチェックする期限。過ぎるとチェックは打ち切られ、次のサイクルで再試行されます。合成スクリプトのタイムアウトを上げるとデフォルトも伸びるので、スクリプトが途中で切られることはありません。 |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | 合成モニターのスクリプトのタイムアウト (ミリ秒)。 |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | `true` にすると、合成モニターの Chromium を専用のサンドボックス内で実行します。プローブのコンテナーが、Playwright のものなど、サンドボックスを許可する seccomp プロファイルで動いている場合にだけオンにしてください。そのようなプロファイルがないと Chromium は起動できません。オフの間は、プローブが起動時に警告をログに出します。 |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Custom Code モニターのスクリプトのタイムアウト (ミリ秒)。 |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | `true` にすると、このプローブの Website、API、External Status Page、Custom Code のモニターがプライベートアドレスに届けるようになります。 [プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access) を参照してください。 |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | プローブが同時にポーリングするネットワークデバイスの数。多くのデバイスをポーリングするプローブでは値を上げてください。 |

合成モニターが動作する上限 (同時に動く数、メモリ、ディスク) は [合成モニター](/docs/monitor/synthetic-monitor) のページにあります。

### OneUptime との通信

| 変数 | デフォルト | 役割 |
| --- | --- | --- |
| `HTTP_PROXY_URL`、 `HTTPS_PROXY_URL`、 `NO_PROXY` | なし | プロキシの設定。 [プロキシ経由で接続する](#プロキシ経由で接続する) を参照してください。 |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | プローブが OneUptime に送る各リクエストの期限。 |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | OneUptime へのリクエストがこれより遅いと警告をログに出します。 |

### ネットワーク検出

| 変数 | デフォルト | 役割 |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 分) | 1 回のネットワーク検出スイープの期限。過ぎると打ち切られ、スキャンは失敗として報告されます。 |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | 実行中の検出スイープが、それまでに見つけたホストをアップロードする頻度。長いスキャンでも進捗が見え、完了前にデバイスをインポートできます。最小 `5000`。 |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | 検出スイープが同時に調べるアドレスの固定数。未設定 (または `0`) にすると、スキャンの対象から算出されます。プローブのコンテナーが極端に小さいか大きい場合を除き、それが望ましい設定です。 |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | スイープで見つかったホストの逆引き DNS 名 (PTR) を調べる時間制限 (ミリ秒)。下記を参照してください。 |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | 1 回のスキャンの NetBIOS 照会が問い合わせてよいホスト数。下記を参照してください。 |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | このプローブで同時に実行される独立した検出スキャンの最大数。1 から 16 までです。下記を参照してください。 |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` : 未設定 (または `0`) にすると、制限はホスト数から算出されます。約 860 ホストまでは 60 秒で、そこから増えて最大 10 分です。1000 から 1200000 まで設定できます。時間内に照会が届かなかったホストには逆引き DNS 名が付かず (SNMP や NetBIOS が名前を付けない限り IP アドレスで表示されます)、スキャンのステータスメッセージに取りこぼした数が示されます。タイムアウトまたは失敗した照会は、制限が続く間に 1 回だけ再試行され、プローブのネームサーバーに順番に問い合わせます。遅い DNS サーバーの背後にある大規模なネットワークでは値を上げてください。

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` : NetBIOS 名をオンにしたスキャンでは、SNMP システム名のないすべてのホストに照会し、逆引き DNS 名のないホストを先に照会します。未設定 (または `0`) にすると組み込みの上限 2,000 のままです。1 から 4000 まで設定できます。上限を超えたホストには照会されず、スキャンのステータスメッセージにその数が示されます。値を上げると照会にかかる時間も伸び (時間制限はこの値から算出され、4,000 ホストで約 104 秒)、ネットワークに流れる NBSTAT データグラムも増え、侵入検知のルールに注目されます。

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` : 余裕がある間、プローブは毎分ほかの保留中のスキャンを確認するので、長いスキャンが他のすべてのスキャンをふさぐことはありません。すべての枠が使われているときは、追加のスキャンは枠が空くまで保留されます。スキャンごとに独自のホスト並列度があるため、リソースの使用量は両方の設定に応じて増えます。小さなコンテナーではどちらかの上限を下げてください。1 にするとスキャンを 1 つずつ順番に実行します。

並列検出を使うためにカスタムプローブを更新する前に、OneUptime サーバーを更新してください。サーバーは、プローブがまだ実行中のスキャンを除外できる必要があり、それによって実行中のスキャンを編集しても新しい構成が安全にキューに入ります。更新したプローブを古いサーバーにつなぐ場合は、サーバーを更新するまで `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` を設定してください。

### パケットキャプチャ

| 変数 | デフォルト | 役割 |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | オフ | `true` にすると、権限を持つ人がダッシュボードからこのプローブでパケットキャプチャを開始できます。キャプチャにはホストネットワークと `NET_RAW` capability も必要です。 [パケットキャプチャ](/docs/probe/packet-capture) を参照してください。 |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | このプローブが実行する最長のパケットキャプチャ。5 から 1800 までです。 |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | このプローブが作る最大のキャプチャファイル。1 から 25 までです。 |

### プローブが待ち受けるもの

リスナーをオンにするか、デフォルトでオンのリスナーをそのままにしない限り、プローブは外向きの接続しか行いません。

| リスナー | 設定 | デフォルト | 詳細 |
| --- | --- | --- | --- |
| 受信リクエストとハートビート | `PROBE_INGRESS_PORT` | オフ | [受信リクエスト Ingress](/docs/probe/incoming-request-ingress) |
| SNMP トラップ | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | オン、UDP 162 | [ネットワークデバイス モニター](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | オフ、UDP 5140 | [ネットワークベンダー別ガイド](/docs/monitor/network-vendor-guides) |
| NetFlow、IPFIX、sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | オン、UDP 2055、4739、6343 | [ネットワークトラフィック](/docs/monitor/network-traffic) |
| ヘルスチェック | `PORT` | オン、TCP 3874 | `/status/live` と `/status/ready` |

コンテナー内では、ホストネットワークを使うか公開しない限り、ポートに他のマシンから届くことはありません。

Syslog レシーバーが転送するメッセージは 1 分あたり最大 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` 件 (既定値は `600`) で、残りは破棄され、破棄した件数がログに出ます。

`PROBE_NAME` と `PROBE_DESCRIPTION` を読むのは、 `REGISTER_PROBE_KEY` で自分自身を登録するプローブ (セルフホストのインストールがすべてのプロジェクト向けに実行するプローブなど) だけです。カスタムプローブは、名前と説明をダッシュボードから受け取ります。

## トラブルシューティング

### 切断されたプローブを調べる

プローブから OneUptime へのリクエストが成功しなくなると、プローブは `Disconnected` とされます。失敗した各リクエストがどこで止まったかはプローブのログに書かれているので、推測する必要はほとんどありません。

:::steps
#### 起動時に出力される環境ブロックを読む

すべてのプローブは起動時に 1 つの JSON ブロックを出力します。使っている OneUptime の URL、リクエストの期限、プロキシ設定、引き継いだ DNS リゾルバー、Node と OS のバージョン、TLS 検証が無効化されているかどうかが含まれます。問題を報告するときは必ずこのブロックを添えてください。

#### 失敗レポートを見つける

OneUptime へのリクエストが失敗するたびに、 `stalledAt` と `whatThisMeans` を含むブロックがログに出ます。 `stalledAt` は、リクエストが通過できなかった段階です。

| `stalledAt` | 意味 |
| --- | --- |
| `SocketAssignment` | マシンから何も出ていません。ソケットプールが飽和していたか、設定したプロキシが CONNECT トンネルを確立しませんでした。 |
| `TcpConnect` | マシンは SYN を送りましたが、何も返ってきませんでした。ファイアウォールやセキュリティ機器がパケットを捨てているか、ホストに到達できません。 |
| `TlsHandshake` | TCP は接続しましたが、TLS が完了しませんでした。多くの場合、TLS を検査する中間装置です。 |
| `RequestSend` | 接続はしましたが、リクエストが最後まで書き込まれませんでした。相手側が読み取りを止めています。 |
| `WaitingForServerResponse` | リクエストは届きましたが、サーバーから何も返ってきませんでした。 **プローブのネットワークは正常です** 。OneUptime サーバー、そのロードバランサー、リバースプロキシを確認してください。 |
| `ResponseBody` | サーバーは応答を始めましたが、途中で止まりました。 |
| `Unknown` | プローブはリクエストがどこで止まったかを判別できませんでした。次は下の接続の自己テストを読んでください。 |

同じブロックには `deadlineOverrunInMs` も含まれます。45000ms の期限が実時間で 45000ms を大きく超えていた場合は、プローブのプロセス自体がブロックされていました。ネットワークを調べる前に、ブロック内の `probeProcess.eventLoopMaxDriftInMs` を確認してください。

#### 接続の自己テストを読む

3 回続けて失敗すると、プローブは同じサーバーを 1 層ずつ (DNS、TCP、TLS、そして実際の HTTP の往復の順に) テストし、各段階を所要時間とともにログに出します。最初に失敗した段階が答えです。プロキシを設定している場合、プローブはプロキシまでの区間をテストします。実際にプローブが通るのはその区間だけだからです。このテストは最大で 5 分に 1 回実行されます。

#### 失敗になる前に遅いリクエストに気づく

成功しても `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` より時間がかかったリクエストは、経過時間とともにログに出ます。20 秒のリクエストをログに出し始めたプローブは、45 秒の期限を超えつつあります。
:::

OneUptime サーバー側でも、応答の遅かったプローブのリクエストや、応答が送られる前にプローブがあきらめたリクエストが、プローブの id とともにログに記録されます。この 2 つのログを合わせれば、接続のどちら側に問題があるかがわかります。

### その他の問題

:::details プローブが起動直後に停止する
ログに足りないものが示されます: `PROBE_KEY is not set`、 `PROBE_INGEST_URL or ONEUPTIME_URL is not set`、または `PROBE_ID or REGISTER_PROBE_KEY should be set`。3 つとも設定されていても ID とキーがどのプローブとも一致しない場合、プローブは 30 秒間隔で 10 回試してから、 `Unable to register probe after 10 attempts` で停止します。 **ID とキーを表示** で ID とキーをもう一度コピーしてください。
:::

:::details 誰かがキーをリセットするまでプローブは動いていた
プローブのページの **プローブキーをリセット** は新しいキーを作り、古いキーはすぐに使えなくなります。 **ID とキーを表示** で新しいキーをコピーし、 `PROBE_KEY` に設定して、プローブを再起動してください。
:::

:::details モニターがプライベートアドレスに届かないと言う
許可するまで、プローブはプライベートアドレスを拒否します。プローブに `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` を設定して再起動してください。 [プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access) を参照してください。
:::

それでも解決しない場合は、 [GitHub](https://github.com/oneuptime/oneuptime) で issue を作成するか、 [サポートに連絡](https://oneuptime.com/support) してください。

## 次のステップ

:::cards
- [モニターの作成](/docs/monitor/create-monitor): 何をチェックし、どのプローブでチェックするかを選びます。
- [受信リクエスト Ingress](/docs/probe/incoming-request-ingress): インターネットにアクセスできないサービスが、プローブ経由でハートビートを送れるようにします。
- [パケットキャプチャ](/docs/probe/packet-capture): プローブが見ているトラフィックをダッシュボードからキャプチャします。
- [プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access): プローブにプライベートアドレスをチェックさせます。
:::
