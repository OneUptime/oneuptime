import {
  STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES,
  StorageArrayHealthStatus,
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  StorageArraySnapshotDerivedExtras,
  bufferStorageArraySnapshotMetric,
  deriveStorageArrayCountsByKind,
  deriveStorageArraySnapshotExtras,
  getStorageArrayResourceRows,
} from "../../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../../Types/StorageArray/StorageSystem";
import DellPowerStorePlatform from "../../../../../Types/StorageArray/Platforms/Dell/PowerStore/PowerStorePlatform";
import {
  CapturedSeries,
  parseOpenMetrics,
  toOtlpDatapoint,
} from "../../../../Helpers/StorageArray/OpenMetricsCapture";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT A DELL POWERSTORE'S METRICS BECOME (#11002).
 *
 * Every path the Storage Array Agent scrapes on a PowerStore, as Dell's
 * powerstore-metrics-exporter v1.0.3 answered it
 * (Fixtures/DellPowerStoreExporter/v1.0.3: the real exporter against a
 * stand-in two-appliance cluster, its README says what was not real), goes
 * through the scan exactly as OtelMetricsIngestService runs it: the gate,
 * bufferStorageArraySnapshotMetric per datapoint, then what its flush hands
 * to Postgres - the inventory rows, the array's columns, the counts of each
 * kind. Once per path, as the agent's scrape jobs send them; the whole
 * cluster in one batch; the same paths read per object (the exporter's
 * non-bulk mode); and what the collector itself sent, scrape by scrape.
 *
 * The cluster's faults (the README lists them) are what the pages and
 * monitors must show: a failed drive, a disconnected power supply, a failed
 * fan, a Fibre Channel port without its link, an offline volume, a degraded
 * NAS server, an appliance 92% full.
 */

const RECORDINGS: string = path.join(
  __dirname,
  "../../../../Fixtures/DellPowerStoreExporter/v1.0.3",
);

const ARRAY_ID: string = "5a7e0000-0000-4000-8000-00000000d311";

// 2026-11-26T05:00:00.000Z — the instant the recorded scrapes are read at.
const SCRAPE_TIME_MS: number = Date.UTC(2026, 10, 26, 5, 0, 0);

// Each recorded path, and the scrape_endpoint label its job puts on it.
const PATHS: Array<[string, string]> = [
  ["cluster", "cluster"],
  ["appliance", "appliance"],
  ["capacity", "capacity"],
  ["hardware", "hardware"],
  ["port", "port"],
  ["volume", "volume"],
  ["volumeGroup", "volumegroup"],
  ["nas", "nas"],
  ["file", "file"],
];

type Mode = "bulk" | "per-object";

function capture(mode: Mode, part: string): Array<CapturedSeries> {
  return parseOpenMetrics(
    fs.readFileSync(path.join(RECORDINGS, mode, `${part}.prom`), "utf8"),
  );
}

interface Batch {
  series: Array<{ series: CapturedSeries; jobLabels: Record<string, string> }>;
}

function pathBatch(mode: Mode, part: string, endpoint: string): Batch {
  return {
    series: capture(mode, part).map((series: CapturedSeries) => {
      return { series, jobLabels: { scrape_endpoint: endpoint } };
    }),
  };
}

function clusterBatch(mode: Mode): Batch {
  return {
    series: PATHS.flatMap(([part, endpoint]: [string, string]) => {
      return pathBatch(mode, part, endpoint).series;
    }),
  };
}

interface Outcome {
  read: Array<string>;
  rows: Array<StorageArrayResourceBufferEntry>;
  snapshot: StorageArraySnapshotBufferEntry | undefined;
  extras: StorageArraySnapshotDerivedExtras;
  counts: Record<string, number> | null;
}

function flush(
  resourceBuffer: Map<string, Map<string, StorageArrayResourceBufferEntry>>,
  arrayBuffer: Map<string, StorageArraySnapshotBufferEntry>,
  read: Set<string>,
): Outcome {
  const snapshot: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(ARRAY_ID);
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(
      Array.from(resourceBuffer.get(ARRAY_ID)?.values() || []),
      snapshot,
    );
  return {
    read: Array.from(read).sort(),
    rows,
    snapshot,
    extras: deriveStorageArraySnapshotExtras(rows, snapshot),
    counts: deriveStorageArrayCountsByKind(rows, snapshot),
  };
}

