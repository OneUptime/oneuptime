import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
}

const WebsiteMonitorSummaryView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SummaryView dataTestId="telemetry-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          title={
            props.telemetryMonitorSummary?.lastCheckedLabel || "Monitored At"
          }
          value={
            props.telemetryMonitorSummary?.lastCheckedAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.telemetryMonitorSummary?.lastCheckedAt,
                )
              : "-"
          }
        />
        <SummaryFact
          title="Next Check At"
          value={
            props.telemetryMonitorSummary?.nextCheckAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.telemetryMonitorSummary?.nextCheckAt,
                )
              : "-"
          }
        />
      </SummaryFacts>
    </SummaryView>
  );
};

export default WebsiteMonitorSummaryView;
