import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTagKey,
} from "Common/Types/Cloud/CloudCost";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  CLOUD_PLATFORM_ALL_BILLED_SERVICES,
  CloudPlatformCostApp,
  CloudPlatformCostEnvironment,
  CloudPlatformCostRow,
  CloudPlatformCostShares,
  CloudPlatformTaggedCostRow,
  ELASTIC_BEANSTALK_ENVIRONMENT_TAG,
  assignCloudCostsToApps,
  assignCloudCostsToEnvironments,
} from "Common/Types/Cloud/CloudPlatformCosts";
import { ManagedCloudPlatform } from "Common/Types/Cloud/CloudPlatform";
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
import Timezone from "Common/Types/Timezone";
import GroupBy from "Common/Server/Types/Database/GroupBy";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

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
 *
 * A breakdown by App Platforms environment or app sums the costs by
 * account, Region, service and resource, and finds whose they are
 * (CloudPlatformCosts); one by a tag sums them by the tag's value - each
 * cost keeps its tags (CloudCost.tags).
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

// The breakdowns that are a column of the costs.
export type CloudCostColumnDimension =
  | "service"
  | "region"
  | "cloudAccountId"
  | "resourceId";

/*
 * Every breakdown: a column, an App Platforms environment or app, or a
 * tag's value.
 */
export type CloudCostDimension =
  | CloudCostColumnDimension
  | "environment"
  | "app"
  | "tag";

export function isCloudCostColumnDimension(
  dimension: CloudCostDimension,
): dimension is CloudCostColumnDimension {
  return (
    dimension === "service" ||
    dimension === "region" ||
    dimension === "cloudAccountId" ||
    dimension === "resourceId"
  );
}

/*
 * What a breakdown by environment, app or tag leaves out of its list,
 * said under it: what is in no App Platforms environment, what an
 * environment is billed that is no one app's, or the costs without the tag.
 */
export type CloudCostRestKind =
  | "not-in-environment"
  | "not-one-app"
  | "without-tag";

export interface CloudCostRest {
  kind: CloudCostRestKind;
  amount: number;
}

export interface CloudCostBreakdownResult {
  // What the list shows, the costliest first.
  shares: Array<CloudCostShare>;
  // What it leaves out, each with what it came to.
  rest: Array<CloudCostRest>;
  // The period's spend: the shares and the rest.
  total: number;
}

// The App Platforms environments and apps a breakdown names.
export interface CloudCostPlatformLists {
  environments: Array<
    CloudPlatformCostEnvironment & { name: string; provider: string }
  >;
  apps: Array<CloudPlatformCostApp>;
}

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
    /*
     * A cloud bills by the UTC day (CloudCost.day is its start), so its days
     * stay UTC's in every reader's zone: the trend fills and names UTC days
     * (fillCloudCostDays, CloudDailySpendChart), not the reader's.
     */
    timezone: Timezone.UTC,
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
  dimension: CloudCostColumnDimension;
}): Array<CloudCostShare> {
  const totals: Map<string, number> = new Map();

  for (const row of data.rows) {
    const key: string = String(row[data.dimension] ?? "");
    const amount: number = Number(row["value"]) || 0;
    totals.set(key, (totals.get(key) || 0) + amount);
  }

  return sortCloudCostShares(
    Array.from(totals.entries()).map(
      ([key, amount]: [string, number]): CloudCostShare => {
        return { key, amount };
      },
    ),
  );
}

/*
 * Shares as a breakdown lists them: the costliest first, by key on a tie,
 * and none that rounds to nothing.
 */
