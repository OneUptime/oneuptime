# API 監控器

API 監控可讓您監控 HTTP/REST API 的可用性、效能與正確性。OneUptime 會定期向您的 API 端點傳送 HTTP 請求，並根據您所設定的條件來評估回應。

## 概觀

API 監控器會向您的端點發出 HTTP 請求並檢查回應。這讓您能夠：

- 監控 API 的正常運行時間與可用性
- 追蹤回應時間與效能
- 驗證 HTTP 狀態碼與回應主體
- 驗證回應標頭
- 測試不同的 HTTP 方法（GET、POST、PUT、DELETE 等）
- 傳送自訂的請求標頭與主體

## 建立 API 監控器

1. 在 OneUptime 儀表板中前往 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **API** 作為監控器類型
4. 輸入 API URL 並設定請求設定
5. 視需要設定監控條件

## 設定選項

### API URL

輸入您要監控的 API 端點完整 URL（例如 `https://api.example.com/v1/health`）。

### 動態 URL 佔位符

當監控位於 CDN 或快取代理伺服器之後的 API 時，監控器可能會收到快取的回應，而非實際存取來源伺服器。為了在每次檢查時清除快取，您可以使用動態 URL 佔位符，這些佔位符會在每次監控請求時被替換為唯一值。

#### 支援的佔位符

| 佔位符          | 說明                             | 範例值                             |
| --------------- | -------------------------------- | ---------------------------------- |
| `{{timestamp}}` | 替換為目前的 Unix 時間戳記（秒） | `1719500000`                       |
| `{{random}}`    | 替換為隨機的唯一字串             | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 範例

使用佔位符設定您的監控器 URL：

```
https://api.example.com/health?cb={{timestamp}}
```

在每次監控檢查時，URL 會變成：

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

您也可以使用 `{{random}}` 在每次請求時產生唯一字串：

```
https://api.example.com/health?nocache={{random}}
```

### API 請求類型

選擇請求的 HTTP 方法：

- **GET**（預設）
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### 進階選項

#### 請求標頭

為請求新增自訂的 HTTP 標頭。這對於驗證權杖、內容類型指定，以及其他特定於 API 的標頭非常有用。

您可以在標頭值中使用[監控器密鑰](/docs/monitor/monitor-secrets)，以安全地儲存 API 金鑰等敏感資料。

#### 請求主體（JSON）

對於 POST、PUT 與 PATCH 請求，您可以指定 JSON 請求主體。您也可以在請求主體中使用[監控器密鑰](/docs/monitor/monitor-secrets)。

#### 不要追蹤重新導向

OneUptime 預設會追蹤 HTTP 重新導向（301、302 等）。如果您想監控重新導向回應本身，而非最終目的地，請啟用此選項。

#### 允許自我簽署憑證

啟用此選項可略過 TLS 憑證驗證。當目標伺服器使用自我簽署或其他不受信任的 TLS 憑證時（例如內部測試環境），此選項相當實用。

#### 用戶端憑證（mTLS）

如果您的端點需要雙向 TLS 驗證，請啟用 **Use client certificate (mTLS)** 並提供：

- **Client Certificate (PEM)** — 要提供的 PEM 編碼用戶端憑證。
- **Client Private Key (PEM)** — 相符的 PEM 編碼私密金鑰。
- **Client Private Key Passphrase** _（選填）_ — 僅在私密金鑰已加密時才需要。

這相當於 curl 中 `--cert` 與 `--key` 旗標的 OneUptime 對應功能：

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

對於敏感值，請將憑證與金鑰儲存為[監控器密鑰](/docs/monitor/monitor-secrets)，並以 `{{monitorSecrets.name}}` 來引用它們。監控器密鑰會在伺服器端解析，且呈現的值絕不會出現在儀表板中。

## 監控條件

您可以設定條件，依據以下項目來判斷您的 API 何時被視為上線、降級或離線：

- **回應狀態碼** - 檢查 HTTP 狀態碼是否符合預期值（例如 200、201）
- **回應時間** - 監控回應時間是否超過閾值
- **回應主體** - 檢查回應主體是否包含或符合特定內容
- **回應標頭** - 驗證特定回應標頭是否存在或符合預期值
- **JavaScript 運算式** - 撰寫自訂運算式來評估回應。詳情請參閱 [JavaScript 運算式](/docs/monitor/javascript-expression)。
