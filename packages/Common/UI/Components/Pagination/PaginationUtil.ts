/**
 * Pure pagination math, kept out of the component so the page-window and
 * range arithmetic can be unit tested without rendering anything.
 */

/**
 * A slot in the rendered page list. Numbers are clickable pages; the two
 * ellipsis markers are the gaps that were collapsed on either side of the
 * current page. They are distinct values so the renderer can give them
 * stable React keys (a list can contain both).
 */
export type PageWindowItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * Page sizes offered in the "rows per page" dropdown. Anything else the
 * table is already using (a shared link can carry an arbitrary size) is
 * merged in by `getItemsOnPageOptions` so the select always has a value
 * that matches what is on screen.
 */
export const DefaultItemsOnPageOptions: Array<number> = [10, 20, 25, 50, 100];

/**
 * How many slots the numbered page list may occupy, ellipses included.
 * Five is the whole story a page list has to tell - where you are, where
 * both ends are, and that there is more in between - and it keeps the
 * control a constant width from page 1 through page 10,000. Stepping to a
 * neighbour is what the arrows are for; landing somewhere arbitrary is what
 * the gaps are for.
 */
export const DefaultMaxVisiblePages: number = 5;

/**
 * The narrowest window the collapsing rules can honour: first, gap, current,
 * gap, last. Anything smaller is raised to this.
 */
const MinMaxVisiblePages: number = 5;

export interface ItemRange {
  firstItemNumber: number;
  lastItemNumber: number;
  isEmpty: boolean;
}

export interface ItemRangeInput {
  currentPageNumber: number;
  itemsOnPage: number;
  totalItemsCount: number;
  /*
   * Rows this page actually rendered, when the caller knows. Analytics list
   * endpoints over-fetch one probe row to derive `hasMore` and count it in
   * `totalItemsCount` even though the payload dropped it, so the printed
   * range has to be clamped to rows the page can really show.
   */
  itemsOnCurrentPage?: number | undefined;
}

export default class PaginationUtil {
  /**
   * Total pages for a known item count. Always at least 1 — an empty table
   * still sits on "page 1 of 1" rather than "page 1 of 0".
   */
  public static getTotalPageCount(
    totalItemsCount: number,
    itemsOnPage: number,
  ): number {
    const safeItemsOnPage: number = Math.max(Math.floor(itemsOnPage) || 0, 1);
    const safeTotalItemsCount: number = Math.max(
      Math.floor(totalItemsCount) || 0,
      0,
    );

    return Math.max(Math.ceil(safeTotalItemsCount / safeItemsOnPage), 1);
  }

  /**
   * Clamp a page number into the pages that exist. Used both for what the
   * control highlights and for what a hand-typed "go to page" is allowed to
   * request.
   */
  public static clampPageNumber(
    pageNumber: number,
    totalPageCount: number,
  ): number {
    const safeTotalPageCount: number = Math.max(
      Math.floor(totalPageCount) || 0,
      1,
    );
    const safePageNumber: number = Math.floor(pageNumber) || 1;

    if (safePageNumber < 1) {
      return 1;
    }

    return Math.min(safePageNumber, safeTotalPageCount);
  }

