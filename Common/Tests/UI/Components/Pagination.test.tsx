import Pagination, {
  ComponentProps,
} from "../../../UI/Components/Pagination/Pagination";
import { describe, expect, it, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";

type RenderPaginationFunction = (
  overrides?: Partial<ComponentProps>,
) => MockFunction;

const baseProps: ComponentProps = {
  currentPageNumber: 1,
  totalItemsCount: 240,
  itemsOnPage: 10,
  onNavigateToPage: jest.fn(),
  isLoading: false,
  isError: false,
  singularLabel: "Monitor",
  pluralLabel: "Monitors",
};

/*
 * Renders the control and hands back the navigate spy, which is what almost
 * every assertion below is really about.
 */
const renderPagination: RenderPaginationFunction = (
  overrides?: Partial<ComponentProps>,
): MockFunction => {
  const onNavigateToPage: MockFunction = getJestMockFunction();

  render(
    <Pagination
      {...baseProps}
      onNavigateToPage={onNavigateToPage}
      {...overrides}
    />,
  );

  return onNavigateToPage;
};

describe("Pagination", () => {
  describe("summary", () => {
    it("prints the range and the total", () => {
      renderPagination();

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 1-10 of 240 monitors",
      );
    });

    it("offsets the range by the pages already passed", () => {
      renderPagination({ currentPageNumber: 4, itemsOnPage: 25 });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 76-100 of 240 monitors",
      );
    });

    /*
     * The label used to multiply the page number by the page size, so the
     * last page of a 19-row list claimed to be showing rows 11 to 20.
     */
    it("stops the last page at the last row that exists", () => {
      renderPagination({ currentPageNumber: 2, totalItemsCount: 19 });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 11-19 of 19 monitors",
      );
    });

    it("uses the singular label for a list of one", () => {
      renderPagination({ totalItemsCount: 1 });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 1 of 1 monitor",
      );
    });

    it("says so when there is nothing to show", () => {
      renderPagination({ totalItemsCount: 0 });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "No monitors",
      );
    });

    it("groups the digits of a large total", () => {
      renderPagination({ totalItemsCount: 1234567 });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        `Showing 1-10 of ${(1234567).toLocaleString()} monitors`,
      );
    });

    it("clamps the range to the rows the page rendered", () => {
      renderPagination({
        currentPageNumber: 24,
        totalItemsCount: 236,
        itemsOnCurrentPage: 6,
      });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 231-236 of 236 monitors",
      );
    });

    it("says it is loading rather than printing a stale range", () => {
      renderPagination({ isLoading: true });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Loading",
      );
    });
  });

  describe("page numbers", () => {
    it("renders a button for every page of a short list", () => {
      renderPagination({ totalItemsCount: 30 });

      expect(screen.getByTestId("pagination-page-1")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-2")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-3")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-4")).toBeNull();
    });

    it("navigates to the page that was clicked", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        totalItemsCount: 30,
      });

      fireEvent.click(screen.getByTestId("pagination-page-3"));

      expect(onNavigateToPage).toHaveBeenCalledWith(3, 10);
    });

    it("keeps the page size when jumping to a page", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        totalItemsCount: 300,
        itemsOnPage: 50,
      });

      fireEvent.click(screen.getByTestId("pagination-page-4"));

      expect(onNavigateToPage).toHaveBeenCalledWith(4, 50);
    });

    it("marks the current page for assistive technology", () => {
      renderPagination({ currentPageNumber: 3, totalItemsCount: 30 });

      expect(screen.getByTestId("pagination-page-3")).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.getByTestId("pagination-page-1")).not.toHaveAttribute(
        "aria-current",
      );
    });

    it("does not re-fetch the page the user is already on", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 2,
        totalItemsCount: 30,
      });

      fireEvent.click(screen.getByTestId("pagination-page-2"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("collapses the middle of a long list but keeps both ends", () => {
      renderPagination({ currentPageNumber: 12, totalItemsCount: 240 });

      expect(screen.getByTestId("pagination-page-1")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-24")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-11")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-13")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-5")).toBeNull();
      expect(
        screen.getByTestId("pagination-ellipsis-start"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("pagination-ellipsis-end")).toBeInTheDocument();
    });

    it("jumps to the last page in one click", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
        totalItemsCount: 240,
      });

      fireEvent.click(screen.getByTestId("pagination-page-24"));

      expect(onNavigateToPage).toHaveBeenCalledWith(24, 10);
    });

    /*
     * An even split used to produce one page too many, so a 20-row list with
     * 10 rows to a page offered a page 3 that could only render empty.
     */
    it("does not offer a page past the end of an even split", () => {
      renderPagination({ totalItemsCount: 20 });

      expect(screen.getByTestId("pagination-page-2")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-3")).toBeNull();
    });

    it("renders a single page for an empty list", () => {
      renderPagination({ totalItemsCount: 0 });

      expect(screen.getByTestId("pagination-page-1")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-2")).toBeNull();
    });

    it("does not navigate from a page number while loading", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        totalItemsCount: 30,
        isLoading: true,
      });

      fireEvent.click(screen.getByTestId("pagination-page-2"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });
  });

  describe("previous and next", () => {
    it("moves forward a page", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.click(screen.getByTestId("pagination-next-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(2, 10);
    });

    it("moves back a page", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 5,
      });

      fireEvent.click(screen.getByTestId("pagination-previous-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(4, 10);
    });

    it("disables previous on the first page", () => {
      renderPagination();

      expect(screen.getByTestId("pagination-previous-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-next-button")).toBeEnabled();
    });

    it("disables next on the last page", () => {
      renderPagination({ currentPageNumber: 24 });

      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-previous-button")).toBeEnabled();
    });

    it("disables next when the last page is only partly full", () => {
      renderPagination({ currentPageNumber: 2, totalItemsCount: 19 });

      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    it("disables both directions for an empty list", () => {
      renderPagination({ totalItemsCount: 0 });

      expect(screen.getByTestId("pagination-previous-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    it("disables both directions while loading", () => {
      renderPagination({ currentPageNumber: 5, isLoading: true });

      expect(screen.getByTestId("pagination-previous-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    it("disables both directions after an error", () => {
      renderPagination({ currentPageNumber: 5, isError: true });

      expect(screen.getByTestId("pagination-previous-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    it("disables both directions when the caller asks", () => {
      renderPagination({ currentPageNumber: 5, isDisabled: true });

      expect(screen.getByTestId("pagination-previous-button")).toBeDisabled();
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });
  });

  describe("rows per page", () => {
    it("is visible on the page rather than behind a menu", () => {
      renderPagination();

      expect(screen.getByLabelText("Rows per page")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-items-on-page-select")).toHaveValue(
        "10",
      );
    });

    it("offers the standard page sizes", () => {
      renderPagination();

      const options: Array<HTMLOptionElement> = Array.from(
        screen
          .getByTestId("pagination-items-on-page-select")
          .querySelectorAll("option"),
      );

      expect(
        options.map((option: HTMLOptionElement) => {
          return option.value;
        }),
      ).toEqual(["10", "20", "25", "50", "100"]);
    });

    it("changes the page size", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
        target: { value: "50" },
      });

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 50);
    });

    /*
     * Row 400 of the old page size is not row 400 of the new one, so a
     * resize that kept the page number could land on a page that no longer
     * exists.
     */
    it("returns to the first page when the size changes", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 20,
      });

      fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
        target: { value: "100" },
      });

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 100);
    });

    it("does nothing when the size is unchanged", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
        target: { value: "10" },
      });

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    /*
     * A shared link can carry any page size. A select whose value is missing
     * from its options renders as the first option instead, so the table
     * would claim 10 rows a page while showing 37.
     */
    it("shows a page size that came from a link", () => {
      renderPagination({ itemsOnPage: 37 });

      expect(screen.getByTestId("pagination-items-on-page-select")).toHaveValue(
        "37",
      );
    });

    it("honours a caller's own page sizes", () => {
      renderPagination({ itemsOnPage: 50, itemsOnPageOptions: [50, 250] });

      const options: Array<HTMLOptionElement> = Array.from(
        screen
          .getByTestId("pagination-items-on-page-select")
          .querySelectorAll("option"),
      );

      expect(
        options.map((option: HTMLOptionElement) => {
          return option.value;
        }),
      ).toEqual(["50", "250"]);
    });

    it("is frozen while loading", () => {
      renderPagination({ isLoading: true });

      expect(
        screen.getByTestId("pagination-items-on-page-select"),
      ).toBeDisabled();
    });
  });

  describe("go to page", () => {
    it("is offered once the list is too long to show every page", () => {
      renderPagination({ totalItemsCount: 240 });

      expect(
        screen.getByTestId("pagination-go-to-page-input"),
      ).toBeInTheDocument();
    });

    it("is left out when every page is already one click away", () => {
      renderPagination({ totalItemsCount: 30 });

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("jumps to the page that was typed", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });
      fireEvent.submit(screen.getByTestId("pagination-go-to-page-form"));

      expect(onNavigateToPage).toHaveBeenCalledWith(17, 10);
    });

    it("jumps on the Go button as well as on Enter", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "9" },
      });
      fireEvent.click(screen.getByTestId("pagination-go-to-page-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(9, 10);
    });

    it("pulls a page past the end back to the last page", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "9999" },
      });
      fireEvent.submit(screen.getByTestId("pagination-go-to-page-form"));

      expect(onNavigateToPage).toHaveBeenCalledWith(24, 10);
    });

    it("pulls a page before the start back to the first page", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 5,
      });

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "-3" },
      });
      fireEvent.submit(screen.getByTestId("pagination-go-to-page-form"));

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 10);
    });

    it("ignores an empty box", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.submit(screen.getByTestId("pagination-go-to-page-form"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
      expect(screen.getByTestId("pagination-go-to-page-button")).toBeDisabled();
    });

    it("ignores text that is not a page number", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "abc" },
      });
      fireEvent.submit(screen.getByTestId("pagination-go-to-page-form"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("clears itself once the page has changed", () => {
      const { rerender } = render(
        <Pagination {...baseProps} onNavigateToPage={jest.fn()} />,
      );

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });

      expect(screen.getByTestId("pagination-go-to-page-input")).toHaveValue(17);

      rerender(
        <Pagination
          {...baseProps}
          currentPageNumber={17}
          onNavigateToPage={jest.fn()}
        />,
      );

      expect(screen.getByTestId("pagination-go-to-page-input")).toHaveValue(
        null,
      );
    });

    it("is frozen while loading", () => {
      renderPagination({ isLoading: true });

      expect(screen.getByTestId("pagination-go-to-page-input")).toBeDisabled();
    });
  });

  describe("small screens", () => {
    /*
     * The numbered list is hidden by a media query on narrow screens, so the
     * control still has to say where the reader is.
     */
    it("carries a page-of-pages indicator", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(
        screen.getByTestId("pagination-current-page-indicator"),
      ).toHaveTextContent("Page 12 of 24");
    });

    it("groups the digits of a large page count", () => {
      renderPagination({ totalItemsCount: 1000000 });

      expect(
        screen.getByTestId("pagination-current-page-indicator"),
      ).toHaveTextContent(`Page 1 of ${(100000).toLocaleString()}`);
    });
  });

  describe("accessibility", () => {
    it("names the region for screen readers", () => {
      renderPagination();

      expect(
        screen.getByRole("navigation", { name: "Pagination for Monitors" }),
      ).toBeInTheDocument();
    });

    it("labels the arrows", () => {
      renderPagination();

      expect(
        screen.getByRole("button", { name: "Go to previous page" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Go to next page" }),
      ).toBeInTheDocument();
    });

    it("labels a page number as a jump target", () => {
      renderPagination({ totalItemsCount: 30 });

      expect(
        screen.getByRole("button", { name: "Go to page 2" }),
      ).toBeInTheDocument();
    });

    it("keeps the collapsed gaps out of the accessibility tree", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByTestId("pagination-ellipsis-start")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it("passes the caller's test id through to the region", () => {
      renderPagination({ dataTestId: "list-pagination" });

      expect(screen.getByTestId("list-pagination")).toBeInTheDocument();
    });
  });

  /*
   * Has-more mode. The analytics list endpoints skip COUNT(*) and instead
   * over-fetch one probe row, so `totalItemsCount` is a lower bound that
   * includes a row the response dropped. There is no last page to link to
   * and the printed range has to come from the rows the page rendered.
   */
  describe("has-more mode", () => {
    const hasMoreProps: Partial<ComponentProps> = {
      currentPageNumber: 1,
      totalItemsCount: 11,
      itemsOnPage: 10,
      itemsOnCurrentPage: 10,
      hasMore: true,
      singularLabel: "Trace",
      pluralLabel: "Traces",
    };

    it("does not print the probe row the response dropped", () => {
      renderPagination(hasMoreProps);

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 1-10+ traces",
      );
    });

    it("does not claim a total it cannot know", () => {
      renderPagination(hasMoreProps);

      expect(screen.getByTestId("pagination-summary")).not.toHaveTextContent(
        "of 11",
      );
    });

    it("keeps the range on the page when paging past the first page", () => {
      renderPagination({
        ...hasMoreProps,
        currentPageNumber: 3,
        totalItemsCount: 31,
      });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 21-30+ traces",
      );
    });

    it("prints a partial last page without the trailing plus", () => {
      renderPagination({
        ...hasMoreProps,
        currentPageNumber: 2,
        totalItemsCount: 13,
        itemsOnCurrentPage: 3,
        hasMore: false,
      });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 11-13 traces",
      );
    });

    it("has no range to print for an empty page", () => {
      renderPagination({
        ...hasMoreProps,
        currentPageNumber: 2,
        totalItemsCount: 10,
        itemsOnCurrentPage: 0,
        hasMore: false,
      });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "No traces",
      );
    });

    /*
     * Callers whose count carries no probe row (the session replay table
     * passes skip + rendered rows) are left to the count alone.
     */
    it("falls back to the count when the rendered row count is absent", () => {
      renderPagination({
        ...hasMoreProps,
        currentPageNumber: 2,
        totalItemsCount: 17,
        itemsOnCurrentPage: undefined,
      });

      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 11-17+ traces",
      );
    });

    it("renders no page numbers, because there is no last page", () => {
      renderPagination(hasMoreProps);

      expect(screen.queryByTestId("pagination-page-1")).toBeNull();
      expect(screen.queryByTestId("pagination-page-2")).toBeNull();
    });

    it("offers no jump box, because the page count is unknown", () => {
      renderPagination(hasMoreProps);

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("still offers the page size inline", () => {
      const onNavigateToPage: MockFunction = renderPagination(hasMoreProps);

      fireEvent.change(screen.getByTestId("pagination-items-on-page-select"), {
        target: { value: "25" },
      });

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 25);
    });

    it("shows the page it is on without a page count", () => {
      renderPagination({ ...hasMoreProps, currentPageNumber: 4 });

      expect(
        screen.getByTestId("pagination-current-page-indicator-desktop"),
      ).toHaveTextContent("Page 4");
      expect(
        screen.getByTestId("pagination-current-page-indicator-desktop"),
      ).not.toHaveTextContent("of");
    });

    it("pages forward while there is more to fetch", () => {
      const onNavigateToPage: MockFunction = renderPagination(hasMoreProps);

      fireEvent.click(screen.getByTestId("pagination-next-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(2, 10);
    });

    it("stops at the page that reports no more rows", () => {
      renderPagination({ ...hasMoreProps, hasMore: false });

      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    /*
     * The count is a lower bound, so it can be smaller than the rows already
     * paged past. That must not disable the way back.
     */
    it("keeps the way back open on a later page", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        ...hasMoreProps,
        currentPageNumber: 3,
        totalItemsCount: 31,
      });

      fireEvent.click(screen.getByTestId("pagination-previous-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(2, 10);
    });
  });
});
