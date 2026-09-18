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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Monaco cannot run in jsdom, so it is replaced with a textarea that echoes
 * the props <Editor> was given. Every suite that mounts CodeEditor has to
 * declare its own copy of this mock - there is no shared __mocks__ entry - and
 * it must export `loader`, because CodeEditor calls configureMonacoLoader() at
 * module scope.
 */
interface RecordedEditorProps {
  value?: string | undefined;
  defaultLanguage?: string | undefined;
  options?: Record<string, unknown> | undefined;
  readOnly?: boolean | undefined;
  height?: string | undefined;
  /*
   * Recorded so a test can prove what YamlEditor deliberately WITHHOLDS: the
   * chrome owns the border and prints the error once, so neither may reach
   * CodeEditor and be painted a second time.
   */
  className?: string | undefined;
  error?: string | undefined;
}

const mockEditorRenders: Array<RecordedEditorProps> = [];

/*
 * tabSize/insertSpaces are set on the MODEL, not in the options bag: in
 * monaco's standalone build they are global config, so an editor that set
 * them per-instance would re-indent every other editor on the page.
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
      defaultLanguage?: string | undefined;
      options?: Record<string, unknown> | undefined;
      height?: string | undefined;
      className?: string | undefined;
      error?: string | undefined;
      onChange?: ((value: string | undefined) => void) | undefined;
      onMount?: ((editor: unknown, monaco: unknown) => void) | undefined;
    }) => {
      mockEditorRenders.push({
        value: editorProps.value,
        defaultLanguage: editorProps.defaultLanguage,
        options: editorProps.options,
        readOnly: editorProps.options?.["readOnly"] as boolean | undefined,
        height: editorProps.height,
        className: editorProps.className,
        error: editorProps.error,
      });

      const hostRef: React.MutableRefObject<HTMLDivElement | null> =
        React.useRef<HTMLDivElement | null>(null);

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
                updateOptions: (modelOptions: Record<string, unknown>) => {
                  mockModelOptionUpdates.push(modelOptions);
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
import YamlEditor, {
  YAML_VALIDATION_DEBOUNCE_MS,
} from "../../../UI/Components/CodeEditor/YamlEditor";

const VALID_SIGMA_RULE: string = `title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
  condition: selection
`;

type GetEditorFunction = () => HTMLTextAreaElement;

const getEditor: GetEditorFunction = (): HTMLTextAreaElement => {
  return screen.getByTestId("monaco") as HTMLTextAreaElement;
};

type StatusTextFunction = () => string;

const statusText: StatusTextFunction = (): string => {
  return screen.getByTestId("yaml-editor-status").textContent || "";
};

type ExpectStatusFunction = (matcher: RegExp) => Promise<void>;

/*
 * The parse is debounced, so the status bar is always asserted through
 * waitFor rather than read synchronously after a keystroke.
 */
const expectStatus: ExpectStatusFunction = async (
  matcher: RegExp,
): Promise<void> => {
  await waitFor(() => {
    expect(statusText()).toMatch(matcher);
  });
};

beforeEach(() => {
  mockEditorRenders.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("YamlEditor — it is a YAML editor, not a rich text editor", () => {
  /*
   * The bug this component exists for: the "Sigma Rule (YAML)" field rendered
   * the Markdown editor, so a Sigma rule got a Bold button and an H1 button
   * over it - and the value was round-tripped through HTML, which
   * indentation-sensitive YAML does not survive.
   */
  test("Monaco is given the yaml grammar", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(mockEditorRenders[0]?.defaultLanguage).toBe("yaml");
  });

  test("there is no rich-text toolbar anywhere in it", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    for (const label of ["Bold", "Italic", "Heading 1", "Heading 2", "Link"]) {
      expect(screen.queryByTitle(label)).toBeNull();
    }
  });

  test("the header names the language", () => {
    render(<YamlEditor value="" />);

    expect(screen.getByText("YAML")).toBeInTheDocument();
  });

  test("YAML-safe indentation reaches Monaco's model", () => {
    mockModelOptionUpdates.length = 0;

    render(<YamlEditor value="a: 1" />);

    expect(mockModelOptionUpdates).toContainEqual({
      tabSize: 2,
      insertSpaces: true,
    });
  });

  test("the gutter is on, because every parse error names a line", () => {
    render(<YamlEditor value="a: 1" />);

    const options: Record<string, unknown> = (mockEditorRenders[0]?.options ||
      {}) as Record<string, unknown>;

    expect(options["lineNumbers"]).toBe("on");
    expect(options["renderWhitespace"]).toBe("boundary");
  });
});

