import FieldError from "../Forms/Fields/FieldError";
// Tailwind
import { Logger } from "../../Utils/Logger";
import joinAriaIds from "../../Utils/AriaIds";
import useTranslateValue from "../../Utils/Translation";
import { TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME } from "../../Utils/TypedTextDirection";
import {
  getReadingDirection,
  RIGHT_TO_LEFT,
} from "../../../Types/ReadingDirection";
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

/*
 * What tells each password manager to leave a field alone: 1Password (both of
 * its spellings), LastPass, Bitwarden and Dashlane. Browsers' own password
 * managers go by autocomplete instead - "new-password" keeps them from
 * filling a saved login in.
 */
export const PASSWORD_MANAGER_IGNORE_ATTRIBUTES: Readonly<
  Record<string, string>
> = {
  "data-1p-ignore": "true",
  "data-op-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
};

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
   * What describes the input besides its own error, read before the error:
   * its field's help (FormField), or the error text of a field that draws
   * its own - a picker whose message sits below the whole control rather
   * than below this input.
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
  /*
   * A value that reads left to right in every language, typed as text: a
   * list of phone numbers, which a phone's dial pad has no comma for. A
   * phone number (inputMode "tel") and an address on the web read so
   * already.
   */
  readsLeftToRight?: boolean | undefined;
  /*
   * The placeholder is an identifier (an OIDC claim's name), drawn as
   * given and never looked up (a form Field's isPlaceholderIdentifier).
   */
  isPlaceholderIdentifier?: boolean | undefined;
  /*
   * A datetime-local field shows and keeps hours and minutes: a time people
   * schedule or record something at is picked to the minute, and a value
   * with seconds made the browser's picker show a seconds column too
   * ("13/11/2026 11:15:52"). A field whose time is compared with event
   * timestamps to the second - a telemetry time range - opts in to seconds
   * here, with its reason beside it (MinutePickersGuard lists every one).
   */
  showSecondsForDateTime?: boolean | undefined;
  autoComplete?: string | undefined;
  // The most characters it takes, as the column it fills keeps them.
  maxLength?: number | undefined;
  /*
   * Which keyboard a phone offers for it - "numeric" for a number typed as
   * text (a pull request's), which keeps what is typed as it is, where a
   * number input would not.
   */
  inputMode?:
    | "text"
    | "numeric"
    | "decimal"
    | "tel"
    | "email"
    | "url"
    | "search"
    | "none"
    | undefined;
  /*
   * A password field that holds the person's own password, on a page where
   * they sign in, sign up or change it: password managers may fill and save
   * it. Leave it unset everywhere else - see isStoredSecret below.
   */
  isOwnCredential?: boolean | undefined;
  /*
   * A box that searches or filters what is shown - a table's search, a
   * filter, a picker's own search: what is typed in it is a query, never
   * work to keep, so a new version of OneUptime never waits for it
   * (data-unsaved-changes-ignore, Utils/NewVersion/UnsavedChanges).
   */
  isSearchOrFilter?: boolean | undefined;
}

type GetDateDisplayValueFunction = (
  value: string | Date,
  type: InputType | undefined,
  showSecondsForDateTime?: boolean | undefined,
) => string | undefined;

/*
 * The text a date or datetime-local input shows for a stored value, in the
 * form the browser's picker reads. Undefined leaves the display as it is: a
 * value holding " - " is an InBetween range, which only a range filter shows.
 * So does anything that is neither a string nor a Date - an untyped caller's
 * number or JSON object - which the input has never tried to parse, and which
 * would now be parsed during render, where a throw takes the page down.
 *
 * A date and time is shown to the minute ("2026-11-13T11:15"), unless the
 * field opts in to seconds (showSecondsForDateTime). Only what is shown
 * drops the seconds: the value stays as it was given until the person
 * changes the field, so a stored 11:15:52 left alone is saved as 11:15:52.
 */
export const getDateDisplayValue: GetDateDisplayValueFunction = (
  value: string | Date,
  type: InputType | undefined,
  showSecondsForDateTime?: boolean | undefined,
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
    if (type !== InputType.DATETIME_LOCAL) {
      return OneUptimeDate.asDateForDatabaseQuery(date);
    }

    return showSecondsForDateTime
      ? OneUptimeDate.toDateTimeLocalString(date)
      : OneUptimeDate.toDateTimeLocalMinuteString(date);
  } catch (err: unknown) {
    Logger.error(err as Error);
    return "";
  }
};

/*
 * A number field on a page read right to left: its number reads left to
 * right, as a number is written in every language - unicode-bidi:
 * plaintext, as typed text does (TypedTextDirection), and its example the
 * same way. The field itself keeps the page's direction, so its error icon
 * and its spinner stay where every other field has them.
 */
export const NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME: string = `${TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME} placeholder:[unicode-bidi:plaintext]`;

/*
 * And the number stays at the field's right, where the page's lines start
 * and where it always sat: a line that reads left to right would start at
 * the left. Written out in full, which the page's left-and-right swap
 * (TailwindReadingDirection) leaves as it is.
 */
export const NUMBER_AT_THE_PAGE_START_CLASS_NAME: string = "[text-align:right]";

// A box that already says where its line sits keeps it.
const TEXT_ALIGN_CLASS_NAME_PATTERN: RegExp =
  /(?:^|\s)(?:text-(?:left|center|right|start|end|justify)|\[text-align:[a-z-]+\])(?=\s|$)/;

