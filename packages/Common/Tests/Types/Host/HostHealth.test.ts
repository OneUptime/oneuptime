import { describe, expect, test } from "@jest/globals";
import {
  HOST_DISK_FULL_PERCENT,
  HOST_DISK_NEAR_FULL_PERCENT,
  HOST_FIRST_DATA_GRACE_MS,
  HOST_INODES_FULL_PERCENT,
  HOST_INODES_NEAR_FULL_PERCENT,
  HOST_LOAD_PER_CORE_HIGH,
  HOST_MEMORY_CRITICAL_PERCENT,
  HOST_MEMORY_HIGH_PERCENT,
  HOST_READINGS_STALE_MS,
  HOST_SWAP_HIGH_PERCENT,
  HostFinding,
  HostHealthAssessment,
  HostHealthRow,
  HostHealthSeverity,
  HostHealthText,
  assessHost,
  compareHostsByUrgency,
  formatHostLoad,
  formatHostPercent,
  hasFreshHostReadings,
  isHostReporting,
  toHostDate,
  toHostNumber,
} from "../../../Types/Host/HostHealth";
import { HostCollectorConfigStatus } from "../../../Types/HostCollector/HostCollector";

/*
 * What on a host needs someone, and how bad it is (HostHealth): the one set
 * of rules the Hosts list, its Needs attention card, a host's hero and page,
 * its Topology and the server's read of the hosts that may need attention
 * all follow. Every rule at both of its bounds, what a host that stopped
 * reporting says (only that), readings too old to judge, a host still
 * starting, the collector's rules, and the order findings and hosts come in.
 */

const NOW: Date = new Date("2026-11-02T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

// A host that reports, with fresh readings that need nothing.
function healthyRow(extra: Partial<HostHealthRow> = {}): HostHealthRow {
  return {
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    readingsUpdatedAt: minutesAgo(1),
    cpuCores: 4,
    latestCpuPercent: 35,
    latestMemoryPercent: 50,
    latestSwapPercent: 0,
    latestDiskPercent: 40,
    latestDiskMountpoint: "/",
    latestInodesPercent: 10,
    latestInodesMountpoint: "/",
    latestLoadAverage15m: 1.2,
    failedSystemdUnitCount: 0,
    failedSystemdUnits: [],
    ...extra,
  };
}

function assess(row: HostHealthRow): HostHealthAssessment {
  return assessHost(row, { now: NOW });
}

// Each reason as an English reader sees it: "one" for a count of 1.
function texts(reasons: Array<HostHealthText>): Array<string> {
  return reasons.map((reason: HostHealthText): string => {
    let text: string =
      reason.plural && reason.plural.count === 1
        ? reason.plural.one
        : reason.text;
    for (const key of Object.keys(reason.values || {})) {
      text = text.split(`{{${key}}}`).join(reason.values![key]!);
    }
    if (reason.plural) {
      text = text.split("{{count}}").join(String(reason.plural.count));
    }
    return text;
  });
}

function findingKeys(assessment: HostHealthAssessment): Array<string> {
  return assessment.findings.map((finding: HostFinding): string => {
    return finding.key;
  });
}

describe("HostHealth: a healthy host", () => {
  test("says Healthy, positive, with nothing to look at", () => {
    const assessment: HostHealthAssessment = assess(healthyRow());
    expect(assessment.state).toBe("healthy");
    expect(assessment.status.text).toBe("Healthy");
    expect(assessment.tone).toBe("positive");
    expect(assessment.severity).toBeNull();
    expect(assessment.findings).toEqual([]);
    expect(assessment.fleetReasons).toEqual([]);
    expect(assessment.isReporting).toBe(true);
    expect(assessment.hasFreshReadings).toBe(true);
  });

  test("a busy CPU is a host doing its work, never a finding", () => {
    expect(assess(healthyRow({ latestCpuPercent: 100 })).state).toBe("healthy");
  });

  test("reads Postgres numerics written as text", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({ latestDiskPercent: "96.4", latestDiskMountpoint: "/var" }),
    );
    expect(assessment.state).toBe("unhealthy");
    expect(texts(assessment.fleetReasons)).toEqual(["/var 96% full"]);
  });
});

