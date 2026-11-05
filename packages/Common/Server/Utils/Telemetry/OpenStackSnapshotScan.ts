import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  getOpenStackInventoryFactKey,
  getOpenStackInventorySeenHour,
} from "../../../Types/OpenStack/OpenStackCapacity";
import {
  getOpenStackShortHostName,
  isOpenStackBareMetalNodeId,
  isOpenStackBareMetalNodeInError,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_OPTIONAL_SERVICES,
  OpenStackOptionalService,
  isOpenStackOptionalService,
} from "../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
  OPENSTACK_BARE_METAL_IN_MAINTENANCE,
  OPENSTACK_BARE_METAL_IN_SERVICE,
  OPENSTACK_SERVICES_EVERY_CLOUD_RUNS,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_STOPPED,
  OPENSTACK_SERVICE_STATUS_UP,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_SUMMARY_MODE_SERIES,
  isOpenStackSeriesKeptInSummaryMode,
} from "../../../Types/OpenStack/OpenStackScale";
import logger from "../Logger";
import {
  foldOpenStackControlPlaneDatapoint,
  isOpenStackControlPlaneDatapoint,
} from "./OpenStackControlPlaneScan";

/*
 * ------------------------------------------------------------------
 * OpenStack snapshot scan: pure fold helpers
 * ------------------------------------------------------------------
 *
 * The OpenStack agent's series (openstack-exporter, through the collector's
 * prometheus receiver) carry identity in DATAPOINT labels, and arrive one
 * OpenStack service per scrape. The ingest service walks the OTLP payload and
 * calls bufferOpenStackSnapshotMetric per datapoint; at flush time it hands the
 * folded rows to OpenStackResourceService. Everything here is pure, which is what
 * makes it testable on recordings from a real cloud
 * (Tests/Fixtures/OpenStack, recorded by Tests/Ops/openstack-e2e).
 *
 * The contract, and why:
 *
 *  - Identity labels fold first-non-null-wins, because they are stable for a
 *    part's life. Status and numbers fold newest-observedAt-wins.
 *  - Nothing here zeroes a count. The cloud's counts are recounted from the
 *    inventory after each flush, because a batch only ever holds one service of
 *    one region: counting a batch would flip the counts on every scrape.
 *  - A row's status and adminState are OpenStack's own words, never ours.
 *  - Series this file does not know are skipped by name, through
 *    OPENSTACK_SNAPSHOT_METRIC_NAMES.
 */

export const OPENSTACK_API_UP_METRIC_NAMES: ReadonlyMap<
  string,
  OpenStackServiceType
> = new Map<string, OpenStackServiceType>([
  ["openstack_identity_up", OpenStackServiceType.Identity],
  ["openstack_nova_up", OpenStackServiceType.Compute],
  ["openstack_placement_up", OpenStackServiceType.Placement],
  ["openstack_neutron_up", OpenStackServiceType.Network],
  ["openstack_cinder_up", OpenStackServiceType.Volume],
  ["openstack_glance_up", OpenStackServiceType.Image],
  ...OPENSTACK_OPTIONAL_SERVICES.map(
    (entry: OpenStackOptionalService): [string, OpenStackServiceType] => {
      return [entry.upMetricName, entry.service];
    },
  ),
]);

/*
 * The prometheus receiver's own series for a scrape. `up` at 0 means the exporter
 * did not answer at all, which is what a failing service does to it today
 * (openstack-exporter issue 660). The agent's scrape jobs label each target with
 * the OpenStack service they ask for, so this says which service it was.
 */
export const OPENSTACK_SCRAPE_UP_METRIC_NAME: string = "up";
// Beside it, how long that collection took, which is what asking that API costs.
export const OPENSTACK_SCRAPE_DURATION_METRIC_NAME: string =
  "scrape_duration_seconds";
// And how many series it answered with, which is what an empty answer reads as.
export const OPENSTACK_SCRAPE_SAMPLES_METRIC_NAME: string =
  "scrape_samples_scraped";
export const OPENSTACK_SERVICE_LABEL: string = "openstack_service";

export { OPENSTACK_SERVICES_EVERY_CLOUD_RUNS };

/*
 * The exporter's series do not say which region they are from. The agent reads
 * one clouds.yaml entry per region, named for the region, and its transform
 * processor stamps that name here.
 */
export const OPENSTACK_REGION_ATTRIBUTE: string = "openstack.region.name";

const PLACEMENT_RESOURCE_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_placement_resource_total",
  "openstack_placement_resource_reserved",
  "openstack_placement_resource_allocation_ratio",
  "openstack_placement_resource_usage",
]);

// What Nova says a host holds, whatever the names say: these are before any allocation or ratio.
const NOVA_HOST_HOLDS_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_nova_vcpus_available",
  "openstack_nova_memory_available_bytes",
  "openstack_nova_local_storage_available_bytes",
]);

const CINDER_POOL_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_cinder_pool_capacity_total_gb",
  "openstack_cinder_pool_capacity_free_gb",
]);

const NETWORK_IP_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_neutron_network_ip_availabilities_total",
  "openstack_neutron_network_ip_availabilities_used",
]);

/*
 * What a project may use and has used. Nova's and Cinder's say which number they are in
 * their name, and Neutron's in a `type` label. None of these is in a recording yet, since
 * the agent leaves them off, so this is written from the exporter's source and reads only
 * the exact names and labels that source writes. Cinder has no count of a project's
 * volumes here, only their gigabytes, so "volumes" is not a quota this can show.
 */
const NAMED_QUOTA_METRICS: ReadonlyMap<
  string,
  { resource: OpenStackQuotaResource; reading: "used" | "limit" }
> = new Map([
  [
    "openstack_nova_limits_instances_used",
    { resource: OpenStackQuotaResource.Instances, reading: "used" },
  ],
  [
    "openstack_nova_limits_instances_max",
    { resource: OpenStackQuotaResource.Instances, reading: "limit" },
  ],
  [
    "openstack_nova_limits_vcpus_used",
    { resource: OpenStackQuotaResource.Cores, reading: "used" },
  ],
  [
    "openstack_nova_limits_vcpus_max",
    { resource: OpenStackQuotaResource.Cores, reading: "limit" },
  ],
  [
    "openstack_nova_limits_memory_used",
    { resource: OpenStackQuotaResource.RamMib, reading: "used" },
  ],
  [
    "openstack_nova_limits_memory_max",
    { resource: OpenStackQuotaResource.RamMib, reading: "limit" },
  ],
  [
    "openstack_cinder_limits_volume_used_gb",
    { resource: OpenStackQuotaResource.Gigabytes, reading: "used" },
  ],
  [
    "openstack_cinder_limits_volume_max_gb",
    { resource: OpenStackQuotaResource.Gigabytes, reading: "limit" },
  ],
] as Array<
  [string, { resource: OpenStackQuotaResource; reading: "used" | "limit" }]
>);

const TYPED_QUOTA_METRICS: ReadonlyMap<string, OpenStackQuotaResource> =
  new Map<string, OpenStackQuotaResource>([
    ["openstack_neutron_quota_network", OpenStackQuotaResource.Networks],
    ["openstack_neutron_quota_port", OpenStackQuotaResource.Ports],
    ["openstack_neutron_quota_floatingip", OpenStackQuotaResource.FloatingIps],
  ]);

/*
 * The labels openstack_nova_server_status carries by itself, and the ones the agent and
 * the probe add. Anything else is a metadata key an operator asked the exporter for with
 * --nova.metadata-extra-labels, which is what a project's labels are made of.
 */
const INSTANCE_STATUS_LABELS: ReadonlySet<string> = new Set([
  "id",
  "uuid",
  "status",
  "name",
  "tenant_id",
  "user_id",
  "address_ipv4",
  "address_ipv6",
  "host_id",
  "hypervisor_hostname",
  "availability_zone",
  "flavor_id",
  "instance_libvirt",
  "updated_at",
  "task_state",
  "fault_message",
  "image_id",
  "network_names",
  OPENSTACK_SERVICE_LABEL,
  OPENSTACK_REGION_ATTRIBUTE,
  "openstack_region",
  "instance",
  "job",
]);

// What a probe asked Placement of each flavor. See OpenStackCapacity.
const OPENSTACK_FLAVOR_FITS_METRIC_NAME: string =
  "openstack_placement_flavor_fits";

export const OPENSTACK_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  ...OPENSTACK_API_UP_METRIC_NAMES.keys(),
  ...PLACEMENT_RESOURCE_METRIC_NAMES,
  ...NAMED_QUOTA_METRICS.keys(),
  ...TYPED_QUOTA_METRICS.keys(),
  ...CINDER_POOL_METRIC_NAMES,
  ...NETWORK_IP_METRIC_NAMES,
  "openstack_nova_agent_state",
  "openstack_neutron_agent_state",
  "openstack_cinder_agent_state",
  "openstack_nova_server_status",
  "openstack_nova_flavor",
  OPENSTACK_FLAVOR_FITS_METRIC_NAME,
  "openstack_nova_vcpus_available",
  "openstack_nova_vcpus_used",
  "openstack_nova_memory_available_bytes",
  "openstack_nova_memory_used_bytes",
  "openstack_nova_local_storage_available_bytes",
  "openstack_nova_local_storage_used_bytes",
  "openstack_nova_running_vms",
  "openstack_cinder_volume_gb",
  "openstack_cinder_snapshot_gb",
  "openstack_cinder_backup_gb",
  "openstack_glance_image_bytes",
  "openstack_glance_image_created_at",
  "openstack_neutron_network",
  "openstack_neutron_subnet",
  "openstack_neutron_router",
  "openstack_neutron_l3_agent_of_router",
  "openstack_neutron_floating_ip",
  "openstack_identity_project_info",
  "openstack_identity_domain_info",
  "openstack_heat_stack_status",
  "openstack_heat_agent_state",
  "openstack_container_infra_cluster_status",
  "openstack_container_infra_agent_state",
  "openstack_sharev2_share_gb",
  "openstack_sharev2_share_status",
  "openstack_sharev2_agent_state",
  "openstack_trove_instance_status",
  "openstack_trove_instance_volume_size_gb",
  "openstack_trove_instance_volume_used_gb",
  "openstack_ironic_node",
  "openstack_ironic_node_provision_updated_at",
  "openstack_ironic_node_updated_at",
  // Only a probe says this one: the exporter has nothing on Ironic's conductors.
  "openstack_ironic_agent_state",
]);

