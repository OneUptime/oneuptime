import "@testing-library/jest-dom";
import React, { ReactElement, useLayoutEffect, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CodeEditor, {
  CODE_EDITOR_DEFAULT_MAX_HEIGHT,
  CODE_EDITOR_DEFAULT_MIN_LINES,
  CODE_EDITOR_KEYS_HINT,
  CODE_EDITOR_LINE_HEIGHT_PX,
  CODE_EDITOR_PADDING_Y_PX,
  CODE_EDITOR_VALIDATION_DEBOUNCE_MS,
  ComponentProps,
  applyEditToTextarea,
  toEditorText,
} from "../../../../UI/Components/CodeEditor/CodeEditor";
import { TextEdit } from "../../../../UI/Components/CodeEditor/CodeEditorCommands";
import CodeType from "../../../../Types/Code/CodeType";

/*
 * The real editor, in jsdom: there is no Monaco to stand in for any more. The
 * one thing jsdom lacks is document.execCommand, so every edit the editor
 * makes itself (indent, pairing, Format...) goes through its fallback - the
 * value written through the prototype setter plus an input event - which is
 * exactly the path that has to keep React's onChange in step.
 */

type GetElementFunction = () => HTMLElement;
type GetInputFunction = () => HTMLTextAreaElement;
type GetTextFunction = () => string;

const getInput: GetInputFunction = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

const getLayer: GetElementFunction = (): HTMLElement => {
  return screen.getByTestId("code-editor-highlight");
};

const layerText: GetTextFunction = (): string => {
  return getLayer().textContent || "";
};

const gutterText: GetTextFunction = (): string => {
  return screen.getByTestId("code-editor-gutter").textContent || "";
};

const statusText: GetTextFunction = (): string => {
  return screen.getByTestId("code-editor-status").textContent || "";
};

const cursorText: GetTextFunction = (): string => {
  return screen.getByTestId("code-editor-cursor").textContent || "";
};

type FocusFunction = () => void;

const focusInput: FocusFunction = (): void => {
  act(() => {
    getInput().focus();
  });
};

type SetSelectionFunction = (start: number, end?: number) => void;

/*
 * Moves the selection the way an arrow key would: the editor re-reads it on
 * keyup. (React's onSelect is not driven by the native `select` event, so
 * firing that would prove nothing.)
 */
const setSelection: SetSelectionFunction = (
  start: number,
  end?: number,
): void => {
  act(() => {
    getInput().setSelectionRange(start, end ?? start);
  });
  fireEvent.keyUp(getInput(), { key: "ArrowRight" });
};

type PressFunction = (key: string, init?: Record<string, unknown>) => boolean;

/** Fires keydown and returns false when the editor called preventDefault. */
const press: PressFunction = (
  key: string,
  init?: Record<string, unknown>,
): boolean => {
  return fireEvent.keyDown(getInput(), { key, ...(init || {}) });
};

type SelectionOfFunction = () => [number, number];

const selectionOf: SelectionOfFunction = (): [number, number] => {
  return [getInput().selectionStart, getInput().selectionEnd];
};

type AdvanceFunction = (ms: number) => void;

const advance: AdvanceFunction = (ms: number): void => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

interface HarnessProps extends Omit<ComponentProps, "value" | "onChange"> {
  initial?: string | undefined;
  onValue?: ((value: string) => void) | undefined;
}

// A parent that feeds every change back, the way a form field does.
const Harness: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const { initial, onValue, ...rest } = props;
  const [value, setValue] = useState<string>(initial || "");

  return (
    <CodeEditor
      {...rest}
      value={value}
      onChange={(next: string) => {
        setValue(next);

        if (onValue) {
          onValue(next);
        }
      }}
    />
  );
};

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("CodeEditor — the value it shows", () => {
  test("renders the value prop when no initialValue is given", () => {
    /*
     * Regression: the Runbook step editors (Bash script, JavaScript script,
     * HTTP headers and body) pass only `value`. An initialValue effect used to
     * run after the value effect on mount and blank the editor, so saved
     * scripts came back empty on reload.
     */
    const script: string = 'echo "Runbook step running"';

    render(<CodeEditor type={CodeType.Bash} value={script} />);

    expect(getInput().value).toBe(script);
    expect(layerText()).toBe(script + "\n");
  });

  test("has the value on its very first commit, not after an effect repairs it", () => {
    const script: string = "df -h | head -5";
    const seen: Array<string> = [];

    /*
     * A layout effect in a later sibling runs after the editor's first DOM
     * commit and before any passive effect - so what it reads is what the
     * first render produced, before the prop-sync effect could fix anything.
     */
    const Probe: () => null = (): null => {
      useLayoutEffect(() => {
        seen.push(getInput().value, layerText());
      }, []);

      return null;
    };

    render(
      <>
        <CodeEditor type={CodeType.Text} value={script} />
        <Probe />
      </>,
    );

    expect(seen).toEqual([script, script + "\n"]);
  });

  test("renders the initialValue prop when no value is given", () => {
    const json: string = '{ "Authorization": "Bearer token" }';

    render(<CodeEditor type={CodeType.JSON} initialValue={json} />);

    expect(getInput().value).toBe(json);
  });

  test("prefers value over initialValue when both are given", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        initialValue={'{ "stale": true }'}
        value={'{ "current": true }'}
      />,
    );

    expect(getInput().value).toBe('{ "current": true }');
  });

  test("follows the value prop when it changes after mount", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.JavaScript} value="return 1;" />,
    );

    rerender(<CodeEditor type={CodeType.JavaScript} value="return 2;" />);

    expect(getInput().value).toBe("return 2;");
    expect(layerText()).toBe("return 2;\n");
  });

  test("picks up a value that only arrives after the first render", () => {
    // Pages that load the model asynchronously render once with nothing.
    const { rerender } = render(<CodeEditor type={CodeType.Text} />);

    expect(getInput().value).toBe("");

    rerender(<CodeEditor type={CodeType.Text} value="uptime" />);

    expect(getInput().value).toBe("uptime");
  });

  test("follows the initialValue prop when it changes after mount", () => {
    // Form fields recompute initialValue from currentValues on every keystroke.
    const { rerender } = render(
      <CodeEditor type={CodeType.JavaScript} initialValue="return 1;" />,
    );

    rerender(
      <CodeEditor type={CodeType.JavaScript} initialValue="return 2;" />,
    );

    expect(getInput().value).toBe("return 2;");
  });

  test("reports edits to onChange", () => {
    const onChange: jest.Mock = jest.fn();

    render(
      <CodeEditor type={CodeType.Text} value="before" onChange={onChange} />,
    );

    fireEvent.change(getInput(), { target: { value: "after" } });

    expect(onChange).toHaveBeenCalledWith("after");
    expect(layerText()).toBe("after\n");
  });

  test("typing is reflected even when the parent does not feed the value back", () => {
    render(<CodeEditor type={CodeType.Text} />);

    fireEvent.change(getInput(), { target: { value: "typed" } });

    expect(getInput().value).toBe("typed");
  });

  test("stringifies a non-string value", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={{ hello: "world" } as unknown as string}
      />,
    );

    expect(getInput().value).toBe(JSON.stringify({ hello: "world" }, null, 4));
  });

  test("normalises CRLF, because a textarea always reads back with LF", () => {
    render(<CodeEditor type={CodeType.Text} value={"a\r\nb\rc"} />);

    expect(getInput().value).toBe("a\nb\nc");
    // One character out of step per line would shift every glyph after it.
    expect(layerText()).toBe("a\nb\nc\n");
  });
});

describe("CodeEditor — toEditorText", () => {
  test.each([
    [undefined, ""],
    [null, ""],
    ["plain", "plain"],
    ["a\r\nb", "a\nb"],
    ["a\rb", "a\nb"],
  ])("%p becomes %p", (input: unknown, expected: string) => {
    expect(toEditorText(input as string | undefined)).toBe(expected);
  });

  test("an object is pretty-printed with four spaces", () => {
    expect(toEditorText({ a: [1] } as unknown as string)).toBe(
      '{\n    "a": [\n        1\n    ]\n}',
    );
  });
});

