/*
 * The record editor's value cells - Create One Incident's fields, which the
 * maintainer held up as the picker every setting should have - with the same
 * value picker as every other workflow setting.
 *
 * A text cell is the chip editor: { } or "{{" puts a value where the caret
 * is. A number, a switch, a date or a colour keeps its control with { }
 * beside it; a picked value replaces it as a chip, and "abc" goes back.
 */

import ColumnValueInput from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import {
  DictionaryFilterOperator,
  getOperatorOption,
} from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import { INSERT_VALUE_LABEL } from "../../../../../UI/Components/Workflow/ValuePicker/ValueTextField";
import {
  BODY,
  DEPLOY_ENV,
  chipsIn,
  keys,
  placeCaret,
  withPicker,
} from "../ValuePicker/ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

interface CellProps {
  control: ModelColumnControl;
  valueMode?: ColumnValueMode;
  text?: string;
  operator?: DictionaryFilterOperator;
  withoutPicker?: boolean;
}

type RenderCellFunction = (props: CellProps) => {
  onChange: MockFunction;
  user: UserEvent;
};

const renderCell: RenderCellFunction = (
  props: CellProps,
): { onChange: MockFunction; user: UserEvent } => {
  const onChange: MockFunction = getJestMockFunction();

  const cell: ReactElement = (
    <ColumnValueInput
      control={props.control}
      valueMode={props.valueMode || ColumnValueMode.Literal}
      text={props.text || ""}
      values={[]}
      operatorOption={
        props.operator ? getOperatorOption(props.operator) : undefined
      }
      dataTestId="cell"
      onChange={onChange}
    />
  );

  render(props.withoutPicker ? cell : withPicker(cell));

  return { onChange: onChange, user: userEvent.setup({ delay: null }) };
};

type PickFunction = (reference: string) => void;

const pick: PickFunction = (reference: string): void => {
  fireEvent.click(
    screen.getAllByRole("option").find((option: HTMLElement) => {
      return option.getAttribute("data-reference") === reference;
    })!,
  );
};

type LastFunction = (mock: MockFunction) => unknown;

const last: LastFunction = (mock: MockFunction): unknown => {
  const calls: Array<Array<unknown>> = mock.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]?.[0];
};

afterEach(() => {
  cleanup();
});

describe("a text cell", () => {
  test("{ } puts the value at the caret, and the cell is then a reference", () => {
    const { onChange } = renderCell({
      control: ModelColumnControl.Text,
      text: "Alert: ",
    });

    placeCaret(screen.getByTestId("cell"), 7);
    fireEvent.mouseDown(screen.getByTestId("cell-insert-value"));
    fireEvent.click(screen.getByTestId("cell-insert-value"));
    pick(BODY);

    expect(last(onChange)).toEqual({
      text: `Alert: ${BODY}`,
      valueMode: ColumnValueMode.Reference,
    });
  });

  test("typing {{ offers the values too", async () => {
    const { onChange, user } = renderCell({ control: ModelColumnControl.Text });

    placeCaret(screen.getByTestId("cell"), 0);
    await user.keyboard(`${keys("{{deploy")}{Enter}`);

    expect(last(onChange)).toEqual({
      text: DEPLOY_ENV,
      valueMode: ColumnValueMode.Reference,
    });
  });

  test("a reference stored in it is a chip, and plain text after it is still text", async () => {
    const { onChange, user } = renderCell({
      control: ModelColumnControl.Text,
      valueMode: ColumnValueMode.Reference,
      text: DEPLOY_ENV,
    });

    const cell: HTMLElement = screen.getByTestId("cell");

    expect(chipsIn(cell)).toHaveLength(1);
    expect(screen.queryByText(DEPLOY_ENV)).toBeNull();

    placeCaret(cell, DEPLOY_ENV.length);
    await user.keyboard("-eu");

    expect(last(onChange)).toEqual({
      text: `${DEPLOY_ENV}-eu`,
      valueMode: ColumnValueMode.Reference,
    });
  });

  test("text with no reference in it is a typed value", async () => {
    const { onChange, user } = renderCell({ control: ModelColumnControl.Text });

    placeCaret(screen.getByTestId("cell"), 0);
    await user.keyboard("Checkout is down");

    expect(last(onChange)).toEqual({
      text: "Checkout is down",
      valueMode: ColumnValueMode.Literal,
    });
  });

  test("an ID cell is in a fixed-width font", () => {
    renderCell({ control: ModelColumnControl.ObjectId });

    expect(screen.getByTestId("cell").className).toContain("font-mono");
  });
});

