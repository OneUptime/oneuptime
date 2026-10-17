import React from "react";

/*
 * A value cut short by its column's width (TableLayout) shows in full under
 * the pointer: the title is set the first time the value is pointed at, and
 * only when it really is cut short - a value that fits gets no tooltip
 * repeating it. An element of the value's own with a title (a pill, a
 * page's own tooltip) keeps its own.
 */

/*
 * A tooltip longer than this says nothing more: a cell holding a pasted log
 * is cut here rather than copied whole into the title on every hover.
 */
export const FULL_VALUE_TITLE_MAX_LENGTH: number = 1000;

/*
 * Whether an element shows less than it holds: wider than its box (an
 * ellipsis at its end), or taller (a line hidden by a clamp).
 */
const isElementCutShort: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return (
    element.scrollWidth > element.clientWidth ||
    element.scrollHeight > element.clientHeight + 1
  );
};

/*
 * Whether a part of the value ends in an ellipsis of its own: a person's
 * name beside their picture (a name line that truncates inside its row),
 * a pill's words. The value's own box fits then - its part does the
 * cutting - so the value would otherwise show no tooltip at all. Only a
 * part that draws an ellipsis counts: a part that merely runs past its box
 * is cut by the value's own clip, which the value's own box already tells.
 * Exported for its tests.
 */
export const hasPartCutShort: (element: Element) => boolean = (
  element: Element,
): boolean => {
  if (typeof window === "undefined" || !window.getComputedStyle) {
    return false;
  }

  return Array.from(element.querySelectorAll("*")).some(
    (part: Element): boolean => {
      return (
        part.scrollWidth > part.clientWidth &&
        window.getComputedStyle(part).textOverflow === "ellipsis"
      );
    },
  );
};

export const showFullValueWhenCutShort: (
  event: React.MouseEvent<HTMLElement>,
) => void = (event: React.MouseEvent<HTMLElement>): void => {
  const element: HTMLElement = event.currentTarget;

  /*
   * Cut short on its line (an ellipsis at the column's end), after its
   * first line (a row's name, which may wrap where only one line shows), or
   * inside it (a part that ends in an ellipsis of its own).
   */
  const isCutShort: boolean =
    isElementCutShort(element) || hasPartCutShort(element);

  if (isCutShort) {
    /*
     * innerText keeps a list's lines apart (a row's resources), so the
     * tooltip lists them one per line, as the cell does.
     */
    const fullValue: string = (element.innerText || element.textContent || "")
      .trim()
      .slice(0, FULL_VALUE_TITLE_MAX_LENGTH);

    if (fullValue) {
      element.title = fullValue;
      return;
    }
  }

  element.removeAttribute("title");
};
