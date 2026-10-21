import { describe, expect, test } from "@jest/globals";
import VMwareResourceModel from "../../../Models/DatabaseModels/VMwareResource";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Metric from "../../../Models/AnalyticsModels/Metric";
import {
  TimeValuePoint,
  VMWARE_DISK_LATENCY_DANGER_MS,
  VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS,
  VMWARE_DISK_LATENCY_WARN_MS,
  VMWARE_HOST_DEVICE_GROUP_KEYS,
  VMWARE_HOST_NAME_LABEL_KEYS,
  VMWARE_HOST_OVERVIEW_METRICS,
  VMWARE_HOST_TILE_WINDOW_MINUTES,
  VMWARE_METRIC_STALE_MS,
  VMwareBusyVirtualMachine,
  VMwareHostIdentity,
  VMwareHostMetric,
  VMwareHostOverviewMetrics,
  VMwareHostReportState,
  VMwareHostVirtualMachineSummary,
  VMwareMetricSample,
  VMwareNetworkAdapterRow,
  VMwareStorageDeviceRow,
  buildVMwareHostAggregateBy,
  formatVMwareMilliseconds,
  formatVMwarePerSecond,
  getBusiestVMwareVirtualMachines,
  getVMwareDiskLatencyGaugePercent,
  getVMwareHostIdentity,
  getVMwareHostLastReportAt,
  getVMwareHostMetricAttributes,
  getVMwareHostReportState,
  getVMwareHostReportStateLook,
  getVMwareHostSeries,
  hasFreshVMwareMetrics,
  isVMwareHostTotalObject,
  maxOfRecentWindow,
  meanOfRecentWindow,
  parseVMwareHostExternalId,
  readVMwareMetricSamples,
  seriesLabelsNameVMwareHost,
  sumVMwareSeries,
  summarizeVMwareHostMetrics,
  summarizeVMwareHostVirtualMachines,
  summarizeVMwareNetworkAdapters,
  summarizeVMwareStorageDevices,
  toFiniteNumber,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData";
import { METRIC_STALE_MS } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareResourceUtils";
import {
  VMwareMetricDefinition,
  getVMwareMetricByMetricName,
} from "../../../Types/Monitor/VMwareMetricCatalog";

/*
 * What an ESXi host's page reads and works out (Pages/VMware/Utils/
 * VMwareHostData): which host the URL names, whether vCenter still reports
 * it, which of its VMs are busiest, how its metrics are read and how each
 * read becomes a tile, a chart line or a row of the adapter and device
 * tables. Each of these fails quietly when it is wrong - a tile that sums a
 * NIC twice, a stale host called Reporting, another host's VM in the list -
 * so each is pinned here, empty and partial data included.
 */

const NOW: Date = new Date("2026-10-21T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function row(
  fields: Partial<Record<keyof VMwareResourceModel, unknown>>,
): VMwareResourceModel {
  const model: VMwareResourceModel = new VMwareResourceModel();
  Object.assign(model, fields);
  return model;
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function bucket(
  time: Date,
  value: number,
  attributes?: Record<string, unknown>,
): AggregatedModel {
  const point: Record<string, unknown> = { timestamp: time, value: value };
  if (attributes) {
    point["attributes"] = attributes;
  }
  return point as unknown as AggregatedModel;
}

function result(points: Array<AggregatedModel>): AggregatedResult {
  return { data: points };
}

function sample(
  minutes: number,
  object: string,
  direction: string,
  value: number,
): VMwareMetricSample {
  return {
    time: minutesAgo(minutes).getTime(),
    object: object,
    direction: direction,
    value: value,
  };
}

function values(points: Array<TimeValuePoint>): Array<number> {
  return points.map((point: TimeValuePoint): number => {
    return point.y;
  });
}

describe("which host the page is about", () => {
  test("an inventory id names the datacenter and the host", () => {
    expect(
      parseVMwareHostExternalId("host/dc-east/esx01.acme.example"),
    ).toEqual({ datacenterName: "dc-east", hostName: "esx01.acme.example" });
  });

  test("a datacenter name holding a slash stays whole; the host is after the last one", () => {
    expect(parseVMwareHostExternalId("host/EU/West/10.0.0.21")).toEqual({
      datacenterName: "EU/West",
      hostName: "10.0.0.21",
    });
  });

  test("an id without a datacenter, without the prefix, or empty, is all host", () => {
    expect(parseVMwareHostExternalId("host/esx01")).toEqual({
      datacenterName: "",
      hostName: "esx01",
    });
    expect(parseVMwareHostExternalId("esx01")).toEqual({
      datacenterName: "",
      hostName: "esx01",
    });
    expect(parseVMwareHostExternalId("")).toEqual({
      datacenterName: "",
      hostName: "",
    });
  });

  test("the inventory row wins over the id; the id fills in before it loads", () => {
    const fromRow: VMwareHostIdentity = getVMwareHostIdentity({
      vcenterName: "vcenter-prod",
      externalId: "host/dc-east/esx01~3f2a",
      row: row({ datacenterName: "dc-east", hostName: "esx01.acme.example" }),
    });
    expect(fromRow).toEqual({
      vcenterName: "vcenter-prod",
      datacenterName: "dc-east",
      hostName: "esx01.acme.example",
    });

    const fromName: VMwareHostIdentity = getVMwareHostIdentity({
      vcenterName: "vcenter-prod",
      externalId: "host/dc-east/esx01",
      row: row({ name: "esx01-by-name" }),
    });
    expect(fromName.hostName).toBe("esx01-by-name");
    expect(fromName.datacenterName).toBe("dc-east");

    expect(
      getVMwareHostIdentity({
        vcenterName: "vcenter-prod",
        externalId: "host/dc-west/esx09",
        row: null,
      }),
    ).toEqual({
      vcenterName: "vcenter-prod",
      datacenterName: "dc-west",
      hostName: "esx09",
    });
  });

  test("the metric filter is the host's resource attributes, vCenter first", () => {
    expect(
      getVMwareHostMetricAttributes({
        vcenterName: "vcenter-prod",
        datacenterName: "dc-east",
        hostName: "esx01",
      }),
    ).toEqual({
      "resource.vmware.vcenter.name": "vcenter-prod",
      "resource.vcenter.datacenter.name": "dc-east",
      "resource.vcenter.host.name": "esx01",
    });
  });

  test("a host with no datacenter is filtered on the vCenter and its name only", () => {
    expect(
      getVMwareHostMetricAttributes({
        vcenterName: "esxi-standalone",
        datacenterName: "",
        hostName: "esx01",
      }),
    ).toEqual({
      "resource.vmware.vcenter.name": "esxi-standalone",
      "resource.vcenter.host.name": "esx01",
    });
  });
});

describe("whether vCenter still reports the host", () => {
  test("metrics in the last 15 minutes are Reporting; older are Not reporting", () => {
    expect(
      getVMwareHostReportState({
        row: row({ metricsUpdatedAt: minutesAgo(2) }),
        now: NOW,
      }),
    ).toBe(VMwareHostReportState.Reporting);
    expect(
      getVMwareHostReportState({
        row: row({ metricsUpdatedAt: minutesAgo(15) }),
        now: NOW,
      }),
    ).toBe(VMwareHostReportState.Reporting);
    expect(
      getVMwareHostReportState({
        row: row({ metricsUpdatedAt: new Date(minutesAgo(15).getTime() - 1) }),
        now: NOW,
      }),
    ).toBe(VMwareHostReportState.NotReporting);
  });

  test("a row with no metrics yet is No data yet; no row is Not in inventory", () => {
    expect(
      getVMwareHostReportState({
        row: row({ lastSeenAt: minutesAgo(1) }),
        now: NOW,
      }),
    ).toBe(VMwareHostReportState.NoDataYet);
    expect(getVMwareHostReportState({ row: null, now: NOW })).toBe(
      VMwareHostReportState.NotInInventory,
    );
    expect(getVMwareHostReportState({ row: undefined, now: NOW })).toBe(
      VMwareHostReportState.NotInInventory,
    );
  });

  test("a date that is not a date counts as no metrics", () => {
    expect(
      getVMwareHostReportState({
        row: row({ metricsUpdatedAt: "not a date" }),
        now: NOW,
      }),
    ).toBe(VMwareHostReportState.NoDataYet);
  });

  test("the 15 minutes are the lists' own stale limit", () => {
    expect(VMWARE_METRIC_STALE_MS).toBe(15 * MINUTE);
    expect(METRIC_STALE_MS).toBe(VMWARE_METRIC_STALE_MS);
  });

  test("last seen is the newest metrics, else the last inventory sighting", () => {
    expect(
      getVMwareHostLastReportAt(
        row({ metricsUpdatedAt: minutesAgo(3), lastSeenAt: minutesAgo(1) }),
      ),
    ).toEqual(minutesAgo(3));
    expect(
      getVMwareHostLastReportAt(row({ lastSeenAt: minutesAgo(1) })),
    ).toEqual(minutesAgo(1));
    expect(
      getVMwareHostLastReportAt(row({ lastSeenAt: "2026-10-21T11:00:00Z" })),
    ).toEqual(new Date("2026-10-21T11:00:00Z"));
    expect(getVMwareHostLastReportAt(row({}))).toBeNull();
    expect(getVMwareHostLastReportAt(null)).toBeNull();
  });

  test("every state has its words and its tone", () => {
    expect(
      getVMwareHostReportStateLook(VMwareHostReportState.Reporting),
    ).toEqual({
      label: "Reporting",
      tone: "positive",
      description:
        "vCenter reported this host's metrics in the last 15 minutes.",
    });
    expect(
      getVMwareHostReportStateLook(VMwareHostReportState.NotReporting).tone,
    ).toBe("warning");
    expect(
      getVMwareHostReportStateLook(VMwareHostReportState.NoDataYet).label,
    ).toBe("No data yet");
    expect(
      getVMwareHostReportStateLook(VMwareHostReportState.NotInInventory),
    ).toEqual({
      label: "Not in inventory",
      tone: "neutral",
      description: "This host is not in the vCenter's inventory any more.",
    });
  });

  test("a row's reading is fresh for 15 minutes", () => {
    expect(
      hasFreshVMwareMetrics(row({ metricsUpdatedAt: minutesAgo(14) }), NOW),
    ).toBe(true);
    expect(
      hasFreshVMwareMetrics(row({ metricsUpdatedAt: minutesAgo(16) }), NOW),
    ).toBe(false);
    expect(hasFreshVMwareMetrics(row({}), NOW)).toBe(false);
  });

  test("numbers arrive as numbers, numeric strings or nothing", () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber("42.5")).toBe(42.5);
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(0)).toBe(0);
  });
});

