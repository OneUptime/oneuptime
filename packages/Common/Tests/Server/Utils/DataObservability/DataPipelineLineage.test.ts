import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader, {
  DataLineageDirection,
  DataLineagePins,
  DataPipelineTables,
  MAX_DATA_LINEAGE_EDGE_ROWS,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_DEPTH,
  MAX_DATA_LINEAGE_ERROR_LENGTH,
  MAX_DATA_LINEAGE_NEIGHBORS,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  HOUR,
  MemoryGraph,
  NOW,
  d,
  edgeBetween,
  edgeKinds,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  nodeOf,
  p,
  pipeline,
  placesOf,
  runs,
  t,
  table,
  writes,
} from "./LineageMemoryGraph";

/*
 * A pipeline's lineage graph (DataTableLineageReader.buildForPipeline): the
 * pipeline in the middle, the tables it reads on the left and the tables
 * it writes on the right - its nearest each way, problems first, the rest
 * counted on its card - each with how it is now; then, when asked for more
 * steps, the walk a table's drawing makes, from those tables outwards.
 * These walk graphs held in memory; DataLineageRoutes.test.ts pins the
 * route and DataAlertLineageDatabase.test.ts the pipeline's own read.
 */

const FOCUS: string = p(0);
const FOCUS_NODE: string = getLineagePipelineNodeId(FOCUS);

async function build(
  graph: MemoryGraph,
  depth: number = 1,
  pins?: DataLineagePins,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null =
    await DataTableLineageReader.buildForPipeline({
      focusDataPipelineId: FOCUS,
      depth,
      now: NOW,
      reader: memoryReader(graph),
      ...(pins ? { pins } : {}),
    });

  expect(lineage).not.toBeNull();

  return lineage!;
}

function focusOf(lineage: DataTableLineage): DataTableLineageNode {
  const node: DataTableLineageNode | undefined = nodeOf(lineage, FOCUS_NODE);

  expect(node).toBeDefined();

  return node!;
}

function tableNode(
  lineage: DataTableLineage,
  id: string,
): DataTableLineageNode {
  const node: DataTableLineageNode | undefined = nodeOf(
    lineage,
    getLineageTableNodeId(id),
  );

  expect(node).toBeDefined();

  return node!;
}

function tableIds(
  lineage: DataTableLineage,
  side: DataLineageSide,
): Array<string> {
  return lineage.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Table && node.side === side;
    })
    .map((node: DataTableLineageNode): string => {
      return node.dataAssetId!;
    })
    .sort();
}

describe("the pipeline the lineage is about", () => {
  test("is not drawn at all when it is not one of the project's", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    runs(graph, FOCUS, { reads: [t(1)], writes: [] });

    expect(
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: FOCUS,
        depth: 3,
        now: NOW,
        reader: memoryReader(graph),
      }),
    ).toBeNull();
    // Nothing of its lineage is read.
    expect(graph.pipelineEdgeReads).toEqual([]);
    expect(graph.edgeReads).toEqual([]);
  });

  test("with no tables seen, is drawn alone, in the middle", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS, { jobName: "orders_etl", jobNamespace: "airflow" });

    const lineage: DataTableLineage = await build(graph, 3);

    expect(lineage.focusNodeId).toBe(FOCUS_NODE);
    expect(lineage.depth).toBe(3);
    expect(lineage.nodes).toEqual([
      {
        id: FOCUS_NODE,
        kind: DataLineageNodeKind.Pipeline,
        side: DataLineageSide.Focus,
        depth: 0,
        name: "orders_etl",
        dataPipelineId: FOCUS,
        jobNamespace: "airflow",
        lastRunState: "COMPLETE",
        lastRunStartedAt: new Date(NOW.getTime() - HOUR).toISOString(),
        lastErrorMessage: null,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
      },
    ]);
    expect(lineage.edges).toEqual([]);
    expect(lineage.isTruncated).toBe(false);
    // The pipeline's rows are read once, by its id.
    expect(graph.pipelineEdgeReads).toEqual([FOCUS]);
  });

  test("says how its latest run went, a long error cut to what a card carries", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS, {
      lastRunState: "FAIL",
      lastErrorMessage: "x".repeat(MAX_DATA_LINEAGE_ERROR_LENGTH + 40),
    });

    const focus: DataTableLineageNode = focusOf(await build(graph));

    expect(focus.lastRunState).toBe("FAIL");
    expect(focus.lastErrorMessage).toHaveLength(MAX_DATA_LINEAGE_ERROR_LENGTH);
    expect(focus.lastErrorMessage!.endsWith("…")).toBe(true);
  });

  test("the steps are held between one and the most", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);

    expect((await build(graph, 0)).depth).toBe(1);
    expect((await build(graph, 99)).depth).toBe(MAX_DATA_LINEAGE_DEPTH);
  });
});

