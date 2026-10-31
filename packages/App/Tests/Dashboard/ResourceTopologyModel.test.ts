import { describe, expect, test } from "@jest/globals";
import {
  ResourceTopologyGraph,
  ResourceTopologyIssue,
  ResourceTopologyNode,
  ResourceTopologyNodeInput,
  RESOURCE_TOPOLOGY_HEALTHS,
  ResourceTopologyHealth,
  buildResourceTopologyGraph,
  compareTopologyNames,
  emptyHealthCounts,
  getOwnTopologySearchMatches,
  getTopologyAncestors,
  getTopologyDescendantIds,
  getTopologyPathIds,
  getTopologyNeighbours,
  getTopologySearchTerms,
  groupTopologyNeighbours,
  isAttentionHealth,
  searchTopology,
  worseHealth,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "Common/Tests/Helpers/SeededRandom";

/*
 * The graph every resource topology is drawn from: a tree of parts under
 * the resource, the relations that cross it, and the open incidents and
 * alerts pinned to the parts. These tests hold the rules every product
 * relies on — what a part says about what is inside it, the order siblings
 * come in, how forgiving the build is with rows that arrive out of step, and
 * that a search finds parts by every word.
 */

function part(
  id: string,
  parentId: string | null,
  overrides: Partial<ResourceTopologyNodeInput> = {},
): ResourceTopologyNodeInput {
  return {
    id: id,
    parentId: parentId,
    kind: overrides.kind || "vmware.host",
    name: overrides.name || id,
    health: overrides.health || "healthy",
    ...overrides,
  };
}

function issue(
  type: "incident" | "alert",
  id: string,
  createdAt: string = "2026-10-20T10:00:00Z",
): ResourceTopologyIssue {
  return {
    type: type,
    id: id,
    title: `${type} ${id}`,
    number: `#${id}`,
    severityName: type === "incident" ? "Critical" : "Warning",
    severityColor: null,
    stateName: "Created",
    createdAt: new Date(createdAt),
  };
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`No part ${id}`);
  }

  return found;
}

/*
 * vcenter
 *   dc-1 (datacenter)
 *     cluster-a (cluster)
 *       esx-1 (host, healthy)  vm-1 (healthy), vm-2 (critical), vm-3 (off)
 *       esx-2 (host, warning)  vm-4 (healthy)
 *     ds-1, ds-2 (datastores)
 */
function sampleGraph(
  issues?: Map<string, Array<ResourceTopologyIssue>>,
): ResourceTopologyGraph {
  return buildResourceTopologyGraph({
    rootId: "vcenter",
    nodes: [
      part("vcenter", null, { kind: "vmware.vcenter", name: "Prod vCenter" }),
      part("dc-1", "vcenter", { kind: "vmware.datacenter", name: "Amsterdam" }),
      part("cluster-a", "dc-1", { kind: "vmware.cluster", name: "Cluster A" }),
      part("esx-1", "cluster-a", { name: "esx-1.lab" }),
      part("esx-2", "cluster-a", { name: "esx-2.lab", health: "warning" }),
      part("vm-1", "esx-1", { kind: "vmware.vm", name: "web-01" }),
      part("vm-2", "esx-1", {
        kind: "vmware.vm",
        name: "db-01",
        health: "critical",
      }),
      part("vm-3", "esx-1", {
        kind: "vmware.vm",
        name: "old-01",
        health: "off",
      }),
      part("vm-4", "esx-2", { kind: "vmware.vm", name: "cache-01" }),
      part("ds-1", "dc-1", { kind: "vmware.datastore", name: "datastore-1" }),
      part("ds-2", "dc-1", { kind: "vmware.datastore", name: "datastore-2" }),
    ],
    relations: [
      {
        from: "vm-1",
        to: "ds-1",
        label: "Uses",
        inverseLabel: "Used by",
      },
    ],
    issues: issues,
  });
}