describe("the virtual machines on the host", () => {
  const vms: Array<VMwareResourceModel> = [
    row({
      name: "db",
      externalId: "vm/1",
      isPoweredOn: true,
      latestCpuPercent: 78.4,
      latestCpuMhz: 7526,
      latestMemoryBytes: 1024,
      maxMemoryBytes: 2048,
      cpuReadinessPercent: 6.2,
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      name: "ci",
      externalId: "vm/2",
      isPoweredOn: true,
      latestCpuPercent: "64.1",
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      name: "stale",
      externalId: "vm/3",
      isPoweredOn: true,
      latestCpuPercent: 99,
      metricsUpdatedAt: minutesAgo(40),
    }),
    row({
      name: "off",
      externalId: "vm/4",
      isPoweredOn: false,
      latestCpuPercent: 95,
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      name: "template",
      externalId: "vm/5",
      isTemplate: true,
      isPoweredOn: true,
      latestCpuPercent: 99,
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      name: "unknown",
      externalId: "vm/6",
      latestCpuPercent: 99,
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      name: "no-cpu",
      externalId: "vm/7",
      isPoweredOn: true,
      metricsUpdatedAt: minutesAgo(2),
    }),
    row({
      externalId: "vm/4210aaaa-unnamed",
      isPoweredOn: true,
      latestCpuPercent: 64.1,
      metricsUpdatedAt: minutesAgo(2),
    }),
  ];

  test("templates are counted apart; power state unknown is neither on nor off", () => {
    const summary: VMwareHostVirtualMachineSummary =
      summarizeVMwareHostVirtualMachines(vms);
    expect(summary).toEqual({
      total: 7,
      running: 5,
      poweredOff: 1,
      unknown: 1,
      templates: 1,
    });
  });

  test("a host that runs nothing has an empty summary", () => {
    expect(summarizeVMwareHostVirtualMachines([])).toEqual({
      total: 0,
      running: 0,
      poweredOff: 0,
      unknown: 0,
      templates: 0,
    });
  });

  test("the busiest are running VMs with a fresh CPU reading, busiest first", () => {
    const busiest: Array<VMwareBusyVirtualMachine> =
      getBusiestVMwareVirtualMachines({ rows: vms, now: NOW, limit: 5 });

    expect(
      busiest.map((vm: VMwareBusyVirtualMachine): string => {
        return vm.name;
      }),
    ).toEqual(["db", "4210aaaa-unnamed", "ci"]);
    expect(busiest[0]).toEqual({
      externalId: "vm/1",
      name: "db",
      cpuPercent: 78.4,
      cpuMhz: 7526,
      memoryBytes: 1024,
      memoryLimitBytes: 2048,
      cpuReadyPercent: 6.2,
    });
  });

  test("a tie goes to the name, so the list does not reshuffle", () => {
    const tied: Array<VMwareResourceModel> = ["zeta", "alpha", "mid"].map(
      (name: string, index: number): VMwareResourceModel => {
        return row({
          name: name,
          externalId: `vm/${index}`,
          isPoweredOn: true,
          latestCpuPercent: 50,
          metricsUpdatedAt: minutesAgo(1),
        });
      },
    );
    expect(
      getBusiestVMwareVirtualMachines({ rows: tied, now: NOW, limit: 5 }).map(
        (vm: VMwareBusyVirtualMachine): string => {
          return vm.name;
        },
      ),
    ).toEqual(["alpha", "mid", "zeta"]);
  });

  test("the list is cut at its limit, and a negative limit lists nothing", () => {
    expect(
      getBusiestVMwareVirtualMachines({ rows: vms, now: NOW, limit: 1 }),
    ).toHaveLength(1);
    expect(
      getBusiestVMwareVirtualMachines({ rows: vms, now: NOW, limit: -1 }),
    ).toHaveLength(0);
  });
});