// Exactly what OtelMetricsIngestService does with one batch of one array.
function ingest(
  batch: Batch,
  declaredStorageSystem: string | null = StorageSystem.DellPowerStore,
): Outcome {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  const read: Set<string> = new Set();
  for (const item of batch.series) {
    if (!STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(item.series.name)) {
      continue;
    }
    read.add(item.series.name);
    bufferStorageArraySnapshotMetric({
      arrayIdStr: ARRAY_ID,
      metricName: item.series.name,
      datapoint: toOtlpDatapoint(item.series, {
        timeMs: SCRAPE_TIME_MS,
        jobLabels: item.jobLabels,
      }),
      resourceBuffer,
      arrayBuffer,
      declaredStorageSystem,
    });
  }
  return flush(resourceBuffer, arrayBuffer, read);
}

function rowsOf(
  outcome: Outcome,
  kind: string,
): Array<StorageArrayResourceBufferEntry> {
  return outcome.rows
    .filter((row: StorageArrayResourceBufferEntry): boolean => {
      return row.kind === kind;
    })
    .sort(
      (
        a: StorageArrayResourceBufferEntry,
        b: StorageArrayResourceBufferEntry,
      ): number => {
        return a.externalId.localeCompare(b.externalId);
      },
    );
}

function rowOf(
  outcome: Outcome,
  kind: string,
  externalId: string,
): StorageArrayResourceBufferEntry {
  const row: StorageArrayResourceBufferEntry | undefined = outcome.rows.find(
    (candidate: StorageArrayResourceBufferEntry): boolean => {
      return candidate.kind === kind && candidate.externalId === externalId;
    },
  );
  expect({ kind, externalId, found: Boolean(row) }).toEqual({
    kind,
    externalId,
    found: true,
  });
  return row!;
}

function detail(row: StorageArrayResourceBufferEntry, key: string): unknown {
  return (row.details as JSONObject | null)?.[key];
}

// A recorded series' value, by its name and labels.
function recorded(
  part: string,
  name: string,
  labels: Record<string, string>,
): number {
  const found: CapturedSeries | undefined = capture("bulk", part).find(
    (series: CapturedSeries): boolean => {
      return (
        series.name === name &&
        Object.entries(labels).every(([key, value]: [string, string]) => {
          return series.labels[key] === value;
        })
      );
    },
  );
  expect({ name, labels, found: Boolean(found) }).toEqual({
    name,
    labels,
    found: true,
  });
  return found!.value;
}

const KIND: { Appliance: string; VolumeGroup: string; NasServer: string } = {
  Appliance: "Appliance",
  VolumeGroup: "VolumeGroup",
  NasServer: "NasServer",
};

const WHOLE: Outcome = ingest(clusterBatch("bulk"));

