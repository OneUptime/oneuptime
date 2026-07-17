# OneUptime Kubernetes エージェント (Helm)

## 概要

OneUptime Kubernetes エージェントは、OpenTelemetry ベースのコレクターパイプラインをクラスターにインストールする、事前パッケージ化された Helm チャートです。ノード、Pod、コンテナ、クラスターのメトリクス、Kubernetes イベント、Pod ログを送信し、さらにデフォルトで有効な eBPF により、アプリケーショントレース、HTTP RED メトリクス、サービスグラフのデータ、Pod 間のネットワークフローメトリクスも送信します。コードの変更も SDK も不要で、`helm install` 一回だけで済みます。

このページは **インストールガイド** です。エージェントが収集するデータの上に Kubernetes モニターやアラートを構成する方法については、[Kubernetes エージェント (モニター)](/docs/monitor/kubernetes-agent) を参照してください。

## 前提条件

- 稼働中の Kubernetes クラスター (v1.23 以降)
- クラスターにアクセスできるように構成された `kubectl`
- `helm` v3 がインストールされていること
- **OneUptime API キー** — _Project Settings → API Keys_ から作成します

## ステップ 1 — OneUptime Helm リポジトリを追加する

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## ステップ 2 — クラスターに合わせたプリセットを選ぶ

このチャートは、単一のトップレベルオプション `preset` を公開しており、これによって Kubernetes ディストリビューションに適合したデフォルト値が選択されます。ログを hostPath DaemonSet 経由で送信するか Kubernetes API 経由で送信するか、どのセキュリティコンテキストを適用するかなど、本来は手動で調整する必要がある設定を制御します。

| `preset`                  | 用途                                                                                       | ログ収集                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `standard` _(デフォルト)_ | セルフマネージドクラスター、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | hostPath 経由で `/var/log/pods` を読み取る DaemonSet (オーバーヘッド最小)  |
| `gke-autopilot`           | **GKE Autopilot**                                                                          | Kubernetes API ログテイラー Deployment (hostPath なし、ホストアクセスなし) |
| `eks-fargate`             | **EKS Fargate**                                                                            | Kubernetes API ログテイラー Deployment (hostPath なし、ホストアクセスなし) |

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

**標準** クラスターでは、クラスターコレクターの Deployment に加えて、ノードごとに 1 つのノードコレクター DaemonSet Pod が表示されます。

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot** では、ノードコレクターは引き続き実行されます — hostPath を必要とせずに kubelet と cAdvisor のメトリクスを収集します — さらに、Kubernetes API 経由で Pod ログを収集する Deployment が追加で表示されます。

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

**EKS Fargate** では、2 つの Deployment が表示され、DaemonSet はありません — Fargate は Pod ごとに専用のマイクロ VM を割り当て、DaemonSet を一切スケジュールしないため、そこではノードレベルのメトリクスを利用できません。

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

エージェントが接続すると、クラスターは OneUptime ダッシュボードの **Kubernetes** セクションに自動的に表示されます。

## 構成オプション

### 名前空間のフィルタリング

`namespaceFilters` は、**Pod ログ** (hostPath DaemonSet と API ログテイラーの両方) と **eBPF トレース** を、選択した名前空間にスコープします。デフォルトでは `kube-system` は除外されます。これらのシグナルを特定の名前空間に制限するには次のようにします。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

ノイズの多い名前空間を 1 つだけ無視し、それ以外のすべてを保持したい場合は、代わりに `exclude` を使用します。`exclude` は常に `include` より優先されます。また、同梱のデフォルト値は `[kube-system]` なので、引き続き除外したい場合は改めてリストに記載してください。

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

**Pod ログと eBPF トレースについては、これにコストは一切かかりません**。名前空間は Pod ログのパスと OBI のプロセス検出の一部であるため、フィルターで除外された名前空間はそもそも読み取られません — CPU も送信 (egress) も消費しません。

#### 名前空間フィルターをメトリクスとトレースに適用する

デフォルトでは、上記のリストは Pod ログと eBPF トレースのみを対象とします。`applyTo` はこれらを他のシグナルにも拡張します。

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| 設定              | 対象となる範囲                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `applyTo.metrics` | kubeletstats、cAdvisor、kube-state-metrics からの Pod ごと / コンテナごとのメトリクス      |
| `applyTo.traces`  | アプリケーションがエージェントの OTLP エンドポイントに送信するスパン (eBPF のスパンはすでにスコープ済み) |

どちらも意図的に **デフォルトで無効** です。`exclude: [kube-system]` がデフォルトとして同梱されているため、これらを自動的に有効にすると、既存のすべてのインストールにおいてアップグレード時に kube-system のメトリクスが黙って削除されてしまいます。

