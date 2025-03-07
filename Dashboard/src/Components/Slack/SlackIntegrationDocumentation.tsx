import React, { FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import Card from "Common/UI/Components/Card/Card";
import { JSONObject } from "Common/Types/JSON";

export interface ComponentProps {
  manifest: JSONObject;
}

const SlackIntegrationDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const markdwonText: string = `

##### Step 1: Since this is a self hosted install, you need to create a Slack App with this manifest. 

Please create a Slack App with the following manifest. You can do this by going to https://api.slack.com/apps and creating a new app. 

\`\`\`json
${JSON.stringify(props.manifest, null, 2)}
\`\`\`

##### Step 2: Add these env variables to your OneUptime server

If you are using Docker Compose then, 

\`\`\`bash
SLACK_APP_CLIENT_ID=YOUR_SLACK_APP_CLIENT_ID
SLACK_APP_CLIENT_SECRET=YOUR_SLACK_APP_CLIENT_SECRET
SLACK_APP_SIGNING_SECRET=YOUR_SLACK_APP_SIGNING_SECRET
\`\`\`


If you are using Kubernetes with Helm then, add these to your \`values.yaml\` file

\`\`\`text
slackApp: 
  clientId:
  clientSecret:
  signingSecret:
\`\`\`

##### Step 3: Restart your OneUptime server

You need to restart your OneUptime server to apply these changes. Once you have restarted the server, you should see the "Connect to Slack" button on this page. 

We would like to improve this integration, so feedback is more than welcome. Please send us any at hello@oneuptime.com


    `;

  return (
    <Card
      title={`Integrating Slack with your OneUptime Project`}
      description={`Slack is not connected to OneUptime. Here are some of the steps you need to do to integrate Slack with your OneUptime Project`}
    >
      <MarkdownViewer text={markdwonText} />
    </Card>
  );
};

export default SlackIntegrationDocumentation;
