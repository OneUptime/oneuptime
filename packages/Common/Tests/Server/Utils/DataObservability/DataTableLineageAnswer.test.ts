import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DATA_LINEAGE_ANSWER_LIMITS,
  DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL,
  DataLineageAnswerLimits,
  DataLineageAnswerTable,
  DataTableLineageAnswer,
  MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH,
  buildDataTableLineageAnswer,
  describeLineageTableState,
  formatDataTableLineageAnswer,
  formatDataTableLineageReply,
} from "../../../../Server/Utils/DataObservability/DataTableLineageAnswer";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataAssetFreshness } from "../../../../Types/DataObservability/DataAssetFreshness";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_NEIGHBORS,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import {
  HOUR,
  MemoryGraph,
  NOW,
  d,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  p,
  pipeline,
  runs,
  t,
  table,
  writes,
} from "./LineageMemoryGraph";

/*
 * A TABLE'S LINEAGE, TOLD IN WORDS (DataTableLineageAnswer): what Ask AI,
 * Slack, Microsoft Teams and the MCP server answer "what is this table built
 * from, and what is built from it?" with, and what an investigation of a
 * data alert reads of its lineage. These build drawings from tables held in
 * memory (LineageMemoryGraph), as the Lineage tab's walk draws them, and
 * read the answer told from each: problems first, nearest first, with the
 * tables between; the rest; the pipelines loading the upstream tables from
 * outside; the dashboards; and how much lies past what is told.
 */

