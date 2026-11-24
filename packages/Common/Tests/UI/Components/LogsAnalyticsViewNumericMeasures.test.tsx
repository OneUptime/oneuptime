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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  clearDropdown,
  getShownDropdownPlaceholder,
  getShownDropdownValue,
  listDropdownOptions,
  pickDropdownOption,
} from "../../DropdownPicks";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * LOGS → ANALYTICS: THE SUM, AVERAGE, PERCENTILES, MINIMUM AND MAXIMUM OF A
 * NUMERIC ATTRIBUTE (#7716).
 *
 * Beside Count (the default) and Unique Count, the Measure picker offers
 * Sum, Average, Median (P50), P90, P95, P99, Minimum and Maximum. Picking
 * one asks "of" which attribute - the logs' attributes only, a log's own
 * fields hold no number - and until one is picked the chart says so and
 * nothing is read. The chart then says what it measures over its value
 * axis ("P95 of duration_ms"), as the top list and the table say it in
 * their headers; an average's or a percentile's groups are lines of their
 * own, never a stack, with no total in the tooltip and no share in the top
 * list.
 *
 * Recharts is stood in for: each chart and series is a div that says what
 * it is, the value axis says how it writes its ticks, and the tooltip draws
 * the view's own tooltip over a payload the test sets.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
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

// What the stand-in tooltip hands the view's tooltip, when set.
let mockTooltipPayload: Array<{
  dataKey: string;
  value: number;
  color: string;
}> | null = null;

// Values the stand-in value axis writes with the view's tick formatter.
const mockTickValues: Array<number> = [0, 0.25, 182.456, -7, 1500];

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (
    testId: string,
  ) => (props: { children?: React.ReactNode }) => React.ReactElement = (
    testId: string,
  ) => {
    return (props: { children?: React.ReactNode }): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": testId },
        props.children,
      );
    };
  };

  const series: (
    kind: string,
  ) => (props: { dataKey: string; stackId?: string }) => React.ReactElement = (
    kind: string,
  ) => {
    return (props: {
      dataKey: string;
      stackId?: string;
    }): React.ReactElement => {
      return react.createElement("div", {
        "data-testid": `${kind}-${props.dataKey}`,
        "data-stack": props.stackId || "",
      });
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
    AreaChart: chart("area-chart"),
    BarChart: chart("bar-chart"),
    LineChart: chart("line-chart"),
    Area: series("area"),
    Bar: series("bar"),
    Line: series("line"),
    XAxis: nothing,
    YAxis: (props: {
      allowDecimals?: boolean;
      tickFormatter: (value: number) => string;
    }) => {
      return react.createElement("div", {
        "data-testid": "value-axis",
        "data-allow-decimals": String(Boolean(props.allowDecimals)),
        "data-ticks": mockTickValues.map(props.tickFormatter).join("|"),
      });
    },
    CartesianGrid: nothing,
    Tooltip: (props: { content: React.ReactElement }) => {
      return react.createElement(
        "div",
        { "data-testid": "tooltip" },
        mockTooltipPayload
          ? react.cloneElement(props.content, {
              active: true,
              label: "2026-11-19 09:00:00",
              payload: mockTooltipPayload,
            })
          : null,
      );
    },
    ReferenceArea: nothing,
  };
});

// Imported after the mocks so the view picks them up.
import LogsAnalyticsView, {
  formatAnalyticsValue,
  LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID,
  LOGS_ANALYTICS_MEASURE_OPTIONS,
  LOGS_ANALYTICS_VALUE_LABEL_TEST_ID,
  LOGS_ANALYTICS_VALUE_LABELS,
  pivotTimeseriesData,
} from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import {
  formatChartCount,
  formatChartValue,
} from "../../../UI/Components/Charts/Utils/ChartCount";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import { LOG_ANALYTICS_AGGREGATIONS } from "../../../Types/Log/LogAnalyticsAggregation";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const HOUR_WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-19T09:00:00.000Z"),
    new Date("2026-11-19T10:00:00.000Z"),
  ),
};

const ATTRIBUTES: Array<string> = ["duration_ms", "bytes", "http.route"];

type AnalyticsAnswer = (body: JSONObject) => unknown;

// What the stand-in API answers each analytics request with.
let answer: AnalyticsAnswer = (): unknown => {
  return [];
};

beforeEach(() => {
  mockTooltipPayload = null;
  postMock.mockReset();
  postMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { data: JSONObject } = args[0] as { data: JSONObject };
    return { data: { data: answer(request.data) } };
  });
});

afterEach(() => {
  cleanup();
});

