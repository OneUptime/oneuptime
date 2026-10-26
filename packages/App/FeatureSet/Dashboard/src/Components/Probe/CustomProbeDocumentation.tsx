import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { DOCS_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  probeKey: string;
  probeId: ObjectID;
}

export const CUSTOM_PROBE_SETUP_TEST_ID: string = "custom-probe-setup";

/*
 * How to run this probe, on its page, for whoever may read its key: the
 * Docker command with the probe's ID and key filled in, a word on IPv6,
 * and the same command through a proxy - folded, since most probes reach
 * OneUptime without one.
 *
 * The commands are the card's body, not its description. A card draws its
 * description in a <p>, and the commands' blocks and heading inside one
 * were invalid HTML that React warned of; a description is also what a
 * phone hides when the card has a body.
 */
const CustomProbeDocumentation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const host: string = `${HTTP_PROTOCOL}${HOST}`;

  return (
    <Card
      title={`Set up your Custom Probe`}
      description="Run this command where the probe should run. Its ID and key are already in it."
    >
      <div className="space-y-3" data-testid={CUSTOM_PROBE_SETUP_TEST_ID}>
        <CodeBlock
          language="bash"
          code={`
# Run with Docker
docker run --name oneuptime-probe --network host -e PROBE_KEY=${props.probeKey.toString()} -e PROBE_ID=${props.probeId.toString()} -e ONEUPTIME_URL=${host.toString()} -d oneuptime/probe:release
`}
        />
        <p className="text-sm text-gray-500">
          {translator.translateText(
            "To monitor IPv6 destinations, run the probe on a host that has IPv6.",
          )}{" "}
          <a
            className="font-medium text-indigo-600 hover:underline"
            href={`${DOCS_URL.toString()}/probe/custom-probe#monitoring-ipv6-destinations`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {translator.translateText("Monitoring IPv6 destinations")}
          </a>
        </p>
        <FoldedSection
          title="Connecting through a proxy"
          variant="line"
          dataTestId="custom-probe-setup-proxy"
        >
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
  -e NO_PROXY=localhost,.internal.example.com \\
  -d oneuptime/probe:release

# With proxy authentication
docker run --name oneuptime-probe --network host \\
  -e PROBE_KEY=${props.probeKey.toString()} \\
  -e PROBE_ID=${props.probeId.toString()} \\
  -e ONEUPTIME_URL=${host.toString()} \\
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \\
  -e NO_PROXY=localhost,.internal.example.com \\
  -d oneuptime/probe:release
`}
          />
        </FoldedSection>
      </div>
    </Card>
  );
};

export default CustomProbeDocumentation;
