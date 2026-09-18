import HostElement from "./Host";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
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
      moreText="more hosts"
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
