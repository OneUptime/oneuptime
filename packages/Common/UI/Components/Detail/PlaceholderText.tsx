import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

/*
 * The dashed chip a detail card shows in place of a value that is not set
 * ("No logo uploaded.").
 *
 * It wraps. It used to be one line whatever its length (whitespace-nowrap),
 * so a long one - "No subscriber timezones selected so far. Subscribers
 * will receive notifications with times shown in GMT, EST, PST, IST, ACT
 * timezones by default.", "No Custom SMTP Config selected so far for this
 * status page." - ran past the card's edge on a phone, and past a narrow
 * card's at any width. A short one still reads as the same one-line chip.
 * It is an inline block no wider than what it sits in (max-w-full), and as
 * a flex item (a detail value is a flex row) it may shrink below its
 * longest word (min-w-0), which break-words then breaks, so not even a long
 * URL in a placeholder can push it out.
 */
export const PLACEHOLDER_TEXT_CLASS_NAME: string =
  "inline-block max-w-full min-w-0 whitespace-normal break-words rounded-md border border-dashed border-gray-300 bg-gray-50 px-2 py-0.5 align-middle text-sm font-normal text-gray-500 select-none";

const PlaceholderText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translatedText: string = translateString(props.text) ?? props.text;
  return (
    <span
      className={PLACEHOLDER_TEXT_CLASS_NAME}
      data-testid="placeholder-text"
    >
      {translatedText}
    </span>
  );
};

export default PlaceholderText;
