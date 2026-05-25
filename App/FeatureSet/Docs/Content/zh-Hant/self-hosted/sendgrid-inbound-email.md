# SendGrid 入站郵件集成

OneUptime 的**傳入郵件監控器**允許您根據發送到唯一監控器特定郵件地址的郵件來創建和解決警報。這對於與舊系統、警報工具或任何可以發送郵件的服務集成非常有用。

本指南介紹如何設置 SendGrid Inbound Parse 將傳入郵件轉發到您的自託管 OneUptime 實例。

## 前提條件

- SendGrid 賬號（免費套餐可用）
- 您控制的域名，可以訪問 DNS 設置
- 您的 OneUptime 實例必須可公開訪問（供 SendGrid 發送 Webhook）

## 工作原理

1. 您在 OneUptime 中創建一個**傳入郵件監控器**
2. OneUptime 爲該監控器生成唯一的郵件地址（例如 `monitor-abc123@inbound.yourdomain.com`）
3. 當郵件發送到該地址時，SendGrid 接收並通過 Webhook 將其轉發到 OneUptime
4. OneUptime 根據您配置的標準評估郵件，以創建或解決警報

## 設置說明

### 第一步：選擇入站郵件域名

您需要一個專用於接收入站郵件的子域名。我們建議使用以下子域名：

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

此子域名將專門用於 OneUptime 監控器郵件。

### 第二步：配置 DNS MX 記錄

在 DNS 配置中添加 MX 記錄，將入站子域名的郵件路由到 SendGrid。

| 類型 | 主機/名稱 | 優先級 | 值 |
|------|---------|--------|-----|
| MX | inbound | 10 | mx.sendgrid.net |

**示例：** 如果您的域名是 `example.com` 且您使用 `inbound.example.com`：

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**注意：** DNS 更改最長可能需要 48 小時才能生效，但通常在幾個小時內完成。

### 第三步：在 SendGrid 中驗證域名（可選但推薦）

爲提高傳送率並避免郵件被標記爲垃圾郵件：

