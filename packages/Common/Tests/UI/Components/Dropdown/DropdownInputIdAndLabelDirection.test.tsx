import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { openDropdown } from "../../../DropdownPicks";

/*
 * Two things the pickers that were raw <select>s needed from the shared
 * Dropdown (#9294):
 *
 *   - inputId: a <label htmlFor> names the picker, and in a browser puts
 *     the focus in it, as it did for the select ("Time range", "Steps", a
 *     project).
 *   - labelDirection: an option the caller knows reads one way, whatever
 *     its letters - a page path in RUM User Flows reads from the left.
 */

afterEach(() => {
  cleanup();
});

describe("inputId", () => {
  test("a label names the picker by its id", () => {
    render(
      <div>
        <label htmlFor="range-picker">Time range</label>
        <Dropdown
          inputId="range-picker"
          options={[{ value: "1", label: "Last hour" }]}
          isClearable={false}
        />
      </div>,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Time range",
    });

    expect(combobox).toHaveAttribute("id", "range-picker");
    expect(screen.getByLabelText("Time range")).toBe(combobox);
  });

  test("left out, react-select names its input itself", () => {
    render(<Dropdown options={[]} ariaLabel="Plain" />);

    expect(screen.getByRole("combobox", { name: "Plain" }).id).toMatch(
      /^react-select-/,
    );
  });
});

describe("labelDirection", () => {
  const path: string = "/الرئيسية (12)";

  function labelOf(option: DropdownOption): HTMLElement {
    cleanup();
    render(<Dropdown options={[option]} ariaLabel="Page" />);
    openDropdown(screen.getByRole("combobox", { name: "Page" }));

    return screen.getByTestId("dropdown-option-label");
  }

  test("set, it is the option's way, in the menu and in the box", () => {
    const option: DropdownOption = {
      value: "/home",
      label: path,
      isUserContent: true,
      labelDirection: "ltr",
    };

    expect(labelOf(option)).toHaveAttribute("dir", "ltr");

    cleanup();
    render(<Dropdown options={[option]} value={option} ariaLabel="Page" />);
    expect(screen.getByTestId("dropdown-value-label")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("left out, the label reads the way most of its letters do", () => {
    expect(
      labelOf({ value: "/home", label: path, isUserContent: true }),
    ).toHaveAttribute("dir", "rtl");
  });
});
