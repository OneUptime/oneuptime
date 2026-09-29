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
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { MonitorStepProbeResponse } from "Common/Models/DatabaseModels/MonitorProbe";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryMonitorSummary from "./Types/TelemetryMonitorSummary";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSummaryProbeUtil, {
  AttachedProbe,
  MonitorSummaryProbeState,
} from "Common/Utils/Monitor/MonitorSummaryProbeUtil";
import MonitorTestAvailabilityUtil from "Common/Utils/Monitor/MonitorTestAvailabilityUtil";
import MonitorTestForm from "../../Form/Monitor/MonitorTest";
import { ButtonSize } from "Common/UI/Components/Button/Button";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";

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
  /*
   * The monitor this card is describing. Only needed to run a test from here:
   * it is what lets the server resolve {{monitorSecrets.*}} for the test run,
   * so a test without it silently probes a literal placeholder. Optional so
   * that a caller which does not want the action does not have to supply it.
   */
  monitorId?: ObjectID | undefined;
  telemetryMonitorSummary?: TelemetryMonitorSummary | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  /*
   * The newest criteria verdict per probe id, for the probe-run types. When
   * given, the card shows the verdict of the probe that is picked rather
   * than the newest verdict from any probe: those can disagree, and another
   * probe's "failed" under a probe that passed makes the picker look broken.
   */
  evaluationSummariesByProbeId?:
    | Dictionary<MonitorEvaluationSummary>
    | undefined;
  // Replaces the card's description.
  description?: string | undefined;
  /*
   * Set when the probe rows could not be read. The card then says so,
   * instead of claiming that no probe is attached.
   */
  probeLoadError?: string | undefined;
}

const DEFAULT_DESCRIPTION: string =
  "Here is how your monitor is performing at this moment.";

