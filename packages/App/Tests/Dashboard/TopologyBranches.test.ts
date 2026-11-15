import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { computeParentChildTopologyModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ParentChildTopologyLayout";
import {
  TopologyHierarchy,
  TopologyLayoutModel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyModel";
import {
  BranchToggleNode,
  BranchToggleView,
  EMPTY_COLLAPSED_BRANCHES,
  MAX_PERSISTED_COLLAPSED,
  MAX_PERSISTED_COLLAPSED_KEY_LENGTH,
  PERSISTED_COLLAPSED_VERSION,
  ancestorIdsOf,
  branchNodeIdsOf,
  buildBranchToggles,
  canCollapseMore,
  canExpandMore,
  collapseAllBranches,
  collapsedBranchesSignature,
  collapsedBranchesStorageKey,
  countDescendants,
  descendantIdsOf,
  expandAllBranches,
  hasBranch,
  isHiddenByCollapse,
  parseCollapsedBranches,
  pruneCollapsedBranches,
  readCollapsedBranches,
  revealNodes,
  searchPathNodeIdsFor,
  serializeCollapsedBranches,
  toggleCollapsedBranch,
  writeCollapsedBranches,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyBranches";
import { TopologyOverrideStorage } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyPositionOverrides";

/*
 * ISSUE #6606: THE BRANCHES OF THE NETWORK MAP.
 *
 * What a device has below it, the path down to it, which branches the
 * reader folded away and how that is remembered: every decision the map's
 * fold controls, its "Show only this branch" and its search make about the
 * hierarchy, decided against the hierarchy the parent-child layout
 * reports.
 *
 *   core
 *   ├── dist-a
 *   │   ├── acc-a1 ── ep:a1-0 … ep:a1-2
 *   │   └── acc-a2 ── ep:a2-0, ep:a2-1
 *   └── dist-b ── ep:b-0
 */

// Switches, so the router is the only core device and roots the tree.
const device: (id: string) => NetworkTopologyNode = (
  id: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: `${id}-name`,
    isManaged: true,
    status: "up",
    role: "switch",
  };
};

const endpoint: (id: string) => NetworkTopologyNode = (
  id: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
  };
};

const link: (from: string, to: string) => NetworkTopologyEdge = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to, protocols: ["lldp"] };
};

const nodes: Array<NetworkTopologyNode> = [
  { ...device("core"), role: "router" },
  device("dist-a"),
  device("dist-b"),
  device("acc-a1"),
  device("acc-a2"),
  endpoint("ep:a1-0"),
  endpoint("ep:a1-1"),
  endpoint("ep:a1-2"),
  endpoint("ep:a2-0"),
  endpoint("ep:a2-1"),
  endpoint("ep:b-0"),
];

const edges: Array<NetworkTopologyEdge> = [
  link("core", "dist-a"),
  link("core", "dist-b"),
  link("dist-a", "acc-a1"),
  link("dist-a", "acc-a2"),
  link("acc-a1", "ep:a1-0"),
  link("acc-a1", "ep:a1-1"),
  link("acc-a1", "ep:a1-2"),
  link("acc-a2", "ep:a2-0"),
  link("acc-a2", "ep:a2-1"),
  link("dist-b", "ep:b-0"),
];

const hierarchyWith: (collapsed?: Array<string>) => TopologyHierarchy = (
  collapsed?: Array<string>,
): TopologyHierarchy => {
  const model: TopologyLayoutModel = computeParentChildTopologyModel(
    nodes,
    edges,
    1000,
    700,
    undefined,
    { collapsedNodeIds: new Set<string>(collapsed || []) },
  );
  return model.hierarchy!;
};

const hierarchy: TopologyHierarchy = hierarchyWith();

