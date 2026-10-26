import HostElement from "./Host";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_HOSTS_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import Host from "Common/Models/DatabaseModels/Host";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  hosts: Array<Host>;
  onNavigateComplete?: (() => void) | undefined;
}

const HostsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.hosts}
      moreTemplate={MORE_HOSTS_TEMPLATE}
      getEachElement={(host: Host) => {
        return (
          <HostElement
            host={host}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No hosts."
    />
  );
};

export default HostsElement;
