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
 * Issue #4105 inside the investigation drawer, with its companion tabs for
 * real. A drag on the drawer's log volume chart zooms the whole drawer, the
 * companion tabs included: they are handed the zoomed window, and their
 * cards must then say they show only the zoomed part of it ("no logs
 * found" must not claim the whole window the opener pinned was empty), as
 * the snapshot cards of the incident and alert pages do.
 *
 * The companion explorers keep zooms of their own, as before: the tabs
 * withdraw every zoom around them, and the drawer's names no range, so no
 * explorer in the drawer follows it. A drag on a companion's histogram
 * zooms that companion alone, and the drawer keeps its window.
 *
 * The drawer, its companion tabs and the logs, traces and exceptions
 * explorers are real; the drawer's metric card is stood in for, and so are
 * the APIs (so every request can be read back) and recharts (so the
 * histograms can be dragged).
 */

const drawerHistogramMock: MockFunction = getJestMockFunction();
const patternsMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      __esModule: true,
      fetchLogsHistogramRaw: (...args: Array<unknown>) => {
        return drawerHistogramMock(...args);
      },
      fetchTopErrorPatterns: (...args: Array<unknown>) => {
        return patternsMock(...args);
      },
    };
  },
);

// The drawer's metric card: its charts' drag and double-click zoom the drawer.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="embedded-metric-card" />;
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
          "data-testid": `bar-${row.time}`,
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

import InvestigationDrawer from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Log from "../../../Models/AnalyticsModels/Log";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-08-20T12:00:00.000Z");

// The window the opener pinned: fifteen minutes, so one-minute bars.
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T10:15:00.000Z"),
);
const PINNED_TEXT: string =
  "2026-08-20T10:00:00.000Z..2026-08-20T10:15:00.000Z";

// Bars, a minute each, for the drawer's volume chart and the explorers'.
const BARS: Array<string> = [
  "2026-08-20 10:02:00",
  "2026-08-20 10:03:00",
  "2026-08-20 10:04:00",
  "2026-08-20 10:05:00",
  "2026-08-20 10:06:00",
  "2026-08-20 10:07:00",
];

// A drag across the drawer's chart, from the first bar through the last.
const DRAWER_ZOOM_TEXT: string =
  "2026-08-20T10:02:00.000Z..2026-08-20T10:08:00.000Z";
// A drag inside that on a companion explorer, from 10:03 through 10:04.
const COMPANION_ZOOM_TEXT: string =
  "2026-08-20T10:03:00.000Z..2026-08-20T10:05:00.000Z";

const LOGS_HISTOGRAM: string = "/telemetry/logs/histogram";
const TRACES_HISTOGRAM: string = "/telemetry/traces/histogram";

const ZOOMED_WINDOW_NAME: string = "the zoomed part of the snapshot window";
const WINDOW_NAME: string = "the snapshot window";

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            attributes: { "host.name": "web-01" },
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
    startAndEndDate: null,
  } as unknown as MetricViewData;
}

function textOf(window: { startValue: Date; endValue: Date }): string {
  return `${new Date(window.startValue).toISOString()}..${new Date(window.endValue).toISOString()}`;
}

function drawerChartWindows(): Array<string> {
  return drawerHistogramMock.mock.calls.map((call: Array<unknown>): string => {
    const body: Record<string, unknown> = call[0] as Record<string, unknown>;
    return `${body["startTime"]}..${body["endTime"]}`;
  });
}

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

function logListWindows(): Array<string> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === Log;
    })
    .map((request: { query: Record<string, unknown> }): string => {
      return textOf(request.query["time"] as InBetween<Date>);
    });
}

function last(windows: Array<string>): string | undefined {
  return windows[windows.length - 1];
}

// The drawer's log signal card, where its own volume chart is.
function drawerLogSignal(): HTMLElement {
  return screen
    .getByText("Log signal")
    .closest('[data-testid="card"]') as HTMLElement;
}

function tabPanel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

function drag(container: HTMLElement, from: string, to: string): void {
  fireEvent.mouseDown(within(container).getByTestId(`bar-${from}`));
  fireEvent.mouseMove(within(container).getByTestId(`bar-${to}`));
  fireEvent.mouseUp(within(container).getByTestId(`bar-${to}`));
}

function resetButtons(within_: HTMLElement | null = null): Array<HTMLElement> {
  return (within_ ? within(within_) : screen).queryAllByTestId(
    RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
  );
}

