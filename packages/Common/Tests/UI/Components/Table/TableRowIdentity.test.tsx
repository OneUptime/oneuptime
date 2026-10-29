import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import Table, {
  ComponentProps as TableProps,
} from "../../../../UI/Components/Table/Table";
import { getUniqueRowIds } from "../../../../UI/Components/Table/TableBody";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A row is its record's, wherever it moves.
 *
 * Rows used to be keyed by their position unless the list could be dragged.
 * A list that keeps itself current (ModelTable/UseLiveRows) moves its rows
 * by itself: a new incident read in at the top moves every row down one.
 * Keyed by position, each row's state stayed where it was - the focused
 * button, a cell's opened labels - and so belonged to another incident:
 * the View the keyboard was on became the next incident's, and Enter
 * opened that one. Keyed by the record's id, the row moves and its state
 * goes with it.
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
  _id: string;
  title: string;
}

const CHECKOUT: Row = {
  _id: "20000000-0000-4000-8000-000000000101",
  title: "Checkout API is returning 502 errors",
};
const STOREFRONT: Row = {
  _id: "20000000-0000-4000-8000-000000000102",
  title: "Storefront slow for EU visitors",
};
const LOGIN: Row = {
  _id: "20000000-0000-4000-8000-000000000103",
  title: "Login page down",
};

const columns: Columns<Row> = [
  { title: "Title", type: FieldType.Text, key: "title" },
];

const tableProps: (data: Array<Row>) => TableProps<Row> = (
  data: Array<Row>,
): TableProps<Row> => {
  return {
    id: "incidents",
    data: data,
    columns: columns,
    currentPageNumber: 1,
    totalItemsCount: data.length,
    itemsOnPage: 10,
    error: "",
    isLoading: false,
    singularLabel: "Incident",
    pluralLabel: "Incidents",
    sortOrder: SortOrder.Descending,
    sortBy: null,
    onSortChanged: (): void => {},
    onNavigateToPage: (): void => {},
    // The id field a list names its rows by (BaseModelTable: "_id").
    dragDropIdField: "_id",
    bulkActions: {
      buttons: [
        {
          title: "Acknowledge",
          onClick: async (): Promise<void> => {
            return Promise.resolve();
          },
        },
      ],
    },
    matchBulkSelectedItemByField: "_id",
    bulkItemToString: (row: Row): string => {
      return row.title;
    },
  } as unknown as TableProps<Row>;
};

const rowOf: (text: string) => HTMLElement = (text: string): HTMLElement => {
  return screen.getByText(text).closest("tr") as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe("a row stays its record's when the rows move", () => {
  test("the focused row's control stays with its record when a row is read in above it", () => {
    const view: ReturnType<typeof render> = render(
      <Table<Row> {...tableProps([CHECKOUT, STOREFRONT])} />,
    );

    const storefrontRow: HTMLElement = rowOf(STOREFRONT.title);
    const box: HTMLInputElement = storefrontRow.querySelector(
      'input[type="checkbox"]',
    )!;

    act((): void => {
      box.focus();
    });

    view.rerender(
      <Table<Row> {...tableProps([LOGIN, CHECKOUT, STOREFRONT])} />,
    );

    // The same element, still focused, still Storefront's: the row moved.
    expect(rowOf(STOREFRONT.title)).toBe(storefrontRow);
    expect(document.activeElement).toBe(box);
    expect(storefrontRow).toContainElement(box);
    expect(rowOf(LOGIN.title)).not.toContainElement(box);
  });

  test("a row that leaves takes its element with it; the rows that stay keep theirs", () => {
    const view: ReturnType<typeof render> = render(
      <Table<Row> {...tableProps([LOGIN, CHECKOUT, STOREFRONT])} />,
    );

    const checkoutRow: HTMLElement = rowOf(CHECKOUT.title);
    const storefrontRow: HTMLElement = rowOf(STOREFRONT.title);

    view.rerender(<Table<Row> {...tableProps([CHECKOUT, STOREFRONT])} />);

    expect(screen.queryByText(LOGIN.title)).not.toBeInTheDocument();
    expect(rowOf(CHECKOUT.title)).toBe(checkoutRow);
    expect(rowOf(STOREFRONT.title)).toBe(storefrontRow);
  });

  test("rows with no ids, or sharing one, are still drawn, each once", () => {
    const shared: Array<Row> = [
      { _id: "same", title: "First of two" },
      { _id: "same", title: "Second of two" },
    ];

    render(<Table<Row> {...tableProps(shared)} />);

    expect(screen.getByText("First of two")).toBeInTheDocument();
    expect(screen.getByText("Second of two")).toBeInTheDocument();
  });
});

describe("getUniqueRowIds", () => {
  test("the rows' ids, in order", () => {
    expect(getUniqueRowIds([CHECKOUT, STOREFRONT], "_id")).toEqual([
      CHECKOUT._id,
      STOREFRONT._id,
    ]);
  });

  test("an id in any shape a record carries it: text, an ObjectID, the API's JSON", () => {
    expect(
      getUniqueRowIds(
        [
          { _id: new ObjectID(CHECKOUT._id) },
          { _id: { _type: "ObjectID", value: STOREFRONT._id } },
          { _id: LOGIN._id },
        ],
        "_id",
      ),
    ).toEqual([CHECKOUT._id, STOREFRONT._id, LOGIN._id]);
  });

  test("by position where the table names no id field", () => {
    expect(getUniqueRowIds([CHECKOUT, STOREFRONT], undefined)).toBeNull();
  });

  test("by position where a row has no id", () => {
    expect(
      getUniqueRowIds([CHECKOUT, { _id: "", title: "Draft" }], "_id"),
    ).toBeNull();
    expect(
      getUniqueRowIds([CHECKOUT, { title: "No id" } as unknown as Row], "_id"),
    ).toBeNull();
  });

  test("by position where two rows share an id: React needs each key once", () => {
    expect(getUniqueRowIds([CHECKOUT, { ...CHECKOUT }], "_id")).toBeNull();
  });

  test("an empty page has no ids to give", () => {
    expect(getUniqueRowIds([], "_id")).toEqual([]);
  });
});
