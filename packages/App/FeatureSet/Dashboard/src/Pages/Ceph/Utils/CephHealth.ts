import CephResource from "Common/Models/DatabaseModels/CephResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../Components/ResourcePart/ResourceAttention";
import { ResourcePartStatus } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  OpenIssueRecord,
  readSeriesLabel,
  sameName,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import { ResourceTopologyHealth } from "../../../Components/ResourceTopology/ResourceTopologyModel";

/*
 * WHAT IN A CEPH CLUSTER NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the cluster's Overview (its
 * health pill and Needs attention card), an OSD's and a pool's own page, the
 * OSDs, Pools and Daemons lists and the Topology. They read what the
 * ceph-mgr prometheus module reports: the inventory the ingest keeps
 * (CephResource - each OSD's up and in flags, usage and latency, each
 * monitor's quorum, each pool's STORED and MAX AVAIL), the cluster's own
 * health (CephCluster.healthStatus) and, where it has them, the health
 * checks Ceph raises (ceph_health_detail) and each pool's placement-group
 * states (ceph_pg_*).
 *
 *   Critical - broken, or about to be:
 *     Ceph's own HEALTH_ERR; an OSD that is down while still in the cluster
 *     (its placement groups have lost a copy and Ceph still expects it); an
 *     OSD past Ceph's full ratio (95%: it refuses writes); a monitor out of
 *     quorum; a pool past 95% of its writable space; a pool with inactive
 *     placement groups (I/O to them hangs); the cluster past 95% of its raw
 *     capacity.
 *   Warning - needs a look soon:
 *     Ceph's own HEALTH_WARN; an OSD down and out (its data has moved, the
 *     disk still wants replacing) or up but out of the cluster; an OSD past
 *     the backfillfull (90%) or nearfull (85%) ratio; an OSD whose apply
 *     latency is past 100 ms; a pool past 85% of its writable space, or with
 *     degraded or undersized placement groups; the cluster past 85% of its
 *     raw capacity.
 *
 * Every line is the one its alert template fires at
 * (Common/Types/Monitor/CephAlertTemplates): OSD Down, OSD Out, OSD High
 * Latency, OSD Nearfull, OSD Backfillfull and OSD Full, Monitor Quorum
 * Degraded, Pool Near Full, the placement-group alerts and Cluster Near Full
 * and Full. The OSD ratios are Ceph's defaults (mon_osd_nearfull_ratio and
 * the rest); a cluster set to others raises its own checks at its own
 * lines, which the cluster's row carries.
 *
 * What is never a problem by itself: a manager, metadata server or object
 * gateway Ceph stopped listing (removed, or failed over - Ceph raises a
 * check for one that fails: RECENT_CRASH, MDS_ALL_DOWN, a failed cephadm
 * daemon), and a daemon or pool the newest report left out (it was removed;
 * OneUptime forgets it 15 minutes after its last report). Those read
 * "Stopped reporting", in grey.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn. Ceph's own words - a health check's code,
 * HEALTH_WARN - are shown as Ceph writes them, in every language.
 *
 * React-free (no Route building: pages hand in routeFor), so App tests can
 * read it.
 */

export type CephPartKind = "Osd" | "Pool" | "Mon" | "Mgr" | "Mds" | "Rgw";

// Ceph's default OSD ratios, where its OSD_* checks and alerts fire.
export const CEPH_OSD_NEARFULL_PERCENT: number = 85;
export const CEPH_OSD_BACKFILLFULL_PERCENT: number = 90;
export const CEPH_OSD_FULL_PERCENT: number = 95;

// The OSD High Latency alert's line.
export const CEPH_OSD_LATENCY_WARNING_MS: number = 100;

// The Pool Near Full alert's line, and where a pool has all but filled.
export const CEPH_POOL_NEARFULL_PERCENT: number = 85;
export const CEPH_POOL_FULL_PERCENT: number = 95;

// The Cluster Near Full and Cluster Full alerts' lines.
export const CEPH_CLUSTER_NEARFULL_PERCENT: number = 85;
export const CEPH_CLUSTER_FULL_PERCENT: number = 95;

/*
 * Latest readings older than this are no readings: the cleanup's cutoff
 * (CEPH_INVENTORY_STALE_MINUTES), after which the row itself goes.
 */
