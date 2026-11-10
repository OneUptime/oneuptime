import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader, {
  DataLineageDashboardRow,
  DataLineageDirection,
  DataLineageEdgeRow,
  DataLineagePipelineRow,
  DataLineageReader,
  DataLineageTableRow,
  MAX_DATA_LINEAGE_EDGE_ROWS,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import { DataAssetFreshness } from "../../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_DEPTH,
  MAX_DATA_LINEAGE_ERROR_LENGTH,
  MAX_DATA_LINEAGE_NEIGHBORS,
  MAX_DATA_LINEAGE_PIPELINES_PER_TABLE,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";

/*
 * A table's lineage graph (DataTableLineageReader.build) decides what its
 * Lineage tab draws: which tables upstream and downstream, a few steps
 * each way, the nearest and the worst first; the edges between them with
 * every source that saw them; the pipelines that bring data in from
 * outside; the dashboards built on it; and how many tables each card does
 * not draw. These walk graphs held in memory, so every rule is pinned
 * without a database; DataTableLineageDatabase.test.ts pins the reads.
 */

const NOW: Date = new Date("2026-11-10T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

// A uuid of its own for each table, pipeline and dashboard a test names.
function uuid(kind: number, index: number): string {
  return `${kind.toString().padStart(8, "0")}-0000-4000-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

function t(index: number): string {
  return uuid(1, index);
}

function p(index: number): string {
  return uuid(2, index);
}

function d(index: number): string {
  return uuid(3, index);
}

interface MemoryGraph {
  tables: Map<string, DataLineageTableRow>;
  edges: Array<DataLineageEdgeRow>;
  pipelines: Map<string, DataLineagePipelineRow>;
  openAlerts: Map<string, number>;
  dashboards: Array<DataLineageDashboardRow>;
  // Every read the walk made, in order.
  edgeReads: Array<{ direction: DataLineageDirection; ids: Array<string> }>;
  dashboardReads: Array<Array<string>>;
  alertReads: Array<Array<string>>;
  // Rows to hand back however many the walk asks for: a table with more edges than are read.
  overflow?: boolean;
}

function newGraph(): MemoryGraph {
  return {
    tables: new Map(),
    edges: [],
    pipelines: new Map(),
    openAlerts: new Map(),
    dashboards: [],
    edgeReads: [],
    dashboardReads: [],
    alertReads: [],
  };
}

// A table that changes hourly and last changed half an hour ago: fresh.
function table(
  graph: MemoryGraph,
  id: string,
  fields: Partial<DataLineageTableRow> = {},
): DataLineageTableRow {
  const row: DataLineageTableRow = {
    dataAssetId: id,
    assetKey: `public.table_${id.slice(-4)}`,
    name: null,
    database: "Warehouse",
    assetKind: DataAssetKind.Table,
    lastChangedAt: new Date(NOW.getTime() - HOUR / 2),
    updateIntervalInSeconds: 3600,
    isDropped: false,
    ...fields,
  };

  graph.tables.set(id, row);

  return row;
}

// Last changed a day ago, changing hourly: late.
function lateTable(
  graph: MemoryGraph,
  id: string,
  fields: Partial<DataLineageTableRow> = {},
): DataLineageTableRow {
  return table(graph, id, {
    lastChangedAt: new Date(NOW.getTime() - 24 * HOUR),
    ...fields,
  });
}

function pipeline(
  graph: MemoryGraph,
  id: string,
  fields: Partial<DataLineagePipelineRow> = {},
): DataLineagePipelineRow {
  const row: DataLineagePipelineRow = {
    dataPipelineId: id,
    jobName: `job_${id.slice(-4)}`,
    jobNamespace: "airflow",
    lastRunState: "COMPLETE",
    lastRunStartedAt: new Date(NOW.getTime() - HOUR),
    lastErrorMessage: null,
    ...fields,
  };

  graph.pipelines.set(id, row);

  return row;
}

function feeds(
  graph: MemoryGraph,
  upstream: string,
  downstream: string,
  fields: Partial<DataLineageEdgeRow> = {},
): void {
  graph.edges.push({
    upstreamDataAssetId: upstream,
    downstreamDataAssetId: downstream,
    dataPipelineId: null,
    source: null,
    lastSeenAt: new Date(NOW.getTime() - HOUR),
    ...fields,
  });
}

// A writes row: the pipeline writes the table, whatever it reads.
function writes(
  graph: MemoryGraph,
  pipelineId: string,
  downstream: string,
  lastSeenAt: Date = new Date(NOW.getTime() - HOUR),
): void {
  graph.edges.push({
    upstreamDataAssetId: null,
    downstreamDataAssetId: downstream,
    dataPipelineId: pipelineId,
    source: null,
    lastSeenAt,
  });
}

function memoryReader(graph: MemoryGraph): DataLineageReader {
  return {
    readEdges: async (data: {
      direction: DataLineageDirection;
      dataAssetIds: Array<string>;
      limit: number;
    }): Promise<Array<DataLineageEdgeRow>> => {
      graph.edgeReads.push({
        direction: data.direction,
        ids: [...data.dataAssetIds],
      });

      const ids: Set<string> = new Set(data.dataAssetIds);
      const rows: Array<DataLineageEdgeRow> = graph.edges.filter(
        (row: DataLineageEdgeRow): boolean => {
          return data.direction === DataLineageDirection.Upstream
            ? ids.has(row.downstreamDataAssetId)
            : Boolean(
                row.upstreamDataAssetId && ids.has(row.upstreamDataAssetId),
              );
        },
      );

      if (graph.overflow && rows.length > 0) {
        // As many as were asked for: the database had more.
        const padded: Array<DataLineageEdgeRow> = [...rows];

        while (padded.length < data.limit) {
          padded.push(rows[padded.length % rows.length]!);
        }

        return padded.slice(0, data.limit);
      }

      return rows.slice(0, data.limit);
    },
    readTables: async (
      ids: Array<string>,
    ): Promise<Array<DataLineageTableRow>> => {
      return ids
        .map((id: string): DataLineageTableRow | undefined => {
          return graph.tables.get(id);
        })
        .filter(
          (
            row: DataLineageTableRow | undefined,
          ): row is DataLineageTableRow => {
            return Boolean(row);
          },
        );
    },
    readPipelines: async (
      ids: Array<string>,
    ): Promise<Array<DataLineagePipelineRow>> => {
      return ids
        .map((id: string): DataLineagePipelineRow | undefined => {
          return graph.pipelines.get(id);
        })
        .filter(
          (
            row: DataLineagePipelineRow | undefined,
          ): row is DataLineagePipelineRow => {
            return Boolean(row);
          },
        );
    },
    readOpenAlertCounts: async (
      ids: Array<string>,
    ): Promise<Map<string, number>> => {
      graph.alertReads.push([...ids]);

      const counts: Map<string, number> = new Map();

      for (const id of ids) {
        if (graph.openAlerts.has(id)) {
          counts.set(id, graph.openAlerts.get(id)!);
        }
      }

      return counts;
    },
    readDashboards: async (data: {
      dataAssetIds: Array<string>;
      limit: number;
    }): Promise<{
      dashboards: Array<DataLineageDashboardRow>;
      total: number;
    }> => {
      graph.dashboardReads.push([...data.dataAssetIds]);

      const asked: Set<string> = new Set(data.dataAssetIds);
      const reading: Array<DataLineageDashboardRow> = graph.dashboards
        .filter((dashboard: DataLineageDashboardRow): boolean => {
          return dashboard.dataAssetIds.some((id: string): boolean => {
            return asked.has(id);
          });
        })
        .map((dashboard: DataLineageDashboardRow): DataLineageDashboardRow => {
          return {
            ...dashboard,
            dataAssetIds: dashboard.dataAssetIds.filter((id: string) => {
              return asked.has(id);
            }),
          };
        })
        .sort((a: DataLineageDashboardRow, b: DataLineageDashboardRow): number => {
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });

      return {
        dashboards: reading.slice(0, data.limit),
        total: reading.length,
      };
    },
  };
}

async function build(
  graph: MemoryGraph,
  focus: string,
  depth: number = 3,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null = await DataTableLineageReader.build({
    focusDataAssetId: focus,
    depth,
    now: NOW,
    reader: memoryReader(graph),
  });

  expect(lineage).not.toBeNull();

  return lineage!;
}

function nodeOf(
  lineage: DataTableLineage,
  id: string,
): DataTableLineageNode | undefined {
  return lineage.nodes.find((node: DataTableLineageNode): boolean => {
    return node.id === id;
  });
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
  side?: DataLineageSide,
): Array<string> {
  return lineage.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return (
        node.kind === DataLineageNodeKind.Table && (!side || node.side === side)
      );
    })
    .map((node: DataTableLineageNode): string => {
      return node.dataAssetId!;
    });
}

function feedsPairs(lineage: DataTableLineage): Array<string> {
  return lineage.edges
    .filter((edge: DataTableLineageEdge): boolean => {
      return edge.kind === DataLineageEdgeKind.Feeds;
    })
    .map((edge: DataTableLineageEdge): string => {
      return `${edge.source.replace("table:", "")}>${edge.target.replace("table:", "")}`;
    })
    .sort();
}

function edgeBetween(
  lineage: DataTableLineage,
  source: string,
  target: string,
): DataTableLineageEdge | undefined {
  return lineage.edges.find((edge: DataTableLineageEdge): boolean => {
    return edge.source === source && edge.target === target;
  });
}

describe("the table the lineage is about", () => {
  test("is not drawn at all when it is not one of the project's", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(2));

    expect(
      await DataTableLineageReader.build({
        focusDataAssetId: t(1),
        depth: 3,
        now: NOW,
        reader: memoryReader(graph),
      }),
    ).toBeNull();
    // Nothing is walked for a table that is not there.
    expect(graph.edgeReads).toEqual([]);
  });

  test("with no lineage, is drawn alone", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders", database: "Orders DB" });

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(lineage.focusNodeId).toBe(getLineageTableNodeId(t(1)));
    expect(lineage.depth).toBe(3);
    expect(lineage.edges).toEqual([]);
    expect(lineage.isTruncated).toBe(false);
    expect(lineage.hiddenDashboardCount).toBe(0);
    expect(lineage.nodes).toEqual([
      {
        id: getLineageTableNodeId(t(1)),
        kind: DataLineageNodeKind.Table,
        side: DataLineageSide.Focus,
        depth: 0,
        name: "public.orders",
        dataAssetId: t(1),
        database: "Orders DB",
        assetKind: DataAssetKind.Table,
        freshness: DataAssetFreshness.Fresh,
        lateBySeconds: 0,
        isDropped: false,
        openAlertCount: 0,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
      },
    ]);
  });

  test("is named by its key, else its name, else its id", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "", name: "orders" });
    table(graph, t(2), { assetKey: "", name: null });
    feeds(graph, t(2), t(1));

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(tableNode(lineage, t(1)).name).toBe("orders");
    expect(tableNode(lineage, t(2)).name).toBe(t(2));
  });
});

describe("walking the steps", () => {
  test("a chain is drawn both ways, each table at its steps from the table", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 5; index++) {
      table(graph, t(index));
    }

    // 1 -> 2 -> 3 (the table) -> 4 -> 5
    feeds(graph, t(1), t(2));
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(4));
    feeds(graph, t(4), t(5));

    const lineage: DataTableLineage = await build(graph, t(3));

    expect(
      lineage.nodes.map(
        (node: DataTableLineageNode): [string, string, number] => {
          return [node.dataAssetId!, node.side, node.depth];
        },
      ),
    ).toEqual([
      [t(3), DataLineageSide.Focus, 0],
      [t(2), DataLineageSide.Upstream, -1],
      [t(1), DataLineageSide.Upstream, -2],
      [t(4), DataLineageSide.Downstream, 1],
      [t(5), DataLineageSide.Downstream, 2],
    ]);
    expect(feedsPairs(lineage)).toEqual(
      [
        `${t(1)}>${t(2)}`,
        `${t(2)}>${t(3)}`,
        `${t(3)}>${t(4)}`,
        `${t(4)}>${t(5)}`,
      ].sort(),
    );
  });

  test("goes no further than the steps asked for, and counts what lies beyond", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 7; index++) {
      table(graph, t(index));
    }

    // 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 (the table)
    for (let index: number = 1; index < 7; index++) {
      feeds(graph, t(index), t(index + 1));
    }

    const lineage: DataTableLineage = await build(graph, t(7), 2);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual([t(6), t(5)]);
    expect(tableNode(lineage, t(5)).hiddenUpstreamCount).toBe(1);
    expect(tableNode(lineage, t(6)).hiddenUpstreamCount).toBe(0);
    // Two steps, and one more read only to count what lies past the second.
    expect(
      graph.edgeReads
        .filter((read: { direction: DataLineageDirection; ids: Array<string> }): boolean => {
          return read.direction === DataLineageDirection.Upstream;
        })
        .map((read: { direction: DataLineageDirection; ids: Array<string> }): Array<string> => {
          return read.ids;
        }),
    ).toEqual([[t(7)], [t(6)], [t(5)]]);
  });

  test("one step draws the tables next to it only", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 5; index++) {
      table(graph, t(index));
    }

    feeds(graph, t(1), t(2));
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(4));
    feeds(graph, t(4), t(5));

    const lineage: DataTableLineage = await build(graph, t(3), 1);

    expect(tableIds(lineage).sort()).toEqual([t(2), t(3), t(4)].sort());
    expect(tableNode(lineage, t(2)).hiddenUpstreamCount).toBe(1);
    expect(tableNode(lineage, t(4)).hiddenDownstreamCount).toBe(1);
  });

  test("the steps are held between one and the most", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    expect((await build(graph, t(1), 0)).depth).toBe(1);
    expect((await build(graph, t(1), -4)).depth).toBe(1);
    expect((await build(graph, t(1), 99)).depth).toBe(MAX_DATA_LINEAGE_DEPTH);
    expect((await build(graph, t(1), 2.7)).depth).toBe(2);
  });

  test("a table reached two ways is drawn once, at the fewest steps, with both edges", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 4; index++) {
      table(graph, t(index));
    }

    // A diamond: 1 -> 2 -> 4, 1 -> 3 -> 4 (the table).
    feeds(graph, t(1), t(2));
    feeds(graph, t(1), t(3));
    feeds(graph, t(2), t(4));
    feeds(graph, t(3), t(4));

    const lineage: DataTableLineage = await build(graph, t(4));

    expect(
      tableIds(lineage).filter((id: string) => {
        return id === t(1);
      }),
    ).toHaveLength(1);
    expect(tableNode(lineage, t(1)).depth).toBe(-2);
    expect(feedsPairs(lineage)).toEqual(
      [
        `${t(1)}>${t(2)}`,
        `${t(1)}>${t(3)}`,
        `${t(2)}>${t(4)}`,
        `${t(3)}>${t(4)}`,
      ].sort(),
    );
  });

  test("an edge between two tables at the same step is drawn", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 3; index++) {
      table(graph, t(index));
    }

    // 1 and 2 both feed the table, and 1 feeds 2.
    feeds(graph, t(1), t(3));
    feeds(graph, t(2), t(3));
    feeds(graph, t(1), t(2));

    const lineage: DataTableLineage = await build(graph, t(3));

    expect(tableNode(lineage, t(1)).depth).toBe(-1);
    expect(tableNode(lineage, t(2)).depth).toBe(-1);
    expect(feedsPairs(lineage)).toContain(`${t(1)}>${t(2)}`);
  });

  test("a cycle through the table keeps the table it meets upstream, with both edges", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(1), t(2), { source: DataAssetLineageSource.QueryHistory });
    feeds(graph, t(2), t(1), { source: DataAssetLineageSource.QueryHistory });

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(tableIds(lineage)).toEqual([t(1), t(2)]);
    expect(tableNode(lineage, t(2)).side).toBe(DataLineageSide.Upstream);
    expect(feedsPairs(lineage)).toEqual(
      [`${t(1)}>${t(2)}`, `${t(2)}>${t(1)}`].sort(),
    );
  });

  test("a cycle upstream ends, each table drawn once", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 3; index++) {
      table(graph, t(index));
    }

    feeds(graph, t(1), t(2));
    feeds(graph, t(2), t(1));
    feeds(graph, t(2), t(3));

    const lineage: DataTableLineage = await build(
      graph,
      t(3),
      MAX_DATA_LINEAGE_DEPTH,
    );

    expect(tableIds(lineage).sort()).toEqual([t(1), t(2), t(3)].sort());
    expect(feedsPairs(lineage)).toEqual(
      [`${t(1)}>${t(2)}`, `${t(2)}>${t(1)}`, `${t(2)}>${t(3)}`].sort(),
    );
  });

  test("a table that reads and writes itself is not its own neighbour", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    feeds(graph, t(1), t(1), { source: DataAssetLineageSource.QueryHistory });

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(lineage.nodes).toHaveLength(1);
    expect(lineage.edges).toEqual([]);
  });

  test("an edge to a table the project no longer has is neither drawn nor counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    feeds(graph, t(9), t(1));
    feeds(graph, t(1), t(8));

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(lineage.nodes).toHaveLength(1);
    expect(lineage.edges).toEqual([]);
    expect(tableNode(lineage, t(1)).hiddenUpstreamCount).toBe(0);
    expect(tableNode(lineage, t(1)).hiddenDownstreamCount).toBe(0);
  });
});

describe("the most drawn next to each table", () => {
  test("past the most, the rest are counted on the table", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (let index: number = 100; index < 115; index++) {
      table(graph, t(index));
      feeds(graph, t(1), t(index));
    }

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(tableIds(lineage, DataLineageSide.Downstream)).toHaveLength(
      MAX_DATA_LINEAGE_NEIGHBORS,
    );
    expect(tableNode(lineage, t(1)).hiddenDownstreamCount).toBe(
      15 - MAX_DATA_LINEAGE_NEIGHBORS,
    );
    // Counted, not cut short: the drawing holds them, a table at a time.
    expect(lineage.isTruncated).toBe(false);
  });

  test("the edges seen last are drawn first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (let index: number = 0; index < 12; index++) {
      table(graph, t(100 + index));
      feeds(graph, t(100 + index), t(1), {
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    const lineage: DataTableLineage = await build(graph, t(1), 1);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toEqual(
      Array.from(
        { length: MAX_DATA_LINEAGE_NEIGHBORS },
        (_: unknown, index: number) => {
          return t(100 + index);
        },
      ),
    );
  });

  test("a late table is drawn first, however long ago its edge was seen", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (let index: number = 0; index < 12; index++) {
      table(graph, t(100 + index));
      feeds(graph, t(100 + index), t(1), {
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    // The two seen longest ago are late.
    lateTable(graph, t(110));
    lateTable(graph, t(111));

    const upstream: Array<string> = tableIds(
      await build(graph, t(1), 1),
      DataLineageSide.Upstream,
    );

    expect(upstream.slice(0, 2)).toEqual([t(110), t(111)]);
    expect(upstream).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
  });

  test("an edge whose pipeline's latest run failed is drawn first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    pipeline(graph, p(1), { lastRunState: "FAIL" });
    pipeline(graph, p(2), { lastRunState: "COMPLETE" });

    for (let index: number = 0; index < 12; index++) {
      table(graph, t(100 + index));
      feeds(graph, t(100 + index), t(1), {
        dataPipelineId: index === 11 ? p(1) : p(2),
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    const upstream: Array<string> = tableIds(
      await build(graph, t(1), 1),
      DataLineageSide.Upstream,
    );

    expect(upstream[0]).toBe(t(111));
  });

  test("a table dropped from its database is drawn after those still there", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (let index: number = 0; index < 11; index++) {
      // The dropped one was seen last; it is still the one left out.
      table(graph, t(100 + index), { isDropped: index === 0 });
      feeds(graph, t(100 + index), t(1), {
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    const lineage: DataTableLineage = await build(graph, t(1), 1);

    expect(tableIds(lineage, DataLineageSide.Upstream)).not.toContain(t(100));
    expect(tableNode(lineage, t(1)).hiddenUpstreamCount).toBe(1);
  });

  test("a dropped table that is late is no problem to draw first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (let index: number = 0; index < 11; index++) {
      table(graph, t(100 + index));
      feeds(graph, t(100 + index), t(1), {
        lastSeenAt: new Date(NOW.getTime() - (index + 1) * HOUR),
      });
    }

    lateTable(graph, t(110), { isDropped: true });

    expect(
      tableIds(await build(graph, t(1), 1), DataLineageSide.Upstream),
    ).not.toContain(t(110));
  });

  test("a table left out by one is drawn when another reaches it later, with both edges and no count", async () => {
    const graph: MemoryGraph = newGraph();
    // The table, built from 2 and from 4, which is built from 3.
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    table(graph, t(4));
    feeds(graph, t(2), t(1));
    feeds(graph, t(4), t(1));
    feeds(graph, t(3), t(4));

    /*
     * 2 is built from ten tables seen lately and from 50, seen long ago, so
     * at the second step 2 leaves 50 out. 3, drawn at that step, is built
     * from 50 too, and draws it at the third.
     */
    for (let index: number = 0; index < MAX_DATA_LINEAGE_NEIGHBORS; index++) {
      table(graph, t(10 + index));
      feeds(graph, t(10 + index), t(2), {
        lastSeenAt: new Date(NOW.getTime() - HOUR),
      });
    }

    table(graph, t(50));
    feeds(graph, t(50), t(2), {
      lastSeenAt: new Date(NOW.getTime() - 100 * HOUR),
    });
    feeds(graph, t(50), t(3));

    const lineage: DataTableLineage = await build(graph, t(1), 3);

    expect(tableNode(lineage, t(50)).depth).toBe(-3);
    expect(feedsPairs(lineage)).toContain(`${t(50)}>${t(2)}`);
    expect(feedsPairs(lineage)).toContain(`${t(50)}>${t(3)}`);
    expect(tableNode(lineage, t(2)).hiddenUpstreamCount).toBe(0);
  });

  test("a side holds at most its most tables, and says the drawing was cut short", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0));
    let next: number = 1;
    let level: Array<string> = [t(0)];

    // Ten tables build each table, three levels up: 10 + 100 + 1000.
    for (let depth: number = 0; depth < 3; depth++) {
      const above: Array<string> = [];

      for (const below of level) {
        for (let index: number = 0; index < 10; index++) {
          const id: string = t(next++);
          table(graph, id);
          feeds(graph, id, below);
          above.push(id);
        }
      }

      level = above;
    }

    const lineage: DataTableLineage = await build(graph, t(0), 3);

    expect(tableIds(lineage, DataLineageSide.Upstream)).toHaveLength(
      MAX_DATA_LINEAGE_TABLES_PER_SIDE,
    );
    expect(lineage.isTruncated).toBe(true);
  });

  test("a step with more edges than are read says the drawing was cut short", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(2), t(1));
    graph.overflow = true;

    const lineage: DataTableLineage = await build(graph, t(1), 1);

    expect(lineage.isTruncated).toBe(true);
    expect(
      graph.edgeReads.every((read: { direction: DataLineageDirection; ids: Array<string> }): boolean => {
        return read.ids.length > 0;
      }),
    ).toBe(true);
    expect(MAX_DATA_LINEAGE_EDGE_ROWS).toBeGreaterThan(
      MAX_DATA_LINEAGE_NEIGHBORS,
    );
  });
});

describe("an edge", () => {
  test("is every row between two tables together: every source, every pipeline, last seen at the latest", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    pipeline(graph, p(1), { jobName: "b_job" });
    pipeline(graph, p(2), { jobName: "a_job" });
    feeds(graph, t(2), t(1), {
      dataPipelineId: p(1),
      lastSeenAt: new Date("2026-11-10T08:00:00.000Z"),
    });
    feeds(graph, t(2), t(1), {
      dataPipelineId: p(2),
      lastSeenAt: new Date("2026-11-10T09:00:00.000Z"),
    });
    feeds(graph, t(2), t(1), {
      source: DataAssetLineageSource.QueryHistory,
      lastSeenAt: new Date("2026-11-10T11:00:00.000Z"),
    });
    feeds(graph, t(2), t(1), {
      source: DataAssetLineageSource.ViewDefinition,
      lastSeenAt: new Date("2026-11-10T10:00:00.000Z"),
    });

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(lineage.edges).toEqual([
      {
        id: `Feeds:${getLineageTableNodeId(t(2))}>${getLineageTableNodeId(t(1))}`,
        source: getLineageTableNodeId(t(2)),
        target: getLineageTableNodeId(t(1)),
        kind: DataLineageEdgeKind.Feeds,
        seenIn: [
          DataAssetLineageSource.Pipeline,
          DataAssetLineageSource.QueryHistory,
          DataAssetLineageSource.ViewDefinition,
        ],
        pipelines: [
          { dataPipelineId: p(2), name: "a_job", lastRunState: "COMPLETE" },
          { dataPipelineId: p(1), name: "b_job", lastRunState: "COMPLETE" },
        ],
        lastSeenAt: "2026-11-10T11:00:00.000Z",
      },
    ]);
  });

  test("names a pipeline whose latest run failed first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    pipeline(graph, p(1), { jobName: "a_job" });
    pipeline(graph, p(2), { jobName: "z_job", lastRunState: "ABORT" });
    feeds(graph, t(2), t(1), { dataPipelineId: p(1) });
    feeds(graph, t(2), t(1), { dataPipelineId: p(2) });

    const edge: DataTableLineageEdge = (await build(graph, t(1))).edges[0]!;

    expect(
      edge.pipelines.map((entry: DataTableLineagePipeline): string => {
        return entry.name;
      }),
    ).toEqual(["z_job", "a_job"]);
  });

  test("leaves out a pipeline the project no longer has", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(2), t(1), { dataPipelineId: p(7) });

    const edge: DataTableLineageEdge = (await build(graph, t(1))).edges[0]!;

    expect(edge.pipelines).toEqual([]);
    expect(edge.seenIn).toEqual([DataAssetLineageSource.Pipeline]);
  });

  test("a source the walk does not know reads as a pipeline's run", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(2), t(1), {
      source: "Telepathy" as DataAssetLineageSource,
    });

    expect((await build(graph, t(1))).edges[0]!.seenIn).toEqual([
      DataAssetLineageSource.Pipeline,
    ]);
  });

  test("the edges come in one order whatever order the rows do", async () => {
    const random: SeededRandom = seededRandom(4242);
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 9; index++) {
      table(graph, t(index));
    }

    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(2));
    feeds(graph, t(5), t(3));
    feeds(graph, t(1), t(6));
    feeds(graph, t(1), t(7));
    feeds(graph, t(6), t(8));
    feeds(graph, t(7), t(9));

    const first: DataTableLineage = await build(graph, t(1));

    for (let round: number = 0; round < 10; round++) {
      graph.edges = shuffled(graph.edges, random);
      const again: DataTableLineage = await build(graph, t(1));

      expect(again.edges).toEqual(first.edges);
      expect(
        again.nodes
          .map((node: DataTableLineageNode) => {
            return node.id;
          })
          .sort(),
      ).toEqual(
        first.nodes
          .map((node: DataTableLineageNode) => {
            return node.id;
          })
          .sort(),
      );
    }
  });
});

describe("how each table is", () => {
  test("its freshness by its own rhythm, how late it is, and whether it was dropped", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    lateTable(graph, t(2));
    table(graph, t(3), { assetKind: DataAssetKind.View });
    table(graph, t(4), { isDropped: true });
    table(graph, t(5), { updateIntervalInSeconds: null });
    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    feeds(graph, t(1), t(4));
    feeds(graph, t(1), t(5));

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(tableNode(lineage, t(1)).freshness).toBe(DataAssetFreshness.Fresh);
    expect(tableNode(lineage, t(2)).freshness).toBe(DataAssetFreshness.Late);
    // A day since it changed, two hours allowed: late by twenty-two hours.
    expect(tableNode(lineage, t(2)).lateBySeconds).toBe(22 * 3600);
    expect(tableNode(lineage, t(3)).freshness).toBe(
      DataAssetFreshness.NotApplicable,
    );
    expect(tableNode(lineage, t(4)).isDropped).toBe(true);
    expect(tableNode(lineage, t(5)).freshness).toBe(DataAssetFreshness.Unknown);
  });

  test("its open alerts, as the reader counts them, for every drawn table", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    feeds(graph, t(2), t(1));
    feeds(graph, t(1), t(3));
    graph.openAlerts.set(t(2), 2);
    graph.openAlerts.set(t(3), 1);

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(tableNode(lineage, t(1)).openAlertCount).toBe(0);
    expect(tableNode(lineage, t(2)).openAlertCount).toBe(2);
    expect(tableNode(lineage, t(3)).openAlertCount).toBe(1);
    // One read for every drawn table together.
    expect(graph.alertReads).toHaveLength(1);
    expect([...graph.alertReads[0]!].sort()).toEqual([t(1), t(2), t(3)].sort());
  });

  test("a card counts what it does not draw only on its own side, and the table both ways", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    table(graph, t(4));
    table(graph, t(5));
    // 4 -> 2 -> 1 (the table) -> 3 -> 5, one step each way.
    feeds(graph, t(4), t(2));
    feeds(graph, t(2), t(1));
    feeds(graph, t(1), t(3));
    feeds(graph, t(3), t(5));

    const lineage: DataTableLineage = await build(graph, t(1), 1);

    expect(tableNode(lineage, t(2)).hiddenUpstreamCount).toBe(1);
    expect(tableNode(lineage, t(2)).hiddenDownstreamCount).toBe(0);
    expect(tableNode(lineage, t(3)).hiddenUpstreamCount).toBe(0);
    expect(tableNode(lineage, t(3)).hiddenDownstreamCount).toBe(1);
  });
});

describe("pipelines that bring data in from outside", () => {
  test("a pipeline that writes the table from what OneUptime does not watch is drawn before it", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    pipeline(graph, p(1), {
      jobName: "shopify_sync",
      jobNamespace: "fivetran",
      lastRunState: "FAIL",
      lastErrorMessage: "x".repeat(MAX_DATA_LINEAGE_ERROR_LENGTH + 50),
    });
    writes(graph, p(1), t(1), new Date("2026-11-10T07:00:00.000Z"));

    const lineage: DataTableLineage = await build(graph, t(1));
    const card: DataTableLineageNode | undefined = nodeOf(
      lineage,
      getLineagePipelineNodeId(p(1)),
    );

    expect(card).toMatchObject({
      kind: DataLineageNodeKind.Pipeline,
      side: DataLineageSide.Upstream,
      depth: -1,
      name: "shopify_sync",
      dataPipelineId: p(1),
      jobNamespace: "fivetran",
      lastRunState: "FAIL",
      lastRunStartedAt: new Date(NOW.getTime() - HOUR).toISOString(),
    });
    expect(card!.lastErrorMessage).toHaveLength(MAX_DATA_LINEAGE_ERROR_LENGTH);
    expect(card!.lastErrorMessage!.endsWith("…")).toBe(true);
    expect(
      edgeBetween(
        lineage,
        getLineagePipelineNodeId(p(1)),
        getLineageTableNodeId(t(1)),
      ),
    ).toEqual({
      id: `Writes:${getLineagePipelineNodeId(p(1))}>${getLineageTableNodeId(t(1))}`,
      source: getLineagePipelineNodeId(p(1)),
      target: getLineageTableNodeId(t(1)),
      kind: DataLineageEdgeKind.Writes,
      seenIn: [DataAssetLineageSource.Pipeline],
      pipelines: [
        { dataPipelineId: p(1), name: "shopify_sync", lastRunState: "FAIL" },
      ],
      lastSeenAt: "2026-11-10T07:00:00.000Z",
    });
  });

  test("a pipeline that builds the table from a watched table is told on that edge, not drawn apart", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    pipeline(graph, p(1));
    // Every table a pipeline writes has a writes row, whatever it reads.
    writes(graph, p(1), t(1));
    feeds(graph, t(2), t(1), { dataPipelineId: p(1) });

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(nodeOf(lineage, getLineagePipelineNodeId(p(1)))).toBeUndefined();
    expect(
      lineage.edges.map((edge: DataTableLineageEdge): DataLineageEdgeKind => {
        return edge.kind;
      }),
    ).toEqual([DataLineageEdgeKind.Feeds]);
    expect(lineage.edges[0]!.pipelines[0]!.dataPipelineId).toBe(p(1));
  });

  test("one pipeline writing several tables is one card, a step before the first it writes", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    // 3 -> 2 -> 1 (the table); the sync loads 2 and 3.
    feeds(graph, t(3), t(2));
    feeds(graph, t(2), t(1));
    pipeline(graph, p(1));
    writes(graph, p(1), t(2));
    writes(graph, p(1), t(3));

    const lineage: DataTableLineage = await build(graph, t(1));
    const cards: Array<DataTableLineageNode> = lineage.nodes.filter((node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Pipeline;
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]!.depth).toBe(-3);
    expect(
      lineage.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return edge.kind === DataLineageEdgeKind.Writes;
        })
        .map((edge: DataTableLineageEdge): string => {
          return edge.target;
        })
        .sort(),
    ).toEqual(
      [getLineageTableNodeId(t(2)), getLineageTableNodeId(t(3))].sort(),
    );
  });

  test("a table drawn at the last step still shows where its data comes in", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(2), t(1));
    pipeline(graph, p(1));
    writes(graph, p(1), t(2));

    const lineage: DataTableLineage = await build(graph, t(1), 1);

    expect(nodeOf(lineage, getLineagePipelineNodeId(p(1)))?.depth).toBe(-2);
  });

  test("at most a few pipelines per table, a failed run first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (
      let index: number = 1;
      index <= MAX_DATA_LINEAGE_PIPELINES_PER_TABLE + 2;
      index++
    ) {
      pipeline(graph, p(index), {
        lastRunState:
          index === MAX_DATA_LINEAGE_PIPELINES_PER_TABLE + 2
            ? "FAIL"
            : "COMPLETE",
      });
      writes(graph, p(index), t(1), new Date(NOW.getTime() - index * HOUR));
    }

    const lineage: DataTableLineage = await build(graph, t(1));
    const cards: Array<string> = lineage.nodes
      .filter((node: DataTableLineageNode): boolean => {
        return node.kind === DataLineageNodeKind.Pipeline;
      })
      .map((node: DataTableLineageNode): string => {
        return node.dataPipelineId!;
      });

    expect(cards).toHaveLength(MAX_DATA_LINEAGE_PIPELINES_PER_TABLE);
    expect(cards[0]).toBe(p(MAX_DATA_LINEAGE_PIPELINES_PER_TABLE + 2));
    // Then the ones seen last.
    expect(cards.slice(1)).toEqual([p(1), p(2), p(3), p(4)]);
  });

  test("tables downstream are not given the pipelines that write them", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    feeds(graph, t(1), t(2));
    pipeline(graph, p(1));
    writes(graph, p(1), t(2));

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(nodeOf(lineage, getLineagePipelineNodeId(p(1)))).toBeUndefined();
  });

  test("a writes row of a pipeline the project no longer has draws nothing", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    writes(graph, p(9), t(1));

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(lineage.nodes).toHaveLength(1);
    expect(lineage.edges).toEqual([]);
  });
});

describe("dashboards built on it", () => {
  test("on the table and the tables built from it, a step after the last each reads", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));
    table(graph, t(2));
    table(graph, t(3));
    // 3 -> 1 (the table) -> 2
    feeds(graph, t(3), t(1));
    feeds(graph, t(1), t(2));
    graph.dashboards = [
      {
        dataDashboardId: d(1),
        name: "Revenue",
        tool: "Metabase",
        url: "https://metabase.example.com/dashboard/1",
        dataAssetIds: [t(1), t(2)],
      },
      {
        dataDashboardId: d(2),
        name: "Upstream only",
        tool: "Looker",
        url: null,
        dataAssetIds: [t(3)],
      },
    ];

    const lineage: DataTableLineage = await build(graph, t(1));

    // Only the table and the tables built from it are asked about.
    expect([...graph.dashboardReads[0]!].sort()).toEqual([t(1), t(2)].sort());
    expect(nodeOf(lineage, getLineageDashboardNodeId(d(1)))).toEqual({
      id: getLineageDashboardNodeId(d(1)),
      kind: DataLineageNodeKind.Dashboard,
      side: DataLineageSide.Downstream,
      depth: 2,
      name: "Revenue",
      dataDashboardId: d(1),
      tool: "Metabase",
      url: "https://metabase.example.com/dashboard/1",
    });
    expect(nodeOf(lineage, getLineageDashboardNodeId(d(2)))).toBeUndefined();
    expect(
      lineage.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return edge.kind === DataLineageEdgeKind.Reads;
        })
        .map((edge: DataTableLineageEdge): string => {
          return edge.source;
        })
        .sort(),
    ).toEqual(
      [getLineageTableNodeId(t(1)), getLineageTableNodeId(t(2))].sort(),
    );
    expect(lineage.hiddenDashboardCount).toBe(0);
  });

  test("past the most dashboards, the rest are counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1));

    for (
      let index: number = 0;
      index < MAX_DATA_LINEAGE_DASHBOARDS + 4;
      index++
    ) {
      graph.dashboards.push({
        dataDashboardId: d(index),
        name: `Dashboard ${index.toString().padStart(3, "0")}`,
        tool: "Tableau",
        url: null,
        dataAssetIds: [t(1)],
      });
    }

    const lineage: DataTableLineage = await build(graph, t(1));

    expect(
      lineage.nodes.filter((node: DataTableLineageNode): boolean => {
        return node.kind === DataLineageNodeKind.Dashboard;
      }),
    ).toHaveLength(MAX_DATA_LINEAGE_DASHBOARDS);
    expect(lineage.hiddenDashboardCount).toBe(4);
  });
});

/*
 * Random lineage, held to what every drawing promises: the table once, at
 * the middle; every edge between drawn cards; every table at its steps on
 * its side; and every neighbour of a drawn table either drawn or counted.
 */
describe("any lineage", () => {
  test("keeps every promise of the drawing", async () => {
    const random: SeededRandom = seededRandom(1337);

    for (let round: number = 0; round < 60; round++) {
      const graph: MemoryGraph = newGraph();
      const count: number = 5 + random(60);

      for (let index: number = 0; index < count; index++) {
        if (random() < 0.15) {
          lateTable(graph, t(index));
        } else {
          table(graph, t(index), { isDropped: random() < 0.05 });
        }
      }

      for (let index: number = 0; index < 4; index++) {
        pipeline(graph, p(index), {
          lastRunState: random() < 0.3 ? "FAIL" : "COMPLETE",
        });
      }

      // An acyclic graph: an edge always runs from a lower index to a higher one.
      const edgeCount: number = random(count * 3);
      const pairs: Set<string> = new Set();

      for (let index: number = 0; index < edgeCount; index++) {
        const a: number = random(count);
        const b: number = random(count);

        if (a === b) {
          continue;
        }

        const up: number = Math.min(a, b);
        const down: number = Math.max(a, b);
        pairs.add(`${t(up)}>${t(down)}`);
        feeds(graph, t(up), t(down), {
          dataPipelineId: random() < 0.5 ? p(random(4)) : null,
          source:
            random() < 0.2
              ? DataAssetLineageSource.QueryHistory
              : random() < 0.1
                ? DataAssetLineageSource.ViewDefinition
                : null,
          lastSeenAt: new Date(NOW.getTime() - random(500) * HOUR),
        });
      }

      for (let index: number = 0; index < count; index++) {
        if (random() < 0.1) {
          writes(graph, p(random(4)), t(index));
        }
      }

      const focus: string = t(random(count));
      const depth: number = 1 + random(MAX_DATA_LINEAGE_DEPTH);
      const lineage: DataTableLineage = await build(graph, focus, depth);
      const ids: Set<string> = new Set(
        lineage.nodes.map((node: DataTableLineageNode): string => {
          return node.id;
        }),
      );

      // Each card once, the table once at the middle.
      expect(ids.size).toBe(lineage.nodes.length);
      expect(
        lineage.nodes.filter((node: DataTableLineageNode): boolean => {
          return node.side === DataLineageSide.Focus;
        }),
      ).toEqual([
        expect.objectContaining({ id: getLineageTableNodeId(focus), depth: 0 }),
      ]);

      // Each arrow once, between drawn cards, and every table arrow a real edge.
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

        if (edge.kind === DataLineageEdgeKind.Feeds) {
          expect(
            pairs.has(
              `${edge.source.replace("table:", "")}>${edge.target.replace("table:", "")}`,
            ),
          ).toBe(true);
        }
      }

      // Every table at its steps, on its side, and no side past its most.
      const upstream: Array<DataTableLineageNode> = [];
      const downstream: Array<DataTableLineageNode> = [];

      for (const node of lineage.nodes) {
        if (node.kind !== DataLineageNodeKind.Table) {
          continue;
        }

        if (node.side === DataLineageSide.Upstream) {
          upstream.push(node);
          expect(node.depth).toBeGreaterThanOrEqual(-depth);
          expect(node.depth).toBeLessThanOrEqual(-1);
        }

        if (node.side === DataLineageSide.Downstream) {
          downstream.push(node);
          expect(node.depth).toBeGreaterThanOrEqual(1);
          expect(node.depth).toBeLessThanOrEqual(depth);
        }
      }

      expect(upstream.length).toBeLessThanOrEqual(
        MAX_DATA_LINEAGE_TABLES_PER_SIDE,
      );
      expect(downstream.length).toBeLessThanOrEqual(
        MAX_DATA_LINEAGE_TABLES_PER_SIDE,
      );

      // Every neighbour of a drawn table on its side is drawn, or counted on it.
      for (const node of lineage.nodes) {
        if (node.kind !== DataLineageNodeKind.Table) {
          continue;
        }

        const id: string = node.dataAssetId!;
        const drawnId: (other: string) => boolean = (
          other: string,
        ): boolean => {
          return ids.has(getLineageTableNodeId(other));
        };

        if (node.side !== DataLineageSide.Downstream) {
          const above: Set<string> = new Set();

          for (const pair of pairs) {
            const [up, down] = pair.split(">") as [string, string];

            if (down === id) {
              above.add(up);
            }
          }

          const hidden: number = Array.from(above).filter((other: string) => {
            return !drawnId(other);
          }).length;

          expect(node.hiddenUpstreamCount).toBe(hidden);

          for (const other of above) {
            if (drawnId(other)) {
              expect(
                edgeBetween(lineage, getLineageTableNodeId(other), node.id),
              ).toBeDefined();
            }
          }
        }

        if (node.side !== DataLineageSide.Upstream) {
          const below: Set<string> = new Set();

          for (const pair of pairs) {
            const [up, down] = pair.split(">") as [string, string];

            if (up === id) {
              below.add(down);
            }
          }

          const hidden: number = Array.from(below).filter((other: string) => {
            return !drawnId(other);
          }).length;

          expect(node.hiddenDownstreamCount).toBe(hidden);

          for (const other of below) {
            if (drawnId(other)) {
              expect(
                edgeBetween(lineage, node.id, getLineageTableNodeId(other)),
              ).toBeDefined();
            }
          }
        }
      }
    }
  });
});
