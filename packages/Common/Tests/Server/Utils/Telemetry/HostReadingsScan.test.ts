import { describe, expect, test } from "@jest/globals";
import {
  HOST_FAILED_SYSTEMD_UNITS_KEPT,
  HOST_READING_METRIC_NAMES,
  HOST_READING_NAME_MAX_LENGTH,
  HostReadingColumns,
  HostReadings,
  hasHostReadings,
  mergeHostReadings,
  readAttribute,
  scanHostReadings,
  toHostReadingColumns,
} from "../../../../Server/Utils/Telemetry/HostReadingsScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";

/*
 * What a host reported, read from one metrics batch (HostReadingsScan),
 * fed the exact OTLP JSON shapes the hostmetrics receiver and the systemd
 * receiver send through OneUptime's ingest: datapoints with asInt (as text)
 * or asDouble, a timeUnixNano, and key/value attribute lists. Each reading
 * must be worked out the way the host's Overview works out the number it
 * shows, so the Hosts list, its Needs attention card and the host's page
 * agree.
 */

// 2026-11-02T10:00:00.000Z - one scrape's instant.
const SCRAPE_MS: number = Date.UTC(2026, 10, 2, 10, 0, 0);
const RECEIVED_AT: Date = new Date(SCRAPE_MS + 2_000);
const GIB: number = 1024 * 1024 * 1024;

type Attributes = Record<string, string | number | boolean>;

function attributes(values: Attributes): JSONArray {
  return Object.keys(values).map((key: string): JSONObject => {
    const value: string | number | boolean = values[key]!;
    if (typeof value === "string") {
      return { key: key, value: { stringValue: value } };
    }
    if (typeof value === "boolean") {
      return { key: key, value: { boolValue: value } };
    }
    return Number.isInteger(value)
      ? { key: key, value: { intValue: String(value) } }
      : { key: key, value: { doubleValue: value } };
  });
}

interface Point {
  attributes?: Attributes;
  asDouble?: number;
  asInt?: number;
  timeUnixNano?: string;
}

function point(data: Point): JSONObject {
  const result: JSONObject = {
    attributes: attributes(data.attributes || {}),
    timeUnixNano:
      data.timeUnixNano !== undefined
        ? data.timeUnixNano
        : `${SCRAPE_MS}000000`,
  };
  if (data.asDouble !== undefined) {
    result["asDouble"] = data.asDouble;
  }
  if (data.asInt !== undefined) {
    // OTLP JSON writes 64-bit integers as text.
    result["asInt"] = String(data.asInt);
  }
  return result;
}

function gauge(name: string, points: Array<Point>): JSONObject {
  return { name: name, gauge: { dataPoints: points.map(point) } };
}

function sum(name: string, points: Array<Point>): JSONObject {
  return {
    name: name,
    sum: {
      dataPoints: points.map(point),
      aggregationTemporality: 2,
      isMonotonic: false,
    },
  };
}

function scopeMetrics(metrics: Array<JSONObject>): JSONArray {
  return [{ scope: { name: "hostmetrics" }, metrics: metrics }];
}

function scan(
  metrics: Array<JSONObject>,
  resource: Attributes = { "host.name": "web-01", "os.type": "linux" },
): HostReadings {
  return scanHostReadings({
    resourceAttributes: attributes(resource),
    scopeMetrics: scopeMetrics(metrics),
    receivedAt: RECEIVED_AT,
  });
}

const CPU_STATES: Array<string> = [
  "user",
  "system",
  "idle",
  "interrupt",
  "nice",
  "softirq",
  "steal",
  "wait",
];

/*
 * system.cpu.utilization as the cpu scraper sends it: one point per CPU per
 * state. `perCpu` gives each CPU's user and system share; the rest of its
 * time is idle, with a little wait and steal that must not count.
 */
function cpuUtilization(
  perCpu: Array<{ user: number; system: number }>,
): JSONObject {
  const points: Array<Point> = [];
  perCpu.forEach((shares: { user: number; system: number }, index: number) => {
    for (const state of CPU_STATES) {
      let value: number = 0;
      if (state === "user") {
        value = shares.user;
      } else if (state === "system") {
        value = shares.system;
      } else if (state === "wait") {
        value = 0.05;
      } else if (state === "steal") {
        value = 0.02;
      } else if (state === "idle") {
        value = Math.max(0, 1 - shares.user - shares.system - 0.07);
      }
      points.push({
        attributes: { cpu: `cpu${index}`, state: state },
        asDouble: value,
      });
    }
  });
  return gauge("system.cpu.utilization", points);
}

