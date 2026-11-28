import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、FlashArray の管理アドレスに HTTPS (TCP 443) で到達できるマシン",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "FlashArray の管理者アカウント (エージェント用の読み取り専用ユーザーを作成するため)",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "トークンは **有効期限なし** で作成してください。そうしないと、期限が切れた日にエージェントが止まります。",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "管理者として FlashArray に SSH で接続します。1 つ目のコマンドは新しいユーザーのパスワードを尋ね、2 つ目はその API トークンを表示します:",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. **Settings → Users and Policies** を開きます (古いリリースでは **Settings → Access**)。",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. **Users** パネルの ⋮ メニューから **Create User…** を選び、名前を `oneuptime` にして **readonly** ロールを付与します。",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. 新しいユーザーの ⋮ メニューから **Create API Token…** を選び、**Expires In** を空のままにして、トークンをコピーします。",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "`purefa_info{...} 1` という行が出れば、アレイはメトリクスをネイティブに提供しています。そのまま進んでください。**404** の場合、その Purity//FA は古いバージョンです (Pure はネイティブエンドポイントを 6.7.0 以降として文書化しており、エクスポーターの非推奨通知では 6.6.11 以降とされています)。代わりに、このガイドの上部で **FlashArray、旧バージョンの Purity** を選んでください。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "1 行目はスクリプトを `install.sh` としてダウンロードするので、実行する前に内容を確認できます。",
  "The command carries the platform you picked above. The script asks for:":
    "コマンドには上で選んだプラットフォームが入っています。スクリプトは次の項目を尋ねます:",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- **OneUptime の URL** と **取り込みキー** (どちらもステップ 1 に表示されます。そこでキーを選ぶとここに入ります)",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **アレイ名**: OneUptime でのアレイの表示名です。アレイごとに別の名前を付け、変えないでください。新しい名前は新しいストレージアレイとして登録されます",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArray の **管理アドレス** (ホスト名または IP。`https://` は付けません) と、読み取り専用ユーザーの **API トークン** (画面に表示せずに読み込みます)",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- アレイの証明書を検証するかどうか: 信頼できる CA の証明書をアレイに入れていない限り **N** と答えます (アレイは自己署名の証明書付きで出荷されます)",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "`/opt/oneuptime-storage-array-agent` にインストールし、自分だけが読める `.env` ファイル (API トークンを含みます) を書き込み、Docker Compose でエージェントを起動します。",
  "Download the compose file and the three collector configs from this OneUptime into a new folder:":
    "この OneUptime から compose ファイルと 3 つのコレクター設定を新しいフォルダーにダウンロードします:",
  "Create a `.env` file next to them:": "その隣に `.env` ファイルを作成します:",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- `my-storage-array` をこのアレイの名前 (例: `fa-prod-01`) に置き換えます。OneUptime ではこの名前でアレイが表示されるので、変えないでください。新しい名前は新しいストレージアレイとして登録されます。",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FA_ENDPOINT` に FlashArray の管理アドレス (ホスト名または IP。`https://` は付けません) を、`PURE_FA_API_TOKEN` に読み取り専用ユーザーの API トークンを設定します。トークンを含むので `chmod 600 .env` を実行してください。",
  "Start the agent:": "エージェントを起動します:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "ログで `Everything is ready. Begin running and processing data.` を探します。その後、最初のスクレイプのあとにアレイが **ストレージアレイ** セクションに自動で表示されます。通常は 1〜2 分です。",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "インストールスクリプトはこれらを `/opt/oneuptime-storage-array-agent/.env` に書き込みます。Docker Compose でインストールした場合は `docker-compose.yml` の隣の `.env` ファイルから読み込まれます。変更したら、エージェントのフォルダーで `docker compose up -d` を実行して適用します。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | テレメトリ取り込みキー (ステップ 1 で選んだもの) |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | はい | このアレイが OneUptime に登録される名前。すべてのメトリクスにリソース属性 `storage.array.name` として付きます。変えないでください。変更すると新しいストレージアレイとして登録されます |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | いいえ | プラットフォーム。リソース属性 `storage.system` として付きます: `purestorage.flasharray` または `purestorage.flashblade` (既定値: `purestorage.flasharray`) |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | いいえ | どの同梱設定を実行するか: `otel-collector-config.yaml` (FlashArray、ネイティブ。既定値)、`otel-collector-config.flasharray-exporter.yaml` (古い FlashArray)、`otel-collector-config.flashblade.yaml` (FlashBlade) |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | いいえ | 設定に必要なエクスポーターを起動します。ネイティブの FlashArray 設定では空、それ以外では `flasharray-exporter` または `flashblade` |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArray の管理アドレス。ホスト名または IP で、`https://` は付けません |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | readonly ロールを持つ FlashArray ユーザーの API トークン |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade の管理アドレス。ホスト名または IP で、`https://` は付けません |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | readonly ロールを持つ FlashBlade ユーザーの API トークン |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | いいえ | `true` はネイティブエンドポイントでアレイの自己署名証明書を受け入れ、`false` は検証します (既定値: `true`)。Pure のエクスポーターはアレイの証明書を検証しないため、エクスポーターには適用されません |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | いいえ | エージェントのコンテナー名 (既定値: `oneuptime-storage-array-agent`)。同じマシン上の 2 台目のアレイのエージェントには専用の名前が必要です。設定しない場合、インストールスクリプトは新しいエージェントにそのフォルダーにちなんだ名前を付け、スクリプトを再実行してもその名前を維持します |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- コレクターは FlashArray 自身の OpenMetrics エンドポイントを HTTPS で読み取り、トークンを Bearer 認証情報として使います。エクスポーターは動きません。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **エンドポイントごとに 1 つのスクレイプジョブ**。それぞれ必要な頻度で読み取ります: `/metrics/array` は 60 秒ごと、`/metrics/volumes`、`/metrics/hosts`、`/metrics/pods` は 2 分ごと、`/metrics/directories` は 30 分ごとです。ディレクトリの容量はアレイにとって計算の負荷が大きいためです。",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **各ジョブは系列に `scrape_endpoint: <endpoint>` というラベルを付けます**。これにより OneUptime は、バッチがどのオブジェクトの完全な一覧なのかを把握します。削除されたオブジェクトがインベントリから消えるのはこの仕組みです。ラベルは出荷時のままにしてください。",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **ボリュームごと・ホストごとのレイテンシーは 3 つのディメンションを残します** (`usec_per_read_op`、`usec_per_write_op`、`usec_per_mirrored_write_op`)。`metric_relabel_configs` のルールが QoS、キュー、SAN、サービス時間の内訳を除外します。この内訳は大きなアレイの系列数を何倍にも増やすためです。アレイ全体の内訳は残ります。",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **`send_batch_max_size` は使いません。** OneUptime は 1 回のスクレイプ全体からインベントリを作り直すため、`batch` プロセッサーがスクレイプを分割することはありません。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "これはエージェントが実行する完全な `otel-collector-config.yaml` です。`${env:...}` の値は `.env` ファイルから入ります:",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "エージェントは、syslog レシーバーを有効にするまでメトリクスだけを送ります。アレイはアラートと監査イベントを syslog として転送します。エージェントはすべての行に `storage.array.name` を付けるので、それらはこのアレイの **ログ** ページに届きます。",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. `otel-collector-config.yaml` で、`syslog/tcp` と `syslog/udp` のレシーバー、および `logs` パイプラインのコメントを外します。従来の BSD syslog のタイムスタンプにはタイムゾーンがありません。アレイの時計が UTC で動いていない限り、`location` をアレイのタイムゾーンに設定してください。",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. `docker-compose.yml` で、`5514/tcp` と `5514/udp` を公開する `ports:` ブロックのコメントを外し、アレイの管理ネットワークに向けてマシンのファイアウォールでポートを開きます。",
  "3. Apply both:": "3. 両方を適用します:",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. FlashArray で管理者として **Settings → System → Syslog Servers** を開き、`udp://<agent-host>:5514` (または `tcp://<agent-host>:5514`) を追加して、テストメッセージを送ります。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "`oneuptime.label.` で始まるリソース属性は、アレイのプロジェクトラベルになります。`oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。使っているコレクター設定の `resource` プロセッサーに、`storage.array.name` の隣に追加します:",
  "Then restart the collector so it reads the new config:":
    "その後、新しい設定を読み込むようにコレクターを再起動します:",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "アレイには `team:storage` と `env:production` のラベルが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるので、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "どの値も FlashArray 自身が計算するゲージです。レイテンシーは 1 操作あたりのマイクロ秒、スループットは 1 秒あたりの値です。OneUptime のストレージアレイのページ、メトリクスカタログ、アラートテンプレートは次のデータに基づいています:",
  "| Endpoint | Data |": "| エンドポイント | データ |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **アレイ** (`/metrics/array`) | `purefa_info`、容量とデータ削減 (`purefa_array_space_*`)、パフォーマンス、未解決のアラート (`purefa_alerts_open`)、ハードウェアコンポーネント、ドライブ、コントローラー、ネットワークインターフェイス |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **ボリューム** (`/metrics/volumes`) | ボリュームごとのレイテンシー、IOPS、帯域幅、容量、データ削減 |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **ホスト** (`/metrics/hosts`) | ホストごとの接続性、接続済みボリューム、レイテンシー、IOPS、容量 |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pod** (`/metrics/pods`) | ActiveCluster と ActiveDR のレプリカリンクの遅延、メディエーターの状態、パフォーマンス、容量 |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **ディレクトリ** (`/metrics/directories`) | FlashArray のファイルサービスの管理対象ディレクトリの容量とパフォーマンス |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "1 つのエージェントが読み取るアレイは 1 つです。同じマシンから複数のアレイを監視するには、それぞれを専用の `.env` と専用のコンテナー名を持つ専用のフォルダーにインストールします。2 つのコンテナーが同じ名前を使うことはできません:",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "`STORAGE_ARRAY_AGENT_CONTAINER_NAME` を指定しない場合、スクリプトはフォルダーにちなんでコンテナーに名前を付けます。その名前はそのエージェントの `.env` に保存されるため、エージェントをアップグレードするためにスクリプトを再実行しても維持されます。また、`docker-compose.yml` で `container_name` を以前編集したエージェントも、その名前を維持します。Docker Compose の場合は、代わりに各エージェントの `.env` で `STORAGE_ARRAY_AGENT_CONTAINER_NAME` を設定します。",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "エージェントには、インストールスクリプトのフォルダー `/opt/oneuptime-storage-array-agent` を前提とする systemd ユニットが付属しています。インストールスクリプトはこれをダウンロードしないので、取得します:",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**アップグレード**: コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。インストールスクリプトをもう一度実行します。既存の `.env` の値をすべて再利用し (何も改めて尋ねません)、最新の `docker-compose.yml` とコレクター設定をダウンロードし (編集したファイルは新しいファイルの隣に `<file>.bak.<timestamp>` として残ります)、それらでエージェントを作り直します:",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "`/opt/oneuptime-storage-array-agent` 以外にインストールしたエージェント (2 台目のアレイ用など) では、そのフォルダーを指定します: `INSTALL_DIR=<folder> bash install.sh`。",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the three collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "代わりに Docker Compose でインストールした場合: エージェントのフォルダーで compose ファイルと 3 つのコレクター設定をもう一度ダウンロードします。`.env` はそのまま残りますが、これらのファイルに加えた変更はやり直す必要があります:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "その後、イメージをプルしてエージェントを作り直し、コレクターが新しい設定を読み込むようにします:",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定は、固定しているコレクターのバージョンをアレイの **エージェントバージョン** として報告します。この OneUptime がより新しいバージョンを固定すると、その横の警告マークからこれらのコマンドを開けます。",
  "**Uninstall** the agent:": "エージェントを **アンインストール** します:",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "その後、不要になったら、アレイ上の読み取り専用ユーザーとその API トークンを削除します。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` は、チェーン全体 (コンテナーランタイム、コレクターが到達するとおりのアレイのエンドポイント、つまりネイティブエンドポイントまたは Pure のエクスポーターと DNS、TLS、API トークン、アレイ名の付与、コレクター自身のメトリクス) を確認し、取り込みキーを受け付けるかどうかを OneUptime に直接尋ねます。最後の確認が最も重要です。OneUptime の OTLP エンドポイントは不正なキーを `401` または `422` で拒否しますが、コレクターはそれをバッチごとに 1 行の見落としやすい `Exporting failed` として記録するだけなので、スクリプトは `GET /otlp/v1/validate` に 200/401 の直接の判定を求めます。",
  "It ends with a verdict naming the most likely cause.":
    "最後に、最も可能性の高い原因を示す判定を出します。",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. コレクターのログを確認します: `docker logs oneuptime-storage-array-agent`。`server returned HTTP status 401` はアレイが API トークンを拒否したこと、`404` は FlashArray にネイティブエンドポイントがないこと、`x509` はアレイの自己署名証明書に対して TLS 検証が有効になっていること、`no such host` または `connection refused` は `PURE_FA_ENDPOINT` の誤り、エクスポート時の `401` は取り込みキーの誤りを意味します。",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. `STORAGE_ARRAY_NAME` が設定されていることを確認します。検出はリソース属性 `storage.array.name` に基づき、これがないとコレクターは起動しません。",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. `STORAGE_ARRAY_COLLECTOR_CONFIG` と `COMPOSE_PROFILES` が同じプラットフォームを指していることを確認します。",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "この FlashArray の Purity//FA にはネイティブの OpenMetrics エンドポイントがありません。`.env` で `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` と `COMPOSE_PROFILES=flasharray-exporter` を設定して `docker compose up -d` を実行するか、古い Purity 向けの選択肢で `install.sh` を再実行します。アレイを Purity//FA 6.7 以降にアップグレードしたら、ネイティブの設定に戻してプロファイルを外します。",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "貼り付けたのがユーザーのパスワードではなくトークンであること、ユーザーがまだ存在して readonly ロールを持っていること、トークンの期限が切れていないことを確認します。新しいトークンを作成し (FlashArray では `pureadmin create --api-token oneuptime`)、`.env` に `PURE_FA_API_TOKEN` として設定して `docker compose up -d` を実行します。",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "アレイは既定で自己署名証明書を提示し、どの Docker イメージもそれを信頼しません。`STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` を設定する (プライベートな管理ネットワークでは現実的な選択です) か、コレクターのイメージが信頼する CA の証明書をアレイにインストールします。",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` または `pure-fb-exporter` が動いていません。`COMPOSE_PROFILES` は `STORAGE_ARRAY_COLLECTOR_CONFIG` と一致している必要があります。FlashArray のエクスポーター設定には `flasharray-exporter`、FlashBlade の設定には `flashblade` です。`.env` を修正して `docker compose up -d` を実行すると、`docker compose ps` にエクスポーターが表示されます。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. エージェントが動いていることを確認します: `docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. エージェントのログでエラーを確認します: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. エージェントのマシンからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "アレイの識別は `STORAGE_ARRAY_NAME` から来ており、すべてのメトリクスに `storage.array.name` として付きます。`.env` で修正し、エージェントのフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいストレージアレイとして登録されることに注意してください。",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "アレイは **`array-1`** として登録されます。これは、このアレイが OneUptime ですでに使っている名前です。",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- これは **`array-1`** 用のエージェントをインストールします。`STORAGE_ARRAY_NAME` は正確にそのままにしてください。変えると、データは新しいストレージアレイとして登録されます。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "アレイの識別は `STORAGE_ARRAY_NAME` から来ており、すべてのメトリクスに `storage.array.name` として付きます。このアレイは **`array-1`** です。`.env` で修正し、エージェントのフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいストレージアレイとして登録されることに注意してください。",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "コマンドには OneUptime の URL、取り込みキー、上で選んだプラットフォームがすでに入っています。スクリプトは次の項目を尋ねます:",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "そのマシンから `quay.io` (Docker が Pure のエクスポーターのイメージをプルする場所) にアクセスできること",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` は、Pure のエクスポーターである `pure-fa-exporter` をコレクターの隣で起動します。この 2 つは一致している必要があります。",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "エージェントのフォルダーで `docker compose ps` を実行すると、**`pure-fa-exporter`** も表示されます。これは Pure のエクスポーターで、コレクターはこれを通じて FlashArray を読み取ります。",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- コレクターは Pure のエクスポーターである `pure-fa-exporter` を通じて FlashArray を読み取ります。エクスポーターは、コレクターがスクレイプのたびに送るトークンで FlashArray の REST API にログインします。エクスポーターのポートは compose ネットワーク内にとどまります。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、FlashBlade の管理アドレスに HTTPS (TCP 443) で到達できるマシン",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "FlashBlade の管理者アカウント (エージェント用の読み取り専用ユーザーを作成するため)",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "FlashBlade で管理者として、**readonly** ロールを持つ `oneuptime` という名前のユーザーを作成し (FlashBlade GUI のユーザー設定、または Purity//FB CLI の `pureadmin` で)、そのユーザーの **API トークン** を作成します。トークンは **有効期限なし** で作成してください。そうしないと、期限が切れた日にエージェントが止まります。",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlade の API トークンは `T-` で始まります。ローカルユーザーのない Purity//FB リリースでは、代わりに、グループが readonly ロールに対応付けられたディレクトリサービス (LDAP または Active Directory) のアカウントを使います。",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlade の **管理アドレス** (ホスト名または IP。`https://` は付けません) と、読み取り専用ユーザーの **API トークン** (画面に表示せずに読み込みます)",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- `PURE_FB_ENDPOINT` に FlashBlade の管理アドレス (ホスト名または IP。`https://` は付けません) を、`PURE_FB_API_TOKEN` に読み取り専用ユーザーの API トークンを設定します。トークンを含むので `chmod 600 .env` を実行してください。",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "エージェントのフォルダーで `docker compose ps` を実行すると、**`pure-fb-exporter`** も表示されます。これは Pure のエクスポーターで、コレクターはこれを通じて FlashBlade を読み取ります。",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- コレクターは Pure のエクスポーターである `pure-fb-exporter` を通じて FlashBlade を読み取ります。エクスポーターは、コレクターがスクレイプのたびに送るトークンで FlashBlade の REST API にログインします。エクスポーターのポートは compose ネットワーク内にとどまります。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **エンドポイントごとに 1 つのスクレイプジョブ**。それぞれ必要な頻度で読み取ります: `/metrics/array` は 60 秒ごと、`/metrics/filesystems` と `/metrics/objectstore` は 5 分ごとです。FlashBlade の REST API は、すべてのファイルシステムとバケットをすばやく報告するようには作られていないためです。",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. FlashBlade で管理者として、syslog 設定に syslog サーバー `udp://<agent-host>:5514` (または `tcp://`) を追加します。",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "どの値も FlashBlade 自身が計算するゲージです。レイテンシーは 1 操作あたりのマイクロ秒、スループットは 1 秒あたりの値です。OneUptime のストレージアレイのページ、メトリクスカタログ、アラートテンプレートは次のデータに基づいています:",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **アレイ** (`/metrics/array`) | `purefb_info`、容量とデータ削減 (`purefb_array_space_*`)、プロトコルごとのパフォーマンス、未解決のアラート (`purefb_alerts_open`)、ハードウェアの正常性 (`purefb_hardware_health`) |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **ファイルシステム** (`/metrics/filesystems`) | ファイルシステムごとの容量、データ削減、パフォーマンス |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **オブジェクトストア** (`/metrics/objectstore`) | バケットごとの容量、クォータ、オブジェクト数、パフォーマンス |",
};

export default TRANSLATION;