describe("CodeEditor — the highlighted layer under the textarea", () => {
  test("holds exactly the document's characters, plus the newline that shows an empty last line", () => {
    const text: string = '{\n  "name": "api",\n  "retries": 3\n}\n';

    render(<CodeEditor type={CodeType.JSON} value={text} />);

    expect(layerText()).toBe(text + "\n");
  });

  test("colours tokens with highlight.js spans", () => {
    render(<CodeEditor type={CodeType.JSON} value={'{"retries": 3}'} />);

    expect(getLayer().querySelector(".hljs-attr")?.textContent).toBe(
      '"retries"',
    );
    expect(getLayer().querySelector(".hljs-number")?.textContent).toBe("3");
  });

  test("plain text gets no token spans", () => {
    render(<CodeEditor type={CodeType.Text} value={'{"retries": 3}'} />);

    expect(getLayer().querySelectorAll("span")).toHaveLength(0);
  });

  test.each([CodeType.Text, CodeType.HTML, CodeType.Markdown, CodeType.JSON])(
    "markup in a %s document is shown, never injected",
    (type: CodeType) => {
      const hostile: string =
        '<img src=x onerror="alert(1)"><script>x()</script>';

      render(<CodeEditor type={type} value={hostile} />);

      expect(getLayer().querySelector("img")).toBeNull();
      expect(getLayer().querySelector("script")).toBeNull();
      expect(layerText()).toBe(hostile + "\n");
    },
  );

  test("the layer is hidden from assistive technology", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(getLayer()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("code-editor-gutter")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("a type change after mount re-highlights with the new grammar", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.Text} value={'{"a": 1}'} />,
    );

    expect(getLayer().querySelectorAll("span")).toHaveLength(0);
    expect(screen.getByTestId("code-editor-language")).toHaveTextContent(
      "Text",
    );

    rerender(<CodeEditor type={CodeType.JSON} value={'{"a": 1}'} />);

    expect(getLayer().querySelector(".hljs-attr")).not.toBeNull();
    expect(screen.getByTestId("code-editor-language")).toHaveTextContent(
      "JSON",
    );
    expect(
      document.querySelector('[data-code-type="json"]'),
    ).toBeInTheDocument();
  });

  test.each([
    [CodeType.JSON, "JSON"],
    [CodeType.YAML, "YAML"],
    [CodeType.JavaScript, "JavaScript"],
    [CodeType.CSS, "CSS"],
    [CodeType.HTML, "HTML"],
    [CodeType.SQL, "SQL"],
    [CodeType.Bash, "Bash"],
    [CodeType.Markdown, "Markdown"],
    [CodeType.Text, "Text"],
  ])("%s is labelled %s in the toolbar", (type: CodeType, label: string) => {
    render(<CodeEditor type={type} value="" />);

    expect(screen.getByTestId("code-editor-language")).toHaveTextContent(label);
  });
});

describe("CodeEditor — the line number gutter", () => {
  test("numbers every line, including an empty last one", () => {
    render(<CodeEditor type={CodeType.JSON} value={"{\n}\n"} />);

    expect(gutterText()).toBe("1\n2\n3");
  });

  test("an empty document still has line 1", () => {
    render(<CodeEditor type={CodeType.JSON} value="" />);

    expect(gutterText()).toBe("1");
  });

  test("grows as lines are added", () => {
    render(<CodeEditor type={CodeType.Text} value="a" />);

    fireEvent.change(getInput(), { target: { value: "a\nb\nc\nd" } });

    expect(gutterText()).toBe("1\n2\n3\n4");
  });

  test("marks the caret's line while the editor has focus, and only then", () => {
    render(<CodeEditor type={CodeType.Text} value={"one\ntwo\nthree"} />);

    expect(document.querySelector(".ou-code-editor__gutter-active")).toBeNull();

    focusInput();
    setSelection(5);

    expect(
      document.querySelector(".ou-code-editor__gutter-active")?.textContent,
    ).toBe("2");
    expect(gutterText()).toBe("1\n2\n3");

    fireEvent.blur(getInput());

    expect(document.querySelector(".ou-code-editor__gutter-active")).toBeNull();
  });

  test("the current-line band sits on the caret's line", () => {
    render(<CodeEditor type={CodeType.Text} value={"one\ntwo\nthree"} />);

    focusInput();
    setSelection(9);

    expect(screen.getByTestId("code-editor-active-line")).toHaveStyle({
      top: `${CODE_EDITOR_PADDING_Y_PX + 2 * CODE_EDITOR_LINE_HEIGHT_PX}px`,
    });
  });

  test("no current-line band over a selection", () => {
    render(<CodeEditor type={CodeType.Text} value={"one\ntwo"} />);

    focusInput();
    setSelection(0, 5);

    expect(screen.queryByTestId("code-editor-active-line")).toBeNull();
  });

  test("marks the line of a JSON syntax error", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={'{\n  "name": "api",\n  "retries": 3,\n}'}
      />,
    );

    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("3");
  });

  test("marks the line of a YAML syntax error", () => {
    render(
      <CodeEditor
        type={CodeType.YAML}
        value={"detection:\n\tselection: 1\n"}
      />,
    );

    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("2");
  });

  test("the error mark only moves once the debounced check has run", () => {
    jest.useFakeTimers();

    render(<Harness type={CodeType.JSON} initial={'{"a": 1}'} />);

    expect(document.querySelector(".ou-code-editor__gutter-error")).toBeNull();

    fireEvent.change(getInput(), { target: { value: '{"a": 1,\n}' } });

    advance(CODE_EDITOR_VALIDATION_DEBOUNCE_MS - 1);
    expect(document.querySelector(".ou-code-editor__gutter-error")).toBeNull();

    advance(1);
    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("1");
  });

  test("clicking a line number selects that line", () => {
    render(<CodeEditor type={CodeType.Text} value={"a\nbb\nccc"} />);

    // jsdom lays the gutter out at 0,0: line 2 starts one row down.
    const prevented: boolean = !fireEvent.mouseDown(
      screen.getByTestId("code-editor-gutter"),
      {
        button: 0,
        clientY: CODE_EDITOR_PADDING_Y_PX + CODE_EDITOR_LINE_HEIGHT_PX + 5,
      },
    );

    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(getInput());
    expect(selectionOf()).toEqual([2, 5]);
  });

  test("clicking below the last line selects the last line", () => {
    render(<CodeEditor type={CodeType.Text} value={"a\nbb"} />);

    fireEvent.mouseDown(screen.getByTestId("code-editor-gutter"), {
      button: 0,
      clientY: 500,
    });

    expect(selectionOf()).toEqual([2, 4]);
  });

  test("a right click on the gutter is left alone", () => {
    render(<CodeEditor type={CodeType.Text} value={"a\nbb"} />);

    expect(
      fireEvent.mouseDown(screen.getByTestId("code-editor-gutter"), {
        button: 2,
        clientY: 5,
      }),
    ).toBe(true);
  });

  test("showLineNumbers={false} hides the gutter", () => {
    render(
      <CodeEditor type={CodeType.JSON} value="{}" showLineNumbers={false} />,
    );

    expect(screen.queryByTestId("code-editor-gutter")).toBeNull();
  });

  test("wrapped prose has no gutter: a wrapped line has no single number row", () => {
    render(<CodeEditor type={CodeType.Markdown} value="# Notes" />);

    expect(screen.queryByTestId("code-editor-gutter")).toBeNull();
  });
});

