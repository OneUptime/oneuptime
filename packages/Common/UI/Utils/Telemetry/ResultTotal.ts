import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * How many rows a telemetry explorer's query matches — the "712,345 spans"
 * above the traces list (issue #4202).
 *
 * The analytics list endpoints do not say. They skip COUNT(*), which on a
 * wide window scans every matching row, and answer with one page plus
 * whether more rows follow; the `count` they return is a lower bound
 * (`skip + rows + 1`). The explorers used to print that bound as the total —
 * "Showing 1-50 of 51 traces" over a project with hundreds of thousands —
 * so a total is now worked out apart from the list: proven by the page
 * itself when it is the last one, and counted exactly otherwise.
 */

export enum ResultTotalStatus {
  // The list it describes has not answered yet, or the count is running.
  Counting = "counting",
  // `count` is how many rows the query matches.
  Exact = "exact",
  // It could not be counted; `unavailableReason` says why.
  Unavailable = "unavailable",
}

export enum ResultTotalUnavailableReason {
  // The server stopped counting at its time limit: too many rows to count.
  TooManyToCount = "too-many-to-count",
  // The count request failed for any other reason.
  CountFailed = "count-failed",
}

export interface ResultTotal {
  status: ResultTotalStatus;
  // Set when the status is Exact.
  count?: number | undefined;
  // Set when the status is Unavailable.
  unavailableReason?: ResultTotalUnavailableReason | undefined;
}

// The page a list request committed, as far as a total is concerned.
export interface ResultTotalListPage {
  // Rows the page holds.
  rowCount: number;
  // Rows before it: the request's skip.
  skip: number;
  /*
   * The list endpoint's answer to "do more rows follow this page". Undefined
   * when it did not say, and then the page proves nothing about the total.
   */
  hasMore: boolean | undefined;
}

export default class ResultTotalUtil {
  /*
   * The total a page proves on its own, or null when only a count can tell.
   * A page nothing follows has seen every row: the ones skipped to reach it
   * and its own. Except a page past the end of the list (an old link to page
   * 40 of what is now 3 pages) — it holds nothing, and the rows before it are
   * then not known to be `skip`.
   */
  public static getTotalProvenByPage(page: ResultTotalListPage): number | null {
    if (page.hasMore !== false) {
      return null;
    }

    if (page.rowCount === 0 && page.skip > 0) {
      return null;
    }

    return page.skip + page.rowCount;
  }

  /*
   * The fewest rows a page proves exist: everything up to its last row, and
   * one more when the endpoint saw another after it. An empty page proves
   * nothing — not even that the rows it skipped exist.
   */
  public static getLowerBoundProvenByPage(page: ResultTotalListPage): number {
    if (page.rowCount === 0) {
      return 0;
    }

    return page.skip + page.rowCount + (page.hasMore ? 1 : 0);
  }

  /*
   * Why a count request failed, in the terms the explorers explain it in. The
   * API answers an exact count that ran out of time with 408.
   */
  public static getUnavailableReason(
    error: unknown,
  ): ResultTotalUnavailableReason {
    if (error instanceof HTTPErrorResponse && error.statusCode === 408) {
      return ResultTotalUnavailableReason.TooManyToCount;
    }

    return ResultTotalUnavailableReason.CountFailed;
  }

  /*
   * The total a pager may number its pages by and print as "of N", or
   * undefined while there is none — the pager then pages forward on
   * `hasMore` instead. A caller tracking the result total has one once it is
   * exact. One that only says whether more rows follow has one exactly when
   * its page ends the list. One that says neither passes an exact count (a
   * Postgres-backed list), as every explorer used to.
   */
  public static getPagingTotal(input: {
    resultTotal?: ResultTotal | undefined;
    hasMore?: boolean | undefined;
    // The list's own count: exact, or a lower bound when `hasMore` is set.
    totalCount: number;
    // The rows this page holds, and the rows before it.
    rowCount: number;
    skip: number;
  }): number | undefined {
    if (input.resultTotal) {
      return input.resultTotal.status === ResultTotalStatus.Exact
        ? input.resultTotal.count || 0
        : undefined;
    }

    if (input.hasMore === undefined) {
      return input.totalCount;
    }

    return (
      ResultTotalUtil.getTotalProvenByPage({
        rowCount: input.rowCount,
        skip: input.skip,
        hasMore: input.hasMore,
      }) ?? undefined
    );
  }

  /*
   * The count, if there is one. A count lower than what the page itself
   * proves is stale — rows arrived or expired between the two requests — and
   * is raised to the proof rather than printing "50 of 40".
   */
  public static reconcileCount(
    count: number,
    page: ResultTotalListPage,
  ): number {
    const safeCount: number =
      Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

    return Math.max(safeCount, ResultTotalUtil.getLowerBoundProvenByPage(page));
  }
}
