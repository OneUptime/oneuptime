/*
 * Traces > Analytics split by span status (issue #4118).
 *
 * Unset is OpenTelemetry's default status: the one a span keeps when nothing
 * marked it Ok or Error. The analytics view named it a bare "Unset" and, like
 * any other split, colored each status by its position in the palette, so the
 * Error series came out indigo, pink or even green depending on the order the
 * rows arrived in.
 *
 * The renderer-free half of the fix lives in TracesEntityDisplay:
 * TRACE_ANALYTICS_STATUS_LABEL reads the shared module's display labels,
 * pivotTraceAnalyticsTimeseries hands back each series' raw group values, and
 * getTraceAnalyticsStatusColor turns a split by status ALONE into the status's
 * own color. Anything else (no split, another dimension, status crossed with
 * a second dimension) gets no status color, and the view keeps coloring it by
 * position. TracesAnalyticsStatusSplit.test.tsx (Common) mounts the view.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  /*
   * The display module's entity-name resolver imports the API client, whose
   * import chain reads `window`; nothing here resolves a name.
   */
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import {
  TRACE_ANALYTICS_EMPTY_GROUP_LABEL,
  TRACE_ANALYTICS_STATUS_LABEL,
  buildTraceAnalyticsValueLabels,
  formatTraceAnalyticsGroupValue,
  getTraceAnalyticsStatusColor,
  pivotTraceAnalyticsTimeseries,
} from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusDisplayLabelMap,
  getSpanStatusPresentation,
} from "../../FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";

const UNSET_COLOR: string = "#10b981";
const OK_COLOR: string = "#0891b2";
const ERROR_COLOR: string = "#ef4444";

type Pivot = ReturnType<typeof pivotTraceAnalyticsTimeseries>;

type SeriesColorsFunction = (pivot: Pivot) => Array<string | undefined>;

// The status color the view looks up for each series, in legend order.
const seriesColors: SeriesColorsFunction = (
  pivot: Pivot,
): Array<string | undefined> => {
  return pivot.seriesKeys.map((seriesKey: string): string | undefined => {
    return getTraceAnalyticsStatusColor(pivot.seriesGroupValues[seriesKey]);
  });
};

/*
 * Type aliases, not interfaces: jest's typed test.each takes an object table
 * only when its type is assignable to Record<string, unknown>.
 */
type StatusColorCase = {
  statusCode: string;
  name: string;
  color: string;
};

type NoStatusColorCase = {
  description: string;
  groupValues: Record<string, string> | undefined;
};

describe("getTraceAnalyticsStatusColor", () => {
  test.each<StatusColorCase>([
    { statusCode: "0", name: "Unset", color: UNSET_COLOR },
    { statusCode: "1", name: "Ok", color: OK_COLOR },
    { statusCode: "2", name: "Error", color: ERROR_COLOR },
  ])(
    "REGRESSION: a split by status alone paints $name ($statusCode) $color",
    (testCase: StatusColorCase) => {
      expect(
        getTraceAnalyticsStatusColor({ statusCode: testCase.statusCode }),
      ).toBe(testCase.color);
      // The module's own color, not a copy of it that could drift.
      expect(
        getTraceAnalyticsStatusColor({ statusCode: testCase.statusCode }),
      ).toBe(getSpanStatusPresentation(testCase.statusCode).color);
    },
  );

  test("the three statuses get three different colors; Unset is not the old grey, nor Ok the old green", () => {
    const colors: Array<string | undefined> = ["0", "1", "2"].map(
      (statusCode: string): string | undefined => {
        return getTraceAnalyticsStatusColor({ statusCode });
      },
    );

    // Three legend entries that can be told apart.
    expect(new Set<string | undefined>(colors).size).toBe(3);
    expect(colors).toEqual([UNSET_COLOR, OK_COLOR, ERROR_COLOR]);
    expect(colors).not.toContain("#9ca3af");
    // A darker green Ok that protanopes could not tell from Error's red.
    expect(colors).not.toContain("#047857");
  });

  test.each<NoStatusColorCase>([
    { description: "no group values at all", groupValues: undefined },
    { description: "an unsplit series", groupValues: {} },
    { description: "another dimension", groupValues: { name: "x" } },
    {
      description: "another dimension whose value looks like a status",
      groupValues: { name: "2" },
    },
    {
      description: "a status value that is not 0, 1 or 2",
      groupValues: { statusCode: "7" },
    },
    { description: "an empty status", groupValues: { statusCode: "" } },
    {
      description: "status crossed with a second dimension",
      groupValues: { statusCode: "0", name: "api" },
    },
    {
      description: "status crossed with a second dimension, listed second",
      groupValues: { name: "api", statusCode: "2" },
    },
  ])(
    "$description: no status color, so the view colors it by position",
    (testCase: NoStatusColorCase) => {
      expect(
        getTraceAnalyticsStatusColor(testCase.groupValues),
      ).toBeUndefined();
    },
  );
});