describe("what a part says about what is inside it", () => {
  test("counts every part below it, by kind, itself left out", () => {
    const graph: ResourceTopologyGraph = sampleGraph();
    const cluster: ResourceTopologyNode = node(graph, "cluster-a");

    expect(cluster.descendantCount).toBe(6);
    expect(cluster.descendantCountsByKind.get("vmware.host")).toBe(2);
    expect(cluster.descendantCountsByKind.get("vmware.vm")).toBe(4);
    expect(node(graph, "vm-1").descendantCount).toBe(0);
    expect(node(graph, "vcenter").descendantCount).toBe(10);
  });

  test("counts what needs attention below it, and what is critical", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    // esx-2 (warning) and vm-2 (critical); a powered-off VM is no problem.
    expect(node(graph, "cluster-a").attentionBelow).toBe(2);
    expect(node(graph, "cluster-a").criticalBelow).toBe(1);
    expect(node(graph, "esx-1").attentionBelow).toBe(1);
    expect(node(graph, "esx-2").attentionBelow).toBe(0);
    expect(graph.attentionCount).toBe(2);
  });

  test("the resource's counts by kind leave out the resource itself", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    expect(graph.countsByKind.get("vmware.vcenter")).toBeUndefined();
    expect(graph.countsByKind.get("vmware.datacenter")).toBe(1);
    expect(graph.countsByKind.get("vmware.datastore")).toBe(2);
  });

  test("counts everything below it by how it is doing: the bar a closed part draws", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    // esx-1 holds vm-1 (healthy), vm-2 (critical) and vm-3 (off).
    expect(node(graph, "esx-1").healthBelow).toEqual({
      critical: 1,
      warning: 0,
      healthy: 1,
      off: 1,
      unknown: 0,
    });
    // The cluster adds esx-1 (healthy), esx-2 (warning) and vm-4 (healthy).
    expect(node(graph, "cluster-a").healthBelow).toEqual({
      critical: 1,
      warning: 1,
      healthy: 3,
      off: 1,
      unknown: 0,
    });
    // A part that holds nothing has nothing to split.
    expect(node(graph, "vm-1").healthBelow).toEqual(emptyHealthCounts());

    // Every part below is counted once: the counts add up to it.
    for (const id of ["vcenter", "dc-1", "cluster-a", "esx-1", "esx-2"]) {
      const counted: number = RESOURCE_TOPOLOGY_HEALTHS.reduce(
        (sum: number, health: ResourceTopologyHealth): number => {
          return sum + node(graph, id).healthBelow[health];
        },
        0,
      );

      expect({ id: id, counted: counted }).toEqual({
        id: id,
        counted: node(graph, id).descendantCount,
      });
    }
  });

  test("an open incident counts its part as critical in the bar above it", () => {
    const graph: ResourceTopologyGraph = sampleGraph(
      new Map<string, Array<ResourceTopologyIssue>>([
        ["vm-1", [issue("incident", "7")]],
      ]),
    );

    expect(node(graph, "esx-1").healthBelow.critical).toBe(2);
    expect(node(graph, "esx-1").healthBelow.healthy).toBe(0);
  });

  test("the counts start empty, one fresh object each time", () => {
    const first: ReturnType<typeof emptyHealthCounts> = emptyHealthCounts();

    first.critical = 4;
    expect(emptyHealthCounts()).toEqual({
      critical: 0,
      warning: 0,
      healthy: 0,
      off: 0,
      unknown: 0,
    });
  });

  test("a section that only groups others is never counted as a part", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null, { kind: "k8s.cluster" }),
        part("nodes", "root", {
          kind: "section",
          isSection: true,
          name: "Nodes",
        }),
        part("node-1", "nodes", { kind: "k8s.node" }),
      ],
    });

    expect(graph.countsByKind.get("section")).toBeUndefined();
    expect(node(graph, "root").descendantCount).toBe(1);
    expect(node(graph, "nodes").descendantCount).toBe(1);
  });
});

describe("open incidents and alerts", () => {
  test("an incident makes a part critical and an alert at least a warning", () => {
    const graph: ResourceTopologyGraph = sampleGraph(
      new Map<string, Array<ResourceTopologyIssue>>([
        ["vm-1", [issue("incident", "1")]],
        ["vm-4", [issue("alert", "2")]],
        ["vm-2", [issue("alert", "3")]],
      ]),
    );

    expect(node(graph, "vm-1").effectiveHealth).toBe("critical");
    expect(node(graph, "vm-1").health).toBe("healthy");
    expect(node(graph, "vm-4").effectiveHealth).toBe("warning");
    // An alert never softens a critical part.
    expect(node(graph, "vm-2").effectiveHealth).toBe("critical");
    expect(node(graph, "vm-1").needsAttention).toBe(true);
  });

  test("roll up into every part above them and into the resource's totals", () => {
    const graph: ResourceTopologyGraph = sampleGraph(
      new Map<string, Array<ResourceTopologyIssue>>([
        ["vm-1", [issue("incident", "1"), issue("alert", "4")]],
        ["vm-4", [issue("alert", "2")]],
        ["vcenter", [issue("incident", "9")]],
      ]),
    );

    expect(node(graph, "esx-1").incidentsBelow).toBe(1);
    expect(node(graph, "esx-1").alertsBelow).toBe(1);
    expect(node(graph, "cluster-a").incidentsBelow).toBe(1);
    expect(node(graph, "cluster-a").alertsBelow).toBe(2);
    // The resource's own issue counts in the totals, not in "below".
    expect(node(graph, "vcenter").incidentsBelow).toBe(1);
    expect(graph.incidentCount).toBe(2);
    expect(graph.alertCount).toBe(2);
    expect(node(graph, "vcenter").needsAttention).toBe(true);
  });
});

