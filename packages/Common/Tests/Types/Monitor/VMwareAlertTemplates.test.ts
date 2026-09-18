import {
  VMwareAlertTemplate,
  VMwareAlertTemplateArgs,
  VMwareGroupByKey,
  getAllVMwareAlertTemplates,
  getVMwareAlertTemplateById,
  getVMwareAlertTemplatesByCategory,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import {
  VMwareMetricDefinition,
  getVMwareMetricByMetricName,
} from "../../../Types/Monitor/VMwareMetricCatalog";
import { getRecoveryThreshold } from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import {
  getComplementFilterType,
  hasRecoveryDeadBand,
} from "./Utils/RecommendationCriteriaAssertions";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepVMwareMonitor from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * Lock in the VMware alert-template contracts (design spec §6). Two layers:
 *
 *   1. ENUMERATED invariants run over getAllVMwareAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a
 *      valid MonitorStep, reference only catalog metrics, resolve every
 *      criteria alias, group by a `resource.vcenter.*` RESOURCE attribute
 *      (the OTel vcenter receiver's identity lives in resource attributes —
 *      the inverse of the Proxmox rule), and use disjoint fire/recover
 *      thresholds on the same alias.
 *
 *   2. A per-template expectation table pins the spec'd metric /
 *      aggregation / threshold / attribute-filter / group-by decisions.
 *      The table is exhaustive both ways — adding a template without a
 *      row here fails loudly, which is the point.
 */

interface QueryExpectation {
  metricName: string;
  aggregation: MetricsAggregationType;
  attributes: Record<string, string>;
  legendUnit: string | undefined;
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
  groupBy: string;
  fire: ThresholdExpectation;
  recover: ThresholdExpectation;
}

const HOST: string = "resource.vcenter.host.name";
const VM: string = "resource.vcenter.vm.name";
const DATASTORE: string = "resource.vcenter.datastore.name";
const CLUSTER: string = "resource.vcenter.cluster.name";
const DATACENTER: string = "resource.vcenter.datacenter.name";
const RESOURCE_POOL: string = "resource.vcenter.resource_pool.inventory_path";

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    id: "vmware-host-cpu-saturation",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.host.cpu.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: HOST,
    fire: {
      alias: "host_cpu_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "host_cpu_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    id: "vmware-host-memory-saturation",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.host.memory.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: HOST,
    fire: {
      alias: "host_memory_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "host_memory_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    /*
     * Max, not Avg: the metric is itself the worst latency across the
     * host's disks, and the threshold is in the receiver's native ms.
     */
    id: "vmware-host-disk-latency-high",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.host.disk.latency.max",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: "ms",
      },
    ],
    groupBy: HOST,
    fire: {
      alias: "host_disk_latency_max",
      filterType: FilterType.GreaterThan,
      value: 50,
    },
    recover: {
      alias: "host_disk_latency_max",
      filterType: FilterType.LessThanOrEqualTo,
      value: 50,
    },
  },
  {
    id: "vmware-host-network-packet-errors",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.host.network.packet.error.rate",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: HOST,
    fire: {
      alias: "host_packet_error_rate",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "host_packet_error_rate",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-host-network-packet-drops",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.host.network.packet.drop.rate",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: HOST,
    fire: {
      alias: "host_packet_drop_rate",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "host_packet_drop_rate",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    /*
     * The only 15-minute window: a VM is entitled to spend its vCPUs, so
     * only sustained saturation is worth a page (see the asymmetry suite).
     */
    id: "vmware-vm-cpu-saturation",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past15Minutes,
    queries: [
      {
        metricName: "vcenter.vm.cpu.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_cpu_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "vm_cpu_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    id: "vmware-vm-cpu-ready-contention",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.cpu.readiness",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_cpu_ready",
      filterType: FilterType.GreaterThan,
      value: 10,
    },
    recover: {
      alias: "vm_cpu_ready",
      filterType: FilterType.LessThanOrEqualTo,
      value: 10,
    },
  },
  {
    id: "vmware-vm-memory-saturation",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.memory.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_memory_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "vm_memory_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    id: "vmware-vm-memory-ballooning",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.memory.ballooned",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_memory_ballooned",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "vm_memory_ballooned",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-vm-memory-swapping",
    category: "Virtual Machine",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.memory.swapped",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_memory_swapped",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "vm_memory_swapped",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-vm-disk-latency-high",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.disk.latency.max",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: "ms",
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_disk_latency_max",
      filterType: FilterType.GreaterThan,
      value: 50,
    },
    recover: {
      alias: "vm_disk_latency_max",
      filterType: FilterType.LessThanOrEqualTo,
      value: 50,
    },
  },
  {
    id: "vmware-vm-disk-usage-high",
    category: "Virtual Machine",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.vm.disk.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: VM,
    fire: {
      alias: "vm_disk_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "vm_disk_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    id: "vmware-datastore-capacity-warning",
    category: "Datastore",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datastore.disk.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: DATASTORE,
    fire: {
      alias: "datastore_utilization",
      filterType: FilterType.GreaterThan,
      value: 80,
    },
    recover: {
      alias: "datastore_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 80,
    },
  },
  {
    id: "vmware-datastore-capacity-critical",
    category: "Datastore",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datastore.disk.utilization",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "%",
      },
    ],
    groupBy: DATASTORE,
    fire: {
      alias: "datastore_utilization",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
    recover: {
      alias: "datastore_utilization",
      filterType: FilterType.LessThanOrEqualTo,
      value: 90,
    },
  },
  {
    /*
     * The receiver's boolean `effective` attribute is stored as the
     * STRING "false" — the filter must use the string, not a boolean.
     */
    id: "vmware-cluster-host-not-effective",
    category: "Cluster",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.cluster.host.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { effective: "false" },
        legendUnit: undefined,
      },
    ],
    groupBy: CLUSTER,
    fire: {
      alias: "cluster_hosts_not_effective",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "cluster_hosts_not_effective",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-datacenter-hosts-unhealthy",
    category: "Datacenter",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datacenter.host.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { status: "red" },
        legendUnit: undefined,
      },
    ],
    groupBy: DATACENTER,
    fire: {
      alias: "datacenter_hosts_red",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "datacenter_hosts_red",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-datacenter-hosts-degraded",
    category: "Datacenter",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datacenter.host.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { status: "yellow" },
        legendUnit: undefined,
      },
    ],
    groupBy: DATACENTER,
    fire: {
      alias: "datacenter_hosts_yellow",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "datacenter_hosts_yellow",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-datacenter-hosts-powered-off",
    category: "Datacenter",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datacenter.host.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { power_state: "off" },
        legendUnit: undefined,
      },
    ],
    groupBy: DATACENTER,
    fire: {
      alias: "datacenter_hosts_powered_off",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "datacenter_hosts_powered_off",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-datacenter-vms-unhealthy",
    category: "Datacenter",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datacenter.vm.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { status: "red" },
        legendUnit: undefined,
      },
    ],
    groupBy: DATACENTER,
    fire: {
      alias: "datacenter_vms_red",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "datacenter_vms_red",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    id: "vmware-datacenter-clusters-unhealthy",
    category: "Datacenter",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.datacenter.cluster.count",
        aggregation: MetricsAggregationType.Max,
        attributes: { status: "red" },
        legendUnit: undefined,
      },
    ],
    groupBy: DATACENTER,
    fire: {
      alias: "datacenter_clusters_red",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "datacenter_clusters_red",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    /*
     * vSAN latency is reported in MICROseconds by the receiver; the
     * 20 ms threshold is written in the native unit (20 000 us) and pinned.
     */
    id: "vmware-vsan-latency-high",
    category: "vSAN",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.cluster.vsan.latency.avg",
        aggregation: MetricsAggregationType.Avg,
        attributes: {},
        legendUnit: "us",
      },
    ],
    groupBy: CLUSTER,
    fire: {
      alias: "vsan_latency_avg",
      filterType: FilterType.GreaterThan,
      value: 20000,
    },
    recover: {
      alias: "vsan_latency_avg",
      filterType: FilterType.LessThanOrEqualTo,
      value: 20000,
    },
  },
  {
    id: "vmware-vsan-congestion",
    category: "vSAN",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.cluster.vsan.congestions",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: CLUSTER,
    fire: {
      alias: "vsan_congestions",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "vsan_congestions",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
  {
    /*
     * Grouped by the pool's inventory PATH, not its name: pool names are
     * only unique within their parent.
     */
    id: "vmware-resource-pool-memory-swapped",
    category: "Cluster",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "vcenter.resource_pool.memory.swapped",
        aggregation: MetricsAggregationType.Max,
        attributes: {},
        legendUnit: undefined,
      },
    ],
    groupBy: RESOURCE_POOL,
    fire: {
      alias: "resource_pool_memory_swapped",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
    recover: {
      alias: "resource_pool_memory_swapped",
      filterType: FilterType.EqualTo,
      value: 0,
    },
  },
];

