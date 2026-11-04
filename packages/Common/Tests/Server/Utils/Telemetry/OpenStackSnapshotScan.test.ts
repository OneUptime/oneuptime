import {
  OpenStackResourceBufferEntry,
  OPENSTACK_API_UP_METRIC_NAMES,
  OPENSTACK_SNAPSHOT_METRIC_NAMES,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  finishOpenStackResource,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";
import { isOpenStackFloatingIpAssociated } from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";

/*
 * The OpenStack snapshot scan, fed with OTLP datapoints in the exact JSON shape
 * the prometheus receiver sends: a value, a time and a raw key/stringValue
 * attribute array. Its labels are the exporter's own. What each failure really
 * does to these series is pinned on recordings from a real cloud in
 * OpenStackSnapshotScanRecordings.test.ts.
 */

const BASE_MS: number = 1700000000000;
const GIB: number = 1024 * 1024 * 1024;
const MIB: number = 1024 * 1024;

type LabelMap = Record<string, string>;
type Buffer = Map<string, OpenStackResourceBufferEntry>;

function datapoint(data: {
  value: number;
  atMs?: number;
  labels?: LabelMap;
  region?: string | null;
}): JSONObject {
  const labels: LabelMap = { ...(data.labels || {}) };
  if (data.region !== null) {
    labels["openstack.region.name"] = data.region || "RegionOne";
  }
  return {
    asDouble: data.value,
    timeUnixNano: `${data.atMs ?? BASE_MS}000000`,
    attributes: Object.entries(labels).map(([key, value]: [string, string]) => {
      return { key, value: { stringValue: value } };
    }),
  } as unknown as JSONObject;
}

function fold(
  buffer: Buffer,
  metricName: string,
  data: Parameters<typeof datapoint>[0],
): void {
  bufferOpenStackSnapshotMetric({
    metricName,
    datapoint: datapoint(data),
    buffer,
  });
}

function rowOf(
  buffer: Buffer,
  kind: OpenStackResourceKind,
  externalId: string,
): OpenStackResourceBufferEntry {
  const row: OpenStackResourceBufferEntry | undefined = buffer.get(
    `${kind}/${externalId}`,
  );
  if (!row) {
    throw new Error(
      `no ${kind} row ${externalId}; have ${Array.from(buffer.keys()).join(", ")}`,
    );
  }
  return finishOpenStackResource(row);
}

describe("isOpenStackSnapshotDatapoint", () => {
  test("takes the series it knows and skips the rest", () => {
    for (const metricName of OPENSTACK_SNAPSHOT_METRIC_NAMES) {
      expect(
        isOpenStackSnapshotDatapoint({
          metricName,
          datapoint: datapoint({ value: 1 }),
        }),
      ).toBe(true);
    }
    expect(
      isOpenStackSnapshotDatapoint({
        metricName: "openstack_nova_quota_cores",
        datapoint: datapoint({ value: 1 }),
      }),
    ).toBe(false);
  });

  test("takes the receiver's up series only with the label the agent's jobs add", () => {
    expect(
      isOpenStackSnapshotDatapoint({
        metricName: "up",
        datapoint: datapoint({
          value: 0,
          labels: { openstack_service: "compute" },
        }),
      }),
    ).toBe(true);
    expect(
      isOpenStackSnapshotDatapoint({
        metricName: "up",
        datapoint: datapoint({ value: 0 }),
      }),
    ).toBe(false);
  });
});

describe("an API's state", () => {
  test("every service's _up series names a service", () => {
    expect(new Set(OPENSTACK_API_UP_METRIC_NAMES.values())).toEqual(
      new Set(Object.values(OpenStackServiceType)),
    );
  });

  test("up, in its region, and the time of the last good read", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_up", { value: 1 });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Api,
      "RegionOne/compute",
    );
    expect(row.status).toBe("up");
    expect(row.name).toBe("compute");
    expect(row.regionName).toBe("RegionOne");
    expect(row.facts["vouchedAt"]).toBe(new Date(BASE_MS).toISOString());
  });

  test("down keeps no time of a good read, because facts merge key by key and a null would erase the one stored", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_up", { value: 0 });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Api,
      "RegionOne/compute",
    );
    expect(row.status).toBe("down");
    expect(Object.keys(row.facts)).not.toContain("vouchedAt");
  });

  test("a failed scrape says down, for the service it asked about", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "up", {
      value: 0,
      labels: { openstack_service: "network" },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Api,
      "RegionOne/network",
    );
    expect(row.status).toBe("down");
    expect(row.facts["scrapeFailed"]).toBe(true);
  });

  test("a good scrape says nothing about the API: only the exporter's own series does", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "up", {
      value: 1,
      labels: { openstack_service: "compute" },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Api,
      "RegionOne/compute",
    );
    expect(row.status).toBeNull();
    expect(row.facts["scrapeFailed"]).toBe(false);
  });

  test("the same service in two regions is two rows", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_up", { value: 1, region: "RegionOne" });
    fold(buffer, "openstack_nova_up", { value: 0, region: "RegionTwo" });
    expect(
      rowOf(buffer, OpenStackResourceKind.Api, "RegionOne/compute").status,
    ).toBe("up");
    expect(
      rowOf(buffer, OpenStackResourceKind.Api, "RegionTwo/compute").status,
    ).toBe("down");
  });
});

