import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { getOpenStackDrilledReleases } from "Common/Tests/Helpers/OpenStackRecordings";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  CONTAINER_SPECIFICITY,
  NESTABLE_CHILD_TYPES,
  REPLICA_GROUPABLE_TYPES,
  isStructuralInfrastructureType,
} from "Common/Types/Topology/TopologyTypeRules";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import { inferRelationshipType } from "Common/Utils/Telemetry/EntityRelationship";
import {
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  collectMapCards,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import { countOfType } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyCounts";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  OPENSTACK_ROOT_ID,
  OPENSTACK_TOPOLOGY_GAP_NETWORKS,
  OPENSTACK_TOPOLOGY_GAP_NETWORKS_AND_POOLS,
  OPENSTACK_TOPOLOGY_GAP_POOLS,
  OPENSTACK_TOPOLOGY_OPENS_ON,
  buildOpenStackTopology,
  getOpenStackTopologyFocus,
  getOpenStackTopologyGap,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/OpenStackTopology";
import {
  OpenStackTopologyAnswer,
  getOpenStackTopologyNotices,
  getOpenStackTopologyTruncations,
  toOpenStackRow,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/OpenStackTopologyAnswer";
import {
  ResourceTopologyFit,
  fitResourceTopology,
  getFitZoom,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFit";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  getResourceTopologyKind,
  getResourceTopologyKindKeys,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";
import {
  ResourceTopologyLayout,
  layoutResourceTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  ResourceTopologyVisible,
  computeResourceTopologyView,
  createResourceTopologyViewState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";

/*
 * An OpenStack cloud's map. Its rows are shaped as the snapshot scan writes them from
 * what real clouds answered (Common/Tests/Fixtures/OpenStack): a service knows its host by
 * the short name and a hypervisor by the full one, a volume names the instance it is
 * attached to, a floating IP its router and a router its external network. What no source
 * says (which network an instance is on, which pool holds a volume, on the agent's
 * exporter) is not drawn, and the page says so.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const FRESH: Date = new Date(NOW.getTime() - 60 * 1000);
const CLOUD: { id: string; name: string; lastSeenAt: Date } = {
  id: "60000000-0000-4000-8000-000000000001",
  name: "prod-eu",
  lastSeenAt: FRESH,
};
const LAPTOP: { width: number; height: number } = { width: 880, height: 640 };

function row(
  kind: OpenStackResourceKind,
  externalId: string,
  fields: Partial<OpenStackResource> & { facts?: JSONObject } = {},
): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind,
    externalId,
    name: externalId,
    regionName: "RegionOne",
    lastSeenAt: FRESH,
    ...fields,
  });
}

function hypervisor(
  name: string,
  fields: Partial<OpenStackResource> = {},
): OpenStackResource {
  return row(OpenStackResourceKind.Hypervisor, `RegionOne/${name}`, {
    name,
    hypervisorName: name,
    availabilityZone: "nova",
    status: "up",
    adminState: "enabled",
    vcpuCapacity: 64,
    vcpuAllocated: 16,
    ...fields,
  });
}

function compute(
  host: string,
  fields: Partial<OpenStackResource> = {},
): OpenStackResource {
  return row(
    OpenStackResourceKind.Service,
    `RegionOne/compute/${host}/nova-compute`,
    {
      name: "nova-compute",
      hypervisorName: host,
      availabilityZone: "nova",
      status: "up",
      adminState: "enabled",
      facts: { family: "compute", host },
      ...fields,
    },
  );
}

function instance(
  id: string,
  host: string,
  fields: Partial<OpenStackResource> = {},
): OpenStackResource {
  return row(OpenStackResourceKind.Instance, id, {
    hypervisorName: host,
    availabilityZone: "nova",
    openStackProjectId: "p-payments",
    status: "ACTIVE",
    ...fields,
  });
}

function issue(
  id: string,
  type: "incident" | "alert",
  seriesLabels: JSONObject,
): OpenIssueRecord {
  return {
    type,
    id,
    title: id,
    number: `#${id}`,
    severityName: "High",
    severityColor: null,
    stateName: "Created",
    createdAt: NOW,
    seriesLabels,
    relatedIds: {},
  };
}

function build(
  rows: Array<OpenStackResource>,
  more: Partial<Parameters<typeof buildOpenStackTopology>[0]> = {},
): ResourceTopologyGraph {
  return buildOpenStackTopology({
    cloud: CLOUD,
    rows,
    now: NOW,
    projectNames: { "p-payments": "ou-payments", "p-research": "ou-research" },
    ...more,
  });
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);
  if (!found) {
    throw new Error(`No part ${id}: ${Array.from(graph.nodes.keys()).join()}`);
  }
  return found;
}

const FULL_NAME: string = "compute-1.example.internal";

describe("the tree", () => {
  const graph: ResourceTopologyGraph = build([
    hypervisor(FULL_NAME),
    compute("compute-1"),
    instance("i-1", FULL_NAME),
    row(OpenStackResourceKind.Volume, "v-attached", {
      status: "in-use",
      openStackProjectId: "p-payments",
      facts: { attachedToInstance: "i-1" },
    }),
    row(OpenStackResourceKind.Volume, "v-free", {
      status: "available",
      openStackProjectId: "p-payments",
    }),
    row(OpenStackResourceKind.StoragePool, "RegionOne/host@lvm#lvm", {
      name: "host@lvm#lvm",
      diskCapacityBytes: 100,
      diskAllocatedBytes: 10,
    }),
    row(OpenStackResourceKind.Network, "n-public", {
      status: "ACTIVE",
      facts: { isExternal: true },
    }),
    row(OpenStackResourceKind.Network, "n-tenant", {
      status: "ACTIVE",
      openStackProjectId: "p-payments",
      facts: { isExternal: false },
    }),
    row(OpenStackResourceKind.Subnet, "s-1", {
      openStackProjectId: "p-payments",
      facts: { networkId: "n-tenant", cidr: "10.77.0.0/24" },
    }),
    row(OpenStackResourceKind.Router, "r-1", {
      status: "ACTIVE",
      adminState: "up",
      openStackProjectId: "p-payments",
      facts: { externalNetworkId: "n-public" },
    }),
    row(OpenStackResourceKind.FloatingIp, "f-attached", {
      name: "203.0.113.5",
      status: "ACTIVE",
      openStackProjectId: "p-payments",
      facts: { routerId: "r-1", floatingNetworkId: "n-public" },
    }),
    row(OpenStackResourceKind.FloatingIp, "f-spare", {
      name: "203.0.113.6",
      status: "DOWN",
      openStackProjectId: "p-payments",
      facts: { routerId: null, floatingNetworkId: "n-public" },
    }),
    row(OpenStackResourceKind.Api, "RegionOne/compute", {
      name: "compute",
      status: "up",
    }),
  ]);

  test("cloud, region, zone, hypervisor, instance, volume", () => {
    expect(node(graph, OPENSTACK_ROOT_ID).kind).toBe("openstack.cloud");
    expect(node(graph, "region:RegionOne").parentId).toBe(OPENSTACK_ROOT_ID);
    expect(node(graph, "az:RegionOne/nova").parentId).toBe("region:RegionOne");
    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).parentId).toBe(
      "az:RegionOne/nova",
    );
    expect(node(graph, "instance:i-1").parentId).toBe(
      `hypervisor:RegionOne/${FULL_NAME}`,
    );
    expect(node(graph, "volume:v-attached").parentId).toBe("instance:i-1");
  });

  test("a volume attached to nothing stands in its region's storage", () => {
    const parent: ResourceTopologyNode = node(
      graph,
      node(graph, "volume:v-free").parentId!,
    );

    expect(parent.isSection).toBe(true);
    expect(parent.name).toBe("Storage");
  });

  test("external network, router, floating IP", () => {
    expect(node(graph, "router:r-1").parentId).toBe("network:n-public");
    expect(node(graph, "floatingip:f-attached").parentId).toBe("router:r-1");
  });

  test("a spare floating IP stands on the network it would come from", () => {
    expect(node(graph, "floatingip:f-spare").parentId).toBe("network:n-public");
  });

  test("a subnet stands on its network", () => {
    expect(node(graph, "subnet:s-1").parentId).toBe("network:n-tenant");
  });

  test("the control plane stands apart, and a worker relates to its host", () => {
    const api: ResourceTopologyNode = node(graph, "api:RegionOne/compute");

    expect(node(graph, api.parentId!).name).toBe("Control plane");
    expect(
      graph.relationsByNode.get(
        "service:RegionOne/compute/compute-1/nova-compute",
      )?.[0],
    ).toMatchObject({ to: `hypervisor:RegionOne/${FULL_NAME}` });
  });

  test("a card says whose it is, and a search finds it by that", () => {
    expect(node(graph, "instance:i-1").facts).toEqual([
      { label: "Project", value: "ou-payments" },
    ]);
    expect(node(graph, "instance:i-1").keywords).toContain("ou-payments");
    expect(node(graph, "instance:i-1").keywords).toContain("p-payments");
  });

  test("every part has a place: nothing hangs off the cloud but its regions", () => {
    for (const part of graph.nodes.values()) {
      if (part.parentId === OPENSTACK_ROOT_ID) {
        expect(part.kind).toBe("openstack.region");
      }
    }
  });
});

describe("the kinds", () => {
  test.each([
    "openstack.cloud",
    "openstack.region",
    "openstack.az",
    "openstack.hypervisor",
    "openstack.instance",
    "openstack.volume",
    "openstack.pool",
    "openstack.network",
    "openstack.subnet",
    "openstack.router",
    "openstack.floatingip",
    "openstack.api",
    "openstack.service",
  ])("%s has its own words", (kind: string) => {
    expect(getResourceTopologyKindKeys()).toContain(kind);
    expect(getResourceTopologyKind(kind).label).not.toBe("Resource");
  });
});

describe("what is healthy is OpenStackHealth's", () => {
  test("a healthy host and what runs on it", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME),
      compute("compute-1"),
      instance("i-1", FULL_NAME),
    ]);

    expect(graph.attentionCount).toBe(0);
    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).health).toBe(
      "healthy",
    );
    expect(node(graph, "instance:i-1").health).toBe("healthy");
  });

  /*
   * The drill in #5730: a stopped nova-compute. Nova keeps reporting the host's last
   * numbers and calling its instances ACTIVE, which is exactly what must not read as fine.
   */
  describe("with a compute service stopped", () => {
    const graph: ResourceTopologyGraph = build(
      [
        hypervisor(FULL_NAME, { status: "down" }),
        compute("compute-1", { status: "down" }),
        instance("i-1", FULL_NAME),
        instance("i-2", FULL_NAME, { openStackProjectId: "p-research" }),
        instance("i-off", FULL_NAME, { status: "SHUTOFF" }),
      ],
      {
        instancesByHost: [
          {
            regionName: "RegionOne",
            hypervisorName: FULL_NAME,
            instanceCount: 3,
          },
        ],
      },
    );

    test("the host is drawn red, and says how many it held", () => {
      const host: ResourceTopologyNode = node(
        graph,
        `hypervisor:RegionOne/${FULL_NAME}`,
      );

      expect(host.health).toBe("critical");
      expect(host.reasons?.[0]?.values?.["count"]).toBe("3");
    });

    test("its instances stand beneath it, and say why", () => {
      const host: ResourceTopologyNode = node(
        graph,
        `hypervisor:RegionOne/${FULL_NAME}`,
      );

      expect(host.childIds).toContain("instance:i-1");
      expect(host.childIds).toContain("instance:i-2");
      expect(node(graph, "instance:i-1").health).toBe("warning");
      expect(node(graph, "instance:i-1").reasons?.[0]?.text).toBe(
        "Its hypervisor is down",
      );
    });

    test("one shut off on purpose loses nothing", () => {
      expect(node(graph, "instance:i-off").health).toBe("off");
    });

    test("the first view opens on it", () => {
      const visible: ResourceTopologyVisible = computeResourceTopologyView(
        graph,
        createResourceTopologyViewState(),
      );

      expect(
        visible.visibleNodeIds.has(`hypervisor:RegionOne/${FULL_NAME}`),
      ).toBe(true);
      expect(visible.visibleNodeIds.has("instance:i-1")).toBe(true);
    });
  });

  test("a host someone disabled is off, never a failure", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME, { status: "down", adminState: "disabled" }),
      compute("compute-1", {
        status: "down",
        adminState: "disabled",
        disabledReason: "maintenance",
      }),
      instance("i-1", FULL_NAME),
    ]);

    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).health).toBe("off");
    expect(node(graph, "instance:i-1").health).toBe("healthy");
    expect(graph.attentionCount).toBe(0);
  });

  test("a full host is a warning, because allocation is a promise and not load", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME, { vcpuAllocated: 99, vcpuCapacity: 100 }),
      compute("compute-1"),
    ]);

    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).health).toBe(
      "warning",
    );
  });

  test("a lost host's last numbers are not drawn as room to spare", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME, { status: "down" }),
    ]);

    expect(
      node(graph, `hypervisor:RegionOne/${FULL_NAME}`).facts?.map(
        (fact: { label: string }) => {
          return fact.label;
        },
      ),
    ).not.toContain("vCPUs allocated");
  });

  test("an instance in ERROR, a volume in error, a full pool, a router with no agent", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME),
      instance("i-bad", FULL_NAME, { status: "ERROR" }),
      row(OpenStackResourceKind.Volume, "v-bad", { status: "error" }),
      row(OpenStackResourceKind.StoragePool, "RegionOne/pool", {
        name: "pool",
        diskCapacityBytes: 100,
        diskAllocatedBytes: 99,
      }),
      row(OpenStackResourceKind.Router, "r-dead", {
        status: "ACTIVE",
        adminState: "up",
        facts: {
          l3Agents: {
            "a-1": {
              host: "net-1",
              isAlive: false,
              isAdminUp: true,
              haState: null,
            },
          },
        },
      }),
    ]);

    expect(node(graph, "instance:i-bad").health).toBe("warning");
    expect(node(graph, "volume:v-bad").health).toBe("warning");
    expect(node(graph, "pool:RegionOne/pool").health).toBe("critical");
    expect(node(graph, "router:r-dead").health).toBe("critical");
  });

  test("a spare floating IP being DOWN is what spare means", () => {
    const graph: ResourceTopologyGraph = build([
      row(OpenStackResourceKind.FloatingIp, "f-spare", {
        status: "DOWN",
        facts: { routerId: null },
      }),
    ]);

    expect(node(graph, "floatingip:f-spare").health).toBe("healthy");
  });

  test("a cloud that stopped reporting says so, and nothing below it is judged", () => {
    const old: Date = new Date(NOW.getTime() - 60 * 60 * 1000);
    const graph: ResourceTopologyGraph = buildOpenStackTopology({
      cloud: { ...CLOUD, lastSeenAt: old },
      rows: [
        hypervisor(FULL_NAME, { status: "down", lastSeenAt: old }),
        instance("i-1", FULL_NAME, { status: "ERROR", lastSeenAt: old }),
      ],
      now: NOW,
    });

    expect(node(graph, OPENSTACK_ROOT_ID).health).toBe("warning");
    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).health).toBe(
      "unknown",
    );
    expect(node(graph, "instance:i-1").health).toBe("unknown");
    expect(graph.attentionCount).toBe(1);
  });
});

