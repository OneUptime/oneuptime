/*
 * A GROUPED CHECK'S MONITOR LOG KEEPS A BOUNDED SHARE OF ITS SERIES
 * (issue #10108).
 *
 * Every evaluation of a monitor ends with one Monitoring Logs row
 * (MonitorLogUtil.saveMonitorLog). A Metrics monitor grouped by host and
 * container over 16,000 series put every series of every query in that row:
 * 73 MB of JSON, copied, redacted and encoded on the event loop - four of the
 * evaluation's seconds, in one block - and written to ClickHouse every five
 * minutes, for a page that shows a count and the criteria's verdicts.
 *
 * Now a grouped check whose series are too many keeps
 * STORED_CHECK_MAX_SIZE_IN_BYTES of them - the series the evaluation matched
 * first, then the rest in order - with those series' own points as its
 * metricResult, and says how many it had (LOGGED_SERIES_FIELD), which the
 * page counts. Anything that fits, and every check that is not grouped, is
 * kept as it was.
 */

const mockShutdown: { callback: (() => Promise<void> | void) | null } = {
  callback: null,
};

jest.mock("../../../../Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: {
      registerHandler: (
        _name: string,
        _priority: number,
        callback: () => Promise<void> | void,
      ): void => {
        mockShutdown.callback = callback;
      },
    },
    ShutdownPriority: {
      HttpServer: 10,
      Workers: 20,
      Buffers: 30,
      DataStores: 40,
      Telemetry: 50,
    },
  };
});

jest.mock("../../../../Server/Services/MonitorLogService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
});

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(() => {
        return Promise.resolve({ monitorLogRetentionInDays: 1 });
      }),
    },
  };
});

jest.mock("../../../../Server/Services/ProjectMilestoneService", () => {
  return {
    __esModule: true,
    default: { reachInBackground: jest.fn() },
  };
});

