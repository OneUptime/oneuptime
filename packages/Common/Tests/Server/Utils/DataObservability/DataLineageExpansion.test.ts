import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DataLineageDrawnTable,
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "../../../../Types/DataObservability/DataLineageExpansion";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_NEIGHBORS,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  HOUR,
  MemoryGraph,
  NOW,
  columns,
  d,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  nodeOf,
  p,
  pipeline,
  runs,
  t,
  table,
  uuid,
  writes,
} from "./LineageMemoryGraph";

/*
 * DRAWING MORE OF A LINEAGE DIAGRAM WHERE IT IS (#6667): THE SERVER'S SIDE.
 *
 * DataTableLineageReader.buildExpansion answers a card's count pressed:
 * every table the request names is drawn already, so the walk takes one
 * step from the card alone - its nearest not drawn, problems first, at
 * most MAX_DATA_LINEAGE_NEIGHBORS and what its side has room for - and a
 * step past them, to count what lies beyond each. It draws every arrow
 * between them and what is drawn, both ways; the pipelines that load them
 * from outside; downstream, the dashboards built on them; and counts open
 * alerts only for them. A pipeline's own card chooses from the tables it
 * reads, or writes, as its drawing chose its first. These walk graphs held
 * in memory (LineageMemoryGraph); LineageExpandRoundTrip.test.ts (Common/
 * Tests/App/Dashboard) adds the answers to drawings as the Dashboard does,
 * and DataLineageRoutes.test.ts pins the route.
 */

const FOCUS: string = t(0);
const FOCUS_NODE: string = getLineageTableNodeId(FOCUS);

async function draw(
  graph: MemoryGraph,
  depth: number = 1,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null = await DataTableLineageReader.build({
    focusDataAssetId: FOCUS,
    depth,
    now: NOW,
    reader: memoryReader(graph),
  });

  expect(lineage).not.toBeNull();

  return lineage!;
}

async function drawPipeline(
  graph: MemoryGraph,
  pipelineId: string,
  depth: number = 1,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null =
    await DataTableLineageReader.buildForPipeline({
      focusDataPipelineId: pipelineId,
      depth,
      now: NOW,
      reader: memoryReader(graph),
    });

  expect(lineage).not.toBeNull();

  return lineage!;
}

// What pressing a count on this drawing asks, as the Dashboard asks it.
function requestFor(
  lineage: DataTableLineage,
  nodeId: string,
  side: DataLineageSide,
  withColumns: boolean = false,
): DataLineageExpandRequest {
  const tables: Array<DataLineageDrawnTable> = [];
  const dataDashboardIds: Array<string> = [];

  for (const node of lineage.nodes) {
    if (node.kind === DataLineageNodeKind.Table && node.dataAssetId) {
      tables.push({
        dataAssetId: node.dataAssetId,
        side: node.side,
        depth: node.depth,
      });
    }

    if (node.kind === DataLineageNodeKind.Dashboard && node.dataDashboardId) {
      dataDashboardIds.push(node.dataDashboardId);
    }
  }

  return {
    focusNodeId: lineage.focusNodeId,
    nodeId,
    side,
    tables,
    dataDashboardIds,
    withColumns,
  };
}

async function expand(
  graph: MemoryGraph,
  request: DataLineageExpandRequest,
): Promise<DataLineageExpansion> {
  const expansion: DataLineageExpansion | null =
    await DataTableLineageReader.buildExpansion({
      request,
      now: NOW,
      reader: memoryReader(graph),
    });

  expect(expansion).not.toBeNull();

  return expansion!;
}

// The tables an answer draws, by id: "id@depth".
function tablesDrawn(expansion: DataLineageExpansion): Array<string> {
  return expansion.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Table;
    })
    .map((node: DataTableLineageNode): string => {
      return `${node.dataAssetId}@${node.depth}`;
    })
    .sort();
}

function tableIdsOf(
  lineage: DataTableLineage | DataLineageExpansion,
): Array<string> {
  return lineage.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Table;
    })
    .map((node: DataTableLineageNode): string => {
      return node.dataAssetId!;
    })
    .sort();
}

function feedsIds(expansion: DataLineageExpansion): Array<string> {
  return expansion.edges
    .filter((edge: DataTableLineageEdge): boolean => {
      return edge.kind === DataLineageEdgeKind.Feeds;
    })
    .map((edge: DataTableLineageEdge): string => {
      return `${edge.source.slice("table:".length)}>${edge.target.slice("table:".length)}`;
    })
    .sort();
}

function feedsId(source: string, target: string): string {
  return getLineageEdgeId({
    kind: DataLineageEdgeKind.Feeds,
    source: getLineageTableNodeId(source),
    target: getLineageTableNodeId(target),
  });
}

function nodeIn(
  found: DataTableLineage | DataLineageExpansion,
  id: string,
): DataTableLineageNode {
  const node: DataTableLineageNode | undefined = found.nodes.find(
    (candidate: DataTableLineageNode): boolean => {
      return candidate.id === id;
    },
  );

  expect(node).toBeDefined();

  return node!;
}

