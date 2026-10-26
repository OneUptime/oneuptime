import DatabaseServerElement from "./DatabaseServerElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_DATABASES_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
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
      moreTemplate={MORE_DATABASES_TEMPLATE}
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
