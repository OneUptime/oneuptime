import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { getOpenStackMetricByMetricName } from "Common/Types/Monitor/OpenStackMetricCatalog";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackComputeInventory,
  OpenStackIdentityInventory,
  OpenStackImageInventory,
  OpenStackNetworkInventory,
  OpenStackPlacementInventory,
  OpenStackVolumeInventory,
} from "../../../Utils/OpenStack/OpenStackInventory";
import OpenStackOtlpBuilder, {
  MAX_LABEL_VALUE_LENGTH,
  compareDatapointsAsTheExporterDoes,
  OpenStackOtlpBuildResult,
  OpenStackServiceReading,
  stableCinderServiceUuid,
} from "../../../Utils/OpenStack/OpenStackOtlpBuilder";
import { ReportedDatapoint, datapointsOf } from "./Helpers/CollectorHarness";

/*
 * What was read, as the series the agent sends. The parity suite holds the common case to
 * a real exporter on a real cloud. This is for what a healthy DevStack never shows:
 * every status code, a series that is opt-in, a backend that says "infinite", a tenant's
 * very long name, and what the probe's own additions look like.
 */

const OBSERVED_AT: number = Date.parse("2026-11-04T12:00:00.000Z");

function reading(
  service: OpenStackServiceType,
  inventory: OpenStackServiceReading["inventory"],
  overrides: Partial<OpenStackServiceReading> = {},
): OpenStackServiceReading {
  return {
    service: service,
    regionName: "RegionOne",
    inventory: inventory,
    apiUp: true,
    answered: true,
    observedAt: OBSERVED_AT,
    durationInMs: 1234,
    ...overrides,
  };
}

function build(data: OpenStackServiceReading): Array<ReportedDatapoint> {
  return datapointsOf(
    OpenStackOtlpBuilder.build([data], "1.2.3").resourceMetrics,
  );
}

function named(
  points: Array<ReportedDatapoint>,
  metric: string,
): Array<ReportedDatapoint> {
  return points.filter((point: ReportedDatapoint): boolean => {
    return point.metric === metric;
  });
}

const SERVER: NonNullable<OpenStackComputeInventory["servers"]>[number] = {
  id: "server-1",
  name: "web-1",
  status: "ACTIVE",
  tenantId: "project-1",
  userId: "user-1",
  accessIpv4: "",
  accessIpv6: null,
  hostId: "host-id",
  hypervisorHostname: "compute-01.example.internal",
  availabilityZone: "nova",
  flavorId: null,
  flavorName: "m1.tiny",
  instanceName: "instance-00000001",
  taskState: null,
  updatedAt: "2026-11-04T11:00:00Z",
  faultMessage: null,
};

describe("every datapoint", () => {
  test("is a gauge, at its time, with its region and service, sorted, and no empty label", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          services: [
            {
              id: "s1",
              binary: "nova-compute",
              host: "compute-01",
              zone: "nova",
              status: "enabled",
              state: "up",
              disabledReason: "",
            },
          ],
        }),
      ),
      "openstack_nova_agent_state",
    )[0]!;

    expect(point).toEqual({
      metric: "openstack_nova_agent_state",
      description: "agent_state",
      unit: undefined,
      kinds: ["gauge"],
      labels: {
        adminState: "enabled",
        hostname: "compute-01",
        id: "s1",
        "openstack.region.name": "RegionOne",
        openstack_service: "compute",
        service: "nova-compute",
        zone: "nova",
      },
      value: 1,
      timeUnixNano: `${OBSERVED_AT}000000`,
    });
  });

  test("names no cloud: only the server says which cloud a probe's data is", () => {
    const built: OpenStackOtlpBuildResult = OpenStackOtlpBuilder.build(
      [reading(OpenStackServiceType.Image, { images: [] })],
      "1.2.3",
    );

    const resource: JSONObject = built.resourceMetrics[0] as JSONObject;

    expect(resource["resource"]).toEqual({ attributes: [] });
    expect(JSON.stringify(built.resourceMetrics)).not.toContain(
      "openstack.cloud.name",
    );
    expect(JSON.stringify(built.resourceMetrics)).not.toContain(
      "oneuptime.agent.version",
    );
    expect(JSON.stringify(built.resourceMetrics)).not.toContain("service.name");
  });

  test("a label a tenant typed at length is cut, not sent whole", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          servers: [
            { ...SERVER, name: "x".repeat(MAX_LABEL_VALUE_LENGTH * 3) },
          ],
        }),
      ),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.labels["name"]?.length).toBe(MAX_LABEL_VALUE_LENGTH);
    expect(point.labels["name"]?.endsWith("…")).toBe(true);
  });

  test("each service of each region is its own resource, as one scrape is", () => {
    const built: OpenStackOtlpBuildResult = OpenStackOtlpBuilder.build(
      [
        reading(OpenStackServiceType.Image, { images: [] }),
        reading(
          OpenStackServiceType.Image,
          { images: [] },
          {
            regionName: "RegionTwo",
          },
        ),
      ],
      "1.2.3",
    );

    expect(built.resourceCount).toBe(2);
    expect(built.resourceMetrics).toHaveLength(2);
  });

  test("the datapoint count is what was really written", () => {
    const built: OpenStackOtlpBuildResult = OpenStackOtlpBuilder.build(
      [
        reading(OpenStackServiceType.Volume, {
          pools: [
            {
              name: "p",
              backendName: "b",
              vendorName: "v",
              freeCapacityGb: null,
              totalCapacityGb: 10,
            },
          ],
        }),
      ],
      "1.2.3",
    );

    // The pool's total, the _up, and the three a scrape has of its own.
    expect(built.datapointCount).toBe(5);
    expect(datapointsOf(built.resourceMetrics)).toHaveLength(5);
  });
});

