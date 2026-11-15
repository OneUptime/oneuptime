# 电子邮件提供商

通过电子邮件提供商的 HTTPS API 而不是 SMTP 服务器发送 OneUptime 的邮件，支持 Amazon SES、SendGrid、Mailgun、Postmark 和 Resend。项目可以为 SMTP 配置选择一个提供商，自托管安装也可以通过提供商发送其自身的所有邮件。API 通过 443 端口上的 HTTPS 访问，因此即使网络封锁了 SMTP 端口，邮件也能照常发出；每个提供商的密钥都会加密存储。

:::cards
- [Amazon SES](#amazon-ses): IAM 访问密钥或服务器自身的 IAM 角色，以及发件人通过验证的区域。
- [SendGrid](#sendgrid): 具有 Mail Send 权限的 API 密钥。
- [Mailgun](#mailgun): API 密钥、发信域名及其区域。
- [Postmark](#postmark): 服务器的 API 令牌。
- [Resend](#resend): 具有发送权限的 API 密钥。
- [环境变量](#通过环境变量设置服务器的电子邮件): 通过 Helm values 或 `config.env` 设置自托管服务器的电子邮件。
- [故障排查](#故障排查): 各提供商的拒绝分别意味着什么。
:::

## 选择提供商

:::tabs
@tab 项目
在 **项目设置 > 通知 > 通知渠道** 中展开 **更多设置**，在 **自定义 SMTP 配置** 卡片中点击 **创建SMTP 配置**。在 **提供商** 步骤中输入 **名称** 并选择提供商。下一步会询问该提供商的设置，**发件人** 步骤则询问 **发件人邮箱** 和 **发件人名称**。保存后，可使用配置所在行的 **发送测试电子邮件** 检查它是否正常工作。
@tab 自托管实例
在 Admin Dashboard 中打开 **设置**，然后打开 **通知 > 电子邮件**。在 **电子邮件服务器设置** 卡片中点击 **编辑服务器**，并将 **邮件服务器类型** 设置为该提供商。提供商的卡片会出现在其下方，例如 **Amazon SES 设置**：点击它的编辑按钮，例如 **编辑 Amazon SES**，然后填写提供商的设置和 **发件人** 步骤。在填写完所需的全部内容之前，该卡片会说明缺少什么，每封邮件都会被拒绝，并指明需要填写的设置。 通过代码部署的服务器也可以改用环境变量设置它们：请参阅 [通过环境变量设置服务器的电子邮件](#通过环境变量设置服务器的电子邮件)。
:::

| 提供商 | 需要填写的内容 | OneUptime 发送到的地址 |
| --- | --- | --- |
| Amazon SES | 访问密钥 ID、私有访问密钥、区域 | `https://email.<region>.amazonaws.com`（SES API v2） |
| SendGrid | API 密钥 | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | API 密钥、域名、区域 | `https://api.mailgun.net` 或 `https://api.eu.mailgun.net` |
| Postmark | 服务器 API 令牌 | `https://api.postmarkapp.com/email` |
| Resend | API 密钥 | `https://api.resend.com/emails` |

每封邮件都会带上纯文本部分，图片（OneUptime 的徽标、截图）则作为内联附件发送。当提供商限制您的发送速率，或在其自身一侧出错时，OneUptime 会按提供商要求的时间等待后重试；其他任何拒绝都会连同提供商的回复一起保存在通知日志中。

## Amazon SES

:::steps
### 验证发件人

在 [Amazon SES 控制台](https://console.aws.amazon.com/ses/) 中，切换到您将用于发送的区域，在 **Identities** 下验证您的发件地址或其域名。在您的账号仍处于 SES 沙箱期间，还需要逐一验证收件人，或者申请生产访问权限。

### 创建访问密钥

为 OneUptime 创建一个 IAM 用户，为其附加允许对您的身份执行 `ses:SendEmail` 的策略，然后为该用户创建访问密钥：

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

在 AWS 上自托管的安装也可以不用密钥，而是附加同一策略，[使用服务器的 IAM 角色登录](#使用服务器的-iam-角色登录)。

### 填写 Amazon SES 步骤

输入 **访问密钥 ID** 和 **私有访问密钥**，以及您的身份通过验证的 **区域**，例如 `us-east-1`。
:::

### 使用服务器的 IAM 角色登录

在 AWS 上自托管的安装可以以 AWS 赋予服务器的 IAM 角色身份发送自己的邮件，OneUptime 中不存储任何访问密钥：AWS 发放的凭证会在数小时内过期，OneUptime 会在过期前获取新的凭证。这仅适用于服务器自己的邮件。项目的 Amazon SES 配置始终使用访问密钥登录，因为服务器的角色是服务器自己的 AWS 身份，而不是某个项目的。

为角色附加上面的策略，然后以该角色运行 OneUptime：

:::tabs
@tab Amazon EKS
使用服务账户的 IAM 角色时，用信任集群 OIDC 提供商的信任策略创建角色，并让 Helm Chart 创建一个带有该角色 ARN 的服务账户。OneUptime 的 app 和 worker Pod 以该账户运行：

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

使用 EKS Pod Identity 时，改为在角色和该服务账户之间创建 Pod Identity 关联，并省略注解。
@tab Amazon ECS
将角色设置为 OneUptime 任务定义的 **Task role**。
@tab Amazon EC2
将角色作为实例配置文件附加到实例。如果 OneUptime 在实例上的 Docker 中运行，请将实例元数据的跃点限制提高到 2，以便容器能够访问它：

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

然后在 Admin Dashboard 中点击 **编辑 Amazon SES**，将 **认证类型** 选为 **此服务器的 IAM 角色**，并输入 **区域**。保存后，之前存储的访问密钥会被删除。

OneUptime 按照 AWS SDK 的方式，依次在以下位置查找服务器的凭证：其环境中的 `AWS_ACCESS_KEY_ID` 和 `AWS_SECRET_ACCESS_KEY`、Web 身份令牌（`AWS_ROLE_ARN` 和 `AWS_WEB_IDENTITY_TOKEN_FILE`）、Amazon ECS 和 EKS Pod Identity 的容器凭证端点，最后是 EC2 的实例元数据服务（IMDSv2）。

## SendGrid

在 SendGrid 中，打开 **Settings > API Keys**，创建一个具有 **Mail Send** 权限的密钥，并验证您的发件地址（Single Sender Verification）或其域名（Domain Authentication）。在 **SendGrid** 步骤中将该密钥填入 **API 密钥**。

## Mailgun

在 Mailgun 中，添加并验证您的发信域名，例如 `mg.example.com`，然后为其创建发送密钥，或者使用您账号的 API 密钥。在 **Mailgun** 步骤中，输入 **API 密钥** 和 **域名**，并选择创建该域名时所在的 **区域**：Mailgun EU 区域中的域名选择 `EU`，其他域名选择 `US`。**发件人邮箱** 必须是该域名下的地址。沙箱域名只会向其授权的收件人发送邮件。

## Postmark

在 Postmark 中，打开负责发送的服务器，进入其 **API Tokens** 选项卡，复制服务器 API 令牌：账号令牌无法发送邮件。在 **Postmark** 步骤中将其填入 **服务器 API 令牌**。**发件人邮箱** 必须是已确认的发件人签名，或已验证域名下的地址。在 Postmark 批准您的账号之前，它只会向您自己域名下的地址发送邮件。

## Resend

在 Resend 中，在 **Domains** 下添加并验证您的域名，然后在 **API Keys** 下创建一个具有发送权限的 API 密钥。在 **Resend** 步骤中将其填入 **API 密钥**，并使用已验证域名下的 **发件人邮箱**。Resend 自己的测试域名只会向您自己的地址发送邮件。

## 通过环境变量设置服务器的电子邮件

通过代码部署的自托管服务器可以一启动就发送电子邮件，无需手动设置：通过环境变量设置它的电子邮件设置，可以来自 Terraform 或任何部署 OneUptime 的工具。一旦设置了 `GLOBAL_EMAIL_SERVER_TYPE`，服务器就按这些变量所描述的方式发送自己的电子邮件。在 Admin Dashboard 的 **设置** 中，**通知 > 电子邮件** 下保存的设置不再使用，该页面以只读方式显示这些设置，每个字段旁注明设置它的变量。如果要改为在 Admin Dashboard 中设置电子邮件，请将 `GLOBAL_EMAIL_SERVER_TYPE` 留空。项目的 SMTP 配置不受影响。

| 变量 | Helm 值 | 内容 |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`、`sendgrid`、`amazon-ses`、`mailgun`、`postmark` 或 `resend`。只有设置了它，OneUptime 才会读取其他变量 |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | 每封电子邮件的发件地址 |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | 每封电子邮件的发件人名称。`custom-smtp` 和 `sendgrid` 必填 |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp`（为空时也是如此），或 `microsoft-graph`，通过 OAuth 应用经 Microsoft Graph 发送 |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | 邮件服务器，例如 `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | 它的端口，例如 `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` 表示只通过带有效证书的加密连接发送，或 `false`（为空时也是如此） |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password`（为空时也是如此）、`oauth` 或 `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | 登录所用的邮箱，`oauth` 也需要。将它和密码都留空，即不登录直接发送 |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`，或在 `email.existingSecret.name` 中指定的 Secret | 它的密码 |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials`（为空时也是如此）或 `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | OAuth 应用的客户端 ID |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`，或在 `email.existingSecret.name` 中指定的 Secret | 它的客户端密钥；对于 `jwt-bearer`，是 PEM 格式的私钥 |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | 它的令牌 URL |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | 它的 scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | SendGrid 的 API 密钥 |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key`（为空时也是如此），或 `server-iam-role`，以服务器的 IAM 角色登录 |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | 访问密钥 ID |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`，或在 `email.existingSecret.name` 中指定的 Secret | 它的秘密访问密钥 |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | 发件人通过验证的区域，例如 `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | Mailgun 的 API 密钥 |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | 发信域名，例如 `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us`（为空时也是如此）或 `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`，或在 `email.existingSecret.name` 中指定的 Secret | Postmark 的服务器 API 令牌 |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`，或在 `email.existingSecret.name` 中指定的 Secret | Resend 的 API 密钥 |

只使用服务器类型会读取的变量：`custom-smtp` 使用以 `GLOBAL_EMAIL_SMTP_` 开头的变量，各提供商使用其自己的变量。服务器日志和 Admin Dashboard 会把设置了的其他变量标为未使用。

使用 Helm 时，在 values 的 `email` 下设置它们。为了不让密码或密钥出现在 Helm 随每个 release 保存的 values 中，请把它放进您自己的 Secret，并在 `email.existingSecret.name` 中指定该 Secret。Chart 从 `email.existingSecret.key` 中指定的键读取它，未指定时从以它命名的键读取：`smtpPassword`、`smtpOAuthClientSecret`、`sendgridApiKey`、`amazonSesSecretAccessKey`、`mailgunApiKey`、`postmarkServerToken` 或 `resendApiKey`。

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

Chart 会拒绝没有 `email.serverType` 的其他 `email` 值、缺少所需密码或密钥的设置、同时在 values 和 Secret 中给出的密码或密钥，以及设置不从中读取任何内容的 Secret。使用 Terraform 时，在 `helm_release` 上设置相同的值，并将密码或密钥作为敏感值。

使用 Docker Compose 时，在 `config.env` 中填写以 `GLOBAL_EMAIL_` 开头的设置项，然后运行 `npm run start` 重新创建容器。

OneUptime 在启动时读取这些变量。如果其中有错误，例如不是数字的端口或缺少密码，在修正之前服务器不会发送任何电子邮件；服务器日志、Admin Dashboard 的电子邮件设置和 `/admin/setup` 上的检查清单会指出是哪个变量。密码和密钥永远不会显示。要更改设置，请修改这些变量并重启 OneUptime：Admin Dashboard 不会更改它们。

## 故障排查

测试邮件发送失败时会显示原因。对于其他邮件，请打开 **项目设置 > 通知 > 通知日志** 的 **电子邮件** 选项卡，然后在对应行上选择 **查看状态消息**。

:::details "Amazon SES needs a verified identity in …"
**发件人邮箱** 或其域名未在配置所设的区域中通过验证，或者账号处于 SES 沙箱中且收件人未经验证。请在该区域中进行验证，或申请生产访问权限。
:::

:::details "Amazon SES does not recognize the access key" 或 "did not accept the request's signature"
请检查 **访问密钥 ID**、该密钥在 IAM 中是否处于活动状态，以及 **私有访问密钥** 是否是与它一起创建的那个。服务器时钟不准时，签名也会被拒绝。
:::

:::details "The access key may not send with Amazon SES"
IAM 用户的策略不允许对您的身份执行 `ses:SendEmail`。请添加上面的策略。
:::

:::details "This server has no AWS credentials"
服务器使用其 IAM 角色登录，但 AWS 没有给它凭证。按照 [使用服务器的 IAM 角色登录](#使用服务器的-iam-角色登录) 所示以该角色运行它，然后重启 OneUptime 的 Pod 或任务：Pod 在启动时获取其角色的设置。在 Amazon EC2 上的 Docker 中，如果实例元数据的跃点限制过低，消息也会说明。
:::

:::details "This server's IAM role may not send with Amazon SES" 或 "did not let this server assume the role"
角色的策略不允许对您的身份执行 `ses:SendEmail`：请添加上面的策略。或者，在 Amazon EKS 上，角色的信任策略不允许您集群的 OIDC 提供商和 OneUptime 的服务账户执行 `sts:AssumeRoleWithWebIdentity`。
:::

:::details "Mailgun has no domain … in its US region"
该域名不在配置发送到的区域中。请检查 **域名**；如果该域名是在 EU 区域创建的，请将 **区域** 设置为 `EU`。
:::

:::details "is not a confirmed sender signature in Postmark" 或 "is not a verified domain in Resend"
请在提供商的控制台中将 **发件人邮箱** 确认为发件人，或验证其域名。
:::

:::details "did not accept the API key" 或 "did not accept the server API token"
请检查配置中的密钥：SendGrid 的密钥需要 Mail Send 权限，Mailgun 的发送密钥只适用于其自身的域名，Postmark 需要服务器的令牌，Resend 的密钥需要发送权限。
:::

## 后续步骤

:::cards
- [SMTP](/docs/emails/smtp): 改为通过您自己的邮件服务器或 Microsoft 365 发送。
- [订阅者与公告](/docs/status-pages/subscribers): 使用项目的 SMTP 配置向状态页面订阅者发送邮件。
:::
