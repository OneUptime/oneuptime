# Kubernetes エージェントのインストール

OneUptime Kubernetes エージェントは、クラスターメトリクス、イベント、Pod ログ、**アプリケーショントレース(eBPF による HTTP/gRPC)**、および **OS レベルのノードメトリクス**を Kubernetes クラスターから収集し、OneUptime へ送信します。Helm chart として配布されており、ワンコマンドでインストールできます。eBPF 自動計装はデフォルトで有効化されているため、コード変更なしでサービスレベルのトレースと RED メトリクスを確認できます。**連続的な CPU フレームグラフ(eBPF プロファイラー)**も利用可能です。より多くのテレメトリーが必要な場合は `--set profiling.enabled=true` でオプトインしてください。

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

数分以内にクラスターが OneUptime に表示されます。

## クラスターに適したプリセットの選択

Kubernetes のディストリビューションごとに制約が異なります。最も顕著なのは、ワークロードが `hostPath` ボリュームをマウントできるかどうかです。セキュリティドキュメントを読まずに済むよう、chart には単一のトップレベルオプションとして `preset` が用意されています。

| プリセット             | 用途                                                                             | ログ収集                                             | 備考                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `standard`(デフォルト) | セルフマネージド、**EKS on EC2**、**GKE Standard**、**AKS**、minikube、kind、k3s | hostPath 経由で `/var/log/pods` を読み取る DaemonSet | オーバーヘッドが最も低い構成です。これらのプラットフォームでは hostPath を利用できます。                                                   |
| `gke-autopilot`        | **GKE Autopilot**                                                                | Kubernetes API テイラー(Deployment)                  | Autopilot では hostPath がブロックされます。Autopilot の Pod Security Standards を通過する強化されたセキュリティコンテキストを設定します。 |
| `eks-fargate`          | **EKS Fargate**                                                                  | Kubernetes API テイラー(Deployment)                  | `gke-autopilot` と同じです。Fargate は hostPath と DaemonSet をブロックします。                                                            |

どれを選べばよいか分からない場合は、`preset` を設定しないままにしてください。`standard` のデフォルト設定が適用されます。クラスターが `hostPath` に言及する Pod Security ポリシーエラーでインストールを拒否した場合は、`gke-autopilot`(または EKS Fargate の場合は `eks-fargate`)に切り替えて再インストールしてください。

### 例

**GKE Standard、EKS on EC2、セルフマネージド、または AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## 2 つのログ収集モードの違い

内部的には、`preset` が `logs.mode` を設定します。プリセットのデフォルトを上書きする必要がある場合は、これを直接設定することもできます。

### DaemonSet モード(`logs.mode: daemonset`)

DaemonSet がノードごとに 1 つの OpenTelemetry Collector pod を実行します。hostPath ボリューム経由で `/var/log/pods/` 配下のログファイルをテイルし、OTLP で転送します。

- **長所:** オーバーヘッドが最も低く、ノード数に対して線形にスケールし、Kubernetes API サーバーに負荷をかけず、ログローテーションに対応します。
- **短所:** hostPath が必要で、DaemonSet をスケジュールできる必要があります。これらは GKE Autopilot と EKS Fargate では利用できません。

### API モード(`logs.mode: api`)

シングルレプリカの Deployment(`oneuptime/kubernetes-log-tailer` イメージ)が Kubernetes API を使用してコンテナログをストリーミングします。これは `kubectl logs -f` が使用するのと同じエンドポイントです。hostPath、ホストアクセス、DaemonSet はいずれも不要です。

- **長所:** GKE Autopilot、EKS Fargate、および hostPath をブロックしたり `restricted` Pod Security Standard を強制したりするあらゆるクラスターで動作します。
- **短所:** すべてのコンテナストリームが `kube-apiserver` への長時間接続になります。実際には、1 つのレプリカで数千個のコンテナを問題なく処理できます。非常に大規模なクラスターでは、`logs.api.replicas` と各レプリカの `namespaceFilters.include` を組み合わせて namespace でシャーディングしてください。

### どちらを使うべきか?

hostPath が利用可能であれば、DaemonSet を使用してください。それ以外の場合は、API モードを使用してください。`preset` 設定により、適切なモードが自動的に選択されます。

