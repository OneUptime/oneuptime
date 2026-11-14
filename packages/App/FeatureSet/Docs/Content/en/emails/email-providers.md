# Email Providers

Send OneUptime's email through an email provider's HTTPS API instead of an SMTP server: Amazon SES, SendGrid, Mailgun, Postmark or Resend. A project picks one for an SMTP config, and a self-hosted installation can send all of its own email through one. The API is reached over HTTPS on port 443, so email still goes out from networks that block the SMTP ports, and each provider's key is stored encrypted.

:::cards
- [Amazon SES](#amazon-ses): An IAM access key, or the server's own IAM role, and the Region your sender is verified in.
- [SendGrid](#sendgrid): An API key with Mail Send access.
- [Mailgun](#mailgun): An API key, the sending domain and its region.
- [Postmark](#postmark): The server's API token.
- [Resend](#resend): An API key with sending access.
- [Troubleshooting](#troubleshooting): What each provider's refusal means.
:::

## Choosing a provider

:::tabs
@tab Project
On **Project Settings > Notifications > Notification Channels**, open **More settings** and click **Create SMTP Config** in the **Custom SMTP Configs** card. On the **Provider** step, enter a **Name** and pick the provider. The next step asks for that provider's settings, and the **Sender** step for the **From Email** and **From Name**. Once saved, **Send Test Email** on the config's row checks that it works.
@tab Self-hosted instance
In the Admin Dashboard, open **Settings**, then **Notifications > Emails**. In the **Email Server Settings** card, click **Edit Server** and pick the provider as the **Email Server Type**. The provider's card appears below it, such as **Amazon SES Settings**: click its edit button, such as **Edit Amazon SES**, and fill in the provider's settings and the **Sender** step. Until it has everything it needs, the card says what is missing, and each email is refused with the setting to fill in.
:::

| Provider   | What it asks for                         | Where OneUptime sends                                    |
| ---------- | ---------------------------------------- | -------------------------------------------------------- |
| Amazon SES | Access Key ID, Secret Access Key, Region | `https://email.<region>.amazonaws.com` (SES API v2)      |
| SendGrid   | API Key                                  | `https://api.sendgrid.com/v3/mail/send`                  |
| Mailgun    | API Key, Domain, Region                  | `https://api.mailgun.net` or `https://api.eu.mailgun.net` |
| Postmark   | Server API Token                         | `https://api.postmarkapp.com/email`                      |
| Resend     | API Key                                  | `https://api.resend.com/emails`                          |

Every email goes with its text part and its images (OneUptime's logo, screenshots) as inline attachments. When a provider limits how fast you send, or fails on its own side, OneUptime tries again after the wait the provider asks for; any other refusal is kept in the notification logs, with what the provider said.

## Amazon SES

:::steps
### Verify the sender

In the [Amazon SES console](https://console.aws.amazon.com/ses/), in the Region you will send from, verify the address you send from or its domain under **Identities**. While your account is in the SES sandbox, verify each recipient too, or request production access.

### Create an access key

Create an IAM user for OneUptime with a policy that allows `ses:SendEmail` on your identity, then create an access key for it:

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

A self-hosted installation on AWS can skip the key and [sign in with the server's IAM role](#sign-in-with-the-servers-iam-role) instead, with the same policy.

### Fill in the Amazon SES step

Enter the **Access Key ID** and the **Secret Access Key**, and the **Region** your identity is verified in, such as `us-east-1`.
:::

### Sign in with the server's IAM role

A self-hosted installation on AWS can send its own email as the IAM role AWS gives the server, with no access key stored in OneUptime: the credentials AWS hands out expire within hours, and OneUptime fetches new ones before they do. This is for the server's own email only. A project's Amazon SES config always signs in with an access key, because the server's role is the server's own AWS identity, not a project's.

Give the role the policy above, then run OneUptime as it:

:::tabs
@tab Amazon EKS
With IAM roles for service accounts, create the role with a trust policy for your cluster's OIDC provider, and have the Helm chart create a service account with the role's ARN. OneUptime's app and worker pods run as it:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

With EKS Pod Identity, create a pod identity association between the role and that service account instead, and leave out the annotation.
@tab Amazon ECS
Set the role as the **Task role** of OneUptime's task definition.
@tab Amazon EC2
Attach the role to the instance as its instance profile. With OneUptime in Docker on the instance, raise the instance metadata's hop limit to 2, so the containers can reach it:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Then, in the Admin Dashboard, click **Edit Amazon SES**, pick **This Server's IAM Role** as the **Authentication Type**, and enter the **Region**. Saving it removes any access key stored before.

OneUptime looks for the server's credentials where the AWS SDKs do, in this order: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in its environment, a web identity token (`AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`), the container credentials endpoint of Amazon ECS and EKS Pod Identity, then the EC2 instance metadata service (IMDSv2).

## SendGrid

In SendGrid, open **Settings > API Keys** and create a key with **Mail Send** access, and verify the address you send from (Single Sender Verification) or its domain (Domain Authentication). Enter the key as the **API Key** on the **SendGrid** step.

## Mailgun

In Mailgun, add and verify your sending domain, such as `mg.example.com`, then create a sending key for it, or use your account's API key. On the **Mailgun** step, enter the **API Key** and the **Domain**, and pick the **Region** the domain was created in: `EU` for a domain in Mailgun's EU region, `US` for the others. The **From Email** must be an address at that domain. A sandbox domain sends only to its authorized recipients.

## Postmark

In Postmark, open the server that sends, then its **API Tokens** tab, and copy the server API token: an account token does not send. Enter it as the **Server API Token** on the **Postmark** step. The **From Email** must be a confirmed sender signature, or an address at a verified domain. Until Postmark approves your account, it sends only to addresses at your own domain.

## Resend

In Resend, add and verify your domain under **Domains**, then create an API key with sending access under **API Keys**. Enter it as the **API Key** on the **Resend** step, with a **From Email** at your verified domain. Resend's own test domain sends only to your own address.

## Troubleshooting

A test email that does not go says why. For any other email, open the **Email** tab of **Project Settings > Notifications > Notification Logs** and select **View Status Message** on its row.

:::details "Amazon SES needs a verified identity in …"
The **From Email**, or its domain, is not verified in the Region set on the config, or the account is in the SES sandbox and the recipient is not verified. Verify it in that Region, or request production access.
:::

:::details "Amazon SES does not recognize the access key" or "did not accept the request's signature"
Check the **Access Key ID**, that the key is active in IAM, and that the **Secret Access Key** is the one created with it. A signature is also refused when the server's clock is wrong.
:::

:::details "The access key may not send with Amazon SES"
The IAM user's policy does not allow `ses:SendEmail` on your identity. Add the policy above.
:::

:::details "This server has no AWS credentials"
The server signs in with its IAM role, but AWS gives it none. Run it as the role, as [Sign in with the server's IAM role](#sign-in-with-the-servers-iam-role) shows, then restart OneUptime's pods or tasks: a pod gets its role's settings when it starts. In Docker on Amazon EC2, the message also says when the instance metadata's hop limit is too low.
:::

:::details "This server's IAM role may not send with Amazon SES" or "did not let this server assume the role"
The role's policy does not allow `ses:SendEmail` on your identity: add the policy above. Or, on Amazon EKS, the role's trust policy does not allow `sts:AssumeRoleWithWebIdentity` for your cluster's OIDC provider and OneUptime's service account.
:::

:::details "Mailgun has no domain … in its US region"
The domain is not in the region the config sends to. Check the **Domain**, and set the **Region** to `EU` if the domain was created there.
:::

:::details "is not a confirmed sender signature in Postmark" or "is not a verified domain in Resend"
Confirm the **From Email** as a sender, or verify its domain, in the provider's dashboard.
:::

:::details "did not accept the API key" or "did not accept the server API token"
Check the key on the config: SendGrid's needs Mail Send access, Mailgun's sending key works only for its own domain, Postmark needs the server's token, and Resend's needs sending access.
:::

## Next steps

:::cards
- [SMTP](/docs/emails/smtp): Send through your own mail server or Microsoft 365 instead.
- [Subscribers & Announcements](/docs/status-pages/subscribers): Send a status page's subscriber email through a project's SMTP config.
:::