function buildArgs(): VMwareAlertTemplateArgs {
  return {
    vcenterIdentifier: "vcsa-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getVMwareMonitor(step: MonitorStep): MonitorStepVMwareMonitor {
  const vmwareMonitor: MonitorStepVMwareMonitor | undefined =
    step.data?.vmwareMonitor;
  if (!vmwareMonitor) {
    throw new Error("vmwareMonitor missing from monitor step");
  }
  return vmwareMonitor;
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
  monitor: MonitorStepVMwareMonitor,
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
 * No VMware template thresholds a strictly 0/1 gauge (the vcenter
 * receiver emits no up/down boolean — power state is inferred from metric
 * presence at ingest), so every pair is checked with the shared dead-band
 * assertion; the `> 0` / `= 0` count pairs are accepted by it as-is.
 */
function expectedRecoveryValue(recover: {
  filterType: FilterType;
  value: number;
}): number {
  return (
    getRecoveryThreshold({
      filterType: getComplementFilterType(recover.filterType)!,
      value: recover.value,
    }) ?? recover.value
  );
}

const ALL_TEMPLATES: Array<VMwareAlertTemplate> = getAllVMwareAlertTemplates();

describe("VMwareAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
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

  test("ships the 23 templates the design spec lists", () => {
    expect(ALL_TEMPLATES).toHaveLength(23);
  });

  test("every template id carries the vmware- prefix", () => {
    /*
     * Template ids are only guaranteed unique within a module; the
     * registry canary asserts they happen to be globally unique. A
     * distinct prefix is what keeps that true against pve-/k8s-/ceph-.
     */
    for (const template of ALL_TEMPLATES) {
      expect(template.id).toMatch(/^vmware-[a-z0-9-]+$/);
    }
  });

  test("template names are unique within the module", () => {
    const names: Array<string> = ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return t.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  test("getVMwareAlertTemplateById round-trips every template and misses unknown ids", () => {
    for (const template of ALL_TEMPLATES) {
      expect(getVMwareAlertTemplateById(template.id)).toBe(template);
    }
    expect(getVMwareAlertTemplateById("pve-node-offline")).toBeUndefined();
    expect(getVMwareAlertTemplateById("")).toBeUndefined();
  });

  test("getVMwareAlertTemplatesByCategory partitions the registry", () => {
    const categories: Array<string> = [
      "Host",
      "Virtual Machine",
      "Datastore",
      "Cluster",
      "Datacenter",
      "vSAN",
    ];

    let total: number = 0;
    for (const category of categories) {
      const templates: Array<VMwareAlertTemplate> =
        getVMwareAlertTemplatesByCategory(category as any);
      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template.category).toBe(category);
      }
      total += templates.length;
    }
    expect(total).toBe(ALL_TEMPLATES.length);
  });

  test("severities are the two-member vocabulary the recommendation mapper understands", () => {
    for (const template of ALL_TEMPLATES) {
      expect(["Critical", "Warning"]).toContain(template.severity);
    }
  });
});

describe("VMwareAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: VMwareAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (template as VMwareAlertTemplate).getMonitorStep(
      args,
    );
    const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

    // The vCenter identity is injected from the template args.
    expect(monitor.vcenterIdentifier).toBe(args.vcenterIdentifier);
    expect(monitor.resourceFilters).toEqual({});
    expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

    // Only the VMware sub-config is populated; no sibling leaks through.
    expect(step.data?.proxmoxMonitor).toBeUndefined();
    expect(step.data?.kubernetesMonitor).toBeUndefined();
    expect(step.data?.metricMonitor).toBeUndefined();

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
      expect(offline.data?.incidents?.[0]?.incidentSeverityId).toBe(
        args.defaultIncidentSeverityId,
      );
      expect(offline.data?.alerts?.[0]?.alertSeverityId).toBe(
        args.defaultAlertSeverityId,
      );
    }

    expect(onlineInstance.data?.monitorStatusId).toBe(
      args.onlineMonitorStatusId,
    );
    expect(onlineInstance.data?.createIncidents).toBe(false);
    expect(onlineInstance.data?.createAlerts).toBe(false);
    expect(onlineInstance.data?.name).toBe("Healthy");
  });

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getVMwareMetricByMetricName(metricName)).toBeDefined();
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
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by a resource.vcenter.* attribute the display layer can name",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const groupBys: Array<string> =
          queryConfig.metricQueryData.groupByAttributeKeys || [];

        /*
         * Every VMware template is per-object: one incident per host /
         * VM / datastore / cluster / datacenter / pool. An ungrouped
         * template would collapse the whole vCenter into one alert that
         * cannot say which object broke.
         */
        expect(groupBys).toHaveLength(1);

        for (const key of groupBys) {
          /*
           * The vcenter receiver's identity lives in OTel RESOURCE
           * attributes, stored `resource.`-prefixed in ClickHouse. A bare
           * `vcenter.host.name` would match nothing and collapse every
           * host into one mislabeled series — the inverse of the Proxmox
           * rule, where identity is an unprefixed datapoint label.
           */
          expect(key).toMatch(/^resource\.vcenter\./);
          expect(Object.values(VMwareGroupByKey)).toContain(key);
          expect(SeriesLabelDisplay.isKnownLabelKey(key)).toBe(true);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by the identity attribute of the object its metric describes",
    (_id: unknown, template: unknown) => {
      /*
       * A host metric grouped by the VM name would fan out on an attribute
       * the series does not carry. The catalog's defaultResourceScope says
       * which object a metric belongs to; the group-by must agree.
       */
      const scopeToGroupBy: Record<string, string> = {
        datacenter: VMwareGroupByKey.Datacenter,
        cluster: VMwareGroupByKey.Cluster,
        host: VMwareGroupByKey.Host,
        vm: VMwareGroupByKey.VirtualMachine,
        datastore: VMwareGroupByKey.Datastore,
        resource_pool: VMwareGroupByKey.ResourcePool,
      };

      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const definition: VMwareMetricDefinition | undefined =
          getVMwareMetricByMetricName(
            queryConfig.metricQueryData.filterData.metricName,
          );
        expect(definition).toBeDefined();

        expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
          scopeToGroupBy[definition!.defaultResourceScope],
        ]);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s filters only on bare datapoint attributes, never resource.-prefixed ones",
    (_id: unknown, template: unknown) => {
      /*
       * `status`, `power_state` and `effective` are DATAPOINT attributes
       * and are stored bare. Prefixing one would make the filter match
       * nothing, and the template would never fire — silently.
       */
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const attributes: Record<string, string> =
          queryConfig.metricQueryData.filterData.attributes;

        for (const key of Object.keys(attributes)) {
          expect(key.startsWith("resource.")).toBe(false);
          expect(["status", "power_state", "effective"]).toContain(key);
          expect(typeof attributes[key]).toBe("string");
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as VMwareAlertTemplate
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
            hasRecoveryDeadBand(
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
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s evaluates sustained over the whole window, not on a single sample",
    (_id: unknown, template: unknown) => {
      /*
       * The rolling window is only the alert's patience because the
       * quantifier is "every sample". With AnyValue a 15-minute and a
       * 1-minute window are identical for anything that spikes.
       */
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());

      for (const instance of getCriteriaInstances(step)) {
        for (const filter of (instance.data?.filters || []) as Array<any>) {
          expect(filter.metricMonitorOptions.metricAggregationType).toBe(
            EvaluateOverTimeType.AllValues,
          );
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s pins the display unit whenever the threshold is written in a unit",
    (_id: unknown, template: unknown) => {
      /*
       * A percentage / latency threshold only means what it says if the
       * query's samples are in that unit. The vcenter receiver's native
       * unit matches, so the pin is a no-op today — it is there so the
       * threshold does not silently change meaning if a receiver build
       * ever ships a different unit string. Zero-thresholded counts and
       * rates need no unit.
       */
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);
      const fireFilter: any = (
        getCriteriaInstances(step)[0]!.data?.filters as Array<any>
      )[0];

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const definition: VMwareMetricDefinition | undefined =
          getVMwareMetricByMetricName(
            queryConfig.metricQueryData.filterData.metricName,
          );
        const legendUnit: string | undefined =
          queryConfig.metricAliasData.legendUnit;

        if (fireFilter.value === 0) {
          expect(legendUnit).toBeUndefined();
        } else {
          expect(legendUnit).toBeDefined();
          // ...and it is the receiver's own unit, so no conversion happens.
          expect(legendUnit).toBe(definition!.unit);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: VMwareAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s names the vSphere object kind in its title and tells the reader where to look",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as VMwareAlertTemplate
      ).getMonitorStep(buildArgs());
      const fireInstance: MonitorCriteriaInstance =
        getCriteriaInstances(step)[0]!;
      const incident: any = fireInstance.data?.incidents?.[0];
      const alert: any = fireInstance.data?.alerts?.[0];

      expect(incident.title).toMatch(/^\[VMware\] /);
      expect(incident.title).toContain("Test Monitor");
      expect(alert.title).toBe(incident.title);
      expect(alert.description).toBe(incident.description);

      // The description tells the engineer to read the affected resource.
      expect(incident.description).toMatch(/affected resource on this alert/i);

      // Named criteria, not the builder's generic fallback.
      expect(fireInstance.data?.name).not.toMatch(/Unhealthy$/);
      expect(fireInstance.data?.description).toMatch(/^Triggers when /);

      // Never leaks Proxmox vocabulary into a vSphere alert.
      for (const text of [
        (template as VMwareAlertTemplate).description,
        incident.title,
        incident.description,
        fireInstance.data?.name || "",
        fireInstance.data?.description || "",
      ]) {
        expect(text).not.toMatch(/proxmox|pve|lxc|qemu|guest agent/i);
      }
    },
  );

  test("Critical templates announce themselves in the incident title", () => {
    for (const template of ALL_TEMPLATES) {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const title: string =
        getCriteriaInstances(step)[0]!.data?.incidents?.[0]?.title || "";

      if (template.severity === "Critical") {
        expect(title).toContain("CRITICAL:");
      } else {
        expect(title).not.toContain("CRITICAL:");
      }
    }
  });
});

describe("VMwareAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: VMwareAlertTemplate | undefined =
        getVMwareAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

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
        expect(queryConfigs[i].metricAliasData.legendUnit).toBe(
          expectedQuery.legendUnit,
        );

        const groupBys: Array<string> =
          queryConfigs[i].metricQueryData.groupByAttributeKeys || [];
        expect(groupBys).toEqual([tc.groupBy]);
      }

      // No ratio formulas: the receiver ships ready-made percentages.
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);

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
      /*
       * The spec table states the FIRING threshold; the recovery threshold
       * is derived from it so the dead band lives in one place rather than
       * being restated in every spec table.
       */
      expect(recoverFilter.value).toBe(expectedRecoveryValue(tc.recover));
    },
  );
});

