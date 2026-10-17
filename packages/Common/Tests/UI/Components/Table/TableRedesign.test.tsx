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
import { ReactElement } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ActionButtonSchema from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import {
  TABLE_CLASS_NAME,
  TABLE_CLICKABLE_ROW_CLASS_NAME,
  TABLE_HEADER_CELL_CLASS_NAME,
  TABLE_PRIMARY_CELL_TEXT_CLASS_NAME,
  TABLE_ROW_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_SELECTED_ROW_CLASS_NAME,
  TABLE_STICKY_END_BODY_CELL_CLASS_NAME,
  TABLE_STICKY_END_HEADER_CELL_CLASS_NAME,
  TABLE_STICKY_HEADER_CELL_CLASS_NAME,
  TABLE_STUCK_END_CELL_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * The table as the redesign draws it (model-table-ui), rendered: the quiet
 * one-line header, the rows and their rules, the name column, the empty
 * values, a value cut short, the Actions column in sight, the header that
 * sticks, a ticked row, a row that opens its record, the phone's card and
 * the loading rows. jsdom lays nothing out, so classes and DOM are what is
 * asserted here; what they draw is measured in Chromium by the ModelTables
 * offline suite (packages/E2E/ModelTables).
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
  note?: string | undefined;
  createdAt?: Date | undefined;
  isPaused?: boolean | undefined;
}

const ROWS: Array<Row> = [
  {
    _id: "1",
    name: "Checkout API",
    note: "The payment path",
    createdAt: new Date("2026-10-05T06:04:00.000Z"),
    isPaused: true,
  },
  { _id: "2", name: "Marketing Website", note: "", isPaused: false },
  { _id: "3", name: "Primary Database Ping" },
];

const COLUMNS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Note", type: FieldType.Text, key: "note" },
  { title: "Created", type: FieldType.DateTime, key: "createdAt" },
  { title: "Paused", type: FieldType.Boolean, key: "isPaused" },
  { title: "Actions", type: FieldType.Actions },
];

const VIEW_ACTION: Array<ActionButtonSchema<Row>> = [
  {
    title: "View",
    icon: IconProp.Eye,
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: (): void => {},
  },
];

interface RenderOptions {
  data?: Array<Row> | undefined;
  columns?: Columns<Row> | undefined;
  isLoading?: boolean | undefined;
  sortBy?: keyof Row | null | undefined;
  sortOrder?: SortOrder | undefined;
  withBulkActions?: boolean | undefined;
  selected?: Array<Row> | undefined;
  getRowProps?: ((item: Row) => React.HTMLAttributes<HTMLElement>) | undefined;
  enableDragAndDrop?: boolean | undefined;
}

const renderTable: (options?: RenderOptions) => void = (
  options?: RenderOptions,
): void => {
  const data: Array<Row> = options?.data ?? ROWS;

  render(
    <Table<Row>
      id="redesign-table"
      data={data}
      columns={options?.columns ?? COLUMNS}
      actionButtons={VIEW_ACTION}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={Boolean(options?.isLoading)}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortBy={options?.sortBy ?? null}
      sortOrder={options?.sortOrder ?? SortOrder.Ascending}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      getRowProps={options?.getRowProps}
      enableDragAndDrop={options?.enableDragAndDrop}
      dragDropIdField={options?.enableDragAndDrop ? "_id" : undefined}
      bulkActions={
        options?.withBulkActions
          ? {
              buttons: [
                {
                  title: "Archive",
                  icon: IconProp.Archive,
                  buttonStyleType: ButtonStyleType.NORMAL,
                  onClick: async (): Promise<void> => {},
                },
              ],
            }
          : undefined
      }
      bulkSelectedItems={options?.selected}
      matchBulkSelectedItemByField="_id"
    />,
  );
};

const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

type BodyRowsFunction = () => Array<HTMLElement>;

const bodyRows: BodyRowsFunction = (): Array<HTMLElement> => {
  return Array.from(
    document.querySelectorAll<HTMLElement>("#redesign-table-body > tr"),
  );
};

type HeaderCellFunction = (title: string) => HTMLElement;

