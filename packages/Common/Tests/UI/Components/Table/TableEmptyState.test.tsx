import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import Table from "../../../../UI/Components/Table/Table";
import { TableEmptyStateKind } from "../../../../UI/Components/Table/TableEmptyState";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * What a table shows once a load has finished with nothing in it - or has
 * failed.
 *
 * - It is drawn BELOW the table, not in a row of it. A row spans every
 *   column, so on a wide table (the SLO list has ten) the sentence was
 *   centred across columns scrolled out of view and cut off at the card's
 *   edge. Outside the scroller it is centred in the card the user sees.
 * - It is a real empty state: an illustration, a title, what the list is
 *   for, and the way forward - no longer a grey line over an underlined
 *   "Refresh?", which on an empty list read like a failed load.
 * - A failed load is its own state, with Try again.
 * - A filter that hides every row says so and offers to clear it.
 * - The default title is looked up whole, never a word at a time: German
 *   used to read "Nein monitors yet.".
 *
 * react-i18next answers from a per-test dictionary, so the translation path
 * the real component takes is the one exercised.
 */

let dictionary: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return dictionary[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
  status?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Status", type: FieldType.Text, key: "status" },
];

const rows: Array<Row> = [
  { _id: "1", name: "Alpha", status: "Up" },
  { _id: "2", name: "Beta", status: "Down" },
];

interface RenderOptions {
  data?: Array<Row> | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  noItemsMessage?: string | React.ReactElement | undefined;
  noItemsAction?: React.ReactElement | undefined;
  emptyStateProps?: React.ComponentProps<typeof Table>["emptyStateProps"];
  onRefreshClick?: (() => void) | undefined;
  filterData?: FilterData<Row> | undefined;
  onFilterChanged?: ((filterData: FilterData<Row>) => void) | undefined;
  currentPageNumber?: number | undefined;
  totalItemsCount?: number | undefined;
  disablePagination?: boolean | undefined;
}

const TABLE_ID: string = "monitors-table";
const NO_ITEMS_TEST_ID: string = `${TABLE_ID}-no-items`;
const LOAD_ERROR_TEST_ID: string = `${TABLE_ID}-load-error`;

type RenderTableFunction = (options?: RenderOptions) => void;

const renderTable: RenderTableFunction = (
  options: RenderOptions = {},
): void => {
  const data: Array<Row> = options.data ?? [];

  render(
    <Table<Row>
      id={TABLE_ID}
      data={data}
      columns={columns}
      currentPageNumber={options.currentPageNumber ?? 1}
      totalItemsCount={options.totalItemsCount ?? data.length}
      itemsOnPage={10}
      error={options.error ?? ""}
      isLoading={options.isLoading ?? false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      noItemsMessage={options.noItemsMessage}
      noItemsAction={options.noItemsAction}
      emptyStateProps={options.emptyStateProps}
      onRefreshClick={options.onRefreshClick ?? (() => {})}
      filterData={options.filterData}
      onFilterChanged={options.onFilterChanged}
      disablePagination={options.disablePagination}
    />,
  );
};

// The table reads window.innerWidth at mount; < 768 renders the phone list.
const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const titleIn: (blockTestId: string) => HTMLElement = (
  blockTestId: string,
): HTMLElement => {
  return screen
    .getByTestId(blockTestId)
    .querySelector('[data-testid="table-empty-state-title"]') as HTMLElement;
};

afterEach(() => {
  cleanup();
  dictionary = {};
  setViewportWidth(1024);
});

describe("where the empty state is drawn", () => {
  test("once, below the table rather than in a row of it", () => {
    renderTable();

    const blocks: Array<HTMLElement> = screen.getAllByTestId(NO_ITEMS_TEST_ID);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.closest("table")).toBeNull();
    expect(blocks[0]!.closest("td")).toBeNull();
    // Nothing is left in the table's body for the message to have come from.
    expect(document.querySelectorAll("tbody")).toHaveLength(0);
  });

  test("the header row is still there, so the user sees what the list holds", () => {
    renderTable();

    const table: HTMLTableElement | null = document.querySelector("table");

    expect(table).not.toBeNull();
    expect(table!.querySelector("thead")).not.toBeNull();
    expect(table).toHaveTextContent("Name");
    expect(table).toHaveTextContent("Status");
  });

  test("sits outside the horizontally scrolling wrapper", () => {
    renderTable();

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block.closest(".overflow-x-auto")).toBeNull();
    expect(block.closest('[data-testid="table-content"]')).toBeNull();
  });

  test("on a phone as well, and only once, without the doubled rule", () => {
    setViewportWidth(375);

    renderTable();

    // The phone layout is a list, not a <table> - so this is that branch.
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByTestId(NO_ITEMS_TEST_ID)).toHaveLength(1);
    expect(screen.getAllByText("No monitors yet")).toHaveLength(1);
    expect(screen.getByTestId(NO_ITEMS_TEST_ID).className).not.toContain(
      "border-t",
    );
  });

  test("not at all while the first load is still running", () => {
    renderTable({ isLoading: true });

    expect(screen.getByTestId("table-skeleton-loader")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
    expect(screen.queryByText("No monitors yet")).toBeNull();
  });

  test("not at all when the load failed: the error speaks instead", () => {
    renderTable({ error: "Something went wrong" });

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
    expect(screen.queryByText("No monitors yet")).toBeNull();
  });

  test("not at all when there are rows", () => {
    renderTable({ data: rows });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
  });

  test("not while a refetch runs over rows already on screen", () => {
    renderTable({ data: rows, isLoading: true });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
  });
});

