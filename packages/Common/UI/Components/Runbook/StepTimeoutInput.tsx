import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import {
  NON_NUMERIC_TIMEOUT_MESSAGE,
  TimeoutBounds,
  getTimeoutValidationError,
  secondsInputValueToTimeoutInMs,
  timeoutInMsToSecondsInputValue,
  willTimeoutBeClamped,
} from "../../../Types/Runbook/RunbookStepTimeout";

export interface ComponentProps {
  label: string;
  // Stored value, in milliseconds. Undefined means "use the default".
  value: number | undefined;
  bounds: TimeoutBounds;
  onChange: (timeoutInMs: number | undefined) => void;
  description?: ReactNode | undefined;
  dataTestId?: string | undefined;
  disabled?: boolean | undefined;
}

/*
 * Seconds-in, milliseconds-out editor for a per-step timeout.
 *
 * The typed text is held locally rather than derived from the stored value on
 * every keystroke: deriving it would fight the author mid-edit, because a
 * partially typed "0" or an emptied field both resolve to "unset" and would
 * erase what they were typing. The stored value only moves when the text
 * parses to something usable.
 */
const StepTimeoutInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const uniqueId: string = useId();
  const inputId: string = `step-timeout-${uniqueId}`;
  const describedById: string = `step-timeout-help-${uniqueId}`;
  const errorId: string = `step-timeout-error-${uniqueId}`;

  const [text, setText] = useState<string>(
    timeoutInMsToSecondsInputValue(props.value),
  );

  /*
   * A number input reports an empty string for text it cannot parse — a
   * dangling exponent ("1e"), a lone "-" — while still showing that text to
   * the author. Tracked separately from `text` so an unparseable keystroke
   * does not read as "the author cleared the field".
   */
  const [hasUnparseableInput, setHasUnparseableInput] =
    useState<boolean>(false);

  /*
   * Re-sync when the step being edited changes underneath us (collapse /
   * reorder / reload). Skipped while the text still represents the stored
   * value so the author's in-progress typing survives re-renders.
   */
  useEffect(() => {
    const storedAsText: string = timeoutInMsToSecondsInputValue(props.value);
    setText((currentText: string) => {
      return secondsInputValueToTimeoutInMs(currentText) === props.value
        ? currentText
        : storedAsText;
    });
  }, [props.value]);

  const validationError: string | null = hasUnparseableInput
    ? NON_NUMERIC_TIMEOUT_MESSAGE
    : getTimeoutValidationError(text, props.bounds);

  const defaultInSeconds: number = props.bounds.defaultInMs / 1000;

  const handleChange: (value: string, isUnparseable: boolean) => void = (
    value: string,
    isUnparseable: boolean,
  ): void => {
    if (isUnparseable) {
      /*
       * Hold the stored value. Reporting undefined here would discard a
       * timeout the author had already saved, without them touching a digit —
       * the field would look edited, save cleanly, and the step would silently
       * drop back to the default.
       */
      setHasUnparseableInput(true);
      return;
    }

    setHasUnparseableInput(false);
    setText(value);
    props.onChange(secondsInputValueToTimeoutInMs(value));
  };

  /*
   * Only a usable-but-out-of-range value gets clamped at run time. Anything
   * unusable falls back to the default instead, so the two cases need
   * different copy.
   */
  const consequence: string = hasUnparseableInput
    ? "The saved value is unchanged."
    : willTimeoutBeClamped(text, props.bounds)
      ? "Values outside the range are clamped when the step runs."
      : "Leave the field blank to use the default.";

  let inputClassName: string =
    "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

  if (validationError) {
    inputClassName +=
      " border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-red-500";
  }

  if (props.disabled) {
    inputClassName += " bg-gray-100 text-gray-500 cursor-not-allowed";
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-gray-700 mb-1.5"
      >
        {props.label}
        <span className="ml-2 text-[10px] font-normal text-gray-400">
          seconds
        </span>
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        min={props.bounds.minInMs / 1000}
        max={props.bounds.maxInMs / 1000}
        step="any"
        disabled={props.disabled}
        className={inputClassName}
        value={text}
        placeholder={`${defaultInSeconds}`}
        /*
         * The error is part of the field's description, not only a live region:
         * a screen reader that reaches an already-invalid field on focus still
         * hears why.
         */
        aria-describedby={
          validationError ? `${describedById} ${errorId}` : describedById
        }
        aria-invalid={validationError ? true : undefined}
        data-testid={props.dataTestId}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          handleChange(e.target.value, e.target.validity?.badInput === true);
        }}
      />
      <p id={describedById} className="text-xs text-gray-500 mt-1.5">
        {props.description ? <>{props.description} </> : null}
        Leave blank to use the default of {defaultInSeconds} seconds. Allowed
        range: {props.bounds.minInMs / 1000}–{props.bounds.maxInMs / 1000}{" "}
        seconds.
      </p>
      {validationError ? (
        <p id={errorId} role="alert" className="text-xs text-red-600 mt-1">
          {validationError} {consequence}
        </p>
      ) : null}
    </div>
  );
};

export default StepTimeoutInput;
