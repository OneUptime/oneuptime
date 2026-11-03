import { describe, expect, test } from "@jest/globals";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import Route from "../../../Types/API/Route";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  CEPH_CHECK_AS_WRITTEN,
  CEPH_CLUSTER_ATTENTION_KEY,
  CEPH_CLUSTER_FULL_PERCENT,
  CEPH_CLUSTER_NEARFULL_PERCENT,
  CEPH_OSD_BACKFILLFULL_PERCENT,
  CEPH_OSD_FULL_PERCENT,
  CEPH_OSD_LATENCY_WARNING_MS,
  CEPH_OSD_NEARFULL_PERCENT,
  CEPH_POOL_FULL_PERCENT,
  CEPH_POOL_NEARFULL_PERCENT,
  CEPH_READINGS_STALE_MS,
  CEPH_STOPPED_REPORTING_MS,
  CephAssessment,
  CephPartKind,
  assessCephCluster,
  assessCephDaemon,
  assessCephMon,
  assessCephOsd,
  assessCephPool,
  formatCephPercent,
  getCephAttentionItems,
  getCephHealth,
  getCephNewestSeenAt,
  getCephOsdReadings,
  getCephPoolReadings,
  getCephStatusReasons,
  getCephTopologyHealth,
  isCephIssueAbout,
  isCephOsdOutStatus,
  isCephStoppedReporting,
  sortCephHealthChecks,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephHealth";
import { getCephOsdPlacementBadge } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephPartFacts";
import { ResourcePartBadge } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CephMetricDescriptions";
import {
  getAllCephAlertTemplates,
  CephAlertTemplate,
} from "../../../Types/Monitor/CephAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";

