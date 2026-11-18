import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataAlertLineageReader, {
  DataAlertLineageRow,
  DataAlertRowReader,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataLineageMapReader, {
  DataLineageMapFlowReader,
} from "../../../../Server/Utils/DataObservability/DataLineageMap";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataTableLineageReader, {
  DataLineageReadable,
  DataLineageReadableCache,
  DataPipelineLineageReader,
  scopeDataLineageReader,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  buildDataTableLineageAnswer,
  formatDataTableLineageAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableLineageAnswer";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
} from "../../../../Types/DataObservability/DataLineageExpansion";
import {
  DataLineageMap,
  DataLineageMapLineageRow,
  DataLineageMapUsageRow,
} from "../../../../Types/DataObservability/DataLineageMap";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  HOUR,
  MemoryGraph,
  NOW,
  columns,
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
 * LINEAGE TELLS A CALLER ONLY OF THE TABLES AND PIPELINES THEY MAY READ
 * (#9526).
 *
 * A role limited to what its members own, or to some labels, reads those
 * tables and pipelines on every other route. Lineage reads rows that name
 * two tables and a pipeline each, so the boundary is held where the rows
 * are read (scopeDataLineageReader): a table they may not read is never
 * drawn, never counted on a card or in a side's total, and no arrow, way,
 * column or dashboard leads to it; a pipeline they may not read is never
 * named - an arrow between two tables they may read is drawn without it.
 * Every reader of lineage reads through it: a table's drawing, a
 * pipeline's, drawing more, an alert's, the answer told in words, and the
 * map. Each test below checks the whole answer, as JSON, for any name or
 * id of what they may not read. A caller the scope narrows nothing for
 * reads exactly what they read before.
 *
 * The warehouse, the caller owning everything but HR's:
 *
 *   hr.payroll_raw -> public.salaries -> public.orders <- staging.orders <- raw.orders
 *   (payroll_sync, theirs not, writes salaries and moves raw -> staging;
 *    orders_etl, theirs, moves raw -> staging too)
 *   public.orders -> marts.revenue
 *   public.orders -> hr.headcount -> marts.exec   (exec only through HR's)
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

// What they may read.
const ORDERS: string = t(0);
const STAGING: string = t(1);
const RAW: string = t(2);
const REVENUE: string = t(5);
const EXEC: string = t(6);
const ORDERS_ETL: string = p(1);

// What they may not: never named, never counted.
const SALARIES: string = t(10);
const PAYROLL_RAW: string = t(11);
const HEADCOUNT: string = t(12);
const PAYROLL_SYNC: string = p(9);
const HR_DASHBOARD: string = uuid(3, 9);

const SECRET_IDS: Array<string> = [
  SALARIES,
  PAYROLL_RAW,
  HEADCOUNT,
  PAYROLL_SYNC,
  HR_DASHBOARD,
];
const SECRET_NAMES: Array<string> = [
  "public.salaries",
  "hr.payroll_raw",
  "hr.headcount",
  "payroll_sync",
  "HR Headcount",
  "payroll-service",
];

const READABLE_TABLES: Set<string> = new Set([
  ORDERS,
  STAGING,
  RAW,
  REVENUE,
  EXEC,
]);
const READABLE_PIPELINES: Set<string> = new Set([ORDERS_ETL]);

function warehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  table(graph, ORDERS, { assetKey: "public.orders" });
  table(graph, STAGING, { assetKey: "staging.orders" });
  table(graph, RAW, { assetKey: "raw.orders" });
  table(graph, REVENUE, { assetKey: "marts.revenue" });
  table(graph, EXEC, { assetKey: "marts.exec" });
  // HR's tables are late and alerting: a problem first, if they were ever ranked.
  lateTable(graph, SALARIES, { assetKey: "public.salaries" });
  lateTable(graph, PAYROLL_RAW, { assetKey: "hr.payroll_raw" });
  lateTable(graph, HEADCOUNT, { assetKey: "hr.headcount" });
  graph.openAlerts.set(SALARIES, 4);
  graph.openAlerts.set(HEADCOUNT, 2);

  pipeline(graph, ORDERS_ETL, { jobName: "orders_etl" });
  pipeline(graph, PAYROLL_SYNC, {
    jobName: "payroll_sync",
    lastRunState: "FAIL",
    lastErrorMessage: "permission denied for table salaries",
  });

  feeds(graph, STAGING, ORDERS);
  feeds(graph, SALARIES, ORDERS);
  feeds(graph, PAYROLL_RAW, SALARIES);
  writes(graph, PAYROLL_SYNC, SALARIES);
  // raw -> staging, seen in both pipelines' runs: payroll_sync's never named.
  feeds(graph, RAW, STAGING, { dataPipelineId: ORDERS_ETL });
  feeds(graph, RAW, STAGING, { dataPipelineId: PAYROLL_SYNC });
  // payroll_sync also writes staging from outside: it is never drawn doing so.
  writes(graph, PAYROLL_SYNC, STAGING);
  feeds(graph, ORDERS, REVENUE);
  feeds(graph, ORDERS, HEADCOUNT);
  feeds(graph, HEADCOUNT, EXEC);

  columns(graph, RAW, STAGING, [["order_id", "id"]]);
  columns(graph, STAGING, ORDERS, [["id", "order_id"]]);
  columns(graph, SALARIES, ORDERS, [["employee_id", "sales_rep_id"]]);
  columns(graph, ORDERS, HEADCOUNT, [["sales_rep_id", "employee_id"]]);

  graph.dashboards.push(
    {
      dataDashboardId: uuid(3, 1),
      name: "Revenue",
      tool: DataBiTool.Tableau,
      url: null,
      dataAssetIds: [REVENUE],
    },
    {
      dataDashboardId: uuid(3, 2),
      name: "Exec Summary",
      tool: DataBiTool.Looker,
      url: null,
      dataAssetIds: [REVENUE, HEADCOUNT],
    },
    {
      dataDashboardId: HR_DASHBOARD,
      name: "HR Headcount",
      tool: DataBiTool.Looker,
      url: null,
      dataAssetIds: [HEADCOUNT],
    },
  );

  return graph;
}

// What the caller may read, as a test's sets; every question asked is kept.
interface Readable extends DataLineageReadable {
  tableAsks: Array<Array<string>>;
  pipelineAsks: Array<Array<string>>;
}

function readableOf(
  tables: Set<string> = READABLE_TABLES,
  pipelines: Set<string> = READABLE_PIPELINES,
): Readable {
  const readable: Readable = {
    tableAsks: [],
    pipelineAsks: [],
    readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
      readable.tableAsks.push([...ids]);

      return new Set(
        ids.filter((id: string): boolean => {
          return tables.has(id);
        }),
      );
    },
    readablePipelineIds: async (ids: Array<string>): Promise<Set<string>> => {
      readable.pipelineAsks.push([...ids]);

      return new Set(
        ids.filter((id: string): boolean => {
          return pipelines.has(id);
        }),
      );
    },
  };

  return readable;
}

// Everything they read of HR's: none of it, by id or by name.
function expectNothingSecret(answer: unknown): void {
  const json: string = JSON.stringify(answer);

  for (const secret of [...SECRET_IDS, ...SECRET_NAMES]) {
    expect(json).not.toContain(secret);
  }
}

function idsOf(lineage: { nodes: Array<DataTableLineageNode> }): Array<string> {
  return lineage.nodes
    .map((node: DataTableLineageNode): string => {
      return node.id;
    })
    .sort();
}

function edgeOf(
  lineage: { edges: Array<DataTableLineageEdge> },
  source: string,
  target: string,
): DataTableLineageEdge | undefined {
  return lineage.edges.find((edge: DataTableLineageEdge): boolean => {
    return edge.source === source && edge.target === target;
  });
}

async function scopedDrawing(
  graph: MemoryGraph,
  focus: string,
  depth: number,
  readable: Readable = readableOf(),
  withColumns: boolean = false,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null = await DataTableLineageReader.build({
    focusDataAssetId: focus,
    depth,
    now: NOW,
    reader: scopeDataLineageReader(memoryReader(graph), readable),
    withColumns,
  });

  expect(lineage).not.toBeNull();

  return lineage!;
}

describe("a table's drawing, for a caller limited to some tables", () => {
  test("draws only what they may read: HR's tables are not on it, and what lies only past them is not reached", async () => {
    const lineage: DataTableLineage = await scopedDrawing(
      warehouse(),
      ORDERS,
      3,
    );

    expect(
      idsOf(lineage).filter((id: string): boolean => {
        return id.startsWith("table:");
      }),
    ).toEqual(
      [ORDERS, STAGING, RAW, REVENUE].map(getLineageTableNodeId).sort(),
    );
    // marts.exec is theirs, but is reached only through HR's headcount.
    expect(nodeOf(lineage, getLineageTableNodeId(EXEC))).toBeUndefined();
    expectNothingSecret(lineage);
  });

  test("an arrow between two of their tables is drawn without a pipeline they may not read; their own pipeline is named", async () => {
    const lineage: DataTableLineage = await scopedDrawing(
      warehouse(),
      ORDERS,
      3,
    );
    const arrow: DataTableLineageEdge | undefined = edgeOf(
      lineage,
      getLineageTableNodeId(RAW),
      getLineageTableNodeId(STAGING),
    );

    expect(arrow).toBeDefined();
    expect(
      arrow!.pipelines.map((entry: { name: string }): string => {
        return entry.name;
      }),
    ).toEqual(["orders_etl"]);
    // payroll_sync writing staging from outside: no card of it.
    expect(
      nodeOf(lineage, getLineagePipelineNodeId(PAYROLL_SYNC)),
    ).toBeUndefined();
  });

  test("no card counts a table they may not read, and neither does a side's total", async () => {
    const lineage: DataTableLineage = await scopedDrawing(
      warehouse(),
      ORDERS,
      1,
    );

    // One step: staging is drawn, raw counted on staging's card - and salaries, next to orders, counted nowhere.
    expect(
      nodeOf(lineage, getLineageTableNodeId(STAGING))?.hiddenUpstreamCount,
    ).toBe(1);
    expect(
      nodeOf(lineage, getLineageTableNodeId(ORDERS))?.hiddenUpstreamCount,
    ).toBe(0);
    expect(lineage.hiddenUpstreamTotal).toBe(1);
    // Down: revenue is drawn, headcount neither drawn nor counted.
    expect(
      nodeOf(lineage, getLineageTableNodeId(ORDERS))?.hiddenDownstreamCount,
    ).toBe(0);
    expect(lineage.hiddenDownstreamTotal).toBe(0);
    expectNothingSecret(lineage);
  });

  test("a dashboard on their tables only is drawn, one on HR's only is not, and one on both is drawn reading theirs alone", async () => {
    const lineage: DataTableLineage = await scopedDrawing(
      warehouse(),
      ORDERS,
      3,
    );
    const dashboards: Array<string> = lineage.nodes
      .filter((node: DataTableLineageNode): boolean => {
        return node.id.startsWith("dashboard:");
      })
      .map((node: DataTableLineageNode): string => {
        return node.name;
      })
      .sort();

    expect(dashboards).toEqual(["Exec Summary", "Revenue"]);
    expect(
      lineage.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return edge.target === `dashboard:${uuid(3, 2)}`;
        })
        .map((edge: DataTableLineageEdge): string => {
          return edge.source;
        }),
    ).toEqual([getLineageTableNodeId(REVENUE)]);
    // Nor is HR's dashboard counted as one not drawn.
    expect(lineage.hiddenDashboardCount).toBe(0);
  });

  test("open alerts are asked of their tables alone, and columns of arrows between them alone", async () => {
    const graph: MemoryGraph = warehouse();
    const lineage: DataTableLineage = await scopedDrawing(
      graph,
      ORDERS,
      3,
      readableOf(),
      true,
    );

    for (const asked of graph.alertReads) {
      for (const id of asked) {
        expect(READABLE_TABLES.has(id)).toBe(true);
      }
    }

    for (const pairs of graph.columnReads) {
      for (const pair of pairs) {
        expect(READABLE_TABLES.has(pair.upstreamDataAssetId)).toBe(true);
        expect(READABLE_TABLES.has(pair.downstreamDataAssetId)).toBe(true);
      }
    }

    expect(
      edgeOf(
        lineage,
        getLineageTableNodeId(STAGING),
        getLineageTableNodeId(ORDERS),
      )?.columnMappings,
    ).toEqual([{ upstreamColumn: "id", downstreamColumn: "order_id" }]);
    expectNothingSecret(lineage);
  });

  test("a table they may not read is no drawing at all", async () => {
    expect(
      await DataTableLineageReader.build({
        focusDataAssetId: SALARIES,
        depth: 3,
        now: NOW,
        reader: scopeDataLineageReader(memoryReader(warehouse()), readableOf()),
      }),
    ).toBeNull();
  });

  test("HR's late, alerting tables never decide which of theirs are drawn first", async () => {
    const graph: MemoryGraph = warehouse();

    // Eleven tables of theirs feed orders besides staging: past the ten drawn, one is counted.
    const many: Set<string> = new Set(READABLE_TABLES);

    for (let index: number = 20; index < 31; index++) {
      table(graph, t(index), { assetKey: `raw.feed_${index}` });
      feeds(graph, t(index), ORDERS);
      many.add(t(index));
    }

    const lineage: DataTableLineage = await scopedDrawing(
      graph,
      ORDERS,
      1,
      readableOf(many),
    );

    expect(
      nodeOf(lineage, getLineageTableNodeId(ORDERS))?.hiddenUpstreamCount,
    ).toBe(2);
    expect(lineage.hiddenUpstreamTotal).toBe(2);
    expectNothingSecret(lineage);
  });

  test("a caller whose scope narrows nothing sees exactly what the drawing always drew", async () => {
    const everything: Readable = readableOf(
      new Set([...READABLE_TABLES, SALARIES, PAYROLL_RAW, HEADCOUNT]),
      new Set([ORDERS_ETL, PAYROLL_SYNC]),
    );
    const scoped: DataTableLineage = await scopedDrawing(
      warehouse(),
      ORDERS,
      3,
      everything,
      true,
    );
    const unscoped: DataTableLineage | null =
      await DataTableLineageReader.build({
        focusDataAssetId: ORDERS,
        depth: 3,
        now: NOW,
        reader: memoryReader(warehouse()),
        withColumns: true,
      });

    expect(scoped).toEqual(unscoped);
    // And HR's are on it, for someone who may read them.
    expect(nodeOf(scoped, getLineageTableNodeId(SALARIES))?.name).toBe(
      "public.salaries",
    );
  });
});

