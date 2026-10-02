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
 * ---------------------------------------------------------------------------
 * Unset reads as "no error" in the Traces chart and the Status facet (#4118)
 * ---------------------------------------------------------------------------
 *
 * Unset is OpenTelemetry's default span status: instrumentation sets Error
 * when an operation fails and leaves every other span Unset. The Traces chart
 * painted Unset grey beside a green Ok, so a healthy service read as "mostly
 * unknown". Unset now takes the success green, and the explicit Ok is cyan:
 * a darker green Ok could not be told from Error's red under protanopia, and
 * Ok sits right on Error in any bucket that has no Unset spans.
 *
 * The REAL TracesViewer is mounted with the TelemetryViewer shell replaced by
 * a probe that records the props it is handed, against mocked APIs. What is
 * pinned is what reaches the shell — the chart's series (labels, colors,
 * hover text, and the server's bucket keys they must keep), the Status and
 * Has Exception facets, the search help — and that a Status pick still
 * filters by the stored value. The real TelemetryHistogram is then drawn to
 * show the legend a reader gets. recharts is stood in for, as in
 * TelemetryHistogramZeroBuckets.test.tsx, so the Bars it declares can be read.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProbe(props);
      /*
       * Only the chart's metric picker is drawn, so a test can switch the
       * metric the way a reader does.
       */
      return React.createElement(
        React.Fragment,
        null,
        props.histogramHeaderActions,
      );
    },
  };
});

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.children,
      );
    },
    Bar: (props: { dataKey: string; fill: string }) => {
      return react.createElement("div", {
        "data-testid": "bar",
        "data-key": props.dataKey,
        "data-fill": props.fill,
      });
    },
    XAxis: () => {
      return null;
    },
    YAxis: () => {
      return null;
    },
    Tooltip: () => {
      return null;
    },
    ReferenceArea: () => {
      return null;
    },
  };
});

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
        return apiPostMock(...args);
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
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import { getSpanStatusPresentation } from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../Types/ObjectID";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import {
  ActiveFilter,
  FacetConfig,
  HistogramBucket,
  HistogramSeriesOption,
  SearchHelpRow,
} from "../../../UI/Components/TelemetryViewer/types";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const FIRST_MINUTE: string = "2026-09-28T10:00:00.000Z";
const SECOND_MINUTE: string = "2026-09-28T10:01:00.000Z";

// Cyan: it stays apart from Error's red for colorblind readers too.
const OK_COLOR: string = "#0891b2";
const UNSET_COLOR: string = "#10b981";
const ERROR_COLOR: string = "#ef4444";
// What Unset used to be drawn in: a grey that read as "unknown".
const OLD_UNSET_GREY: string = "#9ca3af";
// The latency chart's own color, which has nothing to do with status.
const LATENCY_COLOR: string = "#6366f1";

// The one-sentence hover text each status carries.
const OK_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Ok,
).description;
const UNSET_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Unset,
).description;
const ERROR_DESCRIPTION: string = getSpanStatusPresentation(
  SpanStatus.Error,
).description;

const OK_SERIES: HistogramSeriesOption = {
  key: "ok",
  label: "Ok",
  color: OK_COLOR,
  description: OK_DESCRIPTION,
};
const UNSET_SERIES: HistogramSeriesOption = {
  key: "unset",
  label: "Unset (no error)",
  color: UNSET_COLOR,
  description: UNSET_DESCRIPTION,
};
const ERROR_SERIES: HistogramSeriesOption = {
  key: "error",
  label: "Error",
  color: ERROR_COLOR,
  description: ERROR_DESCRIPTION,
};

// How jsdom reads a six-digit hex color back from an inline style.
const toRgb: (hex: string) => string = (hex: string): string => {
  const channels: Array<number> = [1, 3, 5].map((start: number): number => {
    return parseInt(hex.substring(start, start + 2), 16);
  });
  return `rgb(${channels.join(", ")})`;
};

// What the histogram (count) and analytics (latency) endpoints answer.
let histogramResponse: Array<HistogramBucket> = [];
let analyticsResponse: Array<{ time: string; value: number }> = [];

type PostArgs = { url: { toString: () => string }; data: any };

type LastViewerPropsFunction = () => any;

