import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import AICodeFixReadiness from "../../Components/AIAgentTask/AICodeFixReadiness";
import AIFixOutcomeStats from "../../Components/AIAgentTask/AIFixOutcomeStats";
import CodeFixRunsTable from "../../Components/AIAgentTask/CodeFixRunsTable";

const AIAgentTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <AIPlanGate />

      <AICodeFixReadiness />

      <div className="mb-5">
        <AIFixOutcomeStats />
      </div>

      <CodeFixRunsTable />
    </Fragment>
  );
};

export default AIAgentTasksPage;
