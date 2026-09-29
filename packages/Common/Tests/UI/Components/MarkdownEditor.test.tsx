import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import {
  CHROME_VIEWER_COPY_HTML,
  CHROME_VIEWER_COPY_TEXT,
  GOOGLE_DOCS_LIST_COPY_HTML,
  GOOGLE_DOCS_LIST_COPY_MARKDOWN,
  GOOGLE_DOCS_LIST_COPY_TEXT,
  VIEWER_COPY_SOURCE_MARKDOWN,
  WORD_OUTLOOK_ISSUE_4114_HTML,
} from "./fixtures/MarkdownPasteFixtures";

describe("MarkdownEditor", () => {
  test("should render with toolbar buttons", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test"
        placeholder="Enter markdown here..."
      />,
    );

    // Check for toolbar buttons
    expect(screen.getByTitle("Bold (Ctrl+B)")).toBeInTheDocument();
    expect(screen.getByTitle("Italic (Ctrl+I)")).toBeInTheDocument();
    expect(screen.getByTitle("Underline")).toBeInTheDocument();
    expect(screen.getByTitle("Strikethrough")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 1")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 2")).toBeInTheDocument();
    expect(screen.getByTitle("Heading 3")).toBeInTheDocument();
    expect(screen.getByTitle("Bullet List")).toBeInTheDocument();
    expect(screen.getByTitle("Numbered List")).toBeInTheDocument();
    expect(screen.getByTitle("Task List")).toBeInTheDocument();
    expect(screen.getByTitle("Link")).toBeInTheDocument();
    expect(screen.getByTitle("Image")).toBeInTheDocument();
    expect(screen.getByTitle("Table")).toBeInTheDocument();
    expect(screen.getByTitle("Code")).toBeInTheDocument();
    expect(screen.getByTitle("Quote")).toBeInTheDocument();
    expect(screen.getByTitle("Horizontal Rule")).toBeInTheDocument();
  });

  test("should default to WYSIWYG and toggle to markdown source", () => {
    render(
      <MarkdownEditor
        initialValue="**bold text**"
        placeholder="Enter markdown here..."
      />,
    );

    /*
     * Default mode shows a toggle button labelled "Markdown" — the
     * button-role query disambiguates from the help text which also
     * mentions "Markdown".
     */
    const toggle: HTMLElement = screen.getByRole("button", {
      name: "Markdown",
    });
    expect(toggle).toBeInTheDocument();

    // Switch to markdown source mode.
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Visual" })).toBeInTheDocument();

    // Switch back to WYSIWYG.
    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(
      screen.getByRole("button", { name: "Markdown" }),
    ).toBeInTheDocument();
  });

  test("should enable spell check by default", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    /*
     * jsdom doesn't reflect the spellcheck IDL property reliably, so assert
     * the attribute that React renders.
     */
    expect(editor.getAttribute("spellcheck")).toBe("true");
  });

  test("should enable spell check when disableSpellCheck is undefined", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={undefined}
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("true");
  });

  test("should disable spell check when disableSpellCheck is true", () => {
    render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("false");
  });

  test("should handle spell check prop changes", () => {
    const { rerender } = render(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={false}
      />,
    );

    let editor: HTMLElement = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("true");

    rerender(
      <MarkdownEditor
        initialValue="This is a test with spelling errors"
        placeholder="Enter markdown here..."
        disableSpellCheck={true}
      />,
    );

    editor = screen.getByRole("textbox");
    expect(editor.getAttribute("spellcheck")).toBe("false");
  });

  test("should show help text", () => {
    render(
      <MarkdownEditor initialValue="" placeholder="Enter markdown here..." />,
    );

    expect(screen.getByText("Formatting help")).toBeInTheDocument();
  });

  test("should handle onChange callback in markdown mode", () => {
    const mockOnChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue=""
        placeholder="Enter markdown here..."
        onChange={mockOnChange}
      />,
    );

    // Switch to markdown source mode so we can drive the textarea directly.
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const textarea: HTMLElement = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new text" } });

    expect(mockOnChange).toHaveBeenCalledWith("new text");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Issue #4114: list indent / outdent, rich paste, double bullets, and the
 * editor without image upload.
 *
 * jsdom has no document.execCommand. The code paths that use it fall back
 * to DOM and value edits here, and the tests that need to see what the
 * editor asks the browser for install a stub (see stubExecCommand).
 * ---------------------------------------------------------------------------
 */

interface ClipboardStub {
  types: Array<string>;
  items: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
  getData: (format: string) => string;
}

const clipboardWith: (
  data: { [format: string]: string },
  files?: Array<File>,
) => ClipboardStub = (
  data: { [format: string]: string },
  files: Array<File> = [],
): ClipboardStub => {
  return {
    types: [...Object.keys(data), ...(files.length > 0 ? ["Files"] : [])],
    items: files.map(
      (file: File): { kind: string; type: string; getAsFile: () => File } => {
        return {
          kind: "file",
          type: file.type,
          getAsFile: (): File => {
            return file;
          },
        };
      },
    ),
    getData: (format: string): string => {
      return data[format] ?? "";
    },
  };
};

const imageFile: () => File = (): File => {
  const bytes: ArrayBuffer = new ArrayBuffer(4);
  new Uint8Array(bytes).set([137, 80, 78, 71]);
  const file: File = new File([bytes], "shot.png", { type: "image/png" });
  // jsdom's File has no arrayBuffer(), which the upload reads the file with.
  Object.defineProperty(file, "arrayBuffer", {
    value: (): Promise<ArrayBuffer> => {
      return Promise.resolve(bytes);
    },
  });
  return file;
};

// Lets the upload's awaited steps run.
const flushUploads: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
  });
};

const editableOf: () => HTMLElement = (): HTMLElement => {
  return document.querySelector('[contenteditable="true"]') as HTMLElement;
};

