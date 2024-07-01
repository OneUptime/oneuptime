import ObjectID from "Common/Types/ObjectID";
import Card from "CommonUI/src/Components/Card/Card";
import CodeBlock from "CommonUI/src/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "CommonUI/src/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeKey: ObjectID;
  probeId: ObjectID;
}

const CustomProbeDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <>
      <Card
        title={`Set up your Custom Probe`}
        description={
          <div className="space-y-2 w-full mt-5">
            <CodeBlock
              language="bash"
              code={`
# Run with Docker
docker run --name oneuptime-probe --network host -e PROBE_KEY=${props.probeKey.toString()} -e PROBE_ID=${props.probeId.toString()} -e ONEUPTIME_URL=${host.toString()} -d oneuptime/probe:release
`}
            />
          </div>
        }
      />
    </>
  );
};

export default CustomProbeDocumentation;
