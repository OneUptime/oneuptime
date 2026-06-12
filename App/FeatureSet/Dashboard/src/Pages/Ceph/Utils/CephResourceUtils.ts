import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";

/*
 * Shared helpers for the Ceph list/detail pages. The pages read the
 * CephResource Postgres inventory table (populated by the OTel metrics
 * ingest path) instead of groupBy-ing over ClickHouse metric data —
 * same architecture as the Kubernetes pages
 * (Pages/Kubernetes/Utils/KubernetesResourceUtils.ts).
 */

/*
 * Latest metric values older than this are treated as "no data" by the
 * list views so bars don't lie about a resource that's fallen off the
 * metric stream. Matches the cleanup worker's stale-resource cutoff
 * (CEPH_INVENTORY_STALE_MINUTES default).
 */
export const METRIC_STALE_MS: number = 15 * 60 * 1000;

export type CephResourceKind = "Osd" | "Pool" | "Mon" | "Mgr" | "Mds" | "Rgw";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "—";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units: Array<string> = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value: number = bytes / 1024;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.round(value).toString();
}

export function formatAge(date: Date | undefined | null): string {
  if (!date) {
    return "N/A";
  }
  const diffSec: number = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  const diffMin: number = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m`;
  }
  const diffHours: number = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }
  const diffDays: number = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d`;
  }
  return `${Math.floor(diffDays / 30)}mo`;
}

/*
 * Numeric sort key for OSD daemon names so `osd.10` lands after
 * `osd.9`, with a lexicographic fallback for unexpected names.
 */
export function compareDaemonNames(a: string, b: string): number {
  const aNum: number = Number(a.split(".").pop());
  const bNum: number = Number(b.split(".").pop());
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return aNum - bNum;
  }
  return a.localeCompare(b);
}

/**
 * Fetch CephResource inventory rows of the given kinds for a cluster —
 * the authoritative "what exists right now" source, kept in lockstep
 * with the sidebar badge counts (single-source rule).
 */
export async function fetchCephResources(options: {
  cephClusterId: ObjectID;
  kinds: Array<CephResourceKind>;
}): Promise<Array<CephResourceModel>> {
  const rows: Array<CephResourceModel> = [];
  for (const kind of options.kinds) {
    const result: ListResult<CephResourceModel> =
      await ModelAPI.getList<CephResourceModel>({
        modelType: CephResourceModel,
        query: {
          cephClusterId: options.cephClusterId,
          kind: kind,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          kind: true,
          externalId: true,
          name: true,
          hostname: true,
          daemonVersion: true,
          deviceClass: true,
          isUp: true,
          isIn: true,
          inQuorum: true,
          statBytes: true,
          statBytesUsed: true,
          applyLatencyMs: true,
          commitLatencyMs: true,
          pgCount: true,
          storedBytes: true,
          maxAvailBytes: true,
          objects: true,
          metricsUpdatedAt: true,
          lastSeenAt: true,
          createdAt: true,
        },
        sort: {
          externalId: SortOrder.Ascending,
        },
      });
    rows.push(...result.data);
  }
  return rows;
}

/**
 * Stale-cutoff numeric read: returns null (render "N/A") when the
 * row's metric mirror hasn't been refreshed within METRIC_STALE_MS.
 */
export function freshMetricValue(
  row: CephResourceModel,
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!row.metricsUpdatedAt) {
    return null;
  }
  const ageMs: number =
    Date.now() - new Date(row.metricsUpdatedAt as Date).getTime();
  if (ageMs > METRIC_STALE_MS) {
    return null;
  }
  return Number(value);
}

/**
 * Per-series average rate (per second) for cumulative counters, keyed
 * by a datapoint attribute (e.g. `pool_id`). Counter resets are
 * clamped to 0. Used for the Pools list IOPS columns — the inventory
 * table deliberately stores raw counters (readOpsCounter /
 * writeOpsCounter), so rates always come from ClickHouse rate math.
 */
export function computeRatePerSeriesKey(
  result: AggregatedResult,
  keyAttribute: string,
): Map<string, number> {
  type Sample = { t: number; v: number };
  const perKey: Map<string, Array<Sample>> = new Map();

  for (const p of (result.data || []) as Array<AggregatedModel>) {
    const attrs: Record<string, unknown> =
      (p["attributes"] as Record<string, unknown>) || {};
    const key: string = String(attrs[keyAttribute] ?? "");
    if (!key) {
      continue;
    }
    const raw: unknown =
      p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
    const t: number =
      raw instanceof Date ? raw.getTime() : new Date(raw as string).getTime();
    const v: number = Number(p["value"]);
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      continue;
    }
    let arr: Array<Sample> | undefined = perKey.get(key);
    if (!arr) {
      arr = [];
      perKey.set(key, arr);
    }
    arr.push({ t, v });
  }

  const rates: Map<string, number> = new Map();
  for (const [key, arr] of perKey.entries()) {
    arr.sort((a: Sample, b: Sample): number => {
      return a.t - b.t;
    });
    let deltaSum: number = 0;
    let dtSumSec: number = 0;
    for (let i: number = 1; i < arr.length; i++) {
      const dtSec: number = (arr[i]!.t - arr[i - 1]!.t) / 1000;
      if (dtSec <= 0) {
        continue;
      }
      deltaSum += Math.max(0, arr[i]!.v - arr[i - 1]!.v);
      dtSumSec += dtSec;
    }
    if (dtSumSec > 0) {
      rates.set(key, deltaSum / dtSumSec);
    }
  }
  return rates;
}

export function formatLastSeen(date: Date | undefined | null): string {
  if (!date) {
    return "never";
  }
  return OneUptimeDate.fromNow(new Date(date));
}

export default {
  METRIC_STALE_MS,
  formatBytes,
  formatPercent,
  formatCount,
  formatAge,
  compareDaemonNames,
  fetchCephResources,
  freshMetricValue,
  computeRatePerSeriesKey,
  formatLastSeen,
};
