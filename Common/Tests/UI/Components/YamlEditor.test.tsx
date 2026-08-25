import "@testing-library/jest-dom";
import React from "react";
import {
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
      defaultLanguage?: string | undefined;
      options?: Record<string, unknown> | undefined;
      onChange?: ((value: string | undefined) => void) | undefined;
    }) => {
      mockEditorRenders.push({
        value: editorProps.value,
        defaultLanguage: editorProps.defaultLanguage,
        options: editorProps.options,
        readOnly: editorProps.options?.["readOnly"] as boolean | undefined,
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
import YamlEditor from "../../../UI/Components/CodeEditor/YamlEditor";

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

  test("YAML-safe indentation reaches Monaco", () => {
    render(<YamlEditor value="a: 1" />);

    const options: Record<string, unknown> = (mockEditorRenders[0]?.options ||
      {}) as Record<string, unknown>;

    expect(options["tabSize"]).toBe(2);
    expect(options["insertSpaces"]).toBe(true);
    expect(options["detectIndentation"]).toBe(false);
    expect(options["lineNumbers"]).toBe("on");
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

  test("a broken rule is reported with the parser's reason", async () => {
    render(<YamlEditor value="title: [unclosed" />);

    await waitFor(() => {
      expect(statusText()).not.toMatch(/Valid YAML/);
    });

    expect(statusText().length).toBeGreaterThan(0);
  });

  test("a tab used for indentation is caught", async () => {
    render(<YamlEditor value={"detection:\n\tselection: 1\n"} />);

    await waitFor(() => {
      expect(statusText()).not.toMatch(/Valid YAML/);
    });
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

  test("handlebars are not reported as broken", async () => {
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
