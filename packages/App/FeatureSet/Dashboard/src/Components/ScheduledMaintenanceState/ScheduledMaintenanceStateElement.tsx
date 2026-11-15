import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

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
      isUserContent={isRecordNameAsWritten(
        StateListType.ScheduledMaintenanceState,
        props.scheduledMaintenanceState.name,
      )}
    />
  );
};

export default ScheduledMaintenanceStateElement;
