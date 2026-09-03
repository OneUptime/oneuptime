import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  getAllDatabaseMetrics,
  getDatabaseMetricsForEngine,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "../../../Utils/Monitor/MonitorMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorMetricTypeUtil is the mapping table between monitor types, criteria
 * CheckOn values, metric types, and their display metadata. Two kinds of test:
 *
 *   - Targeted: representative enum mappings + the throw paths.
 *   - Invariant: for EVERY metric a monitor type actually displays, the
 *     aggregation/title/description lookups must resolve (no "Invalid ..."
 *     throw, no empty title). This is what catches a metric added to a
 *     monitor's list but forgotten in one of the switch statements.
 */

const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(MonitorType);

describe("getAggregationTypeByMonitorMetricType", () => {
  test("maps representative gauges and counters", () => {
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.ResponseTime,
      ),
    ).toBe(AggregationType.Avg);
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.ResponseStatusCode,
      ),
    ).toBe(AggregationType.Max);
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.IsOnline,
      ),
    ).toBe(AggregationType.Min);
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.PortDnsLookupTime,
      ),
    ).toBe(AggregationType.Avg);
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.PortTcpConnectTime,
      ),
    ).toBe(AggregationType.Avg);
  });

  test("cumulative byte/op counters aggregate with Max (latest-in-bucket)", () => {
    for (const counter of [
      MonitorMetricType.DiskReadBytesTotal,
      MonitorMetricType.NetworkBytesReceivedTotal,
      MonitorMetricType.HostUptimeSeconds,
    ]) {
      expect(
        MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(counter),
      ).toBe(AggregationType.Max);
    }
  });

  test("throws for an unrecognized metric type", () => {
    expect(() => {
      return MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        "not-a-metric" as MonitorMetricType,
      );
    }).toThrow("Invalid MonitorMetricType value");
  });
});

describe("getMonitorMeticTypeByCheckOn", () => {
  test("maps criteria CheckOn values to their metric type", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(CheckOn.ResponseTime),
    ).toBe(MonitorMetricType.ResponseTime);
    expect(
      MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(
        CheckOn.CPUIoWaitPercent,
      ),
    ).toBe(MonitorMetricType.CPUTimeIoWaitPercent);
    expect(
      MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(
        CheckOn.PortDnsLookupTime,
      ),
    ).toBe(MonitorMetricType.PortDnsLookupTime);
    expect(
      MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(
        CheckOn.PortTcpConnectTime,
      ),
    ).toBe(MonitorMetricType.PortTcpConnectTime);
  });

  test("throws for a CheckOn without a metric mapping", () => {
    expect(() => {
      return MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(
        "unmapped" as CheckOn,
      );
    }).toThrow("Invalid CheckOn value");
  });
});

describe("getMonitorMetricTypesByMonitorType", () => {
  test("API and Website expose availability + timing breakdown", () => {
    const api: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(MonitorType.API);
    expect(api).toContain(MonitorMetricType.IsOnline);
    expect(api).toContain(MonitorMetricType.ResponseTime);
    expect(api).toContain(MonitorMetricType.TimeToFirstByte);
    // Website mirrors API.
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Website,
      ),
    ).toEqual(api);
  });

  test("Server exposes the rich resource metric set", () => {
    const server: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Server,
      );
    expect(server).toContain(MonitorMetricType.CPUUsagePercent);
    expect(server).toContain(MonitorMetricType.MemoryUsagePercent);
    expect(server.length).toBeGreaterThan(10);
  });

  test("Ping/IP add packet-level metrics", () => {
    const ping: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Ping,
      );
    expect(ping).toContain(MonitorMetricType.PacketLossPercent);
    expect(ping).toContain(MonitorMetricType.Jitter);
  });

  test("Port exposes total connection time and its Port-specific phases", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Port,
      ),
    ).toEqual([
      MonitorMetricType.IsOnline,
      MonitorMetricType.ResponseTime,
      MonitorMetricType.PortDnsLookupTime,
      MonitorMetricType.PortTcpConnectTime,
    ]);
  });

  test("Port phase metrics do not alias the HTTP phase metric names", () => {
    expect(MonitorMetricType.PortDnsLookupTime).toBe(
      "oneuptime.monitor.port.dns.lookup.time",
    );
    expect(MonitorMetricType.PortTcpConnectTime).toBe(
      "oneuptime.monitor.port.tcp.connect.time",
    );
    expect(MonitorMetricType.PortDnsLookupTime).not.toBe(
      MonitorMetricType.DnsLookupTime,
    );
    expect(MonitorMetricType.PortTcpConnectTime).not.toBe(
      MonitorMetricType.TcpConnectTime,
    );
  });

  test("a monitor type with no metrics returns an empty list", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Manual,
      ),
    ).toEqual([]);
  });
});

