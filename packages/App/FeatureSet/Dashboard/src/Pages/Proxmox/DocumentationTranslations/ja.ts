import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、すべてのノードの Proxmox VE API にポート 8006 で到達できるマシン",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "読み取り専用の API トークンを作成するための、任意の PVE ノードの root シェル、または Proxmox の Web UI",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "できればクラスター外のマシン、または Proxmox HA が別のノードで再起動する VM。エージェントは、ノードがダウンしたときは別のノードからクラスターを読み取りますが、自身のマシンがダウンしたときはそうできません",
  "As root on any PVE node:": "任意の PVE ノードで root として:",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- 1 行目が失敗するのは `monitoring@pam` がすでに存在する場合だけで、害はありません。API トークンは独自のシークレットを持つため、ユーザーにパスワードやシステムアカウントは不要です。",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` はトークンのシークレットを表示します。表示は 1 回だけなので、今すぐコピーしてください。トークン ID は `monitoring@pam!oneuptime` です。",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- 権限を分離したトークンは、そのユーザーも持つ権限しか得られないため、ロールはトークンだけでなくユーザーにも付けます。ロールはルートパス `/` に付ける必要があります。pve-exporter はクラスター全体の状態を読み取るため、サブパスに限定したトークンは `Permission check failed (/, Sys.Audit)` で失敗します。",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. *Datacenter → Permissions → API Tokens* に移動し、**Add** をクリックします。",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. ユーザーを選び (または作成し)、トークンに `oneuptime` のような ID を付け、**Privilege Separation** がオンになっていることを確認して、**Add** をクリックします。",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. トークン ID (`user@realm!tokenname`) とシークレットをコピーします。シークレットは 1 回しか表示されません。",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. *Datacenter → Permissions* で **Add** を 2 回クリックし、パス `/` に **PVEAuditor** ロールを付けます。1 回はトークンの **API Token Permission** として、もう 1 回はそのユーザーの **User Permission** としてです。",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "権限を分離したトークンは、そのユーザーも持つ権限しか得られないため、両方にロールが必要です。ロールはルートパス `/` に付ける必要があります。pve-exporter はクラスター全体の状態を読み取るため、サブパスに限定したトークンは `Permission check failed (/, Sys.Audit)` で失敗します。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "スクリプトは、OneUptime の URL と取り込みキー (どちらもステップ 1 に表示されます。そこでキーを選ぶとここに入ります) を尋ね、続けて次の項目を尋ねます:",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **クラスター名**: OneUptime でのクラスターの表示名です。クラスターごとに別の名前を付け、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE API ホスト**: 任意のノード (例: `192.168.1.10`)。その API が応答しない間、エージェントは下のリストの次のノードからクラスターを読み取ります。",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **付属の prometheus-pve-exporter**: すでに実行しているものがなければ **Y** と答えます。",
  "- **API token** — the token id and secret from the previous step.":
    "- **API トークン**: 前のステップのトークン ID とシークレットです。",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **各ノードのアドレス**: 各ノード自身のアドレスをカンマ区切りで指定します。仮想 IP は使いません。トークンがあれば、スクリプトはクラスター自身のリストを提示するので、Enter キーを押すとそれを使えます。最初のノードがダウンしているときも、エージェントはこれらのノードからクラスターを読み取ります。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI エージェント**: 修正を適用してよいかどうかです。読み取り専用のままにするには **N** と答えます。",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-proxmox-agent` にインストールされ、`0600` の `.env` ファイルを書き込み、Docker Compose ですべてを起動します。スクリプトをもう一度実行すると、改めて尋ねずにその `.env` の内容をすべて再利用するため、アップグレードもこの方法で行います。",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` には、コレクター (`oneuptime-proxmox-agent`)、ノードのフェイルオーバー (`oneuptime-pve-api-failover`)、付属のエクスポーター (`oneuptime-pve-exporter`。独自のものを使う場合はなし)、OneUptime AI エージェント (`oneuptime-proxmox-ai-agent`) が表示されます。コレクターのログで `Everything is ready. Begin running and processing data.` を探してください。その後、クラスターは **Proxmox** セクションに自動で表示されます。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI エージェント (既定でオン、読み取り専用)。** AI 調査はオンです。OneUptime AI がこのクラスターのインシデントやアラートを読み取り専用の `pvesh` リクエストで調査できるようにし、修正を許可しない限り何も変更しません。詳細の **OneUptime AI エージェント** を参照してください。",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "Proxmox VE 8.3 以降が必要です。ステップ 1 で取り込みキーを選ぶと 2 つのコマンドが表示されます。コマンドにはキーが含まれ、Proxmox VE はそれを追加される Webhook ターゲットに保存します。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "その後、各ゲストのページに最後のバックアップが表示され、クラスターの **推奨事項** で **Backup Job Failed** と **Node Fenced** のアラートが提案されます。",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "インストールスクリプトはこれらを `/opt/oneuptime-proxmox-agent/.env` に書き込みます。変更したら、`/opt/oneuptime-proxmox-agent` で `docker compose up -d` を実行して適用します。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | テレメトリ取り込みキー (ステップ 1 で選んだもの) |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | はい | OneUptime に表示されるクラスターの識別子。すべてのメトリクスにリソース属性 `proxmox.cluster.name` として付きます。変えないでください。変更すると新しいクラスターとして登録されます (既定値: `proxmox-cluster`) |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | はい | エクスポーターがその Proxmox VE API からクラスターを読み取り、AI エージェントが問い合わせるノード (例: `192.168.1.10`)。その API が応答しない間は、どちらも `PVE_NODES` の中で次に応答するノードを使います |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | クラスターの場合 | 各ノード自身の API アドレスをカンマ区切りで角かっこに入れたもの (例: `[192.168.1.10,192.168.1.11,192.168.1.12]`)。既定は `PVE_HOST` だけで、単一ノードならそれで足ります。エクスポーターは起動時の自動起動 (Guest Down)、レプリケーション、サブスクリプションを問い合わせたノードについてしか読み取らないため、各ノードに順番に問い合わせます。リストにないノードは見えません。`PVE_HOST` がダウンしたときも、エージェントはこの中の次のノードからクラスターを読み取ります。 |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | いいえ | prometheus-pve-exporter のアドレス (`host:port`、スキームなし)。既定は付属のエクスポーター (`pve-exporter:9221`) |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | 付属のエクスポーターと AI エージェント | Proxmox API トークンの完全な ID (例: `monitoring@pam!oneuptime`。PVEAuditor、読み取り専用) |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | 付属のエクスポーターと AI エージェント | Proxmox API トークンのシークレット |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | いいえ | Proxmox API の TLS 証明書を検証する (既定: `false`。PVE は自己署名証明書で出荷されます) |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | いいえ | `pve-exporter` に設定すると、付属のエクスポーターのコンテナーを起動します |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI エージェント自身の設定は **OneUptime AI エージェント** にあります。",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "インストールスクリプトが **Run the bundled prometheus-pve-exporter?** と尋ねたら、**n** と答えて、エクスポーターのアドレス (`host:port`、スキームなし) を入力します。",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "エージェントのコンテナーから到達できるアドレス、つまりホストの LAN IP か DNS 名を使ってください。コンテナー内の `localhost` はコンテナー自身です。OneUptime AI エージェントを使う場合は、`PVE_API_TOKEN_ID` と `PVE_API_TOKEN_SECRET` を `.env` に残してください。AI エージェントはそのトークンで API を読み取ります。",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "エージェントは 30 秒ごとにエクスポーターをスクレイプします。クラスターのコレクターは `PVE_HOST` (`PVE_HOST` がダウンしている間はクラスターを読み取っているノード) で 1 回、ノードのコレクターは `PVE_NODES` の各ノードについて 1 回です。すべての系列には、リソースを識別する `id` ラベル (`node/<name>`、`qemu/<vmid>`、`lxc/<vmid>`、`storage/<node>/<storage>`) が付きます:",
  "| Category | Metrics |": "| カテゴリ | メトリクス |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **可用性** | `pve_up`、`pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **ノード** | `pve_node_info`、`pve_cpu_usage_ratio`、`pve_cpu_usage_limit`、`pve_memory_usage_bytes`、`pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **ゲスト (VM / LXC)** | `pve_guest_info` と、`qemu/*` および `lxc/*` の ID に付く CPU、メモリー、ネットワークの系列 |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **ストレージ** | `pve_disk_usage_bytes`、`pve_disk_size_bytes`、`pve_storage_info` |",
  "| **HA** | `pve_ha_state` |": "| **HA** (高可用性) | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **バックアップのカバー率** | `pve_not_backed_up_total`、`pve_not_backed_up_info`: どのバックアップジョブにも選ばれていないゲスト (バックアップが実行されたか、成功したかは分かりません) |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **起動時の自動起動** | ゲストごとの `pve_onboot_status`。**Guest Down** が読み取ります |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **レプリケーション** | ストレージのレプリケーションジョブごとの `pve_replication_*` 系列。その `id` ラベルはジョブ ID (例: `100-0`) で、リソースではありません |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "起動時の自動起動とレプリケーションはエクスポーターのノードのコレクターから得られ、これらはエクスポーターが問い合わせたノードしか読み取りません。`PVE_NODES` にないノードには、どちらもありません。",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "コレクターは `id` ラベルを、等価でフィルターできる 3 つのデータポイント属性にも分割します (`transform/pve-identity` プロセッサー)。モニターの条件とダッシュボードのフィルターはこれらで照合します:",
  "| Attribute | Values | Example for `qemu/100` |":
    "| 属性 | 値 | `qemu/100` の例 |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`、`guest`、`storage`、`cluster` (`qemu` と `lxc` はどちらも `guest` になります) | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | `id` の最初の `/` より後のすべて (`pve1`、`100`、`pve1/local`) | `100` |",
  "The original `id` label is kept untouched.":
    "元の `id` ラベルはそのまま残ります。",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "エージェントは 1 つのノードの API を通じてクラスター全体を読み取ります。応答している間は `PVE_HOST` の API です。`oneuptime-pve-api-failover` コンテナーが 15 秒ごとにそのノードを確認し、その API が応答しなくなると、コレクターは `PVE_HOST` が再び応答するまで、`PVE_NODES` の中で次に応答するノードからクラスターを読み取ります。`.env` に API トークンがあれば、応答はしてもクラスターのクォーラムを持つ側から切り離されたノードも飛ばします。そのノードから見ると、ほかのすべてのノードがダウンしていることになるからです。OneUptime AI エージェントも呼び出しのたびに同じことをします。そのため、ノードが故障すると、そのノードについて **Node Offline** が発火し、クラスターの残りは報告を続けます。",
  "Its logs say which node the cluster is read from, and why.":
    "そのログには、クラスターをどのノードから読み取っているかと、その理由が記録されます。",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "カバーできないのは、エージェント自身が動くマシンです。それがダウンするとクラスター全体が沈黙し、**Cluster Stopped Reporting** が発火します。エージェントはクラスターの外で、または Proxmox HA が別のノードで再起動する VM (`ha-manager add vm:<vmid>`、共有ストレージ上) で実行し、クラスターごとに 1 つだけ実行してください。各エージェントはクラスター全体を読み取るため、2 つ目があるとすべてのリソースが二重に報告されます。[ノードがダウンしたとき](/docs/telemetry/proxmox#when-a-node-goes-down) を参照してください。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "これはエージェントが実行する `otel-collector-config.yaml` の全体で、`${env:...}` の値は `.env` ファイルから与えられます。`transform/pve-identity` プロセッサーは、組み込みの Proxmox アラートテンプレートとダッシュボードのフィルターが依存する `pve.scope` / `pve.type` / `pve.id` 属性を導き出します。設定をカスタマイズする場合も残してください:",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "既定では、エージェントはメトリクスだけを送るため、クラスターの **ログ** タブは空のままです。PVE のサービスは systemd ジャーナルにログを書き込み、出荷時の設定には `pveproxy`、`pvedaemon`、`pve-firewall`、`pve-ha-crm`、`pve-ha-lrm`、`pvescheduler`、`pvestatd`、`qmeventd` 向けの `journald` レシーバーがコメントアウトされた状態で含まれています。",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **エージェントを PVE ノードで実行します。** ジャーナルはホストごとにあるため、リモートのエージェントからは読み取れず、各ノードは自分のジャーナルだけを送ります。メトリクスのエージェントをクラスターの外に置いたままにするには、代わりにログ専用の 2 つ目のコレクターを各ノードで実行します。",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. `otel-collector-config.yaml` の `journald` レシーバーと `logs` パイプライン、および `docker-compose.yml` の 2 つのジャーナルボリュームのコメントを外します。",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **コレクターのイメージを差し替えます。** 標準のイメージには `journalctl` がなく、ジャーナルを読み取れないユーザーで動きます。このラッパーをビルドし、`docker-compose.yml` の `image:` をそれに向けます:",
  "4. Apply it:": "4. 適用します:",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "標準のイメージのままにしたい場合は、`/var/log/syslog` を追跡する `filelog` の代替手段がドキュメントにあります: [Proxmox サービスのログを送る](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs)。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "`oneuptime.label.` で始まるリソース属性は、クラスターのプロジェクトラベルになります。`oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。`otel-collector-config.yaml` の `resource` プロセッサーに、`proxmox.cluster.name` の隣に追加します:",
  "Then restart the collector so it reads the new config:":
    "その後、新しい設定を読み込むようにコレクターを再起動します:",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "クラスターには `team:platform` と `env:production` のラベルが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるので、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` は **`oneuptime-proxmox-ai-agent`** も実行します。OneUptime AI がこのクラスターのインシデントやアラートを調査する間、これを通じて読み取り専用の `pvesh` コマンド (`pvesh get /cluster/status`、ゲストの現在の状態、ノードの失敗したタスク) を実行します。中に `pvesh` バイナリーはなく、各コマンドは `PVE_HOST` の Proxmox VE API への 1 回の呼び出しになります。`PROXMOX_CLUSTER_NAME` という名前のクラスターとして登録され、クラスターの **AI → AI エージェント** ページに表示されます。",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API トークンが絶対的な上限です。** コレクターの PVEAuditor トークン (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`) で読み取り、それは読み取り以外のことができません。独自のエクスポーターを実行していて `.env` にトークンがない場合は、追加してください。",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- `ONEUPTIME_AI_ALLOW_WRITES=true` を設定しない限り **読み取り専用** です。修正 (ゲストの起動や再起動) には、ゲストの電源を操作できる専用のトークンも必要で、`ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET` として設定します。`pveum` コマンドはエージェントの README にあります。エージェントがこのクラスターのゲストで動いている場合は、そのゲストの VMID を `ONEUPTIME_AI_PROTECTED_TARGETS` に入れてください。",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 確認します: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- OneUptime AI を使わない場合は、`docker-compose.yml` から `oneuptime-proxmox-ai-agent` サービスを削除します。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "実行できるコマンドと修正のしくみ: [インフラストラクチャ AI エージェント](/docs/ai/infrastructure-ai-agents#proxmox-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**アップグレード**: コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。インストールスクリプトをもう一度実行します。既存の `.env` の値をすべて再利用し (何も改めて尋ねません)、最新の `docker-compose.yml` と `otel-collector-config.yaml` をダウンロードし (編集したファイルは新しいファイルの隣に `<file>.bak.<timestamp>` として残ります)、イメージをプルして、それらでエージェントを作り直します:",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定は、固定しているコレクターのバージョンをクラスターの **エージェントバージョン** として報告します。この OneUptime がより新しいバージョンを固定すると、その横の警告マークからこれらのコマンドを開けます。",
  "**Uninstall** the agent:": "エージェントを **アンインストール** します:",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "その後、不要になった API トークンは *Datacenter → Permissions → API Tokens* で削除します。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` は、チェーン全体 (コンテナーランタイム、エクスポーターのスクレイプ、クラスター名の付与、トークンの形式、コレクター自身のメトリクス) を確認し、取り込みキーを受け付けるかどうかを OneUptime に直接尋ねます。最後の確認が最も重要です。OneUptime の OTLP エンドポイントは不正なキーを `401` または `422` で拒否しますが、コレクターはそれをバッチごとに 1 行の見落としやすい `Exporting failed` として記録するだけなので、スクリプトは `GET /otlp/v1/validate` に 200/401 の直接の判定を求めます。",
  "It ends with a verdict naming the most likely cause.":
    "最後に、最も可能性の高い原因を示す判定を出します。",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. エージェントが動いていることを確認します (`/opt/oneuptime-proxmox-agent` で): `docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. エージェントのログでエラーを確認します: `docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. エージェントのマシンからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. エクスポーターが応答するか確認します。付属のエクスポーターはポートをホストに公開しないため、そのネットワーク名前空間の中で curl を実行します。`pve_*` のメトリクス行が表示されるはずです (独自のエクスポーターの場合は、その `host:9221` に直接 curl します):",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. API トークンがパス `/` で **PVEAuditor** ロールを持っていることを、トークンとそのユーザーの両方で確認します。",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. コレクターのログでスクレイプやエクスポートのエラーを確認します (`/opt/oneuptime-proxmox-agent` で): `docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API トークンが間違っているか、権限が足りません。トークン ID の形式 (`user@realm!tokenname`)、シークレット、そしてパス `/` で **PVEAuditor** ロールがトークンとそのユーザーに付与されていることを確認し直してください。エクスポーター自身のログに API の応答が表示されます: `docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    'ゲストの系列 (`qemu/*`、`lxc/*` の ID) は、エクスポーターのクラスターのコレクターから得られます。出荷時の設定はこれを有効にしています (`cluster=1` スクレイプパラメーター)。設定をカスタマイズした場合は、`cluster: ["1"]` パラメーターを元に戻してください。',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "ゲストの起動時の自動起動フラグとレプリケーションジョブは、ゲストが動くノードから得られ、エージェントは `PVE_NODES` のノードしか読み取りません。そこに各ノード自身のアドレスを `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]` のように並べ、`/opt/oneuptime-proxmox-agent` で `docker compose up -d` を実行して適用します。編集後にコレクターが起動しなくなった場合は、リストの角かっこが抜けています。`troubleshoot.sh` はリストのすべてのノードを確認します。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "クラスターの識別は `PROXMOX_CLUSTER_NAME` から来ており、すべてのメトリクスに `proxmox.cluster.name` として付きます。`.env` で修正し、`/opt/oneuptime-proxmox-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **クラスター名**: **`pve-1`** と正確に入力します。別の名前は新しいクラスターとして登録されます。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "クラスターの識別は `PROXMOX_CLUSTER_NAME` から来ており、すべてのメトリクスに `proxmox.cluster.name` として付きます。このクラスターは **`pve-1`** です。`.env` で修正し、`/opt/oneuptime-proxmox-agent` で `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "コマンドには OneUptime の URL と取り込みキーがすでに入っています。残りはスクリプトが尋ねます:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "Proxmox VE 8.3 以降が必要です。1 つ目のコマンドは `oneuptime` という名前の Webhook ターゲットを追加します。このターゲットは各通知をこのクラスターのログとして OneUptime に送り、キーとクラスター名をシークレットに保存します。2 つ目のコマンドは、すべての通知をそこへ送ります。通知が同じクラスターに届くよう、`my-proxmox-cluster` をエージェントに付けたクラスター名に置き換えてください。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "その後、各ゲストのページに最後のバックアップが表示され、クラスターの **推奨事項** で **Backup Job Failed** と **Node Fenced** のアラートが提案されます。送信をやめるには:",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "Proxmox VE 8.3 以降が必要です。1 つ目のコマンドは `oneuptime` という名前の Webhook ターゲットを追加します。このターゲットは各通知をこのクラスターのログとして OneUptime に送り、キーとクラスター名をシークレットに保存します。2 つ目のコマンドは、すべての通知をそこへ送ります。コマンドにはすでに **`pve-1`** が入っているので、通知はこのクラスターに届きます。",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "この OneUptime から `docker-compose.yml` と `otel-collector-config.yaml` を新しいフォルダーにダウンロードします:",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "その隣に `.env` ファイルを作成します。トークンのシークレットが入るので、`chmod 600 .env` で非公開にしてください:",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- `my-proxmox-cluster` をこのクラスターの名前 (例: `pve-prod`) に置き換えます。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- `PVE_HOST` にはクラスターの任意のノードを設定します。その API が応答しない間は、エージェントが `PVE_NODES` の次のノードからクラスターを読み取るため、仮想 IP は不要です。",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- `PVE_NODES` には各ノード自身のアドレスを角かっこに入れて設定します。仮想 IP は使いません。エクスポーターは起動時の自動起動 (Guest Down)、レプリケーション、サブスクリプションを問い合わせたノードについてしか読み取らないため、各ノードに順番に問い合わせます。リストにないノードは見えません。",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- 前のステップのトークンを入力します。`COMPOSE_PROFILES=pve-exporter` は付属の prometheus-pve-exporter も起動し、それはこのトークンで API を読み取ります。",
  "Start the agent:": "エージェントを起動します:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "エージェントは `docker-compose.yml` の隣の `.env` ファイルからこれらを読み込みます。変更したら、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "`.env` から `COMPOSE_PROFILES` を外し、代わりにエージェントを独自のエクスポーター (`host:port`、スキームなし) に向けます:",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "これらは、エージェントのフォルダー (`docker-compose.yml` があるフォルダー) で実行します。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**アップグレード**: コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。両方のファイルをもう一度ダウンロードします。`.env` はそのまま残りますが、どちらかのファイルに加えた変更はやり直す必要があります:",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "その後、イメージをプルしてエージェントを作り直し、コレクターが新しい設定を読み込むようにします:",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. エージェントが動いていることを確認します (エージェントのフォルダーで): `docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. コレクターのログでスクレイプやエクスポートのエラーを確認します (エージェントのフォルダーで): `docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "ゲストの起動時の自動起動フラグとレプリケーションジョブは、ゲストが動くノードから得られ、エージェントは `PVE_NODES` のノードしか読み取りません。そこに各ノード自身のアドレスを `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]` のように並べ、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。編集後にコレクターが起動しなくなった場合は、リストの角かっこが抜けています。`troubleshoot.sh` はリストのすべてのノードを確認します。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "クラスターの識別は `PROXMOX_CLUSTER_NAME` から来ており、すべてのメトリクスに `proxmox.cluster.name` として付きます。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- これは **`pve-1`** 用のエージェントをインストールします。`PROXMOX_CLUSTER_NAME` は正確にそのままにしてください。変えると、データは新しいクラスターとして登録されます。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "クラスターの識別は `PROXMOX_CLUSTER_NAME` から来ており、すべてのメトリクスに `proxmox.cluster.name` として付きます。このクラスターは **`pve-1`** です。`.env` で修正し、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。新しい名前は新しいクラスターとして登録されることに注意してください。",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**エージェントは不要ですが、データは減ります。** Proxmox VE 9.0 以降は、各ノードのメトリクスを自ら OneUptime に送ります。HA の状態、起動時の自動起動 (**Guest Down** が使います)、バックアップのカバー率、レプリケーションは送られません。必要な場合は、インストールスクリプトか Docker Compose を使ってください。1 つのクラスターにはどちらか一方を使います。両方を動かすと、すべてのリソースが二重に報告されます。",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 以降**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "*Datacenter → Metric Server* でメトリクスサーバーを追加するための Proxmox の Web UI",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "すべてのノードがポート `443` で `<YOUR_ONEUPTIME_HOST>` に到達できること",
  "| Field | Value |": "| フィールド | 値 |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server** (サーバー) | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port** (ポート) | `443` |",
  "| **Protocol** | `https` |": "| **Protocol** (プロトコル) | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path** (パス) | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers** (ヘッダー) | 下の JSON |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "データセンターに 1 回だけ追加すれば、クラスターのすべてのノードがそれぞれ自分のメトリクスを送るようになります。",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime はプッシュを、エージェントが送るのと同じ `pve_*` 系列に変換します。クラスターは Proxmox のクラスター名で (スタンドアロンのノードはノード名で) 自動的に登録され、**Proxmox** セクションに表示されます。そこでは、ノード、ゲスト、ストレージの各ページ、概要のグラフ、メトリクスカタログ、CPU / メモリー / ストレージのアラートテンプレートが、エージェントの場合と同じように動作します。",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "各ノードは自分の状態しか送らないため、ダウンしたノードは自分のダウンを報告できません。まだ動いているノードが代わりに報告します:",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- 最後の報告から約 2 分後に Proxmox のページで **オフライン** と表示され、約 5 分後に **Node Offline** が発火します。",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** もそのノードをオフラインとして数えます。発火するのはノードが沈黙してから約 7〜9 分後で、5 分間のウィンドウ全体に報告がそろった時点です。",
  "- Its next report brings it back.": "- 次の報告があると元に戻ります。",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "オフラインとは「報告が途絶えた」という意味です。`pvestatd` のハング、`pmxcfs` の停止、OneUptime へのネットワークの切断は、どれも同じように見えます。スタンドアロンのホストやクラスター全体が沈黙すると、それを報告するノードが残らないため、代わりにクラスターが **切断済み** になります。7 日を超えて沈黙しているノードは報告されなくなります。これらの報告には、メトリクスエクスプローラーで `oneuptime.proxmox.inferred=not-reporting` の印が付きます。",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "クラスターは Proxmox のクラスター名で登録され、スタンドアロンのノードはノード名で登録されます。メトリクスサーバーの *Resource Attributes* で `proxmox.cluster.name` リソース属性を設定している場合は、代わりにそれが使われ続けます。",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime はプッシュを、エージェントが送る `pve_*` 系列に変換するため、Proxmox のページと CPU / メモリー / ストレージのアラートテンプレートはそのまま動作します。元の `proxmox_*` 系列も、Proxmox VE が報告するそれ以外のデータのために、メトリクスエクスプローラーで引き続き使えます。",
  "Some alert templates need data only the agent collects:":
    "一部のアラートテンプレートには、エージェントしか収集しないデータが必要です:",
  "| Needs the agent | Why |": "| エージェントが必要 | 理由 |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA の状態 | プッシュされません。**HA Resource in Error State** テンプレートにはエージェントが必要です |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| 起動時の自動起動フラグ | プッシュされません。起動時に自動起動するよう設定したゲストについてのみ通知する **Guest Down** には、エージェントが必要です |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| バックアップのカバー率とレプリケーション | プッシュされません。**Guest Not Backed Up** と **Replication Failing** にはエージェントが必要です |",
  "Every node has stopped reporting, or never started.":
    "すべてのノードが報告をやめたか、一度も報告を始めていません。",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. *Datacenter → Metric Server* で OpenTelemetry のエントリーを確認します。サーバー `<YOUR_ONEUPTIME_HOST>`、ポート `443`、プロトコル `https`、パス `/otlp/v1/metrics`、そしてステップ 1 のキーを入れた `x-oneuptime-token` ヘッダーです。",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. ノードがネットワーク経由で `<YOUR_ONEUPTIME_HOST>` に到達できることを確認します。",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "報告が途絶えています。ダウンしたノード、`pvestatd` のハング、`pmxcfs` の停止、OneUptime へのネットワークの切断は、どれも同じように見えます。次の報告があると元に戻ります。ノードをクラスターから外した場合は、そのページで **ノードを削除** を使ってください。そうしないと最大 7 日間オフラインのままです。",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "ネイティブプッシュは、HA の状態、起動時の自動起動、バックアップのカバー率、レプリケーションを送りません。代わりにエージェントを実行するには、このガイドの上部で **インストールスクリプト** か **Docker Compose** を選び、メトリクスサーバーは削除してください。両方を動かすと、すべてのリソースが二重に報告されます。",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "このクラスターは OneUptime では **`pve-1`** です。それが Proxmox のクラスター自身の名前でない場合は、メトリクスサーバーの *Resource Attributes* で `proxmox.cluster.name` を `pve-1` に設定してください。そうしないと、プッシュによって新しいクラスターが登録されます。",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "Proxmox VE 8.3 以降が必要です。1 つ目のコマンドは `oneuptime` という名前の Webhook ターゲットを追加します。このターゲットは各通知をこのクラスターのログとして OneUptime に送り、キーとクラスター名をシークレットに保存します。2 つ目のコマンドは、すべての通知をそこへ送ります。`my-proxmox-cluster` を、OneUptime でクラスターが表示される名前 (Proxmox のクラスター名、またはスタンドアロンのノード自身の名前) に置き換えてください。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-proxmox-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です。設定しない場合、インストールスクリプトは新しいエージェントのコンテナーにそのフォルダーにちなんだ名前を付け、スクリプトを再実行してもその名前を維持します |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | いいえ | API フェイルオーバーのサイドカーのコンテナー名 (既定: `oneuptime-pve-api-failover`)。設定しない場合、インストールスクリプトは 2 つ目のクラスターの API フェイルオーバーのサイドカーにそのコレクターにちなんだ名前を付け (`oneuptime-pve-api-failover-cluster2` を `oneuptime-proxmox-agent-cluster2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | いいえ | 付属のエクスポーターのコンテナー名 (既定: `oneuptime-pve-exporter`)。設定しない場合、インストールスクリプトは 2 つ目のクラスターの付属のエクスポーターにそのコレクターにちなんだ名前を付け (`oneuptime-pve-exporter-cluster2` を `oneuptime-proxmox-agent-cluster2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-proxmox-ai-agent`)。設定しない場合、インストールスクリプトは 2 つ目のクラスターの AI エージェントにそのコレクターにちなんだ名前を付け (`oneuptime-proxmox-ai-agent-cluster2` を `oneuptime-proxmox-agent-cluster2` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "1 つのエージェントは 1 つのクラスターを読み取ります。2 つ目のクラスターには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントをインストールします。2 つのコンテナーが同じ名前を使うことはできません:",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "変数 (`PROXMOX_AGENT_CONTAINER_NAME` など) を設定しない場合、スクリプトはフォルダーにちなんでコンテナーに `oneuptime-proxmox-agent-cluster2` のような名前を付けます。その名前はそのエージェントの `.env` に保存されるため、同じ `INSTALL_DIR` でスクリプトを再実行してエージェントをアップグレードしても維持されます。また、`docker-compose.yml` で `container_name` を以前編集したエージェントも、その名前を維持します。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、別の場所ですでにエージェントを実行しているフォルダーと同じ名前のフォルダーはスクリプトが拒否します。フォルダーは `-d` で診断スクリプトに渡します。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | いいえ | コレクターのコンテナー名 (既定: `oneuptime-proxmox-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | いいえ | API フェイルオーバーのサイドカーのコンテナー名 (既定: `oneuptime-pve-api-failover`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | いいえ | 付属のエクスポーターのコンテナー名 (既定: `oneuptime-pve-exporter`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-proxmox-ai-agent`)。同じマシン上の 2 つ目のクラスターのエージェントには専用の名前が必要です |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "1 つのエージェントは 1 つのクラスターを読み取ります。2 つ目のクラスターには、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントを用意します。2 つのコンテナーが同じ名前を使うことはできません。名前はそのエージェントの `.env` で設定します:",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "フォルダーにはそれぞれ専用の名前を付けてください。Docker Compose はプロジェクトにフォルダー名だけにちなんだ名前を付けるため、同じ名前の 2 つ目のフォルダーは最初のエージェントのコンテナーを置き換えてしまいます。名前は `docker-compose.yml` に書かないでください。このファイルはアップグレードで置き換えられます。",
};

export default TRANSLATION;
