import Includes from "../../../Types/BaseDatabase/Includes";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { findCloudCostAnomalies } from "../../../Types/Cloud/CloudCostAnomaly";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostTagKey,
  CLOUD_COST_DEFAULT_CURRENCY,
  addUtcDays,
  addUtcMonths,
  fromCloudCostDay,
  getCloudCostTagsKey,
  normalizeCloudCostTags,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeCloudAccountCosts,
  summarizeCloudCostTagKeys,
  toCloudCostBasisFigures,
  toCloudCostDay,
  CloudCostSummaryBases,
} from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_BASES,
  CloudCostBasis,
} from "../../../Types/Cloud/CloudCostBasis";
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
 *
 * A series is a day's cost of an account's service, in a Region, of a
 * resource, in a currency, with a set of tags: a resource tagged anew is,
 * from the next read of a day, a series of its new tags, and the old one
 * is taken back. And a figure that is the whole of its service and Region
 * on a day (isServiceTotal: an AWS day whose resources were not read this
 * time, while they are kept) leaves the resources' series as they are and
 * brings the rest - the series not billed to a resource - in line with it.
 *
 * Every series is kept on three bases (CloudCostBasis) - billed, amortized
 * and net - each its own column, each brought in line the same way, so a
 * day read ten times sums to the cloud's latest figure on all three. A
 * read that brought only some bases (an Azure subscription between its
 * daily reads of actual cost) brings only those in line: the others keep
 * what is stored.
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
  // The cost's tags, as normalizeCloudCostTags keeps them.
  tags: Record<string, string>;
  // Billed.
  amount: number;
  // Amortized and net; absent means the same as billed.
  amortizedAmount?: number | undefined;
  netAmount?: number | undefined;
  /*
   * The whole of its account, day, service, Region and currency, the
   * resources' series kept apart included (CloudCostRecord.isServiceTotal).
   */
  isServiceTotal?: boolean | undefined;
}

// A point's figure on a basis: its billed figure where it has none of its own.
export function getCloudCostPointAmount(
  point: {
    amount: number;
    amortizedAmount?: number | undefined;
    netAmount?: number | undefined;
  },
  basis: CloudCostBasis,
): number {
  if (basis === CloudCostBasis.Amortized) {
    return Number.isFinite(point.amortizedAmount)
      ? (point.amortizedAmount as number)
      : point.amount;
  }

  if (basis === CloudCostBasis.Net) {
    return Number.isFinite(point.netAmount)
      ? (point.netAmount as number)
      : point.amount;
  }

  return point.amount;
}

// A point's three figures, each in its own place: what is added up and compared.
interface CloudCostAmounts {
  amount: number;
  amortizedAmount: number;
  netAmount: number;
}

function amountsOf(point: {
  amount: number;
  amortizedAmount?: number | undefined;
  netAmount?: number | undefined;
}): CloudCostAmounts {
  return {
    amount: point.amount,
    amortizedAmount: getCloudCostPointAmount(point, CloudCostBasis.Amortized),
    netAmount: getCloudCostPointAmount(point, CloudCostBasis.Net),
  };
}

// One point's figures added to another's, in place.
function addAmounts(into: CloudCostAmounts, from: CloudCostAmounts): void {
  into.amount += from.amount;
  into.amortizedAmount += from.amortizedAmount;
  into.netAmount += from.netAmount;
}

const ZERO_AMOUNTS: Readonly<CloudCostAmounts> = {
  amount: 0,
  amortizedAmount: 0,
  netAmount: 0,
};

