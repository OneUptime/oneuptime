import Pill from "../Pill/Pill";
import { Blue, Red, Yellow } from "Common/Types/BrandColors";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  status: WorkflowStatus;
}

const WorkflowStatusElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.status === WorkflowStatus.Success) {
    return <Pill color={Blue} text="Executed" />;
  }
  if (props.status === WorkflowStatus.Running) {
    return <Pill color={Yellow} text="Running" />;
  }
  if (props.status === WorkflowStatus.Scheduled) {
    return <Pill color={Yellow} text="Scheduled" />;
  }
  if (props.status === WorkflowStatus.Error) {
    return <Pill color={Red} text="Error" />;
  }

  if (props.status === WorkflowStatus.Timeout) {
    return <Pill color={Red} text="Timeout" />;
  }

  if (props.status === WorkflowStatus.Waiting) {
    return <Pill color={Yellow} text="Waiting" />;
  }

  if (props.status === WorkflowStatus.WorkflowCountExceeded) {
    return <Pill color={Red} text="Execution Exceeded Current Plan" />;
  }

  return <Pill color={Yellow} text="Unknown" />;
};

export default WorkflowStatusElement;
