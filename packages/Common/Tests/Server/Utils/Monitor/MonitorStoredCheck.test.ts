import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorEvidenceRedaction from "../../../../Server/Utils/Monitor/MonitorEvidenceRedaction";
import MonitorRecordEvidence from "../../../../Server/Utils/Monitor/MonitorRecordEvidence";
import MonitorStoredCheck from "../../../../Server/Utils/Monitor/MonitorStoredCheck";
import { JSONObject } from "../../../../Types/JSON";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import StoredCheckEvidence, {
  EVIDENCE_SCOPE_FIELD,
  EVIDENCE_TRUNCATED_FIELD,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "../../../../Utils/Monitor/StoredCheckEvidence";
import {
  GroupedMetricCheck,
  POINTS_PER_SERIES,
  QUERY_COUNT,
  fingerprintOf,
  groupedMetricCheck,
  seriesLabels,
} from "../../../Helpers/GroupedMetricCheck";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * THE CHECK AN INCIDENT OR AN ALERT KEEPS IS ABOUT ITS OWN SERIES, AND
 * BOUNDED (issue #9189).
 *
 * A grouped Metrics monitor opens one alert per series, and every one of
 * them kept the whole evaluation: 95 MB of JSON at 16,158 series, built,
 * redacted and written on the main thread once per alert, three times (the
 * alert, its Identified row, its Resolved row). Now a record about one
 * series keeps that series, and no stored check is ever past
 * STORED_CHECK_MAX_SIZE_IN_BYTES.
 */

// A read of a list entry, by its index.
const ENTRY_INDEX: RegExp = new RegExp("^[0-9]+$");

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function stored(input: {
  check: DataToProcess;
  seriesFingerprint?: string | undefined;
  maxSizeInBytes?: number | undefined;
}): JSONObject {
  return MonitorStoredCheck.toStoredCheck({
    dataToProcess: input.check,
    keepResponseContent: true,
    seriesFingerprint: input.seriesFingerprint,
    maxSizeInBytes: input.maxSizeInBytes,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a record about one series of a grouped metric monitor", () => {
  test("keeps that series' entry of seriesBreakdown, and no other", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 50 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(17),
    });
    const breakdown: Array<JSONObject> = log[
      "seriesBreakdown"
    ] as Array<JSONObject>;

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]!["fingerprint"]).toBe(fingerprintOf(17));
    expect(breakdown[0]!["labels"]).toEqual(seriesLabels(17));
  });

  test("keeps only that series' points of every query and of the formula, in their order", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 50 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(17),
    });
    const metricResult: Array<JSONObject> = log[
      "metricResult"
    ] as Array<JSONObject>;

    // Four queries and one formula, as metricResult had them.
    expect(metricResult).toHaveLength(QUERY_COUNT + 1);

    metricResult.forEach((result: JSONObject, resultIndex: number) => {
      const rows: Array<JSONObject> = result["data"] as Array<JSONObject>;

      expect(rows).toHaveLength(POINTS_PER_SERIES);

      rows.forEach((row: JSONObject, minute: number) => {
        expect(row["attributes"]).toEqual(seriesLabels(17));
        expect(row["value"]).toBe(17 * 1000 + resultIndex * 10 + minute);
      });
    });
  });

  test("keeps that series' arrivals in place of the evaluation's", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 3 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(1),
    });

    expect(log["metricResultArrivals"]).toEqual([null, null, null, null, null]);
  });

  test("says which series it kept and how many the evaluation looked at", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 50 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(3),
    });

    expect(log[EVIDENCE_SCOPE_FIELD]).toEqual({
      seriesFingerprint: fingerprintOf(3),
      seriesInEvaluation: 50,
    });
    expect(log[EVIDENCE_TRUNCATED_FIELD]).toBeUndefined();
  });

  test("keeps the rest of the check: the window, the config, the ids", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 5 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(0),
    });

    expect(log["projectId"]).toBeDefined();
    expect(log["monitorId"]).toBeDefined();
    expect(log["startAndEndDate"]).toBeDefined();
    expect(log["metricViewConfig"]).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
  });

  test("keeps no series when the evaluation no longer has it (it stopped reporting)", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 20 });
    const log: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: "0000000000000000",
    });

    expect(log["seriesBreakdown"]).toEqual([]);
    expect(log["metricResult"]).toEqual([]);
    expect(log["metricResultArrivals"]).toBeUndefined();
    expect(log[EVIDENCE_SCOPE_FIELD]).toEqual({
      seriesFingerprint: "0000000000000000",
      seriesInEvaluation: 20,
    });
  });

  test("keeps the whole evaluation for a record about the whole monitor", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 10 });

    for (const fingerprint of [
      undefined,
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    ]) {
      const log: JSONObject = stored({
        check: fleet.check,
        seriesFingerprint: fingerprint,
      });

      expect(log["seriesBreakdown"] as Array<JSONObject>).toHaveLength(10);
      expect(log[EVIDENCE_SCOPE_FIELD]).toBeUndefined();
    }
  });

  test("leaves out the evaluation's list of every series it read (#10062), which a record of one series does not need", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 10 });
    const withTable: DataToProcess = {
      ...fleet.check,
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
        series: {
          count: 10,
          rows: [
            {
              fingerprint: fingerprintOf(3),
              labels: seriesLabels(3),
              valueKind: "Metric",
              metCriteriaIds: [],
            },
          ],
        },
      },
    } as unknown as DataToProcess;

    const scoped: JSONObject = stored({
      check: withTable,
      seriesFingerprint: fingerprintOf(3),
    });
    const summary: JSONObject = scoped["evaluationSummary"] as JSONObject;

    expect(summary).toBeDefined();
    expect(summary["series"]).toBeUndefined();
    expect(summary["criteriaResults"]).toEqual([]);

    // The whole monitor's record - a change of its status - keeps it.
    const whole: JSONObject = stored({ check: withTable });
    expect(
      ((whole["evaluationSummary"] as JSONObject)["series"] as JSONObject)[
        "count"
      ],
    ).toBe(10);

    // The check handed in is left as it was.
    expect(
      (withTable as unknown as { evaluationSummary: JSONObject })
        .evaluationSummary["series"],
    ).toBeDefined();
  });

  test("never changes the check it was handed: the next record still reads it", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 10 });
    const before: string = JSON.stringify(fleet.check);

    stored({ check: fleet.check, seriesFingerprint: fingerprintOf(2) });
    stored({ check: fleet.check, seriesFingerprint: fingerprintOf(7) });

    expect(JSON.stringify(fleet.check)).toBe(before);
  });

  test("redacts only what it keeps: never the series it dropped", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 300 });
    const redactText: SpyInstance<typeof MonitorEvidenceRedaction.redactText> =
      jest.spyOn(MonitorEvidenceRedaction, "redactText");

    stored({ check: fleet.check, seriesFingerprint: fingerprintOf(5) });
    const scopedCalls: number = redactText.mock.calls.length;

    redactText.mockClear();
    stored({ check: fleet.check });
    const wholeCalls: number = redactText.mock.calls.length;

    // The series' own labels are read; 299 other series' are not.
    expect(scopedCalls).toBeLessThan(200);
    expect(wholeCalls).toBeGreaterThan(scopedCalls * 5);
  });

  test("finds the series through an index built once for each evaluation", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 200 });
    const breakdown: Array<unknown> = fleet.check.seriesBreakdown!;
    let reads: number = 0;

    // Count reads of the list's entries.
    const counted: Array<unknown> = new Proxy(breakdown, {
      get(target: Array<unknown>, key: string | symbol): unknown {
        if (typeof key === "string" && ENTRY_INDEX.test(key)) {
          reads++;
        }

        return Reflect.get(target, key);
      },
    });

    const check: MetricMonitorResponse = {
      ...fleet.check,
      seriesBreakdown: counted as MetricMonitorResponse["seriesBreakdown"],
    };

    MonitorStoredCheck.scopeToSeries({
      check: check,
      seriesFingerprint: fingerprintOf(1),
    });

    const firstReads: number = reads;

    for (let i: number = 2; i < 30; i++) {
      MonitorStoredCheck.scopeToSeries({
        check: check,
        seriesFingerprint: fingerprintOf(i),
      });
    }

    expect(firstReads).toBe(200);
    // Every record after the first finds its series without a walk.
    expect(reads).toBe(200);
  });
});

