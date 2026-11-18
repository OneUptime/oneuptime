import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import { EVERY_DAY } from "Common/Utils/CronTime";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Rum:EnforceProductAnalyticsRetention (issue #6626). Each RUM application
 * chooses how long product analytics keeps it; the tables' TTL keeps the
 * longest choice, and this job deletes every application's rows older than
 * its own, the default 13 months included. These tests pin how the
 * applications are grouped by their choice, the statements each group
 * gets, that a delete is queued only when its probe finds a row, and that
 * one table's failure does not stop the others.
 * EnforceProductAnalyticsRetentionClickhouse.test.ts runs it against a real
 * ClickHouse server.
 */

const cronCalls: Array<{ name: string; options: unknown }> = [];

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: (name: string, options: unknown): void => {
      cronCalls.push({ name: name, options: options });
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import {
  PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT,
  PRODUCT_ANALYTICS_RETENTION_SCHEDULE,
  PRODUCT_ANALYTICS_RETENTION_TABLES,
  ProductAnalyticsRetentionBucket,
  ProductAnalyticsRetentionResult,
  ProductAnalyticsRetentionTable,
  buildProductAnalyticsRetentionBuckets,
  buildProductAnalyticsRetentionDelete,
  buildProductAnalyticsRetentionProbe,
  buildProductAnalyticsRetentionWheres,
  enforceProductAnalyticsRetention,
} from "../../FeatureSet/Workers/Jobs/Rum/EnforceProductAnalyticsRetention";

const NOW: Date = new Date("2026-11-18T10:30:00.000Z");
const databaseName: string = "oneuptime";

const threeMonths: string = "6600000000000000000000a3";
const sixMonths: string = "6600000000000000000000a6";
const twentyFive: string = "66000000000000000000a025";

function params(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params).flatMap((value: unknown) => {
    return Array.isArray(value) ? value : [value];
  });
}

function tableOf(
  tableName: AnalyticsTableName,
): ProductAnalyticsRetentionTable {
  return PRODUCT_ANALYTICS_RETENTION_TABLES.find(
    (table: ProductAnalyticsRetentionTable): boolean => {
      return table.tableName === tableName;
    },
  )!;
}

function hexIds(count: number, seed: string): Array<string> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return `${seed}${index.toString(16).padStart(24 - seed.length, "0")}`;
  });
}

describe("how the applications are grouped by what they keep", () => {
  test("nobody chose otherwise: one delete, every application's rows older than 13 months", () => {
    expect(
      buildProductAnalyticsRetentionBuckets({ choices: [], now: NOW }),
    ).toEqual([
      {
        months: 13,
        cutoff: new Date("2025-11-01T00:00:00.000Z"),
        mode: "allBut",
        rumApplicationIds: [],
      },
    ]);
  });

  test("a shorter choice names its applications; the default names those who chose more; the longest is the TTL's", () => {
    const buckets: Array<ProductAnalyticsRetentionBucket> =
      buildProductAnalyticsRetentionBuckets({
        choices: [
          { rumApplicationId: twentyFive, months: 25 },
          { rumApplicationId: sixMonths, months: 6 },
          { rumApplicationId: threeMonths, months: 3 },
          // Listed twice, by two writes: named once.
          { rumApplicationId: threeMonths, months: 3 },
        ],
        now: NOW,
      });

    expect(buckets).toEqual([
      {
        months: 3,
        cutoff: new Date("2026-09-01T00:00:00.000Z"),
        mode: "only",
        rumApplicationIds: [threeMonths],
      },
      {
        months: 6,
        cutoff: new Date("2026-06-01T00:00:00.000Z"),
        mode: "only",
        rumApplicationIds: [sixMonths],
      },
      {
        months: 13,
        cutoff: new Date("2025-11-01T00:00:00.000Z"),
        mode: "allBut",
        rumApplicationIds: [twentyFive],
      },
    ]);
  });

  test("a choice nobody made gets no delete of its own", () => {
    const buckets: Array<ProductAnalyticsRetentionBucket> =
      buildProductAnalyticsRetentionBuckets({
        choices: [{ rumApplicationId: sixMonths, months: 6 }],
        now: NOW,
      });

    expect(
      buckets.map((bucket: ProductAnalyticsRetentionBucket): number => {
        return bucket.months;
      }),
    ).toEqual([6, 13]);
  });
});

