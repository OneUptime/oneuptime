import Pagination, {
  ARROW_CLASS_NAME,
  CURRENT_PAGE_CLASS_NAME,
  CompactPaginationSize,
  ComponentProps,
  DISABLED_CONTROL_CLASS_NAME,
  DefaultPaginationSize,
  PAGE_CLASS_NAME,
  PaginationSize,
} from "../../../UI/Components/Pagination/Pagination";
import { describe, expect, it, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  TABLET_WIDTH_IN_PX,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";

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

type ClassTokensFunction = (element: Element) => Array<string>;

const classTokens: ClassTokensFunction = (element: Element): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

type SlotTextsFunction = () => Array<string>;

// The numbered slots - pages and gaps - in the order the bar draws them.
const slotTexts: SlotTextsFunction = (): Array<string> => {
  return Array.from(
    screen
      .getByRole("navigation")
      .querySelectorAll(
        '[data-testid^="pagination-page-"], [data-testid^="pagination-ellipsis-"]',
      ),
  ).map((slot: Element): string => {
    return slot.textContent || "";
  });
};

type HeightInPxFunction = (classNames: string) => number;

// What a Tailwind height class asks for: "h-7 w-7" -> 28.
const heightInPx: HeightInPxFunction = (classNames: string): number => {
  const match: RegExpMatchArray | null = classNames.match(
    /(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/,
  );

  return match ? Number(match[1]) * 4 : Number.NaN;
};

const ELLIPSIS: string = "…";

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
        totalItemsCount: 250,
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

    /*
     * Five slots, not a row of a dozen buttons: where you are, both ends,
     * and a gap on either side for everything else.
     */
    it("collapses the middle of a long list but keeps both ends", () => {
      renderPagination({ currentPageNumber: 12, totalItemsCount: 240 });

      expect(screen.getByTestId("pagination-page-1")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-12")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-page-24")).toBeInTheDocument();
      expect(screen.queryByTestId("pagination-page-11")).toBeNull();
      expect(screen.queryByTestId("pagination-page-13")).toBeNull();
      expect(
        screen.getByTestId("pagination-ellipsis-start"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("pagination-ellipsis-end")).toBeInTheDocument();
    });

    it("never draws more than five page slots", () => {
      renderPagination({ currentPageNumber: 12, totalItemsCount: 10000 });

      expect(
        screen
          .getByRole("navigation")
          .querySelectorAll(
            '[data-testid^="pagination-page-"], [data-testid^="pagination-ellipsis-"]',
          ),
      ).toHaveLength(5);
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

  /*
   * The jump box costs nothing on the bar until it is asked for: the
   * collapsed gap is the button that opens it, which is also where the
   * pages it can reach were hidden.
   */
  describe("go to page", () => {
    type OpenGoToPageModalFunction = (
      overrides?: Partial<ComponentProps>,
    ) => MockFunction;

    const openGoToPageModal: OpenGoToPageModalFunction = (
      overrides?: Partial<ComponentProps>,
    ): MockFunction => {
      const onNavigateToPage: MockFunction = renderPagination(overrides);
      fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));
      return onNavigateToPage;
    };

    it("takes up no room on the bar until it is asked for", () => {
      renderPagination();

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    it("opens from a collapsed gap", () => {
      openGoToPageModal();

      expect(
        screen.getByTestId("pagination-go-to-page-input"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("modal-title")).toHaveTextContent("Go to page");
    });

    it("says how many pages there are to choose from", () => {
      openGoToPageModal();

      expect(screen.getByTestId("modal-description")).toHaveTextContent(
        "This list has 24 pages",
      );
    });

    it("has no gap to open it from when every page is one click away", () => {
      renderPagination({ totalItemsCount: 30 });

      expect(screen.queryByTestId("pagination-ellipsis-end")).toBeNull();
      expect(screen.queryByTestId("pagination-ellipsis-start")).toBeNull();
    });

    it("opens from the gap before the current page too", () => {
      renderPagination({ currentPageNumber: 12 });

      fireEvent.click(screen.getByTestId("pagination-ellipsis-start"));

      expect(
        screen.getByTestId("pagination-go-to-page-input"),
      ).toBeInTheDocument();
    });

    it("jumps to the page that was typed", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(17, 10);
    });

    it("jumps on Enter as well as on the button", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "9" },
      });
      fireEvent.keyDown(screen.getByTestId("pagination-go-to-page-input"), {
        key: "Enter",
      });

      expect(onNavigateToPage).toHaveBeenCalledWith(9, 10);
    });

    it("closes itself once it has navigated", () => {
      openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("pulls a page past the end back to the last page", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "9999" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(24, 10);
    });

    it("pulls a page before the start back to the first page", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal({
        currentPageNumber: 5,
      });

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "-3" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 10);
    });

    it("cannot be submitted empty", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("ignores text that is not a page number", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "abc" },
      });
      fireEvent.keyDown(screen.getByTestId("pagination-go-to-page-input"), {
        key: "Enter",
      });

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("can be dismissed without navigating", () => {
      const onNavigateToPage: MockFunction = openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("does not remember the last page typed", () => {
      openGoToPageModal();

      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "17" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

      expect(screen.getByTestId("pagination-go-to-page-input")).toHaveValue(
        null,
      );
    });

    it("closes when the page changes underneath it", () => {
      const { rerender } = render(
        <Pagination {...baseProps} onNavigateToPage={jest.fn()} />,
      );

      fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

      expect(
        screen.getByTestId("pagination-go-to-page-input"),
      ).toBeInTheDocument();

      rerender(
        <Pagination
          {...baseProps}
          currentPageNumber={17}
          onNavigateToPage={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("does not open while loading", () => {
      renderPagination({ isLoading: true });

      fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
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

    it("says what a collapsed gap does rather than reading as three dots", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(
        screen.getAllByRole("button", { name: "Go to a page in between" }),
      ).toHaveLength(2);
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

    it("offers no gap to jump from, because the page count is unknown", () => {
      renderPagination(hasMoreProps);

      expect(screen.queryByTestId("pagination-ellipsis-start")).toBeNull();
      expect(screen.queryByTestId("pagination-ellipsis-end")).toBeNull();
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

  /*
   * The bar used to be 38px buttons and a 34px select in 14px type, which
   * dwarfed the table above it. It is chrome, not content: one row of 28px
   * controls in 12px type, and 24px under the denser logs and traces views.
   */
  describe("size", () => {
    it("draws every control 28px tall", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const testId of [
        "pagination-previous-button",
        "pagination-next-button",
        "pagination-page-1",
        "pagination-page-12",
        "pagination-ellipsis-start",
        "pagination-ellipsis-end",
        "pagination-items-on-page-select",
        "pagination-current-page-indicator",
      ]) {
        expect(screen.getByTestId(testId)).toHaveClass("h-7");
      }
    });

    it("makes the arrows square and the pages at least as wide as they are tall", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
        "h-7",
        "w-7",
      );
      expect(screen.getByTestId("pagination-next-button")).toHaveClass(
        "h-7",
        "w-7",
      );
      expect(screen.getByTestId("pagination-page-12")).toHaveClass(
        "h-7",
        "min-w-7",
      );
    });

    it("sets the summary, the label and every control in 12px type", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByTestId("pagination-summary")).toHaveClass("text-xs");
      expect(screen.getByText("Rows per page")).toHaveClass("text-xs");
      expect(screen.getByTestId("pagination-items-on-page-select")).toHaveClass(
        "text-xs",
      );
      expect(screen.getByTestId("pagination-page-12")).toHaveClass("text-xs");
      expect(
        screen.getByTestId("pagination-current-page-indicator"),
      ).toHaveClass("text-xs");
    });

    it("no longer uses the 14px type it had", () => {
      renderPagination({ currentPageNumber: 12 });

      const nav: HTMLElement = screen.getByRole("navigation");

      expect(nav.querySelectorAll(".text-sm")).toHaveLength(0);
      expect(nav.querySelectorAll(".py-2, .min-w-9")).toHaveLength(0);
    });

    it("draws the compact skin's controls 24px tall", () => {
      renderPagination({ currentPageNumber: 12, isCompact: true });

      for (const testId of [
        "pagination-previous-button",
        "pagination-next-button",
        "pagination-page-12",
        "pagination-ellipsis-end",
        "pagination-items-on-page-select",
        "pagination-current-page-indicator",
      ]) {
        expect(screen.getByTestId(testId)).toHaveClass("h-6");
        expect(screen.getByTestId(testId)).not.toHaveClass("h-7");
      }
    });

    it("pads the compact bar less than the default one", () => {
      const { unmount } = render(
        <Pagination
          {...baseProps}
          onNavigateToPage={jest.fn()}
          dataTestId="default-bar"
        />,
      );

      expect(screen.getByTestId("default-bar")).toHaveClass(
        "px-4",
        "py-2.5",
        "sm:px-6",
      );

      unmount();

      render(
        <Pagination
          {...baseProps}
          onNavigateToPage={jest.fn()}
          dataTestId="compact-bar"
          isCompact={true}
        />,
      );

      expect(screen.getByTestId("compact-bar")).toHaveClass("px-4", "py-2");
      expect(screen.getByTestId("compact-bar")).not.toHaveClass("py-2.5");
    });

    it.each([
      ["default", DefaultPaginationSize, 28],
      ["compact", CompactPaginationSize, 24],
    ])(
      "keeps the %s skin's controls one height",
      (_name: string, size: PaginationSize, expectedPx: number) => {
        expect(heightInPx(size.heightClassName)).toBe(expectedPx);
        expect(heightInPx(size.squareClassName)).toBe(expectedPx);
        expect(heightInPx(size.pageClassName)).toBe(expectedPx);
        expect(heightInPx(size.selectClassName)).toBe(expectedPx);
      },
    );

    it("stays within the 24-32px a compact control should be", () => {
      for (const size of [DefaultPaginationSize, CompactPaginationSize]) {
        expect(heightInPx(size.heightClassName)).toBeGreaterThanOrEqual(24);
        expect(heightInPx(size.heightClassName)).toBeLessThanOrEqual(32);
      }
    });

    it("lines the default bar's text up with a table's first column", () => {
      // Table cells are pl-4 sm:pl-6 (CellClassName.ts).
      expect(DefaultPaginationSize.barClassName.split(" ")).toEqual(
        expect.arrayContaining(["px-4", "sm:px-6"]),
      );
    });
  });

  describe("look", () => {
    it("draws the arrows and pages without borders of their own", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const button of within(screen.getByRole("list")).getAllByRole(
        "button",
      )) {
        expect(
          classTokens(button).filter((token: string): boolean => {
            return token === "border" || token.startsWith("border-");
          }),
        ).toEqual([]);
      }
    });

    it("draws the current page as a tinted chip", () => {
      renderPagination({ currentPageNumber: 12 });

      const current: HTMLElement = screen.getByTestId("pagination-page-12");

      expect(current).toHaveClass(...CURRENT_PAGE_CLASS_NAME.split(" "));
      expect(current).toHaveClass(
        "bg-indigo-50",
        "text-indigo-700",
        "ring-1",
        "ring-indigo-200",
        "font-semibold",
      );
    });

    it("gives the current page no hover, since clicking it does nothing", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(
        classTokens(screen.getByTestId("pagination-page-12")).filter(
          (token: string): boolean => {
            return token.startsWith("hover:");
          },
        ),
      ).toEqual([]);
      expect(screen.getByTestId("pagination-page-12")).toHaveClass(
        "cursor-default",
      );
    });

    it("gives any other page a background only while it is hovered", () => {
      renderPagination({ currentPageNumber: 12 });

      const other: HTMLElement = screen.getByTestId("pagination-page-1");

      expect(other).toHaveClass(...PAGE_CLASS_NAME.split(" "));
      expect(
        classTokens(other).filter((token: string): boolean => {
          return token.startsWith("bg-") || token.startsWith("ring-");
        }),
      ).toEqual([]);
    });

    it("colours only the current page", () => {
      renderPagination({ currentPageNumber: 12 });

      const nav: HTMLElement = screen.getByRole("navigation");

      expect(nav.querySelectorAll(".bg-indigo-50")).toHaveLength(1);
      expect(nav.querySelector(".bg-indigo-50")).toBe(
        screen.getByTestId("pagination-page-12"),
      );
    });

    it("draws the gaps lighter than the pages", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByTestId("pagination-ellipsis-end")).toHaveClass(
        "text-gray-400",
      );
      expect(screen.getByTestId("pagination-page-1")).toHaveClass(
        "text-gray-600",
      );
    });

    it("lets every control fade its colours, except for a reader who asks for less motion", () => {
      renderPagination({ currentPageNumber: 12 });

      const animated: Array<Element> = Array.from(
        screen.getByRole("navigation").querySelectorAll(".transition"),
      );

      expect(animated.length).toBeGreaterThan(5);

      for (const element of animated) {
        expect(element).toHaveClass("motion-reduce:transition-none");
      }
    });

    it("shows where keyboard focus is on every button", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const button of within(screen.getByRole("navigation")).getAllByRole(
        "button",
      )) {
        expect(button).toHaveClass(
          "focus:outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-indigo-500",
        );
      }

      expect(screen.getByTestId("pagination-items-on-page-select")).toHaveClass(
        "focus:ring-1",
        "focus:ring-indigo-500",
      );
    });

    it("keeps the select's chevron out of the way of the pointer", () => {
      renderPagination();

      const chevron: Element = screen
        .getByTestId("pagination-items-on-page-select")
        .parentElement!.querySelector("svg")!;

      expect(chevron.closest(".pointer-events-none")).not.toBeNull();
    });
  });

  /*
   * A control that cannot be used keeps its colour and fades. It used to turn
   * text-gray-300, which the dark theme maps to a light slate - so a dead
   * arrow was brighter than a live one there.
   */
  describe("disabled states at the bounds", () => {
    it("fades the previous arrow on the first page", () => {
      renderPagination();

      const previous: HTMLElement = screen.getByTestId(
        "pagination-previous-button",
      );

      expect(previous).toBeDisabled();
      expect(previous).toHaveClass(
        ...DISABLED_CONTROL_CLASS_NAME.split(" "),
        "text-gray-500",
      );
      expect(previous).not.toHaveClass("text-gray-300");
    });

    it("fades the next arrow on the last page", () => {
      renderPagination({ currentPageNumber: 24 });

      const next: HTMLElement = screen.getByTestId("pagination-next-button");

      expect(next).toBeDisabled();
      expect(next).toHaveClass("opacity-40", "cursor-not-allowed");
      expect(screen.getByTestId("pagination-previous-button")).not.toHaveClass(
        "opacity-40",
      );
    });

    it("keeps a dead arrow in the live arrow's colour", () => {
      renderPagination();

      const liveColour: Array<string> = classTokens(
        screen.getByTestId("pagination-next-button"),
      ).filter((token: string): boolean => {
        return token.startsWith("text-gray-");
      });

      expect(liveColour).toEqual(["text-gray-500"]);
      expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
        ...liveColour,
      );
    });

    it("drops a dead arrow's hover rather than overriding it", () => {
      renderPagination();

      expect(
        classTokens(screen.getByTestId("pagination-previous-button")).filter(
          (token: string): boolean => {
            return token.startsWith("hover:");
          },
        ),
      ).toEqual([]);
      expect(screen.getByTestId("pagination-next-button")).toHaveClass(
        ...ARROW_CLASS_NAME.split(" "),
      );
    });

    it("does not navigate from a dead arrow", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 24,
      });

      fireEvent.click(screen.getByTestId("pagination-next-button"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("does not navigate back from the first page", () => {
      const onNavigateToPage: MockFunction = renderPagination();

      fireEvent.click(screen.getByTestId("pagination-previous-button"));

      expect(onNavigateToPage).not.toHaveBeenCalled();
    });

    it("fades both arrows of a one-page list", () => {
      renderPagination({ totalItemsCount: 7 });

      expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
        "opacity-40",
      );
      expect(screen.getByTestId("pagination-next-button")).toHaveClass(
        "opacity-40",
      );
    });

    it("fades every page but the current one while loading, and keeps its chip", () => {
      renderPagination({ currentPageNumber: 12, isLoading: true });

      for (const testId of [
        "pagination-page-1",
        "pagination-page-24",
        "pagination-ellipsis-start",
        "pagination-ellipsis-end",
        "pagination-previous-button",
        "pagination-next-button",
      ]) {
        expect(screen.getByTestId(testId)).toBeDisabled();
        expect(screen.getByTestId(testId)).toHaveClass("opacity-40");
      }

      expect(screen.getByTestId("pagination-page-12")).toBeDisabled();
      expect(screen.getByTestId("pagination-page-12")).not.toHaveClass(
        "opacity-40",
      );
      expect(screen.getByTestId("pagination-page-12")).toHaveClass(
        "bg-indigo-50",
      );
    });

    it("drops every hover while the bar is frozen", () => {
      renderPagination({ currentPageNumber: 12, isDisabled: true });

      const nav: HTMLElement = screen.getByRole("navigation");

      for (const element of Array.from(nav.querySelectorAll("*"))) {
        expect(
          classTokens(element).filter((token: string): boolean => {
            return token.startsWith("hover:");
          }),
        ).toEqual([]);
      }
    });

    it("fades the select while loading instead of painting it a light grey", () => {
      renderPagination({ isLoading: true });

      const select: HTMLElement = screen.getByTestId(
        "pagination-items-on-page-select",
      );

      expect(select).toBeDisabled();
      expect(select).toHaveClass(
        "disabled:opacity-50",
        "disabled:cursor-not-allowed",
      );
      expect(
        classTokens(select).filter((token: string): boolean => {
          return token.startsWith("disabled:bg-");
        }),
      ).toEqual([]);
    });

    it("lights the select's border on hover only while it can be used", () => {
      const { unmount } = render(
        <Pagination {...baseProps} onNavigateToPage={jest.fn()} />,
      );

      expect(screen.getByTestId("pagination-items-on-page-select")).toHaveClass(
        "hover:border-gray-400",
      );

      unmount();

      render(
        <Pagination
          {...baseProps}
          onNavigateToPage={jest.fn()}
          isError={true}
        />,
      );

      expect(
        screen.getByTestId("pagination-items-on-page-select"),
      ).not.toHaveClass("hover:border-gray-400");
    });
  });

  /*
   * Five slots, whatever the length: where the reader is, both ends, and a
   * gap for each run of pages that is not on the bar.
   */
  describe("many pages", () => {
    it.each([
      [1, 30, ["1", "2", "3"]],
      [1, 50, ["1", "2", "3", "4", "5"]],
      [1, 60, ["1", "2", "3", ELLIPSIS, "6"]],
      [6, 60, ["1", ELLIPSIS, "4", "5", "6"]],
      [1, 240, ["1", "2", "3", ELLIPSIS, "24"]],
      [3, 240, ["1", "2", "3", ELLIPSIS, "24"]],
      [4, 240, ["1", ELLIPSIS, "4", ELLIPSIS, "24"]],
      [12, 240, ["1", ELLIPSIS, "12", ELLIPSIS, "24"]],
      [21, 240, ["1", ELLIPSIS, "21", ELLIPSIS, "24"]],
      [22, 240, ["1", ELLIPSIS, "22", "23", "24"]],
      [24, 240, ["1", ELLIPSIS, "22", "23", "24"]],
    ])(
      "on page %i of a %i-row list draws %j",
      (
        currentPageNumber: number,
        totalItemsCount: number,
        expected: Array<string>,
      ) => {
        renderPagination({
          currentPageNumber: currentPageNumber,
          totalItemsCount: totalItemsCount,
        });

        expect(slotTexts()).toEqual(expected);
      },
    );

    it("groups the digits of a deep page and of the last one", () => {
      renderPagination({ currentPageNumber: 5000, totalItemsCount: 100000 });

      expect(slotTexts()).toEqual([
        "1",
        ELLIPSIS,
        (5000).toLocaleString(),
        ELLIPSIS,
        (10000).toLocaleString(),
      ]);
    });

    it("never hides a single page behind a gap", () => {
      for (const currentPageNumber of [1, 2, 3, 4, 5, 6, 7]) {
        const { unmount } = render(
          <Pagination
            {...baseProps}
            onNavigateToPage={jest.fn()}
            currentPageNumber={currentPageNumber}
            totalItemsCount={70}
          />,
        );

        const pages: Array<number> = slotTexts()
          .filter((text: string): boolean => {
            return text !== ELLIPSIS;
          })
          .map(Number);

        const slots: Array<string> = slotTexts();

        slots.forEach((text: string, index: number) => {
          if (text !== ELLIPSIS) {
            return;
          }

          const before: number = Number(slots[index - 1]);
          const after: number = Number(slots[index + 1]);

          expect(after - before - 1).toBeGreaterThanOrEqual(2);
        });

        expect(pages).toContain(currentPageNumber);
        expect(pages).toContain(1);
        expect(pages).toContain(7);

        unmount();
      }
    });

    it("pulls a page number past the end back to the last page it can show", () => {
      renderPagination({ currentPageNumber: 99, totalItemsCount: 240 });

      expect(slotTexts()).toEqual(["1", ELLIPSIS, "22", "23", "24"]);
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    it("opens the jump dialog from either gap and lands on the typed page", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
      });

      fireEvent.click(screen.getByTestId("pagination-ellipsis-start"));
      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "5" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(5, 10);
    });

    it("names the jump dialog's button after what it does", () => {
      renderPagination({ currentPageNumber: 12 });

      fireEvent.click(screen.getByTestId("pagination-ellipsis-end"));

      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Go to page");
      expect(screen.getByLabelText("Page number")).toBe(
        screen.getByTestId("pagination-go-to-page-input"),
      );
    });
  });

  /*
   * jsdom has no stylesheet, so ResponsiveVisibility reads the Tailwind
   * display utilities and resolves them per width, the way the cascade does.
   */
  describe("narrow screens", () => {
    const SM_IN_PX: number = TAILWIND_BREAKPOINTS_IN_PX["sm"]!;
    const NARROW_WIDTHS: Array<number> = [320, PHONE_WIDTH_IN_PX, SM_IN_PX - 1];
    const WIDE_WIDTHS: Array<number> = [
      SM_IN_PX,
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
    ];

    it("swaps the page list for the indicator below 640px", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const width of NARROW_WIDTHS) {
        expect(
          isVisibleAtWidth(screen.getByTestId("pagination-page-12"), width),
        ).toBe(false);
        expect(
          isVisibleAtWidth(
            screen.getByTestId("pagination-ellipsis-end"),
            width,
          ),
        ).toBe(false);
        expect(
          isVisibleAtWidth(
            screen.getByTestId("pagination-current-page-indicator"),
            width,
          ),
        ).toBe(true);
      }

      for (const width of WIDE_WIDTHS) {
        expect(
          isVisibleAtWidth(screen.getByTestId("pagination-page-12"), width),
        ).toBe(true);
        expect(
          isVisibleAtWidth(
            screen.getByTestId("pagination-current-page-indicator"),
            width,
          ),
        ).toBe(false);
      }
    });

    it("keeps the arrows, the summary and the page size on screen at every width", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const width of [...NARROW_WIDTHS, ...WIDE_WIDTHS]) {
        for (const testId of [
          "pagination-previous-button",
          "pagination-next-button",
          "pagination-summary",
          "pagination-items-on-page-select",
        ]) {
          expect(isVisibleAtWidth(screen.getByTestId(testId), width)).toBe(
            true,
          );
        }
      }
    });

    it("wraps onto more rows rather than overflowing", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByRole("navigation")).toHaveClass(
        "flex",
        "flex-wrap",
        "justify-between",
      );
      expect(screen.getByTestId("pagination-controls")).toHaveClass(
        "flex",
        "flex-wrap",
      );
      // The summary may shrink and wrap its own words on the narrowest screens.
      expect(screen.getByTestId("pagination-summary")).toHaveClass("min-w-0");
      expect(screen.getByTestId("pagination-summary")).not.toHaveClass(
        "whitespace-nowrap",
      );
    });

    it("keeps the label and the arrows from breaking mid-word", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByText("Rows per page")).toHaveClass(
        "whitespace-nowrap",
      );
      expect(
        screen.getByTestId("pagination-current-page-indicator"),
      ).toHaveClass("whitespace-nowrap");
      expect(screen.getByTestId("pagination-previous-button")).toHaveClass(
        "shrink-0",
      );
    });

    /*
     * A narrow screen has no gaps to open the jump dialog from, so the
     * indicator does it - for the same lists whose bar collapses a gap.
     */
    it("lets a long list's indicator open the jump dialog", () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
      });

      const indicator: HTMLElement = screen.getByTestId(
        "pagination-current-page-indicator",
      );

      expect(indicator.tagName).toBe("BUTTON");
      expect(indicator).toHaveAttribute("aria-haspopup", "dialog");
      expect(indicator).toHaveAttribute("title", "Go to page");

      fireEvent.click(indicator);
      fireEvent.change(screen.getByTestId("pagination-go-to-page-input"), {
        target: { value: "20" },
      });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      expect(onNavigateToPage).toHaveBeenCalledWith(20, 10);
    });

    it("names the indicator button by the words it shows", () => {
      renderPagination({ currentPageNumber: 12 });

      expect(screen.getByRole("button", { name: "Page 12 of 24" })).toBe(
        screen.getByTestId("pagination-current-page-indicator"),
      );
    });

    it("keeps a short list's indicator plain text", () => {
      renderPagination({ currentPageNumber: 2, totalItemsCount: 50 });

      const indicator: HTMLElement = screen.getByTestId(
        "pagination-current-page-indicator",
      );

      expect(indicator.tagName).toBe("SPAN");
      expect(indicator).toHaveTextContent("Page 2 of 5");
      expect(screen.queryByRole("button", { name: "Page 2 of 5" })).toBeNull();
    });

    it("offers the jump from the first list long enough to collapse a gap", () => {
      renderPagination({ totalItemsCount: 60 });

      expect(
        screen.getByTestId("pagination-current-page-indicator").tagName,
      ).toBe("BUTTON");
      expect(screen.getByTestId("pagination-ellipsis-end")).toBeInTheDocument();
    });

    it("keeps the indicator plain text when the total is unknown", () => {
      renderPagination({
        currentPageNumber: 3,
        totalItemsCount: 31,
        itemsOnCurrentPage: 10,
        hasMore: true,
      });

      const indicator: HTMLElement = screen.getByTestId(
        "pagination-current-page-indicator",
      );

      expect(indicator.tagName).toBe("SPAN");
      expect(indicator).toHaveTextContent("Page 3");
      expect(indicator).not.toHaveTextContent("of");
    });

    it("freezes the indicator while loading", () => {
      renderPagination({ currentPageNumber: 12, isLoading: true });

      const indicator: HTMLElement = screen.getByTestId(
        "pagination-current-page-indicator",
      );

      expect(indicator).toBeDisabled();
      expect(indicator).toHaveClass("opacity-40");

      fireEvent.click(indicator);

      expect(screen.queryByTestId("pagination-go-to-page-input")).toBeNull();
    });

    it("draws the indicator as tall as the arrows beside it", () => {
      renderPagination({ currentPageNumber: 12, isCompact: true });

      expect(
        heightInPx(
          screen.getByTestId("pagination-current-page-indicator").className,
        ),
      ).toBe(
        heightInPx(screen.getByTestId("pagination-previous-button").className),
      );
    });
  });

  describe("more accessibility", () => {
    it("draws the page list as a list of items", () => {
      renderPagination({ currentPageNumber: 12 });

      const list: HTMLElement = screen.getByRole("list");

      // Previous, the narrow-screen indicator, five slots and next.
      expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    });

    it("marks exactly one page as the current one", () => {
      renderPagination({ currentPageNumber: 12 });

      const current: Array<Element> = Array.from(
        screen.getByRole("navigation").querySelectorAll("[aria-current]"),
      );

      expect(current).toHaveLength(1);
      expect(current[0]).toBe(screen.getByTestId("pagination-page-12"));
      expect(current[0]).toHaveAccessibleName("Page 12");
    });

    it("names a page with the same digits it shows", () => {
      renderPagination({ currentPageNumber: 1, totalItemsCount: 100000 });

      const last: HTMLElement = screen.getByTestId("pagination-page-10000");

      expect(last).toHaveTextContent((10000).toLocaleString());
      expect(last).toHaveAccessibleName(
        `Go to page ${(10000).toLocaleString()}`,
      );
    });

    it("says that a gap opens a dialog", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const testId of [
        "pagination-ellipsis-start",
        "pagination-ellipsis-end",
      ]) {
        expect(screen.getByTestId(testId)).toHaveAttribute(
          "aria-haspopup",
          "dialog",
        );
        expect(screen.getByTestId(testId)).toHaveAttribute(
          "title",
          "Go to page",
        );
      }
    });

    it("hides the arrows' icons from assistive technology", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const testId of [
        "pagination-previous-button",
        "pagination-next-button",
      ]) {
        const icon: Element | null = screen
          .getByTestId(testId)
          .querySelector("svg");

        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute("aria-hidden", "true");
      }
    });

    it("makes every control a real button that does not submit a form", () => {
      renderPagination({ currentPageNumber: 12 });

      for (const button of within(screen.getByRole("navigation")).getAllByRole(
        "button",
      )) {
        expect(button).toHaveAttribute("type", "button");
      }
    });

    it("announces a new range politely", () => {
      renderPagination();

      expect(screen.getByTestId("pagination-summary")).toHaveAttribute(
        "aria-live",
        "polite",
      );
    });

    it("ties the rows-per-page label to its select", () => {
      renderPagination();

      expect(screen.getByRole("combobox", { name: "Rows per page" })).toBe(
        screen.getByTestId("pagination-items-on-page-select"),
      );
    });

    it("gives two bars on one page their own select ids", () => {
      render(
        <>
          <Pagination {...baseProps} onNavigateToPage={jest.fn()} />
          <Pagination
            {...baseProps}
            onNavigateToPage={jest.fn()}
            pluralLabel="Incidents"
          />
        </>,
      );

      const selects: Array<HTMLElement> = screen.getAllByRole("combobox", {
        name: "Rows per page",
      });

      expect(selects).toHaveLength(2);
      expect(selects[0]!.id).not.toBe(selects[1]!.id);
    });

    it("names the region after the list it pages", () => {
      renderPagination({ pluralLabel: "Status Pages" });

      expect(
        screen.getByRole("navigation", { name: "Pagination for Status Pages" }),
      ).toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("skips a dead arrow and reaches every live control with Tab", async () => {
      renderPagination({ currentPageNumber: 1 });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const reached: Array<string | null> = [];

      for (let step: number = 0; step < 12; step++) {
        await user.tab();
        reached.push(
          (document.activeElement as HTMLElement | null)?.getAttribute(
            "data-testid",
          ) || null,
        );
      }

      expect(reached).not.toContain("pagination-previous-button");
      expect(reached).toEqual(
        expect.arrayContaining([
          "pagination-items-on-page-select",
          "pagination-page-1",
          "pagination-page-2",
          "pagination-ellipsis-end",
          "pagination-page-24",
          "pagination-next-button",
        ]),
      );
    });

    it("visits the controls in the order they are drawn", async () => {
      renderPagination({ currentPageNumber: 12 });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const reached: Array<string> = [];

      for (let step: number = 0; step < 9; step++) {
        await user.tab();
        reached.push(
          (document.activeElement as HTMLElement).getAttribute("data-testid") ||
            "",
        );
      }

      /*
       * jsdom applies no media queries, so the narrow-screen indicator is in
       * the order too; a browser skips it from 640px up, where it is hidden.
       */
      expect(reached).toEqual([
        "pagination-items-on-page-select",
        "pagination-previous-button",
        "pagination-current-page-indicator",
        "pagination-page-1",
        "pagination-ellipsis-start",
        "pagination-page-12",
        "pagination-ellipsis-end",
        "pagination-page-24",
        "pagination-next-button",
      ]);
    });

    it("turns the page with Enter on an arrow", async () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
      });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      screen.getByTestId("pagination-next-button").focus();
      await user.keyboard("{Enter}");

      expect(onNavigateToPage).toHaveBeenCalledWith(13, 10);
    });

    it("jumps to a page with Space on its number", async () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
      });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      screen.getByTestId("pagination-page-24").focus();
      await user.keyboard(" ");

      expect(onNavigateToPage).toHaveBeenCalledWith(24, 10);
    });

    it("opens the jump dialog with Enter on a gap", async () => {
      renderPagination({ currentPageNumber: 12 });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      screen.getByTestId("pagination-ellipsis-end").focus();
      await user.keyboard("{Enter}");

      expect(
        screen.getByTestId("pagination-go-to-page-input"),
      ).toBeInTheDocument();
    });

    it("changes the page size from the keyboard", async () => {
      const onNavigateToPage: MockFunction = renderPagination({
        currentPageNumber: 12,
      });

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.selectOptions(
        screen.getByTestId("pagination-items-on-page-select"),
        "25",
      );

      expect(onNavigateToPage).toHaveBeenCalledWith(1, 25);
    });
  });
});
