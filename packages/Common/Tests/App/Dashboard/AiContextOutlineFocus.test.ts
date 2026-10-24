import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  OUTLINE_FOCUS_INTERVAL_MS,
  OUTLINE_FOCUS_TRIES,
  focusOutlineStart,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/AiContextOutlineFocus";

/*
 * "Start from an outline" fills an empty AI context field with a heading
 * for each kind of note (issue #5198), and goes once the field is no longer
 * empty. Focus does not go with it, back to the page: it goes into the
 * editor, the caret in the outline's first item, where the first note is
 * written (AiContextOutlineFocus) - in the visual editor or in its Markdown
 * source, whichever is open.
 *
 * The form is drawn here by hand, so each step - the click, the button
 * gone, the outline drawn - happens when the test says.
 */

const EDITOR_TEST_ID: string = "project-ai-context-field";

const OUTLINE_SOURCE: string =
  "## How our systems fit together\n\n- \n\n## Who owns what\n\n- ";

interface Drawn {
  dialog: HTMLElement;
  editor: HTMLElement;
  button: HTMLButtonElement;
  outside: HTMLButtonElement;
}

// A dialog holding the field's editor and, under it, the outline's button.
function draw(): Drawn {
  document.body.innerHTML = "";

  const outside: HTMLButtonElement = document.createElement("button");
  outside.textContent = "Outside";
  document.body.appendChild(outside);

  const dialog: HTMLElement = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);

  const editor: HTMLElement = document.createElement("div");
  editor.setAttribute("data-testid", EDITOR_TEST_ID);
  dialog.appendChild(editor);

  const button: HTMLButtonElement = document.createElement("button");
  button.textContent = "Start from an outline";
  dialog.appendChild(button);

  return { dialog, editor, button, outside };
}

// The visual editor, showing what it shows: the empty field, or the outline.
function drawVisual(into: HTMLElement, html: string): HTMLElement {
  const editable: HTMLElement = document.createElement("div");
  editable.setAttribute("role", "textbox");
  editable.setAttribute("contenteditable", "true");
  editable.innerHTML = html;
  into.appendChild(editable);
  return editable;
}

const OUTLINE_HTML: string =
  "<h2>How our systems fit together</h2><ul><li><br></li></ul><h2>Who owns what</h2><ul><li><br></li></ul>";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = "";
});

describe("after the outline, focus goes where the first note is written", () => {
  test("in the visual editor: the caret in the outline's first item", () => {
    const drawn: Drawn = draw();
    const editable: HTMLElement = drawVisual(drawn.editor, "");
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });

    // The form takes the outline: the button goes, the editor shows it.
    drawn.button.remove();
    editable.innerHTML = OUTLINE_HTML;
    jest.advanceTimersByTime(0);

    expect(document.activeElement).toBe(editable);

    const selection: Selection = window.getSelection() as Selection;
    const firstItem: Element = editable.querySelector("li") as Element;
    expect(selection.rangeCount).toBe(1);
    expect(selection.isCollapsed).toBe(true);
    expect(firstItem.contains(selection.anchorNode)).toBe(true);
    expect(selection.anchorNode).not.toBe(
      editable.querySelectorAll("li")[1] as Element,
    );
  });

  test("in the Markdown source: the caret after the first item's dash", () => {
    const drawn: Drawn = draw();
    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    drawn.editor.appendChild(textarea);
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });

    drawn.button.remove();
    textarea.value = OUTLINE_SOURCE;
    jest.advanceTimersByTime(0);

    const caret: number = OUTLINE_SOURCE.indexOf("\n- ") + "\n- ".length;

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(caret);
    expect(textarea.selectionEnd).toBe(caret);
    // Under the first heading, not the second.
    expect(OUTLINE_SOURCE.slice(0, caret)).toBe(
      "## How our systems fit together\n\n- ",
    );
  });

  test("it waits for the form to take the outline: nothing moves while the button is still drawn", () => {
    const drawn: Drawn = draw();
    const editable: HTMLElement = drawVisual(drawn.editor, OUTLINE_HTML);
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });

    jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS * 2);
    expect(document.activeElement).toBe(drawn.button);

    drawn.button.remove();
    jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS);
    expect(document.activeElement).toBe(editable);
  });

  test("it waits for the editor to show the outline", () => {
    const drawn: Drawn = draw();
    const editable: HTMLElement = drawVisual(drawn.editor, "");
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });

    drawn.button.remove();
    jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS * 2);
    expect(document.activeElement).not.toBe(editable);

    editable.innerHTML = OUTLINE_HTML;
    jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS);
    expect(document.activeElement).toBe(editable);
  });

  test("never takes focus from where someone has put it meanwhile", () => {
    const drawn: Drawn = draw();
    const editable: HTMLElement = drawVisual(drawn.editor, "");
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });

    drawn.button.remove();
    drawn.outside.focus();
    editable.innerHTML = OUTLINE_HTML;
    jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS * OUTLINE_FOCUS_TRIES);

    expect(document.activeElement).toBe(drawn.outside);
  });

  test("gives up quietly when the editor is never drawn", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: "not-drawn" });

    drawn.button.remove();
    expect(() => {
      jest.advanceTimersByTime(
        OUTLINE_FOCUS_INTERVAL_MS * (OUTLINE_FOCUS_TRIES + 2),
      );
    }).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  test("looks only in the button's own dialog", () => {
    const drawn: Drawn = draw();
    // Another dialog's editor with the same test id, drawn first.
    const other: HTMLElement = document.createElement("div");
    other.setAttribute("role", "dialog");
    const otherEditor: HTMLElement = document.createElement("div");
    otherEditor.setAttribute("data-testid", EDITOR_TEST_ID);
    const otherEditable: HTMLElement = drawVisual(otherEditor, OUTLINE_HTML);
    other.appendChild(otherEditor);
    document.body.insertBefore(other, drawn.dialog);

    const editable: HTMLElement = drawVisual(drawn.editor, OUTLINE_HTML);
    drawn.button.focus();

    focusOutlineStart({ from: drawn.button, editorTestId: EDITOR_TEST_ID });
    drawn.button.remove();
    jest.advanceTimersByTime(0);

    expect(document.activeElement).toBe(editable);
    expect(document.activeElement).not.toBe(otherEditable);
  });

  test("with no button to start from, does nothing", () => {
    expect(() => {
      focusOutlineStart({ from: null, editorTestId: EDITOR_TEST_ID });
      jest.advanceTimersByTime(OUTLINE_FOCUS_INTERVAL_MS);
    }).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