describe("the reader's own rule (DataLineageReadableCache)", () => {
  test("a row is kept only when both its tables may be read; a pipeline they may not read is taken off a row between two of theirs, and a row of it alone is dropped", async () => {
    const cache: DataLineageReadableCache = new DataLineageReadableCache(
      readableOf(),
    );
    const seen: Date = new Date(NOW.getTime() - HOUR);

    expect(
      await cache.keepRows([
        // Theirs, by their pipeline: kept as it is.
        {
          upstreamDataAssetId: RAW,
          downstreamDataAssetId: STAGING,
          dataPipelineId: ORDERS_ETL,
          source: null,
          lastSeenAt: seen,
        },
        // Theirs, by HR's pipeline: kept, the pipeline not named.
        {
          upstreamDataAssetId: RAW,
          downstreamDataAssetId: STAGING,
          dataPipelineId: PAYROLL_SYNC,
          source: null,
          lastSeenAt: seen,
        },
        // HR's pipeline writing their table: nothing of it may be said.
        {
          upstreamDataAssetId: null,
          downstreamDataAssetId: STAGING,
          dataPipelineId: PAYROLL_SYNC,
          source: null,
          lastSeenAt: seen,
        },
        // Into their table from HR's, and from theirs into HR's.
        {
          upstreamDataAssetId: SALARIES,
          downstreamDataAssetId: ORDERS,
          dataPipelineId: null,
          source: null,
          lastSeenAt: seen,
        },
        {
          upstreamDataAssetId: ORDERS,
          downstreamDataAssetId: HEADCOUNT,
          dataPipelineId: null,
          source: null,
          lastSeenAt: seen,
        },
      ]),
    ).toEqual([
      {
        upstreamDataAssetId: RAW,
        downstreamDataAssetId: STAGING,
        dataPipelineId: ORDERS_ETL,
        source: null,
        lastSeenAt: seen,
      },
      {
        upstreamDataAssetId: RAW,
        downstreamDataAssetId: STAGING,
        dataPipelineId: null,
        source: null,
        lastSeenAt: seen,
      },
    ]);
  });

  test("each table and pipeline is asked about once, however many reads name it", async () => {
    const readable: Readable = readableOf();
    const reader: DataPipelineLineageReader = scopeDataLineageReader(
      memoryReader(warehouse()),
      readable,
    );

    await reader.readTables([ORDERS, SALARIES]);
    await reader.readTables([ORDERS, SALARIES, STAGING]);
    await reader.readPipelines([PAYROLL_SYNC]);
    await reader.readPipelines([PAYROLL_SYNC, ORDERS_ETL]);

    expect(readable.tableAsks).toEqual([[ORDERS, SALARIES], [STAGING]]);
    expect(readable.pipelineAsks).toEqual([[PAYROLL_SYNC], [ORDERS_ETL]]);
  });

  test("a read of what they may not read reads nothing at all", async () => {
    const graph: MemoryGraph = warehouse();
    const reader: DataPipelineLineageReader = scopeDataLineageReader(
      memoryReader(graph),
      readableOf(),
    );

    expect(await reader.readTables([SALARIES, HEADCOUNT])).toEqual([]);
    expect(await reader.readPipelines([PAYROLL_SYNC])).toEqual([]);
    expect(
      await reader.readPipelineEdges({
        dataPipelineId: PAYROLL_SYNC,
        limit: 100,
      }),
    ).toEqual([]);
    expect((await reader.readOpenAlertCounts([SALARIES])).size).toBe(0);
    expect(
      await reader.readDashboards({ dataAssetIds: [HEADCOUNT], limit: 25 }),
    ).toEqual({ dashboards: [], total: 0 });
    expect(
      (
        await reader.readColumnMappings([
          { upstreamDataAssetId: SALARIES, downstreamDataAssetId: ORDERS },
        ])
      ).size,
    ).toBe(0);
    // Nothing reached the rows behind: no edges, alerts, dashboards or columns read.
    expect(graph.pipelineEdgeReads).toEqual([]);
    expect(graph.alertReads).toEqual([]);
    expect(graph.dashboardReads).toEqual([]);
    expect(graph.columnReads).toEqual([]);
  });
});

