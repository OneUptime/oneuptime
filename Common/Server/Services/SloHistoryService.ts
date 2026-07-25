import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import SloHistory from "../../Models/AnalyticsModels/SloHistory";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/**
 * One time-bucketed SLO measurement to persist. `metricName` is one of
 * the SloHistory series names ("sli.percent",
 * "error.budget.remaining.percent", "burn.rate", "good.count",
 * "total.count").
 */
export interface SloHistoryRow {
  projectId: ObjectID;
  sloId: ObjectID;
  metricName: string;
  bucketStart: Date;
  value: number;
}

/**
 * Service for the `SloHistory` ReplacingMergeTree table.
 *
 * Writes come from the SLO evaluation worker via
 * {@link insertHistoryRows}; the worker re-writes the trailing K hours
 * of buckets on every run, and the per-batch `version` stamp (unix
 * millis) makes those re-writes idempotent upserts — ReplacingMergeTree
 * keeps the highest version per
 * (projectId, sloId, metricName, bucketStart) identity at merge time,
 * and readers dedupe un-merged duplicates with
 * `argMax(value, version) ... GROUP BY` (MutableMetric precedent).
 */
export class SloHistoryService extends AnalyticsDatabaseService<SloHistory> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SloHistory, database: clickhouseDatabase });
  }

  /*
   * Insert (or restate) history rows. All rows in one call share a
   * single `version` stamp — evaluations run minutes apart, so a later
   * evaluation's restatement of the same bucket always carries a
   * strictly larger version and wins the ReplacingMergeTree dedupe.
   * Rows with a missing/non-finite value are skipped (same discipline
   * as MonitorMetricUtil's metric-row builder).
   */
  public async insertHistoryRows(rows: Array<SloHistoryRow>): Promise<void> {
    if (!rows || rows.length === 0) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const createdAt: string = OneUptimeDate.toClickhouseDateTime(now);
    const version: number = now.getTime();

    const jsonRows: Array<JSONObject> = [];

    for (const row of rows) {
      if (typeof row.value !== "number" || !isFinite(row.value)) {
        continue;
      }

      jsonRows.push({
        _id: ObjectID.generateTimeOrdered().toString(),
        createdAt: createdAt,
        projectId: row.projectId.toString(),
        sloId: row.sloId.toString(),
        metricName: row.metricName,
        bucketStart: OneUptimeDate.toClickhouseDateTime(row.bucketStart),
        value: row.value,
        version: version,
      } as JSONObject);
    }

    if (jsonRows.length === 0) {
      return;
    }

    await this.insertJsonRows(jsonRows);
  }
}

export default new SloHistoryService();
