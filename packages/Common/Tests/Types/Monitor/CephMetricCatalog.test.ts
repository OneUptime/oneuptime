import {
  CephMetricCategory,
  CephMetricDefinition,
  getAllCephMetricCategories,
  getAllCephMetrics,
  getCephMetricById,
  getCephMetricByMetricName,
  getCephMetricsByCategory,
  getCephCustomMetricAggregations,
  getCephGroupByKeyForScope,
} from "../../../Types/Monitor/CephMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { CephResourceScope } from "../../../Types/Monitor/MonitorStepCephMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { describe, expect, test } from "@jest/globals";

const SAYS_SUM_COUNTS: RegExp = /sum (it )?to count|sum across|sum to count/i;
const SAYS_GROUP_BY_POOL: RegExp = /group (both )?by pool_id/i;
const SAYS_ADVANCED: RegExp = /Advanced/;

describe("CephMetricCatalog", () => {
  const allMetrics: Array<CephMetricDefinition> = getAllCephMetrics();
  const allCategories: Array<CephMetricCategory> = getAllCephMetricCategories();
  const validAggregations: Array<string> = Object.values(AggregationType);

  test("returns a non-empty catalog", () => {
    expect(Array.isArray(allMetrics)).toBe(true);
    expect(allMetrics.length).toBeGreaterThan(0);
  });

  test("every metric definition has all required non-empty fields", () => {
    for (const metric of allMetrics) {
      expect(typeof metric.id).toBe("string");
      expect(metric.id.length).toBeGreaterThan(0);
      expect(metric.friendlyName.length).toBeGreaterThan(0);
      expect(metric.description.length).toBeGreaterThan(0);
      expect(metric.metricName.length).toBeGreaterThan(0);
      expect(metric.category.length).toBeGreaterThan(0);
    }
  });

  test("every metric uses a valid aggregation type", () => {
    for (const metric of allMetrics) {
      expect(validAggregations).toContain(metric.defaultAggregation);
    }
  });

  test("metric ids are unique", () => {
    const ids: Array<string> = allMetrics.map((m: CephMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map((m: CephMetricDefinition) => {
      return m.metricName;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  test("every metric category is a declared category", () => {
    for (const metric of allMetrics) {
      expect(allCategories).toContain(metric.category);
    }
  });

  test("declared categories are unique and non-empty", () => {
    expect(allCategories.length).toBeGreaterThan(0);
    expect(new Set(allCategories).size).toBe(allCategories.length);
  });

  test("every declared category has at least one metric", () => {
    for (const category of allCategories) {
      expect(getCephMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getCephMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getCephMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getCephMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getCephMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getCephMetricById returns undefined for an unknown id", () => {
    expect(getCephMetricById("does-not-exist")).toBeUndefined();
    expect(getCephMetricById("")).toBeUndefined();
  });

  test("getCephMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getCephMetricByMetricName(metric.metricName)).toEqual(metric);
    }
  });

  test("getCephMetricByMetricName returns undefined for an unknown name", () => {
    expect(getCephMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  test("known metrics are present", () => {
    expect(getCephMetricByMetricName("ceph_health_status")).toBeDefined();
    expect(getCephMetricByMetricName("ceph_health_detail")).toBeDefined();
  });
});

/*
 * The agent scrapes every 30 seconds and a metric monitor reads one-minute
 * buckets, so a Sum adds two or three scrapes of every series: with 12 OSDs
 * and one down, "OSD Up < 12" read 22 to 24 and never fired. No default
 * adds scrapes together.
 */
describe("CephMetricCatalog - defaults that do not add scrapes together (regression)", () => {
  test("no metric defaults to Sum", () => {
    for (const metric of getAllCephMetrics()) {
      expect({
        id: metric.id,
        sum: metric.defaultAggregation === "Sum",
      }).toEqual({ id: metric.id, sum: false });
    }
  });

  test("no description says to sum a series to count", () => {
    for (const metric of getAllCephMetrics()) {
      expect({
        id: metric.id,
        says: SAYS_SUM_COUNTS.test(metric.description),
      }).toEqual({ id: metric.id, says: false });
    }
  });

  test("up, in and quorum default to Min, so one OSD or monitor down reads 0", () => {
    for (const id of ["ceph-osd-up", "ceph-osd-in", "ceph-mon-quorum-status"]) {
      const metric: CephMetricDefinition | undefined = getCephMetricById(id);

      expect(metric?.defaultAggregation).toBe("Min");
      expect(metric?.description).toContain("the minimum reads 0");
    }
  });
});

/*
 * A Custom Metric is judged pool by pool or daemon by daemon, as the
 * templates are: ungrouped, a per-pool or per-OSD metric pooled the whole
 * cluster into one value, and the catalog told users to group by pool_id
 * in a form that could not. And it offers no Sum or Count, which add up
 * the 2 to 3 scrapes in every minute.
 */
describe("Ceph Custom Metric: grouping and aggregations", () => {
  test("a per-pool metric groups by pool_id, a per-daemon one by ceph_daemon, a cluster one not at all", () => {
    expect(getCephGroupByKeyForScope(CephResourceScope.Pool)).toBe("pool_id");
    expect(getCephGroupByKeyForScope(CephResourceScope.Osd)).toBe(
      "ceph_daemon",
    );
    expect(getCephGroupByKeyForScope(CephResourceScope.Mon)).toBe(
      "ceph_daemon",
    );
    expect(getCephGroupByKeyForScope(CephResourceScope.Cluster)).toBe(
      undefined,
    );
  });

  test("the placement-group metrics are per pool, and OSD Up and quorum per daemon", () => {
    for (const metricName of [
      "ceph_pg_total",
      "ceph_pg_active",
      "ceph_pg_clean",
      "ceph_pg_degraded",
      "ceph_pg_undersized",
    ]) {
      expect(
        getCephGroupByKeyForScope(
          getCephMetricByMetricName(metricName)?.defaultResourceScope,
        ),
      ).toBe("pool_id");
    }

    for (const metricName of [
      "ceph_osd_up",
      "ceph_osd_in",
      "ceph_mon_quorum_status",
    ]) {
      expect(
        getCephGroupByKeyForScope(
          getCephMetricByMetricName(metricName)?.defaultResourceScope,
        ),
      ).toBe("ceph_daemon");
    }
  });

  test("no description sends a Custom Metric to a group-by it does not have", () => {
    for (const metric of getAllCephMetrics()) {
      if (SAYS_GROUP_BY_POOL.test(metric.description)) {
        expect({ id: metric.id, saysAdvanced: true }).toEqual({
          id: metric.id,
          saysAdvanced: SAYS_ADVANCED.test(metric.description),
        });
      }
    }
  });

  test("Sum and Count are not offered, but a monitor saved with one keeps it", () => {
    expect(getCephCustomMetricAggregations(undefined)).toEqual([
      MetricsAggregationType.Avg,
      MetricsAggregationType.Max,
      MetricsAggregationType.Min,
    ]);
    expect(
      getCephCustomMetricAggregations(MetricsAggregationType.Min),
    ).toHaveLength(3);
    expect(getCephCustomMetricAggregations(MetricsAggregationType.Sum)).toEqual(
      [
        MetricsAggregationType.Avg,
        MetricsAggregationType.Max,
        MetricsAggregationType.Min,
        MetricsAggregationType.Sum,
      ],
    );
  });

  test("no catalog metric defaults to an aggregation the form does not offer", () => {
    for (const metric of getAllCephMetrics()) {
      expect({
        id: metric.id,
        offered: getCephCustomMetricAggregations(undefined).includes(
          metric.defaultAggregation,
        ),
      }).toEqual({ id: metric.id, offered: true });
    }
  });

  test("the health-check metric says a cleared check reads 0", () => {
    expect(
      getCephMetricByMetricName("ceph_health_detail")?.description,
    ).toContain("0 after it clears");
  });
});
