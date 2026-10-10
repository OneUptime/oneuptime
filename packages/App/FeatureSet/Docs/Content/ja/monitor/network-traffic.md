# ネットワークトラフィック（NetFlow、IPFIX、sFlow）

ルーター、ファイアウォール、スイッチは、通過するトラフィックを **フローレコード** として記述できます。誰が誰と、どのプロトコルとポートで、どのインターフェースを通って、何バイト通信したかです。このエクスポートを OneUptime のプローブに向けると、**トラフィック** ページにトラフィックの行き先が表示されます。最も通信量の多いアドレス、通信、アプリケーション、インターフェースを、任意の期間で確認できます。

トラフィックページは 3 か所にあります。

- **ネットワーク** -> **トラフィック**：ネットワーク全体です。すべてのデバイスのフローと、まだデバイスになっていないのにフローを送っているすべてのアドレスを 1 ページで表示します。
- サイトの **トラフィック** ページ：そのサイトのデバイスです。
- デバイスの **トラフィック** タブ：そのデバイスとインターフェースです。デバイスのプローブで実行したパケットキャプチャはフローの下に一覧表示されるので、パケットそのものが必要なときに使えます。

## トラフィックページに表示される内容

- 期間ごとの 4 つの数値：**トラフィック**（バイト数）、**平均** と **ピーク** の速度、**フロー**（デバイスが送ったフローレコードの数）。
- **トラフィックの推移**（ビット毎秒）。グラフ上をドラッグすると区間を拡大でき、ダブルクリックするか **ズームをリセット** を使うと元に戻ります。
- **上位の送信元** と **上位の宛先**：最も多く送信・受信した 10 個のアドレスです。
- **上位のアプリケーション**：プロトコルとサービスポート別のトラフィックで、そのポートで通常動くサービスの名前で表示します（HTTPS は TCP ポート 443）。
- デバイスのページの **上位のインターフェース**：各インターフェースから入ってきた量と出ていった量を、デバイスの SNMP ウォークから取得した名前と速度とともに表示します。サイトとネットワークのページには **上位のデバイス** を表示します。
- **上位の通信**：最も通信量の多い 10 組のアドレスを、送信側から受信側への図、またはリストで表示します。

アドレス、アプリケーション、インターフェース、デバイス、図の帯など、どの行をクリックしても、ページ全体がそのトラフィックに絞り込まれます。ページ上部のチップに絞り込み内容が表示され、その × をクリックすると元に戻ります。**IP アドレスを検索** を使うと、1 つのアドレスとの送受信にページを絞り込めます。期間とフィルターはページのアドレスに保存されるため、リンクを開くとまったく同じ表示になります。

## フローが届くまでの流れ

すべてのプローブはフローコレクターを実行しています。3 つの UDP ポートで待ち受け、どのポートもすべての形式を読み取ります。

| ポート   | 主な用途                    |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

プローブはレコードをデコードし、サンプリングされた数値をサンプリングレートで掛け戻し、同じ通信のレコードを数秒ごとに合計して OneUptime に送ります。各レコードは、デバイスが送信元にしたアドレス（sFlow ではデータグラム内のエージェントアドレス）によってデバイスに対応付けられます。

1. プローブがポーリングするデバイスのうち、ホスト名がそのアドレスである（またはそのアドレスに解決される）もの、または **設定** ページの **その他のアドレス** にそのアドレスがあるもの。
2. 自分の（カスタム）プローブでは、ホスト名またはその他のアドレスにそのアドレスを持つ、プロジェクト内の任意のデバイス。
3. それ以外の場合、自分のプローブでは、どのデバイスのものかを指定するまで、フローはネットワークのトラフィックページの **フローの送信元** に保持されます。グローバルプローブはそれらを破棄します。

フローは 30 日間保持され、1 ページに表示できるのは最大 31 日分です。

## 設定方法