const headerCell: HeaderCellFunction = (title: string): HTMLElement => {
  const cell: HTMLElement | undefined = screen
    .getAllByRole("columnheader")
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").trim() === title;
    });

  if (!cell) {
    throw new Error(`No header cell "${title}".`);
  }

  return cell;
};

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("the header row", () => {
  test("the table is drawn with separate borders", () => {
    renderTable();

    expect(screen.getByRole("table").className).toBe(TABLE_CLASS_NAME);
  });

  test("every header cell is the quiet band, and every name is kept on one line", () => {
    renderTable();

    for (const cell of screen.getAllByRole("columnheader")) {
      for (const token of TABLE_HEADER_CELL_CLASS_NAME.split(" ")) {
        expect(cell).toHaveClass(token);
      }

      expect(cell.firstElementChild).toHaveClass("whitespace-nowrap");
    }
  });

  test("the sorted column says so in the reading colour, with its arrow", () => {
    renderTable({ sortBy: "name", sortOrder: SortOrder.Descending });

    const sorted: HTMLElement = within(headerCell("Name")).getByRole("button", {
      name: "Name",
    });

    expect(sorted).toHaveClass("text-gray-900");
    expect(within(sorted).getByTestId("table-sort-arrow")).toBeInTheDocument();
    expect(within(sorted).queryByTestId("table-sort-hint")).toBeNull();
    expect(headerCell("Name")).toHaveAttribute("aria-sort", "descending");
  });

  test("any other sortable column shows its hint, and a column that cannot sort shows neither", () => {
    renderTable({ sortBy: "name" });

    const note: HTMLElement = within(headerCell("Note")).getByRole("button", {
      name: "Note",
    });

    expect(note).toHaveClass("text-gray-500", "hover:text-gray-900");
    expect(within(note).getByTestId("table-sort-hint")).toHaveClass(
      "opacity-0",
    );
    expect(within(note).queryByTestId("table-sort-arrow")).toBeNull();

    // No key: not sortable, no button, no arrows.
    renderTable({
      columns: [
        { title: "Name", type: FieldType.Text, key: "name" },
        { title: "Computed", type: FieldType.Text },
      ],
    });

    const computed: Array<HTMLElement> = screen
      .getAllByRole("columnheader")
      .filter((cell: HTMLElement): boolean => {
        return (cell.textContent || "").trim() === "Computed";
      });

    expect(within(computed[0]!).queryByRole("button")).toBeNull();
    expect(within(computed[0]!).queryByTestId("table-sort-hint")).toBeNull();
  });

  test("the Actions column's name is for a screen reader, not a word over every row's View", () => {
    renderTable();

    const actions: HTMLElement = headerCell("Actions");
    const title: HTMLElement = within(actions).getByText("Actions");

    expect(title).toHaveClass("sr-only");
    expect(actions).toHaveAccessibleName("Actions");
  });
});

describe("the header sticks while the table fits its card", () => {
  test("every header cell sticks under the page's top bar", () => {
    renderTable();

    // jsdom lays nothing out, so the table fits and nothing scrolls.
    expect(screen.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    for (const cell of screen.getAllByRole("columnheader")) {
      expect(cell).toHaveClass("sticky");
      expect(cell).toHaveClass("top-[var(--app-header-height,0px)]");
    }

    // The data columns at z-[2]; the Actions column's above its cells.
    expect(headerCell("Name")).toHaveClass(
      ...TABLE_STICKY_HEADER_CELL_CLASS_NAME.split(" "),
    );
    expect(headerCell("Actions")).toHaveClass(
      ...TABLE_STICKY_END_HEADER_CELL_CLASS_NAME.split(" "),
    );
  });

  test("a table inside a scrolling box (a dialog) keeps its header in place", () => {
    render(
      <div style={{ overflowY: "auto" }}>
        <Table<Row>
          id="redesign-table"
          data={ROWS}
          columns={COLUMNS}
          actionButtons={VIEW_ACTION}
          currentPageNumber={1}
          totalItemsCount={ROWS.length}
          itemsOnPage={10}
          error=""
          isLoading={false}
          singularLabel="Monitor"
          pluralLabel="Monitors"
          sortBy={null}
          sortOrder={SortOrder.Ascending}
          onSortChanged={() => {}}
          onNavigateToPage={() => {}}
        />
      </div>,
    );

    expect(headerCell("Name")).not.toHaveClass("sticky");
    expect(headerCell("Name")).not.toHaveClass(
      "top-[var(--app-header-height,0px)]",
    );
  });

  test("the scroll box is the containing block of a screen reader's words in a cell scrolled out of sight", () => {
    renderTable();

    expect(screen.getByTestId("table-scroll")).toHaveClass("relative");
    expect(screen.getByTestId("table-scroll")).not.toHaveClass(
      "overflow-x-auto",
    );
  });
});

describe("a table wider than its card", () => {
  type WidenFunction = () => void;

  // The table 1986px wide in a 1214px box, as the Incidents list was.
  const widen: WidenFunction = (): void => {
    const original: () => DOMRect =
      HTMLElement.prototype.getBoundingClientRect;

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.tagName === "TABLE") {
          return { width: 1986 } as DOMRect;
        }

        if (this.getAttribute("data-testid") === "table-scroll") {
          return { width: 1214 } as DOMRect;
        }

        return original.call(this);
      });
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("scrolls sideways in its own box", () => {
    widen();
    renderTable();

    const box: HTMLElement = screen.getByTestId("table-scroll");

    expect(box).toHaveAttribute("data-overflowing", "true");
    expect(box).toHaveClass("overflow-x-auto", "relative");
  });

  test("keeps its Actions column at the card's edge, ruled off from the cells passing under it", () => {
    widen();
    renderTable();

    const stuck: Array<string> = TABLE_STUCK_END_CELL_CLASS_NAME.split(" ");

    expect(headerCell("Actions")).toHaveClass(...stuck);

    for (const row of bodyRows()) {
      const actionsCell: HTMLElement = row.lastElementChild as HTMLElement;

      expect(actionsCell).toHaveClass(
        ...TABLE_STICKY_END_BODY_CELL_CLASS_NAME.split(" "),
      );
      expect(actionsCell).toHaveClass(...stuck);
      expect(
        within(actionsCell).getByRole("button", { name: "View" }),
      ).toBeInTheDocument();
    }
  });

  test("does not stick its header: it would not scroll sideways with the rows", () => {
    widen();
    renderTable();

    for (const cell of screen.getAllByRole("columnheader")) {
      expect(cell).not.toHaveClass("top-[var(--app-header-height,0px)]");
    }
  });

  test("a table that fits has no rule beside its Actions column", () => {
    renderTable();

    expect(headerCell("Actions")).not.toHaveClass("border-l");
    expect(bodyRows()[0]!.lastElementChild).not.toHaveClass("border-l");
  });
});

