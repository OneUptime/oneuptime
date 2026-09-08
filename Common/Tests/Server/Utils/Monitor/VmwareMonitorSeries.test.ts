import VmwareMonitorSeries, {
  VmwareSeriesResult,
} from "../../../../Server/Utils/Monitor/VmwareMonitorSeries";
import { JSONObject } from "../../../../Types/JSON";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import VMwareResource from "../../../../Models/DatabaseModels/VMwareResource";
import VMwareSource from "../../../../Models/DatabaseModels/VMwareSource";
import MonitorStepVmwareMonitor, {
  VmwareResourceType,
} from "../../../../Types/Monitor/MonitorStepVmwareMonitor";
import { buildVmwareMonitorConfig } from "../../../../Types/Monitor/VmwareAlertTemplates";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";

const now: Date = new Date("2026-09-07T12:00:00Z");
const prefix: string = "oneuptime.vmware.";
function source(): VMwareSource {
  return Object.assign(new VMwareSource(), {
    sourceIdentifier: "vc-a",
    lastCollectionAt: now,
    collectionIntervalSeconds: 120,
    metrics: {
      [prefix + "source.up"]: 1,
      [prefix + "source.inventory.complete"]: 1,
    },
  });
}
function resource(id: string = "vm-1"): VMwareResource {
  return Object.assign(new VMwareResource(), {
    resourceIdentifier: id,
    resourceType: "vm",
    name: "Production VM",
    lastSeenAt: now,
    lastReportedAt: now,
    metrics: {
      [prefix + "resource.observed"]: 1,
      [prefix + "resource.power_state"]: 1,
      [prefix + "resource.state"]: 1,
      [prefix + "vm.cpu.utilization"]: 20,
    },
    metadata: {},
  });
}
function config(
  metric: string = "vm.cpu.utilization",
): MonitorStepVmwareMonitor {
  return buildVmwareMonitorConfig({
    sourceIdentifier: "vc-a",
    metricName: prefix + metric,
    metricAlias: "A",
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Avg,
  });
}
function series(r: VMwareResource, value: number): MetricSeriesResult {
  const labels: JSONObject = VmwareMonitorSeries.labels("vc-a", r);
  return {
    labels,
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    aggregatedResults: [
      { data: [{ timestamp: now, value, attributes: labels }] },
    ],
  };
}

