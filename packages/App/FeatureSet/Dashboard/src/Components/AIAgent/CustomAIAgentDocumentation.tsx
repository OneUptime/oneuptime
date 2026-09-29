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
          </div>
        }
      />
    </>
  );
};

export default CustomAIAgentDocumentation;
