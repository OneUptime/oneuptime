import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  NetworkTopologyExportDocument,
  NetworkTopologyExportInput,
  buildNetworkTopologyExportDocument,
  describeExportFilters,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/NetworkTopologyExportDocument";
import {
  ExportItem,
  ExportLineItem,
  ExportPage,
  ExportTextItem,
} from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportItems";
import { TextMeasure } from "../../FeatureSet/Dashboard/src/Components/Topology/Export/ExportText";
import { ALL_NODE_KINDS } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyViewModel";
import { computeTopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDrawing";
import { TopologyLayoutModel } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyLayout";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * ISSUE #6606: THE PDF IS THE MAP ON SCREEN - FOLDS, BRANCH AND COMBS.
 *
 * Export PDF draws what the reader is looking at (issue #4616). With the
 * parent-child layout's new controls that now means: the branches folded
 * away are left out, a map narrowed to one branch prints that branch, the
 * leaf blocks hang from the same combs, and the header says what the page
 * leaves out.
 */

const measure: TextMeasure = (
  text: string,
  fontSize: number,
  isBold: boolean,
): number => {
  return Array.from(text).length * fontSize * (isBold ? 0.6 : 0.52);
};

const device: (
  id: string,
  role: NetworkTopologyNode["role"],
) => NetworkTopologyNode = (
  id: string,
  role: NetworkTopologyNode["role"],
): NetworkTopologyNode => {
  return {
    id: id,
    name: `${id} name`,
    role: role,
    status: "up",
    kind: "device",
    isManaged: true,
  };
};

const endpoint: (id: string) => NetworkTopologyNode = (
  id: string,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    status: "unknown",
    kind: "endpoint",
    isManaged: false,
  };
};

// A router over two switches, each with eight endpoints: two leaf blocks.
const NODES: Array<NetworkTopologyNode> = [device("core", "router")];
const EDGES: Array<NetworkTopologyEdge> = [];
for (const switchId of ["sw-a", "sw-b"]) {
  NODES.push(device(switchId, "switch"));
  EDGES.push({ fromNodeId: "core", toNodeId: switchId, protocols: ["lldp"] });
  for (let index: number = 0; index < 8; index++) {
    const id: string = `ep:${switchId}-${index}`;
    NODES.push(endpoint(id));
    EDGES.push({ fromNodeId: switchId, toNodeId: id, protocols: ["fdb"] });
  }
}

function input(
  overrides?: Partial<NetworkTopologyExportInput>,
): NetworkTopologyExportInput {
  return {
    topology: { nodes: NODES, edges: EDGES },
    layoutMode: "parentChild",
    positionOverrides: new Map<string, TopologyPoint>(),
    searchText: "",
    visibleKinds: ALL_NODE_KINDS,
    healthFilterMode: "all",
    projectName: "Acme Retail",
    scopeNames: ["Store 1042"],
    exportedAtText: "Nov 15, 2026, 09:00 CET",
    ...overrides,
  };
}

function build(
  overrides?: Partial<NetworkTopologyExportInput>,
): NetworkTopologyExportDocument {
  return buildNetworkTopologyExportDocument(input(overrides), measure);
}

function mapPage(document: NetworkTopologyExportDocument): ExportPage {
  return document.pages[0]!;
}

function tagged(page: ExportPage, prefix: string): Array<ExportItem> {
  return page.items.filter((item: ExportItem): boolean => {
    return item.tag.startsWith(prefix);
  });
}

function allText(document: NetworkTopologyExportDocument): string {
  return document.pages
    .flatMap((page: ExportPage): Array<string> => {
      return page.items
        .filter((item: ExportItem): item is ExportTextItem => {
          return item.type === "text";
        })
        .map((item: ExportTextItem): string => {
          return item.text;
        });
    })
    .join("\n");
}

describe("the PDF draws the leaf blocks' combs", () => {
  test("each block's trunk, bus and spines, as lines under the links", () => {
    const document: NetworkTopologyExportDocument = build();
    const page: ExportPage = mapPage(document);
    const combLines: Array<ExportItem> = tagged(page, "comb:");
    expect(combLines.length).toBeGreaterThan(0);
    for (const item of combLines) {
      expect(item.type).toBe("line");
      const line: ExportLineItem = item as ExportLineItem;
      // Horizontal or vertical, like the canvas's.
      expect(line.x1 === line.x2 || line.y1 === line.y2).toBe(true);
    }
    expect(
      new Set<string>(
        combLines.map((item: ExportItem): string => {
          return item.tag.split(":").slice(0, 2).join(":");
        }),
      ),
    ).toEqual(new Set<string>(["comb:comb-sw-a", "comb:comb-sw-b"]));
    // Under the links: every comb line comes before the first link.
    const firstEdge: number = page.items.findIndex((item: ExportItem) => {
      return item.tag.startsWith("edge:");
    });
    const lastComb: number = page.items.reduce(
      (last: number, item: ExportItem, index: number): number => {
        return item.tag.startsWith("comb:") ? index : last;
      },
      -1,
    );
    expect(lastComb).toBeLessThan(firstEdge);
    // Every device and link is still drawn and listed.
    expect(document.summary.drawnNodeCount).toBe(NODES.length);
    expect(document.summary.drawnEdgeCount).toBe(EDGES.length);
  });

  test("the other layouts draw no comb", () => {
    for (const layoutMode of ["force", "tiered"] as const) {
      expect(
        tagged(mapPage(build({ layoutMode: layoutMode })), "comb:"),
      ).toEqual([]);
    }
  });
});

describe("the PDF leaves out what the map leaves out", () => {
  test("a folded branch is drawn as its node, without what is below it", () => {
    const collapsed: Set<string> = new Set<string>(["sw-a"]);
    const document: NetworkTopologyExportDocument = build({
      collapsedNodeIds: collapsed,
    });
    expect(document.summary.drawnNodeCount).toBe(NODES.length - 8);
    expect(tagged(mapPage(document), "comb:comb-sw-a")).toEqual([]);
  });

  test("the layout the map drew wins over the folds handed alongside it", () => {
    const model: TopologyLayoutModel = computeTopologyLayoutModel(
      "parentChild",
      NODES,
      EDGES,
      { collapsedNodeIds: new Set<string>(["sw-b"]) },
    );
    const document: NetworkTopologyExportDocument = build({
      layoutModel: model,
      collapsedNodeIds: new Set<string>(["sw-b"]),
    });
    expect(document.summary.drawnNodeCount).toBe(NODES.length - 8);
  });

  test("a map narrowed to one branch prints that branch and nothing else", () => {
    const document: NetworkTopologyExportDocument = build({
      focusedBranchNodeId: "sw-b",
    });
    expect(document.summary.drawnNodeCount).toBe(9);
    const text: string = allText(document);
    expect(text).toContain("sw-b name");
    expect(text).not.toContain("sw-a name");
  });

  test("a branch that is not on the map narrows nothing", () => {
    expect(build({ focusedBranchNodeId: "gone" }).summary.drawnNodeCount).toBe(
      NODES.length,
    );
    // A leaf has no branch to narrow to.
    expect(
      build({ focusedBranchNodeId: "ep:sw-a-0" }).summary.drawnNodeCount,
    ).toBe(NODES.length);
  });
});

describe("the header says what the page leaves out", () => {
  test("the branch the page is narrowed to, and how many branches are folded", () => {
    expect(
      describeExportFilters(input(), new Set(ALL_NODE_KINDS), {
        branchName: "sw-b name",
        collapsedBranchCount: 3,
      }),
    ).toBe("Filtered view: Branch under sw-b name only; 3 branches collapsed.");
    expect(
      describeExportFilters(input(), new Set(ALL_NODE_KINDS), {
        collapsedBranchCount: 1,
      }),
    ).toBe("Filtered view: 1 branch collapsed.");
  });

  test("an unnarrowed, unfolded map adds nothing", () => {
    expect(
      describeExportFilters(input(), new Set(ALL_NODE_KINDS), {
        collapsedBranchCount: 0,
      }),
    ).toBe("");
    expect(describeExportFilters(input(), new Set(ALL_NODE_KINDS))).toBe("");
  });

  test("the built PDF carries the sentence", () => {
    const text: string = allText(
      build({
        focusedBranchNodeId: "sw-b",
        collapsedNodeIds: new Set<string>(["sw-a"]),
      }),
    );
    expect(text).toContain("Branch under sw-b name only");
    expect(text).toContain("1 branch collapsed");
  });
});
