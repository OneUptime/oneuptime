import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNode,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  buildResourceTopologyGraph,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import { SECTION_KIND } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyKinds";
import {
  ResourceTopologyCardItem,
  ResourceTopologyGroupItem,
  ResourceTopologyViewState,
  ResourceTopologyVisible,
  computeResourceTopologyView,
  createResourceTopologyViewState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyView";
import {
  BRANCH_CORNER_RADIUS,
  RELATION_LABEL_AT,
  RESOURCE_TOPOLOGY_SIZES,
  ROW_LENGTHS_TRIED,
  ResourceTopologyBranch,
  ResourceTopologyLayout,
  ResourceTopologyLayoutOptions,
  ResourceTopologyPlaced,
  getBranchPath,
  getCardSize,
  getRelatedColumnSides,
  getRelationCurve,
  getRelationSides,
  getRowLength,
  getTopologyColumnX,
  getTopologyFrameIds,
  getTopologyKeyMove,
  layoutResourceTopology,
  placedNodeId,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  SeededRandom,
  seededRandom,
} from "Common/Tests/Helpers/SeededRandom";

/*
 * Where a resource topology's parts go - the customer's ask was a map that
 * "looks like nested boxes" no more. The rules pinned here:
 *
 *   - no part is drawn inside another, and nothing overlaps anything;
 *   - the resource sits at the top, and each part's parts stand in the
 *     column after it, under one heading per kind, joined to it by a line;
 *   - a line never runs through a card, and it is drawn square, its turns
 *     rounded;
 *   - closed parts flow into rows, an open part stands alone with room for
 *     its own parts, and the row length can be held steady;
 *   - a page read from right to left gets the same tree mirrored;
 *   - a host's callers and calls stand in lanes either side of the tree,
 *     each lined up with what it talks to;
 *   - a focused part's related parts stand in a column after the drawing.
 */

const SIZES: typeof RESOURCE_TOPOLOGY_SIZES = RESOURCE_TOPOLOGY_SIZES;

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

const FACTS: Partial<ResourceTopologyNodeInput> = {
  facts: [{ label: "Ready", value: "3/3" }],
};

/*
 * A vCenter of two datacenters: one with a critical cluster, a host that
 * needs attention and a full datastore, one all healthy.
 */
function vcenterEstate(): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("vc", null, { kind: "vmware.vcenter" }),
    part("dc-a", "vc", { kind: "vmware.datacenter" }),
    part("dc-b", "vc", { kind: "vmware.datacenter" }),
    part("cl-a1", "dc-a", { kind: "vmware.cluster", health: "critical" }),
    part("cl-a2", "dc-a", { kind: "vmware.cluster" }),
    part("cl-b1", "dc-b", { kind: "vmware.cluster" }),
  ];

  for (let index: number = 1; index <= 6; index++) {
    nodes.push(
      part(`ds-a${index}`, "dc-a", {
        kind: "vmware.datastore",
        health: index === 1 ? "critical" : "healthy",
      }),
    );
  }

  for (let index: number = 1; index <= 3; index++) {
    nodes.push(part(`ds-b${index}`, "dc-b", { kind: "vmware.datastore" }));
  }

  const hosts: Array<[string, string, number]> = [
    ["h-a1", "cl-a1", 5],
    ["h-a2", "cl-a1", 5],
    ["h-a3", "cl-a1", 5],
    ["h-a4", "cl-a2", 4],
    ["h-b1", "cl-b1", 3],
    ["h-b2", "cl-b1", 3],
  ];

  for (const [host, cluster, vms] of hosts) {
    nodes.push(
      part(host, cluster, {
        kind: "vmware.host",
        health: host === "h-a1" ? "warning" : "healthy",
        ...FACTS,
      }),
    );

    for (let index: number = 1; index <= vms; index++) {
      nodes.push(
        part(`${host}-vm${index}`, host, {
          health: host === "h-a2" && index === 1 ? "critical" : "healthy",
        }),
      );
    }
  }

  return buildResourceTopologyGraph({ rootId: "vc", nodes: nodes });
}

/* A cluster of namespaces, each with a few workloads of different kinds. */
function clusterEstate(namespaces: number): ResourceTopologyGraph {
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("cluster", null, { kind: "k8s.cluster" }),
  ];

  for (let index: number = 0; index < namespaces; index++) {
    const ns: string = `ns-${index}`;
    nodes.push(part(ns, "cluster", { kind: "k8s.namespace" }));
    nodes.push(part(`${ns}-deploy`, ns, { kind: "k8s.deployment", ...FACTS }));
    nodes.push(part(`${ns}-sts`, ns, { kind: "k8s.statefulset", ...FACTS }));
    nodes.push(part(`${ns}-cron`, ns, { kind: "k8s.cronjob", ...FACTS }));

    for (let pod: number = 0; pod < 3; pod++) {
      nodes.push(part(`${ns}-pod-${pod}`, `${ns}-deploy`, { kind: "k8s.pod" }));
    }
  }

  return buildResourceTopologyGraph({ rootId: "cluster", nodes: nodes });
}

const RANDOM_KINDS: Array<string> = [
  "vmware.datacenter",
  "vmware.cluster",
  "vmware.host",
  "vmware.vm",
  "vmware.datastore",
  "k8s.namespace",
  "k8s.pod",
];
const RANDOM_HEALTHS: Array<ResourceTopologyHealth> = [
  "healthy",
  "healthy",
  "healthy",
  "warning",
  "critical",
  "off",
  "unknown",
];

/*
 * An estate drawn from a seed: up to four levels, each part holding up to
 * `fanOut` parts of a kind or two, some with sections among them, health
 * drawn at random.
 */