// Every analytics request the view sent, in order.
function requests(): Array<JSONObject> {
  return postMock.mock.calls.map((call: Array<unknown>): JSONObject => {
    return (call[0] as { data: JSONObject }).data;
  });
}

function lastRequest(): JSONObject | undefined {
  return requests()[requests().length - 1];
}

function picker(name: string): HTMLElement {
  return screen.getByRole("combobox", { name });
}

async function drawView(): Promise<void> {
  render(
    <LogsAnalyticsView
      timeRange={HOUR_WINDOW}
      appliedFacetFilters={new Map()}
      logAttributes={ATTRIBUTES}
    />,
  );

  await waitFor(() => {
    expect(postMock).toHaveBeenCalled();
  });
}

async function pick(caption: string, option: string): Promise<void> {
  await pickDropdownOption(picker(caption), option);
}

// No group-by: "None" is the picker's placeholder, which clearing it picks.
async function groupByNone(): Promise<void> {
  await act(async () => {
    clearDropdown(picker("Group by"));
  });
}

// Two severities' p95 of duration_ms over two buckets.
function twoSeries(body: JSONObject): unknown {
  if (body["chartType"] !== "timeseries") {
    return [];
  }

  return [
    {
      time: "2026-11-19 09:00:00",
      count: 182.25,
      groupValues: { severityText: "Error" },
    },
    {
      time: "2026-11-19 09:00:00",
      count: 12.5,
      groupValues: { severityText: "Information" },
    },
    {
      time: "2026-11-19 09:05:00",
      count: 240,
      groupValues: { severityText: "Error" },
    },
  ];
}

describe("the Measure picker", () => {
  test("offers Count first, as the default, then Unique Count and every aggregation of a number", async () => {
    await drawView();

    expect(getShownDropdownValue(picker("Measure"))).toBe("Count");
    expect(await listDropdownOptions(picker("Measure"))).toEqual([
      "Count",
      "Unique Count",
      "Sum",
      "Average",
      "Median (P50)",
      "P90",
      "P95",
      "P99",
      "Minimum",
      "Maximum",
    ]);

    // A count reads no field: there is no "of" beside it.
    expect(screen.queryByRole("combobox", { name: "of" })).toBeNull();
    expect(lastRequest()).toMatchObject({ aggregation: "count" });
    expect(lastRequest()).not.toHaveProperty("aggregationField");
  });

  test("offers each aggregation the route takes, and no other", () => {
    expect(
      LOGS_ANALYTICS_MEASURE_OPTIONS.map((option: { value: string }) => {
        return option.value;
      }),
    ).toEqual([...LOG_ANALYTICS_AGGREGATIONS]);
    expect(Object.keys(LOGS_ANALYTICS_VALUE_LABELS).sort()).toEqual(
      [...LOG_ANALYTICS_AGGREGATIONS].sort(),
    );
  });
});