describe("how the Overview reads the host's metrics", () => {
  test("the Overview reads exactly these nine vcenter.host series", () => {
    expect(
      Object.values(VMWARE_HOST_OVERVIEW_METRICS).map(
        (read: { metricName: string }): string => {
          return read.metricName;
        },
      ),
    ).toEqual([
      "vcenter.host.cpu.utilization",
      "vcenter.host.memory.utilization",
      "vcenter.host.network.throughput",
      "vcenter.host.network.packet.rate",
      "vcenter.host.network.packet.error.rate",
      "vcenter.host.network.packet.drop.rate",
      "vcenter.host.disk.throughput",
      "vcenter.host.disk.latency.avg",
      "vcenter.host.disk.latency.max",
    ]);
  });

  test("every series is one the VMware catalog knows, in the unit the page scales from", () => {
    /*
     * The page shows utilization as it comes, multiplies throughput by
     * 1024 (KiB/s to bytes) and shows latency in ms and packet counts per
     * second: the catalog's units (the receiver's own) must say the same.
     */
    const expectedUnits: Record<string, string> = {
      "vcenter.host.cpu.utilization": "%",
      "vcenter.host.memory.utilization": "%",
      "vcenter.host.network.throughput": "{KiBy/s}",
      "vcenter.host.network.packet.rate": "{packets/s}",
      "vcenter.host.network.packet.error.rate": "{errors/s}",
      "vcenter.host.network.packet.drop.rate": "{packets/s}",
      "vcenter.host.disk.throughput": "{KiBy/s}",
      "vcenter.host.disk.latency.avg": "ms",
      "vcenter.host.disk.latency.max": "ms",
    };

    for (const read of Object.values(VMWARE_HOST_OVERVIEW_METRICS)) {
      const definition: VMwareMetricDefinition | undefined =
        getVMwareMetricByMetricName(read.metricName);
      expect({ metric: read.metricName, unit: definition?.unit }).toEqual({
        metric: read.metricName,
        unit: expectedUnits[read.metricName],
      });
    }
  });

  test("the highest latency is the worst bucket; everything else is an average", () => {
    for (const [metric, read] of Object.entries(VMWARE_HOST_OVERVIEW_METRICS)) {
      expect({ metric, aggregation: read.aggregationType }).toEqual({
        metric,
        aggregation:
          metric === VMwareHostMetric.DiskLatencyHighest
            ? AggregationType.Max
            : AggregationType.Avg,
      });
    }
  });

  test("only CPU and memory are read as one host-wide line", () => {
    const perHost: Array<string> = Object.entries(VMWARE_HOST_OVERVIEW_METRICS)
      .filter(([, read]: [string, { perDevice: boolean }]): boolean => {
        return !read.perDevice;
      })
      .map(([metric]: [string, unknown]): string => {
        return metric;
      });
    expect(perHost).toEqual([
      VMwareHostMetric.CpuUtilization,
      VMwareHostMetric.MemoryUtilization,
    ]);
  });

  test("a read is the host's window, filtered to the host, newest first", () => {
    const start: Date = minutesAgo(30);
    const aggregateBy: AggregateBy<Metric> = buildVMwareHostAggregateBy({
      projectId: "10000000-0000-4000-8000-000000000001",
      identity: {
        vcenterName: "vcenter-prod",
        datacenterName: "dc-east",
        hostName: "esx01",
      },
      read: VMWARE_HOST_OVERVIEW_METRICS[VMwareHostMetric.CpuUtilization],
      start: start,
      end: NOW,
    });

    expect(aggregateBy.query["name" as keyof typeof aggregateBy.query]).toBe(
      "vcenter.host.cpu.utilization",
    );
    expect(
      aggregateBy.query["attributes" as keyof typeof aggregateBy.query],
    ).toEqual({
      "resource.vmware.vcenter.name": "vcenter-prod",
      "resource.vcenter.datacenter.name": "dc-east",
      "resource.vcenter.host.name": "esx01",
    });
    expect(
      aggregateBy.query["projectId" as keyof typeof aggregateBy.query],
    ).toBe("10000000-0000-4000-8000-000000000001");
    const time: InBetween<Date> = aggregateBy.query[
      "time" as keyof typeof aggregateBy.query
    ] as unknown as InBetween<Date>;
    expect(time.startValue).toEqual(start);
    expect(time.endValue).toEqual(NOW);
    expect(aggregateBy.aggregationType).toBe(AggregationType.Avg);
    expect(aggregateBy.aggregateColumnName).toBe("value");
    expect(aggregateBy.aggregationTimestampColumnName).toBe("time");
    expect(aggregateBy.startTimestamp).toEqual(start);
    expect(aggregateBy.endTimestamp).toEqual(NOW);
    expect(aggregateBy.groupByAttributeKeys).toBeUndefined();
    expect(aggregateBy.groupBy).toBeUndefined();
  });

  test("a per-device read is grouped on the device and the direction only", () => {
    const aggregateBy: AggregateBy<Metric> = buildVMwareHostAggregateBy({
      projectId: "p",
      identity: {
        vcenterName: "vcenter-prod",
        datacenterName: "dc-east",
        hostName: "esx01",
      },
      read: VMWARE_HOST_OVERVIEW_METRICS[VMwareHostMetric.NetworkThroughput],
      start: minutesAgo(30),
      end: NOW,
    });
    expect(aggregateBy.groupByAttributeKeys).toEqual(["object", "direction"]);
    expect(VMWARE_HOST_DEVICE_GROUP_KEYS).toEqual(["object", "direction"]);
    // A copy: a caller changing it does not change the next read.
    expect(aggregateBy.groupByAttributeKeys).not.toBe(
      VMWARE_HOST_DEVICE_GROUP_KEYS,
    );
  });
});

