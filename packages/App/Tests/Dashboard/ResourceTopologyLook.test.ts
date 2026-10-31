import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyNodeInput,
  buildResourceTopologyGraph,
  emptyHealthCounts,
  getTopologyPathIds,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  ResourceTopologyBranch,
  getBranchPath,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLayout";
import {
  BRANCH_TONE_ORDER,
  RESOURCE_TOPOLOGY_BRANCH_COLORS,
  RESOURCE_TOPOLOGY_DETAIL_ZOOM,
  RESOURCE_TOPOLOGY_HEALTH_COLORS,
  RESOURCE_TOPOLOGY_LEGEND,
  ResourceTopologyBranchLine,
  ResourceTopologyHealthShare,
  ResourceTopologyTone,
  describeTopologyBranches,
  getBranchTone,
  getHealthShares,
  getResourceTopologyDetailLevel,
  getResourceTopologyTone,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLook";

/*
 * How health reads on the map, so trouble shows at a glance: a calm card
 * where all is well and a tinted one where it is not, the line to a group
 * red or amber when trouble lies that way (and drawn over the calm lines),
 * the path to the picked part over them all, a bar of how a closed part's
 * insides are doing, and cards that drop their small print when the map is
 * zoomed far out.
 */

// "#dc2626": a colour written out.
const HEX_COLOR: RegExp = /^#[0-9a-f]{6}$/;

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
 * vc
 *   calm-cluster:    calm-host: 2 healthy virtual machines
 *   amber-cluster:   amber-host (warning): 1 healthy virtual machine
 *   red-cluster:     red-host: 1 critical virtual machine
 */
function estate(): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "vc",
    nodes: [
      part("vc", null, { kind: "vmware.vcenter" }),
      part("calm-cluster", "vc", { kind: "vmware.cluster" }),
      part("calm-host", "calm-cluster", { kind: "vmware.host" }),
      part("calm-vm-1", "calm-host"),
      part("calm-vm-2", "calm-host"),
      part("amber-cluster", "vc", { kind: "vmware.cluster" }),
      part("amber-host", "amber-cluster", {
        kind: "vmware.host",
        health: "warning",
      }),
      part("amber-vm", "amber-host"),
      part("red-cluster", "vc", { kind: "vmware.cluster" }),
      part("red-host", "red-cluster", { kind: "vmware.host" }),
      part("red-vm", "red-host", { health: "critical" }),
    ],
  });
}

function branch(
  id: string,
  from: string,
  nodeIds: Array<string>,
): ResourceTopologyBranch {
  return {
    id: id,
    from: from,
    to: `heading-${id}`,
    fromNodeId: from,
    nodeIds: nodeIds,
    points: [
      [0, 0],
      [20, 0],
      [20, 40],
      [40, 40],
    ],
  };
}

describe("a card's surface says how the part is doing", () => {
  test("critical and needs attention are tinted with their colour, edge and all", () => {
    for (const health of ["critical", "warning"] as const) {
      const tone: ResourceTopologyTone = getResourceTopologyTone(health);

      expect(tone.edge).toBe(RESOURCE_TOPOLOGY_HEALTH_COLORS[health]);
      expect(tone.background).toContain(
        RESOURCE_TOPOLOGY_HEALTH_COLORS[health],
      );
      expect(tone.background).toContain("color-mix");
      // Mixed into the theme's own surface, so it reads in dark mode too.
      expect(tone.background).toContain("var(--ou-surface-primary");
      expect(tone.border).toContain(RESOURCE_TOPOLOGY_HEALTH_COLORS[health]);
    }
  });

  test("healthy, off and no data are plain: the map is calm where all is well", () => {
    for (const health of ["healthy", "off", "unknown"] as const) {
      expect(getResourceTopologyTone(health)).toEqual({
        background: "var(--ou-surface-primary, #ffffff)",
        border: "var(--ou-border-default, #e5e7eb)",
        edge: "transparent",
      });
    }
  });

  test("no data is the theme's strongest border: never brighter than a healthy part in the dark", () => {
    /*
     * A fixed light grey glowed brighter than green on a dark surface - in
     * the bar of a part's insides, the legend and every dot. The theme's
     * own border keeps it the faintest of the five in both themes.
     */
    expect(RESOURCE_TOPOLOGY_HEALTH_COLORS.unknown).toBe(
      "var(--ou-border-strong, #cbd5e1)",
    );

    // The others are the master topology's fixed colours.
    for (const health of ["critical", "warning", "healthy", "off"] as const) {
      expect(RESOURCE_TOPOLOGY_HEALTH_COLORS[health]).toMatch(HEX_COLOR);
    }
  });
});

describe("the line to a group takes the colour of the worst it leads to", () => {
  const graph: ResourceTopologyGraph = estate();

  test("red where a critical part is, or is inside one of them", () => {
    expect(getBranchTone(graph, ["red-vm"])).toBe("critical");
    expect(getBranchTone(graph, ["red-cluster"])).toBe("critical");
    expect(getBranchTone(graph, ["calm-cluster", "red-cluster"])).toBe(
      "critical",
    );
  });

  test("amber where a part needs attention, or something inside one does", () => {
    expect(getBranchTone(graph, ["amber-host"])).toBe("warning");
    expect(getBranchTone(graph, ["amber-cluster"])).toBe("warning");
    expect(getBranchTone(graph, ["calm-cluster", "amber-cluster"])).toBe(
      "warning",
    );
  });

  test("calm otherwise, and parts that are gone change nothing", () => {
    expect(getBranchTone(graph, ["calm-cluster", "calm-vm-1"])).toBe("calm");
    expect(getBranchTone(graph, ["gone"])).toBe("calm");
    expect(getBranchTone(graph, [])).toBe("calm");
  });

  test("red and amber are the health colours; calm is the theme's strong border", () => {
    expect(RESOURCE_TOPOLOGY_BRANCH_COLORS.critical).toBe(
      RESOURCE_TOPOLOGY_HEALTH_COLORS.critical,
    );
    expect(RESOURCE_TOPOLOGY_BRANCH_COLORS.warning).toBe(
      RESOURCE_TOPOLOGY_HEALTH_COLORS.warning,
    );
    expect(RESOURCE_TOPOLOGY_BRANCH_COLORS.calm).toContain(
      "var(--ou-border-strong",
    );
  });
});

