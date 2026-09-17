import PodmanHostElement from "./PodmanHost";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
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
      moreText="more Podman hosts"
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
