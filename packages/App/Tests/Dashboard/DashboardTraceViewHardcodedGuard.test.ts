import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import {
  HardcodedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * The trace view - a trace's header, waterfall, minimap, flame graph,
 * operations and service map, an open span's panel and its related signals -
 * reads in the Dashboard's language (src/Locales/README.md). `npm run
 * i18n:hardcoded -- --dir Components/Traces` lists the strings that skip
 * translation; none of them may be in these files. What a person's own
 * telemetry says (span and service names, attribute keys and values) is data,
 * not a string in the source, so it never shows up in that list.
 *
 * The traces list, its dashboard and the older span details panel
 * (TracesViewer, TracesDashboard, SpanDetailsPanel, TraceTable, TraceRow)
 * are not the trace view and still have English of their own; they are out
 * of this guard's scope.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

const DASHBOARD_SOURCE_DIRECTORY: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// The trace view's files outside Components/Traces/TraceDetail.
const TRACE_VIEW_FILES: ReadonlyArray<string> = [
  "Components/Traces/FlameGraph.tsx",
  "Components/Traces/LlmSpanPanel.tsx",
  "Components/Traces/TraceExplorer.tsx",
  "Components/Traces/TraceScopedFlamegraph.tsx",
  "Components/Traces/TraceServiceMap.tsx",
];

const TRACE_DETAIL_FOLDER: string = "Components/Traces/TraceDetail/";

// The parts of the trace view that live in TraceDetail.
const TRACE_DETAIL_FILES: ReadonlyArray<string> = [
  "TraceHeader.tsx",
  "TraceOperations.tsx",
  "TraceSignals.tsx",
  "TraceSpanPanel.tsx",
  "TraceTimelineMinimap.tsx",
  "TraceWaterfall.tsx",
];

type IsInScopeFunction = (file: string) => boolean;

const isInScope: IsInScopeFunction = (file: string): boolean => {
  return (
    TRACE_VIEW_FILES.includes(file) || file.startsWith(TRACE_DETAIL_FOLDER)
  );
};

type ToDashboardPathFunction = (file: string) => string;

const toDashboardPath: ToDashboardPathFunction = (file: string): string => {
  return file.startsWith(DASHBOARD_SOURCE)
    ? file.slice(DASHBOARD_SOURCE.length)
    : file;
};

type DescribeFunction = (entry: HardcodedString) => string;

const describeEntry: DescribeFunction = (entry: HardcodedString): string => {
  return `${toDashboardPath(entry.file)}:${entry.line} (${entry.reason}) ${entry.text}`;
};

/*
 * The three sentences the trace view still drew in English, written the way
 * they were: the minimap's tooltip and its screen-reader label, which change
 * while the waterfall is zoomed, and the line over the flame graph.
 */
const MINIMAP_AS_IT_WAS: string = `
const TraceTimelineMinimap = (props) => {
  return (
    <div
      title={
        isZoomed
          ? "Drag across the trace to zoom into that time range. Double-click to see the whole trace."
          : "Drag across the trace to zoom into that time range"
      }
      aria-label={
        isZoomed
          ? "Trace overview. Drag to zoom into a time range, double-click to see the whole trace."
          : "Trace overview. Drag to zoom into a time range."
      }
      role="img"
    />
  );
};
`;

const FLAME_GRAPH_AS_IT_WAS: string = `
const FlameGraph = (props) => {
  return (
    <div className="flame-graph">
      <div className="text-[11px] text-gray-500">
        Click a span to view details. Double-click to zoom into a subtree.
      </div>
    </div>
  );
};
`;

describe("the trace view routes its strings through translation", () => {
  test("no string in the trace view's files skips translation", () => {
    const inScope: Array<string> = getHardcodedStrings(getDefaultContext(), {
      directory: "Components/Traces",
    })
      .filter((entry: HardcodedString): boolean => {
        return isInScope(toDashboardPath(entry.file));
      })
      .map(describeEntry);

    expect(inScope).toEqual([]);
  }, 180000);

  test("the guard would catch the minimap's and the flame graph's sentences written as they were", () => {
    const minimap: Array<string> = scanSourceText(
      `${DASHBOARD_SOURCE}${TRACE_DETAIL_FOLDER}TraceTimelineMinimap.tsx`,
      MINIMAP_AS_IT_WAS,
      { kind: "ui" },
    ).hardcoded.map((entry: HardcodedString): string => {
      return entry.text;
    });

    expect(minimap).toEqual(
      expect.arrayContaining([
        "Drag across the trace to zoom into that time range. Double-click to see the whole trace.",
        "Drag across the trace to zoom into that time range",
        "Trace overview. Drag to zoom into a time range, double-click to see the whole trace.",
        "Trace overview. Drag to zoom into a time range.",
      ]),
    );

    const flameGraph: Array<HardcodedString> = scanSourceText(
      `${DASHBOARD_SOURCE}Components/Traces/FlameGraph.tsx`,
      FLAME_GRAPH_AS_IT_WAS,
      { kind: "ui" },
    ).hardcoded;

    expect(
      flameGraph.map((entry: HardcodedString): string => {
        return entry.text;
      }),
    ).toEqual([
      "Click a span to view details. Double-click to zoom into a subtree.",
    ]);
    expect(isInScope(toDashboardPath(flameGraph[0]!.file))).toBe(true);
  });

  test("the scope is every part of the trace view, and each of its files is there", () => {
    for (const file of TRACE_VIEW_FILES) {
      expect(isInScope(file)).toBe(true);
      expect(fs.existsSync(path.join(DASHBOARD_SOURCE_DIRECTORY, file))).toBe(
        true,
      );
    }

    for (const file of TRACE_DETAIL_FILES) {
      expect(isInScope(`${TRACE_DETAIL_FOLDER}${file}`)).toBe(true);
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SOURCE_DIRECTORY, TRACE_DETAIL_FOLDER, file),
        ),
      ).toBe(true);
    }
  });

  test("the traces list, its dashboard and the older span panel are outside the scope", () => {
    expect(isInScope("Components/Traces/TracesViewer.tsx")).toBe(false);
    expect(isInScope("Components/Traces/TracesDashboard.tsx")).toBe(false);
    expect(isInScope("Components/Traces/SpanDetailsPanel.tsx")).toBe(false);
    expect(isInScope("Components/Traces/TraceTable.tsx")).toBe(false);
    expect(isInScope("Components/Traces/TraceRow.tsx")).toBe(false);
  });
});
