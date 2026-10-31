import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import {
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNode,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  CARD_FULL_LIMIT,
  CHIP_FULL_LIMIT,
  ResourceTopologyVisible,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  groupKey,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import {
  ResourceTopologyLayout,
  ResourceTopologyPlaced,
  layoutResourceTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  ResourceTopologyFit,
  fitResourceTopology,
  getFitZoom,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFit";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * Very large estates stay fast and readable: a cluster of 2,000 parts, a
 * vCenter of 20,000 (the most a map reads at once), every one of them
 * built, fitted, narrowed and laid out within a fraction of a second, and
 * the drawing React Flow gets bounded by what a person can read - never by
 * how big the estate is. Timed with FastestRun (the fastest of three
 * attempts, adjusted for a slow runner); each run takes well under a third
 * of its limit on a development machine.
 */

const LAPTOP: { width: number; height: number } = { width: 880, height: 640 };

const HEALTHS: Array<ResourceTopologyHealth> = [
  "healthy",
  "healthy",
  "healthy",
  "healthy",
  "healthy",
  "healthy",
  "healthy",
  "warning",
  "critical",
  "off",
];

/*
 * A Kubernetes cluster: namespaces of deployments of pods, nodes the pods
 * run on, about one part in ten troubled.
 */
function clusterOf(
  namespaces: number,
  deployments: number,
  pods: number,
): {
  graph: ResourceTopologyGraph;
  size: number;
} {
  const random: SeededRandom = seededRandom(2000);
  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: "cluster",
      parentId: null,
      kind: "k8s.cluster",
      name: "prod",
      health: "healthy",
    },
  ];
  const relations: Array<ResourceTopologyRelation> = [];

  for (let n: number = 0; n < 40; n++) {
    nodes.push({
      id: `node-${n}`,
      parentId: "cluster",
      kind: "k8s.node",
      name: `ip-10-0-${n}`,
      health: HEALTHS[random(HEALTHS.length)]!,
    });
  }

  for (let ns: number = 0; ns < namespaces; ns++) {
    const namespace: string = `ns-${ns}`;
    nodes.push({
      id: namespace,
      parentId: "cluster",
      kind: "k8s.namespace",
      name: namespace,
      health: "healthy",
    });

    for (let d: number = 0; d < deployments; d++) {
      const deployment: string = `${namespace}-deploy-${d}`;
      nodes.push({
        id: deployment,
        parentId: namespace,
        kind: "k8s.deployment",
        name: deployment,
        health: HEALTHS[random(HEALTHS.length)]!,
        facts: [{ label: "Ready", value: "3/3" }],
      });

      for (let p: number = 0; p < pods; p++) {
        const pod: string = `${deployment}-pod-${p}`;
        nodes.push({
          id: pod,
          parentId: deployment,
          kind: "k8s.pod",
          name: pod,
          health: HEALTHS[random(HEALTHS.length)]!,
        });
        relations.push({
          from: pod,
          to: `node-${random(40)}`,
          label: "Runs on",
          inverseLabel: "Runs here",
        });
      }
    }
  }

  return {
    graph: buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: nodes,
      relations: relations,
    }),
    size: nodes.length,
  };
}

/* A vCenter: datacenters of clusters of hosts of virtual machines. */
function vcenterOf(
  datacenters: number,
  clusters: number,
  hosts: number,
  vms: number,
): { nodes: Array<ResourceTopologyNodeInput>; size: number } {
  const random: SeededRandom = seededRandom(20000);
  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: "vc",
      parentId: null,
      kind: "vmware.vcenter",
      name: "vcenter",
      health: "healthy",
    },
  ];

  for (let dc: number = 0; dc < datacenters; dc++) {
    nodes.push({
      id: `dc-${dc}`,
      parentId: "vc",
      kind: "vmware.datacenter",
      name: `dc-${dc}`,
      health: "healthy",
    });

    for (let cl: number = 0; cl < clusters; cl++) {
      const cluster: string = `dc-${dc}-cl-${cl}`;
      nodes.push({
        id: cluster,
        parentId: `dc-${dc}`,
        kind: "vmware.cluster",
        name: cluster,
        health: "healthy",
      });

      for (let h: number = 0; h < hosts; h++) {
        const host: string = `${cluster}-h-${h}`;
        nodes.push({
          id: host,
          parentId: cluster,
          kind: "vmware.host",
          name: host,
          health: HEALTHS[random(HEALTHS.length)]!,
          facts: [{ label: "CPU", value: "40%" }],
        });

        for (let v: number = 0; v < vms; v++) {
          nodes.push({
            id: `${host}-vm-${v}`,
            parentId: host,
            kind: "vmware.vm",
            name: `${host}-vm-${v}`,
            health: HEALTHS[random(HEALTHS.length)]!,
          });
        }
      }
    }
  }

  return { nodes: nodes, size: nodes.length };
}

