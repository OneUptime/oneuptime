/*
 * Buttons a caller adds to the code editor's toolbar - the workflow
 * builder's "Insert value" - and what they can do with the document: read it
 * and the selection, and put text in place of the selection as one edit.
 */

import CodeEditor, {
  CodeEditorActions,
} from "../../../../UI/Components/CodeEditor/CodeEditor";
import CodeType from "../../../../Types/Code/CodeType";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React, { ReactNode } from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

interface Captured {
  editor: CodeEditorActions | null;
}

type RenderEditorFunction = (options: {
  value: string;
  readOnly?: boolean;
  onChange?: MockFunction;
}) => Captured;

const renderEditor: RenderEditorFunction = (options: {
  value: string;
  readOnly?: boolean;
  onChange?: MockFunction;
}): Captured => {
  const captured: Captured = { editor: null };

  render(
    <CodeEditor
      type={CodeType.JSON}
      initialValue={options.value}
      readOnly={options.readOnly}
      onChange={options.onChange}
      toolbarActions={(editor: CodeEditorActions): ReactNode => {
        captured.editor = editor;

        return (
          <button
            type="button"
            onClick={() => {
              editor.insertText('"{{local.variables.X}}"');
            }}
          >
            Add X
          </button>
        );
      }}
    />,
  );

  return captured;
};

type InputFunction = () => HTMLTextAreaElement;

const input: InputFunction = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

afterEach(() => {
  cleanup();
});

describe("CodeEditor — toolbar actions", () => {
  test("sit in the toolbar, before the editor's own buttons", () => {
    renderEditor({ value: "{}" });

    const button: HTMLElement = screen.getByRole("button", { name: "Add X" });
    const format: HTMLElement = screen.getByTestId("code-editor-format-button");

    expect(
      button.compareDocumentPosition(format) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("read the document and the selection, even once the editor has lost the focus", () => {
    const captured: Captured = renderEditor({ value: '{"a": }' });

    input().focus();
    input().setSelectionRange(6, 6);
    input().blur();

    expect(captured.editor!.getText()).toBe('{"a": }');
    expect(captured.editor!.getSelection()).toEqual({ start: 6, end: 6 });
  });

  test("put text where the selection was, and report the change", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderEditor({ value: '{"a": }', onChange: onChange });

    input().setSelectionRange(6, 6);
    fireEvent.click(screen.getByRole("button", { name: "Add X" }));

    expect(input().value).toBe('{"a": "{{local.variables.X}}"}');
    expect(onChange).toHaveBeenLastCalledWith('{"a": "{{local.variables.X}}"}');
    // The caret is after it, and the editor has the focus back.
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(6 + '"{{local.variables.X}}"'.length);
  });

  test("replace a selection", () => {
    renderEditor({ value: '{"a": 1}' });

    input().setSelectionRange(6, 7);
    fireEvent.click(screen.getByRole("button", { name: "Add X" }));

    expect(input().value).toBe('{"a": "{{local.variables.X}}"}');
  });

  test("are not shown on a read-only editor", () => {
    renderEditor({ value: "{}", readOnly: true });

    expect(screen.queryByRole("button", { name: "Add X" })).toBeNull();
  });
});
