import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AlertService from "../../../../Server/Services/AlertService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetFeedService from "../../../../Server/Services/DataAssetFeedService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetUsageService from "../../../../Server/Services/DataAssetUsageService";
import DataPipelineRunService from "../../../../Server/Services/DataPipelineRunService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import {
  MAX_DATA_ALERT_COLUMNS_TOLD_PER_TABLE,
  MAX_DATA_ALERT_COLUMN_NAME_LENGTH,
  MAX_DATA_ALERT_COLUMN_TABLES_TOLD,
  MAX_DATA_ALERT_COLUMN_TABLE_NAME_LENGTH,
  describeDataAlertColumn,
} from "../../../../Server/Utils/DataObservability/DataAlertColumnLineage";
import DataAlertContext from "../../../../Server/Utils/DataObservability/DataAlertContext";
import DataAlertLineageReader, {
  DataAlertLineageRow,
  DataAlertRowReader,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataTableAnswerer from "../../../../Server/Utils/DataObservability/DataTableAnswer";
import DataTableLineageReader, {
  DataLineageTableRow,
  DataPipelineLineageReader,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import { describeDataAlertLineage } from "../../../../Server/Utils/DataObservability/DataTableLineageAnswer";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import {
  DataAlertLineageAnswer,
  DataLineageSide,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_NEIGHBORS,
} from "../../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../../Types/ObjectID";
import {
  HOUR,
  MemoryGraph,
  NOW,
  columns,
  feeds,
  lateTable,
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
 * WHAT AN INVESTIGATION OF A DATA ALERT IS TOLD OF ITS LINEAGE.
 *
 * An investigation reads the alert's lineage as its page draws it
 * (DataAlertLineage) - the table's, or the pipeline's - told problems
 * first (describeDataAlertLineage): what it is built from and what is
 * built from it, where in that chain the alert it is a consequence of is,
 * and which tables the alerts it caused are on. Its report goes where
 * everyone who may see the alert reads it, so every other alert in it is
 * one nobody in particular may see: a private one is neither counted nor
 * placed. The alert itself is the one investigated, read as OneUptime.
 * An alert from a check on one column is then told where that column
 * comes from and where it goes, table by table (describeDataAlertColumn).
 *
 * The lineage and the alerts are held in memory (LineageMemoryGraph); the
 * context's other reads are stubbed to nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// An alert's id.
function a(index: number): string {
  return uuid(4, index);
}

interface MemoryAlerts {
  rows: Map<string, DataAlertLineageRow>;
  // The private alerts: nobody in particular may see them.
  hidden: Set<string>;
  // By alert: the column its check reads, for an alert from a check on one column.
  columns: Map<string, string>;
  // Every read, in order: "alert:<id>", "subject:<id>", "consequences:<id>", "column:<id>".
  reads: Array<string>;
}

function newAlerts(): MemoryAlerts {
  return { rows: new Map(), hidden: new Set(), columns: new Map(), reads: [] };
}

function alertOn(
  alerts: MemoryAlerts,
  id: string,
  about: { table?: number; pipeline?: number },
  causeAlertId: string | null = null,
): DataAlertLineageRow {
  const row: DataAlertLineageRow = {
    alertId: id,
    dataAssetId: about.table === undefined ? null : t(about.table),
    dataPipelineId: about.pipeline === undefined ? null : p(about.pipeline),
    dataStoreId: null,
    causeAlertId,
  };

  alerts.rows.set(id, row);

  return row;
}

// The alerts as the database reads them for nobody in particular: none that is private.
function alertReader(alerts: MemoryAlerts): DataAlertRowReader {
  const isSeen: (id: string) => boolean = (id: string): boolean => {
    return alerts.rows.has(id) && !alerts.hidden.has(id);
  };

  return {
    readAlert: async (alertId: string): Promise<DataAlertLineageRow | null> => {
      alerts.reads.push(`alert:${alertId}`);

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
      alerts.reads.push(`subject:${alertId}`);

      return isSeen(alertId) ? alerts.rows.get(alertId)! : null;
    },
    readConsequences: async (data: {
      alertId: string;
      limit: number;
    }): Promise<{ rows: Array<DataAlertLineageRow>; total: number }> => {
      alerts.reads.push(`consequences:${data.alertId}`);

      const rows: Array<DataAlertLineageRow> = Array.from(
        alerts.rows.values(),
      ).filter((row: DataAlertLineageRow): boolean => {
        return (
          row.causeAlertId === data.alertId &&
          isSeen(row.alertId) &&
          isSeen(data.alertId)
        );
      });

      return { rows: rows.slice(0, data.limit), total: rows.length };
    },
    readCheckColumn: async (alertId: string): Promise<string | null> => {
      alerts.reads.push(`column:${alertId}`);

      return alerts.columns.get(alertId) || null;
    },
  };
}

/*
 * raw.orders (loaded by fivetran_orders, which failed) -> staging.orders
 * -[dbt_build]-> analytics.daily_revenue -> marts.revenue -> marts.kpis.
 */
function warehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  lateTable(graph, t(1), { assetKey: "analytics.daily_revenue" });
  table(graph, t(2), { assetKey: "staging.orders" });
  lateTable(graph, t(3), { assetKey: "raw.orders" });
  table(graph, t(5), { assetKey: "marts.revenue" });
  table(graph, t(6), { assetKey: "marts.kpis" });
  pipeline(graph, p(1), { jobName: "dbt_build", lastRunState: "FAIL" });
  pipeline(graph, p(2), {
    jobName: "fivetran_orders",
    lastRunState: "FAIL",
    lastRunStartedAt: new Date(NOW.getTime() - 5 * HOUR),
    lastErrorMessage: "Connection refused",
  });
  runs(graph, p(1), { reads: [t(2)], writes: [t(1)] });
  feeds(graph, t(3), t(2));
  writes(graph, p(2), t(3));
  feeds(graph, t(1), t(5));
  feeds(graph, t(5), t(6));

  return graph;
}

async function answerFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string,
): Promise<DataAlertLineageAnswer> {
  const answer: DataAlertLineageAnswer | null =
    await DataAlertLineageReader.build({
      alertId,
      now: NOW,
      alerts: alertReader(alerts),
      reader: memoryReader(graph),
    });

  expect(answer).not.toBeNull();

  return answer!;
}

async function linesFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string,
): Promise<Array<string>> {
  return describeDataAlertLineage(await answerFor(graph, alerts, alertId), NOW);
}