function ago(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

describe("a table's card, its way pressed", () => {
  /*
   * Twenty-five tables feed the table: twelve late. A drawing draws ten of
   * them, late first, and counts fifteen.
   */
  function crowded(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);

    for (let index: number = 1; index <= 25; index++) {
      if (index <= 12) {
        lateTable(graph, t(index));
      } else {
        table(graph, t(index));
      }

      feeds(graph, t(index), FOCUS, { lastSeenAt: ago(index) });
    }

    return graph;
  }

  test("the table itself draws the next ten it is built from, problems first, and counts the rest", async () => {
    const graph: MemoryGraph = crowded();
    const lineage: DataTableLineage = await draw(graph);

    expect(nodeIn(lineage, FOCUS_NODE).hiddenUpstreamCount).toBe(15);
    // The first ten drawn are the late ones seen last.
    expect(tableIdsOf(lineage)).toEqual(
      [FOCUS, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t)].sort(),
    );

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, FOCUS_NODE, DataLineageSide.Upstream),
    );

    // The two late ones left first, then the ones seen last.
    expect(tablesDrawn(expansion)).toEqual(
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
        .map((index: number): string => {
          return `${t(index)}@-1`;
        })
        .sort(),
    );
    expect(expansion.nodeId).toBe(FOCUS_NODE);
    expect(expansion.side).toBe(DataLineageSide.Upstream);
    expect(expansion.hiddenCount).toBe(5);
    expect(expansion.isTruncated).toBe(false);
    // Each joined to the table it feeds.
    for (let index: number = 11; index <= 20; index++) {
      expect(feedsIds(expansion)).toContain(`${t(index)}>${FOCUS}`);
    }

    // The table's own arrows that way come with them, to the tables drawn before too: the drawing keeps one of each.
    expect(
      feedsIds(expansion).every((id: string): boolean => {
        return id.endsWith(`>${FOCUS}`);
      }),
    ).toBe(true);

    for (const node of expansion.nodes) {
      expect(node.side).toBe(DataLineageSide.Upstream);
      expect(node.hiddenDownstreamCount).toBe(0);
    }
  });

  test("pressed again with what it drew, it draws the last of them, and counts none", async () => {
    const graph: MemoryGraph = crowded();
    const lineage: DataTableLineage = await draw(graph);
    const first: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, FOCUS_NODE, DataLineageSide.Upstream),
    );
    const grown: DataTableLineage = {
      ...lineage,
      nodes: [...lineage.nodes, ...first.nodes],
    };
    const second: DataLineageExpansion = await expand(
      graph,
      requestFor(grown, FOCUS_NODE, DataLineageSide.Upstream),
    );

    expect(tableIdsOf(second)).toEqual([21, 22, 23, 24, 25].map(t).sort());
    expect(second.hiddenCount).toBe(0);
  });

  test("a table upstream draws one step past it, each table drawn counting what lies beyond it", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, t(1), FOCUS);

    for (let index: number = 10; index < 23; index++) {
      table(graph, t(index));
      feeds(graph, t(index), t(1), { lastSeenAt: ago(index) });
    }

    // Beyond the first of them: two more.
    table(graph, t(30));
    table(graph, t(31));
    feeds(graph, t(30), t(10));
    feeds(graph, t(31), t(10));

    const lineage: DataTableLineage = await draw(graph);

    expect(
      nodeIn(lineage, getLineageTableNodeId(t(1))).hiddenUpstreamCount,
    ).toBe(13);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tablesDrawn(expansion)).toEqual(
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
        .map((index: number): string => {
          return `${t(index)}@-2`;
        })
        .sort(),
    );
    expect(expansion.hiddenCount).toBe(3);
    expect(
      nodeIn(expansion, getLineageTableNodeId(t(10))).hiddenUpstreamCount,
    ).toBe(2);
    expect(
      nodeIn(expansion, getLineageTableNodeId(t(11))).hiddenUpstreamCount,
    ).toBe(0);
    // What lies beyond is counted, never drawn.
    expect(tableIdsOf(expansion)).not.toContain(t(30));
  });

  test("a table downstream draws what is built from it, a step further out", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, FOCUS, t(1));

    for (let index: number = 2; index <= 4; index++) {
      table(graph, t(index));
      feeds(graph, t(1), t(index));
    }

    table(graph, t(9));
    feeds(graph, t(4), t(9));

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Downstream,
      ),
    );

    expect(tablesDrawn(expansion)).toEqual(
      [`${t(2)}@2`, `${t(3)}@2`, `${t(4)}@2`].sort(),
    );
    expect(expansion.hiddenCount).toBe(0);
    expect(
      nodeIn(expansion, getLineageTableNodeId(t(4))).hiddenDownstreamCount,
    ).toBe(1);
    expect(
      nodeIn(expansion, getLineageTableNodeId(t(4))).hiddenUpstreamCount,
    ).toBe(0);
    expect(feedsIds(expansion)).toEqual(
      [`${t(1)}>${t(2)}`, `${t(1)}>${t(3)}`, `${t(1)}>${t(4)}`].sort(),
    );
  });

  test("never draws a table drawn already, whatever side the drawing has it on; joins it instead", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(1), FOCUS);
    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));

    const lineage: DataTableLineage = await draw(graph);
    const request: DataLineageExpandRequest = requestFor(
      lineage,
      getLineageTableNodeId(t(1)),
      DataLineageSide.Upstream,
    );

    // The drawing has t(2) downstream, as a cycle would put it.
    request.tables.push({
      dataAssetId: t(2),
      side: DataLineageSide.Downstream,
      depth: 1,
    });

    const expansion: DataLineageExpansion = await expand(graph, request);

    expect(tableIdsOf(expansion)).toEqual([t(3)]);
    expect(expansion.hiddenCount).toBe(0);
    // Its own arrow to the table drawn elsewhere is drawn.
    expect(feedsIds(expansion)).toEqual(
      [`${t(2)}>${t(1)}`, `${t(3)}>${t(1)}`].sort(),
    );
  });

  test("the card's own arrows to tables drawn elsewhere are drawn, and those tables never counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, t(1), FOCUS);

    for (let index: number = 20; index < 32; index++) {
      table(graph, t(index));
      feeds(graph, t(index), t(1), { lastSeenAt: ago(index) });
    }

    // The first of them also feeds the table itself: drawn beside it.
    feeds(graph, t(20), FOCUS);

    const lineage: DataTableLineage = await draw(graph);

    expect(tableIdsOf(lineage)).toEqual([FOCUS, t(1), t(20)].sort());
    expect(
      nodeIn(lineage, getLineageTableNodeId(t(1))).hiddenUpstreamCount,
    ).toBe(11);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tableIdsOf(expansion)).not.toContain(t(20));
    expect(tableIdsOf(expansion)).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(expansion.hiddenCount).toBe(1);
    expect(feedsIds(expansion)).toContain(`${t(20)}>${t(1)}`);
  });

  test("a table drawn now that also feeds a table drawn already is joined to it: that table counts it no more", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, t(1), FOCUS);

    // Ten more feed the table, fresher than the one t(40) feeds it by.
    for (let index: number = 2; index <= 10; index++) {
      table(graph, t(index));
      feeds(graph, t(index), FOCUS);
    }

    table(graph, t(40));
    feeds(graph, t(40), t(1));
    feeds(graph, t(40), FOCUS, { lastSeenAt: ago(48) });

    const lineage: DataTableLineage = await draw(graph);

    expect(tableIdsOf(lineage)).not.toContain(t(40));
    expect(nodeIn(lineage, FOCUS_NODE).hiddenUpstreamCount).toBe(1);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tableIdsOf(expansion)).toEqual([t(40)]);
    expect(feedsIds(expansion)).toEqual(
      [`${t(40)}>${t(1)}`, `${t(40)}>${FOCUS}`].sort(),
    );
  });

  test("a table drawn now downstream, also built from a table drawn upstream: that arrow is left out, as a drawing read whole leaves it out", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(1), FOCUS);
    feeds(graph, FOCUS, t(2));
    feeds(graph, t(2), t(3));
    // The table upstream also feeds the one drawn now.
    feeds(graph, t(1), t(3));

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(2)),
        DataLineageSide.Downstream,
      ),
    );

    expect(tableIdsOf(expansion)).toEqual([t(3)]);
    // The table between them shows the way; drawn whole, two steps each way, it is the same.
    expect(feedsIds(expansion)).toEqual([`${t(2)}>${t(3)}`]);

    const whole: DataTableLineage = await draw(graph, 2);

    expect(tableIdsOf(whole)).toEqual(tableIdsOf(lineage).concat(t(3)).sort());
    expect(
      whole.edges.some((edge: DataTableLineageEdge): boolean => {
        return edge.id === feedsId(t(1), t(3));
      }),
    ).toBe(false);
  });

  test("a table drawn now upstream that also feeds a table drawn downstream: that arrow is left out too", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(2), t(1));
    feeds(graph, t(1), FOCUS);
    feeds(graph, FOCUS, t(3));
    // The table drawn now also feeds the table downstream.
    feeds(graph, t(2), t(3));

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tableIdsOf(expansion)).toEqual([t(2)]);
    expect(feedsIds(expansion)).toEqual([`${t(2)}>${t(1)}`]);
  });

  test("round a circle, a table drawn now is joined to a table on the other side whose own way it is", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(1), FOCUS);
    feeds(graph, FOCUS, t(2));
    // Pressed upstream, t(1) draws t(3), which is built from the table downstream.
    feeds(graph, t(3), t(1));
    feeds(graph, t(2), t(3));

    const lineage: DataTableLineage = await draw(graph);

    expect(tableIdsOf(lineage)).toEqual([FOCUS, t(1), t(2)].sort());

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tablesDrawn(expansion)).toEqual([`${t(3)}@-2`]);
    // The arrow into it is its own way: a drawing read whole draws it too.
    expect(feedsIds(expansion)).toEqual(
      [`${t(2)}>${t(3)}`, `${t(3)}>${t(1)}`].sort(),
    );
    expect(
      nodeIn(expansion, getLineageTableNodeId(t(3))).hiddenUpstreamCount,
    ).toBe(0);
  });

  test("a table that is gone - an arrow to it left behind - is neither drawn nor counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, t(1), FOCUS);
    // t(2) is no longer one of the project's tables.
    feeds(graph, t(2), t(1));
    table(graph, t(3));
    feeds(graph, t(3), t(1));

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tableIdsOf(expansion)).toEqual([t(3)]);
    expect(expansion.hiddenCount).toBe(0);
  });

  test("a side never holds more tables than it may: the rest are counted, and the drawing says it could not hold it all", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);

    for (let index: number = 1; index <= 20; index++) {
      table(graph, t(index));
      feeds(graph, t(index), FOCUS);
    }

    const tables: Array<DataLineageDrawnTable> = [
      { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
    ];

    // Five short of the most, upstream.
    for (
      let index: number = 0;
      index < MAX_DATA_LINEAGE_TABLES_PER_SIDE - 5;
      index++
    ) {
      tables.push({
        dataAssetId: uuid(9, index),
        side: DataLineageSide.Upstream,
        depth: -2,
      });
    }

    const expansion: DataLineageExpansion = await expand(graph, {
      focusNodeId: FOCUS_NODE,
      nodeId: FOCUS_NODE,
      side: DataLineageSide.Upstream,
      tables,
      dataDashboardIds: [],
    });

    expect(tableIdsOf(expansion)).toHaveLength(5);
    expect(expansion.hiddenCount).toBe(15);
    expect(expansion.isTruncated).toBe(true);
  });

  test("a card whose table is not one of the project's is not found, and nothing past it read", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    feeds(graph, t(1), FOCUS);
    table(graph, t(2));
    feeds(graph, t(2), t(1));

    expect(
      await DataTableLineageReader.buildExpansion({
        request: {
          focusNodeId: FOCUS_NODE,
          nodeId: getLineageTableNodeId(t(1)),
          side: DataLineageSide.Upstream,
          tables: [
            { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
            { dataAssetId: t(1), side: DataLineageSide.Upstream, depth: -1 },
          ],
          dataDashboardIds: [],
        },
        now: NOW,
        reader: memoryReader(graph),
      }),
    ).toBeNull();
    expect(graph.edgeReads).toEqual([]);
    expect(graph.alertReads).toEqual([]);
  });

  test("a card not on the drawing, or named by no id it knows, is not found", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));

    for (const nodeId of [
      getLineageTableNodeId(t(1)),
      "table:orders",
      "pipeline:",
    ]) {
      expect(
        await DataTableLineageReader.buildExpansion({
          request: {
            focusNodeId: FOCUS_NODE,
            nodeId,
            side: DataLineageSide.Upstream,
            tables: [
              { dataAssetId: FOCUS, side: DataLineageSide.Focus, depth: 0 },
            ],
            dataDashboardIds: [],
          },
          now: NOW,
          reader: memoryReader(graph),
        }),
      ).toBeNull();
    }
  });
});

