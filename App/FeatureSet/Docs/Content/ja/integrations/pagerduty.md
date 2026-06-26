# PagerDuty 連携

OneUptime のインシデントが作成されるたびに [PagerDuty](https://www.pagerduty.com) のインシデントをトリガーし、OneUptime が解決したときに PagerDuty も解決します。PagerDuty がエスカレーションとオンコールスケジュールを管理しており、OneUptime の監視をそこに連携させたい場合に便利です。

この連携は**アウトバウンド**です: OneUptime が PagerDuty の [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/) を呼び出します。**Incident → On Create** トリガーと **API コンポーネント**を持つ OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。

> OneUptime にはオンコールとエスカレーションが組み込まれています — [オンコール](/docs/on-call/incoming-call-policy) を参照してください。PagerDuty にもイベントを送りたい場合にのみこの連携を使ってください。

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## 前提条件

- **Events API v2** インテグレーションを持つ PagerDuty サービス。PagerDuty で **Service → Integrations → Add integration → Events API v2** を設定します。**Integration Key** (ルーティングキーとも呼ばれます) をコピーします。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — ルーティングキーを保存する

1. **Workflows → Global Variables → Create** に移動します。
2. `PAGERDUTY_ROUTING_KEY` という名前にして、インテグレーションキーを貼り付け、**Is Secret** をオンにします。

## ステップ 2 — 「トリガー」ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → PagerDuty` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **API** ブロックを追加します:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   **`dedup_key`** は PagerDuty のインシデントと OneUptime のインシデントを紐付け、後で解決できるようにします。OneUptime のインシデント ID を使うことで一意性と予測可能性が保たれます。

4. **Save** して有効化し、テスト用インシデントを作成します。ワークフローのログに `202` レスポンスが表示されれば PagerDuty がイベントを受け付けたことを意味します。

## ステップ 3 — OneUptime の解決時に PagerDuty も解決する (推奨)

1. 同じワークフローに 2 つ目の **Incident** トリガーを追加できますか? いいえ — ワークフローはトリガーを 1 つしか持てません。代わりに、**Incident → On Update** トリガーを持つ `Resolve PagerDuty` という名前の**2 つ目のワークフロー**を作成します。
2. インシデントが解決済みになったことを確認する **Conditions** ブロックを追加します (`{{Incident.currentIncidentState.name}}` が解決済み状態名と一致するかで分岐します)。
3. **Yes** から、**同じ `dedup_key`** と `event_action` を `resolve` に設定した **API** ブロックを追加します:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty が `dedup_key` でマッチングして元のインシデントをクローズします。

## 重大度のマッピング (オプション)

PagerDuty の `severity` は `critical`、`error`、`warning`、`info` を受け付けます。OneUptime の重大度からマッピングするには、API ブロックの前に `{{Incident.incidentSeverity.name}}` で **Conditions** ブランチを追加し、それぞれから異なるボディを送ります。

## インバウンド (オプション)

逆方向 — PagerDuty イベントから OneUptime インシデントを開く — には、**Webhook** トリガーのワークフローを追加し、PagerDuty の [V3 Webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (またはイベントオーケストレーション) をその URL に向け、**Create Incident** を使います。[インバウンドパターン](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime) を参照してください。

## トラブルシューティング

- **`400` と `"invalid routing key"`** — インテグレーションは **Events API v2** である必要があります。古い Events API v1 や別のインテグレーションタイプは使えません。キーを再コピーしてください。
- **解決しても何もクローズされない** — 解決呼び出しの `dedup_key` がトリガー呼び出しと完全に一致している必要があります。
- **ログに何もない** — ワークフローが **Enabled** で、トリガーが **On Create** であることを確認します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — パターンと認証クイックリファレンス。
- [オンコール](/docs/on-call/incoming-call-policy) — OneUptime の組み込みエスカレーション。
- [Opsgenie](/docs/integrations/opsgenie) — Opsgenie に対する同じ考え方。
