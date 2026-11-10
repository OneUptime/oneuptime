import {
  DataLineageDashboardRow,
  DataLineageDirection,
  DataLineageEdgeRow,
  DataLineagePipelineRow,
  DataLineageTableRow,
  DataPipelineLineageReader,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import {
  DataLineageEdgeKind,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
} from "../../../../Types/DataObservability/DataTableLineage";

/*
 * Lineage held in memory, for the tests of a pipeline's drawing and a data
 * alert's (DataPipelineLineage.test.ts, DataAlertLineage.test.ts): tables,
 * edges, pipelines, open alerts and dashboards, read the way the database
 * reader reads them, every read written down.
 */

export const NOW: Date = new Date("2026-11-10T12:00:00.000Z");
export const HOUR: number = 60 * 60 * 1000;

// A uuid of its own for each table, pipeline, dashboard and alert a test names.
export function uuid(kind: number, index: number): string {
  return `${kind.toString().padStart(8, "0")}-0000-4000-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

export function t(index: number): string {
  return uuid(1, index);
}

export function p(index: number): string {
  return uuid(2, index);
}

export function d(index: number): string {
  return uuid(3, index);
}

export interface MemoryGraph {
  tables: Map<string, DataLineageTableRow>;
  edges: Array<DataLineageEdgeRow>;
  pipelines: Map<string, DataLineagePipelineRow>;
  openAlerts: Map<string, number>;
  dashboards: Array<DataLineageDashboardRow>;
  // Every read the walk made, in order.
  edgeReads: Array<{ direction: DataLineageDirection; ids: Array<string> }>;
  pipelineEdgeReads: Array<string>;
  alertReads: Array<Array<string>>;
  // Rows to hand back however many are asked for: more rows than are read.
  overflow?: boolean;
}

export function newGraph(): MemoryGraph {
  return {
    tables: new Map(),
    edges: [],
    pipelines: new Map(),
    openAlerts: new Map(),
    dashboards: [],
    edgeReads: [],
    pipelineEdgeReads: [],
    alertReads: [],
  };
}

// A table that changes hourly and last changed half an hour ago: fresh.
export function table(
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
export function lateTable(
  graph: MemoryGraph,
  id: string,
  fields: Partial<DataLineageTableRow> = {},
): DataLineageTableRow {
  return table(graph, id, {
    lastChangedAt: new Date(NOW.getTime() - 24 * HOUR),
    ...fields,
  });
}

export function pipeline(
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

// One table built from another, by a pipeline's run when one is named.
export function feeds(
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
export function writes(
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

/*
 * A run of a pipeline, as OpenLineage ingest records it: for each table it
 * wrote, a writes row, and a row from each table it read.
 */
export function runs(
  graph: MemoryGraph,
  pipelineId: string,
  data: {
    reads: Array<string>;
    writes: Array<string>;
    lastSeenAt?: Date | undefined;
  },
): void {
  const lastSeenAt: Date = data.lastSeenAt || new Date(NOW.getTime() - HOUR);

  for (const output of data.writes) {
    writes(graph, pipelineId, output, lastSeenAt);

    for (const input of data.reads) {
      if (input !== output) {
        feeds(graph, input, output, {
          dataPipelineId: pipelineId,
          lastSeenAt,
        });
      }
    }
  }
}

export function memoryReader(graph: MemoryGraph): DataPipelineLineageReader {
  const pad: (
    rows: Array<DataLineageEdgeRow>,
    limit: number,
  ) => Array<DataLineageEdgeRow> = (
    rows: Array<DataLineageEdgeRow>,
    limit: number,
  ): Array<DataLineageEdgeRow> => {
    if (graph.overflow && rows.length > 0) {
      // As many as were asked for: the database had more.
      const padded: Array<DataLineageEdgeRow> = [...rows];

      while (padded.length < limit) {
        padded.push(rows[padded.length % rows.length]!);
      }

      return padded.slice(0, limit);
    }

    return rows.slice(0, limit);
  };

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

      return pad(
        graph.edges.filter((row: DataLineageEdgeRow): boolean => {
          return data.direction === DataLineageDirection.Upstream
            ? ids.has(row.downstreamDataAssetId)
            : Boolean(
                row.upstreamDataAssetId && ids.has(row.upstreamDataAssetId),
              );
        }),
        data.limit,
      );
    },
    readPipelineEdges: async (data: {
      dataPipelineId: string;
      limit: number;
    }): Promise<Array<DataLineageEdgeRow>> => {
      graph.pipelineEdgeReads.push(data.dataPipelineId);

      return pad(
        graph.edges.filter((row: DataLineageEdgeRow): boolean => {
          return row.dataPipelineId === data.dataPipelineId;
        }),
        data.limit,
      );
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
        });

      return {
        dashboards: reading.slice(0, data.limit),
        total: reading.length,
      };
    },
  };
}

export function nodeOf(
  lineage: DataTableLineage,
  id: string,
): DataTableLineageNode | undefined {
  return lineage.nodes.find((node: DataTableLineageNode): boolean => {
    return node.id === id;
  });
}

export function edgeBetween(
  lineage: DataTableLineage,
  source: string,
  target: string,
): DataTableLineageEdge | undefined {
  return lineage.edges.find((edge: DataTableLineageEdge): boolean => {
    return edge.source === source && edge.target === target;
  });
}

// The tables drawn, by id, and on which side at how many steps: "id@-1".
export function placesOf(lineage: DataTableLineage): Array<string> {
  return lineage.nodes
    .map((node: DataTableLineageNode): string => {
      return `${node.id}@${node.depth}`;
    })
    .sort();
}

export function edgeKinds(
  lineage: DataTableLineage,
  kind: DataLineageEdgeKind,
): Array<string> {
  return lineage.edges
    .filter((edge: DataTableLineageEdge): boolean => {
      return edge.kind === kind;
    })
    .map((edge: DataTableLineageEdge): string => {
      return `${edge.source}>${edge.target}`;
    })
    .sort();
}
