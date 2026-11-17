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

/*
 * A step that opens is a button: it was an `li` with only a click, so going
 * back to a finished step was for a mouse alone (#9136). The button is the
 * whole row, takes the focus ring every control has, and under a finger is
 * at least 44px tall.
 *
 * It reaches 4px past the row on each side (-mx-1, so its ring and its
 * padding sit around the words, not on them), and so is the row's width
 * plus those 8px: at w-full, -mx-1 only slid it 4px over, and the last 4px
 * of the row's far end opened nothing (#9245).
 */
export const STEP_BUTTON_CLASS_NAME: string =
  "group -mx-1 -my-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-start rounded-md px-1 py-1 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:items-center";

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
  const title: string = props.step.isTitleProductName
    ? props.step.title
    : translateString(props.step.title) ?? props.step.title;

  const isClickable: boolean =
    props.isClickable ?? props.state === FormStepState.COMPLETED;

  const opensOnPress: boolean =
    isClickable && props.state !== FormStepState.ACTIVE;

  /*
   * A title is one line whatever its state (w-max). Only a step not reached
   * yet was: the list's column is as wide as its titles, so on a form's
   * last step - every title done or current - it shrank, wrapping "Probes &
   * Interval" and "Monitor Info" onto two lines and moving the form beside
   * it, and on a two-step form "Monitor Info" wrapped from the start.
   */
  let content: ReactElement = <></>;

  if (props.state === FormStepState.COMPLETED) {
    content = (
      <span className="group flex items-start">
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
        <span className="ml-3 w-max text-sm font-medium text-gray-500 group-hover:text-gray-900">
          {title}
        </span>
      </span>
    );
  }

  if (props.state === FormStepState.ACTIVE) {
    content = (
      <span className="flex items-start" aria-current="step">
        <span
          className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span className="absolute h-4 w-4 rounded-full bg-indigo-200"></span>
          <span className="relative block h-2 w-2 rounded-full bg-indigo-600"></span>
        </span>
        <span className="ml-3 w-max text-sm font-medium text-indigo-600">
          {title}
        </span>
      </span>
    );
  }

  if (props.state === FormStepState.INACTIVE) {
    content = (
      <span className="group flex items-start">
        <span
          className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <span className="h-2 w-2 rounded-full bg-gray-300"></span>
        </span>
        <span
          className={`ml-3 text-sm font-medium text-gray-500 w-max ${
            isClickable ? "group-hover:text-gray-900" : ""
          }`}
        >
          {title}
        </span>
      </span>
    );
  }

  if (!opensOnPress) {
    return <li>{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        className={STEP_BUTTON_CLASS_NAME}
        data-testid={`form-step-${props.step.id}`}
        onClick={() => {
          props.onClick(props.step);
        }}
      >
        {content}
      </button>
    </li>
  );
};

export default Step;
