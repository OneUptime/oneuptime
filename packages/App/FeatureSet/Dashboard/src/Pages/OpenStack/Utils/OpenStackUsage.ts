import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT,
  OpenStackInstanceMetricsOptions,
  getOpenStackHypervisorCapacity,
  isOpenStackInstanceMetricsOnForCloud,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  OPENSTACK_INSTANCE_CPU_CONTENTION_WARNING_PERCENT,
  OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
  percentOf,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a page says about real usage, and when it can't. Allocation is never put in its place:
 * a page without a source says what is missing and how to add it, and its allocation tiles
 * go on saying what they say, which is what is promised.
 */

export type OpenStackUsageGap =
  // Neither exporter is being read for this cloud, as far as anything shows.
  | "no-source"
  // A source is there, and this cloud chose not to keep this instance's own series.
  | "not-kept-past-size"
  | "not-kept-off"
  | "not-kept-selected"
  // An instance that isn't running has nothing to read, which is the answer.
  | "not-running"
  | null;

export const OPENSTACK_USAGE_GAP_TEXT: Record<
  Exclude<OpenStackUsageGap, null>,
  string
> = {
  "no-source": translationKey(
    "No real usage is reaching OneUptime for this cloud, so nothing here says how busy this is: only what is promised. Point the OpenStack agent at prometheus-libvirt-exporter or Ceilometer's exporter on your compute nodes to add it.",
  ),
  "not-kept-past-size": translationKey(
    "This cloud is past the size where each instance's own series are kept unless someone asks for them. Its hypervisors' totals still report. Choose what to keep under this cloud's Settings.",
  ),
  "not-kept-off": translationKey(
    "This cloud's Settings keep no per-instance series. Its hypervisors' totals still report.",
  ),
  "not-kept-selected": translationKey(
    "This cloud keeps per-instance series only for the projects and aggregates chosen in its Settings, and this instance is in none of them.",
  ),
  "not-running": translationKey(
    "This instance isn't running, so nothing is using anything.",
  ),
};

export function getOpenStackInstanceUsageGap(data: {
  hasUsage: boolean;
  row: OpenStackResource;
  options: OpenStackInstanceMetricsOptions;
  instanceCount: number;
  // Whether its hypervisor's totals say a source is being read at all.
  hypervisorHasSource: boolean;
}): OpenStackUsageGap {
  if (data.hasUsage) {
    return null;
  }
  if (data.row.status && data.row.status !== "ACTIVE") {
    return "not-running";
  }
  if (!data.hypervisorHasSource) {
    return "no-source";
  }
  if (
    !isOpenStackInstanceMetricsOnForCloud({
      options: data.options,
      instanceCount: data.instanceCount,
    })
  ) {
    return data.options.mode === "off" ? "not-kept-off" : "not-kept-past-size";
  }
  return data.options.mode === "selected" ? "not-kept-selected" : "no-source";
}

export const OPENSTACK_AUTOMATIC_LIMIT: number =
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT;

/*
 * A hypervisor over a line: the same lines as its alert templates, measured against what
 * Placement says it has, before any allocation ratio.
 */
export interface OpenStackHypervisorLoad {
  cpuPercent: number | null;
  memoryPercent: number | null;
  isCpuSaturated: boolean;
  isMemoryPressured: boolean;
}

export function getOpenStackHypervisorLoad(data: {
  cpuCores: number | null;
  memoryResidentBytes: number | null;
  // The hypervisor's own threads and bytes, before a ratio: what it can really do.
  physicalCores: number | null | undefined;
  physicalMemoryBytes: number | null | undefined;
}): OpenStackHypervisorLoad {
  const cpuPercent: number | null = percentOf(data.cpuCores, data.physicalCores);
  const memoryPercent: number | null = percentOf(
    data.memoryResidentBytes,
    data.physicalMemoryBytes,
  );
  return {
    cpuPercent,
    memoryPercent,
    isCpuSaturated:
      cpuPercent !== null &&
      cpuPercent > OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
    isMemoryPressured:
      memoryPercent !== null &&
      memoryPercent > OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  };
}

export function getOpenStackHypervisorPhysicalCapacity(
  row: OpenStackResource,
): { cores: number | null; memoryBytes: number | null } {
  return getOpenStackHypervisorCapacity({
    facts: row.facts as JSONObject | undefined,
    vcpuCapacity: row.vcpuCapacity,
    memoryCapacityBytes: row.memoryCapacityBytes,
  });
}

export function isOpenStackInstanceCpuSaturated(
  cpuPercent: number | null,
): boolean {
  return (
    cpuPercent !== null && cpuPercent > OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT
  );
}

