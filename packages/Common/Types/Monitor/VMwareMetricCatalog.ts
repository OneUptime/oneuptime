import { VMwareResourceScope } from "./MonitorStepVMwareMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";
import {
  VMwareSwapRateCounterMetric,
  VMwareSwapRateMetric,
} from "../VMware/VMwareSwapRates";

export type VMwareMetricCategory =
  | "Datacenter"
  | "Cluster"
  | "Host"
  | "Virtual Machine"
  | "Datastore"
  | "Resource Pool"
  | "vSAN";

export interface VMwareMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: VMwareMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: VMwareResourceScope;
  /**
   * The unit exactly as the vcenter receiver declares it (OTel / UCUM
   * spelling: "MHz", "%", "MiBy", "By", "ms", "us", "{KiBy/s}", "By/s",
   * "{hosts}", ...). The receiver ships real OTLP unit metadata, so no
   * informal aliasing is needed and the display layer can rescale.
   */
  unit?: string;
}

/*
 * Metric names follow the OpenTelemetry Collector `vcenter` receiver naming
 * scheme (`vcenter.<object>.<signal>`). Identity lives in OTel RESOURCE
 * attributes — the receiver emits one resource per vSphere object stamped
 * with `vcenter.datacenter.name`, and depending on the object also
 * `vcenter.cluster.name`, `vcenter.host.name`, `vcenter.vm.name` /
 * `vcenter.vm.id`, `vcenter.datastore.name` or
 * `vcenter.resource_pool.inventory_path`. In ClickHouse those are
 * `resource.`-prefixed (`resource.vcenter.host.name`), while the DATAPOINT
 * attributes named in each description (`direction`, `disk_state`, `status`,
 * `power_state`, `effective`, `object`, `type`, ...) are bare.
 *
 * `defaultResourceScope` is the vSphere object the series describes — i.e.
 * which identity attributes it carries and therefore which one a monitor
 * should group by. A few metrics are disabled by default upstream; they are
 * listed so the picker documents what enabling them in the agent config
 * would unlock, and each says so in its description.
 */
