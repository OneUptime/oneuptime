import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
