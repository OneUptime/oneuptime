import PlaceholderText from "./PlaceholderText";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a detail card shows for a field with no value.
 *
 * The field's own words when it has some ("No logo uploaded."), in the
 * muted grey of a value that is not there. Without them, a dash - the mark
 * a table or a form summary leaves in an empty cell - read out as "Not set"
 * to a screen reader. It used to be nothing at all, so the name of an empty
 * field hung over a blank line and read as if the card had not finished
 * loading. A placeholder that is itself a dash ("-") is no words: the same
 * dash (isDashText).
 */

// The mark an empty value is drawn as, everywhere a detail card draws one.
export const EMPTY_VALUE_MARK: string = "\u2014";

/*
 * The marks pages write for "nothing here": a hyphen, an en dash, an em
 * dash. Written as a field's placeholder or a table column's
 * noValueMessage, one is not words of its own: it was drawn as a hyphen
 * darker than the dash every other empty value is, with nothing for a
 * screen reader to hear (#7264), so it is drawn as that dash instead.
 */
export const DASH_PLACEHOLDERS: ReadonlyArray<string> = [
  "-",
  "\u2013",
  "\u2014",
];

// Whether a page's words for an empty value are only a dash (DASH_PLACEHOLDERS).
export const isDashText: (text: string | undefined) => boolean = (
  text: string | undefined,
): boolean => {
  return typeof text === "string" && DASH_PLACEHOLDERS.includes(text.trim());
};

/*
 * On the value's own 24px line (leading-6): text-sm alone sets a 20px one,
 * which put the dash 2px above the values beside it in its row, and made a
 * row of empty fields 4px shorter than a row of set ones.
 */
export const EMPTY_VALUE_CLASS_NAME: string = "text-sm leading-6 text-gray-400";

export const EMPTY_VALUE_TEST_ID: string = "detail-empty-value";

export interface ComponentProps {
  placeholder?: string | undefined;
}

const EmptyValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The field's own words - but a placeholder that is only a dash is the
   * dash below, with "Not set" for a screen reader, not a hyphen of its own.
   */
  if (props.placeholder?.trim() && !isDashText(props.placeholder)) {
    return <PlaceholderText text={props.placeholder} />;
  }

  return (
    <span className={EMPTY_VALUE_CLASS_NAME} data-testid={EMPTY_VALUE_TEST_ID}>
      <span aria-hidden="true">{EMPTY_VALUE_MARK}</span>
      <span className="sr-only">{translator.translateText("Not set")}</span>
    </span>
  );
};

export default EmptyValue;
