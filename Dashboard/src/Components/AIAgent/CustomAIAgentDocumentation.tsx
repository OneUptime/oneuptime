import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  aiAgentKey: string;
  aiAgentId: ObjectID;
}

const CustomAIAgentDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <>
      <Card
        title={`Set up your Custom AI Agent`}
        description={
          <div className="space-y-2 w-full mt-5">
            <CodeBlock
              language="bash"
              code={`
# Run with Docker
docker run --name oneuptime-ai-agent --network host -e AI_AGENT_KEY=${props.aiAgentKey.toString()} -e AI_AGENT_ID=${props.aiAgentId.toString()} -e ONEUPTIME_URL=${host.toString()} -d oneuptime/ai-agent:release
`}
            />
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                With Proxy Configuration (Optional)
              </h4>
              <CodeBlock
                language="bash"
                code={`
# With HTTP/HTTPS proxy
docker run --name oneuptime-ai-agent --network host \\
  -e AI_AGENT_KEY=${props.aiAgentKey.toString()} \\
  -e AI_AGENT_ID=${props.aiAgentId.toString()} \\
  -e ONEUPTIME_URL=${host.toString()} \\
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \\
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \\
  -e NO_PROXY=localhost,.internal.example.com \\
  -d oneuptime/ai-agent:release

# With proxy authentication
docker run --name oneuptime-ai-agent --network host \\
  -e AI_AGENT_KEY=${props.aiAgentKey.toString()} \\
  -e AI_AGENT_ID=${props.aiAgentId.toString()} \\
  -e ONEUPTIME_URL=${host.toString()} \\
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e NO_PROXY=localhost,.internal.example.com \\
  -d oneuptime/ai-agent:release
`}
              />
            </div>
          </div>
        }
      />
    </>
  );
};

export default CustomAIAgentDocumentation;
