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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4709: the logs explorer ran its list query twice on every page load
 * and lost the page a reload or a shared link restored.
 *
 * The viewer's base-scope effect ran right after mount and rebuilt the list
 * query the state initializer had just built - the same filters, with a
 * relative window resolved again a few milliseconds later - so the list was
 * read a second time, and the effect put the page back to 1. A 30-day search
 * with four attribute filters ran twice at ~74 CPU-seconds each.
 *
 * Pinned here, against the real Dashboard LogsViewer over the real Common
 * LogsViewer and a mocked data layer, as the number of list requests:
 *
 *   - one per page load - a plain open, a reload with a relative range and a
 *     page, chips, a custom window or a page size in the URL, an embed, a
 *     pinned window - and the page, filters and range the URL restored stay;
 *   - one per real change - a facet, a chip, a range, a page, a page size, a
 *     typed search, a new host scope or pin - and none when a host re-renders
 *     with the same scope;
 *   - live mode: turning it on reads up to now once, turning it off reads
 *     nothing, every beat reads once, and a beat never stacks on a request
 *     still out;
 *   - an answer for a query the reader has left never paints the list;
 *   - a saved view that applies on load (the URL names one, or the project
 *     default) is waited for, so the list, the chart and the facets read
 *     once, what the page shows, on the page the URL named;
 *   - an old link to a page past the end goes back to page 1 in one step
 *     rather than one request per page.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

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
      listenToAnalyticsModelEvent: () => {
        return () => {};
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

import DashboardLogsViewer, {
  INITIAL_SAVED_VIEW_WAIT_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { LOGS_TABLE_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsTable";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSavedView from "../../../Models/DatabaseModels/LogSavedView";
import LogSeverity from "../../../Types/Log/LogSeverity";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { serializeSavedViewTimeRange } from "../../../Utils/Telemetry/SavedViewTimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SERVICE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAVED_VIEW_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEFAULT_VIEW_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const PAGE_SIZE: number = 100;

const PAST_HOUR_WINDOW: string =
  "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z";
const PAST_DAY_WINDOW: string =
  "2026-09-27T12:00:00.000Z..2026-09-28T12:00:00.000Z";
const CUSTOM_WINDOW: string =
  "2026-09-20T08:00:00.000Z..2026-09-20T09:30:00.000Z";

// How many logs every window holds, for the mocked list endpoint.
let logsInWindow: number = 712345;

// The project's saved views, as the saved-views read answers them.
let savedViews: Array<LogSavedView> = [];

// When set, the saved-views read waits for it.
let savedViewsGate: Promise<void> | null = null;

// When set, the next list request waits for the gate it takes from here.
let listGates: Array<Deferred<void>> = [];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((res: (value: T) => void) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  skip: number;
  limit: number;
  sort: Record<string, unknown>;
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
function answerList(args: ListArgs): {
  data: Array<Log>;
  count: number;
  skip: number;
  limit: number;
  hasMore: boolean;
} {
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
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === Log;
    });
}

function lastListCall(): ListArgs {
  const calls: Array<ListArgs> = listCalls();
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

function postsTo(path: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return String((call[0] as { url: unknown }).url).endsWith(path);
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    });
}

function histogramRequests(): Array<Record<string, unknown>> {
  return postsTo("/telemetry/logs/histogram");
}

function facetRequests(): Array<Record<string, unknown>> {
  return postsTo("/telemetry/logs/facets");
}

function savedViewReads(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { modelType: unknown }).modelType === LogSavedView;
  }).length;
}

function windowOf(query: Record<string, unknown>): string {
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return `${new Date(time.startValue).toISOString()}..${new Date(
    time.endValue,
  ).toISOString()}`;
}

function urlParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function toolbar(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

function footer(): HTMLElement {
  return screen.getByTestId("logs-pagination");
}

function footerSummary(): string {
  return within(footer()).getByTestId("pagination-summary").textContent || "";
}

function makeSavedView(input: {
  id: string;
  name: string;
  query: Record<string, unknown>;
  range: TimeRange;
  isDefault?: boolean;
  pageSize?: number;
}): LogSavedView {
  const savedView: LogSavedView = new LogSavedView();
  savedView.id = new ObjectID(input.id);
  savedView.name = input.name;
  savedView.query = input.query as any;
  savedView.timeRange = serializeSavedViewTimeRange({
    range: input.range,
  }) as any;
  savedView.columns = [];
  savedView.sortField = "time";
  savedView.sortOrder = SortOrder.Descending;
  savedView.pageSize = input.pageSize || PAGE_SIZE;
  savedView.isDefault = Boolean(input.isDefault);
  return savedView;
}

// A view of the project's errors, over the past day.
function errorsView(options: { isDefault?: boolean } = {}): LogSavedView {
  return makeSavedView({
    id: options.isDefault ? DEFAULT_VIEW_ID : SAVED_VIEW_ID,
    name: options.isDefault ? "Team default" : "Checkout errors",
    query: {
      severityText: new Includes([LogSeverity.Error]),
      body: new Search("checkout"),
    },
    range: TimeRange.PAST_ONE_DAY,
    isDefault: Boolean(options.isDefault),
  });
}

type ViewerProps = Partial<React.ComponentProps<typeof DashboardLogsViewer>>;

// The main /logs page, exactly as Pages/Logs/Index renders the viewer.
function explorer(props: ViewerProps = {}): React.ReactElement {
  return (
    <DashboardLogsViewer
      showFilters={true}
      serviceIds={[]}
      limit={100}
      enableRealtime={true}
      id="logs"
      syncUrlState={true}
      {...props}
    />
  );
}

async function mount(element: React.ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;

  await act(async () => {
    result = render(element);
  });

  await waitFor(() => {
    expect(toolbar()).toBeInTheDocument();
  });

  await settle();

  return result!;
}

// Lets every answer land and every effect it causes run.
async function settle(): Promise<void> {
  for (let round: number = 0; round < 6; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function openAt(search: string): Promise<RenderResult> {
  window.history.replaceState({}, "", `/dashboard/project/logs${search}`);
  return mount(explorer());
}

async function pickRange(label: string): Promise<void> {
  fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
  fireEvent.click(screen.getByText(label));
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  logsInWindow = 712345;
  savedViews = [];
  savedViewsGate = null;
  listGates = [];

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();
  getCurrentProjectIdMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);

  getListMock.mockImplementation(async (args: unknown) => {
    if ((args as { modelType: unknown }).modelType === LogSavedView) {
      if (savedViewsGate) {
        await savedViewsGate;
      }
      return {
        data: savedViews,
        count: savedViews.length,
        skip: 0,
        limit: 100,
      };
    }
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const gate: Deferred<void> | undefined = listGates.shift();
    if (gate) {
      await gate.promise;
    }
    return answerList(args as ListArgs);
  });
  analyticsCountMock.mockImplementation(async () => {
    return logsInWindow;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();

    if (url.endsWith("/telemetry/logs/histogram")) {
      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [
            { time: "2026-09-28 11:20:00", severity: "Information", count: 9 },
          ],
        },
      };
    }

    if (url.endsWith("/telemetry/logs/facets")) {
      return {
        data: {
          facets: {
            severityText: [
              { value: "Error", count: 12 },
              { value: "Information", count: 40 },
            ],
          },
        },
      };
    }

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a page load reads the list once (#4709)", () => {
  test("a plain open: one list request for the default window, one chart and one facet read", async () => {
    await openAt("");

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().skip).toBe(0);
    expect(lastListCall().limit).toBe(PAGE_SIZE);
    expect(windowOf(lastListCall().query)).toBe(PAST_HOUR_WINDOW);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);

    // One exact count of that very query, since more logs follow its page.
    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    expect(analyticsCountMock.mock.calls[0]![1]).toBe(lastListCall().query);
  });

  test("REGRESSION: a reload with a relative range and a page reads that page once, and the page stays", async () => {
    await openAt("?range=Past%201%20Day&page=3");

    // Not twice: once for page 3, then again for page 1 a moment later.
    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().skip).toBe(2 * PAGE_SIZE);
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);

    // The page the URL restored is the page on screen, and stays in the URL.
    expect(footerSummary()).toBe("Showing 201-300 of 712,345 logs");
    expect(urlParams().get("page")).toBe("3");
    expect(urlParams().get("range")).toBe(TimeRange.PAST_ONE_DAY);

    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
  });

  test("the relative window is resolved once, when the page loads, though the clock moves on", async () => {
    /*
     * Every list answer takes a second and a half, as a long search does.
     * Before the fix the effect's rebuild resolved the window again after
     * the first request went out, so the second request read a later window.
     */
    analyticsGetListMock.mockImplementation(async (args: unknown) => {
      jest.setSystemTime(new Date(Date.now() + 1500));
      return answerList(args as ListArgs);
    });

    await openAt("?range=Past%201%20Day");
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
  });

  test("chips restored from the URL are in the one request, and on screen", async () => {
    await openAt(
      `?range=Past%201%20Hour&filters=${encodeURIComponent(
        JSON.stringify([["severityText", ["Error"]]]),
      )}`,
    );

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["severityText"]).toBe("Error");
    expect(screen.getByTitle("Remove Severity: Error")).toBeInTheDocument();
    expect(JSON.parse(urlParams().get("filters") || "[]")).toEqual([
      ["severityText", ["Error"]],
    ]);
  });

  test("an attribute chip restored from the URL is in the one request", async () => {
    await openAt(
      `?range=Past%201%20Hour&filters=${encodeURIComponent(
        JSON.stringify([["attributes.http.route", ["/orders"]]]),
      )}`,
    );

    expect(listCalls()).toHaveLength(1);
    expect(
      (lastListCall().query["attributes"] as Record<string, unknown>)[
        "http.route"
      ],
    ).toBeDefined();
  });

  test("a custom window restored from the URL is read once, exactly", async () => {
    await openAt(
      "?range=Custom&start=2026-09-20T08%3A00%3A00.000Z&end=2026-09-20T09%3A30%3A00.000Z&page=2",
    );

    expect(listCalls()).toHaveLength(1);
    expect(windowOf(lastListCall().query)).toBe(CUSTOM_WINDOW);
    expect(lastListCall().skip).toBe(PAGE_SIZE);
    expect(urlParams().get("start")).toBe("2026-09-20T08:00:00.000Z");
    expect(urlParams().get("page")).toBe("2");
  });

  test("a page size restored from the URL is in the one request", async () => {
    await openAt("?range=Past%201%20Hour&page=2&pageSize=50");

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().limit).toBe(50);
    expect(lastListCall().skip).toBe(50);
    expect(footerSummary()).toBe("Showing 51-100 of 712,345 logs");
    expect(urlParams().get("pageSize")).toBe("50");
  });

  test("an old link to a page past the end goes back to page 1 in one step", async () => {
    logsInWindow = 150;

    await openAt("?range=Past%201%20Hour&page=40");

    /*
     * The empty page 40, then page 1 - not page 39, 38, ... one request
     * each, which reading the lower-bound count as a total did.
     */
    expect(
      listCalls().map((call: ListArgs): number => {
        return call.skip;
      }),
    ).toEqual([39 * PAGE_SIZE, 0]);
    expect(footerSummary()).toBe("Showing 1-100 of 150 logs");
    expect(urlParams().get("page")).toBeNull();
  });

  test("an empty page whose count still says rows follow it stays where it is", async () => {
    // Rows that went between two reads: the count does not prove an end.
    analyticsGetListMock.mockImplementation(async (args: unknown) => {
      const skip: number = Number((args as ListArgs).skip || 0);
      return { data: [], count: skip + 50, skip, limit: 100, hasMore: true };
    });

    await openAt("?range=Past%201%20Hour&page=3");

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().skip).toBe(2 * PAGE_SIZE);
    expect(urlParams().get("page")).toBe("3");
  });
});

