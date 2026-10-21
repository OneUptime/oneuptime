import "@testing-library/jest-dom";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import Table from "../../../UI/Components/Table/Table";
import LocalTable from "../../../UI/Components/Table/LocalTable";
import List from "../../../UI/Components/List/List";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LogsPagination from "../../../UI/Components/LogsViewer/components/LogsPagination";
import TelemetryPagination from "../../../UI/Components/TelemetryViewer/components/TelemetryPagination";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

/*
 * The pagination control is shared, so what is worth testing at this level is
 * the wiring: that every surface that paginates really renders the inline
 * controls, and that the page number and page size each surface speaks in
 * survive the trip through the adapter.
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
}

const columns: Columns<Row> = [
  { title: "Name", type: FieldType.Text, key: "name" },
];

type MakeRowsFunction = (count: number) => Array<Row>;

const makeRows: MakeRowsFunction = (count: number): Array<Row> => {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return { _id: `${index + 1}`, name: `Row ${index + 1}` };
  });
};

describe("Pagination in a Table", () => {
  type RenderTableFunction = (overrides?: {
    currentPageNumber?: number;
    totalItemsCount?: number;
    itemsOnPage?: number;
    itemsOnPageOptions?: Array<number>;
    paginationDataTestId?: string;
    rowCount?: number;
  }) => MockFunction;

  const renderTable: RenderTableFunction = (overrides?: {
    currentPageNumber?: number;
    totalItemsCount?: number;
    itemsOnPage?: number;
    itemsOnPageOptions?: Array<number>;
    paginationDataTestId?: string;
    rowCount?: number;
  }): MockFunction => {
    const onNavigateToPage: MockFunction = getJestMockFunction();

    render(
      <Table<Row>
        id="test-table"
        columns={columns}
        data={makeRows(overrides?.rowCount ?? 10)}
        currentPageNumber={overrides?.currentPageNumber ?? 1}
        totalItemsCount={overrides?.totalItemsCount ?? 240}
        itemsOnPage={overrides?.itemsOnPage ?? 10}
        itemsOnPageOptions={overrides?.itemsOnPageOptions}
        paginationDataTestId={overrides?.paginationDataTestId}
        onNavigateToPage={
          onNavigateToPage as unknown as (
            pageNumber: number,
            itemsOnPage: number,
          ) => void
        }
        error=""
        isLoading={false}
        singularLabel="Monitor"
        pluralLabel="Monitors"
        sortBy={null}
        sortOrder={SortOrder.Ascending}
        onSortChanged={() => {}}
      />,
    );

    return onNavigateToPage;
  };

  it("shows the page size on the page, not behind a menu", () => {
    renderTable();

    expect(screen.getByLabelText("Rows per page")).toBeInTheDocument();
    expect(screen.queryByTestId("show-pagination-modal-button")).toBeNull();
  });

  it("changes the page size from the table footer", () => {
    const onNavigateToPage: MockFunction = renderTable();

    fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
      target: { value: "25" },
    });

    expect(onNavigateToPage).toHaveBeenCalledWith(1, 25);
  });

  it("forwards a consumer's page sizes and stable id to the shared footer", () => {
    renderTable({
      itemsOnPage: 20,
      itemsOnPageOptions: [20, 50, 100],
      paginationDataTestId: "custom-table-pagination",
    });

    expect(screen.getByTestId("custom-table-pagination")).toBeInTheDocument();
    expect(
      Array.from(
        screen
          .getByTestId("pagination-items-on-page-select")
          .querySelectorAll("option"),
      ).map((option: Element): string | null => {
        return option.getAttribute("value");
      }),
    ).toEqual(["20", "50", "100"]);
  });

  it("jumps straight to a page from the table footer", () => {
    const onNavigateToPage: MockFunction = renderTable();

    fireEvent.click(screen.getByTestId("pagination-page-3"));

    expect(onNavigateToPage).toHaveBeenCalledWith(3, 10);
  });

  /*
   * The table is the caller that knows how many rows it actually drew, which
   * is what keeps the last page of a list from over-reporting its range.
   */
  it("reports the range from the rows the table drew", () => {
    renderTable({
      currentPageNumber: 24,
      totalItemsCount: 236,
      rowCount: 6,
    });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 231-236 of 236 monitors",
    );
  });

  /*
   * An empty table's own empty state says there is nothing; a footer reading
   * "No monitors" under "No monitors yet" said it twice, so the footer is
   * left out of an empty first page.
   */
  it("leaves the footer out when the table is empty", () => {
    renderTable({ totalItemsCount: 0, rowCount: 0 });

    expect(screen.queryByTestId("pagination-summary")).toBeNull();
    expect(screen.queryByTestId("pagination-next-button")).toBeNull();
  });

  it("keeps the footer on an empty later page, with nothing to page forward to", () => {
    renderTable({ currentPageNumber: 3, totalItemsCount: 20, rowCount: 0 });

    expect(screen.getByTestId("pagination-summary")).toBeInTheDocument();
    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  it("draws the full-size bar under a table", () => {
    renderTable();

    expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
      "h-7",
      "w-7",
    );
    expect(screen.getByTestId("pagination-items-on-page-select")).toHaveClass(
      "h-7",
    );
  });

  /*
   * The footer sits flush on the card's rounded bottom edge. The bar inside
   * it is a white rectangle, and with nothing clipping it its square corners
   * painted over the card's rounded corners and border.
   */
  it("clips the bar to the card's rounded bottom corners", () => {
    renderTable();

    const footer: HTMLElement = screen.getByRole("navigation").parentElement!;

    expect(footer).toHaveClass("rounded-b-xl", "overflow-hidden");
  });

  it("still opens the jump dialog out of the clipped footer", () => {
    renderTable({ currentPageNumber: 12 });

    fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

    // The dialog is fixed to the viewport, which overflow does not clip.
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(screen.getByTestId("modal").closest(".fixed")).not.toBeNull();
  });
});

