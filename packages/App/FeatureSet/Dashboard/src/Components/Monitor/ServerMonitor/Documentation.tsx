import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  secretKey: ObjectID;
}

/*
 * The install commands are the cards' bodies, not their descriptions: Card
 * hides the description below md and puts it in a <p>, which cannot hold a
 * code block. A phone got two titles and no commands, on the Overview's
 * setup card as well as the Documentation tab.
 */
const ServerMonitorDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <>
      <Card title={`Set up your Server Monitor (Linux/Mac)`}>
        <div data-testid="server-monitor-setup-linux" className="w-full">
          <CodeBlock
            language="bash"
            code={`
# Install the agent
curl -sSL ${HTTP_PROTOCOL}${HOST.toString()}/docs/static/scripts/infrastructure-agent/install.sh | sudo bash 

# Configure the agent (without proxy)
sudo oneuptime-infrastructure-agent configure --secret-key=${props.secretKey.toString()} --oneuptime-url=${host}

# Configure the agent (with proxy - optional)
# If you're using a proxy, you can set the proxy by running the following command
sudo oneuptime-infrastructure-agent configure --proxy-url=http://proxy.example.com:8080  --secret-key=${props.secretKey.toString()} --oneuptime-url=${host}

# To Start
sudo oneuptime-infrastructure-agent start



# To Stop
sudo oneuptime-infrastructure-agent stop

# To Uninstall
sudo oneuptime-infrastructure-agent uninstall
`}
          />
        </div>
      </Card>

      <Card title={`Set up your Server Monitor (Windows)`}>
        <div data-testid="server-monitor-setup-windows" className="w-full">
          <CodeBlock
            language="bash"
            code={`
# Step 1: Download the agent from GitHub https://github.com/OneUptime/oneuptime/releases/latest
# You should see a file named oneuptime-infrastructure-agent_windows_amd64.zip (if you're using x64) or oneuptime-infrastructure-agent_windows_arm64.zip (if you're using arm64)
# Extract the zip file, and you should see a file named oneuptime-infrastructure-agent.exe 

# Command Line: Configure the agent in cmd (Run as Administrator)
oneuptime-infrastructure-agent configure --secret-key=${props.secretKey.toString()} --oneuptime-url=${host}

# Using a proxy (optional)
# If you're using a proxy, you can set the proxy by running the following command
oneuptime-infrastructure-agent configure --proxy-url=http://proxy.example.com:8080  --secret-key=${props.secretKey.toString()} --oneuptime-url=${host}

# To Start
oneuptime-infrastructure-agent start

# To Stop
oneuptime-infrastructure-agent stop

# To Uninstall
oneuptime-infrastructure-agent uninstall
`}
          />
        </div>
      </Card>
    </>
  );
};

export default ServerMonitorDocumentation;
