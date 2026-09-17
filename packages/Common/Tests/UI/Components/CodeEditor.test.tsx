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

/*
 * Everything the component pushes onto the MODEL rather than into the options
 * bag. tabSize/insertSpaces live here on purpose - they are global config in
 * monaco's standalone build, so setting them per-editor would have the last
 * editor to mount dictate indentation for every other one on the page.
 */
const mockModelOptionUpdates: Array<Record<string, unknown>> = [];

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
      onMount?: ((editor: unknown, monaco: unknown) => void) | undefined;
    }) => {
      mockEditorRenders.push({
        value: editorProps.value,
        defaultValue: editorProps.defaultValue,
        defaultLanguage: editorProps.defaultLanguage,
        language: editorProps.language,
        height: editorProps.height,
        options: editorProps.options,
      });

      const hostRef: React.MutableRefObject<HTMLDivElement | null> =
        React.useRef<HTMLDivElement | null>(null);

      /*
       * Monaco calls onMount once the editor and its model exist. Child
       * effects run before the parent's, which is the same order the real
       * editor mounts in.
       */
      React.useEffect(() => {
        if (!editorProps.onMount) {
          return;
        }

        editorProps.onMount(
          {
            getDomNode: () => {
              return hostRef.current;
            },
            getModel: () => {
              return {
                updateOptions: (options: Record<string, unknown>) => {
                  mockModelOptionUpdates.push(options);
                },
              };
            },
          },
          {},
        );
        // eslint-disable-next-line
      }, []);

      return (
        <div ref={hostRef}>
          <textarea
            data-testid="monaco"
            value={editorProps.value || ""}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              if (editorProps.onChange) {
                editorProps.onChange(event.target.value);
              }
            }}
          />
        </div>
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
   * A literal tab is illegal as YAML indentation, and Monaco's model defaults
   * are four spaces with the indentation detected from the initial content -
   * so a rule pasted in tab-indented would keep emitting tabs the parser
   * rejects.
   */
  test("two spaces, always spaces - set on this editor's own model", () => {
    mockModelOptionUpdates.length = 0;

    render(<CodeEditor type={CodeType.YAML} value={"a:\n  b: 1"} />);

    expect(mockModelOptionUpdates).toContainEqual({
      tabSize: 2,
      insertSpaces: true,
    });
  });

  /*
   * The regression guard for the reason those three live on the model.
   * tabSize, insertSpaces and detectIndentation are IGlobalEditorOptions:
   * monaco's standalone editor writes every registered `editor.*` key it is
   * constructed with into a PROCESS-WIDE configuration service, and those
   * three are exactly the ones ModelService reads back and pushes onto every
   * model on the page. Put them in the options bag and the last editor to
   * mount silently re-indents all the others.
   */
  test.each(["tabSize", "insertSpaces", "detectIndentation"])(
    "%s is never passed as an editor option - it is global config",
    (key: string) => {
      for (const type of [
        CodeType.YAML,
        CodeType.JSON,
        CodeType.JavaScript,
        CodeType.Markdown,
        CodeType.Text,
      ]) {
        mockEditorRenders.length = 0;

        render(<CodeEditor type={type} value="x" />);

        expect(
          Object.keys((lastRender().options || {}) as Record<string, unknown>),
        ).not.toContain(key);
      }
    },
  );

  test("a non-YAML editor touches no model options at all", () => {
    mockModelOptionUpdates.length = 0;

    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(mockModelOptionUpdates).toHaveLength(0);
  });

  test("the YAML chrome's padding is supplied by the editor", () => {
    expect(yamlOptions()["padding"]).toEqual({ top: 10, bottom: 10 });
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

    expect(options["tabSize"]).toBeUndefined();
    expect(options["insertSpaces"]).toBeUndefined();
    expect(options["detectIndentation"]).toBeUndefined();
  });

  test.each([
    CodeType.JSON,
    CodeType.JavaScript,
    CodeType.CSS,
    CodeType.HTML,
    CodeType.Markdown,
    CodeType.Text,
  ])(
    "%s keeps its scrolling and padding exactly as before",
    (type: CodeType) => {
      const options: Record<string, unknown> = optionsFor(type);

      expect(options["scrollbar"]).toEqual({ horizontal: "hidden" });
      expect(options["scrollBeyondLastLine"]).toBe(true);
      expect(options["padding"]).toBeUndefined();
    },
  );

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
describe("CodeEditor — accessibility lands on Monaco's input, not the wrapper", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  type InputAreaFunction = () => HTMLTextAreaElement;

  const inputArea: InputAreaFunction = (): HTMLTextAreaElement => {
    return screen.getByTestId("monaco") as HTMLTextAreaElement;
  };

  /*
   * The wrapper this component returns is a bare <div>, i.e. role=generic,
   * and ARIA forbids naming one - browsers compute no name for it and
   * assistive technology ignores it. The element that actually takes focus is
   * Monaco's own textarea, whose default name is the string "Editor content".
   */
  test("the field's label names the editor's textarea", () => {
    render(
      <CodeEditor
        type={CodeType.YAML}
        value="a: 1"
        ariaLabelledby="the-field-label"
      />,
    );

    expect(inputArea().getAttribute("aria-labelledby")).toBe("the-field-label");
  });

  test("descriptions are associated with the textarea", () => {
    render(
      <CodeEditor
        type={CodeType.YAML}
        value="a: 1"
        ariaDescribedby="hint-id status-id"
      />,
    );

    expect(inputArea().getAttribute("aria-describedby")).toBe(
      "hint-id status-id",
    );
  });

  test("an invalid document is announced as invalid", () => {
    render(<CodeEditor type={CodeType.YAML} value="a: [" ariaInvalid={true} />);

    expect(inputArea().getAttribute("aria-invalid")).toBe("true");
  });

  test("a valid document carries no aria-invalid at all", () => {
    render(<CodeEditor type={CodeType.YAML} value="a: 1" />);

    expect(inputArea().hasAttribute("aria-invalid")).toBe(false);
  });

  test("the attributes follow their props after mount", () => {
    const { rerender } = render(
      <CodeEditor type={CodeType.YAML} value="a: 1" ariaInvalid={false} />,
    );

    expect(inputArea().hasAttribute("aria-invalid")).toBe(false);

    rerender(
      <CodeEditor type={CodeType.YAML} value="a: [" ariaInvalid={true} />,
    );

    expect(inputArea().getAttribute("aria-invalid")).toBe("true");
  });

  test("no aria attributes are invented when the caller passes none", () => {
    render(<CodeEditor type={CodeType.JSON} value="{}" />);

    expect(inputArea().hasAttribute("aria-labelledby")).toBe(false);
    expect(inputArea().hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("CodeEditor — spell check", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  type SpellCheckFunction = () => boolean;

  const spellCheck: SpellCheckFunction = (): boolean => {
    return (screen.getByTestId("monaco") as HTMLTextAreaElement).spellcheck;
  };

  // YAML is code: squiggles under every Sigma key name are pure noise.
  test("is always off for YAML, whatever the caller asked for", () => {
    render(<CodeEditor type={CodeType.YAML} value="a: 1" />);

    expect(spellCheck()).toBe(false);
  });

  test("is still off for YAML when the caller explicitly enables it", () => {
    render(
      <CodeEditor
        type={CodeType.YAML}
        value="a: 1"
        disableSpellCheck={false}
      />,
    );

    expect(spellCheck()).toBe(false);
  });

  // Markdown is prose, and keeps following the caller exactly as it did.
  test("follows the caller for Markdown", () => {
    render(<CodeEditor type={CodeType.Markdown} value="# hi" />);

    expect(spellCheck()).toBe(true);
  });

  test("is off for Markdown when the caller disables it", () => {
    render(
      <CodeEditor
        type={CodeType.Markdown}
        value="# hi"
        disableSpellCheck={true}
      />,
    );

    expect(spellCheck()).toBe(false);
  });
});