describe("a pipeline's drawing, for a caller limited to some tables and pipelines", () => {
  function pipelineWarehouse(): MemoryGraph {
    const graph: MemoryGraph = warehouse();

    // orders_etl reads raw and HR's payroll, and writes staging and HR's salaries.
    runs(graph, ORDERS_ETL, {
      reads: [RAW, PAYROLL_RAW],
      writes: [STAGING, SALARIES],
    });

    return graph;
  }

  test("a pipeline they may not read is no drawing at all", async () => {
    expect(
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: PAYROLL_SYNC,
        depth: 1,
        now: NOW,
        reader: scopeDataLineageReader(
          memoryReader(pipelineWarehouse()),
          readableOf(),
        ),
      }),
    ).toBeNull();
  });

  test("their pipeline draws the tables of theirs it reads and writes; HR's are neither drawn nor counted on its card", async () => {
    const lineage: DataTableLineage | null =
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: ORDERS_ETL,
        depth: 1,
        now: NOW,
        reader: scopeDataLineageReader(
          memoryReader(pipelineWarehouse()),
          readableOf(),
        ),
      });
    const focus: DataTableLineageNode | undefined = nodeOf(
      lineage!,
      getLineagePipelineNodeId(ORDERS_ETL),
    );

    expect(
      idsOf(lineage!).filter((id: string): boolean => {
        return id.startsWith("table:");
      }),
    ).toEqual([RAW, STAGING].map(getLineageTableNodeId).sort());
    expect(focus?.hiddenUpstreamCount).toBe(0);
    expect(focus?.hiddenDownstreamCount).toBe(0);
    expect(lineage!.hiddenUpstreamTotal).toBe(0);
    // public.orders, past staging, is theirs: the one table further down.
    expect(lineage!.hiddenDownstreamTotal).toBe(1);
    expect(
      nodeOf(lineage!, getLineageTableNodeId(STAGING))?.hiddenDownstreamCount,
    ).toBe(1);
    expectNothingSecret(lineage);
  });

  test("its columns are of its arrows to and from their tables alone", async () => {
    const graph: MemoryGraph = pipelineWarehouse();

    columns(graph, PAYROLL_RAW, STAGING, [["ssn", "id"]]);

    const lineage: DataTableLineage | null =
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: ORDERS_ETL,
        depth: 1,
        now: NOW,
        reader: scopeDataLineageReader(memoryReader(graph), readableOf()),
        withColumns: true,
      });

    for (const pairs of graph.columnReads) {
      for (const pair of pairs) {
        expect(READABLE_TABLES.has(pair.upstreamDataAssetId)).toBe(true);
        expect(READABLE_TABLES.has(pair.downstreamDataAssetId)).toBe(true);
      }
    }

    expect(JSON.stringify(lineage)).not.toContain("ssn");
    expectNothingSecret(lineage);
  });
});

