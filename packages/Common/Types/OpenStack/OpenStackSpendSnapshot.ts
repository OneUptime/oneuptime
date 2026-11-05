import { addUtcMonths, daysInUtcMonth, startOfUtcMonth } from "../Cloud/CloudCost";
import {
  OpenStackCostLine,
  OpenStackCostLineKind,
  OpenStackPriceList,
  OpenStackUsageCost,
  getOpenStackUsageCost,
} from "./OpenStackPriceList";
import {
  OpenStackFlavorUsage,
  OpenStackProjectHolding,
  OpenStackUsageQuantities,
  OpenStackUsageTotals,
  addOpenStackUsage,
  getEmptyOpenStackUsageQuantities,
  getOpenStackUsageTotals,
  toOpenStackUsageMonth,
} from "./OpenStackProjectUsage";
import { OpenStackWasteFinding } from "./OpenStackWaste";

/*
 * WHAT THE SPEND PAGE READS, AND WHAT EACH PROJECT'S ROW SAYS.
 *
 * The worker works this out every quarter of an hour and keeps it on the cloud, so the page reads
 * one row however large the cloud is. What takes more than a page should carry stays bounded here
 * (the largest domains, flavors and volume types, the top growers) and the full list of projects is
 * read a page at a time from OpenStackProjectUsage.
 *
 * Where money is said, it's an estimate from the operator's own prices, or what CloudKitty rated if
 * this cloud runs it, and each project's row says which.
 */

export enum OpenStackCostSource {
  // CloudKitty rated this project for this period.
  CloudKitty = "cloudkitty",
  // The operator's price list, applied to what the inventory shows was used.
  PriceList = "price-list",
}

// What a cloud's figures come from, as the page says it.
export type OpenStackSpendSource =
  | "cloudkitty"
  | "cloudkitty-and-price-list"
  | "price-list"
  | "usage-only";

export const OPENSTACK_SPEND_GROWERS_KEPT: number = 10;
export const OPENSTACK_SPEND_DOMAINS_KEPT: number = 200;
export const OPENSTACK_SPEND_FLAVORS_KEPT: number = 50;
export const OPENSTACK_SPEND_VOLUME_TYPES_KEPT: number = 50;
export const OPENSTACK_SPEND_DAYS_KEPT: number = 62;
export const OPENSTACK_SPEND_MONTHS_KEPT: number = 13;

/*
 * CloudKitty's rated figure for one project and one period, as the scan keeps it on the project's
 * row. Nothing below zero and no zero: a rate of nothing is a project CloudKitty has no rule for,
 * which isn't the same as one that cost nothing.
 */
export interface OpenStackRatedPeriod {
  total: number;
  byType: Record<string, number>;
  readAt: string | null;
}

export type OpenStackRatedByPeriod = Record<string, OpenStackRatedPeriod>;

export function readOpenStackRatedByPeriod(
  value: unknown,
): OpenStackRatedByPeriod {
  const rated: OpenStackRatedByPeriod = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return rated;
  }

  for (const period of Object.keys(value)) {
    const entry: unknown = (value as Record<string, unknown>)[period];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const total: number = Number(record["total"]);

    if (!Number.isFinite(total) || total <= 0) {
      continue;
    }

    const byType: Record<string, number> = {};
    const types: unknown = record["byType"];

    if (types && typeof types === "object" && !Array.isArray(types)) {
      for (const type of Object.keys(types)) {
        const amount: number = Number((types as Record<string, unknown>)[type]);
        if (Number.isFinite(amount) && amount > 0) {
          byType[type] = amount;
        }
      }
    }

    rated[period] = {
      total,
      byType,
      readAt: typeof record["readAt"] === "string" ? record["readAt"] : null,
    };
  }

  return rated;
}

// One project's cost for one period, by what CloudKitty rated where it did, by the price list where not.
export interface OpenStackProjectCost {
  amount: number | null;
  source: OpenStackCostSource | null;
  // Used on something with no price, so the amount isn't all of it.
  unpricedLineCount: number;
}

