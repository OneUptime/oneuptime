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
  EvaluationRun,
  runFleetEvaluation,
} from "./GroupedMetricMonitorHarness";
import { JSONObject } from "Common/Types/JSON";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import {
  LOGGED_SERIES_FIELD,
  LoggedSeries,
} from "Common/Utils/Monitor/StoredCheckEvidence";

/*
 * A GROUPED MONITOR'S LOG SAYS HOW LONG ITS EVALUATION TOOK (#10317).
 *
 * The #10108 fleet's monitor, evaluated on the real path - the worker's
 * job, its reads, monitorResource, the monitor log - with the stores stood
 * in for (GroupedMetricMonitorHarness). Its monitor log row's evaluation
 * summary must say how long the evaluation took, counting the worker's
 * reads, how many series it judged, as the row's own series count says,
 * and how often the monitor is checked: every 5 minutes, its schedule.
 */

const WINDOW_END_MS: number = Date.UTC(2026, 10, 17, 10, 5, 0);

let fleet: GroupedMetricFleet;
let run: EvaluationRun;

beforeAll(async () => {
  fleet = buildGroupedMetricFleet({
    seriesCount: 1_200,
    windowEndMs: WINDOW_END_MS,
    specialPerThousand: 3,
    seed: 10317,
  });

  run = await runFleetEvaluation({ fleet: fleet });
}, 600_000);

afterAll(() => {
  jest.restoreAllMocks();
});

function loggedBody(): JSONObject {
  expect(run.error).toBeNull();
  expect(run.written.monitorLogBodies).toHaveLength(1);

  return run.written.monitorLogBodies[0]!;
}

function loggedSummary(): MonitorEvaluationSummary {
  return loggedBody()[
    "evaluationSummary"
  ] as unknown as MonitorEvaluationSummary;
}

describe("the #10108 fleet's monitor log row", () => {
  test("says how long the evaluation took, its reads counted: within the run, most of it", () => {
    const durationInMs: number | undefined = loggedSummary().durationInMs;

    expect(typeof durationInMs).toBe("number");
    // The run times the same job from outside it, so a little longer.
    expect(durationInMs!).toBeLessThanOrEqual(run.measurement.totalMs + 1);
    // The reads come first, and are a large part of it: they are counted.
    expect(durationInMs!).toBeGreaterThan(run.measurement.totalMs / 2);
  });

  test("says how many series it judged, as the row's own count does", () => {
    const body: JSONObject = loggedBody();
    const logged: LoggedSeries | undefined = body[LOGGED_SERIES_FIELD] as
      | LoggedSeries
      | undefined;
    const series: number = logged
      ? logged.seriesInEvaluation
      : (body["seriesBreakdown"] as Array<unknown>).length;

    expect(series).toBeGreaterThan(1_000);
    expect(loggedSummary().seriesJudged).toBe(series);
  });

  test("and how often the monitor is checked: its schedule, every 5 minutes", () => {
    expect(fleet.monitor.monitoringInterval).toBe("*/5 * * * *");
    expect(loggedSummary().intervalInMs).toBe(5 * 60 * 1000);
  });
});
