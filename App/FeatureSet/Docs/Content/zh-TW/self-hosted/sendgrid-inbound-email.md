# SendGrid 收件電子郵件整合

OneUptime 的 **收件電子郵件監控器（Incoming Email Monitor）** 可讓您根據傳送至各監控器專屬電子郵件地址的郵件來建立及解除警示。這對於整合舊有系統、警示工具，或任何能夠傳送電子郵件的服務都非常實用。

本指南說明如何設定 SendGrid Inbound Parse，將收件電子郵件轉送至您的自架 OneUptime 執行個體。

## 先決條件

- 一個 SendGrid 帳戶（免費方案即可）
- 一個您所掌控且可存取 DNS 設定的網域
- 您的 OneUptime 執行個體必須可公開存取（以便 SendGrid 傳送 webhook）

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

### 步驟 3：在 SendGrid 中驗證網域（選用，但建議執行）

為了提升送達率並避免電子郵件被標記為垃圾郵件：

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
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # Optional: for additional security
```

#### 搭配 Helm 的 Kubernetes

將下列項目新增至您的 `values.yaml` 檔案：

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # Optional
```

**重要：** 在新增這些環境變數後，請重新啟動您的 OneUptime 伺服器。

### 步驟 6：建立收件電子郵件監控器

1. 登入您的 OneUptime Dashboard
2. 導覽至 **Monitors** > **Create Monitor**
3. 選擇 **Incoming Email** 作為監控器類型
4. 設定您的監控器：
   - **Name：** 為您的監控器取一個具描述性的名稱
   - **Description：** 描述此監控器的用途
5. 設定 **Alert Creation Criteria**（何時建立警示）：
   - 範例：電子郵件主旨包含 "ALERT" 或 "CRITICAL"
6. 設定 **Alert Resolution Criteria**（何時解除警示）：
   - 範例：電子郵件主旨包含 "RESOLVED" 或 "OK"
7. 點選 **Create**

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
| `INBOUND_EMAIL_WEBHOOK_SECRET` | 用於驗證 webhook 請求的密鑰。設定後，請將此密鑰附加到 webhook URL：`/incoming-email/sendgrid/YOUR_SECRET` | 否       | -      |

## 支援的電子郵件條件

在設定您的收件電子郵件監控器時，您可以根據以下項目建立條件：

| 欄位               | 說明                       | 可用篩選條件                                                                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| **Email Subject**  | 電子郵件的主旨列           | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
| **Email From**     | 寄件者的電子郵件地址       | Contains、Not Contains、Equals、Not Equals、Starts With、Ends With、Is Empty、Is Not Empty |
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
   - 在 ProbeIngest 服務記錄中尋找 webhook 請求
   - 檢查是否有任何錯誤訊息

### Webhook 失敗

1. **確保 OneUptime 可公開存取：**

   - webhook URL 必須能從網際網路存取
   - 使用以下指令測試：`curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **檢查防火牆規則：**

   - 允許來自 SendGrid IP 範圍的收件 HTTPS 流量

3. **驗證 SSL 憑證：**
   - SendGrid 需要有效的 SSL 憑證
   - 自簽憑證可能會造成問題

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
