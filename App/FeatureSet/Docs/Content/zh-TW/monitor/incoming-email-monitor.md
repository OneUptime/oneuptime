# 接收電子郵件監測器

接收電子郵件監測器讓您能夠根據傳送至各監測器專屬電子郵件地址的郵件來建立及解決警示。這對於整合舊有系統、第三方警示工具，或任何能夠傳送電子郵件通知的服務都非常實用。

## 運作方式

1. 當您建立接收電子郵件監測器時，OneUptime 會為該監測器產生一個專屬的電子郵件地址
2. 任何傳送至該地址的郵件都會被接收，並依照您所設定的條件進行評估
3. 根據條件，OneUptime 可以建立新警示或解決現有警示

這是一種將以電子郵件為基礎的警示系統整合至 OneUptime 事件管理工作流程的強大方式。

## 建立接收電子郵件監測器

1. 在您的 OneUptime 儀表板中前往 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **Incoming Email** 作為監測器類型
4. 設定監測器選項：
   - **Name：** 為您的監測器取一個具描述性的名稱
   - **Description：** 此監測器的用途
5. 設定您的 **Alert Creation Criteria**（建立警示的條件）
6. 設定您的 **Alert Resolution Criteria**（解決警示的條件）
7. 點選 **Create**

建立完成後，您會在監測器詳細資料頁面上看到此監測器專屬的電子郵件地址。

## 電子郵件地址格式

每個接收電子郵件監測器都會取得一個格式如下的專屬電子郵件地址：

```
monitor-{secret-key}@{inbound-domain}
```

例如：`monitor-abc123def456@inbound.yourdomain.com`

您可以從監測器詳細資料頁面複製此地址，並設定您的外部系統將郵件傳送至該地址。

## 可用的條件欄位

您可以根據以下電子郵件欄位來建立條件：

| 欄位               | 說明                       |
| ------------------ | -------------------------- |
| **Email Subject**  | 接收郵件的主旨列           |
| **Email From**     | 寄件者的電子郵件地址       |
| **Email Body**     | 郵件內文的純文字內容       |
| **Email To**       | 收件者的電子郵件地址       |
| **Email Received** | 以郵件接收時間為基礎的條件 |

## 可用的篩選類型

### 字串篩選（Subject、From、Body、To）

| 篩選             | 說明                   | 範例                           |
| ---------------- | ---------------------- | ------------------------------ |
| **Contains**     | 欄位包含指定的文字     | Subject 包含 "CRITICAL"        |
| **Not Contains** | 欄位不包含指定的文字   | Subject 不包含 "TEST"          |
| **Equals**       | 欄位完全符合指定的文字 | From 等於 "alerts@service.com" |
| **Not Equals**   | 欄位不符合指定的文字   | Subject 不等於 "OK"            |
| **Starts With**  | 欄位以指定的文字開頭   | Subject 以 "[ALERT]" 開頭      |
| **Ends With**    | 欄位以指定的文字結尾   | Subject 以 "- Production" 結尾 |
| **Is Empty**     | 欄位為空白或無內容     | Body 為空                      |
| **Is Not Empty** | 欄位有內容             | Subject 不為空                 |

### 以時間為基礎的篩選（Email Received）

| 篩選                        | 說明                      | 範例                   |
| --------------------------- | ------------------------- | ---------------------- |
| **Received In Minutes**     | 在 X 分鐘內收到郵件       | 在 30 分鐘內收到郵件   |
| **Not Received In Minutes** | 在 X 分鐘內未收到任何郵件 | 在 60 分鐘內未收到郵件 |

## 設定範例

### 範例 1：在重大郵件時建立警示

**Alert Creation Criteria：**

- Email Subject **Contains** "CRITICAL"
- 或 Email Subject **Contains** "ALERT"
- 或 Email Subject **Contains** "ERROR"

**Alert Resolution Criteria：**

- Email Subject **Contains** "RESOLVED"
- 或 Email Subject **Contains** "OK"
- 或 Email Subject **Contains** "RECOVERED"

### 範例 2：監測特定寄件者

**Alert Creation Criteria：**

