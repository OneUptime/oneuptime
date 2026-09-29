import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MAX_DESCRIPTION_LENGTH,
  expectReadableDescriptionRecord,
  expectReadableMetricDescription,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import {
  PROXMOX_METRIC_DESCRIPTIONS,
  ProxmoxMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";
import { AggregationIntervalUtil } from "../../../Types/BaseDatabase/AggregationIntervalUtil";

/*
 * The words behind every (i) on the Proxmox pages. The shared rules make
 * each one a short, finished sentence; the anchors below make each one say
 * what the page actually computes - the window it averages, the snapshot it
 * reads, the denominator of its percentage - and they read the constants
 * those claims depend on out of the page sources, so a change to the code
 * that makes a sentence untrue fails here.
 */

const D: Record<ProxmoxMetric, string> = PROXMOX_METRIC_DESCRIPTIONS;

const PROXMOX_PAGES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Proxmox",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(PROXMOX_PAGES, relativePath), "utf8");
}

const OVERVIEW_SOURCE: string = readPage("View/Index.tsx");
const UTILS_SOURCE: string = readPage("Utils/ProxmoxResourceUtils.ts");
const STORAGE_DETAIL_SOURCE: string = readPage("View/StorageDetail.tsx");

/*
 * Each (i) as the page labels it, so a title that names a percentile is
 * held to explaining it (none do today; the check keeps it that way).
 */
const TITLES: Record<ProxmoxMetric, string> = {
  nodeAvailability: "Node Availability",
  clusterCpu: "CPU",
  clusterMemory: "Memory",
  fullestStorage: "Storage",
  guestsRunning: "Guests",
  backupCoverage: "Backup Coverage",
  cpuChart: "CPU",
  memoryChart: "Memory",
  storageChart: "Storage",
  networkChart: "Network",
  clusterInventoryCounts: "Cluster inventory counts",
  haStates: "High-availability states",
  clusterHealth: "Cluster Health",
  quorum: "Quorum",
  nodeCount: "Nodes",
  guestCount: "Guests",
  storageCount: "Storage",
  agentStatus: "Agent Status",
  replicationLastSync: "Last Sync",
  replicationDuration: "Duration",
  replicationFailedSyncs: "Failed Syncs",
  cephCapacityUsed: "Capacity used",
  topGuestsByCpu: "CPU Usage",
  topGuestsByMemory: "Memory Usage",
  nodeStatus: "Status",
  nodeUptime: "Uptime",
  nodeCpu: "CPU",
  nodeMemory: "Memory (Used / Total)",
  nodeHaState: "HA State",
  nodeNetworkThroughput: "Network Throughput",
  nodeDiskThroughput: "Disk Throughput",
  guestStatus: "Status",
  guestHaState: "HA State",
  guestStartOnBoot: "Start on Boot",
  guestBackupCoverage: "Backup Job Coverage",
  guestUptime: "Uptime",
  guestCpu: "CPU",
  guestMemory: "Memory (Used / Max)",
  guestDisk: "Disk (Used / Max)",
  guestNetworkThroughput: "Network Throughput",
  guestDiskThroughput: "Disk Throughput",
  storageStatus: "Status",
  storageUsed: "Used",
  storageTotal: "Total",
  storageUsedPercent: "Used %",
  storageGrowthForecast: "Growth Forecast",
  nodesTableStatus: "Status",
  nodesTableCpu: "CPU",
  nodesTableMemory: "Memory",
  nodesTableUptime: "Age",
  guestsTableStatus: "Status",
  guestsTableCpu: "CPU",
  guestsTableMemory: "Memory",
  guestsTableUptime: "Age",
  guestsTableHaState: "HA State",
  guestsTableBackup: "Backup",
  storageTableStatus: "Status",
  storageTableUsage: "Used / Total",
  storageTableAge: "Age",
  insightsDiskThroughput: "Disk Throughput",
};

const KEYS: Array<ProxmoxMetric> = Object.keys(D) as Array<ProxmoxMetric>;