export const CEPH_READINGS_STALE_MS: number = 15 * 60 * 1000;

/*
 * The agent reads the mgr every 30 seconds and every report writes every
 * daemon and pool again, so a row this much older than the newest one was
 * left out of the reports since: Ceph no longer lists it.
 */
export const CEPH_STOPPED_REPORTING_MS: number = 5 * 60 * 1000;

// ceph_health_status / CephCluster.healthStatus, as Ceph writes it.
export const CEPH_HEALTH_WORDS: Record<number, string> = {
  0: "HEALTH_OK",
  1: "HEALTH_WARN",
  2: "HEALTH_ERR",
};

/*
 * A check Ceph raises (ceph health detail): its code, OSD_DOWN, and how
 * serious Ceph calls it, HEALTH_WARN or HEALTH_ERR.
 */
export interface CephHealthCheck {
  name: string;
  severity: string;
}

/*
 * A pool's placement groups by state, from the latest ceph_pg_* readings
 * (null where the agent sent none).
 */
export interface CephPoolPgStates {
  total: number | null;
  active: number | null;
  clean: number | null;
  degraded: number | null;
  undersized: number | null;
}

export interface CephAssessment {
  severity: ResourceAttentionSeverity | null;
  // The part's state in a word, coloured by how it is doing.
  status: ResourcePartStatus;
  // Why it needs attention, most urgent first; empty when it does not.
  reasons: Array<ResourceAttentionText>;
  // When it last reported, for a part Ceph stopped listing.
  lastReportAt?: Date | undefined;
}

export type CephRouteFor = (
  kind: CephPartKind,
  externalId: string,
) => Route | undefined;

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */
const STATUS_UP: string = translationKey("Up");
const STATUS_DOWN: string = translationKey("Down");
const STATUS_DOWN_AND_OUT: string = translationKey("Down and out");
const STATUS_OUT: string = translationKey("Out of cluster");
const STATUS_IN_QUORUM: string = translationKey("In quorum");
const STATUS_OUT_OF_QUORUM: string = translationKey("Out of quorum");
const STATUS_REPORTING: string = translationKey("Reporting");
const STATUS_AVAILABLE: string = translationKey("Available");
const STATUS_NO_DATA: string = translationKey("No data yet");
const STATUS_STOPPED_REPORTING: string = translationKey("Stopped reporting");

/*
 * Whether an OSD's state already says it is out of the cluster ("Out of
 * cluster", "Down and out"): its hero then has no placement badge to say
 * it a second time.
 */
export function isCephOsdOutStatus(label: string | undefined): boolean {
  return label === STATUS_OUT || label === STATUS_DOWN_AND_OUT;
}

const REASON_OSD_DOWN_IN: string = translationKey("Down, still in the cluster");
const REASON_OSD_DOWN_OUT: string = translationKey(
  "Down and out of the cluster",
);
const REASON_OSD_OUT: string = translationKey("Up but out of the cluster");
const REASON_OSD_FULL: string = translationKey(
  "{{percent}} used, past the full ratio",
);
const REASON_OSD_BACKFILLFULL: string = translationKey(
  "{{percent}} used, past the backfillfull ratio",
);
const REASON_OSD_NEARFULL: string = translationKey(
  "{{percent}} used, past the nearfull ratio",
);
const REASON_OSD_LATENCY: string = translationKey("Apply latency {{latency}}");
const REASON_MON_OUT_OF_QUORUM: string = translationKey("Out of quorum");
const REASON_POOL_USED: string = translationKey(
  "{{percent}} of its writable space used",
);
const REASON_PGS_INACTIVE: { one: string; other: string } = {
  one: "{{count}} placement group inactive",
  other: "{{count}} placement groups inactive",
};
const REASON_PGS_DEGRADED: { one: string; other: string } = {
  one: "{{count}} placement group degraded",
  other: "{{count}} placement groups degraded",
};
const REASON_PGS_UNDERSIZED: { one: string; other: string } = {
  one: "{{count}} placement group undersized",
  other: "{{count}} placement groups undersized",
};
const REASON_CEPH_REPORTS: string = translationKey("Ceph reports {{status}}");
const REASON_RAW_CAPACITY: string = translationKey(
  "{{percent}} of raw capacity used",
);

