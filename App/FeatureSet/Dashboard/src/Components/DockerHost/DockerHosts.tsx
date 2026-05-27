import DockerHostElement from "./DockerHost";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  dockerHosts: Array<DockerHost>;
  onNavigateComplete?: (() => void) | undefined;
}

const DockerHostsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.dockerHosts}
      moreText="more Docker hosts"
      getEachElement={(dockerHost: DockerHost) => {
        return (
          <DockerHostElement
            dockerHost={dockerHost}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No Docker hosts."
    />
  );
};

export default DockerHostsElement;
