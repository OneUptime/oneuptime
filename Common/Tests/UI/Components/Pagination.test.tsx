import Pagination, {
  ComponentProps,
} from "../../../UI/Components/Pagination/Pagination";
import { describe, expect, jest } from "@jest/globals";
import "@testing-library/jest-dom/extend-expect";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

describe("Pagination", () => {
  it("renders Component", () => {
    const props: ComponentProps = {
      currentPageNumber: 1,
      totalItemsCount: 20,
      itemsOnPage: 10,
      onNavigateToPage: jest.fn(),
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    expect(
      screen.getByText(/Showing 1 to 10 on this page/i),
    ).toBeInTheDocument();
  });

  it("renders with 1 item", () => {
    const props: ComponentProps = {
      currentPageNumber: 1,
      totalItemsCount: 1,
      itemsOnPage: 10,
      onNavigateToPage: jest.fn(),
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    expect(screen.getByText(/1 Item/i)).toBeInTheDocument();
  });

  it("calls onNavigateToPage when Next link is clicked", async () => {
    const mockOnNavigateToPage: MockFunction = getJestMockFunction();
    const props: ComponentProps = {
      currentPageNumber: 1,
      totalItemsCount: 19,
      itemsOnPage: 10,
      onNavigateToPage: mockOnNavigateToPage,
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    // There are multiple "Next" elements (mobile and desktop), get the first one
    const nextButtons: HTMLElement[] = screen.getAllByText("Next");
    fireEvent.click(nextButtons[0]!);

    await waitFor(() => {
      expect(mockOnNavigateToPage).toHaveBeenCalledWith(2, 10);
    });
  });

  it("calls onNavigateToPage when Previous link is clicked", async () => {
    const mockOnNavigateToPage: MockFunction = getJestMockFunction();
    const props: ComponentProps = {
      currentPageNumber: 2,
      totalItemsCount: 19,
      itemsOnPage: 10,
      onNavigateToPage: mockOnNavigateToPage,
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    // There are multiple "Previous" elements (mobile and desktop), get the first one
    const prevButtons: HTMLElement[] = screen.getAllByText("Previous");
    fireEvent.click(prevButtons[0]!);

    await waitFor(() => {
      expect(mockOnNavigateToPage).toHaveBeenCalledWith(1, 10);
    });
  });

  it("shows Pagination Modal when button modal is clicked", async () => {
    const props: ComponentProps = {
      currentPageNumber: 1,
      totalItemsCount: 0,
      itemsOnPage: 10,
      onNavigateToPage: jest.fn(),
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    fireEvent.click(screen.getByTestId("show-pagination-modal-button"));

    await waitFor(() => {
      expect(screen.getByText("Navigate to Page")).toBeInTheDocument();
    });
  });

  it("shows Pagination Modal when current page link is clicked", async () => {
    const props: ComponentProps = {
      currentPageNumber: 2,
      totalItemsCount: 19,
      itemsOnPage: 10,
      onNavigateToPage: jest.fn(),
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    fireEvent.click(screen.getByTestId("current-page-link"));

    await waitFor(() => {
      expect(screen.getByText("Navigate to Page")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("pagination-modal")).toBeNull();
    });
  });

  it("shows Pagination Modal and submit with go to page", async () => {
    const mockOnNavigateToPage: MockFunction = getJestMockFunction();
    const props: ComponentProps = {
      currentPageNumber: 1,
      totalItemsCount: 20,
      itemsOnPage: 10,
      onNavigateToPage: mockOnNavigateToPage,
      isLoading: false,
      isError: false,
      singularLabel: "Item",
      pluralLabel: "Items",
    };

    render(<Pagination {...props} />);

    fireEvent.click(screen.getByTestId("current-page-link"));

    await waitFor(() => {
      expect(screen.getByText("Navigate to Page")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Go to Page"));

    await waitFor(() => {
      expect(mockOnNavigateToPage).toHaveBeenCalledWith(1, 10);
    });
  });
});
