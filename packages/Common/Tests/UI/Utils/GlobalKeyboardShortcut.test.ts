import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  hasOpenModalDialog,
  isTextEntryTarget,
  KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
  KeyboardEventLike,
  KeyboardSequenceOutcome,
  KeyboardSequenceResult,
  KeyboardSequenceState,
  reduceKeyboardSequence,
  shouldIgnoreGlobalKeyPress,
} from "../../../UI/Utils/GlobalKeyboardShortcut";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * WHY THIS FILE EXISTS
 *
 * Single-key shortcuts ("?" and the "g then <key>" jumps) are the one class of
 * binding that can steal a keystroke someone meant for the page. Every guard
 * in GlobalKeyboardShortcut exists to stop that, and each of them is a silent
 * failure if it regresses: the shortcut keeps working, and typing "g" into a
 * note quietly navigates away instead.
 *
 * So the guards are pinned individually rather than through the component that
 * calls them.
 */

function keyEvent(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    key: "g",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  };
}

function element(
  tagName: string,
  attributes?: Record<string, string>,
): HTMLElement {
  const created: HTMLElement = document.createElement(tagName);

  for (const name of Object.keys(attributes || {})) {
    created.setAttribute(name, (attributes || {})[name] as string);
  }

  return created;
}

describe("isTextEntryTarget", () => {
  it("claims nothing when there is no target at all", () => {
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(undefined)).toBe(false);
  });

  it("treats a text input as text entry", () => {
    expect(isTextEntryTarget(element("input"))).toBe(true);
  });

  it("treats a textarea as text entry", () => {
    expect(isTextEntryTarget(element("textarea"))).toBe(true);
  });

  it("treats a native select as text entry, because it has its own type-ahead", () => {
    /*
     * A select jumps to an option by first letter. Claiming those letters for
     * navigation would break jumping to "Monitors" by typing "m".
     */
    expect(isTextEntryTarget(element("select"))).toBe(true);
  });

  it("treats a contenteditable element as text entry", () => {
    /*
     * jsdom never sets isContentEditable, so this is exactly the case the
     * attribute fallback exists for — and the case a code editor or rich note
     * field actually hits in the product.
     */
    expect(isTextEntryTarget(element("div", { contenteditable: "true" }))).toBe(
      true,
    );
  });

  it("accepts the bare contenteditable attribute, which is the same as true", () => {
    expect(isTextEntryTarget(element("div", { contenteditable: "" }))).toBe(
      true,
    );
  });

  it('does not treat contenteditable="false" as text entry', () => {
    expect(
      isTextEntryTarget(element("div", { contenteditable: "false" })),
    ).toBe(false);
  });

  it("leaves an ordinary element alone", () => {
    expect(isTextEntryTarget(element("div"))).toBe(false);
    expect(isTextEntryTarget(element("button"))).toBe(false);
  });

  it("reads isContentEditable when the platform does provide it", () => {
    // A plain object stands in for a browser that implements the property.
    expect(
      isTextEntryTarget({ isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  it("matches the tag name whatever its case", () => {
    expect(
      isTextEntryTarget({ tagName: "input" } as unknown as EventTarget),
    ).toBe(true);
  });
});

describe("hasOpenModalDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds nothing in an empty document", () => {
    expect(hasOpenModalDialog(document)).toBe(false);
  });

  it("finds an open modal dialog", () => {
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true">A form</div>';

    expect(hasOpenModalDialog(document)).toBe(true);
  });

  it("ignores a non-modal dialog, which is what a SideOver is", () => {
    /*
     * SideOver renders role="dialog" WITHOUT aria-modal on purpose — the page
     * behind it is still live. Shortcuts should stay live with it.
     */
    document.body.innerHTML = '<div role="dialog">A side panel</div>';

    expect(hasOpenModalDialog(document)).toBe(false);
  });

  it("survives a missing root rather than throwing", () => {
    expect(hasOpenModalDialog(null)).toBe(false);
    expect(hasOpenModalDialog(undefined)).toBe(false);
  });
});

describe("shouldIgnoreGlobalKeyPress", () => {
  it("lets an ordinary unmodified keypress through", () => {
    expect(shouldIgnoreGlobalKeyPress(keyEvent({}))).toBe(false);
  });

  it("ignores a keypress held with the meta key, which belongs to a chord", () => {
    expect(shouldIgnoreGlobalKeyPress(keyEvent({ metaKey: true }))).toBe(true);
  });

  it("ignores a keypress held with control", () => {
    expect(shouldIgnoreGlobalKeyPress(keyEvent({ ctrlKey: true }))).toBe(true);
  });

  it("ignores a keypress held with alt", () => {
    expect(shouldIgnoreGlobalKeyPress(keyEvent({ altKey: true }))).toBe(true);
  });

  it("allows shift, because '?' is Shift+/ on most layouts", () => {
    expect(
      shouldIgnoreGlobalKeyPress(keyEvent({ key: "?", shiftKey: true })),
    ).toBe(false);
  });

  it("ignores an event another handler already claimed", () => {
    expect(
      shouldIgnoreGlobalKeyPress(keyEvent({ defaultPrevented: true })),
    ).toBe(true);
  });

  it("ignores a keypress made while typing into a field", () => {
    expect(
      shouldIgnoreGlobalKeyPress(keyEvent({ target: element("input") })),
    ).toBe(true);
  });
});

describe("reduceKeyboardSequence", () => {
  const leaderKey: string = "g";

  function reduce(
    state: KeyboardSequenceState,
    key: string,
    now: number,
  ): KeyboardSequenceResult {
    return reduceKeyboardSequence({
      state: state,
      key: key,
      now: now,
      leaderKey: leaderKey,
      timeoutInMs: KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
    });
  }

  it("arms on the leader key and remembers when", () => {
    const result: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );

    expect(result.outcome).toBe(KeyboardSequenceOutcome.Armed);
    expect(result.state.leaderPressedAt).toBe(1_000);
    expect(result.key).toBeNull();
  });

  it("completes on the next key while armed, and reports it", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const completed: KeyboardSequenceResult = reduce(armed.state, "i", 1_200);

    expect(completed.outcome).toBe(KeyboardSequenceOutcome.Completed);
    expect(completed.key).toBe("i");
  });

  it("disarms once a sequence completes, so the key after it is ordinary typing", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const completed: KeyboardSequenceResult = reduce(armed.state, "i", 1_100);
    const next: KeyboardSequenceResult = reduce(completed.state, "m", 1_150);

    expect(next.outcome).toBe(KeyboardSequenceOutcome.Ignored);
    expect(next.key).toBeNull();
  });

  it("ignores a key with no leader before it", () => {
    const result: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "i",
      1_000,
    );

    expect(result.outcome).toBe(KeyboardSequenceOutcome.Ignored);
    expect(result.state.leaderPressedAt).toBeNull();
  });

  it("ignores a key that arrives after the leader has expired", () => {
    /*
     * The case that matters: someone types "g" in passing, gets distracted,
     * and comes back two seconds later. The next letter must be theirs, not
     * a navigation.
     */
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const late: KeyboardSequenceResult = reduce(
      armed.state,
      "i",
      1_000 + KEYBOARD_SEQUENCE_TIMEOUT_IN_MS + 1,
    );

    expect(late.outcome).toBe(KeyboardSequenceOutcome.Ignored);
    expect(late.state.leaderPressedAt).toBeNull();
  });

  it("still completes at exactly the timeout boundary", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const onTheEdge: KeyboardSequenceResult = reduce(
      armed.state,
      "i",
      1_000 + KEYBOARD_SEQUENCE_TIMEOUT_IN_MS,
    );

    expect(onTheEdge.outcome).toBe(KeyboardSequenceOutcome.Completed);
  });

  it("re-arms rather than completing when the leader is pressed twice", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const rearmed: KeyboardSequenceResult = reduce(armed.state, "g", 1_400);

    expect(rearmed.outcome).toBe(KeyboardSequenceOutcome.Armed);
    // The clock restarts, so "g g <key>" is as forgiving as "g <key>".
    expect(rearmed.state.leaderPressedAt).toBe(1_400);

    const completed: KeyboardSequenceResult = reduce(rearmed.state, "h", 1_600);
    expect(completed.outcome).toBe(KeyboardSequenceOutcome.Completed);
    expect(completed.key).toBe("h");
  });

  it("re-arms on a leader pressed after the previous one expired", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "g",
      1_000,
    );
    const rearmed: KeyboardSequenceResult = reduce(armed.state, "g", 50_000);

    expect(rearmed.outcome).toBe(KeyboardSequenceOutcome.Armed);
    expect(rearmed.state.leaderPressedAt).toBe(50_000);
  });

  it("lowercases the completing key, so caps lock does not break a shortcut", () => {
    const armed: KeyboardSequenceResult = reduce(
      EMPTY_KEYBOARD_SEQUENCE_STATE,
      "G",
      1_000,
    );

    expect(armed.outcome).toBe(KeyboardSequenceOutcome.Armed);

    const completed: KeyboardSequenceResult = reduce(armed.state, "I", 1_100);

    expect(completed.outcome).toBe(KeyboardSequenceOutcome.Completed);
    expect(completed.key).toBe("i");
  });

  it("never mutates the state it was handed", () => {
    const state: KeyboardSequenceState = { leaderPressedAt: 500 };

    reduce(state, "i", 600);

    expect(state.leaderPressedAt).toBe(500);
  });

  it("leaves the shared empty state untouched", () => {
    reduce(EMPTY_KEYBOARD_SEQUENCE_STATE, "g", 1_000);

    expect(EMPTY_KEYBOARD_SEQUENCE_STATE.leaderPressedAt).toBeNull();
  });
});
