import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DataColumnMapping,
  MAX_COLUMN_MAPPINGS_PER_EDGE,
} from "../../../../Types/DataObservability/DataColumnLineage";
import {
  LineageColumnTrail,
  doesLineageArrowCarryColumns,
  followLineageColumn,
  getLineageColumnChoices,
} from "../../../../Types/DataObservability/DataLineageColumnTrail";
import {
  DataLineageEdgeKind,
  DataTableLineage,
  DataTableLineageEdge,
  MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  MemoryGraph,
  NOW,
  columns,
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
} from "./LineageMemoryGraph";

/*
 * FOLLOWING A COLUMN ACROSS A PIPELINE (#6854).
 *
 * A pipeline's page draws the tables it reads on the left and the tables
 * it writes on the right, its card between them, with no arrow between
 * the tables themselves. Asked for with its columns, its runs' column
 * lineage is carried on its own arrows: each arrow out of it maps the
 * columns it wrote to that table, each into itself, and each arrow into it
 * maps the columns it read to the columns it wrote them to - so its card
 * stands for the columns it writes, a column picked there is followed both
 * ways across it, and on along the arrows between tables as on a table's
 * drawing. Only its own runs' rows say what it moved; another source's
 * columns between the same tables are not its. The picker offers its
 * columns in the order of the first table it writes them to.
 */

const ETL: string = p(1);
const RAW: string = t(1);
const CRM: string = t(2);
const ORDERS: string = t(3);
const CUSTOMERS: string = t(4);
const SOURCE: string = t(5);
const MART: string = t(6);

const ETL_CARD: string = getLineagePipelineNodeId(ETL);

function card(id: string): string {
  return getLineageTableNodeId(id);
}

/*
 * orders_etl reads raw.orders and crm.accounts, and writes public.orders
 * and public.customers. Its runs name raw.cust_id -> orders.customer_id,
 * raw.amount -> orders.total and raw.cust_id -> customers.id; crm's
 * columns are never named. raw.orders is built from source.orders, and
 * public.orders feeds marts.revenue, both arrows naming their columns.
 */
function etlWarehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  table(graph, RAW, { assetKey: "raw.orders" });
  table(graph, CRM, { assetKey: "crm.accounts" });
  table(graph, ORDERS, { assetKey: "public.orders" });
  table(graph, CUSTOMERS, { assetKey: "public.customers" });
  table(graph, SOURCE, { assetKey: "source.orders" });
  table(graph, MART, { assetKey: "marts.revenue" });
  pipeline(graph, ETL, { jobName: "orders_etl" });

  runs(graph, ETL, { reads: [RAW, CRM], writes: [ORDERS, CUSTOMERS] });
  feeds(graph, SOURCE, RAW);
  feeds(graph, ORDERS, MART);

  columns(
    graph,
    RAW,
    ORDERS,
    [
      ["cust_id", "customer_id"],
      ["amount", "total"],
    ],
    ETL,
  );
  columns(graph, RAW, CUSTOMERS, [["cust_id", "id"]], ETL);
  columns(graph, SOURCE, RAW, [["customer", "cust_id"]]);
  columns(graph, ORDERS, MART, [["total", "revenue"]]);
  // Query history saw another column move between raw and orders: not the pipeline's.
  columns(graph, RAW, ORDERS, [["region", "region"]]);

  graph.columnOrders.set(ORDERS, ["order_id", "total", "customer_id"]);
  graph.columnOrders.set(CUSTOMERS, ["id", "name"]);

  return graph;
}