describe("drawing more, for a caller limited to some tables", () => {
  function request(
    fields: Partial<DataLineageExpandRequest> = {},
  ): DataLineageExpandRequest {
    return {
      focusNodeId: getLineageTableNodeId(ORDERS),
      nodeId: getLineageTableNodeId(STAGING),
      side: DataLineageSide.Upstream,
      tables: [
        { dataAssetId: ORDERS, side: DataLineageSide.Focus, depth: 0 },
        { dataAssetId: STAGING, side: DataLineageSide.Upstream, depth: -1 },
      ],
      dataDashboardIds: [],
      ...fields,
    };
  }

  test("a drawing about a table or pipeline they may not read, or a card of one pressed, is not theirs: nothing is found", async () => {
    for (const asked of [
      request({ focusNodeId: getLineageTableNodeId(SALARIES) }),
      request({ focusNodeId: getLineagePipelineNodeId(PAYROLL_SYNC) }),
      request({ nodeId: getLineageTableNodeId(HEADCOUNT) }),
      request({ nodeId: "dashboard:nothing" }),
    ]) {
      expect(
        await DataTableLineageReader.keepReadableRequest(asked, readableOf()),
      ).toBeNull();
    }
  });

  test("a table of HR's named as drawn is never placed: no arrow is drawn to it", async () => {
    const kept: DataLineageExpandRequest | null =
      await DataTableLineageReader.keepReadableRequest(
        request({
          tables: [
            { dataAssetId: ORDERS, side: DataLineageSide.Focus, depth: 0 },
            {
              dataAssetId: STAGING,
              side: DataLineageSide.Upstream,
              depth: -1,
            },
            {
              dataAssetId: SALARIES,
              side: DataLineageSide.Upstream,
              depth: -1,
            },
          ],
        }),
        readableOf(),
      );

    expect(
      kept?.tables.map((drawn: { dataAssetId: string }): string => {
        return drawn.dataAssetId;
      }),
    ).toEqual([ORDERS, STAGING]);
  });

  test("the next tables drawn are theirs, and the count left on the card counts theirs alone", async () => {
    const graph: MemoryGraph = warehouse();

    feeds(graph, PAYROLL_RAW, STAGING);

    const expansion: DataLineageExpansion | null =
      await DataTableLineageReader.buildExpansion({
        request: request(),
        now: NOW,
        reader: scopeDataLineageReader(memoryReader(graph), readableOf()),
      });

    expect(
      expansion!.nodes.map((node: DataTableLineageNode): string => {
        return node.id;
      }),
    ).toEqual([getLineageTableNodeId(RAW)]);
    expect(expansion!.hiddenCount).toBe(0);
    expectNothingSecret(expansion);
  });
});

