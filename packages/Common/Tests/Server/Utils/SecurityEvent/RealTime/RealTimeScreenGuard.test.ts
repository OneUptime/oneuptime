import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY WRITE OF SECURITY EVENTS FROM A SOURCE IS SCREENED FOR REAL-TIME
 * DETECTION RULES.
 *
 * A real-time rule (Types/SecurityEvent/RealTimeDetection) runs on no
 * interval: the schedule skips it, and only the screen every write runs
 * (RealTimeDetections.screen) ever hands it an event. A new path that
 * writes security events and forgets the screen would leave every
 * real-time rule blind to what it writes, with nothing on screen to say
 * so. So every file that writes rows to the SecurityEvent table - straight
 * (SecurityEventService.insertJsonRows) or through the fan-in writer
 * (TelemetryFanInWriter.submit(SecurityEventService, ...)) - screens them,
 * unless it is listed below with why: the engine's own findings, which are
 * no event a source sent, and the setup test's attack, which runs every
 * rule over its own events.
 *
 * The list only shrinks: an entry that no longer writes events fails.
 */

// packages/Common/Tests/Server/Utils/SecurityEvent/RealTime -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet",
];

const WRITES_EVENTS: Array<RegExp> = [
  /SecurityEventService\.insertJsonRows\(/,
  /TelemetryFanInWriter\.submit\(\s*SecurityEventService\b/,
];

const SCREENS: RegExp = /RealTimeDetections\.screen\(/;

const NOT_SCREENED: Record<string, string> = {
  "packages/Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator.ts":
    "writes the Detection Findings a rule's matches make: the engine's output, no event a source sent",
  "packages/Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher.ts":
    "writes the findings threat intel matches make: the engine's output, no event a source sent",
  "packages/Common/Server/Utils/SecurityEvent/SecuritySetup.ts":
    "writes the setup test's attack, then runs every enabled rule over just those events itself (SecuritySetup.runTest)",
};

function codeFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  const absolute: string = path.join(REPOSITORY_ROOT, directory);

  if (!fs.existsSync(absolute)) {
    return files;
  }

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      const full: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts")
      ) {
        files.push(full);
      }
    }
  };

  walk(absolute);

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function eventWriters(): Array<{ file: string; code: string }> {
  const writers: Array<{ file: string; code: string }> = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of codeFiles(directory)) {
      const code: string = fs.readFileSync(file, "utf-8");

      if (
        WRITES_EVENTS.some((pattern: RegExp): boolean => {
          return pattern.test(code);
        })
      ) {
        writers.push({ file: relative(file), code });
      }
    }
  }

  return writers;
}

describe("RealTimeScreenGuard", () => {
  test("finds the writers it is meant to hold: the ingest API, connections, Your logs, Your OneUptime data, Data Security", () => {
    const files: Array<string> = eventWriters().map(
      (writer: { file: string }): string => {
        return writer.file;
      },
    );

    for (const expected of [
      "packages/App/FeatureSet/Telemetry/Services/SecurityEventsIngestService.ts",
      "packages/Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller.ts",
      "packages/Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner.ts",
      "packages/Common/Server/Utils/SecurityEvent/TelemetryScan/SecurityTelemetryScanner.ts",
      "packages/Common/Server/Utils/DataSecurity/DataSecurityChangeSignals.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("every write of security events from a source screens them for real-time rules", () => {
    const unscreened: Array<string> = eventWriters()
      .filter((writer: { file: string; code: string }): boolean => {
        return !SCREENS.test(writer.code) && !NOT_SCREENED[writer.file];
      })
      .map((writer: { file: string }): string => {
        return writer.file;
      });

    expect(unscreened).toEqual([]);
  });

  test("every file left out still writes events, and none of them screens", () => {
    const writers: Map<string, string> = new Map(
      eventWriters().map((writer: { file: string; code: string }) => {
        return [writer.file, writer.code];
      }),
    );

    for (const [file, reason] of Object.entries(NOT_SCREENED)) {
      expect([file, writers.has(file)]).toEqual([file, true]);
      expect([file, SCREENS.test(writers.get(file) || "")]).toEqual([
        file,
        false,
      ]);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
