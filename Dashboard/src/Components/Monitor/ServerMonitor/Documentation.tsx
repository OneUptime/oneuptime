import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/src/Components/Card/Card";
import CodeBlock from "Common/UI/src/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/src/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  secretKey: ObjectID;
}

const ServerMonitorDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <>
      <Card
        title={`Set up your Server Monitor (Linux/Mac)`}
        description={
          <div className="space-y-2 w-full mt-5">
            <CodeBlock
              language="bash"
              code={`
# Install the agent
curl -s ${HTTP_PROTOCOL}${HOST.toString()}/docs/static/scripts/infrastructure-agent/install.sh | sudo bash 

# Configure the agent
sudo oneuptime-infrastructure-agent configure --secret-key=${props.secretKey.toString()} ${
                "--oneuptime-url=" + host
              }

# To Start
sudo oneuptime-infrastructure-agent start

# To Stop
sudo oneuptime-infrastructure-agent stop
`}
            />
          </div>
        }
      />

      <Card
        title={`Set up your Server Monitor (Windows)`}
        description={
          <div className="space-y-2 w-full mt-5">
            <CodeBlock
              language="bash"
              code={`
# Step 1: Download the agent from GitHub https://github.com/OneUptime/oneuptime/releases/latest
# You should see a file named oneuptime-infrastructure-agent_windows_amd64.zip (if you're using x64) or oneuptime-infrastructure-agent_windows_arm64.zip (if you're using arm64)
# Extract the zip file, and you should see a file named oneuptime-infrastructure-agent.exe 

# Command Line: Configure the agent in cmd (Run as Administrator)
oneuptime-infrastructure-agent configure --secret-key=${props.secretKey.toString()} ${
                "--oneuptime-url=" + host
              }

# To Start
oneuptime-infrastructure-agent start

# To Stop
oneuptime-infrastructure-agent stop
`}
            />
          </div>
        }
      />
    </>
  );
};

export default ServerMonitorDocumentation;
