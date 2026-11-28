import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import { translationKey } from "../Translator";
import { XcpNgScope } from "../XcpNg/XcpNgTelemetry";

export type XcpNgMetricCategory =
  | "Availability"
  | "Host"
  | "VM"
  | "Storage"
  | "Network"
  | "XOSTOR";

export interface XcpNgMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: XcpNgMetricCategory;
  defaultAggregation: MetricsAggregationType;
  // The xcp_ng.scope the metric describes: what a monitor filter pre-selects.
  defaultResourceScope: XcpNgScope;
  unit?: string;
  /*
   * True for a series Xen Orchestra types `counter` whose values are XAPI's
   * per-second rates (XCP_NG_RATE_TYPED_AS_COUNTER_SERIES): OneUptime stores
   * it as a gauge, and its unit is per second.
   */
  isRateTypedAsCounter?: boolean;
  // True for a series OneUptime derives at ingest (XcpNgDerivedSeries).
  isDerivedByOneUptime?: boolean;
}

/*
 * Every series of Xen Orchestra's OpenMetrics plugin (xo-server-openmetrics
 * 1.9, the names its documentation lists), and the 0/1 health series
 * OneUptime derives from its status series at ingest. Units are what the
 * stored values are in: Xen Orchestra already converts XAPI's KiB, MiB/s and
 * microseconds to bytes, bytes per second and seconds.
 *
 * Every datapoint carries `xcp_ng.scope` (pool | host | vm | sr | vdi |
 * xostor) and `xcp_ng.id` (the object's UUID), stamped at ingest
 * (XcpNgSeriesNormalizer), besides Xen Orchestra's own labels (pool_id,
 * uuid, host_name, vm_name, sr_name, ...). `defaultResourceScope` is the
 * xcp_ng.scope a monitor filter on the metric pre-selects.
 */
