import FilterButtons from "../../../UI/Components/FilterButtons/FilterButtons";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * FilterButtons is a radio group. Two of them on one screen - the discovery
 * import's "Responded" and "Name" facets - were both "Filter options" to a
 * screen reader, so nobody could tell which group a radio belonged to. The
 * group takes the name of what it filters by when it is given one, and
 * keeps the generic name everywhere else.
 */

const OPTIONS: Array<{ label: string; value: string }> = [
  { label: "All (5)", value: "all" },
  { label: "Named (3)", value: "named" },
];

describe("FilterButtons' name", () => {
  afterEach(() => {
    cleanup();
  });

  test("is what it filters by, when it is given that", () => {
    render(
      <>
        <FilterButtons
          ariaLabel="Responded"
          options={OPTIONS}
          selectedValue="all"
          onSelect={() => {}}
        />
        <FilterButtons
          ariaLabel="Name"
          options={OPTIONS}
          selectedValue="named"
          onSelect={() => {}}
        />
      </>,
    );

    const responded: HTMLElement = screen.getByRole("radiogroup", {
      name: "Responded",
    });
    const name: HTMLElement = screen.getByRole("radiogroup", { name: "Name" });

    expect(
      within(responded).getByRole("radio", { name: "All (5)" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(name).getByRole("radio", { name: "Named (3)" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("radiogroup", { name: "Filter options" }),
    ).not.toBeInTheDocument();
  });

  test("stays the generic one everywhere nothing else is given", () => {
    render(
      <FilterButtons
        options={OPTIONS}
        selectedValue="all"
        onSelect={() => {}}
      />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "Filter options" }),
    ).toBeInTheDocument();
  });
});