function randomEstate(seed: number, fanOut: number): ResourceTopologyGraph {
  const random: SeededRandom = seededRandom(seed);
  const nodes: Array<ResourceTopologyNodeInput> = [
    part("root", null, { kind: "vmware.vcenter" }),
  ];
  let counter: number = 0;
  const grow: (parentId: string, depth: number) => void = (
    parentId: string,
    depth: number,
  ): void => {
    if (depth >= 4) {
      return;
    }

    const children: number = random(fanOut + 1);

    for (let index: number = 0; index < children; index++) {
      counter++;
      const id: string = `p${counter}`;
      const isSection: boolean = depth > 0 && random(10) === 0;

      nodes.push(
        part(id, parentId, {
          kind: isSection
            ? SECTION_KIND
            : RANDOM_KINDS[(depth + random(2)) % RANDOM_KINDS.length]!,
          isSection: isSection,
          name: isSection ? "Group" : id,
          health: RANDOM_HEALTHS[random(RANDOM_HEALTHS.length)]!,
          ...(random(2) === 0 ? FACTS : {}),
        }),
      );
      grow(id, depth + 1);
    }
  };

  grow("root", 0);

  return buildResourceTopologyGraph({ rootId: "root", nodes: nodes });
}

function allIds(graph: ResourceTopologyGraph): Set<string> {
  return new Set<string>(graph.nodes.keys());
}

function view(
  graph: ResourceTopologyGraph,
  state: Partial<ResourceTopologyViewState> = {},
): ResourceTopologyVisible {
  return computeResourceTopologyView(
    graph,
    createResourceTopologyViewState(state),
  );
}

// Every part open: the largest drawing the rules can make of an estate.
function openAll(graph: ResourceTopologyGraph): ResourceTopologyVisible {
  return view(graph, { opened: allIds(graph) });
}

function lay(
  visible: ResourceTopologyVisible,
  options: Partial<ResourceTopologyLayoutOptions> = {},
): ResourceTopologyLayout {
  return layoutResourceTopology(visible, { aspect: 1.6, ...options });
}

