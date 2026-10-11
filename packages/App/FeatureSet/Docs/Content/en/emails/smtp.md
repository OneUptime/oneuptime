# SMTP Configuration

Send OneUptime's email through your own mail server. A project adds SMTP configs that its status pages send their email with, and a self-hosted installation sets the server OneUptime itself sends everything else from. Both support three ways of signing in:

- **Username and Password**: traditional SMTP authentication.
- **OAuth 2.0**: for Microsoft 365 and Google Workspace, where basic authentication is often turned off.
- **None**: for relay servers that don't require authentication.

```mermaid title="Which mail server sends what"
flowchart TB
    SP["A status page's email"] --> Q{"Custom SMTP Config<br/>picked for the page?"}
    Q -->|"Yes"| P["The project's SMTP config"]
    Q -->|"No"| D["OneUptime's own mail server"]
    E["All other OneUptime email"] --> D
```

On a self-hosted installation, OneUptime's own mail server is the one set in the Admin Dashboard. A status page picks its SMTP config on its **Subscriber Settings** page, in the **Custom SMTP** card.

:::cards
- [Add a mail server](#adding-an-smtp-server): Two steps, with everything else folded away.
- [Microsoft 365](#microsoft-365-configuration): OAuth with an Entra app registration.
- [Google Workspace](#google-workspace-configuration): OAuth with a service account.
- [Troubleshooting](#troubleshooting): Common errors and what they mean.
:::

## Adding an SMTP Server

Add a project's mail server on **Project Settings > Notifications > Notification Settings**, in the **Custom SMTP Configs** card. On a self-hosted installation, the server OneUptime itself sends from is set on **Admin Dashboard > Settings > Notifications > Emails**, in the **Custom Email and SMTP Settings** card. Both forms ask for the same things, in two steps.

:::steps
### Open the form

:::tabs
@tab Project
On **Project Settings > Notifications > Notification Settings**, click **Create SMTP Config** in the **Custom SMTP Configs** card.
@tab Self-hosted instance
In the Admin Dashboard, open **Settings**, then **Notifications > Emails** in the side menu (**Notifications** starts folded). In the **Email Server Settings** card, click **Edit Server** and set **Email Server Type** to `Custom SMTP`. Then click **Edit SMTP Config** in the **Custom Email and SMTP Settings** card, which appears below it.
:::

### Fill in the Server step

On the **Server** step, enter the **Name** (project configs only), **Hostname**, **Port** (a new project config starts on `587`), **Username** and **Password**.

### Check More fields

Everything else is folded under **More fields** at the end of the **Server** step. While it is folded, its header says how mail is sent, for example "Mail is sent over SMTP, signing in with the username and password. TLS is required." Open it only if you need to change one of the settings in the table below.

### Fill in the Sender step

On the **Sender** step, enter the **From Email** and **From Name** your emails come from. Your server must allow sending from that address.

### Save and send a test email

Save the config. Once a project config is saved, **Send Test Email** on its row checks that it works. It needs permission to add SMTP configs: **Project Owner**, **Project Admin**, or **Create SMTP Config** and **Read SMTP Config** in a custom role. On OneUptime Cloud it also needs the **Growth** plan, like adding a config. For anyone else it is locked, and its tooltip says what it takes.

The test asks for an **Email** address to send to, yours to start with. Check that the message arrives.
:::

These are the settings under **More fields**:

| Field                   | What it does                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport**           | `SMTP` (the default), or `Microsoft Graph` for a Microsoft 365 tenant that has SMTP AUTH turned off. Picking Microsoft Graph hides the hostname, port, username and password, and shows the OAuth fields.                                 |
| **Require TLS**         | On for a new project config. Mail is sent only over an encrypted connection with a valid certificate. When this is off, mail is encrypted only if the server offers it, and the certificate is not checked. Port 465 is always encrypted. |
| **Authentication Type** | `Username and Password` (the default), `OAuth`, or `None` for a relay that needs no sign-in.                                                                                                                                              |
| **OAuth fields**        | **OAuth Provider Type**, **OAuth Client ID**, **OAuth Client Secret**, **OAuth Token URL** and **OAuth Scope**, shown once OAuth or Microsoft Graph is picked.                                                                            |
| **Description**         | A note for your team (project configs only).                                                                                                                                                                                              |

**Microsoft Graph.** Open **More fields**, set **Transport** to `Microsoft Graph`, and fill in an Azure app that has the **Mail.Send** application permission: its client ID and client secret, the token URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` and the scope `https://graph.microsoft.com/.default`. Mail is sent from the **From Email** mailbox, which must be a licensed mailbox in your tenant.

> [!NOTE]
> On OneUptime Cloud, a project's mail server must be reachable over the internet: a host that resolves to a private or internal address is refused. On a self-hosted installation, private addresses are allowed unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`; loopback and link-local addresses are always refused. The instance's own mail server is not checked this way.

## OAuth 2.0 Authentication

OAuth 2.0 lets OneUptime sign in to your mail server without a password, which enterprise mail services increasingly require. OneUptime supports two OAuth grant types:

- **Client Credentials**: used by Microsoft 365 and most OAuth providers.
- **JWT Bearer**: used by Google Workspace service accounts.

```mermaid title="How OneUptime signs in with OAuth"
sequenceDiagram
    participant O as OneUptime
    participant T as Token URL
    participant M as Mail server
    O->>T: Request an access token
    T-->>O: Access token
    Note over O: Cached, and renewed<br/>before it expires
    O->>M: Sign in with the token
    O->>M: Send the email
```

**Authentication Type** and the OAuth fields are under **More fields** on the form's Server step. To sign in with OAuth, fill in:

| Field                     | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| **Hostname**              | SMTP server address                                                                 |
| **Port**                  | SMTP port (typically 587 for STARTTLS or 465 for implicit TLS)                      |
| **Username**              | The email address of the mailbox that sends                                         |
| **Authentication Type**   | `OAuth`                                                                             |
| **OAuth Provider Type**   | `Client Credentials` for Microsoft 365, or `JWT Bearer` for Google Workspace        |
| **OAuth Client ID**       | Application (client) ID from your OAuth provider (for Google: service account email) |
| **OAuth Client Secret**   | Client secret from your OAuth provider (for Google: the private key)                |
| **OAuth Token URL**       | Your provider's OAuth token endpoint                                                |
| **OAuth Scope**           | The OAuth scope that grants SMTP access                                             |

OneUptime caches OAuth tokens and renews them automatically before they expire.

## Microsoft 365 Configuration

To use OAuth with Microsoft 365 (Exchange Online), register an application in Microsoft Entra, give it permission to send mail over SMTP, and allow it to use the mailbox you send from.

:::steps
### Register an application in Microsoft Entra

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Go to **Identity** > **Applications** > **App registrations** and click **New registration**.
3. Enter a name (for example, "OneUptime SMTP"), select "Accounts in this organizational directory only", and leave **Redirect URI** blank.
4. Click **Register**.

On the **Overview** page, note the **Application (client) ID** (your client ID) and the **Directory (tenant) ID** (for the token URL).

### Create a client secret

1. In your app registration, go to **Certificates & secrets** and click **New client secret**.
2. Add a description, select an expiration period and click **Add**.
3. **Copy the secret value immediately**: it is not shown again.

### Add the SMTP permission

1. Go to **API permissions** and click **Add a permission**.
2. Select **APIs my organization uses**, then search for and select **Office 365 Exchange Online**.
3. Select **Application permissions**, check **SMTP.SendAsApp**, and click **Add permissions**.
4. Click **Grant admin consent for [your organization]** (this needs admin privileges).

### Register the service principal in Exchange Online

Before the application can send email, register its service principal in Exchange Online and give it access to the mailbox you send from:

```powershell
# Install and load the Exchange Online module, then connect
Install-Module -Name ExchangeOnlineManagement -Force
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal. Use the Object ID from
# Microsoft Entra > Enterprise Applications > your app (not App Registrations)
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>

# Give the service principal access to the sending mailbox
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess
```

> [!IMPORTANT]
> Use `Add-MailboxPermission`, not `Add-RecipientPermission`. `Add-RecipientPermission` only grants `SendAs` on the recipient, which is not enough for the service principal to send mail over SMTP with OAuth: sending fails with an authentication or permission error.

### Create the SMTP config in OneUptime

Create or edit an SMTP config with these settings, replacing `<tenant-id>` with your **Directory (tenant) ID**:

| Field               | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Hostname            | `smtp.office365.com`                                                         |
| Port                | `587`                                                                        |
| Username            | The email address you granted permissions to (e.g., `sender@yourdomain.com`) |
| Authentication Type | `OAuth`                                                                      |
| OAuth Provider Type | `Client Credentials`                                                         |
| OAuth Client ID     | Your **Application (client) ID**                                             |
| OAuth Client Secret | The client secret value                                                      |
| OAuth Token URL     | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`            |
| OAuth Scope         | `https://outlook.office365.com/.default`                                     |
| From Email          | Same as Username                                                             |
| Require TLS         | On                                                                           |

Then use **Send Test Email** to check it.
:::

## Google Workspace Configuration

Google Workspace needs a **service account** with domain-wide delegation, which sends email on behalf of a user in your domain. Google's SMTP servers don't support a plain client credentials flow for Gmail.

### Before you begin with Google Workspace

- A Google Workspace account. Consumer Gmail accounts don't support this.
- Super Admin access to the Google Workspace Admin Console.
- Access to the Google Cloud Console.

:::steps
### Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Click the project dropdown and select **New Project**.
3. Enter a project name, click **Create**, and select your new project.

### Enable the Gmail API

1. Go to **APIs & Services** > **Library**.
2. Search for "Gmail API", click **Gmail API** and then **Enable**.

### Create a service account

1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **Service account**.
3. Enter a name and description, click **Create and Continue**, skip the optional steps and click **Done**.

### Create a service account key

1. Click the service account you just created and go to the **Keys** tab.
2. Click **Add Key** > **Create new key**, select **JSON** and click **Create**.
3. Store the downloaded JSON file securely. Its `client_email` is your OAuth client ID, and its `private_key` your OAuth client secret.

### Enable domain-wide delegation

1. In the service account details, click **Show Advanced Settings**.
2. Note the numerical **Client ID**.
3. Check **Enable Google Workspace Domain-wide Delegation** and click **Save**.

### Authorize the service account in Google Workspace Admin

1. Sign in to the [Google Workspace Admin Console](https://admin.google.com).
2. Go to **Security** > **Access and data control** > **API Controls** and click **Manage Domain Wide Delegation**.
3. Click **Add new**, enter the numerical **Client ID** from the previous step, and for **OAuth Scopes** enter `https://mail.google.com/`.
4. Click **Authorize**.

The delegation can take from a few minutes up to 24 hours to take effect.

### Create the SMTP config for Google Workspace

Create or edit an SMTP config with these settings:

| Field               | Value                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname            | `smtp.gmail.com`                                                                                                                               |
| Port                | `587`                                                                                                                                          |
| Username            | The Google Workspace email address to send from (e.g., `notifications@yourdomain.com`). This user will be impersonated by the service account. |
| Authentication Type | `OAuth`                                                                                                                                        |
| OAuth Provider Type | `JWT Bearer`                                                                                                                                   |
| OAuth Client ID     | The `client_email` from your service account JSON (e.g., `your-service@your-project.iam.gserviceaccount.com`)                                  |
| OAuth Client Secret | The `private_key` from your service account JSON (the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`)      |
| OAuth Token URL     | `https://oauth2.googleapis.com/token`                                                                                                          |
| OAuth Scope         | `https://mail.google.com/`                                                                                                                     |
| From Email          | Same as Username                                                                                                                               |
| Require TLS         | On                                                                                                                                             |

Then use **Send Test Email** to check it.
:::

> [!IMPORTANT]
> For Google (JWT Bearer), the **OAuth Client ID** is the **service account email** (`client_email`), not the numerical `client_id`. The service account impersonates the user in **Username** to send email.

## Troubleshooting

### Microsoft 365 errors

| Issue                                           | Solution                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Authentication unsuccessful"                   | Verify the service principal is registered in Exchange and has mailbox permissions |
| "AADSTS700016: Application not found"           | Check that the client ID is correct and the app exists in your tenant              |
| "AADSTS7000215: Invalid client secret"          | Create a new client secret: the old one may have expired                           |
| "The mailbox is not enabled for this operation" | Run `Add-MailboxPermission` to grant access to the mailbox                         |

### Google Workspace errors

| Issue                                               | Solution                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| "invalid_grant"                                     | Ensure domain-wide delegation is properly configured and propagated   |
| "unauthorized_client"                               | Verify the Client ID is authorized in Google Workspace Admin Console  |
| "access_denied"                                     | Check that the scope `https://mail.google.com/` is authorized         |
| "Domain policy has disabled third-party Drive apps" | Enable API access in Google Workspace Admin > Security > API Controls |

### Other problems

:::details "Cannot send email. Please check your SMTP config."
**Send Test Email** says this when a server that signs in with a username and password, or without signing in, does not take the email. Check the **Hostname**, **Port**, **Username** and **Password**. If your server does not offer TLS, or its certificate is not valid for its hostname, turn **Require TLS** off under **More fields** and try again. The server's own answer is kept with the test: open the **Email** tab of **Project Settings > Notifications > Notification Logs** and select **View Status Message** on its row.
:::

:::details "Cannot send email with OAuth authentication"
The OAuth sign-in failed, and the message ends with the error your provider returned. Check the **OAuth Client ID**, **OAuth Client Secret**, **OAuth Token URL** and **OAuth Scope**, that the application has the permissions above, and that admin consent was granted. If your Microsoft 365 tenant has SMTP AUTH turned off, set **Transport** to `Microsoft Graph` instead.
:::

:::details "Microsoft Graph send failed"
A config whose **Transport** is `Microsoft Graph` says this when Graph does not take the email, followed by Microsoft's own error. Check that the app has the **Mail.Send** application permission with admin consent granted, that **OAuth Scope** is `https://graph.microsoft.com/.default`, and that the **From Email** is a licensed mailbox in your tenant.
:::

:::details "SMTP server host … could not be reached"
OneUptime refused to connect to the project's mail server. On OneUptime Cloud, a hostname that does not resolve, or resolves to a private, loopback or link-local address, is refused with this message, which never says which it was: use the mail server's public hostname. On a self-hosted installation, and for a mail server given as an IP address, the message says why instead. **Send Test Email** shows it only for an OAuth config; for the others, find it under **View Status Message** on the **Email** tab of the notification logs.
:::

:::details The test email does not arrive
Check the **From Email**: your server must allow sending from it. Then look in the recipient's spam folder, and in your mail server's logs for the attempt.
:::

## Security best practices

- **Rotate secrets regularly.** Set reminders to replace client secrets before they expire.
- **Use dedicated credentials.** Create separate credentials for OneUptime rather than sharing them with other applications.
- **Grant the least privilege.** Only grant what sending needs: **SMTP.SendAsApp** for Microsoft, the `https://mail.google.com/` scope for Google.
- **Monitor usage.** Review email logs and OAuth application sign-ins for unusual activity.
- **Store secrets securely.** Never commit client secrets to version control.

## Further reading

- Microsoft: [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- Microsoft: [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- Google: [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- Google: [Gmail API Documentation](https://developers.google.com/gmail/api)
- Google: [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)

## Next steps

:::cards
- [Notification Email Rollup](/docs/emails/notification-rollup): How OneUptime batches bursts of owner email.
- [Subscribers & Announcements](/docs/status-pages/subscribers): Send a status page's subscriber email through a project's SMTP config.
:::