async function drawEtl(
  graph: MemoryGraph,
  depth: number,
  withColumns: boolean | undefined,
): Promise<DataTableLineage> {
  const lineage: DataTableLineage | null =
    await DataTableLineageReader.buildForPipeline({
      focusDataPipelineId: ETL,
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
  source: string,
  target: string,
): DataTableLineageEdge {
  const edge: DataTableLineageEdge | undefined = edgeBetween(
    lineage,
    source,
    target,
  );

  expect(edge).toBeDefined();

  return edge!;
}

describe("a pipeline's drawing asked for with its columns", () => {
  test("each arrow out of it carries the columns it wrote to that table, each into itself", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 1, true);

    expect(arrow(lineage, ETL_CARD, card(ORDERS)).columnMappings).toEqual([
      { upstreamColumn: "customer_id", downstreamColumn: "customer_id" },
      { upstreamColumn: "total", downstreamColumn: "total" },
    ]);
    expect(arrow(lineage, ETL_CARD, card(CUSTOMERS)).columnMappings).toEqual([
      { upstreamColumn: "id", downstreamColumn: "id" },
    ]);
  });

  test("each arrow into it carries the columns it read, into the columns it wrote them to", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 1, true);

    // Every table it writes them to together, each pair once, in the order every arrow keeps them.
    expect(arrow(lineage, card(RAW), ETL_CARD).columnMappings).toEqual([
      { upstreamColumn: "amount", downstreamColumn: "total" },
      { upstreamColumn: "cust_id", downstreamColumn: "customer_id" },
      { upstreamColumn: "cust_id", downstreamColumn: "id" },
    ]);
    // crm.accounts: its runs named none of its columns.
    expect(arrow(lineage, card(CRM), ETL_CARD).columnMappings).toBeUndefined();
  });

  test("only its own runs say what it moved: another source's columns between the same tables are not on its arrows", async () => {
    const graph: MemoryGraph = etlWarehouse();
    const lineage: DataTableLineage = await drawEtl(graph, 1, true);

    expect(JSON.stringify(lineage)).not.toContain("region");
    // Its own arrows' columns were read narrowed to its runs.
    expect(graph.columnReadPipelines[0]).toBe(ETL);
    expect(
      graph.columnReads[0]!.map(
        (pair: {
          upstreamDataAssetId: string;
          downstreamDataAssetId: string;
        }): string => {
          return `${pair.upstreamDataAssetId}>${pair.downstreamDataAssetId}`;
        },
      ).sort(),
    ).toEqual(
      [
        `${RAW}>${ORDERS}`,
        `${RAW}>${CUSTOMERS}`,
        `${CRM}>${ORDERS}`,
        `${CRM}>${CUSTOMERS}`,
      ].sort(),
    );
  });

  test("the arrows between tables beyond it carry their own columns, as on a table's drawing", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 2, true);

    expect(arrow(lineage, card(SOURCE), card(RAW)).columnMappings).toEqual([
      { upstreamColumn: "customer", downstreamColumn: "cust_id" },
    ]);
    expect(arrow(lineage, card(ORDERS), card(MART)).columnMappings).toEqual([
      { upstreamColumn: "total", downstreamColumn: "revenue" },
    ]);
  });

  test("it says the order of the first table it writes columns to, for the picker", async () => {
    const graph: MemoryGraph = etlWarehouse();
    const lineage: DataTableLineage = await drawEtl(graph, 1, true);
    const firstWritten: string | undefined = lineage.nodes.find(
      (node: { kind: string; side: string; depth: number }): boolean => {
        return (
          node.kind === "Table" &&
          node.side === "Downstream" &&
          node.depth === 1
        );
      },
    )?.dataAssetId;

    expect(lineage.columnOrder).toEqual(graph.columnOrders.get(firstWritten!));
    expect(graph.columnOrderReads).toEqual([firstWritten]);
  });

  test("a table it writes no column of is never the one whose order is said", async () => {
    const graph: MemoryGraph = etlWarehouse();

    graph.columnRows = graph.columnRows.filter(
      (row: { downstreamDataAssetId: string }): boolean => {
        return row.downstreamDataAssetId !== ORDERS;
      },
    );

    const lineage: DataTableLineage = await drawEtl(graph, 1, true);

    expect(lineage.columnOrder).toEqual(["id", "name"]);
  });

  test.each([[false], [undefined]])(
    "asked for with columns %p: none read, no arrow carries any, and no order is said",
    async (withColumns: boolean | undefined) => {
      const graph: MemoryGraph = etlWarehouse();
      const lineage: DataTableLineage = await drawEtl(graph, 2, withColumns);

      expect(graph.columnReads).toEqual([]);
      expect(graph.columnOrderReads).toEqual([]);
      expect(lineage.columnOrder).toBeUndefined();

      for (const edge of lineage.edges) {
        expect(edge.columnMappings).toBeUndefined();
      }
    },
  );

  test("its own arrows count towards the most one answer carries: past it, an arrow further out carries none", async () => {
    const graph: MemoryGraph = newGraph();

    pipeline(graph, ETL, { jobName: "wide_etl" });

    const reads: Array<string> = [];
    const writes: Array<string> = [];

    for (let index: number = 0; index < 10; index++) {
      reads.push(uuid(21, index));
      writes.push(uuid(22, index));
      table(graph, uuid(21, index), { assetKey: `raw.read_${index}` });
      table(graph, uuid(22, index), { assetKey: `public.write_${index}` });
    }

    runs(graph, ETL, { reads, writes });

    // Each read and write: fifty columns of each pair, so each arrow of its own holds the most one arrow holds.
    reads.forEach((read: string, i: number): void => {
      writes.forEach((write: string, j: number): void => {
        const pairs: Array<[string, string]> = [];

        for (let k: number = 0; k < 50; k++) {
          pairs.push([`r${i}_w${j}_c${k}`, `w${j}_r${i}_c${k}`]);
        }

        columns(graph, read, write, pairs, ETL);
      });
    });

    // One step further out, one pair: past the most.
    table(graph, uuid(23, 1), { assetKey: "source.far" });
    feeds(graph, uuid(23, 1), reads[0]!);
    columns(graph, uuid(23, 1), reads[0]!, [["id", "id"]]);

    expect(20 * MAX_COLUMN_MAPPINGS_PER_EDGE).toBe(
      MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
    );

    const lineage: DataTableLineage = await drawEtl(graph, 2, true);
    let carried: number = 0;

    for (const edge of lineage.edges) {
      carried += edge.columnMappings?.length || 0;
    }

    for (const read of reads) {
      expect(arrow(lineage, card(read), ETL_CARD).columnMappings).toHaveLength(
        MAX_COLUMN_MAPPINGS_PER_EDGE,
      );
    }

    for (const write of writes) {
      expect(arrow(lineage, ETL_CARD, card(write)).columnMappings).toHaveLength(
        MAX_COLUMN_MAPPINGS_PER_EDGE,
      );
    }

    expect(
      arrow(lineage, card(uuid(23, 1)), card(reads[0]!)).columnMappings,
    ).toBeUndefined();
    expect(carried).toBe(MAX_DATA_LINEAGE_COLUMN_MAPPINGS);
  });
});

