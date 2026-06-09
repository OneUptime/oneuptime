# DNS 監控

DNS 監控可讓您監控網域 DNS 解析的健康狀態與正確性。OneUptime 會定期查詢 DNS 記錄，並依據您設定的條件驗證回應結果。

## 概觀

DNS 監控會向 DNS 伺服器查詢特定的記錄類型並評估結果。這讓您能夠：

- 監控 DNS 服務的可用性
- 驗證 DNS 記錄是否傳回正確的值
- 追蹤 DNS 解析的回應時間
- 驗證 DNSSEC 設定
- 偵測 DNS 傳播問題或遭劫持的情形

## 建立 DNS 監控

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點擊 **Create Monitor**
3. 選擇 **DNS** 作為監控類型
4. 輸入要查詢的網域名稱與記錄類型
5. 依需要設定監控條件

## 設定選項

### 基本設定

| 欄位 | 說明 | 必填 |
|-------|-------------|----------|
| Domain Name | 要查詢的網域（例如 `example.com`） | 是 |
| Record Type | 要查詢的 DNS 記錄類型 | 是 |
| DNS Server | 要使用的自訂 DNS 伺服器（例如 `8.8.8.8`）。留空則使用系統預設值 | 否 |

### 支援的記錄類型

| 記錄類型 | 說明 |
|-------------|-------------|
| A | IPv4 位址記錄 |
| AAAA | IPv6 位址記錄 |
| CNAME | 正式名稱（別名）記錄 |
| MX | 郵件交換記錄 |
| NS | 名稱伺服器記錄 |
| TXT | 文字記錄（SPF、DKIM 等） |
| SOA | 授權起始（Start of Authority）記錄 |
| PTR | 指標記錄（反向 DNS） |
| SRV | 服務定位器記錄 |
| CAA | 憑證授權單位授權（Certificate Authority Authorization）記錄 |

### 進階設定

| 欄位 | 說明 | 預設值 |
|-------|-------------|---------|
| Port | DNS 連接埠號碼 | 53 |
| Timeout (ms) | 等待回應的時間長度 | 5000 |
| Retries | 失敗時的重試次數 | 3 |

## 監控條件

您可以設定條件，以根據下列項目判定 DNS 為線上、降級或離線狀態：

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| DNS Is Online | DNS 伺服器是否回應查詢 |
| DNS Response Time (in ms) | 查詢回應時間（以毫秒為單位） |
| DNS Record Exists | 查詢是否存在 DNS 記錄 |
| DNS Record Value | DNS 記錄所傳回的值 |
| DNSSEC Is Valid | DNSSEC 驗證是否通過 |

### 篩選類型

對於 **DNS Is Online**、**DNS Record Exists** 以及 **DNSSEC Is Valid**：

- **True** — 條件為真
- **False** — 條件為假

對於 **DNS Response Time**：

- **Greater Than**、**Less Than**、**Greater Than or Equal To**、**Less Than or Equal To**、**Equal To**、**Not Equal To**

對於 **DNS Record Value**：

- **Contains** — 記錄值包含指定的文字
- **Not Contains** — 記錄值不包含指定的文字
- **Starts With** — 記錄值以指定的文字開頭
- **Ends With** — 記錄值以指定的文字結尾
- **Equal To** — 記錄值完全相符
- **Not Equal To** — 記錄值不相符

### 條件範例

#### 檢查 DNS 是否能夠解析

- **Check On**：DNS Is Online
- **Filter Type**：True

#### 驗證 A 記錄是否指向正確的 IP

- **Check On**：DNS Record Value
- **Filter Type**：Equal To
- **Value**：`93.184.216.34`

#### 在 DNS 回應緩慢時發出警示

- **Check On**：DNS Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：500

#### 驗證 DNSSEC 是否有效

- **Check On**：DNSSEC Is Valid
- **Filter Type**：True
