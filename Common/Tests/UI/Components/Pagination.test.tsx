import Pagination, {
  ComponentProps,
} from "../../../UI/Components/Pagination/Pagination";
import {
  SurfaceStyle,
  SurfaceStyleProvider,
} from "../../../UI/Contexts/SurfaceStyleContext";
import { describe, jest } from "@jest/globals";
import "@testing-library/jest-dom";
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

  it("renders compact quiet controls and keeps navigation working", async () => {
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

    render(
      <SurfaceStyleProvider style={SurfaceStyle.Quiet}>
        <Pagination {...props} />
      </SurfaceStyleProvider>,
    );

    const pagination: HTMLElement = screen.getByRole("navigation", {
      name: "Pagination for Items",
    });
    const summary: HTMLElement = screen
      .getByText(/Showing 1 to 10 on this page/i)
      .closest("p") as HTMLElement;
    const nextButton: HTMLElement = screen.getAllByRole("button", {
      name: "Go to next page",
    })[0]!;
    const controls: HTMLElement = nextButton.closest(
      ".shadow-none",
    ) as HTMLElement;

    expect(pagination).toHaveClass("min-h-12", "border-slate-200", "bg-white");
    expect(summary).toHaveClass("text-xs", "text-slate-500");
    expect(controls).toBeInTheDocument();
    expect(nextButton).toHaveClass("text-xs", "text-slate-600");

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(mockOnNavigateToPage).toHaveBeenCalledWith(2, 10);
    });
  });
});
