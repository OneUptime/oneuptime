import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import TableBody from "../../../../UI/Components/Table/TableBody";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import Column from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * A yes/no column in a row drawn as a phone's card (TableBody's isMobile).
 *
 * A plain yes/no field that is "no" says nothing: the table draws a quiet
 * dash for it, and the card leaves the field out. A column that draws its
 * own element is different - a rule's Status reads "Disabled" as surely as
 * "Enabled" - and the card used to leave it out too whenever the value was
 * false, so on a phone a disabled rule was drawn exactly like an enabled
 * one with no status at all (seen on Incidents > AI > Settings > Postmortem
 * rules, and the same on every rules table, two-factor setups and team
 * invitations). The desktop row always drew the element.
 */

afterEach(() => {
  cleanup();
});

interface Row {
  _id: string;
  name: string;
  isEnabled: boolean;
}

const STATUS_COLUMN: Column<Row> = {
  title: "Status",
  key: "isEnabled",
  type: FieldType.Boolean,
  getElement: (row: Row): ReactElement => {
    return (
      <span data-testid="status-pill">
        {row.isEnabled ? "Enabled" : "Disabled"}
      </span>
    );
  },
};

// A plain yes/no column: a tick when yes, nothing to say when no.
const PLAIN_COLUMN: Column<Row> = {
  title: "Enabled",
  key: "isEnabled",
  type: FieldType.Boolean,
};

const NAME_COLUMN: Column<Row> = {
  title: "Name",
  key: "name",
  type: FieldType.Text,
};

function rule(index: number, isEnabled: boolean): Row {
  return {
    _id: `55000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Rule ${index}`,
    isEnabled,
  };
}

function renderBody(
  rows: Array<Row>,
  columns: Array<Column<Row>>,
  isMobile: boolean,
): void {
  const body: ReactElement = (
    <TableBody<Row>
      id="rules-body"
      data={rows}
      columns={columns}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={isMobile}
    />
  );

  render(isMobile ? body : <table>{body}</table>);
}

// The field names a card draws, in order.
function fieldNames(): Array<string> {
  return Array.from(document.querySelectorAll("dt")).map(
    (dt: Element): string => {
      return dt.textContent || "";
    },
  );
}

describe("a yes/no column that draws its own element, in a phone's card", () => {
  test("a disabled rule says Disabled, as an enabled one says Enabled", () => {
    renderBody(
      [rule(1, true), rule(2, false)],
      [NAME_COLUMN, STATUS_COLUMN],
      true,
    );

    expect(
      screen.getAllByTestId("status-pill").map((pill: HTMLElement) => {
        return pill.textContent;
      }),
    ).toEqual(["Enabled", "Disabled"]);
    // Each card names the field over its value.
    expect(fieldNames()).toEqual(["Name", "Status", "Name", "Status"]);

    const disabled: HTMLElement = screen.getByText("Disabled");
    expect(disabled.closest("dd")).not.toBeNull();
    expect(
      within(disabled.closest("dl") as HTMLElement).getByText("Status").tagName,
    ).toBe("DT");
  });

  test("an element the column draws for no is never swapped for the quiet dash", () => {
    renderBody([rule(1, false)], [STATUS_COLUMN], true);

    expect(screen.getByTestId("status-pill")).toHaveTextContent("Disabled");
    expect(
      screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a column that draws nothing for no still leaves the field out", () => {
    renderBody(
      [rule(1, false)],
      [
        NAME_COLUMN,
        {
          ...STATUS_COLUMN,
          getElement: (row: Row): ReactElement | null => {
            return row.isEnabled ? <span>Enabled</span> : null;
          },
        } as Column<Row>,
      ],
      true,
    );

    expect(fieldNames()).toEqual(["Name"]);
  });
});

describe("a plain yes/no column, in a phone's card", () => {
  test("yes is drawn, and no is left out - nothing to say", () => {
    renderBody(
      [rule(1, true), rule(2, false)],
      [NAME_COLUMN, PLAIN_COLUMN],
      true,
    );

    expect(fieldNames()).toEqual(["Name", "Enabled", "Name"]);
    expect(screen.getAllByTestId("table-boolean-yes")).toHaveLength(1);
  });
});

describe("the same columns in a row of a table", () => {
  test("draw the element for yes and for no, as they always did", () => {
    renderBody(
      [rule(1, true), rule(2, false)],
      [NAME_COLUMN, STATUS_COLUMN],
      false,
    );

    expect(
      screen.getAllByTestId("status-pill").map((pill: HTMLElement) => {
        return pill.textContent;
      }),
    ).toEqual(["Enabled", "Disabled"]);
  });
});
