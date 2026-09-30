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

/*
 * The URL is the card's body, not its description: Card hides the
 * description below md, so on a phone the Documentation tab showed this
 * card's title and nothing else.
 */
const IncomingMonitorLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const heartbeatUrl: URL = getHeartbeatUrl(props.secretKey);

  return (
    <Card
      title={`Incoming Request URL / Heartbeat URL`}
      description="Please send inbound heartbeat GET or POST requests to this URL."
    >
      <div data-testid="incoming-request-setup">
        <p className="text-xs font-medium text-gray-500">Heartbeat URL</p>
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <Link
            openInNewTab={true}
            to={heartbeatUrl}
            className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
          >
            <span data-testid="incoming-request-url">
              {heartbeatUrl.toString()}
            </span>
          </Link>
          <CopyTextButton
            textToBeCopied={heartbeatUrl.toString()}
            size="sm"
            variant="soft"
            title="Copy heartbeat URL"
          />
        </div>
      </div>
    </Card>
  );
};

export default IncomingMonitorLink;
