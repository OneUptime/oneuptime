# 電子郵件提供者

透過電子郵件提供者的 HTTPS API 而非 SMTP 伺服器寄送 OneUptime 的郵件，支援 Amazon SES、SendGrid、Mailgun、Postmark 和 Resend。專案可以為 SMTP 設定選擇一個提供者，自行託管的安裝也可以透過提供者寄送其本身的所有郵件。API 透過 443 連接埠上的 HTTPS 連線，因此即使網路封鎖了 SMTP 連接埠，郵件仍能照常寄出；每個提供者的金鑰都會加密儲存。

:::cards
- [Amazon SES](#amazon-ses): IAM 存取金鑰或伺服器本身的 IAM 角色，以及寄件者通過驗證的地區。
- [SendGrid](#sendgrid): 具有 Mail Send 權限的 API 金鑰。
- [Mailgun](#mailgun): API 金鑰、寄件網域及其地區。
- [Postmark](#postmark): 伺服器的 API 權杖。
- [Resend](#resend): 具有傳送權限的 API 金鑰。
- [環境變數](#透過環境變數設定伺服器的電子郵件): 透過 Helm values 或 `config.env` 設定自行託管伺服器的電子郵件。
- [疑難排解](#疑難排解): 各提供者的拒絕分別代表什麼。
:::

## 選擇提供者

:::tabs
@tab 專案
在 **專案設定 > 通知 > 通知管道** 中展開 **更多設定**，在 **自訂 SMTP 設定** 卡片中點選 **建立SMTP 設定**。在 **提供者** 步驟中輸入 **名稱** 並選擇提供者。下一個步驟會詢問該提供者的設定，**寄件者** 步驟則詢問 **寄件者電子郵件** 和 **寄件人名稱**。儲存後，可使用設定所在列的 **傳送測試電子郵件** 確認它是否正常運作。
@tab 自行託管的執行個體
在 Admin Dashboard 中開啟 **設定**，然後開啟 **通知 > 電子郵件**。在 **電子郵件伺服器設定** 卡片中點選 **編輯伺服器**，並將 **電子郵件伺服器類型** 設為該提供者。提供者的卡片會出現在其下方，例如 **Amazon SES 設定**：點選它的編輯按鈕，例如 **編輯 Amazon SES**，然後填寫提供者的設定和 **寄件者** 步驟。在所需的內容全部填妥之前，卡片會說明缺少什麼，每封郵件也都會被拒絕，並指出需要填寫的設定。 透過程式碼部署的伺服器也可以改用環境變數設定它們：請參閱 [透過環境變數設定伺服器的電子郵件](#透過環境變數設定伺服器的電子郵件)。
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

在 AWS 上自行託管的安裝也可以不用金鑰，而是附加同一政策，[使用伺服器的 IAM 角色登入](#使用伺服器的-iam-角色登入)。

### 填寫 Amazon SES 步驟

輸入 **存取金鑰 ID** 和 **私密存取金鑰**，以及您的身分通過驗證的 **地區**，例如 `us-east-1`。
:::

### 使用伺服器的 IAM 角色登入

在 AWS 上自行託管的安裝可以用 AWS 賦予伺服器的 IAM 角色身分傳送自己的郵件，OneUptime 中不會儲存任何存取金鑰：AWS 發放的憑證會在數小時內到期，OneUptime 會在到期前取得新的憑證。這僅適用於伺服器自己的郵件。專案的 Amazon SES 設定一律使用存取金鑰登入，因為伺服器的角色是伺服器自己的 AWS 身分，而不是某個專案的。

為角色附加上述政策，然後以該角色執行 OneUptime：

:::tabs
@tab Amazon EKS
使用服務帳戶的 IAM 角色時，以信任叢集 OIDC 提供者的信任政策建立角色，並讓 Helm Chart 建立一個帶有該角色 ARN 的服務帳戶。OneUptime 的 app 和 worker Pod 會以該帳戶執行：

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

使用 EKS Pod Identity 時，改為在角色與該服務帳戶之間建立 Pod Identity 關聯，並省略註解。
@tab Amazon ECS
將角色設定為 OneUptime 工作定義的 **Task role**。
@tab Amazon EC2
將角色作為執行個體設定檔附加到執行個體。如果 OneUptime 在執行個體上的 Docker 中執行，請將執行個體中繼資料的躍點限制提高到 2，讓容器能夠存取：

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

接著在 Admin Dashboard 中點選 **編輯 Amazon SES**，將 **驗證類型** 選為 **此伺服器的 IAM 角色**，並輸入 **地區**。儲存後，先前儲存的存取金鑰會被移除。

OneUptime 依照 AWS SDK 的方式，依序在下列位置尋找伺服器的憑證：其環境中的 `AWS_ACCESS_KEY_ID` 和 `AWS_SECRET_ACCESS_KEY`、Web 身分權杖（`AWS_ROLE_ARN` 和 `AWS_WEB_IDENTITY_TOKEN_FILE`）、Amazon ECS 和 EKS Pod Identity 的容器憑證端點，最後是 EC2 的執行個體中繼資料服務（IMDSv2）。

## SendGrid

在 SendGrid 中，開啟 **Settings > API Keys**，建立具有 **Mail Send** 權限的金鑰，並驗證您的寄件地址（Single Sender Verification）或其網域（Domain Authentication）。在 **SendGrid** 步驟中將該金鑰填入 **API 金鑰**。

## Mailgun

在 Mailgun 中，新增並驗證您的寄件網域，例如 `mg.example.com`，然後為其建立傳送金鑰，或使用您帳戶的 API 金鑰。在 **Mailgun** 步驟中，輸入 **API 金鑰** 和 **網域**，並選擇建立該網域時所在的 **地區**：位於 Mailgun EU 地區的網域選擇 `EU`，其他網域選擇 `US`。**寄件者電子郵件** 必須是該網域下的地址。沙箱網域只會寄送給其授權的收件者。

## Postmark

在 Postmark 中，開啟負責寄送的伺服器，進入其 **API Tokens** 分頁，並複製伺服器 API 權杖：帳戶權杖無法寄送郵件。在 **Postmark** 步驟中將其填入 **伺服器 API 權杖**。**寄件者電子郵件** 必須是已確認的寄件者簽章，或已驗證網域下的地址。在 Postmark 核准您的帳戶之前，它只會寄送到您自己網域下的地址。

## Resend

在 Resend 中，於 **Domains** 下新增並驗證您的網域，然後在 **API Keys** 下建立具有傳送權限的 API 金鑰。在 **Resend** 步驟中將其填入 **API 金鑰**，並使用已驗證網域下的 **寄件者電子郵件**。Resend 本身的測試網域只會寄送到您自己的地址。

## 透過環境變數設定伺服器的電子郵件

透過程式碼部署的自行託管伺服器可以一啟動就傳送電子郵件，無需手動設定：透過環境變數設定它的電子郵件設定，可以來自 Terraform 或任何部署 OneUptime 的工具。一旦設定了 `GLOBAL_EMAIL_SERVER_TYPE`，伺服器就按這些變數所描述的方式傳送自己的電子郵件。在 Admin Dashboard 的 **設定** 中，**通知 > 電子郵件** 下儲存的設定不再使用，該頁面以唯讀方式顯示這些設定，每個欄位旁註明設定它的變數。如果要改為在 Admin Dashboard 中設定電子郵件，請將 `GLOBAL_EMAIL_SERVER_TYPE` 留空。專案的 SMTP 設定不受影響。

| 變數 | Helm 值 | 內容 |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`、`sendgrid`、`amazon-ses`、`mailgun`、`postmark` 或 `resend`。只有設定了它，OneUptime 才會讀取其他變數 |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | 每封電子郵件的寄件地址 |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | 每封電子郵件的寄件者名稱。`custom-smtp` 和 `sendgrid` 必填 |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp`（為空時也是如此），或 `microsoft-graph`，透過 OAuth 應用程式經 Microsoft Graph 傳送 |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | 郵件伺服器，例如 `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | 它的連接埠，例如 `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` 表示只透過具備有效憑證的加密連線傳送，或 `false`（為空時也是如此） |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password`（為空時也是如此）、`oauth` 或 `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | 登入所用的信箱，`oauth` 也需要。將它和密碼都留空，即不登入直接傳送 |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`，或在 `email.existingSecret.name` 中指定的 Secret | 它的密碼 |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials`（為空時也是如此）或 `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | OAuth 應用程式的用戶端 ID |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`，或在 `email.existingSecret.name` 中指定的 Secret | 它的用戶端密碼；對於 `jwt-bearer`，是 PEM 格式的私密金鑰 |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | 它的權杖 URL |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | 它的 scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | SendGrid 的 API 金鑰 |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key`（為空時也是如此），或 `server-iam-role`，以伺服器的 IAM 角色登入 |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | 存取金鑰 ID |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`，或在 `email.existingSecret.name` 中指定的 Secret | 它的秘密存取金鑰 |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | 寄件者通過驗證的地區，例如 `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | Mailgun 的 API 金鑰 |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | 寄件網域，例如 `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us`（為空時也是如此）或 `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`，或在 `email.existingSecret.name` 中指定的 Secret | Postmark 的伺服器 API 權杖 |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | Resend 的 API 金鑰 |

只使用伺服器類型會讀取的變數：`custom-smtp` 使用以 `GLOBAL_EMAIL_SMTP_` 開頭的變數，各提供者使用其自己的變數。伺服器記錄和 Admin Dashboard 會把已設定的其他變數標為未使用。

使用 Helm 時，在 values 的 `email` 下設定它們。為了不讓密碼或金鑰出現在 Helm 隨每個 release 儲存的 values 中，請把它放進您自己的 Secret，並在 `email.existingSecret.name` 中指定該 Secret。Chart 從 `email.existingSecret.key` 中指定的鍵讀取它，未指定時從以它命名的鍵讀取：`smtpPassword`、`smtpOAuthClientSecret`、`sendgridApiKey`、`amazonSesSecretAccessKey`、`mailgunApiKey`、`postmarkServerToken` 或 `resendApiKey`。

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

Chart 會拒絕沒有 `email.serverType` 的其他 `email` 值、缺少所需密碼或金鑰的設定、同時在 values 和 Secret 中提供的密碼或金鑰，以及設定不從中讀取任何內容的 Secret。使用 Terraform 時，在 `helm_release` 上設定相同的值，並將密碼或金鑰設為敏感值。

使用 Docker Compose 時，在 `config.env` 中填寫以 `GLOBAL_EMAIL_` 開頭的設定，然後執行 `npm run start` 重新建立容器。

OneUptime 在啟動時讀取這些變數。如果其中有錯誤，例如不是數字的連接埠或缺少密碼，在修正之前伺服器不會傳送任何電子郵件；伺服器記錄、Admin Dashboard 的電子郵件設定和 `/admin/setup` 上的檢查清單會指出是哪個變數。密碼和金鑰永遠不會顯示。若要變更設定，請修改這些變數並重新啟動 OneUptime：Admin Dashboard 不會變更它們。

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

:::details "This server has no AWS credentials"
伺服器使用其 IAM 角色登入，但 AWS 沒有給它憑證。依照 [使用伺服器的 IAM 角色登入](#使用伺服器的-iam-角色登入) 所示以該角色執行它，然後重新啟動 OneUptime 的 Pod 或工作：Pod 會在啟動時取得其角色的設定。在 Amazon EC2 上的 Docker 中，如果執行個體中繼資料的躍點限制過低，訊息也會說明。
:::

:::details "This server's IAM role may not send with Amazon SES" 或 "did not let this server assume the role"
角色的政策不允許對您的身分執行 `ses:SendEmail`：請新增上述政策。或者，在 Amazon EKS 上，角色的信任政策不允許您叢集的 OIDC 提供者和 OneUptime 的服務帳戶執行 `sts:AssumeRoleWithWebIdentity`。
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
