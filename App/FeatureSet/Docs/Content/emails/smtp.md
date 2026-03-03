# SMTP Configuration

OneUptime supports sending emails via custom SMTP servers with three authentication methods:

- **Username and Password** - Traditional SMTP authentication
- **OAuth 2.0** - Modern authentication for Microsoft 365 and Google Workspace
- **None** - For relay servers that don't require authentication

This guide covers how to configure OAuth 2.0 authentication for Microsoft 365 and Google Workspace.

## OAuth 2.0 Authentication

OAuth 2.0 provides a more secure way to authenticate with email servers, especially for enterprise environments that have disabled basic authentication. OneUptime supports two OAuth grant types:

- **Client Credentials** - Used by Microsoft 365 and most OAuth providers
- **JWT Bearer** - Used by Google Workspace service accounts

### Required Fields for OAuth

When configuring SMTP with OAuth authentication in OneUptime, you'll need:

| Field | Description |
|-------|-------------|
| **Hostname** | SMTP server address |
| **Port** | SMTP port (typically 587 for STARTTLS or 465 for implicit TLS) |
| **Username** | The email address to send from |
| **Authentication Type** | Select "OAuth" |
| **OAuth Provider Type** | Select "Client Credentials" for Microsoft 365, or "JWT Bearer" for Google Workspace |
| **Client ID** | Application/Client ID from your OAuth provider (for Google: service account email) |
| **Client Secret** | Client secret from your OAuth provider (for Google: private key) |
| **Token URL** | OAuth token endpoint URL |
| **Scope** | Required OAuth scope(s) for SMTP access |

---

## Microsoft 365 Configuration

To use OAuth with Microsoft 365/Exchange Online, you need to register an application in Microsoft Entra (Azure AD) and configure the appropriate permissions.

### Step 1: Register an Application in Microsoft Entra

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
2. Navigate to **Identity** > **Applications** > **App registrations**
3. Click **New registration**
4. Enter a name for your application (e.g., "OneUptime SMTP")
5. For **Supported account types**, select "Accounts in this organizational directory only"
6. Leave **Redirect URI** blank (not needed for client credentials flow)
7. Click **Register**

After registration, note the following values from the **Overview** page:
- **Application (client) ID** - This is your Client ID
- **Directory (tenant) ID** - You'll need this for the Token URL

### Step 2: Create a Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and select an expiration period
4. Click **Add**
5. **Copy the secret value immediately** - it won't be shown again

### Step 3: Add SMTP API Permissions

1. Go to **API permissions**
2. Click **Add a permission**
3. Select **APIs my organization uses**
4. Search for and select **Office 365 Exchange Online**
5. Select **Application permissions**
6. Find and check **SMTP.SendAsApp**
7. Click **Add permissions**
8. Click **Grant admin consent for [your organization]** (requires admin privileges)

### Step 4: Register Service Principal in Exchange Online

Before your application can send emails, you must register the service principal in Exchange Online and grant mailbox permissions.

1. Install the Exchange Online PowerShell module:

```powershell
Install-Module -Name ExchangeOnlineManagement -Force
```

2. Connect to Exchange Online:

```powershell
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>
```

3. Register the service principal (use the Object ID from **Enterprise Applications**, not App Registrations):

```powershell
# Find the Object ID in Microsoft Entra > Enterprise Applications > Your App > Object ID
New-ServicePrincipal -AppId <application-client-id> -ObjectId <enterprise-app-object-id>
```

4. Grant the service principal permission to send as a specific mailbox:

```powershell
# Grant full mailbox access
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <service-principal-id> -AccessRights FullAccess

# OR grant SendAs permission only
Add-RecipientPermission -Identity "sender@yourdomain.com" -Trustee <service-principal-id> -AccessRights SendAs
```

### Step 5: Configure in OneUptime

In OneUptime, create or edit an SMTP configuration with these settings:

| Field | Value |
|-------|-------|
| Hostname | `smtp.office365.com` |
| Port | `587` |
| Username | The email address you granted permissions to (e.g., `sender@yourdomain.com`) |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `Client Credentials` |
| Client ID | Your Application (client) ID from Step 1 |
| Client Secret | The secret value from Step 2 |
| Token URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scope | `https://outlook.office365.com/.default` |
| From Email | Same as Username |
| Secure (TLS) | Enabled |

Replace `<tenant-id>` with your Directory (tenant) ID from Step 1.

---

## Google Workspace Configuration

Google Workspace requires a **service account** with domain-wide delegation to send emails on behalf of users. This is necessary because Google's SMTP servers don't support direct OAuth client credentials flow for Gmail.

