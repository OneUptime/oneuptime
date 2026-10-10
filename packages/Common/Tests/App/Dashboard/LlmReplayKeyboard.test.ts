import { describe, expect, test } from "@jest/globals";
import {
  LlmReplayKeyEvent,
  getLlmReplayKeyAction,
} from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmReplayKeyboard";

/*
 * The replay's keys - K play/pause, J/Left back, L/Right forward - are bound
 * on the whole page, so the rules for when NOT to take a key matter more
 * than the keys: a conversation is a page people read, scroll and select
 * text on, and a shortcut that eats Space or an arrow in a slider breaks
 * that.
 */

function press(
  key: string,
  data: Partial<LlmReplayKeyEvent> = {},
): ReturnType<typeof getLlmReplayKeyAction> {
  return getLlmReplayKeyAction({
    key: key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    targetTagName: "BODY",
    targetRole: "",
    targetIsContentEditable: false,
    ...data,
  });
}

describe("the replay's keys", () => {
  test.each([
    ["k", "toggle"],
    ["K", "toggle"],
    ["j", "previous"],
    ["J", "previous"],
    ["ArrowLeft", "previous"],
    ["l", "next"],
    ["L", "next"],
    ["ArrowRight", "next"],
  ])("%s -> %s", (key: string, action: string) => {
    expect(press(key)).toBe(action);
  });

  test.each([
    " ",
    "Spacebar",
    "Home",
    "End",
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Enter",
    "Escape",
    "Tab",
    "a",
    "p",
  ])("%p keeps doing what it does on a page", (key: string) => {
    expect(press(key)).toBeNull();
  });
});

describe("keys the replay never takes", () => {
  test.each([["metaKey"], ["ctrlKey"], ["altKey"]])(
    "anything pressed with %s",
    (modifier: string) => {
      for (const key of ["k", "j", "l", "ArrowLeft", "ArrowRight"]) {
        expect(press(key, { [modifier]: true })).toBeNull();
      }
    },
  );

  test.each([["INPUT"], ["TEXTAREA"], ["SELECT"], ["input"], ["textarea"]])(
    "a key typed into a %s",
    (tag: string) => {
      for (const key of ["k", "j", "l", "ArrowLeft", "ArrowRight"]) {
        expect(press(key, { targetTagName: tag })).toBeNull();
      }
    },
  );

  test("a key typed into an editable element", () => {
    expect(press("k", { targetTagName: "DIV", targetIsContentEditable: true })).toBeNull();
  });

  test.each([
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
    "SLIDER",
  ])("an arrow on a %s, which moves with the arrows itself", (role: string) => {
    expect(press("ArrowLeft", { targetRole: role })).toBeNull();
    expect(press("ArrowRight", { targetRole: role })).toBeNull();
  });

  test("letters still work on those controls: they have no meaning there", () => {
    expect(press("k", { targetRole: "slider" })).toBe("toggle");
    expect(press("j", { targetRole: "tab" })).toBe("previous");
    expect(press("l", { targetRole: "menu" })).toBe("next");
  });

  test("an arrow on a plain button or a link still moves the replay", () => {
    expect(press("ArrowLeft", { targetTagName: "BUTTON", targetRole: "button" })).toBe("previous");
    expect(press("ArrowRight", { targetTagName: "A", targetRole: "" })).toBe("next");
  });

  test("a missing target reads as the page", () => {
    expect(press("k", { targetTagName: "", targetRole: "" })).toBe("toggle");
  });
});
