import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Card from "Common/UI/Components/Card/Card";
import { JSONObject } from "Common/Types/JSON";

export interface ComponentProps {
  manifest: JSONObject;
}

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent<ComponentProps> = (): ReactElement => {
  const markdwonText: string = `

##### Step 1: Create a Microsoft Teams App

You need to create a Microsoft Teams app in the Microsoft Azure portal.

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in the app details:
   - **Name**: OneUptime Integration
   - **Supported account types**: Accounts in any organizational directory
5. Click **Register**

##### Step 2: Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Add the following permissions:
   - **Channel.ReadWrite.All** (Application)
   - **ChannelMessage.Send** (Application)
   - **Team.ReadBasic.All** (Application)
   - **User.Read** (Delegated)

##### Step 3: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and set expiration
4. Copy the **Value** (this is your client secret)

##### Step 4: Configure Webhook Endpoint

1. Go to **App registrations** > Your app > **Authentication**
2. Add the following redirect URI:
   - **Type**: Web
   - **Redirect URI**: \`https://your-domain.com/api/microsoft-teams/auth/callback\`

##### Step 5: Add Environment Variables

Add these environment variables to your OneUptime server:

\`\`\`bash
MICROSOFT_TEAMS_CLIENT_ID=your_client_id
MICROSOFT_TEAMS_CLIENT_SECRET=your_client_secret
MICROSOFT_TEAMS_TENANT_ID=your_tenant_id
\`\`\`

If you are using Docker Compose:

\`\`\`yaml
environment:
  - MICROSOFT_TEAMS_CLIENT_ID=your_client_id
  - MICROSOFT_TEAMS_CLIENT_SECRET=your_client_secret
  - MICROSOFT_TEAMS_TENANT_ID=your_tenant_id
\`\`\`

If you are using Kubernetes with Helm, add these to your \`values.yaml\` file:

\`\`\`yaml
microsoftTeams:
  clientId: your_client_id
  clientSecret: your_client_secret
  tenantId: your_tenant_id
\`\`\`

##### Step 6: Configure Webhook URL

For interactive buttons to work, you need to configure the webhook URL in your Microsoft Teams app:

1. The webhook endpoint is: \`https://your-domain.com/api/notification/webhook/microsoft-teams/{projectId}\`
2. Configure this URL in your Microsoft Teams app manifest

##### Step 7: Restart OneUptime

Restart your OneUptime server to apply the changes. Once restarted, you should see the "Connect to Microsoft Teams" button on this page.

We would like to improve this integration, so feedback is more than welcome. Please send us any at hello@oneuptime.com

    `;

  return (
    <Card
      title={`Integrating Microsoft Teams with your OneUptime Project`}
      description={`Microsoft Teams is not connected to OneUptime. Here are some of the steps you need to do to integrate Microsoft Teams with your OneUptime Project`}
    >
      <MarkdownViewer text={markdwonText} />
    </Card>
  );
};

export default MicrosoftTeamsIntegrationDocumentation;
