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
import React, { ReactElement } from "react";
import Table, {
  ComponentProps as TableProps,
} from "../../../../../UI/Components/Table/Table";
import Card from "../../../../../UI/Components/Card/Card";
import CardMoreMenu from "../../../../../UI/Components/Card/CardMoreMenu";
import MoreMenuItem from "../../../../../UI/Components/MoreMenu/MoreMenuItem";
import Modal from "../../../../../UI/Components/Modal/Modal";
import Column from "../../../../../UI/Components/Table/Types/Column";
import Columns from "../../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../../UI/Components/Types/FieldType";
import {
  COLUMN_RESIZE_HANDLE_TEST_ID,
} from "../../../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import { RESET_COLUMN_WIDTHS_TEST_ID } from "../../../../../UI/Components/Table/ColumnResize/ResetColumnWidthsButton";
import { COLUMN_WIDTHS_SCOPE_ATTRIBUTE } from "../../../../../UI/Components/Table/ColumnResize/ColumnWidths";
import { SIZED_COLUMNS_STYLE_ATTRIBUTE } from "../../../../../UI/Components/Table/ColumnResize/SizedColumnsStyle";
import { COLUMN_MEASURE_SKIP_ATTRIBUTE } from "../../../../../UI/Components/Table/ColumnResize/ColumnWidthMeasure";
import { TABLE_END_FILLER_TEST_ID } from "../../../../../UI/Components/Table/TableLayout";
import User from "../../../../../UI/Utils/User";
import ObjectID from "../../../../../Types/ObjectID";
import IconProp from "../../../../../Types/Icon/IconProp";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../../../Types/GenericObject";
import { UserPreferenceType } from "../../../../../Utils/UserPreferences";
import { ButtonStyleType } from "../../../../../UI/Components/Button/Button";

