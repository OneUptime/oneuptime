import { describe, expect, test } from "@jest/globals";
import {
  DashboardFullScreenKeyAction,
  DashboardFullScreenKeyInput,
  getDashboardFullScreenKeyAction,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardFullScreenKeys";

/*
 * The keys of a dashboard shown full screen as a pure table (issue #10409):
 * Escape leaves it. One Escape never does two things, so it is the
 * dashboard's only when nothing else had it first: no chord, no text field,
 * no other handler that took it, no dialog or menu in front, no key held
 * down - and not while the browser is full screen, whose own Escape leaves
 * that first.
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
  overrides: Partial<DashboardFullScreenKeyInput> = {},
  options: { hasOpenLayer?: boolean; isBrowserFullScreen?: boolean } = {},
): DashboardFullScreenKeyAction | null {
  return getDashboardFullScreenKeyAction({
    event: {
      key: key,
      target: element("div") as unknown as EventTarget,
      ...overrides,
    },
    hasOpenLayer: Boolean(options.hasOpenLayer),
    isBrowserFullScreen: Boolean(options.isBrowserFullScreen),
  });
}

describe("what leaves full screen", () => {
  test("Escape, by either of its names", () => {
    expect(press("Escape")).toBe(DashboardFullScreenKeyAction.Exit);
    expect(press("Esc")).toBe(DashboardFullScreenKeyAction.Exit);
  });

  test("Escape on a button, a link or the board itself", () => {
    for (const target of [
      element("button"),
      element("a"),
      element("div", { role: "region" }),
      element("main"),
    ]) {
      expect(
        press("Escape", { target: target as unknown as EventTarget }),
      ).toBe(DashboardFullScreenKeyAction.Exit);
    }
  });

  test("Escape with no target (the window's own key)", () => {
    expect(press("Escape", { target: null })).toBe(
      DashboardFullScreenKeyAction.Exit,
    );
  });
});

describe("what is not the dashboard's", () => {
  test("every other key", () => {
    for (const key of [
      "f",
      "F",
      "Enter",
      " ",
      "Backspace",
      "ArrowLeft",
      "q",
      "?",
      "Tab",
    ]) {
      expect({ key, action: press(key) }).toEqual({ key, action: null });
    }
  });

  test("Escape in a chord: the browser's, or another shortcut's", () => {
    expect(press("Escape", { metaKey: true })).toBeNull();
    expect(press("Escape", { ctrlKey: true })).toBeNull();
    expect(press("Escape", { altKey: true })).toBeNull();
    // Shift+Escape opens the browser's task manager in Chrome.
    expect(press("Escape", { shiftKey: true })).toBeNull();
  });

  test("an Escape another handler took: a menu, a tooltip, a widget's drag", () => {
    expect(press("Escape", { defaultPrevented: true })).toBeNull();
  });

  test("an Escape held down, repeating", () => {
    expect(press("Escape", { repeat: true })).toBeNull();
  });

  test("an Escape in a text field: the field's", () => {
    for (const target of [
      element("input"),
      element("textarea"),
      element("select"),
      element("div", { contenteditable: "true" }),
      { ...element("div"), isContentEditable: true },
    ]) {
      expect(
        press("Escape", { target: target as unknown as EventTarget }),
      ).toBeNull();
    }
  });

  test("an Escape while a dialog or a menu is in front: theirs", () => {
    expect(press("Escape", {}, { hasOpenLayer: true })).toBeNull();
  });

  test("an Escape while the browser is full screen: the browser leaves its own first", () => {
    expect(press("Escape", {}, { isBrowserFullScreen: true })).toBeNull();
  });
});
