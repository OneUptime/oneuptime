import TelemetryUsageBillingService from "../../../../Server/Services/TelemetryUsageBillingService";
import TelemetryUsageReads from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageReads";
import TelemetryUsageResourceNames from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageResourceNames";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  getTelemetryUsageWindow,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSummary,
  TelemetryUsageSummary,
  TelemetryUsageWindow,
} from "../../../../Types/Telemetry/TelemetryUsage";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The usage pages' reads (issue #5916): the staged usage rows summed in
 * Postgres - each day by signal, each resource by signal with its retention,
 * and every project of the instance - with what usage cost only where the
 * caller may read it. Postgres is answered here by the statement each read
 * sends; the statements themselves were run against Postgres 15 while they
 * were written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const RUM_APP_ID: string = "44444444-4444-4444-8444-444444444444";

const WINDOW: TelemetryUsageWindow = getTelemetryUsageWindow({
  startDay: "2026-10-01",
  endDay: "2026-10-03",
}) as TelemetryUsageWindow;

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

let statements: Array<Statement>;
let answers: Array<{ match: RegExp; rows: Array<Record<string, unknown>> }>;
let resolve: jest.SpyInstance;

beforeEach(() => {
  statements = [];
  answers = [];

  jest.spyOn(TelemetryUsageBillingService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql, parameters });

        return (
          answers.find((answer: { match: RegExp }) => {
            return answer.match.test(sql);
          })?.rows || []
        );
      },
    },
  } as never);

  resolve = jest
    .spyOn(TelemetryUsageResourceNames, "resolve")
    .mockResolvedValue(
      new Map<string, string>([
        [SERVICE_ID, "checkout"],
        [HOST_ID, "web-01"],
      ]),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function answerDays(rows: Array<Record<string, unknown>>): void {
  answers.push({ match: /AS "day"/, rows });
}

function answerResources(rows: Array<Record<string, unknown>>): void {
  answers.push({ match: /AS "retentionInDays"/, rows });
}

function answerLatest(day: string | null): void {
  answers.push({ match: /AS "latestDay"/, rows: [{ latestDay: day }] });
}

async function readProject(
  isCostIncluded: boolean,
): Promise<TelemetryUsageSummary> {
  return await TelemetryUsageReads.getProjectUsage({
    projectId: PROJECT_ID,
    window: WINDOW,
    isCostIncluded: isCostIncluded,
    nameProps: { isRoot: true },
  });
}

describe("one project's usage", () => {
  beforeEach(() => {
    answerDays([
      {
        day: "2026-10-01",
        productType: ProductType.Logs,
        dataIngestedInGB: "1.5",
        totalCostInUSD: "0.75",
      },
      {
        day: "2026-10-03",
        productType: ProductType.Logs,
        dataIngestedInGB: "2.5",
        totalCostInUSD: "1.25",
      },
      {
        day: "2026-10-03",
        productType: ProductType.SessionReplay,
        dataIngestedInGB: "0.5",
        totalCostInUSD: "2",
      },
      // Not a signal of the usage pages: never shown.
      {
        day: "2026-10-03",
        productType: ProductType.ActiveMonitoring,
        dataIngestedInGB: "9",
        totalCostInUSD: "9",
      },
    ]);
    answerResources([
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        productType: ProductType.Logs,
        dataIngestedInGB: "1",
        totalCostInUSD: "0.5",
        retentionInDays: 30,
      },
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        productType: ProductType.Logs,
        dataIngestedInGB: "3",
        totalCostInUSD: "1.5",
        retentionInDays: "15",
      },
      {
        primaryEntityId: RUM_APP_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        productType: ProductType.SessionReplay,
        dataIngestedInGB: "0.5",
        totalCostInUSD: "2",
        retentionInDays: 7,
      },
    ]);
    answerLatest("2026-10-03");
  });

  test("reads the project's rows of the range, by createdAt: the UTC day each is for", async () => {
    await readProject(false);

    const reads: Array<Statement> = statements.filter((each: Statement) => {
      return !each.sql.includes('AS "latestDay"');
    });

    expect(reads).toHaveLength(2);

    for (const read of reads) {
      expect(read.sql).toContain(
        `"projectId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 AND "deletedAt" IS NULL`,
      );
      expect(read.parameters).toEqual([
        PROJECT_ID.toString(),
        new Date("2026-10-01T00:00:00.000Z"),
        new Date("2026-10-04T00:00:00.000Z"),
      ]);
    }

    // The days are named in UTC, whatever the database server's time zone.
    expect(reads[0]!.sql).toContain(
      `to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    );
  });

  test("lists every day of the range, the days with no usage included", async () => {
    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.startDay).toBe("2026-10-01");
    expect(summary.endDay).toBe("2026-10-03");
    expect(
      summary.days.map((day: { day: string }): string => {
        return day.day;
      }),
    ).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(summary.days[1]).toEqual({
      day: "2026-10-02",
      byProduct: {},
      total: { dataIngestedInGB: 0 },
    });
    expect(summary.days[2]!.byProduct).toEqual({
      [ProductType.Logs]: { dataIngestedInGB: 2.5 },
      [ProductType.SessionReplay]: { dataIngestedInGB: 0.5 },
    });
    expect(summary.days[2]!.total).toEqual({ dataIngestedInGB: 3 });
  });

  test("totals each signal and the whole range, leaving out what is not telemetry", async () => {
    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.byProduct).toEqual({
      [ProductType.Logs]: { dataIngestedInGB: 4 },
      [ProductType.SessionReplay]: { dataIngestedInGB: 0.5 },
    });
    expect(summary.total).toEqual({ dataIngestedInGB: 4.5 });
    expect(summary.latestDay).toBe("2026-10-03");
  });

  test("says nothing of what usage cost unless the caller may read it", async () => {
    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.isCostIncluded).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("totalCostInUSD");
  });

  test("says what usage cost where the caller may read it", async () => {
    const summary: TelemetryUsageSummary = await readProject(true);

    expect(summary.isCostIncluded).toBe(true);
    expect(summary.total).toEqual({
      dataIngestedInGB: 4.5,
      totalCostInUSD: 4,
    });
    expect(summary.byProduct[ProductType.Logs]).toEqual({
      dataIngestedInGB: 4,
      totalCostInUSD: 2,
    });
    expect(summary.days[1]!.total).toEqual({
      dataIngestedInGB: 0,
      totalCostInUSD: 0,
    });
  });

  test("lists each resource heaviest first, named, with its retention", async () => {
    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.resources).toEqual([
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        name: "checkout",
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 3 } },
        total: { dataIngestedInGB: 3 },
        retentionInDays: 15,
        sessionReplayRetentionInDays: null,
      },
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        name: "web-01",
        byProduct: { [ProductType.Logs]: { dataIngestedInGB: 1 } },
        total: { dataIngestedInGB: 1 },
        retentionInDays: 30,
        sessionReplayRetentionInDays: null,
      },
      {
        primaryEntityId: RUM_APP_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        name: null,
        byProduct: { [ProductType.SessionReplay]: { dataIngestedInGB: 0.5 } },
        total: { dataIngestedInGB: 0.5 },
        retentionInDays: null,
        sessionReplayRetentionInDays: 7,
      },
    ]);
  });

  test("names the resources as the reader may read them", async () => {
    const reader: { tenantId: ObjectID } = { tenantId: PROJECT_ID };

    await TelemetryUsageReads.getProjectUsage({
      projectId: PROJECT_ID,
      window: WINDOW,
      isCostIncluded: false,
      nameProps: reader as never,
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]![0].props).toBe(reader);
    expect(resolve.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("reads the newest day ever counted, so an empty range can say why", async () => {
    answers = [];
    answerLatest("2026-09-12");

    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.total).toEqual({ dataIngestedInGB: 0 });
    expect(summary.resources).toEqual([]);
    expect(summary.latestDay).toBe("2026-09-12");
    expect(summary.days).toHaveLength(3);
  });

  test("says no day was ever counted for a project that has none", async () => {
    answers = [];

    const summary: TelemetryUsageSummary = await readProject(false);

    expect(summary.latestDay).toBeNull();
  });
});

describe("a resource's retention", () => {
  test("is its telemetry's, kept apart from its session replays'", () => {
    expect(
      TelemetryUsageReads.getRetention(
        new Map<ProductType, number>([
          [ProductType.Metrics, 15],
          [ProductType.SessionReplay, 7],
        ]),
      ),
    ).toEqual({ retentionInDays: 15, sessionReplayRetentionInDays: 7 });
  });

  test("is the longest of its signals' when they differ", () => {
    expect(
      TelemetryUsageReads.getRetention(
        new Map<ProductType, number>([
          [ProductType.Logs, 15],
          [ProductType.Traces, 30],
        ]),
      ),
    ).toEqual({ retentionInDays: 30, sessionReplayRetentionInDays: null });
  });

  test("is none for a resource that counted none", () => {
    expect(TelemetryUsageReads.getRetention(new Map())).toEqual({
      retentionInDays: null,
      sessionReplayRetentionInDays: null,
    });
  });
});

describe("every project's usage, for the instance admin", () => {
  const projects: Array<Record<string, unknown>> = [
    {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      projectName: "Alpha",
      productType: ProductType.Logs,
      dataIngestedInGB: "10",
      totalCostInUSD: "1",
    },
    {
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      projectName: "Alpha",
      productType: ProductType.Traces,
      dataIngestedInGB: "1",
      totalCostInUSD: "0.1",
    },
    {
      projectId: "bbbbbbbb-0000-4000-8000-000000000002",
      projectName: "beta",
      productType: ProductType.Traces,
      dataIngestedInGB: "20",
      totalCostInUSD: "2",
    },
    {
      projectId: "cccccccc-0000-4000-8000-000000000003",
      projectName: "Gamma",
      productType: ProductType.Metrics,
      dataIngestedInGB: "5",
      totalCostInUSD: "0.5",
    },
  ];

  beforeEach(() => {
    answers.push({ match: /AS "projectName"/, rows: projects });
  });

  async function readPage(
    data: Partial<{
      sortBy: "total" | "name" | ProductType;
      sortOrder: "asc" | "desc";
      skip: number;
      limit: number;
      isCostIncluded: boolean;
    }>,
  ): Promise<TelemetryProjectUsagePage> {
    return await TelemetryUsageReads.getUsageByProject({
      window: WINDOW,
      isCostIncluded: data.isCostIncluded ?? false,
      sortBy: data.sortBy || "total",
      sortOrder: data.sortOrder || "desc",
      skip: data.skip || 0,
      limit: data.limit || 50,
    });
  }

  function names(page: TelemetryProjectUsagePage): Array<string | null> {
    return page.projects.map((each: TelemetryProjectUsageSummary) => {
      return each.projectName;
    });
  }

  test("reads every project's rows of the range, leaving out deleted projects", async () => {
    await readPage({});

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain(
      `INNER JOIN "Project" p ON p."_id" = u."projectId" AND p."deletedAt" IS NULL`,
    );
    expect(statements[0]!.sql).toContain(
      `u."createdAt" >= $1 AND u."createdAt" < $2`,
    );
    expect(statements[0]!.parameters).toEqual([
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-10-04T00:00:00.000Z"),
    ]);
  });

  test("lists the heaviest projects first by default, with the instance's totals", async () => {
    const page: TelemetryProjectUsagePage = await readPage({});

    expect(names(page)).toEqual(["beta", "Alpha", "Gamma"]);
    expect(page.count).toBe(3);
    expect(page.total).toEqual({ dataIngestedInGB: 36 });
    expect(page.byProduct).toEqual({
      [ProductType.Logs]: { dataIngestedInGB: 10 },
      [ProductType.Traces]: { dataIngestedInGB: 21 },
      [ProductType.Metrics]: { dataIngestedInGB: 5 },
    });
    expect(page.projects[1]).toEqual({
      projectId: "aaaaaaaa-0000-4000-8000-000000000001",
      projectName: "Alpha",
      byProduct: {
        [ProductType.Logs]: { dataIngestedInGB: 10 },
        [ProductType.Traces]: { dataIngestedInGB: 1 },
      },
      total: { dataIngestedInGB: 11 },
    });
  });

  test("sorts by one signal, by the name, either way", async () => {
    expect(names(await readPage({ sortBy: ProductType.Logs }))).toEqual([
      "Alpha",
      // Ties - no logs at all - by id.
      "beta",
      "Gamma",
    ]);
    expect(names(await readPage({ sortBy: "name", sortOrder: "asc" }))).toEqual(
      ["Alpha", "beta", "Gamma"],
    );
    expect(
      names(await readPage({ sortBy: "name", sortOrder: "desc" })),
    ).toEqual(["Gamma", "beta", "Alpha"]);
    expect(
      names(await readPage({ sortBy: "total", sortOrder: "asc" })),
    ).toEqual(["Gamma", "Alpha", "beta"]);
  });

  test("returns one page, and counts them all", async () => {
    const page: TelemetryProjectUsagePage = await readPage({
      skip: 1,
      limit: 1,
    });

    expect(names(page)).toEqual(["Alpha"]);
    expect(page.count).toBe(3);
    expect(page.skip).toBe(1);
    expect(page.limit).toBe(1);
  });

  test("says what usage cost only where it is asked to", async () => {
    expect(JSON.stringify(await readPage({}))).not.toContain("totalCostInUSD");

    const page: TelemetryProjectUsagePage = await readPage({
      isCostIncluded: true,
    });

    expect(page.total.dataIngestedInGB).toBe(36);
    expect(page.total.totalCostInUSD).toBeCloseTo(3.6, 10);
    expect(page.projects[0]!.total.totalCostInUSD).toBeCloseTo(2, 10);
  });
});