describe("CodeEditor — the status bar", () => {
  test("an empty JSON document says so instead of claiming an error", () => {
    render(<CodeEditor type={CodeType.JSON} value="" />);

    expect(statusText()).toBe("Nothing entered yet.");
  });

  test("valid JSON is confirmed, with a line count", () => {
    render(<CodeEditor type={CodeType.JSON} value={'{\n  "a": 1\n}'} />);

    expect(statusText()).toBe("Valid JSON · 3 lines");
  });

  test("a one-line document says line, not lines", () => {
    render(<CodeEditor type={CodeType.JSON} value="[]" />);

    expect(statusText()).toBe("Valid JSON · 1 line");
  });

  test("broken JSON is reported with what to do and where", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={'{\n  "name": "api",\n  "retries": 3,\n}'}
      />,
    );

    expect(statusText()).toBe(
      "Trailing comma: remove the ',' before '}' (line 3, column 15)",
    );
  });

  test("valid YAML is confirmed", () => {
    render(<CodeEditor type={CodeType.YAML} value={"a: 1\nb: 2"} />);

    expect(statusText()).toBe("Valid YAML · 2 lines");
  });

  test("a template placeholder standing in for a value still parses", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={'{"retries": {{local.variables.count}}}'}
      />,
    );

    expect(statusText()).toBe("Valid JSON · 1 line");
  });

  test("a template loop is reported as unchecked, not as broken and not as valid", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={"[{{#each items}}{{this}},{{/each}}]"}
      />,
    );

    expect(statusText()).toBe(
      "Contains template expressions — syntax not checked.",
    );
    expect(document.querySelector(".ou-code-editor__gutter-error")).toBeNull();
  });

  test("allowJSON5 judges the document by JSON5's rules", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.JSON} value="{a: 1,}" />,
    );

    expect(statusText()).toBe(
      "Property names must be wrapped in double quotes (line 1, column 2)",
    );

    rerender(
      <CodeEditor type={CodeType.JSON} value="{a: 1,}" allowJSON5={true} />,
    );

    expect(statusText()).toBe("Valid JSON · 1 line");
  });

  test("JSON5 errors are located too", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={"{\n  a: ]\n}"}
        allowJSON5={true}
      />,
    );

    expect(statusText()).toMatch(/\(line 2, column 6\)$/);
    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("2");
  });

  test.each([
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.SQL,
    CodeType.Bash,
    CodeType.Markdown,
    CodeType.Text,
  ])(
    "%s has nothing to validate, so the status says nothing",
    (type: CodeType) => {
      render(<CodeEditor type={type} value="anything at all {" />);

      expect(statusText()).toBe("");
    },
  );

  test("a form error is shown for a language with no validator", () => {
    render(
      <CodeEditor
        type={CodeType.JavaScript}
        value="return 1;"
        error="Script is required."
      />,
    );

    expect(statusText()).toBe("Script is required.");
  });

  test("the form's error wins over the parser once the check has caught up", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value='{"a": 1,}'
        error="Allowed Origins is not valid JSON."
      />,
    );

    expect(statusText()).toBe("Allowed Origins is not valid JSON.");
  });

  test("the error text appears exactly once in the whole component", () => {
    const message: string = "Allowed Origins is required.";

    render(<CodeEditor type={CodeType.JSON} value="" error={message} />);

    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  test("it is announced politely rather than interrupting", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(screen.getByTestId("code-editor-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("code-editor-status")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  describe("the check is debounced", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    test("a keystroke does not immediately re-judge the document", () => {
      render(<Harness type={CodeType.JSON} initial={'{"a": 1}'} />);

      expect(statusText()).toBe("Valid JSON · 1 line");

      fireEvent.change(getInput(), { target: { value: '{"a": ' } });

      advance(CODE_EDITOR_VALIDATION_DEBOUNCE_MS - 1);
      expect(statusText()).toBe("Valid JSON · 1 line");

      advance(1);
      expect(statusText()).toBe(
        "Unexpected end of JSON: expected a value (line 1, column 7)",
      );
    });

    test("only the settled text is judged, not every intermediate one", () => {
      render(<Harness type={CodeType.JSON} initial="[]" />);

      fireEvent.change(getInput(), { target: { value: "[1" } });
      advance(50);
      fireEvent.change(getInput(), { target: { value: "[1," } });
      advance(50);
      fireEvent.change(getInput(), { target: { value: "[1, 2]" } });

      expect(statusText()).toBe("Valid JSON · 1 line");

      advance(CODE_EDITOR_VALIDATION_DEBOUNCE_MS);
      expect(statusText()).toBe("Valid JSON · 1 line");
    });

    test("an undebounced form error does not overtake the debounced check", () => {
      /*
       * A form re-validates on every keystroke, so props.error arrives
       * undebounced. Letting it win at once would put a red message under a
       * half-typed line and defeat the debounce.
       */
      const { rerender } = render(
        <CodeEditor type={CodeType.JSON} value="[]" />,
      );

      rerender(
        <CodeEditor
          type={CodeType.JSON}
          value="["
          error="Config is not valid."
        />,
      );

      // Replaced from outside, so judged at once: settled, and the error shows.
      expect(statusText()).toBe("Config is not valid.");

      fireEvent.change(getInput(), { target: { value: "[1" } });

      expect(statusText()).not.toBe("Config is not valid.");

      advance(CODE_EDITOR_VALIDATION_DEBOUNCE_MS);
      expect(statusText()).toBe("Config is not valid.");
    });

    test("a document replaced from outside is judged at once", () => {
      const { rerender } = render(
        <CodeEditor type={CodeType.JSON} value="[]" />,
      );

      rerender(<CodeEditor type={CodeType.JSON} value="[1,]" />);

      expect(statusText()).toBe(
        "Trailing comma: remove the ',' before ']' (line 1, column 3)",
      );
    });

    test("clearing the document says so once the check catches up", () => {
      render(<Harness type={CodeType.JSON} initial="[]" />);

      fireEvent.change(getInput(), { target: { value: "" } });
      advance(CODE_EDITOR_VALIDATION_DEBOUNCE_MS);

      expect(statusText()).toBe("Nothing entered yet.");
    });
  });
});

describe("CodeEditor — the cursor position", () => {
  test("starts at Ln 1, Col 1", () => {
    render(<CodeEditor type={CodeType.Text} value={"abc\ndef"} />);

    expect(cursorText()).toBe("Ln 1, Col 1");
  });

  test("follows the caret", () => {
    render(<CodeEditor type={CodeType.Text} value={"abc\ndef"} />);

    focusInput();
    setSelection(6);

    expect(cursorText()).toBe("Ln 2, Col 3");
  });

  test("counts a selection", () => {
    render(<CodeEditor type={CodeType.Text} value={"abc\ndef"} />);

    focusInput();
    setSelection(1, 6);

    expect(cursorText()).toBe("Ln 2, Col 3 (5 selected)");
  });

  test("reports the end the caret is on for a backwards selection", () => {
    render(<CodeEditor type={CodeType.Text} value={"abc\ndef"} />);

    focusInput();
    act(() => {
      getInput().setSelectionRange(1, 6, "backward");
    });
    fireEvent.keyUp(getInput(), { key: "ArrowLeft", shiftKey: true });

    expect(cursorText()).toBe("Ln 1, Col 2 (5 selected)");
  });
});

