import Includes from "../../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { findCloudCostAnomalies } from "../../../Types/Cloud/CloudCostAnomaly";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CLOUD_COST_DEFAULT_CURRENCY,
  addUtcDays,
  addUtcMonths,
  fromCloudCostDay,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeCloudAccountCosts,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudCostService from "../../Services/CloudCostService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { CloudCostRecord } from "./CloudConnectorTypes";

/*
 * KEEPS A CLOUD ACCOUNT'S DAILY COSTS, EXACTLY.
 *
 * A read of costs returns the cloud's figure for every day of its window,
 * and a day is read many times: today grows all day, and the days before
 * it are corrected for a while. The cost table only ever appends
 * (CloudCost), so the writer never writes a figure twice - it reads what
 * is already stored for the window (one sum per day and series) and
 * writes only the DIFFERENCE between the cloud's figure and that sum. The
 * sum of a day's rows is then always the cloud's latest figure.
 *
 * That heals on its own: a write that was lost is written again by the
 * next read (the stored sum is short), and a write that landed twice - two
 * reads racing, a retried insert that had worked - is taken back by the
 * next read with a negative row. A series the cloud no longer reports for
 * a day it covers gets a row that cancels it. Only an account read in full
 * for the window is corrected so: one that could not be read keeps what it
 * has. The same technique as LlmProviderUsageWriter.
 */

const COST_TABLE: string = AnalyticsTableName.CloudCost;

const READ_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

// Differences smaller than this are float noise, not cost.
export const COST_EPSILON: number = 0.000001;

// One series of one day of one account: the identity of a cost row.
export interface CloudCostSeriesPoint {
  // The CloudAccount row id.
  cloudAccountId: string;
  // The account's id in its cloud.
  accountId: string;
  day: string;
  service: string;
  region: string;
  resourceId: string;
  currency: string;
  amount: number;
}

export interface CloudCostWriteTarget {
  projectId: ObjectID;
  connectionId: ObjectID;
  provider: string;
  // An account's id in its cloud (lower case) -> its CloudAccount row id.
  accountRows: Map<string, ObjectID>;
}

export interface CloudCostWriteResult {
  // Day-series the cloud reported for the accounts read.
  seriesCount: number;
  // Rows written (only series whose figure changed).
  rowsWritten: number;
  // Records of accounts OneUptime holds no row for, left out.
  recordsWithoutAccount: number;
}

export default class CloudCostWriter {
  /*
   * A day-series' identity: its account's row, the day and every field
   * that tells two series apart. A point read back from storage and one
   * built from a record compare equal when they are the same series.
   */
  public static seriesKey(point: CloudCostSeriesPoint): string {
    return JSON.stringify([
      point.cloudAccountId,
      point.day,
      point.service,
      point.region,
      point.resourceId,
      point.currency,
    ]);
  }

  /*
   * The cloud's records as series points: each record of an account
   * OneUptime holds, records of the same series added up (a cloud may
   * split one series over pages).
   */
  public static toSeriesPoints(data: {
    target: CloudCostWriteTarget;
    records: Array<CloudCostRecord>;
  }): { points: Array<CloudCostSeriesPoint>; withoutAccount: number } {
    const points: Map<string, CloudCostSeriesPoint> = new Map();
    let withoutAccount: number = 0;

    for (const record of data.records) {
      const accountRow: ObjectID | undefined = data.target.accountRows.get(
        record.accountId.trim().toLowerCase(),
      );

      if (!accountRow) {
        withoutAccount++;
        continue;
      }

      if (!Number.isFinite(record.amount)) {
        continue;
      }

      const point: CloudCostSeriesPoint = {
        cloudAccountId: accountRow.toString(),
        accountId: record.accountId.trim(),
        day: record.day,
        service: record.service,
        region: record.region,
        resourceId: record.resourceId,
        currency: record.currency || CLOUD_COST_DEFAULT_CURRENCY,
        amount: record.amount,
      };
      const key: string = CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = points.get(key);

      if (existing) {
        existing.amount += point.amount;
      } else {
        points.set(key, point);
      }
    }

    return { points: Array.from(points.values()), withoutAccount };
  }

