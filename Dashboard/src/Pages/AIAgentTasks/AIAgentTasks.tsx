import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskTable from "./AIAgentTaskTable";

const AIAgentTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AIAgentTaskTable
      id="ai-agent-tasks-table"
      name="AI Agent Tasks"
      title="AI Agent Tasks"
      description="View and manage tasks assigned to AI agents for automated incident management."
      showStatusFilter={true}
      dateField="createdAt"
      dateFieldTitle="Created At"
    />
  );
};

export default AIAgentTasksPage;
