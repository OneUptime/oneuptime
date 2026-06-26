# Discord 連携

インシデントの更新を [Discord](https://discord.com) チャンネルに投稿します。OneUptime には **Discord** ワークフローコンポーネントが組み込まれているため、最も素早くセットアップできる連携の 1 つです。

この連携は**アウトバウンド**です: OneUptime が受信 Webhook URL を通じて Discord チャンネルに投稿します。

```text
OneUptime Incident → On Create  ──►  Discord component  ──►  message in your channel
```

## ステップ 1 — Discord の Webhook を作成する

1. Discord で対象チャンネルの **Edit Channel → Integrations → Webhooks** を開きます。
2. **New Webhook** をクリックして名前を付け (例: `OneUptime`)、チャンネルを選んで **Copy Webhook URL** をクリックします。

## ステップ 2 — Webhook URL を保存する (オプションだが推奨)

1. OneUptime で **Workflows → Global Variables → Create** に移動します。
2. `DISCORD_WEBHOOK_URL` という名前にして URL を貼り付け、**Is Secret** をオンにします。

変数に保存しておくと、複数のワークフローで再利用でき、1 か所でローテーションできます。

## ステップ 3 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → Discord` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **Discord** コンポーネントを追加します:
   - **Webhook URL**: `{{variable.DISCORD_WEBHOOK_URL}}` (または直接貼り付けます)。
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** して有効化し、テスト用インシデントを作成します。メッセージがチャンネルに表示されます。

## 代替方法: API コンポーネント

専用コンポーネントを使いたくない場合は、**API** ブロックでも同じことができます:

- **Method**: `POST`
- **URL**: `{{variable.DISCORD_WEBHOOK_URL}}`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "content": "New incident: {{Incident.title}}" }`

Discord のリッチな [embeds](https://discord.com/developers/docs/resources/webhook#execute-webhook) を使いたい場合に便利です — ボディに `embeds` 配列を追加します。

## ヒント

- **Conditions** を使って特定の重大度のみ投稿する — Discord ブロックの前に `{{Incident.incidentSeverity.name}}` で分岐します。
- **Incident → On Update** でさらにワークフローを追加して、同じチャンネルに確認や解決のメッセージを投稿します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — アウトバウンドパターン。
- [Telegram](/docs/integrations/telegram) — Telegram に対する同じ考え方。
- [コンポーネント → Discord](/docs/workflows/components#discord) — コンポーネントリファレンス。
