# SMSEagle 整合

透過 [SMSEagle](https://www.smseagle.eu) 以簡訊或電話傳送警示通知。SMSEagle 是安裝在你自己網路中的硬體簡訊閘道。OneUptime 內建 **SMSEagle** 工作流程元件，因此很快就能設定完成。

此整合是 **出站** 的：OneUptime 透過 [SMSEagle APIv2](https://www.smseagle.eu/docs/apiv2/) 傳送訊息。

```text
OneUptime 警示 → On Create  ──►  SMSEagle 元件  ──►  傳到手機的簡訊或電話
```

## 步驟 1：建立 API 金鑰

1. 在 SMSEagle 網頁 GUI 中，前往 **Settings → API → API v2**，然後按一下 **Create API key**。
2. 在 **Permissions** 下允許 **Send SMS**；如果需要電話，再允許 **Make a TTS Advanced Call**。
3. 複製金鑰。OneUptime 稱它為 **SMSEagle Access Token**。

## 步驟 2：讓 OneUptime 能連到裝置

1. 在兩者之間的防火牆和 VPN 中，允許從 OneUptime 伺服器到裝置位址（例如 `https://192.168.0.100`）的連線。
2. SMSEagle 裝置通常使用私有位址，而工作流程預設會封鎖私有位址。在自行託管的執行個體上，將裝置的 IP 位址或主機名稱加入 API 伺服器的 `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`，例如 `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST=192.168.0.100`，然後重新啟動它。請參閱 [私有網路存取](/docs/self-hosted/private-network-access)。

## 步驟 3：儲存機密資訊

1. 在 OneUptime 中，前往 **工作流程 → 全域變數 → 建立**。
2. 建立 `SMSEAGLE_URL`、`SMSEAGLE_ACCESS_TOKEN`（機密）和 `ONCALL_PHONE`。

## 步驟 4：建置工作流程

1. 開啟 **工作流程 → 建立工作流程**，命名為 `Alerts → SMSEagle`，然後開啟 **建構器**。
2. 新增一個設定為 **On Create** 的 **Alert** 觸發器，並將它重新命名為 `Alert`。
3. 新增一個連接到觸發器的 **Send SMS via SMSEagle** 元件：
   - **SMSEagle URL**：`{{variable.SMSEAGLE_URL}}`
   - **SMSEagle Access Token**：`{{variable.SMSEAGLE_ACCESS_TOKEN}}`
   - **Phone Number**：`{{variable.ONCALL_PHONE}}`
   - **Message Text**：`New alert: {{Alert.title}}`
4. 按一下 **儲存**，啟用工作流程，並建立一則測試警示。簡訊會傳到手機上。

範本 **Text a phone via SMSEagle when an alert fires** 會建置相同的工作流程。

## 以電話取代簡訊

改用 **Make a Call via SMSEagle**。它的設定相同，另外還有 **Voice ID**，也就是裝置上的語音合成聲音，並會朗讀 **Text to Read Out**。API 金鑰需要 **Make a TTS Advanced Call** 權限。

範本 **Call a phone via SMSEagle when an alert fires** 會建置相同、以電話通知的工作流程。

## 替代做法：API 元件

也可以使用 **API** 區塊：

- **Method**：`POST`
- **URL**：`{{variable.SMSEAGLE_URL}}/api/v2/messages/sms`
- **Headers**：`access-token: {{variable.SMSEAGLE_ACCESS_TOKEN}}`
- **Body**：`{ "to": ["{{variable.ONCALL_PHONE}}"], "text": "New alert: {{Alert.title}}" }`

## 提示

- 如果裝置拒絕了訊息，原因會放在元件的 **Error** 值中。請在 **錯誤** 輸出上將它記錄到日誌。
- 傳送前用 **條件** 依嚴重程度篩選。
- 要通知多個人，就連接多個 SMSEagle 元件，每個號碼一個。

## 接下來閱讀

- [整合總覽](/docs/integrations/index)：出站模式。
- [元件 → SMSEagle](/docs/workflows/components#smseagle)：元件參考。
