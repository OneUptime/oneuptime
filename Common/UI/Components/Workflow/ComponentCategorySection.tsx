import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import ComponentMetadata, {
  ComponentCategory,
} from "../../../Types/Workflow/Component";
import DraggableComponentItem from "./DraggableComponentItem";
import React, { FunctionComponent, useState } from "react";

export interface ComponentProps {
  category: ComponentCategory;
  components: Array<ComponentMetadata>;
  defaultExpanded?: boolean;
}

const ComponentCategorySection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(
    props.defaultExpanded ?? true,
  );

  const componentCount: number = props.components.length;

  if (componentCount === 0) {
    return <></>;
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="w-full flex items-center justify-between p-2 rounded-md hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon
            icon={props.category.icon}
            className="w-4 h-4 text-gray-500"
          />
          <span className="text-sm font-medium text-gray-700">
            {props.category.name}
          </span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {componentCount}
          </span>
        </div>
        <Icon
          icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="w-4 h-4 text-gray-400"
        />
      </button>

      {isExpanded && (
        <div className="mt-2 ml-2">
          {props.components.map(
            (component: ComponentMetadata, index: number) => {
              return (
                <DraggableComponentItem key={index} component={component} />
              );
            },
          )}
        </div>
      )}
    </div>
  );
};

export default ComponentCategorySection;