describe("what the empty state says", () => {
  test('is headed "No <plural> yet", as a heading without a full stop', () => {
    renderTable();

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(/^No monitors yet$/);
    expect(titleIn(NO_ITEMS_TEST_ID).tagName).toBe("H3");
    expect(
      screen.getByTestId(NO_ITEMS_TEST_ID).querySelector("[data-empty-state-kind]"),
    ).toHaveAttribute("data-empty-state-kind", TableEmptyStateKind.Empty);
  });

  test("a page's own sentence heads it", () => {
    renderTable({ noItemsMessage: "Connect your first monitor." });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /^Connect your first monitor$/,
    );
    expect(screen.queryByText("No monitors yet")).toBeNull();
  });

  test("a page's later sentences describe it", () => {
    renderTable({
      noItemsMessage:
        "No containers found in the last 5 minutes. Make sure the Docker agent is sending metrics.",
    });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /^No containers found in the last 5 minutes$/,
    );
    expect(
      screen
        .getByTestId(NO_ITEMS_TEST_ID)
        .querySelector('[data-testid="table-empty-state-description"]'),
    ).toHaveTextContent("Make sure the Docker agent is sending metrics.");
  });

  test("a page's own element is rendered as given, in place of the whole state", () => {
    renderTable({
      noItemsMessage: (
        <span data-testid="custom-empty">Hook up an agent first.</span>
      ),
    });

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block.querySelector('[data-testid="custom-empty"]')).not.toBeNull();
    expect(block.querySelector('[data-testid="table-empty-state"]')).toBeNull();
  });

  test("a locale with the whole sentence shows it", () => {
    dictionary = { "No monitors yet.": "Noch keine Monitore." };

    renderTable();

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(/^Noch keine Monitore$/);
  });

  test("a locale without it shows its noun-free sentence", () => {
    dictionary = { "Nothing here yet.": "Hier ist noch nichts." };

    renderTable();

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /^Hier ist noch nichts$/,
    );
  });

  /*
   * The regression itself: the old fallback looked up "No" alone, which
   * German translates as the answer to a question.
   */
  test('never builds the sentence from a separately translated "No"', () => {
    dictionary = {
      No: "Nein",
      "Nothing here yet.": "Hier ist noch nichts.",
      Monitors: "Monitore",
      Monitor: "Monitor",
    };

    renderTable();

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block).not.toHaveTextContent("Nein");
    expect(block).toHaveTextContent("Hier ist noch nichts");
  });

  test("there is no Refresh? link: reloading an empty list shows the same nothing", () => {
    renderTable({ noItemsMessage: "No custom fields found." });

    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });
});

describe("the way forward from an empty table", () => {
  test("an action the caller hands over sits under the title, in the same block", () => {
    renderTable({
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block).toHaveTextContent("No monitors yet");
    expect(block.querySelector('[data-testid="create-first"]')).not.toBeNull();
    expect(
      screen
        .getByTestId("table-empty-state-actions")
        .querySelector('[data-testid="create-first"]'),
    ).not.toBeNull();
  });

  test("the action is live", () => {
    let clicks: number = 0;

    renderTable({
      noItemsAction: (
        <button
          data-testid="create-first"
          onClick={() => {
            clicks++;
          }}
        >
          Create Monitor
        </button>
      ),
    });

    fireEvent.click(screen.getByTestId("create-first"));

    expect(clicks).toBe(1);
  });

  test("on a phone the action is offered too", () => {
    setViewportWidth(375);

    renderTable({
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByTestId("create-first")).toHaveLength(1);
  });

  test("a fully built empty state wins over the sentence and the action", () => {
    let creates: number = 0;

    renderTable({
      noItemsMessage: "ignored",
      noItemsAction: <button data-testid="ignored-action">Ignored</button>,
      emptyStateProps: {
        kind: TableEmptyStateKind.Empty,
        title: "No incident measurements yet",
        description: "A measurement is the time between two moments.",
        actions: [
          {
            title: "Create Incident Measurement",
            dataTestId: "empty-table-create-button",
            onClick: () => {
              creates++;
            },
          },
        ],
      },
    });

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block).toHaveTextContent("No incident measurements yet");
    expect(block).toHaveTextContent(
      "A measurement is the time between two moments.",
    );
    expect(block).not.toHaveTextContent("ignored");
    expect(screen.queryByTestId("ignored-action")).toBeNull();

    fireEvent.click(screen.getByTestId("empty-table-create-button"));
    expect(creates).toBe(1);
  });
});

describe("a filter that hides every row", () => {
  test("says nothing matches, and Clear Filters empties the filter form", () => {
    const changes: Array<FilterData<Row>> = [];

    renderTable({
      filterData: { name: "zzz" },
      onFilterChanged: (filterData: FilterData<Row>) => {
        changes.push(filterData);
      },
    });

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(
      block.querySelector("[data-empty-state-kind]"),
    ).toHaveAttribute("data-empty-state-kind", TableEmptyStateKind.Filtered);
    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /^No monitors match your search or filters$/,
    );

    fireEvent.click(screen.getByTestId("empty-table-clear-filters-button"));

    expect(changes).toEqual([{}]);
  });

  test("a page's own filtered sentence heads it", () => {
    renderTable({
      filterData: { status: "Down" },
      onFilterChanged: () => {},
      noItemsMessage: "No events match the current filters.",
    });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /^No events match the current filters$/,
    );
  });

  test('a yes/no filter set to "No" counts as a filter', () => {
    renderTable({
      filterData: { status: false } as unknown as FilterData<Row>,
      onFilterChanged: () => {},
    });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /match your search or filters$/,
    );
  });

  test("cleared filter fields do not count", () => {
    renderTable({
      filterData: { name: "" } as FilterData<Row>,
      onFilterChanged: () => {},
    });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(/^No monitors yet$/);
    expect(screen.queryByTestId("empty-table-clear-filters-button")).toBeNull();
  });

  test("without onFilterChanged there is no button that cannot work", () => {
    renderTable({ filterData: { name: "zzz" } });

    expect(titleIn(NO_ITEMS_TEST_ID)).toHaveTextContent(
      /match your search or filters$/,
    );
    expect(screen.queryByTestId("empty-table-clear-filters-button")).toBeNull();
  });

  test("never offers the caller's create action", () => {
    renderTable({
      filterData: { name: "zzz" },
      onFilterChanged: () => {},
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    expect(screen.queryByTestId("create-first")).toBeNull();
  });
});

