import { describe, expect, test } from "@jest/globals";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import DataAssetLineageSource from "Common/Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "Common/Types/DataObservability/DataLineageExpansion";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "Common/Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  LINEAGE_CARD_HEIGHT,
  LINEAGE_CARD_WIDTH,
  LINEAGE_FIT_PADDING,
  LineageLayout,
  LineagePoint,
  LineageViewport,
  canExpandLineageCard,
  countLineageTables,
  getLineageExpandRequest,
  getLineageViewport,
  getLineageViewportAfterExpanding,
  layoutLineage,
  mergeLineageExpansion,
} from "../../FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

/*
 * DRAWING MORE OF A LINEAGE DIAGRAM WHERE IT IS (#6667), WITHOUT A BROWSER.
 *
 * Which counts can be pressed (canExpandLineageCard), what pressing one
 * asks (getLineageExpandRequest), how the answer is added to the drawing
 * (mergeLineageExpansion) - nothing drawn twice, no arrow to a card not
 * drawn, every count kept true - and where the view goes once it grows
 * (getLineageViewportAfterExpanding): the card pressed where it was on the
 * screen, the view sliding as little as brings what is new into view.
 * LineageDrawMore.test.tsx (Common) presses the counts on a drawing.
 */

const FOCUS: string = getLineageTableNodeId("focus");

function tableNode(
  name: string,
  side: DataLineageSide,
  depth: number,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: getLineageTableNodeId(name),
    kind: DataLineageNodeKind.Table,
    side,
    depth,
    name,
    dataAssetId: name,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    hiddenUpstreamCount: 0,
    hiddenDownstreamCount: 0,
    ...fields,
  };
}

function focusNode(
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return tableNode("focus", DataLineageSide.Focus, 0, fields);
}

function up(
  name: string,
  depth: number = -1,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return tableNode(name, DataLineageSide.Upstream, depth, fields);
}

function down(
  name: string,
  depth: number = 1,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return tableNode(name, DataLineageSide.Downstream, depth, fields);
}

function pipelineNode(
  name: string,
  fields: Partial<DataTableLineageNode> = {},
): DataTableLineageNode {
  return {
    id: getLineagePipelineNodeId(name),
    kind: DataLineageNodeKind.Pipeline,
    side: DataLineageSide.Upstream,
    depth: -1,
    name,
    dataPipelineId: name,
    lastRunState: "COMPLETE",
    ...fields,
  };
}

function dashboardNode(name: string, depth: number = 2): DataTableLineageNode {
  return {
    id: getLineageDashboardNodeId(name),
    kind: DataLineageNodeKind.Dashboard,
    side: DataLineageSide.Downstream,
    depth,
    name,
    dataDashboardId: name,
    tool: "Metabase",
    url: null,
  };
}

function edge(
  kind: DataLineageEdgeKind,
  source: string,
  target: string,
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn: [DataAssetLineageSource.Pipeline],
    pipelines: [],
    lastSeenAt: null,
  };
}

function feeds(source: string, target: string): DataTableLineageEdge {
  return edge(
    DataLineageEdgeKind.Feeds,
    getLineageTableNodeId(source),
    getLineageTableNodeId(target),
  );
}

function lineageOf(
  nodes: Array<DataTableLineageNode>,
  edges: Array<DataTableLineageEdge>,
  fields: Partial<DataTableLineage> = {},
): DataTableLineage {
  return {
    focusNodeId: FOCUS,
    depth: 3,
    nodes,
    edges,
    hiddenDashboardCount: 0,
    isTruncated: false,
    ...fields,
  };
}

function expansionOf(
  fields: Partial<DataLineageExpansion> & {
    nodeId: string;
    side: DataLineageSide;
  },
): DataLineageExpansion {
  return {
    hiddenCount: 0,
    nodes: [],
    edges: [],
    hiddenDashboardCount: null,
    isTruncated: false,
    ...fields,
  };
}

function nodeIn(lineage: DataTableLineage, id: string): DataTableLineageNode {
  const node: DataTableLineageNode | undefined = lineage.nodes.find(
    (candidate: DataTableLineageNode): boolean => {
      return candidate.id === id;
    },
  );

  expect(node).toBeDefined();

  return node!;
}

function idsOf(items: Array<{ id: string }>): Array<string> {
  return items.map((item: { id: string }): string => {
    return item.id;
  });
}

// The tables a side holds, as many as asked: "u0", "u1", ...
function sideOf(
  count: number,
  side: DataLineageSide.Upstream | DataLineageSide.Downstream,
): Array<DataTableLineageNode> {
  const nodes: Array<DataTableLineageNode> = [];

  for (let index: number = 0; index < count; index++) {
    nodes.push(
      side === DataLineageSide.Upstream
        ? up(`u${index}`, -1)
        : down(`d${index}`, 1),
    );
  }

  return nodes;
}

