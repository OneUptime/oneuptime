import { describe, expect, test } from "@jest/globals";
import {
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  StorageArrayHealthStatus,
  StorageArraySnapshotDerivedExtras,
  bufferStorageArraySnapshotMetric,
  deriveStorageArrayCountsByKind,
  deriveStorageArraySnapshotExtras,
  getStorageArrayResourceRows,
  isCriticalComponentStatus,
  isStorageArraySnapshotMetric,
  isUnhealthyComponentStatus,
  resolveStorageArraySystem,
} from "../../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import {
  getQuotaStatus,
  parseNodeList,
} from "../../../../../Server/Utils/Telemetry/StorageArray/Dell/PowerScaleExtractor";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../../Types/StorageArray/StorageSystem";
import DellPowerScalePlatform, {
  POWERSCALE_NODE_KIND,
  POWERSCALE_QUOTA_KIND,
} from "../../../../../Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform";
import {
  POWERSCALE_CAPTURE_TIME_MS,
  POWERSCALE_CLUSTER_NAME,
  PowerScaleCapturedPoint,
  filterPowerScaleCapture,
  getPowerScaleCapturedPoints,
  readPowerScaleCapture,
} from "../../../../Helpers/StorageArray/PowerScale/PowerScaleCapture";

/*
 * WHAT A POWERSCALE CLUSTER'S SNMP POLLS BECOME (#11003).
 *
 * The recorded capture (Helpers/StorageArray/PowerScale: what the agent's
 * own collector config sends, on the collector it pins, for the simulated
 * four-node cluster ps-prod) goes through the scan exactly as
 * OtelMetricsIngestService runs it: the snapshot metric names first, then
 * bufferStorageArraySnapshotMetric per datapoint with the batch's declared
 * storage.system, then what its flush hands to Postgres - the inventory rows,
 * the array's columns and each kind's count. As one batch, and as each
 * receiver's poll alone, as the collector may export them.
 *
 * The cluster: OneFS 9.11, health "attention", four configured nodes of
 * which node 3 is offline; 560 TiB with 72% no longer available; seven
 * quotas. Node 2 needs attention with bay 3 smartfailing; node 4 has an empty
 * bay 10.
 */

const ARRAY_ID: string = "5a7e0000-0000-4000-8000-00000000ps00";
const MiB: number = 1024 * 1024;
const GiB: number = 1024 * MiB;
const TiB: number = 1024 * GiB;

interface Scan {
  rows: Array<StorageArrayResourceBufferEntry>;
  snapshot: StorageArraySnapshotBufferEntry | undefined;
  extras: StorageArraySnapshotDerivedExtras;
  counts: Record<string, number> | null;
}

// A capture through the scan, as the ingest runs it.
function scan(
  capture: JSONObject = readPowerScaleCapture(),
  declared?: string | null,
): Scan {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  for (const point of getPowerScaleCapturedPoints(capture)) {
    if (!isStorageArraySnapshotMetric(point.metricName)) {
      continue;
    }
    bufferStorageArraySnapshotMetric({
      arrayIdStr: ARRAY_ID,
      metricName: point.metricName,
      datapoint: point.datapoint,
      resourceBuffer,
      arrayBuffer,
      declaredStorageSystem:
        declared === undefined
          ? point.resourceAttributes["storage.system"]
          : declared,
    });
  }
  const snapshot: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(ARRAY_ID);
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(
      Array.from(resourceBuffer.get(ARRAY_ID)?.values() || []),
      snapshot,
    );
  return {
    rows,
    snapshot,
    extras: deriveStorageArraySnapshotExtras(rows, snapshot),
    counts: deriveStorageArrayCountsByKind(rows, snapshot),
  };
}

function rowsOf(
  result: Scan,
  kind: string,
): Array<StorageArrayResourceBufferEntry> {
  return result.rows.filter((row: StorageArrayResourceBufferEntry) => {
    return row.kind === kind;
  });
}

