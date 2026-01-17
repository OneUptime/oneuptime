import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Color from "../../../Types/Color";

export interface NumberedStep {
  title: string;
  description: string;
  /** If provided, shows an icon instead of number */
  icon?: IconProp | undefined;
  /** Background color for the step circle */
  backgroundColor?: Color | undefined;
}

export interface ComponentProps {
  steps: NumberedStep[];
  /** Default background color for numbered steps */
  defaultBackgroundColor?: Color | undefined;
}

const NumberedSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const defaultBgColor: Color = props.defaultBackgroundColor || new Color("#2563eb"); // blue-600

  return (
    <div className="space-y-6">
      {props.steps.map((step: NumberedStep, index: number) => {
        const bgColor: Color = step.backgroundColor || defaultBgColor;

        return (
          <div key={index} className="flex items-start space-x-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: bgColor.toString() }}
            >
              {step.icon ? (
                <Icon icon={step.icon} className="h-5 w-5 text-white" />
              ) : (
                <span className="text-white font-bold">{index + 1}</span>
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900">{step.title}</h4>
              <p className="text-sm text-gray-600 mt-1">{step.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NumberedSteps;