describe("reading the answers", () => {
  test("each bucket's time, value, device and direction", () => {
    expect(
      readVMwareMetricSamples(
        result([
          bucket(minutesAgo(2), 12.5, {
            object: " vmnic0 ",
            direction: "received",
          }),
          bucket(minutesAgo(1), 3),
        ]),
      ),
    ).toEqual([sample(2, "vmnic0", "received", 12.5), sample(1, "", "", 3)]);
  });

  test("a bucket timed on `time`, as a string or a number, is read the same", () => {
    const points: Array<AggregatedModel> = [
      {
        time: minutesAgo(3).toISOString(),
        value: 1,
      } as unknown as AggregatedModel,
      {
        timestamp: minutesAgo(2).getTime(),
        value: 2,
      } as unknown as AggregatedModel,
    ];
    expect(
      readVMwareMetricSamples(result(points)).map(
        (read: VMwareMetricSample): number => {
          return read.time;
        },
      ),
    ).toEqual([minutesAgo(3).getTime(), minutesAgo(2).getTime()]);
  });

  test("buckets without a time or a number, and attributes that are not a map, are dropped or ignored", () => {
    const points: Array<AggregatedModel> = [
      { value: 1 } as unknown as AggregatedModel,
      { timestamp: "nope", value: 1 } as unknown as AggregatedModel,
      { timestamp: minutesAgo(1), value: "NaN" } as unknown as AggregatedModel,
      {
        timestamp: minutesAgo(1),
        value: 7,
        attributes: ["vmnic0"],
      } as unknown as AggregatedModel,
      {
        timestamp: minutesAgo(1),
        value: 8,
        attributes: { object: { nested: true }, direction: 4 },
      } as unknown as AggregatedModel,
    ];
    expect(readVMwareMetricSamples(result(points))).toEqual([
      sample(1, "", "", 7),
      sample(1, "", "4", 8),
    ]);
  });

  test("no answer reads as no samples", () => {
    expect(readVMwareMetricSamples(null)).toEqual([]);
    expect(readVMwareMetricSamples(undefined)).toEqual([]);
    expect(readVMwareMetricSamples({ data: [] })).toEqual([]);
  });

  test('the whole host is the instance "" (and the simulator\'s "*")', () => {
    expect(isVMwareHostTotalObject("")).toBe(true);
    expect(isVMwareHostTotalObject("  ")).toBe(true);
    expect(isVMwareHostTotalObject("*")).toBe(true);
    expect(isVMwareHostTotalObject("vmnic0")).toBe(false);
  });
});