describe("the order of a series' lines", () => {
  function point(labels: Record<string, string>): JSONObject {
    return {
      attributes: Object.keys(labels)
        .sort()
        .map((key: string): JSONObject => {
          return { key: key, value: { stringValue: labels[key] as string } };
        }),
    };
  }

  test.each([
    [
      "by the first label that differs",
      { a: "1", b: "2" },
      { a: "1", b: "3" },
      -1,
    ],
    ["the first label comes first", { a: "2", b: "1" }, { a: "1", b: "9" }, 1],
    ["the same is the same", { a: "1" }, { a: "1" }, 0],
    [
      "a label one has no value for is empty there",
      { b: "1" },
      { a: "x", b: "1" },
      -1,
    ],
    ["and the other way about", { a: "x", b: "1" }, { b: "1" }, 1],
    ["with one having nothing at all", {}, { a: "x" }, -1],
    ["and two having nothing", {}, {}, 0],
  ])(
    "%s",
    (
      _name: string,
      first: Record<string, string>,
      second: Record<string, string>,
      sign: number,
    ) => {
      expect(
        Math.sign(
          compareDatapointsAsTheExporterDoes(point(first), point(second)),
        ),
      ).toBe(sign);
    },
  );

  /*
   * DevStack runs two nova-conductors on a host, one a cell's and one its super's, and they
   * make one row, which keeps what the last says. So that has to be the same one the
   * exporter's text ends with, whatever order Nova listed them in.
   */
  test("the row two lines make keeps what the exporter's last line says", () => {
    const conductor: (
      id: string,
    ) => NonNullable<OpenStackComputeInventory["services"]>[number] = (
      id: string,
    ) => {
      return {
        id: id,
        binary: "nova-conductor",
        host: "compute-01",
        zone: "internal",
        status: "enabled",
        state: "up",
        disabledReason: null,
      };
    };

    for (const services of [
      [conductor("aaa"), conductor("zzz")],
      [conductor("zzz"), conductor("aaa")],
    ]) {
      const ids: Array<string | undefined> = named(
        build(reading(OpenStackServiceType.Compute, { services: services })),
        "openstack_nova_agent_state",
      ).map((line: ReportedDatapoint) => {
        return line.labels["id"];
      });

      expect(ids).toEqual(["aaa", "zzz"]);
    }
  });
});

describe("the series a collection has of its own", () => {
  test("say what happened, in the receiver's words", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(
        OpenStackServiceType.Image,
        { images: [] },
        { durationInMs: 2500 },
      ),
    );

    expect(named(points, "up")[0]).toMatchObject({
      description: "The scraping was successful",
      value: 1,
      labels: {
        "openstack.region.name": "RegionOne",
        openstack_service: "image",
      },
    });
    expect(named(points, "scrape_samples_scraped")[0]).toMatchObject({
      description: "The number of samples the target exposed",
      // openstack_glance_images, and openstack_glance_up.
      value: 2,
    });
    expect(named(points, "scrape_duration_seconds")[0]).toMatchObject({
      description: "Duration of the scrape",
      unit: "s",
      value: 2.5,
    });
  });

  test("a service that could not be asked reads `up` 0", () => {
    expect(
      named(
        build(
          reading(OpenStackServiceType.Network, undefined, {
            apiUp: null,
            answered: false,
          }),
        ),
        "up",
      )[0]?.value,
    ).toBe(0);
  });

  test("a service with no _up sends none, and its samples read 0", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, undefined, { apiUp: null }),
    );

    expect(named(points, "openstack_cinder_up")).toEqual([]);
    expect(named(points, "scrape_samples_scraped")[0]?.value).toBe(0);
  });

  test("an API that is down reads 0, and counts as a sample, as the exporter's does", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, undefined, { apiUp: false }),
    );

    expect(named(points, "openstack_cinder_up")[0]?.value).toBe(0);
    expect(named(points, "scrape_samples_scraped")[0]?.value).toBe(1);
  });

  test.each([
    [OpenStackServiceType.Identity, "openstack_identity_up"],
    [OpenStackServiceType.Compute, "openstack_nova_up"],
    [OpenStackServiceType.Placement, "openstack_placement_up"],
    [OpenStackServiceType.Network, "openstack_neutron_up"],
    [OpenStackServiceType.Volume, "openstack_cinder_up"],
    [OpenStackServiceType.Image, "openstack_glance_up"],
  ])("%s says so as %s", (service: OpenStackServiceType, metric: string) => {
    expect(named(build(reading(service, undefined)), metric)).toHaveLength(1);
  });
});

