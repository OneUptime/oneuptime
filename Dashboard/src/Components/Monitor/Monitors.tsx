import MonitorElement from "./Monitor";
import TableColumnListComponent from "CommonUI/src/Components/TableColumnList/TableColumnListComponent";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitors: Array<Monitor>;
  onNavigateComplete?: (() => void) | undefined;
}

const MonitorsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.monitors}
      moreText="more monitors"
      getEachElement={(monitor: Monitor) => {
        return (
          <MonitorElement
            monitor={monitor}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No monitors."
    />
  );
};

export default MonitorsElement;