const lastViewerProps: LastViewerPropsFunction = (): any => {
  const calls: Array<Array<any>> = viewerProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

const postsTo: (path: string) => Array<any> = (path: string): Array<any> => {
  return apiPostMock.mock.calls
    .map((call: Array<any>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return String(args.url).includes(path);
    })
    .map((args: PostArgs): any => {
      return args.data;
    });
};

const lastSpanListQuery: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const calls: Array<Array<any>> = analyticsGetListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return (calls[calls.length - 1]![0] as { query: Record<string, unknown> })
    .query;
};

const facetConfigFor: (key: string) => FacetConfig | undefined = (
  key: string,
): FacetConfig | undefined => {
  return (lastViewerProps().facetConfigs as Array<FacetConfig>).find(
    (config: FacetConfig): boolean => {
      return config.key === key;
    },
  );
};

const chipFor: (facetKey: string, value: string) => ActiveFilter | undefined = (
  facetKey: string,
  value: string,
): ActiveFilter | undefined => {
  return (lastViewerProps().activeFilters as Array<ActiveFilter>).find(
    (chip: ActiveFilter): boolean => {
      return chip.facetKey === facetKey && chip.value === value;
    },
  );
};

const seriesLabels: (series: Array<HistogramSeriesOption>) => Array<string> = (
  series: Array<HistogramSeriesOption>,
): Array<string> => {
  return series.map((option: HistogramSeriesOption): string => {
    return option.label;
  });
};

const renderViewer: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    render(<TracesViewer />);
  });
};

const includeFromSidebar: (
  facetKey: string,
  value: string,
) => Promise<void> = async (facetKey: string, value: string): Promise<void> => {
  await act(async (): Promise<void> => {
    (lastViewerProps().onFacetInclude as (k: string, v: string) => void)(
      facetKey,
      value,
    );
  });
};

// Picks a metric in the chart header's select, as a reader would.
const switchChartMetric: (metric: string) => Promise<void> = async (
  metric: string,
): Promise<void> => {
  await act(async (): Promise<void> => {
    fireEvent.change(screen.getByTitle("Chart metric"), {
      target: { value: metric },
    });
  });
};

interface LegendEntry {
  label: string;
  color: string;
  // The entry's hover text, or null when it has none.
  title: string | null;
}

// The chart header's legend, in order: each colored swatch and its label.
const legendEntries: () => Array<LegendEntry> = (): Array<LegendEntry> => {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      'span[style*="background-color"]',
    ),
  ).map((swatch: HTMLElement): LegendEntry => {
    const entry: HTMLElement = swatch.parentElement!;
    return {
      label: entry.textContent || "",
      color: swatch.style.backgroundColor,
      title: entry.getAttribute("title"),
    };
  });
};

interface DrawnBar {
  key: string | null;
  fill: string | null;
}

// The Bars the chart declares, bottom of the stack first.
const drawnBars: () => Array<DrawnBar> = (): Array<DrawnBar> => {
  return screen.queryAllByTestId("bar").map((bar: HTMLElement): DrawnBar => {
    return {
      key: bar.getAttribute("data-key"),
      fill: bar.getAttribute("data-fill"),
    };
  });
};

