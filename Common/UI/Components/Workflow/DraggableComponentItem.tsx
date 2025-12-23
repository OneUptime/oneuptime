import Icon from "../Icon/Icon";
import ComponentMetadata from "../../../Types/Workflow/Component";
import React, { FunctionComponent, useState } from "react";

export interface ComponentProps {
  component: ComponentMetadata;
}

const DraggableComponentItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>): void => {
    event.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify({
        componentId: props.component.id,
        componentType: props.component.componentType,
      }),
    );
    event.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = (): void => {
    setIsDragging(false);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseOver={() => {
        setIsHovering(true);
      }}
      onMouseOut={() => {
        setIsHovering(false);
      }}
      className={`
        flex items-center gap-3 p-3 rounded-md cursor-grab
        border border-gray-200 bg-white
        transition-all duration-150 ease-in-out
        ${isHovering ? "border-indigo-400 shadow-md" : ""}
        ${isDragging ? "opacity-50 cursor-grabbing" : ""}
      `}
      style={{
        marginBottom: "0.5rem",
      }}
    >
      {props.component.iconProp && (
        <div
          className={`
            flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center
            ${isHovering ? "bg-indigo-100" : "bg-gray-100"}
          `}
        >
          <Icon
            icon={props.component.iconProp}
            className={`w-4 h-4 ${isHovering ? "text-indigo-600" : "text-gray-500"}`}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium truncate ${isHovering ? "text-gray-900" : "text-gray-700"}`}
        >
          {props.component.title}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {props.component.description}
        </p>
      </div>
    </div>
  );
};

export default DraggableComponentItem;
