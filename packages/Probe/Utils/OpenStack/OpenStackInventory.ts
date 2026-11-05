import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackFlavorRequest,
  OpenStackPlacementAnswer,
  getOpenStackFlavorRequest,
} from "Common/Types/OpenStack/OpenStackCapacity";

/*
 * What the collectors read, reduced to what the series need. Each API's answer is far
 * larger than this: a server's holds its whole flavor and every link, a hypervisor's
 * its CPU's feature list. Keeping only these fields is what lets the instance list be
 * held between collections on a large cloud without the probe's memory growing with
 * everything Nova says.
 *
 * Field names are OpenStack's own where they can be, so a record reads against the API
 * reference. A field a service did not send is null, never a guess: the series builder
 * decides what the exporter would have done with one.
 */

function text(value: JSONValue | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  // Older microversions spell some ids as numbers, and the series are all text.
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function numeric(value: JSONValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function strings(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: Array<string> = [];

  for (const item of value as Array<JSONValue>) {
    const itemText: string | null = text(item);

    if (itemText !== null) {
      items.push(itemText);
    }
  }

  return items;
}

function object(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// Keystone.

export interface KeystoneDomainRecord {
  id: string | null;
  name: string | null;
  description: string | null;
  enabled: boolean;
}

export function toKeystoneDomain(item: JSONObject): KeystoneDomainRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    description: text(item["description"]),
    enabled: item["enabled"] === true,
  };
}

export interface KeystoneProjectRecord {
  id: string | null;
  name: string | null;
  description: string | null;
  domainId: string | null;
  parentId: string | null;
  enabled: boolean;
  isDomain: boolean;
  tags: Array<string>;
}

export function toKeystoneProject(item: JSONObject): KeystoneProjectRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    description: text(item["description"]),
    domainId: text(item["domain_id"]),
    parentId: text(item["parent_id"]),
    enabled: item["enabled"] === true,
    isDomain: item["is_domain"] === true,
    tags: strings(item["tags"]),
  };
}

// Nova.

export interface NovaServiceRecord {
  id: string | null;
  binary: string | null;
  host: string | null;
  zone: string | null;
  status: string | null;
  state: string | null;
  disabledReason: string | null;
  // Whether an operator told Nova it is down. Null before microversion 2.11, which says nothing.
  forcedDown: boolean | null;
}

export function toNovaService(item: JSONObject): NovaServiceRecord {
  const forcedDown: JSONValue | undefined = item["forced_down"];

  return {
    id: text(item["id"]),
    binary: text(item["binary"]),
    host: text(item["host"]),
    zone: text(item["zone"]),
    status: text(item["status"]),
    state: text(item["state"]),
    disabledReason: text(item["disabled_reason"]),
    forcedDown: typeof forcedDown === "boolean" ? forcedDown : null,
  };
}

export interface NovaHypervisorRecord {
  hostname: string | null;
  serviceHost: string | null;
  // These are null from microversion 2.88, when capacity moved to Placement.
  runningVms: number | null;
  currentWorkload: number | null;
  vcpus: number | null;
  vcpusUsed: number | null;
  memoryMb: number | null;
  memoryMbUsed: number | null;
  localGb: number | null;
  localGbUsed: number | null;
  freeDiskGb: number | null;
}

/*
 * The vCPUs a hypervisor has. The exporter prefers what its CPU's topology adds up to
 * over the plain `vcpus`, whenever there is a topology, so this does too. Before
 * microversion 2.28 cpu_info is a JSON string.
 */
function readVcpus(item: JSONObject): number | null {
  let cpuInfo: JSONValue | undefined = item["cpu_info"];

  if (typeof cpuInfo === "string") {
    try {
      cpuInfo = JSON.parse(cpuInfo) as JSONValue;
    } catch {
      cpuInfo = undefined;
    }
  }

  const info: JSONObject = object(cpuInfo);

  if (Object.keys(info).length > 0) {
    const topology: JSONObject = object(info["topology"]);

    return (
      Math.max(numeric(topology["cells"]) ?? 0, 1) *
      (numeric(topology["sockets"]) ?? 0) *
      (numeric(topology["cores"]) ?? 0) *
      (numeric(topology["threads"]) ?? 0)
    );
  }

  return numeric(item["vcpus"]);
}

