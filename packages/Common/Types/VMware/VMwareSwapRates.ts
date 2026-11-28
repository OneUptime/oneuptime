/*
 * HOW FAST VSPHERE SWAPS A VM'S MEMORY, AND WHERE ONEUPTIME READS IT FROM
 * (#11157, #11468).
 *
 * vcenter.vm.memory.swapped is how much of a VM's memory sits in the host's
 * swap file. ESXi leaves a page there until the guest touches it, so a VM
 * can show a few MiB "swapped" for weeks after the pressure that put them
 * there has gone. Whether the host is swapping now is a rate, and there are
 * two places to read one from:
 *
 *   - vSphere's own counters, mem.swapoutRate and mem.swapinRate
 *     (kiloBytesPerSecond, statistics level 1, for VMs and ESXi hosts). A
 *     probe that collects a vCenter reads them (VMwareInventoryCollector)
 *     and sends them as the metrics below, OneUptime's addition beyond the
 *     vcenter receiver: the receiver has no swap rate metric (checked up to
 *     the latest opentelemetry-collector-contrib), so the VMware agent
 *     cannot send them.
 *   - Without them, ingest works the rates out from how the swapped amount
 *     moved between a part's last two reports
 *     (VMwareResourceService.bulkUpdateLatestMetrics). That misses memory
 *     swapped out and read back between two reports, and shows the net
 *     only, so it can undercount. A resource pool always has only this:
 *     vSphere has no swap rate counter for one.
 *
 * Each VMwareResource row says which one it holds (memorySwapRateSource),
 * and ingest writes the rate it holds as OneUptime's own metric
 * (VMwareSwapRateMetric), so the VM Memory Swapping alert template reads
 * the same rate whichever collector a vCenter has.
 *
 * Isomorphic: the probe, ingest, the alert templates and the Dashboard all
 * read these names.
 */

// Where a part's swap rates came from.
export enum VMwareSwapRateSource {
  // vSphere's own mem.swapoutRate and mem.swapinRate counters.
  VSphere = "vSphere",
  // Worked out from the change in swapped memory between two reports.
  Derived = "Derived",
}

/*
 * The metrics a probe sends from vSphere's counters, in bytes per second:
 * the average of the counter's 20-second real-time samples since the
 * previous collection. Not the vcenter receiver's.
 */
export enum VMwareSwapRateCounterMetric {
  VirtualMachineSwapOut = "vcenter.vm.memory.swap_out.rate",
  VirtualMachineSwapIn = "vcenter.vm.memory.swap_in.rate",
  HostSwapOut = "vcenter.host.memory.swap_out.rate",
  HostSwapIn = "vcenter.host.memory.swap_in.rate",
}

export const VMWARE_SWAP_RATE_COUNTER_METRICS: ReadonlyArray<VMwareSwapRateCounterMetric> =
  [
    VMwareSwapRateCounterMetric.VirtualMachineSwapOut,
    VMwareSwapRateCounterMetric.VirtualMachineSwapIn,
    VMwareSwapRateCounterMetric.HostSwapOut,
    VMwareSwapRateCounterMetric.HostSwapIn,
  ];

// The vSphere performance counters behind them.
export const VSPHERE_SWAP_OUT_RATE_COUNTER: string = "mem.swapoutRate.average";
export const VSPHERE_SWAP_IN_RATE_COUNTER: string = "mem.swapinRate.average";

/*
 * THE SWAP RATES ONEUPTIME WRITES, AS IT JUDGES THEM.
 *
 * One point per report of a VM and of a resource pool, in bytes per second:
 * vSphere's counter where the report carries it, else the rate worked out
 * from the swapped amount - the very number a VM's page, Needs attention and
 * the health rules read. Their `source` datapoint attribute says which
 * (VMWARE_SWAP_RATE_SOURCE_VALUES). They carry the part's resource
 * attributes, `resource.`-prefixed as every metric of the part, so a VMware
 * monitor's vCenter scope and its group by VM or resource pool find them.
 *
 * The names are OneUptime's: OTLP ingest drops a sent metric under the
 * prefix, a recording rule cannot write one, and billing leaves them out,
 * because they are worked out from what the vCenter already sent.
 */
