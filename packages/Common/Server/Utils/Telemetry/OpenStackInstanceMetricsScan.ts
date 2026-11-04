import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_METRIC_UNITS,
  OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OpenStackHypervisorCapacity,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
  findOpenStackDeviceAfterInstanceId,
  findOpenStackInstanceId,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OPENSTACK_REGION_ATTRIBUTE } from "./OpenStackSnapshotScan";

/*
 * ------------------------------------------------------------------
 * Real instance usage, from either source, in one shape
 * ------------------------------------------------------------------
 *
 * The OpenTelemetry Collector has no libvirt receiver, so what an instance is really doing
 * comes from whichever exporter a cloud already runs, scraped through the agent's
 * prometheus receiver. This turns both into the openstack.instance.* and
 * openstack.hypervisor.* series and appends them beside the originals, in the same batch,
 * as ProxmoxNativePush does for its own dialect. Pages and templates read those.
 *
 * The two sources differ in more than their names, and each difference is a wrong number
 * if it is missed:
 *
 *   - libvirt's counters are real counters: read at the moment of the scrape, each new
 *     reading is the truth now. A rate between two scrapes is a rate.
 *
 *   - Ceilometer's are gauges of a cumulative number, and they are only as new as its last
 *     polling cycle, five minutes by default. Scraped more often than that, a reading
 *     repeats, then jumps. Dividing by the time between scrapes reads 0, 0, then five times
 *     the truth. So a rate here runs between the moments a value CHANGED, and a repeated
 *     value says nothing new, so adds no row: it costs nothing and lies about nothing.
 *
 *   - Ceilometer has no label for a disk or an interface: it names the "resource",
 *     `<uuid>-vda` and `<libvirt name>-<uuid>-<tap>`.
 *
 *   - libvirt names a domain and says which instance it is on one series only, and the
 *     collector can split a scrape across batches, so what each domain is has to outlive
 *     the batch that said it.
 *
 *   - libvirt_domain_info_memory_usage_bytes is NOT what the guest uses. It is the balloon's
 *     size, so it reads the flavor's memory on any idle instance: allocation dressed as
 *     usage. Usage is what the guest's balloon driver reports, as Ceilometer computes it,
 *     and with no driver in the guest there is no such reading, which is said rather than
 *     guessed. What the instance holds on its host (rss) is always there.
 *
 * Rates need the last reading, so they keep state between batches: one value per exporter
 * (the caller keeps it in Redis, and this file is pure). A cumulative counter's rate over a
 * reset counts what it reads now, as Prometheus does: an instance that rebooted has used
 * that much since. What is too old to be a rate of now starts again, rather than averaging
 * a day into one sample.
 *
 * Every reading here was first written from the two exporters' source code and is held to
 * real recordings: Tests/Ops/openstack-e2e/instance-metrics.sh.
 */

export const OPENSTACK_INSTANCE_METRICS_SCOPE_NAME: string =
  "oneuptime.openstack.instance-metrics";

// Put on every series by the agent's scrape jobs: a target's host, without its port.
export const OPENSTACK_EXPORTER_HOST_LABEL: string = "openstack_exporter_host";

// libvirt's counters are read at the scrape. Past this they say nothing about now.
export const OPENSTACK_LIBVIRT_LONGEST_GAP_MS: number = 15 * 60 * 1000;
/*
 * Longer than two of Ceilometer's default polling cycles, so one missed poll doesn't read
 * as an idle instance. A value that hasn't moved for this long really is idle: it reads 0.
 */
export const OPENSTACK_CEILOMETER_QUIET_MS: number = 11 * 60 * 1000;
export const OPENSTACK_CEILOMETER_LONGEST_GAP_MS: number = 31 * 60 * 1000;

// What a hypervisor's total adds up: an instance that has reported this recently.
const LIBVIRT_FRESH_MS: number = 3 * 60 * 1000;
const CEILOMETER_FRESH_MS: number = OPENSTACK_CEILOMETER_QUIET_MS;

const BYTES_PER_MIB: number = 1024 * 1024;
const NANOSECONDS_PER_SECOND: number = 1e9;

enum Reading {
  Identity = "identity",
  Vcpus = "vcpus",
  CpuTime = "cpu",
  CpuDelay = "delay",
  MemoryAvailable = "memoryAvailable",
  MemoryUsable = "memoryUsable",
  MemoryUnused = "memoryUnused",
  MemoryUsage = "memoryUsage",
  MemoryResident = "memoryResident",
  DiskReadBytes = "rb",
  DiskWriteBytes = "wb",
  DiskReadRequests = "rr",
  DiskWriteRequests = "wr",
  DiskReadTime = "rt",
  DiskWriteTime = "wt",
  NetworkReceiveBytes = "rx",
  NetworkTransmitBytes = "tx",
}

interface SeriesReading {
  reading: Reading;
  /*
   * A cumulative reading gets a rate, and multiplying brings it to seconds, bytes or
   * requests whichever spelling the source uses.
   */
  scale: number;
  // Where the name of a device comes from: its own label, or Ceilometer's resource.
  deviceLabel?: string | undefined;
  deviceFromResource?: boolean | undefined;
}

/*
 * The agent keeps exactly these series and no others, which its config's own lists hold to:
 * OpenStackInstanceMetricsScan.test.ts reads them there.
 */
