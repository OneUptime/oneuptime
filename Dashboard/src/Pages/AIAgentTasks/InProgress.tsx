import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import FieldType from "Common/UI/Components/Types/FieldType";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import Pill from "Common/UI/Components/Pill/Pill";
import { Yellow } from "Common/Types/BrandColors";

const InProgressTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<AIAgentTask>
      modelType={AIAgentTask}
      id="in-progress-tasks-table"
      userPreferencesKey="in-progress-tasks-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      name="In Progress Tasks"
      isViewable={true}
      query={{
        status: AIAgentTaskStatus.InProgress,
      }}
      cardProps={{
        title: "In Progress Tasks",
        description: "Tasks that are currently being processed by an AI agent.",
      }}
      showViewIdButton={true}
      filters={[
        {
          field: {
            taskType: true,
          },
          title: "Task Type",
          type: FieldType.Text,
        },
        {
          field: {
            aiAgent: {
              name: true,
            },
          },
          title: "AI Agent",
          type: FieldType.Entity,
          filterEntityType: AIAgent,
          filterQuery: {},
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
      ]}
      columns={[
        {
          field: {
            _id: true,
          },
          title: "Task ID",
          type: FieldType.Text,
        },
        {
          field: {
            taskType: true,
          },
          title: "Task Type",
          type: FieldType.Text,
        },
        {
          field: {
            status: true,
          },
          title: "Status",
          type: FieldType.Element,
          getElement: (_item: AIAgentTask): ReactElement => {
            return <Pill text="In Progress" color={Yellow} />;
          },
        },
        {
          field: {
            aiAgent: {
              name: true,
            },
          },
          title: "AI Agent",
          type: FieldType.Entity,
          getElement: (item: AIAgentTask): ReactElement => {
            return <>{item.aiAgent?.name || "Not Assigned"}</>;
          },
        },
        {
          field: {
            startedAt: true,
          },
          title: "Started At",
          type: FieldType.DateTime,
        },
      ]}
      onViewPage={(item: AIAgentTask): Promise<Route> => {
        return Promise.resolve(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
            {
              modelId: item._id,
            },
          ),
        );
      }}
    />
  );
};

export default InProgressTasksPage;
