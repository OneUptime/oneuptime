import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

export interface ComponentProps {
  manifest: any;
}

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent<
  ComponentProps
> = (_props: ComponentProps): ReactElement => {
  const markdownText: string = `
#### Setting up Microsoft Teams Integration with OneUptime

Microsoft Teams is not connected to OneUptime. Here are the steps you need to follow to integrate Microsoft Teams with your OneUptime Project:

##### Step 1: Create an Azure AD Application

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **App registrations** 
3. Click **New registration**
4. Fill in the application details:
   - **Name**: OneUptime Integration
   - **Supported account types**: Accounts in any organizational directory (Any Azure AD directory - Multitenant)
   - **Redirect URI**: Please add these URI's
    - \`${window.location.origin}/api/teams/auth\`
    - \`${window.location.origin}/api/teams/admin-consent\`
5. Click **Register**

##### Step 2: Configure App Permissions (Delegated + Application)

We use two permission models:
- **Delegated permissions (required)**: Used when a user signs in (interactive OAuth). Enables discovering teams/channels with the installing user's context and (optionally) managing membership.
- **Application permissions (for bot-style posting)**: Used to post as the app (client credentials). Without these, messages will fall back to posting as the installing user.

1. In your app registration, go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph**
3. Add the following **Delegated permissions** (required):
  - \`openid\` (returns an id_token so we can read tenant id)
  - \`profile\` (basic user profile claims)
  - \`offline_access\` (required for refresh tokens)
  - \`email\` (view users' email address)
  - \`User.Read\` (basic profile / required by most sign-ins)
  - \`Team.ReadBasic.All\` (read the names and descriptions of teams)
  - \`Channel.ReadBasic.All\` (read the names and descriptions of channels)
  - \`ChannelMessage.Send\` (send channel messages)
  - \`TeamMember.ReadWrite.All\` (add and remove members from teams)
  - \`Teamwork.Read.All\` (read organizational teamwork settings)
4. Add the following **Application permissions** (required for bot functionality):
  - \`Channel.Create\` (create channels)
  - \`Channel.Delete.All\` (delete channels)
  - \`Channel.ReadBasic.All\` (read the names and descriptions of all channels)
  - \`ChannelMember.Read.All\` (read the members of all channels)
  - \`ChannelMember.ReadWrite.All\` (add and remove members from all channels)
  - \`ChannelMessage.Read.All\` (read all channel messages)
  - \`ChatMessage.Read.All\` (read all chat messages)
  - \`Team.ReadBasic.All\` (get a list of all teams)
  - \`TeamMember.Read.All\` (read the members of all teams)
  - \`TeamMember.ReadWrite.All\` (add and remove members from all teams)
  - \`Teamwork.Migrate.All\` (create chat and channel messages with anyone's identity and with any timestamp)
  - \`Teamwork.Read.All\` (read organizational teamwork settings)
6. Click **Add permissions**
7. Click **Grant admin consent** for your organization (tenant admin required)
8. Verify all granted Application permissions show a green check mark

##### Step 3: Get Application Credentials

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and select expiration
4. Copy the **Value** (this is your Client Secret)
5. Go to **Overview** and copy the **Application (client) ID**

##### Step 4: Configure OneUptime Environment Variables

Add these environment variables to your OneUptime configuration:

\`\`\`text
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
\`\`\`

If you are using Kubernetes with Helm, add these to your \`values.yaml\` file:

\`\`\`yaml
microsoftTeamsApp: 
  clientId: YOUR_APPLICATION_CLIENT_ID
  clientSecret: YOUR_CLIENT_SECRET
\`\`\`



##### Step 5: Restart your OneUptime server

You need to restart your OneUptime server to apply these changes. Once you have restarted the server, you should see the "Connect to Microsoft Teams" button on this page.

##### Additional Notes

- Make sure your OneUptime instance is accessible from the internet for the OAuth flow to work
- The redirect URI in your Azure app must exactly match your OneUptime API URL


We would like to improve this integration, so feedback is more than welcome. Please send us any feedback at hello@oneuptime.com
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
