import {
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
} from "../../../Types/ReadingDirection";

/*
 * WHICH WAY A DROPDOWN'S OPTION READS - picked, in its box, and listed, in
 * its menu.
 *
 *   - The product's own words, in the reader's language - a label the
 *     Dashboard looked up and translated - read the page's way: no `dir`
 *     of their own. A Persian label that starts with a Latin word ("CSS
 *     سفارشی", "SLA حادثه", "Runner سراسری · متصل", some two thousand of the
 *     Persian Dashboard's words) laid out left to right from that first
 *     letter (`dir="auto"`), so a right-to-left reader met its words in
 *     the wrong order (#5252).
 *   - So do words the caller put together from translated parts and marks
 *     as such (DropdownOption.isInPageDirection): "Global Runner ·
 *     Connected" is looked up a part at a time, never whole.
 *   - Anything else - a name someone gave a record, an English label no
 *     language has words for yet - reads the way most of its letters do
 *     (getTextReadingDirectionByMostLetters, the rule every value shown on
 *     a page follows): an English name on a Persian page keeps its start in
 *     view and its full stop at its end, and a Persian name that starts
 *     with an English word ("API پرداخت") reads right to left. A label with
 *     no letter at all (a port, a count) follows the page.
 *
 * Undefined is the page's way: the element is drawn without a `dir`.
 */
export const getDropdownLabelDirection: (data: {
  // The option's label as given: English to look up, or a name as written.
  label: string;
  // The label as drawn: translated, or as given.
  shownText: string;
  isUserContent?: boolean | undefined;
  isInPageDirection?: boolean | undefined;
}) => ReadingDirection | undefined = (data: {
  label: string;
  shownText: string;
  isUserContent?: boolean | undefined;
  isInPageDirection?: boolean | undefined;
}): ReadingDirection | undefined => {
  if (data.isInPageDirection) {
    return undefined;
  }

  const isTranslated: boolean =
    !data.isUserContent && data.shownText !== data.label;

  if (isTranslated) {
    return undefined;
  }

  return getTextReadingDirectionByMostLetters(data.shownText) || undefined;
};