// Puts the caret `offset` characters into the first text node holding `text`.
const placeCaret: (text: string, offset: number) => void = (
  text: string,
  offset: number,
): void => {
  const editable: HTMLElement = editableOf();
  act(() => {
    editable.focus();
  });
  const walker: TreeWalker = document.createTreeWalker(
    editable,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();
  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }
  if (!node) {
    throw new Error(`no text "${text}" in the editor`);
  }
  const range: Range = document.createRange();
  range.setStart(node, (node.textContent || "").indexOf(text) + offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

// The first text node in the editor holding `text`.
const textNodeWith: (text: string) => Text = (text: string): Text => {
  const walker: TreeWalker = document.createTreeWalker(
    editableOf(),
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null = walker.nextNode();
  while (node && !(node.textContent || "").includes(text)) {
    node = walker.nextNode();
  }
  if (!node) {
    throw new Error(`no text "${text}" in the editor`);
  }
  return node as Text;
};

// Selects from `startOffset` into the text `start` to `endOffset` into the text `end`.
const selectText: (
  start: string,
  startOffset: number,
  end: string,
  endOffset: number,
) => void = (
  start: string,
  startOffset: number,
  end: string,
  endOffset: number,
): void => {
  act(() => {
    editableOf().focus();
  });
  const startNode: Text = textNodeWith(start);
  const endNode: Text = textNodeWith(end);
  const range: Range = document.createRange();
  range.setStart(startNode, startNode.data.indexOf(start) + startOffset);
  range.setEnd(endNode, endNode.data.indexOf(end) + endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const selectAllInEditor: () => void = (): void => {
  const range: Range = document.createRange();
  range.selectNodeContents(editableOf());
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
};

const lastChange: (onChange: jest.Mock) => string = (
  onChange: jest.Mock,
): string => {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? "");
};

const switchToMarkdown: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
  return screen.getByRole("textbox") as HTMLTextAreaElement;
};

type ExecCommandStub = jest.Mock<
  boolean,
  [command: string, showUi?: boolean | undefined, value?: string | undefined]
>;

// Installs document.execCommand for one test; `handle` answers each command.
const stubExecCommand: (
  handle: (command: string, value?: string) => boolean,
) => ExecCommandStub = (
  handle: (command: string, value?: string) => boolean,
): ExecCommandStub => {
  const stub: ExecCommandStub = jest.fn(
    (
      command: string,
      _showUi?: boolean | undefined,
      value?: string | undefined,
    ): boolean => {
      return handle(command, value);
    },
  );
  Object.defineProperty(document, "execCommand", {
    value: stub,
    configurable: true,
    writable: true,
  });
  return stub;
};

afterEach(() => {
  cleanup();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  window.getSelection()?.removeAllRanges();
  jest.restoreAllMocks();
});

describe("MarkdownEditor indent and outdent", () => {
  test("has Indent and Outdent buttons that name their keys", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(screen.getByTitle("Indent (Tab)")).toBeInTheDocument();
    expect(screen.getByTitle("Outdent (Shift+Tab)")).toBeInTheDocument();
  });

  test("puts them in the lists group, after Task List", () => {
    render(<MarkdownEditor initialValue="" />);

    const titles: Array<string> = Array.from(
      document.querySelectorAll("button[title]"),
    ).map((button: Element): string => {
      return button.getAttribute("title") || "";
    });
    const taskList: number = titles.indexOf("Task List");
    expect(titles.slice(taskList, taskList + 3)).toEqual([
      "Task List",
      "Indent (Tab)",
      "Outdent (Shift+Tab)",
    ]);
  });

  describe("in the visual editor", () => {
    test("Tab nests the item at the caret under the one before it", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"- a\n- b\n  - c\n- d"}
          onChange={onChange}
        />,
      );
      placeCaret("b", 1);

      const notPrevented: boolean = fireEvent.keyDown(editableOf(), {
        key: "Tab",
      });

      expect(notPrevented).toBe(false);
      expect(lastChange(onChange)).toBe("- a\n  - b\n    - c\n- d");
      expect(document.activeElement).toBe(editableOf());
    });

    /*
     * The no-keyboard-trap rule: when Tab has nothing to indent, the editor
     * leaves the key alone and the browser moves focus to the next field.
     */
    test("leaves Tab to move focus when the item cannot be indented", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("a", 0);

      expect(fireEvent.keyDown(editableOf(), { key: "Tab" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("leaves Tab to move focus outside a list", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue="just text" onChange={onChange} />);
      placeCaret("text", 0);

      expect(fireEvent.keyDown(editableOf(), { key: "Tab" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("Shift+Tab moves a nested item out beside its parent", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"- a\n  - b\n  - c"}
          onChange={onChange}
        />,
      );
      placeCaret("b", 0);

      expect(
        fireEvent.keyDown(editableOf(), { key: "Tab", shiftKey: true }),
      ).toBe(false);
      expect(lastChange(onChange)).toBe("- a\n- b\n  - c");
    });

    test("leaves Shift+Tab to move focus back from a top-level item", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 0);

      expect(
        fireEvent.keyDown(editableOf(), { key: "Tab", shiftKey: true }),
      ).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("does not take Tab with Ctrl, Alt or Cmd held, or while composing", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 0);

      for (const modifiers of [
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { isComposing: true },
      ]) {
        expect(
          fireEvent.keyDown(editableOf(), { key: "Tab", ...modifiers }),
        ).toBe(true);
      }
      expect(onChange).not.toHaveBeenCalled();
    });

    /*
     * NoteComposer handles Cmd+Enter and Escape on its <form> and relies on
     * key events bubbling up out of the editor.
     */
    test("lets the key event bubble on to the page either way", () => {
      const onKeyDown: jest.Mock = jest.fn();
      render(
        <div onKeyDown={onKeyDown}>
          <MarkdownEditor initialValue={"- a\n- b"} />
        </div>,
      );
      placeCaret("b", 0);

      fireEvent.keyDown(editableOf(), { key: "Tab" });
      fireEvent.keyDown(editableOf(), { key: "Tab" });

      expect(onKeyDown).toHaveBeenCalledTimes(2);
    });

    test("the toolbar buttons indent and outdent the item at the caret", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"1. a\n2. b\n3. c"}
          onChange={onChange}
        />,
      );
      placeCaret("b", 0);

      fireEvent.click(screen.getByTitle("Indent (Tab)"));
      expect(lastChange(onChange)).toBe("1. a\n   1. b\n2. c");

      fireEvent.click(screen.getByTitle("Outdent (Shift+Tab)"));
      expect(lastChange(onChange)).toBe("1. a\n2. b\n3. c");
    });

    test("the Indent button does nothing outside a list", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue="text" onChange={onChange} />);
      placeCaret("text", 1);

      fireEvent.click(screen.getByTitle("Indent (Tab)"));

      expect(onChange).not.toHaveBeenCalled();
    });

    /*
     * The items are moved by hand, which the browser's undo stack never
     * hears of: Ctrl+Z after an accidental Tab undid the typing before it
     * and left the indent. The editor now takes the move back itself.
     */
    test("Ctrl+Z takes back an indent, keeping the caret in the item", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 1);
      const b: Text = textNodeWith("b");
      fireEvent.keyDown(editableOf(), { key: "Tab" });
      expect(lastChange(onChange)).toBe("- a\n  - b");

      expect(fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true })).toBe(
        false,
      );

      expect(lastChange(onChange)).toBe("- a\n- b");
      expect(window.getSelection()?.anchorNode).toBe(b);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      // Nothing of the editor's own left: the next Ctrl+Z is the browser's.
      expect(fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true })).toBe(
        true,
      );
    });

    // Undoing an outdent by indenting again would nest c under b.
    test("Ctrl+Z puts an outdented item back exactly as it was", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"- a\n  - b\n  - c"}
          onChange={onChange}
        />,
      );
      placeCaret("b", 0);
      fireEvent.keyDown(editableOf(), { key: "Tab", shiftKey: true });
      expect(lastChange(onChange)).toBe("- a\n- b\n  - c");

      fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true });

      expect(lastChange(onChange)).toBe("- a\n  - b\n  - c");
    });

    test("Cmd+Z takes back the Indent and Outdent buttons too", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor initialValue={"- a\n- b\n- c"} onChange={onChange} />,
      );
      placeCaret("b", 0);

      fireEvent.click(screen.getByTitle("Indent (Tab)"));
      fireEvent.click(screen.getByTitle("Outdent (Shift+Tab)"));
      fireEvent.click(screen.getByTitle("Indent (Tab)"));
      expect(lastChange(onChange)).toBe("- a\n  - b\n- c");

      fireEvent.keyDown(editableOf(), { key: "z", metaKey: true });
      expect(lastChange(onChange)).toBe("- a\n- b\n- c");
      fireEvent.keyDown(editableOf(), { key: "z", metaKey: true });
      expect(lastChange(onChange)).toBe("- a\n  - b\n- c");
      fireEvent.keyDown(editableOf(), { key: "z", metaKey: true });
      expect(lastChange(onChange)).toBe("- a\n- b\n- c");
    });

    test("Ctrl+Shift+Z and Ctrl+Y make an undone indent again", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 0);
      fireEvent.keyDown(editableOf(), { key: "Tab" });
      fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true });

      expect(
        fireEvent.keyDown(editableOf(), {
          key: "Z",
          ctrlKey: true,
          shiftKey: true,
        }),
      ).toBe(false);
      expect(lastChange(onChange)).toBe("- a\n  - b");

      fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true });
      expect(fireEvent.keyDown(editableOf(), { key: "y", ctrlKey: true })).toBe(
        false,
      );
      expect(lastChange(onChange)).toBe("- a\n  - b");
    });

    /*
     * Typing after the move is newer history in the browser's own stack, so
     * Ctrl+Z is left to the browser, which takes the typing back first.
     */
    test("leaves Ctrl+Z to the browser once something else changed the editor", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 1);
      fireEvent.keyDown(editableOf(), { key: "Tab" });

      textNodeWith("b").data = "bx";
      fireEvent.input(editableOf());
      expect(lastChange(onChange)).toBe("- a\n  - bx");

      expect(fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true })).toBe(
        true,
      );
      expect(lastChange(onChange)).toBe("- a\n  - bx");
    });

    test("does not take Ctrl+Alt+Z, or Ctrl+Z while composing", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 0);
      fireEvent.keyDown(editableOf(), { key: "Tab" });

      expect(
        fireEvent.keyDown(editableOf(), {
          key: "z",
          ctrlKey: true,
          altKey: true,
        }),
      ).toBe(true);
      expect(
        fireEvent.keyDown(editableOf(), {
          key: "z",
          ctrlKey: true,
          isComposing: true,
        }),
      ).toBe(true);
      expect(lastChange(onChange)).toBe("- a\n  - b");
    });

    // Undo and redo from the Edit menu arrive as a beforeinput event.
    test("takes an indent back on the Edit menu's undo, and makes it again on redo", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      placeCaret("b", 0);
      fireEvent.keyDown(editableOf(), { key: "Tab" });

      const undo: InputEvent = new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        editableOf().dispatchEvent(undo);
      });
      expect(undo.defaultPrevented).toBe(true);
      expect(lastChange(onChange)).toBe("- a\n- b");

      const redo: InputEvent = new InputEvent("beforeinput", {
        inputType: "historyRedo",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        editableOf().dispatchEvent(redo);
      });
      expect(redo.defaultPrevented).toBe(true);
      expect(lastChange(onChange)).toBe("- a\n  - b");
    });

    test("leaves the Edit menu's undo to the browser when it has nothing of its own", () => {
      render(<MarkdownEditor initialValue={"- a\n- b"} />);
      placeCaret("b", 0);

      const undo: InputEvent = new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        editableOf().dispatchEvent(undo);
      });

      expect(undo.defaultPrevented).toBe(false);
    });

    test("leaves Tab to move focus from a code block inside a list item", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"- a\n- b\n\n  ```\n  code\n  ```"}
          onChange={onChange}
        />,
      );
      placeCaret("code", 2);

      expect(fireEvent.keyDown(editableOf(), { key: "Tab" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("in the markdown source", () => {
    test("Tab moves the selected item to its parent's content column", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor initialValue={"1. a\n2. b"} onChange={onChange} />,
      );
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(8, 8);

      expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);
      expect(textarea.value).toBe("1. a\n   1. b");
      expect(lastChange(onChange)).toBe("1. a\n   1. b");
      expect(textarea.value.slice(textarea.selectionStart)).toBe("b");
    });

    test("Shift+Tab moves it back", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor initialValue={"- a\n  - b"} onChange={onChange} />,
      );
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(8, 8);

      expect(fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true })).toBe(
        false,
      );
      expect(textarea.value).toBe("- a\n- b");
    });

    test("leaves Tab to move focus when there is nothing to indent", () => {
      const onChange: jest.Mock = jest.fn();
      render(<MarkdownEditor initialValue={"- a\n- b"} onChange={onChange} />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();

      textarea.setSelectionRange(0, 0);
      expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);
      textarea.setSelectionRange(6, 6);
      expect(fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true })).toBe(
        true,
      );
      expect(textarea.value).toBe("- a\n- b");
      expect(onChange).not.toHaveBeenCalled();
    });

    test("the toolbar buttons indent every selected item", () => {
      render(<MarkdownEditor initialValue={"- a\n- b\n- c"} />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(4, 11);

      fireEvent.click(screen.getByTitle("Indent (Tab)"));
      expect(textarea.value).toBe("- a\n  - b\n  - c");

      fireEvent.click(screen.getByTitle("Outdent (Shift+Tab)"));
      expect(textarea.value).toBe("- a\n- b\n- c");
    });

    /*
     * Where the browser has execCommand, only the changed stretch is
     * replaced, with insertText -- so Ctrl+Z undoes an indent like typing.
     */
    test("replaces only the changed text through insertText when it can", () => {
      render(<MarkdownEditor initialValue={"- a\n- b"} />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      const seen: Array<{ text?: string; start: number; end: number }> = [];
      const valueSetter: ((value: string) => void) | undefined =
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
      stubExecCommand((command: string, value?: string): boolean => {
        if (command !== "insertText" || value === undefined) {
          return false;
        }
        const start: number = textarea.selectionStart;
        const end: number = textarea.selectionEnd;
        seen.push({ text: value, start, end });
        // What the browser does: splice the text in and fire input.
        valueSetter?.call(
          textarea,
          textarea.value.slice(0, start) + value + textarea.value.slice(end),
        );
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      });
      textarea.setSelectionRange(6, 6);

      fireEvent.keyDown(textarea, { key: "Tab" });

      expect(seen).toEqual([{ text: "  ", start: 4, end: 4 }]);
      expect(textarea.value).toBe("- a\n  - b");
      expect(textarea.selectionStart).toBe(8);
    });
  });
});