describe("a real change reads the list once", () => {
  test("picking a range: one request, for that range, from page 1", async () => {
    await openAt("?range=Past%201%20Hour&page=3");
    expect(listCalls()).toHaveLength(1);

    await pickRange("Past 1 Day");

    expect(listCalls()).toHaveLength(2);
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    expect(lastListCall().skip).toBe(0);
    expect(urlParams().get("page")).toBeNull();
  });

  test("a facet click: one request carrying it", async () => {
    await openAt("");
    expect(listCalls()).toHaveLength(1);

    fireEvent.click(await screen.findByTitle("Filter to Error"));
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(lastListCall().query["severityText"]).toBe("Error");
  });

  test("removing a chip the URL restored: one request without it", async () => {
    await openAt(
      `?range=Past%201%20Hour&filters=${encodeURIComponent(
        JSON.stringify([["severityText", ["Error"]]]),
      )}`,
    );
    expect(listCalls()).toHaveLength(1);

    fireEvent.click(screen.getByTitle("Remove Severity: Error"));
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(lastListCall().query["severityText"]).toBeUndefined();
  });

  test("a typed search: one request", async () => {
    await openAt("");

    const input: HTMLElement = screen.getByPlaceholderText(/Search logs/);
    fireEvent.change(input, { target: { value: "connection refused" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();

    expect(listCalls()).toHaveLength(2);
  });

  test("paging: one request per page, and no recount of the same filters", async () => {
    await openAt("");

    fireEvent.click(within(footer()).getByTestId("pagination-page-2"));
    await settle();
    fireEvent.click(within(footer()).getByTestId("pagination-page-3"));
    await settle();

    expect(
      listCalls().map((call: ListArgs): number => {
        return call.skip;
      }),
    ).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE]);
    // The window the filters were set with, not one re-read per page.
    for (const call of listCalls()) {
      expect(windowOf(call.query)).toBe(PAST_HOUR_WINDOW);
    }
    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    expect(urlParams().get("page")).toBe("3");
  });

  test("a new page size: one request, from page 1", async () => {
    await openAt("?range=Past%201%20Hour&page=2");

    fireEvent.change(
      within(footer()).getByTestId("pagination-items-on-page-select"),
      { target: { value: "250" } },
    );
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(lastListCall().limit).toBe(250);
    expect(lastListCall().skip).toBe(0);
  });
});

describe("an embedded viewer reads once, and only on a real change of its scope", () => {
  // A service's Logs tab, as Pages/Service/View/Logs renders it.
  function serviceLogs(serviceId: string): React.ReactElement {
    return (
      <DashboardLogsViewer
        id="service-logs"
        serviceIds={[new ObjectID(serviceId)]}
        showFilters={true}
        enableRealtime={true}
        limit={100}
        noLogsMessage="Logs appear here as soon as this service sends them."
      />
    );
  }

  test("one request on mount, scoped, and the page URL is left alone", async () => {
    window.history.replaceState({}, "", "/dashboard/project/service/x/logs");

    await mount(serviceLogs(SERVICE_ID));

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["primaryEntityId"]).toEqual(
      new Includes([new ObjectID(SERVICE_ID)]),
    );
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
    expect(window.location.search).toBe("");
    // An embed never waits for saved views: no view applies inside a page.
    expect(savedViewReads()).toBe(1);
  });

  test("the page re-rendering with the same scope (new arrays, new ids) reads nothing again", async () => {
    const view: RenderResult = await mount(serviceLogs(SERVICE_ID));
    expect(listCalls()).toHaveLength(1);

    for (let index: number = 0; index < 3; index++) {
      await act(async () => {
        view.rerender(serviceLogs(SERVICE_ID));
      });
      await settle();
    }

    expect(listCalls()).toHaveLength(1);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
  });

  test("a new scope: one request, for it, from page 1", async () => {
    const view: RenderResult = await mount(serviceLogs(SERVICE_ID));

    fireEvent.click(within(footer()).getByTestId("pagination-page-2"));
    await settle();
    expect(listCalls()).toHaveLength(2);

    await act(async () => {
      view.rerender(serviceLogs(OTHER_SERVICE_ID));
    });
    await settle();

    expect(listCalls()).toHaveLength(3);
    expect(lastListCall().skip).toBe(0);
    expect(lastListCall().query["primaryEntityId"]).toEqual(
      new Includes([new ObjectID(OTHER_SERVICE_ID)]),
    );
    expect(histogramRequests()).toHaveLength(2);
    expect(facetRequests()).toHaveLength(2);
  });

  test("a pinned window (an incident's logs): one request for exactly that window", async () => {
    const pinned: () => React.ReactElement = (): React.ReactElement => {
      return (
        <DashboardLogsViewer
          id="incident-logs"
          showFilters={true}
          logQuery={
            {
              severityText: LogSeverity.Error,
              time: new InBetween<Date>(
                new Date("2026-09-20T08:00:00.000Z"),
                new Date("2026-09-20T09:30:00.000Z"),
              ),
            } as any
          }
        />
      );
    };

    const view: RenderResult = await mount(pinned());

    expect(listCalls()).toHaveLength(1);
    expect(windowOf(lastListCall().query)).toBe(CUSTOM_WINDOW);
    expect(lastListCall().query["severityText"]).toBe(LogSeverity.Error);

    // The incident page re-reads its stored query on a background refresh.
    await act(async () => {
      view.rerender(pinned());
    });
    await settle();

    expect(listCalls()).toHaveLength(1);
  });

  test("a new pin from the host: one request for the new window", async () => {
    const pinned: (end: string) => React.ReactElement = (
      end: string,
    ): React.ReactElement => {
      return (
        <DashboardLogsViewer
          id="incident-logs"
          showFilters={true}
          logQuery={
            {
              time: new InBetween<Date>(
                new Date("2026-09-20T08:00:00.000Z"),
                new Date(end),
              ),
            } as any
          }
        />
      );
    };

    const view: RenderResult = await mount(pinned("2026-09-20T09:30:00.000Z"));

    await act(async () => {
      view.rerender(pinned("2026-09-20T10:00:00.000Z"));
    });
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(windowOf(lastListCall().query)).toBe(
      "2026-09-20T08:00:00.000Z..2026-09-20T10:00:00.000Z",
    );
  });
});

