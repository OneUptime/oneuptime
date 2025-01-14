import React, { FunctionComponent, ReactElement } from "react";
import ProgressButtonItem, { ProgressItemProps } from "./ProgressButtonItem";

export interface ComponentProps {
  id: string;
  progressButtonItems: Array<ProgressItemProps>;
  currentStepId: string;
  onStepClick?: (stepId: string) => void;
}

const ProgressButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  type IsStepCompletedFunction = (stepId: string) => boolean;

  const isStepCompleted: IsStepCompletedFunction = (stepId: string): boolean => {
    return (
      props.progressButtonItems.findIndex(
        (progressButtonItem: ProgressItemProps) => {
          return progressButtonItem.id === stepId;
        },
      ) <
      props.progressButtonItems.findIndex(
        (progressButtonItem: ProgressItemProps) => {
          return progressButtonItem.id === props.currentStepId;
        },
      )
    );
  };

  return (
    <nav aria-label="Progress" id={props.id}>
      <ol
        role="list"
        className="divide-y divide-gray-300 rounded-md border border-gray-300 md:flex md:divide-y-0"
      >
        {props.progressButtonItems.map(
          (progressButtonItem: ProgressItemProps, index: number) => {
            return (
              <ProgressButtonItem
                key={progressButtonItem.id}
                {...progressButtonItem}
                stepCount={index + 1}
                isLastStep={
                  progressButtonItem.id ===
                  props.progressButtonItems[
                    props.progressButtonItems.length - 1
                  ]!.id
                }
                isCurrentStep={progressButtonItem.id === props.currentStepId}
                isCompletedStep={isStepCompleted(progressButtonItem.id)}
                onClick={() => {
                  return props.onStepClick
                    ? props.onStepClick(progressButtonItem.id)
                    : undefined;
                }}
              />
            );
          },
        )}
      </ol>
    </nav>
  );
};

export default ProgressButtons;