async function renderDrawer(): Promise<void> {
  await act(async () => {
    render(
      <InvestigationDrawer
        title="host.name=web-01"
        window={WINDOW}
        metricViewData={buildViewData()}
        onClose={() => {}}
      />,
    );
  });

  await waitFor(() => {
    expect(
      within(drawerLogSignal()).getByTestId(`bar-${BARS[0]!}`),
    ).toBeInTheDocument();
  });
}

// A drag across the drawer's own volume chart: the whole drawer zooms.
async function zoomTheDrawer(): Promise<void> {
  drag(drawerLogSignal(), BARS[0]!, BARS[BARS.length - 1]!);

  await waitFor(() => {
    expect(last(drawerChartWindows())).toBe(DRAWER_ZOOM_TEXT);
  });
  await waitFor(() => {
    expect(
      within(drawerLogSignal()).getByTestId(`bar-${BARS[0]!}`),
    ).toBeInTheDocument();
  });
}

async function openTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: name }));
  });
}

function companionDescription(noun: string, windowName: string): string {
  return `${noun} in this view's telemetry scope during ${windowName}.`;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  drawerHistogramMock.mockReset();
  patternsMock.mockReset();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  drawerHistogramMock.mockImplementation(async () => {
    return BARS.map((time: string) => {
      return { time, severity: "Error", count: 3 };
    });
  });
  patternsMock.mockImplementation(async () => {
    return [];
  });
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
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

      if (url.includes(TRACES_HISTOGRAM)) {
        return {
          data: {
            buckets: BARS.map((time: string) => {
              return { time, series: "ok", count: 2 };
            }),
          },
        };
      }

      return { data: {} };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the drawer's companion tabs name the window they show", () => {
  test.each([
    ["Logs", "Logs"],
    ["Traces", "Spans"],
    ["Exceptions", "Exceptions"],
  ])(
    "before any zoom, the %s tab's card names the snapshot window",
    async (tab: string, noun: string) => {
      await renderDrawer();

      await openTab(tab);

      expect(
        screen.getByText(companionDescription(noun, WINDOW_NAME)),
      ).toBeInTheDocument();
    },
  );

  test.each([
    ["Logs", "Logs"],
    ["Traces", "Spans"],
    ["Exceptions", "Exceptions"],
  ])(
    "while the drawer is zoomed, the %s tab's card says it shows the zoomed part of the window",
    async (tab: string, noun: string) => {
      await renderDrawer();
      await zoomTheDrawer();

      await openTab(tab);

      expect(
        screen.getByText(companionDescription(noun, ZOOMED_WINDOW_NAME)),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(companionDescription(noun, WINDOW_NAME)),
      ).toBeNull();
    },
  );

  test("while the drawer is zoomed, the logs tab's empty list says no logs were found in the zoomed part", async () => {
    await renderDrawer();
    await zoomTheDrawer();

    await openTab("Logs");

    await waitFor(() => {
      expect(
        within(tabPanel()).getByText(`No logs found in ${ZOOMED_WINDOW_NAME}.`),
      ).toBeInTheDocument();
    });
  });

  test("a zoom made while a tab is open retitles it at once", async () => {
    await renderDrawer();
    await openTab("Logs");
    expect(
      screen.getByText(companionDescription("Logs", WINDOW_NAME)),
    ).toBeInTheDocument();

    await zoomTheDrawer();

    expect(
      screen.getByText(companionDescription("Logs", ZOOMED_WINDOW_NAME)),
    ).toBeInTheDocument();
  });

  test("the drawer's Reset zoom puts the copy back on the snapshot window", async () => {
    await renderDrawer();
    await zoomTheDrawer();
    await openTab("Traces");
    expect(
      screen.getByText(companionDescription("Spans", ZOOMED_WINDOW_NAME)),
    ).toBeInTheDocument();

    // The drawer's own way back, in its scope strip.
    fireEvent.click(resetButtons()[0]!);

    await waitFor(() => {
      expect(last(drawerChartWindows())).toBe(PINNED_TEXT);
    });
    expect(
      screen.getByText(companionDescription("Spans", WINDOW_NAME)),
    ).toBeInTheDocument();
  });

  test("a double-click on the drawer's volume chart puts the copy back too", async () => {
    await renderDrawer();
    await zoomTheDrawer();
    await openTab("Exceptions");
    await waitFor(() => {
      expect(
        within(drawerLogSignal()).getByText("Double-click to reset"),
      ).toBeInTheDocument();
    });

    fireEvent.doubleClick(
      within(drawerLogSignal()).getByTestId(`bar-${BARS[0]!}`).parentElement!
        .parentElement!.parentElement!,
    );

    await waitFor(() => {
      expect(last(drawerChartWindows())).toBe(PINNED_TEXT);
    });
    expect(
      screen.getByText(companionDescription("Exceptions", WINDOW_NAME)),
    ).toBeInTheDocument();
  });
});

