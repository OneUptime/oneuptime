import { describe, expect, test } from "@jest/globals";
import {
  PlaylistPlayerKeyAction,
  PlaylistPlayerKeyInput,
  PlaylistPlayerShortcut,
  PlaylistPlayerShortcutGroup,
  getPlaylistPlayerKeyAction,
  getPlaylistPlayerShortcutGroups,
  isActivatedBySpace,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistPlayerKeys";

/*
 * The playlist player's keys as a pure table (issue #5235): Space pauses,
 * the arrows go on and back - the other way round on a page read right to
 * left - F is full screen, Escape leaves, ? lists them. A chord, a text
 * field, a key another handler took, an open dialog and a held key are the
 * page's; Space on a focused button presses the button.
 */

interface FakeElement {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute: (name: string) => string | null;
}

function element(
  tagName: string,
  attributes: Record<string, string> = {},
): FakeElement {
  return {
    tagName: tagName.toUpperCase(),
    getAttribute: (name: string): string | null => {
      return attributes[name] ?? null;
    },
  };
}

function press(
  key: string,
  overrides: Partial<PlaylistPlayerKeyInput> = {},
  options: { isRightToLeft?: boolean; isDialogOpen?: boolean } = {},
): PlaylistPlayerKeyAction | null {
  return getPlaylistPlayerKeyAction({
    event: {
      key: key,
      target: element("div") as unknown as EventTarget,
      ...overrides,
    },
    isRightToLeft: Boolean(options.isRightToLeft),
    isDialogOpen: Boolean(options.isDialogOpen),
  });
}

describe("what each key does", () => {
  test("Space pauses or plays", () => {
    expect(press(" ")).toBe(PlaylistPlayerKeyAction.TogglePause);
    expect(press("Spacebar")).toBe(PlaylistPlayerKeyAction.TogglePause);
  });

  test("the right arrow goes on and the left goes back", () => {
    expect(press("ArrowRight")).toBe(PlaylistPlayerKeyAction.Next);
    expect(press("ArrowLeft")).toBe(PlaylistPlayerKeyAction.Previous);
  });

  test("on a page read right to left, the left arrow goes on: the next dashboard's button is on the left", () => {
    expect(press("ArrowLeft", {}, { isRightToLeft: true })).toBe(
      PlaylistPlayerKeyAction.Next,
    );
    expect(press("ArrowRight", {}, { isRightToLeft: true })).toBe(
      PlaylistPlayerKeyAction.Previous,
    );
  });

  test("F is full screen, in either case", () => {
    expect(press("f")).toBe(PlaylistPlayerKeyAction.ToggleFullScreen);
    expect(press("F", { shiftKey: true })).toBe(
      PlaylistPlayerKeyAction.ToggleFullScreen,
    );
  });

  test("Escape leaves the player", () => {
    expect(press("Escape")).toBe(PlaylistPlayerKeyAction.Exit);
    expect(press("Esc")).toBe(PlaylistPlayerKeyAction.Exit);
  });

  test("? shows the keys, as Shift makes it", () => {
    expect(press("?", { shiftKey: true })).toBe(
      PlaylistPlayerKeyAction.ShowShortcuts,
    );
  });

  test("every other key is the page's", () => {
    for (const key of [
      "a",
      "k",
      "n",
      "p",
      "ArrowUp",
      "ArrowDown",
      "Enter",
      "Tab",
      "g",
      "/",
      "Home",
      "End",
    ]) {
      expect({ key, action: press(key) }).toEqual({ key, action: null });
    }
  });
});

describe("when a key is not the player's", () => {
  test("a chord is the browser's: Ctrl, Cmd or Alt held", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      for (const key of [" ", "ArrowRight", "ArrowLeft", "f", "Escape", "?"]) {
        expect({
          modifier,
          key,
          action: press(key, { [modifier]: true }),
        }).toEqual({
          modifier,
          key,
          action: null,
        });
      }
    }
  });

  test("a key another handler took", () => {
    expect(press(" ", { defaultPrevented: true })).toBeNull();
    expect(press("ArrowRight", { defaultPrevented: true })).toBeNull();
  });

  test("a key held down repeats nothing: one press, one step", () => {
    expect(press("ArrowRight", { repeat: true })).toBeNull();
    expect(press(" ", { repeat: true })).toBeNull();
    expect(press("f", { repeat: true })).toBeNull();
  });

  test("while a dialog is open, its own keys come first", () => {
    for (const key of [" ", "ArrowRight", "f", "Escape", "?"]) {
      expect(press(key, {}, { isDialogOpen: true })).toBeNull();
    }
  });

  test("in a text field, every key is typed", () => {
    for (const tag of ["input", "textarea", "select"]) {
      for (const key of [" ", "ArrowLeft", "f", "Escape", "?"]) {
        expect({
          tag,
          key,
          action: press(key, {
            target: element(tag) as unknown as EventTarget,
          }),
        }).toEqual({ tag, key, action: null });
      }
    }

    expect(
      press("f", {
        target: element("div", {
          contenteditable: "true",
        }) as unknown as EventTarget,
      }),
    ).toBeNull();
  });

  test("Space on a focused button presses the button; the other keys still drive the player", () => {
    const button: EventTarget = element("button") as unknown as EventTarget;

    expect(press(" ", { target: button })).toBeNull();
    expect(press("ArrowRight", { target: button })).toBe(
      PlaylistPlayerKeyAction.Next,
    );
    expect(press("f", { target: button })).toBe(
      PlaylistPlayerKeyAction.ToggleFullScreen,
    );
  });
});