`--set logs.enabled=false` でログ収集を完全に無効化し、代わりに OpenTelemetry SDK 経由でアプリケーションログを送信することもできます。[OpenTelemetry](/docs/telemetry/open-telemetry) ドキュメントを参照してください。

## eBPF によるアプリケーショントレースおよび HTTP リクエスト(デフォルトで有効)

chart には、すべてのノードで [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) を実行する DaemonSet が含まれています。OBI は eBPF プログラムを Linux カーネルにロードし、ソケットレベルのトラフィックを監視して、ノード上のすべての pod から HTTP/HTTPS、gRPC、SQL/Redis 呼び出しを再構築します。コード変更、SDK、サイドカーは一切不要です。キャプチャされたトラフィックは、OTLP トレースおよびリクエスト/レイテンシメトリクスとして OneUptime に直接エクスポートされます。

インストール後、数分以内にサービスが **Telemetry → Traces** とサービスマップに表示され始めます。`k8s.cluster.name` が `clusterName` に設定されるため、クラスター単位でフィルタリングできます。

### 無効化すべきタイミング

eBPF は**デフォルトで有効**です。以下に該当する場合は無効化(`--set ebpf.enabled=false`)してください:

- **GKE Autopilot** または **EKS Fargate** にインストールしている場合。これらのプラットフォームは特権 pod をブロックしますが、OBI は eBPF プログラムをロードするために特権モードを必要とします。
- ノードが BTF バックポートのない **Linux 5.8** より古いカーネルで動作している場合。(Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL/Stream 9+ などのモダンなディストリビューションでは問題ありません。)
- すでにアプリから OpenTelemetry SDK 経由でトレースを送信しており、重複を避けたい場合。

### 出力されるデータ

OBI は、キャプチャされたトラフィックから複数のシグナルファミリーを抽出します。すべてデフォルトで有効化されており、`--set ebpf.features.<key>=false` で個別に無効化できます:

| シグナル                                | デフォルト | 追加される情報                                                                                                                                                            |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ebpf.features.httpMetrics`             | on         | サービスごとの HTTP/gRPC RED メトリクス — リクエストレート、レイテンシヒストグラム、エラー数。                                                                            |
| `ebpf.features.spanMetrics`             | on         | スパン属性をキーとするメトリクス: ルート/オペレーションごとに分類されたリクエストサイズ、レスポンスサイズ、所要時間。                                                     |
| `ebpf.features.serviceGraph`            | on         | サービス間のエッジメトリクス(呼び出し元 → 呼び出し先のリクエストレートとレイテンシ)。サービスマップを支える機能です。                                                     |
| `ebpf.features.hostMetrics`             | on         | 計装された各プロセスの CPU とメモリ。基本的なキャパシティの確認のために別途プロファイラーを動かす手間を省きます。                                                         |
| `ebpf.features.networkMetrics`          | on         | k8s メタデータ付きの pod 間 TCP/UDP フローのバイト数とパケット数のカウンター。OBI が解析できないプロトコルで動作するものを含め、通信するすべての pod ペアを可視化します。 |
| `ebpf.features.networkInterZoneMetrics` | off        | ネットワークメトリクスのゾーン間バリアント。カーディナリティが倍になるため、ゾーンベースのスケジューリングを実際に利用している場合のみ有効化する価値があります。          |
| `ebpf.features.tcpStats`                | on         | ノードレベルの TCP 統計: RTT ヒストグラム、接続失敗数、再送回数。                                                                                                         |

OBI はデフォルトで、サービス境界をまたいでトレースコンテキストを伝播します。pod A が pod B に HTTP/gRPC リクエストを送信すると、OBI は W3C `traceparent` ヘッダーを送信リクエストに挿入します。これにより、pod B 側で生成されるスパンは pod A の送信トレースと同じトレースにリンクされます。どちらのアプリでも SDK の変更は不要です。

| オプション                 | デフォルト | 説明                                                                                                                                                               |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ebpf.contextPropagation`  | on         | 送信トラフィックに W3C `traceparent` を挿入(HTTP ヘッダー + カスタム TCP オプション)。各サービスのスパンをローカルに保ちたい場合は `false` に設定してください。    |
| `ebpf.trackRequestHeaders` | on         | プレーン HTTP サーバー(非 Go、非 TLS)でも伝播が動作するようにするためのカーネル側のリクエストヘッダー追跡。`contextPropagation` が true の場合のみ有効化されます。 |

