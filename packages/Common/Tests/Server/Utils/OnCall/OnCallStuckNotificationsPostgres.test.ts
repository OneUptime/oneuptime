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

jest.mock("../../../../Server/Utils/Logger");

import Entities from "../../../../Models/DatabaseModels/Index";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import {
  recordProviderReport,
  recordSendResult,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import {
  recordNotificationRequestFailure,
  recordSendFailure,
} from "../../../../Server/Utils/OnCall/OnCallSendFailure";
import {
  MAX_STUCK_NOTIFICATIONS_PER_RUN,
  settleStuckNotifications,
  StuckNotificationCheckSummary,
} from "../../../../Server/Utils/OnCall/OnCallStuckNotifications";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import {
  refusedRequestError,
  resetRequestError,
} from "../../TestingUtils/NotificationRequestErrors";
import { DataSource, EntityManager } from "typeorm";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";

/*
 * ON-CALL NOTIFICATIONS THAT NEVER GOT A RESULT, AGAINST A MIGRATED
 * POSTGRES (issue #6873).
 *
 * Opt in with RUN_POSTGRES_ONCALL_STUCK_NOTIFICATIONS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_ONCALL_STUCK_NOTIFICATIONS_TESTS=true \
 *   ONCALL_STUCK_NOTIFICATIONS_TEST_DATABASE_HOST=127.0.0.1 \
 *   ONCALL_STUCK_NOTIFICATIONS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/OnCall/OnCallStuckNotificationsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database. It
 * works on a structure-only clone (LIKE ... INCLUDING ALL, indexes and all)
 * of UserOnCallLogTimeline in a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 *
 * What it pins, as Postgres runs the queries:
 *   - the migration built the partial index of the notifications that say
 *     Sending, valid, as the model declares it, and the stuck check's read
 *     - as TypeORM sends it - is served by it;
 *   - the check settles a notification still Sending 15 minutes or more
 *     after it was written, within the last 24 hours, as Error - and leaves
 *     the newer, the older, the deleted and the ones that moved on; the
 *     oldest first, 500 a run, the rest by the next;
 *   - an acknowledgement landing between the check's read and its write
 *     stays: the write names the version read, and finds none; so does a
 *     write that leaves the status as it was - an Error with other words,
 *     landing between a late send's read of the verdict and its write -
 *     which only the version read tells;
 *   - a page's request that never reached the Notification service writes
 *     Error over Sending only; one that got no answer writes nothing; and a
 *     send that finishes after the stuck verdict writes its result over it.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ONCALL_STUCK_NOTIFICATIONS_TESTS"] === "true"
    ? describe
    : describe.skip;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

interface StoredRow {
  status: string;
  statusMessage: string;
  version: number;
}

describePostgres(
  "on-call notifications that never got a result, against Postgres",
  () => {
    const schema: string = `oncall_stuck_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const userId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let now: Date;

    // A notification as its page wrote it, `age` ago.
    async function seed(data: {
      status: UserNotificationStatus;
      age: number;
      statusMessage?: string;
      isDeleted?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const createdAt: Date = new Date(now.getTime() - data.age);

      await database.query(
        `INSERT INTO "${schema}"."UserOnCallLogTimeline"
       ("_id", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyId",
        "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId",
        "userNotificationEventType", "onCallDutyPolicyEscalationRuleId",
        "statusMessage", "status", "version", "createdAt", "updatedAt", "deletedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Incident Created', $8, $9, $10, 1, $11, $11, $12)`,
        [
          id.toString(),
          userId.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          data.statusMessage || "Sending SMS.",
          data.status,
          createdAt,
          data.isDeleted ? createdAt : null,
        ],
      );

      return id;
    }

    async function rowOf(id: ObjectID): Promise<StoredRow> {
      const rows: Array<StoredRow> = await database.query(
        `SELECT "status", "statusMessage", "version" FROM "${schema}"."UserOnCallLogTimeline" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    async function settle(): Promise<StuckNotificationCheckSummary> {
      return await settleStuckNotifications({ now: now });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["ONCALL_STUCK_NOTIFICATIONS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["ONCALL_STUCK_NOTIFICATIONS_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ONCALL_STUCK_NOTIFICATIONS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."UserOnCallLogTimeline" (LIKE public."UserOnCallLogTimeline" INCLUDING ALL)`,
      );

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // An update of a notification starts its workflows and realtime events.
      jest
        .spyOn(
          UserOnCallLogTimelineService as unknown as {
            onTriggerWorkflow: () => Promise<void>;
          },
          "onTriggerWorkflow",
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          UserOnCallLogTimelineService as unknown as {
            onTriggerRealtime: () => Promise<void>;
          },
          "onTriggerRealtime",
        )
        .mockResolvedValue(undefined);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }

      jest.restoreAllMocks();
    });

    beforeEach(async () => {
      await database.query(`DELETE FROM "${schema}"."UserOnCallLogTimeline"`);
      // The database's own clock: what createdAt is compared with.
      const rows: Array<{ now: Date }> = await database.query(
        `SELECT now() AS "now"`,
      );
      now = new Date(rows[0]!.now);
    });

    afterEach(() => {
      // Only the spies a test made on the service's reads; the suite's stay.
      for (const name of ["findOneById", "findBy"] as const) {
        const method: unknown = UserOnCallLogTimelineService[name];

        if (jest.isMockFunction(method)) {
          method.mockRestore();
        }
      }
    });

    describe("the index the migration built", () => {
      test("is there, valid, partial over the notifications that say Sending and are not deleted, on the time", async () => {
        const rows: Array<{ indexdef: string; indisvalid: boolean }> =
          await database.query(
            `SELECT pg_indexes."indexdef", pg_index."indisvalid"
           FROM pg_indexes
           JOIN pg_class ON pg_class."relname" = pg_indexes."indexname"
           JOIN pg_namespace ON pg_namespace."oid" = pg_class."relnamespace" AND pg_namespace."nspname" = pg_indexes."schemaname"
           JOIN pg_index ON pg_index."indexrelid" = pg_class."oid"
           WHERE pg_indexes."schemaname" = 'public' AND pg_indexes."indexname" = 'IDX_81e54f86fd5162924492fa5919'`,
          );

        expect(rows).toHaveLength(1);
        expect(rows[0]!.indisvalid).toBe(true);
        expect(rows[0]!.indexdef).toContain(
          `ON public."UserOnCallLogTimeline" USING btree ("createdAt")`,
        );
        expect(rows[0]!.indexdef).toContain(`'Sending'`);
        expect(rows[0]!.indexdef).toContain(`"deletedAt" IS NULL`);
      });

      test("serves the stuck check's read, as TypeORM sends it", async () => {
        // The clone's copy of the partial index, named by Postgres.
        const indexes: Array<{ indexname: string }> = await database.query(
          `SELECT "indexname" FROM pg_indexes
         WHERE "schemaname" = $1 AND "tablename" = 'UserOnCallLogTimeline' AND "indexdef" LIKE '%''Sending''%'`,
          [schema],
        );

        expect(indexes).toHaveLength(1);

        // What the check's read sends, with its parameters.
        const sent: Array<{ sql: string; parameters: Array<unknown> }> = [];
        const realQuery: PostgresQueryRunner["query"] =
          PostgresQueryRunner.prototype.query;
        const readsTheTable: RegExp = /FROM "[^"]+"\."UserOnCallLogTimeline"/;
        PostgresQueryRunner.prototype.query = function (
          this: PostgresQueryRunner,
          ...args: Parameters<PostgresQueryRunner["query"]>
        ): ReturnType<PostgresQueryRunner["query"]> {
          if (readsTheTable.test(args[0])) {
            sent.push({ sql: args[0], parameters: args[1] || [] });
          }

          return realQuery.apply(this, args);
        };

        try {
          await settle();
        } finally {
          PostgresQueryRunner.prototype.query = realQuery;
        }

        expect(sent).toHaveLength(1);
        expect(sent[0]!.sql).toContain(`ORDER BY`);
        expect(sent[0]!.sql).toContain(`"deletedAt" IS NULL`);

        // Not a scan of every notification ever sent: the partial index.
        const plan: string = await database.transaction(
          async (manager: EntityManager): Promise<string> => {
            await manager.query(`SET LOCAL enable_seqscan = off`);

            const lines: Array<{ "QUERY PLAN": string }> = await manager.query(
              `EXPLAIN ${sent[0]!.sql}`,
              sent[0]!.parameters,
            );

            return lines
              .map((line: { "QUERY PLAN": string }) => {
                return line["QUERY PLAN"];
              })
              .join("\n");
          },
        );

        expect(plan).toContain(indexes[0]!.indexname);
      });
    });

    describe("the stuck check", () => {
      test("settles what is still Sending 15 minutes or more after it was written, within the last day - and nothing else", async () => {
        const justStuck: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 15 * MINUTE + 5000,
        });
        const longStuck: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 2 * HOUR,
        });
        const lastDay: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 23 * HOUR + 50 * MINUTE,
        });
        const stillGoing: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 14 * MINUTE,
        });
        const longAgo: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 25 * HOUR,
        });
        const deleted: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 2 * HOUR,
          isDeleted: true,
        });
        const sent: ObjectID = await seed({
          status: UserNotificationStatus.Sent,
          age: 2 * HOUR,
          statusMessage: "SMS sent.",
        });
        const acknowledged: ObjectID = await seed({
          status: UserNotificationStatus.Acknowledged,
          age: 2 * HOUR,
          statusMessage: "Acknowledged by SMS.",
        });
        const failed: ObjectID = await seed({
          status: UserNotificationStatus.Error,
          age: 2 * HOUR,
          statusMessage: "Number is unreachable (21612).",
        });

        expect(await settle()).toEqual({
          found: 3,
          settled: 3,
          movedOn: 0,
          failed: 0,
        });

        for (const id of [justStuck, longStuck, lastDay]) {
          expect(await rowOf(id)).toEqual({
            status: UserNotificationStatus.Error,
            statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
            version: 2,
          });
        }

        for (const id of [stillGoing, longAgo, deleted]) {
          expect(await rowOf(id)).toEqual({
            status: UserNotificationStatus.Sending,
            statusMessage: "Sending SMS.",
            version: 1,
          });
        }

        expect(await rowOf(sent)).toMatchObject({
          status: UserNotificationStatus.Sent,
          version: 1,
        });
        expect(await rowOf(acknowledged)).toMatchObject({
          status: UserNotificationStatus.Acknowledged,
          version: 1,
        });
        expect(await rowOf(failed)).toMatchObject({
          statusMessage: "Number is unreachable (21612).",
          version: 1,
        });

        // Settled once: the next run finds nothing.
        expect(await settle()).toEqual({
          found: 0,
          settled: 0,
          movedOn: 0,
          failed: 0,
        });
      });

      test(
        "the oldest first, 500 a run: a backlog is worked off by the next runs",
        async () => {
          const count: number = MAX_STUCK_NOTIFICATIONS_PER_RUN + 3;

          // One a second, the oldest 20 hours ago.
          await database.query(
            `INSERT INTO "${schema}"."UserOnCallLogTimeline"
         ("_id", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyId",
          "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId",
          "userNotificationEventType", "onCallDutyPolicyEscalationRuleId",
          "statusMessage", "status", "version", "createdAt", "updatedAt")
         SELECT gen_random_uuid(), $1, $2, gen_random_uuid(), gen_random_uuid(),
                gen_random_uuid(), gen_random_uuid(), 'Incident Created', gen_random_uuid(),
                'Sending SMS.', 'Sending', 1,
                $3::timestamptz + make_interval(secs => n), $3::timestamptz + make_interval(secs => n)
         FROM generate_series(0, $4::int - 1) AS n`,
            [
              userId.toString(),
              projectId.toString(),
              new Date(now.getTime() - 20 * HOUR),
              count,
            ],
          );

          const first: StuckNotificationCheckSummary = await settle();

          expect(first).toEqual({
            found: MAX_STUCK_NOTIFICATIONS_PER_RUN,
            settled: MAX_STUCK_NOTIFICATIONS_PER_RUN,
            movedOn: 0,
            failed: 0,
          });

          // The three left are the newest three.
          const left: Array<{ createdAt: Date }> = await database.query(
            `SELECT "createdAt" FROM "${schema}"."UserOnCallLogTimeline" WHERE "status" = 'Sending' ORDER BY "createdAt"`,
          );
          const newestSettled: Array<{ createdAt: Date }> =
            await database.query(
              `SELECT max("createdAt") AS "createdAt" FROM "${schema}"."UserOnCallLogTimeline" WHERE "status" = 'Error'`,
            );

          expect(left).toHaveLength(3);
          expect(new Date(left[0]!.createdAt).getTime()).toBeGreaterThan(
            new Date(newestSettled[0]!.createdAt).getTime(),
          );

          expect(await settle()).toEqual({
            found: 3,
            settled: 3,
            movedOn: 0,
            failed: 0,
          });
        },
        120 * 1000,
      );

      test("an acknowledgement between the check's read and its write stays: the write names the version read, and finds no row", async () => {
        const id: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 30 * MINUTE,
        });

        const realRead: typeof UserOnCallLogTimelineService.findOneById =
          UserOnCallLogTimelineService.findOneById.bind(
            UserOnCallLogTimelineService,
          );
        let isAcknowledged: boolean = false;

        jest
          .spyOn(UserOnCallLogTimelineService, "findOneById")
          .mockImplementation((async (
            input: Parameters<
              typeof UserOnCallLogTimelineService.findOneById
            >[0],
          ) => {
            const read: UserOnCallLogTimeline | null = await realRead(input);

            // The person acknowledges, by another channel, once.
            if (!isAcknowledged) {
              isAcknowledged = true;
              await database.query(
                `UPDATE "${schema}"."UserOnCallLogTimeline"
               SET "status" = 'Acknowledged', "statusMessage" = 'Acknowledged by SMS.', "version" = "version" + 1
               WHERE "_id" = $1`,
                [id.toString()],
              );
            }

            return read;
          }) as never);

        expect(await settle()).toEqual({
          found: 1,
          settled: 0,
          movedOn: 1,
          failed: 0,
        });
        expect(await rowOf(id)).toEqual({
          status: UserNotificationStatus.Acknowledged,
          statusMessage: "Acknowledged by SMS.",
          version: 2,
        });
      });

      test("a send that finishes after the verdict says how it went after all; a provider's report does not", async () => {
        const late: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 20 * MINUTE,
        });
        const reported: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 20 * MINUTE,
        });

        await settle();

        expect(
          await recordSendResult({
            userOnCallLogTimelineId: late,
            isSent: true,
            statusMessage: "SMS sent.",
          }),
        ).toBe(true);
        expect(await rowOf(late)).toEqual({
          status: UserNotificationStatus.Sent,
          statusMessage: "SMS sent.",
          version: 3,
        });

        expect(
          await recordProviderReport({
            userOnCallLogTimelineId: reported,
            status: UserNotificationStatus.Error,
            statusMessage: "Undelivered (30003).",
          }),
        ).toBe(false);
        expect(await rowOf(reported)).toMatchObject({
          status: UserNotificationStatus.Error,
          statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
        });
      });

      test("an Error with other words, written between a late send's read of the verdict and its write, stays: the status is the same, so only the version read tells", async () => {
        const id: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 20 * MINUTE,
        });

        await settle();

        expect(await rowOf(id)).toEqual({
          status: UserNotificationStatus.Error,
          statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
          version: 2,
        });

        const realRead: typeof UserOnCallLogTimelineService.findOneById =
          UserOnCallLogTimelineService.findOneById.bind(
            UserOnCallLogTimelineService,
          );
        let isWrittenMeanwhile: boolean = false;

        jest
          .spyOn(UserOnCallLogTimelineService, "findOneById")
          .mockImplementation((async (
            input: Parameters<
              typeof UserOnCallLogTimelineService.findOneById
            >[0],
          ) => {
            const read: UserOnCallLogTimeline | null = await realRead(input);

            /*
             * Something else says why it was not sent, once, and leaves it an
             * Error - as an unconditional writer (markNotSent) does.
             */
            if (!isWrittenMeanwhile) {
              isWrittenMeanwhile = true;
              await database.query(
                `UPDATE "${schema}"."UserOnCallLogTimeline"
               SET "statusMessage" = 'Not sent: SMS is turned off for this project.', "version" = "version" + 1
               WHERE "_id" = $1`,
                [id.toString()],
              );
            }

            return read;
          }) as never);

        // Read as the verdict at version 2; written at version 2: no row. Read again: not the verdict.
        expect(
          await recordSendResult({
            userOnCallLogTimelineId: id,
            isSent: true,
            statusMessage: "SMS sent.",
          }),
        ).toBe(false);
        expect(await rowOf(id)).toEqual({
          status: UserNotificationStatus.Error,
          statusMessage: "Not sent: SMS is turned off for this project.",
          version: 3,
        });
      });
    });

    describe("a page's send that threw", () => {
      test("a request that never reached the Notification service: Error over Sending, saying so", async () => {
        const id: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 1000,
        });

        await recordNotificationRequestFailure({
          userOnCallLogTimelineId: id,
          error: refusedRequestError(),
          fallbackStatusMessage: "Error sending SMS.",
        });

        expect(await rowOf(id)).toEqual({
          status: UserNotificationStatus.Error,
          statusMessage:
            "Could not reach the Notification service to send this (ECONNREFUSED).",
          version: 2,
        });
      });

      test("a request that got no answer: nothing written - the service's own result, or the stuck check, says how it went", async () => {
        const id: ObjectID = await seed({
          status: UserNotificationStatus.Sending,
          age: 1000,
        });

        await recordNotificationRequestFailure({
          userOnCallLogTimelineId: id,
          error: resetRequestError(),
          fallbackStatusMessage: "Error sending SMS.",
        });

        expect(await rowOf(id)).toEqual({
          status: UserNotificationStatus.Sending,
          statusMessage: "Sending SMS.",
          version: 1,
        });
      });

      test.each([
        [UserNotificationStatus.Sent, "SMS sent."],
        [UserNotificationStatus.Acknowledged, "Acknowledged by SMS."],
        [UserNotificationStatus.NotAnswered, "Call not answered (no-answer)."],
      ])(
        "a notification already %s stays, whatever failed",
        async (status: UserNotificationStatus, message: string) => {
          const id: ObjectID = await seed({
            status: status,
            age: 1000,
            statusMessage: message,
          });

          await recordNotificationRequestFailure({
            userOnCallLogTimelineId: id,
            error: refusedRequestError(),
            fallbackStatusMessage: "Error sending SMS.",
          });
          await recordSendFailure({
            userOnCallLogTimelineId: id,
            error: new Error("No devices provided"),
            fallbackStatusMessage: "Error sending push notification.",
          });

          expect(await rowOf(id)).toEqual({
            status: status,
            statusMessage: message,
            version: 1,
          });
        },
      );
    });
  },
);