async function lineageOf(
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

async function answerOf(
  graph: MemoryGraph,
  focus: string,
  depth: number = 3,
  limits: DataLineageAnswerLimits = DATA_LINEAGE_ANSWER_LIMITS,
): Promise<DataTableLineageAnswer> {
  return buildDataTableLineageAnswer(
    await lineageOf(graph, focus, depth),
    limits,
  );
}

async function textOf(
  graph: MemoryGraph,
  focus: string,
  depth: number = 3,
): Promise<string> {
  return formatDataTableLineageAnswer(await answerOf(graph, focus, depth), NOW);
}

function namesOf(tables: Array<DataLineageAnswerTable>): Array<string> {
  return tables.map((table: DataLineageAnswerTable): string => {
    return table.table;
  });
}

/*
 * The revenue warehouse: analytics.daily_revenue is built by dbt from
 * staging.orders, itself built from raw.orders (loaded by a Fivetran sync
 * whose last run failed) and raw.customers; marts.revenue is built from it,
 * and marts.kpis from that. Two dashboards read it and marts.revenue.
 */
function revenueWarehouse(): MemoryGraph {
  const graph: MemoryGraph = newGraph();

  lateTable(graph, t(1), { assetKey: "analytics.daily_revenue" });
  table(graph, t(2), { assetKey: "staging.orders" });
  lateTable(graph, t(3), { assetKey: "raw.orders" });
  table(graph, t(4), { assetKey: "raw.customers" });
  table(graph, t(5), { assetKey: "marts.revenue" });
  table(graph, t(6), { assetKey: "marts.kpis" });

  pipeline(graph, p(1), { jobName: "dbt_build" });
  pipeline(graph, p(2), {
    jobName: "fivetran_orders",
    lastRunState: "FAIL",
    lastRunStartedAt: new Date(NOW.getTime() - 5 * HOUR),
    lastErrorMessage: "Connection refused by host",
  });

  runs(graph, p(1), { reads: [t(2)], writes: [t(1)] });
  feeds(graph, t(3), t(2));
  feeds(graph, t(4), t(2));
  writes(graph, p(2), t(3));
  feeds(graph, t(1), t(5));
  feeds(graph, t(5), t(6));

  graph.openAlerts.set(t(1), 1);
  graph.openAlerts.set(t(6), 2);

  graph.dashboards.push(
    {
      dataDashboardId: d(1),
      name: "Revenue",
      tool: "Looker",
      url: null,
      dataAssetIds: [t(5)],
    },
    {
      dataDashboardId: d(2),
      name: "Finance",
      tool: "Tableau",
      url: null,
      dataAssetIds: [t(1)],
    },
  );

  return graph;
}

describe("a table's lineage, told", () => {
  test("problems first, nearest first, with the tables between; then the rest, the loaders and the dashboards", async () => {
    expect(await textOf(revenueWarehouse(), t(1))).toBe(
      [
        "analytics.daily_revenue (Warehouse): late by 22 hours; 1 open alert. Its lineage, 3 steps each way:",
        "Upstream, what it is built from: 3 tables, 1 with a problem.",
        "- raw.orders, 2 steps up, through staging.orders: late by 22 hours; the pipeline fivetran_orders that loads it failed its last run 5 hours ago: Connection refused by host.",
        "The rest, nearest first: staging.orders (1 step up, fresh), raw.customers (2 steps up, fresh).",
        "Loaded from outside what OneUptime watches by: the pipeline fivetran_orders into raw.orders (last run failed 5 hours ago).",
        "Downstream, what is built from it: 2 tables, 1 with a problem.",
        "- marts.kpis, 2 steps down, through marts.revenue: fresh; 2 open alerts.",
        "The rest, nearest first: marts.revenue (1 step down, fresh).",
        "Dashboards built on it or on tables built from it: Finance (Tableau, reads it), Revenue (Looker, reads marts.revenue).",
      ].join("\n"),
    );
  });

  test("the answer holds what the words say, for a program to read", async () => {
    const answer: DataTableLineageAnswer = await answerOf(
      revenueWarehouse(),
      t(1),
    );

    expect(answer).toMatchObject({
      dataAssetId: t(1),
      dataPipelineId: null,
      name: "analytics.daily_revenue",
      database: "Warehouse",
      depth: 3,
      untoldLoaderCount: 0,
      untoldDashboardCount: 0,
      isTruncated: false,
    });
    expect(answer.self).toEqual({
      dataAssetId: t(1),
      table: "analytics.daily_revenue",
      database: "Warehouse",
      steps: 0,
      through: [],
      freshness: DataAssetFreshness.Late,
      lateBySeconds: 22 * 60 * 60,
      isDropped: false,
      openAlertCount: 1,
      failedPipelines: [],
      failedLoaders: [],
      hasProblem: true,
    });
    expect(answer.upstream).toMatchObject({
      tableCount: 3,
      problemCount: 1,
      untoldProblemCount: 0,
      untoldOtherCount: 0,
      hiddenCount: 0,
    });
    expect(answer.upstream.problems).toEqual([
      {
        dataAssetId: t(3),
        table: "raw.orders",
        database: "Warehouse",
        steps: 2,
        through: ["staging.orders"],
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 22 * 60 * 60,
        isDropped: false,
        openAlertCount: 0,
        failedPipelines: [],
        failedLoaders: [
          {
            name: "fivetran_orders",
            lastRunStartedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
            lastErrorMessage: "Connection refused by host",
          },
        ],
        hasProblem: true,
      },
    ]);
    expect(namesOf(answer.upstream.others)).toEqual([
      "staging.orders",
      "raw.customers",
    ]);
    expect(answer.loaders).toEqual([
      {
        dataPipelineId: p(2),
        name: "fivetran_orders",
        lastRunState: "FAIL",
        lastRunStartedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
        lastErrorMessage: "Connection refused by host",
        tables: ["raw.orders"],
      },
    ]);
    expect(namesOf(answer.downstream.problems)).toEqual(["marts.kpis"]);
    expect(answer.downstream.problems[0]).toMatchObject({
      steps: 2,
      through: ["marts.revenue"],
      openAlertCount: 2,
    });
    expect(namesOf(answer.downstream.others)).toEqual(["marts.revenue"]);
    expect(answer.dashboards).toEqual([
      { name: "Finance", tool: "Tableau", readsTheTable: true, tables: [] },
      {
        name: "Revenue",
        tool: "Looker",
        readsTheTable: false,
        tables: ["marts.revenue"],
      },
    ]);
  });

  test("a table nothing is seen feeding or built from says so on each side", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.lonely" });

    expect(await textOf(graph, t(1))).toBe(
      [
        "public.lonely (Warehouse): fresh. Its lineage, 3 steps each way:",
        "Upstream: no watched table is seen feeding it.",
        "Downstream: no watched table is seen built from it.",
      ].join("\n"),
    );
  });

  test("a side with no problem lists its tables, nearest first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), { assetKey: "raw.orders" });
    table(graph, t(3), { assetKey: "raw.carts" });
    table(graph, t(4), { assetKey: "landing.orders" });
    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(2));

    expect(await textOf(graph, t(1))).toBe(
      [
        "public.orders (Warehouse): fresh. Its lineage, 3 steps each way:",
        "Upstream, what it is built from: 3 tables, none with a problem.",
        "Nearest first: raw.carts (1 step up, fresh), raw.orders (1 step up, fresh), landing.orders (2 steps up, fresh).",
        "Downstream: no watched table is seen built from it.",
      ].join("\n"),
    );
  });

  test("every kind of problem is told, each with what is wrong", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), { assetKey: "raw.dropped", isDropped: true });
    lateTable(graph, t(3), { assetKey: "raw.late" });
    table(graph, t(4), { assetKey: "raw.alerted" });
    table(graph, t(5), { assetKey: "raw.built" });
    table(graph, t(6), { assetKey: "raw.source" });
    table(graph, t(7), { assetKey: "raw.loaded" });
    pipeline(graph, p(1), { jobName: "dbt_raw_built", lastRunState: "FAIL" });
    pipeline(graph, p(2), {
      jobName: "airbyte_loaded",
      lastRunState: "ABORT",
      lastRunStartedAt: new Date(NOW.getTime() - 2 * HOUR),
      lastErrorMessage: null,
    });

    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(1));
    feeds(graph, t(5), t(1));
    feeds(graph, t(7), t(1));
    // raw.built's own pipeline failed, moving data in from raw.source.
    feeds(graph, t(6), t(5), { dataPipelineId: p(1) });
    writes(graph, p(2), t(7));
    graph.openAlerts.set(t(4), 3);

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));

    expect(namesOf(answer.upstream.problems)).toEqual([
      "raw.alerted",
      "raw.built",
      "raw.dropped",
      "raw.late",
      "raw.loaded",
    ]);
    expect(namesOf(answer.upstream.others)).toEqual(["raw.source"]);

    const text: string = formatDataTableLineageAnswer(answer, NOW);

    expect(text).toContain("- raw.alerted, 1 step up: fresh; 3 open alerts.");
    expect(text).toContain(
      "- raw.built, 1 step up: fresh; the pipeline dbt_raw_built that builds it failed its last run.",
    );
    expect(text).toContain(
      "- raw.dropped, 1 step up: dropped from its database.",
    );
    expect(text).toContain("- raw.late, 1 step up: late by 22 hours.");
    expect(text).toContain(
      "- raw.loaded, 1 step up: fresh; the pipeline airbyte_loaded that loads it failed its last run 2 hours ago.",
    );
    expect(text).toContain(
      "Loaded from outside what OneUptime watches by: the pipeline airbyte_loaded into raw.loaded (last run aborted 2 hours ago).",
    );
    expect(text).toContain(
      "Upstream, what it is built from: 6 tables, 5 with a problem.",
    );
  });

  test("a view and a table whose rhythm is not known are no problem, and say so", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), {
      assetKey: "public.orders_view",
      assetKind: DataAssetKind.View,
    });
    table(graph, t(3), {
      assetKey: "raw.new_table",
      updateIntervalInSeconds: null,
    });
    feeds(graph, t(1), t(2));
    feeds(graph, t(3), t(1));

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));

    expect(answer.upstream.problemCount).toBe(0);
    expect(answer.downstream.problemCount).toBe(0);

    const text: string = formatDataTableLineageAnswer(answer, NOW);

    expect(text).toContain(
      "Nearest first: raw.new_table (1 step up, freshness not known yet).",
    );
    expect(text).toContain(
      "Nearest first: public.orders_view (1 step down, a view).",
    );
  });

  test("a table of another database is named with its database; one of the same, without", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders", database: "Warehouse" });
    lateTable(graph, t(2), {
      assetKey: "public.orders",
      database: "Orders DB",
    });
    table(graph, t(3), { assetKey: "staging.orders", database: "Warehouse" });
    table(graph, t(4), { assetKey: "raw.carts", database: "Carts DB" });
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(1));

    const text: string = await textOf(graph, t(1));

    expect(text).toContain(
      "- public.orders (Orders DB), 2 steps up, through staging.orders: late by 22 hours.",
    );
    expect(text).toContain(
      "The rest, nearest first: raw.carts (Carts DB, 1 step up, fresh), staging.orders (1 step up, fresh).",
    );
  });

  test("a pipeline's error is told clipped, on one line, with one full stop", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), { assetKey: "raw.orders" });
    pipeline(graph, p(1), {
      jobName: "loader",
      lastRunState: "FAIL",
      lastErrorMessage: `Load failed.\n${"x".repeat(400)}`,
    });
    pipeline(graph, p(2), {
      jobName: "short_loader",
      lastRunState: "FAIL",
      lastErrorMessage: "Disk full.",
    });
    table(graph, t(3), { assetKey: "raw.carts" });
    feeds(graph, t(2), t(1));
    feeds(graph, t(3), t(1));
    writes(graph, p(1), t(2));
    writes(graph, p(2), t(3));

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));
    const error: string | null =
      answer.loaders.find((loader: { name: string }): boolean => {
        return loader.name === "loader";
      })?.lastErrorMessage || null;

    expect(error).toHaveLength(MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH);
    expect(error!.startsWith("Load failed. xxx")).toBe(true);
    expect(error!.endsWith("…")).toBe(true);
    expect(error).not.toContain("\n");

    const text: string = formatDataTableLineageAnswer(answer, NOW);

    expect(text).toContain(
      "- raw.carts, 1 step up: fresh; the pipeline short_loader that loads it failed its last run 1 hour ago: Disk full.\n",
    );
    expect(text).not.toContain("Disk full..");
    expect(text).toContain("…\n");
  });

  test("the loaders: a failed one first, each with how its latest run went", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });

    const states: Array<[string, string | null]> = [
      ["a_complete", "COMPLETE"],
      ["b_running", "RUNNING"],
      ["c_never_ran", null],
      ["d_rescheduled", "RESCHEDULED"],
      ["z_failed", "FAIL"],
    ];

    states.forEach(([name, state]: [string, string | null], index: number) => {
      table(graph, t(index + 2), { assetKey: `raw.${name}` });
      pipeline(graph, p(index + 1), {
        jobName: name,
        lastRunState: state,
        lastRunStartedAt:
          state === null ? null : new Date(NOW.getTime() - 3 * 60 * 1000),
      });
      feeds(graph, t(index + 2), t(1));
      writes(graph, p(index + 1), t(index + 2));
    });

    const text: string = await textOf(graph, t(1));

    expect(text).toContain(
      "Loaded from outside what OneUptime watches by: the pipeline z_failed into raw.z_failed (last run failed 3 minutes ago), the pipeline a_complete into raw.a_complete (last run complete 3 minutes ago), the pipeline b_running into raw.b_running (running, started 3 minutes ago), the pipeline c_never_ran into raw.c_never_ran (no run seen yet), the pipeline d_rescheduled into raw.d_rescheduled (last run rescheduled 3 minutes ago).",
    );
  });

  test("a pipeline that moves data between two watched tables is told on the table it builds, not as a loader", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), { assetKey: "raw.orders" });
    pipeline(graph, p(1), { jobName: "orders_etl", lastRunState: "FAIL" });
    runs(graph, p(1), { reads: [t(2)], writes: [t(1)] });

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));

    expect(answer.loaders).toEqual([]);
    expect(answer.self?.failedPipelines).toEqual(["orders_etl"]);
    expect(answer.self?.hasProblem).toBe(true);
    expect(formatDataTableLineageAnswer(answer, NOW).split("\n")[0]).toBe(
      "public.orders (Warehouse): fresh; the pipeline orders_etl that builds it failed its last run. Its lineage, 3 steps each way:",
    );
  });
});