// A numeric constant as the source declares it, e.g. `= 5;` or `= 15 * 60 * 1000;`.
function numericConstant(source: string, name: string): number {
  const declaration: RegExp = new RegExp(`const ${name}: number = ([0-9 *]+);`);
  const match: RegExpMatchArray | null = source.match(declaration);

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return match![1]!.split("*").reduce((product: number, factor: string) => {
    return product * Number(factor.trim());
  }, 1);
}

describe("Proxmox metric descriptions follow the house rules", () => {
  test("every description is a short, finished sentence and no two repeat", () => {
    expectReadableDescriptionRecord(D, "PROXMOX_METRIC_DESCRIPTIONS");
  });

  test.each(KEYS)("%s reads as a plain explanation", (key: ProxmoxMetric) => {
    expectReadableMetricDescription(D[key], key);
    expect(D[key].length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  test.each(KEYS)(
    "%s explains any percentile its title names",
    (key: ProxmoxMetric) => {
      expectTitleExplained(TITLES[key], D[key]);
    },
  );

  test("every description has a title it sits beside, and no title is left without one", () => {
    expect(Object.keys(TITLES).sort()).toEqual([...KEYS].sort());
  });

  test.each(KEYS)(
    "%s is one or two sentences, so it stays a small tooltip",
    (key: ProxmoxMetric) => {
      const sentences: Array<string> = D[key]
        .split(/(?<=[.!?])\s+(?=[A-Z'"])/)
        .filter(Boolean);

      expect(sentences.length).toBeGreaterThanOrEqual(1);
      expect(sentences.length).toBeLessThanOrEqual(2);
    },
  );

  test.each(KEYS)(
    "%s speaks to the customer, not in raw exporter metric names",
    (key: ProxmoxMetric) => {
      expect(D[key]).not.toMatch(/\bpve_[a-z_]+/);
      expect(D[key]).not.toMatch(/\bceph_[a-z_]+/);
      expect(D[key]).not.toMatch(/pve-exporter|corosync|vzdump|pvesr/i);
    },
  );
});

describe("the overview tiles say which window they average", () => {
  const TILE_WINDOW: number = numericConstant(
    OVERVIEW_SOURCE,
    "TILE_WINDOW_MINUTES",
  );

  test("the page still averages the tiles over the window the text names", () => {
    expect(TILE_WINDOW).toBe(5);
  });

  test.each(["clusterCpu", "clusterMemory", "guestsRunning"] as const)(
    "%s names the tile window and its whole-range fallback",
    (key: ProxmoxMetric) => {
      expect(D[key]).toContain(`last ${TILE_WINDOW} minutes`);
      expect(D[key]).toContain("whole range");
    },
  );

  /*
   * The tile keeps the buckets whose START is inside the last 5 minutes.
   * Once a range is long enough for the server to use buckets wider than
   * that window, usually no bucket starts inside it and the tile quietly
   * shows the whole-range mean - so the text must not promise "the last 5
   * minutes" on long ranges, and the range where that begins must be the
   * one the server's bucket picker really uses.
   */
  test.each(["clusterCpu", "clusterMemory", "guestsRunning"] as const)(
    "%s warns that long ranges often show the whole-range mean",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/often the whole range on ranges over 12 hours/);
    },
  );

  test("12 hours is where the server's buckets outgrow the tile window", () => {
    const end: Date = new Date("2026-09-24T12:00:00.000Z");
    const bucketMsFor: (rangeMs: number) => number = (
      rangeMs: number,
    ): number => {
      return AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: new Date(end.getTime() - rangeMs),
          endDate: end,
        }),
      );
    };
    const HOUR: number = 60 * 60 * 1000;
    const windowMs: number = TILE_WINDOW * 60 * 1000;

    // Up to 12 hours a bucket always starts inside the tile window...
    expect(bucketMsFor(30 * 60 * 1000)).toBeLessThanOrEqual(windowMs);
    expect(bucketMsFor(12 * HOUR)).toBeLessThanOrEqual(windowMs);
    // ...past 12 hours the buckets are wider than the window.
    expect(bucketMsFor(12 * HOUR + 60 * 1000)).toBeGreaterThan(windowMs);
    expect(bucketMsFor(24 * HOUR)).toBeGreaterThan(windowMs);

    // And the tile really does filter on each bucket's start time.
    expect(OVERVIEW_SOURCE).toContain(
      "if (p.x.getTime() < tileWindowStartMs) {",
    );
  });

  test.each([
    "cpuChart",
    "memoryChart",
    "storageChart",
    "networkChart",
  ] as const)(
    "the %s card covers the whole selected range, not the tile window",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/selected range/);
      expect(D[key]).not.toMatch(/5 minutes/);
    },
  );

  test("CPU is weighted by cores, so a big node counts more", () => {
    expect(D.clusterCpu).toMatch(/CPU cores on all nodes/);
    expect(D.clusterCpu).toMatch(/big node counts more/);
    expect(D.cpuChart).toMatch(/bigger nodes weighted more/);
    // The page really does weight by pve_cpu_usage_limit (cores).
    expect(OVERVIEW_SOURCE).toContain("weightedSum += ratio * limit;");
  });

  test("the Memory chart is bytes even though the Memory tile is a percentage", () => {
    expect(D.memoryChart).toMatch(/in bytes/);
    expect(D.memoryChart).toMatch(/percentage/);
    expect(D.clusterMemory).toMatch(/share of their combined memory/);
    expect(OVERVIEW_SOURCE).toContain("memBytesPerBucket.set(t, usedSum);");
  });

  test("the Memory tile's sub-line is the latest point, not the average", () => {
    expect(D.clusterMemory).toMatch(/latest data point/);
    expect(OVERVIEW_SOURCE).toContain("if (t > latestMemTs) {");
  });
});

