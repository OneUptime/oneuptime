import {
  OpenStackComputeInventory,
  OpenStackIdentityInventory,
  OpenStackImageInventory,
  OpenStackNetworkInventory,
  OpenStackPlacementInventory,
  OpenStackVolumeInventory,
  NovaFlavorRecord,
  NovaHypervisorRecord,
} from "./OpenStackInventory";
import { OpenStackSendGate } from "./OpenStackRollingSend";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  OpenStackRbdLocation,
  isOpenStackRbdProtocol,
  parseOpenStackRbdLocation,
} from "Common/Types/OpenStack/OpenStackLinks";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import crypto from "crypto";

/*
 * What was read, as the series the agent sends.
 *
 * This is the one promise that matters here: pages, monitors and the AI read
 * openstack_* series and cannot tell which collector sent them, so a cloud moves
 * between the agent and a probe without its pages noticing. So each series below has
 * the exporter's name, help text and labels, and its value means what the exporter's
 * means, status codes and all (openstack_nova_server_status reads 4 for ERROR).
 * OpenStackExporterParity.test.ts holds this to what the exporter really answered on
 * the same recorded cloud, and to what the collector really exported.
 *
 * Three things from that recording, which are easy to get wrong:
 *
 *   - A label with an empty value is no label. Prometheus' data model says so, and the
 *     collector's export has none: an unattached floating IP has no router_id at all.
 *   - Every label is a string, numbers and booleans included.
 *   - Region and service are datapoint labels (`openstack.region.name`,
 *     `openstack_service`), and the cloud is a resource attribute the server stamps
 *     itself (OpenStackProbeMetrics), so a probe never names another cloud.
 *
 * What only a native collector can add goes in labels the exporter does not have, on
 * series it does, and is marked in OpenStackMetricCatalog (probeOnlyAttributes,
 * onlyFromProbe). Extra labels add no datapoints, and a reader of the exporter's labels
 * reads on undisturbed.
 *
 * The series the agent leaves off by default stay off here too, apart from what
 * options ask for. Two are never sent: openstack_neutron_subnets_* (the agent leaves
 * them off as saying what address pools already say) and
 * openstack_nova_security_groups (a route Nova no longer has).
 */

const SCOPE_NAME: string = "oneuptime-probe-openstack";

// A value longer than this is free text someone typed, and costs more than it tells.
export const MAX_LABEL_VALUE_LENGTH: number = 1024;

const BYTES_PER_MIB: number = 1024 * 1024;
const BYTES_PER_GIB: number = 1024 * 1024 * 1024;

const SERVICE_PREFIXES: Readonly<Record<OpenStackServiceType, string>> = {
  [OpenStackServiceType.Identity]: "openstack_identity",
  [OpenStackServiceType.Compute]: "openstack_nova",
  [OpenStackServiceType.Placement]: "openstack_placement",
  [OpenStackServiceType.Network]: "openstack_neutron",
  [OpenStackServiceType.Volume]: "openstack_cinder",
  [OpenStackServiceType.Image]: "openstack_glance",
};

// knownServerStatuses, the exporter's nova.go.
const SERVER_STATUS_CODES: Readonly<Record<string, number>> = {
  ACTIVE: 0,
  BUILD: 1,
  "BUILD(spawning)": 2,
  DELETED: 3,
  ERROR: 4,
  HARD_REBOOT: 5,
  PASSWORD: 6,
  REBOOT: 7,
  REBUILD: 8,
  RESCUE: 9,
  RESIZE: 10,
  SHUTOFF: 11,
  SUSPENDED: 12,
  UNKNOWN: 13,
  VERIFY_RESIZE: 14,
  MIGRATING: 15,
  PAUSED: 16,
  REVERT_RESIZE: 17,
  SHELVED: 18,
  SHELVED_OFFLOADED: 19,
  SOFT_DELETED: 20,
};

// knownNetworkStatuses, the exporter's neutron.go.
const NETWORK_STATUS_CODES: Readonly<Record<string, number>> = {
  ACTIVE: 0,
  BUILD: 1,
  DOWN: 2,
  ERROR: 3,
};

// vpn_service_status and vpn_connection_status, the exporter's neutron.go.
const VPN_STATUSES: ReadonlyArray<string> = [
  "ACTIVE",
  "DOWN",
  "BUILD",
  "ERROR",
  "PENDING_CREATE",
  "PENDING_UPDATE",
  "PENDING_DELETE",
];

/*
 * knownVolumeStatuses, the exporter's cinder.go, in the order of its codes. Each reads 0
 * in the counter until a volume is in it.
 */
