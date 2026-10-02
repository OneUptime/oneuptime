import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import {
  findTextControl,
  getTextControlCaretRect,
  insertIntoTextControl,
  isTextControl,
} from "../../../../UI/Components/TemplateVariables/TextControlUtil";

/*
 * The plain text controls a template variable is put into - a textarea or a
 * text input - and how it goes in: like typing, so the control's owner hears
 * of it (React's onChange) and the cursor ends up after it.
 */

afterEach(() => {
  cleanup();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

function ControlledTextArea(props: {
  initial: string;
  onValue: (value: string) => void;
}): ReactElement {
  const [value, setValue] = useState<string>(props.initial);

  return (
    <textarea
      data-testid="control"
      value={value}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(event.target.value);
        props.onValue(event.target.value);
      }}
    />
  );
}

describe("isTextControl and findTextControl", () => {
  test("a textarea and a text input are text controls; a checkbox or a button are not", () => {
    const textarea: HTMLTextAreaElement = document.createElement("textarea");
    const text: HTMLInputElement = document.createElement("input");
    const untyped: HTMLInputElement = document.createElement("input");
    const checkbox: HTMLInputElement = document.createElement("input");
    const number: HTMLInputElement = document.createElement("input");

    text.setAttribute("type", "text");
    checkbox.setAttribute("type", "checkbox");
    number.setAttribute("type", "number");

    expect(isTextControl(textarea)).toBe(true);
    expect(isTextControl(text)).toBe(true);
    expect(isTextControl(untyped)).toBe(true);
    expect(isTextControl(checkbox)).toBe(false);
    expect(isTextControl(number)).toBe(false);
    expect(isTextControl(document.createElement("button"))).toBe(false);
    expect(isTextControl(null)).toBe(false);
  });

  test("finds the field's textarea first, else its text input", () => {
    const wrapper: HTMLDivElement = document.createElement("div");
    wrapper.innerHTML =
      '<input type="checkbox"><input type="text" id="text"><textarea id="area"></textarea>';

    expect(findTextControl(wrapper)?.id).toBe("area");

    wrapper.querySelector("textarea")!.remove();
    expect(findTextControl(wrapper)?.id).toBe("text");

    wrapper.querySelector("#text")!.remove();
    expect(findTextControl(wrapper)).toBeNull();
    expect(findTextControl(null)).toBeNull();
  });
});

describe("insertIntoTextControl", () => {
  test("puts the text in place of the range, through the control's own change handling", () => {
    const onValue: jest.Mock<(value: string) => void> =
      jest.fn<(value: string) => void>();

    render(<ControlledTextArea initial="Hi {{inc there" onValue={onValue} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    insertIntoTextControl(control, 3, 8, "{{incident.title}}");

    expect(control.value).toBe("Hi {{incident.title}} there");
    expect(onValue).toHaveBeenLastCalledWith("Hi {{incident.title}} there");
    // The cursor is just after what went in, in the field.
    expect(control).toHaveFocus();
    expect(control.selectionStart).toBe(21);
    expect(control.selectionEnd).toBe(21);
  });

  test("at a cursor, adds without replacing anything", () => {
    const onValue: jest.Mock<(value: string) => void> =
      jest.fn<(value: string) => void>();

    render(<ControlledTextArea initial="Severity: " onValue={onValue} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    insertIntoTextControl(control, 10, 10, "{{incident.severity}}");

    expect(control.value).toBe("Severity: {{incident.severity}}");
    expect(onValue).toHaveBeenLastCalledWith("Severity: {{incident.severity}}");
  });

  test("goes in as typing where the browser can, so Ctrl+Z takes it back", () => {
    const commands: Array<string> = [];

    render(<ControlledTextArea initial="Hello " onValue={() => {}} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: (command: string, _showUi: boolean, value: string): boolean => {
        commands.push(`${command}:${value}`);
        // What a browser does: replace the selection and fire input.
        control.setRangeText(
          value,
          control.selectionStart,
          control.selectionEnd,
          "end",
        );
        control.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
    });

    insertIntoTextControl(control, 6, 6, "{{incident.title}}");

    expect(commands).toEqual(["insertText:{{incident.title}}"]);
    expect(control.value).toBe("Hello {{incident.title}}");
  });

  test("a browser that refuses the command still gets the text", () => {
    render(<ControlledTextArea initial="Hello " onValue={() => {}} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: (): boolean => {
        return false;
      },
    });

    insertIntoTextControl(control, 6, 6, "{{x}}");

    expect(control.value).toBe("Hello {{x}}");
  });

  test("keeps the range inside the text", () => {
    render(<ControlledTextArea initial="abc" onValue={() => {}} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    insertIntoTextControl(control, 99, 99, "{{x}}");

    expect(control.value).toBe("abc{{x}}");
  });
});

describe("getTextControlCaretRect", () => {
  test("with no layout to measure, is the control's own box", () => {
    render(<ControlledTextArea initial="Hello {{" onValue={() => {}} />);

    const control: HTMLTextAreaElement = screen.getByTestId(
      "control",
    ) as HTMLTextAreaElement;

    expect(getTextControlCaretRect(control, 6)).toEqual(
      control.getBoundingClientRect(),
    );
  });

  test("leaves nothing behind in the page", () => {
    render(<ControlledTextArea initial="Hello {{" onValue={() => {}} />);

    const before: number = document.body.childElementCount;

    getTextControlCaretRect(
      screen.getByTestId("control") as HTMLTextAreaElement,
      6,
    );

    expect(document.body.childElementCount).toBe(before);
  });
});