describe("a host-wide line", () => {
  test("the host's own total wins over its devices added up", () => {
    const samples: Array<VMwareMetricSample> = [
      sample(2, "", "received", 100),
      sample(2, "vmnic0", "received", 60),
      sample(2, "vmnic1", "received", 39),
      sample(1, "vmnic0", "received", 10),
      sample(1, "vmnic1", "received", 5),
    ];
    const line: Array<TimeValuePoint> = getVMwareHostSeries({
      samples: samples,
      direction: "received",
    });
    // Bucket 2 has a total; bucket 1 only devices, added up.
    expect(values(line)).toEqual([100, 15]);
    expect(line[0]!.x).toEqual(minutesAgo(2));
  });

  test("one direction only, or every direction, scaled", () => {
    const samples: Array<VMwareMetricSample> = [
      sample(1, "", "received", 2),
      sample(1, "", "transmitted", 3),
    ];
    expect(
      values(
        getVMwareHostSeries({ samples, direction: "transmitted", scale: 1024 }),
      ),
    ).toEqual([3072]);
    expect(values(getVMwareHostSeries({ samples }))).toEqual([5]);
    expect(values(getVMwareHostSeries({ samples, direction: null }))).toEqual([
      5,
    ]);
  });

  test("the worst device, for latency", () => {
    const samples: Array<VMwareMetricSample> = [
      sample(1, "naa.1", "", 12),
      sample(1, "naa.2", "", 47),
    ];
    expect(values(getVMwareHostSeries({ samples, combine: "max" }))).toEqual([
      47,
    ]);
  });

  test("points come out oldest first, whatever order they came in", () => {
    const line: Array<TimeValuePoint> = getVMwareHostSeries({
      samples: [
        sample(1, "", "", 3),
        sample(3, "", "", 1),
        sample(2, "", "", 2),
      ],
    });
    expect(values(line)).toEqual([1, 2, 3]);
  });

  test("two lines add up bucket by bucket, a bucket only one has kept", () => {
    const added: Array<TimeValuePoint> = sumVMwareSeries(
      [
        { x: minutesAgo(2), y: 1 },
        { x: minutesAgo(1), y: 2 },
      ],
      [
        { x: minutesAgo(1), y: 10 },
        { x: minutesAgo(3), y: 5 },
      ],
    );
    expect(added).toEqual([
      { x: minutesAgo(3), y: 5 },
      { x: minutesAgo(2), y: 1 },
      { x: minutesAgo(1), y: 12 },
    ]);
  });
});