const BYTES_PER_GIB: number = 1024 * 1024 * 1024;
const BYTES_PER_MIB: number = 1024 * 1024;

/*
 * Whether this datapoint belongs in the scan. The receiver's own `up` series is
 * named so plainly that another agent's could share the name, so it counts only
 * with the label the OpenStack agent's jobs put on it.
 */
export function isOpenStackSnapshotDatapoint(data: {
  metricName: string;
  datapoint: JSONObject;
}): boolean {
  if (isOpenStackControlPlaneDatapoint(data)) {
    return true;
  }
  if (
    data.metricName === OPENSTACK_SCRAPE_UP_METRIC_NAME ||
    data.metricName === OPENSTACK_SCRAPE_DURATION_METRIC_NAME
  ) {
    const attributes: JSONArray =
      (data.datapoint["attributes"] as JSONArray) || [];
    const service: string | null = getLabel(
      attributes,
      OPENSTACK_SERVICE_LABEL,
    );
    return service !== null && OPENSTACK_SERVICES_EVERY_CLOUD_RUNS.has(service);
  }
  return OPENSTACK_SNAPSHOT_METRIC_NAMES.has(data.metricName);
}

/*
 * What a scrape of a service a cloud may not run says, beside the exporter's own series. These can
 * never make a row, because they read the same on a cloud that has never run the service: they only
 * ever change one that is already there (OpenStackResourceService.recordOptionalServiceScrapes).
 */
export interface OpenStackOptionalServiceScrape {
  service: string;
  regionName: string | null;
  // `up`: whether the exporter answered. It can answer with nothing.
  answered: boolean | null;
  // scrape_samples_scraped: how many series it answered with.
  samples: number | null;
  // scrape_duration_seconds.
  seconds: number | null;
  observedAt: Date;
}

export function isOpenStackOptionalServiceScrapeDatapoint(data: {
  metricName: string;
  datapoint: JSONObject;
}): boolean {
  if (
    data.metricName !== OPENSTACK_SCRAPE_UP_METRIC_NAME &&
    data.metricName !== OPENSTACK_SCRAPE_DURATION_METRIC_NAME &&
    data.metricName !== OPENSTACK_SCRAPE_SAMPLES_METRIC_NAME
  ) {
    return false;
  }
  return isOpenStackOptionalService(
    getLabel(
      (data.datapoint["attributes"] as JSONArray) || [],
      OPENSTACK_SERVICE_LABEL,
    ),
  );
}

export function bufferOpenStackOptionalServiceScrape(data: {
  metricName: string;
  datapoint: JSONObject;
  buffer: Map<string, OpenStackOptionalServiceScrape>;
}): void {
  const value: number | null =
    toNumberOrNull(data.datapoint["asDouble"]) ??
    toNumberOrNull(data.datapoint["asInt"]);
  if (value === null) {
    return;
  }
  const attributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];
  const service: string | null = getLabel(attributes, OPENSTACK_SERVICE_LABEL);
  if (!service) {
    return;
  }
  const regionName: string | null = getLabel(
    attributes,
    OPENSTACK_REGION_ATTRIBUTE,
  );
  const observedAt: Date = parseUnixNanoToDate(
    data.datapoint["timeUnixNano"] as string | number | undefined,
  );
  const key: string = regional(regionName, service);
  const scrape: OpenStackOptionalServiceScrape = data.buffer.get(key) || {
    service,
    regionName,
    answered: null,
    samples: null,
    seconds: null,
    observedAt,
  };
  if (observedAt > scrape.observedAt) {
    scrape.observedAt = observedAt;
  }
  if (data.metricName === OPENSTACK_SCRAPE_UP_METRIC_NAME) {
    scrape.answered = value > 0;
  } else if (data.metricName === OPENSTACK_SCRAPE_SAMPLES_METRIC_NAME) {
    scrape.samples = value;
  } else {
    scrape.seconds = value;
  }
  data.buffer.set(key, scrape);
}

export interface OpenStackResourceBufferEntry {
  kind: OpenStackResourceKind;
  externalId: string;
  name: string | null;
  regionName: string | null;
  availabilityZone: string | null;
  hypervisorName: string | null;
  openStackProjectId: string | null;
  status: string | null;
  statusObservedAt: Date | null;
  adminState: string | null;
  disabledReason: string | null;
  vcpuCapacity: number | null;
  vcpuAllocated: number | null;
  memoryCapacityBytes: number | null;
  memoryAllocatedBytes: number | null;
  diskCapacityBytes: number | null;
  diskAllocatedBytes: number | null;
  instanceCount: number | null;
  /*
   * Per-resource-class Placement readings, held until the row is finished, because
   * capacity needs total, reserved and ratio together and each is its own series.
   */
  placement: Record<string, PlacementReading>;
  // A batch held only part of what its capacity needs: see getOpenStackHostsWithPartReadings.
  hasPartReading?: boolean | undefined;
  /*
   * A project's quota readings, by fact key, held until the row is finished for the same
   * reason: its used and its limit are two series, and only the pair says anything.
   */
  quota?: Record<string, QuotaReading> | undefined;
  /*
   * When this batch heard a router's own series, which is what can say its agents have gone: a
   * batch can hold a router's agents and not the router. See getOpenStackRoutersWithoutAgents.
   */
  routerSeenAt?: Date | undefined;
  facts: JSONObject;
  observedAt: Date;
}

interface QuotaReading {
  used?: number | undefined;
  limit?: number | undefined;
}

interface PlacementReading {
  total?: number | undefined;
  reserved?: number | undefined;
  ratio?: number | undefined;
  usage?: number | undefined;
}

// Same finite-or-null coercion as the other scans.
function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed: number = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseUnixNanoToDate(value: string | number | undefined): Date {
  if (value !== undefined && value !== null) {
    try {
      if (typeof value === "string" && value.trim() && !isNaN(Number(value))) {
        return OneUptimeDate.fromUnixNano(value.trim());
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return OneUptimeDate.fromUnixNano(value);
      }
    } catch (error) {
      logger.warn(
        `Error reading an OpenStack datapoint's time: ${error instanceof Error ? error.message : String(error)}, using the current time`,
      );
    }
  }
  return OneUptimeDate.getCurrentDate();
}

function getLabel(attributes: JSONArray, key: string): string | null {
  for (const attribute of attributes) {
    if (attribute["key"] !== key || !attribute["value"]) {
      continue;
    }
    const value: JSONValue = (attribute["value"] as JSONObject)["stringValue"];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getOrCreateEntry(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  kind: OpenStackResourceKind;
  externalId: string;
  observedAt: Date;
}): OpenStackResourceBufferEntry {
  const key: string = `${data.kind}/${data.externalId}`;
  let entry: OpenStackResourceBufferEntry | undefined = data.buffer.get(key);
  if (!entry) {
    entry = {
      kind: data.kind,
      externalId: data.externalId,
      name: null,
      regionName: null,
      availabilityZone: null,
      hypervisorName: null,
      openStackProjectId: null,
      status: null,
      statusObservedAt: null,
      adminState: null,
      disabledReason: null,
      vcpuCapacity: null,
      vcpuAllocated: null,
      memoryCapacityBytes: null,
      memoryAllocatedBytes: null,
      diskCapacityBytes: null,
      diskAllocatedBytes: null,
      instanceCount: null,
      placement: {},
      facts: {},
      observedAt: data.observedAt,
    };
    data.buffer.set(key, entry);
  } else if (data.observedAt > entry.observedAt) {
    entry.observedAt = data.observedAt;
  }
  return entry;
}

// Identity: first non-null wins, because it holds for the part's whole life.
function setIdentity(
  entry: OpenStackResourceBufferEntry,
  fields: Partial<
    Pick<
      OpenStackResourceBufferEntry,
      | "name"
      | "regionName"
      | "availabilityZone"
      | "hypervisorName"
      | "openStackProjectId"
    >
  >,
): void {
  for (const field of Object.keys(fields) as Array<keyof typeof fields>) {
    const value: string | null | undefined = fields[field];
    if (entry[field] === null && value) {
      entry[field] = value;
    }
  }
}

// Status: the newest reading in the batch wins.
function setStatus(
  entry: OpenStackResourceBufferEntry,
  status: string | null,
  observedAt: Date,
): void {
  if (!status) {
    return;
  }
  if (!entry.statusObservedAt || observedAt >= entry.statusObservedAt) {
    entry.status = status;
    entry.statusObservedAt = observedAt;
  }
}

function setFact(
  entry: OpenStackResourceBufferEntry,
  name: string,
  value: JSONValue,
): void {
  if (value !== null && value !== undefined && value !== "") {
    entry.facts[name] = value;
  }
}

function setBooleanFact(
  entry: OpenStackResourceBufferEntry,
  name: string,
  label: string | null,
): void {
  if (label === "true" || label === "True") {
    entry.facts[name] = true;
  } else if (label === "false" || label === "False") {
    entry.facts[name] = false;
  }
}

/*
 * Each region's row needs its own id, because only UUIDs are unique across a
 * cloud: `compute-01` and a Neutron agent's host can repeat between regions.
 */
function regional(region: string | null, id: string): string {
  return `${region || "default"}/${id}`;
}

// How an API's row is keyed, for something holding only its service and region.
export function getOpenStackApiRowExternalId(
  region: string | null,
  service: string,
): string {
  return regional(region, service);
}

// How a flavor's row is keyed, for something holding only an instance's flavor ID.
export function getOpenStackFlavorRowExternalId(
  region: string | null,
  flavorId: string,
): string {
  return regional(region, flavorId);
}

function serviceRowId(data: {
  region: string | null;
  family: OpenStackServiceFamily;
  host: string;
  binary: string;
}): string {
  return regional(data.region, `${data.family}/${data.host}/${data.binary}`);
}

function foldApiUp(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  service: OpenStackServiceType;
  region: string | null;
  isUp: boolean;
  observedAt: Date;
  // The exporter's own reading, or the receiver's report that the scrape failed.
  source: "api" | "scrape";
  /*
   * On a cloud whose unchanged rows a probe sends in turns, how long a turn takes. The stale-row
   * rule waits that much longer for a row of this service. Always written, so a cloud that left
   * summary mode stops waiting.
   */
  refreshCycleMinutes?: number | null | undefined;
  /*
   * False when this read held back rows it cannot speak for, because they have not all come round
   * yet or did not fit. The stale-row rule goes on measuring from the last read that could.
   */
  vouchesForRows?: boolean | undefined;
}): void {
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Api,
    externalId: regional(data.region, data.service),
    observedAt: data.observedAt,
  });
  setIdentity(entry, { name: data.service, regionName: data.region });

  /*
   * A scrape that succeeded says nothing about the API: the exporter's own _up
   * series does. Only a failed scrape overrules it, and only to say down.
   */
  if (data.source === "scrape") {
    entry.facts["scrapeFailed"] = !data.isUp;
    if (!data.isUp) {
      setStatus(entry, OPENSTACK_SERVICE_STATUS_DOWN, data.observedAt);
    }
    return;
  }

  setStatus(
    entry,
    data.isUp ? OPENSTACK_SERVICE_STATUS_UP : OPENSTACK_SERVICE_STATUS_DOWN,
    data.observedAt,
  );

  /*
   * A read that cannot speak for what it held back leaves the rule's two numbers as they stand, and
   * they go on applying to the rows they were written about.
   */
  if (data.vouchesForRows === false) {
    return;
  }

  entry.facts["refreshCycleMinutes"] = data.refreshCycleMinutes ?? null;
  /*
   * The time of the last good read, which the stale-row rule measures from: a part
   * is gone only when its service answered after the part was last seen. Written
   * only when up, because facts merge key by key and a null would erase it.
   */
  if (data.isUp) {
    entry.facts["vouchedAt"] = data.observedAt.toISOString();
  }
}

