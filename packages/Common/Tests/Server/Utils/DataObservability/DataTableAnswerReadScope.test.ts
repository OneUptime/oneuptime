import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataProductService from "../../../../Server/Services/DataProductService";
import DataTableDashboards, {
  TableDashboard,
} from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataObservabilityReadScope from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataTableAnswerer, {
  DataTableAnswer,
  formatDataTableAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableAnswer";
import DataTableLineageReader, {
  DataLineageReadable,
  NOTHING_NAMED,
  keepReadableWrites,
  withNamedReadable,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A TABLE'S ANSWER NAMES ONLY THE TABLES AND PIPELINES ITS READER MAY READ
 * (#9526, #9562).
 *
 * "Is this table fresh?" names the pipelines that write the table and the
 * dashboards built on it, with the table built from it that each one reads.
 * Lineage told only of what its reader may read since #9560; the answer
 * read its writers and the tables down to its dashboards as OneUptime. Now
 * it reads them by the rule every lineage view keeps
 * (DataLineageReadableCache):
 *
 *   - a pipeline its reader may not read is never named, nor one whose only
 *     rows into the table come from a table they may not read;
 *   - the walk down to the dashboards goes through the tables they may read
 *     alone: one they may not read is never named as the table a dashboard
 *     reads, and a dashboard reached only through one is not listed.
 *
 * Its readers: a person or API key (the table-freshness route, the tools of
 * Ask AI, Slack and Microsoft Teams) reads with their grants; an
 * investigation's context and tools read as nobody in particular - none an
 * owner or a label sets apart. A reader whose scope narrows nothing (null)
 * is answered as before.
 *
 *   hr.salaries -[hr_extract]-> public.orders <-[orders_etl]- staging.orders
 *   payroll_sync writes public.orders from outside
 *   public.orders -> marts.revenue -> marts.kpis
 *   public.orders -> hr.headcount -> marts.exec   (exec only through HR's)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function id(kind: number, index: number): string {
  return `${kind.toString().padStart(8, "0")}-0000-4000-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

const ORDERS: string = id(1, 0);
const STAGING: string = id(1, 1);
const REVENUE: string = id(1, 2);
const KPIS: string = id(1, 3);
const EXEC: string = id(1, 4);
const SALARIES: string = id(1, 10);
const HEADCOUNT: string = id(1, 11);

const ORDERS_ETL: string = id(2, 1);
const PAYROLL_SYNC: string = id(2, 9);
const HR_EXTRACT: string = id(2, 8);

const TABLE_NAMES: Record<string, string> = {
  [ORDERS]: "public.orders",
  [STAGING]: "staging.orders",
  [REVENUE]: "marts.revenue",
  [KPIS]: "marts.kpis",
  [EXEC]: "marts.exec",
  [SALARIES]: "hr.salaries",
  [HEADCOUNT]: "hr.headcount",
};

const PIPELINES: Record<
  string,
  { jobName: string; lastRunState: string; lastErrorMessage?: string }
> = {
  [ORDERS_ETL]: { jobName: "orders_etl", lastRunState: "COMPLETE" },
  [PAYROLL_SYNC]: {
    jobName: "payroll_sync",
    lastRunState: "FAIL",
    lastErrorMessage: "permission denied for table salaries",
  },
  [HR_EXTRACT]: { jobName: "hr_extract", lastRunState: "COMPLETE" },
};

// The rows into public.orders that name a pipeline: what its writers are read from.
const WRITES: Array<{ upstream: string | null; pipeline: string }> = [
  { upstream: STAGING, pipeline: ORDERS_ETL },
  { upstream: null, pipeline: PAYROLL_SYNC },
  { upstream: SALARIES, pipeline: HR_EXTRACT },
];

// Each table's tables built from it, as the walk to the dashboards reads them.
const BUILT_FROM: Record<string, Array<string>> = {
  [ORDERS]: [REVENUE, HEADCOUNT],
  [REVENUE]: [KPIS],
  [HEADCOUNT]: [EXEC],
};

const DASHBOARDS: Array<{ name: string; tool: DataBiTool; reads: string[] }> = [
  { name: "Orders", tool: DataBiTool.Metabase, reads: [ORDERS] },
  { name: "Revenue", tool: DataBiTool.Tableau, reads: [REVENUE] },
  { name: "HR Headcount", tool: DataBiTool.Looker, reads: [HEADCOUNT] },
  { name: "Exec", tool: DataBiTool.Looker, reads: [EXEC] },
  { name: "Mixed", tool: DataBiTool.PowerBI, reads: [HEADCOUNT, KPIS] },
];

// What HR set apart, and everything that leads only to it: never told.
const HR_NAMES: Array<string> = [
  "hr.salaries",
  "hr.headcount",
  "marts.exec",
  "payroll_sync",
  "hr_extract",
  "permission denied for table salaries",
  "HR Headcount",
  "Exec",
];

interface Asked {
  tables: Array<string>;
  pipelines: Array<string>;
}

let asked: Asked;

// HR's tables and pipeline set apart: what an Owned role or nobody in particular may not read.
function hrSetApart(): DataLineageReadable {
  return {
    readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
      asked.tables.push(...ids);

      return new Set(
        ids.filter((each: string): boolean => {
          return each !== SALARIES && each !== HEADCOUNT;
        }),
      );
    },
    readablePipelineIds: async (ids: Array<string>): Promise<Set<string>> => {
      asked.pipelines.push(...ids);

      return new Set(
        ids.filter((each: string): boolean => {
          return each !== PAYROLL_SYNC;
        }),
      );
    },
  };
}

// A scope that narrows nothing, asked all the same.
function everything(): DataLineageReadable {
  return {
    readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
      return new Set(ids);
    },
    readablePipelineIds: async (ids: Array<string>): Promise<Set<string>> => {
      return new Set(ids);
    },
  };
}

function idsIn(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values.map((entry: unknown): string => {
      return String(entry);
    });
  }

  return value === undefined || value === null ? [] : [String(value)];
}

function writeRow(write: {
  upstream: string | null;
  pipeline: string;
}): DataAssetLineage {
  const row: DataAssetLineage = new DataAssetLineage();
  const pipeline: DataPipeline = new DataPipeline();

  if (write.upstream) {
    row.upstreamDataAssetId = new ObjectID(write.upstream);
  }

  row.downstreamDataAssetId = new ObjectID(ORDERS);
  row.dataPipelineId = new ObjectID(write.pipeline);
  pipeline.jobName = PIPELINES[write.pipeline]!.jobName;
  pipeline.lastRunState = PIPELINES[write.pipeline]!.lastRunState;
  pipeline.lastRunStartedAt = new Date(NOW.getTime() - 60 * 60 * 1000);

  if (PIPELINES[write.pipeline]!.lastErrorMessage) {
    pipeline.lastErrorMessage = PIPELINES[write.pipeline]!.lastErrorMessage!;
  }

  row.dataPipeline = pipeline;

  return row;
}

function builtRow(upstream: string, downstream: string): DataAssetLineage {
  const row: DataAssetLineage = new DataAssetLineage();
  const asset: DataAsset = new DataAsset();

  row.upstreamDataAssetId = new ObjectID(upstream);
  row.downstreamDataAssetId = new ObjectID(downstream);
  asset.assetKey = TABLE_NAMES[downstream]!;
  row.downstreamDataAsset = asset;

  return row;
}

function stubWarehouse(): void {
  const asset: DataAsset = new DataAsset();
  asset._id = ORDERS;
  asset.assetKey = "public.orders";
  asset.dataStoreName = "Warehouse";
  asset.assetKind = DataAssetKind.Table;
  asset.lastChangedAt = new Date("2026-11-04T11:30:00.000Z");
  asset.updateIntervalInSeconds = 3600;
  asset.isDropped = false;

  jest.spyOn(DataAssetService, "findOneBy").mockResolvedValue(asset as never);
  jest.spyOn(DataAlertService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataProductService, "findBy").mockResolvedValue([] as never);

  /*
   * The writers' read names the pipeline column; the walk to the
   * dashboards names the tables it sets out from.
   */
  jest
    .spyOn(DataAssetLineageService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<DataAssetLineage>> => {
      if (findBy.query["dataPipelineId"] !== undefined) {
        return WRITES.map(writeRow);
      }

      return idsIn(findBy.query["upstreamDataAssetId"]).flatMap(
        (upstream: string): Array<DataAssetLineage> => {
          return (BUILT_FROM[upstream] || []).map(
            (downstream: string): DataAssetLineage => {
              return builtRow(upstream, downstream);
            },
          );
        },
      );
    }) as never);

  // The dashboards reading any of the tables the walk reached, by name.
  jest
    .spyOn(DataDashboardService, "findBy")
    .mockImplementation((async (findBy: {
      query: { _id: FindOperator<unknown> };
    }): Promise<Array<DataDashboard>> => {
      const reached: Array<string> = Object.values(
        (findBy.query._id.objectLiteralParameters as Record<string, unknown>) ||
          {},
      ).flatMap((value: unknown): Array<string> => {
        return Array.isArray(value) ? value.map(String) : [];
      });

      return DASHBOARDS.filter(
        (dashboard: { reads: Array<string> }): boolean => {
          return dashboard.reads.some((table: string): boolean => {
            return reached.includes(table);
          });
        },
      ).map(
        (
          dashboard: { name: string; tool: DataBiTool; reads: Array<string> },
          index: number,
        ): DataDashboard => {
          const model: DataDashboard = new DataDashboard();

          model._id = id(3, index);
          model.name = dashboard.name;
          model.tool = dashboard.tool;
          model.dataAssets = dashboard.reads.map((table: string): DataAsset => {
            const read: DataAsset = new DataAsset();
            read._id = table;
            return read;
          });

          return model;
        },
      );
    }) as never);
}

beforeEach(() => {
  jest.restoreAllMocks();
  asked = { tables: [], pipelines: [] };
  stubWarehouse();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function answerWith(
  readable: DataLineageReadable | null,
): Promise<DataTableAnswer> {
  const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
    PROJECT_ID,
    new ObjectID(ORDERS),
    NOW,
    null,
    readable,
  );

  expect(answer).not.toBeNull();

  return answer!;
}

describe("a table's answer, for a reader limited to some tables and pipelines", () => {
  test("its writers: one set apart is never named, nor one whose only rows come from a table set apart", async () => {
    const answer: DataTableAnswer = await answerWith(hrSetApart());

    expect(
      answer.writerPipelines.map(
        (writer: DataTableAnswer["writerPipelines"][number]): string => {
          return writer.name;
        },
      ),
    ).toEqual(["orders_etl"]);
  });

  test("its dashboards: reached only through the tables they may read, and never named as reading one of HR's", async () => {
    const answer: DataTableAnswer = await answerWith(hrSetApart());

    expect(answer.dashboards).toEqual([
      { name: "Orders", tool: "Metabase", via: null },
      { name: "Revenue", tool: "Tableau", via: "marts.revenue" },
      // It reads HR's headcount too: told by the table of theirs it reads.
      { name: "Mixed", tool: "Power BI", via: "marts.kpis" },
    ]);
  });

  test("the answer told in words names nothing of HR's, and counts none of it", async () => {
    const text: string = formatDataTableAnswer(
      await answerWith(hrSetApart()),
      NOW,
    );

    for (const name of HR_NAMES) {
      expect(text).not.toContain(name);
    }

    expect(text).toContain(
      "Its writer, the pipeline orders_etl, last ran 1 hour ago (complete).",
    );
    expect(text).toContain(
      "Dashboards built on it: Orders (Metabase), Revenue (Tableau, through marts.revenue), Mixed (Power BI, through marts.kpis).",
    );
  });

  test("only the tables the walk reached and the writers' pipelines and tables are asked about", async () => {
    await answerWith(hrSetApart());

    // The writers' rows name staging, HR's salaries and its pipelines; the walk reaches revenue, headcount, then kpis.
    expect(new Set(asked.tables)).toEqual(
      new Set([STAGING, SALARIES, ORDERS, REVENUE, HEADCOUNT, KPIS]),
    );
    expect(new Set(asked.pipelines)).toEqual(
      new Set([ORDERS_ETL, PAYROLL_SYNC, HR_EXTRACT]),
    );
    // Never past a table set apart: marts.exec is not reached.
    expect(asked.tables).not.toContain(EXEC);
  });
});

describe("a table's answer, for a reader the scope narrows nothing for", () => {
  test("no scope: every writer and dashboard, as before", async () => {
    const answer: DataTableAnswer = await answerWith(null);

    expect(
      answer.writerPipelines.map(
        (writer: DataTableAnswer["writerPipelines"][number]): string => {
          return writer.name;
        },
      ),
    ).toEqual(["orders_etl", "payroll_sync", "hr_extract"]);
    expect(
      (answer.dashboards || []).map((dashboard: { name: string }): string => {
        return dashboard.name;
      }),
    ).toEqual(["Orders", "Revenue", "HR Headcount", "Exec", "Mixed"]);
  });

  test("a scope that reads every table and pipeline answers word for word as no scope does", async () => {
    const none: DataTableAnswer = await answerWith(null);
    const all: DataTableAnswer = await answerWith(everything());

    expect(all).toEqual(none);
    expect(formatDataTableAnswer(all, NOW)).toBe(
      formatDataTableAnswer(none, NOW),
    );
  });

  test("the reader of the whole project has no scope to ask (getNamedReadable)", () => {
    expect(
      DataTableLineageReader.getNamedReadable(
        DataObservabilityReadScope.wholeProject(PROJECT_ID),
      ),
    ).toBeNull();
    expect(
      DataTableLineageReader.getNamedReadable(
        DataObservabilityReadScope.wholeProject(PROJECT_ID),
        { dataAssetIds: [SALARIES], dataPipelineIds: [] },
      ),
    ).toBeNull();
  });
});

describe("the dashboards a table's alert lists, by what its reader may read", () => {
  test("the walk stops at a table they may not read, and its dashboards are not listed", async () => {
    const dashboards: Array<TableDashboard> = await DataTableDashboards.find({
      projectId: PROJECT_ID,
      dataAssetId: new ObjectID(ORDERS),
      readable: hrSetApart(),
    });

    expect(
      dashboards.map((dashboard: TableDashboard): string => {
        return `${dashboard.name} ${dashboard.via?.table || "(the table)"}`;
      }),
    ).toEqual([
      "Orders (the table)",
      "Revenue marts.revenue",
      "Mixed marts.kpis",
    ]);
    expect(JSON.stringify(dashboards)).not.toContain(HEADCOUNT);
    expect(JSON.stringify(dashboards)).not.toContain(EXEC);
  });

  test("with no scope, every dashboard two steps down, as before", async () => {
    const dashboards: Array<TableDashboard> = await DataTableDashboards.find({
      projectId: PROJECT_ID,
      dataAssetId: new ObjectID(ORDERS),
    });

    expect(
      dashboards.map((dashboard: TableDashboard): string => {
        return `${dashboard.name} ${dashboard.via?.table || "(the table)"}`;
      }),
    ).toEqual([
      "Orders (the table)",
      "Revenue marts.revenue",
      "HR Headcount hr.headcount",
      "Exec marts.exec",
      "Mixed hr.headcount",
    ]);
  });
});

describe("what a record names, read whatever the scope says (withNamedReadable)", () => {
  test("an alert's own table and pipeline are read, set apart or not, and the scope is never asked about them", async () => {
    const readable: DataLineageReadable = withNamedReadable(hrSetApart(), {
      dataAssetIds: [SALARIES],
      dataPipelineIds: [PAYROLL_SYNC],
    });

    expect(
      Array.from(
        await readable.readableTableIds([SALARIES, HEADCOUNT, ORDERS]),
      ).sort(),
    ).toEqual([ORDERS, SALARIES].sort());
    expect(
      Array.from(
        await readable.readablePipelineIds([PAYROLL_SYNC, ORDERS_ETL]),
      ).sort(),
    ).toEqual([ORDERS_ETL, PAYROLL_SYNC].sort());
    expect(asked.tables).toEqual([HEADCOUNT, ORDERS]);
    expect(asked.pipelines).toEqual([ORDERS_ETL]);
  });

  test("only what was named: a table it names never widens the scope to another", async () => {
    const readable: DataLineageReadable = withNamedReadable(hrSetApart(), {
      dataAssetIds: [SALARIES],
      dataPipelineIds: [],
    });

    expect(await readable.readableTableIds([HEADCOUNT])).toEqual(new Set());
    expect(await readable.readablePipelineIds([PAYROLL_SYNC])).toEqual(
      new Set(),
    );
  });

  test("nothing named asks the scope about every id, and asks nothing for named ids alone", async () => {
    const readable: DataLineageReadable = withNamedReadable(
      hrSetApart(),
      NOTHING_NAMED,
    );

    expect(await readable.readableTableIds([SALARIES, ORDERS])).toEqual(
      new Set([ORDERS]),
    );

    const named: DataLineageReadable = withNamedReadable(hrSetApart(), {
      dataAssetIds: [SALARIES],
      dataPipelineIds: [],
    });

    asked = { tables: [], pipelines: [] };

    expect(await named.readableTableIds([SALARIES])).toEqual(
      new Set([SALARIES]),
    );
    expect(asked.tables).toEqual([]);
  });
});

describe("a table's writers, read on their own (keepReadableWrites)", () => {
  test("kept by the rule every lineage read keeps rows by, in the order read", async () => {
    const kept: Array<DataAssetLineage> = await keepReadableWrites(
      WRITES.map(writeRow),
      hrSetApart(),
    );

    expect(
      kept.map((row: DataAssetLineage): string => {
        return row.dataPipelineId!.toString();
      }),
    ).toEqual([ORDERS_ETL]);
  });

  test("a writer of theirs is kept beside a row of it from a table set apart", async () => {
    const kept: Array<DataAssetLineage> = await keepReadableWrites(
      [
        writeRow({ upstream: SALARIES, pipeline: ORDERS_ETL }),
        writeRow({ upstream: null, pipeline: ORDERS_ETL }),
      ],
      hrSetApart(),
    );

    expect(kept).toHaveLength(1);
    expect(kept[0]!.upstreamDataAssetId).toBeUndefined();
  });

  test("no scope keeps every row, asking nothing", async () => {
    const rows: Array<DataAssetLineage> = WRITES.map(writeRow);

    expect(await keepReadableWrites(rows, null)).toBe(rows);
    expect(asked).toEqual({ tables: [], pipelines: [] });
  });
});
