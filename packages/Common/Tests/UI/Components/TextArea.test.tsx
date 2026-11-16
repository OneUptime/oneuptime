import TextArea from "../../../UI/Components/TextArea/TextArea";
import "@testing-library/jest-dom";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("TextArea", () => {
  test("renders textarea element with initialValue only", () => {
    const { getByRole } = render(<TextArea initialValue="initial value" />);
    const textarea: HTMLElement = getByRole("textbox");

    expect(textarea).toBeInTheDocument();
  });

  test("renders textarea element with all props", () => {
    const { getByRole } = render(
      <TextArea
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        initialValue="initial value"
        placeholder="placeholder"
        className="class-name"
        tabIndex={1}
        error="error"
        autoFocus={true}
        disableSpellCheck={false}
      />,
    );
    const textarea: HTMLElement = getByRole("textbox");

    expect(textarea).toBeInTheDocument();
  });

  test("calls onChange event", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <TextArea initialValue="initial value" onChange={onChange} />,
    );
    const textarea: HTMLElement = getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "new value" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("new value");
  });

  test("follows the value the page gives it, an empty one too (#8893)", () => {
    const { getByRole, rerender } = render(
      <TextArea value="first words" onChange={() => {}} />,
    );
    const textarea: HTMLTextAreaElement = getByRole(
      "textbox",
    ) as HTMLTextAreaElement;

    expect(textarea.value).toBe("first words");

    rerender(<TextArea value="second words" onChange={() => {}} />);
    expect(textarea.value).toBe("second words");

    // A box the page cleared - a message sent - is empty, not the old text.
    rerender(<TextArea value="" onChange={() => {}} />);
    expect(textarea.value).toBe("");
  });

  test("typed into while the page's value stays empty, it keeps what is typed", () => {
    const { getByRole } = render(<TextArea value="" onChange={() => {}} />);
    const textarea: HTMLTextAreaElement = getByRole(
      "textbox",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "typed" } });

    expect(textarea.value).toBe("typed");
  });

  test("an empty value never hides the initial value it starts with", () => {
    const { getByRole } = render(
      <TextArea value="" initialValue="from the form" />,
    );

    expect((getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "from the form",
    );
  });

  test("calls onFocus event", () => {
    const onFocus: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <TextArea initialValue="initial value" onFocus={onFocus} />,
    );
    const textarea: HTMLElement = getByRole("textbox");
    fireEvent.focus(textarea);

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test("calls onBlur event", () => {
    const onBlur: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <TextArea initialValue="initial value" onBlur={onBlur} />,
    );
    const textarea: HTMLElement = getByRole("textbox");
    fireEvent.blur(textarea);

    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("sets initialValue", () => {
    const { getByDisplayValue } = render(
      <TextArea initialValue="initial value" />,
    );
    expect(getByDisplayValue("initial value")).toBeInTheDocument();
  });

  test("sets placeholder", () => {
    const { getByPlaceholderText } = render(
      <TextArea placeholder="placeholder" initialValue="" />,
    );
    expect(getByPlaceholderText("placeholder")).toBeInTheDocument();
  });

  test("sets className", () => {
    const { getByRole } = render(
      <TextArea className="class-name" initialValue="" />,
    );
    expect(getByRole("textbox")).toHaveClass("class-name");
  });

  test("sets default className", () => {
    const { getByRole } = render(<TextArea initialValue="" />);
    expect(getByRole("textbox").classList.length).toBeGreaterThan(0);
  });

  test("sets tabIndex", () => {
    const { getByRole } = render(<TextArea tabIndex={1} initialValue="" />);
    expect(getByRole("textbox")).toHaveAttribute("tabindex", "1");
  });

  test("sets autoFocus", () => {
    const { getByRole } = render(<TextArea autoFocus={true} initialValue="" />);
    expect(getByRole("textbox")).toHaveFocus();
  });

  test("displays error", () => {
    const errorTestId: string = "error-message";
    const { getByText, getByTestId } = render(
      <TextArea error="error" initialValue="" />,
    );

    expect(getByText("error")).toBeInTheDocument();
    expect(getByTestId(errorTestId)).toBeInTheDocument();
  });

  // A fixed error id described every text area in error by the first one's message.
  test("describes each text area by its own error message", () => {
    const { getByTestId, getAllByRole } = render(
      <>
        <TextArea error="Details is required." dataTestId="details" />
        <TextArea error="Steps is required." dataTestId="steps" />
      </>,
    );
    const details: HTMLElement = getByTestId("details");
    const steps: HTMLElement = getByTestId("steps");

    expect(details).toHaveAccessibleDescription("Details is required.");
    expect(steps).toHaveAccessibleDescription("Steps is required.");
    expect(details.getAttribute("aria-describedby")).not.toBe(
      steps.getAttribute("aria-describedby"),
    );
    expect(getAllByRole("alert")).toHaveLength(2);
  });

  test("displays error icon", () => {
    const { container } = render(<TextArea error="error" initialValue="" />);
    // The error icon renders an inline <svg> (no role="icon"; WCAG 4.1.2).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("does not display error icon without error", () => {
    const { container } = render(<TextArea initialValue="" />);
    // Without an error there is no icon, so no <svg> is rendered.
    expect(container.querySelector("svg")).toBeNull();
  });

  test("applies error styles", () => {
    const { getByRole } = render(<TextArea error="error" initialValue="" />);
    expect(getByRole("textbox")).toHaveClass("border-red-300");
  });

  test("does not apply error styles without error", () => {
    const { getByRole } = render(<TextArea initialValue="" />);
    expect(getByRole("textbox")).not.toHaveClass("border-red-300");
  });

  test("parses sole initial newline as empty string", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole, getByDisplayValue, queryByDisplayValue } = render(
      <TextArea initialValue="initial value" onChange={onChange} />,
    );

    const textarea: HTMLElement = getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "\n" } });

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("");
    expect(getByDisplayValue("")).toBeInTheDocument();
    expect(queryByDisplayValue("\n")).not.toBeInTheDocument();
  });

  test("enables spellcheck by default", () => {
    const { getByRole } = render(<TextArea />);
    const textarea: HTMLElement = getByRole("textbox");

    expect(textarea).toHaveAttribute("spellcheck", "true");
  });

  test("disables spellcheck when disableSpellCheck is true", () => {
    const { getByRole } = render(<TextArea disableSpellCheck={true} />);
    const textarea: HTMLElement = getByRole("textbox");

    expect(textarea).toHaveAttribute("spellcheck", "false");
  });

  test("enables spellcheck when disableSpellCheck is false", () => {
    const { getByRole } = render(<TextArea disableSpellCheck={false} />);
    const textarea: HTMLElement = getByRole("textbox");

    expect(textarea).toHaveAttribute("spellcheck", "true");
  });
});
