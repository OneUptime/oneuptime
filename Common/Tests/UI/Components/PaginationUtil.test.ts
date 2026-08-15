import PaginationUtil, {
  DefaultItemsOnPageOptions,
  DefaultMaxVisiblePages,
  ItemRange,
  PageWindowItem,
} from "../../../UI/Components/Pagination/PaginationUtil";
import { describe, expect, it } from "@jest/globals";

describe("PaginationUtil", () => {
  describe("getTotalPageCount", () => {
    it("counts a list that divides evenly", () => {
      expect(PaginationUtil.getTotalPageCount(20, 10)).toBe(2);
      expect(PaginationUtil.getTotalPageCount(100, 10)).toBe(10);
      expect(PaginationUtil.getTotalPageCount(50, 25)).toBe(2);
    });

    it("gives the remainder its own page", () => {
      expect(PaginationUtil.getTotalPageCount(21, 10)).toBe(3);
      expect(PaginationUtil.getTotalPageCount(19, 10)).toBe(2);
      expect(PaginationUtil.getTotalPageCount(1, 10)).toBe(1);
    });

    it("never reports fewer than one page", () => {
      expect(PaginationUtil.getTotalPageCount(0, 10)).toBe(1);
      expect(PaginationUtil.getTotalPageCount(-5, 10)).toBe(1);
    });

    /*
     * The old implementation added a page whenever the count divided evenly,
     * so a 20-row list with 10 rows on a page offered a page 3 that could
     * only ever render empty.
     */
    it("does not offer an empty page past the end of an even split", () => {
      expect(PaginationUtil.getTotalPageCount(20, 10)).not.toBe(3);
      expect(PaginationUtil.getTotalPageCount(1000, 100)).toBe(10);
    });

    it("survives a nonsense page size", () => {
      expect(PaginationUtil.getTotalPageCount(20, 0)).toBe(20);
      expect(PaginationUtil.getTotalPageCount(20, -10)).toBe(20);
      expect(PaginationUtil.getTotalPageCount(20, NaN)).toBe(20);
    });

    it("handles a very large list", () => {
      expect(PaginationUtil.getTotalPageCount(1_000_000, 10)).toBe(100_000);
    });
  });

  describe("clampPageNumber", () => {
    it("leaves a page that exists alone", () => {
      expect(PaginationUtil.clampPageNumber(3, 10)).toBe(3);
      expect(PaginationUtil.clampPageNumber(1, 10)).toBe(1);
      expect(PaginationUtil.clampPageNumber(10, 10)).toBe(10);
    });

    it("pulls a page past the end back to the last page", () => {
      expect(PaginationUtil.clampPageNumber(11, 10)).toBe(10);
      expect(PaginationUtil.clampPageNumber(9_999, 10)).toBe(10);
    });

    it("pulls a page before the start back to page one", () => {
      expect(PaginationUtil.clampPageNumber(0, 10)).toBe(1);
      expect(PaginationUtil.clampPageNumber(-4, 10)).toBe(1);
    });

    it("floors a fractional page", () => {
      expect(PaginationUtil.clampPageNumber(3.9, 10)).toBe(3);
    });

    it("falls back to page one for a value that is not a number", () => {
      expect(PaginationUtil.clampPageNumber(NaN, 10)).toBe(1);
    });
  });

  describe("getPageWindow", () => {
    it("lists every page when they all fit", () => {
      expect(PaginationUtil.getPageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(PaginationUtil.getPageWindow(4, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(PaginationUtil.getPageWindow(2, 3)).toEqual([1, 2, 3]);
    });

    it("lists a single page", () => {
      expect(PaginationUtil.getPageWindow(1, 1)).toEqual([1]);
    });

    it("collapses only the tail while near the start", () => {
      expect(PaginationUtil.getPageWindow(1, 20)).toEqual([
        1,
        2,
        3,
        "ellipsis-end",
        20,
      ]);
      expect(PaginationUtil.getPageWindow(3, 20)).toEqual([
        1,
        2,
        3,
        "ellipsis-end",
        20,
      ]);
    });

    it("collapses only the head while near the end", () => {
      expect(PaginationUtil.getPageWindow(20, 20)).toEqual([
        1,
        "ellipsis-start",
        18,
        19,
        20,
      ]);
      expect(PaginationUtil.getPageWindow(18, 20)).toEqual([
        1,
        "ellipsis-start",
        18,
        19,
        20,
      ]);
    });

    it("collapses both sides in the middle of a long list", () => {
      expect(PaginationUtil.getPageWindow(10, 20)).toEqual([
        1,
        "ellipsis-start",
        10,
        "ellipsis-end",
        20,
      ]);
    });

    /*
     * Five slots is the whole list: where you are, both ends, and a gap on
     * either side standing in for everything else.
     */
    it("spends its slots on the ends and the current page", () => {
      expect(PaginationUtil.getPageWindow(500, 1000)).toEqual([
        1,
        "ellipsis-start",
        500,
        "ellipsis-end",
        1000,
      ]);
    });

    it("always keeps the first and last page reachable in one click", () => {
      for (let page: number = 1; page <= 40; page++) {
        const window: Array<PageWindowItem> = PaginationUtil.getPageWindow(
          page,
          40,
        );

        expect(window[0]).toBe(1);
        expect(window[window.length - 1]).toBe(40);
      }
    });

    it("always contains the current page", () => {
      for (let page: number = 1; page <= 40; page++) {
        expect(PaginationUtil.getPageWindow(page, 40)).toContain(page);
      }
    });

    it("keeps a constant width on a long list", () => {
      for (let page: number = 1; page <= 40; page++) {
        expect(PaginationUtil.getPageWindow(page, 40)).toHaveLength(
          DefaultMaxVisiblePages,
        );
      }
    });

    it("never repeats a page and keeps them ascending", () => {
      for (let page: number = 1; page <= 40; page++) {
        const pageNumbers: Array<number> = PaginationUtil.getPageWindow(
          page,
          40,
        ).filter((item: PageWindowItem) => {
          return typeof item === "number";
        }) as Array<number>;

        expect(new Set(pageNumbers).size).toBe(pageNumbers.length);
        expect(
          [...pageNumbers].sort((a: number, b: number) => {
            return a - b;
          }),
        ).toEqual(pageNumbers);
      }
    });

    /*
     * An ellipsis that hides nothing is a lie - if it sits between pages 1
     * and 3 the reader is told pages were collapsed when only page 2 was.
     */
    it("only draws an ellipsis where at least two pages are hidden", () => {
      for (let page: number = 1; page <= 40; page++) {
        const window: Array<PageWindowItem> = PaginationUtil.getPageWindow(
          page,
          40,
        );

        window.forEach((item: PageWindowItem, index: number) => {
          if (typeof item === "number") {
            return;
          }

          const before: PageWindowItem | undefined = window[index - 1];
          const after: PageWindowItem | undefined = window[index + 1];

          expect(typeof before).toBe("number");
          expect(typeof after).toBe("number");
          expect((after as number) - (before as number)).toBeGreaterThan(2);
        });
      }
    });

    it("clamps a current page that is out of range", () => {
      expect(PaginationUtil.getPageWindow(999, 20)).toEqual(
        PaginationUtil.getPageWindow(20, 20),
      );
      expect(PaginationUtil.getPageWindow(0, 20)).toEqual(
        PaginationUtil.getPageWindow(1, 20),
      );
    });

    it("honours a wider window", () => {
      expect(PaginationUtil.getPageWindow(10, 20, 9)).toEqual([
        1,
        "ellipsis-start",
        8,
        9,
        10,
        11,
        12,
        "ellipsis-end",
        20,
      ]);
    });

    it("refuses a window too small to hold a collapsed list", () => {
      expect(PaginationUtil.getPageWindow(10, 20, 2)).toEqual([
        1,
        "ellipsis-start",
        10,
        "ellipsis-end",
        20,
      ]);
    });

    it("handles a page count of zero as a single page", () => {
      expect(PaginationUtil.getPageWindow(1, 0)).toEqual([1]);
    });
  });

  describe("getItemRange", () => {
    it("prints the first page of a full list", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 1,
        itemsOnPage: 10,
        totalItemsCount: 240,
      });

      expect(range).toEqual({
        firstItemNumber: 1,
        lastItemNumber: 10,
        isEmpty: false,
      });
    });

    it("offsets the range by the pages already passed", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 3,
        itemsOnPage: 25,
        totalItemsCount: 240,
      });

      expect(range.firstItemNumber).toBe(51);
      expect(range.lastItemNumber).toBe(75);
    });

    /*
     * The old label multiplied the page number by the page size, so the last
     * page of a 19-row list read "Showing 11 to 20".
     */
    it("stops the last page at the last row that exists", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 2,
        itemsOnPage: 10,
        totalItemsCount: 19,
      });

      expect(range.lastItemNumber).toBe(19);
    });

    it("reports an empty list as empty", () => {
      expect(
        PaginationUtil.getItemRange({
          currentPageNumber: 1,
          itemsOnPage: 10,
          totalItemsCount: 0,
        }).isEmpty,
      ).toBe(true);
    });

    it("reports a page past the end of the list as empty", () => {
      expect(
        PaginationUtil.getItemRange({
          currentPageNumber: 5,
          itemsOnPage: 10,
          totalItemsCount: 19,
        }).isEmpty,
      ).toBe(true);
    });

    it("clamps to the rows the page actually rendered", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 1,
        itemsOnPage: 10,
        totalItemsCount: 11,
        itemsOnCurrentPage: 10,
      });

      expect(range.lastItemNumber).toBe(10);
    });

    it("ignores a rendered row count larger than the count proves", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 2,
        itemsOnPage: 10,
        totalItemsCount: 13,
        itemsOnCurrentPage: 10,
      });

      expect(range.lastItemNumber).toBe(13);
    });

    it("treats a page that rendered nothing as empty", () => {
      expect(
        PaginationUtil.getItemRange({
          currentPageNumber: 2,
          itemsOnPage: 10,
          totalItemsCount: 30,
          itemsOnCurrentPage: 0,
        }).isEmpty,
      ).toBe(true);
    });

    it("treats a nonsense page size as one row to a page", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 1,
        itemsOnPage: 0,
        totalItemsCount: 5,
      });

      expect(range.firstItemNumber).toBe(1);
      expect(range.lastItemNumber).toBe(1);
    });

    it("never reports more rows than fit on a page", () => {
      const range: ItemRange = PaginationUtil.getItemRange({
        currentPageNumber: 1,
        itemsOnPage: 10,
        totalItemsCount: 1_000_000,
      });

      expect(range.lastItemNumber).toBe(10);
    });
  });

  describe("getItemsOnPageOptions", () => {
    it("offers the defaults when the page size is one of them", () => {
      expect(PaginationUtil.getItemsOnPageOptions(10)).toEqual(
        DefaultItemsOnPageOptions,
      );
    });

    /*
     * A shared link can carry any page size, and a select whose value is not
     * in its option list silently renders as the first option instead.
     */
    it("adds the page size in use when it is not a default", () => {
      expect(PaginationUtil.getItemsOnPageOptions(37)).toEqual([
        10, 20, 25, 37, 50, 100,
      ]);
    });

    it("keeps the list sorted when the page size is the largest", () => {
      expect(PaginationUtil.getItemsOnPageOptions(1000)).toEqual([
        10, 20, 25, 50, 100, 1000,
      ]);
    });

    it("honours a caller's own option list", () => {
      expect(PaginationUtil.getItemsOnPageOptions(50, [50, 100, 250])).toEqual([
        50, 100, 250,
      ]);
    });

    it("drops duplicate and meaningless options", () => {
      expect(
        PaginationUtil.getItemsOnPageOptions(10, [10, 10, 0, -5, 20]),
      ).toEqual([10, 20]);
    });

    it("ignores a page size that is not a usable number", () => {
      expect(PaginationUtil.getItemsOnPageOptions(0)).toEqual(
        DefaultItemsOnPageOptions,
      );
      expect(PaginationUtil.getItemsOnPageOptions(NaN)).toEqual(
        DefaultItemsOnPageOptions,
      );
    });

    it("does not mutate the caller's option list", () => {
      const options: Array<number> = [100, 10];
      PaginationUtil.getItemsOnPageOptions(50, options);
      expect(options).toEqual([100, 10]);
    });
  });
});