describe("snapshot numbers say they ignore the time picker", () => {
  test("the hero's count chips say what they count and that they ignore the range", () => {
    expect(D.clusterInventoryCounts).toMatch(/Nodes online out of all nodes/);
    expect(D.clusterInventoryCounts).toMatch(/guests running out of all/);
    expect(D.clusterInventoryCounts).toMatch(/once per node/);
    expect(D.clusterInventoryCounts).toMatch(
      /rather than the selected time range/,
    );
  });

  test.each(["nodeAvailability", "fullestStorage", "guestsRunning"] as const)(
    "%s reads the latest report",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/latest report/);
    },
  );

  test("the Storage tile is the single fullest volume, not an average", () => {
    expect(D.fullestStorage).toMatch(/fullest/);
    expect(D.fullestStorage).toMatch(/not an average/);
    expect(D.fullestStorage).toMatch(/rather than the selected time range/);
  });

  test("the 85% storage threshold in the text is the one the page uses", () => {
    const nearFull: number = numericConstant(
      OVERVIEW_SOURCE,
      "STORAGE_NEAR_FULL_PERCENT",
    );

    expect(nearFull).toBe(85);

    for (const key of [
      "fullestStorage",
      "clusterHealth",
      "storageUsedPercent",
    ] as const) {
      expect(D[key]).toContain(`${nearFull}%`);
    }
  });

  test("the Storage chart admits that shared storage is counted once per node", () => {
    expect(D.storageChart).toMatch(/counted once for each node/);
    expect(D.storageChart).toMatch(/higher than the space really used/);
    expect(D.storageCount).toMatch(/listed once per node/);
  });
});

describe("list columns and detail fields say how stale their numbers can be", () => {
  const staleMinutes: number =
    numericConstant(UTILS_SOURCE, "METRIC_STALE_MS") / 60 / 1000;

  test("the staleness cut-off in the text is the one the lists use", () => {
    expect(staleMinutes).toBe(15);
  });

  test.each([
    "nodesTableCpu",
    "nodesTableMemory",
    "guestsTableCpu",
    "guestsTableMemory",
  ] as const)(
    "%s shows N/A after 15 minutes without an update",
    (key: ProxmoxMetric) => {
      expect(D[key]).toContain(`last ${staleMinutes} minutes`);
      expect(D[key]).toContain("N/A");
    },
  );

  test.each(["topGuestsByCpu", "topGuestsByMemory"] as const)(
    "%s leaves out guests that went quiet",
    (key: ProxmoxMetric) => {
      expect(D[key]).toContain(`last ${staleMinutes} minutes`);
      expect(D[key]).toMatch(/left out/);
    },
  );

  test.each(["nodeCpu", "guestCpu"] as const)(
    "%s on a detail page warns it may be the last known value",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/last value the agent sent/);
      expect(D[key]).toMatch(/out of date/);
      // Detail pages do not hide stale values, so they must not promise to.
      expect(D[key]).not.toMatch(/N\/A/);
    },
  );
});