/*
 * What in a Ceph cluster needs someone, and how bad it is
 * (Pages/Ceph/Utils/CephHealth): the rules the cluster's Overview, its
 * lists, an OSD's and a pool's page and its Topology all read. Each line is
 * the one its alert template fires at, and Ceph's own words - a check's
 * code, HEALTH_WARN - are kept as Ceph writes them. A wrong rule fails
 * quietly: an OSD that is down but still in the cluster drawn in amber, a
 * pool a few points from full in green - so each is pinned here.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

interface RowFields {
  kind: string;
  externalId: string;
  name: string;
  hostname: string;
  deviceClass: string;
  isUp: boolean;
  isIn: boolean;
  inQuorum: boolean;
  statBytes: number;
  statBytesUsed: number;
  applyLatencyMs: number;
  commitLatencyMs: number;
  pgCount: number;
  storedBytes: number;
  maxAvailBytes: number;
  objects: number;
  metricsUpdatedAt: Date;
  lastSeenAt: Date;
}

// Each field left out, or given as undefined: a reading not in yet.
type RowInit = { [K in keyof RowFields]?: RowFields[K] | undefined };

function row(init: RowInit): CephResource {
  return Object.assign(new CephResource(), init);
}

function osd(id: number, init: RowInit = {}): CephResource {
  return row({
    kind: "Osd",
    externalId: `osd.${id}`,
    hostname: "ceph-a",
    deviceClass: "ssd",
    isUp: true,
    isIn: true,
    statBytes: 1000 * GIB,
    statBytesUsed: 400 * GIB,
    applyLatencyMs: 4,
    commitLatencyMs: 5,
    pgCount: 100,
    metricsUpdatedAt: minutesBefore(1),
    lastSeenAt: minutesBefore(1),
    ...init,
  });
}

// A share of the OSD's 1000 GiB used, as its row reports it.
function osdAt(percent: number): CephResource {
  return osd(1, { statBytesUsed: (percent / 100) * 1000 * GIB });
}

function pool(id: string, init: RowInit = {}): CephResource {
  return row({
    kind: "Pool",
    externalId: id,
    name: `pool-${id}`,
    storedBytes: 300 * GIB,
    maxAvailBytes: 700 * GIB,
    objects: 1000,
    metricsUpdatedAt: minutesBefore(1),
    lastSeenAt: minutesBefore(1),
    ...init,
  });
}

// A pool with this share of its writable space used.
function poolAt(percent: number): CephResource {
  return pool("1", {
    storedBytes: percent * GIB,
    maxAvailBytes: (100 - percent) * GIB,
  });
}

function mon(name: string, init: RowInit = {}): CephResource {
  return row({
    kind: "Mon",
    externalId: `mon.${name}`,
    hostname: `ceph-${name}`,
    inQuorum: true,
    lastSeenAt: minutesBefore(1),
    ...init,
  });
}

function texts(reasons: Array<ResourceAttentionText>): Array<string> {
  return reasons.map((reason: ResourceAttentionText): string => {
    return reason.text;
  });
}

function routeFor(kind: CephPartKind, externalId: string): Route {
  return new Route(`/ceph/${kind.toLowerCase()}/${externalId}`);
}

const FRESH: { now: Date; newestSeenAt: Date } = {
  now: NOW,
  newestSeenAt: minutesBefore(1),
};

function record(seriesLabels: Record<string, unknown>): OpenIssueRecord {
  return { seriesLabels: seriesLabels } as unknown as OpenIssueRecord;
}

// A template's monitor step, as the cluster's Recommendations create it.
function stepOf(template: CephAlertTemplate): MonitorStep {
  return template.getMonitorStep({
    clusterIdentifier: "ceph-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "ceph-prod",
  });
}

function templateById(id: string): CephAlertTemplate {
  return getAllCephAlertTemplates().find(
    (template: CephAlertTemplate): boolean => {
      return template.id === id;
    },
  )!;
}

// The labels a template's queries group by: one incident per value.
function groupingsOf(template: CephAlertTemplate): Array<string> {
  const queryConfigs: Array<{
    metricQueryData: { groupByAttributeKeys?: Array<string> };
  }> = (stepOf(template).data?.cephMonitor?.metricViewConfig.queryConfigs ||
    []) as unknown as Array<{
    metricQueryData: { groupByAttributeKeys?: Array<string> };
  }>;
  return queryConfigs.flatMap(
    (queryConfig: {
      metricQueryData: { groupByAttributeKeys?: Array<string> };
    }): Array<string> => {
      return queryConfig.metricQueryData.groupByAttributeKeys || [];
    },
  );
}

// The value its first (firing) criteria instance compares with.
function firingLineOf(template: CephAlertTemplate): unknown {
  const instances: Array<MonitorCriteriaInstance> =
    stepOf(template).data?.monitorCriteria.data?.monitorCriteriaInstanceArray ||
    [];
  return instances[0]?.data?.filters?.[0]?.value;
}

describe("an OSD", () => {
  test("up and in, with room and fast writes: Up, in green, nothing to say", () => {
    const assessment: CephAssessment = assessCephOsd(osd(1), FRESH);
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({ label: "Up", tone: "positive" });
    expect(assessment.reasons).toEqual([]);
  });

  test("down while still in the cluster is critical: its placement groups run a copy short", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(3, { isUp: false, isIn: true }),
      FRESH,
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.status).toEqual({ label: "Down", tone: "danger" });
    expect(texts(assessment.reasons)).toEqual(["Down, still in the cluster"]);
  });

  test("down with no word on placement yet is still taken as in: the worse case", () => {
    expect(
      assessCephOsd(osd(3, { isUp: false, isIn: undefined }), FRESH).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("down and out needs a look: Ceph has moved its data, the disk still wants replacing", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(3, { isUp: false, isIn: false }),
      FRESH,
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status).toEqual({
      label: "Down and out",
      tone: "warning",
    });
    expect(texts(assessment.reasons)).toEqual(["Down and out of the cluster"]);
  });

  test("up but out of the cluster needs a look, as the OSD Out alert says", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(2, { isIn: false }),
      FRESH,
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status).toEqual({
      label: "Out of cluster",
      tone: "warning",
    });
    expect(texts(assessment.reasons)).toEqual(["Up but out of the cluster"]);
  });

  test("no word on whether it runs yet: No data yet, in grey", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(4, { isUp: undefined }),
      FRESH,
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({
      label: "No data yet",
      tone: "neutral",
    });
  });

  /*
   * Ceph's default ratios: nearfull 0.85 and backfillfull 0.90 raise a
   * warning check, full 0.95 an error one, and the OSD refuses writes.
   */
  test.each([
    [85, null, []],
    [
      85.4,
      ResourceAttentionSeverity.Warning,
      ["{{percent}} used, past the nearfull ratio"],
    ],
    [
      90,
      ResourceAttentionSeverity.Warning,
      ["{{percent}} used, past the nearfull ratio"],
    ],
    [
      90.5,
      ResourceAttentionSeverity.Warning,
      ["{{percent}} used, past the backfillfull ratio"],
    ],
    [
      95,
      ResourceAttentionSeverity.Warning,
      ["{{percent}} used, past the backfillfull ratio"],
    ],
    [
      95.5,
      ResourceAttentionSeverity.Critical,
      ["{{percent}} used, past the full ratio"],
    ],
  ] as Array<[number, ResourceAttentionSeverity | null, Array<string>]>)(
    "%s%% used: %s",
    (
      percent: number,
      severity: ResourceAttentionSeverity | null,
      reasons: Array<string>,
    ) => {
      const assessment: CephAssessment = assessCephOsd(osdAt(percent), FRESH);
      expect(assessment.severity).toBe(severity);
      expect(texts(assessment.reasons)).toEqual(reasons);
      if (reasons.length > 0) {
        expect(assessment.reasons[0]!.values).toEqual({
          percent: formatCephPercent(percent),
        });
        // Still Up: its colour says the rest.
        expect(assessment.status.label).toBe("Up");
        expect(assessment.status.tone).toBe(
          severity === ResourceAttentionSeverity.Critical
            ? "danger"
            : "warning",
        );
      }
    },
  );

  test("the ratios are Ceph's defaults, as the texts say them", () => {
    expect([
      CEPH_OSD_NEARFULL_PERCENT,
      CEPH_OSD_BACKFILLFULL_PERCENT,
      CEPH_OSD_FULL_PERCENT,
    ]).toEqual([85, 90, 95]);
    expect(CEPH_METRIC_DESCRIPTIONS.osdStatusColumn).toContain(
      "past 85% used (Ceph's nearfull ratio)",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.osdStatusColumn).toContain(
      "red past 95% (full)",
    );
  });

  test("an apply latency past 100 ms needs a look, as the OSD High Latency alert says; 100 ms itself does not", () => {
    expect(
      assessCephOsd(
        osd(1, { applyLatencyMs: CEPH_OSD_LATENCY_WARNING_MS }),
        FRESH,
      ).severity,
    ).toBeNull();
    const slow: CephAssessment = assessCephOsd(
      osd(1, { applyLatencyMs: 182.4 }),
      FRESH,
    );
    expect(slow.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(slow.reasons).toEqual([
      { text: "Apply latency {{latency}}", values: { latency: "182 ms" } },
    ]);
  });

  test("a full OSD's reason leads a slow one's: critical first", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(1, { statBytesUsed: 970 * GIB, applyLatencyMs: 300 }),
      FRESH,
    );
    expect(texts(assessment.reasons)).toEqual([
      "{{percent}} used, past the full ratio",
      "Apply latency {{latency}}",
    ]);
  });

  test("a down OSD's last readings say nothing about it now", () => {
    const assessment: CephAssessment = assessCephOsd(
      osd(3, {
        isUp: false,
        isIn: true,
        statBytesUsed: 990 * GIB,
        applyLatencyMs: 900,
      }),
      FRESH,
    );
    expect(texts(assessment.reasons)).toEqual(["Down, still in the cluster"]);
  });

  test("readings older than the cleanup's 15 minutes are no readings", () => {
    expect(CEPH_READINGS_STALE_MS).toBe(15 * MINUTE);
    const stale: CephResource = osd(1, {
      statBytesUsed: 990 * GIB,
      applyLatencyMs: 900,
      metricsUpdatedAt: minutesBefore(16),
    });
    expect(assessCephOsd(stale, FRESH).severity).toBeNull();
    expect(getCephOsdReadings(stale, NOW)).toEqual({
      usedBytes: null,
      totalBytes: null,
      usedPercent: null,
      applyLatencyMs: null,
      commitLatencyMs: null,
      pgCount: null,
    });
    expect(
      getCephOsdReadings(osd(1, { metricsUpdatedAt: minutesBefore(15) }), NOW)
        .usedPercent,
    ).toBe(40);
  });

  test("the numbers the API hands as text are read as numbers", () => {
    const fromJson: CephResource = osd(1);
    (fromJson as unknown as Record<string, unknown>)["statBytes"] = String(
      1000 * GIB,
    );
    (fromJson as unknown as Record<string, unknown>)["statBytesUsed"] = String(
      900 * GIB,
    );
    expect(getCephOsdReadings(fromJson, NOW).usedPercent).toBe(90);
  });
});