describe("an instance", () => {
  test.each([
    ["ACTIVE", 0],
    ["BUILD", 1],
    ["BUILD(spawning)", 2],
    ["ERROR", 4],
    ["HARD_REBOOT", 5],
    ["REBOOT", 7],
    ["REBUILD", 8],
    ["RESIZE", 10],
    ["SHUTOFF", 11],
    ["SUSPENDED", 12],
    ["VERIFY_RESIZE", 14],
    ["MIGRATING", 15],
    ["PAUSED", 16],
    ["SHELVED_OFFLOADED", 19],
    ["SOMETHING_NEW", -1],
  ])("%s reads as the exporter's code %s", (status: string, code: number) => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          servers: [{ ...SERVER, status: status }],
        }),
      ),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.value).toBe(code);
    expect(point.labels["status"]).toBe(status);
  });

  test("a flavor named by the server finds its id from the flavors", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          flavors: [
            {
              id: "flavor-7",
              name: "m1.tiny",
              vcpus: 1,
              ram: 512,
              disk: 1,
              isPublic: true,
            },
          ],
          servers: [SERVER],
        }),
      ),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.labels["flavor_id"]).toBe("flavor-7");
  });

  test("an older microversion's flavor id is used as it comes", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          servers: [
            { ...SERVER, flavorId: "flavor-from-server", flavorName: null },
          ],
        }),
      ),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.labels["flavor_id"]).toBe("flavor-from-server");
  });

  test("flavors that could not be read cost a label, not the instance", () => {
    const point: ReportedDatapoint = named(
      build(reading(OpenStackServiceType.Compute, { servers: [SERVER] })),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.labels["flavor_id"]).toBeUndefined();
    expect(point.labels["name"]).toBe("web-1");
  });

  test("what only a native collector knows is there, and marked in the catalogue", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Compute, {
          servers: [
            {
              ...SERVER,
              status: "ERROR",
              taskState: "spawning",
              faultMessage: "No valid host was found.",
            },
          ],
        }),
      ),
      "openstack_nova_server_status",
    )[0]!;

    expect(point.labels).toMatchObject({
      task_state: "spawning",
      updated_at: "2026-11-04T11:00:00Z",
      fault_message: "No valid host was found.",
    });

    expect(
      getOpenStackMetricByMetricName("openstack_nova_server_status")
        ?.probeOnlyAttributes,
    ).toEqual(["task_state", "updated_at", "fault_message"]);
  });

  test("a hypervisor has its capacity only while Nova says it", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Compute, {
        hypervisors: [
          {
            hostname: "compute-01.example.internal",
            serviceHost: "compute-01",
            runningVms: 3,
            currentWorkload: null,
            vcpus: null,
            vcpusUsed: null,
            memoryMb: null,
            memoryMbUsed: null,
            localGb: null,
            localGbUsed: null,
            freeDiskGb: null,
          },
        ],
      }),
    );

    expect(named(points, "openstack_nova_running_vms")[0]?.value).toBe(3);
    expect(named(points, "openstack_nova_vcpus_available")).toEqual([]);
    expect(named(points, "openstack_nova_memory_used_bytes")).toEqual([]);
  });

  test("a hypervisor's zone and groups come from its aggregates, by its service's host", () => {
    const hypervisors: OpenStackComputeInventory["hypervisors"] = [
      {
        hostname: "compute-01.example.internal",
        serviceHost: "compute-01",
        runningVms: 1,
        currentWorkload: 0,
        vcpus: 4,
        vcpusUsed: 1,
        memoryMb: 1024,
        memoryMbUsed: 512,
        localGb: 10,
        localGbUsed: 1,
        freeDiskGb: 9,
      },
    ];

    const point: (inventory: OpenStackComputeInventory) => ReportedDatapoint = (
      inventory: OpenStackComputeInventory,
    ): ReportedDatapoint => {
      return named(
        build(reading(OpenStackServiceType.Compute, inventory)),
        "openstack_nova_vcpus_used",
      )[0]!;
    };

    const labels: Record<string, string> = point({
      hypervisors: hypervisors,
      aggregates: [
        {
          name: "zebra-hosts",
          availabilityZone: null,
          hosts: ["compute-01"],
          isZoneOnly: false,
        },
        {
          name: "alpha-hosts",
          availabilityZone: null,
          hosts: ["compute-01"],
          isZoneOnly: false,
        },
        {
          name: "zone-only",
          availabilityZone: "az-east",
          hosts: ["compute-01"],
          isZoneOnly: true,
        },
      ],
    }).labels;

    expect(labels["availability_zone"]).toBe("az-east");
    // Sorted, and without the one that only exists to set a zone.
    expect(labels["aggregates"]).toBe("alpha-hosts,zebra-hosts");
  });

  test("bytes are bytes: Nova's MiB and GiB are converted as the exporter does", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Compute, {
        hypervisors: [
          {
            hostname: "h",
            serviceHost: "h",
            runningVms: 0,
            currentWorkload: 0,
            vcpus: 0,
            vcpusUsed: 0,
            memoryMb: 2,
            memoryMbUsed: 1,
            localGb: 2,
            localGbUsed: 1,
            freeDiskGb: -3,
          },
        ],
      }),
    );

    expect(
      named(points, "openstack_nova_memory_available_bytes")[0]?.value,
    ).toBe(2 * 1024 * 1024);
    expect(
      named(points, "openstack_nova_local_storage_used_bytes")[0]?.value,
    ).toBe(1024 * 1024 * 1024);
    // A hypervisor promised more than it has: the catalogue says this can go negative.
    expect(named(points, "openstack_nova_free_disk_bytes")[0]?.value).toBe(
      -3 * 1024 * 1024 * 1024,
    );
  });
});