function overlaps(
  a: Pick<ResourceTopologyPlaced, "x" | "y" | "width" | "height">,
  b: Pick<ResourceTopologyPlaced, "x" | "y" | "width" | "height">,
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function isPart(item: ResourceTopologyPlaced): boolean {
  return (
    item.kind === "card" ||
    item.kind === "chip" ||
    item.kind === "more" ||
    item.kind === "related"
  );
}

// The pairs of things drawn on top of one another.
function overlapsIn(
  layout: ResourceTopologyLayout,
): Array<[string, string]> {
  const found: Array<[string, string]> = [];

  layout.placed.forEach((a: ResourceTopologyPlaced, index: number) => {
    for (const b of layout.placed.slice(index + 1)) {
      if (overlaps(a, b)) {
        found.push([a.id, b.id]);
      }
    }
  });

  return found;
}

/*
 * Whether a square line's leg from `a` to `b` runs through a rectangle -
 * its inside, not along its edge or into its side.
 */
function legCrosses(
  a: [number, number],
  b: [number, number],
  rect: Pick<ResourceTopologyPlaced, "x" | "y" | "width" | "height">,
): boolean {
  const inset: number = 0.5;
  const left: number = rect.x + inset;
  const right: number = rect.x + rect.width - inset;
  const top: number = rect.y + inset;
  const bottom: number = rect.y + rect.height - inset;
  const minX: number = Math.min(a[0], b[0]);
  const maxX: number = Math.max(a[0], b[0]);
  const minY: number = Math.min(a[1], b[1]);
  const maxY: number = Math.max(a[1], b[1]);

  return minX < right && maxX > left && minY < bottom && maxY > top;
}

// Branches whose legs run through a part they neither leave nor enter.
function linesThroughParts(layout: ResourceTopologyLayout): Array<string> {
  const crossings: Array<string> = [];

  for (const branch of layout.branches) {
    for (let index: number = 1; index < branch.points.length; index++) {
      const a: [number, number] = branch.points[index - 1]!;
      const b: [number, number] = branch.points[index]!;

      for (const item of layout.placed) {
        if (
          !isPart(item) ||
          item.id === branch.from ||
          item.id === branch.to
        ) {
          continue;
        }

        if (legCrosses(a, b, item)) {
          crossings.push(`${branch.id} through ${item.id}`);
        }
      }
    }
  }

  return crossings;
}

function cardItems(card: ResourceTopologyCardItem): Array<string> {
  const ids: Array<string> = [];

  for (const group of card.groups) {
    for (const item of group.items) {
      ids.push(item.id);
    }

    if (group.more) {
      ids.push(group.more.id);
    }
  }

  return ids;
}

function placedOf(
  layout: ResourceTopologyLayout,
  id: string,
): ResourceTopologyPlaced {
  const placed: ResourceTopologyPlaced | undefined = layout.byId.get(id);

  if (!placed) {
    throw new Error(`Nothing placed with the id ${id}`);
  }

  return placed;
}

// The estates every rule is checked on: small, deep, wide, narrowed, drawn.
function estates(): Array<{ name: string; layout: ResourceTopologyLayout }> {
  const vcenter: ResourceTopologyGraph = vcenterEstate();
  const cluster: ResourceTopologyGraph = clusterEstate(9);
  const result: Array<{ name: string; layout: ResourceTopologyLayout }> = [
    { name: "a vCenter's first view", layout: lay(view(vcenter)) },
    { name: "a vCenter opened all the way", layout: lay(openAll(vcenter)) },
    {
      name: "a vCenter's troubled parts",
      layout: lay(view(vcenter, { filter: "attention" })),
    },
    { name: "a cluster opened all the way", layout: lay(openAll(cluster)) },
    {
      name: "a cluster in rows of six",
      layout: lay(openAll(cluster), { rowLength: 6 }),
    },
    {
      name: "a cluster on a tall canvas",
      layout: lay(openAll(cluster), { aspect: 0.6 }),
    },
  ];

  for (const seed of [11, 23, 47, 101, 977]) {
    const graph: ResourceTopologyGraph = randomEstate(seed, 7);
    result.push({ name: `estate ${seed}`, layout: lay(openAll(graph)) });
    result.push({
      name: `estate ${seed}, right to left`,
      layout: lay(openAll(graph), { direction: "rtl" }),
    });
  }

  return result;
}

describe("no part is drawn inside another", () => {
  test.each(estates())("$name: nothing overlaps anything", ({ layout }) => {
    expect(overlapsIn(layout)).toEqual([]);
  });

  test.each(estates())("$name: no line runs through a part", ({ layout }) => {
    expect(linesThroughParts(layout)).toEqual([]);
  });

  test("each part drawn is placed exactly once", () => {
    for (const graph of [vcenterEstate(), clusterEstate(4)]) {
      const visible: ResourceTopologyVisible = openAll(graph);
      const layout: ResourceTopologyLayout = lay(visible);
      const parts: Array<string> = layout.placed
        .filter((item: ResourceTopologyPlaced): boolean => {
          return item.kind === "card" || item.kind === "chip";
        })
        .map((item: ResourceTopologyPlaced): string => {
          return item.id;
        });

      expect(new Set<string>(parts).size).toBe(parts.length);
      expect(new Set<string>(parts)).toEqual(visible.visibleNodeIds);
      expect(layout.byId.size).toBe(layout.placed.length);
    }
  });

  test("an open part is a card like any other, not a frame around its parts", () => {
    const layout: ResourceTopologyLayout = lay(openAll(vcenterEstate()));
    const cluster: ResourceTopologyPlaced = placedOf(layout, "cl-a1");

    expect(cluster.kind).toBe("card");
    expect(cluster.card?.isOpen).toBe(true);
    expect(cluster.width).toBe(SIZES.cardWidth);
    expect(cluster.height).toBe(SIZES.holderHeight);

    // Its hosts are after it, not inside it.
    for (const host of ["h-a1", "h-a2", "h-a3"]) {
      expect(overlaps(placedOf(layout, host), cluster)).toBe(false);
      expect(placedOf(layout, host).x).toBeGreaterThan(cluster.x);
    }
  });
});

describe("the resource at the top, each part's parts in the column after it", () => {
  const graph: ResourceTopologyGraph = vcenterEstate();
  const layout: ResourceTopologyLayout = lay(openAll(graph));
  const root: ResourceTopologyPlaced = placedOf(layout, "vc");

  test("the resource is the top-left card, everything else below it", () => {
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);
    expect(root.width).toBe(SIZES.rootWidth);
    expect(root.height).toBe(SIZES.rootHeight);

    for (const item of layout.placed) {
      if (item.id !== root.id) {
        expect(item.y).toBeGreaterThanOrEqual(root.y + root.height);
      }
    }
  });

  test("its own parts start under it, a little in from its edge", () => {
    expect(getTopologyColumnX(1)).toBe(SIZES.rootIndent);
    expect(placedOf(layout, "dc-a").x).toBe(SIZES.rootIndent);
    expect(placedOf(layout, "dc-b").x).toBe(SIZES.rootIndent);
    // The first heading sits just under the resource.
    const heading: ResourceTopologyPlaced = layout.placed.find(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "heading" && item.parentId === "vc";
      },
    )!;

    expect(heading.y).toBe(root.y + root.height + SIZES.rootGap);
  });

  test("a part's column is its depth: a card and a gap to the side per level", () => {
    const step: number = SIZES.cardWidth + SIZES.columnGap;

    expect(getTopologyColumnX(0)).toBe(0);
    expect(getTopologyColumnX(2) - getTopologyColumnX(1)).toBe(step);
    expect(getTopologyColumnX(3) - getTopologyColumnX(2)).toBe(step);

    for (const item of layout.placed) {
      const node: ResourceTopologyNode | undefined = graph.nodes.get(item.id);

      if (!node || item.kind === "heading") {
        continue;
      }

      expect(item.depth).toBe(node.depth);
      // An open part stands at its column's start; closed ones flow from it.
      if (item.card?.isOpen && node.depth > 0) {
        expect(item.x).toBe(getTopologyColumnX(node.depth));
      } else {
        expect(item.x).toBeGreaterThanOrEqual(getTopologyColumnX(node.depth));
      }
    }
  });

  test("a part's parts start below its middle, so lines across the map clear it", () => {
    for (const item of layout.placed) {
      if (!item.parentId || item.parentId === "vc") {
        continue;
      }

      const parent: ResourceTopologyPlaced = placedOf(layout, item.parentId);

      expect(item.y).toBeGreaterThanOrEqual(
        parent.y + parent.height / 2 + SIZES.drop,
      );
    }
  });

  test("a closed part's parts are not drawn; it says what it holds", () => {
    const first: ResourceTopologyLayout = lay(view(graph));
    const healthy: ResourceTopologyPlaced = placedOf(first, "dc-b");

    expect(healthy.card?.isOpen).toBe(false);
    expect(healthy.card?.canOpen).toBe(true);
    expect(first.byId.has("cl-b1")).toBe(false);
    // A part that holds others is taller: it says what, on a line of its own.
    expect(healthy.height).toBe(SIZES.holderHeight);
  });
});

