import IncidentSeverityElement from "./IncidentSeverityElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incidentSeverities: Array<IncidentSeverity>;
}

const IncidentSeveritiesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.incidentSeverities}
      moreText="more Incident Severities"
      getEachElement={(incidentSeverity: IncidentSeverity) => {
        return <IncidentSeverityElement incidentSeverity={incidentSeverity} />;
      }}
      noItemsMessage="No Incident Severities."
    />
  );
};

export default IncidentSeveritiesElement;