describe("a cell with a control of its own", () => {
  test.each([
    [ModelColumnControl.Number],
    [ModelColumnControl.Boolean],
    [ModelColumnControl.Date],
    [ModelColumnControl.Color],
  ])(
    "%s keeps its control, with { } beside it",
    (control: ModelColumnControl) => {
      renderCell({ control: control });

      expect(screen.getByTestId("cell-insert-value")).toHaveAccessibleName(
        INSERT_VALUE_LABEL,
      );
      expect(screen.queryByTestId("cell-type-a-value")).toBeNull();
    },
  );

  test("a picked value replaces the number, as a reference", () => {
    const { onChange } = renderCell({
      control: ModelColumnControl.Number,
      text: "3",
    });

    fireEvent.click(screen.getByTestId("cell-insert-value"));
    pick(DEPLOY_ENV);

    expect(last(onChange)).toEqual({
      text: DEPLOY_ENV,
      valueMode: ColumnValueMode.Reference,
    });
  });

  test("holding a reference it shows the chip; abc goes back to typing a number", async () => {
    const { onChange, user } = renderCell({
      control: ModelColumnControl.Number,
      valueMode: ColumnValueMode.Reference,
      text: DEPLOY_ENV,
    });

    expect(chipsIn(screen.getByTestId("cell"))).toHaveLength(1);

    await user.click(screen.getByTestId("cell-type-a-value"));

    expect(last(onChange)).toEqual({
      valueMode: ColumnValueMode.Literal,
      text: "",
    });
  });

  test("the switch's three states are still there", () => {
    renderCell({ control: ModelColumnControl.Boolean, text: "true" });

    expect(screen.getByRole("button", { name: "True" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Not set" })).toBeInTheDocument();
  });

  test("Escape closes the list and puts the focus back on { }", async () => {
    const { user } = renderCell({ control: ModelColumnControl.Number });

    await user.click(screen.getByTestId("cell-insert-value"));
    expect(screen.getByTestId("value-picker-search")).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("value-picker")).toBeNull();
    });
    expect(screen.getByTestId("cell-insert-value")).toHaveFocus();
  });
});

describe("cells the picker stays out of", () => {
  test("a value kept exactly as it was saved, until it is edited", () => {
    renderCell({
      control: ModelColumnControl.Number,
      valueMode: ColumnValueMode.Raw,
      text: "8080",
    });

    expect(screen.getByDisplayValue("8080")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-insert-value")).toBeNull();
  });

  test("an operator that takes a list keeps the list input", () => {
    renderCell({
      control: ModelColumnControl.Text,
      operator: DictionaryFilterOperator.IsAnyOf,
    });

    expect(
      screen.getByPlaceholderText("Type a value and press Enter"),
    ).toBeInTheDocument();
  });

  test("an operator that takes no value says so", () => {
    renderCell({
      control: ModelColumnControl.Text,
      operator: DictionaryFilterOperator.IsEmpty,
    });

    expect(screen.getByText("No value needed")).toBeInTheDocument();
  });

  test("outside a step's settings there is nothing to pick from", () => {
    renderCell({ control: ModelColumnControl.Number, withoutPicker: true });

    expect(screen.queryByTestId("cell-insert-value")).toBeNull();
  });
});