/*
 * A template with no words: a health check's code, as Ceph wrote it. Not a
 * key of the locales - it reads as its value in every language.
 */
export const CEPH_CHECK_AS_WRITTEN: string = "{{check}}";

/*
 * Ceph's own names for its daemons. A monitor and a manager say "Ceph" as
 * Ceph's documentation does: the bare words are OneUptime's monitors and a
 * person's manager in the locales ("Überwachung", "Responsable").
 */
export const CEPH_KIND_CLUSTER: string = translationKey("Cluster");
export const CEPH_KIND_OSD: string = translationKey("OSD");
export const CEPH_KIND_POOL: string = translationKey("Pool");
export const CEPH_KIND_MON: string = translationKey("Ceph Monitor");
export const CEPH_KIND_MGR: string = translationKey("Ceph Manager");
export const CEPH_KIND_MDS: string = translationKey("Metadata Server");
export const CEPH_KIND_RGW: string = translationKey("Object Gateway");

// The order Needs attention lists the kinds in, at one severity.
export const CEPH_ATTENTION_KIND_ORDER: Array<string> = [
  CEPH_KIND_CLUSTER,
  CEPH_KIND_OSD,
  CEPH_KIND_MON,
  CEPH_KIND_POOL,
  CEPH_KIND_MGR,
  CEPH_KIND_MDS,
  CEPH_KIND_RGW,
];

// The key of the cluster's own row in Needs attention (Ceph's verdict).
export const CEPH_CLUSTER_ATTENTION_KEY: string = "Cluster";

/*
 * ---------------------------------------------------------------------------
 * Reading a row
 * ---------------------------------------------------------------------------
 */
export function toCephNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toCephDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isCephPartKind(kind: unknown): kind is CephPartKind {
  return (
    kind === "Osd" ||
    kind === "Pool" ||
    kind === "Mon" ||
    kind === "Mgr" ||
    kind === "Mds" ||
    kind === "Rgw"
  );
}

// What the part is called: a daemon by its ceph_daemon name, a pool by its own.
export function getCephDisplayName(
  row: Pick<CephResource, "kind" | "name" | "externalId">,
): string {
  if (row.kind === "Pool") {
    return row.name || `pool ${row.externalId || ""}`.trim();
  }
  return row.name || row.externalId || "";
}

// The newest report among the rows: what "the latest report" is measured by.
export function getCephNewestSeenAt(
  rows: Array<Pick<CephResource, "lastSeenAt">>,
): Date | null {
  let newest: number = 0;
  for (const row of rows) {
    const seenAt: Date | null = toCephDate(row.lastSeenAt);
    if (seenAt && seenAt.getTime() > newest) {
      newest = seenAt.getTime();
    }
  }
  return newest > 0 ? new Date(newest) : null;
}

/*
 * Whether the reports since this row's last one left it out: Ceph no
 * longer lists the daemon or the pool. Measured against the newest row, not
 * the clock, so a cluster whose agent stopped keeps its last picture.
 */
export function isCephStoppedReporting(
  row: Pick<CephResource, "lastSeenAt">,
  newestSeenAt: Date | null,
): boolean {
  const seenAt: Date | null = toCephDate(row.lastSeenAt);
  if (!seenAt || !newestSeenAt) {
    return false;
  }
  return newestSeenAt.getTime() - seenAt.getTime() > CEPH_STOPPED_REPORTING_MS;
}

function isFresh(
  row: Pick<CephResource, "metricsUpdatedAt">,
  now: Date,
): boolean {
  const updatedAt: Date | null = toCephDate(row.metricsUpdatedAt);
  return (
    updatedAt !== null &&
    now.getTime() - updatedAt.getTime() <= CEPH_READINGS_STALE_MS
  );
}

export interface CephOsdReadings {
  usedBytes: number | null;
  totalBytes: number | null;
  usedPercent: number | null;
  applyLatencyMs: number | null;
  commitLatencyMs: number | null;
  pgCount: number | null;
}

/*
 * An OSD's latest readings, or nulls when it sent none for longer than the
 * cleanup keeps a row: a bar must never show old readings as current ones.
 */
