/*
 * What in a step's settings could still change something on a view
 * (WorkflowViewOnly), read from the DOM - for the tests that hold a view's
 * settings still: the dialog's own (ComponentSettingsModalViewOnly) and the
 * sweep over every step (WorkflowViewOnlyEveryStepGuard).
 *
 * On a view every setting is held still, one by one: a form control is
 * disabled, a code box is read only, a value box is read only, a grip picks
 * nothing up. What only reads a setting stays usable: a code box's own Copy,
 * and a fold - More fields, Compare as - that opens to show what it holds.
 * Anything else that still takes a press, a key or typing is "live", and
 * these helpers name it.
 */

/*
 * The controls that only read a setting. A disabled fieldset around a whole
 * step's settings used to disable these with everything else.
 */
export const CODE_COPY_SELECTOR: string =
  '[data-testid="code-editor-copy-button"]';

// More fields, and every form's other folds (FoldedSection).
export const FOLD_HEADER_SELECTOR: string =
  '[data-testid="folded-section-header"]';

// A code box shown to be read: CodeEditor's read-only textarea.
const READ_ONLY_CODE_INPUT_SELECTOR: string =
  'textarea[data-testid="code-editor-input"][readonly]';

const FORM_CONTROL_SELECTOR: string = "input, select, textarea, button";

export interface LiveControl {
  // What kind of thing it is, in a few words.
  kind: string;
  // Its opening tag, enough to find it.
  element: string;
}

type OpeningTagFunction = (element: Element) => string;

const openingTag: OpeningTagFunction = (element: Element): string => {
  const html: string = element.outerHTML;
  const end: number = html.indexOf(">");

  return end === -1 ? html.slice(0, 160) : html.slice(0, end + 1);
};

type IsReadingControlFunction = (element: Element) => boolean;

// A fold's header, drawn as a div with role button (CollapsibleSection).
const isFoldToggle: IsReadingControlFunction = (element: Element): boolean => {
  return (
    element.getAttribute("role") === "button" &&
    element.hasAttribute("aria-expanded") &&
    element.hasAttribute("aria-controls")
  );
};

const isReadingControl: IsReadingControlFunction = (
  element: Element,
): boolean => {
  return (
    element.matches(CODE_COPY_SELECTOR) ||
    element.matches(FOLD_HEADER_SELECTOR) ||
    isFoldToggle(element)
  );
};

export type FindLiveControlsFunction = (root: Element) => Array<LiveControl>;

/*
 * Every control under root that could still change something: a form control
 * that is neither disabled nor a code box shown to be read, an editable box
 * that is no form control, and a widget the keyboard reaches that is no form
 * control (a grip, a chip) and neither says it is disabled nor read only.
 * What only reads a setting is left out.
 */
export const findLiveControls: FindLiveControlsFunction = (
  root: Element,
): Array<LiveControl> => {
  const live: Array<LiveControl> = [];

  for (const control of Array.from(
    root.querySelectorAll(FORM_CONTROL_SELECTOR),
  )) {
    if (
      control.matches(":disabled") ||
      control.matches(READ_ONLY_CODE_INPUT_SELECTOR) ||
      isReadingControl(control)
    ) {
      continue;
    }

    live.push({ kind: "form control", element: openingTag(control) });
  }

  for (const editable of Array.from(
    root.querySelectorAll('[contenteditable]:not([contenteditable="false"])'),
  )) {
    live.push({ kind: "editable text", element: openingTag(editable) });
  }

  for (const widget of Array.from(
    root.querySelectorAll('[tabindex]:not([tabindex="-1"])'),
  )) {
    if (
      widget.matches(FORM_CONTROL_SELECTOR) ||
      widget.matches("a[href]") ||
      widget.getAttribute("aria-disabled") === "true" ||
      widget.getAttribute("aria-readonly") === "true" ||
      isReadingControl(widget)
    ) {
      continue;
    }

    live.push({ kind: "keyboard widget", element: openingTag(widget) });
  }

  return live;
};

/*
 * A button that shows a setting rather than acting on it: a switch, or one
 * of a set of choices, pressed or not (a schedule's Common schedules or
 * Custom cron).
 */
const isStateButton: IsReadingControlFunction = (element: Element): boolean => {
  return (
    element.getAttribute("role") === "switch" ||
    element.hasAttribute("aria-pressed")
  );
};

export type FindActionsFunction = (root: Element) => Array<LiveControl>;

/*
 * Every button under root that only changes a setting - Add, Remove, Edit as
 * JSON, Clear, a way back to typing a value. A view draws none of them,
 * held still or not: a reader has no use for them, and drawn they look as
 * if they could be pressed. What is left reads a setting (a code box's
 * Copy, a fold) or shows one (a switch, a choice pressed or not).
 */
export const findActionsAViewDraws: FindActionsFunction = (
  root: Element,
): Array<LiveControl> => {
  const actions: Array<LiveControl> = [];

  for (const button of Array.from(
    root.querySelectorAll('button, [role="button"]'),
  )) {
    if (isReadingControl(button) || isStateButton(button)) {
      continue;
    }

    actions.push({ kind: "action", element: openingTag(button) });
  }

  return actions;
};

export type IsHeldStillFunction = (element: Element) => boolean;

/*
 * Whether the pointer or the browser holds an element still: it is inside a
 * disabled fieldset, or under something the pointer goes through.
 */
export const isHeldStill: IsHeldStillFunction = (element: Element): boolean => {
  return Boolean(
    element.closest("fieldset:disabled") ||
      element.closest(".pointer-events-none"),
  );
};