describe("a PowerStore's recorded scrape, every path in one batch", () => {
  test("is read as a Dell PowerStore, named and identified by its cluster", () => {
    expect(WHOLE.snapshot?.storageSystem).toBe(StorageSystem.DellPowerStore);
    expect(WHOLE.extras).toMatchObject({
      storageSystem: StorageSystem.DellPowerStore,
      reportedName: "ps-prod-01",
      systemId: "PS4f5c9a3d21e7",
      osName: "PowerStoreOS",
    });
  });

  test("reads every family the platform lists, and none it does not", () => {
    // Every snapshot family is in the recording...
    expect(WHOLE.read).toEqual(
      [...DellPowerStorePlatform.snapshotMetricNames].sort(),
    );
    // ...and what the gate passes over is charts' alone.
    const passedOver: Array<string> = clusterBatch("bulk")
      .series.map((item: { series: CapturedSeries }): string => {
        return item.series.name;
      })
      .filter((name: string): boolean => {
        return !STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(name);
      });
    expect(passedOver.length).toBeGreaterThan(0);
    for (const name of passedOver) {
      expect(name.startsWith("powerstore_")).toBe(true);
    }
  });

  test("counts each kind of the cluster, the platform's own kinds among them", () => {
    expect(WHOLE.counts).toEqual({
      [KIND.Appliance]: 2,
      [StorageArrayResourceKind.Drive]: 24,
      [StorageArrayResourceKind.FileSystem]: 3,
      [StorageArrayResourceKind.Hardware]: rowsOf(
        WHOLE,
        StorageArrayResourceKind.Hardware,
      ).length,
      [KIND.NasServer]: 2,
      [StorageArrayResourceKind.NetworkInterface]: rowsOf(
        WHOLE,
        StorageArrayResourceKind.NetworkInterface,
      ).length,
      [StorageArrayResourceKind.Volume]: 9,
      [KIND.VolumeGroup]: rowsOf(WHOLE, KIND.VolumeGroup).length,
    });
    // Nodes, fans, power supplies and batteries: 2 + 4 + 2 + 2 per appliance.
    expect(rowsOf(WHOLE, StorageArrayResourceKind.Hardware)).toHaveLength(20);
    expect(WHOLE.extras.volumeCount).toBe(9);
    expect(WHOLE.extras.fileSystemCount).toBe(3);
  });

  test("lists each appliance by its id, with its name, service tag, space and performance", () => {
    const appliances: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      KIND.Appliance,
    );
    expect(
      appliances.map((row: StorageArrayResourceBufferEntry) => {
        return [row.externalId, row.name];
      }),
    ).toEqual([
      ["A1", "ps-prod-01-appliance-1"],
      ["A2", "ps-prod-01-appliance-2"],
    ]);
    const a2: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      KIND.Appliance,
      "A2",
    );
    expect(a2.capacityBytes).toBe(
      recorded("capacity", "powerstore_cap_last_physical_total", {
        appliance_id: "A2",
      }),
    );
    expect(a2.usedBytes).toBe(
      recorded("capacity", "powerstore_cap_last_physical_used", {
        appliance_id: "A2",
      }),
    );
    // A2 is 92% full.
    expect((a2.usedBytes! / a2.capacityBytes!) * 100).toBeCloseTo(92.09, 1);
    expect(a2.dataReductionRatio).toBe(
      recorded("capacity", "powerstore_cap_last_data_reduction", {
        appliance_id: "A2",
      }),
    );
    // A2 reads at 6.2 ms, in the series' own microseconds.
    expect(a2.readLatencyUsec).toBe(
      recorded("appliance", "powerstore_perf_avg_read_latency", {
        appliance_id: "A2",
      }),
    );
    expect(a2.readLatencyUsec).toBeGreaterThan(6000);
    for (const [column, name] of [
      ["writeLatencyUsec", "powerstore_perf_avg_write_latency"],
      ["readIops", "powerstore_perf_avg_read_iops"],
      ["writeIops", "powerstore_perf_avg_write_iops"],
      ["readBytesPerSec", "powerstore_perf_avg_read_bandwidth"],
      ["writeBytesPerSec", "powerstore_perf_avg_write_bandwidth"],
    ] as Array<[keyof StorageArrayResourceBufferEntry, string]>) {
      expect({ column, value: a2[column] }).toEqual({
        column,
        value: recorded("appliance", name, { appliance_id: "A2" }),
      });
    }
    expect(detail(a2, "serviceTag")).toBe(
      capture("bulk", "appliance").find((series: CapturedSeries) => {
        return (
          series.name === "powerstore_appliance" &&
          series.labels["appliance_id"] === "A2"
        );
      })!.labels["service_tag"],
    );
  });

  test("the array's capacity is its appliances', summed, and its data reduction weighted by the data each holds", () => {
    const appliances: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      KIND.Appliance,
    );
    const total: number = appliances.reduce(
      (sum: number, row: StorageArrayResourceBufferEntry): number => {
        return sum + row.capacityBytes!;
      },
      0,
    );
    const used: number = appliances.reduce(
      (sum: number, row: StorageArrayResourceBufferEntry): number => {
        return sum + row.usedBytes!;
      },
      0,
    );
    // The array's columns hold whole MiB, as every platform's do.
    const MiB: number = 1024 * 1024;
    expect(WHOLE.extras.capacityBytes).toBe(Math.round(total / MiB) * MiB);
    expect(WHOLE.extras.usedBytes).toBe(Math.round(used / MiB) * MiB);
    // In hundredths of a percent, as the column keeps it.
    expect(WHOLE.extras.capacityUsedPercent).toBeCloseTo(
      (used / total) * 100,
      2,
    );

    const weight: (id: string) => number = (id: string): number => {
      return recorded("capacity", "powerstore_cap_last_data_physical_used", {
        appliance_id: id,
      });
    };
    const ratio: (id: string) => number = (id: string): number => {
      return recorded("capacity", "powerstore_cap_last_data_reduction", {
        appliance_id: id,
      });
    };
    expect(WHOLE.extras.dataReductionRatio).toBeCloseTo(
      (ratio("A1") * weight("A1") + ratio("A2") * weight("A2")) /
        (weight("A1") + weight("A2")),
      2,
    );
    // Neither appliance's own ratio: a mean of the two would read 3.15.
    expect(WHOLE.extras.dataReductionRatio).not.toBeCloseTo(
      (ratio("A1") + ratio("A2")) / 2,
      2,
    );
  });

  test("lists each volume by name, its appliance, size, space used, state and performance", () => {
    const volumes: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      StorageArrayResourceKind.Volume,
    );
    expect(volumes).toHaveLength(9);
    for (const volume of volumes) {
      expect(volume.name).toBe(volume.externalId);
      expect(["A1", "A2"]).toContain(volume.groupName);
      expect(volume.capacityBytes).toBe(
        recorded("volume", "powerstore_volume_size", {
          name: volume.externalId,
        }),
      );
      expect(volume.usedBytes).toBe(
        recorded("volume", "powerstore_volume_logical_used", {
          name: volume.externalId,
        }),
      );
    }
    // The offline volume is not ready; the others are.
    expect(
      volumes
        .filter((volume: StorageArrayResourceBufferEntry): boolean => {
          return volume.status !== "ready";
        })
        .map((volume: StorageArrayResourceBufferEntry) => {
          return [volume.externalId, volume.status];
        }),
    ).toEqual([["archive-legacy", "not ready"]]);
    // Per-volume performance, by the volume's id the exporter names it by.
    const withPerformance: Array<StorageArrayResourceBufferEntry> =
      volumes.filter((volume: StorageArrayResourceBufferEntry): boolean => {
        return volume.readLatencyUsec !== null;
      });
    expect(withPerformance.length).toBeGreaterThan(0);
    for (const volume of withPerformance) {
      expect(volume.readIops).not.toBeNull();
      expect(volume.writeLatencyUsec).not.toBeNull();
    }
  });

  test("lists nodes, fans, power supplies and batteries as hardware, with their appliance, and calls the faulty ones unhealthy", () => {
    const hardware: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      StorageArrayResourceKind.Hardware,
    );
    // The same part name on two appliances is two parts.
    expect(
      hardware
        .filter((row: StorageArrayResourceBufferEntry): boolean => {
          return row.name === "BaseEnclosure-NodeA-Fan0";
        })
        .map((row: StorageArrayResourceBufferEntry) => {
          return [row.externalId, row.groupName];
        }),
    ).toEqual([
      ["A1/BaseEnclosure-NodeA-Fan0", "A1"],
      ["A2/BaseEnclosure-NodeA-Fan0", "A2"],
    ]);
    const types: Set<string | null> = new Set(
      hardware.map((row: StorageArrayResourceBufferEntry) => {
        return row.componentType;
      }),
    );
    expect([...types].sort()).toEqual([
      "Battery",
      "Fan",
      "Node",
      "Power Supply",
    ]);
    // A node's lifecycle state, as PowerStore names it, and its serial.
    const node: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      StorageArrayResourceKind.Hardware,
      "A1/BaseEnclosure-NodeA",
    );
    expect(node.status).toBe("healthy");
    expect(detail(node, "serialNumber")).toBe("FXTSP221300670");
    expect(
      hardware
        .filter((row: StorageArrayResourceBufferEntry): boolean => {
          return row.status !== "healthy";
        })
        .map((row: StorageArrayResourceBufferEntry) => {
          return [row.externalId, row.status];
        }),
    ).toEqual([
      ["A1/BaseEnclosure-NodeB-PowerSupply", "unhealthy"],
      ["A2/BaseEnclosure-NodeB-Fan1", "unhealthy"],
    ]);
  });

  test("lists each drive with its type, size and endurance, and its failure", () => {
    const drives: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      StorageArrayResourceKind.Drive,
    );
    expect(drives).toHaveLength(24);
    const failed: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      StorageArrayResourceKind.Drive,
      "A1/Drive_0_0_7",
    );
    expect(failed.status).toBe("unhealthy");
    expect(failed.groupName).toBe("A1");
    expect(failed.capacityBytes).toBe(3840755982336);
    expect(failed.componentType).toBe("NVMe SSD");
    expect(detail(failed, "protocol")).toBe("NVMe");
    const worn: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      StorageArrayResourceKind.Drive,
      "A1/Drive_0_0_3",
    );
    expect(detail(worn, "enduranceRemainingPercent")).toBe(8);
    expect(worn.status).toBe("healthy");
    expect(
      rowOf(WHOLE, StorageArrayResourceKind.Drive, "A1/Drive_0_0_23")
        .componentType,
    ).toBe("NVMe NVRAM");
    expect(
      drives.filter((row: StorageArrayResourceBufferEntry): boolean => {
        return row.status !== "healthy";
      }),
    ).toHaveLength(1);
  });

  test("lists each front-end port with its type, link, speed, traffic and errors", () => {
    const ports: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      StorageArrayResourceKind.NetworkInterface,
    );
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(["Fibre Channel", "Ethernet"]).toContain(port.componentType);
      expect(["up", "down"]).toContain(port.status);
      expect(["A1", "A2"]).toContain(port.groupName);
    }
    const down: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      StorageArrayResourceKind.NetworkInterface,
      "A2/BaseEnclosure-NodeB-IoModule0-FEPort1",
    );
    expect(down.status).toBe("down");
    expect(down.componentType).toBe("Fibre Channel");
    expect(
      ports
        .filter((port: StorageArrayResourceBufferEntry): boolean => {
          return port.status === "down";
        })
        .map((port: StorageArrayResourceBufferEntry) => {
          return port.externalId;
        }),
    ).toContain("A2/BaseEnclosure-NodeB-IoModule0-FEPort1");
    // A port's speed in Gb/s, and in bytes per second for the page.
    const up: StorageArrayResourceBufferEntry = ports.find(
      (port: StorageArrayResourceBufferEntry): boolean => {
        return (
          port.status === "up" &&
          typeof detail(port, "speedGbps") === "number" &&
          (detail(port, "speedGbps") as number) > 0
        );
      },
    )!;
    expect(up).toBeDefined();
    expect(detail(up, "speedBytesPerSec")).toBe(
      ((detail(up, "speedGbps") as number) * 1e9) / 8,
    );
    // Every port says its error rate, read from the per-type counters.
    for (const port of ports) {
      expect(typeof detail(port, "errorsPerSec")).toBe("number");
    }
  });

  test("lists NAS servers and file systems, the degraded server not started", () => {
    expect(
      rowsOf(WHOLE, KIND.NasServer).map(
        (row: StorageArrayResourceBufferEntry) => {
          return [row.externalId, row.status];
        },
      ),
    ).toEqual([
      ["nas-files-02", "not started"],
      ["nas-prod-01", "started"],
    ]);
    const home: StorageArrayResourceBufferEntry = rowOf(
      WHOLE,
      StorageArrayResourceKind.FileSystem,
      "fs-home",
    );
    expect(home.capacityBytes).toBe(
      recorded("file", "powerstore_filesystem_logical_provisioned", {
        name: "fs-home",
      }),
    );
    expect(home.usedBytes).toBe(
      recorded("file", "powerstore_filesystem_logical_used", {
        name: "fs-home",
      }),
    );
    // 94.5% full.
    expect((home.usedBytes! / home.capacityBytes!) * 100).toBeCloseTo(94.5, 1);
  });

  test("lists each volume group with its space and the appliances it spans", () => {
    const groups: Array<StorageArrayResourceBufferEntry> = rowsOf(
      WHOLE,
      KIND.VolumeGroup,
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.capacityBytes).toBe(
        recorded("volumeGroup", "powerstore_volumegroup_logical_provisioned", {
          name: group.externalId,
        }),
      );
      // The appliances it spans, listed: one series came from each.
      expect(detail(group, "appliances")).toMatch(/^A\d+(, A\d+)*$/);
    }
  });

  test("derives the array's health from its parts, with no alert series to wait for", () => {
    // A failed drive is critical; the array is Critical.
    expect(WHOLE.extras.unhealthyHardwareCount).toBeGreaterThan(0);
    expect(WHOLE.extras.healthStatus).toBe(StorageArrayHealthStatus.Critical);
    // PowerStore's alerts arrive as logs: no open-alert count is written.
    expect(WHOLE.extras.openAlertCount).toBeUndefined();
  });

  test("a stamp a Pure agent wrote cannot make PowerStore series another platform's", () => {
    for (const declared of [
      null,
      StorageSystem.PureStorageFlashArray,
      "netapp.ontap",
    ]) {
      const outcome: Outcome = ingest(clusterBatch("bulk"), declared);
      expect({ declared, system: outcome.snapshot?.storageSystem }).toEqual({
        declared,
        system: StorageSystem.DellPowerStore,
      });
      expect(outcome.counts).toEqual(WHOLE.counts);
    }
  });
});

