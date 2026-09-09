import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  AdditionalCriteriaFilterSpec,
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import FilterCondition from "../Filter/FilterCondition";
import { FilterType, EvaluateOverTimeType } from "./CriteriaFilter";
import MonitorStepVMwareMonitor from "./MonitorStepVMwareMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type VMwareAlertTemplateCategory =
  | "Host"
  | "Virtual Machine"
  | "Datastore"
  | "Cluster"
  | "Datacenter"
  | "vSAN";

export type VMwareAlertTemplateSeverity = "Critical" | "Warning";

export interface VMwareAlertTemplateArgs {
  vcenterIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface VMwareAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: VMwareAlertTemplateCategory;
  severity: VMwareAlertTemplateSeverity;
  getMonitorStep: (args: VMwareAlertTemplateArgs) => MonitorStep;
}

/*
 * Filter contract: the OpenTelemetry Collector `vcenter` receiver stamps a
 * vSphere object's identity as OTel RESOURCE attributes
 * (`vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`,
 * `vcenter.vm.name`, `vcenter.datastore.name`,
 * `vcenter.resource_pool.inventory_path`), which OtelMetricsIngestService
 * stores `resource.`-prefixed in ClickHouse. Templates therefore group by
 * `resource.vcenter.<object>.name` — exactly like the Kubernetes templates
 * group by `resource.k8s.node.name` — so one incident fires per object. The
 * bare key would match nothing and collapse the whole vCenter into one
 * mislabeled series that still renders and still alerts.
 *
 * Datapoint attributes (`status`, `power_state`, `effective`, `disk_state`,
 * `direction`, `object`, `type`) stay bare. The receiver's boolean
 * `effective` arrives as the STRING "true" / "false" once stored, so it is
 * filtered with the string.
 */
export const VMwareGroupByKey: {
  Datacenter: string;
  Cluster: string;
  Host: string;
  VirtualMachine: string;
  Datastore: string;
  ResourcePool: string;
} = {
  Datacenter: "resource.vcenter.datacenter.name",
  Cluster: "resource.vcenter.cluster.name",
  Host: "resource.vcenter.host.name",
  VirtualMachine: "resource.vcenter.vm.name",
  Datastore: "resource.vcenter.datastore.name",
  ResourcePool: "resource.vcenter.resource_pool.inventory_path",
};

export function buildVMwareMonitorStep(args: {
  vmwareMonitor: MonitorStepVMwareMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    dockerMonitor: undefined,
    proxmoxMonitor: undefined,
    vmwareMonitor: args.vmwareMonitor,
  };

  return monitorStep;
}

