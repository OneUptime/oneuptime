import { EMPTY_VALUE_MARK, isDashText } from "../Detail/EmptyValue";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * What a stat tile's figure shows for a reading it does not have: the
 * quiet dash, at the figure's size (#8264).
 *
 * A table's cell and a card's field draw an empty value as the quiet dash
 * (TableEmptyValue, Detail/EmptyValue): a light grey em dash a screen
 * reader hears as "Not set". A tile's figure - the number from text-lg up
 * in a stat tile, a hero's count - could not: at 14px on a figure's line
 * the quiet dash is a speck. So every tile drew a dash of its own, at its
 * figure's size: about a hundred and twenty `value={x === null ? "—" :
 * fmt(x)}`, and a dozen spans of their own (`text-2xl font-semibold
 * text-gray-300`). Two tiles side by side drew "no reading" in grey-300 and
 * in the figure's own grey-900, and a screen reader heard "dash", or
 * nothing at all, where the table beside them said "Not set".
 *
 * This is that dash for a figure: drawn inside the figure's element, it
 * takes the figure's size and weight, so it is as wide as the number it
 * stands in for and sits on the figure's line; in the grey every other
 * empty value is drawn in (text-gray-400, as the quiet dash beside it in a
 * table); and read out as "Not set" in the reader's language, or as the
 * tile's own words when it has some ("No reading yet").
 *
 * `relative`: the sr-only words are position: absolute, so they stay in
 * the dash's own box rather than the page's, as TableEmptyValue's do - a
 * tile in a card that scrolls sideways does not widen a phone's page.
 */
export const EMPTY_FIGURE_CLASS_NAME: string = "relative text-gray-400";

export const EMPTY_FIGURE_TEST_ID: string = "empty-figure";

// What a screen reader hears for a figure with no words of its own.
export const EMPTY_FIGURE_DEFAULT_WORDS: string = "Not set";

export interface ComponentProps {
  /*
   * What a screen reader hears in place of the dash, in English: the tile
   * looks it up in the reader's language. "Not set" when there are none,
   * or when they are only a dash, which says nothing out loud.
   */
  screenReaderText?: string | undefined;
}

const EmptyFigure: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const words: string = props.screenReaderText?.trim() || "";
  const text: string =
    words && !isDashText(words) ? words : EMPTY_FIGURE_DEFAULT_WORDS;

  return (
    <span
      className={EMPTY_FIGURE_CLASS_NAME}
      data-testid={EMPTY_FIGURE_TEST_ID}
    >
      <span aria-hidden="true">{EMPTY_VALUE_MARK}</span>
      <span className="sr-only">{translateString(text) ?? text}</span>
    </span>
  );
};

/*
 * Whether a figure handed to a tile is a reading it does not have: nothing
 * (undefined, null), blank, or a dash ("-", "–", "—": isDashText), which
 * some hundred and twenty callers wrote for one. A tile draws EmptyFigure
 * for each, so a caller hands it no value at all.
 */
export const isEmptyFigure: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "" || isDashText(value);
  }

  return false;
};

/*
 * A tile's figure as it draws it: the value, or EmptyFigure for a reading
 * it does not have (isEmptyFigure). One call in every tile, so no tile
 * draws "no reading" its own way again.
 */
export const getFigure: (
  value: ReactNode,
  emptyProps?: ComponentProps | undefined,
) => ReactNode = (
  value: ReactNode,
  emptyProps?: ComponentProps | undefined,
): ReactNode => {
  if (isEmptyFigure(value)) {
    return <EmptyFigure {...(emptyProps || {})} />;
  }

  return value;
};

export default EmptyFigure;
