import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  HIDDEN_FROM_STATUS_PAGES_MESSAGE,
  SkipHiddenIncidentCreatedNotifications1795300000000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795300000000-SkipHiddenIncidentCreatedNotifications";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ObjectID from "../../../../Types/ObjectID";
import IncidentCreatedRenotify from "../../../../Types/StatusPage/IncidentCreatedRenotify";
import StatusPageSubscriberNotificationStatus from "../../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
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
 * SkipHiddenIncidentCreatedNotifications1795300000000 settles the 'incident
 * created' subscriber notification of hidden incidents that the old worker
 * marked InProgress and then abandoned. The worker only picks up Pending
 * rows, so those rows could never move again; Skipped is what the fixed
 * worker writes for a hidden incident, and what lets publishing the incident
 * re-queue the notification.
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

  await new SkipHiddenIncidentCreatedNotifications1795300000000()[direction](
    runner,
  );
  return statements;
}

function incidentColumn(property: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === Incident && args.propertyName === property;
    })
    .pop();

  expect(column).toBeDefined();
  return column!;
}

describe("SkipHiddenIncidentCreatedNotifications1795300000000 SQL contract", () => {
  test("up() runs a single UPDATE of Incident and no schema change", async () => {
    const statements: Array<Statement> = await statementsFor("up");

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/^UPDATE "Incident" SET /);
    // Keywords only: the status column's own name contains "Created".
    expect(statements[0]!.sql).not.toMatch(
      /\b(ALTER|CREATE|DROP|DELETE|INSERT|TRUNCATE)\b/,
    );
  });

  test("sets the status to Skipped and the message to the worker's hidden-incident reason", async () => {
    const statement: Statement = (await statementsFor("up"))[0]!;

    expect(statement.sql).toContain(
      `SET "subscriberNotificationStatusOnIncidentCreated" = '${StatusPageSubscriberNotificationStatus.Skipped}', "subscriberNotificationStatusMessage" = $1 `,
    );
    expect(statement.parameters).toEqual([
      IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
    ]);
  });

  test("touches only InProgress rows of incidents that are not visible, counting NULL as hidden", async () => {
    const statement: Statement = (await statementsFor("up"))[0]!;

    expect(statement.sql).toContain(
      `WHERE "subscriberNotificationStatusOnIncidentCreated" = '${StatusPageSubscriberNotificationStatus.InProgress}' AND "isVisibleOnStatusPage" IS NOT TRUE`,
    );
    // Nothing else narrows or widens it.
    expect(statement.sql.split("WHERE")).toHaveLength(2);
    expect(statement.sql).not.toMatch(/ OR /i);
  });

  test("migrated rows read exactly like rows the fixed worker skips", () => {
    /*
     * The migration keeps its own copy of the text so it never changes after
     * it ships; the dashboard recognises the reason by this text.
     */
    expect(HIDDEN_FROM_STATUS_PAGES_MESSAGE).toBe(
      IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
    );
    expect(
      IncidentCreatedRenotify.isHiddenFromStatusPagesSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: HIDDEN_FROM_STATUS_PAGES_MESSAGE,
      }),
    ).toBe(true);
  });

  test("names real Incident columns", () => {
    expect(
      incidentColumn("subscriberNotificationStatusOnIncidentCreated").options
        .type,
    ).toBeDefined();
    expect(
      incidentColumn("subscriberNotificationStatusMessage").options.nullable,
    ).toBe(true);
    // The worker reads a NULL visibility as hidden; the column allows it.
    expect(incidentColumn("isVisibleOnStatusPage").options.nullable).toBe(true);
  });

  test("down() restores nothing", async () => {
    expect(await statementsFor("down")).toEqual([]);
  });

  test("is registered exactly once, after the migrations before it, so it runs on boot", () => {
    const registered: Array<new () => MigrationInterface> =
      SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return (
            migration === SkipHiddenIncidentCreatedNotifications1795300000000
          );
        },
      );

    expect(registered).toHaveLength(1);
    expect(new SkipHiddenIncidentCreatedNotifications1795300000000().name).toBe(
      "SkipHiddenIncidentCreatedNotifications1795300000000",
    );
    expect(
      SchemaMigrations.indexOf(
        SkipHiddenIncidentCreatedNotifications1795300000000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.findIndex(
        (migration: new () => MigrationInterface): boolean => {
          return (
            new migration().name === "AddUserProjectSsoConsent1795100000000"
          );
        },
      ),
    );
  });
});

