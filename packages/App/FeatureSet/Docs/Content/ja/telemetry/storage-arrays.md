# ストレージアレイ エージェント

OneUptime の Storage Array エージェントは、ストレージアレイを監視します。対象は容量とデータ削減、レイテンシ、IOPS と帯域幅、ボリューム、ホスト、ポッドとレプリケーション、ハードウェアの健全性、ファイルシステムとバケットです。これは標準の OpenTelemetry Collector で、読み取り専用ユーザーの API トークンでアレイの OpenMetrics エンドポイントをスクレイプし、すべてのメトリクスにアレイの識別情報を付与して OneUptime に送信します。届いたデータには [ストレージアレイ モニター](/docs/monitor/storage-array-monitor) でアラートを出せます。

:::cards
- [エージェントをインストールする](#エージェントをインストールする): 読み取り専用ユーザー、続いてインストールスクリプトまたは Docker Compose。
- [エージェントが収集するもの](#エージェントが収集するもの): すべてのエンドポイントと、そこから作られるページ。
- [複数のアレイを監視する](#複数のアレイを監視する): アレイごとにエージェントを 1 つ、1 台のマシンで。
- [トラブルシューティング](#トラブルシューティング): 診断スクリプトと、よくある問題。
:::

## 仕組み

Storage Arrays は、どのベンダーでも同じように動作する製品です。対応しているのは次のとおりです:

| アレイ | エージェントの読み取り方法 | Collector の設定 |
| --- | --- | --- |
| **Pure Storage FlashArray**、Purity//FA 6.7 以降 | アレイ自身の OpenMetrics エンドポイント (`https://<array>/metrics/...?namespace=purefa`)。Collector の横では何も動きません | `otel-collector-config.yaml` (既定) |
| **Pure Storage FlashArray**、古い Purity//FA | Pure の FlashArray OpenMetrics エクスポーター。同じ Compose ファイルが `pure-fa-exporter` サービスとして実行します | `otel-collector-config.flasharray-exporter.yaml` |
| **Pure Storage FlashBlade** | Pure の FlashBlade OpenMetrics エクスポーター。同じ Compose ファイルが `pure-fb-exporter` サービスとして実行します | `otel-collector-config.flashblade.yaml` |

Pure Storage は 2026 年 2 月に社名を **Everpure** に変更しました。FlashArray、FlashBlade、Purity は名前を変えず、`purefa_*` と `purefb_*` のメトリクスも同じなので、このページの内容はどちらの名前で販売されたアレイにも当てはまります。

```mermaid title="アレイから OneUptime へ"
flowchart TB
    collector["Collector"] -->|"FlashArray、<br/>Purity//FA 6.7+"| array["アレイ、<br/>ポート 443"]
    collector -->|"古い FlashArray、<br/>FlashBlade"| exporter["Pure のエクスポーター"]
    exporter -->|"API トークン"| array
    collector -->|"OTLP"| oneuptime["OneUptime"]
```

1 つのエージェントが監視するのは 1 つのアレイです。アレイごとにエージェントを 1 つ実行してください ([複数のアレイを監視する](#複数のアレイを監視する) を参照)。アレイは最初のデータで自身を登録します。その名前は、エージェントがすべてのメトリクスに `storage.array.name` として付与するものです。

## 始める前に

- Docker Engine 20.10 以降と Docker Compose v2 プラグイン。マシンは HTTPS (TCP 443) でアレイの管理インターフェイスに到達できる必要があります。
- アレイの管理者アカウント。組み込みの **readonly** ロールを持つユーザーと、その API トークンを作成するために使います。
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
:::

### FlashArray が自身のメトリクスを提供しているか確認する

Pure は、ネイティブの OpenMetrics エンドポイントを **Purity//FA 6.7.0 以降** 向けに文書化しています (Pure の FlashArray エクスポーターの非推奨のお知らせには 6.6.11 以降とあります)。確かめる最も手早い方法は、エージェントを実行するマシンからアレイに問い合わせることです:

```bash
curl -k 'https://<array>/metrics/array?namespace=purefa' --header 'Authorization: Bearer <api-token>' | grep purefa_info
```

`purefa_info{...} 1` の行が出れば、アレイはメトリクスをネイティブに提供しています。既定の設定を使ってください。`404` なら提供していないので、エクスポーターの設定を使います。この設定は Collector の横で Pure のエクスポーターを実行します。Pure はこのエクスポーターを非推奨にしているので、アレイをアップグレードしたらネイティブの設定に移行してください。FlashBlade は常に Pure の FlashBlade エクスポーターを経由するため、この手順は不要です。

### エージェントをインストールして起動する

:::tabs
@tab install.sh
インストールスクリプトをダウンロードし、エージェントを置くマシンで実行します:

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

スクリプトは、これがどのアレイか (ネイティブのメトリクスを提供する FlashArray、古い Purity//FA の FlashArray、または FlashBlade) を尋ね、続いて OneUptime の URL、取り込みキー、アレイの名前、アレイの管理アドレス、読み取り専用ユーザーの API トークン (エコーなしで読み取ります) を尋ねます。`/opt/oneuptime-storage-array-agent` にインストールし、Compose ファイルと 3 つの Collector 設定をすべてダウンロードし、対応する設定と Compose プロファイルを記した `0600` の `.env` ファイルを書き込み、Docker Compose でエージェントを起動します。各値は入力したとおりに Docker Compose 用に引用符で囲みます。再実行すると、再度尋ねる代わりに既存の `.env` の内容をすべて再利用し、編集したファイルは置き換える前に `<file>.bak.<timestamp>` として残します。
@tab Docker Compose
`docker-compose.yml` と 3 つの `otel-collector-config*.yaml` ファイルを、[StorageArrayAgent ディレクトリ](https://github.com/OneUptime/oneuptime/tree/master/agents/StorageArrayAgent) から新しいフォルダーにダウンロードします:

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flashblade.yaml
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
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true
```

古い Purity//FA の FlashArray では、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` と `COMPOSE_PROFILES=flasharray-exporter` を設定します。FlashBlade では、`STORAGE_SYSTEM=purestorage.flashblade`、`STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flashblade.yaml`、`COMPOSE_PROFILES=flashblade` を設定し、`PURE_FB_ENDPOINT` と `PURE_FB_API_TOKEN` を入力します (`PURE_FA_*` の組の代わりに)。エージェントを起動します:

```bash
docker compose up -d
```
:::

### エージェントが実行中であることを確認する

```bash
docker compose ps
docker logs -f oneuptime-storage-array-agent
```

`docker compose ps` には Collector (`oneuptime-storage-array-agent`) と、エクスポーターの設定ではエクスポーター (`pure-fa-exporter` または `pure-fb-exporter`) が表示されます。Collector が起動すると、ログに次の行が表示されるはずです:

```text
Everything is ready. Begin running and processing data.
```

### OneUptime でアレイを見つける

**製品 → インフラストラクチャ → Storage Arrays → All Storage Arrays** を開きます。最初のスクレイプの後 (約 1 分)、アレイが容量、パフォーマンス、未解決のアラート、ハードウェアとともに表示されます。ボリューム、ホスト、ポッドは 2 分以内に、FlashBlade のファイルシステムとバケットは 5 分以内に、FlashArray のディレクトリは 30 分以内に続きます。
:::

## 環境変数

インストールスクリプトはこれらを `/opt/oneuptime-storage-array-agent/.env` に書き込みます。Docker Compose でのインストールでは、`.env` (`docker-compose.yml` の横にあるもの) から読み取ります。値を変更したら、そのフォルダーで `docker compose up -d` を実行します。

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `ONEUPTIME_URL` | はい | OneUptime の URL。`https://oneuptime.com` やセルフホストのインスタンスなど。インスタンスが HTTP のみの場合は、`http://` とそのポートを使います。 |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | **プロジェクト設定 → テレメトリと APM → 取り込みキー** で作成した取り込みキー。 |
| `STORAGE_ARRAY_NAME` | はい | OneUptime でアレイが登録される名前で、すべてのメトリクスに `storage.array.name` リソース属性として付与されます。変えないでください。あとで変更すると別のアレイとして登録されます。これがないと Collector は起動を拒否します。 |
| `STORAGE_SYSTEM` | いいえ | `storage.system` リソース属性として付与されるプラットフォーム。`purestorage.flasharray` または `purestorage.flashblade` です。既定は `purestorage.flasharray` です。 |
| `STORAGE_ARRAY_COLLECTOR_CONFIG` | いいえ | 実行する同梱の Collector 設定。`otel-collector-config.yaml` (FlashArray、ネイティブ。既定)、`otel-collector-config.flasharray-exporter.yaml` (古い FlashArray)、または `otel-collector-config.flashblade.yaml` (FlashBlade) です。 |
| `COMPOSE_PROFILES` | いいえ | 選んだ設定がスクレイプするエクスポーターを起動します。ネイティブの FlashArray 設定では空、それ以外の設定では `flasharray-exporter` または `flashblade` です。 |
| `PURE_FA_ENDPOINT` | FlashArray | FlashArray の管理アドレス。ホスト名または IP で、`https://` は付けません。 |
| `PURE_FA_API_TOKEN` | FlashArray | readonly ロールを持つ FlashArray ユーザーの API トークン。 |
| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade の管理アドレス。ホスト名または IP で、`https://` は付けません。 |
| `PURE_FB_API_TOKEN` | FlashBlade | readonly ロールを持つ FlashBlade ユーザーの API トークン。 |
| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | いいえ | `true` はネイティブエンドポイントでアレイの自己署名証明書を受け入れ、`false` は検証します。既定は `true` です。Pure のエクスポーターはアレイの証明書を検証しないため、エクスポーターには関係しません。 |

## エージェントのスクレイプ方法

- **エンドポイントごとに専用のスクレイプジョブがあり、それぞれ必要な頻度で読み取ります**。FlashArray: `/metrics/array` は 60 秒ごと、`/metrics/volumes`、`/metrics/hosts`、`/metrics/pods` は 2 分ごと、`/metrics/directories` は 30 分ごとです。これは Pure 自身の推奨で、ディレクトリの使用量はアレイにとって算出の負荷が大きいためです。FlashBlade: `/metrics/array` は 60 秒ごと、`/metrics/filesystems` と `/metrics/objectstore` は 5 分ごとです。これも、ファイルシステムとオブジェクトストアのエンドポイントはアレイより低い頻度で読むようにという Pure の推奨に従っています。
- **各ジョブはそのシリーズに `scrape_endpoint: <endpoint>` のラベルを付けます**。各エンドポイントは `purefa_info` または `purefb_info` もエクスポートするため、OneUptime はバッチがどのファミリーの完全な一覧なのかを把握できます。こうして、削除されたボリューム、ホスト、ポッド、ファイルシステム、バケットは残り続けずにインベントリから消えます。ラベルは同梱のままにしてください。
- **ボリュームごととホストごとのレイテンシは 3 つのディメンションを残します**。各ボリュームとホストは、最大 16 の `dimension` に分けてレイテンシをエクスポートします。`metric_relabel_configs` ルールが `usec_per_read_op`、`usec_per_write_op`、`usec_per_mirrored_write_op` を残し、QoS のレート制限、キュー、SAN、サービス時間の内訳を落とします。この内訳は大きなアレイのシリーズ数を何倍にもするためです。`purefa_array_performance_latency_usec` のアレイ全体の内訳は残ります。ボリュームごとの内訳も残すには、このルールを削除します。
- **API トークンは Bearer トークンです**。ネイティブの設定はそれをアレイ自体に送ります。エクスポーターの設定は Compose ネットワーク上でのみエクスポーターに送り、エクスポーターのポートが公開されることはありません。
- **`send_batch_max_size` はありません**。OneUptime はリクエストごとに 1 回のスクレイプ全体からインベントリを再構築するため、同梱の `batch` プロセッサーはスクレイプを複数のエクスポートに分割しません。batch の設定は同梱のままにしてください。

## エージェントが収集するもの

Pure のセマンティック規約は、FlashArray のネイティブエンドポイントと両方のエクスポーターで共通です。すべての値はアレイ自身が算出するゲージ (レイテンシは操作あたりのマイクロ秒、スループットは毎秒) なので、レートを計算する必要はありません。オブジェクトは **データポイントラベル** で名前が付きます。ボリューム、ポッド、ディレクトリ、ファイルシステム、バケットは `name`、ホストは `host`、FlashArray のハードウェアは `component_name` です。エージェントが `storage.array.name` と `storage.system` のリソース属性を追加するため、OneUptime はすべてをアレイの下に整理します:

| エンドポイント | メトリクスファミリー | OneUptime がそこから作るもの |
| --- | --- | --- |
| FlashArray `/metrics/array` | `purefa_info`、`purefa_alerts_open`、`purefa_array_space_*`、`purefa_array_performance_*`、`purefa_hw_component_status`、`purefa_hw_component_temperature_celsius`、`purefa_hw_controller_info`、`purefa_drive_capacity_bytes`、`purefa_network_interface_*` | アレイの名前、Purity のバージョン、システム ID。容量、使用量、データ削減。未解決のアラート数。アレイの健全性。**Hardware** ページ (コンポーネント、ドライブ、コントローラー、ネットワークインターフェイス) |
| FlashArray `/metrics/volumes` | `purefa_volume_performance_*`、`purefa_volume_space_*`、`purefa_volume_qos_*` | **ボリューム** ページ: ボリュームごとのプロビジョニングサイズと物理サイズ、データ削減、読み取りと書き込みのレイテンシ、IOPS、帯域幅 |
| FlashArray `/metrics/hosts` | `purefa_host_connectivity_info`、`purefa_host_connections_info`、`purefa_host_performance_*`、`purefa_host_space_*` | **ホスト** ページ: ホストごとの接続性 (冗長パスの有無)、接続されたボリューム、レイテンシ、IOPS、帯域幅 |
| FlashArray `/metrics/pods` | `purefa_pod_performance_*`、`purefa_pod_space_*`、`purefa_pod_replica_links_*`、`purefa_pod_mediator_status` | **レプリケーション** ページ: ActiveCluster と ActiveDR のポッド、レプリカリンクの状態と遅延 |
| FlashArray `/metrics/directories` | `purefa_directory_performance_*`、`purefa_directory_space_*` | **Directories** ページ (FlashArray File Services) |
| FlashBlade `/metrics/array` | `purefb_info`、`purefb_alerts_open`、`purefb_array_space_*`、`purefb_array_performance_*`、`purefb_hardware_health` | FlashBlade の名前、Purity のバージョン、システム ID。容量とデータ削減。未解決のアラート数。アレイの健全性。**Hardware** ページ |
| FlashBlade `/metrics/filesystems` | `purefb_file_systems_space_*`、`purefb_file_systems_performance_*` | **File Systems** ページ: ファイルシステムごとのプロビジョニング容量と使用容量、データ削減、レイテンシ、IOPS、帯域幅 |
| FlashBlade `/metrics/objectstore` | `purefb_buckets_space_*`、`purefb_buckets_quota_space_bytes`、`purefb_buckets_object_count`、`purefb_buckets_performance_*`、`purefb_object_store_accounts_*` | **Buckets** ページ: バケットごとの容量、クォータ、オブジェクト数、パフォーマンス。アカウントごとにグループ化 |

アレイの **概要** での健全性は、未解決の重大なアラート、または重大、故障、欠落、異常の状態にあるハードウェアコンポーネント、ドライブ、コントローラーを報告している間は **重大**、未解決の警告アラート、または劣化や不明の状態のコンポーネントを報告している間は **警告**、それ以外は **OK** です。モニターの条件では、アレイの属性には `resource.` の接頭辞が付き (`resource.storage.array.name`、`resource.storage.system`)、データポイントラベルは接頭辞なしのままです (`name`、`host`、`dimension`、`space`)。

## オプション — アレイの syslog を送信する

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

## systemd サービスとして実行する

マシンとともにエージェントを起動し、失敗時に再起動するには、その systemd ユニットをインストールします。ユニットは、インストールスクリプトが配置する `/opt/oneuptime-storage-array-agent` にエージェントがあることを前提としています:

```bash
sudo curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/systemd/oneuptime-storage-array-agent.service -o /etc/systemd/system/oneuptime-storage-array-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-storage-array-agent
```

## エージェントのアップグレード

エージェントは、そのファイルが固定している Collector のバージョンを **エージェントバージョン** として報告します。それがこの OneUptime のリリースが固定しているバージョンより古い場合、アレイの **概要** ページで、その横に警告マークが表示されます。マークを選択すると、これらのコマンドが表示されます。ファイルがバージョンを報告するようになる前にインストールしたエージェントは、この方法でアップグレードするまでバージョンが表示されません。

Collector のイメージは `docker-compose.yml` で固定され、その設定はその横にあるファイルなので、プルするだけではエージェントは新しくなりません。`install.sh` を再実行してください。既存の `.env` のすべての値を再利用し (何も尋ねられません)、`docker-compose.yml` と 3 つの Collector 設定を更新し (編集したファイルは `<file>.bak.<timestamp>` として残ります)、エージェントを作り直すため、Collector は新しい設定を読み込みます。`/opt/oneuptime-storage-array-agent` 以外にインストールしたエージェントには、そのフォルダーの指定が必要です: `INSTALL_DIR=<folder> bash install.sh`。

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/install.sh -o install.sh
bash install.sh
```

代わりに Docker Compose でインストールした場合は、エージェントのフォルダーで Compose ファイルと 3 つの Collector 設定を再度ダウンロードし (それらに加えた変更があれば、もう一度行います)、イメージをプルしてエージェントを作り直します:

```bash
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flasharray-exporter.yaml
curl -fsSLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/otel-collector-config.flashblade.yaml
docker compose pull
docker compose up -d --force-recreate
```

## エージェントのアンインストール

```bash
cd /opt/oneuptime-storage-array-agent
docker compose down
```

その後、不要になった場合はアレイで読み取り専用ユーザーとその API トークンを削除します。

## トラブルシューティング

:::details まず診断スクリプトを実行する
エージェントには、経路全体を確認するスクリプト [`troubleshoot.sh`](https://github.com/OneUptime/oneuptime/blob/master/agents/StorageArrayAgent/troubleshoot.sh) が付属しています。コンテナーランタイム、Collector が到達するのとまったく同じ形でのアレイのエンドポイント (ネイティブエンドポイントまたは Pure のエクスポーター。DNS、TLS、FlashArray にそもそもネイティブエンドポイントがあるか、アレイが API トークンを受け付けるか。トークンはスクリプトが stdin で curl に渡します)、すべてのメトリクスに付与されたアレイ名、トークンの形式、Collector 自身のメトリクス、そして OneUptime が取り込みキーを受け付けるかどうかを確認します。最も重要なのは最後の確認です。OneUptime は不正なキーを `401` で拒否し (無効化されたキーやブラウザーキーでは `422`)、Collector はどちらも恒久的なエラーとして扱います。バッチを破棄して `Exporting failed` のエラーを 1 つログに出すだけなので、コンテナーが正常なままだと見落としやすくなります。スクリプトはエージェントのネットワーク内から `GET <url>/otlp/v1/validate` を問い合わせて `200` (有効) または `401` (無効) を直接受け取り、古いサーバーでは `POST /fluentd/v1/logs` にフォールバックします。

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent/troubleshoot.sh -o troubleshoot.sh
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

:::details pure-fa-exporter または pure-fb-exporter が名前解決できない
エクスポーターが動いていません。`COMPOSE_PROFILES` は `STORAGE_ARRAY_COLLECTOR_CONFIG` と一致している必要があります (`flasharray-exporter` は FlashArray のエクスポーター設定用、`flashblade` は FlashBlade の設定用)。`.env` を修正して `docker compose up -d` を実行すると、`docker compose ps` にエクスポーターが表示されます。
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

## 次のステップ

:::cards
- [ストレージアレイ モニター](/docs/monitor/storage-array-monitor): アレイのアラート、容量、レイテンシ、ハードウェア、ホストのパス、レプリケーション、ファイルシステムでアラートを出します。
- [VMware エージェント](/docs/telemetry/vmware): このアレイで VMware を動かしている場合は、そのデータストアと VM も確認できます。
- [ホスト OpenTelemetry Collector](/docs/telemetry/host-otel-collector): アレイを使うマシンを OS の視点で見ます。
:::
