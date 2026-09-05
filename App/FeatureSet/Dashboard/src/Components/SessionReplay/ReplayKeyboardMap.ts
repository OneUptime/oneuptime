/*
 * The player's keyboard vocabulary as a pure table.
 *
 * A keydown becomes a ReplayKeyboardAction here and nowhere else, so the
 * window listener (ReplayScrubber), the ARIA slider (ReplayTimeline), the
 * "?" sheet (ReplayShortcutsModal) and the tests all read one map. Nothing
 * in this file touches React or the DOM beyond a duck-typed look at the
 * event target, which is what lets App/Tests run it in a node environment.
 *
 * Three rules the old scrubber got wrong, pinned by tests:
 *
 *  1. Focus on a BUTTON does not disable the shortcuts. Clicking Play, a
 *     marker, a tab or a rail row leaves that button focused, and the most
 *     common gesture in the product - click Play, tap ArrowRight - went
 *     dead. Only Space and Enter yield to a focused control (they activate
 *     it, and firing play/pause as well would double-fire); text fields
 *     keep every key.
 *  2. Modifier chords belong to the browser. Alt+Left is Back on Windows,
 *     Cmd+C is Copy, Ctrl+K is the command palette. Shift is ours (it is
 *     how "?" and ">" are typed), the other three are never consumed.
 *  3. Auto-repeat is not a click. Holding ArrowRight used to issue one
 *     Replayer rebuild per repeat; now one-shot actions ignore repeats and
 *     seek deltas are flagged so the listener can coalesce them into one
 *     seek on keyup.
 */

export type ReplayKeyboardScope = "player" | "rail";

/*
 * What has focus when the key arrives.
 *
 *   editable  input / textarea / select / contentEditable: never ours
 *   button    button / a / [role=button] / [role=menuitem]: Space + Enter
 *             activate it, the rest are ours
 *   slider    the timeline track: it owns the WAI-ARIA slider keys itself
 *   other     body, the stage, a list container: everything is ours
 */
export type ReplayKeyTargetKind = "editable" | "button" | "slider" | "other";

export type ReplayKeyboardAction =
  | { type: "play-pause" }
  | { type: "seek-relative"; deltaMs: number }
  | { type: "seek-percent"; percent: number }
  | { type: "seek-start" }
  | { type: "seek-end" }
  | { type: "speed-step"; direction: 1 | -1 }
  | { type: "skip-idle-jump" }
  | { type: "toggle-skip-idle" }
  | { type: "next-error" }
  | { type: "prev-error" }
  | { type: "next-frustration" }
  | { type: "next-signal" }
  | { type: "prev-signal" }
  | { type: "toggle-theater" }
  | { type: "toggle-wide" }
  | { type: "toggle-follow" }
  | { type: "focus-rail-search" }
  | { type: "copy-link" }
  | { type: "toggle-details" }
  | { type: "show-shortcuts" }
  | { type: "escape" }
  | { type: "rail-row-down" }
  | { type: "rail-row-up" }
  | { type: "rail-seek-selected" }
  | { type: "rail-clear" };

export type ReplayKeyboardActionType = ReplayKeyboardAction["type"];

export interface ReplayKeyInput {
  key: string;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  metaKey?: boolean | undefined;
  repeat?: boolean | undefined;
  targetKind?: ReplayKeyTargetKind | undefined;
  scope?: ReplayKeyboardScope | undefined;
}

/* Seek deltas, named so the sheet, the buttons and the tests quote one number. */
export const REPLAY_KEY_SEEK_FINE_MS: number = 1000;
export const REPLAY_KEY_SEEK_ARROW_MS: number = 5000;
export const REPLAY_KEY_SEEK_JL_MS: number = 10000;
export const REPLAY_KEY_SEEK_SHIFT_ARROW_MS: number = 30000;
/* PageUp / PageDown on the focused slider, per the WAI-ARIA slider pattern. */
export const REPLAY_KEY_SEEK_PAGE_MS: number = 60000;

/* The keys the focused slider handles itself; the global map yields them. */
const SLIDER_OWNED_KEYS: ReadonlySet<string> = new Set<string>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/* Keys that ACTIVATE a focused control and so must not also reach us. */
const ACTIVATION_KEYS: ReadonlySet<string> = new Set<string>([" ", "Enter"]);

