import React, { KeyboardEvent, ReactElement, useRef } from "react";

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
 *
 * Keyboard follows the radio group pattern: Tab reaches the checked option
 * only, and the arrow keys (plus Home/End) move and select within the group.
 */
const ExceptionSegmentedControl: <TValue extends string>(
  props: ComponentProps<TValue>,
) => ReactElement = <TValue extends string>(
  props: ComponentProps<TValue>,
): ReactElement => {
  const groupRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const enabledOptions: Array<SegmentedControlOption<TValue>> =
    props.options.filter((option: SegmentedControlOption<TValue>): boolean => {
      return !option.isDisabled;
    });

  const hasCheckedOption: boolean = enabledOptions.some(
    (option: SegmentedControlOption<TValue>): boolean => {
      return option.value === props.value;
    },
  );

  // With nothing checked, the first enabled option takes the tab stop.
  const tabStopValue: TValue | undefined = hasCheckedOption
    ? props.value
    : enabledOptions[0]?.value;

  const moveTo: (option: SegmentedControlOption<TValue>) => void = (
    option: SegmentedControlOption<TValue>,
  ): void => {
    const index: number = props.options.indexOf(option);
    const buttons: NodeListOf<HTMLButtonElement> | undefined =
      groupRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[role='radio']",
      );
    buttons?.[index]?.focus();
    if (option.value !== props.value) {
      props.onChange(option.value);
    }
  };

  const onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (enabledOptions.length === 0) {
      return;
    }

    const currentIndex: number = enabledOptions.findIndex(
      (option: SegmentedControlOption<TValue>): boolean => {
        return option.value === props.value;
      },
    );

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % enabledOptions.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        currentIndex <= 0 ? enabledOptions.length - 1 : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledOptions.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    moveTo(enabledOptions[nextIndex]!);
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={props.label}
      data-testid={props.testId}
      className="inline-flex rounded-lg bg-gray-100 p-0.5"
      onKeyDown={onKeyDown}
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
              tabIndex={option.value === tabStopValue ? 0 : -1}
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