describe("MarkdownEditor list buttons", () => {
  /*
   * The double bullets of issue #4114: text pasted from Word still began
   * with "•", execCommand("insertUnorderedList") kept it, and the item
   * showed the list's bullet and its own -- saved as "- •\tService down".
   */
  test("Bullet List strips the bullet characters the lines began with", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    stubExecCommand((command: string): boolean => {
      if (command !== "insertUnorderedList") {
        return false;
      }
      // What Chromium leaves after turning the pasted lines into a list.
      editableOf().innerHTML =
        "<ul><li>•\tService down</li><li>o\tUsers cannot log in</li></ul>";
      selectAllInEditor();
      return true;
    });
    act(() => {
      editableOf().focus();
    });

    fireEvent.click(screen.getByTitle("Bullet List"));

    expect(document.execCommand).toHaveBeenCalledWith(
      "insertUnorderedList",
      false,
      undefined,
    );
    expect(lastChange(onChange)).toBe("- Service down\n- Users cannot log in");
    expect(editableOf().textContent).not.toContain("•");
  });

  test("Numbered List strips the numbers the lines were typed with", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    stubExecCommand((command: string): boolean => {
      if (command !== "insertOrderedList") {
        return false;
      }
      editableOf().innerHTML = "<ol><li>1.\tFirst</li><li>2.\tSecond</li></ol>";
      selectAllInEditor();
      return true;
    });
    act(() => {
      editableOf().focus();
    });

    fireEvent.click(screen.getByTitle("Numbered List"));

    expect(lastChange(onChange)).toBe("1. First\n2. Second");
  });

  describe("in the markdown source", () => {
    /*
     * The same bug in the source: the button put "- " on the first selected
     * line only, in front of the pasted "•".
     */
    test("Bullet List replaces the bullets on every selected line", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor
          initialValue={"•\tService down\nsecond line"}
          onChange={onChange}
        />,
      );
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(0, textarea.value.length);

      fireEvent.click(screen.getByTitle("Bullet List"));

      expect(textarea.value).toBe("- Service down\n- second line");
      expect(lastChange(onChange)).toBe("- Service down\n- second line");
    });

    test("Numbered List numbers every selected line", () => {
      render(<MarkdownEditor initialValue={"a\nb\nc"} />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(0, textarea.value.length);

      fireEvent.click(screen.getByTitle("Numbered List"));

      expect(textarea.value).toBe("1. a\n2. b\n3. c");
    });

    // Nested items move to the numbered item's content column, and count from 1.
    test("Numbered List keeps a nested list nested", () => {
      const onChange: jest.Mock = jest.fn();
      render(
        <MarkdownEditor initialValue={"- a\n  - b\n- c"} onChange={onChange} />,
      );
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(0, textarea.value.length);

      fireEvent.click(screen.getByTitle("Numbered List"));

      expect(textarea.value).toBe("1. a\n   1. b\n2. c");
      expect(lastChange(onChange)).toBe("1. a\n   1. b\n2. c");
    });

    test("a second click takes the markers off again", () => {
      render(<MarkdownEditor initialValue={"a\nb"} />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(0, textarea.value.length);

      fireEvent.click(screen.getByTitle("Task List"));
      expect(textarea.value).toBe("- [ ] a\n- [ ] b");

      textarea.setSelectionRange(0, textarea.value.length);
      fireEvent.click(screen.getByTitle("Task List"));
      expect(textarea.value).toBe("a\nb");
    });

    test("starts a list on an empty line with the caret after the marker", () => {
      render(<MarkdownEditor initialValue="" />);
      const textarea: HTMLTextAreaElement = switchToMarkdown();
      textarea.setSelectionRange(0, 0);

      fireEvent.click(screen.getByTitle("Bullet List"));

      expect(textarea.value).toBe("- ");
      expect(textarea.selectionStart).toBe(2);
    });
  });
});

