import { describe, expect, test } from "@jest/globals";
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

function block(startMarker: string, endMarker: string): string {
  const start: number = SOURCE.indexOf(startMarker);

  expect(start).toBeGreaterThan(-1);

  const end: number = SOURCE.indexOf(endMarker, start);

  expect(end).toBeGreaterThan(start);

  return SOURCE.slice(start, end);
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
    const describe: string = block(
      "export function describeTimeRangeForTile",
      "\n}\n",
    );

    expect(describe).toContain('"custom range"');
    expect(describe).toContain(".toLowerCase()");

    const ranged: string = block(
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