describe("getMonitorMetricCategoriesByMonitorType", () => {
  test("Server gets a multi-card layout", () => {
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.Server,
      );
    expect(categories.length).toBeGreaterThan(1);
    expect(
      categories.every((c: MonitorMetricCategory) => {
        return c.title.length > 0 && c.metrics.length > 0;
      }),
    ).toBe(true);
  });

  test("non-server types fall through to a single category matching the flat list", () => {
    const flat: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(MonitorType.API);
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.API,
      );
    expect(categories).toHaveLength(1);
    expect(categories[0]!.metrics).toEqual(flat);
  });

  test("a metric-less monitor type yields no categories", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.Manual,
      ),
    ).toEqual([]);
  });
});

describe("display metadata", () => {
  test("legend defaults to the title", () => {
    expect(
      MonitorMetricTypeUtil.getLegendByMonitorMetricType(
        MonitorMetricType.ResponseTime,
      ),
    ).toBe(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.ResponseTime,
      ),
    );
  });

  test("legend units reflect the metric's dimension", () => {
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.ResponseTime,
      ),
    ).toBe("ms");
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.CPUUsagePercent,
      ),
    ).toBe("%");
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.ResponseStatusCode,
      ),
    ).toBe("");
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.PortDnsLookupTime,
      ),
    ).toBe("ms");
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.PortTcpConnectTime,
      ),
    ).toBe("ms");
  });

  test("Port phase metrics have distinct user-facing metadata", () => {
    expect(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.PortDnsLookupTime,
      ),
    ).toBe("Port DNS Lookup Time");
    expect(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.PortTcpConnectTime,
      ),
    ).toBe("Port TCP Connect Time");
    expect(
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.PortDnsLookupTime,
      ),
    ).toContain("IP address");
    expect(
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.PortTcpConnectTime,
      ),
    ).toContain("IPv6/IPv4 fallback");
  });

  test("contextualizes the existing response-time metric for Port charts", () => {
    expect(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Port,
      ),
    ).toBe("Total Connection Time (DNS + TCP)");
    expect(
      MonitorMetricTypeUtil.getLegendByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Port,
      ),
    ).toBe("Total Connection Time (DNS + TCP)");
    expect(
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Port,
      ),
    ).toContain("resolving the hostname");
  });

  test("keeps response-time metadata unchanged outside Port charts", () => {
    expect(
      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Website,
      ),
    ).toBe("Response Time");
    expect(
      MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        MonitorMetricType.ResponseTime,
        MonitorType.Website,
      ),
    ).toContain("server to respond to a request");
  });
});

describe("invariant: every displayed metric resolves its metadata", () => {
  test("no monitor type displays a metric missing from the lookup tables", () => {
    for (const monitorType of ALL_MONITOR_TYPES) {
      const metrics: Array<MonitorMetricType> =
        MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType);

      for (const metric of metrics) {
        // Aggregation lookup must not throw.
        expect(() => {
          return MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
            metric,
          );
        }).not.toThrow();

        // Title and description must be present for anything shown to a user.
        expect(
          MonitorMetricTypeUtil.getTitleByMonitorMetricType(metric).length,
        ).toBeGreaterThan(0);
        expect(
          MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(metric)
            .length,
        ).toBeGreaterThan(0);
      }
    }
  });
});

