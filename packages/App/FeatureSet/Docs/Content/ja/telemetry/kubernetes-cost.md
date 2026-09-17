# Kubernetes コスト可観測性

## 概要

OneUptime は、すべての Kubernetes ワークロードに実際にいくらかかっているかを表示できます — 名前空間ごと、コントローラーごと、Pod ごとの支出を、アイドル容量やリクエスト対使用量の効率とともに、[Kubernetes エージェント](/docs/telemetry/kubernetes-agent) ですでに収集しているメトリクス、ログ、トレースのすぐ隣で確認できます。

有効化はコマンド 1 つです。

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

これだけで完全なインストールです。このチャートは、オープンソースの [OpenCost](https://opencost.io) エンジン (Apache-2.0、CNCF — Kubecost も採用している [cost-model](https://github.com/kubecost/cost-model)) と、使用履歴のために OpenCost が必要とする最小限の専用 Prometheus をバンドルしています — 目に見えない配管となる 2 つの小さな Pod です。OpenCost は、ノード、ボリューム、ロードバランサーの価格を、クラウドプロバイダーの **公開定価から自動的に、認証情報なしで** 算出します (AWS、GCP、Azure)。オンプレミスのクラスターでは、代わりにレートカードを設定します (下記参照)。

約 1 時間以内 (最初に閉じた 1 時間ウィンドウの後) に、次のものが得られます。

- **クラスターごとの Costs ページ** (_Kubernetes → クラスター → Costs_): 支出の推移、cpu / メモリ / ストレージの内訳付きの名前空間ごとの支出、ワークロードごとの支出、アイドル支出、効率。
- **プロジェクトレベルの Costs ページ** (_Kubernetes → Costs_): プロジェクト内のすべてのクラスターにわたる支出。
- **Kubernetes Cost ダッシュボードテンプレート** (_ダッシュボード → 作成 → Kubernetes Cost Dashboard_): ノードの時間あたりコストの推移、CPU/RAM の単価、永続ボリュームとロードバランサーの支出。
- **メトリクスエクスプローラー** の生のコストメトリクス (`node_total_hourly_cost`、`pv_hourly_cost`、...)。カスタムダッシュボードやメトリクスアラートで使用できます。

## 仕組み

`cost.enabled=true` にすると、チャートは 4 つのものを実行します。

1. **OpenCost** (バンドル) — クラスターを監視し、クラウドの定価を検出し、ワークロードごとに事前に価格付けされたコスト割り当てを計算します。
2. **最小限の Prometheus** (バンドル) — OpenCost は使用量 / 価格の履歴のために PromQL エンドポイントを必要とします。この Prometheus はそのためだけに存在します。単一レプリカ、3 日間の保持、そしてスクレイプ対象はちょうど 2 つ (API サーバーのノードプロキシ経由の cAdvisor と、OpenCost 自身 — OpenCost は KSM スタイルのリソースリクエストメトリクスを自ら出力するため、kube-state-metrics は関与しません)。クラスターの外部に公開されることはなく、そのデータがクラスターから出ることもありません。
3. **コスト割り当てポーラー** (`cost.agent`) — 閉じた 1 時間ウィンドウごとに 1 回 OpenCost の Allocation API をポーリングし、ワークロードごとのコスト行 (cpu / ram / gpu / pv / ネットワーク / ロードバランサー / アイドル、および効率) を OneUptime に POST します。ウィンドウはちょうど 1 回だけ送信されます — サーバーはすでに取り込んだウィンドウをスキップするため、再起動によって支出が二重計上されることはありません。
4. **コストメトリクスのスクレイプ** (`cost.metrics`) — エージェントの OpenTelemetry コレクターが、OpenCost の Prometheus メトリクス (コスト系列に許可リスト化) を、他のクラスターメトリクスと同じ OTLP パイプラインを通じてスクレイプします。

## すでに Kubecost や OpenCost を実行していますか?

その場合はチャートを既存のエンジンに向けてください — 何もバンドルされなくなります。

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| エンジン | 一般的なサービス URL                                             |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API のパスは自動検出されます (Kubecost は `/model/allocation`、OpenCost は `/allocation/compute` または `/allocation`)。`cost.engine.allocationPath` を設定するのは、標準的でないインストールの場合だけにしてください。

## オンプレミス / ベアメタルの価格設定

ノードに公開されたクラウド定価が存在しないクラスターでは、レートカードを設定できます — OpenCost はその数値からすべてのリソースの価格を算出します。すべての値は **リソース時間あたりの米ドル (USD)** です。

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## 便利なつまみ

すべて任意です — 完全な一覧はチャートの `values.yaml` を参照してください。

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## コストに対するアラート

スクレイプされたコストメトリクスは通常の OneUptime メトリクスなので、他のメトリクスと同様にメトリクスアラートを設定できます — たとえば、平均の `node_total_hourly_cost` が予算のしきい値を超えたときや、クラスターに存在するはずのないボリュームクラスに `pv_hourly_cost` が現れたときにアラートを出す、といった具合です。

## データモデルと保持

割り当て行は ClickHouse に保存され (クラスター、ウィンドウ、名前空間、コントローラー、Pod、コンテナごとに 1 行)、クラスターのテレメトリ保持に従います。すなわち、Kubernetes クラスターリソースの `retainTelemetryDataForDays` 設定に従い、未設定の場合はプロジェクトのデータ保持にフォールバックします。アイドル容量と未割り当て容量は、`__idle__` / `__unallocated__` の名前空間の下に通常の行として保存されるため、ワークロード支出と同じグループ化でクエリできます。

## トラブルシューティング

- **Costs ページが空** — コストエージェントのログを確認してください: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`。`401` は取り込みキーが無効であることを意味します。`cost engine did not answer any known allocation path` は、エンジンがまだ起動していない (バンドルされた OpenCost は、インストール後に最初のウィンドウの価格付けを行うまで数分かかります) か、`cost.engine.url` が間違っていることを意味します。
- **バンドルされた OpenCost が準備できていない** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`。どのクラウドプロバイダーを検出したか、価格データがロードされたかどうかがログに記録されます。
- **ダッシュボードテンプレートにデータが表示されない** — テンプレートはスクレイプされたコストメトリクスを読み取ります。`cost.metrics.enabled` が `true` であることを確認してください。
- **数値がエンジン自身の UI と異なる** — OneUptime は各コスト要素にエンジンの調整 (reconciliation) 補正を含め、完全に閉じたウィンドウのみを送信します。進行中の 1 時間の部分的な支出は、ウィンドウが閉じた後に表示されます。
- **Prometheus Pod が再起動した** — デフォルトの `emptyDir` ストレージでは、再起動により数時間分の使用履歴が失われるため、そのウィンドウの割り当てが小さくなる場合があります。それが問題になる場合は `cost.prometheus.persistence.enabled=true` を設定してください。
