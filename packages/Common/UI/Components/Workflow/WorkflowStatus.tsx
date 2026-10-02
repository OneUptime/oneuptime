import Pill from "../Pill/Pill";
import Color from "../../../Types/Color";
import { Blue, Red, Yellow } from "../../../Types/BrandColors";
import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "../../../Types/Workflow/WorkflowStatus";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: WorkflowStatus;
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
  return (
    <Pill
      color={WORKFLOW_STATUS_COLORS[props.status] || Yellow}
      text={getWorkflowStatusLabel(props.status)}
    />
  );
};

export default WorkflowStatusElement;