/*
 * An OSD's hero puts its placement beside its state. Up and in is good
 * news; still in beside a red Down is what makes it critical, so there it
 * is a fact in grey; and a state that already says it is out ("Out of
 * cluster", "Down and out") takes no badge saying it a second time.
 */
describe("an OSD's placement beside its state", () => {
  function badgeOf(fields: RowInit): ResourcePartBadge | null {
    const row: CephResource = osd(3, fields);
    return getCephOsdPlacementBadge(
      row,
      assessCephOsd(row, FRESH).status.label,
    );
  }

  test("up and in: In cluster, in green", () => {
    expect(badgeOf({ isUp: true, isIn: true })).toEqual({
      key: "placement",
      label: "In cluster",
      tone: "positive",
    });
  });

  test("down but still in: In cluster in grey, never green beside a red Down", () => {
    expect(badgeOf({ isUp: false, isIn: true })).toEqual({
      key: "placement",
      label: "In cluster",
      tone: "neutral",
    });
  });

  test("up but out, and down and out: the state says it, so no badge does", () => {
    expect(badgeOf({ isUp: true, isIn: false })).toBeNull();
    expect(badgeOf({ isUp: false, isIn: false })).toBeNull();
  });

  test("out while its state says something else - it stopped reporting - still says it is out", () => {
    expect(
      getCephOsdPlacementBadge(osd(3, { isIn: false }), "Stopped reporting"),
    ).toEqual({ key: "placement", label: "Out of cluster", tone: "warning" });
  });

  test("no word on its placement: no badge", () => {
    expect(badgeOf({ isIn: undefined })).toBeNull();
  });

  test("which states already name the placement", () => {
    expect(isCephOsdOutStatus("Out of cluster")).toBe(true);
    expect(isCephOsdOutStatus("Down and out")).toBe(true);
    expect(isCephOsdOutStatus("Down")).toBe(false);
    expect(isCephOsdOutStatus("Up")).toBe(false);
    expect(isCephOsdOutStatus(undefined)).toBe(false);
  });
});