describe("a PowerStore's recorded scrape, one path per batch as the agent's jobs send them", () => {
  test.each(PATHS)(
    "/metrics/<cluster>/%s completes exactly the kinds the platform says it lists",
    (part: string, endpoint: string) => {
      const outcome: Outcome = ingest(pathBatch("bulk", part, endpoint));
      const listed: ReadonlyArray<string> =
        DellPowerStorePlatform.scrapeEndpoints[endpoint] || [];
      expect(Object.keys(outcome.counts || {}).sort()).toEqual(
        [...listed].sort(),
      );
      // Every row the batch made is of a kind it lists, and counted.
      for (const row of outcome.rows) {
        expect(listed).toContain(row.kind);
      }
      for (const kind of listed) {
        expect(outcome.counts![kind]).toBe(rowsOf(outcome, kind).length);
        expect(outcome.counts![kind]).toBe(WHOLE.counts![kind]);
      }
    },
  );

  test("the cluster's path names the array and lists no object", () => {
    const outcome: Outcome = ingest(pathBatch("bulk", "cluster", "cluster"));
    expect(outcome.rows).toEqual([]);
    expect(outcome.extras.reportedName).toBe("ps-prod-01");
    expect(outcome.counts).toBeNull();
  });

  test("the capacity path alone keeps each appliance's name off the row, never writing its id over it", () => {
    const outcome: Outcome = ingest(pathBatch("bulk", "capacity", "capacity"));
    for (const appliance of rowsOf(outcome, KIND.Appliance)) {
      expect(appliance.capacityBytes).not.toBeNull();
      expect(appliance.name).not.toBe(appliance.externalId);
    }
  });

  test("a hardware batch alone writes the array's health", () => {
    const outcome: Outcome = ingest(pathBatch("bulk", "hardware", "hardware"));
    expect(outcome.extras.healthStatus).toBe(StorageArrayHealthStatus.Critical);
    // The volume batch knows nothing of the hardware: it writes no health.
    expect(
      ingest(pathBatch("bulk", "volume", "volume")).extras.healthStatus,
    ).toBeUndefined();
  });
});

