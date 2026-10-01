import "@testing-library/jest-dom";
import React, { ReactElement, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import YamlEditor, {
  ComponentProps,
  YAML_DEFAULT_HINT,
  YAML_VALIDATION_DEBOUNCE_MS,
} from "../../../../UI/Components/CodeEditor/YamlEditor";
import {
  CODE_EDITOR_KEYS_HINT,
  CODE_EDITOR_LINE_HEIGHT_PX,
  CODE_EDITOR_PADDING_Y_PX,
  CODE_EDITOR_VALIDATION_DEBOUNCE_MS,
} from "../../../../UI/Components/CodeEditor/CodeEditor";

/*
 * YamlEditor is CodeEditor with the YAML grammar, YAML-safe indentation and a
 * hint in the toolbar, rendered for real: no Monaco stand-in any more.
 */

const VALID_SIGMA_RULE: string = `title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
  condition: selection
`;

type GetInputFunction = () => HTMLTextAreaElement;
type GetTextFunction = () => string;

const getInput: GetInputFunction = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

const statusText: GetTextFunction = (): string => {
  return screen.getByTestId("code-editor-status").textContent || "";
};

const hintText: GetTextFunction = (): string => {
  return screen.getByTestId("code-editor-hint").textContent || "";
};

type PressFunction = (key: string, init?: Record<string, unknown>) => boolean;

const press: PressFunction = (
  key: string,
  init?: Record<string, unknown>,
): boolean => {
  return fireEvent.keyDown(getInput(), { key, ...(init || {}) });
};

type SetCaretFunction = (start: number, end?: number) => void;

const setCaret: SetCaretFunction = (start: number, end?: number): void => {
  act(() => {
    getInput().focus();
    getInput().setSelectionRange(start, end ?? start);
  });
  fireEvent.keyUp(getInput(), { key: "ArrowRight" });
};

type AdvanceFunction = (ms: number) => void;

const advance: AdvanceFunction = (ms: number): void => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

interface HarnessProps extends Omit<ComponentProps, "value" | "onChange"> {
  initial?: string | undefined;
}

// Feeds every change back, the way FormField does.
const Harness: (props: HarnessProps) => ReactElement = (
  props: HarnessProps,
): ReactElement => {
  const { initial, ...rest } = props;
  const [value, setValue] = useState<string>(initial || "");

  return <YamlEditor {...rest} value={value} onChange={setValue} />;
};

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("YamlEditor — it is a YAML editor, not a rich text editor", () => {
  /*
   * The bug this component exists for: the "Sigma Rule (YAML)" field rendered
   * the Markdown editor, so a Sigma rule got a Bold button and an H1 button
   * over it - and the value was round-tripped through HTML, which
   * indentation-sensitive YAML does not survive.
   */
  test("the editor is a YAML code editor", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(
      screen
        .getByTestId("yaml-editor")
        .querySelector('[data-code-type="yaml"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("code-editor-language")).toHaveTextContent(
      "YAML",
    );
  });

  test("keys and values are highlighted with the YAML grammar", () => {
    render(<YamlEditor value="level: high" />);

    const layer: HTMLElement = screen.getByTestId("code-editor-highlight");

    expect(layer.querySelector(".hljs-attr")?.textContent).toBe("level:");
    expect(layer.querySelector(".hljs-string")?.textContent).toBe("high");
  });

  test("there is no rich-text toolbar anywhere in it", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    for (const label of ["Bold", "Italic", "Heading 1", "Heading 2", "Link"]) {
      expect(screen.queryByTitle(label)).toBeNull();
    }
  });

  test("the gutter is on, because every parse error names a line", () => {
    render(<YamlEditor value={"a: 1\nb: 2"} />);

    expect(screen.getByTestId("code-editor-gutter")).toHaveTextContent("1 2", {
      normalizeWhitespace: true,
    });
  });

  test("there is no Format button: only JSON is reformatted", () => {
    render(<YamlEditor value="a: 1" />);

    expect(screen.queryByTestId("code-editor-format-button")).toBeNull();
  });

  test("a tab character is drawn, because in YAML it is an error", () => {
    render(<YamlEditor value={"a:\n\tb: 1"} />);

    expect(document.querySelector(".ou-code-editor__tab")).not.toBeNull();
  });
});

