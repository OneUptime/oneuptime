import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface NumberedStep {
  title: string;
  description: string;
  /** If provided, shows an icon instead of number */
  icon?: IconProp | undefined;
  /** Color for the step indicator */
  color?: Color | undefined;
}

export interface ComponentProps {
  steps: NumberedStep[];
  /** Default color for steps */
  defaultColor?: Color | undefined;
}

const NumberedSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultColor: Color = props.defaultColor || new Color("#6b7280"); // gray-500

  return (
    <div className="relative">
      {props.steps.map((step: NumberedStep, index: number) => {
        const color: Color = step.color || defaultColor;
        const isLast: boolean = index === props.steps.length - 1;

        return (
          <div key={index} className="relative flex items-start pb-5 last:pb-0">
            {/* Vertical line connecting steps */}
            {!isLast && (
              <div
                className="absolute left-4 top-10 w-px bg-gray-200"
                style={{ height: "calc(100% - 1.5rem)" }}
              />
            )}

            {/* Number/Icon indicator */}
            <div
              className="relative flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 bg-white"
              style={{ borderColor: color.toString() }}
            >
              {step.icon ? (
                <Icon
                  icon={step.icon}
                  className="h-4 w-4"
                  style={{ color: color.toString() }}
                />
              ) : (
                <span
                  className="text-sm font-medium"
                  style={{ color: color.toString() }}
                >
                  {index + 1}
                </span>
              )}
            </div>

            {/* Content */}
            <div className="ml-4 flex-1 pt-0.5">
              <h4 className="text-sm font-medium text-gray-900">{step.title}</h4>
              <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NumberedSteps;
