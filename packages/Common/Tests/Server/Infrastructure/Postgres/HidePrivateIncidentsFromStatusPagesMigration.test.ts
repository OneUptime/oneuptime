import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import { HidePrivateIncidentsFromStatusPages1799200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799200000000-HidePrivateIncidentsFromStatusPages";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageVisibility from "../../../../Types/StatusPage/StatusPageVisibility";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  DataSource,
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * HidePrivateIncidentsFromStatusPages1799200000000. A private incident or
 * incident episode is never shown on a status page (StatusPageVisibility),
 * and every write now keeps its Visible on Status Page switch off. Rows
 * stored private with the switch on, before that, get the switch off: they
 * then read as hidden everywhere, and making one not private later does not
 * show it until someone turns the switch on.
 *
 * Only the switch changes, only on rows private with it on, and nothing is
 * queued: every notification status is left as it is.
 */

interface Statement {
  sql: string;
  parameters: Array<unknown> | undefined;
}

async function statementsFor(
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push({ sql, parameters });
    },
  } as unknown as QueryRunner;

  await new HidePrivateIncidentsFromStatusPages1799200000000()[direction](
    runner,
  );
  return statements;
}

function column(
  target: typeof Incident | typeof IncidentEpisode,
  property: string,
): ColumnMetadataArgs {
  const found: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === target && args.propertyName === property;
    })
    .pop();

  expect(found).toBeDefined();
  return found!;
}

describe("HidePrivateIncidentsFromStatusPages1799200000000 SQL contract", () => {
  test("up() switches Visible on Status Page off on private incidents and private episodes, and changes nothing else", async () => {
    const statements: Array<Statement> = await statementsFor("up");

    expect(
      statements.map((statement: Statement): string => {
        return statement.sql;
      }),
    ).toEqual([
      `UPDATE "Incident" SET "isVisibleOnStatusPage" = false WHERE "isPrivate" IS TRUE AND "isVisibleOnStatusPage" IS TRUE`,
      `UPDATE "IncidentEpisode" SET "isVisibleOnStatusPage" = false WHERE "isPrivate" IS TRUE AND "isVisibleOnStatusPage" IS TRUE`,
    ]);

    for (const statement of statements) {
      expect(statement.parameters).toBeUndefined();
      // One column set; nothing created, dropped or deleted.
      expect(statement.sql.split(" WHERE ")[0]).not.toContain(",");
      expect(statement.sql).not.toMatch(
        /\b(ALTER|CREATE|DROP|DELETE|INSERT|TRUNCATE)\b/,
      );
      // No notification status is touched, so nothing is queued.
      expect(statement.sql).not.toContain("subscriberNotification");
    }
  });

  test("the rows it changes are exactly those the rule hides while their switch says shown", () => {
    /*
     * "isPrivate" IS TRUE is the rule's private: TRUE only, so a Private
     * never set (NULL) reads as not private, as StatusPageVisibility.isPrivate
     * reads it.
     */
    expect(StatusPageVisibility.isPrivate({ isPrivate: null })).toBe(false);
    expect(StatusPageVisibility.isPrivate({ isPrivate: true })).toBe(true);
    expect(
      StatusPageVisibility.isShown({
        isVisibleOnStatusPage: true,
        isPrivate: true,
      }),
    ).toBe(false);
    expect(
      StatusPageVisibility.isShown({
        isVisibleOnStatusPage: true,
        isPrivate: null,
      }),
    ).toBe(true);
  });

  test("names real columns of both tables", () => {
    expect(column(Incident, "isVisibleOnStatusPage").options.type).toBe(
      "boolean",
    );
    expect(column(Incident, "isPrivate").options.type).toBe("boolean");
    expect(column(IncidentEpisode, "isVisibleOnStatusPage").options.type).toBe(
      "boolean",
    );
    expect(column(IncidentEpisode, "isPrivate").options.type).toBe("boolean");
    // Private may be NULL on both: NULL is not private.
    expect(column(Incident, "isPrivate").options.nullable).toBe(true);
    expect(column(IncidentEpisode, "isPrivate").options.nullable).toBe(true);
  });

  test("down() changes nothing: switching it back on would show private records again", async () => {
    expect(await statementsFor("down")).toEqual([]);
  });

  test("is registered exactly once, after the migrations before it, so it runs on boot", () => {
    const registered: Array<new () => MigrationInterface> =
      SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return migration === HidePrivateIncidentsFromStatusPages1799200000000;
        },
      );

    expect(registered).toHaveLength(1);
    expect(new HidePrivateIncidentsFromStatusPages1799200000000().name).toBe(
      "HidePrivateIncidentsFromStatusPages1799200000000",
    );
    expect(
      SchemaMigrations.indexOf(
        HidePrivateIncidentsFromStatusPages1799200000000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.findIndex(
        (migration: new () => MigrationInterface): boolean => {
          return (
            new migration().name ===
            "MarkPostmortemsWaitingForHiddenIncidents1799100000000"
          );
        },
      ),
    );
  });
});