### ログとトレースの相関付け

これもデフォルトで有効です。OBI のログエンリッチャーは、計装されたプロセスからの pod 標準出力への書き込みをインターセプトし、以下を行います:

- **JSON 形式のログの場合:** 行に `trace_id` と `span_id` フィールドを挿入します(ログ内の既存の値は保持されます)。次に filelog DaemonSet がそれらのフィールドを LogRecord のネイティブな trace_id/span_id スロットに引き上げます。これにより、トレースビューでスパンをクリックすると OneUptime 内のログにジャンプし、ログ行をクリックすると親トレースにジャンプできます。
- **JSON 以外のログの場合:** 行はそのまま保持されます。収集はされますが、自動リンクは行われません。

| オプション                   | デフォルト | 説明                                                                                                                                   |
| ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ebpf.logToTraceCorrelation` | on         | OBI ログエンリッチャーと filelog パイプラインの trace_id 引き上げを有効化します。両方をスキップする場合は `false` に設定してください。 |

注意事項:

- **trace_id を表示するにはログが JSON 形式である必要があります。** ロガーを JSON フォーマッターに切り替えてください。例えば `structlog`、`pino`、`winston`、`serilog`、`logback-json`、klog の `--logging-format=json` などです。
- **標準出力のバッファリングは相関付けを破壊します。** これは、`write()` システムコールがリクエストを処理したスレッドとは別のスレッドで発火するためです。一般的な対処方法:
  - **Python:** `PYTHONUNBUFFERED=1` を設定してください(ランタイムは TTY 以外の場合に標準出力をブロックバッファリングします)。
  - **.NET:** 起動時に `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })` を実行してください。Microsoft.Extensions.Logging の `AddConsole()` と Serilog の非同期シンクも動作しません。同期型のコンソールライターに切り替えてください(Serilog のデフォルトの `WriteTo.Console()` で問題ありません)。
- Greenlet / gevent、Tornado、その他のカスタム非同期ランタイムには対応していません。

### チューニング

| オプション             | デフォルト                                             | 説明                                                                                                                        |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ebpf.enabled`         | `true`                                                 | マスタースイッチ。eBPF DaemonSet をまるごとスキップする場合は `false` に設定してください。                                  |
| `ebpf.image.tag`       | `v0.9.0`                                               | OBI イメージタグ。OBI は 1.0 リリース前です。動作確認済みのバージョンに固定し、バージョンアップ時には再テストしてください。 |
| `ebpf.autoTargetExe`   | `*`                                                    | 計装対象の実行ファイルの glob。自動計装の範囲を限定したい場合は絞り込んでください(例: `*/python,*/java`)。                  |
| `ebpf.excludeExePaths` | (シェル、kubelet、runc、containerd、otelcol、OBI 自身) | スキップする glob のカンマ区切りリスト。                                                                                    |
| `ebpf.logLevel`        | `info`                                                 | `debug`、`info`、`warn`、または `error`。トラブルシューティング時は `debug` に設定してください。                            |
| `ebpf.printTraces`     | `false`                                                | OTLP エクスポートに加えて、OBI の標準出力にスパンを表示します。インストール時にキャプチャを確認するのに便利です。           |
| `ebpf.resources.*`     | requests `100m / 256Mi`、limits `1000m / 1Gi`          | トラフィックの多いクラスターでは増やしてください。                                                                          |

OBI が動作しトラフィックを認識していることを確認するには:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## 連続的な CPU プロファイリング(デフォルトで無効)

別の DaemonSet が [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)(`otel/opentelemetry-collector-ebpf-profiler` イメージとしてパッケージ化されたもの)を実行します。サポートされるすべてのランタイム(Go、Java、.NET、Python、Ruby、Node.js、PHP、Perl、C/C++、Rust)で、オン CPU スタックを 19Hz でサンプリングし、OTLP プロファイルを OneUptime に送信します。これらは **Telemetry → Performance Profiles** に表示され、また個々のトレーススパンからリンクされたフレームグラフとしても確認できます。