> **ノードレベルおよびクラスターレベルのメトリクスは常に保持されます。** 名前空間はノードではなく Pod の属性であるため、ノード CPU、ノードメモリ、ファイルシステム使用量といったシリーズには照合する対象がなく、破棄されることはありません。`applyTo.metrics` は、ノードの不調を見逃す事態を招くことなく、Pod ごとのカーディナリティを削減します。

Kubernetes の **イベント** は、エージェント側で名前空間によるフィルタリングができません。これらは `k8sobjects` レシーバーから `k8s.namespace.name` 属性なしで到着し — 名前空間はイベントの本文の中にあります — フィルターが照合できる対象がありません。代わりにサーバー側で破棄してください (下記参照)。

### ログの重大度によるフィルタリング

`filters.logs.minSeverity` は、ある重大度を下回る **Pod ログ** のレコードを、何かが送信される前にエージェント側で破棄します。

```bash
  --set filters.logs.minSeverity=WARN
```

`TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR`、`FATAL` を指定できます。`WARN` は WARN、ERROR、FATAL を保持し、INFO、DEBUG、TRACE を破棄します。デフォルト (`""`) はすべてを保持します。これは **両方の** ログモードに適用されます — `daemonset` モードではコレクター経由で、`api` モードではログテイラー自体の内部で — そのため、プリセットが知らないうちにこれを無効にしてしまうことはありません。

コンテナランタイムはログ行に重大度を記録しないため、エージェントはログテキスト (`[ERROR]`、`WARN:`、`level=info` など) 自体から重大度を解析します。

> **Kubernetes のイベントとリソース仕様が、これによってフィルタリングされることはありません。** これらは自身の重大度を持たないまま Kubernetes API から到着するため、しきい値を設けるとフィードを間引くのではなくフィード全体を削除してしまいます — 最も必要とされる `FailedScheduling`、`BackOff`、`OOMKilling` の警告も含めてです。これらは低量かつ高価値であるため、エージェントは常に送信します。これらを間引くには、代わりにダッシュボードのサーバー側の **Logs → Settings → Drop Filters** を使用してください。

**認識可能なレベルを持たない行がどうなるかは、ログモードによって異なります**。2 つのモードで利用できる情報が異なるためです。

| モード      | ラベルのない行                                                                                   | 理由                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `daemonset` | `stderr` → ERROR として扱われる (保持)、`stdout` → INFO として扱われる (WARN のしきい値では破棄) | コンテナランタイムが、各行がどちらのストリームから来たかを記録しています。                                                                |
| `api`       | 常に **保持**                                                                                    | Kubernetes の `pods/log` API は、stdout と stderr を行ごとの目印がない単一のストリームにマージします。エージェントは推測せず、行を保持します。 |

> そのため、`api` モードは `daemonset` モードよりも破棄する量が厳密に少なくなります。これは意図的なものです。Python のトレースバックや `npm ERR!` には重大度のキーワードが含まれておらず、それを黙って削除することは、まさに重大度のしきい値が防ぐべき失敗だからです。

複数行のイベントは、どちらのモードでもフィルタリングの **前に** 再結合されるため、Java のスタックトレースは最初の行で判定され、まるごと保持または破棄されます — フレームが剥ぎ取られた裸の `ERROR` 行だけが残ることはありません。

### 名前によるメトリクスの包含または除外

`filters.metrics` は、パイプライン内のすべてのレシーバーを横断して、どのメトリクスがクラスターから出ていくかを制御します。

**ノイズの多いメトリクスをいくつか破棄する** (拒否リスト — 通常はこちらが望ましい):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**決まったセットのみを送信する** (許可リスト — それ以外はすべて破棄されます):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**正確な名前ではなくパターンで照合する**:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| キー                        | 意味                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `filters.metrics.exclude`   | 破棄するメトリクス名。`include` の上に適用されるため、exclude が常に優先されます。 |
| `filters.metrics.include`   | 空でない場合、**これらのみ** が送信されます。                                  |
| `filters.metrics.matchType` | `strict` (正確な名前、デフォルト) または `regexp` (RE2、**アンカーなし**)。    |

インシデントを未然に防ぐための注意点:

- `regexp` は **アンカーされません** — `system.cpu` は `system.cpu.time` にも一致します。厳密に 1 つのメトリクスを指す場合はアンカーしてください (`^system\.cpu$`)。
- RE2 には **先読みがない** ため、`^(?!container_)` はコンパイルできません。「〜以外のすべて」は、否定の正規表現ではなく `include` で表現してください。
- `include` はすべてのレシーバーに一度に適用されます。メトリクスを 1 つ書き忘れた許可リストは、その上に構築されたモニターを黙って取り除いてしまいます。本当に閉じたセットが必要な場合を除き、`exclude` を優先してください。
- リストには `--set-json` (または values ファイル) を使用してください。素の `--set` はリストをマージせずに置き換えます。