/*
 * Regression suites below. Each pins a decision that is easy to "tidy up"
 * into a defect: reverting it must turn one of these red.
 */

function getTemplate(id: string): VMwareAlertTemplate {
  const template: VMwareAlertTemplate | undefined =
    getVMwareAlertTemplateById(id);
  if (!template) {
    throw new Error(`template ${id} is not registered`);
  }
  return template;
}

function findFilterByAlias(
  instance: MonitorCriteriaInstance,
  alias: string,
): any {
  return ((instance.data?.filters || []) as Array<any>).find((filter: any) => {
    return filter.metricMonitorOptions.metricAlias === alias;
  });
}

describe("VMwareAlertTemplates - VM vs host CPU asymmetry (regression)", () => {
  const ROLLING_MINUTES: Record<string, number> = {
    [RollingTime.Past5Minutes]: 5,
    [RollingTime.Past15Minutes]: 15,
  };

  /*
   * `vcenter.vm.cpu.utilization` is usage as a fraction of the VM's OWN
   * vCPU allocation, which the VM is entitled to spend. A right-sized
   * 2-vCPU VM running a build sits at 100% by design, so the host's
   * 5-minute window pages for a workload doing exactly what it was
   * provisioned to do. The asymmetry IS the fix; assert the relationship,
   * not only the numbers.
   */
  test("the VM template waits longer than the host one", () => {
    const hostStep: MonitorStep = getTemplate(
      "vmware-host-cpu-saturation",
    ).getMonitorStep(buildArgs());
    const vmStep: MonitorStep = getTemplate(
      "vmware-vm-cpu-saturation",
    ).getMonitorStep(buildArgs());

    const hostWindow: number =
      ROLLING_MINUTES[getVMwareMonitor(hostStep).rollingTime as string]!;
    const vmWindow: number =
      ROLLING_MINUTES[getVMwareMonitor(vmStep).rollingTime as string]!;
    expect(vmWindow).toBeGreaterThan(hostWindow);
  });

  test("vmware-vm-cpu-saturation is 90% sustained across a 15-minute window", () => {
    const step: MonitorStep = getTemplate(
      "vmware-vm-cpu-saturation",
    ).getMonitorStep(buildArgs());
    const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);

    expect(monitor.rollingTime).toBe(RollingTime.Past15Minutes);

    const fire: any = findFilterByAlias(
      getCriteriaInstances(step)[0]!,
      "vm_cpu_utilization",
    );
    expect(fire.filterType).toBe(FilterType.GreaterThan);
    expect(fire.value).toBe(90);
    expect(fire.metricMonitorOptions.metricAggregationType).toBe(
      EvaluateOverTimeType.AllValues,
    );
  });

  test("vmware-vm-cpu-saturation recovers at 81, strictly inside its firing threshold", () => {
    const step: MonitorStep = getTemplate(
      "vmware-vm-cpu-saturation",
    ).getMonitorStep(buildArgs());
    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    const recover: any = findFilterByAlias(
      instances[instances.length - 1]!,
      "vm_cpu_utilization",
    );

    expect(recover.filterType).toBe(FilterType.LessThanOrEqualTo);
    // 90% minus the shared 10% dead band. A VM parked at 90 cannot toggle.
    expect(recover.value).toBeCloseTo(81, 10);
    expect(recover.value).toBeLessThan(90);
  });

  test("every other template uses the 5-minute window", () => {
    for (const template of ALL_TEMPLATES) {
      if (template.id === "vmware-vm-cpu-saturation") {
        continue;
      }
      expect(
        getVMwareMonitor(template.getMonitorStep(buildArgs())).rollingTime,
      ).toBe(RollingTime.Past5Minutes);
    }
  });
});

