import { describe, expect, test } from "@jest/globals";
import {
  REPLAY_KEY_SEEK_ARROW_MS,
  REPLAY_KEY_SEEK_FINE_MS,
  REPLAY_KEY_SEEK_JL_MS,
  REPLAY_KEY_SEEK_PAGE_MS,
  REPLAY_KEY_SEEK_SHIFT_ARROW_MS,
  REPLAY_SHORTCUT_GROUPS,
  ReplayKeyInput,
  ReplayKeyTargetKind,
  ReplayKeyboardAction,
  ReplayShortcutDescription,
  ReplayShortcutGroup,
  getReplayKeyTargetKind,
  isCoalescingReplayAction,
  resolveReplayKeyboardAction,
  resolveReplaySliderKey,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayKeyboardMap";

/*
 * The keyboard vocabulary is a pure table, so it is tested as one: every
 * documented key maps to its action and delta, the three rules the old
 * scrubber broke (focused buttons, modifier chords, auto-repeat) are
 * pinned, and the "?" sheet's data covers every action.
 */

function resolve(
  key: string,
  overrides?: Partial<ReplayKeyInput>,
): ReplayKeyboardAction | null {
  return resolveReplayKeyboardAction({ key: key, ...overrides });
}

describe("resolveReplayKeyboardAction: the documented vocabulary", () => {
  const table: Array<[string, Partial<ReplayKeyInput>, ReplayKeyboardAction]> =
    [
      [" ", {}, { type: "play-pause" }],
      ["k", {}, { type: "play-pause" }],
      ["j", {}, { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_JL_MS }],
      ["l", {}, { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_JL_MS }],
      [
        "ArrowLeft",
        {},
        { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_ARROW_MS },
      ],
      [
        "ArrowRight",
        {},
        { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_ARROW_MS },
      ],
      [
        "ArrowLeft",
        { shiftKey: true },
        { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_SHIFT_ARROW_MS },
      ],
      [
        "ArrowRight",
        { shiftKey: true },
        { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_SHIFT_ARROW_MS },
      ],
      [",", {}, { type: "seek-relative", deltaMs: -REPLAY_KEY_SEEK_FINE_MS }],
      [".", {}, { type: "seek-relative", deltaMs: REPLAY_KEY_SEEK_FINE_MS }],
      ["0", {}, { type: "seek-percent", percent: 0 }],
      ["5", {}, { type: "seek-percent", percent: 50 }],
      ["9", {}, { type: "seek-percent", percent: 90 }],
      ["Home", {}, { type: "seek-start" }],
      ["End", {}, { type: "seek-end" }],
      ["<", { shiftKey: true }, { type: "speed-step", direction: -1 }],
      [">", { shiftKey: true }, { type: "speed-step", direction: 1 }],
      ["s", {}, { type: "skip-idle-jump" }],
      ["S", { shiftKey: true }, { type: "toggle-skip-idle" }],
      ["e", {}, { type: "next-error" }],
      ["E", { shiftKey: true }, { type: "prev-error" }],
      ["n", {}, { type: "next-frustration" }],
      ["[", {}, { type: "prev-signal" }],
      ["]", {}, { type: "next-signal" }],
      ["f", {}, { type: "toggle-theater" }],
      ["w", {}, { type: "toggle-wide" }],
      ["m", {}, { type: "toggle-follow" }],
      ["/", {}, { type: "focus-rail-search" }],
      ["c", {}, { type: "copy-link" }],
      ["i", {}, { type: "toggle-details" }],
      ["?", { shiftKey: true }, { type: "show-shortcuts" }],
      ["Escape", {}, { type: "escape" }],
    ];

  test.each(table)(
    "key %p with %p resolves to %p",
    (
      key: string,
      overrides: Partial<ReplayKeyInput>,
      expected: ReplayKeyboardAction,
    ) => {
      expect(resolve(key, overrides)).toEqual(expected);
    },
  );

  test("an uppercase letter without shiftKey (Caps Lock) is the Shift variant", () => {
    expect(resolve("E")).toEqual({ type: "prev-error" });
    expect(resolve("S")).toEqual({ type: "toggle-skip-idle" });
  });

  test("unmapped keys are left to the browser", () => {
    expect(resolve("q")).toBeNull();
    expect(resolve("Tab")).toBeNull();
    expect(resolve("F5")).toBeNull();
    expect(resolve("")).toBeNull();
  });

  test("Shift variants that do not exist are not mistaken for the plain key", () => {
    expect(resolve("K", { shiftKey: true })).toBeNull();
    expect(resolve("J", { shiftKey: true })).toBeNull();
    expect(resolve("F", { shiftKey: true })).toBeNull();
  });
});

describe("resolveReplayKeyboardAction: focus rules", () => {
  test("text fields keep every key", () => {
    const keys: Array<string> = [
      " ",
      "k",
      "j",
      "ArrowLeft",
      ".",
      "?",
      "Escape",
    ];

    for (const key of keys) {
      expect(resolve(key, { targetKind: "editable" })).toBeNull();
    }
  });

  test("a focused button yields only Space and Enter; navigation keys still fire", () => {
    /*
     * Finding scrubber-devtools-1: clicking Play left the button focused
     * and every arrow key went dead until the user clicked elsewhere.
     */
    expect(resolve(" ", { targetKind: "button" })).toBeNull();
    expect(resolve("Enter", { targetKind: "button" })).toBeNull();
    expect(resolve("ArrowRight", { targetKind: "button" })).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_ARROW_MS,
    });
    expect(resolve(",", { targetKind: "button" })).toEqual({
      type: "seek-relative",
      deltaMs: -REPLAY_KEY_SEEK_FINE_MS,
    });
    expect(resolve("k", { targetKind: "button" })).toEqual({
      type: "play-pause",
    });
    expect(resolve("e", { targetKind: "button" })).toEqual({
      type: "next-error",
    });
  });

  test("the focused slider owns its own arrow/Home/End keys but nothing else", () => {
    expect(resolve("ArrowLeft", { targetKind: "slider" })).toBeNull();
    expect(resolve("Home", { targetKind: "slider" })).toBeNull();
    expect(resolve("PageUp", { targetKind: "slider" })).toBeNull();
    expect(resolve(" ", { targetKind: "slider" })).toEqual({
      type: "play-pause",
    });
    expect(resolve("j", { targetKind: "slider" })).toEqual({
      type: "seek-relative",
      deltaMs: -REPLAY_KEY_SEEK_JL_MS,
    });
  });
});

