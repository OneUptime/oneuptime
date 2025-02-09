import TelemetryServiceElement from "./TelemetryServiceElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  telemetryServices: Array<TelemetryService>;
  onNavigateComplete?: (() => void) | undefined;
}

const TelemetryServicesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.telemetryServices}
      moreText="more services"
      getEachElement={(telemetryService: TelemetryService) => {
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