describe("how much one answer tells", () => {
  // The table, with tables a step up of which the first `late` are late.
  function wideGraph(count: number, late: number): MemoryGraph {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });

    for (let index: number = 1; index <= count; index++) {
      const name: string = `raw.t${index.toString().padStart(2, "0")}`;

      if (index <= late) {
        lateTable(graph, t(index), { assetKey: name });
      } else {
        table(graph, t(index), { assetKey: name });
      }

      feeds(graph, t(index), t(0));
    }

    return graph;
  }

  test("past the most told each way, the rest are counted", async () => {
    const answer: DataTableLineageAnswer = await answerOf(
      wideGraph(8, 5),
      t(0),
      3,
      { problems: 2, others: 1, loaders: 1, dashboards: 1 },
    );

    expect(namesOf(answer.upstream.problems)).toEqual(["raw.t01", "raw.t02"]);
    expect(answer.upstream.untoldProblemCount).toBe(3);
    expect(namesOf(answer.upstream.others)).toEqual(["raw.t06"]);
    expect(answer.upstream.untoldOtherCount).toBe(2);

    const text: string = formatDataTableLineageAnswer(answer, NOW);

    expect(text).toContain(
      "Upstream, what it is built from: 8 tables, 5 with a problem.",
    );
    expect(text).toContain("- and 3 more with a problem, further up.");
    expect(text).toContain(
      "The rest, nearest first: raw.t06 (1 step up, fresh) and 2 more.",
    );
  });

  test("a name several tables share tells each in fewer lines", () => {
    expect(DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL.problems).toBeLessThan(
      DATA_LINEAGE_ANSWER_LIMITS.problems,
    );
    expect(DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL.others).toBeLessThan(
      DATA_LINEAGE_ANSWER_LIMITS.others,
    );
    expect(DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL.loaders).toBeLessThan(
      DATA_LINEAGE_ANSWER_LIMITS.loaders,
    );
    expect(DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL.dashboards).toBeLessThan(
      DATA_LINEAGE_ANSWER_LIMITS.dashboards,
    );
  });

  test("tables a drawing holds no card for are counted as more lineage past what is told", async () => {
    const extra: number = 3;
    const answer: DataTableLineageAnswer = await answerOf(
      wideGraph(MAX_DATA_LINEAGE_NEIGHBORS + extra, 0),
      t(0),
    );

    expect(answer.upstream.tableCount).toBe(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(answer.upstream.hiddenCount).toBe(extra);
    expect(formatDataTableLineageAnswer(answer, NOW)).toContain(
      `More lineage lies past what is told: 3 more tables further up (further than 3 steps, or past the ${MAX_DATA_LINEAGE_NEIGHBORS} nearest to one table). Ask again with a depth of up to 5 to see further, or about one of these tables.`,
    );
  });

  test("tables further than the steps asked for: each way counted, and a larger depth offered", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    table(graph, t(2), { assetKey: "staging.orders" });
    table(graph, t(3), { assetKey: "raw.orders" });
    table(graph, t(4), { assetKey: "marts.orders" });
    table(graph, t(5), { assetKey: "marts.daily" });
    table(graph, t(6), { assetKey: "marts.weekly" });
    feeds(graph, t(3), t(2));
    feeds(graph, t(2), t(1));
    feeds(graph, t(1), t(4));
    feeds(graph, t(4), t(5));
    feeds(graph, t(4), t(6));

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1), 1);

    expect(answer.upstream.hiddenCount).toBe(1);
    expect(answer.downstream.hiddenCount).toBe(2);

    const text: string = formatDataTableLineageAnswer(answer, NOW);

    expect(text.split("\n")[0]).toBe(
      "public.orders (Warehouse): fresh. Its lineage, 1 step each way:",
    );
    expect(text).toContain(
      "More lineage lies past what is told: 1 more table further up and 2 more tables further down (further than 1 step, or past the 10 nearest to one table). Ask again with a depth of up to 5 to see further, or about one of these tables.",
    );

    // At the most steps there is, the way on is to ask about a table further out.
    expect(
      formatDataTableLineageAnswer({ ...answer, depth: 5 }, NOW),
    ).toContain(
      "(further than 5 steps, or past the 10 nearest to one table). Ask about one of these tables to see past it.",
    );
  });

  test("nothing past what is told: no word of more", async () => {
    expect(await textOf(revenueWarehouse(), t(1))).not.toContain(
      "More lineage",
    );
  });

  test("a lineage larger than one drawing reads says the counts are at least what they say", async () => {
    const lineage: DataTableLineage = await lineageOf(revenueWarehouse(), t(1));
    const text: string = formatDataTableLineageAnswer(
      buildDataTableLineageAnswer({ ...lineage, isTruncated: true }),
      NOW,
    );

    expect(text.split("\n").pop()).toBe(
      "This lineage is larger than one answer reads: what is told is true, and the counts are at least what they say.",
    );
  });

  test("dashboards past the most told, and past the most a drawing holds, are counted", async () => {
    const graph: MemoryGraph = revenueWarehouse();
    const lineage: DataTableLineage = await lineageOf(graph, t(1));
    const answer: DataTableLineageAnswer = buildDataTableLineageAnswer(
      { ...lineage, hiddenDashboardCount: 4 },
      { problems: 10, others: 10, loaders: 10, dashboards: 1 },
    );

    expect(
      answer.dashboards.map((entry: { name: string }) => {
        return entry.name;
      }),
    ).toEqual(["Finance"]);
    expect(answer.untoldDashboardCount).toBe(5);
    expect(formatDataTableLineageAnswer(answer, NOW)).toContain(
      "Dashboards built on it or on tables built from it: Finance (Tableau, reads it) and 5 more.",
    );

    // None drawn, some counted: still said.
    expect(
      formatDataTableLineageAnswer(
        { ...answer, dashboards: [], untoldDashboardCount: 1 },
        NOW,
      ),
    ).toContain(
      "1 dashboard is built on these tables, past the most one answer tells.",
    );
  });

  test("loaders past the most told are counted", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0), { assetKey: "public.orders" });

    for (let index: number = 1; index <= 3; index++) {
      table(graph, t(index), { assetKey: `raw.t${index}` });
      pipeline(graph, p(index), { jobName: `sync_${index}` });
      feeds(graph, t(index), t(0));
      writes(graph, p(index), t(index));
    }

    const answer: DataTableLineageAnswer = await answerOf(graph, t(0), 3, {
      problems: 10,
      others: 10,
      loaders: 1,
      dashboards: 10,
    });

    expect(
      answer.loaders.map((loader: { name: string }) => {
        return loader.name;
      }),
    ).toEqual(["sync_1"]);
    expect(answer.untoldLoaderCount).toBe(2);
    expect(formatDataTableLineageAnswer(answer, NOW)).toContain(
      "(last run complete 1 hour ago) and 2 more.",
    );
  });
});