describe("what the tables drawn now come with", () => {
  test("their open alerts, read for them alone", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(1), FOCUS);
    feeds(graph, t(2), t(1));
    graph.openAlerts.set(t(1), 4);
    graph.openAlerts.set(t(2), 2);

    const lineage: DataTableLineage = await draw(graph);
    const reads: number = graph.alertReads.length;
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(graph.alertReads.slice(reads)).toEqual([[t(2)]]);
    expect(nodeIn(expansion, getLineageTableNodeId(t(2))).openAlertCount).toBe(
      2,
    );
  });

  test("nothing drawn: no alert read at all", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, t(1), FOCUS);

    const lineage: DataTableLineage = await draw(graph);
    const reads: number = graph.alertReads.length;
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, FOCUS_NODE, DataLineageSide.Upstream),
    );

    expect(expansion.nodes).toEqual([]);
    expect(graph.alertReads.length).toBe(reads);
  });

  test("the pipelines on their arrows, by name and how their latest run went", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(1), FOCUS);
    pipeline(graph, p(1), { jobName: "orders_etl", lastRunState: "FAIL" });
    feeds(graph, t(2), t(1), { dataPipelineId: p(1) });

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );
    const arrow: DataTableLineageEdge | undefined = expansion.edges.find(
      (edge: DataTableLineageEdge): boolean => {
        return edge.id === feedsId(t(2), t(1));
      },
    );

    expect(arrow?.pipelines).toEqual([
      { dataPipelineId: p(1), name: "orders_etl", lastRunState: "FAIL" },
    ]);
  });

  test("the pipeline that loads one from outside, a step before it; never one that loads a table drawn before", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(1), FOCUS);
    feeds(graph, t(2), t(1));
    pipeline(graph, p(1), { jobName: "shopify_sync" });
    pipeline(graph, p(2), { jobName: "orders_sync" });
    writes(graph, p(1), t(2));
    // Loads t(1), drawn before: its card is on the drawing already.
    writes(graph, p(2), t(1));

    const lineage: DataTableLineage = await draw(graph);

    expect(nodeOf(lineage, getLineagePipelineNodeId(p(2)))).toBeDefined();

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );
    const sync: DataTableLineageNode = nodeIn(
      expansion,
      getLineagePipelineNodeId(p(1)),
    );

    expect(sync.depth).toBeLessThan(
      nodeIn(expansion, getLineageTableNodeId(t(2))).depth,
    );
    expect(
      expansion.edges.some((edge: DataTableLineageEdge): boolean => {
        return (
          edge.kind === DataLineageEdgeKind.Writes &&
          edge.source === getLineagePipelineNodeId(p(1)) &&
          edge.target === getLineageTableNodeId(t(2))
        );
      }),
    ).toBe(true);
    expect(
      expansion.nodes.some((node: DataTableLineageNode): boolean => {
        return node.id === getLineagePipelineNodeId(p(2));
      }),
    ).toBe(false);
  });
});