1. **デバイスのネットワーク上にあるプローブを使います。** フローはデバイスが送る UDP データグラムなので、デバイスから到達できる [カスタムプローブ](/docs/probe/custom-probe) が必要です。公開インターネット上のグローバルプローブでは受信できません。
2. **データグラムがプローブに届くようにします。** デバイスからプローブへの UDP 2055、4739、6343 を許可します。カスタムプローブのページのとおりホストネットワーク（`--network host`）で起動した Docker のプローブはそのまま受信できます。ホストネットワークを使わない場合は `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp` でポートを公開します。
3. **デバイスでフローのエクスポートを有効にし**、プローブの IP アドレスに送ります。主なデバイスのコマンドは下にあります。最初のフローが届くまでは、デバイスの **トラフィック** タブにも、プローブのポートを含む同じ手順が表示されます。
4. **デバイスのアドレスを確認します。** レコードはデバイスが送信元にしたアドレスで対応付けられます。ホスト名ではないループバックや管理インターフェースから送信している場合は、そのアドレスをデバイスの **その他のアドレス** に追加してください。

コレクターはデフォルトで有効です。設定はプローブの環境変数で行います。

| 変数                                | 説明                                                                | デフォルト |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | `false` にするとフローコレクターを無効にします                      | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow のポート。`0` にするとこのポートで待ち受けません           | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX のポート。`0` にするとこのポートで待ち受けません             | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow のポート。`0` にするとこのポートで待ち受けません             | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | すべてのデバイスとポートを合わせた、1 分あたりの受信データグラム数 | 6000    |

### Cisco IOS XE（Flexible NetFlow）

IPFIX を UDP 4739 にエクスポートします。トラフィックを見たいすべてのインターフェースに最後の行を追加してください。各インターフェースに入ってくるトラフィックを測ることで、どの通信も 1 回だけ数えられます。

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS（NetFlow v9）

NetFlow v9 を UDP 2055 にエクスポートします。

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS（sFlow）

sFlow を UDP 6343 にエクスポートします。sFlow は N 個に 1 個のパケットをサンプリングし（ここでは 16384）、トラフィックページがサンプルを掛け戻すため、数値は推定値です。

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX と Z

MX アプライアンスと Z シリーズのテレワーカーゲートウェイは、Meraki ダッシュボードから NetFlow v9 をエクスポートします。

1. **Network-wide** > **General** を開き、**Reporting** を探します。
2. **NetFlow traffic reporting** を **Enabled: send NetFlow traffic statistics** に設定します。
3. **NetFlow collector IP** にプローブの IP アドレスを、**NetFlow collector port** に `2055` を入力して保存します。

MX や Z が見えるのは、自身を通過するトラフィックだけです。スイッチが VLAN 内で折り返すトラフィックは届かないため、エクスポートには含まれません。

### Juniper（インライン J-Flow）

MX ルーターから IPFIX を UDP 4739 にエクスポートします。サンプリングするインターフェースを収容する FPC を指定してください。

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

NetFlow v9 を UDP 2055 にエクスポートします。FortiOS 7.2 以降では、コレクターは `config system netflow` 内の `config collectors` の下のエントリーです。

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. **Device** > **Server Profiles** > **NetFlow** で、プローブの IP アドレスとポート `2055` を指定したプロファイルを追加し、**Active Timeout** を 1 分に設定します。
2. **Network** > **Interfaces** で、トラフィックを見たい各インターフェースを開き、**Advanced** タブの **NetFlow Profile** にそのプロファイルを選択します。
3. コミットします。

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense と Linux ホスト

pfSense では **softflowd** パッケージをインストールし、**Services** > **softflowd** でインターフェースを選び、プローブの IP アドレスとポート `2055` を入力して、NetFlow バージョン 9 を選択します。Linux ホストでは、トラフィックを見たいインターフェースで softflowd を実行します。

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### その他のデバイス

NetFlow v5、NetFlow v9、IPFIX はプローブの IP アドレスの UDP 2055（または 4739）へ、sFlow v5 は UDP 6343 へ送ってください。デバイスのアクティブフロータイムアウトを 60 秒にし、NetFlow v9 と IPFIX ではテンプレートを 60 秒ごとに送ります。Sophos と Extreme Networks については [ネットワークベンダーガイド](/docs/monitor/network-vendor-guides) を参照してください。

## まだデバイスになっていないアドレス

フローは、それを送るデバイスが OneUptime に追加される前に届くことがあります。自分のプローブではそれらが保持され、ネットワークのトラフィックページの **フローの送信元** に、**まだデバイスではありません** の印付きでアドレスが表示されます。