export function getOpenStackProjectCost(data: {
  quantities: OpenStackUsageQuantities;
  priceList: OpenStackPriceList | null;
  rated: OpenStackRatedPeriod | null | undefined;
}): OpenStackProjectCost {
  if (data.rated && data.rated.total > 0) {
    return {
      amount: data.rated.total,
      source: OpenStackCostSource.CloudKitty,
      unpricedLineCount: 0,
    };
  }

  const cost: OpenStackUsageCost = getOpenStackUsageCost({
    quantities: data.quantities,
    priceList: data.priceList,
  });

  return {
    amount: cost.amount,
    source: cost.amount === null ? null : OpenStackCostSource.PriceList,
    unpricedLineCount: cost.unpricedLineCount,
  };
}

// The hours left in a month that started when `now`'s did.
export function getOpenStackHoursLeftInMonth(now: Date): number {
  return Math.max(
    0,
    (addUtcMonths(startOfUtcMonth(now), 1).getTime() - now.getTime()) /
      (60 * 60 * 1000),
  );
}

export function getOpenStackHoursSoFarInMonth(now: Date): number {
  return Math.max(
    0,
    (now.getTime() - startOfUtcMonth(now).getTime()) / (60 * 60 * 1000),
  );
}

/*
 * Where this project's month is heading. On a price list: what it has come to so far, and what it
 * holds right now for every hour left. CloudKitty doesn't say what a project holds right now, so
 * its figure is taken straight on from the part of the month gone. Nothing's said before a day of
 * it has gone, because the first hours of a month read as anything at all.
 */
export function getOpenStackOnCourseFor(data: {
  cost: OpenStackProjectCost;
  holding: OpenStackProjectHolding | null | undefined;
  priceList: OpenStackPriceList | null;
  now: Date;
}): number | null {
  const { cost, now } = data;

  if (cost.amount === null) {
    return null;
  }

  const hoursSoFar: number = getOpenStackHoursSoFarInMonth(now);
  const hoursLeft: number = getOpenStackHoursLeftInMonth(now);

  if (cost.source === OpenStackCostSource.CloudKitty) {
    return hoursSoFar >= 24
      ? roundMoney((cost.amount / hoursSoFar) * (hoursSoFar + hoursLeft))
      : null;
  }

  if (!data.holding || !data.priceList) {
    return cost.amount;
  }

  const perHour: number | null = getOpenStackUsageCost({
    quantities: addOpenStackUsage({
      quantities: getEmptyOpenStackUsageQuantities(),
      holding: data.holding,
      hours: 1,
    }),
    priceList: data.priceList,
  }).amount;

  return roundMoney(cost.amount + (perHour || 0) * hoursLeft);
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 10000) / 10000;
}

// vCPU-hours this month at what's held now: how a project grows when nothing is priced.
export function getOpenStackVcpuHoursOnCourseFor(data: {
  quantities: OpenStackUsageQuantities;
  holding: OpenStackProjectHolding | null | undefined;
  now: Date;
}): number {
  const soFar: number = getOpenStackUsageTotals(data.quantities).vcpuHours;

  if (!data.holding) {
    return soFar;
  }

  const hoursLeft: number = getOpenStackHoursLeftInMonth(data.now);
  let vcpusHeld: number = 0;

  for (const flavor of data.holding.flavors) {
    vcpusHeld += (flavor.running + flavor.shutOff) * (flavor.vcpus || 0);
  }

  return soFar + vcpusHeld * hoursLeft;
}

export interface OpenStackSpendProject {
  openStackProjectId: string;
  name: string | null;
  domainId: string | null;
  domainName: string | null;
  thisMonth: number | null;
  lastMonth: number | null;
  onCourseFor: number | null;
  source: OpenStackCostSource | null;
  vcpuHours: number;
  lastMonthVcpuHours: number | null;
  vcpuHoursOnCourseFor: number;
  /*
   * What a project is on course to add on last month: in money when both months have a cost, in
   * vCPU-hours when nothing is priced. Null when there was no last month to compare with.
   */
  growth: number | null;
}

export interface OpenStackSpendDomain {
  domainId: string | null;
  name: string | null;
  projectCount: number;
  thisMonth: number | null;
  lastMonth: number | null;
  onCourseFor: number | null;
  vcpuHours: number;
  memoryGbHours: number;
  volumeGbHours: number;
  floatingIpHours: number;
}