describe("YamlEditor — the value it shows", () => {
  test("renders the value prop", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(getEditor().value).toBe(VALID_SIGMA_RULE);
  });

  test("renders initialValue when no value is given", () => {
    render(<YamlEditor initialValue="a: 1" />);

    expect(getEditor().value).toBe("a: 1");
  });

  test("prefers value over initialValue", () => {
    render(<YamlEditor initialValue="stale: true" value="current: true" />);

    expect(getEditor().value).toBe("current: true");
  });

  test("follows the value prop after mount", () => {
    const { rerender } = render(<YamlEditor value="a: 1" />);

    expect(getEditor().value).toBe("a: 1");

    rerender(<YamlEditor value="a: 2" />);

    expect(getEditor().value).toBe("a: 2");
  });

  test("picks up a value that only arrives later", () => {
    const { rerender } = render(<YamlEditor />);

    expect(getEditor().value).toBe("");

    rerender(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(getEditor().value).toBe(VALID_SIGMA_RULE);
  });

  test("a non-string value is stringified rather than crashing", () => {
    render(<YamlEditor value={{ a: 1 } as unknown as string} />);

    expect(getEditor().value).toBe(JSON.stringify({ a: 1 }, null, 4));
  });

  test("reports edits to onChange", () => {
    const onChange: jest.Mock = jest.fn();

    render(<YamlEditor value="before: 1" onChange={onChange} />);

    fireEvent.change(getEditor(), { target: { value: "after: 2" } });

    expect(onChange).toHaveBeenCalledWith("after: 2");
  });

  test("typing is reflected even when the parent does not feed the value back", () => {
    // The form field is controlled, but a bare caller may not be.
    render(<YamlEditor />);

    fireEvent.change(getEditor(), { target: { value: "typed: yes" } });

    expect(getEditor().value).toBe("typed: yes");
  });
});