export function toNovaHypervisor(item: JSONObject): NovaHypervisorRecord {
  return {
    hostname: text(item["hypervisor_hostname"]),
    serviceHost: text(object(item["service"])["host"]),
    runningVms: numeric(item["running_vms"]),
    currentWorkload: numeric(item["current_workload"]),
    vcpus: readVcpus(item),
    vcpusUsed: numeric(item["vcpus_used"]),
    memoryMb: numeric(item["memory_mb"]),
    memoryMbUsed: numeric(item["memory_mb_used"]),
    localGb: numeric(item["local_gb"]),
    localGbUsed: numeric(item["local_gb_used"]),
    freeDiskGb: numeric(item["free_disk_gb"]),
  };
}

export interface NovaAggregateRecord {
  name: string | null;
  availabilityZone: string | null;
  hosts: Array<string>;
  // Only here to set an availability zone, and not a group anyone made.
  isZoneOnly: boolean;
}

export function toNovaAggregate(item: JSONObject): NovaAggregateRecord {
  const metadataKeys: Array<string> = Object.keys(object(item["metadata"]));

  return {
    name: text(item["name"]),
    availabilityZone: text(item["availability_zone"]),
    hosts: strings(item["hosts"]),
    isZoneOnly:
      metadataKeys.length === 1 && metadataKeys[0] === "availability_zone",
  };
}

export interface NovaFlavorRecord {
  id: string | null;
  name: string | null;
  vcpus: number | null;
  ram: number | null;
  disk: number | null;
  isPublic: boolean;
  isDisabled: boolean;
  // What Nova would ask Placement for one of these, with what only its extra specs say.
  request: OpenStackFlavorRequest;
}

export function toNovaFlavor(item: JSONObject): NovaFlavorRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    vcpus: numeric(item["vcpus"]),
    ram: numeric(item["ram"]),
    disk: numeric(item["disk"]),
    isPublic: item["os-flavor-access:is_public"] === true,
    isDisabled: item["OS-FLV-DISABLED:disabled"] === true,
    request: getOpenStackFlavorRequest({
      vcpus: numeric(item["vcpus"]),
      ramMib: numeric(item["ram"]),
      diskGib: numeric(item["disk"]),
      ephemeralGib: numeric(item["OS-FLV-EXT-DATA:ephemeral"]),
      // An older Nova says an empty string for none.
      swapMib: numeric(item["swap"]),
      extraSpecs: object(item["extra_specs"]),
    }),
  };
}

export interface NovaServerRecord {
  id: string;
  name: string | null;
  status: string | null;
  tenantId: string | null;
  userId: string | null;
  // The address a person reaches it at: see readServerAddress.
  addressIpv4: string | null;
  addressIpv6: string | null;
  // The networks it has an address on, by name, which is all a server says of them.
  networkNames: Array<string>;
  hostId: string | null;
  hypervisorHostname: string | null;
  availabilityZone: string | null;
  // From microversion 2.47 a server names its flavor and carries no id for it.
  flavorId: string | null;
  flavorName: string | null;
  instanceName: string | null;
  // The image it booted from. One booted from a volume has none: Nova says "" there.
  imageId: string | null;
  // What only a native collector reads: see OPENSTACK_PROBE_ONLY_LABELS.
  taskState: string | null;
  updatedAt: string | null;
  faultMessage: string | null;
}

/*
 * The address a person reaches a server at. accessIPv4 and accessIPv6 are for someone to say
 * exactly that, and nobody does: every recording has them empty, which is all the exporter
 * reads. What it really has is in `addresses`, network by network, so that is read when they
 * are empty.
 *
 * A floating address before a fixed one, because it is the one reachable from outside. And in
 * the order of the networks' names, because this goes on a series as a label: the same server
 * has to say the same address from one collection to the next, however Nova listed them.
 */
function readServerAddress(
  item: JSONObject,
  accessField: string,
  version: number,
): string | null {
  const access: string | null = text(item[accessField]);

  if (access) {
    return access;
  }

  const networks: JSONObject = object(item["addresses"]);
  let fixed: string | null = null;

  for (const network of Object.keys(networks).sort()) {
    const entries: JSONValue = networks[network] as JSONValue;

    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries as Array<JSONValue>) {
      const address: JSONObject = object(entry);
      const value: string | null = text(address["addr"]);

      if (!value || numeric(address["version"]) !== version) {
        continue;
      }

      if (address["OS-EXT-IPS:type"] === "floating") {
        return value;
      }

      fixed = fixed || value;
    }
  }

  return fixed;
}

