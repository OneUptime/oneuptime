import { VmwareResourceType } from "./MonitorStepVmwareMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type VmwareMetricCategory =
  | "Collection"
  | "Host"
  | "VM"
  | "Datastore"
  | "Health";
export interface VmwareMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: VmwareMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceType?: VmwareResourceType | undefined;
  unit?: string | undefined;
}

const metrics: Array<VmwareMetricDefinition> = [
  {
    id: "collection-up",
    friendlyName: "vSphere API collection",
    description:
      "1 when the agent can read vSphere; 0 when authentication or API collection fails. Missing data means the agent or delivery path is unavailable.",
    metricName: "oneuptime.vmware.source.up",
    category: "Collection",
    defaultAggregation: MetricsAggregationType.Min,
  },
  {
    id: "inventory-complete",
    friendlyName: "Inventory collection complete",
    description:
      "1 when every required inventory query succeeds; 0 when permissions or partial API errors leave visibility incomplete.",
    metricName: "oneuptime.vmware.source.inventory.complete",
    category: "Collection",
    defaultAggregation: MetricsAggregationType.Min,
  },
  {
    id: "resource-observed",
    friendlyName: "Resource observed",
    description:
      "1 when the resource was seen in the latest inventory; 0 for a previously discovered resource that is no longer observed. This does not establish that a VM is down.",
    metricName: "oneuptime.vmware.resource.observed",
    category: "Health",
    defaultAggregation: MetricsAggregationType.Min,
  },
  {
    id: "resource-state",
    friendlyName: "Reported health",
    description:
      "0 unknown, 1 healthy, 2 warning, 3 critical. This is vSphere's reported infrastructure health, not application availability.",
    metricName: "oneuptime.vmware.resource.state",
    category: "Health",
    defaultAggregation: MetricsAggregationType.Max,
  },
  {
    id: "resource-power",
    friendlyName: "Power state",
    description:
      "0 unknown, 1 on, 2 off, 3 suspended, 4 standby. Powering off a VM is only a problem when it is expected to run.",
    metricName: "oneuptime.vmware.resource.power_state",
    category: "Health",
    defaultAggregation: MetricsAggregationType.Max,
  },
  {
    id: "resource-connection",
    friendlyName: "Connection state",
    description:
      "0 unknown, 1 connected, 2 disconnected, 3 not responding, 4 inaccessible, 5 orphaned.",
    metricName: "oneuptime.vmware.resource.connection_state",
    category: "Health",
    defaultAggregation: MetricsAggregationType.Max,
  },
  {
    id: "host-unavailable",
    friendlyName: "Host unavailable",
    description:
      "1 when a host is disconnected or not responding outside maintenance; 0 when connected. Unknown state is not interpreted as recovery.",
    metricName: "oneuptime.vmware.host.unavailable",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceType: VmwareResourceType.Host,
  },
  {
    id: "host-maintenance",
    friendlyName: "Host maintenance",
    description: "1 when vSphere reports maintenance mode; 0 otherwise.",
    metricName: "oneuptime.vmware.host.maintenance",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceType: VmwareResourceType.Host,
  },
  {
    id: "vm-unexpected-off",
    friendlyName: "Expected VM not running",
    description:
      "1 when a VM expected to run is powered off or suspended; 0 when the expectation is satisfied. Expectations can be configured on the resource.",
    metricName: "oneuptime.vmware.vm.unexpected_power_off",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceType: VmwareResourceType.VM,
  },
  {
    id: "vm-expected-running",
    friendlyName: "VM expected to run",
    description:
      "1 when the VM is configured to remain running; 0 when power-off is allowed.",
    metricName: "oneuptime.vmware.vm.expected_running",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceType: VmwareResourceType.VM,
  },
  ...([VmwareResourceType.Host, VmwareResourceType.VM] as const).flatMap(
    (type: VmwareResourceType): Array<VmwareMetricDefinition> => [
      {
        id: `${type}-cpu`,
        friendlyName: `${type === VmwareResourceType.Host ? "Host" : "VM"} CPU utilization`,
        description:
          "CPU use as a percentage of the available host or VM CPU capacity. Sustained utilization is a warning signal, not proof of an outage.",
        metricName: `oneuptime.vmware.${type}.cpu.utilization`,
        category: type === VmwareResourceType.Host ? "Host" : "VM",
        defaultAggregation: MetricsAggregationType.Avg,
        defaultResourceType: type,
        unit: "%",
      },
      {
        id: `${type}-memory`,
        friendlyName: `${type === VmwareResourceType.Host ? "Host" : "VM"} memory utilization`,
        description:
          "Memory use reported by vSphere as a percentage of configured capacity; unavailable readings remain unknown.",
        metricName: `oneuptime.vmware.${type}.memory.utilization`,
        category: type === VmwareResourceType.Host ? "Host" : "VM",
        defaultAggregation: MetricsAggregationType.Avg,
        defaultResourceType: type,
        unit: "%",
      },
    ],
  ),
  ...(["utilization", "capacity", "used", "free"] as const).map(
    (
      field: "utilization" | "capacity" | "used" | "free",
    ): VmwareMetricDefinition => ({
      id: `datastore-${field}`,
      friendlyName: `Datastore ${field}`,
      description:
        field === "utilization"
          ? "Used datastore capacity as a percentage of total capacity."
          : `Datastore ${field} in bytes.`,
      metricName: `oneuptime.vmware.datastore.disk.${field}`,
      category: "Datastore",
      defaultAggregation:
        field === "free"
          ? MetricsAggregationType.Min
          : MetricsAggregationType.Max,
      defaultResourceType: VmwareResourceType.Datastore,
      unit: field === "utilization" ? "%" : "By",
    }),
  ),
];

export function getVmwareMetricCatalog(): Array<VmwareMetricDefinition> {
  return metrics;
}
export const getAllVmwareMetrics: () => Array<VmwareMetricDefinition> =
  getVmwareMetricCatalog;
export function getVmwareMetricsByCategory(
  category: VmwareMetricCategory,
): Array<VmwareMetricDefinition> {
  return metrics.filter(
    (metric: VmwareMetricDefinition) => metric.category === category,
  );
}
export function getVmwareMetricByMetricName(
  name: string,
): VmwareMetricDefinition | undefined {
  return metrics.find(
    (metric: VmwareMetricDefinition) => metric.metricName === name,
  );
}
export function getVmwareMetricById(
  id: string,
): VmwareMetricDefinition | undefined {
  return metrics.find((metric: VmwareMetricDefinition) => metric.id === id);
}
export function getAllVmwareMetricCategories(): Array<VmwareMetricCategory> {
  return ["Collection", "Host", "VM", "Datastore", "Health"];
}
