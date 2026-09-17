import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3530 wiring pins. The two dashboard SHELLS are the half of this
 * feature no unit test can reach: DashboardView and the public
 * DashboardViewPage each pull in ~60 widget modules, an API client and a
 * router, and App's node test env cannot render React at all. So the
 * load-bearing wiring is pinned as whitespace-squashed source strings (the
 * MetricsCrossSignalPivot.test pattern), and the behaviour behind it is
 * covered by the RTL suites in Common/Tests:
 *
 *   Common/Tests/Utils/Dashboard/DashboardTimeRangeZoom.test.ts   (state machine)
 *   Common/Tests/UI/Utils/UseDashboardTimeRangeZoom.test.tsx      (hook)
 *   Common/Tests/UI/Components/Charts/ChartDoubleClickReset.test.tsx
 *   Common/Tests/UI/Components/Charts/ChartClickDoubleClickDisambiguation.test.tsx
 *   Common/Tests/App/Dashboard/DashboardWideChartZoom.test.tsx    (widget)
 *
 * The public dashboard is the reason these pins exist at all: before
 * #3530 nothing anywhere exercised its time range, so its half of the
 * feature could regress in silence.
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, "../../..", relative), "utf8")
    .replace(/\s+/g, " ");
}

const AUTHENTICATED_SHELL: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx";
const PUBLIC_SHELL: string =
  "App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx";
const CANVAS: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx";
const TOOLBAR: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx";
const METRIC_CHARTS: string =
  "App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts.tsx";

describe("dashboard-wide time range zoom wiring", () => {
  test.each([
    ["the authenticated dashboard", AUTHENTICATED_SHELL],
    ["the public dashboard", PUBLIC_SHELL],
  ])(
    "%s owns its range through the shared zoom hook and hands the gesture to the canvas",
    (_name: string, shellPath: string) => {
      const shell: string = readSquashed(shellPath);

      /*
       * Both shells MUST go through the same hook. Re-deriving the
       * push/restore semantics per shell is exactly how the public
       * dashboard ended up with a "Reset Zoom" button that appeared after
       * an ordinary picker change.
       */
      expect(shell).toContain(
        "useDashboardTimeRangeZoom({ range: TimeRange.PAST_ONE_HOUR, })",
      );
      expect(shell).toContain(
        "onDashboardTimeRangeSelect={timeRangeZoom.zoomToTimeRange}",
      );
      expect(shell).toContain(
        "onDashboardTimeRangeReset={timeRangeZoom.resetZoom}",
      );
      expect(shell).toContain(
        "isDashboardTimeRangeZoomed={timeRangeZoom.isZoomed}",
      );
    },
  );

  test("the picker goes through selectRange, not the zoom path", () => {
    /*
     * An explicit pick is a new baseline. Routing it through
     * zoomToTimeRange instead would make "Reset zoom" offer to jump back
     * to a range the user just deliberately left.
     */
    expect(readSquashed(AUTHENTICATED_SHELL)).toContain(
      "timeRangeZoom.setStartAndEndDate(newStartAndEndDate);",
    );
    expect(readSquashed(PUBLIC_SHELL)).toContain(
      "timeRangeZoom.setStartAndEndDate(newRange);",
    );
  });

  test("the public dashboard's hand-rolled range stack is gone", () => {
    const shell: string = readSquashed(PUBLIC_SHELL);

    // Two sources of truth for "the range before the zoom" is one too many.
    expect(shell).not.toContain("timeRangeStack");
    expect(shell).toContain("{timeRangeZoom.isZoomed && (");
  });

  test("the authenticated toolbar carries a visible way out of the zoom", () => {
    const shell: string = readSquashed(AUTHENTICATED_SHELL);
    const toolbar: string = readSquashed(TOOLBAR);

    expect(shell).toContain("isTimeRangeZoomed={timeRangeZoom.isZoomed}");
    expect(shell).toContain("onResetTimeRangeZoom={timeRangeZoom.resetZoom}");

    /*
     * Double-click alone is undiscoverable, and once zoomed the picker
     * just reads "Custom" — which says nothing about there being a way
     * back.
     */
    expect(toolbar).toContain(
      "props.isTimeRangeZoomed && props.onResetTimeRangeZoom &&",
    );
    expect(toolbar).toContain('aria-label="Reset zoom"');
  });

  test("entering edit mode drops the zoom rather than stranding the board", () => {
    /*
     * Edit mode hides both the picker and the reset button, so a board
     * left zoomed would have no way out until the user leaves edit mode.
     */
    const shell: string = readSquashed(AUTHENTICATED_SHELL);
    const editHandlerIndex: number = shell.indexOf("onEditClick={() => {");
    expect(editHandlerIndex).toBeGreaterThan(-1);
    expect(shell.slice(editHandlerIndex, editHandlerIndex + 400)).toContain(
      "timeRangeZoom.resetZoom();",
    );
  });

  test("the canvas threads the gesture down to every widget", () => {
    const canvas: string = readSquashed(CANVAS);

    expect(canvas).toContain(
      "onDashboardTimeRangeSelect={props.onDashboardTimeRangeSelect}",
    );
    expect(canvas).toContain(
      "onDashboardTimeRangeReset={props.onDashboardTimeRangeReset}",
    );
    expect(canvas).toContain(
      "isDashboardTimeRangeZoomed={props.isDashboardTimeRangeZoomed}",
    );
  });

  test("MetricCharts forwards the reset to both the query and formula panels", () => {
    const source: string = readSquashed(METRIC_CHARTS);

    /*
     * Two chart bags are built — one per query chart, one per formula
     * chart. A reset wired to only one of them leaves half a dashboard
     * unable to undo the zoom.
     */
    const matches: RegExpMatchArray | null = source.match(
      /onTimeRangeReset: props\.onTimeRangeReset,/g,
    );
    expect(matches?.length).toBe(2);
  });
});
