import List, { ComponentProps } from "../../../UI/Components/List/List";
import {
  SurfaceStyle,
  SurfaceStyleProvider,
} from "../../../UI/Contexts/SurfaceStyleContext";
import FieldType from "../../../UI/Components/Types/FieldType";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("List", () => {
  interface ListData {
    id: string;
    name: string;
    description: string;
  }

  const defaultProps: ComponentProps<ListData> = {
    data: [
      {
        id: "1",
        name: "Item 1",
        description: "Description 1",
      },
      {
        id: "2",
        name: "Item 2",
        description: "Description 2",
      },
    ],
    id: "test-list",
    fields: [
      {
        title: "ID",
        key: "id",
        fieldType: FieldType.Text,
        colSpan: 1,
      },
      {
        title: "Name",
        key: "name",
        fieldType: FieldType.Text,
        colSpan: 2,
      },
      {
        title: "Description",
        key: "description",
        fieldType: FieldType.Text,
        colSpan: 2,
      },
    ],
    onNavigateToPage: jest.fn(),
    currentPageNumber: 1,
    totalItemsCount: 10,
    itemsOnPage: 5,
    error: "",
    isLoading: false,
    singularLabel: "Item",
    pluralLabel: "Items",
  };

  it("renders List component with data", () => {
    render(<List {...defaultProps} />);

    expect(screen.getByTestId("list-container")).toBeInTheDocument();
    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<List {...defaultProps} isLoading={true} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
  });

  it("renders error state", () => {
    const messageError: string = "Test error";
    render(<List {...defaultProps} error={messageError} />);

    expect(screen.getByText(messageError)).toBeInTheDocument();
  });

  it("renders error state when data is empty", () => {
    const messageError: string = "There are no items";
    render(<List {...defaultProps} data={[]} noItemsMessage={messageError} />);

    expect(screen.getByText(messageError)).toBeInTheDocument();
  });

  it("renders error state default message when data is empty ", () => {
    const messageError: string = "No item";
    render(<List {...defaultProps} data={[]} />);

    expect(screen.getByText(messageError)).toBeInTheDocument();
  });

  it("handles onNavigateToPage callback", () => {
    render(<List {...defaultProps} />);
    // There are multiple "Next" elements (mobile and desktop), get the first one
    const nextButtons: HTMLElement[] = screen.getAllByText("Next");
    fireEvent.click(nextButtons[0]!);

    expect(defaultProps.onNavigateToPage).toHaveBeenCalledWith(2, 5);
  });

  it("uses card-safe spacing for the quiet dashboard surface", () => {
    render(
      <SurfaceStyleProvider style={SurfaceStyle.Quiet}>
        <List {...defaultProps} />
      </SurfaceStyleProvider>,
    );

    const listContainer: HTMLElement = screen.getByTestId("list-container");
    const pagination: HTMLElement = screen.getByTestId("list-pagination");
    const paginationWrapper: HTMLElement =
      pagination.parentElement as HTMLElement;

    expect(listContainer).toHaveAttribute("data-surface-style", "quiet");
    expect(listContainer.firstElementChild).toHaveClass("mt-3");
    expect(paginationWrapper).toHaveClass("-mb-4", "mt-4");
    expect(pagination).toHaveClass("border-slate-200");
  });
});
