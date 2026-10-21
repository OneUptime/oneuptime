import { afterEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import useResultTotal, {
  ResultTotalListAnswer,
  UseResultTotalOptions,
} from "../../../../UI/Utils/Telemetry/UseResultTotal";
import {
  ResultTotal,
  ResultTotalListPage,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../../UI/Utils/Telemetry/ResultTotal";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";

/*
 * useResultTotal works out how many rows a telemetry explorer's query
 * matches (issue #4202), apart from the list: the analytics list endpoints
 * answer with a page and whether more follow, never a total.
 *
 * What is pinned: a page that ends the list proves the total and nothing is
 * counted; otherwise each query is counted once, exactly, and only the
 * newest query's answer is shown; a refresh recounts while the last total
 * stays on screen; a failure says why; nothing is counted for a total nobody
 * can see.
 */

interface Query {
  name: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
};

const flushPromises: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
};

const answer: (
  query: Query,
  page: ResultTotalListPage,
) => ResultTotalListAnswer<Query> = (
  query: Query,
  page: ResultTotalListPage,
): ResultTotalListAnswer<Query> => {
  return { query, page };
};

// 50 rows on page 1, and more after them: only a count can tell the total.
const FIRST_PAGE_MORE: ResultTotalListPage = {
  rowCount: 50,
  skip: 0,
  hasMore: true,
};

type HookProps = UseResultTotalOptions<Query>;

const renderTotal: (initial: HookProps) => {
  result: { current: ResultTotal };
  rerender: (props: HookProps) => void;
} = (
  initial: HookProps,
): {
  result: { current: ResultTotal };
  rerender: (props: HookProps) => void;
} => {
  const rendered: {
    result: { current: ResultTotal };
    rerender: (props: HookProps) => void;
  } = renderHook(
    (props: HookProps): ResultTotal => {
      return useResultTotal<Query>(props);
    },
    { initialProps: initial },
  );
  return rendered;
};

afterEach(() => {
  cleanup();
});

describe("useResultTotal — before and without a count", () => {
  test("counting until this query's list answers, and nothing is counted meanwhile", async () => {
    const countRows: MockFunction = getJestMockFunction();
    const query: Query = { name: "past hour" };

    const { result } = renderTotal({
      query,
      listAnswer: null,
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });

    await flushPromises();

    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });
    expect(countRows).not.toHaveBeenCalled();
  });

  test("a page that ends the list proves the total: exact, and no count is asked for", async () => {
    const countRows: MockFunction = getJestMockFunction();
    const query: Query = { name: "narrow search" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, { rowCount: 12, skip: 0, hasMore: false }),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });

    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 12,
    });
    expect(countRows).not.toHaveBeenCalled();
  });

  test("an empty list is an exact zero without a count", async () => {
    const countRows: MockFunction = getJestMockFunction();
    const query: Query = { name: "nothing" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, { rowCount: 0, skip: 0, hasMore: false }),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });

    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 0,
    });
    expect(countRows).not.toHaveBeenCalled();
  });

  test("a page fetched for another query says nothing about this one", async () => {
    const countRows: MockFunction = getJestMockFunction();
    const previous: Query = { name: "before the filter" };
    const current: Query = { name: "after the filter" };

    const { result } = renderTotal({
      query: current,
      listAnswer: answer(previous, { rowCount: 3, skip: 0, hasMore: false }),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });

    await flushPromises();

    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });
    expect(countRows).not.toHaveBeenCalled();
  });

  test("nothing is counted while the list is not on screen", async () => {
    const countRows: MockFunction = getJestMockFunction();
    const query: Query = { name: "analytics view" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
      isEnabled: false,
    });

    await flushPromises();

    expect(countRows).not.toHaveBeenCalled();
    expect(result.current.status).toBe(ResultTotalStatus.Counting);
  });
});

