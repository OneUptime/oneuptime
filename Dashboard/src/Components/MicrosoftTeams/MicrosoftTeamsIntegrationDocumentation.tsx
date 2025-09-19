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

**Add Delegated Permissions** (when acting on behalf of a signed-in user):
   - **For basic user information:**
     - User.Read
   - **For reading team and channel information:**
     - Team.ReadBasic.All
     - Channel.ReadBasic.All
   - **For sending messages to channels:**
     - ChannelMessage.Send
   - **For creating channels:**
     - Channel.Create
   - **For personal and group chats:**
     - Chat.Create
     - ChatMessage.Send
     - Chat.ReadWrite

**Add Application Permissions** (when acting as the app itself, without a signed-in user):
   - **For reading team and channel information:**
     - Team.ReadBasic.All
     - Channel.ReadBasic.All
     - ChannelSettings.Read.All
   - **For creating and managing channels:**
     - Channel.Create
     - Channel.Delete.All (optional)
     - ChannelSettings.ReadWrite.All
   - **For channel messages:**
     - ChannelMessage.Read.All (to read messages)
   - **For managing channel members:**
     - ChannelMember.Read.All
     - ChannelMember.ReadWrite.All
   - **For creating and managing chats:**
     - Chat.Create
     - Chat.ReadBasic.All
     - Chat.ReadWrite.All
   - **For chat messages:**
     - ChatMessage.Read.All
   - **For managing chat members:**
     - ChatMember.Read.All
     - ChatMember.ReadWrite.All
   - **For team management:**
     - TeamMember.Read.All
   - **For user information:**
     - User.Read.All (to get user details)

3. Click "Grant admin consent" for your organization


##### Step 4: Create Client Secret

1. Go to "Certificates & secrets" in your app registration
2. Click "New client secret"
3. Add a description and set expiration (recommend 24 months)
4. Click "Add" and copy the secret value immediately - you won't be able to see it again

Please note: Do not copy the secret ID, you need the secret VALUE which is typically longer and includes more characters.

##### Step 5: Cretae a Bot Service

1. In the Azure Portal, navigate to "Azure Bot" and click "Create"
2. Fill out the bot creation form:
   - **Bot handle:** oneuptime-bot
   - **Subscription:** Your Azure subscription
   - **Resource group:** Create a new one or use an existing one
   - **Location:** Choose a location close to your users
   - **Pricing tier:** F0 (Free) is sufficient for testing
   - Please use the App ID and Tenant ID from your app registration created earlier

3. Click "Review + create" and then "Create"

4. Once deployed, go to your bot resource and navigate to "Configuration"
5. Set the "Messaging endpoint" to \`${window.location.origin}/api/microsoft-bot/messages\`
6. Save the configuration.

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


Restart your OneUptime server after adding these environment variables.

##### Step 7: Upload Teams App Manifest

1. Go to project Settings -> Integrations -> Microsoft Teams
2. Download the Teams app manifest from there
3. Go to Microsoft Teams, click on "Apps" in the sidebar
4. At the bottom, click "Manage your apps"
5. Click "Upload a custom app"
6. Select "Upload for me or my teams"
7. Upload the manifest zip file you downloaded earlier

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
