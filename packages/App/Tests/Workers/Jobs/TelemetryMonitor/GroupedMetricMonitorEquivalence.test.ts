// Root causes and stored checks name times: the same in every zone.
process.env["TZ"] = "UTC";

import fs from "fs";
import path from "path";
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
  EvaluationOutcome,
  EvaluationRun,
  MatchedCriteriaRecord,
  runFleetEvaluation,
} from "./GroupedMetricMonitorHarness";
import { JSONObject } from "Common/Types/JSON";
import {
  EVIDENCE_TRUNCATED_FIELD,
  LOGGED_SERIES_FIELD,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "Common/Utils/Monitor/StoredCheckEvidence";

/*
 * THE SAME ALERTS AS BEFORE #10108.
 *
 * A grouped Metrics monitor over 2,000 host x container series used to hold
 * the event loop for most of its evaluation, and over 16,000 for 20 to 30
 * seconds. The work was made cheaper and split into slices that hand the
 * loop back; what the evaluation decides must not change. So a fixed fleet
 * (GroupedMetricMonitorFleet: the issue's four queries, formula and three
 * criteria, every case a criteria tells apart, alerts already open that
 * stay, recover or are gone) is evaluated on the real path
 * (GroupedMetricMonitorHarness), and everything the evaluation decided is
 * held to what the code before the change decided for the same fleet:
 *
 *   - the verdict: which criteria matched which series, with what root cause;
 *   - every alert created: its title, description, root cause, severity,
 *     state, and its stored check, summary, evaluation details and query;
 *   - every alert resolved: which, into which state, why, and the check its
 *     state timeline keeps;
 *   - every change of the monitor's status, with the check it keeps;
 *   - the evaluation summary: each criteria's result and every event.
 *
 * GroupedMetricMonitorEquivalence.golden.json was written by this test from
 * the code before #10108 (UPDATE_GROUPED_METRIC_GOLDEN=1), and is only ever
 * compared with since. A change that means to alter what an evaluation
 * decides rewrites it on purpose, and says why in its pull request.
 */

const GOLDEN_PATH: string = path.join(
  __dirname,
  "GroupedMetricMonitorEquivalence.golden.json",
);

const WINDOW_END_MS: number = Date.UTC(2026, 10, 17, 10, 5, 0);

interface GoldenFile {
  note: string;
  // What #10108 changed on purpose, and what it was before.
  changedOnPurpose?: Array<string> | undefined;
  cases: Record<string, EvaluationOutcome>;
}

interface EquivalenceCase {
  name: string;
  fleet: () => GroupedMetricFleet;
}

const CASES: Array<EquivalenceCase> = [
  {
    name: "a fleet where series breach every criteria, with alerts open",
    fleet: (): GroupedMetricFleet => {
      return buildGroupedMetricFleet({
        seriesCount: 2_000,
        windowEndMs: WINDOW_END_MS,
        specialPerThousand: 3,
        seed: 10108,
      });
    },
  },
  {
    name: "a quiet fleet: nothing breaches, the open alerts resolve, the status goes back",
    fleet: (): GroupedMetricFleet => {
      return buildGroupedMetricFleet({
        seriesCount: 1_500,
        windowEndMs: WINDOW_END_MS,
        allSteady: true,
        startsDegraded: true,
        seed: 20216,
      });
    },
  },
];

const outcomes: Map<string, EvaluationOutcome> = new Map();
const errors: Map<string, string | null> = new Map();
const runs: Map<string, EvaluationRun> = new Map();

beforeAll(async () => {
  // A frozen clock, so every time the evaluation writes down is the same.
  jest.useFakeTimers({
    now: WINDOW_END_MS + 1_000,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
      "hrtime",
      "performance",
    ],
  });

  for (const testCase of CASES) {
    const run: EvaluationRun = await runFleetEvaluation({
      fleet: testCase.fleet(),
    });
    outcomes.set(testCase.name, run.outcome);
    errors.set(testCase.name, run.error);
    runs.set(testCase.name, run);
  }

  if (process.env["UPDATE_GROUPED_METRIC_GOLDEN"] === "1") {
    const golden: GoldenFile = {
      note: "Written by GroupedMetricMonitorEquivalence.test.ts from the code before #10108. Compared with, never rewritten, unless an evaluation is meant to decide differently.",
      changedOnPurpose: fs.existsSync(GOLDEN_PATH)
        ? readGolden().changedOnPurpose
        : undefined,
      cases: Object.fromEntries(outcomes),
    };
    fs.writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 2)}\n`);
  }
}, 600_000);

afterAll(() => {
  jest.useRealTimers();
});

function readGolden(): GoldenFile {
  return JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as GoldenFile;
}

describe("a grouped metric monitor decides what it decided before #10108", () => {
  test.each(
    CASES.map((testCase: EquivalenceCase): [string] => {
      return [testCase.name];
    }),
  )("%s", (name: string) => {
    expect(errors.get(name)).toBeNull();

    const outcome: EvaluationOutcome = outcomes.get(name)!;
    const expected: EvaluationOutcome = readGolden().cases[name]!;

    expect(expected).toBeDefined();

    // The parts first, so a difference says where it is.
    expect(outcome.criteriaMetId).toEqual(expected.criteriaMetId);
    expect(outcome.evaluatedCriteriaIds).toEqual(expected.evaluatedCriteriaIds);
    expect(outcome.matchedCriteria).toEqual(expected.matchedCriteria);
    expect(outcome.createdAlerts).toEqual(expected.createdAlerts);
    expect(outcome.resolvedAlerts).toEqual(expected.resolvedAlerts);
    expect(outcome.statusChanges).toEqual(expected.statusChanges);
    expect(outcome.criteriaResults).toEqual(expected.criteriaResults);
    expect(outcome.events).toEqual(expected.events);
    expect(outcome).toEqual(expected);
  });

  /*
   * What #10108 changed on purpose: the log of a change of a grouped
   * monitor's status, and the monitor's log of the check, keep the series
   * the evaluation acted on first, a bounded share of them, and how many
   * there were - not the first megabyte of whatever the check held.
   */
  test("a change of the fleet's status and its monitor log keep the series that breached first, bounded", () => {
    const run: EvaluationRun = runs.get(CASES[0]!.name)!;
    const breaching: Set<string> = new Set<string>(
      run.outcome.matchedCriteria.flatMap(
        (matched: MatchedCriteriaRecord): Array<string> => {
          return matched.series.map(
            (series: MatchedCriteriaRecord["series"][number]): string => {
              return series.fingerprint;
            },
          );
        },
      ),
    );

    expect(breaching.size).toBeGreaterThan(10);

    for (const log of [
      run.written.statusChangeLogs[0]!,
      run.written.monitorLogBodies[0]!,
    ]) {
      const kept: Array<string> = (
        log["seriesBreakdown"] as Array<JSONObject>
      ).map((entry: JSONObject): string => {
        return String(entry["fingerprint"]);
      });

      expect(kept.length).toBeGreaterThan(breaching.size);
      expect(new Set<string>(kept.slice(0, breaching.size))).toEqual(breaching);
      expect(log[LOGGED_SERIES_FIELD]).toEqual({
        seriesInEvaluation: 2_000,
        seriesWithDataInEvaluation: 2_000,
        seriesKept: kept.length,
      });
      expect(log[EVIDENCE_TRUNCATED_FIELD]).toBe(true);
    }

    expect(
      Buffer.byteLength(JSON.stringify(run.written.statusChangeLogs[0])),
    ).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES);
  });

  test("the fleet exercises every path the equivalence is about", () => {
    const breaching: EvaluationOutcome = outcomes.get(CASES[0]!.name)!;
    const quiet: EvaluationOutcome = outcomes.get(CASES[1]!.name)!;

    // Every criteria matched some series, alerts opened, others resolved.
    expect(breaching.matchedCriteria).toHaveLength(3);
    for (const matched of breaching.matchedCriteria) {
      expect(matched.series.length).toBeGreaterThan(0);
    }
    expect(breaching.createdAlerts.length).toBeGreaterThan(10);
    expect(breaching.resolvedAlerts.length).toBeGreaterThan(3);
    expect(breaching.statusChanges).toHaveLength(1);

    // An alert open for a series still breaching is kept, not opened again.
    expect(
      (breaching.events as Array<{ type?: string }>).some(
        (event: { type?: string }): boolean => {
          return event.type === "alert-skipped";
        },
      ),
    ).toBe(true);

    // Nothing breaches: every open alert resolves, the status goes back.
    expect(quiet.criteriaMetId).toBeNull();
    expect(quiet.createdAlerts).toHaveLength(0);
    expect(quiet.resolvedAlerts.length).toBeGreaterThan(3);
    expect(quiet.statusChanges).toHaveLength(1);
  });
});
