import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbePicker from "./ProbePicker";
import SummaryInfo from "./SummaryInfo";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Card from "Common/UI/Components/Card/Card";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";

export interface ComponentProps {
  probeMonitorResponses?: Array<MonitorStepProbeResponse> | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
  probes?: Array<Probe>;
  monitorType: MonitorType;
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
}

const Summary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedProbe, setSelectedProbe] = React.useState<Probe | undefined>(
    undefined,
  );

  useEffect(() => {
    // slect first probe if exists

    if (props.probes && props.probes.length > 0) {
      setSelectedProbe(props.probes[0]);
    }
  }, [props.probes]);

  if (props.monitorType === MonitorType.Manual) {
    return <></>;
  }

  const probeResponses: Array<ProbeMonitorResponse> = [];

  for (const probeResponse of props.probeMonitorResponses || []) {
    for (const monitorStepId in probeResponse) {
      const probeMonitorResponse: ProbeMonitorResponse = probeResponse[
        monitorStepId
      ] as ProbeMonitorResponse;
      if (
        probeMonitorResponse.probeId?.toString() ===
        selectedProbe?.id?.toString()
      ) {
        probeResponses.push(probeMonitorResponse);
      }
    }
  }

  return (
    <Card
      title="Monitor Summary"
      description="Here is how your monitor is performing at this moment."
      rightElement={
        MonitorTypeHelper.isProbableMonitor(props.monitorType) &&
        props.probes &&
        props.probes.length > 0 &&
        selectedProbe ? (
          <ProbePicker
            probes={props.probes}
            selectedProbe={selectedProbe}
            onProbeSelected={(probe: Probe) => {
              setSelectedProbe(probe);
            }}
          />
        ) : (
          <></>
        )
      }
    >
      <div>
        <SummaryInfo
          monitorType={props.monitorType}
          probeMonitorResponses={probeResponses}
          incomingMonitorRequest={props.incomingMonitorRequest}
          serverMonitorResponse={props.serverMonitorResponse}
          telemetryMonitorSummary={props.telemetryMonitorSummary}
        />
      </div>
    </Card>
  );
};

export default Summary;