describe("CodeEditor — placeholder and example", () => {
  test("the placeholder is drawn in the empty editor and is never the value", () => {
    const onChange: jest.Mock = jest.fn();

    render(
      <CodeEditor
        type={CodeType.JSON}
        value=""
        placeholder={'{ "Authorization": "Bearer ..." }'}
        onChange={onChange}
      />,
    );

    expect(getInput().value).toBe("");
    expect(
      document.querySelector(".ou-code-editor__placeholder")?.textContent,
    ).toBe('{ "Authorization": "Bearer ..." }');
    // Kept on the textarea for assistive technology; the layer draws it.
    expect(getInput()).toHaveAttribute(
      "placeholder",
      '{ "Authorization": "Bearer ..." }',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  test("typing replaces the placeholder with the document", () => {
    render(<Harness type={CodeType.JSON} placeholder="Paste JSON here." />);

    fireEvent.change(getInput(), { target: { value: "{}" } });

    expect(document.querySelector(".ou-code-editor__placeholder")).toBeNull();
    expect(layerText()).toBe("{}\n");
  });

  test("a placeholder's markup is escaped", () => {
    render(
      <CodeEditor type={CodeType.Text} value="" placeholder="<b>bold</b>" />,
    );

    expect(getLayer().querySelector("b")).toBeNull();
    expect(layerText()).toBe("<b>bold</b>\n");
  });

  const EXAMPLE: string = "\n// Say hello\nreturn { data: 'Hello' };\n   ";
  const TRIMMED_EXAMPLE: string = "// Say hello\nreturn { data: 'Hello' };";

  test("an example is drawn dimmed and highlighted, without its blank edges", () => {
    render(
      <CodeEditor type={CodeType.JavaScript} value="" example={EXAMPLE} />,
    );

    const example: Element | null = document.querySelector(
      ".ou-code-editor__example",
    );

    expect(example?.textContent).toBe(TRIMMED_EXAMPLE);
    expect(example?.querySelector(".hljs-comment")).not.toBeNull();
    expect(getInput().value).toBe("");
  });

  test("Insert example makes it the document and reports it", () => {
    const onValue: jest.Mock = jest.fn();

    render(
      <Harness
        type={CodeType.JavaScript}
        example={EXAMPLE}
        onValue={onValue}
      />,
    );

    fireEvent.click(screen.getByTestId("code-editor-example-button"));

    expect(getInput().value).toBe(TRIMMED_EXAMPLE);
    expect(onValue).toHaveBeenLastCalledWith(TRIMMED_EXAMPLE);
    expect(document.activeElement).toBe(getInput());
    expect(selectionOf()).toEqual([0, 0]);
    expect(screen.queryByTestId("code-editor-example-button")).toBeNull();
  });

  test("a placeholder wins the empty editor, but the example is still offered", () => {
    render(
      <CodeEditor
        type={CodeType.JavaScript}
        value=""
        placeholder="Write a script."
        example={EXAMPLE}
      />,
    );

    expect(
      document.querySelector(".ou-code-editor__placeholder")?.textContent,
    ).toBe("Write a script.");
    expect(document.querySelector(".ou-code-editor__example")).toBeNull();
    expect(
      screen.getByTestId("code-editor-example-button"),
    ).toBeInTheDocument();
  });

  test("the example is not offered once there is a document", () => {
    render(
      <CodeEditor
        type={CodeType.JavaScript}
        value="return 1;"
        example={EXAMPLE}
      />,
    );

    expect(screen.queryByTestId("code-editor-example-button")).toBeNull();
    expect(document.querySelector(".ou-code-editor__example")).toBeNull();
  });

  test("the example is not offered in a read-only editor", () => {
    render(
      <CodeEditor
        type={CodeType.JavaScript}
        value=""
        example={EXAMPLE}
        readOnly={true}
      />,
    );

    expect(screen.queryByTestId("code-editor-example-button")).toBeNull();
  });
});

describe("CodeEditor — Format", () => {
  test("is offered for JSON only", () => {
    for (const type of [
      CodeType.YAML,
      CodeType.JavaScript,
      CodeType.CSS,
      CodeType.HTML,
      CodeType.SQL,
      CodeType.Bash,
      CodeType.Markdown,
      CodeType.Text,
    ]) {
      render(<CodeEditor type={type} value="{}" />);

      expect([type, screen.queryByTestId("code-editor-format-button")]).toEqual(
        [type, null],
      );

      cleanup();
    }
  });

  test("is not offered in a read-only editor", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" readOnly={true} />);

    expect(screen.queryByTestId("code-editor-format-button")).toBeNull();
  });

  test("is enabled only for strict, valid JSON", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.JSON} value='{"a":1}' />,
    );

    expect(screen.getByTestId("code-editor-format-button")).toBeEnabled();

    const values: Array<string> = ["", "{a: 1}", '{"a": 1,}', '{"n": {{x}}}'];

    const states: Array<[string, boolean]> = values.map(
      (value: string): [string, boolean] => {
        rerender(<CodeEditor type={CodeType.JSON} value={value} />);

        return [
          value,
          (screen.getByTestId("code-editor-format-button") as HTMLButtonElement)
            .disabled,
        ];
      },
    );

    expect(states).toEqual(
      values.map((value: string): [string, boolean] => {
        return [value, true];
      }),
    );

    /*
     * JSON5 is valid for such a field, but reformatting through JSON would
     * drop its comments and unquoted keys: Format stays off.
     */
    rerender(
      <CodeEditor type={CodeType.JSON} value="{a: 1}" allowJSON5={true} />,
    );

    expect(screen.getByTestId("code-editor-format-button")).toBeDisabled();
  });

  test("pretty-prints with two spaces and reports the result", () => {
    const onValue: jest.Mock = jest.fn();

    render(
      <Harness
        type={CodeType.JSON}
        initial={'{"name":"api","tags":["a","b"],"empty":{}}'}
        onValue={onValue}
      />,
    );

    fireEvent.click(screen.getByTestId("code-editor-format-button"));

    const expected: string =
      '{\n  "name": "api",\n  "tags": [\n    "a",\n    "b"\n  ],\n  "empty": {}\n}';

    expect(getInput().value).toBe(expected);
    expect(onValue).toHaveBeenLastCalledWith(expected);
  });

  test("keeps the document's own four-space indentation", () => {
    render(<Harness type={CodeType.JSON} initial={'{\n    "a": [1,2]\n}'} />);

    fireEvent.click(screen.getByTestId("code-editor-format-button"));

    expect(getInput().value).toBe(
      '{\n    "a": [\n        1,\n        2\n    ]\n}',
    );
  });

  test("never changes what the document says", () => {
    render(
      <Harness
        type={CodeType.JSON}
        initial={'{"id":12345678901234567890,"ratio":1.0,"name":"caf\\u00e9"}'}
      />,
    );

    fireEvent.click(screen.getByTestId("code-editor-format-button"));

    expect(getInput().value).toBe(
      '{\n  "id": 12345678901234567890,\n  "ratio": 1.0,\n  "name": "caf\\u00e9"\n}',
    );
  });

  test("Shift+Alt+F formats too, whatever key the layout reports", () => {
    render(<Harness type={CodeType.JSON} initial="[1,2]" />);

    const prevented: boolean = !press("Ï", {
      code: "KeyF",
      shiftKey: true,
      altKey: true,
    });

    expect(prevented).toBe(true);
    expect(getInput().value).toBe("[\n  1,\n  2\n]");
  });

  test("Shift+Alt+F on invalid JSON is left alone", () => {
    render(<Harness type={CodeType.JSON} initial="[1,2" />);

    expect(press("F", { code: "KeyF", shiftKey: true, altKey: true })).toBe(
      true,
    );
    expect(getInput().value).toBe("[1,2");
  });
});

describe("CodeEditor — Copy", () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    writeText = jest.fn(() => {
      return Promise.resolve();
    });

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  test("copies exactly what is in the editor", () => {
    render(<CodeEditor type={CodeType.JSON} value={'{"a": 1}'} />);

    fireEvent.click(screen.getByTestId("code-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith('{"a": 1}');
  });

  test("copies the edited text, not the text it mounted with", () => {
    render(<CodeEditor type={CodeType.JSON} initialValue="[]" />);

    fireEvent.change(getInput(), { target: { value: "[1]" } });
    fireEvent.click(screen.getByTestId("code-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith("[1]");
  });

  test("confirms the copy in the button and to assistive technology, then resets", () => {
    jest.useFakeTimers();

    render(<CodeEditor type={CodeType.YAML} value="a: 1" />);

    const button: HTMLElement = screen.getByTestId("code-editor-copy-button");

    expect(button).toHaveAttribute("aria-label", "Copy YAML to clipboard");

    fireEvent.click(button);

    expect(button).toHaveTextContent("Copied");
    // WCAG 2.5.3: the accessible name contains the visible label.
    expect(button).toHaveAttribute("aria-label", "YAML copied to clipboard");
    expect(
      screen.getAllByRole("status").some((region: HTMLElement): boolean => {
        return (region.textContent || "").includes("YAML copied to clipboard");
      }),
    ).toBe(true);

    advance(1999);
    expect(button).toHaveTextContent("Copied");

    advance(1);
    expect(button).toHaveTextContent("Copy");
    expect(button).not.toHaveTextContent("Copied");
  });

  test("falls back to execCommand('copy') where there is no async clipboard", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    const execCommand: jest.Mock = jest.fn(() => {
      return true;
    });

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
      writable: true,
    });

    render(<CodeEditor type={CodeType.JSON} value="[1, 2]" />);

    focusInput();
    setSelection(1, 2);

    fireEvent.click(screen.getByTestId("code-editor-copy-button"));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByTestId("code-editor-copy-button")).toHaveTextContent(
      "Copied",
    );
    // The caller's selection is put back after the select-all the copy needed.
    expect(selectionOf()).toEqual([1, 2]);
  });

  test("with no way to copy at all, it neither throws nor claims success", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<CodeEditor type={CodeType.JSON} value="[]" />);

    expect(() => {
      fireEvent.click(screen.getByTestId("code-editor-copy-button"));
    }).not.toThrow();
    expect(screen.getByTestId("code-editor-copy-button")).toHaveTextContent(
      "Copy",
    );
    expect(screen.getByTestId("code-editor-copy-button")).not.toHaveTextContent(
      "Copied",
    );
  });

  test("a denied clipboard permission does not throw", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: jest.fn(() => {
          return Promise.reject(new Error("denied"));
        }),
      },
      configurable: true,
    });

    render(<CodeEditor type={CodeType.JSON} value="[]" />);

    expect(() => {
      fireEvent.click(screen.getByTestId("code-editor-copy-button"));
    }).not.toThrow();
  });

  test("there is nothing to copy from an empty editor", () => {
    render(<CodeEditor type={CodeType.JSON} value="" />);

    expect(screen.getByTestId("code-editor-copy-button")).toBeDisabled();
  });
});

