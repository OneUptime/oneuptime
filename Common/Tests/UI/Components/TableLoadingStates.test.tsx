import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import Table, { BulkActionProps } from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";

/*
 * The table's four loading-adjacent faces, and the order they win in.
 *
 * A first load has nothing to show, so it shows the SHAPE of what is coming:
 * skeleton rows whose cell structure mirrors the header exactly (drag handle,
 * bulk checkbox, one cell per visible column). A refetch DOES have something
 * to show - the parent never clears `data` while fetching - so the stale rows
 * stay on screen, dimmed and unclickable, instead of being torn down to
 * placeholders. Error and empty only speak once loading has finished; a stale
 * error surfacing mid-refetch over live rows was the bug this priority
 * prevents.
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
];

const data: Array<Row> = [
  { _id: "1", name: "Alpha", status: "Up" },
  { _id: "2", name: "Beta", status: "Down" },
];

const bulkActions: BulkActionProps<Row> = {
  buttons: [
    {
      title: "Archive",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  ],
};

interface RenderTableOptions {
  data?: Array<Row> | undefined;
  isLoading?: boolean | undefined;
  error?: string | undefined;
  itemsOnPage?: number | undefined;
  enableDragAndDrop?: boolean | undefined;
  withBulkActions?: boolean | undefined;
  noItemsMessage?: string | undefined;
}

type RenderTableFunction = (options: RenderTableOptions) => void;

const renderTable: RenderTableFunction = (
  options: RenderTableOptions,
): void => {
  render(
    <Table<Row>
      id="test-table"
      data={options.data ?? data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={(options.data ?? data).length}
      itemsOnPage={options.itemsOnPage ?? 10}
      error={options.error ?? ""}
      isLoading={options.isLoading ?? false}
      singularLabel="Monitor"
      pluralLabel="Monitors"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={() => {}}
      onNavigateToPage={() => {}}
      noItemsMessage={options.noItemsMessage}
      enableDragAndDrop={options.enableDragAndDrop}
      matchBulkSelectedItemByField={options.withBulkActions ? "_id" : undefined}
      bulkActions={options.withBulkActions ? bulkActions : undefined}
      bulkSelectedItems={options.withBulkActions ? [] : undefined}
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

describe("first load (nothing to show yet)", () => {
  test("renders skeleton rows instead of a spinner", () => {
    renderTable({ isLoading: true, data: [] });

    expect(screen.getByTestId("table-skeleton-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("component-loader")).toBeNull();
  });

  test("announces itself as a polite status with a Loading label", () => {
    renderTable({ isLoading: true, data: [] });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    expect(loader).toHaveAttribute("role", "status");
    expect(loader).toHaveAttribute("aria-live", "polite");
    expect(loader).toHaveTextContent("Loading");
  });

  test("renders one skeleton row per item on the page", () => {
    renderTable({ isLoading: true, data: [], itemsOnPage: 5 });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    expect(loader.querySelectorAll("tr")).toHaveLength(5);
  });

  test("caps skeleton rows at 10 even for a 25-row page", () => {
    renderTable({ isLoading: true, data: [], itemsOnPage: 25 });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    expect(loader.querySelectorAll("tr")).toHaveLength(10);
  });

  test("a plain table gets one skeleton cell per column", () => {
    renderTable({ isLoading: true, data: [] });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    const firstRow: Element = loader.querySelectorAll("tr")[0] as Element;
    expect(firstRow.querySelectorAll("td")).toHaveLength(columns.length);
  });

  /*
   * The header renders extra leading cells for the drag handle and the bulk
   * checkbox. Skeleton rows must mirror them or every placeholder sits one
   * or two columns to the left of the header it is standing in for.
   */
  test("drag and bulk each add their leading skeleton cell", () => {
    renderTable({
      isLoading: true,
      data: [],
      enableDragAndDrop: true,
      withBulkActions: true,
    });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    const firstRow: Element = loader.querySelectorAll("tr")[0] as Element;
    expect(firstRow.querySelectorAll("td")).toHaveLength(columns.length + 2);
  });

  test("skeleton cells carry the real rows' padding classes", () => {
    renderTable({ isLoading: true, data: [] });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    const cells: NodeListOf<Element> = loader
      .querySelectorAll("tr")[0]!
      .querySelectorAll("td");

    // Same classes as TableRow's cells: last cell gets pr-6, the rest pr-3.
    expect(cells[0]).toHaveClass("py-4", "pl-4", "pr-3", "whitespace-nowrap");
    expect(cells[cells.length - 1]).toHaveClass("pr-6");
  });
});

describe("mobile first load", () => {
  test("renders a card-shaped stack, not table markup inside a div", () => {
    setViewportWidth(500);
    renderTable({ isLoading: true, data: [], itemsOnPage: 5 });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    expect(loader.tagName).toBe("DIV");
    /*
     * The old loader emitted a <tbody> into the mobile <div> wrapper -
     * invalid HTML that React happened to tolerate. Nothing table-shaped
     * may remain on mobile.
     */
    expect(document.querySelector("tbody")).toBeNull();
    expect(loader.querySelectorAll(":scope > div")).toHaveLength(5);
  });

  test("hideOnMobile columns get no placeholder line", () => {
    setViewportWidth(500);
    renderTable({ isLoading: true, data: [], itemsOnPage: 3 });

    const loader: HTMLElement = screen.getByTestId("table-skeleton-loader");
    const firstCard: Element = loader.querySelectorAll(
      ":scope > div",
    )[0] as Element;

    // One label/value group per VISIBLE column: Status is hideOnMobile.
    expect(firstCard.querySelectorAll(".flex.flex-col")).toHaveLength(1);
  });
});

describe("refetch with rows already on screen", () => {
  test("keeps the real rows and shows no skeletons", () => {
    renderTable({ isLoading: true });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByTestId("table-skeleton-loader")).toBeNull();
  });

  test("dims the stale rows and blocks pointer events on them", () => {
    renderTable({ isLoading: true });

    const content: HTMLElement = screen.getByTestId("table-content");
    expect(content).toHaveClass("opacity-60");
    expect(content).toHaveClass("pointer-events-none");
  });

  test("an idle table is neither dimmed nor blocked", () => {
    renderTable({});

    const content: HTMLElement = screen.getByTestId("table-content");
    expect(content).not.toHaveClass("opacity-60");
    expect(content).not.toHaveClass("pointer-events-none");
  });

  /*
   * Loading outranks error: mid-refetch the error prop can only be stale
   * (the parent clears it before every fetch), so surfacing it over live
   * rows would report a failure that is not happening.
   */
  test("a stale error does not interrupt the dimmed rows", () => {
    renderTable({ isLoading: true, error: "stale failure" });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("stale failure")).toBeNull();
  });
});

describe("after loading finishes", () => {
  test("an error replaces the rows", () => {
    renderTable({ isLoading: false, error: "Something went wrong" });

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByTestId("table-skeleton-loader")).toBeNull();
  });

  test("an empty result shows the no-items message, not skeletons", () => {
    renderTable({
      isLoading: false,
      data: [],
      noItemsMessage: "No monitors here",
    });

    expect(screen.getByText("No monitors here")).toBeInTheDocument();
    expect(screen.queryByTestId("table-skeleton-loader")).toBeNull();
  });
});