describe("the tables a side holds", () => {
  test("counts each side's tables, never a pipeline, a dashboard or the table itself", () => {
    const lineage: DataTableLineage = lineageOf(
      [
        focusNode(),
        up("a"),
        up("b", -2),
        pipelineNode("etl"),
        down("c"),
        dashboardNode("board"),
      ],
      [],
    );

    expect(countLineageTables(lineage, DataLineageSide.Upstream)).toBe(2);
    expect(countLineageTables(lineage, DataLineageSide.Downstream)).toBe(1);
    expect(countLineageTables(lineage, DataLineageSide.Focus)).toBe(1);
  });
});

describe("which counts draw more when pressed", () => {
  const lineage: DataTableLineage = lineageOf(
    [
      focusNode({ hiddenUpstreamCount: 2, hiddenDownstreamCount: 3 }),
      up("a", -1, { hiddenUpstreamCount: 4, hiddenDownstreamCount: 1 }),
      down("b", 1, { hiddenDownstreamCount: 5, hiddenUpstreamCount: 1 }),
      up("quiet"),
      pipelineNode("writer", { hiddenUpstreamCount: 2 }),
      dashboardNode("board"),
    ],
    [],
  );

  test.each([
    ["the table itself, upstream", FOCUS, DataLineageSide.Upstream, true],
    ["the table itself, downstream", FOCUS, DataLineageSide.Downstream, true],
    ["a table upstream, upstream", "table:a", DataLineageSide.Upstream, true],
    [
      "a table upstream, downstream",
      "table:a",
      DataLineageSide.Downstream,
      false,
    ],
    [
      "a table downstream, downstream",
      "table:b",
      DataLineageSide.Downstream,
      true,
    ],
    [
      "a table downstream, upstream",
      "table:b",
      DataLineageSide.Upstream,
      false,
    ],
    [
      "a table counting nothing",
      "table:quiet",
      DataLineageSide.Upstream,
      false,
    ],
    [
      "a pipeline the drawing is not about",
      "pipeline:writer",
      DataLineageSide.Upstream,
      false,
    ],
    ["the middle, as a way", FOCUS, DataLineageSide.Focus, false],
  ])(
    "%s: %p",
    (
      _name: string,
      nodeId: string,
      side: DataLineageSide,
      expected: boolean,
    ) => {
      expect(canExpandLineageCard(lineage, nodeIn(lineage, nodeId), side)).toBe(
        expected,
      );
    },
  );

  test("a dashboard never does, whatever it says", () => {
    const board: DataTableLineageNode = {
      ...dashboardNode("board"),
      hiddenUpstreamCount: 3,
      hiddenDownstreamCount: 3,
    };

    expect(
      canExpandLineageCard(lineage, board, DataLineageSide.Downstream),
    ).toBe(false);
  });

  test("the pipeline a drawing is about draws what it reads and what it writes", () => {
    const etl: DataTableLineageNode = pipelineNode("etl", {
      side: DataLineageSide.Focus,
      depth: 0,
      hiddenUpstreamCount: 3,
      hiddenDownstreamCount: 1,
    });
    const pipelineLineage: DataTableLineage = lineageOf(
      [etl, up("a"), down("b")],
      [],
      { focusNodeId: etl.id },
    );

    expect(
      canExpandLineageCard(pipelineLineage, etl, DataLineageSide.Upstream),
    ).toBe(true);
    expect(
      canExpandLineageCard(pipelineLineage, etl, DataLineageSide.Downstream),
    ).toBe(true);
  });

  test("a side holding its most tables draws no more; one short of it still does", () => {
    const full: DataTableLineage = lineageOf(
      [
        focusNode({ hiddenUpstreamCount: 1, hiddenDownstreamCount: 1 }),
        ...sideOf(MAX_DATA_LINEAGE_TABLES_PER_SIDE, DataLineageSide.Upstream),
        ...sideOf(
          MAX_DATA_LINEAGE_TABLES_PER_SIDE - 1,
          DataLineageSide.Downstream,
        ),
      ],
      [],
    );
    const focus: DataTableLineageNode = nodeIn(full, FOCUS);

    expect(canExpandLineageCard(full, focus, DataLineageSide.Upstream)).toBe(
      false,
    );
    expect(canExpandLineageCard(full, focus, DataLineageSide.Downstream)).toBe(
      true,
    );
  });
});

