/** @timezone Asia/Kolkata */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudCostRecommendation from "../../../../Models/DatabaseModels/CloudCostRecommendation";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../../Models/DatabaseModels/Index";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import ToolImportRun from "../../../../Models/DatabaseModels/ToolImportRun";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import SecurityEventConnectionRunService from "../../../../Server/Services/SecurityEventConnectionRunService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import CloudSavingsWriter from "../../../../Server/Utils/CloudConnection/CloudSavingsWriter";
import DiscoveryImportRunner from "../../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import SecurityEventConnectionRunExecutor from "../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import ToolImportRunExecutor from "../../../../Server/Utils/ToolImport/ToolImportRunExecutor";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import QueryOperator from "../../../../Types/BaseDatabase/QueryOperator";
import Search from "../../../../Types/BaseDatabase/Search";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CLOUD_SAVINGS_SOURCE_ONEUPTIME } from "../../../../Types/Cloud/CloudRightSizing";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import { DiscoveryImportStatus } from "../../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../../Types/ObjectID";
import ToolImportRunStatus from "../../../../Types/ToolImport/ToolImportRunStatus";
import { readDateComparison } from "../../TestingUtils/DateComparisonPredicate";
import { DataSource, EntityMetadata, FindOptionsWhere } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

/*
 * DATE COMPARISONS ON POSTGRES TELL ROWS MINUTES APART (#8200).
 *
 * Every comparison QueryUtil writes, given a Date, run on Postgres against
 * rows minutes and milliseconds apart; then the real queries of each
 * server caller that compares a date column with a Date it built: the
 * security-event stale-run check (runs idle over 20 minutes), the tool
 * import and discovery import sweeps, and the cloud-savings cleanup. Until
 * #8200 each bound its Date as the day alone, and was off by up to a day.
 * And each comparison nested under a relation, through the join: a run
 * filtered by its connection's lastPolledAt (#8378), which until then
 * reached TypeORM unserialized and was refused.
 *
 * The process runs in Asia/Kolkata and every Postgres session in
 * America/New_York, so neither zone can stand in for the other: a bound is
 * read exactly or the rows show it.
 *
 * Needs only a bare Postgres: CI's Common test job sets the flag for the
 * one test-setup.sh starts. Each model's table is made from its own column
 * metadata in a schema of its own, dropped afterwards. Locally, against a
 * throwaway container:
 *
 *   docker run -d --name date-comparison-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55432:5432 postgres:15
 *   RUN_POSTGRES_DATE_COMPARISON_TESTS=true \
 *   DATE_COMPARISON_TEST_DATABASE_HOST=127.0.0.1 \
 *   DATE_COMPARISON_TEST_DATABASE_PORT=55432 \
 *   DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Types/Database/DateComparisonPostgres.test.ts
 *   docker rm -f date-comparison-pg
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DATE_COMPARISON_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `date_comparison_${process.pid}_${Date.now()}`;

const SESSION_TIME_ZONE: string = "America/New_York";

const MODELS: Array<{ new (): BaseModel }> = [
  SecurityEventConnectionRun,
  SecurityEventConnection,
  ToolImportRun,
  NetworkDeviceDiscoveryImport,
  CloudCostRecommendation,
];

const NOW: Date = new Date("2026-11-15T10:00:00.000Z");

function minutesBefore(at: Date, minutes: number): Date {
  return new Date(at.getTime() - minutes * 60_000);
}

describePostgres("date comparisons on Postgres", () => {
  let database: DataSource;

  const tableOf: (model: { new (): BaseModel }) => string = (model: {
    new (): BaseModel;
  }): string => {
    return `"${SCHEMA}"."${database.getMetadata(model).tableName}"`;
  };

  // A row with just these columns; the rest of the model's are null.
  async function insert(
    model: { new (): BaseModel },
    row: Record<string, unknown>,
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();
    const values: Record<string, unknown> = { _id: id, ...row };
    const columns: Array<string> = Object.keys(values);

    await database.query(
      `INSERT INTO ${tableOf(model)} (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = values[column];
        return value instanceof Date ? value.toISOString() : value;
      }),
    );

    return id;
  }

  async function readColumn(
    model: { new (): BaseModel },
    id: string,
    column: string,
  ): Promise<unknown> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT "${column}" AS value FROM ${tableOf(model)} WHERE "_id" = $1`,
      [id],
    );

    return rows[0] ? rows[0]["value"] : undefined;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["DATE_COMPARISON_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["DATE_COMPARISON_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DATE_COMPARISON_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: SCHEMA,
      synchronize: false,
      extra: {
        options: `-c search_path=${SCHEMA} -c TimeZone=${SESSION_TIME_ZONE}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${SCHEMA}"`);

    /*
     * Each model's own columns, typed as TypeORM types them (a date is a
     * timestamptz), without the foreign keys: the rows stand alone.
     */
    for (const model of MODELS) {
      const metadata: EntityMetadata = database.getMetadata(model);
      const columns: Map<string, string> = new Map<string, string>();

      for (const column of metadata.columns as Array<ColumnMetadata>) {
        if (columns.has(column.databaseName)) {
          continue;
        }

        let definition: string = database.driver.normalizeType(column);

        if (column.isPrimary) {
          definition += " PRIMARY KEY";
        } else if (column.isCreateDate || column.isUpdateDate) {
          definition += " NOT NULL DEFAULT now()";
        } else if (column.isVersion) {
          definition += " NOT NULL DEFAULT 1";
        }

        columns.set(column.databaseName, definition);
      }

      await database.query(
        `CREATE TABLE ${tableOf(model)} (${Array.from(columns.entries())
          .map(([name, definition]: [string, string]): string => {
            return `"${name}" ${definition}`;
          })
          .join(", ")})`,
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const model of MODELS) {
      await database.query(`TRUNCATE ${tableOf(model)}`);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every session reads in its own zone, not UTC", async () => {
    const rows: Array<{ zone: string }> = await database.query(
      "SELECT current_setting('TimeZone') AS zone",
    );

    expect(rows[0]!.zone).toBe(SESSION_TIME_ZONE);
    expect(new Date().getTimezoneOffset()).toBe(-330);
  });

  describe("each comparison, on rows minutes and milliseconds apart", () => {
    const BOUND: Date = new Date("2026-11-15T09:40:00.000Z");

    const ROWS: Record<string, Date | null> = {
      "a day before": new Date("2026-11-14T23:59:00.000Z"),
      "25 minutes before": minutesBefore(BOUND, 25),
      "a millisecond before": new Date(BOUND.getTime() - 1),
      "at the bound": BOUND,
      "a millisecond after": new Date(BOUND.getTime() + 1),
      "5 minutes after": minutesBefore(BOUND, -5),
      "no value": null,
    };

    const projectId: string = ObjectID.generate().toString();
    const names: Map<string, string> = new Map<string, string>();

    beforeEach(async () => {
      names.clear();

      for (const [name, completedAt] of Object.entries(ROWS)) {
        names.set(
          await insert(SecurityEventConnectionRun, {
            projectId,
            status: "completed",
            completedAt,
          }),
          name,
        );
      }
    });

    async function found(value: unknown): Promise<Array<string>> {
      const where: Query<SecurityEventConnectionRun> = QueryUtil.serializeQuery(
        SecurityEventConnectionRun,
        {
          projectId: projectId,
          completedAt: value,
        } as unknown as Query<SecurityEventConnectionRun>,
      );

      const runs: Array<SecurityEventConnectionRun> = await database
        .getRepository(SecurityEventConnectionRun)
        .find({
          select: { _id: true },
          where:
            where as unknown as FindOptionsWhere<SecurityEventConnectionRun>,
        });

      return runs
        .map((run: SecurityEventConnectionRun): string => {
          return names.get(run._id!)!;
        })
        .sort();
    }

    // What the SQL QueryUtil wrote says, read the way Postgres reads it.
    function predicted(value: unknown): Array<string> {
      const comparison: ReturnType<typeof readDateComparison> =
        readDateComparison(
          (
            QueryUtil.serializeQuery(SecurityEventConnectionRun, {
              completedAt: value,
            } as unknown as Query<SecurityEventConnectionRun>) as unknown as Record<
              string,
              unknown
            >
          )["completedAt"],
        );

      return Object.entries(ROWS)
        .filter(([, at]: [string, Date | null]): boolean => {
          return comparison.matches(at);
        })
        .map(([name]: [string, Date | null]): string => {
          return name;
        })
        .sort();
    }

    interface ComparisonCase {
      name: string;
      create: (at: Date | string) => QueryOperator<Date | string>;
      // The rows it finds, by name.
      rows: Array<string>;
    }

    const CASES: Array<ComparisonCase> = [
      {
        name: "LessThan",
        create: (at: Date | string) => {
          return new LessThan(at);
        },
        rows: ["25 minutes before", "a day before", "a millisecond before"],
      },
      {
        name: "LessThanOrEqual",
        create: (at: Date | string) => {
          return new LessThanOrEqual(at);
        },
        rows: [
          "25 minutes before",
          "a day before",
          "a millisecond before",
          "at the bound",
        ],
      },
      {
        name: "GreaterThan",
        create: (at: Date | string) => {
          return new GreaterThan(at);
        },
        rows: ["5 minutes after", "a millisecond after"],
      },
      {
        name: "GreaterThanOrEqual",
        create: (at: Date | string) => {
          return new GreaterThanOrEqual(at);
        },
        rows: ["5 minutes after", "a millisecond after", "at the bound"],
      },
      {
        name: "LessThanOrNull",
        create: (at: Date | string) => {
          return new LessThanOrNull(at);
        },
        rows: [
          "25 minutes before",
          "a day before",
          "a millisecond before",
          "no value",
        ],
      },
      {
        name: "GreaterThanOrNull",
        create: (at: Date | string) => {
          return new GreaterThanOrNull(at);
        },
        rows: ["5 minutes after", "a millisecond after", "no value"],
      },
      {
        name: "EqualTo",
        create: (at: Date | string) => {
          return new EqualTo(at);
        },
        rows: ["at the bound"],
      },
      {
        name: "NotEqual",
        create: (at: Date | string) => {
          return new NotEqual(at);
        },
        rows: [
          "25 minutes before",
          "5 minutes after",
          "a day before",
          "a millisecond after",
          "a millisecond before",
        ],
      },
      {
        name: "EqualToOrNull",
        create: (at: Date | string) => {
          return new EqualToOrNull(at);
        },
        rows: ["at the bound", "no value"],
      },
      {
        name: "InBetween, 25 minutes before to the bound",
        create: (at: Date | string) => {
          return typeof at === "string"
            ? new InBetween(minutesBefore(new Date(at), 25).toISOString(), at)
            : new InBetween(minutesBefore(at, 25), at);
        },
        rows: ["25 minutes before", "a millisecond before", "at the bound"],
      },
    ];

    test.each(CASES)(
      "$name, given a Date built on the server",
      async (item: ComparisonCase) => {
        const rows: Array<string> = await found(item.create(BOUND));

        expect(rows).toEqual([...item.rows].sort());
        expect(predicted(item.create(BOUND))).toEqual(rows);
      },
    );

    test.each(CASES)(
      "$name, sent by a browser (its Date as JSON)",
      async (item: ComparisonCase) => {
        const wire: JSONObject = JSON.parse(
          JSON.stringify(
            JSONFunctions.serialize({
              completedAt: item.create(BOUND),
            } as unknown as JSONObject),
          ),
        ) as JSONObject;

        expect(
          await found(JSONFunctions.deserialize(wire)["completedAt"]),
        ).toEqual([...item.rows].sort());
      },
    );

    test("a day written as text is still the day, as before", async () => {
      // Read in the session's zone, as Postgres always read the day cut.
      expect(await found(new LessThan("2026-11-15"))).toEqual(["a day before"]);
    });

    /*
     * #8378: each comparison on the related record's column, nested under
     * the relation - a run filtered by when its connection was last polled.
     * TypeORM joins the connection and applies to the joined column what
     * QueryUtil wrote. Until #8378 the operator reached TypeORM as the
     * class itself, bound as its JSON, and Postgres refused the read.
     */
    describe("nested under a relation, through the join (#8378)", () => {
      const nestedProjectId: string = ObjectID.generate().toString();
      // A run's id, to the name of the row its connection was polled at.
      const runs: Map<string, string> = new Map<string, string>();

      beforeEach(async () => {
        runs.clear();

        let interval: number = 0;

        for (const [name, lastPolledAt] of Object.entries(ROWS)) {
          interval++;

          const connectionId: string = await insert(SecurityEventConnection, {
            projectId: nestedProjectId,
            name: name,
            lastPolledAt: lastPolledAt,
            pollIntervalInMinutes: interval,
          });

          runs.set(
            await insert(SecurityEventConnectionRun, {
              projectId: nestedProjectId,
              status: "completed",
              securityEventConnectionId: connectionId,
            }),
            name,
          );
        }
      });

      // The runs whose connection the filter holds, by the name of its row.
      async function runsWhoseConnection(
        filter: Record<string, unknown>,
      ): Promise<Array<string>> {
        const where: Query<SecurityEventConnectionRun> =
          QueryUtil.serializeQuery(SecurityEventConnectionRun, {
            projectId: nestedProjectId,
            securityEventConnection: filter,
          } as unknown as Query<SecurityEventConnectionRun>);

        const found: Array<SecurityEventConnectionRun> = await database
          .getRepository(SecurityEventConnectionRun)
          .find({
            select: { _id: true },
            where:
              where as unknown as FindOptionsWhere<SecurityEventConnectionRun>,
          });

        return found
          .map((run: SecurityEventConnectionRun): string => {
            return runs.get(run._id!)!;
          })
          .sort();
      }

      test("as it was: the operator handed to TypeORM as the class is refused by Postgres", async () => {
        await expect(
          database.getRepository(SecurityEventConnectionRun).find({
            select: { _id: true },
            where: {
              projectId: nestedProjectId,
              securityEventConnection: { lastPolledAt: new LessThan(BOUND) },
            } as unknown as FindOptionsWhere<SecurityEventConnectionRun>,
          }),
        ).rejects.toThrow(
          /invalid input syntax for type timestamp with time zone/,
        );
      });

      test.each(CASES)(
        "$name finds the runs whose connection it holds, minutes and milliseconds apart",
        async (item: ComparisonCase) => {
          expect(
            await runsWhoseConnection({ lastPolledAt: item.create(BOUND) }),
          ).toEqual([...item.rows].sort());
        },
      );

      test.each(CASES)(
        "$name, sent by a browser (its Date as JSON), finds the same runs",
        async (item: ComparisonCase) => {
          const wire: JSONObject = JSON.parse(
            JSON.stringify(
              JSONFunctions.serialize({
                securityEventConnection: { lastPolledAt: item.create(BOUND) },
              } as unknown as JSONObject),
            ),
          ) as JSONObject;

          expect(
            await runsWhoseConnection(
              JSONFunctions.deserialize(wire)[
                "securityEventConnection"
              ] as Record<string, unknown>,
            ),
          ).toEqual([...item.rows].sort());
        },
      );

      test("a number, a list, a null check and a search on the related record, beside one another", async () => {
        // Polled every 1 to 7 minutes, in the order of ROWS.
        expect(
          await runsWhoseConnection({
            pollIntervalInMinutes: new GreaterThan(5),
          }),
        ).toEqual(["5 minutes after", "no value"]);

        expect(
          await runsWhoseConnection({
            name: new Includes(["at the bound", "a day before"]),
          }),
        ).toEqual(["a day before", "at the bound"]);

        expect(
          await runsWhoseConnection({ lastPolledAt: new IsNull() }),
        ).toEqual(["no value"]);

        expect(
          await runsWhoseConnection({ name: new Search("millisecond") }),
        ).toEqual(["a millisecond after", "a millisecond before"]);

        expect(
          await runsWhoseConnection({
            lastPolledAt: new LessThan(BOUND),
            pollIntervalInMinutes: new GreaterThan(1),
            name: new NotEqual("a millisecond before"),
          }),
        ).toEqual(["25 minutes before"]);
      });

      /*
       * #8466: a filter on the related record's JSON column, as at the top
       * of a query - each key by containment, an operator under a key, a
       * null check on the whole column - through the join.
       */
      test("a filter on the related record's JSON column finds the runs whose connection holds it", async () => {
        const configure: (
          name: string,
          config: Record<string, unknown>,
        ) => Promise<void> = async (
          name: string,
          config: Record<string, unknown>,
        ): Promise<void> => {
          await database.query(
            `UPDATE ${tableOf(SecurityEventConnection)} SET "config" = $1::jsonb WHERE "name" = $2 AND "projectId" = $3`,
            [JSON.stringify(config), name, nestedProjectId],
          );
        };

        await configure("at the bound", { region: "eu", tier: "gold" });
        await configure("a day before", { region: "us", tier: "gold" });
        await configure("5 minutes after", { region: "eu" });

        expect(await runsWhoseConnection({ config: { region: "eu" } })).toEqual(
          ["5 minutes after", "at the bound"],
        );

        expect(
          await runsWhoseConnection({ config: { region: "eu", tier: "gold" } }),
        ).toEqual(["at the bound"]);

        expect(
          await runsWhoseConnection({
            config: { region: new Includes(["us", "eu"]) },
          }),
        ).toEqual(["5 minutes after", "a day before", "at the bound"]);

        const unconfigured: Array<string> = [
          "25 minutes before",
          "a millisecond after",
          "a millisecond before",
          "no value",
        ];

        expect(await runsWhoseConnection({ config: new IsNull() })).toEqual(
          unconfigured,
        );
        expect(await runsWhoseConnection({ config: null })).toEqual(
          unconfigured,
        );

        // Beside a comparison on another column of the related record.
        expect(
          await runsWhoseConnection({
            config: { region: "eu" },
            lastPolledAt: new GreaterThan(BOUND),
          }),
        ).toEqual(["5 minutes after"]);
      });

      test("a plain value under the relation is compared as before", async () => {
        expect(await runsWhoseConnection({ name: "at the bound" })).toEqual([
          "at the bound",
        ]);
      });
    });
  });

  describe("security-event runs idle over 20 minutes", () => {
    beforeEach(() => {
      jest
        .spyOn(Semaphore, "lock")
        .mockResolvedValue({} as unknown as SemaphoreMutex);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
      jest
        .spyOn(SecurityEventConnectionService, "findAllBy")
        .mockResolvedValue([]);
    });

    async function scheduleAt(now: Date): Promise<Array<string>> {
      jest.spyOn(Date, "now").mockReturnValue(now.getTime());
      const findRuns: { mock: { results: Array<{ value: unknown }> } } =
        jest.spyOn(SecurityEventConnectionRunService, "findAllBy");

      await SecurityEventConnectionRunExecutor.enqueueDueConnections();

      const runs: Array<SecurityEventConnectionRun> = (await findRuns.mock
        .results[0]!.value) as Array<SecurityEventConnectionRun>;

      return runs
        .map((run: SecurityEventConnectionRun): string => {
          return run._id!;
        })
        .sort();
    }

    async function run(status: string, updatedAt: Date): Promise<string> {
      return await insert(SecurityEventConnectionRun, {
        projectId: ObjectID.generate().toString(),
        status,
        createdAt: updatedAt,
        updatedAt,
      });
    }

    test("the scheduler fails the runs idle over 20 minutes today, and only those", async () => {
      const idle25: string = await run("running", minutesBefore(NOW, 25));
      const queued21: string = await run("queued", minutesBefore(NOW, 21));
      const yesterday: string = await run(
        "running",
        new Date("2026-11-14T23:59:00.000Z"),
      );
      const idle5: string = await run("running", minutesBefore(NOW, 5));
      const justUnder20: string = await run(
        "running",
        new Date(minutesBefore(NOW, 20).getTime() + 1),
      );
      const done: string = await run("completed", minutesBefore(NOW, 60));

      expect(await scheduleAt(NOW)).toEqual(
        [idle25, queued21, yesterday].sort(),
      );

      for (const failed of [idle25, queued21, yesterday]) {
        expect(
          await readColumn(SecurityEventConnectionRun, failed, "status"),
        ).toBe("failed");
        expect(
          await readColumn(SecurityEventConnectionRun, failed, "error"),
        ).toContain("did not finish this operation within twenty minutes");
      }

      for (const [id, status] of [
        [idle5, "running"],
        [justUnder20, "running"],
        [done, "completed"],
      ] as Array<[string, string]>) {
        expect(await readColumn(SecurityEventConnectionRun, id, "status")).toBe(
          status,
        );
      }
    });

    test("just after midnight, a run idle 15 minutes is not found as stale; one idle 25 minutes is", async () => {
      const tenPastMidnight: Date = new Date("2026-11-15T00:10:00.000Z");
      const live: string = await run(
        "running",
        new Date("2026-11-14T23:55:00.000Z"),
      );
      const stalled: string = await run(
        "running",
        new Date("2026-11-14T23:45:00.000Z"),
      );

      expect(await scheduleAt(tenPastMidnight)).toEqual([stalled]);
      expect(await readColumn(SecurityEventConnectionRun, live, "status")).toBe(
        "running",
      );
      expect(
        await readColumn(SecurityEventConnectionRun, stalled, "status"),
      ).toBe("failed");
    });

    test("a run its worker refreshed after it was read is not failed", async () => {
      const idle25: string = await run("running", minutesBefore(NOW, 25));
      jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());

      // Read as stale, then written by its worker before the check runs.
      const stale: SecurityEventConnectionRun =
        new SecurityEventConnectionRun();
      stale.id = new ObjectID(idle25);
      stale.updatedAt = minutesBefore(NOW, 25);
      await database.query(
        `UPDATE ${tableOf(SecurityEventConnectionRun)} SET "updatedAt" = $1 WHERE "_id" = $2`,
        [minutesBefore(NOW, 1).toISOString(), idle25],
      );

      expect(
        await SecurityEventConnectionRunExecutor.expireStaleRun(stale),
      ).toBe(false);
      expect(
        await readColumn(SecurityEventConnectionRun, idle25, "status"),
      ).toBe("running");
    });
  });

  describe("tool imports", () => {
    test("a run idle over 90 minutes is failed and a preview older than a day expires", async () => {
      const projectId: string = ObjectID.generate().toString();
      const add: (
        status: ToolImportRunStatus,
        at: Date,
      ) => Promise<string> = async (
        status: ToolImportRunStatus,
        at: Date,
      ): Promise<string> => {
        return await insert(ToolImportRun, {
          projectId,
          status,
          createdAt: at,
          updatedAt: at,
        });
      };

      const stuck: string = await add(
        ToolImportRunStatus.Reading,
        minutesBefore(NOW, 91),
      );
      const working: string = await add(
        ToolImportRunStatus.Importing,
        minutesBefore(NOW, 89),
      );
      const oldPreview: string = await add(
        ToolImportRunStatus.ReadyToReview,
        minutesBefore(NOW, 25 * 60),
      );
      const freshPreview: string = await add(
        ToolImportRunStatus.ReadyToReview,
        minutesBefore(NOW, 23 * 60),
      );

      await ToolImportRunExecutor.sweepStaleRuns(NOW);

      expect(await readColumn(ToolImportRun, stuck, "status")).toBe(
        ToolImportRunStatus.Failed,
      );
      expect(await readColumn(ToolImportRun, working, "status")).toBe(
        ToolImportRunStatus.Importing,
      );
      expect(await readColumn(ToolImportRun, oldPreview, "status")).toBe(
        ToolImportRunStatus.Expired,
      );
      expect(await readColumn(ToolImportRun, freshPreview, "status")).toBe(
        ToolImportRunStatus.ReadyToReview,
      );
    });
  });

  describe("discovery imports", () => {
    test("an import whose job never ran is queued again after 2 minutes, not the next day", async () => {
      const waited3: string = ObjectID.generate().toString();
      const waited1: string = ObjectID.generate().toString();

      for (const [projectId, minutes] of [
        [waited3, 3],
        [waited1, 1],
      ] as Array<[string, number]>) {
        await insert(NetworkDeviceDiscoveryImport, {
          projectId,
          status: DiscoveryImportStatus.Queued,
          createdAt: minutesBefore(NOW, minutes),
          updatedAt: minutesBefore(NOW, minutes),
        });
      }

      const addJob: { mock: { calls: Array<Array<unknown>> } } = jest
        .spyOn(Queue, "addJob")
        .mockResolvedValue(undefined as never);

      await DiscoveryImportRunner.sweep(NOW);

      expect(
        addJob.mock.calls.map((call: Array<unknown>): unknown => {
          return (call[3] as JSONObject)["projectId"];
        }),
      ).toEqual([waited3]);
    });
  });

  describe("a cloud's recommendations", () => {
    test("those this read did not see are removed, to the minute", async () => {
      jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([]);

      const projectId: string = ObjectID.generate().toString();
      const accountRow: ObjectID = ObjectID.generate();
      const otherAccountRow: string = ObjectID.generate().toString();
      const add: (data: {
        lastSeenAt: Date;
        source?: string;
        cloudAccountId?: string;
      }) => Promise<string> = async (data: {
        lastSeenAt: Date;
        source?: string;
        cloudAccountId?: string;
      }): Promise<string> => {
        return await insert(CloudCostRecommendation, {
          projectId,
          cloudAccountId: data.cloudAccountId || accountRow.toString(),
          provider: CloudProvider.AWS,
          recommendationId: ObjectID.generate().toString(),
          source: data.source || "AWS Cost Optimization Hub",
          lastSeenAt: data.lastSeenAt,
        });
      };

      const seenNow: string = await add({ lastSeenAt: NOW });
      const seenAMinuteAgo: string = await add({
        lastSeenAt: minutesBefore(NOW, 1),
      });
      const seenYesterday: string = await add({
        lastSeenAt: minutesBefore(NOW, 26 * 60),
      });
      const oneUptimeOwn: string = await add({
        lastSeenAt: minutesBefore(NOW, 1),
        source: CLOUD_SAVINGS_SOURCE_ONEUPTIME,
      });
      const accountNotRead: string = await add({
        lastSeenAt: minutesBefore(NOW, 1),
        cloudAccountId: otherAccountRow,
      });

      const result: { removed: number } = await CloudSavingsWriter.write({
        projectId: new ObjectID(projectId),
        provider: CloudProvider.AWS,
        accountRows: new Map([["123456789012", accountRow]]),
        accountsRead: new Set(["123456789012"]),
        recommendations: [],
        now: NOW,
      });

      expect(result.removed).toBe(2);

      const left: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM ${tableOf(CloudCostRecommendation)} ORDER BY "_id"`,
      );

      expect(
        left.map((row: { _id: string }): string => {
          return row._id;
        }),
      ).toEqual([seenNow, oneUptimeOwn, accountNotRead].sort());
      expect([seenAMinuteAgo, seenYesterday]).not.toContain(left[0]?._id);
    });
  });
});
