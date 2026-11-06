import IsolatedText from "../../IsolatedText/IsolatedText";
import { getLineDirection } from "../../../Utils/LineDirection";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT IS WRONG WITH A FIELD, UNDER IT.
 *
 * Every field draws its error with this one line: in red, under the field,
 * where the field's words start, and said to a screen reader as it appears.
 *
 * The message reads the way it is written. A check the product makes is in
 * the reader's language, but an answer from the server is in English -
 * "Promo code is invalid." - and on a Persian page, laid out right to left,
 * its full stop came first: ".Promo code is invalid". A message that reads
 * the other way from the page is drawn in an isolate of its own
 * (IsolatedText), so it keeps its full stop at its end and the line still
 * starts at the right, under the field. One in the page's own words is
 * drawn as it always was.
 *
 * Its red is its own. Every field's error was drawn in a light red
 * (text-red-400), 2.8:1 on a white card - under the 4.5:1 that text needs
 * to be read - and the fields that placed their error line their own way
 * coloured it too, in four different reds. A field places the line
 * (className: its gap, its indent, its size); the colour is always
 * FIELD_ERROR_COLOR_CLASS_NAME (FieldErrorColorGuard).
 */

export const FIELD_ERROR_TEST_ID: string = "error-message";

/*
 * The product's danger text (Theme.css's --ou-danger-text): 6.5:1 on a
 * white card, 5.9:1 on the grey (gray-100) a field can sit on. The dark
 * theme draws it #fca5a5 (Theme.css), 8.6:1 on a dark card.
 */
export const FIELD_ERROR_COLOR_CLASS_NAME: string = "text-red-700";

// Where the line sits and how big its words are: under the field, small.
export const FIELD_ERROR_PLACE_CLASS_NAME: string = "mt-1 text-sm";

export const FIELD_ERROR_CLASS_NAME: string = `${FIELD_ERROR_PLACE_CLASS_NAME} ${FIELD_ERROR_COLOR_CLASS_NAME}`;

/*
 * The line's classes: where the field places it - or under the field,
 * small - and always the error's own red.
 */
export const getFieldErrorClassName: (placeClassName?: string) => string = (
  placeClassName?: string,
): string => {
  return [
    placeClassName ?? FIELD_ERROR_PLACE_CLASS_NAME,
    FIELD_ERROR_COLOR_CLASS_NAME,
  ]
    .filter(Boolean)
    .join(" ");
};

export interface ComponentProps {
  // What is wrong, in the reader's language where the product has words for it.
  message: string;
  // The id a field's aria-describedby names.
  id?: string | undefined;
  /*
   * Where the line sits and how big its words are, where a field places it
   * its own way: "mt-2", "pl-14 mt-1 text-sm", "text-xs". Never a colour:
   * the red is FieldError's (FIELD_ERROR_COLOR_CLASS_NAME).
   */
  className?: string | undefined;
  /*
   * How a screen reader is told: at once (role="alert", the default),
   * politely, after what it is saying (aria-live="polite"), or not at all -
   * for a field whose error is said by the field itself.
   */
  announce?: "alert" | "polite" | "none" | undefined;
  /*
   * The line's test id: the one every field's error line shares
   * (FIELD_ERROR_TEST_ID), or a field's own, where its suites already find
   * its error by one ("rule-criteria-error").
   */
  dataTestId?: string | undefined;
}

const FieldError: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const message: string =
    translator.translateText(props.message) ?? props.message;
  const announce: "alert" | "polite" | "none" = props.announce || "alert";

  return (
    <p
      id={props.id}
      data-testid={props.dataTestId || FIELD_ERROR_TEST_ID}
      className={getFieldErrorClassName(props.className)}
      role={announce === "alert" ? "alert" : undefined}
      aria-live={announce === "polite" ? "polite" : undefined}
    >
      {getLineDirection(message, translator.language) ? (
        <IsolatedText text={message} />
      ) : (
        message
      )}
    </p>
  );
};

export default FieldError;
