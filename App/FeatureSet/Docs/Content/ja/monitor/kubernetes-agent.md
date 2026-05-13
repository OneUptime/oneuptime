# Kubernetesエージェントのインストール

OneUptime Kubernetesエージェントは、Kubernetesクラスターからクラスターメトリクス、イベント、Podログを収集し、OneUptimeに送信します。Helmチャートとして配布されています。

## クイックスタート

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

数分後にOneUptimeにクラスターが表示されます。

## クラスターに適したプリセットの選択

Kubernetesのディストリビューションによって制約が異なります。特に `hostPath` ボリュームをマウントできるかどうかが重要です。セキュリティのドキュメントを読む手間を省くため、チャートはトップレベルのオプション `preset` を一つ提供しています。

| プリセット | 使用用途 | ログ収集 | 備考 |
| --- | --- | --- | --- |
| `standard`（デフォルト） | セルフマネージド、**EC2上のEKS**、**GKE Standard**、**AKS**、minikube、kind、k3s | hostPathを介して `/var/log/pods` を読み取るDaemonSet | 最小オーバーヘッド。これらのプラットフォームではhostPathが利用可能。 |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes APIテイラー（Deployment） | AutopilotではhostPathがブロックされます。AutopilotのPodセキュリティ標準に合格した強化されたセキュリティコンテキストを設定します。 |
| `eks-fargate` | **EKS Fargate** | Kubernetes APIテイラー（Deployment） | `gke-autopilot` と同じ。FargateはhostPathとDaemonSetをブロックします。 |

不明な場合は `preset` を未設定のままにしてください。`standard` のデフォルトが使用されます。`hostPath` に関するPodセキュリティポリシーエラーが発生した場合は、`gke-autopilot`（またはEKS Fargateの場合は `eks-fargate`）に切り替えて再インストールしてください。

### 使用例

**GKE Standard、EC2上のEKS、セルフマネージド、またはAKS：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate：**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## 2つのログ収集モードの違い

`preset` は内部的に `logs.mode` を設定します。プリセットのデフォルトを上書きする必要がある場合は、直接設定することもできます。

### DaemonSetモード（`logs.mode: daemonset`）

DaemonSetはノードごとに1つのOpenTelemetryコレクターPodを実行します。hostPathボリュームを介して `/var/log/pods/` 以下のログファイルを追跡し、OTLPで転送します。

- **利点：** 最小オーバーヘッド、ノード数に応じた線形スケーリング、Kubernetes APIサーバーへの負荷なし、ログローテーションの処理。
- **欠点：** hostPathが必要で、DaemonSetをスケジュールできる必要があります。GKE AutopilotとEKS Fargateではいずれも利用できません。

### APIモード（`logs.mode: api`）

単一レプリカのDeployment（`oneuptime/kubernetes-log-tailer` イメージ）がKubernetes APIを使用してコンテナログをストリーミングします。`kubectl logs -f` が使用するのと同じエンドポイントです。hostPathなし、ホストアクセスなし、DaemonSetなし。

- **利点：** GKE Autopilot、EKS Fargate、hostPathをブロックするまたは `restricted` PodセキュリティStandardを適用するクラスターで機能します。
- **欠点：** すべてのコンテナストリームが `kube-apiserver` への長期接続になります。実際には1つのレプリカで数千のコンテナを問題なく処理できます。非常に大規模なクラスターの場合は、各レプリカで `logs.api.replicas` と `namespaceFilters.include` を使ってネームスペース単位でシャーディングしてください。

### どちらを使うべきか

hostPathが機能する場合はDaemonSetを使用してください。それ以外の場合はAPIモードを使用してください。`preset` 設定が適切なものを選択します。

`--set logs.enabled=false` でログ収集を完全に無効にし、代わりにOpenTelemetry SDKでアプリケーションログを送信することもできます。[OpenTelemetry](/docs/telemetry/open-telemetry)のドキュメントを参照してください。

## 共通オプション

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `preset` | （空 — `standard` として扱われる） | 上記の表を参照。 |
| `oneuptime.url` | *（必須）* | OneUptimeインスタンスのURL。 |
| `oneuptime.apiKey` | *（必須）* | プロジェクトAPIキー（設定 → APIキー）。 |
| `clusterName` | *（必須）* | このクラスターの一意の名前。すべてのレコードに `k8s.cluster.name` として刻印されます。 |
| `namespaceFilters.include` | `[]` | 設定した場合、これらのネームスペースのみが監視されます。 |
| `namespaceFilters.exclude` | `["kube-system"]` | スキップするネームスペース。 |
| `logs.enabled` | `true` | ログ収集のオン/オフ。 |
| `logs.mode` | （`preset` から導出） | `daemonset`、`api`、または `disabled`。プリセットを上書きします。 |
| `logs.api.replicas` | `1` | ログテイラーDeploymentのレプリカ数（APIモードのみ）。 |
| `controlPlane.enabled` | `false` | etcd/api-server/scheduler/controller-managerをスクレイプします。セルフマネージドクラスターのみ — マネージドサービス（EKS/GKE/AKS）は通常これらのエンドポイントを公開していません。 |

完全なリストは[チャートの `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) を参照してください。

## アップグレード

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` は既存の設定を維持します。新しい `--set` オプションを追加して上書きできます。

## アンインストール

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## トラブルシューティング

### インストールが「hostPath volumes are not allowed」で失敗する場合

クラスターがhostPathをブロックしています。APIモードのプリセットに切り替えてください。

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # またはeks-fargate
```

### OneUptimeにログが表示されない場合

エージェントのPodを確認してください。

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

APIモードでは、ログテイラーPodがポート13133で `/healthz` を公開しています。`kubectl port-forward` を介してアクセスし、エクスポートステータスのスナップショットを取得できます。

### 1つのログテイラーレプリカに対してPod数が多すぎる場合（APIモードのみ）

ネームスペースをシャーディングして水平スケールしてください。ネームスペースグループごとに1回デプロイします。

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

または `logs.api.replicas` を増やすこともできますが、各レプリカが許可されたすべてのネームスペースを処理するため、重複排除のためにはやはりネームスペースシャーディングが必要です。
