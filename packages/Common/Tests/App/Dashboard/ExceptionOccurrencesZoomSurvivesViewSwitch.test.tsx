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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on Exception > Occurrences. The "Spans" view is the real
 * traces explorer; a drag across its "Traces over time" chart zooms it, and
 * Reset zoom (or a double-click) goes back to the range from before the
 * zoom. The page lifts the explorer's window so it survives a switch to
 * "Occurrence details" and back - and the way back out of a zoom has to
 * survive that switch too, or the reader returns to a zoomed window with no
 * way back to the original range.
 *
 * The real ExceptionOccurrences, TracesViewer and TelemetryViewer are
 * mounted against a mocked data layer; the details table is stood in for,
 * and recharts is stood in for with a chart that lays each bucket out as a
 * div (see LogsHistogramDragTooltip.test.tsx).
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
      getFriendlyMessage: () => {
        return "error";
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/OccuranceTable",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: () => {
        return react.createElement("div", {
          "data-testid": "occurrence-table",
        });
      },
    };
  },
);

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

  const chart: (
    kind: string,
  ) => (props: StubChartProps) => React.ReactElement = (kind: string) => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": `${kind}-chart` },
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
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart("area"),
    BarChart: chart("bar"),
    LineChart: chart("line"),
    Area: nothing,
    Bar: nothing,
    Line: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import ExceptionOccurrences from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrences";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";

const NOW: Date = new Date("2026-09-17T11:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";

// Two bars of the "Traces over time" histogram.
const HIST_A: string = "2026-09-17 10:40:00";
const HIST_B: string = "2026-09-17 10:42:00";

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

function histogramRequests(): Array<Record<string, any>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return args.url.toString().includes("/telemetry/traces/histogram");
    })
    .map((args: PostArgs): Record<string, any> => {
      return args.data;
    });
}

function lastHistogramRequest(): Record<string, any> {
  const requests: Array<Record<string, any>> = histogramRequests();
  expect(requests.length).toBeGreaterThan(0);
  return requests[requests.length - 1]!;
}

function spanOf(request: Record<string, any>): number {
  return (
    new Date(request["endTime"]).getTime() -
    new Date(request["startTime"]).getTime()
  );
}

function pickerLabel(): string {
  return (
    screen.getByTestId("telemetry-time-range-picker-button").textContent || ""
  ).trim();
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function histogramPlot(): HTMLElement {
  return screen.getByTestId("bar-chart").parentElement!.parentElement!;
}

function exception(): TelemetryException {
  const value: TelemetryException = new TelemetryException();
  Object.assign(value, {
    exceptionType: "InventoryReservationError",
    fingerprint: FINGERPRINT,
    primaryEntityId: new ObjectID(SERVICE_ID),
    primaryEntityType: ServiceType.OpenTelemetry,
    lastSeenAt: new Date(NOW.getTime() - 4 * 60 * 1000),
  });
  return value;
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <ExceptionOccurrences exception={exception()} fingerprint={FINGERPRINT} />,
    );
  });

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
  });
  // waitFor ticks the fake clock; put "now" back where the tests read it.
  jest.setSystemTime(NOW);
}

async function zoomIntoTwoBars(): Promise<void> {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${HIST_A}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${HIST_B}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${HIST_B}`));

  await waitFor(() => {
    expect(lastHistogramRequest()["startTime"]).toBe(
      "2026-09-17T10:40:00.000Z",
    );
  });
  expect(resetButton()).toBeInTheDocument();
  expect(pickerLabel()).not.toBe("Past 1 Day");
}

async function switchToDetailsAndBack(): Promise<void> {
  fireEvent.click(screen.getByTestId("exception-occurrences-view-details"));
  expect(screen.getByTestId("occurrence-table")).toBeVisible();
  expect(screen.getByTestId("exception-occurrences-spans")).not.toBeVisible();

  fireEvent.click(screen.getByTestId("exception-occurrences-view-spans"));
  expect(screen.getByTestId("exception-occurrences-spans")).toBeVisible();
  expect(screen.queryByTestId("occurrence-table")).toBeNull();
}

async function expectBackOnTheDay(): Promise<void> {
  expect(pickerLabel()).toBe("Past 1 Day");
  await waitFor(() => {
    expect(spanOf(lastHistogramRequest())).toBe(DAY_MS);
  });
  expect(resetButton()).toBeNull();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/traces/histogram")) {
      return {
        data: {
          buckets: [HIST_A, HIST_B].map((time: string) => {
            return { time, series: "ok", count: 3 };
          }),
        },
      };
    }

    if (url.includes("/telemetry/traces/facets")) {
      return { data: { facets: {} } };
    }

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.localStorage.clear();
});

describe("Exception > Occurrences keeps a zoom's way back through a view switch", () => {
  test("the span list opens on the exception's day, with nothing to undo", async () => {
    await renderPage();

    expect(pickerLabel()).toBe("Past 1 Day");
    expect(spanOf(lastHistogramRequest())).toBe(DAY_MS);
    expect(resetButton()).toBeNull();
  });

  test("after Occurrence details and back, Reset zoom is still offered and returns to the original range", async () => {
    await renderPage();
    await zoomIntoTwoBars();
    const zoomedLabel: string = pickerLabel();

    await switchToDetailsAndBack();

    // Still on the zoomed window, and still with the way back out of it.
    expect(pickerLabel()).toBe(zoomedLabel);
    expect(resetButton()).toBeInTheDocument();
    expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

    fireEvent.click(resetButton()!);

    await expectBackOnTheDay();
  });

  test("after Occurrence details and back, a double-click on the chart returns to the original range", async () => {
    await renderPage();
    await zoomIntoTwoBars();

    await switchToDetailsAndBack();

    fireEvent.doubleClick(histogramPlot());
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await expectBackOnTheDay();
  });

  test("the switch itself asks for nothing: the hidden list is not reloaded", async () => {
    await renderPage();
    await zoomIntoTwoBars();
    const requestsBefore: number = postMock.mock.calls.length;

    await switchToDetailsAndBack();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(postMock.mock.calls.length).toBe(requestsBefore);
  });
});
