import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader, {
  DataLineageTablePair,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DataColumnMapping,
  MAX_COLUMN_MAPPINGS_PER_EDGE,
} from "../../../../Types/DataObservability/DataColumnLineage";
import {
  DataLineageEdgeKind,
  DataTableLineage,
  DataTableLineageEdge,
  MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
  getLineageDashboardNodeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  MemoryGraph,
  NOW,
  columns,
  d,
  edgeBetween,
  feeds,
  memoryReader,
  newGraph,
  p,
  pipeline,
  runs,
  t,
  table,
  uuid,
  writes,
} from "./LineageMemoryGraph";

/*
 * FOLLOWING ONE COLUMN UP AND DOWN A TABLE'S DRAWING (#6665): THE SERVER'S
 * SIDE.
 *
 * A table's Lineage tab asks for its drawing with its columns
 * (withColumns), so its column picker can light the way a column takes.
 * Each arrow between two tables then carries the column pairs its sources
 * named (Snowflake's access history, OpenLineage's column lineage), every
 * source's together, each pair once; an arrow none named says nothing of
 * them. A pipeline's arrows and a dashboard's never carry any. The pairs
 * are read a hundred arrows at a time, the arrows nearest the drawing's own
 * card first, until the answer holds the most it carries
 * (MAX_DATA_LINEAGE_COLUMN_MAPPINGS): the arrows past that carry none, and
 * are never read. Not asked for, nothing is read. DataLineageExpansion.
 * test.ts follows the columns of the tables a card draws later, and the
 * Dashboard's LineageColumnTrail.test.ts the way a column takes.
 */

const FOCUS: string = t(0);

async function draw(
  graph: MemoryGraph,
  depth: number,
  withColumns: boolean | undefined,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null = await DataTableLineageReader.build({
    focusDataAssetId: FOCUS,
    depth,
    now: NOW,
    reader: memoryReader(graph),
    withColumns,
  });

  expect(lineage).not.toBeNull();

  return lineage!;
}

function arrow(
  lineage: DataTableLineage,
  upstream: string,
  downstream: string,
): DataTableLineageEdge {
  const edge: DataTableLineageEdge | undefined = edgeBetween(
    lineage,
    getLineageTableNodeId(upstream),
    getLineageTableNodeId(downstream),
  );

  expect(edge).toBeDefined();

  return edge!;
}

// As many column pairs as asked for, each its own.
function manyPairs(count: number, prefix: string): Array<[string, string]> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return [`${prefix}_in_${index}`, `${prefix}_out_${index}`] as [
      string,
      string,
    ];
  });
}

function carried(lineage: DataTableLineage): number {
  return lineage.edges.reduce(
    (sum: number, edge: DataTableLineageEdge): number => {
      return sum + (edge.columnMappings?.length || 0);
    },
    0,
  );
}

function touchesFocus(pair: DataLineageTablePair): boolean {
  return (
    pair.upstreamDataAssetId === FOCUS || pair.downstreamDataAssetId === FOCUS
  );
}

/*
 * orders_raw -> orders_clean -> FOCUS -> revenue -> revenue_daily, with
 * columns named on every arrow but the last.
 */
function chain(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  for (const id of [t(0), t(1), t(2), t(3), t(4)]) {
    table(graph, id);
  }

  feeds(graph, t(2), t(1));
  feeds(graph, t(1), FOCUS);
  feeds(graph, FOCUS, t(3));
  feeds(graph, t(3), t(4));

  columns(graph, t(2), t(1), [["id", "order_id"]]);
  columns(graph, t(1), FOCUS, [
    ["order_id", "order_id"],
    ["amount_cents", "amount"],
  ]);
  // Another source of the same arrow: one pair again, and one more.
  columns(graph, t(1), FOCUS, [
    ["order_id", "order_id"],
    ["tax_cents", "amount"],
  ]);
  columns(graph, FOCUS, t(3), [["amount", "revenue"]]);

  return graph;
}