describe("the dashboards built on the tables drawn now", () => {
  /*
   * The table feeds t(1), which feeds t(2)..t(4). Dashboard 1 reads t(2);
   * dashboard 2 reads t(1) and t(3); dashboard 3 reads the table.
   */
  function withDashboards(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    feeds(graph, FOCUS, t(1));

    for (let index: number = 2; index <= 4; index++) {
      table(graph, t(index));
      feeds(graph, t(1), t(index));
    }

    graph.dashboards.push(
      {
        dataDashboardId: d(1),
        name: "Orders",
        tool: "Metabase",
        url: null,
        dataAssetIds: [t(2)],
      },
      {
        dataDashboardId: d(2),
        name: "Revenue",
        tool: "Looker",
        url: null,
        dataAssetIds: [t(1), t(3)],
      },
      {
        dataDashboardId: d(3),
        name: "Overview",
        tool: "Metabase",
        url: null,
        dataAssetIds: [FOCUS],
      },
    );

    return graph;
  }

  test("a new one is drawn after the last table it reads, with an arrow from every drawn table it reads", async () => {
    const graph: MemoryGraph = withDashboards();
    const lineage: DataTableLineage = await draw(graph);

    expect(nodeOf(lineage, getLineageDashboardNodeId(d(2)))).toBeDefined();
    expect(nodeOf(lineage, getLineageDashboardNodeId(d(1)))).toBeUndefined();

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Downstream,
      ),
    );
    const orders: DataTableLineageNode = nodeIn(
      expansion,
      getLineageDashboardNodeId(d(1)),
    );

    expect(orders.depth).toBe(3);
    expect(orders.side).toBe(DataLineageSide.Downstream);
    // Revenue is drawn already: only its arrow from the table drawn now.
    expect(
      expansion.nodes.filter((node: DataTableLineageNode): boolean => {
        return node.kind === DataLineageNodeKind.Dashboard;
      }),
    ).toHaveLength(1);

    const reads: Array<string> = expansion.edges
      .filter((edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Reads;
      })
      .map((edge: DataTableLineageEdge): string => {
        return `${edge.source}>${edge.target}`;
      })
      .sort();

    expect(reads).toEqual(
      [
        `${getLineageTableNodeId(t(2))}>${getLineageDashboardNodeId(d(1))}`,
        `${getLineageTableNodeId(t(3))}>${getLineageDashboardNodeId(d(2))}`,
      ].sort(),
    );
    // Every dashboard on a drawn table is drawn.
    expect(expansion.hiddenDashboardCount).toBe(0);
  });

  test("asks for the dashboards on the tables drawn now, saying which tables are drawn already", async () => {
    const graph: MemoryGraph = withDashboards();
    const lineage: DataTableLineage = await draw(graph);
    const reads: number = graph.dashboardReads.length;

    await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Downstream,
      ),
    );

    const asked: MemoryGraph["dashboardReads"] =
      graph.dashboardReads.slice(reads);

    expect(asked[0]).toEqual({
      dataAssetIds: [t(2), t(3), t(4)].sort(),
      limit: MAX_DATA_LINEAGE_DASHBOARDS + 2,
      drawnDataAssetIds: [FOCUS, t(1)],
    });
    // Then how many there are on every drawn table, all told.
    expect(asked[1]?.limit).toBe(1);
    expect([...asked[1]!.dataAssetIds].sort()).toEqual(
      [FOCUS, t(1), t(2), t(3), t(4)].sort(),
    );
  });

  test("past the most a drawing holds, they are counted, not drawn", async () => {
    const graph: MemoryGraph = withDashboards();
    graph.dashboards.length = 0;

    for (let index: number = 0; index < MAX_DATA_LINEAGE_DASHBOARDS; index++) {
      graph.dashboards.push({
        dataDashboardId: uuid(5, index),
        name: `Board ${index}`,
        tool: "Metabase",
        url: null,
        dataAssetIds: [FOCUS],
      });
    }

    graph.dashboards.push(
      {
        dataDashboardId: d(1),
        name: "Orders",
        tool: "Metabase",
        url: null,
        dataAssetIds: [t(2)],
      },
      {
        dataDashboardId: d(2),
        name: "Revenue",
        tool: "Looker",
        url: null,
        dataAssetIds: [t(3)],
      },
    );

    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Downstream,
      ),
    );

    expect(
      expansion.nodes.filter((node: DataTableLineageNode): boolean => {
        return node.kind === DataLineageNodeKind.Dashboard;
      }),
    ).toEqual([]);
    expect(expansion.hiddenDashboardCount).toBe(2);
  });

  test("tables drawn upstream: no dashboard is read, and the count is left as it was", async () => {
    const graph: MemoryGraph = withDashboards();
    table(graph, t(8));
    feeds(graph, t(8), FOCUS);
    graph.dashboards.push({
      dataDashboardId: d(8),
      name: "Upstream board",
      tool: "Metabase",
      url: null,
      dataAssetIds: [t(8)],
    });

    const lineage: DataTableLineage = await draw(graph, 1);
    const request: DataLineageExpandRequest = requestFor(
      lineage,
      FOCUS_NODE,
      DataLineageSide.Upstream,
    );

    request.tables = request.tables.filter(
      (drawn: DataLineageDrawnTable): boolean => {
        return drawn.dataAssetId !== t(8);
      },
    );

    const reads: number = graph.dashboardReads.length;
    const expansion: DataLineageExpansion = await expand(graph, request);

    expect(tableIdsOf(expansion)).toEqual([t(8)]);
    expect(expansion.hiddenDashboardCount).toBeNull();
    expect(graph.dashboardReads.length).toBe(reads);
  });
});