describe("live mode", () => {
  function liveButton(): HTMLElement {
    return screen.getByRole("button", { name: "Live" });
  }

  test("turning live on reads up to now once; turning it off reads nothing", async () => {
    await openAt("");
    expect(listCalls()).toHaveLength(1);
    expect(histogramRequests()).toHaveLength(1);

    // A minute later the reader turns live on.
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    fireEvent.click(liveButton());
    await settle();

    // One request - not the filters' old window AND then the live one.
    expect(listCalls()).toHaveLength(2);
    expect(windowOf(lastListCall().query)).toBe(
      "2026-09-28T11:01:00.000Z..2026-09-28T12:01:00.000Z",
    );
    expect(histogramRequests()).toHaveLength(2);

    fireEvent.click(liveButton());
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(histogramRequests()).toHaveLength(2);
  });

  test("every beat reads once, and a beat never stacks on a request still out", async () => {
    await openAt("");
    fireEvent.click(liveButton());
    await settle();
    expect(listCalls()).toHaveLength(2);

    // The next beat's answer is slow.
    const slow: Deferred<void> = defer<void>();
    listGates.push(slow);

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();
    expect(listCalls()).toHaveLength(3);

    // Two more beats while it is out: nothing new is sent.
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    await settle();
    expect(listCalls()).toHaveLength(3);

    await act(async () => {
      slow.resolve();
    });
    await settle();

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();
    expect(listCalls()).toHaveLength(4);
  });

  test("turning live on from page 3 reads page 1 up to now, once", async () => {
    await openAt("?range=Past%201%20Hour&page=3");
    expect(listCalls()).toHaveLength(1);

    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    fireEvent.click(liveButton());
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(lastListCall().skip).toBe(0);
    expect(windowOf(lastListCall().query)).toBe(
      "2026-09-28T11:01:00.000Z..2026-09-28T12:01:00.000Z",
    );
  });

  test("a new page size while live reads the live window, once", async () => {
    await openAt("");
    fireEvent.click(liveButton());
    await settle();
    expect(listCalls()).toHaveLength(2);

    jest.setSystemTime(new Date(NOW.getTime() + 5 * 60 * 1000));
    fireEvent.change(
      within(footer()).getByTestId("pagination-items-on-page-select"),
      { target: { value: "250" } },
    );
    await settle();

    expect(listCalls()).toHaveLength(3);
    expect(lastListCall().limit).toBe(250);
    expect(windowOf(lastListCall().query)).toBe(
      "2026-09-28T11:05:00.000Z..2026-09-28T12:05:00.000Z",
    );
  });
});

