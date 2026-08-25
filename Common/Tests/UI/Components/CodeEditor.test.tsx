import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "@jest/globals";
import CodeType from "../../../Types/Code/CodeType";

/*
 * Monaco cannot run in jsdom, so stand in a plain textarea that echoes the
 * props <Editor> is given. Every prop the editor is rendered with is recorded
 * so a test can assert what the model would have been created from - Monaco
 * builds its model from `value || defaultValue` once its async loader
 * resolves, which is after the component's effects have run.
 */
interface RecordedEditorProps {
  value?: string | undefined;
  defaultValue?: string | undefined;
  /*
   * The grammar Monaco would tokenise with, and the option bag it would be
   * configured from. Both are recorded because for YAML they are the feature:
   * the wrong grammar highlights a Sigma rule as HTML, and the wrong
   * indentation options emit tabs the parser rejects.
   */
  defaultLanguage?: string | undefined;
  language?: string | undefined;
  height?: string | undefined;
  options?: Record<string, unknown> | undefined;
}

const mockEditorRenders: Array<RecordedEditorProps> = [];

jest.mock("@monaco-editor/react", () => {
  return {
    __esModule: true,
    loader: {
      config: jest.fn(),
    },
    default: (editorProps: {
      value?: string | undefined;
      defaultValue?: string | undefined;
      defaultLanguage?: string | undefined;
      language?: string | undefined;
      height?: string | undefined;
      options?: Record<string, unknown> | undefined;
      onChange?: ((value: string | undefined) => void) | undefined;
    }) => {
      mockEditorRenders.push({
        value: editorProps.value,
        defaultValue: editorProps.defaultValue,
        defaultLanguage: editorProps.defaultLanguage,
        language: editorProps.language,
        height: editorProps.height,
        options: editorProps.options,
      });

      return (
        <textarea
          data-testid="monaco"
          value={editorProps.value || ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            if (editorProps.onChange) {
              editorProps.onChange(event.target.value);
            }
          }}
        />
      );
    },
  };
});

// Imported after the mock so the module picks up the stand-in editor.
import CodeEditor from "../../../UI/Components/CodeEditor/CodeEditor";

type GetEditor = () => HTMLTextAreaElement;

const getEditor: GetEditor = (): HTMLTextAreaElement => {
  return screen.getByTestId("monaco") as HTMLTextAreaElement;
};

