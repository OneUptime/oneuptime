import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 以降で動作する Kubernetes クラスター",
  "`kubectl` and `helm` (v3) installed on your machine":
    "お使いのマシンにインストールされた `kubectl` と `helm` (v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "クラスターが違いますか？ `kubectl config use-context <context-name>` で切り替えます。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` をこのクラスターの名前 (例: `prod-us-east-1`) に置き換えます。OneUptime ではこの名前でクラスターが表示されるので、変えないでください。新しい名前は新しいクラスターとして登録されます。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` は、chart の既定どおり **AI 調査** をオンにします。OneUptime AI は Kubernetes AI エージェントを通じて、読み取り専用の kubectl でこのクラスターのインシデントやアラートを調査します。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "You should see:": "次のように表示されます:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "コレクターと Kubernetes AI エージェント、さらに各ノードに `-logs` と `-ebpf` の Pod が 1 つずつ。これらが `Running` になると、クラスターは **Kubernetes** セクションに自動で表示されます。通常は 1、2 分です。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI エージェント (既定でオン、読み取り専用)。** `kubernetes-agent-ai-agent` Pod は、同じ API キーを使い、読み取り専用の kubectl (`get`、`describe`、`logs`、`events`、`top`) で OneUptime AI がこのクラスターのインシデントやアラートを調査できるようにします。後で書き込み権限を与えない限り、何も変更できません。確認するには、クラスターを開いて **AI → エージェント** に移動します。不要ですか？ `--set aiAgent.enabled=true` の代わりに `--set aiAgent.enabled=false` を付けてインストールしてください。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "名前空間のルールで、エージェントが各名前空間から何を収集するかが決まります。`default`、`production`、`staging` からだけ Pod のログと eBPF データを収集するには:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "すべてを残しつつ、ノイズの多い名前空間のログだけを止めるには、それらを `podLogs` からだけ除外します:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **スコープ:** `podLogs` (コンテナーの stdout/stderr)、`ebpfDiscovery` (eBPF のトレースとメトリクス)、`metrics` (名前空間のあるメトリクス)、`traces` (すべてのスパン)。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **パターン** は名前空間の名前全体に一致し、`team-*` のように `*` を使えます。`exclude` ルールは常に `include` ルールより優先されます。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **ルールを設定すると既定のルールが置き換わります**。既定のルールは `kube-system` を `podLogs` と `ebpfDiscovery` から除外します。引き続き必要なら、2 つ目の例のように一覧に残してください。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- ノードとクラスターのメトリクスには名前空間がないため、常に残ります。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` には Helm 3.10 以降が必要です。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**重要な行だけを送る。** クラスターから出る前に、一定の重大度未満の Pod のログ行を破棄します:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL` を受け付けます。`WARN` は警告、エラー、致命的な行を残します。重大度はログ行そのもの (`[ERROR]`、`level=warn`、`"level":"info"`) から読み取ります。Kubernetes のイベントがこれで破棄されることはありません。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod のログをオフにする。** メトリクスには影響しません。ノードコレクターは kubelet と cAdvisor のメトリクスのために動き続け、Pod のログを読むのをやめるだけです:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**ログの読み方を変える。** プリセットが自動で選びますが、明示した `logs.mode` が常に優先されます:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: 各ノードの `/var/log/pods` を hostPath 経由で読みます (オーバーヘッドが最も小さい。hostPath が必要)。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment が Kubernetes API を通じて Pod のログを追跡します (どのクラスターでも動作)。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: Pod のログを収集しません。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "これで、クラスター内で応答する API サーバーを読み取ります。etcd、スケジューラー、コントローラーマネージャーはコントロールプレーンのノードで応答し、エージェントの Pod はそれを推測できないため、各ノードのアドレスを指定すると読み取ります:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **スケジューラーとコントローラーマネージャー** は HTTPS を提供し、エージェントのトークンを受け付けますが、kubeadm はこれらを `127.0.0.1` にバインドします。エージェントの Pod から到達できる `--bind-address` を指定してください。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** は、前述のとおり kubeadm の `--listen-metrics-urls` (ポート 2381。ノードのアドレスを追加するまで `127.0.0.1` にバインド) で平文 HTTP のメトリクスを提供します。または、要求されるクライアント証明書を使って HTTPS のクライアントポート 2379 を収集します。`ca.crt`、`tls.crt`、`tls.key` を `oneuptime-agent` の Secret に入れ、`controlPlane.etcd.clientCertSecret` にその名前を指定してください。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "自己管理クラスターのみ: マネージドサービス (EKS、GKE、AKS) はコントロールプレーンのメトリクスを公開しません。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "コストの監視は既定でオンです。エージェントにはオープンソースの OpenCost エンジン (と、それが必要とする小さな Prometheus) が含まれ、クラウドプロバイダーの公開価格表をもとにノードとボリュームに価格を付け (認証情報は不要です)、各名前空間とワークロードのコストを送信します。最初の 1 時間が経過した後、クラスターの概要ページと「コスト」ページに最初のデータが表示されます。",
  "On an agent installed before it was on by default, upgrade it:":
    "既定でオンになる前にインストールしたエージェントでは、次のようにアップグレードします:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **オフにするには:** 同じアップグレードに `--set cost.enabled=false` を追加します。",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "このプラットフォームでは、コストの監視は既定でオフです。このプラットフォームはすべての Pod を要求したリソース量で課金するため、オンにすると 3 つのコスト Pod の分だけ請求額が増えます。また、OpenCost は Pod ではなくノードに価格を付けます。それでもオンにするには:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "これだけで完全なインストールです。chart にはオープンソースの OpenCost エンジン (と、それが必要とする小さな Prometheus) が含まれ、クラウドプロバイダーの公開価格表をもとにノードとボリュームに価格を付けます。認証情報は不要です。小さな Pod が 3 つ追加され、最初の 1 時間が経過した後に最初のデータが表示されます。",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **すでに Kubecost や OpenCost を使っていますか？** エージェントがそれを見つけて同梱のエンジンの代わりに読み取り、クラスターの概要ページにもそう表示されます。2 つ目のエンジンを同梱しないようにするには、`--set cost.engine.url=auto` を追加します。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **オンプレミスやベアメタルですか？** `--set cost.opencost.customPricing.enabled=true` で料金表を設定します (リソース時間あたりの USD。chart の `values.yaml` を参照)。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "詳しいガイド: [Kubernetes のコストオブザーバビリティ](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "エージェントは各ノードで [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) を実行します。Go、.NET、Java、Node.js、Python、Ruby、Rust のサービスの HTTP/HTTPS、gRPC、SQL/Redis のトラフィックを、SDK もサイドカーもなしで捕捉し、トレース、リクエスト (RED) メトリクス、サービスグラフのデータをコレクター経由で送信します。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要件:** BTF 付きの Linux カーネル **5.8+** (Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ では既定)。eBPF の Pod は eBPF プログラムを読み込むために **特権** で動作します。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "ノードのカーネルが古い場合、特権 Pod が許可されていない場合、またはサービスがすでに OpenTelemetry SDK でトレースを送っていて重複を避けたい場合は、**オフにします**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**シグナルを選ぶ。** 各ファミリーは `--set ebpf.features.<name>=false` (または `=true`) で切り替えます:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 既定 | 追加されるもの |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | オン | サービスごとの HTTP/gRPC のリクエスト率、エラー、レイテンシー |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | オン | スパンの呼び出し数と所要時間 (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | オン | 呼び出し元 → 呼び出し先のエッジ。サービスマップを作ります |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | オン | Pod 間の TCP/UDP フローのカウンター |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | オフ | ゾーン間のネットワークメトリクス (カーディナリティが 2 倍になります) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | オン | ノード単位の TCP RTT、接続失敗と再送のカウンター |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**サービス間のトレース伝搬** (Pod A → Pod B へ渡るリクエストを、別のノード上でも 1 つのトレースにつなぐこと) は **既定でオン** です。これはすでに流れているトラフィックを書き換えて動作します (カーネル内で平文の HTTP リクエストを広げ、TLS と生の TCP に TCP オプションを追加します)。このバイト計算に誤りがあるとストリームが非同期になり、報告されている症状は、nginx などの L7 プロキシを通る転送が、レスポンスが ~64KB を超えたところで止まることです。これが見られる場合や、サービスメッシュで Pod が失敗し始めた場合は、`--set ebpf.contextPropagation=false` でオフにしてください。OpenTelemetry SDK は、こうしたことをせずにユーザー空間で `traceparent` を伝搬します。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "各 `oneuptime.labels.<key>=<value>` は、クラスターと、それが報告するサービスやホストのラベル `<key>:<value>` になります。ラベルは大文字と小文字を区別せずに照合されるため、既存の `Production` ラベルが再利用されます。OneUptime の画面で追加したラベルを、エージェントが削除することはありません。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "最新の chart に **アップグレード** します。`--reset-then-reuse-values` (Helm 3.14+) は設定した値 (プリセット、クラスター名、フィルター) を残し、それ以外はすべて新しい chart から取ります。新しい `--set` フラグはその上に追加してください:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 以前では、代わりに設定した値を指定してアップグレードします:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values` は使わないでください。アップグレード元の chart の既定値まで残るため、新しい chart の既定値 (eBPF イメージなど) が適用されなくなります。",
  "**Uninstall** the agent and its namespace:":
    "エージェントとその名前空間を **アンインストール** します:",
  "| Category | Data |": "| カテゴリー | データ |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **ノードのメトリクス** | CPU、メモリ、ファイルシステム、ネットワークの使用量 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod とコンテナーのメトリクス** | CPU、メモリ、ネットワーク I/O、再起動 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **クラスターのメトリクス** | ノードの状態、割り当て可能なリソース、Pod とワークロードの数 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes のイベント** | 警告、エラー、スケジューリングのイベント |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod のログ** | 各ノードで読み取る、すべてのコンテナーの stdout/stderr |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **アプリケーショントレース** *(eBPF)* | すべての Pod からの HTTP、gRPC、SQL/Redis のスパン。SDK もコード変更も不要 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **リクエストのメトリクスとサービスグラフ** *(eBPF)* | サービスごとのリクエスト率、エラー、レイテンシーと、サービスマップ用の呼び出し元 → 呼び出し先のエッジ |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **ネットワークフロー** *(eBPF)* | Pod 間の TCP/UDP のバイト数とパケット数のカウンター |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **ワークロードのコスト** *(オプトイン、`cost.enabled=true`)* | 名前空間、ワークロード、Pod ごとの支出と、アイドル容量および効率 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **ワークロードのコスト** *(既定でオン)* | 名前空間、ワークロード、Pod ごとの支出と、アイドル容量および効率。アラートを設定できるメトリクスとしても提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "クラスターが `hostPath` ボリュームか特権 Pod をブロックしています。**GKE Autopilot** と **EKS Fargate** ではこれが普通です。このガイドの上部でそのプラットフォームを選び、手順に従ってください。一方 **OpenShift** ではインストール自体は成功しますが、エージェントのノード Pod が起動しません。**Red Hat OpenShift** を選んでください。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "制限の厳しい Pod Security ポリシーを持つほかのクラスターでは、失敗したリリースを削除します:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "その後、`--set preset=gke-autopilot` を付けてインストールコマンドをもう一度実行します。このプリセットは hostPath の代わりに Kubernetes API を通じて Pod のログを読み、強化されたセキュリティコンテキストを適用し、特権が必要な eBPF とプロファイリングの Pod を含めません。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. エージェントの Pod が動いていることを確認します: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. コレクターのログを確認します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. インストールコマンドの OneUptime の URL と取り込みキーが正しいことを確認します。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. クラスターからネットワーク経由で OneUptime インスタンスに到達できることを確認します。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI エージェントの Pod を確認します: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. そのログを確認します: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Pod がありませんか？ chart をアップグレードし (「詳細」の **エージェントをアップグレードまたはアンインストール** を参照)、`--set aiAgent.enabled=true` を追加してください。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. クラスター名が一致していることを確認します。このガイドがインストールするのは **`my-cluster`** です。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. エージェントの RBAC 権限を確認します: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. コレクターのログでエクスポートのエラーを探します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **カーネルが古いか BTF がない。** eBPF には BTF 付きの Linux 5.8+ が必要です。ノードで `uname -r` を実行して確認してください。アップグレードできない場合は、`--set ebpf.enabled=false` で eBPF をオフにします。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特権 Pod がブロックされている。** 制限の厳しいクラスターの中には特権 Pod を拒否するものがあります。eBPF をオフにしてください。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **ホストで `debugfs` / `tracefs` が使えない。** TCP 統計のファミリーだけをオフにします: `--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. eBPF の Pod が正常であることを確認します: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. OBI のデバッグ出力をオンにして、トラフィックが見えていることを確かめます: `--set ebpf.printTraces=true --set ebpf.logLevel=debug` を設定し、`kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` を読みます。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. スパンがそこには出るのに OneUptime に出ない場合は、コレクターのログでエクスポートのエラーを確認します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "これは **`k8s-1`** 用のエージェントをインストールします。`clusterName` は正確にそのままにしてください。変えると、データは新しいクラスターとして登録されます。",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "クラスターのアカウントにサインインした AWS CLI (`aws`)",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "`gke-gcloud-auth-plugin` コンポーネント付きの Google Cloud CLI (`gcloud`)",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "クラスターのサブスクリプションにサインインした Azure CLI (`az`)",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 以降と、cluster-admin 権限でログインした OpenShift CLI (`oc`)。インストールでセキュリティコンテキスト制約が作成されます",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Web コンソールにトークン付きの正確なコマンドが表示されます。ユーザー名の下にある **Copy login command** です。クラスター管理者としてログインしてください。インストールでセキュリティコンテキスト制約が作成されます。",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` は、ノードコレクター用と eBPF の Pod 用に 2 つのセキュリティコンテキスト制約 (SCC) を作成し、それぞれ専用のサービスアカウントだけが使います。ほかのすべての Pod は、OpenShift の既定である `restricted-v2` の下で、OpenShift が割り当てるユーザー ID で動作します。",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "コレクターと Kubernetes AI エージェント、さらに各ノードに `-logs` と `-ebpf` の Pod が 1 つずつ。`-logs` と `-ebpf` の Pod は、chart がそれら用に作成した SCC の下で動作します。`kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` で両方が表示されます。これらが `Running` になると、クラスターは **Kubernetes** セクションに自動で表示されます。通常は 1、2 分です。",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift は、サービスアカウントが使えるセキュリティコンテキスト制約 (SCC) の下でしか Pod を受け入れません。リリースはどちらにしてもインストールされるため、拒否された Pod はただ表示されないだけです。拒否の記録を探してください:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** リリースが openshift プリセットなしでインストールされたため、chart は SCC を作成していません。`helm get values kubernetes-agent --namespace oneuptime-agent` で、リリースに渡された値を確認できます。プリセットを追加してください:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC がない:** `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` で確認します。SCC の作成には cluster-admin 権限が必要なため、ほかの人が実行したインストールはそこで失敗します。",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** 名前空間の Pod Security レベルが、特権で動作する eBPF の Pod に必要なレベルより厳しくなっています。名前空間に `pod-security.kubernetes.io/enforce=privileged` ラベルを付けるか、`--set ebpf.enabled=false` で eBPF をオフにしてください。",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **クラスター管理者が SCC を追加しない:** `openshift-restricted` プリセットを使います。その場合 chart は SCC を作成せず、すべての Pod が `restricted-v2` の下で動作するため、Pod のログは Kubernetes API を通じて届き、ホストのメトリクス、eBPF のトレース、プロファイルはありません:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` は、各ノードで読む代わりに Kubernetes API を通じて Pod のログを収集し、GKE Autopilot が許可しない特権 Pod を必要とする eBPF のトレースとプロファイリングを含めません。",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "コレクター、Kubernetes AI エージェント、Pod のログリーダーに加え、kubelet のメトリクス用にノードごとに 1 つのノードコレクター。これらが `Running` になると、クラスターは **Kubernetes** セクションに自動で表示されます。通常は 1、2 分です。",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "ほかのクラスターでは、エージェントは各ノードで [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) を実行し、コードを変更せずに HTTP、gRPC、SQL のトレースを捕捉します。eBPF プログラムの読み込みには特権 Pod が必要ですが、このプラットフォームでは許可されないため、プラットフォームのプリセットはそれを含めず、継続的プロファイラーも含めません。",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "ここでトレースを取得するには、[OpenTelemetry SDK](/docs/telemetry/open-telemetry) でサービスを計装し、OneUptime に直接送信してください。",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Pod のログ** | Kubernetes API を通じて読み取る、すべてのコンテナーの stdout/stderr |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot は hostPath をブロックするため、ホストの `/proc` と `/sys` を読むノードのメトリクス (ディスク I/O、inode、NIC のエラー) は収集されません。kubelet と cAdvisor のメトリクスは収集されます。",
  "Pod logs are read through the Kubernetes API on this platform.":
    "このプラットフォームでは、Pod のログは Kubernetes API を通じて読み取ります。",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. ログリーダーの準備ができていることを確認します: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. その `/healthz` エンドポイントは、アクティブなログストリームの数と最後のエクスポートエラーを報告します。",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. 非常に大きなクラスターでは、1 つのリーダーが追いつかなくなることがあります。`namespaceFilters` で名前空間を別々のリリースに分けてください。",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "クラスターのアカウントにサインインした AWS CLI (`aws`) と `eksctl`",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Fargate では、Fargate プロファイルが選択する名前空間でしか Pod が動きません。`oneuptime-agent` 用に 1 つ作成してください。ないと、エージェントの Pod は `Pending` のままになります:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` は、各ノードで読む代わりに Kubernetes API を通じて Pod のログを収集し、EKS Fargate が許可しない特権 Pod を必要とする eBPF のトレースとプロファイリングを含めません。",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "3 つの Deployment: コレクター、Kubernetes AI エージェント、Pod のログリーダー。Fargate は DaemonSet をスケジュールしないため、ノードごとの Pod はありません。これらが `Running` になると、クラスターは **Kubernetes** セクションに自動で表示されます。通常は 1、2 分です。",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "その後、Fargate プロファイルを削除します: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`。",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate は DaemonSet をスケジュールしないため、そこではノード、Pod、コンテナーのメトリクスは使えません。",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate は、Fargate プロファイルが選択する名前空間にしか Pod をスケジュールしません。`oneuptime-agent` 用のプロファイルがあることを確認します:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "ない場合は作成します。Fargate は Pod の作成時に選ばれるため、すでに保留中だった Pod は保留中のままです。プロファイルが有効になったら、エージェントの Deployment を再起動してください:",
};

export default TRANSLATION;
