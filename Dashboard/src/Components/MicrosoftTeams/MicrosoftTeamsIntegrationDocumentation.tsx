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
   - **Redirect URI**: Select "Web" and add: \`${window.location.origin}/api/teams/auth\`
5. Click **Register**

##### Step 2: Configure App Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Choose **Delegated permissions** and add:
   - \`Team.ReadBasic.All\`
   - \`Channel.ReadBasic.All\`
   - \`ChannelMessage.Send\`
   - \`User.Read\`
   - \`TeamMember.ReadWrite.All\`
5. Click **Add permissions**
6. Click **Grant admin consent** for your organization

##### Step 3: Get Application Credentials

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and select expiration
4. Copy the **Value** (this is your Client Secret)
5. Go to **Overview** and copy the **Application (client) ID**
6. Note your **Directory (tenant) ID** from the Overview page

##### Step 4: Configure OneUptime Environment Variables

Add these environment variables to your OneUptime configuration:

\`\`\`text
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
MICROSOFT_TENANT_ID=YOUR_TENANT_ID
\`\`\`

If you are using Kubernetes with Helm, add these to your \`values.yaml\` file:

\`\`\`yaml
microsoftTeamsApp: 
  clientId: YOUR_APPLICATION_CLIENT_ID
  clientSecret: YOUR_CLIENT_SECRET
  tenantId: YOUR_TENANT_ID
\`\`\`

##### Step 5: Restart your OneUptime server

You need to restart your OneUptime server to apply these changes. Once you have restarted the server, you should see the "Connect to Microsoft Teams" button on this page.

##### Additional Notes

- Make sure your OneUptime instance is accessible from the internet for the OAuth flow to work
- The redirect URI in your Azure app must exactly match your OneUptime API URL
- Users will need to have appropriate permissions in Teams to add the integration to channels

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