describe("CodeEditor", () => {
  test("renders the value prop when no initialValue is given", () => {
    /*
     * Regression: the Runbook step editors (Bash script, JavaScript script,
     * HTTP headers and body) pass only `value`. An initialValue effect used to
     * run after the value effect on mount and blank the editor, so saved
     * scripts came back empty on reload.
     */
    const script: string = 'echo "Runbook step running"';

    render(<CodeEditor type={CodeType.Text} value={script} />);

    expect(getEditor().value).toBe(script);
  });

  test("seeds the editor with the value on its very first render", () => {
    /*
     * Monaco creates its model asynchronously from whatever value the editor
     * has at that point, so the value has to be right from the first render -
     * not repaired by a later effect.
     */
    const script: string = "df -h | head -5";
    mockEditorRenders.length = 0;

    render(<CodeEditor type={CodeType.Text} value={script} />);

    expect(mockEditorRenders.length).toBeGreaterThan(0);
    expect(
      mockEditorRenders.every((r: RecordedEditorProps) => {
        return r.value === script;
      }),
    ).toBe(true);
  });

  test("renders the initialValue prop when no value is given", () => {
    const json: string = '{ "Authorization": "Bearer token" }';

    render(<CodeEditor type={CodeType.JSON} initialValue={json} />);

    expect(getEditor().value).toBe(json);
  });

  test("prefers value over initialValue when both are given", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        initialValue={'{ "stale": true }'}
        value={'{ "current": true }'}
      />,
    );

    expect(getEditor().value).toBe('{ "current": true }');
  });

  test("follows the value prop when it changes after mount", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.JavaScript} value="return 1;" />,
    );

    expect(getEditor().value).toBe("return 1;");

    rerender(<CodeEditor type={CodeType.JavaScript} value="return 2;" />);

    expect(getEditor().value).toBe("return 2;");
  });

  test("picks up a value that only arrives after the first render", () => {
    // Pages that load the model asynchronously render once with nothing.
    const { rerender } = render(<CodeEditor type={CodeType.Text} />);

    expect(getEditor().value).toBe("");

    rerender(<CodeEditor type={CodeType.Text} value="uptime" />);

    expect(getEditor().value).toBe("uptime");
  });

  test("follows the initialValue prop when it changes after mount", () => {
    // Form fields recompute initialValue from currentValues on every keystroke.
    const { rerender } = render(
      <CodeEditor type={CodeType.JavaScript} initialValue="return 1;" />,
    );

    expect(getEditor().value).toBe("return 1;");

    rerender(
      <CodeEditor type={CodeType.JavaScript} initialValue="return 2;" />,
    );

    expect(getEditor().value).toBe("return 2;");
  });

  test("reports edits to onChange", () => {
    const onChange: jest.Mock = jest.fn();

    render(
      <CodeEditor type={CodeType.Text} value="before" onChange={onChange} />,
    );

    fireEvent.change(getEditor(), { target: { value: "after" } });

    expect(onChange).toHaveBeenCalledWith("after");
  });

  test("stringifies a non-string value", () => {
    render(
      <CodeEditor
        type={CodeType.JSON}
        value={{ hello: "world" } as unknown as string}
      />,
    );

    expect(getEditor().value).toBe(JSON.stringify({ hello: "world" }, null, 4));
  });
});

type LastRenderFunction = () => RecordedEditorProps;

const lastRender: LastRenderFunction = (): RecordedEditorProps => {
  expect(mockEditorRenders.length).toBeGreaterThan(0);

  return mockEditorRenders[mockEditorRenders.length - 1] as RecordedEditorProps;
};

describe("CodeEditor — the grammar Monaco is given", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  test.each([
    [CodeType.YAML, "yaml"],
    [CodeType.JSON, "json"],
    [CodeType.JavaScript, "javascript"],
    [CodeType.CSS, "css"],
    [CodeType.HTML, "html"],
    [CodeType.Markdown, "markdown"],
  ])("%s is handed to Monaco as %s", (type: CodeType, expected: string) => {
    render(<CodeEditor type={type} value="" />);

    expect(lastRender().defaultLanguage).toBe(expected);
  });

  /*
   * `defaultLanguage` is only read when the model is created, so a caller that
   * swaps CodeType after mount keeps the old grammar unless `language` is also
   * passed - the prop that drives setModelLanguage.
   */
  test("the language prop is passed too, so a type change after mount lands", () => {
    const { rerender } = render(<CodeEditor type={CodeType.Text} value="" />);

    expect(lastRender().language).toBe("text");

    rerender(<CodeEditor type={CodeType.YAML} value="" />);

    expect(lastRender().language).toBe("yaml");
  });
});

