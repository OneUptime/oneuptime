import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "../../../../../UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "../../../../../UI/Components/Table/ColumnResize/ResizableHeaderCell";
import {
  COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  ColumnWidthKind,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { COLUMN_RESIZE_HANDLE_TEST_ID } from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import { RESET_COLUMN_WIDTHS_TEST_ID } from "../../../../../UI/Components/Table/ColumnResize/ResetColumnWidthsButton";
import { SIZED_COLUMNS_STYLE_ATTRIBUTE } from "../../../../../UI/Components/Table/ColumnResize/SizedColumnsStyle";
import Card from "../../../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../../../UI/Components/MoreMenu/MoreMenuItem";
import User from "../../../../../UI/Utils/User";
import ObjectID from "../../../../../Types/ObjectID";
import IconProp from "../../../../../Types/Icon/IconProp";
import { UserPreferenceType } from "../../../../../Utils/UserPreferences";

/*
 * A table a page draws itself - a monitor's DNS records, a host's
 * filesystems, a dashboard widget's rows, the admin's query console - lets
 * a person size its columns as the shared Table does
 * (useResizableColumns, ResizableHeaderCell): an edge on each column it
 * names, none on a cell it does not (a row number); a width kept drawn on
 * the header cell, its values using it (one rule a column, counted past
 * the cells before it), remembered per person and per table; the table as
 * wide as its columns once every one is sized; and Reset column widths in
 * the card's ⋯ - or, with no ⋯, beside the last column's name. Keeping a
 * width never draws the table's rows again.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000bb";

interface Record {
  name: string;
  type: string;
  ttl: number;
}

const RECORDS: Array<Record> = [
  { name: "api.example.com", type: "A", ttl: 300 },
  { name: "www.example.com", type: "CNAME", ttl: 3600 },
];

let rowRenders: number = 0;

const Row: FunctionComponent<{ record: Record; position: number }> = (props: {
  record: Record;
  position: number;
}): ReactElement => {
  rowRenders++;

  return (
    <tr>
      <td>{props.position}</td>
      <td>{props.record.name}</td>
      <td>{props.record.type}</td>
      <td>{props.record.ttl}</td>
    </tr>
  );
};

/*
 * A record table as a page draws it: a row number first (not a column a
 * person sizes), then the record's name, type and TTL.
 */
const RecordsTable: FunctionComponent<{ tableKey: string }> = (props: {
  tableKey: string;
}): ReactElement => {
  const recordColumns: ResizableColumns = useResizableColumns({
    tableKey: props.tableKey,
    columns: [
      { id: "name", cellNumber: 2 },
      { id: "type", cellNumber: 3 },
      { id: "ttl", cellNumber: 4 },
    ],
  });

  return (
    <div>
      {recordColumns.styles}
      <table
        className={`${recordColumns.getTableWidthClassName("min-w-full")} text-sm`}
        {...recordColumns.tableAttributes}
        data-testid={`table-${props.tableKey}`}
      >
        <thead>
          <tr>
            <ResizableHeaderCell className="w-12">#</ResizableHeaderCell>
            <ResizableHeaderCell
              className="px-4 py-2 text-left"
              resize={recordColumns.getResize(
                "name",
                "Name",
                ColumnWidthKind.Name,
              )}
            >
              <span>Name</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="px-4 py-2 text-left"
              resize={recordColumns.getResize(
                "type",
                "Type",
                ColumnWidthKind.Whole,
              )}
            >
              <span>Type</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              className="px-4 py-2 text-right"
              resize={recordColumns.getResize(
                "ttl",
                "TTL",
                ColumnWidthKind.Whole,
              )}
            >
              <span>TTL</span>
            </ResizableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {RECORDS.map((record: Record, index: number): ReactElement => {
            return (
              <Row key={record.name} record={record} position={index + 1} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/*
 * The same table with two columns. Its rows are drawn by the component that
 * sizes its columns, as a page's are, so they count how often it draws.
 */
const RecordsTableOfTwoColumns: FunctionComponent<{
  tableKey: string;
}> = (props: { tableKey: string }): ReactElement => {
  const recordColumns: ResizableColumns = useResizableColumns({
    tableKey: props.tableKey,
    columns: [
      { id: "name", cellNumber: 2 },
      { id: "type", cellNumber: 3 },
    ],
  });

  return (
    <div>
      {recordColumns.styles}
      <table {...recordColumns.tableAttributes}>
        <thead>
          <tr>
            <ResizableHeaderCell>#</ResizableHeaderCell>
            <ResizableHeaderCell
              resize={recordColumns.getResize("name", "Name")}
            >
              <span>Name</span>
            </ResizableHeaderCell>
            <ResizableHeaderCell
              resize={recordColumns.getResize("type", "Type")}
            >
              <span>Type</span>
            </ResizableHeaderCell>
          </tr>
        </thead>
        <tbody>
          {RECORDS.map((record: Record, index: number): ReactElement => {
            return (
              <Row key={record.name} record={record} position={index + 1} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const storageKey: (tableKey: string) => string = (tableKey: string): string => {
  return `${UserPreferenceType.TableColumnWidths}.${PERSON}.${tableKey}`;
};

const keep: (tableKey: string, widths: { [id: string]: number }) => void = (
  tableKey: string,
  widths: { [id: string]: number },
): void => {
  window.localStorage.setItem(storageKey(tableKey), JSON.stringify(widths));
};

const stored: (tableKey: string) => { [id: string]: number } | null = (
  tableKey: string,
): { [id: string]: number } | null => {
  const value: string | null = window.localStorage.getItem(
    storageKey(tableKey),
  );

  return value ? (JSON.parse(value) as { [id: string]: number }) : null;
};

const headerCellOf: (
  title: string,
  container?: HTMLElement | Document,
) => HTMLTableCellElement = (
  title: string,
  container?: HTMLElement | Document,
): HTMLTableCellElement => {
  const cell: Element | undefined = Array.from(
    (container || document).querySelectorAll("thead th"),
  ).find((th: Element): boolean => {
    return th.getAttribute("aria-label") === title || th.textContent === title;
  });

  if (!cell) {
    throw new Error(`No header cell named ${title}`);
  }

  return cell as HTMLTableCellElement;
};

const edgeOf: (columnId: string) => HTMLElement = (
  columnId: string,
): HTMLElement => {
  return document.querySelector(
    `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"][data-column-id="${columnId}"]`,
  ) as HTMLElement;
};

const pressOnEdge: (columnId: string, key: string) => void = (
  columnId: string,
  key: string,
): void => {
  const edge: HTMLElement = edgeOf(columnId);

  act(() => {
    fireEvent.keyDown(edge, { key: key });
  });
  act(() => {
    fireEvent.keyUp(edge, { key: key });
  });
};

beforeEach(() => {
  rowRenders = 0;
  window.localStorage.clear();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("the edges a page's own table draws", () => {
  test("one on each column it names, none on a cell it does not", () => {
    render(<RecordsTable tableKey="dns-records" />);

    expect(
      Array.from(
        document.querySelectorAll(
          `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"]`,
        ),
      ).map((edge: Element): string | null => {
        return edge.getAttribute("data-column-id");
      }),
    ).toEqual(["name", "type", "ttl"]);

    const rowNumberHeader: Element = document.querySelectorAll("thead th")[0]!;

    expect(
      rowNumberHeader.querySelector("[data-column-resize-handle]"),
    ).toBeNull();
    expect(rowNumberHeader).not.toHaveAttribute("aria-label");
  });

  test("each named after its column; the column named by its title alone, and relative", () => {
    render(<RecordsTable tableKey="dns-records" />);

    expect(
      screen.getByRole("separator", { name: "Resize the Name column" }),
    ).toBe(edgeOf("name"));
    expect(headerCellOf("Name")).toHaveAttribute("aria-label", "Name");
    expect(headerCellOf("Name").className.split(" ")).toContain("relative");
    // The page's own classes stay.
    expect(headerCellOf("TTL").className.split(" ")).toContain("text-right");
  });

  test("the table carries the scope its sized columns' rules are written for", () => {
    render(<RecordsTable tableKey="dns-records" />);

    const table: HTMLElement = screen.getByTestId("table-dns-records");

    expect(table.getAttribute(COLUMN_WIDTHS_SCOPE_ATTRIBUTE)).toBeTruthy();
  });
});

describe("a width kept for a column of a page's own table", () => {
  test("is drawn on its header cell and remembered, per person and per table", () => {
    render(<RecordsTable tableKey="dns-records" />);

    pressOnEdge("name", "ArrowRight");

    const width: string = headerCellOf("Name").style.width;

    expect(width).toMatch(/^\d+px$/);
    expect(headerCellOf("Name").style.maxWidth).toBe(width);
    expect(stored("dns-records")).toEqual({ name: parseInt(width, 10) });
  });

  test("a column of values kept whole has no most width: a wider value grows it", () => {
    keep("dns-records", { type: 90 });

    render(<RecordsTable tableKey="dns-records" />);

    expect(headerCellOf("Type").style.width).toBe("90px");
    expect(headerCellOf("Type").style.minWidth).toBe("90px");
    expect(headerCellOf("Type").style.maxWidth).toBe("");
  });

  test("is read back on the next visit; another table keeps its own", () => {
    keep("dns-records", { name: 320 });

    render(
      <>
        <RecordsTable tableKey="dns-records" />
        <RecordsTable tableKey="snmp-values" />
      </>,
    );

    const first: HTMLElement = screen.getByTestId("table-dns-records");
    const second: HTMLElement = screen.getByTestId("table-snmp-values");

    expect(headerCellOf("Name", first).style.width).toBe("320px");
    expect(headerCellOf("Name", second).style.width).toBe("");
  });

  test("its values use its width: one rule for its place in the row, counted past the row number", () => {
    keep("dns-records", { name: 320 });

    render(<RecordsTable tableKey="dns-records" />);

    const rules: string = Array.from(
      document.querySelectorAll(`style[${SIZED_COLUMNS_STYLE_ATTRIBUTE}]`),
    )
      .map((style: Element): string => {
        return style.textContent || "";
      })
      .join("\n");

    expect(rules).toContain("td:nth-child(2)");
    expect(rules).not.toContain("td:nth-child(1)");
    expect(rules).not.toContain("td:nth-child(3)");
  });

  test("a column of words asks the table for no width of its own; a column kept whole keeps its values' width, as each header cell names its kind", () => {
    keep("dns-records", { name: 320, ttl: 90 });

    render(<RecordsTable tableKey="dns-records" />);

    const rules: string = Array.from(
      document.querySelectorAll(`style[${SIZED_COLUMNS_STYLE_ATTRIBUTE}]`),
    )
      .map((style: Element): string => {
        return style.textContent || "";
      })
      .join("\n");

    // Name (a row's name) is the second cell, TTL (a number) the fourth.
    expect(rules).toContain(
      "td:nth-child(2) > div { max-width: none; min-width: 0; contain: inline-size; }",
    );
    expect(rules).toContain(
      "td:nth-child(4) > div { max-width: none; min-width: 0; }",
    );
  });

  test("Delete on a focused edge gives the column back to the table", () => {
    keep("dns-records", { name: 320 });

    render(<RecordsTable tableKey="dns-records" />);

    pressOnEdge("name", "Delete");

    expect(headerCellOf("Name").style.width).toBe("");
    expect(stored("dns-records")).toBeNull();
  });

  test("the table fills its box until every column is sized, then is as wide as its columns", () => {
    keep("dns-records", { name: 320, type: 90 });

    render(<RecordsTable tableKey="dns-records" />);

    const table: HTMLElement = screen.getByTestId("table-dns-records");

    expect(table.className.split(" ")).toContain("min-w-full");

    pressOnEdge("ttl", "ArrowRight");

    expect(table.className.split(" ")).toContain("w-max");
    expect(table.className.split(" ")).not.toContain("min-w-full");
  });

  test("a width kept for a column already sized never draws the table's rows again", () => {
    keep("dns-records", { name: 320 });

    render(<RecordsTableOfTwoColumns tableKey="dns-records" />);

    const rendersBefore: number = rowRenders;

    pressOnEdge("name", "ArrowRight");
    pressOnEdge("name", "ArrowRight");
    pressOnEdge("name", "ArrowLeft");

    // 320 + 16 + 16 - 16: the header cell has it, the rows were not drawn.
    expect(headerCellOf("Name").style.width).toBe("336px");
    expect(stored("dns-records")).toEqual({ name: 336 });
    expect(rowRenders).toBe(rendersBefore);
  });
});

describe("Reset column widths for a page's own table", () => {
  const cardWithMenu: (table: ReactElement) => ReactElement = (
    table: ReactElement,
  ): ReactElement => {
    return (
      <Card
        title="DNS records"
        buttons={[
          <CardMoreMenu key="more">
            {[
              <MoreMenuItem
                key="refresh"
                text="Refresh"
                icon={IconProp.Refresh}
                onClick={() => {}}
              />,
            ]}
          </CardMoreMenu>,
        ]}
      >
        {table}
      </Card>
    );
  };

  const openMenu: () => HTMLElement = (): HTMLElement => {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
    });

    return screen.getByRole("menu");
  };

  test("is in the card's ⋯ while a column is sized, and gives every column back", () => {
    keep("dns-records", { name: 320, ttl: 100 });

    render(cardWithMenu(<RecordsTable tableKey="dns-records" />));

    // Not beside the last column's name as well.
    expect(
      document.querySelector(
        `thead [data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).toBeNull();

    const menu: HTMLElement = openMenu();

    act(() => {
      fireEvent.click(within(menu).getByText("Reset column widths"));
    });

    expect(headerCellOf("Name").style.width).toBe("");
    expect(headerCellOf("TTL").style.width).toBe("");
    expect(stored("dns-records")).toBeNull();
  });

  test("with no ⋯ to keep it in, it is beside the last column's name, only while a column is sized", () => {
    render(
      <Card title="DNS records">
        <RecordsTable tableKey="dns-records" />
      </Card>,
    );

    expect(
      document.querySelector(`[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`),
    ).toBeNull();

    pressOnEdge("name", "ArrowRight");

    const lastHeader: HTMLTableCellElement = headerCellOf("TTL");
    const reset: HTMLElement = within(lastHeader).getByRole("button", {
      name: "Reset column widths",
    });

    // The column is still named by its title alone, and keeps its name.
    expect(lastHeader).toHaveAttribute("aria-label", "TTL");
    expect(within(lastHeader).getByText("TTL")).toBeInTheDocument();
    expect(
      document.querySelectorAll(
        `[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).toHaveLength(1);

    act(() => {
      fireEvent.click(reset);
    });

    expect(headerCellOf("Name").style.width).toBe("");
    expect(stored("dns-records")).toBeNull();
    expect(
      document.querySelector(`[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`),
    ).toBeNull();
  });

  test("a table drawn in no card keeps it beside the last column's name too", () => {
    keep("dns-records", { type: 90 });

    render(<RecordsTable tableKey="dns-records" />);

    expect(
      within(headerCellOf("TTL")).getByRole("button", {
        name: "Reset column widths",
      }),
    ).toBeInTheDocument();
  });
});
