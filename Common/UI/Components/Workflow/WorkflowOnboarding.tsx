import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, useEffect, useState } from "react";

const STORAGE_KEY: string = "oneuptime_workflow_onboarding_dismissed";

export interface ComponentProps {
  isWorkflowEmpty: boolean;
}

const WorkflowOnboarding: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const [isDismissed, setIsDismissed] = useState<boolean>(true);

  useEffect(() => {
    const dismissed: string | null = localStorage.getItem(STORAGE_KEY);
    setIsDismissed(dismissed === "true");
  }, []);

  const handleDismiss = (): void => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsDismissed(true);
  };

  if (isDismissed || !props.isWorkflowEmpty) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
            <Icon icon={IconProp.Bolt} className="w-5 h-5 text-indigo-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Welcome to the Workflow Builder
          </h2>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          Build automated workflows by connecting components together. Here is how
          to get started:
        </p>

        <div className="space-y-4 mb-6">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-medium text-amber-700">
              1
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">
                Add a Trigger
              </p>
              <p className="text-xs text-gray-500">
                Click the trigger placeholder or drag a trigger from the sidebar
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700">
              2
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">
                Drag Components
              </p>
              <p className="text-xs text-gray-500">
                Drag components from the left sidebar onto the canvas
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center text-xs font-medium text-green-700">
              3
            </div>
            <div>
              <p className="text-sm font-medium text-gray-800">
                Connect & Configure
              </p>
              <p className="text-xs text-gray-500">
                Connect components by dragging between ports and click to configure
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            title="Got it!"
            buttonStyle={ButtonStyleType.PRIMARY}
            onClick={handleDismiss}
          />
        </div>
      </div>
    </div>
  );
};

export default WorkflowOnboarding;
