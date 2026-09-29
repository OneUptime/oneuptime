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
 * Issue #4105 on the telemetry snapshot of an incident, an alert or an
 * episode whose monitor watched logs, traces or exceptions. The snapshot's
 * primary signal is then an explorer, and a drag on its volume histogram
 * must zoom the WHOLE snapshot, as a drag on a metric snapshot's chart
 * does: every companion tab (Metrics, and whichever of Logs, Traces and
 * Exceptions the primary is not) queries exactly the dragged window, the
 * badge offers the one "Reset zoom", and a double-click on the histogram,
 * or that Reset zoom, returns everything to the snapshot window. It used to
 * zoom the explorer alone, with a Reset zoom of its own beside its picker,
 * while the other tabs kept showing the whole snapshot.
 *
 * TelemetrySnapshotPanel (the episode pages' snapshot) is rendered with the
 * real companion tabs and the real explorers: the Dashboard ones and the
 * shells they render (the shared LogsViewer and the TelemetryViewer). The
 * APIs are mocked, so every request each tab sends can be read back.
 * Recharts is stood in for so the volume histograms can be dragged, and the
 * companion metric card's charts (MetricCharts) by buttons that call the
 * handlers MetricView hands them.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

// A drag on the companion metric card, inside the snapshot window.
const MOCK_CARD_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:46:00.000Z"),
  end: new Date("2026-09-14T17:48:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(
                  MOCK_CARD_DRAG.start,
                  MOCK_CARD_DRAG.end,
                );
              }}
            >
              Drag across the metric chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the metric chart
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

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

// The companion metric card's picker: shows the card's range.
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: {
        range: string;
        startAndEndDate?: { startValue: Date; endValue: Date };
      };
    }): React.ReactElement => {
      const window: { startValue: Date; endValue: Date } | undefined =
        props.dashboardStartAndEndDate.startAndEndDate;
      return (
        <span data-testid="card-picker">
          {window
            ? `${window.startValue.toISOString()}..${window.endValue.toISOString()}`
            : props.dashboardStartAndEndDate.range}
        </span>
      );
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
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
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
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
      getFriendlyMessage: () => {
        return "error";
      },
      getFriendlyErrorMessage: () => {
        return "error";
      },
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
    LineChart: chart,
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

import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
// The window the monitor evaluated over when it opened the event.
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
// A later evaluation's window.
const NEXT_START: Date = new Date("2026-09-14T18:30:00.000Z");
const NEXT_END: Date = new Date("2026-09-14T18:45:00.000Z");

const SNAPSHOT_TEXT: string = `${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`;
const NEXT_TEXT: string = `${NEXT_START.toISOString()}..${NEXT_END.toISOString()}`;

/*
 * The volume histograms' bars, a minute each (every explorer buckets a
 * fifteen-minute window by the minute). A drag from the first to the last
 * covers 17:50 up to the end of the 17:54 bar.
 */
const BAR_1750: string = "2026-09-14 17:50:00";
const BAR_1751: string = "2026-09-14 17:51:00";
const BAR_1752: string = "2026-09-14 17:52:00";
const BAR_1754: string = "2026-09-14 17:54:00";
const BARS: Array<string> = [
  BAR_1750,
  BAR_1751,
  BAR_1752,
  "2026-09-14 17:53:00",
  BAR_1754,
];

const SLICE_TEXT: string = "2026-09-14T17:50:00.000Z..2026-09-14T17:55:00.000Z";
// A second drag, from the 17:51 bar through the 17:52 one.
const NESTED_TEXT: string =
  "2026-09-14T17:51:00.000Z..2026-09-14T17:53:00.000Z";
const CARD_DRAG_TEXT: string = `${MOCK_CARD_DRAG.start.toISOString()}..${MOCK_CARD_DRAG.end.toISOString()}`;

const LOGS_HISTOGRAM: string = "/telemetry/logs/histogram";
const TRACES_HISTOGRAM: string = "/telemetry/traces/histogram";
const EXCEPTIONS_HISTOGRAM: string = "/telemetry/exceptions/histogram";

function textOf(window: { startValue: Date; endValue: Date }): string {
  return `${OneUptimeDate.fromString(window.startValue).toISOString()}..${OneUptimeDate.fromString(window.endValue).toISOString()}`;
}

function labelOf(text: string): string {
  const [startIso, endIso] = text.split("..") as [string, string];
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  });
}