describe("the order siblings come in", () => {
  test("what needs attention first, critical before warning, then by name", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("b", "root", { name: "bravo" }),
        part("a", "root", { name: "alpha" }),
        part("w", "root", { name: "zulu", health: "warning" }),
        part("c", "root", { name: "yankee", health: "critical" }),
        part("o", "root", { name: "aardvark", health: "off" }),
      ],
    });

    expect(node(graph, "root").childIds).toEqual(["c", "w", "o", "a", "b"]);
  });

  test("a quiet part with trouble inside it comes before a quiet one", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("quiet", "root", { name: "a-quiet" }),
        part("holds-trouble", "root", { name: "z-holds" }),
        part("broken", "holds-trouble", { health: "critical" }),
      ],
    });

    expect(node(graph, "root").childIds).toEqual(["holds-trouble", "quiet"]);
  });

  test("numbers inside names sort as numbers, and case does not split them", () => {
    expect(compareTopologyNames("esx-2", "esx-10")).toBeLessThan(0);
    expect(compareTopologyNames("Web", "web")).not.toBe(0);
    expect(["vm-10", "VM-9", "vm-1"].sort(compareTopologyNames)).toEqual([
      "vm-1",
      "VM-9",
      "vm-10",
    ]);
  });

  test("the order never depends on the order the rows arrived in", () => {
    const inputs: Array<ResourceTopologyNodeInput> = [part("root", null)];

    for (let index: number = 0; index < 40; index++) {
      inputs.push(
        part(`p-${index}`, "root", {
          name: `part-${index % 7}`,
          health: index % 5 === 0 ? "warning" : "healthy",
        }),
      );
    }

    const random: SeededRandom = seededRandom(4123);
    const expected: Array<string> = node(
      buildResourceTopologyGraph({ rootId: "root", nodes: inputs }),
      "root",
    ).childIds;

    for (let round: number = 0; round < 5; round++) {
      const shuffledInputs: Array<ResourceTopologyNodeInput> = shuffled(
        inputs,
        random,
      );

      expect(
        node(
          buildResourceTopologyGraph({ rootId: "root", nodes: shuffledInputs }),
          "root",
        ).childIds,
      ).toEqual(expected);
    }
  });
});

describe("rows that arrive out of step", () => {
  test("a part whose parent is not there hangs off the resource", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", null), part("orphan", "gone")],
    });

    expect(node(graph, "orphan").parentId).toBe("root");
    expect(node(graph, "root").childIds).toEqual(["orphan"]);
  });

  test("a parent chain that loops is cut at the resource", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", null), part("a", "b"), part("b", "a")],
    });

    const reachable: Set<string> = new Set<string>(
      getTopologyDescendantIds(graph, "root"),
    );

    expect(reachable.has("a")).toBe(true);
    expect(reachable.has("b")).toBe(true);
  });

  test("a repeated id keeps its first row", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("a", "root", { name: "first" }),
        part("a", "root", { name: "second" }),
      ],
    });

    expect(node(graph, "a").name).toBe("first");
    expect(graph.nodes.size).toBe(2);
  });

  test("the resource never has a parent, whatever its row says", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", "elsewhere"), part("a", "root")],
    });

    expect(node(graph, "root").parentId).toBeNull();
  });

  test("a graph without its resource is refused", () => {
    expect(() => {
      buildResourceTopologyGraph({ rootId: "root", nodes: [part("a", null)] });
    }).toThrow();
  });

  test("relations to parts that are not there, to themselves, or repeated are dropped", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [part("root", null), part("a", "root"), part("b", "root")],
      relations: [
        { from: "a", to: "b", label: "Runs on", inverseLabel: "Runs here" },
        { from: "a", to: "b", label: "Runs on", inverseLabel: "Runs here" },
        { from: "a", to: "a", label: "Runs on", inverseLabel: "Runs here" },
        { from: "a", to: "gone", label: "Runs on", inverseLabel: "Runs here" },
      ],
    });

    expect(graph.relations).toHaveLength(1);
    expect(graph.relationsByNode.get("a")).toHaveLength(1);
    expect(graph.relationsByNode.get("b")).toHaveLength(1);
  });

  test("a relation the nesting already shows is dropped, either way round", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("node", "root"),
        part("pod", "node"),
        part("container", "pod"),
        part("other", "root"),
      ],
      relations: [
        // A pod inside its node: "Runs on" is where it is drawn.
        {
          from: "pod",
          to: "node",
          label: "Runs on",
          inverseLabel: "Runs here",
        },
        { from: "node", to: "container", label: "Holds", inverseLabel: "In" },
        {
          from: "container",
          to: "other",
          label: "Uses",
          inverseLabel: "Used by",
        },
      ],
    });

    expect(
      graph.relations.map((relation: { from: string; to: string }): string => {
        return `${relation.from}>${relation.to}`;
      }),
    ).toEqual(["container>other"]);
  });

  test("a deep tree builds without recursion limits", () => {
    const inputs: Array<ResourceTopologyNodeInput> = [part("p-0", null)];

    for (let index: number = 1; index < 20000; index++) {
      inputs.push(part(`p-${index}`, `p-${index - 1}`));
    }

    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "p-0",
      nodes: inputs,
    });

    expect(node(graph, "p-0").descendantCount).toBe(19999);
    expect(node(graph, "p-19999").depth).toBe(19999);
  });
});