  /*
   * The rows to write so storage matches the cloud: for every day-series
   * the cloud reports or storage holds within the window, the cloud's
   * figure minus the stored sum, where they differ.
   */
  public static computeDeltas(data: {
    desired: Array<CloudCostSeriesPoint>;
    stored: Array<CloudCostSeriesPoint>;
    window: { start: Date; end: Date };
  }): Array<CloudCostSeriesPoint> {
    const startDay: string = toCloudCostDay(data.window.start);
    const endDay: string = toCloudCostDay(data.window.end);
    const inWindow: (point: CloudCostSeriesPoint) => boolean = (
      point: CloudCostSeriesPoint,
    ): boolean => {
      return point.day >= startDay && point.day < endDay;
    };

    const desired: Map<string, CloudCostSeriesPoint> = new Map();

    for (const point of data.desired.filter(inWindow)) {
      const key: string = CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = desired.get(key);

      if (existing) {
        existing.amount += point.amount;
      } else {
        desired.set(key, { ...point });
      }
    }

    const stored: Map<string, CloudCostSeriesPoint> = new Map();

    for (const point of data.stored.filter(inWindow)) {
      const key: string = CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = stored.get(key);

      if (existing) {
        existing.amount += point.amount;
      } else {
        stored.set(key, { ...point });
      }
    }

    const deltas: Array<CloudCostSeriesPoint> = [];
    const keys: Set<string> = new Set<string>([
      ...Array.from(desired.keys()),
      ...Array.from(stored.keys()),
    ]);

    for (const key of keys) {
      const want: CloudCostSeriesPoint | undefined = desired.get(key);
      const have: CloudCostSeriesPoint | undefined = stored.get(key);
      const template: CloudCostSeriesPoint = (want || have)!;
      const delta: number = (want?.amount || 0) - (have?.amount || 0);

      if (Math.abs(delta) < COST_EPSILON) {
        continue;
      }

      deltas.push({ ...template, amount: delta });
    }

    return deltas;
  }

