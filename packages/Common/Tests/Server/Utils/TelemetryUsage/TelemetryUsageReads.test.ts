import TelemetryUsageBillingService from "../../../../Server/Services/TelemetryUsageBillingService";
import TelemetryUsageReads, {
  getExceptionCostSql,
  getExceptionGBSql,
  getSignalAmounts,
  getSignalSumsSql,
} from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageReads";
import TelemetryUsageResourceNames from "../../../../Server/Utils/TelemetryUsage/TelemetryUsageResourceNames";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  getTelemetryUsageWindow,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryProjectUsageSummary,
  TelemetryUsageResourceSummary,
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

/*
 * Issue #6356: exceptions are shown as a signal of their own. A Traces row
 * keeps everything it is billed for, and how much of it was exceptions;
 * each read takes that part out of Traces, in Postgres, and shows it as
 * Exceptions with its share of the cost. A Traces row counted before has no
 * part, so its exceptions stay inside Traces - and every total is what it
 * was. The statements here are answered as Postgres would sum them;
 * TelemetryUsageExceptionsPostgres.test.ts runs them on a real one.
 */
describe("exceptions, apart from the traces they are billed with", () => {
  test("every read sums the rows' own product with the exceptions taken out, and the exceptions apart", async () => {
    answerLatest("2026-10-03");
    await readProject(true);
    answers.push({ match: /AS "projectName"/, rows: [] });
    await TelemetryUsageReads.getUsageByProject({
      window: WINDOW,
      isCostIncluded: true,
      sortBy: "total",
      sortOrder: "desc",
      skip: 0,
      limit: 50,
    });

    const sums: Array<Statement> = statements.filter((each: Statement) => {
      return !each.sql.includes('AS "latestDay"');
    });

    expect(sums).toHaveLength(3);

    for (const read of sums) {
      const alias: string = read.sql.includes('"TelemetryUsageBilling" u')
        ? "u."
        : "";

      expect(read.sql).toContain(getSignalSumsSql(alias));
    }

    expect(getSignalSumsSql("")).toBe(
      [
        `COALESCE(SUM("dataIngestedInGB" - ${getExceptionGBSql("")}), 0)::text AS "dataIngestedInGB"`,
        `COALESCE(SUM("totalCostInUSD" - ${getExceptionCostSql("")}), 0)::text AS "totalCostInUSD"`,
        `COALESCE(SUM(${getExceptionGBSql("")}), 0)::text AS "exceptionDataIngestedInGB"`,
        `COALESCE(SUM(${getExceptionCostSql("")}), 0)::text AS "exceptionCostInUSD"`,
      ].join(", "),
    );
  });

  test("takes a part out of Traces rows only, held to the row, and none from a row that has none", () => {
    expect(getExceptionGBSql("u.")).toBe(
      `(CASE WHEN u."productType" = 'Traces' THEN LEAST(GREATEST(COALESCE(u."exceptionDataIngestedInGB", 0), 0), u."dataIngestedInGB") ELSE 0 END)`,
    );
  });

  test("gives the part its share of the row's cost: the cost grows with the GB", () => {
    expect(getExceptionCostSql("")).toBe(
      `(CASE WHEN "dataIngestedInGB" > 0 THEN "totalCostInUSD" * ${getExceptionGBSql("")} / "dataIngestedInGB" ELSE 0 END)`,
    );
  });

  describe("each day, and the range", () => {
    beforeEach(() => {
      answerDays([
        // Counted before exceptions were counted apart: no part.
        {
          day: "2026-10-01",
          productType: ProductType.Traces,
          dataIngestedInGB: "3",
          totalCostInUSD: "0.3",
          exceptionDataIngestedInGB: "0",
          exceptionCostInUSD: "0",
        },
        // Counted since: 1 GB of spans and 0.5 GB of exceptions.
        {
          day: "2026-10-02",
          productType: ProductType.Traces,
          dataIngestedInGB: "1",
          totalCostInUSD: "0.1",
          exceptionDataIngestedInGB: "0.5",
          exceptionCostInUSD: "0.05",
        },
        {
          day: "2026-10-02",
          productType: ProductType.Logs,
          dataIngestedInGB: "2",
          totalCostInUSD: "0.2",
          exceptionDataIngestedInGB: "0",
          exceptionCostInUSD: "0",
        },
        // A day whose traces were all exceptions.
        {
          day: "2026-10-03",
          productType: ProductType.Traces,
          dataIngestedInGB: "0",
          totalCostInUSD: "0",
          exceptionDataIngestedInGB: "0.25",
          exceptionCostInUSD: "0.025",
        },
      ]);
      answerResources([]);
      answerLatest("2026-10-03");
    });

    test("a day counted before exceptions were counted apart keeps them inside Traces, as it showed them", async () => {
      const summary: TelemetryUsageSummary = await readProject(false);

      expect(summary.days[0]).toEqual({
        day: "2026-10-01",
        byProduct: { [ProductType.Traces]: { dataIngestedInGB: 3 } },
        total: { dataIngestedInGB: 3 },
      });
    });

    test("a day counted since shows its exceptions apart from its spans", async () => {
      const summary: TelemetryUsageSummary = await readProject(false);

      expect(summary.days[1]).toEqual({
        day: "2026-10-02",
        byProduct: {
          [ProductType.Traces]: { dataIngestedInGB: 1 },
          [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: { dataIngestedInGB: 0.5 },
          [ProductType.Logs]: { dataIngestedInGB: 2 },
        },
        total: { dataIngestedInGB: 3.5 },
      });
    });

    test("a day whose traces were all exceptions has no Traces of its own", async () => {
      const summary: TelemetryUsageSummary = await readProject(false);

      expect(summary.days[2]).toEqual({
        day: "2026-10-03",
        byProduct: {
          [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: { dataIngestedInGB: 0.25 },
        },
        total: { dataIngestedInGB: 0.25 },
      });
    });

    test("a range of days counted before and after adds each up once", async () => {
      const summary: TelemetryUsageSummary = await readProject(false);

      expect(summary.byProduct).toEqual({
        [ProductType.Traces]: { dataIngestedInGB: 4 },
        [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: { dataIngestedInGB: 0.75 },
        [ProductType.Logs]: { dataIngestedInGB: 2 },
      });
      // Every GB the rows hold, each counted once: 3 + 1.5 + 2 + 0.25.
      expect(summary.total).toEqual({ dataIngestedInGB: 6.75 });
    });

    test("the exceptions' cost is their share, and the range costs what its rows cost", async () => {
      const summary: TelemetryUsageSummary = await readProject(true);

      expect(
        summary.byProduct[TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]!.totalCostInUSD,
      ).toBeCloseTo(0.075, 10);
      expect(summary.byProduct[ProductType.Traces]!.totalCostInUSD).toBeCloseTo(
        0.4,
        10,
      );
      // 0.3 + 0.15 + 0.2 + 0.025: what the rows cost, not a cent more.
      expect(summary.total.totalCostInUSD).toBeCloseTo(0.675, 10);
    });

    test("says nothing of the exceptions' cost unless the caller may read it", async () => {
      const summary: TelemetryUsageSummary = await readProject(false);

      expect(JSON.stringify(summary)).not.toContain("totalCostInUSD");
    });
  });

  test("lists a resource's exceptions apart from its spans, and one that sent only exceptions without Traces", async () => {
    answerDays([]);
    answerResources([
      {
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        productType: ProductType.Traces,
        dataIngestedInGB: "2",
        totalCostInUSD: "0.2",
        exceptionDataIngestedInGB: "1",
        exceptionCostInUSD: "0.1",
        retentionInDays: 15,
      },
      {
        primaryEntityId: HOST_ID,
        primaryEntityType: ServiceType.Host,
        productType: ProductType.Traces,
        dataIngestedInGB: "0",
        totalCostInUSD: "0",
        exceptionDataIngestedInGB: "4",
        exceptionCostInUSD: "0.8",
        retentionInDays: 30,
      },
      // Counted before: all of it Traces.
      {
        primaryEntityId: RUM_APP_ID,
        primaryEntityType: ServiceType.RealUserMonitor,
        productType: ProductType.Traces,
        dataIngestedInGB: "0.5",
        totalCostInUSD: "0.05",
        retentionInDays: 15,
      },
    ]);
    answerLatest("2026-10-03");

    const summary: TelemetryUsageSummary = await readProject(true);
    const byId: Map<string, TelemetryUsageResourceSummary> = new Map(
      summary.resources.map(
        (
          resource: TelemetryUsageResourceSummary,
        ): [string, TelemetryUsageResourceSummary] => {
          return [resource.primaryEntityId, resource];
        },
      ),
    );

    expect(byId.get(SERVICE_ID)!.byProduct).toEqual({
      [ProductType.Traces]: { dataIngestedInGB: 2, totalCostInUSD: 0.2 },
      [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: {
        dataIngestedInGB: 1,
        totalCostInUSD: 0.1,
      },
    });
    expect(byId.get(SERVICE_ID)!.total.dataIngestedInGB).toBe(3);
    expect(byId.get(SERVICE_ID)!.total.totalCostInUSD).toBeCloseTo(0.3, 10);
    expect(byId.get(SERVICE_ID)!.retentionInDays).toBe(15);

    expect(byId.get(HOST_ID)!.byProduct).toEqual({
      [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: {
        dataIngestedInGB: 4,
        totalCostInUSD: 0.8,
      },
    });
    // The retention of the traces they were counted with.
    expect(byId.get(HOST_ID)!.retentionInDays).toBe(30);

    expect(byId.get(RUM_APP_ID)!.byProduct).toEqual({
      [ProductType.Traces]: { dataIngestedInGB: 0.5, totalCostInUSD: 0.05 },
    });

    // Heaviest first, by everything each sent.
    expect(
      summary.resources.map(
        (resource: TelemetryUsageResourceSummary): string => {
          return resource.primaryEntityId;
        },
      ),
    ).toEqual([HOST_ID, SERVICE_ID, RUM_APP_ID]);
  });

  describe("every project, for the instance admin", () => {
    beforeEach(() => {
      answers.push({
        match: /AS "projectName"/,
        rows: [
          {
            projectId: "aaaaaaaa-0000-4000-8000-000000000001",
            projectName: "Alpha",
            productType: ProductType.Traces,
            dataIngestedInGB: "10",
            totalCostInUSD: "1",
            exceptionDataIngestedInGB: "1",
            exceptionCostInUSD: "0.1",
          },
          {
            projectId: "bbbbbbbb-0000-4000-8000-000000000002",
            projectName: "Beta",
            productType: ProductType.Traces,
            dataIngestedInGB: "2",
            totalCostInUSD: "0.2",
            exceptionDataIngestedInGB: "8",
            exceptionCostInUSD: "0.8",
          },
          {
            projectId: "cccccccc-0000-4000-8000-000000000003",
            projectName: "Gamma",
            productType: ProductType.Logs,
            dataIngestedInGB: "20",
            totalCostInUSD: "2",
            exceptionDataIngestedInGB: "0",
            exceptionCostInUSD: "0",
          },
        ],
      });
    });

    async function readPage(
      sortBy: TelemetryProjectUsageSortBy,
    ): Promise<TelemetryProjectUsagePage> {
      return await TelemetryUsageReads.getUsageByProject({
        window: WINDOW,
        isCostIncluded: true,
        sortBy: sortBy,
        sortOrder: "desc",
        skip: 0,
        limit: 50,
      });
    }

    test("shows each project's exceptions apart, and the instance's", async () => {
      const page: TelemetryProjectUsagePage = await readPage("total");

      expect(page.byProduct[ProductType.Traces]!.dataIngestedInGB).toBe(12);
      expect(
        page.byProduct[TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]!.dataIngestedInGB,
      ).toBe(9);
      expect(page.total.dataIngestedInGB).toBe(41);
      expect(page.total.totalCostInUSD).toBeCloseTo(4.1, 10);

      const beta: TelemetryProjectUsageSummary = page.projects.find(
        (project: TelemetryProjectUsageSummary): boolean => {
          return project.projectName === "Beta";
        },
      )!;

      expect(beta.byProduct).toEqual({
        [ProductType.Traces]: { dataIngestedInGB: 2, totalCostInUSD: 0.2 },
        [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: {
          dataIngestedInGB: 8,
          totalCostInUSD: 0.8,
        },
      });
    });

    test("sorts by the exceptions, and by the traces as they are shown", async () => {
      const names: (page: TelemetryProjectUsagePage) => Array<string | null> = (
        page: TelemetryProjectUsagePage,
      ): Array<string | null> => {
        return page.projects.map((project: TelemetryProjectUsageSummary) => {
          return project.projectName;
        });
      };

      expect(names(await readPage(TELEMETRY_USAGE_EXCEPTIONS_SIGNAL))).toEqual([
        "Beta",
        "Alpha",
        "Gamma",
      ]);
      expect(names(await readPage(ProductType.Traces))).toEqual([
        "Alpha",
        "Beta",
        "Gamma",
      ]);
    });
  });

  describe("a group of rows' signals", () => {
    test("are its product's alone, for any product but Traces", () => {
      expect(
        getSignalAmounts(
          {
            productType: ProductType.Logs,
            dataIngestedInGB: "2",
            totalCostInUSD: "0.2",
            // Never set on another product's row; ignored if it were.
            exceptionDataIngestedInGB: "1",
            exceptionCostInUSD: "0.1",
          },
          true,
        ),
      ).toEqual([
        {
          signal: ProductType.Logs,
          amount: { dataIngestedInGB: 2, totalCostInUSD: 0.2 },
        },
      ]);
    });

    test("are Traces and Exceptions apart, for Traces with exceptions", () => {
      expect(
        getSignalAmounts(
          {
            productType: ProductType.Traces,
            dataIngestedInGB: "2",
            totalCostInUSD: "0.2",
            exceptionDataIngestedInGB: "1",
            exceptionCostInUSD: "0.1",
          },
          false,
        ),
      ).toEqual([
        { signal: ProductType.Traces, amount: { dataIngestedInGB: 2 } },
        {
          signal: TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
          amount: { dataIngestedInGB: 1 },
        },
      ]);
    });

    test("are Traces alone for rows with no exceptions part - read from before #6356 too", () => {
      for (const part of [undefined, null, "0", 0, "not a number"]) {
        expect(
          getSignalAmounts(
            {
              productType: ProductType.Traces,
              dataIngestedInGB: "3",
              totalCostInUSD: "0.3",
              exceptionDataIngestedInGB: part as never,
              exceptionCostInUSD: part as never,
            },
            false,
          ),
        ).toEqual([
          { signal: ProductType.Traces, amount: { dataIngestedInGB: 3 } },
        ]);
      }
    });
  });
});
