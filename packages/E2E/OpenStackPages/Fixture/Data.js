/*
 * The estates the OpenStack pages fixture serves, for an "Acme Cloud" workspace.
 * Nothing here is a real customer's data.
 *
 * An estate is plain rows, one array, in the shape OpenStackResourceService writes:
 * buildEstate(scenario, loadedAt) returns { cloud, inventory, name }. Two kinds of
 * estate, and both read the same way to a page:
 *
 *   Recordings: `?recording=gazpacho-ovs/compute-down` is what that real cloud's
 *   exporter answered, read through the real snapshot scan (Recordings.js). Use one
 *   when a walk is about what OpenStack really says.
 *
 *   Made up: the builders below. Each kind's builder writes the labels, facts and
 *   words a recording of that kind has (Common/Tests/Fixtures/OpenStack), and its
 *   comment says which recording it was copied from. Use one when a walk needs
 *   something no recording holds: a full pool, a cloud of two regions, a lost host
 *   with 42 instances on it.
 *
 * To add to it: write rows with the builders (hypervisor(), instance(), ...), add them
 * to an estate's function, or add a new `case` to ESTATES and open it with `?estate=`.
 * The rows are the whole of the data: Fixture.js answers every read from them, the
 * inventory summary, Needs attention and blast radius included, the way the server
 * would, so nothing else needs to be told.
 *
 *   busy          (default) one region, ML2/OVS, something wrong of every kind.
 *   calm          the same cloud with nothing wrong, and a host disabled on purpose.
 *   new           a cloud that exists and has reported nothing yet.
 *   multi-region  two regions: RegionOne is calm, RegionTwo has lost its compute API.
 *   overflow      more instances in ERROR than Needs attention reads.
 *   ovn-stale     a calm cloud on OVN, with a stale record beside a live agent.
 */

export const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

export function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

export const CLOUD_ID = uuid("71000000", 1);

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const GIB = 1024 * 1024 * 1024;
export const TIB = 1024 * GIB;

export const REGION_ONE = "RegionOne";
export const REGION_TWO = "RegionTwo";

/*
 * Keystone's project IDs are 32 hex characters, and rows hold only those: Nova, Cinder
 * and Neutron report no project names (gazpacho-ovs/healthy, compute.prom).
 */
function keystoneId(number) {
  return `${String(number).padStart(4, "0")}e37252697aa04e6e914220e5198d`.padEnd(
    32,
    "0",
  );
}

// The Neutron and Nova IDs of real rows are UUIDs.
function openStackUuid(prefix, number) {
  return `${prefix}-${String(number).padStart(4, "0")}-4c2e-a4fc-c5cf0f2db585`;
}

/*
 * What one row holds beyond its kind. `at` is when it was last seen, and `since` how
 * long it has been in its state, because what the rules call stuck or forgotten reads
 * stateChangedAt. Unset columns stay unset, as a row whose series never arrived reads.
 */
function stamped(fields, context) {
  const at = context.lastSeenAt;
  const row = {
    openStackCloudId: CLOUD_ID,
    lastSeenAt: new Date(at),
    metricsUpdatedAt: new Date(at),
    ...fields,
  };
  if (row.status !== undefined && row.stateChangedAt === undefined) {
    row.stateChangedAt = new Date(at);
  }
  if (fields.since !== undefined) {
    row.stateChangedAt = new Date(context.loadedAt - fields.since);
    delete row.since;
  }
  return row;
}

/*
 * One service's API in one region (gazpacho-ovs/healthy): `externalId` is
 * region/service, and `name` the service as the Keystone catalog types it. The
 * exporter's series have no region, so the agent stamps it.
 */