/*
 * Regression suite for https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * SSLCertificate was missing from getMonitorMetricTypesByMonitorType, so it
 * fell through to `return []`. getMonitorMetricCategoriesByMonitorType
 * short-circuits on an empty metric list and the dashboard hides the whole
 * Monitor Metrics tab when there are no categories - so an SSL monitor
 * showed no charts at all, even though IsOnline rows were being written to
 * ClickHouse on every single check. An operator therefore had no way to see
 * that their monitor was running, which is a large part of why the issue was
 * reported as "the monitor never executes".
 *
 * The invariant test above cannot catch this: it iterates the metrics a type
 * already lists, so an empty list passes vacuously.
 */
describe("SSL Certificate monitor metrics (issue #3225)", () => {
  test("SSLCertificate reports IsOnline and ResponseTime", () => {
    const metrics: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.SSLCertificate,
      );

    expect(metrics).toContain(MonitorMetricType.IsOnline);
    expect(metrics).toContain(MonitorMetricType.ResponseTime);
  });

  test("SSLCertificate produces at least one display category", () => {
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.SSLCertificate,
      );

    // An empty list is what made the dashboard hide the metrics tab.
    expect(categories.length).toBeGreaterThan(0);
  });
});

describe("invariant: every probeable monitor type displays some metric", () => {
  test("no probeable type falls through to an empty metric list", () => {
    const typesWithoutMetrics: Array<MonitorType> = [];

    for (const monitorType of ALL_MONITOR_TYPES) {
      if (!MonitorTypeHelper.isProbableMonitor(monitorType)) {
        continue;
      }

      const metrics: Array<MonitorMetricType> =
        MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType);

      if (metrics.length === 0) {
        typesWithoutMetrics.push(monitorType);
      }
    }

    /*
     * Asserting on the collected list rather than per-type so a failure
     * names every offender at once - this is the structural hole that let
     * SSLCertificate ship with no charts.
     */
    expect(typesWithoutMetrics).toEqual([]);
  });
});

/*
 * The null-returning variant exists because over-time evaluation asks "is
 * there a series behind this CheckOn?" for every filter it sees. It used to
 * ask by calling the throwing variant inside a try/catch that swallowed the
 * error and quietly compared the instantaneous value instead - so "evaluate
 * over time" was a silent no-op for every CheckOn missing from the map.
 */
describe("getMonitorMetricTypeByCheckOnOrNull", () => {
  test("returns the same series as the throwing variant for mapped CheckOns", () => {
    const mapped: Array<CheckOn> = [
      CheckOn.ResponseTime,
      CheckOn.ResponseStatusCode,
      CheckOn.IsOnline,
      CheckOn.CPUUsagePercent,
      CheckOn.MemoryUsagePercent,
      CheckOn.DiskUsagePercent,
      CheckOn.PacketLossPercent,
      CheckOn.Jitter,
      CheckOn.PortDnsLookupTime,
      CheckOn.PortTcpConnectTime,
    ];

    for (const checkOn of mapped) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(checkOn),
      ).toBe(MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(checkOn));
    }
  });

  /*
   * DNS, SNMP and External Status Page probes write into the shared online
   * and response-time series like every other probe check, and the criteria
   * UI advertises all six of these as over-time capable - but none of them
   * had a mapping, so the window could never be read.
   */
  test("maps the DNS / SNMP / status page online checks onto the online series", () => {
    for (const checkOn of [
      CheckOn.DnsIsOnline,
      CheckOn.SnmpIsOnline,
      CheckOn.ExternalStatusPageIsOnline,
    ]) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(checkOn),
      ).toBe(MonitorMetricType.IsOnline);
    }
  });

  test("maps their response time checks onto the response time series", () => {
    for (const checkOn of [
      CheckOn.DnsResponseTime,
      CheckOn.SnmpResponseTime,
      CheckOn.ExternalStatusPageResponseTime,
    ]) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(checkOn),
      ).toBe(MonitorMetricType.ResponseTime);
    }
  });

  test("returns null instead of throwing for CheckOns no series records", () => {
    for (const checkOn of [
      CheckOn.ResponseBody,
      CheckOn.ResponseHeader,
      CheckOn.IsRequestTimeout,
      CheckOn.JavaScriptExpression,
      CheckOn.IncomingRequest,
    ]) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(checkOn),
      ).toBeNull();
    }
  });

  test("the throwing variant still throws for those CheckOns", () => {
    expect(() => {
      MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(CheckOn.ResponseBody);
    }).toThrow();
  });
});

