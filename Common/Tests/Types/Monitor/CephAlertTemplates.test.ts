import {
  CephAlertTemplate,
  CephAlertTemplateArgs,
  getAllCephAlertTemplates,
  getCephAlertTemplateById,
} from "../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../Types/Monitor/CephMetricCatalog";
import { getRecoveryThreshold } from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import {
  getComplementFilterType,
  hasRecoveryDeadBand,
} from "./Utils/RecommendationCriteriaAssertions";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepCephMonitor, {
  CephResourceScope,
} from "../../../Types/Monitor/MonitorStepCephMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * WI-20: lock in the Ceph alert-template contracts (v2 WI-9 + the v3
 * WI-26 health-check additions). Same two-layer shape as the Proxmox
 * twin:
 *
 *   1. ENUMERATED invariants over getAllCephAlertTemplates() — every
 *      template (current and future) must build a valid MonitorStep,
 *      reference only catalog metrics, resolve every criteria alias,
 *      group only by the raw `ceph_daemon` / `pool_id` datapoint labels,
 *      and use disjoint fire/recover thresholds. Health-check templates
 *      (ceph_health_detail / ceph_daemon_health_metrics) additionally
 *      MUST recover with NoDataPolicy.TreatAsZero: those series exist
 *      only while a check is active (Quincy+), so a bare "= 0" recover
 *      filter would never match after the series disappears and the
 *      monitor would wedge in the unhealthy state.
 *
 *   2. A per-template expectation table pins the spec'd v3 WI-26 rows
 *      (severity / filter / Past1Minute exceptions / the
 *      MON_DISK_CRIT / MON_DISK_LOW severity split) and the
 *      aggregation decisions: Sum/Sum for same-receiver RATIOS, and
 *      grouped Max/Max for the pg-inactive DIFFERENCE — a difference
 *      does not cancel the scrape multiple the way a ratio does, so
 *      ungrouped Sum reported a scrape-multiplied PG count and
 *      ungrouped Max would have hidden every pool but the largest.
 */

interface ThresholdExpectation {
  alias: string;
  filterType: FilterType;
  value: number;
}

interface CephQueryExpectation {
  alias: string;
  metricName: string;
  attributes: Record<string, string>;
}

interface CephTemplateExpectation {
  id: string;
  category: string;
  severity: string;
  rollingTime: RollingTime;
  // All queries of one template share an aggregation by construction.
  aggregation: MetricsAggregationType;
  queries: Array<CephQueryExpectation>;
  groupBy: string | null;
  formula: string | null;
  /*
   * One entry per unhealthy criteria instance, in evaluation order
   * (first-match-wins, worst tier first). Inner filters are OR'd
   * (FilterCondition.Any).
   */
  fireCriteria: Array<Array<ThresholdExpectation>>;
  recover: {
    filters: Array<ThresholdExpectation>;
    condition: FilterCondition;
    treatNoDataAsZero: boolean;
  };
}