describe("a part Ceph stopped listing", () => {
  test("is one the reports since its last have left out for more than 5 minutes", () => {
    expect(CEPH_STOPPED_REPORTING_MS).toBe(5 * MINUTE);
    const newest: Date = minutesBefore(1);
    expect(
      isCephStoppedReporting({ lastSeenAt: minutesBefore(6) }, newest),
    ).toBe(false);
    expect(
      isCephStoppedReporting({ lastSeenAt: minutesBefore(6.1) }, newest),
    ).toBe(true);
    /*
     * Measured against the newest report, not the clock: an agent that
     * stopped leaves its cluster's last picture as it was.
     */
    expect(
      isCephStoppedReporting(
        { lastSeenAt: minutesBefore(600) },
        minutesBefore(599),
      ),
    ).toBe(false);
    expect(isCephStoppedReporting({}, newest)).toBe(false);
  });

  test.each([
    ["an OSD", osd(7, { isUp: false, lastSeenAt: minutesBefore(20) })],
    ["a monitor", mon("c", { inQuorum: false, lastSeenAt: minutesBefore(20) })],
    ["a pool", poolAt(99)],
  ])(
    "%s reads Stopped reporting, in grey, and needs no attention",
    (_name: string, part: CephResource) => {
      part.lastSeenAt = minutesBefore(20);
      const assessment: CephAssessment =
        part.kind === "Osd"
          ? assessCephOsd(part, FRESH)
          : part.kind === "Mon"
            ? assessCephMon(part, FRESH)
            : assessCephPool(part, FRESH);
      expect(assessment.severity).toBeNull();
      expect(assessment.status).toEqual({
        label: "Stopped reporting",
        tone: "neutral",
      });
      expect(assessment.lastReportAt).toEqual(minutesBefore(20));
    },
  );

  test("the newest report is the newest row's", () => {
    expect(
      getCephNewestSeenAt([
        { lastSeenAt: minutesBefore(5) },
        { lastSeenAt: minutesBefore(1) },
        {},
      ]),
    ).toEqual(minutesBefore(1));
    expect(getCephNewestSeenAt([])).toBeNull();
  });
});

