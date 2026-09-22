import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import React, { FunctionComponent, ReactElement } from "react";
import Link from "Common/UI/Components/Link/Link";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";

export interface ComponentProps {
  secretKey: ObjectID;
}

/*
 * The URL an incoming-request monitor listens on. Shared with the monitor
 * overview's setup and connection cards, so every place that shows it shows
 * the same address.
 */
export function getHeartbeatUrl(secretKey: ObjectID): URL {
  return new URL(HTTP_PROTOCOL, HOST)
    .addRoute("/heartbeat")
    .addRoute(`/${secretKey.toString()}`);
}

const IncomingMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const heartbeatUrl: URL = getHeartbeatUrl(props.secretKey);

  return (
    <>
      <Card
        title={`Incoming Request URL / Heartbeat URL`}
        description={
          <span>
            Please send inbound heartbeat GET or POST requests to this URL{" "}
            <Link openInNewTab={true} to={heartbeatUrl}>
              <span>{heartbeatUrl.toString()}</span>
            </Link>
            .{" "}
            <CopyTextButton
              textToBeCopied={heartbeatUrl.toString()}
              size="sm"
              variant="soft"
              title="Copy heartbeat URL"
            />
          </span>
        }
      />
    </>
  );
};

export default IncomingMonitorLink;
