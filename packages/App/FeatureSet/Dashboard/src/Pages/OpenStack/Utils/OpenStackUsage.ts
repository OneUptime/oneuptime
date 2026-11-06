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
  OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
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
  // Its hypervisor reports and this cloud keeps it: it just hasn't said anything of it yet.
  | "no-reading-yet"
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
  "no-reading-yet": translationKey(
    "Its hypervisor reports real usage, but nothing has been said about this instance yet. A first reading takes two collections from libvirt's exporter, and two polling cycles from Ceilometer's, which is ten minutes by default.",
  ),
};

/*
 * Whether charts have anything to draw. An instance that stopped has what it did before it
 * stopped, and one with no reading yet is about to have some. With no source and with a cloud
 * that chose not to keep them, they would only be empty frames under a sentence saying why.
 */
export function isOpenStackUsageChartable(gap: OpenStackUsageGap): boolean {
  return gap === null || gap === "not-running" || gap === "no-reading-yet";
}

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
  if (
    data.options.mode === "selected" &&
    !data.options.projectIds.includes(data.row.openStackProjectId || "")
  ) {
    return "not-kept-selected";
  }
  return "no-reading-yet";
}

export const OPENSTACK_AUTOMATIC_LIMIT: number =
  OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT;

/*
 * A hypervisor over a line: the same lines as its alert templates, measured against what
 * Placement says it has, before any allocation ratio. Where OneUptime's agent runs on it, its
 * own reading counts too: it has the host's own processes in it, and can be over the line while
 * its instances aren't. What its instances are then is still what names them.
 */
export interface OpenStackHypervisorLoad {
  cpuPercent: number | null;
  memoryPercent: number | null;
  isCpuSaturated: boolean;
  isMemoryPressured: boolean;
  // Over the line by the machine's own reading, with its instances under it.
  isCpuSaturatedByHost: boolean;
  isMemoryPressuredByHost: boolean;
}

export function getOpenStackHypervisorLoad(data: {
  cpuCores: number | null;
  memoryResidentBytes: number | null;
  // The hypervisor's own threads and bytes, before a ratio: what it can really do.
  physicalCores: number | null | undefined;
  physicalMemoryBytes: number | null | undefined;
  hostCpuPercent?: number | null | undefined;
  hostMemoryPercent?: number | null | undefined;
}): OpenStackHypervisorLoad {
  const cpuPercent: number | null = percentOf(
    data.cpuCores,
    data.physicalCores,
  );
  const memoryPercent: number | null = percentOf(
    data.memoryResidentBytes,
    data.physicalMemoryBytes,
  );
  const isOver: (
    percent: number | null | undefined,
    line: number,
  ) => boolean = (
    percent: number | null | undefined,
    line: number,
  ): boolean => {
    return percent !== null && percent !== undefined && percent > line;
  };
  const instancesCpu: boolean = isOver(
    cpuPercent,
    OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  );
  const instancesMemory: boolean = isOver(
    memoryPercent,
    OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  );
  const hostCpu: boolean = isOver(
    data.hostCpuPercent,
    OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  );
  const hostMemory: boolean = isOver(
    data.hostMemoryPercent,
    OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  );
  return {
    cpuPercent,
    memoryPercent,
    isCpuSaturated: instancesCpu || hostCpu,
    isMemoryPressured: instancesMemory || hostMemory,
    isCpuSaturatedByHost: hostCpu && !instancesCpu,
    isMemoryPressuredByHost: hostMemory && !instancesMemory,
  };
}

/*
 * How many vCPUs a busy instance was given: what it uses over what share of them that is. What is
 * allocated, beside what is used, without asking for every flavor on the hypervisor.
 */
export function getOpenStackVcpusOfReading(reading: {
  cpuCores: number | null;
  cpuPercent: number | null;
}): number | null {
  if (!reading.cpuCores || !reading.cpuPercent) {
    return null;
  }
  return Math.round((reading.cpuCores / reading.cpuPercent) * 100);
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

export function isOpenStackInstanceDiskSlow(latencyMs: number | null): boolean {
  return (
    latencyMs !== null && latencyMs > OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS
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