> **正規表現は、ロールアウトする前にテストしてください。** パターンはレコードごとではなくコレクターの起動時にコンパイルされるため、不正なパターンが静かに誤動作することはありません — コレクターが起動を拒否して CrashLoopBackOff に陥り、そのコレクターのメトリクスだけでなく **ログ** も道連れに停止します。Helm は RE2 をコンパイルできないため、`helm upgrade` は不正なパターンを何の文句も言わずに受け入れてしまいます。

### トレースのサンプリング

このページにある他のつまみは、テレメトリの **カテゴリ** を丸ごと削除します — 名前空間、重大度、メトリクス名などです。サンプリングは異なります。すべてのカテゴリを維持したまま、母集団のほうを間引きます。保持したいトレースの割合を `sampling.traces.percentage` に設定します。

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

これで 10 本に 1 本のトレースが保持され、残りの 9 本はクラスターから出ていく前にエージェント側で破棄されます。

**得られるのは断片ではなく、トレース全体です。** 判定はスパンごとのコイン投げではなくトレース ID のハッシュで行われるため、1 つのトレースのすべてのスパンはまとめて保持されるか、まとめて破棄されます — 残ったトレースは完全であり、端から端まで読み取れます。サンプリングを安心して有効にできるのは、この性質があるからです。

**メトリクスベースのモニターは変わりません。** eBPF の RED メトリクス — リクエストレート、エラーレート、所要時間 — は *メトリクス* のファミリーです。OBI はすべてのリクエストからこれらを計算し、これらはメトリクスのパイプラインを通りますが、サンプラーはそこには存在しません。`percentage: 10` では、トレースは 10 分の 1 になりますが、レート / エラー / レイテンシは 100% 正確なままです。それらのメトリクスの上に構築されたダッシュボードとモニターは影響を受けません。

**スパンベースのモニターは変わります。** OneUptime がスパンそのものから導出しているものは、すべてこのレートに応じて縮小します — 有効にする前に、下記の警告を参照してください。

| キー                         | 意味                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `sampling.traces.percentage` | **保持する** トレースの割合 (0-100)。デフォルトは `100` (すべて保持)。 |
| `sampling.traces.hashSeed`   | トレース ID のハッシュに使うシード。デフォルトは `22`。               |

インシデントを未然に防ぐための注意点:

- **`0` はトレースを 1 本も保持しません。** これはオフスイッチではなくレートです — eBPF DaemonSet は動き続けてコストを消費したまま、すべてのトレースを削除します。トレースが不要な場合は `ebpf.enabled=false` を使用してください。トレースは不要でも RED メトリクスとサービスマップは *必要* な場合は、eBPF を有効のままにして、意図的にこれを `0` に設定します。
- **`ebpf.enabled` の場合にのみ適用されます。** それ以外ではトレースのパイプラインがそもそも存在しないため、`ebpf.enabled=false` ではこの値は何もしません。
- **トレース専用です。** `sampling.logs` も `sampling.metrics` も存在せず、それは意図的なものです — 下記の注記を参照してください。
- **小数には `--set-json` が必要で、さらに下限があります。** Helm は `0.5` を文字列として読み取るため、`--set sampling.traces.percentage=0.5` は失敗します。`--set-json 'sampling.traces.percentage=0.5'` または values ファイルを使用してください。整数であれば `--set` で問題なく動作します。およそ `0.0061` を下回ると、レートはゼロに量子化され、`0` とまったく同じ挙動になります — すべてのトレースが破棄され、エラーも出ません。書かれたとおりに動作する最小の値は `0.01` (1 万本に 1 本) です。
- **マルチクラスターはデフォルトで機能します。** 2 つのエージェントが同じトレースを保持するのは、`hashSeed` と `percentage` の両方が一致している場合だけです。どちらもどこでも同じ値がデフォルトなので、2 つのクラスターをまたぐトレースは追加の設定なしで丸ごと残ります。`hashSeed` を変更するのは、2 つのサンプリング階層を意図的に *相関から切り離す* 場合だけにしてください — 判定は同じハッシュに対するしきい値なので、同じシードでレートだけを変えると入れ子になり、2 番目の階層は独立に抽出するのではなく、1 番目がすでに保持したトレースを選び直すだけになります。
- **Pod ログはサンプリングされません。** そのため `ebpf.logToTraceCorrelation: true` では、すべてのログレコードが引き続きトレース ID を保持する一方で、それらのトレースのうち保持されるのは `percentage`% だけです。ログレコードのおおよそ (100 − `percentage`)% は、行き止まりになるトレースリンクを表示することになります。トレース → ログのナビゲーションは影響を受けません。取りこぼしが起きうるのは、ログ → トレースの方向だけです。

