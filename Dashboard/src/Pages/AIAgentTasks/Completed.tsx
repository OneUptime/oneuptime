import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskTable from "./AIAgentTaskTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green } from "Common/Types/BrandColors";

const CompletedTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AIAgentTaskTable
      id="completed-tasks-table"
      name="Completed Tasks"
      title="Completed Tasks"
      description="Tasks that have been completed successfully by an AI agent."
      query={{
        status: AIAgentTaskStatus.Completed,
      }}
      dateField="completedAt"
      dateFieldTitle="Completed At"
      getStatusElement={(): ReactElement => {
        return <Pill text="Completed" color={Green} />;
      }}
    />
  );
};

export default CompletedTasksPage;
