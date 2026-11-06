/*
 * What is wrong with what was typed into a record step's field - words in a
 * number column, something that is no date in a date column - said under
 * the value as every field's error is (FieldError): in the error's own red,
 * which reads at 6.5:1 on white where the light red it had (text-red-500)
 * was 3.8:1, said politely as it comes and goes with each keystroke, and
 * found by the column it is about. It only advises: saving still goes ahead
 * (rowIssue).
 *
 * The same in a query's condition row, which says it the same way.
 */

import ColumnFieldRow from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnFieldRow";
import ColumnConditionRow from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnConditionRow";
import {
  ColumnValueMode,
  ModelColumnRow,
  makeColumnRow,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { FIELD_ERROR_COLOR_CLASS_NAME } from "../../../../../UI/Components/Forms/Fields/FieldError";
import { withPicker } from "../ValuePicker/ValuePickerTestUtils";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

const ORDER: ModelSchemaColumn = {
  id: "order",
  title: "Order",
  type: TableColumnType.Number,
  isRelation: false,
};

const CREATED_AT: ModelSchemaColumn = {
  id: "createdAt",
  title: "Created At",
  type: TableColumnType.Date,
  isRelation: false,
};

const COLUMNS: Array<ModelSchemaColumn> = [ORDER, CREATED_AT];

type RowFunction = (column: ModelSchemaColumn, text: string) => ModelColumnRow;

const rowOf: RowFunction = (
  column: ModelSchemaColumn,
  text: string,
): ModelColumnRow => {
  return makeColumnRow({
    columnId: column.id,
    valueMode: ColumnValueMode.Literal,
    text: text,
  });
};

type DrawFunction = (element: ReactElement) => void;

const draw: DrawFunction = (element: ReactElement): void => {
  render(withPicker(element));
};

const fieldRow: (column: ModelSchemaColumn, text: string) => ReactElement = (
  column: ModelSchemaColumn,
  text: string,
): ReactElement => {
  return (
    <ColumnFieldRow
      row={rowOf(column, text)}
      column={column}
      knownColumnIds={COLUMNS.map((each: ModelSchemaColumn): string => {
        return each.id;
      })}
      isRequired={false}
      onChange={() => {}}
      onRemove={() => {}}
    />
  );
};

const conditionRow: (
  column: ModelSchemaColumn,
  text: string,
) => ReactElement = (column: ModelSchemaColumn, text: string): ReactElement => {
  return (
    <ColumnConditionRow
      row={rowOf(column, text)}
      column={column}
      columns={COLUMNS}
      onChange={() => {}}
      onRemove={() => {}}
    />
  );
};

type RedsOfFunction = (element: HTMLElement) => Array<string>;

const redsOf: RedsOfFunction = (element: HTMLElement): Array<string> => {
  return Array.from(element.classList).filter((token: string): boolean => {
    return token.startsWith("text-red-");
  });
};

afterEach(() => {
  cleanup();
});

describe.each([
  ["a record's field", fieldRow],
  ["a query's condition", conditionRow],
])(
  "%s",
  (
    _kind: string,
    rowFor: (column: ModelSchemaColumn, text: string) => ReactElement,
  ) => {
    test("words in a number column: said under the value, in every field's red", () => {
      draw(rowFor(ORDER, "third"));

      const issue: HTMLElement = screen.getByTestId("model-column-issue-order");

      expect(issue).toHaveTextContent("This column takes a number.");
      expect(issue).toHaveClass("mt-1", "text-[11px]");
      expect(redsOf(issue)).toEqual([FIELD_ERROR_COLOR_CLASS_NAME]);
    });

    test("said politely, as it comes and goes with the typing, never as an alert", () => {
      draw(rowFor(ORDER, "third"));

      const issue: HTMLElement = screen.getByTestId("model-column-issue-order");

      expect(issue).toHaveAttribute("aria-live", "polite");
      expect(issue).not.toHaveAttribute("role");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("something that is no date in a date column", () => {
      draw(rowFor(CREATED_AT, "soon"));

      expect(
        screen.getByTestId("model-column-issue-createdAt"),
      ).toHaveTextContent("This column takes a date and time.");
    });

    test("a value that fits its column says nothing", () => {
      draw(rowFor(ORDER, "3"));

      expect(screen.queryByTestId("model-column-issue-order")).toBeNull();
    });

    test("nor does an empty one", () => {
      draw(rowFor(ORDER, ""));

      expect(screen.queryByTestId("model-column-issue-order")).toBeNull();
    });
  },
);