describe("VMwareAlertTemplates - datastore warning/critical tiering (regression)", () => {
  /*
   * Two templates on ONE metric with different thresholds and severities.
   * They must stay ordered (warning strictly below critical), their
   * recovery bands must not overlap the other tier's firing threshold, and
   * they must fingerprint differently or the recommendation diff would
   * treat creating one as covering both.
   */
  test("the warning tier fires below the critical tier and the bands do not cross", () => {
    const warningStep: MonitorStep = getTemplate(
      "vmware-datastore-capacity-warning",
    ).getMonitorStep(buildArgs());
    const criticalStep: MonitorStep = getTemplate(
      "vmware-datastore-capacity-critical",
    ).getMonitorStep(buildArgs());

    const warningFire: any = findFilterByAlias(
      getCriteriaInstances(warningStep)[0]!,
      "datastore_utilization",
    );
    const criticalFire: any = findFilterByAlias(
      getCriteriaInstances(criticalStep)[0]!,
      "datastore_utilization",
    );
    const criticalRecover: any = findFilterByAlias(
      getCriteriaInstances(criticalStep)[1]!,
      "datastore_utilization",
    );

    expect(warningFire.value).toBe(80);
    expect(criticalFire.value).toBe(90);
    expect(warningFire.value).toBeLessThan(criticalFire.value);
    // Critical recovers at 81 — still above the warning tier's 80.
    expect(criticalRecover.value).toBeCloseTo(81, 10);
    expect(criticalRecover.value).toBeGreaterThan(warningFire.value);

    expect(getTemplate("vmware-datastore-capacity-warning").severity).toBe(
      "Warning",
    );
    expect(getTemplate("vmware-datastore-capacity-critical").severity).toBe(
      "Critical",
    );
  });
});

