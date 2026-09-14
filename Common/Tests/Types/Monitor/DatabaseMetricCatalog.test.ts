import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getAllDatabaseMetrics,
  getDatabaseMetricById,
  getDatabaseMetricByMetricType,
  getDatabaseMetricCategoryDescription,
  getDatabaseMetricCategoryOrder,
  getDatabaseMetricsByCategory,
  getDatabaseMetricsByGroup,
  getDatabaseMetricsForEngine,
  isDatabaseMetricType,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "../../../Types/Monitor/SqlDatabaseType";
import { describe, expect, test } from "@jest/globals";

/*
 * The catalog is the only place a Database Health metric is declared: title,
 * legend, unit, description, aggregation, display card, collection group and
 * engine support all resolve through it. A row that is malformed here does
 * not throw - it produces a blank chart legend, a chart that is aggregated
 * the wrong way, or a criterion an operator can set but that can never be
 * met. These tests are what turns those into failures.
 */

const DATABASE_METRIC_PREFIX: string = "oneuptime.monitor.database.";

const allMetrics: Array<DatabaseMetricDefinition> = getAllDatabaseMetrics();
const orderedCategories: Array<DatabaseMetricCategory> =
  getDatabaseMetricCategoryOrder();
const supportedEngines: Array<SqlDatabaseType> =
  SqlDatabaseTypeUtil.getSupportedDatabaseTypes();

/*
 * Units are not free text: the summary view and the criteria expectation
 * builder pick a formatter from this value, so an invented unit renders as a
 * raw number with a stray suffix.
 */
const KNOWN_UNITS: Array<string> = ["", "%", "s", "ms", "bytes"];

