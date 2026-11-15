/*
 * The made-up fleets the Hosts pages fixture serves, for an "Acme
 * Infrastructure" workspace. Nothing here is a real customer's data.
 *
 * buildFleet(scenario, loadedAt) returns the hosts (Host rows, the shape the
 * metrics ingest and the host's collector write - its readings included) for
 * one of:
 *
 *   busy   (default) ten hosts: two healthy (one on Windows), one with /var
 *          96% full and memory short, one that stopped reporting three hours
 *          ago, one with two failed systemd units, one swapping with more
 *          work queued than cores, one whose collector config did not start,
 *          one out of inodes, one whose collector is still starting and one
 *          set up by hand that sends no host metrics;
 *   calm   the same hosts with nothing that needs attention;
 *   new    a project with no host yet;
 *   large  sixty hosts, eighteen of them needing attention.
 *
 * Each host's Overview draws its tiles and charts from metrics shaped as the
 * hostmetrics receiver sends them (hostMetricRows), around the host's own
 * readings, so the tiles say what the Hosts list says.
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GIB = 1024 * 1024 * 1024;

export const HOST_IDS = {
  web01: uuid("75000000", 1),
  db01: uuid("75000000", 2),
  web03: uuid("75000000", 3),
  app02: uuid("75000000", 4),
  edge01: uuid("75000000", 5),
  build01: uuid("75000000", 6),
  mac01: uuid("75000000", 7),
  new01: uuid("75000000", 8),
  legacy01: uuid("75000000", 9),
  win01: uuid("75000000", 10),
};

export const CONFIG_ID = uuid("76000000", 1);

/*
 * One host, as its record reads: a reporting Linux host with fresh readings
 * that need nothing, unless `fields` says otherwise.
 */
function host(id, name, fields, loadedAt) {
  return {
    _id: id,
    name: name,
    hostIdentifier: name,
    projectId: PROJECT_ID,
    isArchived: false,
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(loadedAt - MINUTE),
    createdAt: new Date(loadedAt - 90 * DAY),
    osType: "linux",
    osVersion: "Ubuntu 24.04.1 LTS (Noble Numbat)",
    hostArch: "amd64",
    hostIpAddresses: "10.0.1.21, fe80::1",
    cpuCores: 8,
    totalMemoryBytes: 32 * GIB,
    processCount: 214,
    agentVersion: "0.161.0",
    collectorInstanceUid: `uid-${name}`,
    collectorRegisteredAt: new Date(loadedAt - 80 * DAY),
    collectorLastContactAt: new Date(loadedAt - MINUTE),
    collectorConfigStatus: "applied",
    isCollectorHealthy: true,
    collectorConfig: { _id: CONFIG_ID, name: "Web servers" },
    collectorConfigId: CONFIG_ID,
    latestCpuPercent: 34.2,
    latestMemoryPercent: 52.6,
    latestSwapPercent: 2.1,
    latestDiskPercent: 47.8,
    latestDiskMountpoint: "/",
    latestInodesPercent: 11.4,
    latestInodesMountpoint: "/",
    latestLoadAverage15m: 2.1,
    bootedAt: new Date(loadedAt - 12 * DAY - 4 * HOUR),
    failedSystemdUnitCount: 0,
    failedSystemdUnits: [],
    readingsUpdatedAt: new Date(loadedAt - MINUTE),
    labels: [],
    ...fields,
  };
}

