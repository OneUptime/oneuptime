import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import {
  CardSurface,
  CardSurfaceContext,
} from "../../../../UI/Components/Card/CardSurface";
import Table from "../../../../UI/Components/Table/Table";
import {
  TABLE_FOOTER_BAND_CLASS_NAME,
  TABLE_FOOTER_BLEED_CLASS_NAME,
  TABLE_FOOTER_ROUNDED_CLASS_NAME,
  getTableFooterClassName,
} from "../../../../UI/Components/Table/TableLayout";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";

/*
 * WHAT ENDS A TABLE'S CARD.
 *
 * A table's footer reaches the card's edges and its bottom (-mb-6): the
 * pagination bar is a grey band flush on the card's bottom edge, clipped to
 * its rounded corners. A table that shows every row on one page
 * (disablePagination - the Rule Library, a dictionary, the sign-in keys)
 * has nothing in its footer, and the empty footer still pulled itself into
 * the card's bottom padding: the last row then ended on the card's bottom
 * edge, its square white corners over the card's rounded ones and over its
 * bottom border (#5246's review, on the Rule Library and on Entities).
 *
 * Now a footer with nothing in it under rows stays out of the padding, so
 * the card keeps 24px, its border and its corners under the last row. An
 * empty state or a load error keeps the old way: its own padding ends the
 * card, as far below its words as above them. With pagination nothing
 * changes.
 */

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

const COLUMNS: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

const ROWS: Array<Row> = [
  { _id: "1", name: "Okta brute force" },
  { _id: "2", name: "First shell in a namespace by a user" },
];

function table(data: {
  rows: Array<Row>;
  disablePagination?: boolean;
  isLoading?: boolean;
  error?: string;
}): ReactElement {
  return (
    <Table<Row>
      id="rule-library-table"
      data={data.rows}
      columns={COLUMNS}
      disablePagination={data.disablePagination}
      currentPageNumber={1}
      totalItemsCount={data.rows.length}
      itemsOnPage={10}
      error={data.error || ""}
      isLoading={Boolean(data.isLoading)}
      singularLabel="Rule"
      pluralLabel="Rules"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
      onNavigateToPage={(): void => {}}
      onRefreshClick={(): void => {}}
    />
  );
}

function inSection(element: ReactElement): ReactElement {
  return (
    <CardSurfaceContext.Provider value={CardSurface.Section}>
      {element}
    </CardSurfaceContext.Provider>
  );
}

// The footer pulls itself into the card's padding: its sides and its bottom.
function expectBleeding(footer: HTMLElement): void {
  for (const className of TABLE_FOOTER_BLEED_CLASS_NAME.split(" ")) {
    expect(footer).toHaveClass(className);
  }
}

function expectOutOfThePadding(footer: HTMLElement): void {
  expect(footer.className).toBe("");
  expect(footer).not.toHaveClass("-mb-6");
  expect(footer).not.toHaveClass("bg-gray-50");
  expect(footer).not.toHaveClass("rounded-b-xl");
  expect(footer).toBeEmptyDOMElement();
}

const setWindowWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

afterEach(() => {
  cleanup();
  setWindowWidth(1280);
});