プロファイリングは**デフォルトで無効**です。OBI 自動計装よりも負荷が大きく(ノードあたりの CPU 使用量がより多く、メモリフットプリントもより大きくなります)、すべてのクラスターで常時フレームグラフを取得したいわけではないためです。より豊富なテレメトリーが必要な場合は有効化してください: `--set profiling.enabled=true`。

eBPF 自動計装も有効化されている場合(`ebpf.enabled: true`、デフォルト)、各 CPU サンプルは共有 bpffs マップを介して OBI のトレースコンテキストと相関付けされます。これにより、フレームグラフは trace_id/span_id を保持し、OneUptime UI でスパンごとのフレームグラフを表示できます。

要件:

- **Linux カーネル 5.10+**(OBI が必要とする 5.8 より少し新しいバージョン)。
- hostPID を持つ特権 pod。eBPF 自動計装 DaemonSet と同じ制約です。GKE Autopilot、EKS Fargate、その他のロックダウンされた環境では実行できません。

チューニング:

| オプション                    | デフォルト            | 説明                                                                                                                                                                             |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiling.enabled`           | `false`               | マスタースイッチ。デフォルトで無効。連続的な CPU フレームグラフが必要な場合はオプトインしてください。                                                                            |
| `profiling.image.tag`         | `0.152.0`             | `otel/opentelemetry-collector-ebpf-profiler` イメージタグ。プロファイラーは 1.0 リリース前です。動作確認済みのバージョンに固定してください。                                     |
| `profiling.samplesPerSecond`  | `19`                  | サンプリング頻度(Hz)。アップストリームのデフォルト値で、一般的なタイマー周波数との偶発的なエイリアシングを回避します。                                                           |
| `profiling.offCpuThreshold`   | `0`                   | (0–1] でオフ CPU プロファイリングを有効化します。ロック競合やブロッキング I/O を診断できます。トレースポイントのオーバーヘッドを追加するため、デフォルトでは無効化されています。 |
| `profiling.tracers`           | `""` _(全ランタイム)_ | ロードする言語トレーサーのカンマ区切りリスト。                                                                                                                                   |
| `profiling.obiProcessContext` | `true`                | トレースとプロファイルのリンクのために、サンプルを OBI のトレースコンテキストと相関付けます。                                                                                    |

## その他のデータ収集(ホストメトリクス、サチュレーション、cAdvisor、KSM、監査ログ、CSI、CoreDNS)

chart は以下のデータも収集できます:

| `<key>.enabled`                   | デフォルト | 追加される情報                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostMetrics`                     | on         | `/proc` および `/sys` からのノードごとの OS メトリクス — ディスク I/O キューの深さ、ファイルシステムの inode 使用量、NIC エラーカウンター、ページング統計、ロードアベレージ。ログコレクター DaemonSet 内に同居します(追加の pod はありません)。                                                                                                                                                                                                  |
| `kubeletstats.utilizationMetrics` | on         | サチュレーションメトリクス — コンテナおよび pod の CPU/メモリを request と limit に対するパーセンテージとして表現します。「CPU/Memory vs Request」および「CPU/Memory vs Limit」モニターを支える 8 つの派生メトリクスファミリーです。既存の `kubeletstats` レシーバーと同じスクレイプを使用するため、追加の pod はありません。pod に request/limit が設定されていない場合は常に 0 になります。                                                    |
| `kubeletstats.volumeMetrics`      | on         | PVC ごとのディスク使用量(`k8s.volume.available`、`k8s.volume.capacity`)。「PVC Low Disk Space」モニターを支える機能です。pod ごと、PVC ごとに 1 つのシリーズ — ほとんどのクラスターでは抑えられますが、数千個の PVC を持つステートフルワークロードでは重くなります。                                                                                                                                                                             |
| `cadvisor`                        | on         | 各ノードの DaemonSet pod から kubelet の `/metrics/cadvisor` エンドポイントをスクレイプし、`kubeletstats` が変換しないコンテナメトリクスを取得します: CFS スロットリング(`container_cpu_cfs_throttled_seconds_total`、`container_cpu_cfs_periods_total`)と OOM kill イベント(`container_oom_events_total`)。relabel allowlist によりレシーバー側でその他すべてを破棄するため、カーディナリティは抑えられます。                                   |
| `kubeStateMetrics`                | off        | kube-state-metrics からクラスター状態メトリクスを取得します: pod のフェーズ(Pending / Terminating)、コンテナの待機理由(CrashLoopBackOff、ImagePullBackOff)、リソースクォータの使用量。`mode: bundled`(デフォルト)では小さな KSM Deployment をデプロイします。`mode: external` では `endpoint` を介して既存の KSM をスクレイプします。バンドルモードでは chart のフットプリントに Deployment が追加されるため、デフォルトでは無効になっています。 |
| `auditLogs`                       | off        | ホストから `/var/log/kubernetes/audit.log` をテイルします。すべての Kubernetes API リクエストをキャプチャします — 誰がどのリソースに対して何を行ったかが記録されます。セルフマネージドクラスターのみ対応 — マネージド Kubernetes(EKS、GKE、AKS、DOKS)は監査ログをクラウドプロバイダーのシンクにルーティングします。                                                                                                                              |
| `csi`                             | off        | `app=csi-driver`(または `app.kubernetes.io/component=csi-driver`)というラベルが付けられた pod を自動検出し、Prometheus の `metrics` ポートをスクレイプします — ボリュームのアタッチ/デタッチのレイテンシ、プロビジョニング失敗、IOPS など。                                                                                                                                                                                                      |
| `coreDns`                         | off        | クラスター CoreDNS サービスの `:9153/metrics` をスクレイプします。クエリレート、レイテンシ、キャッシュヒット率、エラー数を可視化します — P99 レイテンシの一般的な原因となる項目です。                                                                                                                                                                                                                                                            |