describe("walking the graph", () => {
  test("ancestors run from the resource down to the parent", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    expect(
      getTopologyAncestors(graph, "vm-2").map(
        (ancestor: ResourceTopologyNode): string => {
          return ancestor.id;
        },
      ),
    ).toEqual(["vcenter", "dc-1", "cluster-a", "esx-1"]);
    expect(getTopologyAncestors(graph, "vcenter")).toEqual([]);
  });

  test("the path to a part runs from the resource down to it, both included", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    expect(getTopologyPathIds(graph, "vm-2")).toEqual(
      new Set<string>(["vcenter", "dc-1", "cluster-a", "esx-1", "vm-2"]),
    );
    expect(getTopologyPathIds(graph, "vcenter")).toEqual(
      new Set<string>(["vcenter"]),
    );
    expect(getTopologyPathIds(graph, null).size).toBe(0);
    expect(getTopologyPathIds(graph, "gone").size).toBe(0);
  });

  test("a relation reads from each end with its own words", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    expect(getTopologyNeighbours(graph, "vm-1")).toEqual([
      { nodeId: "ds-1", label: "Uses", direction: "out" },
    ]);
    expect(getTopologyNeighbours(graph, "ds-1")).toEqual([
      { nodeId: "vm-1", label: "Used by", direction: "in" },
    ]);
  });

  test("a part's relations group by what they are, each label said once", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "host",
      nodes: [
        part("host", null, { kind: "host" }),
        part("checkout", "host", { name: "checkout" }),
        part("mobile", "host", { name: "mobile-bff" }),
        part("storefront", "host", { name: "storefront" }),
        part("payments", "host", { name: "payments" }),
        part("postgres", "host", { name: "postgres orders" }),
      ],
      relations: [
        {
          from: "mobile",
          to: "checkout",
          label: "Calls",
          inverseLabel: "Called by",
        },
        {
          from: "checkout",
          to: "postgres",
          label: "Calls",
          inverseLabel: "Called by",
        },
        {
          from: "storefront",
          to: "checkout",
          label: "Calls",
          inverseLabel: "Called by",
        },
        {
          from: "checkout",
          to: "payments",
          label: "Calls",
          inverseLabel: "Called by",
        },
      ],
    });
    const groups: Array<{ label: string; ids: Array<string> }> =
      groupTopologyNeighbours(getTopologyNeighbours(graph, "checkout")).map(
        (group: {
          label: string;
          neighbours: Array<{ nodeId: string }>;
        }): { label: string; ids: Array<string> } => {
          return {
            label: group.label,
            ids: group.neighbours.map((neighbour: { nodeId: string }) => {
              return neighbour.nodeId;
            }),
          };
        },
      );

    // The panel says "Called by" over two services and "Calls" over two.
    expect(groups).toEqual([
      { label: "Called by", ids: ["mobile", "storefront"] },
      { label: "Calls", ids: ["payments", "postgres"] },
    ]);
    expect(groupTopologyNeighbours([])).toEqual([]);
  });
});

