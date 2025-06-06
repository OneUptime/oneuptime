import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Card from "Common/UI/Components/Card/Card";
import { JSONObject } from "Common/Types/JSON";

export interface ComponentProps {
  manifest: JSONObject;
}

const MicrosoftTeamsIntegrationDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // If manifest is empty or incomplete, show a loading message
  const manifestContent = Object.keys(props.manifest).length > 0 
    ? JSON.stringify(props.manifest, null, 2)
    : 'Loading manifest... Please refresh the page if this persists.';

  const markdownText: string = `

##### Step 1: Create a Microsoft Teams App with this manifest

Since this is a self-hosted install, you need to create a Microsoft Teams App with the manifest below.

1. Go to [https://dev.teams.microsoft.com/apps](https://dev.teams.microsoft.com/apps)
2. Click "New app" 
3. Choose "Import app package" or "Upload a custom app"
4. Use the manifest below (download as a JSON file or copy the content)

**Important:** Before using this manifest, replace \`YOUR_MICROSOFT_TEAMS_APP_CLIENT_ID\` with your actual Microsoft Teams App Client ID from the Azure portal.

\`\`\`json
${manifestContent}
\`\`\`

##### Step 2: Get your Microsoft Teams App credentials

After creating the app in the Teams Developer Portal:

1. Note the **App ID** (this will be your \`MICROSOFT_TEAMS_APP_CLIENT_ID\`)
2. Go to Azure Portal > App registrations > find your app
3. Get the **Client Secret** from "Certificates & secrets" section
4. Note the **Tenant ID** from the app overview

##### Step 3: Add these environment variables to your OneUptime server

If you are using Docker Compose, add these to your \`.env\` file:

\`\`\`bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_MICROSOFT_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_MICROSOFT_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TEAMS_APP_TENANT_ID
\`\`\`


If you are using Kubernetes with Helm then, add these to your \`values.yaml\` file

\`\`\`text
microsoftTeamsApp: 
  clientId:
  clientSecret:
  tenantId:
\`\`\`

##### Step 3: Restart your OneUptime server

You need to restart your OneUptime server to apply these changes. Once you have restarted the server, you should see the "Connect to Microsoft Teams" button on this page. 

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
