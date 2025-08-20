# Microsoft Teams Integration for Self-Hosted OneUptime

When running OneUptime in a self-hosted environment, you'll need to configure Microsoft Teams integration with your own Azure Active Directory application.

## Prerequisites

1. **Azure Account**: You need an Azure account with permissions to create app registrations.
2. **Microsoft Teams Admin Access**: Admin access to your Microsoft Teams workspace.
3. **OneUptime Installation**: A running self-hosted OneUptime instance.

## Step 1: Create Azure AD App Registration

1. **Navigate to Azure Portal**
   - Go to [Azure Portal](https://portal.azure.com)
   - Navigate to **Azure Active Directory** > **App registrations**

2. **Create New Registration**
   - Click **New registration**
   - Name: `OneUptime Teams Integration` (or your preferred name)
   - Supported account types: Select based on your organization's needs
   - Redirect URI: 
     - Type: **Web**
     - URL: `https://YOUR_ONEUPTIME_DOMAIN/api/microsoft-teams/auth`

3. **Configure Authentication**
   - In your app registration, go to **Authentication**
   - Add additional redirect URIs if needed
   - Enable **Access tokens** and **ID tokens** under Implicit grant

4. **Configure API Permissions**
   - Go to **API permissions**
   - Add the following Microsoft Graph permissions:
     - `ChannelMessage.Send`
     - `Channel.ReadWrite.All`
     - `Team.ReadBasic.All`
     - `User.Read`
   - Grant admin consent for your organization

5. **Create Client Secret**
   - Go to **Certificates & secrets**
   - Create a new client secret
   - Copy the secret value immediately (it won't be shown again)

## Step 2: Configure OneUptime Environment Variables

Add the following environment variables to your OneUptime deployment:

```bash
# Microsoft Teams App Configuration
MICROSOFT_TEAMS_APP_ID=<Your_Azure_App_Client_ID>
MICROSOFT_TEAMS_APP_PASSWORD=<Your_Client_Secret>
MICROSOFT_TEAMS_TENANT_ID=<Your_Azure_Tenant_ID>  # Optional: for single-tenant apps
```

### For Docker Compose

Add to your `docker-compose.yml` or `.env` file:

```yaml
environment:
  - MICROSOFT_TEAMS_APP_ID=${MICROSOFT_TEAMS_APP_ID}
  - MICROSOFT_TEAMS_APP_PASSWORD=${MICROSOFT_TEAMS_APP_PASSWORD}
  - MICROSOFT_TEAMS_TENANT_ID=${MICROSOFT_TEAMS_TENANT_ID}
```

### For Kubernetes/Helm

Update your `values.yaml`:

```yaml
microsoftTeamsApp:
  appId: "<Your_Azure_App_Client_ID>"
  appPassword: "<Your_Client_Secret>"
  tenantId: "<Your_Azure_Tenant_ID>"  # Optional
```

## Step 3: Configure Teams App Manifest (Optional)

For a better integration experience, you can create a Teams app manifest:

1. Create a `manifest.json` file with your app details
2. Update the `messagingExtensions` and `bots` sections with your app ID
3. Package the manifest with app icons as a .zip file
4. Upload to Teams Admin Center or directly to your Teams workspace

## Step 4: Database Migration

If you're upgrading an existing installation, run the database migrations:

```bash
# For Docker installations
docker exec -it oneuptime-app npm run typeorm -- migration:run

# For Kubernetes installations
kubectl exec -it <pod-name> -- npm run typeorm -- migration:run
```

## Step 5: Test the Integration

1. **Navigate to Project Settings**
   - In your OneUptime dashboard, go to **Project Settings** > **Microsoft Teams**
   
2. **Connect Microsoft Teams**
   - Click "Connect to Microsoft Teams"
   - Authenticate with your Microsoft account
   - Grant permissions when prompted

3. **Verify Connection**
   - Send a test notification to verify the integration works
   - Check that messages appear in your Teams channel

## Troubleshooting

### Connection Fails

- **Check App Registration**: Verify the app ID and secret are correct
- **Redirect URI**: Ensure the redirect URI matches exactly (including https://)
- **Permissions**: Verify all required permissions are granted
- **Network**: Ensure OneUptime can reach Microsoft Graph API endpoints

### Messages Not Sending

- **Check Logs**: Review OneUptime application logs for error messages
- **Token Expiry**: Tokens may need refreshing - try reconnecting
- **Channel Permissions**: Ensure the app has access to the target channels

### Webhook Notifications

For Status Page webhook notifications:

1. Ensure incoming webhooks are enabled in your Teams admin settings
2. Create webhooks in individual Teams channels
3. Use the webhook URL in OneUptime Status Page > Microsoft Teams Subscribers

## Security Considerations

1. **Client Secret**: Store the client secret securely, preferably in a secrets management system
2. **Permissions**: Grant only the minimum required permissions
3. **Tenant Restrictions**: For single-tenant apps, specify the MICROSOFT_TEAMS_TENANT_ID
4. **Network Security**: Use HTTPS for all communications
5. **Regular Updates**: Keep your Azure AD app registration and OneUptime installation updated

## Additional Resources

- [Microsoft Teams App Development Documentation](https://docs.microsoft.com/en-us/microsoftteams/platform/)
- [Microsoft Graph API Reference](https://docs.microsoft.com/en-us/graph/api/overview)
- [Azure AD App Registration Guide](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)