function rowNamed(
  result: Scan,
  kind: string,
  externalId: string,
): StorageArrayResourceBufferEntry {
  const row: StorageArrayResourceBufferEntry | undefined = result.rows.find(
    (candidate: StorageArrayResourceBufferEntry) => {
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

// One receiver's poll alone: the series whose labels say they are its.
function onlyCluster(): JSONObject {
  return filterPowerScaleCapture(
    (_metricName: string, labels: Record<string, string>): boolean => {
      return labels["cluster"] !== undefined && !labels["node"];
    },
  );
}

function onlyQuotas(): JSONObject {
  return filterPowerScaleCapture((metricName: string): boolean => {
    return metricName.startsWith("powerscale_quota_");
  });
}

function onlyNode(node: string): JSONObject {
  return filterPowerScaleCapture(
    (_metricName: string, labels: Record<string, string>): boolean => {
      return labels["node"] === node;
    },
  );
}

const WHOLE: Scan = scan();

describe("the recorded capture through the scan, as one batch", () => {
  test("is read as Dell PowerScale, the cluster's own name, GUID and OneFS version", () => {
    expect(WHOLE.snapshot?.storageSystem).toBe(StorageSystem.DellPowerScale);
    expect(WHOLE.extras).toMatchObject({
      storageSystem: "dell.powerscale",
      reportedName: POWERSCALE_CLUSTER_NAME,
      systemId: "0007430b7a2a6c0a8c5d1a0e9a5b5b6c7f8e",
      osName: "OneFS",
      osVersion: "9.11.0.0",
    });
  });

  test("takes /ifs's total as its capacity and what is no longer available as used", () => {
    const total: number = 615553001652224;
    const available: number = 172354840462622;
    expect(WHOLE.extras.capacityBytes).toBe(Math.round(total / MiB) * MiB);
    expect(WHOLE.extras.usedBytes).toBe(
      Math.round((total - available) / MiB) * MiB,
    );
    // As the collector worked it out: (total - available) / total.
    expect(WHOLE.extras.capacityUsedPercent).toBe(72);
    expect(WHOLE.extras.dataReductionRatio).toBeUndefined();
  });

  test("counts OneFS's health as one open warning while the cluster needs attention", () => {
    expect(WHOLE.extras).toMatchObject({
      openAlertCount: 1,
      warningAlertCount: 1,
      criticalAlertCount: 0,
    });
  });

  test("is Critical: a node is offline", () => {
    expect(WHOLE.extras.healthStatus).toBe(StorageArrayHealthStatus.Critical);
  });

  test("lists every configured node and every quota in full, and counts them", () => {
    expect(WHOLE.counts).toEqual({
      [POWERSCALE_NODE_KIND]: 4,
      [POWERSCALE_QUOTA_KIND]: 7,
    });
    // No shared kind's column is written: a PowerScale has no volumes.
    expect(WHOLE.extras.volumeCount).toBeUndefined();
    expect(WHOLE.extras.fileSystemCount).toBeUndefined();
  });

  test("has a row for each node, each drive bay, sensor and port of the nodes that answered", () => {
    expect(rowsOf(WHOLE, POWERSCALE_NODE_KIND)).toHaveLength(4);
    expect(rowsOf(WHOLE, POWERSCALE_QUOTA_KIND)).toHaveLength(7);
    // Three nodes answered, ten bays each.
    expect(rowsOf(WHOLE, StorageArrayResourceKind.Drive)).toHaveLength(30);
    /*
     * Four fans, four readable temperature sensors (a fifth reads N/A) and
     * four power sensors per node.
     */
    expect(rowsOf(WHOLE, StorageArrayResourceKind.Hardware)).toHaveLength(36);
    // Four ports per node; the loopback is no port.
    expect(
      rowsOf(WHOLE, StorageArrayResourceKind.NetworkInterface),
    ).toHaveLength(12);
    expect(WHOLE.rows).toHaveLength(4 + 7 + 30 + 36 + 12);
  });
});

describe("its nodes", () => {
  test("each named by its host name, <cluster>-<LNN>, with its logical node number", () => {
    expect(
      rowsOf(WHOLE, POWERSCALE_NODE_KIND)
        .map((row: StorageArrayResourceBufferEntry) => {
          return [row.externalId, row.name, row.details["lnn"]];
        })
        .sort(),
    ).toEqual([
      ["ps-prod-1", "ps-prod-1", 1],
      ["ps-prod-2", "ps-prod-2", 2],
      ["ps-prod-3", "ps-prod-3", 3],
      ["ps-prod-4", "ps-prod-4", 4],
    ]);
  });

  test("carry the health each reports, and offline for the one the cluster lists as offline", () => {
    const statuses: Record<string, string | null> = {};
    for (const row of rowsOf(WHOLE, POWERSCALE_NODE_KIND)) {
      statuses[row.externalId] = row.status;
    }
    expect(statuses).toEqual({
      "ps-prod-1": "healthy",
      "ps-prod-2": "attention",
      "ps-prod-3": "offline",
      "ps-prod-4": "healthy",
    });
  });

  test("a node that answered has its chassis, OneFS version, type, CPU and /ifs throughput", () => {
    const node: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_NODE_KIND,
      "ps-prod-1",
    );
    expect(node).toMatchObject({
      componentType: "storage",
      model: "F710-1U-Dual-512GB-2x1GE-2x100GE QSFP+-300TB SSD",
      firmwareVersion: "9.11.0.0",
      // Bits per second as OneFS reports them, made bytes by the collector.
      readBytesPerSec: 1300000000 / 8,
      writeBytesPerSec: 420000000 / 8,
    });
    expect(node.details).toMatchObject({
      lnn: 1,
      serialNumber: "JWXCK1000001",
      configurationNumber: "400-0118-01",
      serviceLightOn: false,
      readOnly: false,
      // Idle 690 per mil.
      cpuBusyPercent: 31,
    });
  });

  test("a node that answered carries its load per protocol", () => {
    const node: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_NODE_KIND,
      "ps-prod-2",
    );
    expect(node.details).toMatchObject({
      "operationsPerSecond.nfs3": 4780,
      "operationsPerSecond.smb2": 2210,
      "operationsPerSecond.hdfs": 0,
      "latencyUsec.nfs3": 880,
      "latencyUsec.smb2": 24800,
    });
  });

  test("the offline node is only its name, number and status", () => {
    const node: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_NODE_KIND,
      "ps-prod-3",
    );
    expect(node).toMatchObject({
      status: "offline",
      model: null,
      firmwareVersion: null,
      readBytesPerSec: null,
    });
    expect(node.details).toEqual({ lnn: 3 });
  });

  test("offline and down are critical, attention a warning, healthy neither", () => {
    const system: string = StorageSystem.DellPowerScale;
    expect(isCriticalComponentStatus("offline", system)).toBe(true);
    expect(isCriticalComponentStatus("down", system)).toBe(true);
    expect(isUnhealthyComponentStatus("attention", system)).toBe(true);
    expect(isCriticalComponentStatus("attention", system)).toBe(false);
    expect(isUnhealthyComponentStatus("healthy", system)).toBe(false);
  });
});