describe("a part's parts are grouped under a heading per kind", () => {
  const graph: ResourceTopologyGraph = vcenterEstate();
  const visible: ResourceTopologyVisible = openAll(graph);
  const layout: ResourceTopologyLayout = lay(visible);

  test("one heading per group, at the column's start, over every part of it", () => {
    const walk: (card: ResourceTopologyCardItem) => void = (
      card: ResourceTopologyCardItem,
    ): void => {
      for (const group of card.groups) {
        const heading: ResourceTopologyPlaced = placedOf(layout, group.id);
        const owner: ResourceTopologyPlaced = placedOf(layout, card.id);

        expect(heading.kind).toBe("heading");
        expect(heading.heading?.group?.groupKey).toBe(group.groupKey);
        expect(heading.parentId).toBe(card.nodeId);
        expect(heading.x).toBe(getTopologyColumnX(owner.depth + 1));
        expect(heading.width).toBeGreaterThanOrEqual(SIZES.headingMinWidth);

        for (const item of group.items) {
          const placed: ResourceTopologyPlaced = placedOf(layout, item.id);

          expect(placed.y).toBeGreaterThanOrEqual(heading.y + heading.height);
          expect(placed.parentId).toBe(card.nodeId);
          // The heading is as wide as the parts under it.
          expect(placed.x + placed.width).toBeLessThanOrEqual(
            heading.x + heading.width,
          );
        }

        for (const item of group.items) {
          if (item.type === "card") {
            walk(item);
          }
        }
      }
    };

    walk(visible.top);
  });

  test("a heading never holds another heading: groups are one level deep", () => {
    for (const item of layout.placed) {
      if (item.kind !== "heading") {
        continue;
      }

      // A heading hangs off a part, never off another heading.
      expect(placedOf(layout, item.parentId!).kind).toBe("card");
    }

    // A part's groups are stacked one after another, never one in another.
    const headings: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "heading" && item.parentId === "dc-a";
      },
    );

    expect(
      headings.map((heading: ResourceTopologyPlaced): string => {
        return heading.heading!.group!.kind;
      }),
    ).toEqual(["vmware.cluster", "vmware.datastore"]);
    expect(headings[1]!.y).toBeGreaterThan(headings[0]!.y);
    expect(headings[1]!.x).toBe(headings[0]!.x);
  });

  test("a section stands in its column like a part, with no heading of its own", () => {
    const withSections: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "array",
      nodes: [
        part("array", null, { kind: "storage.array" }),
        part("hardware", "array", {
          kind: SECTION_KIND,
          isSection: true,
          name: "Hardware",
        }),
        part("ct0", "hardware", { kind: "storage.controller" }),
        part("ct1", "hardware", {
          kind: "storage.controller",
          health: "critical",
        }),
        part("vol", "array", { kind: "storage.volume", ...FACTS }),
      ],
    });
    const sectionLayout: ResourceTopologyLayout = lay(openAll(withSections));
    const section: ResourceTopologyPlaced = placedOf(sectionLayout, "hardware");
    const sectionHeadings: Array<ResourceTopologyPlaced> =
      sectionLayout.placed.filter((item: ResourceTopologyPlaced): boolean => {
        return (
          item.kind === "heading" && item.heading?.group?.kind === SECTION_KIND
        );
      });

    expect(section.kind).toBe("card");
    expect(section.card?.isSection).toBe(true);
    expect(section.height).toBe(SIZES.sectionHeight);
    expect(sectionHeadings).toEqual([]);
    // A line runs to the section itself.
    expect(
      sectionLayout.branches.some((branch: ResourceTopologyBranch): boolean => {
        return branch.from === "array" && branch.to === "hardware";
      }),
    ).toBe(true);
  });
});

describe("lines from a part to what it holds", () => {
  const graph: ResourceTopologyGraph = vcenterEstate();
  const visible: ResourceTopologyVisible = openAll(graph);
  const layout: ResourceTopologyLayout = lay(visible);

  test("one line per group, from the part to the group's heading", () => {
    const expected: Array<string> = [];
    const walk: (card: ResourceTopologyCardItem) => void = (
      card: ResourceTopologyCardItem,
    ): void => {
      for (const group of card.groups) {
        expected.push(`${card.id}->${group.id}`);

        for (const item of group.items) {
          if (item.type === "card") {
            walk(item);
          }
        }
      }
    };

    walk(visible.top);

    expect(
      layout.branches
        .map((branch: ResourceTopologyBranch): string => {
          return `${branch.from}->${branch.to}`;
        })
        .sort(),
    ).toEqual(expected.sort());
  });

  test("a group's line leads to every part of it, folded ones included", () => {
    const group: ResourceTopologyGroupItem = visible.top.groups[0]!;
    const branch: ResourceTopologyBranch = layout.branches.find(
      (line: ResourceTopologyBranch): boolean => {
        return line.to === group.id;
      },
    )!;

    expect(branch.fromNodeId).toBe("vc");
    expect(branch.nodeIds).toEqual(group.memberIds);
  });

  test("lines are square: every leg runs straight across or straight down", () => {
    for (const branch of layout.branches) {
      for (let index: number = 1; index < branch.points.length; index++) {
        const [ax, ay] = branch.points[index - 1]!;
        const [bx, by] = branch.points[index]!;

        expect(ax === bx || ay === by).toBe(true);
      }
    }
  });

  test("the resource's line drops from its bottom; a part's leaves its edge at its middle", () => {
    for (const branch of layout.branches) {
      const from: ResourceTopologyPlaced = placedOf(layout, branch.from);
      const to: ResourceTopologyPlaced = placedOf(layout, branch.to);
      const [startX, startY] = branch.points[0]!;
      const [endX, endY] = branch.points[branch.points.length - 1]!;

      if (branch.from === "vc") {
        expect(startY).toBe(from.y + from.height);
        expect(startX).toBe(from.x + SIZES.rootSpineX);
      } else {
        expect(startX).toBe(from.x + from.width);
        expect(startY).toBe(from.y + from.height / 2);
      }

      // Into the heading's start, level with its middle.
      expect(endX).toBe(to.x);
      expect(endY).toBe(to.y + to.height / 2);
    }
  });

  test("turns are rounded, never wider than a short leg allows", () => {
    expect(
      getBranchPath([
        [0, 0],
        [30, 0],
        [30, 100],
        [60, 100],
      ]),
    ).toBe(
      `M0,0 L${30 - BRANCH_CORNER_RADIUS},0 Q30,0 30,${BRANCH_CORNER_RADIUS} L30,${100 - BRANCH_CORNER_RADIUS} Q30,100 ${30 + BRANCH_CORNER_RADIUS},100 L60,100`,
    );
    // A 6-unit leg turns in 3 units, not 10, so the line never doubles back.
    expect(
      getBranchPath([
        [0, 0],
        [6, 0],
        [6, 40],
      ]),
    ).toBe("M0,0 L3,0 Q6,0 6,3 L6,40");
    expect(getBranchPath([])).toBe("");
    expect(getBranchPath([[4, 5]])).toBe("M4,5");
  });
});