describe("a failed load", () => {
  test("is its own state, below the table: what failed, why, and Try again", () => {
    let retries: number = 0;

    renderTable({
      error: "The server took too long to answer.",
      onRefreshClick: () => {
        retries++;
      },
    });

    const block: HTMLElement = screen.getByTestId(LOAD_ERROR_TEST_ID);

    expect(block.closest("table")).toBeNull();
    expect(
      block.querySelector("[data-empty-state-kind]"),
    ).toHaveAttribute("data-empty-state-kind", TableEmptyStateKind.Error);
    expect(titleIn(LOAD_ERROR_TEST_ID)).toHaveTextContent(
      /^Couldn't load monitors$/,
    );
    expect(block).toHaveTextContent("The server took too long to answer.");

    const retry: HTMLElement = screen.getByTestId("refresh-button");
    expect(retry).toHaveTextContent("Try again");

    fireEvent.click(retry);
    expect(retries).toBe(1);
  });

  test("replaces the rows, but keeps the header row", () => {
    renderTable({ data: rows, error: "Boom" });

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(document.querySelector("thead")).not.toBeNull();
    expect(screen.getByTestId(LOAD_ERROR_TEST_ID)).toHaveTextContent("Boom");
  });

  test("a supplied action is not offered under an error", () => {
    renderTable({
      error: "Boom",
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    expect(screen.queryByTestId("create-first")).toBeNull();
  });

  test("a locale heads it with its own sentence", () => {
    dictionary = {
      "Couldn't load this list.": "Diese Liste konnte nicht geladen werden.",
      "Try again": "Erneut versuchen",
    };

    renderTable({ error: "Boom" });

    expect(titleIn(LOAD_ERROR_TEST_ID)).toHaveTextContent(
      /^Diese Liste konnte nicht geladen werden$/,
    );
    expect(screen.getByTestId("refresh-button")).toHaveTextContent(
      "Erneut versuchen",
    );
  });

  test("on a phone it is drawn once, too", () => {
    setViewportWidth(375);

    renderTable({ error: "Boom" });

    expect(screen.getAllByTestId(LOAD_ERROR_TEST_ID)).toHaveLength(1);
  });

  test("never while a refetch is in flight", () => {
    renderTable({ data: rows, error: "Boom", isLoading: true });

    expect(screen.queryByTestId(LOAD_ERROR_TEST_ID)).toBeNull();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("the pagination footer under an empty table", () => {
  test("is left out on an empty first page: the state already says there is nothing", () => {
    renderTable();

    expect(screen.queryByText("Rows per page")).toBeNull();
    expect(document.querySelector("nav")).toBeNull();
  });

  test("is left out under a failed first load", () => {
    renderTable({ error: "Boom" });

    expect(screen.queryByText("Rows per page")).toBeNull();
  });

  test("stays on a later page, as the way back", () => {
    renderTable({ currentPageNumber: 3, totalItemsCount: 25 });

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
  });

  test("is there as before when there are rows", () => {
    renderTable({ data: rows });

    expect(screen.getByText("Rows per page")).toBeInTheDocument();
  });

  test("stays away when the caller turned it off", () => {
    renderTable({ data: rows, disablePagination: true });

    expect(screen.queryByText("Rows per page")).toBeNull();
  });
});
