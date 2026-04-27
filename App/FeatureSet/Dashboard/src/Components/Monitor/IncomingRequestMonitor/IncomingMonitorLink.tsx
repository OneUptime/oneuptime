import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import Link from "Common/UI/Components/Link/Link";

export interface ComponentProps {
  secretKey: ObjectID;
}

const IncomingMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const heartbeatUrl: URL = new URL(HTTP_PROTOCOL, HOST)
    .addRoute("/heartbeat")
    .addRoute(`/${props.secretKey.toString()}`);

  return (
    <>
      <Card
        title={`Incoming Request URL / Heartbeat URL`}
        description={
          <span>
            <span>
              Please send inbound heartbeat GET or POST requests to this URL{" "}
              <Link openInNewTab={true} to={heartbeatUrl}>
                <span>{heartbeatUrl.toString()}</span>
              </Link>
              .
            </span>
            <br />
            <br />
            <span>
              <strong>Sending from a private network?</strong> A Custom Probe
              with <code>PROBE_INGRESS_PORT</code> set will accept the same
              request at{" "}
              <code>
                http://&lt;probe-host&gt;:&lt;port&gt;/heartbeat/
                {props.secretKey.toString()}
              </code>{" "}
              and forward it to OneUptime — your internal services do not need
              outbound internet access.
            </span>
          </span>
        }
      />
    </>
  );
};

export default IncomingMonitorLink;