import MonitorLogService from "../../../../Server/Services/MonitorLogService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorStoredCheck from "../../../../Server/Utils/Monitor/MonitorStoredCheck";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../Types/JSON";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { TelemetryObservationKind } from "../../../../Types/Monitor/TelemetryObservation";
import MonitorLogSummaryUtil from "../../../../Utils/Monitor/MonitorLogSummaryUtil";
import {
  EVIDENCE_TRUNCATED_FIELD,
  LOGGED_SERIES_FIELD,
  LoggedSeries,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "../../../../Utils/Monitor/StoredCheckEvidence";
import {
  GroupedMetricCheck,
  QUERY_COUNT,
  fingerprintOf,
  groupedMetricCheck,
} from "../../../Helpers/GroupedMetricCheck";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const insertJsonRows: jest.Mock =
  MonitorLogService.insertJsonRows as unknown as jest.Mock;

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function asObject(check: DataToProcess): JSONObject {
  return check as unknown as JSONObject;
}

function seriesOf(check: DataToProcess): Array<MetricSeriesResult> {
  return (asObject(check)["seriesBreakdown"] ||
    []) as unknown as Array<MetricSeriesResult>;
}

function loggedOf(check: DataToProcess | JSONObject): LoggedSeries {
  return (check as unknown as JSONObject)[
    LOGGED_SERIES_FIELD
  ] as unknown as LoggedSeries;
}

async function saveAndFlush(input: {
  check: DataToProcess;
  seriesActedOn?: Set<string> | undefined;
}): Promise<JSONObject> {
  MonitorLogUtil.saveMonitorLog({
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
    dataToProcess: input.check,
    keepResponseContent: true,
    seriesActedOn: input.seriesActedOn,
  });

  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  await mockShutdown.callback!();

  const calls: Array<Array<unknown>> = insertJsonRows.mock
    .calls as unknown as Array<Array<unknown>>;
  const rows: Array<JSONObject> = calls[
    calls.length - 1
  ]![0] as Array<JSONObject>;

  expect(rows).toHaveLength(1);

  return rows[0]!["logBody"] as JSONObject;
}

beforeEach(() => {
  insertJsonRows.mockClear();
});

describe("MonitorStoredCheck.boundSeries", () => {
  test("a check with no series list is handed back as it is", () => {
    const check: DataToProcess = {
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      responseBody: "x".repeat(STORED_CHECK_MAX_SIZE_IN_BYTES * 3),
    } as unknown as DataToProcess;

    expect(MonitorStoredCheck.boundSeries({ check: check })).toBe(check);
  });

  test("a grouped check whose series fit is handed back as it is", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 20 });

    expect(MonitorStoredCheck.boundSeries({ check: fleet.check })).toBe(
      fleet.check,
    );
  });

  test("a fleet's series are cut to the budget, the evaluation's own and the check untouched", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });
    const before: string = JSON.stringify(fleet.check);

    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: fleet.check,
    });

    expect(bounded).not.toBe(fleet.check);
    // What it was handed is left as it was.
    expect(JSON.stringify(fleet.check)).toBe(before);

    const kept: Array<MetricSeriesResult> = seriesOf(bounded);

    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(3_000);
    // In the evaluation's order, from its first series.
    expect(
      kept.map((series: MetricSeriesResult): string => {
        return series.fingerprint;
      }),
    ).toEqual(fleet.fingerprints.slice(0, kept.length));

    // Half the budget for the series, half for their points.
    expect(bytes(kept)).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES / 2);
    expect(bytes(bounded)).toBeLessThan(STORED_CHECK_MAX_SIZE_IN_BYTES + 4096);

    expect(loggedOf(bounded)).toEqual({
      seriesInEvaluation: 3_000,
      seriesWithDataInEvaluation: 3_000,
      seriesKept: kept.length,
    });
    expect(asObject(bounded)[EVIDENCE_TRUNCATED_FIELD]).toBe(true);

    // Everything but the series is the check's own.
    const source: JSONObject = asObject(fleet.check);
    expect(asObject(bounded)["startAndEndDate"]).toBe(
      source["startAndEndDate"],
    );
    expect(asObject(bounded)["metricViewConfig"]).toBe(
      source["metricViewConfig"],
    );
  });

  test("metricResult keeps the points of the series kept, query by query and formula by formula", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });
    (asObject(fleet.check)["metricResult"] as Array<JSONObject>)[0]![
      "truncated"
    ] = true;

    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: fleet.check,
    });
    const kept: Array<MetricSeriesResult> = seriesOf(bounded);
    const metricResult: Array<AggregatedResult> = (
      bounded as MetricMonitorResponse
    ).metricResult;

    expect(metricResult).toHaveLength(QUERY_COUNT + 1);

    metricResult.forEach((result: AggregatedResult, index: number) => {
      expect(result.data).toEqual(
        kept.flatMap((series: MetricSeriesResult) => {
          return series.aggregatedResults[index]!.data;
        }),
      );
    });

    // What the result itself says is kept: the first read was cut.
    expect(metricResult[0]!.truncated).toBe(true);
  });

  test("the series the evaluation acted on are kept first, wherever they are", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });
    const actedOn: Array<string> = [
      fleet.fingerprints[2_999]!,
      fleet.fingerprints[1_500]!,
      fleet.fingerprints[7]!,
    ];

    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: fleet.check,
      firstFingerprints: new Set<string>(actedOn),
    });

    const kept: Array<string> = seriesOf(bounded).map(
      (series: MetricSeriesResult): string => {
        return series.fingerprint;
      },
    );

    // The acted-on ones in the evaluation's order, then the rest from the start.
    expect(kept.slice(0, 3)).toEqual([
      fleet.fingerprints[7],
      fleet.fingerprints[1_500],
      fleet.fingerprints[2_999],
    ]);
    expect(kept[3]).toBe(fingerprintOf(0));
    expect(new Set<string>(kept).size).toBe(kept.length);
  });

  test("a series with no data point is not counted as one that reported", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });

    // Seeded for a host that stopped reporting: no point in any slot.
    for (const series of seriesOf(fleet.check).slice(0, 40)) {
      series.aggregatedResults = series.aggregatedResults.map(
        (): AggregatedResult => {
          return { data: [] };
        },
      );
    }

    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: fleet.check,
    });

    expect(loggedOf(bounded).seriesInEvaluation).toBe(3_000);
    expect(loggedOf(bounded).seriesWithDataInEvaluation).toBe(2_960);
  });

  test("a grouped Logs check keeps a share of its groups the same way", () => {
    const groups: Array<JSONObject> = [];

    for (let index: number = 0; index < 4_000; index++) {
      groups.push({
        fingerprint: `group-${index}`,
        labels: { "tunnel.id": `tunnel-${index}`, region: "eu-west-1" },
        logCount: index,
        sampleMessage: `tunnel tunnel-${index} went down after a keepalive timeout`,
      });
    }

    const check: DataToProcess = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      logCount: 4_000,
      groupBreakdown: groups,
    } as unknown as LogMonitorResponse as DataToProcess;

    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: check,
      firstFingerprints: new Set<string>(["group-3999"]),
    });

    const kept: Array<JSONObject> = asObject(bounded)[
      "groupBreakdown"
    ] as Array<JSONObject>;

    expect(kept[0]!["fingerprint"]).toBe("group-3999");
    expect(bytes(kept)).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(loggedOf(bounded)).toEqual({
      seriesInEvaluation: 4_000,
      seriesWithDataInEvaluation: 4_000,
      seriesKept: kept.length,
    });
    expect(asObject(bounded)["logCount"]).toBe(4_000);
  });

  test("16,000 series are bounded without walking every one of them", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 16_000,
    });

    const startedAt: number = Date.now();
    const bounded: DataToProcess = MonitorStoredCheck.boundSeries({
      check: fleet.check,
    });
    const tookMs: number = Date.now() - startedAt;

    expect(loggedOf(bounded).seriesInEvaluation).toBe(16_000);
    // About 10 ms in production's runtime; the copy it replaced took seconds.
    expect(tookMs).toBeLessThan(1_000);
  });
});

