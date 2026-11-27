import CloudCost from "../../Models/AnalyticsModels/CloudCost";
import GroupBy from "../../Server/Types/Database/GroupBy";
import AggregateBy from "../BaseDatabase/AggregateBy";
import AggregatedModel from "../BaseDatabase/AggregatedModel";
import AggregatedResult from "../BaseDatabase/AggregatedResult";
import AggregationInterval from "../BaseDatabase/AggregationInterval";
import AggregationType from "../BaseDatabase/AggregationType";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import SortOrder from "../BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../Database/LimitMax";
import ObjectID from "../ObjectID";
import Timezone from "../Timezone";
import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTagKey,
} from "./CloudCost";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
} from "./CloudCostAllocation";
import { CloudCostBasis, getCloudCostBasisColumn } from "./CloudCostBasis";
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
} from "./CloudPlatformCosts";
import { ManagedCloudPlatform } from "./CloudPlatform";

/*
 * WHERE THE MONEY GOES, WORKED OUT ONCE FOR EVERY READER (#11009).
 *
 * Cloud > Costs breaks a period's spend down by service, Region, account
 * or resource, by App Platforms environment or app, by a tag's value or by
 * a cost view's groups. The same breakdowns answer the API
 * (POST /cloud-cost/breakdown) and the CLI (oneuptime cloud-cost
 * breakdown), make up a scheduled report (CloudCostReportBuilder) and draw
 * the Dashboards' Cloud Cost widget - so a report's figures and the page's
 * are the same sums of the same rows, by construction.
 *
 * Each reader hands in how it reads (CloudCostBreakdownReader): the
 * Dashboard through /aggregate and the allocation route, as the person
 * signed in; the server through CloudCostService and CloudCostAllocation,
 * with the props of whoever the figures are for. Every read is a plain sum:
 * the writer keeps a day's rows adding up to the cloud's latest figure
 * (CloudCostWriter), in one currency - an account billed in another is
 * left out, and said so where the figures are shown.
 *
 * React-free and server-safe.
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
  /*
   * The cost basis the figures are on (CloudCostBasis): each is its own
   * column of the costs. Billed when absent.
   */
  basis?: CloudCostBasis | undefined;
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
  | "tag"
  // A cost view's groups (CloudCostView): read through its allocation.
  | "group";

export const CLOUD_COST_DIMENSIONS: ReadonlyArray<CloudCostDimension> = [
  "service",
  "region",
  "cloudAccountId",
  "resourceId",
  "environment",
  "app",
  "tag",
  "group",
];

export function isCloudCostDimension(
  value: unknown,
): value is CloudCostDimension {
  return (
    typeof value === "string" &&
    (CLOUD_COST_DIMENSIONS as ReadonlyArray<string>).includes(value)
  );
}

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
  | "without-tag"
  // A cost view's unallocated spend: what no group's rules match.
  | "not-in-group";

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
  // By cost group: each group as the view's allocation read it.
  groups?: Array<CloudCostAllocationGroupResult> | undefined;
  // By cost group: the view's name.
  viewName?: string | undefined;
}

// The App Platforms environments and apps a breakdown names.
export interface CloudCostPlatformLists {
  environments: Array<
    CloudPlatformCostEnvironment & { name: string; provider: string }
  >;
  apps: Array<CloudPlatformCostApp>;
}

/*
 * How a breakdown reads: the costs' sums through the analytics aggregate,
 * a cost view's allocation, and the project's App Platforms environments
 * and apps - each as whoever the figures are for may read them.
 */
export interface CloudCostBreakdownReader {
  aggregate: (aggregateBy: AggregateBy<CloudCost>) => Promise<AggregatedResult>;
  readAllocation: (data: {
    viewId: ObjectID;
    startDate: Date;
    endDate: Date;
    currency: string;
    basis?: CloudCostBasis | undefined;
    cloudAccountIds?: Array<ObjectID> | undefined;
  }) => Promise<CloudCostAllocationResult>;
  readPlatformLists: () => Promise<CloudCostPlatformLists>;
}

// The smallest amount a list shows: anything less rounds to nothing.
export const CLOUD_COST_SHARE_MIN: number = 0.005;

