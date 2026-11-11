import { describe, expect, test } from "@jest/globals";
import DataAlertLineageReader, {
  DataAlertLineageRow,
  DataAlertRowReader,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataTableLineageReader from "../../../../Server/Utils/DataObservability/DataTableLineage";
import { MAX_COLUMN_MAPPINGS_PER_EDGE } from "../../../../Types/DataObservability/DataColumnLineage";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
  DataLineageEdgeKind,
  DataTableLineage,
  DataTableLineageEdge,
  MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  LineageColumnTrail,
  followLineageColumn,
} from "../../../../Types/DataObservability/DataLineageColumnTrail";
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
 * A DATA ALERT FROM A CHECK ON ONE COLUMN: ITS LINEAGE WITH ITS ARROWS'
 * COLUMNS (#6783).
 *
 * Many data checks read one column - a null rate, a distinct count on
 * orders.customer_id - and when one alerts, the first question is which
 * columns feed that column. So the alert's lineage is read with the
 * columns each arrow carries, as a table's Lineage tab reads it
 * (withColumns), capped the same way - an arrow's own pairs to the most
 * one arrow holds, and the answer's to the most one answer carries, the
 * arrows nearest the table first - and says which column the check reads
 * (column), so the diagram opens with that column followed. An alert from
 * a check on the whole table, an alert on a pipeline or about a whole
 * database, and an alert its reader may not see read no columns at all.
 *
 * The lineage and the alerts are held in memory (LineageMemoryGraph);
 * DataAlertLineageDatabase.test.ts reads the check's column from the
 * database, and through the route.
 */

const FOCUS: string = t(0);

// An alert's id.
function a(index: number): string {
  return uuid(4, index);
}

interface MemoryAlerts {
  rows: Map<string, DataAlertLineageRow>;
  hidden: Set<string>;
  // By alert, the column its check reads.
  columns: Map<string, string>;
  // Every alert whose check's column was asked for.
  columnReads: Array<string>;
}

function newAlerts(): MemoryAlerts {
  return {
    rows: new Map(),
    hidden: new Set(),
    columns: new Map(),
    columnReads: [],
  };
}

function alertOn(
  alerts: MemoryAlerts,
  id: string,
  about: { table?: string; pipeline?: string; store?: boolean },
  fields: { causeAlertId?: string; column?: string } = {},
): void {
  alerts.rows.set(id, {
    alertId: id,
    dataAssetId: about.table || null,
    dataPipelineId: about.pipeline || null,
    dataStoreId: about.store ? uuid(5, 1) : null,
    causeAlertId: fields.causeAlertId || null,
  });

  if (fields.column) {
    alerts.columns.set(id, fields.column);
  }
}

function alertReader(alerts: MemoryAlerts): DataAlertRowReader {
  const isSeen: (id: string) => boolean = (id: string): boolean => {
    return alerts.rows.has(id) && !alerts.hidden.has(id);
  };

  return {
    readAlert: async (alertId: string): Promise<DataAlertLineageRow | null> => {
      const row: DataAlertLineageRow | undefined = alerts.rows.get(alertId);

      if (
        !row ||
        !isSeen(alertId) ||
        (row.causeAlertId && !isSeen(row.causeAlertId))
      ) {
        return null;
      }

      return row;
    },
    readSubject: async (
      alertId: string,
    ): Promise<DataAlertLineageRow | null> => {
      return isSeen(alertId) ? alerts.rows.get(alertId)! : null;
    },
    readConsequences: async (data: {
      alertId: string;
      limit: number;
    }): Promise<{ rows: Array<DataAlertLineageRow>; total: number }> => {
      const rows: Array<DataAlertLineageRow> = Array.from(
        alerts.rows.values(),
      ).filter((row: DataAlertLineageRow): boolean => {
        return row.causeAlertId === data.alertId && isSeen(row.alertId);
      });

      return { rows: rows.slice(0, data.limit), total: rows.length };
    },
    readCheckColumn: async (alertId: string): Promise<string | null> => {
      alerts.columnReads.push(alertId);

      return alerts.columns.get(alertId) || null;
    },
  };
}

async function answerFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string = a(0),
): Promise<DataAlertLineageAnswer | null> {
  return await DataAlertLineageReader.build({
    alertId,
    now: NOW,
    alerts: alertReader(alerts),
    reader: memoryReader(graph),
  });
}

async function drawingFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
): Promise<{ answer: DataAlertLineageAnswer; lineage: DataTableLineage }> {
  const answer: DataAlertLineageAnswer | null = await answerFor(graph, alerts);

  expect(answer?.lineage).toBeTruthy();

  return { answer: answer!, lineage: answer!.lineage! };
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

function carried(lineage: DataTableLineage): number {
  return lineage.edges.reduce(
    (sum: number, edge: DataTableLineageEdge): number => {
      return sum + (edge.columnMappings?.length || 0);
    },
    0,
  );
}

function manyPairs(count: number, prefix: string): Array<[string, string]> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return [`${prefix}_in_${index}`, `${prefix}_out_${index}`] as [
      string,
      string,
    ];
  });
}

