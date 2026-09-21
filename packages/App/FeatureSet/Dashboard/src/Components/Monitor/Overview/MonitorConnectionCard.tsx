import PageMap from "../../../Utils/PageMap";
import RelativeTime from "../../EpisodeView/RelativeTime";
import SloOverviewActionLink from "../../Slo/SloOverviewActionLink";
import { getIncomingEmailAddress } from "../IncomingEmailMonitor/IncomingEmailMonitorLink";
import { getHeartbeatUrl } from "../IncomingRequestMonitor/IncomingMonitorLink";
import { getMonitorPageRoute } from "./MonitorOverviewLinks";
import { getSetupSecretKey } from "./MonitorSetupCard";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import { MonitorOverviewSetupKind } from "Common/Utils/Monitor/MonitorOverviewFamily";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorId: ObjectID;
  kind: MonitorOverviewSetupKind;
  monitor: Monitor;
}

const CARD_TITLE: Record<MonitorOverviewSetupKind, string> = {
  [MonitorOverviewSetupKind.HeartbeatUrl]: "Heartbeat URL",
  [MonitorOverviewSetupKind.InboundEmail]: "Inbound email address",
  [MonitorOverviewSetupKind.ServerAgent]: "Server agent",
};

const HIDDEN_SECRET_TEXT: string =
  "Only people who can edit monitors can see this, because it contains the monitor's secret key.";

/*
 * Where a push-based monitor gets its data from, once data is arriving: the
 * heartbeat URL, the inbound address or the reporting host, and when the
 * last one came in. The setup card replaces this while nothing has arrived.
 */
const MonitorConnectionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitor: Monitor = props.monitor;

  type GetValueRowFunction = (value: string) => ReactElement;

  const getValueRow: GetValueRowFunction = (value: string): ReactElement => {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <span
          data-testid="monitor-connection-value"
          className="min-w-0 flex-1 break-all font-mono text-sm text-gray-900"
        >
          {value}
        </span>
        <CopyTextButton textToBeCopied={value} size="sm" variant="soft" />
      </div>
    );
  };

  type GetValueFunction = () => ReactElement;

  const getValue: GetValueFunction = (): ReactElement => {
    if (props.kind === MonitorOverviewSetupKind.ServerAgent) {
      /*
       * The agent's report is stored as it was sent, unvalidated, so a
       * custom agent can send a hostname that is not a string. Calling
       * .trim() on that threw during render and took the overview down.
       */
      const rawHostname: unknown = monitor.serverMonitorResponse?.hostname;
      const hostname: string =
        typeof rawHostname === "string" ? rawHostname.trim() : "";

      return (
        <p className="text-sm text-gray-700">
          {"Host "}
          {hostname ? (
            <span
              data-testid="monitor-connection-value"
              className="break-all font-mono text-gray-900"
            >
              {hostname}
            </span>
          ) : (
            <span className="text-gray-500">not reported yet</span>
          )}
        </p>
      );
    }

    const secretKey: ObjectID | undefined = getSetupSecretKey({
      kind: props.kind,
      monitor: monitor,
    });

    if (!secretKey) {
      return <p className="text-sm text-gray-500">{HIDDEN_SECRET_TEXT}</p>;
    }

    if (props.kind === MonitorOverviewSetupKind.InboundEmail) {
      const address: string | null = getIncomingEmailAddress(secretKey);

      if (!address) {
        return (
          <p className="text-sm text-gray-500">
            Inbound email is not configured on this server, so this monitor has
            no address yet.
          </p>
        );
      }

      return getValueRow(address);
    }

    return getValueRow(getHeartbeatUrl(secretKey).toString());
  };

  type GetMetaFunction = () => ReactElement;

  const getMeta: GetMetaFunction = (): ReactElement => {
    let label: string = "Last report";
    let at: Date | undefined = undefined;
    let suffix: string = "";

    if (props.kind === MonitorOverviewSetupKind.HeartbeatUrl) {
      label = "Last request";
      at = MonitorCheckScheduleUtil.parseDate(
        monitor.incomingMonitorRequest?.incomingRequestReceivedAt,
      );
      suffix = monitor.incomingMonitorRequest?.requestMethod
        ? ` · ${monitor.incomingMonitorRequest.requestMethod}`
        : "";
    } else if (props.kind === MonitorOverviewSetupKind.InboundEmail) {
      label = "Last email";
      at = MonitorCheckScheduleUtil.parseDate(
        monitor.incomingEmailMonitorLastEmailReceivedAt,
      );
    } else {
      at = MonitorCheckScheduleUtil.parseDate(
        monitor.serverMonitorRequestReceivedAt,
      );
    }

    return (
      <p
        data-testid="monitor-connection-meta"
        className="mt-2 text-xs text-gray-500"
      >
        {at ? (
          <>
            {`${label} `}
            <RelativeTime date={at} />
            {suffix}
          </>
        ) : (
          <>{`${label}: none yet`}</>
        )}
      </p>
    );
  };

  return (
    <Card
      title={CARD_TITLE[props.kind]}
      description="Where this monitor gets its data."
      headerLayout="stacked"
    >
      <div>
        {getValue()}
        {getMeta()}
        <div className="mt-3">
          <SloOverviewActionLink
            variant="text"
            title="Setup instructions"
            to={getMonitorPageRoute({
              pageMap: PageMap.MONITOR_VIEW_DOCUMENTATION,
              monitorId: props.monitorId,
            })}
          />
        </div>
      </div>
    </Card>
  );
};

export default MonitorConnectionCard;