describe("the way to each table", () => {
  test("the fewest steps through the arrows drawn, the tables between in the order data flows", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    lateTable(graph, t(2), { assetKey: "a.first" });
    table(graph, t(3), { assetKey: "b.second" });
    table(graph, t(4), { assetKey: "c.third" });
    lateTable(graph, t(5), { assetKey: "d.sink" });
    // raw source -> a.first -> b.second -> public.orders -> c.third -> d.sink
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(1));
    feeds(graph, t(1), t(4));
    feeds(graph, t(4), t(5));

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));

    expect(answer.upstream.problems[0]).toMatchObject({
      table: "a.first",
      steps: 2,
      through: ["b.second"],
    });
    expect(answer.downstream.problems[0]).toMatchObject({
      table: "d.sink",
      steps: 2,
      through: ["c.third"],
    });
  });

  test("three steps up: the tables between, nearest the source first", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    lateTable(graph, t(2), { assetKey: "raw.source" });
    table(graph, t(3), { assetKey: "staging.one" });
    table(graph, t(4), { assetKey: "staging.two" });
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(4));
    feeds(graph, t(4), t(1));

    expect(await textOf(graph, t(1))).toContain(
      "- raw.source, 3 steps up, through staging.one, then staging.two: late by 22 hours.",
    );
  });

  test("of two ways, the one through the table whose name comes first, every time", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(1), { assetKey: "public.orders" });
    lateTable(graph, t(2), { assetKey: "raw.source" });
    table(graph, t(3), { assetKey: "zz.path" });
    table(graph, t(4), { assetKey: "aa.path" });
    feeds(graph, t(2), t(3));
    feeds(graph, t(2), t(4));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(1));

    const answer: DataTableLineageAnswer = await answerOf(graph, t(1));

    expect(answer.upstream.problems[0]!.through).toEqual(["aa.path"]);
  });

  test("a table reached through arrows a drawing holds no longer way to is told by the way it holds", () => {
    // Drawn three steps up, but its arrow to a table one step up is drawn too.
    const node: (
      id: number,
      side: DataLineageSide,
      depth: number,
      fields?: Partial<DataTableLineageNode>,
    ) => DataTableLineageNode = (
      id: number,
      side: DataLineageSide,
      depth: number,
      fields: Partial<DataTableLineageNode> = {},
    ): DataTableLineageNode => {
      return {
        id: getLineageTableNodeId(t(id)),
        kind: DataLineageNodeKind.Table,
        side,
        depth,
        name: `s.t${id}`,
        dataAssetId: t(id),
        database: "Warehouse",
        freshness: DataAssetFreshness.Fresh,
        lateBySeconds: 0,
        isDropped: false,
        openAlertCount: 0,
        hiddenUpstreamCount: 0,
        hiddenDownstreamCount: 0,
        ...fields,
      };
    };
    const edge: (source: number, target: number) => DataTableLineageEdge = (
      source: number,
      target: number,
    ): DataTableLineageEdge => {
      const from: string = getLineageTableNodeId(t(source));
      const to: string = getLineageTableNodeId(t(target));

      return {
        id: getLineageEdgeId({
          kind: DataLineageEdgeKind.Feeds,
          source: from,
          target: to,
        }),
        source: from,
        target: to,
        kind: DataLineageEdgeKind.Feeds,
        seenIn: [],
        pipelines: [],
        lastSeenAt: null,
      };
    };
    const lineage: DataTableLineage = {
      focusNodeId: getLineageTableNodeId(t(1)),
      depth: 3,
      nodes: [
        node(1, DataLineageSide.Focus, 0),
        node(2, DataLineageSide.Upstream, -1),
        node(3, DataLineageSide.Upstream, -2),
        node(4, DataLineageSide.Upstream, -3, {
          freshness: DataAssetFreshness.Late,
          lateBySeconds: 3600,
        }),
        // On no arrow at all: told at the steps the drawing gave it.
        node(5, DataLineageSide.Upstream, -2),
      ],
      edges: [edge(2, 1), edge(3, 2), edge(4, 3), edge(4, 2)],
      hiddenDashboardCount: 0,
      isTruncated: false,
    };
    const answer: DataTableLineageAnswer = buildDataTableLineageAnswer(lineage);

    expect(answer.upstream.problems[0]).toMatchObject({
      table: "s.t4",
      steps: 2,
      through: ["s.t2"],
    });
    expect(
      answer.upstream.others.find((table: DataLineageAnswerTable): boolean => {
        return table.table === "s.t5";
      }),
    ).toMatchObject({ steps: 2, through: [] });
  });
});

