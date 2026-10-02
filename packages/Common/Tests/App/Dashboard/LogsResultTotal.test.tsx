/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The logs explorer's result total (issue #4202).
 *
 * The logs list endpoint skips COUNT(*) and answers with a page plus a lower
 * bound, which the toolbar printed as the total — "101 results · Page 1 of
 * 2" over millions of logs. The explorer now works the total out apart from
 * the list (UseResultTotal) and counts it with `{ exact: true }`. Pinned
 * here, against the real Dashboard LogsViewer over the real Common
 * LogsViewer and a mocked data layer:
 *
 *   - the count is the list's own query, asked for exactly, and only when the
 *     page says more logs follow — a page that ends the list proves it;
 *   - paging the same filters never recounts; new filters count afresh;
 *   - a count that runs out of time, fails or is still out says so;
 *   - a live poll recounts the window it moved to, one count at a time,
 *     keeping the last total on screen meanwhile; realtime refreshes (many a
 *     second on a busy project) do not recount;
 *   - a page for superseded filters landing late cannot stand in for the
 *     newer filters' list;
 *   - the toolbar keeps its total over the Analytics view.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const listenToAnalyticsModelEventMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToAnalyticsModelEvent: (...args: Array<any>) => {
        return listenToAnalyticsModelEventMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (props: {
    children?: React.ReactNode;
  }) => React.ReactElement = (props: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return react.createElement("div", null, props.children);
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

const PAGE_SIZE: number = 100;

const PAST_HOUR_WINDOW: string =
  "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z";
const PAST_DAY_WINDOW: string =
  "2026-09-27T12:00:00.000Z..2026-09-28T12:00:00.000Z";

const TOO_MANY_TO_COUNT: string =
  "Too many to count in time. Narrow the time range for an exact total.";
const COUNT_FAILED: string = "The total could not be counted.";

// How many logs every window holds, for the mocked list endpoint.
let logsInWindow: number = 712345;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

interface ListArgs {
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

interface ListAnswer {
  data: Array<Log>;
  count: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

function makeLogs(count: number, skip: number): Array<Log> {
  const logs: Array<Log> = [];

  for (let index: number = 0; index < count; index++) {
    const log: Log = new Log();
    log.body = `request ${skip + index} served`;
    log.time = new Date(NOW.getTime() - (skip + index) * 1000);
    log.severityText = LogSeverity.Information;
    logs.push(log);
  }

  return logs;
}

// What the analytics list endpoint answers: a page and a lower bound.
function answerList(args: ListArgs): ListAnswer {
  const skip: number = Number(args.skip || 0);
  const limit: number = Number(args.limit || PAGE_SIZE);
  const rows: number = Math.max(Math.min(limit, logsInWindow - skip), 0);
  const hasMore: boolean = skip + rows < logsInWindow;

  return {
    data: makeLogs(rows, skip),
    count: skip + rows + (hasMore ? 1 : 0),
    skip,
    limit,
    hasMore,
  };
}

function listCalls(): Array<ListArgs> {
  return analyticsGetListMock.mock.calls.map(
    (call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    },
  );
}

function lastListCall(): ListArgs {
  const calls: Array<ListArgs> = listCalls();
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

function countCalls(): Array<Array<unknown>> {
  return analyticsCountMock.mock.calls as Array<Array<unknown>>;
}

function countQuery(index: number): Record<string, unknown> {
  const call: Array<unknown> | undefined = countCalls()[index];
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
}

function windowOf(query: Record<string, unknown>): string {
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return `${new Date(time.startValue).toISOString()}..${new Date(
    time.endValue,
  ).toISOString()}`;
}

function toolbar(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

function toolbarTotal(): HTMLElement {
  return within(toolbar()).getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID);
}

function toolbarTotalText(): string | null {
  const total: HTMLElement | null = within(toolbar()).queryByTestId(
    TELEMETRY_RESULT_TOTAL_TEST_ID,
  );
  return total ? total.textContent : null;
}

function toolbarPage(): string | null {
  const page: HTMLElement | null = within(toolbar()).queryByText(/^Page /);
  return page ? page.textContent : null;
}

function footer(): HTMLElement {
  return screen.getByTestId("logs-pagination");
}

function footerSummary(): string {
  return within(footer()).getByTestId("pagination-summary").textContent || "";
}

function pageButtons(): Array<string> {
  return within(footer())
    .queryAllByTestId(/^pagination-page-/)
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

async function renderExplorer(
  props: Partial<React.ComponentProps<typeof DashboardLogsViewer>> = {},
): Promise<void> {
  await act(async () => {
    render(
      <DashboardLogsViewer id="logs-explorer" showFilters={true} {...props} />,
    );
  });

  await waitFor(() => {
    expect(toolbar()).toBeInTheDocument();
  });
}

async function waitForTotal(text: string): Promise<void> {
  await waitFor(() => {
    expect(toolbarTotalText()).toBe(text);
  });
}

async function pickRange(label: string): Promise<void> {
  fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
  fireEvent.click(screen.getByText(label));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  logsInWindow = 712345;

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  listenToAnalyticsModelEventMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(null);
  listenToAnalyticsModelEventMock.mockReturnValue(() => {});

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    return answerList(args as ListArgs);
  });
  analyticsCountMock.mockImplementation(async () => {
    return logsInWindow;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();

    if (url.includes("/telemetry/logs/histogram")) {
      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [
            { time: "2026-09-28 11:20:00", severity: "Information", count: 9 },
          ],
        },
      };
    }

    if (url.includes("/telemetry/logs/analytics")) {
      return {
        data: {
          data: [{ time: "2026-09-28 11:40:00", count: 3, groupValues: {} }],
        },
      };
    }

    if (url.includes("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the logs explorer counts its result set (#4202)", () => {
  test("the count is the list's own query, asked for exactly, once the list says more logs follow", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    expect(countCalls()).toHaveLength(1);

    const [modelType, query, requestOptions, countOptions] = countCalls()[0]!;
    expect(modelType).toBe(Log);
    expect(requestOptions).toBeUndefined();
    expect(countOptions).toEqual({ exact: true });

    // The very query the list was fetched with — not a rebuilt look-alike.
    expect(query).toEqual(lastListCall().query);
    expect(query).toBe(lastListCall().query);
    expect(windowOf(query as Record<string, unknown>)).toBe(PAST_HOUR_WINDOW);

    expect(toolbarTotal()).toHaveAttribute("data-status", "exact");
    expect(toolbarPage()).toBe("Page 1 of 7,124");
    expect(footerSummary()).toBe("Showing 1-100 of 712,345 logs");
    expect(pageButtons()).toEqual(["1", "2", "3", "7,124"]);
  });

  test("a page that ends the list proves the total, and nothing is counted", async () => {
    logsInWindow = 30;

    await renderExplorer();
    await waitForTotal("30 logs");

    expect(toolbarPage()).toBe("Page 1 of 1");
    expect(footerSummary()).toBe("Showing 1-30 of 30 logs");
    expect(analyticsCountMock).not.toHaveBeenCalled();
  });

  test("an empty window reads 0 logs, and nothing is counted", async () => {
    logsInWindow = 0;

    await renderExplorer();
    await waitForTotal("0 logs");

    expect(footerSummary()).toBe("No logs");
    expect(analyticsCountMock).not.toHaveBeenCalled();
  });

  test("REGRESSION: while the count is out, the endpoint's lower bound is not printed as a total", async () => {
    analyticsCountMock.mockImplementation(() => {
      return new Promise<number>(() => {});
    });

    await renderExplorer();
    await waitForTotal("Counting logs…");

    expect(toolbarTotal()).toHaveAttribute("data-status", "counting");
    expect(toolbarPage()).toBe("Page 1");
    expect(toolbar().textContent).not.toContain("101");
    expect(toolbar().textContent).not.toContain("Page 1 of 2");

    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(pageButtons()).toEqual([]);
    expect(
      within(footer()).getByTestId("pagination-next-button"),
    ).not.toBeDisabled();
  });
});

describe("what is counted again, and what is not", () => {
  test("paging through the same filters does not count again", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    fireEvent.click(within(footer()).getByTestId("pagination-page-2"));

    await waitFor(() => {
      expect(lastListCall().skip).toBe(PAGE_SIZE);
    });
    await waitFor(() => {
      expect(footerSummary()).toBe("Showing 101-200 of 712,345 logs");
    });

    expect(toolbarTotalText()).toBe("712,345 logs");
    expect(toolbarPage()).toBe("Page 2 of 7,124");
    expect(countCalls()).toHaveLength(1);
  });

  test("Next while the count is out does not start a second count", async () => {
    const firstCount: Deferred<number> = defer<number>();
    analyticsCountMock.mockImplementation(() => {
      return firstCount.promise;
    });

    await renderExplorer();
    await waitForTotal("Counting logs…");

    fireEvent.click(within(footer()).getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(lastListCall().skip).toBe(PAGE_SIZE);
    });
    await waitFor(() => {
      expect(footerSummary()).toBe("Showing 101-200+ logs");
    });
    expect(countCalls()).toHaveLength(1);

    await act(async () => {
      firstCount.resolve(712345);
    });

    await waitForTotal("712,345 logs");
    expect(footerSummary()).toBe("Showing 101-200 of 712,345 logs");
    expect(countCalls()).toHaveLength(1);
  });

  test("new filters are counted afresh, and the old total is not shown for them", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    const secondCount: Deferred<number> = defer<number>();
    analyticsCountMock.mockImplementation(() => {
      return secondCount.promise;
    });

    await pickRange("Past 1 Day");

    await waitFor(() => {
      expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    });
    await waitFor(() => {
      expect(countCalls()).toHaveLength(2);
    });

    expect(windowOf(countQuery(1))).toBe(PAST_DAY_WINDOW);
    expect(countQuery(1)).toEqual(lastListCall().query);
    // The past hour's 712,345 is not this window's total.
    expect(toolbarTotalText()).toBe("Counting logs…");

    await act(async () => {
      secondCount.resolve(9876543);
    });

    await waitForTotal("9,876,543 logs");
    expect(toolbarPage()).toBe("Page 1 of 98,766");
    expect(countCalls()).toHaveLength(2);
  });
});

describe("a total that could not be counted says so", () => {
  test("a count that ran out of time (408)", async () => {
    analyticsCountMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(
        408,
        {
          message:
            "Counting every matching log took longer than 45 seconds. Narrow the time range or add a filter to get an exact total.",
        },
        {},
      );
    });

    await renderExplorer();
    await waitForTotal(`100+ logs · ${TOO_MANY_TO_COUNT}`);

    expect(toolbarTotal()).toHaveAttribute("data-status", "unavailable");
    expect(toolbarPage()).toBe("Page 1");
    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(pageButtons()).toEqual([]);
  });

  test("a count that failed (500)", async () => {
    analyticsCountMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(500, { message: "Server Error" }, {});
    });

    await renderExplorer();
    await waitForTotal(`100+ logs · ${COUNT_FAILED}`);
  });

  test("a count that threw before it was sent", async () => {
    analyticsCountMock.mockImplementation(() => {
      throw new Error("not a function");
    });

    await renderExplorer();
    await waitForTotal(`100+ logs · ${COUNT_FAILED}`);
  });

  test("a failed count is not retried for the same filters", async () => {
    analyticsCountMock.mockImplementation(async () => {
      throw new HTTPErrorResponse(500, { message: "Server Error" }, {});
    });

    await renderExplorer();
    await waitForTotal(`100+ logs · ${COUNT_FAILED}`);

    fireEvent.click(within(footer()).getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(lastListCall().skip).toBe(PAGE_SIZE);
    });
    await waitForTotal(`200+ logs · ${COUNT_FAILED}`);
    expect(countCalls()).toHaveLength(1);
  });
});