describe("VMware snapshot policy and identity", () => {
  test("source identifiers isolate equal VM ids and display names do not affect identity", () => {
    const r: VMwareResource = resource();
    const before: JSONObject = VmwareMonitorSeries.labels("vc-a", r);
    r.name = "Renamed";
    r.metadata = { [prefix + "parent.id"]: "host-new" };
    expect(VmwareMonitorSeries.labels("vc-a", r)).toEqual(before);
    expect(VmwareMonitorSeries.labels("vc-b", r)).not.toEqual(before);
  });
  test.each([0, 1, 95])("preserves real CPU sample %s", (value: number) => {
    const r: VMwareResource = resource();
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config(),
      source: source(),
      resources: [r],
      series: [series(r, value)],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(value);
    expect(result.unavailableSeriesFingerprints).toEqual([]);
  });
  test("keeps a missing CPU series unknown while another VM recovers", () => {
    const a: VMwareResource = resource("a");
    const b: VMwareResource = resource("b");
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config(),
      source: source(),
      resources: [a, b],
      series: [series(b, 10)],
      now,
    });
    expect(result.unavailableSeriesFingerprints).toEqual([
      series(a, 0).fingerprint,
    ]);
    expect(
      result.series.find((s: MetricSeriesResult) => {
        return s.fingerprint === series(a, 0).fingerprint;
      })!.aggregatedResults[0]!.data,
    ).toEqual([]);
  });
  test.each(["failed", "partial", "stale"])(
    "freezes individual resources when collection is %s",
    (state: string) => {
      const s: VMwareSource = source();
      const r: VMwareResource = resource();
      if (state === "failed") {
        s.metrics![prefix + "source.up"] = 0;
      }
      if (state === "partial") {
        s.metrics![prefix + "source.inventory.complete"] = 0;
      }
      if (state === "stale") {
        s.lastCollectionAt = new Date(now.getTime() - 361000);
      }
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config("resource.observed"),
        source: s,
        resources: [r],
        series: [series(r, 0)],
        now,
      });
      expect(result.series).toEqual([]);
      expect(result.unavailableSeriesFingerprints).toEqual([
        series(r, 0).fingerprint,
      ]);
    },
  );
  test("holds a stale resource unknown when source health arrived without its resource batch", () => {
    const r: VMwareResource = resource();
    r.lastReportedAt = new Date(now.getTime() - 361000);
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("resource.observed"),
      source: source(),
      resources: [r],
      series: [],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([]);
    expect(result.unavailableSeriesFingerprints).toEqual([
      series(r, 0).fingerprint,
    ]);
    expect(
      VmwareMonitorSeries.apply({
        config: config("vm.unexpected_power_off"),
        source: source(),
        resources: [r],
        series: [],
        now,
      }).unavailableSeriesFingerprints,
    ).toHaveLength(1);
  });
  test("explicit missing observation remains absent even though the companion is still reporting it", () => {
    const r: VMwareResource = resource();
    r.metrics![prefix + "resource.observed"] = 0;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("resource.observed"),
      source: source(),
      resources: [r],
      series: [],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(0);
  });
  test.each([
    "resource.state",
    "resource.power_state",
    "resource.connection_state",
  ])("unknown %s never affirms recovery", (metric: string) => {
    const r: VMwareResource = resource();
    r.metrics![prefix + metric] = 0;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config(metric),
      source: source(),
      resources: [r],
      series: [series(r, 0)],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([]);
    expect(result.unavailableSeriesFingerprints).toHaveLength(1);
  });
  test.each([true, false])(
    "honors expectedRunning=%s independently of collector policy",
    (expectedRunning: boolean) => {
      const r: VMwareResource = resource();
      r.expectedRunning = expectedRunning;
      r.metrics![prefix + "resource.power_state"] = 2;
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config("vm.unexpected_power_off"),
        source: source(),
        resources: [r],
        series: [series(r, expectedRunning ? 0 : 1)],
        now,
      });
      expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(
        expectedRunning ? 1 : 0,
      );
    },
  );
  test("an expected-running override cannot turn unknown power into a failure", () => {
    const r: VMwareResource = resource();
    r.expectedRunning = true;
    r.metrics![prefix + "resource.power_state"] = 0;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("vm.unexpected_power_off"),
      source: source(),
      resources: [r],
      series: [],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([]);
  });
  test.each([true, null])(
    "suppresses collector maintenance when override is %s",
    (override: boolean | null) => {
      const r: VMwareResource = resource();
      Object.assign(r, { maintenanceMode: override });
      r.metrics![prefix + "host.maintenance"] = 1;
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config(),
        source: source(),
        resources: [r],
        series: [series(r, 99)],
        now,
      });
      expect(result.series).toEqual([]);
      expect(result.unavailableSeriesFingerprints).toHaveLength(1);
    },
  );
  test("explicit maintenance=false evaluates connection state", () => {
    const r: VMwareResource = resource();
    r.resourceType = "host";
    r.maintenanceMode = false;
    r.metrics![prefix + "host.maintenance"] = 1;
    r.metrics![prefix + "resource.connection_state"] = 3;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("host.unavailable"),
      source: source(),
      resources: [r],
      series: [series(r, 0)],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(1);
  });
  test("maintenance monitors observe entering and leaving maintenance", () => {
    const host: VMwareResource = resource("host-1");
    host.resourceType = "host";
    for (const maintenance of [0, 1, 0]) {
      host.metrics![prefix + "host.maintenance"] = maintenance;
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config("host.maintenance"),
        source: source(),
        resources: [host],
        series: [series(host, maintenance)],
        now,
      });
      expect(result.series).toHaveLength(1);
      expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(
        maintenance,
      );
      expect(result.unavailableSeriesFingerprints).toEqual([]);
    }
  });
  test.each([true, false, null])(
    "maintenance queries retain the reported metric with override %s",
    (override: boolean | null) => {
      const host: VMwareResource = resource("host-1");
      host.resourceType = "host";
      Object.assign(host, { maintenanceMode: override });
      host.metrics![prefix + "host.maintenance"] = 1;
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config("host.maintenance"),
        source: source(),
        resources: [host],
        series: [series(host, 1)],
        now,
      });
      expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(1);
      expect(result.unavailableSeriesFingerprints).toEqual([]);
    },
  );
  test.each(["failed source", "stale report", "missing metric"])(
    "maintenance queries still require current evidence with %s",
    (condition: string) => {
      const host: VMwareResource = resource("host-1");
      host.resourceType = "host";
      host.maintenanceMode = true;
      host.metrics![prefix + "host.maintenance"] = 1;
      const currentSource: VMwareSource = source();
      if (condition === "failed source") {
        currentSource.metrics![prefix + "source.up"] = 0;
      } else if (condition === "stale report") {
        host.lastReportedAt = new Date(now.getTime() - 361000);
      } else {
        delete host.metrics![prefix + "host.maintenance"];
      }
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config("host.maintenance"),
        source: currentSource,
        resources: [host],
        series: [series(host, 1)],
        now,
      });
      expect(
        result.series.flatMap((item: MetricSeriesResult) => {
          return item.aggregatedResults[0]!.data;
        }),
      ).toEqual([]);
      expect(result.unavailableSeriesFingerprints).toEqual([
        series(host, 1).fingerprint,
      ]);
    },
  );
  test.each([false, true])(
    "availability stays suppressed during maintenance with maintenance query %s",
    (includeMaintenance: boolean) => {
      const host: VMwareResource = resource("host-1");
      host.resourceType = "host";
      host.metrics![prefix + "host.maintenance"] = 1;
      host.metrics![prefix + "host.unavailable"] = 0;
      const monitorConfig: MonitorStepVmwareMonitor =
        config("host.unavailable");
      const hostSeries: MetricSeriesResult = series(host, 0);
      if (includeMaintenance) {
        monitorConfig.metricViewConfig.queryConfigs.push(
          ...config("host.maintenance").metricViewConfig.queryConfigs,
        );
        hostSeries.aggregatedResults.push(...series(host, 1).aggregatedResults);
      }
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: monitorConfig,
        source: source(),
        resources: [host],
        series: [hostSeries],
        now,
      });
      expect(result.series).toEqual([]);
      expect(result.unavailableSeriesFingerprints).toEqual([
        hostSeries.fingerprint,
      ]);
    },
  );
  test("a VM allowed to stay off supplies explicit healthy evidence beside an expected VM", () => {
    const expected: VMwareResource = resource("expected");
    expected.metrics![prefix + "vm.expected_running"] = 1;
    expected.metrics![prefix + "vm.unexpected_power_off"] = 0;
    const optional: VMwareResource = resource("optional");
    optional.metrics![prefix + "resource.power_state"] = 2;
    optional.metrics![prefix + "vm.expected_running"] = 0;
    optional.metrics![prefix + "vm.unexpected_power_off"] = 0;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("vm.unexpected_power_off"),
      source: source(),
      resources: [expected, optional],
      series: [series(expected, 0), series(optional, 0)],
      now,
    });
    expect(result.unavailableSeriesFingerprints).toEqual([]);
    expect(
      result.series.map((item: MetricSeriesResult) => {
        return item.aggregatedResults[0]!.data[0]!.value;
      }),
    ).toEqual([0, 0]);
  });
  test("retired and out-of-scope resources do not reappear as missing", () => {
    const a: VMwareResource = resource("a");
    a.isArchived = true;
    const b: VMwareResource = resource("b");
    b.resourceType = "host";
    const c: MonitorStepVmwareMonitor = config("resource.observed");
    c.resourceFilters = { resourceType: VmwareResourceType.VM };
    expect(
      VmwareMonitorSeries.apply({
        config: c,
        source: source(),
        resources: [a, b],
        series: [],
        now,
      }).series,
    ).toEqual([]);
  });
  test("source no-data yields one expected source series", () => {
    const s: VMwareSource = source();
    delete s.lastCollectionAt;
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("source.up"),
      source: s,
      resources: [],
      series: [],
      now,
    });
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.aggregatedResults).toEqual([{ data: [] }]);
  });
  test("metadata filters limit synthetic missing-resource signals to selected inventory", () => {
    const a: VMwareResource = resource("a");
    a.metadata = { [prefix + "cluster.name"]: "production" };
    a.metrics![prefix + "resource.observed"] = 0;
    const b: VMwareResource = resource("b");
    b.metadata = { [prefix + "cluster.name"]: "development" };
    b.metrics![prefix + "resource.observed"] = 0;
    const c: MonitorStepVmwareMonitor = config("resource.observed");
    c.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.attributes =
      { ["resource." + prefix + "cluster.name"]: "production" };
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: c,
      source: source(),
      resources: [a, b],
      series: [],
      now,
    });
    expect(
      result.series.map((item: MetricSeriesResult) => {
        return item.fingerprint;
      }),
    ).toEqual([series(a, 0).fingerprint]);
  });
  test("unverifiable datapoint filters cannot synthesize absence for unrelated inventory", () => {
    const r: VMwareResource = resource();
    delete r.lastReportedAt;
    const c: MonitorStepVmwareMonitor = config("resource.observed");
    c.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.attributes =
      { "custom.datapoint": "selected" };
    expect(
      VmwareMonitorSeries.apply({
        config: c,
        source: source(),
        resources: [r],
        series: [],
        now,
      }).series,
    ).toEqual([]);
  });
  test("authoritative selection replaces stale saved identity filters during policy evaluation", () => {
    const r: VMwareResource = resource();
    const c: MonitorStepVmwareMonitor = config();
    c.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.attributes =
      { ["resource." + prefix + "source.id"]: "old-source" };
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: c,
      source: source(),
      resources: [r],
      series: [series(r, 20)],
      now,
    });
    expect(result.series).toHaveLength(1);
    expect(result.series[0]!.aggregatedResults[0]!.data[0]!.value).toBe(20);
  });
  test("a series preceding inventory is held unknown until policy can be applied", () => {
    const r: VMwareResource = resource();
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config(),
      source: source(),
      resources: [],
      series: [series(r, 99)],
      now,
    });
    expect(result.series).toEqual([]);
    expect(result.unavailableSeriesFingerprints).toEqual([
      series(r, 99).fingerprint,
    ]);
  });
});