describe("Neutron", () => {
  const NETWORK: NonNullable<OpenStackNetworkInventory["networks"]>[number] = {
    id: "n1",
    name: "net",
    tenantId: "p1",
    status: "ACTIVE",
    isShared: false,
    isExternal: true,
    networkType: "flat",
    physicalNetwork: "public",
    segmentationId: null,
    subnets: ["s1", "s2"],
    tags: [],
    mtu: 1500,
  };

  test.each([
    ["ACTIVE", 0],
    ["BUILD", 1],
    ["DOWN", 2],
    ["ERROR", 3],
    ["ELSE", -1],
  ])("a network %s reads as code %s", (status: string, code: number) => {
    expect(
      named(
        build(
          reading(OpenStackServiceType.Network, {
            networks: [{ ...NETWORK, status: status }],
          }),
        ),
        "openstack_neutron_network",
      )[0]?.value,
    ).toBe(code);
  });

  test("a floating IP in use has its router, and may say its port too", () => {
    const points: Array<ReportedDatapoint> = named(
      build(
        reading(OpenStackServiceType.Network, {
          floatingIps: [
            {
              id: "in-use",
              address: "172.24.4.30",
              networkId: "n1",
              routerId: "r1",
              portId: "p1",
              fixedIp: "10.0.0.5",
              status: "ACTIVE",
              projectId: "project",
            },
            {
              id: "spare",
              address: "172.24.4.31",
              networkId: "n1",
              routerId: null,
              portId: null,
              fixedIp: null,
              status: "DOWN",
              projectId: "project",
            },
          ],
        }),
      ),
      "openstack_neutron_floating_ip",
    );

    expect(points[0]?.labels).toMatchObject({
      router_id: "r1",
      port_id: "p1",
    });

    // A spare address: no label at all, not an empty one.
    expect(Object.keys(points[1]!.labels)).not.toContain("router_id");
    expect(Object.keys(points[1]!.labels)).not.toContain("port_id");
  });

  test("an address attached and not active is counted; a spare one is meant to be down", () => {
    expect(
      named(
        build(
          reading(OpenStackServiceType.Network, {
            floatingIps: [
              {
                id: "stuck",
                address: "a",
                networkId: "n",
                routerId: "r",
                portId: "p",
                fixedIp: "10.0.0.5",
                status: "ERROR",
                projectId: "x",
              },
              {
                id: "spare",
                address: "b",
                networkId: "n",
                routerId: null,
                portId: null,
                fixedIp: null,
                status: "DOWN",
                projectId: "x",
              },
            ],
          }),
        ),
        "openstack_neutron_floating_ips_associated_not_active",
      )[0]?.value,
    ).toBe(1);
  });

  test("a router not active is counted", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Network, {
        routers: [
          {
            id: "r1",
            name: "r",
            projectId: "p",
            status: "ERROR",
            isAdminUp: true,
            externalNetworkId: null,
          },
          {
            id: "r2",
            name: "r",
            projectId: "p",
            status: "ACTIVE",
            isAdminUp: false,
            externalNetworkId: "n",
          },
        ],
      }),
    );

    expect(named(points, "openstack_neutron_routers")[0]?.value).toBe(2);
    expect(
      named(points, "openstack_neutron_routers_not_active")[0]?.value,
    ).toBe(1);
    expect(
      named(points, "openstack_neutron_router").find(
        (point: ReportedDatapoint): boolean => {
          return point.labels["id"] === "r2";
        },
      )?.labels,
    ).toMatchObject({
      admin_state_up: "false",
      external_network_id: "n",
    });
  });

  test("an L3 agent says if it is alive, by value and by label", () => {
    const point: ReportedDatapoint = named(
      build(
        reading(OpenStackServiceType.Network, {
          l3Agents: [
            {
              routerId: "r1",
              agentId: "a1",
              host: "net-1",
              haState: "standby",
              isAlive: false,
              isAdminUp: true,
            },
          ],
        }),
      ),
      "openstack_neutron_l3_agent_of_router",
    )[0]!;

    expect(point.value).toBe(0);
    expect(point.labels).toMatchObject({
      router_id: "r1",
      l3_agent_id: "a1",
      ha_state: "standby",
      agent_alive: "false",
      agent_admin_up: "true",
      agent_host: "net-1",
    });
  });

  test("an IPv6 subnet's huge count is sent as the double the exporter sends", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Network, {
        ipAvailabilities: [
          {
            networkId: "n",
            networkName: "public",
            projectId: "p",
            ipVersion: 6,
            cidr: "2001:db8::/64",
            subnetName: "v6",
            totalIps: 18446744073709551614,
            usedIps: 4,
          },
        ],
      }),
    );

    expect(
      named(points, "openstack_neutron_network_ip_availabilities_total")[0]
        ?.value,
    ).toBe(1.8446744073709552e19);
  });

  test("ports, when asked for, count what the exporter counts", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Network, {
        ports: [
          {
            id: "p1",
            networkId: "n",
            macAddress: "fa:16:3e:00:00:01",
            deviceOwner: "compute:nova",
            deviceId: "server-1",
            status: "ACTIVE",
            vifType: "ovs",
            isAdminUp: true,
            fixedIps: ["10.0.0.1", "10.0.0.2"],
          },
          {
            id: "p2",
            networkId: "n",
            macAddress: "m",
            deviceOwner: "neutron:LOADBALANCERV2",
            deviceId: "",
            status: "DOWN",
            vifType: "ovs",
            isAdminUp: true,
            fixedIps: [],
          },
          {
            id: "p3",
            networkId: "n",
            macAddress: "m",
            deviceOwner: "",
            deviceId: "",
            status: "ACTIVE",
            vifType: "unbound",
            isAdminUp: false,
            fixedIps: [],
          },
        ],
      }),
    );

    expect(named(points, "openstack_neutron_ports")[0]?.value).toBe(3);
    expect(named(points, "openstack_neutron_ports_no_ips")[0]?.value).toBe(1);
    expect(
      named(points, "openstack_neutron_ports_lb_not_active")[0]?.value,
    ).toBe(1);
    expect(
      named(points, "openstack_neutron_port").find(
        (point: ReportedDatapoint): boolean => {
          return point.labels["uuid"] === "p1";
        },
      )?.labels,
    ).toMatchObject({
      uuid: "p1",
      fixed_ips: "10.0.0.1,10.0.0.2",
      binding_vif_type: "ovs",
      admin_state_up: "true",
    });
  });

  test("ports not asked for send no series at all, not a zero", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Network, { networks: [] }),
    );

    expect(named(points, "openstack_neutron_ports")).toEqual([]);
  });

  test("VPNs read as their own codes", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Network, {
        vpnServices: [
          {
            id: "v",
            projectId: "p",
            subnetId: "s",
            routerId: "r",
            isAdminUp: true,
            name: "vpn",
            externalIpv4: "1.2.3.4",
            externalIpv6: null,
            flavorId: null,
            status: "DOWN",
          },
        ],
        vpnConnections: [
          {
            id: "c",
            projectId: "p",
            isAdminUp: true,
            name: "conn",
            vpnServiceId: "v",
            ikePolicyId: "i",
            ipsecPolicyId: "s",
            peerId: "peer",
            peerEndpointGroupId: null,
            localId: null,
            localEndpointGroupId: null,
            status: "PENDING_CREATE",
          },
        ],
        vpnEndpointGroupCount: 1,
        vpnIkePolicyCount: 2,
        vpnIpsecPolicyCount: 3,
      }),
    );

    expect(named(points, "openstack_neutron_vpn_service")[0]?.value).toBe(1);
    expect(
      named(points, "openstack_neutron_vpn_siteconnection")[0]?.value,
    ).toBe(4);
    expect(named(points, "openstack_neutron_vpn_services")[0]?.value).toBe(1);
    expect(
      named(points, "openstack_neutron_vpn_siteconnections")[0]?.value,
    ).toBe(1);
    expect(
      named(points, "openstack_neutron_vpn_endpoint_groups")[0]?.value,
    ).toBe(1);
    expect(named(points, "openstack_neutron_vpn_ike_policies")[0]?.value).toBe(
      2,
    );
    expect(
      named(points, "openstack_neutron_vpn_ipsec_policies")[0]?.value,
    ).toBe(3);
  });
});

