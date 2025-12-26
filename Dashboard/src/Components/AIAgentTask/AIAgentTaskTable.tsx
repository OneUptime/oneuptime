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
import { Green, Red, Yellow, Blue } from "Common/Types/BrandColors";
import Query from "Common/Types/BaseDatabase/Query";
import Filter from "Common/UI/Components/ModelFilter/Filter";

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

const AIAgentTaskTable: FunctionComponent<AIAgentTaskTableProps> = (
  props: AIAgentTaskTableProps,
): ReactElement => {
  const filters: Array<Filter<AIAgentTask>> = [
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
      query={props.query}
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      showViewIdButton={true}
      filters={filters}
      columns={[
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
          type: FieldType.Text,
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
