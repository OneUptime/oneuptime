import Metric from "Common/Models/AnalyticsModels/Metric";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  CEPH_PG_REASON_STATES,
  CephHealthCheck,
  CephPgReasonStates,
  CephPoolPgStates,
} from "./CephHealth";

/*
 * What the Ceph pages read from the cluster's metrics beside its inventory:
 * the checks Ceph raises (ceph_health_detail, one series per check, 1 while
 * it is raised) and each pool's placement groups by state (ceph_pg_*, per
 * pool since Nautilus). The Overview, the Pools list and a pool's page read
 * them alike, so a pool's degraded placement groups read the same on all
 * three. Each read is the newest reading per series in the last 10 minutes:
 * the agent reads the mgr every 30 seconds.
 */

export const CEPH_LATEST_WINDOW_MINUTES: number = 10;

// The newest readings of a metric this read takes; newest first.
export const CEPH_LATEST_READINGS_LIMIT: number = 500;

const CLUSTER_ATTRIBUTE: string = "resource.ceph.cluster.name";

export type CephLatestPerLabel = Map<
  string,
  { value: number; attrs: Record<string, unknown> }
>;

/*
 * The newest reading of a metric per value of one of its labels (`pool_id`,
 * `name`); with no label (""), the newest reading of the metric under "".
 * `withoutLabel` leaves out the readings that carry it: the cluster's own
 * series of a metric that is also counted per pool.
 */
export async function loadCephLatestPerLabel(data: {
  clusterName: string;
  metricName: string;
  labelAttribute: string;
  withoutLabel?: string | undefined;
  windowMinutes?: number | undefined;
}): Promise<CephLatestPerLabel> {
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveMinutes(
    endDate,
    -(data.windowMinutes ?? CEPH_LATEST_WINDOW_MINUTES),
  );

  /*
   * `any`-typed, as the pages' own reads: the attributes filter with the
   * generic select is a TS2589 deep instantiation otherwise.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = {
    modelType: Metric,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!.toString(),
      name: data.metricName,
      time: new InBetween<Date>(startDate, endDate),
      attributes: {
        [CLUSTER_ATTRIBUTE]: data.clusterName,
      },
    },
    limit: CEPH_LATEST_READINGS_LIMIT,
    skip: 0,
    select: {
      time: true,
      value: true,
      attributes: true,
    },
    sort: {
      time: SortOrder.Descending,
    },
    requestOptions: {},
  };

  const result: ListResult<Metric> =
    await AnalyticsModelAPI.getList<Metric>(request);

  // Newest first, so the first reading per label value is its newest.
  const perKey: CephLatestPerLabel = new Map();
  for (const metric of result.data) {
    const attrs: Record<string, unknown> =
      (metric.attributes as Record<string, unknown>) || {};
    if (
      data.withoutLabel &&
      attrs[data.withoutLabel] !== undefined &&
      attrs[data.withoutLabel] !== null &&
      attrs[data.withoutLabel] !== ""
    ) {
      continue;
    }
    const key: string = String(attrs[data.labelAttribute] ?? "");
    if (!key && data.labelAttribute) {
      continue;
    }
    if (perKey.has(key)) {
      continue;
    }
    const value: number = Number(metric.value);
    if (Number.isFinite(value)) {
      perKey.set(key, { value: value, attrs: attrs });
    }
  }
  return perKey;
}

export interface CephHealthCheckReadings {
  // The checks raised now, as Ceph names them.
  checks: Array<CephHealthCheck>;
  /*
   * Whether this Ceph exports its checks at all: ceph_health_detail comes
   * with the mgr's prometheus module on Quincy and newer.
   */
  isExported: boolean;
}

export async function loadCephHealthChecks(
  clusterName: string,
): Promise<CephHealthCheckReadings> {
  const perCheck: CephLatestPerLabel = await loadCephLatestPerLabel({
    clusterName: clusterName,
    metricName: "ceph_health_detail",
    labelAttribute: "name",
  });

  const checks: Array<CephHealthCheck> = [];
  for (const [name, entry] of perCheck.entries()) {
    if (entry.value >= 1) {
      checks.push({
        name: name,
        severity: String(entry.attrs["severity"] || "HEALTH_WARN"),
      });
    }
  }

  return { checks: checks, isExported: perCheck.size > 0 };
}

export interface CephPgStateReadings {
  // Each pool's placement groups by state, by pool_id.
  byPool: Map<string, CephPoolPgStates>;
  // The cluster's, added up across its pools; null when none was read.
  totals: CephPoolPgStates | null;
}

const PG_STATE_METRICS: Array<{
  metricName: string;
  state: keyof CephPoolPgStates;
}> = [
  { metricName: "ceph_pg_total", state: "total" },
  { metricName: "ceph_pg_active", state: "active" },
  { metricName: "ceph_pg_clean", state: "clean" },
  { metricName: "ceph_pg_degraded", state: "degraded" },
  { metricName: "ceph_pg_undersized", state: "undersized" },
];