describe("MarkdownEditor paste in the visual editor", () => {
  test("keeps the nesting of a list pasted from Outlook", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    const notPrevented: boolean = fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": WORD_OUTLOOK_ISSUE_4114_HTML,
        "text/plain": "flattened text",
      }),
    });

    expect(notPrevented).toBe(false);
    expect(lastChange(onChange)).toContain(
      "- Service is currently unavailable\n  - Users are unable to log in\n  - Users are receiving an error message\n- Investigation is in progress\n  - Technical team has been notified\n  - Vendor has been contacted",
    );
    expect(
      editableOf().querySelector("li > ul > li")?.textContent,
    ).toBeTruthy();
  });

  // Its plain text is bare lines: no bullets, no nesting, no links.
  test("keeps the list, links and formatting of a Google Docs copy", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": GOOGLE_DOCS_LIST_COPY_HTML,
        "text/plain": GOOGLE_DOCS_LIST_COPY_TEXT,
      }),
    });

    expect(lastChange(onChange)).toBe(GOOGLE_DOCS_LIST_COPY_MARKDOWN);
  });

  test("turns a copied note back into the markdown it was written in", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": CHROME_VIEWER_COPY_HTML,
        "text/plain": CHROME_VIEWER_COPY_TEXT,
      }),
    });

    expect(lastChange(onChange)).toBe(VIEWER_COPY_SOURCE_MARKDOWN);
  });

  test("makes pasted bullet characters a nested list, not text", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/plain": "•\tService down\no\tUsers cannot log in",
      }),
    });

    expect(lastChange(onChange)).toBe(
      "- Service down\n  - Users cannot log in",
    );
    expect(editableOf().innerHTML).toBe(
      "<ul><li>Service down<ul><li>Users cannot log in</li></ul></li></ul>",
    );
  });

  /*
   * A paragraph pasted into the middle of a line used to land as a <p>
   * inside the <p> the caret was in, and "big " pasted into "hello world"
   * saved "hello \n\nbig \n\nworld".
   */
  test("pastes a word into the middle of a line without splitting it", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    placeCaret("world", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "big " }),
    });

    expect(lastChange(onChange)).toBe("hello big world");
    expect(editableOf().querySelectorAll("p")).toHaveLength(1);
  });

  test("pastes formatted words into the middle of a line", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    placeCaret("world", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<b>very</b> ",
        "text/plain": "very ",
      }),
    });

    expect(lastChange(onChange)).toBe("hello **very** world");
  });

  test("keeps the paragraph when pasting into an empty editor", () => {
    render(<MarkdownEditor initialValue="" />);
    const range: Range = document.createRange();
    range.setStart(editableOf(), 0);
    range.collapse(true);
    act(() => {
      editableOf().focus();
    });
    window.getSelection()?.addRange(range);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "first" }),
    });

    expect(editableOf().innerHTML).toBe("<p>first</p>");
  });

  /*
   * insertText for plain words, as if typed (Firefox's insertHTML turns the
   * space before them into a non-breaking one), so they go on the browser's
   * undo stack. Blocks in the middle of a line are never handed to
   * insertHTML -- Chromium and Safari fold them into the line -- the editor
   * splits the line and puts them in itself.
   */
  test("asks the browser to insert words as text, and keeps blocks in a line to itself", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    const stub: ExecCommandStub = stubExecCommand((): boolean => {
      return false;
    });
    placeCaret("world", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "big " }),
    });
    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "- a\n- b" }),
    });

    expect(stub.mock.calls).toEqual([["insertText", false, "big "]]);
    // The browser refused the words here, so the editor inserted them itself.
    expect(lastChange(onChange)).toBe("hello big\n\n- a\n- b\n\nworld");
  });

  /*
   * Chromium's and Firefox's insertHTML turn the spaces around formatted
   * words into non-breaking ones, which were saved on either side of
   * "**very**", so formatted words are inserted as nodes instead.
   */
  test("inserts formatted words itself, without asking the browser", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    const stub: ExecCommandStub = stubExecCommand((): boolean => {
      return true;
    });
    placeCaret("world", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<b>very</b> ",
        "text/plain": "very ",
      }),
    });

    expect(stub).not.toHaveBeenCalled();
    expect(lastChange(onChange)).toBe("hello **very** world");
  });

  test("does not insert twice when the browser takes the insert", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    stubExecCommand((command: string, value?: string): boolean => {
      if (command !== "insertText" || value === undefined) {
        return false;
      }
      const range: Range = window.getSelection()!.getRangeAt(0);
      range.insertNode(document.createTextNode(value));
      return true;
    });
    placeCaret("world", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "big " }),
    });

    expect(lastChange(onChange)).toBe("hello big world");
  });

  /*
   * A selection across two list items, deleted on its own, left both items
   * and the caret between them, straight inside the <ul> -- the pasted link
   * showed in the editor but the serializer, which reads only a list's
   * items, saved "- al\n- ta\n- gamma".
   */
  test("keeps a link pasted over part of two list items, joining them", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    selectText("alpha", 2, "beta", 2);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": '<a href="https://oneuptime.com/docs">the docs</a>',
        "text/plain": "the docs",
      }),
    });

    expect(lastChange(onChange)).toBe(
      "- al[the docs](https://oneuptime.com/docs)ta\n- gamma",
    );
  });

  test("Ctrl+Z takes back such a paste, selection and all", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    selectText("alpha", 2, "beta", 2);
    const alpha: Text = textNodeWith("alpha");
    const beta: Text = textNodeWith("beta");
    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": '<a href="https://oneuptime.com/docs">the docs</a>',
        "text/plain": "the docs",
      }),
    });

    fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true });

    expect(lastChange(onChange)).toBe("- alpha\n- beta\n- gamma");
    const selection: Selection = window.getSelection() as Selection;
    expect([selection.anchorNode, selection.anchorOffset]).toEqual([alpha, 2]);
    expect([selection.focusNode, selection.focusOffset]).toEqual([beta, 2]);
  });

  // Ctrl+A in a note that is only a list, as Chromium selects it.
  test("keeps formatted words pasted over a whole list", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue={"- alpha\n- beta"} onChange={onChange} />,
    );
    selectText("alpha", 0, "beta", 4);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<p>see <b>this</b></p>",
        "text/plain": "see this",
      }),
    });

    expect(lastChange(onChange)).toBe("- see **this**");
  });

  /*
   * A triple click selects an item up to the very start of the next: the
   * paste replaces that item, and the next one is left as it was.
   */
  test("replaces a triple-clicked list item and leaves the next alone", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    act(() => {
      editableOf().focus();
    });
    const items: NodeListOf<HTMLLIElement> =
      editableOf().querySelectorAll("li");
    const range: Range = document.createRange();
    range.setStart(textNodeWith("beta"), 0);
    range.setEnd(items[2] as Node, 0);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<p>see <b>this</b></p>",
        "text/plain": "see this",
      }),
    });

    expect(lastChange(onChange)).toBe("- alpha\n- see **this**\n- gamma");
  });

  test("joins two paragraphs a formatted paste runs across", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"first para\n\nsecond para"}
        onChange={onChange}
      />,
    );
    selectText("first", 2, "second", 2);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<b>X</b>",
        "text/plain": "X",
      }),
    });

    expect(lastChange(onChange)).toBe("fi**X**cond para");
  });

  // What the browser's own insertText does with the same selection.
  test("joins two list items a plain word is pasted over", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    selectText("alpha", 2, "beta", 2);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "X" }),
    });

    expect(lastChange(onChange)).toBe("- alXta\n- gamma");
  });

  test("keeps a code block pasted over part of two list items", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    selectText("alpha", 2, "beta", 2);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "```\nnpm ci\n```" }),
    });

    expect(lastChange(onChange)).toBe(
      "- al\n\n  ```\n  npm ci\n  ```\n\n  ta\n- gamma",
    );
  });

  test("the Code button keeps code made over part of two list items", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue={"- alpha\n- beta\n- gamma"}
        onChange={onChange}
      />,
    );
    selectText("alpha", 2, "alpha", 5);

    fireEvent.click(screen.getByTitle("Code"));
    expect(lastChange(onChange)).toBe("- al`pha`\n- beta\n- gamma");

    selectText("beta", 2, "gamma", 2);
    fireEvent.click(screen.getByTitle("Code"));
    expect(editableOf().querySelectorAll("ul > li")).toHaveLength(2);
    expect(lastChange(onChange)).toContain("`ta");
    expect(lastChange(onChange)).toContain("ga`mma");
  });

  test("pastes into a code block as the plain text it is", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue={"```\ncode\n```"} onChange={onChange} />,
    );
    placeCaret("code", 4);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<ul><li>not a list here</li></ul>",
        "text/plain": "\r\n- line one\r\n  * line two",
      }),
    });

    expect(lastChange(onChange)).toBe(
      "```\ncode\n- line one\n  * line two\n```",
    );
  });

  test("lets nothing from hostile HTML through", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html":
          '<p>safe <a href="javascript:alert(1)">link</a></p><img src="x" onerror="window.__editorPasteRan=1"><script>window.__editorPasteRan=2</script>',
        "text/plain": "safe link",
      }),
    });

    expect(lastChange(onChange)).not.toMatch(/javascript|onerror|script/);
    expect(editableOf().innerHTML).not.toMatch(/onerror|<script|javascript/);
    expect(
      (window as unknown as { __editorPasteRan?: number }).__editorPasteRan,
    ).toBeUndefined();
  });

  test("leaves a paste without clipboard data to the browser", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(fireEvent.paste(editableOf(), {})).toBe(true);
  });
});

