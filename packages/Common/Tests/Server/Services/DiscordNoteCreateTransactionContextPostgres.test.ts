import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, EntityManager } from "typeorm";
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

/*
 * Server-only transaction context for note creates (HOM-43 review 5,
 * Astra design 2026-09-26): a create whose row insert must join a caller
 * transaction (the advisory-lock fence around hasNote+insert) passes
 * addNote({ ..., tx: { manager, afterCommit } }). The insert runs on the
 * transaction-scoped manager; pre-create hooks and validation run first
 * exactly as today; the whole success phase — onCreateSuccess,
 * auto-owner-on-create, workflow and realtime triggers, audit log — is
 * queued with afterCommit and runs only after the owning transaction
 * commits, and is discarded on rollback. Because the note is already
 * committed when a success effect fails, the transaction owner surfaces a
 * committed-but-effects-failed outcome; it never converts the failure into
 * ordinary success.
 *
 * Cases:
 *   1. rollback discards the note row and no success-phase effect ran;
 *   2. commit persists the note, preserves pre-create hook effects
 *      (postedAt), runs success effects after commit;
 *   3. a success effect failing after commit keeps the note and surfaces
 *      effectsError instead of ordinary success;
 *   4. a non-transaction caller keeps today's behavior (row plus
 *      immediate success effects).
 *
 * Opt in with RUN_POSTGRES_DISCORD_OBSERVATION_TESTS=true against a
 * migrated Postgres (the parity runner sets this with PARITY_TEST_POSTGRES=1).
 */

const describePostgres = (
  process.env["RUN_POSTGRES_DISCORD_OBSERVATION_TESTS"] === "true"
    ? describe
    : describe.skip
) as typeof describe;

/*
 * The CreateBy.tx contract, hand-written until it lands in CreateBy; the
 * addNote argument is cast because the option does not exist yet.
 */
export interface NoteCreateTxContext {
  manager: EntityManager;
  afterCommit: (effect: () => Promise<void>) => void;
}

type AddNoteWithTx = (
  data: Parameters<typeof IncidentPublicNoteService.addNote>[0] & {
    tx?: NoteCreateTxContext;
  },
) => Promise<unknown>;

const addNoteWithTx: AddNoteWithTx = IncidentPublicNoteService.addNote.bind(
  IncidentPublicNoteService,
) as AddNoteWithTx;

