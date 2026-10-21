import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import CephResource from "Common/Models/DatabaseModels/CephResource";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
  getTopologyNeighbours,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  CONTAINER_HOST_ROOT_ID,
  ContainerHostResourceRow,
  buildContainerHostTopology,
  normalizeImageName,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/ContainerHostTopology";
import {
  SWARM_ROOT_ID,
  SWARM_UNSCHEDULED_ID,
  DockerSwarmTopology,
  buildDockerSwarmTopology,
  isCurrentSwarmTask,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/DockerSwarmTopology";
import {
  PROXMOX_ROOT_ID,
  buildProxmoxTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/ProxmoxTopology";
import {
  CEPH_ROOT_ID,
  buildCephTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CephTopology";
import {
  STORAGE_ARRAY_CRITICAL_STATUSES,
  STORAGE_ARRAY_HARDWARE_ID,
  STORAGE_ARRAY_HEALTHY_STATUSES,
  STORAGE_ARRAY_ROOT_ID,
  STORAGE_ARRAY_WARNING_STATUSES,
  buildStorageArrayTopology,
  storageArrayStatusHealth,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/StorageArrayTopology";

/*
 * The topologies of the inventories that are one resource's parts: a
 * Docker or Podman host, a Swarm cluster, a Proxmox cluster, a Ceph
 * cluster and a storage array. Each draws what its own pages list, with
 * the health those pages give, and places open incidents and alerts on
 * the part their labels name.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const FRESH: Date = new Date(NOW.getTime() - 30 * 1000);

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`no ${id} in the graph`);
  }

  return found;
}

function issue(id: string, labels: Record<string, string>): OpenIssueRecord {
  return {
    type: "alert",
    id: id,
    title: id,
    number: id,
    severityName: "Warning",
    severityColor: null,
    stateName: "Created",
    createdAt: NOW,
    seriesLabels: labels,
    relatedIds: {},
  };
}

function issueIds(graph: ResourceTopologyGraph, id: string): Array<string> {
  return node(graph, id).issues.map((item: { id: string }): string => {
    return item.id;
  });
}

describe("a Docker or Podman host", () => {
  const rows: Array<ContainerHostResourceRow> = [
    {
      _id: "row-api",
      kind: "Container",
      name: "shop-api-1",
      containerId: "0123456789abcdef",
      imageName: "acme/shop-api:2.4.1",
      state: "running",
      labels: {
        "com.docker.compose.project": "shop",
        "com.docker.compose.service": "api",
      },
      metricsUpdatedAt: FRESH,
      latestCpuPercent: 12,
    },
    {
      kind: "Container",
      name: "shop-worker-1",
      imageName: "docker.io/library/nginx",
      state: "restarting",
      labels: { "com.docker.compose.project": "shop" },
    },
    {
      kind: "Container",
      name: "cron",
      imageName: "nginx:latest",
      state: "exited",
    },
    { kind: "Container", name: "broken", state: "dead" },
    { kind: "Image", name: "acme/shop-api:2.4.1" },
    { kind: "Image", name: "nginx:latest" },
    { kind: "Image", name: "acme/legacy:0.9" },
    {
      kind: "Network",
      name: "shop_default",
      labels: { "com.docker.compose.project": "shop" },
    },
    { kind: "Volume", name: "data" },
  ];

  const graph: ResourceTopologyGraph = buildContainerHostTopology({
    product: "docker",
    host: { id: "host-row", name: "docker-01", lastSeenAt: FRESH },
    rows: rows,
    issues: [
      { ...issue("linked", {}), relatedIds: { dockerResources: ["row-api"] } },
      issue("by-name", { "resource.container.name": "BROKEN" }),
      issue("by-id", { "container.id": "0123456789ab" }),
    ],
    now: NOW,
  });

  test("Compose projects hold the containers and networks they made", () => {
    expect(node(graph, "project:shop").parentId).toBe(CONTAINER_HOST_ROOT_ID);
    expect(node(graph, "container:shop-api-1").parentId).toBe("project:shop");
    expect(node(graph, "container:shop-api-1").context).toBe("api");
    expect(node(graph, "network:shop_default").parentId).toBe("project:shop");
    expect(node(graph, "container:cron").parentId).toBe(CONTAINER_HOST_ROOT_ID);
    expect(node(graph, "volume:data").parentId).toBe(CONTAINER_HOST_ROOT_ID);
  });

  test("a container's state is its health; exited is off, never a problem", () => {
    expect(node(graph, "container:shop-api-1").health).toBe("healthy");
    expect(node(graph, "container:shop-worker-1").health).toBe("warning");
    expect(node(graph, "container:cron").health).toBe("off");
    expect(node(graph, "container:broken").health).toBe("critical");
  });

  test("each container uses its image, whichever way the name is written", () => {
    expect(normalizeImageName("docker.io/library/nginx")).toBe("nginx:latest");
    expect(normalizeImageName("nginx@sha256:abc")).toBe("nginx@sha256:abc");
    expect(
      getTopologyNeighbours(graph, "image:nginx:latest")
        .map((neighbour: { nodeId: string }): string => {
          return neighbour.nodeId;
        })
        .sort(),
    ).toEqual(["container:cron", "container:shop-worker-1"]);
  });

  test("an image nothing uses is off: a candidate for cleaning up", () => {
    expect(node(graph, "image:acme/legacy:0.9").health).toBe("off");
    expect(node(graph, "image:nginx:latest").health).toBe("healthy");
  });

  test("links go to the host's container pages", () => {
    expect(node(graph, "container:cron").link).toEqual({
      page: PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL,
      modelId: "host-row",
      subModelId: "cron",
    });
  });

  test("open issues land on the linked row, the named container, or its id", () => {
    expect(issueIds(graph, "container:shop-api-1").sort()).toEqual(
      ["by-id", "linked"].sort(),
    );
    expect(issueIds(graph, "container:broken")).toEqual(["by-name"]);
  });

  test("a Podman host reads the same way, with its own pages", () => {
    const podman: ResourceTopologyGraph = buildContainerHostTopology({
      product: "podman",
      host: { id: "podman-row", name: "podman-01" },
      rows: [
        {
          kind: "Container",
          name: "web",
          state: "running",
          labels: { "io.podman.compose.project": "site" },
        },
      ],
      now: NOW,
    });

    expect(node(podman, CONTAINER_HOST_ROOT_ID).kind).toBe("podman.host");
    expect(node(podman, "container:web").parentId).toBe("project:site");
    expect(node(podman, "container:web").link?.page).toBe(
      PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
    );
    // Never seen: no data, rather than a problem.
    expect(node(podman, CONTAINER_HOST_ROOT_ID).health).toBe("unknown");
  });
});

describe("a Docker Swarm cluster", () => {
  function swarmRow(fields: Partial<DockerSwarmResource>): DockerSwarmResource {
    return Object.assign(
      new DockerSwarmResource(),
      { lastSeenAt: FRESH },
      fields,
    );
  }

  const topology: DockerSwarmTopology = buildDockerSwarmTopology({
    cluster: { id: "swarm-row", name: "swarm-prod", lastSeenAt: FRESH },
    rows: [
      swarmRow({
        kind: "Node",
        externalId: "n1",
        name: "manager-1",
        state: "ready",
      }),
      swarmRow({
        kind: "Node",
        externalId: "n2",
        name: "worker-1",
        state: "ready",
        attributes: { availability: "drain" },
      }),
      swarmRow({ kind: "Stack", externalId: "shop", name: "shop" }),
      swarmRow({
        kind: "Service",
        externalId: "s1",
        name: "shop_web",
        stackName: "shop",
        desiredReplicas: 3,
        runningReplicas: 2,
      }),
      swarmRow({
        kind: "Service",
        externalId: "s2",
        name: "monitoring",
        runningReplicas: 3,
      }),
      swarmRow({
        kind: "Task",
        externalId: "t1",
        name: "shop_web.1",
        serviceName: "shop_web",
        nodeHostname: "manager-1",
        state: "running",
        attributes: { desiredState: "running" },
      }),
      swarmRow({
        kind: "Task",
        externalId: "t2",
        name: "shop_web.2",
        serviceName: "shop_web",
        state: "failed",
        attributes: { desiredState: "running", error: "no suitable node" },
      }),
      // A task its slot replaced: history, not topology.
      swarmRow({
        kind: "Task",
        externalId: "t0",
        name: "shop_web.1",
        serviceName: "shop_web",
        nodeHostname: "worker-1",
        state: "shutdown",
        attributes: { desiredState: "shutdown" },
      }),
      swarmRow({
        kind: "Network",
        externalId: "net1",
        name: "shop_backend",
        driver: "overlay",
      }),
    ],
    issues: [
      issue("svc", { "docker.swarm.service.name": "shop_web" }),
      issue("node", { "docker.swarm.node.name": "worker-1" }),
    ],
    now: NOW,
  });

  test("by service: stack > service > its current tasks only", () => {
    const services: ResourceTopologyGraph = topology.services;

    expect(node(services, "service:s1").parentId).toBe("stack:shop");
    expect(node(services, "task:t1").parentId).toBe("service:s1");
    expect(services.nodes.has("task:t0")).toBe(false);
    expect(node(services, "network:net1").parentId).toBe("stack:shop");
    expect(node(services, "service:s2").parentId).toBe(SWARM_ROOT_ID);
    expect(isCurrentSwarmTask(swarmRow({ state: "complete" }))).toBe(false);
  });

  test("by service, the nodes sit beside the stacks, a task one line from its node", () => {
    const services: ResourceTopologyGraph = topology.services;

    expect(node(services, "node:n1").parentId).toBe(SWARM_ROOT_ID);
    // "Part of" is the nesting here; "Runs on" crosses the tree.
    expect(
      services.relations.map((relation: ResourceTopologyRelation): string => {
        return `${relation.from}>${relation.to}:${relation.label}`;
      }),
    ).toEqual(["task:t1>node:n1:Runs on"]);
  });

  test("by node: node > its tasks, and the tasks on no node", () => {
    const nodes: ResourceTopologyGraph = topology.nodes;

    expect(node(nodes, "task:t1").parentId).toBe("node:n1");
    expect(node(nodes, "task:t2").parentId).toBe(SWARM_UNSCHEDULED_ID);
    expect(nodes.nodes.has("service:s1")).toBe(false);
  });

  test("health: replicas short, a failed task, a draining node", () => {
    expect(node(topology.services, "service:s1").health).toBe("warning");
    expect(node(topology.services, "service:s2").health).toBe("healthy");
    expect(node(topology.services, "task:t2").health).toBe("critical");
    expect(node(topology.services, "task:t2").reasons).toEqual([
      { text: "no suitable node" },
    ]);
    expect(node(topology.nodes, "node:n2").health).toBe("warning");
  });

  test("open issues land on the service or node their labels name", () => {
    expect(issueIds(topology.services, "service:s1")).toEqual(["svc"]);
    expect(issueIds(topology.nodes, "node:n2")).toEqual(["node"]);
    // The Nodes reading has no services: that alert is the cluster's there.
    expect(issueIds(topology.nodes, SWARM_ROOT_ID)).toEqual(["svc"]);
    expect(topology.nodes.alertCount).toBe(2);
  });
});

describe("a Proxmox cluster", () => {
  function proxmoxRow(fields: Partial<ProxmoxResource>): ProxmoxResource {
    return Object.assign(new ProxmoxResource(), { lastSeenAt: FRESH }, fields);
  }

  const graph: ResourceTopologyGraph = buildProxmoxTopology({
    cluster: { id: "pve-row", name: "pve-prod", lastSeenAt: FRESH },
    rows: [
      proxmoxRow({
        kind: "Node",
        externalId: "node/pve1",
        name: "pve1",
        isUp: true,
      }),
      proxmoxRow({
        kind: "Node",
        externalId: "node/pve2",
        name: "pve2",
        isUp: false,
      }),
      proxmoxRow({
        kind: "Guest",
        externalId: "qemu/100",
        name: "web",
        guestType: "qemu",
        vmid: 100,
        parentNodeName: "pve1",
        isUp: true,
      }),
      proxmoxRow({
        kind: "Guest",
        externalId: "lxc/101",
        name: "dns",
        guestType: "lxc",
        vmid: 101,
        parentNodeName: "pve1",
        isUp: false,
        onboot: true,
      }),
      proxmoxRow({
        kind: "Guest",
        externalId: "qemu/102",
        name: "db",
        guestType: "qemu",
        vmid: 102,
        parentNodeName: "pve2",
        isUp: true,
        haState: "error",
      }),
      proxmoxRow({
        kind: "Guest",
        externalId: "qemu/103",
        name: "batch",
        guestType: "qemu",
        vmid: 103,
        parentNodeName: "pve1",
        isUp: true,
        isBackedUp: false,
      }),
      proxmoxRow({
        kind: "Storage",
        externalId: "storage/pve1/local",
        name: "local",
        parentNodeName: "pve1",
        latestDiskBytes: 90,
        maxDiskBytes: 100,
      }),
    ],
    issues: [
      issue("guest", { id: "qemu/100" }),
      issue("node", { "resource.proxmox.node.name": "PVE2" }),
      issue("storage", { id: "storage/pve1/local" }),
    ],
    now: NOW,
  });

  test("nodes hold their virtual machines, containers and storage", () => {
    expect(node(graph, "node:node/pve1").parentId).toBe(PROXMOX_ROOT_ID);
    expect(node(graph, "guest:qemu/100").parentId).toBe("node:node/pve1");
    expect(node(graph, "guest:qemu/100").kind).toBe("proxmox.vm");
    expect(node(graph, "guest:lxc/101").kind).toBe("proxmox.lxc");
    expect(node(graph, "storage:storage/pve1/local").parentId).toBe(
      "node:node/pve1",
    );
  });

  test("health: an offline node, an HA error, a stopped start-on-boot guest, a backup gap", () => {
    expect(node(graph, "node:node/pve2").health).toBe("critical");
    expect(node(graph, "guest:qemu/102").health).toBe("critical");
    expect(node(graph, "guest:lxc/101").health).toBe("warning");
    // Not covered by a backup job is a gap, never red.
    expect(node(graph, "guest:qemu/103").health).toBe("warning");
    expect(node(graph, "storage:storage/pve1/local").health).toBe("warning");
  });

  test("pve-exporter's id label, or the node's name, places an issue", () => {
    expect(issueIds(graph, "guest:qemu/100")).toEqual(["guest"]);
    expect(issueIds(graph, "node:node/pve2")).toEqual(["node"]);
    expect(issueIds(graph, "storage:storage/pve1/local")).toEqual(["storage"]);
  });
});

describe("a Ceph cluster", () => {
  function cephRow(fields: Partial<CephResource>): CephResource {
    return Object.assign(new CephResource(), fields);
  }

  const graph: ResourceTopologyGraph = buildCephTopology({
    cluster: { id: "ceph-row", name: "ceph-prod", healthStatus: 1 },
    rows: [
      cephRow({
        kind: "Mon",
        externalId: "mon.a",
        name: "mon.a",
        hostname: "ceph-a",
        inQuorum: true,
      }),
      cephRow({
        kind: "Mon",
        externalId: "mon.b",
        name: "mon.b",
        hostname: "ceph-b",
        inQuorum: false,
      }),
      cephRow({
        kind: "Osd",
        externalId: "osd.3",
        name: "osd.3",
        hostname: "ceph-b",
        isUp: false,
        isIn: true,
      }),
      cephRow({
        kind: "Osd",
        externalId: "osd.4",
        name: "osd.4",
        hostname: "ceph-b",
        isUp: true,
        isIn: true,
        statBytes: 100,
        statBytesUsed: 40,
        deviceClass: "ssd",
      }),
      cephRow({
        kind: "Pool",
        externalId: "1",
        name: "rbd",
        storedBytes: 87,
        maxAvailBytes: 13,
        metricsUpdatedAt: FRESH,
      }),
      cephRow({
        kind: "Pool",
        externalId: "2",
        name: "cold",
        storedBytes: 96,
        maxAvailBytes: 4,
        metricsUpdatedAt: FRESH,
      }),
    ],
    issues: [
      issue("osd", { ceph_daemon: "osd.3" }),
      issue("pool", { pool_id: "2" }),
    ],
    now: NOW,
  });

  test("hosts hold their daemons; pools sit on the cluster", () => {
    expect(node(graph, "osd:osd.3").parentId).toBe("host:ceph-b");
    expect(node(graph, "host:ceph-b").parentId).toBe(CEPH_ROOT_ID);
    expect(node(graph, "pool:1").parentId).toBe(CEPH_ROOT_ID);
  });

  test("health: HEALTH_WARN, an OSD down but in, a monitor out of quorum, pools near full", () => {
    expect(node(graph, CEPH_ROOT_ID).health).toBe("warning");
    expect(node(graph, CEPH_ROOT_ID).status).toEqual({ text: "HEALTH_WARN" });
    expect(node(graph, "osd:osd.3").health).toBe("critical");
    expect(node(graph, "osd:osd.4").health).toBe("healthy");
    expect(node(graph, "mon:mon.b").health).toBe("critical");
    expect(node(graph, "pool:1").health).toBe("warning");
    expect(node(graph, "pool:2").health).toBe("critical");
  });

  test("ceph_daemon and pool_id place an issue", () => {
    expect(issueIds(graph, "osd:osd.3")).toEqual(["osd"]);
    expect(issueIds(graph, "pool:2")).toEqual(["pool"]);
  });
});

describe("a storage array", () => {
  function arrayRow(
    fields: Partial<StorageArrayResource>,
  ): StorageArrayResource {
    return Object.assign(
      new StorageArrayResource(),
      { lastSeenAt: FRESH },
      fields,
    );
  }

  const graph: ResourceTopologyGraph = buildStorageArrayTopology({
    array: {
      id: "array-row",
      name: "flasharray-01",
      lastSeenAt: FRESH,
      openAlertCount: 1,
    },
    rows: [
      arrayRow({
        kind: "Host",
        externalId: "h1",
        name: "esx-01",
        groupName: "vsphere-prod",
      }),
      arrayRow({
        kind: "Host",
        externalId: "h2",
        name: "sql-01",
        status: "degraded",
      }),
      arrayRow({
        kind: "Pod",
        externalId: "pod-dr",
        name: "pod-dr",
        status: "online",
      }),
      arrayRow({
        kind: "Volume",
        externalId: "v1",
        name: "pod-dr::vol1",
        groupName: "pod-dr",
      }),
      arrayRow({
        kind: "Volume",
        externalId: "v2",
        name: "vm-ds-1",
        groupName: "vg-vmware",
      }),
      arrayRow({
        kind: "Controller",
        externalId: "ct0",
        name: "CT0",
        status: "ready",
      }),
      arrayRow({
        kind: "Drive",
        externalId: "d7",
        name: "CH0.BAY7",
        status: "failed",
      }),
    ],
    issues: [
      issue("drive", { component_name: "CH0.BAY7" }),
      issue("host", { host: "sql-01" }),
    ],
    now: NOW,
  });

  test("host groups hold hosts, pods and volume groups hold volumes, hardware has its section", () => {
    expect(node(graph, "host:h1").parentId).toBe(
      "group:storage.hostgroup:vsphere-prod",
    );
    expect(node(graph, "host:h2").parentId).toBe(STORAGE_ARRAY_ROOT_ID);
    expect(node(graph, "volume:v1").parentId).toBe("pod:pod-dr");
    expect(node(graph, "volume:v2").parentId).toBe(
      "group:storage.volumegroup:vg-vmware",
    );
    expect(node(graph, "drive:d7").parentId).toBe(STORAGE_ARRAY_HARDWARE_ID);
    expect(node(graph, STORAGE_ARRAY_HARDWARE_ID).isSection).toBe(true);
  });

  test("statuses read the way the array's own pages read them", () => {
    expect(node(graph, "drive:d7").health).toBe("critical");
    expect(node(graph, "host:h2").health).toBe("warning");
    expect(node(graph, "controller:ct0").health).toBe("healthy");
    // An open alert on the array itself.
    expect(node(graph, STORAGE_ARRAY_ROOT_ID).health).toBe("warning");
    expect(storageArrayStatusHealth("Not Ready")).toBe("warning");
    expect(storageArrayStatusHealth("")).toBeNull();
  });

  test("component_name and host place an issue", () => {
    expect(issueIds(graph, "drive:d7")).toEqual(["drive"]);
    expect(issueIds(graph, "host:h2")).toEqual(["host"]);
  });

  test("the status lists are the array pages' own (StorageArrayResourceUtils)", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "StorageArray",
        "Utils",
        "StorageArrayResourceUtils.ts",
      ),
      "utf8",
    );
    const listOf: (name: string) => Array<string> = (
      name: string,
    ): Array<string> => {
      const start: number = source.indexOf(`export const ${name}`);
      const open: number = source.indexOf("[", source.indexOf("=", start));
      const close: number = source.indexOf("];", open);
      const body: string = source.substring(open + 1, close);

      return body
        .split(",")
        .map((item: string): string => {
          return item.trim();
        })
        .filter((item: string): boolean => {
          return item.startsWith('"');
        })
        .map((item: string): string => {
          return item.substring(1, item.length - 1);
        });
    };

    expect(listOf("CRITICAL_RESOURCE_STATUSES")).toEqual([
      ...STORAGE_ARRAY_CRITICAL_STATUSES,
    ]);
    expect(listOf("WARNING_RESOURCE_STATUSES")).toEqual([
      ...STORAGE_ARRAY_WARNING_STATUSES,
    ]);
    expect(listOf("HEALTHY_RESOURCE_STATUSES")).toEqual([
      ...STORAGE_ARRAY_HEALTHY_STATUSES,
    ]);
  });
});