describe("CodeEditor — Tab, and the way out", () => {
  test("Tab indents with two spaces and keeps focus", () => {
    const onValue: jest.Mock = jest.fn();

    render(<Harness type={CodeType.JSON} initial="[]" onValue={onValue} />);

    focusInput();
    setSelection(0);

    expect(press("Tab")).toBe(false);
    expect(getInput().value).toBe("  []");
    expect(selectionOf()).toEqual([2, 2]);
    expect(onValue).toHaveBeenLastCalledWith("  []");
  });

  test("Tab goes to the next tab stop, not two spaces further", () => {
    render(<Harness type={CodeType.Text} initial="abc" />);

    focusInput();
    setSelection(3);
    press("Tab");

    expect(getInput().value).toBe("abc ");
    expect(selectionOf()).toEqual([4, 4]);
  });

  test("Tab over a selection inside one line replaces it with indentation", () => {
    render(<Harness type={CodeType.Text} initial="a bc d" />);

    focusInput();
    setSelection(2, 4);
    press("Tab");

    // "bc" becomes the two columns to the next tab stop.
    expect(getInput().value).toBe("a    d");
    expect(selectionOf()).toEqual([4, 4]);
  });

  test("Tab over several lines indents each of them", () => {
    render(<Harness type={CodeType.Text} initial={"a\nb\nc"} />);

    focusInput();
    setSelection(0, 5);
    press("Tab");

    expect(getInput().value).toBe("  a\n  b\n  c");
    expect(selectionOf()).toEqual([0, 11]);
  });

  test("Shift+Tab takes a level off every selected line", () => {
    render(<Harness type={CodeType.Text} initial={"  a\n    b"} />);

    focusInput();
    setSelection(0, 9);

    expect(press("Tab", { shiftKey: true })).toBe(false);
    expect(getInput().value).toBe("a\n  b");
  });

  test("the level is the document's own: four spaces where it uses four", () => {
    render(<Harness type={CodeType.Text} initial={"a\n    b"} />);

    focusInput();
    setSelection(2);
    press("Tab");

    expect(getInput().value).toBe("a\n        b");
  });

  test("Shift+Tab with nothing to take off still keeps focus", () => {
    render(<Harness type={CodeType.Text} initial="a" />);

    focusInput();

    expect(press("Tab", { shiftKey: true })).toBe(false);
    expect(getInput().value).toBe("a");
  });

  test("indents with a tab when the document is indented with tabs", () => {
    render(
      <Harness type={CodeType.JavaScript} initial={"if (a) {\n\tb();\n}"} />,
    );

    focusInput();
    setSelection(9);
    press("Tab");

    expect(getInput().value).toBe("if (a) {\n\t\tb();\n}");
  });

  test("Escape releases Tab to the browser, and says so", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();

    expect(screen.queryByTestId("code-editor-tab-released")).toBeNull();
    expect(press("Escape")).toBe(false);
    expect(screen.getByTestId("code-editor-tab-released")).toHaveTextContent(
      "Tab moves focus",
    );

    // Not prevented: the browser moves focus, as it would for any control.
    expect(press("Tab")).toBe(true);
    expect(getInput().value).toBe("[]");
  });

  test("a second Escape is not swallowed, so a dialog around it can close", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();

    expect(press("Escape")).toBe(false);
    expect(press("Escape")).toBe(true);
  });

  test("Shift+Tab after Escape moves focus backwards too", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();
    press("Escape");

    expect(press("Tab", { shiftKey: true })).toBe(true);
  });

  test("any other key takes Tab back", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();
    press("Escape");
    press("a");

    expect(screen.queryByTestId("code-editor-tab-released")).toBeNull();
    expect(press("Tab")).toBe(false);
  });

  test("a modifier on its own does not take Tab back (Shift+Tab needs Shift first)", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();
    press("Escape");
    press("Shift", { shiftKey: true });

    expect(press("Tab", { shiftKey: true })).toBe(true);
  });

  test("leaving and coming back re-arms Tab", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();
    press("Escape");
    fireEvent.blur(getInput());
    focusInput();

    expect(press("Tab")).toBe(false);
  });

  test("Ctrl+Tab and Alt+Tab belong to the browser and the OS", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();

    expect(press("Tab", { ctrlKey: true })).toBe(true);
    expect(press("Tab", { altKey: true })).toBe(true);
    expect(getInput().value).toBe("[]");
  });

  test("the way out is described to the textarea on the way in", () => {
    render(<CodeEditor type={CodeType.JSON} value="[]" />);

    const describedBy: Array<string> = (
      getInput().getAttribute("aria-describedby") || ""
    ).split(" ");

    expect(
      describedBy.some((id: string): boolean => {
        return (
          document.getElementById(id)?.textContent === CODE_EDITOR_KEYS_HINT
        );
      }),
    ).toBe(true);
    expect(CODE_EDITOR_KEYS_HINT).toMatch(/Escape, then Tab/);
  });
});

