import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface FlowStep {
  title: string;
  description: string;
  icon: IconProp;
  iconColor: Color;
  iconBackgroundColor: Color;
}

export interface ComponentProps {
  steps: FlowStep[];
}

const VerticalFlowSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex flex-col items-center space-y-4">
      {props.steps.map((step: FlowStep, index: number) => {
        return (
          <React.Fragment key={index}>
            {/* Step */}
            <div className="flex items-center space-x-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: step.iconBackgroundColor.toString() }}
              >
                <Icon
                  icon={step.icon}
                  className="h-8 w-8"
                  style={{ color: step.iconColor.toString() }}
                />
              </div>
              <div>
                <p className="font-semibold text-gray-900">
                  {index + 1}. {step.title}
                </p>
                <p className="text-sm text-gray-500">{step.description}</p>
              </div>
            </div>

            {/* Arrow (except for last step) */}
            {index < props.steps.length - 1 && (
              <div className="flex flex-col items-center">
                <Icon
                  icon={IconProp.ChevronDown}
                  className="h-6 w-6 text-gray-400"
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default VerticalFlowSteps;