export function toNovaServer(item: JSONObject): NovaServerRecord | null {
  const id: string | null = text(item["id"]);

  if (!id) {
    return null;
  }

  const flavor: JSONObject = object(item["flavor"]);

  return {
    id: id,
    name: text(item["name"]),
    status: text(item["status"]),
    tenantId: text(item["tenant_id"]),
    userId: text(item["user_id"]),
    addressIpv4: readServerAddress(item, "accessIPv4", 4),
    addressIpv6: readServerAddress(item, "accessIPv6", 6),
    networkNames: Object.keys(object(item["addresses"])).sort(),
    hostId: text(item["hostId"]),
    hypervisorHostname: text(item["OS-EXT-SRV-ATTR:hypervisor_hostname"]),
    availabilityZone: text(item["OS-EXT-AZ:availability_zone"]),
    flavorId: text(flavor["id"]),
    flavorName: text(flavor["original_name"]),
    instanceName: text(item["OS-EXT-SRV-ATTR:instance_name"]),
    imageId: text(object(item["image"])["id"]),
    taskState: text(item["OS-EXT-STS:task_state"]),
    updatedAt: text(item["updated"]),
    // Only its message: `details` is a traceback, and stays with Nova.
    faultMessage: text(object(item["fault"])["message"]),
  };
}

export interface NovaQuotaRecord {
  projectId: string;
  projectName: string | null;
  quotas: Record<string, NovaQuotaDetail>;
}

export interface NovaQuotaDetail {
  inUse: number;
  reserved: number;
  limit: number;
}

export interface NovaLimitsRecord {
  projectId: string;
  projectName: string | null;
  maxTotalCores: number | null;
  totalCoresUsed: number | null;
  maxTotalRAMSize: number | null;
  totalRAMUsed: number | null;
  maxTotalInstances: number | null;
  totalInstancesUsed: number | null;
}

// Placement.

export interface PlacementInventoryRecord {
  resourceClass: string;
  total: number | null;
  reserved: number | null;
  allocationRatio: number | null;
}

export interface PlacementAllocationRecord {
  consumerId: string;
  resourceClass: string;
  amount: number;
}

export interface PlacementProviderRecord {
  uuid: string;
  name: string | null;
  generation: number | null;
  inventories?: Array<PlacementInventoryRecord> | undefined;
  usages?: Record<string, number> | undefined;
  allocations?: Array<PlacementAllocationRecord> | undefined;
}

// Neutron.

export interface NeutronAgentRecord {
  id: string | null;
  binary: string | null;
  host: string | null;
  availabilityZone: string | null;
  isAlive: boolean;
  isAdminUp: boolean;
}

export function toNeutronAgent(item: JSONObject): NeutronAgentRecord {
  return {
    id: text(item["id"]),
    binary: text(item["binary"]),
    host: text(item["host"]),
    availabilityZone: text(item["availability_zone"]),
    isAlive: item["alive"] === true,
    isAdminUp: item["admin_state_up"] === true,
  };
}

export interface NeutronNetworkRecord {
  id: string | null;
  name: string | null;
  tenantId: string | null;
  status: string | null;
  isShared: boolean;
  isExternal: boolean;
  networkType: string | null;
  physicalNetwork: string | null;
  segmentationId: string | null;
  subnets: Array<string>;
  tags: Array<string>;
  mtu: number;
}

export function toNeutronNetwork(item: JSONObject): NeutronNetworkRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    tenantId: text(item["tenant_id"]) ?? text(item["project_id"]),
    status: text(item["status"]),
    isShared: item["shared"] === true,
    isExternal: item["router:external"] === true,
    networkType: text(item["provider:network_type"]),
    physicalNetwork: text(item["provider:physical_network"]),
    segmentationId: text(item["provider:segmentation_id"]),
    subnets: strings(item["subnets"]),
    tags: strings(item["tags"]),
    mtu: numeric(item["mtu"]) ?? 0,
  };
}

export interface NeutronSubnetRecord {
  id: string | null;
  name: string | null;
  tenantId: string | null;
  networkId: string | null;
  cidr: string | null;
  gatewayIp: string | null;
  enableDhcp: boolean;
  dnsNameservers: Array<string>;
  tags: Array<string>;
}