  /*
   * The stored sums of some accounts' series over a window: one row per
   * account, day and series.
   */
  public static buildStoredSumsStatement(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<string>;
    window: { start: Date; end: Date };
  }): Statement {
    const statement: Statement = SQL`SELECT toString(cloudAccountId) AS accountRowId, any(accountId) AS cloudAccountName, toString(toDate(day, 'UTC')) AS dayText, service AS serviceName, region AS regionName, resourceId AS resourceKey, currency AS currencyCode, sum(cost) AS total FROM ${COST_TABLE} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND cloudAccountId IN ${{
      type: TableColumnType.ObjectID,
      value: new Includes(data.cloudAccountIds),
    }} AND day >= ${{
      type: TableColumnType.Date,
      value: data.window.start,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.window.end,
    }} GROUP BY accountRowId, dayText, serviceName, regionName, resourceKey, currencyCode`;

    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  // Rows of the stored-sums query, read back as series points.
  public static readStoredSums(
    rows: Array<JSONObject>,
  ): Array<CloudCostSeriesPoint> {
    const points: Array<CloudCostSeriesPoint> = [];

    for (const row of rows) {
      const total: number = Number(row["total"]);
      const day: string =
        typeof row["dayText"] === "string" ? row["dayText"] : "";

      if (!Number.isFinite(total) || !day) {
        continue;
      }

      points.push({
        cloudAccountId: String(row["accountRowId"] || ""),
        accountId: String(row["cloudAccountName"] || ""),
        day,
        service: String(row["serviceName"] ?? ""),
        region: String(row["regionName"] ?? ""),
        resourceId: String(row["resourceKey"] ?? ""),
        currency: String(row["currencyCode"] || CLOUD_COST_DEFAULT_CURRENCY),
        amount: total,
      });
    }

    return points;
  }

  // The rows of a set of deltas, in the cost table's shape.
  public static buildRows(data: {
    target: CloudCostWriteTarget;
    deltas: Array<CloudCostSeriesPoint>;
    now: Date;
  }): Array<JSONObject> {
    const readAt: string = OneUptimeDate.toClickhouseDateTime(data.now);

    return data.deltas.map((delta: CloudCostSeriesPoint): JSONObject => {
      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        projectId: data.target.projectId.toString(),
        cloudAccountId: delta.cloudAccountId,
        cloudConnectionId: data.target.connectionId.toString(),
        provider: data.target.provider,
        accountId: delta.accountId,
        day: OneUptimeDate.toClickhouseDateTime(fromCloudCostDay(delta.day)),
        service: delta.service,
        region: delta.region,
        resourceId: delta.resourceId,
        cost: delta.amount,
        currency: delta.currency,
        readAt,
      };
    });
  }

  private static async query(statement: Statement): Promise<Array<JSONObject>> {
    const result: Results = await CloudCostService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    return (response.data || []) as Array<JSONObject>;
  }

  /*
   * Bring storage in line with what the cloud reports for the window, for
   * the accounts read in full: read the stored sums, write the
   * differences.
   */
  public static async write(data: {
    target: CloudCostWriteTarget;
    window: { start: Date; end: Date };
    records: Array<CloudCostRecord>;
    // The accounts read in full (lower case): only theirs are corrected.
    accountsRead: Set<string>;
    now: Date;
  }): Promise<CloudCostWriteResult> {
    const readRecords: Array<CloudCostRecord> = data.records.filter(
      (record: CloudCostRecord): boolean => {
        return data.accountsRead.has(record.accountId.trim().toLowerCase());
      },
    );

    const { points, withoutAccount } = CloudCostWriter.toSeriesPoints({
      target: data.target,
      records: readRecords,
    });

    const cloudAccountIds: Array<string> = Array.from(data.accountsRead)
      .map((accountId: string): ObjectID | undefined => {
        return data.target.accountRows.get(accountId);
      })
      .filter((id: ObjectID | undefined): boolean => {
        return Boolean(id);
      })
      .map((id: ObjectID | undefined): string => {
        return id!.toString();
      });

    if (cloudAccountIds.length === 0) {
      return {
        seriesCount: 0,
        rowsWritten: 0,
        recordsWithoutAccount: withoutAccount,
      };
    }

    const stored: Array<CloudCostSeriesPoint> = CloudCostWriter.readStoredSums(
      await CloudCostWriter.query(
        CloudCostWriter.buildStoredSumsStatement({
          projectId: data.target.projectId,
          cloudAccountIds,
          window: data.window,
        }),
      ),
    );

    const deltas: Array<CloudCostSeriesPoint> = CloudCostWriter.computeDeltas({
      desired: points,
      stored,
      window: data.window,
    });

    if (deltas.length > 0) {
      /*
       * Acknowledged once flushed, not once buffered: the next read (a
       * "Read now", a read that continues a minute later) must find these
       * rows in the stored sums, or it would write them again.
       */
      await CloudCostService.insertJsonRows(
        CloudCostWriter.buildRows({
          target: data.target,
          deltas,
          now: data.now,
        }),
        { clickhouseSettings: { wait_for_async_insert: 1 } },
      );
    }

    return {
      seriesCount: points.length,
      rowsWritten: deltas.length,
      recordsWithoutAccount: withoutAccount,
    };
  }

  /*
   * The window an account's summary needs: from the start of last month
   * (or 30 days back, when that is earlier) through today.
   */
  public static getSummaryWindow(now: Date): { start: Date; end: Date } {
    const today: Date = startOfUtcDay(now);
    const lastMonthStart: Date = addUtcMonths(startOfUtcMonth(today), -1);
    const thirtyDaysBack: Date = addUtcDays(today, -29);

    return {
      start: thirtyDaysBack < lastMonthStart ? thirtyDaysBack : lastMonthStart,
      end: addUtcDays(today, 1),
    };
  }

  /*
   * Each account's summary from what is stored: its daily totals and this
   * month's cost by service, in the currency most of its rows are in - and
   * the spend of its last full days that ran far above its usual, a
   * service's or the account's (findCloudCostAnomalies).
   */
  public static async summarize(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<string>;
    now: Date;
  }): Promise<Map<string, CloudAccountCostSummary>> {
    const summaries: Map<string, CloudAccountCostSummary> = new Map();

    if (data.cloudAccountIds.length === 0) {
      return summaries;
    }

    const rows: Array<CloudCostSeriesPoint> = CloudCostWriter.readStoredSums(
      await CloudCostWriter.query(
        CloudCostWriter.buildStoredSumsStatement({
          projectId: data.projectId,
          cloudAccountIds: data.cloudAccountIds,
          window: CloudCostWriter.getSummaryWindow(data.now),
        }),
      ),
    );

    return CloudCostWriter.summarizePoints({
      points: rows,
      cloudAccountIds: data.cloudAccountIds,
      now: data.now,
    });
  }

  // The summaries from stored points: pure, so a test reads it without a store.
  public static summarizePoints(data: {
    points: Array<CloudCostSeriesPoint>;
    cloudAccountIds: Array<string>;
    now: Date;
  }): Map<string, CloudAccountCostSummary> {
    const summaries: Map<string, CloudAccountCostSummary> = new Map();
    const monthStartDay: string = toCloudCostDay(startOfUtcMonth(data.now));

    for (const cloudAccountId of data.cloudAccountIds) {
      const points: Array<CloudCostSeriesPoint> = data.points.filter(
        (point: CloudCostSeriesPoint): boolean => {
          return point.cloudAccountId === cloudAccountId;
        },
      );

      // The currency most of its cost is in: an account is billed in one.
      const byCurrency: Map<string, number> = new Map();

      for (const point of points) {
        byCurrency.set(
          point.currency,
          (byCurrency.get(point.currency) || 0) + Math.abs(point.amount),
        );
      }

      const currency: string =
        Array.from(byCurrency.entries()).sort(
          (a: [string, number], b: [string, number]): number => {
            return b[1] - a[1] || a[0].localeCompare(b[0]);
          },
        )[0]?.[0] || CLOUD_COST_DEFAULT_CURRENCY;

      const dailyTotals: Map<string, number> = new Map();
      const monthServices: Map<string, number> = new Map();
      // Each day's cost by service: what an unusual day is found in.
      const dailyServiceTotals: Map<string, Map<string, number>> = new Map();

      for (const point of points) {
        if (point.currency !== currency) {
          continue;
        }

        dailyTotals.set(
          point.day,
          (dailyTotals.get(point.day) || 0) + point.amount,
        );

        const services: Map<string, number> =
          dailyServiceTotals.get(point.day) || new Map();
        services.set(
          point.service,
          (services.get(point.service) || 0) + point.amount,
        );
        dailyServiceTotals.set(point.day, services);

        if (point.day >= monthStartDay) {
          monthServices.set(
            point.service,
            (monthServices.get(point.service) || 0) + point.amount,
          );
        }
      }

      const summary: CloudAccountCostSummary = summarizeCloudAccountCosts({
        dailyTotals,
        monthServices,
        currency,
        now: data.now,
      });
      const anomalies: Array<CloudCostAnomaly> = findCloudCostAnomalies({
        dailyServiceTotals,
        latestDay: summary.latestDay,
      });

      if (anomalies.length > 0) {
        summary.anomalies = anomalies;
      }

      summaries.set(cloudAccountId, summary);
    }

    return summaries;
  }
}