describe("the tables it reads and writes", () => {
  test("what it reads on the left, what it writes on the right, a step from it", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS, { jobName: "orders_etl", lastRunState: "FAIL" });
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    runs(graph, FOCUS, { reads: [t(1), t(2)], writes: [t(3)] });

    const lineage: DataTableLineage = await build(graph);

    expect(placesOf(lineage)).toEqual(
      [
        `${FOCUS_NODE}@0`,
        `${getLineageTableNodeId(t(1))}@-1`,
        `${getLineageTableNodeId(t(2))}@-1`,
        `${getLineageTableNodeId(t(3))}@1`,
      ].sort(),
    );
    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual([t(1), t(2)]);
    expect(tableIds(lineage, DataLineageSide.Downstream)).toEqual([t(3)]);

    // A read into it carries no run; a write out of it carries its run, a failed one told.
    const read: DataTableLineageEdge = edgeBetween(
      lineage,
      getLineageTableNodeId(t(1)),
      FOCUS_NODE,
    )!;

    expect(read).toEqual({
      id: `Reads:${getLineageTableNodeId(t(1))}>${FOCUS_NODE}`,
      source: getLineageTableNodeId(t(1)),
      target: FOCUS_NODE,
      kind: DataLineageEdgeKind.Reads,
      seenIn: [DataAssetLineageSource.Pipeline],
      pipelines: [],
      lastSeenAt: new Date(NOW.getTime() - HOUR).toISOString(),
    });
    expect(
      edgeBetween(lineage, FOCUS_NODE, getLineageTableNodeId(t(3))),
    ).toEqual({
      id: `Writes:${FOCUS_NODE}>${getLineageTableNodeId(t(3))}`,
      source: FOCUS_NODE,
      target: getLineageTableNodeId(t(3)),
      kind: DataLineageEdgeKind.Writes,
      seenIn: [DataAssetLineageSource.Pipeline],
      pipelines: [
        { dataPipelineId: FOCUS, name: "orders_etl", lastRunState: "FAIL" },
      ],
      lastSeenAt: new Date(NOW.getTime() - HOUR).toISOString(),
    });
    // A read straight into what it writes is drawn through its card, never across it.
    expect(edgeKinds(lineage, DataLineageEdgeKind.Feeds)).toEqual([]);
  });

  test("each arrow was last seen at the latest of its rows", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    runs(graph, FOCUS, {
      reads: [t(1)],
      writes: [t(2)],
      lastSeenAt: new Date(NOW.getTime() - 5 * HOUR),
    });
    runs(graph, FOCUS, {
      reads: [t(1)],
      writes: [t(2)],
      lastSeenAt: new Date(NOW.getTime() - 2 * HOUR),
    });

    const lineage: DataTableLineage = await build(graph);
    const later: string = new Date(NOW.getTime() - 2 * HOUR).toISOString();

    expect(
      edgeBetween(lineage, getLineageTableNodeId(t(1)), FOCUS_NODE)?.lastSeenAt,
    ).toBe(later);
    expect(
      edgeBetween(lineage, FOCUS_NODE, getLineageTableNodeId(t(2)))?.lastSeenAt,
    ).toBe(later);
  });

  test("a table it reads and writes - a model built on itself - is drawn where it writes", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    runs(graph, FOCUS, { reads: [t(1), t(2)], writes: [t(2)] });

    const lineage: DataTableLineage = await build(graph);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual([t(1)]);
    expect(tableIds(lineage, DataLineageSide.Downstream)).toEqual([t(2)]);
    expect(
      edgeBetween(lineage, getLineageTableNodeId(t(2)), FOCUS_NODE),
    ).toBeUndefined();
  });

  test("its nearest each way are drawn, problems first, and the rest are counted on its card", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);

    const reads: Array<string> = [];
    const written: Array<string> = [];

    for (let index: number = 0; index < 14; index++) {
      reads.push(t(index));
      written.push(t(100 + index));
      table(graph, t(index));
      table(graph, t(100 + index));
    }

    // The last of each, seen longest ago, is late: drawn first all the same.
    lateTable(graph, t(13));
    lateTable(graph, t(113));

    for (let index: number = 0; index < 14; index++) {
      runs(graph, FOCUS, {
        reads: [reads[index]!],
        writes: [written[index]!],
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    const lineage: DataTableLineage = await build(graph);
    const upstream: Array<string> = tableIds(lineage, DataLineageSide.Upstream);
    const downstream: Array<string> = tableIds(
      lineage,
      DataLineageSide.Downstream,
    );

    expect(upstream).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(downstream).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(upstream).toContain(t(13));
    expect(downstream).toContain(t(113));
    // Then the ones seen last.
    expect(upstream).toContain(t(0));
    expect(upstream).not.toContain(t(12));
    expect(focusOf(lineage)).toMatchObject({
      hiddenUpstreamCount: 4,
      hiddenDownstreamCount: 4,
    });
  });

  test("a pinned table is drawn first, past the ones that would be", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(50));

    // Twelve runs, each reading one table - t(11) seen longest ago - and writing t(50).
    for (let index: number = 0; index < 12; index++) {
      table(graph, t(index));
      runs(graph, FOCUS, {
        reads: [t(index)],
        writes: [t(50)],
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    // Unpinned, the oldest two are the ones counted.
    const unpinned: Array<string> = tableIds(
      await build(graph),
      DataLineageSide.Upstream,
    );

    expect(unpinned).not.toContain(t(11));
    expect(unpinned).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);

    const lineage: DataTableLineage = await build(graph, 1, {
      dataAssetIds: new Set([t(11)]),
      dataPipelineIds: new Set(),
    });
    const upstream: Array<string> = tableIds(lineage, DataLineageSide.Upstream);

    expect(upstream).toContain(t(11));
    expect(upstream).not.toContain(t(9));
    expect(upstream).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(focusOf(lineage).hiddenUpstreamCount).toBe(2);
    expect(tableIds(lineage, DataLineageSide.Downstream)).toEqual([t(50)]);
  });

  test("a table the project no longer has is neither drawn nor counted", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    // t(9) was deleted; its rows are still there.
    runs(graph, FOCUS, { reads: [t(1), t(9)], writes: [t(2)] });

    const lineage: DataTableLineage = await build(graph);

    expect(nodeOf(lineage, getLineageTableNodeId(t(9)))).toBeUndefined();
    expect(focusOf(lineage).hiddenUpstreamCount).toBe(0);
  });

  test("another pipeline's rows are never its own", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    pipeline(graph, p(1));
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    runs(graph, p(1), { reads: [t(2)], writes: [t(3)] });

    const tables: DataPipelineTables =
      await DataTableLineageReader.readPipelineTables(
        memoryReader(graph),
        FOCUS,
      );

    expect(Array.from(tables.read.keys())).toEqual([t(1)]);
    expect(Array.from(tables.written.keys())).toEqual([t(2)]);
    expect(tables.isTruncated).toBe(false);
  });
});