> **これを設定したら、スパンベースのモニターを調整し直してください。** サンプリングは OneUptime に届くスパンを減らすため、それを数えているものはすべて数え落とします。`Span Count` を条件とする **Traces** モニターと、`Exception Count` を条件とする **Exceptions** モニターは、昨日までのおおよそ `percentage`% の量しか見なくなります。サンプリングなしのトラフィックに合わせて調整されたしきい値は、静かに超えられなくなります — モニターはエラーにはならず、ただ沈黙します。レートを設定するときは、それらのしきい値を同じ割合で割ってください。このレートはクラスター全体に適用されるため、個々のサービスだけを対象外にする方法はありません。エラーの **グルーピング** は、線形よりも悪く劣化します。よくある例外は引き続き浮かび上がりますが、稀な単発の例外は、出現頻度が 10 分の 1 になるというより、まるごと消えてしまう可能性のほうが高くなります。

> **ここにログやメトリクスのサンプリングがない理由。** コレクターのサンプラーは、メトリクスをまったくサンプリングできません。ログはサンプリングできますが、そのランダム性をトレース ID から引き出しています — そして Pod ログにはトレース ID がありません。トレース ID を持たないレコードはすべて同じバケットにハッシュされるため、ログにレートを設定してもフィードは間引かれません。シードに応じて、すべてを保持するか、すべてを削除するかのどちらかになってしまいます。ログを黙って削除してしまうつまみを提供するくらいならと、このチャートはそれを用意していません。ログを間引くには、削除する対象が正確な [ログの重大度によるフィルタリング](#ログの重大度によるフィルタリング) と [名前空間のフィルタリング](#名前空間のフィルタリング) を使用してください。

### ログ収集を無効にする

Pod ログが不要な場合は次のようにします。

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

メトリクスには影響しません。ノードコレクターは kubelet、cAdvisor、ホストのメトリクスのために引き続き実行され、Pod ログの読み取りを停止するだけです。ログベースのアラートは止まりますが、それ以外は何も止まりません。

### 特定のログ収集モードを強制する

上級ユーザーは、`logs.mode` を使ってプリセットの選択を上書きできます。

- `logs.mode=daemonset` — hostPath DaemonSet (オーバーヘッド最小、hostPath が必要)
- `logs.mode=api` — Kubernetes API ログテイラー Deployment (任意のクラスターで動作)
- `logs.mode=disabled` — ログ収集なし

> ログモードは、**Pod ログ** をどこから取得するかを決めるだけです。ノードメトリクスはそれとは独立して収集されるため、`api` と `disabled` でも kubelet、cAdvisor、ホストのメトリクスは維持されます。
>
> 唯一の例外はモードではなくプラットフォームです。**EKS Fargate はそもそも DaemonSet をスケジュールできない** ため、そこにはノードコレクターが存在せず、ノード / Pod / コンテナのメトリクスを利用できません。GKE Autopilot はノードコレクターを問題なく実行しますが、`hostPath` をブロックするため、ホストの `/proc` と `/sys` の読み取りを必要とする `hostmetrics` のメトリクス (ディスク I/O、inode、NIC エラー) を除いて、kubelet と cAdvisor のメトリクスを収集します。

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

| カテゴリ                                                     | データ                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **ノードメトリクス**                                         | CPU 使用率、メモリ使用量、ファイルシステム使用量、ネットワーク I/O                                                                   |
| **Pod メトリクス**                                           | CPU 使用量、メモリ使用量、ネットワーク I/O、再起動回数                                                                               |
| **コンテナメトリクス**                                       | コンテナごとの CPU 使用量、メモリ使用量                                                                                              |
| **クラスターメトリクス**                                     | ノードの状態、割り当て可能リソース、Pod 数                                                                                           |
| **Kubernetes イベント**                                      | 警告、エラー、スケジューリングイベント                                                                                               |
| **Pod ログ**                                                 | すべてのコンテナからの stdout/stderr ログ (標準クラスターでは hostPath DaemonSet 経由、Autopilot / Fargate では Kubernetes API 経由) |
| **アプリケーショントレース** _(eBPF 経由、デフォルトで有効)_ | すべての Pod からの HTTP、gRPC、SQL/Redis スパン — SDK もコード変更も不要                                                            |
| **HTTP RED メトリクス** _(eBPF 経由)_                        | `http.server.request.duration`、リクエストおよびレスポンスのボディサイズ (サービスごと)                                              |
| **サービスグラフ** _(eBPF 経由)_                             | 呼び出し元 → 呼び出し先のリクエストレート、レイテンシ、エラーのエッジ — サービスマップビューを駆動                                   |
| **ネットワークフローメトリクス** _(eBPF 経由)_               | k8s メタデータ付きの Pod 間 TCP/UDP のバイトおよびパケットカウンター                                                                 |
| **TCP 統計** _(eBPF 経由)_                                   | ノードレベルの RTT、接続失敗、再送信のカウンター                                                                                     |

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

| `ebpf.features.*`         | デフォルト | 追加される内容                                                                 |
| ------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `httpMetrics`             | 有効       | サービスごとの HTTP/gRPC RED メトリクス (リクエストレート、レイテンシ、エラー) |
| `spanMetrics`             | 有効       | スパンごとのリクエスト/レスポンスサイズと所要時間                              |
| `serviceGraph`            | 有効       | 呼び出し元 → 呼び出し先のエッジメトリクス。サービスマップを駆動                |
| `hostMetrics`             | 有効       | 計装されたプロセスごとの CPU とメモリ                                          |
| `networkMetrics`          | 有効       | Pod 間の TCP/UDP フローカウンター                                              |
| `networkInterZoneMetrics` | 無効       | ネットワークメトリクスのゾーン間バリアント (カーディナリティが倍増)            |
| `tcpStats`                | 有効       | ノードレベルの TCP RTT、接続失敗、再送信のカウンター                           |

サービス間のトレースコンテキスト伝播もデフォルトで有効です — OBI は送信される HTTP/TCP に W3C `traceparent` を注入するため、Pod A → Pod B をまたぐリクエストが単一のトレースとして表示されます。どこにも SDK の変更は不要です。`--set ebpf.contextPropagation=false` で無効にできます。

## 収集されるデータ量を削減する

エージェントはデフォルトで **カバレッジ** を重視して調整されています — クラスター全体からメトリクス、Pod ログ、eBPF トレースを送信するため、すべてのダッシュボードとモニターが初日から機能します。大規模またはビジー状態のクラスターでは、それが必要以上のテレメトリになる場合があり、取り込み量の増加 (そして OneUptime Cloud ではコストの増加) として現れます。ここに書かれていることは何も必須ではありませんが、クラスターが望む以上に送信している場合は、これらが調整すべきつまみです — おおよそ影響の大きい順に並べています。

コツは、すべてを収集して保存料を支払うのではなく、**見ないものは収集しないようにする** ことです。以下のすべてのレバーは Helm の値なので、`helm upgrade --reuse-values` に対して `--set` で適用でき、同じ方法でロールバックできます。

### データ量の発生源

| シグナル                            | 最大の要因                                                           | 削減に使う値                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod ログ**                        | クラスター全体、すべてのコンテナのすべての行                         | `namespaceFilters`、`filters.logs.minSeverity`、`logs.enabled`、`logs.mode`                  |
| **eBPF トレースとスパンメトリクス** | 計装されたすべてのプロセスの、リクエストごとに 1 つのトレース        | `sampling.traces.percentage`、`ebpf.enabled`、`ebpf.features.*`、`ebpf.autoTargetExe`、`ebpf.excludeExePaths` |
| **メトリクスのデータポイント**      | スクレイプ頻度 × Pod/コンテナの数                                    | `collectionInterval`、`hostMetrics.collectionInterval`、`cadvisor.scrapeInterval`            |
| **メトリクスのカーディナリティ**    | 個別のシリーズの数 (コンテナごと、PVC ごと、…)                       | `filters.metrics.exclude`、`namespaceFilters.applyTo.metrics`、`cadvisor.metricsAllowlist`、`kubeletstats.volumeMetrics` |
| **オプトインの追加機能**            | プロファイリング、監査ログ、コントロールプレーン、ゾーン間メトリクス | 無効のままにする (デフォルトですでに無効です)                                                |

データ量を削減する方法は 3 つあり、自分がどれを使っているのかを知っておく価値があります。

- **レシーバー側** — データがそもそも収集されません。Pod ログに対する `namespaceFilters`、`cadvisor.metricsAllowlist`、より長い `collectionInterval` などです。実行コストはかからず、CPU、送信 (egress)、取り込みをまとめて節約できます。自分のケースに当てはまる場合は、常にこちらを優先してください。
- **filter プロセッサ側** — データは収集された後、エクスポートの前に破棄されます。`filters.logs.minSeverity`、`filters.metrics.*`、`namespaceFilters.applyTo.*` などです。コレクターの CPU をわずかに多く使いますが、複数のレシーバーを横断して機能し、レシーバーでは表現できないことも表現できます。
- **サンプラー側** — データは収集された後、代表的な一部が保持されます。`sampling.traces.percentage` です。これだけ性質が異なります。上記の 2 つはテレメトリの *カテゴリ* を丸ごと削除するため、それらが破棄したものはどのトレースからも失われます。サンプリングはすべてのカテゴリを維持したまま母集団を間引くため、残ったものは依然として完全であり、かつ代表性を保っています。

3 つとも **元に戻せません**。ここで破棄したものが OneUptime に届くことはなく、3 つともモニターを沈黙させうるものです。最初の 2 つは、モニターが監視しているシグナルそのものを取り除くことでモニターを沈黙させます。サンプリングはもっと限定的です。eBPF の RED メトリクスはサンプラーが動作する前に計算されるため、メトリクスベースのモニターは正確なまま保たれます — ただし、*スパン* を数えるモニター (`Span Count` を条件とする **Traces** モニター、`Exception Count` を条件とする **Exceptions** モニター) は比例して少ない数しか見なくなるため、しきい値を同じ割合で調整し直す必要があります。後から判断したい場合は、代わりに OneUptime のサーバー側でデータを破棄できます (**Logs → Settings → Drop Filters**、**Metrics → Settings → Pipeline Rules**) — こちらは送信 (egress) のコストはかかりますが、再デプロイなしで変更できる設定です。

### レバー 1 — 通常、Pod ログが単独で最大の発生源

コンテナログは、クラスター内のすべてのコンテナからのログ行ごとに 1 レコードとなるため、ほぼ常に取り込みの最大の割合を占めます。

- **特定の名前空間のログのみが必要な場合は?** `namespaceFilters` は、両方のログモードで Pod ログ (およびそれに伴う eBPF トレース) をスコープします。照合は Pod ログのパスで行われるため、フィルターで除外された名前空間は読み取られることすらありません — これはこのドキュメントの中で最も低コストなレバーです。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` はデフォルトですでに除外されています。) 1 つを除いてすべての名前空間を保持するには、`--set "namespaceFilters.exclude={kube-system,noisy-namespace}"` を使用します。

- **警告とエラーだけに関心がある場合は?** `filters.logs.minSeverity` が残りをエージェント側で破棄します。おしゃべりなクラスターでは、これが利用可能な削減手段の中で単独で最大になることがよくあります。ほとんどのアプリケーション出力の大半は INFO と DEBUG だからです。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  重大度がどのように判定されるか、また分類できなかったログがどうなるかについては、[ログの重大度によるフィルタリング](#ログの重大度によるフィルタリング) を参照してください。

- **OneUptime で Pod ログがまったく必要ない場合は?** 無効にします。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > これが止めるのは Pod ログだけです。ノード、Pod、コンテナのメトリクスは流れ続け、それらの上に構築されたモニター（OOM kill、CPU スロットリング、PVC のディスク空き容量不足）も動作し続けます。ノードコレクターは残り、`/var/log/pods` の読み取りをやめるだけです。`logs.mode: api` と `logs.mode: disabled` についても同じです。

### レバー 2 — eBPF 自動計装を切り詰める

eBPF は、コード変更なしでトレース、RED メトリクス、サービスマップ、ネットワークフローメトリクスを提供します — しかし、リクエストごとにスパンを、サービスごとに複数のメトリクスファミリーを出力するため、2 番目に大きなデータの発生源でもあります。制御には 3 つのレベルがあります。

- **すでに OTel SDK からトレースを送信している、または自動トレースが不要な場合は?** eBPF を完全に無効にします。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **トレースは維持しつつ、重いメトリクスファミリーを削除します。** [上記のシグナルファミリーの表](#個々のシグナルファミリーを切り替える) に各 `ebpf.features.*` フラグが記載されています。最もデータ量の多いファミリーはネットワークメトリクスとスパンメトリクスです — それらを無効にしても、トレース、HTTP RED メトリクス、サービスマップはそのまま残ります。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  `ebpf.features.networkInterZoneMetrics` は無効のまま (デフォルト) にしてください — ネットワークフローのカーディナリティが倍増します。

- **関心のあるランタイムのみを計装します。** デフォルトでは、OBI は認識するすべてのプロセスにアタッチします (`ebpf.autoTargetExe: "*"`)。特定のランタイムに絞り込むか、バイナリをスキップリストに追加して、エージェントが生成する「サービス」とトレースの数を減らします。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  完全なデフォルト値については、[個々のシグナルファミリーを切り替える](#個々のシグナルファミリーを切り替える) と、チャートの値にある `excludeExePaths` の注記を参照してください。

### レバー 3 — スクレイプ間隔を長くする

メトリクスのデータ量は、エージェントがスクレイプする頻度に正比例します。間隔を 2 倍にすると、そのメトリクスが生成するデータポイントの数はおおよそ半分になり、カバレッジは失われません — 解像度が粗くなるだけです。30 秒の粒度が不要な場合、60s または 120s は大きく安全な削減です。

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (デフォルト `30s`) は、ノード / Pod / コンテナのメトリクス (`kubeletstats`) とクラスター状態のメトリクス (`k8s_cluster`) を駆動します — メトリクスのデータ量の大部分を占めます。
- `hostMetrics.collectionInterval` と `cadvisor.scrapeInterval` は、ノードごとの OS メトリクスとスロットリング / OOM カウンターをカバーします。
- `resourceSpecs.interval` (デフォルト `300s`) は、完全なリソース仕様 (ラベル、アノテーション、ステータス) を取得する頻度を制御します — 仕様の変更を素早く反映する必要がない場合は、値を大きくしてください。
- オプションのスクレイパーのいずれかを有効にしている場合、それらにも独自のつまみがあります: `kubeStateMetrics.scrapeInterval`、`serviceMesh.*.scrapeInterval`、`coreDns.scrapeInterval`、`csi.scrapeInterval`。

### レバー 4 — メトリクスのカーディナリティを抑える

カーディナリティ (個別の時系列の数) は、各シリーズが個別に保存され課金されるため、頻度と同じくらい重要です。

- **cAdvisor は意図的に許可リスト化されています。** cAdvisor レシーバー (デフォルトで有効) は数百のメトリクスを出力できますが、チャートはモニターを支える一握りのメトリクスのみを転送します (`cadvisor.metricsAllowlist`)。リストは絞ったままにしてください — **各エントリはコンテナごとに保持されるため、余分なメトリクスが 1 つあるだけでクラスターのコンテナ数だけ倍増します。** kube-state-metrics はデフォルトで無効ですが、有効にした場合 (`kubeStateMetrics.enabled=true`)、その `kubeStateMetrics.metricsAllowlist` が同じ方法でカーディナリティを制御します。
- **PVC ごとのボリュームメトリクス** (`kubeletstats.volumeMetrics.enabled`、デフォルトで有効) は、Pod ごと・PVC ごとに 1 つのシリーズを出力します。ほとんどのクラスターでは問題ありませんが、数千の PVC を持つステートフルワークロード (Kafka、データベース) ではかなりの量になる可能性があります — PVC のディスク容量を監視していない場合は、そこで無効にしてください。

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **飽和メトリクス** (`kubeletstats.utilizationMetrics.enabled`、デフォルトで有効) は、8 つの派生的な「リクエスト/リミットに対する %」ファミリーを追加します。これらは安価です (追加のスクレイプなし) が、CPU/メモリ対リミットのモニターを使用しない場合は、`--set kubeletstats.utilizationMetrics.enabled=false` で削除できます。

- **名前で特定のメトリクスを破棄します。** 上記の許可リストはレシーバーごとのものですが、`filters.metrics.exclude` はそれらすべてを横断するため、レシーバーレベルのつまみでは表現できないものに使用してください。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  完全一致と正規表現の照合、および許可リスト形式については、[名前によるメトリクスの包含または除外](#名前によるメトリクスの包含または除外) を参照してください。

- **名前空間全体のメトリクスを破棄します。** ある名前空間がノイズが多いものの、そのノードは引き続き監視したい場合、`namespaceFilters.applyTo.metrics=true` は既存の名前空間リストを Pod ごと・コンテナごとのシリーズに適用します。ノードレベルおよびクラスターレベルのシリーズは常に保持されます。

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### レバー 5 — 重いオプトイン機能を無効のままにする

これらは負荷を追加するため、まさに **デフォルトで無効** になっています — それが支える機能を実際に使用する場合にのみ有効にし、単に試しただけの場合は無効に戻してください。

| 値                                                        | 追加される内容                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | 継続的な CPU プロファイリングの DaemonSet — eBPF トレースより重い                            |
| `auditLogs.enabled`                                       | すべての Kubernetes API リクエストをログレコードとして記録 (大量)                            |
| `controlPlane.enabled`                                    | etcd / API サーバー / スケジューラー / コントローラーマネージャーのメトリクス                |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / スケジューリング理由のメトリクス (KSM Deployment とスクレイプを追加) |
| `ebpf.features.networkInterZoneMetrics`                   | ネットワークフローメトリクスのカーディナリティを倍増                                         |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | 追加の Prometheus スクレイプジョブ                                                           |

### レバー 6 — トレースを破棄する代わりにサンプリングする

上記のどのレバーも、何かを手放すことでデータ量を買っています — 監視をやめる名前空間、保持をやめる重大度、収集をやめるメトリクスファミリーなどです。サンプリングはその例外であり、ビジー状態のクラスターでは、失うものが最も少ないまま利用できる最大の削減手段になることがよくあります。

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

これはトレースのデータ量を 90% 削減しますが、失われるものはここにある他のどのレバーよりも狭い範囲にとどまります。

- 保持されるトレースは **完全なもの** です — 判定はトレース ID をハッシュするため、1 つのトレースのすべてのスパンがその判定を共有します。トレースの数は少なくなりますが、壊れたトレースにはなりません。
- **RED メトリクスは正確なまま** です。リクエストレート、エラーレート、所要時間は、OBI がすべてのリクエストから計算し、メトリクスのパイプラインを通ります。サンプラーはそこには存在しません。それらの上に構築されたすべてのダッシュボードとモニターは、以前とまったく同じ値を示します。

手放すことになるのは主に代表例となるトレースです。モニターが発報したときに、開けるトレースは 10 分の 1 になります。1 秒間に何千もの同じリクエストを処理しているクラスターでは、これはたいてい良い取引です — 100 個目の同じ `/healthz` のスパンは、1 個目が教えてくれなかったことを何も教えてくれません。トラフィックの少ないクラスターでは悪い取引です。壊れた稀なリクエストの実例が 1 つも残らないかもしれないためです。

例外があり、ロールアウトする前に確認すべき唯一の点がこれです。メトリクスではなく **スパンを数える** モニター — `Span Count` を条件とする **Traces** モニター、`Exception Count` を条件とする **Exceptions** モニター — は比例して少ない数しか見なくなるため、しきい値を同じ割合で調整し直す必要があります。[トレースのサンプリング](#トレースのサンプリング) を参照してください。

eBPF トレースが取り込みの大きな割合を占めているものの、サービスマップと RED メトリクスは損なわずに残したい場合に、これを使ってください。何かの計装を完全にやめたい場合は、レバー 2 を優先してください。

`0` がオフスイッチではなくレートである理由や、ログとメトリクスに相当するものがない理由を含め、詳しい挙動については [トレースのサンプリング](#トレースのサンプリング) を参照してください。

### 無駄のない出発点

フットプリントは小さくしつつモニターは引き続き機能させたい場合、このプロファイルは **完全なメトリクスカバレッジ** を維持したまま、実際にデータ量を左右する 2 つのもの — ログ行と eBPF スパン — を削減します。

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# メトリクスのデータポイントを半分にします。解像度は粗くなりますが、カバレッジは同じです。
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Pod ログは維持しますが、アラートに値するものだけを送信します。(メトリクスは
# これに依存しません — ノードコレクターはどちらにせよ動作します。)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # エージェント側で INFO / DEBUG / TRACE を破棄します

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # 最も重い eBPF ファミリー
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

必要に応じてさらに絞り込みます: `minSeverity` を `ERROR` に上げる、`namespaceFilters.applyTo.metrics=true` を追加する、または OTel SDK からすでにトレースを送信している場合は `ebpf.enabled=false` を設定します。

> **何を削減するかに注意してください。** 一部のモニターは特定のシグナルに依存します: `cadvisor` を無効にすると、OOM kill と CPU スロットリングのモニターがなくなります。`kubeletstats.volumeMetrics` を無効にすると、PVC のディスク残量不足モニターがなくなります。ログを無効にすると、ログベースのアラートがなくなります。また、`sampling.traces.percentage` はモニターをなくすわけではありませんが、スパンベースのモニター (`Span Count` を条件とする **Traces** モニター、`Exception Count` を条件とする **Exceptions** モニター) を縮小させるため、それに合わせてしきい値を調整し直してください。モニターが監視しているシグナルではなく、対応しないシグナルを削減してください。

### 効果を測定する

テレメトリの使用量は 1 日ごとに集計されるため、削減を確認するには **Project Settings → Usage History** で 1〜2 日間の傾向を確認してください — 変更を適用した瞬間には変化しません。一度にすべてを抑えて実際に頼っていたモニターを失うのではなく、レバーを 1 つずつ変更して差分を特定できるようにしてください — まずログを無効にし、次に間隔を長くし、そして eBPF を切り詰めます。

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

   `401` が返される場合、リリース内のキーが誤っているか失効しています。_Project Settings → Telemetry Ingestion Keys_ から有効なキーをコピーして再デプロイしてください。

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

1. まず取り込みキーの拒否を除外します — これは最も一般的な原因であり、エージェント側からは見えません。上記の [エージェントが "Disconnected" と表示される](#エージェントが-disconnected-と表示される) を参照してください (または単に診断スクリプトを実行してください)。
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