describe("relations that cross the tree", () => {
  test("a router and the L3 agents that hold it", () => {
    const graph: ResourceTopologyGraph = build([
      row(
        OpenStackResourceKind.Service,
        "RegionOne/network/net-1/neutron-l3-agent",
        {
          name: "neutron-l3-agent",
          status: "up",
          adminState: "up",
          facts: { family: "network", host: "net-1", agentId: "a-1" },
        },
      ),
      row(OpenStackResourceKind.Router, "r-1", {
        status: "ACTIVE",
        facts: {
          l3Agents: {
            "a-1": {
              host: "net-1",
              isAlive: true,
              isAdminUp: true,
              haState: "active",
            },
          },
        },
      }),
    ]);

    expect(graph.relationsByNode.get("router:r-1")?.[0]).toMatchObject({
      to: "service:RegionOne/network/net-1/neutron-l3-agent",
      label: "Held by",
      inverseLabel: "Holds",
    });
  });

  test("a volume and the pool that holds it, when something says", () => {
    const graph: ResourceTopologyGraph = build([
      row(OpenStackResourceKind.StoragePool, "RegionOne/host@lvm#lvm", {
        name: "host@lvm#lvm",
      }),
      row(OpenStackResourceKind.Volume, "v-1", {
        status: "available",
        facts: { pool: "host@lvm#lvm" },
      }),
    ]);

    expect(graph.relationsByNode.get("volume:v-1")?.[0]).toMatchObject({
      to: "pool:RegionOne/host@lvm#lvm",
      label: "Stored in",
    });
  });

  test("nothing joins a volume to a pool on a guess", () => {
    const graph: ResourceTopologyGraph = build([
      row(OpenStackResourceKind.StoragePool, "RegionOne/host@lvm#lvm", {
        name: "host@lvm#lvm",
      }),
      row(OpenStackResourceKind.Volume, "v-1", { status: "available" }),
    ]);

    expect(graph.relations).toEqual([]);
  });
});