describe("CodeEditor — YAML gets YAML-safe editing options", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  type YamlOptionsFunction = () => Record<string, unknown>;

  const yamlOptions: YamlOptionsFunction = (): Record<string, unknown> => {
    render(<CodeEditor type={CodeType.YAML} value="title: x" />);

    return (lastRender().options || {}) as Record<string, unknown>;
  };

  /*
   * A literal tab is illegal as YAML indentation, and Monaco's defaults are
   * four spaces with detectIndentation ON - so pasting a tab-indented blob
   * silently reconfigures the editor to emit tabs and the document the user
   * saves is rejected by the parser.
   */
  test("two spaces, always spaces, never re-detected", () => {
    const options: Record<string, unknown> = yamlOptions();

    expect(options["tabSize"]).toBe(2);
    expect(options["insertSpaces"]).toBe(true);
    expect(options["detectIndentation"]).toBe(false);
  });

  test("the gutter is on, because every parse error names a line", () => {
    expect(yamlOptions()["lineNumbers"]).toBe("on");
  });

  /*
   * Wrapping YAML is not an option - the indentation IS the syntax and a
   * wrapped line reads as a deeper one - so the horizontal scrollbar is the
   * only way to reach a long scalar.
   */
  test("long lines stay reachable: no wrapping, but a real scrollbar", () => {
    const options: Record<string, unknown> = yamlOptions();

    expect(options["wordWrap"]).toBe("off");
    expect(options["scrollbar"]).toEqual({ horizontal: "auto" });
  });

  test("whitespace is rendered, because in YAML it is the syntax", () => {
    expect(yamlOptions()["renderWhitespace"]).toBe("boundary");
  });

  test("no blank runway below the last line in a short form field", () => {
    expect(yamlOptions()["scrollBeyondLastLine"]).toBe(false);
  });

  test("folding is on, which YAML's offside rule makes work", () => {
    expect(yamlOptions()["folding"]).toBe(true);
  });
});

describe("CodeEditor — the other languages are left exactly as they were", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  type OptionsForFunction = (type: CodeType) => Record<string, unknown>;

  const optionsFor: OptionsForFunction = (
    type: CodeType,
  ): Record<string, unknown> => {
    render(<CodeEditor type={type} value="x" />);

    return (lastRender().options || {}) as Record<string, unknown>;
  };

  test.each([
    CodeType.JSON,
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.Markdown,
    CodeType.Text,
  ])("%s keeps Monaco's own indentation behaviour", (type: CodeType) => {
    const options: Record<string, unknown> = optionsFor(type);

    expect(options["tabSize"]).toBe(4);
    expect(options["detectIndentation"]).toBe(true);
  });

  test.each([
    CodeType.JSON,
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.Text,
  ])("%s keeps its gutter off unless asked", (type: CodeType) => {
    expect(optionsFor(type)["lineNumbers"]).toBe("off");
  });

  test("showLineNumbers still turns the gutter on for any type", () => {
    render(
      <CodeEditor type={CodeType.JSON} value="{}" showLineNumbers={true} />,
    );

    expect(
      ((lastRender().options || {}) as Record<string, unknown>)["lineNumbers"],
    ).toBe("on");
  });

  test.each([
    CodeType.JSON,
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.Markdown,
  ])("%s keeps rendering no whitespace", (type: CodeType) => {
    expect(optionsFor(type)["renderWhitespace"]).toBe("none");
  });

  test("Markdown still wraps", () => {
    expect(optionsFor(CodeType.Markdown)["wordWrap"]).toBe("on");
  });
});

describe("CodeEditor — height", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  test("defaults to 30vh, as every existing caller expects", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(lastRender().height).toBe("30vh");
  });

  test("a caller can ask for its own", () => {
    render(<CodeEditor type={CodeType.YAML} value="a: 1" height="22rem" />);

    expect(lastRender().height).toBe("22rem");
  });
});

describe("CodeEditor — a YAML placeholder never becomes document text", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  /*
   * `defaultValue` seeds the Monaco model, so anything routed there is real
   * content the user can accidentally save. The JS and CSS arms get away with
   * it by wrapping the hint in a comment; YAML has no such wrapper, so its
   * hint has to go to the help text instead.
   */
  test("the hint is shown as help text, not seeded into the editor", () => {
    render(
      <CodeEditor
        type={CodeType.YAML}
        value=""
        placeholder="Sigma rule YAML — title, logsource, detection and condition."
      />,
    );

    expect(lastRender().defaultValue).toBe("");
    expect(
      screen.getByText(/Sigma rule YAML/, { exact: false }),
    ).toBeInTheDocument();
  });

  test("an empty YAML editor still starts empty when no hint is given", () => {
    render(<CodeEditor type={CodeType.YAML} value="" />);

    expect(lastRender().defaultValue).toBe("");
  });
});
