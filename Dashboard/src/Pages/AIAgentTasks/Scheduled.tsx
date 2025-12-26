import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskTable from "../../Components/AIAgentTask/AIAgentTaskTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { Blue } from "Common/Types/BrandColors";

const ScheduledTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AIAgentTaskTable
      id="scheduled-tasks-table"
      name="Scheduled Tasks"
      title="Scheduled Tasks"
      description="Tasks that are scheduled and waiting to be picked up by an AI agent."
      query={{
        status: AIAgentTaskStatus.Scheduled,
      }}
      dateField="createdAt"
      dateFieldTitle="Created At"
      getStatusElement={(): ReactElement => {
        return <Pill text="Scheduled" color={Blue} />;
      }}
      noItemsMessage="No scheduled tasks. New tasks will appear here when incidents, alerts, or code issues trigger AI Agent work."
    />
  );
};

export default ScheduledTasksPage;