export function toNeutronSubnet(item: JSONObject): NeutronSubnetRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    tenantId: text(item["tenant_id"]) ?? text(item["project_id"]),
    networkId: text(item["network_id"]),
    cidr: text(item["cidr"]),
    gatewayIp: text(item["gateway_ip"]),
    enableDhcp: item["enable_dhcp"] === true,
    dnsNameservers: strings(item["dns_nameservers"]),
    tags: strings(item["tags"]),
  };
}

export interface NeutronRouterRecord {
  id: string | null;
  name: string | null;
  projectId: string | null;
  status: string | null;
  isAdminUp: boolean;
  externalNetworkId: string | null;
}

export function toNeutronRouter(item: JSONObject): NeutronRouterRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    projectId: text(item["project_id"]) ?? text(item["tenant_id"]),
    status: text(item["status"]),
    isAdminUp: item["admin_state_up"] === true,
    externalNetworkId: text(
      object(item["external_gateway_info"])["network_id"],
    ),
  };
}

export interface NeutronL3AgentRecord {
  routerId: string;
  agentId: string | null;
  host: string | null;
  haState: string | null;
  isAlive: boolean;
  isAdminUp: boolean;
}

// The networks one DHCP agent serves, which is all that is kept of Neutron's answer.
export interface NeutronDhcpAgentNetworksRecord {
  agentId: string;
  networkIds: Array<string>;
}

export interface NeutronFloatingIpRecord {
  id: string | null;
  address: string | null;
  networkId: string | null;
  routerId: string | null;
  portId: string | null;
  fixedIp: string | null;
  status: string | null;
  projectId: string | null;
}

export function toNeutronFloatingIp(item: JSONObject): NeutronFloatingIpRecord {
  return {
    id: text(item["id"]),
    address: text(item["floating_ip_address"]),
    networkId: text(item["floating_network_id"]),
    routerId: text(item["router_id"]),
    portId: text(item["port_id"]),
    fixedIp: text(item["fixed_ip_address"]),
    status: text(item["status"]),
    projectId: text(item["project_id"]) ?? text(item["tenant_id"]),
  };
}

export interface NeutronSubnetAvailabilityRecord {
  networkId: string | null;
  networkName: string | null;
  projectId: string | null;
  ipVersion: number | null;
  cidr: string | null;
  subnetName: string | null;
  totalIps: number | null;
  usedIps: number | null;
}

export function toNeutronSubnetAvailabilities(
  item: JSONObject,
): Array<NeutronSubnetAvailabilityRecord> {
  const subnets: Array<JSONObject> = Array.isArray(
    item["subnet_ip_availability"],
  )
    ? (item["subnet_ip_availability"] as Array<JSONObject>)
    : [];

  const records: Array<NeutronSubnetAvailabilityRecord> = [];

  for (const subnet of subnets) {
    records.push({
      networkId: text(item["network_id"]),
      networkName: text(item["network_name"]),
      projectId: text(item["project_id"]) || text(item["tenant_id"]),
      ipVersion: numeric(subnet["ip_version"]),
      cidr: text(subnet["cidr"]),
      subnetName: text(subnet["subnet_name"]),
      /*
       * An IPv6 subnet holds more addresses than a double counts exactly, which is
       * what the exporter's series say too (1.8446744073709552e+19).
       */
      totalIps: numeric(subnet["total_ips"]),
      usedIps: numeric(subnet["used_ips"]),
    });
  }

  return records;
}

export interface NeutronPortRecord {
  id: string | null;
  networkId: string | null;
  macAddress: string | null;
  deviceOwner: string | null;
  deviceId: string | null;
  status: string | null;
  vifType: string | null;
  isAdminUp: boolean;
  fixedIps: Array<string>;
}

export function toNeutronPort(item: JSONObject): NeutronPortRecord {
  const fixedIps: Array<string> = [];

  if (Array.isArray(item["fixed_ips"])) {
    for (const fixedIp of item["fixed_ips"] as Array<JSONObject>) {
      const address: string | null = text(object(fixedIp)["ip_address"]);

      if (address) {
        fixedIps.push(address);
      }
    }
  }

  return {
    id: text(item["id"]),
    networkId: text(item["network_id"]),
    macAddress: text(item["mac_address"]),
    deviceOwner: text(item["device_owner"]),
    deviceId: text(item["device_id"]),
    status: text(item["status"]),
    vifType: text(item["binding:vif_type"]),
    isAdminUp: item["admin_state_up"] === true,
    fixedIps: fixedIps,
  };
}