// Everything a first view takes: fit the canvas, work out the view, lay it out.
function firstView(graph: ResourceTopologyGraph): {
  fit: ResourceTopologyFit;
  visible: ResourceTopologyVisible;
  layout: ResourceTopologyLayout;
} {
  const fit: ResourceTopologyFit = fitResourceTopology(graph, null, LAPTOP);
  const visible: ResourceTopologyVisible = computeResourceTopologyView(
    graph,
    createResourceTopologyViewState(),
    { budget: fit.budget, maxAutomaticDepth: fit.depth },
  );
  const layout: ResourceTopologyLayout = layoutResourceTopology(visible, {
    aspect: LAPTOP.width / LAPTOP.height,
    rowLength: fit.rowLength,
  });

  return { fit: fit, visible: visible, layout: layout };
}

describe("a cluster of 2,000 parts", () => {
  const estate: { graph: ResourceTopologyGraph; size: number } = clusterOf(
    10,
    12,
    16,
  );

  test("is an estate of about 2,000 parts, with problems in it", () => {
    expect(estate.size).toBeGreaterThanOrEqual(2000);
    expect(estate.graph.attentionCount).toBeGreaterThan(100);
  });

  test("its first view is worked out and laid out in well under half a second", () => {
    const timed: FastestRun<ReturnType<typeof firstView>> = fastestRun({
      run: () => {
        return firstView(estate.graph);
      },
      limitInMs: 500,
    });

    expect(timed.inMs).toBeLessThan(500);
    // A drawing a person can read: bounded by the budget, not the estate.
    expect(timed.result.layout.placed.length).toBeLessThan(120);
    expect(getFitZoom(timed.result.layout, LAPTOP)).toBeGreaterThanOrEqual(0.3);
  });

  test("Needs attention on it narrows to a bounded drawing, quickly", () => {
    const timed: FastestRun<ResourceTopologyLayout> = fastestRun({
      run: (): ResourceTopologyLayout => {
        return layoutResourceTopology(
          computeResourceTopologyView(
            estate.graph,
            createResourceTopologyViewState({ filter: "attention" }),
          ),
          { aspect: 1.4 },
        );
      },
      limitInMs: 800,
    });

    expect(timed.inMs).toBeLessThan(800);
    // Only troubled parts and the way to them: never the whole estate.
    const parts: Array<ResourceTopologyPlaced> = timed.result.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "card" || item.kind === "chip";
      },
    );

    expect(parts.length).toBeLessThan(estate.size / 2);

    for (const item of parts) {
      const node: ResourceTopologyNode = estate.graph.nodes.get(item.id)!;

      expect(node.needsAttention || node.attentionBelow > 0).toBe(true);
    }
  });

  test("a search across all of it answers quickly", () => {
    const timed: FastestRun<ResourceTopologyVisible> = fastestRun({
      run: (): ResourceTopologyVisible => {
        return computeResourceTopologyView(
          estate.graph,
          createResourceTopologyViewState({ search: "deploy-7 pod-3" }),
        );
      },
      limitInMs: 500,
    });

    expect(timed.inMs).toBeLessThan(500);
    expect(timed.result.matchCount).toBeGreaterThan(0);
  });
});

describe("a vCenter of 20,000 parts, the most a map reads at once", () => {
  const estate: { nodes: Array<ResourceTopologyNodeInput>; size: number } =
    vcenterOf(4, 5, 20, 49);

  test("is built, fitted and laid out within two seconds", () => {
    expect(estate.size).toBeGreaterThanOrEqual(20000);

    const timed: FastestRun<ReturnType<typeof firstView>> = fastestRun({
      run: () => {
        return firstView(
          buildResourceTopologyGraph({ rootId: "vc", nodes: estate.nodes }),
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.layout.placed.length).toBeLessThan(150);
  });

  test("a host shown in full draws at most the most of a kind ever drawn", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vc",
      nodes: [
        ...estate.nodes,
        ...Array.from(
          { length: 600 },
          (_value: unknown, index: number): ResourceTopologyNodeInput => {
            return {
              id: `wide-vm-${index}`,
              parentId: "dc-0-cl-0-h-0",
              kind: "vmware.vm",
              name: `wide-vm-${index}`,
              health: "healthy",
            };
          },
        ),
      ],
    });
    const state: ReturnType<typeof createResourceTopologyViewState> =
      createResourceTopologyViewState({
        opened: new Set<string>(["dc-0", "dc-0-cl-0", "dc-0-cl-0-h-0"]),
        shownInFull: new Set<string>([groupKey("dc-0-cl-0-h-0", "vmware.vm")]),
      });
    const timed: FastestRun<ResourceTopologyLayout> = fastestRun({
      run: (): ResourceTopologyLayout => {
        return layoutResourceTopology(
          computeResourceTopologyView(graph, state, { maxAutomaticDepth: 1 }),
          { aspect: 1.4 },
        );
      },
      limitInMs: 800,
    });
    const vms: Array<ResourceTopologyPlaced> = timed.result.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.parentId === "dc-0-cl-0-h-0" && item.kind === "chip";
      },
    );

    expect(timed.inMs).toBeLessThan(800);
    expect(vms).toHaveLength(CHIP_FULL_LIMIT);
    expect(CHIP_FULL_LIMIT).toBeLessThanOrEqual(400);
    expect(CARD_FULL_LIMIT).toBeLessThanOrEqual(200);
  });
});
