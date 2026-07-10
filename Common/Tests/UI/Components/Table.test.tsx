import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import FieldType from "../../../UI/Components/Types/FieldType";
import Table, { ComponentProps } from "../../../UI/Components/Table/Table";
import {
  SurfaceStyle,
  SurfaceStyleProvider,
} from "../../../UI/Contexts/SurfaceStyleContext";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { jest } from "@jest/globals";

describe("Table", () => {
  interface TableItem {
    name: string;
  }

  const getProps: () => ComponentProps<TableItem> = () => {
    return {
      data: [{ name: "API service" }],
      id: "services-table",
      columns: [
        {
          title: "Name",
          key: "name",
          type: FieldType.Text,
        },
      ],
      onNavigateToPage: jest.fn(),
      currentPageNumber: 1,
      totalItemsCount: 2,
      itemsOnPage: 1,
      error: "",
      isLoading: false,
      singularLabel: "Service",
      pluralLabel: "Services",
      sortOrder: SortOrder.Ascending,
      sortBy: null,
      onSortChanged: jest.fn(),
    };
  };

  it("preserves the default table surface", () => {
    render(<Table<TableItem> {...getProps()} />);

    expect(screen.getByRole("table")).toHaveClass("divide-gray-200");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass(
      "py-3",
      "text-gray-900",
    );
    expect(screen.getByRole("cell", { name: "API service" })).toHaveClass(
      "py-4",
      "text-gray-500",
    );
  });

  it("renders a quiet model table and keeps sorting and pagination working", () => {
    const props: ComponentProps<TableItem> = getProps();

    render(
      <SurfaceStyleProvider style={SurfaceStyle.Quiet}>
        <Table<TableItem> {...props} />
      </SurfaceStyleProvider>,
    );

    const table: HTMLElement = screen.getByRole("table");
    const tableHeader: HTMLElement = table.querySelector(
      "thead",
    ) as HTMLElement;
    const tableBody: HTMLElement = table.querySelector("tbody") as HTMLElement;
    const columnHeader: HTMLElement = screen.getByRole("columnheader", {
      name: "Name",
    });
    const cell: HTMLElement = screen.getByRole("cell", {
      name: "API service",
    });
    const row: HTMLElement = cell.closest("tr") as HTMLElement;
    const tableContainer: HTMLElement = table.parentElement as HTMLElement;
    const nextButton: HTMLElement = screen.getAllByRole("button", {
      name: "Go to next page",
    })[0]!;

    expect(table).toHaveClass("divide-slate-200");
    expect(tableHeader).toHaveClass("bg-slate-50");
    expect(tableBody).toHaveClass("divide-slate-100");
    expect(tableContainer).toHaveClass("border-t", "border-slate-200");
    expect(tableContainer).not.toHaveClass("border-b", "border-y");
    expect(row).toHaveClass("hover:bg-slate-50/70");
    expect(columnHeader).toHaveClass("py-2.5", "text-slate-500");
    expect(cell).toHaveClass("py-3", "text-slate-600");
    expect(
      screen.getByRole("navigation", { name: "Pagination for Services" }),
    ).toHaveClass("min-h-12", "border-slate-200");

    fireEvent.click(columnHeader);
    expect(props.onSortChanged).toHaveBeenCalledWith(
      "name",
      SortOrder.Descending,
    );

    fireEvent.click(nextButton);
    expect(props.onNavigateToPage).toHaveBeenCalledWith(2, 1);
  });
});
