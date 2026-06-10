# SSL 憑證監控器

SSL 憑證監控可讓您監控網站與服務上 SSL/TLS 憑證的有效性與到期狀況。OneUptime 會定期檢查您的憑證，並在憑證到期之前或偵測到任何問題時向您發出警示。

## 概觀

SSL 憑證監控器會連接到您的 HTTPS 端點並檢查 SSL/TLS 憑證。這讓您能夠：

- 監控憑證到期日期
- 偵測已到期或即將到期的憑證
- 識別自簽憑證
- 驗證憑證的有效性
- 防止因憑證到期而導致的服務中斷

## 建立 SSL 憑證監控器

1. 在 OneUptime 儀表板中前往 **Monitors**
2. 點選 **Create Monitor**
3. 選取 **SSL Certificate** 作為監控器類型
4. 輸入要檢查的 HTTPS 端點 URL
5. 視需要設定監控條件

## 設定選項

### URL

輸入您要監控其 SSL 憑證的端點完整 HTTPS URL（例如 `https://example.com` 或 `https://example.com:8443`）。

## 監控條件

您可以設定條件，以根據下列項目來判定您的憑證狀態應視為線上、降級或離線：

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| Is Online | 伺服器是否可連線 |
| Is Valid Certificate | 憑證是否有效（未到期、非自簽） |
| Is Self-Signed Certificate | 憑證是否為自簽 |
| Is Expired Certificate | 憑證是否已到期 |
| Is Not A Valid Certificate | 憑證是否無效 |
| Expires In Hours | 距離憑證到期的小時數 |
| Expires In Days | 距離憑證到期的天數 |
| Is Request Timeout | 連線是否逾時 |

### 篩選類型

對於 **Is Online**、**Is Valid Certificate**、**Is Self-Signed Certificate**、**Is Expired Certificate**、**Is Not A Valid Certificate** 及 **Is Request Timeout**：

- **True** — 條件為真
- **False** — 條件為假

對於 **Expires In Hours** 及 **Expires In Days**：

- **Greater Than** — 到期時間距離超過指定值
- **Less Than** — 到期時間距離小於指定值
- **Greater Than or Equal To** — 到期時間距離等於或超過指定值
- **Less Than or Equal To** — 到期時間距離等於或小於指定值
- **Equal To** — 到期時間完全相符
- **Not Equal To** — 到期時間不相符

### 條件範例

#### 若憑證將於 30 天內到期則標記為降級

- **Check On**：Expires In Days
- **Filter Type**：Less Than
- **Value**：30

#### 若憑證已到期則標記為離線

- **Check On**：Is Expired Certificate
- **Filter Type**：True

#### 若憑證為自簽則發出警示

- **Check On**：Is Self-Signed Certificate
- **Filter Type**：True

#### 若憑證無效則標記為離線

- **Check On**：Is Not A Valid Certificate
- **Filter Type**：True

## 最佳做法

1. **設定多個門檻** — 在到期前 30 天使用降級狀態、到期前 7 天使用離線狀態，讓自己有時間進行更新
2. **監控所有端點** — 如果您有多個網域或子網域，請為每一個建立監控器
3. **納入非標準連接埠** — 別忘了在非標準連接埠上執行 HTTPS 的服務
4. **更新後進行監控** — 更新憑證後，請確認監控器確認其為有效