function emptyPgStates(): CephPoolPgStates {
  return {
    total: null,
    active: null,
    clean: null,
    degraded: null,
    undersized: null,
  };
}

/*
 * Each pool's placement groups by state, and the cluster's totals. Older
 * releases (Luminous, the first Mimic ones) export the counts cluster-wide
 * only, with no pool label: the totals fall back to those, and no pool
 * gets states of its own.
 */
export async function loadCephPgStates(
  clusterName: string,
): Promise<CephPgStateReadings> {
  const perMetric: Array<{
    state: keyof CephPoolPgStates;
    perPool: CephLatestPerLabel;
    clusterWide: number | null;
  }> = await Promise.all(
    PG_STATE_METRICS.map(
      async (metric: {
        metricName: string;
        state: keyof CephPoolPgStates;
      }): Promise<{
        state: keyof CephPoolPgStates;
        perPool: CephLatestPerLabel;
        clusterWide: number | null;
      }> => {
        const perPool: CephLatestPerLabel = await loadCephLatestPerLabel({
          clusterName: clusterName,
          metricName: metric.metricName,
          labelAttribute: "pool_id",
        });
        let clusterWide: number | null = null;
        if (perPool.size === 0) {
          const whole: CephLatestPerLabel = await loadCephLatestPerLabel({
            clusterName: clusterName,
            metricName: metric.metricName,
            labelAttribute: "",
            withoutLabel: "pool_id",
          });
          clusterWide = whole.get("")?.value ?? null;
        }
        return {
          state: metric.state,
          perPool: perPool,
          clusterWide: clusterWide,
        };
      },
    ),
  );

  const byPool: Map<string, CephPoolPgStates> = new Map();
  const totals: CephPoolPgStates = emptyPgStates();
  let anyRead: boolean = false;

  for (const entry of perMetric) {
    if (entry.perPool.size > 0) {
      let sum: number = 0;
      for (const [poolId, reading] of entry.perPool.entries()) {
        const states: CephPoolPgStates = byPool.get(poolId) || emptyPgStates();
        states[entry.state] = reading.value;
        byPool.set(poolId, states);
        sum += reading.value;
      }
      totals[entry.state] = sum;
      anyRead = true;
    } else if (entry.clusterWide !== null) {
      totals[entry.state] = entry.clusterWide;
      anyRead = true;
    }
  }

  return { byPool: byPool, totals: anyRead ? totals : null };
}

/*
 * Each pool's placement groups in the states that say what Ceph is doing
 * about missing copies (CEPH_PG_REASON_STATES: recovering, backfill_wait,
 * backfill_toofull...), by pool_id - Ceph's own reason for a pool's
 * degraded or undersized placement groups (#9727). Read when the bar's
 * Degraded or Undersized is pressed, not with the page: a count that is
 * rarely pressed costs nothing. A state the mgr reported no reading of in
 * the window is left out; a pool with none of them read has no entry.
 */
export async function loadCephPgReasonStates(
  clusterName: string,
): Promise<Map<string, CephPgReasonStates>> {
  const perState: Array<{ state: string; perPool: CephLatestPerLabel }> =
    await Promise.all(
      CEPH_PG_REASON_STATES.map(
        async (
          state: string,
        ): Promise<{ state: string; perPool: CephLatestPerLabel }> => {
          return {
            state: state,
            perPool: await loadCephLatestPerLabel({
              clusterName: clusterName,
              metricName: `ceph_pg_${state}`,
              labelAttribute: "pool_id",
            }),
          };
        },
      ),
    );

  const byPool: Map<string, CephPgReasonStates> = new Map();
  for (const entry of perState) {
    for (const [poolId, reading] of entry.perPool.entries()) {
      const states: CephPgReasonStates = byPool.get(poolId) || {};
      states[entry.state] = reading.value;
      byPool.set(poolId, states);
    }
  }
  return byPool;
}

/*
 * The same states for the whole cluster, on a Ceph that counts its
 * placement groups for the whole cluster only (#10016). Luminous's mgr
 * exports every ceph_pg_<state> with no pool_id - per-pool counts came in
 * a later Mimic release - so there Ceph says what it is doing about its
 * degraded and undersized placement groups for the cluster as a whole,
 * never for a pool. Null when it reported none of them in the window.
 */
export async function loadCephClusterPgReasonStates(
  clusterName: string,
): Promise<CephPgReasonStates | null> {
  const perState: Array<{ state: string; value: number | null }> =
    await Promise.all(
      CEPH_PG_REASON_STATES.map(
        async (
          state: string,
        ): Promise<{ state: string; value: number | null }> => {
          const whole: CephLatestPerLabel = await loadCephLatestPerLabel({
            clusterName: clusterName,
            metricName: `ceph_pg_${state}`,
            labelAttribute: "",
            withoutLabel: "pool_id",
          });
          return { state: state, value: whole.get("")?.value ?? null };
        },
      ),
    );

  const states: CephPgReasonStates = {};
  for (const entry of perState) {
    if (entry.value !== null) {
      states[entry.state] = entry.value;
    }
  }
  return Object.keys(states).length > 0 ? states : null;
}