describe("resolveReplayKeyboardAction: modifiers and auto-repeat", () => {
  test("Alt, Ctrl and Meta chords are never consumed", () => {
    /* Alt+Left is Back on Windows/Linux; Cmd+C is copy; Ctrl+K the palette. */
    expect(resolve("ArrowLeft", { altKey: true })).toBeNull();
    expect(resolve("c", { metaKey: true })).toBeNull();
    expect(resolve("k", { ctrlKey: true })).toBeNull();
    expect(resolve(" ", { metaKey: true })).toBeNull();
  });

  test("one-shot actions ignore auto-repeat; seek deltas keep firing", () => {
    expect(resolve(" ", { repeat: true })).toBeNull();
    expect(resolve("k", { repeat: true })).toBeNull();
    expect(resolve("e", { repeat: true })).toBeNull();
    expect(resolve(">", { repeat: true, shiftKey: true })).toBeNull();
    expect(resolve("5", { repeat: true })).toBeNull();
    expect(resolve("?", { repeat: true, shiftKey: true })).toBeNull();

    expect(resolve("ArrowRight", { repeat: true })).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_ARROW_MS,
    });
    expect(resolve("j", { repeat: true })).toEqual({
      type: "seek-relative",
      deltaMs: -REPLAY_KEY_SEEK_JL_MS,
    });
  });

  test("only seek deltas are coalescing", () => {
    expect(
      isCoalescingReplayAction({ type: "seek-relative", deltaMs: 1000 }),
    ).toBe(true);
    expect(isCoalescingReplayAction({ type: "play-pause" })).toBe(false);
    expect(
      isCoalescingReplayAction({ type: "seek-percent", percent: 10 }),
    ).toBe(false);
  });
});

