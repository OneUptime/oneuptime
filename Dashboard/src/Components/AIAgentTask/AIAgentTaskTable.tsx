import React, { FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import FieldType from "Common/UI/Components/Types/FieldType";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, Blue } from "Common/Types/BrandColors";
import Query from "Common/Types/BaseDatabase/Query";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import AIAgentTaskTypeElement from "./AIAgentTaskTypeElement";
import AIAgentElement from "Common/UI/Components/AIAgent/AIAgent";

export interface AIAgentTaskTableProps {
  id: string;
  name: string;
  title: string;
  description: string;
  query?: Query<AIAgentTask>;
  showStatusFilter?: boolean;
  dateField: "createdAt" | "startedAt" | "completedAt";
  dateFieldTitle: string;
  getStatusElement?: (item: AIAgentTask) => ReactElement;
  noItemsMessage?: string | ReactElement;
}

type GetStatusElementFunction = (item: AIAgentTask) => ReactElement;

export const getDefaultStatusElement: GetStatusElementFunction = (
  item: AIAgentTask,
): ReactElement => {
  if (item.status === AIAgentTaskStatus.Scheduled) {
    return <Pill text="Scheduled" color={Blue} />;
  }
  if (item.status === AIAgentTaskStatus.InProgress) {
    return <Pill text="In Progress" color={Yellow} />;
  }
  if (item.status === AIAgentTaskStatus.Completed) {
    return <Pill text="Completed" color={Green} />;
  }
  if (item.status === AIAgentTaskStatus.Error) {
    return <Pill text="Error" color={Red} />;
  }
  return <Pill text={item.status || "Unknown"} color={Blue} />;
};

type GetTaskTypeElementFunction = (item: AIAgentTask) => ReactElement;

export const getTaskTypeElement: GetTaskTypeElementFunction = (
  item: AIAgentTask,
): ReactElement => {
  return <AIAgentTaskTypeElement taskType={item.taskType as AIAgentTaskType} />;
};

const AIAgentTaskTable: FunctionComponent<AIAgentTaskTableProps> = (
  props: AIAgentTaskTableProps,
): ReactElement => {
  const filters: Array<Filter<AIAgentTask>> = [
    {
      field: {
        taskNumber: true,
      },
      title: "Task Number",
      type: FieldType.Number,
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      type: FieldType.Text,
    },
    {
      field: {
        taskType: true,
      },
      title: "Task Type",
      type: FieldType.Text,
    },
    ...(props.showStatusFilter
      ? [
          {
            field: {
              status: true,
            },
            title: "Status",
            type: FieldType.Text,
          },
        ]
      : []),
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
  ];

  const getStatusElement: GetStatusElementFunction =
    props.getStatusElement || getDefaultStatusElement;

  const defaultNoItemsMessage: ReactElement = (
    <div className="w-full">
      <p>
        No AI Agent Tasks found. Tasks are automatically created when AI Agents
        work on incidents, code issues, or alerts. Configure an AI Agent in
        Settings to get started.
      </p>
    </div>
  );

  return (
    <ModelTable<AIAgentTask>
      modelType={AIAgentTask}
      id={props.id}
      userPreferencesKey={props.id}
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      name={props.name}
      isViewable={true}
      {...(props.query ? { query: props.query } : {})}
      showAs={ShowAs.List}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      showViewIdButton={true}
      noItemsMessage={props.noItemsMessage || defaultNoItemsMessage}
      filters={filters}
      showRefreshButton={true}
      columns={[
        {
          field: {
            taskNumber: true,
          },
          title: "Task Number",
          type: FieldType.Element,
          getElement: (item: AIAgentTask): ReactElement => {
            if (!item.taskNumber) {
              return <>-</>;
            }

            return <>#{item.taskNumber}</>;
          },
        },
        {
          field: {
            name: true,
          },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: {
            taskType: true,
          },
          title: "Task Type",
          type: FieldType.Element,
          getElement: getTaskTypeElement,
        },
        {
          field: {
            status: true,
          },
          title: "Status",
          type: FieldType.Element,
          getElement: getStatusElement,
        },
        {
          field: {
            aiAgent: {
              name: true,
              iconFileId: true,
            },
          },
          title: "AI Agent",
          type: FieldType.Entity,
          getElement: (item: AIAgentTask): ReactElement => {
            if (!item.aiAgent) {
              return <span className="text-gray-400">Not Assigned</span>;
            }
            return <AIAgentElement aiAgent={item.aiAgent} />;
          },
        },
        {
          field: {
            [props.dateField]: true,
          },
          title: props.dateFieldTitle,
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

export default AIAgentTaskTable;