describe("VMware latest snapshot authority", () => {
  test.each(["vm.cpu.utilization", "resource.state"])(
    "cannot reuse old %s when the latest snapshot omits it",
    (metric: string) => {
      const r: VMwareResource = resource();
      delete r.metrics![prefix + metric];
      const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
        config: config(metric),
        source: source(),
        resources: [r],
        series: [series(r, 1)],
        now,
      });
      expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([]);
      expect(result.unavailableSeriesFingerprints).toEqual([
        series(r, 1).fingerprint,
      ]);
    },
  );
  test.each(["metadata", "metrics"])(
    "collector retirement in %s suppresses missing-resource signals",
    (location: string) => {
      const r: VMwareResource = resource();
      delete r.lastReportedAt;
      if (location === "metadata") {
        r.metadata![prefix + "resource.retired"] = true;
      } else {
        r.metrics![prefix + "resource.retired"] = 1;
      }
      expect(
        VmwareMonitorSeries.apply({
          config: config("resource.observed"),
          source: source(),
          resources: [r],
          series: [],
          now,
        }).series,
      ).toEqual([]);
    },
  );
  test("a missing latest source health metric cannot recover from an older healthy row", () => {
    const s: VMwareSource = source();
    delete s.metrics![prefix + "source.inventory.complete"];
    const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
      config: config("source.inventory.complete"),
      source: s,
      resources: [],
      series: [series(resource(), 1)],
      now,
    });
    expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([]);
  });
});