describe("the tile values", () => {
  const points: Array<TimeValuePoint> = [
    { x: minutesAgo(20), y: 90 },
    { x: minutesAgo(4), y: 10 },
    { x: minutesAgo(2), y: 30 },
  ];

  test("the mean and the highest of the last few minutes", () => {
    const windowStart: Date = minutesAgo(VMWARE_HOST_TILE_WINDOW_MINUTES);
    expect(meanOfRecentWindow(points, windowStart)).toBe(20);
    expect(maxOfRecentWindow(points, windowStart)).toBe(30);
  });

  test("the whole range when none of it is recent", () => {
    const windowStart: Date = minutesAgo(1);
    expect(meanOfRecentWindow(points, windowStart)).toBeCloseTo(130 / 3);
    expect(maxOfRecentWindow(points, windowStart)).toBe(90);
  });

  test("nothing at all is no value", () => {
    expect(meanOfRecentWindow([], NOW)).toBeNull();
    expect(maxOfRecentWindow([], NOW)).toBeNull();
  });

  test("the tiles read the last five minutes", () => {
    expect(VMWARE_HOST_TILE_WINDOW_MINUTES).toBe(5);
  });
});

describe("network adapters", () => {
  test("one row per NIC, the host total left out, averaged over the range", () => {
    const adapters: Array<VMwareNetworkAdapterRow> =
      summarizeVMwareNetworkAdapters({
        throughput: [
          sample(2, "", "received", 999),
          sample(2, "vmnic0", "received", 100),
          sample(1, "vmnic0", "received", 300),
          sample(2, "vmnic0", "transmitted", 50),
          sample(1, "vmnic10", "received", 1),
          sample(1, "vmnic2", "received", 2),
        ],
        packets: [
          sample(1, "vmnic0", "received", 10),
          sample(1, "vmnic0", "transmitted", 5),
        ],
        errors: [
          sample(1, "vmnic0", "received", 0),
          sample(1, "vmnic2", "received", 0.4),
          sample(1, "vmnic2", "transmitted", 0.1),
        ],
        drops: [sample(1, "*", "received", 7)],
      });

    // Natural order: vmnic2 before vmnic10.
    expect(
      adapters.map((adapter: VMwareNetworkAdapterRow): string => {
        return adapter.name;
      }),
    ).toEqual(["vmnic0", "vmnic2", "vmnic10"]);
    expect(adapters[0]).toEqual({
      name: "vmnic0",
      receivedBytesPerSecond: 200 * 1024,
      sentBytesPerSecond: 50 * 1024,
      packetsPerSecond: 15,
      errorsPerSecond: 0,
      dropsPerSecond: null,
    });
    expect(adapters[1]!.errorsPerSecond).toBeCloseTo(0.5);
    expect(adapters[1]!.sentBytesPerSecond).toBeNull();
    expect(adapters[2]!.packetsPerSecond).toBeNull();
  });

  test("a host that reports no per-NIC counters has no rows", () => {
    expect(
      summarizeVMwareNetworkAdapters({
        throughput: [sample(1, "", "received", 5)],
        packets: [],
        errors: [],
        drops: [],
      }),
    ).toEqual([]);
  });
});