describe("Cinder", () => {
  const VOLUME: NonNullable<OpenStackVolumeInventory["volumes"]>[number] = {
    id: "v1",
    name: "data",
    status: "in-use",
    availabilityZone: "nova",
    bootable: "false",
    tenantId: "p1",
    userId: "u1",
    volumeType: "lvm",
    serverId: "server-1",
    sizeGb: 5,
    updatedAt: "2026-11-04T10:00:00.000000",
  };

  test("a volume has its size, its status and when it last changed", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, { volumes: [VOLUME] }),
    );

    expect(named(points, "openstack_cinder_volume_gb")[0]).toMatchObject({
      value: 5,
      labels: {
        status: "in-use",
        server_id: "server-1",
        updated_at: "2026-11-04T10:00:00.000000",
      },
    });
    expect(named(points, "openstack_cinder_volume_status")[0]).toMatchObject({
      value: 5,
      labels: { size: "5", status: "in-use" },
    });
    expect(named(points, "openstack_cinder_volumes")[0]?.value).toBe(1);
  });

  test("every known status reads 0 until a volume is in it, and a new one is counted too", () => {
    const counters: Array<ReportedDatapoint> = named(
      build(
        reading(OpenStackServiceType.Volume, {
          volumes: [
            VOLUME,
            { ...VOLUME, id: "v2" },
            { ...VOLUME, id: "v3", status: "something-new" },
          ],
        }),
      ),
      "openstack_cinder_volume_status_counter",
    );

    const of: (status: string) => number | undefined = (
      status: string,
    ): number | undefined => {
      return counters.find((point: ReportedDatapoint): boolean => {
        return point.labels["status"] === status;
      })?.value;
    };

    expect(counters).toHaveLength(21);
    expect(of("in-use")).toBe(2);
    expect(of("something-new")).toBe(1);
    expect(of("error")).toBe(0);
  });

  test("no volumes read still says none of each, which is what a list of nothing means", () => {
    expect(
      named(
        build(reading(OpenStackServiceType.Volume, { volumes: [] })),
        "openstack_cinder_volume_status_counter",
      ),
    ).toHaveLength(20);
  });

  test("volumes that could not be read say nothing of the kind", () => {
    expect(
      named(
        build(reading(OpenStackServiceType.Volume, { services: [] })),
        "openstack_cinder_volume_status_counter",
      ),
    ).toEqual([]);
  });

  test("snapshots and backups have their own status, which the exporter does not send", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, {
        snapshots: [
          {
            id: "s1",
            name: "nightly",
            status: "available",
            tenantId: "p1",
            volumeId: "v1",
            sizeGb: 2,
            updatedAt: "2026-11-04T01:00:00.000000",
          },
        ],
        backups: [
          {
            id: "b1",
            name: "weekly",
            status: "error",
            tenantId: "p1",
            volumeId: "v1",
            availabilityZone: "nova",
            isIncremental: true,
            sizeGb: 3,
            updatedAt: "2026-11-04T02:00:00.000000",
          },
        ],
      }),
    );

    expect(named(points, "openstack_cinder_snapshots")[0]?.value).toBe(1);
    expect(named(points, "openstack_cinder_snapshot_gb")[0]).toMatchObject({
      value: 2,
      labels: {
        id: "s1",
        name: "nightly",
        status: "available",
        tenant_id: "p1",
        volume_id: "v1",
      },
    });
    expect(named(points, "openstack_cinder_backup_gb")[0]).toMatchObject({
      value: 3,
      labels: {
        id: "b1",
        status: "error",
        is_incremental: "true",
        volume_id: "v1",
      },
    });

    for (const name of [
      "openstack_cinder_snapshot_gb",
      "openstack_cinder_backup_gb",
    ]) {
      const labels: Array<string> = [
        ...getOpenStackMetricByMetricName(name)!.identityAttributes,
      ].sort();

      expect(
        Object.keys(named(points, name)[0]!.labels)
          .filter((key: string): boolean => {
            return !key.startsWith("openstack");
          })
          .sort(),
      ).toEqual(labels);
    }
  });

  test('a backend that says "infinite" or "unknown" has no number to send', () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, {
        pools: [
          {
            name: "ceph#ceph",
            backendName: "ceph",
            vendorName: "Open Source",
            freeCapacityGb: null,
            totalCapacityGb: null,
          },
        ],
      }),
    );

    expect(named(points, "openstack_cinder_pool_capacity_free_gb")).toEqual([]);
    expect(named(points, "openstack_cinder_pool_capacity_total_gb")).toEqual(
      [],
    );
  });

  test("a non-finite number has no form in JSON, so it is never written", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, {
        pools: [
          {
            name: "p",
            backendName: "b",
            vendorName: "v",
            freeCapacityGb: Number.POSITIVE_INFINITY,
            totalCapacityGb: Number.NaN,
          },
        ],
      }),
    );

    expect(named(points, "openstack_cinder_pool_capacity_free_gb")).toEqual([]);
    expect(named(points, "openstack_cinder_pool_capacity_total_gb")).toEqual(
      [],
    );
  });

  test("a Cinder service's uuid is the same one every time, unlike the exporter's", () => {
    const first: string = stableCinderServiceUuid({
      host: "h@lvm",
      binary: "cinder-volume",
    });

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(
      stableCinderServiceUuid({ host: "h@lvm", binary: "cinder-volume" }),
    ).toBe(first);
    expect(
      stableCinderServiceUuid({ host: "h2@lvm", binary: "cinder-volume" }),
    ).not.toBe(first);
  });
});

