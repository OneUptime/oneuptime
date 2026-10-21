import Pill, { PillSize } from "../Pill/Pill";
import { Indigo500 } from "../../../Types/BrandColors";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The English text, which is also its key in the Dashboard locale files
 * (looked up by value, like every other string Common renders).
 */
export const CURRENTLY_ACTIVE_TEXT: string = "Currently Active";

export interface ComponentProps {
  size?: PillSize | undefined;
}

/*
 * Marks the status or state that is in effect right now - the timeline row
 * that has no end yet. It used to be the words "Currently Active" in the same
 * grey as every other cell, which was easy to read past.
 *
 * A pill like the status pill beside it, in the brand indigo the product
 * already uses for "happening now" (an on-call override in force, an AI
 * investigation running) rather than the status's own colour: a red
 * "Identified" next to a red marker would say the same thing twice, and a
 * green one would read as "healthy". Its dot pulses, except for readers who
 * asked for reduced motion, for whom the words carry it alone.
 */
const CurrentlyActiveIndicator: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <span
      data-testid="currently-active-indicator"
      className="inline-flex max-w-full align-middle"
    >
      <Pill
        color={Indigo500}
        text={translateString(CURRENTLY_ACTIVE_TEXT) || CURRENTLY_ACTIVE_TEXT}
        size={props.size}
        isPulsing={true}
      />
    </span>
  );
};

export default CurrentlyActiveIndicator;
