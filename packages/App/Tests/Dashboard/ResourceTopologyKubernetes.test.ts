import { describe, expect, test } from "@jest/globals";
import KubernetesContainer from "Common/Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
  getTopologyNeighbours,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  KUBERNETES_ROOT_ID,
  KUBERNETES_UNSCHEDULED_ID,
  KubernetesTopology,
  buildKubernetesTopology,
  deploymentNameFromReplicaSet,
  kubernetesNodeId,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/KubernetesTopology";

/*
 * A Kubernetes cluster's topology, read two ways from the same rows: by
 * workload (namespace > workload > pod) and by node (node > pod), with the
 * lines across the tree (a pod runs on a node, mounts a claim, the claim is
 * bound to a volume) and the health the cluster's own pages give.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const FRESH: Date = new Date(NOW.getTime() - 30 * 1000);

const POD_ROW_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTAINER_ROW_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";

function resource(fields: Partial<KubernetesResource>): KubernetesResource {
  return Object.assign(new KubernetesResource(), { lastSeenAt: FRESH }, fields);
}

function container(fields: Partial<KubernetesContainer>): KubernetesContainer {
  return Object.assign(new KubernetesContainer(), fields);
}

function rows(): Array<KubernetesResource> {
  return [
    resource({ kind: "Namespace", name: "shop", status: { phase: "Active" } }),
    resource({
      kind: "Node",
      name: "node-a",
      isReady: true,
      metricsUpdatedAt: FRESH,
      latestCpuPercent: 42,
    }),
    resource({ kind: "Node", name: "node-b", isReady: false }),
    resource({
      kind: "Node",
      name: "node-c",
      isReady: true,
      hasDiskPressure: true,
    }),
    resource({
      kind: "Deployment",
      name: "api",
      namespaceKey: "shop",
      spec: { replicas: 3 },
      status: { readyReplicas: 2 },
    }),
    resource({
      kind: "Deployment",
      name: "worker",
      namespaceKey: "shop",
      spec: { replicas: 2 },
      status: { readyReplicas: 0 },
    }),
    resource({
      kind: "StatefulSet",
      name: "db",
      namespaceKey: "shop",
      spec: { replicas: 1 },
      status: { readyReplicas: 1 },
    }),
    resource({
      kind: "CronJob",
      name: "nightly",
      namespaceKey: "shop",
      spec: { schedule: "0 2 * * *" },
    }),
    resource({
      kind: "Job",
      name: "nightly-2900",
      namespaceKey: "shop",
      status: { failed: 2 },
      ownerReferences: { items: [{ kind: "CronJob", name: "nightly" }] },
    }),
    resource({
      _id: POD_ROW_ID,
      kind: "Pod",
      name: "api-7d9f8c6b5-x1",
      namespaceKey: "shop",
      phase: "Running",
      spec: {
        nodeName: "node-a",
        volumes: [{ type: "persistentVolumeClaim", source: "data" }],
      },
      ownerReferences: {
        items: [{ kind: "ReplicaSet", name: "api-7d9f8c6b5" }],
      },
    }),
    resource({
      kind: "Pod",
      name: "worker-1",
      namespaceKey: "shop",
      phase: "Running",
      controllerDeploymentName: "worker",
      spec: { nodeName: "node-b" },
    }),
    resource({
      kind: "Pod",
      name: "db-0",
      namespaceKey: "shop",
      phase: "Pending",
      ownerReferences: { items: [{ kind: "StatefulSet", name: "db" }] },
    }),
    resource({
      kind: "Pod",
      name: "orphan",
      namespaceKey: "other",
      phase: "Succeeded",
      spec: { nodeName: "node-c" },
    }),
    resource({
      kind: "PersistentVolumeClaim",
      name: "data",
      namespaceKey: "shop",
      spec: { volumeName: "pv-data" },
      status: { phase: "Bound", capacity: { storage: "10Gi" } },
    }),
    resource({
      kind: "PersistentVolume",
      name: "pv-data",
      status: { phase: "Bound", capacity: { storage: "10Gi" } },
    }),
  ];
}

function containers(): Array<KubernetesContainer> {
  return [
    container({
      _id: CONTAINER_ROW_ID,
      podNamespaceKey: "shop",
      podName: "worker-1",
      name: "worker",
      reason: "CrashLoopBackOff",
      restartCount: 14,
    }),
  ];
}

function build(issues: Array<OpenIssueRecord> = []): KubernetesTopology {
  return buildKubernetesTopology({
    cluster: { id: "cluster-row", name: "prod-eu", lastSeenAt: FRESH },
    rows: rows(),
    containers: containers(),
    issues: issues,
    now: NOW,
  });
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`no ${id} in the graph`);
  }

  return found;
}

const API_POD: string = kubernetesNodeId("k8s.pod", "shop", "api-7d9f8c6b5-x1");
const WORKER_POD: string = kubernetesNodeId("k8s.pod", "shop", "worker-1");
const DB_POD: string = kubernetesNodeId("k8s.pod", "shop", "db-0");
const ORPHAN_POD: string = kubernetesNodeId("k8s.pod", "other", "orphan");

describe("by workload: namespace > workload > pod", () => {
  const graph: ResourceTopologyGraph = build().workloads;

  test("a pod sits in the workload that owns it, found every way Kubernetes says it", () => {
    // By its ReplicaSet's name, by the agent's controller field, by its owner.
    expect(node(graph, API_POD).parentId).toBe(
      kubernetesNodeId("k8s.deployment", "shop", "api"),
    );
    expect(node(graph, WORKER_POD).parentId).toBe(
      kubernetesNodeId("k8s.deployment", "shop", "worker"),
    );
    expect(node(graph, DB_POD).parentId).toBe(
      kubernetesNodeId("k8s.statefulset", "shop", "db"),
    );
  });

  test("a job a CronJob made sits in that CronJob", () => {
    expect(
      node(graph, kubernetesNodeId("k8s.job", "shop", "nightly-2900")).parentId,
    ).toBe(kubernetesNodeId("k8s.cronjob", "shop", "nightly"));
  });

  test("a namespace whose own row has not arrived is still drawn", () => {
    expect(node(graph, ORPHAN_POD).parentId).toBe(
      kubernetesNodeId("k8s.namespace", "", "other"),
    );
    expect(
      node(graph, kubernetesNodeId("k8s.namespace", "", "other")).parentId,
    ).toBe(KUBERNETES_ROOT_ID);
  });

  test("the nodes sit beside the namespaces, a pod one line from its node", () => {
    expect(
      node(graph, kubernetesNodeId("k8s.node", "", "node-a")).parentId,
    ).toBe(KUBERNETES_ROOT_ID);
    expect(graph.countsByKind.get("k8s.pod")).toBe(4);
    expect(graph.countsByKind.get("k8s.node")).toBe(3);
    expect(graph.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: API_POD,
          to: kubernetesNodeId("k8s.node", "", "node-a"),
          label: "Runs on",
          inverseLabel: "Runs here",
        }),
      ]),
    );
  });

  test("a pod mounts its claim, and the claim is bound to its volume", () => {
    const relations: Array<ResourceTopologyRelation> = graph.relations;

    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: API_POD,
          to: kubernetesNodeId("k8s.pvc", "shop", "data"),
          label: "Uses",
        }),
        expect.objectContaining({
          from: kubernetesNodeId("k8s.pvc", "shop", "data"),
          to: kubernetesNodeId("k8s.pv", "", "pv-data"),
          label: "Bound to",
        }),
      ]),
    );
  });

  test("every part links to its page in the cluster", () => {
    expect(node(graph, API_POD).link).toEqual({
      page: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
      modelId: "cluster-row",
      subModelId: "api-7d9f8c6b5-x1",
    });
  });
});

describe("by node: node > pod", () => {
  const graph: ResourceTopologyGraph = build().nodes;

  test("each pod sits on the node it runs on", () => {
    expect(node(graph, API_POD).parentId).toBe(
      kubernetesNodeId("k8s.node", "", "node-a"),
    );
    expect(node(graph, ORPHAN_POD).parentId).toBe(
      kubernetesNodeId("k8s.node", "", "node-c"),
    );
  });

  test("a pod on no node goes in its own section", () => {
    expect(node(graph, DB_POD).parentId).toBe(KUBERNETES_UNSCHEDULED_ID);
    expect(node(graph, KUBERNETES_UNSCHEDULED_ID).isSection).toBe(true);
  });

  test("no line repeats what the nesting already says", () => {
    expect(
      getTopologyNeighbours(graph, API_POD).filter(
        (neighbour: { nodeId: string }): boolean => {
          return (
            neighbour.nodeId === kubernetesNodeId("k8s.node", "", "node-a")
          );
        },
      ),
    ).toEqual([]);
  });

  test("by workload, the same pod's node is a line instead", () => {
    expect(
      getTopologyNeighbours(build().workloads, API_POD).map(
        (neighbour: { nodeId: string }): string => {
          return neighbour.nodeId;
        },
      ),
    ).toContain(kubernetesNodeId("k8s.node", "", "node-a"));
    expect(
      build().nodes.relations.some(
        (relation: ResourceTopologyRelation): boolean => {
          return relation.label === "Runs on";
        },
      ),
    ).toBe(false);
  });
});

describe("health, as the cluster's pages give it", () => {
  const { workloads, nodes } = build();

  test("a node that is not ready is critical; one under pressure needs attention", () => {
    expect(node(nodes, kubernetesNodeId("k8s.node", "", "node-a")).health).toBe(
      "healthy",
    );
    expect(node(nodes, kubernetesNodeId("k8s.node", "", "node-b")).health).toBe(
      "critical",
    );
    expect(node(nodes, kubernetesNodeId("k8s.node", "", "node-c")).health).toBe(
      "warning",
    );
  });

  test("replicas: none ready is critical, some short needs attention", () => {
    expect(
      node(workloads, kubernetesNodeId("k8s.deployment", "shop", "worker"))
        .health,
    ).toBe("critical");
    expect(
      node(workloads, kubernetesNodeId("k8s.deployment", "shop", "api")).health,
    ).toBe("warning");
    expect(
      node(workloads, kubernetesNodeId("k8s.statefulset", "shop", "db")).health,
    ).toBe("healthy");
  });

  test("a pod crash-looping is critical, a pending one needs attention, a finished one is off", () => {
    expect(node(workloads, WORKER_POD).health).toBe("critical");
    expect(node(workloads, WORKER_POD).status).toEqual({
      text: "CrashLoopBackOff",
    });
    expect(node(workloads, WORKER_POD).facts).toEqual(
      expect.arrayContaining([{ label: "Restarts", value: "14" }]),
    );
    expect(node(workloads, DB_POD).health).toBe("warning");
    expect(node(workloads, ORPHAN_POD).health).toBe("off");
  });

  test("a failed job is critical; a scheduled CronJob shows its schedule", () => {
    expect(
      node(workloads, kubernetesNodeId("k8s.job", "shop", "nightly-2900"))
        .health,
    ).toBe("critical");
    expect(
      node(workloads, kubernetesNodeId("k8s.cronjob", "shop", "nightly"))
        .status,
    ).toEqual({ text: "0 2 * * *" });
  });

  test("a cluster that has sent nothing for a while is not reporting", () => {
    const silent: KubernetesTopology = buildKubernetesTopology({
      cluster: {
        id: "cluster-row",
        name: "prod-eu",
        lastSeenAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      rows: [],
      now: NOW,
    });

    expect(node(silent.workloads, KUBERNETES_ROOT_ID).health).toBe("warning");
  });
});

describe("open incidents and alerts", () => {
  function issue(
    id: string,
    labels: Record<string, string>,
    relatedIds: Record<string, Array<string>> = {},
  ): OpenIssueRecord {
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
      relatedIds: relatedIds,
    };
  }

  const topology: KubernetesTopology = build([
    issue("by-row", {}, { kubernetesResources: [POD_ROW_ID] }),
    issue("by-container", {}, { kubernetesContainers: [CONTAINER_ROW_ID] }),
    issue("by-label", {
      "resource.k8s.namespace.name": "shop",
      "resource.k8s.deployment.name": "api",
    }),
    issue("by-node", { "k8s.node.name": "node-b" }),
    issue("nowhere", {}),
  ]);

  const ids: (graph: ResourceTopologyGraph, id: string) => Array<string> = (
    graph: ResourceTopologyGraph,
    id: string,
  ): Array<string> => {
    return node(graph, id).issues.map((item: { id: string }): string => {
      return item.id;
    });
  };

  test("land on the row they are linked to, or the part their labels name", () => {
    expect(ids(topology.workloads, API_POD)).toEqual(["by-row"]);
    expect(ids(topology.workloads, WORKER_POD)).toEqual(["by-container"]);
    expect(
      ids(
        topology.workloads,
        kubernetesNodeId("k8s.deployment", "shop", "api"),
      ),
    ).toEqual(["by-label"]);
  });

  test("both readings count every one, on the cluster where a part is not drawn", () => {
    expect(topology.workloads.alertCount).toBe(5);
    expect(topology.nodes.alertCount).toBe(5);
    // The Nodes reading has no deployments: that alert is the cluster's.
    expect(ids(topology.nodes, KUBERNETES_ROOT_ID).sort()).toEqual(
      ["by-label", "nowhere"].sort(),
    );
    // Both draw the nodes: that alert is the node's in either.
    expect(ids(topology.workloads, KUBERNETES_ROOT_ID)).toEqual(["nowhere"]);
    expect(
      ids(topology.workloads, kubernetesNodeId("k8s.node", "", "node-b")),
    ).toEqual(["by-node"]);
    expect(
      ids(topology.nodes, kubernetesNodeId("k8s.node", "", "node-b")),
    ).toEqual(["by-node"]);
  });
});

describe("names", () => {
  test("a ReplicaSet's deployment is its name without the template hash", () => {
    expect(deploymentNameFromReplicaSet("checkout-7d9f8c6b5")).toBe("checkout");
    expect(deploymentNameFromReplicaSet("api")).toBe("api");
  });

  test("ids are unique per namespace", () => {
    expect(kubernetesNodeId("k8s.pod", "a", "x")).not.toBe(
      kubernetesNodeId("k8s.pod", "b", "x"),
    );
    expect(kubernetesNodeId("k8s.node", "", "x")).toBe("k8s.node:x");
    expect(new ObjectID(POD_ROW_ID).toString()).toBe(POD_ROW_ID);
  });
});
