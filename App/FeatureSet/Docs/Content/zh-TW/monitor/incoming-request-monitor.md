# 傳入請求監控器

傳入請求監控器會提供一個 URL，讓其他系統對它送出 HTTP 請求。OneUptime 會依你的條件評估每一個請求，並可以變更監控器狀態、建立事件，以及呼叫你的待命輪值人員。

它涵蓋兩種不同的工作：

- **心跳監控** —— cron 工作、worker 或裝置依排程呼叫該 URL，當心跳不再送達時，OneUptime 就建立事件。
- **接收其他系統的警示** —— Prometheus Alertmanager、Grafana，或任何能夠 POST JSON 的系統把警示推送進來，OneUptime 將每一則轉成事件，帶有待命升級，並在復原時自動解決。

兩者使用同一種監控器類型。差別在於你所設定的條件。

## 概覽

傳入請求監控器提供一個唯一的 URL 供你的服務呼叫。這讓你可以：

- 監控 cron 工作與排程任務
- 確認背景 worker 正在執行
- 監控防火牆後方、外部無法連線的服務
- 接收來自 Prometheus Alertmanager、Grafana 及其他警示系統的警示
- 追蹤任何支援 HTTP 的系統送出的心跳訊號

## 建立傳入請求監控器

1. 在 OneUptime 儀表板中前往 **監控器**
2. 點擊 **建立監控器**
3. 選擇 **傳入請求** 作為監控器類型
4. 系統會為這個監控器產生一組 **密鑰** 與一個 URL
5. 開啟該監控器，點擊左側選單中的 **Documentation** 以複製 URL
6. 設定你的服務向該 URL 送出請求
7. 依下文所述設定監控條件

## 請求 URL

你的監控器有一個下列格式的唯一 URL：

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

若為自架，請將 `https://oneuptime.com` 換成你自己的 OneUptime 執行個體 URL。

向這個 URL 送出 **GET** 或 **POST** 請求。HEAD 會被接受並視為 GET 處理。其他方法回傳 404。路徑中的密鑰是唯一的憑證——不需要任何標頭或權杖。

> **Warning:** 任何知道這個 URL 的人都能把監控器標記為健康，因此請將它視為機密。你送出的每個標頭都會存放在監控器上，任何能讀取它的人都看得到——不要把 API 金鑰或權杖放在標頭中送到這個端點。

OneUptime 會立即回應一個空的 `200`，並在佇列中處理該請求。這個回應是在任何驗證之前就寫出的，因此 `200` **並不**代表請求已被接受——錯誤的密鑰、已刪除的監控器、已停用的監控器，同樣都會回傳 `200`。請查看監控器本身的時間軸來確認請求確實送達。

### 送出請求酬載

如果你想引用酬載內部的欄位——事件標題中的 `{{requestBody.status}}`、事件分組中的 JSON 路徑，或 JavaScript Expression 條件——請送出 `Content-Type: application/json`，本文件通篇都以這個格式為前提。`application/x-www-form-urlencoded` 的酬載也會被解析，但只會得到扁平的頂層欄位。其他任何 content type（或完全沒有）都不會被解析，所有 `requestBody` 參照都解析不到任何東西。

酬載最大接受 50 MB。請勿以 `Content-Encoding: gzip` 壓縮酬載；它會以未解析的形式儲存，指向其中的路徑無法解析。

### 送出心跳

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
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## 監控條件

你可以設定條件來判定服務何時算是上線、降級或離線。每個條件過濾器都有 **Filter Type**（要看什麼）、**Filter Condition**（如何比較）與 **Value**。

### 可用的 Filter Type

| Filter Type           | 檢查內容                                        | 備註                                                                          |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Incoming Request      | 是否在某段時間內收到過請求                      | 唯一在什麼都沒收到時也能觸發的檢查                                            |
| Request Body          | 請求酬載                                        | 子字串比對。物件形式的酬載會以精簡 JSON 比較                                  |
| Request Header        | 請求標頭的名稱                                  | 與轉為小寫的標頭名稱完全相符                                                  |
| Request Header Value  | 請求標頭的值                                    | 與轉為小寫的標頭值完全相符                                                    |
| JavaScript Expression | 針對 `requestBody` 與 `requestHeaders` 的運算式 | 最有彈性的選項——參見 [JavaScript 運算式](/docs/monitor/javascript-expression) |

