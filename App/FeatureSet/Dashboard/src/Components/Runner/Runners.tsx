import RunnerElement from "./Runner";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
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
      moreText="more agents"
      getEachElement={(runner: Runner) => {
        return (
          <RunnerElement
            runner={runner}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No runbook agents."
    />
  );
};

export default RunnersElement;