describe("live mode", () => {
  test("a live poll recounts the window it moved to, keeping the last total on screen meanwhile", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    const liveCount: Deferred<number> = defer<number>();
    analyticsCountMock.mockImplementation(() => {
      return liveCount.promise;
    });

    // A minute later the reader turns live on: the poll reads a moved window.
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    const liveWindow: string =
      "2026-09-28T11:01:00.000Z..2026-09-28T12:01:00.000Z";

    fireEvent.click(screen.getByRole("button", { name: "Live" }));

    await waitFor(() => {
      expect(windowOf(lastListCall().query)).toBe(liveWindow);
    });
    await waitFor(() => {
      expect(countCalls()).toHaveLength(2);
    });

    // The poll's window, not the one the filters were set with.
    expect(windowOf(countQuery(1))).toBe(liveWindow);
    expect(windowOf(countQuery(1))).not.toBe(PAST_HOUR_WINDOW);
    expect(countCalls()[1]![3]).toEqual({ exact: true });

    // No "Counting logs…" flash on the beat: the last total stands in.
    expect(toolbarTotalText()).toBe("712,345 logs");
    expect(toolbarTotal()).toHaveAttribute("data-status", "exact");

    await act(async () => {
      liveCount.resolve(712999);
    });

    await waitForTotal("712,999 logs");
    expect(countCalls()).toHaveLength(2);
  });

  test("a poll while a count is out starts no second count; when it lands, the newest window is counted once more", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    const counts: Array<Deferred<number>> = [];
    analyticsCountMock.mockImplementation(() => {
      const next: Deferred<number> = defer<number>();
      counts.push(next);
      return next.promise;
    });

    fireEvent.click(screen.getByRole("button", { name: "Live" }));

    await waitFor(() => {
      expect(countCalls()).toHaveLength(2);
    });
    const firstPollWindow: string = windowOf(countQuery(1));

    // The next beat, with that count still out.
    const listCallsBefore: number = listCalls().length;
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    await waitFor(() => {
      expect(listCalls().length).toBeGreaterThan(listCallsBefore);
    });
    const secondPollWindow: string = windowOf(lastListCall().query);
    expect(secondPollWindow).not.toBe(firstPollWindow);

    await flush();
    expect(countCalls()).toHaveLength(2);
    expect(toolbarTotalText()).toBe("712,345 logs");

    // The first live count lands: shown, then the newer beat is counted.
    await act(async () => {
      counts[0]!.resolve(712999);
    });

    await waitForTotal("712,999 logs");
    await waitFor(() => {
      expect(countCalls()).toHaveLength(3);
    });
    expect(windowOf(countQuery(2))).toBe(secondPollWindow);
    expect(toolbarTotalText()).toBe("712,999 logs");

    await act(async () => {
      counts[1]!.resolve(713050);
    });

    await waitForTotal("713,050 logs");
    await flush();
    expect(countCalls()).toHaveLength(3);
  });

  test("a realtime refresh refetches the list but does not count again", async () => {
    getCurrentProjectIdMock.mockReturnValue(
      new ObjectID("9e1b6b0e-0000-4000-8000-000000004202"),
    );

    await renderExplorer({ enableRealtime: true });
    await waitForTotal("712,345 logs");

    fireEvent.click(screen.getByRole("button", { name: "Live" }));

    await waitFor(() => {
      expect(countCalls()).toHaveLength(2);
    });
    await waitForTotal("712,345 logs");
    await flush();

    const listener: ((model: Log) => void) | undefined = (
      listenToAnalyticsModelEventMock.mock.calls[
        listenToAnalyticsModelEventMock.mock.calls.length - 1
      ] as Array<unknown> | undefined
    )?.[1] as ((model: Log) => void) | undefined;
    expect(listener).toBeDefined();

    const listCallsBefore: number = listCalls().length;

    // A burst of inserts, as a busy project sends them.
    for (let index: number = 0; index < 3; index++) {
      await act(async () => {
        listener!(new Log());
      });
      await flush();
    }

    expect(listCalls().length).toBeGreaterThan(listCallsBefore);
    expect(countCalls()).toHaveLength(2);
  });
});