describe("an instance and the networks a probe says it is on", () => {
  const network: (
    id: string,
    fields: {
      name?: string;
      project?: string;
      region?: string;
      isShared?: boolean;
    },
  ) => OpenStackResource = (
    id: string,
    fields: {
      name?: string;
      project?: string;
      region?: string;
      isShared?: boolean;
    },
  ): OpenStackResource => {
    const part: OpenStackResource = row(OpenStackResourceKind.Network, id);
    part.name = fields.name || "private";
    part.regionName = fields.region || "RegionOne";
    if (fields.project) {
      part.openStackProjectId = fields.project;
    }
    part.facts = { isShared: Boolean(fields.isShared) };
    return part;
  };
  const onNetworks: (
    names: Array<string> | undefined,
    project?: string,
  ) => OpenStackResource = (
    names: Array<string> | undefined,
    project: string = "p-1",
  ): OpenStackResource => {
    const part: OpenStackResource = instance("i-1", FULL_NAME);
    part.regionName = "RegionOne";
    part.openStackProjectId = project;
    part.facts = names ? { networkNames: names } : {};
    return part;
  };
  const joinsOf: (rows: Array<OpenStackResource>) => Array<string> = (
    rows: Array<OpenStackResource>,
  ): Array<string> => {
    return build(rows)
      .relations.filter((relation: { from: string }): boolean => {
        return relation.from.startsWith("instance:");
      })
      .map((relation: { to: string }): string => {
        return relation.to;
      });
  };

  test("joins it to the one by that name", () => {
    expect(
      joinsOf([onNetworks(["private"]), network("n-1", { project: "p-1" })]),
    ).toEqual(["network:n-1"]);
  });

  test("to each of them", () => {
    expect(
      joinsOf([
        onNetworks(["private", "storage"]),
        network("n-1", { project: "p-1" }),
        network("n-2", { name: "storage", project: "p-1" }),
      ]),
    ).toEqual(["network:n-1", "network:n-2"]);
  });

  test("its own project's first, when every project has a private", () => {
    expect(
      joinsOf([
        onNetworks(["private"]),
        network("n-1", { project: "p-2" }),
        network("n-2", { project: "p-1" }),
        network("n-3", { project: "p-3" }),
      ]),
    ).toEqual(["network:n-2"]);
  });

  test("then one shared with it", () => {
    expect(
      joinsOf([
        onNetworks(["public"]),
        network("n-1", { name: "public", project: "p-2" }),
        network("n-2", { name: "public", project: "p-3", isShared: true }),
      ]),
    ).toEqual(["network:n-2"]);
  });

  test("not another region's", () => {
    expect(
      joinsOf([
        onNetworks(["private"]),
        network("n-1", { project: "p-1", region: "RegionTwo" }),
      ]),
    ).toEqual([]);
  });

  test("nothing at all when the name does not say which", () => {
    expect(
      joinsOf([
        onNetworks(["private"]),
        network("n-1", { project: "p-1" }),
        network("n-2", { project: "p-1" }),
      ]),
    ).toEqual([]);
    expect(
      joinsOf([
        onNetworks(["public"]),
        network("n-1", { name: "public", project: "p-2" }),
        network("n-2", { name: "public", project: "p-3" }),
      ]),
    ).toEqual([]);
  });

  test("nothing from an exporter, which does not say", () => {
    expect(
      joinsOf([onNetworks(undefined), network("n-1", { project: "p-1" })]),
    ).toEqual([]);
  });
});