/*
 * Classify an event target without depending on DOM globals, so the same
 * function runs under jsdom and in a node test with a plain object.
 */
interface ElementLike {
  tagName?: unknown;
  isContentEditable?: unknown;
  getAttribute?: unknown;
  closest?: unknown;
}

function readAttribute(element: ElementLike, name: string): string | null {
  if (typeof element.getAttribute !== "function") {
    return null;
  }

  const value: unknown = (
    element.getAttribute as (attributeName: string) => unknown
  )(name);

  return typeof value === "string" ? value : null;
}

export function getReplayKeyTargetKind(
  target: EventTarget | ElementLike | null | undefined,
): ReplayKeyTargetKind {
  if (!target || typeof target !== "object") {
    return "other";
  }

  const element: ElementLike = target as ElementLike;

  if (typeof element.tagName !== "string") {
    return "other";
  }

  const tag: string = element.tagName.toLowerCase();

  if (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable === true
  ) {
    return "editable";
  }

  const role: string | null = readAttribute(element, "role");

  if (role === "slider") {
    return "slider";
  }

  if (
    tag === "button" ||
    tag === "a" ||
    role === "button" ||
    role === "menuitem" ||
    role === "menuitemradio" ||
    role === "radio" ||
    role === "tab" ||
    role === "checkbox" ||
    role === "switch"
  ) {
    return "button";
  }

  /*
   * A span inside a button still activates the button on Space, so look
   * up the tree for one - but only for the activation question. A row
   * that is a <div role="listitem"> with a nested link is "other".
   */
  if (typeof element.closest === "function") {
    const owner: unknown = (element.closest as (selector: string) => unknown)(
      "button, a, [role='button'], [role='menuitem'], [role='radio']",
    );

    if (owner) {
      return "button";
    }
  }

  return "other";
}

/*
 * Whether a resolved action should be merged with the ones before it while
 * the key is held. Seeks are; everything else fires once per press.
 */
export function isCoalescingReplayAction(
  action: ReplayKeyboardAction,
): boolean {
  return action.type === "seek-relative";
}

/* A single character with a case distinction is a letter; no regex needed. */
function isLetter(key: string): boolean {
  return key.length === 1 && key.toLowerCase() !== key.toUpperCase();
}

function isDigit(key: string): boolean {
  return key.length === 1 && key >= "0" && key <= "9";
}

/*
 * Resolve one keydown. Returns null when the key is not ours or must not
 * fire right now; the caller then does NOT preventDefault, so the browser
 * keeps its own behaviour.
 */