// A relative window resolves against the (moving) fake clock: check its length.
function isPastDay(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const [startIso, endIso] = text.split("..") as [string, string];
  return (
    new Date(endIso).getTime() - new Date(startIso).getTime() ===
    24 * 60 * 60 * 1000
  );
}

/*
 * Where a tab's requests are read back from, one kind of request each (a
 * list, a volume chart, a metric lookup): every window it was asked for,
 * in order.
 */
type WindowSource = () => Array<string>;

function postedWindows(path: string): Array<string> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        url: { toString: () => string };
        data: Record<string, unknown>;
      };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: Record<string, unknown> }): string => {
      return `${args.data["startTime"]}..${args.data["endTime"]}`;
    });
}

function listedWindows(modelType: unknown, field: string): Array<string> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === modelType;
    })
    .map((request: { query: Record<string, unknown> }): string => {
      return textOf(request.query[field] as InBetween<Date>);
    });
}

// The companion metric card's charts.
function metricChartWindows(): Array<string> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): string => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return textOf(data.startAndEndDate!);
  });
}

const LOG_LIST: WindowSource = (): Array<string> => {
  return listedWindows(Log, "time");
};
const LOG_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(LOGS_HISTOGRAM);
};
const SPAN_LIST: WindowSource = (): Array<string> => {
  return listedWindows(Span, "startTime");
};
const SPAN_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(TRACES_HISTOGRAM);
};
// The exception groups to list are the ones that occurred in the window.
const EXCEPTION_SCOPE: WindowSource = (): Array<string> => {
  return listedWindows(ExceptionInstance, "time");
};
const EXCEPTION_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(EXCEPTIONS_HISTOGRAM);
};
// Which metrics the companion card charts: the ones seen in the window.
const METRIC_LOOKUP: WindowSource = (): Array<string> => {
  return listedWindows(Metric, "time");
};
const METRIC_CHARTS: WindowSource = (): Array<string> => {
  return metricChartWindows();
};

function last(windows: Array<string>): string | undefined {
  return windows[windows.length - 1];
}

function countsOf(sources: Array<WindowSource>): Array<number> {
  return sources.map((source: WindowSource): number => {
    return source().length;
  });
}

// Every window asked for since the counts were taken, from every source.
function askedSince(
  sources: Array<WindowSource>,
  counts: Array<number>,
): Array<string> {
  const asked: Array<string> = [];
  sources.forEach((source: WindowSource, index: number) => {
    asked.push(...source().slice(counts[index]));
  });
  return asked;
}

// The window each source was last asked for.
function latestOf(sources: Array<WindowSource>): Array<string | undefined> {
  return sources.map((source: WindowSource): string | undefined => {
    return last(source());
  });
}