describe("what real clouds answered, as a probe reads it", () => {
  /*
   * Nova's, Neutron's and Cinder's answers as the rig recorded them on a real DevStack. What the
   * probe makes of an answer is held by OpenStackExporterParity: here it is the map's joins, on
   * real names and real projects rather than ones made up to suit it.
   */
  const answer: (
    release: string,
    name: string,
    key: string,
  ) => Array<JSONObject> = (
    release: string,
    name: string,
    key: string,
  ): Array<JSONObject> => {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../Common/Tests/Fixtures/OpenStack",
          release,
          "healthy/api",
          `${name}.json`,
        ),
        "utf8",
      ),
    )[key] as Array<JSONObject>;
  };

  test.each(getOpenStackDrilledReleases())("%s", (release: string) => {
    const instances: Array<JSONObject> = answer(
      release,
      "nova-servers",
      "servers",
    );
    const volumes: Array<JSONObject> = answer(
      release,
      "cinder-volumes",
      "volumes",
    );

    const graph: ResourceTopologyGraph = build([
      ...instances.map((server: JSONObject): OpenStackResource => {
        return row(OpenStackResourceKind.Instance, server["id"] as string, {
          name: server["name"] as string,
          openStackProjectId: server["tenant_id"] as string,
          facts: {
            networkNames: Object.keys(
              (server["addresses"] as JSONObject) || {},
            ).sort(),
          },
        });
      }),
      ...answer(release, "neutron-networks", "networks").map(
        (network: JSONObject): OpenStackResource => {
          return row(OpenStackResourceKind.Network, network["id"] as string, {
            name: network["name"] as string,
            openStackProjectId: network["project_id"] as string,
            facts: {
              isShared: network["shared"] === true,
              isExternal: network["router:external"] === true,
            },
          });
        },
      ),
      ...answer(release, "cinder-pools", "pools").map(
        (pool: JSONObject): OpenStackResource => {
          return row(
            OpenStackResourceKind.StoragePool,
            `RegionOne/${pool["name"] as string}`,
            { name: pool["name"] as string },
          );
        },
      ),
      ...volumes.map((volume: JSONObject): OpenStackResource => {
        return row(OpenStackResourceKind.Volume, volume["id"] as string, {
          facts: { pool: volume["os-vol-host-attr:host"] as string },
        });
      }),
    ]);

    const joinedTo: (serverName: string) => Array<string> = (
      serverName: string,
    ): Array<string> => {
      const server: JSONObject = instances.find((one: JSONObject): boolean => {
        return one["name"] === serverName;
      })!;
      return (
        graph.relationsByNode.get(`instance:${server["id"] as string}`) || []
      )
        .filter((relation: { label: string }): boolean => {
          return relation.label === "Connected to";
        })
        .map((relation: { to: string }): string => {
          return node(graph, relation.to).name as string;
        });
    };

    expect(joinedTo("ou-running")).toEqual(["ou-net"]);
    expect(joinedTo("ou-stopped")).toEqual(["ou-net"]);
    expect(joinedTo("ou-research-1")).toEqual(["ou-research-net"]);
    expect(joinedTo("ou-failed")).toEqual([]);

    expect(volumes.length).toBeGreaterThan(0);
    for (const volume of volumes) {
      expect(
        graph.relationsByNode.get(`volume:${volume["id"] as string}`)?.[0],
      ).toMatchObject({ label: "Stored in" });
    }
  });
});

