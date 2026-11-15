import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  addUtcDays,
  getCloudCostResourceKey,
  startOfUtcDay,
} from "Common/Types/Cloud/CloudCost";
import {
  CLOUD_RIGHT_SIZING_WINDOW_DAYS,
  CloudResourceDailyCost,
  CloudRightSizingProfile,
  CloudUsageObservation,
} from "Common/Types/Cloud/CloudRightSizing";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * WHAT A RESOURCE'S OVERVIEW READS TO SIZE IT.
 *
 * The last 14 days of OneUptime's own readings of the resource's CPU and
 * memory - the CPU's 95th percentile, its highest reading and how many
 * there are, and memory's peak, each one figure over the window - and,
 * when its cloud bills it by name, what it cost a day over the days billed
 * in the last 30. The same readings the server sizes it from each day
 * (CloudRightSizingWriter), here for the one resource on the page, so its
 * Overview says how it is sized now. React-free: App tests read it too.
 */

// The days a resource's daily cost is taken from.
export const RIGHT_SIZING_COST_DAYS: number = 30;

const HOUR_MS: number = 60 * 60 * 1000;

function nameQuery(names: Array<string>): string | Includes {
  return names.length === 1 ? names[0]! : new Includes(names);
}

async function readTotal(data: {
  projectId: ObjectID;
  names: Array<string>;
  attributeFilters: Record<string, string>;
  aggregationType: AggregationType;
  start: Date;
  end: Date;
}): Promise<AggregatedModel | null> {
  const result: AggregatedResult = await AnalyticsModelAPI.aggregate({
    modelType: Metric,
    aggregateBy: {
      query: {
        projectId: data.projectId,
        name: nameQuery(data.names),
        time: new InBetween<Date>(data.start, data.end),
        attributes: data.attributeFilters,
      } as never,
      aggregationType: data.aggregationType,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      aggregationInterval: AggregationInterval.Total,
      startTimestamp: data.start,
      endTimestamp: data.end,
      limit: 1,
      skip: 0,
    },
  });

  return (result.data && result.data[0]) || null;
}

function valueOf(row: AggregatedModel | null): number | null {
  const value: number = Number(row?.value);
  return row && Number.isFinite(value) ? value : null;
}

/*
 * What OneUptime's readings say of a resource over the last 14 days; null
 * when none of its CPU came in, or it has no metrics to read (an empty
 * filter would read every metric of the project).
 */
export async function fetchCloudResourceUsage(data: {
  projectId: ObjectID;
  profile: CloudRightSizingProfile;
  attributeFilters: Record<string, string>;
  now: Date;
}): Promise<CloudUsageObservation | null> {
  if (Object.keys(data.attributeFilters).length === 0) {
    return null;
  }

  const end: Date = data.now;
  const start: Date = addUtcDays(end, -CLOUD_RIGHT_SIZING_WINDOW_DAYS);
  const read: (
    names: Array<string>,
    aggregationType: AggregationType,
  ) => Promise<AggregatedModel | null> = (
    names: Array<string>,
    aggregationType: AggregationType,
  ): Promise<AggregatedModel | null> => {
    return readTotal({
      projectId: data.projectId,
      names,
      attributeFilters: data.attributeFilters,
      aggregationType,
      start,
      end,
    });
  };

  const [cpuP95, cpuMax, cpuCount, memoryMax]: [
    AggregatedModel | null,
    AggregatedModel | null,
    AggregatedModel | null,
    AggregatedModel | null,
  ] = await Promise.all([
    read(data.profile.cpu.names, AggregationType.P95),
    read(data.profile.cpu.names, AggregationType.Max),
    read(data.profile.cpu.names, AggregationType.Count),
    data.profile.memory
      ? read(data.profile.memory.names, AggregationType.Max)
      : Promise.resolve(null),
  ]);

  const p95: number | null = valueOf(cpuP95);

  if (!cpuP95 || p95 === null) {
    return null;
  }

  const first: number = new Date(cpuP95.timestamp).getTime();
  const max: number | null = valueOf(cpuMax);
  const memory: number | null = valueOf(memoryMax);
  const cpuScale: number = data.profile.cpu.toPercent;
  const memoryScale: number = data.profile.memory?.toPercent || 1;

  return {
    cpuP95Percent: p95 * cpuScale,
    cpuMaxPercent: max === null ? null : max * cpuScale,
    memoryPeakPercent: memory === null ? null : memory * memoryScale,
    samples: Math.max(0, Math.round(valueOf(cpuCount) || 0)),
    observedHours: Number.isFinite(first)
      ? Math.max(0, (end.getTime() - first) / HOUR_MS)
      : 0,
  };
}

/*
 * What a resource cost a day over the days its cloud billed it in the
 * last 30, in the currency given (the one most of its cost is in); null
 * when it was billed nothing.
 */
export async function fetchCloudResourceDailyCost(data: {
  projectId: ObjectID;
  provider: string;
  providerResourceId: string;
  currency: string;
  now: Date;
}): Promise<CloudResourceDailyCost | null> {
  const resourceKey: string = getCloudCostResourceKey(
    data.provider,
    data.providerResourceId,
  );

  if (!resourceKey) {
    return null;
  }

  const end: Date = data.now;
  const start: Date = addUtcDays(
    startOfUtcDay(data.now),
    -(RIGHT_SIZING_COST_DAYS - 1),
  );

  const result: AggregatedResult = await AnalyticsModelAPI.aggregate<CloudCost>(
    {
      modelType: CloudCost,
      aggregateBy: {
        query: {
          projectId: data.projectId,
          resourceId: resourceKey,
          currency: data.currency,
          day: new InBetween<Date>(start, end),
        },
        aggregationType: AggregationType.Sum,
        aggregateColumnName: "cost",
        aggregationTimestampColumnName: "day",
        aggregationInterval: AggregationInterval.Day,
        // One billed UTC day a row, as the cloud bills (CloudCost.day).
        timezone: Timezone.UTC,
        startTimestamp: start,
        endTimestamp: end,
        limit: RIGHT_SIZING_COST_DAYS + 1,
        skip: 0,
        sort: { day: SortOrder.Ascending },
      },
    },
  );

  const billed: Array<number> = (result.data || [])
    .map((row: AggregatedModel): number => {
      return Number(row.value);
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value) && value > 0;
    });

  if (billed.length === 0) {
    return null;
  }

  const total: number = billed.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);

  return {
    amount: total / billed.length,
    currency: data.currency,
    days: billed.length,
  };
}