describe("what pressing a count asks", () => {
  const lineage: DataTableLineage = lineageOf(
    [
      focusNode(),
      up("a", -1),
      up("b", -2),
      pipelineNode("etl"),
      down("c", 1),
      dashboardNode("board"),
      dashboardNode("other", 3),
    ],
    [],
  );

  test("names the drawing, the card, the way, every table drawn with its side and steps, and every dashboard", () => {
    const request: DataLineageExpandRequest = getLineageExpandRequest({
      lineage,
      nodeId: "table:a",
      side: DataLineageSide.Upstream,
      withColumns: false,
    });

    expect(request).toEqual({
      focusNodeId: FOCUS,
      nodeId: "table:a",
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: "focus", side: DataLineageSide.Focus, depth: 0 },
        { dataAssetId: "a", side: DataLineageSide.Upstream, depth: -1 },
        { dataAssetId: "b", side: DataLineageSide.Upstream, depth: -2 },
        { dataAssetId: "c", side: DataLineageSide.Downstream, depth: 1 },
      ],
      dataDashboardIds: ["board", "other"],
    });
    // Columns are asked for only when the drawing was.
    expect("withColumns" in request).toBe(false);
  });

  test("asks for the new arrows' columns when the drawing was read with them", () => {
    expect(
      getLineageExpandRequest({
        lineage,
        nodeId: FOCUS,
        side: DataLineageSide.Downstream,
        withColumns: true,
      }).withColumns,
    ).toBe(true);
  });
});

