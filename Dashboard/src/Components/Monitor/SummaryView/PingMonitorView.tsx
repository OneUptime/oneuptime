import OneUptimeDate from "Common/Types/Date";
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import InfoCard from "CommonUI/src/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitor: ProbeMonitor;
}

const PingMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let responseTimeInMs: number =
    props.probeMonitor?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="Hostname or IP address"
          value={
            (props.probeMonitor.monitorDestination?.toString() || "") +
              (props.probeMonitor.monitorDestinationPort?.toString()
                ? `:${props.probeMonitor.monitorDestinationPort.toString()}`
                : "") || "-"
          }
        />
      </div>
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Status"
          value={props.probeMonitor.isOnline ? "Online" : "Offline"}
        />

        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Monitored At"
          value={
            props.probeMonitor?.monitoredAt
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  props.probeMonitor.monitoredAt,
                )
              : "-"
          }
        />
      </div>
    </div>
  );
};

export default PingMonitorView;
