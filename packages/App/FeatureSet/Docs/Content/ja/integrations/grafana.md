# Grafana 連携

[Grafana](https://grafana.com) のアラートを OneUptime のインシデントに変換します。Grafana はダッシュボード上のアラートルールを評価し、OneUptime がそれを記録・エスカレーション・追跡します。

この連携は**インバウンド**で、Grafana の **Webhook コンタクトポイント** が OneUptime へ POST します。受け取り方は 2 通りあります。

| 方式                                                                        | 選ぶ場面                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **[受信リクエストモニター](/docs/monitor/incoming-request-monitor)** (推奨) | アラートをオンコールエスカレーション付きのインシデントにし、アラートごとに 1 件のインシデントを作り、復旧時に自動解決したい場合。 |
| **[ワークフロー](/docs/workflows/index) + Webhook トリガー**                | OneUptime が標準で行わないルーティングロジックが必要な場合 — 他システムの呼び出し、ペイロードの整形、条件分岐など。               |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana の Webhook ペイロードは Alertmanager の形式に従います — `status`、`alerts` 配列、`commonLabels`、`commonAnnotations` に加えて、便利なトップレベルの `title` と `message` フィールドが含まれます。

## 前提条件

- [Unified alerting](https://grafana.com/docs/grafana/latest/alerting/) が有効な Grafana 9 以降 (最近の Grafana では既定で有効)。
- Grafana から OneUptime インスタンスへ HTTPS で到達できること。
- モニター (またはワークフロー) を作成できる OneUptime プロジェクト。

## オプション 1 — 受信リクエストモニター

1. **モニター → モニターを作成** に移動して **受信リクエスト** を選びます。モニターを開き、左メニューの **Documentation** をクリックして URL をコピーします。
2. モニターの **Criteria** を開き、**Filter Type** を `JavaScript Expression`、**Value** を `"{{requestBody.status}}" === "firing"` に設定します。
3. 一致時にインシデントを作成し、呼び出す **On-Call Policies** を選び、**Advanced Options** で **Auto Resolve Incident** を有効にします。
4. **Settings** で **Group incidents and alerts by a payload field** を有効にし、次を設定します。

   | フィールド                         | 値                                  |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. インシデントのタイトルを `{{requestBody.commonLabels.alertname}}` にし、説明には `{{requestBody.message}}` または `{{requestBody.commonAnnotations.summary}}` を使います。(`{{fingerprint}}` にはグルーピングキーそのものが入りますが、ハッシュなので対応者に見せるものではありません。)
6. Grafana のコンタクトポイントをモニターの URL に向けます (下のコンタクトポイントの手順を参照)。

**異なる**グルーピング値ごとに個別のインシデントが作られ、Grafana が解決を報告した時点でそれぞれがクローズされます。Grafana のアラート単位の `fingerprint` はアラートのラベルセットに対して一意なので、上ではこれをグルーピングパスにしています。[Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) のページでは同じ設定をより詳しく説明しています。ペイロードの形式は同じなので、そこでの手順はすべてここにも当てはまります。

> **Warning:** 通知全体で一定のラベルでグループ化しないでください。Grafana の既定の通知ポリシーは `grafana_folder` と `alertname` でグループ化するため、1 つの Webhook に含まれるアラートはすべて同じ alertname を持ちます。`requestBody.alerts[*].labels.alertname` でグループ化すると、ペイロード全体が 1 件のインシデントにまとまってしまいます。またグルーピングパスはリテラルの `requestBody.` で始まる必要があり、ワイルドカードとして働くのはパス中の最初の `[*]` だけです。いずれも警告なしに失敗します。

## オプション 2 — ワークフロー

「アラートがインシデントになる」以上のロジックが必要な場合に使います。

### ステップ 1 — OneUptime ワークフローを作成する

1. **ワークフロー → ワークフローを作成** を開き、`Grafana → Incidents` という名前にして **ビルダー** を開きます。
2. **Webhook** トリガーを追加して **URL をコピー**します。ブロックを `Grafana` にリネームします。
3. トリガーに接続した **条件** ブロックを追加します:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **はい** から **インシデントを作成** ブロックを追加します:
   - **タイトル**: `{{Grafana.Request Body.title}}`
   - **説明**: `{{Grafana.Request Body.message}}`
   - **重大度**: 1 つ選びます (または `{{Grafana.Request Body.commonLabels.severity}}` で分岐します)。
5. **保存** します (テストするまで無効のままにしておきます)。

## Grafana コンタクトポイントを設定する

1. Grafana で **Alerting → Contact points → Add contact point** に移動します。
2. **Name**: `OneUptime`。**Integration**: **Webhook**。
3. **URL**: オプション 1 のモニター URL、またはオプション 2 のワークフローの Webhook URL を貼り付けます。**HTTP Method**: `POST`。
4. コンタクトポイントを保存します。
5. **Alerting → Notification policies** に移動し、対象のアラート (または既定のポリシー) を **OneUptime** コンタクトポイントへルーティングします。

## テストする

1. ワークフローを作成した場合は有効にします。
2. コンタクトポイントの画面で **Test** を使ってサンプル通知を送るか、実際のアラートルールを発火させます。
3. **インシデント** の一覧を確認します。オプション 2 を使った場合はワークフローの **ログ** タブも確認します。

## 回復時に解決する

アラートが収まると、Grafana は `status: resolved` を含む通知をもう一度送ります。

**オプション 1** では、上で設定した復旧フィールドと値によって該当するインシデントが自動的にクローズされます。ただし **Auto Resolve Incident** が有効になっていることが前提です。

**オプション 2** では、2 つ目の **条件** 分岐 (`status == resolved`) を追加し、該当するインシデントを検索して **Update Incident** で解決状態へ移します。

## 補足

- **レガシーアラート (Grafana 8 以前)** は異なるペイロード (`ruleName`、`state`、`evalMatches`) を送ります。レガシーアラートを使っている場合は代わりに `{{Grafana.Request Body.ruleName}}` と `{{Grafana.Request Body.state}}` を参照し、`state == alerting` で分岐してください。
- Grafana のアラート機能を使わず、同じメトリクスを OneUptime から直接監視することもできます — [メトリクスモニター](/docs/monitor/metrics-monitor) を参照してください。

## トラブルシューティング

- **何も届かない** — Grafana が URL に到達できることを確認し (Grafana のサーバーログを確認)、オプション 2 の場合はワークフローが **有効** であることを確認します。OneUptime は検証前にすべての受信リクエストへ空の `200` を返すため、Grafana のログにある `200` はペイロードが受理されたことを示しません。
- **インシデントは作成されるがクローズされない** — 条件の復旧フィールドと値、そしてインシデントの **Advanced Options** で **Auto Resolve Incident** が有効かを確認します。比較は大文字と小文字を区別します。
- **アラートが多数入ったペイロードでインシデントが 1 件しかできない** — 通知内で変化しないラベルでグループ化しています。代わりに `requestBody.alerts[*].fingerprint` でグループ化してください。
- **インシデントの本文に生の `{{...}}` プレースホルダーが表示される** — パスが解決されず、未解決のプレースホルダーは空にされずそのまま残ります。使用中のアラートのバージョンに存在するフィールドを参照してください。オプション 2 を使った場合は **ログ** タブでトリガーの出力を確認します。

## 次に読むべきページ

- [受信リクエストモニター](/docs/monitor/incoming-request-monitor) — モニタータイプ、その条件、インシデントグルーピングの詳細。
- [インテグレーションの概要](/docs/integrations/index) — インバウンドのパターン。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — よく似たペイロード。
- [メトリクスモニター](/docs/monitor/metrics-monitor) — OneUptime で直接メトリクスを監視する。