## 共通オプション

| オプション                                | デフォルト                         | 説明                                                                                                                                                                                                                    |
| ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`                                  | (空 — `standard` として扱われます) | 上記のテーブルを参照してください。                                                                                                                                                                                      |
| `oneuptime.url`                           | _(必須)_                           | OneUptime インスタンスの URL。                                                                                                                                                                                          |
| `oneuptime.apiKey`                        | _(必須)_                           | プロジェクトの API キー(Settings → API Keys)。                                                                                                                                                                          |
| `clusterName`                             | _(必須)_                           | このクラスターの一意の名前。すべてのレコードに `k8s.cluster.name` として刻印されます。                                                                                                                                  |
| `namespaceFilters.include`                | `[]`                               | 設定された場合、これらの namespace のみが監視されます。                                                                                                                                                                 |
| `namespaceFilters.exclude`                | `["kube-system"]`                  | スキップする namespace。                                                                                                                                                                                                |
| `logs.enabled`                            | `true`                             | ログ収集を有効化または無効化します。                                                                                                                                                                                    |
| `logs.mode`                               | (`preset` から導出)                | `daemonset`、`api`、または `disabled`。プリセットを上書きします。                                                                                                                                                       |
| `logs.api.replicas`                       | `1`                                | ログテイラー Deployment のレプリカ数(API モードのみ)。                                                                                                                                                                  |
| `ebpf.enabled`                            | `true`                             | OpenTelemetry eBPF Instrumentation により、すべての pod から HTTP/gRPC トレースを自動キャプチャします。上記のセクションを参照してください。                                                                             |
| `profiling.enabled`                       | `false`                            | OpenTelemetry eBPF Profiler による連続的な CPU フレームグラフ。デフォルトで無効。より多くのテレメトリーが必要な場合はオプトインしてください。上記のセクションを参照してください。                                       |
| `hostMetrics.enabled`                     | `true`                             | ノードごとの OS メトリクス。                                                                                                                                                                                            |
| `kubeletstats.utilizationMetrics.enabled` | `true`                             | コンテナおよび pod の CPU/メモリのサチュレーション(request と limit に対する %)。追加のスクレイプはなく、kubeletstats のデータから派生します。                                                                          |
| `kubeletstats.volumeMetrics.enabled`      | `true`                             | PVC ごとのディスク使用量(`k8s.volume.available`、`k8s.volume.capacity`)。                                                                                                                                               |
| `cadvisor.enabled`                        | `true`                             | このノードの kubelet の `/metrics/cadvisor` をスクレイプし、CFS スロットリングと OOM kill カウンターを取得します。3 つのメトリクスに allowlist で限定されています。                                                     |
| `kubeStateMetrics.enabled`                | `false`                            | kube-state-metrics から pod のフェーズ、コンテナの待機理由(CrashLoopBackOff / ImagePullBackOff)、および ResourceQuota の使用量を取得します。バンドル版か外部版かについては `kubeStateMetrics.mode` を参照してください。 |
| `auditLogs.enabled`                       | `false`                            | Kubernetes 監査ログ収集(セルフマネージドクラスター)。                                                                                                                                                                   |
| `csi.enabled`                             | `false`                            | CSI ドライバーの Prometheus メトリクス。                                                                                                                                                                                |
| `coreDns.enabled`                         | `false`                            | CoreDNS の Prometheus メトリクス。                                                                                                                                                                                      |
| `controlPlane.enabled`                    | `false`                            | etcd / api-server / scheduler / controller-manager をスクレイプします。セルフマネージドクラスターのみ対応 — マネージド版(EKS/GKE/AKS)は通常これらのエンドポイントを公開していません。                                   |

完全なリストについては、[chart の `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) を参照してください。

