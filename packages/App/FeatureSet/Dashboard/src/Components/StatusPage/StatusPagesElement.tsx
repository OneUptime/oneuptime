import StatusPageElement from "./StatusPageElement";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_STATUS_PAGES_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  statusPages: Array<StatusPage>;
  onNavigateComplete?: (() => void) | undefined;
  // What a record on no status page says; "No Status Page." when left out.
  noItemsMessage?: string | undefined;
}

const StatusPagesElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.statusPages}
      moreTemplate={MORE_STATUS_PAGES_TEMPLATE}
      getEachElement={(statusPage: StatusPage) => {
        return (
          <StatusPageElement
            statusPage={statusPage}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage={props.noItemsMessage || "No Status Page."}
    />
  );
};

export default StatusPagesElement;