export function buildVMwareOfflineCriteriaInstance(args: {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  incidentTitle?: string;
  incidentDescription?: string;
  criteriaName?: string;
  criteriaDescription?: string;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  /*
   * Extra comparisons combined with the primary one per `filterCondition`.
   * On a grouped monitor they are combined WITHIN a series
   * (MonitorCriteriaEvaluator.collectPerSeriesMatches buckets every
   * filter's result by series fingerprint), so `All` means "this VM is
   * swapping AND this same VM is ballooned" rather than "some VM is
   * swapping and some other VM is ballooned".
   */
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  return buildUnhealthyCriteriaInstance({
    ...args,
    resourceNoun: "vSphere object",
  });
}

export function buildVMwareOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  recoveryValue?: number | undefined;
  marginFraction?: number | undefined;
  isBinaryMetric?: boolean | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  additionalFilters?: Array<AdditionalCriteriaFilterSpec> | undefined;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export function buildVMwareMonitorConfig(args: {
  vcenterIdentifier: string;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKey?: string | undefined;
  /*
   * Display unit for this query's samples. The worker converts the metric's
   * INGESTED native unit into it
   * (MetricResultUnitConverter.convertQueryResultsToDisplayUnit), and the
   * criteria evaluator then converts from it into the criteria's threshold
   * unit. The vcenter receiver ships real OTLP unit metadata ("%", "ms",
   * "us", "MiBy"), so pinning is a no-op when it matches the native unit —
   * it is pinned anyway wherever the threshold is written in a unit, so the
   * threshold's meaning does not depend on whatever unit string a future
   * receiver build happens to emit. Leave undefined for counts and rates
   * thresholded at zero.
   */
  legendUnit?: string | undefined;
}): MonitorStepVMwareMonitor {
  return {
    vcenterIdentifier: args.vcenterIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: args.legendUnit,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKey
              ? { groupByAttributeKeys: [args.groupByAttributeKey] }
              : {}),
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

export interface VMwareQuery {
  alias: string;
  metricName: string;
  attributes?: Record<string, string> | undefined;
}

/**
 * Build a monitor that watches SEVERAL metrics with no formula, so one
 * criteria can qualify another (Proxmox's guest-down template is the same
 * shape). Every query shares the group-by key, which is what lets the
 * per-series evaluator line them up: series fingerprints are computed from
 * the grouped LABELS alone (MetricSeriesFingerprint.computeFingerprint), so
 * two queries grouped by `resource.vcenter.vm.name` land on the same
 * fingerprint and `FilterCondition.All` is satisfied by the SAME VM rather
 * than merely somewhere in the vCenter.
 */
export function buildVMwareMultiQueryMonitorConfig(args: {
  vcenterIdentifier: string;
  queries: Array<VMwareQuery>;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  groupByAttributeKey?: string | undefined;
}): MonitorStepVMwareMonitor {
  return {
    vcenterIdentifier: args.vcenterIdentifier,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: args.queries.map((query: VMwareQuery) => {
        return {
          metricAliasData: {
            metricVariable: query.alias,
            title: query.alias,
            description: query.alias,
            legend: query.alias,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: query.metricName,
              attributes: query.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKey
              ? { groupByAttributeKeys: [args.groupByAttributeKey] }
              : {}),
          },
        };
      }),
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

/*
 * Every shipped VMware template is a single-metric threshold on one
 * vSphere object kind: the receiver already emits ready-made percentages
 * (`*.utilization`, `cpu.readiness`), latencies and counts, so no ratio
 * formulas are needed. This private factory holds the shape every template
 * shares — one query, one grouped series per object, sustained evaluation,
 * a dead-banded recovery on the same alias — so each template below only
 * states the decisions that are its own (metric, threshold, window,
 * aggregation, filter, and the prose an on-call engineer reads).
 */
interface ThresholdTemplateSpec {
  id: string;
  name: string;
  description: string;
  category: VMwareAlertTemplateCategory;
  severity: VMwareAlertTemplateSeverity;
  metricName: string;
  metricAlias: string;
  aggregationType: MetricsAggregationType;
  rollingTime: RollingTime;
  attributes?: Record<string, string> | undefined;
  groupByAttributeKey: string;
  legendUnit?: string | undefined;
  fireFilterType: FilterType;
  fireValue: number;
  /*
   * The recovery comparison, stated explicitly rather than derived, so a
   * reader of the template sees both halves of the pair. The recovery
   * THRESHOLD is derived by the shared builder (dead band inside the firing
   * threshold; exactly 0 for the `> 0` / `= 0` count pairs).
   */
  recoverFilterType: FilterType;
  incidentTitle: (args: VMwareAlertTemplateArgs) => string;
  incidentDescription: string;
  criteriaName: string;
  criteriaDescription: string;
}

function buildThresholdTemplate(
  spec: ThresholdTemplateSpec,
): VMwareAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    getMonitorStep: (args: VMwareAlertTemplateArgs): MonitorStep => {
      return buildVMwareMonitorStep({
        vmwareMonitor: buildVMwareMonitorConfig({
          vcenterIdentifier: args.vcenterIdentifier,
          metricName: spec.metricName,
          metricAlias: spec.metricAlias,
          rollingTime: spec.rollingTime,
          aggregationType: spec.aggregationType,
          attributes: spec.attributes,
          groupByAttributeKey: spec.groupByAttributeKey,
          legendUnit: spec.legendUnit,
        }),
        offlineCriteriaInstance: buildVMwareOfflineCriteriaInstance({
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias: spec.metricAlias,
          filterType: spec.fireFilterType,
          value: spec.fireValue,
          incidentTitle: spec.incidentTitle(args),
          incidentDescription: spec.incidentDescription,
          criteriaName: spec.criteriaName,
          criteriaDescription: spec.criteriaDescription,
        }),
        onlineCriteriaInstance: buildVMwareOnlineCriteriaInstance({
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          metricAlias: spec.metricAlias,
          filterType: spec.recoverFilterType,
          value: spec.fireValue,
        }),
      });
    },
  };
}

// --- Host (ESXi) templates ---

const hostCpuSaturationTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-host-cpu-saturation",
  name: "Host CPU Saturation",
  description:
    "Alert when an ESXi host's CPU utilization stays above 90% for 5 minutes (vcenter.host.cpu.utilization, one incident per host). A saturated host degrades every VM scheduled on it and shows up as CPU ready time inside the guests.",
  category: "Host",
  severity: "Warning",
  metricName: "vcenter.host.cpu.utilization",
  metricAlias: "host_cpu_utilization",
  /*
   * Avg per host — the receiver already reports a true 0–100 percentage
   * (one series per host), so the per-minute average is the sustained
   * utilization regardless of how many collections land in the minute.
   */
  aggregationType: MetricsAggregationType.Avg,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.Host,
  legendUnit: "%",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 90,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] Host CPU Saturation (>90%) - ${args.monitorName}`;
  },
  incidentDescription:
    "An ESXi host has been above 90% CPU utilization for the whole evaluation window. Every VM on the host is now competing for physical cores, which surfaces as CPU ready time and sluggish guests. See the affected resource on this alert for the host name, then check which VMs are driving the load (esxtop, or the host's Monitor → Performance view), migrate VMs to a less loaded host with vMotion, or let DRS rebalance the cluster.",
  criteriaName: "Host CPU Saturation - Utilization > 90%",
  criteriaDescription:
    "Triggers when an ESXi host's average CPU utilization stays above 90% for every minute of the monitoring window.",
});

const hostMemorySaturationTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-host-memory-saturation",
    name: "Host Memory Saturation",
    description:
      "Alert when an ESXi host's memory utilization stays above 90% for 5 minutes (vcenter.host.memory.utilization, one incident per host). Beyond this point the host starts reclaiming memory from its VMs through ballooning, compression and finally host swapping.",
    category: "Host",
    severity: "Warning",
    metricName: "vcenter.host.memory.utilization",
    metricAlias: "host_memory_utilization",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Host,
    legendUnit: "%",
    fireFilterType: FilterType.GreaterThan,
    fireValue: 90,
    recoverFilterType: FilterType.LessThanOrEqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Host Memory Saturation (>90%) - ${args.monitorName}`;
    },
    incidentDescription:
      "An ESXi host has been above 90% memory utilization for the whole evaluation window. The host is about to (or already has started to) reclaim memory from its VMs — ballooning first, then compression, then swapping to disk, each slower than the last. See the affected resource on this alert for the host name, then check the VMs' ballooned and swapped memory, migrate VMs off the host with vMotion, or add memory capacity to the cluster.",
    criteriaName: "Host Memory Saturation - Utilization > 90%",
    criteriaDescription:
      "Triggers when an ESXi host's average memory utilization stays above 90% for every minute of the monitoring window.",
  });