describe("useResultTotal — counting", () => {
  test("more rows follow: the query is counted once, and the total is exact", async () => {
    const count: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction().mockReturnValue(
      count.promise,
    );
    const query: Query = { name: "past hour" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });

    await flushPromises();

    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });
    expect(countRows).toHaveBeenCalledTimes(1);
    // The list's own query, so the total counts the rows the list pages through.
    expect(countRows.mock.calls[0]![0]).toBe(query);

    count.resolve(712345);
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 712345,
    });
  });

  test("paging through the same query never counts it again", async () => {
    const countRows: MockFunction =
      getJestMockFunction().mockResolvedValue(712345);
    const query: Query = { name: "past hour" };
    const props: HookProps = {
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    };

    const { result, rerender } = renderTotal(props);
    await flushPromises();

    for (const skip of [50, 100, 150]) {
      rerender({
        ...props,
        listAnswer: answer(query, { rowCount: 50, skip, hasMore: true }),
      });
      await flushPromises();
    }

    expect(countRows).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 712345,
    });
  });

  test("a new query is counted afresh, and reads counting until its count lands", async () => {
    const first: Deferred<number> = deferred<number>();
    const second: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const pastHour: Query = { name: "past hour" };
    const errorsOnly: Query = { name: "status:error" };
    const typedCountRows: (query: Query) => Promise<number> =
      countRows as unknown as (query: Query) => Promise<number>;

    const { result, rerender } = renderTotal({
      query: pastHour,
      listAnswer: answer(pastHour, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();
    first.resolve(712345);
    await flushPromises();
    expect(result.current.count).toBe(712345);

    // The filter changes: the old list is still on screen while the new one loads.
    rerender({
      query: errorsOnly,
      listAnswer: answer(pastHour, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();
    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });

    rerender({
      query: errorsOnly,
      listAnswer: answer(errorsOnly, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();
    expect(countRows).toHaveBeenCalledTimes(2);
    expect(countRows.mock.calls[1]![0]).toBe(errorsOnly);
    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });

    second.resolve(204);
    await flushPromises();
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 204,
    });
  });

  /*
   * A wide window is slow to count. Narrowing it starts a new count, and the
   * wide one's answer used to be free to land last.
   */
  test("a superseded query's count landing late never paints over the newer one", async () => {
    const wide: Deferred<number> = deferred<number>();
    const narrow: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction()
      .mockReturnValueOnce(wide.promise)
      .mockReturnValueOnce(narrow.promise);
    const pastMonth: Query = { name: "past month" };
    const pastHour: Query = { name: "past hour" };
    const typedCountRows: (query: Query) => Promise<number> =
      countRows as unknown as (query: Query) => Promise<number>;

    const { result, rerender } = renderTotal({
      query: pastMonth,
      listAnswer: answer(pastMonth, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();

    rerender({
      query: pastHour,
      listAnswer: answer(pastHour, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();
    expect(countRows).toHaveBeenCalledTimes(2);

    narrow.resolve(712345);
    await flushPromises();
    wide.resolve(21370350);
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 712345,
    });
  });

  test("a count below what the page proves is raised to the proof", async () => {
    const countRows: MockFunction = getJestMockFunction().mockResolvedValue(40);
    const query: Query = { name: "past hour" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, { rowCount: 50, skip: 50, hasMore: true }),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 101,
    });
  });

  test("a later page that proves the total wins over waiting for the count", async () => {
    const count: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction().mockReturnValue(
      count.promise,
    );
    const query: Query = { name: "past hour" };
    const typedCountRows: (query: Query) => Promise<number> =
      countRows as unknown as (query: Query) => Promise<number>;

    const { result, rerender } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: typedCountRows,
    });
    await flushPromises();

    rerender({
      query,
      listAnswer: answer(query, { rowCount: 20, skip: 50, hasMore: false }),
      countRows: typedCountRows,
    });
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 70,
    });
    expect(countRows).toHaveBeenCalledTimes(1);
  });
});

describe("useResultTotal — when the count fails", () => {
  test("the server's 408 reads as too many to count", async () => {
    const countRows: MockFunction = getJestMockFunction().mockRejectedValue(
      new HTTPErrorResponse(408, { message: "took too long" }, {}),
    );
    const query: Query = { name: "past month" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Unavailable,
      unavailableReason: ResultTotalUnavailableReason.TooManyToCount,
    });
  });

  test("any other failure reads as a count that failed", async () => {
    const countRows: MockFunction = getJestMockFunction().mockRejectedValue(
      new HTTPErrorResponse(500, { message: "Server Error" }, {}),
    );
    const query: Query = { name: "past hour" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    });
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Unavailable,
      unavailableReason: ResultTotalUnavailableReason.CountFailed,
    });
  });

  /*
   * A count function that throws before it returns a promise (a module
   * that does not offer count at all) used to escape the effect and take
   * the whole explorer down with it.
   */
  test("a count that throws before it starts is a failed count, not a crash", async () => {
    const query: Query = { name: "past hour" };

    const { result } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: (): Promise<number> => {
        throw new TypeError("count is not a function");
      },
    });
    await flushPromises();

    expect(result.current).toEqual({
      status: ResultTotalStatus.Unavailable,
      unavailableReason: ResultTotalUnavailableReason.CountFailed,
    });
  });

  test("a failed count is not retried on its own — paging does not hammer the server", async () => {
    const countRows: MockFunction = getJestMockFunction().mockRejectedValue(
      new HTTPErrorResponse(408, { message: "took too long" }, {}),
    );
    const query: Query = { name: "past month" };
    const props: HookProps = {
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
    };

    const { rerender } = renderTotal(props);
    await flushPromises();
    rerender({
      ...props,
      listAnswer: answer(query, { rowCount: 50, skip: 50, hasMore: true }),
    });
    await flushPromises();

    expect(countRows).toHaveBeenCalledTimes(1);
  });
});

