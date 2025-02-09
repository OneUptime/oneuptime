import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import React, { FunctionComponent, ReactElement } from "react";
import { Black } from "Common/Types/BrandColors";
import Pill from "Common/UI/Components/Pill/Pill";

export interface ComponentProps {
  incidentSeverity: IncidentSeverity;
}

const IncidentSeverityElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Pill
      color={props.incidentSeverity.color || Black}
      text={props.incidentSeverity.name || "Unknown"}
    />
  );
};

export default IncidentSeverityElement;