describe("the rows", () => {
  test("each is white and lights up under the pointer; the last draws no rule above the footer", () => {
    renderTable();

    const rows: Array<HTMLElement> = bodyRows();

    expect(rows).toHaveLength(3);

    rows.forEach((row: HTMLElement, index: number) => {
      expect(row.className).toBe(TABLE_ROW_CLASS_NAME);

      for (const cell of Array.from(row.children)) {
        if (index < rows.length - 1) {
          expect(cell).toHaveClass(...TABLE_ROW_RULE_CLASS_NAME.split(" "));
        } else {
          expect(cell).not.toHaveClass("border-b");
        }
      }
    });
  });

  test("the first column is the row's name: a step heavier, in the reading colour", () => {
    renderTable();

    const [name, note] = Array.from(bodyRows()[0]!.children);

    expect(name).toHaveClass(...TABLE_PRIMARY_CELL_TEXT_CLASS_NAME.split(" "));
    expect(note).toHaveClass("font-normal", "text-gray-700");
    expect(note).not.toHaveClass("font-medium");
  });

  test("the row's name starts where the card's text does; with a select box first, the box does", () => {
    renderTable();
    expect(bodyRows()[0]!.firstElementChild).toHaveClass("pl-6");

    cleanup();

    renderTable({ withBulkActions: true });
    const cells: Array<Element> = Array.from(bodyRows()[0]!.children);

    expect(cells[0]).toHaveClass("pl-6");
    expect(cells[1]).toHaveClass("pl-3");
    expect(cells[cells.length - 1]).toHaveClass("pr-6");
  });

  test("a ticked row keeps its light wash", () => {
    renderTable({ withBulkActions: true, selected: [ROWS[1]!] });

    const rows: Array<HTMLElement> = bodyRows();

    expect(rows[1]!.className).toBe(TABLE_SELECTED_ROW_CLASS_NAME);
    expect(rows[1]).toHaveAttribute("data-selected", "true");
    expect(rows[0]!.className).toBe(TABLE_ROW_CLASS_NAME);
    expect(rows[0]).not.toHaveAttribute("data-selected");
  });

  test("a row that opens its record takes the pointer's hand; its page's own classes stay", () => {
    const opened: Array<string> = [];

    renderTable({
      getRowProps: (row: Row): React.HTMLAttributes<HTMLElement> => {
        return {
          className: "custom-row",
          onClick: (): void => {
            opened.push(row.name || "");
          },
        };
      },
    });

    const row: HTMLElement = bodyRows()[0]!;

    expect(row).toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME, "custom-row");
    fireEvent.click(within(row).getByText("Checkout API"));
    expect(opened).toEqual(["Checkout API"]);
  });

  test("a row that does nothing on a click keeps the arrow pointer", () => {
    renderTable();

    expect(bodyRows()[0]).not.toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME);
  });
});