const hostDiskLatencyHighTemplate: VMwareAlertTemplate = buildThresholdTemplate(
  {
    id: "vmware-host-disk-latency-high",
    name: "Host Disk Latency High",
    description:
      "Alert when the highest disk latency an ESXi host sees exceeds 50 ms for 5 minutes (vcenter.host.disk.latency.max, one incident per host). Storage latency at the host level hits every VM whose disks live on the affected path. Requires vCenter performance counter level 3.",
    category: "Host",
    severity: "Warning",
    metricName: "vcenter.host.disk.latency.max",
    metricAlias: "host_disk_latency_max",
    /*
     * Max per host — the metric is itself the worst latency across the
     * host's disks, so the worst sample in the minute is the honest value.
     */
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Host,
    legendUnit: "ms",
    fireFilterType: FilterType.GreaterThan,
    fireValue: 50,
    recoverFilterType: FilterType.LessThanOrEqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Host Disk Latency High (>50 ms) - ${args.monitorName}`;
    },
    incidentDescription:
      "An ESXi host has been reporting disk latency above 50 ms for the whole evaluation window. Latency this high at the host level means every VM whose virtual disks sit on the affected datastore or path is waiting on storage. See the affected resource on this alert for the host name, then check the storage array and fabric for the host's datastores (Host → Monitor → Performance → Disk shows which device), look for path failovers or a degraded HBA, and check whether one VM is saturating the datastore.",
    criteriaName: "Host Disk Latency High - Max Latency > 50 ms",
    criteriaDescription:
      "Triggers when an ESXi host's maximum disk latency stays above 50 ms for every minute of the monitoring window.",
  },
);

const hostNetworkPacketErrorsTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-host-network-packet-errors",
    name: "Host Network Packet Errors",
    description:
      "Alert when an ESXi host's physical NICs report any packet errors for 5 minutes (vcenter.host.network.packet.error.rate > 0, one incident per host). Packet errors are almost always a failing cable, SFP or switch port — they do not fix themselves.",
    category: "Host",
    severity: "Warning",
    metricName: "vcenter.host.network.packet.error.rate",
    metricAlias: "host_packet_error_rate",
    // Max — any NIC on the host reporting errors in a minute trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Host,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Host Network Packet Errors - ${args.monitorName}`;
    },
    incidentDescription:
      "An ESXi host's physical NICs have been reporting packet errors for the whole evaluation window. Errors (as opposed to drops) point at a physical fault: a damaged cable, a failing SFP/transceiver, a duplex mismatch or a bad switch port. See the affected resource on this alert for the host name, then find the NIC (Host → Monitor → Performance → Network, or `esxcli network nic stats get -n vmnicN` on the host) and check its link and the switch port it connects to.",
    criteriaName: "Host Network Packet Errors - Error Rate > 0",
    criteriaDescription:
      "Triggers when an ESXi host reports a non-zero packet error rate on any physical NIC for every minute of the monitoring window.",
  });

const hostNetworkPacketDropsTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-host-network-packet-drops",
    name: "Host Network Packet Drops",
    description:
      "Alert when an ESXi host's physical NICs drop packets for 5 minutes (vcenter.host.network.packet.drop.rate > 0, one incident per host). Sustained drops mean an oversubscribed uplink or a NIC whose ring buffers are overflowing.",
    category: "Host",
    severity: "Warning",
    metricName: "vcenter.host.network.packet.drop.rate",
    metricAlias: "host_packet_drop_rate",
    // Max — any NIC on the host dropping packets in a minute trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Host,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Host Network Packet Drops - ${args.monitorName}`;
    },
    incidentDescription:
      "An ESXi host's physical NICs have been dropping packets for the whole evaluation window. Drops on a physical uplink usually mean the link is saturated (too many VMs behind too little bandwidth) or the NIC's receive ring is overflowing under a burst. See the affected resource on this alert for the host name, then check the uplink's throughput against its link speed, the vSwitch/NIC teaming configuration, and whether a single VM is monopolising the uplink.",
    criteriaName: "Host Network Packet Drops - Drop Rate > 0",
    criteriaDescription:
      "Triggers when an ESXi host reports a non-zero packet drop rate on any physical NIC for every minute of the monitoring window.",
  });

// --- Virtual Machine templates ---

const vmCpuSaturationTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-cpu-saturation",
  name: "VM CPU Saturation",
  description:
    "Alert when a virtual machine's CPU utilization stays above 90% of its vCPUs for 15 minutes (vcenter.vm.cpu.utilization, one incident per VM). Deliberately slower than the host template: a VM is entitled to spend the vCPUs it was given, so only a VM that never comes down is worth a page. Only powered-on VMs report this metric.",
  category: "Virtual Machine",
  severity: "Warning",
  metricName: "vcenter.vm.cpu.utilization",
  metricAlias: "vm_cpu_utilization",
  aggregationType: MetricsAggregationType.Avg,
  /*
   * Fifteen minutes, not five. The criteria is sustained (AllValues), so
   * this window IS the alert's patience: a build, a backup or a batch job
   * pins a right-sized 2-vCPU guest for several minutes by design, and
   * paging for it is the "a pod at 91% of its CPU limit is healthy" false
   * positive. Fifteen consecutive minutes at the ceiling is starvation;
   * five is a workload.
   */
  rollingTime: RollingTime.Past15Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  legendUnit: "%",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 90,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] Sustained VM CPU Saturation (>90%) - ${args.monitorName}`;
  },
  incidentDescription:
    "A virtual machine has stayed above 90% of its allocated vCPUs for 15 minutes without a break. At that point the workload inside the guest is CPU-starved rather than merely busy. See the affected resource on this alert for the VM name, then check what is running inside the guest, and consider adding vCPUs — but check the VM's CPU ready time first: adding vCPUs to a VM on an oversubscribed host makes contention worse, not better.",
  criteriaName: "VM CPU Saturation - Utilization > 90% sustained",
  criteriaDescription:
    "Triggers when a virtual machine's average CPU utilization stays above 90% for every minute of the 15-minute window.",
});

const vmCpuReadyContentionTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-vm-cpu-ready-contention",
    name: "VM CPU Ready Contention",
    description:
      "Alert when a virtual machine's CPU ready time exceeds 10% for 5 minutes (vcenter.vm.cpu.readiness, one incident per VM). CPU ready is time the VM wanted to run but the host had no physical core for it — the definitive signal of an oversubscribed host, and invisible from inside the guest.",
    category: "Virtual Machine",
    severity: "Warning",
    metricName: "vcenter.vm.cpu.readiness",
    metricAlias: "vm_cpu_ready",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
    legendUnit: "%",
    /*
     * 10%, the threshold VMware's own performance guidance treats as
     * "performance is impacted" — 5% is noticeable, 10% is a problem.
     */
    fireFilterType: FilterType.GreaterThan,
    fireValue: 10,
    recoverFilterType: FilterType.LessThanOrEqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] VM CPU Ready Contention (>10%) - ${args.monitorName}`;
    },
    incidentDescription:
      "A virtual machine has been spending more than 10% of its time in the CPU ready state for the whole evaluation window — it wanted to run, but the ESXi host had no physical core free for it. The guest OS reports low CPU usage while applications feel slow, which is why this is the number to look at rather than in-guest CPU. See the affected resource on this alert for the VM name, then check the host's CPU utilization and how many vCPUs are scheduled on it, migrate VMs off the host or let DRS rebalance, and consider REMOVING vCPUs from oversized VMs (fewer vCPUs are easier to co-schedule).",
    criteriaName: "VM CPU Ready Contention - Ready > 10%",
    criteriaDescription:
      "Triggers when a virtual machine's average CPU ready percentage stays above 10% for every minute of the monitoring window.",
  });

const vmMemorySaturationTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-memory-saturation",
  name: "VM Memory Saturation",
  description:
    "Alert when a virtual machine's memory utilization stays above 90% of its configured memory for 5 minutes (vcenter.vm.memory.utilization, one incident per VM). The guest is about to start paging internally.",
  category: "Virtual Machine",
  severity: "Warning",
  metricName: "vcenter.vm.memory.utilization",
  metricAlias: "vm_memory_utilization",
  aggregationType: MetricsAggregationType.Avg,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  legendUnit: "%",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 90,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] VM Memory Saturation (>90%) - ${args.monitorName}`;
  },
  incidentDescription:
    "A virtual machine has been above 90% of its configured memory for the whole evaluation window. The guest OS is close to paging to its own swap, and an application inside it may be about to be OOM-killed. See the affected resource on this alert for the VM name, then check memory consumption inside the guest and consider raising the VM's memory allocation (a hot-add if the VM supports it, otherwise at the next maintenance window).",
  criteriaName: "VM Memory Saturation - Utilization > 90%",
  criteriaDescription:
    "Triggers when a virtual machine's average memory utilization stays above 90% for every minute of the monitoring window.",
});

const vmMemoryBallooningTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-memory-ballooning",
  name: "VM Memory Ballooning",
  description:
    "Alert when the balloon driver is reclaiming memory from a virtual machine for 5 minutes (vcenter.vm.memory.ballooned > 0, one incident per VM). Ballooning means the ESXi host is short of memory and is taking it back from this guest — the first stage of host memory pressure.",
  category: "Virtual Machine",
  severity: "Warning",
  metricName: "vcenter.vm.memory.ballooned",
  metricAlias: "vm_memory_ballooned",
  // Max — any collection in the minute showing inflated balloon trips it.
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  fireFilterType: FilterType.GreaterThan,
  fireValue: 0,
  recoverFilterType: FilterType.EqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] VM Memory Ballooning - ${args.monitorName}`;
  },
  incidentDescription:
    "The balloon driver (VMware Tools) has been reclaiming memory from a virtual machine for the whole evaluation window. This only happens when the ESXi host itself is short of memory: the hypervisor inflates a balloon inside the guest to force it to give pages back. The guest may start paging to its own swap as a result. See the affected resource on this alert for the VM name, then check the host's memory utilization and the other VMs on it, and either migrate VMs off the host or add memory to the cluster. If this VM has a memory reservation it should not balloon at all — check the reservation.",
  criteriaName: "VM Memory Ballooning - Ballooned > 0",
  criteriaDescription:
    "Triggers when a virtual machine reports non-zero ballooned memory for every minute of the monitoring window.",
});

const vmMemorySwappingTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-memory-swapping",
  name: "VM Memory Swapping",
  description:
    "Alert when a virtual machine's memory is being swapped to disk by the ESXi host for 5 minutes (vcenter.vm.memory.swapped > 0, one incident per VM). Host-level swapping is the last resort after ballooning and compression: the guest is paying disk latency for RAM and does not know it.",
  category: "Virtual Machine",
  severity: "Critical",
  metricName: "vcenter.vm.memory.swapped",
  metricAlias: "vm_memory_swapped",
  // Max — any collection in the minute showing host-swapped pages trips it.
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  fireFilterType: FilterType.GreaterThan,
  fireValue: 0,
  recoverFilterType: FilterType.EqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] CRITICAL: VM Memory Swapping - ${args.monitorName}`;
  },
  incidentDescription:
    "The ESXi host has been swapping a virtual machine's memory to disk for the whole evaluation window. Host swapping only happens once ballooning and memory compression are exhausted — the host is severely overcommitted, and this VM's memory accesses are now hitting disk latency without the guest OS knowing. Performance inside the guest collapses. See the affected resource on this alert for the VM name, then relieve the host immediately: migrate VMs off it with vMotion, power off non-essential VMs, or add memory capacity. Consider a memory reservation for this VM if it is latency-sensitive.",
  criteriaName: "VM Memory Swapping - Swapped > 0",
  criteriaDescription:
    "Triggers when a virtual machine reports non-zero host-swapped memory for every minute of the monitoring window.",
});

const vmDiskLatencyHighTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-disk-latency-high",
  name: "VM Disk Latency High",
  description:
    "Alert when the highest disk latency a virtual machine sees exceeds 50 ms for 5 minutes (vcenter.vm.disk.latency.max, one incident per VM). Applications inside the guest time out on I/O long before the datastore looks full.",
  category: "Virtual Machine",
  severity: "Warning",
  metricName: "vcenter.vm.disk.latency.max",
  metricAlias: "vm_disk_latency_max",
  // Max per VM — the worst latency in the minute is the honest value.
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  legendUnit: "ms",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 50,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] VM Disk Latency High (>50 ms) - ${args.monitorName}`;
  },
  incidentDescription:
    "A virtual machine has been seeing disk latency above 50 ms for the whole evaluation window. At this level databases stall, application I/O times out, and the guest may log disk errors even though the storage is healthy. See the affected resource on this alert for the VM name, then check whether the latency is on the VM's datastore as a whole (a noisy-neighbour VM or a saturated array) or specific to this VM (a snapshot chain, a thin disk growing, or an in-guest workload driving the IOPS), and look at the host's disk latency for the same period.",
  criteriaName: "VM Disk Latency High - Max Latency > 50 ms",
  criteriaDescription:
    "Triggers when a virtual machine's maximum disk latency stays above 50 ms for every minute of the monitoring window.",
});

const vmDiskUsageHighTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vm-disk-usage-high",
  name: "VM Disk Usage High",
  description:
    "Alert when a virtual machine has committed more than 90% of its provisioned storage on the datastore for 5 minutes (vcenter.vm.disk.utilization, one incident per VM). A thin-provisioned VM at 90% is about to claim its full provisioned size from the datastore.",
  category: "Virtual Machine",
  severity: "Warning",
  metricName: "vcenter.vm.disk.utilization",
  metricAlias: "vm_disk_utilization",
  aggregationType: MetricsAggregationType.Avg,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.VirtualMachine,
  legendUnit: "%",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 90,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] VM Disk Usage High (>90%) - ${args.monitorName}`;
  },
  incidentDescription:
    "A virtual machine has committed more than 90% of its provisioned storage for the whole evaluation window. For a thin-provisioned VM this means it is about to consume its full provisioned size on the datastore — check that the datastore has room for it. See the affected resource on this alert for the VM name, then check for snapshots (a long-lived snapshot chain is the usual cause of unexpected growth), free space inside the guest, or extend the virtual disk.",
  criteriaName: "VM Disk Usage High - Utilization > 90%",
  criteriaDescription:
    "Triggers when a virtual machine's average disk utilization stays above 90% for every minute of the monitoring window.",
});

// --- Datastore templates ---

const datastoreCapacityWarningTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datastore-capacity-warning",
    name: "Datastore Capacity Warning",
    description:
      "Alert when a datastore is more than 80% full for 5 minutes (vcenter.datastore.disk.utilization, one incident per datastore). Early warning — thin-provisioned VMs and snapshots can consume the remaining 20% quickly.",
    category: "Datastore",
    severity: "Warning",
    metricName: "vcenter.datastore.disk.utilization",
    metricAlias: "datastore_utilization",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Datastore,
    legendUnit: "%",
    fireFilterType: FilterType.GreaterThan,
    fireValue: 80,
    recoverFilterType: FilterType.LessThanOrEqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Datastore Capacity Warning (>80%) - ${args.monitorName}`;
    },
    incidentDescription:
      "A datastore is more than 80% full. Thin-provisioned virtual disks grow without warning and snapshot delta files grow with every write, so the remaining space can disappear faster than it looks. See the affected resource on this alert for the datastore name, then delete or consolidate old snapshots, storage-vMotion VMs to a datastore with headroom, or extend the datastore's backing LUN/volume.",
    criteriaName: "Datastore Capacity Warning - Utilization > 80%",
    criteriaDescription:
      "Triggers when a datastore's average disk utilization stays above 80% for every minute of the monitoring window.",
  });

const datastoreCapacityCriticalTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datastore-capacity-critical",
    name: "Datastore Capacity Critical",
    description:
      "Alert when a datastore is more than 90% full for 5 minutes (vcenter.datastore.disk.utilization, one incident per datastore). A datastore that fills up pauses every VM with a disk on it — this is an outage in waiting.",
    category: "Datastore",
    severity: "Critical",
    metricName: "vcenter.datastore.disk.utilization",
    metricAlias: "datastore_utilization",
    aggregationType: MetricsAggregationType.Avg,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.Datastore,
    legendUnit: "%",
    fireFilterType: FilterType.GreaterThan,
    fireValue: 90,
    recoverFilterType: FilterType.LessThanOrEqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] CRITICAL: Datastore Capacity Critical (>90%) - ${args.monitorName}`;
    },
    incidentDescription:
      "A datastore is more than 90% full. When a datastore runs out of space ESXi suspends every VM that tries to write to it (the VM is 'paused' with an out-of-space question in vCenter), and snapshot consolidation and backups fail outright. See the affected resource on this alert for the datastore name, then free space NOW: delete stale snapshots, remove orphaned VM folders and ISOs, storage-vMotion VMs away, or extend the backing volume.",
    criteriaName: "Datastore Capacity Critical - Utilization > 90%",
    criteriaDescription:
      "Triggers when a datastore's average disk utilization stays above 90% for every minute of the monitoring window.",
  });

// --- Cluster templates ---

const clusterHostNotEffectiveTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-cluster-host-not-effective",
    name: "Cluster Host Not Effective",
    description:
      "Alert when a cluster has one or more hosts that are not effective for 5 minutes (vcenter.cluster.host.count filtered to effective = false, one incident per cluster). A host stops being effective when it enters maintenance mode, disconnects or becomes unresponsive — the cluster is running with less capacity than it was sized for, and HA may not be able to restart VMs if another host fails.",
    category: "Cluster",
    severity: "Critical",
    metricName: "vcenter.cluster.host.count",
    metricAlias: "cluster_hosts_not_effective",
    // Max — any collection in the minute showing a non-effective host trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    /*
     * The receiver's boolean `effective` attribute is stored as the string
     * "false" in ClickHouse, so the equality filter uses the string.
     */
    attributes: { effective: "false" },
    groupByAttributeKey: VMwareGroupByKey.Cluster,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] CRITICAL: Cluster Host Not Effective - ${args.monitorName}`;
    },
    incidentDescription:
      "A vSphere cluster has at least one ESXi host that is not effective — it is in maintenance mode, disconnected from vCenter, or not responding. The cluster's effective CPU and memory are reduced accordingly, DRS cannot place VMs on the host, and if the cluster was sized for N+1 it may no longer have the spare capacity HA needs to restart VMs after another failure. See the affected resource on this alert for the cluster name, then check each host's connection state in vCenter (Cluster → Hosts): reconnect a disconnected host, investigate an unresponsive one (management network, hostd), or exit maintenance mode once the work is done.",
    criteriaName: "Cluster Host Not Effective - Non-effective Hosts > 0",
    criteriaDescription:
      "Triggers when a cluster reports one or more non-effective hosts for every minute of the monitoring window.",
  });

// --- Datacenter templates ---

const datacenterHostsUnhealthyTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datacenter-hosts-unhealthy",
    name: "Datacenter Hosts Unhealthy",
    description:
      "Alert when a datacenter has one or more ESXi hosts in the red (critical) status for 5 minutes (vcenter.datacenter.host.count filtered to status = red, one incident per datacenter). Red is vCenter's own overall-status roll-up: a triggered critical alarm on the host — hardware sensor failure, lost storage path, HA agent error.",
    category: "Datacenter",
    severity: "Critical",
    metricName: "vcenter.datacenter.host.count",
    metricAlias: "datacenter_hosts_red",
    // Max — any collection in the minute reporting a red host trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    attributes: { status: "red" },
    groupByAttributeKey: VMwareGroupByKey.Datacenter,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] CRITICAL: Datacenter Hosts Unhealthy - ${args.monitorName}`;
    },
    incidentDescription:
      "A datacenter has at least one ESXi host whose overall status is red. vCenter rolls a host up to red when a critical alarm is triggered on it — a failed hardware sensor (fan, PSU, memory), a lost path to storage, a vSphere HA agent error, or a host that has stopped responding. See the affected resource on this alert for the datacenter name, then open Hosts and Clusters in vCenter, sort hosts by status, and read the triggered alarms on each red host (Host → Monitor → Issues and Alarms).",
    criteriaName: "Datacenter Hosts Unhealthy - Red Hosts > 0",
    criteriaDescription:
      "Triggers when a datacenter reports one or more hosts with red status for every minute of the monitoring window.",
  });

const datacenterHostsDegradedTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datacenter-hosts-degraded",
    name: "Datacenter Hosts Degraded",
    description:
      "Alert when a datacenter has one or more ESXi hosts in the yellow (warning) status for 5 minutes (vcenter.datacenter.host.count filtered to status = yellow, one incident per datacenter). Yellow means a warning-level alarm is triggered on the host — typically a resource threshold or a non-fatal hardware sensor.",
    category: "Datacenter",
    severity: "Warning",
    metricName: "vcenter.datacenter.host.count",
    metricAlias: "datacenter_hosts_yellow",
    // Max — any collection in the minute reporting a yellow host trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    attributes: { status: "yellow" },
    groupByAttributeKey: VMwareGroupByKey.Datacenter,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Datacenter Hosts Degraded - ${args.monitorName}`;
    },
    incidentDescription:
      "A datacenter has at least one ESXi host whose overall status is yellow. vCenter rolls a host up to yellow when a warning-level alarm is triggered on it: host CPU or memory usage past the alarm threshold, a degraded but functioning hardware sensor, a certificate about to expire, or a storage path redundancy warning. See the affected resource on this alert for the datacenter name, then open Hosts and Clusters in vCenter, sort hosts by status, and read the triggered alarms on each yellow host.",
    criteriaName: "Datacenter Hosts Degraded - Yellow Hosts > 0",
    criteriaDescription:
      "Triggers when a datacenter reports one or more hosts with yellow status for every minute of the monitoring window.",
  });

const datacenterHostsPoweredOffTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datacenter-hosts-powered-off",
    name: "Datacenter Hosts Powered Off",
    description:
      "Alert when a datacenter has one or more ESXi hosts reported as powered off for 5 minutes (vcenter.datacenter.host.count filtered to power_state = off, one incident per datacenter). A host powered off outside a planned maintenance window has usually crashed, lost power, or been fenced by DPM.",
    category: "Datacenter",
    severity: "Warning",
    metricName: "vcenter.datacenter.host.count",
    metricAlias: "datacenter_hosts_powered_off",
    // Max — any collection in the minute reporting a powered-off host trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    attributes: { power_state: "off" },
    groupByAttributeKey: VMwareGroupByKey.Datacenter,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Datacenter Hosts Powered Off - ${args.monitorName}`;
    },
    incidentDescription:
      "A datacenter has at least one ESXi host that vCenter reports as powered off. Every VM that was running on it is down unless vSphere HA has restarted it elsewhere. See the affected resource on this alert for the datacenter name, then find the host (Hosts and Clusters, filter by power state), check its out-of-band management (iDRAC / iLO / BMC) for a power or hardware fault, confirm whether HA restarted its VMs, and if Distributed Power Management put it to sleep deliberately consider whether this alert should be scoped to exclude DPM-managed clusters.",
    criteriaName: "Datacenter Hosts Powered Off - Powered-off Hosts > 0",
    criteriaDescription:
      "Triggers when a datacenter reports one or more powered-off hosts for every minute of the monitoring window.",
  });

const datacenterVmsUnhealthyTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datacenter-vms-unhealthy",
    name: "Datacenter VMs Unhealthy",
    description:
      "Alert when a datacenter has one or more virtual machines in the red (critical) status for 5 minutes (vcenter.datacenter.vm.count filtered to status = red, one incident per datacenter). Red on a VM means a critical alarm is triggered on it — a failed HA restart, a lost datastore, VMware Tools heartbeat lost, or a VM-level hardware issue.",
    category: "Datacenter",
    severity: "Warning",
    metricName: "vcenter.datacenter.vm.count",
    metricAlias: "datacenter_vms_red",
    // Max — any collection in the minute reporting a red VM trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    attributes: { status: "red" },
    groupByAttributeKey: VMwareGroupByKey.Datacenter,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Datacenter VMs Unhealthy - ${args.monitorName}`;
    },
    incidentDescription:
      "A datacenter has at least one virtual machine whose overall status is red. vCenter rolls a VM up to red when a critical alarm is triggered on it: vSphere HA failed to restart it, its datastore became inaccessible, VMware Tools stopped heartbeating, or a VM-level CPU/memory alarm fired. See the affected resource on this alert for the datacenter name, then open VMs and Templates in vCenter, sort by status, and read the triggered alarms on each red VM (VM → Monitor → Issues and Alarms).",
    criteriaName: "Datacenter VMs Unhealthy - Red VMs > 0",
    criteriaDescription:
      "Triggers when a datacenter reports one or more VMs with red status for every minute of the monitoring window.",
  });

const datacenterClustersUnhealthyTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-datacenter-clusters-unhealthy",
    name: "Datacenter Clusters Unhealthy",
    description:
      "Alert when a datacenter has one or more clusters in the red (critical) status for 5 minutes (vcenter.datacenter.cluster.count filtered to status = red, one incident per datacenter). A red cluster means a cluster-level critical alarm — vSphere HA failover resources insufficient, HA master election failed, or vSAN health critical.",
    category: "Datacenter",
    severity: "Critical",
    metricName: "vcenter.datacenter.cluster.count",
    metricAlias: "datacenter_clusters_red",
    // Max — any collection in the minute reporting a red cluster trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    attributes: { status: "red" },
    groupByAttributeKey: VMwareGroupByKey.Datacenter,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] CRITICAL: Datacenter Clusters Unhealthy - ${args.monitorName}`;
    },
    incidentDescription:
      "A datacenter has at least one vSphere cluster whose overall status is red. Cluster-level red alarms are the serious ones: insufficient failover resources for vSphere HA (a host failure would leave VMs unrestartable), the HA master could not be elected, a datastore is out of space for heartbeats, or vSAN health has gone critical. See the affected resource on this alert for the datacenter name, then open Hosts and Clusters in vCenter and read the triggered alarms on each red cluster (Cluster → Monitor → Issues and Alarms).",
    criteriaName: "Datacenter Clusters Unhealthy - Red Clusters > 0",
    criteriaDescription:
      "Triggers when a datacenter reports one or more clusters with red status for every minute of the monitoring window.",
  });

// --- vSAN templates ---

const vsanLatencyHighTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vsan-latency-high",
  name: "vSAN Latency High",
  description:
    "Alert when a cluster's average vSAN latency exceeds 20 ms for 5 minutes (vcenter.cluster.vsan.latency.avg > 20 000 µs, one incident per cluster). Every VM on the vSAN datastore feels this as slow disk. Only vSAN-enabled clusters emit the metric, so this monitor is silent elsewhere.",
  category: "vSAN",
  severity: "Warning",
  metricName: "vcenter.cluster.vsan.latency.avg",
  metricAlias: "vsan_latency_avg",
  aggregationType: MetricsAggregationType.Avg,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.Cluster,
  /*
   * The receiver reports vSAN latency in MICROseconds (unlike the host and
   * VM disk latencies, which are milliseconds). The threshold is written in
   * the native unit and pinned, so 20 000 µs stays 20 ms regardless of what
   * the display layer chooses to render.
   */
  legendUnit: "us",
  fireFilterType: FilterType.GreaterThan,
  fireValue: 20000,
  recoverFilterType: FilterType.LessThanOrEqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] vSAN Latency High (>20 ms) - ${args.monitorName}`;
  },
  incidentDescription:
    "A cluster's average vSAN latency has been above 20 ms for the whole evaluation window. vSAN is the datastore for every VM in the cluster, so this is a cluster-wide storage slowdown. See the affected resource on this alert for the cluster name, then open vSAN → Monitor → Performance in vCenter and check whether the latency is on the cache tier (a cache disk failing or full) or the capacity tier, whether a resync/rebuild is running (after a host or disk failure, or a policy change), and whether vSAN congestion is non-zero.",
  criteriaName: "vSAN Latency High - Average Latency > 20 ms",
  criteriaDescription:
    "Triggers when a cluster's average vSAN latency stays above 20 000 µs (20 ms) for every minute of the monitoring window.",
});