export function api(context, service, region, fields = {}) {
  return stamped(
    {
      kind: "Api",
      externalId: `${region}/${service}`,
      name: service,
      regionName: region,
      status: "up",
      ...fields,
      facts: {
        vouchedAt: new Date(context.lastSeenAt).toISOString(),
        scrapeFailed: false,
        collectionSeconds: 0.29,
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

/*
 * A worker (gazpacho-ovs/healthy). Nova's host is its short name, where its hypervisor
 * says its full one; Cinder's carries its backend ("compute-01@lvmdriver-1"); a Neutron
 * agent's zone is often empty. Nova's control services sit in the zone "internal".
 */
export function worker(context, family, host, binary, region, fields = {}) {
  return stamped(
    {
      kind: "Service",
      externalId: `${region}/${family}/${host}/${binary}`,
      name: binary,
      regionName: region,
      hypervisorName: family === "compute" ? host : undefined,
      status: "up",
      adminState: family === "network" ? "up" : "enabled",
      ...fields,
      facts: {
        family,
        host,
        agentId: openStackUuid(
          "d7ef14b8",
          (host.length * 31 + binary.length * 7) % 9973,
        ),
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

export function novaCompute(context, host, region, fields = {}) {
  return worker(context, "compute", host, "nova-compute", region, {
    availabilityZone: "nova",
    ...fields,
  });
}

export function novaControl(context, host, binary, region, fields = {}) {
  return worker(context, "compute", host, binary, region, {
    availabilityZone: "internal",
    ...fields,
  });
}

export function neutronAgent(context, host, binary, region, fields = {}) {
  return worker(context, "network", host, binary, region, fields);
}

export function cinderService(context, host, binary, region, fields = {}) {
  return worker(context, "volume", host, binary, region, {
    availabilityZone: "nova",
    ...fields,
  });
}

/*
 * A hypervisor (gazpacho-ovs/healthy): its name is the full host name, its state its
 * nova-compute's, and its numbers Placement's: what is promised, and what can be.
 */
export function hypervisor(context, host, region, fields = {}) {
  return stamped(
    {
      kind: "Hypervisor",
      externalId: `${region}/${host}`,
      name: host,
      regionName: region,
      hypervisorName: host,
      availabilityZone: "nova",
      status: "up",
      adminState: "enabled",
      vcpuCapacity: 128,
      vcpuAllocated: 40,
      memoryCapacityBytes: 512 * GIB,
      memoryAllocatedBytes: 180 * GIB,
      diskCapacityBytes: 4 * TIB,
      diskAllocatedBytes: TIB,
      instanceCount: 0,
      ...fields,
      facts: {
        allocationRatios: { VCPU: 4, MEMORY_MB: 1, DISK_GB: 1 },
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

/*
 * An instance (gazpacho-ovs/healthy): its ID is a UUID, unique across the cloud, its
 * hypervisor the full name. One that failed before it was placed names no hypervisor.
 */
export function instance(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Instance",
      externalId: openStackUuid("2e1cfc3e", number),
      name,
      regionName: region,
      availabilityZone: "nova",
      status: "ACTIVE",
      ...fields,
      facts: {
        flavorId: "e1f7b459-cdec-4d8b-bed9-a40aff02b79a",
        userId: "717f073da16a4f37ad3bc94a40db1210",
        libvirtName: `instance-${String(number).padStart(8, "0")}`,
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

// A volume (gazpacho-ovs/healthy): Cinder's words are lower case, and its size is GiB.
export function volume(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Volume",
      externalId: openStackUuid("0ccef2fb", number),
      name,
      regionName: region,
      availabilityZone: "nova",
      status: "available",
      diskCapacityBytes: 20 * GIB,
      ...fields,
      facts: {
        volumeType: "lvmdriver-1",
        isBootable: false,
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

// A Cinder pool (gazpacho-ovs/healthy): host@backend#pool, free of what it holds.
export function storagePool(context, name, region, fields = {}) {
  return stamped(
    {
      kind: "StoragePool",
      externalId: `${region}/${name}`,
      name,
      regionName: region,
      diskCapacityBytes: 40 * TIB,
      diskAllocatedBytes: 16 * TIB,
      ...fields,
      facts: {
        backend: name.substring(name.indexOf("#") + 1),
        vendor: "Open Source",
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

/*
 * A network (gazpacho-ovs/healthy): addresses used and total are added up across its
 * subnets, and are what the external pool rules read.
 */
export function network(context, number, name, region, fields = {}) {
  const total = fields.ipsTotal ?? 253;
  const used = fields.ipsUsed ?? 20;
  const rest = { ...fields };
  delete rest.ipsTotal;
  delete rest.ipsUsed;
  return stamped(
    {
      kind: "Network",
      externalId: openStackUuid("5864aa47", number),
      name,
      regionName: region,
      status: "ACTIVE",
      ...rest,
      facts: {
        isExternal: false,
        isShared: false,
        networkType: "vxlan",
        mtu: 1450,
        ipsTotal: total,
        ipsUsed: used,
        ipsBySubnet: {
          [`${name}-subnet`]: { total, used, cidr: "10.77.0.0/24" },
        },
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

export function subnet(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Subnet",
      externalId: openStackUuid("1ad452fc", number),
      name,
      regionName: region,
      ...fields,
      facts: {
        networkId: openStackUuid("5864aa47", number),
        cidr: "10.77.0.0/24",
        gatewayIp: "10.77.0.1",
        enableDhcp: true,
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

/*
 * A router (gazpacho-ovs/healthy). l3Agents is which agents hold it, and is missing on
 * OVN, which has none (hibiscus-ovn/healthy).
 */
export function router(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Router",
      externalId: openStackUuid("d2e32d55", number),
      name,
      regionName: region,
      status: "ACTIVE",
      adminState: "up",
      ...fields,
      facts: {
        externalNetworkId: openStackUuid("5864aa47", 1),
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

// One entry of a router's l3Agents, by the agent's ID.
export function l3Agent(host, fields = {}) {
  return {
    host,
    isAlive: true,
    isAdminUp: true,
    haState: null,
    ...fields,
  };
}

/*
 * A floating IP (gazpacho-ovs/healthy): named by its address, and in use when Neutron
 * has set its router. A spare address is meant to read DOWN.
 */
export function floatingIp(context, number, address, region, fields = {}) {
  return stamped(
    {
      kind: "FloatingIp",
      externalId: openStackUuid("3774c4cb", number),
      name: address,
      regionName: region,
      status: "ACTIVE",
      ...fields,
      facts: {
        routerId: null,
        floatingNetworkId: openStackUuid("5864aa47", 1),
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

// A project (gazpacho-ovs/healthy): global to a Keystone, so it carries no region.
export function project(context, number, name, fields = {}) {
  const id = keystoneId(number);
  return stamped(
    {
      kind: "Project",
      externalId: id,
      name,
      openStackProjectId: id,
      status: "enabled",
      ...fields,
      facts: {
        domainId: "default",
        parentId: "default",
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

export function projectIdOf(number) {
  return keystoneId(number);
}

export function domain(context, name, fields = {}) {
  return stamped(
    {
      kind: "Domain",
      externalId: name.toLowerCase(),
      name,
      status: "enabled",
      ...fields,
      facts: { ...(fields.facts || {}) },
    },
    context,
  );
}

// A flavor (gazpacho-ovs/healthy): its capacity columns hold what it asks for.
export function flavor(context, id, name, region, fields = {}) {
  return stamped(
    {
      kind: "Flavor",
      externalId: `${region}/${id}`,
      name,
      regionName: region,
      vcpuCapacity: 2,
      memoryCapacityBytes: 4 * GIB,
      diskCapacityBytes: 40 * GIB,
      ...fields,
      facts: { isPublic: true, ...(fields.facts || {}) },
    },
    context,
  );
}

// An image (gazpacho-ovs/healthy): Glance's words are lower case.
export function image(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Image",
      externalId: openStackUuid("79490afb", number),
      name,
      regionName: region,
      status: "active",
      diskCapacityBytes: 21 * 1024 * 1024,
      ...fields,
      facts: {
        visibility: "public",
        isHidden: false,
        createdAtSeconds: Math.floor(context.loadedAt / 1000) - 30 * 86400,
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

export function snapshot(context, number, name, region, fields = {}) {
  return stamped(
    {
      kind: "Snapshot",
      externalId: openStackUuid("4e32faf8", number),
      name,
      regionName: region,
      status: "available",
      diskCapacityBytes: 20 * GIB,
      ...fields,
      facts: {
        volumeId: openStackUuid("0ccef2fb", 1),
        ...(fields.facts || {}),
      },
    },
    context,
  );
}

/*
 * ---------------------------------------------------------------------------
 * The cloud's row
 * ---------------------------------------------------------------------------
 */
function cloudRow(context, fields = {}) {
  return {
    _id: CLOUD_ID,
    projectId: PROJECT_ID,
    name: "acme-prod",
    description: "Acme's production OpenStack cloud.",
    otelCollectorStatus: context.isConnected ? "connected" : "disconnected",
    lastSeenAt: new Date(context.lastSeenAt),
    agentVersion: "0.161.0",
    labels: [],
    isArchived: false,
    ...fields,
  };
}

/*
 * ---------------------------------------------------------------------------
 * What every estate below is made of
 * ---------------------------------------------------------------------------
 */
const PROJECT_NAMES = [
  "acme-payments",
  "acme-research",
  "acme-web",
  "acme-data",
  "acme-mobile",
  "acme-batch",
  "acme-security",
];

function projects(context) {
  return [
    domain(context, "Default"),
    ...PROJECT_NAMES.map((name, index) => {
      return project(context, index + 1, name);
    }),
  ];
}

function apis(context, region, downServices = []) {
  return [
    ["identity", 0.08],
    ["compute", 0.29],
    ["placement", 0.06],
    ["network", 0.2],
    ["volume", 0.55],
    ["image", 0.04],
  ].map(([service, seconds]) => {
    const isDown = downServices.includes(service);
    return api(context, service, region, {
      status: isDown ? "down" : "up",
      ...(isDown ? { since: 40 * MINUTE } : {}),
      facts: { collectionSeconds: seconds },
    });
  });
}

function flavorsAndImages(context, region) {
  return [
    flavor(context, "1", "m1.tiny", region, {
      vcpuCapacity: 1,
      memoryCapacityBytes: 512 * 1024 * 1024,
      diskCapacityBytes: GIB,
    }),
    flavor(context, "3", "m1.medium", region),
    flavor(context, "5", "m1.xlarge", region, {
      vcpuCapacity: 8,
      memoryCapacityBytes: 16 * GIB,
      diskCapacityBytes: 160 * GIB,
    }),
    image(context, 1, "cirros-0.6.3-x86_64-disk", region),
    image(context, 2, "ubuntu-24.04-server", region, {
      diskCapacityBytes: 620 * 1024 * 1024,
    }),
  ];
}

/*
 * Instances on one host, spread evenly across the first `projectCount` projects: a
 * lost host then reads "42 instances in 7 projects".
 */
function instancesOn(context, data) {
  const rows = [];
  for (let index = 0; index < data.count; index++) {
    const projectNumber = (index % data.projectCount) + 1;
    rows.push(
      instance(
        context,
        data.firstNumber + index,
        `${PROJECT_NAMES[projectNumber - 1].replace("acme-", "")}-${String(index + 1).padStart(2, "0")}`,
        data.region,
        {
          hypervisorName: data.host,
          openStackProjectId: projectIdOf(projectNumber),
          ...(data.fields || {}),
        },
      ),
    );
  }
  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * busy: something wrong of every kind, in one region, on ML2/OVS.
 *
 * What Needs attention says about it, most urgent first, is what the spec holds it to
 * (BUSY_ATTENTION in OpenStackPages.spec.ts). The hosts' names follow the recordings:
 * Nova's service says compute-02 where its hypervisor says compute-02.acme.example.
 * ---------------------------------------------------------------------------
 */
function busyInventory(context) {
  const region = REGION_ONE;
  return [
    ...projects(context),
    ...apis(context, region, ["image"]),

    novaControl(context, "ctl-01", "nova-scheduler", region),
    novaControl(context, "ctl-02", "nova-scheduler", region, {
      status: "down",
      since: 25 * MINUTE,
    }),
    novaControl(context, "ctl-01", "nova-conductor", region),
    novaControl(context, "ctl-02", "nova-conductor", region),
    novaCompute(context, "compute-01", region),
    novaCompute(context, "compute-02", region, {
      status: "down",
      since: 35 * MINUTE,
    }),
    novaCompute(context, "compute-03", region),
    // Planned work, and the reason as the operator wrote it: raises nothing.
    novaCompute(context, "compute-04", region, {
      adminState: "disabled",
      disabledReason: "Replacing a DIMM, back Thursday",
      since: 2 * DAY,
    }),
    // The same, so long ago somebody probably forgot it.
    novaCompute(context, "compute-05", region, {
      adminState: "disabled",
      disabledReason: "Waiting on a new NIC",
      since: 12 * DAY,
    }),

    neutronAgent(context, "ctl-01", "neutron-dhcp-agent", region, {
      availabilityZone: "nova",
    }),
    neutronAgent(context, "ctl-01", "neutron-l3-agent", region, {
      availabilityZone: "nova",
    }),
    neutronAgent(context, "ctl-01", "neutron-metadata-agent", region),
    // Neutron's own word for it: admin down, not disabled.
    neutronAgent(context, "ctl-02", "neutron-l3-agent", region, {
      adminState: "down",
      availabilityZone: "nova",
      since: 3 * HOUR,
    }),
    neutronAgent(context, "compute-01", "neutron-openvswitch-agent", region),
    neutronAgent(context, "compute-02", "neutron-openvswitch-agent", region),
    neutronAgent(context, "compute-03", "neutron-openvswitch-agent", region, {
      status: "down",
      since: 15 * MINUTE,
    }),

    cinderService(context, "ctl-01", "cinder-scheduler", region),
    cinderService(context, "ctl-01@lvmdriver-1", "cinder-volume", region, {
      status: "down",
      since: 50 * MINUTE,
    }),
    cinderService(context, "ctl-02@ceph", "cinder-volume", region),

    // Past Placement's line: a warning, never critical, because it is a promise.
    hypervisor(context, "compute-01.acme.example", region, {
      vcpuAllocated: 118,
      memoryAllocatedBytes: 300 * GIB,
      instanceCount: 18,
    }),
    // Lost: its numbers are the last Nova had, and it is no capacity anyone can use.
    hypervisor(context, "compute-02.acme.example", region, {
      status: "down",
      since: 35 * MINUTE,
      vcpuAllocated: 96,
      memoryAllocatedBytes: 384 * GIB,
      instanceCount: 42,
    }),
    hypervisor(context, "compute-03.acme.example", region, {
      vcpuAllocated: 30,
      instanceCount: 8,
    }),
    hypervisor(context, "compute-04.acme.example", region, {
      adminState: "disabled",
      disabledReason: "Replacing a DIMM, back Thursday",
      since: 2 * DAY,
      vcpuAllocated: 0,
      memoryAllocatedBytes: 0,
      instanceCount: 0,
    }),
    hypervisor(context, "compute-05.acme.example", region, {
      adminState: "disabled",
      disabledReason: "Waiting on a new NIC",
      since: 12 * DAY,
      vcpuAllocated: 12,
      instanceCount: 3,
    }),

    ...instancesOn(context, {
      firstNumber: 1,
      count: 18,
      projectCount: 3,
      host: "compute-01.acme.example",
      region,
    }),
    ...instancesOn(context, {
      firstNumber: 100,
      count: 42,
      projectCount: 7,
      host: "compute-02.acme.example",
      region,
    }),
    ...instancesOn(context, {
      firstNumber: 200,
      count: 8,
      projectCount: 2,
      host: "compute-03.acme.example",
      region,
    }),
    ...instancesOn(context, {
      firstNumber: 300,
      count: 3,
      projectCount: 1,
      host: "compute-05.acme.example",
      region,
    }),
    // Failed before it was placed, as a real one reads: no hypervisor.
    instance(context, 400, "ou-failed", region, {
      status: "ERROR",
      availabilityZone: undefined,
      openStackProjectId: projectIdOf(1),
      since: 6 * HOUR,
    }),
    instance(context, 401, "batch-worker-7", region, {
      status: "BUILD",
      hypervisorName: "compute-03.acme.example",
      openStackProjectId: projectIdOf(6),
      since: 3 * HOUR,
    }),
    instance(context, 402, "web-resize-1", region, {
      status: "VERIFY_RESIZE",
      hypervisorName: "compute-03.acme.example",
      openStackProjectId: projectIdOf(3),
      since: 2 * HOUR,
    }),

    volume(context, 1, "payments-db-data", region, {
      status: "in-use",
      openStackProjectId: projectIdOf(1),
      diskCapacityBytes: 2 * TIB,
      facts: { attachedToInstance: openStackUuid("2e1cfc3e", 1) },
    }),
    volume(context, 2, "research-archive", region, {
      openStackProjectId: projectIdOf(2),
      diskCapacityBytes: 6 * TIB,
    }),
    volume(context, 3, "web-assets", region, {
      status: "in-use",
      openStackProjectId: projectIdOf(3),
      diskCapacityBytes: 500 * GIB,
    }),
    volume(context, 4, "ou-vol-bad", region, {
      status: "error",
      openStackProjectId: projectIdOf(1),
      since: 5 * HOUR,
    }),
    volume(context, 5, "data-attach-1", region, {
      status: "attaching",
      openStackProjectId: projectIdOf(4),
      since: 2 * HOUR,
    }),

    storagePool(context, "ctl-01@lvmdriver-1#lvmdriver-1", region, {
      diskCapacityBytes: 20 * TIB,
      diskAllocatedBytes: 19.4 * TIB,
    }),
    storagePool(context, "ctl-02@ceph#rbd-fast", region, {
      diskCapacityBytes: 40 * TIB,
      diskAllocatedBytes: 35 * TIB,
    }),
    storagePool(context, "ctl-02@ceph#rbd-slow", region, {
      diskCapacityBytes: 100 * TIB,
      diskAllocatedBytes: 30 * TIB,
    }),

    network(context, 1, "public", region, {
      ipsTotal: 253,
      ipsUsed: 253,
      openStackProjectId: projectIdOf(1),
      facts: {
        isExternal: true,
        networkType: "flat",
        physicalNetwork: "public",
        mtu: 1500,
      },
    }),
    network(context, 2, "public-dmz", region, {
      ipsTotal: 100,
      ipsUsed: 95,
      facts: {
        isExternal: true,
        networkType: "flat",
        physicalNetwork: "dmz",
        mtu: 1500,
      },
    }),
    // A tenant's own full network is theirs to see, and must not turn the cloud red.
    network(context, 3, "research-net", region, {
      ipsTotal: 61,
      ipsUsed: 61,
      openStackProjectId: projectIdOf(2),
    }),
    network(context, 4, "web-net", region, {
      openStackProjectId: projectIdOf(3),
    }),
    subnet(context, 1, "public-subnet", region),

    router(context, 1, "payments-router", region, {
      openStackProjectId: projectIdOf(1),
      facts: {
        l3Agents: { "agent-ctl-01": l3Agent("ctl-01", { isAlive: false }) },
      },
    }),
    router(context, 2, "web-router", region, {
      status: "ERROR",
      openStackProjectId: projectIdOf(3),
      facts: { l3Agents: { "agent-ctl-01": l3Agent("ctl-01") } },
    }),
    router(context, 3, "research-router", region, {
      openStackProjectId: projectIdOf(2),
      facts: { l3Agents: { "agent-ctl-01": l3Agent("ctl-01") } },
    }),

    floatingIp(context, 1, "172.24.4.68", region, {
      status: "ACTIVE",
      openStackProjectId: projectIdOf(1),
      facts: { routerId: openStackUuid("d2e32d55", 3) },
    }),
    // In use, and not active: something should be carrying it.
    floatingIp(context, 2, "172.24.4.71", region, {
      status: "DOWN",
      openStackProjectId: projectIdOf(3),
      facts: { routerId: openStackUuid("d2e32d55", 2) },
    }),
    // A spare address is meant to be down.
    floatingIp(context, 3, "172.24.4.107", region, {
      status: "DOWN",
      openStackProjectId: projectIdOf(1),
    }),

    ...flavorsAndImages(context, region),
  ];
}

/*
 * ---------------------------------------------------------------------------
 * calm: nothing wrong, and a host someone disabled on purpose, which raises nothing.
 * ---------------------------------------------------------------------------
 */
function calmRegion(context, region, options = {}) {
  const hostNumbers = options.hostNumbers || [1, 2, 3];
  const domainSuffix = options.domainSuffix || "acme.example";
  const rows = [
    ...apis(context, region, options.downApis || []),
    novaControl(context, "ctl-01", "nova-scheduler", region),
    novaControl(context, "ctl-01", "nova-conductor", region),
    neutronAgent(context, "ctl-01", "neutron-dhcp-agent", region, {
      availabilityZone: "nova",
    }),
    neutronAgent(context, "ctl-01", "neutron-l3-agent", region, {
      availabilityZone: "nova",
    }),
    neutronAgent(context, "ctl-01", "neutron-metadata-agent", region),
    cinderService(context, "ctl-01", "cinder-scheduler", region),
    cinderService(context, "ctl-01@ceph", "cinder-volume", region),
    storagePool(context, "ctl-01@ceph#rbd", region),
    network(context, 1 + (options.numberOffset || 0), "public", region, {
      ipsTotal: 253,
      ipsUsed: 40,
      facts: {
        isExternal: true,
        networkType: "flat",
        physicalNetwork: "public",
        mtu: 1500,
      },
    }),
    network(context, 2 + (options.numberOffset || 0), "web-net", region, {
      openStackProjectId: projectIdOf(3),
    }),
    router(context, 1 + (options.numberOffset || 0), "web-router", region, {
      openStackProjectId: projectIdOf(3),
      facts: { l3Agents: { "agent-ctl-01": l3Agent("ctl-01") } },
    }),
    floatingIp(context, 1 + (options.numberOffset || 0), "172.24.4.68", region, {
      openStackProjectId: projectIdOf(3),
      facts: {
        routerId: openStackUuid("d2e32d55", 1 + (options.numberOffset || 0)),
      },
    }),
    volume(context, 1 + (options.numberOffset || 0), "web-assets", region, {
      status: "in-use",
      openStackProjectId: projectIdOf(3),
      diskCapacityBytes: 500 * GIB,
    }),
    volume(context, 2 + (options.numberOffset || 0), "payments-db-data", region, {
      status: "in-use",
      openStackProjectId: projectIdOf(1),
      diskCapacityBytes: 2 * TIB,
    }),
    ...flavorsAndImages(context, region).map((row) => {
      return {
        ...row,
        // Glance's IDs are global: each region has images of its own here.
        externalId:
          row.kind === "Image"
            ? `${row.externalId}-${region.toLowerCase()}`
            : row.externalId,
      };
    }),
  ];

  hostNumbers.forEach((number, position) => {
    const short = `compute-${String(number).padStart(2, "0")}`;
    const full = `${short}.${domainSuffix}`;
    const isDisabled = options.disabledHost === number;
    const reason = isDisabled ? "Kernel upgrade, planned" : undefined;
    rows.push(
      novaCompute(context, short, region, {
        ...(isDisabled
          ? { adminState: "disabled", disabledReason: reason, since: DAY }
          : {}),
      }),
      neutronAgent(context, short, "neutron-openvswitch-agent", region),
      hypervisor(context, full, region, {
        vcpuAllocated: isDisabled ? 0 : 40 + position * 6,
        memoryAllocatedBytes: (isDisabled ? 0 : 150 + position * 20) * GIB,
        instanceCount: isDisabled ? 0 : 10 + position,
        ...(isDisabled
          ? { adminState: "disabled", disabledReason: reason, since: DAY }
          : {}),
      }),
      ...(isDisabled
        ? []
        : instancesOn(context, {
            firstNumber: (options.numberOffset || 0) + 1000 + number * 100,
            count: 10 + position,
            projectCount: 3,
            host: full,
            region,
          })),
    );
  });

  return rows;
}

function calmInventory(context) {
  return [
    ...projects(context),
    ...calmRegion(context, REGION_ONE, { disabledHost: 3 }),
  ];
}

/*
 * ---------------------------------------------------------------------------
 * multi-region: RegionOne is calm. RegionTwo has lost its compute API, and a
 * nova-compute with instances on it. The same host name in both regions is two hosts.
 * ---------------------------------------------------------------------------
 */
function multiRegionInventory(context) {
  const two = calmRegion(context, REGION_TWO, {
    hostNumbers: [1, 2],
    domainSuffix: "two.acme.example",
    numberOffset: 5000,
    downApis: ["compute"],
  }).map((row) => {
    if (row.kind === "Service" && row.name === "nova-compute") {
      if (row.externalId.includes("compute-01")) {
        return {
          ...row,
          status: "down",
          stateChangedAt: new Date(context.loadedAt - 20 * MINUTE),
        };
      }
    }
    if (row.kind === "Hypervisor" && row.name.startsWith("compute-01.")) {
      return {
        ...row,
        status: "down",
        stateChangedAt: new Date(context.loadedAt - 20 * MINUTE),
      };
    }
    return row;
  });
  return [
    ...projects(context),
    ...calmRegion(context, REGION_ONE, { disabledHost: 3 }),
    ...two,
  ];
}

/*
 * ---------------------------------------------------------------------------
 * overflow: more instances in ERROR than Needs attention reads, so it has to say how
 * many it left out rather than read as though it had shown them all.
 * ---------------------------------------------------------------------------
 */
export const OVERFLOW_INSTANCES_IN_ERROR = 340;

/*
 * ---------------------------------------------------------------------------
 * tenants: whose everything is. Quota collection is on: acme-payments is at 90% of its
 * instance quota, acme-research has no limit, and acme-web has room. A nova-compute has
 * stopped with instances of two projects on it, and a second domain holds a project that
 * runs nothing, as real clouds' service projects do.
 * ---------------------------------------------------------------------------
 */
export const TENANT_HOST_DOWN = "cmp-down.acme.example";

function tenantsInventory(context) {
  const observedAt = new Date(context.loadedAt - MINUTE).toISOString();
  const quota = (used, limit) => {
    return { used, limit, observedAt };
  };
  const rows = calmInventory(context).map((row) => {
    if (row.kind !== "Project") {
      return row;
    }
    if (row.name === "acme-payments") {
      return {
        ...row,
        facts: {
          ...row.facts,
          [`quota:instances:${REGION_ONE}`]: quota(9, 10),
          [`quota:cores:${REGION_ONE}`]: quota(4, 80),
          [`quota:ports:${REGION_ONE}`]: quota(3, -1),
        },
      };
    }
    if (row.name === "acme-research") {
      return {
        ...row,
        facts: {
          ...row.facts,
          [`quota:instances:${REGION_ONE}`]: quota(500, -1),
        },
      };
    }
    if (row.name === "acme-web") {
      return {
        ...row,
        facts: {
          ...row.facts,
          [`quota:instances:${REGION_ONE}`]: quota(1, 10),
        },
      };
    }
    return row;
  });

  rows.push(
    domain(context, "Acme"),
    project(context, 50, "acme-empty", { facts: { domainId: "acme" } }),
    hypervisor(context, TENANT_HOST_DOWN, REGION_ONE, {
      status: "down",
      instanceCount: 3,
    }),
    novaCompute(context, "cmp-down", REGION_ONE, { status: "down" }),
    instance(context, 30001, "payments-on-a-lost-host", REGION_ONE, {
      hypervisorName: TENANT_HOST_DOWN,
      openStackProjectId: projectIdOf(1),
      facts: { labels: { team: "payments" } },
    }),
    instance(context, 30002, "payments-two-on-a-lost-host", REGION_ONE, {
      hypervisorName: TENANT_HOST_DOWN,
      openStackProjectId: projectIdOf(1),
      facts: { labels: { team: "payments" } },
    }),
    instance(context, 30003, "research-on-a-lost-host", REGION_ONE, {
      hypervisorName: TENANT_HOST_DOWN,
      openStackProjectId: projectIdOf(2),
    }),
  );

  return rows;
}

function overflowInventory(context) {
  const rows = calmInventory(context);
  for (let number = 0; number < OVERFLOW_INSTANCES_IN_ERROR; number++) {
    rows.push(
      instance(
        context,
        20000 + number,
        `batch-${String(number + 1).padStart(3, "0")}`,
        REGION_ONE,
        {
          status: "ERROR",
          openStackProjectId: projectIdOf(6),
          since: 4 * HOUR,
        },
      ),
    );
  }
  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * ovn-stale: a calm cloud on OVN, with an old record beside a live agent, as a crash or a
 * change of system-id leaves behind. No recording holds one, so it is made up, in the
 * shape OpenStackSnapshotScan writes (OpenStackSnapshotScan.test.ts holds that shape): the
 * agent reads up, and the row says which of Neutron's records are stale.
 * ---------------------------------------------------------------------------
 */
function ovnStaleInventory(context) {
  const region = REGION_ONE;
  return [
    ...projects(context),
    ...apis(context, region),
    novaControl(context, "ctl-01", "nova-scheduler", region),
    novaControl(context, "ctl-01", "nova-conductor", region),
    novaCompute(context, "compute-01", region),
    hypervisor(context, "compute-01.acme.example", region, {
      instanceCount: 4,
    }),
    neutronAgent(context, "compute-01", "ovn-controller", region, {
      facts: {
        staleAgentIds: ["a1a1a1a1-0000-4000-8000-000000000001"],
      },
    }),
    neutronAgent(context, "compute-01", "neutron-ovn-agent", region),
    cinderService(context, "ctl-01", "cinder-scheduler", region),
    cinderService(context, "ctl-01@ceph", "cinder-volume", region),
    storagePool(context, "ctl-01@ceph#rbd", region),
  ];
}

const ESTATES = {
  busy: busyInventory,
  calm: calmInventory,
  "ovn-stale": ovnStaleInventory,
  new: () => {
    return [];
  },
  "multi-region": multiRegionInventory,
  overflow: overflowInventory,
  tenants: tenantsInventory,
};

export const ESTATE_NAMES = Object.keys(ESTATES);

// What a credential that can only read its own project sees (the access recordings).
const LISTS_A_PROJECT_VIEW_CANNOT_READ = new Set([
  "Service",
  "Hypervisor",
  "StoragePool",
]);

/*
 * buildEstate({ estate, recording, recordedRows, isConnected, quietFor, access },
 * loadedAt): the cloud's row and its inventory.
 *
 * `quietFor`: how long ago the agent last reported, when it has stopped. Rows keep what
 * they last said, as a real cloud's do, which is what makes this a test of a page that
 * is told nothing new.
 */
export function buildEstate(scenario, loadedAt) {
  const lastSeenAt = scenario.isConnected
    ? loadedAt - MINUTE
    : loadedAt - scenario.quietFor;
  const context = {
    loadedAt,
    lastSeenAt,
    isConnected: scenario.isConnected,
  };

  const made = scenario.recordedRows
    ? scenario.recordedRows
    : ESTATES[scenario.estate](context);

  const inventory = made
    .filter((row) => {
      return (
        scenario.access !== "project" ||
        !LISTS_A_PROJECT_VIEW_CANNOT_READ.has(row.kind)
      );
    })
    .map((row, index) => {
      return {
        ...row,
        _id: uuid("73000000", index + 1),
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      };
    });

  const isNew = !scenario.recordedRows && scenario.estate === "new";

  return {
    name: scenario.recording || scenario.estate,
    cloud: cloudRow(
      context,
      isNew
        ? { otelCollectorStatus: "disconnected", lastSeenAt: undefined }
        : scenario.recordedRows
          ? { name: "devstack" }
          : {},
    ),
    inventory,
  };
}
