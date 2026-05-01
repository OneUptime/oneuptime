import HistoryStack from "../../../Utils/Dashboard/HistoryStack";

describe("HistoryStack", () => {
  test("reports no undo/redo on initialization", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.getCurrent()).toEqual({ value: 0 });
  });

  test("push records previous value on the past stack", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    expect(stack.getCurrent()).toEqual({ value: 1 });
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  test("undo restores the previous value and enables redo", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    stack.push({ value: 2 });
    expect(stack.undo()).toBe(true);
    expect(stack.getCurrent()).toEqual({ value: 1 });
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(true);
  });

  test("redo restores the undone value", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    stack.undo();
    expect(stack.redo()).toBe(true);
    expect(stack.getCurrent()).toEqual({ value: 1 });
    expect(stack.canRedo()).toBe(false);
  });

  test("push after undo discards the redo history", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    stack.push({ value: 2 });
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.push({ value: 99 });
    expect(stack.canRedo()).toBe(false);
    expect(stack.getCurrent()).toEqual({ value: 99 });
  });

  test("undo returns false when stack is empty", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    expect(stack.undo()).toBe(false);
    expect(stack.getCurrent()).toEqual({ value: 0 });
  });

  test("redo returns false when stack is empty", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    expect(stack.redo()).toBe(false);
  });

  test("replace updates current without affecting history", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    stack.replace({ value: 1.5 });
    expect(stack.getCurrent()).toEqual({ value: 1.5 });
    stack.undo();
    expect(stack.getCurrent()).toEqual({ value: 0 });
  });

  test("reset clears past and future stacks", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack({
      value: 0,
    });
    stack.push({ value: 1 });
    stack.push({ value: 2 });
    stack.undo();
    stack.reset({ value: 99 });
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    expect(stack.getCurrent()).toEqual({ value: 99 });
  });

  test("respects maxHistory by dropping the oldest entry", () => {
    const stack: HistoryStack<{ value: number }> = new HistoryStack(
      { value: 0 },
      2,
    );
    stack.push({ value: 1 });
    stack.push({ value: 2 });
    stack.push({ value: 3 });
    // Past should hold at most 2 items now: [1, 2] (the 0 was dropped).
    stack.undo();
    stack.undo();
    expect(stack.canUndo()).toBe(false);
    expect(stack.getCurrent()).toEqual({ value: 1 });
  });

  test("snapshot returns a deep clone (mutating snapshot does not affect stack)", () => {
    const stack: HistoryStack<{ tags: Array<string> }> = new HistoryStack({
      tags: ["a"],
    });
    stack.push({ tags: ["a", "b"] });
    const snap: { current: { tags: Array<string> } } = stack.snapshot();
    snap.current.tags.push("MUTATED");
    expect(stack.getCurrent()).toEqual({ tags: ["a", "b"] });
  });
});