describe("a pipeline's own card", () => {
  /*
   * orders_etl reads fourteen tables - three late - and writes twelve; one
   * table it reads is built from another it reads.
   */
  function etl(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, p(1), { jobName: "orders_etl" });

    const reads: Array<string> = [];
    const written: Array<string> = [];

    for (let index: number = 1; index <= 14; index++) {
      if (index >= 12) {
        lateTable(graph, t(index));
      } else {
        table(graph, t(index));
      }

      reads.push(t(index));
    }

    for (let index: number = 50; index < 62; index++) {
      table(graph, t(index));
      written.push(t(index));
    }

    runs(graph, p(1), { reads, writes: written });

    return graph;
  }

  test("draws the rest of the tables it reads, each joined to it, and counts none left", async () => {
    const graph: MemoryGraph = etl();
    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(nodeIn(lineage, ETL_NODE).hiddenUpstreamCount).toBe(4);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, ETL_NODE, DataLineageSide.Upstream),
    );
    const drawnBefore: Set<string> = new Set(tableIdsOf(lineage));

    expect(tableIdsOf(expansion)).toHaveLength(4);
    expect(
      tableIdsOf(expansion).every((id: string): boolean => {
        return !drawnBefore.has(id);
      }),
    ).toBe(true);
    expect(expansion.hiddenCount).toBe(0);

    for (const node of expansion.nodes) {
      expect(node.depth).toBe(-1);
      expect(
        expansion.edges.some((edge: DataTableLineageEdge): boolean => {
          return (
            edge.kind === DataLineageEdgeKind.Reads &&
            edge.source === node.id &&
            edge.target === ETL_NODE
          );
        }),
      ).toBe(true);
    }
  });

  test("draws the next of the tables it writes, its run told on each arrow", async () => {
    const graph: MemoryGraph = etl();
    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(nodeIn(lineage, ETL_NODE).hiddenDownstreamCount).toBe(2);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, ETL_NODE, DataLineageSide.Downstream),
    );

    expect(tableIdsOf(expansion)).toHaveLength(2);
    expect(expansion.hiddenCount).toBe(0);

    const written: Array<DataTableLineageEdge> = expansion.edges.filter(
      (edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Writes;
      },
    );

    expect(written).toHaveLength(2);
    expect(written[0]!.pipelines).toEqual([
      { dataPipelineId: p(1), name: "orders_etl", lastRunState: "COMPLETE" },
    ]);
  });

  test("a table it reads drawn already, reached through another, is joined to it and not counted", async () => {
    const graph: MemoryGraph = etl();
    // The last fresh table it reads feeds the first: drawn a step further out, through it.
    feeds(graph, t(11), t(1));

    const lineage: DataTableLineage = await drawPipeline(graph, p(1), 2);
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(nodeIn(lineage, getLineageTableNodeId(t(11))).depth).toBe(-2);
    // The drawing joined it already, and its card counts only the three it can draw.
    expect(nodeIn(lineage, ETL_NODE).hiddenUpstreamCount).toBe(3);
    expect(
      lineage.edges.some((edge: DataTableLineageEdge): boolean => {
        return (
          edge.kind === DataLineageEdgeKind.Reads &&
          edge.source === getLineageTableNodeId(t(11)) &&
          edge.target === ETL_NODE
        );
      }),
    ).toBe(true);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(lineage, ETL_NODE, DataLineageSide.Upstream),
    );
    const reads: Array<string> = expansion.edges
      .filter((edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Reads;
      })
      .map((edge: DataTableLineageEdge): string => {
        return edge.source.slice("table:".length);
      })
      .sort();

    expect(tableIdsOf(expansion)).toEqual([t(8), t(9), t(10)].sort());
    expect(expansion.hiddenCount).toBe(0);
    // Joined to the tables drawn now: the drawing joined the one further out already.
    expect(reads).toEqual([t(8), t(9), t(10)].sort());
  });

  test("a table's card on a pipeline's drawing: a table drawn now that the pipeline reads, round a circle downstream, is joined to it", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, p(1), { jobName: "orders_etl" });

    for (let index: number = 1; index <= 11; index++) {
      table(graph, t(index));
      runs(graph, p(1), {
        reads: [t(index)],
        writes: [t(50)],
        lastSeenAt: ago(index),
      });
    }

    table(graph, t(50));
    table(graph, t(51));
    feeds(graph, t(50), t(51));
    // The oldest it reads, the one its card could not hold, is built from what it writes.
    feeds(graph, t(51), t(11));

    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(nodeIn(lineage, ETL_NODE).hiddenUpstreamCount).toBe(1);

    // t(50), written, draws t(51); t(51) then draws t(11), downstream.
    const first: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(50)),
        DataLineageSide.Downstream,
      ),
    );

    expect(tablesDrawn(first)).toEqual([`${t(51)}@2`]);

    const grown: DataTableLineage = {
      ...lineage,
      nodes: [...lineage.nodes, ...first.nodes],
      edges: [...lineage.edges, ...first.edges],
    };
    const second: DataLineageExpansion = await expand(
      graph,
      requestFor(
        grown,
        getLineageTableNodeId(t(51)),
        DataLineageSide.Downstream,
      ),
    );

    expect(tablesDrawn(second)).toEqual([`${t(11)}@3`]);
    // Read by the pipeline: joined to it across the circle, so its card counts it no more.
    expect(
      second.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return edge.kind === DataLineageEdgeKind.Reads;
        })
        .map((edge: DataTableLineageEdge): string => {
          return `${edge.source}>${edge.target}`;
        }),
    ).toEqual([`${getLineageTableNodeId(t(11))}>${ETL_NODE}`]);
  });

  test("a table's card on a pipeline's drawing: a table drawn now that the pipeline reads is joined to it", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, p(1), { jobName: "orders_etl" });

    for (let index: number = 1; index <= 11; index++) {
      table(graph, t(index));
    }

    table(graph, t(50));
    runs(graph, p(1), {
      reads: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(t),
      writes: [t(50)],
    });
    // t(11), the one read not drawn, also feeds t(1).
    feeds(graph, t(11), t(1));

    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(tableIdsOf(lineage)).not.toContain(t(11));
    expect(nodeIn(lineage, ETL_NODE).hiddenUpstreamCount).toBe(1);
    expect(
      nodeIn(lineage, getLineageTableNodeId(t(1))).hiddenUpstreamCount,
    ).toBe(1);

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(tablesDrawn(expansion)).toEqual([`${t(11)}@-2`]);
    expect(
      expansion.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return edge.kind === DataLineageEdgeKind.Reads;
        })
        .map((edge: DataTableLineageEdge): string => {
          return `${edge.source}>${edge.target}`;
        }),
    ).toEqual([`${getLineageTableNodeId(t(11))}>${ETL_NODE}`]);
  });

  test("a table's card on a pipeline's drawing: a table drawn now that the pipeline writes is joined to it, its run told", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, p(1), { jobName: "orders_etl", lastRunState: "FAIL" });
    table(graph, t(1));

    for (let index: number = 50; index <= 60; index++) {
      table(graph, t(index));
    }

    runs(graph, p(1), {
      reads: [t(1)],
      writes: [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].map(t),
    });
    // t(60), written and not drawn, is also built from t(50).
    feeds(graph, t(50), t(60));

    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));

    expect(tableIdsOf(lineage)).not.toContain(t(60));

    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(50)),
        DataLineageSide.Downstream,
      ),
    );
    const written: Array<DataTableLineageEdge> = expansion.edges.filter(
      (edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Writes;
      },
    );

    expect(tablesDrawn(expansion)).toEqual([`${t(60)}@2`]);
    expect(
      written.map((edge: DataTableLineageEdge): string => {
        return `${edge.source}>${edge.target}`;
      }),
    ).toEqual([`${ETL_NODE}>${getLineageTableNodeId(t(60))}`]);
    expect(written[0]!.pipelines).toEqual([
      { dataPipelineId: p(1), name: "orders_etl", lastRunState: "FAIL" },
    ]);
  });

  test("a side that holds nearly its most draws only what fits", async () => {
    const graph: MemoryGraph = etl();
    const lineage: DataTableLineage = await drawPipeline(graph, p(1));
    const ETL_NODE: string = getLineagePipelineNodeId(p(1));
    const request: DataLineageExpandRequest = requestFor(
      lineage,
      ETL_NODE,
      DataLineageSide.Upstream,
    );
    const upstream: number = request.tables.filter(
      (drawn: DataLineageDrawnTable): boolean => {
        return drawn.side === DataLineageSide.Upstream;
      },
    ).length;

    for (
      let index: number = 0;
      index < MAX_DATA_LINEAGE_TABLES_PER_SIDE - upstream - 1;
      index++
    ) {
      request.tables.push({
        dataAssetId: uuid(9, index),
        side: DataLineageSide.Upstream,
        depth: -3,
      });
    }

    const expansion: DataLineageExpansion = await expand(graph, request);

    expect(tableIdsOf(expansion)).toHaveLength(1);
    expect(expansion.hiddenCount).toBe(3);
    expect(expansion.isTruncated).toBe(true);
  });

  test("a pipeline that is not one of the project's is not found", async () => {
    const graph: MemoryGraph = etl();

    expect(
      await DataTableLineageReader.buildExpansion({
        request: {
          focusNodeId: getLineagePipelineNodeId(p(9)),
          nodeId: getLineagePipelineNodeId(p(9)),
          side: DataLineageSide.Upstream,
          tables: [],
          dataDashboardIds: [],
        },
        now: NOW,
        reader: memoryReader(graph),
      }),
    ).toBeNull();
    expect(graph.pipelineEdgeReads).toEqual([]);
  });
});

