import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the Databases pages: drag across any chart to
 * zoom, double-click any chart to go back. App's node test environment
 * cannot render React, so the load-bearing wiring is pinned here as
 * comment-stripped, whitespace-squashed source; what it DOES is rendered
 * and exercised in
 *
 *   Common/Tests/App/Dashboard/DatabaseOverviewTimeRangeZoom.test.tsx
 *   Common/Tests/App/Dashboard/DatabaseMetricChartModalTimeRangeZoom.test.tsx
 */

function readCode(relative: string): string {
  return fs
    .readFileSync(
      path.join(__dirname, "../../FeatureSet/Dashboard/src", relative),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\{\s*\}/g, " ")
    .replace(/\s+/g, " ");
}

function indexOfOrFail(code: string, needle: string): number {
  const index: number = code.indexOf(needle);
  if (index < 0) {
    throw new Error(`Expected the source to contain "${needle}".`);
  }
  return index;
}

/*
 * Where `<TimeRangeZoomScope timeRange={...} onTimeRangeChange={...}>`
 * opens, whether Prettier kept it on one line or broke it (which squashes
 * to a space before the ">").
 */
function scopeOpening(
  code: string,
  timeRange: string,
  onTimeRangeChange: string,
): number {
  const opening: string = `<TimeRangeZoomScope timeRange={${timeRange}} onTimeRangeChange={${onTimeRangeChange}}`;
  const index: number = code.search(
    new RegExp(`${opening.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ?>`),
  );
  if (index < 0) {
    throw new Error(`Expected the source to contain "${opening}>".`);
  }
  return index;
}

const SCOPE_IMPORT: string =
  'import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";';

describe("Database Overview: one zoom for the whole page", () => {
  const code: string = readCode("Pages/Database/View/Overview.tsx");

  test("the page wraps its tree in a zoom scope over its own range and setter", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(scopeOpening(code, "timeRange", "setTimeRange")).toBeGreaterThan(-1);
    // Its one range; no second copy of it for the zoom.
    expect(code).toContain(
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);",
    );
  });

  test("the picker, the hero's charts and every section after it are inside the scope", () => {
    const open: number = scopeOpening(code, "timeRange", "setTimeRange");
    const close: number = indexOfOrFail(code, "</TimeRangeZoomScope>");

    // The scope is the page's whole tree: it is the element returned.
    expect(code.slice(open - "return ( ".length, open)).toBe("return ( ");

    for (const inside of [
      "<ResourceOverview icon=",
      "<TelemetryTimeRangePicker value={timeRange}",
      "<DatabaseCallingServicesCard",
      "<DatabaseRuntimeSection",
      "<DatabaseEngineMetricsSection",
    ]) {
      const at: number = indexOfOrFail(code, inside);
      expect([inside, at > open && at < close]).toEqual([inside, true]);
    }
  });

  test("the picker still sets the page's range directly: a pick is a new starting point", () => {
    expect(code).toContain(
      "onChange={(value: RangeStartAndEndDateTime): void => { setTimeRange(value); }}",
    );
  });

  test("every section is fetched over the one range, so a zoom retimes them all", () => {
    expect(code).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);",
    );
    expect(code).toContain("}, [databaseServer, endpoints, timeRange]);");
    expect(code).toContain(
      "windowStart={chartWindow?.start ?? null} windowEnd={chartWindow?.end ?? null}",
    );
  });

  test("the charts take the page's zoom themselves; none opts out", () => {
    for (const file of [
      "Pages/Database/View/Overview.tsx",
      "Components/DatabaseServer/DatabaseRuntimeSection.tsx",
      "Components/DatabaseServer/DatabaseEngineMetricsSection.tsx",
    ]) {
      const source: string = readCode(file);
      expect([file, source.includes("disableTimeRangeZoom")]).toEqual([
        file,
        false,
      ]);
      expect([file, source.includes("TimeRangeZoomProvider")]).toEqual([
        file,
        false,
      ]);
    }
  });
});

describe("Database metric chart modal: its own zoom over its own range", () => {
  const code: string = readCode(
    "Components/DatabaseServer/DatabaseMetricChartModal.tsx",
  );

  test("the modal's body is a zoom scope over the modal's range", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(scopeOpening(code, "timeRange", "setTimeRange")).toBeGreaterThan(-1);
    // Seeded from the list, then the modal's alone.
    expect(code).toContain(
      "const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>( props.initialTimeRange || DEFAULT_RANGE, );",
    );
  });

  test("the scope sits inside the modal and holds its picker and its chart", () => {
    const modal: number = indexOfOrFail(code, "<Modal");
    const open: number = scopeOpening(code, "timeRange", "setTimeRange");
    const close: number = indexOfOrFail(code, "</TimeRangeZoomScope>");
    const modalClose: number = indexOfOrFail(code, "</Modal>");

    expect(open).toBeGreaterThan(modal);
    expect(close).toBeLessThan(modalClose);
    for (const inside of [
      "<TelemetryTimeRangePicker value={timeRange}",
      "<ChartCard",
    ]) {
      const at: number = indexOfOrFail(code, inside);
      expect([inside, at > open && at < close]).toEqual([inside, true]);
    }
  });

  test("the modal never writes a zoom back to the list behind it", () => {
    expect(code).not.toContain("onTimeRangeChange={props.");
    expect(code).not.toContain("props.onTimeRangeChange");
  });

  test("Create monitor is built from the (possibly zoomed) window and range", () => {
    expect(code).toContain(
      "startAndEndDate: new InBetween<Date>( chartWindow.start, chartWindow.end, ), rangeToken: timeRange.range,",
    );
  });
});
