/**
 * The plumbing behind single-key global shortcuts — "?" for the shortcuts
 * dialog, and "g then <key>" to jump between pages.
 *
 * Chorded shortcuts (Cmd/Ctrl+K) can be bound naively because they never
 * collide with typing. Single-key ones can: every letter a shortcut claims is
 * a letter someone is also trying to type into a search box, a note, or a
 * YAML editor. Everything in this module exists to decide, from an event
 * alone, whether a keypress was meant for the page or for the app — and it is
 * kept free of React so both halves can be pinned by tests.
 */

/**
 * The parts of a KeyboardEvent a global shortcut actually reads. Widened to an
 * interface so the guards below can be exercised without synthesising DOM
 * events.
 */
export interface KeyboardEventLike {
  key: string;
  metaKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  altKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  defaultPrevented?: boolean | undefined;
  target?: EventTarget | null | undefined;
}

/**
 * Shape we duck-type an event target into. Every field is optional because a
 * target may be the document, the window, or a plain object in a test.
 */
interface ElementLike {
  tagName?: string | undefined;
  isContentEditable?: boolean | undefined;
  getAttribute?: ((name: string) => string | null) | undefined;
}

/**
 * How long the leader key stays armed. Long enough that "g" and "i" can be
 * two deliberate presses rather than a chord, short enough that a "g" typed
 * and then abandoned does not turn the next keystroke into a navigation.
 */
export const KEYBOARD_SEQUENCE_TIMEOUT_IN_MS: number = 1500;

/**
 * True when the keypress landed somewhere the user is composing text, and so
 * belongs to that field rather than to the app.
 *
 * SELECT is included deliberately: a native select does its own type-ahead,
 * and stealing those letters would break jumping to an option by name.
 */
export function isTextEntryTarget(
  target: EventTarget | null | undefined,
): boolean {
  if (!target) {
    return false;
  }

  const element: ElementLike = target as ElementLike;
  const tagName: string = (element.tagName || "").toUpperCase();

  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (element.isContentEditable === true) {
    return true;
  }

  /*
   * jsdom does not implement isContentEditable (it is always undefined), and
   * some editors set the attribute on a wrapper rather than the focused node.
   * The attribute is the reliable half of the pair.
   */
  if (typeof element.getAttribute === "function") {
    const attribute: string | null = element.getAttribute("contenteditable");

    if (attribute !== null && attribute !== "false") {
      return true;
    }
  }

  return false;
}

/**
 * True when a modal dialog is on screen. Global shortcuts stand down while one
 * is open: navigating the page out from under a dialog the user is still
 * filling in would discard their work without asking.
 *
 * The selector is the same one Modal itself uses to find the topmost dialog,
 * so anything that reads as modal to assistive tech reads as modal here.
 */
export function hasOpenModalDialog(
  root: ParentNode | null | undefined,
): boolean {
  if (!root) {
    return false;
  }

  return root.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * The shared gate for every single-key global shortcut: the key must be
 * unmodified (a chord belongs to whoever bound that chord), unclaimed by
 * another handler, and pressed outside a text field.
 *
 * Shift is deliberately not rejected — "?" is Shift+/ on most layouts, and the
 * event already reports the shifted `key`.
 */
export function shouldIgnoreGlobalKeyPress(event: KeyboardEventLike): boolean {
  if (
    event.metaKey === true ||
    event.ctrlKey === true ||
    event.altKey === true
  ) {
    return true;
  }

  if (event.defaultPrevented === true) {
    return true;
  }

  return isTextEntryTarget(event.target);
}

// ---- leader-key sequences ---------------------------------------------------

export enum KeyboardSequenceOutcome {
  /** The leader key was pressed. The next key in time completes the sequence. */
  Armed = "Armed",
  /** A key arrived while armed and within the timeout. */
  Completed = "Completed",
  /** Not part of a sequence — the caller should do nothing. */
  Ignored = "Ignored",
}

export interface KeyboardSequenceState {
  /** When the leader was pressed, in epoch ms. `null` means "not armed". */
  leaderPressedAt: number | null;
}

export interface KeyboardSequenceResult {
  outcome: KeyboardSequenceOutcome;
  /** The state to carry into the next keypress. */
  state: KeyboardSequenceState;
  /** The completing key, lowercased. Only set when the outcome is Completed. */
  key: string | null;
}

export const EMPTY_KEYBOARD_SEQUENCE_STATE: KeyboardSequenceState = {
  leaderPressedAt: null,
};

/**
 * One step of a "leader then key" sequence, as a pure function of the previous
 * state and the key just pressed.
 *
 * Written as a reducer rather than a stateful class so the interesting cases —
 * an expired leader, a repeated leader, a key with no leader before it — are
 * ordinary function calls in a test instead of timer choreography.
 */
export function reduceKeyboardSequence(input: {
  state: KeyboardSequenceState;
  key: string;
  now: number;
  leaderKey: string;
  timeoutInMs: number;
}): KeyboardSequenceResult {
  const key: string = input.key.toLowerCase();
  const leaderKey: string = input.leaderKey.toLowerCase();

  const isArmed: boolean =
    input.state.leaderPressedAt !== null &&
    input.now - input.state.leaderPressedAt <= input.timeoutInMs;

  /*
   * A second leader press re-arms rather than completing. "g" is the one key
   * that cannot be a destination, so treating "g g h" as "go home" is both the
   * only sensible reading and the forgiving one.
   */
  if (key === leaderKey) {
    return {
      outcome: KeyboardSequenceOutcome.Armed,
      state: { leaderPressedAt: input.now },
      key: null,
    };
  }

  if (isArmed) {
    return {
      outcome: KeyboardSequenceOutcome.Completed,
      state: EMPTY_KEYBOARD_SEQUENCE_STATE,
      key: key,
    };
  }

  /*
   * Either no leader, or one that timed out. Both disarm: a stale leader must
   * not survive to pair with a keystroke a second later.
   */
  return {
    outcome: KeyboardSequenceOutcome.Ignored,
    state: EMPTY_KEYBOARD_SEQUENCE_STATE,
    key: null,
  };
}
