import {
  ProxmoxAlertTemplate,
  ProxmoxAlertTemplateArgs,
  getAllProxmoxAlertTemplates,
  getProxmoxAlertTemplateById,
} from "../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../Types/Monitor/ProxmoxMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepProxmoxMonitor from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * WI-20: lock in the Proxmox alert-template contracts (v2 WI-9 + the v3
 * WI-24/25 additions). Two layers:
 *
 *   1. ENUMERATED invariants run over getAllProxmoxAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a
 *      valid MonitorStep, reference only catalog metrics, resolve every
 *      criteria alias, group by raw datapoint labels (pve-exporter
 *      identity lives in datapoint labels — NEVER `resource.`-prefixed),
 *      and use disjoint fire/recover thresholds on the same alias.
 *
 *   2. A per-template expectation table pins the spec'd metric /
 *      aggregation / threshold / scope-filter decisions (v3 spec §WI-24:
 *      pve-guest-not-backed-up fires >0 / recovers =0 on
 *      pve_not_backed_up_total, cluster scope, no groupBy; §WI-25:
 *      pve-replication-failing groups by the replication job `id`).
 *      The table is exhaustive both ways — adding a template without a
 *      row here fails loudly, which is the point.
 */

interface QueryExpectation {
  metricName: string;
  aggregation: MetricsAggregationType;
  attributes: Record<string, string>;
}

interface ThresholdExpectation {
  alias: string;
  filterType: FilterType;
  value: number;
}