/*
 * Opt in with RUN_POSTGRES_PRIVATE_INCIDENT_VISIBILITY_MIGRATION_TESTS=true
 * and the normal database credentials (the Common test job does). The tables
 * are minimal stand-ins for Incident and IncidentEpisode with the columns the
 * migration reads and writes, typed as the entities declare them, in a
 * uniquely named schema whose search_path excludes public - so no
 * application row is ever touched.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PRIVATE_INCIDENT_VISIBILITY_MIGRATION_TESTS"] ===
  "true"
    ? describe
    : describe.skip;

interface StoredRow {
  isVisibleOnStatusPage: boolean | null;
  isPrivate: boolean | null;
  createdStatus: string;
  version: number;
}

describePostgres("HidePrivateIncidentsFromStatusPages against Postgres", () => {
  const schema: string = `private_visibility_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const migration: HidePrivateIncidentsFromStatusPages1799200000000 =
    new HidePrivateIncidentsFromStatusPages1799200000000();

  let database: DataSource;
  let runner: QueryRunner;

  async function insert(
    table: "Incident" | "IncidentEpisode",
    row: {
      isVisibleOnStatusPage: boolean | null;
      isPrivate: boolean | null;
    },
  ): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await runner.query(
      `INSERT INTO "${table}" ("_id", "isVisibleOnStatusPage", "isPrivate") VALUES ($1, $2, $3)`,
      [id, row.isVisibleOnStatusPage, row.isPrivate],
    );

    return id;
  }

  async function read(
    table: "Incident" | "IncidentEpisode",
    id: string,
  ): Promise<StoredRow> {
    const rows: Array<StoredRow> = await runner.query(
      `SELECT "isVisibleOnStatusPage", "isPrivate", "subscriberNotificationStatusOnIncidentCreated" AS "createdStatus", "version" FROM "${table}" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["PRIVATE_VISIBILITY_MIGRATION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["PRIVATE_VISIBILITY_MIGRATION_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    runner = database.createQueryRunner();
    await runner.connect();

    const currentSchema: Array<{ current_schema: string }> = await runner.query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  beforeEach(async () => {
    await runner.startTransaction();
    // The columns as the migrated tables declare them.
    await runner.query(
      `CREATE TABLE "Incident" ("_id" uuid PRIMARY KEY, "isVisibleOnStatusPage" boolean DEFAULT true, "isPrivate" boolean DEFAULT false, "subscriberNotificationStatusOnIncidentCreated" character varying NOT NULL DEFAULT 'Pending', "version" integer NOT NULL DEFAULT 1)`,
    );
    await runner.query(
      `CREATE TABLE "IncidentEpisode" ("_id" uuid PRIMARY KEY, "isVisibleOnStatusPage" boolean NOT NULL DEFAULT false, "isPrivate" boolean DEFAULT false, "subscriberNotificationStatusOnIncidentCreated" character varying NOT NULL DEFAULT 'Pending', "version" integer NOT NULL DEFAULT 1)`,
    );
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) {
      await runner.rollbackTransaction();
    }
  });

  afterAll(async () => {
    if (runner) {
      await runner.release();
    }
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test.each(["Incident", "IncidentEpisode"] as Array<
    "Incident" | "IncidentEpisode"
  >)(
    "a private %s with Visible on Status Page on is switched off, and nothing else about it changes",
    async (table: "Incident" | "IncidentEpisode") => {
      const id: string = await insert(table, {
        isVisibleOnStatusPage: true,
        isPrivate: true,
      });

      await migration.up(runner);

      expect(await read(table, id)).toEqual({
        isVisibleOnStatusPage: false,
        isPrivate: true,
        // Nothing queued, and no version bump.
        createdStatus: "Pending",
        version: 1,
      });
    },
  );

  test("leaves every other row as it is: public, private and already hidden, never set", async () => {
    const rows: Array<{
      isVisibleOnStatusPage: boolean | null;
      isPrivate: boolean | null;
    }> = [
      { isVisibleOnStatusPage: true, isPrivate: false },
      // A Private never set is not private: the incident stays shown.
      { isVisibleOnStatusPage: true, isPrivate: null },
      { isVisibleOnStatusPage: false, isPrivate: true },
      { isVisibleOnStatusPage: false, isPrivate: false },
      { isVisibleOnStatusPage: null, isPrivate: true },
      { isVisibleOnStatusPage: null, isPrivate: null },
    ];

    const ids: Array<string> = [];

    for (const row of rows) {
      ids.push(await insert("Incident", row));
    }

    await migration.up(runner);

    for (let index: number = 0; index < rows.length; index++) {
      expect(await read("Incident", ids[index]!)).toEqual({
        ...rows[index],
        createdStatus: "Pending",
        version: 1,
      });
    }
  });

  test("leaves a public episode shown", async () => {
    const id: string = await insert("IncidentEpisode", {
      isVisibleOnStatusPage: true,
      isPrivate: false,
    });
    const neverSet: string = await insert("IncidentEpisode", {
      isVisibleOnStatusPage: true,
      isPrivate: null,
    });

    await migration.up(runner);

    expect((await read("IncidentEpisode", id)).isVisibleOnStatusPage).toBe(
      true,
    );
    expect(
      (await read("IncidentEpisode", neverSet)).isVisibleOnStatusPage,
    ).toBe(true);
  });

  test("running it twice changes nothing more", async () => {
    const privateId: string = await insert("Incident", {
      isVisibleOnStatusPage: true,
      isPrivate: true,
    });
    const publicId: string = await insert("Incident", {
      isVisibleOnStatusPage: true,
      isPrivate: false,
    });

    await migration.up(runner);
    await migration.up(runner);

    expect((await read("Incident", privateId)).isVisibleOnStatusPage).toBe(
      false,
    );
    expect((await read("Incident", publicId)).isVisibleOnStatusPage).toBe(true);
  });
});