// What an investigation is told of the column the alert's check reads.
async function columnLinesFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string,
): Promise<Array<string>> {
  return describeDataAlertColumn(await answerFor(graph, alerts, alertId));
}

/*
 * The warehouse, with the columns its sources name: raw.orders.cust_id ->
 * staging.orders.customer_id -[dbt_build]-> analytics.daily_revenue
 * .customer_id -> marts.revenue.buyer_id -> marts.kpis.buyers, and the
 * amounts beside them.
 */
function warehouseWithColumns(): MemoryGraph {
  const graph: MemoryGraph = warehouse();

  columns(graph, t(3), t(2), [
    ["cust_id", "customer_id"],
    ["amount", "amount"],
  ]);
  columns(graph, t(2), t(1), [
    ["customer_id", "customer_id"],
    ["amount", "revenue"],
  ]);
  columns(graph, t(1), t(5), [
    ["customer_id", "buyer_id"],
    ["revenue", "revenue"],
  ]);
  columns(graph, t(5), t(6), [["buyer_id", "buyers"]]);

  return graph;
}

describe("an alert's lineage, as an investigation is told it", () => {
  test("the lineage around its table, where its cause is, and the tables of the alerts it caused", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: 3 });
    alertOn(alerts, a(1), { table: 1 }, a(0));
    alertOn(alerts, a(2), { table: 5 }, a(1));
    alertOn(alerts, a(3), { table: 6 }, a(1));

    expect(await linesFor(graph, alerts, a(1))).toEqual([
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
      "  Upstream, what it is built from: 2 tables, 1 with a problem.",
      "  - raw.orders, 2 steps up, through staging.orders: late by 22 hours; the pipeline fivetran_orders that loads it failed its last run 5 hours ago: Connection refused.",
      "  The rest, nearest first: staging.orders (1 step up, fresh).",
      "  Loaded from outside what OneUptime watches by: the pipeline fivetran_orders into raw.orders (last run failed 5 hours ago).",
      "  Downstream, what is built from it: 2 tables, none with a problem.",
      "  Nearest first: marts.revenue (1 step down, fresh), marts.kpis (2 steps down, fresh).",
      "- The alert this one is a consequence of is on raw.orders, 2 steps up, through staging.orders: start there.",
      "- 2 alerts were raised as a consequence of this one, on: marts.revenue, 1 step down; marts.kpis, 2 steps down, through marts.revenue.",
    ]);
  });

  test("a private alert it caused is neither counted nor placed", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alertOn(alerts, a(2), { table: 5 }, a(1));
    alertOn(alerts, a(3), { table: 6 }, a(1));
    alerts.hidden.add(a(3));

    const lines: Array<string> = await linesFor(graph, alerts, a(1));

    expect(lines[lines.length - 1]).toBe(
      "- 1 alert was raised as a consequence of this one, on: marts.revenue, 1 step down.",
    );
    expect(lines.join("\n")).not.toContain("marts.kpis, 2 steps down");
  });

  test("a private cause is not placed", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: 3 });
    const own: DataAlertLineageRow = alertOn(alerts, a(1), { table: 1 }, a(0));
    alerts.hidden.add(a(0));

    // As the investigation reads it: the alert itself is given, its cause read as nobody's.
    const reader: DataAlertRowReader = alertReader(alerts);
    const answer: DataAlertLineageAnswer | null =
      await DataAlertLineageReader.build({
        alertId: a(1),
        now: NOW,
        alerts: {
          ...reader,
          readAlert: async (): Promise<DataAlertLineageRow | null> => {
            return own;
          },
        },
        reader: memoryReader(graph),
      });
    const lines: Array<string> = describeDataAlertLineage(answer!, NOW);

    expect(answer!.hasCause).toBe(true);
    expect(answer!.isCauseDrawn).toBe(false);
    expect(lines.join("\n")).not.toContain("consequence of is on");
    // The lineage itself is still told.
    expect(lines[0]).toBe(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
  });

  test("a cause on the pipeline loading a table from outside: that pipeline, and what it loads", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 2 });
    alertOn(alerts, a(1), { table: 1 }, a(0));

    expect(await linesFor(graph, alerts, a(1))).toContain(
      "- The alert this one is a consequence of is on the pipeline fivetran_orders, which loads raw.orders: start there.",
    );
  });

  test("a cause on the pipeline moving data into the table: that pipeline, and what it builds", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 1 });
    alertOn(alerts, a(1), { table: 1 }, a(0));

    expect(await linesFor(graph, alerts, a(1))).toContain(
      "- The alert this one is a consequence of is on the pipeline dbt_build, which builds analytics.daily_revenue: start there.",
    );
  });

  /*
   * An alert it caused on a pipeline that moves data between two tables
   * built from it is picked out on that pipeline's arrows, as a cause on
   * one is: it is placed there - not left out of the places, so that the
   * count would read as if every alert it caused were on the tables named.
   */
  test("an alert it caused on a pipeline between two tables built from it is placed on that pipeline, with what it builds", async () => {
    const graph: MemoryGraph = warehouse();
    pipeline(graph, p(3), { jobName: "dbt_marts" });
    runs(graph, p(3), { reads: [t(1)], writes: [t(5)] });

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alertOn(alerts, a(2), { pipeline: 3 }, a(1));

    const alone: Array<string> = await linesFor(graph, alerts, a(1));

    expect(alone[alone.length - 1]).toBe(
      "- 1 alert was raised as a consequence of this one, on: the pipeline dbt_marts, which builds marts.revenue.",
    );

    // With one on a table too: the tables first, then the pipelines.
    alertOn(alerts, a(3), { table: 6 }, a(1));

    const both: Array<string> = await linesFor(graph, alerts, a(1));

    expect(both[both.length - 1]).toBe(
      "- 2 alerts were raised as a consequence of this one, on: marts.kpis, 2 steps down, through marts.revenue; the pipeline dbt_marts, which builds marts.revenue.",
    );
  });

  /*
   * A cause on a pipeline is picked out on its arrows too. When that
   * pipeline also moves data along a way picked out down to an alert it
   * caused, it is still the cause: never told as one of the alerts this
   * one caused.
   */
  test("a cause on a pipeline that also moves data down a picked-out way is told as the cause only", async () => {
    const graph: MemoryGraph = warehouse();
    // dbt_build builds analytics.daily_revenue, and marts.revenue from it.
    runs(graph, p(1), { reads: [t(1)], writes: [t(5)] });

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 1 });
    alertOn(alerts, a(1), { table: 1 }, a(0));
    alertOn(alerts, a(3), { table: 6 }, a(1));

    const lines: Array<string> = await linesFor(graph, alerts, a(1));

    expect(lines).toContain(
      "- The alert this one is a consequence of is on the pipeline dbt_build, which builds analytics.daily_revenue: start there.",
    );
    expect(lines[lines.length - 1]).toBe(
      "- 1 alert was raised as a consequence of this one, on: marts.kpis, 2 steps down, through marts.revenue.",
    );
  });

  test("an alert it caused further down than the lineage reaches is counted, not placed", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 0; index <= 7; index++) {
      table(graph, t(index), { assetKey: `chain.t${index}` });

      if (index > 0) {
        feeds(graph, t(index - 1), t(index));
      }
    }

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(1), { table: 7 }, a(0));
    alertOn(alerts, a(2), { table: 1 }, a(0));

    const lines: Array<string> = await linesFor(graph, alerts, a(0));

    expect(lines[lines.length - 1]).toBe(
      "- 2 alerts were raised as a consequence of this one, on: chain.t1, 1 step down. The rest are further down than this lineage reaches.",
    );

    alerts.rows.delete(a(2));

    const alone: Array<string> = await linesFor(graph, alerts, a(0));

    expect(alone[alone.length - 1]).toBe(
      "- 1 alert was raised as a consequence of this one, further down than this lineage reaches.",
    );
  });

  test("an alert it caused on a table past the few the context tells is still placed, with its way", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });

    // Six tables a step down, and one two steps down through the first.
    for (let index: number = 1; index <= 6; index++) {
      table(graph, t(10 + index), { assetKey: `a.d${index}` });
      feeds(graph, t(0), t(10 + index));
    }

    table(graph, t(20), { assetKey: "z.far" });
    feeds(graph, t(11), t(20));

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(1), { table: 20 }, a(0));

    const lines: Array<string> = await linesFor(graph, alerts, a(0));

    // The context tells the five nearest; the rest are counted.
    expect(lines).toContain(
      "  Nearest first: a.d1 (1 step down, fresh), a.d2 (1 step down, fresh), a.d3 (1 step down, fresh), a.d4 (1 step down, fresh), a.d5 (1 step down, fresh) and 2 more.",
    );
    // z.far is not one of them, and the alert on it is still placed, the way to it too.
    expect(lines[lines.length - 1]).toBe(
      "- 1 alert was raised as a consequence of this one, on: z.far, 2 steps down, through a.d1.",
    );
  });

  test("a cause on a pipeline loading many tables names a few of them, problems first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });
    // Its last run went through: an alert on how long it took, say.
    pipeline(graph, p(1), { jobName: "fivetran_all" });

    for (let index: number = 1; index <= 8; index++) {
      const name: string = `raw.t${index}`;

      if (index === 8) {
        lateTable(graph, t(index), { assetKey: name });
      } else {
        table(graph, t(index), { assetKey: name });
      }

      feeds(graph, t(index), t(0));
      writes(graph, p(1), t(index));
    }

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 1 });
    alertOn(alerts, a(1), { table: 0 }, a(0));

    expect(await linesFor(graph, alerts, a(1))).toContain(
      "- The alert this one is a consequence of is on the pipeline fivetran_all, which loads raw.t8, raw.t1, raw.t2, raw.t3, raw.t4 and 3 more tables: start there.",
    );
  });

  test("an alert on a pipeline: the tables it reads, and the tables it writes", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { pipeline: 1 });

    const lines: Array<string> = await linesFor(graph, alerts, a(1));

    expect(lines[0]).toBe(
      "- The pipeline's lineage (the tables it reads, and the tables it writes and what is built from them), 1 step each way:",
    );
    expect(lines).toContain(
      "  Upstream, what it reads: 1 table, none with a problem.",
    );
    expect(lines).toContain(
      "  Downstream, what it writes and what is built from that: 1 table, 1 with a problem.",
    );
    expect(lines).toContain(
      "  - analytics.daily_revenue (Warehouse), 1 step down: late by 22 hours.",
    );
  });

  test("an alert about a whole database: nothing to tell", async () => {
    const graph: MemoryGraph = warehouse();
    const alerts: MemoryAlerts = newAlerts();
    alerts.rows.set(a(1), {
      alertId: a(1),
      dataAssetId: null,
      dataPipelineId: null,
      dataStoreId: uuid(5, 1),
      causeAlertId: null,
    });

    expect(await linesFor(graph, alerts, a(1))).toEqual([]);
  });
});