interface TemplateExpectation {
  id: string;
  category: string;
  severity: string;
  rollingTime: RollingTime;
  queries: Array<QueryExpectation>;
  groupBy: string | null;
  formula: string | null;
  fire: ThresholdExpectation;
  recover: ThresholdExpectation;
}

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    id: "pve-node-offline",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_up",
        aggregation: MetricsAggregationType.Min,
        attributes: { "pve.scope": "node" },
      },
    ],
    groupBy: "id",
    formula: null,
    fire: { alias: "node_up", filterType: FilterType.LessThan, value: 1 },
    recover: {
      alias: "node_up",
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    },
  },
  {
    id: "pve-guest-down",
    category: "Availability",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_up",
        aggregation: MetricsAggregationType.Min,
        attributes: { "pve.scope": "guest" },
      },
    ],
    groupBy: "id",
    formula: null,
    fire: { alias: "guest_up", filterType: FilterType.LessThan, value: 1 },
    recover: {
      alias: "guest_up",
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    },
  },
  {
    /*
     * Quorum proxy: Σpve_up over node series ÷ Σpve_node_info (constant-1
     * metadata series per node). Same-receiver ratio ⇒ Sum/Sum (the
     * scrape multiple cancels); cluster-wide ⇒ NO groupBy.
     */
    id: "pve-quorum-risk",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_up",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "node" },
      },
      {
        metricName: "pve_node_info",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "node" },
      },
    ],
    groupBy: null,
    formula: "(nodes_online / nodes_total) * 100",
    fire: {
      alias: "node_availability",
      filterType: FilterType.LessThanOrEqualTo,
      value: 50,
    },
    recover: {
      alias: "node_availability",
      filterType: FilterType.GreaterThan,
      value: 50,
    },
  },
  {
    /*
     * pve_cpu_usage_ratio is already a true 0..1 ratio (one series per
     * node) ⇒ Avg, and the threshold stays in ratio units (0.9, not 90).
     */
    id: "pve-node-high-cpu",
    category: "Node",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_cpu_usage_ratio",
        aggregation: MetricsAggregationType.Avg,
        attributes: { "pve.scope": "node" },
      },
    ],
    groupBy: "id",
    formula: null,
    fire: { alias: "node_cpu", filterType: FilterType.GreaterThan, value: 0.9 },
    recover: {
      alias: "node_cpu",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.9,
    },
  },
  {
    id: "pve-node-high-memory",
    category: "Node",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_memory_usage_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "node" },
      },
      {
        metricName: "pve_memory_size_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "node" },
      },
    ],
    groupBy: "id",
    formula: "(used_mem / total_mem) * 100",
    fire: {
      alias: "node_memory_utilization",
      filterType: FilterType.GreaterThan,
      value: 85,
    },
    recover: {
      alias: "node_memory_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 85,
    },
  },
  {
    id: "pve-guest-high-cpu",
    category: "Guest",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_cpu_usage_ratio",
        aggregation: MetricsAggregationType.Avg,
        attributes: { "pve.scope": "guest" },
      },
    ],
    groupBy: "id",
    formula: null,
    fire: {
      alias: "guest_cpu",
      filterType: FilterType.GreaterThan,
      value: 0.9,
    },
    recover: {
      alias: "guest_cpu",
      filterType: FilterType.LessThanOrEqualTo,
      value: 0.9,
    },
  },
  {
    id: "pve-storage-near-full",
    category: "Storage",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_disk_usage_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "storage" },
      },
      {
        metricName: "pve_disk_size_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.scope": "storage" },
      },
    ],
    groupBy: "id",
    formula: "(used_disk / total_disk) * 100",
    fire: {
      alias: "storage_utilization",
      filterType: FilterType.GreaterThan,
      value: 85,
    },
    recover: {
      alias: "storage_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 85,
    },
  },
  {
    /*
     * LXC-only via pve.type (qemu in-guest disk usage reads 0 without the
     * QEMU guest agent — alerting on it would be a lie).
     */
    id: "pve-lxc-disk-near-full",
    category: "Storage",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_disk_usage_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.type": "lxc" },
      },
      {
        metricName: "pve_disk_size_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: { "pve.type": "lxc" },
      },
    ],
    groupBy: "id",
    formula: "(used_disk / total_disk) * 100",
    fire: {
      alias: "lxc_disk_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "lxc_disk_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    /*
     * Enum-series filter: pve_ha_state has one series per possible state
     * (value 1 = current). state=error equality filter + Max per resource.
     */
    id: "pve-ha-state-error",
    category: "HA",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_ha_state",
        aggregation: MetricsAggregationType.Max,
        attributes: { state: "error" },
      },
    ],
    groupBy: "id",
    formula: null,
    fire: {
      alias: "ha_error_state",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "ha_error_state",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    /*
     * V3 WI-24: cluster-level backup-info gauge — one series, no `id`
     * label ⇒ NO groupBy (one incident per cluster; per-guest naming
     * belongs to pve_not_backed_up_info in the breakdown, not the alert).
     */
    id: "pve-guest-not-backed-up",
    category: "Backup",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_not_backed_up_total",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
      },
    ],
    groupBy: null,
    formula: null,
    fire: {
      alias: "guests_without_backup",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "guests_without_backup",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    /*
     * V3 WI-25: replication series are labeled `id` with the replication
     * JOB id (e.g. 100-0) — not a node/qemu/lxc resource id, so no
     * pve.scope filter; groupBy `id` fires one incident per job.
     */
    id: "pve-replication-failing",
    category: "Replication",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "pve_replication_failed_syncs",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
      },
    ],
    groupBy: "id",
    formula: null,
    fire: {
      alias: "replication_failed_syncs",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "replication_failed_syncs",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
];

function buildArgs(): ProxmoxAlertTemplateArgs {
  return {
    clusterIdentifier: "pve-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getProxmoxMonitor(step: MonitorStep): MonitorStepProxmoxMonitor {
  const proxmoxMonitor: MonitorStepProxmoxMonitor | undefined =
    step.data?.proxmoxMonitor;
  if (!proxmoxMonitor) {
    throw new Error("proxmoxMonitor missing from monitor step");
  }
  return proxmoxMonitor;
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

// Aliases a criteria filter may legally reference: query + formula variables.
function getReferencableAliases(
  monitor: MonitorStepProxmoxMonitor,
): Set<string> {
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
 * Fire and recover must be disjoint complements on the same alias —
 * otherwise the monitor either flaps (overlap) or wedges (gap).
 */
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

const ALL_TEMPLATES: Array<ProxmoxAlertTemplate> =
  getAllProxmoxAlertTemplates();

describe("ProxmoxAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return t.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    // Exhaustive both ways: a new template must get an expectation row.
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });
});