- Email From **Equals** "monitoring@legacy-system.com"
- 且 Email Subject **Contains** "Failed"

**Alert Resolution Criteria：**

- Email From **Equals** "monitoring@legacy-system.com"
- 且 Email Subject **Contains** "Success"

### 範例 3：心跳監測器（無郵件 = 警示）

**Alert Creation Criteria：**

- Email Received **Not Received In Minutes**，值為 `60`

如果 60 分鐘內未收到任何郵件，這會建立一個警示——對於監測應該傳送完成郵件的排程工作或批次處理程序非常實用。

**Alert Resolution Criteria：**

- Email Received **Received In Minutes**，值為 `5`

這會在收到郵件時解決該警示。

## 使用案例

### 舊有系統整合

許多較舊的系統僅支援以電子郵件為基礎的警示。使用接收電子郵件監測器來：

- 將電子郵件警示轉換為 OneUptime 事件
- 在收到復原郵件時自動解決事件
- 集中管理來自多個舊有系統的警示

### 第三方服務監測

整合會傳送電子郵件通知的服務：

- 雲端供應商警示（AWS、GCP、Azure）
- 安全掃描工具
- 備份完成通知
- SSL 憑證到期警告

### 排程工作監測

監測批次工作與排程任務：

- 若未準時收到完成郵件則建立警示
- 透過錯誤通知郵件追蹤工作失敗
- 監測資料管線完成情形

### 多廠商警示彙整

整合來自多個監測工具的警示：

- 透過電子郵件接收來自 Nagios、Zabbix 或其他工具的警示
- 在 OneUptime 中統一事件管理
- 為所有警示維護單一真實來源

## 範本變數

設定事件範本時，您可以使用以下來自接收郵件的變數：

| 變數                  | 說明                 |
| --------------------- | -------------------- |
| `{{emailSubject}}`    | 接收郵件的主旨       |
| `{{emailFrom}}`       | 寄件者的電子郵件地址 |
| `{{emailTo}}`         | 收件者的電子郵件地址 |
| `{{emailBody}}`       | 郵件的純文字內文     |
| `{{emailReceivedAt}}` | 郵件接收的時間       |

## 監測器摘要檢視

監測器摘要會顯示：

- **Last Email Received At：** 最近一封郵件的接收時間
- **From：** 最後一封郵件的寄件者
- **Subject：** 最後一封郵件的主旨列
- **Email Headers：** 最後一封郵件的完整標頭（可展開）
- **Email Body：** 最後一封郵件的內容（可展開）

## 自行託管設定

如果您自行託管 OneUptime，則需要設定接收電子郵件供應商。目前支援：

- **SendGrid Inbound Parse** - 設定說明請參閱 [SendGrid Inbound Email Integration](/docs/self-hosted/sendgrid-inbound-email)

## 須注意事項

- **電子郵件地址安全性：** 監測器電子郵件地址包含一組密鑰。請將其視同密碼，切勿公開分享。
- **電子郵件大小：** 非常大的郵件（含大型附件）可能會被電子郵件供應商截斷或拒絕。
- **處理時間：** 郵件以非同步方式處理。在傳送郵件與建立警示之間可能會有數秒的延遲。
- **不區分大小寫：** 所有字串比對（Contains、Equals 等）皆不區分大小寫。
- **純文字：** 電子郵件內文條件使用郵件的純文字版本。HTML 格式會被移除。

## 疑難排解

### 未收到電子郵件

1. 確認電子郵件地址正確（檢查是否有拼字錯誤）
2. 檢查郵件是否被垃圾郵件篩選器封鎖
3. 確認您的接收電子郵件供應商已正確設定
4. 檢查 OneUptime 記錄中是否有任何錯誤訊息

### 未建立警示

1. 確認您的條件與郵件內容相符
2. 檢查監測器是否未被停用
3. 檢視監測器詳細資料中的評估記錄
4. 在使用模式比對之前，先以精確的字串比對進行測試

### 未解決警示

1. 確認您的解決條件與復原郵件相符
2. 確保有一個進行中的警示可供解決
3. 檢查解決郵件是否傳送至相同的監測器地址