describe("CodeEditor — typing", () => {
  test("Enter keeps the line's indentation", () => {
    render(<Harness type={CodeType.Text} initial="    a" />);

    focusInput();
    setSelection(5);

    expect(press("Enter")).toBe(false);
    expect(getInput().value).toBe("    a\n    ");
    expect(selectionOf()).toEqual([10, 10]);
  });

  test("Enter between braces puts the closer on its own line", () => {
    render(<Harness type={CodeType.JSON} initial="{}" />);

    focusInput();
    setSelection(1);
    press("Enter");

    expect(getInput().value).toBe("{\n  \n}");
    expect(selectionOf()).toEqual([4, 4]);
  });

  test("Enter after a YAML key goes one level deeper", () => {
    render(<Harness type={CodeType.YAML} initial="detection:" />);

    focusInput();
    setSelection(10);
    press("Enter");

    expect(getInput().value).toBe("detection:\n  ");
  });

  test("Ctrl+Enter is left to the page (forms submit on it)", () => {
    render(<Harness type={CodeType.Text} initial="a" />);

    focusInput();

    expect(press("Enter", { ctrlKey: true })).toBe(true);
    expect(getInput().value).toBe("a");
  });

  test("an opening brace gets its closer, with the caret between them", () => {
    const onValue: jest.Mock = jest.fn();

    render(<Harness type={CodeType.JSON} initial="" onValue={onValue} />);

    focusInput();

    expect(press("{")).toBe(false);
    expect(getInput().value).toBe("{}");
    expect(selectionOf()).toEqual([1, 1]);
    expect(onValue).toHaveBeenLastCalledWith("{}");
  });

  test("a quote is paired in JSON", () => {
    render(<Harness type={CodeType.JSON} initial="{}" />);

    focusInput();
    setSelection(1);
    press('"');

    expect(getInput().value).toBe('{""}');
    expect(selectionOf()).toEqual([2, 2]);
  });

  test("typing the closer that is already there steps over it", () => {
    const onValue: jest.Mock = jest.fn();

    render(<Harness type={CodeType.JSON} initial="[]" onValue={onValue} />);

    focusInput();
    setSelection(1);

    expect(press("]")).toBe(false);
    expect(getInput().value).toBe("[]");
    expect(selectionOf()).toEqual([2, 2]);
    expect(onValue).not.toHaveBeenCalled();
  });

  test("a bracket over a selection wraps it", () => {
    render(<Harness type={CodeType.JavaScript} initial="a + b" />);

    focusInput();
    setSelection(0, 5);
    press("(");

    expect(getInput().value).toBe("(a + b)");
    expect(selectionOf()).toEqual([1, 6]);
  });

  test("an apostrophe inside a word is typed normally", () => {
    render(<Harness type={CodeType.JavaScript} initial="don" />);

    focusInput();
    setSelection(3);

    // Not handled: the browser types the single character itself.
    expect(press("'")).toBe(true);
    expect(getInput().value).toBe("don");
  });

  test("an AltGr bracket (Ctrl+Alt on Windows) is still paired", () => {
    render(<Harness type={CodeType.JSON} initial="" />);

    focusInput();

    expect(press("{", { ctrlKey: true, altKey: true })).toBe(false);
    expect(getInput().value).toBe("{}");
  });

  test("Ctrl or Cmd with a character is a shortcut, not typing", () => {
    render(<Harness type={CodeType.JSON} initial="" />);

    focusInput();

    expect(press("[", { metaKey: true, shiftKey: true })).toBe(true);
    expect(press("{", { ctrlKey: true })).toBe(true);
    expect(getInput().value).toBe("");
  });

  test("Backspace between an empty pair deletes both halves", () => {
    render(<Harness type={CodeType.JSON} initial="[{}]" />);

    focusInput();
    setSelection(2);

    expect(press("Backspace")).toBe(false);
    expect(getInput().value).toBe("[]");
    expect(selectionOf()).toEqual([1, 1]);
  });

  test("Backspace in the indentation goes back a whole level", () => {
    render(<Harness type={CodeType.YAML} initial={"a:\n  b:\n    c: 1"} />);

    focusInput();
    // After the four spaces that start line 3.
    setSelection(12);

    expect(press("Backspace")).toBe(false);
    expect(getInput().value).toBe("a:\n  b:\n  c: 1");
  });

  test("an ordinary Backspace is left to the browser", () => {
    render(<Harness type={CodeType.Text} initial="abc" />);

    focusInput();
    setSelection(3);

    expect(press("Backspace")).toBe(true);
    expect(getInput().value).toBe("abc");
  });

  test("composition (IME) input is left entirely to the browser", () => {
    render(<Harness type={CodeType.JSON} initial="" />);

    focusInput();

    expect(press("{", { isComposing: true })).toBe(true);
    expect(press("Enter", { keyCode: 229 })).toBe(true);
    expect(getInput().value).toBe("");
  });

  test("an edit the editor makes reaches the textarea's own input event", () => {
    // What keeps React, and a form bound to onChange, in step with the edit.
    const inputs: Array<string> = [];

    render(<Harness type={CodeType.JSON} initial="" />);

    getInput().addEventListener("input", (event: Event) => {
      inputs.push((event.target as HTMLTextAreaElement).value);
    });

    focusInput();
    press("[");

    expect(inputs).toEqual(["[]"]);
  });
});

describe("CodeEditor — commands", () => {
  test.each([
    [CodeType.JavaScript, "const a = 1;", "// const a = 1;"],
    [CodeType.YAML, "a: 1", "# a: 1"],
    [CodeType.SQL, "SELECT 1;", "-- SELECT 1;"],
    [CodeType.Bash, "echo hi", "# echo hi"],
  ])(
    "Ctrl+/ comments out a %s line, and again uncomments it",
    (type: CodeType, before: string, after: string) => {
      render(<Harness type={type} initial={before} />);

      focusInput();

      expect(press("/", { ctrlKey: true })).toBe(false);
      expect(getInput().value).toBe(after);

      press("/", { ctrlKey: true });
      expect(getInput().value).toBe(before);
    },
  );

  test("Cmd+/ does the same on a Mac", () => {
    render(<Harness type={CodeType.JavaScript} initial="a();" />);

    focusInput();
    press("/", { metaKey: true });

    expect(getInput().value).toBe("// a();");
  });

  test("a layout where / is shifted still toggles, by key code", () => {
    render(<Harness type={CodeType.JavaScript} initial="a();" />);

    focusInput();
    press("7", { ctrlKey: true, shiftKey: true, code: "Slash" });

    expect(getInput().value).toBe("// a();");
  });

  test("JSON has no comments, so Ctrl+/ is left alone", () => {
    render(<Harness type={CodeType.JSON} initial="[]" />);

    focusInput();

    expect(press("/", { ctrlKey: true })).toBe(true);
    expect(getInput().value).toBe("[]");
  });

  test("Ctrl+] indents and Ctrl+[ outdents the caret's line", () => {
    render(<Harness type={CodeType.Text} initial={"a\nb"} />);

    focusInput();
    setSelection(2);

    expect(press("]", { ctrlKey: true })).toBe(false);
    expect(getInput().value).toBe("a\n  b");

    expect(press("[", { ctrlKey: true })).toBe(false);
    expect(getInput().value).toBe("a\nb");
  });
});

describe("CodeEditor — read-only", () => {
  test("shows that it is read-only", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" readOnly={true} />);

    expect(screen.getByTestId("code-editor-read-only")).toHaveTextContent(
      "Read-only",
    );
    expect(getInput()).toHaveAttribute("readonly");
  });

  test("ignores every editing key and traps neither Tab nor Escape", () => {
    const onChange: jest.Mock = jest.fn();

    render(
      <CodeEditor
        type={CodeType.JSON}
        value="{}"
        readOnly={true}
        onChange={onChange}
      />,
    );

    focusInput();
    setSelection(1);

    for (const [key, init] of [
      ["Tab", {}],
      ["Tab", { shiftKey: true }],
      ["Escape", {}],
      ["Enter", {}],
      ["Backspace", {}],
      ["{", {}],
      ["/", { ctrlKey: true }],
      ["]", { ctrlKey: true }],
      ["F", { code: "KeyF", shiftKey: true, altKey: true }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect([key, press(key, init)]).toEqual([key, true]);
    }

    expect(getInput().value).toBe("{}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId("code-editor-tab-released")).toBeNull();
  });

  test("has no keyboard hint, because nothing is trapped", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" readOnly={true} />);

    expect(screen.queryByText(CODE_EDITOR_KEYS_HINT)).toBeNull();
  });

  test("can still be copied", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" readOnly={true} />);

    expect(screen.getByTestId("code-editor-copy-button")).toBeEnabled();
  });
});

