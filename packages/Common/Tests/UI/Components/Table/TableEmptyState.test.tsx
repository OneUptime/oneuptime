import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * What a table shows once a load has finished with nothing in it.
 *
 * - It is drawn BELOW the table, not in a row of it. A row spans every
 *   column, so on a wide table (the SLO list has ten) the sentence was
 *   centred across columns scrolled out of view and cut off at the card's
 *   edge. Outside the scroller it is centred in the card the user sees.
 * - A way forward (the "Create X" button the page's header has) replaces the
 *   underlined "Refresh?", which on an empty list read like a failed load.
 * - The default sentence is looked up whole, never a word at a time: German
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
  onRefreshClick?: (() => void) | undefined;
}

const TABLE_ID: string = "monitors-table";
const NO_ITEMS_TEST_ID: string = `${TABLE_ID}-no-items`;

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
      currentPageNumber={1}
      totalItemsCount={data.length}
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
      onRefreshClick={options.onRefreshClick ?? (() => {})}
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

afterEach(() => {
  cleanup();
  dictionary = {};
  setViewportWidth(1024);
});

describe("where the no-items message is drawn", () => {
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

  test("on a phone as well, and only once", () => {
    setViewportWidth(375);

    renderTable();

    // The phone layout is a list, not a <table> - so this is that branch.
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByTestId(NO_ITEMS_TEST_ID)).toHaveLength(1);
    expect(screen.getAllByText("No monitors yet.")).toHaveLength(1);
  });

  test("not at all while the first load is still running", () => {
    renderTable({ isLoading: true });

    expect(screen.getByTestId("table-skeleton-loader")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
    expect(screen.queryByText("No monitors yet.")).toBeNull();
  });

  test("not at all when the load failed: the error speaks instead", () => {
    renderTable({ error: "Something went wrong" });

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
    expect(screen.queryByText("No monitors yet.")).toBeNull();
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

describe("what the no-items message says", () => {
  test('defaults to "No <plural> yet." from the table\'s plural label', () => {
    renderTable();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "No monitors yet.",
    );
  });

  test("a page's own sentence is shown as given", () => {
    renderTable({ noItemsMessage: "Connect your first monitor." });

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "Connect your first monitor.",
    );
    expect(screen.queryByText("No monitors yet.")).toBeNull();
  });

  test("a page's own element is rendered as given", () => {
    renderTable({
      noItemsMessage: (
        <span data-testid="custom-empty">Hook up an agent first.</span>
      ),
    });

    expect(
      screen
        .getByTestId(NO_ITEMS_TEST_ID)
        .querySelector('[data-testid="custom-empty"]'),
    ).not.toBeNull();
    expect(screen.getByText("Hook up an agent first.")).toBeInTheDocument();
  });

  test("a locale with the whole sentence shows it", () => {
    dictionary = { "No monitors yet.": "Noch keine Monitore." };

    renderTable();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "Noch keine Monitore.",
    );
  });

  test("a locale without it shows its noun-free sentence", () => {
    dictionary = { "Nothing here yet.": "Hier ist noch nichts." };

    renderTable();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "Hier ist noch nichts.",
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
    expect(block).toHaveTextContent("Hier ist noch nichts.");
  });
});

describe("the way forward from an empty table", () => {
  test("an action replaces the Refresh link", () => {
    renderTable({
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    const action: HTMLElement = screen.getByTestId("empty-action");

    expect(action.querySelector('[data-testid="create-first"]')).not.toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });

  test("the action sits under the message, in the same block", () => {
    renderTable({
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block).toHaveTextContent("No monitors yet.");
    expect(block.querySelector('[data-testid="create-first"]')).not.toBeNull();
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

  test("without an action the Refresh link is still there, and refreshes", () => {
    let refreshes: number = 0;

    renderTable({
      onRefreshClick: () => {
        refreshes++;
      },
    });

    expect(screen.queryByTestId("empty-action")).toBeNull();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(refreshes).toBe(1);
  });

  test("a failed load keeps its Refresh link even when an action is supplied", () => {
    let refreshes: number = 0;

    renderTable({
      error: "Something went wrong",
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
      onRefreshClick: () => {
        refreshes++;
      },
    });

    expect(screen.queryByTestId("create-first")).toBeNull();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(refreshes).toBe(1);
  });

  test("on a phone the action is offered too", () => {
    setViewportWidth(375);

    renderTable({
      noItemsAction: <button data-testid="create-first">Create Monitor</button>,
    });

    expect(document.querySelector("table")).toBeNull();
    expect(screen.getAllByTestId("create-first")).toHaveLength(1);
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });
});