/*
 * The project's App Platforms environments (CloudResource of kind
 * Environment) and apps (CloudApp), as a breakdown names them: an
 * environment without a platform, or an app without its environment, names
 * nothing a cost could be assigned to.
 */
export function toCloudCostPlatformLists(data: {
  environments: Array<{
    _id?: unknown;
    name?: string | undefined;
    cloudPlatform?: string | undefined;
    cloudProvider?: string | undefined;
    cloudAccountId?: string | undefined;
    cloudRegion?: string | undefined;
  }>;
  apps: Array<{
    _id?: unknown;
    name?: string | undefined;
    cloudResourceId?: { toString: () => string } | undefined;
    groupName?: string | undefined;
  }>;
}): CloudCostPlatformLists {
  return {
    environments: data.environments
      .filter(
        (environment: {
          _id?: unknown;
          cloudPlatform?: string | undefined;
        }): boolean => {
          return Boolean(environment._id && environment.cloudPlatform);
        },
      )
      .map(
        (environment: {
          _id?: unknown;
          name?: string | undefined;
          cloudPlatform?: string | undefined;
          cloudProvider?: string | undefined;
          cloudAccountId?: string | undefined;
          cloudRegion?: string | undefined;
        }) => {
          return {
            id: String(environment._id),
            name: environment.name || "",
            platform: environment.cloudPlatform || "",
            provider: environment.cloudProvider || "",
            accountId: environment.cloudAccountId || "",
            region: environment.cloudRegion || "",
          };
        },
      ),
    apps: data.apps
      .filter(
        (app: {
          _id?: unknown;
          cloudResourceId?: { toString: () => string } | undefined;
        }): boolean => {
          return Boolean(app._id && app.cloudResourceId);
        },
      )
      .map(
        (app: {
          _id?: unknown;
          name?: string | undefined;
          cloudResourceId?: { toString: () => string } | undefined;
          groupName?: string | undefined;
        }): CloudPlatformCostApp => {
          return {
            id: String(app._id),
            environmentId: app.cloudResourceId!.toString(),
            name: app.name || "",
            groupName: app.groupName || undefined,
          };
        },
      ),
  };
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
    // The column of the basis shown: cost, amortizedCost or netCost.
    aggregateColumnName: getCloudCostBasisColumn(data.scope.basis),
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

// Each day's spend in the window, every day of it.
export async function readCloudCostTrend(
  reader: CloudCostBreakdownReader,
  scope: CloudCostScope,
): Promise<Array<CloudCostPoint>> {
  const result: AggregatedResult = await reader.aggregate(
    buildCloudCostAggregateBy({
      scope,
      interval: AggregationInterval.Day,
    }),
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
      return Math.abs(share.amount) >= CLOUD_COST_SHARE_MIN;
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
      return share.amount >= CLOUD_COST_SHARE_MIN;
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
export async function readCloudCostRows(
  reader: CloudCostBreakdownReader,
  data: {
    scope: CloudCostScope;
    groupBy: Array<keyof CloudCost>;
    // Only these services' costs, when given.
    services?: ReadonlyArray<string> | undefined;
  },
): Promise<Array<CloudPlatformCostRow>> {
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

  const result: AggregatedResult = await reader.aggregate(aggregateBy);

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
export async function readCloudCostTagRows(
  reader: CloudCostBreakdownReader,
  data: {
    scope: CloudCostScope;
    tagKey: string;
    byPlace?: boolean | undefined;
  },
): Promise<Array<CloudPlatformTaggedCostRow>> {
  const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
    scope: data.scope,
    interval: AggregationInterval.Total,
    groupBy: data.byPlace
      ? ({ accountId: true, region: true } as GroupBy<CloudCost>)
      : undefined,
  });

  aggregateBy.groupByAttributeKeys = [data.tagKey];

  const result: AggregatedResult = await reader.aggregate(aggregateBy);

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

export async function readCloudCostShares(
  reader: CloudCostBreakdownReader,
  data: {
    scope: CloudCostScope;
    dimension: CloudCostColumnDimension;
  },
): Promise<Array<CloudCostShare>> {
  const result: AggregatedResult = await reader.aggregate(
    buildCloudCostAggregateBy({
      scope: data.scope,
      interval: AggregationInterval.Total,
      groupBy: { [data.dimension]: true } as GroupBy<CloudCost>,
    }),
  );

  return toCloudCostShares({
    rows: result.data as unknown as Array<Record<string, unknown>>,
    dimension: data.dimension,
  });
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

function sumOf(shares: Array<{ amount: number }>): number {
  return shares.reduce((sum: number, share: { amount: number }): number => {
    return sum + share.amount;
  }, 0);
}

/*
 * A window's spend broken down: by a column, by App Platforms environment
 * or app (with what no environment, or no one app, is billed), by a tag's
 * value (with the costs that do not carry it), or by a cost view's groups
 * (with what no group takes). The shares and the rest add up to the
 * period's spend.
 */
export async function readCloudCostBreakdown(
  reader: CloudCostBreakdownReader,
  data: {
    scope: CloudCostScope;
    dimension: CloudCostDimension;
    // The tag, for a breakdown by tag.
    tagKey?: string | undefined;
    // The environments and apps, for a breakdown by either: read when absent.
    lists?: CloudCostPlatformLists | undefined;
    // The cost view, for a breakdown by its groups.
    viewId?: ObjectID | undefined;
  },
): Promise<CloudCostBreakdownResult> {
  /*
   * By cost group: what the view's allocation charged each group - its
   * share of shared groups included, so a shared group that split all its
   * costs away is left out - and what no group takes, said under the list.
   */
  if (data.dimension === "group") {
    if (!data.viewId) {
      return { shares: [], rest: [], total: 0, groups: [] };
    }

    const allocation: CloudCostAllocationResult = await reader.readAllocation({
      viewId: data.viewId,
      startDate: data.scope.startDate,
      endDate: data.scope.endDate,
      currency: data.scope.currency,
      // Each group's spend on the basis shown, as every other breakdown is.
      basis: data.scope.basis,
      cloudAccountIds: data.scope.cloudAccountIds,
    });

    return toCloudCostGroupBreakdown(allocation);
  }

  if (isCloudCostColumnDimension(data.dimension)) {
    const shares: Array<CloudCostShare> = await readCloudCostShares(reader, {
      scope: data.scope,
      dimension: data.dimension,
    });

    return { shares, rest: [], total: sumOf(shares) };
  }

  if (data.dimension === "tag") {
    const rows: Array<CloudPlatformTaggedCostRow> = data.tagKey
      ? await readCloudCostTagRows(reader, {
          scope: data.scope,
          tagKey: data.tagKey,
        })
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
        Math.abs(without) >= CLOUD_COST_SHARE_MIN
          ? [{ kind: "without-tag", amount: without }]
          : [],
      total: sumOf(shares) + without,
    };
  }

  const lists: CloudCostPlatformLists =
    data.lists || (await reader.readPlatformLists());
  const [rows, resourceRows, taggedRows]: [
    Array<CloudPlatformCostRow>,
    Array<CloudPlatformCostRow>,
    Array<CloudPlatformTaggedCostRow>,
  ] = await Promise.all([
    readCloudCostRows(reader, {
      scope: data.scope,
      groupBy: ["accountId", "region", "service"],
    }),
    data.dimension === "app"
      ? readCloudCostRows(reader, {
          scope: data.scope,
          groupBy: ["accountId", "region", "service", "resourceId"],
          services: CLOUD_PLATFORM_ALL_BILLED_SERVICES,
        })
      : Promise.resolve([]),
    hasElasticBeanstalk(lists.environments)
      ? readCloudCostTagRows(reader, {
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

  if (Math.abs(assigned.notOneApp) >= CLOUD_COST_SHARE_MIN) {
    rest.push({ kind: "not-one-app", amount: assigned.notOneApp });
  }

  if (Math.abs(assigned.other) >= CLOUD_COST_SHARE_MIN) {
    rest.push({ kind: "not-in-environment", amount: assigned.other });
  }

  return {
    shares: toShares(assigned.shares),
    rest,
    total: assigned.total,
  };
}

/*
 * A cost view's allocation as a breakdown by its groups: each group's
 * charge, the costliest first, and the unallocated spend said under them.
 */
export function toCloudCostGroupBreakdown(
  allocation: CloudCostAllocationResult,
): CloudCostBreakdownResult {
  return {
    shares: sortCloudCostShares(
      allocation.groups.map(
        (group: CloudCostAllocationGroupResult): CloudCostShare => {
          return { key: group.id, amount: group.total };
        },
      ),
    ),
    rest:
      Math.abs(allocation.unallocated.total) >= CLOUD_COST_SHARE_MIN
        ? [{ kind: "not-in-group", amount: allocation.unallocated.total }]
        : [],
    total: allocation.total,
    groups: allocation.groups,
    viewName: allocation.viewName,
  };
}

/*
 * ---------------------------------------------------------------------------
 * A breakdown against the period before
 * ---------------------------------------------------------------------------
 *
 * The API, the CLI and a report's movers compare a period with the one
 * before it. Each share keeps its amount in both: a service that cost
 * nothing before is new (previousAmount 0), one that cost nothing now is
 * gone (amount 0) - and both are listed, so a finance system pulling two
 * months sees every line in each.
 */

export interface CloudCostComparedShare extends CloudCostShare {
  previousAmount: number;
}

export interface CloudCostComparedRest extends CloudCostRest {
  previousAmount: number;
}

export interface CloudCostBreakdownComparison {
  shares: Array<CloudCostComparedShare>;
  rest: Array<CloudCostComparedRest>;
  total: number;
  previousTotal: number;
  groups?: Array<CloudCostAllocationGroupResult> | undefined;
  viewName?: string | undefined;
}

/*
 * Two breakdowns of the same dimension as one: every key either period
 * has, the costliest now first (then the costliest before), by key on a
 * tie.
 */
export function compareCloudCostBreakdowns(data: {
  current: CloudCostBreakdownResult;
  previous: CloudCostBreakdownResult;
}): CloudCostBreakdownComparison {
  const byKey: Map<string, CloudCostComparedShare> = new Map();

  for (const share of data.current.shares) {
    byKey.set(share.key, { ...share, previousAmount: 0 });
  }

  for (const share of data.previous.shares) {
    const known: CloudCostComparedShare | undefined = byKey.get(share.key);

    if (known) {
      known.previousAmount = share.amount;
    } else {
      byKey.set(share.key, {
        key: share.key,
        amount: 0,
        previousAmount: share.amount,
      });
    }
  }

  const restByKind: Map<CloudCostRestKind, CloudCostComparedRest> = new Map();

  for (const rest of data.current.rest) {
    restByKind.set(rest.kind, { ...rest, previousAmount: 0 });
  }

  for (const rest of data.previous.rest) {
    const known: CloudCostComparedRest | undefined = restByKind.get(rest.kind);

    if (known) {
      known.previousAmount = rest.amount;
    } else {
      restByKind.set(rest.kind, {
        kind: rest.kind,
        amount: 0,
        previousAmount: rest.amount,
      });
    }
  }

  return {
    shares: Array.from(byKey.values()).sort(
      (a: CloudCostComparedShare, b: CloudCostComparedShare): number => {
        return (
          b.amount - a.amount ||
          b.previousAmount - a.previousAmount ||
          a.key.localeCompare(b.key)
        );
      },
    ),
    rest: Array.from(restByKind.values()),
    total: data.current.total,
    previousTotal: data.previous.total,
    groups: data.current.groups,
    viewName: data.current.viewName,
  };
}

/*
 * The shares that moved the most between the two periods, by how much -
 * the rises first, then the falls - each at least `minimum` (in the
 * breakdown's currency) and at most `count` of each.
 */
export function getCloudCostMovers(data: {
  comparison: CloudCostBreakdownComparison;
  count: number;
  minimum?: number | undefined;
}): {
  rises: Array<CloudCostComparedShare>;
  falls: Array<CloudCostComparedShare>;
} {
  const minimum: number = Math.max(CLOUD_COST_SHARE_MIN, data.minimum || 0);
  const change: (share: CloudCostComparedShare) => number = (
    share: CloudCostComparedShare,
  ): number => {
    return share.amount - share.previousAmount;
  };

  const rises: Array<CloudCostComparedShare> = data.comparison.shares
    .filter((share: CloudCostComparedShare): boolean => {
      return change(share) >= minimum;
    })
    .sort((a: CloudCostComparedShare, b: CloudCostComparedShare): number => {
      return change(b) - change(a) || a.key.localeCompare(b.key);
    })
    .slice(0, data.count);

  const falls: Array<CloudCostComparedShare> = data.comparison.shares
    .filter((share: CloudCostComparedShare): boolean => {
      return -change(share) >= minimum;
    })
    .sort((a: CloudCostComparedShare, b: CloudCostComparedShare): number => {
      return change(a) - change(b) || a.key.localeCompare(b.key);
    })
    .slice(0, data.count);

  return { rises, falls };
}

/*
 * A breakdown of a window and of the window before, as one: what the API,
 * the CLI and the reports answer. A breakdown by cost group reads the
 * view's allocation once - it answers both windows - and every other reads
 * each window as the page reads one.
 */
export async function readCloudCostBreakdownComparison(
  reader: CloudCostBreakdownReader,
  data: {
    scope: CloudCostScope;
    previousStartDate: Date;
    previousEndDate: Date;
    dimension: CloudCostDimension;
    tagKey?: string | undefined;
    viewId?: ObjectID | undefined;
  },
): Promise<CloudCostBreakdownComparison> {
  if (data.dimension === "group") {
    if (!data.viewId) {
      return { shares: [], rest: [], total: 0, previousTotal: 0, groups: [] };
    }

    const allocation: CloudCostAllocationResult = await reader.readAllocation({
      viewId: data.viewId,
      startDate: data.scope.startDate,
      endDate: data.scope.endDate,
      currency: data.scope.currency,
      basis: data.scope.basis,
      cloudAccountIds: data.scope.cloudAccountIds,
    });

    return toCloudCostGroupComparison(allocation);
  }

  const lists: CloudCostPlatformLists | undefined =
    data.dimension === "environment" || data.dimension === "app"
      ? await reader.readPlatformLists()
      : undefined;

  const [current, previous]: [
    CloudCostBreakdownResult,
    CloudCostBreakdownResult,
  ] = await Promise.all([
    readCloudCostBreakdown(reader, {
      scope: data.scope,
      dimension: data.dimension,
      tagKey: data.tagKey,
      lists,
    }),
    readCloudCostBreakdown(reader, {
      scope: {
        ...data.scope,
        startDate: data.previousStartDate,
        endDate: data.previousEndDate,
      },
      dimension: data.dimension,
      tagKey: data.tagKey,
      lists,
    }),
  ]);

  return compareCloudCostBreakdowns({ current, previous });
}

/*
 * A cost view's allocation (read with the period before) as a comparison
 * by group: each group's charge in both, and the unallocated spend.
 */
export function toCloudCostGroupComparison(
  allocation: CloudCostAllocationResult,
): CloudCostBreakdownComparison {
  const shares: Array<CloudCostComparedShare> = allocation.groups
    .map((group: CloudCostAllocationGroupResult): CloudCostComparedShare => {
      return {
        key: group.id,
        amount: group.total,
        previousAmount: group.previousTotal || 0,
      };
    })
    .filter((share: CloudCostComparedShare): boolean => {
      return (
        Math.abs(share.amount) >= CLOUD_COST_SHARE_MIN ||
        Math.abs(share.previousAmount) >= CLOUD_COST_SHARE_MIN
      );
    })
    .sort((a: CloudCostComparedShare, b: CloudCostComparedShare): number => {
      return (
        b.amount - a.amount ||
        b.previousAmount - a.previousAmount ||
        a.key.localeCompare(b.key)
      );
    });
  const unallocated: number = allocation.unallocated.total;
  const previousUnallocated: number = allocation.unallocated.previousTotal || 0;

  return {
    shares,
    rest:
      Math.abs(unallocated) >= CLOUD_COST_SHARE_MIN ||
      Math.abs(previousUnallocated) >= CLOUD_COST_SHARE_MIN
        ? [
            {
              kind: "not-in-group",
              amount: unallocated,
              previousAmount: previousUnallocated,
            },
          ]
        : [],
    total: allocation.total,
    previousTotal: allocation.previousTotal || 0,
    groups: allocation.groups,
    viewName: allocation.viewName,
  };
}
