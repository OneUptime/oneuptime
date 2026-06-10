# 傳入請求監控器

傳入請求監控（也稱為心跳監控）讓您可以透過讓服務定期傳送 HTTP 請求至 OneUptime 來監控服務。OneUptime 不會主動連線至您的服務，而是由您的服務向 OneUptime 發送 ping 以確認其正在運行。

## 概觀

傳入請求監控器會提供一個獨特的 webhook URL，供您的服務按排程呼叫。這讓您能夠：

- 監控 cron 工作與排程任務
- 驗證背景工作程序是否正在運行
- 監控位於防火牆後方、無法從外部連線的服務
- 與第三方監控工具整合
- 追蹤來自任何具備 HTTP 能力之系統的心跳訊號

## 建立傳入請求監控器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **Incoming Request** 作為監控器類型
4. 系統會為此監控器產生一組 **Secret Key** 與心跳 URL
5. 設定您的服務以傳送請求至心跳 URL
6. 視需要設定監控條件

## 心跳 URL

建立後，您的監控器會擁有一個格式如下的獨特心跳 URL：

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

您的服務應定期傳送 HTTP **GET** 或 **POST** 請求至此 URL。

### 傳送心跳

#### 使用 curl

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST request with custom body
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### 從 cron 工作

```bash
# Add to crontab to send heartbeat every 5 minutes
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### 從應用程式碼

```javascript
// Node.js example
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

若為自架部署，請將 `https://oneuptime.com` 替換為您的 OneUptime 執行個體 URL。

## 監控條件

您可以設定條件，以根據下列項目判斷您的服務何時被視為上線、效能降級或離線：

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Incoming Request | 是否在某個時間範圍內收到心跳 |
| Request Body | 隨心跳一同傳送的請求內文內容 |
| Request Header | 特定請求標頭的名稱 |
| Request Header Value | 特定請求標頭的值 |

### 篩選類型

對於 **Incoming Request**：

- **Received In Minutes** — 在指定的分鐘數內收到心跳
- **Not Received In Minutes** — 在指定的分鐘數內未收到心跳

對於 **Request Body**、**Request Header** 與 **Request Header Value**：

- **Contains** — 值包含指定的文字
- **Not Contains** — 值不包含指定的文字

### 條件範例

#### 若 10 分鐘內未收到心跳則標記為離線

- **Check On**：Incoming Request
- **Filter Type**：Not Received In Minutes
- **Value**：10

#### 根據請求內文內容標記為效能降級

- **Check On**：Request Body
- **Filter Type**：Contains
- **Value**：`"status": "degraded"`

## 最佳實務

1. **適當設定時間範圍** — 若您的 cron 工作每 5 分鐘執行一次，請將「Not Received In Minutes」門檻設為 10–15 分鐘，以容許偶發的延遲
2. **包含有意義的資料** — 在請求內文中傳送狀態資訊，以便您設定更細緻的條件
3. **使用 POST 傳送豐富資料** — 當您需要傳送詳細的狀態資訊時，請使用帶有 JSON 內文的 POST 請求
4. **監控監控器本身** — 確保傳送心跳的服務具備適當的錯誤處理機制，讓失敗的心跳請求不會被忽略