describe("Pagination in a List", () => {
  interface Item {
    id: string;
    name: string;
  }

  it("draws the full-size bar and pages the list", () => {
    const onNavigateToPage: MockFunction = getJestMockFunction();

    render(
      <List<Item>
        id="test-list"
        data={[
          { id: "1", name: "First" },
          { id: "2", name: "Second" },
        ]}
        fields={[{ title: "Name", key: "name", fieldType: FieldType.Text }]}
        onNavigateToPage={
          onNavigateToPage as unknown as (
            pageNumber: number,
            itemsOnPage: number,
          ) => void
        }
        currentPageNumber={1}
        totalItemsCount={12}
        itemsOnPage={5}
        error=""
        isLoading={false}
        singularLabel="Item"
        pluralLabel="Items"
      />,
    );

    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-2 of 12 items",
    );
    expect(screen.getByTestId("pagination-next-button")).toHaveClass("h-7");

    fireEvent.click(screen.getByTestId("pagination-next-button"));

    expect(onNavigateToPage).toHaveBeenCalledWith(2, 5);
  });
});

describe("Pagination in a LocalTable", () => {
  it("really pages through the data it was given", () => {
    render(
      <LocalTable<Row>
        id="local-table"
        columns={columns}
        data={makeRows(25)}
        singularLabel="Row"
        pluralLabel="Rows"
      />,
    );

    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.queryByText("Row 11")).toBeNull();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-10 of 25 rows",
    );

    fireEvent.click(screen.getByTestId("pagination-page-2"));

    expect(screen.getByText("Row 11")).toBeInTheDocument();
    expect(screen.queryByText("Row 1")).toBeNull();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 11-20 of 25 rows",
    );
  });

  it("shows the short last page without over-reporting it", () => {
    render(
      <LocalTable<Row>
        id="local-table"
        columns={columns}
        data={makeRows(25)}
        singularLabel="Row"
        pluralLabel="Rows"
      />,
    );

    fireEvent.click(screen.getByTestId("pagination-page-3"));

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 21-25 of 25 rows",
    );
    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  it("re-slices the data when the page size changes", () => {
    render(
      <LocalTable<Row>
        id="local-table"
        columns={columns}
        data={makeRows(25)}
        singularLabel="Row"
        pluralLabel="Rows"
      />,
    );

    fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
      target: { value: "25" },
    });

    expect(screen.getByText("Row 25")).toBeInTheDocument();
    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-25 of 25 rows",
    );
  });
});