describe("what Space presses by itself", () => {
  test("buttons, links and controls with a role", () => {
    expect(isActivatedBySpace(element("button"))).toBe(true);
    expect(isActivatedBySpace(element("a"))).toBe(true);
    expect(isActivatedBySpace(element("summary"))).toBe(true);

    for (const role of [
      "button",
      "checkbox",
      "link",
      "menuitem",
      "menuitemradio",
      "option",
      "radio",
      "switch",
      "tab",
    ]) {
      expect({
        role,
        pressed: isActivatedBySpace(element("div", { role })),
      }).toEqual({
        role,
        pressed: true,
      });
    }
  });

  test("not the page, a region, nothing at all", () => {
    expect(isActivatedBySpace(element("div"))).toBe(false);
    expect(isActivatedBySpace(element("main", { role: "region" }))).toBe(false);
    expect(isActivatedBySpace(null)).toBe(false);
    expect(isActivatedBySpace(undefined)).toBe(false);
    expect(isActivatedBySpace({} as unknown as EventTarget)).toBe(false);
  });
});

describe("the keys sheet", () => {
  function everyShortcut(
    isRightToLeft: boolean,
  ): Array<PlaylistPlayerShortcut> {
    return getPlaylistPlayerShortcutGroups({ isRightToLeft }).flatMap(
      (group: PlaylistPlayerShortcutGroup): Array<PlaylistPlayerShortcut> => {
        return group.shortcuts;
      },
    );
  }

  test("lists the rotation's keys, then the screen's", () => {
    expect(
      getPlaylistPlayerShortcutGroups({ isRightToLeft: false }).map(
        (group: PlaylistPlayerShortcutGroup) => {
          return [group.title, group.shortcuts.map((shortcut) => shortcut.id)];
        },
      ),
    ).toEqual([
      ["Playback", ["toggle-pause", "next", "previous"]],
      ["Screen", ["full-screen", "exit", "shortcuts"]],
    ]);
  });

  test("every key it lists does what it says, so the sheet never drifts from the keys", () => {
    const actionOf: Record<string, PlaylistPlayerKeyAction> = {
      "toggle-pause": PlaylistPlayerKeyAction.TogglePause,
      next: PlaylistPlayerKeyAction.Next,
      previous: PlaylistPlayerKeyAction.Previous,
      "full-screen": PlaylistPlayerKeyAction.ToggleFullScreen,
      exit: PlaylistPlayerKeyAction.Exit,
      shortcuts: PlaylistPlayerKeyAction.ShowShortcuts,
    };
    // The sheet names keys as KeyboardKey does; a keydown reports them so.
    const keyOf: Record<string, string> = { Space: " ", F: "f" };

    for (const isRightToLeft of [false, true]) {
      for (const shortcut of everyShortcut(isRightToLeft)) {
        const key: string = keyOf[shortcut.keys[0]!] || shortcut.keys[0]!;

        expect({
          id: shortcut.id,
          isRightToLeft,
          action: press(key, {}, { isRightToLeft }),
        }).toEqual({
          id: shortcut.id,
          isRightToLeft,
          action: actionOf[shortcut.id],
        });
      }
    }
  });

  test("on a page read right to left, it lists the arrows the way they work there", () => {
    const keysOf: (isRightToLeft: boolean) => Record<string, string> = (
      isRightToLeft: boolean,
    ): Record<string, string> => {
      const keys: Record<string, string> = {};

      for (const shortcut of everyShortcut(isRightToLeft)) {
        keys[shortcut.id] = shortcut.keys.join("+");
      }

      return keys;
    };

    expect(keysOf(false)["next"]).toBe("ArrowRight");
    expect(keysOf(false)["previous"]).toBe("ArrowLeft");
    expect(keysOf(true)["next"]).toBe("ArrowLeft");
    expect(keysOf(true)["previous"]).toBe("ArrowRight");
  });

  test("every shortcut is described in a few words", () => {
    for (const shortcut of everyShortcut(false)) {
      expect(shortcut.description.length).toBeGreaterThan(3);
      expect(shortcut.description.length).toBeLessThan(40);
    }
  });
});
