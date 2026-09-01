import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import Table from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * Two things a table owes anyone not driving it with a mouse on a wide screen.
 *
 * Sorting was mouse-only: the handler sat on the <th>, which is not focusable
 * and does not answer Enter or Space, even though aria-sort was already
 * telling assistive technology the column WAS sortable. It sits on a button
 * inside the header cell now.
 *
 * And `hideOnMobile` - about 200 column declarations across the product say
 * it - was honoured by the header, the skeleton rows, and the desktop row, but
 * not by the mobile card, which is the one layout it exists for.
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
  status?: string | undefined;
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
  { title: "Status", type: FieldType.Text, key: "status", hideOnMobile: true },
  // No key, so this one is not sortable and must stay a plain cell.
  { title: "Notes", type: FieldType.Text },
];

const data: Array<Row> = [
  { _id: "1", name: "Alpha", status: "Up" },
  { _id: "2", name: "Beta", status: "Down" },
];

interface RenderTableOptions {
  sortBy?: keyof Row | null | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChanged?:
    | ((sortBy: keyof Row | null, sortOrder: SortOrder) => void)
    | undefined;
}

type RenderTableFunction = (options?: RenderTableOptions | undefined) => void;

const renderTable: RenderTableFunction = (
  options?: RenderTableOptions | undefined,
): void => {
  render(
    <Table<Row>
      id="test-table"
      data={data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={options?.sortOrder ?? SortOrder.Ascending}
      sortBy={options?.sortBy ?? null}
      onSortChanged={options?.onSortChanged ?? (() => {})}
      onNavigateToPage={() => {}}
    />,
  );
};

/*
 * The table decides mobile vs desktop from window.innerWidth at mount
 * (< 768 = mobile). jsdom defaults to 1024, so desktop is the baseline and
 * mobile tests must set the width BEFORE rendering.
 */
const setViewportWidth: (width: number) => void = (width: number): void => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
});

describe("sortable column headers", () => {
  test("a sortable header is a real button, so it is focusable", () => {
    renderTable();

    const sortButton: HTMLElement = screen.getByRole("button", {
      name: "Name",
    });

    expect(sortButton.tagName).toBe("BUTTON");
    expect(sortButton).toHaveAttribute("type", "button");

    sortButton.focus();
    expect(sortButton).toHaveFocus();
  });

  test("activating the header button sorts the column", () => {
    const sortCalls: Array<[keyof Row | null, SortOrder]> = [];

    renderTable({
      onSortChanged: (sortBy: keyof Row | null, sortOrder: SortOrder) => {
        sortCalls.push([sortBy, sortOrder]);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Name" }));

    expect(sortCalls).toEqual([["name", SortOrder.Descending]]);
  });

  test("the sort direction still round-trips", () => {
    const sortCalls: Array<[keyof Row | null, SortOrder]> = [];

    renderTable({
      sortBy: "name",
      sortOrder: SortOrder.Descending,
      onSortChanged: (sortBy: keyof Row | null, sortOrder: SortOrder) => {
        sortCalls.push([sortBy, sortOrder]);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));

    expect(sortCalls).toEqual([["name", SortOrder.Ascending]]);
  });

  test("a column that cannot be sorted gets no button", () => {
    renderTable();

    expect(
      screen.queryByRole("button", { name: "Notes" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  test("the header still announces sort state to assistive technology", () => {
    renderTable({ sortBy: "name", sortOrder: SortOrder.Ascending });

    const headers: Array<HTMLElement> = screen.getAllByRole("columnheader");
    const nameHeader: HTMLElement | undefined = headers.find(
      (header: HTMLElement) => {
        return header.textContent?.includes("Name");
      },
    );

    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  });
});

describe("hideOnMobile columns", () => {
  test("the mobile card leaves out columns marked hideOnMobile", () => {
    setViewportWidth(375);
    renderTable();

    // "Name" is shown on every breakpoint.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);

    /*
     * "Status" is hideOnMobile. Its header is already filtered out on mobile;
     * the row used to render it anyway, which is the regression this pins.
     */
    expect(screen.queryByText("Up")).not.toBeInTheDocument();
    expect(screen.queryByText("Down")).not.toBeInTheDocument();
  });

  test("the desktop row is untouched", () => {
    setViewportWidth(1280);
    renderTable();

    expect(screen.getByText("Up")).toBeInTheDocument();
    expect(screen.getByText("Down")).toBeInTheDocument();
  });
});