  /**
   * The page numbers to render, with collapsed gaps marked. When the list
   * fits it is returned whole; otherwise the first and last pages are always
   * present (so "jump to the start / end" is one click) and the pages around
   * the current one fill the remaining slots.
   */
  public static getPageWindow(
    currentPageNumber: number,
    totalPageCount: number,
    maxVisiblePages: number = DefaultMaxVisiblePages,
  ): Array<PageWindowItem> {
    const safeTotalPageCount: number = Math.max(
      Math.floor(totalPageCount) || 0,
      1,
    );
    const safeMaxVisiblePages: number = Math.max(
      Math.floor(maxVisiblePages) || 0,
      MinMaxVisiblePages,
    );
    const currentPage: number = PaginationUtil.clampPageNumber(
      currentPageNumber,
      safeTotalPageCount,
    );

    const allPages: (from: number, to: number) => Array<PageWindowItem> = (
      from: number,
      to: number,
    ): Array<PageWindowItem> => {
      const pages: Array<PageWindowItem> = [];
      for (let page: number = from; page <= to; page++) {
        pages.push(page);
      }
      return pages;
    };

    if (safeTotalPageCount <= safeMaxVisiblePages) {
      return allPages(1, safeTotalPageCount);
    }

    /*
     * Pages kept on each side of the current one. Five slots are already
     * spent on the first page, the last page, the current page and the two
     * ellipses, so whatever a wider window is given goes here - and the
     * rendered width stays at `safeMaxVisiblePages`.
     */
    const siblingCount: number = Math.max(
      Math.floor((safeMaxVisiblePages - 5) / 2),
      0,
    );

    /*
     * A gap has to hide at least two pages to be worth drawing: an ellipsis
     * standing in for a single page number is both a lie and wider than the
     * number it replaced. Where only one page would be hidden, the run of
     * pages is extended to swallow it instead.
     */
    const hasGapBefore: boolean = currentPage - siblingCount > 3;
    const hasGapAfter: boolean =
      currentPage + siblingCount < safeTotalPageCount - 2;

    if (!hasGapBefore && hasGapAfter) {
      const headCount: number = safeMaxVisiblePages - 2;
      return [...allPages(1, headCount), "ellipsis-end", safeTotalPageCount];
    }

    if (hasGapBefore && !hasGapAfter) {
      const tailCount: number = safeMaxVisiblePages - 2;
      return [
        1,
        "ellipsis-start",
        ...allPages(safeTotalPageCount - tailCount + 1, safeTotalPageCount),
      ];
    }

    if (hasGapBefore && hasGapAfter) {
      return [
        1,
        "ellipsis-start",
        ...allPages(currentPage - siblingCount, currentPage + siblingCount),
        "ellipsis-end",
        safeTotalPageCount,
      ];
    }

    /*
     * Unreachable for a list longer than the window — with neither gap the
     * list is at most `safeMaxVisiblePages - 2` pages long — but returning
     * the whole list is the honest fallback rather than an exception.
     */
    return allPages(1, safeTotalPageCount);
  }

  /**
   * The "Showing 21-30 of 240" range. `itemsOnCurrentPage`, when given, caps
   * the range at rows the page really rendered, which is what keeps a short
   * final page (and the analytics probe row) from being over-reported.
   */
  public static getItemRange(input: ItemRangeInput): ItemRange {
    const itemsOnPage: number = Math.max(Math.floor(input.itemsOnPage) || 0, 1);
    const totalItemsCount: number = Math.max(
      Math.floor(input.totalItemsCount) || 0,
      0,
    );
    const currentPageNumber: number = Math.max(
      Math.floor(input.currentPageNumber) || 1,
      1,
    );

    const alreadySeenCount: number = itemsOnPage * (currentPageNumber - 1);
    const firstItemNumber: number = alreadySeenCount + 1;

    // What the count proves is left after the pages already paged past.
    const provenOnPage: number = Math.max(
      totalItemsCount - alreadySeenCount,
      0,
    );

    /*
     * A page can hold no more than its page size, no more than the count
     * proves is left, and - where the caller says so - no more than it
     * actually rendered.
     */
    const countOnPage: number = Math.min(
      provenOnPage,
      itemsOnPage,
      input.itemsOnCurrentPage === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(input.itemsOnCurrentPage, 0),
    );

    const lastItemNumber: number = alreadySeenCount + countOnPage;

    return {
      firstItemNumber: firstItemNumber,
      lastItemNumber: lastItemNumber,
      isEmpty: lastItemNumber < firstItemNumber,
    };
  }

  /**
   * The page sizes to offer. The size in use is always present and the list
   * stays sorted, so a table restored from a link with `itemsOnPage=37`
   * shows 37 as the selected option instead of silently snapping to 10.
   */
  public static getItemsOnPageOptions(
    itemsOnPage: number,
    options: Array<number> = DefaultItemsOnPageOptions,
  ): Array<number> {
    const validOptions: Array<number> = options.filter((option: number) => {
      return Number.isFinite(option) && option > 0;
    });

    const uniqueOptions: Array<number> = Array.from(new Set(validOptions));

    if (
      Number.isFinite(itemsOnPage) &&
      itemsOnPage > 0 &&
      !uniqueOptions.includes(itemsOnPage)
    ) {
      uniqueOptions.push(itemsOnPage);
    }

    return uniqueOptions.sort((a: number, b: number) => {
      return a - b;
    });
  }
}
