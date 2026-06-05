# Prometheus Alertmanager 連携

[Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) の通知を OneUptime のインシデントに変換します。Prometheus がアラートルールを評価し、Alertmanager がルーティングし、OneUptime が記録・エスカレーションします。

この連携は**インバウンド**です: Alertmanager が **Webhook トリガー**で始まる OneUptime の **[ワークフロー](/docs/workflows/index)** に POST します。

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- `alertmanager.yml` を編集できる Prometheus + Alertmanager の環境。
- Alertmanager が HTTPS で OneUptime インスタンスに到達できること。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — OneUptime ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Alertmanager → Incidents` という名前にして **Builder** を開きます。
2. **Webhook** トリガーを追加して **URL をコピー**します。ブロックを `Alertmanager` にリネームします。
3. トリガーに接続した **Conditions** ブロックを追加します:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** から **Create Incident** ブロックを追加します:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: 1 つ選びます (先に `{{Alertmanager.Request Body.commonLabels.severity}}` で分岐することもできます)。
5. **Save** します (テストするまで無効のままにしておきます)。

> **グループ化されたアラートについて。** Alertmanager はアラートをグループ化して `alerts` **配列**として送ります。上記の `commonLabels` と `commonAnnotations` はグループ全体で共通のフィールドです — 通知ごとに 1 つのインシデントを作るのに最適です。**アラートごとに 1 つのインシデント**を作りたい場合は、`Request Body.alerts` をループして各アラートのインシデントを作成する [Custom Code](/docs/workflows/components#custom-code) ブロックを追加します。グループ化はルートの `group_by` で調整できます。

## ステップ 2 — Alertmanager を設定する

ワークフロー URL を向く Webhook レシーバーを追加し、アラートをそこにルーティングします。`alertmanager.yml` に以下を記述します:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Alertmanager をリロードします (`curl -X POST http://localhost:9093/-/reload` または再起動)。

## ステップ 3 — テストする

1. ワークフローを有効化します。
2. テストアラートを発火させます。たとえば `amtool` を使って:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. ワークフローの **Logs** タブと **Incidents** リストを確認します。

## 回復時に解決する (オプション)

`send_resolved: true` を設定すると、アラートがクリアされたときにも Alertmanager が POST します。このとき `status: resolved` が届きます。2 つ目の **Conditions** ブランチ (`status == resolved`) を追加し、マッチするインシデントを見つけて (`commonLabels.alertname` でマッチング)、**Update Incident** で解決済み状態に変更します。

## トラブルシューティング

- **実行が表示されない** — Alertmanager が URL に到達できるか確認し (Alertmanager のログで配信エラーを確認)、ワークフローが **Enabled** であることを確認します。
- **インシデントフィールドが空** — ルールによってアノテーションが異なります。**Logs** タブでトリガーの出力を確認し、実際に存在するフィールドを参照します (`commonAnnotations` 対 アラートごとの `annotations`)。
- **インシデントが多すぎる** — Alertmanager が関連アラートをまとめるよう `group_by`/`group_interval` を増やします。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンドパターン。
- [Grafana](/docs/integrations/grafana) — 同じ考え方を Grafana アラートに適用。
- [Webhook トリガー](/docs/workflows/triggers#webhook) — 受信 URL の仕組み。
