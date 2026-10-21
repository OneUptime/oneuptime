import Incident from "../../../../Models/DatabaseModels/Incident";
import {
  EARLIER_HIDDEN_INCIDENT_MESSAGE,
  MarkPostmortemsWaitingForHiddenIncidents1799100000000,
  POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799100000000-MarkPostmortemsWaitingForHiddenIncidents";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ObjectID from "../../../../Types/ObjectID";
import IncidentPostmortemPublication from "../../../../Types/StatusPage/IncidentPostmortemPublication";
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
 * MarkPostmortemsWaitingForHiddenIncidents1799100000000. A postmortem
 * published while its incident is hidden from status pages is now sent when
 * the incident is shown (found in #4429: it never was). The send job skips
 * it with words that say it waits for the incident, and the update that
 * shows the incident recognises exactly those words.
 *
 * Earlier releases skipped it as "Incident is not visible on status page.
 * Skipping notifications to subscribers." The migration gives those words
 * to the rows whose incident is still hidden - switched off, never set, or
 * private - so showing the incident sends the postmortem, once. Rows whose
 * incident was shown since keep the earlier words: the status page has
 * shown their postmortem for a while, and hiding the incident and showing it
 * again must not email it out of the blue.
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

  await new MarkPostmortemsWaitingForHiddenIncidents1799100000000()[direction](
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

describe("MarkPostmortemsWaitingForHiddenIncidents1799100000000 SQL contract", () => {
  test("up() runs a single UPDATE of Incident and no schema change", async () => {
    const statements: Array<Statement> = await statementsFor("up");

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/^UPDATE "Incident" SET /);
    expect(statements[0]!.sql).not.toMatch(
      /\b(ALTER|CREATE|DROP|DELETE|INSERT|TRUNCATE)\b/,
    );
  });

  test("changes only the message: the status stays Skipped, and nothing is queued", async () => {
    const statement: Statement = (await statementsFor("up"))[0]!;

    expect(statement.sql).toContain(
      `SET "subscriberNotificationStatusMessageOnPostmortemPublished" = $1 WHERE`,
    );
    // One column set, and the status is only read.
    expect(statement.sql.split(" WHERE ")[0]).not.toContain(",");
    expect(statement.sql).not.toContain(
      `SET "subscriberNotificationStatusOnPostmortemPublished"`,
    );
    expect(statement.sql).not.toContain(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(statement.parameters).toEqual([
      POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
      EARLIER_HIDDEN_INCIDENT_MESSAGE,
    ]);
  });

  test("touches only skips in the earlier words, of incidents hidden today: switched off, never set, or private", async () => {
    const statement: Statement = (await statementsFor("up"))[0]!;

    expect(statement.sql).toContain(
      `WHERE "subscriberNotificationStatusOnPostmortemPublished" = '${StatusPageSubscriberNotificationStatus.Skipped}' AND "subscriberNotificationStatusMessageOnPostmortemPublished" = $2 AND ("isVisibleOnStatusPage" IS NOT TRUE OR "isPrivate" IS TRUE)`,
    );
    // Nothing else narrows or widens it.
    expect(statement.sql.split("WHERE")).toHaveLength(2);
    expect(statement.sql.match(/ OR /g)).toHaveLength(1);
  });

  test("migrated rows read exactly like the skips the job writes now, and the earlier words are not recognised", () => {
    /*
     * The migration keeps its own copy of both texts so it never changes
     * after it ships; the service, the job and the dashboard recognise a
     * postmortem that waits for its incident by the new one.
     */
    expect(POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE).toBe(
      IncidentPostmortemPublication.hiddenIncidentMessage,
    );
    expect(
      IncidentPostmortemPublication.isHiddenIncidentSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isHiddenIncidentSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: EARLIER_HIDDEN_INCIDENT_MESSAGE,
      }),
    ).toBe(false);
  });

  test("names real Incident columns", () => {
    expect(
      incidentColumn("subscriberNotificationStatusOnPostmortemPublished")
        .options.type,
    ).toBeDefined();
    expect(
      incidentColumn("subscriberNotificationStatusMessageOnPostmortemPublished")
        .options.nullable,
    ).toBe(true);
    // The job reads a NULL visibility as hidden; the column allows it.
    expect(incidentColumn("isVisibleOnStatusPage").options.nullable).toBe(true);
    // A NULL Private Incident reads as not private.
    expect(incidentColumn("isPrivate").options.nullable).toBe(true);
  });

  test("down() gives the waiting rows the earlier words back, and nothing else", async () => {
    const statements: Array<Statement> = await statementsFor("down");

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toBe(
      `UPDATE "Incident" SET "subscriberNotificationStatusMessageOnPostmortemPublished" = $1 WHERE "subscriberNotificationStatusOnPostmortemPublished" = '${StatusPageSubscriberNotificationStatus.Skipped}' AND "subscriberNotificationStatusMessageOnPostmortemPublished" = $2`,
    );
    expect(statements[0]!.parameters).toEqual([
      EARLIER_HIDDEN_INCIDENT_MESSAGE,
      POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
    ]);
  });

  test("is registered exactly once, after the migrations before it, so it runs on boot", () => {
    const registered: Array<new () => MigrationInterface> =
      SchemaMigrations.filter(
        (migration: new () => MigrationInterface): boolean => {
          return (
            migration === MarkPostmortemsWaitingForHiddenIncidents1799100000000
          );
        },
      );

    expect(registered).toHaveLength(1);
    expect(
      new MarkPostmortemsWaitingForHiddenIncidents1799100000000().name,
    ).toBe("MarkPostmortemsWaitingForHiddenIncidents1799100000000");
    expect(
      SchemaMigrations.indexOf(
        MarkPostmortemsWaitingForHiddenIncidents1799100000000,
      ),
    ).toBeGreaterThan(
      SchemaMigrations.findIndex(
        (migration: new () => MigrationInterface): boolean => {
          return (
            new migration().name ===
            "AddProjectAiDailyLimitReachedAt1799000000000"
          );
        },
      ),
    );
  });
});

/*
 * Opt in with RUN_POSTGRES_POSTMORTEM_WAITING_MIGRATION_TESTS=true and the
 * normal database credentials (the Common test job does). The table is a
 * minimal stand-in for Incident with the columns the migration reads and
 * writes, typed as the entity declares them, in a uniquely named schema
 * whose search_path excludes public - so no application row is ever touched.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_POSTMORTEM_WAITING_MIGRATION_TESTS"] === "true"
    ? describe
    : describe.skip;

interface StoredIncident {
  status: string;
  message: string | null;
  createdStatus: string;
  createdMessage: string | null;
}

describePostgres(
  "MarkPostmortemsWaitingForHiddenIncidents against Postgres",
  () => {
    const schema: string = `postmortem_waiting_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const migration: MarkPostmortemsWaitingForHiddenIncidents1799100000000 =
      new MarkPostmortemsWaitingForHiddenIncidents1799100000000();

    let database: DataSource;
    let runner: QueryRunner;

    async function insert(row: {
      isVisibleOnStatusPage: boolean | null;
      isPrivate?: boolean | null;
      status?: StatusPageSubscriberNotificationStatus;
      message?: string | null;
    }): Promise<string> {
      const id: string = ObjectID.generate().toString();
      await runner.query(
        `INSERT INTO "Incident" ("_id", "isVisibleOnStatusPage", "isPrivate", "subscriberNotificationStatusOnPostmortemPublished", "subscriberNotificationStatusMessageOnPostmortemPublished", "subscriberNotificationStatusOnIncidentCreated", "subscriberNotificationStatusMessage") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          row.isVisibleOnStatusPage,
          row.isPrivate === undefined ? false : row.isPrivate,
          row.status ?? StatusPageSubscriberNotificationStatus.Skipped,
          row.message === undefined
            ? EARLIER_HIDDEN_INCIDENT_MESSAGE
            : row.message,
          StatusPageSubscriberNotificationStatus.Skipped,
          // The 'created' notification's words, which are not the migration's.
          "Incident is hidden from status pages. Skipping notifications to subscribers.",
        ],
      );
      return id;
    }

    async function read(id: string): Promise<StoredIncident> {
      const rows: Array<StoredIncident> = await runner.query(
        `SELECT "subscriberNotificationStatusOnPostmortemPublished" AS status, "subscriberNotificationStatusMessageOnPostmortemPublished" AS message, "subscriberNotificationStatusOnIncidentCreated" AS "createdStatus", "subscriberNotificationStatusMessage" AS "createdMessage" FROM "Incident" WHERE "_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["POSTMORTEM_WAITING_MIGRATION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["POSTMORTEM_WAITING_MIGRATION_TEST_DATABASE_PORT"] ||
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

      const currentSchema: Array<{ current_schema: string }> =
        await runner.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    beforeEach(async () => {
      await runner.startTransaction();
      // The columns as the migrated Incident table declares them.
      await runner.query(
        `CREATE TABLE "Incident" ("_id" uuid PRIMARY KEY, "isVisibleOnStatusPage" boolean DEFAULT true, "isPrivate" boolean DEFAULT false, "subscriberNotificationStatusOnPostmortemPublished" character varying NOT NULL DEFAULT 'Pending', "subscriberNotificationStatusMessageOnPostmortemPublished" text, "subscriberNotificationStatusOnIncidentCreated" character varying NOT NULL DEFAULT 'Pending', "subscriberNotificationStatusMessage" text)`,
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

    test("a postmortem skipped for an incident still switched off now waits for it", async () => {
      const id: string = await insert({ isVisibleOnStatusPage: false });

      await migration.up(runner);

      expect(await read(id)).toEqual(
        expect.objectContaining({
          status: StatusPageSubscriberNotificationStatus.Skipped,
          message: IncidentPostmortemPublication.hiddenIncidentMessage,
        }),
      );
    });

    test("a switch never set counts as hidden, as the job reads it", async () => {
      const id: string = await insert({ isVisibleOnStatusPage: null });

      await migration.up(runner);

      expect((await read(id)).message).toBe(
        IncidentPostmortemPublication.hiddenIncidentMessage,
      );
    });

    test("a private incident counts as hidden, even switched on", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: true,
        isPrivate: true,
      });

      await migration.up(runner);

      expect((await read(id)).message).toBe(
        IncidentPostmortemPublication.hiddenIncidentMessage,
      );
    });

    test("a Private Incident never set counts as not private: switched on, the incident is shown", async () => {
      const id: string = await insert({
        isVisibleOnStatusPage: true,
        isPrivate: null,
      });

      await migration.up(runner);

      expect((await read(id)).message).toBe(EARLIER_HIDDEN_INCIDENT_MESSAGE);
    });

    test("an incident shown since keeps the earlier words, so showing it again sends nothing", async () => {
      const id: string = await insert({ isVisibleOnStatusPage: true });

      await migration.up(runner);

      expect(await read(id)).toEqual(
        expect.objectContaining({
          status: StatusPageSubscriberNotificationStatus.Skipped,
          message: EARLIER_HIDDEN_INCIDENT_MESSAGE,
        }),
      );
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.InProgress,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
    ])(
      "leaves a postmortem notification that is %s alone, whatever it says",
      async (status: StatusPageSubscriberNotificationStatus) => {
        const id: string = await insert({
          isVisibleOnStatusPage: false,
          status,
        });

        await migration.up(runner);

        expect(await read(id)).toEqual(
          expect.objectContaining({
            status,
            message: EARLIER_HIDDEN_INCIDENT_MESSAGE,
          }),
        );
      },
    );

    test.each([
      [
        "switched off",
        IncidentPostmortemPublication.notShownMessage as string | null,
      ],
      ["without a note", IncidentPostmortemPublication.noNoteMessage],
      [
        "with no monitors",
        "No monitors are attached to this incident. Skipping notifications to subscribers.",
      ],
      ["with no words", null],
    ])(
      "leaves a postmortem skipped for another reason (%s) alone",
      async (_reason: string, message: string | null) => {
        const id: string = await insert({
          isVisibleOnStatusPage: false,
          message,
        });

        await migration.up(runner);

        expect((await read(id)).message).toBe(message);
      },
    );

    test("leaves the incident's 'created' notification alone", async () => {
      const id: string = await insert({ isVisibleOnStatusPage: false });

      await migration.up(runner);

      expect(await read(id)).toEqual(
        expect.objectContaining({
          createdStatus: StatusPageSubscriberNotificationStatus.Skipped,
          createdMessage:
            "Incident is hidden from status pages. Skipping notifications to subscribers.",
        }),
      );
    });

    test("marks every waiting row in one pass and nothing else", async () => {
      const waiting: Array<string> = [];
      for (let i: number = 0; i < 5; i++) {
        waiting.push(await insert({ isVisibleOnStatusPage: false }));
      }
      const shown: string = await insert({ isVisibleOnStatusPage: true });

      await migration.up(runner);

      for (const id of waiting) {
        expect((await read(id)).message).toBe(
          IncidentPostmortemPublication.hiddenIncidentMessage,
        );
      }
      expect((await read(shown)).message).toBe(EARLIER_HIDDEN_INCIDENT_MESSAGE);
    });

    test("is safe to run twice", async () => {
      const id: string = await insert({ isVisibleOnStatusPage: false });

      await migration.up(runner);
      await migration.up(runner);

      expect(await read(id)).toEqual(
        expect.objectContaining({
          status: StatusPageSubscriberNotificationStatus.Skipped,
          message: IncidentPostmortemPublication.hiddenIncidentMessage,
        }),
      );
    });

    test("down() gives the waiting rows the earlier words back, and leaves the rest", async () => {
      const waiting: string = await insert({ isVisibleOnStatusPage: false });
      const shown: string = await insert({ isVisibleOnStatusPage: true });
      const sent: string = await insert({
        isVisibleOnStatusPage: true,
        status: StatusPageSubscriberNotificationStatus.Success,
        message: "Notifications sent successfully to all subscribers.",
      });

      await migration.up(runner);
      await migration.down(runner);

      expect((await read(waiting)).message).toBe(
        EARLIER_HIDDEN_INCIDENT_MESSAGE,
      );
      expect((await read(shown)).message).toBe(EARLIER_HIDDEN_INCIDENT_MESSAGE);
      expect(await read(sent)).toEqual(
        expect.objectContaining({
          status: StatusPageSubscriberNotificationStatus.Success,
          message: "Notifications sent successfully to all subscribers.",
        }),
      );
    });
  },
);