function filesystemUsage(
  mounts: Array<{
    mountpoint: string;
    used: number;
    free: number;
    reserved: number;
  }>,
): JSONObject {
  const points: Array<Point> = [];
  for (const mount of mounts) {
    for (const state of ["used", "free", "reserved"] as const) {
      points.push({
        attributes: {
          device: `/dev/disk-${mount.mountpoint}`,
          mode: "rw",
          mountpoint: mount.mountpoint,
          type: "ext4",
          state: state,
        },
        asInt: mount[state],
      });
    }
  }
  return sum("system.filesystem.usage", points);
}

function inodesUsage(
  mounts: Array<{ mountpoint: string; used: number; free: number }>,
): JSONObject {
  const points: Array<Point> = [];
  for (const mount of mounts) {
    for (const state of ["used", "free"] as const) {
      points.push({
        attributes: {
          device: `/dev/disk-${mount.mountpoint}`,
          mode: "rw",
          mountpoint: mount.mountpoint,
          type: "ext4",
          state: state,
        },
        asInt: mount[state],
      });
    }
  }
  return sum("system.filesystem.inodes.usage", points);
}

// One systemd unit's resource, as the systemd receiver sends it.
function systemdUnit(name: string, activeState: string): HostReadings {
  return scanHostReadings({
    resourceAttributes: attributes({
      "systemd.unit.name": name,
      "host.name": "web-01",
      "os.type": "linux",
    }),
    scopeMetrics: scopeMetrics([
      sum(
        "systemd.unit.state",
        [
          "active",
          "reloading",
          "inactive",
          "failed",
          "activating",
          "deactivating",
          "maintenance",
          "refreshing",
        ].map((state: string): Point => {
          return {
            attributes: { "systemd.unit.active_state": state },
            asInt: state === activeState ? 1 : 0,
          };
        }),
      ),
    ]),
    receivedAt: RECEIVED_AT,
  });
}

describe("HostReadingsScan: CPU", () => {
  test("is the mean user share plus the mean system share, as a percent", () => {
    const readings: HostReadings = scan([
      cpuUtilization([
        { user: 0.4, system: 0.1 },
        { user: 0.2, system: 0.1 },
        { user: 0.6, system: 0.2 },
        { user: 0, system: 0.1 },
      ]),
    ]);
    // Mean user 0.3 + mean system 0.125 = 42.5%.
    expect(readings.cpuPercent).toBe(42.5);
  });

  test("leaves iowait and steal out, as the Overview's CPU tile does", () => {
    const readings: HostReadings = scan([
      cpuUtilization([{ user: 0, system: 0 }]),
    ]);
    // Only wait (5%) and steal (2%) were busy: that is not CPU work.
    expect(readings.cpuPercent).toBe(0);
  });

  test("is clamped to 100% and rounded to two decimals", () => {
    expect(
      scan([cpuUtilization([{ user: 0.9, system: 0.3 }])]).cpuPercent,
    ).toBe(100);
    expect(
      scan([cpuUtilization([{ user: 0.12345, system: 0.00001 }])]).cpuPercent,
    ).toBe(12.35);
  });

  test("gives no reading without user or system points", () => {
    const readings: HostReadings = scan([
      gauge("system.cpu.utilization", [
        { attributes: { cpu: "cpu0", state: "idle" }, asDouble: 0.9 },
      ]),
    ]);
    expect(readings.cpuPercent).toBeUndefined();
  });

  test("reads a value written as an integer too", () => {
    const readings: HostReadings = scan([
      gauge("system.cpu.utilization", [
        { attributes: { cpu: "cpu0", state: "user" }, asInt: 1 },
      ]),
    ]);
    expect(readings.cpuPercent).toBe(100);
  });
});

