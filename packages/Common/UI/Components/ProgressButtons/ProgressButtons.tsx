import React, { FunctionComponent, ReactElement } from "react";
import ProgressButtonItem, { ProgressItemProps } from "./ProgressButtonItem";

export interface ComponentProps {
  id: string;
  progressButtonItems: Array<ProgressItemProps>;
  completedStepId?: string | undefined;
  onStepClick?: (stepId: string) => void;
}

const ProgressButtons: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type IsStepCompletedFunction = (stepId: string) => boolean;

  const isStepCompleted: IsStepCompletedFunction = (
    stepId: string,
  ): boolean => {
    // if the step is on or before the completed step, return true
    return Boolean(
      props.completedStepId &&
        props.progressButtonItems.findIndex(
          (progressButtonItem: ProgressItemProps) => {
            return progressButtonItem.id === stepId;
          },
        ) <=
          props.progressButtonItems.findIndex(
            (progressButtonItem: ProgressItemProps) => {
              return progressButtonItem.id === props.completedStepId;
            },
          ),
    );
  };

  const isCurrentStep: IsStepCompletedFunction = (stepId: string): boolean => {
    // if this is one step ahead of the completed step, return true
    return Boolean(
      props.completedStepId &&
        props.progressButtonItems.findIndex(
          (progressButtonItem: ProgressItemProps) => {
            return progressButtonItem.id === stepId;
          },
        ) ===
          props.progressButtonItems.findIndex(
            (progressButtonItem: ProgressItemProps) => {
              return progressButtonItem.id === props.completedStepId;
            },
          ) +
            1,
    );
  };

  return (
    <nav aria-label="Progress" id={props.id} className="ml-3">
      <ol
        role="list"
        className="bg-white shadow divide-y divide-gray-300 rounded-md md:flex md:divide-y-0"
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
                isCurrentStep={isCurrentStep(progressButtonItem.id)}
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
