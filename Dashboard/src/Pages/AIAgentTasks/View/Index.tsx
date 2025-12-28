import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import ObjectID from "Common/Types/ObjectID";
import AIAgentTask from "Common/Models/DatabaseModels/AIAgentTask";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { useParams } from "react-router-dom";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import AIAgentTaskType from "Common/Types/AI/AIAgentTaskType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red, Yellow, Blue } from "Common/Types/BrandColors";
import AIAgentTaskTypeElement from "../../../Components/AIAgentTask/AIAgentTaskTypeElement";
import AIAgentElement from "Common/UI/Components/AIAgent/AIAgent";

const AIAgentTaskViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <CardModelDetail<AIAgentTask>
      name="AI Agent Task Details"
      cardProps={{
        title: "Task Details",
        description: "View details about this AI agent task.",
      }}
      isEditable={false}
      modelDetailProps={{
        modelType: AIAgentTask,
        id: "model-detail-ai-agent-task",
        fields: [
          {
            field: {
              _id: true,
            },
            title: "Task ID",
            fieldType: FieldType.ObjectID,
          },
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FieldType.LongText,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FieldType.LongText,
          },
          {
            field: {
              taskType: true,
            },
            title: "Task Type",
            fieldType: FieldType.Element,
            getElement: (item: AIAgentTask): ReactElement => {
              return (
                <AIAgentTaskTypeElement
                  taskType={item.taskType as AIAgentTaskType}
                />
              );
            },
          },
          {
            field: {
              status: true,
            },
            title: "Status",
            fieldType: FieldType.Element,
            getElement: (item: AIAgentTask): ReactElement => {
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
            },
          },
          {
            field: {
              statusMessage: true,
            },
            title: "Status Message",
            fieldType: FieldType.LongText,
            showIf: (item: AIAgentTask): boolean => {
              return Boolean(item.statusMessage);
            },
          },
          {
            field: {
              aiAgent: {
                name: true,
                iconFileId: true,
              },
            },
            title: "AI Agent",
            fieldType: FieldType.Element,
            getElement: (item: AIAgentTask): ReactElement => {
              if (!item.aiAgent) {
                return <span className="text-gray-400">Not Assigned</span>;
              }
              return <AIAgentElement aiAgent={item.aiAgent} />;
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            fieldType: FieldType.DateTime,
          },
          {
            field: {
              startedAt: true,
            },
            title: "Started At",
            fieldType: FieldType.DateTime,
          },
          {
            field: {
              completedAt: true,
            },
            title: "Completed At",
            fieldType: FieldType.DateTime,
          },
        ],
        modelId: modelId,
      }}
    />
  );
};

export default AIAgentTaskViewPage;
