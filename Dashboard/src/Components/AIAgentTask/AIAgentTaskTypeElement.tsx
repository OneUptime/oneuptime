import React, { FunctionComponent, ReactElement } from "react";
import AIAgentTaskType, {
  AIAgentTaskTypeHelper,
} from "Common/Types/AI/AIAgentTaskType";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";

export interface ComponentProps {
  taskType: AIAgentTaskType | undefined;
}

type GetIconForTaskTypeFunction = (taskType: AIAgentTaskType) => IconProp;

const getIconForTaskType: GetIconForTaskTypeFunction = (
  taskType: AIAgentTaskType,
): IconProp => {
  switch (taskType) {
    case AIAgentTaskType.FixException:
      return IconProp.Wrench;
    default:
      return IconProp.Bolt;
  }
};

type GetIconColorClassFunction = (taskType: AIAgentTaskType) => string;

const getIconColorClass: GetIconColorClassFunction = (
  taskType: AIAgentTaskType,
): string => {
  switch (taskType) {
    case AIAgentTaskType.FixException:
      return "text-orange-600";
    default:
      return "text-blue-600";
  }
};

type GetBackgroundColorClassFunction = (taskType: AIAgentTaskType) => string;

const getBackgroundColorClass: GetBackgroundColorClassFunction = (
  taskType: AIAgentTaskType,
): string => {
  switch (taskType) {
    case AIAgentTaskType.FixException:
      return "bg-orange-100";
    default:
      return "bg-blue-100";
  }
};

const AIAgentTaskTypeElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.taskType) {
    return <span className="text-gray-400">-</span>;
  }

  const title: string = AIAgentTaskTypeHelper.getTitle(props.taskType);
  const description: string = AIAgentTaskTypeHelper.getDescription(
    props.taskType,
  );
  const icon: IconProp = getIconForTaskType(props.taskType);
  const iconColorClass: string = getIconColorClass(props.taskType);
  const bgColorClass: string = getBackgroundColorClass(props.taskType);

  return (
    <Tooltip text={description}>
      <div className="flex items-center space-x-2">
        <div
          className={`flex items-center justify-center rounded-lg ${bgColorClass} h-8 w-8 min-h-8 min-w-8 p-1.5`}
        >
          <Icon icon={icon} className={`${iconColorClass} h-5 w-5`} />
        </div>
        <span className="font-medium text-gray-700">{title}</span>
      </div>
    </Tooltip>
  );
};

export default AIAgentTaskTypeElement;