describe("services and agents", () => {
  test("keeps Nova's words", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_agent_state", {
      value: 0,
      labels: {
        id: "288",
        hostname: "compute-01",
        service: "nova-compute",
        adminState: "disabled",
        zone: "nova",
        disabledReason: "replacing a DIMM",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Service,
      "RegionOne/compute/compute-01/nova-compute",
    );
    expect(row.name).toBe("nova-compute");
    expect(row.status).toBe("down");
    expect(row.adminState).toBe("disabled");
    expect(row.disabledReason).toBe("replacing a DIMM");
    expect(row.availabilityZone).toBe("nova");
    expect(row.hypervisorName).toBe("compute-01");
    expect(row.facts["family"]).toBe("compute");
  });

  test("keeps Neutron's words, and an agent's host is not a hypervisor", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_neutron_agent_state", {
      value: 1,
      labels: {
        id: "abc",
        hostname: "network-01",
        service: "neutron-dhcp-agent",
        adminState: "up",
        availability_zone: "az-1",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Service,
      "RegionOne/network/network-01/neutron-dhcp-agent",
    );
    expect(row.status).toBe("up");
    expect(row.adminState).toBe("up");
    expect(row.availabilityZone).toBe("az-1");
    expect(row.hypervisorName).toBeNull();
    expect(row.facts["family"]).toBe("network");
  });

  test("keeps Cinder's backend in the host", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_cinder_agent_state", {
      value: 1,
      labels: {
        hostname: "devstack@lvmdriver-1",
        service: "cinder-volume",
        adminState: "enabled",
        disabledReason: "",
        zone: "nova",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Service,
      "RegionOne/volume/devstack@lvmdriver-1/cinder-volume",
    );
    expect(row.adminState).toBe("enabled");
    expect(row.disabledReason).toBeNull();
    expect(row.facts["host"]).toBe("devstack@lvmdriver-1");
  });

  test("a row with no host or binary is skipped, not guessed", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_agent_state", {
      value: 1,
      labels: { service: "nova-compute" },
    });
    fold(buffer, "openstack_nova_agent_state", {
      value: 1,
      labels: { hostname: "compute-01" },
    });
    expect(buffer.size).toBe(0);
  });

  test("the newest reading in a batch wins, whatever order it arrives in", () => {
    const buffer: Buffer = new Map();
    const labels: LabelMap = {
      hostname: "compute-01",
      service: "nova-compute",
      adminState: "enabled",
    };
    fold(buffer, "openstack_nova_agent_state", {
      value: 0,
      atMs: BASE_MS + 1000,
      labels,
    });
    fold(buffer, "openstack_nova_agent_state", {
      value: 1,
      atMs: BASE_MS,
      labels,
    });
    expect(
      rowOf(
        buffer,
        OpenStackResourceKind.Service,
        "RegionOne/compute/compute-01/nova-compute",
      ).status,
    ).toBe("down");
  });
});

