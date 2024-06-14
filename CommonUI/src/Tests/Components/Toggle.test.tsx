import Toggle from "../../Components/Toggle/Toggle";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";

describe("Toggle", () => {
  test("renders toggle element with required props only", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toBeInTheDocument();
  });

  test("renders toggle element with all props", () => {
    const { getByRole } = render(
      <Toggle
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        initialValue={false}
        tabIndex={1}
        title="title"
        description="description"
        error="error"
      />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toBeInTheDocument();
  });

  test("calls onChange", () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onChange={onChange} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("calls onFocus", () => {
    const onFocus: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onFocus={onFocus} initialValue={false} onChange={() => {}} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.focus(toggle);

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  test("calls onBlur", () => {
    const onBlur: MockFunction = getJestMockFunction();

    const { getByRole } = render(
      <Toggle onBlur={onBlur} initialValue={false} onChange={() => {}} />,
    );
    const toggle: HTMLElement = getByRole("switch");
    fireEvent.blur(toggle);

    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("displays error", () => {
    const { getByText } = render(
      <Toggle onChange={() => {}} initialValue={false} error="error" />,
    );

    expect(getByText("error")).toBeInTheDocument();
  });

  test("displays title", () => {
    const { getByText } = render(
      <Toggle
        onChange={() => {}}
        initialValue={false}
        title="title"
        description="description"
      />,
    );

    expect(getByText("title")).toBeInTheDocument();
  });

  test("displays description", () => {
    const { getByText } = render(
      <Toggle
        onChange={() => {}}
        initialValue={false}
        description="description"
      />,
    );
    expect(getByText("description")).toBeInTheDocument();
  });

  test("sets tabIndex", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} tabIndex={1} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("tabindex", "1");
  });

  test("sets initial value", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={true} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("sets initial value to false", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets initial value to undefined", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets value", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} value={true} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("sets value to false", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} value={false} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("sets value to undefined", () => {
    const { getByRole } = render(<Toggle onChange={() => {}} />);
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("styles toggle correctly", () => {
    const { getByRole } = render(
      <Toggle onChange={() => {}} initialValue={false} />,
    );
    const toggle: HTMLElement = getByRole("switch");

    expect(toggle).toHaveClass("bg-gray-200");
    fireEvent.click(toggle);
    expect(toggle).toHaveClass("bg-indigo-600");
  });
});