export interface OpenStackSpendFlavorRow {
  name: string | null;
  flavorId: string | null;
  regionName: string | null;
  vcpus: number | null;
  ramMib: number | null;
  instanceHours: number;
  shutOffInstanceHours: number;
  vcpuHours: number;
  memoryGbHours: number;
  amount: number | null;
}

export interface OpenStackSpendVolumeTypeRow {
  type: string;
  gbHours: number;
  amount: number | null;
}

// What OneUptime counted of a period, so a short one doesn't read as a cheap one.
export interface OpenStackSpendCoverage {
  // When this period's first hour was counted.
  firstReadAt: string | null;
  countedHours: number;
  // Hours inside gaps, when nobody was reading this cloud.
  notCountedHours: number;
}

export interface OpenStackSpendDay {
  day: string;
  vcpuHours: number;
  memoryGbHours: number;
  volumeGbHours: number;
  floatingIpHours: number;
}

export interface OpenStackSpendMonth extends OpenStackUsageTotals {
  month: string;
  amount: number | null;
}

// This month's full days against last month's same days, at today's prices.
export interface OpenStackSpendComparison {
  // This month through this day.
  throughDay: string;
  lastMonthThroughDay: string;
  thisMonth: number | null;
  lastMonth: number | null;
  thisMonthVcpuHours: number;
  lastMonthVcpuHours: number;
  // What it was worked out at, so a price changed since works it out again.
  priceListKey: string;
}

export interface OpenStackSpendSnapshot {
  readAt: string;
  month: string;
  // Null while nothing has a currency: no price list, and CloudKitty doesn't say one.
  currency: string | null;
  source: OpenStackSpendSource;
  projectCount: number;
  // Projects CloudKitty rated this month.
  projectsRatedByCloudKitty: number;
  // When CloudKitty's figures were last read, for a page that says how old they are.
  cloudKittyReadAt: string | null;
  // Projects with something used that has no price, so a total isn't all of it.
  projectsPartlyPriced: number;
  thisMonth: number | null;
  lastMonth: number | null;
  onCourseFor: number | null;
  usage: OpenStackUsageTotals;
  lastMonthUsage: OpenStackUsageTotals | null;
  comparison: OpenStackSpendComparison | null;
  coverage: OpenStackSpendCoverage;
  lastMonthCoverage: OpenStackSpendCoverage | null;
  byFlavor: Array<OpenStackSpendFlavorRow>;
  flavorCount: number;
  byVolumeType: Array<OpenStackSpendVolumeTypeRow>;
  volumeTypeCount: number;
  domains: Array<OpenStackSpendDomain>;
  domainCount: number;
  growers: Array<OpenStackSpendProject>;
  days: Array<OpenStackSpendDay>;
  months: Array<OpenStackSpendMonth>;
  // The month's figures as they stood at the last midnight, which a day's own hours are taken from.
  monthAtLastMidnight: OpenStackUsageTotals | null;
  waste: Array<OpenStackWasteFinding> | null;
  wasteReadAt: string | null;
}

export function getOpenStackSpendSource(data: {
  projects: ReadonlyArray<{ source: OpenStackCostSource | null }>;
}): OpenStackSpendSource {
  let rated: number = 0;
  let priced: number = 0;

  for (const project of data.projects) {
    if (project.source === OpenStackCostSource.CloudKitty) {
      rated++;
    } else if (project.source === OpenStackCostSource.PriceList) {
      priced++;
    }
  }

  if (rated > 0) {
    return priced > 0 ? "cloudkitty-and-price-list" : "cloudkitty";
  }

  return priced > 0 ? "price-list" : "usage-only";
}

/*
 * What a project's usage row says about growth. Nothing comparable means nothing's said: a cloud in
 * its first month has no last month, which is not the same as a project growing from nothing. A
 * project new this month on a cloud that was being read last month has grown by all of it.
 */