/*
 * Database Health declares its ~40 series in DatabaseMetricCatalog rather
 * than in the five metadata switches in this util; a short prelude in each
 * switch resolves them. A prelude that is missing does not throw - it
 * renders a chart with a blank legend, no unit, or the wrong aggregation.
 * These sweep the whole catalog through the public lookups so a metric can
 * never end up half-wired.
 */
describe("Database Health metric metadata", () => {
  const catalog: Array<DatabaseMetricDefinition> = getAllDatabaseMetrics();

  test("every catalog metric resolves its display metadata", () => {
    for (const metric of catalog) {
      expect(
        MonitorMetricTypeUtil.getTitleByMonitorMetricType(metric.metricType),
      ).toBe(metric.friendlyName);
      expect(
        MonitorMetricTypeUtil.getLegendByMonitorMetricType(metric.metricType),
      ).toBe(metric.friendlyName);
      expect(
        MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
          metric.metricType,
        ),
      ).toBe(metric.unit);
      expect(
        MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
          metric.metricType,
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  test("every catalog metric aggregates the way the catalog says", () => {
    for (const metric of catalog) {
      expect(
        MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
          metric.metricType,
        ),
      ).toBe(metric.defaultAggregation);
    }
  });

  /*
   * The preludes run before the switches, so a catalog row that ever matched
   * a shared series would rewrite the metadata of every monitor type using
   * it, not just Database Health.
   */
  test("the catalog does not shadow the shared probe series", () => {
    expect(
      MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
        MonitorMetricType.ResponseTime,
      ),
    ).toBe("ms");
    expect(
      MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
        MonitorMetricType.IsOnline,
      ),
    ).toBe(AggregationType.Min);
  });
});

