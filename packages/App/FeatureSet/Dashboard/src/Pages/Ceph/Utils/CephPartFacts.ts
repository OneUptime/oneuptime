import CephResource from "Common/Models/DatabaseModels/CephResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  InfrastructureResource,
  ResourceColumnTone,
  ResourceStatusReason,
} from "../../../Components/Infrastructure/ResourceTable";
import { GoldenMetricTileTone } from "../../../Components/Infrastructure/GoldenMetricTile";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  CEPH_OSD_FULL_PERCENT,
  CEPH_OSD_LATENCY_WARNING_MS,
  CEPH_OSD_NEARFULL_PERCENT,
  CEPH_POOL_FULL_PERCENT,
  CEPH_POOL_NEARFULL_PERCENT,
  CephAssessment,
  CephPoolPgStates,
  getCephStatusReasons,
  toCephNumber,
} from "./CephHealth";
import { OSD_IN_CLUSTER, OSD_OUT_OF_CLUSTER } from "./CephResourceUtils";

/*
 * What an OSD's and a pool's page and the Ceph lists show about a part,
 * beside the rules (CephHealth) that say how it is doing: which of the
 * cluster's alerts watch it, the colours its numbers take at their alerts'
 * lines, its badges and how a list row reads. React-free, so App tests can
 * read it.
 */

/*
 * The cluster's alerts that watch a part of each kind, in the order its
 * alerts card lists them. OSD Down, Out and High Latency and Daemon Slow
 * Operations are one monitor on the cluster that fires for any OSD that
 * crosses them (they group by ceph_daemon); Nearfull, Backfillfull, Full
 * and Slow Heartbeats fire on Ceph's own checks, which name the OSDs in
 * `ceph health detail`. The pool alerts group by pool.
 */
export const CEPH_OSD_ALERT_TEMPLATE_IDS: Array<string> = [
  "ceph-osd-down",
  "ceph-osd-out",
  "ceph-osd-high-latency",
  "ceph-daemon-slow-ops",
  "ceph-osd-nearfull",
  "ceph-osd-backfillfull",
  "ceph-osd-full",
  "ceph-osd-slow-heartbeats",
];

export const CEPH_POOL_ALERT_TEMPLATE_IDS: Array<string> = [
  "ceph-pool-near-full",
  "ceph-pg-inactive",
  "ceph-pg-degraded",
  "ceph-pg-undersized",
];

// How an OSD's or a pool's own row reads in its Needs attention card.
export const THIS_OSD_LABEL: string = translationKey("This OSD");
export const THIS_POOL_LABEL: string = translationKey("This pool");

/*
 * ---------------------------------------------------------------------------
 * Colours at the alerts' lines
 * ---------------------------------------------------------------------------
 */

// An OSD's share used: amber past nearfull (85%), red past full (95%).
export function getCephOsdUsedTone(
  percent: number | null,
): ResourceColumnTone | undefined {
  if (percent === null) {
    return undefined;
  }
  if (percent > CEPH_OSD_FULL_PERCENT) {
    return "danger";
  }
  return percent > CEPH_OSD_NEARFULL_PERCENT ? "warning" : undefined;
}

// An OSD's apply latency: amber past the OSD High Latency alert's 100 ms.
export function getCephOsdLatencyTone(
  applyLatencyMs: number | null,
): ResourceColumnTone | undefined {
  return applyLatencyMs !== null && applyLatencyMs > CEPH_OSD_LATENCY_WARNING_MS
    ? "warning"
    : undefined;
}

// A pool's share of its writable space: amber past 85%, red past 95%.
export function getCephPoolUsedTone(
  percent: number | null,
): ResourceColumnTone | undefined {
  if (percent === null) {
    return undefined;
  }
  if (percent > CEPH_POOL_FULL_PERCENT) {
    return "danger";
  }
  return percent > CEPH_POOL_NEARFULL_PERCENT ? "warning" : undefined;
}

// A tile's bar, from a column's tone: green when its number is fine.
export function toCephTileTone(
  tone: ResourceColumnTone | undefined,
): GoldenMetricTileTone {
  return tone || "positive";
}

/*
 * ---------------------------------------------------------------------------
 * Badges
 * ---------------------------------------------------------------------------
 */

// Whether Ceph places data on the OSD, as `ceph osd tree` says in or out.
export function getCephOsdPlacementBadge(
  row: Pick<CephResource, "isIn">,
): ResourcePartBadge | null {
  if (row.isIn === true) {
    return { key: "placement", label: OSD_IN_CLUSTER, tone: "positive" };
  }
  if (row.isIn === false) {
    return { key: "placement", label: OSD_OUT_OF_CLUSTER, tone: "warning" };
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * A list row
 * ---------------------------------------------------------------------------
 */

/*
 * A list row's status by the rules: the word, its colour and why, so the
 * OSDs, Pools and Daemons lists say what the Overview's Needs attention
 * says about the same part.
 */
export function withCephStatus(
  resource: InfrastructureResource,
  assessment: CephAssessment,
): InfrastructureResource {
  const reasons: Array<ResourceStatusReason> = getCephStatusReasons(assessment);
  return {
    ...resource,
    status: assessment.status.label,
    statusTone: assessment.status.tone,
    statusText: assessment.status.values
      ? { text: assessment.status.label, values: assessment.status.values }
      : { text: assessment.status.label },
    statusReasons: reasons,
  };
}

// The numbers a row keeps for its cells' colours.
export const CEPH_USED_PERCENT_ATTRIBUTE: string = "usedPercentValue";
export const CEPH_APPLY_LATENCY_ATTRIBUTE: string = "applyLatencyValue";

export function readCephRowNumber(
  resource: InfrastructureResource,
  attribute: string,
): number | null {
  return toCephNumber(resource.additionalAttributes[attribute]);
}

export function formatCephReadingNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

/*
 * A pool's placement groups in a cell: how many are active and clean of
 * all, or a dash when the agent sends no per-pool counts (Ceph older than
 * Nautilus).
 */
export interface CephPoolPgSummary {
  clean: number;
  total: number;
}

export function getCephPoolPgSummary(
  pgStates: CephPoolPgStates | null | undefined,
): CephPoolPgSummary | null {
  if (!pgStates || pgStates.total === null || pgStates.total <= 0) {
    return null;
  }
  return {
    clean: Math.max(0, Math.round(pgStates.clean ?? 0)),
    total: Math.round(pgStates.total),
  };
}