/*
 * raw.orders -> staging.orders -> FOCUS (analytics.orders) -> mart.revenue
 * -> report.revenue: staging renames CUSTOMER cust_id, FOCUS cust_id
 * customer_id; the last arrow names no columns.
 */
function warehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  table(graph, FOCUS, { assetKey: "analytics.orders" });
  table(graph, t(1), { assetKey: "staging.orders" });
  table(graph, t(2), { assetKey: "raw.orders" });
  table(graph, t(3), { assetKey: "mart.revenue" });
  table(graph, t(4), { assetKey: "report.revenue" });
  feeds(graph, t(2), t(1));
  feeds(graph, t(1), FOCUS);
  feeds(graph, FOCUS, t(3));
  feeds(graph, t(3), t(4));
  columns(graph, t(2), t(1), [
    ["ID", "id"],
    ["CUSTOMER", "cust_id"],
  ]);
  columns(graph, t(1), FOCUS, [
    ["id", "order_id"],
    ["cust_id", "customer_id"],
  ]);
  columns(graph, FOCUS, t(3), [
    ["customer_id", "customer_id"],
    ["amount", "revenue"],
  ]);

  return graph;
}

describe("an alert from a check on one column", () => {
  test("is drawn with the columns each arrow carries, as the table's Lineage tab draws them, and names the column", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "customer_id" });

    const { answer, lineage } = await drawingFor(graph, alerts);
    const withColumns: DataTableLineage | null =
      await DataTableLineageReader.build({
        focusDataAssetId: FOCUS,
        depth: DEFAULT_DATA_LINEAGE_DEPTH,
        now: NOW,
        reader: memoryReader(warehouse()),
        withColumns: true,
      });

    expect(answer.column).toBe("customer_id");
    expect(lineage).toEqual(withColumns);
    expect(arrow(lineage, t(1), FOCUS).columnMappings).toEqual([
      { upstreamColumn: "cust_id", downstreamColumn: "customer_id" },
      { upstreamColumn: "id", downstreamColumn: "order_id" },
    ]);
    expect(arrow(lineage, t(2), t(1)).columnMappings).toHaveLength(2);
    // An arrow its sources named no columns on says nothing of them.
    expect(arrow(lineage, t(3), t(4)).columnMappings).toBeUndefined();
    expect(alerts.columnReads).toEqual([a(0)]);
  });

  test("the column it names is the one the diagram follows: up through each rename, and down", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "customer_id" });

    const { answer, lineage } = await drawingFor(graph, alerts);
    const trail: LineageColumnTrail = followLineageColumn(
      lineage,
      answer.column!,
    );

    expect(Object.fromEntries(trail.columns)).toEqual({
      [getLineageTableNodeId(FOCUS)]: ["customer_id"],
      [getLineageTableNodeId(t(1))]: ["cust_id"],
      [getLineageTableNodeId(t(2))]: ["CUSTOMER"],
      [getLineageTableNodeId(t(3))]: ["customer_id"],
    });
    // mart.revenue -> report.revenue names no columns: it may go further.
    expect(trail.mayGoFurther).toBe(true);
  });

  test("its cause and what it caused stay picked out, with the columns of every arrow", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: t(2) });
    alertOn(
      alerts,
      a(0),
      { table: FOCUS },
      { causeAlertId: a(1), column: "customer_id" },
    );
    alertOn(alerts, a(2), { table: t(3) }, { causeAlertId: a(0) });

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({
      hasCause: true,
      isCauseDrawn: true,
      consequenceCount: 1,
      drawnConsequenceCount: 1,
      column: "customer_id",
    });
    expect(lineage.highlight?.causeNodeIds).toEqual([
      getLineageTableNodeId(t(2)),
    ]);
    expect(lineage.highlight?.consequenceNodeIds).toEqual([
      getLineageTableNodeId(t(3)),
    ]);
    expect(arrow(lineage, t(2), t(1)).columnMappings).toHaveLength(2);
    // Only its own column is asked for: never the cause's, nor what it caused.
    expect(alerts.columnReads).toEqual([a(0)]);
  });

  test("a column its table's arrows do not name is still named: the diagram has nothing to follow", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "discount" });

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.column).toBe("discount");
    expect(carried(lineage)).toBeGreaterThan(0);
    expect(
      Array.from(followLineageColumn(lineage, "discount").columns.keys()),
    ).toEqual([getLineageTableNodeId(FOCUS)]);
  });
});