describe("resolveReplayKeyboardAction: rail scope", () => {
  test("j/k move rows, Enter seeks to the selection, Escape clears it", () => {
    expect(resolve("j", { scope: "rail" })).toEqual({ type: "rail-row-down" });
    expect(resolve("k", { scope: "rail" })).toEqual({ type: "rail-row-up" });
    expect(resolve("Enter", { scope: "rail" })).toEqual({
      type: "rail-seek-selected",
    });
    expect(resolve("Escape", { scope: "rail" })).toEqual({
      type: "rail-clear",
    });
  });

  test("held j/k keep moving; Enter and Escape are one-shot", () => {
    expect(resolve("j", { scope: "rail", repeat: true })).toEqual({
      type: "rail-row-down",
    });
    expect(resolve("Enter", { scope: "rail", repeat: true })).toBeNull();
  });

  test("the rest of the vocabulary is unchanged in the rail", () => {
    expect(resolve(" ", { scope: "rail" })).toEqual({ type: "play-pause" });
    expect(resolve("e", { scope: "rail" })).toEqual({ type: "next-error" });
    expect(resolve("ArrowRight", { scope: "rail" })).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_ARROW_MS,
    });
  });

  test("Enter on a focused rail row (a button) is the row's own click", () => {
    expect(
      resolve("Enter", { scope: "rail", targetKind: "button" }),
    ).toBeNull();
  });
});

describe("resolveReplaySliderKey", () => {
  test("implements the WAI-ARIA slider keys", () => {
    expect(resolveReplaySliderKey({ key: "ArrowLeft" })).toEqual({
      type: "seek-relative",
      deltaMs: -REPLAY_KEY_SEEK_ARROW_MS,
    });
    expect(resolveReplaySliderKey({ key: "ArrowUp" })).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_ARROW_MS,
    });
    expect(
      resolveReplaySliderKey({ key: "ArrowRight", shiftKey: true }),
    ).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_SHIFT_ARROW_MS,
    });
    expect(resolveReplaySliderKey({ key: "PageUp" })).toEqual({
      type: "seek-relative",
      deltaMs: REPLAY_KEY_SEEK_PAGE_MS,
    });
    expect(resolveReplaySliderKey({ key: "PageDown" })).toEqual({
      type: "seek-relative",
      deltaMs: -REPLAY_KEY_SEEK_PAGE_MS,
    });
    expect(resolveReplaySliderKey({ key: "Home" })).toEqual({
      type: "seek-start",
    });
    expect(resolveReplaySliderKey({ key: "End" })).toEqual({
      type: "seek-end",
    });
  });

  test("ignores modifier chords and unrelated keys", () => {
    expect(
      resolveReplaySliderKey({ key: "ArrowLeft", altKey: true }),
    ).toBeNull();
    expect(resolveReplaySliderKey({ key: " " })).toBeNull();
    expect(resolveReplaySliderKey({ key: "k" })).toBeNull();
  });
});

