/*
 * The key/value editor can be handed the box a Text row's value is typed
 * into: the workflow builder gives request headers its value picker there,
 * so an Authorization header can be a secret variable.
 */

import DictionaryForm, {
  ValueType,
} from "../../../UI/Components/Dictionary/Dictionary";
import getJestMockFunction, { MockFunction } from "../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

afterEach(() => {
  cleanup();
});

type ValueBoxFunction = (row: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  rowIndex: number;
}) => ReactElement;

const valueBox: ValueBoxFunction = (row: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  rowIndex: number;
}): ReactElement => {
  return (
    <input
      data-testid={`value-box-${row.rowIndex}`}
      value={row.value}
      placeholder={row.placeholder}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
        row.onChange(event.target.value);
      }}
    />
  );
};

describe("DictionaryForm — a value box of the caller's", () => {
  test("is used for each Text row, and what it reports is stored", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <DictionaryForm
        initialValue={{ Authorization: "Bearer x", Accept: "json" }}
        valuePlaceholder="Value"
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
        renderTextValueInput={valueBox}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId("value-box-0")).toHaveValue("Bearer x");
    expect(screen.getByTestId("value-box-1")).toHaveValue("json");
    expect(screen.getByTestId("value-box-0")).toHaveAttribute(
      "placeholder",
      "Value",
    );

    fireEvent.change(screen.getByTestId("value-box-0"), {
      target: { value: "{{global.variables.TOKEN}}" },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      Authorization: "{{global.variables.TOKEN}}",
      Accept: "json",
    });
  });

  test("is not used for a number row", () => {
    render(
      <DictionaryForm
        initialValue={{ retries: 3 }}
        valueTypes={[ValueType.Text, ValueType.Number, ValueType.Boolean]}
        renderTextValueInput={valueBox}
      />,
    );

    expect(screen.queryByTestId("value-box-0")).toBeNull();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
  });

  test("without one, a Text row keeps the usual box", () => {
    render(<DictionaryForm initialValue={{ Accept: "json" }} />);

    expect(screen.getByDisplayValue("json")).toBeInTheDocument();
  });
});