describe("what the map cannot draw, it says", () => {
  test("instances with no network", () => {
    expect(getOpenStackTopologyGap([instance("i-1", FULL_NAME)])).toBe(
      OPENSTACK_TOPOLOGY_GAP_NETWORKS,
    );
  });

  test("volumes with no pool, when the cloud holds pools", () => {
    expect(
      getOpenStackTopologyGap([
        row(OpenStackResourceKind.StoragePool, "RegionOne/pool"),
        row(OpenStackResourceKind.Volume, "v-1"),
      ]),
    ).toBe(OPENSTACK_TOPOLOGY_GAP_POOLS);
  });

  test("and both, when neither is said", () => {
    expect(
      getOpenStackTopologyGap([
        instance("i-1", FULL_NAME),
        row(OpenStackResourceKind.StoragePool, "RegionOne/pool"),
        row(OpenStackResourceKind.Volume, "v-1"),
      ]),
    ).toBe(OPENSTACK_TOPOLOGY_GAP_NETWORKS_AND_POOLS);
  });

  test("nothing about what a probe says, including an instance on no network", () => {
    const placed: OpenStackResource = row(OpenStackResourceKind.Volume, "v-1");
    placed.facts = { pool: "RegionOne/pool" };
    const joined: OpenStackResource = instance("i-1", FULL_NAME);
    joined.facts = { networkNames: ["private"] };
    const onNone: OpenStackResource = instance("i-2", FULL_NAME);
    onNone.facts = { networkNames: [] };

    expect(
      getOpenStackTopologyGap([
        joined,
        onNone,
        row(OpenStackResourceKind.StoragePool, "RegionOne/pool"),
        placed,
      ]),
    ).toBeNull();
  });

  test("still, while one instance has not said", () => {
    const joined: OpenStackResource = instance("i-1", FULL_NAME);
    joined.facts = { networkNames: ["private"] };

    expect(getOpenStackTopologyGap([joined, instance("i-2", FULL_NAME)])).toBe(
      OPENSTACK_TOPOLOGY_GAP_NETWORKS,
    );
  });

  test("and nothing when a cloud has nothing to be missing", () => {
    expect(
      getOpenStackTopologyGap([row(OpenStackResourceKind.Network, "n-1")]),
    ).toBeNull();
  });
});

describe("what is open is pinned to the part it is about", () => {
  const rows: Array<OpenStackResource> = [
    hypervisor(FULL_NAME),
    compute("compute-1"),
    instance("i-1", FULL_NAME),
    row(OpenStackResourceKind.Router, "r-1", { status: "ACTIVE" }),
    row(
      OpenStackResourceKind.Service,
      "RegionOne/network/net-1/neutron-l3-agent",
      {
        name: "neutron-l3-agent",
        status: "down",
        adminState: "up",
        facts: { family: "network", host: "net-1", agentId: "a-1" },
      },
    ),
    row(OpenStackResourceKind.StoragePool, "RegionOne/host@lvm#lvm", {
      name: "host@lvm#lvm",
    }),
  ];

  test.each([
    [
      "a nova-compute, on its host",
      {
        hostname: "compute-1",
        service: "nova-compute",
        "openstack.region.name": "RegionOne",
      },
      `hypervisor:RegionOne/${FULL_NAME}`,
    ],
    [
      "a hypervisor by its full name",
      { hostname: FULL_NAME, "openstack.region.name": "RegionOne" },
      `hypervisor:RegionOne/${FULL_NAME}`,
    ],
    [
      "another worker, on itself",
      {
        hostname: "net-1",
        service: "neutron-l3-agent",
        "openstack.region.name": "RegionOne",
      },
      "service:RegionOne/network/net-1/neutron-l3-agent",
    ],
    ["an instance by its id", { id: "i-1" }, "instance:i-1"],
    ["a router by its label", { router_id: "r-1" }, "router:r-1"],
    [
      "a pool by its name",
      { name: "host@lvm#lvm", "openstack.region.name": "RegionOne" },
      "pool:RegionOne/host@lvm#lvm",
    ],
    [
      "a region alone, on its region",
      { "openstack.region.name": "RegionOne" },
      "region:RegionOne",
    ],
    [
      "what names nothing here, on the cloud",
      { foo: "bar" },
      OPENSTACK_ROOT_ID,
    ],
  ])("%s", (_name: string, labels: JSONObject, expected: string) => {
    const graph: ResourceTopologyGraph = build(rows, {
      issues: [issue("1", "alert", labels)],
    });

    expect(
      node(graph, expected).issues.map((found: { id: string }) => {
        return found.id;
      }),
    ).toEqual(["1"]);
  });

  test("an open incident makes a part critical, whatever the rules say", () => {
    const graph: ResourceTopologyGraph = build(rows, {
      issues: [issue("1", "incident", { id: "i-1" })],
    });

    expect(node(graph, "instance:i-1").effectiveHealth).toBe("critical");
    expect(graph.incidentCount).toBe(1);
  });
});

