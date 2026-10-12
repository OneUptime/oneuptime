/*
 * The conversation replay's keyboard:
 *
 *   K              play / pause
 *   J or Left      previous message
 *   L or Right     next message
 *
 * A conversation is a page people read and scroll, so the keys a reader
 * scrolls with - Space, Home, End, Up, Down, Page Up and Page Down - keep
 * doing that. A key typed into a field, pressed with a modifier, or pressed
 * on a control that has its own meaning for it (an arrow on a slider or a
 * menu) is never taken: the shortcut must not eat what the person is doing.
 */

export type LlmReplayKeyAction = "toggle" | "previous" | "next";

export interface LlmReplayKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  // The focused element.
  targetTagName: string;
  targetRole: string;
  targetIsContentEditable: boolean;
}

const TYPING_TAGS: ReadonlySet<string> = new Set<string>([
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

// Controls that move with the arrow keys themselves.
const ARROW_ROLES: ReadonlySet<string> = new Set<string>([
  "slider",
  "menu",
  "menuitem",
  "listbox",
  "option",
  "tab",
  "tablist",
  "radio",
  "radiogroup",
  "combobox",
  "spinbutton",
]);

export function getLlmReplayKeyAction(
  event: LlmReplayKeyEvent,
): LlmReplayKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  const tag: string = (event.targetTagName || "").toUpperCase();

  if (TYPING_TAGS.has(tag) || event.targetIsContentEditable) {
    return null;
  }

  const role: string = (event.targetRole || "").toLowerCase();
  const isArrow: boolean =
    event.key === "ArrowLeft" || event.key === "ArrowRight";

  if (isArrow && ARROW_ROLES.has(role)) {
    return null;
  }

  switch (event.key) {
    case "k":
    case "K":
      return "toggle";
    case "ArrowLeft":
    case "j":
    case "J":
      return "previous";
    case "ArrowRight":
    case "l":
    case "L":
      return "next";
    default:
      return null;
  }
}