describe("what a project may use, when asked for", () => {
  test("Nova's quotas read as the exporter's three numbers each", () => {
    const points: Array<ReportedDatapoint> = named(
      build(
        reading(OpenStackServiceType.Compute, {
          quotas: [
            {
              projectId: "p1",
              projectName: "payments",
              quotas: { cores: { inUse: 2, reserved: 0, limit: 20 } },
            },
          ],
        }),
      ),
      "openstack_nova_quota_cores",
    );

    expect(
      points.map((point: ReportedDatapoint) => {
        return [point.labels["type"], point.value];
      }),
    ).toEqual([
      ["in_use", 2],
      ["limit", 20],
      ["reserved", 0],
    ]);
    expect(points[0]?.labels).toMatchObject({
      tenant: "payments",
      tenant_id: "p1",
    });
  });

  test("Nova's limits", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Compute, {
        limits: [
          {
            projectId: "p1",
            projectName: "payments",
            maxTotalCores: 20,
            totalCoresUsed: 2,
            maxTotalRAMSize: 51200,
            totalRAMUsed: 128,
            maxTotalInstances: 10,
            totalInstancesUsed: 1,
          },
        ],
      }),
    );

    expect(named(points, "openstack_nova_limits_vcpus_max")[0]?.value).toBe(20);
    expect(named(points, "openstack_nova_limits_memory_used")[0]?.value).toBe(
      128,
    );
    expect(
      named(points, "openstack_nova_limits_instances_used")[0]?.value,
    ).toBe(1);
  });

  test("Neutron's quotas say used, where Nova's say in_use", () => {
    const points: Array<ReportedDatapoint> = named(
      build(
        reading(OpenStackServiceType.Network, {
          quotas: [
            {
              projectId: "p1",
              projectName: "payments",
              quotas: { floatingip: { used: 1, reserved: 0, limit: 50 } },
            },
          ],
        }),
      ),
      "openstack_neutron_quota_floatingip",
    );

    expect(
      points.map((point: ReportedDatapoint) => {
        return point.labels["type"];
      }),
    ).toEqual(["limit", "reserved", "used"]);
  });

  test("Cinder's limits, and a quota per volume type", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Volume, {
        limits: [
          {
            projectId: "p1",
            projectName: "payments",
            volumeMaxGb: 1000,
            volumeUsedGb: 3,
            backupMaxGb: 2000,
            backupUsedGb: 0,
            typeQuotaGb: { lvm: 100 },
          },
        ],
      }),
    );

    expect(
      named(points, "openstack_cinder_limits_volume_max_gb")[0]?.value,
    ).toBe(1000);
    expect(
      named(points, "openstack_cinder_limits_backup_used_gb")[0]?.value,
    ).toBe(0);
    expect(
      named(points, "openstack_cinder_volume_type_quota_gigabytes")[0],
    ).toMatchObject({ value: 100, labels: { volume_type: "lvm" } });
  });
});