describe("storage devices", () => {
  test("one row per device, each direction averaged on its own", () => {
    const devices: Array<VMwareStorageDeviceRow> =
      summarizeVMwareStorageDevices({
        throughput: [
          sample(2, "naa.1", "read", 10),
          sample(1, "naa.1", "read", 20),
          sample(1, "naa.1", "write", 4),
          sample(1, "", "read", 999),
        ],
        latencyAverage: [
          sample(2, "naa.1", "read", 2),
          sample(1, "naa.1", "read", 4),
          sample(1, "naa.1", "write", 60),
          sample(1, "t10.NVMe", "read", 0.4),
        ],
      });
    expect(devices).toEqual([
      {
        name: "naa.1",
        readBytesPerSecond: 15 * 1024,
        writeBytesPerSecond: 4 * 1024,
        readLatencyMs: 3,
        writeLatencyMs: 60,
      },
      {
        name: "t10.NVMe",
        readBytesPerSecond: null,
        writeBytesPerSecond: null,
        readLatencyMs: 0.4,
        writeLatencyMs: null,
      },
    ]);
  });
});

describe("the whole Overview from its reads", () => {
  const throughput: AggregatedResult = result([
    bucket(minutesAgo(2), 20, { object: "", direction: "received" }),
    bucket(minutesAgo(2), 10, { object: "", direction: "transmitted" }),
    bucket(minutesAgo(2), 15, { object: "vmnic0", direction: "received" }),
  ]);

  test("tiles, charts and tables, each from its own read", () => {
    const overview: VMwareHostOverviewMetrics = summarizeVMwareHostMetrics({
      results: {
        [VMwareHostMetric.CpuUtilization]: result([
          bucket(minutesAgo(10), 80),
          bucket(minutesAgo(2), 40),
        ]),
        [VMwareHostMetric.MemoryUtilization]: result([
          bucket(minutesAgo(2), 61),
        ]),
        [VMwareHostMetric.NetworkThroughput]: throughput,
        [VMwareHostMetric.DiskLatencyHighest]: result([
          bucket(minutesAgo(3), 12, { object: "" }),
          bucket(minutesAgo(2), 33, { object: "" }),
        ]),
        [VMwareHostMetric.DiskThroughput]: result([
          bucket(minutesAgo(2), 5, { object: "naa.1", direction: "read" }),
        ]),
      },
      tileWindowStart: minutesAgo(5),
    });

    expect(overview.tiles).toEqual({
      cpuPercent: 40,
      memoryPercent: 61,
      highestDiskLatencyMs: 33,
      networkReceivedBytesPerSecond: 20 * 1024,
      networkSentBytesPerSecond: 10 * 1024,
    });
    expect(values(overview.series.cpuPercent)).toEqual([80, 40]);
    expect(values(overview.series.highestDiskLatencyMs)).toEqual([12, 33]);
    expect(values(overview.series.networkReceivedBytesPerSecond)).toEqual([
      20 * 1024,
    ]);
    expect(overview.networkAdapters).toHaveLength(1);
    expect(overview.networkAdapters[0]!.name).toBe("vmnic0");
    expect(overview.storageDevices).toEqual([
      {
        name: "naa.1",
        readBytesPerSecond: 5 * 1024,
        writeBytesPerSecond: null,
        readLatencyMs: null,
        writeLatencyMs: null,
      },
    ]);
  });

  test("a read that failed leaves its part empty and the rest whole", () => {
    const overview: VMwareHostOverviewMetrics = summarizeVMwareHostMetrics({
      results: {
        [VMwareHostMetric.CpuUtilization]: null,
        [VMwareHostMetric.NetworkThroughput]: throughput,
      },
      tileWindowStart: minutesAgo(5),
    });
    expect(overview.tiles.cpuPercent).toBeNull();
    expect(overview.tiles.memoryPercent).toBeNull();
    expect(overview.tiles.highestDiskLatencyMs).toBeNull();
    expect(overview.tiles.networkSentBytesPerSecond).toBe(10 * 1024);
    expect(overview.series.cpuPercent).toEqual([]);
    expect(overview.storageDevices).toEqual([]);
  });

  test("no reads at all is an empty Overview, not an error", () => {
    const overview: VMwareHostOverviewMetrics = summarizeVMwareHostMetrics({
      results: {},
      tileWindowStart: NOW,
    });
    expect(overview.tiles).toEqual({
      cpuPercent: null,
      memoryPercent: null,
      highestDiskLatencyMs: null,
      networkReceivedBytesPerSecond: null,
      networkSentBytesPerSecond: null,
    });
    expect(overview.networkAdapters).toEqual([]);
    expect(overview.storageDevices).toEqual([]);
  });
});