describe("the column a column check's alert reads, as an investigation is told it", () => {
  test("where it comes from and where it goes, table by table, nearest first, after the lineage", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage, as the lineage's sources name its columns:",
      "  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, 2 steps up.",
      "  Where it goes: buyer_id of marts.revenue, 1 step down; buyers of marts.kpis, 2 steps down.",
    ]);
    // The lineage's own lines are told as for any table's alert.
    expect((await linesFor(graph, alerts, a(1)))[0]).toBe(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
    // The alert's check was asked, and the drawing read with its arrows' columns.
    expect(alerts.reads).toContain(`column:${a(1)}`);
    expect(graph.columnReads.length).toBeGreaterThan(0);
  });

  test("the column as its check names it, matched whatever its case", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "CUSTOMER_ID");

    const lines: Array<string> = await columnLinesFor(graph, alerts, a(1));

    expect(lines[0]).toBe(
      "- The check behind this alert reads the column CUSTOMER_ID. Followed up and down its lineage, as the lineage's sources name its columns:",
    );
    expect(lines[1]).toBe(
      "  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, 2 steps up.",
    );
  });

  test("another of the table's columns: only its own way, and no other column named", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "revenue");

    const lines: Array<string> = await columnLinesFor(graph, alerts, a(1));

    expect(lines).toEqual([
      "- The check behind this alert reads the column revenue. Followed up and down its lineage, as the lineage's sources name its columns:",
      "  Where it comes from: amount of staging.orders, 1 step up; amount of raw.orders, 2 steps up.",
      "  Where it goes: revenue of marts.revenue, 1 step down.",
    ]);
    expect(lines.join("\n")).not.toContain("customer_id");
    expect(lines.join("\n")).not.toContain("marts.kpis");
  });

  test("an arrow on its way that names no columns: told the column may go further", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    // marts.kpis is fed by marts.revenue, its source naming no columns.
    graph.columnRows = graph.columnRows.filter(
      (row: { downstreamDataAssetId: string }): boolean => {
        return row.downstreamDataAssetId !== t(6);
      },
    );

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage, as the lineage's sources name its columns:",
      "  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, 2 steps up.",
      "  Where it goes: buyer_id of marts.revenue, 1 step down.",
      "  Some arrows on its way do not say which columns they carry, so it may come from or go further than this.",
    ]);
  });

  test("built only one way: the other way is not told", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    graph.columnRows = graph.columnRows.filter(
      (row: { upstreamDataAssetId: string }): boolean => {
        return (
          row.upstreamDataAssetId !== t(1) && row.upstreamDataAssetId !== t(5)
        );
      },
    );
    // What it feeds is named, without the column: it goes nowhere told.
    columns(graph, t(1), t(5), [["revenue", "revenue"]]);
    columns(graph, t(5), t(6), [["revenue", "total"]]);

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage, as the lineage's sources name its columns:",
      "  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, 2 steps up.",
    ]);
  });

  test("a column no source names: one line, and whether an arrow next to its table says nothing of its columns", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "status");

    // Every arrow next to it names its columns, none of them this one.
    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column status: no lineage source names the columns it is built from or the columns built from it.",
    ]);

    // An arrow into its table that names none: it may come along that one.
    graph.columnRows = graph.columnRows.filter(
      (row: { downstreamDataAssetId: string }): boolean => {
        return row.downstreamDataAssetId !== t(1);
      },
    );

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column status: no lineage source names the columns it is built from or the columns built from it, and some arrows into or out of its table do not say which columns they carry.",
    ]);
  });

  test("a table with no lineage at all: told the same, in one line", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.lonely" });

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 0 });
    alerts.columns.set(a(1), "customer_id");

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column customer_id: no lineage source names the columns it is built from or the columns built from it.",
    ]);
  });

  test("a check on the whole table: nothing of a column told, and its lineage read without columns", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([]);
    expect(graph.columnReads).toEqual([]);
    // The lineage is told as before.
    expect((await linesFor(graph, alerts, a(1)))[0]).toBe(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
  });

  test("a pipeline's alert: its check is never asked, and nothing of a column told", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { pipeline: 1 });
    alerts.columns.set(a(1), "customer_id");

    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([]);
    expect(alerts.reads).not.toContain(`column:${a(1)}`);
    expect(graph.columnReads).toEqual([]);
  });

  test("a table in another database is named with it", async () => {
    const graph: MemoryGraph = warehouseWithColumns();
    graph.tables.get(t(3))!.database = "Lake";

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");

    expect((await columnLinesFor(graph, alerts, a(1)))[1]).toBe(
      "  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, in Lake, 2 steps up.",
    );
  });

  test("the five nearest tables each way, the rest counted; five columns on one table, the rest counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });

    // Seven tables a step up, each with the column under its own name.
    for (let index: number = 1; index <= 7; index++) {
      table(graph, t(10 + index), { assetKey: `raw.u${index}` });
      feeds(graph, t(10 + index), t(0));
      columns(graph, t(10 + index), t(0), [[`id_${index}`, "customer_id"]]);
    }

    // One table a step down built from it seven times over.
    table(graph, t(30), { assetKey: "marts.wide" });
    feeds(graph, t(0), t(30));
    columns(
      graph,
      t(0),
      t(30),
      [1, 2, 3, 4, 5, 6, 7].map((index: number): [string, string] => {
        return ["customer_id", `c${index}`];
      }),
    );

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 0 });
    alerts.columns.set(a(1), "customer_id");

    expect(MAX_DATA_ALERT_COLUMN_TABLES_TOLD).toBe(5);
    expect(MAX_DATA_ALERT_COLUMNS_TOLD_PER_TABLE).toBe(5);
    expect(await columnLinesFor(graph, alerts, a(1))).toEqual([
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage, as the lineage's sources name its columns:",
      "  Where it comes from: id_1 of raw.u1, 1 step up; id_2 of raw.u2, 1 step up; id_3 of raw.u3, 1 step up; id_4 of raw.u4, 1 step up; id_5 of raw.u5, 1 step up; and 2 more tables further up.",
      "  Where it goes: c1, c2, c3, c4, c5 and 2 more columns of marts.wide, 1 step down.",
    ]);
  });

  test("a long column or table name is cut short, never the line's sense", async () => {
    const graph: MemoryGraph = newGraph();
    const longTable: string = `raw.${"t".repeat(400)}`;
    const longColumn: string = "c".repeat(240);

    table(graph, t(0), { assetKey: "public.orders" });
    table(graph, t(1), { assetKey: longTable });
    feeds(graph, t(1), t(0));
    columns(graph, t(1), t(0), [[longColumn, "customer_id"]]);

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 0 });
    alerts.columns.set(a(1), "customer_id");

    const lines: Array<string> = await columnLinesFor(graph, alerts, a(1));
    const clippedColumn: string = `${"c".repeat(MAX_DATA_ALERT_COLUMN_NAME_LENGTH - 1)}…`;

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`Where it comes from: ${clippedColumn} of raw.`);
    expect(lines[1]).not.toContain(
      "c".repeat(MAX_DATA_ALERT_COLUMN_NAME_LENGTH),
    );
    expect(lines[1]).toMatch(/…, 1 step up\.$/);

    const tableTold: string = lines[1]!.slice(
      lines[1]!.indexOf(" of ") + 4,
      lines[1]!.indexOf(", 1 step up"),
    );

    expect(tableTold.length).toBeLessThanOrEqual(
      MAX_DATA_ALERT_COLUMN_TABLE_NAME_LENGTH,
    );
    expect(tableTold.endsWith("…")).toBe(true);
  });

  test("however wide the lineage, the column's lines stay a few: a few kilobytes at most", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });

    // Eight long columns of one table, each the column under another long name.
    const eight: (name: string) => Array<string> = (
      name: string,
    ): Array<string> => {
      return [1, 2, 3, 4, 5, 6, 7, 8].map((column: number): string => {
        return `${name.repeat(230)}${column}`;
      });
    };

    /*
     * As many tables a step each way as a drawing holds, each built from
     * as many more a step further: every one with eight columns that are
     * the column, under the longest names a source may give.
     */
    for (let index: number = 1; index <= MAX_DATA_LINEAGE_NEIGHBORS; index++) {
      const up: string = t(100 + index);
      const down: string = t(200 + index);

      table(graph, up, {
        assetKey: `raw.${"u".repeat(300)}${index}`,
        database: "Lake",
      });
      table(graph, down, {
        assetKey: `marts.${"d".repeat(300)}${index}`,
        database: "Mart",
      });
      feeds(graph, up, t(0));
      feeds(graph, t(0), down);
      columns(
        graph,
        up,
        t(0),
        eight("x").map((column: string): [string, string] => {
          return [column, "customer_id"];
        }),
      );
      columns(
        graph,
        t(0),
        down,
        eight("y").map((column: string): [string, string] => {
          return ["customer_id", column];
        }),
      );

      for (
        let further: number = 1;
        further <= MAX_DATA_LINEAGE_NEIGHBORS;
        further++
      ) {
        const upAgain: string = t(1000 + index * 100 + further);
        const downAgain: string = t(5000 + index * 100 + further);

        table(graph, upAgain, { assetKey: `raw.second_${index}_${further}` });
        table(graph, downAgain, {
          assetKey: `marts.second_${index}_${further}`,
        });
        feeds(graph, upAgain, up);
        feeds(graph, down, downAgain);
        columns(
          graph,
          upAgain,
          up,
          eight("x").map((column: string): [string, string] => {
            return [`source_${column}`, column];
          }),
        );
        columns(
          graph,
          down,
          downAgain,
          eight("y").map((column: string): [string, string] => {
            return [column, `built_${column}`];
          }),
        );
      }
    }

    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 0 });
    alerts.columns.set(a(1), "customer_id");

    const answer: DataAlertLineageAnswer = await answerFor(graph, alerts, a(1));
    const drawn: (side: DataLineageSide) => number = (
      side: DataLineageSide,
    ): number => {
      return answer.lineage!.nodes.filter(
        (node: DataTableLineageNode): boolean => {
          return node.side === side;
        },
      ).length;
    };
    const lines: Array<string> = describeDataAlertColumn(answer);
    const told: string = lines.join("\n");

    // Every table drawn each way is on the column's way: dozens of them.
    expect(drawn(DataLineageSide.Upstream)).toBeGreaterThan(30);
    expect(drawn(DataLineageSide.Downstream)).toBeGreaterThan(30);
    expect(lines).toHaveLength(3);
    // The nearest five each way told, the rest counted.
    expect(lines[1]).toContain(
      `; and ${drawn(DataLineageSide.Upstream) - MAX_DATA_ALERT_COLUMN_TABLES_TOLD} more tables further up.`,
    );
    expect(lines[2]).toContain(
      `; and ${drawn(DataLineageSide.Downstream) - MAX_DATA_ALERT_COLUMN_TABLES_TOLD} more tables further down.`,
    );
    expect(told).not.toContain("raw.second_");
    expect(told).not.toContain("marts.second_");
    // Five columns of each told table, the rest of its eight counted.
    expect((told.match(/ and 3 more columns of /g) || []).length).toBe(
      2 * MAX_DATA_ALERT_COLUMN_TABLES_TOLD,
    );
    expect(Buffer.byteLength(told, "utf8")).toBeLessThan(12 * 1024);
  });
});