describe("a value that is not there is a quiet dash", () => {
  test("an empty text, a date never set, and No: the dash, with words for a screen reader", () => {
    renderTable();

    const [, second, third] = bodyRows();

    // Marketing Website: an empty note, no date, not paused.
    const secondCells: Array<Element> = Array.from(second!.children);

    expect(
      within(secondCells[1] as HTMLElement).getByTestId(
        TABLE_EMPTY_VALUE_TEST_ID,
      ),
    ).toHaveTextContent("Not set");
    expect(
      within(secondCells[2] as HTMLElement).getByTestId(
        TABLE_EMPTY_VALUE_TEST_ID,
      ),
    ).toBeInTheDocument();
    expect(
      within(secondCells[3] as HTMLElement).getByTestId(
        TABLE_EMPTY_VALUE_TEST_ID,
      ).querySelector(".sr-only"),
    ).toHaveTextContent("No");

    // Primary Database Ping: nothing set at all.
    expect(
      within(third!).getAllByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toHaveLength(3);
  });

  test("Yes is a tick with its word for a screen reader; there is no cross for No", () => {
    renderTable();

    const pausedCell: HTMLElement = bodyRows()[0]!.children[3] as HTMLElement;
    const yes: HTMLElement = within(pausedCell).getByTestId("table-boolean-yes");

    expect(yes.querySelector("svg")).not.toBeNull();
    expect(within(yes).getByText("Yes")).toHaveClass("sr-only");
  });

  test("a column's own words for a missing value stay, in the grey a missing value is drawn in", () => {
    renderTable({
      columns: [
        { title: "Name", type: FieldType.Text, key: "name" },
        {
          title: "Note",
          type: FieldType.Text,
          key: "note",
          noValueMessage: "Never noted",
        },
      ],
    });

    const words: HTMLElement = within(bodyRows()[1]!).getByText("Never noted");

    expect(words).toHaveClass("text-gray-500");
  });

  test("a column that draws its own bare dash gets the table's dash", () => {
    renderTable({
      columns: [
        { title: "Name", type: FieldType.Text, key: "name" },
        {
          title: "Duration",
          type: FieldType.Element,
          key: "note",
          getElement: (row: Row): ReactElement => {
            return row.note ? <span>{row.note}</span> : <>-</>;
          },
        },
      ],
    });

    const durationCell: HTMLElement = bodyRows()[1]!.children[1] as HTMLElement;

    expect(
      within(durationCell).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
    expect(durationCell.textContent).not.toBe("-");
  });
});

describe("a value too long for its column", () => {
  const LONG_NAME: string =
    "Customer-Facing Status Page for EU-West Enterprise Customers, Partners and Resellers (Primary)";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("shows in full under the pointer when it is cut short, and only then", () => {
    renderTable({
      data: [{ _id: "1", name: LONG_NAME }, { _id: "2", name: "Short" }],
    });

    const [longRow, shortRow] = bodyRows();
    const longWrapper: HTMLElement = longRow!.children[0]!
      .firstElementChild as HTMLElement;
    const shortWrapper: HTMLElement = shortRow!.children[0]!
      .firstElementChild as HTMLElement;

    // jsdom lays nothing out: the long one is made wider than its box.
    Object.defineProperty(longWrapper, "scrollWidth", { value: 640 });
    Object.defineProperty(longWrapper, "clientWidth", { value: 320 });
    Object.defineProperty(shortWrapper, "scrollWidth", { value: 40 });
    Object.defineProperty(shortWrapper, "clientWidth", { value: 40 });

    expect(longWrapper).not.toHaveAttribute("title");

    fireEvent.mouseEnter(longWrapper);
    fireEvent.mouseEnter(shortWrapper);

    expect(longWrapper).toHaveAttribute("title", LONG_NAME);
    expect(shortWrapper).not.toHaveAttribute("title");
    // Cut short with an ellipsis, inside its own column.
    expect(longWrapper).toHaveClass(
      "max-w-[20rem]",
      "overflow-x-clip",
      "text-ellipsis",
    );
  });

  test("a value that fits again loses the tooltip it no longer needs", () => {
    renderTable({ data: [{ _id: "1", name: LONG_NAME }] });

    const wrapper: HTMLElement = bodyRows()[0]!.children[0]!
      .firstElementChild as HTMLElement;
    let scrollWidth: number = 640;

    Object.defineProperty(wrapper, "scrollWidth", {
      get: (): number => {
        return scrollWidth;
      },
    });
    Object.defineProperty(wrapper, "clientWidth", { value: 320 });

    fireEvent.mouseEnter(wrapper);
    expect(wrapper).toHaveAttribute("title", LONG_NAME);

    scrollWidth = 300;
    fireEvent.mouseEnter(wrapper);
    expect(wrapper).not.toHaveAttribute("title");
  });

  test("a column of prose wraps instead, and gets no tooltip", () => {
    renderTable({
      data: [{ _id: "1", name: "A", note: LONG_NAME }],
      columns: [
        { title: "Name", type: FieldType.Text, key: "name" },
        { title: "Note", type: FieldType.Text, key: "note", wrapContent: true },
      ],
    });

    const wrapper: HTMLElement = bodyRows()[0]!.children[1]!
      .firstElementChild as HTMLElement;

    Object.defineProperty(wrapper, "scrollWidth", { value: 640 });
    Object.defineProperty(wrapper, "clientWidth", { value: 320 });
    fireEvent.mouseEnter(wrapper);

    expect(wrapper).not.toHaveAttribute("title");
    expect(wrapper).not.toHaveClass("overflow-x-clip");
  });
});

describe("on a phone", () => {
  test("a row is a card of names over values, the name first and heavier, the empty ones left out", () => {
    setViewportWidth(390);
    renderTable();

    const cards: Array<HTMLElement> = Array.from(
      document.querySelectorAll<HTMLElement>("#redesign-table-body > div"),
    );

    expect(cards).toHaveLength(3);

    const first: HTMLElement = cards[0]!;
    const names: Array<string> = Array.from(first.querySelectorAll("dt")).map(
      (name: Element): string => {
        return name.textContent || "";
      },
    );

    expect(names).toEqual(["Name", "Note", "Created", "Paused"]);
    expect(first.querySelectorAll("dd")[0]).toHaveClass("font-medium");
    expect(first.querySelectorAll("dd")[1]).not.toHaveClass("font-medium");

    // Marketing Website: no note, no date and not paused - only its name.
    const second: HTMLElement = cards[1]!;

    expect(
      Array.from(second.querySelectorAll("dt")).map((name: Element) => {
        return name.textContent;
      }),
    ).toEqual(["Name"]);
    expect(
      within(second).queryByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeNull();
  });

  test("a card that opens its record answers a tap", () => {
    setViewportWidth(390);
    const opened: Array<string> = [];

    renderTable({
      getRowProps: (row: Row): React.HTMLAttributes<HTMLElement> => {
        return {
          onClick: (): void => {
            opened.push(row.name || "");
          },
        };
      },
    });

    const card: HTMLElement = document.querySelector<HTMLElement>(
      "#redesign-table-body > div",
    )!;

    expect(card).toHaveClass(TABLE_CLICKABLE_ROW_CLASS_NAME);
    fireEvent.click(within(card).getByText("Checkout API"));
    expect(opened).toEqual(["Checkout API"]);
  });

  test("a ticked card keeps its wash", () => {
    setViewportWidth(390);
    renderTable({ withBulkActions: true, selected: [ROWS[0]!] });

    expect(
      document.querySelector<HTMLElement>("#redesign-table-body > div"),
    ).toHaveClass("bg-indigo-50");
  });
});

describe("while the first page loads", () => {
  test("the Actions column holds a button's shape, so it keeps its width", () => {
    renderTable({ isLoading: true, data: [] });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    const firstRow: Element = loader.querySelectorAll("tr")[0]!;
    const actionsCell: Element = firstRow.lastElementChild!;

    expect(actionsCell).toHaveClass("text-end");
    expect(actionsCell.firstElementChild).toHaveClass("justify-end");
    expect(
      actionsCell.querySelector(".w-24.h-6.rounded-md"),
    ).not.toBeNull();
  });

  test("every placeholder sits on the row's 24px line", () => {
    renderTable({ isLoading: true, data: [] });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");

    for (const cell of Array.from(
      loader.querySelectorAll("tr")[0]!.querySelectorAll("td"),
    )) {
      expect(cell.querySelector(".h-6")).not.toBeNull();
    }
  });

  test("the last placeholder row draws no rule, as the last real row does not", () => {
    renderTable({ isLoading: true, data: [] });

    const rows: NodeListOf<Element> = screen
      .getByTestId("table-skeleton-loader")
      .querySelectorAll("tr");

    expect(rows[0]!.firstElementChild).toHaveClass("border-b");
    expect(rows[rows.length - 1]!.firstElementChild).not.toHaveClass(
      "border-b",
    );
  });
});