/*
 * Every shared Table - every ModelTable, every LocalTable, every table a
 * page draws on Table - lets a person size its columns: an edge on each
 * column's header cell but the select box's, the drag grip's and the
 * row's actions; a width kept is drawn on the header cell and remembered
 * per person and per table; the room sized columns leave is the row's end
 * (a filler cell when there is no Actions column); and "Reset column
 * widths" is where the table keeps its other options - its card's ⋯, or
 * the header row's end when there is no ⋯. Keeping a width never draws the
 * table's rows again. A phone draws no header row: nothing to size there.
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

const PERSON: string = "8a3b0c3e-0000-4000-8000-0000000000aa";

interface Row extends GenericObject {
  _id: string;
  name: string;
  status: string;
  createdAt: string;
}

const ROWS: Array<Row> = [
  {
    _id: "10000000-0000-4000-8000-000000000001",
    name: "Checkout API",
    status: "Operational",
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  {
    _id: "10000000-0000-4000-8000-000000000002",
    name: "Marketing Website",
    status: "Degraded",
    createdAt: "2026-09-02T10:00:00.000Z",
  },
];

let statusRenders: number = 0;

const columns: (data?: {
  withActions?: boolean | undefined;
  extra?: Partial<Column<Row>> | undefined;
  folded?: boolean | undefined;
}) => Columns<Row> = (data?: {
  withActions?: boolean | undefined;
  extra?: Partial<Column<Row>> | undefined;
  folded?: boolean | undefined;
}): Columns<Row> => {
  const list: Columns<Row> = [
    { title: "Name", type: FieldType.Text, key: "name", id: "name" },
    {
      title: "Status",
      type: FieldType.Element,
      key: "status",
      id: "status",
      getElement: (row: Row): ReactElement => {
        statusRenders++;
        return <span>{row.status}</span>;
      },
      ...(data?.extra || {}),
    },
    {
      title: "Created",
      type: FieldType.Date,
      key: "createdAt",
      id: "createdAt",
      hideBelowLargeScreen: Boolean(data?.folded),
    },
  ];

  if (data?.withActions) {
    list.push({ title: "Actions", type: FieldType.Actions });
  }

  return list;
};

const tableProps: (overrides?: Partial<TableProps<Row>>) => TableProps<Row> = (
  overrides?: Partial<TableProps<Row>>,
): TableProps<Row> => {
  return {
    id: "services-table",
    data: ROWS,
    columns: columns({ withActions: true }),
    onNavigateToPage: () => {},
    currentPageNumber: 1,
    totalItemsCount: ROWS.length,
    itemsOnPage: 10,
    error: "",
    isLoading: false,
    singularLabel: "Service",
    pluralLabel: "Services",
    sortOrder: SortOrder.Ascending,
    sortBy: null,
    onSortChanged: () => {},
    actionButtons: [
      {
        title: "View",
        buttonStyleType: ButtonStyleType.NORMAL,
        onClick: () => {},
      },
    ],
    ...(overrides || {}),
  };
};

const storageKey: (tableKey: string) => string = (tableKey: string): string => {
  return `${UserPreferenceType.TableColumnWidths}.${PERSON}.${tableKey}`;
};

const keep: (tableKey: string, widths: Record<string, number>) => void = (
  tableKey: string,
  widths: Record<string, number>,
): void => {
  window.localStorage.setItem(storageKey(tableKey), JSON.stringify(widths));
};

const stored: (tableKey: string) => Record<string, number> | null = (
  tableKey: string,
): Record<string, number> | null => {
  const value: string | null = window.localStorage.getItem(storageKey(tableKey));

  return value ? (JSON.parse(value) as Record<string, number>) : null;
};

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const headerCellOf: (title: string) => HTMLTableCellElement = (
  title: string,
): HTMLTableCellElement => {
  const cell: Element | undefined = Array.from(
    document.querySelectorAll("thead th"),
  ).find((th: Element): boolean => {
    return th.getAttribute("aria-label") === title || th.textContent === title;
  });

  if (!cell) {
    throw new Error(`No header cell named ${title}`);
  }

  return cell as HTMLTableCellElement;
};

const edges: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll(`[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"]`),
  ) as Array<HTMLElement>;
};

const edgeOf: (columnId: string) => HTMLElement = (
  columnId: string,
): HTMLElement => {
  return document.querySelector(
    `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"][data-column-id="${columnId}"]`,
  ) as HTMLElement;
};

// A width kept with the keyboard: one press of the right arrow, let go.
const widenByKeyboard: (columnId: string) => void = (columnId: string): void => {
  const edge: HTMLElement = edgeOf(columnId);

  act(() => {
    fireEvent.keyDown(edge, { key: "ArrowRight" });
  });
  act(() => {
    fireEvent.keyUp(edge, { key: "ArrowRight" });
  });
};

beforeEach(() => {
  statusRenders = 0;
  window.localStorage.clear();
  setWindowWidth(1280);
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  setWindowWidth(1024);
});

describe("the edges a table's header draws", () => {
  test("one on every column but the select box's, the drag grip's and the row's actions", () => {
    render(
      <Table<Row>
        {...tableProps({
          bulkActions: {
            buttons: [
              {
                title: "Delete",
                buttonStyleType: ButtonStyleType.DANGER,
                icon: IconProp.Trash,
                onClick: async () => {},
              },
            ],
          },
          matchBulkSelectedItemByField: "_id",
          enableDragAndDrop: true,
          dragDropIdField: "_id",
        })}
      />,
    );

    expect(
      edges().map((edge: HTMLElement): string | null => {
        return edge.getAttribute("data-column-id");
      }),
    ).toEqual(["name", "status", "createdAt"]);

    const headerCells: Array<Element> = Array.from(
      document.querySelectorAll("thead th"),
    );

    // The grip's, the box's and the Actions' cells carry none.
    expect(headerCells[0]!.querySelector("[data-column-resize-handle]")).toBeNull();
    expect(headerCells[1]!.querySelector("[data-column-resize-handle]")).toBeNull();
    expect(
      headerCells[headerCells.length - 1]!.querySelector(
        "[data-column-resize-handle]",
      ),
    ).toBeNull();
  });

  test("each named after its column, the column named by its title alone", () => {
    render(<Table<Row> {...tableProps()} />);

    expect(edgeOf("status")).toHaveAttribute(
      "aria-label",
      "Resize the Status column",
    );

    // The column's header is "Status", not "Status Resize the Status column".
    expect(headerCellOf("Status")).toHaveAttribute("aria-label", "Status");
  });

  test("a header cell that carries an edge is relative, so the edge sits on it", () => {
    render(<Table<Row> {...tableProps()} />);

    expect(headerCellOf("Name").className.split(" ")).toContain("relative");
  });

  test("a column whose width a page depends on has no edge", () => {
    render(
      <Table<Row>
        {...tableProps({
          columns: columns({
            withActions: true,
            extra: { disableResize: true },
          }),
        })}
      />,
    );

    expect(edgeOf("status")).toBeNull();
    expect(edgeOf("name")).not.toBeNull();
  });

  test("a table whose layout a page depends on has none at all, and draws no kept width", () => {
    keep("services-table", { name: 300 });

    render(<Table<Row> {...tableProps({ disableColumnResize: true })} />);

    expect(edges()).toEqual([]);
    expect(headerCellOf("Name").style.width).toBe("");
    expect(
      document.querySelector(`style[${SIZED_COLUMNS_STYLE_ATTRIBUTE}]`),
    ).toBeNull();
  });

  test("a phone draws its rows as cards, with no header row and nothing to size", () => {
    keep("services-table", { name: 300 });
    setWindowWidth(390);

    render(<Table<Row> {...tableProps()} />);

    expect(edges()).toEqual([]);
    expect(document.querySelector("thead")).toBeNull();
    // The width is the person's still, for a wider screen.
    expect(stored("services-table")).toEqual({ name: 300 });
  });

  test("a column left out below a large screen has no edge, and keeps its width for when it is back", () => {
    keep("services-table", { createdAt: 260 });
    setWindowWidth(900);

    render(
      <Table<Row>
        {...tableProps({ columns: columns({ withActions: true, folded: true }) })}
      />,
    );

    expect(edgeOf("createdAt")).toBeNull();

    widenByKeyboard("name");

    expect(stored("services-table")).toEqual(
      expect.objectContaining({ createdAt: 260 }),
    );
  });
});

describe("a width kept for a column", () => {
  test("is drawn on its header cell: as wide as that, no narrower, no wider", () => {
    keep("services-table", { name: 320 });

    render(<Table<Row> {...tableProps()} />);

    const name: HTMLTableCellElement = headerCellOf("Name");

    expect([name.style.width, name.style.minWidth, name.style.maxWidth]).toEqual(
      ["320px", "320px", "320px"],
    );
    expect(headerCellOf("Status").style.width).toBe("");
  });

  test("a column of dates kept narrower than a later date grows for it rather than cut it", () => {
    keep("services-table", { createdAt: 120 });

    render(<Table<Row> {...tableProps()} />);

    const created: HTMLTableCellElement = headerCellOf("Created");

    expect([
      created.style.width,
      created.style.minWidth,
      created.style.maxWidth,
    ]).toEqual(["120px", "120px", ""]);
  });

  test("its values may use its width: one rule a column, counted past the select box", () => {
    keep("services-table", { status: 220 });

    render(
      <Table<Row>
        {...tableProps({
          bulkActions: {
            buttons: [
              {
                title: "Delete",
                buttonStyleType: ButtonStyleType.DANGER,
                icon: IconProp.Trash,
                onClick: async () => {},
              },
            ],
          },
          matchBulkSelectedItemByField: "_id",
        })}
      />,
    );

    const table: HTMLTableElement = document.querySelector(
      "table",
    ) as HTMLTableElement;
    const scope: string = table.getAttribute(COLUMN_WIDTHS_SCOPE_ATTRIBUTE) || "";
    const style: HTMLStyleElement = document.querySelector(
      `style[${SIZED_COLUMNS_STYLE_ATTRIBUTE}]`,
    ) as HTMLStyleElement;

    expect(scope).not.toBe("");
    // The box is the row's first cell, Name its second, Status its third.
    expect(style.textContent).toContain(
      `table[${COLUMN_WIDTHS_SCOPE_ATTRIBUTE}="${scope}"] > tbody > tr > td:nth-child(3) > div { max-width: none; min-width: 0; }`,
    );
    expect(style.textContent).toContain(
      `table[${COLUMN_WIDTHS_SCOPE_ATTRIBUTE}="${scope}"] > thead > tr > th:nth-child(3) * { white-space: normal; }`,
    );
    expect(style.textContent).not.toContain("nth-child(2)");
  });

  test("a width kept with the keyboard is drawn and remembered, per person and per table", () => {
    keep("services-table", { name: 200 });

    render(<Table<Row> {...tableProps()} />);
    widenByKeyboard("name");

    expect(headerCellOf("Name").style.width).toBe("216px");
    expect(stored("services-table")).toEqual({ name: 216 });
  });

  test("is remembered under the key the table is given, a ModelTable's userPreferencesKey", () => {
    keep("incidents-table", { name: 200 });

    render(
      <Table<Row> {...tableProps({ columnWidthsKey: "incidents-table" })} />,
    );
    widenByKeyboard("name");

    expect(stored("incidents-table")).toEqual({ name: 216 });
    expect(stored("services-table")).toBeNull();
  });

  test("never draws the table's rows again: one width on one header cell", () => {
    keep("services-table", { name: 200 });

    render(<Table<Row> {...tableProps()} />);

    const before: number = statusRenders;

    widenByKeyboard("name");
    widenByKeyboard("status");
    widenByKeyboard("name");

    expect(statusRenders).toBe(before);
    expect(headerCellOf("Name").style.width).toBe("232px");
  });

  test("a width kept for a column the table no longer has is never drawn", () => {
    keep("services-table", { removedColumn: 500 });

    render(<Table<Row> {...tableProps({ columns: columns() })} />);

    for (const title of ["Name", "Status", "Created"]) {
      expect(headerCellOf(title).style.width).toBe("");
    }

    expect(
      document.querySelector(`[data-testid="${TABLE_END_FILLER_TEST_ID}"]`),
    ).toBeNull();
    expect(
      document.querySelector(`[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`),
    ).toBeNull();
  });

  test("a column added since is drawn at the table's own width", () => {
    keep("services-table", { name: 300 });

    render(<Table<Row> {...tableProps()} />);

    expect(headerCellOf("Created").style.width).toBe("");
    expect(headerCellOf("Name").style.width).toBe("300px");
  });

  test("the placeholders of a first load are no rows a column is read by", () => {
    render(<Table<Row> {...tableProps({ data: [], isLoading: true })} />);

    expect(
      document.querySelector('[data-testid="table-skeleton-loader"]'),
    ).toHaveAttribute(COLUMN_MEASURE_SKIP_ATTRIBUTE, "true");
  });
});

describe("the room sized columns leave", () => {
  test("a table with no Actions column ends each row with a filler once a column is sized", () => {
    render(<Table<Row> {...tableProps({ columns: columns() })} />);

    expect(
      document.querySelectorAll(`[data-testid="${TABLE_END_FILLER_TEST_ID}"]`),
    ).toHaveLength(0);

    widenByKeyboard("name");

    // The header's, and each row's.
    expect(
      document.querySelectorAll(`[data-testid="${TABLE_END_FILLER_TEST_ID}"]`),
    ).toHaveLength(1 + ROWS.length);

    for (const row of Array.from(document.querySelectorAll("tbody tr"))) {
      const cells: Array<Element> = Array.from(row.children);

      expect(cells[cells.length - 1]).toHaveAttribute(
        "data-testid",
        TABLE_END_FILLER_TEST_ID,
      );
      expect(cells[cells.length - 1]).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("a table with an Actions column leaves the room to it: no filler", () => {
    keep("services-table", { name: 300 });

    render(<Table<Row> {...tableProps()} />);

    expect(
      document.querySelectorAll(`[data-testid="${TABLE_END_FILLER_TEST_ID}"]`),
    ).toHaveLength(0);
  });

  test("the first page's placeholders end with the filler too, so they line up under the header", () => {
    keep("services-table", { name: 300 });

    render(
      <Table<Row>
        {...tableProps({ columns: columns(), data: [], isLoading: true })}
      />,
    );

    const placeholderRow: Element = document.querySelector(
      '[data-testid="table-skeleton-loader"] tr',
    ) as Element;
    const headerRow: Element = document.querySelector("thead tr") as Element;

    expect(placeholderRow.children.length).toBe(headerRow.children.length);
  });
});

describe("Reset column widths", () => {
  const cardWithMenu: (table: ReactElement) => ReactElement = (
    table: ReactElement,
  ): ReactElement => {
    return (
      <Card
        title="Services"
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

  test("is in the card's ⋯, after its own options, only while a column is sized", () => {
    render(cardWithMenu(<Table<Row> {...tableProps()} />));

    expect(
      within(openMenu()).queryByText("Reset column widths"),
    ).not.toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document.activeElement || document.body, {
        key: "Escape",
      });
    });

    widenByKeyboard("name");

    const menu: HTMLElement = openMenu();
    const items: Array<string> = within(menu)
      .getAllByRole("menuitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });

    expect(items).toEqual(["Refresh", "Reset column widths"]);
    // Not drawn at the header's end as well.
    expect(
      document.querySelector(
        `thead [data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).toBeNull();
  });

  test("gives every column back to the table and forgets the widths", () => {
    keep("services-table", { name: 300, status: 180 });

    render(cardWithMenu(<Table<Row> {...tableProps()} />));

    // Opened on its own: a menu opened inside another act is drawn after it.
    const menu: HTMLElement = openMenu();

    act(() => {
      fireEvent.click(within(menu).getByText("Reset column widths"));
    });

    expect(headerCellOf("Name").style.width).toBe("");
    expect(headerCellOf("Status").style.width).toBe("");
    expect(stored("services-table")).toBeNull();
  });

  test("two tables in one card are reset by one item", () => {
    keep("first-table", { name: 300 });
    keep("second-table", { status: 200 });

    render(
      cardWithMenu(
        <>
          <Table<Row> {...tableProps({ id: "first-table" })} />
          <Table<Row> {...tableProps({ id: "second-table" })} />
        </>,
      ),
    );

    const menu: HTMLElement = openMenu();

    expect(within(menu).getAllByText("Reset column widths")).toHaveLength(1);

    act(() => {
      fireEvent.click(within(menu).getByText("Reset column widths"));
    });

    expect(stored("first-table")).toBeNull();
    expect(stored("second-table")).toBeNull();
  });

  test("a table with no ⋯ to keep it draws it at its header's end: in the Actions column's header", () => {
    keep("services-table", { name: 300 });

    render(<Table<Row> {...tableProps()} />);

    const headerCells: Array<Element> = Array.from(
      document.querySelectorAll("thead th"),
    );
    const actionsHeader: Element = headerCells[headerCells.length - 1]!;
    const reset: HTMLElement = within(actionsHeader as HTMLElement).getByRole(
      "button",
      { name: "Reset column widths" },
    );

    expect(reset).toHaveAttribute("title", "Reset column widths");
    // The Actions column is still named by its title alone.
    expect(actionsHeader).toHaveAttribute("aria-label", "Actions");

    act(() => {
      fireEvent.click(reset);
    });

    expect(headerCellOf("Name").style.width).toBe("");
    expect(
      document.querySelector(`[data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`),
    ).toBeNull();
  });

  test("...or, with no Actions column, in the filler's header", () => {
    keep("services-table", { name: 300 });

    render(<Table<Row> {...tableProps({ columns: columns() })} />);

    const filler: HTMLElement = document.querySelector(
      `thead [data-testid="${TABLE_END_FILLER_TEST_ID}"]`,
    ) as HTMLElement;

    expect(
      within(filler).getByRole("button", { name: "Reset column widths" }),
    ).toBeInTheDocument();
    expect(filler).not.toHaveAttribute("aria-hidden");
  });

  test("a card with no ⋯ keeps it at the table's header end too", () => {
    keep("services-table", { name: 300 });

    render(
      <Card title="Services">
        <Table<Row> {...tableProps()} />
      </Card>,
    );

    expect(
      document.querySelector(
        `thead [data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "More options" }),
    ).not.toBeInTheDocument();
  });

  test("a table in a dialog opened from a card is not the card's: its reset is its own", () => {
    keep("dialog-table", { name: 300 });

    render(
      cardWithMenu(
        <Modal title="Pick a service" onSubmit={() => {}} onClose={() => {}}>
          <Table<Row> {...tableProps({ id: "dialog-table" })} />
        </Modal>,
      ),
    );

    expect(
      document.querySelector(
        `thead [data-testid="${RESET_COLUMN_WIDTHS_TEST_ID}"]`,
      ),
    ).not.toBeNull();

    const menu: HTMLElement = openMenu();

    expect(
      within(menu).queryByText("Reset column widths"),
    ).not.toBeInTheDocument();
  });
});