export interface NeutronVpnServiceRecord {
  id: string | null;
  projectId: string | null;
  subnetId: string | null;
  routerId: string | null;
  isAdminUp: boolean;
  name: string | null;
  externalIpv4: string | null;
  externalIpv6: string | null;
  flavorId: string | null;
  status: string | null;
}

export function toNeutronVpnService(item: JSONObject): NeutronVpnServiceRecord {
  return {
    id: text(item["id"]),
    projectId: text(item["project_id"]) ?? text(item["tenant_id"]),
    subnetId: text(item["subnet_id"]),
    routerId: text(item["router_id"]),
    isAdminUp: item["admin_state_up"] === true,
    name: text(item["name"]),
    externalIpv4: text(item["external_v4_ip"]),
    externalIpv6: text(item["external_v6_ip"]),
    flavorId: text(item["flavor_id"]),
    status: text(item["status"]),
  };
}

export interface NeutronVpnConnectionRecord {
  id: string | null;
  projectId: string | null;
  isAdminUp: boolean;
  name: string | null;
  vpnServiceId: string | null;
  ikePolicyId: string | null;
  ipsecPolicyId: string | null;
  peerId: string | null;
  peerEndpointGroupId: string | null;
  localId: string | null;
  localEndpointGroupId: string | null;
  status: string | null;
}

export function toNeutronVpnConnection(
  item: JSONObject,
): NeutronVpnConnectionRecord {
  return {
    id: text(item["id"]),
    projectId: text(item["project_id"]) ?? text(item["tenant_id"]),
    isAdminUp: item["admin_state_up"] === true,
    name: text(item["name"]),
    vpnServiceId: text(item["vpnservice_id"]),
    ikePolicyId: text(item["ikepolicy_id"]),
    ipsecPolicyId: text(item["ipsecpolicy_id"]),
    peerId: text(item["peer_id"]),
    peerEndpointGroupId: text(item["peer_ep_group_id"]),
    localId: text(item["local_id"]),
    localEndpointGroupId: text(item["local_ep_group_id"]),
    status: text(item["status"]),
  };
}

export interface NeutronQuotaRecord {
  projectId: string;
  projectName: string | null;
  quotas: Record<string, NeutronQuotaDetail>;
}

export interface NeutronQuotaDetail {
  used: number;
  reserved: number;
  limit: number;
}

// Cinder.

export interface CinderServiceRecord {
  binary: string | null;
  host: string | null;
  zone: string | null;
  status: string | null;
  state: string | null;
  disabledReason: string | null;
}

export function toCinderService(item: JSONObject): CinderServiceRecord {
  return {
    binary: text(item["binary"]),
    host: text(item["host"]),
    zone: text(item["zone"]),
    status: text(item["status"]),
    state: text(item["state"]),
    disabledReason: text(item["disabled_reason"]),
  };
}

export interface CinderPoolRecord {
  name: string | null;
  backendName: string | null;
  vendorName: string | null;
  // What Cinder's driver says of itself: `ceph`, and where the pool is, for RBD.
  storageProtocol: string | null;
  locationInfo: string | null;
  freeCapacityGb: number | null;
  totalCapacityGb: number | null;
}

export function toCinderPool(item: JSONObject): CinderPoolRecord {
  const capabilities: JSONObject = object(item["capabilities"]);

  return {
    name: text(item["name"]),
    backendName: text(capabilities["volume_backend_name"]),
    vendorName: text(capabilities["vendor_name"]),
    storageProtocol: text(capabilities["storage_protocol"]),
    locationInfo: text(capabilities["location_info"]),
    /*
     * A backend can say "unknown" or "infinite" instead of a number, and neither is a
     * capacity to chart, so those read as nothing rather than as a full pool.
     */
    freeCapacityGb: numeric(capabilities["free_capacity_gb"]),
    totalCapacityGb: numeric(capabilities["total_capacity_gb"]),
  };
}

export interface CinderVolumeRecord {
  id: string | null;
  name: string | null;
  status: string | null;
  availabilityZone: string | null;
  bootable: string | null;
  tenantId: string | null;
  userId: string | null;
  volumeType: string | null;
  serverId: string | null;
  /*
   * The pool that holds it, in the name Cinder's pool list gives that pool: "host@backend#pool".
   * Only a credential Cinder treats as an admin is told this, and a volume not scheduled yet
   * has none.
   */
  poolName: string | null;
  // The image it was made from, which that image is in use for as long as this volume lasts.
  imageId: string | null;
  sizeGb: number | null;
  updatedAt: string | null;
}