describe("the statements", () => {
  test("only: the rows older than the cutoff of the applications named, a thousand to a statement", () => {
    const ids: Array<string> = hexIds(
      PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT + 500,
      "aa",
    );

    const wheres: Array<Statement> = buildProductAnalyticsRetentionWheres({
      table: tableOf(AnalyticsTableName.RumProductAnalyticsSession),
      bucket: {
        months: 3,
        cutoff: new Date("2026-09-01T00:00:00.000Z"),
        mode: "only",
        rumApplicationIds: ids,
      },
    });

    expect(PRODUCT_ANALYTICS_RETENTION_IDS_PER_STATEMENT).toBe(1000);
    expect(wheres).toHaveLength(2);

    for (const where of wheres) {
      expect(where.query).toMatch(
        /^startTime < \{p0:DateTime64\(9\)\} AND rumApplicationId IN \{p1:Array\(String\)\}$/,
      );
      expect(params(where)).toContain("2026-09-01 00:00:00.000000000");
    }

    expect(params(wheres[0]!).length - 1).toBe(1000);
    expect(params(wheres[1]!).length - 1).toBe(500);
  });

  test("allBut: one statement, every application but those named, a thousand to a bound list", () => {
    const keepers: Array<string> = hexIds(2500, "bb");

    const wheres: Array<Statement> = buildProductAnalyticsRetentionWheres({
      table: tableOf(AnalyticsTableName.RumProductAnalyticsEvent),
      bucket: {
        months: 13,
        cutoff: new Date("2025-11-01T00:00:00.000Z"),
        mode: "allBut",
        rumApplicationIds: keepers,
      },
    });

    expect(wheres).toHaveLength(1);
    expect(wheres[0]!.query).toBe(
      "time < {p0:DateTime64(9)} AND rumApplicationId NOT IN {p1:Array(String)} AND rumApplicationId NOT IN {p2:Array(String)} AND rumApplicationId NOT IN {p3:Array(String)}",
    );

    for (const keeper of keepers) {
      expect(params(wheres[0]!)).toContain(keeper);
    }
  });

  test("allBut with nobody to keep: every row older than the cutoff", () => {
    const wheres: Array<Statement> = buildProductAnalyticsRetentionWheres({
      table: tableOf(AnalyticsTableName.RumProductAnalyticsUser),
      bucket: {
        months: 13,
        cutoff: new Date("2025-11-01T00:00:00.000Z"),
        mode: "allBut",
        rumApplicationIds: [],
      },
    });

    /* The monthly rows are aged by their month, a Date. */
    expect(
      wheres.map((where: Statement): string => {
        return where.query;
      }),
    ).toEqual(["month < {p0:DateTime}"]);
    expect(params(wheres[0]!)).toEqual(["2025-11-01 00:00:00"]);
  });

  test("each table is aged by its own column", () => {
    expect(
      PRODUCT_ANALYTICS_RETENTION_TABLES.map(
        (table: ProductAnalyticsRetentionTable): string => {
          return `${table.tableName}.${table.timeColumn}`;
        },
      ),
    ).toEqual([
      "RumProductAnalyticsSessionV1.startTime",
      "RumProductAnalyticsUserV1.month",
      "RumProductAnalyticsEventV1.time",
    ]);
  });

  test("the probe reads the cluster's table, one row at most; the delete is a mutation on every shard's own", () => {
    const table: ProductAnalyticsRetentionTable = tableOf(
      AnalyticsTableName.RumProductAnalyticsSession,
    );
    const where: Statement = buildProductAnalyticsRetentionWheres({
      table: table,
      bucket: {
        months: 3,
        cutoff: new Date("2026-09-01T00:00:00.000Z"),
        mode: "only",
        rumApplicationIds: [threeMonths],
      },
    })[0]!;

    const probe: Statement = buildProductAnalyticsRetentionProbe({
      databaseName: databaseName,
      table: table,
      where: where,
    });

    expect(probe.query).toMatch(/^SELECT 1 AS paFound FROM /);
    expect(probe.query).toMatch(/ LIMIT 1$/);
    expect(params(probe)).toContain("RumProductAnalyticsSessionV1");
    expect(params(probe)).not.toContain("RumProductAnalyticsSessionV1Local");

    const deletion: Statement = buildProductAnalyticsRetentionDelete({
      databaseName: databaseName,
      table: table,
      where: where,
    });

    expect(deletion.query).toMatch(/^ALTER TABLE /);
    expect(deletion.query).toContain(" ON CLUSTER ");
    expect(deletion.query).toContain(" DELETE WHERE startTime < ");
    expect(params(deletion)).toContain("RumProductAnalyticsSessionV1Local");
    expect(params(deletion)).toContain(threeMonths);
    /* Nothing written into the SQL. */
    expect(deletion.query).not.toContain(threeMonths);
    expect(deletion.query).not.toContain("2026-09-01");
  });
});

