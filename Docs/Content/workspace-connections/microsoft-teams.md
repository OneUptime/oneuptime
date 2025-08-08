# Connecting OneUptime to Microsoft Teams

This guide walks you through creating a Microsoft Teams app (Azure AD app registration), granting the right permissions, and connecting it to OneUptime so your team can receive notifications in Teams.

## Prerequisites
- OneUptime is running and accessible (self-hosted or cloud)
- Admin access to your Microsoft 365 tenant
- Permission to register apps in Azure AD (Entra ID)

## Step 1: Create an Azure AD app for Microsoft Teams
1. Go to https://portal.azure.com and open "Microsoft Entra ID" (Azure Active Directory).
2. Navigate to "App registrations" → "New registration".
3. Name: OneUptime (or any clear name).
4. Supported account types: leave as default (Single tenant is fine; Multi-tenant also works if needed).
5. Redirect URI (type Web): add your OneUptime App API callback URL:
   - https://YOUR-HOST/api/microsoft-teams/auth/{projectId}/{userId}
   - You’ll copy the actual values from the connect flow; keep the same base format. If using HTTPS behind a proxy, ensure the external URL matches your Dashboard’s host.
6. Click "Register".

Make note of:
- Application (client) ID → MICROSOFT_TEAMS_APP_CLIENT_ID
- Directory (tenant) ID (if you want to restrict to a tenant)

## Step 2: Create a client secret
1. In the app blade → "Certificates & secrets" → "New client secret".
2. Description: OneUptime
3. Expiry: choose per your policy.
4. Save and copy the Value. This is your MICROSOFT_TEAMS_APP_CLIENT_SECRET.

Store the secret securely. You cannot retrieve it later.

## Step 3: API permissions
Open "API permissions" → add the following Microsoft Graph delegated permissions:
- openid
- profile
- offline_access
- User.Read
- Team.ReadBasic.All
- Channel.ReadBasic.All
- ChannelMessage.Send

Click "Grant admin consent" for your tenant so users aren’t prompted individually.

## Step 4: Configure OneUptime environment
Add these environment variables to OneUptime and restart services:

- MICROSOFT_TEAMS_APP_CLIENT_ID=your-client-id
- MICROSOFT_TEAMS_APP_CLIENT_SECRET=your-client-secret

Docker Compose example (config.env or .env):

MICROSOFT_TEAMS_APP_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_SUPER_SECRET

Helm values.yaml example:

microsoftTeamsApp:
  clientId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  clientSecret: "YOUR_SUPER_SECRET"

## Step 5: Connect Microsoft Teams in OneUptime
1. In the OneUptime Dashboard, go to Project Settings → Workspace Connections → Microsoft Teams.
2. Click "Connect Microsoft Teams".
3. You’ll be redirected to Microsoft’s consent screen. Accept the requested permissions.
4. You’ll be redirected back to OneUptime; the project and user tokens will be saved.

## Step 6: Configure notification rules
Once connected, set up rules to post to Teams for:
- Incidents → Microsoft Teams tab
- Alerts → Microsoft Teams tab
- Monitors → Microsoft Teams tab
- Scheduled Maintenance → Microsoft Teams tab
- On-Call Duty → Microsoft Teams tab

Choose a Team and Channel (e.g., General). OneUptime will send notifications using the app’s access.

## Notes & limitations
- Channel creation and member invites via Graph require additional permissions and admin consent; the initial release focuses on sending messages to existing channels.
- Messages are posted as HTML-rendered content in Teams. Formatting closely matches Slack-style blocks where possible.
- If you use a custom tenant, the authorize URL can target your tenant instead of "common" to limit consent to your directory.

## Troubleshooting
- Error: "Microsoft Teams client id is not configured."
  - Ensure MICROSOFT_TEAMS_APP_CLIENT_ID is set on the Dashboard/UI environment and the server; rebuild/restart.
- Consent or permission errors
  - Verify API permissions and that admin consent is granted.
- Messages not appearing
  - Confirm the Team/Channel exist and your app has access via Graph. Check OneUptime logs for Graph API responses.

That’s it — your OneUptime project is now connected to Microsoft Teams.