// A data alert reader in memory: every alert theirs to see.
function alertsOf(rows: Array<DataAlertLineageRow>): DataAlertRowReader {
  const byId: Map<string, DataAlertLineageRow> = new Map(
    rows.map((row: DataAlertLineageRow): [string, DataAlertLineageRow] => {
      return [row.alertId, row];
    }),
  );

  return {
    readAlert: async (alertId: string) => {
      return byId.get(alertId) || null;
    },
    readSubject: async (alertId: string) => {
      return byId.get(alertId) || null;
    },
    readConsequences: async (data: { alertId: string; limit: number }) => {
      const found: Array<DataAlertLineageRow> = rows.filter(
        (row: DataAlertLineageRow): boolean => {
          return row.causeAlertId === data.alertId;
        },
      );

      return { rows: found.slice(0, data.limit), total: found.length };
    },
    readCheckColumn: async () => {
      return null;
    },
  };
}

function alertRow(
  index: number,
  about: { table?: string; pipeline?: string },
  causeIndex: number | null = null,
): DataAlertLineageRow {
  return {
    alertId: uuid(4, index),
    dataAssetId: about.table || null,
    dataPipelineId: about.pipeline || null,
    dataStoreId: null,
    causeAlertId: causeIndex === null ? null : uuid(4, causeIndex),
  };
}