async function expectLatest(
  sources: Array<WindowSource>,
  windowText: string,
): Promise<void> {
  await waitFor(() => {
    expect(latestOf(sources)).toEqual(
      sources.map((): string => {
        return windowText;
      }),
    );
  });
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function badgeTitle(
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): string {
  return OneUptimeDate.getInBetweenDatesAsFormattedString(
    new InBetween<Date>(start, end),
  );
}

/*
 * The snapshot badge's Reset zoom: the one right before the badge's window.
 * (The companion metric card's own Reset zoom shares a row with the badge,
 * after the card's picker.)
 */
function badgeResetButtons(): Array<HTMLElement> {
  return resetButtons().filter((button: HTMLElement): boolean => {
    const next: Element | null = button.nextElementSibling;
    return (
      next !== null &&
      within(next as HTMLElement).queryByText(badgeTitle()) !== null
    );
  });
}

interface CompanionCase {
  tab: string;
  sources: Array<WindowSource>;
  // What the tab's card says it shows.
  describes: (windowName: string) => string;
}

const METRICS_COMPANION: CompanionCase = {
  tab: "Metrics",
  sources: [METRIC_LOOKUP, METRIC_CHARTS],
  describes: (windowName: string): string => {
    return `Metrics in this incident's telemetry scope during ${windowName}.`;
  },
};

const LOGS_COMPANION: CompanionCase = {
  tab: "Logs",
  sources: [LOG_LIST, LOG_VOLUME],
  describes: (windowName: string): string => {
    return `Logs in this incident's telemetry scope during ${windowName}.`;
  },
};

const TRACES_COMPANION: CompanionCase = {
  tab: "Traces",
  sources: [SPAN_LIST, SPAN_VOLUME],
  describes: (windowName: string): string => {
    return `Spans in this incident's telemetry scope during ${windowName}.`;
  },
};

const EXCEPTIONS_COMPANION: CompanionCase = {
  tab: "Exceptions",
  sources: [EXCEPTION_SCOPE, EXCEPTION_VOLUME],
  describes: (windowName: string): string => {
    return `Exceptions in this incident's telemetry scope during ${windowName}.`;
  },
};

interface PrimaryCase {
  name: string;
  tab: string;
  telemetryType: TelemetryType;
  // Where the stored query keeps the snapshot window.
  windowField: string;
  pickerPrefix: string;
  // Where the primary explorer's requests are read back from.
  sources: Array<WindowSource>;
  // Its volume chart's requests (last among its sources to be asked).
  volume: WindowSource;
  companions: Array<CompanionCase>;
  // A companion explorer, to check the companions still zoom on their own.
  companionExplorer: CompanionCase;
}

const PRIMARIES: Array<PrimaryCase> = [
  {
    name: "Logs",
    tab: "Logs",
    telemetryType: TelemetryType.Log,
    windowField: "time",
    pickerPrefix: "log-time-range-picker",
    sources: [LOG_LIST, LOG_VOLUME],
    volume: LOG_VOLUME,
    companions: [TRACES_COMPANION, METRICS_COMPANION, EXCEPTIONS_COMPANION],
    companionExplorer: TRACES_COMPANION,
  },
  {
    name: "Traces",
    tab: "Traces",
    telemetryType: TelemetryType.Trace,
    windowField: "startTime",
    pickerPrefix: "telemetry-time-range-picker",
    sources: [SPAN_LIST, SPAN_VOLUME],
    volume: SPAN_VOLUME,
    companions: [LOGS_COMPANION, METRICS_COMPANION, EXCEPTIONS_COMPANION],
    companionExplorer: LOGS_COMPANION,
  },
  {
    name: "Exceptions",
    tab: "Exceptions",
    telemetryType: TelemetryType.Exception,
    windowField: "time",
    pickerPrefix: "telemetry-time-range-picker",
    sources: [EXCEPTION_SCOPE, EXCEPTION_VOLUME],
    volume: EXCEPTION_VOLUME,
    companions: [LOGS_COMPANION, TRACES_COMPANION, METRICS_COMPANION],
    companionExplorer: TRACES_COMPANION,
  },
];

// A new window every call, the way the page re-reads the stored snapshot.
function snapshotWindow(
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): InBetween<Date> {
  return new InBetween<Date>(
    new Date(start.getTime()),
    new Date(end.getTime()),
  );
}

// The query a logs, traces or exceptions monitor stores on the event.
function storedQuery(
  primary: PrimaryCase,
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): TelemetryQuery {
  return {
    telemetryType: primary.telemetryType,
    telemetryQuery: {
      [primary.windowField]: snapshotWindow(start, end),
    } as never,
    metricViewData: null,
  };
}

function panel(
  primary: PrimaryCase,
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): React.ReactElement {
  return (
    <TelemetrySnapshotPanel
      telemetryQuery={storedQuery(primary, start, end)}
      snapshotWindow={snapshotWindow(start, end)}
      seriesSummary=""
      eventNoun="incident"
    />
  );
}

// An explorer has drawn its volume chart's bars.
async function volumeChartDrawn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${BAR_1750}`)).toBeInTheDocument();
  });
}

async function renderPanel(primary: PrimaryCase): Promise<RenderResult> {
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(panel(primary));
  });
  await volumeChartDrawn();
  await expectLatest(primary.sources, SNAPSHOT_TEXT);
  return rendered!;
}

function dragBars(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

// The element a volume histogram takes its double-click on.
function histogramPlot(): HTMLElement {
  return screen.getByTestId(`bucket-${BAR_1750}`).parentElement!.parentElement!
    .parentElement!;
}

function pickerLabel(primary: PrimaryCase): string {
  return (
    screen.getByTestId(`${primary.pickerPrefix}-button`).textContent || ""
  ).trim();
}

async function openTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: name }));
  });
}

// Back on the primary's tab, once its explorer has drawn its bars.
async function backOnThePrimary(primary: PrimaryCase): Promise<void> {
  await openTab(primary.tab);
  await volumeChartDrawn();
}

/*
 * A drag across the primary's volume chart, and what makes it a zoom of the
 * WHOLE snapshot: the snapshot badge offers the way back, and the primary
 * is on the dragged window.
 */
async function zoomFromThePrimary(primary: PrimaryCase): Promise<void> {
  dragBars(BAR_1750, BAR_1754);

  await waitFor(() => {
    expect(badgeResetButtons()).toHaveLength(1);
  });
  await expectLatest(primary.sources, SLICE_TEXT);
}

// Opens a companion tab: every window it asks for until it has asked for each.
async function windowsAskedForBy(
  companion: CompanionCase,
): Promise<Array<string>> {
  const counts: Array<number> = countsOf(companion.sources);

  await openTab(companion.tab);

  await waitFor(() => {
    const now: Array<number> = countsOf(companion.sources);
    now.forEach((count: number, index: number) => {
      expect(count).toBeGreaterThan(counts[index]!);
    });
  });

  return askedSince(companion.sources, counts);
}

async function expectCompanionsOn(
  primary: PrimaryCase,
  windowText: string,
): Promise<void> {
  for (const companion of primary.companions) {
    const asked: Array<string> = await windowsAskedForBy(companion);
    expect(asked.length).toBeGreaterThan(0);
    for (const window of asked) {
      expect(`${companion.tab}: ${window}`).toBe(
        `${companion.tab}: ${windowText}`,
      );
    }
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  fetchResultsMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(
    async (request: { modelType: unknown }) => {
      // The companion metric card charts the metrics it finds in scope.
      if (request.modelType === Metric) {
        return { data: [{ name: "checkout.latency" }], count: 1 };
      }
      return { data: [], count: 0 };
    },
  );
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      const url: string = args.url.toString();

      if (url.includes(LOGS_HISTOGRAM)) {
        return {
          data: {
            bucketSizeInMinutes: 1,
            buckets: BARS.map((time: string) => {
              return { time, severity: "Error", count: 2 };
            }),
          },
        };
      }

      if (
        url.includes(TRACES_HISTOGRAM) ||
        url.includes(EXCEPTIONS_HISTOGRAM)
      ) {
        return {
          data: {
            buckets: BARS.map((time: string) => {
              return { time, series: "ok", count: 3 };
            }),
          },
        };
      }

      return { data: {} };
    },
  );
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe.each(PRIMARIES)(
  "a $name snapshot: a drag on the primary explorer's histogram zooms the whole snapshot",
  (primary: PrimaryCase) => {
    const companionRows: Array<[string, CompanionCase]> =
      primary.companions.map(
        (companion: CompanionCase): [string, CompanionCase] => {
          return [companion.tab, companion];
        },
      );

    test("before any drag, the primary and every companion tab are on the snapshot window, with nothing to reset", async () => {
      await renderPanel(primary);

      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
      expect(askedSince(primary.sources, [0, 0])).not.toContain(SLICE_TEXT);

      await expectCompanionsOn(primary, SNAPSHOT_TEXT);
    });

    test("the primary explorer ends up listing and charting exactly the dragged window", async () => {
      await renderPanel(primary);
      const counts: Array<number> = countsOf(primary.sources);

      await zoomFromThePrimary(primary);

      expect(pickerLabel(primary)).toBe(labelOf(SLICE_TEXT));
      // Every kind of request it makes was sent again, the last for the slice.
      countsOf(primary.sources).forEach((count: number, index: number) => {
        expect(count).toBeGreaterThan(counts[index]!);
      });
      expect(latestOf(primary.sources)).toEqual(
        primary.sources.map((): string => {
          return SLICE_TEXT;
        }),
      );
    });

    test.each(companionRows)(
      "the %s companion tab, opened after the drag, queries exactly the dragged window",
      async (_tab: string, companion: CompanionCase) => {
        await renderPanel(primary);
        await zoomFromThePrimary(primary);

        const asked: Array<string> = await windowsAskedForBy(companion);

        expect(asked.length).toBeGreaterThanOrEqual(companion.sources.length);
        for (const window of asked) {
          expect(window).toBe(SLICE_TEXT);
        }
        // Its card says it shows only part of the snapshot window.
        expect(
          screen.getByText(
            companion.describes("the zoomed part of the snapshot window"),
          ),
        ).toBeInTheDocument();
      },
    );

    test("the companion metric card's picker is on the dragged window", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);

      await openTab("Metrics");

      await waitFor(() => {
        expect(last(metricChartWindows())).toBe(SLICE_TEXT);
      });
      expect(screen.getByTestId("card-picker")).toHaveTextContent(SLICE_TEXT);
    });

    test("the badge offers Reset zoom, and it is the only Reset zoom on the card", async () => {
      await renderPanel(primary);

      await zoomFromThePrimary(primary);

      const tabPanel: HTMLElement = screen.getByRole("tabpanel");
      const buttons: Array<HTMLElement> = within(tabPanel).queryAllByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      );
      expect(buttons).toHaveLength(1);
      // Beside the badge, which keeps naming the snapshot window...
      expect(badgeResetButtons()).toEqual(buttons);
      expect(buttons[0]).toBeVisible();
      // ...and none beside the explorer's picker, which shows the slice.
      const picker: HTMLElement = screen.getByTestId(
        `${primary.pickerPrefix}-button`,
      );
      expect(
        within(picker.parentElement!.parentElement!).queryByTestId(
          RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
        ),
      ).toBeNull();
      expect(pickerLabel(primary)).toBe(labelOf(SLICE_TEXT));
    });

    test("every companion tab's card carries the badge's Reset zoom, the only one there", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);

      for (const companion of primary.companions) {
        await windowsAskedForBy(companion);
        expect(badgeResetButtons()).toHaveLength(1);
        expect(resetButtons()).toHaveLength(1);
      }
    });

    test("the histogram offers the double-click once the snapshot is zoomed", async () => {
      await renderPanel(primary);

      expect(screen.queryByText("Double-click to reset")).toBeNull();

      await zoomFromThePrimary(primary);

      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
    });

    test("a double-click on the primary's histogram returns everything to the snapshot window", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });

      fireEvent.doubleClick(histogramPlot());

      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));
      expect(screen.queryByText("Double-click to reset")).toBeNull();

      await expectCompanionsOn(primary, SNAPSHOT_TEXT);
    });

    test("Reset zoom beside the badge returns everything to the snapshot window", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);

      fireEvent.click(badgeResetButtons()[0]!);

      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));

      await expectCompanionsOn(primary, SNAPSHOT_TEXT);
    });

    test("Reset zoom on a companion tab returns the primary to the snapshot window too", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);
      await windowsAskedForBy(primary.companions[0]!);

      await act(async () => {
        fireEvent.click(badgeResetButtons()[0]!);
      });
      await backOnThePrimary(primary);

      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
    });

    test("a second drag zooms within the first, and one double-click returns to the snapshot window", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);

      dragBars(BAR_1751, BAR_1752);

      await expectLatest(primary.sources, NESTED_TEXT);
      await expectCompanionsOn(primary, NESTED_TEXT);
      await backOnThePrimary(primary);
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });

      fireEvent.doubleClick(histogramPlot());

      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
    });

    test("the zoom outlives a switch to another tab: the primary comes back on the slice, still zoomed", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);
      await windowsAskedForBy(METRICS_COMPANION);
      const counts: Array<number> = countsOf(primary.sources);

      await backOnThePrimary(primary);

      // It came back on the slice: the snapshot window was never asked for.
      await waitFor(() => {
        expect(askedSince(primary.sources, counts).length).toBeGreaterThan(0);
      });
      for (const window of askedSince(primary.sources, counts)) {
        expect(window).toBe(SLICE_TEXT);
      }
      expect(pickerLabel(primary)).toBe(labelOf(SLICE_TEXT));
      expect(badgeResetButtons()).toHaveLength(1);
      expect(resetButtons()).toHaveLength(1);

      // And a double-click on its histogram still resets the snapshot.
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
      fireEvent.doubleClick(histogramPlot());
      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
    });

    test("a range picked in the primary's own picker takes it its own way; the badge's Reset zoom brings it back", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);

      fireEvent.click(screen.getByTestId(`${primary.pickerPrefix}-button`));
      fireEvent.click(
        within(
          screen.getByTestId(`${primary.pickerPrefix}-dropdown`),
        ).getByText("Past 1 Day"),
      );

      await waitFor(() => {
        expect(isPastDay(last(primary.volume()))).toBe(true);
      });
      expect(pickerLabel(primary)).toBe("Past 1 Day");
      // The snapshot keeps its zoom: the badge still offers the way back.
      expect(badgeResetButtons()).toHaveLength(1);
      expect(resetButtons()).toHaveLength(1);

      fireEvent.click(badgeResetButtons()[0]!);

      // Pinned to the snapshot window again, the primary follows it there.
      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
    });
  },
);

describe.each(PRIMARIES)(
  "a $name snapshot: the page's background refresh and a new snapshot window",
  (primary: PrimaryCase) => {
    // The page re-reads the stored snapshot: new objects, the same values.
    async function refresh(rendered: RenderResult): Promise<void> {
      await act(async () => {
        rendered.rerender(panel(primary));
      });
    }

    test("a refresh with equal values keeps the zoom: the primary stays on the slice, with the badge's way back", async () => {
      const rendered: RenderResult = await renderPanel(primary);
      await zoomFromThePrimary(primary);
      const counts: Array<number> = countsOf(primary.sources);

      await refresh(rendered);
      await refresh(rendered);

      expect(pickerLabel(primary)).toBe(labelOf(SLICE_TEXT));
      expect(badgeResetButtons()).toHaveLength(1);
      expect(resetButtons()).toHaveLength(1);
      // Whatever it asked for since, it never went back to the whole window.
      for (const window of askedSince(primary.sources, counts)) {
        expect(window).toBe(SLICE_TEXT);
      }
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
    });

    test("after the refresh, a double-click on the histogram still resets everything", async () => {
      const rendered: RenderResult = await renderPanel(primary);
      await zoomFromThePrimary(primary);
      await refresh(rendered);

      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
      fireEvent.doubleClick(histogramPlot());

      await expectLatest(primary.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
      await expectCompanionsOn(primary, SNAPSHOT_TEXT);
    });

    test("after the refresh, every companion tab is still on the slice", async () => {
      const rendered: RenderResult = await renderPanel(primary);
      await zoomFromThePrimary(primary);
      await refresh(rendered);

      await expectCompanionsOn(primary, SLICE_TEXT);
    });

    test("a new snapshot window drops the zoom: the primary and every tab move to it, with nothing to reset", async () => {
      const rendered: RenderResult = await renderPanel(primary);
      await zoomFromThePrimary(primary);

      await act(async () => {
        rendered.rerender(panel(primary, NEXT_START, NEXT_END));
      });

      await expectLatest(primary.sources, NEXT_TEXT);
      expect(pickerLabel(primary)).toBe(labelOf(NEXT_TEXT));
      expect(resetButtons()).toHaveLength(0);
      expect(screen.getByText(badgeTitle(NEXT_START, NEXT_END))).toBeVisible();
      expect(screen.queryByText("Double-click to reset")).toBeNull();

      await expectCompanionsOn(primary, NEXT_TEXT);
    });
  },
);

describe.each(PRIMARIES)(
  "a $name snapshot: the companion tabs keep zooms of their own",
  (primary: PrimaryCase) => {
    test("a drag on a companion explorer zooms that explorer alone; the snapshot is not zoomed", async () => {
      await renderPanel(primary);
      const companion: CompanionCase = primary.companionExplorer;
      await windowsAskedForBy(companion);
      await volumeChartDrawn();

      dragBars(BAR_1750, BAR_1754);

      await expectLatest(companion.sources, SLICE_TEXT);
      // Its own way back, beside its own picker; none beside the badge.
      expect(resetButtons()).toHaveLength(1);
      expect(badgeResetButtons()).toHaveLength(0);

      // The primary is still on the whole snapshot window.
      const counts: Array<number> = countsOf(primary.sources);
      await backOnThePrimary(primary);
      await waitFor(() => {
        expect(askedSince(primary.sources, counts).length).toBeGreaterThan(0);
      });
      for (const window of askedSince(primary.sources, counts)) {
        expect(window).toBe(SNAPSHOT_TEXT);
      }
      expect(resetButtons()).toHaveLength(0);
    });

    test("a drag on the companion metric card zooms the card alone; the snapshot is not zoomed", async () => {
      await renderPanel(primary);
      await windowsAskedForBy(METRICS_COMPANION);
      await waitFor(() => {
        expect(last(metricChartWindows())).toBe(SNAPSHOT_TEXT);
      });

      fireEvent.click(
        await screen.findByRole("button", {
          name: "Drag across the metric chart",
        }),
      );

      await waitFor(() => {
        expect(last(metricChartWindows())).toBe(CARD_DRAG_TEXT);
      });
      // The card's own way back; none beside the badge.
      expect(resetButtons()).toHaveLength(1);
      expect(badgeResetButtons()).toHaveLength(0);

      await backOnThePrimary(primary);
      expect(pickerLabel(primary)).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
    });

    test("while the snapshot is zoomed, a companion explorer's own zoom stays its own", async () => {
      await renderPanel(primary);
      await zoomFromThePrimary(primary);
      const companion: CompanionCase = primary.companionExplorer;
      await windowsAskedForBy(companion);
      await volumeChartDrawn();

      // Inside the slice, from the 17:51 bar through the 17:52 one.
      dragBars(BAR_1751, BAR_1752);

      await expectLatest(companion.sources, NESTED_TEXT);
      // Two zooms now, two ways back: the companion's and the snapshot's.
      expect(resetButtons()).toHaveLength(2);
      expect(badgeResetButtons()).toHaveLength(1);

      // The snapshot kept its slice.
      await backOnThePrimary(primary);
      await expectLatest(primary.sources, SLICE_TEXT);
      expect(pickerLabel(primary)).toBe(labelOf(SLICE_TEXT));
      expect(badgeResetButtons()).toHaveLength(1);
    });
  },
);
