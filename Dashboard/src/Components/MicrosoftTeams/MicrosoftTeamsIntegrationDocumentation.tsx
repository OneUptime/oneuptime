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

##### Step 2: Configure App Permissions (Delegated + Application)

We use two permission models:
- **Delegated permissions (required)**: Used when a user signs in (interactive OAuth). Enables discovering teams/channels with the installing user's context and (optionally) managing membership.
- **Application permissions (for bot-style posting)**: Used to post as the app (client credentials). Without these, messages will fall back to posting as the installing user.

1. In your app registration, go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph**
3. Add the following **Delegated permissions** (required):
  - \`User.Read\` (basic profile / required by most sign-ins)
  - \`Team.ReadBasic.All\`
  - \`Channel.ReadBasic.All\`
  - \`ChannelMessage.Send\`
  - \`offline_access\` (required for token refresh)
  - \`TeamMember.ReadWrite.All\` (optional: only if you want OneUptime to add members to channels)
4. Add **Application permissions** (minimal required for posting as app):
  - \`ChannelMessage.Send\`
  - \`Channel.ReadBasic.All\`
  - \`Team.ReadBasic.All\`
  - \`Channel.Create\` (allow app to create channels)
  - \`Channel.Delete.All\` (allow deleting channels)
  - \`ChannelMessage.Read.All\` (read all channel messages)
  - \`ChannelMember.Read.All\` (read channel membership)
  - \`ChannelMember.ReadWrite.All\` (manage channel membership)
6. Click **Add permissions**
7. Click **Grant admin consent** for your organization (tenant admin required)
8. Verify all granted Application permissions show a green check mark

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
- Users will need to have appropriate permissions in Teams to add the integration to channels
- If application (bot) posting fails, the system automatically falls back to user delegated token (message will appear authored by the installing user)

##### Posting as the App / Bot

To have messages appear as the app instead of a user:
1. Ensure Application permissions in Step 2 are added and granted consent.
2. Restart OneUptime so the client credentials flow is active.
3. Trigger a notification; logs should contain:
  - \`Obtained new Microsoft Teams application (bot) access token.\`
  - If failure: \`Posting with application token failed (status 403). Falling back to user delegated token.\`

##### Troubleshooting 403 / Forbidden When Using App Token
| Symptom | Likely Cause | Fix |
|--------|--------------|-----|
| 403 Forbidden + message about Teams not provisioned | App-only permissions not fully effective yet or Teams service not enabled for app context | Wait a few minutes; confirm admin consent; verify token roles |
| 403 Forbidden ChannelMessage.Send | Missing \`ChannelMessage.Send\` (Application) or Resource Specific Consent (RSC) needed | Re-add permission and grant consent or add RSC manifest |
| App token works for channel list but not send | RSC required for posting in that team | Deploy Teams app manifest with RSC permission |

##### (Optional) Resource Specific Consent (RSC)
Some tenants and scenarios require RSC for app-only channel posting.
Add to your Teams app manifest:
\`\`\`json
"authorization": {
  "permissions": {
    "resourceSpecific": [
      { "name": "ChannelMessage.Send", "type": "Application" },
      { "name": "Channel.ReadBasic.All", "type": "Application" }
    ]
  }
}
\`\`\`
Then install (or update) the app in the Team and approve permissions as a Team owner.

##### Validate Application Token Roles
Decode the JWT (second segment) of the app token (base64) and confirm it includes roles:
\`ChannelMessage.Send\`, \`Channel.ReadBasic.All\`, \`Team.ReadBasic.All\`.

##### Fallback Behavior
If app posting fails with 401/403, OneUptime retries automatically with the user token so notifications still deliver.

##### Security Considerations
- Limit who can access the client secret.
- Rotate the client secret before expiry; update the environment variable and restart.
- Remove unused Application permissions to reduce blast radius.

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
