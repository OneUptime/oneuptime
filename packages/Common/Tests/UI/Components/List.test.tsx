import List, { ComponentProps } from "../../../UI/Components/List/List";
import FieldType from "../../../UI/Components/Types/FieldType";
import { TableEmptyStateKind } from "../../../UI/Components/Table/TableEmptyState";
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

  it("renders skeleton cards while loading with nothing to show yet", () => {
    render(<List {...defaultProps} isLoading={true} data={[]} />);

    expect(screen.getByTestId("list-skeleton-loader")).toBeInTheDocument();
  });

  it("keeps existing cards visible, dimmed, while refetching", () => {
    render(<List {...defaultProps} isLoading={true} />);

    expect(screen.queryByTestId("list-skeleton-loader")).toBeNull();
    expect(screen.getByTestId("list-content")).toHaveClass("opacity-60");
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

  /*
   * The list's own title, from its plural label - it used to read "No item",
   * the singular, lower-cased, with no word on what to do.
   */
  it("heads an empty list with its own 'No <plural> yet'", () => {
    render(<List {...defaultProps} data={[]} />);

    expect(screen.getByText("No items yet")).toBeInTheDocument();
    expect(screen.queryByText("No item")).toBeNull();
    expect(screen.getByTestId("test-list-no-items")).toBeInTheDocument();
  });

  it("splits a page's own message into a title and a description", () => {
    render(
      <List
        {...defaultProps}
        data={[]}
        noItemsMessage="No escalation rules yet. Add one to start calling people."
      />,
    );

    expect(screen.getByTestId("table-empty-state-title")).toHaveTextContent(
      /^No escalation rules yet$/,
    );
    expect(
      screen.getByTestId("table-empty-state-description"),
    ).toHaveTextContent("Add one to start calling people.");
  });

  it("draws a page's own element as given", () => {
    render(
      <List
        {...defaultProps}
        data={[]}
        noItemsMessage={<div data-testid="own-empty">Nothing</div>}
      />,
    );

    expect(screen.getByTestId("own-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("table-empty-state")).toBeNull();
  });

  it("a fully built empty state wins over the message", () => {
    render(
      <List
        {...defaultProps}
        data={[]}
        noItemsMessage="ignored"
        emptyStateProps={{
          kind: TableEmptyStateKind.AllClear,
          title: "All clear",
        }}
      />,
    );

    expect(screen.getByTestId("table-empty-state")).toHaveAttribute(
      "data-empty-state-kind",
      TableEmptyStateKind.AllClear,
    );
    expect(screen.queryByText("ignored")).toBeNull();
  });

  it("an empty list has no Refresh? link", () => {
    render(<List {...defaultProps} data={[]} onRefreshClick={() => {}} />);

    expect(screen.queryByText("Refresh?")).toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });

  it("an empty first page leaves the footer out, and the list's grey runs on", () => {
    render(<List {...defaultProps} data={[]} totalItemsCount={0} />);

    expect(screen.queryByTestId("list-pagination")).toBeNull();
    expect(
      screen
        .getByTestId("list-container")
        .querySelector(".rounded-b-xl.bg-gray-50"),
    ).not.toBeNull();
  });

  it("a later empty page keeps the footer, as the way back", () => {
    render(
      <List
        {...defaultProps}
        data={[]}
        currentPageNumber={3}
        totalItemsCount={20}
      />,
    );

    expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
  });

  it("a failed load is its own state, with Try again", () => {
    let retries: number = 0;

    render(
      <List
        {...defaultProps}
        data={[]}
        error="The server took too long to answer."
        onRefreshClick={() => {
          retries++;
        }}
      />,
    );

    const block: HTMLElement = screen.getByTestId("test-list-load-error");

    expect(block).toHaveTextContent("Couldn't load items");
    expect(block).toHaveTextContent("The server took too long to answer.");

    fireEvent.click(screen.getByTestId("refresh-button"));
    expect(retries).toBe(1);
  });

  it("filter-form values that hide every card say nothing matches, and clear", () => {
    const changes: Array<unknown> = [];

    render(
      <List
        {...defaultProps}
        data={[]}
        filterData={{ name: "zzz" }}
        onFilterChanged={(filterData: unknown) => {
          changes.push(filterData);
        }}
      />,
    );

    expect(screen.getByTestId("table-empty-state")).toHaveAttribute(
      "data-empty-state-kind",
      TableEmptyStateKind.Filtered,
    );

    fireEvent.click(screen.getByTestId("empty-table-clear-filters-button"));
    expect(changes).toEqual([{}]);
  });

  it("handles onNavigateToPage callback", () => {
    render(<List {...defaultProps} />);

    fireEvent.click(screen.getByTestId("pagination-next-button"));

    expect(defaultProps.onNavigateToPage).toHaveBeenCalledWith(2, 5);
  });

  it("jumps straight to a page from the list footer", () => {
    render(<List {...defaultProps} />);

    fireEvent.click(screen.getByTestId("pagination-page-2"));

    expect(defaultProps.onNavigateToPage).toHaveBeenCalledWith(2, 5);
  });

  it("changes the page size from the list footer", () => {
    render(<List {...defaultProps} />);

    fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
      target: { value: "25" },
    });

    expect(defaultProps.onNavigateToPage).toHaveBeenCalledWith(1, 25);
  });
});