describe("a monitor and the other daemons", () => {
  test("a monitor out of quorum is critical, as the Monitor Quorum Degraded alert says", () => {
    const assessment: CephAssessment = assessCephMon(
      mon("b", { inQuorum: false }),
      FRESH,
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.status).toEqual({
      label: "Out of quorum",
      tone: "danger",
    });
    expect(texts(assessment.reasons)).toEqual(["Out of quorum"]);
  });

  test("a monitor in quorum is fine; one with no word yet has No data yet", () => {
    expect(assessCephMon(mon("a"), FRESH).status).toEqual({
      label: "In quorum",
      tone: "positive",
    });
    expect(
      assessCephMon(mon("a", { inQuorum: undefined }), FRESH).status.label,
    ).toBe("No data yet");
  });

  test("a manager, metadata server or gateway reads Reporting while Ceph lists it", () => {
    for (const kind of ["Mgr", "Mds", "Rgw"]) {
      const daemon: CephResource = row({
        kind: kind,
        externalId: `${kind.toLowerCase()}.x`,
        lastSeenAt: minutesBefore(1),
      });
      expect(assessCephDaemon(daemon, FRESH)).toEqual({
        severity: null,
        status: { label: "Reporting", tone: "positive" },
        reasons: [],
      });
    }
  });
});

