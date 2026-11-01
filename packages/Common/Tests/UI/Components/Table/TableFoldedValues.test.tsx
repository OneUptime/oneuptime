import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import TableFoldedValues, {
  TABLE_FOLDED_MAIN_CLASS_NAMES,
  TABLE_FOLDED_VALUES_TEST_ID,
  TABLE_FOLDED_VALUE_CLASS_NAME,
  TABLE_FOLDED_VALUE_TEST_ID,
  TABLE_FOLDED_VALUE_TITLE_TEST_ID,
  TableFoldedMainLayout,
} from "../../../../UI/Components/Table/TableFoldedValues";
import TableEmptyValue from "../../../../UI/Components/Table/TableEmptyValue";
import {
  getColumnsFoldedInto,
  getDrawnTableColumns,
} from "../../../../UI/Components/Table/FoldedColumns";
import { TABLE_SHRINKABLE_ATTRIBUTE } from "../../../../UI/Components/Table/TableLayout";
import Column from "../../../../UI/Components/Table/Types/Column";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import GenericObject from "../../../../Types/GenericObject";

/*
 * A column folded into another's cell (Column.foldInto): where a list does
 * not fit its card - the incidents list beside a side menu at 1280px ran
 * 560px past it - the table itself shows the folded column's value under
 * the value of the column it names, on a line of its own: an incident's
 * labels and owners under its title, its severity under its state, how
 * long it lasted under when it was declared. Every value stays on the row.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
});

describe("TableFoldedValues", () => {
  test("with nothing folded into it, the cell is its own value and nothing more", () => {
    render(
      <div data-testid="cell">
        <TableFoldedValues main={<span>Checkout API</span>} folded={[]} />
      </div>,
    );

    const cell: HTMLElement = screen.getByTestId("cell");

    expect(cell.innerHTML).toBe("<span>Checkout API</span>");
    expect(screen.queryByTestId(TABLE_FOLDED_VALUES_TEST_ID)).toBeNull();
  });

  test("an empty folded value draws no line: the quiet dash and nothing at all are left out", () => {
    render(
      <div data-testid="cell">
        <TableFoldedValues
          main={<span>Checkout API</span>}
          folded={[
            { title: "Labels", content: <TableEmptyValue /> },
            { title: "Owners", content: null },
            { title: "Note", content: "   " },
          ]}
        />
      </div>,
    );

    expect(screen.getByTestId("cell").innerHTML).toBe(
      "<span>Checkout API</span>",
    );
  });

  test("each folded value is a line of its own under the cell's, its column named for a screen reader", () => {
    render(
      <TableFoldedValues
        main={<span>Checkout API returns 502</span>}
        folded={[
          { title: "Labels", content: <span>production</span> },
          { title: "Owners", content: <span>Ada Lovelace</span> },
        ]}
      />,
    );

    const box: HTMLElement = screen.getByTestId(TABLE_FOLDED_VALUES_TEST_ID);
    const lines: Array<HTMLElement> = screen.getAllByTestId(
      TABLE_FOLDED_VALUE_TEST_ID,
    );

    expect(box.firstElementChild).toHaveTextContent("Checkout API returns 502");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent("Labelsproduction");
    expect(within(lines[0]!).getByText("Labels")).toHaveClass("sr-only");
    expect(within(lines[1]!).getByText("Owners")).toHaveClass("sr-only");
    expect(lines[0]).toHaveClass(...TABLE_FOLDED_VALUE_CLASS_NAME.split(" "));
  });

  test("a value that does not say what it is shows its column's name before it", () => {
    render(
      <TableFoldedValues
        main={<span>Executed</span>}
        folded={[
          {
            title: "Acknowledged By",
            content: <span>Ada Lovelace</span>,
            isTitleShown: true,
          },
        ]}
      />,
    );

    const title: HTMLElement = screen.getByTestId(
      TABLE_FOLDED_VALUE_TITLE_TEST_ID,
    );

    expect(title).toHaveTextContent("Acknowledged By");
    expect(title).not.toHaveClass("sr-only");
  });

  test("a line's value is a box the table may cut short as one; a date's cell is not", () => {
    const { rerender } = render(
      <TableFoldedValues
        main={<span>Checkout API</span>}
        folded={[{ title: "Owners", content: <span>Ada</span> }]}
      />,
    );

    const box: HTMLElement = screen.getByTestId(TABLE_FOLDED_VALUES_TEST_ID);

    expect(box).toHaveAttribute(TABLE_SHRINKABLE_ATTRIBUTE, "true");
    expect(box).toHaveClass("grid", "grid-cols-1");
    // Every part of it ends in "..." of its own.
    for (const part of Array.from(box.children)) {
      expect(part).toHaveAttribute(TABLE_SHRINKABLE_ATTRIBUTE, "true");
    }
    expect(box.firstElementChild).toHaveClass(
      ...TABLE_FOLDED_MAIN_CLASS_NAMES[TableFoldedMainLayout.Line].split(" "),
    );

    rerender(
      <TableFoldedValues
        main={<span>Oct 22, 7:25 AM</span>}
        mainLayout={TableFoldedMainLayout.Whole}
        folded={[{ title: "Duration", content: <span>10 days</span> }]}
      />,
    );

    const dateBox: HTMLElement = screen.getByTestId(
      TABLE_FOLDED_VALUES_TEST_ID,
    );

    expect(dateBox).not.toHaveAttribute(TABLE_SHRINKABLE_ATTRIBUTE);
    expect(dateBox.firstElementChild).toHaveClass("whitespace-nowrap");
    expect(dateBox.firstElementChild).not.toHaveClass("text-ellipsis");
  });

  test("a column of prose keeps wrapping above what is folded under it", () => {
    render(
      <TableFoldedValues
        main={<span>Investigate every new incident on the checkout path</span>}
        mainLayout={TableFoldedMainLayout.Wrap}
        folded={[{ title: "Status", content: <span>Enabled</span> }]}
      />,
    );

    const main: Element = screen.getByTestId(TABLE_FOLDED_VALUES_TEST_ID)
      .firstElementChild as Element;

    expect(main).toHaveClass("whitespace-normal", "break-words");
    expect(main).not.toHaveClass("whitespace-nowrap");
  });
});

interface Row extends GenericObject {
  title?: string | undefined;
  state?: string | undefined;
  severity?: string | undefined;
  labels?: string | undefined;
}

const TITLE: Column<Row> = {
  key: "title",
  title: "Title",
  type: FieldType.Text,
};
const STATE: Column<Row> = {
  id: "state-column",
  key: "state",
  title: "State",
  type: FieldType.Text,
};
const SEVERITY: Column<Row> = {
  key: "severity",
  title: "Severity",
  type: FieldType.Text,
  hideBelowLargeScreen: true,
  foldInto: "state-column",
};
const LABELS: Column<Row> = {
  key: "labels",
  title: "Labels",
  type: FieldType.Text,
  hideBelowLargeScreen: true,
  foldInto: "title",
};
const PAGE_FOLDED: Column<Row> = {
  key: "state",
  title: "Count",
  type: FieldType.Text,
  hideBelowLargeScreen: true,
};
const ACTIONS: Column<Row> = { title: "Actions", type: FieldType.Actions };

const COLUMNS: Columns<Row> = [
  TITLE,
  STATE,
  SEVERITY,
  LABELS,
  PAGE_FOLDED,
  ACTIONS,
];

describe("which columns a table draws, and where a folded one goes", () => {
  test("unfolded: every column, the same array, nothing folded", () => {
    const drawn: ReturnType<typeof getDrawnTableColumns<Row>> =
      getDrawnTableColumns<Row>(COLUMNS, false);

    expect(drawn.columns).toBe(COLUMNS);
    expect(drawn.areColumnsFolded).toBe(false);
    expect(drawn.foldedColumns).toEqual([]);
  });

  test("folded: the foldable columns are left out, and those the table shows itself are listed", () => {
    const drawn: ReturnType<typeof getDrawnTableColumns<Row>> =
      getDrawnTableColumns<Row>(COLUMNS, true);

    expect(drawn.columns).toEqual([TITLE, STATE, ACTIONS]);
    expect(drawn.areColumnsFolded).toBe(true);
    // The page's own fold (no foldInto) is the page's to show.
    expect(drawn.foldedColumns).toEqual([SEVERITY, LABELS]);
  });

  test("as cards, a column the table folds is a field of the card again; one the page shows stays folded", () => {
    const drawn: ReturnType<typeof getDrawnTableColumns<Row>> =
      getDrawnTableColumns<Row>(COLUMNS, true, true);

    expect(drawn.columns).toEqual([TITLE, STATE, SEVERITY, LABELS, ACTIONS]);
    expect(drawn.areColumnsFolded).toBe(true);
    expect(drawn.foldedColumns).toEqual([]);
  });

  test("a folded column goes under the column it names, by id or by field", () => {
    const drawnColumns: Columns<Row> = [TITLE, STATE, ACTIONS];
    const foldedColumns: Columns<Row> = [SEVERITY, LABELS];

    expect(
      getColumnsFoldedInto<Row>({ column: STATE, drawnColumns, foldedColumns }),
    ).toEqual([SEVERITY]);
    expect(
      getColumnsFoldedInto<Row>({ column: TITLE, drawnColumns, foldedColumns }),
    ).toEqual([LABELS]);
    expect(
      getColumnsFoldedInto<Row>({
        column: ACTIONS,
        drawnColumns,
        foldedColumns,
      }),
    ).toEqual([]);
  });

  test("one whose column is not drawn goes under the row's first column, never lost", () => {
    const drawnColumns: Columns<Row> = [TITLE, ACTIONS];
    const foldedColumns: Columns<Row> = [SEVERITY, LABELS];

    expect(
      getColumnsFoldedInto<Row>({ column: TITLE, drawnColumns, foldedColumns }),
    ).toEqual([SEVERITY, LABELS]);
  });

  test("the row's buttons never hold a folded value", () => {
    const drawnColumns: Columns<Row> = [ACTIONS];

    expect(
      getColumnsFoldedInto<Row>({
        column: ACTIONS,
        drawnColumns,
        foldedColumns: [SEVERITY],
      }),
    ).toEqual([]);
  });
});
