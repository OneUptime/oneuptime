/*
 * The key/value editor's rows shown to be read, not changed (readOnly): a
 * workflow step opened by someone who may not change it - an API step's
 * request headers, read on a view (Workflow/ArgumentsForm).
 *
 * Each row stays as it is, and nothing that only changes the rows is drawn:
 * no Add, no Delete beside a row, and nothing to clear on a row's type or
 * comparison. Drawn and held still, they looked as if they could be
 * pressed. With no rows, "None" stands where Add would be. The boxes
 * themselves are the caller's to hold still (a disabled fieldset).
 */

import DictionaryForm, {
  DICTIONARY_NO_ROWS_TEXT,
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

const HEADERS: { [key: string]: string } = {
  Authorization: "Bearer deploy-token",
  "X-Request-Source": "OneUptime",
};

describe("DictionaryForm — read only", () => {
  test("its rows are shown as they are, with no Delete beside them and no Add under them", () => {
    render(
      <DictionaryForm
        initialValue={HEADERS}
        addButtonSuffix="Request Headers"
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
        readOnly={true}
      />,
    );

    expect(screen.getByDisplayValue("Authorization")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bearer deploy-token")).toBeInTheDocument();
    expect(screen.getByDisplayValue("X-Request-Source")).toBeInTheDocument();

    expect(screen.queryByTestId("delete-Authorization")).toBeNull();
    expect(screen.queryByTestId("delete-X-Request-Source")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add Request Headers" }),
    ).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  test("a row's type is shown, with nothing to clear", () => {
    const { container } = render(
      <DictionaryForm
        initialValue={HEADERS}
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
        readOnly={true}
      />,
    );

    expect(
      container.querySelectorAll(".ou-select__control--is-disabled"),
    ).toHaveLength(2);
    expect(container.querySelector(".ou-select__clear-indicator")).toBeNull();
    expect(screen.getAllByText("Text")).toHaveLength(2);
  });

  test("with an operator, the comparison is shown with nothing to clear", () => {
    const { container } = render(
      <DictionaryForm
        initialValue={{ env: "production" }}
        enableOperators={true}
        readOnly={true}
      />,
    );

    expect(
      container.querySelectorAll(".ou-select__control--is-disabled").length,
    ).toBeGreaterThan(0);
    expect(container.querySelector(".ou-select__clear-indicator")).toBeNull();
  });

  test("with no rows, it says None where Add would be", () => {
    render(
      <DictionaryForm
        initialValue={{}}
        addButtonSuffix="Request Headers"
        readOnly={true}
      />,
    );

    expect(DICTIONARY_NO_ROWS_TEXT).toBe("None");
    expect(screen.getByTestId("dictionary-none")).toHaveTextContent("None");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  /*
   * A value always has a type, so its box has nothing to clear (clearing it
   * only put Text back): whoever may change the rows changes the type by
   * picking another one.
   */
  test("for whoever may change it, the rows come with Delete, Add and a type to pick", () => {
    const { container } = render(
      <DictionaryForm
        initialValue={HEADERS}
        addButtonSuffix="Request Headers"
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
      />,
    );

    expect(screen.getByTestId("delete-Authorization")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Request Headers" }),
    ).toBeEnabled();
    expect(
      container.querySelectorAll(".ou-select__control--is-disabled"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll(".ou-select__control").length,
    ).toBeGreaterThan(0);
    for (const type of screen.getAllByRole("combobox", { name: "Type" })) {
      expect(type).toBeEnabled();
    }
    expect(container.querySelector(".ou-select__clear-indicator")).toBeNull();
    expect(screen.queryByTestId("dictionary-none")).toBeNull();
  });
});
