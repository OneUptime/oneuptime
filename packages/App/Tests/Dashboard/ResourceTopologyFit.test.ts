import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  VIEW_BUDGET,
  computeResourceTopologyView,
  createResourceTopologyViewState,
  getAutomaticDepth,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import { layoutResourceTopology } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  MAX_VIEW_BUDGET,
  MIN_VIEW_BUDGET,
  READABLE_ZOOM,
  REFERENCE_CANVAS_AREA,
  RESOURCE_TOPOLOGY_FIT_PADDING,
  ResourceTopologyCanvasSize,
  ResourceTopologyFit,
  fitResourceTopology,
  getFitZoom,
  getViewBudgetFor,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFit";

/*
 * How deep the first view opens for the canvas it is drawn on: more on a
 * large screen, fewer levels where the drawing would only fit below a
 * readable zoom, and never so few that nothing opens.
 */

function part(
  id: string,
  parentId: string | null,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id: id,
    parentId: parentId,
    kind: overrides.kind || "vmware.vm",
    name: overrides.name || id,
    health: overrides.health || "healthy",
    ...overrides,
  };
}

/* A vCenter of datacenters, clusters, hosts and virtual machines. */
function vcenter(
  datacenters: number,
  clusters: number,
  hosts: number,
  vms: number,
): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("vc", null, { kind: "vmware.vcenter" }),
  ];

  for (let dc: number = 0; dc < datacenters; dc++) {
    nodes.push(part(`dc-${dc}`, "vc", { kind: "vmware.datacenter" }));

    for (let cl: number = 0; cl < clusters; cl++) {
      const clusterId: string = `dc-${dc}-cl-${cl}`;
      nodes.push(part(clusterId, `dc-${dc}`, { kind: "vmware.cluster" }));

      for (let h: number = 0; h < hosts; h++) {
        nodes.push(
          part(`${clusterId}-h-${h}`, clusterId, {
            kind: "vmware.host",
            facts: [{ label: "CPU", value: "40%" }],
          }),
        );

        for (let v: number = 0; v < vms; v++) {
          nodes.push(
            part(`${clusterId}-h-${h}-vm-${v}`, `${clusterId}-h-${h}`),
          );
        }
      }
    }
  }

  return buildResourceTopologyGraph({ rootId: "vc", nodes: nodes });
}

const LAPTOP: ResourceTopologyCanvasSize = { width: 880, height: 640 };
const WIDE: ResourceTopologyCanvasSize = { width: 1800, height: 760 };
const SMALL: ResourceTopologyCanvasSize = { width: 360, height: 520 };

describe("the budget follows the canvas", () => {
  test("a laptop's canvas reads VIEW_BUDGET cards", () => {
    expect(
      getViewBudgetFor({ width: 900, height: REFERENCE_CANVAS_AREA / 900 }),
    ).toBe(VIEW_BUDGET);
  });

  test("a larger canvas reads more, a smaller one fewer, within bounds", () => {
    expect(getViewBudgetFor(WIDE)).toBeGreaterThan(VIEW_BUDGET);
    expect(getViewBudgetFor({ width: 6000, height: 4000 })).toBe(
      MAX_VIEW_BUDGET,
    );
    expect(getViewBudgetFor(SMALL)).toBe(MIN_VIEW_BUDGET);
    expect(getViewBudgetFor({ width: 0, height: 0 })).toBe(MIN_VIEW_BUDGET);
  });
});

describe("the zoom a drawing is framed at", () => {
  test("is React Flow's: the tighter of the two sides, padding included", () => {
    expect(
      getFitZoom({ width: 1000, height: 400 }, { width: 800, height: 800 }),
    ).toBeCloseTo(800 / (1000 * (1 + RESOURCE_TOPOLOGY_FIT_PADDING)));
    expect(
      getFitZoom({ width: 400, height: 1000 }, { width: 800, height: 800 }),
    ).toBeCloseTo(800 / (1000 * (1 + RESOURCE_TOPOLOGY_FIT_PADDING)));
  });

  test("an empty drawing needs no zooming", () => {
    expect(getFitZoom({ width: 0, height: 0 }, LAPTOP)).toBe(1);
  });
});

describe("how deep the first view opens", () => {
  test("a small resource opens all the way down on any canvas", () => {
    const graph: ResourceTopologyGraph = vcenter(1, 1, 2, 3);

    expect(fitResourceTopology(graph, null, LAPTOP).depth).toBe(
      getAutomaticDepth(graph, "vc", getViewBudgetFor(LAPTOP)),
    );
    expect(fitResourceTopology(graph, null, LAPTOP).depth).toBe(4);
  });

  test("the level it stops at fits the canvas at a readable zoom", () => {
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12);

    // The wide screen opens past the top, so the check below is not empty.
    expect(fitResourceTopology(graph, null, WIDE).depth).toBeGreaterThan(1);

    for (const canvas of [LAPTOP, WIDE]) {
      const fit: ResourceTopologyFit = fitResourceTopology(graph, null, canvas);

      if (fit.depth > 1) {
        const layout: ReturnType<typeof layoutResourceTopology> =
          layoutResourceTopology(
            computeResourceTopologyView(
              graph,
              createResourceTopologyViewState(),
              { budget: fit.budget, maxAutomaticDepth: fit.depth },
            ),
            { aspect: canvas.width / canvas.height },
          );

        expect(getFitZoom(layout, canvas)).toBeGreaterThanOrEqual(
          READABLE_ZOOM,
        );
      }
    }
  });

  test("a wide screen opens at least as deep as a laptop, a phone no deeper", () => {
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12);
    const laptop: number = fitResourceTopology(graph, null, LAPTOP).depth;

    expect(fitResourceTopology(graph, null, WIDE).depth).toBeGreaterThanOrEqual(
      laptop,
    );
    expect(fitResourceTopology(graph, null, SMALL).depth).toBeLessThanOrEqual(
      laptop,
    );
  });

  test("however large the resource, the top still opens", () => {
    const graph: ResourceTopologyGraph = vcenter(30, 2, 2, 2);

    expect(fitResourceTopology(graph, null, SMALL).depth).toBe(1);
  });

  test("a resource with nothing inside opens nothing", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vc",
      nodes: [part("vc", null, { kind: "vmware.vcenter" })],
    });

    expect(fitResourceTopology(graph, null, LAPTOP).depth).toBe(0);
  });

  test("a focus is fitted from the focused part down", () => {
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12);
    const focused: ResourceTopologyFit = fitResourceTopology(
      graph,
      "dc-0-cl-0",
      LAPTOP,
    );

    expect(focused.depth).toBeGreaterThanOrEqual(1);
    expect(focused.depth).toBeLessThanOrEqual(
      getAutomaticDepth(graph, "dc-0-cl-0", focused.budget),
    );
    // A focus on a part that is gone is fitted like the resource.
    expect(fitResourceTopology(graph, "gone", LAPTOP)).toEqual(
      fitResourceTopology(graph, null, LAPTOP),
    );
  });
});