export const VMWARE_SWAP_RATE_METRIC_NAME_PREFIX: string = "oneuptime.vmware.";

export enum VMwareSwapRateMetric {
  VirtualMachineSwapOut = "oneuptime.vmware.vm.memory.swap_out.rate",
  VirtualMachineSwapIn = "oneuptime.vmware.vm.memory.swap_in.rate",
  ResourcePoolSwapOut = "oneuptime.vmware.resource_pool.memory.swap_out.rate",
  ResourcePoolSwapIn = "oneuptime.vmware.resource_pool.memory.swap_in.rate",
}

// Every one, in the order the catalog and the docs list them.
export const VMWARE_SWAP_RATE_METRICS: ReadonlyArray<VMwareSwapRateMetric> = [
  VMwareSwapRateMetric.VirtualMachineSwapOut,
  VMwareSwapRateMetric.VirtualMachineSwapIn,
  VMwareSwapRateMetric.ResourcePoolSwapOut,
  VMwareSwapRateMetric.ResourcePoolSwapIn,
];

export const VMWARE_SWAP_RATE_METRIC_UNIT: string = "By/s";

// The datapoint attribute that says where a point's rate came from.
export const VMWARE_SWAP_RATE_SOURCE_ATTRIBUTE: string = "source";

export const VMWARE_SWAP_RATE_SOURCE_VALUES: Readonly<
  Record<VMwareSwapRateSource, string>
> = {
  [VMwareSwapRateSource.VSphere]: "vsphere",
  [VMwareSwapRateSource.Derived]: "derived",
};

export function isVMwareSwapRateMetricName(name: string | null | undefined): boolean {
  return (
    typeof name === "string" &&
    name.trim().toLowerCase().startsWith(VMWARE_SWAP_RATE_METRIC_NAME_PREFIX)
  );
}

// What each one is, as the metric catalog and the explorer show it.
export function getVMwareSwapRateMetricDescription(
  metric: VMwareSwapRateMetric,
): string {
  switch (metric) {
    case VMwareSwapRateMetric.VirtualMachineSwapOut:
      return "How fast the ESXi host swaps the VM's memory out to disk, in bytes per second: vSphere's mem.swapoutRate where a probe collects the vCenter, else worked out from the growth of its swapped memory between two reports.";
    case VMwareSwapRateMetric.VirtualMachineSwapIn:
      return "How fast the VM reads its swapped memory back from the host's swap file, in bytes per second: vSphere's mem.swapinRate where a probe collects the vCenter, else worked out from the shrinking of its swapped memory between two reports.";
    case VMwareSwapRateMetric.ResourcePoolSwapOut:
      return "How fast the ESXi hosts swap the memory of the resource pool's VMs out to disk, in bytes per second, worked out from the growth of the pool's swapped memory between two reports.";
    case VMwareSwapRateMetric.ResourcePoolSwapIn:
      return "How fast the resource pool's VMs read swapped memory back, in bytes per second, worked out from the shrinking of the pool's swapped memory between two reports.";
  }
}

/*
 * A vSphere rate counter's value in bytes per second, by the unit vCenter
 * declares for it (PerfCounterInfo.unitInfo.key). vSphere documents the swap
 * rates in kiloBytesPerSecond; a unit this does not know is no reading.
 */
export function toVSphereBytesPerSecond(
  value: number,
  unit: string | null | undefined,
): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  switch ((unit || "").trim()) {
    case "kiloBytesPerSecond":
      return value * 1024;
    case "megaBytesPerSecond":
      return value * 1024 * 1024;
    default:
      return null;
  }
}
