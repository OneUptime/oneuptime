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

const RunnerInstallInstructions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  const dockerCommand: string = `docker run --name oneuptime-runner --restart unless-stopped \\
  -e ONEUPTIME_RUNNER_ID=${props.agentId.toString()} \\
  -e ONEUPTIME_RUNNER_KEY=${props.agentKey} \\
  -e ONEUPTIME_URL=${host} \\
  -d oneuptime/runner:release`;

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-gray-600">
        Run this Docker command on a host inside the infrastructure you want
        this Runner to work in. It polls OneUptime for work assigned to it, does
        the work locally, and reports results back — so the credentials it uses
        never leave your network.
      </p>

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
          icon={IconProp.Code}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>
          What this Runner may do is set here, not in the container: it adopts a
          change on its next heartbeat. Turn on &quot;Runs AI Code Fixes&quot;
          and it will clone the code repositories connected to this project and
          open draft pull requests — it never writes to your default or
          protected branches. Turn a capability off and it stops taking that
          work immediately.
        </span>
      </div>

      <div className="flex gap-2 text-xs leading-relaxed text-gray-500">
        <Icon
          icon={IconProp.Lock}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span>
          The Runner only needs outbound HTTPS to{" "}
          <span className="font-mono text-gray-700">{host}</span>. It does not
          accept inbound connections.
        </span>
      </div>
    </div>
  );
};

export default RunnerInstallInstructions;