export function isOpenStackInstanceContended(
  contentionPercent: number | null,
): boolean {
  return (
    contentionPercent !== null &&
    contentionPercent > OPENSTACK_INSTANCE_CPU_CONTENTION_WARNING_PERCENT
  );
}

/*
 * ---------------------------------------------------------------------------
 * What a machine's own agent says it is moving
 * ---------------------------------------------------------------------------
 */

export interface OpenStackCounterPoint {
  device: string;
  direction: string;
  timeMs: number;
  value: number;
}

export interface OpenStackHostThroughput {
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
  networkReceiveBytesPerSecond: number | null;
  networkTransmitBytesPerSecond: number | null;
}

/*
 * What the same bytes pass through on their way somewhere else. A packet to an instance crosses
 * the physical interface, a bridge and a tap, and a read crosses a partition and its disk, so
 * adding every device up says a hypervisor is moving several times what it is. Which interfaces
 * are virtual isn't a fact the agent reports, so this goes by the names each of them is given.
 */
const VIRTUAL_NETWORK_DEVICE: RegExp =
  /^(lo$|tap|tun|qbr|qvb|qvo|qr-|qg-|sg-|ha-|fg-|br-|brq|ovs-|virbr|vnet|vxlan|geneve?|gre|veth|docker|cni|flannel|cali|ifb)/;
const NOT_A_WHOLE_DISK: RegExp =
  /^(loop|ram|sr\d|fd\d|dm-|md\d|zram)|^(sd|vd|xvd|hd)[a-z]+\d+$|^(nvme\d+n\d+|mmcblk\d+)p\d+$/;

export function isOpenStackPhysicalNetworkDevice(device: string): boolean {
  return Boolean(device) && !VIRTUAL_NETWORK_DEVICE.test(device);
}

export function isOpenStackWholeDisk(device: string): boolean {
  return Boolean(device) && !NOT_A_WHOLE_DISK.test(device);
}

/*
 * Bytes per second in one direction, added up across the devices that count. Each device's
 * rate is what it added over the time it has readings for, so a counter that restarted counts
 * what it reads now rather than a huge negative. A device with one reading has no rate yet, and
 * with no device that has one the answer is that nothing can be said, which isn't the same as 0.
 */
export function getOpenStackCounterRate(data: {
  points: ReadonlyArray<OpenStackCounterPoint>;
  direction: string;
  isCounted: (device: string) => boolean;
}): number | null {
  const byDevice: Map<string, Array<OpenStackCounterPoint>> = new Map();
  for (const point of data.points) {
    if (point.direction !== data.direction || !data.isCounted(point.device)) {
      continue;
    }
    const points: Array<OpenStackCounterPoint> =
      byDevice.get(point.device) || [];
    points.push(point);
    byDevice.set(point.device, points);
  }

  let total: number | null = null;
  for (const points of byDevice.values()) {
    const sorted: Array<OpenStackCounterPoint> = [...points].sort(
      (first: OpenStackCounterPoint, second: OpenStackCounterPoint): number => {
        return first.timeMs - second.timeMs;
      },
    );
    const seconds: number =
      (sorted[sorted.length - 1]!.timeMs - sorted[0]!.timeMs) / 1000;
    if (seconds <= 0) {
      continue;
    }
    let added: number = 0;
    for (let index: number = 1; index < sorted.length; index++) {
      const previous: number = sorted[index - 1]!.value;
      const current: number = sorted[index]!.value;
      added += current < previous ? current : current - previous;
    }
    total = (total || 0) + added / seconds;
  }
  return total;
}

export function getOpenStackHostThroughput(data: {
  disk: ReadonlyArray<OpenStackCounterPoint>;
  network: ReadonlyArray<OpenStackCounterPoint>;
}): OpenStackHostThroughput {
  const disk: (direction: string) => number | null = (
    direction: string,
  ): number | null => {
    return getOpenStackCounterRate({
      points: data.disk,
      direction,
      isCounted: isOpenStackWholeDisk,
    });
  };
  const network: (direction: string) => number | null = (
    direction: string,
  ): number | null => {
    return getOpenStackCounterRate({
      points: data.network,
      direction,
      isCounted: isOpenStackPhysicalNetworkDevice,
    });
  };
  return {
    diskReadBytesPerSecond: disk("read"),
    diskWriteBytesPerSecond: disk("write"),
    networkReceiveBytesPerSecond: network("receive"),
    networkTransmitBytesPerSecond: network("transmit"),
  };
}