describe("DatabaseMetricCatalog", () => {
  test("returns a non-empty catalog", () => {
    expect(allMetrics.length).toBeGreaterThan(0);
  });

  test("getAllDatabaseMetrics hands back a copy, not the live array", () => {
    const first: Array<DatabaseMetricDefinition> = getAllDatabaseMetrics();
    first.pop();
    expect(getAllDatabaseMetrics().length).toBe(allMetrics.length);
  });

  test("every definition has the fields the UI renders", () => {
    for (const metric of allMetrics) {
      expect(metric.id.length).toBeGreaterThan(0);
      expect(metric.friendlyName.length).toBeGreaterThan(0);
      expect(metric.description.length).toBeGreaterThan(0);
      expect(metric.metricType.length).toBeGreaterThan(0);
    }
  });

  test("ids are stable kebab-case identifiers and are unique", () => {
    const ids: Array<string> = allMetrics.map(
      (metric: DatabaseMetricDefinition) => {
        return metric.id;
      },
    );

    for (const id of ids) {
      expect(id).toMatch(/^database-[a-z0-9-]+$/);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric types are unique", () => {
    const metricTypes: Array<MonitorMetricType> = allMetrics.map(
      (metric: DatabaseMetricDefinition) => {
        return metric.metricType;
      },
    );

    expect(new Set(metricTypes).size).toBe(metricTypes.length);
  });

  test("every definition uses a declared aggregation, category and group", () => {
    for (const metric of allMetrics) {
      expect(Object.values(AggregationType)).toContain(
        metric.defaultAggregation,
      );
      expect(Object.values(DatabaseMetricCategory)).toContain(metric.category);
      expect(Object.values(DatabaseMetricGroup)).toContain(metric.group);
    }
  });

  test("every definition uses a unit the formatters understand", () => {
    for (const metric of allMetrics) {
      expect(KNOWN_UNITS).toContain(metric.unit);
    }
  });

  /*
   * Averaging a counter inside a time bucket produces a number that means
   * nothing. Max returns the latest sample, which the chart differences into
   * a rate. Counters are identified by their description because the series
   * name is not a reliable signal - "connections.total" is a gauge.
   */
  test("cumulative counters aggregate with Max", () => {
    const counters: Array<DatabaseMetricDefinition> = allMetrics.filter(
      (metric: DatabaseMetricDefinition) => {
        return metric.description.startsWith("Cumulative");
      },
    );

    // Guards against a wording change quietly emptying the set.
    expect(counters.length).toBeGreaterThanOrEqual(10);

    for (const counter of counters) {
      expect(counter.defaultAggregation).toBe(AggregationType.Max);
    }
  });

  /*
   * Open connections is a gauge despite the ".total" suffix its series name
   * inherited. Averaging it is correct; treating it as a counter would chart
   * a meaningless step function.
   */
  test("open connections is a gauge, not a counter", () => {
    const connections: DatabaseMetricDefinition | null =
      getDatabaseMetricByMetricType(MonitorMetricType.DatabaseConnectionsTotal);

    expect(connections?.metricType.endsWith(".total")).toBe(true);
    expect(connections?.defaultAggregation).toBe(AggregationType.Avg);
  });

  test("every definition names at least one engine that can produce it", () => {
    for (const metric of allMetrics) {
      expect(metric.engines.length).toBeGreaterThan(0);

      for (const engine of metric.engines) {
        expect(supportedEngines).toContain(engine);
      }

      // A duplicated engine would double a metric in the picker.
      expect(new Set(metric.engines).size).toBe(metric.engines.length);
    }
  });
});

/*
 * The enum carries the series names because MonitorMetricUtil writes rows
 * keyed by MonitorMetricType; the catalog carries everything else. A member
 * added to one and not the other fails silently - a series with no title and
 * no description, or a catalog row that never gets written.
 */
describe("catalog and MonitorMetricType do not drift apart", () => {
  test("every database series in the enum has a catalog definition", () => {
    const undeclared: Array<string> = Object.values(MonitorMetricType).filter(
      (metricType: MonitorMetricType) => {
        return (
          metricType.startsWith(DATABASE_METRIC_PREFIX) &&
          getDatabaseMetricByMetricType(metricType) === null
        );
      },
    );

    expect(undeclared).toEqual([]);
  });

  test("every catalog definition points at a database series in the enum", () => {
    const enumValues: Array<string> = Object.values(MonitorMetricType);

    for (const metric of allMetrics) {
      expect(enumValues).toContain(metric.metricType);
      expect(metric.metricType.startsWith(DATABASE_METRIC_PREFIX)).toBe(true);
    }
  });

  /*
   * isDatabaseMetricType gates a prelude in front of five metadata switches
   * in MonitorMetricTypeUtil. If a shared probe series ever matched, the
   * catalog would hijack the title and unit of every monitor type that uses
   * it, not just Database Health.
   */
  test("shared probe series are not database metrics", () => {
    for (const metric of allMetrics) {
      expect(isDatabaseMetricType(metric.metricType)).toBe(true);
    }

    for (const shared of [
      MonitorMetricType.IsOnline,
      MonitorMetricType.ResponseTime,
      MonitorMetricType.CPUUsagePercent,
      MonitorMetricType.ExecutionTime,
    ]) {
      expect(isDatabaseMetricType(shared)).toBe(false);
    }
  });
});

describe("categories", () => {
  test("the display order lists every category exactly once", () => {
    expect(new Set(orderedCategories).size).toBe(orderedCategories.length);
    expect([...orderedCategories].sort()).toEqual(
      Object.values(DatabaseMetricCategory).sort(),
    );
  });

  test("every category has at least one metric and a description", () => {
    for (const category of orderedCategories) {
      expect(getDatabaseMetricsByCategory(category).length).toBeGreaterThan(0);
      expect(
        getDatabaseMetricCategoryDescription(category).length,
      ).toBeGreaterThan(0);
    }
  });

  test("getDatabaseMetricsByCategory returns only that category", () => {
    for (const category of orderedCategories) {
      for (const metric of getDatabaseMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("an unknown category has no description rather than undefined", () => {
    expect(
      getDatabaseMetricCategoryDescription(
        "Not A Category" as DatabaseMetricCategory,
      ),
    ).toBe("");
  });
});

/*
 * Groups are the unit of graceful degradation: the probe runs one query per
 * group and reports a group it could not read. A group with no metrics would
 * be a degradation notice an operator can do nothing with.
 */
describe("collection groups", () => {
  test("every declared group has at least one metric", () => {
    for (const group of Object.values(DatabaseMetricGroup)) {
      expect(getDatabaseMetricsByGroup(group).length).toBeGreaterThan(0);
    }
  });

  test("getDatabaseMetricsByGroup returns only that group", () => {
    for (const group of Object.values(DatabaseMetricGroup)) {
      for (const metric of getDatabaseMetricsByGroup(group)) {
        expect(metric.group).toBe(group);
      }
    }
  });

  test("grouping partitions the catalog", () => {
    const grouped: number = Object.values(DatabaseMetricGroup).reduce(
      (total: number, group: DatabaseMetricGroup) => {
        return total + getDatabaseMetricsByGroup(group).length;
      },
      0,
    );

    expect(grouped).toBe(allMetrics.length);
  });
});

describe("lookups", () => {
  test("getDatabaseMetricByMetricType round-trips every definition", () => {
    for (const metric of allMetrics) {
      expect(getDatabaseMetricByMetricType(metric.metricType)).toEqual(metric);
    }
  });

  test("getDatabaseMetricById round-trips every definition", () => {
    for (const metric of allMetrics) {
      expect(getDatabaseMetricById(metric.id)).toEqual(metric);
    }
  });

  /*
   * Null rather than undefined: DatabaseMonitorCriteria returns early on a
   * null definition, which is how a criterion naming a metric that no longer
   * exists stops evaluating instead of throwing on every check.
   */
  test("unknown keys resolve to null", () => {
    expect(getDatabaseMetricById("does-not-exist")).toBeNull();
    expect(getDatabaseMetricById("")).toBeNull();
    expect(
      getDatabaseMetricByMetricType("not.a.series" as MonitorMetricType),
    ).toBeNull();
  });
});

/*
 * Engine support is verified against live servers (PostgreSQL 15.18, MySQL
 * 8.4.11, SQL Server 2022), not inferred from documentation. The picker
 * builds from these lists, so a wrong entry offers an operator a threshold on
 * a series their engine will never write - a criterion that sits permanently
 * unmet and looks like a working alert.
 */
describe("engine support", () => {
  test("every supported engine can produce some metric", () => {
    for (const engine of supportedEngines) {
      const metrics: Array<DatabaseMetricDefinition> =
        getDatabaseMetricsForEngine(engine);

      expect(metrics.length).toBeGreaterThan(0);

      for (const metric of metrics) {
        expect(metric.engines).toContain(engine);
      }
    }
  });

  test("no metric is stranded with no engine that can write it", () => {
    const reachable: Set<MonitorMetricType> = new Set<MonitorMetricType>();

    for (const engine of supportedEngines) {
      for (const metric of getDatabaseMetricsForEngine(engine)) {
        reachable.add(metric.metricType);
      }
    }

    expect(reachable.size).toBe(allMetrics.length);
  });

  test("PostgreSQL-only maintenance metrics are absent from MySQL", () => {
    const mysql: Array<MonitorMetricType> = getDatabaseMetricsForEngine(
      SqlDatabaseType.MySQL,
    ).map((metric: DatabaseMetricDefinition) => {
      return metric.metricType;
    });

    expect(mysql).not.toContain(
      MonitorMetricType.DatabaseTransactionIdUsedPercent,
    );
    expect(mysql).not.toContain(MonitorMetricType.DatabaseDeadTuples);
    expect(mysql).toContain(MonitorMetricType.DatabaseTempDiskTablesTotal);
  });

  // Stock MySQL exposes no deadlock counter at all.
  test("deadlocks are PostgreSQL and SQL Server only", () => {
    const deadlocks: DatabaseMetricDefinition | null =
      getDatabaseMetricByMetricType(MonitorMetricType.DatabaseDeadlocksTotal);

    expect(deadlocks?.engines).toEqual([
      SqlDatabaseType.PostgreSQL,
      SqlDatabaseType.MicrosoftSqlServer,
    ]);
  });

  /*
   * SQL Server's `user connections` setting defaults to 0, meaning
   * unlimited, so a percentage of the ceiling has no denominator there.
   */
  test("the connection ceiling and its percentage skip SQL Server", () => {
    for (const metricType of [
      MonitorMetricType.DatabaseConnectionsMax,
      MonitorMetricType.DatabaseConnectionsUsedPercent,
    ]) {
      expect(getDatabaseMetricByMetricType(metricType)?.engines).not.toContain(
        SqlDatabaseType.MicrosoftSqlServer,
      );
    }
  });

  /*
   * The degradation counter is produced by the collector, not read from the
   * engine, so it must survive on every engine - it is the series an
   * operator alerts on to notice they have lost visibility.
   */
  test("the failed-group counter is available on every engine", () => {
    const failed: DatabaseMetricDefinition | null =
      getDatabaseMetricByMetricType(
        MonitorMetricType.DatabaseMetricGroupsFailed,
      );

    expect(failed).not.toBeNull();

    for (const engine of supportedEngines) {
      expect(failed?.engines).toContain(engine);
    }
  });
});
