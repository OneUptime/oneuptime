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
 * Issue #4105: a zoom made inside a logs explorer that a host pins to a
 * window (a Logs telemetry snapshot on the incident and alert pages, the
 * Logs tab of every snapshot card) must survive the host handing over an
 * equal query again. The incident and alert pages do that on every
 * background refresh (an acknowledge, an edit), and the snapshot card
 * whenever it re-derives its companions. The traces and exceptions
 * explorers already kept their zoom; the logs explorer sent the reader
 * back to the pin and took its "Reset zoom" away.
 *
 * The real DashboardLogsViewer and Common LogsViewer are mounted against a
 * mocked data layer, so the requests can be read back. Recharts is stood in
 * for with a chart that lays each bucket out as a div and forwards the mouse
 * events recharts does (see LogsExplorerTimeRangeZoom.test.tsx).
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
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
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
          onMouseDown: () => {
            props.onMouseDown?.({ activeLabel: row.time });
          },
          onMouseMove: () => {
            props.onMouseMove?.({ activeLabel: row.time });
          },
          onMouseUp: () => {
            props.onMouseUp?.({ activeLabel: row.time });
          },
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
import TelemetryCompanionSignalTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// The window the monitor evaluated over, which the host pins.
const PIN_START: string = "2026-09-28T11:00:00.000Z";
const PIN_END: string = "2026-09-28T11:30:00.000Z";
const PIN_WINDOW: string = `${PIN_START}..${PIN_END}`;

// Histogram bars (ClickHouse labels), one minute each.
const HIST_A: string = "2026-09-28 11:20:00";
const HIST_B: string = "2026-09-28 11:21:00";
const HIST_C: string = "2026-09-28 11:22:00";

// A drag from the first bar to the second covers both, to the second's end.
const ZOOM_START: string = "2026-09-28T11:20:00.000Z";
const ZOOM_END: string = "2026-09-28T11:22:00.000Z";
const ZOOM_WINDOW: string = `${ZOOM_START}..${ZOOM_END}`;

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

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

function lastWindowPostedTo(path: string): string {
  const requests: Array<Record<string, any>> = postsTo(path);
  expect(requests.length).toBeGreaterThan(0);
  const last: Record<string, any> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

function lastListWindow(): string {
  const calls: Array<Array<unknown>> = analyticsGetListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const query: Record<string, unknown> = (
    calls[calls.length - 1]![0] as { query: Record<string, unknown> }
  ).query;
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return `${time.startValue.toISOString()}..${time.endValue.toISOString()}`;
}

function pickerLabel(): string {
  return (
    screen.getByTestId("log-time-range-picker-button").textContent || ""
  ).trim();
}

function customLabel(startIso: string, endIso: string): string {
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  });
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

function pinnedWindow(): InBetween<Date> {
  return new InBetween<Date>(new Date(PIN_START), new Date(PIN_END));
}

async function histogramDrawn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
  });
}

