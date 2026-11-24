import BadDataException from "../Exception/BadDataException";
import {
  addUtcDays,
  addUtcMonths,
  daysInUtcMonth,
  roundCost,
  startOfUtcDay,
  startOfUtcMonth,
  toCloudCostDay,
} from "./CloudCost";

/*
 * COST VIEWS, COST GROUPS AND WHAT THEY ALLOCATE.
 *
 * A cost view ("By team", "By cost center") sorts a project's cloud spend
 * into cost groups that never overlap: every cost falls into the first
 * group whose rules match it (CloudCostRules), and what none matches is
 * the view's unallocated spend. Several views can sort the same spend
 * different ways.
 *
 * A view's groups are written by hand, or made for it and kept in step
 * with the spend: one group per value of a tag, or one per team that owns
 * cloud resources (CloudCostViewGrouping).
 *
 * A group can be SHARED - a support plan, a shared cluster, a network hub
 * - and its costs are then split across the view's other groups: evenly,
 * by their share of the month's spend, or by fixed percentages.
 *
 * Custom line items add what a bill does not carry - a share of a support
 * contract, an enterprise discount, an internal markup or a platform fee -
 * to an account or a group, once or every month. They are always told
 * apart from what the cloud billed.
 *
 * Everything is worked out when it is read, from the rules as they are
 * now: a changed rule restates every month before it, and nothing is
 * written per cost (CloudCostAllocation on the server). Budgets (#11008)
 * and reports (#11009) read a group's spend the same way.
 */

export enum CloudCostViewGrouping {
  // Groups written by hand, each with its rules.
  Rules = "Rules",
  // One group per value of a tag, made as the values appear.
  TagValue = "TagValue",
  // One group per team that owns cloud resources, made as owners are set.
  OwnerTeam = "OwnerTeam",
}

export enum CloudCostSharedSplit {
  // The same amount to each of the other groups.
  Even = "Even",
  // To each other group by its share of the month's cloud spend.
  Proportional = "Proportional",
  // By the percentages the group names.
  Fixed = "Fixed",
  /*
   * By what each namespace of a Kubernetes cluster cost that month in the
   * cluster's own cost engine: for a group that holds the cluster's nodes.
   * Each namespace's part goes to the group whose rules match it - its
   * labels read as tags - and the cluster's idle capacity, and what no
   * group takes, stays with the shared group.
   */
  Kubernetes = "Kubernetes",
}

export enum CloudCostLineItemKind {
  Charge = "Charge",
  Credit = "Credit",
}

export enum CloudCostLineItemRecurrence {
  // On one day.
  Once = "Once",
  // Every month from its first month, spread over each month's days.
  Monthly = "Monthly",
}

// The most groups a view keeps: one made per tag value stops here.
export const CLOUD_COST_MAX_GROUPS_PER_VIEW: number = 500;

// How a read's figures are bucketed over time.
export enum CloudCostAllocationInterval {
  Day = "day",
  Month = "month",
}

// The longest window read by the day; longer windows are read by the month.
export const CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY: number = 93;

// The longest window read at all: what the costs table keeps.
export const CLOUD_COST_ALLOCATION_MAX_DAYS: number = 400;

export function isCloudCostViewGrouping(
  value: unknown,
): value is CloudCostViewGrouping {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostViewGrouping) as Array<string>).includes(value)
  );
}

export function isCloudCostSharedSplit(
  value: unknown,
): value is CloudCostSharedSplit {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostSharedSplit) as Array<string>).includes(value)
  );
}

/*
 * ---------------------------------------------------------------------------
 * Fixed percentages
 * ---------------------------------------------------------------------------
 */

// A shared group's fixed split: each other group's ID and its percent.
export type CloudCostSharedPercentages = Record<string, number>;

// A group's ID as OneUptime writes one.
const GROUP_ID_PATTERN: RegExp = /^[0-9a-f-]{36}$/i;

/*
 * A shared group's fixed percentages as they are kept: each a group's ID
 * and a percent above 0, together 100. Refused, with what to fix, when they
 * cannot be read.
 */
export function readCloudCostSharedPercentages(
  value: unknown,
): CloudCostSharedPercentages {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException(
      "A shared group's percentages must be an object of each group's ID and its percent.",
    );
  }

  const percentages: CloudCostSharedPercentages = {};
  let sum: number = 0;

  for (const [groupId, raw] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const percent: number = Number(raw);

    if (!GROUP_ID_PATTERN.test(groupId.trim())) {
      throw new BadDataException(
        "A shared group's percentages must name each group by its ID.",
      );
    }

    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new BadDataException(
        "Each group's share of a shared group must be a percent above 0 and at most 100.",
      );
    }

    percentages[groupId.trim().toLowerCase()] = percent;
    sum += percent;
  }

  if (Object.keys(percentages).length > 0 && Math.abs(sum - 100) > 0.01) {
    throw new BadDataException(
      `A shared group's percentages must add up to 100. These add up to ${Math.round(sum * 100) / 100}.`,
    );
  }

  return percentages;
}