describe("getTableFooterClassName", () => {
  test("with pagination, the grey band on the card's rounded bottom edge", () => {
    for (const endsWithRows of [true, false]) {
      expect(
        getTableFooterClassName({
          hasPagination: true,
          endsWithRows: endsWithRows,
          isCardSection: false,
        }),
      ).toBe(
        `${TABLE_FOOTER_BAND_CLASS_NAME} ${TABLE_FOOTER_ROUNDED_CLASS_NAME}`,
      );
    }
  });

  test("in a section of a card the band is square, so the divider under it runs straight", () => {
    expect(
      getTableFooterClassName({
        hasPagination: true,
        endsWithRows: true,
        isCardSection: true,
      }),
    ).toBe(TABLE_FOOTER_BAND_CLASS_NAME);
  });

  test("with nothing to page through under rows, nothing at all - on a page and in a section", () => {
    for (const isCardSection of [true, false]) {
      expect(
        getTableFooterClassName({
          hasPagination: false,
          endsWithRows: true,
          isCardSection: isCardSection,
        }),
      ).toBe("");
    }
  });

  test("with nothing to page through under an empty state or an error, the band still takes the card's padding", () => {
    expect(
      getTableFooterClassName({
        hasPagination: false,
        endsWithRows: false,
        isCardSection: false,
      }),
    ).toBe(
      `${TABLE_FOOTER_BAND_CLASS_NAME} ${TABLE_FOOTER_ROUNDED_CLASS_NAME}`,
    );
    expect(
      getTableFooterClassName({
        hasPagination: false,
        endsWithRows: false,
        isCardSection: true,
      }),
    ).toBe(TABLE_FOOTER_BAND_CLASS_NAME);
  });

  test("the band reaches the card's sides and bottom, and clips the pagination bar to its curve", () => {
    expect(TABLE_FOOTER_BAND_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "bg-gray-50",
        "-mx-5",
        "-mb-6",
        "md:-mx-6",
        "overflow-hidden",
      ]),
    );
    expect(TABLE_FOOTER_ROUNDED_CLASS_NAME).toBe("rounded-b-xl");
  });
});

describe("a table that shows every row on one page", () => {
  test("its last row is followed by the card's own padding, not an empty footer pulled into it", () => {
    render(table({ rows: ROWS, disablePagination: true }));

    expect(screen.getByText("Okta brute force")).toBeInTheDocument();
    expect(
      screen.getByText("First shell in a namespace by a user"),
    ).toBeInTheDocument();
    expectOutOfThePadding(screen.getByTestId("table-footer"));
  });

  test("while its rows load, the placeholders are followed by the card's padding too", () => {
    render(table({ rows: [], disablePagination: true, isLoading: true }));

    expectOutOfThePadding(screen.getByTestId("table-footer"));
  });

  test("on a phone, where each row is a card of its own, the same", () => {
    setWindowWidth(390);

    render(table({ rows: ROWS, disablePagination: true }));

    expect(screen.getByText("Okta brute force")).toBeInTheDocument();
    expectOutOfThePadding(screen.getByTestId("table-footer"));
  });

  test("in a section of a card, the same", () => {
    render(inSection(table({ rows: ROWS, disablePagination: true })));

    expectOutOfThePadding(screen.getByTestId("table-footer"));
  });

  test("an empty one ends the card with its empty state, as before", () => {
    render(table({ rows: [], disablePagination: true }));

    expect(screen.getByTestId("rule-library-table-no-items")).toBeVisible();

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expectBleeding(footer);
    expect(footer).toHaveClass("rounded-b-xl");
    expect(footer).toBeEmptyDOMElement();
  });

  test("one whose read failed ends the card with the error, as before", () => {
    render(
      table({ rows: [], disablePagination: true, error: "Could not read" }),
    );

    expect(screen.getByTestId("rule-library-table-load-error")).toBeVisible();
    expectBleeding(screen.getByTestId("table-footer"));
  });
});

describe("a table that pages, as before", () => {
  test("its footer is the grey band flush on the card's rounded bottom edge", () => {
    render(table({ rows: ROWS }));

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expectBleeding(footer);
    expect(footer).toHaveClass("bg-gray-50", "overflow-hidden", "rounded-b-xl");
    expect(footer).not.toBeEmptyDOMElement();
  });

  test("in a section of a card the band is square", () => {
    render(inSection(table({ rows: ROWS })));

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expectBleeding(footer);
    expect(footer).not.toHaveClass("rounded-b-xl");
  });

  test("an empty first page has no pagination, and its band still takes the padding", () => {
    render(table({ rows: [] }));

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expectBleeding(footer);
    expect(footer).toBeEmptyDOMElement();
  });
});