const Input: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString, language } = useTranslateValue();
  /*
   * Each input's error message has an id of its own for the input to point
   * aria-describedby at. The id was fixed, so on a form with several fields
   * in error every message had the same id, and a screen reader described
   * each field -- "Your Email" -- with the first field's message, "Title is
   * required.".
   */
  const errorId: string = `input-error-${useId()}`;
  let className: string = "";

  /*
   * Room at the field's end for the error's icon: pr-10 in place of pr-3.
   * Written beside pr-3 it never applied - Tailwind's stylesheet puts pr-3
   * after pr-10 - so a value ran under the icon; on a Persian page an
   * English value starts at the left, where the icon is.
   */
  if (!props.className) {
    className = `block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 ${
      props.error ? "pr-10" : "pr-3"
    } text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm`;
  } else {
    className = props.error ? `${props.className} pr-10` : props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  if (props.disabled) {
    className += " bg-gray-100 text-gray-500 cursor-not-allowed";
  }

  const isDateInput: boolean =
    props.type === InputType.DATE || props.type === InputType.DATETIME_LOCAL;

  /*
   * What is typed reads the way it is written (TypedTextDirection): an
   * English name or address on a Persian page keeps its full stop and its
   * slashes at its end. Not a date, a time or a number, which the browser
   * lays out itself - but for a number on a page read right to left, below.
   */
  if (
    !isDateInput &&
    props.type !== InputType.TIME &&
    props.type !== InputType.NUMBER
  ) {
    className += ` ${TYPED_TEXT_READS_ITS_OWN_WAY_CLASS_NAME}`;
  }

  /*
   * A phone number and an address on the web are written left to right in
   * every language. On a page read right to left their placeholders came
   * out back to front - "11234567890+" for "+11234567890",
   * ".../https://hooks.slack.com/services" for
   * "https://hooks.slack.com/services/..." - and a number typed in with
   * spaces or brackets started at the far end from its placeholder. So such
   * a field reads left to right, its error icon (at the end of the box
   * around it) on the right with it, whatever the page's language. And a
   * field that says it reads so: a list of phone numbers, whose example
   * "+14155550123, +447700900123" put each "+" after its digits (#7180).
   */
  const readsLeftToRight: boolean =
    props.readsLeftToRight === true ||
    props.inputMode === "tel" ||
    props.inputMode === "url" ||
    props.type === InputType.URL;

  /*
   * A number on a page read right to left. The browser laid a negative one
   * out the page's way, its minus sign after its digits: a network site's
   * longitude of -71.0589 read "71.0589-" - another point than the one
   * saved - and the field's example "-89.6501" read "89.6501-". So there a
   * number reads left to right (NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME), at
   * the field's right where it always was, unless the field says where its
   * line sits (NUMBER_AT_THE_PAGE_START_CLASS_NAME). On a page read left to
   * right a number field is drawn as it always was.
   */
  if (
    props.type === InputType.NUMBER &&
    getReadingDirection(language) === RIGHT_TO_LEFT
  ) {
    const hasItsOwnAlignment: boolean =
      TEXT_ALIGN_CLASS_NAME_PATTERN.test(className);

    className += ` ${NUMBER_READS_LEFT_TO_RIGHT_CLASS_NAME}`;

    if (!hasItsOwnAlignment) {
      className += ` ${NUMBER_AT_THE_PAGE_START_CLASS_NAME}`;
    }
  }

  /*
   * A password field that is not the person's own holds a secret the product
   * stores for something else: an SMTP or SNMP password, an API token, the
   * password an admin sets for a private status page user. To a password
   * manager every password field reads as a sign-in form, so these were
   * offered the person's OneUptime login, saved as new logins for the site,
   * and 1Password put its "Sign in" prompt over Dashboard pages that sign
   * nobody in. "new-password" keeps browsers from filling a saved login in,
   * and the attributes send the password managers away.
   */
  const isStoredSecret: boolean =
    props.type === InputType.PASSWORD && !props.isOwnCredential;

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
      return isDateInput
        ? getDateDisplayValue(
            value,
            props.type,
            props.showSecondsForDateTime,
          ) ?? ""
        : "";
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
      props.showSecondsForDateTime,
    );

    if (nextDateDisplayValue !== undefined) {
      setDateDisplayValue(nextDateDisplayValue);
    }
  }, [value, props.showSecondsForDateTime]);

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
        dir={readsLeftToRight ? "ltr" : undefined}
      >
        <input
          autoFocus={props.autoFocus}
          ref={ref}
          id={props.id}
          dir={readsLeftToRight ? "ltr" : undefined}
          onFocus={props.onFocus}
          onClick={props.onClick}
          data-testid={props.dataTestId}
          spellCheck={!props.disableSpellCheck}
          autoComplete={
            props.autoComplete || (isStoredSecret ? "new-password" : undefined)
          }
          {...(isStoredSecret ? PASSWORD_MANAGER_IGNORE_ATTRIBUTES : {})}
          data-unsaved-changes-ignore={props.isSearchOrFilter || undefined}
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledby}
          aria-haspopup={props.ariaHasPopup}
          aria-expanded={props.ariaExpanded}
          aria-controls={props.ariaControls}
          role={props.role}
          aria-autocomplete={props.ariaAutoComplete}
          aria-activedescendant={props.ariaActiveDescendant}
          aria-invalid={props.error || props.ariaInvalid ? "true" : undefined}
          aria-describedby={joinAriaIds(
            props.ariaDescribedby,
            props.error ? errorId : undefined,
          )}
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
          maxLength={props.maxLength}
          inputMode={props.inputMode}
          type={props.type || "text"}
          step={
            props.type === InputType.DATETIME_LOCAL &&
            props.showSecondsForDateTime
              ? "1"
              : undefined
          }
          placeholder={
            props.isPlaceholderIdentifier
              ? props.placeholder
              : translateString(props.placeholder)
          }
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

      {props.error && <FieldError id={errorId} message={props.error} />}
    </>
  );
};

export default Input;