const AGENT_RECORDS_FACT: string = "agentRecords";

const SERVICE_FAMILY_BY_METRIC: ReadonlyMap<string, OpenStackServiceFamily> =
  new Map<string, OpenStackServiceFamily>([
    ["openstack_nova_agent_state", OpenStackServiceFamily.Compute],
    ["openstack_neutron_agent_state", OpenStackServiceFamily.Network],
    ["openstack_cinder_agent_state", OpenStackServiceFamily.Volume],
    ["openstack_heat_agent_state", OpenStackServiceFamily.Orchestration],
    [
      "openstack_container_infra_agent_state",
      OpenStackServiceFamily.ContainerInfra,
    ],
    ["openstack_ironic_agent_state", OpenStackServiceFamily.BareMetal],
    ["openstack_sharev2_agent_state", OpenStackServiceFamily.SharedFileSystems],
  ]);

function foldServiceState(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  family: OpenStackServiceFamily;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const host: string | null = getLabel(data.attributes, "hostname");
  const binary: string | null = getLabel(data.attributes, "service");
  if (!host || !binary) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Service,
    externalId: serviceRowId({
      region: data.region,
      family: data.family,
      host,
      binary,
    }),
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: binary,
    regionName: data.region,
    availabilityZone:
      getLabel(data.attributes, "zone") ||
      getLabel(data.attributes, "availability_zone"),
    hypervisorName:
      data.family === OpenStackServiceFamily.Compute ? host : null,
  });
  // Nova's own say-so, which only a probe sends. An operator saying down is down.
  const forcedDown: string | null = getLabel(data.attributes, "forced_down");
  setStatus(
    entry,
    getLabel(data.attributes, "state") === OPENSTACK_SERVICE_STATUS_STOPPED
      ? OPENSTACK_SERVICE_STATUS_STOPPED
      : data.value > 0 && forcedDown !== "true"
        ? OPENSTACK_SERVICE_STATUS_UP
        : OPENSTACK_SERVICE_STATUS_DOWN,
    data.observedAt,
  );
  /*
   * Facts merge key by key, so a Nova worker always writes this, and a collector that does not
   * say cannot leave behind what the last one did: a cloud moved from a probe to the agent would
   * otherwise read forced down for good. Null is what a page reads as not known.
   */
  if (data.family === OpenStackServiceFamily.Compute) {
    entry.facts["forcedDown"] =
      forcedDown === null ? null : forcedDown === "true";
  }
  entry.adminState =
    getLabel(data.attributes, "adminState") ?? entry.adminState;
  entry.disabledReason =
    getLabel(data.attributes, "disabledReason") ?? entry.disabledReason;
  setFact(entry, "family", data.family);
  setFact(entry, "host", host);
  // Which row of Neutron's agents it is: a router names the agents that hold it by this.
  const agentId: string | null =
    getLabel(data.attributes, "id") || getLabel(data.attributes, "uuid");
  setFact(entry, "agentId", agentId);
  /*
   * Every record Neutron lists for this host and binary, held until the row is finished.
   * On OVN a crash or a change of system-id can leave an old record beside the live one,
   * so one row can be reported twice, and which of the two came last is not an answer. Heat's
   * API lists one record per engine process, and a stopped engine keeps its record for a while.
   */
  if (
    (data.family === OpenStackServiceFamily.Network ||
      data.family === OpenStackServiceFamily.Orchestration) &&
    agentId
  ) {
    const records: JSONObject =
      (entry.facts[AGENT_RECORDS_FACT] as JSONObject) || {};
    records[agentId] = data.value > 0;
    entry.facts[AGENT_RECORDS_FACT] = records;
  }
  /*
   * How many networks a DHCP agent serves, which only a probe reads. Null when nothing says, which
   * is what a page reads as not known, and not as an agent that serves none.
   */
  if (binary === "neutron-dhcp-agent") {
    entry.facts["dhcpNetworkCount"] = toNumberOrNull(
      getLabel(data.attributes, "dhcp_network_count"),
    );
  }
}

/*
 * One Neutron agent's records, once the batch has said all of them. An old record beside
 * a live one is not an outage: the agent is up, and the row says which records are stale
 * so a page can say so. Only when none is alive is the agent down. Written down either
 * way, because facts merge key by key and a stale record that was cleaned up has nothing
 * left to say so.
 */
function finishAgentRecords(entry: OpenStackResourceBufferEntry): void {
  const records: JSONObject | undefined = entry.facts[AGENT_RECORDS_FACT] as
    | JSONObject
    | undefined;
  if (!records) {
    return;
  }
  delete entry.facts[AGENT_RECORDS_FACT];

  const ids: Array<string> = Object.keys(records).sort();
  const alive: Array<string> = ids.filter((id: string): boolean => {
    return records[id] === true;
  });
  const stale: Array<string> = ids.filter((id: string): boolean => {
    return records[id] !== true;
  });

  if (alive.length > 0 && stale.length > 0) {
    entry.status = OPENSTACK_SERVICE_STATUS_UP;
    entry.facts["agentId"] = alive[0] as string;
    entry.facts["staleAgentIds"] = stale;
    return;
  }
  entry.facts["staleAgentIds"] = null;
}

/*
 * Whether a reading of a host is really about a bare metal node. A node is a provider in Placement
 * and a hypervisor to Nova, both under its UUID, and it is neither a place to run a virtual machine
 * nor capacity to count as one (#5742). Decided one series at a time, because a collector can cut a
 * scrape anywhere, so a batch holding only some of a host's series says nothing about the rest.
 *
 *  - Placement: a UUID holding a class of its own. A host called by a UUID holds VCPU and MEMORY_MB
 *    as well, and those stay its own.
 *  - Nova: a UUID that holds nothing. Its Ironic driver gives a node 0 vCPUs, memory and disk, and a
 *    host really called by a UUID has more than that, so what a host holds is what tells them apart.
 *    What is in use can't. A node reads the 512 MiB Nova keeps back for a host's own use
 *    (services-ironic, every scene with Nova reading its nodes), and an instance would add to it. So
 *    a host called by a UUID has only Placement to say what's in use, and an instance's own row says
 *    where it runs.
 */
function isBareMetalNodeReading(data: {
  metricName: string;
  host: string | null;
  resource: string | null;
  value: number;
}): boolean {
  if (!isOpenStackBareMetalNodeId(data.host)) {
    return false;
  }
  if (PLACEMENT_RESOURCE_METRIC_NAMES.has(data.metricName)) {
    return Boolean(data.resource?.startsWith("CUSTOM_"));
  }
  return !NOVA_HOST_HOLDS_METRIC_NAMES.has(data.metricName) || data.value <= 0;
}

/*
 * What Placement holds of a node. Keyed by region, as a hypervisor is, because a provider's name
 * is only as unique as Placement says, and each region has its own.
 */
function foldPlacementProvider(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  metricName: string;
  host: string;
  resource: string;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.PlacementProvider,
    externalId: regional(data.region, data.host),
    observedAt: data.observedAt,
  });
  setIdentity(entry, { name: data.host, regionName: data.region });
  setPlacementReading({
    entry,
    metricName: data.metricName,
    resource: data.resource,
    value: data.value,
  });
}

function setPlacementReading(data: {
  entry: OpenStackResourceBufferEntry;
  metricName: string;
  resource: string;
  value: number;
}): void {
  const reading: PlacementReading = data.entry.placement[data.resource] || {};
  if (data.metricName === "openstack_placement_resource_total") {
    reading.total = data.value;
  } else if (data.metricName === "openstack_placement_resource_reserved") {
    reading.reserved = data.value;
  } else if (
    data.metricName === "openstack_placement_resource_allocation_ratio"
  ) {
    reading.ratio = data.value;
  } else {
    reading.usage = data.value;
  }
  data.entry.placement[data.resource] = reading;
}

function foldHypervisor(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  metricName: string;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const host: string | null = getLabel(data.attributes, "hostname");
  if (!host) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Hypervisor,
    externalId: regional(data.region, host),
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: host,
    regionName: data.region,
    hypervisorName: host,
    availabilityZone: getLabel(data.attributes, "availability_zone"),
  });

  if (PLACEMENT_RESOURCE_METRIC_NAMES.has(data.metricName)) {
    const resource: string | null = getLabel(data.attributes, "resourcetype");
    if (!resource) {
      return;
    }
    setPlacementReading({
      entry,
      metricName: data.metricName,
      resource,
      value: data.value,
    });
    return;
  }

  /*
   * Only Nova's series carry this. The collector drops a label with nothing in it, so a
   * host taken out of its last aggregate simply stops having one, and facts merge key
   * by key: without writing that down it would stay in the aggregate for ever.
   */
  entry.facts["aggregates"] = getLabel(data.attributes, "aggregates");

  /*
   * Nova's own numbers. Placement's are preferred when both arrive, because Nova
   * stopped reporting these at microversion 2.88 and they ignore allocation
   * ratios: see finishOpenStackResource.
   */
  switch (data.metricName) {
    case "openstack_nova_running_vms":
      entry.instanceCount = data.value;
      break;
    case "openstack_nova_vcpus_used":
      entry.vcpuAllocated = data.value;
      entry.facts["novaVcpusUsed"] = data.value;
      break;
    case "openstack_nova_vcpus_available":
      // The host's vCPUs, whatever the name says, before any allocation ratio.
      entry.facts["novaVcpusAvailable"] = data.value;
      break;
    case "openstack_nova_memory_used_bytes":
      entry.memoryAllocatedBytes = data.value;
      entry.facts["novaMemoryUsedBytes"] = data.value;
      break;
    case "openstack_nova_memory_available_bytes":
      entry.facts["novaMemoryAvailableBytes"] = data.value;
      break;
    case "openstack_nova_local_storage_used_bytes":
      entry.diskAllocatedBytes = data.value;
      entry.facts["novaDiskUsedBytes"] = data.value;
      break;
    case "openstack_nova_local_storage_available_bytes":
      entry.facts["novaDiskAvailableBytes"] = data.value;
      break;
    default:
      break;
  }
}