export function resolveReplayKeyboardAction(
  input: ReplayKeyInput,
): ReplayKeyboardAction | null {
  if (input.altKey || input.ctrlKey || input.metaKey) {
    return null;
  }

  const targetKind: ReplayKeyTargetKind = input.targetKind || "other";

  if (targetKind === "editable") {
    return null;
  }

  const key: string = input.key;

  if (typeof key !== "string" || key.length === 0) {
    return null;
  }

  if (targetKind === "button" && ACTIVATION_KEYS.has(key)) {
    return null;
  }

  if (targetKind === "slider" && SLIDER_OWNED_KEYS.has(key)) {
    return null;
  }

  /*
   * Shift+s arrives as key "S". Caps Lock also yields "S" without
   * shiftKey; treating any uppercase letter as the Shift variant is the
   * behaviour a viewer with Caps Lock on can at least predict.
   */
  const isShift: boolean =
    Boolean(input.shiftKey) || (isLetter(key) && key !== key.toLowerCase());
  const letter: string = isLetter(key) ? key.toLowerCase() : key;
  const isRepeat: boolean = Boolean(input.repeat);
  const scope: ReplayKeyboardScope = input.scope || "player";

  /* Repeats only ever mean "keep seeking"; every other action is one-shot. */
  const oneShot: (
    action: ReplayKeyboardAction,
  ) => ReplayKeyboardAction | null = (
    action: ReplayKeyboardAction,
  ): ReplayKeyboardAction | null => {
    return isRepeat ? null : action;
  };

  if (scope === "rail") {
    if (letter === "j" && !isShift) {
      return { type: "rail-row-down" };
    }

    if (letter === "k" && !isShift) {
      return { type: "rail-row-up" };
    }

    if (key === "Enter") {
      return oneShot({ type: "rail-seek-selected" });
    }

    if (key === "Escape") {
      return oneShot({ type: "rail-clear" });
    }
  }

  switch (key) {
    case " ":
      return oneShot({ type: "play-pause" });
    case "ArrowLeft":
      return {
        type: "seek-relative",
        deltaMs: isShift
          ? -REPLAY_KEY_SEEK_SHIFT_ARROW_MS
          : -REPLAY_KEY_SEEK_ARROW_MS,
      };
    case "ArrowRight":
      return {
        type: "seek-relative",
        deltaMs: isShift
          ? REPLAY_KEY_SEEK_SHIFT_ARROW_MS
          : REPLAY_KEY_SEEK_ARROW_MS,
      };
    case ",":
      return { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_FINE_MS };
    case ".":
      return { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_FINE_MS };
    case "<":
      return oneShot({ type: "speed-step", direction: -1 });
    case ">":
      return oneShot({ type: "speed-step", direction: 1 });
    case "Home":
      return oneShot({ type: "seek-start" });
    case "End":
      return oneShot({ type: "seek-end" });
    case "[":
      return oneShot({ type: "prev-signal" });
    case "]":
      return oneShot({ type: "next-signal" });
    case "/":
      return oneShot({ type: "focus-rail-search" });
    case "?":
      return oneShot({ type: "show-shortcuts" });
    case "Escape":
      return oneShot({ type: "escape" });
    default:
      break;
  }

  if (isDigit(key)) {
    return oneShot({ type: "seek-percent", percent: Number(key) * 10 });
  }

  if (!isLetter(key)) {
    return null;
  }

  switch (letter) {
    case "k":
      return isShift ? null : oneShot({ type: "play-pause" });
    case "j":
      return isShift
        ? null
        : { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_JL_MS };
    case "l":
      return isShift
        ? null
        : { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_JL_MS };
    case "s":
      return oneShot(
        isShift ? { type: "toggle-skip-idle" } : { type: "skip-idle-jump" },
      );
    case "e":
      return oneShot(isShift ? { type: "prev-error" } : { type: "next-error" });
    case "n":
      return isShift ? null : oneShot({ type: "next-frustration" });
    case "f":
      return isShift ? null : oneShot({ type: "toggle-theater" });
    case "w":
      return isShift ? null : oneShot({ type: "toggle-wide" });
    case "m":
      return isShift ? null : oneShot({ type: "toggle-follow" });
    case "c":
      return isShift ? null : oneShot({ type: "copy-link" });
    case "i":
      return isShift ? null : oneShot({ type: "toggle-details" });
    default:
      return null;
  }
}

/*
 * The WAI-ARIA slider keys for the focused track. Separate from the global
 * map because the slider must answer these whenever it has focus, even
 * when the page-level shortcuts are switched off (a modal is open, the
 * rail search has focus elsewhere). Returns the signed delta, or a
 * percent target for Home/End, or null.
 */
export type ReplaySliderKeyAction =
  | { type: "seek-relative"; deltaMs: number }
  | { type: "seek-start" }
  | { type: "seek-end" };

export function resolveReplaySliderKey(
  input: ReplayKeyInput,
): ReplaySliderKeyAction | null {
  if (input.altKey || input.ctrlKey || input.metaKey) {
    return null;
  }

  const isShift: boolean = Boolean(input.shiftKey);

  switch (input.key) {
    case "ArrowLeft":
    case "ArrowDown":
      return {
        type: "seek-relative",
        deltaMs: isShift
          ? -REPLAY_KEY_SEEK_SHIFT_ARROW_MS
          : -REPLAY_KEY_SEEK_ARROW_MS,
      };
    case "ArrowRight":
    case "ArrowUp":
      return {
        type: "seek-relative",
        deltaMs: isShift
          ? REPLAY_KEY_SEEK_SHIFT_ARROW_MS
          : REPLAY_KEY_SEEK_ARROW_MS,
      };
    case "PageDown":
      return { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_PAGE_MS };
    case "PageUp":
      return { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_PAGE_MS };
    case "Home":
      return { type: "seek-start" };
    case "End":
      return { type: "seek-end" };
    default:
      return null;
  }
}

