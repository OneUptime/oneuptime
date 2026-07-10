import OneUptimeDate from "Common/Types/Date";
import PingMonitorResponse from "Common/Types/Monitor/PingMonitor/PingMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkPathView from "./NetworkPathView";
import ProbeAttemptsView from "./ProbeAttemptsView";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
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

  const pingResponse: PingMonitorResponse | undefined =
    props.probeMonitorResponse.pingResponse;

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

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
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Status"
          value={props.probeMonitorResponse.isOnline ? "Online" : "Offline"}
        />

        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100 "
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

      {pingResponse && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Packet Loss"
            value={`${pingResponse.packetLossPercent}% (${pingResponse.packetsReceived}/${pingResponse.packetsSent} received)`}
          />
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Jitter"
            value={
              pingResponse.jitterInMs !== undefined
                ? pingResponse.jitterInMs + " ms"
                : "-"
            }
          />
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Min RTT"
            value={
              pingResponse.minRoundTripTimeInMs !== undefined
                ? pingResponse.minRoundTripTimeInMs + " ms"
                : "-"
            }
          />
          <InfoCard
            className="w-1/4 shadow-none border-2 border-gray-100 "
            title="Max RTT"
            value={
              pingResponse.maxRoundTripTimeInMs !== undefined
                ? pingResponse.maxRoundTripTimeInMs + " ms"
                : "-"
            }
          />
        </div>
      )}

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

      {props.probeMonitorResponse.networkPathTrace && (
        <NetworkPathView
          networkPathTrace={props.probeMonitorResponse.networkPathTrace}
        />
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

export default PingMonitorView;
