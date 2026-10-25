import Dropdown, {
  DropdownOption,
  getDropdownOptionStyle,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { CSSObjectWithLabel } from "react-select";
import { afterEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * An option that cannot be picked (DropdownOption.isDisabled) is never drawn
 * as the next pick. react-select still moves focus onto it - and onto the
 * first option whenever the menu opens - so a case's own status, listed
 * first and marked Current in Change Status, was painted indigo like the
 * choice Enter would make. Focused, it gets a quiet grey row instead (the
 * keyboard can still see where it is); in dark mode Theme.css does the same.
 */

const INDIGO_FOCUS: string = "#e0e7ff";
const INDIGO_PICKED: string = "#c7d2fe";
const GREY_FOCUS: string = "#f3f4f6";
const GREY_TEXT: string = "#6b7280";

const PROVIDED: CSSObjectWithLabel = { label: "option", padding: 8 };

const current: DropdownOption = {
  value: "new",
  label: "New",
  description: "Current",
  isDisabled: true,
};
const investigating: DropdownOption = {
  value: "investigating",
  label: "Investigating",
};
const contained: DropdownOption = { value: "contained", label: "Contained" };

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

function optionNamed(name: string): HTMLElement {
  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim().startsWith(name);
    });

  expect(option).toBeDefined();

  return option!;
}

afterEach(() => {
  cleanup();
});

describe("getDropdownOptionStyle", () => {
  test("a disabled option with focus on it gets a grey row and muted text, never the indigo of a pick", () => {
    const style: CSSObjectWithLabel = getDropdownOptionStyle(PROVIDED, {
      isDisabled: true,
      isFocused: true,
      isSelected: false,
    });

    expect(style["backgroundColor"]).toBe(GREY_FOCUS);
    expect(style["color"]).toBe(GREY_TEXT);
    expect(style["cursor"]).toBe("not-allowed");
    expect([INDIGO_FOCUS, INDIGO_PICKED]).not.toContain(
      style["backgroundColor"],
    );
    // What react-select provided is kept.
    expect(style["padding"]).toBe(8);
  });

  test("a disabled option without focus has no row colour at all", () => {
    expect(
      getDropdownOptionStyle(PROVIDED, {
        isDisabled: true,
        isFocused: false,
        isSelected: false,
      })["backgroundColor"],
    ).toBe("transparent");
  });

  test("an option that can be picked keeps its colours: indigo-100 with focus, indigo-200 picked, grey text otherwise", () => {
    expect(
      getDropdownOptionStyle(PROVIDED, {
        isDisabled: false,
        isFocused: true,
        isSelected: false,
      })["backgroundColor"],
    ).toBe(INDIGO_FOCUS);
    expect(
      getDropdownOptionStyle(PROVIDED, {
        isDisabled: false,
        isFocused: true,
        isSelected: true,
      })["backgroundColor"],
    ).toBe(INDIGO_PICKED);

    const plain: CSSObjectWithLabel = getDropdownOptionStyle(PROVIDED, {
      isDisabled: false,
      isFocused: false,
      isSelected: false,
    });

    expect(plain["backgroundColor"]).toBeUndefined();
    expect(plain["color"]).toBe("#374151");
  });
});

describe("a disabled first option in the open menu", () => {
  test("takes the focus react-select gives the first option, drawn quiet, and Enter on it picks nothing", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Dropdown
        onChange={onChange}
        options={[current, investigating, contained]}
        placeholder="Choose a status"
      />,
    );

    openMenu();

    const first: HTMLElement = optionNamed("New");

    // react-select focuses it - the reason it must not look like a pick.
    expect(first).toHaveClass("ou-select__option--is-focused");
    expect(first).toHaveClass("ou-select__option--is-disabled");
    expect(first).toHaveAttribute("aria-disabled", "true");
    expect(first).toHaveTextContent("Current");
    // Drawn by getDropdownOptionStyle: a grey row, not the indigo of a pick.
    expect(window.getComputedStyle(first).backgroundColor).toBe(
      "rgb(243, 244, 246)",
    );

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox"), {
        key: "Enter",
        code: "Enter",
      });
    });

    expect(onChange).not.toHaveBeenCalled();

    // The next option down is a pick as before.
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    });

    expect(optionNamed("Investigating")).toHaveClass(
      "ou-select__option--is-focused",
    );
    expect(optionNamed("New")).not.toHaveClass("ou-select__option--is-focused");

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox"), {
        key: "Enter",
        code: "Enter",
      });
    });

    expect(onChange).toHaveBeenCalledWith("investigating");
  });
});

describe("dark mode", () => {
  const theme: string = fs.readFileSync(
    path.join(__dirname, "../../../../UI/Styles/Theme.css"),
    "utf8",
  );

  // The declarations of one rule, by its exact selector.
  function ruleBody(selector: string): string {
    const start: number = theme.indexOf(`\n${selector} {`);

    expect(start).toBeGreaterThan(-1);

    return theme.slice(start, theme.indexOf("}", start));
  }

  test("a disabled option never takes the accent: its own rule and its focused rule come after the focused one", () => {
    const focused: string = "html.dark .ou-select__option--is-focused";
    const disabled: string = "html.dark .ou-select__option--is-disabled";
    const disabledFocused: string =
      "html.dark .ou-select__option--is-disabled.ou-select__option--is-focused";

    expect(ruleBody(focused)).toContain("var(--ou-accent-soft)");

    expect(ruleBody(disabled)).toContain("var(--ou-surface-primary)");
    expect(ruleBody(disabled)).toContain("var(--ou-text-subtle)");
    expect(ruleBody(disabledFocused)).toContain("var(--ou-surface-tertiary)");

    for (const selector of [disabled, disabledFocused]) {
      expect(ruleBody(selector)).not.toContain("accent");
      expect(theme.indexOf(`\n${selector} {`)).toBeGreaterThan(
        theme.indexOf(`\n${focused} {`),
      );
    }
  });
});