### Filter Condition

每種 Filter Type 都有各自的一組條件。

對於 **Incoming Request**（此處照錄儀表板中的拼字）：

- **Recieved In Minutes** —— 在指定的分鐘數內收到過請求
- **Not Recieved In Minutes** —— 在指定的分鐘數內未收到請求

對於 **Request Body**、**Request Header** 與 **Request Header Value**：**Contains** 與 **Not Contains**。

對於 **JavaScript Expression**：**Evaluates To True**。

> **Note:** 標頭名稱與標頭值在比較前都會轉為小寫，而且比對的是整個名稱或值，而非子字串。請寫 `content-type` 而非 `Content-Type`，寫 `application/json` 而非 `application/JSON`。只有 **Request Body** 做的是真正的子字串比對。

物件形式的酬載會以不含空白的精簡 JSON 比較，因此 **Request Body** / **Contains** 過濾器必須寫成 `"status":"firing"`——從排版過的酬載複製 `"status": "firing"` 永遠不會相符。

### 範例條件

#### 10 分鐘內沒有心跳就標記為離線

- **Filter Type**：Incoming Request
- **Filter Condition**：Not Recieved In Minutes
- **Value**：10

#### 依請求酬載內容標記為降級

- **Filter Type**：Request Body
- **Filter Condition**：Contains
- **Value**：`"status":"degraded"`

> **Warning:** 只有當監控器至少有一個條件檢查 **Incoming Request** 時，它才會在背景重新評估。條件只檢查 Request Body、Request Header 或 JavaScript Expression 的監控器，僅在請求抵達時才會被評估，其他時候都不會——因此它永遠不會自行變成離線。如果你想要心跳遺失的警報，就必須有一個 **Incoming Request** 條件。

另請注意，從未收到過請求的監控器會被視為它的建立時間就是最後一次請求。剛建立的監控器上「Not Recieved In Minutes: 10」的條件會在建立後 10 分鐘觸發，即使發送端從未接上。

## 接收其他系統的警示

Alertmanager、Grafana 等工具會 POST 一份描述一則或多則警示的 JSON 文件。預設情況下一個條件只會開立 **一個** 事件，因此帶有五則警示的酬載也只會產生一個事件。事件分組改變了這一點：它從酬載中擷取一個值，並 **為每個不同的值分別開立事件**，這些事件可以同時處於開啟狀態。

### 啟用事件分組

開啟該條件，展開 **Settings**，並啟用 **Group incidents and alerts by a payload field**。會出現四個欄位：

| 欄位                               | 範例                                     | 作用                                     |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | 以其不同取值來拆分事件的路徑             |
| Field that signals recovery        | `requestBody.alerts[*].status`           | 用來判定某則警示已復原的路徑             |
| Value that means recovered         | `resolved`                               | 代表復原的精確值                         |
| Max incidents per request          | `100`（預設）                            | 安全上限，避免高基數欄位無限制地開立事件 |

### 路徑語法

路徑必須以字面前綴 `requestBody.` 開頭。缺少它的路徑——`alerts[*].labels.alertname`——什麼都比對不到，而且是靜默失敗。`{{ }}` 包裹是選用的：`requestBody.status` 與 `{{requestBody.status}}` 行為完全相同。

- `[*]` 會在陣列上展開——每個 **不同的** 值對應一個事件。產生相同值的兩個元素會合併為一個事件，該事件的 firing/resolved 狀態取自 **第一個** 相符的元素。**路徑中只有第一個 `[*]` 是萬用字元**；`requestBody.groups[*].alerts[*].name` 什麼都比對不到。
- `[0]` 與 `[last]` 選取單一元素，而且可以接在 `[*]` 之後。
- 物件與陣列值、空字串以及 null 會被略過。`0` 與 `false` 是有效的鍵。