describe("search", () => {
  test("every word must be found, in any order and any case", () => {
    const graph: ResourceTopologyGraph = sampleGraph();

    expect(Array.from(searchTopology(graph, "DB"))).toEqual(["vm-2"]);
    expect(Array.from(searchTopology(graph, "lab esx-2"))).toEqual(["esx-2"]);
    expect(searchTopology(graph, "lab nothing").size).toBe(0);
  });

  test("finds parts by what they are, in the words a kind label gives", () => {
    const graph: ResourceTopologyGraph = sampleGraph();
    const kindLabel: (kind: string) => Array<string> = (
      kind: string,
    ): Array<string> => {
      return kind === "vmware.datastore" ? ["Datastore", "Datenspeicher"] : [];
    };

    expect(searchTopology(graph, "datenspeicher", kindLabel).size).toBe(2);
  });

  test("finds parts by their keywords and where they sit", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null),
        part("pod", "root", {
          name: "checkout-7d9f",
          context: "payments",
          keywords: ["10.0.3.14"],
        }),
      ],
    });

    expect(Array.from(searchTopology(graph, "payments"))).toEqual(["pod"]);
    expect(Array.from(searchTopology(graph, "10.0.3"))).toEqual(["pod"]);
  });

  test("what a search counts is what it found for itself, not what sits inside it", () => {
    /*
     * A virtual machine's line names its host. A search for the host found
     * the host and every virtual machine on it; it counts and marks the
     * host alone ("1 part matches"), while the machines are still drawn.
     */
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "vcenter",
      nodes: [
        part("vcenter", null, { kind: "vmware.vcenter" }),
        part("esx", "vcenter", { name: "esx101.ams.acme.example" }),
        part("vm-db", "esx", {
          kind: "vmware.vm",
          name: "db-primary-01",
          context: "esx101.ams.acme.example",
        }),
        part("vm-web", "esx", {
          kind: "vmware.vm",
          name: "web-esx101-proxy",
          context: "esx101.ams.acme.example",
        }),
        part("elsewhere", "vcenter", {
          kind: "vmware.vm",
          name: "orphan-01",
          context: "esx101.ams.acme.example",
        }),
      ],
    });
    const found: Set<string> = searchTopology(graph, "esx101");

    expect(Array.from(found).sort()).toEqual(
      ["elsewhere", "esx", "vm-db", "vm-web"].sort(),
    );
    expect(
      Array.from(getOwnTopologySearchMatches(graph, found, "esx101")).sort(),
    ).toEqual(
      // Its own name says esx101; the orphan's host is not on the map.
      ["elsewhere", "esx", "vm-web"].sort(),
    );
    // A search that names a machine and its host finds the machine.
    const both: Set<string> = searchTopology(graph, "esx101 db-primary");

    expect(
      Array.from(getOwnTopologySearchMatches(graph, both, "esx101 db-primary")),
    ).toEqual(["vm-db"]);
    // Nothing found, nothing counted.
    expect(
      getOwnTopologySearchMatches(graph, new Set<string>(), "esx101").size,
    ).toBe(0);
  });

  test("never matches the resource itself or a section", () => {
    const graph: ResourceTopologyGraph = buildResourceTopologyGraph({
      rootId: "root",
      nodes: [
        part("root", null, { name: "nodes" }),
        part("section", "root", {
          name: "Nodes",
          isSection: true,
          kind: "section",
        }),
        part("n", "section", { name: "node-1", kind: "k8s.node" }),
      ],
    });

    expect(Array.from(searchTopology(graph, "node"))).toEqual(["n"]);
  });

  test("blank searches find nothing, and only ten words are read", () => {
    expect(getTopologySearchTerms("   ")).toEqual([]);
    expect(getTopologySearchTerms("a b c d e f g h i j k l")).toHaveLength(10);
    expect(getTopologySearchTerms("  Web   DB ")).toEqual(["web", "db"]);
  });
});

describe("health words", () => {
  test("only critical and warning need attention", () => {
    expect(isAttentionHealth("critical")).toBe(true);
    expect(isAttentionHealth("warning")).toBe(true);
    expect(isAttentionHealth("healthy")).toBe(false);
    expect(isAttentionHealth("off")).toBe(false);
    expect(isAttentionHealth("unknown")).toBe(false);
  });

  test("the worse of two is critical, then warning, else the first", () => {
    expect(worseHealth("healthy", "critical")).toBe("critical");
    expect(worseHealth("warning", "off")).toBe("warning");
    expect(worseHealth("off", "healthy")).toBe("off");
  });
});