const EXPECTED_TEMPLATES: Array<CephTemplateExpectation> = [
  {
    id: "ceph-health-error",
    category: "Cluster Health",
    severity: "Critical",
    rollingTime: RollingTime.Past1Minute,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "ceph_health_error",
        metricName: "ceph_health_status",
        attributes: {},
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "ceph_health_error",
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 2,
        },
      ],
    ],
    recover: {
      filters: [
        {
          alias: "ceph_health_error",
          filterType: FilterType.LessThan,
          value: 2,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-health-warn",
    category: "Cluster Health",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "ceph_health",
        metricName: "ceph_health_status",
        attributes: {},
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "ceph_health",
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 1,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "ceph_health", filterType: FilterType.LessThan, value: 1 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-osd-down",
    category: "OSD",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Min,
    queries: [{ alias: "osd_up", metricName: "ceph_osd_up", attributes: {} }],
    groupBy: "ceph_daemon",
    formula: null,
    fireCriteria: [
      [{ alias: "osd_up", filterType: FilterType.LessThan, value: 1 }],
    ],
    recover: {
      filters: [
        {
          alias: "osd_up",
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 1,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-osd-out",
    category: "OSD",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Min,
    queries: [{ alias: "osd_in", metricName: "ceph_osd_in", attributes: {} }],
    groupBy: "ceph_daemon",
    formula: null,
    fireCriteria: [
      [{ alias: "osd_in", filterType: FilterType.LessThan, value: 1 }],
    ],
    recover: {
      filters: [
        {
          alias: "osd_in",
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 1,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-osd-high-latency",
    category: "OSD",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Avg,
    queries: [
      {
        alias: "osd_apply_latency",
        metricName: "ceph_osd_apply_latency_ms",
        attributes: {},
      },
    ],
    groupBy: "ceph_daemon",
    formula: null,
    fireCriteria: [
      [
        {
          alias: "osd_apply_latency",
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      ],
    ],
    recover: {
      filters: [
        {
          alias: "osd_apply_latency",
          filterType: FilterType.LessThanOrEqualTo,
          value: 100,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-mon-quorum-degraded",
    category: "Cluster Health",
    severity: "Critical",
    rollingTime: RollingTime.Past1Minute,
    aggregation: MetricsAggregationType.Min,
    queries: [
      {
        alias: "mon_quorum",
        metricName: "ceph_mon_quorum_status",
        attributes: {},
      },
    ],
    groupBy: "ceph_daemon",
    formula: null,
    fireCriteria: [
      [{ alias: "mon_quorum", filterType: FilterType.LessThan, value: 1 }],
    ],
    recover: {
      filters: [
        {
          alias: "mon_quorum",
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 1,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    /*
     * ceph_pg_degraded is a PER-POOL gauge (pool_id label). Grouped Max
     * reports the pool's own degraded count and names the pool; ungrouped
     * Max reported the largest pool's count as if it were a cluster total.
     */
    id: "ceph-pg-degraded",
    category: "PG",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      { alias: "pg_degraded", metricName: "ceph_pg_degraded", attributes: {} },
    ],
    groupBy: "pool_id",
    formula: null,
    fireCriteria: [
      [{ alias: "pg_degraded", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "pg_degraded", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    // Per-pool gauge, same contract as ceph-pg-degraded above.
    id: "ceph-pg-undersized",
    category: "PG",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "pg_undersized",
        metricName: "ceph_pg_undersized",
        attributes: {},
      },
    ],
    groupBy: "pool_id",
    formula: null,
    fireCriteria: [
      [
        {
          alias: "pg_undersized",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "pg_undersized", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    /*
     * GROUPED Max/Max difference. ceph_pg_total / ceph_pg_active are
     * PER-POOL series, and a difference does not cancel the scrape
     * multiple the way a ratio does: ungrouped Sum/Sum folded both the
     * pools AND the two 30s scrapes inside each one-minute bucket into the
     * value, so a cluster with 3 inactive PGs was alerted as "6". Grouped
     * Max de-duplicates the scrapes per (pool, minute) and yields that
     * pool's exact inactive count. Ungrouped Max would be wrong for the
     * opposite reason — each side collapses to the largest pool — so the
     * group-by and the aggregation belong together.
     */
    id: "ceph-pg-inactive",
    category: "PG",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      { alias: "pg_total", metricName: "ceph_pg_total", attributes: {} },
      { alias: "pg_active", metricName: "ceph_pg_active", attributes: {} },
    ],
    groupBy: "pool_id",
    formula: "pg_total - pg_active",
    fireCriteria: [
      [{ alias: "pg_inactive", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "pg_inactive", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-cluster-near-full",
    category: "Capacity",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Sum,
    queries: [
      {
        alias: "used_bytes",
        metricName: "ceph_cluster_total_used_bytes",
        attributes: {},
      },
      {
        alias: "total_bytes",
        metricName: "ceph_cluster_total_bytes",
        attributes: {},
      },
    ],
    groupBy: null,
    formula: "(used_bytes / total_bytes) * 100",
    fireCriteria: [
      [
        {
          alias: "cluster_used_percent",
          filterType: FilterType.GreaterThan,
          value: 85,
        },
      ],
    ],
    recover: {
      filters: [
        {
          alias: "cluster_used_percent",
          filterType: FilterType.LessThanOrEqualTo,
          value: 85,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-cluster-full",
    category: "Capacity",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Sum,
    queries: [
      {
        alias: "used_bytes",
        metricName: "ceph_cluster_total_used_bytes",
        attributes: {},
      },
      {
        alias: "total_bytes",
        metricName: "ceph_cluster_total_bytes",
        attributes: {},
      },
    ],
    groupBy: null,
    formula: "(used_bytes / total_bytes) * 100",
    fireCriteria: [
      [
        {
          alias: "cluster_used_percent",
          filterType: FilterType.GreaterThan,
          value: 95,
        },
      ],
    ],
    recover: {
      filters: [
        {
          alias: "cluster_used_percent",
          filterType: FilterType.LessThanOrEqualTo,
          value: 95,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-pool-near-full",
    category: "Capacity",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Sum,
    queries: [
      { alias: "pool_stored", metricName: "ceph_pool_stored", attributes: {} },
      {
        alias: "pool_max_avail",
        metricName: "ceph_pool_max_avail",
        attributes: {},
      },
    ],
    groupBy: "pool_id",
    formula: "(pool_stored / (pool_stored + pool_max_avail)) * 100",
    fireCriteria: [
      [
        {
          alias: "pool_used_percent",
          filterType: FilterType.GreaterThan,
          value: 85,
        },
      ],
    ],
    recover: {
      filters: [
        {
          alias: "pool_used_percent",
          filterType: FilterType.LessThanOrEqualTo,
          value: 85,
        },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  {
    id: "ceph-slow-ops",
    category: "Cluster Health",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "slow_ops",
        metricName: "ceph_healthcheck_slow_ops",
        attributes: {},
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [{ alias: "slow_ops", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "slow_ops", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: false,
    },
  },
  /*
   * --- V3 WI-26 health-check templates ---
   * Spec table (ProxmoxCephProductsV3.md §WI-26): all fire Max > 0 /
   * recover = 0 (TreatAsZero), Past5Minutes unless noted.
   */
  {
    /*
     * PG_DAMAGED OR OSD_SCRUB_ERRORS — two queries, NO formula ("a + b"
     * would yield nothing while one check is inactive).
     */
    id: "ceph-pg-damaged",
    category: "PG",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "pg_damaged",
        metricName: "ceph_health_detail",
        attributes: { name: "PG_DAMAGED" },
      },
      {
        alias: "scrub_errors",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_SCRUB_ERRORS" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        { alias: "pg_damaged", filterType: FilterType.GreaterThan, value: 0 },
        { alias: "scrub_errors", filterType: FilterType.GreaterThan, value: 0 },
      ],
    ],
    recover: {
      filters: [
        { alias: "pg_damaged", filterType: FilterType.EqualTo, value: 0 },
        { alias: "scrub_errors", filterType: FilterType.EqualTo, value: 0 },
      ],
      // Recovery requires BOTH checks clear — complement of the Any fire.
      condition: FilterCondition.All,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-daemon-crash",
    category: "Cluster Health",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "recent_crash",
        metricName: "ceph_health_detail",
        attributes: { name: "RECENT_CRASH" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [{ alias: "recent_crash", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "recent_crash", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-osd-slow-heartbeats",
    category: "OSD",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "slow_ping_front",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_SLOW_PING_TIME_FRONT" },
      },
      {
        alias: "slow_ping_back",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_SLOW_PING_TIME_BACK" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "slow_ping_front",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
        {
          alias: "slow_ping_back",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "slow_ping_front", filterType: FilterType.EqualTo, value: 0 },
        { alias: "slow_ping_back", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.All,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-mon-clock-skew",
    category: "Cluster Health",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "mon_clock_skew",
        metricName: "ceph_health_detail",
        attributes: { name: "MON_CLOCK_SKEW" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "mon_clock_skew",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "mon_clock_skew", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-osd-nearfull",
    category: "Capacity",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "osd_nearfull",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_NEARFULL" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [{ alias: "osd_nearfull", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "osd_nearfull", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-osd-backfillfull",
    category: "Capacity",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "osd_backfillfull",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_BACKFILLFULL" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "osd_backfillfull",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "osd_backfillfull", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    // Past1Minute per the spec table: writes are already blocked.
    id: "ceph-osd-full",
    category: "Capacity",
    severity: "Critical",
    rollingTime: RollingTime.Past1Minute,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "osd_full",
        metricName: "ceph_health_detail",
        attributes: { name: "OSD_FULL" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [{ alias: "osd_full", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "osd_full", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    /*
     * MON_DISK_CRIT and MON_DISK_LOW are two SEPARATE templates, not two
     * tiers of one. The create flow stamps every criteria instance in a step
     * with the recommendation's single declared severity, so a Warning tier
     * riding along inside this Critical template paged at Critical.
     */
    id: "ceph-mon-disk-space",
    category: "Cluster Health",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "mon_disk_crit",
        metricName: "ceph_health_detail",
        attributes: { name: "MON_DISK_CRIT" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [
        {
          alias: "mon_disk_crit",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "mon_disk_crit", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-mon-disk-low",
    category: "Cluster Health",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "mon_disk_low",
        metricName: "ceph_health_detail",
        attributes: { name: "MON_DISK_LOW" },
      },
    ],
    groupBy: null,
    formula: null,
    fireCriteria: [
      [{ alias: "mon_disk_low", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "mon_disk_low", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
  {
    id: "ceph-daemon-slow-ops",
    category: "Cluster Health",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      {
        alias: "daemon_slow_ops",
        metricName: "ceph_daemon_health_metrics",
        attributes: { type: "SLOW_OPS" },
      },
    ],
    groupBy: "ceph_daemon",
    formula: null,
    fireCriteria: [
      [
        {
          alias: "daemon_slow_ops",
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ],
    ],
    recover: {
      filters: [
        { alias: "daemon_slow_ops", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.Any,
      treatNoDataAsZero: true,
    },
  },
];

function buildArgs(): CephAlertTemplateArgs {
  return {
    clusterIdentifier: "ceph-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getCephMonitor(step: MonitorStep): MonitorStepCephMonitor {
  const cephMonitor: MonitorStepCephMonitor | undefined =
    step.data?.cephMonitor;
  if (!cephMonitor) {
    throw new Error("cephMonitor missing from monitor step");
  }
  return cephMonitor;
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  const instances: Array<MonitorCriteriaInstance> | undefined =
    step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray;
  if (!instances || instances.length === 0) {
    throw new Error("monitorCriteria missing from monitor step");
  }
  return instances;
}

function getReferencableAliases(monitor: MonitorStepCephMonitor): Set<string> {
  const aliases: Set<string> = new Set<string>();
  for (const queryConfig of monitor.metricViewConfig
    .queryConfigs as Array<any>) {
    aliases.add(queryConfig.metricAliasData.metricVariable);
  }
  for (const formulaConfig of (monitor.metricViewConfig.formulaConfigs ||
    []) as Array<any>) {
    aliases.add(formulaConfig.metricAliasData.metricVariable);
  }
  return aliases;
}

/*
 * Delegates to the shared assertion so all eight recommendation suites
 * agree on what a correct fire/recover pair looks like. This function used
 * to require `fire.value === recover.value` — see the comment in
 * RecommendationCriteriaAssertions for why that was the bug rather than
 * the invariant.
 */
function isDisjointComplement(
  fire: { filterType: FilterType; value: number },
  recover: { filterType: FilterType; value: number },
): boolean {
  return hasRecoveryDeadBand(fire, recover);
}

// Health-check series exist only while their check is active.
function isHealthCheckMetric(metricName: string): boolean {
  return (
    metricName === "ceph_health_detail" ||
    metricName === "ceph_daemon_health_metrics"
  );
}

const ALL_TEMPLATES: Array<CephAlertTemplate> = getAllCephAlertTemplates();

describe("CephAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return t.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: CephTemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });
});

describe("CephAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: CephAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepCephMonitor = getCephMonitor(step);

    // The cluster attribute is injected from the template args.
    expect(monitor.clusterIdentifier).toBe(args.clusterIdentifier);
    expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    /*
     * One unhealthy instance plus the Healthy recovery. Asserted as
     * at-least-2 rather than exactly-2 so a future template may add an extra
     * unhealthy tier — but only where every tier means the SAME severity,
     * because the create flow stamps one severity across the whole step.
     */
    expect(instances.length).toBeGreaterThanOrEqual(2);

    const offlineInstances: Array<MonitorCriteriaInstance> = instances.slice(
      0,
      -1,
    );
    const onlineInstance: MonitorCriteriaInstance =
      instances[instances.length - 1]!;

    for (const offline of offlineInstances) {
      expect(offline.data?.monitorStatusId).toBe(args.offlineMonitorStatusId);
      expect(offline.data?.createIncidents).toBe(true);
      expect(offline.data?.createAlerts).toBe(true);
      expect(offline.data?.incidents).toHaveLength(1);
      expect(offline.data?.alerts).toHaveLength(1);
      expect(offline.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
      expect(offline.data?.alerts?.[0]?.autoResolveAlert).toBe(true);
    }

    expect(onlineInstance.data?.monitorStatusId).toBe(
      args.onlineMonitorStatusId,
    );
    expect(onlineInstance.data?.createIncidents).toBe(false);
    expect(onlineInstance.data?.createAlerts).toBe(false);
    expect(onlineInstance.data?.name).toBe("Healthy");
  });

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getCephMetricByMetricName(metricName)).toBeDefined();
      }

      const aliases: Set<string> = getReferencableAliases(monitor);
      for (const instance of getCriteriaInstances(step)) {
        for (const filter of instance.data?.filters || []) {
          expect(aliases).toContain(
            (filter as any).metricMonitorOptions.metricAlias,
          );
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by raw datapoint labels only (ceph_daemon / pool_id)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const groupBys: Array<string> =
          queryConfig.metricQueryData.groupByAttributeKeys || [];
        for (const key of groupBys) {
          /*
           * ceph-mgr identity labels are datapoint labels — never
           * `resource.`-prefixed in ClickHouse.
           */
          expect(["ceph_daemon", "pool_id"]).toContain(key);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups every per-pool metric by pool_id",
    (_id: unknown, template: unknown) => {
      /*
       * REGRESSION (ceph-pg-degraded / ceph-pg-undersized / ceph-pg-inactive):
       * every ceph_pg_* and ceph_pool_* series is exported PER POOL with a
       * `pool_id` datapoint label — there is no cluster-wide gauge. Without a
       * group-by the whole pool fan-out collapses into ONE number: the
       * ungrouped aggregation folds every pool together, so the alert printed
       * the worst single pool's count (Max) or a scrape-multiplied sum (Sum)
       * and presented it as a cluster total, and the evaluator never produced
       * seriesLabels, so the incident could not name the pool the operator has
       * to go look at.
       *
       * Driven off the catalog's own defaultResourceScope so any FUTURE
       * per-pool template inherits the rule instead of repeating the mistake.
       */
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;

        if (
          getCephMetricByMetricName(metricName)?.defaultResourceScope !==
          CephResourceScope.Pool
        ) {
          continue;
        }

        expect(queryConfig.metricQueryData.groupByAttributeKeys || []).toEqual([
          "pool_id",
        ]);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups every per-daemon metric by ceph_daemon",
    (_id: unknown, template: unknown) => {
      /*
       * The mirror of the pool rule: OSD- and Mon-scoped series carry a
       * `ceph_daemon` label, so one incident must fire per daemon. This locks
       * in the existing osd-down / osd-out / osd-high-latency / mon-quorum /
       * daemon-slow-ops choices against the same collapse.
       */
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        const scope: CephResourceScope | undefined =
          getCephMetricByMetricName(metricName)?.defaultResourceScope;

        if (
          scope !== CephResourceScope.Osd &&
          scope !== CephResourceScope.Mon
        ) {
          continue;
        }

        expect(queryConfig.metricQueryData.groupByAttributeKeys || []).toEqual([
          "ceph_daemon",
        ]);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s never subtracts two ungrouped per-series metrics",
    (_id: unknown, template: unknown) => {
      /*
       * REGRESSION (ceph-pg-inactive): an UNGROUPED difference has no correct
       * aggregation at all, which is why this is asserted as its own
       * invariant rather than left to the aggregation rule above.
       *
       * A one-minute bucket holds one row per (series, scrape) and the shipped
       * agent scrapes every 30s, so ungrouped Sum returns 2·Σpools — a cluster
       * with 3 inactive PGs was alerted as "6", and as a different multiple in
       * each bucket of the window because the bucket boundaries do not divide
       * the scrape train evenly. Ungrouped Max is worse: it collapses each
       * side to the largest pool and the difference stops meaning anything.
       * Only grouping makes the subtraction well-defined.
       */
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);
      const formulaConfigs: Array<any> = (monitor.metricViewConfig
        .formulaConfigs || []) as Array<any>;

      for (const formulaConfig of formulaConfigs) {
        const formula: string =
          formulaConfig.metricFormulaData.metricFormula || "";

        if (!formula.includes("-")) {
          continue;
        }

        for (const queryConfig of monitor.metricViewConfig
          .queryConfigs as Array<any>) {
          expect(
            (queryConfig.metricQueryData.groupByAttributeKeys || []).length,
          ).toBeGreaterThan(0);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const onlineFilters: Array<any> = (instances[instances.length - 1]!.data
        ?.filters || []) as Array<any>;

      for (const offline of instances.slice(0, -1)) {
        for (const fireFilter of (offline.data?.filters || []) as Array<any>) {
          const recoverFilter: any = onlineFilters.find((f: any) => {
            return (
              f.metricMonitorOptions.metricAlias ===
              fireFilter.metricMonitorOptions.metricAlias
            );
          });
          expect(recoverFilter).toBeDefined();
          expect(
            isDisjointComplement(
              {
                filterType: fireFilter.filterType,
                value: fireFilter.value as number,
              },
              {
                filterType: recoverFilter.filterType,
                value: recoverFilter.value as number,
              },
            ),
          ).toBe(true);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s health-check recovery treats missing series as zero",
    (_id: unknown, template: unknown) => {
      /*
       * ceph_health_detail / ceph_daemon_health_metrics series exist
       * ONLY while the check is active, and the evaluator's default
       * NoDataPolicy is Ignore — so a "= 0" recover filter without
       * TreatAsZero would never match after the series disappears and
       * the monitor would never return to Healthy. This invariant is
       * enumerated so any future health-check template inherits it.
       */
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      const usesHealthCheckSeries: boolean = (
        monitor.metricViewConfig.queryConfigs as Array<any>
      ).some((queryConfig: any) => {
        return isHealthCheckMetric(
          queryConfig.metricQueryData.filterData.metricName,
        );
      });

      if (!usesHealthCheckSeries) {
        return;
      }

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const onlineFilters: Array<any> = (instances[instances.length - 1]!.data
        ?.filters || []) as Array<any>;

      expect(onlineFilters.length).toBeGreaterThan(0);
      for (const filter of onlineFilters) {
        expect(filter.metricMonitorOptions.onNoDataPolicy).toBe(
          NoDataPolicy.TreatAsZero,
        );
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: CephAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s formula queries share one aggregation, chosen by formula shape",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as CephAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);
      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      const formulaConfigs: Array<any> = (monitor.metricViewConfig
        .formulaConfigs || []) as Array<any>;

      if (formulaConfigs.length === 0) {
        return;
      }

      expect(formulaConfigs).toHaveLength(1);

      const formula: string =
        formulaConfigs[0].metricFormulaData.metricFormula || "";
      const isDifference: boolean = formula.includes("-");
      const isGrouped: boolean =
        (queryConfigs[0].metricQueryData.groupByAttributeKeys || []).length > 0;

      /*
       * Every Ceph metric rides ONE receiver (the active mgr scrape), so
       * both sides of a formula must share ONE aggregation. WHICH one is a
       * function of the shape:
       *
       *  - RATIO: Sum. The per-bucket scrape multiple cancels between the
       *    numerator and the denominator, so the percentage is exact.
       *  - grouped DIFFERENCE: Max. Nothing cancels, so Sum would add the
       *    identical scrapes inside one (series, minute) bucket and
       *    multiply the reported count. Max de-duplicates them.
       *  - ungrouped DIFFERENCE: there is NO correct aggregation — Sum
       *    multiplies by the scrape count, Max collapses each side to the
       *    largest series. The separate "difference formulas must be
       *    grouped" invariant below rejects that shape outright.
       */
      const expectedAggregation: MetricsAggregationType =
        isGrouped && isDifference
          ? MetricsAggregationType.Max
          : MetricsAggregationType.Sum;

      for (const queryConfig of queryConfigs) {
        expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
          expectedAggregation,
        );
      }

      // All sides must share the same groupBy so the join lines up.
      const firstGroupBy: Array<string> =
        queryConfigs[0].metricQueryData.groupByAttributeKeys || [];
      for (const queryConfig of queryConfigs) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys || []).toEqual(
          firstGroupBy,
        );
      }
    },
  );
});

describe("CephAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: CephTemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: CephTemplateExpectation = expected as CephTemplateExpectation;
      const template: CephAlertTemplate | undefined = getCephAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();

      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepCephMonitor = getCephMonitor(step);

      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(tc.queries.length);

      for (let i: number = 0; i < tc.queries.length; i++) {
        const expectedQuery: CephQueryExpectation = tc.queries[i]!;
        expect(queryConfigs[i].metricAliasData.metricVariable).toBe(
          expectedQuery.alias,
        );
        const filterData: any = queryConfigs[i].metricQueryData.filterData;
        expect(filterData.metricName).toBe(expectedQuery.metricName);
        expect(filterData.aggegationType).toBe(tc.aggregation);
        expect(filterData.attributes).toEqual(expectedQuery.attributes);

        const groupBys: Array<string> =
          queryConfigs[i].metricQueryData.groupByAttributeKeys || [];
        expect(groupBys).toEqual(tc.groupBy ? [tc.groupBy] : []);
      }

      const formulaConfigs: Array<any> = (monitor.metricViewConfig
        .formulaConfigs || []) as Array<any>;
      if (tc.formula) {
        expect(formulaConfigs).toHaveLength(1);
        expect(formulaConfigs[0].metricFormulaData.metricFormula).toBe(
          tc.formula,
        );
      } else {
        // Multi-query health-check templates must NOT use a formula.
        expect(formulaConfigs).toHaveLength(0);
      }

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      // Unhealthy tiers in spec order (worst first), then the recover.
      expect(instances).toHaveLength(tc.fireCriteria.length + 1);

      for (let i: number = 0; i < tc.fireCriteria.length; i++) {
        const expectedFilters: Array<ThresholdExpectation> =
          tc.fireCriteria[i]!;
        const instance: MonitorCriteriaInstance = instances[i]!;
        // Multi-filter unhealthy instances are OR'd.
        expect(instance.data?.filterCondition).toBe(FilterCondition.Any);
        const filters: Array<any> = instance.data?.filters as Array<any>;
        expect(filters).toHaveLength(expectedFilters.length);
        for (let j: number = 0; j < expectedFilters.length; j++) {
          expect(filters[j].metricMonitorOptions.metricAlias).toBe(
            expectedFilters[j]!.alias,
          );
          expect(filters[j].filterType).toBe(expectedFilters[j]!.filterType);
          expect(filters[j].value).toBe(expectedFilters[j]!.value);
        }
      }

      const onlineInstance: MonitorCriteriaInstance =
        instances[instances.length - 1]!;
      expect(onlineInstance.data?.filterCondition).toBe(tc.recover.condition);
      const onlineFilters: Array<any> = onlineInstance.data
        ?.filters as Array<any>;
      expect(onlineFilters).toHaveLength(tc.recover.filters.length);
      for (let j: number = 0; j < tc.recover.filters.length; j++) {
        const expectedFilter: ThresholdExpectation = tc.recover.filters[j]!;
        expect(onlineFilters[j].metricMonitorOptions.metricAlias).toBe(
          expectedFilter.alias,
        );
        expect(onlineFilters[j].filterType).toBe(expectedFilter.filterType);
        /*
         * The spec table states the FIRING threshold. The recovery
         * threshold is derived from it, so the table does not have to
         * restate every dead-banded number — and so a change to the dead
         * band shows up as a behaviour change in one place rather than as
         * a diff across nine spec tables.
         */
        expect(onlineFilters[j].value).toBe(
          getRecoveryThreshold({
            filterType: getComplementFilterType(expectedFilter.filterType)!,
            value: expectedFilter.value,
          }) ?? expectedFilter.value,
        );
        if (tc.recover.treatNoDataAsZero) {
          expect(onlineFilters[j].metricMonitorOptions.onNoDataPolicy).toBe(
            NoDataPolicy.TreatAsZero,
          );
        } else {
          expect(
            onlineFilters[j].metricMonitorOptions.onNoDataPolicy,
          ).toBeUndefined();
        }
      }
    },
  );
});

describe("CephAlertTemplates - per-pool PG accounting regressions", () => {
  /*
   * These three templates read ceph_pg_* series, which the mgr exports once
   * per pool. They all shipped UNGROUPED, which is what produced the
   * "the values do not make any sense at all" reports: with no group-by the
   * whole pool fan-out is folded into one number before the threshold is
   * ever compared, and no seriesLabels are produced so the incident cannot
   * say which pool it is about.
   *
   * The spec table above already pins the resulting config; these tests
   * restate the defect by name so a revert fails with a sentence that
   * explains itself rather than with an opaque table mismatch.
   */

  function getQueryConfigs(templateId: string): Array<any> {
    const template: CephAlertTemplate | undefined =
      getCephAlertTemplateById(templateId);
    expect(template).toBeDefined();

    const monitor: MonitorStepCephMonitor = getCephMonitor(
      template!.getMonitorStep(buildArgs()),
    );

    return monitor.metricViewConfig.queryConfigs as Array<any>;
  }

  test.each([
    ["ceph-pg-degraded", "ceph_pg_degraded"],
    ["ceph-pg-undersized", "ceph_pg_undersized"],
  ])(
    "%s counts one pool's PGs, not the largest pool's presented as a cluster total",
    (templateId: string, metricName: string) => {
      // The catalog is the source of truth for the scope this rule keys off.
      expect(getCephMetricByMetricName(metricName)?.defaultResourceScope).toBe(
        CephResourceScope.Pool,
      );

      const queryConfigs: Array<any> = getQueryConfigs(templateId);
      expect(queryConfigs).toHaveLength(1);

      /*
       * Grouped: one incident per pool, and the pool_id reaches the alert.
       * Ungrouped Max — what this shipped as — reported max-across-pools as
       * if it were a cluster-wide degraded/undersized count.
       */
      expect(queryConfigs[0].metricQueryData.groupByAttributeKeys).toEqual([
        "pool_id",
      ]);

      /*
       * Max, not Sum, is the correct reduction WITHIN a (pool, minute)
       * bucket: the agent scrapes every 30s and buckets are one minute
       * wide, so the bucket holds two identical samples of the same gauge.
       */
      expect(queryConfigs[0].metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
    },
  );

  test("ceph-pg-inactive reports a pool's exact inactive count, not a scrape-multiplied one", () => {
    const queryConfigs: Array<any> = getQueryConfigs("ceph-pg-inactive");

    // pg_total and pg_active — both per-pool, both on the same mgr scrape.
    expect(queryConfigs).toHaveLength(2);

    for (const queryConfig of queryConfigs) {
      expect(
        getCephMetricByMetricName(
          queryConfig.metricQueryData.filterData.metricName,
        )?.defaultResourceScope,
      ).toBe(CephResourceScope.Pool);

      /*
       * Both sides must be grouped identically or the per-series join has
       * nothing to line up on, and the difference stops being a difference.
       */
      expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
        "pool_id",
      ]);

      /*
       * THE DEFECT: this shipped as ungrouped Sum/Sum. Sum preserves the
       * SIGN of the difference (k·Total - k·Active = k·Inactive), so the
       * "> 0" threshold still tripped correctly and no test caught it — but
       * the VALUE handed to the alert body was multiplied by the number of
       * scrapes in the bucket, so a cluster with 3 inactive PGs was paged as
       * 6. Grouped Max de-duplicates those scrapes.
       */
      expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );
      expect(queryConfig.metricQueryData.filterData.aggegationType).not.toBe(
        MetricsAggregationType.Sum,
      );
    }
  });

  test("ratio formulas keep Sum on both sides — only differences moved to Max", () => {
    /*
     * The fix is scoped to DIFFERENCES. A ratio's scrape multiple cancels
     * between numerator and denominator, so Sum stays exactly right there;
     * flipping the capacity templates to Max would silently change them
     * from "the pool's share of its writable capacity" to "the largest
     * sample in the bucket".
     */
    for (const templateId of [
      "ceph-cluster-near-full",
      "ceph-cluster-full",
      "ceph-pool-near-full",
    ]) {
      for (const queryConfig of getQueryConfigs(templateId)) {
        expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
          MetricsAggregationType.Sum,
        );
      }
    }
  });
});

describe("CephAlertTemplates - mon-disk severity split regression", () => {
  test("the two mon-disk tiers are separate templates with different severities", () => {
    /*
     * THE DEFECT: MON_DISK_CRIT and MON_DISK_LOW used to be two criteria
     * tiers inside ONE template declared "Critical".
     *
     * Severity is per-RECOMMENDATION, not per-criteria: the create flow
     * resolves one severity from the recommendation and stamps it onto every
     * criteria instance in the step
     * (MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep), so
     * the MON_DISK_LOW tier — a mon disk merely below 30% free, with days of
     * headroom — opened incidents at the project's top severity and paged
     * whatever on-call policy is attached to Critical, while the
     * recommendation card promised Warning. Threading a second severity id
     * through the template args cannot fix it; two severities need two
     * templates.
     */
    const critical: CephAlertTemplate | undefined = getCephAlertTemplateById(
      "ceph-mon-disk-space",
    );
    const warning: CephAlertTemplate | undefined =
      getCephAlertTemplateById("ceph-mon-disk-low");

    expect(critical).toBeDefined();
    expect(warning).toBeDefined();
    expect(critical!.severity).toBe("Critical");
    expect(warning!.severity).toBe("Warning");

    // Each watches exactly its own health check, and only its own.
    const readWatchedCheckNames: (
      template: CephAlertTemplate,
    ) => Array<string> = (template: CephAlertTemplate): Array<string> => {
      const monitor: MonitorStepCephMonitor = getCephMonitor(
        template.getMonitorStep(buildArgs()),
      );

      return (monitor.metricViewConfig.queryConfigs as Array<any>).map(
        (queryConfig: any) => {
          return queryConfig.metricQueryData.filterData.attributes["name"];
        },
      );
    };

    expect(readWatchedCheckNames(critical!)).toEqual(["MON_DISK_CRIT"]);
    expect(readWatchedCheckNames(warning!)).toEqual(["MON_DISK_LOW"]);
  });

  /*
   * The GENERAL form of this rule — "every recommendation ships exactly one
   * unhealthy criteria, because one severity is stamped across the whole
   * step" — is enumerated over the entire catalog in
   * MonitorRecommendationNotificationMode.test.ts, so it is not repeated per
   * resource type here. The test above pins the Ceph-specific instance of the
   * defect by name.
   */
});