describe("any other alert draws as before", () => {
  test("a check on the whole table: no arrow carries columns, and none is read", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS });

    const { answer, lineage } = await drawingFor(graph, alerts);
    const plain: DataTableLineage | null = await DataTableLineageReader.build({
      focusDataAssetId: FOCUS,
      depth: DEFAULT_DATA_LINEAGE_DEPTH,
      now: NOW,
      reader: memoryReader(warehouse()),
    });

    expect(answer.column).toBeNull();
    expect(lineage).toEqual(plain);
    expect(carried(lineage)).toBe(0);
    expect(graph.columnReads).toEqual([]);
    // Asked, and it reads none.
    expect(alerts.columnReads).toEqual([a(0)]);
  });

  test("an alert on a pipeline never asks for a check's column, and reads no columns", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    pipeline(graph, p(0), { jobName: "orders_etl" });
    runs(graph, p(0), { reads: [t(1)], writes: [FOCUS] });
    // A column set against it would be ignored: a pipeline's alert is no check's.
    alertOn(alerts, a(0), { pipeline: p(0) }, { column: "customer_id" });

    const answer: DataAlertLineageAnswer | null = await answerFor(
      graph,
      alerts,
    );

    expect(answer?.lineage).toBeTruthy();
    expect(answer!.column).toBeNull();
    expect(alerts.columnReads).toEqual([]);
    expect(graph.columnReads).toEqual([]);
  });

  test("an alert about a whole database never asks", async () => {
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { store: true }, { column: "customer_id" });

    expect(await answerFor(warehouse(), alerts)).toMatchObject({
      lineage: null,
      column: null,
    });
    expect(alerts.columnReads).toEqual([]);
  });

  test("an alert its reader may not see, or one caused by an alert they may not see, asks nothing", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "customer_id" });
    alertOn(alerts, a(1), { table: t(2) });
    alertOn(
      alerts,
      a(2),
      { table: FOCUS },
      { causeAlertId: a(1), column: "customer_id" },
    );
    alerts.hidden.add(a(0));
    alerts.hidden.add(a(1));

    expect(await answerFor(graph, alerts, a(0))).toBeNull();
    expect(await answerFor(graph, alerts, a(2))).toBeNull();
    expect(alerts.columnReads).toEqual([]);
    expect(graph.columnReads).toEqual([]);
    expect(graph.edgeReads).toEqual([]);
  });

  test("an alert on a table the project no longer has: nothing drawn, no column named", async () => {
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: t(9) }, { column: "customer_id" });

    expect(await answerFor(warehouse(), alerts)).toMatchObject({
      lineage: null,
      column: null,
    });
  });
});

describe("capped as a table's drawing is", () => {
  /*
   * FOCUS built from ten tables, each built from ten more, and feeding ten:
   * twenty arrows touch FOCUS, a hundred more are a step further out.
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

  test("the most pairs one answer carries, the arrows nearest the table first; past them none, and nothing read", async () => {
    const graph: MemoryGraph = wide();

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

    columns(graph, uuid(13, 101), uuid(11, 1), [["id", "id"]]);

    expect(20 * MAX_COLUMN_MAPPINGS_PER_EDGE).toBe(
      MAX_DATA_LINEAGE_COLUMN_MAPPINGS,
    );

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "u1_out_0" });

    const { lineage } = await drawingFor(graph, alerts);

    expect(carried(lineage)).toBe(MAX_DATA_LINEAGE_COLUMN_MAPPINGS);

    for (let near: number = 1; near <= 10; near++) {
      expect(arrow(lineage, uuid(11, near), FOCUS).columnMappings).toHaveLength(
        MAX_COLUMN_MAPPINGS_PER_EDGE,
      );
    }

    expect(
      arrow(lineage, uuid(13, 101), uuid(11, 1)).columnMappings,
    ).toBeUndefined();
    // Read once: the hundred nearest arrows, and no more.
    expect(graph.columnReads).toHaveLength(1);
  });

  test("an arrow's own pairs to the most one arrow holds, however many sources name", async () => {
    const graph: MemoryGraph = warehouse();

    columns(graph, t(1), FOCUS, manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, "a"));
    columns(graph, t(1), FOCUS, manyPairs(MAX_COLUMN_MAPPINGS_PER_EDGE, "b"));

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "customer_id" });

    const { lineage } = await drawingFor(graph, alerts);

    expect(arrow(lineage, t(1), FOCUS).columnMappings).toHaveLength(
      MAX_COLUMN_MAPPINGS_PER_EDGE,
    );
  });

  test("only arrows between two tables carry columns: a pipeline's and a dashboard's never do", async () => {
    const graph: MemoryGraph = warehouse();
    pipeline(graph, p(1), { jobName: "fivetran_orders" });
    runs(graph, p(1), { reads: [], writes: [t(2)] });

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: FOCUS }, { column: "customer_id" });

    const { lineage } = await drawingFor(graph, alerts);

    for (const edge of lineage.edges) {
      if (edge.kind !== DataLineageEdgeKind.Feeds) {
        expect(edge.columnMappings).toBeUndefined();
      }
    }

    expect(carried(lineage)).toBeGreaterThan(0);
  });
});
