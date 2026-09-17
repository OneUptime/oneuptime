# Prometheus Alertmanager 連携

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) の通知を OneUptime のインシデントに変換します。Prometheus がアラートルールを評価し、Alertmanager がルーティングし、OneUptime が記録してエスカレーションします。

この連携は**インバウンド**で、構築方法は 2 つあります。

| 方式                                                                        | 選ぶ場面                                                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[受信リクエストモニター](/docs/monitor/incoming-request-monitor)** (推奨) | アラートをオンコールエスカレーション付きのインシデントにし、アラートごとに 1 件のインシデントを作り、復旧時に自動解決したい場合。独自ロジックの保守も不要です。 |
| **[ワークフロー](/docs/workflows/index) + Webhook トリガー**                | OneUptime が標準で行わないルーティングロジックが必要な場合 — 他システムの呼び出し、ペイロードの整形、条件分岐など。                                             |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## 前提条件

- `alertmanager.yml` を編集できる Prometheus + Alertmanager 環境。
- Alertmanager から OneUptime インスタンスへ HTTPS で到達できること。
- モニター (またはワークフロー) を作成できる OneUptime プロジェクト。

## オプション 1 — 受信リクエストモニター

### ステップ 1 — モニターを作成する

1. **モニター → モニターを作成** に移動し、**受信リクエスト** を選びます。
2. モニターを開き、左メニューの **Documentation** をクリックします。URL をコピーします。

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   セルフホストの場合は自分のホストを使ってください。パスに含まれるシークレットキーが唯一の認証情報です。

### ステップ 2 — Alertmanager をモニターに向ける

`alertmanager.yml` で:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` は必須です。アラートが復旧したことを OneUptime に伝えるのはこの設定です。`curl -X POST http://localhost:9093/-/reload` で Alertmanager をリロードするか、再起動してください。

Alertmanager は `Content-Type: application/json` を送信します。OneUptime がペイロードからフィールドを読み取るにはこれが必要です。

### ステップ 3 — 条件を設定する

モニターの **Criteria** を開き、最初の条件を編集します。

**フィルター**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  文字列比較にはプレースホルダーを囲む引用符が必要です。式を使いたくない場合は `Request Body` / `Contains` / `"status":"firing"` のフィルターでも動作します。

**アクション**

- _When filters match, change monitor status_ を有効にし、**Offline** (または Degraded) に設定します。
- _When filters match, declare an incident_ を有効にします。**Title**、**Severity**、呼び出す **On-Call Policies** を設定します。
- そのインシデントの **Advanced Options** で **Auto Resolve Incident** を有効にします。これがないと復旧通知は無視され、インシデントは永久に開いたままになります。

**Settings → Group incidents and alerts by a payload field**

これを有効にすると、1 つのエンドポイントで通知ごとに 1 件ではなく、アラートごとに 1 件ずつ複数のインシデントを同時に保持できます。

| フィールド                         | 値                                  |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` は Alertmanager の `alerts` 配列に展開され、抽出された値が**異なる**ごとに 1 件のインシデントを開きます。両方のパスが `[*]` を使うため、復旧はアラート単位で判定されます。1 件が解決し 2 件がまだ発火しているペイロードでは、解決した 1 件だけがクローズされます。

> **Warning:** アラートごとに本当に一意なものでグループ化してください。Alertmanager の `fingerprint` はアラートのラベルセット全体のハッシュなので、常に一意です。ラベルが使えるのは、それが 1 つの通知の**内部**で変化する場合だけです。ルートの `group_by` に列挙されたラベルは、まさにそれが集約グループを定義しているため、決して変化しません。上記の `group_by: ["alertname", "instance"]` の場合、`requestBody.alerts[*].labels.alertname` でグループ化するとペイロード内のすべてのアラートから同じ値が抽出され、すべてが 1 件のインシデントにまとまってしまいます。さらに悪いことに、値が重複した場合は**最初**の出現だけが保持されるため、最初のアラートが `resolved` のペイロードでは、残りがまだ発火中でもそのインシデントがクローズされます。

### ステップ 4 — インシデントのタイトルと説明を書く

グルーピングキーはパスの最後のセグメントにちなんだ変数として利用でき、`requestBody.alerts[*].fingerprint` なら `{{fingerprint}}` になります。これはハッシュであり対応者に見せるものではないので、代わりに通知全体で共通のラベルからタイトルを作ってください。`commonLabels` にはルートの `group_by` にあるすべてのラベルが含まれるため、上記の設定なら `alertname` と `instance` の両方を使えます。

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` と `commonAnnotations` には通知全体で共通のフィールドが入ります。`requestBody.alerts[0].annotations.summary` のようなアラート単位のパスは、常にペイロードの*最初*のアラートを読み取り、そのインシデントが開かれた対象のアラートではありません。各インシデントに固有のアノテーション文を持たせたい場合は `group_by` を絞り込んでください。解決しないパスは空になるのではなく、波括弧を含めてそのまま出力されます。変数の全一覧は [インシデント & アラートの動的テンプレート](/docs/monitor/incident-alert-templating) を参照してください。

### ステップ 5 — モニターを Operational に戻す (オプション)

条件は一致したときにしか動作しないため、すべてが収まった後にモニターが Offline のままにならないよう、2 つ目の条件を追加します。

- **Filter Type**: `JavaScript Expression`、**Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational** とし、インシデントは作成しません。

### ステップ 6 — テストする

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

