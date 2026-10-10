/*
 * The conversation replay's keyboard: the keys session replay uses for the
 * same things, so one habit works in both players.
 *
 *   Space or K   play / pause
 *   Left or J    previous message
 *   Right or L   next message
 *   Home         back to the first message
 *   End          the whole conversation
 *
 * A key typed into a field, pressed with a modifier, or pressed on a
 * control that has its own meaning for it (Space on a button) is never
 * taken: the shortcut must not eat what the person is doing.
 */

export type LlmReplayKeyAction =
  | "toggle"
  | "previous"
  | "next"
  | "restart"
  | "end";

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

// Controls that act on Space / Enter themselves.
const ACTIVATING_TAGS: ReadonlySet<string> = new Set<string>([
  "BUTTON",
  "A",
  "SUMMARY",
]);

const ACTIVATING_ROLES: ReadonlySet<string> = new Set<string>([
  "button",
  "switch",
  "checkbox",
  "menuitem",
  "link",
  "tab",
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

  const key: string = event.key;

  if (key === " " || key === "Spacebar") {
    const role: string = (event.targetRole || "").toLowerCase();

    if (ACTIVATING_TAGS.has(tag) || ACTIVATING_ROLES.has(role)) {
      return null;
    }

    return "toggle";
  }

  switch (key) {
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
    case "Home":
      return "restart";
    case "End":
      return "end";
    default:
      return null;
  }
}