describe("its quotas", () => {
  test("each named by its path, and by whose quota it is for a user's or a group's", () => {
    expect(
      rowsOf(WHOLE, POWERSCALE_QUOTA_KIND)
        .map(
          (
            row: StorageArrayResourceBufferEntry,
          ): [string, string | null, string | null] => {
            return [row.externalId, row.componentType, row.groupName];
          },
        )
        .sort(
          (
            a: [string, string | null, string | null],
            b: [string, string | null, string | null],
          ): number => {
            return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
          },
        ),
    ).toEqual([
      ["/ifs/data/home", "directory", "/ifs/data/home"],
      ["/ifs/data/home (default user)", "default-user", "/ifs/data/home"],
      ["/ifs/data/home (user 2001)", "user", "/ifs/data/home"],
      ["/ifs/data/pacs", "directory", "/ifs/data/pacs"],
      ["/ifs/data/projects", "directory", "/ifs/data/projects"],
      ["/ifs/data/projects (group 3000)", "group", "/ifs/data/projects"],
      ["/ifs/data/scratch", "directory", "/ifs/data/scratch"],
    ]);
  });

  test("a quota's size is the limit that stops writes: the hard one, else the soft one", () => {
    const sizes: Record<string, number | null> = {};
    for (const row of rowsOf(WHOLE, POWERSCALE_QUOTA_KIND)) {
      sizes[row.externalId] = row.capacityBytes;
    }
    expect(sizes).toEqual({
      "/ifs/data/home": 10 * TiB,
      "/ifs/data/home (default user)": TiB,
      "/ifs/data/home (user 2001)": 500 * GiB,
      // Checkmk's recorded row: a soft limit of 200 TiB and no hard limit.
      "/ifs/data/pacs": 219902325555200,
      "/ifs/data/projects": 50 * TiB,
      "/ifs/data/projects (group 3000)": 20 * TiB,
      // Accounting only: no limit at all.
      "/ifs/data/scratch": null,
    });
  });

  test("where each stands against its limits", () => {
    const statuses: Record<string, string | null> = {};
    for (const row of rowsOf(WHOLE, POWERSCALE_QUOTA_KIND)) {
      statuses[row.externalId] = row.status;
    }
    expect(statuses).toEqual({
      // 9.6 TiB: past its 9 TiB soft limit, short of its 10 TiB hard limit.
      "/ifs/data/home": "over_soft_limit",
      "/ifs/data/home (default user)": "ok",
      // 498 of 500 GiB: near, but not at, its hard limit.
      "/ifs/data/home (user 2001)": "ok",
      "/ifs/data/pacs": "ok",
      "/ifs/data/projects": "ok",
      "/ifs/data/projects (group 3000)": "ok",
      "/ifs/data/scratch": "ok",
    });
  });

  test("its usage, limits, share of its limit and the rest, as the agent read them", () => {
    const home: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_QUOTA_KIND,
      "/ifs/data/home",
    );
    expect(home.usedBytes).toBe(Math.trunc(9.6 * TiB));
    expect(home.details).toMatchObject({
      path: "/ifs/data/home",
      hardLimitBytes: 10 * TiB,
      softLimitBytes: 9 * TiB,
      advisoryLimitBytes: 8 * TiB,
      gracePeriodSeconds: 604800,
      includesSnapshots: false,
      includesOverhead: false,
      usedPercent: 96,
      limit: "hard",
      inodes: 48210334,
      physicalBytes: Math.trunc(11.9 * TiB),
    });

    const user: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_QUOTA_KIND,
      "/ifs/data/home (user 2001)",
    );
    expect(user.details).toMatchObject({ ownerId: 2001, usedPercent: 99.6 });

    const pacs: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_QUOTA_KIND,
      "/ifs/data/pacs",
    );
    expect(pacs.details).toMatchObject({
      hardLimitBytes: null,
      softLimitBytes: 219902325555200,
      limit: "soft",
      usedPercent: 1.75,
    });

    // A quota with no limit has no share of one.
    const scratch: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      POWERSCALE_QUOTA_KIND,
      "/ifs/data/scratch",
    );
    expect(scratch.details["usedPercent"]).toBeUndefined();
    expect(scratch.details["hardLimitBytes"]).toBeNull();
  });
});