describe("closed parts flow into rows; an open part stands alone", () => {
  test("rows are as even as can be", () => {
    expect(getRowLength(6, 4)).toBe(3);
    expect(getRowLength(8, 4)).toBe(4);
    expect(getRowLength(9, 4)).toBe(3);
    expect(getRowLength(1, 6)).toBe(1);
    expect(getRowLength(5, 1)).toBe(1);
    expect(getRowLength(0, 3)).toBe(1);
  });

  test("a row holds no more parts than the row length", () => {
    for (const rowLength of [1, 2, 3, 5]) {
      const layout: ResourceTopologyLayout = lay(openAll(vcenterEstate()), {
        rowLength: rowLength,
      });
      const rows: Map<string, number> = new Map<string, number>();

      for (const item of layout.placed) {
        if (item.kind === "heading" || !item.parentId) {
          continue;
        }

        const key: string = `${item.parentId}|${item.y}`;
        rows.set(key, (rows.get(key) || 0) + 1);
      }

      expect(layout.rowLength).toBe(rowLength);
      expect(Math.max(...Array.from(rows.values()))).toBeLessThanOrEqual(
        rowLength,
      );
    }
  });

  test("an open part has its row to itself, its own parts after it", () => {
    const layout: ResourceTopologyLayout = lay(openAll(vcenterEstate()), {
      rowLength: 6,
    });
    const cluster: ResourceTopologyPlaced = placedOf(layout, "cl-a1");
    const sameRow: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return (
          item.id !== cluster.id &&
          item.parentId === cluster.parentId &&
          item.y < cluster.y + cluster.height &&
          cluster.y < item.y + item.height
        );
      },
    );

    expect(sameRow).toEqual([]);
  });

  test("parts that open sit further apart than chips: room for the round toggle", () => {
    const layout: ResourceTopologyLayout = lay(view(clusterEstate(6)), {
      rowLength: 3,
    });
    const namespaces: Array<ResourceTopologyPlaced> = layout.placed
      .filter((item: ResourceTopologyPlaced): boolean => {
        return item.parentId === "cluster" && item.kind === "card";
      })
      .sort((a: ResourceTopologyPlaced, b: ResourceTopologyPlaced) => {
        return a.y - b.y || a.x - b.x;
      });

    expect(namespaces[0]!.card?.canOpen).toBe(true);
    expect(namespaces[1]!.y).toBe(namespaces[0]!.y);
    expect(namespaces[1]!.x - (namespaces[0]!.x + namespaces[0]!.width)).toBe(
      SIZES.toggleGap,
    );

    const vms: Array<ResourceTopologyPlaced> = lay(openAll(vcenterEstate()), {
      rowLength: 3,
    })
      .placed.filter((item: ResourceTopologyPlaced): boolean => {
        return item.parentId === "h-a2" && item.kind === "chip";
      })
      .sort((a: ResourceTopologyPlaced, b: ResourceTopologyPlaced) => {
        return a.y - b.y || a.x - b.x;
      });

    expect(vms[1]!.x - (vms[0]!.x + vms[0]!.width)).toBe(SIZES.itemGap);
  });

  test("left to itself, the drawing keeps the row length that fits the canvas best", () => {
    const visible: ResourceTopologyVisible = openAll(clusterEstate(9));
    const chosen: ResourceTopologyLayout = lay(visible, { aspect: 1.6 });
    const zoomFor: (layout: ResourceTopologyLayout) => number = (
      layout: ResourceTopologyLayout,
    ): number => {
      return Math.min(1.6 / layout.width, 1 / layout.height);
    };

    expect(ROW_LENGTHS_TRIED).toContain(chosen.rowLength);

    for (const rowLength of ROW_LENGTHS_TRIED) {
      expect(zoomFor(chosen)).toBeGreaterThanOrEqual(
        zoomFor(lay(visible, { aspect: 1.6, rowLength: rowLength })) - 1e-12,
      );
    }
  });

  test("a wide canvas gets a wider drawing than a tall one", () => {
    // Nine closed namespaces: rows of them, as wide as the canvas likes.
    const visible: ResourceTopologyVisible = view(clusterEstate(9));
    const wide: ResourceTopologyLayout = lay(visible, { aspect: 3 });
    const tall: ResourceTopologyLayout = lay(visible, { aspect: 0.6 });

    expect(wide.width / wide.height).toBeGreaterThan(tall.width / tall.height);
  });

  test("a row length handed in holds whatever else changes", () => {
    const graph: ResourceTopologyGraph = clusterEstate(9);
    const first: ResourceTopologyLayout = lay(view(graph), { rowLength: 2 });
    const opened: ResourceTopologyLayout = lay(
      view(graph, { opened: new Set<string>(["ns-0", "ns-1"]) }),
      { rowLength: 2 },
    );

    expect(first.rowLength).toBe(2);
    expect(opened.rowLength).toBe(2);
  });
});