/*
 * Opt in with RUN_POSTGRES_HIDDEN_INCIDENT_NOTIFICATION_MIGRATION_TESTS=true
 * and the normal database credentials (the Common test job does). The table
 * is a minimal stand-in for Incident with the columns the migration reads and
 * writes, typed as the entity declares them, in a uniquely named schema whose
 * search_path excludes public - so no application row is ever touched.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_HIDDEN_INCIDENT_NOTIFICATION_MIGRATION_TESTS"] ===
  "true"
    ? describe
    : describe.skip;

interface StoredIncident {
  _id: string;
  isVisibleOnStatusPage: boolean | null;
  status: string;
  message: string | null;
  postmortemStatus: string;
}

describePostgres(
  "SkipHiddenIncidentCreatedNotifications against Postgres",
  () => {
    const schema: string = `hidden_incident_notifications_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const migration: SkipHiddenIncidentCreatedNotifications1795300000000 =
      new SkipHiddenIncidentCreatedNotifications1795300000000();

    let database: DataSource;
    let runner: QueryRunner;

    async function insert(row: {
      isVisibleOnStatusPage: boolean | null;
      status: StatusPageSubscriberNotificationStatus;
      message?: string | null;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();
      await runner.query(
        `INSERT INTO "Incident" ("_id", "isVisibleOnStatusPage", "subscriberNotificationStatusOnIncidentCreated", "subscriberNotificationStatusMessage") VALUES ($1, $2, $3, $4)`,
        [id, row.isVisibleOnStatusPage, row.status, row.message ?? null],
      );
      return id;
    }

    async function read(id: string): Promise<StoredIncident> {
      const rows: Array<StoredIncident> = await runner.query(
        `SELECT "_id", "isVisibleOnStatusPage", "subscriberNotificationStatusOnIncidentCreated" AS status, "subscriberNotificationStatusMessage" AS message, "subscriberNotificationStatusOnPostmortemPublished" AS "postmortemStatus" FROM "Incident" WHERE "_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env[
            "HIDDEN_INCIDENT_NOTIFICATION_MIGRATION_TEST_DATABASE_HOST"
          ] || "localhost",
        port: Number(
          process.env[
            "HIDDEN_INCIDENT_NOTIFICATION_MIGRATION_TEST_DATABASE_PORT"
          ] || "5400",
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

      const currentSchema: Array<{ current_schema: string }> =
        await runner.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    beforeEach(async () => {
      await runner.startTransaction();
      // The columns as the migrated Incident table declares them.
      await runner.query(
        `CREATE TABLE "Incident" ("_id" uuid PRIMARY KEY, "isVisibleOnStatusPage" boolean DEFAULT true, "subscriberNotificationStatusOnIncidentCreated" character varying NOT NULL DEFAULT 'Pending', "subscriberNotificationStatusMessage" text, "subscriberNotificationStatusOnPostmortemPublished" character varying NOT NULL DEFAULT 'Pending')`,
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

    test("moves a hidden incident stuck InProgress to Skipped, with the reason", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: false,
        status: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await migration.up(runner);

      expect(await read(id)).toEqual({
        _id: id,
        isVisibleOnStatusPage: false,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
        postmortemStatus: StatusPageSubscriberNotificationStatus.Pending,
      });
    });

    test("treats a NULL visibility as hidden, as the worker did", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: null,
        status: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await migration.up(runner);

      expect((await read(id)).status).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
    });

    test("overwrites a stale message on the rows it settles", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: false,
        status: StatusPageSubscriberNotificationStatus.InProgress,
        message: "Notification queued for resending",
      });

      await migration.up(runner);

      expect((await read(id)).message).toBe(
        IncidentCreatedRenotify.hiddenFromStatusPagesMessage,
      );
    });

    test("leaves a visible incident that is InProgress alone: it may be sending right now", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: true,
        status: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await migration.up(runner);

      expect(await read(id)).toEqual(
        expect.objectContaining({
          status: StatusPageSubscriberNotificationStatus.InProgress,
          message: null,
        }),
      );
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.Skipped,
    ])(
      "leaves a hidden incident whose notification is %s alone",
      async (status: StatusPageSubscriberNotificationStatus) => {
        const id: string = await insert({
          isVisibleOnStatusPage: false,
          status,
          message: "original message",
        });

        await migration.up(runner);

        expect(await read(id)).toEqual(
          expect.objectContaining({ status, message: "original message" }),
        );
      },
    );

    test("settles every stuck row in one pass and nothing else", async () => {
      const stuck: Array<string> = [];
      for (let i: number = 0; i < 5; i++) {
        stuck.push(
          await insert({
            isVisibleOnStatusPage: false,
            status: StatusPageSubscriberNotificationStatus.InProgress,
          }),
        );
      }
      const untouched: string = await insert({
        isVisibleOnStatusPage: true,
        status: StatusPageSubscriberNotificationStatus.Success,
      });

      await migration.up(runner);

      for (const id of stuck) {
        expect((await read(id)).status).toBe(
          StatusPageSubscriberNotificationStatus.Skipped,
        );
      }
      expect((await read(untouched)).status).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
    });

    test("is safe to run twice", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: false,
        status: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await migration.up(runner);
      await migration.up(runner);

      expect((await read(id)).status).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
    });

    test("down() leaves the settled rows as they are", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: false,
        status: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await migration.up(runner);
      await migration.down(runner);

      expect((await read(id)).status).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
    });
  },
);