describe("VMwareAlertTemplates - attribute-filtered count templates (regression)", () => {
  /*
   * The datacenter / cluster count metrics fan out over `status`,
   * `power_state` and `effective`. Without the equality filter the
   * template would count EVERY host (green ones included) and fire on
   * any datacenter with a host in it.
   */
  test.each([
    ["vmware-cluster-host-not-effective", { effective: "false" }],
    ["vmware-datacenter-hosts-unhealthy", { status: "red" }],
    ["vmware-datacenter-hosts-degraded", { status: "yellow" }],
    ["vmware-datacenter-hosts-powered-off", { power_state: "off" }],
    ["vmware-datacenter-vms-unhealthy", { status: "red" }],
    ["vmware-datacenter-clusters-unhealthy", { status: "red" }],
  ])(
    "%s narrows the count to the unhealthy attribute value",
    (id: string, attributes: Record<string, string>) => {
      const step: MonitorStep = getTemplate(id).getMonitorStep(buildArgs());
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(step);
      const queryConfig: any = monitor.metricViewConfig.queryConfigs[0];

      expect(queryConfig.metricQueryData.filterData.attributes).toEqual(
        attributes,
      );
      // Max — one collection reporting an unhealthy object trips it.
      expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
        MetricsAggregationType.Max,
      );

      const fire: any = (
        getCriteriaInstances(step)[0]!.data?.filters as Array<any>
      )[0];
      expect(fire.filterType).toBe(FilterType.GreaterThan);
      expect(fire.value).toBe(0);
    },
  );

  test('the effective filter is the string "false", never a boolean', () => {
    /*
     * The receiver declares `effective` as a bool, but attribute values
     * are stored as strings, so a boolean `false` here would compare a
     * string column against a boolean and match nothing.
     */
    const step: MonitorStep = getTemplate(
      "vmware-cluster-host-not-effective",
    ).getMonitorStep(buildArgs());
    const attributes: Record<string, unknown> = (
      getVMwareMonitor(step).metricViewConfig.queryConfigs[0] as any
    ).metricQueryData.filterData.attributes;

    expect(attributes["effective"]).toBe("false");
    expect(typeof attributes["effective"]).toBe("string");
  });

  test("every template that filters on a count metric names the datacenter or cluster, not the counted object", () => {
    /*
     * `vcenter.datacenter.host.count` is a property of the DATACENTER: the
     * series carries only `vcenter.datacenter.name`. Grouping it by host
     * would key on an attribute the series never has.
     */
    for (const template of ALL_TEMPLATES) {
      const monitor: MonitorStepVMwareMonitor = getVMwareMonitor(
        template.getMonitorStep(buildArgs()),
      );
      const queryConfig: any = monitor.metricViewConfig.queryConfigs[0];
      const metricName: string = queryConfig.metricQueryData.filterData
        .metricName as string;

      if (metricName.startsWith("vcenter.datacenter.")) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
          VMwareGroupByKey.Datacenter,
        ]);
      }
      if (metricName.startsWith("vcenter.cluster.")) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
          VMwareGroupByKey.Cluster,
        ]);
      }
    }
  });
});

