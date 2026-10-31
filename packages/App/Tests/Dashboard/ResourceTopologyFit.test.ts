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
import {
  ROW_LENGTHS_TRIED,
  ResourceTopologyLayout,
  ResourceTopologyPlaced,
  layoutResourceTopology,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
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
  holdsResourceTopologyDrawing,
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

/*
 * A vCenter of datacenters, clusters, hosts and virtual machines; the
 * virtual machines named in `critical` are critical.
 */
function vcenter(
  datacenters: number,
  clusters: number,
  hosts: number,
  vms: number,
  critical: Array<string> = [],
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
          const vmId: string = `${clusterId}-h-${h}-vm-${v}`;

          nodes.push(
            part(vmId, `${clusterId}-h-${h}`, {
              health: critical.includes(vmId) ? "critical" : "healthy",
            }),
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
  test("a small resource opens as far as its parts open by themselves", () => {
    // Healthy: the lone datacenter and cluster open, the two hosts stay shut.
    const healthy: ResourceTopologyGraph = vcenter(1, 1, 2, 3);

    expect(fitResourceTopology(healthy, null, LAPTOP).depth).toBe(
      getAutomaticDepth(healthy, "vc", getViewBudgetFor(LAPTOP)),
    );
    expect(fitResourceTopology(healthy, null, LAPTOP).depth).toBe(3);

    // A critical virtual machine opens its host too: one level more.
    const troubled: ResourceTopologyGraph = vcenter(1, 1, 2, 3, [
      "dc-0-cl-0-h-1-vm-2",
    ]);

    expect(getAutomaticDepth(troubled, "vc", getViewBudgetFor(WIDE))).toBe(4);
    expect(fitResourceTopology(troubled, null, WIDE).depth).toBe(4);
  });

  test("the level it stops at fits the canvas at a readable zoom", () => {
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12, [
      "dc-0-cl-0-h-0-vm-0",
      "dc-1-cl-3-h-7-vm-11",
    ]);

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
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12, [
      "dc-0-cl-0-h-0-vm-0",
    ]);
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

  test("hands back the row length of the first view, for the map to keep", () => {
    const graph: ResourceTopologyGraph = vcenter(2, 4, 8, 12, [
      "dc-0-cl-0-h-0-vm-0",
    ]);

    for (const canvas of [LAPTOP, WIDE, SMALL]) {
      const fit: ResourceTopologyFit = fitResourceTopology(graph, null, canvas);
      const layout: ResourceTopologyLayout = layoutResourceTopology(
        computeResourceTopologyView(graph, createResourceTopologyViewState(), {
          budget: fit.budget,
          maxAutomaticDepth: fit.depth,
        }),
        { aspect: Math.max(0.5, canvas.width / canvas.height) },
      );

      expect(ROW_LENGTHS_TRIED).toContain(fit.rowLength);
      expect(fit.rowLength).toBe(layout.rowLength);
    }
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

describe("a fit waits for React Flow to hold the drawing", () => {
  /*
   * The map frames a drawing only once React Flow holds every node of it.
   * A "+ N more" item's id holds its group's key, "parent|kind": when the
   * ids were compared as one "|"-joined string, a drawing with a folded
   * group never matched, so opening a large datacenter, a filter, a search
   * or a focus left the view where it was (found in the UI review).
   */
  function drawingIds(layout: ResourceTopologyLayout): Array<string> {
    return layout.placed.map((placed: ResourceTopologyPlaced): string => {
      return placed.id;
    });
  }

  test("a drawing with a folded group is held once every id is", () => {
    // One host with forty virtual machines: a dozen drawn, the rest "+ N more".
    const graph: ResourceTopologyGraph = vcenter(1, 1, 1, 40);
    const layout: ResourceTopologyLayout = layoutResourceTopology(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        budget: MAX_VIEW_BUDGET,
      }),
    );
    const ids: Array<string> = drawingIds(layout);
    const more: Array<string> = ids.filter((id: string): boolean => {
      return id.startsWith("more:");
    });

    expect(more).toHaveLength(1);
    expect(more[0]).toContain("|");
    expect(holdsResourceTopologyDrawing(new Set<string>(ids), ids)).toBe(true);
  });

  test("the previous drawing, or one with parts left over, is not held", () => {
    const ids: Array<string> = ["vc", "dc-0", "more:dc-0|vmware.cluster"];

    // React Flow still holds the drawing before the part was opened.
    expect(
      holdsResourceTopologyDrawing(new Set<string>(["vc", "dc-0"]), ids),
    ).toBe(false);
    // Or a drawing as large with another part in it.
    expect(
      holdsResourceTopologyDrawing(
        new Set<string>(["vc", "dc-0", "dc-1"]),
        ids,
      ),
    ).toBe(false);
    expect(
      holdsResourceTopologyDrawing(
        new Set<string>(["vc", "dc-0", "more:dc-0|vmware.cluster", "dc-1"]),
        ids,
      ),
    ).toBe(false);
    expect(holdsResourceTopologyDrawing(new Set<string>(ids), ids)).toBe(true);
  });
});