describe("YamlEditor — indentation is YAML-safe", () => {
  test("Tab inserts two spaces", () => {
    render(<Harness initial="a:" />);

    setCaret(2);
    press("Enter");
    // Enter after "a:" has already gone one level in.
    expect(getInput().value).toBe("a:\n  ");

    press("Tab");
    expect(getInput().value).toBe("a:\n    ");
  });

  test("Tab never inserts a tab, even in a document already indented with tabs", () => {
    // A tab-indented paste must not make the editor keep typing tabs.
    render(<Harness initial={"a:\n\tb: 1\n\tc: 2"} />);

    setCaret(0, getInput().value.length);
    press("Tab");

    expect(getInput().value).not.toMatch(/\t\t/);
    expect(getInput().value).toBe("  a:\n  \tb: 1\n  \tc: 2");
  });

  test("Enter inside a list item continues the item's keys", () => {
    render(<Harness initial="- name: web" />);

    setCaret(11);
    press("Enter");

    expect(getInput().value).toBe("- name: web\n  ");
  });

  test("Ctrl+/ comments with #", () => {
    render(<Harness initial="level: high" />);

    setCaret(0);
    press("/", { ctrlKey: true });

    expect(getInput().value).toBe("# level: high");
  });
});

describe("YamlEditor — the value it shows", () => {
  test("renders the value prop", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(getInput().value).toBe(VALID_SIGMA_RULE);
  });

  test("renders initialValue when no value is given", () => {
    render(<YamlEditor initialValue="a: 1" />);

    expect(getInput().value).toBe("a: 1");
  });

  test("prefers value over initialValue", () => {
    render(<YamlEditor initialValue="stale: true" value="current: true" />);

    expect(getInput().value).toBe("current: true");
  });

  test("follows the value prop after mount", () => {
    const { rerender } = render(<YamlEditor value="a: 1" />);

    rerender(<YamlEditor value="a: 2" />);

    expect(getInput().value).toBe("a: 2");
  });

  test("picks up a value that only arrives later", () => {
    const { rerender } = render(<YamlEditor />);

    expect(getInput().value).toBe("");

    rerender(<YamlEditor value={VALID_SIGMA_RULE} />);

    expect(getInput().value).toBe(VALID_SIGMA_RULE);
  });

  test("a non-string value is stringified rather than crashing", () => {
    render(<YamlEditor value={{ a: 1 } as unknown as string} />);

    expect(getInput().value).toBe(JSON.stringify({ a: 1 }, null, 4));
  });

  test("reports edits to onChange", () => {
    const onChange: jest.Mock = jest.fn();

    render(<YamlEditor value="before: 1" onChange={onChange} />);

    fireEvent.change(getInput(), { target: { value: "after: 2" } });

    expect(onChange).toHaveBeenCalledWith("after: 2");
  });

  test("typing is reflected even when the parent does not feed the value back", () => {
    render(<YamlEditor />);

    fireEvent.change(getInput(), { target: { value: "typed: yes" } });

    expect(getInput().value).toBe("typed: yes");
  });
});

