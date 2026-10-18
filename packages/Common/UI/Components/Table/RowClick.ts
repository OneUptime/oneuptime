/*
 * A row that opens its record when it is clicked anywhere - the way a list
 * in Linear, GitHub or Stripe does - without taking a click that belongs to
 * something inside it.
 *
 * Every table row that has a View action opens its record on a click. A
 * click is the row's only when it lands on the row itself, not on a control
 * the row holds: a link (the incident's number), a button (View, the ⋯, a
 * label's "2 more"), a select box, a drag grip, or anything a page marks
 * data-row-click-ignore. Nor when it never reached the row's own elements -
 * a menu or a dialog drawn in document.body is still the row's child in
 * React's tree, so its clicks bubble up to the row's handler - nor when the
 * reader was selecting a value's text to copy it.
 *
 * Cmd, Ctrl or Shift held, or the middle button, opens the record in a new
 * tab, as a link would.
 *
 * React-free on purpose, so it is tested on plain DOM events and shared by
 * any table that opens its rows.
 */

/*
 * What a click inside a row may land on and still be that control's own.
 * Kept to elements that do something on a click, so a click on a value's
 * plain text, a pill or an avatar opens the row.
 */
export const ROW_CONTROL_SELECTOR: string = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='menuitemcheckbox']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='tab']",
  "[contenteditable='true']",
  "[data-row-click-ignore]",
].join(", ");

// The parts of a mouse event the decision reads.
export interface RowClickEventLike {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  defaultPrevented?: boolean | undefined;
  button?: number | undefined;
  metaKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
}

// The main button (a click) and the middle one (an auxclick).
const MAIN_BUTTON: number = 0;
const MIDDLE_BUTTON: number = 1;

const getTargetElement: (target: EventTarget | null) => Element | null = (
  target: EventTarget | null,
): Element | null => {
  if (!target || typeof Node === "undefined" || !(target instanceof Node)) {
    return null;
  }

  if (target instanceof Element) {
    return target;
  }

  // A click on a value's text lands on its text node.
  return target.parentElement;
};

/*
 * Whether the reader has text selected - they were dragging over a value to
 * copy it, and the click that ends the drag is not a request to leave.
 */
export const hasTextSelection: () => boolean = (): boolean => {
  if (typeof window === "undefined" || !window.getSelection) {
    return false;
  }

  const selection: Selection | null = window.getSelection();

  return Boolean(
    selection && !selection.isCollapsed && selection.toString().trim(),
  );
};

/*
 * Whether this click on a row should open its record: it landed on the
 * row's own elements, not on a control inside it, with the main or the
 * middle button, and nothing has handled it already.
 */
export const isRowOpeningClick: (
  event: RowClickEventLike,
  options?: { hasTextSelection?: boolean | undefined } | undefined,
) => boolean = (
  event: RowClickEventLike,
  options?: { hasTextSelection?: boolean | undefined } | undefined,
): boolean => {
  if (event.defaultPrevented) {
    return false;
  }

  const button: number = event.button ?? MAIN_BUTTON;

  if (button !== MAIN_BUTTON && button !== MIDDLE_BUTTON) {
    return false;
  }

  const row: EventTarget | null = event.currentTarget;
  const target: Element | null = getTargetElement(event.target);

  if (!target || !row || !(row instanceof Element)) {
    return false;
  }

  // A menu or a dialog drawn in document.body, bubbling up React's tree.
  if (!row.contains(target)) {
    return false;
  }

  const control: Element | null = target.closest(ROW_CONTROL_SELECTOR);

  if (control && row.contains(control)) {
    return false;
  }

  const isSelecting: boolean =
    options?.hasTextSelection !== undefined
      ? options.hasTextSelection
      : hasTextSelection();

  return !isSelecting;
};

// Whether the record should open in a new tab, as a link clicked so would.
export const isNewTabClick: (event: RowClickEventLike) => boolean = (
  event: RowClickEventLike,
): boolean => {
  return Boolean(
    event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button === MIDDLE_BUTTON,
  );
};
