import {
  CODE_EDITOR_DEFAULT_MAX_HEIGHT,
  CODE_EDITOR_DEFAULT_MIN_LINES,
  CODE_EDITOR_LINE_HEIGHT_PX,
  CODE_EDITOR_PADDING_X_PX,
  CODE_EDITOR_PADDING_Y_PX,
  toEditorText,
} from "../../../../UI/Components/CodeEditor/CodeEditor";
import * as CodeEditorSize from "../../../../UI/Components/CodeEditor/CodeEditorSize";
import { countLines } from "../../../../UI/Components/CodeEditor/CodeEditorCommands";
import { describe, expect, test } from "@jest/globals";

/*
 * How much room a code editor takes, read by the editor and by what draws in
 * its place until its file has arrived (LazyCodeEditor): one set of numbers,
 * so the place cannot be another size. The editor's own use of them is held
 * to its stylesheet by CodeEditorStyles.test.ts, and to the place in a real
 * browser by packages/E2E/CodeEditor/FormFieldLoading.spec.ts.
 */

const { getCodeEditorContentHeight } = CodeEditorSize;

describe("the numbers the code editor reads", () => {
  test("are these, wherever they are imported from", () => {
    expect(CodeEditorSize.CODE_EDITOR_LINE_HEIGHT_PX).toBe(
      CODE_EDITOR_LINE_HEIGHT_PX,
    );
    expect(CodeEditorSize.CODE_EDITOR_PADDING_Y_PX).toBe(
      CODE_EDITOR_PADDING_Y_PX,
    );
    expect(CodeEditorSize.CODE_EDITOR_PADDING_X_PX).toBe(
      CODE_EDITOR_PADDING_X_PX,
    );
    expect(CodeEditorSize.CODE_EDITOR_DEFAULT_MIN_LINES).toBe(
      CODE_EDITOR_DEFAULT_MIN_LINES,
    );
    expect(CodeEditorSize.CODE_EDITOR_DEFAULT_MAX_HEIGHT).toBe(
      CODE_EDITOR_DEFAULT_MAX_HEIGHT,
    );
    expect(CodeEditorSize.toEditorText).toBe(toEditorText);
  });
});

describe("getCodeEditorContentHeight", () => {
  const padding: number = 2 * CODE_EDITOR_PADDING_Y_PX;

  test("an empty editor takes its minimum, however few lines it holds", () => {
    expect(getCodeEditorContentHeight("")).toBe(
      CODE_EDITOR_DEFAULT_MIN_LINES * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
    expect(getCodeEditorContentHeight("a\nb")).toBe(
      CODE_EDITOR_DEFAULT_MIN_LINES * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
  });

  test("its minimum is the one it is given", () => {
    expect(getCodeEditorContentHeight("", 12)).toBe(
      12 * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
  });

  test("an editor holding more lines than its minimum takes the room for them", () => {
    const text: string = Array.from({ length: 30 }, () => {
      return "line";
    }).join("\n");

    expect(getCodeEditorContentHeight(text)).toBe(
      30 * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
    expect(getCodeEditorContentHeight(text, 12)).toBe(
      30 * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
  });

  test.each([
    ["no text", ""],
    ["one line", "a"],
    ["a line ending in a break", "a\n"],
    ["only breaks", "\n\n\n\n\n\n\n\n"],
    ["ten lines", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10"],
  ])(
    "counts lines as the editor's line numbers do: %s",
    (_name: string, text: string) => {
      expect(getCodeEditorContentHeight(text, 1)).toBe(
        countLines(text) * CODE_EDITOR_LINE_HEIGHT_PX + padding,
      );
    },
  );

  test("what is not a string is measured as the editor draws it", () => {
    const value: unknown = { retries: 3, url: "https://example.com" };

    // {, two members and } on a line each, as toEditorText writes them out.
    expect(getCodeEditorContentHeight(toEditorText(value as string), 1)).toBe(
      4 * CODE_EDITOR_LINE_HEIGHT_PX + padding,
    );
  });
});

describe("toEditorText", () => {
  test("nothing is no text", () => {
    expect(toEditorText(undefined)).toBe("");
    expect(toEditorText(null as unknown as undefined)).toBe("");
  });

  test("line breaks read as a textarea reads them back", () => {
    expect(toEditorText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
