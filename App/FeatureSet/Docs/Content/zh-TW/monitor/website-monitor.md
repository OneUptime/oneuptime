# 網站監測器

網站監測讓您可以監測任何網站或網頁的可用性、效能與回應。OneUptime 會定期向您的網站 URL 發送 HTTP 請求，並檢查它是否正確回應。

## 概觀

網站監測器透過發出 HTTP 請求並評估回應來檢查您的網頁。這讓您可以：

- 監測網站的正常運作時間與可用性
- 追蹤回應時間與效能
- 驗證 HTTP 狀態碼
- 檢查回應標頭
- 在您的使用者之前偵測停機

## 建立網站監測器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Website** 作為監測器類型
4. 輸入您要監測的網站 URL
5. 視需要設定監測條件

## 設定選項

### 網站 URL

輸入您要監測的網站完整 URL，包含通訊協定（例如 `https://example.com`）。

### 動態 URL 預留位置

當監測位於 CDN 或快取代理伺服器之後的 URL 時，監測器可能會收到快取的回應，而不是抵達來源伺服器。若要在每次檢查時清除快取，您可以使用動態 URL 預留位置，它會在每個監測請求上被替換為唯一的值。

#### 支援的預留位置

| 預留位置 | 說明 | 範例值 |
|-------------|-------------|---------------|
| `{{timestamp}}` | 替換為目前的 Unix 時間戳記（秒） | `1719500000` |
| `{{random}}` | 替換為隨機的唯一字串 | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 範例

使用預留位置設定您的監測器 URL：

```
https://example.com/health?cb={{timestamp}}
```

在每次監測檢查時，URL 會變成：

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

您也可以使用 `{{random}}` 在每個請求上產生唯一字串：

```
https://example.com/health?nocache={{random}}
```

### 進階選項

#### 不要跟隨重新導向

預設情況下，OneUptime 會跟隨 HTTP 重新導向（301、302 等）。如果您想要監測重新導向回應本身，而非最終目的地，請啟用此選項。

#### 允許自我簽署的憑證

啟用此選項可略過 TLS 憑證驗證。當目標伺服器使用自我簽署或其他不受信任的 TLS 憑證時（例如內部測試環境），此選項相當有用。

#### 用戶端憑證（mTLS）

如果您的端點需要雙向 TLS 驗證，請啟用 **Use client certificate (mTLS)** 並提供：

- **Client Certificate (PEM)** — 要呈現的 PEM 編碼用戶端憑證。
- **Client Private Key (PEM)** — 相符的 PEM 編碼私密金鑰。
- **Client Private Key Passphrase** *(選用)* — 僅在私密金鑰已加密時才需要。

這相當於 curl 中 `--cert` 與 `--key` 旗標的 OneUptime 對應功能：

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

對於敏感值，請將憑證與金鑰儲存為 [Monitor Secrets](/docs/monitor/monitor-secrets)，並使用 `{{monitorSecrets.name}}` 來參照它們。Monitor Secrets 會在伺服器端解析，且呈現後的值絕不會出現在儀表板中。

## 監測條件

您可以設定條件，根據以下項目來判斷您的網站何時被視為線上、降級或離線：

- **回應狀態碼** - 檢查 HTTP 狀態碼是否符合預期值（例如 200、301）
- **回應時間** - 監測回應時間是否超過閾值
- **回應內容** - 檢查回應內容是否包含或符合特定內容
- **回應標頭** - 驗證特定回應標頭是否存在或符合預期值