### 解決是事件驅動的

webhook 只描述該次酬載中的內容，因此 OneUptime 絕不會因為某個鍵不再出現就解決一個事件。只有當某次酬載明確指出該鍵已復原時，事件才會被解決。以下兩點必須同時成立：

1. **Field that signals recovery** 與 **Value that means recovered** 已設定，且與酬載相符。比較是精確且區分大小寫的——`Resolved` 不會相符於 `resolved`。
2. 該條件的事件在事件表單的 **Advanced Options** 下已啟用 **Auto Resolve Incident**。否則相符的復原事件會被忽略，事件會一直開著。（警示與 **Auto Resolve Alert** 同理。）

**Max incidents per request** 限制的是擷取，而不只是建立。超出上限的鍵對復原同樣看不見，因此在不同鍵數量超過上限的酬載中，超出部分回報 `resolved` 的警示不會關閉它的事件。

> **Warning:** 如果 **Field that signals recovery** 含有 `[*]` 而 **Open a separate incident for each…** 沒有，就永遠不會有任何東西被解決。兩者都用 `[*]`，或兩者都不用。不含 `[*]` 的復原路徑會針對整份酬載求值，因此酬載層級的 `status: resolved` 會解決該酬載中的每一個鍵——包括那些自身狀態仍為 firing 的警示。

### 為事件命名

分組鍵會以 **路徑最後一段** 命名的變數形式提供給事件與警示範本：

| 路徑                                     | 變數              |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

完整酬載仍可一併使用，因此事件標題用 `{{alertname}}`、描述中引用 `{{requestBody.commonAnnotations.summary}}` 都能正常運作。參見 [事件與警示動態範本](/docs/monitor/incident-alert-templating)。

> **Warning:** 變數名稱是 OneUptime 用來把復原事件對應到已開啟事件的識別資訊之一。把分組路徑改成最後一段不同的路徑，會讓目前在舊路徑下開啟的所有事件成為孤兒——它們無法再自動解決，必須手動關閉。

另請注意，`[*]` **只在**兩個分組路徑欄位中有效。在其他地方它不會被解析，而未解析的佔位符會 **原樣** 輸出而非被清空——標題寫成 `{{requestBody.alerts[*].labels.alertname}}` 時會連同大括號一起顯示。標題 `{{requestBody.alerts[0].annotations.summary}}` 可以解析，但一律讀取酬載中的第一則警示，而不是這個事件所對應的那一則。建議改用分組變數，搭配酬載中共用的 `commonAnnotations` 欄位。

### 完整範例

完整的 Alertmanager 設定請見 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager)。Grafana 請見 [Grafana](/docs/integrations/grafana)。

## 最佳實務

1. **合理設定時間範圍** —— 如果你的 cron 工作每 5 分鐘執行一次，請把「Not Recieved In Minutes」門檻設為 10–15 分鐘，以容許偶發延遲
2. **帶入有意義的資料** —— 在請求酬載中送出狀態資訊，以便設定更細緻的條件
3. **使用 POST 並帶上 `Content-Type: application/json`** —— 所有讀取酬載內部的功能都依賴它
4. **不要在同一個監控器上混用兩種工作** —— 接收事件驅動警示的監控器沒有固定節奏，在它上面設定「Not Recieved In Minutes」條件會反覆跳動。請為死人開關使用另一個監控器
5. **監控這個監控器** —— 確保送出請求的服務有妥善的錯誤處理，避免失敗的請求被忽略

## 接下來閱讀什麼

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) —— 一套完整的入站警示設定
- [Grafana](/docs/integrations/grafana) —— 同樣的做法，用於 Grafana 警示
- [事件與警示動態範本](/docs/monitor/incident-alert-templating) —— 標題與描述中可用的所有變數
- [JavaScript 運算式](/docs/monitor/javascript-expression) —— 運算式語法與引號規則
