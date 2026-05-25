# 網站監控器

網站監控允許您監控任何網站或網頁的可用性、性能和響應。OneUptime 定期向您的網站 URL 發送 HTTP 請求，並檢查其是否正確響應。

## 概述

網站監控器通過發送 HTTP 請求並評估響應來檢查您的網頁。這使您能夠：

- 監控網站正常運行時間和可用性
- 跟蹤響應時間和性能
- 驗證 HTTP 狀態碼
- 檢查響應頭
- 在用戶發現之前檢測停機

## 創建網站監控器

1. 在 OneUptime 控制台中轉到 **監控器**
2. 點擊 **創建監控器**
3. 選擇 **網站** 作爲監控器類型
4. 輸入您要監控的網站 URL
5. 根據需要配置監控標準

## 配置選項

### 網站 URL

輸入您要監控的網站的完整 URL，包括協議（例如 `https://example.com`）。

### 動態 URL 佔位符

在監控位於 CDN 或緩存代理後面的 URL 時，監控器可能會收到緩存的響應，而不是直接訪問源服務器。要在每次檢查時繞過緩存，您可以使用動態 URL 佔位符，這些佔位符在每次監控請求時會被替換爲唯一值。

#### 支持的佔位符

| 佔位符 | 描述 | 示例值 |
|--------|------|--------|
| `{{timestamp}}` | 替換爲當前 Unix 時間戳（秒） | `1719500000` |
| `{{random}}` | 替換爲隨機唯一字符串 | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### 示例

使用佔位符配置您的監控器 URL：

```
https://example.com/health?cb={{timestamp}}
```

每次監控檢查時，URL 變爲：

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

您也可以使用 `{{random}}` 在每次請求時生成唯一字符串：

```
https://example.com/health?nocache={{random}}
```

### 高級選項

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

您可以配置標準來判斷網站何時處於在線、降級或離線狀態，基於以下條件：

- **響應狀態碼** - 檢查 HTTP 狀態碼是否與預期值匹配（例如 200、301）
- **響應時間** - 監控響應時間是否超過閾值
- **響應體** - 檢查響應體是否包含或匹配特定內容
- **響應頭** - 驗證特定響應頭是否存在或匹配預期值
