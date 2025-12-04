import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
}

const PingMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let responseTimeInMs: number =
    props.probeMonitorResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  // Check if there are error details to show
  const hasErrorDetails: boolean = Boolean(
    props.probeMonitorResponse.requestFailedDetails,
  );

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="Hostname or IP address"
          value={
            (props.probeMonitorResponse.monitorDestination?.toString() || "") +
              (props.probeMonitorResponse.monitorDestinationPort?.toString()
                ? `:${props.probeMonitorResponse.monitorDestinationPort.toString()}`
                : "") || "-"
          }
        />
      </div>
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100 "
          title="Status"
          value={props.probeMonitorResponse.isOnline ? "Online" : "Offline"}
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
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {props.probeMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {/* Error Details Section */}
      {hasErrorDetails && (
        <div className="space-y-3">
          <div className="flex space-x-3">
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Failed At"
              value={
                props.probeMonitorResponse.requestFailedDetails?.failedPhase ||
                "-"
              }
            />
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Error Code"
              value={
                props.probeMonitorResponse.requestFailedDetails?.errorCode ||
                "-"
              }
            />
          </div>
          <div className="flex space-x-3">
            <InfoCard
              className="w-full shadow-none border-2 border-gray-100 "
              title="Error Details"
              value={
                props.probeMonitorResponse.requestFailedDetails
                  ?.errorDescription || "-"
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PingMonitorView;