describe("a run", () => {
  interface Call {
    table: AnalyticsTableName;
    kind: "probe" | "delete";
    statement: Statement;
    options: ClickhouseExecuteOptions | undefined;
  }

  let calls: Array<Call>;
  let findAllByArgument: unknown;

  function install(data: {
    applications: Array<{ id: string; months: number }>;
    /* Whether a probe finds a row, from the table and the statement. */
    found?:
      | ((table: AnalyticsTableName, statement: Statement) => boolean)
      | undefined;
    failing?: AnalyticsTableName | undefined;
  }): void {
    const recorded: Array<Call> = [];
    calls = recorded;

    jest.spyOn(RumApplicationService, "findAllBy").mockImplementation((async (
      argument: unknown,
    ) => {
      findAllByArgument = argument;

      return data.applications.map(
        (entry: { id: string; months: number }): RumApplication => {
          const application: RumApplication = new RumApplication();
          application.id = new ObjectID(entry.id);
          application.productAnalyticsRetentionInMonths = entry.months;
          return application;
        },
      );
    }) as never);

    const services: Array<[AnalyticsTableName, unknown]> = [
      [
        AnalyticsTableName.RumProductAnalyticsSession,
        RumProductAnalyticsSessionService,
      ],
      [
        AnalyticsTableName.RumProductAnalyticsUser,
        RumProductAnalyticsUserService,
      ],
      [
        AnalyticsTableName.RumProductAnalyticsEvent,
        RumProductAnalyticsEventService,
      ],
    ];

    for (const [tableName, service] of services) {
      jest
        .spyOn(
          service as {
            executeQuery: (
              statement: Statement,
              options?: ClickhouseExecuteOptions,
            ) => Promise<unknown>;
          },
          "executeQuery",
        )
        .mockImplementation((async (
          statement: Statement,
          options?: ClickhouseExecuteOptions,
        ) => {
          recorded.push({
            table: tableName,
            kind: "probe",
            statement: statement,
            options: options,
          });

          if (data.failing === tableName) {
            throw new Error("Too many parts");
          }

          const found: boolean = data.found
            ? data.found(tableName, statement)
            : true;

          return {
            json: (): Promise<{ data: Array<JSONObject> }> => {
              return Promise.resolve({ data: found ? [{ paFound: 1 }] : [] });
            },
          };
        }) as never);

      jest
        .spyOn(
          service as {
            execute: (
              statement: Statement,
              options?: ClickhouseExecuteOptions,
            ) => Promise<unknown>;
          },
          "execute",
        )
        .mockImplementation((async (
          statement: Statement,
          options?: ClickhouseExecuteOptions,
        ) => {
          recorded.push({
            table: tableName,
            kind: "delete",
            statement: statement,
            options: options,
          });
          return {};
        }) as never);
    }
  }

  beforeEach(() => {
    findAllByArgument = undefined;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads only the applications that chose other than the default, as root", async () => {
    install({ applications: [] });

    await enforceProductAnalyticsRetention({
      databaseName: databaseName,
      now: NOW,
    });

    const argument: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: { isRoot: boolean };
    } = findAllByArgument as never;

    expect(Object.keys(argument.query)).toEqual([
      "productAnalyticsRetentionInMonths",
    ]);
    expect(argument.select).toEqual({
      _id: true,
      productAnalyticsRetentionInMonths: true,
    });
    expect(argument.props.isRoot).toBe(true);
  });

  test("probes every group on every table, and deletes where a probe finds rows", async () => {
    install({
      applications: [
        { id: threeMonths, months: 3 },
        { id: twentyFive, months: 25 },
      ],
      /* Only the events of the 3-month application are past its retention. */
      found: (table: AnalyticsTableName, statement: Statement): boolean => {
        return (
          table === AnalyticsTableName.RumProductAnalyticsEvent &&
          params(statement).includes(threeMonths) &&
          statement.query.includes("rumApplicationId IN")
        );
      },
    });

    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: databaseName,
        now: NOW,
      });

    /* Two groups (3 months, and the default but the 25-month one) on three tables. */
    expect(
      calls.filter((call: Call): boolean => {
        return call.kind === "probe";
      }),
    ).toHaveLength(6);

    const deletes: Array<Call> = calls.filter((call: Call): boolean => {
      return call.kind === "delete";
    });

    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.table).toBe(AnalyticsTableName.RumProductAnalyticsEvent);
    expect(deletes[0]!.statement.query).toContain(" DELETE WHERE time < ");
    expect(params(deletes[0]!.statement)).toContain(threeMonths);
    expect(params(deletes[0]!.statement)).toContain(
      "2026-09-01 00:00:00.000000000",
    );
    expect(deletes[0]!.options).toBe(MigrationExecuteOptions);

    /* Every probe goes through the migration pool too. */
    for (const call of calls) {
      expect(call.options).toBe(MigrationExecuteOptions);
    }

    expect(result).toEqual({ deletesSubmitted: 1, failures: [] });
  });

  test("the default's delete keeps the applications that chose more, and takes everyone else's", async () => {
    install({
      applications: [{ id: twentyFive, months: 25 }],
    });

    await enforceProductAnalyticsRetention({
      databaseName: databaseName,
      now: NOW,
    });

    const deletes: Array<Call> = calls.filter((call: Call): boolean => {
      return call.kind === "delete";
    });

    expect(deletes).toHaveLength(3);

    for (const deletion of deletes) {
      expect(deletion.statement.query).toContain("rumApplicationId NOT IN");
      expect(params(deletion.statement)).toContain(twentyFive);
    }
  });

  test("nothing past anyone's retention: no delete at all", async () => {
    install({
      applications: [{ id: sixMonths, months: 6 }],
      found: (): boolean => {
        return false;
      },
    });

    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: databaseName,
        now: NOW,
      });

    expect(
      calls.filter((call: Call): boolean => {
        return call.kind === "delete";
      }),
    ).toEqual([]);
    expect(result.deletesSubmitted).toBe(0);
  });

  test("a table that fails is reported, and the others still run", async () => {
    install({
      applications: [],
      failing: AnalyticsTableName.RumProductAnalyticsUser,
    });

    const result: ProductAnalyticsRetentionResult =
      await enforceProductAnalyticsRetention({
        databaseName: databaseName,
        now: NOW,
      });

    expect(result.deletesSubmitted).toBe(2);
    expect(result.failures).toEqual([
      "RumProductAnalyticsUserV1: Too many parts",
    ]);
    expect(
      calls
        .filter((call: Call): boolean => {
          return call.kind === "delete";
        })
        .map((call: Call): AnalyticsTableName => {
          return call.table;
        }),
    ).toEqual([
      AnalyticsTableName.RumProductAnalyticsSession,
      AnalyticsTableName.RumProductAnalyticsEvent,
    ]);
  });
});

describe("registration", () => {
  test("runs once a day, not on startup", () => {
    expect(PRODUCT_ANALYTICS_RETENTION_SCHEDULE).toBe(EVERY_DAY);

    const registered: { name: string; options: unknown } | undefined =
      cronCalls.find((call: { name: string }): boolean => {
        return call.name === "Rum:EnforceProductAnalyticsRetention";
      });

    expect(registered?.options).toEqual({
      schedule: EVERY_DAY,
      runOnStartup: false,
    });
  });

  test("is imported by the workers, beside the other session replay jobs", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import "./Jobs/Rum/EnforceProductAnalyticsRetention";',
    );
  });
});