## アップグレード

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` は既存の構成を保持します。新しい `--set` の上書きはその上に追加で渡すことができます。

> ⚠️ **注意: `--reuse-values` は chart からの新しいデフォルト値をマージしません。** Helm は以前にレンダリングされた値をそのまま再利用するため、新しいバージョンの chart で追加されたトップレベルフィールド(例: `profiling.*`、`ebpf.features.*`)は既存のリリースでは未設定のままになり、テンプレートはそれを無効化したかのようにレンダリングします。
>
> **Helm 3.14+** — `--reset-then-reuse-values` に切り替えてください。これは上書きしていないキーについて chart のデフォルトを再読み込みします:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 以前** — `--reuse-values` を外し、元の `--set` フラグ(または `-f values.yaml`)を明示的に渡してください。上書きしないものすべてに新しい chart のデフォルトが適用されます。
>
> アップグレード後に新機能の pod(例: `kubernetes-agent-profiling-*`)が表示されない場合、ほとんどの場合これが原因です。`helm get values <release>` を実行すると Helm が実際に保持している値が表示されます。出力にフィールドがない場合は、そのフィールドのデフォルトがマージされていないことを意味します。

## アンインストール

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## トラブルシューティング

### "hostPath volumes are not allowed" でインストールが失敗する

クラスターが hostPath をブロックしています。API モードのプリセットに切り替えてください:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # または eks-fargate
```

### OneUptime にログが表示されない

エージェント pod を確認してください:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

API モードでは、ログテイラー pod がポート 13133 で `/healthz` を公開しています。`kubectl port-forward` 経由でアクセスすると、エクスポートステータスのスナップショットを確認できます。

### eBPF DaemonSet pod が `CrashLoopBackOff` になる、または起動に失敗する

OBI pod のログを確認してください:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

よくある原因:

- **カーネルが古すぎる、または BTF がない。** OBI は BTF を備えた Linux 5.8+ を必要とします。ノードで `uname -r` を実行して確認してください。アップグレードできない場合は、eBPF を無効化してください: `--set ebpf.enabled=false`。
- **特権 pod がブロックされている。** 一部のクラスターでは、Autopilot/Fargate 以外でも特権 pod が拒否されます。eBPF を無効化してください。
- **ダッシュボードにトレースが表示されないが OBI は動作している。** `--set ebpf.printTraces=true` を設定して OBI の標準出力を確認してください。そこにスパンが表示される場合、問題は OTLP の配信です(`OTEL_EXPORTER_OTLP_ENDPOINT` と OneUptime の URL/API キーを確認してください)。スパンが表示されない場合、OBI が監視しているトラフィックがすべて、OBI が傍受できない TLS ライブラリ(例: 認識できない静的リンクされた TLS 実装)で暗号化されている可能性があります。

### クラスターの pod 数が 1 つのログテイラーレプリカに対して多すぎる(API モードのみ)

namespace でシャーディングして水平方向にスケールしてください。namespace グループごとに 1 回ずつデプロイします:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

別の方法として、`logs.api.replicas` を増やすこともできます。ただし、各レプリカは許可されたすべての namespace を処理するため、重複排除のためには namespace シャーディングが必要です。