describe("its drives", () => {
  test("one per bay of every node that answered, named <node> bay <n>", () => {
    const names: Array<string> = rowsOf(WHOLE, StorageArrayResourceKind.Drive)
      .map((row: StorageArrayResourceBufferEntry) => {
        return row.externalId;
      })
      .sort();
    expect(names).toContain("ps-prod-1 bay 1");
    expect(names).toContain("ps-prod-4 bay 10");
    expect(
      names.some((name: string) => {
        return name.startsWith("ps-prod-3");
      }),
    ).toBe(false);
  });

  test("with the status OneFS reports, lowercased", () => {
    const statuses: Record<string, number> = {};
    for (const row of rowsOf(WHOLE, StorageArrayResourceKind.Drive)) {
      statuses[row.status || "-"] = (statuses[row.status || "-"] || 0) + 1;
    }
    expect(statuses).toEqual({ healthy: 28, smartfail: 1, empty: 1 });
    expect(
      rowNamed(WHOLE, StorageArrayResourceKind.Drive, "ps-prod-2 bay 3").status,
    ).toBe("smartfail");
    expect(
      rowNamed(WHOLE, StorageArrayResourceKind.Drive, "ps-prod-4 bay 10")
        .status,
    ).toBe("empty");
  });

  test("a drive's size, model, firmware, serial, device and node", () => {
    const drive: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.Drive,
      "ps-prod-1 bay 4",
    );
    expect(drive).toMatchObject({
      name: "ps-prod-1 bay 4",
      groupName: "ps-prod-1",
      capacityBytes: 30720000000000,
      model: "KIOXIA KCM6XRUL30T7",
      firmwareVersion: "0109",
    });
    expect(drive.details).toMatchObject({
      node: "ps-prod-1",
      bay: 4,
      serialNumber: "X0Q0A0104TJ7",
      device: "/dev/nvd3",
      protocol: "NVMe",
      operationsPerSecond: 1840 + 4 * 13,
    });
  });

  test("an empty bay has no drive's identity", () => {
    const bay: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.Drive,
      "ps-prod-4 bay 10",
    );
    expect(bay).toMatchObject({
      capacityBytes: 0,
      model: null,
      firmwareVersion: null,
    });
    expect(bay.details["serialNumber"]).toBeUndefined();
    expect(bay.details["protocol"]).toBeUndefined();
  });

  test("a smartfailing drive is a warning, a dead or stalled one critical", () => {
    const system: string = StorageSystem.DellPowerScale;
    expect(isUnhealthyComponentStatus("smartfail", system)).toBe(true);
    expect(isCriticalComponentStatus("smartfail", system)).toBe(false);
    expect(isCriticalComponentStatus("dead", system)).toBe(true);
    expect(isCriticalComponentStatus("stalled", system)).toBe(true);
    for (const fine of ["healthy", "l3", "empty", "new", "preparing"]) {
      expect({
        fine,
        unhealthy: isUnhealthyComponentStatus(fine, system),
      }).toEqual({ fine, unhealthy: false });
    }
  });
});