describe("a pool", () => {
  test("with room and clean placement groups: Available, nothing to say", () => {
    const assessment: CephAssessment = assessCephPool(pool("1"), {
      ...FRESH,
      pgStates: {
        total: 128,
        active: 128,
        clean: 128,
        degraded: 0,
        undersized: 0,
      },
    });
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({ label: "Available", tone: "positive" });
  });

  test.each([
    [85, null],
    [85.5, ResourceAttentionSeverity.Warning],
    [95, ResourceAttentionSeverity.Warning],
    [95.5, ResourceAttentionSeverity.Critical],
  ] as Array<[number, ResourceAttentionSeverity | null]>)(
    "%s%% of its writable space used: %s",
    (percent: number, severity: ResourceAttentionSeverity | null) => {
      const assessment: CephAssessment = assessCephPool(poolAt(percent), FRESH);
      expect(assessment.severity).toBe(severity);
      if (severity) {
        expect(assessment.reasons).toEqual([
          {
            text: "{{percent}} of its writable space used",
            values: { percent: formatCephPercent(percent) },
          },
        ]);
      }
    },
  );

  test("the lines are the Pool Near Full alert's, and the share is its formula", () => {
    expect([CEPH_POOL_NEARFULL_PERCENT, CEPH_POOL_FULL_PERCENT]).toEqual([
      85, 95,
    ]);
    const nearFull: CephAlertTemplate = templateById("ceph-pool-near-full");
    expect(nearFull.description).toContain("85%");
    expect(nearFull.description).toContain(
      "stored ÷ (stored + max_avail) × 100",
    );
    expect(getCephPoolReadings(poolAt(87), NOW).usedPercent).toBeCloseTo(87);
  });

  test("inactive placement groups are critical: I/O to them hangs", () => {
    const assessment: CephAssessment = assessCephPool(pool("1"), {
      ...FRESH,
      pgStates: {
        total: 128,
        active: 125,
        clean: 120,
        degraded: 0,
        undersized: 0,
      },
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.status).toEqual({ label: "Available", tone: "danger" });
    expect(assessment.reasons).toEqual([
      {
        text: "{{count}} placement groups inactive",
        plural: { one: "{{count}} placement group inactive", count: 3 },
      },
    ]);
  });

  test("degraded and undersized placement groups need a look, each said with its count", () => {
    const assessment: CephAssessment = assessCephPool(pool("1"), {
      ...FRESH,
      pgStates: {
        total: 128,
        active: 128,
        clean: 120,
        degraded: 5,
        undersized: 1,
      },
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      {
        text: "{{count}} placement groups degraded",
        plural: { one: "{{count}} placement group degraded", count: 5 },
      },
      {
        text: "{{count}} placement groups undersized",
        plural: { one: "{{count}} placement group undersized", count: 1 },
      },
    ]);
  });

  test("critical reasons lead: inactive placement groups and fullness before degraded ones", () => {
    const assessment: CephAssessment = assessCephPool(poolAt(97), {
      ...FRESH,
      pgStates: {
        total: 64,
        active: 60,
        clean: 50,
        degraded: 4,
        undersized: 0,
      },
    });
    expect(texts(assessment.reasons)).toEqual([
      "{{count}} placement groups inactive",
      "{{percent}} of its writable space used",
      "{{count}} placement groups degraded",
    ]);
  });

  test("with no fresh readings and no placement groups read: No data yet", () => {
    expect(
      assessCephPool(pool("1", { metricsUpdatedAt: minutesBefore(20) }), FRESH)
        .status,
    ).toEqual({ label: "No data yet", tone: "neutral" });
  });
});

describe("the cluster's own verdict", () => {
  test("HEALTH_WARN with its checks: each check is a reason, as Ceph names it, errors first", () => {
    const assessment: CephAssessment = assessCephCluster({
      healthStatus: 1,
      checks: [
        { name: "PG_DEGRADED", severity: "HEALTH_WARN" },
        { name: "OSD_DOWN", severity: "HEALTH_WARN" },
        { name: "PG_DAMAGED", severity: "HEALTH_ERR" },
      ],
      capacityUsedPercent: 40,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status).toEqual({
      label: "HEALTH_WARN",
      tone: "warning",
    });
    expect(assessment.reasons).toEqual(
      ["PG_DAMAGED", "OSD_DOWN", "PG_DEGRADED"].map((check: string) => {
        return { text: CEPH_CHECK_AS_WRITTEN, values: { check: check } };
      }),
    );
  });

  test("a check's code is not a word to translate: its template has no words", () => {
    expect(CEPH_CHECK_AS_WRITTEN).toBe("{{check}}");
  });

  test("HEALTH_ERR is critical; without its checks, the verdict is the reason", () => {
    const assessment: CephAssessment = assessCephCluster({
      healthStatus: 2,
      checks: null,
      capacityUsedPercent: null,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      { text: "Ceph reports {{status}}", values: { status: "HEALTH_ERR" } },
    ]);
  });

  test("HEALTH_OK says nothing, whatever checks a muted or stale read still lists", () => {
    const assessment: CephAssessment = assessCephCluster({
      healthStatus: 0,
      checks: [{ name: "OSD_DOWN", severity: "HEALTH_WARN" }],
      capacityUsedPercent: 40,
    });
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({ label: "HEALTH_OK", tone: "positive" });
    expect(assessment.reasons).toEqual([]);
  });

  test("with no verdict yet, the checks' own severities stand in for it", () => {
    expect(
      assessCephCluster({
        healthStatus: null,
        checks: [{ name: "PG_DAMAGED", severity: "HEALTH_ERR" }],
        capacityUsedPercent: null,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
    expect(
      assessCephCluster({
        healthStatus: null,
        checks: null,
        capacityUsedPercent: null,
      }).status,
    ).toEqual({ label: "No data yet", tone: "neutral" });
  });

  test.each([
    [85, null],
    [86, ResourceAttentionSeverity.Warning],
    [95, ResourceAttentionSeverity.Warning],
    [95.2, ResourceAttentionSeverity.Critical],
  ] as Array<[number, ResourceAttentionSeverity | null]>)(
    "raw capacity at %s%%: %s, at the Cluster Near Full and Full alerts' lines",
    (percent: number, severity: ResourceAttentionSeverity | null) => {
      const assessment: CephAssessment = assessCephCluster({
        healthStatus: 0,
        capacityUsedPercent: percent,
      });
      expect(assessment.severity).toBe(severity);
      expect(texts(assessment.reasons)).toEqual(
        severity ? ["{{percent}} of raw capacity used"] : [],
      );
    },
  );

  test("the capacity lines are the Cluster Near Full and Cluster Full alerts'", () => {
    expect(CEPH_CLUSTER_NEARFULL_PERCENT).toBe(85);
    expect(CEPH_CLUSTER_FULL_PERCENT).toBe(95);
    expect(firingLineOf(templateById("ceph-cluster-near-full"))).toBe(85);
    expect(firingLineOf(templateById("ceph-cluster-full"))).toBe(95);
  });

  test("the checks sort errors first, then by code", () => {
    expect(
      sortCephHealthChecks([
        { name: "OSD_DOWN", severity: "HEALTH_WARN" },
        { name: "RECENT_CRASH", severity: "HEALTH_ERR" },
        { name: "MON_DOWN", severity: "HEALTH_WARN" },
      ]).map((check: { name: string }) => {
        return check.name;
      }),
    ).toEqual(["RECENT_CRASH", "MON_DOWN", "OSD_DOWN"]);
  });
});

describe("Needs attention", () => {
  const rows: Array<CephResource> = [
    osd(0),
    osd(3, { isUp: false, isIn: true, hostname: "ceph-b" }),
    osd(2, { isIn: false, hostname: "ceph-c" }),
    osd(5, { statBytesUsed: 960 * GIB }),
    mon("a"),
    mon("b", { inQuorum: false }),
    pool("1"),
    poolAt(90),
    row({
      kind: "Mgr",
      externalId: "mgr.x",
      lastSeenAt: minutesBefore(30),
    }),
  ];
  // poolAt names its pool "pool-1" too: give it an id and name of its own.
  rows[7]!.externalId = "2";
  rows[7]!.name = "cold";

  function items(): Array<ResourceAttentionItem> {
    return getCephAttentionItems({
      rows: rows,
      cluster: {
        name: "ceph-prod",
        healthStatus: 1,
        checks: [{ name: "OSD_DOWN", severity: "HEALTH_WARN" }],
        capacityUsedPercent: 40,
      },
      pgStatesByPool: new Map([
        [
          "1",
          {
            total: 128,
            active: 128,
            clean: 123,
            degraded: 5,
            undersized: 0,
          },
        ],
      ]),
      routeFor: routeFor,
      now: NOW,
    });
  }

  test("lists the most urgent first: critical before warning, then the cluster, OSDs, monitors and pools", () => {
    expect(
      items().map((item: ResourceAttentionItem) => {
        return [item.key, item.severity];
      }),
    ).toEqual([
      ["Osd:osd.3", "critical"],
      ["Osd:osd.5", "critical"],
      ["Mon:mon.b", "critical"],
      [CEPH_CLUSTER_ATTENTION_KEY, "warning"],
      ["Osd:osd.2", "warning"],
      // Within a kind, by name: "cold" before "pool-1".
      ["Pool:2", "warning"],
      ["Pool:1", "warning"],
    ]);
  });

  test("the cluster's row is Ceph's verdict, with the checks it raised", () => {
    const cluster: ResourceAttentionItem = items().find(
      (item: ResourceAttentionItem): boolean => {
        return item.key === CEPH_CLUSTER_ATTENTION_KEY;
      },
    )!;
    expect(cluster.kind).toBe("Cluster");
    expect(cluster.name).toBe("ceph-prod");
    expect(cluster.reasons).toEqual([
      { text: CEPH_CHECK_AS_WRITTEN, values: { check: "OSD_DOWN" } },
    ]);
    expect(cluster.route).toBeUndefined();
  });

  test("a daemon says its host and leads to its page; a pool spans the cluster", () => {
    const byKey: Map<string, ResourceAttentionItem> = new Map(
      items().map((item: ResourceAttentionItem) => {
        return [item.key, item];
      }),
    );
    expect(byKey.get("Osd:osd.3")!.detail).toBe("ceph-b");
    expect(byKey.get("Osd:osd.3")!.route?.toString()).toBe("/ceph/osd/osd.3");
    // Ceph's own name: the bare word is OneUptime's monitors in the locales.
    expect(byKey.get("Mon:mon.b")!.kind).toBe("Ceph Monitor");
    expect(byKey.get("Pool:1")!.detail).toBeUndefined();
    expect(byKey.get("Pool:1")!.name).toBe("pool-1");
    expect(texts(byKey.get("Pool:1")!.reasons)).toEqual([
      "{{count}} placement groups degraded",
    ]);
  });

  test("the healthy parts, and a manager Ceph stopped listing, are not there", () => {
    const keys: Array<string> = items().map(
      (item: ResourceAttentionItem): string => {
        return item.key;
      },
    );
    expect(keys).not.toContain("Osd:osd.0");
    expect(keys).not.toContain("Mon:mon.a");
    expect(keys).not.toContain("Mgr:mgr.x");
  });

  test("the cluster's health follows: anything critical is Unhealthy, a warning Degraded", () => {
    expect(getCephHealth(items())).toBe("Unhealthy");
    expect(
      getCephHealth(
        getCephAttentionItems({
          rows: [osd(2, { isIn: false })],
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Degraded");
    expect(
      getCephHealth(
        getCephAttentionItems({
          rows: [osd(0), mon("a"), pool("1")],
          cluster: {
            name: "ceph-prod",
            healthStatus: 0,
            capacityUsedPercent: 30,
          },
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Healthy");
  });
});

describe("a list's status reasons", () => {
  test("leave out what the status already says", () => {
    expect(
      getCephStatusReasons(
        assessCephOsd(osd(3, { isUp: false, isIn: true }), FRESH),
      ),
    ).toEqual([]);
    expect(
      getCephStatusReasons(assessCephMon(mon("b", { inQuorum: false }), FRESH)),
    ).toEqual([]);
    // "Up", in amber: why is under it.
    expect(
      texts(getCephStatusReasons(assessCephOsd(osdAt(88), FRESH))),
    ).toEqual(["{{percent}} used, past the nearfull ratio"]);
  });
});

describe("the Topology", () => {
  test("colours each part by the same assessment", () => {
    expect(
      getCephTopologyHealth(
        assessCephOsd(osd(3, { isUp: false, isIn: true }), FRESH),
      ),
    ).toBe("critical");
    expect(
      getCephTopologyHealth(assessCephOsd(osd(2, { isIn: false }), FRESH)),
    ).toBe("warning");
    expect(getCephTopologyHealth(assessCephOsd(osd(0), FRESH))).toBe("healthy");
    expect(
      getCephTopologyHealth(
        assessCephMon(mon("c", { lastSeenAt: minutesBefore(30) }), FRESH),
      ),
    ).toBe("unknown");
  });
});

describe("which part an open incident or alert is about", () => {
  test("an OSD's: its ceph_daemon name, as the OSD templates group by it, or its number", () => {
    const part: CephResource = osd(3);
    expect(isCephIssueAbout(record({ ceph_daemon: "osd.3" }), part)).toBe(true);
    expect(
      isCephIssueAbout(record({ "resource.ceph_daemon": "OSD.3" }), part),
    ).toBe(true);
    expect(isCephIssueAbout(record({ osd: "3" }), part)).toBe(true);
    expect(isCephIssueAbout(record({ osd: "osd.3" }), part)).toBe(true);
    expect(isCephIssueAbout(record({ ceph_daemon: "osd.30" }), part)).toBe(
      false,
    );
    // A check-based alert names no OSD: it is the cluster's.
    expect(isCephIssueAbout(record({}), part)).toBe(false);
  });

  test("a pool's: its pool_id, as the pool templates group by it, or its name", () => {
    const part: CephResource = pool("2", { name: "cold" });
    expect(isCephIssueAbout(record({ pool_id: "2" }), part)).toBe(true);
    expect(isCephIssueAbout(record({ pool_id: 2 }), part)).toBe(true);
    expect(isCephIssueAbout(record({ pool_id: "20" }), part)).toBe(false);
    expect(isCephIssueAbout(record({ pool: "Cold" }), part)).toBe(true);
    expect(isCephIssueAbout(record({ ceph_daemon: "osd.2" }), part)).toBe(
      false,
    );
  });

  test("a monitor's: its ceph_daemon name", () => {
    expect(isCephIssueAbout(record({ ceph_daemon: "mon.b" }), mon("b"))).toBe(
      true,
    );
    expect(isCephIssueAbout(record({ ceph_daemon: "mon.a" }), mon("b"))).toBe(
      false,
    );
  });

  test("the daemon templates group by ceph_daemon and the pool ones by pool_id, the labels it reads", () => {
    const groupings: Record<string, string> = {};
    for (const template of getAllCephAlertTemplates()) {
      const keys: Array<string> = Array.from(new Set(groupingsOf(template)));
      if (keys.length > 0) {
        groupings[template.id] = keys.join(",");
      }
    }
    expect(groupings).toEqual({
      "ceph-osd-down": "ceph_daemon",
      "ceph-osd-out": "ceph_daemon",
      "ceph-osd-high-latency": "ceph_daemon",
      "ceph-mon-quorum-degraded": "ceph_daemon",
      "ceph-daemon-slow-ops": "ceph_daemon",
      "ceph-pg-degraded": "pool_id",
      "ceph-pg-undersized": "pool_id",
      "ceph-pg-inactive": "pool_id",
      "ceph-pool-near-full": "pool_id",
    });
  });

  test("the OSD High Latency and Pool Near Full alerts fire at the rules' lines", () => {
    expect(firingLineOf(templateById("ceph-osd-high-latency"))).toBe(
      CEPH_OSD_LATENCY_WARNING_MS,
    );
    expect(firingLineOf(templateById("ceph-pool-near-full"))).toBe(
      CEPH_POOL_NEARFULL_PERCENT,
    );
  });
});

describe("the share a reason writes", () => {
  test("to a tenth, and whole without one", () => {
    expect(formatCephPercent(91)).toBe("91%");
    expect(formatCephPercent(85.44)).toBe("85.4%");
    expect(formatCephPercent(95.96)).toBe("96%");
  });
});