class MemoryStorage implements TopologyOverrideStorage {
  public items: Map<string, string> = new Map<string, string>();
  public getItem(key: string): string | null {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  public setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  public removeItem(key: string): void {
    this.items.delete(key);
  }
}

class BrokenStorage implements TopologyOverrideStorage {
  public getItem(): string | null {
    throw new Error("SecurityError: storage is disabled");
  }
  public setItem(): void {
    throw new Error("QuotaExceededError");
  }
  public removeItem(): void {
    throw new Error("SecurityError: storage is disabled");
  }
}

describe("what is below a device, and what is above it", () => {
  test("the core is the root, and the hierarchy is the one drawn above", () => {
    expect(hierarchy.rootIds).toEqual(["core"]);
    expect(hierarchy.childrenById.get("core")).toEqual(["dist-a", "dist-b"]);
    expect(hierarchy.parentById.get("ep:a2-1")).toBe("acc-a2");
  });

  test("hasBranch is true only for a device with something below it", () => {
    expect(hasBranch(hierarchy, "dist-a")).toBe(true);
    expect(hasBranch(hierarchy, "ep:b-0")).toBe(false);
    expect(hasBranch(hierarchy, "not-on-the-map")).toBe(false);
    expect(hasBranch(undefined, "dist-a")).toBe(false);
  });

  test("descendants are every device below, depth first, left to right", () => {
    expect(descendantIdsOf(hierarchy, "dist-a")).toEqual([
      "acc-a1",
      "ep:a1-0",
      "ep:a1-1",
      "ep:a1-2",
      "acc-a2",
      "ep:a2-0",
      "ep:a2-1",
    ]);
    expect(descendantIdsOf(hierarchy, "ep:b-0")).toEqual([]);
  });

  test("a branch is the device and everything below it", () => {
    expect(branchNodeIdsOf(hierarchy, "acc-a2")).toEqual(
      new Set<string>(["acc-a2", "ep:a2-0", "ep:a2-1"]),
    );
  });

  test("ancestors run from the root down to the parent", () => {
    expect(ancestorIdsOf(hierarchy, "ep:a1-2")).toEqual([
      "core",
      "dist-a",
      "acc-a1",
    ]);
    expect(ancestorIdsOf(hierarchy, "core")).toEqual([]);
  });

  test("a parent map that loops still returns", () => {
    const looped: TopologyHierarchy = {
      rootIds: [],
      parentById: new Map<string, string>([
        ["a", "b"],
        ["b", "a"],
      ]),
      childrenById: new Map<string, Array<string>>([
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
      depthById: new Map<string, number>(),
      collapsedNodeIds: new Set<string>(),
    };
    expect(ancestorIdsOf(looped, "a")).toEqual(["b"]);
    expect(descendantIdsOf(looped, "a")).toEqual(["b"]);
  });

  test("a descendant count can count only the node types switched on", () => {
    expect(countDescendants(hierarchy, "dist-a")).toBe(7);
    expect(
      countDescendants(hierarchy, "dist-a", (nodeId: string): boolean => {
        return !nodeId.startsWith("ep:");
      }),
    ).toBe(2);
  });

  test("a two-thousand-device chain is walked without blowing the stack", () => {
    const chain: Map<string, Array<string>> = new Map<string, Array<string>>();
    const parents: Map<string, string> = new Map<string, string>();
    for (let index: number = 0; index < 2000; index++) {
      chain.set(`n${index}`, index < 1999 ? [`n${index + 1}`] : []);
      if (index > 0) {
        parents.set(`n${index}`, `n${index - 1}`);
      }
    }
    const deep: TopologyHierarchy = {
      rootIds: ["n0"],
      parentById: parents,
      childrenById: chain,
      depthById: new Map<string, number>(),
      collapsedNodeIds: new Set<string>(),
    };
    expect(descendantIdsOf(deep, "n0")).toHaveLength(1999);
    expect(ancestorIdsOf(deep, "n1999")).toHaveLength(1999);
  });
});

describe("folding branches", () => {
  test("Collapse all folds every branch below the top of the tree", () => {
    expect(collapseAllBranches(hierarchy, new Set<string>())).toEqual(
      new Set<string>(["dist-a", "dist-b", "acc-a1", "acc-a2"]),
    );
  });

  test("Collapse all only ever adds a fold: a root folded by hand stays folded", () => {
    expect(collapseAllBranches(hierarchy, new Set<string>(["core"]))).toEqual(
      new Set<string>(["core", "dist-a", "dist-b", "acc-a1", "acc-a2"]),
    );
  });

  test("narrowed to a branch, it folds only what is below that branch", () => {
    expect(
      collapseAllBranches(hierarchy, new Set<string>(["dist-b"]), "dist-a"),
    ).toEqual(new Set<string>(["dist-b", "acc-a1", "acc-a2"]));
    // A branch with nothing below it that branches has nothing to fold.
    expect(collapseAllBranches(hierarchy, new Set<string>(), "acc-a1")).toEqual(
      new Set<string>(),
    );
  });

  test("Collapse all is offered only while it would fold something more", () => {
    expect(canCollapseMore(hierarchy, new Set<string>())).toBe(true);
    expect(
      canCollapseMore(
        hierarchy,
        collapseAllBranches(hierarchy, new Set<string>()),
      ),
    ).toBe(false);
    expect(canCollapseMore(undefined, new Set<string>())).toBe(false);
    expect(canCollapseMore(hierarchy, new Set<string>(), "acc-a1")).toBe(false);
    expect(canCollapseMore(hierarchy, new Set<string>(), "dist-a")).toBe(true);
    expect(
      canCollapseMore(
        hierarchy,
        new Set<string>(["acc-a1", "acc-a2"]),
        "dist-a",
      ),
    ).toBe(false);
  });

  test("Expand all opens everything; narrowed to a branch, only that branch", () => {
    const collapsed: ReadonlySet<string> = new Set<string>([
      "dist-b",
      "acc-a1",
      "dist-a",
    ]);
    expect(expandAllBranches(hierarchy, collapsed).size).toBe(0);
    expect(expandAllBranches(hierarchy, collapsed, "dist-a")).toEqual(
      new Set<string>(["dist-b"]),
    );
  });

  test("Expand all is offered only while it would open something the reader sees", () => {
    expect(canExpandMore(hierarchy, new Set<string>())).toBe(false);
    expect(canExpandMore(hierarchy, new Set<string>(["dist-b"]))).toBe(true);
    expect(
      canExpandMore(hierarchy, new Set<string>(["dist-b"]), "dist-a"),
    ).toBe(false);
    expect(
      canExpandMore(hierarchy, new Set<string>(["acc-a2"]), "dist-a"),
    ).toBe(true);
    expect(canExpandMore(undefined, new Set<string>(["dist-b"]))).toBe(false);
  });

  test("a toggle folds an open branch and opens a folded one, in a new set", () => {
    const original: ReadonlySet<string> = new Set<string>(["dist-b"]);
    const folded: Set<string> = toggleCollapsedBranch(original, "acc-a1");
    expect(folded).toEqual(new Set<string>(["dist-b", "acc-a1"]));
    expect(toggleCollapsedBranch(folded, "dist-b")).toEqual(
      new Set<string>(["acc-a1"]),
    );
    expect(original).toEqual(new Set<string>(["dist-b"]));
  });

  test("revealing a device opens exactly the folds above it", () => {
    const collapsed: ReadonlySet<string> = new Set<string>([
      "dist-a",
      "acc-a1",
      "dist-b",
    ]);
    expect(revealNodes(collapsed, hierarchy, ["ep:a1-1"])).toEqual(
      new Set<string>(["dist-b"]),
    );
  });

  test("revealing what no fold hides hands back the same set", () => {
    const collapsed: ReadonlySet<string> = new Set<string>(["dist-b"]);
    expect(revealNodes(collapsed, hierarchy, ["ep:a1-1"])).toBe(collapsed);
    expect(revealNodes(EMPTY_COLLAPSED_BRANCHES, hierarchy, ["ep:b-0"])).toBe(
      EMPTY_COLLAPSED_BRANCHES,
    );
  });

  test("a device is hidden by a fold anywhere above it", () => {
    const folded: TopologyHierarchy = hierarchyWith(["dist-a"]);
    expect(isHiddenByCollapse(folded, "ep:a2-0")).toBe(true);
    expect(isHiddenByCollapse(folded, "dist-a")).toBe(false);
    expect(isHiddenByCollapse(folded, "ep:b-0")).toBe(false);
  });

  test("a search lights the path down to each match, and no more", () => {
    expect(searchPathNodeIdsFor(hierarchy, ["ep:a2-1", "ep:b-0"])).toEqual(
      new Set<string>(["acc-a2", "dist-a", "core", "dist-b"]),
    );
    expect(searchPathNodeIdsFor(hierarchy, ["core"])).toEqual(
      new Set<string>(),
    );
  });

  test("the signature of a set does not depend on the order it was folded in", () => {
    expect(collapsedBranchesSignature(new Set<string>(["b", "a"]))).toBe(
      collapsedBranchesSignature(new Set<string>(["a", "b"])),
    );
    expect(collapsedBranchesSignature(undefined)).toBe("");
    expect(collapsedBranchesSignature(new Set<string>())).toBe("");
  });
});

describe("the fold controls the map draws", () => {
  const drawnFrom: (hierarchyToDraw: TopologyHierarchy) => {
    toggles: Array<BranchToggleView>;
  } = (
    hierarchyToDraw: TopologyHierarchy,
  ): { toggles: Array<BranchToggleView> } => {
    const model: TopologyLayoutModel = computeParentChildTopologyModel(
      nodes,
      edges,
      1000,
      700,
      undefined,
      { collapsedNodeIds: hierarchyToDraw.collapsedNodeIds },
    );
    const drawnNodes: Array<BranchToggleNode> = [];
    for (const [id, point] of model.positions) {
      drawnNodes.push({
        id: id,
        x: point.x,
        y: point.y,
        labelBottom: 30,
        isDimmed: id === "dist-b",
      });
    }
    return {
      toggles: buildBranchToggles({
        hierarchy: hierarchyToDraw,
        drawnNodes: drawnNodes,
        nameOf: (nodeId: string): string => {
          return `${nodeId}-name`;
        },
        isCounted: (): boolean => {
          return true;
        },
      }),
    };
  };

  test("every drawn device with something below it gets one, under its name", () => {
    const toggles: Array<BranchToggleView> = drawnFrom(hierarchy).toggles;
    expect(
      toggles.map((toggle: BranchToggleView): string => {
        return toggle.nodeId;
      }),
    ).toEqual(
      expect.arrayContaining(["core", "dist-a", "dist-b", "acc-a1", "acc-a2"]),
    );
    expect(toggles).toHaveLength(5);
    const distB: BranchToggleView = toggles.find(
      (toggle: BranchToggleView): boolean => {
        return toggle.nodeId === "dist-b";
      },
    )!;
    expect(distB.isCollapsed).toBe(false);
    expect(distB.hiddenCount).toBe(0);
    expect(distB.name).toBe("dist-b-name");
    // Faded with its node.
    expect(distB.isDimmed).toBe(true);
  });

  test("a folded branch says how many devices it holds", () => {
    const toggles: Array<BranchToggleView> = drawnFrom(
      hierarchyWith(["dist-a"]),
    ).toggles;
    const distA: BranchToggleView = toggles.find(
      (toggle: BranchToggleView): boolean => {
        return toggle.nodeId === "dist-a";
      },
    )!;
    expect(distA.isCollapsed).toBe(true);
    expect(distA.hiddenCount).toBe(7);
    // Nothing inside the fold is drawn, so nothing inside it has a control.
    expect(
      toggles.some((toggle: BranchToggleView): boolean => {
        return toggle.nodeId === "acc-a1";
      }),
    ).toBe(false);
  });

  test("an open branch whose children are all switched off has no control", () => {
    const toggles: Array<BranchToggleView> = buildBranchToggles({
      hierarchy: hierarchy,
      drawnNodes: [
        { id: "dist-b", x: 0, y: 0, labelBottom: 20, isDimmed: false },
      ],
      nameOf: (nodeId: string): string => {
        return nodeId;
      },
      isCounted: (): boolean => {
        return true;
      },
    });
    expect(toggles).toEqual([]);
  });

  test("a folded branch holding nothing switched on has no control either", () => {
    const folded: TopologyHierarchy = hierarchyWith(["dist-b"]);
    const toggles: Array<BranchToggleView> = buildBranchToggles({
      hierarchy: folded,
      drawnNodes: [
        { id: "dist-b", x: 0, y: 0, labelBottom: 20, isDimmed: false },
      ],
      nameOf: (nodeId: string): string => {
        return nodeId;
      },
      isCounted: (nodeId: string): boolean => {
        return !nodeId.startsWith("ep:");
      },
    });
    expect(toggles).toEqual([]);
  });

  test("the control hangs under the node's name", () => {
    const toggle: BranchToggleView = buildBranchToggles({
      hierarchy: hierarchy,
      drawnNodes: [
        { id: "acc-a2", x: 40, y: 100, labelBottom: 26, isDimmed: false },
        { id: "ep:a2-0", x: 0, y: 232, labelBottom: 20, isDimmed: false },
      ],
      nameOf: (nodeId: string): string => {
        return nodeId;
      },
      isCounted: (): boolean => {
        return true;
      },
    })[0]!;
    expect(toggle.x).toBe(40);
    expect(toggle.labelBottomY).toBe(126);
  });

  test("no hierarchy, or nothing drawn: no controls", () => {
    expect(
      buildBranchToggles({
        hierarchy: undefined,
        drawnNodes: [{ id: "a", x: 0, y: 0, labelBottom: 1, isDimmed: false }],
        nameOf: (nodeId: string): string => {
          return nodeId;
        },
        isCounted: (): boolean => {
          return true;
        },
      }),
    ).toEqual([]);
  });
});

describe("remembering folded branches", () => {
  test("one key per project and site, never per layout", () => {
    expect(collapsedBranchesStorageKey("p1", "s1")).toBe(
      `oneuptime.networkTopology.collapsedBranches.v${PERSISTED_COLLAPSED_VERSION}.p1.s1`,
    );
    expect(collapsedBranchesStorageKey("p1", undefined)).toBe(
      `oneuptime.networkTopology.collapsedBranches.v${PERSISTED_COLLAPSED_VERSION}.p1.project`,
    );
    expect(collapsedBranchesStorageKey("", "s1")).toContain(".unknown.s1");
  });

  test("the same set always writes the same text", () => {
    expect(serializeCollapsedBranches(new Set<string>(["b", "a"]))).toBe(
      serializeCollapsedBranches(new Set<string>(["a", "b"])),
    );
    expect(
      parseCollapsedBranches(
        serializeCollapsedBranches(new Set<string>(["sw-2", "sw-1"])),
      ),
    ).toEqual(new Set<string>(["sw-1", "sw-2"]));
  });

  test("anything but a sound payload of this version reads as nothing folded", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "   ",
      "not json",
      "[]",
      "42",
      "null",
      JSON.stringify({ version: 999, nodeIds: ["a"] }),
      JSON.stringify({ version: PERSISTED_COLLAPSED_VERSION }),
      JSON.stringify({ version: PERSISTED_COLLAPSED_VERSION, nodeIds: "a" }),
    ]) {
      expect(parseCollapsedBranches(raw as string | null | undefined)).toEqual(
        new Set<string>(),
      );
    }
  });

  test("a partly corrupt payload keeps its sound ids, and only a bounded number", () => {
    const tooLong: string = "x".repeat(MAX_PERSISTED_COLLAPSED_KEY_LENGTH + 1);
    expect(
      parseCollapsedBranches(
        JSON.stringify({
          version: PERSISTED_COLLAPSED_VERSION,
          nodeIds: ["sw-1", 7, null, "", tooLong, { a: 1 }, "__proto__"],
        }),
      ),
    ).toEqual(new Set<string>(["sw-1", "__proto__"]));

    const many: Array<string> = [];
    for (let index: number = 0; index < MAX_PERSISTED_COLLAPSED + 50; index++) {
      many.push(`n${index}`);
    }
    expect(
      parseCollapsedBranches(
        JSON.stringify({ version: PERSISTED_COLLAPSED_VERSION, nodeIds: many }),
      ).size,
    ).toBe(MAX_PERSISTED_COLLAPSED);
  });

  test("written and read back through storage; nothing folded clears the entry", () => {
    const storage: MemoryStorage = new MemoryStorage();
    writeCollapsedBranches(storage, "key", new Set<string>(["dist-a"]));
    expect(readCollapsedBranches(storage, "key")).toEqual(
      new Set<string>(["dist-a"]),
    );
    writeCollapsedBranches(storage, "key", new Set<string>());
    expect(storage.items.has("key")).toBe(false);
    expect(readCollapsedBranches(storage, "key")).toEqual(new Set<string>());
  });

  test("storage that throws, or none at all, never breaks the map", () => {
    expect(readCollapsedBranches(new BrokenStorage(), "key")).toBe(
      EMPTY_COLLAPSED_BRANCHES,
    );
    expect(readCollapsedBranches(null, "key")).toBe(EMPTY_COLLAPSED_BRANCHES);
    expect(() => {
      writeCollapsedBranches(
        new BrokenStorage(),
        "key",
        new Set<string>(["a"]),
      );
      writeCollapsedBranches(new BrokenStorage(), "key", new Set<string>());
      writeCollapsedBranches(undefined, "key", new Set<string>(["a"]));
    }).not.toThrow();
  });

  test("folds for devices that left the network are forgotten; otherwise the same set", () => {
    const collapsed: ReadonlySet<string> = new Set<string>(["a", "b"]);
    expect(pruneCollapsedBranches(collapsed, new Set<string>(["a", "b"]))).toBe(
      collapsed,
    );
    expect(pruneCollapsedBranches(collapsed, new Set<string>(["a"]))).toEqual(
      new Set<string>(["a"]),
    );
  });
});
