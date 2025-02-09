import OneUptimeDate from "Common/Types/Date";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";

export interface ComponentProps {
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
}

const WebsiteMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Monitored At"
          value={
            props.telemetryMonitorSummary?.lastCheckedAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.telemetryMonitorSummary?.lastCheckedAt,
                )
              : "-"
          }
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100 "
          title="Next Check At"
          value={
            props.telemetryMonitorSummary?.nextCheckAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.telemetryMonitorSummary?.nextCheckAt,
                )
              : "-"
          }
        />
      </div>
    </div>
  );
};

export default WebsiteMonitorSummaryView;
