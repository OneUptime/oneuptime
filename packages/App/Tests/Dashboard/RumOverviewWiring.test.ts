import { beforeAll, describe, expect, test } from "@jest/globals";
import { RecordingHealthDiagnosis } from "Common/Types/Rum/SessionReplayHealth";
import fs from "fs";
import path from "path";

/*
 * The RUM application overview page (Pages/Rum/View/Overview.tsx). Three
 * audit findings are pinned here at the source level - the page composes
 * charts and the resource-overview chrome, which no unit harness renders:
 *
 *   correlation-11: the "Sessions recorded" tile counted one range and
 *   linked to a list that opened on another, unexplained;
 *   correlation-12: every auto/manual refresh keyed the data effect on a
 *   fresh RumApplication object, dropping all tiles to spinners;
 *   correlation-14: a failed client lookup rendered a confident "0".
 */

const SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Pages/Rum/View/Overview.tsx",
  ),
  "utf8",
);

/*
 * The page's pure decisions (the tile's range wording, the ranged list
 * route, the health row) live beside it in OverviewHelpers.ts, which has no
 * React import, so they can be run for real from here.
 */
const HELPERS_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers.ts",
  ),
  "utf8",
);

function blockIn(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = source.indexOf(startMarker);

  expect(start).toBeGreaterThan(-1);

  const end: number = source.indexOf(endMarker, start);

  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function block(startMarker: string, endMarker: string): string {
  return blockIn(SOURCE, startMarker, endMarker);
}

function helperBlock(startMarker: string, endMarker: string): string {
  return blockIn(HELPERS_SOURCE, startMarker, endMarker);
}

describe("correlation-11: the sessions tile names the range it counted and carries it to the list", () => {
  test("the sublabel is the counted range, never the words 'selected range'", () => {
    const tile: string = block('title: "Sessions recorded"', "];");

    expect(tile).toContain("describeTimeRangeForTile(timeRange)");
    expect(tile).not.toContain('"selected range"');
  });

  test("the tile links to the list with the range stamped on the route", () => {
    const tile: string = block('title: "Sessions recorded"', "];");

    expect(tile).toContain("to: buildRangedListRoute(");
    expect(tile).toContain("PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY");
  });

  test("the range helpers write the explorer grammar (range, start, end) and lower-case the preset", () => {
    const describe: string = helperBlock(
      "export function describeTimeRangeForTile",
      "\n}\n",
    );

    expect(describe).toContain('"custom range"');
    expect(describe).toContain(".toLowerCase()");

    const ranged: string = helperBlock(
      "export function buildRangedListRoute",
      "\n}\n",
    );

    expect(ranged).toContain("range: encodeURIComponent(");
    expect(ranged).toContain('params["start"]');
    expect(ranged).toContain('params["end"]');
    expect(ranged).toContain("TimeRange.CUSTOM");
  });
});

describe("correlation-12: a refresh keeps stale tiles on screen", () => {
  test("the data effect is keyed on the app identifier and the range VALUE, not the model object", () => {
    expect(SOURCE).toContain(
      "}, [appIdentifier, timeRangeKey, loadTelemetry]);",
    );
    expect(SOURCE).not.toContain("}, [rumApplication, timeRange]);");
  });

  test("loading flags are set only when the loader is asked to show loading", () => {
    const loader: string = block(
      "const loadTelemetry:",
      "[modelIdString, timeRangeKey],",
    );
    const guarded: string = loader.slice(
      loader.indexOf("if (showLoading) {"),
      loader.indexOf("const range: InBetween<Date>"),
    );

    expect(guarded).toContain("setMetricsLoading(true)");
    expect(guarded).toContain("setWebVitalsLoading(true)");
    expect(guarded).toContain("setSessionReplayCount(null)");

    /* And nowhere else in the loader flips a tile back to loading. */
    const unguarded: string = loader.replace(guarded, "");

    expect(unguarded).not.toContain("setMetricsLoading(true)");
    expect(unguarded).not.toContain("setWebVitalsLoading(true)");
    expect(unguarded).not.toContain("setSessionReplayCount(null)");
  });

  test("manual and auto refresh both reload the telemetry without loading flags", () => {
    const refresh: string = block(
      "const refresh: () => void",
      "[appIdentifier, loadTelemetry]",
    );

    expect(refresh).toContain("fetchModel(false)");
    expect(refresh).toContain("loadTelemetry(false)");

    expect(block("useAutoRefresh({", "});")).toContain("refresh();");
    expect(block("onManualRefresh={", "}}")).toContain("refresh();");
  });

  test("stale responses are discarded by a generation counter", () => {
    expect(SOURCE).toContain("telemetryGenerationRef.current += 1;");
    expect(SOURCE).toContain(
      "return generation === telemetryGenerationRef.current;",
    );
  });
});

describe("correlation-14: a failed client lookup is unknown, not zero", () => {
  test("the count promise records a failure flag instead of writing 0", () => {
    const count: string = block("ModelAPI.count({", "});");

    expect(count).toContain("setClientCountFailed(true)");
    expect(count).not.toContain("setClientCount(0)");
    expect(SOURCE).not.toContain("setClientCount(0)");
  });

  test("the Clients tile renders a dash with 'could not load' and stops spinning on failure", () => {
    const tile: string = block('title: "Clients"', "},");

    expect(tile).toContain("clientCountFailed");
    expect(tile).toContain('"could not load"');
    expect(tile).toContain(
      "loading: clientCount === null && !clientCountFailed",
    );
  });
});

/*
 * WP-X's own deferred cross-package request, now that WP-D2's
 * useSessionReplayHealth is committed: the overview is where someone lands
 * when "the replays look wrong", and it used to say nothing at all about
 * whether the recorder is reporting. One line in the details list now
 * carries the same diagnosis the list strip and the settings card show.
 *
 * The value function is pure, so it is exercised for real rather than read
 * off the source. It lives in OverviewHelpers.ts beside the page:
 * Overview.tsx is React, and App has no react installed, so the page module
 * itself is not importable from a node test by design.
 */
type OverviewHelpersModule =
  typeof import("../../FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers");

let overview: OverviewHelpersModule;

beforeAll(async () => {
  overview = await import(
    "../../FeatureSet/Dashboard/src/Pages/Rum/View/OverviewHelpers"
  );
});

describe("the overview carries one line of recording health", () => {
  const DIAGNOSIS: RecordingHealthDiagnosis = {
    state: "healthy",
    severity: "ok",
    title: "Recording healthy - last chunk 12s ago",
    detail: "143 sessions today; sampling 100%.",
  };

  test("a loaded diagnosis is rendered as its own title, verbatim", () => {
    expect(
      overview.describeRecordingHealthRow({
        isLoading: false,
        error: null,
        diagnosis: DIAGNOSIS,
      }),
    ).toBe("Recording healthy - last chunk 12s ago");
  });

  test("the first load says it is checking, never 'unknown' and never a healthy-looking blank", () => {
    expect(
      overview.describeRecordingHealthRow({
        isLoading: true,
        error: null,
        diagnosis: DIAGNOSIS,
      }),
    ).toBe("Checking…");
  });

  test("a failure that is not the viewer's fault is named, so silence is never read as healthy", () => {
    const value: string | undefined = overview.describeRecordingHealthRow({
      isLoading: false,
      error: { kind: "other", message: "Server is not available" },
      diagnosis: DIAGNOSIS,
    });

    expect(value).toBe("Recording health could not be loaded");
    /* The raw server string is never the headline. */
    expect(value).not.toContain("Server is not available");
  });

  test("a viewer who may not read health, or whose plan excludes it, gets no row at all", () => {
    expect(
      overview.describeRecordingHealthRow({
        isLoading: false,
        error: { kind: "permission", message: "Not authorized" },
        diagnosis: DIAGNOSIS,
      }),
    ).toBeUndefined();

    expect(
      overview.describeRecordingHealthRow({
        isLoading: false,
        error: { kind: "plan", message: "Please upgrade your plan" },
        diagnosis: DIAGNOSIS,
      }),
    ).toBeUndefined();
  });

  test("the row is omitted from detailRows rather than rendered empty", () => {
    const rows: string = block(
      "const detailRows: Array<ResourceOverviewDetailRow>",
      "];",
    );

    expect(rows).toContain("recordingHealthValue");
    expect(rows).toContain('label: "Recording health"');
    expect(SOURCE).toContain("useSessionReplayHealth(modelId)");
  });
});