describe("the drawer's companion explorers keep zooms of their own", () => {
  test("they are handed the drawer's window, zoomed or not", async () => {
    await renderDrawer();
    await openTab("Logs");
    await waitFor(() => {
      expect(last(logListWindows())).toBe(PINNED_TEXT);
    });

    await zoomTheDrawer();

    await waitFor(() => {
      expect(last(logListWindows())).toBe(DRAWER_ZOOM_TEXT);
    });
    await waitFor(() => {
      expect(last(postedWindows(LOGS_HISTOGRAM))).toBe(DRAWER_ZOOM_TEXT);
    });
  });

  test("while the drawer is zoomed, the drawer's Reset zoom is the only one: the explorer does not follow the drawer's zoom", async () => {
    await renderDrawer();
    await zoomTheDrawer();

    await openTab("Logs");
    await waitFor(() => {
      expect(
        within(tabPanel()).getByTestId(`bar-${BARS[0]!}`),
      ).toBeInTheDocument();
    });

    expect(resetButtons()).toHaveLength(1);
    expect(resetButtons(tabPanel())).toHaveLength(0);
    // No double-click on the explorer's chart undoes the drawer's zoom.
    expect(within(tabPanel()).queryByText("Double-click to reset")).toBeNull();
  });

  test("a drag on a companion explorer's histogram zooms that explorer alone; the drawer keeps its window", async () => {
    await renderDrawer();
    await zoomTheDrawer();
    await openTab("Logs");
    await waitFor(() => {
      expect(
        within(tabPanel()).getByTestId(`bar-${BARS[1]!}`),
      ).toBeInTheDocument();
    });
    const drawerRequests: number = drawerChartWindows().length;

    drag(tabPanel(), BARS[1]!, BARS[2]!);

    await waitFor(() => {
      expect(last(logListWindows())).toBe(COMPANION_ZOOM_TEXT);
    });
    await waitFor(() => {
      expect(last(postedWindows(LOGS_HISTOGRAM))).toBe(COMPANION_ZOOM_TEXT);
    });
    // The drawer was not asked again: it is still on its own zoomed window.
    expect(drawerChartWindows().length).toBe(drawerRequests);
    expect(last(drawerChartWindows())).toBe(DRAWER_ZOOM_TEXT);
    // Two zooms, two ways back: the drawer's and the explorer's own.
    expect(resetButtons()).toHaveLength(2);
    expect(resetButtons(tabPanel())).toHaveLength(1);

    // The explorer's own way back returns it to the drawer's window only.
    fireEvent.click(resetButtons(tabPanel())[0]!);

    await waitFor(() => {
      expect(last(logListWindows())).toBe(DRAWER_ZOOM_TEXT);
    });
    expect(last(drawerChartWindows())).toBe(DRAWER_ZOOM_TEXT);
    expect(resetButtons()).toHaveLength(1);
    expect(resetButtons(tabPanel())).toHaveLength(0);
  });

  test("the traces companion too: its own zoom, never the drawer's", async () => {
    await renderDrawer();
    await openTab("Traces");
    await waitFor(() => {
      expect(
        within(tabPanel()).getByTestId(`bar-${BARS[1]!}`),
      ).toBeInTheDocument();
    });
    const drawerRequests: number = drawerChartWindows().length;

    drag(tabPanel(), BARS[1]!, BARS[2]!);

    await waitFor(() => {
      expect(last(postedWindows(TRACES_HISTOGRAM))).toBe(COMPANION_ZOOM_TEXT);
    });
    expect(drawerChartWindows().length).toBe(drawerRequests);
    expect(last(drawerChartWindows())).toBe(PINNED_TEXT);
    // Only the explorer's own way back: the drawer is not zoomed.
    expect(resetButtons()).toHaveLength(1);
    expect(resetButtons(tabPanel())).toHaveLength(1);
  });
});