/*
 * One machine Ironic manages, from openstack_ironic_node. The collector drops a label with nothing
 * in it, so a node with no power state or resource class has no such label, and one that lost its
 * maintenance reason has no label left to say so: facts merge key by key, so these are written every
 * time, and the row's reason goes with its adminState (bulkUpsert).
 */
function foldBareMetalNode(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const entry: OpenStackResourceBufferEntry | null = bareMetalNodeEntry(data);
  if (!entry) {
    return;
  }
  const { attributes } = data;
  entry.adminState =
    getLabel(attributes, "maintenance") === "true"
      ? OPENSTACK_BARE_METAL_IN_MAINTENANCE
      : OPENSTACK_BARE_METAL_IN_SERVICE;
  entry.disabledReason = getLabel(attributes, "maintenance_reason");
  entry.facts["powerState"] = getLabel(attributes, "power_state");
  entry.facts["resourceClass"] = getLabel(attributes, "resource_class");
  entry.facts["isRetired"] = getLabel(attributes, "retired") === "true";
  entry.facts["retiredReason"] = getLabel(attributes, "retired_reason");
  setNativeBareMetalNodeFacts(entry, attributes, data.observedAt);
}

// The same node's other two series, in case a collector cut a scrape between them.
function bareMetalNodeEntry(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): OpenStackResourceBufferEntry | null {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return null;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.BareMetalNode,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    // Who owns it, which only a probe says. Ironic's owner is a project's ID.
    openStackProjectId: getLabel(data.attributes, "owner"),
  });
  setStatus(
    entry,
    getLabel(data.attributes, "provision_state"),
    data.observedAt,
  );
  return entry;
}

/*
 * What only Ironic's API says, and so only a probe: the exporter has no driver, instance, fault or
 * last_error. Every node has a driver, so that is what tells a probe's series from the exporter's,
 * whose silence says nothing about any of these.
 *
 * Why a node failed may not last. Ironic emptied a failed clean's last_error 72 seconds later, with
 * the node still failed, and left a failed deploy's alone (recorded: services-ironic, clean-failed
 * against deploy-failed). So a reason is kept until the node has left a failed state, with when it
 * was read. An empty one never replaces it.
 */
function setNativeBareMetalNodeFacts(
  entry: OpenStackResourceBufferEntry,
  attributes: JSONArray,
  observedAt: Date,
): void {
  const driver: string | null = getLabel(attributes, "driver");

  if (!driver) {
    return;
  }

  entry.facts["driver"] = driver;
  entry.facts["instanceId"] = getLabel(attributes, "instance_uuid");
  entry.facts["fault"] = getLabel(attributes, "fault");
  entry.facts["targetProvisionState"] = getLabel(
    attributes,
    "target_provision_state",
  );
  entry.facts["targetPowerState"] = getLabel(attributes, "target_power_state");
  entry.facts["lessee"] = getLabel(attributes, "lessee");
  entry.facts["conductor"] = getLabel(attributes, "conductor");
  entry.facts["conductorGroup"] = getLabel(attributes, "conductor_group");

  const lastError: string | null = getLabel(attributes, "last_error");

  if (lastError) {
    entry.facts["lastError"] = lastError;
    entry.facts["lastErrorReadAt"] = observedAt.toISOString();
  } else if (!isOpenStackBareMetalNodeInError(entry.status)) {
    entry.facts["lastError"] = null;
    entry.facts["lastErrorReadAt"] = null;
  }
}

// When Ironic says a node last changed, as a Unix time. A node that never has has no such series.
function foldBareMetalNodeTime(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  fact: "provisionUpdatedAt" | "nodeUpdatedAt";
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const entry: OpenStackResourceBufferEntry | null = bareMetalNodeEntry(data);
  if (entry && data.value > 0) {
    entry.facts[data.fact] = new Date(data.value * 1000).toISOString();
  }
}

function foldInstance(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null =
    getLabel(data.attributes, "uuid") || getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Instance,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    availabilityZone: getLabel(data.attributes, "availability_zone"),
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  /*
   * An instance can move, so where it runs is a reading rather than an identity.
   * One that failed before it was placed says nothing here.
   */
  entry.hypervisorName =
    getLabel(data.attributes, "hypervisor_hostname") || entry.hypervisorName;
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  setFact(entry, "flavorId", getLabel(data.attributes, "flavor_id"));
  setFact(entry, "userId", getLabel(data.attributes, "user_id"));
  setFact(entry, "addressIpv4", getLabel(data.attributes, "address_ipv4"));
  setFact(entry, "addressIpv6", getLabel(data.attributes, "address_ipv6"));
  // The name libvirt knows it by, which the VM metrics are labelled with.
  setFact(entry, "libvirtName", getLabel(data.attributes, "instance_libvirt"));
  setNativeInstanceFacts(entry, data.attributes);
  setInstanceMetadataLabels(entry, data.attributes);
}

/*
 * What the probe's native collector knows of an instance and the exporter does not. A
 * task or a fault that has cleared loses its label, and facts merge key by key, so those
 * are written down explicitly. Only when this came from the probe, which updated_at
 * tells: the exporter saying nothing about them is not the same as there being none.
 */
function setNativeInstanceFacts(
  entry: OpenStackResourceBufferEntry,
  attributes: JSONArray,
): void {
  const updatedAt: string | null = getLabel(attributes, "updated_at");

  if (!updatedAt) {
    return;
  }

  entry.facts["updatedAt"] = updatedAt;
  entry.facts["taskState"] = getLabel(attributes, "task_state");
  entry.facts["faultMessage"] = getLabel(attributes, "fault_message");
  // None, from a probe, is an instance booted from a volume: see getOpenStackInstanceImage.
  entry.facts["imageId"] = getLabel(attributes, "image_id");
  // An instance that lost its floating IP or its port has no label left to say so.
  entry.facts["addressIpv4"] = getLabel(attributes, "address_ipv4");
  entry.facts["addressIpv6"] = getLabel(attributes, "address_ipv6");
  entry.facts["networkNames"] = getNetworkNames(attributes);
}

// Null when the label is not there or cut short: which is not the same as on no network.
function getNetworkNames(attributes: JSONArray): Array<string> | null {
  const label: string | null = getLabel(attributes, "network_names");

  if (!label) {
    return null;
  }

  try {
    const names: unknown = JSON.parse(label);
    return Array.isArray(names) &&
      names.every((name: unknown): boolean => {
        return typeof name === "string";
      })
      ? (names as Array<string>)
      : null;
  } catch {
    return null;
  }
}

/*
 * The Nova metadata an operator chose to see (--nova.metadata-extra-labels). Whatever is
 * left of a series' labels is theirs, under the name they gave it. The fact is written
 * whole every time, empty too, because facts merge key by key and an instance that lost
 * a key has no label left to say so: anything less would keep the old value for good.
 */
function setInstanceMetadataLabels(
  entry: OpenStackResourceBufferEntry,
  attributes: JSONArray,
): void {
  const labels: JSONObject = {};

  for (const attribute of attributes) {
    const key: JSONValue = attribute["key"];
    if (typeof key !== "string" || INSTANCE_STATUS_LABELS.has(key)) {
      continue;
    }
    const value: string | null = getLabel(attributes, key);
    if (value) {
      labels[key] = value;
    }
  }

  entry.facts["labels"] = labels;
}

function foldFlavor(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Flavor,
    externalId: regional(data.region, id),
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
  });
  const vcpus: number | null = toNumberOrNull(
    getLabel(data.attributes, "vcpus"),
  );
  const ramMib: number | null = toNumberOrNull(
    getLabel(data.attributes, "ram"),
  );
  const diskGib: number | null = toNumberOrNull(
    getLabel(data.attributes, "disk"),
  );
  entry.vcpuCapacity = vcpus;
  entry.memoryCapacityBytes = ramMib === null ? null : ramMib * BYTES_PER_MIB;
  entry.diskCapacityBytes = diskGib === null ? null : diskGib * BYTES_PER_GIB;
  setBooleanFact(entry, "isPublic", getLabel(data.attributes, "is_public"));

  /*
   * What only the probe reads, because the exporter leaves extra specs behind. Only when this came
   * from the probe, which this label tells: the exporter saying nothing of them is not the same as
   * there being none. Facts merge key by key, so one that went away is written down as gone.
   */
  const placementResources: string | null = getLabel(
    data.attributes,
    "placement_resources",
  );

  if (placementResources) {
    entry.facts["placementResources"] = placementResources;
    entry.facts["placementRequired"] = getLabel(
      data.attributes,
      "placement_required",
    );
    entry.facts["placementForbidden"] = getLabel(
      data.attributes,
      "placement_forbidden",
    );
    entry.facts["isDisabled"] = getLabel(data.attributes, "is_disabled")
      ? true
      : null;
  }
}

/*
 * What a probe last asked Placement of a flavor. One series for the region, which says when it was
 * asked, and one for each zone and aggregate. They are one metric, and a metric stays whole in an
 * upload (OpenStackReportParts), so the whole answer is in one batch, and replaces the last whole.
 */
