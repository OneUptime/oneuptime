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
 * {@link insertHistoryRows}. History is POINT-IN-TIME: each evaluation
 * writes exactly one minute-floored bucket per series, once, with the
 * numbers as computed at that moment. Retroactive edits to the
 * underlying MonitorStatusTimeline are NOT restated into already-written
 * buckets — the SLO overview page always recomputes its current numbers
 * from Postgres and therefore self-heals, while the charts stay a
 * historical record of what was reported at the time.
 *
 * ReplacingMergeTree + the per-batch `version` stamp (unix millis)
 * therefore guard exactly one thing: a rare double write of the same
 * (projectId, sloId, metricName, bucketStart) identity — a retried job,
 * or two runs landing in the same minute — collapses to the highest
 * version at merge time instead of double-counting. Merges are
 * asynchronous, so a naive reader can transiently see both rows; that is
 * why the chart layer reads through `/aggregate` (its GROUP BY on the
 * bucketed timestamp collapses duplicates) and why a raw reader would
 * need `argMax(value, version) ... GROUP BY <identity>` (MutableMetric
 * precedent).
 *
 * Possible future work: restating a trailing window of buckets on every
 * run so retroactive timeline edits propagate into history. The version
 * machinery already supports it (a later run's rewrite carries a
 * strictly larger version and wins), but nothing writes those rewrites
 * today.
 */
export class SloHistoryService extends AnalyticsDatabaseService<SloHistory> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: SloHistory, database: clickhouseDatabase });
  }

  /*
   * Insert history rows. All rows in one call share a single `version`
   * stamp (unix millis at write time), so if the same bucket is ever
   * written twice — a retried job, or a re-run landing in the same
   * minute — the later write carries a strictly larger version and wins
   * the ReplacingMergeTree dedupe instead of double-counting. Rows with
   * a missing/non-finite value are skipped (same discipline as
   * MonitorMetricUtil's metric-row builder).
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