describe("the steps beyond its tables", () => {
  // t(0) -> t(1) -[P]-> t(2) -> t(3), and a source t(9) feeding t(0).
  function chain(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);

    for (const index of [0, 1, 2, 3, 9]) {
      table(graph, t(index));
    }

    feeds(graph, t(9), t(0));
    feeds(graph, t(0), t(1));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    feeds(graph, t(2), t(3), {
      source: DataAssetLineageSource.QueryHistory,
    });

    return graph;
  }

  test("one step draws its own tables only, and counts what lies beyond each", async () => {
    const graph: MemoryGraph = chain();
    const lineage: DataTableLineage = await build(graph, 1);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual([t(1)]);
    expect(tableIds(lineage, DataLineageSide.Downstream)).toEqual([t(2)]);
    expect(tableNode(lineage, t(1)).hiddenUpstreamCount).toBe(1);
    expect(tableNode(lineage, t(2)).hiddenDownstreamCount).toBe(1);
    // One read each way past its tables, only to count.
    expect(graph.edgeReads).toEqual([
      { direction: DataLineageDirection.Upstream, ids: [t(1)] },
      { direction: DataLineageDirection.Downstream, ids: [t(2)] },
    ]);
  });

  test("more steps walk on from its tables as from a table's", async () => {
    const lineage: DataTableLineage = await build(chain(), 3);

    expect(placesOf(lineage)).toEqual(
      [
        `${FOCUS_NODE}@0`,
        `${getLineageTableNodeId(t(1))}@-1`,
        `${getLineageTableNodeId(t(0))}@-2`,
        `${getLineageTableNodeId(t(9))}@-3`,
        `${getLineageTableNodeId(t(2))}@1`,
        `${getLineageTableNodeId(t(3))}@2`,
      ].sort(),
    );
    expect(edgeKinds(lineage, DataLineageEdgeKind.Feeds)).toEqual(
      [
        `${getLineageTableNodeId(t(9))}>${getLineageTableNodeId(t(0))}`,
        `${getLineageTableNodeId(t(0))}>${getLineageTableNodeId(t(1))}`,
        `${getLineageTableNodeId(t(2))}>${getLineageTableNodeId(t(3))}`,
      ].sort(),
    );
    expect(
      edgeBetween(
        lineage,
        getLineageTableNodeId(t(2)),
        getLineageTableNodeId(t(3)),
      )?.seenIn,
    ).toEqual([DataAssetLineageSource.QueryHistory]);
  });

  test("a table it writes built from another it writes keeps that arrow, with its run", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS, { lastRunState: "FAIL" });
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    runs(graph, FOCUS, { reads: [t(2)], writes: [t(3)] });

    const lineage: DataTableLineage = await build(graph);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual([t(1)]);
    expect(tableIds(lineage, DataLineageSide.Downstream)).toEqual([t(2), t(3)]);
    expect(
      edgeBetween(
        lineage,
        getLineageTableNodeId(t(2)),
        getLineageTableNodeId(t(3)),
      )?.pipelines.map((entry: { dataPipelineId: string }): string => {
        return entry.dataPipelineId;
      }),
    ).toEqual([FOCUS]);
  });

  test("a pipeline loading a table it reads from outside is drawn before that table", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    pipeline(graph, p(1), { jobName: "fivetran_orders", lastRunState: "FAIL" });
    table(graph, t(1));
    table(graph, t(2));
    writes(graph, p(1), t(1));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });

    const lineage: DataTableLineage = await build(graph);
    const loader: DataTableLineageNode | undefined = nodeOf(
      lineage,
      getLineagePipelineNodeId(p(1)),
    );

    expect(loader).toMatchObject({
      kind: DataLineageNodeKind.Pipeline,
      side: DataLineageSide.Upstream,
      depth: -2,
      name: "fivetran_orders",
    });
    expect(
      edgeBetween(
        lineage,
        getLineagePipelineNodeId(p(1)),
        getLineageTableNodeId(t(1)),
      )?.kind,
    ).toBe(DataLineageEdgeKind.Writes);
    // Its own writes are drawn out of its own card, once.
    expect(
      lineage.nodes.filter((node: DataTableLineageNode): boolean => {
        return node.id === FOCUS_NODE;
      }),
    ).toHaveLength(1);
  });

  test("dashboards on what it writes are drawn after it; those on what it reads are not", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    graph.dashboards.push(
      {
        dataDashboardId: d(1),
        name: "Revenue",
        tool: "Metabase",
        url: null,
        dataAssetIds: [t(2)],
      },
      {
        dataDashboardId: d(2),
        name: "Sources",
        tool: "Metabase",
        url: null,
        dataAssetIds: [t(1)],
      },
    );

    const lineage: DataTableLineage = await build(graph);

    expect(nodeOf(lineage, `dashboard:${d(1)}`)).toMatchObject({
      side: DataLineageSide.Downstream,
      depth: 2,
    });
    expect(nodeOf(lineage, `dashboard:${d(2)}`)).toBeUndefined();
  });

  test("every drawn table's open alerts are counted, as its reader may see them", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    graph.openAlerts.set(t(2), 3);

    const lineage: DataTableLineage = await build(graph);

    expect(tableNode(lineage, t(2)).openAlertCount).toBe(3);
    expect(tableNode(lineage, t(1)).openAlertCount).toBe(0);
    // The tables, never the pipeline.
    expect(graph.alertReads).toEqual([[t(1), t(2)]]);
  });

  test("a pipeline with more rows than are read says its drawing was cut short", async () => {
    const graph: MemoryGraph = newGraph();
    pipeline(graph, FOCUS);
    table(graph, t(1));
    table(graph, t(2));
    runs(graph, FOCUS, { reads: [t(1)], writes: [t(2)] });
    graph.overflow = true;

    const tables: DataPipelineTables =
      await DataTableLineageReader.readPipelineTables(
        memoryReader(graph),
        FOCUS,
      );

    expect(tables.isTruncated).toBe(true);
    expect((await build(graph)).isTruncated).toBe(true);
    expect(MAX_DATA_LINEAGE_EDGE_ROWS).toBeGreaterThan(0);
  });
});

