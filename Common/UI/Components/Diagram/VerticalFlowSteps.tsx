import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface FlowStep {
  title: string;
  description: string;
  icon: IconProp;
  iconColor: Color;
}

export interface ComponentProps {
  steps: FlowStep[];
}

const VerticalFlowSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="relative">
      {props.steps.map((step: FlowStep, index: number) => {
        const isLast: boolean = index === props.steps.length - 1;

        return (
          <div key={index} className="relative flex items-start pb-6 last:pb-0">
            {/* Vertical line connecting steps */}
            {!isLast && (
              <div
                className="absolute left-4 top-10 w-px bg-gray-200"
                style={{ height: "calc(100% - 1rem)" }}
              />
            )}

            {/* Icon */}
            <div
              className="relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border border-gray-200 bg-white"
              style={{ borderColor: `${step.iconColor.toString()}40` }}
            >
              <Icon
                icon={step.icon}
                className="h-4 w-4"
                style={{ color: step.iconColor.toString() }}
              />
            </div>

            {/* Content */}
            <div className="ml-4 flex-1">
              <p className="text-sm font-medium text-gray-900">
                {step.title}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default VerticalFlowSteps;
