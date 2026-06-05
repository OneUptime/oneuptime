# Telegram 連携

インシデントの更新を [Telegram](https://telegram.org) のチャットまたはグループに送信します。OneUptime には **Telegram** ワークフローコンポーネントが組み込まれているため、セットアップはすぐに完了します。

この連携は**アウトバウンド**です: OneUptime が Telegram ボットを通じてメッセージを送信します。

```text
OneUptime Incident → On Create  ──►  Telegram component  ──►  message in your chat
```

## ステップ 1 — ボットを作成してトークンを取得する

1. Telegram で [@BotFather](https://t.me/BotFather) にメッセージを送り、`/newbot` を送信します。
2. プロンプトに従います。BotFather が `123456789:AA...` のような**ボットトークン**を発行します。

## ステップ 2 — チャット ID を調べる

1. ボットをグループに追加する (またはボットとダイレクトチャットを始める) かして、何かメッセージを送ります。
2. ブラウザで `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` を開きます。
3. レスポンスの `"chat":{"id":...}` を見つけます — その数字が**チャット ID** です (グループ ID は負の値)。

## ステップ 3 — シークレットを保存する

1. OneUptime で **Workflows → Global Variables → Create** に移動します。
2. `TELEGRAM_BOT_TOKEN` (シークレット) と `TELEGRAM_CHAT_ID` を作成します。

## ステップ 4 — ワークフローを作成する

1. **Workflows → Create Workflow** を開き、`Incidents → Telegram` という名前にして **Builder** を開きます。
2. **Incident** トリガーを **On Create** に設定して追加します。`Incident` にリネームします。
3. トリガーに接続した **Telegram** コンポーネントを追加します:
   - **Bot token**: `{{variable.TELEGRAM_BOT_TOKEN}}`
   - **Chat ID**: `{{variable.TELEGRAM_CHAT_ID}}`
   - **Message**: `🔴 New incident: {{Incident.title}}\n{{Incident.description}}`
4. **Save** して有効化し、テスト用インシデントを作成します。メッセージがチャットに届きます。

## 代替方法: API コンポーネント

**API** ブロックでも同様に動作します:

- **Method**: `POST`
- **URL**: `https://api.telegram.org/bot{{variable.TELEGRAM_BOT_TOKEN}}/sendMessage`
- **Headers**: `Content-Type: application/json`
- **Body**: `{ "chat_id": "{{variable.TELEGRAM_CHAT_ID}}", "text": "New incident: {{Incident.title}}" }`

## ヒント

- ボットはグループに追加され、**プライバシーモード**で許可されてからメッセージを受け取れるようになります。`getUpdates` が空の場合は先にボットにメッセージを送るか、BotFather でプライバシーモードを無効にします。
- 送信前に **Conditions** で重大度を絞り込みます。
- API ボディに `"parse_mode": "Markdown"` を追加する (またはコンポーネントのフォーマット機能を使う) と、太字やリンクが使えます。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — アウトバウンドパターン。
- [Discord](/docs/integrations/discord) — Discord に対する同じ考え方。
- [コンポーネント → Telegram](/docs/workflows/components#telegram) — コンポーネントリファレンス。
