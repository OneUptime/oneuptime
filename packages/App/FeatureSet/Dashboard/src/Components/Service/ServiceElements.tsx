import ServiceElement from "./ServiceElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_SERVICES_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import Service from "Common/Models/DatabaseModels/Service";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  services: Array<Service>;
  onNavigateComplete?: (() => void) | undefined;
}

const ServicesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.services}
      moreTemplate={MORE_SERVICES_TEMPLATE}
      getEachElement={(service: Service) => {
        return (
          <ServiceElement
            service={service}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No services."
    />
  );
};

export default ServicesElement;