describe("VMwareAlertTemplates - vSAN latency unit (regression)", () => {
  /*
   * Host and VM disk latency are milliseconds; vSAN latency is
   * MICROseconds. A copy-pasted "50" from the disk templates would be
   * 50 µs and page constantly. The threshold must be 20 000 in the native
   * unit, pinned as "us".
   */
  test("thresholds 20 000 µs with the unit pinned, not 20 or 50 ms", () => {
    const step: MonitorStep = getTemplate(
      "vmware-vsan-latency-high",
    ).getMonitorStep(buildArgs());
    const queryConfig: any =
      getVMwareMonitor(step).metricViewConfig.queryConfigs[0];
    const fire: any = (
      getCriteriaInstances(step)[0]!.data?.filters as Array<any>
    )[0];

    expect(queryConfig.metricAliasData.legendUnit).toBe("us");
    expect(
      getVMwareMetricByMetricName("vcenter.cluster.vsan.latency.avg")?.unit,
    ).toBe("us");
    expect(fire.value).toBe(20000);
    expect(fire.value).not.toBe(20);
    expect(fire.value).not.toBe(50);
  });

  test("disk latency templates threshold in milliseconds", () => {
    for (const id of [
      "vmware-host-disk-latency-high",
      "vmware-vm-disk-latency-high",
    ]) {
      const step: MonitorStep = getTemplate(id).getMonitorStep(buildArgs());
      const queryConfig: any =
        getVMwareMonitor(step).metricViewConfig.queryConfigs[0];
      const fire: any = (
        getCriteriaInstances(step)[0]!.data?.filters as Array<any>
      )[0];

      expect(queryConfig.metricAliasData.legendUnit).toBe("ms");
      expect(fire.value).toBe(50);
    }
  });
});

