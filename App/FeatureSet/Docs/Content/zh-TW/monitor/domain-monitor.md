# 網域監測

網域監測讓您能夠監測網域名稱的註冊狀態與到期時間。OneUptime 會定期執行 WHOIS 查詢，以追蹤您網域的健康狀態，並在網域到期前向您發出警示。

## 概觀

網域監測會查詢您網域的 WHOIS 資料，以追蹤註冊細節。這讓您能夠：

- 監測網域到期日
- 偵測已到期或即將到期的網域
- 追蹤網域註冊商資訊
- 驗證名稱伺服器設定
- 監測網域狀態碼

## 建立網域監測

1. 前往 OneUptime Dashboard 中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Domain** 作為監測類型
4. 輸入您想要監測的網域名稱
5. 依需要設定監測條件

## 設定選項

### 基本設定

| 欄位        | 說明                               | 是否必填 |
| ----------- | ---------------------------------- | -------- |
| Domain Name | 要監測的網域（例如 `example.com`） | 是       |

### 進階設定

| 欄位         | 說明                      | 預設值 |
| ------------ | ------------------------- | ------ |
| Timeout (ms) | 等待 WHOIS 回應的時間長度 | 10000  |
| Retries      | 失敗時的重試次數          | 3      |

## 監測條件

您可以設定條件，以根據下列項目判斷您的網域被視為上線、降級或離線：

### 可用的檢查類型

| 檢查類型               | 說明                     |
| ---------------------- | ------------------------ |
| Domain Expires In Days | 距離網域註冊到期的天數   |
| Domain Registrar       | 網域註冊商名稱           |
| Domain Name Server     | 網域的名稱伺服器主機名稱 |
| Domain Status Code     | WHOIS 網域狀態碼         |
| Domain Is Expired      | 網域是否已到期           |

### 篩選類型

對於 **Domain Is Expired**：

- **True** — 網域已到期
- **False** — 網域尚未到期

對於 **Domain Expires In Days**：

- **Greater Than**、**Less Than**、**Greater Than or Equal To**、**Less Than or Equal To**、**Equal To**、**Not Equal To**

對於 **Domain Registrar**、**Domain Name Server** 與 **Domain Status Code**：

- **Contains** — 值包含指定的文字
- **Not Contains** — 值不包含指定的文字
- **Starts With** — 值以指定的文字開頭
- **Ends With** — 值以指定的文字結尾
- **Equal To** — 值完全相符
- **Not Equal To** — 值不相符

### 範例條件

#### 若網域將於 30 天內到期則發出警示

- **Check On**：Domain Expires In Days
- **Filter Type**：Less Than
- **Value**：30

#### 若網域已到期則標示為離線

- **Check On**：Domain Is Expired
- **Filter Type**：True

#### 驗證名稱伺服器是否正確

- **Check On**：Domain Name Server
- **Filter Type**：Contains
- **Value**：`ns1.example.com`

## 最佳實務

1. **設定提早警示** — 在到期前 60 天設定降級警示，並在到期前 14 天設定離線警示
2. **監測所有重要網域** — 納入主要網域、單獨註冊的子網域，以及任何用於電子郵件或 API 的網域
3. **追蹤註冊商變更** — 監測註冊商欄位，以偵測未經授權的網域移轉