describe("real clouds' odd rows", () => {
  test("an instance that failed before it was placed stands in its zone", () => {
    const graph: ResourceTopologyGraph = build([
      instance("i-unplaced", "", {
        status: "ERROR",
        hypervisorName: undefined,
      } as unknown as Partial<OpenStackResource>),
    ]);

    expect(node(graph, "instance:i-unplaced").parentId).toBe(
      "az:RegionOne/nova",
    );
  });

  test("a hypervisor no zone is known for says so, and is still drawn", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME, {
        availabilityZone: undefined,
      } as unknown as Partial<OpenStackResource>),
    ]);
    const parent: ResourceTopologyNode = node(
      graph,
      node(graph, `hypervisor:RegionOne/${FULL_NAME}`).parentId!,
    );

    expect(parent.isSection).toBe(true);
    expect(parent.name).toBe("No availability zone reported");
  });

  test("a part with no name reads by its id, and no region says so", () => {
    const graph: ResourceTopologyGraph = build([
      row(OpenStackResourceKind.Network, "n-1", {
        name: undefined,
        regionName: undefined,
      } as unknown as Partial<OpenStackResource>),
    ]);

    expect(node(graph, "network:n-1").name).toBe("n-1");
    expect(node(graph, "region:").name).toBe("No region reported");
  });

  test("the same host name in two regions is two hosts", () => {
    const graph: ResourceTopologyGraph = build([
      hypervisor(FULL_NAME),
      row(OpenStackResourceKind.Hypervisor, `RegionTwo/${FULL_NAME}`, {
        name: FULL_NAME,
        hypervisorName: FULL_NAME,
        regionName: "RegionTwo",
        status: "down",
      }),
      compute("compute-1", {
        regionName: "RegionTwo",
        externalId: "RegionTwo/compute/compute-1/nova-compute",
        status: "down",
      }),
      compute("compute-1"),
    ]);

    expect(node(graph, `hypervisor:RegionOne/${FULL_NAME}`).health).toBe(
      "healthy",
    );
    expect(node(graph, `hypervisor:RegionTwo/${FULL_NAME}`).health).toBe(
      "critical",
    );
  });

  test("an empty inventory is one card", () => {
    expect(build([]).nodes.size).toBe(1);
  });

  test("rows off the server's wire keep their dates and their numbers", () => {
    const parsed: OpenStackResource = toOpenStackRow({
      kind: "Hypervisor",
      externalId: "x",
      lastSeenAt: FRESH.toISOString(),
      stateChangedAt: FRESH.toISOString(),
      memoryCapacityBytes: 1024,
    });

    expect(parsed.lastSeenAt).toEqual(FRESH);
    expect(parsed.stateChangedAt).toEqual(FRESH);
    expect(parsed.memoryCapacityBytes).toBe(1024);
  });
});

describe("the Infrastructure view draws clouds beside hosts and clusters", () => {
  test("a cloud holds hypervisors, a hypervisor holds instances", () => {
    expect(CONTAINER_SPECIFICITY[EntityType.OpenStackCloud]).toBe(0);
    expect(CONTAINER_SPECIFICITY[EntityType.OpenStackHypervisor]).toBe(2);
    expect(CONTAINER_SPECIFICITY[EntityType.OpenStackInstance]).toBe(3);
    expect(NESTABLE_CHILD_TYPES.has(EntityType.OpenStackHypervisor)).toBe(true);
    expect(NESTABLE_CHILD_TYPES.has(EntityType.OpenStackInstance)).toBe(true);
  });

  test("the types are structural, and instances come in fleets", () => {
    for (const type of [
      EntityType.OpenStackCloud,
      EntityType.OpenStackHypervisor,
      EntityType.OpenStackInstance,
    ]) {
      expect(isStructuralInfrastructureType(type)).toBe(true);
    }
    expect(REPLICA_GROUPABLE_TYPES.has(EntityType.OpenStackInstance)).toBe(
      true,
    );
  });

  const topologyEntity: (
    key: string,
    type: EntityType,
    name?: string,
  ) => TopologyEntity = (
    key: string,
    type: EntityType,
    name: string = key,
  ): TopologyEntity => {
    return {
      entityKey: key,
      displayName: name,
      entityType: type,
      lastSeenAt: NOW,
      source: EntitySource.Discovered,
    };
  };

  const topologyEdge: (
    from: string,
    to: string,
    type: EntityRelationshipType,
  ) => TopologyRelationship = (
    from: string,
    to: string,
    type: EntityRelationshipType,
  ): TopologyRelationship => {
    return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
  };

  const rangeStart: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

  test("a cloud whose agent stamps only its name is one card, beside a host and a cluster", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        topologyEntity("cloud", EntityType.OpenStackCloud, "prod-eu"),
        topologyEntity("host", EntityType.Host, "web-01"),
        topologyEntity("cluster", EntityType.KubernetesCluster, "prod"),
      ],
      [],
      { rangeStart },
    );

    const cards: Array<string> = collectMapCards(model, null);

    expect(
      cards.some((id: string) => {
        return id.includes("cloud");
      }),
    ).toBe(true);
    expect(
      cards.some((id: string) => {
        return id.includes("host");
      }),
    ).toBe(true);
  });

  test("a source that names its hypervisors and instances nests them under the cloud", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        topologyEntity("cloud", EntityType.OpenStackCloud, "prod-eu"),
        topologyEntity(
          "hypervisor",
          EntityType.OpenStackHypervisor,
          "compute-1",
        ),
        topologyEntity("instance", EntityType.OpenStackInstance, "web-1"),
      ],
      [
        topologyEdge("hypervisor", "cloud", EntityRelationshipType.MemberOf),
        topologyEdge("instance", "hypervisor", EntityRelationshipType.RunsOn),
        topologyEdge("instance", "cloud", EntityRelationshipType.MemberOf),
      ],
      { rangeStart },
    );

    // The most specific container wins: an instance's hypervisor over its cloud.
    expect(model.nodes.get("hypervisor")?.childIds).toContain("instance");
    expect(model.nodes.get("cloud")?.childIds).toContain("hypervisor");
  });

  test("the map's words for them are OpenStack's", () => {
    expect(countOfType(EntityType.OpenStackHypervisor, 2)).toBe(
      "2 hypervisors",
    );
    expect(countOfType(EntityType.OpenStackInstance, 1)).toBe("1 instance");
  });

  test("the relationships read the same way", () => {
    expect(
      inferRelationshipType(
        EntityType.OpenStackHypervisor,
        EntityType.OpenStackCloud,
      ),
    ).toBe(EntityRelationshipType.MemberOf);
    expect(
      inferRelationshipType(
        EntityType.OpenStackInstance,
        EntityType.OpenStackHypervisor,
      ),
    ).toBe(EntityRelationshipType.RunsOn);
  });
});