// Drags across the histogram and waits for everything to be on the zoom.
async function zoomIn(): Promise<void> {
  drag(HIST_A, HIST_B);

  await waitFor(() => {
    expect(lastListWindow()).toBe(ZOOM_WINDOW);
  });
  await waitFor(() => {
    expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(ZOOM_WINDOW);
  });
  expect(
    screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeInTheDocument();
}

function expectStillZoomed(): void {
  expect(pickerLabel()).toBe(customLabel(ZOOM_START, ZOOM_END));
  expect(
    screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeInTheDocument();
  expect(lastListWindow()).toBe(ZOOM_WINDOW);
  expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(ZOOM_WINDOW);
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
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/logs/histogram")) {
      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [HIST_A, HIST_B, HIST_C].map((time: string) => {
            return { time, severity: "Error", count: 2 };
          }),
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

describe("a logs snapshot keeps a zoom made inside it", () => {
  function snapshotLogs(): React.ReactElement {
    // What the incident page hands over: the stored query, window and all.
    return (
      <DashboardLogsViewer
        id="logs-preview"
        logQuery={{ time: pinnedWindow() } as never}
        limit={10}
        noLogsMessage="No logs found"
      />
    );
  }

  async function renderSnapshot(): Promise<RenderResult> {
    let rendered: RenderResult | null = null;
    await act(async () => {
      rendered = render(snapshotLogs());
    });
    await histogramDrawn();
    return rendered!;
  }

  test("starts on the pin, with nothing to reset", async () => {
    await renderSnapshot();

    expect(pickerLabel()).toBe(customLabel(PIN_START, PIN_END));
    expect(lastListWindow()).toBe(PIN_WINDOW);
    expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(PIN_WINDOW);
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the page's background refresh (an equal query) keeps the zoom and its Reset zoom", async () => {
    const rendered: RenderResult = await renderSnapshot();
    await zoomIn();

    await act(async () => {
      rendered.rerender(snapshotLogs());
    });

    expectStillZoomed();
  });

  test("Reset zoom after the refresh goes back to the pin", async () => {
    const rendered: RenderResult = await renderSnapshot();
    await zoomIn();

    await act(async () => {
      rendered.rerender(snapshotLogs());
    });
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    expect(pickerLabel()).toBe(customLabel(PIN_START, PIN_END));
    await waitFor(() => {
      expect(lastListWindow()).toBe(PIN_WINDOW);
    });
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(PIN_WINDOW);
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("several refreshes in a row keep it too", async () => {
    const rendered: RenderResult = await renderSnapshot();
    await zoomIn();

    for (let refresh: number = 0; refresh < 3; refresh++) {
      await act(async () => {
        rendered.rerender(snapshotLogs());
      });
    }

    expectStillZoomed();
  });

  test("a snapshot of another window still moves the explorer there, and ends the zoom", async () => {
    const rendered: RenderResult = await renderSnapshot();
    await zoomIn();

    await act(async () => {
      rendered.rerender(
        <DashboardLogsViewer
          id="logs-preview"
          logQuery={
            {
              time: new InBetween<Date>(
                new Date("2026-09-28T10:00:00.000Z"),
                new Date("2026-09-28T10:15:00.000Z"),
              ),
            } as never
          }
          limit={10}
          noLogsMessage="No logs found"
        />,
      );
    });

    expect(pickerLabel()).toBe(
      customLabel("2026-09-28T10:00:00.000Z", "2026-09-28T10:15:00.000Z"),
    );
    await waitFor(() => {
      expect(lastListWindow()).toBe(
        "2026-09-28T10:00:00.000Z..2026-09-28T10:15:00.000Z",
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });
});

describe("the Logs tab of a snapshot card keeps a zoom made inside it", () => {
  // A trace monitor's snapshot: Logs is a companion tab, pinned to the window.
  function traceSnapshot(): TelemetryQuery {
    return {
      telemetryType: TelemetryType.Trace,
      telemetryQuery: { startTime: pinnedWindow() } as never,
      metricViewData: null,
    };
  }

  function snapshotCard(): React.ReactElement {
    return (
      <TelemetryCompanionSignalTabs
        telemetryQuery={traceSnapshot()}
        snapshotWindow={pinnedWindow()}
        eventNoun="incident"
        primarySignalElement={<div data-testid="primary-spans" />}
      />
    );
  }

  async function openLogsTab(): Promise<RenderResult> {
    let rendered: RenderResult | null = null;
    await act(async () => {
      rendered = render(snapshotCard());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    });
    await histogramDrawn();
    return rendered!;
  }

  test("the tab starts on the snapshot window", async () => {
    await openLogsTab();

    expect(pickerLabel()).toBe(customLabel(PIN_START, PIN_END));
    expect(lastListWindow()).toBe(PIN_WINDOW);
  });

  test("the card re-deriving its companions from an equal snapshot keeps the zoom", async () => {
    const rendered: RenderResult = await openLogsTab();
    await zoomIn();

    // The page's refresh: a new telemetryQuery and window, equal to the last.
    await act(async () => {
      rendered.rerender(snapshotCard());
    });

    expectStillZoomed();
  });
});
