import {
  VCENTER_METRICS,
  VCenterMetricDefinition,
} from "./VCenterMetricDefinitions";

/*
 * ONEUPTIME'S ADDITIONS BEYOND THE RECEIVER (#11468): how fast vSphere swaps
 * each ESXi host's and powered-on VM's memory out and back in, read from
 * vSphere's own mem.swapoutRate and mem.swapinRate counters. The vcenter
 * receiver has no swap rate metric, so the VMware agent cannot send these:
 * for its vCenters, ingest works the rates out from vcenter.vm.memory.swapped
 * instead (Common/Types/VMware/VMwareSwapRates). Each point is the average of
 * the counter's 20-second samples since the previous collection, in bytes
 * per second. Written by hand, not generated: metadata.yaml has none of them.
 */
export const ONEUPTIME_VCENTER_METRICS: Record<
  string,
  VCenterMetricDefinition
> = {
  "vcenter.host.memory.swap_in.rate": {
    description:
      "How fast the ESXi host reads swapped memory back from its swap files, from vSphere's mem.swapinRate counter, averaged since the previous collection.",
    unit: "By/s",
    kind: "gauge",
    valueType: "double",
  },
  "vcenter.host.memory.swap_out.rate": {
    description:
      "How fast the ESXi host swaps memory out to its swap files, from vSphere's mem.swapoutRate counter, averaged since the previous collection.",
    unit: "By/s",
    kind: "gauge",
    valueType: "double",
  },
  "vcenter.vm.memory.swap_in.rate": {
    description:
      "How fast the VM reads its swapped memory back from the host's swap file, from vSphere's mem.swapinRate counter, averaged since the previous collection.",
    unit: "By/s",
    kind: "gauge",
    valueType: "double",
  },
  "vcenter.vm.memory.swap_out.rate": {
    description:
      "How fast the ESXi host swaps the VM's memory out to its swap file, from vSphere's mem.swapoutRate counter, averaged since the previous collection.",
    unit: "By/s",
    kind: "gauge",
    valueType: "double",
  },
};

// A metric the probe sends: the receiver's, or one of OneUptime's additions.
export function getVCenterMetricDefinition(
  name: string,
): VCenterMetricDefinition | undefined {
  return VCENTER_METRICS[name] || ONEUPTIME_VCENTER_METRICS[name];
}
