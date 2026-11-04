import { JSONObject } from "../JSON";

/*
 * WHAT AN INSTANCE AND A HYPERVISOR ARE REALLY DOING, IN ONE SHAPE.
 *
 * Nova and Placement say what is promised. These say what is busy, whichever source a
 * cloud has: prometheus-libvirt-exporter or Ceilometer's own exporter. Ingest turns
 * both into these series (OpenStackInstanceMetricsScan), so a page or an alert never has
 * to care which one it was, and never has to work out a rate: the alerting path has no
 * rate operator, and at a minute's collection a Max minus a Min within a minute is 0.
 *
 * Pure, so the pages, the monitors and ingest all read it.
 */

export const OPENSTACK_INSTANCE_ID_ATTRIBUTE: string = "openstack.instance.id";
export const OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE: string =
  "openstack.instance.source";
export const OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE: string =
  "openstack.project.id";
// A disk's or a network interface's name on the instance: vda, tap1234.
export const OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE: string = "device";
/*
 * Nova's hypervisor name, under the label its own series use, so a hypervisor's real load
 * and what Placement says about it group and divide without a lookup.
 */
export const OPENSTACK_HYPERVISOR_ATTRIBUTE: string = "hostname";

export enum OpenStackInstanceMetricSource {
  Libvirt = "libvirt",
  Ceilometer = "ceilometer",
}

export const OPENSTACK_INSTANCE_METRIC_SOURCES: ReadonlyArray<OpenStackInstanceMetricSource> =
  [OpenStackInstanceMetricSource.Libvirt, OpenStackInstanceMetricSource.Ceilometer];

export enum OpenStackInstanceMetric {
  // How many of the hypervisor's CPU threads this instance is using.
  CpuUsage = "openstack.instance.cpu.usage",
  // That as a share of its own vCPUs: 100 is every vCPU busy.
  CpuUtilization = "openstack.instance.cpu.utilization",
  /*
   * How much of the time its vCPUs wanted to run and the hypervisor made them wait,
   * as a share of its vCPUs: the guest calls this steal. It is what says a neighbour is
   * the problem rather than the instance itself.
   */
  CpuContention = "openstack.instance.cpu.contention",
  // What the guest says it is using. Needs the balloon driver in the guest.
  MemoryUsage = "openstack.instance.memory.usage",
  // What the instance holds on its hypervisor, whatever the guest says.
  MemoryResident = "openstack.instance.memory.resident",
  DiskReadRate = "openstack.instance.disk.read.rate",
  DiskWriteRate = "openstack.instance.disk.write.rate",
  DiskReadOperations = "openstack.instance.disk.read.operations",
  DiskWriteOperations = "openstack.instance.disk.write.operations",
  DiskReadLatency = "openstack.instance.disk.read.latency",
  DiskWriteLatency = "openstack.instance.disk.write.latency",
  NetworkReceiveRate = "openstack.instance.network.receive.rate",
  NetworkTransmitRate = "openstack.instance.network.transmit.rate",
}

export enum OpenStackHypervisorMetric {
  // What its instances use between them, in CPU threads. Not the host's own processes.
  InstancesCpuUsage = "openstack.hypervisor.instances.cpu.usage",
  // What its instances hold of its memory between them.
  InstancesMemoryResident = "openstack.hypervisor.instances.memory.resident",
  // How many instances those two add up.
  InstancesReporting = "openstack.hypervisor.instances.reporting",
}

export const OPENSTACK_INSTANCE_METRIC_UNITS: Readonly<
  Record<OpenStackInstanceMetric | OpenStackHypervisorMetric, string>
> = {
  [OpenStackInstanceMetric.CpuUsage]: "{cpu}",
  [OpenStackInstanceMetric.CpuUtilization]: "%",
  [OpenStackInstanceMetric.CpuContention]: "%",
  [OpenStackInstanceMetric.MemoryUsage]: "By",
  [OpenStackInstanceMetric.MemoryResident]: "By",
  [OpenStackInstanceMetric.DiskReadRate]: "By/s",
  [OpenStackInstanceMetric.DiskWriteRate]: "By/s",
  [OpenStackInstanceMetric.DiskReadOperations]: "{operation}/s",
  [OpenStackInstanceMetric.DiskWriteOperations]: "{operation}/s",
  [OpenStackInstanceMetric.DiskReadLatency]: "ms",
  [OpenStackInstanceMetric.DiskWriteLatency]: "ms",
  [OpenStackInstanceMetric.NetworkReceiveRate]: "By/s",
  [OpenStackInstanceMetric.NetworkTransmitRate]: "By/s",
  [OpenStackHypervisorMetric.InstancesCpuUsage]: "{cpu}",
  [OpenStackHypervisorMetric.InstancesMemoryResident]: "By",
  [OpenStackHypervisorMetric.InstancesReporting]: "{instance}",
};

/*
 * The agent's scrape jobs for these two, as their series are labelled. They are not
 * OpenStack APIs, so they are no row on a cloud's Services page.
 */
