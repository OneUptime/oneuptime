import Entities from "../../../Models/DatabaseModels/Index";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnlineDdl from "../../../Server/Infrastructure/Postgres/OnlineDdl";
import { KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182510000-KeepOnCallHistoryWhenItsSettingsAreDeleted";
import { KeepOwnersWhenTheirPictureFileIsDeleted1809182520000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182520000-KeepOwnersWhenTheirPictureFileIsDeleted";
import { KeepNotificationLogsWhenOnCallSettingsAreDeleted1809182530000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182530000-KeepNotificationLogsWhenOnCallSettingsAreDeleted";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "../../../Server/Utils/Logger";
import OnCallEscalationAdvance, {
  OnCallEscalationAdvanceKind,
  OnCallEscalationAdvanceResult,
} from "../../../Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallMoveOnsInFlight from "../../../Server/Utils/OnCall/OnCallMoveOnsInFlight";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
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
import type { Mock } from "jest-mock";
import { DataSource, QueryRunner } from "typeorm";

/*
 * ON-CALL HISTORY IS KEPT WHEN THE SETTINGS IT NAMES ARE DELETED (issue
 * #9036), AND WHAT SHOWS A PICTURE WHEN ITS FILE IS (#9069), ON POSTGRES.
 *
 * Deleting an escalation rule deleted every run that last reached it, with
 * its timeline (ON DELETE CASCADE) - a run paging on that level too, so its
 * later levels were never paged - and every log of every message its pages
 * sent. Deleting a schedule, a team, or the account of somebody who once
 * acknowledged a page did the same to runs, their lines and those logs;
 * deleting a picture's file deleted the person, status page, dashboard,
 * probe or AI agent that showed it. Only a database answers whether the
 * keys now do what the models declare, so:
 *
 *   - on the migrated schema itself: every key from a run, its timeline, a
 *     person's page and its timeline to a rule, a schedule, a team or a
 *     person, from a delivery log to a rule, a schedule or a team, and from
 *     a picture to its file sets NULL, validated; a person's own page, and
 *     a run's policy, still cascade;
 *   - on copies of those tables with those keys, real deletes: the rule,
 *     the schedule, the team, an acknowledger, a person covered for, a
 *     paged person, a picture's file - each keeps every row of history, and
 *     every owner of a picture, the reference cleared - and a policy still
 *     takes its runs with it;
 *   - a run paging on a deleted level, with the services' own SQL on that
 *     structure: its place written as the rule goes, its claim to move on
 *     given back, its hand-over, and its move on - which pages the first
 *     level after the deleted one's place;
 *   - OnlineDdl.replaceForeignKey swaps a CASCADE key for SET NULL on a
 *     real table, rows and all, and does nothing the second time; the three
 *     migrations, run again on the migrated schema, change nothing.
 *
 * Opt in with RUN_POSTGRES_ON_CALL_HISTORY_KEPT_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' structure
 * is cloned into a schema of its own, with the foreign keys between them
 * rebuilt from the migrated definitions; the schema is dropped afterwards
 * and every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from ON_CALL_HISTORY_KEPT_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from ON_CALL_HISTORY_KEPT_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ON_CALL_HISTORY_KEPT_TESTS"] === "true"
    ? describe
    : describe.skip;

const HISTORY: Array<string> = [
  "OnCallDutyPolicyExecutionLog",
  "OnCallDutyPolicyExecutionLogTimeline",
  "UserOnCallLog",
  "UserOnCallLogTimeline",
];

const SETTINGS: Array<string> = [
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicySchedule",
  "Team",
  "User",
];

// Each message an on-call page sent, by the way it went out.
const DELIVERY_LOGS: Array<string> = [
  "CallLog",
  "EmailLog",
  "PushNotificationLog",
  "SmsLog",
  "TelegramLog",
  "WebhookLog",
  "WhatsAppLog",
  "WorkspaceNotificationLog",
];

// What shows a picture, beside a person: "table.column" of each picture.
const PICTURES: Array<string> = [
  "StatusPage.faviconFileId",
  "StatusPage.logoFileId",
  "StatusPage.coverImageFileId",
  "Dashboard.logoFileId",
  "Dashboard.faviconFileId",
  "Probe.iconFileId",
  "AIAgent.iconFileId",
];

const PICTURE_OWNERS: Array<string> = [
  "StatusPage",
  "Dashboard",
  "Probe",
  "AIAgent",
];

/*
 * Every table cloned: the history, the settings it names, their own, the
 * delivery logs, and what shows a picture.
 */
const TABLES: Array<string> = [
  ...HISTORY,
  ...SETTINGS,
  "OnCallDutyPolicy",
  "File",
  ...DELIVERY_LOGS,
  ...PICTURE_OWNERS,
];

// What the migrations made SET NULL: "table.column -> referenced table".
const SET_NULL: Array<string> = [
  ...DELIVERY_LOGS.flatMap((log: string): Array<string> => {
    return [
      `${log}.onCallDutyPolicyEscalationRuleId -> OnCallDutyPolicyEscalationRule`,
      `${log}.onCallDutyPolicyScheduleId -> OnCallDutyPolicySchedule`,
      `${log}.teamId -> Team`,
    ];
  }),
  ...PICTURES.map((picture: string): string => {
    return `${picture} -> File`;
  }),
  "OnCallDutyPolicyExecutionLog.acknowledgedByTeamId -> Team",
  "OnCallDutyPolicyExecutionLog.acknowledgedByUserId -> User",
  "OnCallDutyPolicyExecutionLog.lastExecutedEscalationRuleId -> OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyExecutionLogTimeline.alertSentToUserId -> User",
  "OnCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyEscalationRuleId -> OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicyExecutionLogTimeline.onCallDutyScheduleId -> OnCallDutyPolicySchedule",
  "OnCallDutyPolicyExecutionLogTimeline.overridedByUserId -> User",
  "OnCallDutyPolicyExecutionLogTimeline.userBelongsToTeamId -> Team",
  "UserOnCallLog.acknowledgedByUserId -> User",
  "UserOnCallLog.onCallDutyPolicyEscalationRuleId -> OnCallDutyPolicyEscalationRule",
  "UserOnCallLog.onCallDutyScheduleId -> OnCallDutyPolicySchedule",
  "UserOnCallLog.overridedByUserId -> User",
  "UserOnCallLog.userBelongsToTeamId -> Team",
  "UserOnCallLogTimeline.onCallDutyPolicyEscalationRuleId -> OnCallDutyPolicyEscalationRule",
  "UserOnCallLogTimeline.userBelongsToTeamId -> Team",
  "User.profilePictureId -> File",
];

interface ForeignKeyRow {
  owner: string;
  column_name: string;
  target: string;
  on_delete: string;
  validated: boolean;
}

describePostgres(
  "on-call history kept when what it names is deleted, against Postgres",
  () => {
    const schema: string = `oncall_history_kept_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    // The copies of the tables, in their own schema.
    let database: DataSource;
    // The migrated schema itself, for its catalog and its migrations.
    let migrated: DataSource;

    function databaseOptions(): {
      host: string;
      port: number;
      username: string;
      password: string;
      database: string;
    } {
      return {
        host:
          process.env["ON_CALL_HISTORY_KEPT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["ON_CALL_HISTORY_KEPT_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ON_CALL_HISTORY_KEPT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
      };
    }

    async function cloneTable(table: string): Promise<void> {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the test reads; the key stays NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    async function insertRow(
      table: string,
      values: Dictionary<unknown>,
    ): Promise<string> {
      const id: string = String(values["_id"] || ObjectID.generate());
      const row: Dictionary<unknown> = { ...values, _id: id };
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        Object.values(row),
      );

      return id;
    }

    async function rowOf(
      table: string,
      id: string,
    ): Promise<Dictionary<unknown> | null> {
      const rows: Array<Dictionary<unknown>> = await database.query(
        `SELECT * FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );

      return rows[0] || null;
    }

    async function deleteRow(table: string, id: string): Promise<void> {
      await database.query(
        `DELETE FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );
    }

    async function foreignKeysIn(
      namespace: string,
    ): Promise<Array<ForeignKeyRow>> {
      return await database.query(
        `SELECT owner.relname AS owner, attribute.attname AS column_name, target.relname AS target,
                constraint_row.confdeltype AS on_delete, constraint_row.convalidated AS validated
           FROM pg_constraint constraint_row
           JOIN pg_class owner ON owner.oid = constraint_row.conrelid
           JOIN pg_class target ON target.oid = constraint_row.confrelid
           JOIN pg_namespace namespace ON namespace.oid = owner.relnamespace
           JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = ANY(constraint_row.conkey)
          WHERE constraint_row.contype = 'f'
            AND namespace.nspname = $1
            AND owner.relname = ANY($2)`,
        [namespace, TABLES],
      );
    }

    function describeKey(row: ForeignKeyRow): string {
      return `${row.owner}.${row.column_name} -> ${row.target}`;
    }

    interface World {
      policy: string;
      levelOne: string;
      levelTwo: string;
      levelThree: string;
      schedule: string;
      team: string;
      acknowledger: string;
      paged: string;
      coveredFor: string;
      pictured: string;
      picture: string;
      finishedRun: string;
      pagingRun: string;
      levelOneLine: string;
      levelTwoLine: string;
      pagingLine: string;
      page: string;
      delivery: string;
    }

    /*
     * A policy of three levels; a run that went through Level 2 and was
     * acknowledged, with its lines, the paged person's page and its
     * delivery; a run paging on Level 2 now; and a person with a picture.
     */
    async function seed(): Promise<World> {
      const user: () => Promise<string> = (): Promise<string> => {
        return insertRow("User", { name: "Somebody" });
      };

      const policy: string = await insertRow("OnCallDutyPolicy", {
        projectId: projectId.toString(),
        name: "Payments",
      });

      const level: (order: number, name: string) => Promise<string> = (
        order: number,
        name: string,
      ): Promise<string> => {
        return insertRow("OnCallDutyPolicyEscalationRule", {
          projectId: projectId.toString(),
          onCallDutyPolicyId: policy,
          order: order,
          name: name,
          escalateAfterInMinutes: 10,
        });
      };

      const levelOne: string = await level(1, "Primary");
      const levelTwo: string = await level(2, "Database");
      const levelThree: string = await level(3, "Manager");

      const schedule: string = await insertRow("OnCallDutyPolicySchedule", {
        projectId: projectId.toString(),
        name: "Primary rotation",
      });
      const team: string = await insertRow("Team", {
        projectId: projectId.toString(),
        name: "Platform",
      });

      const acknowledger: string = await user();
      const paged: string = await user();
      const coveredFor: string = await user();
      const picture: string = await insertRow("File", { name: "me.png" });
      const pictured: string = await insertRow("User", {
        name: "Pictured",
        profilePictureId: picture,
      });

      const run: (data: Dictionary<unknown>) => Promise<string> = (
        data: Dictionary<unknown>,
      ): Promise<string> => {
        return insertRow("OnCallDutyPolicyExecutionLog", {
          projectId: projectId.toString(),
          onCallDutyPolicyId: policy,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          onCallPolicyExecutionRepeatCount: 1,
          ...data,
        });
      };

      const finishedRun: string = await run({
        status: OnCallDutyPolicyStatus.Completed,
        lastExecutedEscalationRuleId: levelTwo,
        lastExecutedEscalationRuleOrder: 2,
        acknowledgedByUserId: acknowledger,
        acknowledgedByTeamId: team,
      });
      const pagingRun: string = await run({
        status: OnCallDutyPolicyStatus.Executing,
        lastExecutedEscalationRuleId: levelTwo,
        lastExecutedEscalationRuleOrder: 2,
        lastEscalationRuleExecutedAt: new Date(Date.now() - 20 * 60 * 1000),
        executeNextEscalationRuleInMinutes: 10,
      });

      const line: (data: Dictionary<unknown>) => Promise<string> = (
        data: Dictionary<unknown>,
      ): Promise<string> => {
        return insertRow("OnCallDutyPolicyExecutionLogTimeline", {
          projectId: projectId.toString(),
          onCallDutyPolicyId: policy,
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          status: "Notification Sent",
          ...data,
        });
      };

      const levelOneLine: string = await line({
        onCallDutyPolicyExecutionLogId: finishedRun,
        onCallDutyPolicyEscalationRuleId: levelOne,
        escalationRuleOrder: 1,
        escalationRuleName: "Primary",
        alertSentToUserId: paged,
        onCallDutyScheduleId: schedule,
        userBelongsToTeamId: team,
        overridedByUserId: coveredFor,
      });
      const levelTwoLine: string = await line({
        onCallDutyPolicyExecutionLogId: finishedRun,
        onCallDutyPolicyEscalationRuleId: levelTwo,
        escalationRuleOrder: 2,
        escalationRuleName: "Database",
        alertSentToUserId: paged,
      });
      const pagingLine: string = await line({
        onCallDutyPolicyExecutionLogId: pagingRun,
        onCallDutyPolicyEscalationRuleId: levelTwo,
        escalationRuleOrder: 2,
        escalationRuleName: "Database",
        alertSentToUserId: paged,
      });

      const page: string = await insertRow("UserOnCallLog", {
        projectId: projectId.toString(),
        userId: paged,
        onCallDutyPolicyId: policy,
        onCallDutyPolicyExecutionLogId: finishedRun,
        onCallDutyPolicyExecutionLogTimelineId: levelTwoLine,
        onCallDutyPolicyEscalationRuleId: levelTwo,
        onCallDutyScheduleId: schedule,
        userBelongsToTeamId: team,
        acknowledgedByUserId: acknowledger,
        overridedByUserId: coveredFor,
        status: "Completed",
      });
      const delivery: string = await insertRow("UserOnCallLogTimeline", {
        projectId: projectId.toString(),
        userId: paged,
        userNotificationLogId: page,
        onCallDutyPolicyId: policy,
        onCallDutyPolicyExecutionLogId: finishedRun,
        onCallDutyPolicyExecutionLogTimelineId: levelTwoLine,
        onCallDutyPolicyEscalationRuleId: levelTwo,
        userBelongsToTeamId: team,
        status: "Sent",
      });

      return {
        policy,
        levelOne,
        levelTwo,
        levelThree,
        schedule,
        team,
        acknowledger,
        paged,
        coveredFor,
        pictured,
        picture,
        finishedRun,
        pagingRun,
        levelOneLine,
        levelTwoLine,
        pagingLine,
        page,
        delivery,
      };
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        ...databaseOptions(),
        entities: Entities,
        schema,
        synchronize: false,
        // Only the copies: a read of any other table fails, not reads public.
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();

      migrated = new DataSource({
        type: "postgres",
        ...databaseOptions(),
        entities: Entities,
        synchronize: false,
      });
      await migrated.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await cloneTable(table);
      }

      // The keys between the cloned tables, as migrated.
      const keys: Array<{ owner: string; name: string; definition: string }> =
        await database.query(
          `SELECT owner.relname AS owner, constraint_row.conname AS name, pg_get_constraintdef(constraint_row.oid) AS definition
             FROM pg_constraint constraint_row
             JOIN pg_class owner ON owner.oid = constraint_row.conrelid
             JOIN pg_class target ON target.oid = constraint_row.confrelid
             JOIN pg_namespace namespace ON namespace.oid = owner.relnamespace
            WHERE constraint_row.contype = 'f'
              AND namespace.nspname = 'public'
              AND owner.relname = ANY($1)
              AND target.relname = ANY($1)`,
          [TABLES],
        );

      expect(keys.length).toBeGreaterThan(20);

      for (const key of keys) {
        const definition: string = key.definition.replace(
          /REFERENCES\s+(?:public\.)?"?([A-Za-z]+)"?/,
          `REFERENCES "${schema}"."$1"`,
        );

        await database.query(
          `ALTER TABLE "${schema}"."${key.owner}" ADD CONSTRAINT "${key.name}" ${definition}`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    }, 120_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }

      if (migrated?.isInitialized) {
        await migrated.destroy();
      }
    });

    let loggedErrors: Mock<(...args: Array<unknown>) => unknown>;

    beforeEach(() => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      loggedErrors = jest.fn<(...args: Array<unknown>) => unknown>();
      jest.spyOn(logger, "error").mockImplementation(((
        ...args: Array<unknown>
      ) => {
        loggedErrors(...args);
      }) as never);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Outside the database: Redis, and the run's chat message.
      jest.spyOn(OnDutyPoliciesCache, "forgetProjects").mockResolvedValue();
      jest.spyOn(OnCallMoveOnsInFlight, "keep").mockResolvedValue();
      jest.spyOn(OnCallMoveOnsInFlight, "forget").mockResolvedValue();
      jest.spyOn(OnCallPolicyRunMessage, "refresh").mockReturnValue();
    });

    afterEach(() => {
      try {
        /*
         * A service that failed logs it and answers as if nothing was
         * there to do: that would pass a test for the wrong reason.
         */
        expect(loggedErrors).not.toHaveBeenCalled();
      } finally {
        jest.restoreAllMocks();
      }
    });

    describe("the migrated schema", () => {
      test("every key the migrations changed sets NULL on delete, and is validated", async () => {
        const keys: Array<ForeignKeyRow> = await foreignKeysIn("public");

        for (const expected of SET_NULL) {
          const key: ForeignKeyRow | undefined = keys.find(
            (row: ForeignKeyRow): boolean => {
              return describeKey(row) === expected;
            },
          );

          expect({ key: expected, onDelete: key?.on_delete }).toEqual({
            key: expected,
            onDelete: "n",
          });
          expect({ key: expected, validated: key?.validated }).toEqual({
            key: expected,
            validated: true,
          });
        }
      });

      test("every key from the on-call history to a rule, schedule, team or person sets NULL - but a person's own page", async () => {
        const fromHistory: Array<string> = (await foreignKeysIn("public"))
          .filter((row: ForeignKeyRow): boolean => {
            return (
              HISTORY.includes(row.owner) &&
              SETTINGS.includes(row.target) &&
              row.on_delete !== "n"
            );
          })
          .map(describeKey)
          .sort();

        expect(fromHistory).toEqual([
          "UserOnCallLog.userId -> User",
          "UserOnCallLogTimeline.userId -> User",
        ]);
      });

      test("a run, its lines and its pages still go with their policy: they are owned through it", async () => {
        const toPolicy: Array<string> = (await foreignKeysIn("public"))
          .filter((row: ForeignKeyRow): boolean => {
            return (
              HISTORY.includes(row.owner) && row.target === "OnCallDutyPolicy"
            );
          })
          .map((row: ForeignKeyRow): string => {
            return `${describeKey(row)} ${row.on_delete}`;
          })
          .sort();

        expect(toPolicy).toEqual(
          HISTORY.map((table: string): string => {
            return `${table}.onCallDutyPolicyId -> OnCallDutyPolicy c`;
          }).sort(),
        );
      });

      test("run again, the migrations change nothing: every key is already what they make it", async () => {
        const queryRunner: QueryRunner = migrated.createQueryRunner();
        const statements: Array<string> = [];
        const query: QueryRunner["query"] = queryRunner.query.bind(queryRunner);

        /*
         * Reads go through; anything else is refused before it runs, so a
         * schema not at head fails here rather than being changed.
         */
        queryRunner.query = (async (
          sql: string,
          parameters?: Array<unknown>,
        ): Promise<unknown> => {
          const statement: string = sql.replace(/\s+/g, " ").trim();

          statements.push(statement);

          if (!statement.startsWith("SELECT")) {
            throw new Error(`The migration changed the schema: ${statement}`);
          }

          return await query(sql, parameters);
        }) as QueryRunner["query"];

        try {
          await new KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000().up(
            queryRunner,
          );
          await new KeepOwnersWhenTheirPictureFileIsDeleted1809182520000().up(
            queryRunner,
          );
          await new KeepNotificationLogsWhenOnCallSettingsAreDeleted1809182530000().up(
            queryRunner,
          );
        } finally {
          await queryRunner.release();
        }

        // One read of the catalog for each of the keys, and no change.
        expect(statements).toHaveLength(SET_NULL.length);
        expect(SET_NULL).toHaveLength(15 + 8 + 24);
      });

      test("a delivery log's rule, schedule and team set NULL; its person and its policy still cascade", async () => {
        const fromLogs: Array<string> = (await foreignKeysIn("public"))
          .filter((row: ForeignKeyRow): boolean => {
            return (
              DELIVERY_LOGS.includes(row.owner) &&
              [...SETTINGS, "OnCallDutyPolicy"].includes(row.target) &&
              !["createdByUserId", "deletedByUserId"].includes(row.column_name)
            );
          })
          .map((row: ForeignKeyRow): string => {
            return `${describeKey(row)} ${row.on_delete}`;
          })
          .sort();

        expect(fromLogs).toEqual(
          DELIVERY_LOGS.flatMap((log: string): Array<string> => {
            return [
              `${log}.onCallDutyPolicyEscalationRuleId -> OnCallDutyPolicyEscalationRule n`,
              `${log}.onCallDutyPolicyId -> OnCallDutyPolicy c`,
              `${log}.onCallDutyPolicyScheduleId -> OnCallDutyPolicySchedule n`,
              `${log}.teamId -> Team n`,
              `${log}.userId -> User c`,
            ];
          }).sort(),
        );
      });

      test("every picture's key to its file sets NULL - a dark-theme logo's and a form's too", async () => {
        const toFiles: Array<string> = (
          await database.query(
            `SELECT owner.relname AS owner, attribute.attname AS column_name, constraint_row.confdeltype AS on_delete
               FROM pg_constraint constraint_row
               JOIN pg_class owner ON owner.oid = constraint_row.conrelid
               JOIN pg_namespace namespace ON namespace.oid = owner.relnamespace
               JOIN pg_attribute attribute ON attribute.attrelid = constraint_row.conrelid AND attribute.attnum = ANY(constraint_row.conkey)
              WHERE constraint_row.contype = 'f'
                AND namespace.nspname = 'public'
                AND constraint_row.confrelid = 'public."File"'::regclass
                AND attribute.attname ~ '^(profilePicture|logoFile|darkThemeLogoFile|faviconFile|iconFile|coverImageFile)'`,
          )
        )
          .map(
            (row: {
              owner: string;
              column_name: string;
              on_delete: string;
            }): string => {
              return `${row.owner}.${row.column_name} ${row.on_delete}`;
            },
          )
          .sort();

        expect(toFiles).toEqual(
          [
            "AIAgent.iconFileId n",
            "Dashboard.darkThemeLogoFileId n",
            "Dashboard.faviconFileId n",
            "Dashboard.logoFileId n",
            "Form.faviconFileId n",
            "Form.logoFileId n",
            "Probe.iconFileId n",
            "StatusPage.coverImageFileId n",
            "StatusPage.darkThemeLogoFileId n",
            "StatusPage.faviconFileId n",
            "StatusPage.logoFileId n",
            "User.profilePictureId n",
          ].sort(),
        );
      });
    });

    describe("deleting what the history names", () => {
      test("the rule a finished run reached: the run, its lines, the page and its delivery stay, the rule cleared", async () => {
        const world: World = await seed();

        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        const run: Dictionary<unknown> | null = await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.finishedRun,
        );

        expect(run).not.toBeNull();
        expect(run!["lastExecutedEscalationRuleId"]).toBeNull();
        // Its place stays: the level it reached.
        expect(run!["lastExecutedEscalationRuleOrder"]).toBe(2);

        const line: Dictionary<unknown> | null = await rowOf(
          "OnCallDutyPolicyExecutionLogTimeline",
          world.levelTwoLine,
        );

        expect(line).not.toBeNull();
        expect(line!["onCallDutyPolicyEscalationRuleId"]).toBeNull();
        expect(line!["escalationRuleOrder"]).toBe(2);
        expect(line!["escalationRuleName"]).toBe("Database");

        expect(
          (await rowOf("UserOnCallLog", world.page))![
            "onCallDutyPolicyEscalationRuleId"
          ],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLogTimeline", world.delivery))![
            "onCallDutyPolicyEscalationRuleId"
          ],
        ).toBeNull();

        // The other level's line is untouched.
        expect(
          (await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            world.levelOneLine,
          ))!["onCallDutyPolicyEscalationRuleId"],
        ).toBe(world.levelOne);
      });

      test("the rule a run is paging on: the run stays, still paging, at its place, its wait as it was", async () => {
        const world: World = await seed();
        const before: Dictionary<unknown> | null = await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.pagingRun,
        );

        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        const run: Dictionary<unknown> | null = await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.pagingRun,
        );

        expect(run).not.toBeNull();
        expect(run!["status"]).toBe(OnCallDutyPolicyStatus.Executing);
        expect(run!["lastExecutedEscalationRuleId"]).toBeNull();
        expect(run!["lastExecutedEscalationRuleOrder"]).toBe(2);
        // Nobody is paged early: the wait the level started is untouched.
        expect((run!["lastEscalationRuleExecutedAt"] as Date).getTime()).toBe(
          (before!["lastEscalationRuleExecutedAt"] as Date).getTime(),
        );
        expect(run!["executeNextEscalationRuleInMinutes"]).toBe(10);
        expect(
          await rowOf("OnCallDutyPolicyExecutionLogTimeline", world.pagingLine),
        ).not.toBeNull();
      });

      test("a schedule: the lines and pages that paged through it stay", async () => {
        const world: World = await seed();

        await deleteRow("OnCallDutyPolicySchedule", world.schedule);

        expect(
          (await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            world.levelOneLine,
          ))!["onCallDutyScheduleId"],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLog", world.page))!["onCallDutyScheduleId"],
        ).toBeNull();
      });

      test("a team: the run it acknowledged and the lines and pages that went through it stay", async () => {
        const world: World = await seed();

        await deleteRow("Team", world.team);

        expect(
          (await rowOf("OnCallDutyPolicyExecutionLog", world.finishedRun))![
            "acknowledgedByTeamId"
          ],
        ).toBeNull();
        expect(
          (await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            world.levelOneLine,
          ))!["userBelongsToTeamId"],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLog", world.page))!["userBelongsToTeamId"],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLogTimeline", world.delivery))![
            "userBelongsToTeamId"
          ],
        ).toBeNull();
      });

      test("the account of whoever acknowledged: the run, and the page, stay", async () => {
        const world: World = await seed();

        await deleteRow("User", world.acknowledger);

        expect(
          (await rowOf("OnCallDutyPolicyExecutionLog", world.finishedRun))![
            "acknowledgedByUserId"
          ],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLog", world.page))!["acknowledgedByUserId"],
        ).toBeNull();
      });

      test("the account of somebody another was covering for: the lines and the page stay", async () => {
        const world: World = await seed();

        await deleteRow("User", world.coveredFor);

        expect(
          (await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            world.levelOneLine,
          ))!["overridedByUserId"],
        ).toBeNull();
        expect(
          (await rowOf("UserOnCallLog", world.page))!["overridedByUserId"],
        ).toBeNull();
      });

      test("a paged person's account: the run's lines about them stay; their own page goes with them", async () => {
        const world: World = await seed();

        await deleteRow("User", world.paged);

        for (const id of [
          world.levelOneLine,
          world.levelTwoLine,
          world.pagingLine,
        ]) {
          const line: Dictionary<unknown> | null = await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            id,
          );

          expect(line).not.toBeNull();
          expect(line!["alertSentToUserId"]).toBeNull();
        }

        expect(await rowOf("UserOnCallLog", world.page)).toBeNull();
        expect(await rowOf("UserOnCallLogTimeline", world.delivery)).toBeNull();
      });

      test("a person's picture's file: the person stays, the picture cleared (issue #9069)", async () => {
        const world: World = await seed();

        await deleteRow("File", world.picture);

        const person: Dictionary<unknown> | null = await rowOf(
          "User",
          world.pictured,
        );

        expect(person).not.toBeNull();
        expect(person!["profilePictureId"]).toBeNull();
      });

      test("a status page's, a dashboard's, a probe's and an AI agent's picture files: each stays, its pictures cleared (issue #9069)", async () => {
        const file: () => Promise<string> = (): Promise<string> => {
          return insertRow("File", { name: "picture.png" });
        };

        const owners: Array<{
          table: string;
          id: string;
          columns: Array<string>;
        }> = [];

        for (const table of PICTURE_OWNERS) {
          const columns: Array<string> = PICTURES.filter(
            (picture: string): boolean => {
              return picture.startsWith(`${table}.`);
            },
          ).map((picture: string): string => {
            return picture.split(".")[1]!;
          });
          const values: Dictionary<unknown> = {
            projectId: projectId.toString(),
            name: `${table} with pictures`,
          };

          for (const column of columns) {
            values[column] = await file();
          }

          owners.push({
            table: table,
            id: await insertRow(table, values),
            columns: columns,
          });
        }

        expect(
          owners.reduce((count: number, owner: { columns: Array<string> }) => {
            return count + owner.columns.length;
          }, 0),
        ).toBe(PICTURES.length);

        for (const owner of owners) {
          const before: Dictionary<unknown> | null = await rowOf(
            owner.table,
            owner.id,
          );

          for (const column of owner.columns) {
            await deleteRow("File", String(before![column]));
          }

          const after: Dictionary<unknown> | null = await rowOf(
            owner.table,
            owner.id,
          );

          expect({ owner: owner.table, kept: Boolean(after) }).toEqual({
            owner: owner.table,
            kept: true,
          });

          for (const column of owner.columns) {
            expect({
              picture: `${owner.table}.${column}`,
              value: after![column],
            }).toEqual({ picture: `${owner.table}.${column}`, value: null });
          }
        }
      });

      test("the rule, the schedule and the team a page went out through: every message's delivery log stays, them cleared", async () => {
        const world: World = await seed();
        const logs: Dictionary<string> = {};

        for (const log of DELIVERY_LOGS) {
          logs[log] = await insertRow(log, {
            projectId: projectId.toString(),
            onCallDutyPolicyId: world.policy,
            onCallDutyPolicyEscalationRuleId: world.levelTwo,
            onCallDutyPolicyScheduleId: world.schedule,
            teamId: world.team,
            userId: world.paged,
          });
        }

        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);
        await deleteRow("OnCallDutyPolicySchedule", world.schedule);
        await deleteRow("Team", world.team);

        for (const log of DELIVERY_LOGS) {
          const row: Dictionary<unknown> | null = await rowOf(log, logs[log]!);

          expect({ log: log, kept: Boolean(row) }).toEqual({
            log: log,
            kept: true,
          });
          expect({
            log: log,
            rule: row!["onCallDutyPolicyEscalationRuleId"],
            schedule: row!["onCallDutyPolicyScheduleId"],
            team: row!["teamId"],
            policy: row!["onCallDutyPolicyId"],
            person: row!["userId"],
          }).toEqual({
            log: log,
            rule: null,
            schedule: null,
            team: null,
            policy: world.policy,
            person: world.paged,
          });
        }
      });

      test("a policy still takes its rules, its runs and everything under them", async () => {
        const world: World = await seed();

        await deleteRow("OnCallDutyPolicy", world.policy);

        expect(
          await rowOf("OnCallDutyPolicyEscalationRule", world.levelOne),
        ).toBeNull();
        expect(
          await rowOf("OnCallDutyPolicyExecutionLog", world.finishedRun),
        ).toBeNull();
        expect(
          await rowOf("OnCallDutyPolicyExecutionLog", world.pagingRun),
        ).toBeNull();
        expect(
          await rowOf(
            "OnCallDutyPolicyExecutionLogTimeline",
            world.levelTwoLine,
          ),
        ).toBeNull();
        expect(await rowOf("UserOnCallLog", world.page)).toBeNull();
        expect(await rowOf("UserOnCallLogTimeline", world.delivery)).toBeNull();
      });
    });

    describe("a run paging on a level that is deleted, through the services' own SQL", () => {
      test("deleting the rule writes its place now on the runs still on it, and on none that is over", async () => {
        const world: World = await seed();

        // Both recorded place 3; a level before was deleted since, so Level 2 is at 2.
        await database.query(
          `UPDATE "${schema}"."OnCallDutyPolicyExecutionLog" SET "lastExecutedEscalationRuleOrder" = 3 WHERE "_id" = ANY($1)`,
          [[world.pagingRun, world.finishedRun]],
        );

        await expect(
          OnCallDutyPolicyExecutionLogService.recordPlaceOfRunsOnRule({
            ruleId: new ObjectID(world.levelTwo),
            order: 2,
          }),
        ).resolves.toBe(1);

        expect(
          (await rowOf("OnCallDutyPolicyExecutionLog", world.pagingRun))![
            "lastExecutedEscalationRuleOrder"
          ],
        ).toBe(2);
        expect(
          (await rowOf("OnCallDutyPolicyExecutionLog", world.finishedRun))![
            "lastExecutedEscalationRuleOrder"
          ],
        ).toBe(3);
      });

      test("a claim to move on, made before the rule was deleted, is given back after it", async () => {
        const world: World = await seed();
        const read: Date = (await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.pagingRun,
        ))!["lastEscalationRuleExecutedAt"] as Date;
        const claimedAt: Date = new Date(read.getTime() + 60 * 1000);

        expect(
          await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
            executionLogId: new ObjectID(world.pagingRun),
            previousLastEscalationRuleExecutedAt: read,
            newLastEscalationRuleExecutedAt: claimedAt,
          }),
        ).toBe(true);

        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        expect(
          await OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance({
            executionLogId: new ObjectID(world.pagingRun),
            claimedLastEscalationRuleExecutedAt: claimedAt,
            previousLastEscalationRuleExecutedAt: read,
            lastExecutedEscalationRuleId: new ObjectID(world.levelTwo),
            onCallPolicyExecutionRepeatCount: 1,
            throwOnError: true,
          }),
        ).toBe(true);

        expect(
          (
            (await rowOf("OnCallDutyPolicyExecutionLog", world.pagingRun))![
              "lastEscalationRuleExecutedAt"
            ] as Date
          ).getTime(),
        ).toBe(read.getTime());
      });

      test("a page again whose start stopped once its rule was recorded is handed over from its place, though the rule is gone", async () => {
        const world: World = await seed();

        await database.query(
          `UPDATE "${schema}"."OnCallDutyPolicyExecutionLog" SET "status" = $1 WHERE "_id" = $2`,
          [OnCallDutyPolicyStatus.Started, world.pagingRun],
        );
        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        expect(
          await OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
            executionLogId: new ObjectID(world.pagingRun),
            dueAt: new Date(),
            onlyFromItsRule: true,
          }),
        ).toBe(true);
        expect(
          (await rowOf("OnCallDutyPolicyExecutionLog", world.pagingRun))![
            "status"
          ],
        ).toBe(OnCallDutyPolicyStatus.Executing);
      });

      test("its wait over, it moves on to the first level after the deleted one's place", async () => {
        const world: World = await seed();
        const waitStartedAt: Date = (await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.pagingRun,
        ))!["lastEscalationRuleExecutedAt"] as Date;

        /*
         * Level 2 deleted as its service deletes it: the place of the runs
         * on it written, and the rule deleted (the keys clear it). The
         * levels after it keep their numbers: a gap at 2 (issue #9573).
         */
        await OnCallDutyPolicyExecutionLogService.recordPlaceOfRunsOnRule({
          ruleId: new ObjectID(world.levelTwo),
          order: 2,
        });
        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        expect(
          (await rowOf("OnCallDutyPolicyEscalationRule", world.levelThree))![
            "order"
          ],
        ).toBe(3);

        const started: Array<string> = [];

        jest
          .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
          .mockImplementation(async (ruleId: ObjectID) => {
            started.push(ruleId.toString());
            return {
              paged: [],
              notPaged: [],
              hadScheduleGap: false,
              movesOnAtOnce: false,
            };
          });

        // The run as the worker reads it.
        const run: OnCallDutyPolicyExecutionLog | null =
          await OnCallDutyPolicyExecutionLogService.findOneById({
            id: new ObjectID(world.pagingRun),
            select: {
              _id: true,
              projectId: true,
              status: true,
              onCallDutyPolicyId: true,
              lastEscalationRuleExecutedAt: true,
              lastExecutedEscalationRuleId: true,
              lastExecutedEscalationRuleOrder: true,
              executeNextEscalationRuleInMinutes: true,
              userNotificationEventType: true,
              onCallPolicyExecutionRepeatCount: true,
              onCallDutyPolicy: {
                repeatPolicyIfNoOneAcknowledges: true,
                repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
              },
            },
            props: {
              isRoot: true,
            },
          });

        expect(run?.lastExecutedEscalationRuleId).toBeFalsy();

        const result: OnCallEscalationAdvanceResult =
          await OnCallEscalationAdvance.advance({
            run: run!,
            now: new Date(),
          });

        expect(result.kind).toBe(OnCallEscalationAdvanceKind.RuleStarted);
        expect(started).toEqual([world.levelThree]);
        expect(result.rule?.order).toBe(3);

        // The move was claimed on the run itself: only one worker pages.
        const claimed: Dictionary<unknown> | null = await rowOf(
          "OnCallDutyPolicyExecutionLog",
          world.pagingRun,
        );

        expect(claimed!["status"]).toBe(OnCallDutyPolicyStatus.Executing);
        expect(
          (claimed!["lastEscalationRuleExecutedAt"] as Date).getTime(),
        ).toBeGreaterThan(waitStartedAt.getTime());
      });

      test("a level deleted before it moves on is passed over for the one after it, never paged twice nor skipped", async () => {
        const world: World = await seed();

        // The run is on Level 1 now; Level 2 is deleted before its turn.
        await database.query(
          `UPDATE "${schema}"."OnCallDutyPolicyExecutionLog" SET "lastExecutedEscalationRuleId" = $1, "lastExecutedEscalationRuleOrder" = 1 WHERE "_id" = $2`,
          [world.levelOne, world.pagingRun],
        );
        // The levels after it keep their numbers: a gap at 2 (issue #9573).
        await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);

        const started: Array<string> = [];

        jest
          .spyOn(OnCallDutyPolicyEscalationRuleService, "startRuleExecution")
          .mockImplementation(async (ruleId: ObjectID) => {
            started.push(ruleId.toString());
            return {
              paged: [],
              notPaged: [],
              hadScheduleGap: false,
              movesOnAtOnce: false,
            };
          });

        const run: OnCallDutyPolicyExecutionLog | null =
          await OnCallDutyPolicyExecutionLogService.findOneById({
            id: new ObjectID(world.pagingRun),
            select: {
              _id: true,
              projectId: true,
              status: true,
              onCallDutyPolicyId: true,
              lastEscalationRuleExecutedAt: true,
              lastExecutedEscalationRuleId: true,
              lastExecutedEscalationRuleOrder: true,
              executeNextEscalationRuleInMinutes: true,
              userNotificationEventType: true,
              onCallPolicyExecutionRepeatCount: true,
            },
            props: {
              isRoot: true,
            },
          });

        await OnCallEscalationAdvance.advance({ run: run!, now: new Date() });

        expect(started).toEqual([world.levelThree]);
      });
    });

    describe("OnlineDdl.replaceForeignKey on a real table", () => {
      test("swaps a CASCADE key for SET NULL, rows and all, and does nothing the second time", async () => {
        const world: World = await seed();
        const table: string = `"${schema}"."OnCallDutyPolicyExecutionLog"`;
        const name: string = "FK_d4a0ffc5e9e698bb2612ba0e55f";

        // The key as it was before #9036.
        await database.query(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
        await database.query(
          `ALTER TABLE ${table} ADD CONSTRAINT "${name}" FOREIGN KEY ("lastExecutedEscalationRuleId") REFERENCES "${schema}"."OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
        );

        const statement: string = `ALTER TABLE ${table} ADD CONSTRAINT "${name}" FOREIGN KEY ("lastExecutedEscalationRuleId") REFERENCES "${schema}"."OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

        const queryRunner: QueryRunner = database.createQueryRunner();
        const statements: Array<string> = [];
        const query: QueryRunner["query"] = queryRunner.query.bind(queryRunner);

        queryRunner.query = (async (
          sql: string,
          parameters?: Array<unknown>,
        ): Promise<unknown> => {
          statements.push(sql.replace(/\s+/g, " ").trim());
          return await query(sql, parameters);
        }) as QueryRunner["query"];

        try {
          await OnlineDdl.replaceForeignKey(queryRunner, statement);

          const swapped: Array<{
            on_delete: string;
            validated: boolean;
          }> = await database.query(
            `SELECT confdeltype AS on_delete, convalidated AS validated FROM pg_constraint
              WHERE conname = $1 AND conrelid = to_regclass($2)`,
            [name, table],
          );

          expect(swapped).toEqual([{ on_delete: "n", validated: true }]);
          expect(
            statements.filter((sql: string): boolean => {
              return sql.includes("DROP CONSTRAINT");
            }),
          ).toEqual([
            `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${name}", ADD CONSTRAINT "${name}" FOREIGN KEY ("lastExecutedEscalationRuleId") REFERENCES "${schema}"."OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID`,
          ]);

          // Its rows are all there, and the key does what it now says.
          await deleteRow("OnCallDutyPolicyEscalationRule", world.levelTwo);
          expect(
            (await rowOf("OnCallDutyPolicyExecutionLog", world.pagingRun))![
              "lastExecutedEscalationRuleId"
            ],
          ).toBeNull();

          statements.length = 0;
          await OnlineDdl.replaceForeignKey(queryRunner, statement);

          // The second time: one read of the catalog, nothing else.
          expect(statements).toHaveLength(1);
          expect(statements[0]!.startsWith("SELECT")).toBe(true);
        } finally {
          await queryRunner.release();
        }
      });
    });
  },
);
