import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
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

  const dockerCommand: string = `docker run --name oneuptime-runbook-agent --restart unless-stopped \\
  -e RUNBOOK_AGENT_ID=${props.agentId.toString()} \\
  -e RUNBOOK_AGENT_KEY=${props.agentKey} \\
  -e ONEUPTIME_URL=${host} \\
  -d oneuptime/runbook-agent:release`;

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-gray-600">
        Run this Docker command on a host inside the infrastructure where you
        want bash steps to execute. The agent polls OneUptime for jobs tagged
        for it, runs the script locally, and reports the result back.
      </p>

      <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <Icon
          icon={IconProp.Key}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600"
        />
        <div className="text-sm text-amber-800">
          <span className="font-semibold">Save the agent key now.</span> You
          will not be able to view it again after closing this window.
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <Icon icon={IconProp.Terminal} className="h-4 w-4 text-gray-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Run on your Docker host
          </span>
        </div>
        <CodeBlock language="bash" code={dockerCommand} />
      </div>

      <div className="flex gap-2 text-xs leading-relaxed text-gray-500">
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>
          The agent only needs outbound HTTPS to{" "}
          <span className="font-mono text-gray-700">{host}</span>. It does not
          accept inbound connections.
        </span>
      </div>
    </div>
  );
};

export default RunbookAgentInstallInstructions;
