import {
  TRACE_HEALTH_ROUTE,
  TraceHealthHint,
  TraceHealthReport,
  parseTraceHealthReport,
} from "../../../Types/Telemetry/TraceHealth";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The contract of POST /telemetry/traces/health, read on the Dashboard's
 * side. The card is a hint above the Traces list, so a body it cannot read
 * must draw nothing, never a card of zeros or a crash.
 */

const REPORT: TraceHealthReport = {
  startTime: "2026-10-27T10:00:00.000Z",
  endTime: "2026-10-27T11:00:00.000Z",
  samplePercent: 25,
  spanCount: 5000,
  traceCount: 1200,
  orphanSpanShare: 0.12,
  singleSpanTraceShare: 0.4,
  logCount: 800,
  logsLinkedShare: 0,
  hints: [
    TraceHealthHint.MissingParentSpans,
    TraceHealthHint.OneSpanTraces,
    TraceHealthHint.UnlinkedLogs,
  ],
};

function body(overrides: JSONObject = {}): JSONObject {
  return {
    ...(JSON.parse(JSON.stringify(REPORT)) as JSONObject),
    ...overrides,
  };
}

describe("parseTraceHealthReport", () => {
  test("reads the report as the route sends it", () => {
    expect(parseTraceHealthReport(body())).toEqual(REPORT);
  });

  test("reads nothing from a body that is not a report", () => {
    for (const value of [
      null,
      undefined,
      "report",
      42,
      [],
      {},
      body({ startTime: undefined }),
      body({ endTime: "not a date" }),
      body({ samplePercent: 0 }),
      body({ samplePercent: "25" }),
    ]) {
      expect(parseTraceHealthReport(value)).toBeNull();
    }
  });

  test("keeps only the hints it knows, once each, in the card's order", () => {
    expect(
      parseTraceHealthReport(
        body({
          hints: [
            TraceHealthHint.UnlinkedLogs,
            "SomethingNew",
            TraceHealthHint.MissingParentSpans,
            TraceHealthHint.UnlinkedLogs,
            7,
          ],
        }),
      )?.hints,
    ).toEqual([
      TraceHealthHint.MissingParentSpans,
      TraceHealthHint.UnlinkedLogs,
    ]);
    expect(parseTraceHealthReport(body({ hints: "all" }))?.hints).toEqual([]);
  });

  test("reads a share that is missing or broken as not measured, and keeps the rest within 0 to 1", () => {
    const parsed: TraceHealthReport | null = parseTraceHealthReport(
      body({
        orphanSpanShare: null,
        singleSpanTraceShare: "0.4",
        logsLinkedShare: 1.7,
      }),
    );

    expect(parsed?.orphanSpanShare).toBeNull();
    expect(parsed?.singleSpanTraceShare).toBeNull();
    expect(parsed?.logsLinkedShare).toBe(1);
    expect(
      parseTraceHealthReport(body({ orphanSpanShare: -0.2 }))?.orphanSpanShare,
    ).toBe(0);
  });

  test("reads counts as whole numbers, a broken one as none", () => {
    const parsed: TraceHealthReport | null = parseTraceHealthReport(
      body({ spanCount: 12.9, traceCount: -4, logCount: "800" }),
    );

    expect(parsed?.spanCount).toBe(12);
    expect(parsed?.traceCount).toBe(0);
    expect(parsed?.logCount).toBe(0);
    expect(
      parseTraceHealthReport(body({ samplePercent: 250 }))?.samplePercent,
    ).toBe(100);
  });

  test("is the contract of the route the server registers", () => {
    expect(TRACE_HEALTH_ROUTE).toBe("/telemetry/traces/health");

    const telemetryApi: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/API/TelemetryAPI.ts"),
      "utf8",
    );

    expect(telemetryApi).toContain(`router.post(\n  "${TRACE_HEALTH_ROUTE}",`);
  });

  test("imports nothing the Dashboard does not already load", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Telemetry/TraceHealth.ts"),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/^import [^;]+ from "([^"]+)";$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports).toEqual(["../JSON"]);
  });
});
