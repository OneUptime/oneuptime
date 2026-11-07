# 電子郵件提供者

透過電子郵件提供者的 HTTPS API 而非 SMTP 伺服器寄送 OneUptime 的郵件，支援 Amazon SES、SendGrid、Mailgun、Postmark 和 Resend。專案可以為 SMTP 設定選擇一個提供者，自行託管的安裝也可以透過提供者寄送其本身的所有郵件。API 透過 443 連接埠上的 HTTPS 連線，因此即使網路封鎖了 SMTP 連接埠，郵件仍能照常寄出；每個提供者的金鑰都會加密儲存。

:::cards
- [Amazon SES](#amazon-ses): IAM 存取金鑰，以及寄件者通過驗證的地區。
- [SendGrid](#sendgrid): 具有 Mail Send 權限的 API 金鑰。
- [Mailgun](#mailgun): API 金鑰、寄件網域及其地區。
- [Postmark](#postmark): 伺服器的 API 權杖。
- [Resend](#resend): 具有傳送權限的 API 金鑰。
- [疑難排解](#疑難排解): 各提供者的拒絕分別代表什麼。
:::

## 選擇提供者

:::tabs
@tab 專案
在 **專案設定 > 通知 > 通知設定** 中展開 **更多設定**，在 **自訂 SMTP 設定** 卡片中點選 **建立SMTP 設定**。在 **提供者** 步驟中輸入 **名稱** 並選擇提供者。下一個步驟會詢問該提供者的設定，**寄件者** 步驟則詢問 **寄件者電子郵件** 和 **寄件人名稱**。儲存後，可使用設定所在列的 **傳送測試電子郵件** 確認它是否正常運作。
@tab 自行託管的執行個體
在 Admin Dashboard 中開啟 **設定**，然後開啟 **通知 > 電子郵件**。在 **電子郵件伺服器設定** 卡片中點選 **編輯伺服器**，並將 **電子郵件伺服器類型** 設為該提供者。提供者的卡片會出現在其下方，例如 **Amazon SES 設定**：點選它的編輯按鈕，例如 **編輯 Amazon SES**，然後填寫提供者的設定和 **寄件者** 步驟。在所需的內容全部填妥之前，卡片會說明缺少什麼，每封郵件也都會被拒絕，並指出需要填寫的設定。
:::

| 提供者 | 需要填寫的內容 | OneUptime 寄送到的位址 |
| --- | --- | --- |
| Amazon SES | 存取金鑰 ID、私密存取金鑰、地區 | `https://email.<region>.amazonaws.com`（SES API v2） |
| SendGrid | API 金鑰 | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API 金鑰、網域、地區 | `https://api.mailgun.net` 或 `https://api.eu.mailgun.net` |
| Postmark | 伺服器 API 權杖 | `https://api.postmarkapp.com/email` |
| Resend | API 金鑰 | `https://api.resend.com/emails` |

每封郵件都會附上純文字部分，圖片（OneUptime 的標誌、螢幕擷取畫面）則以內嵌附件寄送。當提供者限制您的寄送速度，或在其本身一端發生錯誤時，OneUptime 會依提供者要求的時間等候後再試一次；其他任何拒絕都會連同提供者的回覆一起保存在通知日誌中。

## Amazon SES

:::steps
### 驗證寄件者

在 [Amazon SES 主控台](https://console.aws.amazon.com/ses/) 中，切換到您要用來寄送的地區，並在 **Identities** 下驗證您的寄件地址或其網域。在您的帳戶仍處於 SES 沙箱期間，也必須逐一驗證收件者，或申請生產環境存取權。

### 建立存取金鑰

為 OneUptime 建立一個 IAM 使用者，附加允許對您的身分執行 `ses:SendEmail` 的政策，然後為該使用者建立存取金鑰：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

### 填寫 Amazon SES 步驟

輸入 **存取金鑰 ID** 和 **私密存取金鑰**，以及您的身分通過驗證的 **地區**，例如 `us-east-1`。
:::

## SendGrid

在 SendGrid 中，開啟 **Settings > API Keys**，建立具有 **Mail Send** 權限的金鑰，並驗證您的寄件地址（Single Sender Verification）或其網域（Domain Authentication）。在 **SendGrid** 步驟中將該金鑰填入 **API 金鑰**。

## Mailgun

在 Mailgun 中，新增並驗證您的寄件網域，例如 `mg.example.com`，然後為其建立傳送金鑰，或使用您帳戶的 API 金鑰。在 **Mailgun** 步驟中，輸入 **API 金鑰** 和 **網域**，並選擇建立該網域時所在的 **地區**：位於 Mailgun EU 地區的網域選擇 `EU`，其他網域選擇 `US`。**寄件者電子郵件** 必須是該網域下的地址。沙箱網域只會寄送給其授權的收件者。

## Postmark

在 Postmark 中，開啟負責寄送的伺服器，進入其 **API Tokens** 分頁，並複製伺服器 API 權杖：帳戶權杖無法寄送郵件。在 **Postmark** 步驟中將其填入 **伺服器 API 權杖**。**寄件者電子郵件** 必須是已確認的寄件者簽章，或已驗證網域下的地址。在 Postmark 核准您的帳戶之前，它只會寄送到您自己網域下的地址。

## Resend

在 Resend 中，於 **Domains** 下新增並驗證您的網域，然後在 **API Keys** 下建立具有傳送權限的 API 金鑰。在 **Resend** 步驟中將其填入 **API 金鑰**，並使用已驗證網域下的 **寄件者電子郵件**。Resend 本身的測試網域只會寄送到您自己的地址。

## 疑難排解

測試郵件寄送失敗時會顯示原因。對於其他郵件，請開啟 **專案設定 > 通知 > 通知日誌** 的 **電子郵件** 分頁，然後在對應的列上選擇 **檢視狀態訊息**。

:::details "Amazon SES needs a verified identity in …"
**寄件者電子郵件** 或其網域未在設定所指定的地區中通過驗證，或者帳戶處於 SES 沙箱中而收件者未經驗證。請在該地區中進行驗證，或申請生產環境存取權。
:::

:::details "Amazon SES does not recognize the access key" 或 "did not accept the request's signature"
請檢查 **存取金鑰 ID**、該金鑰在 IAM 中是否為作用中，以及 **私密存取金鑰** 是否為與其一同建立的那一個。伺服器的時鐘不準確時，簽章也會被拒絕。
:::

:::details "The access key may not send with Amazon SES"
IAM 使用者的政策不允許對您的身分執行 `ses:SendEmail`。請新增上述政策。
:::

:::details "Mailgun has no domain … in its US region"
該網域不在設定寄送到的地區中。請檢查 **網域**；如果該網域是在 EU 地區建立的，請將 **地區** 設為 `EU`。
:::

:::details "is not a confirmed sender signature in Postmark" 或 "is not a verified domain in Resend"
請在提供者的主控台中將 **寄件者電子郵件** 確認為寄件者，或驗證其網域。
:::

:::details "did not accept the API key" 或 "did not accept the server API token"
請檢查設定中的金鑰：SendGrid 的金鑰需要 Mail Send 權限，Mailgun 的傳送金鑰只適用於其本身的網域，Postmark 需要伺服器的權杖，Resend 的金鑰需要傳送權限。
:::

## 後續步驟

:::cards
- [SMTP](/docs/emails/smtp): 改為透過您自己的郵件伺服器或 Microsoft 365 寄送。
- [訂閱者與公告](/docs/status-pages/subscribers): 使用專案的 SMTP 設定寄送郵件給狀態頁面訂閱者。
:::
