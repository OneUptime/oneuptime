// Tailwind
import { Logger } from "../../Utils/Logger";
import useTranslateValue from "../../Utils/Translation";
import Icon from "../Icon/Icon";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export enum InputType {
  TEXT = "text",
  PASSWORD = "password",
  NUMBER = "number",
  DATE = "date",
  DATETIME_LOCAL = "datetime-local",
  URL = "url",
  TIME = "time",
}

export interface ComponentProps {
  initialValue?: undefined | string | Date;
  id?: string | undefined;
  ariaLabelledby?: string | undefined;
  // Set together by fields that open a popup, so the state is on the focusable element.
  ariaHasPopup?: "dialog" | "listbox" | "menu" | "grid" | "tree" | undefined;
  ariaExpanded?: boolean | undefined;
  ariaControls?: string | undefined;
  /*
   * A text box that drives a list of suggestions is a combobox; the option
   * the arrow keys are on is named by ariaActiveDescendant, since focus
   * itself never leaves the input.
   */
  role?: "combobox" | undefined;
  ariaAutoComplete?: "list" | "both" | "inline" | "none" | undefined;
  ariaActiveDescendant?: string | undefined;
  // For inputs with no visible label element to point ariaLabelledby at.
  ariaLabel?: string | undefined;
  /*
   * For fields that render their own error text - a picker whose message sits
   * below the whole control rather than below this input.
   */
  ariaDescribedby?: string | undefined;
  ariaInvalid?: boolean | undefined;
  onClick?: undefined | (() => void);
  onKeyDown?:
    | undefined
    | ((event: React.KeyboardEvent<HTMLInputElement>) => void);
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  value?: string | Date | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  type?: InputType;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  onEnterPress?: (() => void) | undefined;
  error?: string | undefined;
  outerDivClassName?: string | undefined;
  autoFocus?: boolean | undefined;
  disableSpellCheck?: boolean | undefined;
  showSecondsForDateTime?: boolean | undefined;
  autoComplete?: string | undefined;
}

type GetDateDisplayValueFunction = (
  value: string | Date,
  type: InputType | undefined,
) => string | undefined;

/*
 * The text a date or datetime-local input shows for a stored value, in the
 * form the browser's picker reads. Undefined leaves the display as it is: a
 * value holding " - " is an InBetween range, which only a range filter shows.
 * So does anything that is neither a string nor a Date - an untyped caller's
 * number or JSON object - which the input has never tried to parse, and which
 * would now be parsed during render, where a throw takes the page down.
 */
const getDateDisplayValue: GetDateDisplayValueFunction = (
  value: string | Date,
  type: InputType | undefined,
): string | undefined => {
  if (!value) {
    return "";
  }

  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  if (typeof value === "string" && value.includes(" - ")) {
    return undefined;
  }

  const date: Date =
    value instanceof Date ? value : OneUptimeDate.fromString(value);

  try {
    return type === InputType.DATETIME_LOCAL
      ? OneUptimeDate.toDateTimeLocalString(date)
      : OneUptimeDate.asDateForDatabaseQuery(date);
  } catch (err: unknown) {
    Logger.error(err as Error);
    return "";
  }
};

