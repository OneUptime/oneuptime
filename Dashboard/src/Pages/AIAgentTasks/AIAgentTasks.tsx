import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, Blue } from "Common/Types/BrandColors";

const AIAgentTasksPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<AIAgentTask>
      modelType={AIAgentTask}
      id="ai-agent-tasks-table"
      userPreferencesKey="ai-agent-tasks-table"
      isDeleteable={true}
      isEditable={false}
      isCreateable={true}
      name="AI Agent Tasks"
      isViewable={true}
      cardProps={{
        title: "AI Agent Tasks",
        description:
          "View and manage tasks assigned to AI agents for automated incident management.",
      }}
      showViewIdButton={true}
      formFields={[
        {
          field: {
            taskType: true,
          },
          title: "Task Type",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: "Select Task Type",
          dropdownOptions:
            DropdownUtil.getDropdownOptionsFromEnum(AIAgentTaskType),
        },
        {
          field: {
            aiAgent: true,
          },
          title: "AI Agent",
          fieldType: FormFieldSchemaType.Dropdown,
          required: false,
          placeholder: "Select AI Agent (Optional)",
          dropdownModal: {
            type: AIAgent,
            labelField: "name",
            valueField: "_id",
          },
        },
      ]}
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
            status: true,
          },
          title: "Status",
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
          getElement: (item: AIAgentTask): ReactElement => {
            if (item.status === AIAgentTaskStatus.Scheduled) {
              return <Pill text="Scheduled" color={Blue} />;
            }
            if (item.status === AIAgentTaskStatus.InProgress) {
              return <Pill text="In Progress" color={Yellow} />;
            }
            if (item.status === AIAgentTaskStatus.Success) {
              return <Pill text="Success" color={Green} />;
            }
            if (item.status === AIAgentTaskStatus.Error) {
              return <Pill text="Error" color={Red} />;
            }
            return <Pill text={item.status || "Unknown"} color={Blue} />;
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
            createdAt: true,
          },
          title: "Created At",
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

export default AIAgentTasksPage;