`fingerprint` ごとに 1 件、計 2 件のインシデントができるはずです。両方のアラートの `status` を `resolved` にして再送すると、どちらもクローズされるはずです。

`amtool` で実際のアラートを発火させることもできます。

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## オプション 2 — ワークフロー

「アラートがインシデントになる」以上のロジックが必要な場合に使います。

1. **ワークフロー → ワークフローを作成** を開き、`Alertmanager → Incidents` という名前にして **ビルダー** を開きます。
2. **Webhook** トリガーを追加して **URL をコピー**します。ブロックを `Alertmanager` にリネームします。
3. トリガーに接続した **条件** ブロックを追加します:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **はい** から **インシデントを作成** ブロックを追加します:
   - **タイトル**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **説明**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **重大度**: 1 つ選びます (先に `{{Alertmanager.Request Body.commonLabels.severity}}` で分岐することもできます)。
5. **保存** したうえで、上のステップ 2 の `webhook_configs` の URL をワークフローの URL に向け直します。

アラートごとに 1 件のインシデントを作るには、`Request Body.alerts` をループする [Custom Code](/docs/workflows/components#custom-code) ブロックを追加します。`send_resolved: true` を使う場合は、`status == resolved` を条件とする 2 つ目の **条件** 分岐を追加し、該当するインシデントを検索して **Update Incident** で解決状態へ移します。

## デッドマンスイッチ

どちらのオプションも、Prometheus 自体が停止したことは教えてくれません。アラートが来ないことは、何も問題がないのと見分けがつかないからです。一般的な対処は、常に発火するアラートを、それをスケジュールどおりに受け取ることを期待するモニターへルーティングすることです。[kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) には `Watchdog` という名前のものが同梱されています。素の Prometheus では、常に真になる式 (`vector(1)`) のアラートルールを追加してください。

**2 つ目の**受信リクエストモニターを作成し、短い `repeat_interval` で `Watchdog` をそこへルーティングして、そのモニターに **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** の条件を設定します。リクエスト欠落の条件がアラート受信側にふさわしいのは、この 1 つのケースだけです。

以下はステップ 2 の設定に watchdog のルートとレシーバーを組み込んだものです。サブルートは親ルート自身のレシーバーより先に照合されるため、`Watchdog` は 2 つ目のモニターへ、それ以外はこれまでどおり 1 つ目のモニターへ届きます。

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## トラブルシューティング

- **何も届かない** — Alertmanager が URL に到達できることを確認し、そのログに配信エラーがないか確認します。OneUptime は何も検証する前に空の `200` をすべてのリクエストに返すため、`200` はペイロードが受理されたことを示しません。代わりにモニターのタイムラインを確認してください。
- **インシデントは作成されるがクローズされない** — Alertmanager の `send_resolved: true`、条件の復旧フィールドと値 (比較は大文字と小文字を区別します)、インシデントの **Advanced Options** にある **Auto Resolve Incident** を確認します。より分かりにくい原因が 2 つあります。**Max incidents per request** より多くの異なるキーを含むペイロードでは、上限を超えたキーは復旧処理からも見えません。また、取り込み時の結合 (下記) で落とされたのが `resolved` 通知だった場合、Alertmanager は発火通知は繰り返しても解決通知は繰り返さないため、そのインシデントは永久に取り残されます。これらは手作業でクローズしてください。
- **インシデントがまったく作成されず、モニターのステータスも変わらない** — グルーピングパスはリテラルの `requestBody.` で始まる必要があり、ワイルドカードとして働くのはパス中の最初の `[*]` だけです。どちらの誤りも警告なしに失敗します。
- **インシデントの本文に生の `{{...}}` プレースホルダーが表示される** — パスが解決されず、OneUptime は未解決のプレースホルダーを空にせずそのまま残します。ルールによって設定されるアノテーションは異なるため、自分のルールで実際に存在するフィールド (`commonAnnotations` かアラート単位の `annotations` か) を参照してください。
- **アラートが多数入ったペイロードでインシデントが 1 件しかできない** — 通知内で変化しないラベル、多くの場合ルートの `group_by` にも含まれるラベルでグループ化しています。代わりに `requestBody.alerts[*].fingerprint` でグループ化してください。
- **インシデントが多すぎる** — `group_by` / `group_interval` を広げて、Alertmanager が関連するアラートをまとめるようにします。**Max incidents per request** を下げれば件数は抑えられますが、上限を超えたキーは復旧処理からも見えなくなります。
- **大量のバースト時に一部の通知がスキップされているように見える** — 1 つの送信元がモニターを圧倒しないよう、同じモニター宛のリクエストは取り込み時に結合されます。そのため通知が連続して届くと途中のペイロードが落ちることがあります。`group_wait` と `group_interval` を大きくすると間隔が空きます。結合はアプリコンテナの環境変数 `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` で制御され、既定では有効です。すべてのペイロードを評価する必要があるセルフホストの運用者は、そのコンテナで `false` に設定できます。

## 次に読むべきページ

- [受信リクエストモニター](/docs/monitor/incoming-request-monitor) — モニタータイプ、その条件、インシデントグルーピングの詳細。
- [インテグレーションの概要](/docs/integrations/index) — インバウンドとアウトバウンドのパターン。
- [Grafana](/docs/integrations/grafana) — 同じ考え方を Grafana のアラートで。
- [Webhook トリガー](/docs/workflows/triggers#webhook) — ワークフローの受信 URL の仕組み。
