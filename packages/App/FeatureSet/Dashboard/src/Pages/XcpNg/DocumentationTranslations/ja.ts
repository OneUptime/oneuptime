import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 以降で、監視したいプールに接続されていること。その OpenMetrics プラグインには XOA では Premium ライセンスが必要です。ソースからビルドした Xen Orchestra には含まれています",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 以降と Docker Compose v2 プラグインが入った、HTTPS で Xen Orchestra に到達できるマシン",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "エージェントが接続するアドレスを名前に含む、Xen Orchestra の証明書。Xen Orchestra が自分用に作る自己署名証明書は名前を一つも含まないため、現在の TLS クライアントはどれも検証できません。詳細にある **Xen Orchestra の証明書** を参照してください",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. Xen Orchestra で *Settings → Plugins* を開き、**openmetrics** を探します。",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. 有効にします。初めて起動したときにシークレットを作成して保持し、Xen Orchestra は再起動後もそれを保持します。",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. プラグインの設定を開き、その **Prometheus secret** をコピーします。次のステップでエージェントに渡します。そこで独自のシークレットを入力して保存することもできます。",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "プラグインは Xen Orchestra 自身のアドレスと証明書で、`/openmetrics/metrics` において応答し、そのシークレットを含むリクエストにだけ応答します。Xen Orchestra が接続しているすべてのプールを提供するので、1 つのエージェントですべてをカバーできます。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "スクリプトは、OneUptime の URL と取り込みキー (どちらもステップ 1 に表示されます。そこでキーを選ぶとここに入ります) を尋ね、続けて次の項目を尋ねます:",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestra のアドレス** — ブラウザーで開くときのアドレスです。例: `https://xo.example.com` または `https://10.0.0.5:8443`。",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics プラグインのシークレット** — 前のステップのものです。入力中は表示されません。",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **この Xen Orchestra の呼び名** — 各プールが自分の設定に表示する名前です。Enter を押すと、そのアドレスを使います。",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "次にスクリプトは Xen Orchestra の証明書を読み取ります。このマシンがすでにそれを信頼している場合、エージェントは同じ CA バンドルを信頼します。信頼していない場合、スクリプトは証明書の SHA-256 フィンガープリントを表示します。Xen Orchestra のマシンにあるものと比較し、**y** と答えると、その証明書だけを信頼します。検証を無効にすることはありません。何かをインストールする前に、シークレットを使ってプラグインにメトリクスを問い合わせ、Xen Orchestra が報告するプールを示します。",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "`/opt/oneuptime-xcp-ng-agent` にインストールし、`0600` の `.env` ファイルを書き込み、Docker Compose でエージェントを起動します。スクリプトをもう一度実行すると、改めて尋ねずにその `.env` の内容をすべて再利用するので、アップグレードもこの方法で行います。",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` に `oneuptime-xcp-ng-agent` が表示されます。そのログで `Everything is ready. Begin running and processing data.` を探してください。エージェントは毎分 Xen Orchestra を読み取り、報告された各プールは、Xen Orchestra が付けた名前で、ホスト、VM、ストレージとともに **XCP-ng** セクションに表示されます。",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "インストールスクリプトはこれらを `/opt/oneuptime-xcp-ng-agent/.env` に書き込みます。変更したら、`/opt/oneuptime-xcp-ng-agent` で `docker compose up -d` を実行して適用します。",
  "| Variable | Required | Description |": "| 変数 | 必須 | 説明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | はい | OneUptime インスタンスの URL (例: `<YOUR_ONEUPTIME_URL>`) |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | はい | テレメトリ取り込みキー (ステップ 1 で選んだもの) |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | はい | Xen Orchestra の `host` または `host:port` (スキームなし) |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | いいえ | `https` (既定)。`http` はラボ環境でのみ使用してください。その場合、シークレットは平文でネットワークを流れます |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | はい | OpenMetrics プラグインのシークレット。Bearer トークンとして送信されます。その中の `$` はすべて `$$` と書きます |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | いいえ | OneUptime でのこの Xen Orchestra の呼び名。各プールの設定に表示されます (既定: そのアドレス) |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | いいえ | `XO_ADDRESS` が証明書に記載されていないアドレスのときに、Xen Orchestra の証明書の照合に使う名前 |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | いいえ | エージェントのコンテナー名 (既定: `oneuptime-xcp-ng-agent`)。同じマシン上の 2 つ目の Xen Orchestra のエージェントには専用の名前が必要です。設定しない場合、インストールスクリプトは新しいエージェントにそのフォルダーにちなんだ名前を付け、スクリプトを再実行してもその名前を維持します |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | インストールスクリプト | 入力したとおりの Xen Orchestra のアドレス。スクリプトはここから `XO_SCHEME` と `XO_ADDRESS` を導きます |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | インストールスクリプト | エージェントがその証明書だけを信頼する場合の、Xen Orchestra 自身の証明書の SHA-256 フィンガープリント |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | インストールスクリプト | Xen Orchestra の証明書を発行した CA バンドル。スクリプトはこれを `xo-ca.pem` にコピーします |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | いいえ | 組み込みの **Read only** ロールのコピーだけを持つ Xen Orchestra ユーザーのトークン。設定すると XCP-ng AI エージェントが動作し、これで読み取ります |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | いいえ | 修正専用: 修正を許可するロールを持つ別のユーザーのトークン。これがないと AI エージェントは何も変更しません |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | いいえ | AI エージェントが担当するプールの XAPI UUID (既定: 読み取りトークンから見える唯一のプール) |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | いいえ | AI エージェントが登録に使うプールとして `XCP_NG_POOL_ID` を上書きします |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | いいえ | `true` または `false`: OneUptime AI が調査中に AI エージェントの読み取り専用コマンドを実行してよいかどうか (既定: 有効) |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | いいえ | `off`、`ask-for-approval`、`automatic`、`bypass-approval` のいずれか: OneUptime AI が修正をどう適用してよいか |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | いいえ | `true` にすると、AI エージェントは変更用のトークンで修正を適用できます。それ以外の値では読み取り専用のままです |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | いいえ | 修正が触れてよい `vm/<uuid>`、`host/<uuid>`、`pbd/<uuid>`、`schedule/<uuid>` をカンマ区切りで指定 (既定: すべて) |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | いいえ | 同様に、OneUptime AI が決して変更してはならないもの: AI エージェントが動作する VM と、Xen Orchestra 自身の VM |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | いいえ | AI エージェントのログレベル: `debug`、`info` (既定)、`warn`、`error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | いいえ | `xcp-ng-ai-agent` で AI エージェントが起動します。インストールスクリプトは読み取りトークンが設定されているとこれを書き込みます |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | いいえ | AI エージェントのコンテナー名 (既定: `oneuptime-xcp-ng-ai-agent`)。設定しない場合、インストールスクリプトは 2 つ目の Xen Orchestra の AI エージェントにそのコレクターにちなんだ名前を付け (`oneuptime-xcp-ng-ai-agent-lab` を `oneuptime-xcp-ng-agent-lab` の隣に)、スクリプトを再実行してもその名前を維持します |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "エージェントは、`docker-compose.yml` の隣にある `xo-ca.pem` で Xen Orchestra の証明書を検証します。",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "エージェントは、読み取りのたびに `xo-ca.pem` だけを使って Xen Orchestra の証明書を検証します。このファイルには次の 3 つのいずれかが入ります:",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestra 自身の証明書**。SHA-256 フィンガープリント (`XO_TLS_FINGERPRINT`) で固定され、エージェントはその証明書だけを信頼します。",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **それを発行した CA** (`XO_CA_FILE`)。独自の CA が発行した証明書の場合です。",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **このマシンの CA バンドル**。このマシンがすでに信頼している証明書の場合です。",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "いずれの場合も、証明書にはエージェントが接続するアドレスが名前として含まれている必要があります。エージェントは、現在のすべての TLS クライアントと同じく、証明書の発行先の名前を検証し、サブジェクトは見ません。Xen Orchestra が自分用に作る自己署名証明書は名前を一つも含まないため、固定していてもいなくてもエージェントはそれを信頼できず、`x509: certificate is not valid for any names` で失敗します。[Xen Orchestra の証明書](/docs/telemetry/xcp-ng#xen-orchestras-certificate) にあるとおり、そのアドレスを名前に含む証明書 (独自の CA が発行したもの、またはサブジェクト代替名 (subject alternative name) 付きの自己署名証明書) を Xen Orchestra に設定してください。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "証明書が `XO_ADDRESS` のアドレスとは別の名前で Xen Orchestra を示している場合は、`XO_TLS_SERVER_NAME` にその名前を設定します。固定した証明書が更新されると、エージェントは新しい証明書を信頼するまで Xen Orchestra の読み取りを止めます。インストールスクリプトをもう一度実行してください。新しいフィンガープリントを表示して、何も変更せずに停止します。そのフィンガープリントを Xen Orchestra のマシンで確認してから、それを指定してスクリプトをもう一度実行します: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`。",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "エージェントは毎分プラグインを読み取り、プラグインは各ホストの XAPI のラウンドロビンデータベースを 60 秒の解像度で読み取ります。エージェントは `xcp_*` の系列を残し、各系列のプールを送信するバッチに移して、`xcp_ng.pool.id` (変わることのないプールの UUID) と `xcp_ng.pool.name` にします:",
  "| Category | Series |": "| カテゴリ | 系列 |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **プール** | `xcp_pool_connected` — Xen Orchestra がプールに接続している間は存在します |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **ホスト** | `xcp_host_status` (電源状態と有効かどうか)、`xcp_host_uptime_seconds`、`xcp_host_cpu_average`、`xcp_host_load_average`、`xcp_host_memory_*`、`xcp_host_running_vcpus`、インターフェースごとの `xcp_host_network_*`、ストレージリポジトリごとの `xcp_host_disk_*` |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **VM** | `xcp_vm_status`、`xcp_vm_uptime_seconds`、`xcp_vm_cpu_usage`、`xcp_vm_runstate_*` (CPU の競合)、`xcp_vm_memory_*`、インターフェースごとの `xcp_vm_network_*`、ディスクごとの `xcp_vm_disk_*`、`xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **ストレージ** | `xcp_sr_physical_size_bytes`、`xcp_sr_physical_usage_bytes`、`xcp_sr_virtual_size_bytes`、`xcp_vdi_virtual_size_bytes`、`xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*` (XOSTOR を実行しているプール) |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    'コントロールドメインは `is_control_domain="true"` の VM として報告されます。ページでは、表示を求めない限り非表示になります。',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra は 8 つのスループット系列をカウンターとして型付けしていますが、どれも XAPI の毎秒のレートを持っています: `xcp_host_network_receive_bytes_total`、`xcp_host_network_transmit_bytes_total`、そして VM のネットワーク、ネットワークエラー、ディスクの読み取りと書き込みの系列です。エージェントは値を変えずにこれらをゲージに変換するので、OneUptime はそれらを本来のレート (毎秒のバイト数またはエラー数) として保存します。",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime は各プールに 0/1 の系列を 4 つ追加し、アラートテンプレートがそれを読み取ります: `xcp_ng.host.running`、`xcp_ng.host.enabled`、`xcp_ng.vm.running`、`xcp_ng.vm.stopped_after_running` (直近 1 日に実行されていて、停止または一時停止した VM)。また、すべてのポイントに `xcp_ng.scope` (`pool`、`host`、`vm`、`sr`、`vdi`、`xostor` のいずれか) と `xcp_ng.id` (そのオブジェクトの UUID) を付け、モニターとダッシュボードはこれで絞り込みます。",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "残さないもの: どのプールにも属さない Xen Orchestra 自身のプロセス系列 (`xo_*`) と、プラグインがプールなしで送る、IPMI で読み取ったホストの電力。その中の各 VM の推定分は残します。",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "1 つのエージェントは 1 つの Xen Orchestra と、それが管理するすべてのプールを読み取ります。2 つ目の Xen Orchestra には、専用のフォルダーに専用のコンテナー名で 2 つ目のエージェントをインストールします。2 つのコンテナーが同じ名前を使うことはできません:",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "`XCP_NG_AGENT_CONTAINER_NAME` を指定しない場合、スクリプトはフォルダーにちなんでコンテナーに名前を付けます。その名前はそのエージェントの `.env` に保存されるため、エージェントをアップグレードするためにスクリプトを再実行しても維持されます。また、`docker-compose.yml` で `container_name` を以前編集したエージェントも、その名前を維持します。Docker Compose の場合は、代わりに各エージェントの `.env` で `XCP_NG_AGENT_CONTAINER_NAME` を設定します。",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "同じプールを管理する 2 つの Xen Orchestra を両方とも読み取らないでください。そのプールは UUID によって OneUptime 上では 1 つのプールなので、二重に報告されます。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "`oneuptime.label.` で始まるリソース属性は、エージェントが読み取る各プールのプロジェクトラベルになります。`oneuptime.label.<dimension>=<value>` はラベル `<dimension>:<value>` です。`otel-collector-config.yaml` の `resource` プロセッサーに、`oneuptime.agent.version` の隣に追加します:",
  "Then restart the collector so it reads the new config:":
    "その後、新しい設定を読み込むようにコレクターを再起動します:",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "プールには `team:platform` と `env:production` のラベルが付いて表示されます。ラベルは大文字と小文字を区別せずに照合されるので、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。インストールスクリプトをもう一度実行すると、編集した `otel-collector-config.yaml` は置き換えられ、元のファイルは隣に `otel-collector-config.yaml.bak.<timestamp>` として残ります。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**アップグレード** — コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。インストールスクリプトをもう一度実行します。既存の `.env` の値をすべて再利用し (何も改めて尋ねません)、Xen Orchestra の証明書を同じ方法で検証し、最新の `docker-compose.yml` と `otel-collector-config.yaml` をダウンロードし (編集したファイルは新しいファイルの隣に `<file>.bak.<timestamp>` として残ります)、イメージをプルして、それでエージェントを作り直します:",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定は、固定しているコレクターのバージョンを各プールの **エージェントバージョン** として報告します。この OneUptime がより新しいバージョンを固定すると、その横の警告マークからこれらのコマンドが開きます。",
  "**Uninstall** the agent:": "エージェントを **アンインストール** します:",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "その後、ほかに読み取るものがなければ、Xen Orchestra で OpenMetrics プラグインを無効にします。",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` はチェーン全体 (コンテナー、`xo-ca.pem` による Xen Orchestra の証明書、プラグインとそのシークレット、報告されるプール) を確認し、取り込みキーを受け付けるかどうかを OneUptime に直接問い合わせます。最も重要なのはこの最後の確認です。OneUptime の OTLP エンドポイントは誤ったキーを `401` または `422` で拒否しますが、コレクターはそれをバッチごとに 1 行の `Exporting failed` としか記録せず、見落としやすいからです。",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "最後に、最も可能性の高い原因を示す判定を出します。シークレットを出力することはありません。",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "OneUptime は、15 分間何も読み取られなかったプールを「切断済み」とします。",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. この Xen Orchestra のすべてのプールが「切断済み」の場合は、エージェントを確認します (`/opt/oneuptime-xcp-ng-agent` で): `docker compose ps` と `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. 1 つだけの場合は、Xen Orchestra がそのプールの報告をやめています。Xen Orchestra の *Settings → Servers* で、そのプールのサーバーが接続されている必要があります。プールのホスト、VM、ストレージは、Xen Orchestra が最後に報告した状態のまま残ります。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "コレクターのログに `server returned HTTP status 401 Unauthorized` が記録されます。*Settings → Plugins → openmetrics* からシークレットをもう一度コピーし、`.env` の `XO_OPENMETRICS_SECRET` に設定して (一重引用符で囲み、`$` はすべて `$$` と書きます)、`/opt/oneuptime-xcp-ng-agent` で `docker compose up -d` を実行して適用します。6.8 より前の Xen Orchestra は、再起動のたびに新しいシークレットを作成していました。",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra は応答しますが、その OpenMetrics プラグインは応答しません。*Settings → Plugins → openmetrics* でプラグインを有効にし (XOA ではそのために Premium ライセンスが必要です)、Xen Orchestra が 6.9 以降であることを確認してください。プラグインの実行中、`/openmetrics/health` はシークレットなしで `{"status":"ok"}` を返します。',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names` — 証明書がアドレスを一つも名前に含んでいません。Xen Orchestra 自身の自己署名証明書がこれに当たります。そのアドレスを名前に含む証明書を Xen Orchestra に設定してください。",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>` — それらの名前のいずれかに接続するか、そのいずれかを `XO_TLS_SERVER_NAME` に設定します。",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority` — `xo-ca.pem` に、この証明書もそれを発行した CA も入っていません。証明書が更新されたか、ファイルに別のものが入っています。詳細にある **Xen Orchestra の証明書** のとおりに書き直してください。",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra は接続しているプールだけを報告し、エージェントはその Xen Orchestra だけを読み取ります。Xen Orchestra の *Settings → Servers* でプールのサーバーを接続すると、次の読み取りでプールが OneUptime に表示されます。別の Xen Orchestra が読み取るプールには、その Xen Orchestra の隣に専用のエージェントが必要です。",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **この Xen Orchestra の呼び名** — コマンドにはすでに **`xo-paris`** という名前が入っています。このプールの設定に表示されているとおりです。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "コマンドには OneUptime の URL と取り込みキーがすでに入っています。残りはスクリプトが尋ねます:",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "この OneUptime から `docker-compose.yml` と `otel-collector-config.yaml` を新しいフォルダーにダウンロードします:",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "その隣に `.env` ファイルを作成します。プラグインのシークレットが入るので、`chmod 600 .env` で非公開にしてください:",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- `XO_ADDRESS` には、Xen Orchestra の `host` または `host:port` を `https://` なしで設定します。",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- プラグインのシークレットは一重引用符で囲みます。`$` が含まれる場合は、それぞれを `$$` と書きます。コレクターが値をもう一度読み取るためです。",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` は、各プールの設定がこの Xen Orchestra を呼ぶ名前です。",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "次に、Xen Orchestra の証明書を `docker-compose.yml` の隣に `xo-ca.pem` として置き、エージェントに渡します。エージェントは Xen Orchestra をこのファイルだけで検証します。Xen Orchestra 自身の証明書を信頼するには、それを読み取り、そのフィンガープリントを Xen Orchestra のマシンにあるものと照合します:",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "独自の CA が発行した場合は、代わりにその CA の証明書を `xo-ca.pem` にコピーします。公開 CA が発行した場合は、このマシンの CA バンドルをコピーします (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`)。",
  "Start the agent:": "エージェントを起動します:",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "エージェントは `docker-compose.yml` の隣の `.env` ファイルからこれらを読み込みます。変更したら、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "証明書が `XO_ADDRESS` のアドレスとは別の名前で Xen Orchestra を示している場合は、`XO_TLS_SERVER_NAME` にその名前を設定します。`xo-ca.pem` の証明書が更新されたら、ステップ 3 と同じように読み取り直してから、`docker compose up -d --force-recreate` を実行します。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "これらは、エージェントのフォルダー (`docker-compose.yml` があるフォルダー) で実行します。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**アップグレード** — コレクターのイメージは `docker-compose.yml` で固定され、その設定は隣のファイルにあるため、プルだけではエージェントは新しくなりません。両方のファイルをもう一度ダウンロードします。`.env` と `xo-ca.pem` はそのまま残りますが、どちらかのファイルに加えた変更はやり直す必要があります:",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "その後、イメージをプルしてエージェントを作り直し、コレクターが新しい設定を読み込むようにします:",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. この Xen Orchestra のすべてのプールが「切断済み」の場合は、エージェントを確認します (エージェントのフォルダーで): `docker compose ps` と `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "コレクターのログに `server returned HTTP status 401 Unauthorized` が記録されます。*Settings → Plugins → openmetrics* からシークレットをもう一度コピーし、`.env` の `XO_OPENMETRICS_SECRET` に設定して (一重引用符で囲み、`$` はすべて `$$` と書きます)、`docker-compose.yml` のあるフォルダーで `docker compose up -d` を実行して適用します。6.8 より前の Xen Orchestra は、再起動のたびに新しいシークレットを作成していました。",
};

export default TRANSLATION;
