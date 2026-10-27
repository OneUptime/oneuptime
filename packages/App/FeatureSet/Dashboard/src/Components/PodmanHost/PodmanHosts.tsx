import PodmanHostElement from "./PodmanHost";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_PODMAN_HOSTS_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  podmanHosts: Array<PodmanHost>;
  onNavigateComplete?: (() => void) | undefined;
}

const PodmanHostsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.podmanHosts}
      moreTemplate={MORE_PODMAN_HOSTS_TEMPLATE}
      getEachElement={(podmanHost: PodmanHost) => {
        return (
          <PodmanHostElement
            podmanHost={podmanHost}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No Podman hosts."
    />
  );
};

export default PodmanHostsElement;
