import Service from "Common/Models/DatabaseModels/Service";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { SparklinePoint } from "../MetricSparkline";

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