export function toCinderVolume(item: JSONObject): CinderVolumeRecord {
  const attachments: Array<JSONObject> = Array.isArray(item["attachments"])
    ? (item["attachments"] as Array<JSONObject>)
    : [];

  return {
    id: text(item["id"]),
    name: text(item["name"]),
    status: text(item["status"]),
    availabilityZone: text(item["availability_zone"]),
    bootable: text(item["bootable"]),
    tenantId: text(item["os-vol-tenant-attr:tenant_id"]),
    userId: text(item["user_id"]),
    volumeType: text(item["volume_type"]),
    serverId: attachments[0] ? text(object(attachments[0])["server_id"]) : null,
    poolName: text(item["os-vol-host-attr:host"]),
    imageId: text(object(item["volume_image_metadata"])["image_id"]),
    sizeGb: numeric(item["size"]),
    updatedAt: text(item["updated_at"]),
  };
}

export interface CinderSnapshotRecord {
  id: string | null;
  name: string | null;
  status: string | null;
  tenantId: string | null;
  volumeId: string | null;
  sizeGb: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function toCinderSnapshot(item: JSONObject): CinderSnapshotRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    status: text(item["status"]),
    tenantId: text(item["os-extended-snapshot-attributes:project_id"]),
    volumeId: text(item["volume_id"]),
    sizeGb: numeric(item["size"]),
    createdAt: text(item["created_at"]),
    updatedAt: text(item["updated_at"]),
  };
}

export interface CinderBackupRecord {
  id: string | null;
  name: string | null;
  status: string | null;
  tenantId: string | null;
  volumeId: string | null;
  availabilityZone: string | null;
  isIncremental: boolean;
  sizeGb: number | null;
  updatedAt: string | null;
}

export function toCinderBackup(item: JSONObject): CinderBackupRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    status: text(item["status"]),
    tenantId: text(item["os-backup-project-attr:project_id"]),
    volumeId: text(item["volume_id"]),
    availabilityZone: text(item["availability_zone"]),
    isIncremental: item["is_incremental"] === true,
    sizeGb: numeric(item["size"]),
    updatedAt: text(item["updated_at"]),
  };
}

export interface CinderLimitsRecord {
  projectId: string;
  projectName: string | null;
  volumeMaxGb: number | null;
  volumeUsedGb: number | null;
  backupMaxGb: number | null;
  backupUsedGb: number | null;
  typeQuotaGb: Record<string, number>;
}

// Glance.

export interface GlanceImageRecord {
  id: string | null;
  name: string | null;
  owner: string | null;
  sizeBytes: number;
  status: string | null;
  visibility: string | null;
  isHidden: boolean;
  // Someone said to keep it, which a list of what could go has to respect.
  isProtected: boolean;
  imageType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export function toGlanceImage(item: JSONObject): GlanceImageRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    owner: text(item["owner"]),
    // An image still queued has no size yet, and the exporter says 0 for it.
    sizeBytes: numeric(item["size"]) ?? 0,
    status: text(item["status"]),
    visibility: text(item["visibility"]),
    isHidden: item["os_hidden"] === true,
    isProtected: item["protected"] === true,
    imageType: text(item["image_type"]),
    createdAt: text(item["created_at"]),
    updatedAt: text(item["updated_at"]),
  };
}

/*
 * A stack as Heat's list says it. `project` is there for an admin, recorded on a real cloud, and
 * anything less gets its own project's stacks without it. Its reason is what Heat recorded about its
 * last action, in its own words, and `parent` is the stack it is nested in, which a plain list leaves
 * out, but a list can be asked for them.
 */
export interface HeatStackRecord {
  id: string | null;
  name: string | null;
  projectId: string | null;
  status: string | null;
  statusReason: string | null;
  parentId: string | null;
}

export function toHeatStack(item: JSONObject): HeatStackRecord {
  return {
    id: text(item["id"]),
    name: text(item["stack_name"]),
    projectId: text(item["project"]),
    status: text(item["stack_status"]),
    statusReason: text(item["stack_status_reason"]),
    parentId: text(item["parent"]),
  };
}

