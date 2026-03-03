import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeKey: string;
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
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                With Proxy Configuration (Optional)
              </h4>
              <CodeBlock
                language="bash"
                code={`
# With HTTP/HTTPS proxy
docker run --name oneuptime-probe --network host \\
  -e PROBE_KEY=${props.probeKey.toString()} \\
  -e PROBE_ID=${props.probeId.toString()} \\
  -e ONEUPTIME_URL=${host.toString()} \\
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \\
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \\
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# With proxy authentication
docker run --name oneuptime-probe --network host \\
  -e PROBE_KEY=${props.probeKey.toString()} \\
  -e PROBE_ID=${props.probeId.toString()} \\
  -e ONEUPTIME_URL=${host.toString()} \\
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
`}
              />
            </div>
          </div>
        }
      />
    </>
  );
};

export default CustomProbeDocumentation;