describe("pivotTraceAnalyticsTimeseries hands back each series' raw group values", () => {
  test("an unsplit timeseries is one series with no group values", () => {
    const pivot: Pivot = pivotTraceAnalyticsTimeseries({
      rows: [
        { time: "t1", value: 1, groupValues: {} },
        // A row without the field at all counts as unsplit too.
        { time: "t2", value: 2 },
      ],
      serviceNameMap: {},
      metricLabel: "Request Count",
    });

    expect(pivot.seriesKeys).toEqual(["Request Count"]);
    expect(pivot.seriesGroupValues).toEqual({ "Request Count": {} });
    expect(seriesColors(pivot)).toEqual([undefined]);
  });

  test("REGRESSION: a status split reads 'Unset (no error)', 'Ok' and 'Error', each label mapping back to its raw status", () => {
    // Error first: by position it would have taken the palette's first color.
    const pivot: Pivot = pivotTraceAnalyticsTimeseries({
      rows: [
        { time: "t1", value: 3, groupValues: { statusCode: "2" } },
        { time: "t1", value: 40, groupValues: { statusCode: "0" } },
        { time: "t1", value: 5, groupValues: { statusCode: "1" } },
        { time: "t2", value: 35, groupValues: { statusCode: "0" } },
        { time: "t2", value: 1, groupValues: { statusCode: "2" } },
      ],
      serviceNameMap: {},
      metricLabel: "Request Count",
    });

    expect(pivot.seriesKeys).toEqual(["Error", "Unset (no error)", "Ok"]);
    expect(pivot.seriesGroupValues).toEqual({
      Error: { statusCode: "2" },
      "Unset (no error)": { statusCode: "0" },
      Ok: { statusCode: "1" },
    });
    // What the view colors each series with: its status, whatever its position.
    expect(seriesColors(pivot)).toEqual([ERROR_COLOR, UNSET_COLOR, OK_COLOR]);
    // The chart rows are keyed by the same labels.
    expect(pivot.pivotedData).toEqual([
      { time: "t1", Error: 3, "Unset (no error)": 40, Ok: 5 },
      { time: "t2", "Unset (no error)": 35, Error: 1 },
    ]);
  });

  test("status crossed with a second dimension: composite labels, each mapping to both raw values and to no status color", () => {
    const pivot: Pivot = pivotTraceAnalyticsTimeseries({
      rows: [
        {
          time: "t1",
          value: 2,
          groupValues: { statusCode: "2", name: "GET /checkout" },
        },
        {
          time: "t1",
          value: 30,
          groupValues: { statusCode: "0", name: "GET /checkout" },
        },
        {
          time: "t1",
          value: 12,
          groupValues: { statusCode: "0", name: "POST /cart" },
        },
      ],
      serviceNameMap: {},
      metricLabel: "Request Count",
    });

    expect(pivot.seriesKeys).toEqual([
      "Error / GET /checkout",
      "Unset (no error) / GET /checkout",
      "Unset (no error) / POST /cart",
    ]);
    expect(pivot.seriesGroupValues).toEqual({
      "Error / GET /checkout": { statusCode: "2", name: "GET /checkout" },
      "Unset (no error) / GET /checkout": {
        statusCode: "0",
        name: "GET /checkout",
      },
      "Unset (no error) / POST /cart": {
        statusCode: "0",
        name: "POST /cart",
      },
    });
    // Two series share a status here, so the view colors them by position.
    expect(seriesColors(pivot)).toEqual([undefined, undefined, undefined]);
  });

  test("a split by another dimension maps each label to its raw value, with no status color", () => {
    const pivot: Pivot = pivotTraceAnalyticsTimeseries({
      rows: [
        { time: "t1", value: 1, groupValues: { name: "GET /checkout" } },
        // A span literally named "2" is not the Error status.
        { time: "t1", value: 2, groupValues: { name: "2" } },
      ],
      serviceNameMap: {},
      metricLabel: "Request Count",
    });

    expect(pivot.seriesKeys).toEqual(["GET /checkout", "2"]);
    expect(pivot.seriesGroupValues).toEqual({
      "GET /checkout": { name: "GET /checkout" },
      "2": { name: "2" },
    });
    expect(seriesColors(pivot)).toEqual([undefined, undefined]);
  });

  test("numbered labels stay aligned: every series has exactly one entry, under its own label", () => {
    const pivot: Pivot = pivotTraceAnalyticsTimeseries({
      rows: [
        { time: "t1", value: 1, groupValues: { name: "" } },
        {
          time: "t1",
          value: 2,
          groupValues: { name: TRACE_ANALYTICS_EMPTY_GROUP_LABEL },
        },
        { time: "t1", value: 3, groupValues: { name: "time" } },
      ],
      serviceNameMap: {},
      metricLabel: "Request Count",
    });

    expect(pivot.seriesKeys).toEqual(["(empty)", "(empty) #2", "time #2"]);
    expect(pivot.seriesGroupValues).toEqual({
      "(empty)": { name: "" },
      "(empty) #2": { name: TRACE_ANALYTICS_EMPTY_GROUP_LABEL },
      "time #2": { name: "time" },
    });
    expect(Object.keys(pivot.seriesGroupValues).sort()).toEqual(
      [...pivot.seriesKeys].sort(),
    );
  });
});

