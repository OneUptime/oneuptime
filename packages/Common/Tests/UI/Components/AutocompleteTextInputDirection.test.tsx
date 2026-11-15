import AutocompleteTextInput from "../../../UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT IS TYPED IN AN AUTOCOMPLETE READS THE WAY ITS OWN LETTERS DO.
 *
 * The box holds an attribute's key or value, a pattern or a name: on a
 * Persian page a filter's value "/api/checkout/*" showed as
 * "*" + "/api/checkout/", and "test-*" as "*-test", so the reader saw a
 * different filter from the one they had. The input now takes the
 * direction of most of its letters. An empty box, or one without letters
 * (a number), keeps the page's direction, so its placeholder reads as the
 * page does.
 */

afterEach(() => {
  cleanup();
});

function box(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Value" }) as HTMLInputElement;
}

function renderWith(value: string): void {
  render(
    <AutocompleteTextInput
      value={value}
      ariaLabel="Value"
      placeholder="Value"
      suggestions={[]}
      onChange={() => {
        return undefined;
      }}
    />,
  );
}

describe("an autocomplete's direction", () => {
  test.each([
    ["/api/checkout/*", "ltr"],
    ["test-*", "ltr"],
    ["http.route", "ltr"],
    ["deployment.environment", "ltr"],
    ["سرویس پرداخت", "rtl"],
    ["خدمة الدفع", "rtl"],
  ])("%s reads %s", (value: string, direction: string) => {
    renderWith(value);

    expect(box()).toHaveAttribute("dir", direction);
  });

  test.each([[""], ["499"], ["*"]])(
    "%j has no letters, so it keeps the page's direction",
    (value: string) => {
      renderWith(value);

      expect(box()).not.toHaveAttribute("dir");
    },
  );

  test("follows what is typed", () => {
    renderWith("");

    fireEvent.change(box(), { target: { value: "/api/*" } });
    expect(box()).toHaveAttribute("dir", "ltr");

    fireEvent.change(box(), { target: { value: "پرداخت" } });
    expect(box()).toHaveAttribute("dir", "rtl");

    fireEvent.change(box(), { target: { value: "" } });
    expect(box()).not.toHaveAttribute("dir");
  });
});
