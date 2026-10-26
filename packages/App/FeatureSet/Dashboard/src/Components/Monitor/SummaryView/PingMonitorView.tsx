import OneUptimeDate from "Common/Types/Date";
import PingMonitorResponse from "Common/Types/Monitor/PingMonitor/PingMonitorResponse";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkPathView from "./NetworkPathView";
import ProbeAttemptsView from "./ProbeAttemptsView";
import SummaryErrorFacts from "./SummaryErrorFacts";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const PingMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  let responseTimeInMs: number =
    props.probeMonitorResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const pingResponse: PingMonitorResponse | undefined =
    props.probeMonitorResponse.pingResponse;

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="ping-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          isWide={true}
          title="Hostname or IP address"
          value={
            HostAddressUtil.formatHostAndPort({
              host:
                props.probeMonitorResponse.monitorDestination?.toString() || "",
              port: props.probeMonitorResponse.monitorDestinationPort?.toString(),
            }) || "-"
          }
        />
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            props.probeMonitorResponse.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Response Time (in ms)"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <SummaryFact
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </SummaryFacts>

      <SummaryErrorFacts probeMonitorResponse={props.probeMonitorResponse} />

      {pingResponse && (
        <SummaryFacts dataTestId="ping-monitor-packet-facts">
          <SummaryFact
            title="Packet Loss"
            value={`${pingResponse.packetLossPercent}% (${pingResponse.packetsReceived}/${pingResponse.packetsSent} received)`}
          />
          <SummaryFact
            title="Jitter"
            value={
              pingResponse.jitterInMs !== undefined
                ? pingResponse.jitterInMs + " ms"
                : "-"
            }
          />
          <SummaryFact
            title="Min RTT"
            value={
              pingResponse.minRoundTripTimeInMs !== undefined
                ? pingResponse.minRoundTripTimeInMs + " ms"
                : "-"
            }
          />
          <SummaryFact
            title="Max RTT"
            value={
              pingResponse.maxRoundTripTimeInMs !== undefined
                ? pingResponse.maxRoundTripTimeInMs + " ms"
                : "-"
            }
          />
        </SummaryFacts>
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
    </SummaryView>
  );
};

export default PingMonitorView;