function busyFleet(loadedAt) {
  return [
    host(HOST_IDS.web01, "web-01", {}, loadedAt),
    host(
      HOST_IDS.db01,
      "db-01",
      {
        name: "Payments database",
        hostIdentifier: "db-01.prod.internal",
        cpuCores: 16,
        totalMemoryBytes: 64 * GIB,
        latestCpuPercent: 61.3,
        latestMemoryPercent: 92.3,
        latestSwapPercent: 40,
        latestDiskPercent: 96.4,
        latestDiskMountpoint: "/var/lib/postgresql",
        latestLoadAverage15m: 6.4,
        /*
         * Booted 41 days and 7 seconds before the data was built: its
         * hero says "Up 41d" whatever second it is drawn in, never days
         * with seconds ("Up 41d 7s", issue #7306).
         */
        bootedAt: new Date(loadedAt - 41 * DAY - 7 * 1000),
        collectorConfig: { _id: CONFIG_ID, name: "Databases" },
      },
      loadedAt,
    ),
    host(
      HOST_IDS.web03,
      "web-03",
      {
        otelCollectorStatus: "disconnected",
        lastSeenAt: new Date(loadedAt - 3 * HOUR - 12 * MINUTE),
        collectorLastContactAt: new Date(loadedAt - 3 * HOUR - 12 * MINUTE),
        readingsUpdatedAt: new Date(loadedAt - 3 * HOUR - 12 * MINUTE),
        // What it said last; no longer the truth.
        latestDiskPercent: 99,
      },
      loadedAt,
    ),
    host(
      HOST_IDS.app02,
      "app-02",
      {
        cpuCores: 4,
        totalMemoryBytes: 16 * GIB,
        latestCpuPercent: 22.5,
        latestMemoryPercent: 61.2,
        latestDiskPercent: 70.4,
        failedSystemdUnitCount: 2,
        failedSystemdUnits: ["backup.service", "nginx.service"],
      },
      loadedAt,
    ),
    host(
      HOST_IDS.edge01,
      "edge-01",
      {
        cpuCores: 4,
        totalMemoryBytes: 8 * GIB,
        latestCpuPercent: 97.1,
        latestMemoryPercent: 88.4,
        latestSwapPercent: 86.2,
        latestDiskPercent: 58,
        latestLoadAverage15m: 9.64,
        bootedAt: new Date(loadedAt - 6 * MINUTE),
      },
      loadedAt,
    ),
    host(
      HOST_IDS.build01,
      "build-01",
      {
        latestCpuPercent: 12.4,
        latestMemoryPercent: 44,
        latestDiskPercent: 81.2,
        collectorConfigStatus: "failed",
        collectorConfig: { _id: CONFIG_ID, name: "Build agents" },
      },
      loadedAt,
    ),
    host(
      HOST_IDS.mac01,
      "mac-01",
      {
        osType: "darwin",
        osVersion: "macOS 15.1",
        hostArch: "arm64",
        latestInodesPercent: 91.3,
        latestInodesMountpoint: "/System/Volumes/Data",
        latestDiskPercent: 64,
        latestDiskMountpoint: "/System/Volumes/Data",
        latestSwapPercent: 12,
      },
      loadedAt,
    ),
    host(
      HOST_IDS.new01,
      "new-01",
      {
        otelCollectorStatus: null,
        lastSeenAt: null,
        createdAt: new Date(loadedAt - 2 * MINUTE),
        collectorRegisteredAt: new Date(loadedAt - 2 * MINUTE),
        collectorConfigStatus: "waiting",
        readingsUpdatedAt: null,
        latestCpuPercent: null,
        latestMemoryPercent: null,
        latestSwapPercent: null,
        latestDiskPercent: null,
        latestDiskMountpoint: null,
        latestInodesPercent: null,
        latestInodesMountpoint: null,
        latestLoadAverage15m: null,
        bootedAt: null,
        cpuCores: null,
        totalMemoryBytes: null,
        osType: "linux",
        hostIpAddresses: null,
        agentVersion: null,
      },
      loadedAt,
    ),
    host(
      HOST_IDS.legacy01,
      "legacy-01",
      {
        collectorInstanceUid: null,
        collectorConfigStatus: null,
        collectorConfig: null,
        collectorConfigId: null,
        readingsUpdatedAt: null,
        latestCpuPercent: null,
        latestMemoryPercent: null,
        latestSwapPercent: null,
        latestDiskPercent: null,
        latestDiskMountpoint: null,
        latestInodesPercent: null,
        latestInodesMountpoint: null,
        latestLoadAverage15m: null,
        bootedAt: null,
        agentVersion: "0.146.0",
      },
      loadedAt,
    ),
    host(
      HOST_IDS.win01,
      "win-01",
      {
        osType: "windows",
        osVersion: "Windows Server 2022 Datacenter 10.0.20348",
        cpuCores: 4,
        totalMemoryBytes: 16 * GIB,
        latestCpuPercent: 18,
        latestMemoryPercent: 63.5,
        latestDiskPercent: 62.1,
        latestDiskMountpoint: "C:",
        latestInodesPercent: null,
        latestInodesMountpoint: null,
        latestLoadAverage15m: 0.6,
        bootedAt: new Date(loadedAt - 3 * HOUR),
        failedSystemdUnitCount: null,
        failedSystemdUnits: null,
        collectorConfig: { _id: CONFIG_ID, name: "Windows servers" },
      },
      loadedAt,
    ),
  ];
}

