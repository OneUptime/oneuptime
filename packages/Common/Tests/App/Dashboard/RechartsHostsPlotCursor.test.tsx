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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105: the crosshair that tells a reader "drag here to zoom" has to
 * show over the plot itself. recharts draws every chart inside a
 * .recharts-wrapper that fills the plot and carries an inline
 * `cursor: default`, so a cursor set on any box around the chart never shows
 * over its bars or lines. The one style that does is the style handed to the
 * chart root, which recharts puts on that wrapper. So each raw recharts host
 * with drag-to-zoom hands its chart root `cursor: crosshair` while a drag
 * would zoom, and nothing at all otherwise, so recharts keeps its default.
 *
 * The hosts render on real recharts here. ResponsiveContainer measures its
 * box, which jsdom cannot lay out, so it is stood in for by handing its chart
 * a size (see ChartPlotClicksWhileResetArmed.test.tsx).
 */

const postMock: MockFunction = getJestMockFunction();
const correlationMock: MockFunction = getJestMockFunction();

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;

  return {
    ...actual,
    ResponsiveContainer: (props: {
      children: React.ReactElement;
    }): React.ReactElement => {
      return react.cloneElement(props.children, { width: 600, height: 300 });
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "Failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
      getItem: async () => {
        return null;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDModule: { default: new (id: string) => unknown } =
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          };
        return new ObjectIDModule.default(
          "11111111-1111-4111-8111-111111111111",
        );
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchErrorPatternCorrelation: (...args: Array<unknown>) => {
        return correlationMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import LogsAnalyticsView from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import {
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TracesAnalyticsView from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import ExceptionOccurrenceTrend from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceTrend";
import ErrorPatternDetail from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/ErrorPatternDetail";
import { LogsInsightsScope } from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// ClickHouse's bucket labels: UTC, no zone marker.
const BUCKET_A: string = "2026-09-28 11:10:00";
const BUCKET_B: string = "2026-09-28 11:11:00";

const HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-28T11:00:00.000Z"),
    new Date("2026-09-28T12:00:00.000Z"),
  ),
};

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

// What an analytics timeseries answers: one series, or two.
let seriesNames: Array<string> = [];

function analyticsRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (const time of [BUCKET_A, BUCKET_B]) {
    if (seriesNames.length === 0) {
      rows.push({ time, count: 4, value: 4, groupValues: {} });
      continue;
    }

    for (const name of seriesNames) {
      rows.push({ time, count: 4, value: 4, groupValues: { name: name } });
    }
  }

  return rows;
}

function trendBuckets(body: Record<string, any>): Array<Record<string, any>> {
  const startMs: number = new Date(body["startTime"]).getTime();
  const bucketMs: number = Number(body["bucketSizeInMinutes"]) * 60 * 1000;
  const firstMs: number = Math.floor(startMs / bucketMs) * bucketMs;

  return [0, 1, 2].map((index: number): Record<string, any> => {
    return {
      time: new Date(firstMs + index * bucketMs).toISOString(),
      series: "unhandled",
      count: 2,
    };
  });
}

// A page zoom with nothing zoomed yet: a drag would zoom.
function idleZoom(): TimeRangeZoom {
  return {
    isZoomed: false,
    rangeBeforeZoom: null,
    zoomToTimeRange: getJestMockFunction(),
    resetZoom: getJestMockFunction(),
  };
}

// The chart root recharts drew: the one element whose cursor shows.
async function plot(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(document.querySelectorAll(".recharts-wrapper")).toHaveLength(1);
  });
  return document.querySelector(".recharts-wrapper") as HTMLElement;
}

async function plotCursor(): Promise<string> {
  return (await plot()).style.cursor;
}