describe("a hypervisor's capacity", () => {
  const resource = (
    buffer: Buffer,
    metric: string,
    resourceType: string,
    value: number,
  ): void => {
    fold(buffer, `openstack_placement_resource_${metric}`, {
      value,
      labels: { hostname: "compute-01", resourcetype: resourceType },
    });
  };

  test("Placement's answer is (total - reserved) * allocation ratio, and usage is what is promised", () => {
    const buffer: Buffer = new Map();
    resource(buffer, "total", "VCPU", 32);
    resource(buffer, "reserved", "VCPU", 2);
    resource(buffer, "allocation_ratio", "VCPU", 4);
    resource(buffer, "usage", "VCPU", 16);
    resource(buffer, "total", "MEMORY_MB", 65536);
    resource(buffer, "reserved", "MEMORY_MB", 512);
    resource(buffer, "allocation_ratio", "MEMORY_MB", 1.5);
    resource(buffer, "usage", "MEMORY_MB", 2048);
    resource(buffer, "total", "DISK_GB", 1000);
    resource(buffer, "reserved", "DISK_GB", 0);
    resource(buffer, "allocation_ratio", "DISK_GB", 1);
    resource(buffer, "usage", "DISK_GB", 40);

    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Hypervisor,
      "RegionOne/compute-01",
    );
    expect(row.vcpuCapacity).toBe(120);
    expect(row.vcpuAllocated).toBe(16);
    expect(row.memoryCapacityBytes).toBe((65536 - 512) * 1.5 * MIB);
    expect(row.memoryAllocatedBytes).toBe(2048 * MIB);
    expect(row.diskCapacityBytes).toBe(1000 * GIB);
    expect(row.diskAllocatedBytes).toBe(40 * GIB);
    expect(row.facts["allocationRatios"]).toEqual({
      VCPU: 4,
      MEMORY_MB: 1.5,
      DISK_GB: 1,
    });
  });

  test("a reservation larger than the total is no capacity, never negative", () => {
    const buffer: Buffer = new Map();
    resource(buffer, "total", "VCPU", 2);
    resource(buffer, "reserved", "VCPU", 4);
    expect(
      rowOf(buffer, OpenStackResourceKind.Hypervisor, "RegionOne/compute-01")
        .vcpuCapacity,
    ).toBe(0);
  });

  test("falls back to Nova's numbers while Placement has not answered", () => {
    const buffer: Buffer = new Map();
    const labels: LabelMap = { hostname: "compute-01", aggregates: "ssd,gpu" };
    fold(buffer, "openstack_nova_vcpus_available", { value: 32, labels });
    fold(buffer, "openstack_nova_vcpus_used", { value: 4, labels });
    fold(buffer, "openstack_nova_memory_available_bytes", {
      value: 1000,
      labels,
    });
    fold(buffer, "openstack_nova_memory_used_bytes", { value: 100, labels });
    fold(buffer, "openstack_nova_local_storage_available_bytes", {
      value: 2000,
      labels,
    });
    fold(buffer, "openstack_nova_local_storage_used_bytes", {
      value: 200,
      labels,
    });

    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Hypervisor,
      "RegionOne/compute-01",
    );
    expect(row.vcpuCapacity).toBe(32);
    expect(row.vcpuAllocated).toBe(4);
    expect(row.memoryCapacityBytes).toBe(1000);
    expect(row.memoryAllocatedBytes).toBe(100);
    expect(row.diskCapacityBytes).toBe(2000);
    expect(row.diskAllocatedBytes).toBe(200);
    expect(row.facts["aggregates"]).toBe("ssd,gpu");
    // Working numbers do not reach the stored facts.
    expect(Object.keys(row.facts)).not.toContain("novaVcpusAvailable");
  });

  test("Placement wins over Nova when both answered", () => {
    const buffer: Buffer = new Map();
    const labels: LabelMap = { hostname: "compute-01" };
    fold(buffer, "openstack_nova_vcpus_available", { value: 32, labels });
    fold(buffer, "openstack_nova_vcpus_used", { value: 4, labels });
    resource(buffer, "total", "VCPU", 32);
    resource(buffer, "allocation_ratio", "VCPU", 4);
    resource(buffer, "usage", "VCPU", 8);
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Hypervisor,
      "RegionOne/compute-01",
    );
    expect(row.vcpuCapacity).toBe(128);
    expect(row.vcpuAllocated).toBe(8);
  });

  test("reads how many instances a host runs, from its one series", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_running_vms", {
      value: 3,
      labels: {
        aggregates: "",
        availability_zone: "",
        hostname: "compute-01.example.internal",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Hypervisor,
      "RegionOne/compute-01.example.internal",
    );
    expect(row.instanceCount).toBe(3);
    // An empty label is nothing to say, not a value.
    expect(row.availabilityZone).toBeNull();
    expect(row.facts["aggregates"]).toBeUndefined();
  });

  test("a host running nothing says so, rather than saying nothing", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_running_vms", {
      value: 0,
      labels: { hostname: "compute-01" },
    });
    expect(
      rowOf(buffer, OpenStackResourceKind.Hypervisor, "RegionOne/compute-01")
        .instanceCount,
    ).toBe(0);
  });
});