describe("a data alert's drawing, for a caller limited to some tables", () => {
  test("a cause they may see the alert of, on HR's tables: no way goes through HR's, nothing of them is drawn, and the drawing walks no further for it", async () => {
    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.build({
        alertId: uuid(4, 0),
        now: NOW,
        alerts: alertsOf([
          alertRow(0, { table: ORDERS }, 1),
          alertRow(1, { table: PAYROLL_RAW }),
        ]),
        reader: scopeDataLineageReader(memoryReader(warehouse()), readableOf()),
      });

    expect(answer?.hasCause).toBe(true);
    expect(answer?.isCauseDrawn).toBe(false);
    expect(answer?.lineage?.depth).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
    expect(answer?.lineage?.highlight).toBeUndefined();
    expectNothingSecret(answer);
  });

  test("an alert about a table they may not read draws nothing", async () => {
    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.build({
        alertId: uuid(4, 0),
        now: NOW,
        alerts: alertsOf([alertRow(0, { table: SALARIES })]),
        reader: scopeDataLineageReader(memoryReader(warehouse()), readableOf()),
      });

    expect(answer?.lineage).toBeNull();
    expectNothingSecret(answer);
  });

  test("an alert it caused on a pipeline they may not read is neither picked out nor said to be a consequence", async () => {
    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.build({
        alertId: uuid(4, 0),
        now: NOW,
        alerts: alertsOf([
          alertRow(0, { table: RAW }),
          alertRow(5, { pipeline: PAYROLL_SYNC }, 0),
        ]),
        reader: scopeDataLineageReader(memoryReader(warehouse()), readableOf()),
      });

    expect(answer?.consequenceCount).toBe(1);
    expect(answer?.drawnConsequenceCount).toBe(0);
    expect(answer?.lineage?.highlight).toBeUndefined();
    expectNothingSecret(answer?.lineage);
  });
});

describe("the lineage told in words, for a caller limited to some tables", () => {
  test("names none of HR's tables or pipelines, and counts none of them as lying further", async () => {
    const text: string = formatDataTableLineageAnswer(
      buildDataTableLineageAnswer(await scopedDrawing(warehouse(), ORDERS, 1)),
      NOW,
    );

    for (const secret of SECRET_NAMES) {
      expect(text).not.toContain(secret);
    }

    // raw.orders, past staging, is theirs: the one table further up.
    expect(text).toContain(
      "More lineage lies past what is told: 1 more table further up",
    );
    expect(text).not.toContain("further down");
  });
});