export function getCephOsdReadings(
  row: Pick<
    CephResource,
    | "statBytes"
    | "statBytesUsed"
    | "applyLatencyMs"
    | "commitLatencyMs"
    | "pgCount"
    | "metricsUpdatedAt"
  >,
  now: Date,
): CephOsdReadings {
  if (!isFresh(row, now)) {
    return {
      usedBytes: null,
      totalBytes: null,
      usedPercent: null,
      applyLatencyMs: null,
      commitLatencyMs: null,
      pgCount: null,
    };
  }
  const usedBytes: number | null = toCephNumber(row.statBytesUsed);
  const totalBytes: number | null = toCephNumber(row.statBytes);
  return {
    usedBytes: usedBytes,
    totalBytes: totalBytes,
    usedPercent:
      usedBytes !== null && totalBytes !== null && totalBytes > 0
        ? (usedBytes / totalBytes) * 100
        : null,
    applyLatencyMs: toCephNumber(row.applyLatencyMs),
    commitLatencyMs: toCephNumber(row.commitLatencyMs),
    pgCount: toCephNumber(row.pgCount),
  };
}

export interface CephPoolReadings {
  storedBytes: number | null;
  maxAvailBytes: number | null;
  // STORED / (STORED + MAX AVAIL), as the Pool Near Full alert works it out.
  usedPercent: number | null;
  objects: number | null;
}

export function getCephPoolReadings(
  row: Pick<
    CephResource,
    "storedBytes" | "maxAvailBytes" | "objects" | "metricsUpdatedAt"
  >,
  now: Date,
): CephPoolReadings {
  if (!isFresh(row, now)) {
    return {
      storedBytes: null,
      maxAvailBytes: null,
      usedPercent: null,
      objects: null,
    };
  }
  const storedBytes: number | null = toCephNumber(row.storedBytes);
  const maxAvailBytes: number | null = toCephNumber(row.maxAvailBytes);
  return {
    storedBytes: storedBytes,
    maxAvailBytes: maxAvailBytes,
    usedPercent:
      storedBytes !== null &&
      maxAvailBytes !== null &&
      storedBytes + maxAvailBytes > 0
        ? (storedBytes / (storedBytes + maxAvailBytes)) * 100
        : null,
    objects: toCephNumber(row.objects),
  };
}

/*
 * A share as the reasons write it: to a tenth, and whole without one - 91%,
 * 85.4% (a whole 85% would read as not past the 85% line).
 */
export function formatCephPercent(percent: number): string {
  const tenths: number = Math.round(percent * 10) / 10;
  return Number.isInteger(tenths) ? `${tenths}%` : `${tenths.toFixed(1)}%`;
}

export function formatCephLatency(milliseconds: number): string {
  return `${Math.round(milliseconds)} ms`;
}

function status(
  label: string,
  tone: ResourcePartStatus["tone"],
): ResourcePartStatus {
  return { label: label, tone: tone };
}

// The worse of a tone and what a finding of this severity reads as.
function escalate(
  current: ResourcePartStatus,
  severity: ResourceAttentionSeverity | null,
): ResourcePartStatus {
  if (severity === ResourceAttentionSeverity.Critical) {
    return { ...current, tone: "danger" };
  }
  if (severity === ResourceAttentionSeverity.Warning) {
    return current.tone === "danger"
      ? current
      : { ...current, tone: "warning" };
  }
  return current;
}