describe("instances", () => {
  test("keeps Nova's status word and where it runs, keyed by its UUID", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_server_status", {
      value: 4,
      labels: {
        id: "uuid-1",
        uuid: "uuid-1",
        status: "ERROR",
        name: "web-1",
        tenant_id: "payments",
        user_id: "alice",
        hypervisor_hostname: "compute-01",
        availability_zone: "nova",
        flavor_id: "m1.small",
        address_ipv4: "10.0.0.5",
        address_ipv6: "",
      },
      region: "RegionTwo",
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Instance,
      "uuid-1",
    );
    expect(row.status).toBe("ERROR");
    expect(row.name).toBe("web-1");
    expect(row.openStackProjectId).toBe("payments");
    expect(row.hypervisorName).toBe("compute-01");
    expect(row.availabilityZone).toBe("nova");
    expect(row.regionName).toBe("RegionTwo");
    expect(row.facts["flavorId"]).toBe("m1.small");
    expect(row.facts["addressIpv4"]).toBe("10.0.0.5");
    expect(Object.keys(row.facts)).not.toContain("addressIpv6");
  });

  test("falls back to the id when the exporter sends no uuid", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_server_status", {
      value: 0,
      labels: { id: "uuid-2", status: "ACTIVE" },
    });
    expect(
      rowOf(buffer, OpenStackResourceKind.Instance, "uuid-2").status,
    ).toBe("ACTIVE");
  });
});

describe("storage", () => {
  test("a volume keeps Cinder's word, its size, and what it is attached to", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_cinder_volume_gb", {
      value: 10,
      labels: {
        id: "vol-1",
        name: "data",
        status: "error_deleting",
        tenant_id: "payments",
        availability_zone: "nova",
        bootable: "true",
        volume_type: "ceph",
        server_id: "uuid-1",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Volume,
      "vol-1",
    );
    expect(row.status).toBe("error_deleting");
    expect(row.diskCapacityBytes).toBe(10 * GIB);
    expect(row.facts["attachedToInstance"]).toBe("uuid-1");
    expect(row.facts["volumeType"]).toBe("ceph");
    expect(row.facts["isBootable"]).toBe(true);
  });

  test("a pool's used space is its total less its free", () => {
    const buffer: Buffer = new Map();
    const labels: LabelMap = {
      name: "host@rbd#rbd",
      volume_backend_name: "rbd",
      vendor_name: "Open Source",
    };
    fold(buffer, "openstack_cinder_pool_capacity_total_gb", {
      value: 100,
      labels,
    });
    fold(buffer, "openstack_cinder_pool_capacity_free_gb", {
      value: 25,
      labels,
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.StoragePool,
      "RegionOne/host@rbd#rbd",
    );
    expect(row.diskCapacityBytes).toBe(100 * GIB);
    expect(row.diskAllocatedBytes).toBe(75 * GIB);
    expect(row.facts["backend"]).toBe("rbd");
  });

  test("a pool that said only how much is free leaves used unknown, never 0", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_cinder_pool_capacity_free_gb", {
      value: 25,
      labels: { name: "host@rbd#rbd" },
    });
    expect(
      rowOf(
        buffer,
        OpenStackResourceKind.StoragePool,
        "RegionOne/host@rbd#rbd",
      ).diskAllocatedBytes,
    ).toBeNull();
  });
});