describe("a page read from right to left gets the tree mirrored", () => {
  test("every part and line mirrors; nothing moves up or down", () => {
    const visible: ResourceTopologyVisible = openAll(vcenterEstate());
    const ltr: ResourceTopologyLayout = lay(visible, { rowLength: 3 });
    const rtl: ResourceTopologyLayout = lay(visible, {
      rowLength: 3,
      direction: "rtl",
    });

    expect(ltr.direction).toBe("ltr");
    expect(rtl.direction).toBe("rtl");
    expect(rtl.width).toBe(ltr.width);
    expect(rtl.height).toBe(ltr.height);

    for (const item of ltr.placed) {
      const mirrored: ResourceTopologyPlaced = placedOf(rtl, item.id);

      expect(mirrored.y).toBe(item.y);
      expect(mirrored.x).toBeCloseTo(ltr.width - (item.x + item.width), 6);
    }

    ltr.branches.forEach((branch: ResourceTopologyBranch, index: number) => {
      const mirrored: ResourceTopologyBranch = rtl.branches[index]!;

      expect(mirrored.id).toBe(branch.id);
      branch.points.forEach((point: [number, number], pointIndex: number) => {
        expect(mirrored.points[pointIndex]![0]).toBeCloseTo(
          ltr.width - point[0],
          6,
        );
        expect(mirrored.points[pointIndex]![1]).toBe(point[1]);
      });
    });
  });

  test("the resource stands at the top right, its parts to its left", () => {
    const rtl: ResourceTopologyLayout = lay(openAll(vcenterEstate()), {
      direction: "rtl",
    });
    const root: ResourceTopologyPlaced = placedOf(rtl, "vc");

    expect(root.x + root.width).toBeCloseTo(rtl.width, 6);
    expect(root.y).toBe(0);
    expect(placedOf(rtl, "cl-a1").x + SIZES.cardWidth).toBeLessThan(
      placedOf(rtl, "dc-a").x + SIZES.cardWidth,
    );
  });
});

describe("a host's callers and calls stand in lanes either side of the tree", () => {
  const RELATIONS: Array<ResourceTopologyRelation> = [
    { from: "mobile", to: "svc", label: "Calls", inverseLabel: "Called by" },
    { from: "svc", to: "db", label: "Calls", inverseLabel: "Called by" },
    { from: "svc-2", to: "pay", label: "Calls", inverseLabel: "Called by" },
  ];

  function hostEstate(): ResourceTopologyGraph {
    return buildResourceTopologyGraph({
      rootId: "host",
      nodes: [
        part("host", null, { kind: "entity:Host" }),
        part("container", "host", { kind: "entity:Container" }),
        part("svc", "container", { kind: "entity:Service", ...FACTS }),
        part("container-2", "host", { kind: "entity:Container" }),
        part("svc-2", "container-2", { kind: "entity:Service", ...FACTS }),
        part("callers", "host", {
          kind: SECTION_KIND,
          isSection: true,
          name: "Called by",
        }),
        part("mobile", "callers", { kind: "entity:Service" }),
        part("calls", "host", {
          kind: SECTION_KIND,
          isSection: true,
          name: "Talks to",
        }),
        part("db", "calls", { kind: "entity:Service", ...FACTS }),
        part("pay", "calls", { kind: "entity:Service", ...FACTS }),
      ],
      relations: RELATIONS,
    });
  }

  const LANES: { left: Array<string>; right: Array<string> } = {
    left: ["callers"],
    right: ["calls"],
  };

  function laneLayout(
    direction: "ltr" | "rtl" = "ltr",
  ): ResourceTopologyLayout {
    const graph: ResourceTopologyGraph = hostEstate();

    return lay(
      computeResourceTopologyView(graph, createResourceTopologyViewState(), {
        alwaysOpen: new Set<string>(["callers", "calls"]),
        reveal: ["mobile", "svc", "db", "svc-2", "pay"],
      }),
      { lanes: LANES, relations: RELATIONS, direction: direction },
    );
  }

  test("callers before the tree, what it calls after it", () => {
    const layout: ResourceTopologyLayout = laneLayout();
    const tree: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return !item.lane;
      },
    );
    const treeLeft: number = Math.min(
      ...tree.map((item: ResourceTopologyPlaced): number => {
        return item.x;
      }),
    );
    const treeRight: number = Math.max(
      ...tree.map((item: ResourceTopologyPlaced): number => {
        return item.x + item.width;
      }),
    );

    for (const item of layout.placed) {
      if (item.lane === "start") {
        expect(item.x + item.width).toBeLessThanOrEqual(
          treeLeft - SIZES.laneGap,
        );
      } else if (item.lane === "end") {
        expect(item.x).toBeGreaterThanOrEqual(treeRight + SIZES.laneGap);
      }
    }

    expect(placedOf(layout, "mobile").lane).toBe("start");
    expect(placedOf(layout, "db").lane).toBe("end");
    expect(placedOf(layout, "pay").lane).toBe("end");
    // The sections are the lanes' headings, not parts of the tree.
    expect(placedOf(layout, "callers").kind).toBe("heading");
    expect(placedOf(layout, "calls").kind).toBe("heading");
    expect(overlapsIn(layout)).toEqual([]);
  });

  test("each lane part is lined up with the part it talks to", () => {
    const layout: ResourceTopologyLayout = laneLayout();
    const centre: (id: string) => number = (id: string): number => {
      const item: ResourceTopologyPlaced = placedOf(layout, id);

      return item.y + item.height / 2;
    };

    expect(centre("mobile")).toBe(centre("svc"));
    expect(centre("db")).toBe(centre("svc"));
    expect(centre("pay")).toBe(centre("svc-2"));
  });

  test("a call's straight line from a lane runs past every card of the tree", () => {
    const layout: ResourceTopologyLayout = laneLayout();

    for (const relation of RELATIONS) {
      const from: ResourceTopologyPlaced = placedOf(layout, relation.from);
      const to: ResourceTopologyPlaced = placedOf(layout, relation.to);
      const y: number = to.lane
        ? from.y + from.height / 2
        : to.y + to.height / 2;
      const start: [number, number] = [
        Math.min(from.x + from.width, to.x + to.width),
        y,
      ];
      const end: [number, number] = [Math.max(from.x, to.x), y];

      for (const item of layout.placed) {
        if (!isPart(item) || item.id === from.id || item.id === to.id) {
          continue;
        }

        expect({
          relation: `${relation.from}->${relation.to}`,
          through: item.id,
          crosses: legCrosses(start, end, item),
        }).toEqual({
          relation: `${relation.from}->${relation.to}`,
          through: item.id,
          crosses: false,
        });
      }
    }
  });

  test("right to left, the lanes swap sides with the tree", () => {
    const layout: ResourceTopologyLayout = laneLayout("rtl");

    expect(placedOf(layout, "mobile").x).toBeGreaterThan(
      placedOf(layout, "host").x,
    );
    expect(placedOf(layout, "db").x).toBeLessThan(placedOf(layout, "host").x);
  });

  test("without lanes the sections stay in the tree", () => {
    const layout: ResourceTopologyLayout = lay(openAll(hostEstate()));

    expect(placedOf(layout, "calls").kind).toBe("card");
    expect(placedOf(layout, "calls").lane).toBeUndefined();
    expect(placedOf(layout, "calls").parentId).toBe("host");
  });
});