describe("its sensors and ports", () => {
  test("temperature sensors carry their reading in degrees, named by the node and the sensor", () => {
    const sensor: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.Hardware,
      "ps-prod-2/temperature/TEMP_CPU1",
    );
    expect(sensor).toMatchObject({
      name: "ps-prod-2 Temp CPU 1",
      componentType: "temperature sensor",
      temperatureCelsius: 52,
      groupName: "ps-prod-2",
    });
  });

  test("a sensor that reads N/A is not in the inventory", () => {
    expect(
      WHOLE.rows.some((row: StorageArrayResourceBufferEntry) => {
        return row.externalId.endsWith("/temperature/TEMP_PS2");
      }),
    ).toBe(false);
  });

  test("fans carry their speed, power sensors their volts or amps", () => {
    expect(
      rowNamed(WHOLE, StorageArrayResourceKind.Hardware, "ps-prod-1/fan/FAN1")
        .details,
    ).toMatchObject({ rpm: 9130, sensor: "FAN1", node: "ps-prod-1" });
    const volts: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.Hardware,
      "ps-prod-1/power/PS1_VIN",
    );
    expect(volts.componentType).toBe("voltage sensor");
    expect(volts.details).toMatchObject({ reading: 230, unit: "V" });
    const amps: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.Hardware,
      "ps-prod-1/power/PS1_IOUT",
    );
    expect(amps.componentType).toBe("current sensor");
    expect(amps.details).toMatchObject({ reading: 11.5, unit: "A" });
  });

  test("ports carry their state and speed; one with no link is down", () => {
    const up: StorageArrayResourceBufferEntry = rowNamed(
      WHOLE,
      StorageArrayResourceKind.NetworkInterface,
      "ps-prod-1/mce0",
    );
    expect(up).toMatchObject({
      name: "ps-prod-1 mce0",
      status: "up",
      componentType: "ethernet",
    });
    // 100 GbE, in bytes per second.
    expect(up.details["speedBytesPerSec"]).toBe(12500000000);
    expect(
      rowNamed(
        WHOLE,
        StorageArrayResourceKind.NetworkInterface,
        "ps-prod-4/mce1",
      ).status,
    ).toBe("down");
  });
});

describe("each receiver's poll alone, as the collector may export them", () => {
  test("the cluster's poll: every configured node, the offline one offline, and the cluster's health", () => {
    const result: Scan = scan(onlyCluster());
    expect(result.counts).toEqual({ [POWERSCALE_NODE_KIND]: 4 });
    expect(result.extras.healthStatus).toBe(StorageArrayHealthStatus.Critical);
    expect(result.extras.openAlertCount).toBe(1);
    expect(result.extras.capacityUsedPercent).toBe(72);
    const statuses: Array<string | null> = rowsOf(result, POWERSCALE_NODE_KIND)
      .sort(
        (
          a: StorageArrayResourceBufferEntry,
          b: StorageArrayResourceBufferEntry,
        ) => {
          return a.externalId.localeCompare(b.externalId);
        },
      )
      .map((row: StorageArrayResourceBufferEntry) => {
        return row.status;
      });
    // An online node's health is its own poll's to say.
    expect(statuses).toEqual([null, null, "offline", null]);
    expect(result.rows).toHaveLength(4);
  });

  test("the quotas' poll: every quota, counted, and nothing about the cluster's health", () => {
    const result: Scan = scan(onlyQuotas());
    expect(result.counts).toEqual({ [POWERSCALE_QUOTA_KIND]: 7 });
    expect(result.extras.healthStatus).toBeUndefined();
    expect(result.extras.openAlertCount).toBeUndefined();
    expect(result.rows).toHaveLength(7);
  });

  test("a node's poll: its own row, drives, sensors and ports, and no count or health", () => {
    const result: Scan = scan(onlyNode("ps-prod-2"));
    expect(result.counts).toBeNull();
    expect(result.extras.healthStatus).toBeUndefined();
    expect(rowsOf(result, POWERSCALE_NODE_KIND)).toHaveLength(1);
    expect(rowsOf(result, StorageArrayResourceKind.Drive)).toHaveLength(10);
    expect(rowsOf(result, StorageArrayResourceKind.Hardware)).toHaveLength(12);
    expect(
      rowsOf(result, StorageArrayResourceKind.NetworkInterface),
    ).toHaveLength(4);
    expect(rowNamed(result, POWERSCALE_NODE_KIND, "ps-prod-2").status).toBe(
      "attention",
    );
  });

  test("the polls in any order fold to the same inventory as the whole", () => {
    // The nodes' polls first, the cluster's last: the reverse of the capture.
    const reordered: JSONObject = {
      resourceMetrics: [
        onlyNode("ps-prod-4"),
        onlyNode("ps-prod-2"),
        onlyNode("ps-prod-1"),
        onlyQuotas(),
        onlyCluster(),
      ].flatMap((part: JSONObject): JSONArray => {
        return part["resourceMetrics"] as JSONArray;
      }),
    };
    expect(getPowerScaleCapturedPoints(reordered).length).toBe(
      getPowerScaleCapturedPoints().length,
    );
    const result: Scan = scan(reordered);
    const summary: (
      rows: Array<StorageArrayResourceBufferEntry>,
    ) => Array<[string, string, string | null]> = (
      rows: Array<StorageArrayResourceBufferEntry>,
    ) => {
      return rows
        .map(
          (
            row: StorageArrayResourceBufferEntry,
          ): [string, string, string | null] => {
            return [row.kind, row.externalId, row.status];
          },
        )
        .sort();
    };
    expect(summary(result.rows)).toEqual(summary(WHOLE.rows));
    expect(result.counts).toEqual(WHOLE.counts);
    expect(result.extras).toEqual(WHOLE.extras);
  });
});