describe("networks", () => {
  test("adds addresses up across subnets, and keeps each subnet's own", () => {
    const buffer: Buffer = new Map();
    const subnet = (name: string, total: number, used: number): void => {
      const labels: LabelMap = {
        network_id: "net-1",
        network_name: "public",
        subnet_name: name,
        cidr: `10.0.${name}.0/24`,
        project_id: "admin",
      };
      fold(buffer, "openstack_neutron_network_ip_availabilities_total", {
        value: total,
        labels,
      });
      fold(buffer, "openstack_neutron_network_ip_availabilities_used", {
        value: used,
        labels,
      });
    };
    subnet("1", 250, 250);
    subnet("2", 250, 10);
    fold(buffer, "openstack_neutron_network", {
      value: 1,
      labels: {
        id: "net-1",
        name: "public",
        status: "ACTIVE",
        is_external: "true",
        is_shared: "false",
        provider_network_type: "flat",
      },
    });

    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Network,
      "net-1",
    );
    expect(row.status).toBe("ACTIVE");
    expect(row.facts["isExternal"]).toBe(true);
    expect(row.facts["isShared"]).toBe(false);
    expect(row.facts["ipsTotal"]).toBe(500);
    expect(row.facts["ipsUsed"]).toBe(260);
    expect(row.facts["ipsBySubnet"]).toEqual({
      "1": { total: 250, used: 250, cidr: "10.0.1.0/24" },
      "2": { total: 250, used: 10, cidr: "10.0.2.0/24" },
    });
  });

  test("a router keeps its status, admin state and which agents hold it", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_neutron_router", {
      value: 1,
      labels: {
        id: "router-1",
        name: "edge",
        project_id: "payments",
        admin_state_up: "true",
        status: "ACTIVE",
        external_network_id: "net-1",
      },
    });
    fold(buffer, "openstack_neutron_l3_agent_of_router", {
      value: 1,
      labels: {
        router_id: "router-1",
        l3_agent_id: "agent-1",
        ha_state: "active",
        agent_alive: "true",
        agent_admin_up: "true",
        agent_host: "network-01",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Router,
      "router-1",
    );
    expect(row.status).toBe("ACTIVE");
    expect(row.adminState).toBe("up");
    expect(row.facts["externalNetworkId"]).toBe("net-1");
    expect(row.facts["l3Agents"]).toEqual({
      "agent-1": {
        host: "network-01",
        isAlive: true,
        isAdminUp: true,
        haState: "active",
      },
    });
  });

  test("a floating IP is named by its address, and a spare one has no router", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_neutron_floating_ip", {
      value: 1,
      labels: {
        id: "fip-1",
        floating_ip_address: "203.0.113.7",
        floating_network_id: "net-public",
        status: "DOWN",
        project_id: "payments",
        router_id: "",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.FloatingIp,
      "fip-1",
    );
    expect(row.name).toBe("203.0.113.7");
    expect(row.status).toBe("DOWN");
    expect(row.facts["routerId"]).toBeNull();
    expect(isOpenStackFloatingIpAssociated(row.facts)).toBe(false);
  });

  test("a floating IP in use goes through a router", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_neutron_floating_ip", {
      value: 1,
      labels: {
        id: "fip-2",
        floating_ip_address: "203.0.113.8",
        status: "ACTIVE",
        project_id: "payments",
        router_id: "router-1",
      },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.FloatingIp,
      "fip-2",
    );
    expect(row.facts["routerId"]).toBe("router-1");
    expect(isOpenStackFloatingIpAssociated(row.facts)).toBe(true);
  });

  /*
   * Facts merge key by key in the database, so a floating IP that was released has to
   * write its router down as nothing, or it would read as in use for ever.
   */
  test("a floating IP that lost its router overwrites the old one", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_neutron_floating_ip", {
      value: 1,
      labels: { id: "fip-3", status: "DOWN", router_id: "" },
    });
    const row: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.FloatingIp,
      "fip-3",
    );
    expect(Object.keys(row.facts)).toContain("routerId");
  });
});

describe("projects and domains", () => {
  test("a domain that Keystone also lists as a project is not a project", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_identity_project_info", {
      value: 1,
      labels: {
        id: "default",
        name: "Default",
        is_domain: "true",
        enabled: "true",
      },
    });
    expect(buffer.size).toBe(0);
  });

  test("are global to the cloud, so they carry no region", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_identity_project_info", {
      value: 1,
      labels: {
        id: "p-1",
        name: "payments",
        domain_id: "default",
        enabled: "true",
        parent_id: "",
      },
    });
    fold(buffer, "openstack_identity_domain_info", {
      value: 1,
      labels: { id: "default", name: "Default", enabled: "false" },
    });
    const project: OpenStackResourceBufferEntry = rowOf(
      buffer,
      OpenStackResourceKind.Project,
      "p-1",
    );
    expect(project.status).toBe("enabled");
    expect(project.openStackProjectId).toBe("p-1");
    expect(project.regionName).toBeNull();
    expect(project.facts["domainId"]).toBe("default");
    expect(
      rowOf(buffer, OpenStackResourceKind.Domain, "default").status,
    ).toBe("disabled");
  });
});