export function getOpenStackProjectGrowth(data: {
  onCourseFor: number | null;
  lastMonth: number | null;
  vcpuHoursOnCourseFor: number;
  lastMonthVcpuHours: number | null;
  isLastMonthRead: boolean;
}): number | null {
  if (!data.isLastMonthRead) {
    return null;
  }

  if (data.onCourseFor !== null) {
    return data.onCourseFor - (data.lastMonth || 0);
  }

  return data.vcpuHoursOnCourseFor - (data.lastMonthVcpuHours || 0);
}

function compareNullableDescending(
  first: number | null,
  second: number | null,
): number {
  return (second ?? 0) - (first ?? 0);
}

export function getOpenStackSpendGrowers(
  projects: ReadonlyArray<OpenStackSpendProject>,
): Array<OpenStackSpendProject> {
  return projects
    .filter((project: OpenStackSpendProject): boolean => {
      return project.growth !== null && project.growth > 0;
    })
    .sort((first: OpenStackSpendProject, second: OpenStackSpendProject) => {
      return (
        compareNullableDescending(first.growth, second.growth) ||
        first.openStackProjectId.localeCompare(second.openStackProjectId)
      );
    })
    .slice(0, OPENSTACK_SPEND_GROWERS_KEPT);
}

function addNullable(first: number | null, second: number | null): number | null {
  if (first === null) {
    return second;
  }
  return second === null ? first : first + second;
}

export function getOpenStackSpendDomains(
  rows: ReadonlyArray<{
    project: OpenStackSpendProject;
    totals: OpenStackUsageTotals;
  }>,
): { domains: Array<OpenStackSpendDomain>; domainCount: number } {
  const domains: Map<string, OpenStackSpendDomain> = new Map();

  for (const { project, totals } of rows) {
    const key: string = project.domainId || "";
    const domain: OpenStackSpendDomain = domains.get(key) || {
      domainId: project.domainId,
      name: project.domainName,
      projectCount: 0,
      thisMonth: null,
      lastMonth: null,
      onCourseFor: null,
      vcpuHours: 0,
      memoryGbHours: 0,
      volumeGbHours: 0,
      floatingIpHours: 0,
    };

    domain.projectCount += 1;
    domain.thisMonth = addNullable(domain.thisMonth, project.thisMonth);
    domain.lastMonth = addNullable(domain.lastMonth, project.lastMonth);
    domain.onCourseFor = addNullable(domain.onCourseFor, project.onCourseFor);
    domain.vcpuHours += totals.vcpuHours;
    domain.memoryGbHours += totals.memoryGbHours;
    domain.volumeGbHours += totals.volumeGbHours;
    domain.floatingIpHours += totals.floatingIpHours;
    domains.set(key, domain);
  }

  return {
    domainCount: domains.size,
    domains: Array.from(domains.values())
      .sort((first: OpenStackSpendDomain, second: OpenStackSpendDomain) => {
        return (
          compareNullableDescending(first.thisMonth, second.thisMonth) ||
          second.vcpuHours - first.vcpuHours ||
          (first.name || "").localeCompare(second.name || "")
        );
      })
      .slice(0, OPENSTACK_SPEND_DOMAINS_KEPT),
  };
}

/*
 * A whole cloud's usage by flavor and by volume type, largest first, from its projects' quantities
 * added up. Each flavor's own amount adds its lines, so a flavor priced by its vCPUs and memory
 * reads as one figure.
 */
