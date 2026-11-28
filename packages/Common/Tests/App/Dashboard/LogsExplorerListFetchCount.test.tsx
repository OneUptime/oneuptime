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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The log list is the most expensive request the logs explorer makes: on a
 * long window with attribute filters it is the one that runs closest to the
 * server's query timeout. The viewer's base-scope pass used to re-stamp,
 * right after mount, the very query its initializer had just built — only
 * the clock under a relative window had moved on — and reset a page restored
 * from the URL, so every page load (a refresh, a shared link, an edited
 * URL) ran the list query twice.
 *
 * The real DashboardLogsViewer is mounted against a mocked data layer so
 * the requests can be counted. Recharts is stood in for with a chart that
 * lays each bucket out as a div (see LogsExplorerTimeRangeZoom.test.tsx).
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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
      getCurrentProjectId: () => {
        return null;
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

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
  }

  const chart: (props: StubChartProps) => React.ReactElement = (
    props: StubChartProps,
  ): React.ReactElement => {
    return react.createElement(
      "div",
      null,
      props.data.map((row: StubRow) => {
        return react.createElement("div", {
          key: row.time,
          "data-testid": `bucket-${row.time}`,
        });
      }),
      props.children,
    );
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
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HIST_A: string = "2026-09-28 11:20:00";
const PAGE_SIZE: number = 100;
const ONE_DAY_MS: number = 24 * 60 * 60 * 1000;

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

type ListCall = {
  query: Record<string, unknown>;
  skip: number;
  limit: number;
};

function postsTo(path: string): Array<Record<string, any>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: PostArgs): Record<string, any> => {
      return args.data;
    });
}

function listCalls(): Array<ListCall> {
  return analyticsGetListMock.mock.calls.map(
    (call: Array<unknown>): ListCall => {
      return call[0] as ListCall;
    },
  );
}

function windowLengthMs(query: Record<string, unknown>): number {
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return time.endValue.getTime() - time.startValue.getTime();
}

type ExplorerProps = {
  serviceIds: Array<ObjectID>;
};

function explorer(props: ExplorerProps): React.ReactElement {
  return (
    <DashboardLogsViewer
      showFilters={true}
      serviceIds={props.serviceIds}
      limit={PAGE_SIZE}
      enableRealtime={true}
      id="logs"
      syncUrlState={true}
    />
  );
}

async function settle(): Promise<void> {
  for (let pass: number = 0; pass < 2; pass++) {
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function renderExplorer(): Promise<RenderResult> {
  let result: RenderResult | undefined;

  await act(async () => {
    result = render(explorer({ serviceIds: [] }));
  });

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
  });

  await settle();

  return result!;
}

function forgetRequests(): void {
  analyticsGetListMock.mockClear();
  postMock.mockClear();
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Search logs/) as HTMLInputElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  /*
   * Enough rows that a page restored from the URL is a real page: the
   * viewer steps back to the last page when a result is shorter than that.
   */
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 10000, skip: 0, limit: PAGE_SIZE };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/logs/histogram")) {
      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [{ time: HIST_A, severity: "Error", count: 2 }],
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

describe("Logs explorer list fetches", () => {
  test("a page load runs the list query once", async () => {
    await renderExplorer();

    expect(listCalls()).toHaveLength(1);
    expect(postsTo("/telemetry/logs/histogram")).toHaveLength(1);
    expect(postsTo("/telemetry/logs/facets")).toHaveLength(1);
  });

  test("a shared link's chips, window and page reach the one list query its page load runs", async () => {
    const filters: string = JSON.stringify([
      ["severityText", ["Error"]],
      ["attributes.RequestPath", ["/api"]],
    ]);
    window.history.replaceState(
      {},
      "",
      `/?filters=${encodeURIComponent(filters)}&range=${encodeURIComponent(
        TimeRange.PAST_ONE_DAY,
      )}&page=3`,
    );

    await renderExplorer();

    expect(listCalls()).toHaveLength(1);

    const call: ListCall = listCalls()[0]!;
    expect(windowLengthMs(call.query)).toBe(ONE_DAY_MS);
    expect(JSON.stringify(call.query["severityText"])).toContain("Error");
    expect(
      (call.query["attributes"] as Record<string, unknown>)["RequestPath"],
    ).toBe("/api");
    expect(call.skip).toBe(2 * PAGE_SIZE);
    expect(call.limit).toBe(PAGE_SIZE);
  });

  test("each search the reader starts runs the list query once", async () => {
    await renderExplorer();

    forgetRequests();
    fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
    fireEvent.click(screen.getByText("Past 1 Day"));
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(windowLengthMs(listCalls()[0]!.query)).toBe(ONE_DAY_MS);

    forgetRequests();
    fireEvent.focus(searchInput());
    fireEvent.change(searchInput(), {
      target: { value: "@RequestPath:/api" },
    });
    fireEvent.keyDown(searchInput(), { key: "Enter" });
    await settle();

    expect(listCalls()).toHaveLength(1);
    expect(
      (listCalls()[0]!.query["attributes"] as Record<string, unknown>)[
        "RequestPath"
      ],
    ).toBe("/api");

    forgetRequests();
    fireEvent.change(searchInput(), { target: { value: "timeout" } });
    fireEvent.keyDown(searchInput(), { key: "Enter" });
    await settle();

    expect(listCalls()).toHaveLength(1);
  });

  test("a host handing over an equal scope again does not run the list query again", async () => {
    const view: RenderResult = await renderExplorer();

    forgetRequests();
    // The Logs page passes a fresh `serviceIds={[]}` on every render.
    view.rerender(explorer({ serviceIds: [] }));
    await settle();

    expect(listCalls()).toHaveLength(0);
  });

  test("a host's new scope runs the list query once, from the first page", async () => {
    window.history.replaceState(
      {},
      "",
      `/?range=${encodeURIComponent(TimeRange.PAST_ONE_HOUR)}&page=2`,
    );
    const view: RenderResult = await renderExplorer();
    expect(listCalls()[0]!.skip).toBe(PAGE_SIZE);

    const serviceId: ObjectID = new ObjectID(
      "6f1b2d3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    );

    forgetRequests();
    view.rerender(explorer({ serviceIds: [serviceId] }));
    await settle();

    expect(listCalls()).toHaveLength(1);

    const call: ListCall = listCalls()[0]!;
    expect(call.query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(JSON.stringify(call.query["primaryEntityId"])).toContain(
      serviceId.toString(),
    );
    expect(call.skip).toBe(0);
  });
});
