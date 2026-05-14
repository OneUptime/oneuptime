# Microsoft Teams Integration

To integrate Microsoft Teams with your self-hosted OneUptime instance, you need to configure Azure App Registration and set up the required environment variables.

## Prerequisites

- Azure Account - You can create one by going to [https://azure.com](https://azure.com)
- Access to your OneUptime server configuration

## Setup Instructions

### Step 1: Create Azure App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to "App registrations" and click "New registration"
3. Fill out the registration form:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - Please also add: `https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. Click "Register"
5. Note down the "Application (client) ID" - you'll need this later

### Step 2: Configure App Permissions

1. In your app registration, go to "API permissions"
2. Click "Add a permission" and select "Microsoft Graph"

**Add Delegated Permissions** (when acting on behalf of a signed-in user):
   - **User.Read** - Required to get the authenticated user's profile information (display name, email) during the OAuth flow
   - **Team.ReadBasic.All** - Required to list teams that the user is a member of when selecting which team to connect
   - **Channel.ReadBasic.All** - Required to read channel information and list channels within teams for notification delivery
   - **ChannelMessage.Send** - Required to send alert and incident notifications to Teams channels

**Add Application Permissions** (when acting as the app itself, without a signed-in user):
   - **Team.ReadBasic.All** - Required to list all teams in the organization after admin consent is granted
   - **Channel.ReadBasic.All** - Required to verify channel existence and retrieve channel details
   - **ChannelMessage.Send** - Required to send messages to channels programmatically

**Note:** The Bot Framework handles message delivery using Resource-Specific Consent (RSC) permissions defined in the Teams app manifest. These permissions are:
   - **ChannelMessage.Send.Group** - Allows the bot to send messages to team channels
   - **ChannelMessage.Read.Group** - Allows the bot to read channel messages for interactive commands
   - **Channel.Create.Group** - Allows the bot to create channels when needed

3. Click "Grant admin consent" for your organization

### Step 3: Create Client Secret

1. Go to "Certificates & secrets" in your app registration
2. Click "New client secret"
3. Add a description and set expiration (recommend 24 months)
4. Click "Add" and copy the secret value immediately - you won't be able to see it again

**Important:** Do not copy the secret ID, you need the secret VALUE which is typically longer and includes more characters.

### Step 4: Create a Bot Service

1. In the Azure Portal, navigate to "Azure Bot" and click "Create"
2. Fill out the bot creation form:
   - **Bot handle:** oneuptime-bot
   - **Subscription:** Your Azure subscription
   - **Resource group:** Create a new one or use an existing one
   - **Location:** Choose a location close to your users
   - **Pricing tier:** F0 (Free) is sufficient for testing
   - Please use the App (client) ID and Tenant ID from your app registration created earlier

3. Click "Review + create" and then "Create"

4. Once deployed, go to your bot resource and navigate to "Configuration"
5. Set the "Messaging endpoint" to `https://your-oneuptime-domain.com/api/microsoft-bot/messages`
6. Save the configuration

### Step 5: Add Microsoft Teams Channel to the Bot

1. In your Azure Bot resource, navigate to "Channels"
2. Find and select "Microsoft Teams" and click "Open" or "Add"
3. Review the settings (enable for Teams, keep default messaging options unless you have specific needs)
4. Click "Save" (and "Done"/"Publish" if prompted) to enable the Teams channel

### Step 6: Configure OneUptime Environment Variables

#### Docker Compose

If you are using Docker Compose, add these environment variables to your configuration:

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### Kubernetes with Helm

If you are using Kubernetes with Helm, add these to your `values.yaml` file:

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**Important:** Restart your OneUptime server after adding these environment variables so they take effect.

### Step 7: Upload Teams App Manifest

1. Go to project **Settings** > **Integrations** > **Microsoft Teams**
2. Download the Teams app manifest from there
3. Go to Microsoft Teams, click on "Apps" in the sidebar
4. At the bottom, click "Manage your apps"
5. Click "Upload a custom app"
6. Select "Upload for me or my teams"
7. Upload the manifest zip file you downloaded earlier

## Troubleshooting

If you encounter issues:

- Ensure your app has the correct permissions granted
- Check that the redirect URI matches exactly (replace `your-oneuptime-domain.com` with your actual domain)
- Verify your environment variables are set correctly
- Make sure the bot messaging endpoint is accessible from the internet
- Verify that the bot is properly configured with the Teams channel
- Check that the Teams app manifest has been uploaded successfully

## Support

We would like to improve this integration, so feedback is more than welcome. Please send us any at [hello@oneuptime.com](mailto:hello@oneuptime.com)