export const OPENSTACK_LIBVIRT_SERIES: ReadonlyMap<string, SeriesReading> =
  new Map<string, SeriesReading>([
    ["libvirt_domain_openstack_info", { reading: Reading.Identity, scale: 1 }],
    ["libvirt_domain_info_virtual_cpus", { reading: Reading.Vcpus, scale: 1 }],
    [
      "libvirt_domain_info_cpu_time_seconds_total",
      { reading: Reading.CpuTime, scale: 1 },
    ],
    [
      "libvirt_domain_vcpu_delay_seconds_total",
      { reading: Reading.CpuDelay, scale: 1, deviceLabel: "vcpu" },
    ],
    [
      "libvirt_domain_memory_stats_available_bytes",
      { reading: Reading.MemoryAvailable, scale: 1 },
    ],
    [
      "libvirt_domain_memory_stats_usable_bytes",
      { reading: Reading.MemoryUsable, scale: 1 },
    ],
    [
      "libvirt_domain_memory_stats_unused_bytes",
      { reading: Reading.MemoryUnused, scale: 1 },
    ],
    [
      "libvirt_domain_memory_stats_rss_bytes",
      { reading: Reading.MemoryResident, scale: 1 },
    ],
    [
      "libvirt_domain_block_stats_read_bytes_total",
      {
        reading: Reading.DiskReadBytes,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_block_stats_write_bytes_total",
      {
        reading: Reading.DiskWriteBytes,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_block_stats_read_requests_total",
      {
        reading: Reading.DiskReadRequests,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_block_stats_write_requests_total",
      {
        reading: Reading.DiskWriteRequests,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_block_stats_read_time_seconds_total",
      { reading: Reading.DiskReadTime, scale: 1, deviceLabel: "target_device" },
    ],
    [
      "libvirt_domain_block_stats_write_time_seconds_total",
      {
        reading: Reading.DiskWriteTime,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_interface_stats_receive_bytes_total",
      {
        reading: Reading.NetworkReceiveBytes,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
    [
      "libvirt_domain_interface_stats_transmit_bytes_total",
      {
        reading: Reading.NetworkTransmitBytes,
        scale: 1,
        deviceLabel: "target_device",
      },
    ],
  ]);

export const OPENSTACK_CEILOMETER_SERIES: ReadonlyMap<string, SeriesReading> =
  new Map<string, SeriesReading>([
    ["ceilometer_vcpus", { reading: Reading.Vcpus, scale: 1 }],
    // Nanoseconds, as each of these says in its `unit` label.
    [
      "ceilometer_cpu",
      { reading: Reading.CpuTime, scale: 1 / NANOSECONDS_PER_SECOND },
    ],
    [
      "ceilometer_cpu_delay",
      { reading: Reading.CpuDelay, scale: 1 / NANOSECONDS_PER_SECOND },
    ],
    // MB before 2025.2 and MiB after: the same number, in a label that was corrected.
    [
      "ceilometer_memory_usage",
      { reading: Reading.MemoryUsage, scale: BYTES_PER_MIB },
    ],
    [
      "ceilometer_memory_resident",
      { reading: Reading.MemoryResident, scale: BYTES_PER_MIB },
    ],
    [
      "ceilometer_disk_device_read_bytes",
      { reading: Reading.DiskReadBytes, scale: 1, deviceFromResource: true },
    ],
    [
      "ceilometer_disk_device_write_bytes",
      { reading: Reading.DiskWriteBytes, scale: 1, deviceFromResource: true },
    ],
    [
      "ceilometer_disk_device_read_requests",
      { reading: Reading.DiskReadRequests, scale: 1, deviceFromResource: true },
    ],
    [
      "ceilometer_disk_device_write_requests",
      {
        reading: Reading.DiskWriteRequests,
        scale: 1,
        deviceFromResource: true,
      },
    ],
    [
      "ceilometer_disk_device_read_latency",
      {
        reading: Reading.DiskReadTime,
        scale: 1 / NANOSECONDS_PER_SECOND,
        deviceFromResource: true,
      },
    ],
    [
      "ceilometer_disk_device_write_latency",
      {
        reading: Reading.DiskWriteTime,
        scale: 1 / NANOSECONDS_PER_SECOND,
        deviceFromResource: true,
      },
    ],
    [
      "ceilometer_network_incoming_bytes",
      {
        reading: Reading.NetworkReceiveBytes,
        scale: 1,
        deviceFromResource: true,
      },
    ],
    [
      "ceilometer_network_outgoing_bytes",
      {
        reading: Reading.NetworkTransmitBytes,
        scale: 1,
        deviceFromResource: true,
      },
    ],
  ]);

function sourceOfMetric(
  metricName: string,
): OpenStackInstanceMetricSource | null {
  if (metricName.startsWith("libvirt_")) {
    return OpenStackInstanceMetricSource.Libvirt;
  }
  if (metricName.startsWith("ceilometer_")) {
    return OpenStackInstanceMetricSource.Ceilometer;
  }
  return null;
}

function seriesOf(
  source: OpenStackInstanceMetricSource,
  metricName: string,
): SeriesReading | undefined {
  const table: ReadonlyMap<string, SeriesReading> =
    source === OpenStackInstanceMetricSource.Libvirt
      ? OPENSTACK_LIBVIRT_SERIES
      : OPENSTACK_CEILOMETER_SERIES;
  // The collector can leave a counter's _total off: the name is the same series either way.
  return table.get(metricName) || table.get(`${metricName}_total`);
}

function readLabel(
  attributes: JSONArray | undefined,
  key: string,
): string | null {
  if (!Array.isArray(attributes)) {
    return null;
  }
  for (const attribute of attributes) {
    const attr: JSONObject | null =
      attribute && typeof attribute === "object"
        ? (attribute as JSONObject)
        : null;
    if (!attr || attr["key"] !== key) {
      continue;
    }
    const value: JSONObject | undefined = attr["value"] as
      | JSONObject
      | undefined;
    const raw: JSONValue | undefined = value?.["stringValue"];
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }
  return null;
}

function readNumber(datapoint: JSONObject): number | null {
  const raw: JSONValue = datapoint["asDouble"] ?? datapoint["asInt"];
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  // An exporter's NaN arrives as the word, and an int64 as a string.
  if (typeof raw === "string" && raw.trim()) {
    const parsed: number = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readTimeMs(datapoint: JSONObject): number | null {
  const raw: JSONValue = datapoint["timeUnixNano"];
  const nanos: number =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(nanos) && nanos > 0 ? Math.floor(nanos / 1e6) : null;
}

function metricDataPoints(metric: JSONObject): JSONArray {
  const gauge: JSONObject | undefined = metric["gauge"] as
    | JSONObject
    | undefined;
  const sum: JSONObject | undefined = metric["sum"] as JSONObject | undefined;
  const points: JSONValue =
    (gauge && gauge["dataPoints"]) || (sum && sum["dataPoints"]) || [];
  return Array.isArray(points) ? (points as JSONArray) : [];
}

function resourceAttributesOf(envelope: JSONObject): JSONArray | undefined {
  return (envelope["resource"] as JSONObject | undefined)?.["attributes"] as
    | JSONArray
    | undefined;
}

/*
 * ------------------------------------------------------------------
 * Reading a batch
 * ------------------------------------------------------------------
 */

export interface OpenStackInstanceMetricSample {
  source: OpenStackInstanceMetricSource;
  // The exporter that said it, which is the hypervisor it is on, or "" if nothing says.
  exporterHost: string;
  // libvirt's name for it, until something says which instance that is.
  domain: string | null;
  instanceId: string | null;
  projectId: string | null;
  reading: Reading;
  device: string | null;
  timeMs: number;
  timeUnixNano: JSONValue;
  value: number;
}

/*
 * Whether a batch has anything for this to read, cheaply, before anything is asked of Redis
 * or Postgres: most of what reaches ingest is someone's application metrics.
 */
export function hasOpenStackInstanceMetrics(envelope: JSONObject): boolean {
  const scopeMetrics: JSONValue = envelope["scopeMetrics"];
  if (
    !Array.isArray(scopeMetrics) ||
    !readLabel(resourceAttributesOf(envelope), "openstack.cloud.name")
  ) {
    return false;
  }
  for (const scopeMetric of scopeMetrics) {
    const metrics: JSONValue = (scopeMetric as JSONObject | null)?.["metrics"];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metric of metrics) {
      const name: JSONValue = (metric as JSONObject | null)?.["name"];
      if (typeof name === "string" && sourceOfMetric(name)) {
        return true;
      }
    }
  }
  return false;
}

export function readOpenStackInstanceMetricSamples(
  envelope: JSONObject,
): Array<OpenStackInstanceMetricSample> {
  const samples: Array<OpenStackInstanceMetricSample> = [];
  const scopeMetrics: JSONValue = envelope["scopeMetrics"];
  if (!Array.isArray(scopeMetrics)) {
    return samples;
  }

  for (const scopeMetric of scopeMetrics) {
    const metrics: JSONValue = (scopeMetric as JSONObject | null)?.["metrics"];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metricValue of metrics) {
      const metric: JSONObject | null =
        metricValue && typeof metricValue === "object"
          ? (metricValue as JSONObject)
          : null;
      const name: JSONValue = metric?.["name"];
      if (!metric || typeof name !== "string") {
        continue;
      }
      const source: OpenStackInstanceMetricSource | null = sourceOfMetric(name);
      const series: SeriesReading | undefined = source
        ? seriesOf(source, name)
        : undefined;
      if (!source || !series) {
        continue;
      }

      for (const point of metricDataPoints(metric)) {
        const datapoint: JSONObject | null =
          point && typeof point === "object" ? (point as JSONObject) : null;
        if (!datapoint) {
          continue;
        }
        const value: number | null = readNumber(datapoint);
        const timeMs: number | null = readTimeMs(datapoint);
        if (value === null || timeMs === null) {
          continue;
        }
        const attributes: JSONArray | undefined = datapoint["attributes"] as
          | JSONArray
          | undefined;
        const resource: string | null = readLabel(attributes, "resource");
        const isLibvirt: boolean =
          source === OpenStackInstanceMetricSource.Libvirt;
        const instanceId: string | null = isLibvirt
          ? findOpenStackInstanceId(readLabel(attributes, "instance_id"))
          : findOpenStackInstanceId(resource);
        const domain: string | null = isLibvirt
          ? readLabel(attributes, "domain")
          : null;

        // Ceilometer's device is the resource's tail: a resource with no UUID is no instance.
        if (!instanceId && !domain) {
          continue;
        }

        samples.push({
          source,
          exporterHost:
            readLabel(attributes, OPENSTACK_EXPORTER_HOST_LABEL) || "",
          domain,
          instanceId,
          projectId: isLibvirt
            ? readLabel(attributes, "project_id")
            : readLabel(attributes, "project"),
          reading: series.reading,
          device: series.deviceFromResource
            ? findOpenStackDeviceAfterInstanceId(resource)
            : series.deviceLabel
              ? readLabel(attributes, series.deviceLabel)
              : null,
          timeMs,
          timeUnixNano: datapoint["timeUnixNano"] as JSONValue,
          value: value * series.scale,
        });
      }
    }
  }

  return samples;
}

/*
 * ------------------------------------------------------------------
 * Rates
 * ------------------------------------------------------------------
 */

/*
 * The last of one series. [time of this value, value, time last seen, rate at that time].
 * Short because a compute node's whole state is one value in Redis.
 */
export type CounterState = [number, number, number, number | null];

export interface CounterStep {
  next: CounterState;
  // Per second, or null when this reading says nothing new about now.
  rate: number | null;
}

export type OpenStackRateBehaviour = "counter" | "polled";

/*
 * One reading of a cumulative number, against the last. See the top of the file for what
 * makes the two behaviours different. Pure, and what the tests hold hardest.
 */
export function advanceOpenStackCounter(data: {
  previous: CounterState | null | undefined;
  atMs: number;
  value: number;
  behaviour: OpenStackRateBehaviour;
}): CounterStep {
  const { previous, atMs, value, behaviour } = data;

  if (!previous) {
    return { next: [atMs, value, atMs, null], rate: null };
  }

  const [changedAtMs, lastValue, seenAtMs, lastRate] = previous;

  // A retried export, or a batch that lost a race: what is known already stands.
  if (atMs <= seenAtMs) {
    return { next: previous, rate: null };
  }

  const longestGap: number =
    behaviour === "counter"
      ? OPENSTACK_LIBVIRT_LONGEST_GAP_MS
      : OPENSTACK_CEILOMETER_LONGEST_GAP_MS;

  // The collector was off, or the instance moved here and back: start again.
  if (atMs - seenAtMs > longestGap) {
    return { next: [atMs, value, atMs, null], rate: null };
  }

  if (behaviour === "polled" && value === lastValue) {
    // Still the same polling cycle. Only a long silence says it really did nothing.
    if (atMs - changedAtMs >= OPENSTACK_CEILOMETER_QUIET_MS) {
      return { next: [atMs, value, atMs, 0], rate: 0 };
    }
    return { next: [changedAtMs, value, atMs, lastRate], rate: null };
  }

  /*
   * Below the last reading, it restarted from nothing, and what it reads now is what it
   * has added since: an instance reboots, or a live migration lands.
   */
  const added: number = value < lastValue ? value : value - lastValue;
  const rate: number = added / ((atMs - changedAtMs) / 1000);

  return { next: [atMs, value, atMs, rate], rate };
}

/*
 * A reading that is a level rather than a total, such as memory. libvirt's is new on every
 * scrape. Ceilometer's repeats between polls, so it adds a row only when it moves, or
 * after enough silence to show it is still there.
 */
export function advanceOpenStackLevel(data: {
  previous: CounterState | null | undefined;
  atMs: number;
  value: number;
  behaviour: OpenStackRateBehaviour;
}): { next: CounterState; isNew: boolean } {
  const { previous, atMs, value, behaviour } = data;
  if (!previous) {
    return { next: [atMs, value, atMs, null], isNew: true };
  }
  const [changedAtMs, lastValue, seenAtMs] = previous;
  if (atMs <= seenAtMs) {
    return { next: previous, isNew: false };
  }
  if (
    behaviour === "polled" &&
    value === lastValue &&
    atMs - changedAtMs < OPENSTACK_CEILOMETER_QUIET_MS
  ) {
    return { next: [changedAtMs, value, atMs, null], isNew: false };
  }
  return { next: [atMs, value, atMs, null], isNew: true };
}

/*
 * ------------------------------------------------------------------
 * What is kept between batches
 * ------------------------------------------------------------------
 */

export interface OpenStackInstanceMetricsInstanceState {
  // The project it is in, the last time a series said.
  p?: string | undefined;
  // How many vCPUs it has, the last time a series said.
  v?: number | undefined;
  // The last of each cumulative series or level, by reading and device.
  s: Record<string, CounterState>;
  // Its latest share of the hypervisor: when, CPU threads and bytes held.
  u?: [number, number | null, number | null] | undefined;
  // The collection its memory was last worked out for: three series make up one reading.
  m?: number | undefined;
}

export interface OpenStackInstanceMetricsHostState {
  // Which instance each of libvirt's domains is: said on one series, read on all of them.
  d: Record<string, string>;
  i: Record<string, OpenStackInstanceMetricsInstanceState>;
}

export function getEmptyOpenStackInstanceMetricsHostState(): OpenStackInstanceMetricsHostState {
  return { d: {}, i: {} };
}

export function getOpenStackInstanceMetricsStateKey(data: {
  source: OpenStackInstanceMetricSource;
  exporterHost: string;
}): string {
  return `${data.source}|${data.exporterHost}`;
}

// What the inventory says about an instance, for what its series carry.
export interface OpenStackInstancePlacement {
  hypervisorName: string | null;
  regionName: string | null;
  projectId: string | null;
  // The Nova host aggregates its hypervisor is in, for a selection made by aggregate.
  aggregates: Array<string>;
  // What its hypervisor has, before any ratio, for what its totals come to as a share.
  hypervisorCapacity?: OpenStackHypervisorCapacity | undefined;
}

interface HypervisorSeen {
  count: number;
  region: string | null;
  capacity: OpenStackHypervisorCapacity | null;
}

/*
 * ------------------------------------------------------------------
 * Writing the series
 * ------------------------------------------------------------------
 */

type SeriesName = OpenStackInstanceMetric | OpenStackHypervisorMetric;

function stringAttribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

class OutputSeries {
  private points: Map<SeriesName, Array<JSONObject>> = new Map();

  public add(data: {
    name: SeriesName;
    value: number;
    timeUnixNano: JSONValue;
    attributes: Array<JSONObject>;
  }): void {
    if (!Number.isFinite(data.value)) {
      return;
    }
    let list: Array<JSONObject> | undefined = this.points.get(data.name);
    if (!list) {
      list = [];
      this.points.set(data.name, list);
    }
    list.push({
      asDouble: data.value,
      timeUnixNano: data.timeUnixNano,
      attributes: data.attributes,
    });
  }

  public toMetrics(): Array<JSONObject> {
    const metrics: Array<JSONObject> = [];
    for (const [name, dataPoints] of this.points) {
      metrics.push({
        name,
        unit: OPENSTACK_INSTANCE_METRIC_UNITS[name],
        gauge: { dataPoints },
      });
    }
    return metrics;
  }
}

function keyOfSample(reading: Reading, device: string | null): string {
  return device ? `${reading}:${device}` : reading;
}

export interface OpenStackInstanceMetricsDecision {
  metrics: Array<JSONObject>;
  /*
   * Instances whose own series are not being kept, by the exporter's name for them, so the
   * caller can take their originals out of the batch too. A choice not to pay for them
   * would otherwise only stop half of the cost, the smaller half.
   */
  droppedDomains: Set<string>;
  droppedInstanceIds: Set<string>;
}

// One instance this batch said something about.
interface TouchedInstance {
  sample: OpenStackInstanceMetricSample;
  instance: OpenStackInstanceMetricsInstanceState;
  stateKey: string;
  latestMs: number;
  latestTimeUnixNano: JSONValue;
  // Empty when the instance's own series are not kept.
  attributes: Array<JSONObject>;
  isKept: boolean;
  // A cumulative delay moved, so its share of the instance's vCPUs can be worked out.
  delayMoved: boolean;
}

type EmitSeries = (
  name: SeriesName,
  value: number,
  device?: string | null,
) => void;

/*
 * Turns one batch's readings into the series. `states` holds the state of each exporter this
 * batch names, and comes back advanced. A hypervisor's totals come from the same state, so
 * they hold every instance on it, however the collector split the scrape into batches, and
 * however many of those instances keep series of their own.
 */
export function applyOpenStackInstanceMetricSamples(data: {
  samples: ReadonlyArray<OpenStackInstanceMetricSample>;
  states: Map<string, OpenStackInstanceMetricsHostState>;
  placements: ReadonlyMap<string, OpenStackInstancePlacement>;
  isInstanceKept: (instance: {
    projectId: string | null;
    aggregates: ReadonlyArray<string>;
  }) => boolean;
}): OpenStackInstanceMetricsDecision {
  const output: OutputSeries = new OutputSeries();
  const droppedDomains: Set<string> = new Set();
  const droppedInstanceIds: Set<string> = new Set();

  const samples: Array<OpenStackInstanceMetricSample> = [...data.samples].sort(
    (
      first: OpenStackInstanceMetricSample,
      second: OpenStackInstanceMetricSample,
    ): number => {
      return first.timeMs - second.timeMs;
    },
  );

  /*
   * First, who every domain is: the series that says so can come after the ones it
   * explains, in this batch or a later one.
   */
  for (const sample of samples) {
    if (sample.reading === Reading.Identity && sample.instanceId) {
      const state: OpenStackInstanceMetricsHostState = stateOf(
        data.states,
        sample,
      );
      if (sample.domain) {
        state.d[sample.domain] = sample.instanceId;
      }
      const instance: OpenStackInstanceMetricsInstanceState = instanceOf(
        state,
        sample.instanceId,
      );
      if (sample.projectId) {
        instance.p = sample.projectId;
      }
      instance.s[Reading.Identity] = [sample.timeMs, 1, sample.timeMs, null];
    }
  }

  const touched: Map<string, TouchedInstance> = new Map();
  const hypervisorByExporter: Map<
    string,
    Map<string, HypervisorSeen>
  > = new Map();

  for (const sample of samples) {
    const state: OpenStackInstanceMetricsHostState = stateOf(
      data.states,
      sample,
    );
    const instanceId: string | null =
      sample.instanceId ||
      (sample.domain ? state.d[sample.domain] || null : null);

    const placement: OpenStackInstancePlacement | undefined = instanceId
      ? data.placements.get(instanceId)
      : undefined;
    const instance: OpenStackInstanceMetricsInstanceState | null = instanceId
      ? instanceOf(state, instanceId)
      : null;
    if (instance && sample.projectId) {
      instance.p = sample.projectId;
    }
    const projectId: string | null =
      instance?.p || placement?.projectId || null;
    const isKept: boolean = data.isInstanceKept({
      projectId,
      aggregates: placement?.aggregates || [],
    });

    if (!isKept) {
      if (sample.domain) {
        droppedDomains.add(sample.domain);
      }
      if (instanceId) {
        droppedInstanceIds.add(instanceId);
      }
    }

    // The series that says who this domain is hasn't come yet: next scrape.
    if (!instanceId || !instance || sample.reading === Reading.Identity) {
      continue;
    }

    const stateKey: string = getOpenStackInstanceMetricsStateKey(sample);
    const touchKey: string = `${stateKey}|${instanceId}`;
    let entry: TouchedInstance | undefined = touched.get(touchKey);
    if (!entry) {
      entry = {
        sample,
        instance,
        stateKey,
        latestMs: sample.timeMs,
        latestTimeUnixNano: sample.timeUnixNano,
        attributes: isKept
          ? seriesAttributes({ sample, instanceId, projectId, placement })
          : [],
        isKept,
        delayMoved: false,
      };
      touched.set(touchKey, entry);
    } else if (sample.timeMs >= entry.latestMs) {
      entry.latestMs = sample.timeMs;
      entry.latestTimeUnixNano = sample.timeUnixNano;
    }

    if (placement?.hypervisorName) {
      const named: Map<string, HypervisorSeen> =
        hypervisorByExporter.get(stateKey) || new Map();
      const known: HypervisorSeen = named.get(placement.hypervisorName) || {
        count: 0,
        region: placement.regionName,
        capacity: placement.hypervisorCapacity || null,
      };
      known.count += 1;
      named.set(placement.hypervisorName, known);
      hypervisorByExporter.set(stateKey, named);
    }

    const current: TouchedInstance = entry;
    const emit: EmitSeries = (
      name: SeriesName,
      value: number,
      device?: string | null,
    ): void => {
      if (!current.isKept) {
        return;
      }
      output.add({
        name,
        value,
        timeUnixNano: sample.timeUnixNano,
        attributes: device
          ? [
              ...current.attributes,
              stringAttribute(OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE, device),
            ]
          : current.attributes,
      });
    };

    if (applySample({ sample, instance, emit })) {
      current.delayMoved = true;
    }
  }

  // What takes several series to work out, once each has had its say.
  for (const entry of touched.values()) {
    const emit: EmitSeries = (name: SeriesName, value: number): void => {
      if (entry.isKept) {
        output.add({
          name,
          value,
          timeUnixNano: entry.latestTimeUnixNano,
          attributes: entry.attributes,
        });
      }
    };
    if (entry.delayMoved) {
      const contention: number | null = getContention(
        entry.instance,
        entry.latestMs,
      );
      if (contention !== null) {
        emit(OpenStackInstanceMetric.CpuContention, contention);
      }
    }
    const memory: number | null = takeGuestMemory(entry.instance);
    if (memory !== null) {
      emit(OpenStackInstanceMetric.MemoryUsage, memory);
    }
  }

  writeHypervisorTotals({
    output,
    states: data.states,
    hypervisorByExporter,
    touched,
  });

  pruneStates(data.states, samples);

  return {
    metrics: output.toMetrics(),
    droppedDomains,
    droppedInstanceIds,
  };
}

/*
 * Each exporter's totals, from everything it has said lately rather than this batch alone.
 * An exporter that nothing names is several hypervisors mixed, and has no total.
 */
function writeHypervisorTotals(data: {
  output: OutputSeries;
  states: Map<string, OpenStackInstanceMetricsHostState>;
  hypervisorByExporter: Map<string, Map<string, HypervisorSeen>>;
  touched: Map<string, TouchedInstance>;
}): void {
  for (const [stateKey, named] of data.hypervisorByExporter) {
    const state: OpenStackInstanceMetricsHostState | undefined =
      data.states.get(stateKey);
    const [sourceText, exporterHost] = stateKey.split("|") as [string, string];
    if (!state || !exporterHost) {
      continue;
    }
    const source: OpenStackInstanceMetricSource =
      sourceText as OpenStackInstanceMetricSource;
    const fresh: number =
      source === OpenStackInstanceMetricSource.Libvirt
        ? LIBVIRT_FRESH_MS
        : CEILOMETER_FRESH_MS;

    let latestMs: number = 0;
    let latestTime: JSONValue = null;
    for (const entry of data.touched.values()) {
      if (entry.stateKey === stateKey && entry.latestMs >= latestMs) {
        latestMs = entry.latestMs;
        latestTime = entry.latestTimeUnixNano;
      }
    }

    // On a compute node they all say one name. Mid-migration, the most of them win.
    let hypervisorName: string | null = null;
    let regionName: string | null = null;
    let capacity: OpenStackHypervisorCapacity | null = null;
    let most: number = 0;
    for (const [name, known] of named) {
      if (known.count > most) {
        most = known.count;
        hypervisorName = name;
        regionName = known.region;
        capacity = known.capacity;
      }
    }
    if (!hypervisorName) {
      continue;
    }

    let cores: number = 0;
    let resident: number = 0;
    let reporting: number = 0;
    let sawCores: boolean = false;
    let sawResident: boolean = false;
    for (const instance of Object.values(state.i)) {
      const usage: [number, number | null, number | null] | undefined =
        instance.u;
      if (!usage || latestMs - usage[0] > fresh) {
        continue;
      }
      reporting += 1;
      if (usage[1] !== null) {
        cores += usage[1];
        sawCores = true;
      }
      if (usage[2] !== null) {
        resident += usage[2];
        sawResident = true;
      }
    }
    if (reporting === 0) {
      continue;
    }

    const attributes: Array<JSONObject> = [
      stringAttribute(OPENSTACK_HYPERVISOR_ATTRIBUTE, hypervisorName),
      stringAttribute(OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE, source),
      ...(regionName
        ? [stringAttribute(OPENSTACK_REGION_ATTRIBUTE, regionName)]
        : []),
    ];
    const emitTotal: (name: SeriesName, value: number) => void = (
      name: SeriesName,
      value: number,
    ): void => {
      data.output.add({ name, value, timeUnixNano: latestTime, attributes });
    };
    if (sawCores) {
      emitTotal(OpenStackHypervisorMetric.InstancesCpuUsage, cores);
      if (capacity?.cores) {
        emitTotal(
          OpenStackHypervisorMetric.InstancesCpuUtilization,
          (cores / capacity.cores) * 100,
        );
      }
    }
    if (sawResident) {
      emitTotal(OpenStackHypervisorMetric.InstancesMemoryResident, resident);
      if (capacity?.memoryBytes) {
        emitTotal(
          OpenStackHypervisorMetric.InstancesMemoryUtilization,
          (resident / capacity.memoryBytes) * 100,
        );
      }
    }
    emitTotal(OpenStackHypervisorMetric.InstancesReporting, reporting);
  }
}

/*
 * How much of its vCPUs' time an instance spent waiting for the hypervisor. libvirt says
 * this per vCPU and Ceilometer adds them up. Each vCPU's latest counts, rather than this
 * batch's: a batch can hold only some of them.
 */
function getContention(
  instance: OpenStackInstanceMetricsInstanceState,
  atMs: number,
): number | null {
  if (!instance.v) {
    return null;
  }
  let total: number = 0;
  let found: boolean = false;
  for (const key of Object.keys(instance.s)) {
    if (key === Reading.CpuDelay || key.startsWith(`${Reading.CpuDelay}:`)) {
      const state: CounterState = instance.s[key]!;
      if (
        state[3] !== null &&
        atMs - state[2] <= OPENSTACK_LIBVIRT_LONGEST_GAP_MS
      ) {
        total += state[3];
        found = true;
      }
    }
  }
  return found ? (total / instance.v) * 100 : null;
}

/*
 * What the guest says it uses, for a source that reports its two halves: what it has, less
 * what is left. Usable when it says so, because that leaves out page cache the guest can
 * give back, and unused only when it never says usable. Ceilometer's memory.usage is this
 * same sum, so the two sources mean the same thing by it. Worked out once per collection.
 */
function takeGuestMemory(
  instance: OpenStackInstanceMetricsInstanceState,
): number | null {
  const available: CounterState | undefined =
    instance.s[Reading.MemoryAvailable];
  if (!available || available[1] <= 0 || instance.m === available[0]) {
    return null;
  }
  const usable: CounterState | undefined = instance.s[Reading.MemoryUsable];
  const unused: CounterState | undefined = instance.s[Reading.MemoryUnused];
  const left: CounterState | undefined = usable
    ? usable[0] === available[0]
      ? usable
      : undefined
    : unused && unused[0] === available[0]
      ? unused
      : undefined;
  if (!left) {
    return null;
  }
  instance.m = available[0];
  return Math.max(0, available[1] - left[1]);
}

function stateOf(
  states: Map<string, OpenStackInstanceMetricsHostState>,
  sample: OpenStackInstanceMetricSample,
): OpenStackInstanceMetricsHostState {
  const key: string = getOpenStackInstanceMetricsStateKey(sample);
  let state: OpenStackInstanceMetricsHostState | undefined = states.get(key);
  if (!state) {
    state = getEmptyOpenStackInstanceMetricsHostState();
    states.set(key, state);
  }
  return state;
}

function instanceOf(
  state: OpenStackInstanceMetricsHostState,
  instanceId: string,
): OpenStackInstanceMetricsInstanceState {
  let instance: OpenStackInstanceMetricsInstanceState | undefined =
    state.i[instanceId];
  if (!instance) {
    instance = { s: {} };
    state.i[instanceId] = instance;
  }
  return instance;
}

function seriesAttributes(data: {
  sample: OpenStackInstanceMetricSample;
  instanceId: string;
  projectId: string | null;
  placement: OpenStackInstancePlacement | undefined;
}): Array<JSONObject> {
  return [
    stringAttribute(OPENSTACK_INSTANCE_ID_ATTRIBUTE, data.instanceId),
    stringAttribute(OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE, data.sample.source),
    ...(data.projectId
      ? [stringAttribute(OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE, data.projectId)]
      : []),
    ...(data.placement?.hypervisorName
      ? [
          stringAttribute(
            OPENSTACK_HYPERVISOR_ATTRIBUTE,
            data.placement.hypervisorName,
          ),
        ]
      : []),
    ...(data.placement?.regionName
      ? [stringAttribute(OPENSTACK_REGION_ATTRIBUTE, data.placement.regionName)]
      : []),
  ];
}

const DISK_RATE_SERIES: Readonly<
  Partial<Record<Reading, OpenStackInstanceMetric>>
> = {
  [Reading.DiskReadBytes]: OpenStackInstanceMetric.DiskReadRate,
  [Reading.DiskWriteBytes]: OpenStackInstanceMetric.DiskWriteRate,
  [Reading.DiskReadRequests]: OpenStackInstanceMetric.DiskReadOperations,
  [Reading.DiskWriteRequests]: OpenStackInstanceMetric.DiskWriteOperations,
  [Reading.NetworkReceiveBytes]: OpenStackInstanceMetric.NetworkReceiveRate,
  [Reading.NetworkTransmitBytes]: OpenStackInstanceMetric.NetworkTransmitRate,
};

// Time spent in a device's requests, and the count of them it is divided by.
const LATENCY_PAIRS: Readonly<
  Partial<
    Record<
      Reading,
      { time: Reading; requests: Reading; name: OpenStackInstanceMetric }
    >
  >
> = {
  [Reading.DiskReadTime]: {
    time: Reading.DiskReadTime,
    requests: Reading.DiskReadRequests,
    name: OpenStackInstanceMetric.DiskReadLatency,
  },
  [Reading.DiskReadRequests]: {
    time: Reading.DiskReadTime,
    requests: Reading.DiskReadRequests,
    name: OpenStackInstanceMetric.DiskReadLatency,
  },
  [Reading.DiskWriteTime]: {
    time: Reading.DiskWriteTime,
    requests: Reading.DiskWriteRequests,
    name: OpenStackInstanceMetric.DiskWriteLatency,
  },
  [Reading.DiskWriteRequests]: {
    time: Reading.DiskWriteTime,
    requests: Reading.DiskWriteRequests,
    name: OpenStackInstanceMetric.DiskWriteLatency,
  },
};

function behaviourOf(
  source: OpenStackInstanceMetricSource,
): OpenStackRateBehaviour {
  return source === OpenStackInstanceMetricSource.Libvirt
    ? "counter"
    : "polled";
}

function advanceCounterOf(
  sample: OpenStackInstanceMetricSample,
  instance: OpenStackInstanceMetricsInstanceState,
): number | null {
  const key: string = keyOfSample(sample.reading, sample.device);
  const step: CounterStep = advanceOpenStackCounter({
    previous: instance.s[key],
    atMs: sample.timeMs,
    value: sample.value,
    behaviour: behaviourOf(sample.source),
  });
  instance.s[key] = step.next;
  return step.rate;
}

function advanceLevelOf(
  sample: OpenStackInstanceMetricSample,
  instance: OpenStackInstanceMetricsInstanceState,
): boolean {
  const key: string = keyOfSample(sample.reading, sample.device);
  const step: { next: CounterState; isNew: boolean } = advanceOpenStackLevel({
    previous: instance.s[key],
    atMs: sample.timeMs,
    value: sample.value,
    behaviour: behaviourOf(sample.source),
  });
  instance.s[key] = step.next;
  return step.isNew;
}

function noteUsage(
  instance: OpenStackInstanceMetricsInstanceState,
  sample: OpenStackInstanceMetricSample,
  usage: { cores?: number | undefined; resident?: number | undefined },
): void {
  const existing: [number, number | null, number | null] = instance.u || [
    sample.timeMs,
    null,
    null,
  ];
  instance.u = [
    Math.max(existing[0], sample.timeMs),
    usage.cores !== undefined ? usage.cores : existing[1],
    usage.resident !== undefined ? usage.resident : existing[2],
  ];
}

// Says whether a CPU delay moved, which is worked out once every vCPU has been read.
function applySample(data: {
  sample: OpenStackInstanceMetricSample;
  instance: OpenStackInstanceMetricsInstanceState;
  emit: EmitSeries;
}): boolean {
  const { sample, instance, emit } = data;

  switch (sample.reading) {
    case Reading.Vcpus: {
      if (sample.value > 0) {
        instance.v = sample.value;
      }
      return false;
    }
    case Reading.CpuTime: {
      const cores: number | null = advanceCounterOf(sample, instance);
      if (cores === null) {
        return false;
      }
      noteUsage(instance, sample, { cores });
      emit(OpenStackInstanceMetric.CpuUsage, cores);
      if (instance.v) {
        emit(
          OpenStackInstanceMetric.CpuUtilization,
          (cores / instance.v) * 100,
        );
      }
      return false;
    }
    case Reading.CpuDelay: {
      return advanceCounterOf(sample, instance) !== null;
    }
    case Reading.MemoryAvailable:
    case Reading.MemoryUsable:
    case Reading.MemoryUnused: {
      instance.s[sample.reading] = [
        sample.timeMs,
        sample.value,
        sample.timeMs,
        null,
      ];
      return false;
    }
    case Reading.MemoryUsage: {
      if (advanceLevelOf(sample, instance)) {
        emit(OpenStackInstanceMetric.MemoryUsage, sample.value);
      }
      return false;
    }
    case Reading.MemoryResident: {
      if (advanceLevelOf(sample, instance)) {
        noteUsage(instance, sample, { resident: sample.value });
        emit(OpenStackInstanceMetric.MemoryResident, sample.value);
      } else {
        noteUsage(instance, sample, {});
      }
      return false;
    }
    default: {
      const rate: number | null = advanceCounterOf(sample, instance);
      if (rate === null) {
        return false;
      }
      const name: OpenStackInstanceMetric | undefined =
        DISK_RATE_SERIES[sample.reading];
      if (name) {
        emit(name, rate, sample.device);
      }
      const pair:
        | { time: Reading; requests: Reading; name: OpenStackInstanceMetric }
        | undefined = LATENCY_PAIRS[sample.reading];
      if (pair) {
        emitLatency({ sample, instance, pair, emit });
      }
      return false;
    }
  }
}

/*
 * The time a device's requests took, over how many there were, in the same collection.
 * With no requests there is no latency to report, which isn't the same as it being 0: the
 * series goes away, and an alert on it recovers.
 */
function emitLatency(data: {
  sample: OpenStackInstanceMetricSample;
  instance: OpenStackInstanceMetricsInstanceState;
  pair: { time: Reading; requests: Reading; name: OpenStackInstanceMetric };
  emit: EmitSeries;
}): void {
  const { sample, instance, pair, emit } = data;
  const time: CounterState | undefined =
    instance.s[keyOfSample(pair.time, sample.device)];
  const requests: CounterState | undefined =
    instance.s[keyOfSample(pair.requests, sample.device)];
  if (
    !time ||
    !requests ||
    time[0] !== requests[0] ||
    time[3] === null ||
    requests[3] === null ||
    requests[3] <= 0
  ) {
    return;
  }
  emit(pair.name, (time[3] / requests[3]) * 1000, sample.device);
}

/*
 * An instance that has gone (deleted, migrated away) leaves this host's state after it has
 * been silent longer than anything here can use, or a compute node's value only ever grows.
 */
function pruneStates(
  states: Map<string, OpenStackInstanceMetricsHostState>,
  samples: ReadonlyArray<OpenStackInstanceMetricSample>,
): void {
  const newest: Map<string, number> = new Map();
  for (const sample of samples) {
    const key: string = getOpenStackInstanceMetricsStateKey(sample);
    newest.set(key, Math.max(newest.get(key) || 0, sample.timeMs));
  }
  for (const [key, newestMs] of newest) {
    const state: OpenStackInstanceMetricsHostState | undefined =
      states.get(key);
    if (!state) {
      continue;
    }
    for (const [instanceId, instance] of Object.entries(state.i)) {
      const lastSeen: number = Object.values(instance.s).reduce(
        (latest: number, series: CounterState): number => {
          return Math.max(latest, series[2]);
        },
        instance.u?.[0] || newestMs,
      );
      if (newestMs - lastSeen > OPENSTACK_CEILOMETER_LONGEST_GAP_MS) {
        delete state.i[instanceId];
        for (const [domain, id] of Object.entries(state.d)) {
          if (id === instanceId) {
            delete state.d[domain];
          }
        }
      }
    }
  }
}

/*
 * ------------------------------------------------------------------
 * Changing the batch
 * ------------------------------------------------------------------
 */

/*
 * Takes out the original series of instances nobody chose to keep, so choosing not to pay
 * for them stops the whole cost. The exporter's own health series stay: they aren't anybody's.
 */
export function removeOpenStackInstanceOriginals(data: {
  envelope: JSONObject;
  droppedDomains: ReadonlySet<string>;
  droppedInstanceIds: ReadonlySet<string>;
}): void {
  if (data.droppedDomains.size === 0 && data.droppedInstanceIds.size === 0) {
    return;
  }
  const scopeMetrics: JSONValue = data.envelope["scopeMetrics"];
  if (!Array.isArray(scopeMetrics)) {
    return;
  }
  for (const scopeMetric of scopeMetrics) {
    const metrics: JSONValue = (scopeMetric as JSONObject | null)?.["metrics"];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (let index: number = metrics.length - 1; index >= 0; index--) {
      const metric: JSONObject | null = metrics[index]
        ? (metrics[index] as JSONObject)
        : null;
      const name: JSONValue = metric?.["name"];
      if (!metric || typeof name !== "string") {
        continue;
      }
      const source: OpenStackInstanceMetricSource | null = sourceOfMetric(name);
      if (!source || !seriesOf(source, name)) {
        continue;
      }
      const holder: JSONObject | undefined = (metric["gauge"] ||
        metric["sum"]) as JSONObject | undefined;
      const points: JSONValue = holder?.["dataPoints"];
      if (!holder || !Array.isArray(points)) {
        continue;
      }
      holder["dataPoints"] = (points as JSONArray).filter(
        (point: JSONValue): boolean => {
          const attributes: JSONArray | undefined = (point as JSONObject)?.[
            "attributes"
          ] as JSONArray | undefined;
          const domain: string | null = readLabel(attributes, "domain");
          const instanceId: string | null =
            findOpenStackInstanceId(readLabel(attributes, "instance_id")) ||
            findOpenStackInstanceId(readLabel(attributes, "resource"));
          return !(
            (domain && data.droppedDomains.has(domain)) ||
            (instanceId && data.droppedInstanceIds.has(instanceId))
          );
        },
      );
      if ((holder["dataPoints"] as JSONArray).length === 0) {
        metrics.splice(index, 1);
      }
    }
  }
}

// The series appended beside the originals, in a scope of their own so they can be told apart.
export function appendOpenStackInstanceMetrics(data: {
  envelope: JSONObject;
  metrics: Array<JSONObject>;
}): void {
  if (data.metrics.length === 0) {
    return;
  }
  const scopeMetrics: JSONValue = data.envelope["scopeMetrics"];
  if (!Array.isArray(scopeMetrics)) {
    return;
  }
  (scopeMetrics as JSONArray).push({
    scope: { name: OPENSTACK_INSTANCE_METRICS_SCOPE_NAME, version: "1" },
    metrics: data.metrics,
  });
}
