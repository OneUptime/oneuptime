import RunbookAgentElement from "./RunbookAgent";
import TableColumnListComponent from "Common/UI/Components/TableColumnList/TableColumnListComponent";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  runbookAgents: Array<RunbookAgent>;
  onNavigateComplete?: (() => void) | undefined;
}

const RunbookAgentsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <TableColumnListComponent
      items={props.runbookAgents}
      moreText="more agents"
      getEachElement={(runbookAgent: RunbookAgent) => {
        return (
          <RunbookAgentElement
            runbookAgent={runbookAgent}
            onNavigateComplete={props.onNavigateComplete}
          />
        );
      }}
      noItemsMessage="No runbook agents."
    />
  );
};

export default RunbookAgentsElement;