function stoppedReporting(
  row: Pick<CephResource, "lastSeenAt">,
): CephAssessment {
  const lastReportAt: Date | null = toCephDate(row.lastSeenAt);
  return {
    severity: null,
    status: status(STATUS_STOPPED_REPORTING, "neutral"),
    reasons: [],
    lastReportAt: lastReportAt || undefined,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The rules, one kind at a time
 * ---------------------------------------------------------------------------
 */
export function assessCephOsd(
  row: CephResource,
  data: { now: Date; newestSeenAt: Date | null },
): CephAssessment {
  if (isCephStoppedReporting(row, data.newestSeenAt)) {
    return stoppedReporting(row);
  }

  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  let partStatus: ResourcePartStatus;

  if (row.isUp === false) {
    /*
     * Down while still in: Ceph still places data on it, so its placement
     * groups run a copy short (Ceph's OSD_DOWN). Down and out: Ceph has
     * moved its data to the others - the disk still wants replacing.
     */
    if (row.isIn === false) {
      partStatus = status(STATUS_DOWN_AND_OUT, "warning");
      reasons.push({ text: REASON_OSD_DOWN_OUT });
      severities.push(ResourceAttentionSeverity.Warning);
    } else {
      partStatus = status(STATUS_DOWN, "danger");
      reasons.push({ text: REASON_OSD_DOWN_IN });
      severities.push(ResourceAttentionSeverity.Critical);
    }
  } else if (row.isUp === true) {
    if (row.isIn === false) {
      partStatus = status(STATUS_OUT, "warning");
      reasons.push({ text: REASON_OSD_OUT });
      severities.push(ResourceAttentionSeverity.Warning);
    } else {
      partStatus = status(STATUS_UP, "positive");
    }

    // A running OSD's own readings; a down one's are no readings.
    const readings: CephOsdReadings = getCephOsdReadings(row, data.now);
    if (readings.usedPercent !== null) {
      const values: Record<string, string> = {
        percent: formatCephPercent(readings.usedPercent),
      };
      if (readings.usedPercent > CEPH_OSD_FULL_PERCENT) {
        reasons.push({ text: REASON_OSD_FULL, values: values });
        severities.push(ResourceAttentionSeverity.Critical);
      } else if (readings.usedPercent > CEPH_OSD_BACKFILLFULL_PERCENT) {
        reasons.push({ text: REASON_OSD_BACKFILLFULL, values: values });
        severities.push(ResourceAttentionSeverity.Warning);
      } else if (readings.usedPercent > CEPH_OSD_NEARFULL_PERCENT) {
        reasons.push({ text: REASON_OSD_NEARFULL, values: values });
        severities.push(ResourceAttentionSeverity.Warning);
      }
    }
    if (
      readings.applyLatencyMs !== null &&
      readings.applyLatencyMs > CEPH_OSD_LATENCY_WARNING_MS
    ) {
      reasons.push({
        text: REASON_OSD_LATENCY,
        values: { latency: formatCephLatency(readings.applyLatencyMs) },
      });
      severities.push(ResourceAttentionSeverity.Warning);
    }
  } else {
    partStatus = status(STATUS_NO_DATA, "neutral");
  }

  const severity: ResourceAttentionSeverity | null =
    mergeResourceAttentionSeverity(severities);

  return {
    severity: severity,
    status: escalate(partStatus, severity),
    reasons: sortReasons(reasons, severities),
  };
}

export function assessCephMon(
  row: CephResource,
  data: { newestSeenAt: Date | null },
): CephAssessment {
  if (isCephStoppedReporting(row, data.newestSeenAt)) {
    return stoppedReporting(row);
  }
  if (row.inQuorum === false) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      status: status(STATUS_OUT_OF_QUORUM, "danger"),
      reasons: [{ text: REASON_MON_OUT_OF_QUORUM }],
    };
  }
  return {
    severity: null,
    status:
      row.inQuorum === true
        ? status(STATUS_IN_QUORUM, "positive")
        : status(STATUS_NO_DATA, "neutral"),
    reasons: [],
  };
}

/*
 * A manager, metadata server or object gateway: Ceph reports only that it
 * lists one (its metadata), so it is Reporting while it does.
 */
export function assessCephDaemon(
  row: CephResource,
  data: { newestSeenAt: Date | null },
): CephAssessment {
  if (isCephStoppedReporting(row, data.newestSeenAt)) {
    return stoppedReporting(row);
  }
  return {
    severity: null,
    status: status(STATUS_REPORTING, "positive"),
    reasons: [],
  };
}

