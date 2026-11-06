import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import {
  CloudAccountCostSummary,
  CloudCostState,
} from "Common/Types/Cloud/CloudCost";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * WHAT THE CLOUD PAGES READ OF THE COSTS THEMSELVES.
 *
 * The headline figures - this month, its projection, last month - are on
 * each account's summary (CloudAccount.costSummary). What a page draws over
 * time or breaks down - each day's spend, the services, Regions, accounts
 * and resources that cost the most - is summed from the cost rows
 * (CloudCost) through /aggregate, in the window the page shows and in one
 * currency (a company's accounts are billed in one; an account billed in
 * another is left out and said so).
 *
 * Every read is a plain sum: the writer keeps a day's rows adding up to the
 * cloud's latest figure (CloudCostWriter).
 */

export interface CloudCostScope {
  projectId: ObjectID;
  // The accounts read (CloudAccount ids); every account when absent.
  cloudAccountIds?: Array<ObjectID> | undefined;
  // One resource's costs, by the key its cloud bills it under.
  resourceId?: string | undefined;
  currency: string;
  startDate: Date;
  endDate: Date;
}

export interface CloudCostPoint {
  x: Date;
  y: number;
}

export interface CloudCostShare {
  // The service, Region, account or resource.
  key: string;
  amount: number;
}

export type CloudCostDimension =
  | "service"
  | "region"
  | "cloudAccountId"
  | "resourceId";

function buildQuery(scope: CloudCostScope): Record<string, unknown> {
  const query: Record<string, unknown> = {
    projectId: scope.projectId,
    currency: scope.currency,
    day: new InBetween<Date>(scope.startDate, scope.endDate),
  };

  if (scope.cloudAccountIds && scope.cloudAccountIds.length > 0) {
    query["cloudAccountId"] =
      scope.cloudAccountIds.length === 1
        ? scope.cloudAccountIds[0]
        : new Includes(scope.cloudAccountIds);
  }

  if (scope.resourceId) {
    query["resourceId"] = scope.resourceId;
  }

  return query;
}

export function buildCloudCostAggregateBy(data: {
  scope: CloudCostScope;
  interval: AggregationInterval;
  groupBy?: GroupBy<CloudCost> | undefined;
}): AggregateBy<CloudCost> {
  const aggregateBy: AggregateBy<CloudCost> = {
    query: buildQuery(data.scope) as AggregateBy<CloudCost>["query"],
    aggregationType: AggregationType.Sum,
    aggregateColumnName: "cost",
    aggregationTimestampColumnName: "day",
    aggregationInterval: data.interval,
    startTimestamp: data.scope.startDate,
    endTimestamp: data.scope.endDate,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: { day: SortOrder.Ascending },
  };

  if (data.groupBy) {
    aggregateBy.groupBy = data.groupBy;
  }

  return aggregateBy;
}

/*
 * Each day's spend in the window, every day of it - a day with no cost is
 * a zero, so the bars keep their places.
 */
export function fillCloudCostDays(data: {
  points: Array<CloudCostPoint>;
  startDate: Date;
  endDate: Date;
}): Array<CloudCostPoint> {
  const byDay: Map<string, number> = new Map();

  for (const point of data.points) {
    const day: string = point.x.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + point.y);
  }

  const filled: Array<CloudCostPoint> = [];
  const start: Date = new Date(
    Date.UTC(
      data.startDate.getUTCFullYear(),
      data.startDate.getUTCMonth(),
      data.startDate.getUTCDate(),
    ),
  );

  for (
    let day: Date = start;
    day.getTime() <= data.endDate.getTime();
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const key: string = day.toISOString().slice(0, 10);
    filled.push({ x: day, y: byDay.get(key) || 0 });
  }

  return filled;
}

export async function fetchCloudCostTrend(
  scope: CloudCostScope,
): Promise<Array<CloudCostPoint>> {
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<CloudCost>(
    {
      modelType: CloudCost,
      aggregateBy: buildCloudCostAggregateBy({
        scope,
        interval: AggregationInterval.Day,
      }),
    },
  );

  return fillCloudCostDays({
    points: result.data.map((item: AggregatedModel): CloudCostPoint => {
      return { x: new Date(item.timestamp), y: Number(item.value) || 0 };
    }),
    startDate: scope.startDate,
    endDate: scope.endDate,
  });
}

/*
 * The window's spend by one dimension, most first: the services, Regions,
 * accounts or resources that cost the most. A dimension with no value (a
 * cost with no Region, a cost no resource is billed for) is one entry of
 * its own, "" - the page names it.
 */
export function toCloudCostShares(data: {
  rows: Array<Record<string, unknown>>;
  dimension: CloudCostDimension;
}): Array<CloudCostShare> {
  const totals: Map<string, number> = new Map();

  for (const row of data.rows) {
    const key: string = String(row[data.dimension] ?? "");
    const amount: number = Number(row["value"]) || 0;
    totals.set(key, (totals.get(key) || 0) + amount);
  }

  return Array.from(totals.entries())
    .map(([key, amount]: [string, number]): CloudCostShare => {
      return { key, amount };
    })
    .filter((share: CloudCostShare): boolean => {
      return Math.abs(share.amount) >= 0.005;
    })
    .sort((a: CloudCostShare, b: CloudCostShare): number => {
      return b.amount - a.amount || a.key.localeCompare(b.key);
    });
}

/*
 * The services that cost the most this month across accounts, from each
 * account's summary (its five most costly): summed by name, in one
 * currency, most first. A service that is not among an account's five is
 * left out of that account's share, so the list is the services that cost
 * the most, not every service's whole cost - the Costs page reads the
 * whole of it.
 */
export function mergeCloudTopServices(data: {
  summaries: Array<CloudAccountCostSummary | null>;
  currency: string;
  top: number;
}): Array<CloudCostShare> {
  const totals: Map<string, number> = new Map();

  for (const summary of data.summaries) {
    if (
      !summary ||
      summary.state !== CloudCostState.Reading ||
      summary.currency.toUpperCase() !== data.currency.toUpperCase()
    ) {
      continue;
    }

    for (const entry of summary.topServices) {
      totals.set(
        entry.service,
        (totals.get(entry.service) || 0) + entry.amount,
      );
    }
  }

  return Array.from(totals.entries())
    .map(([key, amount]: [string, number]): CloudCostShare => {
      return { key, amount };
    })
    .filter((share: CloudCostShare): boolean => {
      return share.amount >= 0.005;
    })
    .sort((a: CloudCostShare, b: CloudCostShare): number => {
      return b.amount - a.amount || a.key.localeCompare(b.key);
    })
    .slice(0, data.top);
}

export async function fetchCloudCostShares(data: {
  scope: CloudCostScope;
  dimension: CloudCostDimension;
}): Promise<Array<CloudCostShare>> {
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<CloudCost>(
    {
      modelType: CloudCost,
      aggregateBy: buildCloudCostAggregateBy({
        scope: data.scope,
        interval: AggregationInterval.Total,
        groupBy: { [data.dimension]: true } as GroupBy<CloudCost>,
      }),
    },
  );

  return toCloudCostShares({
    rows: result.data as unknown as Array<Record<string, unknown>>,
    dimension: data.dimension,
  });
}