describe("the rest", () => {
  test("Placement's allocations, by consumer", () => {
    const inventory: OpenStackPlacementInventory = {
      providers: [
        {
          uuid: "rp1",
          name: "compute-01.example.internal",
          generation: 9,
          inventories: [
            {
              resourceClass: "VCPU",
              total: 4,
              reserved: 0,
              allocationRatio: 4,
            },
          ],
          usages: { VCPU: 3 },
          allocations: [
            { consumerId: "server-1", resourceClass: "VCPU", amount: 1 },
          ],
        },
      ],
    };

    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Placement, inventory),
    );

    expect(
      named(points, "openstack_placement_resource_generation")[0]?.value,
    ).toBe(9);
    expect(
      named(points, "openstack_placement_resource_provider_allocations")[0],
    ).toMatchObject({
      value: 1,
      labels: {
        hostname: "compute-01.example.internal",
        uuid: "server-1",
        resourcetype: "VCPU",
      },
    });
  });

  test("a project's tags are joined, and a domain's enabled is a word", () => {
    const inventory: OpenStackIdentityInventory = {
      projects: [
        {
          id: "p",
          name: "payments",
          description: "",
          domainId: "default",
          parentId: "default",
          enabled: true,
          isDomain: false,
          tags: ["a", "b"],
        },
      ],
      domains: [
        { id: "default", name: "Default", description: "d", enabled: false },
      ],
    };

    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Identity, inventory),
    );

    expect(
      named(points, "openstack_identity_project_info")[0]?.labels,
    ).toMatchObject({
      tags: "a,b",
      enabled: "true",
      is_domain: "false",
    });
    expect(
      named(points, "openstack_identity_domain_info")[0]?.labels["enabled"],
    ).toBe("false");
  });

  test("an image says its size and when it was made, as Unix seconds", () => {
    const inventory: OpenStackImageInventory = {
      images: [
        {
          id: "i",
          name: "cirros",
          owner: "o",
          sizeBytes: 100,
          status: "active",
          visibility: "public",
          isHidden: false,
          imageType: "snapshot",
          createdAt: "2026-11-04T09:46:46Z",
          updatedAt: "2026-11-04T09:46:47Z",
        },
      ],
    };

    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Image, inventory),
    );

    expect(named(points, "openstack_glance_image_bytes")[0]).toMatchObject({
      value: 100,
      labels: { tenant_id: "o", image_type: "snapshot" },
    });
    expect(named(points, "openstack_glance_image_created_at")[0]).toMatchObject(
      {
        value: Date.parse("2026-11-04T09:46:46Z") / 1000,
        labels: { hidden: "false", status: "active", visibility: "public" },
      },
    );
  });

  test("a date that is not one leaves that series out, and keeps the image", () => {
    const points: Array<ReportedDatapoint> = build(
      reading(OpenStackServiceType.Image, {
        images: [
          {
            id: "i",
            name: "cirros",
            owner: "o",
            sizeBytes: 0,
            status: "queued",
            visibility: "public",
            isHidden: false,
            imageType: null,
            createdAt: "not a date",
            updatedAt: null,
          },
        ],
      }),
    );

    expect(named(points, "openstack_glance_image_created_at")).toEqual([]);
    expect(named(points, "openstack_glance_image_bytes")[0]?.value).toBe(0);
  });
});

describe("only what says whether the cloud is answering", () => {
  test("survives a collection too large to upload", () => {
    const built: OpenStackOtlpBuildResult = OpenStackOtlpBuilder.build(
      [
        reading(OpenStackServiceType.Compute, { servers: [SERVER] }),
        reading(
          OpenStackServiceType.Network,
          { networks: [] },
          { apiUp: false },
        ),
      ],
      "1.2.3",
    );

    const kept: JSONArray = OpenStackOtlpBuilder.toAvailabilityOnly(
      built.resourceMetrics,
    );

    const names: Array<string> = datapointsOf(kept)
      .map((point: ReportedDatapoint) => {
        return point.metric;
      })
      .sort();

    expect(names).toEqual([
      "openstack_neutron_up",
      "openstack_nova_up",
      "scrape_duration_seconds",
      "scrape_duration_seconds",
      "scrape_samples_scraped",
      "scrape_samples_scraped",
      "up",
      "up",
    ]);
  });
});
