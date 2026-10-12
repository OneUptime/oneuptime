import Pill from "../Pill/Pill";
import { WorkflowTestRunPill } from "./WorkflowTestRun";
import Color from "../../../Types/Color";
import { Blue, Red, Yellow } from "../../../Types/BrandColors";
import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "../../../Types/Workflow/WorkflowStatus";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: WorkflowStatus;
  /*
   * A person ran the workflow from its Builder while it was off: the run
   * lists mark it beside its status, so it is not read as one its trigger
   * started (WorkflowTestRun).
   */
  isTestRun?: boolean | undefined;
  // Who started that test run, for the mark's tooltip.
  testRunStartedBy?: string | null | undefined;
}

/*
 * Blue for a run that worked, yellow while it is still on its way, red when it
 * ended badly. The words come from getWorkflowStatusLabel, which a downloaded
 * run uses too.
 */
const WORKFLOW_STATUS_COLORS: Record<WorkflowStatus, Color> = {
  [WorkflowStatus.Success]: Blue,
  [WorkflowStatus.Running]: Yellow,
  [WorkflowStatus.Scheduled]: Yellow,
  [WorkflowStatus.Waiting]: Yellow,
  [WorkflowStatus.Error]: Red,
  [WorkflowStatus.Timeout]: Red,
  [WorkflowStatus.WorkflowCountExceeded]: Red,
};

const WorkflowStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const status: ReactElement = (
    <Pill
      color={WORKFLOW_STATUS_COLORS[props.status] || Yellow}
      text={getWorkflowStatusLabel(props.status)}
    />
  );

  if (!props.isTestRun) {
    return status;
  }

  // On a narrow row the mark wraps under the status rather than squeezing it.
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      {status}
      <WorkflowTestRunPill startedBy={props.testRunStartedBy} />
    </span>
  );
};

export default WorkflowStatusElement;
