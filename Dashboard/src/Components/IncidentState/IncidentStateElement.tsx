import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

export interface ComponentProps {
  incidentState: IncidentState;
}

const IncidentStateElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      isMinimal={true}
      color={props.incidentState.color || Black}
      text={props.incidentState.name || "Unknown"}
    />
  );
};

export default IncidentStateElement;