describe("CodeEditor — accessibility", () => {
  test("the field's label names the textarea, with no competing aria-label", () => {
    render(
      <>
        <span id="the-field-label">Request body</span>
        <CodeEditor
          type={CodeType.JSON}
          value="{}"
          ariaLabelledby="the-field-label"
        />
      </>,
    );

    expect(getInput()).toHaveAttribute("aria-labelledby", "the-field-label");
    expect(getInput()).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("textbox", { name: "Request body" })).toBe(
      getInput(),
    );
  });

  test("with no label at all, it is named after its language", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(getInput()).toHaveAttribute("aria-label", "JSON editor");
  });

  test("an id is applied, and a <label for> names it", () => {
    render(
      <>
        <label htmlFor="step-script">Script</label>
        <CodeEditor type={CodeType.JavaScript} value="" id="step-script" />
      </>,
    );

    expect(getInput()).toHaveAttribute("id", "step-script");
    // aria-label would outrank the <label for>, so none is set.
    expect(getInput()).not.toHaveAttribute("aria-label");
    expect(screen.getByLabelText("Script")).toBe(getInput());
  });

  test("describedby holds the caller's ids, the hint, the keys and the status", () => {
    render(
      <>
        <span id="caller-description">From the caller.</span>
        <CodeEditor
          type={CodeType.JSON}
          value="{}"
          hint="Paste the export."
          ariaDescribedby="caller-description"
        />
      </>,
    );

    const ids: Array<string> = (
      getInput().getAttribute("aria-describedby") || ""
    ).split(" ");

    expect(ids[0]).toBe("caller-description");
    expect(
      ids.map((id: string): string => {
        return document.getElementById(id)?.textContent || "";
      }),
    ).toEqual([
      "From the caller.",
      "Paste the export.",
      CODE_EDITOR_KEYS_HINT,
      "Valid JSON · 1 line",
    ]);
  });

  test("with no status to give, the status is not in the description", () => {
    render(<CodeEditor type={CodeType.JavaScript} value="a();" />);

    const ids: Array<string> = (
      getInput().getAttribute("aria-describedby") || ""
    ).split(" ");

    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0]!)?.textContent).toBe(
      CODE_EDITOR_KEYS_HINT,
    );
  });

  test("an error marks the textarea invalid", () => {
    render(<CodeEditor type={CodeType.JSON} value="{" error="Broken." />);

    expect(getInput()).toHaveAttribute("aria-invalid", "true");
  });

  test("ariaInvalid marks it invalid without an error message", () => {
    render(<CodeEditor type={CodeType.JSON} value="{" ariaInvalid={true} />);

    expect(getInput()).toHaveAttribute("aria-invalid", "true");
  });

  test("a document with only a syntax problem is not announced as invalid", () => {
    // The status bar reports it; invalid-ness is the form's call.
    render(<CodeEditor type={CodeType.JSON} value="{" />);

    expect(getInput()).not.toHaveAttribute("aria-invalid");
  });

  test("the attributes follow their props after mount", () => {
    const { rerender } = render(<CodeEditor type={CodeType.JSON} value="{}" />);

    rerender(<CodeEditor type={CodeType.JSON} value="{" error="Broken." />);

    expect(getInput()).toHaveAttribute("aria-invalid", "true");

    rerender(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(getInput()).not.toHaveAttribute("aria-invalid");
  });

  test("the textarea takes the caller's tabIndex", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" tabIndex={3} />);

    expect(getInput()).toHaveAttribute("tabindex", "3");
  });
});

describe("CodeEditor — spell check, wrapping and autocorrect", () => {
  test.each([
    CodeType.JSON,
    CodeType.YAML,
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.SQL,
    CodeType.Bash,
    CodeType.Text,
  ])(
    "%s is never spell checked, whatever the caller asks",
    (type: CodeType) => {
      render(<CodeEditor type={type} value="x" disableSpellCheck={false} />);

      expect(getInput()).toHaveAttribute("spellcheck", "false");
    },
  );

  test("Markdown is prose, and follows the caller", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.Markdown} value="# hi" />,
    );

    expect(getInput()).toHaveAttribute("spellcheck", "true");

    rerender(
      <CodeEditor
        type={CodeType.Markdown}
        value="# hi"
        disableSpellCheck={true}
      />,
    );

    expect(getInput()).toHaveAttribute("spellcheck", "false");
  });

  test("code does not wrap; prose does", () => {
    const { rerender } = render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(getInput()).toHaveAttribute("wrap", "off");
    expect(document.querySelector(".ou-code-editor--wrap")).toBeNull();

    rerender(<CodeEditor type={CodeType.Markdown} value="# hi" />);

    expect(getInput()).toHaveAttribute("wrap", "soft");
    expect(document.querySelector(".ou-code-editor--wrap")).not.toBeNull();
  });

  test("autocomplete, autocorrect, autocapitalize and Grammarly are off", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(getInput()).toHaveAttribute("autocomplete", "off");
    expect(getInput()).toHaveAttribute("autocorrect", "off");
    expect(getInput()).toHaveAttribute("autocapitalize", "off");
    expect(getInput()).toHaveAttribute("data-gramm", "false");
  });
});

