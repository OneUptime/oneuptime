import Service from "Common/Models/DatabaseModels/Service";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { SparklinePoint } from "./SparklinePoint";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a metric row shows when its host page knows more than the metric
 * list does. Both are opt-in: a list with neither behaves exactly as it
 * always has.
 *
 * 1. Which services a row names. The metric list is a Postgres MetricType
 *    list, and a type's `services` are every service that EVER reported the
 *    metric, project-wide. A list pinned to entity keys alone (a Database
 *    page, an Inventory item) asks ClickHouse which metric names its keys
 *    have anyway; grouped by `primaryEntityId` too, that same query says
 *    which services reported each metric UNDER THOSE KEYS, and the row
 *    names only those — not the eight services that ever sent
 *    `db.client.operation.duration` anywhere.
 *
 * 2. A row's value and sparkline. The generic list averages every series of
 *    a metric per bucket. A host that knows how a metric combines (the
 *    Database catalog: a total across databases, a counter as a per-second
 *    rate) hands over its own points for the names it knows, with a suffix
 *    ("/s") and a one-line caption saying what the number is.
 *
 * 3. A row's aggregation. A host whose metrics are read right by another
 *    aggregation than the average - a Service Bus namespace's messages arrive
 *    once per queue, and the namespace's number is their sum - names it per
 *    metric: the list reads the row's sparkline and value with it, captions
 *    it, and opens the explorer with it, so a monitor created from there
 *    reads the same number. A row read as a total (Sum, Count) keeps its
 *    whole intervals only, as the Queue and Database pages' counts do: its
 *    newest interval is still filling, so it would read as a drop.
 *
 * 4. A row's section. A host that knows what each of its metrics is about
 *    - a cloud resource's key metrics: Availability, Traffic, Errors,
 *    Latency, then what it runs on - names each metric's section and its
 *    place in it (MetricRowGroup). The list then reads in those sections,
 *    most important first, each under its heading, and its other metrics
 *    after them under "Other": a page of twenty metrics a person reads top
 *    down, instead of twenty names in alphabetical order. The order holds
 *    across pages: the list pages through the names in section order
 *    (orderMetricNamesByGroup), not in alphabetical order.
 *
 * 5. A section's gaps. A host that knows which metrics each section should
 *    hold - a cloud resource's type's key metrics - names those the list
 *    found no data of in its range, section by section (MetricRowGroupGap).
 *    The section's heading says how many, folded away; opened, the host
 *    says which, since when and why. A section none of whose metrics
 *    reported is drawn as its heading alone, where it falls among the
 *    others (getMetricPageNamesWithGapSections). A gap is never a row: it
 *    is not counted, and it takes no place on a page.
 */

export interface MetricRowValueOverride {
  points: Array<SparklinePoint>;
  // The number the row shows; the newest point when left out.
  value?: number | null | undefined;
  // Appended to the formatted value, e.g. "/s" for a rate.
  valueSuffix?: string | undefined;
  // One short line under the value saying what it is ("total of series").
  caption?: string | undefined;
}

export type MetricRowValueOverrideMap = Map<string, MetricRowValueOverride>;

export type FetchMetricRowValueOverrides = (data: {
  metricNames: Array<string>;
  startAndEndDate: InBetween<Date>;
}) => Promise<MetricRowValueOverrideMap>;

export interface MetricRowAggregation {
  aggregationType: MetricsAggregationType;
  // One short line under the value saying what it is ("total of series").
  caption?: string | undefined;
  /*
   * For a row read as a total: how long after an interval ends its points
   * may still be arriving from their source (a cloud's metrics come minutes
   * late), so the row shows only the intervals that ended at least that
   * long ago. Unset: the ones that have ended.
   */
  settleMs?: number | undefined;
}

/*
 * The aggregation a row reads its metric with over the range the list reads
 * (an aggregation may hold at some interval lengths only); undefined keeps
 * the list's own, the average of every series.
 */
export type GetMetricRowAggregation = (
  metricName: string,
  startAndEndDate: InBetween<Date>,
) => MetricRowAggregation | undefined;

/**
 * metric name → the ids of the services that reported it, from rows of a
 * `GROUP BY name, primaryEntityId` metric query. A row without a name is
 * skipped; a name whose rows carry no id maps to an empty list (a metric
 * the entity reports itself, such as a database's engine metrics).
 */