/*
 * document.execCommand as Chromium and Safari answer the editor's inserts.
 * insertText types the text at the caret. insertHTML puts blocks where they
 * belong on an empty line (or into the empty editor); anywhere else in a
 * line it folds a leading code block or quote into that line as a <span> of
 * its text, which the serializer reads as plain text -- the Code Block
 * button saved "hellocode block" and a pasted fenced block
 * "Run:npm install". (Lists, headings and tables it does split the line
 * for; the stub refuses those, and the editor inserts them itself.)
 */
const stubBlinkExecCommand: () => ExecCommandStub = (): ExecCommandStub => {
  return stubExecCommand((command: string, value?: string): boolean => {
    const selection: Selection | null = window.getSelection();
    if (!selection || selection.rangeCount === 0 || value === undefined) {
      return false;
    }
    const range: Range = selection.getRangeAt(0);
    if (command === "insertText") {
      range.deleteContents();
      const text: Text = document.createTextNode(value);
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      return true;
    }
    if (command !== "insertHTML") {
      return false;
    }
    const template: HTMLTemplateElement = document.createElement("template");
    template.innerHTML = value;
    const editable: HTMLElement = editableOf();
    if (range.startContainer === editable) {
      range.insertNode(template.content);
      return true;
    }
    let line: Node = range.startContainer;
    while (line.parentNode && line.parentNode !== editable) {
      line = line.parentNode;
    }
    if ((line.textContent || "") === "") {
      editable.replaceChild(template.content, line);
      return true;
    }
    const first: Element | null = template.content.firstElementChild;
    if (!first || !["PRE", "BLOCKQUOTE"].includes(first.tagName)) {
      return false;
    }
    const folded: HTMLSpanElement = document.createElement("span");
    folded.setAttribute("style", "font-family: ui-monospace, monospace");
    folded.textContent = first.textContent || "";
    range.deleteContents();
    range.insertNode(folded);
    return true;
  });
};