describe("LogsPagination", () => {
  type RenderLogsPaginationFunction = (overrides?: {
    currentPage?: number;
    totalItems?: number;
    pageSize?: number;
    isDisabled?: boolean;
  }) => { onPageChange: MockFunction; onPageSizeChange: MockFunction };

  const renderLogsPagination: RenderLogsPaginationFunction = (overrides?: {
    currentPage?: number;
    totalItems?: number;
    pageSize?: number;
    isDisabled?: boolean;
  }): { onPageChange: MockFunction; onPageSizeChange: MockFunction } => {
    const onPageChange: MockFunction = getJestMockFunction();
    const onPageSizeChange: MockFunction = getJestMockFunction();

    render(
      <LogsPagination
        currentPage={overrides?.currentPage ?? 1}
        totalItems={overrides?.totalItems ?? 500}
        pageSize={overrides?.pageSize ?? 50}
        pageSizeOptions={[50, 100, 250]}
        onPageChange={onPageChange as unknown as (page: number) => void}
        onPageSizeChange={onPageSizeChange as unknown as (size: number) => void}
        isDisabled={overrides?.isDisabled ?? false}
      />,
    );

    return { onPageChange: onPageChange, onPageSizeChange: onPageSizeChange };
  };

  it("prints the range in logs", () => {
    renderLogsPagination();

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-50 of 500 logs",
    );
  });

  it("offers only the page sizes the viewer supports", () => {
    renderLogsPagination();

    const options: Array<HTMLOptionElement> = Array.from(
      screen
        .getByTestId("pagination-items-on-page-select")
        .querySelectorAll("option"),
    );

    expect(
      options.map((option: HTMLOptionElement) => {
        return option.value;
      }),
    ).toEqual(["50", "100", "250"]);
  });

  it("jumps to a page", () => {
    const { onPageChange, onPageSizeChange } = renderLogsPagination();

    fireEvent.click(screen.getByTestId("pagination-page-3"));

    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(onPageSizeChange).not.toHaveBeenCalled();
  });

  it("jumps to a page in between from the collapsed gap", () => {
    const { onPageChange } = renderLogsPagination();

    fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));
    fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onPageChange).toHaveBeenCalledWith(7);
  });

  /*
   * The viewer takes the page and the page size through two callbacks, so a
   * resize has to report both the new size and the return to page one.
   */
  it("reports a resize as a size change and a return to page one", () => {
    const { onPageChange, onPageSizeChange } = renderLogsPagination({
      currentPage: 5,
    });

    fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
      target: { value: "250" },
    });

    expect(onPageSizeChange).toHaveBeenCalledWith(250);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("freezes while the viewer is busy", () => {
    renderLogsPagination({ isDisabled: true });

    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    expect(
      screen.getByTestId("pagination-items-on-page-select"),
    ).toBeDisabled();
  });

  it("draws the compact bar under the denser logs view", () => {
    renderLogsPagination();

    expect(screen.getByTestId("logs-pagination")).toHaveClass(
      "py-2",
      "bg-gray-50/50",
    );
    expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
      "h-6",
      "w-6",
    );
    expect(screen.getByTestId("pagination-items-on-page-select")).toHaveClass(
      "h-6",
    );
  });
});

describe("TelemetryPagination", () => {
  type RenderTelemetryPaginationFunction = (overrides?: {
    currentPage?: number;
    totalItems?: number;
    itemLabel?: string;
  }) => MockFunction;

  const renderTelemetryPagination: RenderTelemetryPaginationFunction =
    (overrides?: {
      currentPage?: number;
      totalItems?: number;
      itemLabel?: string;
    }): MockFunction => {
      const onPageChange: MockFunction = getJestMockFunction();

      render(
        <TelemetryPagination
          currentPage={overrides?.currentPage ?? 1}
          totalItems={overrides?.totalItems ?? 240}
          pageSize={20}
          pageSizeOptions={[20, 50, 100]}
          onPageChange={onPageChange as unknown as (page: number) => void}
          onPageSizeChange={() => {}}
          itemLabel={overrides?.itemLabel ?? "traces"}
        />,
      );

      return onPageChange;
    };

  it("prints the range in the caller's own words", () => {
    renderTelemetryPagination();

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1-20 of 240 traces",
    );
  });

  it("uses the singular for a result set of one", () => {
    renderTelemetryPagination({ totalItems: 1 });

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "Showing 1 of 1 trace",
    );
  });

  it("falls back to a generic label", () => {
    render(
      <TelemetryPagination
        currentPage={1}
        totalItems={0}
        pageSize={20}
        pageSizeOptions={[20]}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    );

    expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
      "No results",
    );
  });

  it("jumps to the last page in one click", () => {
    const onPageChange: MockFunction = renderTelemetryPagination();

    fireEvent.click(screen.getByTestId("pagination-page-12"));

    expect(onPageChange).toHaveBeenCalledWith(12);
  });

  it("draws the compact bar under the traces view", () => {
    renderTelemetryPagination();

    expect(screen.getByTestId("telemetry-pagination")).toHaveClass("py-2");
    expect(screen.getByTestId("pagination-next-button")).toHaveClass(
      "h-6",
      "w-6",
    );
  });
});