function foldFlavorFits(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "flavor_id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Flavor,
    externalId: regional(data.region, id),
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "flavor"),
    regionName: data.region,
  });

  const answer: JSONObject = (entry.facts["placementAnswer"] as JSONObject) || {
    byZone: {},
    byAggregate: {},
  };
  const scope: string | null = getLabel(data.attributes, "scope");

  if (scope === "region") {
    answer["fits"] = data.value;
    answer["askedAt"] = getLabel(data.attributes, "asked_at");
    answer["hostsWithRoom"] = toNumberOrNull(
      getLabel(data.attributes, "hosts_with_room"),
    );
    answer["isCapped"] = getLabel(data.attributes, "is_capped") === "true";
  } else if (scope === "zone" || scope === "aggregate") {
    /*
     * An empty label is no label, and a host nothing has placed in a zone counts under "": the
     * collector drops a label with nothing in it.
     */
    const group: JSONObject = answer[
      scope === "zone" ? "byZone" : "byAggregate"
    ] as JSONObject;
    group[getLabel(data.attributes, "scope_name") || ""] = data.value;
  }

  entry.facts["placementAnswer"] = answer;
}

function foldVolume(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Volume,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    availabilityZone: getLabel(data.attributes, "availability_zone"),
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  entry.diskCapacityBytes = data.value * BYTES_PER_GIB;
  setFact(entry, "volumeType", getLabel(data.attributes, "volume_type"));
  /*
   * A volume that was detached loses this label, and facts merge key by key, so that
   * is written down explicitly: it would otherwise say what held it for ever.
   */
  entry.facts["attachedToInstance"] = getLabel(data.attributes, "server_id");
  /*
   * Which pool holds it, which is all a pool's blast radius has to go on. The exporter's
   * series has no such label, so this is written only by a source that names one: a probe,
   * whose updated_at tells it apart, and then it says too when a volume names none, such as
   * under a credential that stopped being told.
   */
  if (getLabel(data.attributes, "updated_at")) {
    entry.facts["pool"] = getLabel(data.attributes, "pool");
    // None, from a probe, is a volume not made from an image. Nothing at all is the exporter's.
    entry.facts["imageId"] = getLabel(data.attributes, "image_id");
  } else {
    setFact(entry, "pool", getLabel(data.attributes, "pool"));
  }
  setBooleanFact(entry, "isBootable", getLabel(data.attributes, "bootable"));
  setFact(entry, "updatedAt", getLabel(data.attributes, "updated_at"));
}

/*
 * A share, from either of Manila's two series about it. Both say its status, in Manila's word, and
 * whose it is. Only _share_gb says its zone, and only its value is its size, so its value is what is
 * read and _share_status's, a code for the word, is not. share_type holds the type's name, recorded,
 * and share_type_name is empty, because the exporter asks for no microversion.
 */
function foldShare(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
  metricName: string;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Share,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    availabilityZone: getLabel(data.attributes, "availability_zone"),
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  if (data.metricName === "openstack_sharev2_share_gb") {
    entry.diskCapacityBytes = data.value * BYTES_PER_GIB;
  }
  setFact(entry, "shareProtocol", getLabel(data.attributes, "share_proto"));
  setFact(
    entry,
    "shareType",
    getLabel(data.attributes, "share_type_name") ||
      getLabel(data.attributes, "share_type"),
  );
  /*
   * What only a probe says, which asks for a microversion. Facts merge key by key, so these are
   * written whatever the collector knows: a cloud moved to the agent must not go on saying them.
   * Null reads as not known.
   */
  entry.facts["accessRulesStatus"] = getLabel(
    data.attributes,
    "access_rules_status",
  );
  entry.facts["backendHost"] = getLabel(data.attributes, "host");
}

/*
 * A database, from any of Trove's three series about it. Each carries the instance's labels, and the
 * two sizes are in their values. An instance that isn't running reads 0 used, recorded in BUILD and
 * ERROR. Why one failed is only said by a probe, which an admin's read of Trove's mgmt API tells.
 */
function foldDatabaseInstance(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
  metricName: string;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.DatabaseInstance,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  if (data.metricName === "openstack_trove_instance_volume_size_gb") {
    entry.diskCapacityBytes = data.value * BYTES_PER_GIB;
  }
  if (data.metricName === "openstack_trove_instance_volume_used_gb") {
    entry.diskAllocatedBytes = data.value * BYTES_PER_GIB;
  }
  setFact(entry, "datastoreType", getLabel(data.attributes, "datastore_type"));
  setFact(
    entry,
    "datastoreVersion",
    getLabel(data.attributes, "datastore_version"),
  );
  // Each is written whatever the collector knows: see foldShare. Null reads as not known.
  entry.facts["healthStatus"] = getLabel(data.attributes, "health_status");
  /*
   * Only a probe says these, and only on the status series: the two sizes carry neither label, and reading
   * them here would take back what it just said.
   */
  if (data.metricName === "openstack_trove_instance_status") {
    entry.facts["faultMessage"] = getLabel(data.attributes, "fault_message");
    entry.facts["taskDescription"] = getLabel(
      data.attributes,
      "task_description",
    );
  }
}

function foldSnapshot(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Snapshot,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  entry.diskCapacityBytes = data.value * BYTES_PER_GIB;
  setFact(entry, "volumeId", getLabel(data.attributes, "volume_id"));
  setFact(entry, "createdAt", getLabel(data.attributes, "created_at"));
  setFact(entry, "updatedAt", getLabel(data.attributes, "updated_at"));
}

function foldBackup(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Backup,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    availabilityZone: getLabel(data.attributes, "availability_zone"),
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  entry.diskCapacityBytes = data.value * BYTES_PER_GIB;
  setFact(entry, "volumeId", getLabel(data.attributes, "volume_id"));
  setBooleanFact(
    entry,
    "isIncremental",
    getLabel(data.attributes, "is_incremental"),
  );
  setFact(entry, "updatedAt", getLabel(data.attributes, "updated_at"));
}

function foldStoragePool(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  metricName: string;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const name: string | null = getLabel(data.attributes, "name");
  if (!name) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.StoragePool,
    externalId: regional(data.region, name),
    observedAt: data.observedAt,
  });
  setIdentity(entry, { name, regionName: data.region });
  setFact(entry, "backend", getLabel(data.attributes, "volume_backend_name"));
  setFact(entry, "vendor", getLabel(data.attributes, "vendor_name"));
  // Only a probe says these, and then what links this pool to a Ceph cluster is a fact.
  setFact(
    entry,
    "storageProtocol",
    getLabel(data.attributes, "storage_protocol"),
  );
  setFact(entry, "cephFsid", getLabel(data.attributes, "ceph_fsid"));
  setFact(entry, "cephPool", getLabel(data.attributes, "ceph_pool"));
  const bytes: number = data.value * BYTES_PER_GIB;
  if (data.metricName === "openstack_cinder_pool_capacity_total_gb") {
    entry.diskCapacityBytes = bytes;
  } else {
    entry.facts["freeBytes"] = bytes;
  }
}

function foldImage(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  metricName: string;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Image,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  /*
   * Two series for one image: its size in one, and in the other its status and
   * visibility, with when it was created as the value.
   */
  if (data.metricName === "openstack_glance_image_created_at") {
    setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
    setFact(entry, "visibility", getLabel(data.attributes, "visibility"));
    setBooleanFact(entry, "isHidden", getLabel(data.attributes, "hidden"));
    setBooleanFact(
      entry,
      "isProtected",
      getLabel(data.attributes, "protected"),
    );
    setFact(entry, "createdAtSeconds", data.value);
  } else {
    entry.diskCapacityBytes = data.value;
  }
  setFact(entry, "imageType", getLabel(data.attributes, "image_type"));
}

function foldNetwork(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Network,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  setBooleanFact(entry, "isExternal", getLabel(data.attributes, "is_external"));
  setBooleanFact(entry, "isShared", getLabel(data.attributes, "is_shared"));
  setFact(
    entry,
    "networkType",
    getLabel(data.attributes, "provider_network_type"),
  );
  setFact(
    entry,
    "physicalNetwork",
    getLabel(data.attributes, "provider_physical_network"),
  );
  setFact(entry, "mtu", toNumberOrNull(getLabel(data.attributes, "mtu")));
  /*
   * Which DHCP agents serve it, which only a probe reads. Written every time, because facts merge
   * key by key and a network taken off its agents has no label left to say so. A label is cut at
   * a length, far past what a network has, and then its last id is no id.
   */
  const dhcpAgentIds: string | null = getLabel(
    data.attributes,
    "dhcp_agent_ids",
  );
  entry.facts["dhcpAgentIds"] = dhcpAgentIds
    ? getIdListLabel(data.attributes, "dhcp_agent_ids")
    : null;
}

// A label holding IDs, which is cut at a length and then its last one is no ID.
function getIdListLabel(attributes: JSONArray, name: string): Array<string> {
  return (getLabel(attributes, name) || "")
    .split(",")
    .filter((id: string): boolean => {
      return Boolean(id) && !id.endsWith("…");
    });
}

/*
 * Addresses used and total come per subnet. A network adds its subnets up, and
 * each subnet keeps its own: a full subnet is what stops an instance booting,
 * whatever the network's total says.
 */
function foldIpAvailability(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  metricName: string;
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const networkId: string | null = getLabel(data.attributes, "network_id");
  if (!networkId) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Network,
    externalId: networkId,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "network_name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  const subnetKey: string =
    getLabel(data.attributes, "subnet_name") ||
    getLabel(data.attributes, "cidr") ||
    "default";
  const subnets: JSONObject = (entry.facts["ipsBySubnet"] as JSONObject) || {};
  const subnet: JSONObject = (subnets[subnetKey] as JSONObject) || {};
  subnet[
    data.metricName === "openstack_neutron_network_ip_availabilities_total"
      ? "total"
      : "used"
  ] = data.value;
  const cidr: string | null = getLabel(data.attributes, "cidr");
  if (cidr) {
    subnet["cidr"] = cidr;
  }
  const ipVersion: string | null = getLabel(data.attributes, "ip_version");
  if (ipVersion) {
    subnet["ipVersion"] = ipVersion;
  }
  subnets[subnetKey] = subnet;
  entry.facts["ipsBySubnet"] = subnets;
}

function foldSubnet(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Subnet,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "tenant_id"),
  });
  setFact(entry, "networkId", getLabel(data.attributes, "network_id"));
  setFact(entry, "cidr", getLabel(data.attributes, "cidr"));
  setFact(entry, "gatewayIp", getLabel(data.attributes, "gateway_ip"));
  setBooleanFact(entry, "enableDhcp", getLabel(data.attributes, "enable_dhcp"));
}

