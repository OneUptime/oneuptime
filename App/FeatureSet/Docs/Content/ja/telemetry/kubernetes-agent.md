# OneUptime Kubernetes エージェント (Helm)

## 概要

OneUptime Kubernetes エージェントは、OpenTelemetry ベースのコレクターパイプラインをクラスターにインストールする、事前パッケージ化された Helm チャートです。ノード、Pod、コンテナ、クラスターのメトリクス、Kubernetes イベント、Pod ログを送信し、さらにデフォルトで有効な eBPF により、アプリケーショントレース、HTTP RED メトリクス、サービスグラフのデータ、Pod 間のネットワークフローメトリクスも送信します。コードの変更も SDK も不要で、`helm install` 一回だけで済みます。

このページは **インストールガイド** です。エージェントが収集するデータの上に Kubernetes モニターやアラートを構成する方法については、[Kubernetes エージェント (モニター)](/docs/monitor/kubernetes-agent) を参照してください。

## 前提条件

- 稼働中の Kubernetes クラスター (v1.23 以降)
- クラスターにアクセスできるように構成された `kubectl`
- `helm` v3 がインストールされていること
- **OneUptime API キー** — *Project Settings → API Keys* から作成します

## ステップ 1 — OneUptime Helm リポジトリを追加する

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## ステップ 2 — クラスターに合わせたプリセットを選ぶ

このチャートは、単一のトップレベルオプション `preset` を公開しており、これによって Kubernetes ディストリビューションに適合したデフォルト値が選択されます。ログを hostPath DaemonSet 経由で送信するか Kubernetes API 経由で送信するか、どのセキュリティコンテキストを適用するかなど、本来は手動で調整する必要がある設定を制御します。

| `preset` | 用途 | ログ収集 |
|---|---|---|
| `standard` *(デフォルト)* | セルフマネージドクラスター、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | hostPath 経由で `/var/log/pods` を読み取る DaemonSet (オーバーヘッド最小) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API ログテイラー Deployment (hostPath なし、ホストアクセスなし) |
| `eks-fargate` | **EKS Fargate** | Kubernetes API ログテイラー Deployment (hostPath なし、ホストアクセスなし) |

よく分からない場合は、まず `standard` から始めてください。インストールが `hostPath` に言及した Pod Security エラーで失敗する場合は、`preset=gke-autopilot` (Fargate の場合は `eks-fargate`) で再実行すれば動作します。

## ステップ 3 — Kubernetes エージェントをインストールする

`YOUR_ONEUPTIME_URL`、`YOUR_ONEUPTIME_API_KEY`、およびクラスター名を、お使いの環境の値に置き換えてください。クラスター名は、そのクラスターが OneUptime 上でどのように表示されるかを決めるものです。`prod-us-east-1` のような安定した名前を選んでください。

### 標準クラスター (セルフマネージド、EKS on EC2、GKE Standard、AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## ステップ 4 — インストールを検証する

エージェントの Pod が実行中であることを確認します。

```bash
kubectl get pods -n oneuptime-agent
```

**標準** クラスターでは、メトリクスコレクターの Deployment に加えて、ノードごとに 1 つのログコレクター DaemonSet Pod が表示されます。

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot** または **EKS Fargate** では、代わりに 2 つの Deployment が表示されます (DaemonSet はありません)。

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

エージェントが接続すると、クラスターは OneUptime ダッシュボードの **Kubernetes** セクションに自動的に表示されます。

## 構成オプション

### 名前空間のフィルタリング

デフォルトでは `kube-system` は除外されます。特定の名前空間のみを監視するには次のようにします。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### ログ収集を無効にする

メトリクスとイベントのみが必要で Pod ログが不要な場合は次のようにします。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### 特定のログ収集モードを強制する

上級ユーザーは、`logs.mode` を使ってプリセットの選択を上書きできます。

- `logs.mode=daemonset` — hostPath DaemonSet (オーバーヘッド最小、hostPath が必要)
- `logs.mode=api` — Kubernetes API ログテイラー Deployment (任意のクラスターで動作)
- `logs.mode=disabled` — ログ収集なし

明示的な `logs.mode` は常にプリセットのデフォルトより優先されます。プリセットよりもクラスターの事情を熟知している場合に使用してください。

### コントロールプレーンの監視を有効にする

セルフマネージドクラスター (EKS / GKE / AKS 以外) では、コントロールプレーンのメトリクスを有効にできます。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> マネージド Kubernetes サービス (EKS、GKE、AKS) は通常、コントロールプレーンのメトリクスを公開しません。これはセルフマネージドクラスターでのみ有効にしてください。

### プロジェクトラベルで自動タグ付けする

`oneuptime.label.` というプレフィックスが付いた任意のリソース属性は、プロジェクトの Label に昇格され、このエージェントから出力されるクラスター、サービス、ホストに付与されます。パターン: `oneuptime.label.<dimension>=<value>` は `<dimension>:<value>` という名前のラベルになります。

インストール時に `--set oneuptime.labels.<key>=<value>` でラベルを渡します。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

または、values ファイルに保持します。

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