describe("HostHealth: filesystems", () => {
  test("a filesystem at the warning line is fine, just above it needs a look", () => {
    expect(
      assess(healthyRow({ latestDiskPercent: HOST_DISK_NEAR_FULL_PERCENT }))
        .state,
    ).toBe("healthy");
    const warning: HostHealthAssessment = assess(
      healthyRow({
        latestDiskPercent: HOST_DISK_NEAR_FULL_PERCENT + 0.5,
        latestDiskMountpoint: "/var",
      }),
    );
    expect(warning.state).toBe("degraded");
    expect(warning.findings[0]).toMatchObject({
      key: "filesystem:/var",
      part: "filesystem",
      name: "/var",
      severity: HostHealthSeverity.Warning,
    });
    expect(texts(warning.findings[0]!.reasons)).toEqual(["86% full"]);
    expect(texts(warning.fleetReasons)).toEqual(["/var 86% full"]);
  });

  test("a filesystem past 95% is critical", () => {
    expect(
      assess(healthyRow({ latestDiskPercent: HOST_DISK_FULL_PERCENT })).state,
    ).toBe("degraded");
    const critical: HostHealthAssessment = assess(
      healthyRow({ latestDiskPercent: HOST_DISK_FULL_PERCENT + 1 }),
    );
    expect(critical.state).toBe("unhealthy");
    expect(critical.tone).toBe("danger");
    expect(critical.severity).toBe(HostHealthSeverity.Critical);
  });

  test("inodes have their own lines, said as inodes", () => {
    expect(
      assess(healthyRow({ latestInodesPercent: HOST_INODES_NEAR_FULL_PERCENT }))
        .state,
    ).toBe("healthy");
    const warning: HostHealthAssessment = assess(
      healthyRow({
        latestInodesPercent: HOST_INODES_NEAR_FULL_PERCENT + 1,
        latestInodesMountpoint: "/var/spool",
      }),
    );
    expect(warning.state).toBe("degraded");
    expect(texts(warning.findings[0]!.reasons)).toEqual(["86% of inodes used"]);
    expect(texts(warning.fleetReasons)).toEqual([
      "/var/spool: 86% of inodes used",
    ]);
    expect(
      assess(healthyRow({ latestInodesPercent: HOST_INODES_FULL_PERCENT + 1 }))
        .severity,
    ).toBe(HostHealthSeverity.Critical);
  });

  test("a mount that is both full and out of inodes is one finding with both reasons", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        latestDiskPercent: 88,
        latestDiskMountpoint: "/var",
        latestInodesPercent: 97,
        latestInodesMountpoint: "/var",
      }),
    );
    expect(findingKeys(assessment)).toEqual(["filesystem:/var"]);
    expect(assessment.findings[0]!.severity).toBe(HostHealthSeverity.Critical);
    expect(texts(assessment.findings[0]!.reasons)).toEqual([
      "88% full",
      "97% of inodes used",
    ]);
  });

  test("two mounts are two findings, the worse one first", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        latestDiskPercent: 88,
        latestDiskMountpoint: "/data",
        latestInodesPercent: 99,
        latestInodesMountpoint: "/var",
      }),
    );
    expect(findingKeys(assessment)).toEqual([
      "filesystem:/var",
      "filesystem:/data",
    ]);
  });

  test("a full disk with no mount point named still says how full", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({ latestDiskPercent: 99, latestDiskMountpoint: null }),
    );
    expect(texts(assessment.fleetReasons)).toEqual(["99% full"]);
  });
});

