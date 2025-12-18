import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
describe("Dropdown", () => {
  const options: DropdownOption[] = [
    { value: "1", label: "1" },
    { value: "2", label: "2" },
  ];

  test("renders with required props only", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown).toBeInTheDocument();
  });

  test("renders with all props", () => {
    const { getByRole } = render(
      <Dropdown
        onClick={() => {}}
        onChange={() => {}}
        onFocus={() => {}}
        onBlur={() => {}}
        options={options}
        initialValue={{ value: "1", label: "1" }}
        value={{ value: "1", label: "1" }}
        placeholder="placeholder"
        className="class-name"
        tabIndex={1}
        error="error"
        isMultiSelect={true}
      />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown).toBeInTheDocument();
  });

  test("sets options", async () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });

    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  test("renders placeholder", async () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        placeholder="placeholder"
      />,
    );

    expect(getByText("placeholder")).toBeInTheDocument();
  });

  test("sets initialValue", async () => {
    const { getByText, queryByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        initialValue={{ value: "1", label: "1" }}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(queryByText("2")).toBeNull();
  });

  test("sets initialValue array for multi select", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        initialValue={[
          { value: "1", label: "1" },
          { value: "2", label: "2" },
        ]}
        isMultiSelect={true}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
  });

  test("sets value", async () => {
    const { getByText, queryByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={{ value: "1", label: "1" }}
      />,
    );

    expect(getByText("1")).toBeInTheDocument();
    expect(queryByText("2")).toBeNull();
  });

  test("should display value prop in the dropdown", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={{ value: "2", label: "2" }}
      />,
    );

    expect(getByText("2")).toBeInTheDocument();
  });

  test("should handle multiselect with multiple values", () => {
    const multiOptions: Array<DropdownOption> = [
      { value: "a", label: "Option A" },
      { value: "b", label: "Option B" },
      { value: "c", label: "Option C" },
    ];

    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={multiOptions}
        isMultiSelect={true}
        value={[
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
        ]}
      />,
    );

    expect(getByText("Option A")).toBeInTheDocument();
    expect(getByText("Option B")).toBeInTheDocument();
  });

  test("should display placeholder when no value is selected", () => {
    const { getByText } = render(
      <Dropdown
        onChange={() => {}}
        options={options}
        placeholder="Select an option"
      />,
    );

    expect(getByText("Select an option")).toBeInTheDocument();
  });

  test("sets className", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} className="class-name" />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.closest(".class-name")).toBeInTheDocument();
  });

  test("sets default className", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.closest("div")?.classList.length).toBeGreaterThan(0);
  });

  test("sets tabIndex", () => {
    const { getByRole } = render(
      <Dropdown onChange={() => {}} options={options} tabIndex={1} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    expect(dropdown.tabIndex).toBe(1);
  });

  test("displays error", () => {
    const { getByText } = render(
      <Dropdown onChange={() => {}} options={options} error="error" />,
    );

    expect(getByText("error")).toBeInTheDocument();
  });

  test("sets isMultiSelect", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const { getByRole, getByText } = render(
      <Dropdown onChange={onChange} options={options} isMultiSelect={true} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("2"));

    expect(getByText("1")).toBeInTheDocument();
    expect(getByText("2")).toBeInTheDocument();
  });

  test("calls onChange when option is selected", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onChange={onChange} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("1");
  });

  test("calls onChange when option is selected for multi select", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onChange={onChange} options={options} isMultiSelect={true} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("1"));

    fireEvent.keyDown(dropdown, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText("2"));

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(["1"]);
    expect(onChange).toHaveBeenCalledWith(["1", "2"]);
  });

  test("calls onClick", () => {
    const onClick: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onClick={onClick} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.click(dropdown);

    expect(onClick).toHaveBeenCalled();
  });

  test("calls onFocus", () => {
    const onFocus: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onFocus={onFocus} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.focus(dropdown);

    expect(onFocus).toHaveBeenCalled();
  });

  test("calls onBlur", () => {
    const onBlur: MockFunction = getJestMockFunction();
    const { getByRole } = render(
      <Dropdown onBlur={onBlur} options={options} />,
    );
    const dropdown: HTMLElement = getByRole("combobox");

    fireEvent.blur(dropdown);

    expect(onBlur).toHaveBeenCalled();
  });
});
