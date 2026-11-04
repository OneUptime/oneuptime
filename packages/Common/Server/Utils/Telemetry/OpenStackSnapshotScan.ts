import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import { getOpenStackShortHostName } from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import logger from "../Logger";

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
]);

/*
 * The prometheus receiver's own series for a scrape. `up` at 0 means the exporter
 * did not answer at all, which is what a failing service does to it today
 * (openstack-exporter issue 660). The agent's scrape jobs label each target with
 * the OpenStack service they ask for, so this says which service it was.
 */
export const OPENSTACK_SCRAPE_UP_METRIC_NAME: string = "up";
export const OPENSTACK_SERVICE_LABEL: string = "openstack_service";

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

const CINDER_POOL_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_cinder_pool_capacity_total_gb",
  "openstack_cinder_pool_capacity_free_gb",
]);

const NETWORK_IP_METRIC_NAMES: ReadonlySet<string> = new Set([
  "openstack_neutron_network_ip_availabilities_total",
  "openstack_neutron_network_ip_availabilities_used",
]);

export const OPENSTACK_SNAPSHOT_METRIC_NAMES: ReadonlySet<string> = new Set([
  ...OPENSTACK_API_UP_METRIC_NAMES.keys(),
  ...PLACEMENT_RESOURCE_METRIC_NAMES,
  ...CINDER_POOL_METRIC_NAMES,
  ...NETWORK_IP_METRIC_NAMES,
  "openstack_nova_agent_state",
  "openstack_neutron_agent_state",
  "openstack_cinder_agent_state",
  "openstack_nova_server_status",
  "openstack_nova_flavor",
  "openstack_nova_vcpus_available",
  "openstack_nova_vcpus_used",
  "openstack_nova_memory_available_bytes",
  "openstack_nova_memory_used_bytes",
  "openstack_nova_local_storage_available_bytes",
  "openstack_nova_local_storage_used_bytes",
  "openstack_nova_running_vms",
  "openstack_cinder_volume_gb",
  "openstack_cinder_snapshot_gb",
  "openstack_glance_image_bytes",
  "openstack_glance_image_created_at",
  "openstack_neutron_network",
  "openstack_neutron_subnet",
  "openstack_neutron_router",
  "openstack_neutron_l3_agent_of_router",
  "openstack_neutron_floating_ip",
  "openstack_identity_project_info",
  "openstack_identity_domain_info",
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
  if (data.metricName === OPENSTACK_SCRAPE_UP_METRIC_NAME) {
    const attributes: JSONArray =
      (data.datapoint["attributes"] as JSONArray) || [];
    return getLabel(attributes, OPENSTACK_SERVICE_LABEL) !== null;
  }
  return OPENSTACK_SNAPSHOT_METRIC_NAMES.has(data.metricName);
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
  facts: JSONObject;
  observedAt: Date;
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
   * The time of the last good read, which the stale-row rule measures from: a part
   * is gone only when its service answered after the part was last seen. Written
   * only when up, because facts merge key by key and a null would erase it.
   */
  if (data.isUp) {
    entry.facts["vouchedAt"] = data.observedAt.toISOString();
  }
}

const SERVICE_FAMILY_BY_METRIC: ReadonlyMap<string, OpenStackServiceFamily> =
  new Map<string, OpenStackServiceFamily>([
    ["openstack_nova_agent_state", OpenStackServiceFamily.Compute],
    ["openstack_neutron_agent_state", OpenStackServiceFamily.Network],
    ["openstack_cinder_agent_state", OpenStackServiceFamily.Volume],
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
  setStatus(
    entry,
    data.value > 0
      ? OPENSTACK_SERVICE_STATUS_UP
      : OPENSTACK_SERVICE_STATUS_DOWN,
    data.observedAt,
  );
  entry.adminState = getLabel(data.attributes, "adminState") ?? entry.adminState;
  entry.disabledReason =
    getLabel(data.attributes, "disabledReason") ?? entry.disabledReason;
  setFact(entry, "family", data.family);
  setFact(entry, "host", host);
  // Which row of Neutron's agents it is: a router names the agents that hold it by this.
  setFact(
    entry,
    "agentId",
    getLabel(data.attributes, "id") || getLabel(data.attributes, "uuid"),
  );
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
  setFact(entry, "aggregates", getLabel(data.attributes, "aggregates"));

  if (PLACEMENT_RESOURCE_METRIC_NAMES.has(data.metricName)) {
    const resource: string | null = getLabel(data.attributes, "resourcetype");
    if (!resource) {
      return;
    }
    const reading: PlacementReading = entry.placement[resource] || {};
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
    entry.placement[resource] = reading;
    return;
  }

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
  setFact(entry, "attachedToInstance", getLabel(data.attributes, "server_id"));
  setBooleanFact(entry, "isBootable", getLabel(data.attributes, "bootable"));
  setFact(entry, "updatedAt", getLabel(data.attributes, "updated_at"));
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
  const adminUp: string | null = getLabel(data.attributes, "admin_state_up");
  if (adminUp !== null) {
    entry.adminState = adminUp === "true" ? "up" : "down";
  }
  setFact(
    entry,
    "externalNetworkId",
    getLabel(data.attributes, "external_network_id"),
  );
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
  const region: string | null = getLabel(attributes, OPENSTACK_REGION_ATTRIBUTE);
  const { metricName, buffer } = data;

  if (metricName === OPENSTACK_SCRAPE_UP_METRIC_NAME) {
    const service: string | null = getLabel(attributes, OPENSTACK_SERVICE_LABEL);
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
    foldHypervisor({ buffer, metricName, attributes, region, value, observedAt });
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
    case "openstack_cinder_volume_gb":
      foldVolume({ buffer, attributes, region, value, observedAt });
      return;
    case "openstack_cinder_snapshot_gb":
      foldSnapshot({ buffer, attributes, region, value, observedAt });
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
    default:
      return;
  }
}

/*
 * (total - reserved) * allocation ratio is what Placement will promise, and usage
 * is what it has promised. Nova's own vcpus_available ignored ratios and stopped
 * being reported at microversion 2.88, so Placement wins when it answered.
 */
function placementCapacity(reading: PlacementReading | undefined): {
  capacity: number | null;
  usage: number | null;
} {
  if (!reading || reading.total === undefined) {
    return { capacity: null, usage: reading?.usage ?? null };
  }
  const usable: number = Math.max(0, reading.total - (reading.reserved ?? 0));
  return {
    capacity: usable * (reading.ratio ?? 1),
    usage: reading.usage ?? null,
  };
}

/*
 * Turn a folded entry into the row to write: everything that needs several series
 * together is decided here, after the whole batch has been read.
 */
export function finishOpenStackResource(
  entry: OpenStackResourceBufferEntry,
): OpenStackResourceBufferEntry {
  if (entry.kind === OpenStackResourceKind.Hypervisor) {
    const vcpu: { capacity: number | null; usage: number | null } =
      placementCapacity(entry.placement["VCPU"]);
    const memory: { capacity: number | null; usage: number | null } =
      placementCapacity(entry.placement["MEMORY_MB"]);
    const disk: { capacity: number | null; usage: number | null } =
      placementCapacity(entry.placement["DISK_GB"]);

    if (vcpu.capacity !== null) {
      entry.vcpuCapacity = vcpu.capacity;
    } else if (
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
    } else if (entry.facts["novaMemoryAvailableBytes"] !== undefined) {
      entry.memoryCapacityBytes = entry.facts[
        "novaMemoryAvailableBytes"
      ] as number;
    }
    if (memory.usage !== null) {
      entry.memoryAllocatedBytes = memory.usage * BYTES_PER_MIB;
    }

    if (disk.capacity !== null) {
      entry.diskCapacityBytes = disk.capacity * BYTES_PER_GIB;
    } else if (entry.facts["novaDiskAvailableBytes"] !== undefined) {
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

  if (entry.kind === OpenStackResourceKind.Network) {
    const subnets: JSONObject | undefined = entry.facts[
      "ipsBySubnet"
    ] as JSONObject;
    if (subnets) {
      let total: number = 0;
      let used: number = 0;
      for (const subnet of Object.values(subnets)) {
        total += ((subnet as JSONObject)["total"] as number) || 0;
        used += ((subnet as JSONObject)["used"] as number) || 0;
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
export function finishOpenStackBatch(
  entries: Iterable<OpenStackResourceBufferEntry>,
): Array<OpenStackResourceBufferEntry> {
  const finished: Array<OpenStackResourceBufferEntry> = Array.from(entries).map(
    finishOpenStackResource,
  );

  const hostKey = (region: string | null, host: string | null): string => {
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