ラベルは大文字小文字を区別せずに照合されるため、手動で作成済みの既存の `Production` ラベルは複製されずに再利用されます。OneUptime UI で手動追加されたラベルが、エージェントによって削除されることはありません。

## エージェントのアップグレード

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` は既存の構成 (プリセット、クラスター名、フィルター) を保持します。新しい `--set` の上書きはその上に渡してください。

## エージェントのアンインストール

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## 収集される内容

| カテゴリ | データ |
|----------|------|
| **ノードメトリクス** | CPU 使用率、メモリ使用量、ファイルシステム使用量、ネットワーク I/O |
| **Pod メトリクス** | CPU 使用量、メモリ使用量、ネットワーク I/O、再起動回数 |
| **コンテナメトリクス** | コンテナごとの CPU 使用量、メモリ使用量 |
| **クラスターメトリクス** | ノードの状態、割り当て可能リソース、Pod 数 |
| **Kubernetes イベント** | 警告、エラー、スケジューリングイベント |
| **Pod ログ** | すべてのコンテナからの stdout/stderr ログ (標準クラスターでは hostPath DaemonSet 経由、Autopilot / Fargate では Kubernetes API 経由) |
| **アプリケーショントレース** *(eBPF 経由、デフォルトで有効)* | すべての Pod からの HTTP、gRPC、SQL/Redis スパン — SDK もコード変更も不要 |
| **HTTP RED メトリクス** *(eBPF 経由)* | `http.server.request.duration`、リクエストおよびレスポンスのボディサイズ (サービスごと) |
| **サービスグラフ** *(eBPF 経由)* | 呼び出し元 → 呼び出し先のリクエストレート、レイテンシ、エラーのエッジ — サービスマップビューを駆動 |
| **ネットワークフローメトリクス** *(eBPF 経由)* | k8s メタデータ付きの Pod 間 TCP/UDP のバイトおよびパケットカウンター |
| **TCP 統計** *(eBPF 経由)* | ノードレベルの RTT、接続失敗、再送信のカウンター |

## eBPF によるアプリケーショントレースと HTTP メトリクス (デフォルトで有効)

このチャートは、すべてのノードで [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) を実行する DaemonSet を稼働させます。eBPF プログラムをカーネルにロードし、サポートされているすべてのランタイム (Go、.NET、Java、Node.js、Python、Ruby、Rust) からの HTTP/HTTPS、gRPC、SQL/Redis トラフィックを自動キャプチャします — SDK もサイドカーも不要です。トレースとリクエストメトリクスは、その後クラスター内のコレクターを通じて OneUptime に流れます。

**要件:** BTF を備えた Linux カーネル **5.8 以降** (Debian 11 以降、Ubuntu 20.10 以降、Fedora 34 以降、RHEL/Stream 9 以降ではデフォルト)。eBPF DaemonSet は、eBPF プログラムをロードするために必要なため、**特権モード** で実行されます。

### eBPF 自動計装を無効にする

次の場合は無効にすべきです。

- **GKE Autopilot** または **EKS Fargate** にインストールする場合 — これらのプラットフォームは特権 Pod をブロックします (`preset=gke-autopilot` / `preset=eks-fargate` を使用し、`ebpf.enabled=false` と組み合わせます)。
- ノードが BTF バックポートのない 5.8 より古いカーネルを実行している場合。
- すでにアプリから OpenTelemetry SDK 経由でトレースを送信していて、重複を望まない場合。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### 個々のシグナルファミリーを切り替える

すべてデフォルトで有効です。`--set ebpf.features.<name>=false` で任意のものを無効にできます。

| `ebpf.features.*` | デフォルト | 追加される内容 |
|---|---|---|
| `httpMetrics` | 有効 | サービスごとの HTTP/gRPC RED メトリクス (リクエストレート、レイテンシ、エラー) |
| `spanMetrics` | 有効 | スパンごとのリクエスト/レスポンスサイズと所要時間 |
| `serviceGraph` | 有効 | 呼び出し元 → 呼び出し先のエッジメトリクス。サービスマップを駆動 |
| `hostMetrics` | 有効 | 計装されたプロセスごとの CPU とメモリ |
| `networkMetrics` | 有効 | Pod 間の TCP/UDP フローカウンター |
| `networkInterZoneMetrics` | 無効 | ネットワークメトリクスのゾーン間バリアント (カーディナリティが倍増) |
| `tcpStats` | 有効 | ノードレベルの TCP RTT、接続失敗、再送信のカウンター |

サービス間のトレースコンテキスト伝播もデフォルトで有効です — OBI は送信される HTTP/TCP に W3C `traceparent` を注入するため、Pod A → Pod B をまたぐリクエストが単一のトレースとして表示されます。どこにも SDK の変更は不要です。`--set ebpf.contextPropagation=false` で無効にできます。

## トラブルシューティング

> **最速の方法 — 診断スクリプトを実行する。** これは Pod のヘルスを検査し、取り込みキーをデコードして検証し、クラスターが OneUptime に到達できるか確認し、さらにトークンが実際に受け入れられるかどうかを OneUptime に問い合わせます — そして単一の根本原因の判定結果を出力します。
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> これはクラスターの状態を読み取り、いくつかのプローブを実行するだけで、何も変更しません。最も正確な送信 (egress) テストを行うには、まず `--set debug.enabled=true` を付けてインストールし (これによりエージェント Pod に小さなネットワークツールのサイドカーが追加され、スクリプトがコレクターの正確な送信経路をテストできるようになります)、その後に再実行してください。

### インストールが "hostPath volumes are not allowed" または Pod Security アドミッションエラーで失敗する

クラスターが `hostPath` をブロックしています — **GKE Autopilot** や **EKS Fargate** でよく見られます。API モードのプリセットに切り替えてください。

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### エージェントが "Disconnected" と表示される

クラスターの接続ステータスは、純粋にテレメトリの到着によって決まります。データが届かない場合、約 15 分後にクラスターは切断済みとマークされます。したがって、"disconnected" と "no metrics" はほぼ常に **同じ** 原因です。つまり、エージェントのテレメトリが受け入れられていないのです。

最も一般的な理由は — 特に再インストール後では — **誤ったまたは失効した取り込みキー** です。OTLP 取り込みエンドポイントは、不正なトークンに対しても意図的に HTTP `200` を返すため (誤設定されたコレクターがサーバーに対してリトライストームを起こせないように)、これは見落とされがちです。その結果、コレクターは成功を報告し、そのログにはエラーが表示されず、データは静かに破棄されます。

1. エージェントの Pod が実行中であることを確認します: `kubectl get pods -n oneuptime-agent`
2. メトリクスコレクターのログを確認します: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (ここにエラーがないことは、データが届いていることを **意味しません** — 上記を参照)
3. **取り込みキーを検証します。** トークンが受け入れられるかどうかを OneUptime に直接問い合わせます (`200` = 有効、`401` = 不明/失効):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   `401` が返される場合、リリース内のキーが誤っているか失効しています。*Project Settings → Telemetry Ingestion Keys* から有効なキーをコピーして再デプロイしてください。

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. OneUptime URL が正しく、クラスターがネットワーク経由でそこに到達できることを確認します。
5. 再インストール時に `clusterName` を変更した場合、エージェントは **新しい** クラスターとして表示されます — 古いエントリは "Disconnected" のままになります (これは想定どおりで、古くなったものです)。

### ログが表示されない (API モードのみ)

1. ログテイラー Pod が Ready であることを確認します: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. その `/healthz` を確認します — アクティブなストリーム数と最後のエクスポートエラーを報告します
3. ログを確認します: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. 非常に大規模なクラスターでは、単一のレプリカがボトルネックになる場合があります — 別々のリリースで `namespaceFilters.include` を使い、名前空間ごとにシャーディングしてください

### メトリクスが表示されない

1. まず取り込みキーの拒否を除外します — これは最も一般的な原因であり、エージェント側からは見えません。上記の [エージェントが "Disconnected" と表示される](#agent-shows-disconnected) を参照してください (または単に診断スクリプトを実行してください)。
2. クラスター識別子が `clusterName` として渡した値と一致することを確認します
3. RBAC 権限を検証します: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. OTel コレクターのログにエクスポートエラーがないか確認します

### eBPF Pod が CrashLoopBackOff になるか起動に失敗する

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

一般的な原因:

- **カーネルが古すぎる、または BTF がない。** OBI には BTF を備えた Linux 5.8 以降が必要です。ノードで `uname -r` を実行してください。アップグレードできない場合は、eBPF を無効にします: `--set ebpf.enabled=false`。
- **特権 Pod がブロックされている。** 一部のクラスターは特権 Pod を拒否します (GKE Autopilot、EKS Fargate、およびロックダウンされた環境)。eBPF を無効にしてください。
- **`debugfs` / `tracefs` がホストにマウントされていない。** `tcpStats` 機能は、それらを必要とするカーネルトレースポイントにアタッチします。このチャートは両方を `hostPath` 経由でマウントしますが、ホストがそれらを公開していない場合は、そのファミリーだけを無効にしてください: `--set ebpf.features.tcpStats=false`。

### アプリケーショントレースが表示されない

1. eBPF DaemonSet が正常であることを確認します: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. デバッグ用トレースプリンターを有効にして、OBI がトラフィックをキャプチャしていることを確認します: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`、その後 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` を確認します
3. OBI の stdout にスパンが表示されるのにダッシュボードに表示されない場合、問題はコレクター → OneUptime のエクスポートにあります — メトリクスコレクター Pod のログを確認してください。

## 次のステップ

- このエージェントが収集するメトリクスの上に **Kubernetes モニター** を構成します — [Kubernetes エージェント (モニター)](/docs/monitor/kubernetes-agent) を参照してください。
- 特定のログパターン (たとえば、Pod ごとまたは名前空間ごとのしきい値を超えるエラー数) でアラートを出すために、**ログモニター** を追加します。
- Kubernetes 以外のホスト (Linux / macOS / Windows の VM やベアメタル) には、[Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) のページを使用してください。