const vmwareMetricCatalog: Array<VMwareMetricDefinition> = [
  // --- Datacenter ---
  {
    id: "vcenter-datacenter-cluster-count",
    friendlyName: translationKey("Datacenter Cluster Count"),
    description: translationKey(
      "Number of clusters in the datacenter, fanned out by the `status` datapoint attribute (red | yellow | green | gray — vSphere's overall status of each cluster). Sum the series for the total; filter `status = red` to count clusters with an active critical alarm.",
    ),
    metricName: "vcenter.datacenter.cluster.count",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "{clusters}",
  },
  {
    id: "vcenter-datacenter-cpu-limit",
    friendlyName: translationKey("Datacenter CPU Capacity"),
    description: translationKey(
      "Total CPU available to the datacenter across every ESXi host, in MHz.",
    ),
    metricName: "vcenter.datacenter.cpu.limit",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "MHz",
  },
  {
    id: "vcenter-datacenter-datastore-count",
    friendlyName: translationKey("Datacenter Datastore Count"),
    description: translationKey("Number of datastores in the datacenter."),
    metricName: "vcenter.datacenter.datastore.count",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "{datastores}",
  },
  {
    id: "vcenter-datacenter-disk-space",
    friendlyName: translationKey("Datacenter Disk Space"),
    description: translationKey(
      "Datastore space across the datacenter in bytes, fanned out by the `disk_state` datapoint attribute (used | available). Filter on `disk_state` to chart one side; used ÷ (used + available) is the datacenter-wide storage utilization.",
    ),
    metricName: "vcenter.datacenter.disk.space",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "By",
  },
  {
    id: "vcenter-datacenter-host-count",
    friendlyName: translationKey("Datacenter Host Count"),
    description: translationKey(
      "Number of ESXi hosts in the datacenter, fanned out by the `status` (red | yellow | green | gray) and `power_state` (on | off | standby | unknown) datapoint attributes. Sum for the total; filter `status = red` or `power_state = off` to count unhealthy or powered-off hosts.",
    ),
    metricName: "vcenter.datacenter.host.count",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "{hosts}",
  },
  {
    id: "vcenter-datacenter-memory-limit",
    friendlyName: translationKey("Datacenter Memory Capacity"),
    description: translationKey(
      "Total physical memory available to the datacenter across every ESXi host, in bytes.",
    ),
    metricName: "vcenter.datacenter.memory.limit",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "By",
  },
  {
    id: "vcenter-datacenter-vm-count",
    friendlyName: translationKey("Datacenter VM Count"),
    description: translationKey(
      "Number of virtual machines in the datacenter, fanned out by the `status` (red | yellow | green | gray) and `power_state` (on | off | suspended | unknown) datapoint attributes. Sum for the total; filter `power_state = on` for the running VM count.",
    ),
    metricName: "vcenter.datacenter.vm.count",
    category: "Datacenter",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: VMwareResourceScope.Datacenter,
    unit: "{virtual_machines}",
  },

  // --- Cluster ---
  {
    id: "vcenter-cluster-cpu-effective",
    friendlyName: translationKey("Cluster Effective CPU"),
    description: translationKey(
      "CPU the cluster can actually schedule, in MHz. Excludes hosts in maintenance mode or that are unresponsive — compare with Cluster CPU Capacity to see how much capacity is currently out of service.",
    ),
    metricName: "vcenter.cluster.cpu.effective",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "MHz",
  },
  {
    id: "vcenter-cluster-cpu-limit",
    friendlyName: translationKey("Cluster CPU Capacity"),
    description: translationKey(
      "Total CPU of every ESXi host in the cluster, in MHz, regardless of host state.",
    ),
    metricName: "vcenter.cluster.cpu.limit",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "MHz",
  },
  {
    id: "vcenter-cluster-host-count",
    friendlyName: translationKey("Cluster Host Count"),
    description: translationKey(
      'Number of ESXi hosts in the cluster, fanned out by the `effective` datapoint attribute ("true" | "false" — stored as strings). A host is not effective while it is in maintenance mode, disconnected or unresponsive, so `effective = false` above 0 means the cluster is running short of a host.',
    ),
    metricName: "vcenter.cluster.host.count",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "{hosts}",
  },
  {
    id: "vcenter-cluster-memory-effective",
    friendlyName: translationKey("Cluster Effective Memory"),
    description: translationKey(
      "Memory the cluster can actually allocate to VMs, in bytes. Excludes memory on hosts in maintenance mode or that are unresponsive, and memory reserved by the ESXi service console.",
    ),
    metricName: "vcenter.cluster.memory.effective",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "By",
  },
  {
    id: "vcenter-cluster-memory-limit",
    friendlyName: translationKey("Cluster Memory Capacity"),
    description: translationKey(
      "Total physical memory of every ESXi host in the cluster, in bytes.",
    ),
    metricName: "vcenter.cluster.memory.limit",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "By",
  },
  {
    id: "vcenter-cluster-vm-count",
    friendlyName: translationKey("Cluster VM Count"),
    description: translationKey(
      "Number of virtual machines in the cluster, fanned out by the `power_state` datapoint attribute (on | off | suspended | unknown). Sum for the total; filter `power_state = on` for the running VM count.",
    ),
    metricName: "vcenter.cluster.vm.count",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Sum,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "{virtual_machines}",
  },
  {
    id: "vcenter-cluster-vm-template-count",
    friendlyName: translationKey("Cluster VM Template Count"),
    description: translationKey(
      "Number of virtual machine templates in the cluster.",
    ),
    metricName: "vcenter.cluster.vm_template.count",
    category: "Cluster",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "{virtual_machine_templates}",
  },

  // --- Host (ESXi) ---
  {
    id: "vcenter-host-cpu-capacity",
    friendlyName: translationKey("Host CPU Capacity"),
    description: translationKey(
      "Total CPU capacity of the ESXi host in MHz (cores × clock). The denominator for Host CPU Usage.",
    ),
    metricName: "vcenter.host.cpu.capacity",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MHz",
  },
  {
    id: "vcenter-host-cpu-reserved",
    friendlyName: translationKey("Host CPU Reserved"),
    description: translationKey(
      "CPU on the ESXi host reserved for virtual machines, in MHz, fanned out by the `cpu_reservation_type` datapoint attribute (total | used). `used` approaching `total` means new reservations will fail admission control.",
    ),
    metricName: "vcenter.host.cpu.reserved",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MHz",
  },
  {
    id: "vcenter-host-cpu-usage",
    friendlyName: translationKey("Host CPU Usage"),
    description: translationKey(
      "CPU currently consumed on the ESXi host, in MHz, across every VM and the hypervisor itself. Divide by Host CPU Capacity for a percentage, or use Host CPU Utilization directly.",
    ),
    metricName: "vcenter.host.cpu.usage",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MHz",
  },
  {
    id: "vcenter-host-cpu-utilization",
    friendlyName: translationKey("Host CPU Utilization"),
    description: translationKey(
      "CPU utilization of the ESXi host as a percentage (0–100) of its capacity. Sustained values above 90% degrade every VM scheduled on the host.",
    ),
    metricName: "vcenter.host.cpu.utilization",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "%",
  },
  {
    id: "vcenter-host-disk-latency-avg",
    friendlyName: translationKey("Host Disk Latency (Average)"),
    description: translationKey(
      "Average latency of the ESXi host's disk operations in milliseconds (device + kernel time), fanned out by the `direction` (read | write) and `object` (disk device instance) datapoint attributes. Requires vCenter performance counter level 2.",
    ),
    metricName: "vcenter.host.disk.latency.avg",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "ms",
  },
  {
    id: "vcenter-host-disk-latency-max",
    friendlyName: translationKey("Host Disk Latency (Max)"),
    description: translationKey(
      "Highest latency observed across every disk the ESXi host uses, in milliseconds, per `object` (disk device instance) datapoint attribute. Measured over the most recent 20 s interval; requires performance counter level 3.",
    ),
    metricName: "vcenter.host.disk.latency.max",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "ms",
  },
  {
    id: "vcenter-host-disk-throughput",
    friendlyName: translationKey("Host Disk Throughput"),
    description: translationKey(
      "Kilobytes per second read from or written to the ESXi host's disks, fanned out by the `direction` (read | write) and `object` (disk device instance) datapoint attributes. Requires performance counter level 4.",
    ),
    metricName: "vcenter.host.disk.throughput",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{KiBy/s}",
  },
  {
    id: "vcenter-host-memory-active",
    friendlyName: translationKey("Host Active Memory"),
    description: translationKey(
      "Memory the ESXi host's powered-on VMs are actively touching, in MiB, over the most recent 20 s interval. Disabled by default in the receiver — enable `vcenter.host.memory.active` in the agent config to collect it.",
    ),
    metricName: "vcenter.host.memory.active",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MiBy",
  },
  {
    id: "vcenter-host-memory-ballooned",
    friendlyName: translationKey("Host Ballooned Memory"),
    description: translationKey(
      "Guest physical memory reclaimed from the ESXi host's VMs by the balloon driver, in MiB. Anything above 0 means the host is under memory pressure. Disabled by default in the receiver — enable `vcenter.host.memory.ballooned` in the agent config to collect it.",
    ),
    metricName: "vcenter.host.memory.ballooned",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MiBy",
  },
  {
    id: "vcenter-host-memory-capacity",
    friendlyName: translationKey("Host Memory Capacity"),
    description: translationKey(
      "Total physical memory of the ESXi host in MiB — the denominator for Host Memory Usage. Disabled by default upstream; the OneUptime agent config enables it so host memory percentages can be derived.",
    ),
    metricName: "vcenter.host.memory.capacity",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MiBy",
  },
  {
    id: "vcenter-host-memory-granted",
    friendlyName: translationKey("Host Granted Memory"),
    description: translationKey(
      "Machine memory granted to the powered-on VMs on the ESXi host, in MiB, over the most recent 20 s interval. Disabled by default in the receiver — enable `vcenter.host.memory.granted` in the agent config to collect it.",
    ),
    metricName: "vcenter.host.memory.granted",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MiBy",
  },
  {
    id: "vcenter-host-memory-usage",
    friendlyName: translationKey("Host Memory Usage"),
    description: translationKey(
      "Memory currently consumed on the ESXi host, in MiB, including the hypervisor's own overhead.",
    ),
    metricName: "vcenter.host.memory.usage",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "MiBy",
  },
  {
    id: "vcenter-host-memory-utilization",
    friendlyName: translationKey("Host Memory Utilization"),
    description: translationKey(
      "Memory utilization of the ESXi host as a percentage (0–100) of its physical capacity. Sustained values above 90% lead to ballooning and swapping across the VMs on the host.",
    ),
    metricName: "vcenter.host.memory.utilization",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "%",
  },
  {
    id: "vcenter-host-memory-swap-out-rate",
    friendlyName: translationKey("Host Swap Out Rate"),
    description: translationKey(
      "How fast the ESXi host swaps memory out to its swap files, in bytes per second, from vSphere's own mem.swapoutRate counter averaged since the previous collection. Only a probe-collected vCenter has it: the VMware Agent's collector cannot read it.",
    ),
    metricName: VMwareSwapRateCounterMetric.HostSwapOut,
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "By/s",
  },
  {
    id: "vcenter-host-memory-swap-in-rate",
    friendlyName: translationKey("Host Swap In Rate"),
    description: translationKey(
      "How fast the ESXi host reads swapped memory back from its swap files, in bytes per second, from vSphere's own mem.swapinRate counter averaged since the previous collection. Only a probe-collected vCenter has it: the VMware Agent's collector cannot read it.",
    ),
    metricName: VMwareSwapRateCounterMetric.HostSwapIn,
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "By/s",
  },
  {
    id: "vcenter-host-network-packet-drop-rate",
    friendlyName: translationKey("Host Network Packet Drop Rate"),
    description: translationKey(
      "Packets per second dropped on each physical NIC of the ESXi host, fanned out by the `direction` (transmitted | received) and `object` (NIC instance, e.g. vmnic0) datapoint attributes. Any sustained non-zero value points at an oversubscribed uplink or a failing NIC.",
    ),
    metricName: "vcenter.host.network.packet.drop.rate",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-host-network-packet-error-rate",
    friendlyName: translationKey("Host Network Packet Error Rate"),
    description: translationKey(
      "Packet errors per second transmitted or received on the ESXi host's physical NICs, fanned out by the `direction` (transmitted | received) and `object` (NIC instance) datapoint attributes. Errors are almost always a cable, SFP or switch-port fault.",
    ),
    metricName: "vcenter.host.network.packet.error.rate",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{errors/s}",
  },
  {
    id: "vcenter-host-network-packet-rate",
    friendlyName: translationKey("Host Network Packet Rate"),
    description: translationKey(
      "Packets per second transmitted or received on each physical NIC of the ESXi host, fanned out by the `direction` (transmitted | received) and `object` (NIC instance) datapoint attributes.",
    ),
    metricName: "vcenter.host.network.packet.rate",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-host-network-throughput",
    friendlyName: translationKey("Host Network Throughput"),
    description: translationKey(
      "Kilobytes per second transmitted or received by the ESXi host, fanned out by the `direction` (transmitted | received) and `object` (NIC instance) datapoint attributes.",
    ),
    metricName: "vcenter.host.network.throughput",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{KiBy/s}",
  },
  {
    id: "vcenter-host-network-usage",
    friendlyName: translationKey("Host Network Usage"),
    description: translationKey(
      "Combined transmit + receive rate across the ESXi host's NICs in kilobytes per second, per `object` (NIC instance) datapoint attribute.",
    ),
    metricName: "vcenter.host.network.usage",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{KiBy/s}",
  },

  // --- Virtual Machine ---
  {
    id: "vcenter-vm-cpu-readiness",
    friendlyName: translationKey("VM CPU Ready"),
    description: translationKey(
      "Percentage of time the virtual machine was ready to run but could not be scheduled on a physical CPU (CPU ready). Above 5% the guest feels sluggish; above 10% the host is CPU-oversubscribed. Emitted only for powered-on VMs.",
    ),
    metricName: "vcenter.vm.cpu.readiness",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "%",
  },
  {
    id: "vcenter-vm-cpu-time",
    friendlyName: translationKey("VM CPU Time by State"),
    description: translationKey(
      "Percentage of time the virtual machine's vCPUs spent in each state, fanned out by the `cpu_state` (idle | ready | wait) and `object` (vCPU instance) datapoint attributes, over the most recent 20 s interval. Disabled by default in the receiver — enable `vcenter.vm.cpu.time` in the agent config to collect it.",
    ),
    metricName: "vcenter.vm.cpu.time",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "%",
  },
  {
    id: "vcenter-vm-cpu-usage",
    friendlyName: translationKey("VM CPU Usage"),
    description: translationKey(
      "CPU consumed by the virtual machine in MHz. Emitted only for powered-on VMs — its presence is how OneUptime infers a VM's power state.",
    ),
    metricName: "vcenter.vm.cpu.usage",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "MHz",
  },
  {
    id: "vcenter-vm-cpu-utilization",
    friendlyName: translationKey("VM CPU Utilization"),
    description: translationKey(
      "CPU utilization of the virtual machine as a percentage (0–100) of its configured vCPUs. Emitted only for powered-on VMs. A VM is entitled to spend the vCPUs it was given, so alert on sustained saturation rather than a spike.",
    ),
    metricName: "vcenter.vm.cpu.utilization",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "%",
  },
  {
    id: "vcenter-vm-disk-latency-avg",
    friendlyName: translationKey("VM Disk Latency (Average)"),
    description: translationKey(
      "Average latency of the virtual machine's disk operations in milliseconds, fanned out by the `direction` (read | write), `disk_type` (virtual | physical) and `object` (virtual disk instance) datapoint attributes. Requires vCenter performance counter level 2.",
    ),
    metricName: "vcenter.vm.disk.latency.avg",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "ms",
  },
  {
    id: "vcenter-vm-disk-latency-max",
    friendlyName: translationKey("VM Disk Latency (Max)"),
    description: translationKey(
      "Highest total latency (device + kernel time) the virtual machine saw on any disk over a 20 s interval, in milliseconds, per `object` (virtual disk instance) datapoint attribute.",
    ),
    metricName: "vcenter.vm.disk.latency.max",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "ms",
  },
  {
    id: "vcenter-vm-disk-throughput",
    friendlyName: translationKey("VM Disk Throughput"),
    description: translationKey(
      "Kilobytes per second read from or written to the virtual machine's disks, fanned out by the `direction` (read | write) and `object` (virtual disk instance) datapoint attributes. Requires performance counter level 2.",
    ),
    metricName: "vcenter.vm.disk.throughput",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{KiBy/s}",
  },
  {
    id: "vcenter-vm-disk-usage",
    friendlyName: translationKey("VM Disk Usage"),
    description: translationKey(
      "Datastore space consumed by the virtual machine's files in bytes, fanned out by the `disk_state` datapoint attribute (used | available). Also emitted for VM templates. Filter `disk_state = used` for the committed size.",
    ),
    metricName: "vcenter.vm.disk.usage",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "By",
  },
  {
    id: "vcenter-vm-disk-utilization",
    friendlyName: translationKey("VM Disk Utilization"),
    description: translationKey(
      "Percentage (0–100) of the virtual machine's provisioned storage that is committed on the datastore. Thin-provisioned VMs approaching 100% are about to consume their full provisioned size.",
    ),
    metricName: "vcenter.vm.disk.utilization",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "%",
  },
  {
    id: "vcenter-vm-memory-ballooned",
    friendlyName: translationKey("VM Ballooned Memory"),
    description: translationKey(
      "Guest memory reclaimed from the virtual machine by the balloon driver (VMware Tools), in MiB. Anything above 0 means the ESXi host is short of memory and is taking it back from this VM.",
    ),
    metricName: "vcenter.vm.memory.ballooned",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "MiBy",
  },
  {
    id: "vcenter-vm-memory-granted",
    friendlyName: translationKey("VM Granted Memory"),
    description: translationKey(
      "Machine memory granted to the virtual machine by the ESXi host, in MiB. Disabled by default in the receiver — enable `vcenter.vm.memory.granted` in the agent config to collect it.",
    ),
    metricName: "vcenter.vm.memory.granted",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "MiBy",
  },
  {
    id: "vcenter-vm-memory-swapped",
    friendlyName: translationKey("VM Swapped Memory"),
    description: translationKey(
      "How much of the virtual machine's memory sits in the ESXi host's swap file, in MiB. ESXi keeps a swapped page there until the guest touches it, so a few MiB can stay for weeks after the memory pressure is gone: an amount is not swapping now. VM Swap Out Rate says whether the host is swapping now.",
    ),
    metricName: "vcenter.vm.memory.swapped",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "MiBy",
  },
  {
    id: "vcenter-vm-memory-swapped-ssd",
    friendlyName: translationKey("VM Memory Swapped to SSD"),
    description: translationKey(
      "Memory of the virtual machine swapped to a host cache on fast flash storage (host swap cache), in KiB. Less painful than swapping to the VM swap file, but still memory pressure.",
    ),
    metricName: "vcenter.vm.memory.swapped_ssd",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "KiBy",
  },
  {
    id: "oneuptime-vmware-vm-memory-swap-out-rate",
    friendlyName: translationKey("VM Swap Out Rate"),
    description: translationKey(
      "How fast the ESXi host swaps the virtual machine's memory out to disk, in bytes per second: whether the host is swapping now. vSphere's own mem.swapoutRate where a probe collects the vCenter; for a vCenter the VMware Agent collects, worked out from the growth of the VM's swapped memory between two reports, which can miss memory swapped out and read back in between. The `source` datapoint attribute says which (vsphere | derived).",
    ),
    metricName: VMwareSwapRateMetric.VirtualMachineSwapOut,
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "By/s",
  },
  {
    id: "oneuptime-vmware-vm-memory-swap-in-rate",
    friendlyName: translationKey("VM Swap In Rate"),
    description: translationKey(
      "How fast the virtual machine reads its swapped memory back from the host's swap file, in bytes per second. vSphere's own mem.swapinRate where a probe collects the vCenter; for a vCenter the VMware Agent collects, worked out from the shrinking of the VM's swapped memory between two reports. The `source` datapoint attribute says which (vsphere | derived).",
    ),
    metricName: VMwareSwapRateMetric.VirtualMachineSwapIn,
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "By/s",
  },
  {
    id: "vcenter-vm-memory-usage",
    friendlyName: translationKey("VM Memory Usage"),
    description: translationKey(
      "Memory actively used by the virtual machine's guest, in MiB. Emitted for powered-on and powered-off VMs alike (0 when off).",
    ),
    metricName: "vcenter.vm.memory.usage",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "MiBy",
  },
  {
    id: "vcenter-vm-memory-utilization",
    friendlyName: translationKey("VM Memory Utilization"),
    description: translationKey(
      "Memory utilization of the virtual machine as a percentage (0–100) of its configured memory.",
    ),
    metricName: "vcenter.vm.memory.utilization",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "%",
  },
  {
    id: "vcenter-vm-network-broadcast-packet-rate",
    friendlyName: translationKey("VM Broadcast Packet Rate"),
    description: translationKey(
      "Broadcast packets per second transmitted or received by each vNIC of the virtual machine, fanned out by the `direction` (transmitted | received) and `object` (vNIC instance) datapoint attributes. Disabled by default in the receiver — enable `vcenter.vm.network.broadcast.packet.rate` in the agent config to collect it.",
    ),
    metricName: "vcenter.vm.network.broadcast.packet.rate",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-vm-network-multicast-packet-rate",
    friendlyName: translationKey("VM Multicast Packet Rate"),
    description: translationKey(
      "Multicast packets per second transmitted or received by each vNIC of the virtual machine, fanned out by the `direction` (transmitted | received) and `object` (vNIC instance) datapoint attributes. Disabled by default in the receiver — enable `vcenter.vm.network.multicast.packet.rate` in the agent config to collect it.",
    ),
    metricName: "vcenter.vm.network.multicast.packet.rate",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-vm-network-packet-drop-rate",
    friendlyName: translationKey("VM Network Packet Drop Rate"),
    description: translationKey(
      "Packets per second dropped by each vNIC of the virtual machine, fanned out by the `direction` (transmitted | received) and `object` (vNIC instance) datapoint attributes. Receive-side drops usually mean the guest is not draining its ring buffer fast enough.",
    ),
    metricName: "vcenter.vm.network.packet.drop.rate",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-vm-network-packet-rate",
    friendlyName: translationKey("VM Network Packet Rate"),
    description: translationKey(
      "Packets per second transmitted or received by each vNIC of the virtual machine, fanned out by the `direction` (transmitted | received) and `object` (vNIC instance) datapoint attributes.",
    ),
    metricName: "vcenter.vm.network.packet.rate",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{packets/s}",
  },
  {
    id: "vcenter-vm-network-throughput",
    friendlyName: translationKey("VM Network Throughput"),
    description: translationKey(
      "Bytes per second transmitted or received over the virtual machine's network, fanned out by the `direction` (transmitted | received) and `object` (vNIC instance) datapoint attributes.",
    ),
    metricName: "vcenter.vm.network.throughput",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "By/s",
  },
  {
    id: "vcenter-vm-network-usage",
    friendlyName: translationKey("VM Network Usage"),
    description: translationKey(
      "Combined transmit + receive rate of the virtual machine in kilobytes per second, per `object` (vNIC instance) datapoint attribute.",
    ),
    metricName: "vcenter.vm.network.usage",
    category: "Virtual Machine",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{KiBy/s}",
  },

  // --- Datastore ---
  {
    id: "vcenter-datastore-disk-usage",
    friendlyName: translationKey("Datastore Disk Usage"),
    description: translationKey(
      "Space on the datastore in bytes, fanned out by the `disk_state` datapoint attribute (used | available). Filter on `disk_state` to chart one side; used + available is the datastore's capacity.",
    ),
    metricName: "vcenter.datastore.disk.usage",
    category: "Datastore",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Datastore,
    unit: "By",
  },
  {
    id: "vcenter-datastore-disk-utilization",
    friendlyName: translationKey("Datastore Disk Utilization"),
    description: translationKey(
      "Percentage (0–100) of the datastore's capacity in use. A full datastore pauses every VM writing to it, so alert well before 100%.",
    ),
    metricName: "vcenter.datastore.disk.utilization",
    category: "Datastore",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Datastore,
    unit: "%",
  },

  // --- Resource Pool ---
  {
    id: "vcenter-resource-pool-cpu-shares",
    friendlyName: translationKey("Resource Pool CPU Shares"),
    description: translationKey(
      "CPU shares configured on the resource pool — its relative priority against sibling pools when the parent is contended.",
    ),
    metricName: "vcenter.resource_pool.cpu.shares",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "{shares}",
  },
  {
    id: "vcenter-resource-pool-cpu-usage",
    friendlyName: translationKey("Resource Pool CPU Usage"),
    description: translationKey(
      "CPU consumed by every VM in the resource pool (and its child pools), in MHz.",
    ),
    metricName: "vcenter.resource_pool.cpu.usage",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "MHz",
  },
  {
    id: "vcenter-resource-pool-memory-ballooned",
    friendlyName: translationKey("Resource Pool Ballooned Memory"),
    description: translationKey(
      "Memory reclaimed by the balloon driver across every VM in the resource pool, in MiB. Above 0 means the pool's VMs are under memory pressure.",
    ),
    metricName: "vcenter.resource_pool.memory.ballooned",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "MiBy",
  },
  {
    id: "vcenter-resource-pool-memory-granted",
    friendlyName: translationKey("Resource Pool Granted Memory"),
    description: translationKey(
      "Host memory granted to the VMs in the resource pool, in MiB, fanned out by the `type` datapoint attribute (private | shared — shared pages are deduplicated by transparent page sharing).",
    ),
    metricName: "vcenter.resource_pool.memory.granted",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "MiBy",
  },
  {
    id: "vcenter-resource-pool-memory-shares",
    friendlyName: translationKey("Resource Pool Memory Shares"),
    description: translationKey(
      "Memory shares configured on the resource pool — its relative priority against sibling pools when the parent is contended.",
    ),
    metricName: "vcenter.resource_pool.memory.shares",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "{shares}",
  },
  {
    id: "vcenter-resource-pool-memory-swapped",
    friendlyName: translationKey("Resource Pool Swapped Memory"),
    description: translationKey(
      "How much memory of the VMs in the resource pool sits in the ESXi hosts' swap files, in MiB. ESXi keeps a swapped page there until the guest touches it, so an amount left from earlier pressure is not swapping now. Resource Pool Swap Out Rate says whether the hosts are swapping now.",
    ),
    metricName: "vcenter.resource_pool.memory.swapped",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "MiBy",
  },
  {
    id: "oneuptime-vmware-resource-pool-memory-swap-out-rate",
    friendlyName: translationKey("Resource Pool Swap Out Rate"),
    description: translationKey(
      "How fast the ESXi hosts swap the memory of the resource pool's VMs out to disk, in bytes per second: whether they are swapping now. Worked out from the growth of the pool's swapped memory between two reports - vSphere has no swap rate counter for a resource pool.",
    ),
    metricName: VMwareSwapRateMetric.ResourcePoolSwapOut,
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "By/s",
  },
  {
    id: "oneuptime-vmware-resource-pool-memory-swap-in-rate",
    friendlyName: translationKey("Resource Pool Swap In Rate"),
    description: translationKey(
      "How fast the resource pool's VMs read swapped memory back, in bytes per second, worked out from the shrinking of the pool's swapped memory between two reports.",
    ),
    metricName: VMwareSwapRateMetric.ResourcePoolSwapIn,
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "By/s",
  },
  {
    id: "vcenter-resource-pool-memory-usage",
    friendlyName: translationKey("Resource Pool Memory Usage"),
    description: translationKey(
      "Memory used by the resource pool, in MiB, fanned out by the `type` datapoint attribute (guest | host | overhead) on recent collector builds — older builds emit a single untyped series. Filter `type = guest` for the memory the pool's guests are actually consuming.",
    ),
    metricName: "vcenter.resource_pool.memory.usage",
    category: "Resource Pool",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.ResourcePool,
    unit: "MiBy",
  },

  // --- vSAN ---
  {
    id: "vcenter-cluster-vsan-congestions",
    friendlyName: translationKey("Cluster vSAN Congestions"),
    description: translationKey(
      "Congestion events per second raised against I/O from every vSAN client in the cluster. vSAN throttles client I/O when a disk group falls behind, so any sustained non-zero value shows up as latency in every VM on the datastore. Only emitted for vSAN-enabled clusters.",
    ),
    metricName: "vcenter.cluster.vsan.congestions",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "{congestions/s}",
  },
  {
    id: "vcenter-cluster-vsan-latency-avg",
    friendlyName: translationKey("Cluster vSAN Latency"),
    description: translationKey(
      "Average latency the cluster sees when accessing vSAN storage, in microseconds, fanned out by the `type` datapoint attribute (read | write). 20 000 µs = 20 ms. Only emitted for vSAN-enabled clusters.",
    ),
    metricName: "vcenter.cluster.vsan.latency.avg",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "us",
  },
  {
    id: "vcenter-cluster-vsan-operations",
    friendlyName: translationKey("Cluster vSAN IOPS"),
    description: translationKey(
      "vSAN I/O operations per second across the cluster, fanned out by the `type` datapoint attribute (read | write | unmap). Only emitted for vSAN-enabled clusters.",
    ),
    metricName: "vcenter.cluster.vsan.operations",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "{operations/s}",
  },
  {
    id: "vcenter-cluster-vsan-throughput",
    friendlyName: translationKey("Cluster vSAN Throughput"),
    description: translationKey(
      "vSAN throughput of the cluster in bytes per second, fanned out by the `direction` datapoint attribute (read | write). Only emitted for vSAN-enabled clusters.",
    ),
    metricName: "vcenter.cluster.vsan.throughput",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Cluster,
    unit: "By/s",
  },
  {
    id: "vcenter-host-vsan-cache-hit-rate",
    friendlyName: translationKey("Host vSAN Cache Hit Rate"),
    description: translationKey(
      "Percentage of the ESXi host's vSAN read I/O served from its local client cache over the most recent 5 min interval. A falling hit rate means reads are going to the capacity tier. Only emitted for hosts in a vSAN cluster.",
    ),
    metricName: "vcenter.host.vsan.cache.hit_rate",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "%",
  },
  {
    id: "vcenter-host-vsan-congestions",
    friendlyName: translationKey("Host vSAN Congestions"),
    description: translationKey(
      "Congestion events per second raised against vSAN I/O from the ESXi host over the most recent 5 min interval. Only emitted for hosts in a vSAN cluster.",
    ),
    metricName: "vcenter.host.vsan.congestions",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{congestions/s}",
  },
  {
    id: "vcenter-host-vsan-latency-avg",
    friendlyName: translationKey("Host vSAN Latency"),
    description: translationKey(
      "Average latency the ESXi host sees when accessing vSAN storage, in microseconds, fanned out by the `type` datapoint attribute (read | write), over the most recent 5 min interval. Only emitted for hosts in a vSAN cluster.",
    ),
    metricName: "vcenter.host.vsan.latency.avg",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "us",
  },
  {
    id: "vcenter-host-vsan-operations",
    friendlyName: translationKey("Host vSAN IOPS"),
    description: translationKey(
      "vSAN I/O operations per second issued by the ESXi host, fanned out by the `type` datapoint attribute (read | write | unmap), over the most recent 5 min interval. Only emitted for hosts in a vSAN cluster.",
    ),
    metricName: "vcenter.host.vsan.operations",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "{operations/s}",
  },
  {
    id: "vcenter-host-vsan-throughput",
    friendlyName: translationKey("Host vSAN Throughput"),
    description: translationKey(
      "vSAN throughput of the ESXi host in bytes per second, fanned out by the `direction` datapoint attribute (read | write), over the most recent 5 min interval. Only emitted for hosts in a vSAN cluster.",
    ),
    metricName: "vcenter.host.vsan.throughput",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.Host,
    unit: "By/s",
  },
  {
    id: "vcenter-vm-vsan-latency-avg",
    friendlyName: translationKey("VM vSAN Latency"),
    description: translationKey(
      "Average latency the virtual machine sees when accessing vSAN storage, in microseconds, fanned out by the `type` datapoint attribute (read | write). Only emitted for VMs on a vSAN datastore.",
    ),
    metricName: "vcenter.vm.vsan.latency.avg",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "us",
  },
  {
    id: "vcenter-vm-vsan-operations",
    friendlyName: translationKey("VM vSAN IOPS"),
    description: translationKey(
      "vSAN I/O operations per second issued by the virtual machine, fanned out by the `type` datapoint attribute (read | write | unmap). Only emitted for VMs on a vSAN datastore.",
    ),
    metricName: "vcenter.vm.vsan.operations",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "{operations/s}",
  },
  {
    id: "vcenter-vm-vsan-throughput",
    friendlyName: translationKey("VM vSAN Throughput"),
    description: translationKey(
      "vSAN throughput of the virtual machine in bytes per second, fanned out by the `direction` datapoint attribute (read | write). Only emitted for VMs on a vSAN datastore.",
    ),
    metricName: "vcenter.vm.vsan.throughput",
    category: "vSAN",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: VMwareResourceScope.VirtualMachine,
    unit: "By/s",
  },
];