describe("which platform reads it", () => {
  test("PowerScale's, whatever the agent declares", () => {
    for (const declared of [
      "dell.powerscale",
      "isilon",
      "ONEFS",
      null,
      "",
      // An agent whose .env names no platform declares the compose default.
      "purestorage.flasharray",
      "netapp.ontap",
    ]) {
      const result: Scan = scan(readPowerScaleCapture(), declared);
      expect({ declared, system: result.snapshot?.storageSystem }).toEqual({
        declared,
        system: StorageSystem.DellPowerScale,
      });
      expect(result.counts).toEqual({ Node: 4, Quota: 7 });
    }
    expect(
      resolveStorageArraySystem({
        derived: StorageSystem.DellPowerScale,
        declared: StorageSystem.PureStorageFlashArray,
      }),
    ).toBe(StorageSystem.DellPowerScale);
  });

  test("the ingest takes exactly the series the platform reads", () => {
    const sent: Set<string> = new Set(
      getPowerScaleCapturedPoints().map((point: PowerScaleCapturedPoint) => {
        return point.metricName;
      }),
    );
    for (const name of DellPowerScalePlatform.snapshotMetricNames) {
      // Every series the scan reads is in the capture.
      expect({ name, sent: sent.has(name) }).toEqual({ name, sent: true });
      expect(isStorageArraySnapshotMetric(name)).toBe(true);
    }
    // The rest stay in ClickHouse alone, for the charts.
    const chartsOnly: Array<string> = Array.from(sent).filter(
      (name: string) => {
        return !isStorageArraySnapshotMetric(name);
      },
    );
    expect(chartsOnly.sort()).toEqual([
      "powerscale_cluster_cpu_busy_percent",
      "powerscale_cluster_ifs_read_bytes_per_second",
      "powerscale_cluster_ifs_write_bytes_per_second",
      "powerscale_cluster_network_in_bytes_per_second",
      "powerscale_cluster_network_out_bytes_per_second",
      "powerscale_cluster_nodes",
      "powerscale_cluster_offline_nodes",
      "powerscale_drive_in_bytes_per_second",
      "powerscale_drive_out_bytes_per_second",
      "powerscale_ifs_free_bytes",
      "powerscale_ifs_used_bytes",
      "powerscale_node_network_in_bytes_per_second",
      "powerscale_node_network_out_bytes_per_second",
      "powerscale_protocol_in_bytes_per_second",
      "powerscale_protocol_latency_max_microseconds",
      "powerscale_protocol_out_bytes_per_second",
    ]);
  });
});

/*
 * Series by series: the cases the recorded cluster does not hold, fed as
 * the collector would send them.
 */
interface Feed {
  rows: () => Array<StorageArrayResourceBufferEntry>;
  snapshot: () => StorageArraySnapshotBufferEntry;
  feed: (
    metricName: string,
    labels: Record<string, string>,
    value: number,
  ) => void;
}