- **デバイスとして追加** を使うと、アドレスとプローブが入力済みの状態でデバイスの追加画面が開きます。すでに届いたフローはネットワークのページに残り、新しいフローはデバイスに入ります。
- **自分のデバイスの 1 つです** を使うと、アドレスがデバイスの **その他のアドレス** に追加されます。追加済みのデバイスがループバックなど別のアドレスから送信している場合に使います。次の 1 分から、そのフローはそのデバイスのものになります。

1 つの NAT アドレスの背後にある複数のデバイスはそのアドレスを共有するため、フローはそのアドレスを持つ 1 台のデバイスのものになります。

## 数値の読み方

- **サンプリング。** サンプリングするデバイス（sFlow は常に、NetFlow や IPFIX は場合により）は N 個に 1 個のパケットを報告します。プローブが数値に N を掛けるため、ページには推定値が表示され、4 つの数値の下にその旨が示されます。大量のトラフィックでは正確で、少数のパケットでは概算です。
- **二重計上。** エクスポート元のデバイス 2 台を通過するトラフィックは、両方から報告されます。デバイスのページでは 1 回、サイトやネットワークのページでは報告したデバイスごとに 1 回数えます。
- **アプリケーション。** アプリケーションとはプロトコルとサービスポートのことで、そのポートで通常動くサービスの名前で表示します。ディープパケットインスペクションではないため、ポート 9443 の HTTPS は TCP ポート 9443 と表示されます。クライアント側の一時的なポートは除外されるので、1 台のサーバーへの 1,000 件のブラウザー接続は 1 つのアプリケーションになります。
- **ピーク** はグラフで最も通信量の多い区間の速度なので、期間が短く区間が短いほどピークは鋭くなります。**平均** は期間全体のバイト数から求めます。
- **時刻。** フローは開始した区間で数えられます。長いダウンロードは実行中の 1 分ごとに 1 つのフローとして報告されるため、デバイスのアクティブタイムアウトは 60 秒にしてください。

## 含まれないもの

- **フローに基づくアラート。** フローに基づくモニターはまだありません。混雑したリンクでアラートを出すには、SNMP を読み取る [ネットワークデバイスモニター](/docs/monitor/network-device-monitor) のインターフェース使用率アラートを使ってください。
- **ポート以上のアプリケーション名。** ディープパケットインスペクションはなく、Cisco NBAR のアプリケーション名も読み取りません。
- **Meraki Dashboard API。** Meraki のトラフィック分析は取り込みません。代わりに MX と Z のアプライアンスがプローブに NetFlow を送ります。
- トラフィックの **異常検知**。
- **フローレコードからのインターフェース名。** インターフェースの名前と速度はデバイスの SNMP ウォークから取得します。ウォークしていないデバイスではインターフェース番号が表示されます。

## トラブルシューティング

トラフィックページに設定手順が表示されたままの場合：

- **プローブは何か受信していますか？** ネットワークのトラフィックページの **フローの送信元** に、直近 1 時間にフローを送ったすべてのアドレスが表示されます。デバイスが **まだデバイスではありません** として表示されている場合、ホスト名ではないアドレスから送信しています。そのアドレスをデバイスの **その他のアドレス** に追加してください。
- **ファイアウォールと Docker。** デバイスからプローブへの UDP 2055、4739、6343 を許可し、プローブが Docker で動いている場合はポートを公開してください。
- **プローブのログ。** プローブは 1 分に 1 回、読み取れなかったものをログに記録します。サポートされていない形式のデータグラム（NetFlow v1、v6、v7、v8、またはバージョン 5 より前の sFlow）、不正なデータグラム、テンプレート待ちのデータ、`PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` を超えて破棄されたデータグラムです。
- **テンプレート。** NetFlow v9 と IPFIX は、レコードの構造をテンプレートとして送ります。プローブはテンプレートより先に届いたデータを最大 10 分間保持します。1 分以内にページが表示されるよう、デバイスがテンプレートを 60 秒ごとに送るよう設定してください。
- **グローバルプローブ。** グローバルプローブでポーリングされているデバイスは、プライベートネットワークからそのプローブにフローを送れません。デバイスのネットワーク内でカスタムプローブを動かし、デバイスの設定で選択してください。