describe("useResultTotal — refreshing", () => {
  test("a refresh counts the same query again, keeping the last total on screen meanwhile", async () => {
    const first: Deferred<number> = deferred<number>();
    const second: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const query: Query = { name: "live past hour" };
    const props: HookProps = {
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
      refreshKey: 0,
    };

    const { result, rerender } = renderTotal(props);
    await flushPromises();
    first.resolve(712345);
    await flushPromises();

    rerender({ ...props, refreshKey: 1 });
    await flushPromises();

    expect(countRows).toHaveBeenCalledTimes(2);
    // No "Counting" flash on every live beat.
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 712345,
    });

    second.resolve(712900);
    await flushPromises();
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 712900,
    });
  });

  /*
   * A count slower than the live poll: replacing it on every beat would
   * drop every answer, and stacking them would multiply the load.
   */
  test("one count at a time: refreshes while one is out wait for it, then count once more", async () => {
    const first: Deferred<number> = deferred<number>();
    const second: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const query: Query = { name: "live past day" };
    const props: HookProps = {
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
      refreshKey: 0,
    };

    const { result, rerender } = renderTotal(props);
    await flushPromises();

    rerender({ ...props, refreshKey: 1 });
    await flushPromises();
    rerender({ ...props, refreshKey: 2 });
    await flushPromises();

    expect(countRows).toHaveBeenCalledTimes(1);

    first.resolve(19000000);
    await flushPromises();

    // The first answer shows, and exactly one more count catches up.
    expect(countRows).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 19000000,
    });

    second.resolve(19000500);
    await flushPromises();
    expect(countRows).toHaveBeenCalledTimes(2);
    expect(result.current.count).toBe(19000500);
  });

  test("after a failure, a refresh reads counting rather than the old failure", async () => {
    const retry: Deferred<number> = deferred<number>();
    const countRows: MockFunction = getJestMockFunction()
      .mockRejectedValueOnce(new HTTPErrorResponse(500, { message: "x" }, {}))
      .mockReturnValueOnce(retry.promise);
    const query: Query = { name: "past hour" };
    const props: HookProps = {
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: countRows as unknown as (query: Query) => Promise<number>,
      refreshKey: 0,
    };

    const { result, rerender } = renderTotal(props);
    await flushPromises();
    expect(result.current.status).toBe(ResultTotalStatus.Unavailable);

    rerender({ ...props, refreshKey: 1 });
    await flushPromises();
    expect(result.current).toEqual({ status: ResultTotalStatus.Counting });

    retry.resolve(5000);
    await flushPromises();
    expect(result.current).toEqual({
      status: ResultTotalStatus.Exact,
      count: 5000,
    });
  });

  test("the newest count function is the one called, without counting again for it", async () => {
    const first: MockFunction = getJestMockFunction().mockResolvedValue(10);
    const second: MockFunction = getJestMockFunction().mockResolvedValue(20);
    const query: Query = { name: "past hour" };

    const { rerender } = renderTotal({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: first as unknown as (query: Query) => Promise<number>,
      refreshKey: 0,
    });
    await flushPromises();

    // A re-render hands in a new inline arrow: no recount for it alone.
    rerender({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: second as unknown as (query: Query) => Promise<number>,
      refreshKey: 0,
    });
    await flushPromises();
    expect(second).not.toHaveBeenCalled();

    rerender({
      query,
      listAnswer: answer(query, FIRST_PAGE_MORE),
      countRows: second as unknown as (query: Query) => Promise<number>,
      refreshKey: 1,
    });
    await flushPromises();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