export function sortCloudCostShares(
  shares: Array<CloudCostShare>,
): Array<CloudCostShare> {
  return shares
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

/*
 * The tags the accounts' costs carry, the costliest first: each account's
 * summary's, added up by key, in the page's currency.
 */
export function mergeCloudCostTagKeys(data: {
  summaries: Array<CloudAccountCostSummary | null>;
  currency: string;
}): Array<CloudCostTagKey> {
  const totals: Map<string, number> = new Map();

  for (const summary of data.summaries) {
    if (
      !summary ||
      summary.state !== CloudCostState.Reading ||
      summary.currency.toUpperCase() !== data.currency.toUpperCase()
    ) {
      continue;
    }

    for (const entry of summary.tagKeys || []) {
      totals.set(entry.key, (totals.get(entry.key) || 0) + entry.amount);
    }
  }

  return Array.from(totals.entries())
    .map(([key, amount]: [string, number]): CloudCostTagKey => {
      return { key, amount };
    })
    .sort((a: CloudCostTagKey, b: CloudCostTagKey): number => {
      return (
        b.amount - a.amount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      );
    });
}

// The costs of a window summed by some of their columns, in one currency.
export async function fetchCloudCostRows(data: {
  scope: CloudCostScope;
  groupBy: Array<keyof CloudCost>;
  // Only these services' costs, when given.
  services?: ReadonlyArray<string> | undefined;
}): Promise<Array<CloudPlatformCostRow>> {
  const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
    scope: data.scope,
    interval: AggregationInterval.Total,
    groupBy: Object.fromEntries(
      data.groupBy.map((column: keyof CloudCost) => {
        return [column, true];
      }),
    ) as GroupBy<CloudCost>,
  });

  if (data.services) {
    (aggregateBy.query as Record<string, unknown>)["service"] = new Includes([
      ...data.services,
    ]);
  }

  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<CloudCost>(
    { modelType: CloudCost, aggregateBy },
  );

  return (result.data as unknown as Array<Record<string, unknown>>).map(
    (row: Record<string, unknown>): CloudPlatformCostRow => {
      return {
        accountId: String(row["accountId"] ?? ""),
        region: String(row["region"] ?? ""),
        service: String(row["service"] ?? ""),
        resourceId: String(row["resourceId"] ?? ""),
        amount: Number(row["value"]) || 0,
      };
    },
  );
}

/*
 * The costs of a window summed by one tag's value - "" for the costs
 * without it - and, when asked, by account and Region too.
 */
export async function fetchCloudCostTagRows(data: {
  scope: CloudCostScope;
  tagKey: string;
  byPlace?: boolean | undefined;
}): Promise<Array<CloudPlatformTaggedCostRow>> {
  const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
    scope: data.scope,
    interval: AggregationInterval.Total,
    groupBy: data.byPlace
      ? ({ accountId: true, region: true } as GroupBy<CloudCost>)
      : undefined,
  });

  aggregateBy.groupByAttributeKeys = [data.tagKey];

  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<CloudCost>(
    { modelType: CloudCost, aggregateBy },
  );

  return (result.data as unknown as Array<Record<string, unknown>>).map(
    (row: Record<string, unknown>): CloudPlatformTaggedCostRow => {
      const attributes: Record<string, unknown> =
        row["attributes"] && typeof row["attributes"] === "object"
          ? (row["attributes"] as Record<string, unknown>)
          : {};

      return {
        accountId: String(row["accountId"] ?? ""),
        region: String(row["region"] ?? ""),
        value: String(attributes[data.tagKey] ?? ""),
        amount: Number(row["value"]) || 0,
      };
    },
  );
}

