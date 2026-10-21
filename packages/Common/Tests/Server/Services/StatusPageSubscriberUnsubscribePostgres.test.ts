import Entities from "../../../Models/DatabaseModels/Index";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { StatusPageSubscriberUnsubscribeSource } from "../../../Server/Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { DataSource } from "typeorm";

/*
 * The SQL behind unsubscribing without signing in, against a migrated
 * Postgres:
 *
 *   - the backfill data migration (backfillUnsubscribeColumns) walks the
 *     table in batches, gives every existing subscriber its own well-formed
 *     token, leaves a token already there alone, marks the subscribers with
 *     a creator as added by the team, and agrees with itself when two run at
 *     once;
 *   - StatusPageSubscriberService.unsubscribe cancels a subscription exactly
 *     once, even when two confirmations race, and never a deleted one;
 *   - ensureUnsubscribeTokens fills only an empty token, for a whole list in
 *     one statement.
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
      createdByUserId?: ObjectID | null;
      isAddedByTeam?: boolean;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber"
         ("_id", "projectId", "statusPageId", "subscriberEmail",
          "isUnsubscribed", "isSubscriptionConfirmed", "unsubscribeToken",
          "deletedAt", "createdByUserId", "isAddedByTeam", "version")
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, 1)`,
        [
          id.toString(),
          projectId.toString(),
          statusPageId.toString(),
          `subscriber-${id.toString()}@acme.com`,
          row.isUnsubscribed ?? false,
          row.token ?? null,
          row.isDeleted ? new Date() : null,
          row.createdByUserId ? row.createdByUserId.toString() : null,
          row.isAddedByTeam ?? false,
        ],
      );

      return id;
    }

    async function read(id: ObjectID): Promise<{
      unsubscribeToken: string | null;
      isUnsubscribed: boolean;
      unsubscribedAt: Date | null;
      isAddedByTeam: boolean;
    }> {
      const rows: Array<{
        unsubscribeToken: string | null;
        isUnsubscribed: boolean;
        unsubscribedAt: Date | null;
        isAddedByTeam: boolean;
      }> = await database.query(
        `SELECT "unsubscribeToken", "isUnsubscribed", "unsubscribedAt", "isAddedByTeam" FROM "${schema}"."StatusPageSubscriber" WHERE "_id" = $1`,
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

    test("the backfill gives every subscriber its own well-formed token, a batch at a time", async () => {
      const existing: string = "ab".repeat(32);

      const ids: Array<ObjectID> = [];
      for (let i: number = 0; i < 25; i++) {
        ids.push(await seed({ token: null }));
      }
      const deleted: ObjectID = await seed({ token: null, isDeleted: true });
      const alreadyHasOne: ObjectID = await seed({ token: existing });

      // A batch smaller than the table, so the walk crosses several pages.
      const result: { tokensGiven: number; markedAddedByTeam: number } =
        await StatusPageSubscriberService.backfillUnsubscribeColumns({
          batchSize: 7,
        });

      expect(result.tokensGiven).toBe(26);

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

    test("the backfill marks every subscriber with a creator as added by the team, and only those", async () => {
      const teammate: ObjectID = ObjectID.generate();

      const byTeammate: ObjectID = await seed({
        token: "ac".repeat(32),
        createdByUserId: teammate,
      });
      const byTeammateDeleted: ObjectID = await seed({
        createdByUserId: teammate,
        isDeleted: true,
      });
      const signUp: ObjectID = await seed({ token: "ad".repeat(32) });
      // An API key's subscriber from after the upgrade: marked on create.
      const byApiKey: ObjectID = await seed({
        token: "ae".repeat(32),
        isAddedByTeam: true,
      });

      const result: { tokensGiven: number; markedAddedByTeam: number } =
        await StatusPageSubscriberService.backfillUnsubscribeColumns({
          batchSize: 2,
        });

      expect(result.markedAddedByTeam).toBe(2);
      expect((await read(byTeammate)).isAddedByTeam).toBe(true);
      expect((await read(byTeammateDeleted)).isAddedByTeam).toBe(true);
      expect((await read(signUp)).isAddedByTeam).toBe(false);
      expect((await read(byApiKey)).isAddedByTeam).toBe(true);
    });

    test("a second backfill, even one racing the first, changes nothing the first wrote", async () => {
      const ids: Array<ObjectID> = [];
      for (let i: number = 0; i < 12; i++) {
        ids.push(
          await seed({ token: null, createdByUserId: ObjectID.generate() }),
        );
      }

      await Promise.all([
        StatusPageSubscriberService.backfillUnsubscribeColumns({
          batchSize: 5,
        }),
        StatusPageSubscriberService.backfillUnsubscribeColumns({
          batchSize: 3,
        }),
      ]);

      const afterRace: Array<string | null> = [];
      for (const id of ids) {
        afterRace.push((await read(id)).unsubscribeToken);
      }

      const again: { tokensGiven: number; markedAddedByTeam: number } =
        await StatusPageSubscriberService.backfillUnsubscribeColumns({
          batchSize: 4,
        });

      expect(again).toEqual({ tokensGiven: 0, markedAddedByTeam: 0 });

      for (let i: number = 0; i < ids.length; i++) {
        const row: { unsubscribeToken: string | null; isAddedByTeam: boolean } =
          await read(ids[i]!);
        expect(
          StatusPageSubscriberUnsubscribe.isWellFormedToken(
            row.unsubscribeToken,
          ),
        ).toBe(true);
        // Whoever won, the token is the one it wrote, and it stayed.
        expect(row.unsubscribeToken).toBe(afterRace[i]);
        expect(row.isAddedByTeam).toBe(true);
      }
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

      const secondEmpty: ObjectID = await seed({ token: null });
      const secondEmptyRow: StatusPageSubscriber = new StatusPageSubscriber();
      secondEmptyRow._id = secondEmpty.toString();

      await StatusPageSubscriberService.ensureUnsubscribeTokens([
        emptyRow,
        staleRow,
        secondEmptyRow,
      ]);

      // One token each, both stored, and handed back to the rows.
      const secondStored: string | null = (await read(secondEmpty))
        .unsubscribeToken;
      expect(
        StatusPageSubscriberUnsubscribe.isWellFormedToken(secondStored),
      ).toBe(true);
      expect(secondEmptyRow.unsubscribeToken).toBe(secondStored);

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