describe("a pipeline's lineage, as an investigation of its alert reads it", () => {
  test("the tables it reads up, the tables it writes and what is built from them down", async () => {
    const graph: MemoryGraph = newGraph();
    lateTable(graph, t(1), { assetKey: "raw.orders" });
    table(graph, t(2), { assetKey: "staging.orders" });
    table(graph, t(3), { assetKey: "marts.orders" });
    pipeline(graph, p(1), { jobName: "orders_etl" });
    runs(graph, p(1), { reads: [t(1)], writes: [t(2)] });
    feeds(graph, t(2), t(3));

    const lineage: DataTableLineage | null =
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: p(1),
        depth: 2,
        now: NOW,
        reader: memoryReader(graph),
      });
    const answer: DataTableLineageAnswer = buildDataTableLineageAnswer(
      lineage!,
    );

    expect(answer).toMatchObject({
      dataAssetId: null,
      dataPipelineId: p(1),
      name: "orders_etl",
      database: null,
      self: null,
    });
    expect(namesOf(answer.upstream.problems)).toEqual(["raw.orders"]);
    expect(answer.upstream.problems[0]!.steps).toBe(1);
    expect(answer.downstream.others).toEqual([
      expect.objectContaining({
        table: "staging.orders",
        steps: 1,
        through: [],
      }),
      expect.objectContaining({
        table: "marts.orders",
        steps: 2,
        through: ["staging.orders"],
      }),
    ]);
    // Its own card is never a loader.
    expect(answer.loaders).toEqual([]);

    expect(formatDataTableLineageAnswer(answer, NOW)).toBe(
      [
        "The pipeline orders_etl. Its lineage, 2 steps each way:",
        "Upstream, what it reads: 1 table, 1 with a problem.",
        "- raw.orders (Warehouse), 1 step up: late by 22 hours.",
        "Downstream, what it writes and what is built from that: 2 tables, none with a problem.",
        "Nearest first: staging.orders (Warehouse, 1 step down, fresh), marts.orders (Warehouse, 2 steps down, fresh).",
      ].join("\n"),
    );
  });
});