describe("CodeEditor — size", () => {
  test("grows with its content up to a default maximum", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    const scroller: HTMLElement = screen.getByTestId("code-editor-scroller");

    expect(scroller.getAttribute("style") || "").toContain(
      `max-height: ${CODE_EDITOR_DEFAULT_MAX_HEIGHT}`,
    );
    expect(scroller.style.height).toBe("");
  });

  test("a caller can choose the maximum", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" maxHeight="20rem" />);

    expect(screen.getByTestId("code-editor-scroller")).toHaveStyle({
      maxHeight: "20rem",
    });
  });

  test("a fixed height wins over growing", () => {
    render(<CodeEditor type={CodeType.SQL} value="" height="12rem" />);

    const scroller: HTMLElement = screen.getByTestId("code-editor-scroller");

    expect(scroller).toHaveStyle({ height: "12rem" });
    expect(scroller.style.maxHeight).toBe("");
  });

  test("starts at five lines tall, or at minLines", () => {
    const { rerender } = render(<CodeEditor type={CodeType.JSON} value="" />);

    const code: () => HTMLElement = (): HTMLElement => {
      return document.querySelector(".ou-code-editor__code") as HTMLElement;
    };

    expect(code()).toHaveStyle({
      minHeight: `${
        CODE_EDITOR_DEFAULT_MIN_LINES * CODE_EDITOR_LINE_HEIGHT_PX +
        2 * CODE_EDITOR_PADDING_Y_PX
      }px`,
    });

    rerender(<CodeEditor type={CodeType.JSON} value="" minLines={12} />);

    expect(code()).toHaveStyle({
      minHeight: `${12 * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
    });
  });
});

describe("CodeEditor — keeps the caret in view", () => {
  /*
   * jsdom does no layout, so the geometry the arithmetic reads is set by
   * hand: a 100 x 200 viewport, a 40px gutter, 8px characters.
   */
  interface Geometry {
    scroller: HTMLElement;
    scrollTop: () => number;
    scrollLeft: () => number;
  }

  type SetUpFunction = (value: string) => Geometry;

  const setUp: SetUpFunction = (value: string): Geometry => {
    render(<Harness type={CodeType.Text} initial={value} />);

    const scroller: HTMLElement = screen.getByTestId("code-editor-scroller");
    let top: number = 0;
    let left: number = 0;

    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    Object.defineProperty(scroller, "clientWidth", { value: 200 });
    Object.defineProperty(scroller, "scrollTop", {
      get: (): number => {
        return top;
      },
      set: (next: number): void => {
        top = next;
      },
    });
    Object.defineProperty(scroller, "scrollLeft", {
      get: (): number => {
        return left;
      },
      set: (next: number): void => {
        left = next;
      },
    });
    Object.defineProperty(
      screen.getByTestId("code-editor-gutter"),
      "offsetWidth",
      {
        value: 40,
      },
    );

    const measure: HTMLElement = document.querySelector(
      ".ou-code-editor__measure",
    ) as HTMLElement;

    measure.getBoundingClientRect = (): DOMRect => {
      return { width: 32 * 8 } as DOMRect;
    };

    return {
      scroller,
      scrollTop: (): number => {
        return top;
      },
      scrollLeft: (): number => {
        return left;
      },
    };
  };

  const LINES: string = Array.from(
    { length: 30 },
    (_: unknown, index: number) => {
      return `line ${index + 1}`;
    },
  ).join("\n");

  test("scrolls down to a caret below the viewport, with the padding showing", () => {
    const geometry: Geometry = setUp(LINES);

    focusInput();
    // The start of line 20.
    setSelection(LINES.indexOf("line 20"));

    const bottom: number =
      CODE_EDITOR_PADDING_Y_PX + 20 * CODE_EDITOR_LINE_HEIGHT_PX;

    expect(geometry.scrollTop()).toBe(bottom + CODE_EDITOR_PADDING_Y_PX - 100);
  });

  test("scrolls back up to a caret above the viewport", () => {
    const geometry: Geometry = setUp(LINES);

    focusInput();
    setSelection(LINES.indexOf("line 20"));
    setSelection(LINES.indexOf("line 3"));

    expect(geometry.scrollTop()).toBe(2 * CODE_EDITOR_LINE_HEIGHT_PX);
  });

  test("line 1 scrolls all the way to the top", () => {
    const geometry: Geometry = setUp(LINES);

    focusInput();
    setSelection(LINES.length);
    setSelection(0);

    expect(geometry.scrollTop()).toBe(0);
  });

  test("scrolls right to the end of a long line, and back past the gutter for column 1", () => {
    const long: string = "x".repeat(50);
    const geometry: Geometry = setUp(long);

    focusInput();
    setSelection(50);

    // 40 gutter + 12 padding + 50 columns * 8, plus a two-character margin.
    expect(geometry.scrollLeft()).toBe(40 + 12 + 400 + 16 - 200);

    setSelection(0);

    expect(geometry.scrollLeft()).toBe(0);
  });

  test("counts a tab as reaching the next tab stop", () => {
    const geometry: Geometry = setUp("\t\t" + "y".repeat(20));

    focusInput();
    // After two tabs and 16 characters: column 8 + 16 = 24.
    setSelection(18);

    expect(geometry.scrollLeft()).toBe(40 + 12 + 24 * 8 + 16 - 200);
  });

  test("does nothing while the editor does not have focus", () => {
    const geometry: Geometry = setUp(LINES);

    act(() => {
      getInput().setSelectionRange(LINES.length, LINES.length);
    });
    fireEvent.keyUp(getInput(), { key: "End" });

    expect(geometry.scrollTop()).toBe(0);
  });
});

describe("CodeEditor — events and pass-through", () => {
  test("onFocus fires on focus, and onBlur only on a real blur", () => {
    const onFocus: jest.Mock = jest.fn();
    const onBlur: jest.Mock = jest.fn();

    render(<Harness type={CodeType.JSON} onFocus={onFocus} onBlur={onBlur} />);

    focusInput();
    expect(onFocus).toHaveBeenCalledTimes(1);

    /*
     * Monaco's wrapper called onBlur on every change; a form field then
     * counted each keystroke as leaving the field.
     */
    fireEvent.change(getInput(), { target: { value: "[1]" } });
    press("[");
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.blur(getInput());
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("onClick fires for a click anywhere on the editor", () => {
    const onClick: jest.Mock = jest.fn();

    render(<CodeEditor type={CodeType.JSON} value="{}" onClick={onClick} />);

    fireEvent.click(getInput());

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("dataTestId lands on the root, with the language beside it", () => {
    render(
      <CodeEditor type={CodeType.JSON} value="{}" dataTestId="request-body" />,
    );

    const root: HTMLElement = screen.getByTestId("request-body");

    expect(root).toHaveAttribute("data-code-type", "json");
    expect(root).toContainElement(getInput());
  });

  test("an error paints the red border", () => {
    const { rerender } = render(<CodeEditor type={CodeType.JSON} value="{}" />);

    const root: () => HTMLElement = (): HTMLElement => {
      return document.querySelector(".ou-code-editor") as HTMLElement;
    };

    expect(root()).toHaveClass("border-gray-300");
    expect(root()).not.toHaveClass("border-red-300");

    rerender(<CodeEditor type={CodeType.JSON} value="{}" error="Broken." />);

    expect(root()).toHaveClass("border-red-300");
    expect(root()).not.toHaveClass("border-gray-300");
  });

  test("a caller's className is added to the root", () => {
    render(
      <CodeEditor type={CodeType.JSON} value="{}" className="mt-4 custom" />,
    );

    expect(document.querySelector(".ou-code-editor")).toHaveClass(
      "mt-4",
      "custom",
    );
  });

  test("the hint is shown in the toolbar", () => {
    render(
      <CodeEditor type={CodeType.JSON} value="{}" hint="Paste the export." />,
    );

    expect(screen.getByTestId("code-editor-hint")).toHaveTextContent(
      "Paste the export.",
    );
  });

  test("an unknown type falls back to plain text rather than crashing", () => {
    render(
      <CodeEditor type={"cobol" as unknown as CodeType} value="MOVE A TO B." />,
    );

    expect(screen.getByTestId("code-editor-language")).toHaveTextContent(
      "Text",
    );
    expect(layerText()).toBe("MOVE A TO B.\n");
  });
});

describe("applyEditToTextarea", () => {
  let textarea: HTMLTextAreaElement;
  let inputs: Array<string>;

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.value = "hello world";
    inputs = [];
    textarea.addEventListener("input", () => {
      inputs.push(textarea.value);
    });
    textarea.focus();
  });

  afterEach(() => {
    textarea.remove();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  type StubFunction = (
    behaviour: (command: string, value?: string) => boolean,
  ) => jest.Mock;

  const stubExecCommand: StubFunction = (
    behaviour: (command: string, value?: string) => boolean,
  ): jest.Mock => {
    const execCommand: jest.Mock = jest.fn(
      (command: string, _showUi: boolean, value?: string): boolean => {
        return behaviour(command, value);
      },
    );

    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
      writable: true,
    });

    return execCommand;
  };

  // What a browser does for insertText: replace the selection, fire input.
  const browserInsert: (command: string, value?: string) => boolean = (
    command: string,
    value?: string,
  ): boolean => {
    if (command === "insertText") {
      textarea.setRangeText(
        value || "",
        textarea.selectionStart,
        textarea.selectionEnd,
        "end",
      );
    }

    if (command === "delete") {
      textarea.setRangeText(
        "",
        textarea.selectionStart,
        textarea.selectionEnd,
        "end",
      );
    }

    return true;
  };

  const EDIT: TextEdit = {
    from: 6,
    to: 11,
    insert: "there",
    selectionStart: 11,
    selectionEnd: 11,
  };

  test("goes through execCommand, so the edit is one step on the undo stack", () => {
    const execCommand: jest.Mock = stubExecCommand(browserInsert);

    applyEditToTextarea(textarea, EDIT);

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "there");
    expect(textarea.value).toBe("hello there");
    // The browser fires its own input event; no second one is faked.
    expect(inputs).toEqual([]);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([11, 11]);
  });

  test("an empty insertion over a range is a delete", () => {
    const execCommand: jest.Mock = stubExecCommand(browserInsert);

    applyEditToTextarea(textarea, {
      from: 5,
      to: 11,
      insert: "",
      selectionStart: 5,
      selectionEnd: 5,
    });

    expect(execCommand).toHaveBeenCalledWith("delete", false);
    expect(textarea.value).toBe("hello");
  });

  test("a caret move alone touches no text", () => {
    const execCommand: jest.Mock = stubExecCommand(browserInsert);

    applyEditToTextarea(textarea, {
      from: 3,
      to: 3,
      insert: "",
      selectionStart: 4,
      selectionEnd: 4,
    });

    expect(execCommand).not.toHaveBeenCalled();
    expect(inputs).toEqual([]);
    expect(textarea.value).toBe("hello world");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 4]);
  });

  test("writes the value and fires input itself where execCommand is missing", () => {
    applyEditToTextarea(textarea, EDIT);

    expect(textarea.value).toBe("hello there");
    expect(inputs).toEqual(["hello there"]);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([11, 11]);
  });

  test("falls back when execCommand declines", () => {
    stubExecCommand((): boolean => {
      return false;
    });

    applyEditToTextarea(textarea, EDIT);

    expect(textarea.value).toBe("hello there");
    expect(inputs).toEqual(["hello there"]);
  });

  test("falls back when execCommand claims success but leaves the wrong text", () => {
    stubExecCommand((): boolean => {
      return true;
    });

    applyEditToTextarea(textarea, EDIT);

    expect(textarea.value).toBe("hello there");
    expect(inputs).toEqual(["hello there"]);
  });

  test("falls back when execCommand throws", () => {
    stubExecCommand((): boolean => {
      throw new Error("not supported");
    });

    applyEditToTextarea(textarea, EDIT);

    expect(textarea.value).toBe("hello there");
  });
});