describe("percentages name their denominator", () => {
  test.each(["guestCpu", "guestsTableCpu", "topGuestsByCpu"] as const)(
    "guest CPU (%s) is a share of the cores assigned to the guest",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/CPU cores assigned to/);
    },
  );

  test.each(["nodeCpu", "nodesTableCpu"] as const)(
    "node CPU (%s) is a share of all the node's cores",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/all its CPU cores/);
    },
  );

  test("guest memory is compared with what was assigned, node memory with the total", () => {
    expect(D.guestMemory).toMatch(/memory assigned to it/);
    expect(D.guestsTableMemory).toMatch(/memory assigned to it/);
    expect(D.topGuestsByMemory).toMatch(/assigned memory/);
    expect(D.nodeMemory).toMatch(/total memory/);
    expect(D.nodesTableMemory).toMatch(/total memory/);
  });

  test("Ceph capacity is raw capacity across the OSDs, with the card's colour steps", () => {
    expect(D.cephCapacityUsed).toMatch(/raw disk capacity/);
    expect(D.cephCapacityUsed).toMatch(/OSDs \(storage disks\)/);
    expect(D.cephCapacityUsed).toContain("75%");
    expect(D.cephCapacityUsed).toContain("90%");
    expect(OVERVIEW_SOURCE).toContain("capacityPercent >= 90");
    expect(OVERVIEW_SOURCE).toContain("capacityPercent >= 75");
  });
});

describe("health, quorum and backups say exactly what they check", () => {
  test("Cluster Health lists every driver the page uses", () => {
    for (const driver of [
      /Unhealthy/,
      /offline/,
      /error or fence/,
      /Degraded/,
      /85% full/,
      /start-on-boot guest is stopped/,
      /no backup job/,
      /replication fails/,
      /Unknown if the agent is disconnected/,
    ]) {
      expect(D.clusterHealth).toMatch(driver);
    }
  });

  test("Quorum explains quorum and admits it is derived, not read", () => {
    expect(D.quorum).toMatch(/more than half/);
    // Without quorum running guests keep running; changes and HA stop.
    expect(D.quorum).not.toMatch(/keep running/);
    expect(D.quorum).toMatch(/start guests, change settings/);
    expect(D.quorum).toMatch(/\(quorum\)/);
    expect(D.quorum).toMatch(/red at half or fewer/);
    expect(D.quorum).toMatch(/not read from Proxmox's own quorum service/);
    expect(OVERVIEW_SOURCE).toContain("nodesOnline / nodesTotal <= 0.5");
  });

  test.each([
    "backupCoverage",
    "guestBackupCoverage",
    "guestsTableBackup",
  ] as const)(
    "%s checks job coverage only, not backup success",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/backup job/);
      expect(D[key]).toMatch(/succeeded/);
      expect(D[key]).toMatch(/not|does not/);
    },
  );

  test("the backup column spells out all three values it can show", () => {
    expect(D.guestsTableBackup).toMatch(/In job/);
    expect(D.guestsTableBackup).toMatch(/Not backed up/);
    expect(D.guestsTableBackup).toMatch(/dash/);
  });

  test.each([
    "haStates",
    "nodeHaState",
    "guestHaState",
    "guestsTableHaState",
  ] as const)(
    "%s explains high availability and its problem states",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/high-availability|high availability/);
      expect(D[key]).toMatch(/fence/);
    },
  );

  test("HA error and fence really do make the cluster Unhealthy", () => {
    expect(D.haStates).toMatch(/Unhealthy/);
    expect(OVERVIEW_SOURCE).toContain(
      'row.haState === "error" || row.haState === "fence"',
    );
  });

  test("the agent status names the disconnect delay the server applies", () => {
    expect(D.agentStatus).toMatch(/15 to 20 minutes after data stops/);

    /*
     * A cluster is marked disconnected once lastSeenAt is 15 minutes old,
     * by a job that runs every 5 minutes - hence "15 to 20 minutes".
     */
    const service: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "ProxmoxClusterService.ts",
      ),
      "utf8",
    );
    const cron: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Workers",
        "Jobs",
        "Proxmox",
        "CleanupStaleResources.ts",
      ),
      "utf8",
    );
    const markDisconnected: string = service.slice(
      service.indexOf("public async markDisconnectedClusters"),
    );

    expect(markDisconnected).toContain(
      "OneUptimeDate.getCurrentDate(),\n      -15,",
    );
    expect(markDisconnected).toContain('otelCollectorStatus: "disconnected"');
    expect(cron).toContain("schedule: EVERY_FIVE_MINUTE");
    expect(cron).toContain("markDisconnectedClusters()");
  });
});