function foldRouter(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Router,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  entry.routerSeenAt = data.observedAt;
  const adminUp: string | null = getLabel(data.attributes, "admin_state_up");
  if (adminUp !== null) {
    entry.adminState = adminUp === "true" ? "up" : "down";
  }
  /*
   * A router that lost its gateway loses this label, and facts merge key by key, so
   * that is written down explicitly.
   */
  entry.facts["externalNetworkId"] = getLabel(
    data.attributes,
    "external_network_id",
  );
}

/*
 * A router's agents are only said by a series per agent, so one that lost its last agent has no
 * series left to say so, and facts merge key by key: it would name them for ever. So its agents
 * say when they were last heard, and a router heard long after that has none
 * (getOpenStackRoutersWithoutAgents, OpenStackResourceService.forgetAgentsOfRouters).
 *
 * Long after, and not in the same breath, because all of a scrape is not in one batch: past a
 * request's size a collector cuts it anywhere, so a router can arrive first and its agents a moment
 * later, and one read of one router's agents can fail while the rest answer. Neither is a router
 * that lost them.
 *
 * To five minutes, which is as often as an unchanged row is rewritten anyway, so this rewrites
 * nothing extra.
 */
const ROUTER_AGENTS_REPORTED_TO_MS: number = 5 * 60 * 1000;
const ROUTER_AGENTS_GONE_AFTER_MS: number = 10 * 60 * 1000;

function getRouterAgentsReportTime(observedAt: Date): string {
  return new Date(
    Math.floor(observedAt.getTime() / ROUTER_AGENTS_REPORTED_TO_MS) *
      ROUTER_AGENTS_REPORTED_TO_MS,
  ).toISOString();
}

/*
 * Which agents hold a router, one series per agent, and what they say about it.
 * This is what tells a router with no alive agent, or (with HA) two active ones.
 */
function foldL3AgentOfRouter(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const routerId: string | null = getLabel(data.attributes, "router_id");
  const agentId: string | null = getLabel(data.attributes, "l3_agent_id");
  if (!routerId || !agentId) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Router,
    externalId: routerId,
    observedAt: data.observedAt,
  });
  setIdentity(entry, { regionName: data.region });
  const agents: JSONObject = (entry.facts["l3Agents"] as JSONObject) || {};
  agents[agentId] = {
    host: getLabel(data.attributes, "agent_host"),
    isAlive: getLabel(data.attributes, "agent_alive") === "true",
    isAdminUp: getLabel(data.attributes, "agent_admin_up") === "true",
    haState: getLabel(data.attributes, "ha_state"),
  };
  entry.facts["l3Agents"] = agents;
  entry.facts["l3AgentsReportedAt"] = getRouterAgentsReportTime(
    data.observedAt,
  );
}

function foldFloatingIp(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.FloatingIp,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "floating_ip_address"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  /*
   * The router it goes through, which Neutron only sets once the address is
   * associated with a port. The exporter has no port label, so this is how a spare
   * address is told from one in use. An address that lost its association loses
   * the label too, and facts merge key by key, so that is written down explicitly.
   */
  entry.facts["routerId"] = getLabel(data.attributes, "router_id");
  setFact(
    entry,
    "floatingNetworkId",
    getLabel(data.attributes, "floating_network_id"),
  );
}

/*
 * A stack, from Heat's list. Its status is the word Heat says it in: its value here is that word's
 * code, and tells nothing the label doesn't. A credential below an admin gets its own project's
 * stacks with an empty project_id, recorded, and an empty label is no label: nothing can say whose.
 * Why it failed is only said by a probe: the exporter never asks.
 */
function foldStack(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Stack,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  /*
   * Facts merge key by key, so these are written whatever the collector knows: a cloud moved from a
   * probe to the agent must not go on saying why a stack failed last week. Null reads as not known.
   */
  entry.facts["statusReason"] = getLabel(data.attributes, "status_reason");
  entry.facts["parentStackId"] = getLabel(data.attributes, "parent_id");
  /*
   * What it owns, which only a probe reads, and only once it has read this stack. An empty list here
   * says it owns none, and null says nothing has read it. The IDs a label has room for, and how many
   * there are, because a stack can own more than that.
   */
  const wasRead: boolean =
    getLabel(data.attributes, "resources_read") === "true";
  entry.facts["ownedInstanceIds"] = wasRead
    ? getIdListLabel(data.attributes, "owned_instance_ids")
    : null;
  entry.facts["ownedInstanceCount"] = wasRead
    ? toNumberOrNull(getLabel(data.attributes, "owned_instance_count"))
    : null;
  entry.facts["ownedVolumeIds"] = wasRead
    ? getIdListLabel(data.attributes, "owned_volume_ids")
    : null;
  entry.facts["ownedVolumeCount"] = wasRead
    ? toNumberOrNull(getLabel(data.attributes, "owned_volume_count"))
    : null;
}

/*
 * A Kubernetes cluster Magnum built. The exporter's series have an empty project_id, recorded on
 * every scene: Magnum says whose it is only on a cluster's own read, which only a probe makes. Its
 * stack_id is always there, and Heat knows whose that stack is, which is what
 * OpenStackResourceService.reconcileContainerClusterProjects joins. This series has the two counts
 * in its labels, so the other two per-cluster series (_masters, _nodes) add nothing to a row.
 */
function foldContainerCluster(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  region: string | null;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "uuid");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.ContainerCluster,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    regionName: data.region,
    openStackProjectId: getLabel(data.attributes, "project_id"),
  });
  setStatus(entry, getLabel(data.attributes, "status"), data.observedAt);
  setFact(entry, "stackId", getLabel(data.attributes, "stack_id"));
  entry.facts["nodeCount"] = toNumberOrNull(
    getLabel(data.attributes, "node_count"),
  );
  entry.facts["masterCount"] = toNumberOrNull(
    getLabel(data.attributes, "master_count"),
  );
  // Only a probe says these, and null reads as not known: see foldStack.
  entry.facts["statusReason"] = getLabel(data.attributes, "status_reason");
  entry.facts["healthStatus"] = getLabel(data.attributes, "health_status");
  entry.facts["clusterTemplateId"] = getLabel(
    data.attributes,
    "cluster_template_id",
  );
  entry.facts["clusterTemplateName"] = getLabel(
    data.attributes,
    "cluster_template_name",
  );
  entry.facts["coeVersion"] = getLabel(data.attributes, "coe_version");
  entry.facts["apiAddress"] = getLabel(data.attributes, "api_address");
}

function foldProject(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  // A domain is also a project to Keystone, and has its own series as a domain.
  if (!id || getLabel(data.attributes, "is_domain") === "true") {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Project,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "name"),
    openStackProjectId: id,
  });
  const enabled: string | null = getLabel(data.attributes, "enabled");
  setStatus(
    entry,
    enabled === null ? null : enabled === "true" ? "enabled" : "disabled",
    data.observedAt,
  );
  setFact(entry, "domainId", getLabel(data.attributes, "domain_id"));
  setFact(entry, "parentId", getLabel(data.attributes, "parent_id"));
  setFact(entry, "description", getLabel(data.attributes, "description"));
  setFact(entry, "tags", getLabel(data.attributes, "tags"));
}

/*
 * One reading of what a project may use or has used. A used figure below zero means
 * nothing, and a limit of -1 means no limit, which is kept: it is what says this project
 * can never be at this quota.
 */
function foldProjectQuota(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  resource: OpenStackQuotaResource;
  reading: "used" | "limit";
  attributes: JSONArray;
  region: string | null;
  value: number;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "tenant_id");
  if (!id || (data.reading === "used" && data.value < 0)) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Project,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, {
    name: getLabel(data.attributes, "tenant"),
    openStackProjectId: id,
  });
  const quota: Record<string, QuotaReading> = entry.quota || {};
  const key: string = getOpenStackQuotaFactKey(data.resource, data.region);
  quota[key] = { ...quota[key], [data.reading]: data.value };
  entry.quota = quota;
}

function foldDomain(data: {
  buffer: Map<string, OpenStackResourceBufferEntry>;
  attributes: JSONArray;
  observedAt: Date;
}): void {
  const id: string | null = getLabel(data.attributes, "id");
  if (!id) {
    return;
  }
  const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
    buffer: data.buffer,
    kind: OpenStackResourceKind.Domain,
    externalId: id,
    observedAt: data.observedAt,
  });
  setIdentity(entry, { name: getLabel(data.attributes, "name") });
  const enabled: string | null = getLabel(data.attributes, "enabled");
  setStatus(
    entry,
    enabled === null ? null : enabled === "true" ? "enabled" : "disabled",
    data.observedAt,
  );
}

/*
 * Fold one openstack_* datapoint into the cloud's buffer. Identity is in
 * DATAPOINT labels, so this reads the raw attribute array, and the region comes
 * from the attribute the agent's transform processor stamps.
 */
