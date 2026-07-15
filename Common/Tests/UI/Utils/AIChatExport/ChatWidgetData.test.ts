import { describe, expect, test } from "@jest/globals";
import {
  AIChatWidget,
  AIChatWidgetSpan,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import {
  ExportChartSeries,
  SpanBarMetrics,
  buildParentBySpanId,
  chartHasData,
  chartIsTimeBased,
  computeSpanBar,
  computeSpanDepth,
  formatChartValue,
  formatStatValue,
  formatTableCell,
  formatToolArguments,
  toEntityListEntry,
  toExportChartSeries,
  totalTraceDuration,
} from "../../../../UI/Utils/AIChatExport/ChatWidgetData";

/*
 * These helpers exist to keep the exports in step with what the chat renders,
 * so the tests pin the behaviors that are easy to "tidy up" by accident — the
 * dash for empty cells, 0 not being empty, and a numeric string deliberately
 * not getting the grouping a real number gets.
 */

function chartWidget(data: AIChatWidget["data"]): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.TimeSeriesChart,
    title: "Chart",
    data: data,
  };
}

describe("ChatWidgetData", () => {
  describe("formatTableCell", () => {
    test("renders an em dash for null, undefined and empty string only", () => {
      const column: { key: string; title: string } = { key: "a", title: "A" };

      expect(formatTableCell(null, column)).toBe("—");
      expect(formatTableCell(undefined, column)).toBe("—");
      expect(formatTableCell("", column)).toBe("—");
    });

    test("keeps falsy-but-real values, which are not empty", () => {
      const column: { key: string; title: string } = { key: "a", title: "A" };

      expect(formatTableCell(0, column)).toBe("0");
      expect(formatTableCell(false, column)).toBe("false");
    });

    test("groups a number column, but only when the value is really a number", () => {
      const numeric: { key: string; title: string; type: "number" } = {
        key: "n",
        title: "N",
        type: "number",
      };

      expect(formatTableCell(1234567, numeric)).toBe(
        (1234567).toLocaleString(),
      );
      // A numeric string falls through to String() and keeps no separators.
      expect(formatTableCell("1234567", numeric)).toBe("1234567");
    });

    test("stringifies anything else", () => {
      const column: { key: string; title: string } = { key: "a", title: "A" };
      expect(formatTableCell(["a", "b"], column)).toBe("a,b");
    });
  });

  describe("formatStatValue", () => {
    test("groups numbers and passes strings through verbatim", () => {
      expect(formatStatValue({ label: "x", value: 1284322 })).toBe(
        (1284322).toLocaleString(),
      );
      expect(formatStatValue({ label: "x", value: "1284322" })).toBe("1284322");
    });

    test("appends the unit when there is one", () => {
      expect(formatStatValue({ label: "x", value: 12, unit: "ms" })).toBe(
        "12 ms",
      );
      expect(formatStatValue({ label: "x", value: 12, unit: "" })).toBe("12");
    });
  });

  describe("formatChartValue", () => {
    test("rounds to a whole number at or above 100, and to 2dp below", () => {
      expect(formatChartValue(1234.56)).toBe((1235).toLocaleString());
      expect(formatChartValue(12.345)).toBe((12.35).toLocaleString());
      expect(formatChartValue(-1234.56)).toBe((-1235).toLocaleString());
    });

    test("appends the unit after a single space", () => {
      expect(formatChartValue(12.5, "ms")).toBe("12.5 ms");
    });
  });

  describe("formatToolArguments", () => {
    test("skips empty values but keeps 0 and false", () => {
      expect(
        formatToolArguments({ a: null, b: undefined, c: "", d: 0, e: false }),
      ).toBe("d: 0  ·  e: false");
    });

    test("json-encodes objects and arrays", () => {
      expect(formatToolArguments({ tags: ["a", "b"] })).toBe('tags: ["a","b"]');
    });

    test("truncates a long value with an ellipsis, never the key", () => {
      const long: string = "x".repeat(200);
      const result: string = formatToolArguments({ key: long });

      expect(result.startsWith("key: ")).toBe(true);
      expect(result.endsWith("…")).toBe(true);
      expect(result).toBe(`key: ${"x".repeat(80)}…`);
    });
  });

  describe("span helpers", () => {
    const spans: Array<AIChatWidgetSpan> = [
      { spanId: "a", name: "root", startOffsetMs: 0, durationMs: 100, isError: false },
      {
        spanId: "b",
        parentSpanId: "a",
        name: "child",
        startOffsetMs: 10,
        durationMs: 50,
        isError: false,
      },
      {
        spanId: "c",
        parentSpanId: "b",
        name: "grandchild",
        startOffsetMs: 20,
        durationMs: 10,
        isError: true,
      },
    ];

    test("depth counts the parent chain", () => {
      const parents: Map<string, string | undefined> =
        buildParentBySpanId(spans);

      expect(computeSpanDepth(spans[0] as AIChatWidgetSpan, parents)).toBe(0);
      expect(computeSpanDepth(spans[1] as AIChatWidgetSpan, parents)).toBe(1);
      expect(computeSpanDepth(spans[2] as AIChatWidgetSpan, parents)).toBe(2);
    });

    test("a parent cycle terminates instead of hanging", () => {
      const cyclic: Array<AIChatWidgetSpan> = [
        { spanId: "x", parentSpanId: "y", name: "x", startOffsetMs: 0, durationMs: 1, isError: false },
        { spanId: "y", parentSpanId: "x", name: "y", startOffsetMs: 0, durationMs: 1, isError: false },
      ];
      const parents: Map<string, string | undefined> =
        buildParentBySpanId(cyclic);

      expect(
        computeSpanDepth(cyclic[0] as AIChatWidgetSpan, parents),
      ).toBeLessThanOrEqual(13);
    });

    test("the bar keeps a visible minimum width and stays inside the track", () => {
      // A zero-duration span still gets the 1.5% floor.
      const zero: SpanBarMetrics = computeSpanBar(
        { spanId: "z", name: "z", startOffsetMs: 0, durationMs: 0, isError: false },
        1000,
      );
      expect(zero.widthPercent).toBe(1.5);

      // A span running past the end is clipped to the right edge.
      const overflowing: SpanBarMetrics = computeSpanBar(
        { spanId: "o", name: "o", startOffsetMs: 900, durationMs: 5000, isError: false },
        1000,
      );
      expect(overflowing.leftPercent).toBe(90);
      expect(overflowing.widthPercent).toBe(10);
    });

    test("the denominator never reaches zero", () => {
      expect(
        totalTraceDuration({
          id: "W",
          type: AIChatWidgetType.TraceWaterfall,
          title: "t",
          data: { totalDurationMs: 0 },
        }),
      ).toBe(1);
    });
  });

  describe("toEntityListEntry", () => {
    test("reads the exception fields, and 0 occurrences still shows a count", () => {
      const entry: { heading: string; badges: Array<string> } =
        toEntityListEntry(
          { type: "TimeoutError", message: "boom", occurrences: 0 },
          AIChatWidgetType.ExceptionList,
        );

      expect(entry.heading).toBe("TimeoutError");
      expect(entry.badges).toContain("0×");
    });

    test("falls back to a generic exception heading", () => {
      const entry: { heading: string } = toEntityListEntry(
        { message: "boom" },
        AIChatWidgetType.ExceptionList,
      );
      expect(entry.heading).toBe("Exception");
    });

    test("prefixes an incident with its number", () => {
      const entry: { heading: string; badges: Array<string> } =
        toEntityListEntry(
          { incidentNumber: 412, title: "Down", state: "Resolved", severity: "Major" },
          AIChatWidgetType.IncidentList,
        );

      expect(entry.heading).toBe("#412 · Down");
      expect(entry.badges).toEqual(["Resolved", "Major"]);
    });

    test("an alert reads its own number field", () => {
      const entry: { heading: string } = toEntityListEntry(
        { alertNumber: 9, incidentNumber: 1, title: "Alert" },
        AIChatWidgetType.AlertList,
      );
      expect(entry.heading).toBe("#9 · Alert");
    });
  });

  describe("toExportChartSeries", () => {
    test("drops null and undefined y values", () => {
      const series: Array<ExportChartSeries> = toExportChartSeries(
        chartWidget({
          series: [
            {
              name: "s",
              points: [
                { x: "2026-07-15T10:00:00Z", y: 1 },
                { x: "2026-07-15T11:00:00Z", y: null },
              ],
            },
          ],
        }),
      );

      expect(series[0]?.points).toHaveLength(1);
      expect(series[0]?.points[0]?.y).toBe(1);
      expect(series[0]?.points[0]?.date).toBeInstanceOf(Date);
    });

    test("reports no data when every series is empty", () => {
      expect(chartHasData(toExportChartSeries(chartWidget({})))).toBe(false);
      expect(
        chartHasData(
          toExportChartSeries(chartWidget({ series: [{ name: "s", points: [] }] })),
        ),
      ).toBe(false);
    });

    test("a category x value is kept but not treated as a time", () => {
      const series: Array<ExportChartSeries> = toExportChartSeries(
        chartWidget({ series: [{ name: "s", points: [{ x: "ERROR", y: 2 }] }] }),
      );

      expect(series[0]?.points[0]?.x).toBe("ERROR");
      expect(series[0]?.points[0]?.date).toBeUndefined();
      expect(chartIsTimeBased(series)).toBe(false);
    });
  });
});
