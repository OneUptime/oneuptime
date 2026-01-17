import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface ChainStep {
  stepNumber: number;
  title: string;
  description: string;
  color: Color;
  /** Optional label shown below the step number. Default is "Step" */
  stepLabel?: string | undefined;
}

export interface ChainEndStep {
  title: string;
  description: string;
  icon: IconProp;
  color: Color;
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
    <div className="flex items-center flex-wrap gap-3">
      {props.steps.map((step: ChainStep, index: number) => {
        return (
          <React.Fragment key={index}>
            {/* Step */}
            <div className="flex items-center space-x-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                style={{ backgroundColor: step.color.toString() }}
              >
                {step.stepNumber}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {step.title}
                </p>
                <p className="text-xs text-gray-500">
                  {step.stepLabel || defaultLabel} {step.stepNumber} ·{" "}
                  {step.description}
                </p>
              </div>
            </div>

            {/* Arrow */}
            <Icon
              icon={IconProp.ChevronRight}
              className="h-4 w-4 text-gray-300 hidden sm:block"
            />
          </React.Fragment>
        );
      })}

      {/* End Step */}
      {props.endStep && (
        <div className="flex items-center space-x-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${props.endStep.color.toString()}15` }}
          >
            <Icon
              icon={props.endStep.icon}
              className="h-4 w-4"
              style={{ color: props.endStep.color.toString() }}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              {props.endStep.title}
            </p>
            <p className="text-xs text-gray-500">{props.endStep.description}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default HorizontalStepChain;