it("keeps a healthy hourly source current between polls beyond a five-minute query window", () => {
  const s: VMwareSource = source();
  s.collectionIntervalSeconds = 3600;
  s.lastCollectionAt = new Date(now.getTime() - 10 * 60 * 1000);
  const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
    config: config("source.up"),
    source: s,
    resources: [],
    series: [],
    now,
  });
  expect(result.series[0]!.aggregatedResults[0]!.data).toEqual([
    {
      timestamp: s.lastCollectionAt,
      value: 1,
      attributes: { "resource.oneuptime.vmware.source.id": "vc-a" },
    },
  ]);
  s.lastCollectionAt = new Date(now.getTime() - 3 * 3600 * 1000 - 1);
  expect(
    VmwareMonitorSeries.apply({
      config: config("source.up"),
      source: s,
      resources: [],
      series: [],
      now,
    }).series[0]!.aggregatedResults[0]!.data,
  ).toEqual([]);
});

it("dropping one resource OTLP batch cannot fabricate disappearance while other batches arrive", () => {
  const delayed: VMwareResource = resource("delayed");
  delayed.lastReportedAt = new Date(now.getTime() - 361000);
  const delivered: VMwareResource = resource("delivered");
  const result: VmwareSeriesResult = VmwareMonitorSeries.apply({
    config: config("resource.observed"),
    source: source(),
    resources: [delayed, delivered],
    series: [series(delivered, 1)],
    now,
  });
  expect(result.unavailableSeriesFingerprints).toEqual([
    series(delayed, 1).fingerprint,
  ]);
  expect(
    result.series
      .flatMap((item: MetricSeriesResult) => {
        return item.aggregatedResults[0]!.data;
      })
      .map((point: AggregateModel) => {
        return point.value;
      }),
  ).toEqual([1]);
});
