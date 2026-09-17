import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "@jest/globals";
import Color from "../../../../Types/Color";

/*
 * A selected chip carries a remove button, and react-select names that button
 * after whatever formatOptionLabel returned: `"Remove " + children`. Dropdown
 * returns an element there - the option's text beside a colour dot and its
 * labels - so the name came out as "Remove [object Object]" for every chip in
 * every multi-select in the product. E2E caught it on the SLO "Add Monitors"
 * modal, where the chip is how a test (or a screen reader) tells that a monitor
 * was actually picked.
 */
describe("Dropdown multi-select chip", () => {
  const options: Array<DropdownOption> = [
    { value: "monitor-1", label: "E2E SLO Monitor" },
    { value: "monitor-2", label: "Another Monitor" },
  ];

  test("names the remove button after the option, not the rendered element", () => {
    render(
      <Dropdown
        isMultiSelect={true}
        onChange={() => {}}
        options={options}
        value={[options[0]!]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove E2E SLO Monitor" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /\[object Object\]/ }),
    ).not.toBeInTheDocument();
  });

  test("still names the button when the option renders a colour dot and labels", () => {
    const decoratedOption: DropdownOption = {
      value: "monitor-3",
      label: "Coloured Monitor",
      color: Color.fromString("#4f46e5"),
      labels: [{ name: "production", color: Color.fromString("#16a34a") }],
    };

    render(
      <Dropdown
        isMultiSelect={true}
        onChange={() => {}}
        options={[decoratedOption]}
        value={[decoratedOption]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Coloured Monitor" }),
    ).toBeInTheDocument();
  });
});