// One heat-engine process, as Heat lists them: several to a host, recorded two.
export interface HeatEngineRecord {
  id: string | null;
  host: string | null;
  binary: string | null;
  isUp: boolean;
}

export function toHeatEngine(item: JSONObject): HeatEngineRecord {
  return {
    id: text(item["engine_id"]) || text(item["id"]),
    host: text(item["hostname"]) || text(item["host"]),
    binary: text(item["binary"]),
    isUp: text(item["status"]) === "up",
  };
}

/*
 * A cluster as Magnum's list says it, then what its own read adds. The list has no project, no reason
 * and no version, recorded on every scene, which is why the exporter has no project for one either.
 */
export interface MagnumClusterRecord {
  uuid: string | null;
  name: string | null;
  stackId: string | null;
  status: string | null;
  healthStatus: string | null;
  nodeCount: number | null;
  masterCount: number | null;
  clusterTemplateId: string | null;
  clusterTemplateName?: string | undefined;
  // From a cluster's own read, when one has been made.
  projectId?: string | null | undefined;
  statusReason?: string | null | undefined;
  coeVersion?: string | null | undefined;
  apiAddress?: string | null | undefined;
}

export function toMagnumCluster(item: JSONObject): MagnumClusterRecord {
  return {
    uuid: text(item["uuid"]),
    name: text(item["name"]),
    stackId: text(item["stack_id"]),
    status: text(item["status"]),
    healthStatus: text(item["health_status"]),
    nodeCount: numeric(item["node_count"]),
    masterCount: numeric(item["master_count"]),
    clusterTemplateId: text(item["cluster_template_id"]),
  };
}

// What a cluster's own read says that its list doesn't.
export interface MagnumClusterDetails {
  // The status it was read at: a change of status is what makes it worth reading again.
  status: string | null;
  projectId: string | null;
  statusReason: string | null;
  coeVersion: string | null;
  apiAddress: string | null;
}

export function toMagnumClusterDetails(body: JSONObject): MagnumClusterDetails {
  return {
    status: text(body["status"]),
    projectId: text(body["project_id"]),
    statusReason: text(body["status_reason"]),
    coeVersion: text(body["coe_version"]),
    apiAddress: text(body["api_address"]),
  };
}

export interface MagnumConductorRecord {
  host: string | null;
  binary: string | null;
  isUp: boolean;
  isDisabled: boolean;
  disabledReason: string | null;
}

export function toMagnumConductor(item: JSONObject): MagnumConductorRecord {
  return {
    host: text(item["host"]),
    binary: text(item["binary"]),
    isUp: text(item["state"]) === "up",
    isDisabled: item["disabled"] === true,
    disabledReason: text(item["disabled_reason"]),
  };
}

/*
 * A share as Manila's list says it at the microversion it is asked at. Its type's name and its access
 * rules' status are only there at one, and its backend's host only for an admin. A share nothing placed
 * has no zone and no host, recorded.
 */
export interface ManilaShareRecord {
  id: string | null;
  name: string | null;
  projectId: string | null;
  status: string | null;
  sizeGb: number | null;
  availabilityZone: string | null;
  protocol: string | null;
  shareTypeName: string | null;
  accessRulesStatus: string | null;
  host: string | null;
}

export function toManilaShare(item: JSONObject): ManilaShareRecord {
  return {
    id: text(item["id"]),
    name: text(item["name"]),
    projectId: text(item["project_id"]),
    status: text(item["status"]),
    sizeGb: numeric(item["size"]),
    availabilityZone: text(item["availability_zone"]),
    protocol: text(item["share_proto"]),
    shareTypeName: text(item["share_type_name"]),
    accessRulesStatus: text(item["access_rules_status"]),
    host: text(item["host"]),
  };
}

// One Manila service, one to each of a host's backends. Its state is Manila's own word for it.
export interface ManilaServiceRecord {
  host: string | null;
  binary: string | null;
  zone: string | null;
  state: string | null;
  isDisabled: boolean;
}

export function toManilaService(item: JSONObject): ManilaServiceRecord {
  return {
    host: text(item["host"]),
    binary: text(item["binary"]),
    zone: text(item["zone"]),
    state: text(item["state"]),
    isDisabled: text(item["status"]) === "disabled",
  };
}

/*
 * One region's reading of each service. A field left undefined was not read, or could
 * not be, and its series are left out: never reported as zero, because zero is an
 * answer and a failed read is not.
 */