describe("HostReadingsScan: memory", () => {
  test("is system.memory.utilization's used share", () => {
    const readings: HostReadings = scan([
      gauge("system.memory.utilization", [
        { attributes: { state: "used" }, asDouble: 0.8234 },
        { attributes: { state: "free" }, asDouble: 0.05 },
        { attributes: { state: "cached" }, asDouble: 0.1 },
        { attributes: { state: "buffered" }, asDouble: 0.0266 },
      ]),
    ]);
    expect(readings.memoryPercent).toBe(82.34);
  });

  test("falls back to system.memory.usage's used share without the optional metric", () => {
    const readings: HostReadings = scan([
      sum("system.memory.usage", [
        { attributes: { state: "used" }, asInt: 6 * GIB },
        { attributes: { state: "free" }, asInt: 1 * GIB },
        { attributes: { state: "cached" }, asInt: 1 * GIB },
      ]),
    ]);
    expect(readings.memoryPercent).toBe(75);
  });

  test("prefers the utilization metric whatever order the batch holds them in", () => {
    const usage: JSONObject = sum("system.memory.usage", [
      { attributes: { state: "used" }, asInt: 1 * GIB },
      { attributes: { state: "free" }, asInt: 3 * GIB },
    ]);
    const utilization: JSONObject = gauge("system.memory.utilization", [
      { attributes: { state: "used" }, asDouble: 0.9 },
    ]);
    expect(scan([usage, utilization]).memoryPercent).toBe(90);
    expect(scan([utilization, usage]).memoryPercent).toBe(90);
  });
});

describe("HostReadingsScan: swap", () => {
  test("is used over used plus free across every swap device; cached does not count", () => {
    const readings: HostReadings = scan([
      sum("system.paging.usage", [
        { attributes: { device: "/dev/sda2", state: "used" }, asInt: 3 * GIB },
        { attributes: { device: "/dev/sda2", state: "free" }, asInt: 1 * GIB },
        {
          attributes: { device: "/dev/sda2", state: "cached" },
          asInt: 4 * GIB,
        },
        {
          attributes: { device: "/swapfile", state: "used" },
          asInt: 1 * GIB,
        },
        {
          attributes: { device: "/swapfile", state: "free" },
          asInt: 3 * GIB,
        },
      ]),
    ]);
    // (3 + 1) / (3 + 1 + 1 + 3) = 50%.
    expect(readings.swapPercent).toBe(50);
  });

  test("gives no reading on a host without swap", () => {
    const readings: HostReadings = scan([
      sum("system.paging.usage", [
        { attributes: { device: "", state: "used" }, asInt: 0 },
        { attributes: { device: "", state: "free" }, asInt: 0 },
      ]),
    ]);
    expect(readings.swapPercent).toBeUndefined();
  });

  test("ignores the paging operations and faults counters", () => {
    const readings: HostReadings = scan([
      sum("system.paging.operations", [
        { attributes: { direction: "page_in", type: "major" }, asInt: 99 },
      ]),
    ]);
    expect(readings.swapPercent).toBeUndefined();
  });
});