describe("HostHealth: memory, swap and load", () => {
  test("memory past 90% needs a look, past 95% is critical", () => {
    expect(
      assess(healthyRow({ latestMemoryPercent: HOST_MEMORY_HIGH_PERCENT }))
        .state,
    ).toBe("healthy");
    const warning: HostHealthAssessment = assess(
      healthyRow({ latestMemoryPercent: HOST_MEMORY_HIGH_PERCENT + 2 }),
    );
    expect(warning.state).toBe("degraded");
    expect(warning.findings[0]).toMatchObject({ key: "host", part: "host" });
    expect(texts(warning.fleetReasons)).toEqual(["Memory 92% used"]);
    expect(
      assess(healthyRow({ latestMemoryPercent: HOST_MEMORY_CRITICAL_PERCENT }))
        .severity,
    ).toBe(HostHealthSeverity.Warning);
    expect(
      assess(
        healthyRow({ latestMemoryPercent: HOST_MEMORY_CRITICAL_PERCENT + 1 }),
      ).severity,
    ).toBe(HostHealthSeverity.Critical);
  });

  test("swap past 80% needs a look; a host with no swap has none to judge", () => {
    expect(
      assess(healthyRow({ latestSwapPercent: HOST_SWAP_HIGH_PERCENT })).state,
    ).toBe("healthy");
    const warning: HostHealthAssessment = assess(
      healthyRow({ latestSwapPercent: 91 }),
    );
    expect(warning.severity).toBe(HostHealthSeverity.Warning);
    expect(texts(warning.fleetReasons)).toEqual(["Swap 91% used"]);
    expect(assess(healthyRow({ latestSwapPercent: null })).state).toBe(
      "healthy",
    );
  });

  test("a 15-minute load above twice the cores needs a look", () => {
    expect(
      assess(
        healthyRow({
          cpuCores: 4,
          latestLoadAverage15m: 4 * HOST_LOAD_PER_CORE_HIGH,
        }),
      ).state,
    ).toBe("healthy");
    const warning: HostHealthAssessment = assess(
      healthyRow({ cpuCores: 4, latestLoadAverage15m: 9.64 }),
    );
    expect(warning.severity).toBe(HostHealthSeverity.Warning);
    expect(texts(warning.fleetReasons)).toEqual(["Load 9.6 on 4 cores"]);
    const reason: HostHealthText = warning.fleetReasons[0]!;
    expect(reason.plural).toEqual({
      one: "Load {{load}} on {{count}} core",
      count: 4,
    });
  });

  test("a load is judged against the cores, so a big host is not overloaded at 9", () => {
    expect(
      assess(healthyRow({ cpuCores: 32, latestLoadAverage15m: 9 })).state,
    ).toBe("healthy");
  });

  test("without a core count the load is not judged", () => {
    expect(
      assess(healthyRow({ cpuCores: null, latestLoadAverage15m: 50 })).state,
    ).toBe("healthy");
    expect(
      assess(healthyRow({ cpuCores: 0, latestLoadAverage15m: 50 })).state,
    ).toBe("healthy");
  });

  test("memory, swap and load are one finding about the host, worst first", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        latestMemoryPercent: 97,
        latestSwapPercent: 85,
        latestLoadAverage15m: 12,
        cpuCores: 4,
      }),
    );
    expect(findingKeys(assessment)).toEqual(["host"]);
    expect(assessment.findings[0]!.severity).toBe(HostHealthSeverity.Critical);
    expect(texts(assessment.findings[0]!.reasons)).toEqual([
      "Memory 97% used",
      "Swap 85% used",
      "Load 12.0 on 4 cores",
    ]);
  });
});

describe("HostHealth: systemd units", () => {
  test("each failed unit the record names is a finding of its own", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        failedSystemdUnitCount: 2,
        failedSystemdUnits: ["nginx.service", "backup.service"],
      }),
    );
    expect(assessment.state).toBe("degraded");
    expect(findingKeys(assessment)).toEqual([
      "systemd-unit:backup.service",
      "systemd-unit:nginx.service",
    ]);
    expect(texts(assessment.findings[0]!.reasons)).toEqual(["Failed"]);
  });

  test("a list of hosts counts them once, however many failed", () => {
    const names: Array<string> = [];
    for (let index: number = 0; index < 20; index++) {
      names.push(`unit-${index}.service`);
    }
    const assessment: HostHealthAssessment = assess(
      healthyRow({ failedSystemdUnitCount: 34, failedSystemdUnits: names }),
    );
    expect(texts(assessment.fleetReasons)).toEqual(["34 failed systemd units"]);
    expect(assessment.fleetReasons[0]!.plural).toEqual({
      one: "{{count}} failed systemd unit",
      count: 34,
    });
  });

  test("a count without names is still one finding", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({ failedSystemdUnitCount: 1, failedSystemdUnits: null }),
    );
    expect(findingKeys(assessment)).toEqual(["systemd-units"]);
    expect(texts(assessment.findings[0]!.reasons)).toEqual([
      "1 failed systemd unit",
    ]);
  });

  test("no failed unit is no finding", () => {
    expect(assess(healthyRow({ failedSystemdUnitCount: 0 })).state).toBe(
      "healthy",
    );
  });
});