/*
 * ---------------------------------------------------------------------------
 * Windows and buckets
 * ---------------------------------------------------------------------------
 *
 * A read covers whole UTC days, as the clouds bill: the days from its
 * start's to its end's, both included (CloudCost.day is a day's start).
 */

export interface CloudCostAllocationWindow {
  // The first day read, at its start (UTC).
  start: Date;
  // The last day read, at its start (UTC).
  lastDay: Date;
}

export function toCloudCostAllocationWindow(data: {
  startDate: Date;
  endDate: Date;
}): CloudCostAllocationWindow {
  const start: Date = startOfUtcDay(data.startDate);
  const lastDay: Date = startOfUtcDay(data.endDate);

  if (lastDay.getTime() < start.getTime()) {
    throw new BadDataException(
      "The window ends before it starts. Choose an end date after the start date.",
    );
  }

  const days: number = getCloudCostWindowDays({ start, lastDay });

  if (days > CLOUD_COST_ALLOCATION_MAX_DAYS) {
    throw new BadDataException(
      `A cost read covers at most ${CLOUD_COST_ALLOCATION_MAX_DAYS} days, which is as far back as costs are kept. Choose a shorter window.`,
    );
  }

  return { start, lastDay };
}

export function getCloudCostWindowDays(
  window: CloudCostAllocationWindow,
): number {
  return (
    Math.round(
      (window.lastDay.getTime() - window.start.getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1
  );
}

/*
 * The window a read is compared with: for a window from a month's first
 * day, the same days as many months before ("this month so far" against
 * "last month by now", a quarter against the quarter before); for any
 * other, as many days just before it.
 */
export function getPreviousCloudCostWindow(
  window: CloudCostAllocationWindow,
): CloudCostAllocationWindow {
  if (window.start.getUTCDate() === 1) {
    const months: number =
      (window.lastDay.getUTCFullYear() - window.start.getUTCFullYear()) * 12 +
      (window.lastDay.getUTCMonth() - window.start.getUTCMonth()) +
      1;
    const start: Date = addUtcMonths(window.start, -months);
    // The last day, as many months back, kept within its month (31st -> 30th).
    const lastMonth: Date = addUtcMonths(
      startOfUtcMonth(window.lastDay),
      -months,
    );
    const lastDay: Date = new Date(
      Date.UTC(
        lastMonth.getUTCFullYear(),
        lastMonth.getUTCMonth(),
        Math.min(window.lastDay.getUTCDate(), daysInUtcMonth(lastMonth)),
      ),
    );

    return { start, lastDay };
  }

  const days: number = getCloudCostWindowDays(window);

  return {
    start: addUtcDays(window.start, -days),
    lastDay: addUtcDays(window.start, -1),
  };
}

// The interval a window is read by: by the day up to three months.
export function getCloudCostAllocationInterval(data: {
  window: CloudCostAllocationWindow;
  asked?: CloudCostAllocationInterval | undefined;
}): CloudCostAllocationInterval {
  if (
    data.asked === CloudCostAllocationInterval.Day &&
    getCloudCostWindowDays(data.window) <= CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY
  ) {
    return CloudCostAllocationInterval.Day;
  }

  if (data.asked === CloudCostAllocationInterval.Month) {
    return CloudCostAllocationInterval.Month;
  }

  return getCloudCostWindowDays(data.window) <=
    CLOUD_COST_ALLOCATION_MAX_DAYS_BY_DAY
    ? CloudCostAllocationInterval.Day
    : CloudCostAllocationInterval.Month;
}

// A bucket's key: "2026-11-24" by the day, "2026-11-01" by the month.
export function toCloudCostBucket(
  day: Date,
  interval: CloudCostAllocationInterval,
): string {
  return toCloudCostDay(
    interval === CloudCostAllocationInterval.Month
      ? startOfUtcMonth(day)
      : startOfUtcDay(day),
  );
}

// The month a bucket is in: what a proportional split weighs it by.
export function toCloudCostMonth(bucket: string): string {
  return `${bucket.slice(0, 7)}-01`;
}

// Every bucket of a window, in order.
export function getCloudCostBuckets(data: {
  window: CloudCostAllocationWindow;
  interval: CloudCostAllocationInterval;
}): Array<string> {
  const buckets: Array<string> = [];

  if (data.interval === CloudCostAllocationInterval.Month) {
    for (
      let month: Date = startOfUtcMonth(data.window.start);
      month.getTime() <= data.window.lastDay.getTime();
      month = addUtcMonths(month, 1)
    ) {
      buckets.push(toCloudCostDay(month));
    }

    return buckets;
  }

  for (
    let day: Date = data.window.start;
    day.getTime() <= data.window.lastDay.getTime();
    day = addUtcDays(day, 1)
  ) {
    buckets.push(toCloudCostDay(day));
  }

  return buckets;
}

/*
 * ---------------------------------------------------------------------------
 * Custom line items
 * ---------------------------------------------------------------------------
 */

export interface CloudCostLineItemInput {
  kind: CloudCostLineItemKind;
  // Always positive: the kind says whether it adds or takes off.
  amount: number;
  recurrence: CloudCostLineItemRecurrence;
  // The day of a one-off item; a monthly one's first month.
  startDate: Date;
  // A monthly item's last month; none for one with no end.
  endDate?: Date | undefined;
}

export function getCloudCostLineItemSignedAmount(
  item: Pick<CloudCostLineItemInput, "kind" | "amount">,
): number {
  const amount: number = Math.abs(Number(item.amount) || 0);
  return item.kind === CloudCostLineItemKind.Credit ? -amount : amount;
}

/*
 * What a line item adds to each day of a window: a one-off item all on its
 * day, a monthly item spread evenly over each of its months' days - so a
 * whole month comes to the whole amount, and part of a month to its part.
 */
export function getCloudCostLineItemDays(data: {
  item: CloudCostLineItemInput;
  window: CloudCostAllocationWindow;
}): Array<{ day: string; amount: number }> {
  const signed: number = getCloudCostLineItemSignedAmount(data.item);

  if (signed === 0) {
    return [];
  }

  const windowStart: number = data.window.start.getTime();
  const windowEnd: number = data.window.lastDay.getTime();

  if (data.item.recurrence === CloudCostLineItemRecurrence.Once) {
    const day: Date = startOfUtcDay(new Date(data.item.startDate));

    if (day.getTime() < windowStart || day.getTime() > windowEnd) {
      return [];
    }

    return [{ day: toCloudCostDay(day), amount: signed }];
  }

  const firstMonth: Date = startOfUtcMonth(new Date(data.item.startDate));
  const lastMonth: Date | null = data.item.endDate
    ? startOfUtcMonth(new Date(data.item.endDate))
    : null;
  const days: Array<{ day: string; amount: number }> = [];

  for (
    let day: Date = new Date(Math.max(windowStart, firstMonth.getTime()));
    day.getTime() <= windowEnd;
    day = addUtcDays(day, 1)
  ) {
    const month: Date = startOfUtcMonth(day);

    if (lastMonth && month.getTime() > lastMonth.getTime()) {
      break;
    }

    days.push({
      day: toCloudCostDay(day),
      amount: signed / daysInUtcMonth(day),
    });
  }

  return days;
}

/*
 * ---------------------------------------------------------------------------
 * Splitting shared groups
 * ---------------------------------------------------------------------------
 *
 * A shared group's costs, bucket by bucket, go to the view's other
 * (unshared) groups:
 *
 *   - Even: the same to each.
 *   - Proportional: by each one's share of the cloud spend of the month the
 *     bucket is in, so a month read by the day comes to what it does read
 *     as a month. A month the others spent nothing in is split evenly.
 *   - Fixed: by the percentages the group names. What a percent names a
 *     group the view no longer has stays with the shared group, unsplit.
 *
 * Unallocated spend never takes a share. A view with no unshared group
 * keeps its shared groups' costs where they are.
 */

export interface CloudCostSplitGroup {
  id: string;
  isShared: boolean;
  split?: CloudCostSharedSplit | undefined;
  percentages?: CloudCostSharedPercentages | undefined;
  /*
   * A Kubernetes split's weights, per month ("2026-11-01"): each group's
   * share of the cluster's namespaces' costs. What they leave of 1 - idle
   * capacity, a namespace no group takes - stays with the shared group.
   */
  kubernetesWeights?: Map<string, Map<string, number>> | undefined;
}

// Per group ID, per bucket: an amount.
export type CloudCostBucketAmounts = Map<string, Map<string, number>>;

export interface CloudCostSplitResult {
  // What each unshared group took of the shared groups, per bucket.
  received: CloudCostBucketAmounts;
  // What each shared group gave away, per bucket.
  given: CloudCostBucketAmounts;
  // Per shared group, what each other group took of it over the whole read.
  sharedTo: Map<string, Map<string, number>>;
}

function addTo(
  amounts: CloudCostBucketAmounts,
  groupId: string,
  bucket: string,
  amount: number,
): void {
  if (amount === 0) {
    return;
  }

  let byBucket: Map<string, number> | undefined = amounts.get(groupId);

  if (!byBucket) {
    byBucket = new Map();
    amounts.set(groupId, byBucket);
  }

  byBucket.set(bucket, (byBucket.get(bucket) || 0) + amount);
}

// Each unshared group's weight for one bucket of a shared group's costs.
export function getCloudCostSplitWeights(data: {
  group: CloudCostSplitGroup;
  targets: Array<string>;
  // The month's cloud spend of each group, for a proportional split.
  monthSpend: Map<string, number> | undefined;
  // The month's Kubernetes weights, for a split by a cluster's namespaces.
  kubernetesWeights?: Map<string, number> | undefined;
}): Map<string, number> {
  const weights: Map<string, number> = new Map();

  if (data.targets.length === 0) {
    return weights;
  }

  const even: () => Map<string, number> = (): Map<string, number> => {
    for (const target of data.targets) {
      weights.set(target, 1 / data.targets.length);
    }
    return weights;
  };

  const split: CloudCostSharedSplit =
    data.group.split || CloudCostSharedSplit.Proportional;

  if (split === CloudCostSharedSplit.Kubernetes) {
    for (const [groupId, weight] of (
      data.kubernetesWeights || new Map<string, number>()
    ).entries()) {
      if (data.targets.includes(groupId) && weight > 0) {
        weights.set(groupId, weight);
      }
    }

    return weights;
  }

  if (split === CloudCostSharedSplit.Fixed) {
    for (const [groupId, percent] of Object.entries(
      data.group.percentages || {},
    )) {
      if (data.targets.includes(groupId)) {
        weights.set(groupId, percent / 100);
      }
    }

    return weights;
  }

  if (split === CloudCostSharedSplit.Proportional) {
    let sum: number = 0;

    for (const target of data.targets) {
      sum += Math.max(0, data.monthSpend?.get(target) || 0);
    }

    if (sum <= 0) {
      return even();
    }

    for (const target of data.targets) {
      const spend: number = Math.max(0, data.monthSpend?.get(target) || 0);

      if (spend > 0) {
        weights.set(target, spend / sum);
      }
    }

    return weights;
  }

  return even();
}

/*
 * The shared groups' costs split across the others, bucket by bucket.
 * `amounts` is what each group holds of its own per bucket (what it gives
 * away); `monthSpend` is each group's own cloud spend per month (what a
 * proportional split weighs by).
 */
export function splitCloudCostSharedGroups(data: {
  groups: Array<CloudCostSplitGroup>;
  amounts: CloudCostBucketAmounts;
  monthSpend: Map<string, Map<string, number>>;
  // The month a bucket is in ("2026-11-01").
  monthOf: (bucket: string) => string;
}): CloudCostSplitResult {
  const result: CloudCostSplitResult = {
    received: new Map(),
    given: new Map(),
    sharedTo: new Map(),
  };
  const targets: Array<string> = data.groups
    .filter((group: CloudCostSplitGroup): boolean => {
      return !group.isShared;
    })
    .map((group: CloudCostSplitGroup): string => {
      return group.id;
    });

  for (const group of data.groups) {
    if (!group.isShared) {
      continue;
    }

    const byBucket: Map<string, number> | undefined = data.amounts.get(
      group.id,
    );

    if (!byBucket || targets.length === 0) {
      continue;
    }

    const sharedTo: Map<string, number> = new Map();
    result.sharedTo.set(group.id, sharedTo);

    for (const [bucket, amount] of byBucket.entries()) {
      if (amount === 0) {
        continue;
      }

      const month: string = data.monthOf(bucket);
      const weights: Map<string, number> = getCloudCostSplitWeights({
        group,
        targets,
        monthSpend: data.monthSpend.get(month),
        kubernetesWeights: group.kubernetesWeights?.get(month),
      });
      let givenAway: number = 0;

      for (const [target, weight] of weights.entries()) {
        const part: number = amount * weight;
        addTo(result.received, target, bucket, part);
        sharedTo.set(target, (sharedTo.get(target) || 0) + part);
        givenAway += part;
      }

      addTo(result.given, group.id, bucket, givenAway);
    }
  }

  return result;
}

/*
 * ---------------------------------------------------------------------------
 * What a read answers
 * ---------------------------------------------------------------------------
 *
 * Every figure is in the read's currency. A group's TOTAL is what it is
 * charged: what the cloud billed that its rules matched, its custom line
 * items, and its share of the shared groups, less what it gave away if it
 * is shared itself:
 *
 *   total = cloud + lineItems + sharedIn - sharedOut
 *
 * The groups' totals and the unallocated total add up to the window's
 * spend (the cloud's and the line items').
 */

export interface CloudCostAllocationAmounts {
  // What the cloud billed that the group's rules matched.
  cloud: number;
  // Custom line items on the group, or on an account whose costs it takes.
  lineItems: number;
  // The shared groups' costs split onto it.
  sharedIn: number;
  // A shared group's own costs, split across the other groups.
  sharedOut: number;
  // What it is charged: cloud + lineItems + sharedIn - sharedOut.
  total: number;
}

export interface CloudCostAllocationShare {
  // A service, a CloudAccount's ID, a resource or an owner team's ID.
  key: string;
  amount: number;
}

export interface CloudCostAllocationTagShare {
  // The tag's key and value.
  key: string;
  value: string;
  amount: number;
}

export interface CloudCostAllocationGroupResult
  extends CloudCostAllocationAmounts {
  id: string;
  name: string;
  order: number;
  isShared: boolean;
  split?: CloudCostSharedSplit | undefined;
  teamId?: string | undefined;
  // The same window before: the previous total.
  previousTotal?: number | undefined;
  // Its total, bucket by bucket (CloudCostAllocationResult.buckets).
  series: Array<number>;
  /*
   * What its rules match of the cloud spend before earlier groups take
   * their part: more than `cloud` when an earlier group takes some of it.
   */
  wouldMatch?: number | undefined;
  // An earlier group that takes everything its rules could (from the rules).
  coveredByGroupId?: string | undefined;
  // Where a shared group's costs went: each group's ID and what it took.
  sharedTo?: Array<CloudCostAllocationShare> | undefined;
  // Where a group's shared costs came from: each shared group and what it gave.
  sharedFrom?: Array<CloudCostAllocationShare> | undefined;
  // The services, resources and accounts it is charged for most (one group's read).
  topServices?: Array<CloudCostAllocationShare> | undefined;
  topResources?: Array<CloudCostAllocationShare> | undefined;
  topAccounts?: Array<CloudCostAllocationShare> | undefined;
}

export interface CloudCostAllocationUnallocated {
  cloud: number;
  lineItems: number;
  total: number;
  previousTotal?: number | undefined;
  series: Array<number>;
  // What no rule matches, the costliest first, to start a rule from.
  topServices: Array<CloudCostAllocationShare>;
  topAccounts: Array<CloudCostAllocationShare>;
  topTagValues: Array<CloudCostAllocationTagShare>;
  topOwnerTeams: Array<CloudCostAllocationShare>;
}

export interface CloudCostAllocationResult {
  viewId: string;
  viewName: string;
  currency: string;
  interval: CloudCostAllocationInterval;
  // The window read: its first and last day ("2026-11-01").
  start: string;
  lastDay: string;
  previousStart?: string | undefined;
  previousLastDay?: string | undefined;
  // Each bucket's first day, in order: what every series is by.
  buckets: Array<string>;
  // The window's whole spend: cloud, line items, and the two together.
  cloud: number;
  lineItems: number;
  total: number;
  previousTotal?: number | undefined;
  groups: Array<CloudCostAllocationGroupResult>;
  unallocated: CloudCostAllocationUnallocated;
  readAt: string;
}

// A figure as a read answers it: to the hundredth of a cent.
export function roundAllocation(amount: number): number {
  return roundCost(amount);
}

// A list's top entries: the largest first, none that rounds to nothing.
export function topCloudCostShares(
  shares: Map<string, number>,
  count: number,
): Array<CloudCostAllocationShare> {
  return Array.from(shares.entries())
    .map(([key, amount]: [string, number]): CloudCostAllocationShare => {
      return { key, amount: roundAllocation(amount) };
    })
    .filter((share: CloudCostAllocationShare): boolean => {
      return Math.abs(share.amount) >= 0.005;
    })
    .sort((a: CloudCostAllocationShare, b: CloudCostAllocationShare) => {
      return (
        b.amount - a.amount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      );
    })
    .slice(0, count);
}

// The change from one figure to the next, in percent; null from nothing.
export function getCloudCostAllocationChange(data: {
  current: number;
  previous: number | undefined;
}): number | null {
  if (data.previous === undefined || Math.abs(data.previous) < 0.005) {
    return null;
  }

  return ((data.current - data.previous) / Math.abs(data.previous)) * 100;
}
