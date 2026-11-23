import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  TABLE_ROW_LIT_CLASS_NAME,
  TABLE_ROW_NOTE_TEST_ID,
  TABLE_ROW_RULE_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import TableBody from "../../../../UI/Components/Table/TableBody";
import TableRow from "../../../../UI/Components/Table/TableRow";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * A LINE ABOUT A ROW ACROSS ITS WHOLE WIDTH (Table's getRowNote, #10372,
 * #6105): a sentence a column is too narrow to hold - OneUptime AI's
 * verdict on a finding, a suggestion's reason - drawn as its own <tr> under
 * the row's cells, spanning every cell the row draws, with the row's
 * hairline moved under it; in a phone's card, above the card's buttons.
 * Both of a row's <tr>s are lit together under the pointer, and a row
 * with nothing to say draws no line at all.
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

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  location?: string | undefined;
}

const COLUMNS: Columns<Row> = [
  { key: "name", title: "Data Type", type: FieldType.Text },
  { key: "location", title: "Location", type: FieldType.Text },
  { key: "_id", title: "Actions", type: FieldType.Actions },
];

const NOTE: string = "Your team marked order_number not sensitive on 4 stores.";

function note(): React.ReactElement {
  return <span>{NOTE}</span>;
}

afterEach(() => {
  cleanup();
});

function renderRows(data: {
  rows: Array<Row>;
  getRowNote?: ((row: Row) => React.ReactElement | null) | undefined;
  isMobile?: boolean | undefined;
}): HTMLElement {
  const { container } = render(
    data.isMobile ? (
      <TableBody<Row>
        id="findings"
        data={data.rows}
        columns={COLUMNS}
        selectedItems={[]}
        matchBulkSelectedItemByField="_id"
        getRowNote={data.getRowNote}
        isMobile={true}
        actionButtons={[
          {
            title: "Confirm",
            onClick: (): void => {
              return undefined;
            },
          },
        ]}
      />
    ) : (
      <table>
        <TableBody<Row>
          id="findings"
          data={data.rows}
          columns={COLUMNS}
          selectedItems={[]}
          matchBulkSelectedItemByField="_id"
          getRowNote={data.getRowNote}
          isMobile={false}
        />
      </table>
    ),
  );

  return container;
}

