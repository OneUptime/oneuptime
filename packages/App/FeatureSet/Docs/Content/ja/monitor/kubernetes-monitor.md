# Kubernetes モニター

Kubernetes モニターは、OneUptime の Kubernetes エージェントがクラスターから送信するメトリクス（ノード、Pod、コンテナ、ワークロード、オートスケーラー、コントロールプレーン）に基づいてアラートを出します。既製のアラートテンプレートから始めるか、メトリクスを 1 つ選ぶか、独自のクエリを書き、アラートやインシデントを作成するしきい値を設定します。

:::cards
- [エージェントをインストールする](/docs/monitor/kubernetes-agent): Helm コマンド 1 つでクラスターを OneUptime に取り込みます。
- [モニターを作成する](#kubernetes-モニターを作成する): クラスターを選び、テンプレート、メトリクス、クエリのいずれかを選びます。
- [アラートテンプレート](#既製のアラートテンプレート): 報告が止まったクラスターから etcd まで、18 個の既製アラート。
- [条件](#監視条件): 静的なしきい値と異常検知。
:::

## 仕組み

エージェントはクラスターのメトリクスを OTLP で OneUptime に送信し、それぞれにクラスター名（`k8s.cluster.name`、チャートの `clusterName`）を付けます。新しい名前からの最初のデータでクラスターが **Kubernetes** に登録され、それ以降、Kubernetes モニターでそのクラスターを選べるようになります。モニターは毎分、自身の **時間範囲** にわたってそれらのメトリクスを照会し、集計して、結果を条件と比較します。

```mermaid title="クラスターのメトリクスからインシデントまで"
flowchart TB
    agent["Kubernetes エージェント"] -->|"OTLP メトリクス"| metrics["クラスターのメトリクス"]
    metrics --> monitor["Kubernetes モニター"]
    monitor -->|"条件を満たす"| incident["アラートまたは<br/>インシデント"]
```

## 始める前に

- クラスター内で OneUptime の Kubernetes エージェントが動作していること。[Kubernetes エージェント (Helm インストール)](/docs/monitor/kubernetes-agent) を参照してください。インストールから数分後にクラスターが **Kubernetes** に表示されます。
- コントロールプレーンのテンプレート（**etcd No Leader**、**API Server Request Saturation**、**Scheduler Backlog**）には、エージェントのコントロールプレーンのスクレイプ（`controlPlane.enabled`）が必要です。これで API サーバーはそのまま読み取れますが、etcd とスケジューラーにはエンドポイントの指定も必要です（[コントロールプレーンの監視を有効にする](/docs/telemetry/kubernetes-agent#コントロールプレーンの監視を有効にする) を参照）。マネージドクラスター（EKS、GKE、AKS）はこれらのエンドポイントを公開しないため、そこではこれらのモニターにデータが届きません。

## Kubernetes モニターを作成する

:::steps
### 新しいモニターを始める

**モニター** に移動し、**モニターを作成** をクリックします。**その他のモニターの種類** で **Kubernetes** を選ぶか、検索ボックスに `k8s` と入力します。

### クラスターを選ぶ

**Kubernetes クラスター** で選択します。一覧には、エージェントがデータを報告したすべてのクラスターが表示されます。選ぶと、フィールドの下の行にデータが届いているかどうかが表示されます。**Kubernetes クラスターを追加** を押すと、キーが入力済みのセットアップ手順が開き、最初のデータを待ちます。

### 監視する対象を選ぶ

新しいモニターは **アラートの対象** の **Cluster Stopped Reporting** から始まり、**変更** で別のテンプレートを選べます。**Custom Metric** と **詳細** は **その他の項目** にあります。

| 場所 | 選択する内容 |
| --- | --- |
| **アラートの対象** | [既製のアラートテンプレート](#既製のアラートテンプレート)。メトリクス、スコープ、時間範囲、条件が入力されます。**時間範囲** は引き続き変更できます。 |
| **Custom Metric** | [メトリクスカタログ](#メトリクスカタログ) からメトリクスを 1 つ選び、次に **リソーススコープ**、フィルター、**集計**（平均、最大、最小、合計、カウント）、**時間範囲** を選びます。 |
| **詳細** | **リソーススコープ**、フィルター、**時間範囲** に加え、**メトリクスを選択** で独自のメトリクスクエリと数式を作成します。結果のライブグラフが表示されます。 |

### 条件を設定する

モニターがステータスを変えるタイミングと、アラートやインシデントを作成するタイミングを設定します。[監視条件](#監視条件) を参照してください。テンプレートを使った場合はすでに入力されているので、しきい値、重大度、オンコールポリシーを確認します。

### モニターを保存する

フォームを最後まで入力して保存します。モニターは **モニター** に表示され、最初の評価からステータスが条件に従います。
:::

## 設定オプション

### リソーススコープとフィルター

**リソーススコープ** はメトリクスを評価するレベルを設定し、フォームに表示されるフィルターを決めます。フィルターはすべて任意です。

| スコープ | 監視対象 | フィルター |
| --- | --- | --- |
| クラスター | クラスター全体 | — |
| Namespace | Namespace 内のリソース | **Namespace** |
| ワークロード | Deployment、StatefulSet、DaemonSet、Job、CronJob | **Namespace**、**ワークロードの種類**、**ワークロード名** |
| ノード | クラスターのノード | **ノード名** |
| Pod | Pod | **Namespace**、**Pod 名** |

コンテナと Pod のメトリクスには、その Pod が属するワークロードの名前が付きます（Deployment の Pod には Deployment の名前とその ReplicaSet の名前が付きます）。そのため、スコープをワークロードにすると、そのワークロードのコンテナと Pod を監視します。Job の失敗 Pod のようなワークロード自身のメトリクスには、そのワークロード自身の名前しか付かないため、そのワークロードの種類で絞り込んでください。

### 時間範囲

**時間範囲** は、モニターが評価されるたびにメトリクスクエリが対象とする期間で、**Past 1 Minute** から **Past 365 Days** まで選べます。短い期間（1～15 分）はアラートに向いており、長い期間はノイズの多いメトリクスを平滑化します。

### メトリクスクエリと数式

**詳細** タブでは、各クエリでメトリクス、その値の集計方法、任意の属性フィルターを指定します。**数式** は算術でクエリを組み合わせます。たとえばノード使用率のテンプレートは、使用量を割り当て可能な容量で割ります。

## メトリクスカタログ

**Custom Metric** タブでは、リソースの種類ごとに次のメトリクスを選べます。

| カテゴリ | メトリクス |
| --- | --- |
| Pod | Pod CPU Usage, Pod Memory Usage, Pod Phase (Code), Pod Filesystem Usage, Pod Memory Limit Utilization, Pod CPU Limit Utilization, Pod Network I/O (Cumulative, Both Directions) |
| ノード | Node CPU Usage, Node Allocatable CPU, Node Memory Usage, Node Memory Working Set, Node Filesystem Usage, Node Allocatable Memory, Node Ready Condition, Node Filesystem Available |
| コンテナ | Container Restarts, Container Restarts (Increase), Container CPU Limit, Container CPU Request, Container Memory Limit, Container Memory Request, Container Ready |
| ワークロード | Deployment Available Replicas, Deployment Desired Replicas, DaemonSet Misscheduled Nodes, DaemonSet Ready Nodes, StatefulSet Ready Replicas, Job Failed Pods, Job Failed Pods (Increase), Job Successful Pods |
| HPA | HPA Current Replicas, HPA Desired Replicas, HPA Max Replicas, HPA Min Replicas |
| コントロールプレーン | etcd Has Leader, API Server In-Flight Requests, Scheduler Pending Pods |

> [!NOTE]
> **Pod CPU Usage** と **Node CPU Usage** の単位はパーセントではなくコア数です。`0.18` は 0.18 コアを意味します。**Pod Phase (Code)** はコード（1 Pending、2 Running、3 Succeeded、4 Failed、5 Unknown）なので、最大または最小で集計し、合計は使わないでください。コントロールプレーンのメトリクスは、エージェントのコントロールプレーンのスクレイプが有効な場合にのみ届きます。**Node Ready Condition** は Ready で 1、NotReady で 0、Unknown で -1 になり、停止したノードは Unknown を報告します。1 未満でアラートしてください。 **Container Restarts** はコンテナの再起動数の累計で、**Container Restarts (Increase)** はエージェントがサンプルごとに送る、そのコンテナの前回のサンプル以降の再起動数です。ウィンドウ内での合計が、その間の再起動数になります。**Container Restarts** と同じ属性を持ち、コンテナの Pod のワークロード名も含みますが、再起動のたびに変わるコンテナの ID は含みません。**Job Failed Pods** は Job の失敗 Pod 数の累計で、**Job Failed Pods (Increase)** はエージェントがサンプルごとに送る、その Job の前回のサンプル以降に失敗した Pod 数です。ウィンドウ内での合計が、その間の失敗数になります。**Job Failed Pods** と同じく、Job の名前と Namespace を持ちます。

## 監視条件

### 評価される値

これらのモニターは常に **Metric Value**、つまり設定したメトリクスクエリまたは数式の値を評価します。条件フォームにフィルタータイプの選択はなく、**メトリクス**、**集計**、**条件**、**しきい値** が表示されます。

### 集計の種類

| 集計 | 説明 |
| --- | --- |
| 平均 | 期間内の平均値 |
| 合計 | すべての値の合計 |
| Maximum Value | 期間内の最大値 |
| Minimum Value | 期間内の最小値 |
| All Values | すべての値が条件に一致し、期間全体をカバーする必要がある |
| Any Value | 少なくとも 1 つの値が一致すればよい |

### 条件の種類

静的なしきい値は、入力した **しきい値** と比較されます。**より大きい**、**より小さい**、**以上**、**以下**、**等しい** があります。**データなし** はウィンドウ内でクエリが何も返さなかったとき、**データあり** は何か返したときに一致します。

ベースラインに基づく異常検知にしきい値は不要です。次のいずれかの条件を選ぶと、フォームには代わりに **感度** と **ベースラインウィンドウ** が表示されます。

| 条件 | 値が次のときに一致 |
| --- | --- |
| **Anomalously High** | 想定範囲を上回る |
| **Anomalously Low** | 想定範囲を下回る |
| **Anomalous** | どちらかの方向に想定範囲を外れる |

各サンプルは、**ベースラインウィンドウ**（既定は 14 日、ほかに 28、60、90 日）から作られる、週の同じ時間帯のベースラインと比較されます。**感度** は想定範囲の幅を決めます。**低 (4σ — 著しい偏差のみ)**、既定の **中 (3σ — 推奨)**、**高 (2σ — ノイズが多い、非常に安定したサービス)** から選びます。異常条件は、選んだベースラインウィンドウ分以上のメトリクス履歴がたまるまで「Learning」状態のままで、アラートを出しません。

**その他の項目** にある **データがない場合** は、期間内にクエリが何も返さないときの動作を決めます。**Ignore**（既定）は一致せず、**トリガー** は無応答を問題として扱い、**Treat As Zero** はゼロとして比較します。OneUptime 自身がデータを受信していなかった時間は、決してデータなしとは扱われません。そのような時間を含む期間のチェックは代わりに待機します。詳しくは [OneUptime がデータを受信していないとき](/docs/monitor/when-oneuptime-is-not-receiving) を参照してください。

## 既製のアラートテンプレート

**アラートの対象** の一覧には、カテゴリ別に次のテンプレートが表示されます。それぞれ 2 つの条件を入力します。1 つは条件が成り立つ間モニターをオフラインにしてインシデントとアラートを作成し、もう 1 つは条件が解消したらモニターをオンラインに戻します。

| テンプレート | カテゴリ | 発火する条件 | 重大度 |
| --- | --- | --- | --- |
| Cluster Stopped Reporting | 可用性 | クラスターのエージェントから 10 分間データが届かない | 重大 |
| CrashLoopBackOff Detection | ワークロード | コンテナが 15 分以内に再起動し、その半分未満しか準備完了でなかった | 重大 |
| Pod Stuck in Pending | スケジューリング | 15 分間のすべてのサンプルで、いずれかの Pod が Pending フェーズにある | 警告 |
| Node Not Ready | ノード | ノードが NotReady を報告した、またはステータスの報告が止まった (Unknown) | 重大 |
| High Node CPU Utilization | ノード | ノードの平均 CPU 使用量が割り当て可能な CPU の 90% を超えた | 警告 |
| High Node Memory Utilization | ノード | ノードの平均メモリワーキングセットが割り当て可能なメモリの 85% を超えた | 警告 |
| Deployment Replica Mismatch | ワークロード | Deployment の利用可能なレプリカが 15 分間、希望数を下回っている | 警告 |
| Job Failures | ワークロード | Job の Pod が 15 分以内に失敗した | 警告 |
| etcd No Leader | コントロールプレーン | etcd に選出されたリーダーがいない | 重大 |
| API Server Request Saturation | コントロールプレーン | API サーバーが期間全体にわたって 200 件以上の処理中リクエストを抱えている | 重大 |
| Scheduler Backlog | スケジューリング | スケジューラーの保留中 Pod のキューが 5 分間空にならない | 警告 |
| High Node Disk Usage | ストレージ | ノードのファイルシステムの使用率が 90% を超えた | 警告 |
| DaemonSet Misscheduled Nodes | ワークロード | DaemonSet が、ノードセレクター、アフィニティ、トレレーションに合わなくなったノードで Pod を実行している | 警告 |
| High Node CPU Request Commitment | ノード | ノード上のコンテナの CPU リクエストの合計が割り当て可能な CPU の 90% を超えた | 警告 |
| High Node Memory Request Commitment | ノード | ノード上のコンテナのメモリリクエストの合計が割り当て可能なメモリの 90% を超えた | 警告 |
| HPA Saturated at Max Replicas | ワークロード | `minReplicas` を超えてスケールした HPA が `maxReplicas` の 90% 以上で動作している | 重大 |
| Pod Memory Saturating Container Limit | ワークロード | Pod がコンテナのメモリ上限の 90% を超えて使用している | 重大 |
| Pod CPU Saturating Container Limit | ワークロード | Pod がコンテナの CPU 上限の 90% を超えて使用している | 警告 |

オブジェクト単位のメトリクスを使うテンプレートは、ノード、Pod、Deployment、Job、DaemonSet、HPA をそれぞれ個別に評価します。そのため、不健全な Pod が複数あるクラスターでは、クラスター全体で 1 件ではなく Pod ごとにインシデントが作成されます。

**High Node CPU Request Commitment** と **High Node Memory Request Commitment** は、スケジューラーと同じく、終了していない Pod のリクエストだけを数えます。Succeeded または Failed になった Pod (完了した Job の Pod など) のリクエストは、Pod が削除されるまでクラスターが報告し続けますが、それらは数えません。

**Cluster Stopped Reporting** は、クラスターのエージェントから 10 分間何も届かないときに発火します。エージェントがアンインストールされたかクラッシュを繰り返している場合、API キーが取り消された場合、OneUptime への経路を失った場合、またはクラスターの API サーバーがエージェントに応答しなくなった場合です。データが戻ると解決します。データが途絶えると、ほかのテンプレートは比較するものがなくなって最後のステータスを保ったままになるため、それを知らせてくれるのはこのテンプレートです。

> [!NOTE]
> **CrashLoopBackOff Detection** は、エージェントがサンプルごとに送る `k8s.container.restarts.increase`（そのコンテナの前回のサンプル以降の再起動数）を合計します。そのため、サンプルの間隔がどれだけ空いてもすべての再起動を数え、再起動が止まれば自動で解消し、作り直された Pod は再起動として読まれずに新しく数え始めます。古いエージェントは `k8s.container.restarts.increase` を送らないため、先に[アップグレード](/docs/monitor/kubernetes-agent#アップグレード)してください。それ以前にテンプレートから作成したモニターは、`k8s.container.restarts` が各分の中でどれだけ増えたかを読むため、クラッシュループの再起動のおよそ半分を見逃します。削除してテンプレートから作り直してください。

> [!NOTE]
> **Job Failures** は、エージェントがサンプルごとに送る `k8s.job.failed_pods.increase`（その Job の前回のサンプル以降に失敗した Pod 数）を合計します。そのため、サンプルの間隔がどれだけ空いてもすべての失敗を数え、失敗が止まれば自動で解消し、同じ名前で作り直された Job は失敗として読まれずに新しく数え始めます。エージェントが Job を初めてサンプルする前の失敗はその数え始めの値になるため、最初の 30 秒以内に失敗して再試行しない Job は見逃されることがあります。古いエージェントは `k8s.job.failed_pods.increase` を送らないため、先に[アップグレード](/docs/monitor/kubernetes-agent#アップグレード)してください。それ以前にテンプレートから作成したモニターは、`k8s.job.failed_pods` が各分の中でどれだけ増えたかを読むため、失敗のおよそ半分を見逃します。削除してテンプレートから作り直してください。

### 症状だけでなく原因を捉える

ノードレベルのテンプレート（High Node CPU Utilization、High Node Memory Utilization、Node Not Ready、Pod Stuck in Pending）は、リソース枯渇の連鎖の*終わり*、つまりクラスターがすでに機能低下しているときに発火します。次の 3 つのテンプレートは連鎖の*始まり*で発火し、たいていはそこに解決策があります。

- **Pod Memory Saturating Container Limit** と **Pod CPU Saturating Container Limit** は、自身の上限に張り付いたワークロードを捉えます。メモリ上限を超えると即座に OOMKill され、CPU 上限を超えるとカーネルが Pod をスロットリングするため、エラーを出さないまま遅くなります。どちらも CrashLoopBackOff や原因不明の遅延のよくある原因です。
- **HPA Saturated at Max Replicas** は、余裕のなくなったオートスケーラーを捉えます。Pod ごとの上限が低すぎるワークロードはスロットリングされたり強制終了されたりし、それが HPA のスケーリング基準となるメトリクスそのものを押し上げます。そのためオートスケーラーは、同じようにリソース不足のレプリカを上限に達するまで追加し続けます。解決策は上限を引き上げることで、`maxReplicas` を引き上げると悪化します。

オートスケールするワークロードを実行するすべての Namespace で、これらをまとめて有効にしてください。組み合わせることで、「本当に容量が足りない」のか「Pod ごとのリソースが不足している」のかを見分けられます。

> [!NOTE]
> 2 つの Pod 上限テンプレートは、Pod の使用量をコンテナの上限の**合計**で割るため、サイドカーを持つ Pod も正しく測定されます。kubelet が報告する Pod のメモリには回収可能なページキャッシュが含まれるため、ファイルを多用するワークロードは OOMKill されないままメモリテンプレートで高い値を示すことがあります。「強制終了寸前」ではなく「上限に近づいている」と読んでください。

## トラブルシューティング

:::details クラスターが Kubernetes クラスター の一覧にない
クラスターは、エージェントのデータから、エージェントのインストール時の `clusterName` で自動登録されます。エージェントの Pod が実行中で、クラスターが **製品 → インフラストラクチャ → Kubernetes → すべてのクラスター** に表示されていることを確認してください。[Kubernetes エージェント (Helm インストール)](/docs/monitor/kubernetes-agent) では、インストール方法とデータが届かないときの確認事項を説明しています。
:::

:::details コントロールプレーンのテンプレートが発火しない
**etcd No Leader**、**API Server Request Saturation**、**Scheduler Backlog** は、エージェントのコントロールプレーンのスクレイプでのみ収集されるメトリクスを読み取ります。エージェントの Helm の値で `controlPlane.enabled` を有効にしてください。既定では無効です。これで API サーバーが読み取られます。etcd とスケジューラーはコントロールプレーンのノードで動作するため、**etcd No Leader** と **Scheduler Backlog** には、エージェントの Pod から到達できるアドレスを設定した `controlPlane.etcd.endpoints` と `controlPlane.scheduler.endpoints` も必要です（[コントロールプレーンの監視を有効にする](/docs/telemetry/kubernetes-agent#コントロールプレーンの監視を有効にする) を参照）。マネージドクラスター（EKS、GKE、AKS）はこれらのエンドポイントを公開しないため、そこではこれらのモニターにデータが届きません。
:::

:::details CPU のしきい値が発火しない
**Pod CPU Usage** と **Node CPU Usage** の単位はパーセントではなくコア数なので、しきい値 `80` は 80 コアを意味します。しきい値をコア数で設定するか、パーセントで比較する **High Node CPU Utilization** または **Pod CPU Saturating Container Limit** から始めてください。
:::

:::details 再起動で CrashLoopBackOff Detection が発火しなかった
このテンプレートは、コンテナが 15 分以内に再起動し、かつその半分未満しか準備完了でなかったときに発火します。そのため、1 回再起動してすぐに戻ったコンテナでは通知されません。読むのは `k8s.container.restarts.increase` で、古いエージェントはこれを送りません。[エージェントをアップグレード](/docs/monitor/kubernetes-agent#アップグレード)してください。それ以前にテンプレートから作成したモニターは、`k8s.container.restarts` が同じ分の 2 つのサンプル間でどれだけ増えたかを読むため、2 つの分にまたがるサンプル間の再起動を見逃します。削除してテンプレートから作り直してください。`filters.metrics.include` でエージェントが送るメトリクスを列挙している場合は、`k8s.container.restarts.increase` を追加してください。ワークロードに絞り込んだモニターには `k8s.container.restarts.increase` のワークロード名も必要ですが、古いエージェントはそれを付けずに送ります。[エージェントをアップグレード](/docs/monitor/kubernetes-agent#アップグレード)してください。
:::

:::details 失敗した Job で Job Failures が発火しなかった
このテンプレートは、Job の Pod が 15 分以内に失敗したときに発火し、最後の失敗から 15 分後に解消します。読むのは `k8s.job.failed_pods.increase` で、古いエージェントはこれを送りません。[エージェントをアップグレード](/docs/monitor/kubernetes-agent#アップグレード)してください。それ以前にテンプレートから作成したモニターは、`k8s.job.failed_pods` が同じ分の 2 つのサンプル間でどれだけ増えたかを読むため、2 つの分にまたがるサンプル間の失敗を見逃します。削除してテンプレートから作り直してください。エージェントが Job を初めてサンプルする前の失敗はその数え始めの値になるため、唯一の Pod が最初の 30 秒以内に失敗した Job は見逃されます。`filters.metrics.include` でエージェントが送るメトリクスを列挙している場合は、`k8s.job.failed_pods.increase` を追加してください。ワークロードに絞り込んだモニターでは Job そのものを指定してください。Job の失敗 Pod に付くのは Job の名前と Namespace で、それを作成した CronJob の名前ではありません。
:::

## 次のステップ

:::cards
- [Kubernetes エージェント (Helm インストール)](/docs/monitor/kubernetes-agent): Helm でエージェントをインストール、アップグレード、調整します。
- [Kubernetes エージェント](/docs/telemetry/kubernetes-agent): Namespace フィルター、コントロールプレーンのメトリクス、ログの重大度フィルター、AI エージェント。
- [メトリクス モニター](/docs/monitor/metrics-monitor): エージェントのカスタムメトリクスや eBPF メトリクスを含む、あらゆるメトリクスでアラートを出します。
- [インシデント & アラート テンプレート](/docs/monitor/incident-alert-templating): しきい値を超えた Pod やノードをインシデントのタイトルに入れます。
:::
