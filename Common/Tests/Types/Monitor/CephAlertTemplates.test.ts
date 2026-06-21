import {
  CephAlertTemplate,
  CephAlertTemplateArgs,
  getAllCephAlertTemplates,
  getCephAlertTemplateById,
} from "../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../Types/Monitor/CephMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepCephMonitor from "../../../Types/Monitor/MonitorStepCephMonitor";
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
 *      MON_DISK_CRIT-before-MON_DISK_LOW criteria ordering) and the v2
 *      decisions (Sum/Sum same-receiver ratios; the pg-inactive
 *      Sum-difference fix — Max/Max would hide inactive PGs in every
 *      pool but the largest).
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
    id: "ceph-pg-degraded",
    category: "PG",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    queries: [
      { alias: "pg_degraded", metricName: "ceph_pg_degraded", attributes: {} },
    ],
    groupBy: null,
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
    groupBy: null,
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
     * Sum/Sum difference — ceph_pg_total / ceph_pg_active are PER-POOL
     * series; Sum folds every pool into a cluster count and the scrape
     * multiple scales both terms equally. Max would collapse each side
     * to the largest pool and this Critical alert would never fire for
     * inactive PGs in any other pool.
     */
    id: "ceph-pg-inactive",
    category: "PG",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Sum,
    queries: [
      { alias: "pg_total", metricName: "ceph_pg_total", attributes: {} },
      { alias: "pg_active", metricName: "ceph_pg_active", attributes: {} },
    ],
    groupBy: null,
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
     * Two-tier template: MON_DISK_CRIT (Critical) is evaluated BEFORE
     * MON_DISK_LOW (Warning) — criteria are first-match-wins, so the
     * worst tier must come first or it could never fire.
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
      {
        alias: "mon_disk_low",
        metricName: "ceph_health_detail",
        attributes: { name: "MON_DISK_LOW" },
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
      [{ alias: "mon_disk_low", filterType: FilterType.GreaterThan, value: 0 }],
    ],
    recover: {
      filters: [
        { alias: "mon_disk_crit", filterType: FilterType.EqualTo, value: 0 },
        { alias: "mon_disk_low", filterType: FilterType.EqualTo, value: 0 },
      ],
      condition: FilterCondition.All,
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

function isDisjointComplement(
  fire: { filterType: FilterType; value: number },
  recover: { filterType: FilterType; value: number },
): boolean {
  if (fire.value !== recover.value) {
    return false;
  }
  switch (fire.filterType) {
    case FilterType.GreaterThan:
      return (
        recover.filterType === FilterType.LessThanOrEqualTo ||
        (fire.value === 0 && recover.filterType === FilterType.EqualTo)
      );
    case FilterType.GreaterThanOrEqualTo:
      return recover.filterType === FilterType.LessThan;
    case FilterType.LessThan:
      return recover.filterType === FilterType.GreaterThanOrEqualTo;
    case FilterType.LessThanOrEqualTo:
      return recover.filterType === FilterType.GreaterThan;
    default:
      return false;
  }
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
     * ceph-mon-disk-space carries a third (Warning-tier) instance —
     * assert at-least-2, never exactly-2.
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
    "%s ratio/formula queries use Sum on both sides (same-receiver contract)",
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

      /*
       * Every Ceph metric rides ONE receiver (the active mgr scrape),
       * so every formula — ratio or difference — must aggregate Sum on
       * every side: the scrape multiple cancels (ratios) or scales both
       * terms equally (differences). Max/Max would collapse ungrouped
       * per-pool series to the largest pool and hide every other pool.
       */
      expect(formulaConfigs).toHaveLength(1);
      for (const queryConfig of queryConfigs) {
        expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
          MetricsAggregationType.Sum,
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
        expect(onlineFilters[j].value).toBe(expectedFilter.value);
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
