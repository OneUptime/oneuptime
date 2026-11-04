import "@testing-library/jest-dom";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CodeEditor from "../../../../UI/Components/CodeEditor/CodeEditor";
import { getLoadedCodeHighlighter } from "../../../../UI/Components/CodeEditor/CodeEditorHighlight";
import CodeType from "../../../../Types/Code/CodeType";

/*
 * CodeEditor loads highlight.js's grammars itself, the first time an editor
 * with a grammar is drawn (CodeEditorHighlight, issue #5619). They used to
 * be a static import, and FormField reaches the editor on every form - so
 * every page, the sign-in page among them, downloaded and parsed about 90 KB
 * of grammars before it could draw.
 *
 * What is pinned, in this order (a test file loads the grammars once, so the
 * order is part of the test):
 *
 *   - a plain-text editor never loads them;
 *   - an editor with a grammar is drawn at once, its text plain and in the
 *     same places it will be in colour, and can be typed in;
 *   - the colours come once the grammars arrive, and nothing in the layer
 *     moves;
 *   - an editor drawn after that is in colour from its first frame.
 */

const mockGrammars: { requires: number } = { requires: 0 };

jest.mock("../../../../UI/Components/CodeEditor/CodeEditorGrammars", () => {
  mockGrammars.requires++;
  return jest.requireActual(
    "../../../../UI/Components/CodeEditor/CodeEditorGrammars",
  );
});

const getLayer: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("code-editor-highlight");
};

const getInput: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 10);
    });
  });
};

afterEach(() => {
  cleanup();
});

describe("a plain-text editor", () => {
  test("never loads the grammars", async () => {
    render(<CodeEditor type={CodeType.Text} value={'{"retries": 3}'} />);

    expect(getLayer().textContent).toBe('{"retries": 3}\n');

    await settle();

    expect(mockGrammars.requires).toBe(0);
    expect(getLoadedCodeHighlighter()).toBeNull();
  });
});

describe("an editor with a grammar", () => {
  test("draws its text at once, plain and in place, and in colour once the grammars arrive", async () => {
    const text: string = '{\n  "name": "api",\n  "retries": 3\n}';

    render(<CodeEditor type={CodeType.JSON} value={text} />);

    // The first frame: every character where it will be, no colour yet.
    expect(getLoadedCodeHighlighter()).toBeNull();
    expect(getLayer().textContent).toBe(text + "\n");
    expect(getLayer().querySelectorAll("span")).toHaveLength(0);
    expect(screen.getByTestId("code-editor-gutter").textContent).toBe(
      "1\n2\n3\n4",
    );

    await waitFor(() => {
      expect(getLayer().querySelector(".hljs-attr")).not.toBeNull();
    });

    // In colour, and the same characters in the same order.
    expect(getLayer().textContent).toBe(text + "\n");
    expect(getLayer().querySelector(".hljs-number")?.textContent).toBe("3");
    expect(mockGrammars.requires).toBe(1);
  });

  test("is in colour from its first frame once an editor has loaded the grammars", () => {
    render(<CodeEditor type={CodeType.YAML} value={"level: high"} />);

    expect(getLayer().querySelector(".hljs-attr")?.textContent).toBe("level:");
    expect(mockGrammars.requires).toBe(1);
  });

  test("keeps its layer in step with what is typed", () => {
    render(<CodeEditor type={CodeType.JSON} value="" />);

    fireEvent.change(getInput(), { target: { value: '{"a": 1}' } });

    expect(getLayer().textContent).toBe('{"a": 1}\n');
    expect(getLayer().querySelector(".hljs-attr")?.textContent).toBe('"a"');
  });
});