describe("HostHealth: the collector OneUptime manages", () => {
  test("a config that did not start needs a look", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        collectorInstanceUid: "abc",
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
      }),
    );
    expect(assessment.state).toBe("degraded");
    expect(assessment.findings[0]).toMatchObject({
      key: "collector",
      part: "collector",
    });
    expect(texts(assessment.findings[0]!.reasons)).toEqual(["Config failed"]);
    expect(texts(assessment.fleetReasons)).toEqual(["Collector config failed"]);
  });

  test("a running config whose collector reports an error needs a look", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        collectorInstanceUid: "abc",
        collectorConfigStatus: HostCollectorConfigStatus.Applied,
        isCollectorHealthy: false,
      }),
    );
    expect(texts(assessment.fleetReasons)).toEqual(["Collector error"]);
  });

  test("a collector installed by hand is never judged", () => {
    expect(
      assess(
        healthyRow({
          collectorInstanceUid: null,
          collectorConfigStatus: HostCollectorConfigStatus.Failed,
          isCollectorHealthy: false,
        }),
      ).state,
    ).toBe("healthy");
  });

  test("a config being applied is no finding", () => {
    expect(
      assess(
        healthyRow({
          collectorInstanceUid: "abc",
          collectorConfigStatus: HostCollectorConfigStatus.Applying,
          isCollectorHealthy: false,
        }),
      ).state,
    ).toBe("healthy");
  });
});

describe("HostHealth: a host that is not reporting", () => {
  test("is critical, Not reporting, and nothing else", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(180),
        // What it said three hours ago is no longer the truth.
        latestDiskPercent: 99,
        latestMemoryPercent: 99,
        failedSystemdUnitCount: 3,
      }),
    );
    expect(assessment.state).toBe("not-reporting");
    expect(assessment.status.text).toBe("Not reporting");
    expect(assessment.tone).toBe("danger");
    expect(assessment.severity).toBe(HostHealthSeverity.Critical);
    expect(findingKeys(assessment)).toEqual(["host"]);
    expect(texts(assessment.fleetReasons)).toEqual(["Not reporting"]);
    expect(assessment.isReporting).toBe(false);
    expect(assessment.hasFreshReadings).toBe(false);
  });

  test("a status the collector wrote in capitals reads the same", () => {
    expect(isHostReporting({ otelCollectorStatus: "Connected" })).toBe(true);
    expect(isHostReporting({ otelCollectorStatus: "active" })).toBe(true);
    expect(isHostReporting({ otelCollectorStatus: "disconnected" })).toBe(
      false,
    );
    expect(isHostReporting({ otelCollectorStatus: null })).toBe(false);
  });
});

describe("HostHealth: a host that never reported", () => {
  test("is starting for ten minutes after its collector registered", () => {
    const assessment: HostHealthAssessment = assess({
      otelCollectorStatus: null,
      lastSeenAt: null,
      collectorInstanceUid: "abc",
      collectorRegisteredAt: minutesAgo(3),
    });
    expect(assessment.state).toBe("starting");
    expect(assessment.status.text).toBe("Starting");
    expect(assessment.severity).toBeNull();
    expect(assessment.findings).toEqual([]);
  });

  test("then waits for data, which needs a look", () => {
    const assessment: HostHealthAssessment = assess({
      otelCollectorStatus: null,
      lastSeenAt: null,
      collectorInstanceUid: "abc",
      collectorRegisteredAt: new Date(
        NOW.getTime() - HOST_FIRST_DATA_GRACE_MS - MINUTE,
      ),
    });
    expect(assessment.state).toBe("no-data");
    expect(assessment.status.text).toBe("No data yet");
    expect(assessment.severity).toBe(HostHealthSeverity.Warning);
    expect(texts(assessment.fleetReasons)).toEqual(["No data yet"]);
  });

  test("a host added without a collector counts from when it was added", () => {
    expect(assess({ lastSeenAt: null, createdAt: minutesAgo(2) }).state).toBe(
      "starting",
    );
    expect(assess({ lastSeenAt: null, createdAt: minutesAgo(60) }).state).toBe(
      "no-data",
    );
  });
});

describe("HostHealth: readings too old to judge", () => {
  test("a reporting host whose readings are stale says Reporting, not Healthy", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        readingsUpdatedAt: new Date(
          NOW.getTime() - HOST_READINGS_STALE_MS - MINUTE,
        ),
        latestDiskPercent: 99,
      }),
    );
    expect(assessment.state).toBe("reporting");
    expect(assessment.status.text).toBe("Reporting");
    expect(assessment.tone).toBe("neutral");
    expect(assessment.findings).toEqual([]);
  });

  test("a reporting host that never sent readings says Reporting", () => {
    expect(
      assess({ otelCollectorStatus: "connected", lastSeenAt: minutesAgo(1) })
        .state,
    ).toBe("reporting");
  });

  test("its collector's failed config still counts: it is not a reading", () => {
    const assessment: HostHealthAssessment = assess({
      otelCollectorStatus: "connected",
      lastSeenAt: minutesAgo(1),
      collectorInstanceUid: "abc",
      collectorConfigStatus: HostCollectorConfigStatus.Failed,
    });
    expect(assessment.state).toBe("degraded");
  });

  test("readings exactly fifteen minutes old are still judged", () => {
    expect(
      hasFreshHostReadings(
        { readingsUpdatedAt: new Date(NOW.getTime() - HOST_READINGS_STALE_MS) },
        NOW,
      ),
    ).toBe(true);
    expect(hasFreshHostReadings({ readingsUpdatedAt: null }, NOW)).toBe(false);
  });
});

