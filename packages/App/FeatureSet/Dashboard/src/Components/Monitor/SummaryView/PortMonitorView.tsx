import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import HostAddressUtil from "Common/Utils/HostAddressUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import NetworkPathView from "./NetworkPathView";
import PortTimingsView from "./PortTimingsView";
import ProbeAttemptsView from "./ProbeAttemptsView";
import SummaryErrorFacts from "./SummaryErrorFacts";
import { SummaryFact, SummaryFacts, SummaryView } from "./SummaryFacts";

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
  const translator: Translator = useTranslator();
  const response: ProbeMonitorResponse = props.probeMonitorResponse;
  const destination: string = response.monitorDestination?.toString() || "";
  const destinationPort: string =
    response.monitorDestinationPort?.toString() || "";
  const probeAttempts: Array<ProbeAttempt> = response.probeAttempts || [];
  const totalAttempts: number = response.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="port-monitor-summary">
      <SummaryFacts>
        <SummaryFact
          isWide={true}
          title="Hostname or IP address"
          value={
            HostAddressUtil.formatHostAndPort({
              host: destination,
              port: destinationPort,
            }) || "-"
          }
        />
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            response.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Total Connection Time (DNS + TCP)"
          value={formatDurationInMs(response.responseTimeInMs)}
        />
        <SummaryFact
          title="Monitored At"
          value={
            response.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  response.monitoredAt,
                )
              : "-"
          }
        />
      </SummaryFacts>

      <SummaryErrorFacts probeMonitorResponse={response} />

      {response.portTimings && (
        <PortTimingsView portTimings={response.portTimings} />
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
    </SummaryView>
  );
};

export default PortMonitorView;
