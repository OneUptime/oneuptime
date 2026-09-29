import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for what the Log Chart and Trace Chart widgets
 * tell a reader about their drag-to-zoom: the crosshair over the plot and
 * the hint that names the gestures.
 *
 * The behaviour is exercised against rendered components in Common's RTL
 * suites:
 *
 *   Common/Tests/App/Dashboard/DashboardHistogramWidgetDragCursor.test.tsx  (real recharts, every chart type)
 *   Common/Tests/App/Dashboard/DashboardHistogramWidgetZoomHint.test.tsx
 *
 * What is pinned here is what those suites cannot see from where they
 * stand: that a chart type added later gets the same treatment as the three
 * there are today. Sources are whitespace-squashed so prettier's wrapping
 * does not matter.
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, "../..", relative), "utf8")
    .replace(/\s+/g, " ");
}

function countOf(source: string, snippet: string): number {
  return source.split(snippet).length - 1;
}

const WIDGETS: string =
  "FeatureSet/Dashboard/src/Components/Dashboard/Components";

describe.each([
  ["Log Chart", `${WIDGETS}/DashboardLogChartComponent.tsx`],
  ["Trace Chart", `${WIDGETS}/DashboardTraceChartComponent.tsx`],
])("the %s widget", (_name: string, widgetPath: string) => {
  const widget: string = readSquashed(widgetPath);

  test("every chart root that takes the drag shows the crosshair, set where recharts' own cursor cannot beat it", () => {
    const dragRoots: number = countOf(
      widget,
      "onMouseDown={selection.onMouseDown}",
    );

    expect(dragRoots).toBeGreaterThan(0);
    /*
     * recharts sets cursor: default inline on its wrapper, over any class
     * on the box around it, so the crosshair travels in the chart root's
     * own style prop - on every chart type the drag is wired into.
     */
    expect(countOf(widget, "{...chartCursor}")).toBe(dragRoots);
    // Only while a drag can zoom: otherwise recharts keeps its arrow.
    expect(widget).toContain(
      'const chartCursor: { style?: React.CSSProperties } = timeRangeZoom.onTimeRangeSelect ? { style: { cursor: "crosshair" } } : {};',
    );
  });

  test("the hint is told whether the plot is drawn, by the very condition that draws it", () => {
    expect(widget).toContain(
      "const isChartShown: boolean = !error && pivotedData.length > 0;",
    );
    expect(widget).toContain("{isChartShown && (");

    // Titled and untitled: wherever the hint sits, it is told.
    const hints: number = countOf(widget, "<DashboardWidgetZoomHint");
    expect(hints).toBe(2);
    expect(countOf(widget, "isChartShown={isChartShown}")).toBe(hints);
    expect(widget).toContain(
      "{!props.component.arguments.title && ( <DashboardWidgetZoomHint",
    );
  });

  test("the states that take the reset double-click are not selectable while it is armed", () => {
    expect(widget).toContain(
      '<div className={`min-h-0 flex-1 ${ timeRangeZoom.onTimeRangeReset ? "select-none" : "" }`} onDoubleClick={selection.onDoubleClick} >',
    );
  });
});