describe("a measure of a number", () => {
  test("asks which attribute it is of, offering the attributes alone, and reads nothing until one is picked", async () => {
    await drawView();
    const before: number = requests().length;

    await pick("Measure", "P95");

    const of: HTMLElement = picker("of");

    expect(getShownDropdownPlaceholder(of)).toBe("Select field...");
    expect(await listDropdownOptions(of)).toEqual(ATTRIBUTES);
    expect(
      screen.getByTestId(LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID),
    ).toHaveTextContent("Choose the numeric attribute to chart.");
    expect(requests().length).toBe(before);
  });

  test("reads the p95 of the attribute picked, and says so over the value axis", async () => {
    answer = twoSeries;
    await drawView();

    await pick("Measure", "P95");
    await pick("of", "duration_ms");

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    expect(lastRequest()).toMatchObject({
      chartType: "timeseries",
      aggregation: "p95",
      aggregationField: "duration_ms",
      groupBy: ["severityText"],
    });
    expect(
      screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
    ).toHaveTextContent("P95 of duration_ms");
  });

  test("draws a group's p95 as a line of its own, never a stack, on an axis that shows fractions", async () => {
    answer = twoSeries;
    await drawView();

    await pick("Measure", "P95");
    await pick("of", "duration_ms");

    await waitFor(() => {
      expect(screen.getByTestId("line-Error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("line-Information")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(screen.queryByTestId("bar-Error")).toBeNull();

    const axis: HTMLElement = screen.getByTestId("value-axis");

    expect(axis).toHaveAttribute("data-allow-decimals", "true");
    expect(axis).toHaveAttribute("data-ticks", "0|0.25|182|-7|1.5K");
  });

  test("lists each group's value in the tooltip, a 0 too, with no total", async () => {
    answer = twoSeries;
    mockTooltipPayload = [
      { dataKey: "Error", value: 182.25, color: "#6366f1" },
      { dataKey: "Information", value: 0, color: "#ec4899" },
    ];
    await drawView();

    await pick("Measure", "P95");
    await pick("of", "duration_ms");

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });

    const tooltip: HTMLElement = screen.getByTestId("tooltip");

    expect(within(tooltip).getByText("182.25")).toBeInTheDocument();
    expect(within(tooltip).getByText("0")).toBeInTheDocument();
    expect(within(tooltip).queryByText("Total")).toBeNull();
  });

  test("an ungrouped average is one area, named for what it measures", async () => {
    answer = (body: JSONObject): unknown => {
      return body["chartType"] === "timeseries"
        ? [{ time: "2026-11-19 09:00:00", count: 0.5, groupValues: {} }]
        : [];
    };
    mockTooltipPayload = [{ dataKey: "count", value: 0.5, color: "#6366f1" }];
    await drawView();

    await groupByNone();
    await pick("Measure", "Average");
    await pick("of", "bytes");

    await waitFor(() => {
      expect(screen.getByTestId("area-count")).toBeInTheDocument();
    });

    expect(lastRequest()).toMatchObject({
      aggregation: "avg",
      aggregationField: "bytes",
    });
    expect(lastRequest()).not.toHaveProperty("groupBy");
    expect(
      within(screen.getByTestId("tooltip")).getByText("Average of bytes"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
    ).toHaveTextContent("Average of bytes");
  });

  test.each([
    ["Sum", "sum", "Sum of bytes"],
    ["Median (P50)", "p50", "Median of bytes"],
    ["P90", "p90", "P90 of bytes"],
    ["P99", "p99", "P99 of bytes"],
    ["Minimum", "min", "Minimum of bytes"],
    ["Maximum", "max", "Maximum of bytes"],
  ])(
    "%s reads %s and is labelled %p",
    async (measure: string, aggregation: string, label: string) => {
      answer = (body: JSONObject): unknown => {
        return body["chartType"] === "timeseries"
          ? [{ time: "2026-11-19 09:00:00", count: 3, groupValues: {} }]
          : [];
      };
      await drawView();

      await groupByNone();
      await pick("Measure", measure);
      await pick("of", "bytes");

      await waitFor(() => {
        expect(lastRequest()).toMatchObject({
          aggregation,
          aggregationField: "bytes",
        });
      });
      await waitFor(() => {
        expect(
          screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
        ).toHaveTextContent(label);
      });
    },
  );

  test("a sum still stacks its groups, and the tooltip totals them", async () => {
    answer = twoSeries;
    mockTooltipPayload = [
      { dataKey: "Error", value: 2, color: "#6366f1" },
      { dataKey: "Information", value: 3, color: "#ec4899" },
    ];
    await drawView();

    await pick("Measure", "Sum");
    await pick("of", "bytes");

    await waitFor(() => {
      expect(screen.getByTestId("bar-Error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("bar-Error")).toHaveAttribute(
      "data-stack",
      "group",
    );
    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(
      within(screen.getByTestId("tooltip")).getByText("Total"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("tooltip")).getByText("5"),
    ).toBeInTheDocument();
  });
});

describe("the top list and the table of a number", () => {
  test("the top list says what its numbers measure, and gives no share of a sum of averages", async () => {
    answer = (body: JSONObject): unknown => {
      return body["chartType"] === "toplist"
        ? [
            { value: "/checkout", count: 1250.756 },
            { value: "/search", count: 0.0123 },
          ]
        : [];
    };
    await drawView();

    await pick("Chart", "Top List");
    await pick("Group by", "http.route");
    await pick("Measure", "Maximum");
    await pick("of", "bytes");

    await waitFor(() => {
      expect(screen.getByText("/checkout")).toBeInTheDocument();
    });

    expect(lastRequest()).toMatchObject({
      chartType: "toplist",
      aggregation: "max",
      aggregationField: "bytes",
      groupBy: ["http.route"],
    });
    expect(
      screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
    ).toHaveTextContent("Maximum of bytes");
    expect(screen.getByText("1,250.76")).toBeInTheDocument();
    expect(screen.getByText("0.0123")).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  test("a count's top list keeps its share of the whole", async () => {
    answer = (body: JSONObject): unknown => {
      return body["chartType"] === "toplist"
        ? [
            { value: "Error", count: 3 },
            { value: "Information", count: 1 },
          ]
        : [];
    };
    await drawView();

    await pick("Chart", "Top List");

    await waitFor(() => {
      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(
      screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
    ).toHaveTextContent("Count");
  });

  test("the table's value column is named for what it measures", async () => {
    answer = (body: JSONObject): unknown => {
      return body["chartType"] === "table"
        ? [
            { groupValues: { severityText: "Error" }, count: 99.5 },
            { groupValues: { severityText: "Information" }, count: -7 },
          ]
        : [];
    };
    await drawView();

    await pick("Chart", "Table");
    await pick("Measure", "Minimum");
    await pick("of", "duration_ms");

    await waitFor(() => {
      expect(screen.getByText("99.5")).toBeInTheDocument();
    });

    expect(screen.getByText("-7")).toBeInTheDocument();
    expect(
      screen.getByTestId(LOGS_ANALYTICS_VALUE_LABEL_TEST_ID),
    ).toHaveTextContent("Minimum of duration_ms");
  });
});

describe("a unique count", () => {
  test("offers a log's own fields and the attributes, and reads nothing until one is picked", async () => {
    await drawView();
    const before: number = requests().length;

    await pick("Measure", "Unique Count");

    expect(await listDropdownOptions(picker("of"))).toEqual([
      "Severity",
      "Service",
      "Trace ID",
      "Span ID",
      ...ATTRIBUTES,
    ]);
    expect(
      screen.getByTestId(LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID),
    ).toHaveTextContent("Choose which field's unique values to count.");
    expect(requests().length).toBe(before);

    await pick("of", "Trace ID");

    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        aggregation: "unique",
        aggregationField: "traceId",
      });
    });
  });

  test("a log's own field it counted is let go when a number is measured; an attribute is kept", async () => {
    answer = twoSeries;
    await drawView();

    await pick("Measure", "Unique Count");
    await pick("of", "Severity");
    await pick("Measure", "Average");

    expect(getShownDropdownPlaceholder(picker("of"))).toBe("Select field...");
    expect(
      screen.getByTestId(LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID),
    ).toBeInTheDocument();

    await pick("of", "duration_ms");
    await pick("Measure", "Unique Count");

    expect(getShownDropdownValue(picker("of"))).toBe("duration_ms");

    await pick("Measure", "P99");

    expect(getShownDropdownValue(picker("of"))).toBe("duration_ms");
    await waitFor(() => {
      expect(lastRequest()).toMatchObject({
        aggregation: "p99",
        aggregationField: "duration_ms",
      });
    });
  });
});

describe("the figures", () => {
  test("a number's value axis keeps its fractions and its sign, a count's its whole numbers", () => {
    expect(
      [
        0, 0.25, 0.025, 1.5, 12.345, 182.456, 999.7, -7, 1500, 25000, 2500000,
      ].map((value: number) => {
        return formatChartValue(value);
      }),
    ).toEqual([
      "0",
      "0.25",
      "0.025",
      "1.5",
      "12.3",
      "182",
      "1.0K",
      "-7",
      "1.5K",
      "25K",
      "2.5M",
    ]);
    expect(formatChartValue(-0)).toBe("0");
    expect(formatChartValue(Number.NaN)).toBe("");
    expect(formatChartCount(1500)).toBe("1.5K");
  });

  test("a number's value axis is written in the reader's digits and decimal sign", () => {
    expect(formatChartValue(0.25, "de")).toBe("0,25");
    expect(formatChartValue(1500, "de")).toBe("1,5K");
    expect(formatChartValue(-7, "de")).toBe("-7");
    expect(formatChartValue(0.25, "fa")).toBe("۰٫۲۵");
  });

  test("a value is written with two decimals at most, three figures below one", () => {
    expect(formatAnalyticsValue(1250.756)).toBe("1,250.76");
    expect(formatAnalyticsValue(182.25)).toBe("182.25");
    expect(formatAnalyticsValue(12)).toBe("12");
    expect(formatAnalyticsValue(0.0123456)).toBe("0.0123");
    expect(formatAnalyticsValue(-0.5)).toBe("-0.5");
    expect(formatAnalyticsValue(0)).toBe("0");
    expect(formatAnalyticsValue(Number.POSITIVE_INFINITY)).toBe("");
  });

  test("the one series of an ungrouped chart is named for what it measures", () => {
    expect(
      pivotTimeseriesData(
        [{ time: "t", count: 0.5, groupValues: {} }],
        undefined,
        "Average of bytes",
      ),
    ).toEqual({
      pivotedData: [{ time: "t", count: 0.5 }],
      seriesKeys: ["count"],
      seriesLabels: { count: "Average of bytes" },
    });
  });
});