/*
 * The "?" sheet, as data. Key names match Common/UI's KeyboardKey values
 * ("Space", "Shift", "ArrowLeft"...) so ReplayShortcutsModal passes them
 * straight through; single characters render as their keycap.
 */
export interface ReplayShortcutDescription {
  id: string;
  keys: Array<Array<string>>;
  description: string;
}

export interface ReplayShortcutGroup {
  id: string;
  title: string;
  shortcuts: Array<ReplayShortcutDescription>;
}

export const REPLAY_SHORTCUT_GROUPS: Array<ReplayShortcutGroup> = [
  {
    id: "playback",
    title: "Playback",
    shortcuts: [
      { id: "play-pause", keys: [["Space"]], description: "Play or pause" },
      {
        id: "play-pause-k",
        keys: [["K"]],
        description: "Play or pause (video-player style)",
      },
      { id: "back-10", keys: [["J"]], description: "Back 10 seconds" },
      { id: "forward-10", keys: [["L"]], description: "Forward 10 seconds" },
      {
        id: "back-5",
        keys: [["ArrowLeft"]],
        description: "Back 5 seconds",
      },
      {
        id: "forward-5",
        keys: [["ArrowRight"]],
        description: "Forward 5 seconds",
      },
      {
        id: "back-30",
        keys: [["Shift", "ArrowLeft"]],
        description: "Back 30 seconds",
      },
      {
        id: "forward-30",
        keys: [["Shift", "ArrowRight"]],
        description: "Forward 30 seconds",
      },
      { id: "back-1", keys: [[","]], description: "Back 1 second" },
      { id: "forward-1", keys: [["."]], description: "Forward 1 second" },
      {
        id: "seek-percent",
        keys: [["0"], ["9"]],
        description: "Jump to 0% through 90% of the session",
      },
      { id: "seek-start", keys: [["Home"]], description: "Jump to the start" },
      { id: "seek-end", keys: [["End"]], description: "Jump to the end" },
      { id: "speed-down", keys: [["<"]], description: "Slower" },
      { id: "speed-up", keys: [[">"]], description: "Faster" },
      {
        id: "skip-idle-jump",
        keys: [["S"]],
        description: "Skip past the current idle stretch",
      },
      {
        id: "toggle-skip-idle",
        keys: [["Shift", "S"]],
        description: "Toggle skipping idle time",
      },
    ],
  },
  {
    id: "signals",
    title: "Signals",
    shortcuts: [
      { id: "next-error", keys: [["E"]], description: "Next error" },
      {
        id: "prev-error",
        keys: [["Shift", "E"]],
        description: "Previous error",
      },
      {
        id: "next-frustration",
        keys: [["N"]],
        description: "Next frustration",
      },
      {
        id: "prev-signal",
        keys: [["["]],
        description: "Previous row in the current rail tab",
      },
      {
        id: "next-signal",
        keys: [["]"]],
        description: "Next row in the current rail tab",
      },
      {
        id: "rail-row-down",
        keys: [["J"]],
        description: "Next rail row (when the rail has focus)",
      },
      {
        id: "rail-row-up",
        keys: [["K"]],
        description: "Previous rail row (when the rail has focus)",
      },
      {
        id: "rail-seek",
        keys: [["Enter"]],
        description: "Seek to the selected rail row",
      },
      {
        id: "rail-clear",
        keys: [["Escape"]],
        description: "Clear the selection",
      },
    ],
  },
  {
    id: "view",
    title: "View",
    shortcuts: [
      { id: "theater", keys: [["F"]], description: "Theater mode" },
      { id: "wide", keys: [["W"]], description: "Wide layout" },
      {
        id: "follow",
        keys: [["M"]],
        description: "Follow the playhead in the rail",
      },
      { id: "rail-search", keys: [["/"]], description: "Search the rail" },
      {
        id: "copy-link",
        keys: [["C"]],
        description: "Copy a link to this moment",
      },
      { id: "details", keys: [["I"]], description: "Session details" },
      { id: "shortcuts", keys: [["?"]], description: "This sheet" },
      { id: "escape", keys: [["Escape"]], description: "Close" },
    ],
  },
];
