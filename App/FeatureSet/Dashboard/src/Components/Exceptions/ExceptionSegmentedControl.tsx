import React, { ReactElement } from "react";

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: string;
  // Rendered after the label in a muted tone, e.g. a count.
  hint?: string | undefined;
  isDisabled?: boolean | undefined;
  title?: string | undefined;
}

export interface ComponentProps<TValue extends string> {
  label: string;
  options: ReadonlyArray<SegmentedControlOption<TValue>>;
  value: TValue;
  onChange: (value: TValue) => void;
  testId?: string | undefined;
}

/*
 * A compact radio group styled as joined buttons. Used for the trend window
 * and the stack trace view switches, where every option is always visible.
 */
const ExceptionSegmentedControl: <TValue extends string>(
  props: ComponentProps<TValue>,
) => ReactElement = <TValue extends string>(
  props: ComponentProps<TValue>,
): ReactElement => {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      data-testid={props.testId}
      className="inline-flex rounded-lg bg-gray-100 p-0.5"
    >
      {props.options.map(
        (option: SegmentedControlOption<TValue>): ReactElement => {
          const isActive: boolean = option.value === props.value;

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={option.isDisabled}
              title={option.title}
              data-testid={
                props.testId ? `${props.testId}-${option.value}` : undefined
              }
              onClick={() => {
                if (!option.isDisabled && !isActive) {
                  props.onChange(option.value);
                }
              }}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                  : option.isDisabled
                    ? "cursor-not-allowed text-gray-300"
                    : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {option.label}
              {option.hint && (
                <span
                  className={`tabular-nums ${isActive ? "text-gray-500" : "text-gray-400"}`}
                >
                  {option.hint}
                </span>
              )}
            </button>
          );
        },
      )}
    </div>
  );
};

export default ExceptionSegmentedControl;
