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

export const showFullValueWhenCutShort: (
  event: React.MouseEvent<HTMLElement>,
) => void = (event: React.MouseEvent<HTMLElement>): void => {
  const element: HTMLElement = event.currentTarget;

  if (element.scrollWidth > element.clientWidth) {
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