export function bufferOpenStackSnapshotMetric(data: {
  metricName: string;
  datapoint: JSONObject;
  buffer: Map<string, OpenStackResourceBufferEntry>;
}): void {
  const value: number | null =
    toNumberOrNull(data.datapoint["asDouble"]) ??
    toNumberOrNull(data.datapoint["asInt"]);
  if (value === null) {
    return;
  }
  const attributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];
  const observedAt: Date = parseUnixNanoToDate(
    data.datapoint["timeUnixNano"] as string | number | undefined,
  );
  const region: string | null = getLabel(
    attributes,
    OPENSTACK_REGION_ATTRIBUTE,
  );
  const { metricName, buffer } = data;

  // What the cloud stands on is told apart by its own label, and has its own fold.
  if (
    foldOpenStackControlPlaneDatapoint({
      metricName,
      attributes,
      value,
      observedAt,
      region,
      entryFor: (externalId: string): OpenStackResourceBufferEntry => {
        return getOrCreateEntry({
          buffer,
          kind: OpenStackResourceKind.ControlPlane,
          externalId,
          observedAt,
        });
      },
    })
  ) {
    return;
  }

  if (metricName === OPENSTACK_SCRAPE_DURATION_METRIC_NAME) {
    const service: string | null = getLabel(
      attributes,
      OPENSTACK_SERVICE_LABEL,
    );
    if (service) {
      const entry: OpenStackResourceBufferEntry = getOrCreateEntry({
        buffer,
        kind: OpenStackResourceKind.Api,
        externalId: regional(region, service),
        observedAt,
      });
      setIdentity(entry, { name: service, regionName: region });
      entry.facts["collectionSeconds"] = value;
    }
    return;
  }

  if (metricName === OPENSTACK_SCRAPE_UP_METRIC_NAME) {
    const service: string | null = getLabel(
      attributes,
      OPENSTACK_SERVICE_LABEL,
    );
    if (service) {
      foldApiUp({
        buffer,
        service: service as OpenStackServiceType,
        region,
        isUp: value > 0,
        observedAt,
        source: "scrape",
      });
    }
    return;
  }

  const apiService: OpenStackServiceType | undefined =
    OPENSTACK_API_UP_METRIC_NAMES.get(metricName);
  if (apiService) {
    foldApiUp({
      buffer,
      service: apiService,
      region,
      isUp: value > 0,
      observedAt,
      source: "api",
      refreshCycleMinutes: toNumberOrNull(
        getLabel(attributes, "refresh_cycle_minutes"),
      ),
      vouchesForRows: getLabel(attributes, "vouches_for_rows") !== "false",
    });
    return;
  }

  const family: OpenStackServiceFamily | undefined =
    SERVICE_FAMILY_BY_METRIC.get(metricName);
  if (family) {
    foldServiceState({ buffer, family, attributes, region, value, observedAt });
    return;
  }

  if (
    PLACEMENT_RESOURCE_METRIC_NAMES.has(metricName) ||
    metricName.startsWith("openstack_nova_vcpus_") ||
    metricName.startsWith("openstack_nova_memory_") ||
    metricName.startsWith("openstack_nova_local_storage_") ||
    metricName === "openstack_nova_running_vms"
  ) {
    const host: string | null = getLabel(attributes, "hostname");
    const resource: string | null = getLabel(attributes, "resourcetype");
    if (isBareMetalNodeReading({ metricName, host, resource, value })) {
      if (host && resource) {
        foldPlacementProvider({
          buffer,
          metricName,
          host,
          resource,
          region,
          value,
          observedAt,
        });
      }
      return;
    }
    foldHypervisor({
      buffer,
      metricName,
      attributes,
      region,
      value,
      observedAt,
    });
    return;
  }

  const namedQuota:
    | { resource: OpenStackQuotaResource; reading: "used" | "limit" }
    | undefined = NAMED_QUOTA_METRICS.get(metricName);
  if (namedQuota) {
    foldProjectQuota({
      buffer,
      resource: namedQuota.resource,
      reading: namedQuota.reading,
      attributes,
      region,
      value,
      observedAt,
    });
    return;
  }

  const typedQuota: OpenStackQuotaResource | undefined =
    TYPED_QUOTA_METRICS.get(metricName);
  if (typedQuota) {
    // Neutron says used, reserved or limit. Reserved is on its way to being used.
    const type: string | null = getLabel(attributes, "type");
    if (type === "used" || type === "limit") {
      foldProjectQuota({
        buffer,
        resource: typedQuota,
        reading: type,
        attributes,
        region,
        value,
        observedAt,
      });
    }
    return;
  }

  if (CINDER_POOL_METRIC_NAMES.has(metricName)) {
    foldStoragePool({
      buffer,
      metricName,
      attributes,
      region,
      value,
      observedAt,
    });
    return;
  }

  if (NETWORK_IP_METRIC_NAMES.has(metricName)) {
    foldIpAvailability({
      buffer,
      metricName,
      attributes,
      region,
      value,
      observedAt,
    });
    return;
  }

  switch (metricName) {
    case "openstack_nova_server_status":
      foldInstance({ buffer, attributes, region, observedAt });
      return;
    case "openstack_nova_flavor":
      foldFlavor({ buffer, attributes, region, observedAt });
      return;
    case OPENSTACK_FLAVOR_FITS_METRIC_NAME:
      foldFlavorFits({ buffer, attributes, region, value, observedAt });
      return;
    case "openstack_cinder_volume_gb":
      foldVolume({ buffer, attributes, region, value, observedAt });
      return;
    case "openstack_cinder_snapshot_gb":
      foldSnapshot({ buffer, attributes, region, value, observedAt });
      return;
    case "openstack_cinder_backup_gb":
      foldBackup({ buffer, attributes, region, value, observedAt });
      return;
    case "openstack_glance_image_bytes":
    case "openstack_glance_image_created_at":
      foldImage({ buffer, metricName, attributes, region, value, observedAt });
      return;
    case "openstack_neutron_network":
      foldNetwork({ buffer, attributes, region, observedAt });
      return;
    case "openstack_neutron_subnet":
      foldSubnet({ buffer, attributes, region, observedAt });
      return;
    case "openstack_neutron_router":
      foldRouter({ buffer, attributes, region, observedAt });
      return;
    case "openstack_neutron_l3_agent_of_router":
      foldL3AgentOfRouter({ buffer, attributes, region, observedAt });
      return;
    case "openstack_neutron_floating_ip":
      foldFloatingIp({ buffer, attributes, region, observedAt });
      return;
    case "openstack_identity_project_info":
      foldProject({ buffer, attributes, observedAt });
      return;
    case "openstack_identity_domain_info":
      foldDomain({ buffer, attributes, observedAt });
      return;
    case "openstack_heat_stack_status":
      foldStack({ buffer, attributes, region, observedAt });
      return;
    case "openstack_container_infra_cluster_status":
      foldContainerCluster({ buffer, attributes, region, observedAt });
      return;
    case "openstack_sharev2_share_gb":
    case "openstack_sharev2_share_status":
      foldShare({ buffer, attributes, region, value, observedAt, metricName });
      return;
    case "openstack_trove_instance_status":
    case "openstack_trove_instance_volume_size_gb":
    case "openstack_trove_instance_volume_used_gb":
      foldDatabaseInstance({
        buffer,
        attributes,
        region,
        value,
        observedAt,
        metricName,
      });
      return;
    case "openstack_ironic_node":
      foldBareMetalNode({ buffer, attributes, region, observedAt });
      return;
    case "openstack_ironic_node_provision_updated_at":
      foldBareMetalNodeTime({
        buffer,
        fact: "provisionUpdatedAt",
        attributes,
        region,
        value,
        observedAt,
      });
      return;
    case "openstack_ironic_node_updated_at":
      foldBareMetalNodeTime({
        buffer,
        fact: "nodeUpdatedAt",
        attributes,
        region,
        value,
        observedAt,
      });
      return;
    default:
      return;
  }
}

/*
 * (total - reserved) * allocation ratio is what Placement will promise, and usage
 * is what it has promised. Nova's own vcpus_available ignored ratios and stopped
 * being reported at microversion 2.88, so Placement wins when it answered.
 *
 * Only from a whole reading. A collector sends a large scrape in several batches, and each of
 * these is its own series, so a batch can hold a host's total without its ratio: that would read
 * as 1:1, and the Overview would say so. Such a host is put right from its facts once the batch
 * has written them (getOpenStackHostsWithPartReadings).
 */
function placementCapacity(reading: PlacementReading | undefined): {
  capacity: number | null;
  usage: number | null;
  isPartial: boolean;
} {
  if (
    !reading ||
    reading.total === undefined ||
    reading.reserved === undefined ||
    reading.ratio === undefined
  ) {
    return {
      capacity: null,
      usage: reading?.usage ?? null,
      isPartial: reading?.total !== undefined,
    };
  }
  const usable: number = Math.max(0, reading.total - reading.reserved);
  return {
    capacity: usable * reading.ratio,
    usage: reading.usage ?? null,
    isPartial: false,
  };
}

/*
 * One fact per number, for every class a provider holds: what the capacity pages add up. See
 * readOpenStackInventories for why each is its own, and why it says when it was last seen.
 */
function setInventoryFacts(entry: OpenStackResourceBufferEntry): void {
  const seen: number = getOpenStackInventorySeenHour(entry.observedAt);

  for (const resourceClass of Object.keys(entry.placement)) {
    const reading: PlacementReading = entry.placement[
      resourceClass
    ] as PlacementReading;

    const set: (
      field: "total" | "reserved" | "ratio" | "used",
      value: number | undefined,
    ) => void = (
      field: "total" | "reserved" | "ratio" | "used",
      value: number | undefined,
    ): void => {
      if (value !== undefined) {
        entry.facts[getOpenStackInventoryFactKey(resourceClass, field)] = value;
      }
    };

    set("total", reading.total);
    set("reserved", reading.reserved);
    set("ratio", reading.ratio);
    set("used", reading.usage);

    if (reading.total !== undefined) {
      entry.facts[getOpenStackInventoryFactKey(resourceClass, "seen")] = seen;
    }
  }
}

/*
 * Turn a folded entry into the row to write: everything that needs several series
 * together is decided here, after the whole batch has been read.
 */
