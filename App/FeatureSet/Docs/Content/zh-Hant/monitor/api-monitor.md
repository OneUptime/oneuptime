# API 監控器

API 監控允許您監控 HTTP/REST API 的可用性、性能和正確性。OneUptime 定期向您的 API 端點發送 HTTP 請求，並根據您配置的標準評估響應。

## 概述

API 監控器向您的端點發出 HTTP 請求並檢查響應。這使您能夠：

- 監控 API 正常運行時間和可用性
- 跟蹤響應時間和性能
- 驗證 HTTP 狀態碼和響應體
- 驗證響應頭
- 測試不同的 HTTP 方法（GET、POST、PUT、DELETE 等）
- 發送自定義請求頭和請求體

## 創建 API 監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **API** 作爲監控器類型
4. 輸入 API URL 並配置請求設置
5. 根據需要配置監控標準

## 配置選項

### API URL

輸入您要監控的 API 端點的完整 URL（例如 `https://api.example.com/v1/health`）。

### 動態 URL 佔位符

在監控位於 CDN 或緩存代理後面的 API 時，監控器可能會收到緩存的響應，而不是直接訪問源服務器。要在每次檢查時繞過緩存，您可以使用動態 URL 佔位符，這些佔位符在每次監控請求時會被替換爲唯一值。

#### 支持的佔位符

| 佔位符 | 描述 | 示例值 |
|--------|------|--------|
| `{{timestamp}}` | 替換爲當前 Unix 時間戳（秒） | `1719500000` |
| `{{random}}` | 替換爲隨機唯一字符串 | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 示例

使用佔位符配置您的監控器 URL：

```
https://api.example.com/health?cb={{timestamp}}
```

每次監控檢查時，URL 變爲：

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

您也可以使用 `{{random}}` 在每次請求時生成唯一字符串：

```
https://api.example.com/health?nocache={{random}}
```

### API 請求類型

選擇請求的 HTTP 方法：

- **GET**（默認）
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### 高級選項

#### 請求頭

向請求添加自定義 HTTP 頭。這對於認證令牌、內容類型規範和其他 API 特定頭非常有用。

您可以在頭的值中使用[監控器密鑰](/docs/monitor/monitor-secrets)來安全地儲存 API 密鑰等敏感數據。

#### 請求體（JSON）

對於 POST、PUT 和 PATCH 請求，您可以指定 JSON 請求體。您也可以在請求體中使用[監控器密鑰](/docs/monitor/monitor-secrets)。

#### 不跟隨重定向

默認情況下，OneUptime 跟隨 HTTP 重定向（301、302 等）。如果您想監控重定向響應本身而非最終目標，請啓用此選項。

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## 監控標準

您可以配置標準來判斷 API 何時處於在線、降級或離線狀態，基於以下條件：

- **響應狀態碼** - 檢查 HTTP 狀態碼是否與預期值匹配（例如 200、201）
- **響應時間** - 監控響應時間是否超過閾值
- **響應體** - 檢查響應體是否包含或匹配特定內容
- **響應頭** - 驗證特定響應頭是否存在或匹配預期值
- **JavaScript 表達式** - 編寫自定義表達式來評估響應。詳情參見 [JavaScript 表達式](/docs/monitor/javascript-expression)
