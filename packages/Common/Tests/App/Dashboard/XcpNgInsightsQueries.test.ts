import { describe, expect, test } from "@jest/globals";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import {
  XcpNgMetricDefinition,
  getXcpNgMetricById,
} from "../../../Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgLabel,
  XcpNgScope,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import {
  XCP_NG_INSIGHTS_SECTIONS,
  XcpNgInsightsChart,
  XcpNgInsightsSection,
  getXcpNgChartUnit,
  getXcpNgInsightsQueries,
  getXcpNgInsightsQuery,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Insights";

/*
 * An XCP-ng pool's Resource Usage: curated charts of its hosts, VMs,
 * storage repositories, disks and network, every one an XcpNgMetricCatalog
 * entry read on the pool's own series. What would go wrong silently:
 *
 *   - a chart scoped by the pool's name, which Xen Orchestra may report
 *     empty and anyone may change, instead of its UUID (xcp_ng.pool.id);
 *   - a chart that mixes a host's and a VM's series of one name, because it
 *     forgot the xcp_ng.scope ingest stamps;
 *   - a ratio from 0 to 1 drawn as 0.38 under a percent axis, or scaled
 *     twice;
 *   - a throughput Xen Orchestra types `counter` but fills with per-second
 *     rates drawn as a rate of a counter (the trap): those series are gauges
 *     once stored, and are drawn as they come.
 */

const POOL_UUID: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";

function allCharts(): Array<XcpNgInsightsChart> {
  return XCP_NG_INSIGHTS_SECTIONS.flatMap(
    (section: XcpNgInsightsSection): Array<XcpNgInsightsChart> => {
      return section.charts;
    },
  );
}

// The query's attribute filter, read as the plain map the page builds.
function attributesOf(query: MetricQueryConfigData): Record<string, unknown> {
  return (query.metricQueryData.filterData.attributes || {}) as Record<
    string,
    unknown
  >;
}

function queryOf(metricId: string): MetricQueryConfigData {
  const chart: XcpNgInsightsChart | undefined = allCharts().find(
    (candidate: XcpNgInsightsChart): boolean => {
      return candidate.metricId === metricId;
    },
  );
  if (!chart) {
    throw new Error(`No chart of ${metricId}.`);
  }
  const query: MetricQueryConfigData | undefined = getXcpNgInsightsQuery({
    chart,
    poolIdentifier: POOL_UUID,
  });
  if (!query) {
    throw new Error(`No query for ${metricId}.`);
  }
  return query;
}

describe("the sections", () => {
  test("hosts, VMs, storage, disk and network, in that order", () => {
    expect(
      XCP_NG_INSIGHTS_SECTIONS.map((section: XcpNgInsightsSection): string => {
        return section.key;
      }),
    ).toEqual(["hosts", "vms", "storage", "disk", "network"]);
  });

  test("each says what it shows, in one short sentence, and has an icon and charts", () => {
    for (const section of XCP_NG_INSIGHTS_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
      expect(section.description.length).toBeLessThanOrEqual(210);
      expect(section.description.endsWith(".")).toBe(true);
      expect(section.icon).toBeTruthy();
      expect(section.charts.length).toBeGreaterThan(0);
    }
  });

  test("every chart is a catalog entry, so a renamed series fails here, not on a blank chart", () => {
    for (const chart of allCharts()) {
      expect({
        metricId: chart.metricId,
        found: Boolean(getXcpNgMetricById(chart.metricId)),
      }).toEqual({ metricId: chart.metricId, found: true });
    }
  });

  test("no section draws two charts of one series", () => {
    const ids: Array<string> = allCharts().map(
      (chart: XcpNgInsightsChart): string => {
        return chart.metricId;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every section builds one query per chart", () => {
    for (const section of XCP_NG_INSIGHTS_SECTIONS) {
      expect(
        getXcpNgInsightsQueries({ section, poolIdentifier: POOL_UUID }),
      ).toHaveLength(section.charts.length);
    }
  });
});

describe("every query reads the pool's own series of one scope", () => {
  test.each(
    allCharts().map((chart: XcpNgInsightsChart): [string] => {
      return [chart.metricId];
    }),
  )(
    "%s is filtered by the pool's UUID and the series' scope",
    (metricId: string) => {
      const metric: XcpNgMetricDefinition = getXcpNgMetricById(metricId)!;
      const query: MetricQueryConfigData = queryOf(metricId);

      expect(query.metricQueryData.filterData.metricName).toBe(
        metric.metricName,
      );
      expect(query.metricQueryData.filterData.attributes).toEqual({
        "resource.xcp_ng.pool.id": POOL_UUID,
        [XCP_NG_SCOPE_ATTRIBUTE]: metric.defaultResourceScope,
      });
      expect(query.metricQueryData.filterData.aggegationType).toBe(
        metric.defaultAggregation,
      );
      // One variable per chart, from the catalog id.
      expect(query.metricAliasData!.metricVariable).toBe(
        metricId.replace(/-/g, "_"),
      );
    },
  );

  test("the scope is the one ingest stamps on that kind of object", () => {
    expect(
      attributesOf(queryOf("xcp-host-cpu-average"))[XCP_NG_SCOPE_ATTRIBUTE],
    ).toBe(XcpNgScope.Host);
    expect(
      attributesOf(queryOf("xcp-vm-cpu-usage"))[XCP_NG_SCOPE_ATTRIBUTE],
    ).toBe(XcpNgScope.VM);
    expect(
      attributesOf(queryOf("xcp-sr-physical-usage-bytes"))[
        XCP_NG_SCOPE_ATTRIBUTE
      ],
    ).toBe(XcpNgScope.StorageRepository);
  });

  test("a line per host, VM or storage repository, named as Xen Orchestra names it", () => {
    expect(
      queryOf("xcp-host-cpu-average").metricQueryData.groupByAttributeKeys,
    ).toEqual([XcpNgLabel.HostName]);
    expect(
      queryOf("xcp-vm-memory-bytes").metricQueryData.groupByAttributeKeys,
    ).toEqual([XcpNgLabel.VmName]);
    expect(
      queryOf("xcp-sr-physical-usage-bytes").metricQueryData
        .groupByAttributeKeys,
    ).toEqual([XcpNgLabel.SrName]);
    // A host's physical interfaces: one line per host and interface.
    expect(
      queryOf("xcp-host-network-receive-bytes-total").metricQueryData
        .groupByAttributeKeys,
    ).toEqual([XcpNgLabel.HostName, XcpNgLabel.Interface]);
  });

  test("another pool's charts read only that pool", () => {
    const other: MetricQueryConfigData = getXcpNgInsightsQuery({
      chart: XCP_NG_INSIGHTS_SECTIONS[0]!.charts[0]!,
      poolIdentifier: "0f0e0d0c-0b0a-4909-8807-060504030201",
    })!;
    expect(attributesOf(other)["resource.xcp_ng.pool.id"]).toBe(
      "0f0e0d0c-0b0a-4909-8807-060504030201",
    );
  });

  test("an id the catalog does not have builds no query, and drops out of its section", () => {
    expect(
      getXcpNgInsightsQuery({
        chart: { metricId: "xcp-no-such-series", groupByAttributeKeys: [] },
        poolIdentifier: POOL_UUID,
      }),
    ).toBeUndefined();
    expect(
      getXcpNgInsightsQueries({
        section: {
          key: "test",
          title: "Test",
          description: "Test.",
          icon: XCP_NG_INSIGHTS_SECTIONS[0]!.icon,
          charts: [
            { metricId: "xcp-no-such-series", groupByAttributeKeys: [] },
            XCP_NG_INSIGHTS_SECTIONS[0]!.charts[0]!,
          ],
        },
        poolIdentifier: POOL_UUID,
      }),
    ).toHaveLength(1);
  });
});

describe("units and scaling", () => {
  test("a ratio from 0 to 1 is drawn as a percent, multiplied by 100 once", () => {
    for (const metricId of [
      "xcp-host-cpu-average",
      "xcp-vm-cpu-usage",
      "xcp-vm-runstate-full-contention",
    ]) {
      const query: MetricQueryConfigData = queryOf(metricId);
      expect(getXcpNgMetricById(metricId)!.unit).toBe("ratio");
      expect(query.metricAliasData!.legendUnit).toBe("%");
      expect(query.transformValue).toBeDefined();
      expect(
        query.transformValue!(0.381, {} as unknown as AggregatedModel),
      ).toBeCloseTo(38.1, 6);
    }
  });

  test("a ratio's chart says percent, not the catalog's 0 to 1", () => {
    for (const metricId of ["xcp-host-cpu-average", "xcp-vm-cpu-usage"]) {
      const description: string =
        queryOf(metricId).metricAliasData!.description || "";
      expect(description).toContain("percent");
      expect(description).not.toContain("0 to 1");
    }
  });

  test("nothing else is transformed: bytes, rates and loads are drawn as stored", () => {
    for (const chart of allCharts()) {
      const metric: XcpNgMetricDefinition = getXcpNgMetricById(chart.metricId)!;
      if (metric.unit === "ratio") {
        continue;
      }
      expect({
        metricId: chart.metricId,
        transformed: Boolean(queryOf(chart.metricId).transformValue),
      }).toEqual({ metricId: chart.metricId, transformed: false });
    }
  });

  test("the throughputs Xen Orchestra types counter are drawn as the per-second gauges they are", () => {
    const rateCharts: Array<XcpNgInsightsChart> = allCharts().filter(
      (chart: XcpNgInsightsChart): boolean => {
        return XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(
          getXcpNgMetricById(chart.metricId)!.metricName,
        );
      },
    );
    // The disk and network sections are made of them.
    expect(rateCharts.length).toBeGreaterThanOrEqual(4);
    for (const chart of rateCharts) {
      const query: MetricQueryConfigData = queryOf(chart.metricId);
      expect(query.metricAliasData!.legendUnit).toBe("bytes/s");
      expect(query.transformValue).toBeUndefined();
      expect(query.metricQueryData.filterData.aggegationType).toBe(
        getXcpNgMetricById(chart.metricId)!.defaultAggregation,
      );
    }
  });

  test("each catalog unit is drawn as a unit the charts know", () => {
    expect(getXcpNgChartUnit("ratio")).toBe("%");
    expect(getXcpNgChartUnit("seconds")).toBe("s");
    expect(getXcpNgChartUnit("bytes")).toBe("bytes");
    expect(getXcpNgChartUnit("bytes/s")).toBe("bytes/s");
    expect(getXcpNgChartUnit("ops/s")).toBe("ops/s");
    expect(getXcpNgChartUnit("W")).toBe("W");
    // A count, or no unit at all, is a bare number.
    expect(getXcpNgChartUnit("count")).toBe("");
    expect(getXcpNgChartUnit("")).toBe("");
    expect(getXcpNgChartUnit(undefined)).toBe("");
  });
});