export function getAllVMwareMetrics(): Array<VMwareMetricDefinition> {
  return vmwareMetricCatalog;
}

export function getVMwareMetricsByCategory(
  category: VMwareMetricCategory,
): Array<VMwareMetricDefinition> {
  return vmwareMetricCatalog.filter((m: VMwareMetricDefinition) => {
    return m.category === category;
  });
}

export function getVMwareMetricById(
  id: string,
): VMwareMetricDefinition | undefined {
  return vmwareMetricCatalog.find((m: VMwareMetricDefinition) => {
    return m.id === id;
  });
}

export function getVMwareMetricByMetricName(
  metricName: string,
): VMwareMetricDefinition | undefined {
  return vmwareMetricCatalog.find((m: VMwareMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllVMwareMetricCategories(): Array<VMwareMetricCategory> {
  return [
    "Datacenter",
    "Cluster",
    "Host",
    "Virtual Machine",
    "Datastore",
    "Resource Pool",
    "vSAN",
  ];
}

/*
 * Each group's heading in the metric picker, a key: a category is an
 * identifier the catalog's metrics name, so the picker looks its heading up
 * here, once (#8353).
 */
const categoryLabels: Record<VMwareMetricCategory, string> = {
  Datacenter: translationKey("Datacenter"),
  Cluster: translationKey("Cluster"),
  Host: translationKey("Host"),
  "Virtual Machine": translationKey("Virtual Machine"),
  Datastore: translationKey("Datastore"),
  "Resource Pool": translationKey("Resource Pool"),
  vSAN: translationKey("vSAN"),
};

export function getVMwareMetricCategoryLabel(
  category: VMwareMetricCategory,
): string {
  return categoryLabels[category] || category;
}
