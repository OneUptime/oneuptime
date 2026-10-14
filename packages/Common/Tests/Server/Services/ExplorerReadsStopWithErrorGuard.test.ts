import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY READ A TELEMETRY EXPLORER MAKES STOPS WITH AN ERROR AT ITS TIME
 * LIMIT, AND NONE SWALLOWS THE STOP (issue #4707).
 *
 * A log search that ran into the 45 s query limit failed with a bare
 * "Server Error". The reads ran with timeout_overflow_mode 'break', meant to
 * return what was found so far — but ClickHouse answers a read it breaks off
 * with an empty or cut-off body (measured on 24.8 and 26.7), and the trace
 * reads caught the resulting parse error and drew an empty chart or zero
 * counts instead. The reads now stop with 'throw' (INTERACTIVE_READ_TIME_LIMIT)
 * and the stop reaches the explorer as a QueryTimeoutException.
 *
 * This guard reads the services behind the explorers' lists, charts,
 * facets, totals, analytics, error patterns, exports and profiles, and fails
 * on a new 'break', or on a catch that turns a stopped read back into "no
 * results". The few reads that keep 'break' are listed with the reason; a
 * new one has to argue its case here.
 */

const SERVICES_DIR: string = path.join(__dirname, "../../../Server/Services");

const EXPLORER_READ_SERVICES: Array<string> = [
  "AnalyticsDatabaseService.ts",
  "LogAggregationService.ts",
  "LogService.ts",
  "TraceAggregationService.ts",
  "SpanService.ts",
  "ExceptionAggregationService.ts",
  "MetricAggregationService.ts",
  "MetricService.ts",
  "ProfileAggregationService.ts",
  "SecurityEventService.ts",
];

/*
 * The reads allowed to keep 'break', and why. Each is matched by a line of
 * its source, so the exemption cannot quietly spread to a neighbour.
 */
const KEEPS_BREAK: Array<{ file: string; line: string; reason: string }> = [
  {
    file: "AnalyticsDatabaseService.ts",
    line: 'timeoutOverflowMode: countBy.exact ? "throw" : "break",',
    reason:
      "The default (non-exact) count: telemetry monitors' thresholds and the AI spike detector read a count that was broken off as 0, as they always have. A total a person reads is an exact count, which throws.",
  },
  {
    file: "SpanService.ts",
    line: 'timeoutOverflowMode: "break",',
    reason:
      "The projection-served default (non-exact) span count, for the same callers as the default count above.",
  },
  {
    file: "TraceAggregationService.ts",
    line: 'timeoutOverflowMode: "break",',
    reason:
      "The service latency profile, read by an unattended 15-minute scanner that discards any answer that may be partial (isPartial) — never by an explorer.",
  },
];

// Code lines only: block and line comments say 'break' while explaining why not.
function codeLines(source: string): Array<string> {
  const lines: Array<string> = [];
  let inBlockComment: boolean = false;

  for (const rawLine of source.split("\n")) {
    const line: string = rawLine.trim();

    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (line.startsWith("/*")) {
      inBlockComment = !line.includes("*/");
      continue;
    }

    if (line.startsWith("//") || line.startsWith("*")) {
      continue;
    }

    lines.push(line);
  }

  return lines;
}

function breakLines(file: string): Array<string> {
  const source: string = fs.readFileSync(path.join(SERVICES_DIR, file), "utf8");

  return codeLines(source).filter((line: string): boolean => {
    return (
      line.includes("timeout_overflow_mode = 'break'") ||
      line.includes('"break"') ||
      line.includes("'break'")
    );
  });
}

describe("explorer reads stop with an error at their time limit", () => {
  test.each(EXPLORER_READ_SERVICES)(
    "%s keeps 'break' only where it is allowed to",
    (file: string) => {
      const allowed: Array<string> = KEEPS_BREAK.filter(
        (exemption: { file: string }): boolean => {
          return exemption.file === file;
        },
      ).map((exemption: { line: string }): string => {
        return exemption.line;
      });

      expect(breakLines(file)).toEqual(allowed);
    },
  );

  test("every exemption names a line that is still there", () => {
    for (const exemption of KEEPS_BREAK) {
      expect(breakLines(exemption.file)).toContain(exemption.line);
      expect(exemption.reason.length).toBeGreaterThan(40);
    }
  });

  /*
   * The trace reads used to catch the parse error of a broken-off answer and
   * hand back an empty histogram, empty analytics or zero facet counts — a
   * stopped search drawn as "no spans". A stop now reaches the explorer.
   */
  test.each([
    "TraceAggregationService.ts",
    "LogAggregationService.ts",
    "ExceptionAggregationService.ts",
    "MetricAggregationService.ts",
  ])("%s does not turn a stopped read into an empty answer", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(SERVICES_DIR, file),
      "utf8",
    );

    expect(source).not.toContain("returned unparseable response, returning");
  });

  test("the shared limit is 45 seconds and stops with 'throw'", () => {
    const helper: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../Server/Utils/AnalyticsDatabase/QuerySettingsHelper.ts",
      ),
      "utf8",
    );

    expect(helper).toContain(
      'export const INTERACTIVE_READ_TIME_LIMIT: Readonly<{\n  maxExecutionTimeInSeconds: number;\n  timeoutOverflowMode: TimeoutOverflowMode;\n}> = {\n  maxExecutionTimeInSeconds: 45,\n  timeoutOverflowMode: "throw",\n};',
    );
  });
});