/*
 * The largest cloud #5730 names. It is read two ways, and both stay inside the budgets
 * ResourceTopologyScale holds every other product to: what the server's summary hands the
 * browser, and the map built on the whole estate, which nothing should ever ask of it.
 */
describe("a cloud of 5,000 hypervisors and 100,000 instances", () => {
  const HYPERVISORS: number = 5000;
  const INSTANCES: number = 100000;
  const ZONES: number = 8;

  function estate(): {
    hypervisors: Array<OpenStackResource>;
    computes: Array<OpenStackResource>;
    instances: Array<OpenStackResource>;
    instancesByHost: Array<{
      regionName: string;
      hypervisorName: string;
      instanceCount: number;
    }>;
  } {
    const random: SeededRandom = seededRandom(5730);
    const hypervisors: Array<OpenStackResource> = [];
    const computes: Array<OpenStackResource> = [];
    const instancesByHost: Array<{
      regionName: string;
      hypervisorName: string;
      instanceCount: number;
    }> = [];

    for (let index: number = 0; index < HYPERVISORS; index++) {
      const short: string = `compute-${index}`;
      const full: string = `${short}.example.internal`;
      // About one host in fifty is down.
      const isDown: boolean = random(50) === 0;
      hypervisors.push(
        hypervisor(full, {
          availabilityZone: `az-${index % ZONES}`,
          status: isDown ? "down" : "up",
        }),
      );
      computes.push(
        compute(short, {
          availabilityZone: `az-${index % ZONES}`,
          status: isDown ? "down" : "up",
        }),
      );
      instancesByHost.push({
        regionName: "RegionOne",
        hypervisorName: full,
        instanceCount: INSTANCES / HYPERVISORS,
      });
    }

    const instances: Array<OpenStackResource> = [];
    for (let index: number = 0; index < INSTANCES; index++) {
      instances.push(
        instance(
          `i-${index}`,
          `compute-${index % HYPERVISORS}.example.internal`,
          {
            openStackProjectId: `p-${random(500)}`,
            // About one instance in a thousand is in ERROR.
            status: random(1000) === 0 ? "ERROR" : "ACTIVE",
            availabilityZone: `az-${(index % HYPERVISORS) % ZONES}`,
          },
        ),
      );
    }

    return { hypervisors, computes, instances, instancesByHost };
  }

  const big: ReturnType<typeof estate> = estate();

  function firstView(
    graph: ResourceTopologyGraph,
    reveal?: ReadonlyArray<string>,
  ): {
    fit: ResourceTopologyFit;
    visible: ResourceTopologyVisible;
    layout: ResourceTopologyLayout;
  } {
    const fit: ResourceTopologyFit = fitResourceTopology(graph, null, LAPTOP, {
      reveal,
    });
    const visible: ResourceTopologyVisible = computeResourceTopologyView(
      graph,
      createResourceTopologyViewState(),
      { budget: fit.budget, maxAutomaticDepth: fit.depth, reveal },
    );
    const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
      aspect: LAPTOP.width / LAPTOP.height,
      rowLength: fit.rowLength,
    });

    return { fit, visible, layout };
  }

  // What getTopologyRead hands the browser: the structure, and what has failed.
  function summarized(): {
    rows: Array<OpenStackResource>;
    total: number;
  } {
    const downHosts: Set<string> = new Set<string>();
    for (const row of big.hypervisors) {
      if (row.status === "down") {
        downHosts.add(row.hypervisorName || "");
      }
    }
    const failed: Array<OpenStackResource> = big.instances.filter(
      (row: OpenStackResource): boolean => {
        return (
          row.status === "ERROR" || downHosts.has(row.hypervisorName || "")
        );
      },
    );

    return {
      rows: [...big.hypervisors, ...big.computes, ...failed.slice(0, 4000)],
      total:
        big.hypervisors.length + big.computes.length + big.instances.length,
    };
  }

  test("is the size the issue names", () => {
    expect(big.hypervisors).toHaveLength(HYPERVISORS);
    expect(big.instances).toHaveLength(INSTANCES);
  });

  test("what the summary reads is a small part of it", () => {
    const read: { rows: Array<OpenStackResource>; total: number } =
      summarized();

    expect(read.rows.length).toBeLessThan(15000);
    expect(read.total).toBeGreaterThan(105000);
  });

  /*
   * The tightest budget of this suite, and a real one. Its 12,202 rows took 1,007 ms on the
   * first try at a load average of 112 (2026-11-04, 10 cores), nearly all of it in building
   * the graph (buildOpenStackTopology, then buildResourceTopologyGraph), which grows in line
   * with the rows: 159 ms for 3,050, 222 ms for 6,101, 820 ms for 12,202. The budget leaves
   * room for a loaded machine, and none for a read that stopped being summarized.
   */
  test("the first view of the summary is built, fitted and laid out within two seconds", () => {
    const read: { rows: Array<OpenStackResource> } = summarized();
    const timed: FastestRun<ReturnType<typeof firstView>> = fastestRun({
      run: () => {
        const graph: ResourceTopologyGraph = build(read.rows, {
          instancesByHost: big.instancesByHost,
        });

        return firstView(graph, getOpenStackTopologyFocus(graph));
      },
      limitInMs: 2000,
      // Each try takes seconds on a busy machine, long enough for a stall to land on three.
      attempts: 5,
    });

    expect(timed.inMs).toBeLessThan(2000);
    // A drawing a person can read: bounded by the budget, not the estate.
    expect(timed.result.layout.placed.length).toBeLessThan(150);
    expect(getFitZoom(timed.result.layout, LAPTOP)).toBeGreaterThanOrEqual(0.3);
  });

  test("it opens on the failed hosts, with their instances beneath them", () => {
    const graph: ResourceTopologyGraph = build(summarized().rows, {
      instancesByHost: big.instancesByHost,
    });
    const reveal: Array<string> = getOpenStackTopologyFocus(graph);
    const view: ReturnType<typeof firstView> = firstView(graph, reveal);

    expect(reveal.length).toBeGreaterThan(0);
    for (const id of reveal) {
      expect(view.visible.visibleNodeIds.has(id)).toBe(true);
    }

    const hosts: Array<ResourceTopologyNode> = reveal
      .map((id: string): ResourceTopologyNode => {
        return graph.nodes.get(id)!;
      })
      .filter((part: ResourceTopologyNode): boolean => {
        return part.kind === "openstack.hypervisor";
      });

    expect(hosts).toHaveLength(OPENSTACK_TOPOLOGY_OPENS_ON);
    for (const host of hosts) {
      expect(host.effectiveHealth).toBe("critical");
      expect(graph.nodes.get(host.childIds[0]!)?.kind).toBe(
        "openstack.instance",
      );
    }
  });

  test("what it opens on is few, whatever the size of the failure", () => {
    const graph: ResourceTopologyGraph = build(summarized().rows, {
      instancesByHost: big.instancesByHost,
    });

    expect(getOpenStackTopologyFocus(graph).length).toBeLessThanOrEqual(
      OPENSTACK_TOPOLOGY_OPENS_ON * 2,
    );
  });

  test("every hypervisor says what it holds, drawn beneath it or not", () => {
    const graph: ResourceTopologyGraph = build(summarized().rows, {
      instancesByHost: big.instancesByHost,
    });

    for (const row of big.hypervisors.slice(0, 200)) {
      const facts: Array<{ label: string; value: string }> =
        graph.nodes.get(`hypervisor:${row.externalId}`)?.facts || [];

      expect(
        facts.find((fact: { label: string }) => {
          return fact.label === "Instances";
        })?.value,
      ).toBe("20");
    }
  });

  /*
   * Nothing asks for this: the server's read is what stands between a browser and it. If
   * that ever failed, the drawing is still bounded, because what it costs to draw depends
   * on what is shown and never on how much there is.
   */
  test("the whole estate still draws a bounded first view", () => {
    const view: ReturnType<typeof firstView> = firstView(
      build([...big.hypervisors, ...big.computes, ...big.instances]),
    );

    expect(view.layout.placed.length).toBeLessThan(150);
  }, 300000);

  test("Needs attention narrows it to a bounded drawing", () => {
    const graph: ResourceTopologyGraph = build(summarized().rows, {
      instancesByHost: big.instancesByHost,
    });
    const timed: FastestRun<ResourceTopologyLayout> = fastestRun({
      run: (): ResourceTopologyLayout => {
        return layoutResourceTopology(
          computeResourceTopologyView(
            graph,
            createResourceTopologyViewState({ filter: "attention" }),
          ),
          { aspect: 1.4 },
        );
      },
      limitInMs: 800,
    });

    expect(timed.inMs).toBeLessThan(800);
  });

  test("what the server left out is said, kind by kind", () => {
    const answer: OpenStackTopologyAnswer = {
      rows: summarized().rows,
      totalsByKind: {
        [OpenStackResourceKind.Hypervisor]: HYPERVISORS,
        [OpenStackResourceKind.Instance]: INSTANCES,
      },
      instancesByHost: big.instancesByHost,
      isSummarized: true,
      projectNames: {},
    };
    const truncations: ReturnType<typeof getOpenStackTopologyTruncations> =
      getOpenStackTopologyTruncations(answer);

    expect(truncations).toHaveLength(1);
    expect(truncations[0]?.kind).toBe("openstack.instance");
    expect(truncations[0]?.total).toBe(INSTANCES);
    expect(
      getOpenStackTopologyNotices(answer).map((notice: { id: string }) => {
        return notice.id;
      }),
    ).toEqual(["summarized", "gap"]);
  });

  test("a small cloud leaves nothing out, and says nothing about a summary", () => {
    const answer: OpenStackTopologyAnswer = {
      rows: [instance("i-1", FULL_NAME)],
      totalsByKind: { [OpenStackResourceKind.Instance]: 1 },
      instancesByHost: [],
      isSummarized: false,
      projectNames: {},
    };

    expect(getOpenStackTopologyTruncations(answer)).toEqual([]);
    expect(
      getOpenStackTopologyNotices(answer).map((notice: { id: string }) => {
        return notice.id;
      }),
    ).toEqual(["gap"]);
  });
});
