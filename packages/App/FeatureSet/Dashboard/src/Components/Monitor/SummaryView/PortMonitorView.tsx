import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkPathView from "./NetworkPathView";
import PortTimingsView from "./PortTimingsView";
import ProbeAttemptsView from "./ProbeAttemptsView";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const formatDurationInMs: (durationInMs: number | undefined) => string = (
  durationInMs: number | undefined,
): string => {
  if (durationInMs === undefined) {
    return "-";
  }

  return `${Math.round(durationInMs * 100) / 100} ms`;
};

const PortMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const response: ProbeMonitorResponse = props.probeMonitorResponse;
  const destination: string = response.monitorDestination?.toString() || "";
  const destinationPort: string =
    response.monitorDestinationPort?.toString() || "";
  const probeAttempts: Array<ProbeAttempt> = response.probeAttempts || [];
  const totalAttempts: number = response.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;
  const hasErrorDetails: boolean = Boolean(response.requestFailedDetails);

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-full shadow-none border-2 border-gray-100 "
          title="Hostname or IP address"
          value={
            `${destination}${destinationPort ? `:${destinationPort}` : ""}` ||
            "-"
          }
        />
      </div>
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Status"
          value={response.isOnline ? "Online" : "Offline"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Total Connection Time (DNS + TCP)"
          value={formatDurationInMs(response.responseTimeInMs)}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Monitored At"
          value={
            response.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  response.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {response.portTimings && (
        <PortTimingsView portTimings={response.portTimings} />
      )}

      {response.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100 "
            title="Error"
            value={response.failureCause.toString() || "-"}
          />
        </div>
      )}

      {hasErrorDetails && (
        <div className="space-y-3">
          <div className="flex space-x-3">
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Failed At"
              value={response.requestFailedDetails?.failedPhase || "-"}
            />
            <InfoCard
              className="w-1/2 shadow-none border-2 border-gray-100 "
              title="Error Code"
              value={response.requestFailedDetails?.errorCode || "-"}
            />
          </div>
          <div className="flex space-x-3">
            <InfoCard
              className="w-full shadow-none border-2 border-gray-100 "
              title="Error Details"
              value={response.requestFailedDetails?.errorDescription || "-"}
            />
          </div>
        </div>
      )}

      {response.networkPathTrace && (
        <NetworkPathView networkPathTrace={response.networkPathTrace} />
      )}

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </div>
  );
};

export default PortMonitorView;
