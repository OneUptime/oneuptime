import {
  XcpNgMetricCategory,
  XcpNgMetricDefinition,
  getAllXcpNgMetricCategories,
  getAllXcpNgMetrics,
  getXcpNgMetricById,
  getXcpNgMetricByMetricName,
  getXcpNgMetricCategoryLabel,
  getXcpNgMetricsByCategory,
} from "../../../Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XcpNgDerivedSeries,
  XcpNgSeries,
  XcpNgTelemetryUtil,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  OpenMetricsSample,
  parseOpenMetrics,
  readRecordedScrape,
} from "../../Server/Utils/Telemetry/XcpNgScrapeFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * The XCP-ng metric catalog against the recorded scrape: every series Xen
 * Orchestra's plugin sends for a pool, and every series OneUptime derives,
 * is described once, with the scope it describes and the unit its stored
 * values are in - the unit the trap's series are stored in (per second)
 * above all.
 */

const ALL: Array<XcpNgMetricDefinition> = getAllXcpNgMetrics();

const SERIES_IN_THE_LAB: Array<string> = Array.from(
  new Set(
    [
      ...parseOpenMetrics(readRecordedScrape(1)),
      ...parseOpenMetrics(readRecordedScrape(2)),
    ]
      .filter((s: OpenMetricsSample) => {
        return s.name.startsWith("xcp_");
      })
      .map((s: OpenMetricsSample) => {
        return s.name;
      }),
  ),
).sort();

// What Xen Orchestra's documentation lists for XOSTOR pools (none in the lab).
const XOSTOR_SERIES: Array<string> = [
  "xcp_xostor_up",
  "xcp_xostor_node_status",
  "xcp_xostor_resource_total",
  "xcp_xostor_resource_state_count",
  "xcp_xostor_alarms_up",
  "xcp_xostor_alarms_count",
  "xcp_xostor_smart_up",
  "xcp_xostor_disk_smart_status",
  "xcp_xostor_updates_up",
  "xcp_xostor_package_update_available",
];

const KNOWN_UNITS: Set<string> = new Set([
  "",
  "count",
  "ratio",
  "seconds",
  "bytes",
  "bytes/s",
  "ops/s",
  "W",
  "{errors/s}",
]);