describe("a table's drawing asked for with its columns", () => {
  test("each arrow between two tables carries every source's columns together, each pair once", async () => {
    const graph: MemoryGraph = chain();
    const lineage: DataTableLineage = await draw(graph, 3, true);

    expect(arrow(lineage, t(1), FOCUS).columnMappings).toEqual([
      { upstreamColumn: "amount_cents", downstreamColumn: "amount" },
      { upstreamColumn: "order_id", downstreamColumn: "order_id" },
      { upstreamColumn: "tax_cents", downstreamColumn: "amount" },
    ]);
    expect(arrow(lineage, t(2), t(1)).columnMappings).toEqual([
      { upstreamColumn: "id", downstreamColumn: "order_id" },
    ]);
    expect(arrow(lineage, FOCUS, t(3)).columnMappings).toEqual([
      { upstreamColumn: "amount", downstreamColumn: "revenue" },
    ]);
    // No source named this arrow's columns: it says nothing of them.
    expect(arrow(lineage, t(3), t(4)).columnMappings).toBeUndefined();
  });

  test("read once for every arrow of the drawing, the nearest the table's own card first", async () => {
    const graph: MemoryGraph = chain();

    await draw(graph, 3, true);

    // The two that touch the table, then the two a step out; each pair by its arrow's id.
    expect(graph.columnReads).toEqual([
      [
        { upstreamDataAssetId: FOCUS, downstreamDataAssetId: t(3) },
        { upstreamDataAssetId: t(1), downstreamDataAssetId: FOCUS },
        { upstreamDataAssetId: t(2), downstreamDataAssetId: t(1) },
        { upstreamDataAssetId: t(3), downstreamDataAssetId: t(4) },
      ],
    ]);
  });

  test.each([[false], [undefined]])(
    "asked for with columns %p: none is read, and no arrow carries any",
    async (withColumns: boolean | undefined) => {
      const graph: MemoryGraph = chain();
      const lineage: DataTableLineage = await draw(graph, 3, withColumns);

      expect(graph.columnReads).toEqual([]);
      expect(lineage.edges.length).toBeGreaterThan(0);

      for (const edge of lineage.edges) {
        expect(edge.columnMappings).toBeUndefined();
      }
    },
  );

  test("a pipeline's arrows and a dashboard's never carry columns, and are never asked about", async () => {
    const graph: MemoryGraph = chain();
    // A pipeline loads the furthest table upstream from outside.
    pipeline(graph, p(1), { jobName: "orders_loader" });
    writes(graph, p(1), t(2));
    // And another moves data between two of them, its run on the arrow.
    pipeline(graph, p(2), { jobName: "revenue_etl" });
    runs(graph, p(2), { reads: [FOCUS], writes: [t(3)] });
    // A dashboard reads the table downstream.
    graph.dashboards.push({
      dataDashboardId: d(1),
      name: "Revenue",
      tool: "Metabase",
      url: null,
      dataAssetIds: [t(3)],
    });

    const lineage: DataTableLineage = await draw(graph, 3, true);
    const loads: DataTableLineageEdge | undefined = edgeBetween(
      lineage,
      getLineagePipelineNodeId(p(1)),
      getLineageTableNodeId(t(2)),
    );
    const reads: DataTableLineageEdge | undefined = edgeBetween(
      lineage,
      getLineageTableNodeId(t(3)),
      getLineageDashboardNodeId(d(1)),
    );

    expect(loads?.kind).toBe(DataLineageEdgeKind.Writes);
    expect(loads?.columnMappings).toBeUndefined();
    expect(reads?.kind).toBe(DataLineageEdgeKind.Reads);
    expect(reads?.columnMappings).toBeUndefined();
    // The arrow a pipeline's run moves data along is between two tables: it carries them.
    expect(arrow(lineage, FOCUS, t(3)).pipelines).toHaveLength(1);
    expect(arrow(lineage, FOCUS, t(3)).columnMappings).toEqual([
      { upstreamColumn: "amount", downstreamColumn: "revenue" },
    ]);

    // Only arrows between two tables are asked about.
    const asked: Array<DataLineageTablePair> = graph.columnReads.flat();

    expect(asked).toHaveLength(4);

    for (const pair of asked) {
      expect(graph.tables.has(pair.upstreamDataAssetId)).toBe(true);
      expect(graph.tables.has(pair.downstreamDataAssetId)).toBe(true);
    }
  });

  test("a pipeline's drawing reads no columns", async () => {
    const graph: MemoryGraph = chain();
    pipeline(graph, p(1), { jobName: "orders_etl" });
    runs(graph, p(1), { reads: [t(1)], writes: [FOCUS] });

    const lineage: DataTableLineage | null =
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: p(1),
        depth: 2,
        now: NOW,
        reader: memoryReader(graph),
      });

    expect(lineage).not.toBeNull();
    expect(graph.columnReads).toEqual([]);

    for (const edge of lineage!.edges) {
      expect(edge.columnMappings).toBeUndefined();
    }
  });
});