// The busy fleet with nothing that needs attention.
function calmFleet(loadedAt) {
  return busyFleet(loadedAt).map((row) => {
    return {
      ...row,
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(loadedAt - MINUTE),
      readingsUpdatedAt: new Date(loadedAt - MINUTE),
      createdAt: new Date(loadedAt - 90 * DAY),
      collectorRegisteredAt: new Date(loadedAt - 80 * DAY),
      collectorConfigStatus: row.collectorInstanceUid ? "applied" : null,
      latestCpuPercent: 30,
      latestMemoryPercent: 50,
      latestSwapPercent: 1,
      latestDiskPercent: 45,
      latestDiskMountpoint: row.osType === "windows" ? "C:" : "/",
      latestInodesPercent: row.osType === "windows" ? null : 10,
      latestInodesMountpoint: row.osType === "windows" ? null : "/",
      latestLoadAverage15m: 1,
      cpuCores: row.cpuCores || 8,
      totalMemoryBytes: row.totalMemoryBytes || 32 * GIB,
      bootedAt: new Date(loadedAt - 20 * DAY),
      failedSystemdUnitCount: row.osType === "windows" ? null : 0,
      failedSystemdUnits: row.osType === "windows" ? null : [],
    };
  });
}

// Sixty hosts: every fifth is short of memory, every seventh not reporting.
function largeFleet(loadedAt) {
  const rows = [];
  for (let index = 1; index <= 60; index++) {
    const name = `node-${String(index).padStart(2, "0")}`;
    const fields = {};
    if (index % 7 === 0) {
      fields.otelCollectorStatus = "disconnected";
      fields.lastSeenAt = new Date(loadedAt - index * HOUR);
      fields.readingsUpdatedAt = new Date(loadedAt - index * HOUR);
    } else if (index % 5 === 0) {
      fields.latestMemoryPercent = 90 + (index % 9);
    } else if (index % 11 === 0) {
      fields.latestDiskPercent = 86 + (index % 7);
    }
    rows.push(host(uuid("77000000", index), name, fields, loadedAt));
  }
  return rows;
}

export function buildFleet(scenario, loadedAt) {
  switch (scenario.fleet) {
    case "calm":
      return calmFleet(loadedAt);
    case "new":
      return [];
    case "large":
      return largeFleet(loadedAt);
    default:
      return busyFleet(loadedAt);
  }
}

/*
 * ---------------------------------------------------------------------------
 * A host's metrics, as the hostmetrics receiver sends them
 * ---------------------------------------------------------------------------
 */

// A smooth, repeatable swing in [-1, 1] for step `step` of a series.
function wave(seed, step) {
  return (
    Math.sin((step + seed * 7) / 5) * 0.5 + Math.sin((step + seed) / 13) * 0.5
  );
}

function seedOf(text) {
  let seed = 0;
  for (const character of text) {
    seed = (seed * 31 + character.charCodeAt(0)) % 997;
  }
  return seed;
}

// The mounts a host reports: its fullest one at its own reading.
function mountsOf(row) {
  const fullest = row.latestDiskMountpoint || "/";
  const percent = Number(row.latestDiskPercent ?? 40) / 100;
  if (row.osType === "windows") {
    return [{ mountpoint: "C:", size: 256 * GIB, share: percent }];
  }
  const mounts = [
    { mountpoint: fullest, size: 500 * GIB, share: percent },
    { mountpoint: "/boot", size: 1 * GIB, share: 0.14 },
  ];
  if (fullest !== "/") {
    mounts.push({ mountpoint: "/", size: 80 * GIB, share: 0.42 });
  }
  return mounts;
}