describe("YamlEditor — the status bar tells you whether it parses", () => {
  test("an empty editor says so instead of claiming an error", async () => {
    render(<YamlEditor value="" />);

    await expectStatus(/Nothing entered yet/);
  });

  test("a valid rule is confirmed, with a line count", async () => {
    render(<YamlEditor value={"a: 1\nb: 2\n"} />);

    await expectStatus(/Valid YAML/);
    await expectStatus(/3 lines/);
  });

  test("a one-line document says line, not lines", async () => {
    render(<YamlEditor value="a: 1" />);

    await expectStatus(/1 line(?!s)/);
  });

  /*
   * The parser's own words, not a generic "Invalid YAML." - the reason is the
   * only part of the message that tells the reader what to change.
   */
  test("a broken rule is reported with the parser's reason", async () => {
    render(<YamlEditor value="title: [unclosed" />);

    await expectStatus(/unexpected end of the stream/i);
  });

  test("a misindented rule names the indentation as the problem", async () => {
    render(<YamlEditor value={"a: 1\nb:\n  c: 1\n   d: 2\n"} />);

    await expectStatus(/bad indentation/i);
  });

  test("a tab used for indentation is caught", async () => {
    render(<YamlEditor value={"detection:\n\tselection: 1\n"} />);

    await expectStatus(/tab/i);
  });

  test("the failure names a line, which is why the gutter is on", async () => {
    render(<YamlEditor value={"a: 1\nb:\n  c: 1\n   d: 2\n"} />);

    await expectStatus(/line \d+/);
  });

  test("it re-checks as the document is edited", async () => {
    render(<YamlEditor value="title: [unclosed" />);

    await waitFor(() => {
      expect(statusText()).not.toMatch(/Valid YAML/);
    });

    fireEvent.change(getEditor(), { target: { value: "title: fixed" } });

    await expectStatus(/Valid YAML/);
  });

  /*
   * checkYamlSyntax declines to judge a document whose shape is only known at
   * run time. Claiming it is valid would be a claim about text nobody parsed.
   */
  test("handlebars are reported as unchecked, not as broken and not as valid", async () => {
    render(
      <YamlEditor
        value={"items:\n{{#each hosts}}\n  - {{this}}\n{{/each}}\n"}
      />,
    );

    await expectStatus(/syntax not checked/);
    expect(statusText()).not.toMatch(/Valid YAML/);
  });

  test("a template standing in for a single value still parses", async () => {
    render(<YamlEditor value="threshold: {{local.variables.count}}" />);

    await expectStatus(/Valid YAML/);
  });

  test("it is announced politely rather than interrupting", () => {
    render(<YamlEditor value="a: 1" />);

    const status: HTMLElement = screen.getByTestId("yaml-editor-status");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("YamlEditor — a form error is shown once, not twice", () => {
  /*
   * The form's own message wins whenever there is one, because it is the
   * sentence blocking Save. It must also not reach CodeEditor, which would
   * paint a second red border and print the text a second time under the box.
   */
  test("the form error replaces the live status", async () => {
    render(
      <YamlEditor
        value="title: [unclosed"
        error="Sigma Rule (YAML) is not valid YAML. unexpected end of the stream"
      />,
    );

    await expectStatus(/unexpected end of the stream/);
  });

  test("the error text appears exactly once in the whole component", () => {
    const message: string = "Sigma Rule (YAML) is required.";

    render(<YamlEditor value="" error={message} />);

    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  test("a valid document with a form error still shows the error", async () => {
    render(<YamlEditor value="a: 1" error="Something else is wrong." />);

    await expectStatus(/Something else is wrong/);
    expect(statusText()).not.toMatch(/Valid YAML/);
  });

  test("clearing the error hands the status bar back to the parser", async () => {
    const { rerender } = render(
      <YamlEditor value="a: 1" error="Something else is wrong." />,
    );

    await expectStatus(/Something else is wrong/);

    rerender(<YamlEditor value="a: 1" />);

    await expectStatus(/Valid YAML/);
  });
});

describe("YamlEditor — copying the document", () => {
  type WriteTextMock = jest.Mock;

  let writeText: WriteTextMock;

  beforeEach(() => {
    writeText = jest.fn(() => {
      return Promise.resolve();
    });

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  test("copies exactly what is in the editor", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith(VALID_SIGMA_RULE);
  });

  test("copies the edited text, not the text it mounted with", () => {
    render(<YamlEditor initialValue="old: 1" />);

    fireEvent.change(getEditor(), { target: { value: "new: 2" } });
    fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith("new: 2");
  });

  test("confirms the copy", async () => {
    render(<YamlEditor value="a: 1" />);

    fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));

    await waitFor(() => {
      expect(screen.getByTestId("yaml-editor-copy-button")).toHaveTextContent(
        "Copied",
      );
    });
  });

  test("there is nothing to copy from an empty editor", () => {
    render(<YamlEditor value="" />);

    expect(screen.getByTestId("yaml-editor-copy-button")).toBeDisabled();
  });

  test("a browser with no clipboard API does not throw", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<YamlEditor value="a: 1" />);

    expect(() => {
      fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));
    }).not.toThrow();
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

    render(<YamlEditor value="a: 1" />);

    expect(() => {
      fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));
    }).not.toThrow();
  });
});

describe("YamlEditor — the hint above the editor", () => {
  test("says how YAML indentation works when the caller has nothing to add", () => {
    render(<YamlEditor value="" />);

    expect(screen.getByTestId("yaml-editor-hint").textContent).toMatch(
      /2 spaces/,
    );
    expect(screen.getByTestId("yaml-editor-hint").textContent).toMatch(
      /[Tt]abs/,
    );
  });

  test("a caller's placeholder replaces it", () => {
    render(<YamlEditor value="" placeholder="Sigma rule YAML." />);

    expect(screen.getByTestId("yaml-editor-hint")).toHaveTextContent(
      "Sigma rule YAML.",
    );
  });

  /*
   * The hint must never be seeded into the document: whatever Monaco is given
   * as its initial content is text the user can accidentally save, and the
   * server would reject a prose sentence as a Sigma rule.
   */
  test("the hint is never written into the editor", () => {
    render(<YamlEditor value="" placeholder="Sigma rule YAML." />);

    expect(getEditor().value).toBe("");
  });
});

