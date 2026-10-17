import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

/*
 * What a detail card shows in place of a value that is not set, in the
 * field's own words ("No logo uploaded."): quiet grey text where the value
 * would be.
 *
 * It was a dashed, grey-filled chip, which read as a button or a drop zone
 * - something to press - rather than as "nothing here yet". The text is
 * what tells the reader what is missing; the grey says it is not a value.
 *
 * It wraps, and breaks a word too long for its line: a long one - "No
 * subscriber timezones selected so far. Subscribers will receive
 * notifications with times shown in GMT, EST, PST, IST, ACT timezones by
 * default." - used to run past the card's edge on a phone. It is an inline
 * block no wider than what it sits in (max-w-full), and as a flex item (a
 * detail value is a flex row) it may shrink below its longest word
 * (min-w-0), which break-words then breaks, so not even a long URL in a
 * placeholder can push it out.
 */
export const PLACEHOLDER_TEXT_CLASS_NAME: string =
  "inline-block max-w-full min-w-0 whitespace-normal break-words align-middle text-sm font-normal text-gray-500";

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
