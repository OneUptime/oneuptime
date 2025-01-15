import React, { FunctionComponent, ReactElement } from "react";
import Color from "../../../Types/Color";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ProgressItemProps {
  id: string;
  title: string;
  color: Color;
}

export interface ComponentProps extends ProgressItemProps {
  isCompletedStep?: boolean;
  stepCount: number;
  isCurrentStep: boolean;
  isLastStep: boolean;
  onClick: () => void;
}

const ProgressButtonItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <li
      className="relative md:flex md:flex-1 "
      id={props.id}
      key={props.id}
      onClick={() => {
        if (!props.isCompletedStep) {
          return props.onClick();
        }
      }}
    >
      <div
        className={`group flex w-full items-center ${props.isCompletedStep ? "" : "hover:bg-gray-50 cursor-pointer"}`}
      >
        <span className="flex items-center px-6 py-4 text-sm font-medium">
          {props.isCompletedStep && (
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 group-hover:bg-indigo-800"
              style={{ backgroundColor: props.color.toString() }}
            >
              <Icon icon={IconProp.Check} className="size-6 text-white" />
            </span>
          )}
          {props.isCurrentStep && (
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-indigo-600"
              style={{ borderColor: props.color.toString() }}
            >
              <span
                className="text-indigo-600"
                style={{
                  color: props.color.toString(),
                }}
              >
                {props.stepCount}
              </span>
            </span>
          )}
          {!props.isCompletedStep && !props.isCurrentStep && (
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 group-hover:border-gray-400"
              style={{ borderColor: props.color.toString() }}
            >
              <span
                className="text-gray-500 group-hover:text-gray-900"
                style={{ color: props.color.toString() }}
              >
                {props.stepCount}
              </span>
            </span>
          )}
          <span
            className="ml-4 text-sm font-medium text-gray-900"
            style={{ color: props.color.toString() }}
          >
            {props.title}
          </span>
        </span>
      </div>

      {!props.isLastStep && (
        <div
          className="absolute right-0 top-0 hidden h-full w-5 md:block"
          aria-hidden="true"
        >
          <svg
            className="size-full text-gray-300"
            viewBox="0 0 22 80"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M0 -2L20 40L0 82"
              vectorEffect="non-scaling-stroke"
              stroke="currentcolor"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </li>
  );
};

export default ProgressButtonItem;