describe("HostReadingsScan: the fullest filesystem", () => {
  test("is the mount with the highest used share, as df's Use% writes it", () => {
    const readings: HostReadings = scan([
      filesystemUsage([
        { mountpoint: "/", used: 40 * GIB, free: 55 * GIB, reserved: 5 * GIB },
        {
          mountpoint: "/var",
          used: 91 * GIB,
          free: 4 * GIB,
          reserved: 5 * GIB,
        },
        {
          mountpoint: "/boot/efi",
          used: 1 * GIB,
          free: 9 * GIB,
          reserved: 0,
        },
      ]),
    ]);
    // 91 / (91 + 4): root's reserved 5 GiB is space nobody else can write.
    expect(readings.diskPercent).toBe(95.79);
    expect(readings.diskMountpoint).toBe("/var");
  });

  test("agrees with the collector's own system.filesystem.utilization", () => {
    // Read from otelcol-contrib 0.161.0 on an ext4 /boot: 0.142387.
    const readings: HostReadings = scan([
      filesystemUsage([
        {
          mountpoint: "/boot",
          used: 122241024,
          free: 736272384,
          reserved: 64643072,
        },
      ]),
    ]);
    expect(readings.diskPercent).toBe(14.24);
  });

  test("names the same mount for a tie, whatever order the points come in", () => {
    const a: {
      mountpoint: string;
      used: number;
      free: number;
      reserved: number;
    } = { mountpoint: "/srv", used: 50, free: 50, reserved: 0 };
    const b: {
      mountpoint: string;
      used: number;
      free: number;
      reserved: number;
    } = { mountpoint: "/data", used: 50, free: 50, reserved: 0 };
    expect(scan([filesystemUsage([a, b])]).diskMountpoint).toBe("/data");
    expect(scan([filesystemUsage([b, a])]).diskMountpoint).toBe("/data");
  });

  test("skips a mount that reports no size", () => {
    const readings: HostReadings = scan([
      filesystemUsage([
        { mountpoint: "/empty", used: 0, free: 0, reserved: 0 },
        { mountpoint: "/", used: 10, free: 90, reserved: 0 },
      ]),
    ]);
    expect(readings.diskMountpoint).toBe("/");
    expect(readings.diskPercent).toBe(10);
  });

  test("skips negative and unreadable values instead of counting them", () => {
    const readings: HostReadings = scan([
      sum("system.filesystem.usage", [
        { attributes: { mountpoint: "/", state: "used" }, asInt: -5 },
        { attributes: { mountpoint: "/", state: "free" }, asInt: 100 },
        {
          attributes: { mountpoint: "/home", state: "used" },
          asDouble: Number.NaN,
        },
        { attributes: { mountpoint: "/home", state: "free" }, asInt: 100 },
      ]),
    ]);
    // Neither mount has a readable used figure.
    expect(readings.diskPercent).toBeUndefined();
  });

  test("falls back to system.filesystem.utilization when usage is not sent", () => {
    const readings: HostReadings = scan([
      gauge("system.filesystem.utilization", [
        { attributes: { mountpoint: "/", device: "/dev/sda1" }, asDouble: 0.4 },
        {
          attributes: { mountpoint: "/var/lib", device: "/dev/sdb1" },
          asDouble: 0.97,
        },
      ]),
    ]);
    expect(readings.diskPercent).toBe(97);
    expect(readings.diskMountpoint).toBe("/var/lib");
  });

  test("prefers usage, which every collector sends, over the optional utilization", () => {
    const readings: HostReadings = scan([
      gauge("system.filesystem.utilization", [
        { attributes: { mountpoint: "/" }, asDouble: 0.99 },
      ]),
      filesystemUsage([{ mountpoint: "/", used: 60, free: 40, reserved: 5 }]),
    ]);
    expect(readings.diskPercent).toBe(60);
  });

  test("cuts a mount point longer than its column holds", () => {
    const long: string = `/${"a".repeat(HOST_READING_NAME_MAX_LENGTH + 50)}`;
    const readings: HostReadings = scan([
      filesystemUsage([{ mountpoint: long, used: 9, free: 1, reserved: 0 }]),
    ]);
    expect(readings.diskMountpoint).toHaveLength(HOST_READING_NAME_MAX_LENGTH);
  });
});

describe("HostReadingsScan: inodes", () => {
  test("is the mount with the highest share of inodes in use", () => {
    const readings: HostReadings = scan([
      inodesUsage([
        { mountpoint: "/", used: 100_000, free: 900_000 },
        { mountpoint: "/var/spool", used: 970_000, free: 30_000 },
      ]),
    ]);
    expect(readings.inodesPercent).toBe(97);
    expect(readings.inodesMountpoint).toBe("/var/spool");
  });

  test("leaves out a filesystem that has no inode table (btrfs reports none)", () => {
    const readings: HostReadings = scan([
      inodesUsage([{ mountpoint: "/", used: 0, free: 0 }]),
    ]);
    expect(readings.inodesPercent).toBeUndefined();
  });
});

describe("HostReadingsScan: load and uptime", () => {
  test("keeps the 15-minute load average, not the 1- or 5-minute ones", () => {
    const readings: HostReadings = scan([
      gauge("system.cpu.load_average.1m", [{ asDouble: 12 }]),
      gauge("system.cpu.load_average.5m", [{ asDouble: 10 }]),
      gauge("system.cpu.load_average.15m", [{ asDouble: 7.456 }]),
    ]);
    expect(readings.loadAverage15m).toBe(7.46);
  });

  test("a host started when its reading was taken, minus its uptime", () => {
    const readings: HostReadings = scan([
      gauge("system.uptime", [{ asDouble: 3 * 24 * 3600 + 0.4 }]),
    ]);
    expect(readings.bootedAt?.toISOString()).toBe(
      new Date(SCRAPE_MS - 3 * 24 * 3600 * 1000).toISOString(),
    );
  });

  test("two reports of one boot name the same second", () => {
    const first: HostReadings = scan([
      gauge("system.uptime", [
        { asDouble: 600.2, timeUnixNano: `${SCRAPE_MS}000000` },
      ]),
    ]);
    const second: HostReadings = scan([
      gauge("system.uptime", [
        { asDouble: 630.4, timeUnixNano: `${SCRAPE_MS + 30_000}000000` },
      ]),
    ]);
    expect(first.bootedAt?.getTime()).toBe(second.bootedAt?.getTime());
  });

  test("dates an uptime with no time of its own by when the batch arrived", () => {
    const readings: HostReadings = scan([
      gauge("system.uptime", [{ asDouble: 60, timeUnixNano: "" }]),
    ]);
    expect(readings.bootedAt?.getTime()).toBe(
      Math.round((RECEIVED_AT.getTime() - 60_000) / 1000) * 1000,
    );
  });

  test("ignores a negative load or uptime", () => {
    const readings: HostReadings = scan([
      gauge("system.cpu.load_average.15m", [{ asDouble: -1 }]),
      gauge("system.uptime", [{ asDouble: -5 }]),
    ]);
    expect(readings.loadAverage15m).toBeUndefined();
    expect(readings.bootedAt).toBeUndefined();
  });
});

