import TelemetryServiceElement from "./TelemetryServiceElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  telemetryServices: Array<Service>;
  onNavigateComplete?: (() => void) | undefined;
}

const TelemetryServicesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.telemetryServices}
      moreText="more services"
      getEachElement={(telemetryService: Service) => {
        return (
          <TelemetryServiceElement
            telemetryService={telemetryService}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No services."
    />
  );
};

export default TelemetryServicesElement;