describe("HostHealth: order", () => {
  test("findings come critical first, then the host before its parts", () => {
    const assessment: HostHealthAssessment = assess(
      healthyRow({
        latestMemoryPercent: 92,
        latestDiskPercent: 99,
        latestDiskMountpoint: "/var",
        failedSystemdUnitCount: 1,
        failedSystemdUnits: ["nginx.service"],
        collectorInstanceUid: "abc",
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
      }),
    );
    expect(findingKeys(assessment)).toEqual([
      "filesystem:/var",
      "host",
      "collector",
      "systemd-unit:nginx.service",
    ]);
    expect(texts(assessment.fleetReasons)).toEqual([
      "/var 99% full",
      "Memory 92% used",
      "Collector config failed",
      "1 failed systemd unit",
    ]);
  });

  test("hosts come critical first, then by how much is wrong, then by name", () => {
    const hosts: Array<{ assessment: HostHealthAssessment; name: string }> = [
      { name: "web-10", assessment: assess(healthyRow()) },
      {
        name: "web-2",
        assessment: assess(healthyRow({ latestMemoryPercent: 92 })),
      },
      {
        name: "db-1",
        assessment: assess(
          healthyRow({ latestMemoryPercent: 92, latestSwapPercent: 90 }),
        ),
      },
      {
        name: "web-1",
        assessment: assess(
          healthyRow({
            otelCollectorStatus: "disconnected",
            lastSeenAt: minutesAgo(30),
          }),
        ),
      },
      { name: "web-9", assessment: assess(healthyRow()) },
    ];
    expect(
      [...hosts]
        .sort(compareHostsByUrgency)
        .map((host: { name: string }): string => {
          return host.name;
        }),
    ).toEqual(["web-1", "db-1", "web-2", "web-9", "web-10"]);
  });
});

describe("HostHealth: values", () => {
  test("percents and loads are written the way the reasons say them", () => {
    expect(formatHostPercent(96.4)).toBe("96%");
    expect(formatHostPercent(85.5)).toBe("86%");
    expect(formatHostLoad(9.64)).toBe("9.6");
    expect(formatHostLoad(12)).toBe("12.0");
  });

  test("numbers and dates are read whatever form they arrive in", () => {
    expect(toHostNumber("12.5")).toBe(12.5);
    expect(toHostNumber(3)).toBe(3);
    expect(toHostNumber("")).toBeNull();
    expect(toHostNumber("abc")).toBeNull();
    expect(toHostNumber(null)).toBeNull();
    expect(toHostDate("2026-11-02T10:00:00.000Z")?.getTime()).toBe(
      NOW.getTime(),
    );
    expect(toHostDate("not a date")).toBeNull();
    expect(toHostDate(undefined)).toBeNull();
  });

  test("the thresholds are the ones the docs and the alerts state", () => {
    expect({
      disk: [HOST_DISK_NEAR_FULL_PERCENT, HOST_DISK_FULL_PERCENT],
      inodes: [HOST_INODES_NEAR_FULL_PERCENT, HOST_INODES_FULL_PERCENT],
      memory: [HOST_MEMORY_HIGH_PERCENT, HOST_MEMORY_CRITICAL_PERCENT],
      swap: HOST_SWAP_HIGH_PERCENT,
      loadPerCore: HOST_LOAD_PER_CORE_HIGH,
      staleMinutes: HOST_READINGS_STALE_MS / MINUTE,
      graceMinutes: HOST_FIRST_DATA_GRACE_MS / MINUTE,
    }).toEqual({
      disk: [85, 95],
      inodes: [85, 95],
      memory: [90, 95],
      swap: 80,
      loadPerCore: 2,
      staleMinutes: 15,
      graceMinutes: 10,
    });
  });
});