describe("only the newest answer paints the list", () => {
  test("an answer for a range the reader has left does not replace the rows, the page or the loader", async () => {
    await openAt("");

    // The past day is slow; the past two hours answer at once.
    const slowDay: Deferred<void> = defer<void>();
    listGates.push(slowDay);
    analyticsGetListMock.mockImplementation(async (args: unknown) => {
      const gate: Deferred<void> | undefined = listGates.shift();
      if (gate) {
        await gate.promise;
      }
      const answer: ReturnType<typeof answerList> = answerList(
        args as ListArgs,
      );
      // Rows that say which window they answer.
      const label: string = windowOf((args as ListArgs).query);
      answer.data = answer.data.slice(0, 1).map((log: Log): Log => {
        log.body = `answer for ${label}`;
        return log;
      });
      answer.hasMore = false;
      answer.count = 1;
      return answer;
    });

    await pickRange("Past 1 Day");
    await pickRange("Past 2 Hours");

    expect(
      await screen.findByText(
        "answer for 2026-09-28T10:00:00.000Z..2026-09-28T12:00:00.000Z",
      ),
    ).toBeInTheDocument();

    await act(async () => {
      slowDay.resolve();
    });
    await settle();

    expect(
      screen.queryByText(`answer for ${PAST_DAY_WINDOW}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "answer for 2026-09-28T10:00:00.000Z..2026-09-28T12:00:00.000Z",
      ),
    ).toBeInTheDocument();
  });
});

describe("a saved view that applies on load is waited for", () => {
  test("REGRESSION: a reload of a view's page 3 reads the view once, on page 3", async () => {
    savedViews = [errorsView()];

    await openAt(`?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day&page=3`);

    /*
     * Before: the URL's bare scope on page 3, then the view on page 1. Now
     * one request: the view's query, under the URL's window, on its page.
     */
    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().skip).toBe(2 * PAGE_SIZE);
    expect(lastListCall().query["severityText"]).toEqual(
      new Includes([LogSeverity.Error]),
    );
    expect(lastListCall().query["body"]).toEqual(new Search("checkout"));
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);

    expect(urlParams().get("savedView")).toBe(SAVED_VIEW_ID);
    expect(urlParams().get("page")).toBe("3");
    expect(within(toolbar()).getByText("Checkout errors")).toBeInTheDocument();
  });

  test("the URL's page size wins over the view's", async () => {
    savedViews = [errorsView()];

    await openAt(
      `?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day&page=2&pageSize=50`,
    );

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().limit).toBe(50);
    expect(lastListCall().skip).toBe(50);
  });

  test("while the saved views are read, nothing else is", async () => {
    savedViews = [errorsView()];
    const gate: Deferred<void> = defer<void>();
    savedViewsGate = gate.promise;

    await openAt(`?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day`);

    expect(listCalls()).toHaveLength(0);
    expect(histogramRequests()).toHaveLength(0);
    expect(facetRequests()).toHaveLength(0);

    await act(async () => {
      gate.resolve();
    });
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
  });

  test("while the saved views are read, the explorer says it is loading - not that there are no logs", async () => {
    savedViews = [errorsView()];
    const gate: Deferred<void> = defer<void>();
    savedViewsGate = gate.promise;

    await openAt(`?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day&page=2`);

    // The list's loader, with room for the rows; no empty state under it.
    const table: HTMLElement = screen.getByTestId(LOGS_TABLE_TEST_ID);
    expect(table).toHaveClass("min-h-48");
    expect(within(table).getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByText("No logs found")).toBeNull();
    expect(footerSummary()).toBe("Loading...");
    // The page the link named is the page the footer is on.
    expect(
      within(footer()).getByTestId("pagination-current-page-indicator-desktop"),
    ).toHaveTextContent("Page 2");

    await act(async () => {
      gate.resolve();
    });
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(screen.getByTestId(LOGS_TABLE_TEST_ID)).not.toHaveClass("min-h-48");
    expect(footerSummary()).toMatch(/^Showing 101-200/);
  });

  test("turning Live on while the saved views are read sends nothing until they land", async () => {
    savedViews = [errorsView()];
    const gate: Deferred<void> = defer<void>();
    savedViewsGate = gate.promise;

    await openAt(`?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day`);

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    await settle();

    /*
     * A beat now would read - and paint - the query the view is about to
     * replace: the rows this wait is there to keep off the screen.
     */
    expect(listCalls()).toHaveLength(0);
    expect(histogramRequests()).toHaveLength(0);

    await act(async () => {
      gate.resolve();
    });
    await settle();

    // One read: the view's.
    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["severityText"]).toEqual(
      new Includes([LogSeverity.Error]),
    );
  });

  test("a link to a view that is gone reads the link's own scope once, and drops the stale id", async () => {
    savedViews = [];

    await openAt(`?savedView=${SAVED_VIEW_ID}&range=Past%201%20Day&page=2`);

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().skip).toBe(PAGE_SIZE);
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    expect(lastListCall().query["severityText"]).toBeUndefined();
    expect(urlParams().get("savedView")).toBeNull();
  });

  test("a plain open in a project with a default view reads the default view once", async () => {
    savedViews = [errorsView({ isDefault: true })];

    await openAt("");

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["severityText"]).toEqual(
      new Includes([LogSeverity.Error]),
    );
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
    expect(urlParams().get("savedView")).toBe(DEFAULT_VIEW_ID);
  });

  test("a link with a scope of its own does not wait: no view applies to it", async () => {
    savedViews = [errorsView({ isDefault: true })];
    savedViewsGate = new Promise<void>(() => {});

    await openAt("?range=Past%201%20Day");

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["severityText"]).toBeUndefined();
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
  });

  test("an embed does not wait for the saved views", async () => {
    savedViews = [errorsView({ isDefault: true })];
    savedViewsGate = new Promise<void>(() => {});

    await mount(
      <DashboardLogsViewer
        id="service-logs"
        serviceIds={[new ObjectID(SERVICE_ID)]}
        showFilters={true}
      />,
    );

    expect(listCalls()).toHaveLength(1);
    expect(lastListCall().query["severityText"]).toBeUndefined();
  });

  test("saved views that never answer hold the list back no longer than the wait", async () => {
    savedViewsGate = new Promise<void>(() => {});

    await openAt("");
    expect(listCalls()).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(INITIAL_SAVED_VIEW_WAIT_MS - 1);
    });
    await settle();
    expect(listCalls()).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(windowOf(lastListCall().query)).toBe(PAST_HOUR_WINDOW);
    expect(histogramRequests()).toHaveLength(1);
    expect(facetRequests()).toHaveLength(1);
  });

  test("picking a view later is a real change: one request, from page 1", async () => {
    savedViews = [errorsView()];

    await openAt("?range=Past%201%20Hour&page=2");
    expect(listCalls()).toHaveLength(1);

    fireEvent.click(
      within(toolbar()).getByRole("button", { name: /^Saved Views/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Saved views" })).getByRole(
        "button",
        { name: "Checkout errors" },
      ),
    );
    await settle();

    expect(listCalls()).toHaveLength(2);
    expect(lastListCall().skip).toBe(0);
    expect(lastListCall().query["severityText"]).toEqual(
      new Includes([LogSeverity.Error]),
    );
  });
});
