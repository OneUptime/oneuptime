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
 * A LINE'S LINK, FROM ITS ROW AND FROM ITS DETAILS (#9944, #9794).
 *
 * Against the real Dashboard LogsViewer over the real Common LogsViewer and
 * a mocked data layer: a row's Copy Link copies the very link its details'
 * Copy Link copies - the Logs page naming the line, this list's chips over
 * the window its rows were read in, pinned (LogLineLink) - and that window
 * is the rows': while live, the window up to now the latest read took. The
 * link used to pin the filters' window, resolved once, so a line a live
 * list had read since was linked with a list that never held it.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

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

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import {
  COPY_LOG_LINE_LINK_TEST_ID,
  COPY_LOG_ROW_LINK_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/CopyLogLineLinkButton";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import Clipboard from "../../../UI/Utils/Clipboard";
import Log from "../../../Models/AnalyticsModels/Log";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import { EXPLORER_SAVED_VIEW_SCOPE } from "../../../Utils/Telemetry/SavedViewScope";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

// A line's id, as the list reads them: one per second before the read's end.
function lineId(index: number): string {
  return `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
}

// Three lines from the end of whatever window the list reads.
function answerList(args: ListArgs): {
  data: Array<Log>;
  count: number;
  skip: number;
  limit: number;
  hasMore: boolean;
} {
  const time: InBetween<Date> = args.query["time"] as InBetween<Date>;
  const end: number = new Date(time.endValue).getTime();
  const data: Array<Log> = [0, 1, 2].map((index: number): Log => {
    const log: Log = new Log();
    log.body = `request ${index} served`;
    log.time = new Date(end - (index + 1) * 1000);
    log.severityText = LogSeverity.Information;
    log.setColumnValue("_id", lineId(Math.floor(end / 1000) * 10 + index));
    return log;
  });

  return { data, count: data.length, skip: 0, limit: 100, hasMore: false };
}

function lastListWindow(): string {
  const calls: Array<ListArgs> = analyticsGetListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === Log;
    });
  const time: InBetween<Date> = calls[calls.length - 1]!.query[
    "time"
  ] as InBetween<Date>;

  return `${new Date(time.startValue).toISOString()}..${new Date(
    time.endValue,
  ).toISOString()}`;
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

async function openExplorer(): Promise<void> {
  window.history.replaceState({}, "", "/dashboard/project/logs");

  await act(async () => {
    render(
      <DashboardLogsViewer
        showFilters={true}
        serviceIds={[]}
        limit={100}
        enableRealtime={true}
        id="logs"
        savedViewScope={EXPLORER_SAVED_VIEW_SCOPE}
        syncUrlState={true}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toBeInTheDocument();
  });
  await settle();
}

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest("tr") as HTMLElement;
}

// The link a press copied, read: the line, and the list's window.
function readLink(link: string): {
  log: string | null;
  range: string | null;
  window: string;
} {
  const url: URL = new URL(link);

  return {
    log: url.searchParams.get("log"),
    range: url.searchParams.get("range"),
    window: `${url.searchParams.get("start")}..${url.searchParams.get("end")}`,
  };
}

let copy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  // The list scrolls the row under the keyboard into view: nothing to draw here.
  Element.prototype.scrollIntoView = jest.fn() as never;

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();
  getCurrentProjectIdMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 100 });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    return answerList(args as ListArgs);
  });
  analyticsCountMock.mockResolvedValue(3 as never);
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();

    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { bucketSizeInMinutes: 1, buckets: [] } };
    }

    if (url.endsWith("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }

    return { data: {} };
  });

  copy = jest
    .spyOn(Clipboard, "copyToClipboard")
    .mockResolvedValue(true as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a line's link, from its row and from its details", () => {
  test("is one link: the line, over the window the list's rows were read in, pinned", async () => {
    await openExplorer();

    expect(lastListWindow()).toBe(
      "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z",
    );

    await act(async () => {
      fireEvent.click(
        within(rowOf("request 1 served")).getByTestId(
          COPY_LOG_ROW_LINK_TEST_ID,
        ),
      );
    });
    await settle();

    expect(copy).toHaveBeenCalledTimes(1);

    const fromRow: string = copy.mock.calls[0]![0] as string;

    expect(readLink(fromRow)).toEqual({
      log: lineId(Math.floor(NOW.getTime() / 1000) * 10 + 1),
      range: "Custom",
      window: "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z",
    });
    expect(new URL(fromRow).pathname).toMatch(/\/logs$/);
    // Pressing the row's own action opened nothing.
    expect(screen.queryByTestId(COPY_LOG_LINE_LINK_TEST_ID)).toBeNull();

    // Its details, opened, copy the same link.
    fireEvent.click(screen.getByText("request 1 served"));
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId(COPY_LOG_LINE_LINK_TEST_ID));
    });
    await settle();

    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[1]![0]).toBe(fromRow);
  });

  test("while live, names the window up to now the rows on screen were read in", async () => {
    await openExplorer();

    // Half an hour on, the reader turns live on: the list reads up to now.
    jest.setSystemTime(new Date(NOW.getTime() + 30 * 60 * 1000));
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    await settle();

    expect(lastListWindow()).toBe(
      "2026-09-28T11:30:00.000Z..2026-09-28T12:30:00.000Z",
    );

    await act(async () => {
      fireEvent.click(
        within(rowOf("request 0 served")).getByTestId(
          COPY_LOG_ROW_LINK_TEST_ID,
        ),
      );
    });
    await settle();

    const fromRow: string = copy.mock.calls[0]![0] as string;

    // The rows' own window - not the filters' 11:00 to 12:00, which never held them.
    expect(readLink(fromRow).window).toBe(
      "2026-09-28T11:30:00.000Z..2026-09-28T12:30:00.000Z",
    );

    // l, on the row j moves to, copies the same.
    fireEvent.keyDown(document, { key: "j" });
    await settle();
    fireEvent.keyDown(document, { key: "l" });
    await settle();

    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[1]![0]).toBe(fromRow);
  });
});
