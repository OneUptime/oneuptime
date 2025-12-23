import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent } from "react";

export interface ComponentProps {
  hasTrigger: boolean;
}

const WorkflowEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
      <div className="text-center max-w-md px-8">
        {/* Animated background circles */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-32 h-32 rounded-full bg-indigo-50 animate-pulse" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-24 h-24 rounded-full bg-indigo-100"
              style={{ animationDelay: "150ms" }}
            />
          </div>
          <div className="relative flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg">
              <Icon
                icon={props.hasTrigger ? IconProp.Cube : IconProp.Bolt}
                className="w-8 h-8 text-white"
              />
            </div>
          </div>
        </div>

        {/* Title and description */}
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {props.hasTrigger
            ? "Add your first component"
            : "Start with a trigger"}
        </h3>
        <p className="text-sm text-gray-500 mb-6">
          {props.hasTrigger
            ? "Drag components from the sidebar onto the canvas to build your workflow automation."
            : "Click the trigger placeholder above or drag a trigger from the sidebar to start building your workflow."}
        </p>

        {/* Visual hints */}
        <div className="flex items-center justify-center gap-6 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center">
              <Icon icon={IconProp.CursorArrowRays} className="w-3 h-3 text-gray-400" />
            </div>
            <span>Click to configure</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center">
              <Icon icon={IconProp.Drag} className="w-3 h-3 text-gray-400" />
            </div>
            <span>Drag to connect</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowEmptyState;
