import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

/**
 * Phase 1 — shape-collapsed metric monitor evaluation.
 *
 * Many metric monitors issue the SAME aggregate read differing only by metric
 * name and/or the entity they scope to (e.g. 100k hosts each with a "cpu > 90"
 * monitor, or one host with monitors on cpu/mem/disk). Evaluating each with its
 * own ClickHouse query makes query-rate scale with monitor count. Instead we
 * bucket monitors by a canonical query SHAPE and serve every monitor in a
 * bucket from ONE batched multi-series rollup read
 * (`name IN (...) [AND primaryEntityId IN (...)] GROUP BY name, primaryEntityId`),
 * so query-rate scales with distinct-shape cardinality.
 *
 * This module is the pure planning layer: it has no I/O. It turns per-monitor
 * read intentions into shape buckets and provides the series-cache key that
 * routes a batched read's rows back to the monitor that asked for them. Only
 * MV-eligible flat reads collapse here (Sum/Avg/Min/Max/Count, no attribute
 * filters, no group-by) — anything else keeps its existing per-monitor path,
 * so correctness never depends on the collapse firing.
 */

export interface MetricReadPlan {
  monitorId: string;
  projectId: string;
  metricName: string;
  aggregationType: MetricsAggregationType;
  // Inclusive rolling window, normalized to whole seconds for shape stability.
  windowStartEpochSec: number;
  windowEndEpochSec: number;
  /*
   * Concrete entity ids this monitor scopes to, or null for a project-wide
   * read (aggregate across all entities for the metric). An empty array is
   * treated the same as null (no entity predicate).
   */
  primaryEntityIds: Array<string> | null;
  /*
   * Whether this read is eligible for the collapsed MV path. False plans are
   * never bucketed and always fall back to per-monitor evaluation.
   */
  collapsible: boolean;
}

/**
 * The shape key groups reads that can share a single batched MV statement.
 * Reads collapse when they target the same project, aggregation, window, and
 * entity-scoping MODE (project-wide vs entity-scoped) — they may differ in
 * metric name and in WHICH entities they scope to, both of which become
 * multi-series GROUP BY dimensions in the batched read.
 */
export function computeShapeKey(plan: MetricReadPlan): string {
  const scopeMode: string =
    plan.primaryEntityIds && plan.primaryEntityIds.length > 0
      ? "entity"
      : "project";

  return [
    "v1",
    plan.projectId,
    String(plan.aggregationType),
    String(plan.windowStartEpochSec),
    String(plan.windowEndEpochSec),
    scopeMode,
  ].join("|");
}

/**
 * Cache key for a single (metric name, entity) series produced by a batched
 * read. The batched read writes one entry per series under this key; each
 * monitor looks its series up by the same key. Entity is "" for project-wide
 * reads (the read has no primaryEntityId dimension).
 */
export function seriesCacheKey(input: {
  shapeKey: string;
  metricName: string;
  primaryEntityId: string | null;
}): string {
  return [input.shapeKey, input.metricName, input.primaryEntityId || ""].join(
    "::",
  );
}

export interface ShapeBucket {
  shapeKey: string;
  projectId: string;
  aggregationType: MetricsAggregationType;
  windowStartEpochSec: number;
  windowEndEpochSec: number;
  // Distinct metric names needed across every plan in the bucket.
  metricNames: Array<string>;
  /*
   * Distinct entity ids needed across the bucket, or null when the bucket is
   * project-wide (no entity predicate / no primaryEntityId GROUP BY dimension).
   */
  primaryEntityIds: Array<string> | null;
  plans: Array<MetricReadPlan>;
}

/**
 * Bucket collapsible plans by shape. Non-collapsible plans are returned
 * separately so the caller can evaluate them on the existing per-monitor path.
 */
export function groupReadPlansByShape(plans: Array<MetricReadPlan>): {
  buckets: Array<ShapeBucket>;
  uncollapsible: Array<MetricReadPlan>;
} {
  const bucketByKey: Map<string, ShapeBucket> = new Map();
  const uncollapsible: Array<MetricReadPlan> = [];

  for (const plan of plans) {
    if (!plan.collapsible) {
      uncollapsible.push(plan);
      continue;
    }

    const shapeKey: string = computeShapeKey(plan);
    let bucket: ShapeBucket | undefined = bucketByKey.get(shapeKey);

    if (!bucket) {
      bucket = {
        shapeKey,
        projectId: plan.projectId,
        aggregationType: plan.aggregationType,
        windowStartEpochSec: plan.windowStartEpochSec,
        windowEndEpochSec: plan.windowEndEpochSec,
        metricNames: [],
        primaryEntityIds:
          plan.primaryEntityIds && plan.primaryEntityIds.length > 0 ? [] : null,
        plans: [],
      };
      bucketByKey.set(shapeKey, bucket);
    }

    bucket.plans.push(plan);

    if (!bucket.metricNames.includes(plan.metricName)) {
      bucket.metricNames.push(plan.metricName);
    }

    if (bucket.primaryEntityIds && plan.primaryEntityIds) {
      for (const entityId of plan.primaryEntityIds) {
        if (!bucket.primaryEntityIds.includes(entityId)) {
          bucket.primaryEntityIds.push(entityId);
        }
      }
    }
  }

  return { buckets: Array.from(bucketByKey.values()), uncollapsible };
}

/**
 * The collapse ratio for an observability gauge: monitorsEvaluated / readsIssued.
 * 1.0 means no collapse (one read per monitor); higher is better. Returns 1
 * when there were no reads so the metric never divides by zero.
 */
export function computeCollapseRatio(input: {
  monitorsEvaluated: number;
  readsIssued: number;
}): number {
  if (input.readsIssued <= 0) {
    return 1;
  }
  return input.monitorsEvaluated / input.readsIssued;
}
