# 傳入請求監控器

傳入請求監控（也稱爲心跳監控）允許您通過讓服務定期向 OneUptime 發送 HTTP 請求來監控服務。不是由 OneUptime 主動訪問您的服務，而是您的服務向 OneUptime 發送 Ping 以確認其正在運行。

## 概述

傳入請求監控器提供一個唯一的 Webhook URL，您的服務定期調用它。這使您能夠：

- 監控 Cron 作業和計劃任務
- 驗證後臺 Worker 是否正在運行
- 監控防火牆後面無法從外部訪問的服務
- 與第三方監控工具集成
- 跟蹤來自任何具有 HTTP 能力系統的心跳信號

## 創建傳入請求監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **傳入請求** 作爲監控器類型
4. 將爲此監控器生成一個 **密鑰** 和心跳 URL
5. 配置您的服務向心跳 URL 發送請求
6. 根據需要配置監控標準

## 心跳 URL

創建後，您的監控器將有一個格式如下的唯一心跳 URL：

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

您的服務應定期向此 URL 發送 HTTP **GET** 或 **POST** 請求。

### 發送心跳

#### 使用 curl

```bash
# 簡單 GET 請求
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# 帶自定義正文的 POST 請求
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### 從 Cron 作業

```bash
# 添加到 crontab 以每 5 分鐘發送一次心跳
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### 從應用程序代碼

```javascript
// Node.js 示例
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python 示例
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

如果是自託管，請將 `https://oneuptime.com` 替換爲您的 OneUptime 實例 URL。

## 監控標準

您可以配置標準來判斷服務何時處於在線、降級或離線狀態，基於以下條件：

### 可用檢查類型

| 檢查類型 | 描述 |
|---------|------|
| 傳入請求 | 是否在時間窗口內收到心跳 |
| 請求體 | 與心跳一起發送的請求體內容 |
| 請求頭名稱 | 特定請求頭的名稱 |
| 請求頭值 | 特定請求頭的值 |

### 過濾類型

對於 **傳入請求**：

- **在 X 分鐘內收到** — 在指定分鐘數內收到了心跳
- **X 分鐘內未收到** — 在指定分鐘數內未收到心跳

對於 **請求體**、**請求頭名稱** 和 **請求頭值**：

- **包含** — 值包含指定文本
- **不包含** — 值不包含指定文本

### 示例標準

#### 如果 10 分鐘內無心跳則標記爲離線

- **檢查項**：傳入請求
- **過濾類型**：X 分鐘內未收到
- **值**：10

#### 根據請求體內容標記爲降級

- **檢查項**：請求體
- **過濾類型**：包含
- **值**：`"status": "degraded"`

## 最佳實踐

1. **適當設置時間窗口** — 如果您的 Cron 作業每 5 分鐘運行一次，將"X 分鐘內未收到"閾值設置爲 10-15 分鐘，以允許偶爾的延遲
2. **包含有意義的數據** — 在請求體中發送狀態信息，以便您可以設置細粒度標準
3. **使用 POST 傳輸豐富數據** — 當您需要發送詳細狀態信息時，使用帶有 JSON 正文的 POST 請求
4. **監控監控器本身** — 確保發送心跳的服務有適當的錯誤處理，以便失敗的心跳請求不會被忽視