describe("XcpNgMetricCatalog", () => {
  test("ids and metric names are unique", () => {
    const ids: Array<string> = ALL.map((m: XcpNgMetricDefinition) => {
      return m.id;
    });
    const names: Array<string> = ALL.map((m: XcpNgMetricDefinition) => {
      return m.metricName;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  test("the lab's scrape sends the series it should", () => {
    // A sanity check of the fixture itself: a host, a VM, an SR, a VDI, a pool.
    expect(SERIES_IN_THE_LAB).toEqual(
      expect.arrayContaining([
        "xcp_pool_connected",
        "xcp_host_status",
        "xcp_vm_status",
        "xcp_sr_physical_size_bytes",
        "xcp_vdi_virtual_size_bytes",
        "xcp_vm_power_consumption_watts",
      ]),
    );
  });

  test.each(
    SERIES_IN_THE_LAB.map((name: string) => {
      return [name];
    }),
  )("%s, which the plugin sends, is in the catalog", (name: string) => {
    expect(getXcpNgMetricByMetricName(name)).toBeDefined();
  });

  test.each(
    XOSTOR_SERIES.map((name: string) => {
      return [name];
    }),
  )("the XOSTOR series %s is in the catalog", (name: string) => {
    expect(getXcpNgMetricByMetricName(name)?.category).toBe("XOSTOR");
  });

  test("every series OneUptime reads by name, and every derived one, is in the catalog", () => {
    for (const name of [
      ...Object.values(XcpNgSeries),
      ...Object.values(XcpNgDerivedSeries),
    ]) {
      expect([name, getXcpNgMetricByMetricName(name)]).toEqual([
        name,
        expect.anything(),
      ]);
    }
  });

  test("the derived series are flagged as OneUptime's", () => {
    for (const name of Object.values(XcpNgDerivedSeries)) {
      const metric: XcpNgMetricDefinition | undefined =
        getXcpNgMetricByMetricName(name);
      expect(metric?.isDerivedByOneUptime).toBe(true);
      expect(metric?.category).toBe("Availability");
    }
    expect(
      ALL.filter((m: XcpNgMetricDefinition) => {
        return m.isDerivedByOneUptime;
      }),
    ).toHaveLength(Object.values(XcpNgDerivedSeries).length);
  });

  test("the trap's eight series are flagged, and stored per second", () => {
    const flagged: Array<string> = ALL.filter((m: XcpNgMetricDefinition) => {
      return m.isRateTypedAsCounter;
    })
      .map((m: XcpNgMetricDefinition) => {
        return m.metricName;
      })
      .sort();
    expect(flagged).toEqual([...XCP_NG_RATE_TYPED_AS_COUNTER_SERIES].sort());
    for (const name of XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) {
      const metric: XcpNgMetricDefinition = getXcpNgMetricByMetricName(name)!;
      expect(["bytes/s", "{errors/s}"]).toContain(metric.unit);
      // A rate is averaged or maxed, never summed like a counter's increase.
      expect([
        MetricsAggregationType.Avg,
        MetricsAggregationType.Max,
      ]).toContain(metric.defaultAggregation);
      expect(metric.description).toMatch(/rate/i);
    }
  });

  test.each(
    ALL.map((m: XcpNgMetricDefinition) => {
      return [m.metricName, m];
    }),
  )(
    "%s: its scope is the one its name says",
    (_name: unknown, metric: unknown) => {
      const m: XcpNgMetricDefinition = metric as XcpNgMetricDefinition;
      expect(XcpNgTelemetryUtil.getScopeOfSeries(m.metricName)).toBe(
        m.defaultResourceScope,
      );
    },
  );

  test.each(
    ALL.map((m: XcpNgMetricDefinition) => {
      return [m.metricName, m];
    }),
  )(
    "%s: a known unit, a category, words for people",
    (_name: unknown, metric: unknown) => {
      const m: XcpNgMetricDefinition = metric as XcpNgMetricDefinition;
      expect(KNOWN_UNITS.has(m.unit ?? "")).toBe(true);
      expect(getAllXcpNgMetricCategories()).toContain(m.category);
      expect(m.friendlyName.length).toBeGreaterThan(2);
      expect(m.description.endsWith(".")).toBe(true);
      expect(m.id).toMatch(/^xcp(-ng)?-[a-z0-9-]+$/);
    },
  );

  test("bytes and latencies are in the units Xen Orchestra already converts to", () => {
    expect(
      getXcpNgMetricByMetricName("xcp_host_memory_total_bytes")?.unit,
    ).toBe("bytes");
    expect(
      getXcpNgMetricByMetricName("xcp_host_disk_latency_seconds")?.unit,
    ).toBe("seconds");
    expect(getXcpNgMetricByMetricName("xcp_vm_cpu_usage")?.unit).toBe("ratio");
    expect(
      getXcpNgMetricByMetricName("xcp_host_disk_throughput_total_bytes")?.unit,
    ).toBe("bytes/s");
  });

  test("lookups", () => {
    expect(getXcpNgMetricById("xcp-pool-connected")?.metricName).toBe(
      "xcp_pool_connected",
    );
    expect(getXcpNgMetricById("nope")).toBeUndefined();
    expect(getXcpNgMetricByMetricName("pve_up")).toBeUndefined();
  });

  test("categories partition the catalog, each with a heading", () => {
    let total: number = 0;
    for (const category of getAllXcpNgMetricCategories()) {
      const metrics: Array<XcpNgMetricDefinition> =
        getXcpNgMetricsByCategory(category);
      expect(metrics.length).toBeGreaterThan(0);
      total += metrics.length;
      expect(getXcpNgMetricCategoryLabel(category).length).toBeGreaterThan(0);
    }
    expect(total).toBe(ALL.length);
    expect(getXcpNgMetricCategoryLabel("Unknown" as XcpNgMetricCategory)).toBe(
      "Unknown",
    );
  });
});