// The project's App Platforms environments and apps, as a breakdown names them.
export async function fetchCloudCostPlatformLists(): Promise<CloudCostPlatformLists> {
  const [environments, apps]: [
    ListResult<CloudResource>,
    ListResult<CloudApp>,
  ] = await Promise.all([
    ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: { cloudResourceKind: CloudResourceKind.Environment },
      select: {
        _id: true,
        name: true,
        cloudPlatform: true,
        cloudProvider: true,
        cloudAccountId: true,
        cloudRegion: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
    ModelAPI.getList<CloudApp>({
      modelType: CloudApp,
      query: {},
      select: {
        _id: true,
        name: true,
        cloudResourceId: true,
        groupName: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    }),
  ]);

  return {
    environments: environments.data
      .filter((environment: CloudResource): boolean => {
        return Boolean(environment._id && environment.cloudPlatform);
      })
      .map((environment: CloudResource) => {
        return {
          id: environment._id!.toString(),
          name: environment.name || "",
          platform: environment.cloudPlatform || "",
          provider: environment.cloudProvider || "",
          accountId: environment.cloudAccountId || "",
          region: environment.cloudRegion || "",
        };
      }),
    apps: apps.data
      .filter((app: CloudApp): boolean => {
        return Boolean(app._id && app.cloudResourceId);
      })
      .map((app: CloudApp): CloudPlatformCostApp => {
        return {
          id: app._id!.toString(),
          environmentId: app.cloudResourceId!.toString(),
          name: app.name || "",
          groupName: app.groupName || undefined,
        };
      }),
  };
}

// Whether any of the environments is an Elastic Beanstalk one: read by its tag.
function hasElasticBeanstalk(
  environments: Array<CloudPlatformCostEnvironment>,
): boolean {
  return environments.some(
    (environment: CloudPlatformCostEnvironment): boolean => {
      return environment.platform === ManagedCloudPlatform.AwsElasticBeanstalk;
    },
  );
}

function toShares(
  shares: Array<{ id: string; amount: number }>,
): Array<CloudCostShare> {
  return shares.map((share: { id: string; amount: number }): CloudCostShare => {
    return { key: share.id, amount: share.amount };
  });
}

/*
 * A window's spend broken down: by a column, by App Platforms environment
 * or app (with what no environment, or no one app, is billed), or by a
 * tag's value (with the costs that do not carry it). The shares and the
 * rest add up to the period's spend.
 */
export async function fetchCloudCostBreakdown(data: {
  scope: CloudCostScope;
  dimension: CloudCostDimension;
  // The tag, for a breakdown by tag.
  tagKey?: string | undefined;
  // The environments and apps, for a breakdown by either.
  lists?: CloudCostPlatformLists | undefined;
}): Promise<CloudCostBreakdownResult> {
  const sumOf: (shares: Array<{ amount: number }>) => number = (
    shares: Array<{ amount: number }>,
  ): number => {
    return shares.reduce((sum: number, share: { amount: number }): number => {
      return sum + share.amount;
    }, 0);
  };

  if (isCloudCostColumnDimension(data.dimension)) {
    const shares: Array<CloudCostShare> = await fetchCloudCostShares({
      scope: data.scope,
      dimension: data.dimension,
    });

    return { shares, rest: [], total: sumOf(shares) };
  }

  if (data.dimension === "tag") {
    const rows: Array<CloudPlatformTaggedCostRow> = data.tagKey
      ? await fetchCloudCostTagRows({ scope: data.scope, tagKey: data.tagKey })
      : [];
    const totals: Map<string, number> = new Map();

    for (const row of rows) {
      totals.set(row.value, (totals.get(row.value) || 0) + row.amount);
    }

    const without: number = totals.get("") || 0;
    totals.delete("");

    const shares: Array<CloudCostShare> = sortCloudCostShares(
      Array.from(totals.entries()).map(
        ([key, amount]: [string, number]): CloudCostShare => {
          return { key, amount };
        },
      ),
    );

    return {
      shares,
      rest:
        Math.abs(without) >= 0.005
          ? [{ kind: "without-tag", amount: without }]
          : [],
      total: sumOf(shares) + without,
    };
  }

  const lists: CloudCostPlatformLists = data.lists || {
    environments: [],
    apps: [],
  };
  const [rows, resourceRows, taggedRows]: [
    Array<CloudPlatformCostRow>,
    Array<CloudPlatformCostRow>,
    Array<CloudPlatformTaggedCostRow>,
  ] = await Promise.all([
    fetchCloudCostRows({
      scope: data.scope,
      groupBy: ["accountId", "region", "service"],
    }),
    data.dimension === "app"
      ? fetchCloudCostRows({
          scope: data.scope,
          groupBy: ["accountId", "region", "service", "resourceId"],
          services: CLOUD_PLATFORM_ALL_BILLED_SERVICES,
        })
      : Promise.resolve([]),
    hasElasticBeanstalk(lists.environments)
      ? fetchCloudCostTagRows({
          scope: data.scope,
          tagKey: ELASTIC_BEANSTALK_ENVIRONMENT_TAG,
          byPlace: true,
        })
      : Promise.resolve([]),
  ]);

  const assigned: CloudPlatformCostShares =
    data.dimension === "app"
      ? assignCloudCostsToApps({
          rows,
          resourceRows,
          taggedRows,
          environments: lists.environments,
          apps: lists.apps,
        })
      : assignCloudCostsToEnvironments({
          rows,
          taggedRows,
          environments: lists.environments,
        });
  const rest: Array<CloudCostRest> = [];

  if (Math.abs(assigned.notOneApp) >= 0.005) {
    rest.push({ kind: "not-one-app", amount: assigned.notOneApp });
  }

  if (Math.abs(assigned.other) >= 0.005) {
    rest.push({ kind: "not-in-environment", amount: assigned.other });
  }

  return {
    shares: toShares(assigned.shares),
    rest,
    total: assigned.total,
  };
}

export async function fetchCloudCostShares(data: {
  scope: CloudCostScope;
  dimension: CloudCostColumnDimension;
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
