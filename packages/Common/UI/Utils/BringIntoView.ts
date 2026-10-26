/*
 * Scrolls an element into view by as little as it takes - a form field that
 * a fold just showed, or the first field in error after the form's action
 * was pressed - in whatever scrolls around it: a dialog's body, the page,
 * or both.
 *
 * Only as much as needed (block "nearest"): an element already in view does
 * not move; one below the view comes up until its end is in view; one
 * taller than the view brings its start to the top, so a fold's header
 * stays in sight over the fields it opened. Smoothly, unless the reader
 * asks for less motion (prefers-reduced-motion), when it jumps.
 *
 * Nothing happens where there is nothing to scroll with: no element, or a
 * DOM without scrollIntoView (jsdom).
 *
 * The element's scroll margin is kept (scroll-margin, a form field's
 * scroll-my-4): a field brought to the top or bottom of a dialog keeps a
 * little room from its edge, not touching the dialog's header or footer.
 */

export const prefersReducedMotion: () => boolean = (): boolean => {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
};

const bringIntoView: (element: Element | null | undefined) => void = (
  element: Element | null | undefined,
): void => {
  if (!element || typeof element.scrollIntoView !== "function") {
    return;
  }

  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
};

// What can take the focus: a control that is not turned off.
export const FOCUSABLE_CONTROL_SELECTOR: string = [
  "input:not([type='hidden']):not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "button:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/*
 * The control a field in error is fixed in: the first one in it that says
 * it is invalid (aria-invalid) - a text box, a list's search box, an
 * editor - or, for a group that says so (a radio group), the first control
 * in the group. Null when nothing in it says so: a field the form cannot
 * tell the control of is only brought into view.
 */
export const getInvalidControl: (
  element: Element | null | undefined,
) => HTMLElement | null = (
  element: Element | null | undefined,
): HTMLElement | null => {
  if (!element) {
    return null;
  }

  const invalid: HTMLElement | null = element.querySelector<HTMLElement>(
    "[aria-invalid='true']",
  );

  if (!invalid) {
    return null;
  }

  if (invalid.matches(FOCUSABLE_CONTROL_SELECTOR)) {
    return invalid;
  }

  return invalid.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
};

/*
 * What marks a field's error message: the line a text box, text area,
 * dropdown, color or icon picker draws under itself, and the alert a custom
 * field draws for its own (Monitor Steps under all of its steps). Not any
 * alert: a field can draw a tip or a warning as an alert too.
 */
export const FIELD_ERROR_MESSAGE_SELECTOR: string =
  "[data-testid='error-message']";

/*
 * The message a field in error draws: the last one in it, under the controls
 * it is about. Null when the field draws none.
 */
export const getFieldErrorMessage: (
  element: Element | null | undefined,
) => HTMLElement | null = (
  element: Element | null | undefined,
): HTMLElement | null => {
  if (!element) {
    return null;
  }

  const messages: NodeListOf<HTMLElement> =
    element.querySelectorAll<HTMLElement>(FIELD_ERROR_MESSAGE_SELECTOR);

  return messages.length > 0 ? messages[messages.length - 1]! : null;
};

const SCROLLING_OVERFLOW: ReadonlyArray<string> = ["auto", "scroll", "overlay"];

/*
 * How tall the view is that an element scrolls in: its nearest ancestor
 * that scrolls - a dialog's body - or else the window, never more than the
 * window.
 */
const getViewHeight: (element: Element) => number = (
  element: Element,
): number => {
  const windowHeight: number =
    typeof window !== "undefined" ? window.innerHeight : 0;
  let ancestor: HTMLElement | null = element.parentElement;

  while (ancestor) {
    if (
      SCROLLING_OVERFLOW.includes(
        window.getComputedStyle(ancestor).overflowY,
      ) &&
      ancestor.scrollHeight > ancestor.clientHeight
    ) {
      return Math.min(ancestor.clientHeight, windowHeight);
    }

    ancestor = ancestor.parentElement;
  }

  return windowHeight;
};

/*
 * Brings a field in error into view. A field that fits comes in whole, its
 * label, control and message all in sight. A field taller than its view - a
 * custom field of many controls, such as Monitor Steps - would come in at
 * its start (bringIntoView), with the message that says what is wrong still
 * a screen or more below; so its message comes into view instead.
 */
export const bringFieldInErrorIntoView: (
  element: Element | null | undefined,
) => void = (element: Element | null | undefined): void => {
  if (!element) {
    return;
  }

  const message: HTMLElement | null = getFieldErrorMessage(element);

  if (
    message &&
    element.getBoundingClientRect().height > getViewHeight(element)
  ) {
    bringIntoView(message);
    return;
  }

  bringIntoView(element);
};

/*
 * Puts the focus on the control of a field in error (getInvalidControl),
 * without scrolling - bringIntoView has done that, as gently as it does:
 * after a press that found the field in error, the reader types the fix
 * there, and a screen reader reads the field with its help and its error
 * (aria-describedby). Whether the focus went there.
 */
export const focusInvalidControl: (
  element: Element | null | undefined,
) => boolean = (element: Element | null | undefined): boolean => {
  const control: HTMLElement | null = getInvalidControl(element);

  if (!control || typeof control.focus !== "function") {
    return false;
  }

  control.focus({ preventScroll: true });

  return control.ownerDocument.activeElement === control;
};

export default bringIntoView;