describe("a focused part's related parts", () => {
  test("stand in a column after the drawing, under a heading, from the focused part down", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: [
        part("cluster", null, { kind: "k8s.cluster" }),
        part("ns", "cluster", { kind: "k8s.namespace" }),
        part("deploy", "ns", { kind: "k8s.deployment", ...FACTS }),
        part("pod", "deploy", { kind: "k8s.pod" }),
        part("nodes", "cluster", {
          kind: SECTION_KIND,
          isSection: true,
          name: "Nodes",
        }),
        part("node-a", "nodes", { kind: "k8s.node" }),
        part("node-b", "nodes", { kind: "k8s.node" }),
      ],
      relations: [
        { from: "deploy", to: "node-a", label: "Runs on", inverseLabel: "Runs" },
        { from: "deploy", to: "node-b", label: "Runs on", inverseLabel: "Runs" },
      ],
    });
    const layout: ResourceTopologyLayout = lay(
      view(graph, { focusId: "deploy" }),
    );
    const related: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "related";
      },
    );
    const tree: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind !== "related" && item.kind !== "relatedCaption";
      },
    );
    const treeRight: number = Math.max(
      ...tree.map((item: ResourceTopologyPlaced): number => {
        return item.x + item.width;
      }),
    );
    const caption: ResourceTopologyPlaced = placedOf(
      layout,
      "related-caption:Runs on",
    );

    expect(caption.kind).toBe("relatedCaption");
    expect(caption.relatedCaption).toEqual({ label: "Runs on", count: 2 });
    expect(caption.x).toBe(treeRight + SIZES.relatedGap);
    expect(caption.y).toBe(placedOf(layout, "deploy").y);
    expect(related).toHaveLength(2);
    expect(related[0]!.x).toBe(caption.x);
    expect(related[0]!.y).toBe(caption.y + SIZES.captionHeight);
    expect(related[1]!.y).toBeGreaterThan(related[0]!.y);
    expect(layout.width).toBe(related[0]!.x + related[0]!.width);
    expect(overlapsIn(layout)).toEqual([]);
  });

  test("ten related parts stay a short column: small cards, one heading per relation", () => {
    const pods: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return `pod-${index}`;
      },
    );
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "cluster",
      nodes: [
        part("cluster", null, { kind: "k8s.cluster" }),
        part("node-a", "cluster", { kind: "k8s.node" }),
        part("ns", "cluster", { kind: "k8s.namespace" }),
        ...pods.map((pod: string) => {
          return part(pod, "ns", { kind: "k8s.pod", ...FACTS });
        }),
      ],
      relations: [
        ...pods.map((pod: string) => {
          return {
            from: pod,
            to: "node-a",
            label: "Runs on",
            inverseLabel: "Runs here",
          };
        }),
        { from: "node-a", to: "ns", label: "Serves", inverseLabel: "Served by" },
      ],
    });
    const layout: ResourceTopologyLayout = lay(
      view(graph, { focusId: "node-a" }),
    );
    const related: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "related";
      },
    );
    const captions: Array<ResourceTopologyPlaced> = layout.placed.filter(
      (item: ResourceTopologyPlaced): boolean => {
        return item.kind === "relatedCaption";
      },
    );

    expect(related).toHaveLength(11);
    expect(
      captions.map((caption: ResourceTopologyPlaced) => {
        return caption.relatedCaption;
      }),
    ).toEqual([
      { label: "Runs here", count: 10 },
      { label: "Serves", count: 1 },
    ]);

    for (const item of related) {
      expect(item.height).toBe(SIZES.relatedHeight);
      expect(item.width).toBe(SIZES.relatedWidth);
    }

    expect(captions[1]!.y).toBeGreaterThanOrEqual(
      related[9]!.y + related[9]!.height,
    );
  });

  test("its lines leave by the side that faces the column, which ever way the page reads", () => {
    expect(getRelatedColumnSides(true, "ltr")).toEqual({
      source: "right",
      target: "left",
    });
    expect(getRelatedColumnSides(false, "ltr")).toEqual({
      source: "left",
      target: "right",
    });
    expect(getRelatedColumnSides(true, "rtl")).toEqual({
      source: "left",
      target: "right",
    });
    expect(getRelatedColumnSides(false, "rtl")).toEqual({
      source: "right",
      target: "left",
    });
  });
});

describe("what to frame when a part opens", () => {
  test("the part, its headings and its own parts - not what is inside them, nor lanes", () => {
    const layout: ResourceTopologyLayout = lay(openAll(vcenterEstate()));
    const ids: Array<string> = getTopologyFrameIds(layout, ["cl-a1"]);

    expect(ids).toContain("cl-a1");
    expect(ids).toContain("h-a1");
    expect(ids).toContain("h-a2");
    expect(
      ids.some((id: string): boolean => {
        return id.startsWith("group:cl-a1|");
      }),
    ).toBe(true);
    // The virtual machines of its hosts are a level further in.
    expect(ids).not.toContain("h-a1-vm1");
    expect(ids).not.toContain("dc-a");
    expect(getTopologyFrameIds(layout, ["missing"])).toEqual([]);
  });
});