const Input: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  /*
   * Each input's error message has an id of its own for the input to point
   * aria-describedby at. The id was fixed, so on a form with several fields
   * in error every message had the same id, and a screen reader described
   * each field -- "Your Email" -- with the first field's message, "Title is
   * required.".
   */
  const errorId: string = `input-error-${useId()}`;
  let className: string = "";

  if (!props.className) {
    className =
      "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";
  } else {
    className = props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  if (props.disabled) {
    className += " bg-gray-100 text-gray-500 cursor-not-allowed";
  }

  const isDateInput: boolean =
    props.type === InputType.DATE || props.type === InputType.DATETIME_LOCAL;

  /*
   * Seeded from the props on the first render, not by an effect after it.
   *
   * Seeding it from an effect meant the <input> was inserted blank and only
   * filled in a task or more later, and in between it was on screen, focusable
   * and typeable. Anything that put the caret in it during that window had it
   * moved to the end when the value landed, so what was typed next went AFTER
   * the prefilled text: the SLO burn rate form's Incident Title became "SLO
   * burn rate: {{sloName}} — {{ruleName}}Coordinate response for {{sloName}}"
   * when a fill selected the blank field just before its default template
   * arrived. TextArea and MarkdownEditor already start from their props.
   *
   * The effects further down still follow a value or initialValue that
   * changes after mounting.
   */
  const [value, setValue] = useState<string | Date>((): string | Date => {
    return props.value || props.initialValue || "";
  });

  /*
   * Only dates need a display form that differs from the stored value, and
   * working it out means parsing, so it stays in state behind an effect.
   * Text keeps no second copy - see the comment on displayValue below. Like
   * the value, it starts from what the input mounts with.
   */
  const [dateDisplayValue, setDateDisplayValue] = useState<string>(
    (): string => {
      return isDateInput ? getDateDisplayValue(value, props.type) ?? "" : "";
    },
  );
  const ref: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isDateInput) {
      return;
    }

    const nextDateDisplayValue: string | undefined = getDateDisplayValue(
      value,
      props.type,
    );

    if (nextDateDisplayValue !== undefined) {
      setDateDisplayValue(nextDateDisplayValue);
    }
  }, [value]);

  /*
   * For text the display value IS the value, derived here rather than kept in
   * a second piece of state, and that is load-bearing rather than tidiness.
   *
   * This <input> is uncontrolled - React never writes its `value` attribute -
   * so the effect below is the only thing keeping the DOM and this component
   * in step. When the display value was its own state it settled one render
   * behind `value`, and anything that interleaved a render between those two
   * commits (a parent re-rendering while the user typed, which is exactly what
   * the invite form does on every keystroke) made the effect write the older
   * copy back over text the browser already held. The character typed in that
   * window disappeared - the "typed characters vanish as I type" half of the
   * invite-user bug, and a silent character-eater in every form in the product.
   *
   * Derived, the two can no longer drift: `setValue` runs synchronously in the
   * change handler, so by the time any render commits, this already equals
   * what the user typed.
   */
  const displayValue: string = isDateInput
    ? dateDisplayValue
    : (value as string) || "";

  /*
   * A layout effect, so the write lands in the same commit that rendered the
   * value. A passive effect runs after that commit, and for one that did not
   * come from a click or a keystroke - data arriving, a timer - that is a later
   * task. In between, the field would be on screen blank even though this
   * component already knows what it holds.
   */
  useLayoutEffect(() => {
    const input: HTMLInputElement | null = ref.current;

    /*
     * Never write when it would not change anything: assigning to input.value
     * moves the caret to the end, so an unconditional write reorders text
     * whenever someone edits in the middle of a field.
     */
    if (input && input.value !== displayValue) {
      input.value = displayValue;
    }
  }, [ref, displayValue]);

  useEffect(() => {
    if (props.initialValue) {
      setValue(props.initialValue);
    }
  }, [props.initialValue]);

  useEffect(() => {
    setValue(props.value ? props.value : props.initialValue || "");
  }, [props.value]);

  return (
    <>
      <div
        className={
          props.outerDivClassName ||
          `relative mt-2 mb-1 rounded-md shadow-sm w-full`
        }
      >
        <input
          autoFocus={props.autoFocus}
          ref={ref}
          id={props.id}
          onFocus={props.onFocus}
          onClick={props.onClick}
          data-testid={props.dataTestId}
          spellCheck={!props.disableSpellCheck}
          autoComplete={props.autoComplete}
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledby}
          aria-haspopup={props.ariaHasPopup}
          aria-expanded={props.ariaExpanded}
          aria-controls={props.ariaControls}
          role={props.role}
          aria-autocomplete={props.ariaAutoComplete}
          aria-activedescendant={props.ariaActiveDescendant}
          aria-invalid={props.error || props.ariaInvalid ? "true" : undefined}
          aria-describedby={props.error ? errorId : props.ariaDescribedby}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const value: string | Date = e.target.value;

            if (
              (props.type === InputType.DATE ||
                props.type === InputType.DATETIME_LOCAL) &&
              value
            ) {
              /*
               * The input hands back a bare wall-clock with no offset. Resolve
               * it in the user's configured timezone rather than letting the
               * browser assume its own zone.
               */
              const date: Date = OneUptimeDate.fromDateTimeLocalString(value);
              const dateString: string = OneUptimeDate.toString(date);
              setValue(dateString);
              if (props.onChange) {
                props.onChange(dateString);
              }
            } else {
              setValue(value);
              if (props.onChange) {
                props.onChange(value);
              }
            }
          }}
          tabIndex={props.tabIndex}
          onKeyDown={
            props.onEnterPress || props.onKeyDown
              ? (event: React.KeyboardEvent<HTMLInputElement>) => {
                  props.onKeyDown?.(event);

                  /*
                   * A handler that claimed the key - a picker opening its popup
                   * on Enter, say - has already decided what it means.
                   */
                  if (event.defaultPrevented) {
                    return;
                  }

                  if (event.key === "Enter") {
                    props.onEnterPress?.();
                  }
                }
              : undefined
          }
          readOnly={props.readOnly || props.disabled || false}
          type={props.type || "text"}
          step={
            props.type === InputType.DATETIME_LOCAL &&
            props.showSecondsForDateTime
              ? "1"
              : undefined
          }
          placeholder={translateString(props.placeholder)}
          className={className}
          onBlur={() => {
            if (props.onBlur) {
              props.onBlur();
            }
          }}
        />

        {props.error && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
            aria-hidden="true"
          >
            <Icon icon={IconProp.ErrorSolid} className="h-5 w-5 text-red-500" />
          </div>
        )}
      </div>

      {props.error && (
        <p
          id={errorId}
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          role="alert"
        >
          {props.error}
        </p>
      )}
    </>
  );
};

export default Input;