describe("the monitor log row of a grouped check", () => {
  test("keeps a bounded share of a fleet's series, and its evaluation whole", async () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });
    const check: MetricMonitorResponse = fleet.check;
    check.evaluationSummary = {
      evaluatedAt: new Date("2026-11-17T10:05:00.000Z"),
      criteriaResults: [
        {
          criteriaId: "criteria-1",
          criteriaName: "Container restarted",
          met: true,
          message: "Criteria met.",
          filters: [],
        },
      ],
      events: [],
    } as unknown as MetricMonitorResponse["evaluationSummary"];

    const logBody: JSONObject = await saveAndFlush({
      check: check,
      seriesActedOn: new Set<string>([fleet.fingerprints[2_500]!]),
    });

    expect(bytes(logBody)).toBeLessThan(STORED_CHECK_MAX_SIZE_IN_BYTES + 8192);
    expect(
      (logBody["seriesBreakdown"] as Array<JSONObject>)[0]!["fingerprint"],
    ).toBe(fleet.fingerprints[2_500]);
    expect(loggedOf(logBody).seriesInEvaluation).toBe(3_000);
    expect(logBody[EVIDENCE_TRUNCATED_FIELD]).toBe(true);
    expect(
      (logBody["evaluationSummary"] as JSONObject)["criteriaResults"],
    ).toEqual([
      {
        criteriaId: "criteria-1",
        criteriaName: "Container restarted",
        met: true,
        message: "Criteria met.",
        filters: [],
      },
    ]);

    // The live check the evaluation still reads is whole.
    expect(check.seriesBreakdown).toHaveLength(3_000);
  });

  test("keeps a grouped check whose series fit as it was", async () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 12 });

    const logBody: JSONObject = await saveAndFlush({ check: fleet.check });

    expect(logBody["seriesBreakdown"] as Array<JSONObject>).toHaveLength(12);
    expect(logBody[LOGGED_SERIES_FIELD]).toBeUndefined();
    expect(logBody[EVIDENCE_TRUNCATED_FIELD]).toBeUndefined();
  });

  test("keeps a check that is not grouped as it was, however large", async () => {
    const body: string = "<html>" + "a".repeat(600_000) + "</html>";
    const check: DataToProcess = {
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      responseBody: body,
      responseCode: 200,
    } as unknown as DataToProcess;

    const logBody: JSONObject = await saveAndFlush({ check: check });

    expect(logBody["responseBody"]).toBe(body);
    expect(logBody[EVIDENCE_TRUNCATED_FIELD]).toBeUndefined();
  });
});

describe("the Monitoring Logs page counts what a trimmed row saw", () => {
  test("a row that kept a share of 16,250 series reads 16,250", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 3_000,
    });
    const bounded: JSONObject = asObject(
      MonitorStoredCheck.boundSeries({ check: fleet.check }),
    );
    bounded[LOGGED_SERIES_FIELD] = {
      seriesInEvaluation: 16_258,
      seriesWithDataInEvaluation: 16_250,
      seriesKept: 70,
    };

    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Metrics,
        logBody: bounded,
      }),
    ).toEqual({ kind: TelemetryObservationKind.MetricSeries, count: 16_250 });
  });

  test("a row that kept every series is counted from them, as before", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 12 });

    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Metrics,
        logBody: asObject(fleet.check),
      }),
    ).toEqual({ kind: TelemetryObservationKind.MetricSeries, count: 12 });
  });

  test("a count that is not a whole number is not read", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 12 });
    const body: JSONObject = {
      ...asObject(fleet.check),
      [LOGGED_SERIES_FIELD]: { seriesWithDataInEvaluation: "16250" },
    };

    expect(
      MonitorLogSummaryUtil.getTelemetryObservation({
        monitorType: MonitorType.Metrics,
        logBody: body,
      }),
    ).toEqual({ kind: TelemetryObservationKind.MetricSeries, count: 12 });
  });
});