describe("YamlEditor — accessibility and pass-through", () => {
  test("the field label names the editor", () => {
    render(<YamlEditor value="" ariaLabelledby="field-label-id" />);

    expect(
      document.querySelector('[aria-labelledby="field-label-id"]'),
    ).not.toBeNull();
  });

  test("the caller's dataTestId reaches the editor itself", () => {
    render(<YamlEditor value="" dataTestId="sigma-rule-yaml" />);

    expect(screen.getByTestId("sigma-rule-yaml")).toBeInTheDocument();
  });

  test("readOnly reaches Monaco", () => {
    render(<YamlEditor value="a: 1" readOnly={true} />);

    expect(mockEditorRenders[0]?.readOnly).toBe(true);
  });

  test("a keyboard user is told how to get out of the editor", () => {
    render(<YamlEditor value="" />);

    expect(screen.getByText(/Control plus M/)).toBeInTheDocument();
  });

  test("blur is reported so the form can mark the field touched", () => {
    const onBlur: jest.Mock = jest.fn();

    render(<YamlEditor value="a: 1" onBlur={onBlur} />);

    fireEvent.change(getEditor(), { target: { value: "a: 2" } });

    expect(onBlur).toHaveBeenCalled();
  });
});

describe("YamlEditor — the parse is debounced", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  type AdvanceFunction = (ms: number) => void;

  const advance: AdvanceFunction = (ms: number): void => {
    act(() => {
      jest.advanceTimersByTime(ms);
    });
  };

  /*
   * Without the debounce the document is judged on every keystroke, so a rule
   * flashes an error the instant a line is half typed. This pins that the
   * status waits for the typing to stop.
   */
  test("a keystroke does not immediately re-judge the document", () => {
    render(<YamlEditor value="a: 1" />);

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toMatch(/Valid YAML/);

    fireEvent.change(getEditor(), { target: { value: "a: [" } });

    // One tick short of the debounce: the old verdict still stands.
    advance(YAML_VALIDATION_DEBOUNCE_MS - 1);
    expect(statusText()).toMatch(/Valid YAML/);

    advance(1);
    expect(statusText()).not.toMatch(/Valid YAML/);
  });

  test("only the settled text is judged, not every intermediate one", () => {
    render(<YamlEditor value="a: 1" />);

    advance(YAML_VALIDATION_DEBOUNCE_MS);

    fireEvent.change(getEditor(), { target: { value: "a: [" } });
    advance(50);
    fireEvent.change(getEditor(), { target: { value: "a: [1" } });
    advance(50);
    fireEvent.change(getEditor(), { target: { value: "a: [1]" } });

    // The two broken intermediates never made it to the status bar.
    expect(statusText()).toMatch(/Valid YAML/);

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toMatch(/Valid YAML/);
  });

  /*
   * The form re-validates synchronously on every keystroke and marks the field
   * touched from the first one, so props.error is undebounced. Letting it win
   * immediately would put a red message under a half-typed line and defeat the
   * debounce entirely.
   */
  test("an undebounced form error does not overtake the debounced status", () => {
    const { rerender } = render(<YamlEditor value="a: 1" />);

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toMatch(/Valid YAML/);

    rerender(<YamlEditor value="a: [" error="Config is not valid YAML." />);

    expect(statusText()).not.toMatch(/Config is not valid YAML/);

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toMatch(/Config is not valid YAML/);
  });

  test("the copy confirmation goes back to Copy on its own", () => {
    render(<YamlEditor value="a: 1" />);

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));
    expect(screen.getByTestId("yaml-editor-copy-button")).toHaveTextContent(
      "Copied",
    );

    advance(2000);

    expect(screen.getByTestId("yaml-editor-copy-button")).toHaveTextContent(
      "Copy",
    );
    expect(screen.getByTestId("yaml-editor-copy-button")).not.toHaveTextContent(
      "Copied",
    );
  });
});