const vsanCongestionTemplate: VMwareAlertTemplate = buildThresholdTemplate({
  id: "vmware-vsan-congestion",
  name: "vSAN Congestion",
  description:
    "Alert when a cluster's vSAN layer reports any congestion for 5 minutes (vcenter.cluster.vsan.congestions > 0, one incident per cluster). Congestion is vSAN's own back-pressure signal: a disk group cannot keep up and client I/O is being throttled. Only vSAN-enabled clusters emit the metric.",
  category: "vSAN",
  severity: "Warning",
  metricName: "vcenter.cluster.vsan.congestions",
  metricAlias: "vsan_congestions",
  // Max — any collection in the minute reporting congestion trips it.
  aggregationType: MetricsAggregationType.Max,
  rollingTime: RollingTime.Past5Minutes,
  groupByAttributeKey: VMwareGroupByKey.Cluster,
  fireFilterType: FilterType.GreaterThan,
  fireValue: 0,
  recoverFilterType: FilterType.EqualTo,
  incidentTitle: (args: VMwareAlertTemplateArgs): string => {
    return `[VMware] vSAN Congestion - ${args.monitorName}`;
  },
  incidentDescription:
    "A cluster's vSAN layer has been reporting congestion for the whole evaluation window. Congestion means a disk group's cache tier cannot destage to the capacity tier fast enough, so vSAN is deliberately throttling incoming I/O — every VM on the datastore sees higher latency as a result. See the affected resource on this alert for the cluster name, then open vSAN → Monitor → Performance → Backend in vCenter to find the disk group and the congestion type (SSD, log, memory, slab or IOPS), check for a failing or undersized cache device, and look for a resync storm or a single VM issuing an unusual write burst.",
  criteriaName: "vSAN Congestion - Congestions > 0",
  criteriaDescription:
    "Triggers when a cluster reports non-zero vSAN congestion for every minute of the monitoring window.",
});

// --- Resource pool template ---

const resourcePoolMemorySwappedTemplate: VMwareAlertTemplate =
  buildThresholdTemplate({
    id: "vmware-resource-pool-memory-swapped",
    name: "Resource Pool Memory Swapped",
    description:
      "Alert when the VMs in a resource pool are being host-swapped for 5 minutes (vcenter.resource_pool.memory.swapped > 0, one incident per resource pool, identified by its inventory path). Swapping inside a pool usually means the pool's memory limit or its shares are too low for what it is running.",
    category: "Cluster",
    severity: "Warning",
    metricName: "vcenter.resource_pool.memory.swapped",
    metricAlias: "resource_pool_memory_swapped",
    // Max — any collection in the minute showing host-swapped pages trips it.
    aggregationType: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    groupByAttributeKey: VMwareGroupByKey.ResourcePool,
    fireFilterType: FilterType.GreaterThan,
    fireValue: 0,
    recoverFilterType: FilterType.EqualTo,
    incidentTitle: (args: VMwareAlertTemplateArgs): string => {
      return `[VMware] Resource Pool Memory Swapped - ${args.monitorName}`;
    },
    incidentDescription:
      "The virtual machines in a resource pool have been drawing memory from the ESXi hosts' swap space for the whole evaluation window. When only one pool swaps while the cluster as a whole has memory to spare, the pool's own memory LIMIT is the cause: the pool is being held to a ceiling smaller than its VMs need, and the hypervisor is swapping them to enforce it. See the affected resource on this alert for the resource pool's inventory path, then check the pool's memory limit, reservation and shares (Resource Pool → Configure → Settings), raise or remove the limit, or move VMs to a pool with headroom. If every pool is swapping, treat it as host memory saturation instead.",
    criteriaName: "Resource Pool Memory Swapped - Swapped > 0",
    criteriaDescription:
      "Triggers when a resource pool reports non-zero host-swapped memory for every minute of the monitoring window.",
  });

export function getAllVMwareAlertTemplates(): Array<VMwareAlertTemplate> {
  return [
    hostCpuSaturationTemplate,
    hostMemorySaturationTemplate,
    hostDiskLatencyHighTemplate,
    hostNetworkPacketErrorsTemplate,
    hostNetworkPacketDropsTemplate,
    vmCpuSaturationTemplate,
    vmCpuReadyContentionTemplate,
    vmMemorySaturationTemplate,
    vmMemoryBallooningTemplate,
    vmMemorySwappingTemplate,
    vmDiskLatencyHighTemplate,
    vmDiskUsageHighTemplate,
    datastoreCapacityWarningTemplate,
    datastoreCapacityCriticalTemplate,
    clusterHostNotEffectiveTemplate,
    datacenterHostsUnhealthyTemplate,
    datacenterHostsDegradedTemplate,
    datacenterHostsPoweredOffTemplate,
    datacenterVmsUnhealthyTemplate,
    datacenterClustersUnhealthyTemplate,
    vsanLatencyHighTemplate,
    vsanCongestionTemplate,
    resourcePoolMemorySwappedTemplate,
  ];
}

export function getVMwareAlertTemplatesByCategory(
  category: VMwareAlertTemplateCategory,
): Array<VMwareAlertTemplate> {
  return getAllVMwareAlertTemplates().filter(
    (template: VMwareAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getVMwareAlertTemplateById(
  id: string,
): VMwareAlertTemplate | undefined {
  return getAllVMwareAlertTemplates().find((template: VMwareAlertTemplate) => {
    return template.id === id;
  });
}
