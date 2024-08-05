import ServerMonitor from "Common/Types/Monitor/ServerMonitor/ServerMonitor";
import ProbePicker from "./ProbePicker";
import SummaryInfo from "./SummaryInfo";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import Card from "CommonUI/src/Components/Card/Card";
import { MonitorStepProbeResponse } from "Model/Models/MonitorProbe";
import Probe from "Model/Models/Probe";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  probeMonitors?: Array<MonitorStepProbeResponse> | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  serverMonitor?: ServerMonitor | undefined;
  probes?: Array<Probe>;
  monitorType: MonitorType;
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

  const probeResponses: Array<ProbeMonitor> = [];

  for (const probeResponse of props.probeMonitors || []) {
    for (const monitorStepId in probeResponse) {
      const probeMonitor: ProbeMonitor = probeResponse[
        monitorStepId
      ] as ProbeMonitor;
      if (
        probeMonitor.probeId?.toString() ===
        selectedProbe?.id?.toString()
      ) {
        probeResponses.push(probeMonitor);
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
          probeMonitors={probeResponses}
          incomingMonitorRequest={props.incomingMonitorRequest}
          serverMonitor={props.serverMonitor}
        />
      </div>
    </Card>
  );
};

export default Summary;