describe("MarkdownEditor blocks inserted into a line of text", () => {
  test("the Code Block button puts its block after the line the caret ends", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello" onChange={onChange} />);
    const stub: ExecCommandStub = stubBlinkExecCommand();
    placeCaret("hello", 5);

    fireEvent.click(screen.getByTitle("Code Block"));

    expect(stub).not.toHaveBeenCalledWith(
      "insertHTML",
      expect.anything(),
      expect.anything(),
    );
    expect(lastChange(onChange)).toBe("hello\n\n```\ncode block\n```");
  });

  test("the Code Block button splits the line the caret is in the middle of", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    stubBlinkExecCommand();
    placeCaret("world", 0);

    fireEvent.click(screen.getByTitle("Code Block"));

    expect(lastChange(onChange)).toBe("hello\n\n```\ncode block\n```\n\nworld");
  });

  /*
   * As in the markdown source, the placeholder is selected, so the code
   * typed next replaces it inside the block -- rather than landing after the
   * placeholder in one browser and below the block in another.
   */
  test("the Code Block button selects its placeholder", () => {
    render(<MarkdownEditor initialValue="hello" />);
    stubBlinkExecCommand();
    placeCaret("hello", 5);

    fireEvent.click(screen.getByTitle("Code Block"));

    const selection: Selection = window.getSelection() as Selection;
    expect(selection.toString()).toBe("code block");
    expect(selection.anchorNode?.parentElement?.closest("pre")).not.toBeNull();
  });

  test("a fenced block pasted after a line stays a code block", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="Run:" onChange={onChange} />);
    stubBlinkExecCommand();
    placeCaret("Run:", 4);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "```\nnpm install\n```" }),
    });

    expect(lastChange(onChange)).toBe("Run:\n\n```\nnpm install\n```");
  });

  test("code copied from a web page, pasted mid-line, splits the line", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue="Run this then check" onChange={onChange} />,
    );
    stubBlinkExecCommand();
    placeCaret("then", 0);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({
        "text/html": "<pre><code>npm install oneuptime</code></pre>",
        "text/plain": "npm install oneuptime",
      }),
    });

    expect(lastChange(onChange)).toBe(
      "Run this\n\n```\nnpm install oneuptime\n```\n\nthen check",
    );
  });

  test("a quote pasted after a line keeps its first line in the quote", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue="Customer said:" onChange={onChange} />,
    );
    stubBlinkExecCommand();
    placeCaret("said:", 5);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "> it is down\n> again" }),
    });

    expect(lastChange(onChange)).toBe(
      "Customer said:\n\n> it is down\n> again",
    );
  });

  // Put in by hand, the block is not on the browser's undo stack.
  test("Ctrl+Z takes back a code block put into a line", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello" onChange={onChange} />);
    stubBlinkExecCommand();
    placeCaret("hello", 5);
    fireEvent.click(screen.getByTitle("Code Block"));

    expect(fireEvent.keyDown(editableOf(), { key: "z", ctrlKey: true })).toBe(
      false,
    );

    expect(lastChange(onChange)).toBe("hello");
  });

  // Every block goes in the same way, splitting the line at the caret.
  test("the Table button splits the line too", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="hello world" onChange={onChange} />);
    stubBlinkExecCommand();
    placeCaret("world", 0);

    fireEvent.click(screen.getByTitle("Table"));

    expect(lastChange(onChange)).toMatch(
      /^hello\n\n\| Header 1 \| Header 2 \| Header 3 \|\n[\s\S]*\| Cell 6 {3}\|\n\nworld$/,
    );
  });

  /*
   * On an empty line insertHTML puts the blocks where they belong in every
   * browser, and there it is still used: it puts the insert on the
   * browser's own undo stack.
   */
  test("hands a block on an empty line to the browser", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const stub: ExecCommandStub = stubBlinkExecCommand();
    act(() => {
      editableOf().focus();
    });
    const range: Range = document.createRange();
    range.setStart(editableOf(), 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "```\nnpm install\n```" }),
    });

    expect(stub).toHaveBeenCalledWith(
      "insertHTML",
      false,
      "<pre><code>npm install</code></pre>",
    );
    expect(lastChange(onChange)).toBe("```\nnpm install\n```");
  });

  test("the Code Block button on an empty line still selects its placeholder", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue={"Steps:\n\n"} onChange={onChange} />);
    const stub: ExecCommandStub = stubBlinkExecCommand();
    const blank: HTMLElement = document.createElement("p");
    blank.appendChild(document.createElement("br"));
    editableOf().appendChild(blank);
    act(() => {
      editableOf().focus();
    });
    const range: Range = document.createRange();
    range.setStart(blank, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.click(screen.getByTitle("Code Block"));

    expect(stub).toHaveBeenCalledWith(
      "insertHTML",
      false,
      "<pre><code>code block</code></pre><p><br></p>",
    );
    expect(lastChange(onChange)).toBe("Steps:\n\n```\ncode block\n```");
    expect(window.getSelection()?.toString()).toBe("code block");
  });
});