describe("VMwareAlertTemplates - memory pressure ladder (regression)", () => {
  /*
   * Ballooning precedes swapping in ESXi's reclamation order, so
   * swapping is the more severe signal. A later "harmonisation" that made
   * both Warning would lose the escalation.
   */
  test("swapping is Critical, ballooning is Warning", () => {
    expect(getTemplate("vmware-vm-memory-swapping").severity).toBe("Critical");
    expect(getTemplate("vmware-vm-memory-ballooning").severity).toBe("Warning");
    expect(getTemplate("vmware-resource-pool-memory-swapped").severity).toBe(
      "Warning",
    );
  });

  test("zero-thresholded count pairs recover at exactly 0, with no dead band", () => {
    for (const id of [
      "vmware-vm-memory-ballooning",
      "vmware-vm-memory-swapping",
      "vmware-resource-pool-memory-swapped",
      "vmware-vsan-congestion",
      "vmware-host-network-packet-errors",
      "vmware-host-network-packet-drops",
    ]) {
      const step: MonitorStep = getTemplate(id).getMonitorStep(buildArgs());
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const fire: any = (instances[0]!.data?.filters as Array<any>)[0];
      const recover: any = (instances[1]!.data?.filters as Array<any>)[0];

      expect(fire.filterType).toBe(FilterType.GreaterThan);
      expect(fire.value).toBe(0);
      expect(recover.filterType).toBe(FilterType.EqualTo);
      expect(recover.value).toBe(0);
    }
  });
});