function newFeed(): Feed {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  return {
    rows: (): Array<StorageArrayResourceBufferEntry> => {
      return Array.from(resourceBuffer.get(ARRAY_ID)?.values() || []);
    },
    snapshot: (): StorageArraySnapshotBufferEntry => {
      return arrayBuffer.get(ARRAY_ID)!;
    },
    feed: (
      metricName: string,
      labels: Record<string, string>,
      value: number,
    ): void => {
      const attributes: JSONArray = Object.entries(labels).map(
        ([key, labelValue]: [string, string]): JSONObject => {
          return { key, value: { stringValue: labelValue } };
        },
      );
      bufferStorageArraySnapshotMetric({
        arrayIdStr: ARRAY_ID,
        metricName,
        datapoint: {
          asInt: String(value),
          timeUnixNano: `${POWERSCALE_CAPTURE_TIME_MS}000000`,
          attributes,
        },
        resourceBuffer,
        arrayBuffer,
        declaredStorageSystem: StorageSystem.DellPowerScale,
      });
    },
  };
}

const CLUSTER_LABELS: Record<string, string> = {
  cluster: "lab",
  cluster_guid: "00aa",
  configured_nodes: "1,2,3",
  online_nodes: "1,2,3",
  offline_nodes: "",
  system_description: "lab-1 1 Isilon OneFS v9.10.1.2",
  scrape_endpoint: "cluster",
};

describe("series by series", () => {
  test("a cluster that is down is one critical alert; invalid is a warning; OK none", () => {
    for (const [health, critical, warning] of [
      [0, 0, 0],
      [1, 0, 1],
      [2, 1, 0],
      [3, 0, 1],
    ] as Array<[number, number, number]>) {
      const f: Feed = newFeed();
      f.feed("powerscale_cluster_health", CLUSTER_LABELS, health);
      expect({
        health,
        critical: f.snapshot().criticalAlertKeys.size,
        warning: f.snapshot().warningAlertKeys.size,
        open: f.snapshot().openAlertKeys.size,
      }).toEqual({ health, critical, warning, open: critical + warning });
    }
  });

  test("a cluster with every node online lists them with no status, and reads its version", () => {
    const f: Feed = newFeed();
    f.feed("powerscale_cluster_health", CLUSTER_LABELS, 0);
    expect(
      f.rows().map((row: StorageArrayResourceBufferEntry) => {
        return [row.externalId, row.status];
      }),
    ).toEqual([
      ["lab-1", null],
      ["lab-2", null],
      ["lab-3", null],
    ]);
    expect(f.snapshot().osVersion).toBe("9.10.1.2");
    expect(f.snapshot().completeKinds.has(POWERSCALE_NODE_KIND)).toBe(true);
  });

  test("a cluster that names no node lists none and completes no list", () => {
    const f: Feed = newFeed();
    f.feed(
      "powerscale_cluster_health",
      { ...CLUSTER_LABELS, configured_nodes: "", online_nodes: "" },
      0,
    );
    expect(f.rows()).toHaveLength(0);
    expect(f.snapshot().completeKinds.has(POWERSCALE_NODE_KIND)).toBe(false);
    expect(f.snapshot().sawAlerts).toBe(true);
  });

  test("a node's health beyond OneFS's four codes is unknown, and a renamed node keeps its own name", () => {
    const f: Feed = newFeed();
    f.feed("powerscale_node_health", { node: "filer-a" }, 9);
    const row: StorageArrayResourceBufferEntry = f.rows()[0]!;
    expect(row).toMatchObject({ externalId: "filer-a", status: "unknown" });
    // No -<number> at the end of its name: no logical node number either.
    expect(row.details["lnn"]).toBeUndefined();
  });

  test("an accelerator node, a read-only one, one with no service light", () => {
    const f: Feed = newFeed();
    f.feed("powerscale_node_type", { node: "lab-2" }, 1);
    f.feed("powerscale_node_read_only", { node: "lab-2" }, 1);
    f.feed(
      "powerscale_chassis_service_light",
      { node: "lab-2", chassis_model: "A300", chassis_serial: "S1" },
      -1,
    );
    const row: StorageArrayResourceBufferEntry = f.rows()[0]!;
    expect(row.componentType).toBe("accelerator");
    expect(row.model).toBe("A300");
    expect(row.details).toMatchObject({ readOnly: true, serialNumber: "S1" });
    expect(row.details["serviceLightOn"]).toBeUndefined();
  });

  test("a quota without the collector's name is named the same way from its labels", () => {
    const f: Feed = newFeed();
    f.feed(
      "powerscale_quota_usage_bytes",
      {
        path: "/ifs/a",
        type: "1",
        id: "42",
        hard_defined: "1",
        hard_limit: "100",
      },
      100,
    );
    f.feed(
      "powerscale_quota_usage_bytes",
      { path: "/ifs/b", type: "3", id: "7" },
      1,
    );
    f.feed("powerscale_quota_usage_bytes", { path: "/ifs/c", type: "2" }, 1);
    f.feed("powerscale_quota_usage_bytes", { path: "/ifs/d" }, 1);
    // No path: no quota to name.
    f.feed("powerscale_quota_usage_bytes", { type: "4" }, 1);
    expect(
      f
        .rows()
        .map((row: StorageArrayResourceBufferEntry) => {
          return [row.externalId, row.status];
        })
        .sort(),
    ).toEqual([
      ["/ifs/a (user 42)", "full"],
      ["/ifs/b (group 7)", "ok"],
      ["/ifs/c (default group)", "ok"],
      ["/ifs/d", "ok"],
    ]);
    expect(f.snapshot().completeKinds.has(POWERSCALE_QUOTA_KIND)).toBe(true);
  });

  test("a limit OneFS says is not defined is no limit, whatever its value reads", () => {
    const f: Feed = newFeed();
    f.feed(
      "powerscale_quota_usage_bytes",
      {
        path: "/ifs/e",
        type: "4",
        quota: "/ifs/e",
        hard_defined: "0",
        hard_limit: "10",
        soft_defined: "0",
        soft_limit: "10",
      },
      50,
    );
    const row: StorageArrayResourceBufferEntry = f.rows()[0]!;
    expect(row.capacityBytes).toBeNull();
    expect(row.status).toBe("ok");
    expect(row.details["hardLimitBytes"]).toBeNull();
  });

  test("a drive without the collector's name is named by its node and bay; an unnamed one is skipped", () => {
    const f: Feed = newFeed();
    f.feed(
      "powerscale_drive_size_bytes",
      { node: "lab-1", bay: "7", status: "DEAD", device: "/dev/da6" },
      0,
    );
    f.feed("powerscale_drive_size_bytes", { node: "lab-1" }, 1);
    const rows: Array<StorageArrayResourceBufferEntry> = f.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      externalId: "lab-1 bay 7",
      status: "dead",
    });
    // A SAS or SATA drive (da<n>) is not said to be NVMe.
    expect(rows[0]!.details["protocol"]).toBeUndefined();
  });

  test("a port an administrator turned off is disabled, not down", () => {
    const f: Feed = newFeed();
    f.feed(
      "powerscale_interface_status",
      {
        node: "lab-1",
        interface: "bge1",
        admin_status: "2",
        interface_type: "6",
        speed_mbps: "0",
      },
      2,
    );
    const row: StorageArrayResourceBufferEntry = f.rows()[0]!;
    expect(row.status).toBe("disabled");
    // No speed for a port without a link.
    expect(row.details["speedBytesPerSec"]).toBeUndefined();
  });

  test("a node's series without its node label, and a series the platform does not read, are left alone", () => {
    const f: Feed = newFeed();
    f.feed("powerscale_node_health", {}, 0);
    f.feed("powerscale_temperature_celsius", { sensor: "T1" }, 40);
    f.feed("powerscale_drive_size_bytes", { bay: "1" }, 1);
    expect(f.rows()).toHaveLength(0);
  });
});