const Summary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Only the user's pick is state. Which probe is shown is worked out on
   * every render from that pick and the current list; it used to be set in
   * an effect after the first paint, so the card flashed "no result yet"
   * even when the probe had results.
   */
  const [pickedProbeId, setPickedProbeId] = React.useState<string | undefined>(
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

  /*
   * Keep whatever the user picked as long as it is still attached. The probe
   * list is handed down again on every refresh, and resetting to the first
   * entry each time is indistinguishable from a selection that refuses to
   * stick.
   */
  const selectedProbeId: string | null =
    MonitorSummaryProbeUtil.resolveSelectedProbeId({
      probes: attachedProbes,
      currentlySelectedProbeId: pickedProbeId,
    });

  const selectedProbe: Probe | undefined = selectedProbeId
    ? (props.probes || []).find((probe: Probe) => {
        return probe._id?.toString() === selectedProbeId;
      })
    : undefined;

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

  // Probe results that could not be read are not "no probes attached".
  const hasProbeLoadError: boolean = Boolean(
    isProbableMonitor && props.probeLoadError,
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

  /*
   * "Test Monitor" used to live only under Monitors > View Monitor > Criteria,
   * which meant leaving the page you were reading to run the thing you were
   * reading about (issue #3867). It belongs on the summary because this card is
   * already the answer to "is it working right now" - a test is the same
   * question asked on demand.
   *
   * The action is offered from the probes this card is already showing, NOT
   * from every probe in the project: those are the probes that actually watch
   * this resource, and the overview page deliberately does not fetch the wider
   * list (see the probe read in Components/Monitor/Overview/useMonitorOverviewData.ts).
   */
  const canTestMonitor: boolean = MonitorTestAvailabilityUtil.isAvailable({
    monitorType: props.monitorType,
    monitorSteps: props.monitorSteps,
    attachedProbeCount: attachedProbes.length,
  });

  /*
   * For the probe-run types, the verdict shown is the picked probe's own.
   * When that probe has none but another one does, the card says where the
   * newest verdict came from rather than leaving the reader to wonder why
   * the criteria section is missing.
   */
  const evaluationSummariesByProbeId:
    | Dictionary<MonitorEvaluationSummary>
    | undefined = isProbableMonitor
    ? props.evaluationSummariesByProbeId
    : undefined;

  const selectedEvaluationSummary: MonitorEvaluationSummary | undefined =
    evaluationSummariesByProbeId
      ? selectedProbeId
        ? evaluationSummariesByProbeId[selectedProbeId]
        : undefined
      : props.evaluationSummary;

  type GetOtherEvaluationProbeNameFunction = () => string | undefined;

  const getOtherEvaluationProbeName: GetOtherEvaluationProbeNameFunction = ():
    | string
    | undefined => {
    if (!evaluationSummariesByProbeId || selectedEvaluationSummary) {
      return undefined;
    }

    const probesWithEvaluation: Array<AttachedProbe> = attachedProbes.filter(
      (probe: AttachedProbe) => {
        return (
          probe.id !== selectedProbeId &&
          Boolean(evaluationSummariesByProbeId[probe.id])
        );
      },
    );

    // Prefer the probe the newest verdict came from, then any other.
    const latestProbe: AttachedProbe | undefined =
      probesWithEvaluation.find((probe: AttachedProbe) => {
        return (
          Boolean(props.evaluationSummary) &&
          evaluationSummariesByProbeId[probe.id] === props.evaluationSummary
        );
      }) || probesWithEvaluation[0];

    return latestProbe?.name;
  };

  const otherEvaluationProbeName: string | undefined =
    getOtherEvaluationProbeName();

  type GetBodyFunction = () => ReactElement;

  const getBody: GetBodyFunction = (): ReactElement => {
    if (hasProbeLoadError) {
      return (
        <ErrorMessage
          message={"Probe results are unavailable. " + props.probeLoadError}
        />
      );
    }

    /*
     * An agent that has never reported leaves nothing to summarise. Said
     * here rather than in SummaryInfo, which also renders stored snapshots
     * on incident and alert pages.
     */
    if (
      props.monitorType === MonitorType.Server &&
      !props.serverMonitorResponse
    ) {
      return (
        <ErrorMessage message="No report from the server agent yet. Install the agent to start sending data; setup instructions are under Documentation." />
      );
    }

    /*
     * The per-type views lay their numbers out as quarter-width cards in one
     * row, which is wider than a phone. They scroll inside this card, as the
     * uptime strip does, rather than making the whole page scroll sideways.
     */
    return (
      <div data-testid="monitor-summary-body" className="overflow-x-auto">
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
          evaluationSummary={selectedEvaluationSummary}
        />
        {otherEvaluationProbeName ? (
          <p
            data-testid="monitor-summary-other-evaluation"
            className="mt-4 text-sm text-gray-500"
          >
            {`The latest criteria evaluation came from ${otherEvaluationProbeName}. Pick it above to see why it passed or failed.`}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <Card
      title="Monitor Summary"
      description={props.description || DEFAULT_DESCRIPTION}
      /*
       * The card sits in the overview's two-thirds column. Side by side, the
       * probe picker and Test Monitor left the title and description a
       * column one or two words wide, so the actions get their own row.
       */
      headerLayout="stacked"
      buttons={
        /*
         * `props.monitorSteps` is re-tested only to narrow the type - the
         * availability rule above has already established that it is there and
         * has at least one step.
         */
        canTestMonitor && props.monitorSteps && !hasProbeLoadError
          ? [
              <MonitorTestForm
                key="monitor-test"
                monitorId={props.monitorId}
                monitorSteps={props.monitorSteps}
                monitorType={props.monitorType}
                probes={props.probes || []}
                buttonSize={ButtonSize.Normal}
                /*
                 * Card already spaces the header's actions, so the default
                 * wrapper's negative margin would pull this into the picker.
                 */
                className=""
              />,
            ]
          : undefined
      }
      rightElement={
        isProbableMonitor &&
        attachedProbes.length > 0 &&
        selectedProbe &&
        !hasProbeLoadError ? (
          <ProbePicker
            probes={props.probes!}
            disabledProbeIds={props.disabledProbeIds}
            selectedProbe={selectedProbe}
            onProbeSelected={(probe: Probe) => {
              setPickedProbeId(probe._id?.toString());
            }}
          />
        ) : undefined
      }
    >
      {getBody()}
    </Card>
  );
};

export default Summary;