describe("MarkdownEditor paste in the markdown source", () => {
  test("writes pasted rich text as markdown source", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    const notPrevented: boolean = fireEvent.paste(textarea, {
      clipboardData: clipboardWith({
        "text/html": "<ul><li>a<ul><li>b</li></ul></li></ul>",
        "text/plain": "a\nb",
      }),
    });

    expect(notPrevented).toBe(false);
    expect(lastChange(onChange)).toBe("- a\n  - b");
  });

  test("writes pasted bullet characters as markdown items", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({ "text/plain": "•\ta\n•\tb" }),
      }),
    ).toBe(false);
    expect(lastChange(onChange)).toBe("- a\n- b");
  });

  /*
   * When there is nothing to convert, the browser's own paste inserts the
   * same text and keeps it on the undo stack, so it is left to do that.
   */
  test("leaves a plain paste to the browser", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({
          "text/plain": "- already\r\n- markdown",
          "text/html": "<p>- already<br>- markdown</p>",
        }),
      }),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * Converted inside a fence, a command copied from a docs page came in as
   * a ``` block of its own -- closing the one around it, with the command
   * left as a paragraph -- so there the browser pastes the text as it is.
   */
  test("leaves a paste inside a fenced code block to the browser", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue={"```bash\n\n```"} onChange={onChange} />,
    );
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(8, 8);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({
          "text/html": "<pre><code>npm install oneuptime</code></pre>",
          "text/plain": "npm install oneuptime",
        }),
      }),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  // CLI output is not a list: "1)" and "•" stay as they were printed.
  test("does not rewrite list markers in text pasted inside a fence", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue={"~~~\n\n~~~"} onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(4, 4);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({
          "text/plain": "● nginx.service - web server\n1) option A\n• done",
        }),
      }),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("leaves a paste after a fence that is never closed to the browser", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue={"```bash\n"} onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(8, 8);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({
          "text/html": "<ul><li>a</li></ul>",
          "text/plain": "a",
        }),
      }),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("still converts a paste on the line after a code block", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor initialValue={"```\nx\n```\n\n"} onChange={onChange} />,
    );
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({
          "text/html": "<ul><li>a<ul><li>b</li></ul></li></ul>",
          "text/plain": "a\nb",
        }),
      }),
    ).toBe(false);
    expect(lastChange(onChange)).toBe("```\nx\n```\n\n- a\n  - b");
  });

  test("still uploads an image pasted inside a fence", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue={"```\n\n```"} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();
    textarea.setSelectionRange(4, 4);

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({}, [imageFile()]),
      }),
    ).toBe(false);
    await flushUploads();
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("still uploads a pasted image", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    expect(
      fireEvent.paste(textarea, {
        clipboardData: clipboardWith({}, [imageFile()]),
      }),
    ).toBe(false);
    expect(lastChange(onChange)).toMatch(/^!\[Uploading shot\.png/);
    await flushUploads();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("MarkdownEditor without image upload", () => {
  test("shows the Image button, file picker and upload tip by default", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(screen.getByTitle("Image")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(screen.getByText(/upload screenshots inline/)).toBeInTheDocument();
  });

  test("hides the Image button, file picker and upload tip when turned off", () => {
    render(<MarkdownEditor initialValue="" allowImageUpload={false} />);

    expect(screen.queryByTitle("Image")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/upload screenshots inline/)).toBeNull();
    // The rest of the toolbar is still there.
    expect(screen.getByTitle("Link")).toBeInTheDocument();
    expect(screen.getByTitle("Indent (Tab)")).toBeInTheDocument();
  });

  test("ignores a pasted image, and does not let the browser insert it", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(
      <MarkdownEditor
        initialValue=""
        allowImageUpload={false}
        onChange={onChange}
      />,
    );

    const notPrevented: boolean = fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({}, [imageFile()]),
    });

    expect(notPrevented).toBe(false);
    await flushUploads();
    expect(onChange).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(editableOf().innerHTML).toBe("");
  });

  test("still pastes the text that comes with an image", () => {
    const onChange: jest.Mock = jest.fn();
    render(
      <MarkdownEditor
        initialValue=""
        allowImageUpload={false}
        onChange={onChange}
      />,
    );

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({ "text/plain": "caption" }, [imageFile()]),
    });

    expect(lastChange(onChange)).toBe("caption");
  });

  test("ignores a pasted image in the markdown source", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(
      <MarkdownEditor
        initialValue=""
        allowImageUpload={false}
        onChange={onChange}
      />,
    );
    const textarea: HTMLTextAreaElement = switchToMarkdown();

    fireEvent.paste(textarea, {
      clipboardData: clipboardWith({}, [imageFile()]),
    });
    await flushUploads();

    expect(onChange).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("refuses a dropped file without uploading it", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest.spyOn(ModelAPI, "create");
    render(
      <MarkdownEditor
        initialValue=""
        allowImageUpload={false}
        onChange={onChange}
      />,
    );
    const dataTransfer: {
      types: Array<string>;
      files: Array<File>;
      dropEffect: string;
    } = { types: ["Files"], files: [imageFile()], dropEffect: "copy" };

    expect(fireEvent.dragOver(editableOf(), { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(screen.queryByText("Drop image to upload")).toBeNull();
    expect(fireEvent.drop(editableOf(), { dataTransfer })).toBe(false);
    await flushUploads();

    expect(onChange).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("uploads a dropped image when uploads are on", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" onChange={onChange} />);
    const dataTransfer: { types: Array<string>; files: Array<File> } = {
      types: ["Files"],
      files: [imageFile()],
    };

    fireEvent.dragOver(editableOf(), { dataTransfer });
    expect(screen.getByText("Drop image to upload")).toBeInTheDocument();
    fireEvent.drop(editableOf(), { dataTransfer });

    expect(lastChange(onChange)).toMatch(/^!\[Uploading shot\.png/);
    await flushUploads();
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("uploads a pasted image in the visual editor when uploads are on", async () => {
    const onChange: jest.Mock = jest.fn();
    const create: jest.SpyInstance = jest
      .spyOn(ModelAPI, "create")
      .mockReturnValue(new Promise<never>(() => {}) as never);
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    fireEvent.paste(editableOf(), {
      clipboardData: clipboardWith({}, [imageFile()]),
    });

    expect(lastChange(onChange)).toMatch(/^!\[Uploading shot\.png/);
    await flushUploads();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

/*
 * What Chromium does to an empty editor as "abc", Enter, "def" is typed:
 * the first line stays bare text and the second goes in a <div>. That used
 * to save as "abcdef".
 */
describe("MarkdownEditor typing lines into an empty editor", () => {
  test("saves each line Chromium writes as a line", () => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue="" onChange={onChange} />);

    editableOf().innerHTML = "abc<div>def</div>";
    fireEvent.input(editableOf());

    expect(lastChange(onChange)).toBe("abc\ndef");
  });
});

/*
 * The error was a bare paragraph: a required description left empty was
 * neither announced nor tied to the editor, so to a screen reader the form
 * did nothing when submitted.
 */
describe("MarkdownEditor error message", () => {
  test("is announced, and describes the visual editor, which is marked invalid", () => {
    render(<MarkdownEditor initialValue="" error="Description is required." />);

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(editor).toHaveAccessibleDescription("Description is required.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Description is required.",
    );
  });

  test("describes the markdown source the same way", () => {
    render(<MarkdownEditor initialValue="" error="Description is required." />);

    const textarea: HTMLTextAreaElement = switchToMarkdown();

    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription("Description is required.");
  });

  test("gives each editor's message an id of its own", () => {
    render(
      <>
        <MarkdownEditor initialValue="" error="Description is required." />
        <MarkdownEditor initialValue="" error="Impact is required." />
      </>,
    );

    const [first, second] = screen.getAllByRole(
      "textbox",
    ) as Array<HTMLElement>;
    expect(first).toHaveAccessibleDescription("Description is required.");
    expect(second).toHaveAccessibleDescription("Impact is required.");
  });

  test("leaves the editor unmarked without an error", () => {
    render(<MarkdownEditor initialValue="" />);

    const editor: HTMLElement = screen.getByRole("textbox");
    expect(editor).not.toHaveAttribute("aria-invalid");
    expect(editor).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("MarkdownEditor help text", () => {
  test("explains Tab and Shift+Tab, and plain-text paste", () => {
    render(<MarkdownEditor initialValue="" />);

    expect(screen.getByText(/to indent an item and/)).toBeInTheDocument();
    expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+Shift+V")).toBeInTheDocument();
    expect(
      screen.getByText(/Outside a list, Tab moves to the next field/),
    ).toBeInTheDocument();
  });
});

/*
 * On the public incident form, translated all round, the empty Description
 * box still said "Type your content here..." and its help "Formatting help".
 * The editor looks those words up by their English text, as FieldLabel does
 * "(Optional)"; a locale with no entry for them -- the Dashboard's, today --
 * keeps the English. The instances reach the editor through I18nextProvider
 * only: installed with initReactI18next they would leak German into every
 * other test in this worker.
 */
describe("MarkdownEditor in the page's language", () => {
  const german: i18n = createInstance();
  const germanWithoutEditorWords: i18n = createInstance();

  beforeAll(async () => {
    await german.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            "Type your content here...": "Geben Sie hier Ihren Text ein...",
            "Type your markdown here...": "Geben Sie hier Ihr Markdown ein...",
            "Formatting help": "Hilfe zur Formatierung",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    await germanWithoutEditorWords.init({
      lng: "de",
      resources: { de: { translation: { Submit: "Senden" } } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  test("shows its placeholders and its help's heading in the locale's words", () => {
    render(
      <I18nextProvider i18n={german}>
        <MarkdownEditor initialValue="" />
      </I18nextProvider>,
    );

    expect(editableOf()).toHaveAttribute(
      "data-placeholder",
      "Geben Sie hier Ihren Text ein...",
    );
    expect(screen.getByText("Hilfe zur Formatierung")).toBeInTheDocument();
    expect(screen.queryByText("Formatting help")).toBeNull();

    expect(switchToMarkdown()).toHaveAttribute(
      "placeholder",
      "Geben Sie hier Ihr Markdown ein...",
    );
  });

  test("falls back to the English when the locale has no entry for them", () => {
    render(
      <I18nextProvider i18n={germanWithoutEditorWords}>
        <MarkdownEditor initialValue="" />
      </I18nextProvider>,
    );

    expect(editableOf()).toHaveAttribute(
      "data-placeholder",
      "Type your content here...",
    );
    expect(screen.getByText("Formatting help")).toBeInTheDocument();

    expect(switchToMarkdown()).toHaveAttribute(
      "placeholder",
      "Type your markdown here...",
    );
  });

  // A form field hands the editor a placeholder it has already translated.
  test("shows a placeholder it is given as it is", () => {
    render(
      <I18nextProvider i18n={german}>
        <MarkdownEditor
          initialValue=""
          placeholder="Beschreiben Sie, was nicht funktioniert"
        />
      </I18nextProvider>,
    );

    expect(editableOf()).toHaveAttribute(
      "data-placeholder",
      "Beschreiben Sie, was nicht funktioniert",
    );
    expect(switchToMarkdown()).toHaveAttribute(
      "placeholder",
      "Beschreiben Sie, was nicht funktioniert",
    );
  });
});