export interface OpenStackIdentityInventory {
  domains?: Array<KeystoneDomainRecord> | undefined;
  projects?: Array<KeystoneProjectRecord> | undefined;
  regionCount?: number | undefined;
  userCount?: number | undefined;
  groupCount?: number | undefined;
}

export interface OpenStackComputeInventory {
  microversion?: string | null | undefined;
  services?: Array<NovaServiceRecord> | undefined;
  hypervisors?: Array<NovaHypervisorRecord> | undefined;
  aggregates?: Array<NovaAggregateRecord> | undefined;
  availabilityZoneCount?: number | undefined;
  flavors?: Array<NovaFlavorRecord> | undefined;
  servers?: Array<NovaServerRecord> | undefined;
  quotas?: Array<NovaQuotaRecord> | undefined;
  limits?: Array<NovaLimitsRecord> | undefined;
  /*
   * What Nova says instances went through since the last collection, each as the
   * notification it would have sent: see OpenStackInstanceActions.
   */
  instanceActionNotifications?: Array<JSONObject> | undefined;
}

// What Placement last said of a flavor, kept and sent until it is asked again.
export interface PlacementFlavorAnswer extends OpenStackPlacementAnswer {
  flavorId: string;
  flavorName: string | null;
  askedAt: string;
}

export interface OpenStackPlacementInventory {
  providers?: Array<PlacementProviderRecord> | undefined;
  flavorAnswers?: Array<PlacementFlavorAnswer> | undefined;
}

export interface OpenStackNetworkInventory {
  agents?: Array<NeutronAgentRecord> | undefined;
  networks?: Array<NeutronNetworkRecord> | undefined;
  subnets?: Array<NeutronSubnetRecord> | undefined;
  routers?: Array<NeutronRouterRecord> | undefined;
  l3Agents?: Array<NeutronL3AgentRecord> | undefined;
  dhcpAgentNetworks?: Array<NeutronDhcpAgentNetworksRecord> | undefined;
  floatingIps?: Array<NeutronFloatingIpRecord> | undefined;
  ipAvailabilities?: Array<NeutronSubnetAvailabilityRecord> | undefined;
  securityGroupCount?: number | undefined;
  ports?: Array<NeutronPortRecord> | undefined;
  vpnEndpointGroupCount?: number | undefined;
  vpnIkePolicyCount?: number | undefined;
  vpnIpsecPolicyCount?: number | undefined;
  vpnServices?: Array<NeutronVpnServiceRecord> | undefined;
  vpnConnections?: Array<NeutronVpnConnectionRecord> | undefined;
  quotas?: Array<NeutronQuotaRecord> | undefined;
}

export interface OpenStackVolumeInventory {
  services?: Array<CinderServiceRecord> | undefined;
  pools?: Array<CinderPoolRecord> | undefined;
  volumes?: Array<CinderVolumeRecord> | undefined;
  snapshots?: Array<CinderSnapshotRecord> | undefined;
  backups?: Array<CinderBackupRecord> | undefined;
  limits?: Array<CinderLimitsRecord> | undefined;
}

export interface OpenStackImageInventory {
  images?: Array<GlanceImageRecord> | undefined;
}

export interface OpenStackOrchestrationInventory {
  stacks?: Array<HeatStackRecord> | undefined;
  engines?: Array<HeatEngineRecord> | undefined;
}

export interface OpenStackContainerInfraInventory {
  clusters?: Array<MagnumClusterRecord> | undefined;
  conductors?: Array<MagnumConductorRecord> | undefined;
}

export interface OpenStackSharedFileSystemsInventory {
  shares?: Array<ManilaShareRecord> | undefined;
  services?: Array<ManilaServiceRecord> | undefined;
}

export interface OpenStackInventoryByService {
  identity?: OpenStackIdentityInventory | undefined;
  compute?: OpenStackComputeInventory | undefined;
  placement?: OpenStackPlacementInventory | undefined;
  network?: OpenStackNetworkInventory | undefined;
  volume?: OpenStackVolumeInventory | undefined;
  image?: OpenStackImageInventory | undefined;
  // Keyed by what each service is called, so a reading finds its own by that.
  orchestration?: OpenStackOrchestrationInventory | undefined;
  "container-infra"?: OpenStackContainerInfraInventory | undefined;
  sharev2?: OpenStackSharedFileSystemsInventory | undefined;
}