describe("any pipeline's lineage", () => {
  test("keeps every promise of the drawing", async () => {
    const random: SeededRandom = seededRandom(4242);

    for (let round: number = 0; round < 60; round++) {
      const graph: MemoryGraph = newGraph();
      const count: number = 4 + random(50);

      pipeline(graph, FOCUS, {
        lastRunState: random() < 0.3 ? "FAIL" : "COMPLETE",
      });

      for (let index: number = 1; index < 4; index++) {
        pipeline(graph, p(index));
      }

      for (let index: number = 0; index < count; index++) {
        if (random() < 0.15) {
          lateTable(graph, t(index));
        } else {
          table(graph, t(index), { isDropped: random() < 0.05 });
        }
      }

      // Edges always from a lower index to a higher one.
      for (let index: number = 0; index < count * 2; index++) {
        const a: number = random(count);
        const b: number = random(count);

        if (a !== b) {
          feeds(graph, t(Math.min(a, b)), t(Math.max(a, b)), {
            dataPipelineId: random() < 0.4 ? p(1 + random(3)) : null,
            lastSeenAt: new Date(NOW.getTime() - random(300) * HOUR),
          });
        }
      }

      // The pipeline's own runs: some tables read, some written.
      const readSet: Set<string> = new Set();
      const writeSet: Set<string> = new Set();

      for (let run: number = 0; run < 1 + random(6); run++) {
        const reads: Array<string> = [];
        const written: Array<string> = [];

        for (let index: number = 0; index < 1 + random(4); index++) {
          reads.push(t(random(count)));
        }

        for (let index: number = 0; index < random(4); index++) {
          written.push(t(random(count)));
        }

        // A run that wrote nothing leaves no row.
        if (written.length > 0) {
          runs(graph, FOCUS, { reads, writes: written });

          for (const id of written) {
            writeSet.add(id);
          }

          for (const id of reads) {
            if (!written.includes(id)) {
              readSet.add(id);
            }
          }
        }
      }

      for (const id of writeSet) {
        readSet.delete(id);
      }

      if (random() < 0.3) {
        writes(graph, p(1 + random(3)), t(random(count)));
      }

      const depth: number = 1 + random(MAX_DATA_LINEAGE_DEPTH);
      const lineage: DataTableLineage = await build(graph, depth);
      const ids: Set<string> = new Set(
        lineage.nodes.map((node: DataTableLineageNode): string => {
          return node.id;
        }),
      );

      // Each card once, the pipeline once in the middle.
      expect(ids.size).toBe(lineage.nodes.length);
      expect(
        lineage.nodes.filter((node: DataTableLineageNode): boolean => {
          return node.side === DataLineageSide.Focus;
        }),
      ).toEqual([
        expect.objectContaining({
          id: FOCUS_NODE,
          kind: DataLineageNodeKind.Pipeline,
          depth: 0,
        }),
      ]);

      // Each arrow once, between drawn cards.
      expect(
        new Set(
          lineage.edges.map((edge: DataTableLineageEdge): string => {
            return edge.id;
          }),
        ).size,
      ).toBe(lineage.edges.length);

      for (const edge of lineage.edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);

        // Its own arrows: read tables in at -1, written tables out at 1.
        if (edge.target === FOCUS_NODE) {
          expect(edge.kind).toBe(DataLineageEdgeKind.Reads);
          expect(nodeOf(lineage, edge.source)).toMatchObject({
            side: DataLineageSide.Upstream,
            depth: -1,
          });
        }

        if (edge.source === FOCUS_NODE) {
          expect(edge.kind).toBe(DataLineageEdgeKind.Writes);
          expect(nodeOf(lineage, edge.target)).toMatchObject({
            side: DataLineageSide.Downstream,
            depth: 1,
          });
        }
      }

      // Every table it reads or writes is drawn on its side, or counted on its card.
      const drawnReads: number = lineage.edges.filter(
        (edge: DataTableLineageEdge): boolean => {
          return edge.target === FOCUS_NODE;
        },
      ).length;
      const drawnWrites: number = lineage.edges.filter(
        (edge: DataTableLineageEdge): boolean => {
          return edge.source === FOCUS_NODE;
        },
      ).length;
      const focus: DataTableLineageNode = focusOf(lineage);

      expect(drawnReads + focus.hiddenUpstreamCount!).toBe(readSet.size);
      expect(drawnWrites + focus.hiddenDownstreamCount!).toBe(writeSet.size);
      expect(drawnReads).toBeLessThanOrEqual(MAX_DATA_LINEAGE_NEIGHBORS);
      expect(drawnWrites).toBeLessThanOrEqual(MAX_DATA_LINEAGE_NEIGHBORS);

      for (const id of writeSet) {
        const node: DataTableLineageNode | undefined = nodeOf(
          lineage,
          getLineageTableNodeId(id),
        );

        // A table it writes is never drawn upstream of it.
        if (node) {
          expect(node.side).toBe(DataLineageSide.Downstream);
        }
      }

      // Every table within the steps each way, and no side past its most.
      let upstream: number = 0;
      let downstream: number = 0;

      for (const node of lineage.nodes) {
        if (node.kind !== DataLineageNodeKind.Table) {
          continue;
        }

        if (node.side === DataLineageSide.Upstream) {
          upstream++;
          expect(node.depth).toBeGreaterThanOrEqual(-depth);
          expect(node.depth).toBeLessThanOrEqual(-1);
        } else {
          downstream++;
          expect(node.side).toBe(DataLineageSide.Downstream);
          expect(node.depth).toBeGreaterThanOrEqual(1);
          expect(node.depth).toBeLessThanOrEqual(depth);
        }
      }

      expect(upstream).toBeLessThanOrEqual(MAX_DATA_LINEAGE_TABLES_PER_SIDE);
      expect(downstream).toBeLessThanOrEqual(MAX_DATA_LINEAGE_TABLES_PER_SIDE);
    }
  });
});