describe("getReplayKeyTargetKind", () => {
  interface FakeElement {
    tagName: string;
    isContentEditable?: boolean | undefined;
    attributes?: Record<string, string>;
    owner?: string | null;
    getAttribute: (name: string) => string | null;
    closest: (selector: string) => unknown;
  }

  function element(
    tagName: string,
    options?: {
      isContentEditable?: boolean | undefined;
      attributes?: Record<string, string>;
      owner?: string | null;
    },
  ): FakeElement {
    const attributes: Record<string, string> = options?.attributes || {};

    return {
      tagName: tagName,
      isContentEditable: options?.isContentEditable,
      getAttribute: (name: string): string | null => {
        return attributes[name] ?? null;
      },
      closest: (): unknown => {
        return options?.owner ? { tagName: options.owner } : null;
      },
    };
  }

  const cases: Array<[string, FakeElement, ReplayKeyTargetKind]> = [
    ["input", element("INPUT"), "editable"],
    ["textarea", element("TEXTAREA"), "editable"],
    ["select", element("SELECT"), "editable"],
    [
      "contentEditable div",
      element("DIV", { isContentEditable: true }),
      "editable",
    ],
    ["button", element("BUTTON"), "button"],
    ["link", element("A"), "button"],
    [
      "role=button div",
      element("DIV", { attributes: { role: "button" } }),
      "button",
    ],
    [
      "radio in the speed group",
      element("BUTTON", { attributes: { role: "radio" } }),
      "button",
    ],
    ["span inside a button", element("SPAN", { owner: "BUTTON" }), "button"],
    [
      "the slider track",
      element("DIV", { attributes: { role: "slider" } }),
      "slider",
    ],
    ["body", element("BODY"), "other"],
    [
      "a list container",
      element("DIV", { attributes: { role: "list" } }),
      "other",
    ],
  ];

  test.each(cases)(
    "%s",
    (_name: string, target: FakeElement, expected: ReplayKeyTargetKind) => {
      expect(getReplayKeyTargetKind(target)).toBe(expected);
    },
  );

  test("null, window-like and non-element targets are 'other'", () => {
    expect(getReplayKeyTargetKind(null)).toBe("other");
    expect(getReplayKeyTargetKind(undefined)).toBe("other");
    expect(getReplayKeyTargetKind({})).toBe("other");
  });
});

describe("REPLAY_SHORTCUT_GROUPS", () => {
  test("every group has a title and every shortcut a description and keys", () => {
    expect(REPLAY_SHORTCUT_GROUPS.length).toBeGreaterThanOrEqual(3);

    for (const group of REPLAY_SHORTCUT_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.shortcuts.length).toBeGreaterThan(0);

      for (const shortcut of group.shortcuts) {
        expect(shortcut.description.length).toBeGreaterThan(0);
        expect(shortcut.keys.length).toBeGreaterThan(0);

        for (const chord of shortcut.keys) {
          expect(chord.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("shortcut ids are unique across the sheet", () => {
    const ids: Array<string> = REPLAY_SHORTCUT_GROUPS.flatMap(
      (group: ReplayShortcutGroup): Array<string> => {
        return group.shortcuts.map((shortcut: ReplayShortcutDescription) => {
          return shortcut.id;
        });
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every single-character key on the sheet resolves to an action", () => {
    /*
     * The sheet is data next to the map, so a key documented here but not
     * handled there would be a lie the viewer discovers by pressing it.
     */
    for (const group of REPLAY_SHORTCUT_GROUPS) {
      for (const shortcut of group.shortcuts) {
        for (const chord of shortcut.keys) {
          const last: string | undefined = chord[chord.length - 1];
          const isShift: boolean = chord.includes("Shift");

          if (!last || last === "Shift" || last === "Enter") {
            continue;
          }

          const scope: "player" | "rail" = shortcut.id.startsWith("rail-")
            ? "rail"
            : "player";
          const keyValue: string =
            last === "Space"
              ? " "
              : last.length === 1
                ? isShift
                  ? last.toUpperCase()
                  : last.toLowerCase()
                : last;

          expect({
            id: shortcut.id,
            action: resolve(keyValue, { shiftKey: isShift, scope: scope }),
          }).toEqual(expect.objectContaining({ action: expect.anything() }));
        }
      }
    }
  });
});