describe("YamlEditor — the status bar tells you whether it parses", () => {
  test("an empty editor says so instead of claiming an error", () => {
    render(<YamlEditor value="" />);

    expect(statusText()).toBe("Nothing entered yet.");
  });

  test("a valid rule is confirmed, with a line count", () => {
    render(<YamlEditor value={"a: 1\nb: 2\n"} />);

    expect(statusText()).toBe("Valid YAML · 3 lines");
  });

  test("a one-line document says line, not lines", () => {
    render(<YamlEditor value="a: 1" />);

    expect(statusText()).toBe("Valid YAML · 1 line");
  });

  /*
   * The parser's own words, not a generic "Invalid YAML." - the reason is the
   * only part of the message that tells the reader what to change.
   */
  test("a broken rule is reported with the parser's reason", () => {
    render(<YamlEditor value="title: [unclosed" />);

    expect(statusText()).toMatch(/unexpected end of the stream/i);
  });

  test("a misindented rule names the indentation as the problem, and where", () => {
    render(<YamlEditor value={"a: 1\nb:\n  c: 1\n   d: 2\n"} />);

    expect(statusText()).toMatch(/bad indentation/i);
    expect(statusText()).toMatch(/\(line 4, column \d+\)$/);
    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("4");
  });

  test("a tab used for indentation is caught, with its line and column", () => {
    render(<YamlEditor value={"detection:\n\tselection: 1\n"} />);

    expect(statusText()).toBe(
      "a tab character cannot be used for indentation (line 2, column 1)",
    );
    expect(
      document.querySelector(".ou-code-editor__gutter-error")?.textContent,
    ).toBe("2");
  });

  test("it re-checks as the document is edited", () => {
    jest.useFakeTimers();

    render(<Harness initial="title: [unclosed" />);

    expect(statusText()).not.toMatch(/Valid YAML/);

    fireEvent.change(getInput(), { target: { value: "title: fixed" } });
    advance(YAML_VALIDATION_DEBOUNCE_MS);

    expect(statusText()).toBe("Valid YAML · 1 line");
  });

  /*
   * checkYamlSyntax declines to judge a document whose shape is only known at
   * run time. Claiming it is valid would be a claim about text nobody parsed.
   */
  test("handlebars are reported as unchecked, not as broken and not as valid", () => {
    render(
      <YamlEditor
        value={"items:\n{{#each hosts}}\n  - {{this}}\n{{/each}}\n"}
      />,
    );

    expect(statusText()).toBe(
      "Contains template expressions — syntax not checked.",
    );
  });

  test("a template standing in for a single value still parses", () => {
    render(<YamlEditor value="threshold: {{local.variables.count}}" />);

    expect(statusText()).toBe("Valid YAML · 1 line");
  });

  test("it is announced politely rather than interrupting", () => {
    render(<YamlEditor value="a: 1" />);

    const status: HTMLElement = screen.getByTestId("code-editor-status");

    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});

describe("YamlEditor — a form error is shown once, not twice", () => {
  /*
   * The form's own message wins whenever there is one, because it is the
   * sentence blocking Save - and it is said once, in the status bar.
   */
  test("the form error replaces the live status", () => {
    render(
      <YamlEditor
        value="title: [unclosed"
        error="Sigma Rule (YAML) is not valid YAML. unexpected end of the stream"
      />,
    );

    expect(statusText()).toBe(
      "Sigma Rule (YAML) is not valid YAML. unexpected end of the stream",
    );
  });

  test("the error text appears exactly once in the whole component", () => {
    const message: string = "Sigma Rule (YAML) is required.";

    render(<YamlEditor value="" error={message} />);

    expect(screen.getAllByText(message)).toHaveLength(1);
  });

  test("a valid document with a form error still shows the error", () => {
    render(<YamlEditor value="a: 1" error="Something else is wrong." />);

    expect(statusText()).toBe("Something else is wrong.");
  });

  test("clearing the error hands the status bar back to the parser", () => {
    const { rerender } = render(
      <YamlEditor value="a: 1" error="Something else is wrong." />,
    );

    rerender(<YamlEditor value="a: 1" />);

    expect(statusText()).toBe("Valid YAML · 1 line");
  });

  test("the error outlines the editor in red", () => {
    render(<YamlEditor value="a: [" error="Config is not valid YAML." />);

    expect(document.querySelector(".ou-code-editor")).toHaveClass(
      "border-red-300",
    );
  });
});

describe("YamlEditor — the parse is debounced", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  test("its debounce is the editor's", () => {
    expect(YAML_VALIDATION_DEBOUNCE_MS).toBe(
      CODE_EDITOR_VALIDATION_DEBOUNCE_MS,
    );
  });

  /*
   * Without the debounce the document is judged on every keystroke, so a rule
   * flashes an error the instant a line is half typed.
   */
  test("a keystroke does not immediately re-judge the document", () => {
    render(<Harness initial="a: 1" />);

    expect(statusText()).toBe("Valid YAML · 1 line");

    fireEvent.change(getInput(), { target: { value: "a: [" } });

    advance(YAML_VALIDATION_DEBOUNCE_MS - 1);
    expect(statusText()).toBe("Valid YAML · 1 line");

    advance(1);
    expect(statusText()).not.toMatch(/Valid YAML/);
  });

  test("only the settled text is judged, not every intermediate one", () => {
    render(<Harness initial="a: 1" />);

    fireEvent.change(getInput(), { target: { value: "a: [" } });
    advance(50);
    fireEvent.change(getInput(), { target: { value: "a: [1" } });
    advance(50);
    fireEvent.change(getInput(), { target: { value: "a: [1]" } });

    expect(statusText()).toBe("Valid YAML · 1 line");

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toBe("Valid YAML · 1 line");
  });

  /*
   * The form re-validates synchronously on every keystroke, so props.error is
   * undebounced. Letting it win immediately would put a red message under a
   * half-typed line and defeat the debounce entirely.
   */
  test("an undebounced form error does not overtake the debounced status", () => {
    const { rerender } = render(<YamlEditor value="a: 1" />);

    fireEvent.change(getInput(), { target: { value: "a: [" } });
    rerender(<YamlEditor value="a: 1" error="Config is not valid YAML." />);

    expect(statusText()).not.toMatch(/Config is not valid YAML/);

    advance(YAML_VALIDATION_DEBOUNCE_MS);
    expect(statusText()).toBe("Config is not valid YAML.");
  });

  test("the copy confirmation goes back to Copy on its own", () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (): Promise<void> => {
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    render(<YamlEditor value="a: 1" />);

    fireEvent.click(screen.getByTestId("code-editor-copy-button"));
    expect(screen.getByTestId("code-editor-copy-button")).toHaveTextContent(
      "Copied",
    );

    advance(2000);

    expect(screen.getByTestId("code-editor-copy-button")).not.toHaveTextContent(
      "Copied",
    );
  });
});

describe("YamlEditor — copying the document", () => {
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
  });

  test("copies exactly what is in the editor", () => {
    render(<YamlEditor value={VALID_SIGMA_RULE} />);

    fireEvent.click(screen.getByTestId("code-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith(VALID_SIGMA_RULE);
  });

  test("copies the edited text, not the text it mounted with", () => {
    render(<YamlEditor initialValue="old: 1" />);

    fireEvent.change(getInput(), { target: { value: "new: 2" } });
    fireEvent.click(screen.getByTestId("code-editor-copy-button"));

    expect(writeText).toHaveBeenCalledWith("new: 2");
  });

  test("the confirmation is announced, and the button's name tracks it", () => {
    render(<YamlEditor value="a: 1" />);

    const button: HTMLElement = screen.getByTestId("code-editor-copy-button");

    expect(button).toHaveAttribute("aria-label", "Copy YAML to clipboard");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-label", "YAML copied to clipboard");
    expect(
      screen.getAllByRole("status").some((region: HTMLElement): boolean => {
        return (region.textContent || "").includes("YAML copied to clipboard");
      }),
    ).toBe(true);
  });

  test("there is nothing to copy from an empty editor", () => {
    render(<YamlEditor value="" />);

    expect(screen.getByTestId("code-editor-copy-button")).toBeDisabled();
  });
});

describe("YamlEditor — the hint in the toolbar", () => {
  test("says how YAML indentation works when the caller has nothing to add", () => {
    render(<YamlEditor value="" />);

    expect(hintText()).toBe(YAML_DEFAULT_HINT);
    expect(hintText()).toMatch(/2 spaces/);
    expect(hintText()).toMatch(/[Tt]abs/);
  });

  test("a caller's placeholder replaces it", () => {
    render(<YamlEditor value="" placeholder="Sigma rule YAML." />);

    expect(hintText()).toBe("Sigma rule YAML.");
  });

  /*
   * The hint must never be seeded into the document: it would be text the
   * user can accidentally save, and the server would reject a prose sentence
   * as a Sigma rule.
   */
  test("the hint is never written into the editor", () => {
    render(<YamlEditor value="" placeholder="Sigma rule YAML." />);

    expect(getInput().value).toBe("");
    expect(document.querySelector(".ou-code-editor__placeholder")).toBeNull();
  });

  test("the hint stays readable once there is a document", () => {
    render(<YamlEditor value="a: 1" placeholder="Sigma rule YAML." />);

    expect(hintText()).toBe("Sigma rule YAML.");
  });
});

describe("YamlEditor — accessibility and pass-through", () => {
  test("the field label names the textarea", () => {
    render(
      <>
        <span id="field-label-id">Sigma Rule (YAML)</span>
        <YamlEditor value="" ariaLabelledby="field-label-id" />
      </>,
    );

    expect(getInput()).toHaveAttribute("aria-labelledby", "field-label-id");
    expect(screen.getByRole("textbox", { name: "Sigma Rule (YAML)" })).toBe(
      getInput(),
    );
  });

  test("the root keeps its test id and the caller's dataTestId reaches the editor", () => {
    render(<YamlEditor value="" dataTestId="sigma-rule-yaml" />);

    expect(screen.getByTestId("yaml-editor")).toContainElement(
      screen.getByTestId("sigma-rule-yaml"),
    );
    expect(screen.getByTestId("sigma-rule-yaml")).toContainElement(getInput());
  });

  test("a caller's className lands on the root", () => {
    render(<YamlEditor value="" className="mt-6" />);

    expect(screen.getByTestId("yaml-editor")).toHaveClass("mt-6");
  });

  test("readOnly reaches the textarea", () => {
    render(<YamlEditor value="a: 1" readOnly={true} />);

    expect(getInput()).toHaveAttribute("readonly");
  });

  test("tabIndex reaches the textarea", () => {
    render(<YamlEditor value="a: 1" tabIndex={0} />);

    expect(getInput()).toHaveAttribute("tabindex", "0");
  });

  test("a keyboard user is told how to get out of the editor", () => {
    render(<YamlEditor value="" />);

    const describedBy: Array<string> = (
      getInput().getAttribute("aria-describedby") || ""
    ).split(" ");

    expect(
      describedBy.map((id: string): string => {
        return document.getElementById(id)?.textContent || "";
      }),
    ).toContain(CODE_EDITOR_KEYS_HINT);
  });

  test("the hint and the status describe the textarea too", () => {
    render(<YamlEditor value="a: 1" />);

    const described: Array<string> = (
      getInput().getAttribute("aria-describedby") || ""
    )
      .split(" ")
      .map((id: string): string => {
        return document.getElementById(id)?.textContent || "";
      });

    expect(described).toContain(YAML_DEFAULT_HINT);
    expect(described).toContain("Valid YAML · 1 line");
  });

  test("Escape then Tab leaves the editor", () => {
    render(<Harness initial="a: 1" />);

    setCaret(0);

    expect(press("Escape")).toBe(false);
    expect(press("Tab")).toBe(true);
  });

  test("blur is reported so the form can mark the field touched, and only blur", () => {
    const onBlur: jest.Mock = jest.fn();

    render(<YamlEditor value="a: 1" onBlur={onBlur} />);

    fireEvent.change(getInput(), { target: { value: "a: 2" } });
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.blur(getInput());
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("focus is reported", () => {
    const onFocus: jest.Mock = jest.fn();

    render(<YamlEditor value="a: 1" onFocus={onFocus} />);

    act(() => {
      getInput().focus();
    });

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test("a broken document with a form error is announced as invalid", () => {
    render(<YamlEditor value="a: [" error="Config is not valid YAML." />);

    expect(getInput()).toHaveAttribute("aria-invalid", "true");
  });

  test("a clean document carries no aria-invalid", () => {
    render(<YamlEditor value="a: 1" />);

    expect(getInput()).not.toHaveAttribute("aria-invalid");
  });
});

describe("YamlEditor — size", () => {
  const code: () => HTMLElement = (): HTMLElement => {
    return document.querySelector(".ou-code-editor__code") as HTMLElement;
  };

  test("starts tall enough to author a rule in, and grows further", () => {
    render(<YamlEditor value="a: 1" />);

    expect(code()).toHaveStyle({
      minHeight: `${12 * CODE_EDITOR_LINE_HEIGHT_PX + 2 * CODE_EDITOR_PADDING_Y_PX}px`,
    });
    expect(
      screen.getByTestId("code-editor-scroller").getAttribute("style") || "",
    ).toContain("max-height: min(70vh, 36rem)");
  });

  test("a caller can still choose a fixed height", () => {
    render(<YamlEditor value="a: 1" height="40rem" />);

    expect(screen.getByTestId("code-editor-scroller")).toHaveStyle({
      height: "40rem",
    });
  });
});