describePostgres(
  "note create transaction context (real Postgres)",
  (): void => {
    let database: DataSource;
    let projectId: ObjectID;
    let incidentId: ObjectID;
    const userId: ObjectID = ObjectID.generate();
    const sourceMessageKey: string = "991000000000000001:991000000000000002";

    const noteCount: () => Promise<number> = async (): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text as count FROM "IncidentPublicNote" WHERE "projectId" = $1 AND "incidentId" = $2 AND "postedFromSlackMessageId" = $3`,
        [projectId.toString(), incidentId.toString(), sourceMessageKey],
      );
      return Number(rows[0]?.count);
    };

    const feedCount: () => Promise<number> = async (): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text as count FROM "IncidentFeed" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      return Number(rows[0]?.count);
    };

    beforeAll(async (): Promise<void> => {
      database = new DataSource({
        type: "postgres",
        host: process.env["DATABASE_HOST"] || "postgres",
        port: Number(process.env["DATABASE_PORT"] || "5432"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "fixture",
        entities: Entities,
        synchronize: false,
      });
      await database.initialize();
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      projectId = ObjectID.generate();
      incidentId = ObjectID.generate();

      const stateId: ObjectID = ObjectID.generate();
      const severityId: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1) ON CONFLICT DO NOTHING`,
        [projectId.toString(), `txctx-p-${projectId}`, `txctx-s-${projectId}`],
      );
      await database.query(
        `INSERT INTO "User" ("_id", "version", "email", "slug", "isEmailVerified", "twoFactorAuthEnabled", "isDisabled", "isMasterAdmin", "isBlocked", "enableTwoFactorAuth")
         VALUES ($1, 1, $2, $3, true, false, false, false, false, false)`,
        [
          userId.toString(),
          `txctx-${userId}@example.invalid`,
          `txctx-u-${userId}`,
        ],
      );
      await database.query(
        `INSERT INTO "IncidentState" ("_id", "version", "projectId", "name", "slug", "color", "isCreatedState", "isAcknowledgedState", "isResolvedState", "order")
         VALUES ($1, 1, $2, 'Created', $3, '#111111', true, false, false, 1)`,
        [stateId.toString(), projectId.toString(), `txctx-st-${stateId}`],
      );
      await database.query(
        `INSERT INTO "IncidentSeverity" ("_id", "version", "projectId", "name", "slug", "color", "order")
         VALUES ($1, 1, $2, 'Low', $3, '#888888', 1)`,
        [
          severityId.toString(),
          projectId.toString(),
          `txctx-sev-${severityId}`,
        ],
      );
      await database.query(
        `INSERT INTO "Incident" ("_id", "version", "projectId", "title", "slug",
          "currentIncidentStateId", "incidentSeverityId", "declaredAt")
         VALUES ($1, 1, $2, $3, $4, $5, $6, now())`,
        [
          incidentId.toString(),
          projectId.toString(),
          `txctx-${projectId}`,
          `txctx-i-${incidentId}`,
          stateId.toString(),
          severityId.toString(),
        ],
      );
    });

    beforeEach(async (): Promise<void> => {
      await database.query(
        `DELETE FROM "IncidentPublicNote" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      await database.query(
        `DELETE FROM "IncidentFeed" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
    });

    afterEach((): void => {
      /*
       * PostgresAppInstance spies made in beforeAll are restored in
       * afterAll; restoring here would drop the DataSource for later tests.
       */
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(
          `DELETE FROM "IncidentPublicNote" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(
          `DELETE FROM "IncidentFeed" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
          incidentId.toString(),
        ]);
        await database.query(`DELETE FROM "User" WHERE "_id" = $1`, [
          userId.toString(),
        ]);
        await database.query(
          `DELETE FROM "IncidentState" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(
          `DELETE FROM "IncidentSeverity" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
          projectId.toString(),
        ]);
        await database.destroy();
      }
    });

    /*
     * A real transaction-owner harness: queued effects run only after the
     * transaction commits (database.transaction resolves after COMMIT),
     * sequentially, and the first failure is captured as effectsError
     * (the committed-but-effects-failed outcome). This is the exact shape
     * saveNoteFenced will use in commit B.
     */
    const runInOwnerTransaction: (
      work: (tx: NoteCreateTxContext) => Promise<void>,
    ) => Promise<{ effectsError: Error | null }> = async (
      work: (tx: NoteCreateTxContext) => Promise<void>,
    ): Promise<{ effectsError: Error | null }> => {
      const queue: Array<() => Promise<void>> = [];
      // A rollback rejects here and the queue is never drained.
      await database.transaction(
        async (manager: EntityManager): Promise<void> => {
          await work({
            manager: manager,
            afterCommit: (effect: () => Promise<void>): void => {
              queue.push(effect);
            },
          });
        },
      );
      let effectsError: Error | null = null;
      try {
        for (const effect of queue) {
          await effect();
        }
      } catch (err) {
        effectsError = err as Error;
      }
      return { effectsError: effectsError };
    };

    test("1. rollback discards the note row and runs no success-phase effect", async (): Promise<void> => {
      expect(await noteCount()).toBe(0);

      await expect(
        runInOwnerTransaction(
          async (tx: NoteCreateTxContext): Promise<void> => {
            await addNoteWithTx({
              incidentId: incidentId,
              projectId: projectId,
              userId: userId,
              note: "will be rolled back",
              postedFromSlackMessageId: sourceMessageKey,
              tx: tx,
            });
            /*
             * The row is visible to this transaction (counted on the tx's
             * own connection — a separate READ COMMITTED session cannot see
             * an uncommitted insert) ...
             */
            const inTx: Array<{ count: string }> = await tx.manager.query(
              `SELECT COUNT(*)::text as count FROM "IncidentPublicNote" WHERE "projectId" = $1 AND "incidentId" = $2 AND "postedFromSlackMessageId" = $3`,
              [projectId.toString(), incidentId.toString(), sourceMessageKey],
            );
            expect(Number(inTx[0]?.count)).toBe(1);
            // ... and the abort discards it.
            throw new Error("abort after save");
          },
        ),
      ).rejects.toThrow("abort after save");

      expect(await noteCount()).toBe(0);
      expect(await feedCount()).toBe(0);
    });

    test("2. commit persists the note, preserves pre-create hooks, runs success effects after commit", async (): Promise<void> => {
      let afterCommitUsed: boolean = false;

      await runInOwnerTransaction(
        async (tx: NoteCreateTxContext): Promise<void> => {
          const original: (effect: () => Promise<void>) => void =
            tx.afterCommit;
          tx.afterCommit = (effect: () => Promise<void>): void => {
            afterCommitUsed = true;
            original(effect);
          };
          await addNoteWithTx({
            incidentId: incidentId,
            projectId: projectId,
            userId: userId,
            note: "committed",
            postedFromSlackMessageId: sourceMessageKey,
            tx: tx,
          });
        },
      );

      expect(afterCommitUsed).toBe(true);
      expect(await noteCount()).toBe(1);

      /*
       * Pre-create hook effects preserved on the row itself: postedAt
       * is defaulted by onBeforeCreate.
       */
      const saved: Array<{ postedAt: string | null }> = await database.query(
        `SELECT "postedAt"::text FROM "IncidentPublicNote" WHERE "projectId" = $1 LIMIT 1`,
        [projectId.toString()],
      );
      expect(saved[0]?.postedAt).toBeTruthy();

      // Success-phase effect ran (feed item created post-commit).
      expect(await feedCount()).toBe(1);
    });

    test("3. success-effect failure after commit keeps the note and surfaces effectsError", async (): Promise<void> => {
      const numberSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(IncidentService, "getIncidentNumber")
        .mockRejectedValue(new Error("feed fan-out intentionally failed"));

      try {
        const outcome: { effectsError: Error | null } =
          await runInOwnerTransaction(
            async (tx: NoteCreateTxContext): Promise<void> => {
              await addNoteWithTx({
                incidentId: incidentId,
                projectId: projectId,
                userId: userId,
                note: "committed, effects fail",
                postedFromSlackMessageId: sourceMessageKey,
                tx: tx,
              });
            },
          );

        // The note row is committed.
        expect(await noteCount()).toBe(1);

        /*
         * The owner surfaces committed-but-effects-failed, never ordinary
         * success: getIncidentNumber is mocked to reject and runs inside
         * the queued success phase (the public note feed step). The queue
         * drains post-commit and the first failure lands in effectsError.
         */
        expect(outcome.effectsError).not.toBeNull();
        expect((outcome.effectsError as Error).message).toBe(
          "feed fan-out intentionally failed",
        );
      } finally {
        /*
         * Restore only this spy, even on failure: restoreAllMocks here
         * would also drop the PostgresAppInstance spies later tests need,
         * and a leaking rejection poisons every later feed write.
         */
        numberSpy.mockRestore();
      }
    });

    test("4. non-transaction caller keeps today's behavior", async (): Promise<void> => {
      const note: unknown = await IncidentPublicNoteService.addNote({
        incidentId: incidentId,
        projectId: projectId,
        userId: userId,
        note: "no tx",
        postedFromSlackMessageId: sourceMessageKey,
      });

      expect(note).toBeTruthy();
      expect(await noteCount()).toBe(1);
      expect(await feedCount()).toBe(1);
    });
  },
);