describe("the map's lines, in the order they are drawn", () => {
  const graph: ResourceTopologyGraph = estate();
  const branches: Array<ResourceTopologyBranch> = [
    branch("to-red", "vc", ["red-cluster"]),
    branch("to-calm", "vc", ["calm-cluster"]),
    branch("to-amber", "vc", ["amber-cluster"]),
    branch("to-calm-host", "calm-cluster", ["calm-host"]),
    branch("to-red-host", "red-cluster", ["red-host"]),
  ];

  function order(lines: Array<ResourceTopologyBranchLine>): Array<string> {
    return lines.map((line: ResourceTopologyBranchLine): string => {
      return `${line.branch.id}:${line.isOnPath ? "path" : line.tone}`;
    });
  }

  test("calm first, then amber, then red on top; the layout's order within each", () => {
    expect(
      order(describeTopologyBranches(graph, branches, new Set<string>())),
    ).toEqual([
      "to-calm:calm",
      "to-calm-host:calm",
      "to-amber:warning",
      "to-red:critical",
      "to-red-host:critical",
    ]);
    expect(BRANCH_TONE_ORDER.calm).toBeLessThan(BRANCH_TONE_ORDER.warning);
    expect(BRANCH_TONE_ORDER.warning).toBeLessThan(BRANCH_TONE_ORDER.critical);
  });

  test("the way to the picked part is lit and drawn over everything", () => {
    const lines: Array<ResourceTopologyBranchLine> = describeTopologyBranches(
      graph,
      branches,
      getTopologyPathIds(graph, "calm-vm-2"),
    );

    expect(order(lines)).toEqual([
      "to-amber:warning",
      "to-red:critical",
      "to-red-host:critical",
      "to-calm:path",
      "to-calm-host:path",
    ]);
  });

  test("a line is lit only when it leaves a part on the way and leads on down it", () => {
    // Picking the red cluster lights the line to it, not its line onwards.
    const lines: Array<ResourceTopologyBranchLine> = describeTopologyBranches(
      graph,
      branches,
      getTopologyPathIds(graph, "red-cluster"),
    );
    const lit: Array<string> = lines
      .filter((line: ResourceTopologyBranchLine): boolean => {
        return line.isOnPath;
      })
      .map((line: ResourceTopologyBranchLine): string => {
        return line.branch.id;
      });

    expect(lit).toEqual(["to-red"]);
  });

  test("each line carries its rounded path", () => {
    for (const line of describeTopologyBranches(
      graph,
      branches,
      new Set<string>(),
    )) {
      expect(line.path).toBe(getBranchPath(line.branch.points));
    }
  });
});

describe("the bar of how a part's insides are doing", () => {
  test("splits into each health, worst first, leaving out what is not there", () => {
    const shares: Array<ResourceTopologyHealthShare> = getHealthShares({
      critical: 1,
      warning: 0,
      healthy: 6,
      off: 1,
      unknown: 0,
    });

    expect(
      shares.map((share: ResourceTopologyHealthShare): string => {
        return share.health;
      }),
    ).toEqual(["critical", "healthy", "off"]);
    expect(
      shares.map((share: ResourceTopologyHealthShare): number => {
        return share.count;
      }),
    ).toEqual([1, 6, 1]);
    expect(
      shares.reduce((sum: number, share: ResourceTopologyHealthShare) => {
        return sum + share.share;
      }, 0),
    ).toBeCloseTo(1, 10);
    expect(shares[0]!.share).toBeCloseTo(1 / 8, 10);
  });

  test("follows the legend's order", () => {
    const all: Array<ResourceTopologyHealthShare> = getHealthShares({
      critical: 1,
      warning: 1,
      healthy: 1,
      off: 1,
      unknown: 1,
    });

    expect(
      all.map((share: ResourceTopologyHealthShare): string => {
        return share.health;
      }),
    ).toEqual([...RESOURCE_TOPOLOGY_LEGEND]);
  });

  test("a part that holds nothing draws no bar", () => {
    expect(getHealthShares(emptyHealthCounts())).toEqual([]);
  });
});

describe("cards say less when the map is zoomed far out", () => {
  test("below the detail zoom only a card's name and colour are drawn", () => {
    expect(getResourceTopologyDetailLevel(1)).toBe("near");
    expect(getResourceTopologyDetailLevel(RESOURCE_TOPOLOGY_DETAIL_ZOOM)).toBe(
      "near",
    );
    expect(
      getResourceTopologyDetailLevel(RESOURCE_TOPOLOGY_DETAIL_ZOOM - 0.01),
    ).toBe("far");
    expect(getResourceTopologyDetailLevel(0.05)).toBe("far");
    // The first view is framed at a readable zoom, above the switch.
    expect(RESOURCE_TOPOLOGY_DETAIL_ZOOM).toBeLessThan(0.6);
  });
});
