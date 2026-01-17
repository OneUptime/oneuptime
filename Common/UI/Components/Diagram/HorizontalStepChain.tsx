import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface ChainStep {
  stepNumber: number;
  title: string;
  description: string;
  backgroundColor: Color;
  /** Optional label shown below the step number. Default is "Step" */
  stepLabel?: string | undefined;
}

export interface ChainEndStep {
  title: string;
  description: string;
  icon: IconProp;
  backgroundColor: Color;
}

export interface ComponentProps {
  steps: ChainStep[];
  endStep?: ChainEndStep | undefined;
  /** Default label for steps. Default is "Step" */
  defaultStepLabel?: string | undefined;
}

const HorizontalStepChain: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultLabel: string = props.defaultStepLabel || "Step";

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        {props.steps.map((step: ChainStep, index: number) => {
          return (
            <React.Fragment key={index}>
              {/* Step Box */}
              <div className="flex flex-col items-center">
                <div
                  className="w-20 h-20 rounded-lg flex items-center justify-center shadow-lg"
                  style={{ backgroundColor: step.backgroundColor.toString() }}
                >
                  <div className="text-center text-white">
                    <p className="text-2xl font-bold">{step.stepNumber}</p>
                    <p className="text-xs">{step.stepLabel || defaultLabel}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-700">
                  {step.title}
                </p>
                <p className="text-xs text-gray-500">{step.description}</p>
              </div>

              {/* Arrow */}
              <div className="hidden sm:flex items-center">
                <div className="w-8 h-0.5 bg-gray-300"></div>
                <Icon
                  icon={IconProp.ChevronRight}
                  className="h-5 w-5 text-gray-400"
                />
              </div>
            </React.Fragment>
          );
        })}

        {/* End Step */}
        {props.endStep && (
          <div className="flex flex-col items-center">
            <div
              className="w-20 h-20 rounded-lg flex items-center justify-center shadow-lg"
              style={{ backgroundColor: props.endStep.backgroundColor.toString() }}
            >
              <Icon icon={props.endStep.icon} className="h-8 w-8 text-white" />
            </div>
            <p className="mt-2 text-sm font-medium text-gray-700">
              {props.endStep.title}
            </p>
            <p className="text-xs text-gray-500">{props.endStep.description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default HorizontalStepChain;