describe("VMwareAlertTemplates - coverage fingerprints", () => {
  /*
   * The recommendation coverage diff resolves "already created" by
   * fingerprint (metric names + query attributes + criteria thresholds).
   * Two templates that fingerprint identically would make creating one
   * grey out the other. Every template must therefore differ from every
   * other in at least (metric, attribute filter, firing threshold) — and
   * the module as a whole must watch many metrics, so the coverage test's
   * "two templates with different fingerprints" precondition can never
   * degrade into threshold-only variants of one metric.
   */
  test("every template has a distinct (metric, attributes, threshold) signature", () => {
    const signatures: Array<string> = ALL_TEMPLATES.map(
      (template: VMwareAlertTemplate) => {
        const step: MonitorStep = template.getMonitorStep(buildArgs());
        const queryConfig: any =
          getVMwareMonitor(step).metricViewConfig.queryConfigs[0];
        const fire: any = (
          getCriteriaInstances(step)[0]!.data?.filters as Array<any>
        )[0];

        return [
          queryConfig.metricQueryData.filterData.metricName,
          JSON.stringify(queryConfig.metricQueryData.filterData.attributes),
          fire.filterType,
          fire.value,
        ].join("|");
      },
    );

    expect(new Set(signatures).size).toBe(signatures.length);
  });

  test("the module watches well over a dozen distinct metrics", () => {
    const metricNames: Set<string> = new Set<string>(
      ALL_TEMPLATES.map((template: VMwareAlertTemplate) => {
        const queryConfig: any = getVMwareMonitor(
          template.getMonitorStep(buildArgs()),
        ).metricViewConfig.queryConfigs[0];
        return queryConfig.metricQueryData.filterData.metricName as string;
      }),
    );

    expect(metricNames.size).toBeGreaterThanOrEqual(15);
  });
});
