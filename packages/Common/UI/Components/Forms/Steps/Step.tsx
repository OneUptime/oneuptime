import { FormStep, FormStepState } from "../Types/FormStep";
import GenericObject from "../../../../Types/GenericObject";
import useTranslateValue from "../../../Utils/Translation";
import React, { ReactElement } from "react";

export interface ComponentProps<T> {
  step: FormStep<T>;
  onClick: (step: FormStep<T>) => void;
  state: FormStepState;
  /*
   * Whether pressing the step opens it. A completed step always can be; a
   * step not reached yet only on a form that allows any step.
   */
  isClickable?: boolean | undefined;
}

const Step: <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();

  /*
   * Looked up the same way as the "Step 2 of 3" title narrow screens show
   * in place of this list, so the two never name a step differently.
   */
  const title: string = translateString(props.step.title) ?? props.step.title;

  const isClickable: boolean =
    props.isClickable ?? props.state === FormStepState.COMPLETED;

  return (
    <li
      onClick={() => {
        if (isClickable && props.state !== FormStepState.ACTIVE) {
          props.onClick(props.step);
        }
      }}
      className={`${
        isClickable && props.state !== FormStepState.ACTIVE
          ? "cursor-pointer"
          : ""
      }`}
    >
      {props.state === FormStepState.COMPLETED && (
        <div className="group">
          <span className="flex items-start">
            <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
              <svg
                className="h-full w-full text-indigo-600 group-hover:text-indigo-800"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <span className="ml-3 text-sm font-medium text-gray-500 group-hover:text-gray-900">
              {title}
            </span>
          </span>
        </div>
      )}

      {props.state === FormStepState.ACTIVE && (
        <div className="flex items-start" aria-current="step">
          <span
            className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <span className="absolute h-4 w-4 rounded-full bg-indigo-200"></span>
            <span className="relative block h-2 w-2 rounded-full bg-indigo-600"></span>
          </span>
          <span className="ml-3 text-sm font-medium text-indigo-600">
            {title}
          </span>
        </div>
      )}

      {props.state === FormStepState.INACTIVE && (
        <div className="group">
          <div className="flex items-start">
            <div
              className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <div className="h-2 w-2 rounded-full bg-gray-300"></div>
            </div>
            <p
              className={`ml-3 text-sm font-medium text-gray-500 w-max ${
                isClickable ? "group-hover:text-gray-900" : ""
              }`}
            >
              {title}
            </p>
          </div>
        </div>
      )}
    </li>
  );
};

export default Step;