describe("a row's note on a wide screen", () => {
  test("is a <tr> of its own under the row, spanning every cell it draws", () => {
    const container: HTMLElement = renderRows({
      rows: [
        { _id: "1", name: "Card number", location: "orders.order_number" },
        { _id: "2", name: "Email address", location: "users.email" },
      ],
      getRowNote: note,
    });
    const rows: Array<HTMLTableRowElement> = Array.from(
      container.querySelectorAll("tbody tr"),
    );

    expect(rows).toHaveLength(4);

    const cell: HTMLElement = screen.getAllByTestId(TABLE_ROW_NOTE_TEST_ID)[0]!;

    expect(cell.tagName).toBe("TD");
    expect(cell).toHaveAttribute("colspan", String(COLUMNS.length));
    expect(cell).toHaveTextContent(NOTE);
    // Right under its own row.
    expect(rows[0]!).toHaveTextContent("orders.order_number");
    expect(rows[1]!).toContainElement(cell);
  });

  test("takes the row's hairline: none between the row and its note, one under the note", () => {
    const container: HTMLElement = renderRows({
      rows: [
        { _id: "1", name: "Card number", location: "orders.order_number" },
        { _id: "2", name: "Email address", location: "users.email" },
      ],
      getRowNote: (row: Row): React.ReactElement | null => {
        return row._id === "1" ? note() : null;
      },
    });
    const rows: Array<HTMLTableRowElement> = Array.from(
      container.querySelectorAll("tbody tr"),
    );
    const firstRule: string = TABLE_ROW_RULE_CLASS_NAME.split(" ")[0]!;

    for (const cell of Array.from(rows[0]!.querySelectorAll("td"))) {
      expect(cell.className).not.toContain(firstRule);
    }

    expect(rows[1]!.querySelector("td")!.className).toContain(firstRule);
    // The last row draws no hairline of its own, and has no note.
    expect(rows).toHaveLength(3);
    expect(rows[2]!.querySelector("td")!.className).not.toContain(firstRule);
  });

  test("starts where the row's first value does: nothing under its select box", () => {
    const { container } = render(
      <table>
        <TableBody<Row>
          id="findings"
          data={[{ _id: "1", name: "Card number", location: "a.b" }]}
          columns={COLUMNS}
          selectedItems={[]}
          matchBulkSelectedItemByField="_id"
          isBulkActionsEnabled={true}
          getRowNote={note}
          isMobile={false}
        />
      </table>,
    );
    const [row, noteRow] = Array.from(
      container.querySelectorAll("tbody tr"),
    ) as Array<HTMLTableRowElement>;
    const cells: Array<HTMLTableCellElement> = Array.from(
      noteRow!.querySelectorAll("td"),
    );

    // The row draws its select box, then its columns.
    expect(row!.querySelectorAll("td")).toHaveLength(COLUMNS.length + 1);
    expect(cells).toHaveLength(2);
    expect(cells[0]!).toBeEmptyDOMElement();
    expect(cells[0]!).toHaveAttribute("colspan", "1");
    expect(cells[1]!).toHaveAttribute("data-testid", TABLE_ROW_NOTE_TEST_ID);
    expect(cells[1]!).toHaveAttribute("colspan", String(COLUMNS.length));
  });

  test("a row with nothing to say draws no line at all", () => {
    const container: HTMLElement = renderRows({
      rows: [{ _id: "1", name: "Card number", location: "a.b" }],
      getRowNote: (): null => {
        return null;
      },
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.queryByTestId(TABLE_ROW_NOTE_TEST_ID)).toBeNull();
  });

  test("a table that says nothing of notes is drawn as it always was", () => {
    const container: HTMLElement = renderRows({
      rows: [{ _id: "1", name: "Card number", location: "a.b" }],
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  test("the row and its note are lit together under the pointer", () => {
    const container: HTMLElement = renderRows({
      rows: [{ _id: "1", name: "Card number", location: "a.b" }],
      getRowNote: note,
    });
    const [row, noteRow] = Array.from(
      container.querySelectorAll("tbody tr"),
    ) as Array<HTMLTableRowElement>;

    expect(row!.classList.contains(TABLE_ROW_LIT_CLASS_NAME)).toBe(false);

    fireEvent.mouseEnter(noteRow!);
    expect(row!.classList.contains(TABLE_ROW_LIT_CLASS_NAME)).toBe(true);
    expect(noteRow!.classList.contains(TABLE_ROW_LIT_CLASS_NAME)).toBe(true);

    fireEvent.mouseLeave(noteRow!);
    expect(row!.classList.contains(TABLE_ROW_LIT_CLASS_NAME)).toBe(false);

    fireEvent.mouseEnter(row!);
    expect(noteRow!.classList.contains(TABLE_ROW_LIT_CLASS_NAME)).toBe(true);
  });
});

describe("a row's note in a phone's card", () => {
  test("sits in the card, above its buttons", () => {
    renderRows({
      rows: [
        { _id: "1", name: "Card number", location: "orders.order_number" },
      ],
      getRowNote: note,
      isMobile: true,
    });

    const noted: HTMLElement = screen.getByTestId(TABLE_ROW_NOTE_TEST_ID);
    const button: HTMLElement = screen.getByRole("button", { name: "Confirm" });

    expect(noted).toHaveTextContent(NOTE);
    // Before the buttons in the card's reading order.
    expect(
      noted.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("ends a card that has no buttons", () => {
    render(
      <TableRow<Row>
        item={{ _id: "1", name: "Card number", location: "a.b" }}
        columns={COLUMNS.slice(0, 2)}
        rowNote={note()}
        isMobile={true}
      />,
    );

    const card: HTMLElement = screen
      .getByText("Card number")
      .closest("div[class]")!.parentElement!.parentElement!;

    expect(within(card).getByTestId(TABLE_ROW_NOTE_TEST_ID)).toHaveTextContent(
      NOTE,
    );
  });
});