export const OPENSTACK_INSTANCE_METRIC_JOBS: ReadonlySet<string> =
  new Set<string>([
    OpenStackInstanceMetricSource.Libvirt,
    OpenStackInstanceMetricSource.Ceilometer,
  ]);

/*
 * COST IS A CHOICE. Per-instance series multiply fast, so past this many instances a cloud
 * keeps its hypervisors' totals and no per-instance series, until someone asks for them for
 * the whole cloud, or for the projects and aggregates they care about.
 */
export const OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT: number = 500;

export enum OpenStackInstanceMetricsMode {
  // Every instance while the cloud is at or under the limit, and none past it.
  Automatic = "automatic",
  All = "all",
  Selected = "selected",
  Off = "off",
}

export interface OpenStackInstanceMetricsOptions {
  mode: OpenStackInstanceMetricsMode;
  // Keystone IDs: only read for Selected.
  projectIds: Array<string>;
  // Nova host aggregate names: only read for Selected.
  aggregates: Array<string>;
}

export const MAX_OPENSTACK_INSTANCE_METRICS_SELECTIONS: number = 200;

export function getDefaultOpenStackInstanceMetricsOptions(): OpenStackInstanceMetricsOptions {
  return {
    mode: OpenStackInstanceMetricsMode.Automatic,
    projectIds: [],
    aggregates: [],
  };
}

function cleanNames(value: unknown): Array<string> | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const names: Array<string> = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    const name: string = item.trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/*
 * What a saved value means, or the sentence that says what is wrong with it. Anything else
 * it holds is dropped. Reading a value that has gone wrong gives the defaults: a cloud's
 * pages and its bill should not depend on a typo surviving a save.
 */
export function normalizeOpenStackInstanceMetricsOptions(
  value: unknown,
):
  | { options: OpenStackInstanceMetricsOptions; error?: undefined }
  | { options?: undefined; error: string } {
  if (value === null || value === undefined) {
    return { options: getDefaultOpenStackInstanceMetricsOptions() };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "The instance metrics options are not in the right form." };
  }
  const raw: JSONObject = value as JSONObject;
  const mode: OpenStackInstanceMetricsMode =
    (raw["mode"] as OpenStackInstanceMetricsMode | undefined) ||
    OpenStackInstanceMetricsMode.Automatic;
  if (!Object.values(OpenStackInstanceMetricsMode).includes(mode)) {
    return { error: "Choose automatic, all, selected or off." };
  }
  const projectIds: Array<string> | null = cleanNames(raw["projectIds"]);
  const aggregates: Array<string> | null = cleanNames(raw["aggregates"]);
  if (!projectIds || !aggregates) {
    return { error: "Name projects by their IDs and aggregates by their names." };
  }
  if (
    projectIds.length + aggregates.length >
    MAX_OPENSTACK_INSTANCE_METRICS_SELECTIONS
  ) {
    return {
      error: `Choose at most ${MAX_OPENSTACK_INSTANCE_METRICS_SELECTIONS} projects and aggregates. Past that, keep every instance's series or none.`,
    };
  }
  return { options: { mode, projectIds, aggregates } };
}

// Whether a cloud of this size keeps per-instance series at all, before asking which.
export function isOpenStackInstanceMetricsOnForCloud(data: {
  options: OpenStackInstanceMetricsOptions;
  instanceCount: number | null | undefined;
}): boolean {
  if (data.options.mode === OpenStackInstanceMetricsMode.Off) {
    return false;
  }
  if (data.options.mode === OpenStackInstanceMetricsMode.Automatic) {
    return (data.instanceCount || 0) <= OPENSTACK_INSTANCE_METRICS_AUTOMATIC_LIMIT;
  }
  return true;
}

/*
 * Whether this instance's own series are kept. A hypervisor's totals are kept whatever
 * this says: they are one series per hypervisor, and they are what names a busy host.
 * An instance whose project or host OneUptime doesn't know yet counts as not chosen: it is
 * read again a few minutes later, and a selection is what someone said they would pay for.
 */
export function isOpenStackInstanceMetricsKept(data: {
  options: OpenStackInstanceMetricsOptions;
  instanceCount: number | null | undefined;
  projectId: string | null | undefined;
  aggregates: ReadonlyArray<string>;
}): boolean {
  if (!isOpenStackInstanceMetricsOnForCloud(data)) {
    return false;
  }
  if (data.options.mode !== OpenStackInstanceMetricsMode.Selected) {
    return true;
  }
  if (data.projectId && data.options.projectIds.includes(data.projectId)) {
    return true;
  }
  return data.aggregates.some((aggregate: string): boolean => {
    return data.options.aggregates.includes(aggregate);
  });
}

/*
 * WHAT IT COSTS. The series one instance adds, kept and worked out. Each is a row per
 * collection, so the docs' volume calculator and the settings card multiply from here,
 * and the numbers can only move when these do.
 */
