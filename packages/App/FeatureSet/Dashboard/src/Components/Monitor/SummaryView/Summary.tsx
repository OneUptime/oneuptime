import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ProbePicker from "./ProbePicker";
import SummaryInfo from "./SummaryInfo";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "Common/Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Card from "Common/UI/Components/Card/Card";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSummaryProbeUtil, {
  AttachedProbe,
  MonitorSummaryProbeState,
} from "Common/Utils/Monitor/MonitorSummaryProbeUtil";

export interface ComponentProps {
  probeMonitorResponses?: Array<MonitorStepProbeResponse> | undefined;
  incomingMonitorRequest?: IncomingMonitorRequest | undefined;
  incomingRequestMonitorHeartbeatCheckedAt?: Date | undefined;
  incomingEmailMonitorRequest?: IncomingEmailMonitorRequest | undefined;
  incomingEmailMonitorHeartbeatCheckedAt?: Date | undefined;
  serverMonitorResponse?: ServerMonitorResponse | undefined;
  /*
   * The probes attached to this monitor - NOT every probe in the project.
   * Offering unattached probes here told users to wait a few minutes for a
   * summary that could never arrive.
   */
  probes?: Array<Probe>;
  // Of those, the ones that are attached but switched off for this monitor.
  disabledProbeIds?: Array<string> | undefined;
  monitorType: MonitorType;
  monitorSteps?: MonitorSteps | undefined;
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}

const Summary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedProbe, setSelectedProbe] = React.useState<Probe | undefined>(
    undefined,
  );

  const disabledProbeIdSet: Set<string> = new Set(props.disabledProbeIds || []);

  const attachedProbes: Array<AttachedProbe> = (props.probes || []).map(
    (probe: Probe): AttachedProbe => {
      const id: string = probe._id?.toString() || "";

      return {
        id: id,
        name: probe.name?.toString() || "Unknown",
        isEnabled: !disabledProbeIdSet.has(id),
      };
    },
  );

  useEffect(() => {
    setSelectedProbe((currentlySelected: Probe | undefined) => {
      /*
       * Keep whatever the user picked as long as it is still attached. This
       * effect re-runs every time the probe list is handed down again, and
       * unconditionally resetting to the first entry is indistinguishable
       * from a selection that refuses to stick.
       */
      const selectedProbeId: string | null =
        MonitorSummaryProbeUtil.resolveSelectedProbeId({
          probes: attachedProbes,
          currentlySelectedProbeId: currentlySelected?._id?.toString(),
        });

      if (!selectedProbeId) {
        return undefined;
      }

      return (props.probes || []).find((probe: Probe) => {
        return probe._id?.toString() === selectedProbeId;
      });
    });
  }, [props.probes, props.disabledProbeIds]);

  if (props.monitorType === MonitorType.Manual) {
    return <></>;
  }

  const validMonitorStepIds: Set<string> | null = (() => {
    const stepsArray: Array<MonitorStep> | undefined =
      props.monitorSteps?.data?.monitorStepsInstanceArray;

    if (!stepsArray) {
      return null;
    }

    const ids: Set<string> = new Set();
    for (const step of stepsArray) {
      const id: string | undefined = step.data?.id;
      if (id) {
        ids.add(id.toString());
      }
    }
    return ids;
  })();

  const probeResponses: Array<ProbeMonitorResponse> = [];

  for (const probeResponse of props.probeMonitorResponses || []) {
    for (const monitorStepId in probeResponse) {
      if (validMonitorStepIds && !validMonitorStepIds.has(monitorStepId)) {
        continue;
      }

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

  const isProbableMonitor: boolean = MonitorTypeHelper.isProbableMonitor(
    props.monitorType,
  );

  const probeSummaryState: MonitorSummaryProbeState =
    MonitorSummaryProbeUtil.getProbeState({
      isProbeableMonitor: isProbableMonitor,
      attachedProbeCount: attachedProbes.length,
      isSelectedProbeEnabled: !disabledProbeIdSet.has(
        selectedProbe?._id?.toString() || "",
      ),
      probeResponseCount: probeResponses.length,
    });

  return (
    <Card
      title="Monitor Summary"
      description="Here is how your monitor is performing at this moment."
      rightElement={
        isProbableMonitor && attachedProbes.length > 0 && selectedProbe ? (
          <ProbePicker
            probes={props.probes!}
            disabledProbeIds={props.disabledProbeIds}
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
          probeName={selectedProbe?.name?.toString()}
          probeSummaryState={probeSummaryState}
          incomingMonitorRequest={props.incomingMonitorRequest}
          serverMonitorResponse={props.serverMonitorResponse}
          telemetryMonitorSummary={props.telemetryMonitorSummary}
          incomingRequestMonitorHeartbeatCheckedAt={
            props.incomingRequestMonitorHeartbeatCheckedAt
          }
          incomingEmailMonitorRequest={props.incomingEmailMonitorRequest}
          incomingEmailMonitorHeartbeatCheckedAt={
            props.incomingEmailMonitorHeartbeatCheckedAt
          }
          evaluationSummary={props.evaluationSummary}
        />
      </div>
    </Card>
  );
};

export default Summary;