export function finishOpenStackResource(
  entry: OpenStackResourceBufferEntry,
): OpenStackResourceBufferEntry {
  if (entry.kind === OpenStackResourceKind.Service) {
    finishAgentRecords(entry);
  }

  if (entry.kind === OpenStackResourceKind.PlacementProvider) {
    setInventoryFacts(entry);
  }

  /*
   * Half an answer is no answer: a whole one is on the row, facts merge key by key, and a count
   * with no time on it can't say how old it is.
   */
  if (
    entry.kind === OpenStackResourceKind.Flavor &&
    entry.facts["placementAnswer"] &&
    !(entry.facts["placementAnswer"] as JSONObject)["askedAt"]
  ) {
    delete entry.facts["placementAnswer"];
  }

  if (entry.kind === OpenStackResourceKind.Hypervisor) {
    setInventoryFacts(entry);

    const vcpu: ReturnType<typeof placementCapacity> = placementCapacity(
      entry.placement["VCPU"],
    );
    const memory: ReturnType<typeof placementCapacity> = placementCapacity(
      entry.placement["MEMORY_MB"],
    );
    const disk: ReturnType<typeof placementCapacity> = placementCapacity(
      entry.placement["DISK_GB"],
    );

    entry.hasPartReading = vcpu.isPartial || memory.isPartial || disk.isPartial;

    if (vcpu.capacity !== null) {
      entry.vcpuCapacity = vcpu.capacity;
    } else if (
      !vcpu.isPartial &&
      entry.facts["novaVcpusAvailable"] !== undefined &&
      entry.facts["novaVcpusUsed"] !== undefined
    ) {
      entry.vcpuCapacity = entry.facts["novaVcpusAvailable"] as number;
    }
    if (vcpu.usage !== null) {
      entry.vcpuAllocated = vcpu.usage;
    }

    if (memory.capacity !== null) {
      entry.memoryCapacityBytes = memory.capacity * BYTES_PER_MIB;
    } else if (
      !memory.isPartial &&
      entry.facts["novaMemoryAvailableBytes"] !== undefined
    ) {
      entry.memoryCapacityBytes = entry.facts[
        "novaMemoryAvailableBytes"
      ] as number;
    }
    if (memory.usage !== null) {
      entry.memoryAllocatedBytes = memory.usage * BYTES_PER_MIB;
    }

    if (disk.capacity !== null) {
      entry.diskCapacityBytes = disk.capacity * BYTES_PER_GIB;
    } else if (
      !disk.isPartial &&
      entry.facts["novaDiskAvailableBytes"] !== undefined
    ) {
      entry.diskCapacityBytes = entry.facts["novaDiskAvailableBytes"] as number;
    }
    if (disk.usage !== null) {
      entry.diskAllocatedBytes = disk.usage * BYTES_PER_GIB;
    }

    for (const resource of ["VCPU", "MEMORY_MB", "DISK_GB"]) {
      const ratio: number | undefined = entry.placement[resource]?.ratio;
      if (ratio !== undefined) {
        const allocationRatios: JSONObject =
          (entry.facts["allocationRatios"] as JSONObject) || {};
        allocationRatios[resource] = ratio;
        entry.facts["allocationRatios"] = allocationRatios;
      }
      /*
       * What the hypervisor really has, before a ratio: what real load is measured
       * against, as apart from what is promised on it.
       */
      const total: number | undefined = entry.placement[resource]?.total;
      if (total !== undefined) {
        const resourceTotals: JSONObject =
          (entry.facts["resourceTotals"] as JSONObject) || {};
        resourceTotals[resource] = total;
        entry.facts["resourceTotals"] = resourceTotals;
      }
    }

    delete entry.facts["novaVcpusUsed"];
    delete entry.facts["novaVcpusAvailable"];
    delete entry.facts["novaMemoryUsedBytes"];
    delete entry.facts["novaMemoryAvailableBytes"];
    delete entry.facts["novaDiskUsedBytes"];
    delete entry.facts["novaDiskAvailableBytes"];
  }

  if (
    entry.kind === OpenStackResourceKind.StoragePool &&
    entry.diskCapacityBytes !== null &&
    typeof entry.facts["freeBytes"] === "number"
  ) {
    entry.diskAllocatedBytes = Math.max(
      0,
      entry.diskCapacityBytes - (entry.facts["freeBytes"] as number),
    );
  }

  /*
   * Only a whole reading is written. Half of one would replace the whole one already on
   * the row, since facts merge key by key, and a used figure alone is a share of nothing.
   */
  for (const key of Object.keys(entry.quota || {})) {
    const reading: QuotaReading = entry.quota![key]!;
    if (reading.used !== undefined && reading.limit !== undefined) {
      entry.facts[key] = {
        used: reading.used,
        limit: reading.limit,
        observedAt: entry.observedAt.toISOString(),
      };
    }
  }

  if (entry.kind === OpenStackResourceKind.Network) {
    const subnets: JSONObject | undefined = entry.facts[
      "ipsBySubnet"
    ] as JSONObject;
    if (subnets) {
      /*
       * IPv4 alone when the network has any, as the alert templates read it. A /64 is
       * 2^64 addresses, so added to one a full IPv4 pool reads as 0% and an external
       * network out of addresses never needs anyone. Every dual-stack `public` network
       * on a real cloud is this.
       */
      const all: Array<JSONObject> = Object.values(
        subnets,
      ) as Array<JSONObject>;
      const ipv4: Array<JSONObject> = all.filter((subnet: JSONObject) => {
        return subnet["ipVersion"] !== "6";
      });
      let total: number = 0;
      let used: number = 0;
      for (const subnet of ipv4.length > 0 ? ipv4 : all) {
        total += (subnet["total"] as number) || 0;
        used += (subnet["used"] as number) || 0;
      }
      entry.facts["ipsTotal"] = total;
      entry.facts["ipsUsed"] = used;
    }
  }

  return entry;
}

/*
 * What needs more than one row: a batch's rows, finished and joined.
 *
 * Nova's hypervisor series say how big a hypervisor is and nothing about whether it
 * is alive, and they keep coming with the last numbers after its nova-compute stops.
 * So a hypervisor's state is its nova-compute's, which the same scrape carries. Nova
 * names one by its short host name and the other by its full one. Nor do the series
 * say which zone a hypervisor is in unless an aggregate put it there, and a cloud with
 * one zone has no such aggregate, but its nova-compute always knows.
 */
/*
 * The hosts a batch holds half of: a hypervisor's numbers with no nova-compute beside them, or a
 * nova-compute with no hypervisor. A collector that sends a large scrape in several batches can
 * part them, and then OpenStackResourceService.reconcileHypervisorStates joins them from the rows.
 * A batch that holds both of each, which is every small cloud's, has none, and costs nothing.
 */
export function getOpenStackHostsToReconcile(
  finished: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<string> {
  const hypervisors: Set<string> = new Set();
  const computes: Set<string> = new Set();

  for (const entry of finished) {
    if (entry.kind === OpenStackResourceKind.Hypervisor) {
      hypervisors.add(getOpenStackShortHostName(entry.hypervisorName));
    } else if (
      entry.kind === OpenStackResourceKind.Service &&
      entry.name === "nova-compute" &&
      typeof entry.facts["host"] === "string"
    ) {
      computes.add(getOpenStackShortHostName(entry.facts["host"] as string));
    }
  }

  const hosts: Array<string> = [];

  for (const host of hypervisors) {
    if (!computes.has(host)) {
      hosts.push(host);
    }
  }

  for (const host of computes) {
    if (!hypervisors.has(host)) {
      hosts.push(host);
    }
  }

  return hosts;
}

export interface OpenStackRouterWithoutAgents {
  externalId: string;
  // Its agents are gone if they were last heard before this.
  agentsReportedBefore: Date;
}

/*
 * The routers a batch heard from with no agent beside them, on any cloud: most clouds' are all of
 * them, because OVN has no L3 agents, and they have nothing to forget.
 */
export function getOpenStackRoutersWithoutAgents(
  finished: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<OpenStackRouterWithoutAgents> {
  const routers: Array<OpenStackRouterWithoutAgents> = [];

  for (const entry of finished) {
    if (
      entry.kind === OpenStackResourceKind.Router &&
      entry.routerSeenAt &&
      !entry.facts["l3Agents"]
    ) {
      routers.push({
        externalId: entry.externalId,
        agentsReportedBefore: new Date(
          entry.routerSeenAt.getTime() - ROUTER_AGENTS_GONE_AFTER_MS,
        ),
      });
    }
  }

  return routers;
}

/*
 * The hypervisors a batch held part of a Placement reading for: a total with its ratio or reserved
 * still to come, in another batch of the same scrape. OpenStackResourceService
 * .reconcileHypervisorCapacity works those out from the row's facts, which by then hold whatever
 * each batch brought. A batch that holds its readings whole, which is every small cloud's and every
 * probe's, has none, and costs nothing.
 */
export function getOpenStackHostsWithPartReadings(
  finished: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<string> {
  const hosts: Array<string> = [];

  for (const entry of finished) {
    if (entry.hasPartReading && entry.hypervisorName) {
      hosts.push(entry.hypervisorName);
    }
  }

  return hosts;
}

/*
 * Whether a datapoint of a cloud in summary mode goes on to the metric store. Its row has already
 * been folded by now, so this only decides whether it also keeps a series. Most datapoints are of
 * series summary mode has no say in, and those cost one set lookup.
 */
export function isOpenStackDatapointKept(data: {
  metricName: string;
  datapoint: JSONObject;
  keptProjectIds: ReadonlySet<string>;
}): boolean {
  if (!OPENSTACK_SUMMARY_MODE_SERIES.has(data.metricName)) {
    return true;
  }

  const attributes: JSONArray =
    (data.datapoint["attributes"] as JSONArray) || [];

  return isOpenStackSeriesKeptInSummaryMode({
    metricName: data.metricName,
    status: getLabel(attributes, "status"),
    projectId: getLabel(attributes, "tenant_id"),
    keptProjectIds: data.keptProjectIds,
  });
}

/*
 * Whether a batch holds anything a cluster's project can come from: a cluster or a stack. A batch
 * holds one service, and these are few, so most batches of most clouds answer no at no cost.
 */
export function hasOpenStackContainerClusterProjectToJoin(
  finished: ReadonlyArray<OpenStackResourceBufferEntry>,
): boolean {
  return finished.some((entry: OpenStackResourceBufferEntry): boolean => {
    return (
      entry.kind === OpenStackResourceKind.ContainerCluster ||
      entry.kind === OpenStackResourceKind.Stack
    );
  });
}

export function finishOpenStackBatch(
  entries: Iterable<OpenStackResourceBufferEntry>,
): Array<OpenStackResourceBufferEntry> {
  const finished: Array<OpenStackResourceBufferEntry> = Array.from(entries).map(
    finishOpenStackResource,
  );

  const hostKey: (region: string | null, host: string | null) => string = (
    region: string | null,
    host: string | null,
  ): string => {
    return `${region || ""}/${getOpenStackShortHostName(host)}`;
  };

  const computeByHost: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const entry of finished) {
    if (
      entry.kind === OpenStackResourceKind.Service &&
      entry.name === "nova-compute" &&
      typeof entry.facts["host"] === "string"
    ) {
      computeByHost.set(
        hostKey(entry.regionName, entry.facts["host"] as string),
        entry,
      );
    }
  }

  for (const entry of finished) {
    if (entry.kind !== OpenStackResourceKind.Hypervisor) {
      continue;
    }
    const compute: OpenStackResourceBufferEntry | undefined = computeByHost.get(
      hostKey(entry.regionName, entry.hypervisorName),
    );
    if (!compute) {
      continue;
    }
    entry.status = compute.status;
    entry.statusObservedAt = compute.statusObservedAt;
    entry.adminState = compute.adminState;
    entry.disabledReason = compute.disabledReason;
    entry.availabilityZone = entry.availabilityZone || compute.availabilityZone;
  }

  return finished;
}