describe("ProxmoxAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: ProxmoxAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as ProxmoxAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepProxmoxMonitor = getProxmoxMonitor(step);

    // The cluster attribute is injected from the template args.
    expect(monitor.clusterIdentifier).toBe(args.clusterIdentifier);
    expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    expect(instances.length).toBeGreaterThanOrEqual(2);

    /*
     * Criteria are evaluated first-match-wins: every instance before
     * the last is an unhealthy tier (creates incidents + alerts,
     * flips to the offline status); the LAST is the recover instance
     * (no incidents, flips to the online status).
     */
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
    ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as ProxmoxAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepProxmoxMonitor = getProxmoxMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getProxmoxMetricByMetricName(metricName)).toBeDefined();
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
    ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by raw datapoint labels only (never resource.-prefixed)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as ProxmoxAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepProxmoxMonitor = getProxmoxMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const groupBys: Array<string> =
          queryConfig.metricQueryData.groupByAttributeKeys || [];
        for (const key of groupBys) {
          /*
           * pve-exporter identity is the `id` DATAPOINT label. A
           * `resource.`-prefixed key would match nothing in ClickHouse
           * and collapse every resource into one mislabeled series.
           */
          expect(key).toBe("id");
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as ProxmoxAlertTemplate
      ).getMonitorStep(buildArgs());
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
    ALL_TEMPLATES.map((t: ProxmoxAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s ratio queries use the same aggregation on both sides (same-receiver Sum/Sum contract)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as ProxmoxAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepProxmoxMonitor = getProxmoxMonitor(step);
      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      const formulaConfigs: Array<any> = (monitor.metricViewConfig
        .formulaConfigs || []) as Array<any>;

      if (formulaConfigs.length === 0) {
        return;
      }

      // Ratio/formula templates: 2 queries, 1 formula, matching groupBys.
      expect(queryConfigs).toHaveLength(2);
      expect(formulaConfigs).toHaveLength(1);

      const [numerator, denominator] = queryConfigs;
      expect(numerator.metricQueryData.filterData.aggegationType).toBe(
        denominator.metricQueryData.filterData.aggegationType,
      );
      /*
       * Every Proxmox metric rides ONE receiver (the pve-exporter
       * scrape), so ratios are same-receiver and must be Sum/Sum —
       * except pve_cpu_usage_ratio-style single-series gauges, which
       * never appear in formulas here.
       */
      expect(numerator.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Sum,
      );
      expect(numerator.metricQueryData.groupByAttributeKeys || []).toEqual(
        denominator.metricQueryData.groupByAttributeKeys || [],
      );
      // Both sides share the same attribute equality filters.
      expect(numerator.metricQueryData.filterData.attributes).toEqual(
        denominator.metricQueryData.filterData.attributes,
      );
    },
  );
});

describe("ProxmoxAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: ProxmoxAlertTemplate | undefined =
        getProxmoxAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepProxmoxMonitor = getProxmoxMonitor(step);

      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(tc.queries.length);

      for (let i: number = 0; i < tc.queries.length; i++) {
        const expectedQuery: QueryExpectation = tc.queries[i]!;
        const filterData: any = queryConfigs[i].metricQueryData.filterData;
        expect(filterData.metricName).toBe(expectedQuery.metricName);
        expect(filterData.aggegationType).toBe(expectedQuery.aggregation);
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
        expect(formulaConfigs[0].metricAliasData.metricVariable).toBe(
          tc.fire.alias,
        );
      } else {
        expect(formulaConfigs).toHaveLength(0);
      }

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      expect(instances).toHaveLength(2);

      const fireFilter: any = (instances[0]!.data?.filters as Array<any>)[0];
      expect(fireFilter.metricMonitorOptions.metricAlias).toBe(tc.fire.alias);
      expect(fireFilter.filterType).toBe(tc.fire.filterType);
      expect(fireFilter.value).toBe(tc.fire.value);

      const recoverFilter: any = (instances[1]!.data?.filters as Array<any>)[0];
      expect(recoverFilter.metricMonitorOptions.metricAlias).toBe(
        tc.recover.alias,
      );
      expect(recoverFilter.filterType).toBe(tc.recover.filterType);
      expect(recoverFilter.value).toBe(tc.recover.value);
    },
  );
});
