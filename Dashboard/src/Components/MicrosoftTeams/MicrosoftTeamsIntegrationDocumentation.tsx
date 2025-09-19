import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Card from "Common/UI/Components/Card/Card";

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent = (): ReactElement => {
  const markdownText: string = `

##### Step 1: Prerequisites

Azure Account - You can create one by going to https://azure.com.


##### Step 2: Create Azure App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to "App registrations" and click "New registration"
3. Fill out the registration form:
   - **Name:** oneuptime
   - **Supported account types:** Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
   - **Redirect URI:** Web - \`${window.location.origin}/api/microsoft-teams/auth\`
4. Click "Register"
5. Note down the "Application (client) ID" - you'll need this later

##### Step 3: Configure App Permissions

1. In your app registration, go to "API permissions"
2. Click "Add a permission" and select "Microsoft Graph"
3. Select "Delegated permissions" and add:
   - Team.ReadBasic.All
   - Channel.ReadBasic.All
   - ChannelMessage.Send
   - User.Read
4. Click "Grant admin consent" for your organization

##### Step 4: Create Client Secret

1. Go to "Certificates & secrets" in your app registration
2. Click "New client secret"
3. Add a description and set expiration (recommend 24 months)
4. Click "Add" and copy the secret value immediately - you won't be able to see it again

##### Step 5: Configure Bot Messaging Endpoint

Your OneUptime bot needs a publicly reachable HTTPS messaging endpoint so Microsoft Teams can deliver activities (messages, card actions, installation events, etc.). This is automatically included in the manifest we generate, but you must make sure it resolves publicly.

1. Ensure your OneUptime installation is accessible over HTTPS at your domain
2. The bot messaging endpoint (what goes into the Teams app manifest) must point to:
   - \`${window.location.origin}/api/microsoft-bot/messages\`
   
Once this endpoint is reachable, Teams will deliver events to it after the app (bot) is installed.

##### Step 6: Add these environment variables to your OneUptime server

If you are using Docker Compose then,

\`\`\`bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
\`\`\`

If you are using Kubernetes with Helm then, add these to your \`values.yaml\` file

\`\`\`text
microsoftTeamsApp:
  clientId:
  clientSecret:
\`\`\`

##### Step 7: Upload Teams App Manifest

1. Save the above JSON manifest as "manifest.json"
2. Create a folder with the manifest.json and app icons
3. Zip the folder
4. In Microsoft Teams, go to "Apps" → "Manage your apps" → "Upload an app"
5. Select "Upload a custom app" and choose your zip file

##### Step 8: Install the App in Teams

1. In Microsoft Teams, find your OneUptime app
2. Click "Add" to install it for your team
3. Grant the necessary permissions
4. Return to OneUptime dashboard and complete the integration setup

##### Step 9: Restart your OneUptime server

You need to restart your OneUptime server to apply these changes. Once you have restarted the server, you should see the "Connect to Microsoft Teams" button on this page.

##### Features

Once configured, OneUptime will be able to:

- Send incident alerts to Teams channels
- Send alert notifications to Teams channels
- Create dedicated channels for incidents
- Send interactive cards with action buttons (Acknowledge, Resolve, etc.)
- Send scheduled maintenance notifications

##### Troubleshooting

If you encounter issues:

- Ensure your app has the correct permissions granted
- Check that the redirect URI matches exactly
- Verify your environment variables are set correctly
- Make sure the bot is added to the channels you want to post to

We would like to improve this integration, so feedback is more than welcome. Please send us any at hello@oneuptime.com

    `;

  return (
    <Card
      title={`Integrating Microsoft Teams with your OneUptime Project`}
      description={`Microsoft Teams is not connected to OneUptime. Here are some of the steps you need to do to integrate Microsoft Teams with your OneUptime Project`}
    >
      <MarkdownViewer text={markdownText} />
    </Card>
  );
};

export default MicrosoftTeamsIntegrationDocumentation;