describe("following a column across a pipeline (DataLineageColumnTrail)", () => {
  test("its picker offers the columns it writes, in the order of the first table it writes them to, the rest by name", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 1, true);

    expect(getLineageColumnChoices(lineage, lineage.columnOrder || [])).toEqual(
      lineage.columnOrder?.[0] === "order_id"
        ? ["total", "customer_id", "id"]
        : ["id", "customer_id", "total"],
    );
    // Without an order: by name.
    expect(getLineageColumnChoices(lineage)).toEqual([
      "customer_id",
      "id",
      "total",
    ]);
  });

  test("a column it writes is followed down to the table it goes to and up to the column it was built from, and on from there", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 2, true);
    const trail: LineageColumnTrail = followLineageColumn(
      lineage,
      "customer_id",
    );

    expect(trail.columns.get(ETL_CARD)).toEqual(["customer_id"]);
    expect(trail.columns.get(card(ORDERS))).toEqual(["customer_id"]);
    expect(trail.columns.get(card(RAW))).toEqual(["cust_id"]);
    expect(trail.columns.get(card(SOURCE))).toEqual(["customer"]);
    // Not to customers: what it writes there is another column.
    expect(trail.columns.has(card(CUSTOMERS))).toBe(false);
    expect(Array.from(trail.edgeIds).sort()).toEqual(
      [
        arrow(lineage, card(RAW), ETL_CARD).id,
        arrow(lineage, ETL_CARD, card(ORDERS)).id,
        arrow(lineage, card(SOURCE), card(RAW)).id,
      ].sort(),
    );
  });

  test("a table it reads without naming its columns may carry the column: the trail says it may go further", async () => {
    const lineage: DataTableLineage = await drawEtl(etlWarehouse(), 1, true);

    expect(followLineageColumn(lineage, "total").mayGoFurther).toBe(true);
  });

  test("a column two tables it writes share is followed to both", async () => {
    const graph: MemoryGraph = etlWarehouse();

    columns(graph, RAW, CUSTOMERS, [["cust_id", "customer_id"]], ETL);

    const lineage: DataTableLineage = await drawEtl(graph, 1, true);
    const trail: LineageColumnTrail = followLineageColumn(
      lineage,
      "customer_id",
    );

    expect(trail.columns.get(card(ORDERS))).toEqual(["customer_id"]);
    expect(trail.columns.get(card(CUSTOMERS))).toEqual(["customer_id"]);
  });

  test("on a table's drawing, a pipeline's arrows and a dashboard's still carry nothing a column goes along", () => {
    const focus: string = card(ORDERS);
    const reads: DataTableLineageEdge = {
      id: "Reads:x",
      source: focus,
      target: "dashboard:x",
      kind: DataLineageEdgeKind.Reads,
      seenIn: [],
      pipelines: [],
      lastSeenAt: null,
    };
    const writes: DataTableLineageEdge = {
      ...reads,
      id: "Writes:x",
      source: ETL_CARD,
      target: focus,
      kind: DataLineageEdgeKind.Writes,
    };
    const between: DataTableLineageEdge = {
      ...reads,
      id: "Feeds:x",
      source: card(RAW),
      target: focus,
      kind: DataLineageEdgeKind.Feeds,
    };

    expect(doesLineageArrowCarryColumns(reads, focus)).toBe(false);
    expect(doesLineageArrowCarryColumns(writes, focus)).toBe(false);
    expect(doesLineageArrowCarryColumns(between, focus)).toBe(true);
    // On the pipeline's own drawing, its own arrows do; another pipeline's do not.
    expect(
      doesLineageArrowCarryColumns(
        { ...writes, source: ETL_CARD, target: focus },
        ETL_CARD,
      ),
    ).toBe(true);
    expect(
      doesLineageArrowCarryColumns(
        { ...reads, source: focus, target: ETL_CARD },
        ETL_CARD,
      ),
    ).toBe(true);
    expect(
      doesLineageArrowCarryColumns(
        { ...writes, source: getLineagePipelineNodeId(p(2)), target: focus },
        ETL_CARD,
      ),
    ).toBe(false);
  });

  test("the trail's own columns are named as the arrows name them, whatever their case", () => {
    const mappings: Array<DataColumnMapping> = [
      { upstreamColumn: "CUST_ID", downstreamColumn: "Customer_Id" },
    ];
    const lineage: DataTableLineage = {
      focusNodeId: ETL_CARD,
      depth: 1,
      nodes: [],
      edges: [
        {
          id: "Reads:a",
          source: card(RAW),
          target: ETL_CARD,
          kind: DataLineageEdgeKind.Reads,
          seenIn: [],
          pipelines: [],
          lastSeenAt: null,
          columnMappings: mappings,
        },
      ],
      hiddenDashboardCount: 0,
      isTruncated: false,
    };

    expect(getLineageColumnChoices(lineage)).toEqual(["Customer_Id"]);
    expect(
      followLineageColumn(lineage, "customer_id").columns.get(card(RAW)),
    ).toEqual(["CUST_ID"]);
  });
});