describe("status labels in the analytics view", () => {
  test("REGRESSION: TRACE_ANALYTICS_STATUS_LABEL is the shared module's display labels", () => {
    expect(TRACE_ANALYTICS_STATUS_LABEL).toEqual(
      getSpanStatusDisplayLabelMap(),
    );
    // Was { "0": "Unset", "1": "Ok", "2": "Error" }.
    expect(TRACE_ANALYTICS_STATUS_LABEL).toEqual({
      "0": "Unset (no error)",
      "1": "Ok",
      "2": "Error",
    });
    // One entry per status the module presents, and nothing else.
    expect(Object.entries(TRACE_ANALYTICS_STATUS_LABEL).sort()).toEqual(
      SPAN_STATUS_PRESENTATIONS.map(
        (presentation: SpanStatusPresentation): [string, string] => {
          return [String(presentation.status), presentation.displayLabel];
        },
      ).sort(),
    );
  });

  test("only the display changes: the keys are still the stored values", () => {
    expect(Object.keys(TRACE_ANALYTICS_STATUS_LABEL).sort()).toEqual(
      [SpanStatus.Unset, SpanStatus.Ok, SpanStatus.Error].map(String).sort(),
    );
  });

  test("REGRESSION: a status group value of 0 reads 'Unset (no error)', not 'Unset'", () => {
    const base: { key: string; serviceNameMap: Record<string, string> } = {
      key: "statusCode",
      serviceNameMap: {},
    };

    expect(formatTraceAnalyticsGroupValue({ ...base, raw: "0" })).toBe(
      "Unset (no error)",
    );
    expect(formatTraceAnalyticsGroupValue({ ...base, raw: "1" })).toBe("Ok");
    expect(formatTraceAnalyticsGroupValue({ ...base, raw: "2" })).toBe("Error");
    // Anything else is still shown as it came.
    expect(formatTraceAnalyticsGroupValue({ ...base, raw: "7" })).toBe("7");
    expect(formatTraceAnalyticsGroupValue({ ...base, raw: "" })).toBe(
      TRACE_ANALYTICS_EMPTY_GROUP_LABEL,
    );
  });

  test("REGRESSION: the top list and the table name Unset the same way", () => {
    const labels: Map<string, string> = buildTraceAnalyticsValueLabels({
      key: "statusCode",
      values: ["2", "0", "1"],
      serviceNameMap: {},
    });

    expect(Array.from(labels.entries())).toEqual([
      ["2", "Error"],
      ["0", "Unset (no error)"],
      ["1", "Ok"],
    ]);
  });
});