describe("Database Health metric lists and cards", () => {
  const catalog: Array<DatabaseMetricDefinition> = getAllDatabaseMetrics();

  test("Database exposes availability plus every catalog series", () => {
    const metrics: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
        MonitorType.Database,
      );

    expect(metrics[0]).toBe(MonitorMetricType.IsOnline);
    expect(metrics[1]).toBe(MonitorMetricType.ResponseTime);

    for (const metric of catalog) {
      expect(metrics).toContain(metric.metricType);
    }

    expect(metrics.length).toBe(catalog.length + 2);
  });

  test("with no engine chosen the cards show the full capability set", () => {
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getDatabaseMetricCategories();

    const shown: Array<MonitorMetricType> = categories.flatMap(
      (category: MonitorMetricCategory) => {
        return category.metrics;
      },
    );

    for (const metric of catalog) {
      expect(shown).toContain(metric.metricType);
    }
  });

  /*
   * A card of permanently empty charts is worse than no card: it reads as a
   * broken monitor rather than as an engine that does not report the data.
   */
  test("a MySQL monitor drops the cards its engine can never fill", () => {
    const mysqlMetrics: Array<MonitorMetricType> = getDatabaseMetricsForEngine(
      SqlDatabaseType.MySQL,
    ).map((metric: DatabaseMetricDefinition) => {
      return metric.metricType;
    });

    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getDatabaseMetricCategories(SqlDatabaseType.MySQL);

    const titles: Array<string> = categories.map(
      (category: MonitorMetricCategory) => {
        return category.title;
      },
    );

    // Every PostgreSQL-only vacuum and wraparound metric lives on this card.
    expect(titles).not.toContain(DatabaseMetricCategory.Maintenance);

    for (const category of categories) {
      expect(category.title.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
      expect(category.metrics.length).toBeGreaterThan(0);

      for (const metric of category.metrics) {
        if (
          metric === MonitorMetricType.IsOnline ||
          metric === MonitorMetricType.ResponseTime
        ) {
          continue;
        }

        expect(mysqlMetrics).toContain(metric);
      }
    }
  });

  test("PostgreSQL keeps the maintenance card", () => {
    const categories: Array<MonitorMetricCategory> =
      MonitorMetricTypeUtil.getDatabaseMetricCategories(
        SqlDatabaseType.PostgreSQL,
      );

    const titles: Array<string> = categories.map(
      (category: MonitorMetricCategory) => {
        return category.title;
      },
    );

    expect(titles).toContain(DatabaseMetricCategory.Maintenance);
  });

  /*
   * Availability carries the shared probe series on top of its catalog
   * metrics, so it is the one card that must render whatever the engine.
   */
  test("availability is the first card on every engine", () => {
    for (const engine of [
      SqlDatabaseType.PostgreSQL,
      SqlDatabaseType.MySQL,
      SqlDatabaseType.MicrosoftSqlServer,
    ]) {
      const categories: Array<MonitorMetricCategory> =
        MonitorMetricTypeUtil.getDatabaseMetricCategories(engine);

      expect(categories[0]?.title).toBe(DatabaseMetricCategory.Availability);
      expect(categories[0]?.metrics).toContain(MonitorMetricType.IsOnline);
      expect(categories[0]?.metrics).toContain(MonitorMetricType.ResponseTime);
    }
  });

  test("the monitor type routes through the database cards", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
        MonitorType.Database,
        SqlDatabaseType.MySQL,
      ),
    ).toEqual(
      MonitorMetricTypeUtil.getDatabaseMetricCategories(SqlDatabaseType.MySQL),
    );
  });
});

/*
 * Database Health filters name their series in databaseMonitorOptions rather
 * than in the CheckOn, because one CheckOn covers all 40. Resolving from the
 * CheckOn alone returns null, which turns "evaluate over time" back into an
 * instantaneous comparison while the UI still offers the toggle - so
 * EvaluateOverTime has to ask with the whole filter.
 */
describe("getMonitorMetricTypeByCriteriaFilterOrNull", () => {
  const buildFilter: (filter: Partial<CriteriaFilter>) => CriteriaFilter = (
    filter: Partial<CriteriaFilter>,
  ): CriteriaFilter => {
    return {
      checkOn: CheckOn.DatabaseMetric,
      filterType: FilterType.GreaterThan,
      value: "90",
      ...filter,
    };
  };

  test("resolves the series a database metric filter names", () => {
    for (const metric of getAllDatabaseMetrics()) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
          buildFilter({
            databaseMonitorOptions: { metricType: metric.metricType },
          }),
        ),
      ).toBe(metric.metricType);
    }
  });

  test("returns null when the filter names no series", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        buildFilter({}),
      ),
    ).toBeNull();
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        buildFilter({ databaseMonitorOptions: {} }),
      ),
    ).toBeNull();
  });

  test("the database online check reads the shared online series", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        buildFilter({
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.True,
          value: undefined,
        }),
      ),
    ).toBe(MonitorMetricType.IsOnline);
  });

  test("collection errors are text, not a series", () => {
    expect(
      MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
        buildFilter({
          checkOn: CheckOn.DatabaseCollectionError,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        }),
      ),
    ).toBeNull();
  });

  test("every other CheckOn still resolves the way it always did", () => {
    for (const checkOn of [
      CheckOn.CPUUsagePercent,
      CheckOn.ResponseTime,
      CheckOn.DnsIsOnline,
      CheckOn.JavaScriptExpression,
    ]) {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
          buildFilter({ checkOn: checkOn }),
        ),
      ).toBe(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(checkOn),
      );
    }
  });
});