// Which of a host's chart roots is on screen, read from what it drew.
function drawnAs(): string {
  if (document.querySelector(".recharts-area")) {
    return "area";
  }
  if (document.querySelector(".recharts-line")) {
    return "line";
  }
  if (document.querySelector(".recharts-bar")) {
    return "bar";
  }
  return "nothing";
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  seriesNames = [];

  postMock.mockReset();
  postMock.mockImplementation(async (args: PostArgs) => {
    if (args.url.toString().includes("/telemetry/exceptions/histogram")) {
      return { data: { buckets: trendBuckets(args.data) } };
    }
    return { data: { data: analyticsRows() } };
  });

  correlationMock.mockReset();
  correlationMock.mockImplementation(async () => {
    return {
      pattern: "connection refused to <ip>",
      bucketSizeInMinutes: 1,
      timeline: [
        { time: new Date("2026-09-28T11:10:00.000Z"), count: 3 },
        { time: new Date("2026-09-28T11:11:00.000Z"), count: 5 },
      ],
      coOccurringPatterns: [],
      attributes: [],
      resources: [],
      traces: [],
      samples: [],
    };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the explorers' volume histograms", () => {
  function logsHistogram(
    onTimeRangeSelect?: (startTime: Date, endTime: Date) => void,
  ): React.ReactElement {
    return (
      <LogsHistogram
        buckets={[
          { time: BUCKET_A, severity: "Error", count: 3 },
          { time: BUCKET_B, severity: "Information", count: 9 },
        ]}
        isLoading={false}
        bucketIntervalMs={60 * 1000}
        onTimeRangeSelect={onTimeRangeSelect}
      />
    );
  }

  function telemetryHistogram(
    onTimeRangeSelect?: (startTime: Date, endTime: Date) => void,
  ): React.ReactElement {
    return (
      <TelemetryHistogram
        buckets={[
          { time: BUCKET_A, series: "ok", count: 3 },
          { time: BUCKET_B, series: "error", count: 1 },
        ]}
        series={[
          { key: "ok", label: "Ok", color: "#22c55e" },
          { key: "error", label: "Error", color: "#ef4444" },
        ]}
        isLoading={false}
        bucketIntervalMs={60 * 1000}
        onTimeRangeSelect={onTimeRangeSelect}
      />
    );
  }

  test("the logs volume chart shows the crosshair over its bars while a drag zooms", async () => {
    render(logsHistogram(getJestMockFunction()));

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });

  test("the logs volume chart keeps recharts' own cursor where nothing zooms", async () => {
    render(logsHistogram());

    expect(await plotCursor()).toBe("default");
  });

  test("the telemetry volume chart shows the crosshair over its bars while a drag zooms", async () => {
    render(telemetryHistogram(getJestMockFunction()));

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });

  test("the telemetry volume chart keeps recharts' own cursor where nothing zooms", async () => {
    render(telemetryHistogram());

    expect(await plotCursor()).toBe("default");
  });
});

describe("the logs Analytics timeseries", () => {
  function logsAnalytics(): React.ReactElement {
    return (
      <LogsAnalyticsView
        timeRange={HOUR_WINDOW}
        appliedFacetFilters={new Map()}
        logAttributes={[]}
      />
    );
  }

  test("one series, drawn as an area, shows the crosshair inside a viewer that zooms", async () => {
    render(
      <TimeRangeZoomProvider zoom={idleZoom()}>
        {logsAnalytics()}
      </TimeRangeZoomProvider>,
    );

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("area");
  });

  test("several series, drawn as stacked bars, show it too", async () => {
    seriesNames = ["Error", "Information"];
    render(
      <TimeRangeZoomProvider zoom={idleZoom()}>
        {logsAnalytics()}
      </TimeRangeZoomProvider>,
    );

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });

  test("outside any viewer that zooms, recharts keeps its own cursor", async () => {
    render(logsAnalytics());

    expect(await plotCursor()).toBe("default");
  });
});

describe("the traces Analytics timeseries", () => {
  function tracesAnalytics(): React.ReactElement {
    return (
      <TracesAnalyticsView
        baseFilters={{
          startTime: "2026-09-28T11:00:00.000Z",
          endTime: "2026-09-28T12:00:00.000Z",
        }}
        attributeKeys={[]}
        serviceNameMap={{}}
      />
    );
  }

  async function measure(label: string, value: string): Promise<void> {
    await plot();
    fireEvent.change(screen.getByDisplayValue("Request Count"), {
      target: { value: value },
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue(label)).toBeInTheDocument();
    });
  }

  test("a count, drawn as bars, shows the crosshair inside an explorer that zooms", async () => {
    render(
      <TimeRangeZoomProvider zoom={idleZoom()}>
        {tracesAnalytics()}
      </TimeRangeZoomProvider>,
    );

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });

  test("one duration series, drawn as an area, shows it too", async () => {
    seriesNames = ["GET /"];
    render(
      <TimeRangeZoomProvider zoom={idleZoom()}>
        {tracesAnalytics()}
      </TimeRangeZoomProvider>,
    );
    await measure("P95 Response Time", "p95Duration");

    await waitFor(() => {
      expect(drawnAs()).toBe("area");
    });
    expect(await plotCursor()).toBe("crosshair");
  });

  test("several duration series, drawn as lines, show it too", async () => {
    seriesNames = ["GET /", "POST /login"];
    render(
      <TimeRangeZoomProvider zoom={idleZoom()}>
        {tracesAnalytics()}
      </TimeRangeZoomProvider>,
    );
    await measure("P95 Response Time", "p95Duration");

    await waitFor(() => {
      expect(drawnAs()).toBe("line");
    });
    expect(await plotCursor()).toBe("crosshair");
  });

  test("outside any explorer that zooms, recharts keeps its own cursor", async () => {
    render(tracesAnalytics());

    expect(await plotCursor()).toBe("default");
  });
});

describe("the exception Occurrence Trend", () => {
  test("always zooms its own card, so its bars always show the crosshair", async () => {
    render(<ExceptionOccurrenceTrend fingerprint="9f86d081884c7d65" />);

    await waitFor(() => {
      expect(screen.getByTestId("exception-trend-chart")).toBeInTheDocument();
    });
    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });
});

describe("the Logs Insights error drawer's timeline", () => {
  const scope: LogsInsightsScope = {
    timeRange: { range: TimeRange.PAST_ONE_HOUR },
  };

  function drawer(): React.ReactElement {
    return (
      <ErrorPatternDetail
        pattern={{
          pattern: "connection refused to <ip>",
          sampleBody: "connection refused to 10.0.0.5",
          count: 8,
          firstSeenAt: new Date("2026-09-28T11:10:05.000Z"),
          lastSeenAt: new Date("2026-09-28T11:11:30.000Z"),
          resourceCount: 1,
          resourceIds: [],
          severities: ["Error"],
          traceCount: 0,
          sampleTraceIds: [],
        }}
        scope={scope}
        serviceNameById={new Map()}
        onClose={() => {}}
      />
    );
  }

  test("inside a page that zooms, its bars show the crosshair", async () => {
    render(
      <MemoryRouter>
        <TimeRangeZoomScope
          timeRange={scope.timeRange}
          onTimeRangeChange={getJestMockFunction()}
        >
          {drawer()}
        </TimeRangeZoomScope>
      </MemoryRouter>,
    );

    expect(await plotCursor()).toBe("crosshair");
    expect(drawnAs()).toBe("bar");
  });

  test("outside one, recharts keeps its own cursor", async () => {
    render(<MemoryRouter>{drawer()}</MemoryRouter>);

    expect(await plotCursor()).toBe("default");
  });
});
