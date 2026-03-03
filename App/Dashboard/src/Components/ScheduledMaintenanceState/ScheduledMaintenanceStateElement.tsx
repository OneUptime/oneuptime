import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

export interface ComponentProps {
  scheduledMaintenanceState: ScheduledMaintenanceState;
}

const ScheduledMaintenanceStateElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      isMinimal={true}
      color={props.scheduledMaintenanceState.color || Black}
      text={props.scheduledMaintenanceState.name || "Unknown"}
    />
  );
};

export default ScheduledMaintenanceStateElement;
