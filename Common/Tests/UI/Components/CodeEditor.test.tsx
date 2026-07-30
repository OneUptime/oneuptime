import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "@jest/globals";
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
      onChange?: ((value: string | undefined) => void) | undefined;
    }) => {
      mockEditorRenders.push({
        value: editorProps.value,
        defaultValue: editorProps.defaultValue,
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
