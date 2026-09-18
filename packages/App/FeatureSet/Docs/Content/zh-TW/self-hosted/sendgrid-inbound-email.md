# SendGrid 收件電子郵件整合

OneUptime 的 **收件電子郵件監控器（Incoming Email Monitor）** 可讓您根據傳送至各監控器專屬電子郵件地址的郵件來建立及解除警示。這對於整合舊有系統、警示工具，或任何能夠傳送電子郵件的服務都非常實用。

本指南說明如何設定 SendGrid Inbound Parse，將收件電子郵件轉送至您的自架 OneUptime 執行個體。

## 先決條件

- 具有 Inbound Parse 存取權的 SendGrid 帳戶
- 一個您所掌控且可存取 DNS 設定的網域
- 可將 SendGrid webhook 轉送至 OneUptime 的公開 HTTPS 端點

## 網路存取

Inbound Parse 需要由 SendGrid 主動連線至 OneUptime。僅允許 OneUptime 連出至網際網路並不足夠。

| 方向 | 目的地 | 協定 / 連接埠 | 用途 |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | 透過 multipart POST 傳送解析後的郵件。 |
| 寄件郵件伺服器 → SendGrid | 接收網域公開 MX 記錄指定的 `mx.sendgrid.net` | SMTP / TCP 25 | 在 SendGrid 接收郵件，不連線至 OneUptime 伺服器。 |
| OneUptime → SendGrid，僅限另行設定郵件寄送時 | `api.sendgrid.com` | HTTPS / TCP 443 | 透過 Mail Send API 寄送通知郵件。 |

為 webhook 主機名稱發布公開 DNS，並使用公開信任的憑證。私有部署可以透過能在內部存取 OneUptime 的公開反向代理或閘道，僅公開 webhook 路徑。保留路徑、密鑰、內容類型和 multipart 請求本文；允許 POST 通過，不得要求互動式登入或瀏覽器驗證。OneUptime 不需要接聽連入 SMTP 連線。請參閱 [SendGrid 設定指南](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook)。

將 `INBOUND_EMAIL_WEBHOOK_SECRET` 設為高強度隨機值，並用它取代 `YOUR_SECRET`。路由要求最後一個路徑區段存在。OneUptime 會將其與設定的密鑰比較；變數留空會停用此檢查。完整 URL 與監控器郵件地址應保密，包括代理記錄。OneUptime 目前不驗證 SendGrid 的 Inbound Parse 簽署標頭或 OAuth 權杖。如需這些機制，請依 [SendGrid 安全文獻](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks)在閘道驗證後再轉送。

SendGrid 不提供可靠的 Inbound Parse 來源靜態 IP 清單。郵件寄送 IP 及 `mx.sendgrid.net` 的 DNS 解析地址都不能當作 webhook 來源允許清單。請遵循 [SendGrid 防火牆指南](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs)。

Inbound Parse 與寄送郵件相互獨立。接收監控郵件不需要 OneUptime 呼叫 SendGrid API。若也使用 SendGrid 寄送通知，請允許 DNS 解析和到 `api.sendgrid.com` 的連出 HTTPS；[Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)提交郵件不需要連入回呼。若使用 SMTP，請允許 OneUptime 中設定的伺服器和連接埠。

驗證公開 MX 記錄、寄送郵件至測試監控器，確認 webhook 到達 OneUptime 並建立或解除符合條件的警示。空白 POST 或寄件測試成功，都不能驗證 Inbound Parse 的完整流程。

## 運作方式

1. 您在 OneUptime 中建立一個 **收件電子郵件監控器（Incoming Email Monitor）**
2. OneUptime 會為該監控器產生一個專屬的電子郵件地址（例如 `monitor-abc123@inbound.yourdomain.com`）
3. 當有電子郵件傳送至該地址時，SendGrid 會收到該郵件並透過 webhook 將其轉送至 OneUptime
4. OneUptime 會依據您所設定的條件評估該電子郵件，以建立或解除警示

## 設定說明

### 步驟 1：選擇您的收件電子郵件網域

您將需要一個專門用於接收收件電子郵件的子網域。我們建議使用如下的子網域：

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

