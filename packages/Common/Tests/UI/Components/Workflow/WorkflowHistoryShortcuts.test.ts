import { afterEach, describe, expect, test } from "@jest/globals";
import KeyboardKey from "../../../../UI/Components/KeyboardShortcut/KeyboardKey";
import { WorkflowHistoryDirection } from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import {
  WorkflowHistoryKeyEvent,
  getWorkflowHistoryShortcut,
  getWorkflowHistoryShortcutKeys,
  shouldWorkflowHandleHistoryShortcut,
} from "../../../../UI/Components/Workflow/WorkflowHistoryShortcuts";

/*
 * The builder's Undo and Redo shortcuts (issue #6188): ⌘Z / Ctrl+Z, ⇧⌘Z /
 * Ctrl+Shift+Z and Ctrl+Y - and never a key taken from someone typing.
 */

const key: (
  event: Partial<WorkflowHistoryKeyEvent>,
) => WorkflowHistoryKeyEvent = (
  event: Partial<WorkflowHistoryKeyEvent>,
): WorkflowHistoryKeyEvent => {
  return { key: "z", ...event };
};

describe("which keys ask for Undo and Redo", () => {
  test.each([
    ["⌘Z", { metaKey: true }, WorkflowHistoryDirection.Undo],
    ["Ctrl+Z", { ctrlKey: true }, WorkflowHistoryDirection.Undo],
    [
      "⇧⌘Z",
      { metaKey: true, shiftKey: true, key: "Z" },
      WorkflowHistoryDirection.Redo,
    ],
    [
      "Ctrl+Shift+Z",
      { ctrlKey: true, shiftKey: true, key: "Z" },
      WorkflowHistoryDirection.Redo,
    ],
    ["Ctrl+Y", { ctrlKey: true, key: "y" }, WorkflowHistoryDirection.Redo],
    [
      "Ctrl+Y with Caps Lock",
      { ctrlKey: true, key: "Y" },
      WorkflowHistoryDirection.Redo,
    ],
    [
      "⌘Z on an AZERTY keyboard, whose Z is elsewhere",
      { metaKey: true, key: "z", code: "KeyW" },
      WorkflowHistoryDirection.Undo,
    ],
    [
      "Ctrl+Z on a Russian keyboard, which types я there",
      { ctrlKey: true, key: "я", code: "KeyZ" },
      WorkflowHistoryDirection.Undo,
    ],
    [
      "Ctrl+Y on a Russian keyboard",
      { ctrlKey: true, key: "н", code: "KeyY" },
      WorkflowHistoryDirection.Redo,
    ],
  ])(
    "%s",
    (
      _name: string,
      event: Partial<WorkflowHistoryKeyEvent>,
      expected: WorkflowHistoryDirection,
    ) => {
      expect(getWorkflowHistoryShortcut(key(event))).toBe(expected);
    },
  );

  test.each([
    ["Z alone", {}],
    ["Shift+Z", { shiftKey: true, key: "Z" }],
    ["Alt+⌘Z", { metaKey: true, altKey: true }],
    ["⌘Y, the browser's History on a Mac", { metaKey: true, key: "y" }],
    ["Ctrl+Shift+Y", { ctrlKey: true, shiftKey: true, key: "Y" }],
    ["⌘X", { metaKey: true, key: "x" }],
    [
      "a Latin letter typed where Z sits is that letter",
      { metaKey: true, key: "w", code: "KeyZ" },
    ],
    ["no key at all", { ctrlKey: true, key: "" }],
  ])("not %s", (_name: string, event: Partial<WorkflowHistoryKeyEvent>) => {
    expect(getWorkflowHistoryShortcut(key(event))).toBeNull();
  });
});