describe("an investigation's context section", () => {
  let graph: MemoryGraph;
  let alerts: MemoryAlerts;
  let dataAlert: DataAlert;
  let alertReaderFor: ReturnType<typeof jest.spyOn>;
  let lineageReaderFor: ReturnType<typeof jest.spyOn>;

  function stubDataAlert(about: {
    table?: number;
    pipeline?: number;
    causeAlertId?: string;
  }): void {
    dataAlert = new DataAlert();

    if (about.table !== undefined) {
      dataAlert.dataAssetId = new ObjectID(t(about.table));
    }

    if (about.pipeline !== undefined) {
      dataAlert.dataPipelineId = new ObjectID(p(about.pipeline));
    }

    if (about.causeAlertId) {
      dataAlert.causeAlertId = new ObjectID(about.causeAlertId);
    }
  }

  beforeEach(() => {
    jest.restoreAllMocks();

    graph = warehouse();
    alerts = newAlerts();

    jest.spyOn(DataAlertService, "findOneBy").mockImplementation((async () => {
      return dataAlert;
    }) as never);
    jest.spyOn(AlertService, "findOneBy").mockImplementation((async (findBy: {
      query: { _id: ObjectID };
    }): Promise<Alert> => {
      const alert: Alert = new Alert();
      alert._id = findBy.query._id.toString();
      alert.createdAt = new Date(NOW.getTime() - HOUR);
      alert.title = "orders load failed";
      alert.alertNumberWithPrefix = "ALT-9";
      alert.isPrivate = alerts.hidden.has(findBy.query._id.toString());

      return alert;
    }) as never);
    jest.spyOn(DataTableAnswerer, "answer").mockResolvedValue(null as never);
    jest
      .spyOn(DataAssetLineageService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(DataAssetUsageService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(DataAssetFeedService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(DataPipelineService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: { _id: ObjectID };
      }): Promise<DataPipeline> => {
        const row: DataPipeline = new DataPipeline();
        row._id = findBy.query._id.toString();

        const jobName: string | undefined = graph.pipelines.get(
          findBy.query._id.toString(),
        )?.jobName;

        if (jobName) {
          row.jobName = jobName;
        }

        return row;
      }) as never);
    jest.spyOn(DataPipelineRunService, "findBy").mockResolvedValue([] as never);

    alertReaderFor = jest
      .spyOn(DataAlertLineageReader, "getDatabaseAlertReader")
      .mockImplementation(((): DataAlertRowReader => {
        return alertReader(alerts);
      }) as never);
    lineageReaderFor = jest
      .spyOn(DataTableLineageReader, "getDatabaseReader")
      .mockImplementation(((): DataPipelineLineageReader => {
        return memoryReader(graph);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function sectionFor(alertId: string): Promise<string> {
    return await DataAlertContext.buildContextSection({
      projectId: PROJECT_ID,
      alertId: new ObjectID(alertId),
      now: NOW,
    });
  }

  test("a table's alert: its lineage told in place of one step of upstream tables, for nobody in particular", async () => {
    alertOn(alerts, a(0), { table: 3 });
    alertOn(alerts, a(1), { table: 1 }, a(0));
    stubDataAlert({ table: 1, causeAlertId: a(0) });

    const section: string = await sectionFor(a(1));

    expect(section).toContain(
      '- This alert is a consequence of ALT-9 "orders load failed", opened 1 hour ago',
    );
    expect(section).toContain(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:\n  Upstream, what it is built from: 2 tables, 1 with a problem.",
    );
    expect(section).toContain(
      "- The alert this one is a consequence of is on raw.orders, 2 steps up, through staging.orders: start there.",
    );
    expect(section).not.toContain("Tables this table is built from (lineage):");

    // Read for nobody in particular, never as the investigation's own root props.
    expect(alertReaderFor).toHaveBeenCalledWith(PROJECT_ID, null);
    expect(lineageReaderFor).toHaveBeenCalledWith(PROJECT_ID, null);
    // The alert itself is the one investigated: never read again through a privacy clause.
    expect(alerts.reads).not.toContain(`alert:${a(1)}`);
    expect(alerts.reads).toContain(`subject:${a(0)}`);
  });

  test("a private alert under investigation is still told its lineage: its report's readers may see it", async () => {
    alertOn(alerts, a(1), { table: 1 });
    alertOn(alerts, a(2), { table: 5 }, a(1));
    alerts.hidden.add(a(1));
    stubDataAlert({ table: 1 });

    const section: string = await sectionFor(a(1));

    expect(section).toContain(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
    // What it caused is read as nobody's, so the alerts a private alert caused are not counted.
    expect(section).not.toContain("raised as a consequence of this one");
  });

  test("a pipeline's alert: its runs, then the tables it reads and writes", async () => {
    alertOn(alerts, a(1), { pipeline: 1 });
    stubDataAlert({ pipeline: 1 });

    const section: string = await sectionFor(a(1));
    const runs: number = section.indexOf(
      "- The pipeline dbt_build writes this table",
    );
    const lineage: number = section.indexOf("- The pipeline's lineage");

    expect(runs).toBeGreaterThan(-1);
    expect(lineage).toBeGreaterThan(runs);
  });

  test("a whole database's alert reads no lineage", async () => {
    stubDataAlert({});

    const section: string = await sectionFor(a(1));

    expect(section).toContain("## Data Observability: this is a data alert");
    expect(section).not.toContain("lineage");
    expect(alertReaderFor).not.toHaveBeenCalled();
    expect(lineageReaderFor).not.toHaveBeenCalled();
  });

  test("a column check's alert: where its column comes from and goes, after its lineage, read for nobody in particular", async () => {
    graph = warehouseWithColumns();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");
    stubDataAlert({ table: 1 });

    const section: string = await sectionFor(a(1));
    const lineage: number = section.indexOf(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
    const column: number = section.indexOf(
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage, as the lineage's sources name its columns:\n  Where it comes from: customer_id of staging.orders, 1 step up; cust_id of raw.orders, 2 steps up.\n  Where it goes: buyer_id of marts.revenue, 1 step down; buyers of marts.kpis, 2 steps down.",
    );

    expect(lineage).toBeGreaterThan(-1);
    expect(column).toBeGreaterThan(lineage);
    // Its check read through the reader for nobody in particular, the drawing with its arrows' columns.
    expect(alertReaderFor).toHaveBeenCalledWith(PROJECT_ID, null);
    expect(alerts.reads).toContain(`column:${a(1)}`);
    expect(graph.columnReads.length).toBeGreaterThan(0);
  });

  test("a private column check's alert under investigation is still told its column: its report's readers may see it", async () => {
    graph = warehouseWithColumns();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");
    alerts.hidden.add(a(1));
    stubDataAlert({ table: 1 });

    expect(await sectionFor(a(1))).toContain(
      "- The check behind this alert reads the column customer_id. Followed up and down its lineage",
    );
  });

  test("a table check's alert: no column told, and its lineage read without columns", async () => {
    graph = warehouseWithColumns();
    alertOn(alerts, a(1), { table: 1 });
    stubDataAlert({ table: 1 });

    const section: string = await sectionFor(a(1));

    expect(section).toContain("- Its lineage (the tables it is built from");
    expect(section).not.toContain("The check behind this alert");
    expect(alerts.reads).toContain(`column:${a(1)}`);
    expect(graph.columnReads).toEqual([]);
  });

  test("a check that cannot be read leaves only the column out: the lineage is still told", async () => {
    graph = warehouseWithColumns();
    alertOn(alerts, a(1), { table: 1 });
    alerts.columns.set(a(1), "customer_id");
    stubDataAlert({ table: 1 });

    alertReaderFor.mockImplementation(((): DataAlertRowReader => {
      return {
        ...alertReader(alerts),
        readCheckColumn: async (): Promise<string | null> => {
          throw new Error("the database is away");
        },
      };
    }) as never);

    const section: string = await sectionFor(a(1));

    expect(section).toContain(
      "- Its lineage (the tables it is built from, and the tables built from it), 3 steps each way:",
    );
    expect(section).not.toContain("The check behind this alert");
    expect(graph.columnReads).toEqual([]);
  });

  test("a lineage that cannot be read leaves only itself out", async () => {
    alertOn(alerts, a(1), { table: 1 });
    stubDataAlert({ table: 1 });

    lineageReaderFor.mockImplementation(((): DataPipelineLineageReader => {
      return {
        ...memoryReader(graph),
        readTables: async (): Promise<Array<DataLineageTableRow>> => {
          throw new Error("the database is away");
        },
      };
    }) as never);

    const section: string = await sectionFor(a(1));

    expect(section).toContain("## Data Observability: this is a data alert");
    expect(section).not.toContain("Its lineage");
  });
});