此子網域將專門用於 OneUptime 監控器電子郵件。

### 步驟 2：設定 DNS MX 記錄

在您的 DNS 設定中新增一筆 MX 記錄，將寄往您收件子網域的電子郵件路由至 SendGrid。

| 類型 | 主機/名稱 | 優先順序 | 值              |
| ---- | --------- | -------- | --------------- |
| MX   | inbound   | 10       | mx.sendgrid.net |

**範例：** 如果您的網域是 `example.com`，且您使用 `inbound.example.com`：

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**注意：** DNS 變更最多可能需要 48 小時才能完成傳播，但通常會在數小時內完成。

### 步驟 3：在 SendGrid 中驗證網域

接收網域必須屬於您其中一個 [SendGrid 已驗證網域](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse)：

1. 登入您的 [SendGrid Dashboard](https://app.sendgrid.com)
2. 前往 **Settings** > **Sender Authentication**
3. 點選 **Authenticate Your Domain**
4. 依照提示新增所需的 DNS 記錄（用於 DKIM 的 CNAME 記錄）

### 步驟 4：設定 SendGrid Inbound Parse

1. 登入您的 [SendGrid Dashboard](https://app.sendgrid.com)
2. 導覽至 **Settings** > **Inbound Parse**
3. 點選 **Add Host & URL**
4. 設定下列項目：

| 欄位                                | 值                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**                | 您的收件子網域（例如 `inbound.yourdomain.com`）                         |
| **Destination URL**                 | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam**  | 選用——如有需要可啟用                                                    |
| **Send raw, full MIME message**     | 保持未勾選（非必要）                                                    |
| **POST the raw, full MIME message** | 保持未勾選（非必要）                                                    |

5. 點選 **Add**

### 步驟 5：設定 OneUptime 環境變數

#### Docker Compose

將下列環境變數新增至您的 `config.env` 檔案：

```bash
# Inbound Email Configuration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### 搭配 Helm 的 Kubernetes

將下列項目新增至您的 `values.yaml` 檔案：

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

使用與步驟 4 目標 URL 相同的密鑰，並在修改設定後重新啟動 OneUptime。

### 步驟 6：建立收件電子郵件監控器

1. 登入您的 OneUptime Dashboard
2. 導覽至 **監測** > **建立監測器**
3. 選擇 **Incoming Email** 作為監控器類型
4. 設定您的監控器：
   - **名稱：** 為您的監控器取一個具描述性的名稱
   - **描述：** 描述此監控器的用途
5. 設定 **Alert Creation Criteria**（何時建立警示）：
   - 範例：電子郵件主旨包含 "ALERT" 或 "CRITICAL"
6. 設定 **Alert Resolution Criteria**（何時解除警示）：
   - 範例：電子郵件主旨包含 "RESOLVED" 或 "OK"
7. 點選 **建立**

建立完成後，您會看到此監控器的專屬電子郵件地址（例如 `monitor-abc123def456@inbound.yourdomain.com`）。

### 步驟 7：測試整合

1. 從 OneUptime Dashboard 複製該監控器的電子郵件地址
2. 傳送一封測試電子郵件至該地址，並使主旨符合您的警示條件
3. 檢查 OneUptime Dashboard 以確認：
   - 電子郵件已被接收（可在 Monitor Summary 中看到）
   - 已建立警示（如果條件相符）

## 環境變數參考

| 變數                           | 說明                                                                                                      | 是否必要 | 預設值 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | -------- | ------ |
| `INBOUND_EMAIL_PROVIDER`       | 要使用的收件電子郵件供應商                                                                                | 是       | -      |
| `INBOUND_EMAIL_DOMAIN`         | 為收件電子郵件所設定的子網域                                                                              | 是       | -      |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | 與 `/incoming-email/sendgrid/YOUR_SECRET` 的最後一個路徑區段比較。公開端點應設定此值；留空會停用驗證。 | 建議 | - |

## 支援的電子郵件條件

在設定您的收件電子郵件監控器時，您可以根據以下項目建立條件：

| 欄位               | 說明                       | 可用篩選條件                                                                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| **電子郵件主旨**   | 電子郵件的主旨列           | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
| **寄件者電子郵件** | 寄件者的電子郵件地址       | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
| **Email Body**     | 電子郵件的純文字內文       | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
| **Email To**       | 收件者的電子郵件地址       | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
| **Email Received** | 距離上次收到電子郵件的時間 | Received In Minutes、Not Received In Minutes                                               |

## 範例使用情境

### 舊有系統警示

許多舊有系統只能傳送電子郵件警示。建立一個收件電子郵件監控器以：

- 當舊有系統傳送 `[CRITICAL]` 電子郵件時建立 OneUptime 警示
- 當收到 `[RESOLVED]` 電子郵件時解除警示

### 第三方服務整合

與會傳送電子郵件通知的服務整合：

- 沒有 API 整合的監控工具
- 雲端供應商通知
- 安全掃描工具

### 透過電子郵件的心跳檢測

使用 "Email Received" 條件，以確保您定期收到電子郵件：

- 如果在 60 分鐘內未收到電子郵件，則建立警示
- 適用於監控會在完成時傳送電子郵件的批次作業或排程任務

## 疑難排解

### 未收到電子郵件

1. **檢查 DNS 傳播狀態：**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   應回傳 `mx.sendgrid.net`

2. **驗證 SendGrid Inbound Parse 設定：**

   - 登入 SendGrid Dashboard
   - 前往 Settings > Inbound Parse
   - 確認您的網域與 webhook URL 正確無誤

3. **檢查 OneUptime 記錄：**
   - 在 OneUptime 應用程式記錄（Telemetry / ProbeIngest）中尋找收件電子郵件 webhook。
   - 檢查是否有任何錯誤訊息

### Webhook 失敗

- 包含密鑰的完整 HTTPS URL 必須可從網際網路存取。缺少最後一個區段時，URL 無法符合路由。
- 允許 POST 通過，不得要求登入重新導向或瀏覽器驗證。SendGrid 的郵件寄送 IP 並非 webhook 來源允許清單。
- 使用公開信任的憑證和完整憑證鏈，並按照「網路存取」一節驗證傳送。

### 監控器未建立警示

1. **驗證條件設定：**

   - 檢查您的警示建立條件是否與電子郵件內容相符
   - 在使用模式比對之前，請先以完全相符的字串進行測試

2. **檢查監控器狀態：**

   - 確保監控器未被停用
   - 確認監控器類型為 "Incoming Email"

3. **檢視 Monitor Summary：**
   - 檢查電子郵件是否已被接收及處理
   - 檢視評估記錄以瞭解條件比對的詳細資訊

### SendGrid Webhook 傳送記錄

若要檢查 SendGrid 是否成功傳送 webhook：

1. 很遺憾，SendGrid 並未針對 Inbound Parse 提供詳細記錄
2. 檢查您的 OneUptime 伺服器記錄是否有收件 webhook 請求
3. 使用如 [RequestBin](https://requestbin.com) 之類的工具暫時測試 webhook 傳送

## 安全性最佳做法

1. **使用 HTTPS：** 請務必為您的 webhook 端點使用 HTTPS
2. **Webhook 密鑰：** 設定 `INBOUND_EMAIL_WEBHOOK_SECRET` 並將其納入您的 webhook URL（例如 `/incoming-email/sendgrid/your-secret`）以進行額外驗證
3. **網域驗證：** 在 SendGrid 中驗證您的網域以提升電子郵件安全性
4. **限制存取：** 僅針對受信任的電子郵件來源建立監控器
5. **監控記錄：** 定期檢視收件電子郵件記錄是否有可疑活動

## 替代供應商

OneUptime 旨在支援多種收件電子郵件供應商。目前支援的有：

| 供應商         | 狀態   |
| -------------- | ------ |
| SendGrid       | 支援   |
| Haraka（自架） | 規劃中 |

如果您需要支援其他供應商，請與我們聯絡或提交功能請求。

## 支援

如果您在使用 SendGrid 收件電子郵件整合時遇到問題：

1. 查看上方的疑難排解章節
2. 檢視 OneUptime 記錄以取得詳細的錯誤訊息
3. 透過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 與我們聯絡

我們歡迎您提供意見回饋，以改善此整合！
