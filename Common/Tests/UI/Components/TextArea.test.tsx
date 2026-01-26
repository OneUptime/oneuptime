import TextArea from "../../../UI/Components/TextArea/TextArea";
import "@testing-library/jest-dom/extend-expect";
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

  test("displays error icon", () => {
    const { getByRole } = render(<TextArea error="error" initialValue="" />);
    expect(getByRole("icon", { hidden: true })).toBeInTheDocument();
  });

  test("does not display error icon without error", () => {
    const { queryByRole } = render(<TextArea initialValue="" />);
    expect(queryByRole("icon", { hidden: true })).not.toBeInTheDocument();
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