describe("replication, forecast and uptime", () => {
  test("Last Sync names the amber and red steps the table uses", () => {
    const warn: number = numericConstant(
      OVERVIEW_SOURCE,
      "REPLICATION_SYNC_WARN_SECONDS",
    );
    const danger: number = numericConstant(
      OVERVIEW_SOURCE,
      "REPLICATION_SYNC_DANGER_SECONDS",
    );

    expect(D.replicationLastSync).toContain(`${warn / 3600} hour`);
    expect(D.replicationLastSync).toContain(`${danger / 3600} hours`);
    expect(D.replicationLastSync).toMatch(/successful/);
  });

  test("Failed Syncs says any failure marks the cluster Degraded", () => {
    expect(D.replicationFailedSyncs).toMatch(/above zero/);
    expect(D.replicationFailedSyncs).toMatch(/at least Degraded/);
    /*
     * Replication failures only lift a Healthy cluster to Degraded; an
     * Unhealthy one stays Unhealthy.
     */
    expect(OVERVIEW_SOURCE).toContain(
      'inventoryHealth === "Healthy" && replicationDegradedItems.length > 0',
    );
  });

  test("Failed Syncs is a run of failures since the last good sync, not a lifetime total", () => {
    expect(D.replicationFailedSyncs).toMatch(/failed in a row/);
    expect(D.replicationFailedSyncs).toMatch(/since its last successful sync/);
  });

  test("the growth forecast names its fit window, its cut-off and 'Full now'", () => {
    const hours: number = numericConstant(
      STORAGE_DETAIL_SOURCE,
      "PROJECTION_WINDOW_HOURS",
    );

    expect(D.storageGrowthForecast).toContain(`last ${hours} hours`);
    expect(D.storageGrowthForecast).toMatch(/straight-line/);
    expect(D.storageGrowthForecast).toMatch(/within a year/);
    expect(D.storageGrowthForecast).toMatch(/'Full now'/);
    expect(STORAGE_DETAIL_SOURCE).toContain("daysToFull <= 365");
  });

  test.each(["nodesTableUptime", "guestsTableUptime"] as const)(
    "the Age column (%s) is uptime, not age",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/\(its uptime\)/);
    },
  );

  test("the storage Age column admits Proxmox reports no uptime for storage", () => {
    expect(D.storageTableAge).toMatch(/does not report an uptime/);
    expect(D.storageTableAge).toMatch(/dash/);
  });

  test("the QEMU disk field names the guest agent it depends on", () => {
    expect(D.guestDisk).toMatch(/QEMU guest agent/);
    expect(D.guestDisk).toMatch(/0 or N\/A/);
  });
});

describe("throughput charts", () => {
  test.each([
    "networkChart",
    "nodeNetworkThroughput",
    "nodeDiskThroughput",
    "guestNetworkThroughput",
    "guestDiskThroughput",
    "insightsDiskThroughput",
  ] as const)("%s is a per-second rate", (key: ProxmoxMetric) => {
    expect(D[key]).toMatch(/per second/);
  });

  test.each(["nodeNetworkThroughput", "nodeDiskThroughput"] as const)(
    "%s warns it is often empty for nodes",
    (key: ProxmoxMetric) => {
      expect(D[key]).toMatch(/Often empty/);
    },
  );

  test("the cluster-wide charts say whose traffic they add up", () => {
    expect(D.networkChart).toMatch(/all virtual machines and containers/);
    expect(D.insightsDiskThroughput).toMatch(
      /every virtual machine and container/,
    );
  });
});
