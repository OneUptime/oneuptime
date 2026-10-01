/*
 * Undo and redo in the reference editor: a run of typing is one step, a
 * picked value or a paste is a step of its own, and undo puts the caret back
 * where the change happened.
 */

import TemplateTextHistory, {
  TYPING_MERGE_WINDOW_MS,
  TemplateTextChangeKind,
  TemplateTextSnapshot,
} from "../../../../../UI/Components/Workflow/ValuePicker/TemplateTextHistory";
import { describe, expect, test } from "@jest/globals";

type SnapFunction = (value: string, caret?: number) => TemplateTextSnapshot;

const snap: SnapFunction = (
  value: string,
  caret: number = value.length,
): TemplateTextSnapshot => {
  return { value: value, selectionStart: caret, selectionEnd: caret };
};

describe("TemplateTextHistory", () => {
  test("typing in a quick run is one step", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    history.record(snap("H"), TemplateTextChangeKind.Typing, 1000);
    history.record(snap("Hi"), TemplateTextChangeKind.Typing, 1100);
    history.record(snap("Hi!"), TemplateTextChangeKind.Typing, 1200);

    expect(history.undo()).toEqual(snap(""));
    expect(history.canUndo()).toBe(false);
  });

  test("a pause ends the run", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    history.record(snap("Hi"), TemplateTextChangeKind.Typing, 1000);
    history.record(
      snap("Hi there"),
      TemplateTextChangeKind.Typing,
      1000 + TYPING_MERGE_WINDOW_MS + 1,
    );

    expect(history.undo()!.value).toBe("Hi");
    expect(history.undo()!.value).toBe("");
  });

  test("a picked value is its own step, and so is the typing after it", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap("Body: "));
    const withReference: string = "Body: {{local.variables.x}}";

    history.record(snap(withReference), TemplateTextChangeKind.Other, 1000);
    history.record(
      snap(`${withReference}!`),
      TemplateTextChangeKind.Typing,
      1050,
    );

    expect(history.undo()!.value).toBe(withReference);
    expect(history.undo()!.value).toBe("Body: ");
  });

  test("typing and deleting are separate steps", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    history.record(snap("abc"), TemplateTextChangeKind.Typing, 1000);
    history.record(snap("ab"), TemplateTextChangeKind.Deleting, 1010);

    expect(history.undo()!.value).toBe("abc");
  });

  test("redo goes forward again, and a new change drops what was undone", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    history.record(snap("one"), TemplateTextChangeKind.Other, 1000);
    history.record(snap("one two"), TemplateTextChangeKind.Other, 2000);

    history.undo();
    expect(history.canRedo()).toBe(true);
    expect(history.redo()!.value).toBe("one two");
    expect(history.redo()).toBeNull();

    history.undo();
    history.record(snap("one three"), TemplateTextChangeKind.Other, 3000);
    expect(history.canRedo()).toBe(false);
  });

  test("undo puts the caret where the change was made", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(
      snap("Hello world", 11),
    );

    // A value inserted at 6, replacing "world".
    history.record(
      snap("Hello {{local.variables.x}}"),
      TemplateTextChangeKind.Other,
      1000,
      { start: 6, end: 11 },
    );

    expect(history.undo()).toEqual({
      value: "Hello world",
      selectionStart: 6,
      selectionEnd: 11,
    });
  });

  test("only the caret moving is not a step", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap("abc", 3));

    history.record(snap("abc", 1), TemplateTextChangeKind.Other, 1000);

    expect(history.canUndo()).toBe(false);
    expect(history.current.selectionStart).toBe(1);
  });

  test("a value set from outside starts the history again", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    history.record(snap("typed"), TemplateTextChangeKind.Typing, 1000);
    history.reset(snap("loaded"));

    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.current.value).toBe("loaded");
  });

  test("nothing to undo or redo is said, not thrown", () => {
    const history: TemplateTextHistory = new TemplateTextHistory(snap(""));

    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });
});
