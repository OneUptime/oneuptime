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
  const markdownText: string = `

##### Step 1: Since this is a self hosted install, you need to create a Microsoft Teams App with this manifest. 

Please create a Microsoft Teams App with the following manifest. You can do this by going to https://dev.teams.microsoft.com/apps and creating a new app. 

\`\`\`json
${JSON.stringify(props.manifest, null, 2)}
\`\`\`

##### Step 2: Add these env variables to your OneUptime server

If you are using Docker Compose then, 

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