describe("the columns of the arrows drawn now", () => {
  function withColumns(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(1), FOCUS);
    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    columns(graph, t(2), t(1), [
      ["id", "order_id"],
      ["amount_cents", "amount"],
    ]);
    // Another source names one more of the same arrow's.
    columns(graph, t(2), t(1), [["tax_cents", "amount"]]);
    columns(graph, t(1), FOCUS, [["order_id", "order_id"]]);

    return graph;
  }

  test("asked for, each arrow between two tables carries every source's columns together", async () => {
    const graph: MemoryGraph = withColumns();
    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
        true,
      ),
    );
    const arrow: DataTableLineageEdge | undefined = expansion.edges.find(
      (edge: DataTableLineageEdge): boolean => {
        return edge.id === feedsId(t(2), t(1));
      },
    );
    const silent: DataTableLineageEdge | undefined = expansion.edges.find(
      (edge: DataTableLineageEdge): boolean => {
        return edge.id === feedsId(t(3), t(1));
      },
    );

    // Each pair once, in one order.
    expect(arrow?.columnMappings).toEqual([
      { upstreamColumn: "amount_cents", downstreamColumn: "amount" },
      { upstreamColumn: "id", downstreamColumn: "order_id" },
      { upstreamColumn: "tax_cents", downstreamColumn: "amount" },
    ]);
    // No source named its columns: it says nothing of them.
    expect(silent).toBeDefined();
    expect(silent?.columnMappings).toBeUndefined();
    // Only the arrows drawn now are asked about.
    expect(graph.columnReads).toEqual([
      [
        { upstreamDataAssetId: t(2), downstreamDataAssetId: t(1) },
        { upstreamDataAssetId: t(3), downstreamDataAssetId: t(1) },
      ].sort(
        (
          a: { upstreamDataAssetId: string },
          b: { upstreamDataAssetId: string },
        ): number => {
          return a.upstreamDataAssetId < b.upstreamDataAssetId ? -1 : 1;
        },
      ),
    ]);
  });

  test("not asked for, no column is read and no arrow carries any", async () => {
    const graph: MemoryGraph = withColumns();
    const lineage: DataTableLineage = await draw(graph);
    const expansion: DataLineageExpansion = await expand(
      graph,
      requestFor(
        lineage,
        getLineageTableNodeId(t(1)),
        DataLineageSide.Upstream,
      ),
    );

    expect(graph.columnReads).toEqual([]);

    for (const edge of expansion.edges) {
      expect(edge.columnMappings).toBeUndefined();
    }
  });
});