describe("adding the answer to the drawing", () => {
  /*
   * a2 -> a -> focus -> b -> board; a counts 4 more upstream, b 2 more
   * downstream, the table 1 more each way.
   */
  function drawing(): DataTableLineage {
    return lineageOf(
      [
        focusNode({ hiddenUpstreamCount: 1, hiddenDownstreamCount: 1 }),
        up("a", -1, { hiddenUpstreamCount: 4 }),
        up("a2", -2, { hiddenUpstreamCount: 2 }),
        down("b", 1, { hiddenDownstreamCount: 2 }),
        dashboardNode("board"),
      ],
      [
        feeds("a2", "a"),
        feeds("a", "focus"),
        feeds("focus", "b"),
        edge(
          DataLineageEdgeKind.Reads,
          "table:b",
          getLineageDashboardNodeId("board"),
        ),
      ],
      { hiddenDashboardCount: 3 },
    );
  }

  test("what is drawn stays as it is, where it is; what is new follows, in the answer's order", () => {
    const before: DataTableLineage = drawing();
    const merged: DataTableLineage = mergeLineageExpansion(
      before,
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 1,
        nodes: [up("n2", -2), up("n1", -2)],
        edges: [feeds("n2", "a"), feeds("n1", "a")],
      }),
    );

    expect(idsOf(merged.nodes)).toEqual([
      ...idsOf(before.nodes),
      "table:n2",
      "table:n1",
    ]);
    expect(merged.focusNodeId).toBe(before.focusNodeId);
    expect(merged.depth).toBe(before.depth);
    // Arrows in one order whatever order they came in.
    expect(idsOf(merged.edges)).toEqual([...idsOf(merged.edges)].sort());
    expect(idsOf(merged.edges)).toEqual(
      expect.arrayContaining([feeds("n2", "a").id, feeds("n1", "a").id]),
    );
  });

  test("the drawing asked from is never changed", () => {
    const before: DataTableLineage = drawing();
    const copy: DataTableLineage = JSON.parse(JSON.stringify(before));

    mergeLineageExpansion(
      before,
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 0,
        nodes: [up("n1", -2)],
        edges: [feeds("n1", "a"), feeds("n1", "a2")],
      }),
    );

    expect(before).toEqual(copy);
  });

  test("a card or arrow it has already is not drawn twice, and keeps what the drawing says of it", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 3,
        nodes: [
          up("a2", -2, { name: "renamed", hiddenUpstreamCount: 9 }),
          up("n1", -2),
        ],
        edges: [feeds("a2", "a"), feeds("n1", "a")],
      }),
    );

    expect(
      idsOf(merged.nodes).filter((id: string): boolean => {
        return id === "table:a2";
      }),
    ).toHaveLength(1);
    expect(nodeIn(merged, "table:a2").name).toBe("a2");
    expect(nodeIn(merged, "table:a2").hiddenUpstreamCount).toBe(2);
    expect(
      idsOf(merged.edges).filter((id: string): boolean => {
        return id === feeds("a2", "a").id;
      }),
    ).toHaveLength(1);
  });

  test("never an arrow to a card the drawing does not have", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        nodes: [up("n1", -2)],
        edges: [feeds("n1", "a"), feeds("ghost", "n1"), feeds("n1", "ghost")],
      }),
    );

    expect(idsOf(merged.edges)).not.toContain(feeds("ghost", "n1").id);
    expect(idsOf(merged.edges)).not.toContain(feeds("n1", "ghost").id);
    expect(idsOf(merged.edges)).toContain(feeds("n1", "a").id);
  });

  test("the card pressed takes the answer's count that way, its other way as it was", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: FOCUS,
        side: DataLineageSide.Downstream,
        hiddenCount: 7,
        nodes: [down("n1")],
        edges: [feeds("focus", "n1")],
      }),
    );

    expect(nodeIn(merged, FOCUS).hiddenDownstreamCount).toBe(7);
    expect(nodeIn(merged, FOCUS).hiddenUpstreamCount).toBe(1);
  });

  test("a card drawn before that counted a table drawn now counts one fewer, its own way only", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 2,
        nodes: [up("n1", -2), up("n2", -2)],
        edges: [
          feeds("n1", "a"),
          feeds("n2", "a"),
          // a2 counted n1, a table it is built from.
          feeds("n1", "a2"),
          // The table itself counted n2 upstream too.
          feeds("n2", "focus"),
          // n2 is also built from a2: a2 counts upstream only, so nothing changes for it here.
          feeds("a2", "n2"),
        ],
      }),
    );

    expect(nodeIn(merged, "table:a").hiddenUpstreamCount).toBe(2);
    expect(nodeIn(merged, "table:a2").hiddenUpstreamCount).toBe(1);
    expect(nodeIn(merged, FOCUS).hiddenUpstreamCount).toBe(0);
    expect(nodeIn(merged, FOCUS).hiddenDownstreamCount).toBe(1);
  });

  test("downstream too: a table downstream, or the table itself, that counted a table built from it", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:b",
        side: DataLineageSide.Downstream,
        hiddenCount: 0,
        nodes: [down("n1", 2), down("n2", 2)],
        edges: [
          feeds("b", "n1"),
          feeds("b", "n2"),
          feeds("focus", "n2"),
          // An upstream table feeding a table drawn now downstream: it never counted it.
          feeds("a", "n1"),
        ],
      }),
    );

    expect(nodeIn(merged, "table:b").hiddenDownstreamCount).toBe(0);
    expect(nodeIn(merged, FOCUS).hiddenDownstreamCount).toBe(0);
    expect(nodeIn(merged, "table:a").hiddenUpstreamCount).toBe(4);
    expect(nodeIn(merged, "table:a").hiddenDownstreamCount).toBe(0);
  });

  test("an arrow between two cards drawn before - a cycle, or a table reached another way - changes no count", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 3,
        nodes: [],
        // b, drawn downstream, also feeds a: the arrow is joined, nothing counted again.
        edges: [feeds("b", "a")],
      }),
    );

    expect(idsOf(merged.edges)).toContain(feeds("b", "a").id);
    expect(nodeIn(merged, "table:b").hiddenDownstreamCount).toBe(2);
    expect(nodeIn(merged, "table:a").hiddenUpstreamCount).toBe(3);
  });

  test("two tables drawn now, joined to each other, change no count of a card drawn before", () => {
    const merged: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: 2,
        nodes: [up("n1", -2), up("n2", -2)],
        edges: [feeds("n1", "a"), feeds("n2", "n1")],
      }),
    );

    expect(nodeIn(merged, "table:a2").hiddenUpstreamCount).toBe(2);
    expect(nodeIn(merged, FOCUS).hiddenUpstreamCount).toBe(1);
  });

  test("a count never goes below none", () => {
    const lineage: DataTableLineage = drawing();
    lineage.nodes[2] = up("a2", -2, { hiddenUpstreamCount: 0 });

    const merged: DataTableLineage = mergeLineageExpansion(
      lineage,
      expansionOf({
        nodeId: "table:a",
        side: DataLineageSide.Upstream,
        hiddenCount: -3,
        nodes: [up("n1", -2)],
        edges: [feeds("n1", "a"), feeds("n1", "a2")],
      }),
    );

    expect(nodeIn(merged, "table:a2").hiddenUpstreamCount).toBe(0);
    expect(nodeIn(merged, "table:a").hiddenUpstreamCount).toBe(0);
  });

  describe("on a pipeline's drawing", () => {
    const ETL: string = getLineagePipelineNodeId("etl");

    function pipelineDrawing(): DataTableLineage {
      return lineageOf(
        [
          pipelineNode("etl", {
            side: DataLineageSide.Focus,
            depth: 0,
            hiddenUpstreamCount: 3,
            hiddenDownstreamCount: 2,
          }),
          up("r1", -1, { hiddenUpstreamCount: 2 }),
          down("w1", 1, { hiddenDownstreamCount: 1 }),
        ],
        [
          edge(DataLineageEdgeKind.Reads, "table:r1", ETL),
          edge(DataLineageEdgeKind.Writes, ETL, "table:w1"),
        ],
        { focusNodeId: ETL, depth: 1 },
      );
    }

    test("the pipeline pressed takes the answer's count, whatever arrows it draws", () => {
      const merged: DataTableLineage = mergeLineageExpansion(
        pipelineDrawing(),
        expansionOf({
          nodeId: ETL,
          side: DataLineageSide.Upstream,
          hiddenCount: 1,
          nodes: [up("r2"), up("r3")],
          edges: [
            edge(DataLineageEdgeKind.Reads, "table:r2", ETL),
            edge(DataLineageEdgeKind.Reads, "table:r3", ETL),
          ],
        }),
      );

      expect(nodeIn(merged, ETL).hiddenUpstreamCount).toBe(1);
      expect(nodeIn(merged, ETL).hiddenDownstreamCount).toBe(2);
    });

    test("a table drawn from another card that the pipeline reads, or writes, is one fewer on its card", () => {
      const reads: DataTableLineage = mergeLineageExpansion(
        pipelineDrawing(),
        expansionOf({
          nodeId: "table:r1",
          side: DataLineageSide.Upstream,
          hiddenCount: 1,
          nodes: [up("r9", -2)],
          edges: [
            feeds("r9", "r1"),
            edge(DataLineageEdgeKind.Reads, "table:r9", ETL),
          ],
        }),
      );

      expect(nodeIn(reads, ETL).hiddenUpstreamCount).toBe(2);
      expect(nodeIn(reads, "table:r1").hiddenUpstreamCount).toBe(1);

      const written: DataTableLineage = mergeLineageExpansion(
        pipelineDrawing(),
        expansionOf({
          nodeId: "table:w1",
          side: DataLineageSide.Downstream,
          hiddenCount: 0,
          nodes: [down("w9", 2)],
          edges: [
            feeds("w1", "w9"),
            edge(DataLineageEdgeKind.Writes, ETL, "table:w9"),
          ],
        }),
      );

      expect(nodeIn(written, ETL).hiddenDownstreamCount).toBe(1);
    });

    test("a pipeline that loads a table drawn now from outside counts nothing", () => {
      const merged: DataTableLineage = mergeLineageExpansion(
        lineageOf(
          [
            focusNode({ hiddenUpstreamCount: 1 }),
            up("a", -1, { hiddenUpstreamCount: 1 }),
          ],
          [feeds("a", "focus")],
        ),
        expansionOf({
          nodeId: "table:a",
          side: DataLineageSide.Upstream,
          hiddenCount: 0,
          nodes: [up("n1", -2), pipelineNode("sync", { depth: -3 })],
          edges: [
            feeds("n1", "a"),
            edge(
              DataLineageEdgeKind.Writes,
              getLineagePipelineNodeId("sync"),
              "table:n1",
            ),
          ],
        }),
      );

      expect(idsOf(merged.nodes)).toContain(getLineagePipelineNodeId("sync"));
      expect(nodeIn(merged, FOCUS).hiddenUpstreamCount).toBe(1);
    });
  });

  test("the dashboards not drawn are as the answer counts them, or as they were when it does not", () => {
    const counted: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:b",
        side: DataLineageSide.Downstream,
        hiddenDashboardCount: 5,
      }),
    );
    const notCounted: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({ nodeId: "table:a", side: DataLineageSide.Upstream }),
    );
    const none: DataTableLineage = mergeLineageExpansion(
      drawing(),
      expansionOf({
        nodeId: "table:b",
        side: DataLineageSide.Downstream,
        hiddenDashboardCount: 0,
      }),
    );

    expect(counted.hiddenDashboardCount).toBe(5);
    expect(notCounted.hiddenDashboardCount).toBe(3);
    expect(none.hiddenDashboardCount).toBe(0);
  });

  test("a drawing that could not hold it all stays so; an answer that could not makes it so", () => {
    expect(
      mergeLineageExpansion(
        { ...drawing(), isTruncated: true },
        expansionOf({ nodeId: "table:a", side: DataLineageSide.Upstream }),
      ).isTruncated,
    ).toBe(true);
    expect(
      mergeLineageExpansion(
        drawing(),
        expansionOf({
          nodeId: "table:a",
          side: DataLineageSide.Upstream,
          isTruncated: true,
        }),
      ).isTruncated,
    ).toBe(true);
    expect(
      mergeLineageExpansion(
        drawing(),
        expansionOf({ nodeId: "table:a", side: DataLineageSide.Upstream }),
      ).isTruncated,
    ).toBe(false);
  });

  test("any drawing, any answer: nothing twice, every arrow's cards drawn, no count below none, the same answer twice changes nothing more", () => {
    const random: SeededRandom = seededRandom(6667);

    for (let round: number = 0; round < 300; round++) {
      const names: Array<string> = [];
      const nodes: Array<DataTableLineageNode> = [
        focusNode({
          hiddenUpstreamCount: random(4),
          hiddenDownstreamCount: random(4),
        }),
      ];

      for (let index: number = 0; index < 2 + random(8); index++) {
        const isUp: boolean = random(2) === 0;
        const name: string = `t${index}`;

        names.push(name);
        nodes.push(
          isUp
            ? up(name, -1 - random(3), { hiddenUpstreamCount: random(5) })
            : down(name, 1 + random(3), { hiddenDownstreamCount: random(5) }),
        );
      }

      const all: Array<string> = ["focus", ...names];
      const edges: Array<DataTableLineageEdge> = [];

      for (let index: number = 0; index < random(12); index++) {
        const source: string = all[random(all.length)]!;
        const target: string = all[random(all.length)]!;

        if (source !== target) {
          edges.push(feeds(source, target));
        }
      }

      const lineage: DataTableLineage = lineageOf(
        nodes,
        edges.filter(
          (candidate: DataTableLineageEdge, index: number): boolean => {
            return (
              edges.findIndex((other: DataTableLineageEdge): boolean => {
                return other.id === candidate.id;
              }) === index
            );
          },
        ),
      );
      const pressed: DataTableLineageNode = nodes[random(nodes.length)]!;
      const side: DataLineageSide =
        pressed.side === DataLineageSide.Focus
          ? random(2) === 0
            ? DataLineageSide.Upstream
            : DataLineageSide.Downstream
          : pressed.side;
      const newNodes: Array<DataTableLineageNode> = [];
      const newEdges: Array<DataTableLineageEdge> = [];

      for (let index: number = 0; index < random(6); index++) {
        const name: string = `n${index}`;

        newNodes.push(
          side === DataLineageSide.Upstream
            ? up(name, pressed.depth - 1, { hiddenUpstreamCount: random(3) })
            : down(name, pressed.depth + 1, {
                hiddenDownstreamCount: random(3),
              }),
        );
        newEdges.push(
          side === DataLineageSide.Upstream
            ? feeds(name, pressed.dataAssetId!)
            : feeds(pressed.dataAssetId!, name),
        );
      }

      // Arrows to cards drawn before, a card drawn twice, an arrow to a card nowhere.
      const ends: Array<string> = [
        ...all,
        ...newNodes.map((node: DataTableLineageNode): string => {
          return node.dataAssetId!;
        }),
      ];

      for (let index: number = 0; index < random(6); index++) {
        const source: string = ends[random(ends.length)]!;
        const target: string = ends[random(ends.length)]!;

        if (source !== target) {
          newEdges.push(feeds(source, target));
        }
      }

      if (random(3) === 0) {
        newNodes.push({ ...nodes[random(nodes.length)]! });
      }

      newEdges.push(feeds("nowhere", "focus"));

      const expansion: DataLineageExpansion = expansionOf({
        nodeId: pressed.id,
        side,
        hiddenCount: random(15),
        nodes: newNodes,
        edges: newEdges,
        hiddenDashboardCount: random(2) === 0 ? null : random(5),
      });
      const merged: DataTableLineage = mergeLineageExpansion(
        lineage,
        expansion,
      );
      const drawn: Set<string> = new Set(idsOf(merged.nodes));

      expect(drawn.size).toBe(merged.nodes.length);
      expect(new Set(idsOf(merged.edges)).size).toBe(merged.edges.length);
      expect(idsOf(merged.nodes).slice(0, nodes.length)).toEqual(idsOf(nodes));

      for (const arrow of merged.edges) {
        expect({
          round,
          arrow: arrow.id,
          drawn: drawn.has(arrow.source) && drawn.has(arrow.target),
        }).toEqual({
          round,
          arrow: arrow.id,
          drawn: true,
        });
      }

      for (const node of merged.nodes) {
        expect(node.hiddenUpstreamCount || 0).toBeGreaterThanOrEqual(0);
        expect(node.hiddenDownstreamCount || 0).toBeGreaterThanOrEqual(0);
      }

      const pressedNow: DataTableLineageNode = nodeIn(merged, pressed.id);

      expect(
        side === DataLineageSide.Upstream
          ? pressedNow.hiddenUpstreamCount
          : pressedNow.hiddenDownstreamCount,
      ).toBe(expansion.hiddenCount);
      // The same answer again: nothing more to draw, nothing more to count.
      expect(mergeLineageExpansion(merged, expansion)).toEqual(merged);
    }
  });
});

