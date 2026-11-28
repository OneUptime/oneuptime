import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、Ceph の mgr デーモンにポート 9283 で到達できるマシン",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "`ceph` CLI が管理者権限で動く Ceph 管理ノード上のシェル",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "次に mgr デーモンを一覧表示します。エージェントには、アクティブとスタンバイを含む **すべて** の mgr が必要です:",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "メトリクスを返すのは **アクティブ** な mgr だけです (スタンバイは空の応答を返します)。そのため、すべての mgr をスクレイプしておけば、アクティブな mgr がフェイルオーバーしてもメトリクスは途切れません。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "スクリプトは、OneUptime の URL と取り込みキー (どちらもステップ 1 に表示されます。そこでキーを選ぶとここに入ります) を尋ね、続けて次の項目を尋ねます:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **クラスター名**: OneUptime でのクラスターの表示名です。クラスターごとに別の名前を付け、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr エンドポイント**: 前のステップのすべての mgr を、カンマ区切りの `host:port` で指定します (例: `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`)。角かっこはスクリプトが付けます。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI エージェント**: 修正を適用してよいかどうかです。読み取り専用のままにするには **N** と答えます。`ceph` が管理者権限で動く場所では、スクリプトは AI エージェント専用の Ceph クライアントの作成も提案します。",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-ceph-agent` にインストールし、`0600` の `.env` ファイルを書き込み、Docker Compose でエージェントを起動します。スクリプトをもう一度実行すると、改めて尋ねずにその `.env` の内容をすべて再利用するので、アップグレードもこの方法で行います。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "ログで `Everything is ready. Begin running and processing data.` を探します。その後、クラスターは **Ceph** セクションに自動で表示されます。通常は 1 分ほどです。",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose は OneUptime AI エージェントである **`oneuptime-ceph-ai-agent`** も実行します。インストールスクリプトが Ceph クライアントを作成した場合は、すでに動いています。そうでない場合はクライアントを待ちます。「詳細」の **OneUptime AI エージェント** を参照してください。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI エージェント (既定でオン、読み取り専用)。** AI 調査はオンです。Ceph クライアントを得ると、OneUptime AI がこのクラスターのインシデントやアラートを読み取り専用の `ceph` コマンドで調査できるようにし、修正を許可しない限り何も変更しません。",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "インストールスクリプトはこれらを `/opt/oneuptime-ceph-agent/.env` に書き込みます。変更したら、`/opt/oneuptime-ceph-agent` で `docker compose up -d` を実行して適用します。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | テレメトリ取り込みキー (ステップ 1 で選んだもの) |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | はい | OneUptime に表示されるクラスターの識別子。すべてのメトリクスにリソース属性 `ceph.cluster.name` として付きます。変えないでください。変更すると新しいクラスターとして登録されます (既定値: `ceph`) |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | はい | **すべて** の mgr デーモンのカンマ区切りの `host:port` リストを角かっこで囲んだもの (例: `[ceph-mon-1:9283,ceph-mon-2:9283]`)。角かっこはインストールスクリプトが付けます |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI エージェント自身の設定は **OneUptime AI エージェント** にあります。",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **すべての mgr をスクレイプします** (アクティブとスタンバイ)。そのため、アクティブな mgr がフェイルオーバーしてもメトリクスは残ります。",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **30 秒ごと。** mgr の prometheus モジュールは、スクレイプ結果を `mgr/prometheus/scrape_interval` (既定では 15 秒) の間キャッシュします。それより頻繁にスクレイプしないでください。キャッシュを読み直すだけです。",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** は Ceph がエクスポートするラベル (`ceph_daemon`、`pool_id`) をそのまま保つので、mgr がフェイルオーバーしても系列は途切れません。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "これはエージェントが実行する完全な `otel-collector-config.yaml` です。`${env:...}` の値は `.env` ファイルから入ります:",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "エージェントは `/var/log/ceph/ceph.log` を追跡して OneUptime に送れます。これで **クラスターログ** ページが埋まります。エージェントはクラスターログがあるホスト (既定では mon ホスト) で動く必要があるため、既定ではオフです。",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. `otel-collector-config.yaml` で、`filelog` レシーバーと `logs` パイプラインのコメントを外します。",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. `docker-compose.yml` で、`/var/log/ceph:/var/log/ceph:ro` ボリュームのコメントを外します。",
  "3. Apply both:": "3. 両方を適用します:",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "行はそのまま送られます。OneUptime は読み込むときに ceph.log の形式 (タイムスタンプ、デーモン、INF/WRN/ERR のレベル、メッセージ) を解析し、`resource` プロセッサーが `ceph.cluster.name` を付けるので、ログはこのクラスターに届きます。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "`oneuptime.label.` で始まるリソース属性は、クラスターのプロジェクトラベルになります。`oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。`otel-collector-config.yaml` の `resource` プロセッサーに、`ceph.cluster.name` の隣に追加します:",
  "Then restart the collector so it reads the new config:":
    "その後、新しい設定を読み込むようにコレクターを再起動します:",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "クラスターには `team:storage` と `env:production` のラベルが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるので、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "エージェントは mgr の prometheus モジュールがエクスポートするものをすべて送ります。OneUptime の Ceph ページ、メトリクスカタログ、アラートテンプレートは次のものを基にしています:",
  "| Category | Data |": "| カテゴリー | データ |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **クラスターのヘルス** | `ceph_health_status` (0 = OK、1 = WARN、2 = ERR)、モニターのクォーラム、生容量の合計と使用量 |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | 各 OSD の up / in 状態 (`ceph_daemon` ラベルごと。例: `osd.3`) |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **プール** | プールごとの保存バイト数、最大利用可能量、オブジェクト数、読み取り/書き込み操作数、スループット |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **配置グループ** | アクティブ、デグレード、サイズ不足の PG の数 |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` は **`oneuptime-ceph-ai-agent`** も実行します。OneUptime AI がこのクラスターのインシデントやアラートを調査する間、これを通じて `ceph` コマンド (`ceph health detail`、`ceph osd tree`、`ceph pg dump_stuck`、`ceph crash ls`) を実行します。`CEPH_CLUSTER_NAME` という名前のクラスターとして登録され、クラスターの **AI → AI エージェント** ページに表示されます。",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "クラスターの最小限の `ceph.conf` と、そのクライアントのキーリングを `docker-compose.yml` の隣の `ceph/` フォルダーに置き、専用の Ceph クライアント `client.oneuptime-ai` として接続します。インストールスクリプトは、実行するマシンで `ceph` が管理者権限で動く場合、新規インストール時にこれらの作成を提案します。それ以外の場合や後から追加する場合は、Ceph 管理ノードで次を実行します:",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "エージェントが別のマシンで動く場合は、同じように 2 つのファイルをその `ceph/` フォルダーにコピーします。**管理者のキーリングは決してそこに置かないでください。**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **クライアントの caps が厳格な上限です。** この読み取り用の caps では、実行するどのコマンドもクラスターを変更できません。修正 (OSD を in に戻す、`noout` を解除する) には、`.env` の `ONEUPTIME_AI_ALLOW_WRITES=true` と、エージェントの README にある修正用の caps も必要です。",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 確認します: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI を使わない場合は、`docker-compose.yml` から `oneuptime-ceph-ai-agent` サービスを削除します。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "実行できるコマンドと修正のしくみ: [インフラストラクチャ AI エージェント](/docs/ai/infrastructure-ai-agents#ceph-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**アップグレード**: コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。インストールスクリプトをもう一度実行します。既存の `.env` の値をすべて再利用し (何も改めて尋ねません)、最新の `docker-compose.yml` と `otel-collector-config.yaml` をダウンロードし (編集したファイルは新しいファイルの隣に `<file>.bak.<timestamp>` として残ります)、イメージをプルして、それらでエージェントを作り直します。AI エージェントの `ceph/` フォルダーはそのまま残ります:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定は、固定しているコレクターのバージョンをクラスターの **エージェントバージョン** として報告します。この OneUptime がより新しいバージョンを固定すると、その横の警告マークからこれらのコマンドを開けます。",
  "**Uninstall** the agent:": "エージェントを **アンインストール** します:",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "AI エージェントの Ceph クライアントを作成した場合は、管理ノードで削除します: `ceph auth del client.oneuptime-ai`。",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` は、チェーン全体 (コンテナーランタイム、アクティブとスタンバイの落とし穴を含む各 mgr エンドポイント、クラスター名の付与、トークンの形式、コレクター自身のメトリクス) を確認し、取り込みキーを受け付けるかどうかを OneUptime に直接尋ねます。最後の確認が最も重要です。OneUptime の OTLP エンドポイントは不正なキーを `401` または `422` で拒否しますが、コレクターはそれをバッチごとに 1 行の見落としやすい `Exporting failed` として記録するだけなので、スクリプトは `GET /otlp/v1/validate` に 200/401 の直接の判定を求めます。",
  "It ends with a verdict naming the most likely cause.":
    "最後に、最も可能性の高い原因を示す判定を出します。",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. コレクターのログを確認します: `docker logs oneuptime-ceph-agent`。エクスポートのエラーを探します (`401` は取り込みキーの誤り、接続拒否は `ONEUPTIME_URL` の誤りです)。",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. mgr エンドポイントがメトリクスを返すことを確認します: `curl http://<active-mgr>:9283/metrics | head`。`ceph_*` のメトリクス行が表示されるはずです。表示されない場合は、モジュールを有効にします: `ceph mgr module enable prometheus`。",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. `CEPH_MGR_ENDPOINTS` が角かっこで囲まれていることを確認します。角かっこがないと、コレクターはカンマ区切りの文字列全体を 1 つの (無効な) ターゲットとして扱います。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. エージェントが動いていることを確認します: `docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. エージェントのログでエラーを確認します: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. エージェントのマシンからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "おそらく (以前の) アクティブな mgr だけをスクレイプしています。`CEPH_MGR_ENDPOINTS` に **すべて** の mgr デーモンを列挙してください。スタンバイの mgr のスクレイプは軽く、空の応答を返します。",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "クラスターで `mgr/prometheus/standby_behaviour` が `error` に設定されている場合は想定どおりです。このときスタンバイは HTTP 500 で応答します。アクティブな mgr のスクレイプは成功しているので、これらのエラーはノイズです。止めるには動作を `default` に戻します。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "クラスターの識別は `CEPH_CLUSTER_NAME` から来ており、すべてのメトリクスに `ceph.cluster.name` として付きます。`.env` で修正し、`/opt/oneuptime-ceph-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **クラスター名**: **`ceph-1`** と正確に入力します。別の名前は新しいクラスターとして登録されます。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "クラスターの識別は `CEPH_CLUSTER_NAME` から来ており、すべてのメトリクスに `ceph.cluster.name` として付きます。このクラスターは **`ceph-1`** です。`.env` で修正し、`/opt/oneuptime-ceph-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "コマンドには OneUptime の URL と取り込みキーがすでに入っています。残りはスクリプトが尋ねます:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "この OneUptime から `docker-compose.yml` と `otel-collector-config.yaml` を新しいフォルダーにダウンロードします:",
  "Create a `.env` file next to them:": "その隣に `.env` ファイルを作成します:",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-ceph-cluster` をこのクラスターの名前 (例: `ceph-prod`) に置き換えます。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- `CEPH_MGR_ENDPOINTS` に **すべて** の mgr デーモンを、カンマ区切りで角かっこに囲んで列挙します。角かっこがないと、コレクターはリスト全体を 1 つの無効なターゲットとして読みます。",
  "Start the agent:": "エージェントを起動します:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose は OneUptime AI エージェントである **`oneuptime-ceph-ai-agent`** も起動します。専用の Ceph クライアントを待ちます。「詳細」の **OneUptime AI エージェント** を参照するか、OneUptime AI を使わない場合は `docker-compose.yml` からそのサービスを削除してください。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "エージェントは `docker-compose.yml` の隣の `.env` ファイルからこれらを読み込みます。変更したら、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | はい | **すべて** の mgr デーモンのカンマ区切りの `host:port` リストを角かっこで囲んだもの (例: `[ceph-mon-1:9283,ceph-mon-2:9283]`) |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "クラスターの最小限の `ceph.conf` と、そのクライアントのキーリングを `docker-compose.yml` の隣の `ceph/` フォルダーに置き、専用の Ceph クライアント `client.oneuptime-ai` として接続します。Ceph 管理ノードの、エージェントのフォルダーで次を実行します:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "これらは、エージェントのフォルダー (`docker-compose.yml` があるフォルダー) で実行します。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**アップグレード**: コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。両方のファイルをもう一度ダウンロードします。`.env` はそのまま残りますが、どちらかのファイルに加えた変更はやり直す必要があります:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "その後、イメージをプルしてエージェントを作り直し、コレクターが新しい設定を読み込むようにします:",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "クラスターの識別は `CEPH_CLUSTER_NAME` から来ており、すべてのメトリクスに `ceph.cluster.name` として付きます。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- これは **`ceph-1`** 用のエージェントをインストールします。`CEPH_CLUSTER_NAME` は正確にそのままにしてください。変えると、データは新しいクラスターとして登録されます。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "クラスターの識別は `CEPH_CLUSTER_NAME` から来ており、すべてのメトリクスに `ceph.cluster.name` として付きます。このクラスターは **`ceph-1`** です。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-ceph-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です。設定しない場合、インストールスクリプトは新しいエージェントのコンテナーにそのフォルダーにちなんだ名前を付け、スクリプトを再実行してもその名前を維持します |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-ceph-ai-agent`)。設定しない場合、インストールスクリプトは 2 つ目のクラスターの AI エージェントにそのコレクターにちなんだ名前を付け (`oneuptime-ceph-ai-agent-cluster2` を `oneuptime-ceph-agent-cluster2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "1 つのエージェントは 1 つのクラスターを読み取ります。2 つ目のクラスターには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントをインストールします。2 つのコンテナーが同じ名前を使うことはできません:",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "変数 (`CEPH_AGENT_CONTAINER_NAME` など) を設定しない場合、スクリプトはフォルダーにちなんでコンテナーに `oneuptime-ceph-agent-cluster2` のような名前を付けます。その名前はそのエージェントの `.env` に保存されるため、同じ `INSTALL_DIR` でスクリプトを再実行してエージェントをアップグレードしても維持されます。また、`docker-compose.yml` で `container_name` を以前編集したエージェントも、その名前を維持します。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、別の場所ですでにエージェントを実行しているフォルダーと同じ名前のフォルダーはスクリプトが拒否します。フォルダーは `-d` で診断スクリプトに渡します。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-ceph-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-ceph-ai-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "1 つのエージェントは 1 つのクラスターを読み取ります。2 つ目のクラスターには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントを用意します。2 つのコンテナーが同じ名前を使うことはできません。名前はそのエージェントの `.env` で設定します:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、同じ名前の 2 つ目のフォルダーは最初のエージェントのコンテナーを置き換えてしまいます。名前は `docker-compose.yml` に書かないでください。このファイルはアップグレードで置き換えられます。",
};

export default TRANSLATION;
