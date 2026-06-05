# Grafana 連携

[Grafana](https://grafana.com) のアラートを OneUptime のインシデントに変換します。Grafana がダッシュボードのアラートルールを評価し、OneUptime が記録・エスカレーション・追跡します。

この連携は**インバウンド**です: Grafana のアラート機能が Grafana の **Webhook コンタクトポイント**を使って、**Webhook トリガー**で始まる OneUptime の **[ワークフロー](/docs/workflows/index)** に POST します。

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## 前提条件

- [統合アラート](https://grafana.com/docs/grafana/latest/alerting/)が有効になった Grafana 9 以降 (モダンな Grafana ではデフォルトで有効)。
- Grafana が HTTPS で OneUptime インスタンスに到達できること。
- ワークフローを作成できる OneUptime プロジェクト。

## ステップ 1 — OneUptime ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Grafana → Incidents` という名前にして **Builder** を開きます。
2. **Webhook** トリガーを追加して **URL をコピー**します。ブロックを `Grafana` にリネームします。
3. トリガーに接続した **Conditions** ブロックを追加します:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. **Yes** から **Create Incident** ブロックを追加します:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: 1 つ選びます (または先に `{{Grafana.Request Body.commonLabels.severity}}` で分岐します)。
5. **Save** します (テストするまで無効のままにしておきます)。

Grafana の Webhook ペイロードは Alertmanager の形式に従います — `status`、`alerts` 配列、`commonLabels`、`commonAnnotations` に加えて、便利なトップレベルの `title` と `message` フィールドが含まれます。

## ステップ 2 — Grafana コンタクトポイントを設定する

1. Grafana で **Alerting → Contact points → Add contact point** に移動します。
2. **Name**: `OneUptime`。**Integration**: **Webhook**。
3. **URL**: ワークフローの Webhook URL を貼り付けます。**HTTP Method**: `POST`。
4. コンタクトポイントを保存します。
5. **Alerting → Notification policies** に移動して、送りたいアラート (またはデフォルトポリシー) を **OneUptime** コンタクトポイントにルーティングします。

## ステップ 3 — テストする

1. ワークフローを有効化します。
2. コンタクトポイント画面で **Test** を使ってサンプル通知を送るか、実際のアラートルールを発火させます。
3. ワークフローの **Logs** タブと **Incidents** リストを確認します。

## 回復時に解決する (オプション)

アラートがクリアされると、Grafana は `status: resolved` の別の通知を送ります。2 つ目の **Conditions** ブランチ (`status == resolved`) を追加し、マッチするインシデントを見つけて **Update Incident** で解決済み状態に変更します。

## 補足

- **レガシーアラート (Grafana 8 以前)** は異なるペイロード (`ruleName`、`state`、`evalMatches`) を送ります。レガシーアラートを使用している場合は、`{{Grafana.Request Body.ruleName}}` と `{{Grafana.Request Body.state}}` を参照し、`state == alerting` で分岐してください。
- Grafana のアラート機能を使わずに、OneUptime が同じメトリクスを直接監視することもできます — [Metrics Monitor](/docs/monitor/metrics-monitor) を参照してください。

## トラブルシューティング

- **実行が表示されない** — Grafana が URL に到達できるか確認し (Grafana のサーバーログを確認)、ワークフローが **Enabled** であることを確認します。
- **フィールドが空** — **Logs** タブでトリガーの出力を確認し、使用しているアラートのバージョンに存在するフィールドを参照します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンドパターン。
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — 類似のペイロード。
- [Metrics Monitor](/docs/monitor/metrics-monitor) — OneUptime でメトリクスを直接監視する。
