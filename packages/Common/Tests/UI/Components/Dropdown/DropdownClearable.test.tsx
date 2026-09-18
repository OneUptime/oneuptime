import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Dropdown shows react-select's clear (x) control by default. isClearable
 * turns it off for a choice that must always hold a value (e.g. the
 * Correlate time range), where clearing would only be undone. Turning it
 * off must drop only the clear-all control: the selected value still shows
 * and can still be changed through the menu.
 */

const optionA: DropdownOption = { value: "a", label: "Option A" };
const optionB: DropdownOption = { value: "b", label: "Option B" };
const optionC: DropdownOption = { value: "c", label: "Option C" };
const options: Array<DropdownOption> = [optionA, optionB, optionC];

function getClearIndicator(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-select__clear-indicator");
}

function getSingleValue(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-select__single-value");
}

function getDropdownIndicator(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-select__dropdown-indicator");
}

function clickClearIndicator(): void {
  const clearIndicator: HTMLElement | null = getClearIndicator();
  expect(clearIndicator).not.toBeNull();
  // react-select clears on a primary-button mousedown, not on click.
  fireEvent.mouseDown(clearIndicator as HTMLElement, { button: 0 });
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

afterEach(() => {
  cleanup();
});

describe("Dropdown isClearable (single select)", () => {
  test("shows the clear control for a selected value by default", () => {
    render(<Dropdown onChange={() => {}} options={options} value={optionA} />);

    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(getClearIndicator()).toBeInTheDocument();
    expect(getDropdownIndicator()).toBeInTheDocument();
  });

  test("does not show the clear control while nothing is selected", () => {
    render(
      <Dropdown onChange={() => {}} options={options} placeholder="Pick one" />,
    );

    expect(screen.getByText("Pick one")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
  });

  test("clearing by default calls onChange with null and shows the placeholder", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={optionA}
        placeholder="Pick one"
      />,
    );

    clickClearIndicator();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(getSingleValue()).toBeNull();
    expect(screen.queryByText("Option A")).not.toBeInTheDocument();
    expect(screen.getByText("Pick one")).toBeInTheDocument();
    // Nothing left to clear.
    expect(getClearIndicator()).toBeNull();
  });

  test("a secondary-button mousedown on the clear control does not clear", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(<Dropdown onChange={onChange} options={options} value={optionA} />);

    fireEvent.mouseDown(getClearIndicator() as HTMLElement, { button: 2 });

    expect(onChange).not.toHaveBeenCalled();
    /*
     * The mousedown still reaches the control, which opens the menu, so
     * read the selected value from the value slot rather than by text.
     */
    expect(getSingleValue()).toHaveTextContent("Option A");
    expect(getClearIndicator()).toBeInTheDocument();
  });

  test("Backspace on an empty input clears a clearable value", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(<Dropdown onChange={onChange} options={options} value={optionA} />);

    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Backspace",
      code: "Backspace",
    });

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByText("Option A")).not.toBeInTheDocument();
  });

  test("isClearable={true} behaves exactly like the default", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={optionB}
        isClearable={true}
      />,
    );

    expect(getClearIndicator()).toBeInTheDocument();

    clickClearIndicator();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByText("Option B")).not.toBeInTheDocument();
  });

  test("isClearable={undefined} falls back to clearable", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={optionA}
        isClearable={undefined}
      />,
    );

    expect(getClearIndicator()).toBeInTheDocument();
  });

  test("isClearable={false} hides the clear control but keeps the value and the menu toggle", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={optionA}
        isClearable={false}
      />,
    );

    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
    expect(getDropdownIndicator()).toBeInTheDocument();
  });

  test("isClearable={false} works with initialValue too", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        initialValue={optionC}
        isClearable={false}
      />,
    );

    expect(screen.getByText("Option C")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
  });

  test("Backspace does not clear a non-clearable value", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={optionA}
        isClearable={false}
      />,
    );

    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Backspace",
      code: "Backspace",
    });
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "Delete",
      code: "Delete",
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Option A")).toBeInTheDocument();
  });

  test("a non-clearable value can still be changed through the menu", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={optionA}
        isClearable={false}
      />,
    );

    openMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Option B" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(getSingleValue()).toHaveTextContent("Option B");
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(screen.queryByText("Option A")).not.toBeInTheDocument();
    // Still no way to clear it after the change.
    expect(getClearIndicator()).toBeNull();
  });

  test("a non-clearable dropdown still lists every option in its menu", async () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={optionA}
        isClearable={false}
      />,
    );

    openMenu();

    expect(
      await screen.findByRole("option", { name: "Option A" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Option B" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Option C" }),
    ).toBeInTheDocument();
  });

  test("a disabled dropdown never shows the clear control", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={optionA}
        disabled={true}
      />,
    );

    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
  });
});

describe("Dropdown isClearable (multi select)", () => {
  test("shows the clear control for selected values by default", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={[optionA, optionB]}
        isMultiSelect={true}
      />,
    );

    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(getClearIndicator()).toBeInTheDocument();
  });

  test("clearing by default calls onChange with an empty array and removes every chip", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={[optionA, optionB]}
        isMultiSelect={true}
        placeholder="Pick some"
      />,
    );

    clickClearIndicator();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByText("Option A")).not.toBeInTheDocument();
    expect(screen.queryByText("Option B")).not.toBeInTheDocument();
    expect(screen.getByText("Pick some")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
  });

  test("isClearable={true} behaves exactly like the default", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={[optionA]}
        isMultiSelect={true}
        isClearable={true}
      />,
    );

    expect(getClearIndicator()).toBeInTheDocument();

    clickClearIndicator();

    expect(onChange).toHaveBeenCalledWith([]);
  });

  test("isClearable={false} hides the clear control but keeps the chips", () => {
    render(
      <Dropdown
        onChange={() => {}}
        options={options}
        value={[optionA, optionB]}
        isMultiSelect={true}
        isClearable={false}
      />,
    );

    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
    expect(getDropdownIndicator()).toBeInTheDocument();
  });

  test("isClearable={false} only drops clear-all: a single chip can still be removed", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={[optionA, optionB]}
        isMultiSelect={true}
        isClearable={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Option A" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["b"]);
    expect(screen.queryByText("Option A")).not.toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
  });

  test("a non-clearable multi select can still add values through the menu", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={options}
        value={[optionA]}
        isMultiSelect={true}
        isClearable={false}
      />,
    );

    openMenu();
    fireEvent.click(await screen.findByRole("option", { name: "Option C" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option C")).toBeInTheDocument();
    expect(getClearIndicator()).toBeNull();
  });
});