describe("what the tooltips name", () => {
  test("on a Mac: ⌘Z and ⇧⌘Z", () => {
    expect(
      getWorkflowHistoryShortcutKeys({
        direction: WorkflowHistoryDirection.Undo,
        isApplePlatform: true,
      }),
    ).toEqual([KeyboardKey.Mod, "Z"]);
    expect(
      getWorkflowHistoryShortcutKeys({
        direction: WorkflowHistoryDirection.Redo,
        isApplePlatform: true,
      }),
    ).toEqual([KeyboardKey.Shift, KeyboardKey.Mod, "Z"]);
  });

  test("elsewhere: Ctrl+Z and Ctrl+Y", () => {
    expect(
      getWorkflowHistoryShortcutKeys({
        direction: WorkflowHistoryDirection.Undo,
        isApplePlatform: false,
      }),
    ).toEqual([KeyboardKey.Mod, "Z"]);
    expect(
      getWorkflowHistoryShortcutKeys({
        direction: WorkflowHistoryDirection.Redo,
        isApplePlatform: false,
      }),
    ).toEqual([KeyboardKey.Mod, "Y"]);
  });

  test("every key named is one the shortcuts take", () => {
    for (const isApplePlatform of [true, false]) {
      for (const direction of [
        WorkflowHistoryDirection.Undo,
        WorkflowHistoryDirection.Redo,
      ]) {
        const keys: Array<string> = getWorkflowHistoryShortcutKeys({
          direction,
          isApplePlatform,
        });
        const letter: string = (keys[keys.length - 1] as string).toLowerCase();

        expect(
          getWorkflowHistoryShortcut({
            key: keys.includes(KeyboardKey.Shift)
              ? letter.toUpperCase()
              : letter,
            metaKey: isApplePlatform,
            ctrlKey: !isApplePlatform,
            shiftKey: keys.includes(KeyboardKey.Shift),
          }),
        ).toBe(direction);
      }
    }
  });
});

describe("whether the builder takes the shortcut", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const pressedOn: (element: Element) => WorkflowHistoryKeyEvent = (
    element: Element,
  ): WorkflowHistoryKeyEvent => {
    return { key: "z", metaKey: true, target: element };
  };

  test("pressed on the page or the canvas: yes", () => {
    document.body.innerHTML = `<div class="react-flow"><div class="react-flow__node" tabindex="0"></div></div>`;

    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: pressedOn(document.body),
        page: document,
      }),
    ).toBe(true);
    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: pressedOn(
          document.querySelector(".react-flow__node") as Element,
        ),
        page: document,
      }),
    ).toBe(true);
  });

  test.each([
    ["a text field", `<input id="target" type="text" />`],
    ["a text area", `<textarea id="target"></textarea>`],
    ["a select", `<select id="target"><option>a</option></select>`],
    [
      "a rich text editor",
      `<div contenteditable="true"><p id="target">x</p></div>`,
    ],
    [
      "the value picker's chip editor",
      `<div contenteditable=""><span id="target">x</span></div>`,
    ],
    [
      "a code editor's surface",
      `<div class="monaco-editor"><div id="target" class="view-lines"></div></div>`,
    ],
    [
      "a CodeMirror editor",
      `<div class="cm-editor"><div id="target" class="cm-content"></div></div>`,
    ],
    [
      "anything that says it is a text box",
      `<div role="textbox"><span id="target"></span></div>`,
    ],
    ["a dialog", `<div role="dialog"><button id="target">Save</button></div>`],
    [
      "a panel beside the canvas",
      `<div role="dialog" data-testid="side-over"><button id="target">Preview</button></div>`,
    ],
  ])("pressed in %s: no, it is theirs", (_name: string, html: string) => {
    document.body.innerHTML = html;

    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: pressedOn(document.getElementById("target") as Element),
        page: document,
      }),
    ).toBe(false);
  });

  test("while a dialog is open over the canvas: no, wherever it was pressed", () => {
    document.body.innerHTML = `<div id="canvas"></div><div role="dialog" aria-modal="true"></div>`;

    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: pressedOn(document.getElementById("canvas") as Element),
        page: document,
      }),
    ).toBe(false);
  });

  test("a contenteditable switched off is no editor", () => {
    document.body.innerHTML = `<div contenteditable="false"><span id="target"></span></div>`;

    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: pressedOn(document.getElementById("target") as Element),
        page: document,
      }),
    ).toBe(true);
  });

  test("one another handler took, or one pressed while an input method composes: no", () => {
    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: { ...pressedOn(document.body), defaultPrevented: true },
        page: document,
      }),
    ).toBe(false);
    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: { ...pressedOn(document.body), isComposing: true },
        page: document,
      }),
    ).toBe(false);
  });

  test("a target that is no element, and no page, are read as nothing in the way", () => {
    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: { key: "z", metaKey: true, target: null },
        page: null,
      }),
    ).toBe(true);
    expect(
      shouldWorkflowHandleHistoryShortcut({
        event: {
          key: "z",
          metaKey: true,
          target: {
            closest: (): never => {
              throw new Error("not a selector this element knows");
            },
          } as unknown as EventTarget,
        },
        page: null,
      }),
    ).toBe(true);
  });
});
