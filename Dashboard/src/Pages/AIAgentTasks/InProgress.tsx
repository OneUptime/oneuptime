import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskTable from "./AIAgentTaskTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Yellow } from "Common/Types/BrandColors";

const InProgressTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AIAgentTaskTable
      id="in-progress-tasks-table"
      name="In Progress Tasks"
      title="In Progress Tasks"
      description="Tasks that are currently being processed by an AI agent."
      query={{
        status: AIAgentTaskStatus.InProgress,
      }}
      dateField="startedAt"
      dateFieldTitle="Started At"
      getStatusElement={(): ReactElement => {
        return <Pill text="In Progress" color={Yellow} />;
      }}
    />
  );
};

export default InProgressTasksPage;