describe("answers that arrive late", () => {
  test("an older page for superseded filters landing after the newer one does not replace the newer list's total", async () => {
    interface HeldList {
      args: ListArgs;
      answer: Deferred<ListAnswer>;
    }

    // Every past-hour page is held (the explorer asks more than once on mount).
    const heldPastHourLists: Array<HeldList> = [];

    analyticsGetListMock.mockImplementation((args: unknown) => {
      const listArgs: ListArgs = args as ListArgs;

      if (windowOf(listArgs.query) === PAST_HOUR_WINDOW) {
        const answer: Deferred<ListAnswer> = defer<ListAnswer>();
        heldPastHourLists.push({ args: listArgs, answer });
        return answer.promise;
      }

      return Promise.resolve(answerList(listArgs));
    });
    analyticsCountMock.mockImplementation(async () => {
      return 4321000;
    });

    await renderExplorer();
    await waitFor(() => {
      expect(heldPastHourLists.length).toBeGreaterThan(0);
    });
    expect(toolbarTotalText()).toBe("Counting logs…");

    await pickRange("Past 1 Day");

    await waitForTotal("4,321,000 logs");
    expect(countCalls()).toHaveLength(1);
    expect(windowOf(countQuery(0))).toBe(PAST_DAY_WINDOW);

    // The past hour's pages finally land.
    await act(async () => {
      for (const held of heldPastHourLists) {
        held.answer.resolve(answerList(held.args));
      }
    });
    await flush();

    // Still the past day's total — not "Counting logs…" over a lost list.
    expect(toolbarTotalText()).toBe("4,321,000 logs");
    expect(countCalls()).toHaveLength(1);
    for (const call of countCalls()) {
      expect(windowOf(call[1] as Record<string, unknown>)).toBe(
        PAST_DAY_WINDOW,
      );
    }
  });
});

describe("the analytics view", () => {
  test("keeps counting: the toolbar's total follows new filters there too", async () => {
    await renderExplorer();
    await waitForTotal("712,345 logs");

    fireEvent.click(screen.getByRole("button", { name: /Analytics/ }));

    analyticsCountMock.mockImplementation(async () => {
      return 9876543;
    });

    await pickRange("Past 1 Day");

    await waitFor(() => {
      expect(countCalls()).toHaveLength(2);
    });
    expect(windowOf(countQuery(1))).toBe(PAST_DAY_WINDOW);
    await waitForTotal("9,876,543 logs");
  });
});