1. 登錄您的 [SendGrid 控制台](https://app.sendgrid.com)
2. 前往 **設置** > **發件人認證**
3. 點擊 **認證您的域名**
4. 按照提示添加所需的 DNS 記錄（用於 DKIM 的 CNAME 記錄）

### 第四步：配置 SendGrid Inbound Parse

1. 登錄您的 [SendGrid 控制台](https://app.sendgrid.com)
2. 導航至 **設置** > **Inbound Parse**
3. 點擊 **添加主機和 URL**
4. 配置以下內容：

| 字段 | 值 |
|------|-----|
| **接收域名** | 您的入站子域名（例如 `inbound.yourdomain.com`） |
| **目標 URL** | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **檢查傳入郵件是否爲垃圾郵件** | 可選 - 如需要可啓用 |
| **發送原始的完整 MIME 消息** | 保持未選中（不需要） |
| **POST 原始的完整 MIME 消息** | 保持未選中（不需要） |

5. 點擊 **添加**

### 第五步：配置 OneUptime 環境變量

#### Docker Compose

將這些環境變量添加到您的 `config.env` 文件中：

```bash
# 入站郵件配置
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # 可選：用於額外安全
```

#### Kubernetes with Helm

將這些添加到您的 `values.yaml` 文件中：

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # 可選
```

**重要提示：** 添加這些環境變量後重啓您的 OneUptime 服務器。

### 第六步：創建傳入郵件監控器

1. 登錄您的 OneUptime 控制台
2. 導航至 **監控器** > **創建監控器**
3. 選擇 **傳入郵件** 作爲監控器類型
4. 配置您的監控器：
   - **名稱：** 爲監控器提供描述性名稱
   - **描述：** 描述此監控器的用途
5. 配置 **警報創建標準**（何時創建警報）：
   - 示例：郵件主題包含"ALERT"或"CRITICAL"
6. 配置 **警報解決標準**（何時解決警報）：
   - 示例：郵件主題包含"RESOLVED"或"OK"
7. 點擊 **創建**

創建後，您將看到此監控器的唯一郵件地址（例如 `monitor-abc123def456@inbound.yourdomain.com`）。

### 第七步：測試集成

1. 從 OneUptime 控制台複製監控器的郵件地址
2. 向該地址發送一封主題符合您警報標準的測試郵件
3. 檢查 OneUptime 控制台以驗證：
   - 郵件已收到（在監控器摘要中可見）
   - 創建了警報（如果標準匹配）

## 環境變量參考

| 變量 | 描述 | 是否必填 | 默認值 |
|------|------|---------|--------|
| `INBOUND_EMAIL_PROVIDER` | 要使用的入站郵件提供商 | 是 | - |
| `INBOUND_EMAIL_DOMAIN` | 配置用於入站郵件的子域名 | 是 | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | 用於驗證 Webhook 請求的密鑰。設置後，將此密鑰附加到 Webhook URL：`/incoming-email/sendgrid/YOUR_SECRET` | 否 | - |

## 支持的郵件標準

配置傳入郵件監控器時，您可以根據以下條件創建標準：

| 字段 | 描述 | 可用過濾器 |
|------|------|----------|
| **郵件主題** | 郵件的主題行 | 包含、不包含、等於、不等於、以...開頭、以...結尾、爲空、不爲空 |
| **郵件發件人** | 發件人的郵件地址 | 包含、不包含、等於、不等於、以...開頭、以...結尾、爲空、不爲空 |
| **郵件正文** | 郵件的純文本正文 | 包含、不包含、等於、不等於、以...開頭、以...結尾、爲空、不爲空 |
| **郵件收件人** | 收件人郵件地址 | 包含、不包含、等於、不等於、以...開頭、以...結尾、爲空、不爲空 |
| **郵件接收** | 自上次收到郵件以來的時間 | 在 X 分鐘內收到、X 分鐘內未收到 |

## 示例使用場景

### 舊系統警報

許多舊系統只能發送郵件警報。創建傳入郵件監控器以：
- 當舊系統發送 `[CRITICAL]` 郵件時創建 OneUptime 警報
- 收到 `[RESOLVED]` 郵件時解決警報

### 第三方服務集成

與發送郵件通知的服務集成：
- 沒有 API 集成的監控工具
- 雲提供商通知
- 安全掃描工具

### 通過郵件心跳監控

使用"郵件接收"標準確保您定期收到郵件：
- 如果 60 分鐘內未收到郵件則創建警報
- 適用於監控應發送完成郵件的批處理作業或計劃任務

## 故障排查

### 未收到郵件

1. **檢查 DNS 傳播：**
   ```bash
   dig MX inbound.yourdomain.com
   ```
   應該返回 `mx.sendgrid.net`

2. **驗證 SendGrid Inbound Parse 設置：**
   - 登錄 SendGrid 控制台
   - 前往 設置 > Inbound Parse
   - 驗證您的域名和 Webhook URL 是否正確

3. **檢查 OneUptime 日誌：**
   - 在 ProbeIngest 服務日誌中查找 Webhook 請求
   - 檢查是否有任何錯誤消息

### Webhook 失敗

1. **確保 OneUptime 可公開訪問：**
   - Webhook URL 必須可從互聯網訪問
   - 測試：`curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **檢查防火牆規則：**
   - 允許來自 SendGrid IP 範圍的入站 HTTPS 流量

3. **驗證 SSL 證書：**
   - SendGrid 需要有效的 SSL 證書
   - 自簽名證書可能會導致問題

### 監控器未創建警報

1. **驗證標準配置：**
   - 檢查您的警報創建標準是否與郵件內容匹配
   - 在使用模式匹配之前，先用精確字符串進行測試

2. **檢查監控器狀態：**
   - 確保監控器未被禁用
   - 驗證監控器類型是否爲"傳入郵件"

3. **查看監控器摘要：**
   - 檢查郵件是否已收到並處理
   - 查看標準匹配詳情的評估日誌

### SendGrid Webhook 傳送日誌

檢查 SendGrid 是否成功發送 Webhook：

1. 遺憾的是，SendGrid 不爲 Inbound Parse 提供詳細日誌
2. 檢查您的 OneUptime 服務器日誌中的入站 Webhook 請求
3. 臨時使用 [RequestBin](https://requestbin.com) 等工具測試 Webhook 傳送

## 安全最佳實踐

1. **使用 HTTPS：** 始終爲 Webhook 端點使用 HTTPS
2. **Webhook 密鑰：** 配置 `INBOUND_EMAIL_WEBHOOK_SECRET` 並將其包含在 Webhook URL 中（例如 `/incoming-email/sendgrid/your-secret`）以進行額外驗證
3. **域名驗證：** 在 SendGrid 中驗證您的域名以提高郵件安全性
4. **限制訪問：** 僅爲可信郵件來源創建監控器
5. **監控日誌：** 定期查看傳入郵件日誌以發現可疑活動

## 替代提供商

OneUptime 設計爲支持多個入站郵件提供商。目前支持：

| 提供商 | 狀態 |
|--------|------|
| SendGrid | 已支持 |
| Haraka（自託管） | 計劃中 |

如果您需要支持不同的提供商，請聯繫我們或提交功能請求。

## 支持

如果您在 SendGrid 入站郵件集成方面遇到問題：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日誌以獲取詳細錯誤消息
3. 通過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 聯繫我們

我們歡迎您的反饋以改進此集成！