describe("a record about one group of a grouped Logs monitor", () => {
  function groupedLogCheck(): LogMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      logCount: 30,
      groupByAttributes: ["con_name"],
      groupBreakdown: [
        { fingerprint: "fp-a", labels: { con_name: "HQ" }, logCount: 20 },
        { fingerprint: "fp-b", labels: { con_name: "Branch" }, logCount: 10 },
      ],
      resolvedGroups: [
        { fingerprint: "fp-c", labels: { con_name: "Lab" }, logCount: 0 },
      ],
      totalGroupCount: 3,
    } as unknown as LogMonitorResponse;
  }

  test("keeps that group only", () => {
    const log: JSONObject = stored({
      check: groupedLogCheck(),
      seriesFingerprint: "fp-b",
    });

    expect(log["groupBreakdown"]).toEqual([
      { fingerprint: "fp-b", labels: { con_name: "Branch" }, logCount: 10 },
    ]);
    expect(log["resolvedGroups"]).toEqual([]);
    expect(log["totalGroupCount"]).toBe(3);
  });

  test("keeps the group that resolved it on the Resolved row", () => {
    const log: JSONObject = stored({
      check: groupedLogCheck(),
      seriesFingerprint: "fp-c",
    });

    expect(log["groupBreakdown"]).toEqual([]);
    expect(log["resolvedGroups"]).toEqual([
      { fingerprint: "fp-c", labels: { con_name: "Lab" }, logCount: 0 },
    ]);
  });
});