describe("HostReadingsScan: systemd units", () => {
  test("a unit whose failed state is 1 is a failed unit, by its name", () => {
    expect(systemdUnit("nginx.service", "failed").failedSystemdUnits).toEqual([
      "nginx.service",
    ]);
  });

  test("an active unit reports that none failed - an empty list, not none", () => {
    expect(systemdUnit("sshd.service", "active").failedSystemdUnits).toEqual(
      [],
    );
  });

  test("a batch without units says nothing about them", () => {
    expect(
      scan([gauge("system.cpu.load_average.15m", [{ asDouble: 1 }])])
        .failedSystemdUnits,
    ).toBeUndefined();
  });

  test("a failed unit without a name is not counted as one", () => {
    const readings: HostReadings = scanHostReadings({
      resourceAttributes: attributes({ "host.name": "web-01" }),
      scopeMetrics: scopeMetrics([
        sum("systemd.unit.state", [
          {
            attributes: { "systemd.unit.active_state": "failed" },
            asInt: 1,
          },
        ]),
      ]),
      receivedAt: RECEIVED_AT,
    });
    expect(readings.failedSystemdUnits).toEqual([]);
  });
});

describe("HostReadingsScan: what it does not read", () => {
  test("reads only the metrics it lists", () => {
    expect(Array.from(HOST_READING_METRIC_NAMES).sort()).toEqual([
      "system.cpu.load_average.15m",
      "system.cpu.utilization",
      "system.filesystem.inodes.usage",
      "system.filesystem.usage",
      "system.filesystem.utilization",
      "system.memory.usage",
      "system.memory.utilization",
      "system.paging.usage",
      "system.uptime",
      "systemd.unit.state",
    ]);
  });

  test("a process scraper's metrics give no reading", () => {
    const readings: HostReadings = scan(
      [
        gauge("process.cpu.utilization", [
          { attributes: { state: "user" }, asDouble: 0.9 },
        ]),
        sum("process.memory.usage", [{ asInt: 4 * GIB }]),
      ],
      { "host.name": "web-01", "process.pid": 42 },
    );
    expect(hasHostReadings(readings)).toBe(false);
  });

  test("malformed payloads give no reading and never throw", () => {
    const shapes: Array<JSONArray | undefined> = [
      undefined,
      [],
      [{ metrics: null } as unknown as JSONObject],
      [{ metrics: [null, 5, "x"] } as unknown as JSONObject],
      [
        {
          metrics: [
            { name: "system.cpu.utilization" },
            { name: "system.filesystem.usage", sum: { dataPoints: "x" } },
            {
              name: "system.uptime",
              gauge: { dataPoints: [null, { asDouble: "nope" }] },
            },
          ],
        } as unknown as JSONObject,
      ],
    ];
    for (const shape of shapes) {
      expect(
        hasHostReadings(
          scanHostReadings({
            resourceAttributes: [],
            scopeMetrics: shape,
            receivedAt: RECEIVED_AT,
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("HostReadingsScan: one host's readings across a batch", () => {
  test("keeps the first reading of each kind and the fuller disk", () => {
    const cpu: HostReadings = { cpuPercent: 20, diskPercent: 50 };
    const memory: HostReadings = {
      cpuPercent: 99,
      memoryPercent: 60,
      diskPercent: 70,
      diskMountpoint: "/var",
    };
    const merged: HostReadings = mergeHostReadings(cpu, memory);
    expect(merged.cpuPercent).toBe(20);
    expect(merged.memoryPercent).toBe(60);
    expect(merged.diskPercent).toBe(70);
    expect(merged.diskMountpoint).toBe("/var");
  });

  test("keeps the fuller inode count with its own mount", () => {
    const merged: HostReadings = mergeHostReadings(
      { inodesPercent: 90, inodesMountpoint: "/a" },
      { inodesPercent: 40, inodesMountpoint: "/b" },
    );
    expect(merged.inodesPercent).toBe(90);
    expect(merged.inodesMountpoint).toBe("/a");
  });

  test("gathers every failed unit of the units the batch carried, sorted", () => {
    let readings: HostReadings = {};
    for (const unit of [
      systemdUnit("zebra.service", "failed"),
      systemdUnit("sshd.service", "active"),
      systemdUnit("nginx.service", "failed"),
      systemdUnit("nginx.service", "failed"),
    ]) {
      readings = mergeHostReadings(readings, unit);
    }
    expect(readings.failedSystemdUnits).toEqual([
      "nginx.service",
      "zebra.service",
    ]);
  });

  test("a resource without units keeps the units another one reported", () => {
    const merged: HostReadings = mergeHostReadings(
      { failedSystemdUnits: ["a.service"] },
      { cpuPercent: 5 },
    );
    expect(merged.failedSystemdUnits).toEqual(["a.service"]);
  });

  test("does not change what it merges into", () => {
    const into: HostReadings = { cpuPercent: 1 };
    mergeHostReadings(into, { memoryPercent: 2 });
    expect(into).toEqual({ cpuPercent: 1 });
  });
});

describe("HostReadingsScan: the columns the readings are stored in", () => {
  test("each reading has its Host column", () => {
    const bootedAt: Date = new Date(SCRAPE_MS - 3600_000);
    const columns: HostReadingColumns = toHostReadingColumns({
      cpuPercent: 12.5,
      memoryPercent: 40,
      swapPercent: 3,
      diskPercent: 91,
      diskMountpoint: "/var",
      inodesPercent: 50,
      inodesMountpoint: "/",
      loadAverage15m: 0.8,
      bootedAt: bootedAt,
      failedSystemdUnits: ["b.service", "a.service"],
    });
    expect(columns).toEqual({
      latestCpuPercent: 12.5,
      latestMemoryPercent: 40,
      latestSwapPercent: 3,
      latestDiskPercent: 91,
      latestDiskMountpoint: "/var",
      latestInodesPercent: 50,
      latestInodesMountpoint: "/",
      latestLoadAverage15m: 0.8,
      bootedAt: bootedAt,
      failedSystemdUnitCount: 2,
      failedSystemdUnits: ["a.service", "b.service"],
    });
  });

  test("sets only what was read", () => {
    expect(toHostReadingColumns({ cpuPercent: 5 })).toEqual({
      latestCpuPercent: 5,
    });
    expect(toHostReadingColumns({})).toEqual({});
  });

  test("no failed unit is stored as none, not left as it was", () => {
    expect(toHostReadingColumns({ failedSystemdUnits: [] })).toEqual({
      failedSystemdUnitCount: 0,
      failedSystemdUnits: [],
    });
  });

  test("counts every failed unit and keeps the first names", () => {
    const names: Array<string> = [];
    for (let index: number = 0; index < 35; index++) {
      names.push(`unit-${String(index).padStart(2, "0")}.service`);
    }
    const columns: HostReadingColumns = toHostReadingColumns({
      failedSystemdUnits: names,
    });
    expect(columns.failedSystemdUnitCount).toBe(35);
    expect(columns.failedSystemdUnits).toHaveLength(
      HOST_FAILED_SYSTEMD_UNITS_KEPT,
    );
    expect(columns.failedSystemdUnits?.[0]).toBe("unit-00.service");
  });
});

describe("readAttribute", () => {
  test("reads a string, an integer, a double and a boolean", () => {
    const list: JSONArray = attributes({
      text: "a",
      whole: 3,
      fraction: 0.5,
      flag: true,
    });
    expect(readAttribute(list, "text")).toBe("a");
    expect(readAttribute(list, "whole")).toBe("3");
    expect(readAttribute(list, "fraction")).toBe("0.5");
    expect(readAttribute(list, "flag")).toBe("true");
    expect(readAttribute(list, "missing")).toBeNull();
  });

  test("is null for anything that is not an attribute list", () => {
    expect(readAttribute(undefined, "a")).toBeNull();
    expect(readAttribute({ key: "a" } as unknown as JSONArray, "a")).toBeNull();
    expect(
      readAttribute([{ key: "a", value: null } as unknown as JSONObject], "a"),
    ).toBeNull();
  });
});
