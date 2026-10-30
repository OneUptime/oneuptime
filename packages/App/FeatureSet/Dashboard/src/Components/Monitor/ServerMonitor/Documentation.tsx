import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  secretKey: ObjectID;
}

/*
 * The commands that connect a server to this monitor, with its secret key
 * and this OneUptime's URL filled in: each block runs as pasted. They install
 * the agent, connect it, start it and check that it runs - and stop there.
 * The Server / VM Monitor docs page has the same commands, and the other ways
 * to install the agent: apt, dnf and yum, Homebrew, and the MSI.
 *
 * The commands are the cards' bodies, not their descriptions: Card hides the
 * description below md and puts it in a <p>, which cannot hold a code block.
 * A phone got two titles and no commands, on the Overview's setup card as
 * well as the Documentation tab.
 */
export const getServerMonitorSetupCommands: (data: {
  secretKey: ObjectID;
  host: string;
}) => {
  linux: string;
  windowsInstall: string;
  windowsConnect: string;
} = (data: {
  secretKey: ObjectID;
  host: string;
}): { linux: string; windowsInstall: string; windowsConnect: string } => {
  const configure: string = `oneuptime-infrastructure-agent configure --secret-key=${data.secretKey.toString()} --oneuptime-url=${data.host}`;
  const docs: string = `${data.host}/docs/monitor/server-monitor`;
  const proxy: string =
    "Behind a proxy, add --proxy-url=http://your-proxy:8080 to configure.";

  return {
    linux: [
      `# Install the agent. To install it with apt, dnf, yum or Homebrew instead, see ${docs}`,
      `curl -sSL ${data.host}/docs/static/scripts/infrastructure-agent/install.sh | sudo bash`,
      "",
      `# Connect it to this monitor and start it. ${proxy}`,
      `sudo ${configure}`,
      "sudo oneuptime-infrastructure-agent start",
      "sudo oneuptime-infrastructure-agent status",
    ].join("\n"),
    windowsInstall: [
      `REM In an Administrator Command Prompt, install the agent. To install it from the MSI or the zip instead, see ${docs}`,
      "winget install --id OneUptime.InfrastructureAgent --exact --scope machine",
    ].join("\n"),
    windowsConnect: [
      `REM Then, in a new Administrator Command Prompt, connect it to this monitor and start it. ${proxy}`,
      configure,
      "oneuptime-infrastructure-agent start",
      "oneuptime-infrastructure-agent status",
    ].join("\n"),
  };
};

const ServerMonitorDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const commands: {
    linux: string;
    windowsInstall: string;
    windowsConnect: string;
  } = getServerMonitorSetupCommands({
    secretKey: props.secretKey,
    host: `${HTTP_PROTOCOL}${HOST}`,
  });

  return (
    <>
      <Card title={`Set up your Server Monitor (Linux/Mac)`}>
        <div data-testid="server-monitor-setup-linux" className="w-full">
          <CodeBlock language="bash" code={commands.linux} />
        </div>
      </Card>

      <Card title={`Set up your Server Monitor (Windows)`}>
        {/*
         * Two blocks: winget puts the agent on the path of the Command
         * Prompts opened after it, so the agent is connected in a new one.
         */}
        <div
          data-testid="server-monitor-setup-windows"
          className="w-full space-y-3"
        >
          <CodeBlock language="plaintext" code={commands.windowsInstall} />
          <CodeBlock language="plaintext" code={commands.windowsConnect} />
        </div>
      </Card>
    </>
  );
};

export default ServerMonitorDocumentation;