### Prerequisites

- Google Workspace account (not regular Gmail - consumer Gmail accounts don't support this)
- Super Admin access to Google Workspace Admin Console
- Access to Google Cloud Console

### Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown and select **New Project**
3. Enter a project name and click **Create**
4. Select your new project

### Step 2: Enable the Gmail API

1. Go to **APIs & Services** > **Library**
2. Search for "Gmail API"
3. Click **Gmail API** and then **Enable**

### Step 3: Create a Service Account

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **Service account**
3. Enter a name and description for the service account
4. Click **Create and Continue**
5. Skip the optional steps and click **Done**

### Step 4: Create Service Account Keys

1. Click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Select **JSON** and click **Create**
5. Save the downloaded JSON file securely - it contains:
   - `client_id` - Your Client ID
   - `private_key` - Your Client Secret (the private key)

### Step 5: Enable Domain-Wide Delegation

1. In the service account details, click **Show Advanced Settings**
2. Note the **Client ID** (numerical ID)
3. Check **Enable Google Workspace Domain-wide Delegation**
4. Click **Save**

### Step 6: Authorize the Service Account in Google Workspace Admin

1. Sign in to [Google Workspace Admin Console](https://admin.google.com)
2. Go to **Security** > **Access and data control** > **API Controls**
3. Click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Enter the **Client ID** from Step 5
6. For **OAuth Scopes**, enter: `https://mail.google.com/`
7. Click **Authorize**

Note: It may take a few minutes to 24 hours for the delegation to propagate.

### Step 7: Configure in OneUptime

In OneUptime, create or edit an SMTP configuration with these settings:

| Field | Value |
|-------|-------|
| Hostname | `smtp.gmail.com` |
| Port | `587` |
| Username | The Google Workspace email address to send from (e.g., `notifications@yourdomain.com`). This user will be impersonated by the service account. |
| Authentication Type | `OAuth` |
| OAuth Provider Type | `JWT Bearer` |
| Client ID | The `client_email` from your service account JSON (e.g., `your-service@your-project.iam.gserviceaccount.com`) |
| Client Secret | The `private_key` from your service account JSON (the entire key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`) |
| Token URL | `https://oauth2.googleapis.com/token` |
| Scope | `https://mail.google.com/` |
| From Email | Same as Username |
| Secure (TLS) | Enabled |

**Important:** For Google (JWT Bearer), the Client ID is the **service account email** (`client_email`), NOT the numerical `client_id`. The service account will impersonate the user specified in the Username field to send emails.

---

## Troubleshooting

### Microsoft 365

| Issue | Solution |
|-------|----------|
| "Authentication unsuccessful" | Verify the service principal is registered in Exchange and has mailbox permissions |
| "AADSTS700016: Application not found" | Check that the Client ID is correct and the app exists in your tenant |
| "AADSTS7000215: Invalid client secret" | Regenerate the client secret - it may have expired |
| "The mailbox is not enabled for this operation" | Run `Add-MailboxPermission` to grant access to the mailbox |

### Google Workspace

| Issue | Solution |
|-------|----------|
| "invalid_grant" | Ensure domain-wide delegation is properly configured and propagated |
| "unauthorized_client" | Verify the Client ID is authorized in Google Workspace Admin Console |
| "access_denied" | Check that the scope `https://mail.google.com/` is authorized |
| "Domain policy has disabled third-party Drive apps" | Enable API access in Google Workspace Admin > Security > API Controls |

### General

- **Test your configuration**: Use the "Send Test Email" button in OneUptime to verify your setup
- **Check logs**: Review OneUptime logs for detailed error messages
- **Token caching**: OneUptime caches OAuth tokens and refreshes them automatically before expiry

---

## Security Best Practices

1. **Rotate secrets regularly**: Set calendar reminders to rotate client secrets before they expire
2. **Use dedicated service accounts**: Create separate credentials for OneUptime rather than sharing with other applications
3. **Principle of least privilege**: Only grant the minimum permissions needed (SMTP.SendAsApp for Microsoft, mail.google.com scope for Google)
4. **Monitor usage**: Review email logs and OAuth application sign-ins for unusual activity
5. **Secure storage**: Never commit client secrets to version control

---

## Additional Resources

### Microsoft 365
- [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Register an application with Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

### Google Workspace
- [Using OAuth 2.0 for Server to Server Applications](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [XOAUTH2 Protocol](https://developers.google.com/gmail/imap/xoauth2-protocol)