describe("where the view goes once the drawing grows", () => {
  function layoutOf(
    positions: Record<string, LineagePoint>,
    size: { width: number; height: number } = { width: 3000, height: 1500 },
  ): LineageLayout {
    return {
      positions: new Map(Object.entries(positions)),
      columns: new Map(),
      width: size.width,
      height: size.height,
    };
  }

  // Where a card is on the screen, from where the drawing is looked at.
  function onScreen(
    point: LineagePoint,
    viewport: LineageViewport,
  ): LineagePoint {
    return {
      x: viewport.x + point.x * viewport.zoom,
      y: viewport.y + point.y * viewport.zoom,
    };
  }

  // The room the canvas holds at a zoom, in the drawing's units, kept clear of its edges.
  function roomOf(
    viewport: LineageViewport,
    width: number,
    height: number,
  ): { left: number; top: number; right: number; bottom: number } {
    const roomWidth: number =
      width / (viewport.zoom * (1 + LINEAGE_FIT_PADDING));
    const roomHeight: number =
      height / (viewport.zoom * (1 + LINEAGE_FIT_PADDING));
    const left: number =
      -viewport.x / viewport.zoom + (width / viewport.zoom - roomWidth) / 2;
    const top: number =
      -viewport.y / viewport.zoom + (height / viewport.zoom - roomHeight) / 2;

    return { left, top, right: left + roomWidth, bottom: top + roomHeight };
  }

  function isInRoom(
    point: LineagePoint,
    room: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    const margin: number = 0.001;

    return (
      point.x >= room.left - margin &&
      point.y >= room.top - margin &&
      point.x + LINEAGE_CARD_WIDTH <= room.right + margin &&
      point.y + LINEAGE_CARD_HEIGHT <= room.bottom + margin
    );
  }

  const BEFORE: LineageLayout = layoutOf({
    "table:a": { x: 400, y: 200 },
    [FOCUS]: { x: 712, y: 200 },
  });
  const VIEWPORT: LineageViewport = { x: -100, y: 50, zoom: 0.8 };

  test("no canvas size to go by: nothing to say", () => {
    expect(
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after: BEFORE,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: [],
        focusNodeId: FOCUS,
        width: 0,
        height: 400,
        hasReaderMoved: true,
      }),
    ).toBeNull();
  });

  test("the card pressed stays where it was on the screen, at the zoom the reader has, when what is new is in view", () => {
    const after: LineageLayout = layoutOf({
      "table:a": { x: 712, y: 300 },
      [FOCUS]: { x: 1024, y: 300 },
      // Under the card pressed: in view already.
      "table:n1": { x: 712, y: 400 },
    });
    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: ["table:n1"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      });

    expect(next?.isFitted).toBe(false);
    expect(next?.viewport.zoom).toBe(0.8);

    const was: LineagePoint = onScreen({ x: 400, y: 200 }, VIEWPORT);
    const now: LineagePoint = onScreen({ x: 712, y: 300 }, next!.viewport);

    expect(now.x).toBeCloseTo(was.x, 6);
    expect(now.y).toBeCloseTo(was.y, 6);
  });

  test("slides as little as brings a card drawn now into view, one edge only", () => {
    const after: LineageLayout = layoutOf({
      "table:a": { x: 712, y: 300 },
      [FOCUS]: { x: 1024, y: 300 },
      // Above the room the canvas has.
      "table:n1": { x: 712, y: -200 },
    });
    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: ["table:n1"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      });
    const kept: LineageViewport = {
      x: VIEWPORT.x + (400 - 712) * 0.8,
      y: VIEWPORT.y + (200 - 300) * 0.8,
      zoom: 0.8,
    };
    const room: ReturnType<typeof roomOf> = roomOf(next!.viewport, 1200, 600);

    // Sideways nothing moves; down only as far as the new card's top.
    expect(next!.viewport.x).toBeCloseTo(kept.x, 6);
    expect(next!.viewport.y).toBeGreaterThan(kept.y);
    expect(room.top).toBeCloseTo(-200, 6);
    expect(isInRoom({ x: 712, y: -200 }, room)).toBe(true);
    expect(isInRoom({ x: 712, y: 300 }, room)).toBe(true);
  });

  test("the nearest cards drawn now first, as many as fit beside the card pressed; the card pressed always in view", () => {
    const after: LineageLayout = layoutOf({
      "table:a": { x: 712, y: 300 },
      [FOCUS]: { x: 1024, y: 300 },
      "table:near": { x: 1700, y: 300 },
      "table:far": { x: 2600, y: 300 },
    });
    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: ["table:far", "table:near"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      });
    const room: ReturnType<typeof roomOf> = roomOf(next!.viewport, 1200, 600);

    expect(isInRoom({ x: 712, y: 300 }, room)).toBe(true);
    expect(isInRoom({ x: 1700, y: 300 }, room)).toBe(true);
    expect(isInRoom({ x: 2600, y: 300 }, room)).toBe(false);
    // Only as far as the near card's right edge.
    expect(room.right).toBeCloseTo(1700 + LINEAGE_CARD_WIDTH, 6);
  });

  test("a reader who has not moved the view sees the whole drawing again while it reads whole", () => {
    const after: LineageLayout = layoutOf(
      {
        "table:n1": { x: 0, y: 0 },
        "table:a": { x: 312, y: 0 },
        [FOCUS]: { x: 624, y: 0 },
      },
      { width: 840, height: 84 },
    );
    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: ["table:n1"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: false,
      });

    expect(next).toEqual({
      viewport: getLineageViewport({
        layout: after,
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
      }),
      isFitted: true,
    });
  });

  test("a reader who moved it keeps their zoom, though the drawing would read whole", () => {
    const after: LineageLayout = layoutOf(
      {
        "table:n1": { x: 0, y: 0 },
        "table:a": { x: 312, y: 0 },
        [FOCUS]: { x: 624, y: 0 },
      },
      { width: 840, height: 84 },
    );

    expect(
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: ["table:n1"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      })?.isFitted,
    ).toBe(false);
  });

  test("a drawing grown past reading whole keeps the card pressed in place, the reader moved or not", () => {
    const after: LineageLayout = layoutOf({
      "table:a": { x: 712, y: 300 },
      [FOCUS]: { x: 1024, y: 300 },
    });
    const next: { viewport: LineageViewport; isFitted: boolean } | null =
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after,
        viewport: VIEWPORT,
        nodeId: "table:a",
        newNodeIds: [],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: false,
      });

    expect(next?.isFitted).toBe(false);
    expect(onScreen({ x: 712, y: 300 }, next!.viewport).x).toBeCloseTo(
      onScreen({ x: 400, y: 200 }, VIEWPORT).x,
      6,
    );
  });

  test("a card pressed that is in neither layout leaves the view as it was", () => {
    expect(
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after: BEFORE,
        viewport: VIEWPORT,
        nodeId: "table:gone",
        newNodeIds: ["table:a"],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      }),
    ).toEqual({ viewport: VIEWPORT, isFitted: false });
  });

  test("a view with no zoom to go by is taken at life size", () => {
    expect(
      getLineageViewportAfterExpanding({
        before: BEFORE,
        after: BEFORE,
        viewport: { x: 10, y: 20, zoom: 0 },
        nodeId: "table:a",
        newNodeIds: [],
        focusNodeId: FOCUS,
        width: 1200,
        height: 600,
        hasReaderMoved: true,
      })?.viewport.zoom,
    ).toBe(1);
  });

  test("any drawing grown: the card pressed stays in view, at the reader's zoom", () => {
    const random: SeededRandom = seededRandom(1665);

    for (let round: number = 0; round < 150; round++) {
      const nodes: Array<DataTableLineageNode> = [focusNode()];
      const edges: Array<DataTableLineageEdge> = [];
      const names: Array<string> = ["focus"];

      for (let index: number = 0; index < 1 + random(10); index++) {
        const isUp: boolean = random(2) === 0;
        const name: string = `t${index}`;
        const next: string = names[random(names.length)]!;

        nodes.push(isUp ? up(name, -1) : down(name, 1));
        edges.push(isUp ? feeds(name, next) : feeds(next, name));
        names.push(name);
      }

      const lineage: DataTableLineage = lineageOf(nodes, edges);
      const pressed: DataTableLineageNode = nodes[random(nodes.length)]!;
      const isUpstream: boolean =
        pressed.side === DataLineageSide.Focus
          ? random(2) === 0
          : pressed.side === DataLineageSide.Upstream;
      const newNodes: Array<DataTableLineageNode> = [];
      const newEdges: Array<DataTableLineageEdge> = [];

      for (let index: number = 0; index < 1 + random(10); index++) {
        const name: string = `n${index}`;

        newNodes.push(
          isUpstream
            ? up(name, pressed.depth - 1)
            : down(name, pressed.depth + 1),
        );
        newEdges.push(
          isUpstream
            ? feeds(name, pressed.dataAssetId!)
            : feeds(pressed.dataAssetId!, name),
        );
      }

      const merged: DataTableLineage = mergeLineageExpansion(
        lineage,
        expansionOf({
          nodeId: pressed.id,
          side: isUpstream
            ? DataLineageSide.Upstream
            : DataLineageSide.Downstream,
          nodes: newNodes,
          edges: newEdges,
        }),
      );
      const before: LineageLayout = layoutLineage(lineage);
      const after: LineageLayout = layoutLineage(merged);
      const width: number = 600 + random(1200);
      const height: number = 300 + random(500);
      const zoom: number = 0.4 + random(100) / 100;
      const was: LineagePoint = before.positions.get(pressed.id)!;
      // The card pressed in the middle of the canvas.
      const viewport: LineageViewport = {
        x: width / 2 - (was.x + LINEAGE_CARD_WIDTH / 2) * zoom,
        y: height / 2 - (was.y + LINEAGE_CARD_HEIGHT / 2) * zoom,
        zoom,
      };
      const next: { viewport: LineageViewport; isFitted: boolean } | null =
        getLineageViewportAfterExpanding({
          before,
          after,
          viewport,
          nodeId: pressed.id,
          newNodeIds: idsOf(newNodes),
          focusNodeId: FOCUS,
          width,
          height,
          hasReaderMoved: true,
        });

      expect(next?.isFitted).toBe(false);
      expect(next?.viewport.zoom).toBe(zoom);

      const room: ReturnType<typeof roomOf> = roomOf(
        next!.viewport,
        width,
        height,
      );
      const card: LineagePoint = after.positions.get(pressed.id)!;
      const doesCardFit: boolean =
        LINEAGE_CARD_WIDTH <= room.right - room.left &&
        LINEAGE_CARD_HEIGHT <= room.bottom - room.top;

      if (doesCardFit) {
        expect({ round, inView: isInRoom(card, room) }).toEqual({
          round,
          inView: true,
        });
      }
    }
  });
});
