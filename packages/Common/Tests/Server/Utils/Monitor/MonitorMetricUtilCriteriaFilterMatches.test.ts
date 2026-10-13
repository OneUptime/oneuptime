import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import {
  CRITERIA_FILTER_KEY_ATTRIBUTE,
  CRITERIA_FILTER_MATCH_METRIC_NAME,
} from "../../../../Types/Monitor/CriteriaFilterMatchHistory";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The rows a check writes for the filters that keep a match history
 * (CriteriaFilterMatchHistory): one per filter, 1 when the filter matched
 * and 0 when it did not, tagged with the filter's key - the one attribute
 * the history is read back by.
 */

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

describe("MonitorMetricUtil.saveCriteriaFilterMatches", () => {
  let insertedRows: Array<Array<JSONObject>>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    insertedRows = [];

    // No retention configured: the monitor metrics' default, 30 days.
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(rows);
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("writes one row per filter, 1 for a match and 0 otherwise, in a single insert", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probeId: PROBE_ID,
      matches: [
        { filterKey: "body-key", matched: true },
        { filterKey: "header-key", matched: false },
      ],
    });

    expect(insertedRows).toHaveLength(1);

    const rows: Array<JSONObject> = insertedRows[0]!;

    expect(
      rows.map((row: JSONObject) => {
        return {
          name: row["name"],
          value: row["value"],
          key: (row["attributes"] as JSONObject)[CRITERIA_FILTER_KEY_ATTRIBUTE],
        };
      }),
    ).toEqual([
      { name: CRITERIA_FILTER_MATCH_METRIC_NAME, value: 1, key: "body-key" },
      { name: CRITERIA_FILTER_MATCH_METRIC_NAME, value: 0, key: "header-key" },
    ]);
  });

  test("files the row under the monitor, like every other monitor metric", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      probeId: PROBE_ID,
      matches: [{ filterKey: "body-key", matched: true }],
    });

    const row: JSONObject = insertedRows[0]![0]!;

    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBe(MONITOR_ID.toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.Monitor);
    expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(row["attributes"]).toEqual({
      monitorId: MONITOR_ID.toString(),
      projectId: PROJECT_ID.toString(),
      [CRITERIA_FILTER_KEY_ATTRIBUTE]: "body-key",
      probeId: PROBE_ID.toString(),
    });
    expect(row["attributeKeys"]).toEqual(
      expect.arrayContaining([CRITERIA_FILTER_KEY_ATTRIBUTE, "probeId"]),
    );
  });

  /*
   * The same retention as the monitor's other metrics, so the rows expire
   * with theirs instead of costing their partition a rewrite of its own
   * (RetentionTtl).
   */
  test("keeps the rows as long as the monitor's other metrics", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      matches: [{ filterKey: "body-key", matched: true }],
    });

    const row: JSONObject = insertedRows[0]![0]!;
    const writtenAt: number = new Date(`${row["time"]}Z`).getTime();
    const expiresAt: number = new Date(`${row["retentionDate"]}Z`).getTime();

    expect(expiresAt - writtenAt).toBe(30 * DAY_IN_MS);
  });

  test("leaves the probe out when the check names none", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      matches: [{ filterKey: "body-key", matched: false }],
    });

    expect(
      Object.keys(insertedRows[0]![0]!["attributes"] as JSONObject),
    ).not.toContain("probeId");
  });

  test("writes nothing at all when no filter keeps a history", async () => {
    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      matches: [],
    });

    expect(insertedRows).toHaveLength(0);
  });

  /*
   * The record is the evaluator's, not a chart: it must not appear among
   * the metrics a person can pick.
   */
  test("is never offered as a metric", async () => {
    const indexMetricNames: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TelemetryUtil,
      "indexMetricNameServiceNameMap",
    );

    await MonitorMetricUtil.saveCriteriaFilterMatches({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      matches: [{ filterKey: "body-key", matched: true }],
    });

    expect(indexMetricNames).not.toHaveBeenCalled();
  });
});