// Each basis's field on a point.
const BASIS_FIELDS: Readonly<Record<CloudCostBasis, keyof CloudCostAmounts>> = {
  [CloudCostBasis.Billed]: "amount",
  [CloudCostBasis.Amortized]: "amortizedAmount",
  [CloudCostBasis.Net]: "netAmount",
};

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
      getCloudCostTagsKey(point.tags || {}),
    ]);
  }

  /*
   * The figure a series belongs to: its account's row, day, service,
   * Region and currency - what a whole-service figure (isServiceTotal) is
   * the whole of.
   */
  public static serviceKey(point: CloudCostSeriesPoint): string {
    return JSON.stringify([
      point.cloudAccountId,
      point.day,
      point.service,
      point.region,
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

      const amounts: CloudCostAmounts = amountsOf(record);
      const point: CloudCostSeriesPoint = {
        cloudAccountId: accountRow.toString(),
        accountId: record.accountId.trim(),
        day: record.day,
        service: record.service,
        region: record.region,
        resourceId: record.isServiceTotal ? "" : record.resourceId,
        currency: record.currency || CLOUD_COST_DEFAULT_CURRENCY,
        tags: record.isServiceTotal ? {} : normalizeCloudCostTags(record.tags),
        ...amounts,
        ...(record.isServiceTotal ? { isServiceTotal: true } : {}),
      };
      const key: string = point.isServiceTotal
        ? `total:${CloudCostWriter.serviceKey(point)}`
        : CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = points.get(key);

      if (existing) {
        const sum: CloudCostAmounts = amountsOf(existing);
        addAmounts(sum, amounts);
        Object.assign(existing, sum);
      } else {
        points.set(key, point);
      }
    }

    return { points: Array.from(points.values()), withoutAccount };
  }

  /*
   * The rows to write so storage matches the cloud: for every day-series
   * the cloud reports or storage holds within the window, the cloud's
   * figure minus the stored sum, on each basis the read brought (every
   * basis unless told), where they differ. A basis the read did not bring
   * keeps what is stored: its difference is nothing.
   *
   * A whole-service figure is matched another way: its resources' series
   * stay as they are, and the series not billed to a resource ("" resource)
   * takes up the difference - so the figure's series add up to it.
   */
  public static computeDeltas(data: {
    desired: Array<CloudCostSeriesPoint>;
    stored: Array<CloudCostSeriesPoint>;
    window: { start: Date; end: Date };
    // The bases the read brought; every basis when absent.
    bases?: ReadonlyArray<CloudCostBasis> | undefined;
  }): Array<CloudCostSeriesPoint> {
    const startDay: string = toCloudCostDay(data.window.start);
    const endDay: string = toCloudCostDay(data.window.end);
    const inWindow: (point: CloudCostSeriesPoint) => boolean = (
      point: CloudCostSeriesPoint,
    ): boolean => {
      return point.day >= startDay && point.day < endDay;
    };
    const bases: ReadonlyArray<CloudCostBasis> =
      data.bases && data.bases.length > 0 ? data.bases : CLOUD_COST_BASES;

    const totals: Map<string, CloudCostSeriesPoint> = new Map();
    const desired: Map<string, CloudCostSeriesPoint> = new Map();

    for (const point of data.desired.filter(inWindow)) {
      const map: Map<string, CloudCostSeriesPoint> = point.isServiceTotal
        ? totals
        : desired;
      const key: string = point.isServiceTotal
        ? CloudCostWriter.serviceKey(point)
        : CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = map.get(key);

      if (existing) {
        const sum: CloudCostAmounts = amountsOf(existing);
        addAmounts(sum, amountsOf(point));
        Object.assign(existing, sum);
      } else {
        map.set(key, { ...point, ...amountsOf(point) });
      }
    }

    const stored: Map<string, CloudCostSeriesPoint> = new Map();
    // A whole-service figure's stored series: its resources' sums, and the rest's.
    const totalParts: Map<
      string,
      { resources: CloudCostAmounts; rest: CloudCostAmounts }
    > = new Map();

    for (const point of data.stored.filter(inWindow)) {
      const serviceKey: string = CloudCostWriter.serviceKey(point);

      if (totals.has(serviceKey)) {
        const parts: { resources: CloudCostAmounts; rest: CloudCostAmounts } =
          totalParts.get(serviceKey) || {
            resources: { ...ZERO_AMOUNTS },
            rest: { ...ZERO_AMOUNTS },
          };

        addAmounts(
          point.resourceId ? parts.resources : parts.rest,
          amountsOf(point),
        );

        totalParts.set(serviceKey, parts);
        continue;
      }

      const key: string = CloudCostWriter.seriesKey(point);
      const existing: CloudCostSeriesPoint | undefined = stored.get(key);

      if (existing) {
        const sum: CloudCostAmounts = amountsOf(existing);
        addAmounts(sum, amountsOf(point));
        Object.assign(existing, sum);
      } else {
        stored.set(key, { ...point, ...amountsOf(point) });
      }
    }

    // The difference on each basis read, nothing on the others.
    const differenceOf: (
      want: CloudCostAmounts,
      have: CloudCostAmounts,
    ) => CloudCostAmounts | null = (
      want: CloudCostAmounts,
      have: CloudCostAmounts,
    ): CloudCostAmounts | null => {
      const delta: CloudCostAmounts = { ...ZERO_AMOUNTS };
      let changed: boolean = false;

      for (const basis of bases) {
        const field: keyof CloudCostAmounts = BASIS_FIELDS[basis];
        const difference: number = want[field] - have[field];

        if (Math.abs(difference) >= COST_EPSILON) {
          delta[field] = difference;
          changed = true;
        }
      }

      return changed ? delta : null;
    };

    const deltas: Array<CloudCostSeriesPoint> = [];
    const keys: Set<string> = new Set<string>([
      ...Array.from(desired.keys()),
      ...Array.from(stored.keys()),
    ]);

    for (const key of keys) {
      const want: CloudCostSeriesPoint | undefined = desired.get(key);
      const have: CloudCostSeriesPoint | undefined = stored.get(key);
      const template: CloudCostSeriesPoint = (want || have)!;
      const delta: CloudCostAmounts | null = differenceOf(
        want ? amountsOf(want) : ZERO_AMOUNTS,
        have ? amountsOf(have) : ZERO_AMOUNTS,
      );

      if (delta) {
        deltas.push(CloudCostWriter.seriesPoint(template, delta));
      }
    }

    for (const [serviceKey, total] of totals) {
      const parts: { resources: CloudCostAmounts; rest: CloudCostAmounts } =
        totalParts.get(serviceKey) || {
          resources: { ...ZERO_AMOUNTS },
          rest: { ...ZERO_AMOUNTS },
        };
      const kept: CloudCostAmounts = { ...parts.resources };
      addAmounts(kept, parts.rest);

      const delta: CloudCostAmounts | null = differenceOf(
        amountsOf(total),
        kept,
      );

      if (delta) {
        // The rest: the series of the figure not billed to a resource.
        deltas.push(
          CloudCostWriter.seriesPoint(
            { ...total, resourceId: "", tags: {} },
            delta,
          ),
        );
      }
    }

    return deltas;
  }

  // A series' point with amounts: never a whole-service figure.
  private static seriesPoint(
    template: CloudCostSeriesPoint,
    amounts: CloudCostAmounts,
  ): CloudCostSeriesPoint {
    return {
      cloudAccountId: template.cloudAccountId,
      accountId: template.accountId,
      day: template.day,
      service: template.service,
      region: template.region,
      resourceId: template.resourceId,
      currency: template.currency,
      tags: template.tags,
      amount: amounts.amount,
      amortizedAmount: amounts.amortizedAmount,
      netAmount: amounts.netAmount,
    };
  }

  /*
   * The stored sums of some accounts' series over a window: one row per
   * account, day and series, with its sum on each basis.
   */
  public static buildStoredSumsStatement(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<string>;
    window: { start: Date; end: Date };
  }): Statement {
    const statement: Statement = SQL`SELECT toString(cloudAccountId) AS accountRowId, any(accountId) AS cloudAccountName, toString(toDate(day, 'UTC')) AS dayText, service AS serviceName, region AS regionName, resourceId AS resourceKey, currency AS currencyCode, tags AS tagMap, sum(cost) AS total, sum(amortizedCost) AS amortizedTotal, sum(netCost) AS netTotal FROM ${COST_TABLE} WHERE projectId = ${{
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
    }} GROUP BY accountRowId, dayText, serviceName, regionName, resourceKey, currencyCode, tagMap`;

    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  // A stored row's tags, as the map comes back: an object of text, or none.
  public static readTagMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return normalizeCloudCostTags(value as Record<string, unknown>);
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

      // A sum the query did not give is the billed one, as the column's DEFAULT is.
      const amortizedTotal: number = Number(row["amortizedTotal"] ?? total);
      const netTotal: number = Number(row["netTotal"] ?? total);

      points.push({
        cloudAccountId: String(row["accountRowId"] || ""),
        accountId: String(row["cloudAccountName"] || ""),
        day,
        service: String(row["serviceName"] ?? ""),
        region: String(row["regionName"] ?? ""),
        resourceId: String(row["resourceKey"] ?? ""),
        currency: String(row["currencyCode"] || CLOUD_COST_DEFAULT_CURRENCY),
        tags: CloudCostWriter.readTagMap(row["tagMap"]),
        amount: total,
        amortizedAmount: Number.isFinite(amortizedTotal)
          ? amortizedTotal
          : total,
        netAmount: Number.isFinite(netTotal) ? netTotal : total,
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
      const tags: Record<string, string> = normalizeCloudCostTags(delta.tags);

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
        amortizedCost: getCloudCostPointAmount(delta, CloudCostBasis.Amortized),
        netCost: getCloudCostPointAmount(delta, CloudCostBasis.Net),
        currency: delta.currency,
        tags,
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
    // The bases the read brought for them; every basis when absent.
    bases?: ReadonlyArray<CloudCostBasis> | undefined;
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
      bases: data.bases,
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

  /*
   * The summaries from stored points: pure, so a test reads it without a
   * store. Each account's figures on the billed basis, and on the
   * amortized and net ones beside them (bases) - its unusual days found on
   * each: a commitment bought up front is an unusual day billed, and an
   * ordinary one amortized.
   */
  public static summarizePoints(data: {
    points: Array<CloudCostSeriesPoint>;
    cloudAccountIds: Array<string>;
    now: Date;
  }): Map<string, CloudAccountCostSummary> {
    const summaries: Map<string, CloudAccountCostSummary> = new Map();
    const thirtyDaysBack: string = toCloudCostDay(addUtcDays(data.now, -29));

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
      const inCurrency: Array<CloudCostSeriesPoint> = points.filter(
        (point: CloudCostSeriesPoint): boolean => {
          return point.currency === currency;
        },
      );

      const summary: CloudAccountCostSummary = CloudCostWriter.summarizeBasis({
        points: inCurrency,
        basis: CloudCostBasis.Billed,
        currency,
        now: data.now,
      });

      // The tags its last 30 days' costs carry: what Costs breaks them down by.
      const tagKeys: Array<CloudCostTagKey> = summarizeCloudCostTagKeys(
        inCurrency.filter((point: CloudCostSeriesPoint): boolean => {
          return point.day >= thirtyDaysBack;
        }),
      );

      if (tagKeys.length > 0) {
        summary.tagKeys = tagKeys;
      }

      const bases: CloudCostSummaryBases = {};

      for (const basis of [CloudCostBasis.Amortized, CloudCostBasis.Net] as [
        CloudCostBasis.Amortized,
        CloudCostBasis.Net,
      ]) {
        bases[basis] = toCloudCostBasisFigures(
          CloudCostWriter.summarizeBasis({
            points: inCurrency,
            basis,
            currency,
            now: data.now,
          }),
        );
      }

      summary.bases = bases;
      summaries.set(cloudAccountId, summary);
    }

    return summaries;
  }

  /*
   * An account's summary on one basis, from its points in its currency: its
   * days, this month's services and its unusual days, each on that basis.
   */
  public static summarizeBasis(data: {
    points: Array<CloudCostSeriesPoint>;
    basis: CloudCostBasis;
    currency: string;
    now: Date;
  }): CloudAccountCostSummary {
    const monthStartDay: string = toCloudCostDay(startOfUtcMonth(data.now));
    const dailyTotals: Map<string, number> = new Map();
    const monthServices: Map<string, number> = new Map();
    // Each day's cost by service: what an unusual day is found in.
    const dailyServiceTotals: Map<string, Map<string, number>> = new Map();

    for (const point of data.points) {
      const amount: number = getCloudCostPointAmount(point, data.basis);

      dailyTotals.set(point.day, (dailyTotals.get(point.day) || 0) + amount);

      const services: Map<string, number> =
        dailyServiceTotals.get(point.day) || new Map();
      services.set(point.service, (services.get(point.service) || 0) + amount);
      dailyServiceTotals.set(point.day, services);

      if (point.day >= monthStartDay) {
        monthServices.set(
          point.service,
          (monthServices.get(point.service) || 0) + amount,
        );
      }
    }

    const summary: CloudAccountCostSummary = summarizeCloudAccountCosts({
      dailyTotals,
      monthServices,
      currency: data.currency,
      now: data.now,
    });
    const anomalies: Array<CloudCostAnomaly> = findCloudCostAnomalies({
      dailyServiceTotals,
      latestDay: summary.latestDay,
    });

    if (anomalies.length > 0) {
      summary.anomalies = anomalies;
    }

    return summary;
  }
}
