import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A locked dropdown looks locked (found in the UI review of #6389, the
 * Discovered Devices page's Unseen Devices card, locked for a Project
 * Member): the control is grey, as a locked Input is (bg-gray-100).
 *
 * The control used to carry !bg-white always and !bg-gray-100 as well when
 * locked. Both are !important background colours, so the one the
 * stylesheet wrote last won - and Tailwind writes bg-white after
 * bg-gray-100: a locked dropdown drew white, exactly like one that opens,
 * and only a tooltip on hover said otherwise. So the control carries one
 * fill or the other, never both.
 */

const options: Array<DropdownOption> = [
  { value: 30, label: "30 days" },
  { value: 0, label: "Never" },
];

const BACKGROUND_CLASS: RegExp = /^!bg-/;
const WHITESPACE: RegExp = /\s+/;

function control(): HTMLElement {
  const element: HTMLElement | null = document.querySelector<HTMLElement>(
    ".ou-select__control",
  );

  expect(element).not.toBeNull();

  return element as HTMLElement;
}

function fills(): Array<string> {
  return control()
    .className.split(WHITESPACE)
    .filter((name: string): boolean => {
      return BACKGROUND_CLASS.test(name);
    });
}

afterEach(() => {
  cleanup();
});

describe("a locked dropdown's look", () => {
  test("a locked dropdown is grey, and nothing else fills it", () => {
    render(
      <Dropdown
        options={options}
        value={options[0]}
        disabled={true}
        onChange={() => {}}
      />,
    );

    expect(control()).toHaveClass("ou-select__control--is-disabled");
    expect(fills()).toEqual(["!bg-gray-100"]);
    expect(control()).not.toHaveClass("!cursor-pointer");
  });

  test("an open one is white, and points as a button does", () => {
    render(
      <Dropdown options={options} value={options[0]} onChange={() => {}} />,
    );

    expect(control()).not.toHaveClass("ou-select__control--is-disabled");
    expect(fills()).toEqual(["!bg-white"]);
    expect(control()).toHaveClass("!cursor-pointer");
  });

  test("its value still reads in full when locked: only the box is grey", () => {
    render(
      <Dropdown
        options={options}
        value={options[1]}
        disabled={true}
        onChange={() => {}}
      />,
    );

    expect(
      document.querySelector(".ou-select__single-value"),
    ).toHaveTextContent("Never");
  });
});
