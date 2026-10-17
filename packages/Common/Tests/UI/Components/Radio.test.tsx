import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Radio from "../../../UI/Components/Radio/Radio";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The radio a form's RadioButton field draws (FormField), such as a rule's
 * Match Condition (All / Any). The product loads Tailwind without the forms
 * plugin, so its text- and ring- colours do nothing to the browser's own
 * radio: a checked one was the browser's blue, under a rule's indigo "All
 * incidents" / "Only incidents that match conditions" in the same form.
 * accent-color is what colours it, as ChoiceRows and RuleAppliesToChoice
 * draw theirs.
 */
describe("Radio", () => {
  afterEach(() => {
    cleanup();
  });

  const OPTIONS: Array<{ label: string; value: string }> = [
    { label: "All", value: "All" },
    { label: "Any", value: "Any" },
  ];

  test("each radio is the product's indigo, not the browser's blue", () => {
    render(<Radio options={OPTIONS} value="All" ariaLabel="Match Condition" />);

    const radios: Array<HTMLElement> = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).toHaveClass("accent-indigo-600");
    }
  });

  test("names each radio by its words, checks the value, and tells the change", () => {
    const onChange: MockFunction = getJestMockFunction();
    render(
      <Radio
        options={OPTIONS}
        value="All"
        ariaLabel="Match Condition"
        onChange={onChange as unknown as (value: unknown) => void}
      />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "Match Condition" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Any" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Any" }));

    expect(onChange).toHaveBeenCalledWith("Any");
    expect(screen.getByRole("radio", { name: "Any" })).toBeChecked();
  });
});