describe("one reply for a name", () => {
  test("none: says so, and where the watched tables are", () => {
    expect(
      formatDataTableLineageReply({
        reference: "orders",
        answers: [],
        now: NOW,
      }),
    ).toBe(
      'No table Data Observability watches is called "orders". Data Observability watches the tables of the databases connected to it: list them under Data Observability > Tables.',
    );
  });

  test("one: its answer alone", async () => {
    const answer: DataTableLineageAnswer = await answerOf(
      revenueWarehouse(),
      t(1),
    );

    expect(
      formatDataTableLineageReply({
        reference: "daily_revenue",
        answers: [answer],
        now: NOW,
      }),
    ).toBe(formatDataTableLineageAnswer(answer, NOW));
  });

  test("several: how many, then each, apart", async () => {
    const first: DataTableLineageAnswer = await answerOf(
      revenueWarehouse(),
      t(1),
    );
    const second: DataTableLineageAnswer = await answerOf(
      revenueWarehouse(),
      t(5),
    );
    const reply: string = formatDataTableLineageReply({
      reference: "revenue",
      answers: [first, second],
      now: NOW,
    });

    expect(reply).toBe(
      [
        '2 watched tables are called "revenue". The lineage of each:',
        formatDataTableLineageAnswer(first, NOW),
        formatDataTableLineageAnswer(second, NOW),
      ].join("\n\n"),
    );
  });
});