describe("the lineage map, for a caller limited to some tables", () => {
  function mapRows(graph: MemoryGraph): {
    flows: DataLineageMapFlowReader;
    lineage: Array<DataLineageMapLineageRow>;
    usages: Array<DataLineageMapUsageRow>;
  } {
    const lineage: Array<DataLineageMapLineageRow> = graph.edges.map(
      (row: DataLineageMapLineageRow): DataLineageMapLineageRow => {
        return { ...row };
      },
    );
    const usages: Array<DataLineageMapUsageRow> = [
      {
        dataAssetId: ORDERS,
        serviceId: null,
        serviceName: "checkout",
        accessKind: DataAssetAccessKind.Write,
        operations: ["INSERT"],
        lastSeenAt: NOW,
      },
      {
        dataAssetId: SALARIES,
        serviceId: null,
        serviceName: "payroll-service",
        accessKind: DataAssetAccessKind.Write,
        operations: ["UPDATE"],
        lastSeenAt: NOW,
      },
    ];

    return {
      lineage,
      usages,
      flows: {
        readLineage: async (limit: number) => {
          return lineage.slice(0, limit);
        },
        readUsages: async (limit: number) => {
          return usages.slice(0, limit);
        },
      },
    };
  }

  test("holds their flows alone: no HR table, pipeline, dashboard or service that touches only HR's", async () => {
    const graph: MemoryGraph = warehouse();
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: mapRows(graph).flows,
      details: scopeDataLineageReader(memoryReader(graph), readableOf()),
      readable: readableOf(),
      now: NOW,
    });

    expect(
      map.nodes
        .map((node: { name: string }): string => {
          return node.name;
        })
        .sort(),
    ).toEqual(
      [
        "checkout",
        "Exec Summary",
        "marts.revenue",
        "public.orders",
        "raw.orders",
        "Revenue",
        "staging.orders",
      ].sort(),
    );

    // raw -> staging names their pipeline alone.
    const arrow: { pipelines: Array<{ name: string }> } | undefined =
      map.edges.find((edge: { id: string }): boolean => {
        return (
          edge.id ===
          `Feeds:${getLineageTableNodeId(RAW)}>${getLineageTableNodeId(STAGING)}`
        );
      });

    expect(
      arrow?.pipelines.map((entry: { name: string }): string => {
        return entry.name;
      }),
    ).toEqual(["orders_etl"]);
    expectNothingSecret(map);
  });

  test("counts only their tables among those it leaves out", async () => {
    const graph: MemoryGraph = warehouse();
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: mapRows(graph).flows,
      details: scopeDataLineageReader(memoryReader(graph), readableOf()),
      readable: readableOf(),
      now: NOW,
      // Room for one flow's two cards.
      maxNodes: 2,
    });

    // Of their five tables with flows, the one flow drawn holds two at most: the rest are theirs, counted.
    const drawnTables: number = map.nodes.filter(
      (node: { kind: string }): boolean => {
        return node.kind === "Table";
      },
    ).length;

    expect(map.isTruncated).toBe(true);
    expect(drawnTables + (map.hiddenTableCount || 0)).toBe(4);
    expectNothingSecret(map);
  });

  test("a caller the scope narrows nothing for sees HR's too, as the map always drew them", async () => {
    const graph: MemoryGraph = warehouse();
    const map: DataLineageMap = await DataLineageMapReader.build({
      flows: mapRows(graph).flows,
      details: memoryReader(graph),
      now: NOW,
    });

    expect(JSON.stringify(map)).toContain("public.salaries");
    expect(JSON.stringify(map)).toContain("payroll_sync");
  });
});

/*
 * The readers' own doors - what the routes and OneUptime AI's tools call -
 * each work out the caller's scope and read through it: the database's
 * rows stand in for the warehouse here, and the scope for the caller's
 * grants.
 */