const VOLUME_STATUSES: ReadonlyArray<string> = [
  "creating",
  "available",
  "reserved",
  "attaching",
  "detaching",
  "in-use",
  "maintenance",
  "deleting",
  "awaiting-transfer",
  "error",
  "error_deleting",
  "backing-up",
  "restoring-backup",
  "error_backing-up",
  "error_restoring",
  "error_extending",
  "downloading",
  "uploading",
  "retyping",
  "extending",
];

type Labels = Record<string, string | number | boolean | null | undefined>;

function labelText(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

function toBound(text: string): string {
  return text.length > MAX_LABEL_VALUE_LENGTH
    ? `${text.substring(0, MAX_LABEL_VALUE_LENGTH - 1)}…`
    : text;
}

/*
 * The exporter makes this label up afresh on every scrape, so a series of it never
 * lasts. A probe can do better by making the same one each time, from what names a
 * Cinder service.
 */
export function stableCinderServiceUuid(data: {
  host: string | null;
  binary: string | null;
}): string {
  const hash: string = crypto
    .createHash("sha256")
    .update(`${data.host || ""}/${data.binary || ""}`)
    .digest("hex");

  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(
    12,
    16,
  )}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

export interface OpenStackServiceReading {
  service: OpenStackServiceType;
  regionName: string;
  // What was read. Absent for a service not read this time.
  inventory?:
    | OpenStackIdentityInventory
    | OpenStackComputeInventory
    | OpenStackPlacementInventory
    | OpenStackNetworkInventory
    | OpenStackVolumeInventory
    | OpenStackImageInventory
    | undefined;
  // What openstack_<service>_up reads, and null to send no such series at all.
  apiUp: boolean | null;
  // What `up` reads for this service's collection.
  answered: boolean;
  observedAt: number;
  durationInMs: number;
  /*
   * On a cloud whose rows are sent in turns, how long one that did not change can go without
   * being sent. openstack_<service>_up says so, because it is what vouches for those rows.
   */
  refreshCycleInMinutes?: number | undefined;
}

interface MetricBeingBuilt {
  name: string;
  description: string;
  unit?: string | undefined;
  dataPoints: Array<JSONObject>;
}

function attributeValue(attribute: JSONObject | undefined): string {
  return ((attribute?.["value"] as JSONObject | undefined)?.["stringValue"] ??
    "") as string;
}

/*
 * The order the exporter writes a series' lines in: by their label values, taking the
 * labels in name order, with a label that has no value empty. It says nothing to a chart.
 * It matters where two lines make one row: DevStack runs two nova-conductors on a host,
 * and the row keeps what the last one says, so the last has to be the same one whichever
 * way the cloud is collected, and from one collection to the next. Exported for tests.
 */
export function compareDatapointsAsTheExporterDoes(
  first: JSONObject,
  second: JSONObject,
): number {
  const a: Array<JSONObject> = first["attributes"] as Array<JSONObject>;
  const b: Array<JSONObject> = second["attributes"] as Array<JSONObject>;

  let inA: number = 0;
  let inB: number = 0;

  while (inA < a.length || inB < b.length) {
    const keyA: string | undefined = a[inA]?.["key"] as string | undefined;
    const keyB: string | undefined = b[inB]?.["key"] as string | undefined;

    const isInBoth: boolean = keyA === keyB;
    const isFromA: boolean =
      isInBoth || keyB === undefined || (keyA !== undefined && keyA < keyB);
    const isFromB: boolean =
      isInBoth || keyA === undefined || (keyB !== undefined && keyB < keyA);

    const valueA: string = isFromA ? attributeValue(a[inA]) : "";
    const valueB: string = isFromB ? attributeValue(b[inB]) : "";

    if (isFromA) {
      inA++;
    }

    if (isFromB) {
      inB++;
    }

    if (valueA !== valueB) {
      return valueA < valueB ? -1 : 1;
    }
  }

  return 0;
}

// One service of one region: one resource, as one scrape is to the agent's collector.
class SeriesWriter {
  public datapointCount: number = 0;
  // Read and said about, and held back for its turn: it still counts as a sample of the scrape.
  public heldBackCount: number = 0;

  private readonly metrics: Map<string, MetricBeingBuilt> = new Map();
  private readonly regionName: string;
  private readonly service: OpenStackServiceType;
  private readonly timeUnixNano: string;
  private readonly gate: OpenStackSendGate | undefined;

  public constructor(
    reading: OpenStackServiceReading,
    gate?: OpenStackSendGate | undefined,
  ) {
    this.regionName = reading.regionName;
    this.service = reading.service;
    this.timeUnixNano = `${Math.round(reading.observedAt)}000000`;
    this.gate = gate;
  }

  // openstack_<service>_<name>, whose help text is the exporter's: the name alone.
  public add(name: string, labels: Labels, value: number | null): void {
    const metricName: string = `${SERVICE_PREFIXES[this.service]}_${name}`;

    if (this.gate && !this.gate.shouldSend(metricName, labels, value)) {
      this.heldBackCount++;
      return;
    }

    const isWritten: boolean = this.write({
      name: metricName,
      description: name,
      labels: labels,
      value: value,
    });

    if (isWritten) {
      this.datapointCount++;
    }
  }

  // The series the Prometheus receiver writes about a scrape, in its own words.
  public addScrapeSeries(data: {
    name: string;
    description: string;
    unit?: string | undefined;
    value: number;
  }): void {
    this.write({ ...data, labels: {} });
  }

  public toMetrics(): JSONArray {
    const metrics: JSONArray = [];

    for (const metric of this.metrics.values()) {
      const entry: JSONObject = {
        name: metric.name,
        description: metric.description,
      };

      if (metric.unit) {
        entry["unit"] = metric.unit;
      }

      entry["gauge"] = {
        dataPoints: metric.dataPoints.sort(compareDatapointsAsTheExporterDoes),
      };
      entry["metadata"] = [
        { key: "prometheus.type", value: { stringValue: "gauge" } },
      ];

      metrics.push(entry);
    }

    return metrics;
  }

  private write(data: {
    name: string;
    description: string;
    unit?: string | undefined;
    labels: Labels;
    value: number | null;
  }): boolean {
    // A non-finite number has no form in JSON, and a null one was not read.
    if (data.value === null || !Number.isFinite(data.value)) {
      return false;
    }

    let metric: MetricBeingBuilt | undefined = this.metrics.get(data.name);

    if (!metric) {
      metric = {
        name: data.name,
        description: data.description,
        unit: data.unit,
        dataPoints: [],
      };
      this.metrics.set(data.name, metric);
    }

    const keys: Array<string> = Object.keys(data.labels).filter(
      (key: string): boolean => {
        return labelText(data.labels[key]) !== "";
      },
    );

    const attributes: Array<JSONObject> = keys.map(
      (key: string): JSONObject => {
        return {
          key: key,
          value: { stringValue: toBound(labelText(data.labels[key])) },
        };
      },
    );

    attributes.push(
      {
        key: "openstack.region.name",
        value: { stringValue: this.regionName },
      },
      { key: "openstack_service", value: { stringValue: this.service } },
    );

    attributes.sort((first: JSONObject, second: JSONObject): number => {
      const a: string = first["key"] as string;
      const b: string = second["key"] as string;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    metric.dataPoints.push({
      attributes: attributes,
      timeUnixNano: this.timeUnixNano,
      asDouble: data.value,
    });

    return true;
  }
}

function writeIdentity(
  writer: SeriesWriter,
  inventory: OpenStackIdentityInventory,
): void {
  if (inventory.domains) {
    writer.add("domains", {}, inventory.domains.length);

    for (const domain of inventory.domains) {
      writer.add(
        "domain_info",
        {
          description: domain.description,
          enabled: domain.enabled,
          id: domain.id,
          name: domain.name,
        },
        1,
      );
    }
  }

  if (inventory.projects) {
    writer.add("projects", {}, inventory.projects.length);

    for (const project of inventory.projects) {
      writer.add(
        "project_info",
        {
          is_domain: project.isDomain,
          description: project.description,
          domain_id: project.domainId,
          enabled: project.enabled,
          id: project.id,
          name: project.name,
          parent_id: project.parentId,
          tags: project.tags.join(","),
        },
        1,
      );
    }
  }

  if (inventory.regionCount !== undefined) {
    writer.add("regions", {}, inventory.regionCount);
  }

  if (inventory.userCount !== undefined) {
    writer.add("users", {}, inventory.userCount);
  }

  if (inventory.groupCount !== undefined) {
    writer.add("groups", {}, inventory.groupCount);
  }
}

function writeHypervisors(
  writer: SeriesWriter,
  inventory: OpenStackComputeInventory,
): void {
  if (!inventory.hypervisors) {
    return;
  }

  /*
   * A host's zone and groups are in the aggregates, keyed by Nova's short host name. An
   * aggregate that only exists to set a zone is not a group anyone made, so it gives
   * its zone and not its name.
   */
  const zoneOfHost: Map<string, string> = new Map();
  const aggregatesOfHost: Map<string, Array<string>> = new Map();

  for (const aggregate of inventory.aggregates || []) {
    for (const host of aggregate.hosts) {
      if (aggregate.availabilityZone) {
        zoneOfHost.set(host, aggregate.availabilityZone);
      }

      if (!aggregate.isZoneOnly && aggregate.name) {
        const names: Array<string> = aggregatesOfHost.get(host) || [];
        names.push(aggregate.name);
        aggregatesOfHost.set(host, names);
      }
    }
  }

  const mib: (value: number | null) => number | null = (
    value: number | null,
  ): number | null => {
    return value === null ? null : value * BYTES_PER_MIB;
  };

  const gib: (value: number | null) => number | null = (
    value: number | null,
  ): number | null => {
    return value === null ? null : value * BYTES_PER_GIB;
  };

  for (const hypervisor of inventory.hypervisors as Array<NovaHypervisorRecord>) {
    const serviceHost: string = hypervisor.serviceHost || "";

    const labels: Labels = {
      hostname: hypervisor.hostname,
      availability_zone: zoneOfHost.get(serviceHost),
      aggregates: [...(aggregatesOfHost.get(serviceHost) || [])]
        .sort()
        .join(","),
    };

    writer.add("running_vms", labels, hypervisor.runningVms);
    writer.add("current_workload", labels, hypervisor.currentWorkload);
    writer.add("vcpus_available", labels, hypervisor.vcpus);
    writer.add("vcpus_used", labels, hypervisor.vcpusUsed);
    writer.add("memory_available_bytes", labels, mib(hypervisor.memoryMb));
    writer.add("memory_used_bytes", labels, mib(hypervisor.memoryMbUsed));
    writer.add(
      "local_storage_available_bytes",
      labels,
      gib(hypervisor.localGb),
    );
    writer.add("local_storage_used_bytes", labels, gib(hypervisor.localGbUsed));
    writer.add("free_disk_bytes", labels, gib(hypervisor.freeDiskGb));
  }
}

function writeCompute(
  writer: SeriesWriter,
  inventory: OpenStackComputeInventory,
): void {
  if (inventory.services) {
    for (const service of inventory.services) {
      writer.add(
        "agent_state",
        {
          id: service.id,
          hostname: service.host,
          service: service.binary,
          adminState: service.status,
          zone: service.zone,
          disabledReason: service.disabledReason,
        },
        service.state === "up" ? 1 : 0,
      );
    }
  }

  writeHypervisors(writer, inventory);

  if (inventory.flavors) {
    writer.add("flavors", {}, inventory.flavors.length);

    for (const flavor of inventory.flavors) {
      writer.add(
        "flavor",
        {
          id: flavor.id,
          name: flavor.name,
          vcpus: flavor.vcpus,
          ram: flavor.ram,
          disk: flavor.disk,
          is_public: flavor.isPublic,
        },
        1,
      );
    }
  }

  if (inventory.availabilityZoneCount !== undefined) {
    writer.add("availability_zones", {}, inventory.availabilityZoneCount);
  }

  if (inventory.servers) {
    /*
     * From microversion 2.47 a server carries its flavor's name and no id for it, so
     * the id comes from the flavors, by that name.
     */
    const flavorIdByName: Map<string, string> = new Map();

    for (const flavor of (inventory.flavors || []) as Array<NovaFlavorRecord>) {
      if (flavor.name && flavor.id) {
        flavorIdByName.set(flavor.name, flavor.id);
      }
    }

    writer.add("total_vms", {}, inventory.servers.length);

    for (const server of inventory.servers) {
      writer.add(
        "server_status",
        {
          id: server.id,
          status: server.status,
          name: server.name,
          tenant_id: server.tenantId,
          user_id: server.userId,
          address_ipv4: server.accessIpv4,
          address_ipv6: server.accessIpv6,
          host_id: server.hostId,
          hypervisor_hostname: server.hypervisorHostname,
          uuid: server.id,
          availability_zone: server.availabilityZone,
          flavor_id:
            server.flavorId ??
            (server.flavorName ? flavorIdByName.get(server.flavorName) : null),
          instance_libvirt: server.instanceName,
          task_state: server.taskState,
          updated_at: server.updatedAt,
          fault_message: server.faultMessage,
        },
        server.status ? SERVER_STATUS_CODES[server.status] ?? -1 : -1,
      );
    }
  }

  for (const project of inventory.quotas || []) {
    for (const name of Object.keys(project.quotas)) {
      const detail: { inUse: number; reserved: number; limit: number } =
        project.quotas[name]!;

      const labels: (type: string) => Labels = (type: string): Labels => {
        return {
          type: type,
          tenant: project.projectName,
          tenant_id: project.projectId,
        };
      };

      writer.add(`quota_${name}`, labels("in_use"), detail.inUse);
      writer.add(`quota_${name}`, labels("reserved"), detail.reserved);
      writer.add(`quota_${name}`, labels("limit"), detail.limit);
    }
  }

  for (const project of inventory.limits || []) {
    const labels: Labels = {
      tenant: project.projectName,
      tenant_id: project.projectId,
    };

    writer.add("limits_vcpus_max", labels, project.maxTotalCores);
    writer.add("limits_vcpus_used", labels, project.totalCoresUsed);
    writer.add("limits_memory_max", labels, project.maxTotalRAMSize);
    writer.add("limits_memory_used", labels, project.totalRAMUsed);
    writer.add("limits_instances_max", labels, project.maxTotalInstances);
    writer.add("limits_instances_used", labels, project.totalInstancesUsed);
  }
}

function writePlacement(
  writer: SeriesWriter,
  inventory: OpenStackPlacementInventory,
): void {
  for (const provider of inventory.providers || []) {
    for (const item of provider.inventories || []) {
      const labels: Labels = {
        hostname: provider.name,
        resourcetype: item.resourceClass,
      };

      writer.add("resource_total", labels, item.total);
      writer.add("resource_allocation_ratio", labels, item.allocationRatio);
      writer.add("resource_generation", labels, provider.generation);
      writer.add("resource_reserved", labels, item.reserved);
    }

    const usages: Record<string, number> = provider.usages || {};

    for (const resourceClass of Object.keys(usages)) {
      writer.add(
        "resource_usage",
        { hostname: provider.name, resourcetype: resourceClass },
        usages[resourceClass]!,
      );
    }

    for (const allocation of provider.allocations || []) {
      writer.add(
        "resource_provider_allocations",
        {
          hostname: provider.name,
          uuid: allocation.consumerId,
          resourcetype: allocation.resourceClass,
        },
        allocation.amount,
      );
    }
  }
}

function writeNetwork(
  writer: SeriesWriter,
  inventory: OpenStackNetworkInventory,
): void {
  for (const agent of inventory.agents || []) {
    writer.add(
      "agent_state",
      {
        id: agent.id,
        hostname: agent.host,
        service: agent.binary,
        adminState: agent.isAdminUp ? "up" : "down",
        availability_zone: agent.availabilityZone,
      },
      agent.isAlive ? 1 : 0,
    );
  }

  if (inventory.networks) {
    writer.add("networks", {}, inventory.networks.length);

    for (const network of inventory.networks) {
      writer.add(
        "network",
        {
          id: network.id,
          tenant_id: network.tenantId,
          status: network.status,
          name: network.name,
          is_shared: network.isShared,
          is_external: network.isExternal,
          provider_network_type: network.networkType,
          provider_physical_network: network.physicalNetwork,
          provider_segmentation_id: network.segmentationId,
          subnets: network.subnets.join(","),
          tags: network.tags.join(","),
          mtu: network.mtu,
        },
        network.status ? NETWORK_STATUS_CODES[network.status] ?? -1 : -1,
      );
    }
  }

  if (inventory.subnets) {
    writer.add("subnets", {}, inventory.subnets.length);

    for (const subnet of inventory.subnets) {
      writer.add(
        "subnet",
        {
          id: subnet.id,
          tenant_id: subnet.tenantId,
          name: subnet.name,
          network_id: subnet.networkId,
          cidr: subnet.cidr,
          gateway_ip: subnet.gatewayIp,
          enable_dhcp: subnet.enableDhcp,
          dns_nameservers: subnet.dnsNameservers.join(","),
          tags: subnet.tags.join(","),
        },
        1,
      );
    }
  }

  if (inventory.routers) {
    let notActive: number = 0;

    for (const router of inventory.routers) {
      if (router.status !== "ACTIVE") {
        notActive++;
      }

      writer.add(
        "router",
        {
          id: router.id,
          name: router.name,
          project_id: router.projectId,
          admin_state_up: router.isAdminUp,
          status: router.status,
          external_network_id: router.externalNetworkId,
        },
        1,
      );
    }

    writer.add("routers", {}, inventory.routers.length);
    writer.add("routers_not_active", {}, notActive);
  }

  for (const agent of inventory.l3Agents || []) {
    writer.add(
      "l3_agent_of_router",
      {
        router_id: agent.routerId,
        l3_agent_id: agent.agentId,
        ha_state: agent.haState,
        agent_alive: agent.isAlive,
        agent_admin_up: agent.isAdminUp,
        agent_host: agent.host,
      },
      agent.isAlive ? 1 : 0,
    );
  }

  if (inventory.floatingIps) {
    let associatedNotActive: number = 0;

    for (const address of inventory.floatingIps) {
      if (address.fixedIp && address.status !== "ACTIVE") {
        associatedNotActive++;
      }

      writer.add(
        "floating_ip",
        {
          id: address.id,
          floating_network_id: address.networkId,
          router_id: address.routerId,
          status: address.status,
          project_id: address.projectId,
          floating_ip_address: address.address,
          port_id: address.portId,
        },
        1,
      );
    }

    writer.add("floating_ips", {}, inventory.floatingIps.length);
    writer.add("floating_ips_associated_not_active", {}, associatedNotActive);
  }

  for (const subnet of inventory.ipAvailabilities || []) {
    const labels: Labels = {
      network_id: subnet.networkId,
      network_name: subnet.networkName,
      ip_version: subnet.ipVersion,
      cidr: subnet.cidr,
      subnet_name: subnet.subnetName,
      project_id: subnet.projectId,
    };

    writer.add("network_ip_availabilities_total", labels, subnet.totalIps);
    writer.add("network_ip_availabilities_used", labels, subnet.usedIps);
  }

  if (inventory.securityGroupCount !== undefined) {
    writer.add("security_groups", {}, inventory.securityGroupCount);
  }

  if (inventory.ports) {
    let withoutAddress: number = 0;
    let loadBalancerNotActive: number = 0;

    for (const port of inventory.ports) {
      if (port.status === "ACTIVE" && port.fixedIps.length === 0) {
        withoutAddress++;
      }

      if (
        port.deviceOwner === "neutron:LOADBALANCERV2" &&
        port.status !== "ACTIVE"
      ) {
        loadBalancerNotActive++;
      }

      writer.add(
        "port",
        {
          uuid: port.id,
          network_id: port.networkId,
          mac_address: port.macAddress,
          device_owner: port.deviceOwner,
          device_id: port.deviceId,
          status: port.status,
          binding_vif_type: port.vifType,
          admin_state_up: port.isAdminUp,
          fixed_ips: port.fixedIps.join(","),
        },
        1,
      );
    }

    writer.add("ports", {}, inventory.ports.length);
    writer.add("ports_no_ips", {}, withoutAddress);
    writer.add("ports_lb_not_active", {}, loadBalancerNotActive);
  }

  if (inventory.vpnEndpointGroupCount !== undefined) {
    writer.add("vpn_endpoint_groups", {}, inventory.vpnEndpointGroupCount);
  }

  if (inventory.vpnIkePolicyCount !== undefined) {
    writer.add("vpn_ike_policies", {}, inventory.vpnIkePolicyCount);
  }

  if (inventory.vpnIpsecPolicyCount !== undefined) {
    writer.add("vpn_ipsec_policies", {}, inventory.vpnIpsecPolicyCount);
  }

  if (inventory.vpnServices) {
    writer.add("vpn_services", {}, inventory.vpnServices.length);

    for (const service of inventory.vpnServices) {
      writer.add(
        "vpn_service",
        {
          id: service.id,
          project_id: service.projectId,
          subnet_id: service.subnetId,
          router_id: service.routerId,
          admin_state_up: service.isAdminUp,
          name: service.name,
          external_ipv4: service.externalIpv4,
          external_ipv6: service.externalIpv6,
          flavor_id: service.flavorId,
        },
        service.status ? VPN_STATUSES.indexOf(service.status) : -1,
      );
    }
  }

  if (inventory.vpnConnections) {
    writer.add("vpn_siteconnections", {}, inventory.vpnConnections.length);

    for (const connection of inventory.vpnConnections) {
      writer.add(
        "vpn_siteconnection",
        {
          id: connection.id,
          project_id: connection.projectId,
          admin_state_up: connection.isAdminUp,
          name: connection.name,
          vpn_service_id: connection.vpnServiceId,
          ike_policy_id: connection.ikePolicyId,
          ipsec_policy_id: connection.ipsecPolicyId,
          peer_id: connection.peerId,
          peer_ep_group_id: connection.peerEndpointGroupId,
          local_id: connection.localId,
          local_ep_group_id: connection.localEndpointGroupId,
        },
        connection.status ? VPN_STATUSES.indexOf(connection.status) : -1,
      );
    }
  }

  for (const project of inventory.quotas || []) {
    for (const name of Object.keys(project.quotas)) {
      const detail: { used: number; reserved: number; limit: number } =
        project.quotas[name]!;

      const labels: (type: string) => Labels = (type: string): Labels => {
        return {
          type: type,
          tenant: project.projectName,
          tenant_id: project.projectId,
        };
      };

      writer.add(`quota_${name}`, labels("used"), detail.used);
      writer.add(`quota_${name}`, labels("reserved"), detail.reserved);
      writer.add(`quota_${name}`, labels("limit"), detail.limit);
    }
  }
}

function writeVolume(
  writer: SeriesWriter,
  inventory: OpenStackVolumeInventory,
): void {
  for (const service of inventory.services || []) {
    writer.add(
      "agent_state",
      {
        uuid: stableCinderServiceUuid({
          host: service.host,
          binary: service.binary,
        }),
        hostname: service.host,
        service: service.binary,
        adminState: service.status,
        zone: service.zone,
        disabledReason: service.disabledReason,
      },
      service.state === "up" ? 1 : 0,
    );
  }

  for (const pool of inventory.pools || []) {
    const rbd: OpenStackRbdLocation | null = isOpenStackRbdProtocol(
      pool.storageProtocol,
    )
      ? parseOpenStackRbdLocation(pool.locationInfo)
      : null;
    const labels: Labels = {
      name: pool.name,
      volume_backend_name: pool.backendName,
      vendor_name: pool.vendorName,
      /*
       * Only a probe at the Full view level can read these, and they are what names the
       * Ceph cluster behind a pool as a fact rather than a guess.
       */
      storage_protocol: pool.storageProtocol,
      ceph_fsid: rbd?.fsid,
      ceph_pool: rbd?.poolName,
    };

    writer.add("pool_capacity_free_gb", labels, pool.freeCapacityGb);
    writer.add("pool_capacity_total_gb", labels, pool.totalCapacityGb);
  }

  if (inventory.volumes) {
    const byStatus: Map<string, number> = new Map(
      VOLUME_STATUSES.map((status: string): [string, number] => {
        return [status, 0];
      }),
    );

    writer.add("volumes", {}, inventory.volumes.length);

    for (const volume of inventory.volumes) {
      const status: string = volume.status || "";
      byStatus.set(status, (byStatus.get(status) || 0) + 1);

      writer.add(
        "volume_gb",
        {
          id: volume.id,
          name: volume.name,
          status: volume.status,
          availability_zone: volume.availabilityZone,
          bootable: volume.bootable,
          tenant_id: volume.tenantId,
          user_id: volume.userId,
          volume_type: volume.volumeType,
          server_id: volume.serverId,
          updated_at: volume.updatedAt,
        },
        volume.sizeGb,
      );

      writer.add(
        "volume_status",
        {
          id: volume.id,
          name: volume.name,
          status: volume.status,
          bootable: volume.bootable,
          tenant_id: volume.tenantId,
          size: volume.sizeGb,
          volume_type: volume.volumeType,
          server_id: volume.serverId,
        },
        volume.status ? VOLUME_STATUSES.indexOf(volume.status) : -1,
      );
    }

    for (const [status, count] of byStatus) {
      writer.add("volume_status_counter", { status: status }, count);
    }
  }

  if (inventory.snapshots) {
    writer.add("snapshots", {}, inventory.snapshots.length);

    for (const snapshot of inventory.snapshots) {
      writer.add(
        "snapshot_gb",
        {
          id: snapshot.id,
          name: snapshot.name,
          status: snapshot.status,
          tenant_id: snapshot.tenantId,
          volume_id: snapshot.volumeId,
          updated_at: snapshot.updatedAt,
        },
        snapshot.sizeGb,
      );
    }
  }

  for (const backup of inventory.backups || []) {
    writer.add(
      "backup_gb",
      {
        id: backup.id,
        name: backup.name,
        status: backup.status,
        tenant_id: backup.tenantId,
        volume_id: backup.volumeId,
        availability_zone: backup.availabilityZone,
        is_incremental: backup.isIncremental,
        updated_at: backup.updatedAt,
      },
      backup.sizeGb,
    );
  }

  for (const project of inventory.limits || []) {
    const labels: Labels = {
      tenant: project.projectName,
      tenant_id: project.projectId,
    };

    writer.add("limits_volume_max_gb", labels, project.volumeMaxGb);
    writer.add("limits_volume_used_gb", labels, project.volumeUsedGb);
    writer.add("limits_backup_max_gb", labels, project.backupMaxGb);
    writer.add("limits_backup_used_gb", labels, project.backupUsedGb);

    for (const volumeType of Object.keys(project.typeQuotaGb)) {
      writer.add(
        "volume_type_quota_gigabytes",
        { ...labels, volume_type: volumeType },
        project.typeQuotaGb[volumeType]!,
      );
    }
  }
}

function writeImage(
  writer: SeriesWriter,
  inventory: OpenStackImageInventory,
): void {
  if (!inventory.images) {
    return;
  }

  writer.add("images", {}, inventory.images.length);

  for (const image of inventory.images) {
    writer.add(
      "image_bytes",
      {
        id: image.id,
        name: image.name,
        tenant_id: image.owner,
        image_type: image.imageType,
        updated_at: image.updatedAt,
      },
      image.sizeBytes,
    );

    const createdAt: number = image.createdAt
      ? Date.parse(image.createdAt)
      : Number.NaN;

    if (!Number.isNaN(createdAt)) {
      writer.add(
        "image_created_at",
        {
          id: image.id,
          name: image.name,
          tenant_id: image.owner,
          visibility: image.visibility,
          hidden: image.isHidden,
          status: image.status,
        },
        Math.floor(createdAt / 1000),
      );
    }
  }
}

function writeInventory(
  writer: SeriesWriter,
  reading: OpenStackServiceReading,
): void {
  if (!reading.inventory) {
    return;
  }

  switch (reading.service) {
    case OpenStackServiceType.Identity:
      writeIdentity(writer, reading.inventory as OpenStackIdentityInventory);
      return;
    case OpenStackServiceType.Compute:
      writeCompute(writer, reading.inventory as OpenStackComputeInventory);
      return;
    case OpenStackServiceType.Placement:
      writePlacement(writer, reading.inventory as OpenStackPlacementInventory);
      return;
    case OpenStackServiceType.Network:
      writeNetwork(writer, reading.inventory as OpenStackNetworkInventory);
      return;
    case OpenStackServiceType.Volume:
      writeVolume(writer, reading.inventory as OpenStackVolumeInventory);
      return;
    case OpenStackServiceType.Image:
      writeImage(writer, reading.inventory as OpenStackImageInventory);
      return;
    default:
      return;
  }
}

export interface OpenStackOtlpBuildResult {
  resourceMetrics: JSONArray;
  resourceCount: number;
  datapointCount: number;
}

export default class OpenStackOtlpBuilder {
  public static build(
    readings: ReadonlyArray<OpenStackServiceReading>,
    scopeVersion: string,
    gate?: OpenStackSendGate | undefined,
  ): OpenStackOtlpBuildResult {
    const resourceMetrics: JSONArray = [];
    let datapointCount: number = 0;

    for (const reading of readings) {
      const writer: SeriesWriter = new SeriesWriter(reading, gate);

      writeInventory(writer, reading);

      if (reading.apiUp !== null) {
        writer.add(
          "up",
          { refresh_cycle_minutes: reading.refreshCycleInMinutes },
          reading.apiUp ? 1 : 0,
        );
      }

      /*
       * What the Prometheus receiver says about each scrape, which monitors read too:
       * `up` is how a page tells a service nothing could be asked, and a count of 0 is
       * how the agent's own series say Keystone could not be logged in to.
       */
      const samples: number = writer.datapointCount + writer.heldBackCount;

      writer.addScrapeSeries({
        name: "up",
        description: "The scraping was successful",
        value: reading.answered ? 1 : 0,
      });
      writer.addScrapeSeries({
        name: "scrape_samples_scraped",
        description: "The number of samples the target exposed",
        value: samples,
      });
      writer.addScrapeSeries({
        name: "scrape_duration_seconds",
        description: "Duration of the scrape",
        unit: "s",
        value: reading.durationInMs / 1000,
      });

      resourceMetrics.push({
        resource: { attributes: [] },
        scopeMetrics: [
          {
            scope: { name: SCOPE_NAME, version: scopeVersion },
            metrics: writer.toMetrics(),
          },
        ],
      });

      datapointCount += writer.datapointCount + 3;
    }

    return {
      resourceMetrics: resourceMetrics,
      resourceCount: resourceMetrics.length,
      datapointCount: datapointCount,
    };
  }

  /*
   * Only what says whether the cloud is answering. A collection too large to upload
   * still sends this, because monitors read these series as an anchor: without them an
   * open incident can neither fire nor recover, and silence reads as the cloud having
   * stopped reporting when it has not.
   */
  public static toAvailabilityOnly(resourceMetrics: JSONArray): JSONArray {
    const isAvailability: (name: string) => boolean = (
      name: string,
    ): boolean => {
      return (
        name === "up" ||
        name === "scrape_samples_scraped" ||
        name === "scrape_duration_seconds" ||
        (name.startsWith("openstack_") && name.endsWith("_up"))
      );
    };

    return (resourceMetrics as Array<JSONObject>).map(
      (resource: JSONObject): JSONObject => {
        return {
          resource: resource["resource"],
          scopeMetrics: (resource["scopeMetrics"] as Array<JSONObject>).map(
            (scope: JSONObject): JSONObject => {
              return {
                scope: scope["scope"],
                metrics: (scope["metrics"] as Array<JSONObject>).filter(
                  (metric: JSONObject): boolean => {
                    return isAvailability(metric["name"] as string);
                  },
                ),
              };
            },
          ),
        };
      },
    );
  }
}