describe("a table's state, in a few words", () => {
  const base: DataLineageAnswerTable = {
    dataAssetId: t(1),
    table: "public.orders",
    database: "Warehouse",
    steps: 1,
    through: [],
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    failedPipelines: [],
    failedLoaders: [],
    hasProblem: false,
  };

  test.each([
    [{}, "fresh"],
    [
      { freshness: DataAssetFreshness.Late, lateBySeconds: 45 * 60 },
      "late by 45 minutes",
    ],
    [
      { freshness: DataAssetFreshness.Late, lateBySeconds: 3 * 24 * 3600 },
      "late by 3 days",
    ],
    [{ freshness: DataAssetFreshness.Unknown }, "freshness not known yet"],
    [{ freshness: DataAssetFreshness.NotApplicable }, "a view"],
    // Dropped says so, whatever its freshness was.
    [
      { isDropped: true, freshness: DataAssetFreshness.Late },
      "dropped from its database",
    ],
    [{ openAlertCount: 1 }, "fresh; 1 open alert"],
    [
      { failedPipelines: ["a", "b"] },
      "fresh; the pipeline a that builds it failed its last run; the pipeline b that builds it failed its last run",
    ],
    [
      {
        failedLoaders: [
          { name: "sync", lastRunStartedAt: null, lastErrorMessage: null },
        ],
      },
      "fresh; the pipeline sync that loads it failed its last run",
    ],
  ])(
    "%j reads %s",
    (fields: Partial<DataLineageAnswerTable>, expected: string) => {
      expect(describeLineageTableState({ ...base, ...fields }, NOW)).toBe(
        expected,
      );
    },
  );

  test("a loader's run in the future, by a clock that is behind, reads as a moment ago", () => {
    expect(
      describeLineageTableState(
        {
          ...base,
          failedLoaders: [
            {
              name: "sync",
              lastRunStartedAt: new Date(NOW.getTime() + HOUR).toISOString(),
              lastErrorMessage: "boom",
            },
          ],
        },
        NOW,
      ),
    ).toBe(
      "fresh; the pipeline sync that loads it failed its last run 1 minute ago: boom",
    );
  });

  test("a pipeline card is never a table, and a loader's card is not counted as one", async () => {
    const answer: DataTableLineageAnswer = await answerOf(
      revenueWarehouse(),
      t(1),
    );
    const told: Array<string> = [
      ...answer.upstream.problems,
      ...answer.upstream.others,
      ...answer.downstream.problems,
      ...answer.downstream.others,
    ].map((table: DataLineageAnswerTable): string => {
      return table.dataAssetId;
    });

    expect(told).not.toContain("");
    expect(told).not.toContain(getLineagePipelineNodeId(p(2)));
    expect(new Set(told).size).toBe(told.length);
  });
});