describe("the disk latency gauge", () => {
  test("fills toward 50 ms, and turns amber at 20 ms like the tables", () => {
    expect(VMWARE_DISK_LATENCY_WARN_MS).toBe(20);
    expect(VMWARE_DISK_LATENCY_DANGER_MS).toBe(50);
    expect(getVMwareDiskLatencyGaugePercent(0)).toBe(0);
    expect(getVMwareDiskLatencyGaugePercent(10)).toBe(20);
    expect(getVMwareDiskLatencyGaugePercent(20)).toBe(
      VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS.warn,
    );
    expect(getVMwareDiskLatencyGaugePercent(50)).toBe(
      VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS.danger,
    );
    expect(getVMwareDiskLatencyGaugePercent(400)).toBe(100);
    expect(getVMwareDiskLatencyGaugePercent(-3)).toBe(0);
    expect(getVMwareDiskLatencyGaugePercent(null)).toBeNull();
    expect(getVMwareDiskLatencyGaugePercent(NaN)).toBeNull();
  });
});

describe("whether an incident or alert is about this host", () => {
  test("the templates' resource key and the bare key both name a host", () => {
    expect(VMWARE_HOST_NAME_LABEL_KEYS).toEqual([
      "resource.vcenter.host.name",
      "vcenter.host.name",
    ]);
    expect(
      seriesLabelsNameVMwareHost(
        { "resource.vcenter.host.name": "esx01.acme.example" },
        "esx01.acme.example",
      ),
    ).toBe(true);
    expect(
      seriesLabelsNameVMwareHost(
        { "vcenter.host.name": "esx01.acme.example" },
        "esx01.acme.example",
      ),
    ).toBe(true);
  });

  test("case and surrounding spaces do not matter", () => {
    expect(
      seriesLabelsNameVMwareHost(
        { "resource.vcenter.host.name": " ESX01.Acme.Example " },
        "esx01.acme.example",
      ),
    ).toBe(true);
  });

  test("another host, another key, no labels or no name is not this host", () => {
    expect(
      seriesLabelsNameVMwareHost(
        { "resource.vcenter.host.name": "esx02.acme.example" },
        "esx01.acme.example",
      ),
    ).toBe(false);
    expect(
      seriesLabelsNameVMwareHost(
        { "resource.vcenter.vm.name": "esx01.acme.example" },
        "esx01.acme.example",
      ),
    ).toBe(false);
    expect(
      seriesLabelsNameVMwareHost({ "resource.vcenter.host.name": 42 }, "42"),
    ).toBe(false);
    expect(seriesLabelsNameVMwareHost(null, "esx01")).toBe(false);
    expect(seriesLabelsNameVMwareHost(undefined, "esx01")).toBe(false);
    expect(
      seriesLabelsNameVMwareHost({ "resource.vcenter.host.name": "" }, ""),
    ).toBe(false);
  });

  test("a prefix of another host's name is not this host", () => {
    expect(
      seriesLabelsNameVMwareHost(
        { "resource.vcenter.host.name": "esx01.acme.example.lab" },
        "esx01.acme.example",
      ),
    ).toBe(false);
  });
});

describe("how numbers are written", () => {
  test("a rate per second", () => {
    expect(formatVMwarePerSecond(null)).toBe("—");
    expect(formatVMwarePerSecond(NaN)).toBe("—");
    expect(formatVMwarePerSecond(0)).toBe("0/s");
    expect(formatVMwarePerSecond(0.004)).toBe("<0.01/s");
    expect(formatVMwarePerSecond(0.4)).toBe("0.4/s");
    expect(formatVMwarePerSecond(2.346)).toBe("2.35/s");
    expect(formatVMwarePerSecond(12.6)).toBe("13/s");
    expect(formatVMwarePerSecond(2600)).toBe("2.6K/s");
    expect(formatVMwarePerSecond(3400000)).toBe("3.4M/s");
  });

  test("milliseconds", () => {
    expect(formatVMwareMilliseconds(null)).toBe("—");
    expect(formatVMwareMilliseconds(Infinity)).toBe("—");
    expect(formatVMwareMilliseconds(0.4)).toBe("0.4 ms");
    expect(formatVMwareMilliseconds(44.83)).toBe("44.8 ms");
    expect(formatVMwareMilliseconds(31)).toBe("31 ms");
    expect(formatVMwareMilliseconds(250.6)).toBe("251 ms");
  });
});