export function getMetricServiceIdsByName(
  rows: ReadonlyArray<{ name?: unknown; primaryEntityId?: unknown }>,
): Record<string, Array<string>> {
  const byName: Record<string, Array<string>> = {};
  for (const row of rows) {
    const name: string =
      row.name === null || row.name === undefined ? "" : String(row.name);
    if (!name) {
      continue;
    }
    const ids: Array<string> = byName[name] || [];
    byName[name] = ids;
    const id: string =
      row.primaryEntityId === null || row.primaryEntityId === undefined
        ? ""
        : String(row.primaryEntityId).trim();
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return byName;
}

/**
 * The named services of a metric row that are among `allowedServiceIds` —
 * strictly: an empty list allows none (unlike getVisibleMetricServices,
 * where no scope means every service).
 */
export function getMetricServicesWithin(data: {
  services?: Array<Service> | undefined;
  allowedServiceIds: ReadonlyArray<string>;
}): Array<Service> {
  const allowed: Set<string> = new Set<string>(data.allowedServiceIds);
  return (data.services || []).filter((service: Service): boolean => {
    if (!service.name || !service.name.toString().trim()) {
      return false;
    }
    const id: string | undefined = service._id?.toString();
    return Boolean(id && allowed.has(id));
  });
}

/**
 * An override's points in time order and the value the row shows: its own
 * `value` when finite, else the newest point, else undefined.
 */
export function resolveMetricRowValueOverride(
  override: MetricRowValueOverride,
): { points: Array<SparklinePoint>; value: number | undefined } {
  const points: Array<SparklinePoint> = override.points
    .filter((point: SparklinePoint): boolean => {
      return (
        Number.isFinite(point.value) &&
        !Number.isNaN(new Date(point.time).getTime())
      );
    })
    .sort((a: SparklinePoint, b: SparklinePoint): number => {
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });
  const own: number | null | undefined = override.value;
  if (typeof own === "number" && Number.isFinite(own)) {
    return { points, value: own };
  }
  return {
    points,
    value: points.length > 0 ? points[points.length - 1]!.value : undefined,
  };
}

// The section a metric row is listed in (see 4. at the top).
export interface MetricRowGroup {
  // Tells one section from another.
  key: string;
  /*
   * The section's heading in English: a key of the locale files, which the
   * list draws in the reader's language.
   */
  title: string;
  // Where the section comes among the others: lower first.
  order: number;
  // Where the metric comes in its section: lower first.
  rank: number;
}

/*
 * The section a metric's row is listed in, undefined for a metric in none
 * (it is listed after every section, under OTHER_METRICS_GROUP_TITLE).
 * Must be referentially stable: the list reorders when it changes.
 */
export type GetMetricRowGroup = (
  metricName: string,
) => MetricRowGroup | undefined;

// The heading of the metrics no section holds, after every section.
export const OTHER_METRICS_GROUP_TITLE: string = translationKey("Other");
export const OTHER_METRICS_GROUP_KEY: string = "__other";

/*
 * Metric names in the order the list shows them: the ones in a section by
 * the section's order, then their place in it, then name; after them, the
 * ones in no section, by name. Names are not repeated.
 */
export function orderMetricNamesByGroup(
  names: ReadonlyArray<string>,
  getRowGroup: GetMetricRowGroup,
): Array<string> {
  const unique: Array<string> = Array.from(new Set<string>(names));
  const groupOf: Map<string, MetricRowGroup | undefined> = new Map();

  for (const name of unique) {
    groupOf.set(name, getRowGroup(name));
  }

  return unique.sort((a: string, b: string): number => {
    const groupA: MetricRowGroup | undefined = groupOf.get(a);
    const groupB: MetricRowGroup | undefined = groupOf.get(b);

    if (groupA && !groupB) {
      return -1;
    }

    if (!groupA && groupB) {
      return 1;
    }

    if (groupA && groupB) {
      if (groupA.order !== groupB.order) {
        return groupA.order - groupB.order;
      }

      if (groupA.rank !== groupB.rank) {
        return groupA.rank - groupB.rank;
      }
    }

    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// The metrics a section should hold and the list found no data of (see 5. at the top).
export interface MetricRowGroupGap {
  group: MetricRowGroup;
  // What the host calls each one (a key metric's key), in the section's order.
  keys: Array<string>;
}

/*
 * The gaps of each section, from the names the list found data of in its
 * range. Must be referentially stable: the list works them out again when
 * it changes.
 */
export type GetMetricRowGroupGaps = (
  reportedNames: ReadonlyArray<string>,
) => Array<MetricRowGroupGap>;

/*
 * The name of the stand-in a section none of whose metrics reported is
 * drawn by: its heading, and no row.
 */
export const METRIC_ROW_GROUP_GAP_PREFIX: string = "__section-gap__:";

export function getMetricRowGroupGapName(groupKey: string): string {
  return `${METRIC_ROW_GROUP_GAP_PREFIX}${groupKey}`;
}

export function isMetricRowGroupGapName(name: string): boolean {
  return name.startsWith(METRIC_ROW_GROUP_GAP_PREFIX);
}

/*
 * getRowGroup, knowing the stand-ins too: a stand-in is in its gap's
 * section.
 */
export function withMetricRowGroupGaps(
  getRowGroup: GetMetricRowGroup,
  gaps: ReadonlyArray<MetricRowGroupGap>,
): GetMetricRowGroup {
  const byName: Map<string, MetricRowGroup> = new Map();

  for (const gap of gaps) {
    byName.set(getMetricRowGroupGapName(gap.group.key), gap.group);
  }

  return (metricName: string): MetricRowGroup | undefined => {
    return byName.get(metricName) || getRowGroup(metricName);
  };
}

/*
 * One page's names, with a stand-in for each section none of whose
 * metrics reported that falls on it. A section's place among the list's
 * names (`orderedNames`, in section order) is before the first name of a
 * later section, or of none; the page that holds that place draws it, and
 * the last page one after every name. Several in one place come in their
 * sections' order. A list with no names draws none: its empty state says
 * nothing reported.
 */
export function getMetricPageNamesWithGapSections(data: {
  orderedNames: ReadonlyArray<string>;
  // The page's place in orderedNames: [pageStart, pageEnd).
  pageStart: number;
  pageEnd: number;
  gaps: ReadonlyArray<MetricRowGroupGap>;
  getRowGroup: GetMetricRowGroup;
}): Array<string> {
  const total: number = data.orderedNames.length;
  const pageNames: Array<string> = data.orderedNames.slice(
    data.pageStart,
    data.pageEnd,
  );

  if (total === 0) {
    return pageNames;
  }

  const groupOf: Array<MetricRowGroup | undefined> = data.orderedNames.map(
    (name: string): MetricRowGroup | undefined => {
      return data.getRowGroup(name);
    },
  );
  const present: Set<string> = new Set<string>();

  for (const group of groupOf) {
    if (group) {
      present.add(group.key);
    }
  }

  const placed: Array<{ index: number; group: MetricRowGroup }> = [];

  for (const gap of data.gaps) {
    if (gap.keys.length === 0 || present.has(gap.group.key)) {
      continue;
    }

    let index: number = groupOf.findIndex(
      (group: MetricRowGroup | undefined): boolean => {
        return !group || group.order > gap.group.order;
      },
    );

    if (index < 0) {
      index = total;
    }

    const isOnPage: boolean =
      (index >= data.pageStart && index < data.pageEnd) ||
      (index === total && data.pageEnd >= total);

    if (isOnPage) {
      placed.push({ index, group: gap.group });
    }
  }

  placed.sort(
    (
      a: { index: number; group: MetricRowGroup },
      b: { index: number; group: MetricRowGroup },
    ): number => {
      return a.index !== b.index
        ? b.index - a.index
        : b.group.order - a.group.order;
    },
  );

  // From the last place back, so each insertion leaves the earlier places as they were.
  for (const { index, group } of placed) {
    pageNames.splice(
      Math.min(index - data.pageStart, pageNames.length),
      0,
      getMetricRowGroupGapName(group.key),
    );
  }

  return pageNames;
}

/*
 * The heading drawn above the row at `index` of a page of names, in
 * English: the row's section's, when the row starts it (the page's first
 * row, or one in another section than the row before), else null. A page
 * none of whose names is in a section has no headings at all: it reads as
 * a plain list.
 */
export function getMetricRowGroupHeading(data: {
  names: ReadonlyArray<string>;
  index: number;
  getRowGroup: GetMetricRowGroup;
}): string | null {
  if (
    !data.names.some((name: string): boolean => {
      return Boolean(data.getRowGroup(name));
    })
  ) {
    return null;
  }

  const keyOf: (name: string | undefined) => string | null = (
    name: string | undefined,
  ): string | null => {
    if (name === undefined) {
      return null;
    }

    return data.getRowGroup(name)?.key || OTHER_METRICS_GROUP_KEY;
  };

  const name: string | undefined = data.names[data.index];
  const key: string | null = keyOf(name);

  if (
    key === null ||
    (data.index > 0 && keyOf(data.names[data.index - 1]) === key)
  ) {
    return null;
  }

  return data.getRowGroup(name!)?.title || OTHER_METRICS_GROUP_TITLE;
}