describe("YamlEditor — what it withholds from CodeEditor", () => {
  beforeEach(() => {
    mockEditorRenders.length = 0;
  });

  type LastRenderFunction = () => RecordedEditorProps;

  const lastRender: LastRenderFunction = (): RecordedEditorProps => {
    expect(mockEditorRenders.length).toBeGreaterThan(0);

    return mockEditorRenders[
      mockEditorRenders.length - 1
    ] as RecordedEditorProps;
  };

  /*
   * CodeEditor renders its own red border and its own copy of the error under
   * the box. The chrome already says it once in the status bar, so forwarding
   * the error would say it twice and outline it twice.
   */
  test("the error is not forwarded — the status bar is the single voice", () => {
    render(<YamlEditor value="a: [" error="Config is not valid YAML." />);

    expect(lastRender().error).toBeUndefined();
  });

  test("the editor is given a chrome-free className", () => {
    render(<YamlEditor value="a: 1" />);

    const className: string = lastRender().className || "";

    expect(className).not.toContain("border");
    expect(className).not.toContain("rounded");
    expect(className).not.toContain("shadow");
  });

  test("it is tall enough to author a rule in", () => {
    render(<YamlEditor value="a: 1" />);

    expect(lastRender().height).toBe("22rem");
  });

  test("a caller can still choose the height", () => {
    render(<YamlEditor value="a: 1" height="40rem" />);

    expect(lastRender().height).toBe("40rem");
  });
});

describe("YamlEditor — the editor's own accessible description", () => {
  /*
   * Monaco takes Tab to indent, so Tab cannot leave the editor. WCAG 2.1.2 is
   * met only if the user is told the way out — which means the advisory has to
   * reach them on the way IN, not as trailing text they meet on the way past.
   */
  test("the escape hatch and the status are described to Monaco's input", () => {
    render(<YamlEditor value="a: 1" />);

    const describedBy: string =
      getEditor().getAttribute("aria-describedby") || "";

    expect(describedBy.split(" ")).toHaveLength(3);

    for (const id of describedBy.split(" ")) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  test("the escape hint comes before the editor in reading order", () => {
    render(<YamlEditor value="a: 1" />);

    const hint: HTMLElement = screen.getByText(/toggle whether the Tab key/);
    const editor: HTMLElement = getEditor();

    expect(
      hint.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a broken document is announced as invalid to assistive technology", async () => {
    render(<YamlEditor value="a: [" error="Config is not valid YAML." />);

    await waitFor(() => {
      expect(getEditor().getAttribute("aria-invalid")).toBe("true");
    });
  });

  test("a clean document carries no aria-invalid", () => {
    render(<YamlEditor value="a: 1" />);

    expect(getEditor().hasAttribute("aria-invalid")).toBe(false);
  });

  test("the copy confirmation is announced, not just drawn", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    render(<YamlEditor value="a: 1" />);

    fireEvent.click(screen.getByTestId("yaml-editor-copy-button"));

    const liveRegions: Array<HTMLElement> = screen.getAllByRole("status");

    expect(
      liveRegions.some((region: HTMLElement): boolean => {
        return (region.textContent || "").includes("YAML copied to clipboard");
      }),
    ).toBe(true);
  });

  test("the copy button's own name tracks its state", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    render(<YamlEditor value="a: 1" />);

    const button: HTMLElement = screen.getByTestId("yaml-editor-copy-button");

    expect(button.getAttribute("aria-label")).toBe("Copy YAML to clipboard");

    fireEvent.click(button);

    /*
     * WCAG 2.5.3: while the visible label reads "Copied", the accessible name
     * has to contain it, or speech input users cannot address the control.
     */
    expect(button.getAttribute("aria-label")).toContain("copied");
    expect(button).toHaveTextContent("Copied");
  });
});

describe("YamlEditor — the tab-trap escape hint names the right key", () => {
  type SetPlatformFunction = (platform: string) => void;

  const setPlatform: SetPlatformFunction = (platform: string): void => {
    Object.defineProperty(navigator, "platform", {
      value: platform,
      configurable: true,
    });
  };

  afterEach(() => {
    setPlatform("Linux x86_64");
  });

  /*
   * Monaco binds toggleTabFocusMode to Ctrl+M everywhere except macOS, whose
   * `mac` override makes it Ctrl+Shift+M. Naming the wrong key turns the
   * keyboard-trap advisory (WCAG 2.1.2) into a false one — the user presses a
   * combination bound to nothing and stays trapped.
   */
  test("Ctrl+M off macOS", () => {
    setPlatform("Linux x86_64");

    render(<YamlEditor value="a: 1" />);

    expect(screen.getByText(/Press Control plus M to toggle/)).toBeTruthy();
  });

  test("Ctrl+Shift+M on macOS", () => {
    setPlatform("MacIntel");

    render(<YamlEditor value="a: 1" />);

    expect(
      screen.getByText(/Press Control plus Shift plus M to toggle/),
    ).toBeTruthy();
  });
});