export function assessCephPool(
  row: CephResource,
  data: {
    now: Date;
    newestSeenAt: Date | null;
    pgStates?: CephPoolPgStates | null | undefined;
  },
): CephAssessment {
  if (isCephStoppedReporting(row, data.newestSeenAt)) {
    return stoppedReporting(row);
  }

  const readings: CephPoolReadings = getCephPoolReadings(row, data.now);
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  const pgStates: CephPoolPgStates | null = data.pgStates || null;

  if (pgStates && pgStates.total !== null && pgStates.active !== null) {
    const inactive: number = Math.max(
      0,
      Math.round(pgStates.total - pgStates.active),
    );
    if (inactive > 0) {
      reasons.push({
        text: REASON_PGS_INACTIVE.other,
        plural: { one: REASON_PGS_INACTIVE.one, count: inactive },
      });
      severities.push(ResourceAttentionSeverity.Critical);
    }
  }

  if (readings.usedPercent !== null) {
    if (readings.usedPercent > CEPH_POOL_FULL_PERCENT) {
      reasons.push({
        text: REASON_POOL_USED,
        values: { percent: formatCephPercent(readings.usedPercent) },
      });
      severities.push(ResourceAttentionSeverity.Critical);
    } else if (readings.usedPercent > CEPH_POOL_NEARFULL_PERCENT) {
      reasons.push({
        text: REASON_POOL_USED,
        values: { percent: formatCephPercent(readings.usedPercent) },
      });
      severities.push(ResourceAttentionSeverity.Warning);
    }
  }

  const degraded: number = Math.round(pgStates?.degraded ?? 0);
  if (degraded > 0) {
    reasons.push({
      text: REASON_PGS_DEGRADED.other,
      plural: { one: REASON_PGS_DEGRADED.one, count: degraded },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }
  const undersized: number = Math.round(pgStates?.undersized ?? 0);
  if (undersized > 0) {
    reasons.push({
      text: REASON_PGS_UNDERSIZED.other,
      plural: { one: REASON_PGS_UNDERSIZED.one, count: undersized },
    });
    severities.push(ResourceAttentionSeverity.Warning);
  }

  const severity: ResourceAttentionSeverity | null =
    mergeResourceAttentionSeverity(severities);
  const partStatus: ResourcePartStatus =
    readings.usedPercent === null && !pgStates
      ? status(STATUS_NO_DATA, "neutral")
      : status(STATUS_AVAILABLE, "positive");

  return {
    severity: severity,
    status: escalate(partStatus, severity),
    reasons: sortReasons(reasons, severities),
  };
}

export function assessCephResource(
  row: CephResource,
  data: {
    now: Date;
    newestSeenAt: Date | null;
    pgStates?: CephPoolPgStates | null | undefined;
  },
): CephAssessment | null {
  if (row.kind === "Osd") {
    return assessCephOsd(row, data);
  }
  if (row.kind === "Mon") {
    return assessCephMon(row, data);
  }
  if (row.kind === "Pool") {
    return assessCephPool(row, data);
  }
  if (row.kind === "Mgr" || row.kind === "Mds" || row.kind === "Rgw") {
    return assessCephDaemon(row, data);
  }
  return null;
}

interface RankedReason {
  reason: ResourceAttentionText;
  rank: number;
  index: number;
}

// Critical reasons before warnings, each in the order it was found.
function sortReasons(
  reasons: Array<ResourceAttentionText>,
  severities: Array<ResourceAttentionSeverity>,
): Array<ResourceAttentionText> {
  return reasons
    .map((reason: ResourceAttentionText, index: number): RankedReason => {
      return {
        reason: reason,
        rank: severities[index] === ResourceAttentionSeverity.Critical ? 0 : 1,
        index: index,
      };
    })
    .sort((a: RankedReason, b: RankedReason): number => {
      return a.rank - b.rank || a.index - b.index;
    })
    .map((entry: RankedReason): ResourceAttentionText => {
      return entry.reason;
    });
}

/*
 * ---------------------------------------------------------------------------
 * The cluster's own verdict
 * ---------------------------------------------------------------------------
 *
 * Ceph's HEALTH_OK, HEALTH_WARN or HEALTH_ERR, with the checks it raised
 * (each a code, as Ceph writes it: the errors first), and the share of the
 * cluster's raw capacity in use against the Cluster Near Full and Full
 * alerts' lines. A check Ceph muted does not count toward its verdict, so
 * the checks are drawn only while the verdict is not OK.
 */
export interface CephClusterState {
  healthStatus: number | null;
  // Null when the checks could not be read, or this Ceph exports none.
  checks?: Array<CephHealthCheck> | null | undefined;
  capacityUsedPercent: number | null;
}

export function isCephErrorCheck(check: CephHealthCheck): boolean {
  return check.severity.toUpperCase().includes("ERR");
}

export function sortCephHealthChecks(
  checks: Array<CephHealthCheck>,
): Array<CephHealthCheck> {
  return [...checks].sort((a: CephHealthCheck, b: CephHealthCheck): number => {
    const byError: number =
      Number(isCephErrorCheck(b)) - Number(isCephErrorCheck(a));
    return byError || a.name.localeCompare(b.name);
  });
}

export function getCephHealthWord(healthStatus: number | null): string | null {
  if (healthStatus === null) {
    return null;
  }
  return CEPH_HEALTH_WORDS[Math.max(0, Math.min(2, Math.round(healthStatus)))]!;
}

export function assessCephCluster(state: CephClusterState): CephAssessment {
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  const checks: Array<CephHealthCheck> = sortCephHealthChecks(
    state.checks || [],
  );

  // Ceph's own verdict; with no verdict yet, the checks' own severities.
  let verdict: number | null = state.healthStatus;
  if (verdict === null && checks.length > 0) {
    verdict = checks.some(isCephErrorCheck) ? 2 : 1;
  }

  if (verdict !== null && verdict >= 1) {
    severities.push(
      verdict >= 2
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    );
    if (checks.length > 0) {
      for (const check of checks) {
        reasons.push({
          text: CEPH_CHECK_AS_WRITTEN,
          values: { check: check.name },
        });
      }
    } else {
      reasons.push({
        text: REASON_CEPH_REPORTS,
        values: { status: getCephHealthWord(verdict) || "" },
      });
    }
  }

  if (state.capacityUsedPercent !== null) {
    const values: Record<string, string> = {
      percent: formatCephPercent(state.capacityUsedPercent),
    };
    if (state.capacityUsedPercent > CEPH_CLUSTER_FULL_PERCENT) {
      reasons.push({ text: REASON_RAW_CAPACITY, values: values });
      severities.push(ResourceAttentionSeverity.Critical);
    } else if (state.capacityUsedPercent > CEPH_CLUSTER_NEARFULL_PERCENT) {
      reasons.push({ text: REASON_RAW_CAPACITY, values: values });
      severities.push(ResourceAttentionSeverity.Warning);
    }
  }

  const severity: ResourceAttentionSeverity | null =
    mergeResourceAttentionSeverity(severities);
  const word: string | null = getCephHealthWord(verdict);

  return {
    severity: severity,
    // Ceph's own word, as it writes it, in every language (no key).
    status: word
      ? {
          label: word,
          tone:
            severity === ResourceAttentionSeverity.Critical
              ? "danger"
              : severity === ResourceAttentionSeverity.Warning
                ? "warning"
                : "positive",
        }
      : status(STATUS_NO_DATA, "neutral"),
    reasons: reasons,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Needs attention
 * ---------------------------------------------------------------------------
 */
const KIND_WORDS: Record<CephPartKind, string> = {
  Osd: CEPH_KIND_OSD,
  Pool: CEPH_KIND_POOL,
  Mon: CEPH_KIND_MON,
  Mgr: CEPH_KIND_MGR,
  Mds: CEPH_KIND_MDS,
  Rgw: CEPH_KIND_RGW,
};

const KIND_ICONS: Record<CephPartKind, IconProp> = {
  Osd: IconProp.Disc,
  Pool: IconProp.Database,
  Mon: IconProp.Eye,
  Mgr: IconProp.Cog,
  Mds: IconProp.Folder,
  Rgw: IconProp.Globe,
};

export function getCephKindWord(kind: CephPartKind): string {
  return KIND_WORDS[kind];
}

export function getCephKindIcon(kind: CephPartKind): IconProp {
  return KIND_ICONS[kind];
}

export function getCephAttentionKey(
  kind: CephPartKind,
  externalId: string,
): string {
  return `${kind}:${externalId}`;
}

/*
 * Everything in the cluster that needs attention, most urgent first.
 *
 * `scope` says whose page draws it:
 *   - "cluster" (the Overview): Ceph's own verdict and the raw capacity on
 *     the cluster's row, then each OSD, monitor and pool;
 *   - "part": only the rows handed in, as an OSD's or a pool's own page
 *     lists itself.
 */
export function getCephAttentionItems(data: {
  rows: Array<CephResource>;
  cluster?: (CephClusterState & { name: string }) | undefined;
  pgStatesByPool?: Map<string, CephPoolPgStates> | null | undefined;
  routeFor: CephRouteFor;
  now: Date;
  // The newest report of the whole inventory; worked out from `rows` if unset.
  newestSeenAt?: Date | null | undefined;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];
  const newestSeenAt: Date | null =
    data.newestSeenAt !== undefined
      ? data.newestSeenAt
      : getCephNewestSeenAt(data.rows);

  if (data.cluster) {
    const assessment: CephAssessment = assessCephCluster(data.cluster);
    if (assessment.severity) {
      items.push({
        key: CEPH_CLUSTER_ATTENTION_KEY,
        kind: CEPH_KIND_CLUSTER,
        icon: IconProp.Ceph,
        name: data.cluster.name,
        severity: assessment.severity,
        reasons: assessment.reasons,
      });
    }
  }

  for (const row of data.rows) {
    if (!isCephPartKind(row.kind) || !row.externalId) {
      continue;
    }
    const kind: CephPartKind = row.kind;
    const assessment: CephAssessment | null = assessCephResource(row, {
      now: data.now,
      newestSeenAt: newestSeenAt,
      pgStates:
        kind === "Pool"
          ? data.pgStatesByPool?.get(row.externalId) || null
          : null,
    });
    if (!assessment || !assessment.severity) {
      continue;
    }
    items.push({
      key: getCephAttentionKey(kind, row.externalId),
      kind: KIND_WORDS[kind],
      icon: KIND_ICONS[kind],
      name: getCephDisplayName(row),
      // A daemon says the host it runs on; a pool spans the cluster.
      detail: kind !== "Pool" && row.hostname ? row.hostname : undefined,
      severity: assessment.severity,
      reasons: assessment.reasons,
      route: data.routeFor(kind, row.externalId),
    });
  }

  return sortResourceAttention(items, CEPH_ATTENTION_KIND_ORDER);
}

export function getCephHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

/*
 * The reasons a list's row draws under its status: not the ones its status
 * already says ("Out of quorum" under Out of quorum, "Down, still in the
 * cluster" under Down beside its In column), which Needs attention needs
 * because its rows have no status.
 */
const REASONS_THE_STATUS_SAYS: ReadonlySet<string> = new Set<string>([
  REASON_OSD_DOWN_IN,
  REASON_OSD_DOWN_OUT,
  REASON_OSD_OUT,
  REASON_MON_OUT_OF_QUORUM,
]);

export function getCephStatusReasons(
  assessment: CephAssessment,
): Array<ResourceAttentionText> {
  return assessment.reasons.filter((reason: ResourceAttentionText): boolean => {
    return !REASONS_THE_STATUS_SAYS.has(reason.text);
  });
}

/*
 * How the Topology colours a part: by the same assessment. A part Ceph
 * stopped listing, or with no word yet, is "unknown".
 */
export function getCephTopologyHealth(
  assessment: CephAssessment,
): ResourceTopologyHealth {
  if (assessment.severity === ResourceAttentionSeverity.Critical) {
    return "critical";
  }
  if (assessment.severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  if (assessment.status.tone === "positive") {
    return "healthy";
  }
  return "unknown";
}

/*
 * ---------------------------------------------------------------------------
 * Which part an open incident or alert is about
 * ---------------------------------------------------------------------------
 *
 * The Ceph templates group a daemon's alerts by `ceph_daemon` ("osd.3",
 * "mon.a") and a pool's by `pool_id` (pool data series carry no name). A
 * person's own monitor may group by `osd` (an OSD's number) or `pool` (its
 * name) too. A check-based alert (OSD Nearfull, Daemon Crash) is the
 * cluster's: Ceph's check names no part.
 */
export function isCephIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<CephResource, "kind" | "externalId" | "name">,
): boolean {
  const externalId: string = row.externalId || "";
  if (!externalId) {
    return false;
  }
  if (row.kind === "Pool") {
    const poolId: string | null = readSeriesLabel(
      record.seriesLabels,
      "pool_id",
    );
    if (poolId) {
      return poolId === externalId;
    }
    return sameName(readSeriesLabel(record.seriesLabels, "pool"), row.name);
  }
  const daemon: string | null = readSeriesLabel(
    record.seriesLabels,
    "ceph_daemon",
  );
  if (daemon) {
    return sameName(daemon, externalId);
  }
  if (row.kind === "Osd") {
    const osd: string | null = readSeriesLabel(record.seriesLabels, "osd");
    return Boolean(
      osd && (sameName(osd, externalId) || sameName(`osd.${osd}`, externalId)),
    );
  }
  return false;
}
