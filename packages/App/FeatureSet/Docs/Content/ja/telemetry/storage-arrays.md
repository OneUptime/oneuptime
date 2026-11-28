# ストレージアレイ エージェント

OneUptime の ストレージアレイ エージェントは、ストレージアレイを監視します。対象は容量とデータ削減、レイテンシ、IOPS と帯域幅、ボリューム、ホスト、ポッドとレプリケーション、ハードウェアのヘルス、ファイルシステムとバケット、そして NetApp ONTAP ではアグリゲート、SVM、LUN、SnapMirror 関係です。これは標準の OpenTelemetry Collector で、読み取り専用ユーザーの API トークンでアレイの OpenMetrics エンドポイントをスクレイプし (ONTAP では、その横で動く NetApp 自身の Harvest エクスポーターをスクレイプします)、すべてのメトリクスにアレイの識別情報を付与して OneUptime に送信します。届いたデータには [ストレージアレイ モニター](/docs/monitor/storage-array-monitor) でアラートを出せます。

:::cards
- [エージェントをインストールする](#エージェントをインストールする): 読み取り専用ユーザー、続いてインストールスクリプトまたは Docker Compose。
- [Dell PowerScale](#dell-powerscale): クラスターの SNMP、全ノードのポーリング、そのページに表示されるもの。
- [エージェントが収集するもの](#エージェントが収集するもの): すべてのエンドポイントと、そこから作られるページ。
- [複数のアレイを監視する](#複数のアレイを監視する): アレイごとにエージェントを 1 つ、1 台のマシンで。
- [Dell PowerMax](#dell-powermax): エージェント不要。プローブが Unisphere の配下にあるすべてのアレイを読み取ります。
- [トラブルシューティング](#トラブルシューティング): 診断スクリプトと、よくある問題。
:::

## 仕組み

Storage Arrays は、どのベンダーでも同じように動作する製品です。対応しているのは次のとおりです:

| アレイ | `storage.system` | エージェントの読み取り方法 | Collector の設定 |
| --- | --- | --- | --- |
| **Pure Storage FlashArray**、Purity//FA 6.7 以降 | `purestorage.flasharray` | アレイ自身の OpenMetrics エンドポイント (`https://<array>/metrics/...?namespace=purefa`)。Collector の横では何も動きません | `otel-collector-config.yaml` (既定) |
| **Pure Storage FlashArray**、古い Purity//FA | `purestorage.flasharray` | Pure の FlashArray OpenMetrics エクスポーター。同じ Compose ファイルが `pure-fa-exporter` サービスとして実行します | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | `purestorage.flashblade` | Pure の FlashBlade OpenMetrics エクスポーター。同じ Compose ファイルが `pure-fb-exporter` サービスとして実行します | `otel-collector-config.flashblade.yaml` |
| **Dell PowerStore** | `dell.powerstore` | Dell の PowerStore Metrics Exporter。同じ Compose ファイルが `powerstore-exporter` サービスとしてビルドして実行します。クラスターのアラートは syslog でその `powerstore-syslog` サービスに届きます | `otel-collector-config.powerstore.yaml` |
| **NetApp ONTAP** 9.12.1 以降 (AFF、FAS、ASA、ONTAP Select、Cloud Volumes ONTAP)、および **Amazon FSx for NetApp ONTAP** | `netapp.ontap` | [NetApp Harvest](https://github.com/NetApp/harvest) 26.11。同じ Compose ファイルが `netapp-harvest` サービスとして実行し、読み取り専用のユーザーとパスワードでクラスターの REST API にログインします | `otel-collector-config.netapp-ontap.yaml` |
| **Dell PowerScale** (Isilon)、OneFS 8.0 以降 | `dell.powerscale` | 各ノードを SNMP で (Dell の ISILON-MIB)、Collector 自身の SNMP レシーバーで読み取ります。Collector の横では何も動きません | `otel-collector-config.powerscale.yaml` |

ONTAP には独自のメトリクスエンドポイントがないため、エージェントは NetApp のオープンソースのエクスポーターである Harvest を Collector の横で実行します。Harvest はクラスターの REST API を読み取り、読み取った内容を Compose ネットワーク上で提供します。各シリーズの名前は `netapp_<object>_<counter>` です。Collector はそれをスクレイプして送信します。Harvest がクラスターに書き込むことはなく、NetApp への AutoSupport レポートは無効になっています。

**Dell PowerMax** (`dell.powermax`) にはエージェントが不要です。OneUptime のプローブが読み取り専用アカウントで、Unisphere for PowerMax が管理するすべてのアレイを読み取ります。[Dell PowerMax](#dell-powermax) を参照してください。

Pure Storage は 2026 年 2 月に社名を **Everpure** に変更しました。FlashArray、FlashBlade、Purity は名前を変えず、`purefa_*` と `purefb_*` のメトリクスも同じなので、このページの内容はどちらの名前で販売されたアレイにも当てはまります。

**Dell PowerScale** クラスターは別の方法で読み取ります。エージェントは各ノードを SNMP でポーリングし、読み取り専用コミュニティまたは SNMPv3 ユーザーを使い、API トークンは使いません。SNMP の有効化からページに表示されるものまでは [Dell PowerScale](#dell-powerscale) で説明します。以下のインストール手順は Pure Storage 用です。

```mermaid title="アレイから OneUptime へ"
flowchart TB
    collector["Collector"] -->|"FlashArray、<br/>Purity//FA 6.7+"| array["アレイ、<br/>ポート 443"]
    collector -->|"古い FlashArray、<br/>FlashBlade"| exporter["Pure の<br/>エクスポーター"]
    exporter -->|"API トークン"| array
    collector -->|"ONTAP"| harvest["NetApp<br/>Harvest"]
    harvest -->|"読み取り専用ユーザー、<br/>REST API"| cluster["クラスター、<br/>ポート 443"]
    collector -->|"OTLP"| oneuptime["OneUptime"]
    collector -->|"PowerStore"| dell["Dell's<br/>exporter"]
    dell -->|"user and password"| array
    array -->|"syslog, port 5514"| syslog["Syslog collector"]
    syslog -->|"OTLP"| oneuptime
```

1 つのエージェントが監視するのは 1 つのアレイです。アレイごとにエージェントを 1 つ実行してください ([複数のアレイを監視する](#複数のアレイを監視する) を参照)。アレイは最初のデータで自身を登録します。その名前は、エージェントがすべてのメトリクスに `storage.array.name` として付与するものです。

## 始める前に

- Docker Engine 20.10 以降と Docker Compose v2 プラグイン。マシンは HTTPS (TCP 443) でアレイの管理インターフェイスに到達できる必要があります。
- アレイの管理者アカウント。組み込みの **readonly** ロールを持つユーザーと、その API トークンを作成するために使います。ONTAP では、パスワード付きの読み取り専用 REST ユーザーを作成するために、クラスター管理者 (Amazon FSx for NetApp ONTAP では `fsxadmin`) が必要です。
- Dell PowerStore の場合は、x86-64 マシン (Dell はエクスポーターを x86-64 向けにのみビルドしています) と、エージェント用の PowerStore ユーザー。[Dell PowerStore](#dell-powerstore) を参照してください。
- 取り込みキー。**プロジェクト設定 → テレメトリと APM → 取り込みキー** で作成し、その値をコピーします。

### エージェントを実行する場所

エージェントは HTTPS でアレイの管理インターフェイスと通信するため、Docker があり、TCP 443 で管理ネットワークへの経路を持つ任意のマシンで実行できます。監視用ホストや小さな管理用 VM です。監視対象のアレイ上に自身のストレージを置いていないマシンを選んでください。アレイが停止しても、監視まで一緒に停止してはなりません。オプションの syslog リスナーを使う場合は、アレイが syslog ポートでエージェントに到達できる必要もあります ([アレイの syslog を送信する](#オプション-アレイの-syslog-を送信する) を参照)。

## エージェントをインストールする

:::steps
### 読み取り専用ユーザーと API トークンを作成する

エージェントが行うのは読み取りだけです。管理者ではなく、組み込みの **readonly** ロールを持つ専用のユーザーと、そのユーザーの API トークンを与えてください。トークンは **有効期限なしで** 作成します。そうしないと、トークンが期限切れになった日にエージェントが停止します。

:::tabs
@tab Purity CLI
管理者として FlashArray に SSH で接続します。1 つ目のコマンドは新しいユーザーのパスワードを尋ね、2 つ目はその API トークン (UUID) を出力します:

```bash
pureadmin create --role readonly oneuptime
pureadmin create --api-token oneuptime
```
@tab FlashArray GUI
1. _Settings → Users and Policies_ を開きます (古いリリースでは _Settings → Access_)。
2. **Users** パネルの ⋮ メニューから **Create User…** を選び、ユーザー名を `oneuptime` にして readonly ロールを与えます。
3. 新しいユーザーの ⋮ メニューから **Create API Token…** を選び、 **Expires In** を空のままにして、トークンをコピーします。
@tab FlashBlade
同じ方法で、 **readonly** ロールを持つユーザーとその API トークンを作成します。FlashBlade の GUI のユーザー設定で行うか、Purity//FB の CLI で `pureadmin` を使います。ローカルユーザーのないリリースでは、グループが readonly ロールに対応付けられたディレクトリサービス (LDAP または Active Directory) のアカウントを使います。FlashBlade の API トークンは `T-` で始まります。
@tab ONTAP CLI
管理者としてクラスター管理アドレスに SSH で接続します。1 つ目のコマンドは、すべての API を読み取ることだけができる REST ロールを作成します。2 つ目は、そのロールを持つ HTTP ユーザーを作成し、そのパスワードを尋ねます:

```bash
security login rest-role create -role oneuptime-readonly -api /api -access readonly
security login create -user-or-group-name oneuptime -application http -authentication-method password -role oneuptime-readonly
```

エージェントはこのユーザーとパスワードでログインします。API トークンは使いません。
@tab ONTAP System Manager
1. _Cluster → Settings → Users and Roles_ を開きます。
2. **Roles** で **Add** を選び、ロール名を `oneuptime-readonly` にして、**REST API path** に `/api` を入力し、**Read-Only** アクセスを選びます。
3. **Users** で **Add** を選び、ユーザー名を `oneuptime` にして新しいロールを与え、**Password** を使う **HTTP** ログイン方法を追加して、パスワードを設定します。
@tab Amazon FSx for NetApp ONTAP
`fsxadmin` として、ファイルシステムの管理エンドポイント (FSx コンソールに表示される DNS 名または IP) に SSH で接続し、FSx の定義済みの読み取り専用ロールでユーザーを作成します。コマンドはそのパスワードを尋ねます:

```bash
security login create -user-or-group-name oneuptime -application http -authentication-method password -role fsxadmin-readonly
```

ファイルシステムのハードウェアは AWS が運用するため、FSx はディスク、シェルフ、センサーについて誰にも答えません。アレイの **ハードウェア** ページはノードとポートを一覧表示し、そのことを示します。
:::

### FlashArray が自身のメトリクスを提供しているか確認する

Pure は、ネイティブの OpenMetrics エンドポイントを **Purity//FA 6.7.0 以降** 向けに文書化しています (Pure の FlashArray エクスポーターの非推奨のお知らせには 6.6.11 以降とあります)。確かめる最も手早い方法は、エージェントを実行するマシンからアレイに問い合わせることです:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

`purefa_info{...} 1` の行が出れば、アレイはメトリクスをネイティブに提供しています。既定の設定を使ってください。`404` なら提供していないので、エクスポーターの設定を使います。この設定は Collector の横で Pure のエクスポーターを実行します。Pure はこのエクスポーターを非推奨にしているので、アレイをアップグレードしたらネイティブの設定に移行してください。FlashBlade は常に Pure の FlashBlade エクスポーターを、ONTAP クラスターは NetApp Harvest を経由するため、どちらもこの手順は不要です。

### エージェントをインストールして起動する

各 OneUptime は、自分のリリースのエージェントのインストールスクリプトとファイルを配布します。以下のコマンドは `https://oneuptime.com` からダウンロードするので、セルフホストの OneUptime ではこのアドレスを自分の URL に置き換えてください。インストールスクリプトはまず `install.sh` として保存されるので、実行する前に内容を読めます。

:::tabs
@tab install.sh
インストールスクリプトをダウンロードし、エージェントを置くマシンで実行します:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

スクリプトは、これがどのアレイか (ネイティブのメトリクスを提供する FlashArray、古い Purity//FA の FlashArray、FlashBlade、または NetApp ONTAP クラスター) を尋ね、続いて OneUptime の URL、取り込みキー、アレイの名前、アレイの管理アドレス、読み取り専用ユーザーの API トークン (ONTAP では読み取り専用ユーザーの名前とパスワード。エコーなしで読み取ります) を尋ねます。`/opt/oneuptime-storage-array-agent` にインストールし、Compose ファイル、すべての Collector 設定、Harvest の 4 つのファイルをダウンロードし、対応する設定と Compose プロファイルを記した `0600` の `.env` ファイルを書き込み、Docker Compose でエージェントを起動します。各値は入力したとおりに Docker Compose 用に引用符で囲みます。再実行すると、再度尋ねる代わりに既存の `.env` の内容をすべて再利用し、編集したファイルは置き換える前に `<file>.bak.<timestamp>` として残します。
@tab Docker Compose
`docker-compose.yml` と 3 つの `otel-collector-config*.yaml` ファイルを、お使いの OneUptime から新しいフォルダーにダウンロードします:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
```

その横に `.env` ファイルを作成します。API トークンが入るので、`chmod 600 .env` で非公開にしてください。ネイティブのメトリクスを提供する FlashArray の場合:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=my-storage-array
STORAGE_SYSTEM=purestorage.flasharray
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.yaml
COMPOSE_PROFILES=
PURE_FA_ENDPOINT=fa-prod-01.example.com
PURE_FA_API_TOKEN=YOUR_READ_ONLY_API_TOKEN
PURE_FB_ENDPOINT=
PURE_FB_API_TOKEN=
POWERSCALE_ENDPOINT=
POWERSCALE_SNMP_COMMUNITY=
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
POWERSTORE_ENDPOINT=
POWERSTORE_PASSWORD=
POWERSTORE_USERNAME=
POWERSTORE_BULK_METRICS=
POWERSTORE_API_VERSION=
POWERSTORE_REQUEST_LIMIT=
POWERSTORE_SYSLOG_PORT=
```

Dell PowerStore の場合は、`otel-collector-config.powerstore.yaml`、`powerstore-exporter.Dockerfile`、`powerstore-syslog.yaml` もダウンロードし、`STORAGE_SYSTEM=dell.powerstore`、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerstore.yaml`、`COMPOSE_PROFILES=powerstore` を設定して、`POWERSTORE_ENDPOINT`、`POWERSTORE_USERNAME`、`POWERSTORE_PASSWORD` を入力します。パスワードは単一引用符で囲みます。

古い Purity//FA の FlashArray では、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` と `COMPOSE_PROFILES=flasharray-exporter` を設定します。FlashBlade では、`STORAGE_SYSTEM=purestorage.flashblade`、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml`、`COMPOSE_PROFILES=flashblade` を設定し、`PURE_FB_ENDPOINT` と `PURE_FB_API_TOKEN` を入力します (`PURE_FA_*` の組の代わりに)。

NetApp ONTAP クラスターまたは Amazon FSx for NetApp ONTAP では、ONTAP の設定と Harvest の 4 つのファイルもダウンロードします:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.netapp-ontap.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-rest.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-keyperf.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/netapp-harvest-restperf.yaml
```

続いて、次の `.env` を使います。パスワードはこの例のように一重引用符で囲んでください。そうすると Docker Compose は、中身にかかわらず書かれたとおりに読み取ります。`'` を含むパスワードは代わりに二重引用符で囲み、`\"`、`\\`、`$$` をそれぞれ `"`、`\`、`$` の代わりに書きます:

```bash title=".env"
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_TOKEN
STORAGE_ARRAY_NAME=ontap-prod-01
STORAGE_SYSTEM=netapp.ontap
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.netapp-ontap.yaml
COMPOSE_PROFILES=netapp-ontap
NETAPP_ONTAP_ENDPOINT=ontap-prod-01.example.com
NETAPP_ONTAP_USERNAME=oneuptime
NETAPP_ONTAP_PASSWORD='YOUR_READ_ONLY_USER_PASSWORD'
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

エージェントを起動します:

```bash
docker compose up -d
```
:::

### エージェントが実行中であることを確認する

```bash
docker compose ps
docker logs -f oneuptime-storage-array-agent
```

`docker compose ps` には Collector (`oneuptime-storage-array-agent`) と、エクスポーターの設定ではエクスポーター (`pure-fa-exporter`、`pure-fb-exporter`、または `netapp-harvest`) が表示されます。Collector が起動すると、ログに次の行が表示されるはずです:

```text
Everything is ready. Begin running and processing data.
```

### OneUptime でアレイを見つける

**製品 → インフラストラクチャ → ストレージアレイ → すべてのストレージアレイ** を開きます。最初のスクレイプの後 (約 1 分)、アレイが容量、パフォーマンス、未解決のアラート、ハードウェアとともに表示されます。ボリューム、ホスト、ポッドは 2 分以内に、FlashBlade のファイルシステムとバケットは 5 分以内に、FlashArray のディレクトリは 30 分以内に続きます。ONTAP クラスターは Harvest が読み取ると表示され、インベントリ全体は約 3 分以内 (Harvest が構成をポーリングする間隔) にそろいます。アレイの **トポロジー** ページは、ホスト、ボリューム、ファイルシステム、ハードウェアを 1 つのマップに描きます。[トポロジー](/docs/telemetry/topology#リソースごとのマップを開く) を参照してください。
:::

## Dell PowerStore

エージェントは Dell の PowerStore Metrics Exporter (リリース `powerstore-metrics-exporter_v1.0.3`) を通じて PowerStore クラスターを読み取ります。Dell はこれをイメージではなくバイナリとして公開しているため、`powerstore-exporter` サービスは初回起動時に Dell が文書化しているイメージを `powerstore-exporter.Dockerfile` からビルドし、バイナリの SHA-256 を検証します。このビルドには一度だけ `quay.io` と `github.com` への接続が必要です。

PowerStore には API トークンがないため、Dell のエクスポーターはユーザー名とパスワードでログインします。PowerStore Manager の _Settings → Users_ で、エージェント専用のローカルユーザーを **Storage Operator** ロールで追加してください。エクスポーターは PowerStore の 5 分間の一括メトリクスアーカイブからパフォーマンスを読み取ります。このアーカイブはエクスポーター自身が有効にし、PowerStoreOS 4.1 以降では必須ですが、Dell の README によると Operator ロールでは有効にできません。古い PowerStoreOS では、`POWERSTORE_BULK_METRICS=false` にすれば読み取り専用の **Operator** ロールで十分です。パスワードを `.env` から読むのはエクスポーターだけです。

Dell のエクスポーターはアラートを読み取らないため、クラスターが自分で送ります。`powerstore-syslog` サービスがリモート syslog をポート 5514 の TCP と UDP で受信し、各行をアレイの **ログ** ページに記録します。PowerStore のレコードは属性 (`powerstore.alert.id`、`powerstore.alert.state`、`powerstore.event.code`) に、Dell のイベントコードに基づく重大度は (`powerstore.alert.severity`) に入ります。PowerStore Manager で _Settings → Security → Remote Logging_ を開き、このマシンをポート 5514 で追加して、ファイアウォールでそのポートを開いてください。ポート 6514 での TLS 経由の syslog については `powerstore-syslog.yaml` で説明しています。

Dell のエクスポーターはホストもレプリケーションセッションも報告しないため、このバージョンにはどちらもありません。

## 環境変数

インストールスクリプトはこれらを `/opt/oneuptime-storage-array-agent/.env` に書き込みます。Docker Compose でのインストールでは、`.env` (`docker-compose.yml` の横にあるもの) から読み取ります。値を変更したら、そのフォルダーで `docker compose up -d` を実行します。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ONEUPTIME_URL` | はい | OneUptime の URL。`https://oneuptime.com` やセルフホストのインスタンスなど。インスタンスが HTTP のみの場合は、`http://` とそのポートを使います。 |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | **プロジェクト設定 → テレメトリと APM → 取り込みキー** で作成した取り込みキー。 |
| `STORAGE_ARRAY_NAME` | はい | OneUptime でアレイが登録される名前で、すべてのメトリクスに `storage.array.name` リソース属性として付与されます。変えないでください。あとで変更すると別のアレイとして登録されます。これがないと Collector は起動を拒否します。 |
| `STORAGE_SYSTEM` | いいえ | `storage.system` リソース属性として付与されるプラットフォーム。`purestorage.flasharray`、`purestorage.flashblade`、または `netapp.ontap` です。既定は `purestorage.flasharray` です。 |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | いいえ | 実行する同梱の Collector 設定。`otel-collector-config.yaml` (FlashArray、ネイティブ。既定)、`otel-collector-config.flasharray-exporter.yaml` (古い FlashArray)、`otel-collector-config.flashblade.yaml` (FlashBlade)、または `otel-collector-config.netapp-ontap.yaml` (ONTAP) です。 |
| `COMPOSE_PROFILES` | いいえ | 選んだ設定がスクレイプするエクスポーターを起動します。ネイティブの FlashArray 設定では空、それ以外の設定では `flasharray-exporter`、`flashblade`、または `netapp-ontap` です。 |
| `PURE_FA_ENDPOINT` | FlashArray | FlashArray の管理アドレス。ホスト名または IP で、`https://` は付けません。 |
| `PURE_FA_API_TOKEN` | FlashArray | readonly ロールを持つ FlashArray ユーザーの API トークン。 |
| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade の管理アドレス。ホスト名または IP で、`https://` は付けません。 |
| `PURE_FB_API_TOKEN` | FlashBlade | readonly ロールを持つ FlashBlade ユーザーの API トークン。 |
| `POWERSTORE_ENDPOINT` | PowerStore | PowerStore クラスターの管理アドレス。ホスト名または IP で、`https://` は付けません。 |
| `POWERSTORE_USERNAME` | PowerStore | Dell のエクスポーターがログインに使う PowerStore ユーザー。 |
| `POWERSTORE_PASSWORD` | PowerStore | そのユーザーのパスワード。読み取るのはエクスポーターだけです。 |
| `POWERSTORE_BULK_METRICS` | いいえ | `true` は PowerStore の一括メトリクスアーカイブからパフォーマンスを読み取り、`false` は各オブジェクトを個別に読み取ります。既定は `true` です。 |
| `POWERSTORE_API_VERSION` | いいえ | PowerStoreOS 3.6 以降では `v3`、それ以外は `v1`。既定は `v3` です。 |
| `POWERSTORE_REQUEST_LIMIT` | いいえ | エクスポーターがクラスターに同時に送るリクエストの数。既定は `16` です。 |
| `POWERSTORE_SYSLOG_PORT` | いいえ | このマシンがクラスターの syslog を TCP と UDP で受信するポート。既定は `5514` です。 |
| `NETAPP_ONTAP_ENDPOINT` | ONTAP | クラスター管理アドレス (FSx ではファイルシステムの管理エンドポイント)。ホスト名または IP で、`https://` は付けません。 |
| `NETAPP_ONTAP_USERNAME` | ONTAP | 読み取り専用の REST ユーザー (`oneuptime` など)。 |
| `NETAPP_ONTAP_PASSWORD` | ONTAP | そのパスワード。Harvest だけが、書かれたとおりに読み取ります。 |
| `POWERSCALE_NODES` | PowerScale | すべてのノードのアドレス (カンマ区切り)。SmartConnect のゾーン名は使いません。インストールスクリプトはここから下記のポーリングを書き込みます。 |
| `POWERSCALE_ENDPOINT` | PowerScale | クラスター自体のヘルス、容量、クォータを読み取るときに経由するノード。`POWERSCALE_NODES` の最初のノードです。 |
| `POWERSCALE_SNMP_RECEIVERS` | PowerScale | Collector が実行するポーリング。`snmp/cluster`、`snmp/quotas`、続いて `snmp/node-1` 以降をノードごとに一つずつ。 |
| `POWERSCALE_NODE_<n>` | PowerScale | ノード `<n>` のアドレス。`1` から `252` まで。IPv6 アドレスは `[fd00::11]` のように角かっこで囲みます。 |
| `POWERSCALE_SNMP_VERSION` | いいえ | `v2c` または `v3`。既定は `v2c` です。 |
| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | クラスターの読み取り専用コミュニティ。 |
| `POWERSCALE_SNMP_USER` | SNMPv3 | クラスターの SNMPv3 読み取り専用ユーザー。 |
| `POWERSCALE_SNMP_SECURITY_LEVEL` | いいえ | `auth_priv`、`auth_no_priv`、または `no_auth_no_priv`。既定は `auth_priv` です。 |
| `POWERSCALE_SNMP_AUTH_PROTOCOL` | いいえ | `MD5`、`SHA`、`SHA224`、`SHA256`、`SHA384`、または `SHA512` で、`isi snmp settings view` の表示どおりです。既定は `SHA` です。 |
| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | SNMPv3 ユーザーの認証パスワード。 |
| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | いいえ | `DES`、`AES`、`AES192`、`AES256`、`AES192C`、または `AES256C`。既定は `AES` です。 |
| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | SNMPv3 ユーザーのプライバシーパスワード。`auth_priv` レベルで使います。 |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | いいえ | `true` はネイティブエンドポイントと Harvest でアレイの自己署名証明書を受け入れ、`false` は検証します。既定は `true` です。Pure のエクスポーターはアレイの証明書を検証しないため、エクスポーターには関係しません。 |

## エージェントのスクレイプ方法

- **エンドポイントごとに専用のスクレイプジョブがあり、それぞれ必要な頻度で読み取ります**。FlashArray: `/metrics/array` は 60 秒ごと、`/metrics/volumes`、`/metrics/hosts`、`/metrics/pods` は 2 分ごと、`/metrics/directories` は 30 分ごとです。これは Pure 自身の推奨で、ディレクトリの使用量はアレイにとって算出の負荷が大きいためです。FlashBlade: `/metrics/array` は 60 秒ごと、`/metrics/filesystems` と `/metrics/objectstore` は 5 分ごとです。これも、ファイルシステムとオブジェクトストアのエンドポイントはアレイより低い頻度で読むようにという Pure の推奨に従っています。
- **各ジョブはそのシリーズに `scrape_endpoint: <endpoint>` のラベルを付けます**。各エンドポイントは `purefa_info` または `purefb_info` もエクスポートするため、OneUptime はバッチがどのファミリーの完全な一覧なのかを把握できます。こうして、削除されたボリューム、ホスト、ポッド、ファイルシステム、バケットは残り続けずにインベントリから消えます。ラベルは同梱のままにしてください。
- **ボリュームごととホストごとのレイテンシは 3 つのディメンションを残します**。各ボリュームとホストは、最大 16 の `dimension` に分けてレイテンシをエクスポートします。`metric_relabel_configs` ルールが `usec_per_read_op`、`usec_per_write_op`、`usec_per_mirrored_write_op` を残し、QoS のレート制限、キュー、SAN、サービス時間の内訳を落とします。この内訳は大きなアレイのシリーズ数を何倍にもするためです。`purefa_array_performance_latency_usec` のアレイ全体の内訳は残ります。ボリュームごとの内訳も残すには、このルールを削除します。
- **API トークンは Bearer トークンです**。ネイティブの設定はそれをアレイ自体に送ります。エクスポーターの設定は Compose ネットワーク上でのみエクスポーターに送り、エクスポーターのポートが公開されることはありません。
- **PowerStore は 5 分ごと**。Dell のエクスポーターはクラスターの各パーツを `/metrics/<cluster>/<part>` で提供します。設定は `cluster` (ハートビート) を 60 秒ごとに、`appliance`、`capacity`、`hardware`、`port`、`volume`、`volumeGroup`、`nas`、`file` を 5 分ごとに読み取ります。PowerStore がこれらを 5 分間のサンプルで算出するためです。
- **`send_batch_max_size` はありません**。OneUptime はリクエストごとに 1 回のスクレイプ全体からインベントリを再構築するため、同梱の `batch` プロセッサーはスクレイプを複数のエクスポートに分割しません。batch の設定は同梱のままにしてください。
- **ONTAP: Harvest がクラスターをポーリングし、Collector が Harvest をスクレイプします**。Harvest はクラスターの構成と状態を 3 分ごと、パフォーマンスを毎分 (レイテンシは 1 操作あたりのマイクロ秒、操作数とバイト数は毎秒)、EMS イベントを 3 分ごとに読み取り、すべての最新の値を `netapp-harvest:12990` で提供します。Collector はそれを 60 秒ごとに `scrape_endpoint: harvest` のラベル付きでスクレイプします。3 つの `netapp-harvest-*.yaml` ファイルは、Harvest の読み取り対象を OneUptime が読むものに限定します。Harvest 自身の `netapp_metadata_*` シリーズは、どのオブジェクトを完全に一覧表示したかを示すため、削除されたボリュームはインベントリから消え、Harvest が読み取れなかったオブジェクトは最後の数を保ちます。Collector は Harvest 自身の測定値とディスクごとのパフォーマンスのシリーズを破棄し、各 SnapMirror 関係のスケジュールを `netapp_snapmirror_schedule_seconds` (1 時間ごとのスケジュールは 3600) に変換します。SnapMirror Behind Schedule は、これと遅延を比較します。

## エージェントが収集するもの

Pure のセマンティック規約は、FlashArray のネイティブエンドポイントと両方のエクスポーターで共通です。ONTAP の規約は Harvest のもので、表の後で説明します。すべての値はアレイ自身が算出するゲージ (レイテンシは操作あたりのマイクロ秒、スループットは毎秒) なので、レートを計算する必要はありません。オブジェクトは **データポイントラベル** で名前が付きます。ボリューム、ポッド、ディレクトリ、ファイルシステム、バケットは `name`、ホストは `host`、FlashArray のハードウェアは `component_name` です。エージェントが `storage.array.name` と `storage.system` のリソース属性を追加するため、OneUptime はすべてをアレイの下に整理します:

| エンドポイント | メトリクスファミリー | OneUptime がそこから作るもの |
| --- | --- | --- |
| FlashArray `/metrics/array` | `purefa_info`、`purefa_alerts_open`、`purefa_array_space_*`、`purefa_array_performance_*`、`purefa_hw_component_status`、`purefa_hw_component_temperature_celsius`、`purefa_hw_controller_info`、`purefa_drive_capacity_bytes`、`purefa_network_interface_*` | アレイの名前、Purity のバージョン、システム ID。容量、使用量、データ削減。未解決のアラート数。アレイのヘルス。**ハードウェア** ページ (コンポーネント、ドライブ、コントローラー、ネットワークインターフェイス) |
| FlashArray `/metrics/volumes` | `purefa_volume_performance_*`、`purefa_volume_space_*`、`purefa_volume_qos_*` | **ボリューム** ページ: ボリュームごとのプロビジョニングサイズと物理サイズ、データ削減、読み取りと書き込みのレイテンシ、IOPS、帯域幅 |
| FlashArray `/metrics/hosts` | `purefa_host_connectivity_info`、`purefa_host_connections_info`、`purefa_host_performance_*`、`purefa_host_space_*` | **ホスト** ページ: ホストごとの接続性 (冗長パスの有無)、接続されたボリューム、レイテンシ、IOPS、帯域幅 |
| FlashArray `/metrics/pods` | `purefa_pod_performance_*`、`purefa_pod_space_*`、`purefa_pod_replica_links_*`、`purefa_pod_mediator_status` | **レプリケーション** ページ: ActiveCluster と ActiveDR のポッド、レプリカリンクの状態と遅延 |
| FlashArray `/metrics/directories` | `purefa_directory_performance_*`、`purefa_directory_space_*` | **ディレクトリ** ページ (FlashArray File Services) |
| FlashBlade `/metrics/array` | `purefb_info`、`purefb_alerts_open`、`purefb_array_space_*`、`purefb_array_performance_*`、`purefb_hardware_health` | FlashBlade の名前、Purity のバージョン、システム ID。容量とデータ削減。未解決のアラート数。アレイのヘルス。**ハードウェア** ページ |
| FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`、`purefb_file_systems_performance_*` | **ファイルシステム** ページ: ファイルシステムごとのプロビジョニング容量と使用容量、データ削減、レイテンシ、IOPS、帯域幅 |
| FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`、`purefb_buckets_quota_space_bytes`、`purefb_buckets_object_count`、`purefb_buckets_performance_*`、`purefb_object_store_accounts_*` | **バケット** ページ: バケットごとの容量、クォータ、オブジェクト数、パフォーマンス。アカウントごとにグループ化 |
| PowerStore `cluster`、`appliance`、`capacity` | `powerstore_cluster`、`powerstore_metro_*`、`powerstore_appliance`、`powerstore_perf_*`、`powerstore_cap_*` | クラスターの名前と状態。**アプライアンス** ページ: 各アプライアンスの容量、データ削減、レイテンシ、IOPS、帯域幅 |
| PowerStore `hardware`、`port` | `powerstore_hardware_*`、`powerstore_wear_metrics_by_drive`、`powerstore_fc_port_*`、`powerstore_eth_port_*`、`powerstore_metricFcPort_*`、`powerstore_metricEthPort_*` | **ハードウェア** ページ: ノード、ファン、電源装置、バッテリー、ドライブ、フロントエンドポート。それぞれにアプライアンスを示します |
| PowerStore `volume`、`volumeGroup`、`nas`、`file` | `powerstore_volume_*`、`powerstore_metricVolume_*`、`powerstore_volumegroup_*`、`powerstore_metricVg_*`、`powerstore_nas_server_operational_status`、`powerstore_metricNas_*`、`powerstore_filesystem_*`、`powerstore_metricFilesystem_*` | **ボリューム**、**ボリュームグループ**、**NAS サーバー**、**ファイルシステム** ページ |
| ONTAP、Harvest 経由 | `netapp_cluster_*`、`netapp_node_*`、`netapp_aggr_*`、`netapp_svm_*`、`netapp_volume_*`、`netapp_lun_*`、`netapp_snapmirror_*` | クラスターの名前、リリース、UUID。容量 (データアグリゲートの合計) とデータ削減。**ボリューム** ページ。**アグリゲート**、**SVM**、**LUN**、**SnapMirror** の各ページと、オブジェクトごとのページ |
| ONTAP のハードウェア、Harvest 経由 | `netapp_disk_*`、`netapp_shelf_*`、`netapp_environment_sensor_*`、`netapp_net_port_*`、`netapp_nic_*`、`netapp_fcp_*` | **ハードウェア** ページ: ノード、ディスク、シェルフとその電源装置、ファン、モジュール、センサー、ノードのセンサー、Ethernet ポートと Fibre Channel ポート |
| ONTAP の未解決の問題とイベント | `netapp_health_*`、`netapp_ems_events` | 未解決のアラート数と **アクティブなアラート** カード (破損したディスク、シェルフの障害、HA テイクオーバー、ダウンしたポート、システムヘルスアラート)、そして EMS のテンプレート |
| PowerScale `snmp/cluster` | `powerscale_cluster_*`、`powerscale_ifs_*` | クラスターの名前、OneFS のバージョン、ヘルス、ノード数。`/ifs` の容量。クラスター全体のスループット、ネットワーク、CPU |
| PowerScale `snmp/quotas` | `powerscale_quota_*` | **クォータ** ページ: 各クォータの使用量、その制限、制限にどれだけ近いか |
| PowerScale `snmp/node-<n>` | `powerscale_node_*`、`powerscale_protocol_*`、`powerscale_drive_*`、`powerscale_fan_*`、`powerscale_temperature_*`、`powerscale_power_sensor_*`、`powerscale_interface_*`、`powerscale_chassis_*` | **ノード** ページ: 各ノードのヘルス、CPU、スループット、プロトコルのパフォーマンス。**ハードウェア** ページ: そのドライブ、センサー、ポート |

ONTAP では、すべてのシリーズが Harvest のものです。オブジェクトはラベルで名前が付きます。`volume` (その `svm` 内で)、`aggr`、`lun`、`node`、`disk`、`shelf`、SnapMirror 関係では `destination_location` です。状態は 1 または 0 の `netapp_*_new_status`、またはラベルが状態を示す `netapp_*_labels` シリーズで表され、未解決の問題はそれぞれ、続いている間だけ存在する `netapp_health_*_alerts` シリーズです。

**すべてのストレージアレイ** の **ヘルス** 列は、アレイの最新データにあるアレイ自身のアラートとハードウェアを読み取ります。未解決の重大なアラート、または重大、故障、欠落、異常の状態にあるハードウェアコンポーネント、ドライブ、コントローラーを報告している間は **重大**、未解決の警告アラート、または劣化や不明の状態のコンポーネントを報告している間は **警告**、それ以外は **OK**、エージェントが切断されている間は **不明** です。アレイの **概要** は次のセクションのとおり、さらに多くを判断します。モニターの条件では、アレイの属性には `resource.` の接頭辞が付き (`resource.storage.array.name`、`resource.storage.system`)、データポイントラベルは接頭辞なしのままです (`name`、`host`、`dimension`、`space`)。

PowerStore のアラートはログとして届くため、PowerStore のヘルスはそのハードウェアのヘルスです。エージェントは `powerstore_cap_physical_used_percent` と `powerstore_filesystem_logical_used_percent` を自分で算出し、ノードの状態は Healthy の間 1 として読み取ります。

## アレイのページに表示される内容

アレイの **概要** は、注意が必要なものに基づいてヘルスを **正常**、**機能低下**、**異常** のいずれかで示し、それを **対応が必要** に緊急度の高い順に、確認する場所まで 1 回の操作で行ける形で一覧表示します:

- **アレイ自体。** アレイが重大度「重大」で発生させた未解決のアラートは重大、重大度「警告」のものは確認が必要です。使用可能容量の 80% を超えると確認が必要になり、90% を超えると重大です。これは Capacity Above 80% と Capacity Above 90% のアラートが発火する水準です。平均の読み取りまたは書き込みレイテンシが 5 ms を超える FlashArray や、読み取りに 10 ms 以上かかる FlashBlade は確認が必要です。
- **ハードウェア。** アレイが重大、故障、欠落、異常と報告するコンポーネント、ドライブ、コントローラー、ネットワークインターフェースは重大です。部品を交換するまで冗長性が失われています。劣化、不明、未認識、準備未完了と報告されるものは確認が必要です。未取り付け、電源オフ、未使用の部品は一覧に表示されません。
- **ホスト。** 両方のコントローラー経由でアレイに到達できなくなったホストは確認が必要で、理由も示します。1 つのコントローラーのみ経由、経路の偏り、経路なしのいずれかです。
- **Pod。** アレイがレプリカリンクを異常と報告する Pod は重大、1 分以上遅れている Pod は確認が必要です。
- **ファイルシステム。** プロビジョニング済みサイズの空きが 10% 未満の FlashBlade のファイルシステムは確認が必要です。
- **ONTAP クラスター自身のオブジェクト。** ONTAP がオフラインと報告するボリューム、アグリゲート、LUN、破損したディスク、エラー状態のシェルフ部品、重大しきい値を超えたノードのセンサー、ダウンしたポートは重大です。停止した SVM、ファンや電源装置が故障したノード、警告しきい値を超えたセンサーは確認が必要で、理由は ONTAP 自身の言葉で示します。ONTAP が異常と報告する SnapMirror 関係は重大で、スケジュール間隔の 1.5 倍を超えて遅れている関係は確認が必要です。

**ホスト**、**レプリケーション**、**ファイルシステム** の一覧は、同じルールで各部分の状態を示し、その下に理由を表示します。ONTAP クラスターの **ボリューム**、**アグリゲート**、**SVM**、**LUN**、**SnapMirror** の一覧も同様で、どの行からもその行専用のページが開きます。ページには、状態、注意が必要なもの、未解決の項目、それを監視するクラスターのアラート、ONTAP がそれについて報告している内容、グラフが表示されます。各プラットフォームのページは、そのプラットフォーム自身の言葉で示します。ONTAP のボリュームは SVM、アグリゲート、使用率を一覧に示し、そのページは ONTAP のシリーズをグラフにします。Amazon FSx for NetApp ONTAP では、**ハードウェア** ページがノードとポートを一覧表示し、ディスクやシェルフがない理由を示します。ホストとファイルシステムの個別ページは、注意が必要なものと、それを監視するアレイのアラートを示し、残りを有効にする操作も 1 回で済みます。ボリュームやバケットを含むすべての部分のページは、未解決の項目を示します。エージェントが切断されている間、ヘルスは **ヘルス: 不明** になります。アレイの最後の報告はもう正しくないためです。上の各しきい値は、[ストレージアレイモニター](/docs/monitor/storage-array-monitor)に一覧があるとおり、それぞれのアラートテンプレートが発火する水準です。

PowerStore では、**アプライアンス**、**ボリュームグループ**、**NAS サーバー** タブに PowerStore にしかないパーツが表示され、**ハードウェア** ページには各パーツのアプライアンスが表示されます。どのアプライアンスもパーツに同じ名前を付けるためです。

## オプション — アレイの syslog を送信する

PowerStore の syslog コレクターは同梱のまま動作します ([Dell PowerStore](#dell-powerstore) を参照)。このセクションは Pure のアレイ向けです。

既定ではエージェントはメトリクスだけを送信するため、アレイの **ログ** ページは空のままです。アレイはアラートと監査イベントを syslog として転送します。同梱のすべての Collector 設定には、コメントアウトされた `syslog` レシーバーのペア (ポート 5514 の TCP と UDP、RFC 3164) があり、コメントアウトされた `logs` パイプラインにつながっています。このパイプラインが `storage.array.name` を付与するので、ログはアレイに届きます。

:::steps
### レシーバーを有効にする

使用している Collector 設定で、2 つの `syslog/*` レシーバーと `logs` パイプラインのコメントを外します。RFC 3164 のタイムスタンプにはタイムゾーンがありません。アレイの時計が UTC でない限り、`location` をアレイのタイムゾーンに設定してください。

### ポートを開く

`ports:` ブロック (`docker-compose.yml` 内) のコメントを外してマシンが `5514/tcp` と `5514/udp` を公開するようにし、`docker compose up -d` を実行します。マシンのファイアウォールで、アレイの管理ネットワークに対してポートを開きます。

### アレイの送信先をエージェントにする

これは読み取り専用の監視ユーザーではなく、管理者として行います。FlashArray では _Settings → System → Syslog Servers_ を開き、`udp://<agent-host>:5514` (または `tcp://<agent-host>:5514`) を追加して、テストメッセージを送信します。FlashBlade では、syslog の設定で同じ URI の syslog サーバーを追加します。どちらのアレイも `PROTOCOL://HOST:PORT` の形式を受け付け、REST API (`syslog-servers`) でも同様です。
:::

syslog レシーバーは 1 つのトランスポートでしか待ち受けないため、TCP と UDP は 2 つのレシーバーになっています。一方だけで足りる場合は、もう一方をコメントアウトしたままにします。標準の Collector イメージは syslog をそのまま読むので、カスタムイメージは不要です。

## プロジェクトラベルでアレイにタグを付ける

`oneuptime.label.` で始まるリソース属性は、ストレージアレイのプロジェクトラベルになります。`oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。使用している Collector 設定の `resource` プロセッサーに、`storage.array.name` と並べて属性を追加します:

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: storage
        action: upsert
      - key: oneuptime.label.env
        value: production
        action: upsert
```

Collector は起動時にしか設定を読み込みません。`docker compose restart oneuptime-storage-array-agent` を実行してください。すると、アレイに `team:storage` と `env:production` のラベルが表示されます。ラベルは大文字と小文字を区別せずに照合されるため、既存の `Production` ラベルは重複せずに再利用されます。また、OneUptime で誰かが追加したラベルをエージェントが削除することはありません。

## 複数のアレイを監視する

1 つのエージェントが読み取るのは 1 つのアレイです。同じマシンから複数を監視するには、それぞれを専用の `.env` を持つ専用のフォルダーにインストールし (例: `INSTALL_DIR=/opt/oneuptime-storage-array-agent-fa02 bash install.sh`)、それぞれに専用の `container_name` を与えます (`docker-compose.yml` 内。例: `oneuptime-storage-array-agent-fa02`)。2 つのコンテナーが同じ名前を持つことはできません。フォルダーは `-d` で診断スクリプトに渡します。

2 台目の PowerStore エージェントにも専用の syslog ポートが必要です。`POWERSTORE_SYSLOG_PORT` を、たとえば `5515` に、その `.env` で設定してください。

## systemd サービスとして実行する

マシンとともにエージェントを起動し、失敗時に再起動するには、その systemd ユニットをインストールします。ユニットは、インストールスクリプトが配置する `/opt/oneuptime-storage-array-agent` にエージェントがあることを前提としています:

```bash
sudo curl -fsSL https://oneuptime.com/install/storage-array-agent/systemd/oneuptime-storage-array-agent.service -o /etc/systemd/system/oneuptime-storage-array-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

## エージェントのアップグレード

エージェントは、そのファイルが固定している Collector のバージョンを **エージェントバージョン** として報告します。それがこの OneUptime のリリースが固定しているバージョンより古い場合、アレイの **概要** ページで、その横に警告マークが表示されます。マークを選択すると、これらのコマンドが表示されます。ファイルがバージョンを報告するようになる前にインストールしたエージェントは、この方法でアップグレードするまでバージョンが表示されません。

Collector のイメージは `docker-compose.yml` で固定され、その設定はその横にあるファイルなので、プルするだけではエージェントは新しくなりません。`install.sh` を再実行してください。既存の `.env` のすべての値を再利用し (何も尋ねられません)、`docker-compose.yml`、すべての Collector 設定、Harvest のファイルを更新し (編集したファイルは `<file>.bak.<timestamp>` として残ります)、エージェントを作り直すため、Collector は新しい設定を読み込みます。`/opt/oneuptime-storage-array-agent` 以外にインストールしたエージェントには、そのフォルダーの指定が必要です: `INSTALL_DIR=<folder> bash install.sh`。

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
bash install.sh
```

代わりに Docker Compose でインストールした場合は、エージェントのフォルダーで Compose ファイルと Collector 設定を再度ダウンロードし (ONTAP では ONTAP の設定と Harvest の 4 つのファイルも。それらに加えた変更があれば、もう一度行います)、イメージをプルしてエージェントを作り直します:

```bash
curl -fsSLO https://oneuptime.com/install/storage-array-agent/docker-compose.yml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.flashblade.yaml
curl -fsSLO https://oneuptime.com/install/storage-array-agent/otel-collector-config.powerscale.yaml
docker compose pull
docker compose up -d --force-recreate
```

PowerStore エージェントは `otel-collector-config.powerstore.yaml`、`powerstore-exporter.Dockerfile`、`powerstore-syslog.yaml` も再ダウンロードします。新しいリリースでタグが変わると、`docker compose up` がエクスポーターのイメージを再ビルドします。

## エージェントのアンインストール

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

その後、不要になった場合はアレイで読み取り専用ユーザーとその API トークンを削除します。ONTAP では、`security login delete -user-or-group-name oneuptime -application http -authentication-method password` を実行してから、`security login rest-role delete -role oneuptime-readonly -api /api` を実行します。

PowerStore では `docker compose --profile powerstore down` を実行して、エクスポーターと syslog コレクターも停止させてください。

## Dell PowerMax

Dell PowerMax にはエージェントが不要です。OneUptime のプローブが 5 分ごとに読み取り専用アカウントで Unisphere for PowerMax の REST API にログインし、その Unisphere が管理するすべてのアレイを読み取ります。各アレイは Symmetrix ID (`000220200269` など) の名前で **ストレージアレイ** に表示され、名前は変更できます。パスワードは暗号化して保存され、二度と表示されず、選択したプローブにのみ送信されます。

- **Unisphere for PowerMax 10.1 以降** で、PowerMaxOS 10 または 5978 のアレイを管理していること。Unisphere 10.3 からは、読み取り専用アカウントでもポートと SRDF グループを参照できます。
- **TCP 8443 で Unisphere に到達できるプローブ**。通常は Unisphere のネットワーク内にある [カスタムプローブ](/docs/probe/custom-probe) です。OneUptime Cloud では共有プローブがストレージのパスワードを受け取ることはないため、プロジェクト独自のプローブを選んでください。
- **Monitor ロールを持つ Unisphere ユーザー**。読み取る各アレイでこのロールを持ち、パフォーマンス用に **PerfMonitor** ロールも持たせます。これ以上の権限は不要です。OneUptime がアレイを変更することはありません。

:::steps
### 読み取り専用ユーザーを作成する

Unisphere for PowerMax の **Settings → Users and Groups** で、ローカルユーザーを作成するか、ディレクトリのユーザーを選びます。各アレイで **Monitor** ロールを、パフォーマンス用に **PerfMonitor** を付与します。

### Unisphere がパフォーマンスを収集していることを確認する

**Settings → Performance → System Registrations** で、各アレイの **Diagnostic** 収集がオンになっていることを確認します。オフの場合、OneUptime はアレイのインベントリとアラートを一覧表示しますが、パフォーマンスのグラフは描画しません。ストレージグループを 5 秒ごとに見るには、同じ画面で **Real Time** にも登録します (アレイあたり最大 100 個)。

### Unisphere を接続する

**製品 → インフラストラクチャ → ストレージアレイ → 接続** に移動し、**Unisphere を接続** をクリックします。Unisphere を開くときのアドレス (`https://unisphere.example.com:8443` など)、ユーザー名、パスワードを入力し、プローブを選びます。

### 接続をテストする

**接続をテスト** を使うと、プローブがログインして、アカウントから見えるもの (各アレイ、そのストレージグループとボリューム、Unisphere がそのパフォーマンスを収集しているかどうか) を読み取ります。Unisphere は既定で自己署名の証明書を使います。テストにその証明書が表示され、**この証明書を信頼** でその SHA-256 フィンガープリントがフォームに入ります。先にフィンガープリントを Unisphere 自身のものと照合してください。たとえばプローブのマシンから `openssl s_client -connect unisphere.example.com:8443` を実行します。

### 名前を付けて接続する

接続に名前を付けるか、ホスト名のままにして、**接続** をクリックします。接続のページには、数分以内に最初の収集と、見つかったすべてのアレイが表示され、それぞれ **ストレージアレイ** 内のページにリンクされます。
:::

プローブは Unisphere の文書化された REST エンドポイントを読み取ります。アレイ、容量、ヘルス、アラート、プールには従来の `/univmax/restapi` を、ストレージグループ、ボリューム、ディレクター、ポート、SRDF グループ、パフォーマンスには一括取得用の `/univmax/rest/v1` を使います。呼び出しはすべて読み取りです。読み取った内容は次のシリーズとして送信され、Unisphere のミリ秒はマイクロ秒に、MB/秒はバイト/秒に換算されます:

| シリーズ | 内容 |
| --- | --- |
| `powermax_array_*` | アレイ: モデルとマイクロコード、使用可能容量・使用済み容量・サブスクライブ済み容量、データ削減、ヘルススコア、Unisphere がパフォーマンスを収集しているかどうか、5 分間隔のレスポンスタイム、IOPS、スループット、キャッシュ、ビジー率 |
| `powermax_alert_open` | Unisphere がアレイについて開いている Minor 以上のアラートごとのシリーズ。誰かが確認するかクリアするまで続きます |
| `powermax_storage_group_*` | 各ストレージグループ: 容量とボリューム、5 分間隔のレスポンスタイム、IOPS、スループット、リアルタイム用に登録されている場合は 5 秒間隔の値 |
| `powermax_volume_*` | ストレージグループ内の各ボリューム: 容量と、そのストレージグループがリアルタイム用に登録されている場合の値 |
| `powermax_srp_*` | 各ストレージリソースプール: 容量とレスポンスタイム |
| `powermax_director_*` | 各ディレクター: ロール、ステータス、ビジー率と、オンラインでない間の `powermax_director_offline` |
| `powermax_port_*` | 各ポート: プロトコル、速度、光レベル、ビジー率と、誰かが利用しているポートがダウンしている間の `powermax_port_offline` |
| `powermax_srdf_group_*` | 各 SRDF グループ: リモートアレイとモード、遅延とスループットと、一時停止またはオフラインの間の `powermax_srdf_group_not_healthy` |

- **5 分ごと**、または負荷の高い Unisphere への負担を減らすなら 10 分ごと (接続のフォームの **その他の項目**)。Unisphere はパフォーマンスを 5 分ごとに計算します。
- **Unisphere 自身が管理するアレイのみ。** SRDF 経由で見えるリモートアレイは接続のページに一覧表示され、それぞれのサイトの Unisphere が読み取ります。その Unisphere も接続してください。
- **アレイあたり最大 5,000 個のストレージグループと 10,000 個のボリューム**、および収集あたり 200 件の新しいアラート (残りは次回以降の収集で届きます)。一覧が途中で切れた場合は、接続のページにその旨が表示されます。
- **Unisphere 10.1 と 10.2** は、読み取り専用アカウントにポートも SRDF グループも返しません。プローブはディレクターを個別に読み取り、SRDF グループをストレージグループから取得し、その旨を表示します。

## Dell PowerScale

エージェントは Dell PowerScale (Isilon) クラスターを、Dell の ISILON-MIB から SNMP で、Collector 自身の SNMP レシーバーで読み取ります。API トークンは不要で、Collector の横では何も動きません。一つのクラスターが一つのストレージアレイで、そのノード、クォータ、ドライブ、センサー、ポートがインベントリになります。

- **各ノードはそれぞれのアドレスでポーリングされます。** ノードは自分のドライブ、センサー、ポートについてしか SNMP に応答しないため、エージェントは、エージェントから到達できるネットワーク上の各ノードのアドレスでポーリングします。SmartConnect のゾーン名は使いません。ゾーン名だと、各ポーリングがゾーンの選んだ任意のノードに渡されるためです。クラスターのノードは最大 252 台です。
- **クラスター自体のオブジェクトは、最初のノード経由で 1 回だけ読み取ります:** ヘルス、容量、スループット、CPU、ノード数を 60 秒ごとに (`snmp/cluster`)、SmartQuotas を 5 分ごとに (`snmp/quotas`)。各ノードのヘルス、CPU、プロトコルのパフォーマンス (NFS、SMB、S3、HDFS など)、ドライブ、センサー、ポートは、そのノードから 60 秒ごとに読み取ります (`snmp/node-<n>`)。
- **OneFS がテキストや別の単位で返す読み取り値** (センサーの読み取り値、0.1% 単位の CPU、ビット単位のスループット) は、送信前に Collector が数値に変換するため、どのグラフもテンプレートも単純なゲージを読み取ります。

### クラスターで SNMP を有効にする

管理者として任意のノードに SSH で接続します。OneFS は SNMP の設定をクラスター全体に適用します。クラスターがすでに別のツールのために SNMP に応答している場合は、エージェントにも同じ読み取り専用コミュニティまたは SNMPv3 ユーザーを渡し、この手順は飛ばしてください。そうでなければ、OneFS の既定の `I$ilonpublic` ではなく、独自の読み取り専用コミュニティで SNMP サービスと SNMP v2c を有効にします:

```bash
isi snmp settings modify --service yes
isi snmp settings modify --snmp-v1-v2c-access yes -c '<read-only-community>'
```

または SNMPv3 を有効にします。SNMPv3 はすべてのポーリングを認証して暗号化します。OneFS には SNMPv3 の読み取り専用ユーザーが 1 人だけいて、名前を変えるまでは `general` です。スペースを含まない 8 文字以上のパスワードを設定してください:

```bash
isi snmp settings modify --service yes
isi snmp settings modify --snmp-v3-access yes -u '<read-only-user>' --snmp-v3-password '<authentication-password>' --snmp-v3-priv-password '<privacy-password>'
```

`isi snmp settings view` は、ユーザーの認証プロトコルとプライバシープロトコルを含めて設定を表示します。エージェントのマシンからすべてのノードへの UDP 161 を許可し、`isi network interfaces list` でノードのアドレスを一覧表示します。

### PowerScale クラスターにエージェントをインストールする

PowerScale の設定でインストールスクリプトを実行します:

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerscale.yaml bash install.sh
```

スクリプトは、OneUptime の URL、取り込みキー、クラスターの名前を尋ね、続いてすべてのノードのアドレス (カンマ区切り) と SNMP のバージョン、さらに読み取り専用コミュニティ、または SNMPv3 ユーザーとその 2 つのパスワードを尋ねます。いずれもエコーなしで読み取ります。プロトコルが SHA と AES 以外のユーザーには、`POWERSCALE_SNMP_AUTH_PROTOCOL` と `POWERSCALE_SNMP_PRIVACY_PROTOCOL` を `bash install.sh` の前に付ける必要があり、プライバシーなしのユーザーには `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv` が必要です。スクリプトはノードごとに一つのポーリングを `.env` に書き込みます:

```bash title=".env"
STORAGE_SYSTEM=dell.powerscale
STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.powerscale.yaml
POWERSCALE_ENDPOINT='10.20.0.11'
POWERSCALE_SNMP_COMMUNITY='YOUR_READ_ONLY_COMMUNITY'
POWERSCALE_SNMP_VERSION='v2c'
POWERSCALE_NODES='10.20.0.11,10.20.0.12,10.20.0.13'
POWERSCALE_SNMP_RECEIVERS='[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3]'
POWERSCALE_NODE_1='10.20.0.11'
POWERSCALE_NODE_2='10.20.0.12'
POWERSCALE_NODE_3='10.20.0.13'
```

クラスターにノードが増えたら、`POWERSCALE_NODES` にそのアドレスを追加し (`.env` 内)、`install.sh` を再実行します。ノードのポーリングが書き込まれ、エージェントが作り直されます。Docker Compose の場合は、`docker-compose.yml` と `otel-collector-config.powerscale.yaml` をダウンロードし、クイックスタートの `.env` で `STORAGE_SYSTEM`、`STORAGE_ARRAY_COLLECTOR_CONFIG`、`POWERSCALE_*` の行をこれらの行に置き換えます。`troubleshoot.sh` は、マシンに `snmpget` があれば、それで各ノードにクラスターの名前を問い合わせます。

### PowerScale のページに表示されるもの

クラスターの **概要** は、ヘルスを OneFS 自身のヘルスから取り、ノードとクォータを数え、各プロトコルのレイテンシと負荷、スループット、最も負荷の高いノード、使用容量を描画します。**ノード** には各ノードがヘルス、モデル、OneFS のバージョン、CPU、スループットとともに並び、**クォータ** には各クォータが制限のうちどれだけ使っているかとともに大きい順に並びます。**ハードウェア** には各ノードのドライブ、ファン、温度センサーと電源センサー (読み取り値付き)、ポートが並びます。容量は `/ifs` の容量で、OneFS が仮想ホットスペア用に確保している容量は使用中として数えます。書き込みには使えないためです。

### エージェントがまだ読み取らないもの

- **OneFS のイベントとストレージプール。** SNMP はどちらも運びません。どちらも OneFS API から取得するもので、OneUptime のプローブが読み取る予定です ([#11249](https://github.com/OneUptime/oneuptime/issues/11249))。それまでは、イベントを SNMP トラップとして [カスタムプローブ](/docs/probe/custom-probe) に送り、クラスターのノードを [ネットワークデバイス](/docs/monitor/network-device-monitor) としてそのプローブに追加してください。トラップは UDP 162 で届き、**SNMP トラップの受信（トラップ OID）** の条件でアラートを出せます。SNMPv3 トラップの場合は、ネットワークデバイスにクラスターの SNMPv3 ユーザーを設定します ([SNMPv3 のトラップと Inform](/docs/monitor/network-device-monitor#snmpv3-のトラップと-inform))。クラスターでチャネルを作成し、そこにアラートを送ります:

```bash
isi event channels create oneuptime snmp --host <probe-address> --community '<trap-community>' --use-snmp-trap true
isi event alerts modify <alert> --channel oneuptime
```

- **データ削減率** は OneFS が API でしか報告しないため、同じプローブで対応します。

## トラブルシューティング

:::details まず診断スクリプトを実行する
エージェントには、経路全体を確認するスクリプト [`troubleshoot.sh`](https://oneuptime.com/install/storage-array-agent/troubleshoot.sh) が付属しています。コンテナーランタイム、Collector が到達するのとまったく同じ形でのアレイのエンドポイント (ネイティブエンドポイントまたは Pure のエクスポーター。DNS、TLS、FlashArray にそもそもネイティブエンドポイントがあるか、アレイが API トークンを受け付けるか。トークンはスクリプトが stdin で curl に渡します)、すべてのメトリクスに付与されたアレイ名、トークンの形式、Collector 自身のメトリクス、そして OneUptime が取り込みキーを受け付けるかどうかを確認します。最も重要なのは最後の確認です。OneUptime は不正なキーを `401` で拒否し (無効化されたキーやブラウザーキーでは `422`)、Collector はどちらも恒久的なエラーとして扱います。バッチを破棄して `Exporting failed` のエラーを 1 つログに出すだけなので、コンテナーが正常なままだと見落としやすくなります。スクリプトはエージェントのネットワーク内から `GET <url>/otlp/v1/validate` を問い合わせて `200` (有効) または `401` (無効) を直接受け取り、古いサーバーでは `POST /fluentd/v1/logs` にフォールバックします。

```bash
curl -fsSL https://oneuptime.com/install/storage-array-agent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-storage-array-agent
```

最後に、最も可能性の高い原因を示す判定を出力します。
:::

:::details OneUptime にアレイが表示されない
1. Collector のログを確認します: `docker logs oneuptime-storage-array-agent`。`server returned HTTP status 401` はアレイが API トークンを拒否したこと、`404` は FlashArray にネイティブエンドポイントがないこと、`x509` はアレイの自己署名証明書に対して TLS 検証が有効になっていること、`no such host` または `connection refused` は `PURE_FA_ENDPOINT` または `PURE_FB_ENDPOINT` の誤り、エクスポート時の `401` は取り込みキーの誤りを意味します。
2. エージェントのネットワークからアレイに問い合わせます。Collector のイメージにはシェルも curl もないため、同じネットワーク内のコンテナーから問い合わせます: `docker run --rm --network container:oneuptime-storage-array-agent curlimages/curl -sk -H 'Authorization: Bearer <api-token>' 'https://<array>/metrics/array?namespace=purefa'` で `purefa_*` の行が出力されるはずです。
3. `STORAGE_ARRAY_NAME` が設定されているか確認します。アレイは `storage.array.name` リソース属性で見つけられ、これがないと Collector は起動を拒否します。
:::

:::details アレイが切断状態と表示される
OneUptime がアレイから 15 分間何も受信しないと、アレイは切断状態になります。OneUptime は 5 分ごとに確認し、OneUptime 自身がデータを受信していなかった時間は数えません。Collector が動作しているか (`docker compose ps`)、ログにスクレイプやエクスポートのエラーがないか、マシンがアレイと OneUptime の URL にまだ到達できるかを確認してください。次のデータが届くと、アレイは再び接続状態になります。
:::

:::details FlashArray が 404 を返す
その Purity//FA にはネイティブの OpenMetrics エンドポイントがありません。`install.sh` を再実行して古い Purity の選択肢を選ぶか、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` と `COMPOSE_PROFILES=flasharray-exporter` を設定して (`.env` 内)、`docker compose up -d` を実行します。アレイを Purity//FA 6.7 以降にアップグレードしたら、ネイティブの設定に戻してプロファイルを外します。
:::

:::details アレイが API トークンを拒否する
貼り付けたのがユーザーのパスワードではなく API トークンであること、ユーザーがまだ存在して readonly ロールを持っていること、トークンの有効期限が切れていないことを確認してください。新しいトークンを作成し (FlashArray では `pureadmin create --api-token oneuptime`)、それを `.env` に入れて `docker compose up -d` を実行します。Pure のエクスポーター経由の場合、拒否されたトークンは Collector のログに、エクスポーターからの HTTP `400` として現れ、その本文は `failed to login` です。
:::

:::details x509 または TLS のエラー
アレイは既定で自己署名証明書を提示し、どの Docker イメージもそれを信頼しません。`STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` を設定するか (プライベートな管理ネットワークでは実用的な選択です)、Collector のイメージが信頼する CA の証明書をアレイにインストールします。
:::

:::details pure-fa-exporter、pure-fb-exporter、または netapp-harvest が名前解決できない
エクスポーターが動いていません。`COMPOSE_PROFILES` は `STORAGE_ARRAY_COLLECTOR_CONFIG` と一致している必要があります (`flasharray-exporter` は FlashArray のエクスポーター設定用、`flashblade` は FlashBlade の設定用、`netapp-ontap` は ONTAP の設定用)。`.env` を修正して `docker compose up -d` を実行すると、`docker compose ps` にエクスポーターが表示されます。
:::

:::details ONTAP: Harvest がログインできない、またはオブジェクトが欠けている
Harvest のログを確認します: `docker compose logs netapp-harvest`。`401` または `Unauthorized` は、クラスターがユーザーまたはそのパスワードを拒否したことを意味します。ユーザーが **http** ログイン方法と読み取り専用の REST ロールを持っていることを確認し (`security login show -user-or-group-name oneuptime`)、`.env` を修正して `docker compose up -d` を実行します。1 つのオブジェクトで `403` または `not authorized` が出る場合は、ロールがその API に届いていません。上のロールは `/api` 全体に届きます。Amazon FSx for NetApp ONTAP では、誰が尋ねても FSx はディスク、シェルフ、センサーについてそう答えます。これは想定どおりで、**ハードウェア** ページにもそう表示されます。`connection refused` または `no such host` は `NETAPP_ONTAP_ENDPOINT` の誤りを意味します。これはノードや SVM のアドレスではなく、クラスター管理アドレス (FSx では管理エンドポイント) です。診断スクリプトもこれらをすべて確認します。
:::

:::details PowerStore から何も届かない
`docker compose logs powerstore-exporter` でエクスポーターのログを確認してください。`401` はユーザー名またはパスワードの誤り、`403` が `latest_five_min_metrics` で返る場合はユーザーのロールが一括メトリクスアーカイブを有効にできないことを意味します (**Storage Operator** を付与するか、4.1 より古い PowerStoreOS では `POWERSTORE_BULK_METRICS=false` を設定します)。エクスポーターは起動してから応答するまでに 1 分かかります。**ログ** ページにアラートがない場合は、クラスターの _Remote Logging_ 設定、ポート 5514 のファイアウォール、`docker compose logs powerstore-syslog` を確認してください。
:::

:::details PowerScale のクラスターやノードから何も届かない
Collector のログに `Error scraping metrics` と `request timeout` が出る場合、名前が出ているノードはエージェントのマシンからの SNMP に応答していません。エージェントが使うバージョンの SNMP が無効になっている、コミュニティまたは SNMPv3 ユーザーがクラスターのものではない、または UDP 161 がブロックされているのいずれかです。`bash troubleshoot.sh` は `snmpget` で各ノードに問い合わせます。応答はするのに **ノード** にないノードは `POWERSCALE_NODES` に入っていません。追加して `install.sh` を再実行してください。
:::

:::details 削除したボリュームやホストがインベントリに残る
OneUptime は、エンドポイントの完全なスクレイプにオブジェクトが含まれなくなったときにそのオブジェクトを削除し、それを `scrape_endpoint` ラベルで判断します。同梱の Collector 設定を独自の設定に置き換えた場合は、そのスクレイプジョブに `scrape_endpoint` ラベルを残してください。そうしないと、オブジェクトは古くなったときにしかインベントリから消えません。
:::

:::details メトリクスが別のアレイに入る
OneUptime はストレージアレイを `storage.array.name` で登録し、エージェントはその値を `STORAGE_ARRAY_NAME` から取ります。最初のデータの後で変更すると、最初のアレイの名前が変わるのではなく、2 つ目のアレイが作成されます。
:::

:::details エージェントなしでメトリクスを送信する
エージェントは標準の Collector 設定 1 つなので、すでに運用している Collector でも同じことができます。スクレイプジョブと `resource` プロセッサーを、同梱の設定から自分の設定にコピーしてください。`storage.array.name` リソース属性が OneUptime にアレイを登録し、`service.name` / `service.instance.id` の削除がデータをサービスの下に整理されないようにします。どちらも残し、`scrape_endpoint` ラベルも残してください。
:::

:::details 接続テストで Unisphere の証明書が信頼されていないと表示される
Unisphere for PowerMax は、誰かが認証局の証明書をインストールしていない限り、自己署名の証明書を使います。テストに表示されたフィンガープリントを Unisphere 自身のものと照合してから、**この証明書を信頼** をクリックし、もう一度テストします。Unisphere の証明書が更新されると、新しい証明書を信頼するまで収集は **サーバーの証明書が変更されました** で停止し、それまで Unisphere には何も送信されません。
:::

:::details 接続テストでアカウントがアレイを読み取れないと表示される
アレイ上でロールを持たないアカウントに対して、Unisphere は `403` を返します。**Settings → Users and Groups** で、ユーザーに各アレイの **Monitor** ロールを、パフォーマンス用に **PerfMonitor** を付与してください。アカウントがロールを持たないアレイは理由とともに接続のページに一覧表示され、ほかのアレイは読み取られます。
:::

:::details PowerMax にレスポンスタイムや IOPS が表示されない
Unisphere がアレイのパフォーマンスを収集していないか、アカウントに **PerfMonitor** がありません。どちらなのかは接続のページに表示されます。**Settings → Performance → System Registrations** で **Diagnostic** 収集をオンにしてください。ボリュームの値と、ストレージグループの 5 秒ごとの値には、そのストレージグループを同じ画面で **Real Time** にも登録する必要があります。
:::

## 次のステップ

:::cards
- [ストレージアレイ モニター](/docs/monitor/storage-array-monitor): アレイのアラート、容量、レイテンシ、ハードウェア、ホストのパス、レプリケーション、ファイルシステムでアラートを出します。
- [VMware エージェント](/docs/telemetry/vmware): このアレイで VMware を動かしている場合は、そのデータストアと VM も確認できます。
- [ホスト OpenTelemetry Collector](/docs/telemetry/host-otel-collector): アレイを使うマシンを OS の視点で見ます。
:::