/*
 * The rows AnalyticsModelAPI.aggregate answers for one host's metric, one
 * per bucket of the window (and per attribute set where the Overview groups
 * by attributes), or null for a metric this fixture does not model.
 */
export function hostMetricRows(data) {
  const row = data.host;
  const name = data.metricName;
  const attributes = data.attributes || {};
  const reporting = row.otelCollectorStatus === "connected";
  const lastAt = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  const start = data.start.getTime();
  const end = data.end.getTime();
  const spanMinutes = Math.max(1, Math.round((end - start) / MINUTE));
  const stepMinutes = Math.max(1, Math.ceil(spanMinutes / 60));
  const steps = Math.floor(spanMinutes / stepMinutes);
  const seed = seedOf(row.hostIdentifier || row.name || "");
  const out = [];

  const times = [];
  for (let index = 0; index <= steps; index++) {
    const time = start + index * stepMinutes * MINUTE;
    if (!reporting && time > lastAt) {
      continue;
    }
    if (time > data.loadedAt) {
      continue;
    }
    times.push({ index, time });
  }

  const push = (time, value, extra) => {
    out.push({
      timestamp: new Date(time).toISOString(),
      value: value,
      attributes: extra ? { ...extra } : {},
    });
  };

  const cpu = Number(row.latestCpuPercent ?? 30) / 100;
  const memory = Number(row.latestMemoryPercent ?? 50) / 100;

  switch (name) {
    case "system.cpu.utilization": {
      const state = attributes["state"];
      for (const { index, time } of times) {
        const swing = 1 + wave(seed, index) * 0.08;
        const share =
          state === "system" ? cpu * 0.25 * swing : cpu * 0.75 * swing;
        push(time, Math.max(0, Math.min(1, share)));
      }
      return out;
    }
    case "system.memory.utilization": {
      for (const { index, time } of times) {
        push(time, Math.max(0, Math.min(1, memory + wave(seed, index) * 0.01)));
      }
      return out;
    }
    case "system.cpu.load_average.1m": {
      const load = Number(row.latestLoadAverage15m ?? 1);
      for (const { index, time } of times) {
        push(time, Math.max(0, load * (1 + wave(seed, index) * 0.2)));
      }
      return out;
    }
    case "system.processes.count": {
      for (const { index, time } of times) {
        push(time, 3 + Math.round(Math.abs(wave(seed, index)) * 4));
      }
      return out;
    }
    case "process.cpu.utilization":
      return [];
    case "oneuptime.host.heartbeat": {
      for (const { time } of times) {
        push(time, 2);
      }
      return out;
    }
    case "system.filesystem.usage": {
      for (const mount of mountsOf(row)) {
        /*
         * Its share is df's Use%: used / (used + free), the space kept for
         * root left out - as the host's stored reading is.
         */
        const reserved = mount.mountpoint === "C:" ? 0 : mount.size * 0.02;
        const used = (mount.size - reserved) * mount.share;
        const free = Math.max(0, mount.size - used - reserved);
        for (const { time } of times) {
          for (const [state, value] of [
            ["used", used],
            ["free", free],
            ["reserved", reserved],
          ]) {
            push(time, value, {
              mountpoint: mount.mountpoint,
              device: mount.mountpoint === "C:" ? "C:" : "/dev/nvme0n1p2",
              type: mount.mountpoint === "C:" ? "NTFS" : "ext4",
              state: state,
            });
          }
        }
      }
      return out;
    }
    case "system.network.io": {
      for (const [direction, rate] of [
        ["receive", 2.4e6],
        ["transmit", 0.9e6],
      ]) {
        for (const { index, time } of times) {
          push(time, 1e12 + index * stepMinutes * 60 * rate, {
            device: "eth0",
            direction: direction,
          });
        }
      }
      return out;
    }
    default:
      return null;
  }
}