describe("what a datapoint must hold", () => {
  test("no value, no row", () => {
    const buffer: Buffer = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_up",
      datapoint: { attributes: [] } as unknown as JSONObject,
      buffer,
    });
    expect(buffer.size).toBe(0);
  });

  test("a value that is not a finite number is skipped", () => {
    const buffer: Buffer = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_up",
      datapoint: {
        asDouble: Number.NaN,
        attributes: [],
      } as unknown as JSONObject,
      buffer,
    });
    expect(buffer.size).toBe(0);
  });

  test("an integer value counts, for the receiver's Int datapoints", () => {
    const buffer: Buffer = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_up",
      datapoint: { asInt: "1", attributes: [] } as unknown as JSONObject,
      buffer,
    });
    expect(buffer.size).toBe(1);
  });

  test("a series with no region still lands, under a key of its own", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_up", { value: 1, region: null });
    expect(
      rowOf(buffer, OpenStackResourceKind.Api, "default/compute").regionName,
    ).toBeNull();
  });

  test("an unknown series name adds nothing", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_quota_cores", { value: 1 });
    expect(buffer.size).toBe(0);
  });
});

describe("a batch's rows, joined", () => {
  const FULL_NAME: string = "compute-01.example.internal";

  const withCompute = (labels: LabelMap, value: number = 1): Buffer => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_vcpus_used", {
      value: 3,
      labels: { hostname: FULL_NAME, availability_zone: "" },
    });
    fold(buffer, "openstack_nova_agent_state", {
      value,
      labels: {
        hostname: "compute-01",
        service: "nova-compute",
        adminState: "enabled",
        zone: "az-1",
        ...labels,
      },
    });
    return buffer;
  };

  const hypervisorOf = (buffer: Buffer): OpenStackResourceBufferEntry => {
    const row: OpenStackResourceBufferEntry | undefined = finishOpenStackBatch(
      buffer.values(),
    ).find((entry: OpenStackResourceBufferEntry) => {
      return entry.kind === OpenStackResourceKind.Hypervisor;
    });
    expect(row).toBeDefined();
    return row!;
  };

  test("a hypervisor is as alive as its nova-compute, across its two names", () => {
    expect(hypervisorOf(withCompute({})).status).toBe("up");
    expect(hypervisorOf(withCompute({}, 0)).status).toBe("down");
  });

  test("a hypervisor someone disabled says so, with the reason", () => {
    const row: OpenStackResourceBufferEntry = hypervisorOf(
      withCompute({ adminState: "disabled", disabledReason: "new disks" }),
    );
    expect(row.adminState).toBe("disabled");
    expect(row.disabledReason).toBe("new disks");
  });

  test("a hypervisor in no aggregate is in its nova-compute's zone", () => {
    expect(hypervisorOf(withCompute({})).availabilityZone).toBe("az-1");
  });

  test("an aggregate's zone is not overruled", () => {
    const buffer: Buffer = withCompute({});
    fold(buffer, "openstack_nova_vcpus_available", {
      value: 8,
      labels: { hostname: FULL_NAME, availability_zone: "az-2" },
    });
    expect(hypervisorOf(buffer).availabilityZone).toBe("az-2");
  });

  test("a nova-compute in another region is another machine", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_nova_vcpus_used", {
      value: 3,
      labels: { hostname: FULL_NAME },
      region: "RegionOne",
    });
    fold(buffer, "openstack_nova_agent_state", {
      value: 0,
      labels: {
        hostname: "compute-01",
        service: "nova-compute",
        adminState: "enabled",
      },
      region: "RegionTwo",
    });
    expect(hypervisorOf(buffer).status).toBeNull();
  });

  test("another machine's nova-compute says nothing about this one", () => {
    const buffer: Buffer = withCompute({ hostname: "compute-02" }, 0);
    expect(hypervisorOf(buffer).status).toBeNull();
  });

  test("a batch with only a hypervisor's numbers leaves its state to the last one", () => {
    const buffer: Buffer = new Map();
    fold(buffer, "openstack_placement_resource_usage", {
      value: 3,
      labels: { hostname: FULL_NAME, resourcetype: "VCPU" },
    });
    expect(hypervisorOf(buffer).status).toBeNull();
    expect(hypervisorOf(buffer).adminState).toBeNull();
  });
});