const xcpNgMetricCatalog: Array<XcpNgMetricDefinition> = [
  // Availability
  {
    id: "xcp-pool-connected",
    friendlyName: translationKey("Pool Connected"),
    description: translationKey(
      "1 while Xen Orchestra is connected to the pool. Xen Orchestra stops sending it when it loses the pool, rather than sending 0: watch for it to stop.",
    ),
    metricName: "xcp_pool_connected",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Pool,
    unit: "",
  },
  {
    id: "xcp-ng-host-running",
    friendlyName: translationKey("Host Running"),
    description: translationKey(
      "1 while Xen Orchestra reports a host Running, 0 while it is Halted or its state is Unknown. Derived by OneUptime from the host's status.",
    ),
    metricName: "xcp_ng.host.running",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Host,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-host-enabled",
    friendlyName: translationKey("Host Enabled"),
    description: translationKey(
      "1 while a host is enabled, 0 while it is in maintenance mode or being evacuated, when XAPI starts no VM on it. Derived by OneUptime from the host's status.",
    ),
    metricName: "xcp_ng.host.enabled",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Host,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-vm-running",
    friendlyName: translationKey("VM Running"),
    description: translationKey(
      "1 while a VM is Running, 0 while it is Halted, Paused or Suspended. Control domains are left out. Derived by OneUptime from the VM's status.",
    ),
    metricName: "xcp_ng.vm.running",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.VM,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-vm-stopped-after-running",
    friendlyName: translationKey("VM Stopped After Running"),
    description: translationKey(
      "1 while a VM that ran in the last 24 hours is Halted or Paused, else 0. A VM nobody saw running for a day counts as switched off on purpose, and a suspended VM never counts. Derived by OneUptime.",
    ),
    metricName: "xcp_ng.vm.stopped_after_running",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VM,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-pool-ha-enabled",
    friendlyName: translationKey("HA Enabled"),
    description: translationKey(
      "1 while the pool's high availability is on, else 0. Read by a probe through Xen Orchestra's REST API or straight from XAPI; the XCP-ng Agent does not read it.",
    ),
    metricName: "xcp_ng.pool.ha.enabled",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Pool,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-pool-ha-can-tolerate-host-failure",
    friendlyName: translationKey("HA Can Tolerate a Host Failure"),
    description: translationKey(
      "While HA is on: 1 while it can still survive a host failure, 0 once it cannot. Straight from XAPI it is HA's own plan; through Xen Orchestra, which does not report the plan, whether a host is up and enabled beyond the one that fails. Derived by OneUptime.",
    ),
    metricName: "xcp_ng.pool.ha.can_tolerate_host_failure",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Pool,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-pool-ha-host-failures-to-tolerate",
    friendlyName: translationKey("HA Host Failures to Tolerate"),
    description: translationKey(
      "How many host failures HA is set to tolerate. Read straight from XAPI only: Xen Orchestra's REST API does not report it.",
    ),
    metricName: "xcp_ng.pool.ha.host_failures_to_tolerate",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Pool,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-pool-ha-plan-exists-for",
    friendlyName: translationKey("HA Plan Covers"),
    description: translationKey(
      "How many host failures HA's plan can still survive with every protected VM restarted. Read straight from XAPI only.",
    ),
    metricName: "xcp_ng.pool.ha.plan_exists_for",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Pool,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-vm-backup-overdue",
    friendlyName: translationKey("VM Backup Overdue"),
    description: translationKey(
      "For a VM in a scheduled Xen Orchestra backup job: 1 while it has had no successful backup within its jobs' interval and a quarter of it more (at least an hour), else 0. Derived by OneUptime from the backup logs.",
    ),
    metricName: "xcp_ng.vm.backup_overdue",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VM,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-ng-host-missing-patches",
    friendlyName: translationKey("Host Missing Patches"),
    description: translationKey(
      "How many patches a host misses, as Xen Orchestra last listed them (checked every six hours).",
    ),
    metricName: "xcp_ng.host.missing_patches",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Host,
    unit: "",
    isDerivedByOneUptime: true,
  },
  {
    id: "xcp-host-status",
    friendlyName: translationKey("Host Status"),
    description: translationKey(
      "Always 1 for every host, running or not; the host's state is in the power_state (Running, Halted, Unknown) and enabled labels.",
    ),
    metricName: "xcp_host_status",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Host,
    unit: "count",
  },
  {
    id: "xcp-vm-status",
    friendlyName: translationKey("VM Status"),
    description: translationKey(
      "Always 1 for every VM but control domains and templates; the VM's state is in the power_state label (Running, Halted, Paused, Suspended).",
    ),
    metricName: "xcp_vm_status",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VM,
    unit: "count",
  },
  {
    id: "xcp-host-uptime-seconds",
    friendlyName: translationKey("Host Uptime"),
    description: translationKey("How long a host has been up since it booted."),
    metricName: "xcp_host_uptime_seconds",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Host,
    unit: "seconds",
  },
  {
    id: "xcp-vm-uptime-seconds",
    friendlyName: translationKey("VM Uptime"),
    description: translationKey(
      "How long a running VM has been up since it started. Reported only while the VM runs.",
    ),
    metricName: "xcp_vm_uptime_seconds",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.VM,
    unit: "seconds",
  },

  // Host
  {
    id: "xcp-host-cpu-average",
    friendlyName: translationKey("Host CPU Usage"),
    description: translationKey(
      "A host's CPU use averaged over its cores, as a ratio from 0 to 1.",
    ),
    metricName: "xcp_host_cpu_average",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ratio",
  },
  {
    id: "xcp-host-cpu-core-usage",
    friendlyName: translationKey("Host CPU Core Usage"),
    description: translationKey(
      "One CPU thread's use on a host, as a ratio from 0 to 1; the core label says which.",
    ),
    metricName: "xcp_host_cpu_core_usage",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ratio",
  },
  {
    id: "xcp-host-load",
    friendlyName: translationKey("Host Load"),
    description: translationKey(
      "The vCPUs running or waiting to run on a host, per physical CPU. Above 1, VMs wait for a CPU.",
    ),
    metricName: "xcp_host_load",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "",
  },
  {
    id: "xcp-host-load-average",
    friendlyName: translationKey("Host Load Average"),
    description: translationKey(
      "The load average of a host's control domain (dom0).",
    ),
    metricName: "xcp_host_load_average",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "",
  },
  {
    id: "xcp-host-memory-total-bytes",
    friendlyName: translationKey("Host Memory Total"),
    description: translationKey("A host's physical memory."),
    metricName: "xcp_host_memory_total_bytes",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes",
  },
  {
    id: "xcp-host-memory-free-bytes",
    friendlyName: translationKey("Host Memory Free"),
    description: translationKey(
      "A host's memory not given to any VM. Compare with Host Memory Total to see how full it is.",
    ),
    metricName: "xcp_host_memory_free_bytes",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes",
  },
  {
    id: "xcp-host-memory-reclaimed-bytes",
    friendlyName: translationKey("Host Memory Reclaimed"),
    description: translationKey(
      "Memory reclaimed from a host's VMs by dynamic memory control.",
    ),
    metricName: "xcp_host_memory_reclaimed_bytes",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes",
  },
  {
    id: "xcp-host-memory-reclaimed-max-bytes",
    friendlyName: translationKey("Host Memory Reclaimable"),
    description: translationKey(
      "The most memory dynamic memory control could reclaim from a host's VMs.",
    ),
    metricName: "xcp_host_memory_reclaimed_max_bytes",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes",
  },
  {
    id: "xcp-host-running-vcpus",
    friendlyName: translationKey("Host Running vCPUs"),
    description: translationKey(
      "The vCPUs of the VMs running on a host, added up.",
    ),
    metricName: "xcp_host_running_vcpus",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Host,
    unit: "count",
  },
  {
    id: "xcp-host-power-consumption-watts",
    friendlyName: translationKey("Host Power"),
    description: translationKey(
      "A host's power draw, read from its DCMI or IPMI sensor. Hosts without one report none.",
    ),
    metricName: "xcp_host_power_consumption_watts",
    category: "Host",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "W",
  },

  // VM
  {
    id: "xcp-vm-cpu-usage",
    friendlyName: translationKey("VM CPU Usage"),
    description: translationKey(
      "A VM's CPU use averaged over its vCPUs, as a ratio from 0 to 1.",
    ),
    metricName: "xcp_vm_cpu_usage",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-cpu-core-usage",
    friendlyName: translationKey("VM vCPU Usage"),
    description: translationKey(
      "One vCPU's use, as a ratio from 0 to 1; the core label says which.",
    ),
    metricName: "xcp_vm_cpu_core_usage",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-full-contention",
    friendlyName: translationKey("VM CPU Contention"),
    description: translationKey(
      "The share of time all of a VM's vCPUs were ready to run but waited for a physical CPU, from 0 to 1. A high value means the VM is starved of CPU by its neighbours.",
    ),
    metricName: "xcp_vm_runstate_full_contention",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-partial-contention",
    friendlyName: translationKey("VM Partial CPU Contention"),
    description: translationKey(
      "The share of time some of a VM's vCPUs waited for a physical CPU while the rest were blocked, from 0 to 1.",
    ),
    metricName: "xcp_vm_runstate_partial_contention",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-concurrency-hazard",
    friendlyName: translationKey("VM Concurrency Hazard"),
    description: translationKey(
      "The share of time some of a VM's vCPUs ran while others waited for a physical CPU, from 0 to 1.",
    ),
    metricName: "xcp_vm_runstate_concurrency_hazard",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-fullrun",
    friendlyName: translationKey("VM Full Run"),
    description: translationKey(
      "The share of time all of a VM's vCPUs were running, from 0 to 1.",
    ),
    metricName: "xcp_vm_runstate_fullrun",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-partial-run",
    friendlyName: translationKey("VM Partial Run"),
    description: translationKey(
      "The share of time some of a VM's vCPUs were running and the rest were blocked, from 0 to 1.",
    ),
    metricName: "xcp_vm_runstate_partial_run",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-runstate-blocked",
    friendlyName: translationKey("VM Blocked"),
    description: translationKey(
      "The share of time all of a VM's vCPUs were blocked, waiting on nothing to do or on I/O, from 0 to 1.",
    ),
    metricName: "xcp_vm_runstate_blocked",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-memory-bytes",
    friendlyName: translationKey("VM Memory"),
    description: translationKey("The memory a VM has been given."),
    metricName: "xcp_vm_memory_bytes",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes",
  },
  {
    id: "xcp-vm-memory-target-bytes",
    friendlyName: translationKey("VM Memory Target"),
    description: translationKey(
      "The memory dynamic memory control aims to give a VM.",
    ),
    metricName: "xcp_vm_memory_target_bytes",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes",
  },
  {
    id: "xcp-vm-memory-internal-free-bytes",
    friendlyName: translationKey("VM Memory Free"),
    description: translationKey(
      "The memory the guest reports free. Needs the guest tools in the VM.",
    ),
    metricName: "xcp_vm_memory_internal_free_bytes",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes",
  },
  {
    id: "xcp-vm-power-consumption-watts",
    friendlyName: translationKey("VM Power Estimate"),
    description: translationKey(
      "Xen Orchestra's estimate of a VM's share of its host's power, split by CPU load. Its data_complete label is false when the VM's CPU reading was missing.",
    ),
    metricName: "xcp_vm_power_consumption_watts",
    category: "VM",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "W",
  },

  // Storage
  {
    id: "xcp-sr-physical-size-bytes",
    friendlyName: translationKey("Storage Repository Size"),
    description: translationKey(
      "A storage repository's physical size. Some ISO libraries and removable media report 0.",
    ),
    metricName: "xcp_sr_physical_size_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.StorageRepository,
    unit: "bytes",
  },
  {
    id: "xcp-sr-physical-usage-bytes",
    friendlyName: translationKey("Storage Repository Used"),
    description: translationKey(
      "The space used on a storage repository. Divide by its size to see how full it is.",
    ),
    metricName: "xcp_sr_physical_usage_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.StorageRepository,
    unit: "bytes",
  },
  {
    id: "xcp-sr-virtual-size-bytes",
    friendlyName: translationKey("Storage Repository Allocated"),
    description: translationKey(
      "The virtual size of every disk on a storage repository, added up. Above its size, the repository is thin-provisioned past what it can hold.",
    ),
    metricName: "xcp_sr_virtual_size_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.StorageRepository,
    unit: "bytes",
  },
  {
    id: "xcp-vdi-virtual-size-bytes",
    friendlyName: translationKey("Virtual Disk Size"),
    description: translationKey("A virtual disk's size as its VM sees it."),
    metricName: "xcp_vdi_virtual_size_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VDI,
    unit: "bytes",
  },
  {
    id: "xcp-vdi-physical-usage-bytes",
    friendlyName: translationKey("Virtual Disk Used"),
    description: translationKey(
      "The space a virtual disk takes on its storage repository.",
    ),
    metricName: "xcp_vdi_physical_usage_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VDI,
    unit: "bytes",
  },
  {
    id: "xcp-host-disk-iops-read",
    friendlyName: translationKey("Host Read IOPS"),
    description: translationKey(
      "Read operations per second from a host to a storage repository; the sr_name label says which.",
    ),
    metricName: "xcp_host_disk_iops_read",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ops/s",
  },
  {
    id: "xcp-host-disk-iops-write",
    friendlyName: translationKey("Host Write IOPS"),
    description: translationKey(
      "Write operations per second from a host to a storage repository.",
    ),
    metricName: "xcp_host_disk_iops_write",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ops/s",
  },
  {
    id: "xcp-host-disk-iops-total",
    friendlyName: translationKey("Host IOPS"),
    description: translationKey(
      "Read and write operations per second from a host to a storage repository.",
    ),
    metricName: "xcp_host_disk_iops_total",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ops/s",
  },
  {
    id: "xcp-host-disk-throughput-read-bytes",
    friendlyName: translationKey("Host Read Throughput"),
    description: translationKey(
      "Bytes per second a host reads from a storage repository.",
    ),
    metricName: "xcp_host_disk_throughput_read_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
  },
  {
    id: "xcp-host-disk-throughput-write-bytes",
    friendlyName: translationKey("Host Write Throughput"),
    description: translationKey(
      "Bytes per second a host writes to a storage repository.",
    ),
    metricName: "xcp_host_disk_throughput_write_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
  },
  {
    id: "xcp-host-disk-throughput-total-bytes",
    friendlyName: translationKey("Host Disk Throughput"),
    description: translationKey(
      "Bytes per second a host reads from and writes to a storage repository.",
    ),
    metricName: "xcp_host_disk_throughput_total_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
  },
  {
    id: "xcp-host-disk-read-latency-seconds",
    friendlyName: translationKey("Host Read Latency"),
    description: translationKey(
      "How long a host's reads from a storage repository take.",
    ),
    metricName: "xcp_host_disk_read_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "seconds",
  },
  {
    id: "xcp-host-disk-write-latency-seconds",
    friendlyName: translationKey("Host Write Latency"),
    description: translationKey(
      "How long a host's writes to a storage repository take.",
    ),
    metricName: "xcp_host_disk_write_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "seconds",
  },
  {
    id: "xcp-host-disk-latency-seconds",
    friendlyName: translationKey("Host Disk Latency"),
    description: translationKey(
      "How long a host's reads and writes to a storage repository take.",
    ),
    metricName: "xcp_host_disk_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "seconds",
  },
  {
    id: "xcp-host-disk-iowait",
    friendlyName: translationKey("Host I/O Wait"),
    description: translationKey(
      "The share of time a host waited on a storage repository, from 0 to 1.",
    ),
    metricName: "xcp_host_disk_iowait",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "ratio",
  },
  {
    id: "xcp-vm-disk-read-bytes-total",
    friendlyName: translationKey("VM Disk Read"),
    description: translationKey(
      "Bytes per second a VM reads from one of its disks; the device label says which. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_vm_disk_read_bytes_total",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-vm-disk-write-bytes-total",
    friendlyName: translationKey("VM Disk Write"),
    description: translationKey(
      "Bytes per second a VM writes to one of its disks. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_vm_disk_write_bytes_total",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-vm-disk-iops-read",
    friendlyName: translationKey("VM Read IOPS"),
    description: translationKey("Read operations per second on a VM's disk."),
    metricName: "xcp_vm_disk_iops_read",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ops/s",
  },
  {
    id: "xcp-vm-disk-iops-write",
    friendlyName: translationKey("VM Write IOPS"),
    description: translationKey("Write operations per second on a VM's disk."),
    metricName: "xcp_vm_disk_iops_write",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ops/s",
  },
  {
    id: "xcp-vm-disk-iops-total",
    friendlyName: translationKey("VM IOPS"),
    description: translationKey(
      "Read and write operations per second on a VM's disk.",
    ),
    metricName: "xcp_vm_disk_iops_total",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ops/s",
  },
  {
    id: "xcp-vm-disk-throughput-read-bytes",
    friendlyName: translationKey("VM Read Throughput"),
    description: translationKey("Bytes per second read from a VM's disk."),
    metricName: "xcp_vm_disk_throughput_read_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
  },
  {
    id: "xcp-vm-disk-throughput-write-bytes",
    friendlyName: translationKey("VM Write Throughput"),
    description: translationKey("Bytes per second written to a VM's disk."),
    metricName: "xcp_vm_disk_throughput_write_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
  },
  {
    id: "xcp-vm-disk-throughput-total-bytes",
    friendlyName: translationKey("VM Disk Throughput"),
    description: translationKey(
      "Bytes per second read from and written to a VM's disk.",
    ),
    metricName: "xcp_vm_disk_throughput_total_bytes",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
  },
  {
    id: "xcp-vm-disk-read-latency-seconds",
    friendlyName: translationKey("VM Read Latency"),
    description: translationKey("How long reads from a VM's disk take."),
    metricName: "xcp_vm_disk_read_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "seconds",
  },
  {
    id: "xcp-vm-disk-write-latency-seconds",
    friendlyName: translationKey("VM Write Latency"),
    description: translationKey("How long writes to a VM's disk take."),
    metricName: "xcp_vm_disk_write_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "seconds",
  },
  {
    id: "xcp-vm-disk-latency-seconds",
    friendlyName: translationKey("VM Disk Latency"),
    description: translationKey(
      "How long reads and writes on a VM's disk take, on average.",
    ),
    metricName: "xcp_vm_disk_latency_seconds",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "seconds",
  },
  {
    id: "xcp-vm-disk-iowait",
    friendlyName: translationKey("VM I/O Wait"),
    description: translationKey(
      "The share of time a VM waited on one of its disks, from 0 to 1.",
    ),
    metricName: "xcp_vm_disk_iowait",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "ratio",
  },
  {
    id: "xcp-vm-disk-inflight",
    friendlyName: translationKey("VM Disk Requests In Flight"),
    description: translationKey(
      "The requests on a VM's disk not answered yet.",
    ),
    metricName: "xcp_vm_disk_inflight",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "count",
  },
  {
    id: "xcp-vm-disk-queue-size",
    friendlyName: translationKey("VM Disk Queue"),
    description: translationKey(
      "The average queue of requests on a VM's disk.",
    ),
    metricName: "xcp_vm_disk_queue_size",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "count",
  },

  // Network
  {
    id: "xcp-host-network-receive-bytes-total",
    friendlyName: translationKey("Host Network Received"),
    description: translationKey(
      "Bytes per second a host receives on one physical interface; the interface label says which. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_host_network_receive_bytes_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-host-network-transmit-bytes-total",
    friendlyName: translationKey("Host Network Sent"),
    description: translationKey(
      "Bytes per second a host sends on one physical interface. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_host_network_transmit_bytes_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-host-network-aggregated-receive-bytes",
    friendlyName: translationKey("Host Network Received (All Interfaces)"),
    description: translationKey(
      "Bytes per second a host receives on all its physical interfaces.",
    ),
    metricName: "xcp_host_network_aggregated_receive_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
  },
  {
    id: "xcp-host-network-aggregated-transmit-bytes",
    friendlyName: translationKey("Host Network Sent (All Interfaces)"),
    description: translationKey(
      "Bytes per second a host sends on all its physical interfaces.",
    ),
    metricName: "xcp_host_network_aggregated_transmit_bytes",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.Host,
    unit: "bytes/s",
  },
  {
    id: "xcp-vm-network-receive-bytes-total",
    friendlyName: translationKey("VM Network Received"),
    description: translationKey(
      "Bytes per second a VM receives on one of its network interfaces; the vif label says which. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_vm_network_receive_bytes_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-vm-network-transmit-bytes-total",
    friendlyName: translationKey("VM Network Sent"),
    description: translationKey(
      "Bytes per second a VM sends on one of its network interfaces. Xen Orchestra names it _total and types it a counter, but it is a rate: OneUptime keeps it as one.",
    ),
    metricName: "xcp_vm_network_transmit_bytes_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: XcpNgScope.VM,
    unit: "bytes/s",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-vm-network-receive-errors-total",
    friendlyName: translationKey("VM Network Receive Errors"),
    description: translationKey(
      "Receive errors per second on one of a VM's network interfaces. A rate, though Xen Orchestra types it a counter.",
    ),
    metricName: "xcp_vm_network_receive_errors_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VM,
    unit: "{errors/s}",
    isRateTypedAsCounter: true,
  },
  {
    id: "xcp-vm-network-transmit-errors-total",
    friendlyName: translationKey("VM Network Send Errors"),
    description: translationKey(
      "Send errors per second on one of a VM's network interfaces. A rate, though Xen Orchestra types it a counter.",
    ),
    metricName: "xcp_vm_network_transmit_errors_total",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.VM,
    unit: "{errors/s}",
    isRateTypedAsCounter: true,
  },

  // XOSTOR (pools with a storage repository of type linstor only)
  {
    id: "xcp-xostor-up",
    friendlyName: translationKey("XOSTOR Reachable"),
    description: translationKey(
      "1 when Xen Orchestra read an XOSTOR cluster's health, 0 when it could not.",
    ),
    metricName: "xcp_xostor_up",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "",
  },
  {
    id: "xcp-xostor-node-status",
    friendlyName: translationKey("XOSTOR Node Status"),
    description: translationKey(
      "Always 1 for every node of an XOSTOR cluster; its role and state are in the role and state labels.",
    ),
    metricName: "xcp_xostor_node_status",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
  {
    id: "xcp-xostor-resource-total",
    friendlyName: translationKey("XOSTOR Resources"),
    description: translationKey(
      "The LINSTOR resources an XOSTOR cluster defines.",
    ),
    metricName: "xcp_xostor_resource_total",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
  {
    id: "xcp-xostor-resource-state-count",
    friendlyName: translationKey("XOSTOR Replicas by State"),
    description: translationKey(
      "An XOSTOR cluster's resource replicas in each disk state; the state label says which.",
    ),
    metricName: "xcp_xostor_resource_state_count",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
  {
    id: "xcp-xostor-alarms-up",
    friendlyName: translationKey("XOSTOR Alarms Read"),
    description: translationKey(
      "1 when Xen Orchestra read an XOSTOR cluster's alarms, 0 when it could not.",
    ),
    metricName: "xcp_xostor_alarms_up",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "",
  },
  {
    id: "xcp-xostor-alarms-count",
    friendlyName: translationKey("XOSTOR Alarms"),
    description: translationKey(
      "Active XAPI alarms on an XOSTOR storage repository or its hosts, by alarm_name and target_type. Absent when none is raised.",
    ),
    metricName: "xcp_xostor_alarms_count",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
  {
    id: "xcp-xostor-smart-up",
    friendlyName: translationKey("XOSTOR SMART Read"),
    description: translationKey(
      "1 when Xen Orchestra read a host's SMART data for XOSTOR, 0 when it could not.",
    ),
    metricName: "xcp_xostor_smart_up",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "",
  },
  {
    id: "xcp-xostor-disk-smart-status",
    friendlyName: translationKey("XOSTOR Disk Health"),
    description: translationKey(
      "Always 1 for every disk of an XOSTOR host; its SMART health is in the status label.",
    ),
    metricName: "xcp_xostor_disk_smart_status",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
  {
    id: "xcp-xostor-updates-up",
    friendlyName: translationKey("XOSTOR Update Check"),
    description: translationKey(
      "1 when a host's XOSTOR update check answered, 0 when it failed.",
    ),
    metricName: "xcp_xostor_updates_up",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "",
  },
  {
    id: "xcp-xostor-package-update-available",
    friendlyName: translationKey("XOSTOR Update Available"),
    description: translationKey(
      "1 for every XOSTOR package with an update waiting on a host; the package label says which.",
    ),
    metricName: "xcp_xostor_package_update_available",
    category: "XOSTOR",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: XcpNgScope.Xostor,
    unit: "count",
  },
];

export function getAllXcpNgMetrics(): Array<XcpNgMetricDefinition> {
  return xcpNgMetricCatalog;
}

export function getXcpNgMetricsByCategory(
  category: XcpNgMetricCategory,
): Array<XcpNgMetricDefinition> {
  return xcpNgMetricCatalog.filter((m: XcpNgMetricDefinition) => {
    return m.category === category;
  });
}

export function getXcpNgMetricById(
  id: string,
): XcpNgMetricDefinition | undefined {
  return xcpNgMetricCatalog.find((m: XcpNgMetricDefinition) => {
    return m.id === id;
  });
}

export function getXcpNgMetricByMetricName(
  metricName: string,
): XcpNgMetricDefinition | undefined {
  return xcpNgMetricCatalog.find((m: XcpNgMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllXcpNgMetricCategories(): Array<XcpNgMetricCategory> {
  return ["Availability", "Host", "VM", "Storage", "Network", "XOSTOR"];
}

/*
 * Each group's heading in the metric picker, a key: a category is the value
 * the catalog's metrics name, so the picker looks its heading up here, once.
 */
const categoryLabels: Record<XcpNgMetricCategory, string> = {
  Availability: translationKey("Availability"),
  Host: translationKey("Host"),
  VM: translationKey("VM"),
  Storage: translationKey("Storage"),
  Network: translationKey("Network"),
  XOSTOR: translationKey("XOSTOR"),
};

export function getXcpNgMetricCategoryLabel(
  category: XcpNgMetricCategory,
): string {
  return categoryLabels[category] || category;
}