describe("a check that is not grouped", () => {
  function probeCheck(): ProbeMonitorResponse {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      probeId: ObjectID.generate(),
      isOnline: false,
      responseCode: 503,
      responseBody: "Service Unavailable",
      monitoredAt: new Date("2026-11-17T10:00:00.000Z"),
    } as unknown as ProbeMonitorResponse;
  }

  test("is kept as the monitor's logs keep it, a series or not", () => {
    const check: ProbeMonitorResponse = probeCheck();
    const expected: JSONObject = MonitorRecordEvidence.toStoredCheck({
      dataToProcess: check,
      keepResponseContent: true,
    });

    expect(stored({ check: check })).toEqual(expected);
    // An Incoming Request grouping key names a series, not a list of them.
    expect(stored({ check: check, seriesFingerprint: "abc" })).toEqual(
      expected,
    );
  });

  test("an ungrouped metric check keeps every point", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 1 });
    const ungrouped: MetricMonitorResponse = { ...fleet.check };
    delete ungrouped.seriesBreakdown;

    const log: JSONObject = stored({ check: ungrouped });

    expect(log["metricResult"] as Array<JSONObject>).toHaveLength(5);
    expect(log[EVIDENCE_SCOPE_FIELD]).toBeUndefined();
    expect(log[EVIDENCE_TRUNCATED_FIELD]).toBeUndefined();
  });
});

describe("the size limit", () => {
  test("cuts a check past the limit to the limit, and says so", () => {
    const check: ProbeMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      monitorStepId: ObjectID.generate(),
      isOnline: true,
      responseCode: 200,
      responseBody: "x".repeat(STORED_CHECK_MAX_SIZE_IN_BYTES * 2),
    } as unknown as ProbeMonitorResponse;

    const log: JSONObject = stored({ check: check });

    expect(bytes(log)).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(log[EVIDENCE_TRUNCATED_FIELD]).toBe(true);
    expect(StoredCheckEvidence.isTrimmed(log)).toBe(true);
    // What says what happened is kept whole.
    expect(log["responseCode"]).toBe(200);
    expect(log["isOnline"]).toBe(true);
    expect((log["responseBody"] as string).length).toBeGreaterThan(
      STORED_CHECK_MAX_SIZE_IN_BYTES / 2,
    );
  });

  test("bounds a whole-monitor record of a fleet before redacting it", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 5000,
    });
    const redactText: SpyInstance<typeof MonitorEvidenceRedaction.redactText> =
      jest.spyOn(MonitorEvidenceRedaction, "redactText");

    const log: JSONObject = stored({ check: fleet.check });

    expect(bytes(log)).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(log[EVIDENCE_TRUNCATED_FIELD]).toBe(true);
    // 5,000 series hold 40,000 texts in their labels alone.
    expect(redactText.mock.calls.length).toBeLessThan(20_000);
  });

  test("leaves a check under the limit as it was", () => {
    const fleet: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 2 });

    expect(stored({ check: fleet.check })[EVIDENCE_TRUNCATED_FIELD]).toBe(
      undefined,
    );
  });

  test.each([4 * 1024, 16 * 1024, 64 * 1024])(
    "holds for any limit: %i bytes",
    (maxSizeInBytes: number) => {
      const fleet: GroupedMetricCheck = groupedMetricCheck({
        seriesCount: 400,
      });

      const log: JSONObject = stored({
        check: fleet.check,
        maxSizeInBytes: maxSizeInBytes,
      });

      expect(bytes(log)).toBeLessThanOrEqual(maxSizeInBytes);
      expect(log[EVIDENCE_TRUNCATED_FIELD]).toBe(true);
    },
  );
});

/*
 * The regression of #9189: what one alert keeps grew with the fleet - 2 MB
 * stored at 3,000 series, 12 MB at 16,158. It must not grow at all.
 */
describe("what a series' record keeps does not grow with the fleet", () => {
  test("one series of 5,000 keeps what one series of 1 does", () => {
    const one: GroupedMetricCheck = groupedMetricCheck({ seriesCount: 1 });
    const fleet: GroupedMetricCheck = groupedMetricCheck({
      seriesCount: 5000,
    });

    const alone: JSONObject = stored({
      check: one.check,
      seriesFingerprint: fingerprintOf(0),
    });
    const inFleet: JSONObject = stored({
      check: fleet.check,
      seriesFingerprint: fingerprintOf(0),
    });

    // The same series, the same points: only the count of series differs.
    expect(inFleet["seriesBreakdown"]).toEqual(alone["seriesBreakdown"]);
    expect(inFleet["metricResult"]).toEqual(alone["metricResult"]);

    // "1" against "5000" in seriesInEvaluation.
    expect(bytes(inFleet) - bytes(alone)).toBeLessThanOrEqual(3);
    expect(bytes(inFleet)).toBeLessThan(16 * 1024);

    // The whole evaluation, as every alert kept it before.
    expect(bytes(JSON.parse(JSON.stringify(fleet.check)))).toBeGreaterThan(
      500 * bytes(inFleet),
    );
  });
});
