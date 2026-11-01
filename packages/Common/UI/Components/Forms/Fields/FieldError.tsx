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
 */

export const FIELD_ERROR_TEST_ID: string = "error-message";

export const FIELD_ERROR_CLASS_NAME: string = "mt-1 text-sm text-red-400";

export interface ComponentProps {
  // What is wrong, in the reader's language where the product has words for it.
  message: string;
  // The id a field's aria-describedby names.
  id?: string | undefined;
  // The line's own classes, where a field spaces or colours it its own way.
  className?: string | undefined;
  /*
   * How a screen reader is told: at once (role="alert", the default),
   * politely, after what it is saying (aria-live="polite"), or not at all -
   * for a field whose error is said by the field itself.
   */
  announce?: "alert" | "polite" | "none" | undefined;
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
      data-testid={FIELD_ERROR_TEST_ID}
      className={props.className ?? FIELD_ERROR_CLASS_NAME}
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
