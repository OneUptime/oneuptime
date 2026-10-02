import { describe, expect, test } from "@jest/globals";
import ResultTotalUtil, {
  ResultTotal,
  ResultTotalListPage,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../../UI/Utils/Telemetry/ResultTotal";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";

/*
 * The rules behind a telemetry explorer's "712,345 spans" (issue #4202).
 *
 * The analytics list endpoints answer with one page and whether more rows
 * follow — `count` is only `skip + rows + 1`. The explorers printed that as
 * the total. These are the rules for what a page proves on its own, what a
 * pager may number its pages by, and how a count that disagrees with the
 * page it describes is read.
 */

const page: (
  rowCount: number,
  skip: number,
  hasMore: boolean | undefined,
) => ResultTotalListPage = (
  rowCount: number,
  skip: number,
  hasMore: boolean | undefined,
): ResultTotalListPage => {
  return { rowCount, skip, hasMore };
};

describe("getTotalProvenByPage — a page with nothing after it has seen every row", () => {
  test("the first page of a short list proves its own row count", () => {
    expect(ResultTotalUtil.getTotalProvenByPage(page(12, 0, false))).toBe(12);
  });

  test("a later page that ends the list proves the rows skipped plus its own", () => {
    expect(ResultTotalUtil.getTotalProvenByPage(page(7, 100, false))).toBe(107);
  });

  test("an empty first page proves there is nothing at all", () => {
    expect(ResultTotalUtil.getTotalProvenByPage(page(0, 0, false))).toBe(0);
  });

  test("a page more rows follow proves nothing — only a count can tell", () => {
    expect(ResultTotalUtil.getTotalProvenByPage(page(50, 0, true))).toBeNull();
    expect(
      ResultTotalUtil.getTotalProvenByPage(page(50, 500, true)),
    ).toBeNull();
  });

  test("a page whose endpoint did not say whether more follow proves nothing", () => {
    expect(
      ResultTotalUtil.getTotalProvenByPage(page(12, 0, undefined)),
    ).toBeNull();
  });

  /*
   * An old link to page 40 of what is now three pages: the page is empty,
   * and the 1,950 rows it skipped are not known to exist.
   */
  test("an empty page past the end of the list does not claim the rows it skipped", () => {
    expect(
      ResultTotalUtil.getTotalProvenByPage(page(0, 1950, false)),
    ).toBeNull();
  });
});

describe("getLowerBoundProvenByPage — the fewest rows a page proves exist", () => {
  test("rows through the page, plus the one the endpoint saw after it", () => {
    expect(ResultTotalUtil.getLowerBoundProvenByPage(page(50, 0, true))).toBe(
      51,
    );
    expect(ResultTotalUtil.getLowerBoundProvenByPage(page(50, 100, true))).toBe(
      151,
    );
  });

  test("a page that ends the list proves exactly its rows", () => {
    expect(ResultTotalUtil.getLowerBoundProvenByPage(page(12, 0, false))).toBe(
      12,
    );
  });

  test("an empty page proves nothing, not even the rows it skipped", () => {
    expect(
      ResultTotalUtil.getLowerBoundProvenByPage(page(0, 1950, false)),
    ).toBe(0);
    expect(ResultTotalUtil.getLowerBoundProvenByPage(page(0, 0, true))).toBe(0);
  });
});

describe("getUnavailableReason — why a count could not be shown", () => {
  test("the API's 408 is a count that ran out of time: too many to count", () => {
    expect(
      ResultTotalUtil.getUnavailableReason(
        new HTTPErrorResponse(408, { message: "Counting took too long" }, {}),
      ),
    ).toBe(ResultTotalUnavailableReason.TooManyToCount);
  });

  test("any other failed response is a failed count", () => {
    for (const status of [400, 403, 500, 502, 504]) {
      expect(
        ResultTotalUtil.getUnavailableReason(
          new HTTPErrorResponse(status, { message: "nope" }, {}),
        ),
      ).toBe(ResultTotalUnavailableReason.CountFailed);
    }
  });

  test("errors that are not HTTP responses are failed counts", () => {
    expect(ResultTotalUtil.getUnavailableReason(new Error("offline"))).toBe(
      ResultTotalUnavailableReason.CountFailed,
    );
    expect(ResultTotalUtil.getUnavailableReason("boom")).toBe(
      ResultTotalUnavailableReason.CountFailed,
    );
    expect(ResultTotalUtil.getUnavailableReason(undefined)).toBe(
      ResultTotalUnavailableReason.CountFailed,
    );
  });
});

describe("reconcileCount — a count read against the page it describes", () => {
  test("a count the page agrees with is kept as is", () => {
    expect(ResultTotalUtil.reconcileCount(712345, page(50, 0, true))).toBe(
      712345,
    );
  });

  /*
   * Rows arrive or expire between the list request and the count. A count
   * below what the page itself proves would print "Showing 51-100 of 80".
   */
  test("a stale count below what the page proves is raised to the proof", () => {
    expect(ResultTotalUtil.reconcileCount(80, page(50, 50, true))).toBe(101);
  });

  test("a nonsense count reads as the page's proof, never as a negative or a fraction", () => {
    expect(ResultTotalUtil.reconcileCount(-5, page(50, 0, true))).toBe(51);
    expect(ResultTotalUtil.reconcileCount(Number.NaN, page(10, 0, false))).toBe(
      10,
    );
    expect(ResultTotalUtil.reconcileCount(120.7, page(50, 0, true))).toBe(120);
  });
});

describe("getPagingTotal — which total a pager may number its pages by", () => {
  const exact: (count: number) => ResultTotal = (
    count: number,
  ): ResultTotal => {
    return { status: ResultTotalStatus.Exact, count };
  };

  test("a caller tracking the result total: its count, once exact", () => {
    expect(
      ResultTotalUtil.getPagingTotal({
        resultTotal: exact(712345),
        hasMore: true,
        totalCount: 51,
        rowCount: 50,
        skip: 0,
      }),
    ).toBe(712345);
  });

  test("a caller tracking the result total: none while it is counting or could not count", () => {
    for (const resultTotal of [
      { status: ResultTotalStatus.Counting },
      {
        status: ResultTotalStatus.Unavailable,
        unavailableReason: ResultTotalUnavailableReason.TooManyToCount,
      },
    ] as Array<ResultTotal>) {
      expect(
        ResultTotalUtil.getPagingTotal({
          resultTotal,
          hasMore: true,
          totalCount: 51,
          rowCount: 50,
          skip: 0,
        }),
      ).toBeUndefined();
    }
  });

  /*
   * The bug, in one assertion: an analytics list's `count` (51 over 50
   * rows) must never become the number the footer pages by.
   */
  test("REGRESSION (#4202): the analytics list's lower bound is never a paging total", () => {
    expect(
      ResultTotalUtil.getPagingTotal({
        hasMore: true,
        totalCount: 51,
        rowCount: 50,
        skip: 0,
      }),
    ).toBeUndefined();
  });

  test("only `hasMore`: a page that ends the list proves the total", () => {
    expect(
      ResultTotalUtil.getPagingTotal({
        hasMore: false,
        totalCount: 112,
        rowCount: 12,
        skip: 100,
      }),
    ).toBe(112);
  });

  test("only `hasMore`: an empty page past the end proves nothing", () => {
    expect(
      ResultTotalUtil.getPagingTotal({
        hasMore: false,
        totalCount: 1950,
        rowCount: 0,
        skip: 1950,
      }),
    ).toBeUndefined();
  });

  test("neither: the caller's count is exact, as Postgres-backed lists always were", () => {
    expect(
      ResultTotalUtil.getPagingTotal({
        totalCount: 240,
        rowCount: 25,
        skip: 0,
      }),
    ).toBe(240);
  });
});
