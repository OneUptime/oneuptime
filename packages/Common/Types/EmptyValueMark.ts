/*
 * THE MARK FOR A VALUE THAT IS NOT THERE, AS TEXT (#8262).
 *
 * The em dash every quiet dash draws (Detail/EmptyValue, Table/
 * TableEmptyValue, EmptyFigure), and the words a plain-text consumer is
 * handed for nothing: a chart's axis or tooltip, a PDF or Markdown export, a
 * sentence's slot, an email. A formatter writes this mark for nothing, never
 * a hyphen or an en dash of its own, so one mark reads "nothing here"
 * everywhere; pages wrote three.
 *
 * It is text, with nothing for a screen reader: where a page draws a value
 * in an element, it draws it through getValueOrQuietDash (Table/
 * TableEmptyValue) or a tile's getFigure (EmptyFigure), which draw the quiet
 * dash for it, and a component that draws a value it is handed (a table's
 * cell, a detail card's field, a tile) does the same.
 * HandWrittenEmptyValueGuard holds every page to it.
 *
 * React-free and window-free, so a view model, an export or a worker reads
 * it as a formatter does.
 */
export const EMPTY_VALUE_MARK: string = "—";

/*
 * The marks pages write for "nothing here": a hyphen, an en dash, an em
 * dash. Written as a field's placeholder or a table column's
 * noValueMessage, one is not words of its own: it was drawn as a hyphen
 * darker than the dash every other empty value is, with nothing for a
 * screen reader to hear (#7264), so it is drawn as that dash instead.
 */
export const DASH_PLACEHOLDERS: ReadonlyArray<string> = [
  "-",
  "–",
  EMPTY_VALUE_MARK,
];

// Whether a page's words for an empty value are only a dash (DASH_PLACEHOLDERS).
export const isDashText: (text: string | undefined) => boolean = (
  text: string | undefined,
): boolean => {
  return typeof text === "string" && DASH_PLACEHOLDERS.includes(text.trim());
};

/*
 * Whether a value a component is handed is one it does not have: nothing
 * (undefined, null), blank, or a dash - a formatter's plain-text mark for
 * nothing (EMPTY_VALUE_MARK), or a hyphen a page wrote (isDashText). A
 * component that draws a value draws the quiet dash for each.
 */
export const isNoValue: (value: unknown) => boolean = (
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
