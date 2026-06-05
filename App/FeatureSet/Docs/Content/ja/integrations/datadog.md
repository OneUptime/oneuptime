# Datadog 連携

[Datadog](https://www.datadoghq.com) のモニターアラートを OneUptime のインシデントに変換します。Datadog の検知が OneUptime のインシデント対応とステータスページに連携されます。

この連携は**インバウンド**です: Datadog の [Webhooks インテグレーション](https://docs.datadoghq.com/integrations/webhooks/)が **Webhook トリガー**で始まる OneUptime の **[ワークフロー](/docs/workflows/index)** に POST します。

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- インテグレーションとモニターを設定できる Datadog アカウント。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — OneUptime ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Datadog → Incidents` という名前にして **Builder** を開きます。
2. **Webhook** トリガーを追加して **URL をコピー**します。ブロックを `Datadog` にリネームします。
3. トリガーに接続した **Conditions** ブロックを追加します:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. **Yes** から **Create Incident** ブロックを追加します:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: 1 つ選びます。
5. **Save** します (テストするまで無効のままにしておきます)。

## ステップ 2 — Datadog の Webhook を作成する

1. Datadog で **Integrations → Webhooks** に移動します (まだの場合は **Webhooks** インテグレーションをインストールします)。
2. **Webhook を追加**します:
   - **Name**: `oneuptime` (`@webhook-oneuptime` になります)。
   - **URL**: ワークフローの Webhook URL。
   - **Payload** — Datadog では [テンプレート変数](https://docs.datadoghq.com/integrations/webhooks/#usage) を使って JSON ボディを定義できます:

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Webhook を保存します。

## ステップ 3 — モニターのアラートを Webhook に送る

転送したいモニターの**通知メッセージ**に Webhook ハンドルを追加します:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

これによりアラートと回復の両方が OneUptime に送られます。(すべてを転送する場合は条件なしで `@webhook-oneuptime` を追加することもできます。)

## ステップ 4 — テストする

1. ワークフローを有効化します。
2. モニターから **Test Notifications → Alert** を使うか、実際のモニターを発火させます。
3. ワークフローの **Logs** タブと **Incidents** リストを確認します。

## 回復時に解決する (オプション)

モニターがクリアすると `$ALERT_TRANSITION` は `Recovered` になります。2 つ目の **Conditions** ブランチ (`transition == Recovered`) を追加し、マッチするインシデントを見つけて (送信した `id` でマッチング)、**Update Incident** で解決済み状態に変更します。

## トラブルシューティング

- **実行が表示されない** — モニターのメッセージに `@webhook-oneuptime` が含まれていること、ワークフローが **Enabled** であることを確認します。
- **フィールドが空** — Datadog はイベントに該当するテンプレート変数のみを置換します。**Logs** タブでトリガーの出力を確認して Webhook ペイロードを調整します。
- **重複するインシデント** — 再アラート (renotify) するモニターは複数の `Triggered` イベントを送ります。作成前に `id` で **Find Incident** チェックを行って重複を排除します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンドパターン。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) と [Grafana](/docs/integrations/grafana) — 他のインバウンドソース。
- [Webhook トリガー](/docs/workflows/triggers#webhook) — 受信 URL の仕組み。