describe("every lineage reader reads with its caller's scope", () => {
  const MEMBER: DatabaseCommonInteractionProps = {
    tenantId: PROJECT,
    userId: new ObjectID("55555555-5555-4555-8555-000000000001"),
    userType: UserType.User,
  };
  const OWNED: ReturnType<typeof QueryHelper.any> = QueryHelper.any([
    ...READABLE_TABLES,
  ]);
  const NARROWED: DataObservabilityScope = {
    isWholeProject: false,
    assetQuery: { projectId: PROJECT, _id: OWNED },
    checkQuery: { projectId: PROJECT, dataAssetId: OWNED },
    pipelineQuery: {
      projectId: PROJECT,
      _id: QueryHelper.any([...READABLE_PIPELINES]),
    },
  };

  function stubDatabase(
    graph: MemoryGraph,
    scope: DataObservabilityScope,
  ): ReturnType<typeof jest.spyOn> {
    jest
      .spyOn(DataTableLineageReader, "getDatabaseReader")
      .mockReturnValue(memoryReader(graph));
    jest
      .spyOn(DataObservabilityReadScope, "getReadableIds")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
        ids: Array<string>;
      }) => {
        const allowed: Set<string> =
          data.query === scope.pipelineQuery
            ? READABLE_PIPELINES
            : READABLE_TABLES;

        return new Set(
          data.ids.filter((id: string): boolean => {
            return allowed.has(id);
          }),
        );
      }) as never);

    return jest
      .spyOn(DataObservabilityReadScope, "get")
      .mockResolvedValue(scope as never);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a table's drawing: its caller's scope, worked out from their props", async () => {
    const get: ReturnType<typeof jest.spyOn> = stubDatabase(
      warehouse(),
      NARROWED,
    );
    const lineage: DataTableLineage | null = await DataTableLineageReader.read({
      projectId: PROJECT,
      dataAssetId: new ObjectID(ORDERS),
      depth: 3,
      now: NOW,
      reader: MEMBER,
    });

    expect(get).toHaveBeenCalledWith(PROJECT, MEMBER);
    expect(lineage).not.toBeNull();
    expectNothingSecret(lineage);
    expect(
      await DataTableLineageReader.read({
        projectId: PROJECT,
        dataAssetId: new ObjectID(SALARIES),
        depth: 3,
        now: NOW,
        reader: MEMBER,
      }),
    ).toBeNull();
  });

  test("a pipeline's drawing, and drawing more", async () => {
    const graph: MemoryGraph = warehouse();

    runs(graph, ORDERS_ETL, { reads: [RAW, PAYROLL_RAW], writes: [STAGING] });
    stubDatabase(graph, NARROWED);

    expectNothingSecret(
      await DataTableLineageReader.readPipeline({
        projectId: PROJECT,
        dataPipelineId: new ObjectID(ORDERS_ETL),
        depth: 2,
        now: NOW,
        reader: MEMBER,
        withColumns: true,
      }),
    );
    expect(
      await DataTableLineageReader.readPipeline({
        projectId: PROJECT,
        dataPipelineId: new ObjectID(PAYROLL_SYNC),
        depth: 1,
        now: NOW,
        reader: MEMBER,
      }),
    ).toBeNull();

    const expansion: DataLineageExpansion | null =
      await DataTableLineageReader.expand({
        projectId: PROJECT,
        request: {
          focusNodeId: getLineageTableNodeId(ORDERS),
          nodeId: getLineageTableNodeId(ORDERS),
          side: DataLineageSide.Upstream,
          tables: [
            { dataAssetId: ORDERS, side: DataLineageSide.Focus, depth: 0 },
            {
              dataAssetId: SALARIES,
              side: DataLineageSide.Upstream,
              depth: -1,
            },
          ],
          dataDashboardIds: [],
        },
        now: NOW,
        reader: MEMBER,
      });

    expect(
      expansion!.nodes.map((node: DataTableLineageNode): string => {
        return node.id;
      }),
    ).toEqual([getLineageTableNodeId(STAGING)]);
    expectNothingSecret(expansion);
    expect(
      await DataTableLineageReader.expand({
        projectId: PROJECT,
        request: {
          focusNodeId: getLineageTableNodeId(SALARIES),
          nodeId: getLineageTableNodeId(SALARIES),
          side: DataLineageSide.Upstream,
          tables: [
            { dataAssetId: SALARIES, side: DataLineageSide.Focus, depth: 0 },
          ],
          dataDashboardIds: [],
        },
        now: NOW,
        reader: MEMBER,
      }),
    ).toBeNull();
  });

  test("an alert's drawing", async () => {
    stubDatabase(warehouse(), NARROWED);
    jest
      .spyOn(DataAlertLineageReader, "getDatabaseAlertReader")
      .mockReturnValue(
        alertsOf([
          alertRow(0, { table: ORDERS }),
          alertRow(1, { table: SALARIES }),
        ]),
      );

    const own: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.read({
        projectId: PROJECT,
        alertId: new ObjectID(uuid(4, 0)),
        now: NOW,
        reader: MEMBER,
      });
    const hr: DataAlertLineageAnswer | null = await DataAlertLineageReader.read(
      {
        projectId: PROJECT,
        alertId: new ObjectID(uuid(4, 1)),
        now: NOW,
        reader: MEMBER,
      },
    );

    expect(own?.lineage).not.toBeNull();
    expectNothingSecret(own);
    expect(hr?.lineage).toBeNull();
  });

  test("a caller the scope narrows nothing for reads the database's rows as they are", async () => {
    const graph: MemoryGraph = warehouse();
    const base: DataPipelineLineageReader = memoryReader(graph);

    jest
      .spyOn(DataTableLineageReader, "getDatabaseReader")
      .mockReturnValue(base);
    jest
      .spyOn(DataObservabilityReadScope, "get")
      .mockResolvedValue(
        DataObservabilityReadScope.wholeProject(PROJECT) as never,
      );

    expect(
      await DataTableLineageReader.getScopedDatabaseReader(PROJECT, MEMBER),
    ).toBe(base);
  });
});
