# SMTP Configuration

OneUptime allows you to configure custom SMTP servers for sending emails such as incident notifications, alert notifications, and status page updates. This guide covers how to configure SMTP with both traditional username/password authentication and modern OAuth 2.0 authentication.

## Overview

You can configure SMTP settings in **Project Settings > Notifications > Custom SMTP**. OneUptime supports two authentication methods:

- **Username/Password Authentication**: Traditional SMTP authentication using username and password credentials
- **OAuth 2.0 Authentication**: Modern, secure authentication using OAuth 2.0 client credentials flow (recommended for Microsoft 365 and Google Workspace)

## Authentication Types

### Username/Password Authentication

This is the traditional method of SMTP authentication. Simply provide:

- **SMTP Host**: Your SMTP server hostname (e.g., `smtp.yourcompany.com`)
- **SMTP Port**: The SMTP port (typically 587 for TLS, 465 for SSL, or 25 for unencrypted)
- **Username**: Your SMTP username
- **Password**: Your SMTP password
- **Secure**: Enable TLS/SSL encryption

### OAuth 2.0 Authentication

OAuth 2.0 is the recommended authentication method for modern email providers like Microsoft 365 and Google Workspace. It provides enhanced security by using short-lived access tokens instead of storing passwords.

OneUptime uses the **OAuth 2.0 Client Credentials Grant Flow** with the **SASL XOAUTH2** mechanism to authenticate with SMTP servers.

## Configuring OAuth 2.0 for Microsoft 365

Microsoft 365 (Exchange Online) supports OAuth 2.0 authentication for SMTP. Follow these steps to configure it:

### Step 1: Register an Application in Microsoft Entra ID

1. Sign in to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** > **App registrations**
3. Click **New registration**
4. Enter a name for your application (e.g., "OneUptime SMTP")
5. Select the appropriate account type (typically "Accounts in this organizational directory only")
6. Click **Register**

### Step 2: Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **APIs my organization uses** and search for "Office 365 Exchange Online"
4. Select **Application permissions**
5. Add the **SMTP.SendAsApp** permission
6. Click **Grant admin consent** to approve the permissions

### Step 3: Create a Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and select an expiration period
4. Copy the **Value** (this is your Client Secret - you won't be able to see it again)
5. Note down the **Application (client) ID** from the Overview page

### Step 4: Register the Service Principal in Exchange Online

You must register the application's service principal in Exchange Online using PowerShell:

```powershell
# Install the Exchange Online Management module
Install-Module -Name ExchangeOnlineManagement

# Connect to Exchange Online
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -Organization <your-tenant-id>

# Register the service principal
# Find the Object ID from Enterprise Applications (not App Registrations)
New-ServicePrincipal -AppId <APPLICATION_ID> -ObjectId <OBJECT_ID>

# Grant mailbox permissions for the sender address
Add-MailboxPermission -Identity "sender@yourdomain.com" -User <SERVICE_PRINCIPAL_ID> -AccessRights FullAccess
```

### Step 5: Configure OneUptime

In OneUptime, configure your SMTP settings with:

| Field | Value |
|-------|-------|
| **SMTP Host** | `smtp.office365.com` |
| **SMTP Port** | `587` |
| **From Email** | Your sender email address (e.g., `notifications@yourdomain.com`) |
| **From Name** | Display name for emails |
| **Authentication Type** | `OAuth` |
| **Client ID** | Your Application (client) ID from Azure |
| **Client Secret** | The client secret you created |
| **Token URL** | `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token` |
| **Scope** | `https://outlook.office365.com/.default` |

> **Note**: Replace `{tenant-id}` in the Token URL with your actual Microsoft Entra tenant ID. You can find this in the Azure Portal under Microsoft Entra ID > Overview.

## Configuring OAuth 2.0 for Google Workspace

Google Workspace supports OAuth 2.0 for SMTP access. For service-to-service authentication, you'll need to use a Service Account with domain-wide delegation.

### Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the **Gmail API** for your project

### Step 2: Create a Service Account

1. Navigate to **IAM & Admin** > **Service Accounts**
2. Click **Create Service Account**
3. Enter a name and description
4. Click **Create and Continue**
5. Skip the optional steps and click **Done**

### Step 3: Create a Service Account Key

1. Click on your newly created service account
2. Go to the **Keys** tab
3. Click **Add Key** > **Create new key**
4. Select **JSON** format
5. Download the key file (this contains your Client ID and Private Key)

### Step 4: Enable Domain-Wide Delegation

1. In the service account details, click **Show advanced settings**
2. Under **Domain-wide delegation**, note the **Client ID**
3. Go to your [Google Workspace Admin Console](https://admin.google.com)
4. Navigate to **Security** > **API controls** > **Domain-wide delegation**
5. Click **Add new**
6. Enter the Client ID from step 2
7. Add the OAuth scope: `https://mail.google.com/`
8. Click **Authorize**

### Step 5: Configure OneUptime

In OneUptime, configure your SMTP settings with:

| Field | Value |
|-------|-------|
| **SMTP Host** | `smtp.gmail.com` |
| **SMTP Port** | `587` |
| **From Email** | Your Google Workspace email address |
| **From Name** | Display name for emails |
| **Authentication Type** | `OAuth` |
| **Client ID** | Your service account client ID |
| **Client Secret** | Your service account private key |
| **Token URL** | `https://oauth2.googleapis.com/token` |
| **Scope** | `https://mail.google.com/` |

> **Note**: For Google Workspace, the "Client Secret" field should contain the service account's private key from the JSON key file. The JWT-based authentication is handled automatically.

## Configuring OAuth 2.0 for Other Providers

OneUptime's OAuth implementation is provider-agnostic and works with any OAuth 2.0 provider that supports the **Client Credentials Grant Flow**. To configure a custom OAuth provider:

1. Set the **Token URL** to your provider's OAuth token endpoint
2. Set the **Scope** to the required scope(s) for SMTP access (space-separated if multiple)
3. Provide your **Client ID** and **Client Secret**

## How OAuth SMTP Authentication Works

When OneUptime sends an email using OAuth authentication:

1. **Token Request**: OneUptime requests an access token from the OAuth token endpoint using the client credentials grant flow
2. **Token Response**: The OAuth server returns a short-lived access token
3. **SMTP Authentication**: OneUptime connects to the SMTP server and authenticates using the **SASL XOAUTH2** mechanism, which encodes the username and access token in the format:
   ```
   base64("user=" + email + "^Aauth=Bearer " + accessToken + "^A^A")
   ```
4. **Email Sending**: Once authenticated, the email is sent through the SMTP server

## References

- [Microsoft: Authenticate IMAP, POP, SMTP using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Google: OAuth 2.0 Mechanism for IMAP/SMTP](https://developers.google.com/gmail/imap/xoauth2-protocol)