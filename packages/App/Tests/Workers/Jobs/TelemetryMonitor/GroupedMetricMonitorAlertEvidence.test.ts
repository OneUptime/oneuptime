import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";

// Nothing here runs a sandbox; the native isolated-vm addon need not load.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

// The worker's queue is never used here.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

import {
  GroupedMetricFleet,
  buildGroupedMetricFleet,
} from "./GroupedMetricMonitorFleet";
import {
  CreatedAlertRecord,
  EvaluationRun,
  runFleetEvaluation,
} from "./GroupedMetricMonitorHarness";
import { JSONObject } from "Common/Types/JSON";

/*
 * A FLEET-WIDE PROBLEM: WHAT EACH ALERT COSTS DOES NOT GROW WITH THE ALERTS
 * OPENED BEFORE IT (#10841).
 *
 * The #10108 fleet's monitor with ten series in a thousand breaching in each
 * of its profiles, evaluated on the real path (GroupedMetricMonitorHarness):
 * one check opens hundreds of alerts. Each alert keeps the check as it saw
 * it (MonitorStoredCheck.toStoredCheck), and each used to keep every event
 * the check had added before it: the k-th alert the "Alert created" events
 * of the k-1 before it. Redacting, measuring and storing them took most of
 * such a check's time - 6 of its 9.7 seconds at 513 alerts - and grew with
 * the square of its alerts.
 *
 * The work of an alert's stored check is the bytes it redacts, measures and
 * stores, so it is held here by them, which no busy runner changes: the
 * alerts opened last keep what those opened first keep, and none keeps an
 * event about another series.
 */

const WINDOW_END_MS: number = Date.UTC(2026, 10, 17, 10, 5, 0);

let fleet: GroupedMetricFleet;
let run: EvaluationRun;

beforeAll(async () => {
  fleet = buildGroupedMetricFleet({
    seriesCount: 6_000,
    windowEndMs: WINDOW_END_MS,
    specialPerThousand: 10,
    seed: 10841,
  });

  run = await runFleetEvaluation({ fleet: fleet });
}, 600_000);

afterAll(() => {
  jest.restoreAllMocks();
});

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function median(values: Array<number>): number {
  const sorted: Array<number> = [...values].sort((a: number, b: number) => {
    return a - b;
  });

  return sorted[Math.floor(sorted.length / 2)]!;
}

function eventsOf(log: JSONObject): Array<JSONObject> {
  const summary: JSONObject | undefined = log["evaluationSummary"] as
    | JSONObject
    | undefined;

  return (summary?.["events"] as Array<JSONObject> | undefined) || [];
}

describe("a fleet-wide problem on the #10108 monitor", () => {
  test("opens hundreds of alerts in one check", () => {
    expect(run.error).toBeNull();
    expect(run.outcome.createdAlerts.length).toBeGreaterThan(100);
    expect(run.written.createdAlertStateLogs).toHaveLength(
      run.outcome.createdAlerts.length,
    );
  });

  test("each alert keeps no event about another series, and none of the alerts opened before it", () => {
    run.outcome.createdAlerts.forEach(
      (alert: CreatedAlertRecord, index: number) => {
        const events: Array<JSONObject> = eventsOf(
          run.written.createdAlertStateLogs[index]!,
        );

        for (const event of events) {
          if (event["seriesFingerprint"]) {
            expect(event["seriesFingerprint"]).toBe(alert.seriesFingerprint);
          }

          expect(event["type"]).not.toBe("alert-created");
        }
      },
    );
  });

  test("the alerts opened last keep what those opened first keep: no alert's work grows with the alerts before it", () => {
    const sizes: Array<number> = run.written.createdAlertStateLogs.map(bytes);
    const tenth: number = Math.floor(sizes.length / 10);
    const first: number = median(sizes.slice(0, tenth));
    const last: number = median(sizes.slice(sizes.length - tenth));

    /*
     * One series' points and labels, and the monitor's events: about 10 KB.
     * Kept with every event before it, the last tenth kept 182 KB each
     * (their median), the first tenth 25 KB.
     */
    expect(first).toBeLessThan(32 * 1024);
    expect(last).toBeLessThan(1.5 * first);
  });
});
