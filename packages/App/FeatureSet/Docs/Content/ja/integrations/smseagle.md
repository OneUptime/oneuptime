# SMSEagle 連携

[SMSEagle](https://www.smseagle.eu) を通じて、アラート通知を SMS や電話で送ります。SMSEagle は、自社ネットワーク内に設置するハードウェア SMS ゲートウェイです。OneUptime には **SMSEagle** のワークフローコンポーネントが組み込まれているため、すぐに設定できます。

この連携は **アウトバウンド** です。OneUptime は [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/) を通じてメッセージを送ります。

```text
OneUptime のアラート → On Create  ──►  SMSEagle コンポーネント  ──►  電話への SMS または通話
```

## ステップ 1: API キーを作成する

1. SMSEagle の Web GUI で **Settings → API → API v2** を開き、**Create API key** をクリックします。
2. **Permissions** で **Send SMS** を許可し、電話も使う場合は **Make a TTS Advanced Call** も許可します。
3. キーをコピーします。OneUptime ではこれを **SMSEagle Access Token** と呼びます。

## ステップ 2: OneUptime からデバイスに届くようにする

1. OneUptime サーバーからデバイスのアドレス (例: `https://192.168.0.100`) への接続を、その間にあるファイアウォールと VPN で許可します。
2. SMSEagle デバイスは通常プライベートアドレスを持ち、ワークフローは既定でそれをブロックします。セルフホストのインスタンスでは、API サーバーの `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` にデバイスの IP アドレスまたはホスト名を追加し (例: `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`)、再起動します。[プライベートネットワークへのアクセス](/docs/self-hosted/private-network-access) を参照してください。

## ステップ 3: シークレットを保存する

1. OneUptime で **ワークフロー → グローバル変数 → 作成** を開きます。
2. `SMSEAGLE_URL`、`SMSEAGLE_ACCESS_TOKEN` (シークレット)、`ONCALL_PHONE` を作成します。

## ステップ 4: ワークフローを作る

1. **ワークフロー → ワークフローを作成** を開き、名前を `Alerts → SMSEagle` にして **ビルダー** を開きます。
2. **On Create** に設定した **Alert** トリガーを追加し、名前を `Alert` に変更します。
3. トリガーにつないだ **Send SMS via SMSEagle** コンポーネントを追加します。
   - **SMSEagle URL**: `{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**: `{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**: `{{variable.ONCALL_PHONE}}`
   - **Message Text**: `New alert: {{Alert.title}}`
4. **保存** をクリックし、ワークフローを有効にして、テスト用のアラートを作成します。電話に SMS が届きます。

テンプレート **Text a phone via SMSEagle when an alert fires** でも同じワークフローを作れます。

## SMS の代わりに電話

代わりに **Make a Call via SMSEagle** を使います。設定は同じで、それに加えてデバイス上の音声合成の声を表す **Voice ID** があり、**Text to Read Out** を読み上げます。API キーには **Make a TTS Advanced Call** の権限が必要です。

テンプレート **Call a phone via SMSEagle when an alert fires** で、電話をかける同じワークフローを作れます。

## 代替手段: API コンポーネント

**API** ブロックでも送れます。

- **Method**: `POST`
- **URL**: `{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**: `access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**: `{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## ヒント

- デバイスがメッセージを拒否した場合、理由はコンポーネントの **Error** の値に入ります。**エラー** の出力でログに記録してください。
- 送信前に **条件** で重大度を絞り込みます。
- 複数の人に届けるには、番号ごとに 1 つずつ SMSEagle コンポーネントをつなぎます。

## 次に読む

- [連携 概要](/docs/integrations/index): アウトバウンドの仕組み。
- [コンポーネント → SMSEagle](/docs/workflows/components#smseagle): コンポーネントのリファレンス。
