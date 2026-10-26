import RunnerElement from "./Runner";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import { MORE_RUNNERS_TEMPLATE } from "../TableColumnList/MoreItemsTemplates";
import Runner from "Common/Models/DatabaseModels/Runner";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  runners: Array<Runner>;
  onNavigateComplete?: (() => void) | undefined;
}

const RunnersElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.runners}
      moreTemplate={MORE_RUNNERS_TEMPLATE}
      getEachElement={(runner: Runner) => {
        return (
          <RunnerElement
            runner={runner}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No Runners."
    />
  );
};

export default RunnersElement;
