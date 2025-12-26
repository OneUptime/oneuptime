import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskTable from "../../Components/AIAgentTask/AIAgentTaskTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Yellow } from "Common/Types/BrandColors";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import IconProp from "Common/Types/Icon/IconProp";

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
      noItemsMessage={
        <EmptyState
          id="no-in-progress-tasks"
          icon={IconProp.Play}
          title="No Tasks In Progress"
          description="There are no tasks currently being processed. When an AI Agent picks up a scheduled task, it will appear here."
        />
      }
    />
  );
};

export default InProgressTasksPage;