export function getOpenStackSpendBreakdown(data: {
  quantities: OpenStackUsageQuantities;
  priceList: OpenStackPriceList | null;
}): {
  byFlavor: Array<OpenStackSpendFlavorRow>;
  flavorCount: number;
  byVolumeType: Array<OpenStackSpendVolumeTypeRow>;
  volumeTypeCount: number;
} {
  const flavors: Array<OpenStackSpendFlavorRow> = Object.values(
    data.quantities.flavors,
  ).map((flavor: OpenStackFlavorUsage): OpenStackSpendFlavorRow => {
    const lines: Array<OpenStackCostLine> = getOpenStackUsageCost({
      quantities: {
        ...getEmptyOpenStackUsageQuantities(),
        flavors: { flavor },
      },
      priceList: data.priceList,
    }).lines;
    const priced: Array<OpenStackCostLine> = lines.filter(
      (line: OpenStackCostLine): boolean => {
        return line.amount !== null;
      },
    );
    const hours: number = flavor.runningHours + flavor.shutOffHours;

    return {
      name: flavor.name,
      flavorId: flavor.flavorId,
      regionName: flavor.regionName,
      vcpus: flavor.vcpus,
      ramMib: flavor.ramMib,
      instanceHours: hours,
      shutOffInstanceHours: flavor.shutOffHours,
      vcpuHours: hours * (flavor.vcpus || 0),
      memoryGbHours: hours * ((flavor.ramMib || 0) / 1024),
      amount:
        priced.length > 0
          ? roundMoney(
              priced.reduce(
                (total: number, line: OpenStackCostLine): number => {
                  return total + (line.amount || 0);
                },
                0,
              ),
            )
          : null,
    };
  });

  const types: Array<OpenStackSpendVolumeTypeRow> = Object.keys(
    data.quantities.volumeGbHoursByType,
  ).map((type: string): OpenStackSpendVolumeTypeRow => {
    const line: OpenStackCostLine | undefined = getOpenStackUsageCost({
      quantities: {
        ...getEmptyOpenStackUsageQuantities(),
        volumeGbHoursByType: {
          [type]: data.quantities.volumeGbHoursByType[type] || 0,
        },
      },
      priceList: data.priceList,
    }).lines.find((entry: OpenStackCostLine): boolean => {
      return entry.kind === OpenStackCostLineKind.Volume;
    });

    return {
      type,
      gbHours: data.quantities.volumeGbHoursByType[type] || 0,
      amount: line?.amount ?? null,
    };
  });

  return {
    flavorCount: flavors.length,
    byFlavor: flavors
      .sort((first: OpenStackSpendFlavorRow, second: OpenStackSpendFlavorRow) => {
        return (
          compareNullableDescending(first.amount, second.amount) ||
          second.vcpuHours - first.vcpuHours ||
          second.instanceHours - first.instanceHours ||
          (first.name || "").localeCompare(second.name || "")
        );
      })
      .slice(0, OPENSTACK_SPEND_FLAVORS_KEPT),
    volumeTypeCount: types.length,
    byVolumeType: types
      .sort(
        (
          first: OpenStackSpendVolumeTypeRow,
          second: OpenStackSpendVolumeTypeRow,
        ) => {
          return (
            compareNullableDescending(first.amount, second.amount) ||
            second.gbHours - first.gbHours ||
            first.type.localeCompare(second.type)
          );
        },
      )
      .slice(0, OPENSTACK_SPEND_VOLUME_TYPES_KEPT),
  };
}

export function getOpenStackPriceListKey(
  priceList: OpenStackPriceList | null,
): string {
  return priceList ? JSON.stringify(priceList) : "";
}

// The same moment last month, as near as that month has one: March 31st reads February's last day.
export function getOpenStackSameDayLastMonth(day: string): string {
  const date: Date = new Date(`${day}T00:00:00.000Z`);
  const lastMonth: Date = addUtcMonths(startOfUtcMonth(date), -1);
  const number: number = Math.min(
    date.getUTCDate(),
    daysInUtcMonth(lastMonth),
  );

  return `${toOpenStackUsageMonth(lastMonth)}-${String(number).padStart(2, "0")}`;
}

/*
 * A coverage with this reading's hours added. A new period starts over. Hours aren't counted to the
 * ones before the period they fall in.
 */
export function addOpenStackSpendCoverage(data: {
  coverage: OpenStackSpendCoverage | null;
  countedHours: number;
  notCountedHours: number;
  now: Date;
}): OpenStackSpendCoverage {
  return {
    firstReadAt:
      data.coverage?.firstReadAt ??
      (data.countedHours > 0 ? data.now.toISOString() : null),
    countedHours: (data.coverage?.countedHours || 0) + data.countedHours,
    notCountedHours:
      (data.coverage?.notCountedHours || 0) + data.notCountedHours,
  };
}

// Read back from the cloud's column, where anything could have been left by an older version.
export function readOpenStackSpendSnapshot(
  value: unknown,
): OpenStackSpendSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return typeof record["readAt"] === "string" &&
    typeof record["month"] === "string"
    ? (value as OpenStackSpendSnapshot)
    : null;
}