describe("the extractor's helpers", () => {
  test.each([
    ["1,2,4", [1, 2, 4]],
    ["1, 2 ,4", [1, 2, 4]],
    ["3", [3]],
    ["", []],
    [",,", []],
    ["1,x,2,1,-3, 05", [1, 2, 5]],
  ])("parseNodeList(%p)", (value: string, expected: Array<number>) => {
    expect(parseNodeList(value)).toEqual(expected);
  });

  test("parseNodeList(null)", () => {
    expect(parseNodeList(null)).toEqual([]);
  });

  test.each([
    [100, 100, null, null, "full"],
    [101, 100, 200, 50, "full"],
    [99, 100, null, null, "ok"],
    [91, 100, 90, null, "over_soft_limit"],
    [90, 100, 90, null, "ok"],
    [81, 100, 90, 80, "over_advisory_limit"],
    [80, 100, 90, 80, "ok"],
    [5, null, null, null, "ok"],
    [5, null, 4, null, "over_soft_limit"],
    [5, 0, 0, 0, "ok"],
  ])(
    "a quota using %p against hard %p, soft %p, advisory %p is %p",
    (
      usageBytes: number,
      hardLimitBytes: number | null,
      softLimitBytes: number | null,
      advisoryLimitBytes: number | null,
      expected: string,
    ) => {
      expect(
        getQuotaStatus({
          usageBytes,
          hardLimitBytes,
          softLimitBytes,
          advisoryLimitBytes,
        }),
      ).toBe(expected);
    },
  );
});
