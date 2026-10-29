import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import FilterButtons from "../../../UI/Components/FilterButtons/FilterButtons";

/*
 * A ROW OF FILTER BUTTONS IS A CHOICE, NEVER A SUBMIT: inside a form (a
 * detection rule's Run on Past Events picks its period under the rule's
 * YAML) a bare <button> sends the form. And each option can carry a test
 * id of its own, the group's and its value.
 */

describe("FilterButtons", () => {
  afterEach(() => {
    cleanup();
  });

  const OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Last 24 hours", value: "24" },
    { label: "Last 7 days", value: "168" },
  ];

  test("every option is a plain button: choosing one inside a form never sends it", () => {
    const onSubmit: ReturnType<typeof jest.fn> = jest.fn();
    const onSelect: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <form
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <FilterButtons
          options={OPTIONS}
          selectedValue="168"
          onSelect={onSelect as unknown as (value: string) => void}
        />
      </form>,
    );

    for (const button of screen.getAllByRole("radio")) {
      expect(button).toHaveAttribute("type", "button");
    }

    fireEvent.click(screen.getByText("Last 24 hours"));

    expect(onSelect).toHaveBeenCalledWith("24");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("with a test id, each option carries it and its value", () => {
    render(
      <FilterButtons
        options={OPTIONS}
        selectedValue="24"
        onSelect={() => {
          // not chosen here
        }}
        dataTestId="retrohunt-period"
      />,
    );

    expect(screen.getByTestId("retrohunt-period-24")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("retrohunt-period-168")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("without one, no option names a test id", () => {
    const { container } = render(
      <FilterButtons
        options={OPTIONS}
        selectedValue="24"
        onSelect={() => {
          // not chosen here
        }}
      />,
    );

    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });
});
