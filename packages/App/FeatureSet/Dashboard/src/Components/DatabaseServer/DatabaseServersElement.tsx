import DatabaseServerElement from "./DatabaseServerElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  databaseServers: Array<DatabaseServer>;
  onNavigateComplete?: (() => void) | undefined;
}

const DatabaseServersElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.databaseServers}
      moreText="more databases"
      getEachElement={(databaseServer: DatabaseServer) => {
        return (
          <DatabaseServerElement
            databaseServer={databaseServer}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No databases."
    />
  );
};

export default DatabaseServersElement;
