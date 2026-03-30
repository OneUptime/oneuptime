import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  description: string;
  icon: IconProp;
  onClick: () => void;
}

const DashboardTemplateCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="cursor-pointer border border-gray-200 rounded-lg p-4 hover:border-indigo-500 hover:shadow-md transition-all duration-200 bg-white"
      onClick={props.onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          props.onClick();
        }
      }}
    >
      <div className="flex items-center mb-2">
        <div className="flex-shrink-0 mr-3 text-indigo-500">
          <Icon icon={props.icon} size={SizeProp.Large} />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{props.title}</h3>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        {props.description}
      </p>
    </div>
  );
};

export default DashboardTemplateCard;