describe("TracesViewer — span status in the chart, the facets and the search help", () => {
  beforeEach(() => {
    histogramResponse = [];
    analyticsResponse = [];
    TelemetryEntityNameResolver.clearCache();
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    apiPostMock.mockImplementation(async (args: any) => {
      const url: string = String((args as PostArgs).url);
      if (url.includes("/telemetry/traces/histogram")) {
        return { data: { buckets: histogramResponse } };
      }
      if (url.includes("/telemetry/traces/analytics")) {
        return { data: { data: analyticsResponse } };
      }
      return { data: {} };
    });
    analyticsGetListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  test("REGRESSION: the count chart stacks Ok, 'Unset (no error)' and Error, with Unset green instead of grey", async () => {
    await renderViewer();

    const series: Array<HistogramSeriesOption> = lastViewerProps()
      .histogramSeries as Array<HistogramSeriesOption>;

    /*
     * The keys are the server's bucket names (TraceAggregationService), so
     * only the labels and colors may change — a renamed key would draw
     * nothing.
     */
    expect(series).toEqual([OK_SERIES, UNSET_SERIES, ERROR_SERIES]);
    // Every span is counted, so the bars are spans (issue #4202).
    expect(lastViewerProps().histogramTitle).toBe("Spans over time");

    for (const option of series) {
      expect(option.color).not.toBe(OLD_UNSET_GREY);
    }
  });

  test("REGRESSION: the server's ok / unset / error buckets draw cyan, green and red, each legended with what it means", async () => {
    histogramResponse = [
      { time: FIRST_MINUTE, series: "ok", count: 3 },
      { time: FIRST_MINUTE, series: "unset", count: 40 },
      { time: FIRST_MINUTE, series: "error", count: 2 },
      { time: SECOND_MINUTE, series: "unset", count: 35 },
    ];

    await renderViewer();

    await waitFor(() => {
      expect(lastViewerProps().histogramBuckets).toEqual(histogramResponse);
    });

    const buckets: Array<HistogramBucket> = lastViewerProps()
      .histogramBuckets as Array<HistogramBucket>;
    const series: Array<HistogramSeriesOption> = lastViewerProps()
      .histogramSeries as Array<HistogramSeriesOption>;

    // Draw what the shell was handed with the real chart.
    cleanup();
    render(
      <TelemetryHistogram
        buckets={buckets}
        series={series}
        isLoading={false}
      />,
    );

    expect(legendEntries()).toEqual([
      { label: "Ok", color: toRgb(OK_COLOR), title: OK_DESCRIPTION },
      {
        label: "Unset (no error)",
        color: toRgb(UNSET_COLOR),
        title: UNSET_DESCRIPTION,
      },
      { label: "Error", color: toRgb(ERROR_COLOR), title: ERROR_DESCRIPTION },
    ]);
    expect(drawnBars()).toEqual([
      { key: "ok", fill: OK_COLOR },
      { key: "unset", fill: UNSET_COLOR },
      { key: "error", fill: ERROR_COLOR },
    ]);
  });

  test("a latency metric keeps its single indigo series, and Count brings the status stack back", async () => {
    analyticsResponse = [
      { time: FIRST_MINUTE, value: 120 },
      { time: SECOND_MINUTE, value: 95 },
    ];

    await renderViewer();
    await switchChartMetric("p95Duration");

    await waitFor(() => {
      expect(lastViewerProps().histogramSeries).toEqual([
        { key: "latency", label: "P95", color: LATENCY_COLOR },
      ]);
    });
    expect(lastViewerProps().histogramTitle).toBe("Response time");

    // Its buckets are the latency rows, under the one key it draws.
    await waitFor(() => {
      expect(lastViewerProps().histogramBuckets).toEqual([
        { time: FIRST_MINUTE, series: "latency", count: 120 },
        { time: SECOND_MINUTE, series: "latency", count: 95 },
      ]);
    });

    await switchChartMetric("count");

    await waitFor(() => {
      expect(
        seriesLabels(
          lastViewerProps().histogramSeries as Array<HistogramSeriesOption>,
        ),
      ).toEqual(["Ok", "Unset (no error)", "Error"]);
    });
  });

  test("REGRESSION: the Status facet names Unset 'Unset (no error)' and colors each status as the chart does", async () => {
    await renderViewer();

    const status: FacetConfig | undefined = facetConfigFor("statusCode");

    expect(status).toBeDefined();
    expect(status!.title).toBe("Status");
    // Keyed by the stored value, which is what the facet endpoint returns.
    expect(status!.valueDisplayMap).toEqual({
      "0": "Unset (no error)",
      "1": "Ok",
      "2": "Error",
    });
    expect(status!.valueColorMap).toEqual({
      "0": UNSET_COLOR,
      "1": OK_COLOR,
      "2": ERROR_COLOR,
    });
  });

  test("the Has Exception facet uses the Error red", async () => {
    await renderViewer();

    expect(facetConfigFor("hasException")!.valueColorMap).toEqual({
      true: ERROR_COLOR,
    });
  });

  test("picking Unset in the sidebar reads 'Status: Unset (no error)' and still filters statusCode = 0", async () => {
    await renderViewer();

    await includeFromSidebar("statusCode", "0");

    await waitFor(() => {
      expect(chipFor("statusCode", "0")).toMatchObject({
        displayKey: "Status",
        displayValue: "Unset (no error)",
      });
    });

    // Only the name changed: the span list and the chart ask for the stored 0.
    await waitFor(() => {
      expect(lastSpanListQuery()["statusCode"]).toBe(SpanStatus.Unset);
    });
    await waitFor(() => {
      const histogramPosts: Array<any> = postsTo("/telemetry/traces/histogram");
      expect(histogramPosts[histogramPosts.length - 1].statusCodes).toEqual([
        SpanStatus.Unset,
      ]);
    });
  });

  test("the search help says what 'unset' means", async () => {
    await renderViewer();

    const rows: Array<SearchHelpRow> = lastViewerProps()
      .searchHelpRows as Array<SearchHelpRow>;

    expect(
      rows.find((row: SearchHelpRow): boolean => {
        return row.syntax === "status:ok|error|unset";
      }),
    ).toEqual({
      syntax: "status:ok|error|unset",
      description: "Filter by span status (unset = no error status set)",
      example: "status:error",
    });
  });
});

describe("TelemetryHistogram — the legend's hover text", () => {
  afterEach(() => {
    cleanup();
  });

  test("each legend entry shows its label and carries its description as hover text", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: FIRST_MINUTE, series: "ok", count: 3 },
          { time: FIRST_MINUTE, series: "unset", count: 40 },
          { time: FIRST_MINUTE, series: "error", count: 2 },
        ]}
        series={[OK_SERIES, UNSET_SERIES, ERROR_SERIES]}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Unset (no error)").parentElement).toHaveAttribute(
      "title",
      UNSET_DESCRIPTION,
    );
    expect(screen.getByText("Ok").parentElement).toHaveAttribute(
      "title",
      OK_DESCRIPTION,
    );
    expect(screen.getByText("Error").parentElement).toHaveAttribute(
      "title",
      ERROR_DESCRIPTION,
    );

    /*
     * Each entry says what its status means. The Unset entry names the status
     * field, not the span: recording an exception does not change a span's
     * status, so it cannot promise that nothing went wrong.
     */
    expect(
      screen.getByText("Unset (no error)").parentElement!.getAttribute("title"),
    ).toBe(
      "No error status was set. Unset is the OpenTelemetry default for spans that finish without one.",
    );
    expect(screen.getByText("Ok").parentElement!.getAttribute("title")).toBe(
      "Explicitly marked successful by the application or a trace pipeline.",
    );
    expect(screen.getByText("Error").parentElement!.getAttribute("title")).toBe(
      "The operation failed: the span's status is Error.",
    );
  });

  test("a series without a description gets a legend entry with no title", () => {
    render(
      <TelemetryHistogram
        buckets={[
          { time: FIRST_MINUTE, series: "unset", count: 4 },
          { time: FIRST_MINUTE, series: "queued", count: 2 },
        ]}
        series={[
          UNSET_SERIES,
          { key: "queued", label: "Queued", color: "#f59e0b" },
        ]}
        isLoading={false}
      />,
    );

    expect(legendEntries()).toEqual([
      {
        label: "Unset (no error)",
        color: toRgb(UNSET_COLOR),
        title: UNSET_DESCRIPTION,
      },
      { label: "Queued", color: toRgb("#f59e0b"), title: null },
    ]);
    expect(screen.getByText("Queued").parentElement).not.toHaveAttribute(
      "title",
    );
  });

  test("a status with no spans in the window is neither legended nor drawn", () => {
    render(
      <TelemetryHistogram
        buckets={[
          // A zero-count bucket holds its minute; it is not a sighting of Ok.
          { time: FIRST_MINUTE, series: "ok", count: 0 },
          { time: FIRST_MINUTE, series: "unset", count: 12 },
          { time: SECOND_MINUTE, series: "unset", count: 9 },
        ]}
        series={[OK_SERIES, UNSET_SERIES, ERROR_SERIES]}
        isLoading={false}
      />,
    );

    expect(legendEntries()).toEqual([
      {
        label: "Unset (no error)",
        color: toRgb(UNSET_COLOR),
        title: UNSET_DESCRIPTION,
      },
    ]);
    expect(screen.queryByText("Ok")).toBeNull();
    expect(screen.queryByText("Error")).toBeNull();
    expect(drawnBars()).toEqual([{ key: "unset", fill: UNSET_COLOR }]);
  });
});
