import PageMap from "../../../Utils/PageMap";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import SloOverviewEmptyState from "../../Slo/SloOverviewEmptyState";
import IncomingEmailMonitorLink from "../IncomingEmailMonitor/IncomingEmailMonitorLink";
import { getHeartbeatUrl } from "../IncomingRequestMonitor/IncomingMonitorLink";
import ServerMonitorDocumentation from "../ServerMonitor/Documentation";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import { MonitorOverviewSetupKind } from "Common/Utils/Monitor/MonitorOverviewFamily";
import React, { FunctionComponent, ReactElement } from "react";
import {
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitorId: ObjectID;
  kind: MonitorOverviewSetupKind;
  // Carries the secret key when the viewer may read it.
  monitor: Monitor;
}

const WAITING_TITLE: Record<MonitorOverviewSetupKind, string> = {
  [MonitorOverviewSetupKind.HeartbeatUrl]: "Waiting for the first heartbeat",
  [MonitorOverviewSetupKind.InboundEmail]: "Waiting for the first email",
  [MonitorOverviewSetupKind.ServerAgent]: "Waiting for the agent to report",
};

// Why the setup is hidden, one whole sentence per kind of setup.
const HIDDEN_SETUP_DESCRIPTION: Record<MonitorOverviewSetupKind, string> = {
  [MonitorOverviewSetupKind.HeartbeatUrl]: translationKey(
    "The heartbeat URL contains this monitor's secret key, so only people who can edit monitors can see it. Ask one of them to set it up.",
  ),
  [MonitorOverviewSetupKind.InboundEmail]: translationKey(
    "The email address contains this monitor's secret key, so only people who can edit monitors can see it. Ask one of them to set it up.",
  ),
  [MonitorOverviewSetupKind.ServerAgent]: translationKey(
    "The install command contains this monitor's secret key, so only people who can edit monitors can see it. Ask one of them to set it up.",
  ),
};

export const getSetupSecretKey: (data: {
  kind: MonitorOverviewSetupKind;
  monitor: Monitor;
}) => ObjectID | undefined = (data: {
  kind: MonitorOverviewSetupKind;
  monitor: Monitor;
}): ObjectID | undefined => {
  switch (data.kind) {
    case MonitorOverviewSetupKind.HeartbeatUrl:
      return data.monitor.incomingRequestSecretKey || undefined;
    case MonitorOverviewSetupKind.InboundEmail:
      return data.monitor.incomingEmailSecretKey || undefined;
    default:
      return data.monitor.serverMonitorSecretKey || undefined;
  }
};

/*
 * What a push-based monitor needs before it can report anything: where to
 * send it. Shown in place of the uptime history while the monitor waits for
 * its first heartbeat, email or agent report.
 *
 * The URL, address and install command all contain the monitor's secret
 * key, which only people who can edit monitors may read. Everyone else is
 * told the details are hidden, and the key is never put in the page.
 */
const MonitorSetupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const secretKey: ObjectID | undefined = getSetupSecretKey({
    kind: props.kind,
    monitor: props.monitor,
  });

  if (!secretKey) {
    return (
      <Card title={WAITING_TITLE[props.kind]}>
        <SloOverviewEmptyState
          dataTestId="monitor-setup-hidden"
          icon={IconProp.Lock}
          tone="neutral"
          title="Setup details are hidden"
          description={HIDDEN_SETUP_DESCRIPTION[props.kind]}
        />
      </Card>
    );
  }

  if (props.kind === MonitorOverviewSetupKind.InboundEmail) {
    return (
      <IncomingEmailMonitorLink
        secretKey={secretKey}
        customLocalPart={props.monitor.incomingEmailCustomLocalPart}
      />
    );
  }

  if (props.kind === MonitorOverviewSetupKind.ServerAgent) {
    return <ServerMonitorDocumentation secretKey={secretKey} />;
  }

  const url: string = getHeartbeatUrl(secretKey).toString();

  return (
    <Card
      title="Send the first heartbeat"
      description="This monitor tracks requests to its heartbeat URL."
    >
      <div data-testid="monitor-setup-heartbeat" className="space-y-4">
        <div>
          <p className="text-xs font-medium text-gray-500">{translator.translateText("Heartbeat URL")}</p>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span
              data-testid="monitor-setup-heartbeat-url"
              className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
            >
              {url}
            </span>
            <CopyTextButton textToBeCopied={url} size="sm" variant="soft" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500">{translator.translateText("Example")}</p>
          <div className="mt-1">
            <CodeBlock
              language="bash"
              code={`curl -X POST "${url}"`}
              showCopyButton={true}
            />
          </div>
        </div>
        <p className="text-sm text-gray-500">
          {translator.translateText("GET and POST both work. Headers and body are available to your criteria.")}</p>
        <SloOverviewActionLink
          variant="text"
          title="Full setup instructions"
          to={getMonitorPageRoute({
            pageMap: PageMap.MONITOR_VIEW_DOCUMENTATION,
            monitorId: props.monitorId,
          })}
        />
      </div>
    </Card>
  );
};

export default MonitorSetupCard;