describe("cards, columns and keys", () => {
  test("the resource, a section, a part that holds others and one that holds nothing", () => {
    const card: (
      overrides: Partial<ResourceTopologyCardItem>,
    ) => ResourceTopologyCardItem = (
      overrides: Partial<ResourceTopologyCardItem>,
    ): ResourceTopologyCardItem => {
      return {
        type: "card",
        id: "x",
        nodeId: "x",
        isOpen: false,
        canOpen: false,
        isMatch: false,
        isFocus: false,
        isSection: false,
        groups: [],
        ...overrides,
      };
    };

    expect(getCardSize(card({}), { isRoot: true })).toEqual({
      width: SIZES.rootWidth,
      height: SIZES.rootHeight,
    });
    expect(getCardSize(card({ isSection: true }), { isRoot: false })).toEqual({
      width: SIZES.cardWidth,
      height: SIZES.sectionHeight,
    });
    expect(getCardSize(card({ canOpen: true }), { isRoot: false })).toEqual({
      width: SIZES.cardWidth,
      height: SIZES.holderHeight,
    });
    expect(getCardSize(card({}), { isRoot: false })).toEqual({
      width: SIZES.cardWidth,
      height: SIZES.cardHeight,
    });
  });

  test("a placed item names the part it stands for", () => {
    const layout: ResourceTopologyLayout = lay(openAll(vcenterEstate()));

    expect(placedNodeId(placedOf(layout, "dc-a"))).toBe("dc-a");
    expect(placedNodeId(placedOf(layout, "h-a2-vm1"))).toBe("h-a2-vm1");
    expect(
      placedNodeId(
        layout.placed.find((item: ResourceTopologyPlaced): boolean => {
          return item.kind === "heading";
        })!,
      ),
    ).toBeNull();
  });

  test("the arrows along the line go forward and back; right to left, they swap", () => {
    expect(getTopologyKeyMove("ArrowDown", "ltr")).toBe("next");
    expect(getTopologyKeyMove("ArrowUp", "ltr")).toBe("previous");
    expect(getTopologyKeyMove("Home", "ltr")).toBe("first");
    expect(getTopologyKeyMove("End", "ltr")).toBe("last");
    expect(getTopologyKeyMove("ArrowRight", "ltr")).toBe("forward");
    expect(getTopologyKeyMove("ArrowLeft", "ltr")).toBe("back");
    expect(getTopologyKeyMove("ArrowRight", "rtl")).toBe("back");
    expect(getTopologyKeyMove("ArrowLeft", "rtl")).toBe("forward");
    expect(getTopologyKeyMove("ArrowDown", "rtl")).toBe("next");
    expect(getTopologyKeyMove("Enter", "ltr")).toBeNull();
    expect(getTopologyKeyMove("a", "rtl")).toBeNull();
  });

  test("the cards that matter keep their sizes: what the map's text is laid out for", () => {
    // Wide enough for a node name cut in its middle, a status and a number.
    expect(SIZES.cardWidth).toBeGreaterThanOrEqual(240);
    // The resource's parts sit under it, closer than a column apart.
    expect(SIZES.rootIndent).toBeLessThan(SIZES.columnGap);
    expect(SIZES.rootSpineX).toBeLessThan(SIZES.rootIndent);
    // A line's turn and its stub fit in the gap between two columns.
    expect(SIZES.spineOffset).toBeLessThan(SIZES.columnGap);
    expect(SIZES.toggleGap).toBeGreaterThan(SIZES.itemGap);
  });
});

describe("lines that cross the tree", () => {
  const box: (x: number, y: number) => ResourceTopologyPlaced = (
    x: number,
    y: number,
  ): ResourceTopologyPlaced => {
    return {
      id: `${x},${y}`,
      kind: "card",
      x,
      y,
      width: 200,
      height: 100,
      depth: 1,
      parentId: null,
    };
  };

  test("side by side, a line leaves by the right and enters by the left", () => {
    expect(getRelationSides(box(0, 0), box(400, 40))).toEqual({
      source: "right",
      target: "left",
    });
    expect(getRelationSides(box(400, 40), box(0, 0))).toEqual({
      source: "left",
      target: "right",
    });
  });

  test("one above the other, it leaves by the bottom or the top", () => {
    expect(getRelationSides(box(0, 0), box(20, 300))).toEqual({
      source: "bottom",
      target: "top",
    });
    expect(getRelationSides(box(20, 300), box(0, 0))).toEqual({
      source: "top",
      target: "bottom",
    });
  });

  test("the curve runs from one end to the other, React Flow's way", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 0, y: 0, side: "right" },
        { x: 200, y: 100, side: "left" },
        0.5,
      );

    expect(curve.path).toBe("M0,0 C100,0 100,100 200,100");
    expect(curve.labelX).toBeCloseTo(100);
    expect(curve.labelY).toBeCloseTo(50);
  });

  test("the label sits nearer the part a line points at", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 0, y: 300, side: "top" },
        { x: 0, y: 0, side: "bottom" },
      );

    expect(RELATION_LABEL_AT).toBeGreaterThan(0.5);
    expect(curve.labelY).toBeLessThan(150);
    expect(curve.labelY).toBeGreaterThan(0);
    expect(curve.labelX).toBeCloseTo(0);
  });

  test("a line back to the left curves out and in rather than through", () => {
    const curve: { path: string; labelX: number; labelY: number } =
      getRelationCurve(
        { x: 300, y: 0, side: "right" },
        { x: 0, y: 0, side: "left" },
        0.5,
      );

    expect(curve.path.startsWith("M300,0 C")).toBe(true);
    expect(curve.labelY).toBeCloseTo(0);
  });
});