describe("a drawing with many arrows", () => {
  /*
   * FOCUS built from ten tables, each built from ten more, and feeding ten:
   * 120 arrows between tables, twenty of them touching FOCUS.
   */
  function wide(): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    table(graph, FOCUS);

    for (let near: number = 1; near <= 10; near++) {
      const upstream: string = uuid(11, near);
      const downstream: string = uuid(12, near);

      table(graph, upstream);
      table(graph, downstream);
      feeds(graph, upstream, FOCUS);
      feeds(graph, FOCUS, downstream);

      for (let far: number = 1; far <= 10; far++) {
        const further: string = uuid(13, near * 100 + far);

        table(graph, further);
        feeds(graph, further, upstream);
      }
    }

    return graph;
  }

  test("are read a hundred at a time, the twenty that touch the table's own card first", async () => {
    const graph: MemoryGraph = wide();
    const lineage: DataTableLineage = await draw(graph, 2, true);

    expect(
      lineage.edges.filter((edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Feeds;
      }),
    ).toHaveLength(120);
    expect(
      graph.columnReads.map((pairs: Array<DataLineageTablePair>): number => {
        return pairs.length;
      }),
    ).toEqual([100, 20]);
    expect(graph.columnReads[0]!.slice(0, 20).every(touchesFocus)).toBe(true);
    expect(
      [...graph.columnReads[0]!.slice(20), ...graph.columnReads[1]!].some(
        touchesFocus,
      ),
    ).toBe(false);
    // Every arrow asked about once.
    expect(
      new Set(
        graph.columnReads.flat().map((pair: DataLineageTablePair): string => {
          return `${pair.upstreamDataAssetId}>${pair.downstreamDataAssetId}`;
        }),
      ).size,
    ).toBe(120);
  });

  test("past the most one answer carries, the arrows further out carry none, and are never read", async () => {
    const graph: MemoryGraph = wide();

    // The twenty nearest arrows hold exactly the most one answer carries.
    for (let near: number = 1; near <= 10; near++) {
      columns(
        graph,
        uuid(11, near),
        FOCUS,
        manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, `u${near}`),
      );
      columns(
        graph,
        FOCUS,
        uuid(12, near),
        manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, `d${near}`),
      );
    }

    // One a step further out names a single pair.
    columns(graph, uuid(13, 101), uuid(11, 1), [["id", "id"]]);

    expect(20 * MAX_COLUMN_MAPPINGS_PER_EDGE).toBe(
      MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
    );

    const lineage: DataTableLineage = await draw(graph, 2, true);

    for (let near: number = 1; near <= 10; near++) {
      expect(arrow(lineage, uuid(11, near), FOCUS).columnMappings).toHaveLength(
        MAX_COLUMN_MAPPINGS_PER_EDGE,
      );
      expect(arrow(lineage, FOCUS, uuid(12, near)).columnMappings).toHaveLength(
        MAX_COLUMN_MAPPINGS_PER_EDGE,
      );
    }

    // It would make one too many: none, and nothing past it is read.
    expect(
      arrow(lineage, uuid(13, 101), uuid(11, 1)).columnMappings,
    ).toBeUndefined();
    expect(carried(lineage)).toBe(MAX_DATA_LINEAGE_COLUMN_MAPPINGS);
    expect(graph.columnReads).toHaveLength(1);
  });

  test("under the most, every arrow that names columns carries them, however far out", async () => {
    const graph: MemoryGraph = wide();

    for (let near: number = 1; near <= 10; near++) {
      columns(graph, uuid(11, near), FOCUS, manyPairs(100, `u${near}`));
    }

    // The furthest arrow of all, by its place in the reads.
    columns(graph, uuid(13, 1010), uuid(11, 10), [["id", "id"]]);

    const lineage: DataTableLineage = await draw(graph, 2, true);

    expect(arrow(lineage, uuid(13, 1010), uuid(11, 10)).columnMappings).toEqual(
      [{ upstreamColumn: "id", downstreamColumn: "id" }],
    );
    expect(carried(lineage)).toBe(10 * 100 + 1);
    // An arrow that names none uses none of what the answer carries.
    expect(arrow(lineage, FOCUS, uuid(12, 1)).columnMappings).toBeUndefined();
  });

  test("an arrow's own columns are kept to the most one arrow holds, however many sources name", async () => {
    const graph: MemoryGraph = chain();

    columns(
      graph,
      t(1),
      FOCUS,
      manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, "first"),
    );
    columns(
      graph,
      t(1),
      FOCUS,
      manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, "second"),
    );

    const lineage: DataTableLineage = await draw(graph, 1, true);
    const mappings: Array<DataColumnMapping> | undefined = arrow(
      lineage,
      t(1),
      FOCUS,
    ).columnMappings;

    expect(mappings).toHaveLength(MAX_COLUMN_MAPPINGS_PER_EDGE);
  });
});
