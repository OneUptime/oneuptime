import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  agentId: ObjectID;
  agentKey: string;
}

const RunbookAgentInstallInstructions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <Card
      title="Install the Runbook Agent"
      description={
        <div className="space-y-3 w-full mt-3">
          <p className="text-sm text-gray-600">
            Run this Docker command on a host inside the infrastructure where
            you want bash steps to execute. The agent polls OneUptime for jobs
            tagged for it, runs the script locally, and reports the result back.
            Save the key now — you cannot view it again after closing.
          </p>
          <CodeBlock
            language="bash"
            code={`docker run --name oneuptime-runbook-agent --restart unless-stopped \\
  -e RUNBOOK_AGENT_ID=${props.agentId.toString()} \\
  -e RUNBOOK_AGENT_KEY=${props.agentKey} \\
  -e ONEUPTIME_URL=${host} \\
  -d oneuptime/runbook-agent:release`}
          />
          <p className="text-xs text-gray-500">
            The agent only needs outbound HTTPS to {host}. It does not accept
            inbound connections.
          </p>
        </div>
      }
    />
  );
};

export default RunbookAgentInstallInstructions;
