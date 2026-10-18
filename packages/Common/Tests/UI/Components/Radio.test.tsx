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

/*
 * A choice of modes, as two plain options with one line each, in place of a
 * switch whose help explained both ("Use Windows Integrated Authentication
 * ... Username and password are ignored."). The line sits under the
 * option's own label and describes its radio; an option without one is
 * drawn exactly as before.
 */
describe("Radio options with a line of their own", () => {
  afterEach(() => {
    cleanup();
  });

  const OPTIONS: Array<{ label: string; value: string; description: string }> =
    [
      {
        label: "Username and password",
        value: "username-and-password",
        description: "Sign in with a SQL Server login.",
      },
      {
        label: "Windows Integrated Authentication",
        value: "windows-integrated",
        description:
          "Sign in as the account the probe runs as. No password needed.",
      },
    ];

  test("each option shows its line under its label", () => {
    render(
      <Radio
        options={OPTIONS}
        value="username-and-password"
        ariaLabel="Authentication"
      />,
    );

    for (const option of OPTIONS) {
      expect(screen.getByText(option.description)).toBeInTheDocument();
    }
  });

  test("the line describes its radio, and the radio is still named by its label alone", () => {
    render(
      <Radio
        options={OPTIONS}
        value="username-and-password"
        ariaLabel="Authentication"
      />,
    );

    for (const option of OPTIONS) {
      const radio: HTMLElement = screen.getByRole("radio", {
        name: option.label,
      });

      expect(radio).toHaveAccessibleDescription(option.description);
    }
  });

  test("the radio sits level with the label's first line when the option has a line", () => {
    render(
      <Radio
        options={OPTIONS}
        value="username-and-password"
        ariaLabel="Authentication"
      />,
    );

    const radio: HTMLElement = screen.getByRole("radio", {
      name: "Username and password",
    });

    expect(radio).toHaveClass("mt-1");
    expect(radio.parentElement).toHaveClass("items-start");
  });

  test("picking an option still tells its value", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <Radio
        options={OPTIONS}
        value="username-and-password"
        ariaLabel="Authentication"
        onChange={onChange as unknown as (value: unknown) => void}
      />,
    );

    fireEvent.click(
      screen.getByRole("radio", { name: "Windows Integrated Authentication" }),
    );

    expect(onChange).toHaveBeenCalledWith("windows-integrated");
  });

  test("an option without a line is drawn as before: centred, and described by nothing", () => {
    render(
      <Radio
        options={[
          { label: "All", value: "All" },
          { label: "Any", value: "Any" },
        ]}
        value="All"
        ariaLabel="Match Condition"
      />,
    );

    const radio: HTMLElement = screen.getByRole("radio", { name: "All" });

    expect(radio).not.toHaveAttribute("aria-describedby");
    expect(radio).not.toHaveClass("mt-1");
    expect(radio.parentElement).toHaveClass("items-center");
  });
});
