import Entities from "../../../Models/DatabaseModels/Index";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import { AddStatusPageSubscriberUnsubscribeToken1795600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1795600000000-AddStatusPageSubscriberUnsubscribeToken";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { StatusPageSubscriberUnsubscribeSource } from "../../../Server/Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The SQL behind unsubscribing without signing in, against a migrated
 * Postgres:
 *
 *   - the migration's backfill gives every existing subscriber its own
 *     well-formed token, and leaves a token already there alone;
 *   - StatusPageSubscriberService.unsubscribe cancels a subscription exactly
 *     once, even when two confirmations race, and never a deleted one;
 *   - ensureUnsubscribeTokens fills only an empty token.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_UNSUBSCRIBE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SUBSCRIBER_UNSUBSCRIBE_TESTS=true \
 *   SUBSCRIBER_UNSUBSCRIBE_TEST_DATABASE_HOST=127.0.0.1 \
 *   SUBSCRIBER_UNSUBSCRIBE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StatusPageSubscriberUnsubscribePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works
 * on a structure-only clone of the migrated StatusPageSubscriber table
 * (LIKE ... INCLUDING ALL) in a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_UNSUBSCRIBE_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres(
  "status page subscriber unsubscribe SQL against Postgres",
  () => {
    const schema: string = `subscriber_unsubscribe_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const statusPageId: ObjectID = ObjectID.generate();

    let database: DataSource;

    async function seed(row: {
      token?: string | null;
      isUnsubscribed?: boolean;
      isDeleted?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber"
         ("_id", "projectId", "statusPageId", "subscriberEmail",
          "isUnsubscribed", "isSubscriptionConfirmed", "unsubscribeToken",
          "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, 1)`,
        [
          id.toString(),
          projectId.toString(),
          statusPageId.toString(),
          `subscriber-${id.toString()}@acme.com`,
          row.isUnsubscribed ?? false,
          row.token ?? null,
          row.isDeleted ? new Date() : null,
        ],
      );

      return id;
    }

    async function read(id: ObjectID): Promise<{
      unsubscribeToken: string | null;
      isUnsubscribed: boolean;
      unsubscribedAt: Date | null;
    }> {
      const rows: Array<{
        unsubscribeToken: string | null;
        isUnsubscribed: boolean;
        unsubscribedAt: Date | null;
      }> = await database.query(
        `SELECT "unsubscribeToken", "isUnsubscribed", "unsubscribedAt" FROM "${schema}"."StatusPageSubscriber" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SUBSCRIBER_UNSUBSCRIBE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["SUBSCRIBER_UNSUBSCRIBE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SUBSCRIBER_UNSUBSCRIBE_TEST_DATABASE_NAME"] ||
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
        `CREATE TABLE "${schema}"."StatusPageSubscriber" (LIKE public."StatusPageSubscriber" INCLUDING ALL)`,
      );

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    beforeEach(async () => {
      await database.query(`DELETE FROM "${schema}"."StatusPageSubscriber"`);

      jest
        .spyOn(StatusPageSubscriberService, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(StatusPageSubscriberService, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(StatusPageSubscriberService, "notifyTeamOfUnsubscribe")
        .mockResolvedValue(undefined as never);

      // Re-spying keeps the old spy and its calls; count each test on its own.
      (
        StatusPageSubscriberService.notifyTeamOfUnsubscribe as unknown as jest.Mock
      ).mockClear();
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the harness writes to the clone, not public", async () => {
      await seed({});

      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text AS "count" FROM "StatusPageSubscriber" WHERE "statusPageId" = $1`,
        [statusPageId.toString()],
      );

      expect(rows[0]!.count).toBe("1");
    });

    test("the migration's backfill gives every subscriber its own well-formed token", async () => {
      const existing: string = "ab".repeat(32);

      const ids: Array<ObjectID> = [];
      for (let i: number = 0; i < 25; i++) {
        ids.push(await seed({ token: null }));
      }
      const deleted: ObjectID = await seed({ token: null, isDeleted: true });
      const alreadyHasOne: ObjectID = await seed({ token: existing });

      // The backfill statement exactly as the migration runs it.
      const statements: Array<string> = [];
      await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up({
        query: (sql: string): Promise<void> => {
          statements.push(sql);
          return Promise.resolve();
        },
      } as unknown as QueryRunner);
      const backfill: string = statements.find((sql: string) => {
        return sql.startsWith("UPDATE");
      })!;

      await database.query(backfill);

      const tokens: Array<string> = [];

      for (const id of [...ids, deleted]) {
        const token: string | null = (await read(id)).unsubscribeToken;

        expect(StatusPageSubscriberUnsubscribe.isWellFormedToken(token)).toBe(
          true,
        );
        tokens.push(token!);
      }

      expect(new Set(tokens).size).toBe(tokens.length);
      expect((await read(alreadyHasOne)).unsubscribeToken).toBe(existing);
    });

    test("unsubscribe() cancels a live subscription once and dates it", async () => {
      const id: ObjectID = await seed({ token: "cd".repeat(32) });

      const first: boolean = await StatusPageSubscriberService.unsubscribe({
        subscriberId: id,
        source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
      });
      const afterFirst: {
        isUnsubscribed: boolean;
        unsubscribedAt: Date | null;
      } = await read(id);

      const second: boolean = await StatusPageSubscriberService.unsubscribe({
        subscriberId: id,
        source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
      });
      const afterSecond: { unsubscribedAt: Date | null } = await read(id);

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(afterFirst.isUnsubscribed).toBe(true);
      expect(afterFirst.unsubscribedAt).toBeInstanceOf(Date);
      // The second confirmation did not move the date.
      expect(afterSecond.unsubscribedAt!.getTime()).toBe(
        afterFirst.unsubscribedAt!.getTime(),
      );
    });

    test("two confirmations racing cancel it once, so the team is told once", async () => {
      const id: ObjectID = await seed({ token: "ce".repeat(32) });

      const results: Array<boolean> = await Promise.all(
        [0, 1, 2, 3].map(() => {
          return StatusPageSubscriberService.unsubscribe({
            subscriberId: id,
            source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
          });
        }),
      );

      expect(
        results.filter((changed: boolean) => {
          return changed;
        }),
      ).toHaveLength(1);
      expect(
        StatusPageSubscriberService.notifyTeamOfUnsubscribe,
      ).toHaveBeenCalledTimes(1);
    });

    test("a deleted or already cancelled subscription is left alone", async () => {
      const deleted: ObjectID = await seed({ isDeleted: true });
      const cancelled: ObjectID = await seed({ isUnsubscribed: true });

      for (const id of [deleted, cancelled]) {
        expect(
          await StatusPageSubscriberService.unsubscribe({
            subscriberId: id,
            source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
          }),
        ).toBe(false);
        expect((await read(id)).unsubscribedAt).toBeNull();
      }
    });

    test("ensureUnsubscribeTokens fills an empty token and keeps an existing one", async () => {
      const existing: string = "ef".repeat(32);
      const empty: ObjectID = await seed({ token: null });
      const filled: ObjectID = await seed({ token: existing });

      const emptyRow: StatusPageSubscriber = new StatusPageSubscriber();
      emptyRow._id = empty.toString();

      // A stale read: the row claims no token, but the database has one.
      const staleRow: StatusPageSubscriber = new StatusPageSubscriber();
      staleRow._id = filled.toString();

      await StatusPageSubscriberService.ensureUnsubscribeTokens([
        emptyRow,
        staleRow,
      ]);

      const stored: string | null = (await read(empty)).unsubscribeToken;

      expect(StatusPageSubscriberUnsubscribe.isWellFormedToken(stored)).toBe(
        true,
      );
      expect(emptyRow.unsubscribeToken).toBe(stored);

      // The existing token is kept, and the stale row picks it up.
      expect((await read(filled)).unsubscribeToken).toBe(existing);
      expect(staleRow.unsubscribeToken).toBe(existing);
    });
  },
);