export const OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INSTANCE: number = 7;
export const OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_VCPU: number = 1;
export const OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_DISK: number = 6;
export const OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INTERFACE: number = 2;

export const OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INSTANCE: number = 5;
export const OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_DISK: number = 6;
export const OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INTERFACE: number = 2;

export const OPENSTACK_NORMALIZED_SERIES_PER_INSTANCE: number = 5;
export const OPENSTACK_NORMALIZED_SERIES_PER_DISK: number = 6;
export const OPENSTACK_NORMALIZED_SERIES_PER_INTERFACE: number = 2;

// What the agent's collector is set to: agents/OpenStackAgent/otel-collector-config.yaml.
export const OPENSTACK_LIBVIRT_COLLECTIONS_PER_HOUR: number = 60;
// A reading only changes once a polling cycle, and only then adds a row.
export const OPENSTACK_CEILOMETER_POLLS_PER_HOUR: number = 12;
export const OPENSTACK_CEILOMETER_COLLECTIONS_PER_HOUR: number = 30;

export interface OpenStackInstanceMetricsVolume {
  seriesPerInstance: number;
  series: number;
  rowsPerHour: number;
  rowsPerMonth: number;
}

const HOURS_PER_MONTH: number = 730;

export function estimateOpenStackInstanceMetricsVolume(data: {
  source: OpenStackInstanceMetricSource;
  instances: number;
  // On average, per instance. Most clouds run one disk and one interface.
  vcpusPerInstance?: number | undefined;
  disksPerInstance?: number | undefined;
  interfacesPerInstance?: number | undefined;
}): OpenStackInstanceMetricsVolume {
  const vcpus: number = data.vcpusPerInstance ?? 2;
  const disks: number = data.disksPerInstance ?? 1;
  const interfaces: number = data.interfacesPerInstance ?? 1;
  const normalized: number =
    OPENSTACK_NORMALIZED_SERIES_PER_INSTANCE +
    OPENSTACK_NORMALIZED_SERIES_PER_DISK * disks +
    OPENSTACK_NORMALIZED_SERIES_PER_INTERFACE * interfaces;

  const isLibvirt: boolean =
    data.source === OpenStackInstanceMetricSource.Libvirt;
  const original: number = isLibvirt
    ? OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INSTANCE +
      OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_VCPU * vcpus +
      OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_DISK * disks +
      OPENSTACK_LIBVIRT_ORIGINAL_SERIES_PER_INTERFACE * interfaces
    : OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INSTANCE +
      OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_DISK * disks +
      OPENSTACK_CEILOMETER_ORIGINAL_SERIES_PER_INTERFACE * interfaces;

  const rowsPerInstancePerHour: number = isLibvirt
    ? (original + normalized) * OPENSTACK_LIBVIRT_COLLECTIONS_PER_HOUR
    : original * OPENSTACK_CEILOMETER_COLLECTIONS_PER_HOUR +
      normalized * OPENSTACK_CEILOMETER_POLLS_PER_HOUR;

  const rowsPerHour: number = rowsPerInstancePerHour * data.instances;

  return {
    seriesPerInstance: original + normalized,
    series: (original + normalized) * data.instances,
    rowsPerHour,
    rowsPerMonth: rowsPerHour * HOURS_PER_MONTH,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Which instance a kubernetes node, a guest's own agent or a service is
 * ---------------------------------------------------------------------------
 */

const INSTANCE_UUID: RegExp =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function isOpenStackInstanceId(value: string | null | undefined): boolean {
  return Boolean(
    value && value.length === 36 && INSTANCE_UUID.test(value),
  );
}

/*
 * The instance UUID a string holds, wherever it holds it. Ceilometer names a disk
 * `<uuid>-vda` and an interface `<libvirt name>-<uuid>-<tap>`.
 */
export function findOpenStackInstanceId(
  value: string | null | undefined,
): string | null {
  const match: RegExpExecArray | null = INSTANCE_UUID.exec(value || "");
  return match ? match[0].toLowerCase() : null;
}

// What follows the UUID in such a name: the disk or the interface.
export function findOpenStackDeviceAfterInstanceId(
  value: string | null | undefined,
): string | null {
  const match: RegExpExecArray | null = INSTANCE_UUID.exec(value || "");
  if (!match) {
    return null;
  }
  const rest: string = (value as string).substring(
    match.index + match[0].length,
  );
  return rest.startsWith("-") && rest.length > 1 ? rest.substring(1) : null;
}

/*
 * The instance behind a Kubernetes node's spec.providerID. openstack-cloud-controller-manager
 * writes `openstack:///<uuid>`, or `openstack://<region>/<uuid>` when it knows its region.
 * Anything else, another cloud's provider included, is no instance at all.
 */
export function getOpenStackInstanceIdOfProviderId(
  providerId: string | null | undefined,
): string | null {
  const match: RegExpExecArray | null =
    /^openstack:\/\/[^/]*\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      (providerId || "").trim(),
    );
  return match ? match[1]!.toLowerCase() : null;
}