describe("a PowerStore read per object (POWERSTORE_BULK_METRICS=false)", () => {
  const perObject: Outcome = ingest(clusterBatch("per-object"));

  test("makes the same inventory and counts as the bulk archive", () => {
    expect(perObject.counts).toEqual(WHOLE.counts);
    const key: (row: StorageArrayResourceBufferEntry) => string = (
      row: StorageArrayResourceBufferEntry,
    ): string => {
      return `${row.kind}|${row.externalId}|${row.name}|${row.status}|${row.capacityBytes}|${row.usedBytes}`;
    };
    expect(perObject.rows.map(key).sort()).toEqual(WHOLE.rows.map(key).sort());
    expect(perObject.extras.capacityBytes).toBe(WHOLE.extras.capacityBytes);
    expect(perObject.extras.healthStatus).toBe(WHOLE.extras.healthStatus);
  });
});

/*
 * What the collector sent (collector/metrics.jsonl): the same series after
 * the agent's own processors, with its resource attributes, one export per
 * scrape and pipeline - the ingest's input, byte for byte.
 */
describe("what the shipped collector sent OneUptime", () => {
  interface Export {
    resource: Record<string, string>;
    datapoints: Array<{ metricName: string; datapoint: JSONObject }>;
  }

  function readExports(): Array<Export> {
    const exports: Array<Export> = [];
    const text: string = fs.readFileSync(
      path.join(RECORDINGS, "collector", "metrics.jsonl"),
      "utf8",
    );
    for (const line of text.split("\n").filter(Boolean)) {
      for (const resourceMetrics of ((JSON.parse(line) as JSONObject)[
        "resourceMetrics"
      ] || []) as JSONArray) {
        const rm: JSONObject = resourceMetrics as JSONObject;
        const resource: Record<string, string> = {};
        for (const attribute of ((rm["resource"] as JSONObject)["attributes"] ||
          []) as JSONArray) {
          const a: JSONObject = attribute as JSONObject;
          resource[a["key"] as string] = Object.values(
            a["value"] as JSONObject,
          )[0] as string;
        }
        const datapoints: Array<{
          metricName: string;
          datapoint: JSONObject;
        }> = [];
        for (const scopeMetrics of (rm["scopeMetrics"] || []) as JSONArray) {
          for (const metric of ((scopeMetrics as JSONObject)["metrics"] ||
            []) as JSONArray) {
            const m: JSONObject = metric as JSONObject;
            const data: JSONObject = (m["gauge"] || m["sum"]) as JSONObject;
            for (const point of (data?.["dataPoints"] || []) as JSONArray) {
              datapoints.push({
                metricName: m["name"] as string,
                datapoint: point as JSONObject,
              });
            }
          }
        }
        exports.push({ resource, datapoints });
      }
    }
    return exports;
  }

  const exports: Array<Export> = readExports();

  test("every export is stamped as the array, and holds no service of its own", () => {
    expect(exports.length).toBeGreaterThan(5);
    for (const one of exports) {
      expect(one.resource).toMatchObject({
        "storage.array.name": "ps-prod-01",
        "storage.system": StorageSystem.DellPowerStore,
        "oneuptime.agent.version": "0.165.0",
      });
      expect(one.resource).not.toHaveProperty("service.name");
      expect(one.resource).not.toHaveProperty("service.instance.id");
    }
  });

  test("each export, ingested as it came, lists only the kinds its scrape completes", () => {
    let sawRows: number = 0;
    for (const one of exports) {
      const resourceBuffer: Map<
        string,
        Map<string, StorageArrayResourceBufferEntry>
      > = new Map();
      const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> =
        new Map();
      const read: Set<string> = new Set();
      const endpoints: Set<string> = new Set();
      for (const { metricName, datapoint } of one.datapoints) {
        if (!STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(metricName)) {
          continue;
        }
        read.add(metricName);
        for (const attribute of (datapoint["attributes"] || []) as JSONArray) {
          const a: JSONObject = attribute as JSONObject;
          if (a["key"] === "scrape_endpoint") {
            endpoints.add((a["value"] as JSONObject)["stringValue"] as string);
          }
        }
        bufferStorageArraySnapshotMetric({
          arrayIdStr: ARRAY_ID,
          metricName,
          datapoint,
          resourceBuffer,
          arrayBuffer,
          declaredStorageSystem: one.resource["storage.system"],
        });
      }
      const outcome: Outcome = flush(resourceBuffer, arrayBuffer, read);
      sawRows += outcome.rows.length;
      const listed: Set<string> = new Set(
        Array.from(endpoints).flatMap((endpoint: string) => {
          return [...(DellPowerStorePlatform.scrapeEndpoints[endpoint] || [])];
        }),
      );
      for (const kind of Object.keys(outcome.counts || {})) {
        expect(listed.has(kind)).toBe(true);
        // A recorded scrape lists the whole cluster.
        expect({ kind, count: outcome.counts![kind] }).toEqual({
          kind,
          count: WHOLE.counts![kind],
        });
      }
    }
    expect(sawRows).toBeGreaterThan(0);
  });

  test("the percents the collector derived are left to the charts", () => {
    for (const name of [
      "powerstore_cap_physical_used_percent",
      "powerstore_filesystem_logical_used_percent",
    ]) {
      expect(STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has(name)).toBe(false);
      expect(
        exports.some((one: Export): boolean => {
          return one.datapoints.some(
            (point: { metricName: string }): boolean => {
              return point.metricName === name;
            },
          );
        }),
      ).toBe(true);
    }
  });
});
